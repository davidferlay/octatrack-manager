//! Read-only audio analysis and local catalog draft editing. No media Apply API.
use crate::catalog_runtime::SharedCatalog;
use crate::root_registry::RootRegistry;
use crate::v2_api::{catalog_identity, file_for_instance_id, load_library_snapshot, ApiError};
use ot_audio::onsets::OnsetAnalysis;
use ot_audio::pcm::{PcmError, PcmSnapshot};
use ot_domain::onsets::{BoundaryWarning, OnsetParameters, OnsetProposal, MAX_DRAFT_MARKERS};
use ot_domain::slice_draft::{SliceDraft, SliceEdit};
use ot_domain::slicing::{FrameRange, PcmFrame};
use ot_domain::RootId;
use ot_storage_ports::slice_drafts::{SliceDraftBinding, SliceDraftCatalog, SliceDraftStoreError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub type SharedSliceWorkbench = Arc<SliceWorkbench>;
const JOB_TTL: Duration = Duration::from_secs(15 * 60);

pub struct SliceWorkbench {
    current: Mutex<Option<Arc<Job>>>,
    busy: AtomicBool,
    nonce: [u8; 32],
    counter: AtomicU64,
    /// Test-only clock: production always uses `JOB_TTL`. Never wait real wall time.
    #[cfg(test)]
    test_job_ttl: Mutex<Duration>,
}

struct Job {
    id: String,
    root: RootId,
    window: String,
    created: Instant,
    cancelled: AtomicBool,
    proposal_generation: AtomicU64,
    state: Mutex<JobState>,
    previews: Mutex<HashMap<String, Preview>>,
    history: Mutex<History>,
}
#[derive(Default)]
struct History {
    revision: u64,
    undo: Vec<SliceDraft>,
    redo: Vec<SliceDraft>,
}
impl History {
    fn synchronize(&mut self, revision: u64) {
        if self.revision != revision {
            *self = Self {
                revision,
                ..Self::default()
            };
        }
    }
}
struct JobState {
    phase: &'static str,
    error: Option<ApiError>,
    ready: Option<Ready>,
    proposal: Option<Proposal>,
}
#[derive(Clone)]
struct Ready {
    analysis: Arc<OnsetAnalysis>,
    binding: SliceDraftBinding,
}
#[derive(Clone)]
struct Proposal {
    id: String,
    revision: u64,
    value: OnsetProposal,
}
struct Preview {
    bytes: Vec<u8>,
    expires: Instant,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SliceRangeDto {
    pub start_frame: String,
    pub end_exclusive: String,
}
impl SliceRangeDto {
    fn parse(&self) -> Result<FrameRange, ApiError> {
        FrameRange::new(
            parse_frame(&self.start_frame)?,
            parse_frame(&self.end_exclusive)?,
        )
        .map_err(|_| invalid("invalid frame range"))
    }
}
impl From<FrameRange> for SliceRangeDto {
    fn from(range: FrameRange) -> Self {
        Self {
            start_frame: range.start().to_string(),
            end_exclusive: range.end_exclusive().to_string(),
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnsetParametersDto {
    pub sensitivity: u8,
    pub minimum_interval_ms: u16,
    pub pre_roll_us: u16,
    pub silence_floor_db: i16,
    pub snap_radius_us: u16,
}
impl OnsetParametersDto {
    fn parse(self) -> Result<OnsetParameters, ApiError> {
        OnsetParameters {
            sensitivity: self.sensitivity,
            minimum_interval_ms: self.minimum_interval_ms,
            pre_roll_us: self.pre_roll_us,
            silence_floor_db: self.silence_floor_db,
            snap_radius_us: self.snap_radius_us,
        }
        .validate()
        .map_err(invalid)
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceJobDto {
    pub job_id: String,
    pub phase: &'static str,
    pub error: Option<ApiError>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub frame_count: Option<String>,
    pub region: Option<SliceRangeDto>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceMarkerDto {
    pub marker_id: String,
    pub start_frame: String,
    pub end_exclusive: String,
    pub locked: bool,
    pub manual: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceDraftDto {
    pub revision: u64,
    pub region: SliceRangeDto,
    pub markers: Vec<SliceMarkerDto>,
    pub can_undo: bool,
    pub can_redo: bool,
}
impl From<SliceDraft> for SliceDraftDto {
    fn from(draft: SliceDraft) -> Self {
        Self {
            can_undo: false,
            can_redo: false,
            revision: draft.revision,
            region: draft.region.into(),
            markers: draft
                .markers
                .iter()
                .enumerate()
                .map(|(i, m)| SliceMarkerDto {
                    marker_id: m.id.clone(),
                    start_frame: m.start.to_string(),
                    end_exclusive: draft
                        .markers
                        .get(i + 1)
                        .map(|n| n.start)
                        .unwrap_or(draft.region.end_exclusive())
                        .to_string(),
                    locked: m.locked,
                    manual: m.manual,
                })
                .collect(),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnsetCandidateDto {
    pub candidate_id: String,
    pub novelty_peak_frame: String,
    pub estimated_attack_frame: String,
    pub suggested_start_frame: String,
    pub strength: f32,
    pub band_scores: [f32; 3],
    pub threshold_margin: f32,
    pub uncertainty: SliceRangeDto,
    pub warnings: Vec<&'static str>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceProposalDto {
    pub proposal_id: String,
    pub expected_revision: u64,
    pub candidate_count: usize,
    pub candidates: Vec<OnsetCandidateDto>,
    pub suppressed_count: usize,
    pub exceeds_draft_limit: bool,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SliceEditDto {
    Undo,
    Redo,
    AcceptProposal {
        #[serde(rename = "proposalId")]
        proposal_id: String,
    },
    Move {
        #[serde(rename = "markerId")]
        marker_id: String,
        frame: String,
    },
    Insert {
        frame: String,
    },
    Delete {
        #[serde(rename = "markerId")]
        marker_id: String,
    },
    SetLock {
        #[serde(rename = "markerId")]
        marker_id: String,
        locked: bool,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceWaveformDto {
    pub range: SliceRangeDto,
    pub peaks: Vec<Vec<[f32; 2]>>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicePreviewDto {
    pub preview_token: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_count: String,
    pub byte_length: usize,
}

impl SliceWorkbench {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let mut nonce = [0; 32];
        getrandom::fill(&mut nonce).map_err(|_| std::io::Error::other("randomness unavailable"))?;
        Ok(Self {
            current: Mutex::new(None),
            busy: AtomicBool::new(false),
            nonce,
            counter: AtomicU64::new(1),
            #[cfg(test)]
            test_job_ttl: Mutex::new(JOB_TTL),
        })
    }
    #[allow(clippy::unused_self)]
    fn job_ttl(&self) -> Duration {
        #[cfg(test)]
        {
            self.test_job_ttl.lock().map(|ttl| *ttl).unwrap_or(JOB_TTL)
        }
        #[cfg(not(test))]
        JOB_TTL
    }
    #[cfg(test)]
    fn expire_jobs_for_test(&self) {
        if let Ok(mut ttl) = self.test_job_ttl.lock() {
            *ttl = Duration::ZERO;
        }
    }
    fn token(&self, kind: &str) -> String {
        let mut hash = Sha256::new();
        hash.update(self.nonce);
        hash.update(self.counter.fetch_add(1, Ordering::Relaxed).to_le_bytes());
        format!("{kind}:v1:{:x}", hash.finalize())
    }
    fn job(&self, root: &RootId, window: &str, id: &str) -> Result<Arc<Job>, ApiError> {
        let current = self.current.lock().map_err(|_| internal())?;
        let job = current
            .as_ref()
            .filter(|j| j.id == id && &j.root == root && j.window == window)
            .ok_or_else(not_found)?;
        if job.created.elapsed() > self.job_ttl() {
            job.cancelled.store(true, Ordering::Relaxed);
            let mut state = job.state.lock().map_err(|_| internal())?;
            state.ready = None;
            state.proposal = None;
            job.previews.lock().map_err(|_| internal())?.clear();
            return Err(expired());
        }
        Ok(Arc::clone(job))
    }
    pub fn start(
        self: &Arc<Self>,
        registry: Arc<RootRegistry>,
        catalog: SharedCatalog,
        root: RootId,
        window: String,
        file_id: String,
        region: Option<SliceRangeDto>,
    ) -> Result<SliceJobDto, ApiError> {
        registry.resolve(&root)?;
        let region = region.map(|r| r.parse()).transpose()?;
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(ApiError::new(
                "ANALYSIS_BUSY",
                "another analysis is still running",
                true,
            ));
        }
        let job = Arc::new(Job {
            id: self.token("analysis"),
            root,
            window,
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            proposal_generation: AtomicU64::new(0),
            state: Mutex::new(JobState {
                phase: "reading",
                error: None,
                ready: None,
                proposal: None,
            }),
            previews: Mutex::new(HashMap::new()),
            history: Mutex::new(History::default()),
        });
        {
            let mut current = match self.current.lock() {
                Ok(value) => value,
                Err(_) => {
                    self.busy.store(false, Ordering::Release);
                    return Err(internal());
                }
            };
            if current.as_ref().is_some_and(|old| {
                old.window != job.window
                    && !old.cancelled.load(Ordering::Relaxed)
                    && old.created.elapsed() <= self.job_ttl()
            }) {
                self.busy.store(false, Ordering::Release);
                return Err(ApiError::new(
                    "ANALYSIS_BUSY",
                    "another window owns the active analysis",
                    true,
                ));
            }
            if let Some(old) = current.take() {
                old.cancelled.store(true, Ordering::Relaxed);
            }
            *current = Some(Arc::clone(&job));
        }
        let response = status(&job)?;
        let workbench = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                build_job(&registry, &catalog, &job, &file_id, region)
            }));
            if let Ok(mut state) = job.state.lock() {
                match result {
                    _ if job.cancelled.load(Ordering::Relaxed) => {
                        state.phase = "cancelled";
                        state.ready = None;
                    }
                    Ok(Ok(ready)) => {
                        state.phase = "ready";
                        state.ready = Some(ready);
                    }
                    Ok(Err(error)) => {
                        state.phase = "failed";
                        state.error = Some(error);
                    }
                    Err(_) => {
                        state.phase = "failed";
                        state.error = Some(internal());
                    }
                }
            }
            workbench.busy.store(false, Ordering::Release);
        });
        Ok(response)
    }
    pub fn status(&self, root: &RootId, window: &str, id: &str) -> Result<SliceJobDto, ApiError> {
        let job = self.job(root, window, id)?;
        status(&job)
    }
    pub fn cancel(&self, root: &RootId, window: &str, id: &str) -> Result<(), ApiError> {
        let job = self.job(root, window, id)?;
        job.cancelled.store(true, Ordering::Relaxed);
        let mut state = job.state.lock().map_err(|_| internal())?;
        state.phase = "cancelled";
        state.ready = None;
        state.proposal = None;
        job.previews.lock().map_err(|_| internal())?.clear();
        Ok(())
    }
    fn ready(&self, root: &RootId, window: &str, id: &str) -> Result<(Arc<Job>, Ready), ApiError> {
        let job = self.job(root, window, id)?;
        let ready = {
            let state = job.state.lock().map_err(|_| internal())?;
            if job.cancelled.load(Ordering::Relaxed) {
                return Err(not_found());
            }
            state
                .ready
                .clone()
                .ok_or_else(|| ApiError::new("ANALYSIS_NOT_READY", "analysis is not ready", true))?
        };
        Ok((job, ready))
    }
    pub fn draft(
        &self,
        catalog: &SharedCatalog,
        root: &RootId,
        window: &str,
        id: &str,
    ) -> Result<SliceDraftDto, ApiError> {
        let (job, ready) = self.ready(root, window, id)?;
        let mut history = job.history.lock().map_err(|_| internal())?;
        let draft = load_draft(catalog, &ready)?;
        history.synchronize(draft.revision);
        Ok(draft_dto(draft, &history))
    }
    pub fn propose(
        &self,
        catalog: &SharedCatalog,
        root: &RootId,
        window: &str,
        id: &str,
        expected_revision: u64,
        parameters: OnsetParametersDto,
    ) -> Result<SliceProposalDto, ApiError> {
        let parameters = parameters.parse()?;
        let (job, ready) = self.ready(root, window, id)?;
        let generation = job.proposal_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let draft = load_draft(catalog, &ready)?;
        if draft.revision != expected_revision {
            return Err(conflict());
        }
        let protected = draft
            .markers
            .iter()
            .filter(|m| m.manual || m.locked)
            .map(|m| m.start)
            .collect::<Vec<_>>();
        let mut proposal = ready
            .analysis
            .propose(parameters, &protected, &job.cancelled)
            .map_err(pcm_error)?;
        let before_exclusions = proposal.candidates.len();
        proposal.candidates.retain(|candidate| {
            !draft.suppressed_candidate_ids.contains(&candidate.id)
                && !draft
                    .exclusions
                    .iter()
                    .any(|range| range.contains(candidate.estimated_attack))
        });
        let user_excluded = before_exclusions - proposal.candidates.len();
        let proposal_id = self.token("proposal");
        let dto = SliceProposalDto {
            proposal_id: proposal_id.clone(),
            expected_revision,
            candidate_count: proposal.candidates.len(),
            suppressed_count: proposal.suppressed.len() + user_excluded,
            exceeds_draft_limit: proposal.candidates.len() > MAX_DRAFT_MARKERS,
            // Results are bounded. No oversized JSON response for pathological audio.
            candidates: proposal
                .candidates
                .iter()
                .take(MAX_DRAFT_MARKERS)
                .map(|c| OnsetCandidateDto {
                    candidate_id: c.id.clone(),
                    novelty_peak_frame: c.novelty_peak.to_string(),
                    estimated_attack_frame: c.estimated_attack.to_string(),
                    suggested_start_frame: c.suggested_start.to_string(),
                    strength: c.strength,
                    band_scores: c.band_scores,
                    threshold_margin: c.threshold_margin,
                    uncertainty: c.uncertainty.into(),
                    warnings: c
                        .warnings
                        .iter()
                        .map(|w| match w {
                            BoundaryWarning::Uncertain => "BOUNDARY_UNCERTAIN",
                            BoundaryWarning::LeftEdgeTruncated => "LEFT_EDGE_TRUNCATED",
                            BoundaryWarning::PreRollClipped => "PRE_ROLL_CLIPPED",
                        })
                        .collect(),
                })
                .collect(),
        };
        let mut state = job.state.lock().map_err(|_| internal())?;
        if job.cancelled.load(Ordering::Relaxed)
            || job.proposal_generation.load(Ordering::SeqCst) != generation
        {
            return Err(ApiError::new(
                "REQUEST_SUPERSEDED",
                "a newer request replaced this proposal",
                true,
            ));
        }
        state.proposal = Some(Proposal {
            id: proposal_id,
            revision: expected_revision,
            value: proposal,
        });
        Ok(dto)
    }
    pub fn edit(
        &self,
        catalog: &SharedCatalog,
        root: &RootId,
        window: &str,
        id: &str,
        expected_revision: u64,
        input: SliceEditDto,
    ) -> Result<SliceDraftDto, ApiError> {
        let (job, ready) = self.ready(root, window, id)?;
        let mut history = job.history.lock().map_err(|_| internal())?;
        let undo = matches!(input, SliceEditDto::Undo);
        let redo = matches!(input, SliceEditDto::Redo);
        let edit = match input {
            SliceEditDto::Undo | SliceEditDto::Redo => None,
            SliceEditDto::AcceptProposal { proposal_id } => {
                let state = job.state.lock().map_err(|_| internal())?;
                let proposal = state
                    .proposal
                    .as_ref()
                    .filter(|p| p.id == proposal_id && p.revision == expected_revision)
                    .ok_or_else(conflict)?;
                Some(SliceEdit::AcceptProposal(proposal.value.clone()))
            }
            SliceEditDto::Move { marker_id, frame } => Some(SliceEdit::Move {
                marker_id,
                frame: parse_frame(&frame)?,
            }),
            SliceEditDto::Insert { frame } => Some(SliceEdit::Insert {
                marker_id: self.token("marker"),
                frame: parse_frame(&frame)?,
            }),
            SliceEditDto::Delete { marker_id } => Some(SliceEdit::Delete { marker_id }),
            SliceEditDto::SetLock { marker_id, locked } => {
                Some(SliceEdit::SetLock { marker_id, locked })
            }
        };
        let mut catalog = catalog.lock().map_err(|_| internal())?;
        let draft = catalog
            .load_slice_draft(&ready.binding)
            .map_err(storage_error)?
            .unwrap_or_else(|| SliceDraft::empty(ready.analysis.region()));
        if draft.revision != expected_revision {
            return Err(conflict());
        }
        history.synchronize(draft.revision);
        let updated = if let Some(edit) = edit {
            draft
                .edited(edit, ready.binding.sample_rate)
                .map_err(invalid)?
        } else {
            let stack = if undo { &history.undo } else { &history.redo };
            let mut previous = stack
                .last()
                .cloned()
                .ok_or_else(|| invalid("history is empty"))?;
            previous.revision = draft.revision;
            previous
        };
        if job.cancelled.load(Ordering::Relaxed) {
            return Err(not_found());
        }
        let saved = catalog
            .save_slice_draft(&ready.binding, &updated, expected_revision)
            .map_err(storage_error)?;
        if undo {
            history.undo.pop();
            history.redo.push(draft);
        } else {
            if redo {
                history.redo.pop();
            } else {
                history.redo.clear();
            }
            history.undo.push(draft);
            if history.undo.len() > 20 {
                history.undo.remove(0);
            }
        }
        history.revision = saved.revision;
        Ok(draft_dto(saved, &history))
    }
    pub fn waveform(
        &self,
        root: &RootId,
        window: &str,
        id: &str,
        range: SliceRangeDto,
        points: u32,
    ) -> Result<SliceWaveformDto, ApiError> {
        if points == 0 || points > 4096 {
            return Err(invalid("invalid waveform resolution"));
        }
        let (_, ready) = self.ready(root, window, id)?;
        let range = range.parse()?;
        let pcm = ready.analysis.pcm();
        validate_range(pcm, range)?;
        let count = range.frame_count().min(u64::from(points));
        let mut peaks = vec![Vec::with_capacity(count as usize); usize::from(pcm.source.channels)];
        for bucket in 0..count {
            let first = range.start().get() + range.frame_count() * bucket / count;
            let end = range.start().get() + range.frame_count() * (bucket + 1) / count;
            for (channel, output) in peaks.iter_mut().enumerate() {
                let mut pair = [f32::INFINITY, f32::NEG_INFINITY];
                for n in first..end {
                    let v = pcm.samples[(n - pcm.range.start().get()) as usize
                        * usize::from(pcm.source.channels)
                        + channel];
                    pair[0] = pair[0].min(v);
                    pair[1] = pair[1].max(v);
                }
                output.push(pair);
            }
        }
        Ok(SliceWaveformDto {
            range: range.into(),
            peaks,
        })
    }
    pub fn preview(
        &self,
        root: &RootId,
        window: &str,
        id: &str,
        range: SliceRangeDto,
    ) -> Result<SlicePreviewDto, ApiError> {
        let (job, ready) = self.ready(root, window, id)?;
        let range = range.parse()?;
        let pcm = ready.analysis.pcm();
        validate_range(pcm, range)?;
        let channels = usize::from(pcm.source.channels);
        let size = range.frame_count() * channels as u64 * 4;
        if range.frame_count() > u64::from(pcm.source.sample_rate) * 30 || size > 16 * 1024 * 1024 {
            return Err(invalid("preview exceeds 30 seconds or 16 MiB"));
        }
        let start = (range.start().get() - pcm.range.start().get()) as usize * channels;
        let length = range.frame_count() as usize * channels;
        let bytes = pcm.samples[start..start + length]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let token = self.token("slice-preview");
        let mut previews = job.previews.lock().map_err(|_| internal())?;
        previews.retain(|_, v| v.expires > Instant::now());
        if previews.len() >= 2 {
            return Err(ApiError::new(
                "PREVIEW_BUSY",
                "consume the previous preview first",
                true,
            ));
        }
        previews.insert(
            token.clone(),
            Preview {
                bytes,
                expires: Instant::now() + Duration::from_secs(120),
            },
        );
        Ok(SlicePreviewDto {
            preview_token: token,
            sample_rate: pcm.source.sample_rate,
            channels: pcm.source.channels,
            frame_count: range.frame_count().to_string(),
            byte_length: size as usize,
        })
    }
    pub fn read_preview(
        &self,
        root: &RootId,
        window: &str,
        id: &str,
        token: &str,
    ) -> Result<Vec<u8>, ApiError> {
        let (job, _) = self.ready(root, window, id)?;
        let mut previews = job.previews.lock().map_err(|_| internal())?;
        let preview = previews.remove(token).ok_or_else(not_found)?;
        if preview.expires <= Instant::now() {
            return Err(not_found());
        }
        Ok(preview.bytes)
    }
}

fn build_job(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    job: &Job,
    file_id: &str,
    region: Option<FrameRange>,
) -> Result<Ready, ApiError> {
    let resolved = registry.resolve(&job.root)?;
    let identity = catalog_identity(&resolved.session)?;
    let library = load_library_snapshot(catalog, &identity)?;
    let file = file_for_instance_id(&identity, &library, file_id)?;
    let source = ot_backup::open_root_regular_file(&resolved.canonical_path, &file.relative_path)
        .map_err(|_| invalid("source could not be opened safely"))?;
    let before = source.metadata().map_err(|_| internal())?;
    let snapshot =
        PcmSnapshot::read(&source, &file.content_hash, &job.cancelled).map_err(pcm_error)?;
    let current = ot_backup::open_root_regular_file(&resolved.canonical_path, &file.relative_path)
        .map_err(|_| source_changed())?;
    let after = current.metadata().map_err(|_| source_changed())?;
    if !same_file(&before, &after)
        || !same_file(&before, &source.metadata().map_err(|_| source_changed())?)
    {
        return Err(source_changed());
    }
    registry.resolve(&job.root)?;
    let info = snapshot.info();
    let binding = SliceDraftBinding {
        root: identity,
        relative_path: file.relative_path,
        source_hash: file.content_hash,
        sample_rate: info.sample_rate,
        frame_count: info.frame_count,
    };
    let saved = catalog
        .lock()
        .map_err(|_| internal())?
        .load_slice_draft(&binding)
        .map_err(storage_error)?;
    let full = FrameRange::new(PcmFrame::new(0), PcmFrame::new(info.frame_count))
        .map_err(|_| invalid("empty source"))?;
    let region = region
        .or_else(|| saved.as_ref().map(|d| d.region))
        .unwrap_or(full);
    if saved.as_ref().is_some_and(|d| d.region != region) {
        return Err(region_mismatch());
    }
    let pcm = snapshot
        .analysis_region(region, &job.cancelled)
        .map_err(pcm_error)?;
    {
        let mut state = job.state.lock().map_err(|_| internal())?;
        if job.cancelled.load(Ordering::Relaxed) {
            return Err(not_found());
        }
        state.phase = "analyzing";
    }
    let analysis = OnsetAnalysis::build(pcm, region, binding.source_hash.as_str(), &job.cancelled)
        .map_err(pcm_error)?;
    registry.resolve(&job.root)?;
    Ok(Ready {
        analysis: Arc::new(analysis),
        binding,
    })
}
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if a.dev() != b.dev() || a.ino() != b.ino() {
            return false;
        }
    }
    a.is_file() && b.is_file() && a.len() == b.len() && a.modified().ok() == b.modified().ok()
}
fn status(job: &Job) -> Result<SliceJobDto, ApiError> {
    let state = job.state.lock().map_err(|_| internal())?;
    let pcm = state.ready.as_ref().map(|r| r.analysis.pcm());
    Ok(SliceJobDto {
        job_id: job.id.clone(),
        phase: state.phase,
        error: state.error.clone(),
        sample_rate: pcm.map(|p| p.source.sample_rate),
        channels: pcm.map(|p| p.source.channels),
        frame_count: pcm.map(|p| p.source.frame_count.to_string()),
        region: state.ready.as_ref().map(|r| r.analysis.region().into()),
    })
}
fn load_draft(catalog: &SharedCatalog, ready: &Ready) -> Result<SliceDraft, ApiError> {
    catalog
        .lock()
        .map_err(|_| internal())?
        .load_slice_draft(&ready.binding)
        .map_err(storage_error)
        .map(|d| d.unwrap_or_else(|| SliceDraft::empty(ready.analysis.region())))
}
fn draft_dto(draft: SliceDraft, history: &History) -> SliceDraftDto {
    let mut dto = SliceDraftDto::from(draft);
    dto.can_undo = !history.undo.is_empty();
    dto.can_redo = !history.redo.is_empty();
    dto
}
fn validate_range(pcm: &ot_audio::pcm::PcmRegion, range: FrameRange) -> Result<(), ApiError> {
    if range.start() < pcm.range.start() || range.end_exclusive() > pcm.range.end_exclusive() {
        Err(invalid("range is outside the analyzed PCM"))
    } else {
        Ok(())
    }
}
fn parse_frame(value: &str) -> Result<PcmFrame, ApiError> {
    PcmFrame::parse_decimal(value).map_err(|_| invalid("frame must be a canonical decimal u64"))
}
fn invalid(message: &str) -> ApiError {
    ApiError::new("INVALID_SLICE_REQUEST", message, true)
}
fn region_mismatch() -> ApiError {
    ApiError::new(
        "ANALYSIS_REGION_MISMATCH",
        "existing draft uses a different analysis region",
        true,
    )
}
fn internal() -> ApiError {
    ApiError::new("INTERNAL_ERROR", "slice operation could not complete", true)
}
fn not_found() -> ApiError {
    ApiError::new(
        "ANALYSIS_NOT_FOUND",
        "analysis or preview is unavailable",
        true,
    )
}
fn expired() -> ApiError {
    ApiError::new("ANALYSIS_EXPIRED", "the analysis session has expired", true)
}
fn conflict() -> ApiError {
    ApiError::new(
        "DRAFT_CONFLICT",
        "the draft changed; reload it before editing",
        true,
    )
}
fn source_changed() -> ApiError {
    ApiError::new(
        "SOURCE_CHANGED",
        "source changed; rescan and analyze again",
        true,
    )
}
fn storage_error(error: SliceDraftStoreError) -> ApiError {
    match error {
        SliceDraftStoreError::Conflict => conflict(),
        SliceDraftStoreError::Invalid(message) => invalid(message),
        SliceDraftStoreError::Unavailable(_) => internal(),
    }
}
fn pcm_error(error: PcmError) -> ApiError {
    match error {
        PcmError::Cancelled => ApiError::new("ANALYSIS_CANCELLED", "analysis cancelled", true),
        PcmError::LimitExceeded => ApiError::new(
            "AUDIO_LIMIT_EXCEEDED",
            "source exceeds the current 64 MiB snapshot or PCM allocation limit",
            true,
        ),
        PcmError::Audio(ot_audio::AudioError::SourceChanged) => source_changed(),
        PcmError::Audio(error) => ApiError::new(error.code(), error.to_string(), true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_audio::pcm::{PcmInfo, PcmRegion};
    use ot_catalog::SqliteCatalog;
    use ot_domain::{ContentHash, RootRelativePath};
    use ot_storage_ports::slice_drafts::SliceDraftCatalog;
    use ot_storage_ports::CatalogRootIdentity;

    fn fixture() -> (SliceWorkbench, Arc<Job>, SharedCatalog, tempfile::TempDir) {
        let workbench = SliceWorkbench::new().unwrap();
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(44_100)).unwrap();
        let mut samples = vec![0.0; 44_100];
        samples[101] = 0.5;
        for (i, value) in samples[11_025..11_907].iter_mut().enumerate() {
            *value = (std::f32::consts::TAU * i as f32 * 1000.0 / 44_100.0).cos()
                * 0.7
                * (-(i as f32) / 300.0).exp();
        }
        let analysis = OnsetAnalysis::build(
            PcmRegion {
                source: PcmInfo {
                    sample_rate: 44_100,
                    channels: 1,
                    bits_per_sample: 16,
                    frame_count: 44_100,
                },
                range,
                samples,
            },
            range,
            "synthetic-only",
            &AtomicBool::new(false),
        )
        .unwrap();
        let job = Arc::new(Job {
            id: workbench.token("analysis"),
            root: RootId::new("root-test").unwrap(),
            window: "main".into(),
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            proposal_generation: AtomicU64::new(0),
            state: Mutex::new(JobState {
                phase: "ready",
                error: None,
                proposal: None,
                ready: Some(Ready {
                    analysis: Arc::new(analysis),
                    binding: SliceDraftBinding {
                        root: CatalogRootIdentity::new(format!("rootfp:v1:{}", "1".repeat(64)))
                            .unwrap(),
                        relative_path: RootRelativePath::parse("SET/AUDIO/test.wav").unwrap(),
                        source_hash: ContentHash::parse(format!("sha256:{}", "a".repeat(64)))
                            .unwrap(),
                        sample_rate: 44_100,
                        frame_count: 44_100,
                    },
                }),
            }),
            previews: Mutex::new(HashMap::new()),
            history: Mutex::new(History::default()),
        });
        *workbench.current.lock().unwrap() = Some(Arc::clone(&job));
        let directory = tempfile::tempdir().unwrap();
        let catalog_path = directory
            .path()
            .canonicalize()
            .unwrap()
            .join("catalog.sqlite3");
        let catalog = Arc::new(Mutex::new(SqliteCatalog::open(catalog_path).unwrap()));
        (workbench, job, catalog, directory)
    }
    fn range(start: &str, end: &str) -> SliceRangeDto {
        SliceRangeDto {
            start_frame: start.into(),
            end_exclusive: end.into(),
        }
    }
    fn parameters() -> OnsetParametersDto {
        OnsetParametersDto {
            sensitivity: 50,
            minimum_interval_ms: 35,
            pre_roll_us: 1000,
            silence_floor_db: -72,
            snap_radius_us: 0,
        }
    }
    fn error_code(error: &ApiError) -> String {
        serde_json::to_value(error)
            .expect("serialize ApiError")
            .get("code")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string()
    }
    fn catalog_draft_revision(catalog: &SharedCatalog, job: &Job) -> u64 {
        let binding = job
            .state
            .lock()
            .unwrap()
            .ready
            .as_ref()
            .expect("ready binding")
            .binding
            .clone();
        catalog
            .lock()
            .unwrap()
            .load_slice_draft(&binding)
            .unwrap()
            .expect("catalog draft")
            .revision
    }
    fn accept_first_proposal(
        workbench: &SliceWorkbench,
        catalog: &SharedCatalog,
        job: &Job,
    ) -> SliceDraftDto {
        let proposal = workbench
            .propose(catalog, &job.root, "main", &job.id, 0, parameters())
            .unwrap();
        workbench
            .edit(
                catalog,
                &job.root,
                "main",
                &job.id,
                0,
                SliceEditDto::AcceptProposal {
                    proposal_id: proposal.proposal_id,
                },
            )
            .unwrap()
    }

    #[test]
    fn region_mismatch_uses_structured_error_code() {
        let err = region_mismatch();
        let payload = serde_json::to_value(&err).expect("serialize ApiError for IPC contract");
        assert_eq!(
            payload.get("code").and_then(|value| value.as_str()),
            Some("ANALYSIS_REGION_MISMATCH"),
        );
    }

    #[test]
    fn ownership_one_shot_preview_and_cancellation_are_enforced() {
        let (workbench, job, _, _directory) = fixture();
        assert!(workbench
            .status(&job.root, "other-window", &job.id)
            .is_err());
        assert!(workbench
            .status(&RootId::new("other-root").unwrap(), "main", &job.id)
            .is_err());
        let ticket = workbench
            .preview(&job.root, "main", &job.id, range("101", "102"))
            .unwrap();
        assert_eq!(ticket.frame_count, "1");
        assert!(workbench
            .read_preview(&job.root, "other-window", &job.id, &ticket.preview_token)
            .is_err());
        assert_eq!(
            workbench
                .read_preview(&job.root, "main", &job.id, &ticket.preview_token)
                .unwrap(),
            0.5_f32.to_le_bytes()
        );
        assert!(workbench
            .read_preview(&job.root, "main", &job.id, &ticket.preview_token)
            .is_err());
        let ticket = workbench
            .preview(&job.root, "main", &job.id, range("0", "10"))
            .unwrap();
        workbench.cancel(&job.root, "main", &job.id).unwrap();
        assert_eq!(
            workbench.status(&job.root, "main", &job.id).unwrap().phase,
            "cancelled"
        );
        assert!(job.state.lock().unwrap().ready.is_none());
        assert!(workbench
            .read_preview(&job.root, "main", &job.id, &ticket.preview_token)
            .is_err());
    }

    #[test]
    fn expired_preview_and_invalid_ranges_never_return_pcm() {
        let (workbench, job, _, _directory) = fixture();
        assert!(workbench
            .preview(&job.root, "main", &job.id, range("0", "44101"))
            .is_err());
        assert!(workbench
            .preview(&job.root, "main", &job.id, range("01", "2"))
            .is_err());
        assert!(workbench
            .waveform(&job.root, "main", &job.id, range("0", "100"), 4097)
            .is_err());
        let ticket = workbench
            .preview(&job.root, "main", &job.id, range("0", "1"))
            .unwrap();
        job.previews
            .lock()
            .unwrap()
            .get_mut(&ticket.preview_token)
            .unwrap()
            .expires = Instant::now() - Duration::from_secs(1);
        assert!(workbench
            .read_preview(&job.root, "main", &job.id, &ticket.preview_token)
            .is_err());
        let wave = workbench
            .waveform(&job.root, "main", &job.id, range("100", "102"), 2)
            .unwrap();
        assert_eq!(wave.peaks, vec![vec![[0.0, 0.0], [0.5, 0.5]]]);
    }

    #[test]
    fn undo_redo_preserve_cas_and_rejected_edits_preserve_history() {
        let (workbench, job, catalog, _directory) = fixture();
        let edit =
            |revision, input| workbench.edit(&catalog, &job.root, "main", &job.id, revision, input);
        let inserted = edit(
            0,
            SliceEditDto::Insert {
                frame: "100".into(),
            },
        )
        .unwrap();
        assert_eq!(inserted.revision, 1);
        assert!(inserted.can_undo);
        assert!(edit(
            0,
            SliceEditDto::Delete {
                marker_id: inserted.markers[0].marker_id.clone()
            }
        )
        .is_err());
        let undone = edit(1, SliceEditDto::Undo).unwrap();
        assert_eq!(undone.revision, 2);
        assert!(undone.markers.is_empty());
        assert!(undone.can_redo);
        let redone = edit(2, SliceEditDto::Redo).unwrap();
        assert_eq!(redone.revision, 3);
        assert_eq!(redone.markers[0].start_frame, "100");
        assert!(edit(
            3,
            SliceEditDto::Move {
                marker_id: redone.markers[0].marker_id.clone(),
                frame: "44100".into()
            }
        )
        .is_err());
        assert_eq!(
            workbench
                .draft(&catalog, &job.root, "main", &job.id)
                .unwrap()
                .revision,
            3
        );
    }

    #[test]
    fn proposal_tokens_and_revisions_must_match_before_accepting() {
        let (workbench, job, catalog, _directory) = fixture();
        let first = workbench
            .propose(&catalog, &job.root, "main", &job.id, 0, parameters())
            .unwrap();
        let second = workbench
            .propose(&catalog, &job.root, "main", &job.id, 0, parameters())
            .unwrap();
        assert_ne!(first.proposal_id, second.proposal_id);
        assert!(workbench
            .edit(
                &catalog,
                &job.root,
                "main",
                &job.id,
                0,
                SliceEditDto::AcceptProposal {
                    proposal_id: first.proposal_id
                }
            )
            .is_err());
        let saved = workbench
            .edit(
                &catalog,
                &job.root,
                "main",
                &job.id,
                0,
                SliceEditDto::AcceptProposal {
                    proposal_id: second.proposal_id.clone(),
                },
            )
            .unwrap();
        assert_eq!(saved.revision, 1);
        assert!(workbench
            .edit(
                &catalog,
                &job.root,
                "main",
                &job.id,
                1,
                SliceEditDto::AcceptProposal {
                    proposal_id: second.proposal_id
                }
            )
            .is_err());
    }

    #[test]
    fn deleted_boundaries_are_excluded_from_the_next_preview_as_well_as_acceptance() {
        let (workbench, job, catalog, _directory) = fixture();
        let proposal = workbench
            .propose(&catalog, &job.root, "main", &job.id, 0, parameters())
            .unwrap();
        assert!(proposal.candidate_count > 0);
        let saved = workbench
            .edit(
                &catalog,
                &job.root,
                "main",
                &job.id,
                0,
                SliceEditDto::AcceptProposal {
                    proposal_id: proposal.proposal_id,
                },
            )
            .unwrap();
        let removed = saved.markers.last().unwrap();
        let deleted = workbench
            .edit(
                &catalog,
                &job.root,
                "main",
                &job.id,
                1,
                SliceEditDto::Delete {
                    marker_id: removed.marker_id.clone(),
                },
            )
            .unwrap();
        let next = workbench
            .propose(
                &catalog,
                &job.root,
                "main",
                &job.id,
                deleted.revision,
                parameters(),
            )
            .unwrap();
        assert!(!next
            .candidates
            .iter()
            .any(|c| c.candidate_id == removed.marker_id));
        let accepted = workbench
            .edit(
                &catalog,
                &job.root,
                "main",
                &job.id,
                deleted.revision,
                SliceEditDto::AcceptProposal {
                    proposal_id: next.proposal_id,
                },
            )
            .unwrap();
        assert!(!accepted
            .markers
            .iter()
            .any(|m| m.marker_id == removed.marker_id));
    }

    #[test]
    fn fresh_proposal_accept_persists_catalog_draft() {
        let (workbench, job, catalog, _directory) = fixture();
        let saved = accept_first_proposal(&workbench, &catalog, &job);
        assert_eq!(saved.revision, 1);
        assert_eq!(
            workbench
                .draft(&catalog, &job.root, "main", &job.id)
                .unwrap()
                .revision,
            1
        );
        assert_eq!(catalog_draft_revision(&catalog, &job), 1);
    }

    #[test]
    fn job_ttl_expiry_returns_analysis_expired_and_keeps_catalog_draft() {
        let (workbench, job, catalog, _directory) = fixture();
        let saved = accept_first_proposal(&workbench, &catalog, &job);
        assert_eq!(saved.revision, 1);
        let binding = job
            .state
            .lock()
            .unwrap()
            .ready
            .as_ref()
            .unwrap()
            .binding
            .clone();
        workbench.expire_jobs_for_test();
        assert_eq!(
            error_code(
                &workbench
                    .edit(&catalog, &job.root, "main", &job.id, 1, SliceEditDto::Undo)
                    .unwrap_err()
            ),
            "ANALYSIS_EXPIRED"
        );
        assert_eq!(
            error_code(
                &workbench
                    .propose(&catalog, &job.root, "main", &job.id, 1, parameters())
                    .unwrap_err()
            ),
            "ANALYSIS_EXPIRED"
        );
        let stored = catalog
            .lock()
            .unwrap()
            .load_slice_draft(&binding)
            .unwrap()
            .expect("catalog draft after TTL");
        assert_eq!(stored.revision, 1);
        assert!(!stored.markers.is_empty());
    }

    #[test]
    fn cancel_returns_analysis_not_found_and_keeps_catalog_draft() {
        let (workbench, job, catalog, _directory) = fixture();
        let saved = accept_first_proposal(&workbench, &catalog, &job);
        assert_eq!(saved.revision, 1);
        let binding = job
            .state
            .lock()
            .unwrap()
            .ready
            .as_ref()
            .unwrap()
            .binding
            .clone();
        workbench.cancel(&job.root, "main", &job.id).unwrap();
        assert_eq!(
            error_code(
                &workbench
                    .edit(&catalog, &job.root, "main", &job.id, 1, SliceEditDto::Undo)
                    .unwrap_err()
            ),
            "ANALYSIS_NOT_FOUND"
        );
        let stored = catalog
            .lock()
            .unwrap()
            .load_slice_draft(&binding)
            .unwrap()
            .expect("catalog draft after cancel");
        assert_eq!(stored.revision, 1);
    }

    #[test]
    fn replaced_job_id_returns_analysis_not_found_and_keeps_catalog_draft() {
        let (workbench, job, catalog, _directory) = fixture();
        let saved = accept_first_proposal(&workbench, &catalog, &job);
        assert_eq!(saved.revision, 1);
        let ready = job.state.lock().unwrap().ready.clone();
        let binding = ready.as_ref().unwrap().binding.clone();
        let replacement = Arc::new(Job {
            id: workbench.token("analysis"),
            root: job.root.clone(),
            window: job.window.clone(),
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            proposal_generation: AtomicU64::new(0),
            state: Mutex::new(JobState {
                phase: "ready",
                error: None,
                ready,
                proposal: None,
            }),
            previews: Mutex::new(HashMap::new()),
            history: Mutex::new(History::default()),
        });
        *workbench.current.lock().unwrap() = Some(replacement);
        assert_eq!(
            error_code(
                &workbench
                    .edit(&catalog, &job.root, "main", &job.id, 1, SliceEditDto::Undo)
                    .unwrap_err()
            ),
            "ANALYSIS_NOT_FOUND"
        );
        let stored = catalog
            .lock()
            .unwrap()
            .load_slice_draft(&binding)
            .unwrap()
            .expect("catalog draft after job replace");
        assert_eq!(stored.revision, 1);
    }

    #[test]
    fn expired_preview_token_keeps_analysis_not_found() {
        let (workbench, job, _, _directory) = fixture();
        let ticket = workbench
            .preview(&job.root, "main", &job.id, range("0", "1"))
            .unwrap();
        job.previews
            .lock()
            .unwrap()
            .get_mut(&ticket.preview_token)
            .unwrap()
            .expires = Instant::now() - Duration::from_secs(1);
        assert_eq!(
            error_code(
                &workbench
                    .read_preview(&job.root, "main", &job.id, &ticket.preview_token)
                    .unwrap_err()
            ),
            "ANALYSIS_NOT_FOUND"
        );
    }
}
