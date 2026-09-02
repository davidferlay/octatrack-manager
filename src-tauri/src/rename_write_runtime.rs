use crate::clone_runtime::{CloneRuntime, RegistryCloneWriteAuthority};
use crate::root_registry::{RootRegistry, RootRegistryError};
use ot_backup::{BackupError, BackupStore, SnapshotId, VerifiedRenameBackup};
use ot_codec::MemoryProjectReferenceCodec;
use ot_domain::RootId;
use ot_executor::RecoveryAuthority;
use ot_executor::{
    ApprovedExecutionRoot, ApprovedRecoveryRoot, AuthorityError, ExecutorError, ExecutorLocalPaths,
    OperationId, RenameJournalStatus, RenamePrepareResult, RenameSampleExecutor, WriteAuthority,
};
use ot_plan::{PlanId, RenameImpactPlan};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_PLAN_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SESSION_PLANS: usize = 64;
const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const WRITE_STATE_DIRECTORY: &str = "write-state";

pub type SharedRenameWriteRuntime = Arc<RenameWriteRuntime>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenameOperationPhase {
    Planned,
    Authorized,
    BackupVerified,
    Prepared,
}

#[derive(Clone, Debug)]
pub struct RenameAuthorityRecord {
    pub authority_id: String,
    pub plan_id: PlanId,
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub base_observed_revision: u64,
    pub operation_id: OperationId,
    pub expires_at: Instant,
}

#[derive(Clone, Debug)]
pub struct RenameBackupRecord {
    pub snapshot_id: SnapshotId,
    pub file_count: u64,
    pub total_bytes: u64,
}

pub struct RenameApplyRecord {
    pub operation_id: OperationId,
    pub snapshot_id: SnapshotId,
    pub journal_status: RenameJournalStatus,
}

#[derive(Clone, Debug)]
pub struct RenamePrepareRecord {
    pub operation_id: OperationId,
    pub snapshot_id: SnapshotId,
    pub staged_file_count: u64,
    pub total_staged_bytes: u64,
    pub project_rewrite_count: u64,
    pub journal_status: RenameJournalStatus,
}

#[derive(Clone, Debug)]
pub struct RenameSessionStatus {
    pub operation_id: OperationId,
    pub plan_id: PlanId,
    pub phase: RenameOperationPhase,
    pub backup_snapshot_id: Option<String>,
    pub journal_status: Option<RenameJournalStatus>,
    pub failure_code: Option<String>,
    pub plan_available: bool,
}

#[derive(Clone, Debug)]
struct StoredRenamePlan {
    plan: RenameImpactPlan,
    expires_at: Instant,
    phase: RenameOperationPhase,
    authority: Option<RenameAuthorityRecord>,
    backup: Option<RenameBackupRecord>,
    prepare: Option<RenamePrepareRecord>,
}

#[derive(Default)]
struct RenameWriteState {
    plans: HashMap<String, StoredRenamePlan>,
}

pub struct RenameWriteRuntime {
    executor: RenameSampleExecutor,
    local_paths: ExecutorLocalPaths,
    state: Mutex<RenameWriteState>,
    plan_ttl: Duration,
}

#[derive(Debug)]
pub enum RenameWriteRuntimeError {
    InvalidPlan,
    InvalidPlanId,
    InvalidAuthorityId,
    InvalidSnapshotId,
    PlanNotFound,
    PlanLimitReached,
    PlanIntegrityMismatch,
    AuthorityNotFound,
    AuthorityMismatch,
    AuthorityExpired,
    SnapshotMismatch,
    InvalidTransition,
    ApprovalMismatch,
    #[allow(dead_code)] // returned once explicit continuation apply lands in R2
    ContinuationRequired,
    #[allow(dead_code)] // returned once explicit continuation apply lands in R2
    ContinuationMismatch,
    RecoveryRequired,
    RecoveryApprovalRequired,
    Unavailable,
    Backup(BackupError),
    Executor(ExecutorError),
}

impl RenameWriteRuntime {
    pub fn new(local_paths: ExecutorLocalPaths, plan_ttl: Duration) -> Self {
        Self {
            executor: RenameSampleExecutor::new(local_paths.clone()),
            local_paths,
            state: Mutex::new(RenameWriteState::default()),
            plan_ttl,
        }
    }

    pub fn store_plan(&self, plan: RenameImpactPlan) -> Result<(), RenameWriteRuntimeError> {
        plan.validate_integrity()
            .map_err(|_| RenameWriteRuntimeError::InvalidPlan)?;
        let key = plan.id.as_str().to_owned();
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);

        if let Some(existing) = state.plans.get(&key) {
            if existing.plan == plan {
                let stored = state.plans.get_mut(&key).expect("plan key exists");
                stored.expires_at = now + self.plan_ttl;
                stored.phase = RenameOperationPhase::Planned;
                stored.authority = None;
                stored.backup = None;
                stored.prepare = None;
                return Ok(());
            }
            return Err(RenameWriteRuntimeError::PlanIntegrityMismatch);
        }

        if state.plans.len() >= MAX_SESSION_PLANS {
            return Err(RenameWriteRuntimeError::PlanLimitReached);
        }

        state.plans.insert(
            key,
            StoredRenamePlan {
                plan,
                expires_at: now + self.plan_ttl,
                phase: RenameOperationPhase::Planned,
                authority: None,
                backup: None,
                prepare: None,
            },
        );
        Ok(())
    }

    pub fn get_plan(
        &self,
        root_id: &RootId,
        plan_id: &str,
    ) -> Result<RenameImpactPlan, RenameWriteRuntimeError> {
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        Ok(stored.plan.clone())
    }

    pub fn authorize(
        &self,
        root_id: &RootId,
        plan_id: &str,
    ) -> Result<RenameAuthorityRecord, RenameWriteRuntimeError> {
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get_mut(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        self.ensure_recovery_clear(&stored.plan.device_fingerprint)?;
        if let Some(authority) = stored.authority.as_ref() {
            if authority.expires_at > now {
                return Ok(authority.clone());
            }
        }
        let authority = build_authority_record(&stored.plan, now + self.plan_ttl);
        stored.phase = RenameOperationPhase::Authorized;
        stored.authority = Some(authority.clone());
        Ok(authority)
    }

    pub fn verify_authority(
        &self,
        root_id: &RootId,
        plan_id: &str,
        authority_id: &str,
    ) -> Result<RenameAuthorityRecord, RenameWriteRuntimeError> {
        let authority = self.lookup_authority(root_id, plan_id, authority_id)?;
        if authority.expires_at <= Instant::now() {
            return Err(RenameWriteRuntimeError::AuthorityExpired);
        }
        Ok(authority)
    }

    pub fn create_backup(
        &self,
        root_id: &RootId,
        plan_id: &str,
        authority_id: &str,
        source_root: &Path,
    ) -> Result<RenameBackupRecord, RenameWriteRuntimeError> {
        self.verify_authority(root_id, plan_id, authority_id)?;
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get_mut(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        if let Some(backup) = stored.backup.as_ref() {
            let verified = self.verify_existing_backup(&stored.plan, backup)?;
            stored.phase = RenameOperationPhase::BackupVerified;
            return Ok(verified);
        }

        let backup_store = BackupStore::new(self.local_paths.backup_directory.clone());
        let verified = match backup_store.create_verified_for_rename(source_root, &stored.plan) {
            Ok(backup) => backup,
            Err(BackupError::SnapshotExists) => backup_store
                .verify_for_rename_plan(&stored.plan)
                .map_err(RenameWriteRuntimeError::Backup)?,
            Err(error) => return Err(RenameWriteRuntimeError::Backup(error)),
        };
        backup_store
            .verify_for_rename_plan(&stored.plan)
            .map_err(RenameWriteRuntimeError::Backup)?;
        let record = backup_record_from_verified(&verified);
        stored.phase = RenameOperationPhase::BackupVerified;
        stored.backup = Some(record.clone());
        Ok(record)
    }

    pub fn prepare(
        &self,
        root_id: &RootId,
        plan_id: &str,
        authority_id: &str,
        snapshot_id: &str,
        registry: &RootRegistry,
    ) -> Result<RenamePrepareRecord, RenameWriteRuntimeError> {
        self.verify_authority(root_id, plan_id, authority_id)?;
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let expected_snapshot = SnapshotId::parse(snapshot_id.to_owned())
            .map_err(|_| RenameWriteRuntimeError::InvalidSnapshotId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get_mut(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        let backup = stored
            .backup
            .as_ref()
            .ok_or(RenameWriteRuntimeError::InvalidTransition)?;
        if backup.snapshot_id != expected_snapshot {
            return Err(RenameWriteRuntimeError::SnapshotMismatch);
        }
        if let Some(prepared) = stored.prepare.as_ref() {
            if prepared.snapshot_id == expected_snapshot
                && prepared.journal_status == RenameJournalStatus::Prepared
            {
                return Ok(prepared.clone());
            }
        }

        let plan = stored.plan.clone();
        drop(state);

        let authority = RegistryWriteAuthority { registry };
        let operation_id = OperationId::for_rename_plan(&plan);
        let prepared = match self
            .executor
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority)
        {
            Ok(result) => prepare_record_from_result(&result),
            Err(ExecutorError::PlanConsumed) => {
                self.reload_prepared_record(&plan, &operation_id)?
            }
            Err(error) => return Err(RenameWriteRuntimeError::Executor(error)),
        };
        if prepared.snapshot_id != expected_snapshot {
            return Err(RenameWriteRuntimeError::SnapshotMismatch);
        }

        let mut state = self.lock_state()?;
        let stored = state
            .plans
            .get_mut(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        stored.phase = RenameOperationPhase::Prepared;
        stored.prepare = Some(prepared.clone());
        Ok(prepared)
    }

    pub fn apply(
        &self,
        root_id: &RootId,
        plan_id: &str,
        approved_plan_id: &str,
        authority_id: &str,
        snapshot_id: &str,
        clone_authority_id: &str,
        registry: &RootRegistry,
        clone_runtime: &CloneRuntime,
    ) -> Result<RenameApplyRecord, RenameWriteRuntimeError> {
        if approved_plan_id != plan_id {
            return Err(RenameWriteRuntimeError::ApprovalMismatch);
        }
        self.verify_authority(root_id, plan_id, authority_id)?;
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let expected_snapshot = SnapshotId::parse(snapshot_id.to_owned())
            .map_err(|_| RenameWriteRuntimeError::InvalidSnapshotId)?;
        let plan = self.get_plan(root_id, plan_id.as_str())?;
        if &plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }

        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if stored.phase != RenameOperationPhase::Prepared {
            return Err(RenameWriteRuntimeError::InvalidTransition);
        }
        let prepare = stored
            .prepare
            .as_ref()
            .ok_or(RenameWriteRuntimeError::InvalidTransition)?;
        if prepare.snapshot_id != expected_snapshot {
            return Err(RenameWriteRuntimeError::SnapshotMismatch);
        }
        if prepare.journal_status != RenameJournalStatus::Prepared {
            return Err(RenameWriteRuntimeError::InvalidTransition);
        }
        drop(state);

        let clone_authority = RegistryCloneWriteAuthority::new(
            registry,
            clone_runtime,
            clone_authority_id.to_owned(),
            root_id.clone(),
        );
        let apply_result = self
            .executor
            .apply(&plan, &MemoryProjectReferenceCodec, &clone_authority)
            .map_err(RenameWriteRuntimeError::Executor)?;

        if apply_result.journal.status == RenameJournalStatus::Committed {
            let mut state = self.lock_state()?;
            state.plans.remove(plan_id.as_str());
        }

        Ok(RenameApplyRecord {
            operation_id: apply_result.operation_id,
            snapshot_id: expected_snapshot,
            journal_status: apply_result.journal.status,
        })
    }

    pub fn recover(
        &self,
        root_id: &RootId,
        operation_id: &str,
        approved_operation_id: &str,
        registry: &RootRegistry,
    ) -> Result<RenameSessionStatus, RenameWriteRuntimeError> {
        let operation_id = OperationId::parse(operation_id)
            .map_err(|_| RenameWriteRuntimeError::Executor(ExecutorError::InvalidOperationId))?;
        let approved_operation_id = OperationId::parse(approved_operation_id)
            .map_err(|_| RenameWriteRuntimeError::RecoveryApprovalRequired)?;
        if operation_id != approved_operation_id {
            return Err(RenameWriteRuntimeError::RecoveryApprovalRequired);
        }
        let journal = self
            .executor
            .rename_journal(&operation_id)
            .map_err(RenameWriteRuntimeError::Executor)?
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if !matches!(
            journal.status,
            RenameJournalStatus::Applying | RenameJournalStatus::RecoveryRequired
        ) {
            return Err(RenameWriteRuntimeError::InvalidTransition);
        }
        let authority = RegistryRenameRecoveryAuthority { registry };
        let journal = self
            .executor
            .rollback(root_id, &operation_id, &authority)
            .map_err(RenameWriteRuntimeError::Executor)?;
        let plan_id = PlanId::parse(journal.plan_id.clone())
            .map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        Ok(RenameSessionStatus {
            operation_id,
            plan_id,
            phase: phase_from_journal_status(journal.status),
            backup_snapshot_id: Some(journal.backup_snapshot_id),
            journal_status: Some(journal.status),
            failure_code: journal.failure_code,
            plan_available: false,
        })
    }

    pub fn session_status_for_operation(
        &self,
        root_id: &RootId,
        operation_id: &str,
        root_fingerprint: &str,
    ) -> Result<RenameSessionStatus, RenameWriteRuntimeError> {
        let operation_id = OperationId::parse(operation_id)
            .map_err(|_| RenameWriteRuntimeError::Executor(ExecutorError::InvalidOperationId))?;
        let plan_id = PlanId::parse(
            operation_id
                .as_str()
                .replacen("operation:v1:", "plan:v1:", 1),
        )
        .map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;

        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        if let Some(stored) = state.plans.get(plan_id.as_str()) {
            if stored.plan.root_id == *root_id
                && OperationId::for_rename_plan(&stored.plan) == operation_id
            {
                return Ok(session_status_from_stored(stored, true));
            }
        }
        drop(state);

        let journal = self
            .executor
            .rename_journal(&operation_id)
            .map_err(RenameWriteRuntimeError::Executor)?
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if journal.root_fingerprint != root_fingerprint {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        Ok(RenameSessionStatus {
            operation_id,
            plan_id,
            phase: phase_from_journal_status(journal.status),
            backup_snapshot_id: Some(journal.backup_snapshot_id),
            journal_status: Some(journal.status),
            failure_code: journal.failure_code,
            plan_available: false,
        })
    }

    pub fn incomplete_operations(
        &self,
        root_fingerprint: &str,
    ) -> Result<Vec<RenameSessionStatus>, RenameWriteRuntimeError> {
        self.executor
            .incomplete_rename_journals_for_root(root_fingerprint)
            .map_err(RenameWriteRuntimeError::Executor)?
            .into_iter()
            .map(|journal| {
                let operation_id =
                    OperationId::parse(journal.operation_id.clone()).map_err(|_| {
                        RenameWriteRuntimeError::Executor(ExecutorError::InvalidOperationId)
                    })?;
                let plan_id = PlanId::parse(journal.plan_id.clone())
                    .map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
                Ok(RenameSessionStatus {
                    operation_id,
                    plan_id,
                    phase: phase_from_journal_status(journal.status),
                    backup_snapshot_id: Some(journal.backup_snapshot_id),
                    journal_status: Some(journal.status),
                    failure_code: journal.failure_code,
                    plan_available: false,
                })
            })
            .collect()
    }

    fn ensure_recovery_clear(&self, root_fingerprint: &str) -> Result<(), RenameWriteRuntimeError> {
        let incomplete = self.incomplete_operations(root_fingerprint)?;
        if incomplete.iter().any(|status| {
            status.journal_status.is_some_and(|journal_status| {
                matches!(
                    journal_status,
                    RenameJournalStatus::Applying | RenameJournalStatus::RecoveryRequired
                )
            })
        }) {
            return Err(RenameWriteRuntimeError::RecoveryRequired);
        }
        Ok(())
    }

    fn lookup_authority(
        &self,
        root_id: &RootId,
        plan_id: &str,
        authority_id: &str,
    ) -> Result<RenameAuthorityRecord, RenameWriteRuntimeError> {
        if !authority_id.starts_with("rename-auth:v1:") {
            return Err(RenameWriteRuntimeError::InvalidAuthorityId);
        }
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        let authority = stored
            .authority
            .as_ref()
            .ok_or(RenameWriteRuntimeError::AuthorityNotFound)?;
        if authority.authority_id != authority_id {
            return Err(RenameWriteRuntimeError::AuthorityMismatch);
        }
        if authority.plan_id != stored.plan.id
            || authority.root_id != stored.plan.root_id
            || authority.device_fingerprint != stored.plan.device_fingerprint
            || authority.base_observed_revision != stored.plan.base_observed_revision
        {
            return Err(RenameWriteRuntimeError::AuthorityMismatch);
        }
        Ok(authority.clone())
    }

    fn verify_existing_backup(
        &self,
        plan: &RenameImpactPlan,
        backup: &RenameBackupRecord,
    ) -> Result<RenameBackupRecord, RenameWriteRuntimeError> {
        let backup_store = BackupStore::new(self.local_paths.backup_directory.clone());
        let verified = backup_store
            .verify_for_rename_plan(plan)
            .map_err(RenameWriteRuntimeError::Backup)?;
        if verified.snapshot_id() != &backup.snapshot_id {
            return Err(RenameWriteRuntimeError::SnapshotMismatch);
        }
        Ok(backup_record_from_verified(&verified))
    }

    fn reload_prepared_record(
        &self,
        plan: &RenameImpactPlan,
        operation_id: &OperationId,
    ) -> Result<RenamePrepareRecord, RenameWriteRuntimeError> {
        let journal = self
            .executor
            .rename_journal(operation_id)
            .map_err(RenameWriteRuntimeError::Executor)?
            .ok_or(RenameWriteRuntimeError::Executor(
                ExecutorError::PlanConsumed,
            ))?;
        if journal.plan_id != plan.id.as_str()
            || journal.status != RenameJournalStatus::Prepared
            || journal.root_fingerprint != plan.device_fingerprint
            || journal.base_observed_revision != plan.base_observed_revision
        {
            return Err(RenameWriteRuntimeError::Executor(
                ExecutorError::PlanConsumed,
            ));
        }
        let backup_store = BackupStore::new(self.local_paths.backup_directory.clone());
        let verified = backup_store
            .verify_for_rename_plan(plan)
            .map_err(RenameWriteRuntimeError::Backup)?;
        Ok(RenamePrepareRecord {
            operation_id: operation_id.clone(),
            snapshot_id: verified.snapshot_id().clone(),
            staged_file_count: journal.staged_files.len() as u64,
            total_staged_bytes: journal
                .staged_files
                .iter()
                .try_fold(0u64, |total, file| total.checked_add(file.byte_size))
                .unwrap_or(0),
            project_rewrite_count: journal.project_rewrites.len() as u64,
            journal_status: journal.status,
        })
    }

    fn lock_state(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, RenameWriteState>, RenameWriteRuntimeError> {
        self.state
            .lock()
            .map_err(|_| RenameWriteRuntimeError::Unavailable)
    }
}

struct RegistryWriteAuthority<'a> {
    registry: &'a RootRegistry,
}

impl WriteAuthority for RegistryWriteAuthority<'_> {
    fn resolve_for_write(&self, root_id: &RootId) -> Result<ApprovedExecutionRoot, AuthorityError> {
        let resolved = self
            .registry
            .resolve(root_id)
            .map_err(map_authority_error)?;
        Ok(ApprovedExecutionRoot {
            root_id: resolved.session.root_id,
            device_fingerprint: resolved.session.device_fingerprint,
            observed_revision: resolved.session.observed_revision,
            canonical_path: resolved.canonical_path,
            write_enabled: resolved.session.capabilities.write,
            stable_device_identity: resolved.session.capabilities.stable_device_identity,
        })
    }
}

struct RegistryRenameRecoveryAuthority<'a> {
    registry: &'a RootRegistry,
}

impl RecoveryAuthority for RegistryRenameRecoveryAuthority<'_> {
    fn resolve_for_recovery(
        &self,
        root_id: &RootId,
    ) -> Result<ApprovedRecoveryRoot, AuthorityError> {
        let resolved = self
            .registry
            .resolve(root_id)
            .map_err(map_authority_error)?;
        Ok(ApprovedRecoveryRoot {
            root_id: resolved.session.root_id,
            device_fingerprint: resolved.session.device_fingerprint,
            canonical_path: resolved.canonical_path,
            stable_device_identity: resolved.session.capabilities.stable_device_identity,
        })
    }
}

fn map_authority_error(error: RootRegistryError) -> AuthorityError {
    match error {
        RootRegistryError::NotApproved => AuthorityError::NotApproved,
        RootRegistryError::Expired => AuthorityError::Expired,
        RootRegistryError::Removed => AuthorityError::Removed,
        RootRegistryError::Changed => AuthorityError::Changed,
        RootRegistryError::UnstableIdentity => AuthorityError::UnstableIdentity,
        other => AuthorityError::Unavailable(other.code().into()),
    }
}

impl RenameWriteRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPlan | Self::InvalidPlanId | Self::PlanIntegrityMismatch => "INVALID_PLAN",
            Self::PlanNotFound => "PLAN_NOT_FOUND",
            Self::PlanLimitReached => "PLAN_LIMIT_REACHED",
            Self::InvalidAuthorityId => "INVALID_AUTHORITY_ID",
            Self::AuthorityNotFound => "AUTHORITY_NOT_FOUND",
            Self::AuthorityMismatch => "AUTHORITY_MISMATCH",
            Self::AuthorityExpired => "AUTHORITY_EXPIRED",
            Self::InvalidSnapshotId => "INVALID_SNAPSHOT_ID",
            Self::SnapshotMismatch => "SNAPSHOT_MISMATCH",
            Self::InvalidTransition => "INVALID_TRANSITION",
            Self::ApprovalMismatch => "APPROVAL_MISMATCH",
            Self::ContinuationRequired => "CONTINUATION_REQUIRED",
            Self::ContinuationMismatch => "CONTINUATION_MISMATCH",
            Self::RecoveryRequired => "RECOVERY_REQUIRED",
            Self::RecoveryApprovalRequired => "RECOVERY_APPROVAL_REQUIRED",
            Self::Unavailable => "RENAME_RUNTIME_UNAVAILABLE",
            Self::Backup(error) => backup_error_code(error),
            Self::Executor(error) => error.code(),
        }
    }
}

fn backup_error_code(error: &BackupError) -> &'static str {
    match error {
        BackupError::SourceChanged => "PLAN_STALE",
        BackupError::SnapshotExists => "SNAPSHOT_EXISTS",
        BackupError::PlanBindingMismatch => "SNAPSHOT_MISMATCH",
        BackupError::SymlinkEncountered(_) | BackupError::UnsafePath | BackupError::PathEscape => {
            "UNSAFE_PATH"
        }
        _ => "BACKUP_FAILED",
    }
}

impl std::fmt::Display for RenameWriteRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPlan => "rename plan failed integrity validation",
            Self::InvalidPlanId => "plan ID is not a versioned identifier",
            Self::InvalidAuthorityId => "authority ID is not a versioned identifier",
            Self::PlanNotFound => "rename plan is not available in this session",
            Self::PlanLimitReached => "too many rename plans are retained in this session",
            Self::PlanIntegrityMismatch => {
                "a different rename plan already occupies this plan identifier"
            }
            Self::AuthorityNotFound => "rename authority has not been issued for this plan",
            Self::AuthorityMismatch => "rename authority does not match this plan",
            Self::AuthorityExpired => "rename authority has expired",
            Self::InvalidSnapshotId => "snapshot ID is not a versioned identifier",
            Self::SnapshotMismatch => "verified backup does not match this plan",
            Self::InvalidTransition => "rename operation is not ready for this step",
            Self::ApprovalMismatch => "approved plan ID does not match the requested plan",
            Self::ContinuationRequired => {
                "process restart requires an explicit continuation authority before apply"
            }
            Self::ContinuationMismatch => "continuation authority does not match this session",
            Self::RecoveryRequired => "an incomplete rename operation must be resolved first",
            Self::RecoveryApprovalRequired => {
                "approved operation ID does not match the requested recovery"
            }
            Self::Unavailable => "rename operation runtime is unavailable",
            Self::Backup(error) => return write!(formatter, "{error}"),
            Self::Executor(error) => return write!(formatter, "{error}"),
        })
    }
}

impl std::error::Error for RenameWriteRuntimeError {}

pub fn open_shared_rename_write_runtime(
    data_directory: &Path,
) -> Result<SharedRenameWriteRuntime, RenameWriteRuntimeError> {
    fs::create_dir_all(data_directory)
        .map_err(|error| RenameWriteRuntimeError::Executor(ExecutorError::Io(error.to_string())))?;
    let data_directory = canonical_runtime_directory(data_directory)?;
    let product_directory = data_directory.join(PRODUCT_DIRECTORY);
    ensure_real_directory(&data_directory, &product_directory)?;
    let product_directory = canonical_runtime_directory(&product_directory)?;
    let write_directory = product_directory.join(WRITE_STATE_DIRECTORY);
    ensure_real_directory(&product_directory, &write_directory)?;
    let write_directory = canonical_runtime_directory(&write_directory)?;
    Ok(Arc::new(RenameWriteRuntime::new(
        ExecutorLocalPaths {
            staging_directory: write_directory.join("staging"),
            backup_directory: write_directory.join("backups"),
            journal_directory: write_directory.join("journals"),
        },
        DEFAULT_PLAN_TTL,
    )))
}

fn ensure_real_directory(parent: &Path, directory: &Path) -> Result<(), RenameWriteRuntimeError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(RenameWriteRuntimeError::Unavailable)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(directory).map_err(|error| {
                RenameWriteRuntimeError::Executor(ExecutorError::Io(error.to_string()))
            })?;
            Ok(())
        }
        Err(error) => Err(RenameWriteRuntimeError::Executor(ExecutorError::Io(
            error.to_string(),
        ))),
    }
    .and_then(|_| {
        let canonical = canonical_runtime_directory(directory)?;
        if !canonical.starts_with(parent) {
            return Err(RenameWriteRuntimeError::Unavailable);
        }
        Ok(())
    })
}

fn canonical_runtime_directory(path: &Path) -> Result<PathBuf, RenameWriteRuntimeError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| RenameWriteRuntimeError::Executor(ExecutorError::Io(error.to_string())))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(RenameWriteRuntimeError::Unavailable);
    }
    path.canonicalize()
        .map_err(|error| RenameWriteRuntimeError::Executor(ExecutorError::Io(error.to_string())))
}

fn remove_expired_plans(state: &mut RenameWriteState, now: Instant) {
    state.plans.retain(|_, stored| {
        stored.expires_at > now
            || !matches!(stored.phase, RenameOperationPhase::Planned)
            || stored.authority.is_some()
            || stored.backup.is_some()
            || stored.prepare.is_some()
    });
}

fn build_authority_record(plan: &RenameImpactPlan, expires_at: Instant) -> RenameAuthorityRecord {
    RenameAuthorityRecord {
        authority_id: derive_rename_authority_id(plan),
        plan_id: plan.id.clone(),
        root_id: plan.root_id.clone(),
        device_fingerprint: plan.device_fingerprint.clone(),
        base_observed_revision: plan.base_observed_revision,
        operation_id: OperationId::for_rename_plan(plan),
        expires_at,
    }
}

fn derive_rename_authority_id(plan: &RenameImpactPlan) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"rename-auth:v1");
    hasher.update(plan.id.as_str().as_bytes());
    hasher.update(plan.root_id.as_str().as_bytes());
    hasher.update(plan.device_fingerprint.as_bytes());
    hasher.update(plan.base_observed_revision.to_be_bytes());
    let digest = hasher.finalize();
    format!(
        "rename-auth:v1:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn backup_record_from_verified(backup: &VerifiedRenameBackup) -> RenameBackupRecord {
    let file_count = backup.manifest().files.len() as u64;
    let total_bytes = backup
        .manifest()
        .files
        .iter()
        .try_fold(0u64, |total, file| total.checked_add(file.byte_size))
        .unwrap_or(0);
    RenameBackupRecord {
        snapshot_id: backup.snapshot_id().clone(),
        file_count,
        total_bytes,
    }
}

fn prepare_record_from_result(result: &RenamePrepareResult) -> RenamePrepareRecord {
    RenamePrepareRecord {
        operation_id: result.operation_id.clone(),
        snapshot_id: result.backup.snapshot_id().clone(),
        staged_file_count: result.semantic_diff.staged_files.len() as u64,
        total_staged_bytes: result.semantic_diff.total_staged_bytes,
        project_rewrite_count: result.semantic_diff.project_rewrites.len() as u64,
        journal_status: result.journal.status,
    }
}

fn session_status_from_stored(
    stored: &StoredRenamePlan,
    plan_available: bool,
) -> RenameSessionStatus {
    RenameSessionStatus {
        operation_id: OperationId::for_rename_plan(&stored.plan),
        plan_id: stored.plan.id.clone(),
        phase: stored.phase,
        backup_snapshot_id: stored
            .backup
            .as_ref()
            .map(|backup| backup.snapshot_id.as_str().to_owned()),
        journal_status: stored
            .prepare
            .as_ref()
            .map(|prepare| prepare.journal_status),
        failure_code: None,
        plan_available,
    }
}

fn phase_from_journal_status(status: RenameJournalStatus) -> RenameOperationPhase {
    match status {
        RenameJournalStatus::Prepared => RenameOperationPhase::Prepared,
        RenameJournalStatus::Applying | RenameJournalStatus::RecoveryRequired => {
            RenameOperationPhase::Prepared
        }
        RenameJournalStatus::Committed | RenameJournalStatus::RolledBack => {
            RenameOperationPhase::Prepared
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::{ContentHash, FileInstanceId, RootRelativePath};
    use ot_plan::derive_rename_plan_id;
    use tempfile::TempDir;

    fn sample_plan(root_id: &RootId, destination_suffix: &str) -> RenameImpactPlan {
        let destination =
            RootRelativePath::parse(format!("SET/AUDIO/kick-{destination_suffix}.wav")).unwrap();
        let source = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let hash = ContentHash::parse(format!("sha256:{}", "a".repeat(64))).unwrap();
        let mut plan = RenameImpactPlan {
            id: PlanId::parse(format!("plan:v1:{}", "0".repeat(64))).unwrap(),
            root_id: root_id.clone(),
            device_fingerprint: format!("rootfp:v1:{}", "b".repeat(64)),
            base_observed_revision: 1,
            source_file_instance_id: FileInstanceId::parse(format!(
                "fileinst:v1:{}",
                "c".repeat(64)
            ))
            .unwrap(),
            source_relative_path: source,
            source_byte_size: 44,
            source_content_hash: hash,
            destination_relative_path: destination,
            state_document_impacts: Vec::new(),
            usage_edge_impacts: Vec::new(),
            sidecar_impacts: Vec::new(),
            unresolved_references: Vec::new(),
            backup_relative_paths: Vec::new(),
            estimated_media_additional_bytes: 0,
            estimated_local_staging_bytes: 0,
            reference_update_count: 0,
            warnings: Vec::new(),
        };
        let id = derive_rename_plan_id(&plan);
        plan.id = id;
        plan
    }

    fn runtime() -> RenameWriteRuntime {
        let local = TempDir::new().unwrap();
        RenameWriteRuntime::new(
            ExecutorLocalPaths {
                staging_directory: local.path().join("staging"),
                backup_directory: local.path().join("backups"),
                journal_directory: local.path().join("journals"),
            },
            Duration::from_secs(60),
        )
    }

    #[test]
    fn idempotent_store_refreshes_ttl_without_duplicate_error() {
        let runtime = runtime();
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id, "a");
        runtime.store_plan(plan.clone()).unwrap();
        runtime.store_plan(plan).unwrap();
    }

    #[test]
    fn idempotent_store_resets_session_progress() {
        let runtime = runtime();
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id, "a");
        let plan_id = plan.id.as_str().to_owned();
        runtime.store_plan(plan.clone()).unwrap();
        let authority = runtime.authorize(&root_id, &plan_id).unwrap();
        runtime.store_plan(plan).unwrap();
        assert!(matches!(
            runtime.verify_authority(&root_id, &plan_id, &authority.authority_id),
            Err(RenameWriteRuntimeError::AuthorityNotFound)
        ));
        runtime.authorize(&root_id, &plan_id).unwrap();
    }

    #[test]
    fn authorize_is_idempotent_for_same_plan() {
        let runtime = runtime();
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id, "a");
        let plan_id = plan.id.as_str().to_owned();
        runtime.store_plan(plan).unwrap();
        let first = runtime.authorize(&root_id, &plan_id).unwrap();
        let second = runtime.authorize(&root_id, &plan_id).unwrap();
        assert_eq!(first.authority_id, second.authority_id);
    }

    #[test]
    fn authority_mismatch_is_rejected() {
        let runtime = runtime();
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id, "a");
        let plan_id = plan.id.as_str().to_owned();
        runtime.store_plan(plan).unwrap();
        runtime.authorize(&root_id, &plan_id).unwrap();
        assert!(matches!(
            runtime.verify_authority(&root_id, &plan_id, "rename-auth:v1:deadbeef"),
            Err(RenameWriteRuntimeError::AuthorityMismatch)
        ));
    }
}
