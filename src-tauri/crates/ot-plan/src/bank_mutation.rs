//! Bank mutation safety contract (`MO-PSE-BANK-MUTATION-CONTRACT-1`, #182).
//!
//! Pure checks that a future Bank Copy / Move / Swap Apply (#183) must pass.
//! Nothing here reads or writes a filesystem. Callers capture manifests and
//! read models through the existing read-only boundary and pass them in.
//!
//! The contract is versioned. A change to any rule or encoded field raises
//! [`BANK_MUTATION_CONTRACT_SCHEMA`]; v1 is not extended in place.
//!
//! Rule IDs (`BMS-*`) are defined in
//! `docs/planning/PSE_BANK_MUTATION_SAFETY_CONTRACT.md`.

use crate::{
    encode_field, validate_prefixed_sha256, PlanId, PLAN_ID_PREFIX, ROOT_FINGERPRINT_PREFIX,
};
use ot_domain::project_structure::{
    BankIndex, BankStructure, ProjectStructure, UnmodeledDependency,
};
use ot_domain::{
    ContentHash, RootId, RootRelativePath, StateDocumentParseStatus, StateDocumentRole,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const BANK_MUTATION_CONTRACT_SCHEMA: &str = "masterocta.bank-mutation-contract:v1";
const BANK_MUTATION_PLAN_CANONICAL_PREFIX: &[u8] = b"masterocta:bank-mutation-plan:v1";

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum BankMutationKind {
    Copy,
    Move,
    Swap,
}

impl BankMutationKind {
    fn code(self) -> u8 {
        match self {
            Self::Copy => 1,
            Self::Move => 2,
            Self::Swap => 3,
        }
    }
}

/// Phases of one Bank mutation (BMS-FLOW).
///
/// `Intent` through `Prepare` never write the target. `Apply` and `Recovery`
/// are the only phases that may write it. `Verify` only reads.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum BankMutationPhase {
    Intent,
    Plan,
    Review,
    Backup,
    Prepare,
    Apply,
    Verify,
    Recovery,
    Committed,
    RolledBack,
    RecoveryRequired,
    Cancelled,
}

/// What a failure in a phase obliges the executor to do (BMS-FAIL).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FailureDisposition {
    /// The target was never written. Close as cancelled and prove PRE == POST.
    CancelWithoutTargetChange,
    /// The target may differ from PRE. Recovery must restore PRE.
    RecoverToPre,
    /// Recovery itself failed. Every mutation on the root stays blocked.
    BlockRootUntilRecovered,
    /// Terminal phase; nothing left to fail.
    NotApplicable,
}

impl BankMutationPhase {
    /// The flow named by #182, in order.
    pub const REQUIRED_FLOW: [Self; 8] = [
        Self::Intent,
        Self::Plan,
        Self::Review,
        Self::Backup,
        Self::Prepare,
        Self::Apply,
        Self::Verify,
        Self::Recovery,
    ];

    pub const ALL: [Self; 12] = [
        Self::Intent,
        Self::Plan,
        Self::Review,
        Self::Backup,
        Self::Prepare,
        Self::Apply,
        Self::Verify,
        Self::Recovery,
        Self::Committed,
        Self::RolledBack,
        Self::RecoveryRequired,
        Self::Cancelled,
    ];

    /// Whether this phase may issue a write to the target project.
    pub fn may_write_target(self) -> bool {
        matches!(self, Self::Apply | Self::Recovery)
    }

    /// Whether the target must still be byte-identical to the PRE manifest.
    pub fn target_must_equal_pre(self) -> bool {
        matches!(
            self,
            Self::Intent
                | Self::Plan
                | Self::Review
                | Self::Backup
                | Self::Prepare
                | Self::Cancelled
                | Self::RolledBack
        )
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Committed | Self::RolledBack | Self::Cancelled)
    }

    pub fn on_failure(self) -> FailureDisposition {
        match self {
            Self::Intent | Self::Plan | Self::Review | Self::Backup | Self::Prepare => {
                FailureDisposition::CancelWithoutTargetChange
            }
            Self::Apply | Self::Verify => FailureDisposition::RecoverToPre,
            Self::Recovery | Self::RecoveryRequired => FailureDisposition::BlockRootUntilRecovered,
            Self::Committed | Self::RolledBack | Self::Cancelled => {
                FailureDisposition::NotApplicable
            }
        }
    }

    /// Allowed transitions. No phase is skipped, Apply cannot be cancelled
    /// midway, and a stale or rejected plan is closed rather than rebased.
    pub fn may_transition_to(self, next: Self) -> bool {
        use BankMutationPhase::*;
        matches!(
            (self, next),
            (Intent, Plan)
                | (Plan, Review)
                | (Review, Backup)
                | (Backup, Prepare)
                | (Prepare, Apply)
                | (Apply, Verify)
                | (Apply, Recovery)
                | (Verify, Committed)
                | (Verify, Recovery)
                | (Recovery, RolledBack)
                | (Recovery, RecoveryRequired)
                | (RecoveryRequired, Recovery)
                | (Intent | Plan | Review | Backup | Prepare, Cancelled)
        )
    }
}

/// One entry of a project-scope manifest (BMS-WRITE).
///
/// `ContentHash` here is the generic SHA-256 byte digest of one entry, the same
/// value plan, backup, and executor use. It is not an AudioAsset identity.
/// Symlink text is kept only as a digest so a manifest never carries a path
/// outside the root. mtime, atime, and permission bits are not part of the
/// contract; FAT media do not preserve them reliably.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ManifestEntry {
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

impl ManifestEntry {
    fn tag(&self) -> u8 {
        match self {
            Self::File { .. } => 1,
            Self::Directory => 2,
            Self::Symlink { .. } => 3,
            Self::Other => 4,
        }
    }
}

/// Every entry under the project directory, keyed by root-relative path.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TreeManifest {
    entries: BTreeMap<String, (RootRelativePath, ManifestEntry)>,
}

impl TreeManifest {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the replaced entry when the path was already present.
    pub fn insert(
        &mut self,
        relative_path: RootRelativePath,
        entry: ManifestEntry,
    ) -> Option<ManifestEntry> {
        self.entries
            .insert(relative_path.as_str().to_owned(), (relative_path, entry))
            .map(|(_, previous)| previous)
    }

    pub fn get(&self, relative_path: &RootRelativePath) -> Option<&ManifestEntry> {
        self.entries
            .get(relative_path.as_str())
            .map(|(_, entry)| entry)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Entries in deterministic root-relative path order.
    pub fn iter(&self) -> impl Iterator<Item = (&RootRelativePath, &ManifestEntry)> {
        self.entries.values().map(|(path, entry)| (path, entry))
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum TreeChangeKind {
    Created,
    Removed,
    ContentChanged,
    EntryKindChanged,
    SymlinkRetargeted,
}

/// One observed write. Any of these kinds counts as a write (BMS-WRITE).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreeChange {
    pub relative_path: RootRelativePath,
    pub kind: TreeChangeKind,
}

/// Every difference between two manifests, in path order.
pub fn diff_manifests(pre: &TreeManifest, post: &TreeManifest) -> Vec<TreeChange> {
    let keys: BTreeSet<&String> = pre.entries.keys().chain(post.entries.keys()).collect();
    let mut changes = Vec::new();
    for key in keys {
        let change = match (pre.entries.get(key), post.entries.get(key)) {
            (Some((path, _)), None) => Some((path, TreeChangeKind::Removed)),
            (None, Some((path, _))) => Some((path, TreeChangeKind::Created)),
            (Some((path, before)), Some((_, after))) => {
                classify_entry_change(before, after).map(|kind| (path, kind))
            }
            (None, None) => None,
        };
        if let Some((path, kind)) = change {
            changes.push(TreeChange {
                relative_path: path.clone(),
                kind,
            });
        }
    }
    changes
}

fn classify_entry_change(before: &ManifestEntry, after: &ManifestEntry) -> Option<TreeChangeKind> {
    if before == after {
        return None;
    }
    Some(match (before, after) {
        (ManifestEntry::File { .. }, ManifestEntry::File { .. }) => TreeChangeKind::ContentChanged,
        (ManifestEntry::Symlink { .. }, ManifestEntry::Symlink { .. }) => {
            TreeChangeKind::SymlinkRetargeted
        }
        _ => TreeChangeKind::EntryKindChanged,
    })
}

/// No-write proof over a project scope (BMS-NOWRITE).
///
/// Equal manifests prove the bytes and entry kinds did not change. They do not
/// prove that no write syscall ran; pair this with a code path that has no
/// write API.
pub fn prove_no_write(pre: &TreeManifest, post: &TreeManifest) -> Result<(), Vec<TreeChange>> {
    let changes = diff_manifests(pre, post);
    if changes.is_empty() {
        Ok(())
    } else {
        Err(changes)
    }
}

/// Expected state of one path before or after Apply.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExpectedState {
    Absent,
    File {
        byte_size: u64,
        content_hash: ContentHash,
    },
}

impl ExpectedState {
    fn matches(&self, entry: Option<&ManifestEntry>) -> bool {
        match (self, entry) {
            (Self::Absent, None) => true,
            (
                Self::File {
                    byte_size,
                    content_hash,
                },
                Some(ManifestEntry::File {
                    byte_size: observed_size,
                    content_hash: observed_hash,
                }),
            ) => byte_size == observed_size && content_hash == observed_hash,
            _ => false,
        }
    }
}

/// One file the plan is allowed to change. `after` comes from staged bytes
/// built during Prepare, never from an assumption that a copied Bank is
/// byte-identical to its source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpectedChange {
    pub relative_path: RootRelativePath,
    pub before: ExpectedState,
    pub after: ExpectedState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IntegrityViolation {
    /// A path outside the expected change set changed.
    UnexpectedChange(TreeChange),
    /// A planned path did not hold its declared `before` state in PRE.
    PreStateMismatch { relative_path: RootRelativePath },
    /// A planned path does not hold its declared `after` state in POST.
    PostStateMismatch { relative_path: RootRelativePath },
}

/// Post-Apply byte-level check (BMS-VERIFY-BYTES).
///
/// Only the declared paths may change, each must land on its declared `after`
/// state, and every other entry in the project scope must be unchanged.
pub fn verify_expected_changes(
    pre: &TreeManifest,
    post: &TreeManifest,
    expected: &[ExpectedChange],
) -> Result<(), Vec<IntegrityViolation>> {
    let mut violations = Vec::new();
    let mut planned = BTreeSet::new();
    for change in expected {
        planned.insert(change.relative_path.as_str());
        if !change.before.matches(pre.get(&change.relative_path)) {
            violations.push(IntegrityViolation::PreStateMismatch {
                relative_path: change.relative_path.clone(),
            });
        }
        if !change.after.matches(post.get(&change.relative_path)) {
            violations.push(IntegrityViolation::PostStateMismatch {
                relative_path: change.relative_path.clone(),
            });
        }
    }
    for change in diff_manifests(pre, post) {
        if !planned.contains(change.relative_path.as_str()) {
            violations.push(IntegrityViolation::UnexpectedChange(change));
        }
    }
    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

/// Recovery check (BMS-RECOVER): after rollback the whole project scope must
/// equal the PRE manifest the plan was sealed with, not only the planned files.
pub fn verify_recovered_to_pre(
    envelope: &BankMutationEnvelope,
    post_recovery: &TreeManifest,
) -> Result<(), Vec<TreeChange>> {
    prove_no_write(&envelope.scope_manifest, post_recovery)
}

/// One Octatrack state document the plan read, with its parse status.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedDocument {
    pub relative_path: RootRelativePath,
    pub role: StateDocumentRole,
    pub parse_status: StateDocumentParseStatus,
}

/// Safety-relevant projection of a Bank ChangePlan (#181).
///
/// #181 owns how these values are computed. This contract owns which values
/// must be present and how they are checked. Build it with
/// [`BankMutationEnvelope::seal`]; the [`PlanId`] covers every field.
///
/// `id` and `fields` stay private after sealing. Callers can read the
/// projection through [`std::ops::Deref`] but cannot change it and reuse an
/// [`ApplyEntryPermit`].
///
/// ```compile_fail,E0616
/// # use ot_plan::bank_mutation::BankMutationEnvelope;
/// fn retarget(envelope: &mut BankMutationEnvelope) {
///     envelope.fields.expected_changes.clear();
/// }
/// ```
///
/// ```compile_fail,E0596
/// # use ot_plan::bank_mutation::BankMutationEnvelope;
/// fn retarget(envelope: &mut BankMutationEnvelope) {
///     envelope.expected_changes.clear();
/// }
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankMutationEnvelope {
    id: PlanId,
    fields: BankMutationEnvelopeFields,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankMutationEnvelopeFields {
    pub contract_schema: String,
    /// DTO schema of the read model the plan was computed from.
    pub read_model_schema: String,
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub base_observed_revision: u64,
    pub project_relative_path: RootRelativePath,
    pub kind: BankMutationKind,
    pub source: BankIndex,
    pub destination: BankIndex,
    /// Which of Working / SavedCheckpoint the operation moves. The other role
    /// must stay unchanged for both Banks.
    pub affected_roles: Vec<StateDocumentRole>,
    /// Full project-scope manifest at plan time. Any later difference is stale.
    pub scope_manifest: TreeManifest,
    pub documents: Vec<PlannedDocument>,
    pub expected_changes: Vec<ExpectedChange>,
    /// Dependencies the plan could not model. Any entry blocks Apply.
    pub unmodeled: Vec<UnmodeledDependency>,
}

impl BankMutationEnvelope {
    pub fn seal(fields: BankMutationEnvelopeFields) -> Self {
        let id = derive_bank_mutation_plan_id(&fields);
        Self { id, fields }
    }

    pub fn id(&self) -> &PlanId {
        &self.id
    }

    pub fn validate_integrity(&self) -> bool {
        derive_bank_mutation_plan_id(&self.fields) == self.id
    }

    pub fn scope_manifest(&self) -> &TreeManifest {
        &self.fields.scope_manifest
    }
}

impl std::ops::Deref for BankMutationEnvelope {
    type Target = BankMutationEnvelopeFields;

    fn deref(&self) -> &Self::Target {
        &self.fields
    }
}

pub fn derive_bank_mutation_plan_id(fields: &BankMutationEnvelopeFields) -> PlanId {
    let mut hasher = Sha256::new();
    hasher.update(BANK_MUTATION_PLAN_CANONICAL_PREFIX);
    encode_field(&mut hasher, 1, fields.contract_schema.as_bytes());
    encode_field(&mut hasher, 2, fields.read_model_schema.as_bytes());
    encode_field(&mut hasher, 3, fields.root_id.as_str().as_bytes());
    encode_field(&mut hasher, 4, fields.device_fingerprint.as_bytes());
    encode_field(&mut hasher, 5, &fields.base_observed_revision.to_be_bytes());
    encode_field(
        &mut hasher,
        6,
        fields.project_relative_path.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 7, &[fields.kind.code()]);
    encode_field(&mut hasher, 8, &[fields.source.get()]);
    encode_field(&mut hasher, 9, &[fields.destination.get()]);
    encode_count(&mut hasher, 10, fields.affected_roles.len());
    for role in &fields.affected_roles {
        encode_field(&mut hasher, 11, &[role_code(*role)]);
    }
    encode_count(&mut hasher, 12, fields.scope_manifest.len());
    for (path, entry) in fields.scope_manifest.iter() {
        encode_field(&mut hasher, 13, path.as_str().as_bytes());
        encode_field(&mut hasher, 14, &[entry.tag()]);
        match entry {
            ManifestEntry::File {
                byte_size,
                content_hash,
            } => {
                encode_field(&mut hasher, 15, &byte_size.to_be_bytes());
                encode_field(&mut hasher, 16, content_hash.as_str().as_bytes());
            }
            ManifestEntry::Symlink { target_digest } => {
                encode_field(&mut hasher, 17, target_digest.as_str().as_bytes());
            }
            ManifestEntry::Directory | ManifestEntry::Other => {}
        }
    }
    encode_count(&mut hasher, 18, fields.documents.len());
    for document in &fields.documents {
        encode_field(&mut hasher, 19, document.relative_path.as_str().as_bytes());
        encode_field(&mut hasher, 20, &[role_code(document.role)]);
        encode_field(&mut hasher, 21, &[parse_status_code(document.parse_status)]);
    }
    encode_count(&mut hasher, 22, fields.expected_changes.len());
    for change in &fields.expected_changes {
        encode_field(&mut hasher, 23, change.relative_path.as_str().as_bytes());
        encode_expected_state(&mut hasher, 24, &change.before);
        encode_expected_state(&mut hasher, 25, &change.after);
    }
    encode_count(&mut hasher, 26, fields.unmodeled.len());
    for dependency in &fields.unmodeled {
        encode_field(&mut hasher, 27, &[unmodeled_code(*dependency)]);
    }
    let digest = hasher.finalize();
    PlanId(format!("{PLAN_ID_PREFIX}{digest:x}"))
}

fn encode_count(hasher: &mut Sha256, tag: u8, count: usize) {
    encode_field(hasher, tag, &(count as u64).to_be_bytes());
}

fn encode_expected_state(hasher: &mut Sha256, tag: u8, state: &ExpectedState) {
    match state {
        ExpectedState::Absent => encode_field(hasher, tag, &[0]),
        ExpectedState::File {
            byte_size,
            content_hash,
        } => {
            encode_field(hasher, tag, &[1]);
            encode_field(hasher, tag, &byte_size.to_be_bytes());
            encode_field(hasher, tag, content_hash.as_str().as_bytes());
        }
    }
}

fn role_code(role: StateDocumentRole) -> u8 {
    match role {
        StateDocumentRole::Working => 1,
        StateDocumentRole::SavedCheckpoint => 2,
    }
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

/// Where Apply is allowed to write while #183 is fixture-only (BMS-TARGET).
///
/// The class must come from backend evidence about the registered root, not
/// from a frontend flag.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ApplyTargetClass {
    TrackedFixtureCopy,
    TemporaryProjectCopy,
    UserProject,
    OriginalMedia,
    Unclassified,
}

impl ApplyTargetClass {
    pub fn is_fixture_scope(self) -> bool {
        matches!(self, Self::TrackedFixtureCopy | Self::TemporaryProjectCopy)
    }
}

/// What the executor re-observes immediately before the first write.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiveTargetObservation {
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub identity_is_stable: bool,
    pub observed_revision: u64,
    pub write_enabled: bool,
    /// Any incomplete additive, rename, or Bank journal on the same root.
    pub recovery_pending: bool,
    pub read_model_schema: String,
    pub target_class: ApplyTargetClass,
    pub scope_manifest: TreeManifest,
    /// Executor read model for the same project. Parser evidence and unmodeled
    /// dependencies are taken from this value, not from the plan's lists.
    pub project_structure: ProjectStructure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BackupLocation {
    /// Application Support on the Mac, outside the target root.
    LocalAppSupport,
    TargetMedia,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackedUpFile {
    pub relative_path: RootRelativePath,
    pub byte_size: u64,
    pub content_hash: ContentHash,
}

/// Evidence of a backup snapshot, as reported after its re-read check.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupEvidence {
    pub plan_id: PlanId,
    pub complete: bool,
    pub reverified: bool,
    pub location: BackupLocation,
    pub files: Vec<BackedUpFile>,
}

/// Prerequisites that are outside this contract and still open on `main`.
///
/// They come from `PSE_READ_MODEL_EXIT_AUDIT.md` §7C, the #181 Done line, and
/// control plane §9 (PSE-3 needs a separate explicit approval).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ReadinessGap {
    BankChangePlan,
    ArrangementFileSlot,
    ArrangerPatternReferences,
    BankInternalIdentity,
    SceneAndRecorderDependencies,
    WorkingSavedCheckpointRule,
    ApplyAuthorization,
}

impl ReadinessGap {
    pub const ALL: [Self; 7] = [
        Self::BankChangePlan,
        Self::ArrangementFileSlot,
        Self::ArrangerPatternReferences,
        Self::BankInternalIdentity,
        Self::SceneAndRecorderDependencies,
        Self::WorkingSavedCheckpointRule,
        Self::ApplyAuthorization,
    ];

    pub fn tracking(self) -> &'static str {
        match self {
            Self::BankChangePlan => "#181",
            Self::ArrangementFileSlot => "#204",
            Self::ArrangerPatternReferences => "PSE_READ_MODEL_EXIT_AUDIT §7C / §8",
            Self::BankInternalIdentity => "PSE_READ_MODEL_EXIT_AUDIT §7C",
            Self::SceneAndRecorderDependencies => "PSE_READ_MODEL_EXIT_AUDIT §7C",
            Self::WorkingSavedCheckpointRule => "PSE_READ_MODEL_EXIT_AUDIT §7C",
            Self::ApplyAuthorization => "PROJECT_STRUCTURE_CONTROL_PLANE §9 PSE-3",
        }
    }
}

/// Which readiness gaps have reviewed evidence.
///
/// Production code must use [`ReadinessEvidence::current_main`]. Marking a gap
/// resolved is a reviewed change to that function and its pinned test, backed
/// by the evidence named in [`ReadinessGap::tracking`]. There is no production
/// constructor that closes a gap.
///
/// ```
/// # use ot_plan::bank_mutation::{ReadinessEvidence, ReadinessGap};
/// let readiness = ReadinessEvidence::current_main();
/// assert!(!readiness.open_gaps().contains(&ReadinessGap::ArrangementFileSlot));
/// assert_eq!(readiness.open_gaps().len(), ReadinessGap::ALL.len() - 2);
/// ```
///
/// ```compile_fail,E0599
/// # use ot_plan::bank_mutation::{ReadinessEvidence, ReadinessGap};
/// let readiness = ReadinessEvidence::assume_resolved(ReadinessGap::ALL);
/// ```
///
/// ```compile_fail,E0451
/// # use ot_plan::bank_mutation::{ReadinessEvidence, ReadinessGap};
/// let readiness = ReadinessEvidence { resolved: ReadinessGap::ALL.into_iter().collect() };
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadinessEvidence {
    resolved: BTreeSet<ReadinessGap>,
}

impl Default for ReadinessEvidence {
    fn default() -> Self {
        Self::current_main()
    }
}

impl ReadinessEvidence {
    pub fn current_main() -> Self {
        let mut resolved = BTreeSet::new();
        // #204: UI Arrangement 1/2/8 mapped to raw 0/1/7 and arr01/arr02/arr08.
        resolved.insert(ReadinessGap::ArrangementFileSlot);
        // MO-PSE-BANK-CHANGEPLAN-CORE-1 (#181): read-only ChangePlan planner on main.
        resolved.insert(ReadinessGap::BankChangePlan);
        Self { resolved }
    }

    /// Contract tests only. A production build of this crate cannot call it,
    /// so a downstream executor cannot mark [`ReadinessGap::ApplyAuthorization`]
    /// or any other gap resolved.
    #[cfg(test)]
    pub fn assume_resolved(gaps: impl IntoIterator<Item = ReadinessGap>) -> Self {
        Self {
            resolved: gaps.into_iter().collect(),
        }
    }

    pub fn open_gaps(&self) -> Vec<ReadinessGap> {
        ReadinessGap::ALL
            .into_iter()
            .filter(|gap| !self.resolved.contains(gap))
            .collect()
    }
}

/// Reasons Apply must not start. Every applicable reason is reported.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StopCondition {
    ReadinessGap(ReadinessGap),
    ContractSchemaMismatch,
    PlanIntegrityMismatch,
    InvalidRootFingerprint,
    InvalidObservedRevision,
    SourceEqualsDestination,
    NoAffectedRoles,
    DuplicateAffectedRole,
    EmptyChangeSet,
    DuplicateExpectedChange {
        relative_path: RootRelativePath,
    },
    NoOpExpectedChange {
        relative_path: RootRelativePath,
    },
    ExpectedChangeOutsideProject {
        relative_path: RootRelativePath,
    },
    /// An operated Bank file the operation must write is missing from the change set.
    MissingOperatedBankChange {
        relative_path: RootRelativePath,
    },
    ExpectedChangeBeforeMismatch {
        relative_path: RootRelativePath,
    },
    /// Only `bankNN.work` / `bankNN.strd` directly in the project directory
    /// may be planned. Samples, `project.*`, markers, and arrangements may not.
    ExpectedChangeNotBankDocument {
        relative_path: RootRelativePath,
    },
    ExpectedChangeOutsideOperatedBanks {
        relative_path: RootRelativePath,
    },
    ExpectedChangeRoleNotAffected {
        relative_path: RootRelativePath,
    },
    /// An affected Bank, or `project.work`, has no parsed document in the plan.
    MissingParserEvidence {
        relative_path: RootRelativePath,
    },
    NonRegularEntryInScope {
        relative_path: RootRelativePath,
    },
    DocumentNotParsed {
        relative_path: RootRelativePath,
        parse_status: StateDocumentParseStatus,
    },
    UnmodeledDependency(UnmodeledDependency),
    RootMismatch,
    DeviceFingerprintChanged,
    UnstableRootIdentity,
    ObservedRevisionChanged,
    ReadModelSchemaChanged,
    StalePrecondition(TreeChange),
    WriteNotEnabled,
    RecoveryPending,
    TargetNotFixtureScope(ApplyTargetClass),
    BackupMissing,
    BackupPlanMismatch,
    BackupIncomplete,
    BackupNotReverified,
    BackupNotLocal(BackupLocation),
    BackupDoesNotCover {
        relative_path: RootRelativePath,
    },
    BackupHashMismatch {
        relative_path: RootRelativePath,
    },
}

impl StopCondition {
    /// Stable machine code for gates, logs, and future UI keys.
    pub fn code(&self) -> &'static str {
        match self {
            Self::ReadinessGap(_) => "BMS_READINESS_GAP",
            Self::ContractSchemaMismatch => "BMS_CONTRACT_SCHEMA_MISMATCH",
            Self::PlanIntegrityMismatch => "BMS_PLAN_INTEGRITY_MISMATCH",
            Self::InvalidRootFingerprint => "BMS_INVALID_ROOT_FINGERPRINT",
            Self::InvalidObservedRevision => "BMS_INVALID_OBSERVED_REVISION",
            Self::SourceEqualsDestination => "BMS_SOURCE_EQUALS_DESTINATION",
            Self::NoAffectedRoles => "BMS_NO_AFFECTED_ROLES",
            Self::DuplicateAffectedRole => "BMS_DUPLICATE_AFFECTED_ROLE",
            Self::EmptyChangeSet => "BMS_EMPTY_CHANGE_SET",
            Self::DuplicateExpectedChange { .. } => "BMS_DUPLICATE_EXPECTED_CHANGE",
            Self::NoOpExpectedChange { .. } => "BMS_NOOP_EXPECTED_CHANGE",
            Self::ExpectedChangeOutsideProject { .. } => "BMS_CHANGE_OUTSIDE_PROJECT",
            Self::MissingOperatedBankChange { .. } => "BMS_MISSING_OPERATED_BANK_CHANGE",
            Self::ExpectedChangeBeforeMismatch { .. } => "BMS_CHANGE_BEFORE_MISMATCH",
            Self::ExpectedChangeNotBankDocument { .. } => "BMS_CHANGE_NOT_BANK_DOCUMENT",
            Self::ExpectedChangeOutsideOperatedBanks { .. } => "BMS_CHANGE_OUTSIDE_OPERATED_BANKS",
            Self::ExpectedChangeRoleNotAffected { .. } => "BMS_CHANGE_ROLE_NOT_AFFECTED",
            Self::MissingParserEvidence { .. } => "BMS_MISSING_PARSER_EVIDENCE",
            Self::NonRegularEntryInScope { .. } => "BMS_NON_REGULAR_ENTRY",
            Self::DocumentNotParsed { .. } => "BMS_DOCUMENT_NOT_PARSED",
            Self::UnmodeledDependency(_) => "BMS_UNMODELED_DEPENDENCY",
            Self::RootMismatch => "BMS_ROOT_MISMATCH",
            Self::DeviceFingerprintChanged => "BMS_DEVICE_FINGERPRINT_CHANGED",
            Self::UnstableRootIdentity => "BMS_UNSTABLE_ROOT_IDENTITY",
            Self::ObservedRevisionChanged => "BMS_OBSERVED_REVISION_CHANGED",
            Self::ReadModelSchemaChanged => "BMS_READ_MODEL_SCHEMA_CHANGED",
            Self::StalePrecondition(_) => "BMS_STALE_PRECONDITION",
            Self::WriteNotEnabled => "BMS_WRITE_NOT_ENABLED",
            Self::RecoveryPending => "BMS_RECOVERY_PENDING",
            Self::TargetNotFixtureScope(_) => "BMS_TARGET_NOT_FIXTURE_SCOPE",
            Self::BackupMissing => "BMS_BACKUP_MISSING",
            Self::BackupPlanMismatch => "BMS_BACKUP_PLAN_MISMATCH",
            Self::BackupIncomplete => "BMS_BACKUP_INCOMPLETE",
            Self::BackupNotReverified => "BMS_BACKUP_NOT_REVERIFIED",
            Self::BackupNotLocal(_) => "BMS_BACKUP_NOT_LOCAL",
            Self::BackupDoesNotCover { .. } => "BMS_BACKUP_DOES_NOT_COVER",
            Self::BackupHashMismatch { .. } => "BMS_BACKUP_HASH_MISMATCH",
        }
    }
}

impl fmt::Display for StopCondition {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadinessGap(gap) => {
                write!(formatter, "{}: {:?} ({})", self.code(), gap, gap.tracking())
            }
            Self::StalePrecondition(change) => write!(
                formatter,
                "{}: {:?} {}",
                self.code(),
                change.kind,
                change.relative_path.as_str()
            ),
            other => formatter.write_str(other.code()),
        }
    }
}

/// Proof that every entry check passed for one sealed plan.
///
/// Only [`evaluate_apply_entry`] constructs it, and it owns the envelope that
/// was checked. A future Apply entry point must read [`Self::envelope`] and
/// must not write from a separately supplied envelope, even one with the same
/// [`PlanId`].
///
/// A permit is evidence from one observation, not a lease. Immediately before
/// the first write, under the root writer lock, the executor must re-observe
/// the target and call [`Self::reverify`]; only the permit it returns may be
/// used for that write.
///
/// ```compile_fail,E0451
/// # use ot_plan::bank_mutation::{ApplyEntryPermit, BankMutationEnvelope};
/// fn forge(envelope: BankMutationEnvelope) -> ApplyEntryPermit {
///     ApplyEntryPermit { envelope }
/// }
/// ```
#[derive(Debug, Eq, PartialEq)]
pub struct ApplyEntryPermit {
    envelope: BankMutationEnvelope,
}

impl ApplyEntryPermit {
    pub fn plan_id(&self) -> &PlanId {
        &self.envelope.id
    }

    pub fn envelope(&self) -> &BankMutationEnvelope {
        &self.envelope
    }

    /// Re-runs every entry check on the owned envelope against a fresh
    /// observation. Consumes the permit, so a stale one cannot be kept.
    pub fn reverify(
        self,
        live: &LiveTargetObservation,
        backup: Option<&BackupEvidence>,
        readiness: &ReadinessEvidence,
    ) -> Result<Self, Vec<StopCondition>> {
        evaluate_apply_entry(self.envelope, live, backup, readiness)
    }
}

fn role_extension(role: StateDocumentRole) -> &'static str {
    match role {
        StateDocumentRole::Working => "work",
        StateDocumentRole::SavedCheckpoint => "strd",
    }
}

fn project_child(project: &RootRelativePath, file_name: &str) -> RootRelativePath {
    let components = project.as_str().split('/').chain([file_name]);
    RootRelativePath::from_components(components)
        .expect("bank and project document names are single relative components")
}

fn project_work_path(project: &RootRelativePath) -> RootRelativePath {
    project_child(project, "project.work")
}

fn bank_document_path(
    project: &RootRelativePath,
    bank: BankIndex,
    role: StateDocumentRole,
) -> RootRelativePath {
    let file_name = format!("bank{:02}.{}", bank.file_number(), role_extension(role));
    project_child(project, &file_name)
}

#[cfg(test)]
fn bank_slot_for_path(
    project: &RootRelativePath,
    path: &RootRelativePath,
) -> Option<(BankIndex, StateDocumentRole)> {
    for bank in BankIndex::all() {
        for role in [
            StateDocumentRole::Working,
            StateDocumentRole::SavedCheckpoint,
        ] {
            if bank_document_path(project, bank, role) == *path {
                return Some((bank, role));
            }
        }
    }
    None
}

fn unique_roles(roles: &[StateDocumentRole]) -> Vec<StateDocumentRole> {
    let mut unique = Vec::new();
    for role in roles {
        if !unique.contains(role) {
            unique.push(*role);
        }
    }
    unique
}

/// Banks whose files this operation writes, and the only Banks a change set
/// may name. Copy writes the destination only; its source must stay
/// byte-identical. Move and Swap write both Banks.
fn written_bank_indexes(fields: &BankMutationEnvelopeFields) -> Vec<BankIndex> {
    match fields.kind {
        BankMutationKind::Copy => vec![fields.destination],
        BankMutationKind::Move | BankMutationKind::Swap => {
            vec![fields.source, fields.destination]
        }
    }
}

fn operated_change_paths(fields: &BankMutationEnvelopeFields) -> Vec<RootRelativePath> {
    let mut paths = Vec::new();
    for bank in written_bank_indexes(fields) {
        for role in unique_roles(&fields.affected_roles) {
            paths.push(bank_document_path(
                &fields.project_relative_path,
                bank,
                role,
            ));
        }
    }
    paths.sort_by(|left, right| left.as_str().cmp(right.as_str()));
    paths.dedup();
    paths
}

struct ParserSlot {
    relative_path: RootRelativePath,
    role: StateDocumentRole,
    bank: Option<BankIndex>,
}

/// `project.work`, the source Bank for every affected role, and a destination
/// Bank that already exists or that Swap must read.
fn required_parser_slots(fields: &BankMutationEnvelopeFields) -> Vec<ParserSlot> {
    let mut slots = vec![ParserSlot {
        relative_path: project_work_path(&fields.project_relative_path),
        role: StateDocumentRole::Working,
        bank: None,
    }];
    for role in unique_roles(&fields.affected_roles) {
        slots.push(ParserSlot {
            relative_path: bank_document_path(&fields.project_relative_path, fields.source, role),
            role,
            bank: Some(fields.source),
        });
        let destination_path =
            bank_document_path(&fields.project_relative_path, fields.destination, role);
        let destination_exists = matches!(
            fields.scope_manifest.get(&destination_path),
            Some(ManifestEntry::File { .. })
        );
        if fields.kind == BankMutationKind::Swap || destination_exists {
            slots.push(ParserSlot {
                relative_path: destination_path,
                role,
                bank: Some(fields.destination),
            });
        }
    }
    slots
}

fn parser_coverage_stops(envelope: &BankMutationEnvelope) -> Vec<StopCondition> {
    let mut stops = Vec::new();
    for slot in required_parser_slots(envelope) {
        let parsed = envelope.documents.iter().any(|document| {
            document.relative_path == slot.relative_path
                && document.role == slot.role
                && document.parse_status == StateDocumentParseStatus::Parsed
        });
        if parsed {
            continue;
        }
        let already_rejected = envelope.documents.iter().any(|document| {
            document.relative_path == slot.relative_path
                && document.parse_status != StateDocumentParseStatus::Parsed
        });
        if !already_rejected {
            stops.push(StopCondition::MissingParserEvidence {
                relative_path: slot.relative_path,
            });
        }
    }
    stops
}

fn push_unique(stops: &mut Vec<StopCondition>, stop: StopCondition) {
    if !stops.contains(&stop) {
        stops.push(stop);
    }
}

fn append_trusted_parser_stops(
    stops: &mut Vec<StopCondition>,
    envelope: &BankMutationEnvelope,
    structure: &ProjectStructure,
) {
    let same_project = structure.project_relative_path == envelope.project_relative_path;
    for slot in required_parser_slots(envelope) {
        if !same_project {
            push_unique(
                stops,
                StopCondition::MissingParserEvidence {
                    relative_path: slot.relative_path,
                },
            );
            continue;
        }
        let Some(bank) = slot.bank else {
            match &structure.project_state {
                Some(state)
                    if state.source_relative_path == slot.relative_path
                        && state.role == StateDocumentRole::Working
                        && state.parse_status != StateDocumentParseStatus::Parsed =>
                {
                    push_unique(
                        stops,
                        StopCondition::DocumentNotParsed {
                            relative_path: slot.relative_path,
                            parse_status: state.parse_status,
                        },
                    );
                }
                Some(state)
                    if state.source_relative_path == slot.relative_path
                        && state.role == StateDocumentRole::Working => {}
                _ => push_unique(
                    stops,
                    StopCondition::MissingParserEvidence {
                        relative_path: slot.relative_path,
                    },
                ),
            }
            continue;
        };
        match structure.bank(bank, slot.role) {
            Some(entry) if entry.source_relative_path == slot.relative_path => {
                if entry.parse_status != StateDocumentParseStatus::Parsed {
                    push_unique(
                        stops,
                        StopCondition::DocumentNotParsed {
                            relative_path: slot.relative_path.clone(),
                            parse_status: entry.parse_status,
                        },
                    );
                }
                for dependency in &entry.unmodeled {
                    push_unique(stops, StopCondition::UnmodeledDependency(*dependency));
                }
            }
            _ => push_unique(
                stops,
                StopCondition::MissingParserEvidence {
                    relative_path: slot.relative_path,
                },
            ),
        }
    }
}

/// Static checks on a sealed envelope (BMS-PLAN, BMS-PARSE, BMS-SCOPE).
pub fn validate_envelope(envelope: &BankMutationEnvelope) -> Vec<StopCondition> {
    let mut stops = Vec::new();
    if envelope.contract_schema != BANK_MUTATION_CONTRACT_SCHEMA {
        stops.push(StopCondition::ContractSchemaMismatch);
    }
    if !envelope.validate_integrity() {
        stops.push(StopCondition::PlanIntegrityMismatch);
    }
    if validate_prefixed_sha256(&envelope.device_fingerprint, ROOT_FINGERPRINT_PREFIX).is_err() {
        stops.push(StopCondition::InvalidRootFingerprint);
    }
    if envelope.base_observed_revision == 0 {
        stops.push(StopCondition::InvalidObservedRevision);
    }
    if envelope.source == envelope.destination {
        stops.push(StopCondition::SourceEqualsDestination);
    }
    if envelope.affected_roles.is_empty() {
        stops.push(StopCondition::NoAffectedRoles);
    }
    let unique_roles: BTreeSet<u8> = envelope
        .affected_roles
        .iter()
        .map(|role| role_code(*role))
        .collect();
    if unique_roles.len() != envelope.affected_roles.len() {
        stops.push(StopCondition::DuplicateAffectedRole);
    }
    if envelope.expected_changes.is_empty() {
        stops.push(StopCondition::EmptyChangeSet);
    }
    let project_prefix = format!("{}/", envelope.project_relative_path.as_str());
    let allowed = operated_change_paths(envelope);
    let written = written_bank_indexes(envelope);
    let mut seen = BTreeSet::new();
    for change in &envelope.expected_changes {
        let path = &change.relative_path;
        if !seen.insert(path.as_str()) {
            stops.push(StopCondition::DuplicateExpectedChange {
                relative_path: path.clone(),
            });
        }
        if change.before == change.after {
            stops.push(StopCondition::NoOpExpectedChange {
                relative_path: path.clone(),
            });
        }
        match path
            .as_str()
            .strip_prefix(&project_prefix)
            .map(bank_document_target)
        {
            None => stops.push(StopCondition::ExpectedChangeOutsideProject {
                relative_path: path.clone(),
            }),
            Some(None) => stops.push(StopCondition::ExpectedChangeNotBankDocument {
                relative_path: path.clone(),
            }),
            Some(Some((bank, _))) if !written.contains(&bank) => {
                stops.push(StopCondition::ExpectedChangeOutsideOperatedBanks {
                    relative_path: path.clone(),
                })
            }
            Some(Some((_, role))) if !envelope.affected_roles.contains(&role) => {
                stops.push(StopCondition::ExpectedChangeRoleNotAffected {
                    relative_path: path.clone(),
                })
            }
            Some(Some(_)) => {}
        }
        if !change.before.matches(envelope.scope_manifest.get(path)) {
            stops.push(StopCondition::ExpectedChangeBeforeMismatch {
                relative_path: path.clone(),
            });
        }
    }
    if !envelope.expected_changes.is_empty() {
        for path in &allowed {
            if !seen.contains(path.as_str()) {
                stops.push(StopCondition::MissingOperatedBankChange {
                    relative_path: path.clone(),
                });
            }
        }
    }
    for (path, entry) in envelope.scope_manifest.iter() {
        if matches!(entry, ManifestEntry::Symlink { .. } | ManifestEntry::Other) {
            stops.push(StopCondition::NonRegularEntryInScope {
                relative_path: path.clone(),
            });
        }
    }
    for document in &envelope.documents {
        if document.parse_status != StateDocumentParseStatus::Parsed {
            stops.push(StopCondition::DocumentNotParsed {
                relative_path: document.relative_path.clone(),
                parse_status: document.parse_status,
            });
        }
    }
    stops.extend(parser_coverage_stops(envelope));
    for dependency in &envelope.unmodeled {
        stops.push(StopCondition::UnmodeledDependency(*dependency));
    }
    stops
}

/// Parses a project-directory child name as `bankNN.work` / `bankNN.strd`
/// (BMS-CHANGESET). Nested paths and any other name return `None`.
pub fn bank_document_target(file_name: &str) -> Option<(BankIndex, StateDocumentRole)> {
    let (stem, extension) = file_name.split_once('.')?;
    let role = match extension {
        "work" => StateDocumentRole::Working,
        "strd" => StateDocumentRole::SavedCheckpoint,
        _ => return None,
    };
    let digits = stem.strip_prefix("bank")?;
    if digits.len() != 2 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let number: u8 = digits.parse().ok()?;
    let bank = BankIndex::new(number.checked_sub(1)?).ok()?;
    Some((bank, role))
}

/// Apply entry gate (BMS-ENTRY). Fail closed: any stop condition, including
/// any open readiness gap, withholds the permit.
pub fn evaluate_apply_entry(
    envelope: BankMutationEnvelope,
    live: &LiveTargetObservation,
    backup: Option<&BackupEvidence>,
    readiness: &ReadinessEvidence,
) -> Result<ApplyEntryPermit, Vec<StopCondition>> {
    let mut stops: Vec<StopCondition> = readiness
        .open_gaps()
        .into_iter()
        .map(StopCondition::ReadinessGap)
        .collect();
    stops.extend(validate_envelope(&envelope));
    stops.extend(live_target_stops(&envelope, live));
    stops.extend(backup_stops(&envelope, backup));
    if stops.is_empty() {
        Ok(ApplyEntryPermit { envelope })
    } else {
        Err(stops)
    }
}

fn live_target_stops(
    envelope: &BankMutationEnvelope,
    live: &LiveTargetObservation,
) -> Vec<StopCondition> {
    let mut stops = Vec::new();
    if live.root_id != envelope.root_id {
        stops.push(StopCondition::RootMismatch);
    }
    if live.device_fingerprint != envelope.device_fingerprint {
        stops.push(StopCondition::DeviceFingerprintChanged);
    }
    if !live.identity_is_stable {
        stops.push(StopCondition::UnstableRootIdentity);
    }
    if live.observed_revision != envelope.base_observed_revision {
        stops.push(StopCondition::ObservedRevisionChanged);
    }
    if live.read_model_schema != envelope.read_model_schema {
        stops.push(StopCondition::ReadModelSchemaChanged);
    }
    stops.extend(
        diff_manifests(&envelope.scope_manifest, &live.scope_manifest)
            .into_iter()
            .map(StopCondition::StalePrecondition),
    );
    if !live.write_enabled {
        stops.push(StopCondition::WriteNotEnabled);
    }
    if live.recovery_pending {
        stops.push(StopCondition::RecoveryPending);
    }
    if !live.target_class.is_fixture_scope() {
        stops.push(StopCondition::TargetNotFixtureScope(live.target_class));
    }
    append_trusted_parser_stops(&mut stops, envelope, &live.project_structure);
    stops
}

/// Backup must be a complete, re-read, Mac-local snapshot bound to this plan
/// that holds every pre-existing file the plan changes (BMS-BACKUP).
fn backup_stops(
    envelope: &BankMutationEnvelope,
    backup: Option<&BackupEvidence>,
) -> Vec<StopCondition> {
    let Some(backup) = backup else {
        return vec![StopCondition::BackupMissing];
    };
    let mut stops = Vec::new();
    if backup.plan_id != envelope.id {
        stops.push(StopCondition::BackupPlanMismatch);
    }
    if !backup.complete {
        stops.push(StopCondition::BackupIncomplete);
    }
    if !backup.reverified {
        stops.push(StopCondition::BackupNotReverified);
    }
    if backup.location != BackupLocation::LocalAppSupport {
        stops.push(StopCondition::BackupNotLocal(backup.location));
    }
    for change in &envelope.expected_changes {
        let ExpectedState::File {
            byte_size,
            content_hash,
        } = &change.before
        else {
            continue;
        };
        match backup
            .files
            .iter()
            .find(|file| file.relative_path == change.relative_path)
        {
            None => stops.push(StopCondition::BackupDoesNotCover {
                relative_path: change.relative_path.clone(),
            }),
            Some(file) if file.byte_size != *byte_size || file.content_hash != *content_hash => {
                stops.push(StopCondition::BackupHashMismatch {
                    relative_path: change.relative_path.clone(),
                })
            }
            Some(_) => {}
        }
    }
    stops
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ObservationSide {
    Pre,
    Post,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StructureViolation {
    AffectedBankNotParsed {
        bank: BankIndex,
        role: StateDocumentRole,
        side: ObservationSide,
    },
    UnaffectedBankChanged {
        bank: BankIndex,
        role: StateDocumentRole,
    },
    UnaffectedRoleChanged {
        bank: BankIndex,
        role: StateDocumentRole,
    },
    BankContentMismatch {
        bank: BankIndex,
        role: StateDocumentRole,
    },
    /// The state a Move leaves behind in its source Bank is not decided.
    MoveVacatedSourceUndefined,
    ProjectStateChanged,
}

/// Post-Apply structure check against the read model (BMS-VERIFY-STRUCTURE).
///
/// `pre` and `post` are full read-model results for the same project. Banks
/// outside the operation, roles outside `affected_roles`, and project state
/// must be equal. Moved content must match by Pattern, Part, Track, and slot
/// reference; file name and Bank index are not compared.
pub fn verify_bank_structure(
    envelope: &BankMutationEnvelope,
    pre: &ProjectStructure,
    post: &ProjectStructure,
) -> Result<(), Vec<StructureViolation>> {
    let mut violations = Vec::new();
    if pre.project_state != post.project_state {
        violations.push(StructureViolation::ProjectStateChanged);
    }
    let source = envelope.source;
    let destination = envelope.destination;
    for role in [
        StateDocumentRole::Working,
        StateDocumentRole::SavedCheckpoint,
    ] {
        let affected = envelope.affected_roles.contains(&role);
        for bank in BankIndex::all() {
            let operated = bank == source || bank == destination;
            if !operated {
                if pre.bank(bank, role) != post.bank(bank, role) {
                    violations.push(StructureViolation::UnaffectedBankChanged { bank, role });
                }
                continue;
            }
            if !affected {
                if pre.bank(bank, role) != post.bank(bank, role) {
                    violations.push(StructureViolation::UnaffectedRoleChanged { bank, role });
                }
                continue;
            }
            for (side, structure) in [(ObservationSide::Pre, pre), (ObservationSide::Post, post)] {
                if let Some(entry) = structure.bank(bank, role) {
                    if entry.parse_status != StateDocumentParseStatus::Parsed {
                        violations.push(StructureViolation::AffectedBankNotParsed {
                            bank,
                            role,
                            side,
                        });
                    }
                }
            }
        }
        if !affected {
            continue;
        }
        let expect = |target: BankIndex, origin: BankIndex, violations: &mut Vec<_>| {
            if !same_bank_content(pre.bank(origin, role), post.bank(target, role)) {
                violations.push(StructureViolation::BankContentMismatch { bank: target, role });
            }
        };
        match envelope.kind {
            BankMutationKind::Copy => {
                expect(destination, source, &mut violations);
                expect(source, source, &mut violations);
            }
            BankMutationKind::Swap => {
                expect(destination, source, &mut violations);
                expect(source, destination, &mut violations);
            }
            BankMutationKind::Move => {
                expect(destination, source, &mut violations);
            }
        }
    }
    if envelope.kind == BankMutationKind::Move {
        violations.push(StructureViolation::MoveVacatedSourceUndefined);
    }
    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

fn same_bank_content(expected: Option<&BankStructure>, actual: Option<&BankStructure>) -> bool {
    match (expected, actual) {
        (None, None) => true,
        (Some(expected), Some(actual)) => {
            expected.role == actual.role
                && expected.parse_status == StateDocumentParseStatus::Parsed
                && actual.parse_status == StateDocumentParseStatus::Parsed
                && expected.patterns == actual.patterns
                && expected.parts == actual.parts
                && expected.unmodeled == actual.unmodeled
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::project_structure::{
        PartIndex, PatternIndex, PatternPlaybackScale, PatternScale, PatternStructure,
        ProjectStateDocument, BANK_UNMODELED_DEPENDENCIES,
    };

    const PROJECT: &str = "SET/PROJECT";

    fn path(value: &str) -> RootRelativePath {
        RootRelativePath::parse(value).unwrap()
    }

    fn hash(fill: char) -> ContentHash {
        ContentHash::parse(format!("sha256:{}", fill.to_string().repeat(64))).unwrap()
    }

    fn file(size: u64, fill: char) -> ManifestEntry {
        ManifestEntry::File {
            byte_size: size,
            content_hash: hash(fill),
        }
    }

    fn expected_file(size: u64, fill: char) -> ExpectedState {
        ExpectedState::File {
            byte_size: size,
            content_hash: hash(fill),
        }
    }

    fn bank(value: u8) -> BankIndex {
        BankIndex::new(value).unwrap()
    }

    fn pre_manifest() -> TreeManifest {
        let mut manifest = TreeManifest::new();
        manifest.insert(path(PROJECT), ManifestEntry::Directory);
        manifest.insert(path("SET/PROJECT/project.work"), file(10, 'a'));
        manifest.insert(path("SET/PROJECT/bank01.work"), file(20, 'b'));
        manifest.insert(path("SET/PROJECT/bank01.strd"), file(20, 'c'));
        manifest.insert(path("SET/PROJECT/markers.work"), file(5, 'd'));
        manifest
    }

    fn copy_fields() -> BankMutationEnvelopeFields {
        BankMutationEnvelopeFields {
            contract_schema: BANK_MUTATION_CONTRACT_SCHEMA.to_owned(),
            read_model_schema: "masterocta.project-structure:v4".to_owned(),
            root_id: RootId::new("root-session-1").unwrap(),
            device_fingerprint: format!("rootfp:v1:{}", "e".repeat(64)),
            base_observed_revision: 3,
            project_relative_path: path(PROJECT),
            kind: BankMutationKind::Copy,
            source: bank(0),
            destination: bank(1),
            affected_roles: vec![StateDocumentRole::Working],
            scope_manifest: pre_manifest(),
            documents: vec![
                PlannedDocument {
                    relative_path: path("SET/PROJECT/project.work"),
                    role: StateDocumentRole::Working,
                    parse_status: StateDocumentParseStatus::Parsed,
                },
                PlannedDocument {
                    relative_path: path("SET/PROJECT/bank01.work"),
                    role: StateDocumentRole::Working,
                    parse_status: StateDocumentParseStatus::Parsed,
                },
            ],
            expected_changes: vec![ExpectedChange {
                relative_path: path("SET/PROJECT/bank02.work"),
                before: ExpectedState::Absent,
                after: expected_file(20, 'f'),
            }],
            unmodeled: Vec::new(),
        }
    }

    fn structure_matching_envelope(envelope: &BankMutationEnvelope) -> ProjectStructure {
        let project_path = project_work_path(&envelope.project_relative_path);
        let project_state = envelope
            .documents
            .iter()
            .find(|document| document.relative_path == project_path)
            .map(|document| ProjectStateDocument {
                role: document.role,
                source_relative_path: document.relative_path.clone(),
                parse_status: document.parse_status,
                bank: None,
                pattern: None,
                arrangement: None,
                master_track: None,
            });
        let banks = envelope
            .documents
            .iter()
            .filter_map(|document| {
                let (bank, role) =
                    bank_slot_for_path(&envelope.project_relative_path, &document.relative_path)?;
                Some(BankStructure {
                    bank,
                    role,
                    source_relative_path: document.relative_path.clone(),
                    parse_status: document.parse_status,
                    patterns: Vec::new(),
                    parts: Vec::new(),
                    unmodeled: envelope.unmodeled.clone(),
                })
            })
            .collect();
        ProjectStructure {
            project_relative_path: envelope.project_relative_path.clone(),
            project_state,
            banks,
        }
    }

    fn live_for(envelope: &BankMutationEnvelope) -> LiveTargetObservation {
        LiveTargetObservation {
            root_id: envelope.root_id.clone(),
            device_fingerprint: envelope.device_fingerprint.clone(),
            identity_is_stable: true,
            observed_revision: envelope.base_observed_revision,
            write_enabled: true,
            recovery_pending: false,
            read_model_schema: envelope.read_model_schema.clone(),
            target_class: ApplyTargetClass::TemporaryProjectCopy,
            scope_manifest: envelope.scope_manifest.clone(),
            project_structure: structure_matching_envelope(envelope),
        }
    }

    fn backup_for(envelope: &BankMutationEnvelope) -> BackupEvidence {
        BackupEvidence {
            plan_id: envelope.id.clone(),
            complete: true,
            reverified: true,
            location: BackupLocation::LocalAppSupport,
            files: envelope
                .expected_changes
                .iter()
                .filter_map(|change| match &change.before {
                    ExpectedState::File {
                        byte_size,
                        content_hash,
                    } => Some(BackedUpFile {
                        relative_path: change.relative_path.clone(),
                        byte_size: *byte_size,
                        content_hash: content_hash.clone(),
                    }),
                    ExpectedState::Absent => None,
                })
                .collect(),
        }
    }

    fn all_resolved() -> ReadinessEvidence {
        ReadinessEvidence::assume_resolved(ReadinessGap::ALL)
    }

    #[test]
    fn current_main_readiness_keeps_remaining_changeplan_gaps_open() {
        let open = ReadinessEvidence::current_main().open_gaps();
        assert!(!open.contains(&ReadinessGap::ArrangementFileSlot));
        assert!(!open.contains(&ReadinessGap::BankChangePlan));
        assert_eq!(open.len(), ReadinessGap::ALL.len() - 2);
        assert_eq!(ReadinessGap::BankChangePlan.tracking(), "#181");
        assert_eq!(ReadinessGap::ArrangementFileSlot.tracking(), "#204");

        let expected_open = [
            ReadinessGap::ArrangerPatternReferences,
            ReadinessGap::BankInternalIdentity,
            ReadinessGap::SceneAndRecorderDependencies,
            ReadinessGap::WorkingSavedCheckpointRule,
            ReadinessGap::ApplyAuthorization,
        ];
        for gap in expected_open {
            assert!(
                open.contains(&gap),
                "expected {gap:?} to remain open on current_main()"
            );
        }
        assert_eq!(open.len(), expected_open.len());
    }

    #[test]
    fn current_main_withholds_the_permit_even_for_a_clean_plan() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let live = live_for(&envelope);
        let backup = backup_for(&envelope);
        let stops = evaluate_apply_entry(
            envelope.clone(),
            &live,
            Some(&backup),
            &ReadinessEvidence::current_main(),
        )
        .unwrap_err();
        let expected: Vec<_> = ReadinessEvidence::current_main()
            .open_gaps()
            .into_iter()
            .map(StopCondition::ReadinessGap)
            .collect();
        assert_eq!(stops, expected);
    }

    #[test]
    fn a_single_open_gap_withholds_the_permit() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        for gap in ReadinessGap::ALL {
            let readiness = ReadinessEvidence::assume_resolved(
                ReadinessGap::ALL.into_iter().filter(|other| *other != gap),
            );
            let stops = evaluate_apply_entry(
                envelope.clone(),
                &live_for(&envelope),
                Some(&backup_for(&envelope)),
                &readiness,
            )
            .unwrap_err();
            assert_eq!(stops, vec![StopCondition::ReadinessGap(gap)]);
        }
    }

    #[test]
    fn clean_plan_with_resolved_readiness_gets_a_permit_bound_to_its_plan() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let permit = evaluate_apply_entry(
            envelope.clone(),
            &live_for(&envelope),
            Some(&backup_for(&envelope)),
            &all_resolved(),
        )
        .unwrap();
        assert_eq!(permit.plan_id(), &envelope.id);
        assert_eq!(permit.envelope(), &envelope);
        assert!(envelope.id.as_str().starts_with(PLAN_ID_PREFIX));
        assert!(!envelope.id.as_str().contains(PROJECT));
    }

    #[test]
    fn sealed_plan_id_is_deterministic_and_detects_tampering() {
        let first = BankMutationEnvelope::seal(copy_fields());
        let second = BankMutationEnvelope::seal(copy_fields());
        assert_eq!(first, second);
        assert!(first.validate_integrity());

        let mut tampered = first.clone();
        tampered.fields.expected_changes[0].after = expected_file(20, '9');
        assert!(!tampered.validate_integrity());
        let stops = validate_envelope(&tampered);
        assert_eq!(stops, vec![StopCondition::PlanIntegrityMismatch]);

        let mut retargeted = first.clone();
        retargeted.fields.destination = bank(2);
        assert!(!retargeted.validate_integrity());

        let mut other_kind = copy_fields();
        other_kind.kind = BankMutationKind::Swap;
        assert_ne!(BankMutationEnvelope::seal(other_kind).id, first.id);
    }

    #[test]
    fn envelope_shape_fails_closed() {
        let mut fields = copy_fields();
        fields.contract_schema = "masterocta.bank-mutation-contract:v0".to_owned();
        fields.device_fingerprint = "not-a-fingerprint".to_owned();
        fields.base_observed_revision = 0;
        fields.destination = fields.source;
        fields.affected_roles = Vec::new();
        fields.expected_changes = Vec::new();
        let stops = validate_envelope(&BankMutationEnvelope::seal(fields));
        assert_eq!(
            stops,
            vec![
                StopCondition::ContractSchemaMismatch,
                StopCondition::InvalidRootFingerprint,
                StopCondition::InvalidObservedRevision,
                StopCondition::SourceEqualsDestination,
                StopCondition::NoAffectedRoles,
                StopCondition::EmptyChangeSet,
            ]
        );
    }

    #[test]
    fn expected_changes_must_be_unique_real_and_inside_the_project() {
        let mut fields = copy_fields();
        fields.affected_roles = vec![StateDocumentRole::Working, StateDocumentRole::Working];
        let inside = path("SET/PROJECT/bank02.work");
        let outside = path("SET/OTHER/bank02.work");
        fields.expected_changes = vec![
            ExpectedChange {
                relative_path: inside.clone(),
                before: ExpectedState::Absent,
                after: expected_file(20, 'f'),
            },
            ExpectedChange {
                relative_path: inside.clone(),
                before: ExpectedState::Absent,
                after: expected_file(20, 'f'),
            },
            ExpectedChange {
                relative_path: path("SET/PROJECT/bank01.work"),
                before: expected_file(20, 'b'),
                after: expected_file(20, 'b'),
            },
            ExpectedChange {
                relative_path: outside.clone(),
                before: ExpectedState::Absent,
                after: expected_file(1, '1'),
            },
            ExpectedChange {
                relative_path: path("SET/PROJECT/markers.work"),
                before: ExpectedState::Absent,
                after: expected_file(1, '2'),
            },
        ];
        let stops = validate_envelope(&BankMutationEnvelope::seal(fields));
        assert_eq!(
            stops,
            vec![
                StopCondition::DuplicateAffectedRole,
                StopCondition::DuplicateExpectedChange {
                    relative_path: inside
                },
                StopCondition::NoOpExpectedChange {
                    relative_path: path("SET/PROJECT/bank01.work")
                },
                StopCondition::ExpectedChangeOutsideOperatedBanks {
                    relative_path: path("SET/PROJECT/bank01.work")
                },
                StopCondition::ExpectedChangeOutsideProject {
                    relative_path: outside
                },
                StopCondition::ExpectedChangeNotBankDocument {
                    relative_path: path("SET/PROJECT/markers.work")
                },
                StopCondition::ExpectedChangeBeforeMismatch {
                    relative_path: path("SET/PROJECT/markers.work")
                },
            ]
        );
    }

    #[test]
    fn bank_document_target_accepts_only_direct_bank_files() {
        let bank_a_working = Some((bank(0), StateDocumentRole::Working));
        assert_eq!(bank_document_target("bank01.work"), bank_a_working);
        assert_eq!(
            bank_document_target("bank16.strd"),
            Some((bank(15), StateDocumentRole::SavedCheckpoint))
        );
        for name in [
            "bank00.work",
            "bank17.work",
            "bank1.work",
            "bank001.work",
            "BANK01.work",
            "bank01.WORK",
            "bank01.work.bak",
            "bank01.ot",
            "bank01",
            "project.work",
            "project.strd",
            "markers.work",
            "arr01.work",
            "kick.wav",
            "AUDIO/bank01.work",
            "bank+1.work",
        ] {
            assert_eq!(bank_document_target(name), None, "{name}");
        }
    }

    #[test]
    fn bank_operations_may_only_plan_changes_to_operated_bank_documents() {
        let mut fields = copy_fields();
        fields
            .scope_manifest
            .insert(path("SET/PROJECT/AUDIO/kick.wav"), file(100, '5'));
        let change = |value: &str, before: ExpectedState| ExpectedChange {
            relative_path: path(value),
            before,
            after: expected_file(1, '1'),
        };
        fields.expected_changes = vec![
            change("SET/PROJECT/bank02.work", ExpectedState::Absent),
            change("SET/PROJECT/project.work", expected_file(10, 'a')),
            change("SET/PROJECT/markers.work", expected_file(5, 'd')),
            change("SET/PROJECT/AUDIO/kick.wav", expected_file(100, '5')),
            change("SET/PROJECT/kick.wav.ot", ExpectedState::Absent),
            change("SET/PROJECT/bank05.work", ExpectedState::Absent),
            change("SET/PROJECT/bank02.strd", ExpectedState::Absent),
            change("SET/AUDIO/kick.wav", ExpectedState::Absent),
        ];
        let stops = validate_envelope(&BankMutationEnvelope::seal(fields));
        assert_eq!(
            stops,
            vec![
                StopCondition::ExpectedChangeNotBankDocument {
                    relative_path: path("SET/PROJECT/project.work")
                },
                StopCondition::ExpectedChangeNotBankDocument {
                    relative_path: path("SET/PROJECT/markers.work")
                },
                StopCondition::ExpectedChangeNotBankDocument {
                    relative_path: path("SET/PROJECT/AUDIO/kick.wav")
                },
                StopCondition::ExpectedChangeNotBankDocument {
                    relative_path: path("SET/PROJECT/kick.wav.ot")
                },
                StopCondition::ExpectedChangeOutsideOperatedBanks {
                    relative_path: path("SET/PROJECT/bank05.work")
                },
                StopCondition::ExpectedChangeRoleNotAffected {
                    relative_path: path("SET/PROJECT/bank02.strd")
                },
                StopCondition::ExpectedChangeOutsideProject {
                    relative_path: path("SET/AUDIO/kick.wav")
                },
            ]
        );
        for stop in &stops {
            assert!(stop.code().starts_with("BMS_CHANGE_"), "{stop}");
        }
    }

    #[test]
    fn project_prefix_check_does_not_accept_a_sibling_with_the_same_prefix() {
        let mut fields = copy_fields();
        fields.expected_changes[0].relative_path = path("SET/PROJECT2/bank02.work");
        let stops = validate_envelope(&BankMutationEnvelope::seal(fields));
        assert_eq!(
            stops,
            vec![
                StopCondition::ExpectedChangeOutsideProject {
                    relative_path: path("SET/PROJECT2/bank02.work")
                },
                StopCondition::MissingOperatedBankChange {
                    relative_path: path("SET/PROJECT/bank02.work")
                },
            ]
        );
    }

    #[test]
    fn change_set_is_limited_to_operated_bank_files() {
        let mut collateral = copy_fields();
        collateral.expected_changes.push(ExpectedChange {
            relative_path: path("SET/PROJECT/markers.work"),
            before: expected_file(5, 'd'),
            after: expected_file(5, 'e'),
        });
        assert_eq!(
            validate_envelope(&BankMutationEnvelope::seal(collateral)),
            vec![StopCondition::ExpectedChangeNotBankDocument {
                relative_path: path("SET/PROJECT/markers.work"),
            }]
        );

        let mut partial_swap = copy_fields();
        partial_swap.kind = BankMutationKind::Swap;
        partial_swap
            .scope_manifest
            .insert(path("SET/PROJECT/bank02.work"), file(20, 'f'));
        partial_swap.documents.push(PlannedDocument {
            relative_path: path("SET/PROJECT/bank02.work"),
            role: StateDocumentRole::Working,
            parse_status: StateDocumentParseStatus::Parsed,
        });
        partial_swap.expected_changes = vec![ExpectedChange {
            relative_path: path("SET/PROJECT/bank02.work"),
            before: expected_file(20, 'f'),
            after: expected_file(20, 'b'),
        }];
        assert_eq!(
            validate_envelope(&BankMutationEnvelope::seal(partial_swap)),
            vec![StopCondition::MissingOperatedBankChange {
                relative_path: path("SET/PROJECT/bank01.work"),
            }]
        );
    }

    #[test]
    fn copy_change_set_may_not_touch_the_source_bank() {
        let mut fields = copy_fields();
        fields.expected_changes.push(ExpectedChange {
            relative_path: path("SET/PROJECT/bank01.work"),
            before: expected_file(20, 'b'),
            after: expected_file(20, '0'),
        });
        assert_eq!(
            validate_envelope(&BankMutationEnvelope::seal(fields)),
            vec![StopCondition::ExpectedChangeOutsideOperatedBanks {
                relative_path: path("SET/PROJECT/bank01.work"),
            }]
        );
    }

    #[test]
    fn permit_keeps_the_checked_fields_not_a_later_edit() {
        let checked = BankMutationEnvelope::seal(copy_fields());
        let live = live_for(&checked);
        let backup = backup_for(&checked);
        let permit =
            evaluate_apply_entry(checked.clone(), &live, Some(&backup), &all_resolved()).unwrap();

        let mut edited_fields = copy_fields();
        edited_fields.expected_changes[0].after = expected_file(20, '9');
        let edited = BankMutationEnvelope::seal(edited_fields);
        assert_ne!(edited.id(), checked.id());
        assert_eq!(permit.envelope(), &checked);
        assert_ne!(permit.envelope(), &edited);
        assert_eq!(permit.plan_id(), checked.id());
        assert_eq!(
            permit.envelope().expected_changes,
            checked.expected_changes,
            "the permit exposes only the fields that were evaluated"
        );

        let mut forged = checked.clone();
        forged.fields.expected_changes[0].after = expected_file(20, '9');
        assert!(!forged.validate_integrity());
        let stops =
            evaluate_apply_entry(forged, &live, Some(&backup), &all_resolved()).unwrap_err();
        assert!(stops.contains(&StopCondition::PlanIntegrityMismatch));
    }

    #[test]
    fn permit_must_be_reverified_against_a_fresh_observation() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let backup = backup_for(&envelope);
        let live = live_for(&envelope);
        let permit =
            evaluate_apply_entry(envelope.clone(), &live, Some(&backup), &all_resolved()).unwrap();
        let permit = permit
            .reverify(&live, Some(&backup), &all_resolved())
            .unwrap();
        assert_eq!(permit.envelope(), &envelope);

        let mut drifted = live.clone();
        drifted
            .scope_manifest
            .insert(path("SET/PROJECT/markers.work"), file(5, '0'));
        let stops = permit
            .reverify(&drifted, Some(&backup), &all_resolved())
            .unwrap_err();
        assert_eq!(
            stops,
            vec![StopCondition::StalePrecondition(TreeChange {
                relative_path: path("SET/PROJECT/markers.work"),
                kind: TreeChangeKind::ContentChanged,
            })]
        );

        let permit = evaluate_apply_entry(envelope, &live, Some(&backup), &all_resolved()).unwrap();
        let stops = permit
            .reverify(&live, Some(&backup), &ReadinessEvidence::current_main())
            .unwrap_err();
        assert_eq!(
            stops.len(),
            ReadinessEvidence::current_main().open_gaps().len()
        );
    }

    #[test]
    fn omitted_affected_bank_evidence_blocks_the_plan() {
        let mut fields = copy_fields();
        fields
            .documents
            .retain(|document| document.relative_path.as_str().ends_with("project.work"));
        assert_eq!(
            validate_envelope(&BankMutationEnvelope::seal(fields)),
            vec![StopCondition::MissingParserEvidence {
                relative_path: path("SET/PROJECT/bank01.work"),
            }]
        );
    }

    #[test]
    fn trusted_read_model_supplies_unmodeled_blockers() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let backup = backup_for(&envelope);
        let mut live = live_for(&envelope);
        live.project_structure.banks[0].unmodeled = BANK_UNMODELED_DEPENDENCIES.to_vec();
        let stops =
            evaluate_apply_entry(envelope, &live, Some(&backup), &all_resolved()).unwrap_err();
        assert_eq!(
            stops,
            vec![
                StopCondition::UnmodeledDependency(UnmodeledDependency::Scenes),
                StopCondition::UnmodeledDependency(UnmodeledDependency::Arrangements),
                StopCondition::UnmodeledDependency(UnmodeledDependency::RecorderSetup),
            ]
        );
    }

    #[test]
    fn trusted_read_model_rejects_an_unparsed_affected_bank() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let backup = backup_for(&envelope);
        let mut live = live_for(&envelope);
        live.project_structure.banks[0].parse_status = StateDocumentParseStatus::Malformed;
        live.project_structure.banks[0].unmodeled = BANK_UNMODELED_DEPENDENCIES.to_vec();
        let stops =
            evaluate_apply_entry(envelope, &live, Some(&backup), &all_resolved()).unwrap_err();
        assert_eq!(
            stops,
            vec![
                StopCondition::DocumentNotParsed {
                    relative_path: path("SET/PROJECT/bank01.work"),
                    parse_status: StateDocumentParseStatus::Malformed,
                },
                StopCondition::UnmodeledDependency(UnmodeledDependency::Scenes),
                StopCondition::UnmodeledDependency(UnmodeledDependency::Arrangements),
                StopCondition::UnmodeledDependency(UnmodeledDependency::RecorderSetup),
            ]
        );
    }

    #[test]
    fn unparsed_documents_unmodeled_dependencies_and_links_block_the_plan() {
        let mut fields = copy_fields();
        fields.documents[1].parse_status = StateDocumentParseStatus::Malformed;
        fields.documents.push(PlannedDocument {
            relative_path: path("SET/PROJECT/bank01.strd"),
            role: StateDocumentRole::SavedCheckpoint,
            parse_status: StateDocumentParseStatus::UnsupportedVersion,
        });
        fields.unmodeled = BANK_UNMODELED_DEPENDENCIES.to_vec();
        fields.scope_manifest.insert(
            path("SET/PROJECT/bank03.work"),
            ManifestEntry::Symlink {
                target_digest: hash('7'),
            },
        );
        fields
            .scope_manifest
            .insert(path("SET/PROJECT/fifo"), ManifestEntry::Other);
        let stops = validate_envelope(&BankMutationEnvelope::seal(fields));
        assert_eq!(
            stops,
            vec![
                StopCondition::NonRegularEntryInScope {
                    relative_path: path("SET/PROJECT/bank03.work")
                },
                StopCondition::NonRegularEntryInScope {
                    relative_path: path("SET/PROJECT/fifo")
                },
                StopCondition::DocumentNotParsed {
                    relative_path: path("SET/PROJECT/bank01.work"),
                    parse_status: StateDocumentParseStatus::Malformed,
                },
                StopCondition::DocumentNotParsed {
                    relative_path: path("SET/PROJECT/bank01.strd"),
                    parse_status: StateDocumentParseStatus::UnsupportedVersion,
                },
                StopCondition::UnmodeledDependency(UnmodeledDependency::Scenes),
                StopCondition::UnmodeledDependency(UnmodeledDependency::Arrangements),
                StopCondition::UnmodeledDependency(UnmodeledDependency::RecorderSetup),
            ]
        );
    }

    #[test]
    fn stale_live_observation_withholds_the_permit() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let mut live = live_for(&envelope);
        live.root_id = RootId::new("root-session-2").unwrap();
        live.device_fingerprint = format!("rootfp:v1:{}", "0".repeat(64));
        live.identity_is_stable = false;
        live.observed_revision = 4;
        live.read_model_schema = "masterocta.project-structure:v5".to_owned();
        live.scope_manifest
            .insert(path("SET/PROJECT/bank01.work"), file(20, '0'));
        live.scope_manifest
            .insert(path("SET/PROJECT/bank02.work"), file(20, 'f'));
        live.write_enabled = false;
        live.recovery_pending = true;
        let stops = evaluate_apply_entry(
            envelope.clone(),
            &live,
            Some(&backup_for(&envelope)),
            &all_resolved(),
        )
        .unwrap_err();
        assert_eq!(
            stops,
            vec![
                StopCondition::RootMismatch,
                StopCondition::DeviceFingerprintChanged,
                StopCondition::UnstableRootIdentity,
                StopCondition::ObservedRevisionChanged,
                StopCondition::ReadModelSchemaChanged,
                StopCondition::StalePrecondition(TreeChange {
                    relative_path: path("SET/PROJECT/bank01.work"),
                    kind: TreeChangeKind::ContentChanged,
                }),
                StopCondition::StalePrecondition(TreeChange {
                    relative_path: path("SET/PROJECT/bank02.work"),
                    kind: TreeChangeKind::Created,
                }),
                StopCondition::WriteNotEnabled,
                StopCondition::RecoveryPending,
            ]
        );
    }

    #[test]
    fn only_fixture_scope_targets_are_writable() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        for target in [
            ApplyTargetClass::UserProject,
            ApplyTargetClass::OriginalMedia,
            ApplyTargetClass::Unclassified,
        ] {
            let mut live = live_for(&envelope);
            live.target_class = target;
            let stops = evaluate_apply_entry(
                envelope.clone(),
                &live,
                Some(&backup_for(&envelope)),
                &all_resolved(),
            )
            .unwrap_err();
            assert_eq!(stops, vec![StopCondition::TargetNotFixtureScope(target)]);
        }
        let mut live = live_for(&envelope);
        live.target_class = ApplyTargetClass::TrackedFixtureCopy;
        assert!(evaluate_apply_entry(
            envelope.clone(),
            &live,
            Some(&backup_for(&envelope)),
            &all_resolved()
        )
        .is_ok());
    }

    #[test]
    fn backup_must_be_complete_local_reverified_and_cover_every_changed_file() {
        let mut fields = copy_fields();
        fields.kind = BankMutationKind::Swap;
        fields
            .scope_manifest
            .insert(path("SET/PROJECT/bank02.work"), file(20, 'f'));
        fields.documents.push(PlannedDocument {
            relative_path: path("SET/PROJECT/bank02.work"),
            role: StateDocumentRole::Working,
            parse_status: StateDocumentParseStatus::Parsed,
        });
        fields.expected_changes = vec![
            ExpectedChange {
                relative_path: path("SET/PROJECT/bank01.work"),
                before: expected_file(20, 'b'),
                after: expected_file(20, 'f'),
            },
            ExpectedChange {
                relative_path: path("SET/PROJECT/bank02.work"),
                before: expected_file(20, 'f'),
                after: expected_file(20, 'b'),
            },
        ];
        let envelope = BankMutationEnvelope::seal(fields);
        let live = live_for(&envelope);

        let stops =
            evaluate_apply_entry(envelope.clone(), &live, None, &all_resolved()).unwrap_err();
        assert_eq!(stops, vec![StopCondition::BackupMissing]);

        let mut backup = backup_for(&envelope);
        backup.plan_id = BankMutationEnvelope::seal(copy_fields()).id;
        backup.complete = false;
        backup.reverified = false;
        backup.location = BackupLocation::TargetMedia;
        backup.files[0].content_hash = hash('0');
        backup.files.pop();
        let stops = evaluate_apply_entry(envelope.clone(), &live, Some(&backup), &all_resolved())
            .unwrap_err();
        assert_eq!(
            stops,
            vec![
                StopCondition::BackupPlanMismatch,
                StopCondition::BackupIncomplete,
                StopCondition::BackupNotReverified,
                StopCondition::BackupNotLocal(BackupLocation::TargetMedia),
                StopCondition::BackupHashMismatch {
                    relative_path: path("SET/PROJECT/bank01.work")
                },
                StopCondition::BackupDoesNotCover {
                    relative_path: path("SET/PROJECT/bank02.work")
                },
            ]
        );
    }

    #[test]
    fn every_kind_of_tree_difference_counts_as_a_write() {
        let pre = pre_manifest();
        let mut post = pre.clone();
        post.insert(path("SET/PROJECT/bank01.work"), file(21, 'b'));
        post.insert(path("SET/PROJECT/markers.work"), ManifestEntry::Directory);
        post.insert(path("SET/PROJECT/new.work"), file(1, '1'));
        let mut pre_with_link = pre.clone();
        pre_with_link.insert(
            path("SET/PROJECT/link"),
            ManifestEntry::Symlink {
                target_digest: hash('1'),
            },
        );
        post.insert(
            path("SET/PROJECT/link"),
            ManifestEntry::Symlink {
                target_digest: hash('2'),
            },
        );
        let mut removed = post.clone();
        removed.entries.remove("SET/PROJECT/project.work");

        let changes = diff_manifests(&pre_with_link, &removed);
        let kinds: Vec<_> = changes
            .iter()
            .map(|change| (change.relative_path.as_str(), change.kind))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("SET/PROJECT/bank01.work", TreeChangeKind::ContentChanged),
                ("SET/PROJECT/link", TreeChangeKind::SymlinkRetargeted),
                ("SET/PROJECT/markers.work", TreeChangeKind::EntryKindChanged),
                ("SET/PROJECT/new.work", TreeChangeKind::Created),
                ("SET/PROJECT/project.work", TreeChangeKind::Removed),
            ]
        );
        assert_eq!(prove_no_write(&pre, &pre.clone()), Ok(()));
        assert!(prove_no_write(&pre_with_link, &removed).is_err());
    }

    #[test]
    fn expected_change_verification_rejects_unplanned_and_wrong_results() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let pre = envelope.scope_manifest().clone();

        let mut good = pre.clone();
        good.insert(path("SET/PROJECT/bank02.work"), file(20, 'f'));
        assert_eq!(
            verify_expected_changes(&pre, &good, &envelope.expected_changes),
            Ok(())
        );

        let mut bad = pre.clone();
        bad.insert(path("SET/PROJECT/bank02.work"), file(20, '0'));
        bad.insert(path("SET/PROJECT/markers.work"), file(5, '0'));
        assert_eq!(
            verify_expected_changes(&pre, &bad, &envelope.expected_changes),
            Err(vec![
                IntegrityViolation::PostStateMismatch {
                    relative_path: path("SET/PROJECT/bank02.work")
                },
                IntegrityViolation::UnexpectedChange(TreeChange {
                    relative_path: path("SET/PROJECT/markers.work"),
                    kind: TreeChangeKind::ContentChanged,
                }),
            ])
        );

        let mut drifted_pre = pre.clone();
        drifted_pre.insert(path("SET/PROJECT/bank02.work"), file(1, '1'));
        assert_eq!(
            verify_expected_changes(&drifted_pre, &good, &envelope.expected_changes),
            Err(vec![IntegrityViolation::PreStateMismatch {
                relative_path: path("SET/PROJECT/bank02.work")
            }])
        );
    }

    #[test]
    fn recovery_must_restore_the_whole_scope_to_pre() {
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let pre = envelope.scope_manifest().clone();
        assert_eq!(verify_recovered_to_pre(&envelope, &pre), Ok(()));

        let mut leftover = pre.clone();
        leftover.insert(path("SET/PROJECT/bank02.work"), file(20, 'f'));
        assert_eq!(
            verify_recovered_to_pre(&envelope, &leftover),
            Err(vec![TreeChange {
                relative_path: path("SET/PROJECT/bank02.work"),
                kind: TreeChangeKind::Created,
            }])
        );

        let mut collateral = pre;
        collateral.insert(path("SET/PROJECT/markers.work"), file(5, '0'));
        assert!(verify_recovered_to_pre(&envelope, &collateral).is_err());
    }

    #[test]
    fn phase_flow_cannot_skip_steps_or_cancel_mid_apply() {
        for pair in BankMutationPhase::REQUIRED_FLOW[..6].windows(2) {
            assert!(pair[0].may_transition_to(pair[1]), "{pair:?}");
        }
        use BankMutationPhase::*;
        assert!(!Plan.may_transition_to(Apply));
        assert!(!Review.may_transition_to(Prepare));
        assert!(!Backup.may_transition_to(Apply));
        assert!(!Intent.may_transition_to(Backup));
        assert!(!Apply.may_transition_to(Cancelled));
        assert!(!Apply.may_transition_to(Committed));
        assert!(!Verify.may_transition_to(Cancelled));
        assert!(!Recovery.may_transition_to(Committed));
        assert!(!RecoveryRequired.may_transition_to(Cancelled));
        assert!(Apply.may_transition_to(Verify));
        assert!(Apply.may_transition_to(Recovery));
        assert!(Verify.may_transition_to(Committed));
        assert!(Verify.may_transition_to(Recovery));
        assert!(Recovery.may_transition_to(RolledBack));
        assert!(Recovery.may_transition_to(RecoveryRequired));
        assert!(RecoveryRequired.may_transition_to(Recovery));
        for terminal in [Committed, RolledBack, Cancelled] {
            assert!(terminal.is_terminal());
            for next in BankMutationPhase::ALL {
                assert!(
                    !terminal.may_transition_to(next),
                    "{terminal:?} -> {next:?}"
                );
            }
        }
    }

    #[test]
    fn only_apply_and_recovery_may_write_and_failures_have_one_disposition() {
        use BankMutationPhase::*;
        let writers: Vec<_> = BankMutationPhase::ALL
            .into_iter()
            .filter(|phase| phase.may_write_target())
            .collect();
        assert_eq!(writers, vec![Apply, Recovery]);
        for phase in [Intent, Plan, Review, Backup, Prepare] {
            assert!(phase.target_must_equal_pre());
            assert_eq!(
                phase.on_failure(),
                FailureDisposition::CancelWithoutTargetChange
            );
        }
        for phase in [Apply, Verify] {
            assert!(!phase.target_must_equal_pre());
            assert_eq!(phase.on_failure(), FailureDisposition::RecoverToPre);
        }
        assert_eq!(
            Recovery.on_failure(),
            FailureDisposition::BlockRootUntilRecovered
        );
        assert_eq!(
            RecoveryRequired.on_failure(),
            FailureDisposition::BlockRootUntilRecovered
        );
        assert!(RolledBack.target_must_equal_pre());
        assert!(Cancelled.target_must_equal_pre());
        assert!(!Committed.target_must_equal_pre());
    }

    #[test]
    fn stop_condition_codes_are_unique() {
        let samples = [
            StopCondition::ReadinessGap(ReadinessGap::BankChangePlan),
            StopCondition::ContractSchemaMismatch,
            StopCondition::PlanIntegrityMismatch,
            StopCondition::InvalidRootFingerprint,
            StopCondition::InvalidObservedRevision,
            StopCondition::SourceEqualsDestination,
            StopCondition::NoAffectedRoles,
            StopCondition::DuplicateAffectedRole,
            StopCondition::EmptyChangeSet,
            StopCondition::DuplicateExpectedChange {
                relative_path: path(PROJECT),
            },
            StopCondition::NoOpExpectedChange {
                relative_path: path(PROJECT),
            },
            StopCondition::ExpectedChangeOutsideProject {
                relative_path: path(PROJECT),
            },
            StopCondition::MissingOperatedBankChange {
                relative_path: path(PROJECT),
            },
            StopCondition::ExpectedChangeBeforeMismatch {
                relative_path: path(PROJECT),
            },
            StopCondition::ExpectedChangeNotBankDocument {
                relative_path: path(PROJECT),
            },
            StopCondition::ExpectedChangeOutsideOperatedBanks {
                relative_path: path(PROJECT),
            },
            StopCondition::ExpectedChangeRoleNotAffected {
                relative_path: path(PROJECT),
            },
            StopCondition::NonRegularEntryInScope {
                relative_path: path(PROJECT),
            },
            StopCondition::DocumentNotParsed {
                relative_path: path(PROJECT),
                parse_status: StateDocumentParseStatus::Malformed,
            },
            StopCondition::MissingParserEvidence {
                relative_path: path(PROJECT),
            },
            StopCondition::UnmodeledDependency(UnmodeledDependency::Scenes),
            StopCondition::RootMismatch,
            StopCondition::DeviceFingerprintChanged,
            StopCondition::UnstableRootIdentity,
            StopCondition::ObservedRevisionChanged,
            StopCondition::ReadModelSchemaChanged,
            StopCondition::StalePrecondition(TreeChange {
                relative_path: path(PROJECT),
                kind: TreeChangeKind::Created,
            }),
            StopCondition::WriteNotEnabled,
            StopCondition::RecoveryPending,
            StopCondition::TargetNotFixtureScope(ApplyTargetClass::OriginalMedia),
            StopCondition::BackupMissing,
            StopCondition::BackupPlanMismatch,
            StopCondition::BackupIncomplete,
            StopCondition::BackupNotReverified,
            StopCondition::BackupNotLocal(BackupLocation::Unknown),
            StopCondition::BackupDoesNotCover {
                relative_path: path(PROJECT),
            },
            StopCondition::BackupHashMismatch {
                relative_path: path(PROJECT),
            },
        ];
        let codes: BTreeSet<_> = samples.iter().map(StopCondition::code).collect();
        assert_eq!(codes.len(), samples.len());
        assert!(codes.iter().all(|code| code.starts_with("BMS_")));
    }

    fn bank_entry(index: u8, role: StateDocumentRole, part: u8) -> BankStructure {
        let extension = match role {
            StateDocumentRole::Working => "work",
            StateDocumentRole::SavedCheckpoint => "strd",
        };
        BankStructure {
            bank: bank(index),
            role,
            source_relative_path: path(&format!("SET/PROJECT/bank{:02}.{extension}", index + 1)),
            parse_status: StateDocumentParseStatus::Parsed,
            patterns: vec![PatternStructure {
                index: PatternIndex::new(0).unwrap(),
                part: PartIndex::new(part).unwrap(),
                scale: PatternScale::Normal {
                    master_length: 16,
                    master_scale: PatternPlaybackScale::Times1,
                },
            }],
            parts: Vec::new(),
            unmodeled: BANK_UNMODELED_DEPENDENCIES.to_vec(),
        }
    }

    fn structure(banks: Vec<BankStructure>) -> ProjectStructure {
        ProjectStructure {
            project_relative_path: path(PROJECT),
            project_state: None,
            banks,
        }
    }

    #[test]
    fn copy_structure_check_compares_content_not_file_names() {
        use StateDocumentRole::*;
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let pre = structure(vec![
            bank_entry(0, Working, 1),
            bank_entry(0, SavedCheckpoint, 2),
            bank_entry(5, Working, 3),
        ]);
        let mut post_banks = pre.banks.clone();
        post_banks.push(bank_entry(1, Working, 1));
        let post = structure(post_banks);
        assert_eq!(verify_bank_structure(&envelope, &pre, &post), Ok(()));

        let mut wrong = post.clone();
        wrong.banks.retain(|entry| entry.bank != bank(1));
        wrong.banks.push(bank_entry(1, Working, 2));
        wrong.banks.retain(|entry| entry.bank != bank(5));
        wrong.banks.push(bank_entry(5, Working, 0));
        wrong.banks.push(bank_entry(1, SavedCheckpoint, 2));
        assert_eq!(
            verify_bank_structure(&envelope, &pre, &wrong),
            Err(vec![
                StructureViolation::UnaffectedBankChanged {
                    bank: bank(5),
                    role: Working
                },
                StructureViolation::BankContentMismatch {
                    bank: bank(1),
                    role: Working
                },
                StructureViolation::UnaffectedRoleChanged {
                    bank: bank(1),
                    role: SavedCheckpoint
                },
            ])
        );
    }

    #[test]
    fn swap_structure_check_requires_both_directions() {
        use StateDocumentRole::*;
        let mut fields = copy_fields();
        fields.kind = BankMutationKind::Swap;
        let envelope = BankMutationEnvelope::seal(fields);
        let pre = structure(vec![bank_entry(0, Working, 1), bank_entry(1, Working, 2)]);
        let swapped = structure(vec![bank_entry(0, Working, 2), bank_entry(1, Working, 1)]);
        assert_eq!(verify_bank_structure(&envelope, &pre, &swapped), Ok(()));

        let half = structure(vec![bank_entry(0, Working, 1), bank_entry(1, Working, 1)]);
        assert_eq!(
            verify_bank_structure(&envelope, &pre, &half),
            Err(vec![StructureViolation::BankContentMismatch {
                bank: bank(0),
                role: Working
            }])
        );
    }

    #[test]
    fn move_structure_check_stays_closed_until_the_vacated_state_is_decided() {
        use StateDocumentRole::*;
        let mut fields = copy_fields();
        fields.kind = BankMutationKind::Move;
        let envelope = BankMutationEnvelope::seal(fields);
        let pre = structure(vec![bank_entry(0, Working, 1)]);
        let post = structure(vec![bank_entry(1, Working, 1)]);
        assert_eq!(
            verify_bank_structure(&envelope, &pre, &post),
            Err(vec![StructureViolation::MoveVacatedSourceUndefined])
        );
    }

    #[test]
    fn structure_check_rejects_unparsed_banks_and_project_state_drift() {
        use StateDocumentRole::*;
        let envelope = BankMutationEnvelope::seal(copy_fields());
        let mut malformed = bank_entry(0, Working, 1);
        malformed.parse_status = StateDocumentParseStatus::Malformed;
        malformed.patterns.clear();
        let pre = structure(vec![malformed.clone()]);
        let mut post = structure(vec![malformed.clone(), {
            let mut copy = malformed;
            copy.bank = bank(1);
            copy
        }]);
        post.project_state = Some(ot_domain::project_structure::ProjectStateDocument {
            role: Working,
            source_relative_path: path("SET/PROJECT/project.work"),
            parse_status: StateDocumentParseStatus::Parsed,
            bank: None,
            pattern: None,
            arrangement: None,
            master_track: None,
        });
        let violations = verify_bank_structure(&envelope, &pre, &post).unwrap_err();
        assert_eq!(violations[0], StructureViolation::ProjectStateChanged);
        assert!(
            violations.contains(&StructureViolation::AffectedBankNotParsed {
                bank: bank(0),
                role: Working,
                side: ObservationSide::Pre
            })
        );
        assert!(
            violations.contains(&StructureViolation::BankContentMismatch {
                bank: bank(1),
                role: Working
            })
        );
    }
}
