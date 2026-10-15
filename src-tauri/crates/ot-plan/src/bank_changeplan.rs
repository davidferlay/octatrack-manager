//! Read-only Bank Copy / Move / Swap ChangePlan (`MO-PSE-BANK-CHANGEPLAN-CORE-1`, #181).
//!
//! Produces a deterministic, reviewable plan without destination bytes, Apply,
//! or [`crate::bank_mutation::BankMutationEnvelope`].

use crate::bank_mutation::{diff_manifests, ReadinessEvidence, ReadinessGap, TreeManifest};
use crate::{
    encode_field, validate_prefixed_sha256, PlanError, PlanId, PLAN_ID_PREFIX,
    ROOT_FINGERPRINT_PREFIX,
};
use ot_domain::bank_state_documents::{
    bank_state_document_path, evaluate_bank_operation_state_effect, ActiveBankRetarget,
    BankStateDocOperation, BankStateDocumentRef, BankStateDocumentSet,
    CopySavedCheckpointSemantics, StateDocOperationBlockReason, StateDocOperationVerdict,
};
use ot_domain::project_structure::{
    state_role_rank, BankIndex, MachineKind, PartIndex, PartStructure, PatternIndex,
    ProjectArrangementSelection, ProjectBankSelection, ProjectStructure, TrackIndex, TrackPlayback,
    TrackSlotReference, TrackStructure, UnmodeledDependency,
};
use ot_domain::{
    BankReferenceInventory, BankSampleReferenceObservation, ContentHash, ReferenceClassStatus,
    ReferenceCoverage, ReferenceCoverageAggregate, ReferenceOrigin, ReferenceScopeRole, RootId,
    RootRelativePath, SampleReferenceStatus, SampleSlotKind, StateDocumentParseStatus,
    StateDocumentRole,
};
use sha2::{Digest, Sha256};
use std::fmt;

pub const BANK_CHANGEPLAN_SCHEMA: &str = "masterocta.bank-changeplan:v1";
const BANK_CHANGEPLAN_CANONICAL_PREFIX: &[u8] = b"masterocta:bank-changeplan:v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankChangeOperation {
    Copy,
    Move,
    Swap,
}

impl BankChangeOperation {
    fn code(self) -> u8 {
        match self {
            Self::Copy => 1,
            Self::Move => 2,
            Self::Swap => 3,
        }
    }

    fn to_state_doc(self) -> BankStateDocOperation {
        match self {
            Self::Copy => BankStateDocOperation::Copy,
            Self::Move => BankStateDocOperation::Move,
            Self::Swap => BankStateDocOperation::Swap,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankChangeIntent {
    Copy {
        source: BankIndex,
        destination: BankIndex,
    },
    Move {
        source: BankIndex,
        destination: BankIndex,
    },
    Swap {
        source: BankIndex,
        destination: BankIndex,
    },
}

impl BankChangeIntent {
    pub fn operation(self) -> BankChangeOperation {
        match self {
            Self::Copy { .. } => BankChangeOperation::Copy,
            Self::Move { .. } => BankChangeOperation::Move,
            Self::Swap { .. } => BankChangeOperation::Swap,
        }
    }

    pub fn source(self) -> BankIndex {
        match self {
            Self::Copy { source, .. } | Self::Move { source, .. } | Self::Swap { source, .. } => {
                source
            }
        }
    }

    pub fn destination(self) -> BankIndex {
        match self {
            Self::Copy { destination, .. }
            | Self::Move { destination, .. }
            | Self::Swap { destination, .. } => destination,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankChangePlanningFacts {
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub observed_revision: u64,
    pub identity_is_stable: bool,
    pub read_model_schema: String,
    pub project_relative_path: RootRelativePath,
    pub project_structure: ProjectStructure,
    pub scope_manifest: TreeManifest,
    pub source_presence: BankStateDocumentSet,
    pub destination_presence: BankStateDocumentSet,
    pub reference_inventory: BankReferenceInventory,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankChangePlanReferenceObservation {
    pub scope: ReferenceScopeRole,
    pub bank: BankIndex,
    pub document_role: StateDocumentRole,
    pub origin: ReferenceOrigin,
    pub part_state: ot_domain::PartStateRole,
    pub part: PartIndex,
    pub pattern: Option<PatternIndex>,
    pub track: TrackIndex,
    pub step: Option<u8>,
    pub target: TrackSlotReference,
    pub audible: Option<bool>,
    pub reference_status: Option<SampleReferenceStatus>,
    pub referenced_relative_path: Option<RootRelativePath>,
}

impl From<(ReferenceScopeRole, BankSampleReferenceObservation)>
    for BankChangePlanReferenceObservation
{
    fn from((scope, observation): (ReferenceScopeRole, BankSampleReferenceObservation)) -> Self {
        Self {
            scope,
            bank: observation.bank,
            document_role: observation.document_role,
            origin: observation.origin,
            part_state: observation.part_state,
            part: observation.part,
            pattern: observation.pattern,
            track: observation.track,
            step: observation.step,
            target: observation.target,
            audible: observation.audible,
            reference_status: observation.reference_status,
            referenced_relative_path: observation.referenced_relative_path,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PreconditionPresence {
    Absent,
    File {
        byte_size: u64,
        content_hash: ContentHash,
    },
    Directory,
    Symlink {
        target_digest: ContentHash,
    },
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FilePrecondition {
    pub relative_path: RootRelativePath,
    pub presence: PreconditionPresence,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadDependencyDocument {
    pub relative_path: RootRelativePath,
    pub bank: Option<BankIndex>,
    pub role: Option<StateDocumentRole>,
    pub parse_status: Option<StateDocumentParseStatus>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CandidateChangeDocument {
    pub relative_path: RootRelativePath,
    pub bank: BankIndex,
    pub role: StateDocumentRole,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedPatternObservation {
    pub bank: BankIndex,
    pub role: StateDocumentRole,
    pub pattern: PatternIndex,
    pub part: PartIndex,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedPartObservation {
    pub bank: BankIndex,
    pub role: StateDocumentRole,
    pub part: PartIndex,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedTrackObservation {
    pub bank: BankIndex,
    pub role: StateDocumentRole,
    pub part: PartIndex,
    pub track: TrackIndex,
    pub playback: TrackPlayback,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedSampleReferenceObservation {
    pub bank: BankIndex,
    pub role: StateDocumentRole,
    pub part: PartIndex,
    pub track: TrackIndex,
    pub slot: TrackSlotReference,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BankChangePlanBlocker {
    WorkingSavedCheckpointRuleUnresolved,
    OperationRuleBlocked,
    CopySavedCheckpointSemanticsUnknown,
    MoveVacatedSourceUnknown,
    ActiveBankRetargetUnknown,
    ActiveBankSelectionUnavailable,
    BankInternalIdentityUnresolved,
    ArrangerPatternReferencesUnresolved,
    SceneAndRecorderDependenciesUnresolved,
    ApplyAuthorizationUnresolved,
    ArrangementMappingUnprovenForTarget,
    StateDocumentPresenceStop,
    SwapRolePresenceAsymmetric,
    CrossRolePairRejected,
    BankIdentityMismatch,
    DocumentMalformed,
    DocumentUnsupportedVersion,
    NonRegularPrecondition,
    UnmodeledDependency(UnmodeledDependency),
    ReadinessGap(ReadinessGap),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BankChangePlanExecutionReadiness {
    Blocked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupRequirementDeclaration {
    pub required: bool,
    pub relative_paths: Vec<RootRelativePath>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VerificationRequirementKind {
    RereadAffectedBankDocuments,
    ReparseProjectStructure,
    RecheckPatternPartRelationships,
    RecheckPartTrackSampleReferences,
    RereadProjectState,
    UnrelatedProjectEntriesUnchanged,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationRequirementDeclaration {
    pub requirements: Vec<VerificationRequirementKind>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankStateDocumentEffectSummary {
    pub copy_saved_checkpoint_semantics: CopySavedCheckpointSemantics,
    pub active_bank_retarget: ActiveBankRetarget,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankChangePlan {
    id: PlanId,
    pub schema: String,
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub base_observed_revision: u64,
    pub read_model_schema: String,
    pub project_relative_path: RootRelativePath,
    pub operation: BankChangeOperation,
    pub source: BankIndex,
    pub destination: BankIndex,
    pub scope_manifest: TreeManifest,
    pub read_dependencies: Vec<ReadDependencyDocument>,
    pub candidate_change_documents: Vec<CandidateChangeDocument>,
    pub source_document_presence: BankStateDocumentSet,
    pub destination_document_presence: BankStateDocumentSet,
    pub affected_patterns: Vec<AffectedPatternObservation>,
    pub affected_parts: Vec<AffectedPartObservation>,
    pub affected_tracks: Vec<AffectedTrackObservation>,
    pub affected_sample_references: Vec<AffectedSampleReferenceObservation>,
    pub reference_observations: Vec<BankChangePlanReferenceObservation>,
    pub reference_coverage: ReferenceCoverage,
    pub reference_coverage_aggregate: ReferenceCoverageAggregate,
    pub project_state_observation: Option<ot_domain::project_structure::ProjectStateDocument>,
    pub state_document_effect: BankStateDocumentEffectSummary,
    pub unmodeled_dependencies: Vec<UnmodeledDependency>,
    pub readiness_gaps: Vec<ReadinessGap>,
    pub blockers: Vec<BankChangePlanBlocker>,
    pub preconditions: Vec<FilePrecondition>,
    pub backup_requirement: BackupRequirementDeclaration,
    pub verification_requirement: VerificationRequirementDeclaration,
    pub execution_readiness: BankChangePlanExecutionReadiness,
}

impl BankChangePlan {
    pub fn id(&self) -> &PlanId {
        &self.id
    }

    pub fn execution_authorized(&self) -> bool {
        false
    }

    pub fn validate_integrity(&self) -> Result<(), PlanError> {
        let expected = derive_bank_changeplan_id(self);
        if expected == self.id {
            Ok(())
        } else {
            Err(PlanError::IntegrityMismatch)
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BankChangePlanStaleness {
    Fresh,
    Stale,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BankChangePlanError {
    InvalidRootFingerprint,
    UnstableRootIdentity,
    InvalidObservedRevision,
    SourceEqualsDestination,
    ProjectPathMismatch,
    BankPresenceMismatch,
    ReadinessEvidenceMismatch,
    ReferenceInventoryRevisionMismatch,
    Plan(PlanError),
}

impl fmt::Display for BankChangePlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRootFingerprint => {
                formatter.write_str("device fingerprint is not a supported versioned value")
            }
            Self::UnstableRootIdentity => {
                formatter.write_str("bank change planning requires a stable root identity")
            }
            Self::InvalidObservedRevision => {
                formatter.write_str("observed root revision must be non-zero")
            }
            Self::SourceEqualsDestination => {
                formatter.write_str("source and destination banks must differ")
            }
            Self::ProjectPathMismatch => {
                formatter.write_str("project structure path does not match planning facts")
            }
            Self::BankPresenceMismatch => formatter.write_str(
                "bank state document presence does not match the declared bank or the project structure",
            ),
            Self::ReadinessEvidenceMismatch => {
                formatter.write_str("readiness evidence is not current_main()")
            }
            Self::ReferenceInventoryRevisionMismatch => formatter.write_str(
                "reference inventory observed revision does not match planning facts",
            ),
            Self::Plan(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for BankChangePlanError {}

impl From<PlanError> for BankChangePlanError {
    fn from(value: PlanError) -> Self {
        Self::Plan(value)
    }
}

pub fn plan_bank_change(
    intent: BankChangeIntent,
    facts: &BankChangePlanningFacts,
    readiness: &ReadinessEvidence,
) -> Result<BankChangePlan, BankChangePlanError> {
    validate_facts(intent, facts, readiness)?;

    let source = intent.source();
    let destination = intent.destination();
    let operation = intent.operation();
    let active_bank = active_bank_index(&facts.project_structure);

    let state_effect = evaluate_bank_operation_state_effect(
        operation.to_state_doc(),
        source,
        destination,
        facts.source_presence,
        facts.destination_presence,
        active_bank,
    );

    let mut blockers = blockers_from_state_effect(&state_effect);
    append_semantic_blockers(operation, &state_effect, &mut blockers);
    append_document_blockers(&facts.project_structure, source, destination, &mut blockers);
    append_target_blockers(&facts.project_structure, &mut blockers);

    let readiness_gaps = readiness.open_gaps();
    for gap in &readiness_gaps {
        blockers.push(blocker_for_gap(*gap));
    }

    let unmodeled = collect_unmodeled(&facts.project_structure, source, destination);
    for dependency in &unmodeled {
        blockers.push(BankChangePlanBlocker::UnmodeledDependency(*dependency));
    }

    let read_dependencies = build_read_dependencies(
        &facts.project_relative_path,
        &facts.project_structure,
        &facts.source_presence,
        &facts.destination_presence,
    );
    let candidate_change_documents =
        build_candidate_documents(&state_effect, &facts.project_relative_path);
    let preconditions = build_preconditions(
        &facts.scope_manifest,
        &read_dependencies,
        &candidate_change_documents,
        &facts.project_relative_path,
    );
    append_non_regular_precondition_blockers(&preconditions, &mut blockers);
    blockers.sort_by_key(blocker_rank);
    blockers.dedup();

    let (affected_patterns, affected_parts, affected_tracks, affected_sample_references) =
        enumerate_affected_references(&facts.project_structure, source, destination, operation);
    let reference_observations =
        scoped_reference_observations(&facts.reference_inventory, source, destination, operation);
    let reference_coverage = facts.reference_inventory.coverage;
    let reference_coverage_aggregate = reference_coverage.aggregate();

    let backup_paths: Vec<_> = candidate_change_documents
        .iter()
        .map(|document| document.relative_path.clone())
        .collect();

    let plan_body = BankChangePlan {
        id: PlanId::parse(format!("{PLAN_ID_PREFIX}{}", "0".repeat(64))).expect("placeholder"),
        schema: BANK_CHANGEPLAN_SCHEMA.to_owned(),
        root_id: facts.root_id.clone(),
        device_fingerprint: facts.device_fingerprint.clone(),
        base_observed_revision: facts.observed_revision,
        read_model_schema: facts.read_model_schema.clone(),
        project_relative_path: facts.project_relative_path.clone(),
        operation,
        source,
        destination,
        scope_manifest: facts.scope_manifest.clone(),
        read_dependencies,
        candidate_change_documents,
        source_document_presence: facts.source_presence,
        destination_document_presence: facts.destination_presence,
        affected_patterns,
        affected_parts,
        affected_tracks,
        affected_sample_references,
        reference_observations,
        reference_coverage,
        reference_coverage_aggregate,
        project_state_observation: facts.project_structure.project_state.clone(),
        state_document_effect: BankStateDocumentEffectSummary {
            copy_saved_checkpoint_semantics: state_effect.copy_saved_checkpoint_semantics,
            active_bank_retarget: state_effect.active_bank_retarget,
        },
        unmodeled_dependencies: unmodeled,
        readiness_gaps,
        blockers,
        preconditions,
        backup_requirement: BackupRequirementDeclaration {
            required: true,
            relative_paths: backup_paths,
        },
        verification_requirement: default_verification_requirements(),
        execution_readiness: BankChangePlanExecutionReadiness::Blocked,
    };

    let id = derive_bank_changeplan_id(&plan_body);
    Ok(BankChangePlan { id, ..plan_body })
}

pub fn check_bank_changeplan_staleness(
    plan: &BankChangePlan,
    fresh_manifest: &TreeManifest,
) -> BankChangePlanStaleness {
    if diff_manifests(&plan.scope_manifest, fresh_manifest).is_empty() {
        BankChangePlanStaleness::Fresh
    } else {
        BankChangePlanStaleness::Stale
    }
}

fn validate_facts(
    intent: BankChangeIntent,
    facts: &BankChangePlanningFacts,
    readiness: &ReadinessEvidence,
) -> Result<(), BankChangePlanError> {
    if !readiness_matches_current_main(readiness) {
        return Err(BankChangePlanError::ReadinessEvidenceMismatch);
    }
    if validate_prefixed_sha256(&facts.device_fingerprint, ROOT_FINGERPRINT_PREFIX).is_err() {
        return Err(BankChangePlanError::InvalidRootFingerprint);
    }
    if !facts.identity_is_stable {
        return Err(BankChangePlanError::UnstableRootIdentity);
    }
    if facts.observed_revision == 0 {
        return Err(BankChangePlanError::InvalidObservedRevision);
    }
    if intent.source() == intent.destination() {
        return Err(BankChangePlanError::SourceEqualsDestination);
    }
    if facts.project_structure.project_relative_path != facts.project_relative_path {
        return Err(BankChangePlanError::ProjectPathMismatch);
    }
    if facts.source_presence.bank != intent.source()
        || facts.destination_presence.bank != intent.destination()
        || !presence_matches_structure(&facts.source_presence, &facts.project_structure)
        || !presence_matches_structure(&facts.destination_presence, &facts.project_structure)
    {
        return Err(BankChangePlanError::BankPresenceMismatch);
    }
    if facts.reference_inventory.observed_revision != facts.observed_revision {
        return Err(BankChangePlanError::ReferenceInventoryRevisionMismatch);
    }
    Ok(())
}

fn scoped_reference_observations(
    inventory: &BankReferenceInventory,
    source: BankIndex,
    destination: BankIndex,
    operation: BankChangeOperation,
) -> Vec<BankChangePlanReferenceObservation> {
    let mut out = Vec::new();
    for observation in &inventory.observations {
        let scope = match operation {
            BankChangeOperation::Copy if observation.bank == source => {
                Some(ReferenceScopeRole::SourceContent)
            }
            BankChangeOperation::Copy if observation.bank == destination => {
                Some(ReferenceScopeRole::DestinationCurrent)
            }
            BankChangeOperation::Move | BankChangeOperation::Swap
                if observation.bank == source || observation.bank == destination =>
            {
                Some(ReferenceScopeRole::OperatedBank)
            }
            _ => None,
        };
        if let Some(scope) = scope {
            out.push(BankChangePlanReferenceObservation::from((
                scope,
                observation.clone(),
            )));
        }
    }
    out.sort_by(compare_plan_reference);
    out
}

fn compare_plan_reference(
    left: &BankChangePlanReferenceObservation,
    right: &BankChangePlanReferenceObservation,
) -> std::cmp::Ordering {
    scope_rank(left.scope)
        .cmp(&scope_rank(right.scope))
        .then_with(|| left.bank.get().cmp(&right.bank.get()))
        .then_with(|| {
            state_role_rank(left.document_role).cmp(&state_role_rank(right.document_role))
        })
        .then_with(|| origin_rank(left.origin).cmp(&origin_rank(right.origin)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
        .then_with(|| pattern_key(left.pattern).cmp(&pattern_key(right.pattern)))
        .then_with(|| left.track.get().cmp(&right.track.get()))
        .then_with(|| step_key(left.step).cmp(&step_key(right.step)))
        .then_with(|| format!("{:?}", left.target).cmp(&format!("{:?}", right.target)))
}

fn scope_rank(scope: ReferenceScopeRole) -> u8 {
    match scope {
        ReferenceScopeRole::SourceContent => 0,
        ReferenceScopeRole::DestinationCurrent => 1,
        ReferenceScopeRole::OperatedBank => 2,
    }
}

fn origin_rank(origin: ReferenceOrigin) -> u8 {
    match origin {
        ReferenceOrigin::ActiveMachine => 0,
        ReferenceOrigin::SampleLock => 1,
        ReferenceOrigin::SavedPartMachine => 2,
    }
}

fn pattern_key(pattern: Option<PatternIndex>) -> u8 {
    pattern.map(|index| index.get()).unwrap_or(255)
}

fn step_key(step: Option<u8>) -> u8 {
    step.unwrap_or(255)
}

fn presence_matches_structure(set: &BankStateDocumentSet, structure: &ProjectStructure) -> bool {
    structure
        .bank(set.bank, StateDocumentRole::Working)
        .is_some()
        == set.working_present
        && structure
            .bank(set.bank, StateDocumentRole::SavedCheckpoint)
            .is_some()
            == set.saved_checkpoint_present
}

fn active_bank_index(structure: &ProjectStructure) -> Option<BankIndex> {
    let state = structure.project_state.as_ref()?;
    match state.bank? {
        ProjectBankSelection::Selected(index) => Some(index),
        ProjectBankSelection::Unrecognized(_) => None,
    }
}

fn blockers_from_state_effect(
    effect: &ot_domain::bank_state_documents::BankOperationStateEffect,
) -> Vec<BankChangePlanBlocker> {
    let StateDocOperationVerdict::Blocked(reason) = effect.verdict;
    vec![match reason {
        StateDocOperationBlockReason::OperationRuleBlocked => {
            BankChangePlanBlocker::OperationRuleBlocked
        }
        StateDocOperationBlockReason::WorkingSavedCheckpointRuleUnresolved => {
            BankChangePlanBlocker::WorkingSavedCheckpointRuleUnresolved
        }
        StateDocOperationBlockReason::PresenceStop(_) => {
            BankChangePlanBlocker::StateDocumentPresenceStop
        }
        StateDocOperationBlockReason::BankIdentityMismatch => {
            BankChangePlanBlocker::BankIdentityMismatch
        }
        StateDocOperationBlockReason::SwapRolePresenceAsymmetric => {
            BankChangePlanBlocker::SwapRolePresenceAsymmetric
        }
        StateDocOperationBlockReason::CrossRolePairRejected => {
            BankChangePlanBlocker::CrossRolePairRejected
        }
    }]
}

fn append_semantic_blockers(
    operation: BankChangeOperation,
    effect: &ot_domain::bank_state_documents::BankOperationStateEffect,
    blockers: &mut Vec<BankChangePlanBlocker>,
) {
    if effect.copy_saved_checkpoint_semantics == CopySavedCheckpointSemantics::Unknown
        && operation == BankChangeOperation::Copy
    {
        blockers.push(BankChangePlanBlocker::CopySavedCheckpointSemanticsUnknown);
    }
    if operation == BankChangeOperation::Move {
        blockers.push(BankChangePlanBlocker::MoveVacatedSourceUnknown);
    }
    match effect.active_bank_retarget {
        ActiveBankRetarget::Unknown => {
            blockers.push(BankChangePlanBlocker::ActiveBankRetargetUnknown);
        }
        ActiveBankRetarget::SelectionUnavailable => {
            blockers.push(BankChangePlanBlocker::ActiveBankSelectionUnavailable);
        }
        ActiveBankRetarget::NotApplicable => {}
    }
}

fn append_document_blockers(
    structure: &ProjectStructure,
    source: BankIndex,
    destination: BankIndex,
    blockers: &mut Vec<BankChangePlanBlocker>,
) {
    for bank in [source, destination] {
        for role in [
            StateDocumentRole::Working,
            StateDocumentRole::SavedCheckpoint,
        ] {
            let Some(document) = structure.bank(bank, role) else {
                continue;
            };
            push_parse_status_blocker(document.parse_status, blockers);
        }
    }
    if let Some(state) = structure.project_state.as_ref() {
        push_parse_status_blocker(state.parse_status, blockers);
    }
}

fn push_parse_status_blocker(
    status: StateDocumentParseStatus,
    blockers: &mut Vec<BankChangePlanBlocker>,
) {
    match status {
        StateDocumentParseStatus::Malformed => {
            blockers.push(BankChangePlanBlocker::DocumentMalformed);
        }
        StateDocumentParseStatus::UnsupportedVersion => {
            blockers.push(BankChangePlanBlocker::DocumentUnsupportedVersion);
        }
        StateDocumentParseStatus::Parsed => {}
    }
}

fn append_target_blockers(structure: &ProjectStructure, blockers: &mut Vec<BankChangePlanBlocker>) {
    let Some(state) = structure.project_state.as_ref() else {
        return;
    };
    if matches!(
        state.arrangement,
        Some(ProjectArrangementSelection::Unrecognized(_))
    ) {
        blockers.push(BankChangePlanBlocker::ArrangementMappingUnprovenForTarget);
    }
}

fn blocker_for_gap(gap: ReadinessGap) -> BankChangePlanBlocker {
    match gap {
        ReadinessGap::BankChangePlan => BankChangePlanBlocker::ReadinessGap(gap),
        ReadinessGap::ArrangementFileSlot => BankChangePlanBlocker::ReadinessGap(gap),
        ReadinessGap::ArrangerPatternReferences => {
            BankChangePlanBlocker::ArrangerPatternReferencesUnresolved
        }
        ReadinessGap::BankInternalIdentity => BankChangePlanBlocker::BankInternalIdentityUnresolved,
        ReadinessGap::SceneAndRecorderDependencies => {
            BankChangePlanBlocker::SceneAndRecorderDependenciesUnresolved
        }
        ReadinessGap::WorkingSavedCheckpointRule => {
            BankChangePlanBlocker::WorkingSavedCheckpointRuleUnresolved
        }
        ReadinessGap::ApplyAuthorization => BankChangePlanBlocker::ApplyAuthorizationUnresolved,
    }
}

fn blocker_rank(blocker: &BankChangePlanBlocker) -> u8 {
    match blocker {
        BankChangePlanBlocker::BankIdentityMismatch => 0,
        BankChangePlanBlocker::StateDocumentPresenceStop => 1,
        BankChangePlanBlocker::SwapRolePresenceAsymmetric => 2,
        BankChangePlanBlocker::CrossRolePairRejected => 3,
        BankChangePlanBlocker::DocumentMalformed => 4,
        BankChangePlanBlocker::DocumentUnsupportedVersion => 5,
        BankChangePlanBlocker::NonRegularPrecondition => 6,
        BankChangePlanBlocker::WorkingSavedCheckpointRuleUnresolved => 10,
        BankChangePlanBlocker::OperationRuleBlocked => 11,
        BankChangePlanBlocker::CopySavedCheckpointSemanticsUnknown => 12,
        BankChangePlanBlocker::MoveVacatedSourceUnknown => 13,
        BankChangePlanBlocker::ActiveBankRetargetUnknown => 14,
        BankChangePlanBlocker::ActiveBankSelectionUnavailable => 15,
        BankChangePlanBlocker::ArrangementMappingUnprovenForTarget => 16,
        BankChangePlanBlocker::UnmodeledDependency(_) => 20,
        BankChangePlanBlocker::ArrangerPatternReferencesUnresolved => 30,
        BankChangePlanBlocker::BankInternalIdentityUnresolved => 31,
        BankChangePlanBlocker::SceneAndRecorderDependenciesUnresolved => 32,
        BankChangePlanBlocker::ApplyAuthorizationUnresolved => 33,
        BankChangePlanBlocker::ReadinessGap(_) => 40,
    }
}

fn collect_unmodeled(
    structure: &ProjectStructure,
    source: BankIndex,
    destination: BankIndex,
) -> Vec<UnmodeledDependency> {
    let mut dependencies = Vec::new();
    for bank in [source, destination] {
        for role in [
            StateDocumentRole::Working,
            StateDocumentRole::SavedCheckpoint,
        ] {
            if let Some(entry) = structure.bank(bank, role) {
                for dependency in &entry.unmodeled {
                    if !dependencies.contains(dependency) {
                        dependencies.push(*dependency);
                    }
                }
            }
        }
    }
    dependencies.sort_by_key(|dependency| unmodeled_code(*dependency));
    dependencies
}

fn build_read_dependencies(
    project_relative_path: &RootRelativePath,
    structure: &ProjectStructure,
    source_presence: &BankStateDocumentSet,
    destination_presence: &BankStateDocumentSet,
) -> Vec<ReadDependencyDocument> {
    let mut path_strings = Vec::new();
    let mut push_path = |path: RootRelativePath| {
        let key = path.as_str().to_owned();
        if !path_strings.iter().any(|existing| existing == &key) {
            path_strings.push(key);
        }
    };
    push_path(join_project_file(project_relative_path, "project.work"));

    for role in [
        StateDocumentRole::Working,
        StateDocumentRole::SavedCheckpoint,
    ] {
        if source_presence.has_role(role) {
            push_path(bank_state_document_path(
                project_relative_path,
                source_presence.bank,
                role,
            ));
        }
    }
    for role in [
        StateDocumentRole::Working,
        StateDocumentRole::SavedCheckpoint,
    ] {
        if destination_presence.has_role(role) {
            push_path(bank_state_document_path(
                project_relative_path,
                destination_presence.bank,
                role,
            ));
        }
    }

    path_strings.sort();
    let mut out = Vec::new();
    for key in path_strings {
        let path = RootRelativePath::parse(&key).expect("sorted fixture paths");
        let (bank, role, parse_status) = structure
            .banks
            .iter()
            .find(|bank| bank.source_relative_path == path)
            .map(|bank| (Some(bank.bank), Some(bank.role), Some(bank.parse_status)))
            .unwrap_or((None, None, None));
        if path.as_str().ends_with("project.work") {
            out.push(ReadDependencyDocument {
                relative_path: path,
                bank: None,
                role: Some(StateDocumentRole::Working),
                parse_status: structure
                    .project_state
                    .as_ref()
                    .map(|state| state.parse_status),
            });
        } else {
            out.push(ReadDependencyDocument {
                relative_path: path,
                bank,
                role,
                parse_status,
            });
        }
    }
    out.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });
    out
}

fn build_candidate_documents(
    effect: &ot_domain::bank_state_documents::BankOperationStateEffect,
    project_relative_path: &RootRelativePath,
) -> Vec<CandidateChangeDocument> {
    let mut out: Vec<CandidateChangeDocument> = effect
        .candidate_documents
        .iter()
        .map(|reference| document_ref_to_candidate(reference, project_relative_path))
        .collect();
    out.sort_by(|left, right| {
        left.bank
            .get()
            .cmp(&right.bank.get())
            .then_with(|| state_role_rank(left.role).cmp(&state_role_rank(right.role)))
            .then_with(|| {
                left.relative_path
                    .as_str()
                    .cmp(right.relative_path.as_str())
            })
    });
    out
}

fn document_ref_to_candidate(
    reference: &BankStateDocumentRef,
    project_relative_path: &RootRelativePath,
) -> CandidateChangeDocument {
    CandidateChangeDocument {
        relative_path: bank_state_document_path(
            project_relative_path,
            reference.bank,
            reference.role,
        ),
        bank: reference.bank,
        role: reference.role,
    }
}

fn build_preconditions(
    manifest: &TreeManifest,
    read_dependencies: &[ReadDependencyDocument],
    candidates: &[CandidateChangeDocument],
    project_relative_path: &RootRelativePath,
) -> Vec<FilePrecondition> {
    let mut path_strings = Vec::new();
    for dependency in read_dependencies {
        let key = dependency.relative_path.as_str().to_owned();
        if !path_strings.contains(&key) {
            path_strings.push(key);
        }
    }
    for candidate in candidates {
        let key = candidate.relative_path.as_str().to_owned();
        if !path_strings.contains(&key) {
            path_strings.push(key);
        }
    }
    let _ = project_relative_path;
    path_strings.sort();
    let mut out = Vec::new();
    for key in path_strings {
        let path = RootRelativePath::parse(&key).expect("sorted precondition paths");
        out.push(FilePrecondition {
            relative_path: path.clone(),
            presence: manifest_entry_precondition(manifest.get(&path)),
        });
    }
    out.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });
    out
}

fn manifest_entry_precondition(
    entry: Option<&crate::bank_mutation::ManifestEntry>,
) -> PreconditionPresence {
    match entry {
        None => PreconditionPresence::Absent,
        Some(crate::bank_mutation::ManifestEntry::File {
            byte_size,
            content_hash,
        }) => PreconditionPresence::File {
            byte_size: *byte_size,
            content_hash: content_hash.clone(),
        },
        Some(crate::bank_mutation::ManifestEntry::Directory) => PreconditionPresence::Directory,
        Some(crate::bank_mutation::ManifestEntry::Symlink { target_digest }) => {
            PreconditionPresence::Symlink {
                target_digest: target_digest.clone(),
            }
        }
        Some(crate::bank_mutation::ManifestEntry::Other) => PreconditionPresence::Other,
    }
}

fn append_non_regular_precondition_blockers(
    preconditions: &[FilePrecondition],
    blockers: &mut Vec<BankChangePlanBlocker>,
) {
    if preconditions.iter().any(|precondition| {
        !matches!(
            precondition.presence,
            PreconditionPresence::Absent | PreconditionPresence::File { .. }
        )
    }) {
        blockers.push(BankChangePlanBlocker::NonRegularPrecondition);
    }
}

fn enumerate_affected_references(
    structure: &ProjectStructure,
    source: BankIndex,
    destination: BankIndex,
    operation: BankChangeOperation,
) -> (
    Vec<AffectedPatternObservation>,
    Vec<AffectedPartObservation>,
    Vec<AffectedTrackObservation>,
    Vec<AffectedSampleReferenceObservation>,
) {
    let banks = affected_banks(source, destination, operation);
    let mut patterns = Vec::new();
    let mut parts = Vec::new();
    let mut tracks = Vec::new();
    let mut samples = Vec::new();

    for bank in banks {
        for role in [
            StateDocumentRole::Working,
            StateDocumentRole::SavedCheckpoint,
        ] {
            let Some(document) = structure.bank(bank, role) else {
                continue;
            };
            if document.parse_status != StateDocumentParseStatus::Parsed {
                continue;
            }
            for pattern in &document.patterns {
                patterns.push(AffectedPatternObservation {
                    bank,
                    role,
                    pattern: pattern.index,
                    part: pattern.part,
                });
            }
            for part in &document.parts {
                if !parts.iter().any(|existing: &AffectedPartObservation| {
                    existing.bank == bank && existing.role == role && existing.part == part.index
                }) {
                    parts.push(AffectedPartObservation {
                        bank,
                        role,
                        part: part.index,
                    });
                }
                for track in &part.tracks {
                    tracks.push(AffectedTrackObservation {
                        bank,
                        role,
                        part: part.index,
                        track: track.index,
                        playback: track.playback,
                    });
                    push_sample_refs(bank, role, part, track, &mut samples);
                }
            }
        }
    }

    patterns.sort_by(compare_pattern);
    parts.sort_by(compare_part);
    tracks.sort_by(compare_track);
    samples.sort_by(compare_sample);

    (patterns, parts, tracks, samples)
}

fn affected_banks(
    source: BankIndex,
    destination: BankIndex,
    operation: BankChangeOperation,
) -> Vec<BankIndex> {
    match operation {
        BankChangeOperation::Copy => vec![source, destination],
        BankChangeOperation::Move | BankChangeOperation::Swap => vec![source, destination],
    }
}

fn push_sample_refs(
    bank: BankIndex,
    role: StateDocumentRole,
    part: &PartStructure,
    track: &TrackStructure,
    out: &mut Vec<AffectedSampleReferenceObservation>,
) {
    let TrackPlayback::Audio { slot, .. } = track.playback else {
        return;
    };
    out.push(AffectedSampleReferenceObservation {
        bank,
        role,
        part: part.index,
        track: track.index,
        slot,
    });
}

fn compare_pattern(
    left: &AffectedPatternObservation,
    right: &AffectedPatternObservation,
) -> std::cmp::Ordering {
    left.bank
        .get()
        .cmp(&right.bank.get())
        .then_with(|| state_role_rank(left.role).cmp(&state_role_rank(right.role)))
        .then_with(|| left.pattern.get().cmp(&right.pattern.get()))
}

fn compare_part(
    left: &AffectedPartObservation,
    right: &AffectedPartObservation,
) -> std::cmp::Ordering {
    left.bank
        .get()
        .cmp(&right.bank.get())
        .then_with(|| state_role_rank(left.role).cmp(&state_role_rank(right.role)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
}

fn compare_track(
    left: &AffectedTrackObservation,
    right: &AffectedTrackObservation,
) -> std::cmp::Ordering {
    left.bank
        .get()
        .cmp(&right.bank.get())
        .then_with(|| state_role_rank(left.role).cmp(&state_role_rank(right.role)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
        .then_with(|| left.track.get().cmp(&right.track.get()))
}

fn compare_sample(
    left: &AffectedSampleReferenceObservation,
    right: &AffectedSampleReferenceObservation,
) -> std::cmp::Ordering {
    left.bank
        .get()
        .cmp(&right.bank.get())
        .then_with(|| state_role_rank(left.role).cmp(&state_role_rank(right.role)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
        .then_with(|| left.track.get().cmp(&right.track.get()))
        .then_with(|| format!("{:?}", left.slot).cmp(&format!("{:?}", right.slot)))
}

fn default_verification_requirements() -> VerificationRequirementDeclaration {
    VerificationRequirementDeclaration {
        requirements: vec![
            VerificationRequirementKind::RereadAffectedBankDocuments,
            VerificationRequirementKind::ReparseProjectStructure,
            VerificationRequirementKind::RecheckPatternPartRelationships,
            VerificationRequirementKind::RecheckPartTrackSampleReferences,
            VerificationRequirementKind::RereadProjectState,
            VerificationRequirementKind::UnrelatedProjectEntriesUnchanged,
        ],
    }
}

fn join_project_file(
    project_relative_path: &RootRelativePath,
    file_name: &str,
) -> RootRelativePath {
    RootRelativePath::from_components(project_relative_path.as_str().split('/').chain([file_name]))
        .expect("project file names are single components")
}

pub fn derive_bank_changeplan_id(plan: &BankChangePlan) -> PlanId {
    let mut hasher = Sha256::new();
    hasher.update(BANK_CHANGEPLAN_CANONICAL_PREFIX);
    encode_field(&mut hasher, 1, plan.schema.as_bytes());
    encode_field(&mut hasher, 2, plan.read_model_schema.as_bytes());
    encode_field(&mut hasher, 3, plan.root_id.as_str().as_bytes());
    encode_field(&mut hasher, 4, plan.device_fingerprint.as_bytes());
    encode_field(&mut hasher, 5, &plan.base_observed_revision.to_be_bytes());
    encode_field(
        &mut hasher,
        6,
        plan.project_relative_path.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 7, &[plan.operation.code()]);
    encode_field(&mut hasher, 8, &[plan.source.get()]);
    encode_field(&mut hasher, 9, &[plan.destination.get()]);

    encode_count(&mut hasher, 10, plan.scope_manifest.len());
    for (path, entry) in plan.scope_manifest.iter() {
        encode_field(&mut hasher, 11, path.as_str().as_bytes());
        encode_field(&mut hasher, 12, &[manifest_entry_tag(entry)]);
        match entry {
            crate::bank_mutation::ManifestEntry::File {
                byte_size,
                content_hash,
            } => {
                encode_field(&mut hasher, 13, &byte_size.to_be_bytes());
                encode_field(&mut hasher, 14, content_hash.as_str().as_bytes());
            }
            crate::bank_mutation::ManifestEntry::Symlink { target_digest } => {
                encode_field(&mut hasher, 15, target_digest.as_str().as_bytes());
            }
            crate::bank_mutation::ManifestEntry::Directory
            | crate::bank_mutation::ManifestEntry::Other => {}
        }
    }

    encode_read_dependencies(&mut hasher, &plan.read_dependencies);
    encode_candidates(&mut hasher, &plan.candidate_change_documents);
    encode_presence_set(&mut hasher, 40, &plan.source_document_presence);
    encode_presence_set(&mut hasher, 41, &plan.destination_document_presence);
    encode_patterns(&mut hasher, &plan.affected_patterns);
    encode_parts(&mut hasher, &plan.affected_parts);
    encode_tracks(&mut hasher, &plan.affected_tracks);
    encode_samples(&mut hasher, &plan.affected_sample_references);
    encode_reference_observations(&mut hasher, &plan.reference_observations);
    encode_field(
        &mut hasher,
        60,
        &reference_coverage_bytes(plan.reference_coverage),
    );
    encode_field(
        &mut hasher,
        61,
        &[reference_coverage_aggregate_code(
            plan.reference_coverage_aggregate,
        )],
    );
    encode_preconditions(&mut hasher, &plan.preconditions);
    encode_blockers(&mut hasher, &plan.blockers);
    encode_backup(&mut hasher, &plan.backup_requirement);
    encode_verification(&mut hasher, &plan.verification_requirement);
    encode_count(&mut hasher, 90, plan.unmodeled_dependencies.len());
    for dependency in &plan.unmodeled_dependencies {
        encode_field(&mut hasher, 91, &[unmodeled_code(*dependency)]);
    }
    encode_count(&mut hasher, 92, plan.readiness_gaps.len());
    for gap in &plan.readiness_gaps {
        encode_field(&mut hasher, 93, &[readiness_gap_code(*gap)]);
    }
    encode_field(
        &mut hasher,
        94,
        &[state_doc_semantics_code(
            plan.state_document_effect.copy_saved_checkpoint_semantics,
        )],
    );
    encode_field(
        &mut hasher,
        95,
        &[active_bank_retarget_code(
            plan.state_document_effect.active_bank_retarget,
        )],
    );
    encode_field(
        &mut hasher,
        96,
        &[execution_readiness_code(plan.execution_readiness)],
    );

    let digest = hasher.finalize();
    PlanId(format!("{PLAN_ID_PREFIX}{digest:x}"))
}

fn encode_count(hasher: &mut Sha256, tag: u8, count: usize) {
    encode_field(hasher, tag, &(count as u64).to_be_bytes());
}

fn encode_read_dependencies(hasher: &mut Sha256, dependencies: &[ReadDependencyDocument]) {
    encode_count(hasher, 20, dependencies.len());
    for dependency in dependencies {
        encode_field(hasher, 21, dependency.relative_path.as_str().as_bytes());
        encode_field(hasher, 22, &[optional_bank_code(dependency.bank)]);
        encode_field(hasher, 23, &[optional_role_code(dependency.role)]);
        encode_field(hasher, 24, &[optional_parse_code(dependency.parse_status)]);
    }
}

fn encode_candidates(hasher: &mut Sha256, candidates: &[CandidateChangeDocument]) {
    encode_count(hasher, 30, candidates.len());
    for candidate in candidates {
        encode_field(hasher, 31, candidate.relative_path.as_str().as_bytes());
        encode_field(hasher, 32, &[candidate.bank.get()]);
        encode_field(hasher, 33, &[role_code(candidate.role)]);
    }
}

fn encode_presence_set(hasher: &mut Sha256, tag: u8, set: &BankStateDocumentSet) {
    encode_field(hasher, tag, &[set.bank.get()]);
    encode_field(
        hasher,
        tag + 1,
        &[
            u8::from(set.working_present),
            u8::from(set.saved_checkpoint_present),
        ],
    );
}

fn encode_patterns(hasher: &mut Sha256, patterns: &[AffectedPatternObservation]) {
    encode_count(hasher, 50, patterns.len());
    for pattern in patterns {
        encode_field(
            hasher,
            51,
            &[
                pattern.bank.get(),
                role_code(pattern.role),
                pattern.pattern.get(),
                pattern.part.get(),
            ],
        );
    }
}

fn encode_parts(hasher: &mut Sha256, parts: &[AffectedPartObservation]) {
    encode_count(hasher, 52, parts.len());
    for part in parts {
        encode_field(
            hasher,
            53,
            &[part.bank.get(), role_code(part.role), part.part.get()],
        );
    }
}

fn encode_tracks(hasher: &mut Sha256, tracks: &[AffectedTrackObservation]) {
    encode_count(hasher, 54, tracks.len());
    for track in tracks {
        let mut bytes = vec![
            track.bank.get(),
            role_code(track.role),
            track.part.get(),
            track.track.get(),
        ];
        bytes.extend(track_playback_bytes(track.playback));
        encode_field(hasher, 55, &bytes);
    }
}

fn encode_samples(hasher: &mut Sha256, samples: &[AffectedSampleReferenceObservation]) {
    encode_count(hasher, 56, samples.len());
    for sample in samples {
        let mut bytes = vec![
            sample.bank.get(),
            role_code(sample.role),
            sample.part.get(),
            sample.track.get(),
        ];
        bytes.extend(slot_reference_bytes(sample.slot));
        encode_field(hasher, 57, &bytes);
    }
}

fn encode_preconditions(hasher: &mut Sha256, preconditions: &[FilePrecondition]) {
    encode_count(hasher, 70, preconditions.len());
    for precondition in preconditions {
        encode_field(hasher, 71, precondition.relative_path.as_str().as_bytes());
        match &precondition.presence {
            PreconditionPresence::Absent => encode_field(hasher, 72, &[0]),
            PreconditionPresence::File {
                byte_size,
                content_hash,
            } => {
                encode_field(hasher, 72, &[1]);
                encode_field(hasher, 73, &byte_size.to_be_bytes());
                encode_field(hasher, 74, content_hash.as_str().as_bytes());
            }
            PreconditionPresence::Directory => encode_field(hasher, 72, &[2]),
            PreconditionPresence::Symlink { target_digest } => {
                encode_field(hasher, 72, &[3]);
                encode_field(hasher, 75, target_digest.as_str().as_bytes());
            }
            PreconditionPresence::Other => encode_field(hasher, 72, &[4]),
        }
    }
}

fn encode_blockers(hasher: &mut Sha256, blockers: &[BankChangePlanBlocker]) {
    encode_count(hasher, 80, blockers.len());
    for blocker in blockers {
        encode_field(hasher, 81, &[blocker_code(*blocker)]);
    }
}

fn encode_backup(hasher: &mut Sha256, backup: &BackupRequirementDeclaration) {
    encode_field(hasher, 82, &[u8::from(backup.required)]);
    encode_count(hasher, 83, backup.relative_paths.len());
    for path in &backup.relative_paths {
        encode_field(hasher, 84, path.as_str().as_bytes());
    }
}

fn encode_verification(hasher: &mut Sha256, verification: &VerificationRequirementDeclaration) {
    encode_count(hasher, 85, verification.requirements.len());
    for requirement in &verification.requirements {
        encode_field(hasher, 86, &[verification_kind_code(*requirement)]);
    }
}

fn role_code(role: StateDocumentRole) -> u8 {
    match role {
        StateDocumentRole::Working => 1,
        StateDocumentRole::SavedCheckpoint => 2,
    }
}

fn optional_bank_code(bank: Option<BankIndex>) -> u8 {
    bank.map(|index| index.get()).unwrap_or(255)
}

fn optional_role_code(role: Option<StateDocumentRole>) -> u8 {
    role.map(role_code).unwrap_or(0)
}

fn optional_parse_code(status: Option<StateDocumentParseStatus>) -> u8 {
    status.map(parse_status_code).unwrap_or(0)
}

fn parse_status_code(status: StateDocumentParseStatus) -> u8 {
    match status {
        StateDocumentParseStatus::Parsed => 1,
        StateDocumentParseStatus::UnsupportedVersion => 2,
        StateDocumentParseStatus::Malformed => 3,
    }
}

fn unmodeled_code(dependency: UnmodeledDependency) -> u8 {
    match dependency {
        UnmodeledDependency::Scenes => 1,
        UnmodeledDependency::Arrangements => 2,
        UnmodeledDependency::RecorderSetup => 3,
    }
}

fn readiness_gap_code(gap: ReadinessGap) -> u8 {
    match gap {
        ReadinessGap::BankChangePlan => 1,
        ReadinessGap::ArrangementFileSlot => 2,
        ReadinessGap::ArrangerPatternReferences => 3,
        ReadinessGap::BankInternalIdentity => 4,
        ReadinessGap::SceneAndRecorderDependencies => 5,
        ReadinessGap::WorkingSavedCheckpointRule => 6,
        ReadinessGap::ApplyAuthorization => 7,
    }
}

fn reference_coverage_bytes(coverage: ReferenceCoverage) -> [u8; 5] {
    [
        class_status_code(coverage.active_machine),
        class_status_code(coverage.sample_locks),
        class_status_code(coverage.saved_parts),
        class_status_code(coverage.inactive_machine_slots),
        class_status_code(coverage.recorder_setup),
    ]
}

fn class_status_code(status: ReferenceClassStatus) -> u8 {
    match status {
        ReferenceClassStatus::Covered => 1,
        ReferenceClassStatus::ExcludedByContract => 2,
        ReferenceClassStatus::Unmodeled => 3,
    }
}

fn reference_coverage_aggregate_code(aggregate: ReferenceCoverageAggregate) -> u8 {
    match aggregate {
        ReferenceCoverageAggregate::CompleteForChangePlanReview => 1,
        ReferenceCoverageAggregate::Partial => 2,
        ReferenceCoverageAggregate::Blocked => 3,
    }
}

fn encode_reference_observations(
    hasher: &mut Sha256,
    observations: &[BankChangePlanReferenceObservation],
) {
    encode_count(hasher, 58, observations.len());
    for observation in observations {
        let mut bytes = vec![
            scope_code(observation.scope),
            observation.bank.get(),
            role_code(observation.document_role),
            origin_code(observation.origin),
            part_state_code(observation.part_state),
            observation.part.get(),
            pattern_key(observation.pattern),
            observation.track.get(),
            step_key(observation.step),
        ];
        bytes.extend(slot_reference_bytes(observation.target));
        bytes.push(audible_code(observation.audible));
        bytes.push(reference_status_code(observation.reference_status));
        if let Some(path) = &observation.referenced_relative_path {
            bytes.extend(path.as_str().as_bytes());
        }
        encode_field(hasher, 59, &bytes);
    }
}

fn scope_code(scope: ReferenceScopeRole) -> u8 {
    match scope {
        ReferenceScopeRole::SourceContent => 1,
        ReferenceScopeRole::DestinationCurrent => 2,
        ReferenceScopeRole::OperatedBank => 3,
    }
}

fn origin_code(origin: ReferenceOrigin) -> u8 {
    match origin {
        ReferenceOrigin::ActiveMachine => 1,
        ReferenceOrigin::SampleLock => 2,
        ReferenceOrigin::SavedPartMachine => 3,
    }
}

fn part_state_code(role: ot_domain::PartStateRole) -> u8 {
    match role {
        ot_domain::PartStateRole::Working => 1,
        ot_domain::PartStateRole::Saved => 2,
    }
}

fn audible_code(audible: Option<bool>) -> u8 {
    match audible {
        None => 0,
        Some(true) => 1,
        Some(false) => 2,
    }
}

fn reference_status_code(status: Option<SampleReferenceStatus>) -> u8 {
    match status {
        None => 0,
        Some(SampleReferenceStatus::Resolved) => 1,
        Some(SampleReferenceStatus::Missing) => 2,
        Some(SampleReferenceStatus::InvalidPath) => 3,
        Some(SampleReferenceStatus::Ambiguous) => 4,
        Some(SampleReferenceStatus::UnassignedSlot) => 5,
    }
}

fn state_doc_semantics_code(semantics: CopySavedCheckpointSemantics) -> u8 {
    match semantics {
        CopySavedCheckpointSemantics::Unknown => 0,
    }
}

fn active_bank_retarget_code(retarget: ActiveBankRetarget) -> u8 {
    match retarget {
        ActiveBankRetarget::Unknown => 1,
        ActiveBankRetarget::NotApplicable => 2,
        ActiveBankRetarget::SelectionUnavailable => 3,
    }
}

fn execution_readiness_code(readiness: BankChangePlanExecutionReadiness) -> u8 {
    match readiness {
        BankChangePlanExecutionReadiness::Blocked => 0,
    }
}

fn track_playback_bytes(playback: TrackPlayback) -> Vec<u8> {
    match playback {
        TrackPlayback::Master => vec![0],
        TrackPlayback::Audio { machine, slot } => {
            let mut bytes = vec![1];
            bytes.extend(machine_bytes(machine));
            bytes.extend(slot_reference_bytes(slot));
            bytes
        }
    }
}

fn machine_bytes(machine: MachineKind) -> Vec<u8> {
    match machine {
        MachineKind::Static => vec![0],
        MachineKind::Flex => vec![1],
        MachineKind::Thru => vec![2],
        MachineKind::Neighbor => vec![3],
        MachineKind::Pickup => vec![4],
        MachineKind::Unknown(raw) => vec![5, raw],
    }
}

/// Discriminant and payload stay in separate bytes. Folding `raw` into the
/// discriminant overflows parser-supported `Unrecognized(252..=254)` and
/// aliases `NoSampleMachine`, `Unassigned`, or `Slot`.
fn slot_reference_bytes(slot: TrackSlotReference) -> [u8; 4] {
    match slot {
        TrackSlotReference::NoSampleMachine => [0, 0, 0, 0],
        TrackSlotReference::Unassigned => [1, 0, 0, 0],
        TrackSlotReference::Slot(id) => {
            let kind = match id.kind() {
                SampleSlotKind::Static => 0,
                SampleSlotKind::Flex => 1,
            };
            let number = id.number();
            [2, kind, (number >> 8) as u8, number as u8]
        }
        TrackSlotReference::RecorderBuffer(buffer) => [3, buffer.buffer_number(), 0, 0],
        TrackSlotReference::Unrecognized(raw) => [4, raw, 0, 0],
    }
}

fn blocker_code(blocker: BankChangePlanBlocker) -> u8 {
    match blocker {
        BankChangePlanBlocker::WorkingSavedCheckpointRuleUnresolved => 1,
        BankChangePlanBlocker::OperationRuleBlocked => 2,
        BankChangePlanBlocker::CopySavedCheckpointSemanticsUnknown => 3,
        BankChangePlanBlocker::MoveVacatedSourceUnknown => 4,
        BankChangePlanBlocker::ActiveBankRetargetUnknown => 5,
        BankChangePlanBlocker::ActiveBankSelectionUnavailable => 6,
        BankChangePlanBlocker::BankInternalIdentityUnresolved => 7,
        BankChangePlanBlocker::ArrangerPatternReferencesUnresolved => 8,
        BankChangePlanBlocker::SceneAndRecorderDependenciesUnresolved => 9,
        BankChangePlanBlocker::ApplyAuthorizationUnresolved => 10,
        BankChangePlanBlocker::ArrangementMappingUnprovenForTarget => 11,
        BankChangePlanBlocker::StateDocumentPresenceStop => 12,
        BankChangePlanBlocker::SwapRolePresenceAsymmetric => 13,
        BankChangePlanBlocker::CrossRolePairRejected => 14,
        BankChangePlanBlocker::BankIdentityMismatch => 15,
        BankChangePlanBlocker::DocumentMalformed => 16,
        BankChangePlanBlocker::DocumentUnsupportedVersion => 17,
        BankChangePlanBlocker::NonRegularPrecondition => 18,
        BankChangePlanBlocker::UnmodeledDependency(dependency) => 20 + unmodeled_code(dependency),
        BankChangePlanBlocker::ReadinessGap(gap) => 40 + readiness_gap_code(gap),
    }
}

fn verification_kind_code(kind: VerificationRequirementKind) -> u8 {
    match kind {
        VerificationRequirementKind::RereadAffectedBankDocuments => 1,
        VerificationRequirementKind::ReparseProjectStructure => 2,
        VerificationRequirementKind::RecheckPatternPartRelationships => 3,
        VerificationRequirementKind::RecheckPartTrackSampleReferences => 4,
        VerificationRequirementKind::RereadProjectState => 5,
        VerificationRequirementKind::UnrelatedProjectEntriesUnchanged => 6,
    }
}

fn manifest_entry_tag(entry: &crate::bank_mutation::ManifestEntry) -> u8 {
    match entry {
        crate::bank_mutation::ManifestEntry::File { .. } => 1,
        crate::bank_mutation::ManifestEntry::Directory => 2,
        crate::bank_mutation::ManifestEntry::Symlink { .. } => 3,
        crate::bank_mutation::ManifestEntry::Other => 4,
    }
}

fn readiness_matches_current_main(readiness: &ReadinessEvidence) -> bool {
    let mut expected = ReadinessEvidence::current_main().open_gaps();
    let mut actual = readiness.open_gaps();
    expected.sort();
    actual.sort();
    expected == actual
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bank_mutation::{ManifestEntry, ReadinessEvidence};
    use ot_domain::project_structure::{
        BankStructure, MachineKind, PatternPlaybackScale, PatternScale, PatternStructure,
        ProjectStateDocument, TrackPlayback, TrackStructure, BANK_UNMODELED_DEPENDENCIES,
    };
    use ot_domain::{
        BankReferenceInventory, BankSampleReferenceObservation, PartStateRole, RecorderBufferId,
        ReferenceCoverage, ReferenceCoverageAggregate, ReferenceOrigin, ReferenceScopeRole,
        SampleReferenceStatus, SampleSlotId, SampleSlotKind,
    };
    use std::collections::HashSet;

    fn fingerprint() -> String {
        format!("rootfp:v1:{}", "a".repeat(64))
    }

    fn hash(byte: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{}", format!("{byte:02x}").repeat(32))).unwrap()
    }

    fn bank_structure(
        bank: BankIndex,
        role: StateDocumentRole,
        path: &str,
        parse_status: StateDocumentParseStatus,
    ) -> BankStructure {
        BankStructure {
            bank,
            role,
            source_relative_path: RootRelativePath::parse(path).unwrap(),
            parse_status,
            patterns: vec![PatternStructure {
                index: PatternIndex::new(0).unwrap(),
                part: PartIndex::new(0).unwrap(),
                scale: PatternScale::Normal {
                    master_length: 16,
                    master_scale: PatternPlaybackScale::Times1,
                },
            }],
            parts: vec![PartStructure {
                index: PartIndex::new(0).unwrap(),
                tracks: vec![TrackStructure {
                    index: TrackIndex::new(0).unwrap(),
                    playback: TrackPlayback::Audio {
                        machine: MachineKind::Flex,
                        slot: TrackSlotReference::RecorderBuffer(
                            RecorderBufferId::new(129).unwrap(),
                        ),
                    },
                }],
            }],
            unmodeled: BANK_UNMODELED_DEPENDENCIES.to_vec(),
        }
    }

    fn project_structure(source: BankIndex, destination: BankIndex) -> ProjectStructure {
        ProjectStructure {
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
            project_state: Some(ProjectStateDocument {
                role: StateDocumentRole::Working,
                source_relative_path: RootRelativePath::parse("SET/PROJECT/project.work").unwrap(),
                parse_status: StateDocumentParseStatus::Parsed,
                bank: Some(ProjectBankSelection::Selected(source)),
                pattern: None,
                arrangement: None,
                master_track: None,
            }),
            banks: vec![
                bank_structure(
                    source,
                    StateDocumentRole::Working,
                    "SET/PROJECT/bank01.work",
                    StateDocumentParseStatus::Parsed,
                ),
                bank_structure(
                    source,
                    StateDocumentRole::SavedCheckpoint,
                    "SET/PROJECT/bank01.strd",
                    StateDocumentParseStatus::Parsed,
                ),
                bank_structure(
                    destination,
                    StateDocumentRole::Working,
                    "SET/PROJECT/bank02.work",
                    StateDocumentParseStatus::Parsed,
                ),
                bank_structure(
                    destination,
                    StateDocumentRole::SavedCheckpoint,
                    "SET/PROJECT/bank02.strd",
                    StateDocumentParseStatus::Parsed,
                ),
            ],
        }
    }

    fn presence(bank: BankIndex) -> BankStateDocumentSet {
        BankStateDocumentSet::new(bank, true, true)
    }

    fn manifest_with_files(paths: &[(&str, u64, u8)]) -> TreeManifest {
        let mut manifest = TreeManifest::new();
        for (path, size, byte) in paths {
            manifest.insert(
                RootRelativePath::parse(path).unwrap(),
                ManifestEntry::File {
                    byte_size: *size,
                    content_hash: hash(*byte),
                },
            );
        }
        manifest
    }

    fn facts(source: BankIndex, destination: BankIndex) -> BankChangePlanningFacts {
        let structure = project_structure(source, destination);
        let manifest = manifest_with_files(&[
            ("SET/PROJECT/project.work", 10, 1),
            ("SET/PROJECT/bank01.work", 20, 2),
            ("SET/PROJECT/bank01.strd", 21, 3),
            ("SET/PROJECT/bank02.work", 22, 4),
            ("SET/PROJECT/bank02.strd", 23, 5),
        ]);
        BankChangePlanningFacts {
            root_id: RootId::new("root-session-1").unwrap(),
            device_fingerprint: fingerprint(),
            observed_revision: 1,
            identity_is_stable: true,
            read_model_schema: "masterocta.project-structure:v4".to_owned(),
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
            project_structure: structure,
            scope_manifest: manifest,
            source_presence: presence(source),
            destination_presence: presence(destination),
            reference_inventory: synthetic_reference_inventory(source, destination),
        }
    }

    fn synthetic_reference_inventory(
        source: BankIndex,
        destination: BankIndex,
    ) -> BankReferenceInventory {
        let mut observations = Vec::new();
        for (bank, role) in [
            (source, StateDocumentRole::Working),
            (source, StateDocumentRole::SavedCheckpoint),
            (destination, StateDocumentRole::Working),
            (destination, StateDocumentRole::SavedCheckpoint),
        ] {
            observations.push(BankSampleReferenceObservation {
                bank,
                document_role: role,
                origin: ReferenceOrigin::ActiveMachine,
                part_state: PartStateRole::Working,
                part: PartIndex::new(0).unwrap(),
                pattern: None,
                track: TrackIndex::new(0).unwrap(),
                step: None,
                target: TrackSlotReference::RecorderBuffer(RecorderBufferId::new(129).unwrap()),
                audible: None,
                reference_status: None,
                referenced_relative_path: None,
            });
        }
        BankReferenceInventory {
            observed_revision: 1,
            observations,
            coverage: ReferenceCoverage::complete_for_changeplan_review(),
        }
    }

    #[test]
    fn bank_copy_changeplan_is_deterministic_and_blocked() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let intent = BankChangeIntent::Copy {
            source,
            destination,
        };
        let facts = facts(source, destination);
        let readiness = ReadinessEvidence::current_main();
        let first = plan_bank_change(intent, &facts, &readiness).unwrap();
        let second = plan_bank_change(intent, &facts, &readiness).unwrap();
        assert_eq!(first.id(), second.id());
        assert!(!first.execution_authorized());
        assert_eq!(first.operation, BankChangeOperation::Copy);
        assert!(first
            .read_dependencies
            .iter()
            .any(|dependency| dependency.relative_path.as_str().ends_with("bank01.work")));
        assert!(first
            .candidate_change_documents
            .iter()
            .all(|candidate| candidate.bank == destination));
        assert!(first
            .candidate_change_documents
            .iter()
            .all(|candidate| !candidate.relative_path.as_str().contains("bank01")));
        assert!(first
            .blockers
            .contains(&BankChangePlanBlocker::WorkingSavedCheckpointRuleUnresolved));
    }

    #[test]
    fn bank_move_changeplan_is_deterministic_and_blocked() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let intent = BankChangeIntent::Move {
            source,
            destination,
        };
        let facts = facts(source, destination);
        let readiness = ReadinessEvidence::current_main();
        let first = plan_bank_change(intent, &facts, &readiness).unwrap();
        let second = plan_bank_change(intent, &facts, &readiness).unwrap();
        assert_eq!(first.id(), second.id());
        assert!(!first.execution_authorized());
        let plan = first;
        assert!(plan
            .blockers
            .contains(&BankChangePlanBlocker::MoveVacatedSourceUnknown));
        assert!(plan
            .blockers
            .contains(&BankChangePlanBlocker::ActiveBankRetargetUnknown));
        assert!(plan
            .candidate_change_documents
            .iter()
            .any(|candidate| candidate.bank == source));
        assert!(plan
            .candidate_change_documents
            .iter()
            .any(|candidate| candidate.bank == destination));
    }

    #[test]
    fn bank_swap_changeplan_is_deterministic_and_blocked() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let intent = BankChangeIntent::Swap {
            source,
            destination,
        };
        let facts = facts(source, destination);
        let readiness = ReadinessEvidence::current_main();
        let first = plan_bank_change(intent, &facts, &readiness).unwrap();
        let second = plan_bank_change(intent, &facts, &readiness).unwrap();
        assert_eq!(first.id(), second.id());
        assert!(!first.execution_authorized());
        let plan = first;
        assert_eq!(plan.operation, BankChangeOperation::Swap);
        assert!(plan
            .blockers
            .contains(&BankChangePlanBlocker::ActiveBankRetargetUnknown));
    }

    #[test]
    fn reference_inventory_is_deterministic() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let first = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        let second = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert_eq!(first.reference_observations, second.reference_observations);
        assert_eq!(
            first.reference_coverage_aggregate,
            ReferenceCoverageAggregate::CompleteForChangePlanReview
        );
        assert!(!first.affected_patterns.is_empty());
        assert!(first
            .reference_observations
            .iter()
            .any(|sample| matches!(sample.target, TrackSlotReference::RecorderBuffer(_))));
    }

    #[test]
    fn active_machine_reference_is_enumerated() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan.reference_observations.iter().any(|observation| {
            observation.origin == ReferenceOrigin::ActiveMachine
                && observation.scope == ReferenceScopeRole::SourceContent
        }));
    }

    #[test]
    fn copy_reference_scope_is_deterministic() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan
            .reference_observations
            .iter()
            .any(|observation| observation.scope == ReferenceScopeRole::DestinationCurrent));
        assert!(plan
            .reference_observations
            .iter()
            .any(|observation| observation.scope == ReferenceScopeRole::SourceContent));
    }

    #[test]
    fn move_reference_scope_is_deterministic() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let plan = plan_bank_change(
            BankChangeIntent::Move {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan
            .reference_observations
            .iter()
            .all(|observation| observation.scope == ReferenceScopeRole::OperatedBank));
    }

    #[test]
    fn swap_reference_scope_is_deterministic() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let plan = plan_bank_change(
            BankChangeIntent::Swap {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert_eq!(plan.reference_observations.len(), 4);
    }

    #[test]
    fn reference_step_change_invalidates_plan_id() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        planning
            .reference_inventory
            .observations
            .push(BankSampleReferenceObservation {
                bank: source,
                document_role: StateDocumentRole::Working,
                origin: ReferenceOrigin::SampleLock,
                part_state: PartStateRole::Working,
                part: PartIndex::new(0).unwrap(),
                pattern: Some(PatternIndex::new(0).unwrap()),
                track: TrackIndex::new(0).unwrap(),
                step: Some(0),
                target: TrackSlotReference::Slot(
                    SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                ),
                audible: Some(true),
                reference_status: None,
                referenced_relative_path: None,
            });
        let first = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap()
        .id()
        .clone();
        planning
            .reference_inventory
            .observations
            .last_mut()
            .unwrap()
            .step = Some(1);
        let second = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap()
        .id()
        .clone();
        assert_ne!(first, second);
    }

    #[test]
    fn missing_reference_status_is_preserved() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        planning.reference_inventory.observations[0].reference_status =
            Some(SampleReferenceStatus::Missing);
        planning.reference_inventory.observations[0].referenced_relative_path =
            Some(RootRelativePath::parse("SET/PROJECT/missing.wav").unwrap());
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan.reference_observations.iter().any(|observation| {
            observation.reference_status == Some(SampleReferenceStatus::Missing)
        }));
    }

    #[test]
    fn invalid_path_status_is_preserved() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        planning.reference_inventory.observations[0].reference_status =
            Some(SampleReferenceStatus::InvalidPath);
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan.reference_observations.iter().any(|observation| {
            observation.reference_status == Some(SampleReferenceStatus::InvalidPath)
        }));
    }

    #[test]
    fn ambiguous_reference_status_is_preserved() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        planning.reference_inventory.observations[0].reference_status =
            Some(SampleReferenceStatus::Ambiguous);
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan.reference_observations.iter().any(|observation| {
            observation.reference_status == Some(SampleReferenceStatus::Ambiguous)
        }));
    }

    #[test]
    fn working_and_saved_checkpoint_references_stay_separate() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert!(plan.reference_observations.iter().any(|observation| {
            observation.bank == source && observation.document_role == StateDocumentRole::Working
        }));
        assert!(plan.reference_observations.iter().any(|observation| {
            observation.bank == source
                && observation.document_role == StateDocumentRole::SavedCheckpoint
        }));
    }

    #[test]
    fn reference_slot_change_invalidates_plan_id() {
        let first = plan_id_for_slot(TrackSlotReference::RecorderBuffer(
            RecorderBufferId::new(129).unwrap(),
        ));
        let second = plan_id_for_slot(TrackSlotReference::Slot(
            SampleSlotId::new(SampleSlotKind::Flex, 2).unwrap(),
        ));
        assert_ne!(first, second);
    }

    #[test]
    fn reference_status_change_invalidates_plan_id() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        planning.reference_inventory.observations[0].reference_status =
            Some(SampleReferenceStatus::Missing);
        let first = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap()
        .id()
        .clone();
        planning.reference_inventory.observations[0].reference_status =
            Some(SampleReferenceStatus::Resolved);
        planning.reference_inventory.observations[0].referenced_relative_path =
            Some(RootRelativePath::parse("SET/PROJECT/sample.wav").unwrap());
        let second = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap()
        .id()
        .clone();
        assert_ne!(first, second);
    }

    #[test]
    fn coverage_change_invalidates_plan_id() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        let first = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap()
        .id()
        .clone();
        planning.reference_inventory.coverage.sample_locks =
            ot_domain::ReferenceClassStatus::Unmodeled;
        let second = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap()
        .id()
        .clone();
        assert_ne!(first, second);
    }

    #[test]
    fn bank_changeplan_stale_when_project_scope_differs() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        let mut fresh = plan.scope_manifest.clone();
        fresh.insert(
            RootRelativePath::parse("SET/PROJECT/bank02.work").unwrap(),
            ManifestEntry::File {
                byte_size: 999,
                content_hash: hash(9),
            },
        );
        assert_eq!(
            check_bank_changeplan_staleness(&plan, &fresh),
            BankChangePlanStaleness::Stale
        );
    }

    #[test]
    fn bank_changeplan_integrity_detects_tampering() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert_eq!(plan.validate_integrity(), Ok(()));
        plan.destination = BankIndex::new(2).unwrap();
        assert_eq!(plan.validate_integrity(), Err(PlanError::IntegrityMismatch));
    }

    #[test]
    fn bank_changeplan_rejects_non_current_readiness() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let readiness = ReadinessEvidence::assume_resolved(ReadinessGap::ALL);
        let error = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts(source, destination),
            &readiness,
        )
        .unwrap_err();
        assert_eq!(error, BankChangePlanError::ReadinessEvidenceMismatch);
    }

    fn plan_id_for_slot(slot: TrackSlotReference) -> PlanId {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut planning = facts(source, destination);
        for bank in &mut planning.project_structure.banks {
            for part in &mut bank.parts {
                for track in &mut part.tracks {
                    if let TrackPlayback::Audio { slot: assigned, .. } = &mut track.playback {
                        *assigned = slot;
                    }
                }
            }
        }
        for observation in &mut planning.reference_inventory.observations {
            if observation.origin == ReferenceOrigin::ActiveMachine {
                observation.target = slot;
            }
        }
        let plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &planning,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        plan.validate_integrity().unwrap();
        plan.id().clone()
    }

    #[test]
    fn plan_id_distinguishes_complete_slot_identities() {
        let ids = [
            plan_id_for_slot(TrackSlotReference::Slot(
                SampleSlotId::new(SampleSlotKind::Flex, 1).unwrap(),
            )),
            plan_id_for_slot(TrackSlotReference::Slot(
                SampleSlotId::new(SampleSlotKind::Flex, 128).unwrap(),
            )),
            plan_id_for_slot(TrackSlotReference::Slot(
                SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            )),
            plan_id_for_slot(TrackSlotReference::RecorderBuffer(
                RecorderBufferId::new(129).unwrap(),
            )),
            plan_id_for_slot(TrackSlotReference::RecorderBuffer(
                RecorderBufferId::new(136).unwrap(),
            )),
            plan_id_for_slot(TrackSlotReference::NoSampleMachine),
            plan_id_for_slot(TrackSlotReference::Unassigned),
            plan_id_for_slot(TrackSlotReference::Unrecognized(252)),
            plan_id_for_slot(TrackSlotReference::Unrecognized(253)),
            plan_id_for_slot(TrackSlotReference::Unrecognized(254)),
        ];
        let unique: HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len());
    }

    #[test]
    fn non_regular_precondition_is_explicit_and_blocking() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let intent = BankChangeIntent::Copy {
            source,
            destination,
        };
        let readiness = ReadinessEvidence::current_main();
        let cases = [
            (
                ManifestEntry::Symlink {
                    target_digest: hash(7),
                },
                PreconditionPresence::Symlink {
                    target_digest: hash(7),
                },
            ),
            (ManifestEntry::Directory, PreconditionPresence::Directory),
            (ManifestEntry::Other, PreconditionPresence::Other),
        ];
        for (entry, expected) in cases {
            let mut planning = facts(source, destination);
            planning.scope_manifest.insert(
                RootRelativePath::parse("SET/PROJECT/bank02.work").unwrap(),
                entry,
            );
            let plan = plan_bank_change(intent, &planning, &readiness).unwrap();
            let presence = &plan
                .preconditions
                .iter()
                .find(|item| item.relative_path.as_str() == "SET/PROJECT/bank02.work")
                .expect("candidate path is a precondition")
                .presence;
            assert_eq!(presence, &expected);
            assert!(plan
                .blockers
                .contains(&BankChangePlanBlocker::NonRegularPrecondition));
        }
    }

    #[test]
    fn copy_plan_blocks_unparsed_project_state() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let intent = BankChangeIntent::Copy {
            source,
            destination,
        };
        let readiness = ReadinessEvidence::current_main();
        for (status, blocker) in [
            (
                StateDocumentParseStatus::Malformed,
                BankChangePlanBlocker::DocumentMalformed,
            ),
            (
                StateDocumentParseStatus::UnsupportedVersion,
                BankChangePlanBlocker::DocumentUnsupportedVersion,
            ),
        ] {
            let mut planning = facts(source, destination);
            planning
                .project_structure
                .project_state
                .as_mut()
                .unwrap()
                .parse_status = status;
            let plan = plan_bank_change(intent, &planning, &readiness).unwrap();
            assert!(plan.read_dependencies.iter().any(|dependency| {
                dependency.relative_path.as_str().ends_with("project.work")
                    && dependency.parse_status == Some(status)
            }));
            assert!(plan.blockers.contains(&blocker));
        }
    }

    #[test]
    fn declared_presence_must_match_structure_roles() {
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let intent = BankChangeIntent::Copy {
            source,
            destination,
        };
        let readiness = ReadinessEvidence::current_main();

        let mut declared_present = facts(source, destination);
        declared_present
            .project_structure
            .banks
            .retain(|bank| bank.bank != source);
        assert_eq!(
            plan_bank_change(intent, &declared_present, &readiness).unwrap_err(),
            BankChangePlanError::BankPresenceMismatch
        );

        let mut declared_absent = facts(source, destination);
        declared_absent.destination_presence = BankStateDocumentSet::new(destination, false, false);
        assert_eq!(
            plan_bank_change(intent, &declared_absent, &readiness).unwrap_err(),
            BankChangePlanError::BankPresenceMismatch
        );

        let mut one_role = facts(source, destination);
        one_role.source_presence = BankStateDocumentSet::new(source, true, false);
        assert_eq!(
            plan_bank_change(intent, &one_role, &readiness).unwrap_err(),
            BankChangePlanError::BankPresenceMismatch
        );

        let mut agreed_absent = facts(source, destination);
        agreed_absent.destination_presence = BankStateDocumentSet::new(destination, false, false);
        agreed_absent
            .project_structure
            .banks
            .retain(|bank| bank.bank != destination);
        assert!(plan_bank_change(intent, &agreed_absent, &readiness).is_ok());
    }
}
