use crate::audio_runtime::{AudioRuntimeError, SharedAudioRuntime};
use crate::catalog_runtime::SharedCatalog;
use crate::clone_runtime::{
    CloneAuthorityRecord, CloneProvenance, CloneRuntimeError, CloneSourceEvidenceRecord,
    CloneVerificationState, SharedCloneRuntime,
};
use crate::legacy_read_adapter::RegisteredLegacyLibrary;
use crate::rename_planning_facts::{
    build_rename_planning_facts, ensure_same_directory_rename, verify_catalog_matches_live_scan,
    RenamePlanningFactsError,
};
use crate::rename_write_runtime::{
    RenameApplyRecord, RenameAuthorityRecord, RenameBackupRecord, RenameOperationPhase,
    RenamePrepareRecord, RenameSessionStatus, RenameWriteRuntimeError, SharedRenameWriteRuntime,
};
use crate::root_registry::{ResolvedRoot, RootRegistry, RootRegistryError, RootSession};
use crate::write_runtime::{
    ChangeOperationState, ChangeOperationStatus, SharedWriteRuntime, WriteRuntimeError,
};
use ot_application::{
    ListLibrary, LoadLibrarySnapshot, LoadManualAssetMetadata, ReplaceManualAssetMetadata,
    StoreLibrarySnapshot,
};
use ot_audio::AudioError;
use ot_domain::{
    ContentHash, FileInstance, InvalidManualMetadata, LibraryProject, LibrarySet, LibrarySnapshot,
    ManualAssetMetadata, ManualNote, ManualTag, RenameSampleIntent, RootId, RootRelativePath,
    SampleReferenceStatus, SampleSettingsParseStatus, SampleSlotKind, SampleStorageScope,
    SampleUsageEdge, SampleUsageKind, StateDocumentParseStatus, StateDocumentRole,
};
use ot_executor::OperationId;
use ot_plan::{
    plan_additive_copy, plan_rename_sample, validate_rename_plan_freshness, AdditiveCopyIntent,
    AdditiveCopyPlanningFacts, BlockedRenameImpact, ChangePlan, PlanSeed, RenameBlockReason,
    RenameImpactPlan, RenamePlanningOutcome, RenamePlanningWarning, RenameReferenceUpdate,
    RenameSidecarImpact, RenameStateDocumentImpact, RenameUsageEdgeImpact, RootPlanObservation,
    SourceFileObservation,
};
use ot_storage_ports::{CatalogError, CatalogRootIdentity, CatalogRootObservation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    code: String,
    message: String,
    recoverable: bool,
    details: Option<String>,
}

impl ApiError {
    fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
            details: None,
        }
    }

    fn task_failed(_task: impl std::fmt::Display) -> Self {
        Self {
            code: "INTERNAL_ERROR".into(),
            message: "the operation could not complete".into(),
            recoverable: true,
            details: None,
        }
    }
}

pub(crate) fn cross_domain_recovery_required_error() -> ApiError {
    ApiError::new(
        "RECOVERY_REQUIRED",
        "an incomplete write operation must be resolved before starting another mutation",
        false,
    )
}

impl From<RootRegistryError> for ApiError {
    fn from(error: RootRegistryError) -> Self {
        let message = match &error {
            RootRegistryError::Io(_) => "the registered root could not be inspected".to_string(),
            other => other.to_string(),
        };
        Self::new(error.code(), message, error.recoverable())
    }
}

impl From<AudioRuntimeError> for ApiError {
    fn from(error: AudioRuntimeError) -> Self {
        let message = match &error {
            AudioRuntimeError::Io { .. } | AudioRuntimeError::Entropy(_) => {
                "the audio runtime is temporarily unavailable".to_string()
            }
            AudioRuntimeError::Audio(audio_error) => match audio_error {
                AudioError::SourceUnavailable(_) => "the source sample is unavailable".to_string(),
                AudioError::CacheUnavailable(_) => {
                    "the waveform cache is temporarily unavailable".to_string()
                }
                AudioError::DecodeFailed(_) => "the source sample could not be decoded".to_string(),
                other => other.to_string(),
            },
            other => other.to_string(),
        };
        Self::new(error.code(), message, error.recoverable())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootCapabilitiesDto {
    read: bool,
    write: bool,
    stable_device_identity: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootSessionDto {
    root_id: String,
    display_name: String,
    device_fingerprint: String,
    mode: &'static str,
    observed_revision: u64,
    expires_in_seconds: u64,
    write_grant_expires_in_seconds: Option<u64>,
    capabilities: RootCapabilitiesDto,
}

impl From<RootSession> for RootSessionDto {
    fn from(session: RootSession) -> Self {
        let mode = if session.capabilities.write {
            "write_enabled"
        } else {
            "read_only"
        };
        Self {
            root_id: session.root_id.as_str().to_owned(),
            display_name: session.display_name,
            device_fingerprint: session.device_fingerprint,
            mode,
            observed_revision: session.observed_revision,
            expires_in_seconds: session.expires_in_seconds,
            write_grant_expires_in_seconds: session.write_grant_expires_in_seconds,
            capabilities: RootCapabilitiesDto {
                read: session.capabilities.read,
                write: session.capabilities.write,
                stable_device_identity: session.capabilities.stable_device_identity,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProjectDto {
    display_name: String,
    relative_path: String,
    has_project_file: bool,
    has_banks: bool,
}

impl From<LibraryProject> for LibraryProjectDto {
    fn from(project: LibraryProject) -> Self {
        Self {
            display_name: project.display_name,
            relative_path: project.relative_path.as_str().to_owned(),
            has_project_file: project.has_project_file,
            has_banks: project.has_banks,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySetDto {
    display_name: String,
    relative_path: String,
    has_audio_pool: bool,
    projects: Vec<LibraryProjectDto>,
}

impl From<LibrarySet> for LibrarySetDto {
    fn from(set: LibrarySet) -> Self {
        Self {
            display_name: set.display_name,
            relative_path: set.relative_path.as_str().to_owned(),
            has_audio_pool: set.has_audio_pool,
            projects: set.projects.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshotDto {
    sets: Vec<LibrarySetDto>,
    standalone_projects: Vec<LibraryProjectDto>,
    audio_files: Vec<LibraryAudioFileDto>,
    /// Catalog usage edges (relative paths only). UI5 Usage Graph.
    usage_edges: Vec<SampleUsageEdgeDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleUsageEdgeDto {
    bank_document_relative_path: String,
    project_document_relative_path: String,
    slot_kind: &'static str,
    slot_number: u16,
    usage_kind: &'static str,
    track_index: u8,
    part_index: Option<u8>,
    pattern_index: Option<u8>,
    step_index: Option<u8>,
    audible: bool,
    referenced_file_relative_path: Option<String>,
    reference_status: &'static str,
}

impl SampleUsageEdgeDto {
    fn from_edge(edge: SampleUsageEdge) -> Self {
        Self {
            bank_document_relative_path: edge.bank_document_relative_path.as_str().to_owned(),
            project_document_relative_path: edge.project_document_relative_path.as_str().to_owned(),
            slot_kind: slot_kind_name(edge.slot.kind()),
            slot_number: edge.slot.number(),
            usage_kind: usage_kind_name(edge.usage_kind),
            track_index: edge.track_index,
            part_index: edge.part_index,
            pattern_index: edge.pattern_index,
            step_index: edge.step_index,
            audible: edge.audible,
            referenced_file_relative_path: edge
                .referenced_file_relative_path
                .map(|path| path.as_str().to_owned()),
            reference_status: reference_status_name(edge.reference_status),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAudioFileDto {
    file_instance_id: String,
    asset_id: String,
    display_name: String,
    relative_path: String,
    byte_size: u64,
    storage_scope: &'static str,
}

impl LibraryAudioFileDto {
    fn from_catalog_file(root_identity: &CatalogRootIdentity, file: &FileInstance) -> Self {
        Self {
            file_instance_id: opaque_file_instance_id(root_identity, file),
            asset_id: opaque_asset_id(&file.content_hash),
            display_name: file
                .relative_path
                .as_str()
                .rsplit('/')
                .next()
                .expect("validated relative paths are non-empty")
                .to_owned(),
            relative_path: file.relative_path.as_str().to_owned(),
            byte_size: file.byte_size,
            storage_scope: storage_scope_name(file.storage_scope),
        }
    }
}

impl LibrarySnapshotDto {
    fn from_catalog_snapshot(
        root_identity: &CatalogRootIdentity,
        snapshot: LibrarySnapshot,
    ) -> Self {
        let audio_files = snapshot
            .file_instances
            .iter()
            .map(|file| LibraryAudioFileDto::from_catalog_file(root_identity, file))
            .collect();
        let usage_edges = snapshot
            .usage_edges
            .into_iter()
            .map(SampleUsageEdgeDto::from_edge)
            .collect();
        Self {
            sets: snapshot.sets.into_iter().map(Into::into).collect(),
            standalone_projects: snapshot
                .standalone_projects
                .into_iter()
                .map(Into::into)
                .collect(),
            audio_files,
            usage_edges,
        }
    }
}

fn opaque_file_instance_id(root_identity: &CatalogRootIdentity, file: &FileInstance) -> String {
    opaque_catalog_id(
        "fileinst:v1",
        &[root_identity.as_str(), file.relative_path.as_str()],
    )
}

fn opaque_asset_id(content_hash: &ContentHash) -> String {
    opaque_catalog_id("asset:v1", &[content_hash.as_str()])
}

fn opaque_catalog_id(prefix: &str, values: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    for value in values {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    let digest = hasher.finalize();
    let lowercase_hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{prefix}:{lowercase_hex}")
}

fn storage_scope_name(scope: SampleStorageScope) -> &'static str {
    match scope {
        SampleStorageScope::SetAudioPool => "set_audio_pool",
        SampleStorageScope::ProjectLocal => "project_local",
        SampleStorageScope::Unclassified => "unclassified",
    }
}

fn slot_kind_name(kind: SampleSlotKind) -> &'static str {
    match kind {
        SampleSlotKind::Static => "static",
        SampleSlotKind::Flex => "flex",
    }
}

fn usage_kind_name(kind: SampleUsageKind) -> &'static str {
    match kind {
        SampleUsageKind::Machine => "machine",
        SampleUsageKind::SampleLock => "sample_lock",
    }
}

fn reference_status_name(status: SampleReferenceStatus) -> &'static str {
    match status {
        SampleReferenceStatus::Resolved => "resolved",
        SampleReferenceStatus::Missing => "missing",
        SampleReferenceStatus::InvalidPath => "invalid_path",
        SampleReferenceStatus::UnassignedSlot => "unassigned_slot",
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAssetMetadataDto {
    tags: Vec<String>,
    note: Option<String>,
}

impl From<ManualAssetMetadata> for ManualAssetMetadataDto {
    fn from(metadata: ManualAssetMetadata) -> Self {
        Self {
            tags: metadata
                .tags()
                .iter()
                .map(|tag| tag.as_str().to_owned())
                .collect(),
            note: metadata.note().map(|note| note.as_str().to_owned()),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceManualAssetMetadataDto {
    tags: Vec<String>,
    note: Option<String>,
}

fn parse_manual_asset_metadata(
    input: ReplaceManualAssetMetadataDto,
) -> Result<ManualAssetMetadata, ApiError> {
    let tags = input
        .tags
        .into_iter()
        .map(ManualTag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(manual_metadata_error)?;
    let note = input
        .note
        .map(ManualNote::parse)
        .transpose()
        .map_err(manual_metadata_error)?;
    ManualAssetMetadata::new(tags, note).map_err(manual_metadata_error)
}

fn manual_metadata_error(error: InvalidManualMetadata) -> ApiError {
    ApiError::new("INVALID_MANUAL_METADATA", error.to_string(), true)
}

fn validate_asset_id(asset_id: &str) -> Result<(), ApiError> {
    let digest = asset_id
        .strip_prefix("asset:v1:")
        .ok_or_else(invalid_asset_id)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid_asset_id());
    }
    Ok(())
}

fn invalid_asset_id() -> ApiError {
    ApiError::new(
        "INVALID_ASSET_ID",
        "asset ID must be an opaque asset:v1 identifier",
        false,
    )
}

fn content_hash_for_asset_id(
    snapshot: &LibrarySnapshot,
    asset_id: &str,
) -> Result<ContentHash, ApiError> {
    validate_asset_id(asset_id)?;
    let mut matched: Option<ContentHash> = None;
    for file in &snapshot.file_instances {
        if opaque_asset_id(&file.content_hash) != asset_id {
            continue;
        }
        if let Some(existing) = &matched {
            if existing != &file.content_hash {
                return Err(ApiError::new(
                    "CATALOG_INTEGRITY_ERROR",
                    "the catalog contains an ambiguous asset identity",
                    false,
                ));
            }
        } else {
            matched = Some(file.content_hash.clone());
        }
    }
    matched.ok_or_else(|| {
        ApiError::new(
            "CATALOG_ASSET_NOT_FOUND",
            "the requested audio asset is not present in this root snapshot",
            true,
        )
    })
}

#[derive(Clone, Debug)]
struct LiveAudioSource {
    content_hash: ContentHash,
    absolute_path: PathBuf,
}

fn files_for_asset_id(
    snapshot: &LibrarySnapshot,
    asset_id: &str,
) -> Result<Vec<FileInstance>, ApiError> {
    let content_hash = content_hash_for_asset_id(snapshot, asset_id)?;
    let mut files = snapshot
        .file_instances
        .iter()
        .filter(|file| file.content_hash == content_hash)
        .cloned()
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });
    if files.is_empty() {
        return Err(ApiError::new(
            "CATALOG_INTEGRITY_ERROR",
            "the catalog asset has no file instance",
            false,
        ));
    }
    Ok(files)
}

fn resolve_live_audio_sources(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<Vec<LiveAudioSource>, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    let files = files_for_asset_id(&snapshot, asset_id)?;
    let mut sources = Vec::with_capacity(files.len());
    for file in files {
        match resolved.resolve_regular_file(&file.relative_path) {
            Ok(absolute_path) => sources.push(LiveAudioSource {
                content_hash: file.content_hash,
                absolute_path,
            }),
            Err(RootRegistryError::NotRegularFile) => continue,
            Err(error) => return Err(error.into()),
        }
    }
    if sources.is_empty() {
        return Err(RootRegistryError::NotRegularFile.into());
    }
    Ok(sources)
}

fn with_live_audio_source<T>(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
    mut operation: impl FnMut(&LiveAudioSource) -> Result<T, AudioRuntimeError>,
) -> Result<T, ApiError> {
    let sources = resolve_live_audio_sources(registry, catalog, root_id, asset_id)?;
    let mut source_changed = None;
    let mut source_unavailable = None;
    for source in &sources {
        match operation(source) {
            Ok(result) => return Ok(result),
            Err(error @ AudioRuntimeError::Audio(AudioError::SourceChanged)) => {
                source_changed = Some(error);
            }
            Err(error @ AudioRuntimeError::Audio(AudioError::SourceUnavailable(_))) => {
                source_unavailable = Some(error);
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(source_changed
        .or(source_unavailable)
        .map(ApiError::from)
        .unwrap_or_else(|| RootRegistryError::NotRegularFile.into()))
}

fn resolve_live_asset(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<ContentHash, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    content_hash_for_asset_id(&snapshot, asset_id)
}

fn load_manual_asset_metadata_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let content_hash = resolve_live_asset(registry, catalog, root_id, asset_id)?;
    let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    LoadManualAssetMetadata::new(&*catalog)
        .execute(&content_hash)
        .map(Into::into)
        .map_err(catalog_error)
}

fn replace_manual_asset_metadata_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
    input: ReplaceManualAssetMetadataDto,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let content_hash = resolve_live_asset(registry, catalog, root_id, asset_id)?;
    let metadata = parse_manual_asset_metadata(input)?;
    let mut catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    ReplaceManualAssetMetadata::new(&mut *catalog)
        .execute(&content_hash, &metadata)
        .map_err(catalog_error)?;
    Ok(metadata.into())
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformPeakDto {
    min: f32,
    max: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioWaveformDto {
    analyzer_version: String,
    sample_rate: u32,
    channels: u16,
    frame_count: u64,
    duration_seconds: f64,
    samples_per_peak: u64,
    peaks: Vec<WaveformPeakDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPreviewTokenDto {
    preview_token: String,
    expires_in_seconds: u64,
    mime_type: &'static str,
    byte_length: usize,
    duration_millis: u64,
    truncated: bool,
}

fn get_audio_waveform_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    audio: &SharedAudioRuntime,
    root_id: &RootId,
    asset_id: &str,
    target_points: usize,
) -> Result<AudioWaveformDto, ApiError> {
    let waveform = with_live_audio_source(registry, catalog, root_id, asset_id, |source| {
        audio.waveform(
            asset_id,
            &source.content_hash,
            &source.absolute_path,
            target_points,
        )
    })?;
    Ok(AudioWaveformDto {
        analyzer_version: waveform.analyzer_version.into(),
        sample_rate: waveform.sample_rate,
        channels: waveform.channels,
        frame_count: waveform.frame_count,
        duration_seconds: waveform.duration_seconds(),
        samples_per_peak: waveform.samples_per_peak,
        peaks: waveform
            .peaks
            .into_iter()
            .map(|peak| WaveformPeakDto {
                min: peak.min,
                max: peak.max,
            })
            .collect(),
    })
}

fn create_audio_preview_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    audio: &SharedAudioRuntime,
    root_id: &RootId,
    asset_id: &str,
) -> Result<AudioPreviewTokenDto, ApiError> {
    let ticket = with_live_audio_source(registry, catalog, root_id, asset_id, |source| {
        audio.create_preview_token(
            root_id,
            asset_id,
            &source.content_hash,
            &source.absolute_path,
        )
    })?;
    Ok(AudioPreviewTokenDto {
        preview_token: ticket.token,
        expires_in_seconds: ticket.expires_in_seconds,
        mime_type: "audio/wav",
        byte_length: ticket.byte_length,
        duration_millis: ticket.duration_millis,
        truncated: ticket.truncated,
    })
}

fn read_audio_preview_sync(
    registry: &RootRegistry,
    audio: &SharedAudioRuntime,
    root_id: &RootId,
    preview_token: &str,
) -> Result<Vec<u8>, ApiError> {
    registry.resolve(root_id)?;
    audio
        .read_preview(root_id, preview_token)
        .map_err(Into::into)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePlanDto {
    schema: &'static str,
    plan_id: String,
    operation_id: String,
    operation: &'static str,
    source_relative_path: String,
    destination_relative_path: String,
    byte_size: u64,
    estimated_additional_bytes: u64,
    backup_relative_paths: Vec<String>,
    warnings: Vec<&'static str>,
    requires_explicit_approval: bool,
    overwrite_allowed: bool,
    delete_count: u8,
}

impl From<&ChangePlan> for ChangePlanDto {
    fn from(plan: &ChangePlan) -> Self {
        Self {
            schema: "change-plan:v1",
            plan_id: plan.id.as_str().to_owned(),
            operation_id: OperationId::for_plan(plan).as_str().to_owned(),
            operation: "additive_copy",
            source_relative_path: plan.operation.source.relative_path.as_str().to_owned(),
            destination_relative_path: plan
                .operation
                .destination_relative_path
                .as_str()
                .to_owned(),
            byte_size: plan.operation.source.byte_size,
            estimated_additional_bytes: plan.estimated_additional_bytes,
            backup_relative_paths: plan
                .backup_relative_paths
                .iter()
                .map(|path| path.as_str().to_owned())
                .collect(),
            warnings: vec![
                "Use only a copied or cloned test root; original Octatrack media is not supported.",
                "The source hash, live root identity, and absent destination are checked again at apply time.",
                "This plan creates one file and never overwrites or deletes an existing file.",
            ],
            requires_explicit_approval: true,
            overwrite_allowed: false,
            delete_count: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameBlockReasonDto {
    code: String,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReferenceUpdateDto {
    project_document_relative_path: String,
    slot_kind: &'static str,
    slot_number: u16,
    from_relative_path: String,
    to_relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameStateDocumentImpactDto {
    relative_path: String,
    role: &'static str,
    reference_updates: Vec<RenameReferenceUpdateDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameUsageEdgeImpactDto {
    bank_document_relative_path: String,
    project_document_relative_path: String,
    slot_kind: &'static str,
    slot_number: u16,
    usage_kind: &'static str,
    referenced_file_relative_path: String,
    reference_status: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSidecarImpactDto {
    source_sidecar_relative_path: String,
    destination_sidecar_relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePlanDto {
    schema: &'static str,
    plan_id: String,
    operation_id: String,
    operation: &'static str,
    source_file_instance_id: String,
    source_relative_path: String,
    destination_relative_path: String,
    state_document_impacts: Vec<RenameStateDocumentImpactDto>,
    usage_edge_impacts: Vec<RenameUsageEdgeImpactDto>,
    sidecar_impacts: Vec<RenameSidecarImpactDto>,
    backup_relative_paths: Vec<String>,
    estimated_media_additional_bytes: u64,
    estimated_local_staging_bytes: u64,
    reference_update_count: u64,
    warnings: Vec<String>,
    requires_explicit_approval: bool,
    overwrite_allowed: bool,
    removes_source_on_apply: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedRenamePlanDto {
    schema: &'static str,
    source_relative_path: Option<String>,
    destination_relative_path: String,
    observed_state_document_count: usize,
    observed_usage_edge_count: usize,
    observed_sidecar_count: usize,
    reference_update_count: u64,
    block_reasons: Vec<RenameBlockReasonDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum RenamePlanResponseDto {
    #[serde(rename = "planned")]
    Planned(RenamePlanDto),
    #[serde(rename = "blocked")]
    Blocked(BlockedRenamePlanDto),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAuthorityDto {
    schema: &'static str,
    authority_id: String,
    plan_id: String,
    operation_id: String,
    expires_in_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameBackupStatusDto {
    schema: &'static str,
    plan_id: String,
    snapshot_id: String,
    state: &'static str,
    file_count: u64,
    total_bytes: u64,
    verified: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePrepareStatusDto {
    schema: &'static str,
    plan_id: String,
    operation_id: String,
    snapshot_id: String,
    state: &'static str,
    staged_file_count: u64,
    total_staged_bytes: u64,
    project_rewrite_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameApplyStatusDto {
    schema: &'static str,
    plan_id: String,
    operation_id: String,
    snapshot_id: String,
    mutation_state: String,
    verification_state: String,
    verification_code: Option<String>,
    rescan_completed: bool,
    observed_file_count: u64,
    missing_reference_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameStatusDto {
    schema: &'static str,
    operation_id: String,
    plan_id: Option<String>,
    state: String,
    backup_snapshot_id: Option<String>,
    failure_code: Option<String>,
    plan_expired: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRecoveryStatusDto {
    schema: &'static str,
    recovery_required: bool,
    operations: Vec<RenameStatusDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneSourceEvidenceDto {
    schema: &'static str,
    source_evidence_id: String,
    entry_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedCloneDto {
    schema: &'static str,
    clone_root_id: String,
    clone_verification_id: String,
    entry_count: u64,
    source_root_closed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneVerificationDto {
    schema: &'static str,
    clone_verification_id: String,
    clone_root_id: String,
    provenance: String,
    state: String,
    entry_count: u64,
    expires_in_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneAuthorityDto {
    schema: &'static str,
    clone_authority_id: String,
    clone_verification_id: String,
    expires_in_seconds: u64,
}

fn clone_provenance_name(provenance: CloneProvenance) -> &'static str {
    match provenance {
        CloneProvenance::AppManaged => "app_managed",
        CloneProvenance::External => "external",
    }
}

fn clone_state_name(state: CloneVerificationState) -> &'static str {
    match state {
        CloneVerificationState::Verified => "verified",
        CloneVerificationState::Tampered => "tampered",
        CloneVerificationState::Expired => "expired",
        CloneVerificationState::Revoked => "revoked",
    }
}

fn clone_runtime_error(error: CloneRuntimeError) -> ApiError {
    ApiError::new(
        error.code(),
        error.public_message(),
        matches!(
            error,
            CloneRuntimeError::VerificationExpired
                | CloneRuntimeError::AuthorityExpired
                | CloneRuntimeError::CloneNotVerified
        ),
    )
}

fn ensure_clone_verified(
    clone_runtime: &SharedCloneRuntime,
    resolved: &ResolvedRoot,
) -> Result<(), ApiError> {
    clone_runtime
        .require_verified_root(resolved)
        .map(|_| ())
        .map_err(clone_runtime_error)
}

fn clone_source_evidence_dto(record: &CloneSourceEvidenceRecord) -> CloneSourceEvidenceDto {
    CloneSourceEvidenceDto {
        schema: "clone-source-evidence:v1",
        source_evidence_id: record.source_evidence_id.clone(),
        entry_count: record.entry_count,
    }
}

fn clone_verification_dto(
    clone_root_id: &str,
    verification_id: &str,
    provenance: CloneProvenance,
    state: CloneVerificationState,
    entry_count: u64,
    expires_in_seconds: u64,
) -> CloneVerificationDto {
    CloneVerificationDto {
        schema: "clone-verification:v1",
        clone_verification_id: verification_id.to_owned(),
        clone_root_id: clone_root_id.to_owned(),
        provenance: clone_provenance_name(provenance).to_owned(),
        state: clone_state_name(state).to_owned(),
        entry_count,
        expires_in_seconds,
    }
}

fn clone_authority_dto(
    record: &CloneAuthorityRecord,
    expires_in_seconds: u64,
) -> CloneAuthorityDto {
    CloneAuthorityDto {
        schema: "clone-authority:v1",
        clone_authority_id: record.clone_authority_id.clone(),
        clone_verification_id: record.clone_verification_id.clone(),
        expires_in_seconds,
    }
}

pub(crate) fn record_clone_source_evidence_sync(
    registry: &RootRegistry,
    clone_runtime: &SharedCloneRuntime,
    root_id: &RootId,
) -> Result<CloneSourceEvidenceDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let record = clone_runtime
        .record_source_evidence(&resolved)
        .map_err(clone_runtime_error)?;
    Ok(clone_source_evidence_dto(&record))
}

pub(crate) fn create_managed_clone_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    clone_runtime: &SharedCloneRuntime,
    source_root_id: &RootId,
) -> Result<ManagedCloneDto, ApiError> {
    let source = registry.resolve(source_root_id)?;
    let host_observation = registry.stored_observation_for_root(source_root_id)?;
    let source_snapshot = scan_baseline_before(source.canonical_path.as_path());
    let (clone_path, managed_token, entries) = clone_runtime
        .create_managed_clone(registry, &source)
        .map_err(clone_runtime_error)?;
    verify_baseline_unchanged(&source.canonical_path, &source_snapshot)?;
    let clone_surface_id = crate::clone_runtime::derive_root_surface_id(&clone_path);
    let clone_session = registry
        .register_managed_clone(
            clone_path.to_str().unwrap(),
            &host_observation,
            &managed_token,
            &clone_surface_id,
            &clone_runtime.managed_clones_root(),
            "",
            entries.len() as u64,
        )
        .map_err(ApiError::from)?;
    let clone_root_id = clone_session.root_id.clone();
    let (resolved_session, snapshot) = scan_library_sync(registry, catalog, &clone_root_id)
        .inspect_err(|_| {
            let _ = registry.close(&clone_root_id);
        })?;
    if snapshot.sets.is_empty() && snapshot.standalone_projects.is_empty() {
        let _ = registry.close(&clone_root_id);
        return Err(ApiError::new(
            "UNSUPPORTED_FORMAT",
            "the selected folder does not contain an Octatrack Set or Project",
            true,
        ));
    }
    store_library_snapshot(
        registry,
        catalog,
        &clone_root_id,
        &resolved_session,
        &snapshot,
    )
    .inspect_err(|_| {
        let _ = registry.close(&clone_root_id);
    })?;
    let clone = registry.resolve(&clone_root_id)?;
    let verification = clone_runtime
        .verify_managed_clone_registration(&source, &clone, &entries, &managed_token)
        .map_err(clone_runtime_error)?;
    let source_closed = registry.close(source_root_id).is_ok();
    Ok(ManagedCloneDto {
        schema: "managed-clone:v1",
        clone_root_id: clone_root_id.as_str().to_owned(),
        clone_verification_id: verification.clone_verification_id,
        entry_count: verification.baseline_entry_count,
        source_root_closed: source_closed,
    })
}

pub(crate) fn verify_external_clone_sync(
    registry: &RootRegistry,
    clone_runtime: &SharedCloneRuntime,
    root_id: &RootId,
    source_evidence_id: String,
    acknowledged_disposable_clone: bool,
) -> Result<CloneVerificationDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let source_evidence = clone_runtime
        .load_source_evidence(&source_evidence_id)
        .map_err(clone_runtime_error)?;
    let verification = clone_runtime
        .verify_external_clone(&resolved, &source_evidence, acknowledged_disposable_clone)
        .map_err(clone_runtime_error)?;
    Ok(clone_verification_dto(
        verification.clone_root_id.as_str(),
        verification.clone_verification_id.as_str(),
        verification.provenance,
        verification.state,
        verification.baseline_entry_count,
        verification
            .expires_at_unix
            .saturating_sub(crate::clone_runtime::current_unix_time()),
    ))
}

pub(crate) fn clone_verification_status_sync(
    registry: &RootRegistry,
    clone_runtime: &SharedCloneRuntime,
    root_id: &RootId,
) -> Result<Option<CloneVerificationDto>, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let status = clone_runtime
        .verification_status(&resolved)
        .map_err(clone_runtime_error)?;
    Ok(status.map(|status| {
        clone_verification_dto(
            status.clone_root_id.as_str(),
            status.clone_verification_id.as_str(),
            status.provenance,
            status.state,
            status.entry_count,
            status.expires_in_seconds,
        )
    }))
}

pub(crate) fn clone_reverify_sync(
    registry: &RootRegistry,
    clone_runtime: &SharedCloneRuntime,
    root_id: &RootId,
) -> Result<CloneVerificationDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let verification = clone_runtime
        .reverify_root(&resolved)
        .map_err(clone_runtime_error)?;
    Ok(clone_verification_dto(
        verification.clone_root_id.as_str(),
        verification.clone_verification_id.as_str(),
        verification.provenance,
        verification.state,
        verification.baseline_entry_count,
        verification
            .expires_at_unix
            .saturating_sub(crate::clone_runtime::current_unix_time()),
    ))
}

pub(crate) fn clone_issue_authority_sync(
    registry: &RootRegistry,
    clone_runtime: &SharedCloneRuntime,
    root_id: &RootId,
) -> Result<CloneAuthorityDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let authority = clone_runtime
        .issue_clone_authority(&resolved)
        .map_err(clone_runtime_error)?;
    Ok(clone_authority_dto(
        &authority,
        authority
            .expires_at_unix
            .saturating_sub(crate::clone_runtime::current_unix_time()),
    ))
}

fn scan_baseline_before(path: &Path) -> Vec<(String, u64, String)> {
    crate::clone_runtime::scan_baseline_entries(path)
        .unwrap_or_default()
        .into_iter()
        .map(|entry| (entry.relative_path, entry.byte_size, entry.content_hash))
        .collect()
}

fn verify_baseline_unchanged(
    path: &Path,
    before: &[(String, u64, String)],
) -> Result<(), ApiError> {
    let after = scan_baseline_before(path);
    if before != after {
        return Err(ApiError::new(
            "CLONE_SOURCE_CHANGED",
            "source tree changed during managed clone creation",
            false,
        ));
    }
    Ok(())
}

fn rename_plan_from_impact(plan: &RenameImpactPlan) -> RenamePlanDto {
    RenamePlanDto {
        schema: "rename-plan:v1",
        plan_id: plan.id.as_str().to_owned(),
        operation_id: OperationId::for_rename_plan(plan).as_str().to_owned(),
        operation: "rename_sample",
        source_file_instance_id: plan.source_file_instance_id.as_str().to_owned(),
        source_relative_path: plan.source_relative_path.as_str().to_owned(),
        destination_relative_path: plan.destination_relative_path.as_str().to_owned(),
        state_document_impacts: plan
            .state_document_impacts
            .iter()
            .map(rename_state_document_impact_dto)
            .collect(),
        usage_edge_impacts: plan
            .usage_edge_impacts
            .iter()
            .map(rename_usage_edge_impact_dto)
            .collect(),
        sidecar_impacts: plan
            .sidecar_impacts
            .iter()
            .map(rename_sidecar_impact_dto)
            .collect(),
        backup_relative_paths: plan
            .backup_relative_paths
            .iter()
            .map(|path| path.as_str().to_owned())
            .collect(),
        estimated_media_additional_bytes: plan.estimated_media_additional_bytes,
        estimated_local_staging_bytes: plan.estimated_local_staging_bytes,
        reference_update_count: plan.reference_update_count,
        warnings: plan.warnings.iter().map(rename_warning_message).collect(),
        requires_explicit_approval: true,
        overwrite_allowed: false,
        removes_source_on_apply: true,
    }
}

fn blocked_rename_plan_from_impact(blocked: &BlockedRenameImpact) -> BlockedRenamePlanDto {
    BlockedRenamePlanDto {
        schema: "rename-blocked:v1",
        source_relative_path: blocked
            .source_relative_path
            .as_ref()
            .map(|path| path.as_str().to_owned()),
        destination_relative_path: blocked.destination_relative_path.as_str().to_owned(),
        observed_state_document_count: blocked.observed_state_document_count,
        observed_usage_edge_count: blocked.observed_usage_edge_count,
        observed_sidecar_count: blocked.observed_sidecar_count,
        reference_update_count: blocked.reference_update_count,
        block_reasons: blocked
            .block_reasons
            .iter()
            .map(rename_block_reason_dto)
            .collect(),
    }
}

fn rename_state_document_impact_dto(
    impact: &RenameStateDocumentImpact,
) -> RenameStateDocumentImpactDto {
    RenameStateDocumentImpactDto {
        relative_path: impact.relative_path.as_str().to_owned(),
        role: state_document_role_name(impact.role),
        reference_updates: impact
            .reference_updates
            .iter()
            .map(rename_reference_update_dto)
            .collect(),
    }
}

fn rename_reference_update_dto(update: &RenameReferenceUpdate) -> RenameReferenceUpdateDto {
    RenameReferenceUpdateDto {
        project_document_relative_path: update.project_document_relative_path.as_str().to_owned(),
        slot_kind: slot_kind_name(update.slot.kind()),
        slot_number: update.slot.number(),
        from_relative_path: update.from_relative_path.as_str().to_owned(),
        to_relative_path: update.to_relative_path.as_str().to_owned(),
    }
}

fn rename_usage_edge_impact_dto(edge: &RenameUsageEdgeImpact) -> RenameUsageEdgeImpactDto {
    RenameUsageEdgeImpactDto {
        bank_document_relative_path: edge.bank_document_relative_path.as_str().to_owned(),
        project_document_relative_path: edge.project_document_relative_path.as_str().to_owned(),
        slot_kind: slot_kind_name(edge.slot.kind()),
        slot_number: edge.slot.number(),
        usage_kind: usage_kind_name(edge.usage_kind),
        referenced_file_relative_path: edge.referenced_file_relative_path.as_str().to_owned(),
        reference_status: reference_status_name(edge.reference_status),
    }
}

fn rename_sidecar_impact_dto(impact: &RenameSidecarImpact) -> RenameSidecarImpactDto {
    RenameSidecarImpactDto {
        source_sidecar_relative_path: impact.source_sidecar_relative_path.as_str().to_owned(),
        destination_sidecar_relative_path: impact
            .destination_sidecar_relative_path
            .as_str()
            .to_owned(),
    }
}

fn rename_warning_message(warning: &RenamePlanningWarning) -> String {
    match warning {
        RenamePlanningWarning::UnusedSample {
            source_relative_path,
        } => format!(
            "Sample at {} is not referenced by any resolved slot assignment.",
            source_relative_path.as_str()
        ),
    }
}

fn rename_block_reason_dto(reason: &RenameBlockReason) -> RenameBlockReasonDto {
    RenameBlockReasonDto {
        code: rename_block_reason_code(reason).to_owned(),
        message: reason.to_string(),
    }
}

fn rename_block_reason_code(reason: &RenameBlockReason) -> &'static str {
    match reason {
        RenameBlockReason::RootMismatch => "ROOT_MISMATCH",
        RenameBlockReason::UnstableRootIdentity => "UNSTABLE_ROOT_IDENTITY",
        RenameBlockReason::InvalidRootFingerprint => "INVALID_ROOT_FINGERPRINT",
        RenameBlockReason::ScanNotCompleted => "SCAN_NOT_COMPLETED",
        RenameBlockReason::InvalidObservedRevision => "INVALID_OBSERVED_REVISION",
        RenameBlockReason::CatalogRevisionMismatch => "CATALOG_REVISION_MISMATCH",
        RenameBlockReason::SourceIdentityMismatch => "SOURCE_IDENTITY_MISMATCH",
        RenameBlockReason::SourcePathMismatch => "SOURCE_PATH_MISMATCH",
        RenameBlockReason::SourceSizeMismatch => "SOURCE_SIZE_MISMATCH",
        RenameBlockReason::SourceHashMismatch => "SOURCE_HASH_MISMATCH",
        RenameBlockReason::StaleSourceHashFreshness => "STALE_SOURCE_HASH_FRESHNESS",
        RenameBlockReason::SourceEqualsDestination => "SOURCE_EQUALS_DESTINATION",
        RenameBlockReason::DestinationObservationMismatch => "DESTINATION_OBSERVATION_MISMATCH",
        RenameBlockReason::DestinationOccupied => "DESTINATION_OCCUPIED",
        RenameBlockReason::DestinationCaseCollision => "DESTINATION_CASE_COLLISION",
        RenameBlockReason::DestinationNormalizationCollision => {
            "DESTINATION_NORMALIZATION_COLLISION"
        }
        RenameBlockReason::DestinationUnsafePath => "DESTINATION_UNSAFE_PATH",
        RenameBlockReason::DestinationIncomparable => "DESTINATION_INCOMPARABLE",
        RenameBlockReason::SidecarDestinationObservationMismatch => {
            "SIDECAR_DESTINATION_OBSERVATION_MISMATCH"
        }
        RenameBlockReason::SidecarDestinationOccupied => "SIDECAR_DESTINATION_OCCUPIED",
        RenameBlockReason::SidecarDestinationCaseCollision => "SIDECAR_DESTINATION_CASE_COLLISION",
        RenameBlockReason::SidecarDestinationNormalizationCollision => {
            "SIDECAR_DESTINATION_NORMALIZATION_COLLISION"
        }
        RenameBlockReason::SidecarDestinationUnsafePath => "SIDECAR_DESTINATION_UNSAFE_PATH",
        RenameBlockReason::SidecarDestinationIncomparable => "SIDECAR_DESTINATION_INCOMPARABLE",
        RenameBlockReason::UnsupportedStateDocument => "UNSUPPORTED_STATE_DOCUMENT",
        RenameBlockReason::MalformedStateDocument => "MALFORMED_STATE_DOCUMENT",
        RenameBlockReason::UnsupportedSidecar => "UNSUPPORTED_SIDECAR",
        RenameBlockReason::MalformedSidecar => "MALFORMED_SIDECAR",
        RenameBlockReason::AmbiguousSidecarOwnership => "AMBIGUOUS_SIDECAR_OWNERSHIP",
        RenameBlockReason::IncompleteUsageGraph => "INCOMPLETE_USAGE_GRAPH",
        RenameBlockReason::IncompleteSetProjectCoverage => "INCOMPLETE_SET_PROJECT_COVERAGE",
        RenameBlockReason::UnresolvedReference => "UNRESOLVED_REFERENCE",
        RenameBlockReason::DestinationReferencedByUnresolvedSlot => {
            "DESTINATION_REFERENCED_BY_UNRESOLVED_SLOT"
        }
        RenameBlockReason::DestinationAlreadyReferenced => "DESTINATION_ALREADY_REFERENCED",
        RenameBlockReason::IncompleteReferenceUpdateSet => "INCOMPLETE_REFERENCE_UPDATE_SET",
        RenameBlockReason::ArithmeticOverflow => "ARITHMETIC_OVERFLOW",
    }
}

fn state_document_role_name(role: StateDocumentRole) -> &'static str {
    match role {
        StateDocumentRole::Working => "working",
        StateDocumentRole::SavedCheckpoint => "saved_checkpoint",
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeStatusDto {
    schema: &'static str,
    operation_id: String,
    plan_id: String,
    state: &'static str,
    recovery_required: bool,
    catalog_refresh_required: bool,
    failure_code: Option<String>,
    backup_snapshot_id: Option<String>,
}

impl From<ChangeOperationStatus> for ChangeStatusDto {
    fn from(status: ChangeOperationStatus) -> Self {
        let state = match status.state {
            ChangeOperationState::Planned => "planned",
            ChangeOperationState::Applying => "applying",
            ChangeOperationState::Committed => "committed",
            ChangeOperationState::RolledBack => "rolled_back",
            ChangeOperationState::Failed => "failed",
            ChangeOperationState::RecoveryRequired => "recovery_required",
        };
        Self {
            schema: "change-status:v1",
            operation_id: status.operation_id.as_str().to_owned(),
            plan_id: status.plan_id.as_str().to_owned(),
            state,
            recovery_required: status.state == ChangeOperationState::RecoveryRequired,
            catalog_refresh_required: status.catalog_refresh_required,
            failure_code: status.failure_code,
            backup_snapshot_id: status.backup_snapshot_id,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRecoveryStatusDto {
    schema: &'static str,
    recovery_required: bool,
    operations: Vec<ChangeStatusDto>,
}

fn validate_file_instance_id(file_instance_id: &str) -> Result<(), ApiError> {
    let digest = file_instance_id
        .strip_prefix("fileinst:v1:")
        .ok_or_else(invalid_file_instance_id)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid_file_instance_id());
    }
    Ok(())
}

fn invalid_file_instance_id() -> ApiError {
    ApiError::new(
        "INVALID_FILE_INSTANCE_ID",
        "file instance ID must be an opaque fileinst:v1 identifier",
        false,
    )
}

fn file_for_instance_id(
    identity: &CatalogRootIdentity,
    snapshot: &LibrarySnapshot,
    file_instance_id: &str,
) -> Result<FileInstance, ApiError> {
    validate_file_instance_id(file_instance_id)?;
    let mut matches = snapshot
        .file_instances
        .iter()
        .filter(|file| opaque_file_instance_id(identity, file) == file_instance_id);
    let file = matches.next().cloned().ok_or_else(|| {
        ApiError::new(
            "CATALOG_FILE_NOT_FOUND",
            "the requested file instance is not present in this root snapshot",
            true,
        )
    })?;
    if matches.next().is_some() {
        return Err(ApiError::new(
            "CATALOG_INTEGRITY_ERROR",
            "the catalog contains an ambiguous file instance identity",
            false,
        ));
    }
    Ok(file)
}

fn ensure_write_eligible(snapshot: &LibrarySnapshot) -> Result<(), ApiError> {
    let unsupported_state = snapshot
        .state_documents
        .iter()
        .any(|document| document.parse_status != StateDocumentParseStatus::Parsed);
    let unsupported_settings = snapshot
        .sample_settings
        .iter()
        .any(|settings| settings.parse_status != SampleSettingsParseStatus::Parsed);
    if unsupported_state || unsupported_settings {
        return Err(ApiError::new(
            "WRITE_NOT_SUPPORTED",
            "write mode is unavailable while the catalog contains unsupported or malformed state",
            true,
        ));
    }
    Ok(())
}

fn destination_scope(
    snapshot: &LibrarySnapshot,
    destination: &RootRelativePath,
) -> SampleStorageScope {
    let candidate = destination.as_str();
    for set in &snapshot.sets {
        let pool = format!("{}/AUDIO/", set.relative_path.as_str());
        if candidate.starts_with(&pool) {
            return SampleStorageScope::SetAudioPool;
        }
    }
    for project in snapshot
        .sets
        .iter()
        .flat_map(|set| set.projects.iter())
        .chain(snapshot.standalone_projects.iter())
    {
        let prefix = format!("{}/", project.relative_path.as_str());
        if candidate.starts_with(&prefix) {
            return SampleStorageScope::ProjectLocal;
        }
    }
    SampleStorageScope::Unclassified
}

fn ensure_matching_audio_extension(
    source: &RootRelativePath,
    destination: &RootRelativePath,
) -> Result<(), ApiError> {
    let source_extension = Path::new(source.as_str())
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    let destination_extension = Path::new(destination.as_str())
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if source_extension
        .as_deref()
        .is_none_or(|extension| !matches!(extension, "wav" | "aif" | "aiff"))
        || source_extension != destination_extension
    {
        return Err(ApiError::new(
            "INVALID_DESTINATION_PATH",
            "destination must keep the source sample file extension",
            true,
        ));
    }
    Ok(())
}

fn ensure_visible_destination(destination: &RootRelativePath) -> Result<(), ApiError> {
    if destination
        .as_str()
        .split('/')
        .any(|component| component.starts_with('.'))
    {
        return Err(ApiError::new(
            "INVALID_DESTINATION_PATH",
            "destination must not contain hidden or AppleDouble path components",
            true,
        ));
    }
    Ok(())
}

fn ensure_destination_absent(
    resolved: &ResolvedRoot,
    destination: &RootRelativePath,
) -> Result<(), ApiError> {
    let components = destination.as_str().split('/').collect::<Vec<_>>();
    let mut candidate = resolved.canonical_path.clone();
    for (index, component) in components.iter().enumerate() {
        candidate.push(component);
        let is_last = index + 1 == components.len();
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(RootRegistryError::SymlinkEscape.into());
            }
            Ok(_) if is_last => {
                return Err(ApiError::new(
                    "DESTINATION_EXISTS",
                    "additive copy destination already exists",
                    true,
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(ApiError::new(
                    "INVALID_DESTINATION_PATH",
                    "destination parent is not a directory",
                    true,
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && is_last => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ApiError::new(
                    "INVALID_DESTINATION_PATH",
                    "destination parent directory does not exist",
                    true,
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(RootRegistryError::PermissionDenied.into());
            }
            Err(_) => return Err(RootRegistryError::Unavailable.into()),
        }
    }
    Err(ApiError::new(
        "INVALID_DESTINATION_PATH",
        "destination path is invalid",
        true,
    ))
}

fn hash_live_source(path: &Path) -> Result<(u64, ContentHash), ApiError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| RootRegistryError::NotRegularFile)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(RootRegistryError::NotRegularFile.into());
    }
    let mut file = open_regular_file_nofollow(path)?;
    let before = file
        .metadata()
        .map_err(|_| RootRegistryError::NotRegularFile)?;
    if !before.is_file() {
        return Err(RootRegistryError::NotRegularFile.into());
    }
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| {
            ApiError::new(
                "AUDIO_SOURCE_UNAVAILABLE",
                "the source sample could not be read",
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        bytes = bytes.checked_add(read as u64).ok_or_else(|| {
            ApiError::new("FILE_TOO_LARGE", "the source sample is too large", false)
        })?;
        hasher.update(&buffer[..read]);
    }
    let after = file
        .metadata()
        .map_err(|_| RootRegistryError::NotRegularFile)?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || bytes != after.len()
    {
        return Err(ApiError::new(
            "PLAN_STALE",
            "the source sample changed while the plan was created",
            true,
        ));
    }
    ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
        .map(|hash| (bytes, hash))
        .map_err(|_| ApiError::new("INTERNAL_ERROR", "could not hash the source sample", false))
}

fn open_regular_file_nofollow(path: &Path) -> Result<File, ApiError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|_| RootRegistryError::NotRegularFile.into())
    }
    #[cfg(not(unix))]
    {
        let metadata = fs::symlink_metadata(path).map_err(|_| RootRegistryError::NotRegularFile)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(RootRegistryError::NotRegularFile.into());
        }
        File::open(path).map_err(|_| RootRegistryError::NotRegularFile.into())
    }
}

fn enable_write_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    write: &SharedWriteRuntime,
    root_id: &RootId,
) -> Result<RootSessionDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let recovery = write
        .recovery_required(&resolved.session.device_fingerprint)
        .map_err(write_runtime_error)?;
    if !recovery.is_empty() {
        return Err(ApiError::new(
            "RECOVERY_REQUIRED",
            "an incomplete write operation must be resolved before enabling write mode",
            false,
        ));
    }
    let (live_session, live_snapshot) = scan_library_sync(registry, catalog, root_id)?;
    store_library_snapshot(registry, catalog, root_id, &live_session, &live_snapshot)?;
    ensure_write_eligible(&live_snapshot)?;
    registry
        .enable_write(root_id)
        .map(Into::into)
        .map_err(Into::into)
}

fn disable_write_sync(
    registry: &RootRegistry,
    root_id: &RootId,
) -> Result<RootSessionDto, ApiError> {
    // Resolve first so an expired/removed root fails closed the same way as status.
    registry.resolve(root_id)?;
    registry
        .disable_write(root_id)
        .map(Into::into)
        .map_err(Into::into)
}

fn plan_additive_copy_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    write: &SharedWriteRuntime,
    root_id: &RootId,
    source_file_instance_id: &str,
    destination_relative_path: &str,
) -> Result<ChangePlanDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    ensure_write_eligible(&snapshot)?;
    let source = file_for_instance_id(&identity, &snapshot, source_file_instance_id)?;
    if source.storage_scope == SampleStorageScope::Unclassified {
        return Err(ApiError::new(
            "WRITE_NOT_SUPPORTED",
            "unclassified sample locations remain read-only",
            true,
        ));
    }
    let destination = RootRelativePath::parse(destination_relative_path)
        .map_err(|error| ApiError::new("INVALID_DESTINATION_PATH", error.to_string(), true))?;
    ensure_visible_destination(&destination)?;
    if destination_scope(&snapshot, &destination) == SampleStorageScope::Unclassified {
        return Err(ApiError::new(
            "INVALID_DESTINATION_PATH",
            "destination must be inside an indexed Set Audio Pool or Project",
            true,
        ));
    }
    ensure_matching_audio_extension(&source.relative_path, &destination)?;
    ensure_destination_absent(&resolved, &destination)?;
    let source_path = resolved.resolve_regular_file(&source.relative_path)?;
    let (byte_size, content_hash) = hash_live_source(&source_path)?;
    if byte_size != source.byte_size || content_hash != source.content_hash {
        return Err(ApiError::new(
            "CATALOG_STALE",
            "the source sample no longer matches the catalog; re-register the root before planning",
            true,
        ));
    }
    let mut seed = [0_u8; 32];
    getrandom::fill(&mut seed).map_err(|_| {
        ApiError::new(
            "WRITE_RUNTIME_UNAVAILABLE",
            "secure plan identity could not be generated",
            false,
        )
    })?;
    let plan = plan_additive_copy(
        &AdditiveCopyIntent {
            root_id: root_id.clone(),
            source_relative_path: source.relative_path.clone(),
            destination_relative_path: destination,
        },
        &AdditiveCopyPlanningFacts {
            plan_seed: PlanSeed::new(seed),
            root: RootPlanObservation {
                root_id: root_id.clone(),
                device_fingerprint: resolved.session.device_fingerprint,
                observed_revision: resolved.session.observed_revision,
                identity_is_stable: resolved.session.capabilities.stable_device_identity,
            },
            source: SourceFileObservation {
                relative_path: source.relative_path,
                byte_size,
                content_hash,
            },
            destination_exists: false,
        },
    )
    .map_err(|error| ApiError::new("INVALID_CHANGE_PLAN", error.to_string(), true))?;
    write
        .store_plan(plan.clone())
        .map_err(write_runtime_error)?;
    Ok((&plan).into())
}

fn rename_planning_facts_error(error: RenamePlanningFactsError) -> ApiError {
    ApiError::new(error.code(), error.to_string(), true)
}

pub(crate) fn rename_runtime_error(error: RenameWriteRuntimeError) -> ApiError {
    let recoverable = !matches!(
        error,
        RenameWriteRuntimeError::InvalidPlan | RenameWriteRuntimeError::PlanIntegrityMismatch
    );
    ApiError::new(error.code(), error.to_string(), recoverable)
}

fn latest_completed_scan_revision(
    catalog: &SharedCatalog,
    fingerprint: &str,
) -> Result<u64, ApiError> {
    use ot_storage_ports::{CatalogScanStatus, LibraryCatalog};

    let identity = CatalogRootIdentity::new(fingerprint.to_string()).map_err(catalog_error)?;
    let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    let scan = catalog
        .latest_scan(&identity)
        .map_err(catalog_error)?
        .ok_or_else(|| {
            ApiError::new(
                "CATALOG_NOT_INDEXED",
                "no successful catalog snapshot is available for this root",
                true,
            )
        })?;
    if scan.status != CatalogScanStatus::Completed {
        return Err(ApiError::new(
            "CATALOG_NOT_INDEXED",
            "no successful catalog snapshot is available for this root",
            true,
        ));
    }
    Ok(scan.revision.get())
}

pub(crate) fn plan_rename_sample_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    clone_runtime: &SharedCloneRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    source_file_instance_id: &str,
    destination_relative_path: &str,
) -> Result<RenamePlanResponseDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    ensure_clone_verified(clone_runtime, &resolved)?;
    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    let source = file_for_instance_id(&identity, &snapshot, source_file_instance_id)?;
    if source.storage_scope == SampleStorageScope::Unclassified {
        return Err(ApiError::new(
            "WRITE_NOT_SUPPORTED",
            "unclassified sample locations remain read-only",
            true,
        ));
    }
    let destination = RootRelativePath::parse(destination_relative_path)
        .map_err(|error| ApiError::new("INVALID_DESTINATION_PATH", error.to_string(), true))?;
    ensure_visible_destination(&destination)?;
    if destination_scope(&snapshot, &destination) == SampleStorageScope::Unclassified {
        return Err(ApiError::new(
            "INVALID_DESTINATION_PATH",
            "destination must be inside an indexed Set Audio Pool or Project",
            true,
        ));
    }
    ensure_matching_audio_extension(&source.relative_path, &destination)?;
    ensure_same_directory_rename(&source.relative_path, &destination)
        .map_err(rename_planning_facts_error)?;
    if source.relative_path == destination {
        return Ok(RenamePlanResponseDto::Blocked(
            blocked_rename_plan_from_impact(&BlockedRenameImpact {
                source_relative_path: Some(source.relative_path.clone()),
                destination_relative_path: destination,
                observed_state_document_count: snapshot.state_documents.len(),
                observed_usage_edge_count: snapshot.usage_edges.len(),
                observed_sidecar_count: snapshot
                    .sample_settings
                    .iter()
                    .filter(|settings| {
                        settings.file_instance_relative_path.as_ref() == Some(&source.relative_path)
                    })
                    .count(),
                reference_update_count: 0,
                block_reasons: vec![RenameBlockReason::SourceEqualsDestination],
            }),
        ));
    }
    if destination_exists_live(&resolved, &destination)? {
        return Ok(RenamePlanResponseDto::Blocked(
            blocked_rename_plan_from_impact(&BlockedRenameImpact {
                source_relative_path: Some(source.relative_path.clone()),
                destination_relative_path: destination,
                observed_state_document_count: snapshot.state_documents.len(),
                observed_usage_edge_count: snapshot.usage_edges.len(),
                observed_sidecar_count: 0,
                reference_update_count: 0,
                block_reasons: vec![RenameBlockReason::DestinationOccupied],
            }),
        ));
    }

    let scan_revision =
        latest_completed_scan_revision(catalog, resolved.session.device_fingerprint.as_str())?;
    let live_snapshot = scan_library_snapshot_sync(registry, catalog, root_id)?;
    verify_catalog_matches_live_scan(&snapshot, &live_snapshot)
        .map_err(rename_planning_facts_error)?;
    let facts = build_rename_planning_facts(
        &resolved,
        &snapshot,
        scan_revision,
        resolved.session.observed_revision,
        &source,
        destination.clone(),
    )
    .map_err(rename_planning_facts_error)?;

    let intent = RenameSampleIntent {
        root_id: root_id.clone(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: destination,
    };

    match plan_rename_sample(&intent, &facts) {
        RenamePlanningOutcome::Planned(plan) => {
            rename_runtime
                .store_plan(*plan.clone())
                .map_err(rename_runtime_error)?;
            Ok(RenamePlanResponseDto::Planned(rename_plan_from_impact(
                plan.as_ref(),
            )))
        }
        RenamePlanningOutcome::Blocked(blocked) => Ok(RenamePlanResponseDto::Blocked(
            blocked_rename_plan_from_impact(&blocked),
        )),
    }
}

fn rename_authority_dto(authority: &RenameAuthorityRecord) -> RenameAuthorityDto {
    RenameAuthorityDto {
        schema: "rename-authority:v1",
        authority_id: authority.authority_id.clone(),
        plan_id: authority.plan_id.as_str().to_owned(),
        operation_id: authority.operation_id.as_str().to_owned(),
        expires_in_seconds: authority
            .expires_at
            .saturating_duration_since(std::time::Instant::now())
            .as_secs(),
    }
}

fn rename_backup_dto(plan_id: &str, backup: &RenameBackupRecord) -> RenameBackupStatusDto {
    RenameBackupStatusDto {
        schema: "rename-backup-status:v1",
        plan_id: plan_id.to_owned(),
        snapshot_id: backup.snapshot_id.as_str().to_owned(),
        state: "backup_verified",
        file_count: backup.file_count,
        total_bytes: backup.total_bytes,
        verified: true,
    }
}

fn rename_prepare_dto(plan_id: &str, prepared: &RenamePrepareRecord) -> RenamePrepareStatusDto {
    RenamePrepareStatusDto {
        schema: "rename-prepare-status:v1",
        plan_id: plan_id.to_owned(),
        operation_id: prepared.operation_id.as_str().to_owned(),
        snapshot_id: prepared.snapshot_id.as_str().to_owned(),
        state: "prepared",
        staged_file_count: prepared.staged_file_count,
        total_staged_bytes: prepared.total_staged_bytes,
        project_rewrite_count: prepared.project_rewrite_count,
    }
}

fn rename_status_dto(status: &RenameSessionStatus) -> RenameStatusDto {
    RenameStatusDto {
        schema: "rename-status:v1",
        operation_id: status.operation_id.as_str().to_owned(),
        plan_id: if status.plan_available {
            Some(status.plan_id.as_str().to_owned())
        } else {
            None
        },
        state: rename_phase_name(status.phase, status.journal_status).to_owned(),
        backup_snapshot_id: status.backup_snapshot_id.clone(),
        failure_code: status.failure_code.clone(),
        plan_expired: !status.plan_available,
    }
}

fn rename_phase_name(
    phase: RenameOperationPhase,
    journal_status: Option<ot_executor::RenameJournalStatus>,
) -> &'static str {
    if let Some(status) = journal_status {
        return match status {
            ot_executor::RenameJournalStatus::Prepared => "prepared",
            ot_executor::RenameJournalStatus::Applying => "applying",
            ot_executor::RenameJournalStatus::Committed => "committed",
            ot_executor::RenameJournalStatus::RolledBack => "rolled_back",
            ot_executor::RenameJournalStatus::RecoveryRequired => "recovery_required",
        };
    }
    match phase {
        RenameOperationPhase::Planned => "planned",
        RenameOperationPhase::Authorized => "authorized",
        RenameOperationPhase::BackupVerified => "backup_verified",
        RenameOperationPhase::Prepared => "prepared",
    }
}

fn ensure_rename_recovery_clear(
    registry: &RootRegistry,
    write: &SharedWriteRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
) -> Result<(), ApiError> {
    crate::mutation_gate::ensure_cross_domain_mutation_allowed(
        registry,
        write,
        rename_runtime,
        root_id,
    )
    .map_err(|blocked| blocked.into_api_error())
}

fn verify_stored_rename_plan_freshness(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    plan: &RenameImpactPlan,
    require_write: bool,
) -> Result<(), ApiError> {
    let resolved = registry.resolve(root_id)?;
    if require_write && !resolved.session.capabilities.write {
        return Err(ApiError::new(
            "WRITE_NOT_ENABLED",
            "enable the session-limited write grant before continuing this rename operation",
            true,
        ));
    }
    if require_write && !resolved.session.capabilities.stable_device_identity {
        return Err(ApiError::new(
            "WRITE_NOT_SUPPORTED",
            "rename authority requires a stable device identity",
            true,
        ));
    }
    if plan.root_id != resolved.session.root_id {
        return Err(ApiError::new(
            "PLAN_NOT_FOUND",
            "rename plan is not bound to this root session",
            true,
        ));
    }
    if plan.device_fingerprint != resolved.session.device_fingerprint {
        return Err(ApiError::new(
            "ROOT_CHANGED",
            "root identity changed after the plan was created",
            true,
        ));
    }
    if plan.base_observed_revision != resolved.session.observed_revision {
        return Err(ApiError::new(
            "CATALOG_REVISION_MISMATCH",
            "catalog scan revision no longer matches the live root session",
            true,
        ));
    }

    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    ensure_write_eligible(&snapshot)?;
    let source = snapshot
        .file_instances
        .iter()
        .find(|file| {
            opaque_file_instance_id(&identity, file) == plan.source_file_instance_id.as_str()
        })
        .ok_or_else(|| {
            ApiError::new(
                "CATALOG_STALE",
                "the source sample is no longer present in the catalog",
                true,
            )
        })?
        .clone();

    let scan_revision =
        latest_completed_scan_revision(catalog, resolved.session.device_fingerprint.as_str())?;
    let live_snapshot = scan_library_snapshot_sync(registry, catalog, root_id)?;
    verify_catalog_matches_live_scan(&snapshot, &live_snapshot)
        .map_err(rename_planning_facts_error)?;
    let facts = build_rename_planning_facts(
        &resolved,
        &snapshot,
        scan_revision,
        resolved.session.observed_revision,
        &source,
        plan.destination_relative_path.clone(),
    )
    .map_err(rename_planning_facts_error)?;
    validate_rename_plan_freshness(plan, &facts).map_err(|_| {
        ApiError::new(
            "PLAN_STALE",
            "rename planning evidence is no longer fresh; create a new plan",
            true,
        )
    })
}

pub(crate) fn authorize_rename_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    clone_runtime: &SharedCloneRuntime,
    write: &SharedWriteRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    plan_id: &str,
) -> Result<RenameAuthorityDto, ApiError> {
    ensure_rename_recovery_clear(registry, write, rename_runtime, root_id)?;
    let resolved = registry.resolve(root_id)?;
    ensure_clone_verified(clone_runtime, &resolved)?;
    let plan = rename_runtime
        .get_plan(root_id, plan_id)
        .map_err(rename_runtime_error)?;
    verify_stored_rename_plan_freshness(registry, catalog, root_id, &plan, true)?;
    let authority = rename_runtime
        .authorize(root_id, plan_id)
        .map_err(rename_runtime_error)?;
    Ok(rename_authority_dto(&authority))
}

pub(crate) fn create_rename_backup_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    clone_runtime: &SharedCloneRuntime,
    write: &SharedWriteRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    plan_id: &str,
    authority_id: &str,
) -> Result<RenameBackupStatusDto, ApiError> {
    ensure_rename_recovery_clear(registry, write, rename_runtime, root_id)?;
    let resolved = registry.resolve(root_id)?;
    ensure_clone_verified(clone_runtime, &resolved)?;
    rename_runtime
        .verify_authority(root_id, plan_id, authority_id)
        .map_err(rename_runtime_error)?;
    let plan = rename_runtime
        .get_plan(root_id, plan_id)
        .map_err(rename_runtime_error)?;
    verify_stored_rename_plan_freshness(registry, catalog, root_id, &plan, true)?;
    let resolved = registry.resolve(root_id)?;
    let backup = rename_runtime
        .create_backup(root_id, plan_id, authority_id, &resolved.canonical_path)
        .map_err(rename_runtime_error)?;
    Ok(rename_backup_dto(plan_id, &backup))
}

pub(crate) fn prepare_rename_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    clone_runtime: &SharedCloneRuntime,
    write: &SharedWriteRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    plan_id: &str,
    authority_id: &str,
    snapshot_id: &str,
) -> Result<RenamePrepareStatusDto, ApiError> {
    ensure_rename_recovery_clear(registry, write, rename_runtime, root_id)?;
    let resolved = registry.resolve(root_id)?;
    ensure_clone_verified(clone_runtime, &resolved)?;
    rename_runtime
        .verify_authority(root_id, plan_id, authority_id)
        .map_err(rename_runtime_error)?;
    let plan = rename_runtime
        .get_plan(root_id, plan_id)
        .map_err(rename_runtime_error)?;
    verify_stored_rename_plan_freshness(registry, catalog, root_id, &plan, true)?;
    let prepared = rename_runtime
        .prepare(root_id, plan_id, authority_id, snapshot_id, registry)
        .map_err(rename_runtime_error)?;
    Ok(rename_prepare_dto(plan_id, &prepared))
}

fn rename_mutation_state(status: ot_executor::RenameJournalStatus) -> &'static str {
    match status {
        ot_executor::RenameJournalStatus::Prepared => "prepared",
        ot_executor::RenameJournalStatus::Applying => "applying",
        ot_executor::RenameJournalStatus::Committed => "committed",
        ot_executor::RenameJournalStatus::RolledBack => "rolled_back",
        ot_executor::RenameJournalStatus::RecoveryRequired => "recovery_required",
    }
}

fn rename_apply_dto(
    plan_id: &str,
    applied: &RenameApplyRecord,
    verification_state: &str,
    verification_code: Option<&str>,
    rescan_completed: bool,
    observed_file_count: u64,
    missing_reference_count: u64,
) -> RenameApplyStatusDto {
    RenameApplyStatusDto {
        schema: "rename-apply-status:v1",
        plan_id: plan_id.to_owned(),
        operation_id: applied.operation_id.as_str().to_owned(),
        snapshot_id: applied.snapshot_id.as_str().to_owned(),
        mutation_state: rename_mutation_state(applied.journal_status).to_owned(),
        verification_state: verification_state.to_owned(),
        verification_code: verification_code.map(str::to_owned),
        rescan_completed,
        observed_file_count,
        missing_reference_count,
    }
}

fn count_missing_sample_references(snapshot: &LibrarySnapshot) -> u64 {
    snapshot
        .usage_edges
        .iter()
        .filter(|edge| edge.reference_status == SampleReferenceStatus::Missing)
        .count() as u64
}

pub(crate) fn apply_rename_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    clone_runtime: &SharedCloneRuntime,
    write: &SharedWriteRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    plan_id: &str,
    approved_plan_id: &str,
    authority_id: &str,
    snapshot_id: &str,
    clone_authority_id: &str,
) -> Result<RenameApplyStatusDto, ApiError> {
    ensure_rename_recovery_clear(registry, write, rename_runtime, root_id)?;
    let resolved = registry.resolve(root_id)?;
    if !resolved.session.capabilities.write {
        return Err(ApiError::new(
            "WRITE_GRANT_REQUIRED",
            "enable the session-limited write grant before applying this rename",
            true,
        ));
    }
    ensure_clone_verified(clone_runtime, &resolved)?;
    clone_runtime
        .require_clone_authority(&resolved, clone_authority_id)
        .map_err(clone_runtime_error)?;
    rename_runtime
        .verify_authority(root_id, plan_id, authority_id)
        .map_err(rename_runtime_error)?;
    let plan = rename_runtime
        .get_plan(root_id, plan_id)
        .map_err(rename_runtime_error)?;
    verify_stored_rename_plan_freshness(registry, catalog, root_id, &plan, true)?;
    let applied = rename_runtime
        .apply(
            root_id,
            plan_id,
            approved_plan_id,
            authority_id,
            snapshot_id,
            clone_authority_id,
            registry,
            clone_runtime,
        )
        .map_err(rename_runtime_error)?;

    let mut rescan_completed = false;
    let mut observed_file_count = 0_u64;
    let mut missing_reference_count = 0_u64;
    let mut verification_state = "passed";
    let mut verification_code = None;

    match scan_library_sync(registry, catalog, root_id) {
        Ok((session, snapshot)) => {
            observed_file_count = snapshot.file_instances.len() as u64;
            missing_reference_count = count_missing_sample_references(&snapshot);
            match store_library_snapshot(registry, catalog, root_id, &session, &snapshot) {
                Ok(_) => {
                    rescan_completed = true;
                    if missing_reference_count > 0 {
                        verification_state = "failed";
                        verification_code = Some("MISSING_REFERENCES");
                    }
                }
                Err(_) => {
                    verification_state = "failed";
                    verification_code = Some("CATALOG_STORE_ERROR");
                }
            }
        }
        Err(_) => {
            verification_state = "failed";
            verification_code = Some("RESCAN_FAILED");
        }
    }

    Ok(rename_apply_dto(
        plan_id,
        &applied,
        verification_state,
        verification_code,
        rescan_completed,
        observed_file_count,
        missing_reference_count,
    ))
}

pub(crate) fn recover_rename_sync(
    registry: &RootRegistry,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    operation_id: &str,
    approved_operation_id: &str,
) -> Result<RenameStatusDto, ApiError> {
    let status = rename_runtime
        .recover(root_id, operation_id, approved_operation_id, registry)
        .map_err(rename_runtime_error)?;
    Ok(rename_status_dto(&status))
}

pub(crate) fn rename_status_sync(
    registry: &RootRegistry,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
    operation_id: &str,
) -> Result<RenameStatusDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let status = rename_runtime
        .session_status_for_operation(
            root_id,
            operation_id,
            resolved.session.device_fingerprint.as_str(),
        )
        .map_err(rename_runtime_error)?;
    Ok(rename_status_dto(&status))
}

pub(crate) fn rename_recovery_status_sync(
    registry: &RootRegistry,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
) -> Result<RenameRecoveryStatusDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let operations = rename_runtime
        .incomplete_operations(&resolved.session.device_fingerprint)
        .map_err(rename_runtime_error)?
        .into_iter()
        .map(|status| rename_status_dto(&status))
        .collect::<Vec<_>>();
    let recovery_required = operations
        .iter()
        .any(|status| status.state == "applying" || status.state == "recovery_required");
    Ok(RenameRecoveryStatusDto {
        schema: "rename-recovery-status:v1",
        recovery_required,
        operations,
    })
}

fn destination_exists_live(
    resolved: &ResolvedRoot,
    destination: &RootRelativePath,
) -> Result<bool, ApiError> {
    let components = destination.as_str().split('/').collect::<Vec<_>>();
    let mut candidate = resolved.canonical_path.clone();
    for (index, component) in components.iter().enumerate() {
        candidate.push(component);
        let is_last = index + 1 == components.len();
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(RootRegistryError::SymlinkEscape.into());
            }
            Ok(metadata) if is_last && metadata.is_file() => return Ok(true),
            Ok(_metadata) if is_last => {
                return Err(ApiError::new(
                    "INVALID_DESTINATION_PATH",
                    "destination parent is not a directory",
                    true,
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && is_last => {
                return Ok(false)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ApiError::new(
                    "INVALID_DESTINATION_PATH",
                    "destination parent directory does not exist",
                    true,
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(RootRegistryError::PermissionDenied.into());
            }
            Err(_) => return Err(RootRegistryError::Unavailable.into()),
        }
    }
    Ok(false)
}

pub(crate) fn write_runtime_error(error: WriteRuntimeError) -> ApiError {
    let recoverable = !matches!(
        &error,
        WriteRuntimeError::UnsafeLocalState
            | WriteRuntimeError::InvalidPlan
            | WriteRuntimeError::InvalidTransition
    );
    let message = match &error {
        WriteRuntimeError::Io(_) => {
            "the write runtime could not access local application data".to_string()
        }
        WriteRuntimeError::Executor(executor_error) => match executor_error {
            ot_executor::ExecutorError::Io(_) => {
                "the write operation failed due to a filesystem error".to_string()
            }
            ot_executor::ExecutorError::Journal(_) => {
                "the operation journal could not be updated".to_string()
            }
            ot_executor::ExecutorError::Backup(_) => {
                "the verified backup could not be prepared".to_string()
            }
            ot_executor::ExecutorError::Authority(_) => {
                "write authority was rejected for this root".to_string()
            }
            other => other.to_string(),
        },
        other => other.to_string(),
    };
    ApiError::new(error.code(), message, recoverable)
}

fn parse_root_id(root_id: String) -> Result<RootId, ApiError> {
    RootId::new(root_id)
        .map_err(|error| ApiError::new("ROOT_NOT_APPROVED", error.to_string(), true))
}

#[cfg(test)]
fn list_library_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<LibrarySnapshot, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    load_library_snapshot(catalog, &identity)
}

fn list_library_dto_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<LibrarySnapshotDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    load_library_snapshot(catalog, &identity)
        .map(|snapshot| LibrarySnapshotDto::from_catalog_snapshot(&identity, snapshot))
}

fn load_library_snapshot(
    catalog: &SharedCatalog,
    identity: &CatalogRootIdentity,
) -> Result<LibrarySnapshot, ApiError> {
    let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    LoadLibrarySnapshot::new(&*catalog)
        .execute(identity)
        .map_err(catalog_error)?
        .ok_or_else(|| {
            ApiError::new(
                "CATALOG_NOT_INDEXED",
                "no successful catalog snapshot is available for this root",
                true,
            )
        })
}

fn scan_library_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<(RootSession, LibrarySnapshot), ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let baseline = {
        let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
        LoadLibrarySnapshot::new(&*catalog)
            .execute(&identity)
            .map_err(catalog_error)?
            .map(|snapshot| snapshot.file_instances)
            .unwrap_or_default()
    };
    let storage = RegisteredLegacyLibrary::new(root_id.clone(), resolved.canonical_path, baseline);
    ListLibrary::new(&storage)
        .execute(root_id)
        .map(|snapshot| (resolved.session, snapshot))
        .map_err(|error| storage_error(error.message()))
}

fn storage_error(message: &str) -> ApiError {
    let code = message
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .filter(|prefix| {
            matches!(
                *prefix,
                "ROOT_NOT_APPROVED"
                    | "ROOT_REMOVED"
                    | "PATH_ESCAPE"
                    | "SYMLINK_ESCAPE"
                    | "UNSUPPORTED_FORMAT"
            )
        })
        .unwrap_or("LIBRARY_SCAN_FAILED");
    let public_message = match code {
        "ROOT_NOT_APPROVED" => "the root is not registered",
        "ROOT_REMOVED" => "the registered root is no longer available",
        "PATH_ESCAPE" => "the library scan escaped the registered root",
        "SYMLINK_ESCAPE" => "the library scan traversed a symbolic link",
        "UNSUPPORTED_FORMAT" => "the selected folder uses an unsupported layout",
        _ => "the library could not be scanned",
    };
    ApiError::new(code, public_message, true)
}

fn catalog_identity(session: &RootSession) -> Result<CatalogRootIdentity, ApiError> {
    CatalogRootIdentity::new(session.device_fingerprint.clone()).map_err(catalog_error)
}

fn catalog_observation(session: &RootSession) -> Result<CatalogRootObservation, ApiError> {
    Ok(CatalogRootObservation {
        identity: catalog_identity(session)?,
        identity_is_stable: session.capabilities.stable_device_identity,
        display_name: session.display_name.clone(),
        observed_revision: session.observed_revision,
    })
}

fn store_library_snapshot(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    session: &RootSession,
    snapshot: &LibrarySnapshot,
) -> Result<RootSession, ApiError> {
    let scan = store_catalog_snapshot(catalog, session, snapshot)?;
    registry
        .record_completed_scan_revision(root_id, scan.revision.get())
        .map_err(Into::into)
}

fn store_catalog_snapshot(
    catalog: &SharedCatalog,
    session: &RootSession,
    snapshot: &LibrarySnapshot,
) -> Result<ot_storage_ports::CatalogScan, ApiError> {
    let observation = catalog_observation(session)?;
    let mut catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    StoreLibrarySnapshot::new(&mut *catalog)
        .execute(&observation, snapshot)
        .map_err(catalog_error)
}

fn scan_library_snapshot_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<LibrarySnapshot, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let baseline = {
        let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
        LoadLibrarySnapshot::new(&*catalog)
            .execute(&identity)
            .map_err(catalog_error)?
            .map(|snapshot| snapshot.file_instances)
            .unwrap_or_default()
    };
    let storage = RegisteredLegacyLibrary::new(root_id.clone(), resolved.canonical_path, baseline);
    ListLibrary::new(&storage)
        .execute(root_id)
        .map_err(|error| storage_error(error.message()))
}

#[cfg(test)]
pub(crate) fn gate_c_register_and_index_root(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    raw_path: &str,
) -> Result<(RootSession, LibrarySnapshot), ApiError> {
    let session = registry.register(raw_path)?;
    let (resolved, snapshot) = scan_library_sync(registry, catalog, &session.root_id)?;
    let synced = store_library_snapshot(registry, catalog, &session.root_id, &resolved, &snapshot)?;
    Ok((synced, snapshot))
}

#[cfg(test)]
pub(crate) fn gate_c_rescan_and_store(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<(RootSession, LibrarySnapshot), ApiError> {
    let resolved = registry.resolve(root_id)?;
    let storage =
        RegisteredLegacyLibrary::new(root_id.clone(), resolved.canonical_path.clone(), Vec::new());
    let snapshot = ListLibrary::new(&storage)
        .execute(root_id)
        .map_err(|error| storage_error(error.message()))?;
    let synced = store_library_snapshot(registry, catalog, root_id, &resolved.session, &snapshot)?;
    Ok((synced, snapshot))
}

#[cfg(test)]
pub(crate) fn gate_c_rescan_catalog_only(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<u64, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let snapshot = scan_library_snapshot_sync(registry, catalog, root_id)?;
    let scan = store_catalog_snapshot(catalog, &resolved.session, &snapshot)?;
    Ok(scan.revision.get())
}

#[cfg(test)]
pub(crate) fn gate_c_latest_completed_scan_revision(
    catalog: &SharedCatalog,
    fingerprint: &str,
) -> Result<u64, ApiError> {
    latest_completed_scan_revision(catalog, fingerprint)
}

fn catalog_lock_error() -> ApiError {
    ApiError::new(
        "CATALOG_UNAVAILABLE",
        "the local catalog is temporarily unavailable",
        true,
    )
}

fn catalog_error(error: CatalogError) -> ApiError {
    let (code, message, recoverable) = match &error {
        CatalogError::DuplicateRelativePath(_) => (
            "CATALOG_INDEX_INVALID",
            "the library scan contains duplicate relative paths",
            true,
        ),
        CatalogError::UnsupportedSchema { .. } => (
            "CATALOG_SCHEMA_UNSUPPORTED",
            "the catalog was created by a newer application version",
            false,
        ),
        CatalogError::Migration { .. } => (
            "CATALOG_MIGRATION_FAILED",
            "the local catalog schema could not be prepared",
            false,
        ),
        CatalogError::Unavailable { .. } => (
            "CATALOG_UNAVAILABLE",
            "the local catalog is temporarily unavailable",
            true,
        ),
        CatalogError::InvalidRootIdentity
        | CatalogError::InvalidScanId
        | CatalogError::InvalidScanRevision
        | CatalogError::InvalidStoredData { .. }
        | CatalogError::Integrity { .. } => (
            "CATALOG_INTEGRITY_ERROR",
            "the local catalog failed an integrity check",
            false,
        ),
        CatalogError::AssetNotFound => (
            "CATALOG_ASSET_NOT_FOUND",
            "the requested audio asset is not present in the catalog",
            true,
        ),
    };
    ApiError::new(code, message, recoverable)
}

fn register_root_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    raw_path: &str,
) -> Result<RootSessionDto, ApiError> {
    let session = registry.register(raw_path)?;
    let (resolved_session, snapshot) = match scan_library_sync(registry, catalog, &session.root_id)
    {
        Ok(result) => result,
        Err(error) => {
            let _ = registry.close(&session.root_id);
            return Err(error);
        }
    };
    if snapshot.sets.is_empty() && snapshot.standalone_projects.is_empty() {
        let _ = registry.close(&session.root_id);
        return Err(ApiError::new(
            "UNSUPPORTED_FORMAT",
            "the selected folder does not contain an Octatrack Set or Project",
            true,
        ));
    }
    let synced_session = match store_library_snapshot(
        registry,
        catalog,
        &session.root_id,
        &resolved_session,
        &snapshot,
    ) {
        Ok(session) => session,
        Err(error) => {
            let _ = registry.close(&session.root_id);
            return Err(error);
        }
    };
    Ok(synced_session.into())
}

fn apply_change_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    write: &SharedWriteRuntime,
    root_id: &RootId,
    plan_id: &str,
    approved_plan_id: &str,
) -> Result<ChangeStatusDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    if !resolved.session.capabilities.write {
        return Err(ApiError::new(
            "WRITE_GRANT_REQUIRED",
            "enable the session-limited write grant before applying this plan",
            true,
        ));
    }
    let recovery = write
        .recovery_required(&resolved.session.device_fingerprint)
        .map_err(write_runtime_error)?;
    if !recovery.is_empty() {
        return Err(ApiError::new(
            "RECOVERY_REQUIRED",
            "an incomplete write operation must be resolved before another apply",
            false,
        ));
    }
    let started = write
        .begin_apply(root_id, plan_id, approved_plan_id)
        .map_err(write_runtime_error)?;
    let mut status = write
        .execute_started(started, registry)
        .map_err(write_runtime_error)?;
    if scan_library_sync(registry, catalog, root_id)
        .and_then(|(session, snapshot)| {
            store_library_snapshot(registry, catalog, root_id, &session, &snapshot)
        })
        .is_ok()
    {
        if let Ok(refreshed) = write.mark_catalog_refreshed(root_id, &status.operation_id) {
            status = refreshed;
        }
    }
    Ok(status.into())
}

fn change_status_sync(
    registry: &RootRegistry,
    write: &SharedWriteRuntime,
    root_id: &RootId,
    operation_id: &str,
) -> Result<ChangeStatusDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    write
        .status(root_id, operation_id, &resolved.session.device_fingerprint)
        .map(Into::into)
        .map_err(write_runtime_error)
}

fn change_recovery_status_sync(
    registry: &RootRegistry,
    write: &SharedWriteRuntime,
    root_id: &RootId,
) -> Result<ChangeRecoveryStatusDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let operations = write
        .recovery_required(&resolved.session.device_fingerprint)
        .map_err(write_runtime_error)?
        .into_iter()
        .map(Into::into)
        .collect::<Vec<_>>();
    Ok(ChangeRecoveryStatusDto {
        schema: "change-recovery-status:v1",
        recovery_required: !operations.is_empty(),
        operations,
    })
}

fn recover_change_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    write: &SharedWriteRuntime,
    root_id: &RootId,
    operation_id: &str,
    approved_operation_id: &str,
) -> Result<ChangeStatusDto, ApiError> {
    let mut status = write
        .recover_incomplete(root_id, operation_id, approved_operation_id, registry)
        .map_err(write_runtime_error)?;
    if status.catalog_refresh_required
        && scan_library_sync(registry, catalog, root_id)
            .and_then(|(session, snapshot)| {
                store_library_snapshot(registry, catalog, root_id, &session, &snapshot)
            })
            .is_ok()
    {
        let _ = write.mark_catalog_refreshed(root_id, &status.operation_id);
        status.catalog_refresh_required = false;
    }
    Ok(status.into())
}

#[tauri::command]
pub async fn v2_root_register(
    raw_path: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<RootSessionDto, ApiError> {
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || register_root_sync(&registry, &catalog, &raw_path))
        .await
        .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_root_status(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
) -> Result<RootSessionDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    tauri::async_runtime::spawn_blocking(move || {
        registry.resolve(&root_id).map(|root| root.session.into())
    })
    .await
    .map_err(ApiError::task_failed)?
    .map_err(ApiError::from)
}

#[tauri::command]
pub async fn v2_root_enable_write(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<RootSessionDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        enable_write_sync(&registry, &catalog, &write, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_root_disable_write(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
) -> Result<RootSessionDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    tauri::async_runtime::spawn_blocking(move || disable_write_sync(&registry, &root_id))
        .await
        .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_root_close(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<(), ApiError> {
    let root_id = parse_root_id(root_id)?;
    clone_runtime.revoke_for_root(&root_id);
    registry.close(&root_id)?;
    Ok(())
}

#[tauri::command]
pub async fn v2_library_list(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<LibrarySnapshotDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || {
        list_library_dto_sync(&registry, &catalog, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_asset_metadata_get(
    root_id: String,
    asset_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || {
        load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_asset_metadata_replace(
    root_id: String,
    asset_id: String,
    metadata: ReplaceManualAssetMetadataDto,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || {
        replace_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id, metadata)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_audio_waveform_get(
    root_id: String,
    asset_id: String,
    target_points: u32,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    audio: State<'_, SharedAudioRuntime>,
) -> Result<AudioWaveformDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let target_points = usize::try_from(target_points).map_err(|_| {
        ApiError::new(
            "INVALID_AUDIO_REQUEST",
            "target points are outside the supported range",
            true,
        )
    })?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let audio = Arc::clone(audio.inner());
    tauri::async_runtime::spawn_blocking(move || {
        get_audio_waveform_sync(
            &registry,
            &catalog,
            &audio,
            &root_id,
            &asset_id,
            target_points,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_audio_preview_create(
    root_id: String,
    asset_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    audio: State<'_, SharedAudioRuntime>,
) -> Result<AudioPreviewTokenDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let audio = Arc::clone(audio.inner());
    tauri::async_runtime::spawn_blocking(move || {
        create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_audio_preview_read(
    root_id: String,
    preview_token: String,
    registry: State<'_, Arc<RootRegistry>>,
    audio: State<'_, SharedAudioRuntime>,
) -> Result<tauri::ipc::Response, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let audio = Arc::clone(audio.inner());
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_audio_preview_sync(&registry, &audio, &root_id, &preview_token)
    })
    .await
    .map_err(ApiError::task_failed)??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn v2_change_plan(
    root_id: String,
    source_file_instance_id: String,
    destination_relative_path: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<ChangePlanDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        plan_additive_copy_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &source_file_instance_id,
            &destination_relative_path,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_change_get_plan(
    root_id: String,
    plan_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<ChangePlanDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        registry.resolve(&root_id)?;
        write
            .get_plan(&root_id, &plan_id)
            .map(|plan| (&plan).into())
            .map_err(write_runtime_error)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_change_apply(
    root_id: String,
    plan_id: String,
    approved_plan_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<ChangeStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        apply_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &plan_id,
            &approved_plan_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_change_status(
    root_id: String,
    operation_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<ChangeStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        change_status_sync(&registry, &write, &root_id, &operation_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_change_recovery_status(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<ChangeRecoveryStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        change_recovery_status_sync(&registry, &write, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_change_recover(
    root_id: String,
    operation_id: String,
    approved_operation_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    write: State<'_, SharedWriteRuntime>,
) -> Result<ChangeStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let write = Arc::clone(write.inner());
    tauri::async_runtime::spawn_blocking(move || {
        recover_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &operation_id,
            &approved_operation_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_plan(
    root_id: String,
    source_file_instance_id: String,
    destination_relative_path: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    clone_runtime: State<'_, SharedCloneRuntime>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenamePlanResponseDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_file_instance_id,
            &destination_relative_path,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_get_plan(
    root_id: String,
    plan_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenamePlanDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        registry.resolve(&root_id)?;
        rename_runtime
            .get_plan(&root_id, &plan_id)
            .map(|plan| rename_plan_from_impact(&plan))
            .map_err(rename_runtime_error)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_authorize(
    root_id: String,
    plan_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    clone_runtime: State<'_, SharedCloneRuntime>,
    write: State<'_, SharedWriteRuntime>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenameAuthorityDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    let write = Arc::clone(write.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        authorize_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_create_backup(
    root_id: String,
    plan_id: String,
    authority_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    clone_runtime: State<'_, SharedCloneRuntime>,
    write: State<'_, SharedWriteRuntime>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenameBackupStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    let write = Arc::clone(write.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        create_rename_backup_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan_id,
            &authority_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_prepare(
    root_id: String,
    plan_id: String,
    authority_id: String,
    snapshot_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    clone_runtime: State<'_, SharedCloneRuntime>,
    write: State<'_, SharedWriteRuntime>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenamePrepareStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    let write = Arc::clone(write.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        prepare_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan_id,
            &authority_id,
            &snapshot_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_apply(
    root_id: String,
    plan_id: String,
    approved_plan_id: String,
    authority_id: String,
    snapshot_id: String,
    clone_authority_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    clone_runtime: State<'_, SharedCloneRuntime>,
    write: State<'_, SharedWriteRuntime>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenameApplyStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    let write = Arc::clone(write.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        apply_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan_id,
            &approved_plan_id,
            &authority_id,
            &snapshot_id,
            &clone_authority_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_get_status(
    root_id: String,
    operation_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenameStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        rename_status_sync(&registry, &rename_runtime, &root_id, &operation_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_recovery_status(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenameRecoveryStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        rename_recovery_status_sync(&registry, &rename_runtime, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_rename_recover(
    root_id: String,
    operation_id: String,
    approved_operation_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    rename_runtime: State<'_, SharedRenameWriteRuntime>,
) -> Result<RenameStatusDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let rename_runtime = Arc::clone(rename_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        recover_rename_sync(
            &registry,
            &rename_runtime,
            &root_id,
            &operation_id,
            &approved_operation_id,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_clone_record_source_evidence(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<CloneSourceEvidenceDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        record_clone_source_evidence_sync(&registry, &clone_runtime, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_clone_create_managed(
    source_root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<ManagedCloneDto, ApiError> {
    let source_root_id = parse_root_id(source_root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        create_managed_clone_sync(&registry, &catalog, &clone_runtime, &source_root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_clone_verify_external(
    root_id: String,
    source_evidence_id: String,
    acknowledged_disposable_clone: bool,
    registry: State<'_, Arc<RootRegistry>>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<CloneVerificationDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        verify_external_clone_sync(
            &registry,
            &clone_runtime,
            &root_id,
            source_evidence_id,
            acknowledged_disposable_clone,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_clone_verification_status(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<Option<CloneVerificationDto>, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        clone_verification_status_sync(&registry, &clone_runtime, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_clone_reverify(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<CloneVerificationDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        clone_reverify_sync(&registry, &clone_runtime, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_clone_issue_authority(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    clone_runtime: State<'_, SharedCloneRuntime>,
) -> Result<CloneAuthorityDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let clone_runtime = Arc::clone(clone_runtime.inner());
    tauri::async_runtime::spawn_blocking(move || {
        clone_issue_authority_sync(&registry, &clone_runtime, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_runtime::open_shared_audio_runtime;
    use crate::catalog_runtime::open_shared_catalog;
    use crate::clone_runtime::open_shared_clone_runtime;
    use crate::root_registry::{DeviceIdentityProvider, DeviceObservation};
    use crate::write_runtime::open_shared_write_runtime;
    use ot_executor::{JournalFileIdentity, JournalStatus, OperationJournal};
    use ot_plan::derive_additive_copy_plan_id;
    use ot_tools_io::{types::SlotMarkers, OctatrackFileIO, SampleSettingsFile};
    use std::collections::BTreeMap;
    use std::fs;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::path::Path;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;
    use tempfile::TempDir;

    struct StableTestIdentity;

    impl DeviceIdentityProvider for StableTestIdentity {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            Ok(DeviceObservation {
                stable_key: "fixture-volume".into(),
                filesystem_type: Some("fixturefs".into()),
                total_capacity: Some(4096),
                mount_token: "fixture-mount".into(),
                stable: true,
            })
        }
    }

    struct UnstableTestIdentity;

    impl DeviceIdentityProvider for UnstableTestIdentity {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            Ok(DeviceObservation {
                stable_key: "fixture-unstable".into(),
                filesystem_type: Some("fixturefs".into()),
                total_capacity: Some(4096),
                mount_token: "fixture-mount".into(),
                stable: false,
            })
        }
    }

    struct PathBasedTestIdentity;

    impl DeviceIdentityProvider for PathBasedTestIdentity {
        fn observe(&self, root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            let stable_key = root
                .canonicalize()
                .unwrap_or_else(|_| root.to_path_buf())
                .to_string_lossy()
                .into_owned();
            Ok(DeviceObservation {
                stable_key: format!("fixture-volume:{stable_key}"),
                filesystem_type: Some("fixturefs".into()),
                total_capacity: Some(4096),
                mount_token: format!("fixture-mount:{stable_key}"),
                stable: true,
            })
        }
    }

    fn registry() -> RootRegistry {
        RootRegistry::new(Arc::new(StableTestIdentity), Duration::from_secs(60))
    }

    fn multi_root_registry() -> RootRegistry {
        RootRegistry::new(Arc::new(PathBasedTestIdentity), Duration::from_secs(60))
    }

    fn unstable_registry() -> RootRegistry {
        RootRegistry::new(Arc::new(UnstableTestIdentity), Duration::from_secs(60))
    }

    fn catalog() -> (TempDir, SharedCatalog) {
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        (data_directory, catalog)
    }

    fn rename_runtime(data_directory: &Path) -> SharedRenameWriteRuntime {
        crate::rename_write_runtime::open_shared_rename_write_runtime(data_directory).unwrap()
    }

    fn open_test_clone_runtime(data_directory: &Path) -> SharedCloneRuntime {
        open_shared_clone_runtime(data_directory).unwrap()
    }

    fn install_fixture_clone_verification(
        clone_runtime: &SharedCloneRuntime,
        registry: &RootRegistry,
        root_id: &RootId,
    ) {
        let resolved = registry.resolve(root_id).unwrap();
        clone_runtime.install_test_verification(&resolved).unwrap();
    }

    struct RenameThroughBackupFixture {
        _root: TempDir,
        data_directory: TempDir,
        registry: RootRegistry,
        catalog: SharedCatalog,
        clone_runtime: SharedCloneRuntime,
        rename_runtime: SharedRenameWriteRuntime,
        write: SharedWriteRuntime,
        root_id: RootId,
        plan_id: String,
        operation_id: String,
        authority_id: String,
        snapshot_id: String,
    }

    fn setup_rename_through_backup() -> RenameThroughBackupFixture {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let write = write_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        enable_write_sync(&registry, &catalog, &write, &root_id).unwrap();

        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };

        let authority = authorize_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
        )
        .unwrap();

        let backup = create_rename_backup_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
            &authority.authority_id,
        )
        .unwrap();

        RenameThroughBackupFixture {
            _root: root,
            data_directory,
            registry,
            catalog,
            clone_runtime,
            rename_runtime,
            write,
            root_id,
            plan_id: plan.plan_id,
            operation_id: plan.operation_id,
            authority_id: authority.authority_id,
            snapshot_id: backup.snapshot_id,
        }
    }

    fn backup_snapshot_directory(data_directory: &Path, snapshot_id: &str) -> PathBuf {
        let stem = snapshot_id
            .strip_prefix("snapshot:v1:")
            .expect("snapshot id uses the v1 prefix");
        data_directory
            .join("MasterOCTa")
            .join("write-state")
            .join("backups")
            .join(stem)
    }

    fn rename_journal_path(data_directory: &Path, operation_id: &str) -> PathBuf {
        let stem = operation_id
            .strip_prefix("operation:v1:")
            .expect("operation id uses the v1 prefix");
        data_directory
            .join("MasterOCTa")
            .join("write-state")
            .join("journals")
            .join("rename")
            .join(format!("{stem}.json"))
    }

    fn write_runtime(data_directory: &Path) -> SharedWriteRuntime {
        open_shared_write_runtime(data_directory).unwrap()
    }

    fn create_set_project(root: &Path, set_name: &str, project_name: &str) {
        let set = root.join(set_name);
        fs::create_dir_all(set.join("AUDIO")).unwrap();
        fs::create_dir_all(set.join(project_name)).unwrap();
        fs::write(set.join(project_name).join("project.work"), b"fixture").unwrap();
    }

    fn write_test_wav(path: &Path) {
        let sample_rate = 8_000_u32;
        let channels = 1_u16;
        let samples = (0..4_000)
            .flat_map(|index| {
                let sample = if index % 200 < 100 {
                    i16::MAX / 2
                } else {
                    i16::MIN / 2
                };
                sample.to_le_bytes()
            })
            .collect::<Vec<_>>();
        let data_size = u32::try_from(samples.len()).unwrap();
        let byte_rate = sample_rate * u32::from(channels) * 2;
        let block_align = channels * 2;
        let mut wav = Vec::with_capacity(44 + samples.len());
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_size).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        wav.extend_from_slice(&samples);
        fs::write(path, wav).unwrap();
    }

    fn copy_real_device_1_40_state(root: &Path) -> std::path::PathBuf {
        let project = root.join("SET_A/BaseProject");
        fs::create_dir_all(&project).unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let project_fixture = fixtures.join("real_device_os_1_40/project.work");
        fs::copy(&project_fixture, project.join("project.work")).unwrap();
        fs::copy(&project_fixture, project.join("project.strd")).unwrap();
        for bank_index in 1..=16 {
            fs::copy(
                fixtures.join("real_device/bank01.work"),
                project.join(format!("bank{bank_index:02}.work")),
            )
            .unwrap();
            fs::copy(
                fixtures.join("real_device/bank01.strd"),
                project.join(format!("bank{bank_index:02}.strd")),
            )
            .unwrap();
        }
        project
    }

    fn state_document_hashes(project: &Path) -> BTreeMap<String, String> {
        fs::read_dir(project)
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter_map(|entry| {
                let name = entry.file_name().into_string().ok()?;
                let is_project = matches!(name.as_str(), "project.work" | "project.strd");
                let is_bank = name.starts_with("bank")
                    && (name.ends_with(".work") || name.ends_with(".strd"));
                (is_project || is_bank).then(|| {
                    let bytes = fs::read(entry.path()).unwrap();
                    (name, format!("{:x}", Sha256::digest(bytes)))
                })
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn recovery_binding_fixture(
        plan_id: &str,
        snapshot_id: &str,
        source_fingerprint: &str,
        base_observed_revision: u64,
        source_relative_path: &str,
        destination_relative_path: &str,
        source_byte_size: u64,
        source_content_hash: &str,
    ) -> String {
        fn encode(hasher: &mut Sha256, tag: u8, bytes: &[u8]) {
            hasher.update([tag]);
            hasher.update((bytes.len() as u64).to_be_bytes());
            hasher.update(bytes);
        }

        let mut hasher = Sha256::new();
        hasher.update(b"masterocta:recovery-binding:v1");
        encode(&mut hasher, 1, plan_id.as_bytes());
        encode(&mut hasher, 2, snapshot_id.as_bytes());
        encode(&mut hasher, 3, source_fingerprint.as_bytes());
        encode(&mut hasher, 4, &base_observed_revision.to_be_bytes());
        encode(&mut hasher, 5, source_relative_path.as_bytes());
        encode(&mut hasher, 6, destination_relative_path.as_bytes());
        encode(&mut hasher, 7, &source_byte_size.to_be_bytes());
        encode(&mut hasher, 8, source_content_hash.as_bytes());
        encode(&mut hasher, 9, &1_u64.to_be_bytes());
        encode(&mut hasher, 10, source_relative_path.as_bytes());
        format!("recovery-binding:v1:{:x}", hasher.finalize())
    }

    #[test]
    fn verified_1_40_project_allows_only_safe_additive_copy_and_preserves_all_state() {
        const PROJECT_SHA256: &str =
            "742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6";

        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        let source = audio_pool.join("kick.wav");
        write_test_wav(&source);
        let source_before = fs::read(&source).unwrap();
        let project = copy_real_device_1_40_state(root.path());
        let state_before = state_document_hashes(&project);
        assert_eq!(state_before.len(), 34);
        assert_eq!(state_before["project.work"], PROJECT_SHA256);
        assert_eq!(state_before["project.strd"], PROJECT_SHA256);

        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        assert!(session.capabilities.stable_device_identity);
        let root_id = RootId::new(session.root_id.clone()).unwrap();
        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert_eq!(snapshot.state_documents.len(), 34);
        assert!(snapshot
            .state_documents
            .iter()
            .all(|document| document.parse_status == StateDocumentParseStatus::Parsed));
        assert!(snapshot.state_documents.iter().any(|document| {
            document.source_relative_path.as_str() == "SET_A/BaseProject/project.work"
        }));
        assert!(snapshot.state_documents.iter().any(|document| {
            document.source_relative_path.as_str() == "SET_A/BaseProject/project.strd"
        }));
        ensure_write_eligible(&snapshot).unwrap();

        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET_A/AUDIO/kick.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let traversal = plan_additive_copy_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &source_id,
            "../escape.wav",
        )
        .unwrap_err();
        assert_eq!(traversal.code, "INVALID_DESTINATION_PATH");

        let overwrite = plan_additive_copy_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &source_id,
            "SET_A/AUDIO/kick.wav",
        )
        .unwrap_err();
        assert_eq!(overwrite.code, "DESTINATION_EXISTS");

        enable_write_sync(&registry, &catalog, &write, &root_id).unwrap();
        let plan = plan_additive_copy_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &source_id,
            "SET_A/AUDIO/kick-copy.wav",
        )
        .unwrap();
        assert!(!plan.overwrite_allowed);
        assert_eq!(plan.delete_count, 0);
        assert!(!serde_json::to_string(&plan)
            .unwrap()
            .contains(root.path().to_str().unwrap()));

        let status = apply_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &plan.plan_id,
            &plan.plan_id,
        )
        .unwrap();
        assert_eq!(status.state, "committed");

        let destination = audio_pool.join("kick-copy.wav");
        let destination_bytes = fs::read(destination).unwrap();
        assert_eq!(fs::read(&source).unwrap(), source_before);
        assert_eq!(destination_bytes, source_before);
        assert_eq!(
            format!("{:x}", Sha256::digest(&destination_bytes)),
            format!("{:x}", Sha256::digest(&source_before))
        );
        assert_eq!(state_document_hashes(&project), state_before);
    }

    #[test]
    fn unstable_identity_still_cannot_enable_write() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        write_test_wav(&audio_pool.join("kick.wav"));
        let registry = unstable_registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        assert!(!session.capabilities.stable_device_identity);
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);

        let error = enable_write_sync(&registry, &catalog, &write, &root_id).unwrap_err();

        assert_eq!(error.code, "WRITE_NOT_SUPPORTED");
        assert!(
            !registry
                .resolve(&root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );
    }

    #[test]
    fn unknown_project_format_version_still_blocks_write() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        write_test_wav(&audio_pool.join("kick.wav"));
        let project = root.path().join("SET_A/BaseProject");
        fs::create_dir(&project).unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/real_device_os_1_40/project.work");
        let source = String::from_utf8(fs::read(fixture).unwrap()).unwrap();
        fs::write(
            project.join("project.work"),
            source.replace("VERSION=19", "VERSION=20"),
        )
        .unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert!(snapshot.state_documents.iter().any(|document| {
            document.parse_status == StateDocumentParseStatus::UnsupportedVersion
        }));

        let error = enable_write_sync(&registry, &catalog, &write, &root_id).unwrap_err();

        assert_eq!(error.code, "WRITE_NOT_SUPPORTED");
        assert!(!format!("{error:?}").contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn unknown_project_os_still_blocks_write() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        write_test_wav(&audio_pool.join("kick.wav"));
        let project = root.path().join("SET_A/BaseProject");
        fs::create_dir(&project).unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/real_device_os_1_40/project.work");
        let source = String::from_utf8(fs::read(fixture).unwrap()).unwrap();
        fs::write(
            project.join("project.work"),
            source.replace("R0173      1.40", "R9999      9.99"),
        )
        .unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert!(snapshot.state_documents.iter().any(|document| {
            document.parse_status == StateDocumentParseStatus::UnsupportedVersion
        }));

        let error = enable_write_sync(&registry, &catalog, &write, &root_id).unwrap_err();

        assert_eq!(error.code, "WRITE_NOT_SUPPORTED");
        assert!(!format!("{error:?}").contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn unsupported_sample_settings_still_block_write() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        let audio = audio_pool.join("kick.wav");
        write_test_wav(&audio);
        let sidecar = SampleSettingsFile::new(
            SlotMarkers {
                trim_end: 1000,
                ..Default::default()
            },
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let sidecar_path = audio.with_extension("ot");
        sidecar.to_data_file(&sidecar_path).unwrap();
        let sidecar_before = fs::read(&sidecar_path).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let mut snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert_eq!(
            snapshot.sample_settings[0].parse_status,
            SampleSettingsParseStatus::Parsed
        );
        let unsupported = &mut snapshot.sample_settings[0];
        unsupported.parse_status = SampleSettingsParseStatus::UnsupportedVersion;
        unsupported.gain = None;
        unsupported.tempo_x24 = None;
        unsupported.trim_bars_x100 = None;
        unsupported.loop_bars_x100 = None;
        unsupported.stretch_mode = None;
        unsupported.loop_mode = None;
        unsupported.trig_quantization = None;
        unsupported.trim_start = None;
        unsupported.trim_end = None;
        unsupported.loop_start = None;
        unsupported.slices.clear();

        let error = ensure_write_eligible(&snapshot).unwrap_err();

        assert_eq!(error.code, "WRITE_NOT_SUPPORTED");
        assert_eq!(fs::read(sidecar_path).unwrap(), sidecar_before);
    }

    #[test]
    fn production_write_composition_requires_exact_approval_and_refreshes_the_catalog() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        fs::create_dir(audio_pool.join(".hidden")).unwrap();
        let source = audio_pool.join("kick.wav");
        write_test_wav(&source);
        let source_before = fs::read(&source).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id.clone()).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = snapshot.audio_files[0].file_instance_id.clone();

        for hidden_destination in [
            "SET_A/AUDIO/.hidden-copy.wav",
            "SET_A/AUDIO/._appledouble.wav",
            "SET_A/AUDIO/.hidden/kick-copy.wav",
        ] {
            let error = plan_additive_copy_sync(
                &registry,
                &catalog,
                &write,
                &root_id,
                &source_id,
                hidden_destination,
            )
            .unwrap_err();
            assert_eq!(error.code, "INVALID_DESTINATION_PATH");
        }

        let plan = plan_additive_copy_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &source_id,
            "SET_A/AUDIO/kick-copy.wav",
        )
        .unwrap();
        let plan_json = serde_json::to_string(&plan).unwrap();
        assert_eq!(plan.operation, "additive_copy");
        assert!(!plan.overwrite_allowed);
        assert_eq!(plan.delete_count, 0);
        assert!(plan.requires_explicit_approval);
        assert!(!plan_json.contains(root.path().to_str().unwrap()));
        assert!(!plan_json.contains(&session.root_id));
        assert!(!plan_json.contains(&session.device_fingerprint));

        let no_grant = apply_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &plan.plan_id,
            &plan.plan_id,
        )
        .unwrap_err();
        assert_eq!(no_grant.code, "WRITE_GRANT_REQUIRED");

        let enabled = enable_write_sync(&registry, &catalog, &write, &root_id).unwrap();
        assert!(enabled.capabilities.write);
        let plan = plan_additive_copy_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &source_id,
            "SET_A/AUDIO/kick-copy.wav",
        )
        .unwrap();
        let wrong_approval = format!("plan:v1:{}", "a".repeat(64));
        let approval_error = apply_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &plan.plan_id,
            &wrong_approval,
        )
        .unwrap_err();
        assert_eq!(approval_error.code, "APPROVAL_REQUIRED");

        let status = apply_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &plan.plan_id,
            &plan.plan_id,
        )
        .unwrap();
        assert_eq!(status.state, "committed");
        assert!(!status.recovery_required);
        assert!(!status.catalog_refresh_required);
        assert!(status.backup_snapshot_id.is_some());
        assert_eq!(
            fs::read(audio_pool.join("kick-copy.wav")).unwrap(),
            source_before
        );
        assert_eq!(fs::read(&source).unwrap(), source_before);

        let refreshed = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        assert_eq!(refreshed.audio_files.len(), 2);
        assert!(refreshed
            .audio_files
            .iter()
            .any(|file| file.relative_path == "SET_A/AUDIO/kick-copy.wav"));
        let recovery = change_recovery_status_sync(&registry, &write, &root_id).unwrap();
        assert!(!recovery.recovery_required);
        let consumed = apply_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &plan.plan_id,
            &plan.plan_id,
        )
        .unwrap_err();
        assert_eq!(consumed.code, "PLAN_CONSUMED");
    }

    #[test]
    fn production_recovery_route_rolls_back_a_journaled_synthetic_clone_after_restart() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        let source = audio_pool.join("kick.wav");
        let destination = audio_pool.join("kick-copy.wav");
        write_test_wav(&source);
        fs::copy(&source, &destination).unwrap();
        let source_before = fs::read(&source).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id.clone()).unwrap();
        assert!(!session.capabilities.write);

        let plan_seed = PlanSeed::new([0x5a; 32]);
        let source_relative = RootRelativePath::parse("SET_A/AUDIO/kick.wav").unwrap();
        let destination_relative = RootRelativePath::parse("SET_A/AUDIO/kick-copy.wav").unwrap();
        let content_hash =
            ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&source_before))).unwrap();
        let plan_id = derive_additive_copy_plan_id(
            &root_id,
            &plan_seed,
            &session.device_fingerprint,
            session.observed_revision,
            &source_relative,
            &destination_relative,
            &content_hash,
            source_before.len() as u64,
        );
        let digest = plan_id
            .as_str()
            .strip_prefix("plan:v1:")
            .unwrap()
            .to_owned();
        let operation_id = format!("operation:v1:{digest}");
        let snapshot_id = format!("snapshot:v1:{digest}");
        let source_relative_path = source_relative.as_str();
        let destination_relative_path = destination_relative.as_str();
        let content_hash = content_hash.as_str().to_owned();
        let recovery_binding = recovery_binding_fixture(
            plan_id.as_str(),
            &snapshot_id,
            &session.device_fingerprint,
            session.observed_revision,
            source_relative_path,
            destination_relative_path,
            source_before.len() as u64,
            &content_hash,
        );
        let write_state = data_directory.path().join("MasterOCTa/write-state");
        let backup_directory = write_state.join("backups").join(&digest);
        let backup_file = backup_directory.join("files").join(source_relative_path);
        fs::create_dir_all(backup_file.parent().unwrap()).unwrap();
        fs::write(&backup_file, &source_before).unwrap();
        let backup_manifest = serde_json::json!({
            "schema": "masterocta-backup:v2",
            "snapshot_id": snapshot_id.clone(),
            "plan_id": plan_id.as_str(),
            "source_fingerprint": session.device_fingerprint.clone(),
            "base_observed_revision": session.observed_revision,
            "source_relative_path": source_relative_path,
            "destination_relative_path": destination_relative_path,
            "recovery_binding": recovery_binding.clone(),
            "complete": true,
            "files": [{
                "relative_path": source_relative_path,
                "byte_size": source_before.len() as u64,
                "content_hash": content_hash.clone(),
            }],
        });
        fs::write(
            backup_directory.join("manifest.json"),
            serde_json::to_vec_pretty(&backup_manifest).unwrap(),
        )
        .unwrap();

        let destination_metadata = fs::metadata(&destination).unwrap();
        let journal = OperationJournal {
            schema: "masterocta-operation-journal:v3".into(),
            operation_id: operation_id.clone(),
            plan_id: plan_id.as_str().to_owned(),
            root_fingerprint: session.device_fingerprint.clone(),
            base_observed_revision: session.observed_revision,
            source_relative_path: source_relative_path.into(),
            destination_relative_path: destination_relative_path.into(),
            backup_snapshot_id: snapshot_id,
            recovery_binding,
            destination_file_identity: Some(JournalFileIdentity {
                device: destination_metadata.dev(),
                inode: destination_metadata.ino(),
                byte_size: destination_metadata.size(),
                modified_seconds: destination_metadata.mtime(),
                modified_nanoseconds: destination_metadata.mtime_nsec(),
                changed_seconds: destination_metadata.ctime(),
                changed_nanoseconds: destination_metadata.ctime_nsec(),
            }),
            status: JournalStatus::Applying,
            failure_code: Some("SIMULATED_PROCESS_EXIT".into()),
        };
        let journal_directory = write_state.join("journals");
        fs::create_dir_all(&journal_directory).unwrap();
        fs::write(
            journal_directory.join(format!("{digest}.json")),
            serde_json::to_vec_pretty(&journal).unwrap(),
        )
        .unwrap();
        let authorization_directory = journal_directory.join("authorizations");
        fs::create_dir_all(&authorization_directory).unwrap();
        let authorization_path = authorization_directory.join(format!("{digest}.json"));
        let authorization = serde_json::json!({
            "schema": "masterocta-recovery-authorization:v2",
            "operation_id": operation_id.clone(),
            "plan_id": journal.plan_id.clone(),
            "root_id": root_id.as_str(),
            "plan_seed": plan_seed.to_hex(),
            "root_fingerprint": journal.root_fingerprint.clone(),
            "base_observed_revision": journal.base_observed_revision,
            "source_relative_path": source_relative_path,
            "destination_relative_path": destination_relative_path,
            "backup_snapshot_id": journal.backup_snapshot_id.clone(),
            "recovery_binding": journal.recovery_binding.clone(),
            "source_byte_size": source_before.len() as u64,
            "source_content_hash": content_hash,
        });
        fs::write(
            &authorization_path,
            serde_json::to_vec_pretty(&authorization).unwrap(),
        )
        .unwrap();
        fs::set_permissions(&authorization_path, fs::Permissions::from_mode(0o400)).unwrap();

        assert!(registry.enable_write(&root_id).unwrap().capabilities.write);

        let pending = change_recovery_status_sync(&registry, &write, &root_id).unwrap();
        assert!(pending.recovery_required);
        assert_eq!(pending.operations.len(), 1);
        let wrong_approval = format!("operation:v1:{}", "b".repeat(64));
        let approval_error = recover_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &operation_id,
            &wrong_approval,
        )
        .unwrap_err();
        assert_eq!(approval_error.code, "APPROVAL_REQUIRED");
        assert!(destination.exists());
        assert!(
            registry
                .resolve(&root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );

        let recovered = recover_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &operation_id,
            &operation_id,
        )
        .unwrap();

        assert_eq!(recovered.state, "rolled_back");
        assert!(!recovered.recovery_required);
        assert!(!recovered.catalog_refresh_required);
        assert!(!destination.exists());
        assert_eq!(fs::read(&source).unwrap(), source_before);
        assert!(
            !registry
                .resolve(&root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );
        assert!(
            !change_recovery_status_sync(&registry, &write, &root_id)
                .unwrap()
                .recovery_required
        );
        let replay = recover_change_sync(
            &registry,
            &catalog,
            &write,
            &root_id,
            &operation_id,
            &operation_id,
        )
        .unwrap_err();
        assert_eq!(replay.code, "PLAN_CONSUMED");
        let refreshed = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        assert_eq!(refreshed.audio_files.len(), 1);
        assert_eq!(refreshed.audio_files[0].relative_path, source_relative_path);
        let response_json = serde_json::to_string(&recovered).unwrap();
        assert!(!response_json.contains(root.path().to_str().unwrap()));
        assert!(!response_json.contains(&session.root_id));
        assert!(!response_json.contains(&session.device_fingerprint));
    }

    #[test]
    fn write_grant_rechecks_live_format_eligibility() {
        let root = TempDir::new().unwrap();
        let audio_pool = root.path().join("SET_A/AUDIO");
        fs::create_dir_all(&audio_pool).unwrap();
        write_test_wav(&audio_pool.join("kick.wav"));
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let write = open_shared_write_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);

        let project = root.path().join("SET_A/PROJECT_A");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.work"), b"synthetic malformed project").unwrap();

        let error = enable_write_sync(&registry, &catalog, &write, &root_id).unwrap_err();

        assert_eq!(error.code, "WRITE_NOT_SUPPORTED");
        assert!(
            !registry
                .resolve(&root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );
        let refreshed = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert!(refreshed
            .state_documents
            .iter()
            .any(|document| { document.parse_status == StateDocumentParseStatus::Malformed }));
    }

    #[test]
    fn registration_rejects_folders_without_octatrack_content() {
        let root = TempDir::new().unwrap();
        let (_data_directory, catalog) = catalog();

        let error =
            register_root_sync(&registry(), &catalog, root.path().to_str().unwrap()).unwrap_err();

        assert_eq!(error.code, "UNSUPPORTED_FORMAT");
    }

    #[test]
    fn registration_indexes_and_query_returns_only_catalog_relative_paths() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let fixture_file = root.path().join("SET_A/PROJECT_A/project.work");
        let fixture_before = fs::read(&fixture_file).unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();

        let snapshot =
            list_library_sync(&registry, &catalog, &RootId::new(session.root_id).unwrap()).unwrap();

        assert_eq!(snapshot.sets[0].relative_path.as_str(), "SET_A");
        assert_eq!(
            snapshot.sets[0].projects[0].relative_path.as_str(),
            "SET_A/PROJECT_A"
        );
        assert_eq!(fs::read(fixture_file).unwrap(), fixture_before);
        assert!(!format!("{snapshot:?}").contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn catalog_query_does_not_rescan_the_registered_filesystem() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        fs::remove_dir_all(root.path().join("SET_A")).unwrap();

        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();

        assert_eq!(snapshot.sets[0].display_name, "SET_A");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "PROJECT_A");
    }

    #[test]
    fn catalog_query_survives_catalog_reopen() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        drop(catalog);

        let reopened_catalog = open_shared_catalog(data_directory.path()).unwrap();
        let snapshot = list_library_sync(&registry, &reopened_catalog, &root_id).unwrap();

        assert_eq!(snapshot.sets[0].display_name, "SET_A");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "PROJECT_A");
    }

    #[test]
    fn reregistering_the_root_replaces_the_catalog_projection() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "OLD_SET", "OLD_PROJECT");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let first = register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        fs::remove_dir_all(root.path().join("OLD_SET")).unwrap();
        create_set_project(root.path(), "NEW_SET", "NEW_PROJECT");

        let refreshed =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let snapshot = list_library_sync(
            &registry,
            &catalog,
            &RootId::new(refreshed.root_id.clone()).unwrap(),
        )
        .unwrap();

        assert_eq!(refreshed.root_id, first.root_id);
        assert_eq!(snapshot.sets.len(), 1);
        assert_eq!(snapshot.sets[0].display_name, "NEW_SET");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "NEW_PROJECT");
    }

    #[test]
    fn a_second_root_with_the_same_catalog_identity_cannot_replace_the_first() {
        let first_root = TempDir::new().unwrap();
        let second_root = TempDir::new().unwrap();
        create_set_project(first_root.path(), "FIRST_SET", "FIRST_PROJECT");
        create_set_project(second_root.path(), "SECOND_SET", "SECOND_PROJECT");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let first =
            register_root_sync(&registry, &catalog, first_root.path().to_str().unwrap()).unwrap();
        let first_root_id = RootId::new(first.root_id).unwrap();

        let error = register_root_sync(&registry, &catalog, second_root.path().to_str().unwrap())
            .unwrap_err();
        let snapshot = list_library_sync(&registry, &catalog, &first_root_id).unwrap();

        assert_eq!(error.code, "ROOT_IDENTITY_AMBIGUOUS");
        assert_eq!(snapshot.sets.len(), 1);
        assert_eq!(snapshot.sets[0].display_name, "FIRST_SET");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "FIRST_PROJECT");
    }

    #[test]
    fn catalog_query_still_requires_live_root_authority() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        registry.close(&root_id).unwrap();

        let error = list_library_sync(&registry, &catalog, &root_id).unwrap_err();

        assert_eq!(error.code, "ROOT_NOT_APPROVED");
    }

    #[test]
    fn registration_stores_inventory_and_reregistration_uses_incremental_baseline() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio = root.path().join("SET_A/AUDIO/kick.wav");
        fs::write(&audio, b"audio fixture").unwrap();
        let before = fs::read(&audio).unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();

        let first = register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(first.root_id.clone()).unwrap();
        let first_snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert_eq!(first_snapshot.audio_assets.len(), 1);
        assert_eq!(first_snapshot.file_instances.len(), 1);
        assert_eq!(
            first_snapshot.file_instances[0].hash_freshness,
            ot_domain::ContentHashFreshness::ComputedThisScan
        );

        let second =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let second_snapshot =
            list_library_sync(&registry, &catalog, &RootId::new(second.root_id).unwrap()).unwrap();

        assert_eq!(
            second_snapshot.file_instances[0].hash_freshness,
            ot_domain::ContentHashFreshness::ReusedUnchangedMetadata
        );
        assert_eq!(fs::read(audio).unwrap(), before);
    }

    #[test]
    fn frontend_snapshot_dto_exposes_only_safe_file_inventory() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let snapshot =
            list_library_sync(&registry, &catalog, &RootId::new(session.root_id).unwrap()).unwrap();
        let content_hash = snapshot.file_instances[0].content_hash.as_str().to_owned();

        let identity = CatalogRootIdentity::new(session.device_fingerprint).unwrap();
        let dto = LibrarySnapshotDto::from_catalog_snapshot(&identity, snapshot);
        assert_eq!(dto.audio_files.len(), 1);
        assert_eq!(dto.audio_files[0].display_name, "kick.wav");
        assert_eq!(dto.audio_files[0].relative_path, "SET_A/AUDIO/kick.wav");
        assert_eq!(dto.audio_files[0].storage_scope, "set_audio_pool");
        assert!(dto.audio_files[0]
            .file_instance_id
            .starts_with("fileinst:v1:"));
        assert!(dto.audio_files[0].asset_id.starts_with("asset:v1:"));
        assert!(dto.usage_edges.is_empty());

        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("audioFiles"));
        assert!(json.contains("usageEdges"));
        assert!(!json.contains("contentHash"));
        assert!(!json.contains(&content_hash));
        assert!(!json.contains("modifiedAt"));
        assert!(!json.contains(identity.as_str()));
        assert!(!json.contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn frontend_snapshot_dto_exposes_usage_edges_with_relative_paths_only() {
        use ot_domain::{
            ContentHashFreshness, ParserProvenance, RootRelativePath, SampleSlotId, SampleSlotKind,
            StateDocument, StateDocumentKind, StateDocumentParseStatus, StateDocumentRole,
        };

        let identity = CatalogRootIdentity::new(format!("rootfp:v1:{}", "a".repeat(64))).unwrap();
        let audio = FileInstance {
            relative_path: RootRelativePath::parse("SET_A/AUDIO/kick.wav").unwrap(),
            content_hash: ContentHash::parse(format!("sha256:{}", "c".repeat(64))).unwrap(),
            byte_size: 12,
            modified_at_unix_ns: Some(1),
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        };
        let project_document = RootRelativePath::parse("SET_A/PROJECT_A/project.work").unwrap();
        let bank_document = RootRelativePath::parse("SET_A/PROJECT_A/bank01.work").unwrap();
        let provenance = ParserProvenance {
            parser_name: "fixture".into(),
            parser_revision: "1".into(),
            source_version: None,
            compatibility_evidence: None,
        };
        let snapshot = LibrarySnapshot {
            sets: vec![LibrarySet {
                display_name: "SET_A".into(),
                relative_path: RootRelativePath::parse("SET_A").unwrap(),
                has_audio_pool: true,
                projects: vec![LibraryProject {
                    display_name: "PROJECT_A".into(),
                    relative_path: RootRelativePath::parse("SET_A/PROJECT_A").unwrap(),
                    has_project_file: true,
                    has_banks: true,
                }],
            }],
            standalone_projects: vec![],
            audio_assets: vec![],
            file_instances: vec![audio.clone()],
            state_documents: vec![StateDocument {
                project_relative_path: RootRelativePath::parse("SET_A/PROJECT_A").unwrap(),
                source_relative_path: bank_document.clone(),
                kind: StateDocumentKind::Bank,
                role: StateDocumentRole::Working,
                bank_index: Some(0),
                parse_status: StateDocumentParseStatus::Parsed,
                parser_provenance: provenance,
            }],
            slot_assignments: vec![],
            usage_edges: vec![SampleUsageEdge {
                bank_document_relative_path: bank_document,
                project_document_relative_path: project_document,
                slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                usage_kind: SampleUsageKind::Machine,
                track_index: 0,
                part_index: Some(0),
                pattern_index: None,
                step_index: None,
                audible: true,
                referenced_file_relative_path: Some(audio.relative_path.clone()),
                reference_status: SampleReferenceStatus::Resolved,
            }],
            sample_settings: vec![],
        };

        let dto = LibrarySnapshotDto::from_catalog_snapshot(&identity, snapshot);
        assert_eq!(dto.usage_edges.len(), 1);
        assert_eq!(
            dto.usage_edges[0].referenced_file_relative_path.as_deref(),
            Some("SET_A/AUDIO/kick.wav")
        );
        assert_eq!(dto.usage_edges[0].slot_kind, "static");
        assert_eq!(dto.usage_edges[0].usage_kind, "machine");
        assert!(dto.usage_edges[0].audible);

        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("usageEdges"));
        assert!(json.contains("SET_A/PROJECT_A/bank01.work"));
        assert!(!json.contains("/private/"));
        assert!(!json.contains(identity.as_str()));
    }

    #[test]
    fn file_instance_ids_are_root_scoped_and_stable_across_content_changes() {
        let root_identity =
            CatalogRootIdentity::new(format!("rootfp:v1:{}", "a".repeat(64))).unwrap();
        let other_root_identity =
            CatalogRootIdentity::new(format!("rootfp:v1:{}", "b".repeat(64))).unwrap();
        let original = FileInstance {
            relative_path: ot_domain::RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap(),
            content_hash: ot_domain::ContentHash::parse(format!("sha256:{}", "c".repeat(64)))
                .unwrap(),
            byte_size: 1024,
            modified_at_unix_ns: Some(1),
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ot_domain::ContentHashFreshness::ComputedThisScan,
        };
        let changed_content = FileInstance {
            content_hash: ot_domain::ContentHash::parse(format!("sha256:{}", "d".repeat(64)))
                .unwrap(),
            byte_size: 2048,
            modified_at_unix_ns: Some(2),
            ..original.clone()
        };

        assert_eq!(
            opaque_file_instance_id(&root_identity, &original),
            opaque_file_instance_id(&root_identity, &changed_content)
        );
        assert_ne!(
            opaque_file_instance_id(&root_identity, &original),
            opaque_file_instance_id(&other_root_identity, &original)
        );
        assert_ne!(
            opaque_asset_id(&original.content_hash),
            opaque_asset_id(&changed_content.content_hash)
        );
    }

    #[test]
    fn manual_metadata_api_round_trips_without_touching_the_audio_fixture() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio = root.path().join("SET_A/AUDIO/kick.wav");
        fs::write(&audio, b"read-only audio fixture").unwrap();
        let before = fs::read(&audio).unwrap();
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();

        let saved = replace_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &asset_id,
            ReplaceManualAssetMetadataDto {
                tags: vec!["warm".into(), "kick".into()],
                note: Some("Main live kick".into()),
            },
        )
        .unwrap();
        let loaded =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id).unwrap();

        assert_eq!(saved.tags, vec!["kick", "warm"]);
        assert_eq!(saved.note.as_deref(), Some("Main live kick"));
        assert_eq!(loaded, saved);
        assert_eq!(fs::read(&audio).unwrap(), before);

        let json = serde_json::to_string(&loaded).unwrap();
        assert!(!json.contains("sha256:"));
        assert!(!json.contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn manual_metadata_api_rejects_invalid_or_unlisted_asset_ids() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        let raw_content_hash = snapshot.file_instances[0].content_hash.as_str();

        let raw_hash_error =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, raw_content_hash)
                .unwrap_err();
        let missing_error = load_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &format!("asset:v1:{}", "a".repeat(64)),
        )
        .unwrap_err();

        assert_eq!(raw_hash_error.code, "INVALID_ASSET_ID");
        assert_eq!(missing_error.code, "CATALOG_ASSET_NOT_FOUND");
    }

    #[test]
    fn manual_metadata_api_requires_live_root_authority() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();
        registry.close(&root_id).unwrap();

        let error =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id).unwrap_err();

        assert_eq!(error.code, "ROOT_NOT_APPROVED");
    }

    #[test]
    fn invalid_manual_metadata_is_rejected_before_replacing_existing_values() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();
        let original = replace_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &asset_id,
            ReplaceManualAssetMetadataDto {
                tags: vec!["kick".into()],
                note: Some("Keep this".into()),
            },
        )
        .unwrap();

        let error = replace_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &asset_id,
            ReplaceManualAssetMetadataDto {
                tags: vec!["duplicate".into(), "duplicate".into()],
                note: None,
            },
        )
        .unwrap_err();
        let loaded =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id).unwrap();

        assert_eq!(error.code, "INVALID_MANUAL_METADATA");
        assert_eq!(loaded, original);
    }

    #[test]
    fn waveform_and_preview_api_round_trip_without_exposing_paths_or_hashes() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio_path = root.path().join("SET_A/AUDIO/kick.wav");
        write_test_wav(&audio_path);
        let before = fs::read(&audio_path).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let audio = open_shared_audio_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();

        let waveform =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128).unwrap();
        let ticket =
            create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id).unwrap();
        let preview =
            read_audio_preview_sync(&registry, &audio, &root_id, &ticket.preview_token).unwrap();

        assert_eq!(waveform.analyzer_version, "waveform:v1");
        assert_eq!(waveform.sample_rate, 8_000);
        assert_eq!(waveform.channels, 1);
        assert!(!waveform.peaks.is_empty());
        assert_eq!(ticket.mime_type, "audio/wav");
        assert_eq!(&preview[0..4], b"RIFF");
        assert_eq!(&preview[8..12], b"WAVE");
        assert_eq!(preview.len(), ticket.byte_length);
        assert_eq!(fs::read(&audio_path).unwrap(), before);

        let response_json = format!(
            "{}{}",
            serde_json::to_string(&waveform).unwrap(),
            serde_json::to_string(&ticket).unwrap()
        );
        assert!(!response_json.contains("sha256:"));
        assert!(!response_json.contains(&asset_id));
        assert!(!response_json.contains(root.path().to_str().unwrap()));
        assert!(!ticket.preview_token.contains("kick"));
    }

    #[test]
    fn audio_api_uses_another_live_file_instance_for_the_same_asset() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let missing_path = root.path().join("SET_A/AUDIO/a-missing.wav");
        let live_path = root.path().join("SET_A/AUDIO/b-live.wav");
        write_test_wav(&missing_path);
        fs::copy(&missing_path, &live_path).unwrap();
        let live_before = fs::read(&live_path).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let audio = open_shared_audio_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot
            .audio_files
            .iter()
            .find(|file| file.relative_path.ends_with("a-missing.wav"))
            .unwrap()
            .asset_id
            .clone();
        assert_eq!(
            snapshot
                .audio_files
                .iter()
                .filter(|file| file.asset_id == asset_id)
                .count(),
            2
        );
        fs::remove_file(&missing_path).unwrap();

        let waveform =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128).unwrap();
        let ticket =
            create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id).unwrap();
        let preview =
            read_audio_preview_sync(&registry, &audio, &root_id, &ticket.preview_token).unwrap();

        assert!(!waveform.peaks.is_empty());
        assert_eq!(&preview[0..4], b"RIFF");
        assert_eq!(fs::read(&live_path).unwrap(), live_before);
    }

    #[test]
    fn audio_api_rehashes_the_source_and_requires_live_root_authority() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio_path = root.path().join("SET_A/AUDIO/kick.wav");
        write_test_wav(&audio_path);
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let audio = open_shared_audio_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();
        let ticket =
            create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id).unwrap();

        fs::write(&audio_path, b"changed after the catalog snapshot").unwrap();
        let changed =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128)
                .unwrap_err();
        assert_eq!(changed.code, "AUDIO_SOURCE_CHANGED");

        fs::remove_file(&audio_path).unwrap();
        let missing =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128)
                .unwrap_err();
        assert_eq!(missing.code, "AUDIO_SOURCE_UNAVAILABLE");

        registry.close(&root_id).unwrap();
        let closed = read_audio_preview_sync(&registry, &audio, &root_id, &ticket.preview_token)
            .unwrap_err();
        assert_eq!(closed.code, "ROOT_NOT_APPROVED");
    }

    #[test]
    fn api_errors_do_not_expose_absolute_paths_from_io_failures() {
        let leaked = "/private/var/folders/secret-octatrack-root/AUDIO/kick.wav";
        let registry_error = ApiError::from(RootRegistryError::Io(format!(
            "No such file or directory (os error 2): {leaked}"
        )));
        let write_error = write_runtime_error(WriteRuntimeError::Io(format!(
            "Permission denied: {leaked}"
        )));
        let executor_error = write_runtime_error(WriteRuntimeError::Executor(
            ot_executor::ExecutorError::Io(format!("failed to copy {leaked}")),
        ));
        let catalog = catalog_error(CatalogError::Unavailable {
            message: format!("sqlite open failed for {leaked}"),
        });

        for error in [&registry_error, &write_error, &executor_error, &catalog] {
            let json = serde_json::to_string(error).unwrap();
            assert!(!json.contains(leaked), "leaked path in {json}");
            assert!(
                !json.contains("/private/"),
                "absolute path fragment in {json}"
            );
            assert!(error.details.is_none(), "details must stay empty");
        }

        let audio_error = ApiError::from(AudioRuntimeError::Audio(AudioError::SourceUnavailable(
            format!("Permission denied: {leaked}"),
        )));
        let scan_error = storage_error(&format!("LIBRARY_SCAN_FAILED: No such file: {leaked}"));
        for error in [&audio_error, &scan_error] {
            let json = serde_json::to_string(error).unwrap();
            assert!(!json.contains(leaked), "leaked path in {json}");
            assert!(error.details.is_none(), "details must stay empty");
        }
    }

    #[cfg(unix)]
    #[test]
    fn plan_hash_rejects_a_symlinked_source_file() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("outside.wav");
        write_test_wav(&target);
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let linked = root.path().join("SET_A/AUDIO/kick.wav");
        symlink(&target, &linked).unwrap();

        let error = hash_live_source(&linked).unwrap_err();
        assert_eq!(error.code, "AUDIO_SOURCE_UNAVAILABLE");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains(outside.path().to_str().unwrap()));
    }

    fn collect_fixture_manifest(root: &Path) -> BTreeMap<String, String> {
        let mut entries = Vec::new();
        collect_manifest_paths(root, root, &mut entries);
        entries.sort();
        entries
            .into_iter()
            .map(|(relative, bytes)| (relative, format!("{:x}", Sha256::digest(bytes))))
            .collect()
    }

    fn collect_manifest_paths(root: &Path, current: &Path, output: &mut Vec<(String, Vec<u8>)>) {
        if let Ok(read_dir) = fs::read_dir(current) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path).unwrap();
                if metadata.file_type().is_symlink() {
                    continue;
                }
                if metadata.is_dir() {
                    collect_manifest_paths(root, &path, output);
                } else if metadata.is_file() {
                    let relative = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    output.push((relative, fs::read(&path).unwrap()));
                }
            }
        }
    }

    fn build_gate_c_planning_fixture(root: &Path) {
        let project_dir = root.join("SET/PROJECT");
        let audio_dir = root.join("SET/AUDIO");
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&audio_dir).unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/source_project/project.work");
        fs::copy(&fixture, project_dir.join("project.work")).unwrap();
        fs::copy(&fixture, project_dir.join("project.strd")).unwrap();
        fs::write(
            project_dir.join("bank01.work"),
            crate::test_fixtures::default_bank_bytes(),
        )
        .unwrap();
        fs::write(
            project_dir.join("bank01.strd"),
            crate::test_fixtures::default_bank_bytes(),
        )
        .unwrap();
        write_test_wav(&audio_dir.join("pad.wav"));
        write_test_wav(&audio_dir.join("unused.wav"));
    }

    #[test]
    fn rename_plan_api_is_read_only_and_returns_structured_plan() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let before = collect_fixture_manifest(root.path());
        let response = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap();
        let after = collect_fixture_manifest(root.path());
        assert_eq!(before, after);

        let RenamePlanResponseDto::Planned(plan) = response else {
            panic!("expected planned rename");
        };
        assert_eq!(plan.schema, "rename-plan:v1");
        assert!(plan.requires_explicit_approval);
        assert!(!plan.overwrite_allowed);
        assert!(plan.removes_source_on_apply);
        assert!(plan.reference_update_count > 0);
        assert!(plan
            .state_document_impacts
            .iter()
            .any(|impact| impact.role == "working"));
        assert!(plan
            .state_document_impacts
            .iter()
            .any(|impact| impact.role == "saved_checkpoint"));
        let json = serde_json::to_string(&plan).unwrap();
        assert!(!json.contains(root.path().to_str().unwrap()));
        assert!(!json.contains("sha256:"));

        let fetched = rename_runtime.get_plan(&root_id, &plan.plan_id).unwrap();
        assert_eq!(fetched.id.as_str(), plan.plan_id);

        let replay = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap();
        let RenamePlanResponseDto::Planned(replay_plan) = replay else {
            panic!("expected idempotent planned rename");
        };
        assert_eq!(replay_plan.plan_id, plan.plan_id);
    }

    #[test]
    fn rename_plan_api_reports_unused_sample_warning() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/unused.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/unused-renamed.wav",
        )
        .unwrap() else {
            panic!("expected planned unused-sample rename");
        };
        assert_eq!(plan.reference_update_count, 0);
        assert!(!plan.warnings.is_empty());
    }

    #[test]
    fn rename_plan_api_blocks_cross_directory_and_malformed_project() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "BaseProject");
        let source = root.path().join("SET_A/AUDIO/kick.wav");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        write_test_wav(&source);
        fs::write(
            root.path().join("SET_A/BaseProject/project.work"),
            b"broken",
        )
        .unwrap();

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET_A/AUDIO/kick.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let cross_dir = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET_A/AUDIO/sub/kick.wav",
        )
        .unwrap_err();
        assert_eq!(cross_dir.code, "INVALID_DESTINATION_PATH");

        let RenamePlanResponseDto::Blocked(blocked) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET_A/AUDIO/kick-2.wav",
        )
        .unwrap() else {
            panic!("expected blocked rename for malformed project");
        };
        assert_eq!(blocked.schema, "rename-blocked:v1");
        assert!(blocked
            .block_reasons
            .iter()
            .any(|reason| reason.code == "MALFORMED_STATE_DOCUMENT"));
        assert!(rename_runtime
            .get_plan(
                &root_id,
                "plan:v1:0000000000000000000000000000000000000000000000000000000000000000"
            )
            .is_err());
    }

    #[test]
    fn rename_get_plan_rejects_a_different_root_binding() {
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        build_gate_c_planning_fixture(first.path());
        create_set_project(second.path(), "SET_B", "PROJECT_B");
        write_test_wav(&second.path().join("SET_B/AUDIO/snare.wav"));

        let registry = multi_root_registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());
        let first_session =
            register_root_sync(&registry, &catalog, first.path().to_str().unwrap()).unwrap();
        let second_session =
            register_root_sync(&registry, &catalog, second.path().to_str().unwrap()).unwrap();
        let first_root = RootId::new(first_session.root_id).unwrap();
        let second_root = RootId::new(second_session.root_id).unwrap();
        let first_dto = list_library_dto_sync(&registry, &catalog, &first_root).unwrap();
        let source_id = first_dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &first_root);
        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &first_root,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };
        assert!(rename_runtime
            .get_plan(&second_root, &plan.plan_id)
            .is_err());
    }

    #[test]
    fn rename_plan_blocks_when_session_revision_lags_catalog_after_reregister() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());

        let first_session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(first_session.root_id).unwrap();
        gate_c_rescan_and_store(&registry, &catalog, &root_id).unwrap();
        gate_c_rescan_catalog_only(&registry, &catalog, &root_id).unwrap();
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let response = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap();

        let RenamePlanResponseDto::Blocked(blocked) = response else {
            panic!("expected blocked rename when session revision lags catalog");
        };
        assert!(blocked
            .block_reasons
            .iter()
            .any(|reason| reason.code == "CATALOG_REVISION_MISMATCH"));
    }

    #[test]
    fn rename_plan_succeeds_after_reregister_when_catalog_is_resynced() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());

        register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        gate_c_rescan_and_store(&registry, &catalog, &root_id).unwrap();
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let response = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap();

        assert!(matches!(response, RenamePlanResponseDto::Planned(_)));
    }

    #[test]
    fn rename_plan_api_rejects_stale_source_hash() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        fs::write(root.path().join("SET/AUDIO/pad.wav"), b"tampered-bytes").unwrap();

        let error = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap_err();
        assert_eq!(error.code, "CLONE_TAMPERED");
    }

    #[test]
    fn rename_plan_api_blocks_unicode_normalization_collision() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let nfd_name = "caf\u{0065}\u{0301}.wav";
        fs::write(root.path().join("SET/AUDIO").join(nfd_name), b"collision").unwrap();

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Blocked(blocked) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/café.wav",
        )
        .unwrap() else {
            panic!("expected blocked rename for normalization collision");
        };
        assert!(blocked.block_reasons.iter().any(|reason| {
            matches!(
                reason.code.as_str(),
                "DESTINATION_NORMALIZATION_COLLISION" | "DESTINATION_OCCUPIED"
            )
        }));
    }

    #[test]
    fn rename_plan_api_blocks_ascii_case_collision() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        fs::write(root.path().join("SET/AUDIO/NEW-PAD.WAV"), b"existing").unwrap();

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        let rename_runtime = rename_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Blocked(blocked) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected blocked rename for ascii case collision");
        };
        assert!(blocked.block_reasons.iter().any(|reason| {
            matches!(
                reason.code.as_str(),
                "DESTINATION_CASE_COLLISION"
                    | "DESTINATION_NORMALIZATION_COLLISION"
                    | "DESTINATION_OCCUPIED"
            )
        }));
    }

    #[test]
    fn rename_plan_api_expires_stored_plans() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let registry = registry();
        let (data_directory, catalog) = catalog();
        let local = data_directory.path();
        let rename_runtime = Arc::new(crate::rename_write_runtime::RenameWriteRuntime::new(
            ot_executor::ExecutorLocalPaths {
                staging_directory: local.join("staging"),
                backup_directory: local.join("backups"),
                journal_directory: local.join("journals"),
            },
            Duration::from_millis(1),
        ));
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };
        std::thread::sleep(Duration::from_millis(5));
        assert!(rename_runtime.get_plan(&root_id, &plan.plan_id).is_err());
    }

    #[test]
    fn rename_phase2_happy_path_reaches_prepared_without_touching_source_root() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());
        let before = collect_fixture_manifest(root.path());

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());
        let write = write_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        enable_write_sync(&registry, &catalog, &write, &root_id).unwrap();

        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };

        let authority = authorize_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
        )
        .unwrap();
        assert_eq!(authority.schema, "rename-authority:v1");
        assert!(!serde_json::to_string(&authority)
            .unwrap()
            .contains(root.path().to_str().unwrap()));

        let backup = create_rename_backup_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
            &authority.authority_id,
        )
        .unwrap();
        assert!(backup.verified);
        assert_eq!(backup.state, "backup_verified");

        let prepared = prepare_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
            &authority.authority_id,
            &backup.snapshot_id,
        )
        .unwrap();
        assert_eq!(prepared.state, "prepared");
        assert_eq!(prepared.operation_id, plan.operation_id);

        let status =
            rename_status_sync(&registry, &rename_runtime, &root_id, &plan.operation_id).unwrap();
        assert_eq!(status.state, "prepared");
        assert!(!status.plan_expired);

        assert_eq!(before, collect_fixture_manifest(root.path()));
    }

    #[test]
    fn rename_apply_happy_path_commits_and_rescans() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());
        let write = write_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        enable_write_sync(&registry, &catalog, &write, &root_id).unwrap();

        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };

        let authority = authorize_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
        )
        .unwrap();
        let backup = create_rename_backup_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
            &authority.authority_id,
        )
        .unwrap();
        prepare_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
            &authority.authority_id,
            &backup.snapshot_id,
        )
        .unwrap();

        let resolved = registry.resolve(&root_id).unwrap();
        let clone_authority = clone_runtime
            .issue_clone_authority(&resolved)
            .expect("clone authority");
        let applied = apply_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
            &plan.plan_id,
            &authority.authority_id,
            &backup.snapshot_id,
            &clone_authority.clone_authority_id,
        )
        .unwrap();
        assert_eq!(applied.mutation_state, "committed");
        assert_eq!(applied.verification_state, "passed");
        assert!(applied.rescan_completed);
        assert_eq!(applied.missing_reference_count, 0);

        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        assert!(dto
            .audio_files
            .iter()
            .any(|file| file.relative_path == "SET/AUDIO/new-pad.wav"));
        assert!(!dto
            .audio_files
            .iter()
            .any(|file| file.relative_path == "SET/AUDIO/pad.wav"));
    }

    #[test]
    fn rename_authorize_rejects_stale_plan_after_enable_write_rescan() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());
        let write = write_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);

        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };

        enable_write_sync(&registry, &catalog, &write, &root_id).unwrap();

        let error = authorize_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
        )
        .unwrap_err();
        assert_eq!(error.code, "CATALOG_REVISION_MISMATCH");
    }

    #[test]
    fn rename_authorize_requires_write_grant() {
        let root = TempDir::new().unwrap();
        build_gate_c_planning_fixture(root.path());

        let registry = registry();
        let (data_directory, catalog) = catalog();
        let rename_runtime = rename_runtime(data_directory.path());
        let write = write_runtime(data_directory.path());
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let clone_runtime = open_test_clone_runtime(data_directory.path());
        install_fixture_clone_verification(&clone_runtime, &registry, &root_id);
        let dto = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        let RenamePlanResponseDto::Planned(plan) = plan_rename_sample_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &rename_runtime,
            &root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap() else {
            panic!("expected planned rename");
        };

        let error = authorize_rename_sync(
            &registry,
            &catalog,
            &clone_runtime,
            &write,
            &rename_runtime,
            &root_id,
            &plan.plan_id,
        )
        .unwrap_err();
        assert_eq!(error.code, "WRITE_NOT_ENABLED");
    }

    #[test]
    fn rename_replan_clears_authority_before_backup() {
        let fixture = setup_rename_through_backup();
        let dto =
            list_library_dto_sync(&fixture.registry, &fixture.catalog, &fixture.root_id).unwrap();
        let source_id = dto
            .audio_files
            .iter()
            .find(|file| file.relative_path == "SET/AUDIO/pad.wav")
            .unwrap()
            .file_instance_id
            .clone();

        plan_rename_sample_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.rename_runtime,
            &fixture.root_id,
            &source_id,
            "SET/AUDIO/new-pad.wav",
        )
        .unwrap();

        let error = create_rename_backup_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.write,
            &fixture.rename_runtime,
            &fixture.root_id,
            &fixture.plan_id,
            &fixture.authority_id,
        )
        .unwrap_err();
        assert_eq!(error.code, "AUTHORITY_NOT_FOUND");
    }

    #[test]
    fn rename_prepare_rejects_tampered_backup() {
        let fixture = setup_rename_through_backup();
        let manifest_path =
            backup_snapshot_directory(fixture.data_directory.path(), &fixture.snapshot_id)
                .join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["recovery_binding"] =
            serde_json::Value::String(format!("recovery-binding:rename:v1:{}", "d".repeat(64)));
        fs::write(manifest_path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();

        let error = prepare_rename_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.write,
            &fixture.rename_runtime,
            &fixture.root_id,
            &fixture.plan_id,
            &fixture.authority_id,
            &fixture.snapshot_id,
        )
        .unwrap_err();
        assert_eq!(error.code, "BACKUP_FAILED");
    }

    #[test]
    fn rename_prepare_rejects_snapshot_mismatch() {
        let fixture = setup_rename_through_backup();
        let wrong_snapshot = format!("snapshot:v1:{}", "a".repeat(64));

        let error = prepare_rename_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.write,
            &fixture.rename_runtime,
            &fixture.root_id,
            &fixture.plan_id,
            &fixture.authority_id,
            &wrong_snapshot,
        )
        .unwrap_err();
        assert_eq!(error.code, "SNAPSHOT_MISMATCH");
    }

    #[test]
    fn rename_recovery_status_lists_prepared_without_recovery_required() {
        let fixture = setup_rename_through_backup();
        prepare_rename_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.write,
            &fixture.rename_runtime,
            &fixture.root_id,
            &fixture.plan_id,
            &fixture.authority_id,
            &fixture.snapshot_id,
        )
        .unwrap();

        let data_path = fixture.data_directory.path().to_path_buf();
        let restarted = rename_runtime(&data_path);
        let recovery =
            rename_recovery_status_sync(&fixture.registry, &restarted, &fixture.root_id).unwrap();
        assert!(!recovery.recovery_required);
        assert_eq!(recovery.operations.len(), 1);
        assert_eq!(recovery.operations[0].state, "prepared");
        assert!(recovery.operations[0].plan_expired);
        assert!(recovery.operations[0].plan_id.is_none());
    }

    #[test]
    fn rename_status_survives_runtime_restart_from_journal() {
        let fixture = setup_rename_through_backup();
        let prepared = prepare_rename_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.write,
            &fixture.rename_runtime,
            &fixture.root_id,
            &fixture.plan_id,
            &fixture.authority_id,
            &fixture.snapshot_id,
        )
        .unwrap();
        assert_eq!(prepared.state, "prepared");

        let data_path = fixture.data_directory.path().to_path_buf();
        let restarted = rename_runtime(&data_path);
        let status = rename_status_sync(
            &fixture.registry,
            &restarted,
            &fixture.root_id,
            &fixture.operation_id,
        )
        .unwrap();
        assert_eq!(status.state, "prepared");
        assert!(status.plan_expired);
        assert!(status.plan_id.is_none());
    }

    #[test]
    fn rename_status_rejects_tampered_journal_after_restart() {
        let fixture = setup_rename_through_backup();
        prepare_rename_sync(
            &fixture.registry,
            &fixture.catalog,
            &fixture.clone_runtime,
            &fixture.write,
            &fixture.rename_runtime,
            &fixture.root_id,
            &fixture.plan_id,
            &fixture.authority_id,
            &fixture.snapshot_id,
        )
        .unwrap();

        fs::write(
            rename_journal_path(fixture.data_directory.path(), &fixture.operation_id),
            br#"{"schema":"broken"}"#,
        )
        .unwrap();

        let restarted = rename_runtime(fixture.data_directory.path());
        let error = rename_status_sync(
            &fixture.registry,
            &restarted,
            &fixture.root_id,
            &fixture.operation_id,
        )
        .unwrap_err();
        assert_eq!(error.code, "JOURNAL_FAILED");
    }

    #[test]
    fn rename_concurrent_prepare_calls_are_idempotent() {
        let fixture = setup_rename_through_backup();
        let registry = &fixture.registry;
        let catalog = &fixture.catalog;
        let write = &fixture.write;
        let clone_runtime = Arc::clone(&fixture.clone_runtime);
        let rename_runtime = Arc::clone(&fixture.rename_runtime);
        let root_id = fixture.root_id.clone();
        let plan_id = fixture.plan_id.clone();
        let authority_id = fixture.authority_id.clone();
        let snapshot_id = fixture.snapshot_id.clone();
        let expected_operation_id = fixture.operation_id.clone();

        thread::scope(|scope| {
            let first_handle = scope.spawn(|| {
                prepare_rename_sync(
                    registry,
                    catalog,
                    &clone_runtime,
                    write,
                    &rename_runtime,
                    &root_id,
                    &plan_id,
                    &authority_id,
                    &snapshot_id,
                )
            });
            let second_handle = scope.spawn(|| {
                prepare_rename_sync(
                    registry,
                    catalog,
                    &clone_runtime,
                    write,
                    &rename_runtime,
                    &root_id,
                    &plan_id,
                    &authority_id,
                    &snapshot_id,
                )
            });

            let first = first_handle.join().unwrap();
            let second = second_handle.join().unwrap();
            match (&first, &second) {
                (Ok(left), Ok(right)) => {
                    assert_eq!(left.operation_id, expected_operation_id);
                    assert_eq!(right.operation_id, expected_operation_id);
                    assert_eq!(left.state, "prepared");
                    assert_eq!(right.state, "prepared");
                }
                (Ok(prepared), Err(error)) | (Err(error), Ok(prepared)) => {
                    assert_eq!(prepared.operation_id, expected_operation_id);
                    assert_eq!(prepared.state, "prepared");
                    assert_eq!(error.code, "ROOT_BUSY");
                }
                (Err(left), Err(right)) => {
                    panic!("unexpected concurrent prepare failures: {left:?}, {right:?}");
                }
            }
        });
    }
}
