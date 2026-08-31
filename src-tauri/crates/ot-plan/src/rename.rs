#![forbid(unsafe_code)]

use ot_domain::{
    ContentHash, ContentHashFreshness, FileInstanceId, ParserProvenance, RenameSampleIntent,
    RootId, RootRelativePath, SampleReferenceStatus, SampleSettingsParseStatus, SampleSlotId,
    SampleUsageKind, StateDocumentKind, StateDocumentParseStatus, StateDocumentRole,
};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fmt;

use crate::{encode_field, validate_prefixed_sha256, PlanError, PlanId, ROOT_FINGERPRINT_PREFIX};

const RENAME_PLAN_CANONICAL_PREFIX: &[u8] = b"masterocta:rename-impact-plan:v1";
const RENAME_PLAN_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PathComparisonMode {
    CaseSensitive,
    CaseInsensitive,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum UnicodeNormalizationForm {
    Nfc,
    Nfd,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameRootObservation {
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub live_observed_revision: u64,
    pub base_catalog_scan_revision: u64,
    pub scan_completed: bool,
    pub identity_is_stable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameSourceObservation {
    pub file_instance_id: FileInstanceId,
    pub catalog_relative_path: RootRelativePath,
    pub catalog_byte_size: u64,
    pub catalog_content_hash: ContentHash,
    pub live_relative_path: RootRelativePath,
    pub live_byte_size: u64,
    pub live_content_hash: ContentHash,
    pub hash_freshness: ContentHashFreshness,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenameDestinationState {
    Absent,
    Existing {
        relative_path: RootRelativePath,
        byte_size: u64,
        content_hash: ContentHash,
    },
    CaseOnlyCollision {
        existing_relative_path: RootRelativePath,
    },
    NormalizationCollision {
        existing_relative_path: RootRelativePath,
        normalization: UnicodeNormalizationForm,
    },
    UnsafePath {
        reason: RenameUnsafePathReason,
    },
    Incomparable,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RenameUnsafePathReason {
    Traversal,
    SymlinkEscape,
    InvalidComponent,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameStateDocumentObservation {
    pub relative_path: RootRelativePath,
    pub kind: StateDocumentKind,
    pub role: StateDocumentRole,
    pub byte_size: u64,
    pub content_hash: ContentHash,
    pub parse_status: StateDocumentParseStatus,
    pub parser_provenance: ParserProvenance,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameSlotAssignmentObservation {
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub referenced_file_relative_path: Option<RootRelativePath>,
    pub reference_status: SampleReferenceStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameUsageEdgeObservation {
    pub bank_document_relative_path: RootRelativePath,
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub usage_kind: SampleUsageKind,
    pub referenced_file_relative_path: Option<RootRelativePath>,
    pub reference_status: SampleReferenceStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameSidecarObservation {
    pub sidecar_relative_path: RootRelativePath,
    pub owning_audio_relative_path: RootRelativePath,
    pub byte_size: u64,
    pub content_hash: ContentHash,
    pub parse_status: SampleSettingsParseStatus,
    pub parser_provenance: ParserProvenance,
    pub ownership_is_unique: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameSamplePlanningFacts {
    pub root: RenameRootObservation,
    pub source: RenameSourceObservation,
    pub destination: RenameDestinationObservation,
    pub state_documents: Vec<RenameStateDocumentObservation>,
    pub slot_assignments: Vec<RenameSlotAssignmentObservation>,
    pub usage_edges: Vec<RenameUsageEdgeObservation>,
    pub sidecars: Vec<RenameSidecarObservation>,
    pub usage_graph_complete: bool,
    pub set_project_coverage_complete: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameDestinationObservation {
    pub intended_relative_path: RootRelativePath,
    pub state: RenameDestinationState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameReferenceUpdate {
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub from_relative_path: RootRelativePath,
    pub to_relative_path: RootRelativePath,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameStateDocumentImpact {
    pub relative_path: RootRelativePath,
    pub kind: StateDocumentKind,
    pub role: StateDocumentRole,
    pub byte_size: u64,
    pub content_hash: ContentHash,
    pub reference_updates: Vec<RenameReferenceUpdate>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameUsageEdgeImpact {
    pub bank_document_relative_path: RootRelativePath,
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub usage_kind: SampleUsageKind,
    pub referenced_file_relative_path: RootRelativePath,
    pub reference_status: SampleReferenceStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameSidecarImpact {
    pub source_sidecar_relative_path: RootRelativePath,
    pub destination_sidecar_relative_path: RootRelativePath,
    pub byte_size: u64,
    pub content_hash: ContentHash,
    pub parse_status: SampleSettingsParseStatus,
    pub parser_provenance: ParserProvenance,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameUnresolvedReference {
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub reference_status: SampleReferenceStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenamePlanningWarning {
    UnusedSample {
        source_relative_path: RootRelativePath,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameImpactPlan {
    pub id: PlanId,
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_file_instance_id: FileInstanceId,
    pub source_relative_path: RootRelativePath,
    pub source_byte_size: u64,
    pub source_content_hash: ContentHash,
    pub destination_relative_path: RootRelativePath,
    pub state_document_impacts: Vec<RenameStateDocumentImpact>,
    pub usage_edge_impacts: Vec<RenameUsageEdgeImpact>,
    pub sidecar_impacts: Vec<RenameSidecarImpact>,
    pub unresolved_references: Vec<RenameUnresolvedReference>,
    pub backup_relative_paths: Vec<RootRelativePath>,
    pub estimated_media_additional_bytes: u64,
    pub estimated_local_staging_bytes: u64,
    pub reference_update_count: u64,
    pub warnings: Vec<RenamePlanningWarning>,
}

impl RenameImpactPlan {
    pub fn validate_integrity(&self) -> Result<(), PlanError> {
        let expected = derive_rename_plan_id(self);
        if expected == self.id {
            Ok(())
        } else {
            Err(PlanError::IntegrityMismatch)
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockedRenameImpact {
    pub source_relative_path: Option<RootRelativePath>,
    pub destination_relative_path: RootRelativePath,
    pub observed_state_document_count: usize,
    pub observed_usage_edge_count: usize,
    pub observed_sidecar_count: usize,
    pub reference_update_count: u64,
    pub block_reasons: Vec<RenameBlockReason>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenamePlanningOutcome {
    Planned(Box<RenameImpactPlan>),
    Blocked(BlockedRenameImpact),
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum RenameBlockReason {
    RootMismatch,
    UnstableRootIdentity,
    InvalidRootFingerprint,
    ScanNotCompleted,
    InvalidObservedRevision,
    CatalogRevisionMismatch,
    SourceIdentityMismatch,
    SourcePathMismatch,
    SourceSizeMismatch,
    SourceHashMismatch,
    StaleSourceHashFreshness,
    SourceEqualsDestination,
    DestinationOccupied,
    DestinationCaseCollision,
    DestinationNormalizationCollision,
    DestinationUnsafePath,
    DestinationIncomparable,
    UnsupportedStateDocument,
    MalformedStateDocument,
    UnsupportedSidecar,
    MalformedSidecar,
    AmbiguousSidecarOwnership,
    IncompleteUsageGraph,
    IncompleteSetProjectCoverage,
    UnresolvedReference,
    IncompleteReferenceUpdateSet,
    ArithmeticOverflow,
}

impl fmt::Display for RenameBlockReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::RootMismatch => "intent and observed root do not match",
            Self::UnstableRootIdentity => "rename requires a stable root identity",
            Self::InvalidRootFingerprint => "root fingerprint is not a supported versioned value",
            Self::ScanNotCompleted => "latest catalog scan is not completed",
            Self::InvalidObservedRevision => "observed root revision must be non-zero",
            Self::CatalogRevisionMismatch => "catalog scan revision does not match live revision",
            Self::SourceIdentityMismatch => "source file instance identity does not match facts",
            Self::SourcePathMismatch => "catalog and live source paths do not match",
            Self::SourceSizeMismatch => "catalog and live source sizes do not match",
            Self::SourceHashMismatch => "catalog and live source hashes do not match",
            Self::StaleSourceHashFreshness => "rename planning requires a live source rehash",
            Self::SourceEqualsDestination => "source and destination must be different paths",
            Self::DestinationOccupied => "destination path is already occupied",
            Self::DestinationCaseCollision => {
                "destination collides case-insensitively with an existing path"
            }
            Self::DestinationNormalizationCollision => {
                "destination collides after Unicode normalization with an existing path"
            }
            Self::DestinationUnsafePath => "destination path is unsafe",
            Self::DestinationIncomparable => "destination state could not be compared safely",
            Self::UnsupportedStateDocument => "a related state document has an unsupported version",
            Self::MalformedStateDocument => "a related state document is malformed",
            Self::UnsupportedSidecar => "a related sidecar has an unsupported version",
            Self::MalformedSidecar => "a related sidecar is malformed",
            Self::AmbiguousSidecarOwnership => "sidecar ownership is ambiguous",
            Self::IncompleteUsageGraph => "usage graph is incomplete",
            Self::IncompleteSetProjectCoverage => "set project coverage is incomplete",
            Self::UnresolvedReference => "an unresolved sample reference blocks rename planning",
            Self::IncompleteReferenceUpdateSet => "reference update set is incomplete",
            Self::ArithmeticOverflow => "rename byte accounting overflowed",
        })
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum RenameStaleReason {
    RootIdentityChanged,
    ObservedRevisionChanged,
    SourcePathChanged,
    SourceSizeChanged,
    SourceHashChanged,
    DestinationStateChanged,
    StateDocumentChanged { relative_path: RootRelativePath },
    SidecarChanged { relative_path: RootRelativePath },
    ReferenceSetChanged,
    UsageGraphCompletenessChanged,
    SetProjectCoverageChanged,
}

impl fmt::Display for RenameStaleReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RootIdentityChanged => write!(formatter, "root identity changed"),
            Self::ObservedRevisionChanged => write!(formatter, "observed revision changed"),
            Self::SourcePathChanged => write!(formatter, "source path changed"),
            Self::SourceSizeChanged => write!(formatter, "source size changed"),
            Self::SourceHashChanged => write!(formatter, "source hash changed"),
            Self::DestinationStateChanged => write!(formatter, "destination state changed"),
            Self::StateDocumentChanged { relative_path } => {
                write!(
                    formatter,
                    "state document changed: {}",
                    relative_path.as_str()
                )
            }
            Self::SidecarChanged { relative_path } => {
                write!(formatter, "sidecar changed: {}", relative_path.as_str())
            }
            Self::ReferenceSetChanged => write!(formatter, "reference update set changed"),
            Self::UsageGraphCompletenessChanged => {
                write!(formatter, "usage graph completeness changed")
            }
            Self::SetProjectCoverageChanged => write!(formatter, "set project coverage changed"),
        }
    }
}

pub fn plan_rename_sample(
    intent: &RenameSampleIntent,
    facts: &RenameSamplePlanningFacts,
) -> RenamePlanningOutcome {
    let mut block_reasons = collect_blockers(intent, facts);
    let reference_updates = collect_reference_updates(facts);
    let unresolved = collect_unresolved_references(facts);

    if !unresolved.is_empty() {
        block_reasons.push(RenameBlockReason::UnresolvedReference);
    }
    if has_resolved_slot_assignment(facts) && reference_updates.is_empty() {
        block_reasons.push(RenameBlockReason::IncompleteReferenceUpdateSet);
    }

    block_reasons.sort_by_key(block_reason_rank);
    block_reasons.dedup();

    if !block_reasons.is_empty() {
        return RenamePlanningOutcome::Blocked(BlockedRenameImpact {
            source_relative_path: Some(facts.source.live_relative_path.clone()),
            destination_relative_path: intent.destination_relative_path.clone(),
            observed_state_document_count: facts.state_documents.len(),
            observed_usage_edge_count: facts.usage_edges.len(),
            observed_sidecar_count: facts.sidecars.len(),
            reference_update_count: reference_updates.len() as u64,
            block_reasons,
        });
    }

    match build_planned_impact(intent, facts, reference_updates, unresolved) {
        Ok(plan) => RenamePlanningOutcome::Planned(Box::new(plan)),
        Err(reason) => RenamePlanningOutcome::Blocked(BlockedRenameImpact {
            source_relative_path: Some(facts.source.live_relative_path.clone()),
            destination_relative_path: intent.destination_relative_path.clone(),
            observed_state_document_count: facts.state_documents.len(),
            observed_usage_edge_count: facts.usage_edges.len(),
            observed_sidecar_count: facts.sidecars.len(),
            reference_update_count: 0,
            block_reasons: vec![reason],
        }),
    }
}

pub fn derive_rename_plan_id(plan: &RenameImpactPlan) -> PlanId {
    let mut hasher = Sha256::new();
    hasher.update(RENAME_PLAN_CANONICAL_PREFIX);
    encode_field(
        &mut hasher,
        1,
        std::slice::from_ref(&RENAME_PLAN_SCHEMA_VERSION),
    );
    encode_field(&mut hasher, 2, plan.root_id.as_str().as_bytes());
    encode_field(&mut hasher, 3, plan.device_fingerprint.as_bytes());
    encode_field(&mut hasher, 4, &plan.base_observed_revision.to_be_bytes());
    encode_field(
        &mut hasher,
        5,
        plan.source_file_instance_id.as_str().as_bytes(),
    );
    encode_field(
        &mut hasher,
        6,
        plan.source_relative_path.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 7, plan.source_content_hash.as_str().as_bytes());
    encode_field(&mut hasher, 8, &plan.source_byte_size.to_be_bytes());
    encode_field(
        &mut hasher,
        9,
        plan.destination_relative_path.as_str().as_bytes(),
    );

    let mut documents = plan.state_document_impacts.clone();
    documents.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
            .then_with(|| role_rank(left.role).cmp(&role_rank(right.role)))
    });
    for document in &documents {
        encode_field(&mut hasher, 10, document.relative_path.as_str().as_bytes());
        encode_field(&mut hasher, 11, document.content_hash.as_str().as_bytes());
        encode_field(&mut hasher, 12, &document.byte_size.to_be_bytes());
        let mut updates = document.reference_updates.clone();
        updates.sort_by(compare_reference_updates);
        for update in updates {
            encode_field(
                &mut hasher,
                13,
                update.project_document_relative_path.as_str().as_bytes(),
            );
            encode_field(&mut hasher, 14, &update.slot.number().to_be_bytes());
            encode_field(
                &mut hasher,
                15,
                update.from_relative_path.as_str().as_bytes(),
            );
            encode_field(&mut hasher, 16, update.to_relative_path.as_str().as_bytes());
        }
    }

    let mut sidecars = plan.sidecar_impacts.clone();
    sidecars.sort_by(|left, right| {
        left.source_sidecar_relative_path
            .as_str()
            .cmp(right.source_sidecar_relative_path.as_str())
    });
    for sidecar in &sidecars {
        encode_field(
            &mut hasher,
            17,
            sidecar.source_sidecar_relative_path.as_str().as_bytes(),
        );
        encode_field(&mut hasher, 18, sidecar.content_hash.as_str().as_bytes());
        encode_field(
            &mut hasher,
            19,
            sidecar
                .destination_sidecar_relative_path
                .as_str()
                .as_bytes(),
        );
    }

    encode_field(&mut hasher, 20, &plan.reference_update_count.to_be_bytes());

    let digest = hasher.finalize();
    PlanId(format!("plan:v1:{digest:x}"))
}

pub fn validate_rename_plan_freshness(
    plan: &RenameImpactPlan,
    facts: &RenameSamplePlanningFacts,
) -> Result<(), Vec<RenameStaleReason>> {
    let mut reasons = Vec::new();

    if plan.root_id != facts.root.root_id {
        reasons.push(RenameStaleReason::RootIdentityChanged);
    }
    if plan.device_fingerprint != facts.root.device_fingerprint {
        reasons.push(RenameStaleReason::RootIdentityChanged);
    }
    if plan.base_observed_revision != facts.root.live_observed_revision {
        reasons.push(RenameStaleReason::ObservedRevisionChanged);
    }
    if plan.source_relative_path != facts.source.live_relative_path {
        reasons.push(RenameStaleReason::SourcePathChanged);
    }
    if plan.source_byte_size != facts.source.live_byte_size {
        reasons.push(RenameStaleReason::SourceSizeChanged);
    }
    if plan.source_content_hash != facts.source.live_content_hash {
        reasons.push(RenameStaleReason::SourceHashChanged);
    }
    if !matches!(facts.destination.state, RenameDestinationState::Absent) {
        reasons.push(RenameStaleReason::DestinationStateChanged);
    }
    if facts.destination.intended_relative_path != plan.destination_relative_path {
        reasons.push(RenameStaleReason::DestinationStateChanged);
    }

    for document in &plan.state_document_impacts {
        let current = facts
            .state_documents
            .iter()
            .find(|candidate| candidate.relative_path == document.relative_path);
        match current {
            Some(current)
                if current.content_hash == document.content_hash
                    && current.byte_size == document.byte_size => {}
            _ => reasons.push(RenameStaleReason::StateDocumentChanged {
                relative_path: document.relative_path.clone(),
            }),
        }
    }

    for sidecar in &plan.sidecar_impacts {
        let current = facts.sidecars.iter().find(|candidate| {
            candidate.sidecar_relative_path == sidecar.source_sidecar_relative_path
        });
        match current {
            Some(current)
                if current.content_hash == sidecar.content_hash
                    && current.byte_size == sidecar.byte_size => {}
            _ => reasons.push(RenameStaleReason::SidecarChanged {
                relative_path: sidecar.source_sidecar_relative_path.clone(),
            }),
        }
    }

    let current_updates = collect_reference_updates(facts);
    let planned_updates = plan
        .state_document_impacts
        .iter()
        .flat_map(|document| document.reference_updates.clone())
        .collect::<Vec<_>>();
    if !reference_sets_equal(&planned_updates, &current_updates) {
        reasons.push(RenameStaleReason::ReferenceSetChanged);
    }

    if !facts.usage_graph_complete {
        reasons.push(RenameStaleReason::UsageGraphCompletenessChanged);
    }
    if !facts.set_project_coverage_complete {
        reasons.push(RenameStaleReason::SetProjectCoverageChanged);
    }

    reasons.sort_by_key(stale_reason_rank);
    reasons.dedup();

    if reasons.is_empty() {
        Ok(())
    } else {
        Err(reasons)
    }
}

pub fn classify_destination_state(
    intended: &RootRelativePath,
    existing_paths: &[RootRelativePath],
    comparison_mode: PathComparisonMode,
) -> RenameDestinationState {
    if existing_paths.iter().any(|path| path == intended) {
        return RenameDestinationState::Existing {
            relative_path: intended.clone(),
            byte_size: 0,
            content_hash: ContentHash::parse(format!("sha256:{}", "0".repeat(64))).unwrap(),
        };
    }

    for existing in existing_paths {
        if paths_case_only_collision(intended, existing, comparison_mode) {
            return RenameDestinationState::CaseOnlyCollision {
                existing_relative_path: existing.clone(),
            };
        }
    }

    RenameDestinationState::Absent
}

fn collect_blockers(
    intent: &RenameSampleIntent,
    facts: &RenameSamplePlanningFacts,
) -> Vec<RenameBlockReason> {
    let mut blockers = Vec::new();

    if intent.root_id != facts.root.root_id {
        blockers.push(RenameBlockReason::RootMismatch);
    }
    if !facts.root.identity_is_stable {
        blockers.push(RenameBlockReason::UnstableRootIdentity);
    }
    if validate_prefixed_sha256(&facts.root.device_fingerprint, ROOT_FINGERPRINT_PREFIX).is_err() {
        blockers.push(RenameBlockReason::InvalidRootFingerprint);
    }
    if facts.root.live_observed_revision == 0 {
        blockers.push(RenameBlockReason::InvalidObservedRevision);
    }
    if !facts.root.scan_completed {
        blockers.push(RenameBlockReason::ScanNotCompleted);
    }
    if facts.root.base_catalog_scan_revision != facts.root.live_observed_revision {
        blockers.push(RenameBlockReason::CatalogRevisionMismatch);
    }
    if intent.source_file_instance_id != facts.source.file_instance_id {
        blockers.push(RenameBlockReason::SourceIdentityMismatch);
    }
    if facts.source.catalog_relative_path != facts.source.live_relative_path {
        blockers.push(RenameBlockReason::SourcePathMismatch);
    }
    if facts.source.catalog_byte_size != facts.source.live_byte_size {
        blockers.push(RenameBlockReason::SourceSizeMismatch);
    }
    if facts.source.catalog_content_hash != facts.source.live_content_hash {
        blockers.push(RenameBlockReason::SourceHashMismatch);
    }
    if facts.source.hash_freshness != ContentHashFreshness::ComputedThisScan {
        blockers.push(RenameBlockReason::StaleSourceHashFreshness);
    }
    if intent.destination_relative_path != facts.destination.intended_relative_path {
        blockers.push(RenameBlockReason::SourceIdentityMismatch);
    }
    if facts.source.live_relative_path == intent.destination_relative_path {
        blockers.push(RenameBlockReason::SourceEqualsDestination);
    }

    match &facts.destination.state {
        RenameDestinationState::Absent => {}
        RenameDestinationState::Existing { .. } => {
            blockers.push(RenameBlockReason::DestinationOccupied)
        }
        RenameDestinationState::CaseOnlyCollision { .. } => {
            blockers.push(RenameBlockReason::DestinationCaseCollision)
        }
        RenameDestinationState::NormalizationCollision { .. } => {
            blockers.push(RenameBlockReason::DestinationNormalizationCollision)
        }
        RenameDestinationState::UnsafePath { .. } => {
            blockers.push(RenameBlockReason::DestinationUnsafePath)
        }
        RenameDestinationState::Incomparable => {
            blockers.push(RenameBlockReason::DestinationIncomparable)
        }
    }

    for document in &facts.state_documents {
        match document.parse_status {
            StateDocumentParseStatus::Parsed => {}
            StateDocumentParseStatus::UnsupportedVersion => {
                blockers.push(RenameBlockReason::UnsupportedStateDocument);
            }
            StateDocumentParseStatus::Malformed => {
                blockers.push(RenameBlockReason::MalformedStateDocument);
            }
        }
    }

    for sidecar in &facts.sidecars {
        if !sidecar.ownership_is_unique {
            blockers.push(RenameBlockReason::AmbiguousSidecarOwnership);
        }
        match sidecar.parse_status {
            SampleSettingsParseStatus::Parsed => {}
            SampleSettingsParseStatus::UnsupportedVersion => {
                blockers.push(RenameBlockReason::UnsupportedSidecar);
            }
            SampleSettingsParseStatus::Malformed => {
                blockers.push(RenameBlockReason::MalformedSidecar);
            }
        }
    }

    if !facts.usage_graph_complete {
        blockers.push(RenameBlockReason::IncompleteUsageGraph);
    }
    if !facts.set_project_coverage_complete {
        blockers.push(RenameBlockReason::IncompleteSetProjectCoverage);
    }

    blockers
}

fn build_planned_impact(
    intent: &RenameSampleIntent,
    facts: &RenameSamplePlanningFacts,
    reference_updates: Vec<RenameReferenceUpdate>,
    unresolved: Vec<RenameUnresolvedReference>,
) -> Result<RenameImpactPlan, RenameBlockReason> {
    let mut state_document_impacts =
        build_state_document_impacts(facts, &reference_updates, intent)?;
    state_document_impacts.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
            .then_with(|| role_rank(left.role).cmp(&role_rank(right.role)))
    });

    let mut usage_edge_impacts = build_usage_edge_impacts(facts);
    usage_edge_impacts.sort_by(|left, right| {
        left.bank_document_relative_path
            .as_str()
            .cmp(right.bank_document_relative_path.as_str())
            .then_with(|| left.slot.number().cmp(&right.slot.number()))
    });

    let mut sidecar_impacts = build_sidecar_impacts(facts, intent)?;
    sidecar_impacts.sort_by(|left, right| {
        left.source_sidecar_relative_path
            .as_str()
            .cmp(right.source_sidecar_relative_path.as_str())
    });

    let mut backup_relative_paths = Vec::new();
    backup_relative_paths.push(facts.source.live_relative_path.clone());
    for document in &state_document_impacts {
        backup_relative_paths.push(document.relative_path.clone());
    }
    for sidecar in &sidecar_impacts {
        backup_relative_paths.push(sidecar.source_sidecar_relative_path.clone());
    }
    backup_relative_paths.sort_by(|left, right| left.as_str().cmp(right.as_str()));
    backup_relative_paths.dedup();

    let reference_update_count = reference_updates.len() as u64;
    let estimated_local_staging_bytes =
        backup_relative_paths.iter().try_fold(0u64, |total, path| {
            file_byte_size_for_path(facts, path)?
                .checked_add(total)
                .ok_or(RenameBlockReason::ArithmeticOverflow)
        })?;

    let mut warnings = Vec::new();
    if reference_update_count == 0 {
        warnings.push(RenamePlanningWarning::UnusedSample {
            source_relative_path: facts.source.live_relative_path.clone(),
        });
    }

    let plan = RenameImpactPlan {
        id: PlanId::parse(
            "plan:v1:0000000000000000000000000000000000000000000000000000000000000000",
        )
        .unwrap(),
        root_id: facts.root.root_id.clone(),
        device_fingerprint: facts.root.device_fingerprint.clone(),
        base_observed_revision: facts.root.live_observed_revision,
        source_file_instance_id: facts.source.file_instance_id.clone(),
        source_relative_path: facts.source.live_relative_path.clone(),
        source_byte_size: facts.source.live_byte_size,
        source_content_hash: facts.source.live_content_hash.clone(),
        destination_relative_path: intent.destination_relative_path.clone(),
        state_document_impacts,
        usage_edge_impacts,
        sidecar_impacts,
        unresolved_references: unresolved,
        backup_relative_paths,
        estimated_media_additional_bytes: 0,
        estimated_local_staging_bytes,
        reference_update_count,
        warnings,
    };

    let id = derive_rename_plan_id(&plan);
    Ok(RenameImpactPlan { id, ..plan })
}

fn build_state_document_impacts(
    facts: &RenameSamplePlanningFacts,
    reference_updates: &[RenameReferenceUpdate],
    intent: &RenameSampleIntent,
) -> Result<Vec<RenameStateDocumentImpact>, RenameBlockReason> {
    let mut impacts = Vec::new();
    for document in &facts.state_documents {
        if document.kind != StateDocumentKind::Project {
            continue;
        }
        let updates = reference_updates
            .iter()
            .filter(|update| update.project_document_relative_path == document.relative_path)
            .cloned()
            .map(|mut update| {
                update.to_relative_path = intent.destination_relative_path.clone();
                update
            })
            .collect::<Vec<_>>();
        if updates.is_empty() {
            continue;
        }
        impacts.push(RenameStateDocumentImpact {
            relative_path: document.relative_path.clone(),
            kind: document.kind,
            role: document.role,
            byte_size: document.byte_size,
            content_hash: document.content_hash.clone(),
            reference_updates: updates,
        });
    }
    Ok(impacts)
}

fn build_usage_edge_impacts(facts: &RenameSamplePlanningFacts) -> Vec<RenameUsageEdgeImpact> {
    facts
        .usage_edges
        .iter()
        .filter_map(|edge| {
            let referenced = edge.referenced_file_relative_path.as_ref()?;
            if referenced != &facts.source.live_relative_path {
                return None;
            }
            Some(RenameUsageEdgeImpact {
                bank_document_relative_path: edge.bank_document_relative_path.clone(),
                project_document_relative_path: edge.project_document_relative_path.clone(),
                slot: edge.slot,
                usage_kind: edge.usage_kind,
                referenced_file_relative_path: referenced.clone(),
                reference_status: edge.reference_status,
            })
        })
        .collect()
}

fn build_sidecar_impacts(
    facts: &RenameSamplePlanningFacts,
    intent: &RenameSampleIntent,
) -> Result<Vec<RenameSidecarImpact>, RenameBlockReason> {
    let destination_sidecar = sidecar_path_for_audio(&intent.destination_relative_path)
        .ok_or(RenameBlockReason::DestinationUnsafePath)?;
    let mut impacts = Vec::new();
    for sidecar in &facts.sidecars {
        if sidecar.owning_audio_relative_path != facts.source.live_relative_path {
            continue;
        }
        impacts.push(RenameSidecarImpact {
            source_sidecar_relative_path: sidecar.sidecar_relative_path.clone(),
            destination_sidecar_relative_path: destination_sidecar.clone(),
            byte_size: sidecar.byte_size,
            content_hash: sidecar.content_hash.clone(),
            parse_status: sidecar.parse_status,
            parser_provenance: sidecar.parser_provenance.clone(),
        });
    }
    Ok(impacts)
}

fn collect_reference_updates(facts: &RenameSamplePlanningFacts) -> Vec<RenameReferenceUpdate> {
    let mut updates = facts
        .slot_assignments
        .iter()
        .filter_map(|assignment| {
            let referenced = assignment.referenced_file_relative_path.as_ref()?;
            if referenced != &facts.source.live_relative_path {
                return None;
            }
            if assignment.reference_status != SampleReferenceStatus::Resolved {
                return None;
            }
            Some(RenameReferenceUpdate {
                project_document_relative_path: assignment.project_document_relative_path.clone(),
                slot: assignment.slot,
                from_relative_path: referenced.clone(),
                to_relative_path: facts.destination.intended_relative_path.clone(),
            })
        })
        .collect::<Vec<_>>();
    updates.sort_by(compare_reference_updates);
    updates.dedup();
    updates
}

fn collect_unresolved_references(
    facts: &RenameSamplePlanningFacts,
) -> Vec<RenameUnresolvedReference> {
    let mut unresolved = facts
        .slot_assignments
        .iter()
        .filter(|assignment| {
            assignment.reference_status != SampleReferenceStatus::Resolved
                && assignment.reference_status != SampleReferenceStatus::UnassignedSlot
        })
        .map(|assignment| RenameUnresolvedReference {
            project_document_relative_path: assignment.project_document_relative_path.clone(),
            slot: assignment.slot,
            reference_status: assignment.reference_status,
        })
        .collect::<Vec<_>>();
    unresolved.sort_by(|left, right| {
        left.project_document_relative_path
            .as_str()
            .cmp(right.project_document_relative_path.as_str())
            .then_with(|| left.slot.number().cmp(&right.slot.number()))
    });
    unresolved
}

fn has_resolved_slot_assignment(facts: &RenameSamplePlanningFacts) -> bool {
    facts.slot_assignments.iter().any(|assignment| {
        assignment.reference_status == SampleReferenceStatus::Resolved
            && assignment.referenced_file_relative_path.as_ref()
                == Some(&facts.source.live_relative_path)
    })
}

fn file_byte_size_for_path(
    facts: &RenameSamplePlanningFacts,
    path: &RootRelativePath,
) -> Result<u64, RenameBlockReason> {
    if path == &facts.source.live_relative_path {
        return Ok(facts.source.live_byte_size);
    }
    if let Some(document) = facts
        .state_documents
        .iter()
        .find(|document| &document.relative_path == path)
    {
        return Ok(document.byte_size);
    }
    if let Some(sidecar) = facts
        .sidecars
        .iter()
        .find(|sidecar| &sidecar.sidecar_relative_path == path)
    {
        return Ok(sidecar.byte_size);
    }
    Err(RenameBlockReason::IncompleteReferenceUpdateSet)
}

fn sidecar_path_for_audio(audio_path: &RootRelativePath) -> Option<RootRelativePath> {
    let stem = audio_stem(audio_path)?;
    let parent = audio_path.as_str().rsplit_once('/')?.0;
    RootRelativePath::parse(format!("{parent}/{stem}.ot")).ok()
}

fn audio_stem(path: &RootRelativePath) -> Option<&str> {
    let file_name = path.as_str().rsplit('/').next()?;
    file_name.rsplit_once('.').map(|(stem, _)| stem)
}

fn compare_reference_updates(
    left: &RenameReferenceUpdate,
    right: &RenameReferenceUpdate,
) -> Ordering {
    left.project_document_relative_path
        .as_str()
        .cmp(right.project_document_relative_path.as_str())
        .then_with(|| left.slot.number().cmp(&right.slot.number()))
        .then_with(|| {
            left.from_relative_path
                .as_str()
                .cmp(right.from_relative_path.as_str())
        })
}

fn reference_sets_equal(left: &[RenameReferenceUpdate], right: &[RenameReferenceUpdate]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .all(|(left, right)| left == right)
}

fn role_rank(role: StateDocumentRole) -> u8 {
    match role {
        StateDocumentRole::Working => 0,
        StateDocumentRole::SavedCheckpoint => 1,
    }
}

fn block_reason_rank(reason: &RenameBlockReason) -> u8 {
    match reason {
        RenameBlockReason::RootMismatch => 0,
        RenameBlockReason::UnstableRootIdentity => 1,
        RenameBlockReason::InvalidRootFingerprint => 2,
        RenameBlockReason::ScanNotCompleted => 3,
        RenameBlockReason::InvalidObservedRevision => 4,
        RenameBlockReason::CatalogRevisionMismatch => 5,
        RenameBlockReason::SourceIdentityMismatch => 6,
        RenameBlockReason::SourcePathMismatch => 7,
        RenameBlockReason::SourceSizeMismatch => 8,
        RenameBlockReason::SourceHashMismatch => 9,
        RenameBlockReason::StaleSourceHashFreshness => 10,
        RenameBlockReason::SourceEqualsDestination => 11,
        RenameBlockReason::DestinationOccupied => 12,
        RenameBlockReason::DestinationCaseCollision => 13,
        RenameBlockReason::DestinationNormalizationCollision => 14,
        RenameBlockReason::DestinationUnsafePath => 15,
        RenameBlockReason::DestinationIncomparable => 16,
        RenameBlockReason::UnsupportedStateDocument => 17,
        RenameBlockReason::MalformedStateDocument => 18,
        RenameBlockReason::UnsupportedSidecar => 19,
        RenameBlockReason::MalformedSidecar => 20,
        RenameBlockReason::AmbiguousSidecarOwnership => 21,
        RenameBlockReason::IncompleteUsageGraph => 22,
        RenameBlockReason::IncompleteSetProjectCoverage => 23,
        RenameBlockReason::UnresolvedReference => 24,
        RenameBlockReason::IncompleteReferenceUpdateSet => 25,
        RenameBlockReason::ArithmeticOverflow => 26,
    }
}

fn stale_reason_rank(reason: &RenameStaleReason) -> u8 {
    match reason {
        RenameStaleReason::RootIdentityChanged => 0,
        RenameStaleReason::ObservedRevisionChanged => 1,
        RenameStaleReason::SourcePathChanged => 2,
        RenameStaleReason::SourceSizeChanged => 3,
        RenameStaleReason::SourceHashChanged => 4,
        RenameStaleReason::DestinationStateChanged => 5,
        RenameStaleReason::StateDocumentChanged { .. } => 6,
        RenameStaleReason::SidecarChanged { .. } => 7,
        RenameStaleReason::ReferenceSetChanged => 8,
        RenameStaleReason::UsageGraphCompletenessChanged => 9,
        RenameStaleReason::SetProjectCoverageChanged => 10,
    }
}

fn paths_case_only_collision(
    left: &RootRelativePath,
    right: &RootRelativePath,
    comparison_mode: PathComparisonMode,
) -> bool {
    if left == right {
        return false;
    }
    match comparison_mode {
        PathComparisonMode::CaseSensitive => false,
        PathComparisonMode::CaseInsensitive => left.as_str().eq_ignore_ascii_case(right.as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derive_file_instance_id;
    use ot_domain::{ProjectCompatibilityEvidence, SampleSlotKind};

    fn hash(byte: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{}", format!("{byte:02x}").repeat(32))).unwrap()
    }

    fn root_fingerprint() -> String {
        format!("rootfp:v1:{}", "a".repeat(64))
    }

    fn base_root() -> RenameRootObservation {
        RenameRootObservation {
            root_id: RootId::new("root-session-1").unwrap(),
            device_fingerprint: root_fingerprint(),
            live_observed_revision: 9,
            base_catalog_scan_revision: 9,
            scan_completed: true,
            identity_is_stable: true,
        }
    }

    fn base_source(path: &str) -> RenameSourceObservation {
        let relative_path = RootRelativePath::parse(path).unwrap();
        RenameSourceObservation {
            file_instance_id: derive_file_instance_id(&root_fingerprint(), &relative_path),
            catalog_relative_path: relative_path.clone(),
            catalog_byte_size: 128,
            catalog_content_hash: hash(b'b'),
            live_relative_path: relative_path,
            live_byte_size: 128,
            live_content_hash: hash(b'b'),
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        }
    }

    fn parsed_project(path: &str, role: StateDocumentRole) -> RenameStateDocumentObservation {
        RenameStateDocumentObservation {
            relative_path: RootRelativePath::parse(path).unwrap(),
            kind: StateDocumentKind::Project,
            role,
            byte_size: 512,
            content_hash: hash(b'p'),
            parse_status: StateDocumentParseStatus::Parsed,
            parser_provenance: ParserProvenance {
                parser_name: "ot-tools-io".into(),
                parser_revision: "fixture".into(),
                source_version: Some("1.40A".into()),
                compatibility_evidence: Some(ProjectCompatibilityEvidence::UpstreamLibrary),
            },
        }
    }

    fn base_facts(
        source_path: &str,
        destination_path: &str,
        assignments: Vec<RenameSlotAssignmentObservation>,
    ) -> RenameSamplePlanningFacts {
        RenameSamplePlanningFacts {
            root: base_root(),
            source: base_source(source_path),
            destination: RenameDestinationObservation {
                intended_relative_path: RootRelativePath::parse(destination_path).unwrap(),
                state: RenameDestinationState::Absent,
            },
            state_documents: vec![
                parsed_project("SET/PROJECT/project.work", StateDocumentRole::Working),
                parsed_project(
                    "SET/PROJECT/project.strd",
                    StateDocumentRole::SavedCheckpoint,
                ),
            ],
            slot_assignments: assignments,
            usage_edges: vec![RenameUsageEdgeObservation {
                bank_document_relative_path: RootRelativePath::parse("SET/PROJECT/bank01.work")
                    .unwrap(),
                project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                    .unwrap(),
                slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                usage_kind: SampleUsageKind::Machine,
                referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
                reference_status: SampleReferenceStatus::Resolved,
            }],
            sidecars: vec![RenameSidecarObservation {
                sidecar_relative_path: RootRelativePath::parse("SET/AUDIO/kick.ot").unwrap(),
                owning_audio_relative_path: RootRelativePath::parse(source_path).unwrap(),
                byte_size: 64,
                content_hash: hash(b's'),
                parse_status: SampleSettingsParseStatus::Parsed,
                parser_provenance: ParserProvenance {
                    parser_name: "masterocta-sidecar".into(),
                    parser_revision: "fixture".into(),
                    source_version: None,
                    compatibility_evidence: None,
                },
                ownership_is_unique: true,
            }],
            usage_graph_complete: true,
            set_project_coverage_complete: true,
        }
    }

    fn base_intent(source: &RenameSourceObservation, destination: &str) -> RenameSampleIntent {
        RenameSampleIntent {
            root_id: RootId::new("root-session-1").unwrap(),
            source_file_instance_id: source.file_instance_id.clone(),
            destination_relative_path: RootRelativePath::parse(destination).unwrap(),
        }
    }

    #[test]
    fn plans_a_deterministic_rename_with_reference_updates_and_sidecar() {
        let source_path = "SET/AUDIO/kick.wav";
        let destination_path = "SET/AUDIO/new-kick.wav";
        let assignments = vec![RenameSlotAssignmentObservation {
            project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                .unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
            reference_status: SampleReferenceStatus::Resolved,
        }];
        let facts = base_facts(source_path, destination_path, assignments);
        let intent = base_intent(&facts.source, destination_path);
        let first = plan_rename_sample(&intent, &facts);
        let second = plan_rename_sample(&intent, &facts);
        assert_eq!(first, second);

        let RenamePlanningOutcome::Planned(plan) = first else {
            panic!("expected a planned rename impact");
        };
        assert!(plan.id.as_str().starts_with("plan:v1:"));
        assert_eq!(plan.reference_update_count, 1);
        assert_eq!(plan.state_document_impacts.len(), 1);
        assert_eq!(plan.sidecar_impacts.len(), 1);
        assert_eq!(plan.usage_edge_impacts.len(), 1);
        assert_eq!(plan.validate_integrity(), Ok(()));
    }

    #[test]
    fn unused_sample_is_planned_with_zero_reference_updates() {
        let source_path = "SET/AUDIO/unused.wav";
        let destination_path = "SET/AUDIO/unused-renamed.wav";
        let facts = base_facts(source_path, destination_path, Vec::new());
        let intent = base_intent(&facts.source, destination_path);
        let RenamePlanningOutcome::Planned(plan) = plan_rename_sample(&intent, &facts) else {
            panic!("expected unused sample to plan");
        };
        assert_eq!(plan.reference_update_count, 0);
        assert!(matches!(
            plan.warnings.first(),
            Some(RenamePlanningWarning::UnusedSample { .. })
        ));
    }

    #[test]
    fn working_and_saved_checkpoint_impacts_are_listed_separately() {
        let source_path = "SET/AUDIO/kick.wav";
        let destination_path = "SET/AUDIO/new-kick.wav";
        let assignments = vec![
            RenameSlotAssignmentObservation {
                project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                    .unwrap(),
                slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
                reference_status: SampleReferenceStatus::Resolved,
            },
            RenameSlotAssignmentObservation {
                project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.strd")
                    .unwrap(),
                slot: SampleSlotId::new(SampleSlotKind::Static, 2).unwrap(),
                referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
                reference_status: SampleReferenceStatus::Resolved,
            },
        ];
        let facts = base_facts(source_path, destination_path, assignments);
        let intent = base_intent(&facts.source, destination_path);
        let RenamePlanningOutcome::Planned(plan) = plan_rename_sample(&intent, &facts) else {
            panic!("expected planned rename");
        };
        assert_eq!(plan.state_document_impacts.len(), 2);
        assert!(plan
            .state_document_impacts
            .iter()
            .any(|impact| impact.role == StateDocumentRole::Working));
        assert!(plan
            .state_document_impacts
            .iter()
            .any(|impact| impact.role == StateDocumentRole::SavedCheckpoint));
    }

    #[test]
    fn fail_closed_on_stale_hash_freshness_and_destination_collisions() {
        let source_path = "SET/AUDIO/kick.wav";
        let destination_path = "SET/AUDIO/new-kick.wav";
        let mut facts = base_facts(source_path, destination_path, Vec::new());
        facts.source.hash_freshness = ContentHashFreshness::ReusedUnchangedMetadata;
        let intent = base_intent(&facts.source, destination_path);
        let stale = plan_rename_sample(&intent, &facts);
        assert!(matches!(
            stale,
            RenamePlanningOutcome::Blocked(BlockedRenameImpact {
                block_reasons,
                ..
            }) if block_reasons.contains(&RenameBlockReason::StaleSourceHashFreshness)
        ));

        facts.source.hash_freshness = ContentHashFreshness::ComputedThisScan;
        facts.destination.state = RenameDestinationState::CaseOnlyCollision {
            existing_relative_path: RootRelativePath::parse("SET/AUDIO/NEW-KICK.WAV").unwrap(),
        };
        let blocked = plan_rename_sample(&intent, &facts);
        assert!(matches!(
            blocked,
            RenamePlanningOutcome::Blocked(BlockedRenameImpact {
                block_reasons,
                ..
            }) if block_reasons.contains(&RenameBlockReason::DestinationCaseCollision)
        ));
    }

    #[test]
    fn plan_id_changes_when_any_bound_fact_changes() {
        let source_path = "SET/AUDIO/kick.wav";
        let destination_path = "SET/AUDIO/new-kick.wav";
        let assignments = vec![RenameSlotAssignmentObservation {
            project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                .unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
            reference_status: SampleReferenceStatus::Resolved,
        }];
        let facts = base_facts(source_path, destination_path, assignments);
        let intent = base_intent(&facts.source, destination_path);
        let RenamePlanningOutcome::Planned(plan) = plan_rename_sample(&intent, &facts) else {
            panic!("expected planned rename");
        };

        let mut changed_facts = facts.clone();
        changed_facts.source.catalog_content_hash = hash(b'c');
        changed_facts.source.live_content_hash = hash(b'c');
        let RenamePlanningOutcome::Planned(changed_plan) =
            plan_rename_sample(&intent, &changed_facts)
        else {
            panic!("expected changed plan");
        };
        assert_ne!(plan.id, changed_plan.id);
    }

    #[test]
    fn freshness_detects_scan_source_document_sidecar_and_destination_changes() {
        let source_path = "SET/AUDIO/kick.wav";
        let destination_path = "SET/AUDIO/new-kick.wav";
        let assignments = vec![RenameSlotAssignmentObservation {
            project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                .unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
            reference_status: SampleReferenceStatus::Resolved,
        }];
        let facts = base_facts(source_path, destination_path, assignments);
        let intent = base_intent(&facts.source, destination_path);
        let RenamePlanningOutcome::Planned(plan) = plan_rename_sample(&intent, &facts) else {
            panic!("expected planned rename");
        };
        assert_eq!(
            validate_rename_plan_freshness(plan.as_ref(), &facts),
            Ok(())
        );

        let mut stale_revision = facts.clone();
        stale_revision.root.live_observed_revision = 10;
        assert!(validate_rename_plan_freshness(plan.as_ref(), &stale_revision).is_err());

        let mut stale_source = facts.clone();
        stale_source.source.live_byte_size = 256;
        assert!(matches!(
            validate_rename_plan_freshness(plan.as_ref(), &stale_source),
            Err(reasons) if reasons.contains(&RenameStaleReason::SourceSizeChanged)
        ));

        let mut stale_document = facts.clone();
        stale_document.state_documents[0].content_hash = hash(b'q');
        assert!(matches!(
            validate_rename_plan_freshness(plan.as_ref(), &stale_document),
            Err(reasons) if reasons.iter().any(|reason| matches!(
                reason,
                RenameStaleReason::StateDocumentChanged { .. }
            ))
        ));

        let mut stale_sidecar = facts.clone();
        stale_sidecar.sidecars[0].content_hash = hash(b't');
        assert!(matches!(
            validate_rename_plan_freshness(plan.as_ref(), &stale_sidecar),
            Err(reasons) if reasons.iter().any(|reason| matches!(
                reason,
                RenameStaleReason::SidecarChanged { .. }
            ))
        ));

        let mut stale_destination = facts.clone();
        stale_destination.destination.state = RenameDestinationState::Existing {
            relative_path: RootRelativePath::parse(destination_path).unwrap(),
            byte_size: 1,
            content_hash: hash(b'd'),
        };
        assert!(matches!(
            validate_rename_plan_freshness(plan.as_ref(), &stale_destination),
            Err(reasons) if reasons.contains(&RenameStaleReason::DestinationStateChanged)
        ));
    }

    #[test]
    fn ambiguous_sidecar_and_unresolved_references_fail_closed() {
        let source_path = "SET/AUDIO/kick.wav";
        let destination_path = "SET/AUDIO/new-kick.wav";
        let mut facts = base_facts(
            source_path,
            destination_path,
            vec![RenameSlotAssignmentObservation {
                project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                    .unwrap(),
                slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                referenced_file_relative_path: None,
                reference_status: SampleReferenceStatus::Missing,
            }],
        );
        let intent = base_intent(&facts.source, destination_path);
        let unresolved = plan_rename_sample(&intent, &facts);
        assert!(matches!(
            unresolved,
            RenamePlanningOutcome::Blocked(BlockedRenameImpact {
                block_reasons,
                ..
            }) if block_reasons.contains(&RenameBlockReason::UnresolvedReference)
        ));

        facts.slot_assignments.clear();
        facts.sidecars[0].ownership_is_unique = false;
        let ambiguous = plan_rename_sample(&intent, &facts);
        assert!(matches!(
            ambiguous,
            RenamePlanningOutcome::Blocked(BlockedRenameImpact {
                block_reasons,
                ..
            }) if block_reasons.contains(&RenameBlockReason::AmbiguousSidecarOwnership)
        ));
    }
}
