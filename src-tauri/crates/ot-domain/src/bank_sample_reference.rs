//! Bank ChangePlan sample-slot reference inventory (Project-side observations).

use crate::project_structure::{
    BankIndex, PartIndex, PatternIndex, TrackIndex, TrackSlotReference,
};
use crate::{RootRelativePath, SampleReferenceStatus, StateDocumentRole};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ReferenceOrigin {
    ActiveMachine,
    SampleLock,
    SavedPartMachine,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum PartStateRole {
    Working,
    Saved,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ReferenceScopeRole {
    SourceContent,
    DestinationCurrent,
    OperatedBank,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReferenceClassStatus {
    Covered,
    ExcludedByContract,
    Unmodeled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReferenceCoverageAggregate {
    CompleteForChangePlanReview,
    Partial,
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReferenceCoverage {
    pub active_machine: ReferenceClassStatus,
    pub sample_locks: ReferenceClassStatus,
    pub saved_parts: ReferenceClassStatus,
    pub inactive_machine_slots: ReferenceClassStatus,
    pub recorder_setup: ReferenceClassStatus,
}

impl ReferenceCoverage {
    pub fn complete_for_changeplan_review() -> Self {
        Self {
            active_machine: ReferenceClassStatus::Covered,
            sample_locks: ReferenceClassStatus::Covered,
            saved_parts: ReferenceClassStatus::Covered,
            inactive_machine_slots: ReferenceClassStatus::ExcludedByContract,
            recorder_setup: ReferenceClassStatus::Unmodeled,
        }
    }

    pub fn aggregate(self) -> ReferenceCoverageAggregate {
        if self.inactive_machine_slots != ReferenceClassStatus::ExcludedByContract {
            return ReferenceCoverageAggregate::Blocked;
        }
        if self.active_machine != ReferenceClassStatus::Covered
            || self.sample_locks != ReferenceClassStatus::Covered
            || self.saved_parts != ReferenceClassStatus::Covered
        {
            return ReferenceCoverageAggregate::Partial;
        }
        ReferenceCoverageAggregate::CompleteForChangePlanReview
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankSampleReferenceObservation {
    pub bank: BankIndex,
    pub document_role: StateDocumentRole,
    pub origin: ReferenceOrigin,
    pub part_state: PartStateRole,
    pub part: PartIndex,
    pub pattern: Option<PatternIndex>,
    pub track: TrackIndex,
    pub step: Option<u8>,
    pub target: TrackSlotReference,
    pub audible: Option<bool>,
    pub reference_status: Option<SampleReferenceStatus>,
    pub referenced_relative_path: Option<RootRelativePath>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankReferenceInventory {
    pub observed_revision: u64,
    pub observations: Vec<BankSampleReferenceObservation>,
    pub coverage: ReferenceCoverage,
}

impl BankReferenceInventory {
    pub fn empty(observed_revision: u64) -> Self {
        Self {
            observed_revision,
            observations: Vec::new(),
            coverage: ReferenceCoverage::complete_for_changeplan_review(),
        }
    }
}
