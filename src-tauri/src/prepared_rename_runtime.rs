#![forbid(unsafe_code)]

use crate::clone_runtime::CloneRuntime;
use crate::local_artifact::{
    ensure_real_directory, CloneBaselineEvidenceId, LocalArtifactError, LocalArtifactStore,
    PreparedRenamePlanId,
};
use crate::root_registry::ResolvedRoot;
use ot_backup::{recovery_binding_for_rename_plan, BackupStore, SnapshotId, VerifiedRenameBackup};
use ot_domain::{
    ContentHash, FileInstanceId, ParserProvenance, ProjectCompatibilityEvidence, RootId,
    RootRelativePath, SampleReferenceStatus, SampleSettingsParseStatus, SampleSlotId,
    SampleSlotKind, SampleUsageKind, StateDocumentKind, StateDocumentRole,
};
use ot_executor::{
    ExecutorError, ExecutorLocalPaths, OperationId, RenameJournalStatus, RenameOperationJournal,
    RenameSampleExecutor,
};
use ot_plan::{
    PlanError, PlanId, RenameImpactPlan, RenamePlanningWarning, RenameReferenceUpdate,
    RenameSidecarImpact, RenameStateDocumentImpact, RenameUnresolvedReference,
    RenameUsageEdgeImpact,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PREPARED_RENAME_PLAN_SCHEMA: &str = "masterocta-prepared-rename-plan:v1";
const PREPARED_RENAME_PLANS_DIRECTORY: &str = "prepared-rename-plans";
const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const CONTINUATION_AUTHORITY_PREFIX: &str = "rename-continuation:v1:";
const DEFAULT_CONTINUATION_TTL: Duration = Duration::from_secs(300);

pub type SharedPreparedRenameRuntime = Arc<PreparedRenameRuntime>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedRenamePlanSnapshot {
    pub schema: String,
    pub prepared_plan_id: String,
    pub plan_id: String,
    pub operation_id: String,
    pub backup_snapshot_id: String,
    pub recovery_binding: String,
    pub clone_baseline_evidence_id: String,
    pub historical_device_fingerprint: String,
    pub historical_base_observed_revision: u64,
    pub historical_root_id: String,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub reference_update_count: u64,
    pub plan: PreparedPlanPayload,
    pub content_binding: String,
    pub created_at_unix: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedPlanPayload {
    pub plan_id: String,
    pub root_id: String,
    pub device_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_file_instance_id: String,
    pub source_relative_path: String,
    pub source_byte_size: u64,
    pub source_content_hash: String,
    pub destination_relative_path: String,
    pub state_document_impacts: Vec<PreparedStateDocumentImpactPayload>,
    pub usage_edge_impacts: Vec<PreparedUsageEdgeImpactPayload>,
    pub sidecar_impacts: Vec<PreparedSidecarImpactPayload>,
    pub unresolved_references: Vec<PreparedUnresolvedReferencePayload>,
    pub backup_relative_paths: Vec<String>,
    pub estimated_media_additional_bytes: u64,
    pub estimated_local_staging_bytes: u64,
    pub reference_update_count: u64,
    pub warnings: Vec<PreparedPlanningWarningPayload>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedReferenceUpdatePayload {
    pub project_document_relative_path: String,
    pub slot_kind: String,
    pub slot_number: u16,
    pub from_relative_path: String,
    pub to_relative_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedStateDocumentImpactPayload {
    pub relative_path: String,
    pub kind: String,
    pub role: String,
    pub byte_size: u64,
    pub content_hash: String,
    pub reference_updates: Vec<PreparedReferenceUpdatePayload>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedUsageEdgeImpactPayload {
    pub bank_document_relative_path: String,
    pub project_document_relative_path: String,
    pub slot_kind: String,
    pub slot_number: u16,
    pub usage_kind: String,
    pub referenced_file_relative_path: String,
    pub reference_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedSidecarImpactPayload {
    pub source_sidecar_relative_path: String,
    pub destination_sidecar_relative_path: String,
    pub byte_size: u64,
    pub content_hash: String,
    pub parse_status: String,
    pub parser_name: String,
    pub parser_revision: String,
    pub parser_source_version: Option<String>,
    pub parser_compatibility_evidence: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedUnresolvedReferencePayload {
    pub project_document_relative_path: String,
    pub slot_kind: String,
    pub slot_number: u16,
    pub reference_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedPlanningWarningPayload {
    pub kind: String,
    pub source_relative_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedOperationStatus {
    pub operation_id: OperationId,
    pub plan_id: PlanId,
    pub journal_status: Option<RenameJournalStatus>,
    pub prepared_snapshot_available: bool,
    pub backup_available: bool,
    pub clone_evidence_available: bool,
    pub continuation_required: bool,
    pub ready_to_continue: bool,
}

#[derive(Clone, Debug)]
pub struct ContinuationAuthorityRecord {
    pub continuation_authority_id: String,
    pub operation_id: OperationId,
    pub plan_id: PlanId,
    pub historical_device_fingerprint: String,
    pub current_root_id: RootId,
    pub current_device_fingerprint: String,
    pub clone_baseline_evidence_id: String,
    pub backup_snapshot_id: SnapshotId,
    pub prepared_plan_id: String,
    pub content_binding: String,
    pub expires_at: Instant,
}

#[derive(Default)]
struct ContinuationState {
    leases: HashMap<String, ContinuationAuthorityRecord>,
}

pub struct PreparedRenameRuntime {
    artifact_store: LocalArtifactStore,
    executor: RenameSampleExecutor,
    local_paths: ExecutorLocalPaths,
    continuation_state: Mutex<ContinuationState>,
    continuation_ttl: Duration,
}

#[derive(Debug)]
pub enum PreparedRenameRuntimeError {
    InvalidOperationId,
    InvalidPlanId,
    InvalidSnapshotId,
    SnapshotNotFound,
    SnapshotTampered,
    SnapshotIncomplete,
    JournalNotFound,
    JournalMismatch,
    BackupMismatch,
    CloneEvidenceUnavailable,
    CloneNotVerified,
    PlanIntegrityMismatch,
    ContinuationRequired,
    ContinuationMismatch,
    ContinuationExpired,
    ContinuationNotFound,
    ApprovalMismatch,
    FingerprintMismatch,
    Unavailable,
    Plan(PlanError),
    Executor(ExecutorError),
    Backup(ot_backup::BackupError),
    Artifact(LocalArtifactError),
}

impl PreparedRenameRuntime {
    pub fn new(
        storage_root: PathBuf,
        local_paths: ExecutorLocalPaths,
        continuation_ttl: Duration,
    ) -> Result<Self, PreparedRenameRuntimeError> {
        ensure_real_directory(
            &storage_root,
            &storage_root.join(PREPARED_RENAME_PLANS_DIRECTORY),
        )
        .map_err(PreparedRenameRuntimeError::Artifact)?;
        let artifact_store = LocalArtifactStore::new(storage_root, PREPARED_RENAME_PLANS_DIRECTORY)
            .map_err(PreparedRenameRuntimeError::Artifact)?;
        Ok(Self {
            artifact_store,
            executor: RenameSampleExecutor::new(local_paths.clone()),
            local_paths,
            continuation_state: Mutex::new(ContinuationState::default()),
            continuation_ttl,
        })
    }

    pub fn persist_after_prepare(
        &self,
        plan: &RenameImpactPlan,
        operation_id: &OperationId,
        clone_baseline_evidence_id: &str,
    ) -> Result<PreparedRenamePlanSnapshot, PreparedRenameRuntimeError> {
        let backup_store = BackupStore::new(self.local_paths.backup_directory.clone());
        let verified = backup_store
            .verify_for_rename_plan(plan)
            .map_err(PreparedRenameRuntimeError::Backup)?;
        self.persist_prepared_snapshot(plan, operation_id, &verified, clone_baseline_evidence_id)
    }

    pub fn persist_prepared_snapshot(
        &self,
        plan: &RenameImpactPlan,
        operation_id: &OperationId,
        backup: &VerifiedRenameBackup,
        clone_baseline_evidence_id: &str,
    ) -> Result<PreparedRenamePlanSnapshot, PreparedRenameRuntimeError> {
        plan.validate_integrity()
            .map_err(PreparedRenameRuntimeError::Plan)?;
        CloneBaselineEvidenceId::parse(clone_baseline_evidence_id)
            .map_err(|_| PreparedRenameRuntimeError::CloneEvidenceUnavailable)?;
        let recovery_binding =
            recovery_binding_for_rename_plan(plan).map_err(PreparedRenameRuntimeError::Backup)?;
        if backup.snapshot_id().as_str() != SnapshotId::for_rename_plan(plan).as_str() {
            return Err(PreparedRenameRuntimeError::BackupMismatch);
        }
        if backup.manifest().recovery_binding != recovery_binding {
            return Err(PreparedRenameRuntimeError::BackupMismatch);
        }

        let prepared_plan_id = derive_prepared_plan_id(operation_id);
        let payload = PreparedPlanPayload::from_plan(plan);
        let mut snapshot = PreparedRenamePlanSnapshot {
            schema: PREPARED_RENAME_PLAN_SCHEMA.to_owned(),
            prepared_plan_id: prepared_plan_id.clone(),
            plan_id: plan.id.as_str().to_owned(),
            operation_id: operation_id.as_str().to_owned(),
            backup_snapshot_id: backup.snapshot_id().as_str().to_owned(),
            recovery_binding,
            clone_baseline_evidence_id: clone_baseline_evidence_id.to_owned(),
            historical_device_fingerprint: plan.device_fingerprint.clone(),
            historical_base_observed_revision: plan.base_observed_revision,
            historical_root_id: plan.root_id.as_str().to_owned(),
            source_relative_path: plan.source_relative_path.as_str().to_owned(),
            destination_relative_path: plan.destination_relative_path.as_str().to_owned(),
            reference_update_count: plan.reference_update_count,
            plan: payload,
            content_binding: String::new(),
            created_at_unix: unix_now(),
        };
        snapshot.content_binding = derive_snapshot_content_binding(&snapshot);
        let artifact_id = PreparedRenamePlanId::parse(&prepared_plan_id)
            .map_err(PreparedRenameRuntimeError::Artifact)?;
        self.artifact_store
            .write_json_create_once(artifact_id.file_stem(), &snapshot)
            .map_err(PreparedRenameRuntimeError::Artifact)?;
        Ok(snapshot)
    }

    pub fn load_prepared_snapshot(
        &self,
        operation_id: &OperationId,
    ) -> Result<PreparedRenamePlanSnapshot, PreparedRenameRuntimeError> {
        let prepared_plan_id = derive_prepared_plan_id(operation_id);
        let artifact_id = PreparedRenamePlanId::parse(&prepared_plan_id)
            .map_err(PreparedRenameRuntimeError::Artifact)?;
        let snapshot: PreparedRenamePlanSnapshot = self
            .artifact_store
            .read_json(artifact_id.file_stem())
            .map_err(|error| match error {
                LocalArtifactError::Io => PreparedRenameRuntimeError::SnapshotNotFound,
                other => PreparedRenameRuntimeError::Artifact(other),
            })?;
        self.validate_loaded_snapshot(&snapshot, operation_id)?;
        Ok(snapshot)
    }

    pub fn prepared_operation_status(
        &self,
        operation_id: &OperationId,
        current_fingerprint: Option<&str>,
    ) -> Result<PreparedOperationStatus, PreparedRenameRuntimeError> {
        let journal = self
            .executor
            .rename_journal(operation_id)
            .map_err(PreparedRenameRuntimeError::Executor)?;
        let snapshot_result = self.load_prepared_snapshot(operation_id);
        let snapshot_available = snapshot_result.is_ok();
        let backup_available = snapshot_result
            .as_ref()
            .ok()
            .and_then(|snapshot| self.verify_backup_for_snapshot(snapshot).ok())
            .is_some();
        let clone_evidence_available = snapshot_result
            .as_ref()
            .ok()
            .and_then(|snapshot| {
                CloneBaselineEvidenceId::parse(&snapshot.clone_baseline_evidence_id).ok()
            })
            .is_some();
        let (plan_id, continuation_required, ready_to_continue) = match snapshot_result {
            Ok(snapshot) => {
                let plan_id = PlanId::parse(&snapshot.plan_id)
                    .map_err(|_| PreparedRenameRuntimeError::InvalidPlanId)?;
                let fingerprint_matches = current_fingerprint.is_some_and(|fingerprint| {
                    fingerprint == snapshot.historical_device_fingerprint
                });
                let journal_prepared = journal
                    .as_ref()
                    .is_some_and(|entry| entry.status == RenameJournalStatus::Prepared);
                let ready = fingerprint_matches
                    && journal_prepared
                    && backup_available
                    && snapshot_available;
                (plan_id, true, ready)
            }
            Err(PreparedRenameRuntimeError::SnapshotNotFound) => {
                if journal.is_some() {
                    return Err(PreparedRenameRuntimeError::SnapshotIncomplete);
                }
                return Err(PreparedRenameRuntimeError::SnapshotNotFound);
            }
            Err(error) => return Err(error),
        };
        Ok(PreparedOperationStatus {
            operation_id: operation_id.clone(),
            plan_id,
            journal_status: journal.map(|entry| entry.status),
            prepared_snapshot_available: snapshot_available,
            backup_available,
            clone_evidence_available,
            continuation_required,
            ready_to_continue,
        })
    }

    pub fn issue_continuation_authority(
        &self,
        resolved: &ResolvedRoot,
        operation_id: &OperationId,
        approved_operation_id: &OperationId,
        clone_runtime: &CloneRuntime,
    ) -> Result<ContinuationAuthorityRecord, PreparedRenameRuntimeError> {
        if operation_id != approved_operation_id {
            return Err(PreparedRenameRuntimeError::ApprovalMismatch);
        }
        let snapshot = self.load_prepared_snapshot(operation_id)?;
        if snapshot.historical_device_fingerprint != resolved.session.device_fingerprint {
            return Err(PreparedRenameRuntimeError::FingerprintMismatch);
        }
        let journal = self
            .executor
            .rename_journal(operation_id)
            .map_err(PreparedRenameRuntimeError::Executor)?
            .ok_or(PreparedRenameRuntimeError::JournalNotFound)?;
        self.validate_journal_binding(&snapshot, &journal)?;
        self.verify_backup_for_snapshot(&snapshot)?;
        clone_runtime
            .restore_verification_from_baseline(resolved, &snapshot.clone_baseline_evidence_id)
            .map_err(map_clone_error)?;
        let plan = snapshot.plan.to_plan()?;
        plan.validate_integrity()
            .map_err(PreparedRenameRuntimeError::Plan)?;
        let expires_at = Instant::now() + self.continuation_ttl;
        let record = ContinuationAuthorityRecord {
            continuation_authority_id: derive_continuation_authority_id(
                operation_id,
                resolved.session.root_id.as_str(),
                &snapshot.content_binding,
            ),
            operation_id: operation_id.clone(),
            plan_id: plan.id,
            historical_device_fingerprint: snapshot.historical_device_fingerprint,
            current_root_id: resolved.session.root_id.clone(),
            current_device_fingerprint: resolved.session.device_fingerprint.clone(),
            clone_baseline_evidence_id: snapshot.clone_baseline_evidence_id,
            backup_snapshot_id: SnapshotId::parse(snapshot.backup_snapshot_id.clone())
                .map_err(|_| PreparedRenameRuntimeError::InvalidSnapshotId)?,
            prepared_plan_id: snapshot.prepared_plan_id,
            content_binding: snapshot.content_binding,
            expires_at,
        };
        self.store_continuation(record.clone())?;
        Ok(record)
    }

    pub fn verify_continuation_authority(
        &self,
        resolved: &ResolvedRoot,
        operation_id: &OperationId,
        continuation_authority_id: &str,
    ) -> Result<ContinuationAuthorityRecord, PreparedRenameRuntimeError> {
        if !continuation_authority_id.starts_with(CONTINUATION_AUTHORITY_PREFIX) {
            return Err(PreparedRenameRuntimeError::ContinuationMismatch);
        }
        let mut state = self.lock_continuation_state()?;
        purge_expired_continuations(&mut state);
        let record = state
            .leases
            .get(continuation_authority_id)
            .cloned()
            .ok_or(PreparedRenameRuntimeError::ContinuationNotFound)?;
        if record.expires_at <= Instant::now() {
            return Err(PreparedRenameRuntimeError::ContinuationExpired);
        }
        if record.operation_id != *operation_id
            || record.current_root_id != resolved.session.root_id
            || record.current_device_fingerprint != resolved.session.device_fingerprint
        {
            return Err(PreparedRenameRuntimeError::ContinuationMismatch);
        }
        let snapshot = self.load_prepared_snapshot(operation_id)?;
        if record.plan_id.as_str() != snapshot.plan_id
            || record.backup_snapshot_id.as_str() != snapshot.backup_snapshot_id
            || record.prepared_plan_id != snapshot.prepared_plan_id
            || record.content_binding != snapshot.content_binding
            || record.historical_device_fingerprint != snapshot.historical_device_fingerprint
        {
            return Err(PreparedRenameRuntimeError::ContinuationMismatch);
        }
        Ok(record)
    }

    pub fn revoke_continuation_authority(&self, continuation_authority_id: &str) {
        if let Ok(mut state) = self.lock_continuation_state() {
            state.leases.remove(continuation_authority_id);
        }
    }

    pub fn load_prepared_plan(
        &self,
        operation_id: &OperationId,
    ) -> Result<RenameImpactPlan, PreparedRenameRuntimeError> {
        let snapshot = self.load_prepared_snapshot(operation_id)?;
        snapshot.plan.to_plan()
    }

    pub fn validate_prepared_for_apply(
        &self,
        operation_id: &OperationId,
    ) -> Result<RenameImpactPlan, PreparedRenameRuntimeError> {
        let snapshot = self.load_prepared_snapshot(operation_id)?;
        let journal = self
            .executor
            .rename_journal(operation_id)
            .map_err(PreparedRenameRuntimeError::Executor)?
            .ok_or(PreparedRenameRuntimeError::JournalNotFound)?;
        self.validate_journal_binding(&snapshot, &journal)?;
        self.verify_backup_for_snapshot(&snapshot)?;
        snapshot.plan.to_plan()
    }

    pub fn validate_prepared_for_recovery(
        &self,
        operation_id: &OperationId,
        root_fingerprint: &str,
    ) -> Result<RenameImpactPlan, PreparedRenameRuntimeError> {
        let snapshot = self.load_prepared_snapshot(operation_id)?;
        if snapshot.historical_device_fingerprint != root_fingerprint {
            return Err(PreparedRenameRuntimeError::FingerprintMismatch);
        }
        let journal = self
            .executor
            .rename_journal(operation_id)
            .map_err(PreparedRenameRuntimeError::Executor)?
            .ok_or(PreparedRenameRuntimeError::JournalNotFound)?;
        if !matches!(
            journal.status,
            RenameJournalStatus::Applying | RenameJournalStatus::RecoveryRequired
        ) {
            return Err(PreparedRenameRuntimeError::JournalMismatch);
        }
        self.validate_journal_binding_for_recovery(&snapshot, &journal)?;
        self.verify_backup_for_snapshot(&snapshot)?;
        snapshot.plan.to_plan()
    }

    fn validate_loaded_snapshot(
        &self,
        snapshot: &PreparedRenamePlanSnapshot,
        operation_id: &OperationId,
    ) -> Result<(), PreparedRenameRuntimeError> {
        if snapshot.schema != PREPARED_RENAME_PLAN_SCHEMA {
            return Err(PreparedRenameRuntimeError::SnapshotTampered);
        }
        if snapshot.operation_id != operation_id.as_str() {
            return Err(PreparedRenameRuntimeError::SnapshotTampered);
        }
        if snapshot.content_binding != derive_snapshot_content_binding(snapshot) {
            return Err(PreparedRenameRuntimeError::SnapshotTampered);
        }
        PreparedRenamePlanId::parse(&snapshot.prepared_plan_id)
            .map_err(|_| PreparedRenameRuntimeError::SnapshotTampered)?;
        CloneBaselineEvidenceId::parse(&snapshot.clone_baseline_evidence_id)
            .map_err(|_| PreparedRenameRuntimeError::SnapshotTampered)?;
        let plan = snapshot.plan.to_plan()?;
        if plan.id.as_str() != snapshot.plan_id {
            return Err(PreparedRenameRuntimeError::SnapshotTampered);
        }
        if OperationId::for_rename_plan(&plan).as_str() != snapshot.operation_id {
            return Err(PreparedRenameRuntimeError::SnapshotTampered);
        }
        plan.validate_integrity()
            .map_err(PreparedRenameRuntimeError::Plan)?;
        Ok(())
    }

    fn validate_journal_binding(
        &self,
        snapshot: &PreparedRenamePlanSnapshot,
        journal: &RenameOperationJournal,
    ) -> Result<(), PreparedRenameRuntimeError> {
        self.validate_journal_evidence_binding(snapshot, journal)?;
        if journal.status != RenameJournalStatus::Prepared {
            return Err(PreparedRenameRuntimeError::ContinuationRequired);
        }
        Ok(())
    }

    fn validate_journal_binding_for_recovery(
        &self,
        snapshot: &PreparedRenamePlanSnapshot,
        journal: &RenameOperationJournal,
    ) -> Result<(), PreparedRenameRuntimeError> {
        self.validate_journal_evidence_binding(snapshot, journal)
    }

    fn validate_journal_evidence_binding(
        &self,
        snapshot: &PreparedRenamePlanSnapshot,
        journal: &RenameOperationJournal,
    ) -> Result<(), PreparedRenameRuntimeError> {
        if journal.operation_id != snapshot.operation_id
            || journal.plan_id != snapshot.plan_id
            || journal.backup_snapshot_id != snapshot.backup_snapshot_id
            || journal.recovery_binding != snapshot.recovery_binding
            || journal.root_fingerprint != snapshot.historical_device_fingerprint
            || journal.base_observed_revision != snapshot.historical_base_observed_revision
            || journal.source_relative_path != snapshot.source_relative_path
            || journal.destination_relative_path != snapshot.destination_relative_path
            || journal.reference_update_count != snapshot.reference_update_count
        {
            return Err(PreparedRenameRuntimeError::JournalMismatch);
        }
        Ok(())
    }

    fn verify_backup_for_snapshot(
        &self,
        snapshot: &PreparedRenamePlanSnapshot,
    ) -> Result<VerifiedRenameBackup, PreparedRenameRuntimeError> {
        let plan = snapshot.plan.to_plan()?;
        let backup_store = BackupStore::new(self.local_paths.backup_directory.clone());
        let verified = backup_store
            .verify_for_rename_plan(&plan)
            .map_err(PreparedRenameRuntimeError::Backup)?;
        if verified.snapshot_id().as_str() != snapshot.backup_snapshot_id {
            return Err(PreparedRenameRuntimeError::BackupMismatch);
        }
        if verified.manifest().recovery_binding != snapshot.recovery_binding {
            return Err(PreparedRenameRuntimeError::BackupMismatch);
        }
        Ok(verified)
    }

    fn store_continuation(
        &self,
        record: ContinuationAuthorityRecord,
    ) -> Result<(), PreparedRenameRuntimeError> {
        let mut state = self.lock_continuation_state()?;
        purge_expired_continuations(&mut state);
        state
            .leases
            .retain(|_, existing| existing.operation_id != record.operation_id);
        state
            .leases
            .insert(record.continuation_authority_id.clone(), record);
        Ok(())
    }

    fn lock_continuation_state(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, ContinuationState>, PreparedRenameRuntimeError> {
        self.continuation_state
            .lock()
            .map_err(|_| PreparedRenameRuntimeError::Unavailable)
    }
}

impl PreparedPlanPayload {
    fn from_plan(plan: &RenameImpactPlan) -> Self {
        Self {
            plan_id: plan.id.as_str().to_owned(),
            root_id: plan.root_id.as_str().to_owned(),
            device_fingerprint: plan.device_fingerprint.clone(),
            base_observed_revision: plan.base_observed_revision,
            source_file_instance_id: plan.source_file_instance_id.as_str().to_owned(),
            source_relative_path: plan.source_relative_path.as_str().to_owned(),
            source_byte_size: plan.source_byte_size,
            source_content_hash: plan.source_content_hash.as_str().to_owned(),
            destination_relative_path: plan.destination_relative_path.as_str().to_owned(),
            state_document_impacts: plan
                .state_document_impacts
                .iter()
                .map(PreparedStateDocumentImpactPayload::from_impact)
                .collect(),
            usage_edge_impacts: plan
                .usage_edge_impacts
                .iter()
                .map(PreparedUsageEdgeImpactPayload::from_impact)
                .collect(),
            sidecar_impacts: plan
                .sidecar_impacts
                .iter()
                .map(PreparedSidecarImpactPayload::from_impact)
                .collect(),
            unresolved_references: plan
                .unresolved_references
                .iter()
                .map(PreparedUnresolvedReferencePayload::from_impact)
                .collect(),
            backup_relative_paths: plan
                .backup_relative_paths
                .iter()
                .map(|path| path.as_str().to_owned())
                .collect(),
            estimated_media_additional_bytes: plan.estimated_media_additional_bytes,
            estimated_local_staging_bytes: plan.estimated_local_staging_bytes,
            reference_update_count: plan.reference_update_count,
            warnings: plan
                .warnings
                .iter()
                .map(PreparedPlanningWarningPayload::from_warning)
                .collect(),
        }
    }

    fn to_plan(&self) -> Result<RenameImpactPlan, PreparedRenameRuntimeError> {
        let plan = RenameImpactPlan {
            id: PlanId::parse(&self.plan_id)
                .map_err(|_| PreparedRenameRuntimeError::InvalidPlanId)?,
            root_id: RootId::new(&self.root_id)
                .map_err(|_| PreparedRenameRuntimeError::InvalidPlanId)?,
            device_fingerprint: self.device_fingerprint.clone(),
            base_observed_revision: self.base_observed_revision,
            source_file_instance_id: FileInstanceId::parse(&self.source_file_instance_id)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            source_relative_path: RootRelativePath::parse(&self.source_relative_path)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            source_byte_size: self.source_byte_size,
            source_content_hash: ContentHash::parse(&self.source_content_hash)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            destination_relative_path: RootRelativePath::parse(&self.destination_relative_path)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            state_document_impacts: self
                .state_document_impacts
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            usage_edge_impacts: self
                .usage_edge_impacts
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            sidecar_impacts: self
                .sidecar_impacts
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            unresolved_references: self
                .unresolved_references
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            backup_relative_paths: self
                .backup_relative_paths
                .iter()
                .map(RootRelativePath::parse)
                .collect::<Result<_, _>>()
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            estimated_media_additional_bytes: self.estimated_media_additional_bytes,
            estimated_local_staging_bytes: self.estimated_local_staging_bytes,
            reference_update_count: self.reference_update_count,
            warnings: self
                .warnings
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
        };
        Ok(plan)
    }
}

impl PreparedStateDocumentImpactPayload {
    fn from_impact(impact: &RenameStateDocumentImpact) -> Self {
        Self {
            relative_path: impact.relative_path.as_str().to_owned(),
            kind: encode_state_document_kind(impact.kind),
            role: encode_state_document_role(impact.role),
            byte_size: impact.byte_size,
            content_hash: impact.content_hash.as_str().to_owned(),
            reference_updates: impact
                .reference_updates
                .iter()
                .map(PreparedReferenceUpdatePayload::from_update)
                .collect(),
        }
    }
}

impl TryFrom<&PreparedStateDocumentImpactPayload> for RenameStateDocumentImpact {
    type Error = PreparedRenameRuntimeError;

    fn try_from(payload: &PreparedStateDocumentImpactPayload) -> Result<Self, Self::Error> {
        Ok(Self {
            relative_path: RootRelativePath::parse(&payload.relative_path)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            kind: decode_state_document_kind(&payload.kind)?,
            role: decode_state_document_role(&payload.role)?,
            byte_size: payload.byte_size,
            content_hash: ContentHash::parse(&payload.content_hash)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            reference_updates: payload
                .reference_updates
                .iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
        })
    }
}

impl PreparedReferenceUpdatePayload {
    fn from_update(update: &RenameReferenceUpdate) -> Self {
        Self {
            project_document_relative_path: update
                .project_document_relative_path
                .as_str()
                .to_owned(),
            slot_kind: encode_slot_kind(update.slot.kind()),
            slot_number: update.slot.number(),
            from_relative_path: update.from_relative_path.as_str().to_owned(),
            to_relative_path: update.to_relative_path.as_str().to_owned(),
        }
    }
}

impl TryFrom<&PreparedReferenceUpdatePayload> for RenameReferenceUpdate {
    type Error = PreparedRenameRuntimeError;

    fn try_from(payload: &PreparedReferenceUpdatePayload) -> Result<Self, Self::Error> {
        Ok(Self {
            project_document_relative_path: RootRelativePath::parse(
                &payload.project_document_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            slot: decode_sample_slot(&payload.slot_kind, payload.slot_number)?,
            from_relative_path: RootRelativePath::parse(&payload.from_relative_path)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            to_relative_path: RootRelativePath::parse(&payload.to_relative_path)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
        })
    }
}

impl PreparedUsageEdgeImpactPayload {
    fn from_impact(impact: &RenameUsageEdgeImpact) -> Self {
        Self {
            bank_document_relative_path: impact.bank_document_relative_path.as_str().to_owned(),
            project_document_relative_path: impact
                .project_document_relative_path
                .as_str()
                .to_owned(),
            slot_kind: encode_slot_kind(impact.slot.kind()),
            slot_number: impact.slot.number(),
            usage_kind: encode_usage_kind(impact.usage_kind),
            referenced_file_relative_path: impact.referenced_file_relative_path.as_str().to_owned(),
            reference_status: encode_reference_status(impact.reference_status),
        }
    }
}

impl TryFrom<&PreparedUsageEdgeImpactPayload> for RenameUsageEdgeImpact {
    type Error = PreparedRenameRuntimeError;

    fn try_from(payload: &PreparedUsageEdgeImpactPayload) -> Result<Self, Self::Error> {
        Ok(Self {
            bank_document_relative_path: RootRelativePath::parse(
                &payload.bank_document_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            project_document_relative_path: RootRelativePath::parse(
                &payload.project_document_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            slot: decode_sample_slot(&payload.slot_kind, payload.slot_number)?,
            usage_kind: decode_usage_kind(&payload.usage_kind)?,
            referenced_file_relative_path: RootRelativePath::parse(
                &payload.referenced_file_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            reference_status: decode_reference_status(&payload.reference_status)?,
        })
    }
}

impl PreparedSidecarImpactPayload {
    fn from_impact(impact: &RenameSidecarImpact) -> Self {
        Self {
            source_sidecar_relative_path: impact.source_sidecar_relative_path.as_str().to_owned(),
            destination_sidecar_relative_path: impact
                .destination_sidecar_relative_path
                .as_str()
                .to_owned(),
            byte_size: impact.byte_size,
            content_hash: impact.content_hash.as_str().to_owned(),
            parse_status: encode_sample_settings_parse_status(impact.parse_status),
            parser_name: impact.parser_provenance.parser_name.clone(),
            parser_revision: impact.parser_provenance.parser_revision.clone(),
            parser_source_version: impact.parser_provenance.source_version.clone(),
            parser_compatibility_evidence: impact
                .parser_provenance
                .compatibility_evidence
                .map(encode_compatibility_evidence),
        }
    }
}

impl TryFrom<&PreparedSidecarImpactPayload> for RenameSidecarImpact {
    type Error = PreparedRenameRuntimeError;

    fn try_from(payload: &PreparedSidecarImpactPayload) -> Result<Self, Self::Error> {
        Ok(Self {
            source_sidecar_relative_path: RootRelativePath::parse(
                &payload.source_sidecar_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            destination_sidecar_relative_path: RootRelativePath::parse(
                &payload.destination_sidecar_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            byte_size: payload.byte_size,
            content_hash: ContentHash::parse(&payload.content_hash)
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            parse_status: decode_sample_settings_parse_status(&payload.parse_status)?,
            parser_provenance: ParserProvenance {
                parser_name: payload.parser_name.clone(),
                parser_revision: payload.parser_revision.clone(),
                source_version: payload.parser_source_version.clone(),
                compatibility_evidence: payload
                    .parser_compatibility_evidence
                    .as_deref()
                    .map(decode_compatibility_evidence)
                    .transpose()?,
            },
        })
    }
}

impl PreparedUnresolvedReferencePayload {
    fn from_impact(impact: &RenameUnresolvedReference) -> Self {
        Self {
            project_document_relative_path: impact
                .project_document_relative_path
                .as_str()
                .to_owned(),
            slot_kind: encode_slot_kind(impact.slot.kind()),
            slot_number: impact.slot.number(),
            reference_status: encode_reference_status(impact.reference_status),
        }
    }
}

impl TryFrom<&PreparedUnresolvedReferencePayload> for RenameUnresolvedReference {
    type Error = PreparedRenameRuntimeError;

    fn try_from(payload: &PreparedUnresolvedReferencePayload) -> Result<Self, Self::Error> {
        Ok(Self {
            project_document_relative_path: RootRelativePath::parse(
                &payload.project_document_relative_path,
            )
            .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            slot: decode_sample_slot(&payload.slot_kind, payload.slot_number)?,
            reference_status: decode_reference_status(&payload.reference_status)?,
        })
    }
}

impl PreparedPlanningWarningPayload {
    fn from_warning(warning: &RenamePlanningWarning) -> Self {
        match warning {
            RenamePlanningWarning::UnusedSample {
                source_relative_path,
            } => Self {
                kind: "unused_sample".to_owned(),
                source_relative_path: Some(source_relative_path.as_str().to_owned()),
            },
        }
    }
}

impl TryFrom<&PreparedPlanningWarningPayload> for RenamePlanningWarning {
    type Error = PreparedRenameRuntimeError;

    fn try_from(payload: &PreparedPlanningWarningPayload) -> Result<Self, Self::Error> {
        match payload.kind.as_str() {
            "unused_sample" => Ok(Self::UnusedSample {
                source_relative_path: RootRelativePath::parse(
                    payload
                        .source_relative_path
                        .as_deref()
                        .ok_or(PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
                )
                .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)?,
            }),
            _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
        }
    }
}

pub fn open_shared_prepared_rename_runtime(
    data_directory: &Path,
    local_paths: ExecutorLocalPaths,
) -> Result<SharedPreparedRenameRuntime, PreparedRenameRuntimeError> {
    fs::create_dir_all(data_directory).map_err(|_| PreparedRenameRuntimeError::Unavailable)?;
    let canonical = data_directory
        .canonicalize()
        .map_err(|_| PreparedRenameRuntimeError::Unavailable)?;
    let storage_root = canonical.join(PRODUCT_DIRECTORY);
    ensure_real_directory(&canonical, &storage_root)
        .map_err(PreparedRenameRuntimeError::Artifact)?;
    Ok(Arc::new(PreparedRenameRuntime::new(
        storage_root,
        local_paths,
        DEFAULT_CONTINUATION_TTL,
    )?))
}

fn derive_prepared_plan_id(operation_id: &OperationId) -> String {
    let digest = operation_id
        .as_str()
        .strip_prefix("operation:v1:")
        .expect("OperationId uses the v1 prefix");
    format!("prepared-rename-plan:v1:{digest}")
}

fn derive_snapshot_content_binding(snapshot: &PreparedRenamePlanSnapshot) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"prepared-rename-plan-binding:v1");
    hasher.update(snapshot.schema.as_bytes());
    hasher.update(snapshot.prepared_plan_id.as_bytes());
    hasher.update(snapshot.plan_id.as_bytes());
    hasher.update(snapshot.operation_id.as_bytes());
    hasher.update(snapshot.backup_snapshot_id.as_bytes());
    hasher.update(snapshot.recovery_binding.as_bytes());
    hasher.update(snapshot.clone_baseline_evidence_id.as_bytes());
    hasher.update(snapshot.historical_device_fingerprint.as_bytes());
    hasher.update(snapshot.historical_base_observed_revision.to_be_bytes());
    hasher.update(snapshot.historical_root_id.as_bytes());
    hasher.update(snapshot.source_relative_path.as_bytes());
    hasher.update(snapshot.destination_relative_path.as_bytes());
    hasher.update(snapshot.reference_update_count.to_be_bytes());
    let payload = serde_json::to_vec(&snapshot.plan).unwrap_or_default();
    hasher.update(&payload);
    format!("sha256:{:x}", hasher.finalize())
}

fn derive_continuation_authority_id(
    operation_id: &OperationId,
    current_root_id: &str,
    content_binding: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(CONTINUATION_AUTHORITY_PREFIX.as_bytes());
    hasher.update(operation_id.as_str().as_bytes());
    hasher.update(current_root_id.as_bytes());
    hasher.update(content_binding.as_bytes());
    format!("{CONTINUATION_AUTHORITY_PREFIX}{:x}", hasher.finalize())
}

fn purge_expired_continuations(state: &mut ContinuationState) {
    let now = Instant::now();
    state.leases.retain(|_, lease| lease.expires_at > now);
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn encode_state_document_kind(kind: StateDocumentKind) -> String {
    match kind {
        StateDocumentKind::Project => "project".to_owned(),
        StateDocumentKind::Bank => "bank".to_owned(),
    }
}

fn decode_state_document_kind(
    value: &str,
) -> Result<StateDocumentKind, PreparedRenameRuntimeError> {
    match value {
        "project" => Ok(StateDocumentKind::Project),
        "bank" => Ok(StateDocumentKind::Bank),
        _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    }
}

fn encode_state_document_role(role: StateDocumentRole) -> String {
    match role {
        StateDocumentRole::Working => "working".to_owned(),
        StateDocumentRole::SavedCheckpoint => "saved_checkpoint".to_owned(),
    }
}

fn decode_state_document_role(
    value: &str,
) -> Result<StateDocumentRole, PreparedRenameRuntimeError> {
    match value {
        "working" => Ok(StateDocumentRole::Working),
        "saved_checkpoint" => Ok(StateDocumentRole::SavedCheckpoint),
        _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    }
}

fn encode_slot_kind(kind: SampleSlotKind) -> String {
    match kind {
        SampleSlotKind::Static => "static".to_owned(),
        SampleSlotKind::Flex => "flex".to_owned(),
    }
}

fn decode_sample_slot(kind: &str, number: u16) -> Result<SampleSlotId, PreparedRenameRuntimeError> {
    let slot_kind = match kind {
        "static" => SampleSlotKind::Static,
        "flex" => SampleSlotKind::Flex,
        _ => return Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    };
    SampleSlotId::new(slot_kind, number)
        .map_err(|_| PreparedRenameRuntimeError::PlanIntegrityMismatch)
}

fn encode_usage_kind(kind: SampleUsageKind) -> String {
    match kind {
        SampleUsageKind::Machine => "machine".to_owned(),
        SampleUsageKind::SampleLock => "sample_lock".to_owned(),
    }
}

fn decode_usage_kind(value: &str) -> Result<SampleUsageKind, PreparedRenameRuntimeError> {
    match value {
        "machine" => Ok(SampleUsageKind::Machine),
        "sample_lock" => Ok(SampleUsageKind::SampleLock),
        _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    }
}

fn encode_reference_status(status: SampleReferenceStatus) -> String {
    match status {
        SampleReferenceStatus::Resolved => "resolved".to_owned(),
        SampleReferenceStatus::Missing => "missing".to_owned(),
        SampleReferenceStatus::InvalidPath => "invalid_path".to_owned(),
        SampleReferenceStatus::UnassignedSlot => "unassigned_slot".to_owned(),
    }
}

fn decode_reference_status(
    value: &str,
) -> Result<SampleReferenceStatus, PreparedRenameRuntimeError> {
    match value {
        "resolved" => Ok(SampleReferenceStatus::Resolved),
        "missing" => Ok(SampleReferenceStatus::Missing),
        "invalid_path" => Ok(SampleReferenceStatus::InvalidPath),
        "unassigned_slot" => Ok(SampleReferenceStatus::UnassignedSlot),
        _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    }
}

fn encode_sample_settings_parse_status(status: SampleSettingsParseStatus) -> String {
    match status {
        SampleSettingsParseStatus::Parsed => "parsed".to_owned(),
        SampleSettingsParseStatus::UnsupportedVersion => "unsupported_version".to_owned(),
        SampleSettingsParseStatus::Malformed => "malformed".to_owned(),
    }
}

fn decode_sample_settings_parse_status(
    value: &str,
) -> Result<SampleSettingsParseStatus, PreparedRenameRuntimeError> {
    match value {
        "parsed" => Ok(SampleSettingsParseStatus::Parsed),
        "unsupported_version" => Ok(SampleSettingsParseStatus::UnsupportedVersion),
        "malformed" => Ok(SampleSettingsParseStatus::Malformed),
        _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    }
}

fn encode_compatibility_evidence(value: ProjectCompatibilityEvidence) -> String {
    match value {
        ProjectCompatibilityEvidence::UpstreamLibrary => "upstream_library".to_owned(),
        ProjectCompatibilityEvidence::VerifiedMasterOctaFixture => {
            "verified_masterocta_fixture".to_owned()
        }
    }
}

fn decode_compatibility_evidence(
    value: &str,
) -> Result<ProjectCompatibilityEvidence, PreparedRenameRuntimeError> {
    match value {
        "upstream_library" => Ok(ProjectCompatibilityEvidence::UpstreamLibrary),
        "verified_masterocta_fixture" => {
            Ok(ProjectCompatibilityEvidence::VerifiedMasterOctaFixture)
        }
        _ => Err(PreparedRenameRuntimeError::PlanIntegrityMismatch),
    }
}

fn map_clone_error(error: crate::clone_runtime::CloneRuntimeError) -> PreparedRenameRuntimeError {
    match error {
        crate::clone_runtime::CloneRuntimeError::CloneNotVerified
        | crate::clone_runtime::CloneRuntimeError::VerificationNotFound
        | crate::clone_runtime::CloneRuntimeError::VerificationExpired
        | crate::clone_runtime::CloneRuntimeError::VerificationTampered => {
            PreparedRenameRuntimeError::CloneNotVerified
        }
        crate::clone_runtime::CloneRuntimeError::InvalidArtifactId => {
            PreparedRenameRuntimeError::CloneEvidenceUnavailable
        }
        _ => PreparedRenameRuntimeError::Unavailable,
    }
}

impl PreparedRenameRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidOperationId => "INVALID_OPERATION_ID",
            Self::InvalidPlanId => "INVALID_PLAN_ID",
            Self::InvalidSnapshotId => "INVALID_SNAPSHOT_ID",
            Self::SnapshotNotFound => "PREPARED_SNAPSHOT_NOT_FOUND",
            Self::SnapshotTampered => "PREPARED_SNAPSHOT_TAMPERED",
            Self::SnapshotIncomplete => "PREPARED_ARTIFACT_INCOMPLETE",
            Self::JournalNotFound => "PREPARED_JOURNAL_NOT_FOUND",
            Self::JournalMismatch => "PREPARED_JOURNAL_MISMATCH",
            Self::BackupMismatch => "PREPARED_BACKUP_MISMATCH",
            Self::CloneEvidenceUnavailable => "CLONE_EVIDENCE_UNAVAILABLE",
            Self::CloneNotVerified => "CLONE_NOT_VERIFIED",
            Self::PlanIntegrityMismatch => "PLAN_INTEGRITY_MISMATCH",
            Self::ContinuationRequired => "CONTINUATION_REQUIRED",
            Self::ContinuationMismatch => "CONTINUATION_MISMATCH",
            Self::ContinuationExpired => "CONTINUATION_EXPIRED",
            Self::ContinuationNotFound => "CONTINUATION_NOT_FOUND",
            Self::ApprovalMismatch => "APPROVAL_MISMATCH",
            Self::FingerprintMismatch => "ROOT_FINGERPRINT_MISMATCH",
            Self::Unavailable => "PREPARED_RUNTIME_UNAVAILABLE",
            Self::Plan(_) => "INVALID_PLAN",
            Self::Executor(error) => error.code(),
            Self::Backup(_) => "BACKUP_FAILED",
            Self::Artifact(_) => "PREPARED_ARTIFACT_UNAVAILABLE",
        }
    }
}

impl std::fmt::Display for PreparedRenameRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidOperationId => "operation ID is not a versioned identifier",
            Self::InvalidPlanId => "plan ID is not a versioned identifier",
            Self::InvalidSnapshotId => "snapshot ID is not a versioned identifier",
            Self::SnapshotNotFound => "prepared rename plan snapshot was not found",
            Self::SnapshotTampered => "prepared rename plan snapshot failed integrity validation",
            Self::SnapshotIncomplete => {
                "prepared journal exists but the durable plan snapshot is missing"
            }
            Self::JournalNotFound => "prepared rename journal was not found",
            Self::JournalMismatch => "prepared rename journal does not match the stored snapshot",
            Self::BackupMismatch => "verified backup does not match the prepared rename snapshot",
            Self::CloneEvidenceUnavailable => "clone baseline evidence is unavailable",
            Self::CloneNotVerified => "clone verification is required before continuation",
            Self::PlanIntegrityMismatch => "prepared rename plan failed integrity validation",
            Self::ContinuationRequired => {
                "process restart requires explicit continuation before apply"
            }
            Self::ContinuationMismatch => "continuation authority does not match this session",
            Self::ContinuationExpired => "continuation authority has expired",
            Self::ContinuationNotFound => "continuation authority has not been issued",
            Self::ApprovalMismatch => {
                "approved operation ID does not match the requested operation"
            }
            Self::FingerprintMismatch => {
                "current root fingerprint does not match the prepared rename transaction"
            }
            Self::Unavailable => "prepared rename runtime is unavailable",
            Self::Plan(error) => return write!(formatter, "{error}"),
            Self::Executor(error) => return write!(formatter, "{error}"),
            Self::Backup(error) => return write!(formatter, "{error}"),
            Self::Artifact(error) => {
                return write!(formatter, "prepared artifact error: {error:?}")
            }
        })
    }
}

impl std::error::Error for PreparedRenameRuntimeError {}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_plan::derive_rename_plan_id;
    use tempfile::TempDir;

    fn sample_plan(root_id: &RootId) -> RenameImpactPlan {
        let destination = RootRelativePath::parse("SET/AUDIO/kick-renamed.wav").unwrap();
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
        plan.id = derive_rename_plan_id(&plan);
        plan
    }

    #[test]
    fn prepared_plan_payload_round_trips() {
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id);
        let payload = PreparedPlanPayload::from_plan(&plan);
        let restored = payload.to_plan().unwrap();
        assert_eq!(restored, plan);
        restored.validate_integrity().unwrap();
    }

    #[test]
    fn rejects_invalid_prepared_plan_artifact_ids() {
        let err = PreparedRenamePlanId::parse("../etc/passwd").unwrap_err();
        assert_eq!(err, LocalArtifactError::InvalidArtifactId);
    }

    #[test]
    fn expired_continuation_authority_is_rejected() {
        use crate::root_registry::{ResolvedRoot, RootCapabilities, RootSession};

        let local = TempDir::new().unwrap();
        let runtime = PreparedRenameRuntime::new(
            local.path().join("MasterOCTa"),
            ExecutorLocalPaths {
                staging_directory: local.path().join("staging"),
                backup_directory: local.path().join("backups"),
                journal_directory: local.path().join("journals"),
            },
            Duration::from_millis(1),
        )
        .unwrap();
        let root_id = RootId::new("root-session-expired").unwrap();
        let operation_id = OperationId::parse(format!("operation:v1:{}", "d".repeat(64))).unwrap();
        let plan_id = PlanId::parse(format!("plan:v1:{}", "e".repeat(64))).unwrap();
        let fingerprint = format!("rootfp:v1:{}", "f".repeat(64));
        let record = ContinuationAuthorityRecord {
            continuation_authority_id: derive_continuation_authority_id(
                &operation_id,
                root_id.as_str(),
                "sha256:deadbeef",
            ),
            operation_id: operation_id.clone(),
            plan_id,
            historical_device_fingerprint: fingerprint.clone(),
            current_root_id: root_id.clone(),
            current_device_fingerprint: fingerprint.clone(),
            clone_baseline_evidence_id: format!("clone-baseline-evidence:v1:{}", "a".repeat(64)),
            backup_snapshot_id: SnapshotId::parse(format!("snapshot:v1:{}", "b".repeat(64)))
                .unwrap(),
            prepared_plan_id: format!("prepared-rename-plan:v1:{}", "c".repeat(64)),
            content_binding: "sha256:deadbeef".to_owned(),
            expires_at: Instant::now(),
        };
        runtime.store_continuation(record.clone()).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        let resolved = ResolvedRoot {
            session: RootSession {
                root_id: root_id.clone(),
                display_name: "fixture".to_owned(),
                device_fingerprint: fingerprint,
                observed_revision: 1,
                expires_in_seconds: 300,
                write_grant_expires_in_seconds: Some(300),
                capabilities: RootCapabilities {
                    read: true,
                    write: true,
                    stable_device_identity: true,
                },
            },
            canonical_path: local.path().to_path_buf(),
        };
        let error = runtime
            .verify_continuation_authority(
                &resolved,
                &operation_id,
                &record.continuation_authority_id,
            )
            .unwrap_err();
        assert!(
            matches!(
                error,
                PreparedRenameRuntimeError::ContinuationExpired
                    | PreparedRenameRuntimeError::ContinuationNotFound
            ),
            "unexpected error: {error:?}"
        );
    }
}
