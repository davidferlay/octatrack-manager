//! Non-destructive auto-slice draft editing. Persistence performs revision CAS.
use crate::onsets::{OnsetProposal, MAX_DRAFT_MARKERS};
use crate::slicing::{FrameRange, PcmFrame};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DraftMarker {
    pub id: String,
    pub start: PcmFrame,
    pub locked: bool,
    pub manual: bool,
    pub candidate_id: Option<String>,
    pub estimated_attack: Option<PcmFrame>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SliceDraft {
    pub revision: u64,
    pub region: FrameRange,
    pub markers: Vec<DraftMarker>,
    pub suppressed_candidate_ids: BTreeSet<String>,
    pub exclusions: Vec<FrameRange>,
}

#[derive(Clone, Debug)]
pub enum SliceEdit {
    AcceptProposal(OnsetProposal),
    Move {
        marker_id: String,
        frame: PcmFrame,
    },
    Insert {
        marker_id: String,
        frame: PcmFrame,
    },
    Delete {
        marker_id: String,
    },
    SetLock {
        marker_id: String,
        locked: bool,
    },
    /// Clears markers and binds the draft to a new analysis region (revision CAS at persistence).
    ReplaceRegion(FrameRange),
}

impl SliceDraft {
    pub fn empty(region: FrameRange) -> Self {
        Self {
            revision: 0,
            region,
            markers: Vec::new(),
            suppressed_candidate_ids: BTreeSet::new(),
            exclusions: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.markers.len() > MAX_DRAFT_MARKERS
            || self.exclusions.len() > MAX_DRAFT_MARKERS
            || self.suppressed_candidate_ids.len() > 32_768
            || self.revision > i64::MAX as u64
        {
            return Err("draft resource limit exceeded");
        }
        let mut ids = BTreeSet::new();
        for marker in &self.markers {
            if !self.region.contains(marker.start)
                || marker.id.is_empty()
                || marker.id.len() > 160
                || !ids.insert(&marker.id)
                || marker
                    .candidate_id
                    .as_ref()
                    .is_some_and(|id| id.len() > 160)
                || marker
                    .estimated_attack
                    .is_some_and(|f| !self.region.contains(f))
            {
                return Err("invalid draft marker");
            }
        }
        if self
            .markers
            .windows(2)
            .any(|pair| pair[0].start >= pair[1].start)
            || self.exclusions.iter().any(|r| {
                r.start() < self.region.start() || r.end_exclusive() > self.region.end_exclusive()
            })
            || self
                .suppressed_candidate_ids
                .iter()
                .any(|id| id.is_empty() || id.len() > 160)
        {
            return Err("invalid draft ordering or exclusion");
        }
        Ok(())
    }

    /// Return a new value; any validation failure leaves the original untouched.
    /// The database increments the revision atomically with all marker changes.
    pub fn edited(&self, edit: SliceEdit, sample_rate: u32) -> Result<Self, &'static str> {
        self.validate()?;
        let mut next = self.clone();
        match edit {
            SliceEdit::AcceptProposal(proposal) => {
                if proposal.candidates.len() > MAX_DRAFT_MARKERS {
                    return Err("proposal exceeds draft marker limit");
                }
                next.markers.retain(|m| m.manual || m.locked);
                for candidate in proposal.candidates {
                    if !self.region.contains(candidate.estimated_attack)
                        || !self.region.contains(candidate.suggested_start)
                    {
                        return Err("proposal is outside draft region");
                    }
                    if next.suppressed_candidate_ids.contains(&candidate.id)
                        || next
                            .exclusions
                            .iter()
                            .any(|r| r.contains(candidate.estimated_attack))
                        || next.markers.iter().any(|m| {
                            m.start == candidate.suggested_start
                                || m.candidate_id.as_ref() == Some(&candidate.id)
                        })
                    {
                        continue;
                    }
                    next.markers.push(DraftMarker {
                        id: candidate.id.clone(),
                        start: candidate.suggested_start,
                        locked: false,
                        manual: false,
                        candidate_id: Some(candidate.id),
                        estimated_attack: Some(candidate.estimated_attack),
                    });
                }
            }
            SliceEdit::Move { marker_id, frame } => {
                let marker = next
                    .markers
                    .iter_mut()
                    .find(|m| m.id == marker_id)
                    .ok_or("marker not found")?;
                marker.start = frame;
                marker.manual = true;
                marker.locked = true;
            }
            SliceEdit::Insert { marker_id, frame } => next.markers.push(DraftMarker {
                id: marker_id,
                start: frame,
                manual: true,
                locked: true,
                candidate_id: None,
                estimated_attack: None,
            }),
            SliceEdit::Delete { marker_id } => {
                let index = next
                    .markers
                    .iter()
                    .position(|m| m.id == marker_id)
                    .ok_or("marker not found")?;
                let marker = next.markers.remove(index);
                if let Some(id) = marker.candidate_id {
                    next.suppressed_candidate_ids.insert(id);
                }
                let center = marker.estimated_attack.unwrap_or(marker.start).get();
                let radius = PcmFrame::from_microseconds(2_000, sample_rate)
                    .map_err(|_| "invalid sample rate")?
                    .get();
                next.exclusions.push(
                    FrameRange::new(
                        PcmFrame::new(center.saturating_sub(radius).max(self.region.start().get())),
                        PcmFrame::new(
                            center
                                .saturating_add(radius + 1)
                                .min(self.region.end_exclusive().get()),
                        ),
                    )
                    .map_err(|_| "invalid exclusion")?,
                );
            }
            SliceEdit::SetLock { marker_id, locked } => {
                let marker = next
                    .markers
                    .iter_mut()
                    .find(|m| m.id == marker_id)
                    .ok_or("marker not found")?;
                marker.locked = locked;
                // Unlock is the user's explicit permission to regenerate this boundary.
                if !locked {
                    marker.manual = false;
                }
            }
            SliceEdit::ReplaceRegion(region) => {
                next = SliceDraft {
                    revision: self.revision,
                    region,
                    markers: Vec::new(),
                    suppressed_candidate_ids: BTreeSet::new(),
                    exclusions: Vec::new(),
                };
            }
        }
        next.markers
            .sort_by(|a, b| a.start.cmp(&b.start).then(a.id.cmp(&b.id)));
        next.validate()?;
        Ok(next)
    }

    pub fn marker_range(&self, id: &str) -> Result<FrameRange, &'static str> {
        let index = self
            .markers
            .iter()
            .position(|m| m.id == id)
            .ok_or("marker not found")?;
        let end = self
            .markers
            .get(index + 1)
            .map(|m| m.start)
            .unwrap_or(self.region.end_exclusive());
        FrameRange::new(self.markers[index].start, end).map_err(|_| "invalid marker range")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onsets::OnsetCandidate;
    fn frame(value: u64) -> PcmFrame {
        PcmFrame::new(value)
    }
    fn region() -> FrameRange {
        FrameRange::new(frame(0), frame(48_000)).unwrap()
    }
    fn proposal(id: &str, attack: u64) -> OnsetProposal {
        OnsetProposal {
            candidates: vec![OnsetCandidate {
                id: id.into(),
                novelty_peak: frame(attack),
                estimated_attack: frame(attack),
                suggested_start: frame(attack),
                uncertainty: FrameRange::new(frame(attack), frame(attack + 1)).unwrap(),
                score: 5.0,
                strength: 0.6,
                band_scores: [5.0; 3],
                threshold_margin: 1.0,
                warnings: vec![],
            }],
            suppressed: vec![],
        }
    }
    #[test]
    fn manual_edit_survives_reanalysis_and_delete_cannot_resurrect_nearby() {
        let draft = SliceDraft::empty(region())
            .edited(SliceEdit::AcceptProposal(proposal("a", 1000)), 48_000)
            .unwrap();
        let moved = draft
            .edited(
                SliceEdit::Move {
                    marker_id: "a".into(),
                    frame: frame(900),
                },
                48_000,
            )
            .unwrap();
        let again = moved
            .edited(SliceEdit::AcceptProposal(proposal("a", 1000)), 48_000)
            .unwrap();
        assert_eq!(again.markers[0].start, frame(900));
        assert!(again.markers[0].locked);
        let deleted = again
            .edited(
                SliceEdit::Delete {
                    marker_id: "a".into(),
                },
                48_000,
            )
            .unwrap();
        assert!(deleted
            .edited(SliceEdit::AcceptProposal(proposal("a", 1000)), 48_000)
            .unwrap()
            .markers
            .is_empty());
        assert!(deleted
            .edited(SliceEdit::AcceptProposal(proposal("new-id", 1001)), 48_000)
            .unwrap()
            .markers
            .is_empty());
    }
    #[test]
    fn replace_region_clears_markers_and_exclusions() {
        let draft = SliceDraft::empty(region())
            .edited(SliceEdit::AcceptProposal(proposal("a", 1000)), 48_000)
            .unwrap();
        let narrower = FrameRange::new(frame(500), frame(2_000)).unwrap();
        let replaced = draft
            .edited(SliceEdit::ReplaceRegion(narrower), 48_000)
            .unwrap();
        assert_eq!(replaced.region, narrower);
        assert!(replaced.markers.is_empty());
        assert!(replaced.exclusions.is_empty());
        assert!(replaced.suppressed_candidate_ids.is_empty());
        assert_eq!(replaced.revision, draft.revision);
    }

    #[test]
    fn invalid_edit_preserves_original_and_end_is_not_a_marker() {
        let draft = SliceDraft::empty(region())
            .edited(
                SliceEdit::Insert {
                    marker_id: "manual".into(),
                    frame: frame(4),
                },
                48_000,
            )
            .unwrap();
        assert!(draft
            .edited(
                SliceEdit::Insert {
                    marker_id: "other".into(),
                    frame: frame(4)
                },
                48_000
            )
            .is_err());
        assert!(draft
            .edited(
                SliceEdit::Move {
                    marker_id: "manual".into(),
                    frame: frame(48_000)
                },
                48_000
            )
            .is_err());
        assert_eq!(draft.markers[0].start, frame(4));
        assert_eq!(
            draft.marker_range("manual").unwrap().end_exclusive(),
            frame(48_000)
        );
    }
}
