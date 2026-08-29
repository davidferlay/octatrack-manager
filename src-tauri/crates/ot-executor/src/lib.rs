#![forbid(unsafe_code)]

use fs2::FileExt;
use ot_backup::{recovery_binding_for_plan, BackupError, BackupStore, SnapshotId, VerifiedBackup};
use ot_domain::{ContentHash, RootId, RootRelativePath};
use ot_plan::{ChangePlan, PlanId};
use rustix::fs::{self as descriptor_fs, AtFlags, Mode, OFlags, RenameFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

const JOURNAL_SCHEMA: &str = "masterocta-operation-journal:v3";
const LEGACY_JOURNAL_SCHEMA: &str = "masterocta-operation-journal:v2";
const OPERATION_ID_PREFIX: &str = "operation:v1:";
const RECOVERY_BINDING_PREFIX: &str = "recovery-binding:v1:";
const RECOVERY_AUTHORIZATION_SCHEMA: &str = "masterocta-recovery-authorization:v1";
const RECOVERY_AUTHORIZATION_DIRECTORY: &str = "authorizations";
const UNIDENTIFIED_PARTIAL_FAILURE: &str = "RECOVERY_PRESERVED_UNIDENTIFIED_PARTIAL";
const LEGACY_RECOVERY_BINDING: &str = "legacy-recovery-binding:unavailable";
const LEGACY_RECOVERY_FAILURE: &str = "LEGACY_RECOVERY_UNAUTHENTICATED";
#[cfg(test)]
const STAGING_CLEANUP_FAILURE_SENTINEL: &str = ".masterocta-test-cleanup-failure";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct OperationId(String);

impl OperationId {
    pub fn for_plan(plan: &ChangePlan) -> Self {
        let digest = plan
            .id
            .as_str()
            .strip_prefix("plan:v1:")
            .expect("ChangePlan contains a validated PlanId");
        Self(format!("{OPERATION_ID_PREFIX}{digest}"))
    }

    pub fn parse(value: impl Into<String>) -> Result<Self, ExecutorError> {
        let value = value.into();
        let digest = value
            .strip_prefix(OPERATION_ID_PREFIX)
            .ok_or(ExecutorError::InvalidOperationId)?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ExecutorError::InvalidOperationId);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn file_stem(&self) -> &str {
        self.0
            .strip_prefix(OPERATION_ID_PREFIX)
            .expect("OperationId prefix is generated internally")
    }
}

#[derive(Clone, Debug)]
pub struct ApprovedExecutionRoot {
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub observed_revision: u64,
    pub canonical_path: PathBuf,
    pub write_enabled: bool,
    pub stable_device_identity: bool,
}

pub trait WriteAuthority {
    fn resolve_for_write(&self, root_id: &RootId) -> Result<ApprovedExecutionRoot, AuthorityError>;
}

#[derive(Clone, Debug)]
pub struct ApprovedRecoveryRoot {
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub canonical_path: PathBuf,
    pub stable_device_identity: bool,
}

pub trait RecoveryAuthority {
    fn resolve_for_recovery(
        &self,
        root_id: &RootId,
    ) -> Result<ApprovedRecoveryRoot, AuthorityError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorityError {
    NotApproved,
    Expired,
    Removed,
    Changed,
    ReadOnly,
    UnstableIdentity,
    Unavailable(String),
}

impl fmt::Display for AuthorityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NotApproved => "root is not approved",
            Self::Expired => "write authority expired",
            Self::Removed => "root was removed",
            Self::Changed => "root identity changed",
            Self::ReadOnly => "root is read-only",
            Self::UnstableIdentity => "root does not have a stable device identity",
            Self::Unavailable(_) => "write authority is unavailable",
        })?;
        if let Self::Unavailable(message) = self {
            write!(formatter, ": {message}")?;
        }
        Ok(())
    }
}

impl std::error::Error for AuthorityError {}

#[derive(Clone, Debug)]
pub struct ExecutorLocalPaths {
    pub staging_directory: PathBuf,
    pub backup_directory: PathBuf,
    pub journal_directory: PathBuf,
}

struct DestinationTarget {
    parent: File,
    file_name: String,
    temporary_name: String,
    published_quarantine_name: String,
    temporary_quarantine_name: String,
}

struct MediaDestination {
    target: DestinationTarget,
    file: File,
    identity: JournalFileIdentity,
    expected_byte_size: u64,
    expected_content_hash: ContentHash,
    published: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecoveryDisposition {
    Cleared,
    PreservedUnidentifiedPartial,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalStatus {
    Prepared,
    Applying,
    Verifying,
    Committed,
    RolledBack,
    Abandoned,
    RecoveryRequired,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct JournalFileIdentity {
    pub device: u64,
    pub inode: u64,
    pub byte_size: u64,
    pub modified_seconds: i64,
    pub modified_nanoseconds: i64,
    pub changed_seconds: i64,
    pub changed_nanoseconds: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OperationJournal {
    pub schema: String,
    pub operation_id: String,
    pub plan_id: String,
    pub root_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub backup_snapshot_id: String,
    pub recovery_binding: String,
    pub destination_file_identity: Option<JournalFileIdentity>,
    pub status: JournalStatus,
    pub failure_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct RecoveryAuthorization {
    schema: String,
    operation_id: String,
    plan_id: String,
    root_fingerprint: String,
    base_observed_revision: u64,
    source_relative_path: String,
    destination_relative_path: String,
    backup_snapshot_id: String,
    recovery_binding: String,
    source_byte_size: u64,
    source_content_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum LegacyJournalStatus {
    Prepared,
    Applying,
    Verifying,
    Committed,
    RolledBack,
    RecoveryRequired,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
struct LegacyOperationJournal {
    schema: String,
    operation_id: String,
    plan_id: String,
    root_fingerprint: String,
    base_observed_revision: u64,
    source_relative_path: String,
    destination_relative_path: String,
    backup_snapshot_id: String,
    destination_file_identity: Option<JournalFileIdentity>,
    status: LegacyJournalStatus,
    failure_code: Option<String>,
}

impl LegacyOperationJournal {
    fn into_safe_journal(self) -> OperationJournal {
        let (status, failure_code) = match self.status {
            LegacyJournalStatus::Committed => (JournalStatus::Committed, self.failure_code),
            LegacyJournalStatus::RolledBack => (JournalStatus::RolledBack, self.failure_code),
            LegacyJournalStatus::Prepared
            | LegacyJournalStatus::Applying
            | LegacyJournalStatus::Verifying
            | LegacyJournalStatus::RecoveryRequired => (
                JournalStatus::Abandoned,
                Some(LEGACY_RECOVERY_FAILURE.to_owned()),
            ),
        };
        OperationJournal {
            schema: self.schema,
            operation_id: self.operation_id,
            plan_id: self.plan_id,
            root_fingerprint: self.root_fingerprint,
            base_observed_revision: self.base_observed_revision,
            source_relative_path: self.source_relative_path,
            destination_relative_path: self.destination_relative_path,
            backup_snapshot_id: self.backup_snapshot_id,
            recovery_binding: LEGACY_RECOVERY_BINDING.to_owned(),
            destination_file_identity: self.destination_file_identity,
            status,
            failure_code,
        }
    }
}

#[derive(Debug)]
pub struct ExecutionResult {
    pub operation_id: OperationId,
    pub backup: VerifiedBackup,
    pub journal: OperationJournal,
    pub local_cleanup_complete: bool,
}

pub struct AdditiveCopyExecutor {
    local_paths: ExecutorLocalPaths,
}

impl AdditiveCopyExecutor {
    pub fn new(local_paths: ExecutorLocalPaths) -> Self {
        Self { local_paths }
    }

    pub fn execute<A: WriteAuthority>(
        &self,
        plan: &ChangePlan,
        authority: &A,
    ) -> Result<ExecutionResult, ExecutorError> {
        self.execute_internal(plan, authority, None, false)
    }

    pub fn recover_incomplete<A: WriteAuthority>(
        &self,
        plan: &ChangePlan,
        authority: &A,
    ) -> Result<OperationJournal, ExecutorError> {
        validate_plan_shape(plan)?;
        let operation_id = OperationId::for_plan(plan);
        let root = validate_authority(plan, authority.resolve_for_write(&plan.root_id)?)?;
        let journal_directory =
            prepare_local_directory(&self.local_paths.journal_directory, &root.canonical_path)?;
        let _lock = acquire_root_lock(&journal_directory, &plan.device_fingerprint)?;
        let journal_path = journal_path(&journal_directory, &operation_id);
        let mut journal = read_journal(&journal_path)?;
        validate_journal(&journal, plan, &operation_id)?;
        match journal.status {
            JournalStatus::Committed | JournalStatus::RolledBack | JournalStatus::Abandoned => {
                return Err(ExecutorError::PlanConsumed);
            }
            JournalStatus::RecoveryRequired
            | JournalStatus::Prepared
            | JournalStatus::Applying
            | JournalStatus::Verifying => {}
        }

        let authorization_directory =
            prepare_recovery_authorization_directory(&journal_directory)?;
        let authorization = read_recovery_authorization(
            &recovery_authorization_path(&authorization_directory, &operation_id),
            &operation_id,
        )?;
        validate_recovery_authorization_for_plan(&authorization, plan, &operation_id)?;

        let staging_directory =
            prepare_local_directory(&self.local_paths.staging_directory, &root.canonical_path)?;
        validate_staging_cleanup_target(&staging_directory, &operation_id)?;

        let target = open_destination_target(
            &root.canonical_path,
            &plan.operation.destination_relative_path,
            &operation_id,
        )?;
        let recovery = match recover_media_destination(&target, &journal, plan) {
            Ok(recovery) => recovery,
            Err(error) => {
                journal.status = JournalStatus::RecoveryRequired;
                journal.failure_code = Some("DESTINATION_CHANGED".into());
                write_journal(&journal_path, &journal)?;
                return Err(error);
            }
        };
        match recovery {
            RecoveryDisposition::Cleared => {
                journal.status = JournalStatus::RolledBack;
                journal.failure_code = Some("RECOVERED_INCOMPLETE_OPERATION".into());
            }
            RecoveryDisposition::PreservedUnidentifiedPartial => {
                journal.status = JournalStatus::Abandoned;
                journal.failure_code = Some(UNIDENTIFIED_PARTIAL_FAILURE.into());
            }
        }
        write_journal(&journal_path, &journal)?;
        cleanup_staging(&staging_directory, &operation_id)?;
        Ok(journal)
    }

    pub fn recover_incomplete_operation<A: RecoveryAuthority>(
        &self,
        root_id: &RootId,
        operation_id: &OperationId,
        authority: &A,
    ) -> Result<OperationJournal, ExecutorError> {
        let initial_root = authority
            .resolve_for_recovery(root_id)
            .map_err(ExecutorError::Authority)?;
        let initial_root = validate_recovery_authority(root_id, initial_root)?;
        let journal_directory = prepare_local_directory(
            &self.local_paths.journal_directory,
            &initial_root.canonical_path,
        )?;
        let _lock = acquire_root_lock(&journal_directory, &initial_root.device_fingerprint)?;
        let locked_root = revalidate_recovery_authority(root_id, &initial_root, authority)?;
        let journal_path = journal_path(&journal_directory, operation_id);
        let mut journal = read_journal(&journal_path)?;
        validate_standalone_journal(&journal, operation_id, &journal_path)?;
        if journal.root_fingerprint != locked_root.device_fingerprint {
            return Err(ExecutorError::RootChanged);
        }
        match journal.status {
            JournalStatus::Committed | JournalStatus::RolledBack | JournalStatus::Abandoned => {
                return Err(ExecutorError::PlanConsumed);
            }
            JournalStatus::RecoveryRequired
            | JournalStatus::Prepared
            | JournalStatus::Applying
            | JournalStatus::Verifying => {}
        }

        let authorization_directory =
            prepare_recovery_authorization_directory(&journal_directory)?;
        let authorization = read_recovery_authorization(
            &recovery_authorization_path(&authorization_directory, operation_id),
            operation_id,
        )?;

        let backup_directory = prepare_local_directory(
            &self.local_paths.backup_directory,
            &locked_root.canonical_path,
        )?;
        let staging_directory = prepare_local_directory(
            &self.local_paths.staging_directory,
            &locked_root.canonical_path,
        )?;
        validate_staging_cleanup_target(&staging_directory, operation_id)?;
        let snapshot_id =
            SnapshotId::parse(journal.backup_snapshot_id.clone()).map_err(ExecutorError::Backup)?;
        let backup = BackupStore::new(backup_directory)
            .verify(&snapshot_id)
            .map_err(ExecutorError::Backup)?;
        let (expected_size, expected_hash) = validate_recovery_backup(
            &backup,
            &journal,
            &authorization,
            operation_id,
        )?;
        let current_root = revalidate_recovery_authority(root_id, &locked_root, authority)?;
        let destination = RootRelativePath::parse(&journal.destination_relative_path)
            .map_err(|_| ExecutorError::InvalidJournal)?;
        let target =
            open_destination_target(&current_root.canonical_path, &destination, operation_id)?;
        let recovery = match recover_media_destination_matching(
            &target,
            &journal,
            expected_size,
            &expected_hash,
        ) {
            Ok(recovery) => recovery,
            Err(error) => {
                journal.status = JournalStatus::RecoveryRequired;
                journal.failure_code = Some("DESTINATION_CHANGED".into());
                write_journal(&journal_path, &journal)?;
                return Err(error);
            }
        };
        match recovery {
            RecoveryDisposition::Cleared => {
                journal.status = JournalStatus::RolledBack;
                journal.failure_code = Some("RECOVERED_INCOMPLETE_OPERATION".into());
            }
            RecoveryDisposition::PreservedUnidentifiedPartial => {
                journal.status = JournalStatus::Abandoned;
                journal.failure_code = Some(UNIDENTIFIED_PARTIAL_FAILURE.into());
            }
        }
        write_journal(&journal_path, &journal)?;
        cleanup_staging(&staging_directory, operation_id)?;
        Ok(journal)
    }

    pub fn operation_journal(
        &self,
        operation_id: &OperationId,
    ) -> Result<Option<OperationJournal>, ExecutorError> {
        let directory = &self.local_paths.journal_directory;
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(ExecutorError::io(error)),
        }
        let path = journal_path(directory, operation_id);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(ExecutorError::io(error)),
        }
        let journal = read_journal(&path)?;
        validate_standalone_journal(&journal, operation_id, &path)?;
        Ok(Some(journal))
    }

    pub fn incomplete_journals_for_root(
        &self,
        root_fingerprint: &str,
    ) -> Result<Vec<OperationJournal>, ExecutorError> {
        validate_root_fingerprint(root_fingerprint)?;
        let directory = &self.local_paths.journal_directory;
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(ExecutorError::io(error)),
        }

        let mut journals = Vec::new();
        for entry in fs::read_dir(directory).map_err(ExecutorError::io)? {
            let entry = entry.map_err(ExecutorError::io)?;
            let file_type = entry.file_type().map_err(ExecutorError::io)?;
            let name = entry.file_name();
            let name = name.to_str();
            if name == Some("locks") || name == Some(RECOVERY_AUTHORIZATION_DIRECTORY) {
                if file_type.is_symlink() || !file_type.is_dir() {
                    return Err(ExecutorError::UnsafePath);
                }
                continue;
            }
            if file_type.is_symlink()
                || !file_type.is_file()
                || entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    != Some("json")
            {
                return Err(ExecutorError::InvalidJournal);
            }
            let journal = read_journal(&entry.path())?;
            let operation_id = OperationId::parse(journal.operation_id.clone())?;
            validate_standalone_journal(&journal, &operation_id, &entry.path())?;
            if journal.root_fingerprint == root_fingerprint
                && !matches!(
                    journal.status,
                    JournalStatus::Committed | JournalStatus::RolledBack | JournalStatus::Abandoned
                )
            {
                journals.push(journal);
            }
        }
        journals.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
        Ok(journals)
    }

    fn execute_internal<A: WriteAuthority>(
        &self,
        plan: &ChangePlan,
        authority: &A,
        fault: Option<FaultPoint>,
        simulate_crash: bool,
    ) -> Result<ExecutionResult, ExecutorError> {
        validate_plan_shape(plan)?;
        if !plan.operation.destination_must_be_absent {
            return Err(ExecutorError::OverwriteForbidden);
        }
        let operation_id = OperationId::for_plan(plan);
        let initial_root = validate_authority(plan, authority.resolve_for_write(&plan.root_id)?)?;
        let staging_base = prepare_local_directory(
            &self.local_paths.staging_directory,
            &initial_root.canonical_path,
        )?;
        let journal_directory = prepare_local_directory(
            &self.local_paths.journal_directory,
            &initial_root.canonical_path,
        )?;
        let backup_directory = prepare_local_directory(
            &self.local_paths.backup_directory,
            &initial_root.canonical_path,
        )?;
        let _lock = acquire_root_lock(&journal_directory, &plan.device_fingerprint)?;
        let authorization_directory =
            prepare_recovery_authorization_directory(&journal_directory)?;
        let journal_path = journal_path(&journal_directory, &operation_id);
        if journal_path.exists() {
            let journal = read_journal(&journal_path)?;
            return Err(match journal.status {
                JournalStatus::Committed | JournalStatus::RolledBack | JournalStatus::Abandoned => {
                    ExecutorError::PlanConsumed
                }
                _ => ExecutorError::RecoveryRequired,
            });
        }

        verify_source_in_root(
            &initial_root.canonical_path,
            &plan.operation.source.relative_path,
            plan,
        )?;
        let initial_destination = open_destination_target(
            &initial_root.canonical_path,
            &plan.operation.destination_relative_path,
            &operation_id,
        )?;
        ensure_destination_target_absent(&initial_destination)?;
        drop(initial_destination);

        let staging_directory = staging_base.join(operation_id.file_stem());
        fs::create_dir(&staging_directory).map_err(ExecutorError::io)?;
        let staged_payload = staging_directory.join("payload");
        if let Err(error) = copy_source_to_staging(
            &initial_root.canonical_path,
            &plan.operation.source.relative_path,
            &staged_payload,
            plan,
        ) {
            let _ = fs::remove_dir_all(&staging_directory);
            return Err(error);
        }
        sync_directory(&staging_directory)?;

        let authorization = match ensure_recovery_authorization(
            &authorization_directory,
            plan,
            &operation_id,
        ) {
            Ok(authorization) => authorization,
            Err(error) => {
                let _ = fs::remove_dir_all(&staging_directory);
                return Err(error);
            }
        };

        let backup_store = BackupStore::new(backup_directory);
        let backup = match backup_store.create_verified(&initial_root.canonical_path, plan) {
            Ok(backup) => backup,
            Err(BackupError::SnapshotExists) => backup_store
                .verify_for_plan(plan)
                .map_err(ExecutorError::Backup)?,
            Err(error) => {
                let _ = fs::remove_dir_all(&staging_directory);
                return Err(ExecutorError::Backup(error));
            }
        };
        if backup.manifest().recovery_binding != authorization.recovery_binding {
            let _ = fs::remove_dir_all(&staging_directory);
            return Err(ExecutorError::InvalidJournal);
        }
        let mut journal = new_journal(plan, &operation_id, &backup);
        if let Err(error) = write_journal(&journal_path, &journal) {
            let _ = cleanup_staging(&staging_base, &operation_id);
            return Err(error);
        }

        if fault == Some(FaultPoint::Prepared) {
            if simulate_crash {
                return Err(ExecutorError::SimulatedCrash);
            }
            return self.fail_before_apply(
                ExecutorError::InjectedFault("after_prepared"),
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        let current_root = match authority
            .resolve_for_write(&plan.root_id)
            .map_err(ExecutorError::Authority)
            .and_then(|root| validate_authority(plan, root))
        {
            Ok(root) => root,
            Err(error) => {
                return self.fail_before_apply(
                    error,
                    &staging_base,
                    &operation_id,
                    &journal_path,
                    journal,
                );
            }
        };
        if current_root.canonical_path != initial_root.canonical_path {
            return self.fail_before_apply(
                ExecutorError::RootChanged,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) = verify_source_in_root(
            &current_root.canonical_path,
            &plan.operation.source.relative_path,
            plan,
        ) {
            return self.fail_before_apply(
                error,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        let destination_target = match open_destination_target(
            &current_root.canonical_path,
            &plan.operation.destination_relative_path,
            &operation_id,
        ) {
            Ok(target) => target,
            Err(error) => {
                return self.fail_before_apply(
                    error,
                    &staging_base,
                    &operation_id,
                    &journal_path,
                    journal,
                );
            }
        };
        if let Err(error) = ensure_destination_target_absent(&destination_target) {
            return self.fail_before_apply(
                error,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) =
            ensure_root_capacity(&destination_target.parent, plan.estimated_additional_bytes)
        {
            return self.fail_before_apply(
                error,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        journal.status = JournalStatus::Applying;
        write_journal(&journal_path, &journal)?;
        let mut media_destination = match create_media_destination(destination_target, plan) {
            Ok(destination) => destination,
            Err(error) => {
                return self.fail_before_apply(
                    error,
                    &staging_base,
                    &operation_id,
                    &journal_path,
                    journal,
                );
            }
        };
        if fault == Some(FaultPoint::DestinationCreated) {
            if simulate_crash {
                return Err(ExecutorError::SimulatedCrash);
            }
            return self.fail_after_apply(
                ExecutorError::InjectedFault("after_destination_create"),
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) =
            checkpoint_media_destination(&mut media_destination, &mut journal, &journal_path)
        {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        if fault == Some(FaultPoint::DestinationPartialWrite) {
            let mut failure =
                write_partial_media_payload(&staged_payload, &mut media_destination.file).err();
            if let Err(error) =
                checkpoint_media_destination(&mut media_destination, &mut journal, &journal_path)
            {
                failure.get_or_insert(error);
            }
            if simulate_crash {
                if let Some(error) = failure {
                    return Err(error);
                }
                return Err(ExecutorError::SimulatedCrash);
            }
            let error = failure.unwrap_or(ExecutorError::InjectedFault("during_destination_write"));
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        if let Err(copy_error) =
            copy_payload_to_media(&staged_payload, &mut media_destination.file, plan)
        {
            let error =
                checkpoint_media_destination(&mut media_destination, &mut journal, &journal_path)
                    .err()
                    .unwrap_or(copy_error);
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) =
            checkpoint_media_destination(&mut media_destination, &mut journal, &journal_path)
        {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(publish_error) = publish_media_destination(&mut media_destination) {
            let error = if media_destination.published {
                checkpoint_media_destination(&mut media_destination, &mut journal, &journal_path)
                    .err()
                    .unwrap_or(publish_error)
            } else {
                publish_error
            };
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if fault == Some(FaultPoint::DestinationPublished) {
            if simulate_crash {
                return Err(ExecutorError::SimulatedCrash);
            }
            return self.fail_after_apply(
                ExecutorError::InjectedFault("after_destination_publish"),
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) =
            checkpoint_media_destination(&mut media_destination, &mut journal, &journal_path)
        {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        if fault == Some(FaultPoint::DestinationWrite) {
            if simulate_crash {
                return Err(ExecutorError::SimulatedCrash);
            }
            return self.fail_after_apply(
                ExecutorError::InjectedFault("after_destination_write"),
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        journal.status = JournalStatus::Verifying;
        if let Err(error) = write_journal(&journal_path, &journal) {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        let final_root = match authority.resolve_for_write(&plan.root_id) {
            Ok(root) => validate_authority(plan, root),
            Err(error) => Err(ExecutorError::Authority(error)),
        };
        let final_root = match final_root {
            Ok(root) if root.canonical_path == initial_root.canonical_path => root,
            Ok(_) => {
                return self.fail_after_apply(
                    ExecutorError::RootChanged,
                    &media_destination,
                    &staging_base,
                    &operation_id,
                    &journal_path,
                    journal,
                );
            }
            Err(error) => {
                return self.fail_after_apply(
                    error,
                    &media_destination,
                    &staging_base,
                    &operation_id,
                    &journal_path,
                    journal,
                );
            }
        };
        debug_assert_eq!(final_root.canonical_path, initial_root.canonical_path);
        if let Err(error) = verify_source_in_root(
            &final_root.canonical_path,
            &plan.operation.source.relative_path,
            plan,
        ) {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) = verify_published_media_destination(
            &final_root.canonical_path,
            &plan.operation.destination_relative_path,
            &operation_id,
            &media_destination,
            plan,
        ) {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        if fault == Some(FaultPoint::Verification) {
            if simulate_crash {
                return Err(ExecutorError::SimulatedCrash);
            }
            return self.fail_after_apply(
                ExecutorError::InjectedFault("after_verification"),
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }

        let mut committed_journal = journal.clone();
        committed_journal.status = JournalStatus::Committed;
        committed_journal.failure_code = None;
        if let Err(error) = write_journal(&journal_path, &committed_journal) {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        if let Err(error) = verify_published_media_destination(
            &final_root.canonical_path,
            &plan.operation.destination_relative_path,
            &operation_id,
            &media_destination,
            plan,
        ) {
            return self.fail_after_apply(
                error,
                &media_destination,
                &staging_base,
                &operation_id,
                &journal_path,
                journal,
            );
        }
        journal = committed_journal;
        let local_cleanup_complete = cleanup_staging(&staging_base, &operation_id).is_ok();
        Ok(ExecutionResult {
            operation_id,
            backup,
            journal,
            local_cleanup_complete,
        })
    }

    fn fail_before_apply(
        &self,
        error: ExecutorError,
        staging_base: &Path,
        operation_id: &OperationId,
        journal_path: &Path,
        mut journal: OperationJournal,
    ) -> Result<ExecutionResult, ExecutorError> {
        journal.status = JournalStatus::RolledBack;
        journal.failure_code = Some(error.code().into());
        write_journal(journal_path, &journal)?;
        cleanup_staging(staging_base, operation_id)?;
        Err(error)
    }

    #[allow(clippy::too_many_arguments)]
    fn fail_after_apply(
        &self,
        error: ExecutorError,
        destination: &MediaDestination,
        staging_base: &Path,
        operation_id: &OperationId,
        journal_path: &Path,
        mut journal: OperationJournal,
    ) -> Result<ExecutionResult, ExecutorError> {
        if rollback_media_destination(destination).is_err() {
            journal.status = JournalStatus::RecoveryRequired;
            journal.failure_code = Some("ROLLBACK_DESTINATION_CHANGED".into());
            write_journal(journal_path, &journal)?;
            return Err(ExecutorError::RecoveryRequired);
        }
        journal.status = JournalStatus::RolledBack;
        journal.failure_code = Some(error.code().into());
        write_journal(journal_path, &journal)?;
        cleanup_staging(staging_base, operation_id)?;
        Err(error)
    }

    #[cfg(test)]
    fn execute_with_fault<A: WriteAuthority>(
        &self,
        plan: &ChangePlan,
        authority: &A,
        fault: FaultPoint,
        simulate_crash: bool,
    ) -> Result<ExecutionResult, ExecutorError> {
        self.execute_internal(plan, authority, Some(fault), simulate_crash)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FaultPoint {
    Prepared,
    DestinationCreated,
    DestinationPartialWrite,
    DestinationWrite,
    DestinationPublished,
    Verification,
}

fn validate_plan_shape(plan: &ChangePlan) -> Result<(), ExecutorError> {
    plan.validate_integrity()
        .map_err(|_| ExecutorError::InvalidPlan)?;
    validate_root_fingerprint(&plan.device_fingerprint).map_err(|_| ExecutorError::InvalidPlan)?;
    if plan.base_observed_revision == 0
        || plan.operation.source.relative_path == plan.operation.destination_relative_path
        || plan.estimated_additional_bytes != plan.operation.source.byte_size
        || plan.backup_relative_paths.len() != 1
        || plan.backup_relative_paths.first() != Some(&plan.operation.source.relative_path)
    {
        return Err(ExecutorError::InvalidPlan);
    }
    if !plan.operation.destination_must_be_absent {
        return Err(ExecutorError::OverwriteForbidden);
    }
    Ok(())
}

fn validate_authority(
    plan: &ChangePlan,
    root: ApprovedExecutionRoot,
) -> Result<ApprovedExecutionRoot, ExecutorError> {
    if root.root_id != plan.root_id
        || root.device_fingerprint != plan.device_fingerprint
        || root.observed_revision != plan.base_observed_revision
    {
        return Err(ExecutorError::RootChanged);
    }
    if !root.write_enabled {
        return Err(ExecutorError::Authority(AuthorityError::ReadOnly));
    }
    if !root.stable_device_identity {
        return Err(ExecutorError::Authority(AuthorityError::UnstableIdentity));
    }
    validate_canonical_root(&root.canonical_path)?;
    Ok(root)
}

fn validate_recovery_authority(
    root_id: &RootId,
    root: ApprovedRecoveryRoot,
) -> Result<ApprovedRecoveryRoot, ExecutorError> {
    if &root.root_id != root_id {
        return Err(ExecutorError::RootChanged);
    }
    validate_root_fingerprint(&root.device_fingerprint).map_err(|_| ExecutorError::RootChanged)?;
    if !root.stable_device_identity {
        return Err(ExecutorError::Authority(AuthorityError::UnstableIdentity));
    }
    validate_canonical_root(&root.canonical_path)?;
    Ok(root)
}

fn revalidate_recovery_authority<A: RecoveryAuthority>(
    root_id: &RootId,
    expected: &ApprovedRecoveryRoot,
    authority: &A,
) -> Result<ApprovedRecoveryRoot, ExecutorError> {
    let current = authority
        .resolve_for_recovery(root_id)
        .map_err(ExecutorError::Authority)?;
    let current = validate_recovery_authority(root_id, current)?;
    if current.root_id != expected.root_id
        || current.device_fingerprint != expected.device_fingerprint
        || current.canonical_path != expected.canonical_path
    {
        return Err(ExecutorError::RootChanged);
    }
    Ok(current)
}

fn validate_canonical_root(canonical_path: &Path) -> Result<(), ExecutorError> {
    let metadata = fs::symlink_metadata(canonical_path).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutorError::UnsafePath);
    }
    let canonical = canonical_path.canonicalize().map_err(ExecutorError::io)?;
    if canonical != canonical_path {
        return Err(ExecutorError::UnsafePath);
    }
    Ok(())
}

fn prepare_local_directory(path: &Path, root: &Path) -> Result<PathBuf, ExecutorError> {
    reject_local_target_inside_root(path, root)?;
    fs::create_dir_all(path).map_err(ExecutorError::io)?;
    let metadata = fs::symlink_metadata(path).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutorError::UnsafePath);
    }
    let canonical = path.canonicalize().map_err(ExecutorError::io)?;
    if canonical.starts_with(root) {
        return Err(ExecutorError::LocalStateInsideRoot);
    }
    Ok(canonical)
}

fn reject_local_target_inside_root(path: &Path, root: &Path) -> Result<(), ExecutorError> {
    if !path.is_absolute() {
        return Err(ExecutorError::UnsafePath);
    }
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent().ok_or(ExecutorError::UnsafePath)?;
    }
    let canonical_existing = existing.canonicalize().map_err(ExecutorError::io)?;
    let suffix = path
        .strip_prefix(existing)
        .map_err(|_| ExecutorError::UnsafePath)?;
    if canonical_existing.join(suffix).starts_with(root) {
        return Err(ExecutorError::LocalStateInsideRoot);
    }
    Ok(())
}

fn open_root_regular_file(root: &Path, relative: &RootRelativePath) -> Result<File, ExecutorError> {
    let components = relative.as_str().split('/').collect::<Vec<_>>();
    let root = descriptor_fs::open(
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(descriptor_path_error)?;
    let mut parent = File::from(root);
    for component in &components[..components.len() - 1] {
        let child = descriptor_fs::openat(
            &parent,
            *component,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(descriptor_path_error)?;
        parent = File::from(child);
    }
    let file = descriptor_fs::openat(
        &parent,
        *components.last().expect("relative path is non-empty"),
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(descriptor_path_error)?;
    let file = File::from(file);
    if !file.metadata().map_err(ExecutorError::io)?.is_file() {
        return Err(ExecutorError::UnsafePath);
    }
    Ok(file)
}

fn open_destination_target(
    root: &Path,
    relative: &RootRelativePath,
    operation_id: &OperationId,
) -> Result<DestinationTarget, ExecutorError> {
    let components = relative.as_str().split('/').collect::<Vec<_>>();
    let root = descriptor_fs::open(
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(descriptor_path_error)?;
    let mut parent = File::from(root);
    for component in &components[..components.len() - 1] {
        let child = descriptor_fs::openat(
            &parent,
            *component,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(descriptor_path_error)?;
        parent = File::from(child);
    }
    Ok(DestinationTarget {
        parent,
        file_name: components
            .last()
            .expect("relative path is non-empty")
            .to_string(),
        temporary_name: format!(".masterocta-{}.partial", operation_id.file_stem()),
        published_quarantine_name: format!(
            ".masterocta-{}.published.recovery-quarantine",
            operation_id.file_stem()
        ),
        temporary_quarantine_name: format!(
            ".masterocta-{}.partial.recovery-quarantine",
            operation_id.file_stem()
        ),
    })
}

fn descriptor_path_error(error: rustix::io::Errno) -> ExecutorError {
    if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
        ExecutorError::SymlinkEscape
    } else {
        ExecutorError::io(std::io::Error::from(error))
    }
}

fn open_regular_entry(parent: &File, name: &str) -> Result<Option<File>, ExecutorError> {
    match descriptor_fs::openat(
        parent,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(file) => {
            let file = File::from(file);
            if !file.metadata().map_err(ExecutorError::io)?.is_file() {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(Some(file))
        }
        Err(error) if error == rustix::io::Errno::NOENT => Ok(None),
        Err(error) => Err(descriptor_path_error(error)),
    }
}

fn ensure_destination_target_absent(target: &DestinationTarget) -> Result<(), ExecutorError> {
    if open_regular_entry(&target.parent, &target.file_name)?.is_some()
        || open_regular_entry(&target.parent, &target.temporary_name)?.is_some()
        || open_regular_entry(&target.parent, &target.published_quarantine_name)?.is_some()
        || open_regular_entry(&target.parent, &target.temporary_quarantine_name)?.is_some()
    {
        Err(ExecutorError::DestinationExists)
    } else {
        Ok(())
    }
}

fn ensure_root_capacity(parent: &File, required_bytes: u64) -> Result<(), ExecutorError> {
    let status = descriptor_fs::fstatvfs(parent)
        .map_err(|error| ExecutorError::io(std::io::Error::from(error)))?;
    let available_bytes = status.f_bavail.saturating_mul(status.f_frsize);
    if available_bytes < required_bytes {
        Err(ExecutorError::NoSpace)
    } else {
        Ok(())
    }
}

fn file_identity(file: &File) -> Result<JournalFileIdentity, ExecutorError> {
    let metadata = file.metadata().map_err(ExecutorError::io)?;
    let identity = JournalFileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        byte_size: metadata.len(),
        modified_seconds: metadata.mtime(),
        modified_nanoseconds: metadata.mtime_nsec(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    };
    if identity.inode == 0 {
        return Err(ExecutorError::UnsafePath);
    }
    Ok(identity)
}

fn checkpoint_media_destination(
    destination: &mut MediaDestination,
    journal: &mut OperationJournal,
    journal_path: &Path,
) -> Result<(), ExecutorError> {
    destination.identity = file_identity(&destination.file)?;
    journal.destination_file_identity = Some(destination.identity.clone());
    write_journal(journal_path, journal)
}

fn create_media_destination(
    target: DestinationTarget,
    plan: &ChangePlan,
) -> Result<MediaDestination, ExecutorError> {
    let file = descriptor_fs::openat(
        &target.parent,
        target.temporary_name.as_str(),
        OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR | Mode::RGRP | Mode::ROTH,
    )
    .map_err(|error| {
        if error == rustix::io::Errno::EXIST {
            ExecutorError::DestinationExists
        } else {
            descriptor_path_error(error)
        }
    })?;
    let file = File::from(file);
    let identity = match file_identity(&file) {
        Ok(identity) => identity,
        Err(error) => {
            drop(file);
            let _ = descriptor_fs::unlinkat(
                &target.parent,
                target.temporary_name.as_str(),
                AtFlags::empty(),
            );
            let _ = target.parent.sync_all();
            return Err(error);
        }
    };
    Ok(MediaDestination {
        target,
        file,
        identity,
        expected_byte_size: plan.operation.source.byte_size,
        expected_content_hash: plan.operation.source.content_hash.clone(),
        published: false,
    })
}

fn write_partial_media_payload(source: &Path, destination: &mut File) -> Result<(), ExecutorError> {
    let mut source = File::open(source).map_err(ExecutorError::io)?;
    let mut buffer = [0_u8; 64 * 1024];
    let read = source.read(&mut buffer).map_err(ExecutorError::io)?;
    if read > 0 {
        destination
            .write_all(&buffer[..read.div_ceil(2)])
            .map_err(ExecutorError::io)?;
    }
    destination.sync_all().map_err(ExecutorError::io)
}

fn copy_payload_to_media(
    source: &Path,
    destination: &mut File,
    plan: &ChangePlan,
) -> Result<(), ExecutorError> {
    let mut source = File::open(source).map_err(ExecutorError::io)?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source.read(&mut buffer).map_err(ExecutorError::io)?;
        if read == 0 {
            break;
        }
        destination
            .write_all(&buffer[..read])
            .map_err(ExecutorError::io)?;
    }
    destination.sync_all().map_err(ExecutorError::io)?;
    verify_open_file(destination, plan)
}

fn verify_open_file(file: &mut File, plan: &ChangePlan) -> Result<(), ExecutorError> {
    verify_open_file_matching(
        file,
        plan.operation.source.byte_size,
        &plan.operation.source.content_hash,
    )
}

fn verify_open_file_matching(
    file: &mut File,
    expected_size: u64,
    expected_hash: &ContentHash,
) -> Result<(), ExecutorError> {
    file.seek(SeekFrom::Start(0)).map_err(ExecutorError::io)?;
    let (size, hash) = hash_reader(file)?;
    if size == expected_size && &hash == expected_hash {
        Ok(())
    } else {
        Err(ExecutorError::PostWriteVerificationFailed)
    }
}

fn publish_media_destination(destination: &mut MediaDestination) -> Result<(), ExecutorError> {
    descriptor_fs::renameat_with(
        &destination.target.parent,
        destination.target.temporary_name.as_str(),
        &destination.target.parent,
        destination.target.file_name.as_str(),
        RenameFlags::NOREPLACE,
    )
    .map_err(|error| {
        if error == rustix::io::Errno::EXIST {
            ExecutorError::DestinationExists
        } else {
            descriptor_path_error(error)
        }
    })?;
    destination.published = true;
    destination
        .target
        .parent
        .sync_all()
        .map_err(ExecutorError::io)
}

fn same_file_identity(file: &File, expected: &JournalFileIdentity) -> Result<bool, ExecutorError> {
    Ok(file_identity(file)? == *expected)
}

fn recovery_identity_matches(actual: &JournalFileIdentity, expected: &JournalFileIdentity) -> bool {
    actual.device == expected.device
        && actual.inode == expected.inode
        && actual.byte_size == expected.byte_size
        && actual.modified_seconds == expected.modified_seconds
        && actual.modified_nanoseconds == expected.modified_nanoseconds
}

fn same_recovery_file_identity(
    file: &File,
    expected: &JournalFileIdentity,
) -> Result<bool, ExecutorError> {
    Ok(recovery_identity_matches(&file_identity(file)?, expected))
}

fn same_open_directory(left: &File, right: &File) -> Result<bool, ExecutorError> {
    Ok(file_identity(left)? == file_identity(right)?)
}

fn rollback_media_destination(destination: &MediaDestination) -> Result<(), ExecutorError> {
    let (name, quarantine_name) = if destination.published {
        (
            &destination.target.file_name,
            &destination.target.published_quarantine_name,
        )
    } else {
        (
            &destination.target.temporary_name,
            &destination.target.temporary_quarantine_name,
        )
    };
    if let Some(mut current) = open_regular_entry(&destination.target.parent, name)? {
        let identity_matches = if destination.published {
            same_recovery_file_identity(&current, &destination.identity)?
        } else {
            same_file_identity(&current, &destination.identity)?
        };
        if !identity_matches {
            return Err(ExecutorError::RecoveryRequired);
        }
        let expected_content = destination.published.then_some((
            destination.expected_byte_size,
            &destination.expected_content_hash,
        ));
        quarantine_and_remove_entry(
            &destination.target.parent,
            name,
            name,
            quarantine_name,
            &mut current,
            &destination.identity,
            expected_content,
            false,
            !destination.published,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn quarantine_and_remove_entry(
    parent: &File,
    entry_name: &str,
    original_name: &str,
    quarantine_name: &str,
    opened_file: &mut File,
    expected_identity: &JournalFileIdentity,
    expected_content: Option<(u64, &ContentHash)>,
    already_quarantined: bool,
    require_strict_open_identity: bool,
) -> Result<(), ExecutorError> {
    let opened_identity = file_identity(opened_file)?;
    let identity_matches = if require_strict_open_identity {
        opened_identity == *expected_identity
    } else {
        recovery_identity_matches(&opened_identity, expected_identity)
    };
    if !identity_matches {
        return Err(ExecutorError::RecoveryRequired);
    }
    if let Some((expected_size, expected_hash)) = expected_content {
        if verify_open_file_matching(opened_file, expected_size, expected_hash).is_err() {
            return Err(ExecutorError::RecoveryRequired);
        }
    }

    if !already_quarantined {
        descriptor_fs::renameat_with(
            parent,
            entry_name,
            parent,
            quarantine_name,
            RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            if matches!(error, rustix::io::Errno::EXIST | rustix::io::Errno::NOENT) {
                ExecutorError::RecoveryRequired
            } else {
                descriptor_path_error(error)
            }
        })?;
        parent.sync_all().map_err(ExecutorError::io)?;
    }

    let verification = (|| {
        let mut quarantined =
            open_regular_entry(parent, quarantine_name)?.ok_or(ExecutorError::RecoveryRequired)?;
        let quarantined_identity = file_identity(&quarantined)?;
        if !recovery_identity_matches(&quarantined_identity, expected_identity)
            || !recovery_identity_matches(&quarantined_identity, &opened_identity)
        {
            return Err(ExecutorError::RecoveryRequired);
        }
        if let Some((expected_size, expected_hash)) = expected_content {
            verify_open_file_matching(&mut quarantined, expected_size, expected_hash)?;
        }
        Ok(())
    })();
    if verification.is_err() {
        if !already_quarantined {
            restore_quarantined_entry(parent, quarantine_name, original_name)?;
        }
        return Err(ExecutorError::RecoveryRequired);
    }

    descriptor_fs::unlinkat(parent, quarantine_name, AtFlags::empty())
        .map_err(|error| ExecutorError::io(std::io::Error::from(error)))?;
    parent.sync_all().map_err(ExecutorError::io)
}

fn restore_quarantined_entry(
    parent: &File,
    quarantine_name: &str,
    original_name: &str,
) -> Result<(), ExecutorError> {
    match descriptor_fs::renameat_with(
        parent,
        quarantine_name,
        parent,
        original_name,
        RenameFlags::NOREPLACE,
    ) {
        Ok(()) => parent.sync_all().map_err(ExecutorError::io),
        Err(rustix::io::Errno::EXIST | rustix::io::Errno::NOENT) => Ok(()),
        Err(error) => Err(descriptor_path_error(error)),
    }
}

fn recover_media_destination(
    target: &DestinationTarget,
    journal: &OperationJournal,
    plan: &ChangePlan,
) -> Result<RecoveryDisposition, ExecutorError> {
    recover_media_destination_matching(
        target,
        journal,
        plan.operation.source.byte_size,
        &plan.operation.source.content_hash,
    )
}

fn recover_media_destination_matching(
    target: &DestinationTarget,
    journal: &OperationJournal,
    expected_size: u64,
    expected_hash: &ContentHash,
) -> Result<RecoveryDisposition, ExecutorError> {
    let mut candidates = Vec::new();
    for (entry_name, original_name, quarantine_name, published, already_quarantined) in [
        (
            target.file_name.as_str(),
            target.file_name.as_str(),
            target.published_quarantine_name.as_str(),
            true,
            false,
        ),
        (
            target.temporary_name.as_str(),
            target.temporary_name.as_str(),
            target.temporary_quarantine_name.as_str(),
            false,
            false,
        ),
        (
            target.published_quarantine_name.as_str(),
            target.file_name.as_str(),
            target.published_quarantine_name.as_str(),
            true,
            true,
        ),
        (
            target.temporary_quarantine_name.as_str(),
            target.temporary_name.as_str(),
            target.temporary_quarantine_name.as_str(),
            false,
            true,
        ),
    ] {
        if let Some(file) = open_regular_entry(&target.parent, entry_name)? {
            candidates.push((
                entry_name,
                original_name,
                quarantine_name,
                published,
                already_quarantined,
                file,
            ));
        }
    }
    if candidates.is_empty() {
        return Ok(RecoveryDisposition::Cleared);
    }
    if candidates.len() != 1 {
        return Err(ExecutorError::RecoveryRequired);
    }
    let (entry_name, original_name, quarantine_name, published, already_quarantined, mut file) =
        candidates.pop().expect("one candidate was checked");
    let Some(expected) = journal.destination_file_identity.as_ref() else {
        if !published
            && !already_quarantined
            && journal.status == JournalStatus::Applying
            && file_identity(&file)?.byte_size == 0
        {
            return Ok(RecoveryDisposition::PreservedUnidentifiedPartial);
        }
        return Err(ExecutorError::RecoveryRequired);
    };
    if !same_recovery_file_identity(&file, expected)? {
        return Err(ExecutorError::RecoveryRequired);
    }
    let expected_content = published.then_some((expected_size, expected_hash));
    quarantine_and_remove_entry(
        &target.parent,
        entry_name,
        original_name,
        quarantine_name,
        &mut file,
        expected,
        expected_content,
        already_quarantined,
        false,
    )?;
    Ok(RecoveryDisposition::Cleared)
}

fn verify_published_media_destination(
    root: &Path,
    relative: &RootRelativePath,
    operation_id: &OperationId,
    destination: &MediaDestination,
    plan: &ChangePlan,
) -> Result<(), ExecutorError> {
    if !destination.published {
        return Err(ExecutorError::PostWriteVerificationFailed);
    }
    let current = open_destination_target(root, relative, operation_id)?;
    if !same_open_directory(&current.parent, &destination.target.parent)?
        || open_regular_entry(&current.parent, &current.temporary_name)?.is_some()
    {
        return Err(ExecutorError::RootChanged);
    }
    let mut file = open_regular_entry(&current.parent, &current.file_name)?
        .ok_or(ExecutorError::PostWriteVerificationFailed)?;
    if !same_file_identity(&file, &destination.identity)? {
        return Err(ExecutorError::RootChanged);
    }
    verify_open_file(&mut file, plan)
}

fn verify_source_in_root(
    root: &Path,
    relative: &RootRelativePath,
    plan: &ChangePlan,
) -> Result<(), ExecutorError> {
    let mut source = open_root_regular_file(root, relative)?;
    let (size, hash) = hash_reader(&mut source)?;
    if size == plan.operation.source.byte_size && hash == plan.operation.source.content_hash {
        Ok(())
    } else {
        Err(ExecutorError::SourceChanged)
    }
}

fn verify_destination(destination: &Path, plan: &ChangePlan) -> Result<(), ExecutorError> {
    let (size, hash) = hash_regular_file(destination)?;
    if size == plan.operation.source.byte_size && hash == plan.operation.source.content_hash {
        Ok(())
    } else {
        Err(ExecutorError::PostWriteVerificationFailed)
    }
}

fn copy_source_to_staging(
    root: &Path,
    relative: &RootRelativePath,
    destination: &Path,
    plan: &ChangePlan,
) -> Result<(), ExecutorError> {
    let mut reader = open_root_regular_file(root, relative)?;
    let mut writer = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                ExecutorError::DestinationExists
            } else {
                ExecutorError::io(error)
            }
        })?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(ExecutorError::io)?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(ExecutorError::io)?;
    }
    writer.sync_all().map_err(ExecutorError::io)?;
    verify_destination(destination, plan)
}

fn hash_regular_file(path: &Path) -> Result<(u64, ContentHash), ExecutorError> {
    let metadata = fs::symlink_metadata(path).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ExecutorError::UnsafePath);
    }
    let mut reader = File::open(path).map_err(ExecutorError::io)?;
    hash_reader(&mut reader)
}

fn hash_reader(reader: &mut impl Read) -> Result<(u64, ContentHash), ExecutorError> {
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(ExecutorError::io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        byte_size = byte_size
            .checked_add(read as u64)
            .ok_or(ExecutorError::FileTooLarge)?;
    }
    Ok((
        byte_size,
        ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
            .expect("SHA-256 output is canonical"),
    ))
}

fn acquire_root_lock(directory: &Path, fingerprint: &str) -> Result<File, ExecutorError> {
    let locks = directory.join("locks");
    match fs::create_dir(&locks) {
        Ok(()) => sync_directory(directory)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(ExecutorError::io(error)),
    }
    let locks = descriptor_fs::open(
        &locks,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(descriptor_path_error)?;
    let locks = File::from(locks);
    let digest = Sha256::digest(fingerprint.as_bytes());
    let lock_name = format!("{digest:x}.lock");
    let file = descriptor_fs::openat(
        &locks,
        lock_name.as_str(),
        OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )
    .map_err(descriptor_path_error)?;
    let file = File::from(file);
    if !file.metadata().map_err(ExecutorError::io)?.is_file() {
        return Err(ExecutorError::UnsafePath);
    }
    file.try_lock_exclusive().map_err(|error| {
        if error.kind() == std::io::ErrorKind::WouldBlock {
            ExecutorError::RootBusy
        } else {
            ExecutorError::io(error)
        }
    })?;
    Ok(file)
}

fn new_journal(
    plan: &ChangePlan,
    operation_id: &OperationId,
    backup: &VerifiedBackup,
) -> OperationJournal {
    OperationJournal {
        schema: JOURNAL_SCHEMA.into(),
        operation_id: operation_id.as_str().into(),
        plan_id: plan.id.as_str().into(),
        root_fingerprint: plan.device_fingerprint.clone(),
        base_observed_revision: plan.base_observed_revision,
        source_relative_path: plan.operation.source.relative_path.as_str().into(),
        destination_relative_path: plan.operation.destination_relative_path.as_str().into(),
        backup_snapshot_id: backup.snapshot_id().as_str().into(),
        recovery_binding: backup.manifest().recovery_binding.clone(),
        destination_file_identity: None,
        status: JournalStatus::Prepared,
        failure_code: None,
    }
}

fn recovery_authorization_for_plan(
    plan: &ChangePlan,
    operation_id: &OperationId,
) -> Result<RecoveryAuthorization, ExecutorError> {
    Ok(RecoveryAuthorization {
        schema: RECOVERY_AUTHORIZATION_SCHEMA.to_owned(),
        operation_id: operation_id.as_str().to_owned(),
        plan_id: plan.id.as_str().to_owned(),
        root_fingerprint: plan.device_fingerprint.clone(),
        base_observed_revision: plan.base_observed_revision,
        source_relative_path: plan.operation.source.relative_path.as_str().to_owned(),
        destination_relative_path: plan
            .operation
            .destination_relative_path
            .as_str()
            .to_owned(),
        backup_snapshot_id: SnapshotId::for_plan(plan).as_str().to_owned(),
        recovery_binding: recovery_binding_for_plan(plan)
            .map_err(|_| ExecutorError::InvalidPlan)?,
        source_byte_size: plan.operation.source.byte_size,
        source_content_hash: plan.operation.source.content_hash.as_str().to_owned(),
    })
}

fn prepare_recovery_authorization_directory(
    journal_directory: &Path,
) -> Result<PathBuf, ExecutorError> {
    let directory = journal_directory.join(RECOVERY_AUTHORIZATION_DIRECTORY);
    match fs::create_dir(&directory) {
        Ok(()) => sync_directory(journal_directory)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(ExecutorError::io(error)),
    }
    let metadata = fs::symlink_metadata(&directory).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutorError::UnsafePath);
    }
    let canonical = directory.canonicalize().map_err(ExecutorError::io)?;
    if canonical.parent() != Some(journal_directory) {
        return Err(ExecutorError::UnsafePath);
    }
    Ok(canonical)
}

fn recovery_authorization_path(directory: &Path, operation_id: &OperationId) -> PathBuf {
    directory.join(format!("{}.json", operation_id.file_stem()))
}

fn ensure_recovery_authorization(
    directory: &Path,
    plan: &ChangePlan,
    operation_id: &OperationId,
) -> Result<RecoveryAuthorization, ExecutorError> {
    let expected = recovery_authorization_for_plan(plan, operation_id)?;
    let path = recovery_authorization_path(directory, operation_id);
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            let existing = read_recovery_authorization(&path, operation_id)?;
            if existing != expected {
                return Err(ExecutorError::InvalidJournal);
            }
            return Ok(existing);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(ExecutorError::io(error)),
    }

    let temporary = path.with_extension("json.tmp");
    remove_stale_authorization_temporary(&temporary)?;
    let bytes = serde_json::to_vec_pretty(&expected)
        .map_err(|error| ExecutorError::Journal(error.to_string()))?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(ExecutorError::io)?;
        file.write_all(&bytes).map_err(ExecutorError::io)?;
        file.sync_all().map_err(ExecutorError::io)?;
        file.set_permissions(fs::Permissions::from_mode(0o400))
            .map_err(ExecutorError::io)?;
        file.sync_all().map_err(ExecutorError::io)?;

        let parent = File::open(directory).map_err(ExecutorError::io)?;
        let temporary_name = temporary
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(ExecutorError::UnsafePath)?;
        let final_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(ExecutorError::UnsafePath)?;
        descriptor_fs::renameat_with(
            &parent,
            temporary_name,
            &parent,
            final_name,
            RenameFlags::NOREPLACE,
        )
        .map_err(descriptor_path_error)?;
        parent.sync_all().map_err(ExecutorError::io)
    })();
    if let Err(error) = result {
        let _ = remove_stale_authorization_temporary(&temporary);
        return Err(error);
    }

    let stored = read_recovery_authorization(&path, operation_id)?;
    if stored != expected {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(stored)
}

fn remove_stale_authorization_temporary(path: &Path) -> Result<(), ExecutorError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(ExecutorError::UnsafePath)
        }
        Ok(_) => {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(ExecutorError::io)?;
            fs::remove_file(path).map_err(ExecutorError::io)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ExecutorError::io(error)),
    }
}

fn read_recovery_authorization(
    path: &Path,
    operation_id: &OperationId,
) -> Result<RecoveryAuthorization, ExecutorError> {
    let file = descriptor_fs::open(
        path,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(descriptor_path_error)?;
    let file = File::from(file);
    let metadata = file.metadata().map_err(ExecutorError::io)?;
    if !metadata.is_file() || metadata.mode() & 0o222 != 0 {
        return Err(ExecutorError::UnsafePath);
    }
    let authorization: RecoveryAuthorization = serde_json::from_reader(file)
        .map_err(|error| ExecutorError::Journal(error.to_string()))?;
    validate_recovery_authorization(&authorization, operation_id, path)?;
    Ok(authorization)
}

fn validate_recovery_authorization(
    authorization: &RecoveryAuthorization,
    operation_id: &OperationId,
    path: &Path,
) -> Result<(), ExecutorError> {
    if authorization.schema != RECOVERY_AUTHORIZATION_SCHEMA
        || authorization.operation_id != operation_id.as_str()
        || path.file_stem().and_then(|stem| stem.to_str()) != Some(operation_id.file_stem())
        || authorization.plan_id
            != operation_id
                .as_str()
                .replacen(OPERATION_ID_PREFIX, "plan:v1:", 1)
        || authorization.backup_snapshot_id
            != operation_id
                .as_str()
                .replacen(OPERATION_ID_PREFIX, "snapshot:v1:", 1)
        || authorization.base_observed_revision == 0
        || PlanId::parse(authorization.plan_id.clone()).is_err()
        || SnapshotId::parse(authorization.backup_snapshot_id.clone()).is_err()
        || validate_root_fingerprint(&authorization.root_fingerprint).is_err()
        || validate_recovery_binding(&authorization.recovery_binding).is_err()
        || RootRelativePath::parse(&authorization.source_relative_path).is_err()
        || RootRelativePath::parse(&authorization.destination_relative_path).is_err()
        || authorization.source_relative_path == authorization.destination_relative_path
        || ContentHash::parse(authorization.source_content_hash.clone()).is_err()
    {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(())
}

fn validate_recovery_authorization_for_plan(
    authorization: &RecoveryAuthorization,
    plan: &ChangePlan,
    operation_id: &OperationId,
) -> Result<(), ExecutorError> {
    if authorization != &recovery_authorization_for_plan(plan, operation_id)? {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(())
}

fn journal_path(directory: &Path, operation_id: &OperationId) -> PathBuf {
    directory.join(format!("{}.json", operation_id.file_stem()))
}

fn write_journal(path: &Path, journal: &OperationJournal) -> Result<(), ExecutorError> {
    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|error| ExecutorError::Journal(error.to_string()))?;
    let temporary = path.with_extension("json.tmp");
    remove_stale_journal_temporary(&temporary)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(ExecutorError::io)?;
        file.write_all(&bytes).map_err(ExecutorError::io)?;
        file.sync_all().map_err(ExecutorError::io)?;
        fs::rename(&temporary, path).map_err(ExecutorError::io)?;
        sync_directory(path.parent().ok_or(ExecutorError::UnsafePath)?)
    })();
    if result.is_err() {
        let _ = remove_stale_journal_temporary(&temporary);
    }
    result
}

fn remove_stale_journal_temporary(path: &Path) -> Result<(), ExecutorError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(ExecutorError::UnsafePath)
        }
        Ok(_) => fs::remove_file(path).map_err(ExecutorError::io),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ExecutorError::io(error)),
    }
}

fn read_journal(path: &Path) -> Result<OperationJournal, ExecutorError> {
    let file = descriptor_fs::open(
        path,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(descriptor_path_error)?;
    let file = File::from(file);
    if !file.metadata().map_err(ExecutorError::io)?.is_file() {
        return Err(ExecutorError::UnsafePath);
    }
    let value: serde_json::Value =
        serde_json::from_reader(file).map_err(|error| ExecutorError::Journal(error.to_string()))?;
    let schema = value
        .get("schema")
        .and_then(serde_json::Value::as_str)
        .ok_or(ExecutorError::InvalidJournal)?
        .to_owned();
    match schema.as_str() {
        JOURNAL_SCHEMA => {
            serde_json::from_value(value).map_err(|error| ExecutorError::Journal(error.to_string()))
        }
        LEGACY_JOURNAL_SCHEMA => {
            let legacy: LegacyOperationJournal = serde_json::from_value(value)
                .map_err(|error| ExecutorError::Journal(error.to_string()))?;
            Ok(legacy.into_safe_journal())
        }
        _ => Err(ExecutorError::InvalidJournal),
    }
}

fn validate_standalone_journal(
    journal: &OperationJournal,
    operation_id: &OperationId,
    path: &Path,
) -> Result<(), ExecutorError> {
    let schema_is_valid = match journal.schema.as_str() {
        JOURNAL_SCHEMA => validate_recovery_binding(&journal.recovery_binding).is_ok(),
        LEGACY_JOURNAL_SCHEMA => {
            journal.recovery_binding == LEGACY_RECOVERY_BINDING
                && matches!(
                    journal.status,
                    JournalStatus::Committed | JournalStatus::RolledBack | JournalStatus::Abandoned
                )
                && (journal.status != JournalStatus::Abandoned
                    || journal.failure_code.as_deref() == Some(LEGACY_RECOVERY_FAILURE))
        }
        _ => false,
    };
    if !schema_is_valid
        || journal.operation_id != operation_id.as_str()
        || path.file_stem().and_then(|stem| stem.to_str()) != Some(operation_id.file_stem())
        || journal.plan_id
            != operation_id
                .as_str()
                .replacen("operation:v1:", "plan:v1:", 1)
        || journal.backup_snapshot_id
            != operation_id
                .as_str()
                .replacen("operation:v1:", "snapshot:v1:", 1)
        || PlanId::parse(journal.plan_id.clone()).is_err()
        || SnapshotId::parse(journal.backup_snapshot_id.clone()).is_err()
        || journal.base_observed_revision == 0
        || RootRelativePath::parse(&journal.source_relative_path).is_err()
        || RootRelativePath::parse(&journal.destination_relative_path).is_err()
        || journal.source_relative_path == journal.destination_relative_path
    {
        return Err(ExecutorError::InvalidJournal);
    }
    validate_root_fingerprint(&journal.root_fingerprint).map_err(|_| ExecutorError::InvalidJournal)
}

fn validate_recovery_backup(
    backup: &VerifiedBackup,
    journal: &OperationJournal,
    authorization: &RecoveryAuthorization,
    operation_id: &OperationId,
) -> Result<(u64, ContentHash), ExecutorError> {
    let expected_plan_id = operation_id
        .as_str()
        .replacen(OPERATION_ID_PREFIX, "plan:v1:", 1);
    let expected_snapshot_id =
        operation_id
            .as_str()
            .replacen(OPERATION_ID_PREFIX, "snapshot:v1:", 1);
    let manifest = backup.manifest();
    if backup.snapshot_id().as_str() != expected_snapshot_id.as_str()
        || journal.plan_id != expected_plan_id.as_str()
        || journal.backup_snapshot_id != expected_snapshot_id.as_str()
        || manifest.plan_id.as_str() != journal.plan_id.as_str()
        || manifest.source_fingerprint.as_str() != journal.root_fingerprint.as_str()
        || manifest.base_observed_revision != journal.base_observed_revision
        || manifest.source_relative_path != journal.source_relative_path
        || manifest.destination_relative_path != journal.destination_relative_path
        || manifest.recovery_binding != journal.recovery_binding
        || authorization.operation_id != journal.operation_id
        || authorization.plan_id != journal.plan_id
        || authorization.root_fingerprint != journal.root_fingerprint
        || authorization.base_observed_revision != journal.base_observed_revision
        || authorization.source_relative_path != journal.source_relative_path
        || authorization.destination_relative_path != journal.destination_relative_path
        || authorization.backup_snapshot_id != journal.backup_snapshot_id
        || authorization.recovery_binding != journal.recovery_binding
        || manifest.files.len() != 1
    {
        return Err(ExecutorError::InvalidJournal);
    }
    let source = manifest
        .files
        .first()
        .ok_or(ExecutorError::InvalidJournal)?;
    if source.relative_path.as_str() != journal.source_relative_path.as_str()
        || source.byte_size != authorization.source_byte_size
        || source.content_hash != authorization.source_content_hash
    {
        return Err(ExecutorError::InvalidJournal);
    }
    let content_hash = ContentHash::parse(source.content_hash.clone())
        .map_err(|_| ExecutorError::InvalidJournal)?;
    Ok((source.byte_size, content_hash))
}

fn validate_root_fingerprint(value: &str) -> Result<(), ExecutorError> {
    let digest = value
        .strip_prefix("rootfp:v1:")
        .ok_or(ExecutorError::InvalidPlan)?;
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(ExecutorError::InvalidPlan)
    }
}

fn validate_recovery_binding(value: &str) -> Result<(), ExecutorError> {
    let digest = value
        .strip_prefix(RECOVERY_BINDING_PREFIX)
        .ok_or(ExecutorError::InvalidJournal)?;
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(ExecutorError::InvalidJournal)
    }
}

fn validate_journal(
    journal: &OperationJournal,
    plan: &ChangePlan,
    operation_id: &OperationId,
) -> Result<(), ExecutorError> {
    let recovery_binding =
        recovery_binding_for_plan(plan).map_err(|_| ExecutorError::InvalidJournal)?;
    let binding_is_valid = match journal.schema.as_str() {
        JOURNAL_SCHEMA => journal.recovery_binding == recovery_binding,
        LEGACY_JOURNAL_SCHEMA => {
            journal.recovery_binding == LEGACY_RECOVERY_BINDING
                && matches!(
                    journal.status,
                    JournalStatus::Committed | JournalStatus::RolledBack | JournalStatus::Abandoned
                )
        }
        _ => false,
    };
    if !binding_is_valid
        || journal.operation_id != operation_id.as_str()
        || journal.plan_id != plan.id.as_str()
        || journal.root_fingerprint != plan.device_fingerprint
        || journal.base_observed_revision != plan.base_observed_revision
        || journal.source_relative_path != plan.operation.source.relative_path.as_str()
        || journal.destination_relative_path != plan.operation.destination_relative_path.as_str()
        || journal.backup_snapshot_id != SnapshotId::for_plan(plan).as_str()
    {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(())
}

fn cleanup_staging(base: &Path, operation_id: &OperationId) -> Result<(), ExecutorError> {
    let directory = base.join(operation_id.file_stem());
    if validate_staging_cleanup_target(base, operation_id)? {
        #[cfg(test)]
        if directory.join(STAGING_CLEANUP_FAILURE_SENTINEL).exists() {
            return Err(ExecutorError::io(std::io::Error::other(
                "test-injected staging cleanup failure",
            )));
        }
        fs::remove_dir_all(directory).map_err(ExecutorError::io)?;
        sync_directory(base)?;
    }
    Ok(())
}

fn validate_staging_cleanup_target(
    base: &Path,
    operation_id: &OperationId,
) -> Result<bool, ExecutorError> {
    let directory = base.join(operation_id.file_stem());
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(ExecutorError::UnsafePath)
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ExecutorError::io(error)),
    }
}

fn sync_directory(path: &Path) -> Result<(), ExecutorError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(ExecutorError::io)
}

#[derive(Debug)]
pub enum ExecutorError {
    Authority(AuthorityError),
    Backup(BackupError),
    Io(String),
    Journal(String),
    RootChanged,
    RootBusy,
    LocalStateInsideRoot,
    OverwriteForbidden,
    DestinationExists,
    SourceChanged,
    PathEscape,
    SymlinkEscape,
    UnsafePath,
    FileTooLarge,
    InvalidPlan,
    InvalidOperationId,
    NoSpace,
    PostWriteVerificationFailed,
    PlanConsumed,
    InvalidJournal,
    RecoveryRequired,
    InjectedFault(&'static str),
    SimulatedCrash,
}

impl ExecutorError {
    fn io(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Authority(_) => "AUTHORITY_FAILED",
            Self::Backup(_) => "BACKUP_FAILED",
            Self::Io(_) => "WRITE_FAILED",
            Self::Journal(_) | Self::InvalidJournal => "JOURNAL_FAILED",
            Self::RootChanged => "ROOT_CHANGED",
            Self::RootBusy => "ROOT_BUSY",
            Self::LocalStateInsideRoot => "LOCAL_STATE_INSIDE_ROOT",
            Self::OverwriteForbidden | Self::DestinationExists => "DESTINATION_EXISTS",
            Self::SourceChanged => "PLAN_STALE",
            Self::PathEscape => "PATH_ESCAPE",
            Self::SymlinkEscape => "SYMLINK_ESCAPE",
            Self::UnsafePath => "UNSAFE_PATH",
            Self::FileTooLarge => "FILE_TOO_LARGE",
            Self::InvalidPlan => "INVALID_PLAN",
            Self::InvalidOperationId => "INVALID_OPERATION_ID",
            Self::NoSpace => "NO_SPACE",
            Self::PostWriteVerificationFailed => "VERIFY_FAILED",
            Self::PlanConsumed => "PLAN_CONSUMED",
            Self::RecoveryRequired => "RECOVERY_REQUIRED",
            Self::InjectedFault(_) => "INJECTED_FAULT",
            Self::SimulatedCrash => "SIMULATED_CRASH",
        }
    }
}

impl From<AuthorityError> for ExecutorError {
    fn from(error: AuthorityError) -> Self {
        Self::Authority(error)
    }
}

impl fmt::Display for ExecutorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Authority(error) => write!(formatter, "write authority failed: {error}"),
            Self::Backup(error) => write!(formatter, "verified backup failed: {error}"),
            Self::Io(message) => write!(formatter, "executor I/O failed: {message}"),
            Self::Journal(message) => write!(formatter, "operation journal failed: {message}"),
            Self::InjectedFault(point) => write!(formatter, "fault injected at {point}"),
            other => formatter.write_str(match other {
                Self::RootChanged => "root changed after the plan was created",
                Self::RootBusy => "another writer holds the root lock",
                Self::LocalStateInsideRoot => {
                    "staging, backups, and journals must stay off the source root"
                }
                Self::OverwriteForbidden => "this executor only permits additive copies",
                Self::DestinationExists => "additive copy destination already exists",
                Self::SourceChanged => "source no longer matches the plan precondition",
                Self::PathEscape => "executor path escaped the approved root",
                Self::SymlinkEscape => "executor path contains a symbolic link",
                Self::UnsafePath => "executor encountered an unsafe path",
                Self::FileTooLarge => "file size overflowed",
                Self::InvalidPlan => "change plan is not a valid additive-copy plan",
                Self::InvalidOperationId => "operation ID is not a versioned SHA-256 identifier",
                Self::NoSpace => "approved root does not have enough free space",
                Self::PostWriteVerificationFailed => "post-write hash verification failed",
                Self::PlanConsumed => "plan has already reached a terminal state",
                Self::InvalidJournal => "operation journal does not match the plan",
                Self::RecoveryRequired => "operation requires explicit recovery",
                Self::SimulatedCrash => "test simulated a process crash",
                Self::Authority(_)
                | Self::Backup(_)
                | Self::Io(_)
                | Self::Journal(_)
                | Self::InjectedFault(_) => unreachable!(),
            }),
        }
    }
}

impl std::error::Error for ExecutorError {}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_plan::{
        plan_additive_copy, AdditiveCopyIntent, AdditiveCopyPlanningFacts, PlanSeed,
        RootPlanObservation, SourceFileObservation,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use tempfile::TempDir;

    struct FixtureAuthority {
        root: Mutex<ApprovedExecutionRoot>,
    }

    struct LateRootChangeAuthority {
        root: ApprovedExecutionRoot,
        changed_path: PathBuf,
        resolutions: AtomicUsize,
    }

    struct ChangingRecoveryAuthority {
        initial: ApprovedRecoveryRoot,
        changed: ApprovedRecoveryRoot,
        change_at_resolution: usize,
        resolutions: AtomicUsize,
    }

    impl RecoveryAuthority for ChangingRecoveryAuthority {
        fn resolve_for_recovery(
            &self,
            root_id: &RootId,
        ) -> Result<ApprovedRecoveryRoot, AuthorityError> {
            if &self.initial.root_id != root_id {
                return Err(AuthorityError::NotApproved);
            }
            let resolution = self.resolutions.fetch_add(1, Ordering::SeqCst) + 1;
            if resolution >= self.change_at_resolution {
                Ok(self.changed.clone())
            } else {
                Ok(self.initial.clone())
            }
        }
    }

    impl WriteAuthority for LateRootChangeAuthority {
        fn resolve_for_write(
            &self,
            root_id: &RootId,
        ) -> Result<ApprovedExecutionRoot, AuthorityError> {
            if &self.root.root_id != root_id {
                return Err(AuthorityError::NotApproved);
            }
            let mut root = self.root.clone();
            if self.resolutions.fetch_add(1, Ordering::SeqCst) >= 2 {
                root.canonical_path = self.changed_path.clone();
            }
            Ok(root)
        }
    }

    struct LateSourceChangeAuthority {
        root: ApprovedExecutionRoot,
        source: PathBuf,
        resolutions: AtomicUsize,
    }

    #[cfg(unix)]
    struct SwapDestinationParentAuthority {
        root: ApprovedExecutionRoot,
        destination_parent: PathBuf,
        outside: PathBuf,
        resolutions: AtomicUsize,
    }

    #[cfg(unix)]
    impl WriteAuthority for SwapDestinationParentAuthority {
        fn resolve_for_write(
            &self,
            root_id: &RootId,
        ) -> Result<ApprovedExecutionRoot, AuthorityError> {
            if &self.root.root_id != root_id {
                return Err(AuthorityError::NotApproved);
            }
            if self.resolutions.fetch_add(1, Ordering::SeqCst) == 1 {
                fs::remove_dir(&self.destination_parent).unwrap();
                std::os::unix::fs::symlink(&self.outside, &self.destination_parent).unwrap();
            }
            Ok(self.root.clone())
        }
    }

    impl WriteAuthority for LateSourceChangeAuthority {
        fn resolve_for_write(
            &self,
            root_id: &RootId,
        ) -> Result<ApprovedExecutionRoot, AuthorityError> {
            if &self.root.root_id != root_id {
                return Err(AuthorityError::NotApproved);
            }
            if self.resolutions.fetch_add(1, Ordering::SeqCst) == 2 {
                fs::write(&self.source, b"changed during execution").unwrap();
            }
            Ok(self.root.clone())
        }
    }

    impl WriteAuthority for FixtureAuthority {
        fn resolve_for_write(
            &self,
            root_id: &RootId,
        ) -> Result<ApprovedExecutionRoot, AuthorityError> {
            let root = self.root.lock().unwrap().clone();
            if &root.root_id != root_id {
                return Err(AuthorityError::NotApproved);
            }
            Ok(root)
        }
    }

    impl RecoveryAuthority for FixtureAuthority {
        fn resolve_for_recovery(
            &self,
            root_id: &RootId,
        ) -> Result<ApprovedRecoveryRoot, AuthorityError> {
            let root = self.root.lock().unwrap().clone();
            if &root.root_id != root_id {
                return Err(AuthorityError::NotApproved);
            }
            Ok(ApprovedRecoveryRoot {
                root_id: root.root_id,
                device_fingerprint: root.device_fingerprint,
                canonical_path: root.canonical_path,
                stable_device_identity: root.stable_device_identity,
            })
        }
    }

    struct Fixture {
        _temp: TempDir,
        root: PathBuf,
        local: PathBuf,
        source: PathBuf,
        destination: PathBuf,
        source_bytes: Vec<u8>,
        plan: ChangePlan,
        authority: FixtureAuthority,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = TempDir::new().unwrap();
            let root = temp.path().join("approved-root");
            let local = temp.path().join("application-support");
            fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
            fs::create_dir_all(root.join("SET/PROJECT")).unwrap();
            let source = root.join("SET/AUDIO/kick.wav");
            let destination = root.join("SET/PROJECT/kick.wav");
            let source_bytes = b"synthetic fixture audio only".to_vec();
            fs::write(&source, &source_bytes).unwrap();
            let root = root.canonicalize().unwrap();
            let root_id = RootId::new("root-1").unwrap();
            let fingerprint = format!("rootfp:v1:{}", "a".repeat(64));
            let (_, hash) = hash_regular_file(&source).unwrap();
            let source_relative = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
            let plan = plan_additive_copy(
                &AdditiveCopyIntent {
                    root_id: root_id.clone(),
                    source_relative_path: source_relative.clone(),
                    destination_relative_path: RootRelativePath::parse("SET/PROJECT/kick.wav")
                        .unwrap(),
                },
                &AdditiveCopyPlanningFacts {
                    plan_seed: PlanSeed::new([7; 32]),
                    root: RootPlanObservation {
                        root_id: root_id.clone(),
                        device_fingerprint: fingerprint.clone(),
                        observed_revision: 1,
                        identity_is_stable: true,
                    },
                    source: SourceFileObservation {
                        relative_path: source_relative,
                        byte_size: source_bytes.len() as u64,
                        content_hash: hash,
                    },
                    destination_exists: false,
                },
            )
            .unwrap();
            Self {
                _temp: temp,
                root: root.clone(),
                local,
                source,
                destination,
                source_bytes,
                plan,
                authority: FixtureAuthority {
                    root: Mutex::new(ApprovedExecutionRoot {
                        root_id,
                        device_fingerprint: fingerprint,
                        observed_revision: 1,
                        canonical_path: root,
                        write_enabled: true,
                        stable_device_identity: true,
                    }),
                },
            }
        }

        fn executor(&self) -> AdditiveCopyExecutor {
            AdditiveCopyExecutor::new(ExecutorLocalPaths {
                staging_directory: self.local.join("staging"),
                backup_directory: self.local.join("backups"),
                journal_directory: self.local.join("journals"),
            })
        }

        fn write_legacy_operation_state(
            &self,
            status: &str,
            destination_file_identity: Option<&JournalFileIdentity>,
        ) -> (OperationId, PathBuf) {
            let operation_id = OperationId::for_plan(&self.plan);
            let snapshot_id = SnapshotId::for_plan(&self.plan);
            let journal_directory = self.local.join("journals");
            fs::create_dir_all(&journal_directory).unwrap();
            fs::write(
                journal_path(&journal_directory, &operation_id),
                serde_json::to_vec_pretty(&serde_json::json!({
                    "schema": LEGACY_JOURNAL_SCHEMA,
                    "operation_id": operation_id.as_str(),
                    "plan_id": self.plan.id.as_str(),
                    "root_fingerprint": self.plan.device_fingerprint,
                    "base_observed_revision": self.plan.base_observed_revision,
                    "source_relative_path": self.plan.operation.source.relative_path.as_str(),
                    "destination_relative_path": self.plan.operation.destination_relative_path.as_str(),
                    "backup_snapshot_id": snapshot_id.as_str(),
                    "destination_file_identity": destination_file_identity,
                    "status": status,
                    "failure_code": serde_json::Value::Null,
                }))
                .unwrap(),
            )
            .unwrap();

            let snapshot_directory = self
                .local
                .join("backups")
                .join(snapshot_id.as_str().strip_prefix("snapshot:v1:").unwrap());
            let backup_file = snapshot_directory
                .join("files")
                .join(self.plan.operation.source.relative_path.as_str());
            fs::create_dir_all(backup_file.parent().unwrap()).unwrap();
            fs::write(&backup_file, &self.source_bytes).unwrap();
            let legacy_manifest_path = snapshot_directory.join("manifest.json");
            fs::write(
                &legacy_manifest_path,
                serde_json::to_vec_pretty(&serde_json::json!({
                    "schema": "masterocta-backup:v1",
                    "snapshot_id": snapshot_id.as_str(),
                    "plan_id": self.plan.id.as_str(),
                    "source_fingerprint": self.plan.device_fingerprint,
                    "complete": true,
                    "files": [{
                        "relative_path": self.plan.operation.source.relative_path.as_str(),
                        "byte_size": self.plan.operation.source.byte_size,
                        "content_hash": self.plan.operation.source.content_hash.as_str(),
                    }],
                }))
                .unwrap(),
            )
            .unwrap();
            (operation_id, legacy_manifest_path)
        }

        fn plan_for_destination(&self, destination: &str, seed: u8) -> ChangePlan {
            let source_relative = self.plan.operation.source.relative_path.clone();
            plan_additive_copy(
                &AdditiveCopyIntent {
                    root_id: self.plan.root_id.clone(),
                    source_relative_path: source_relative.clone(),
                    destination_relative_path: RootRelativePath::parse(destination).unwrap(),
                },
                &AdditiveCopyPlanningFacts {
                    plan_seed: PlanSeed::new([seed; 32]),
                    root: RootPlanObservation {
                        root_id: self.plan.root_id.clone(),
                        device_fingerprint: self.plan.device_fingerprint.clone(),
                        observed_revision: self.plan.base_observed_revision,
                        identity_is_stable: true,
                    },
                    source: SourceFileObservation {
                        relative_path: source_relative,
                        byte_size: self.plan.operation.source.byte_size,
                        content_hash: self.plan.operation.source.content_hash.clone(),
                    },
                    destination_exists: false,
                },
            )
            .unwrap()
        }
    }

    fn public_recovery_binding_for_manifest(manifest: &ot_backup::BackupManifest) -> String {
        fn encode(hasher: &mut Sha256, tag: u8, bytes: &[u8]) {
            hasher.update([tag]);
            hasher.update((bytes.len() as u64).to_be_bytes());
            hasher.update(bytes);
        }

        let mut paths = manifest
            .files
            .iter()
            .map(|file| file.relative_path.clone())
            .collect::<Vec<_>>();
        paths.sort();
        let source = manifest
            .files
            .iter()
            .find(|file| file.relative_path == manifest.source_relative_path)
            .unwrap();
        let mut hasher = Sha256::new();
        hasher.update(b"masterocta:recovery-binding:v1");
        encode(&mut hasher, 1, manifest.plan_id.as_bytes());
        encode(&mut hasher, 2, manifest.snapshot_id.as_bytes());
        encode(&mut hasher, 3, manifest.source_fingerprint.as_bytes());
        encode(
            &mut hasher,
            4,
            &manifest.base_observed_revision.to_be_bytes(),
        );
        encode(&mut hasher, 5, manifest.source_relative_path.as_bytes());
        encode(
            &mut hasher,
            6,
            manifest.destination_relative_path.as_bytes(),
        );
        encode(&mut hasher, 7, &source.byte_size.to_be_bytes());
        encode(&mut hasher, 8, source.content_hash.as_bytes());
        encode(&mut hasher, 9, &(paths.len() as u64).to_be_bytes());
        for path in paths {
            encode(&mut hasher, 10, path.as_bytes());
        }
        format!("{RECOVERY_BINDING_PREFIX}{:x}", hasher.finalize())
    }

    #[test]
    fn additive_copy_commits_only_after_backup_and_verification() {
        let fixture = Fixture::new();
        let result = fixture
            .executor()
            .execute(&fixture.plan, &fixture.authority)
            .unwrap();

        assert_eq!(result.journal.status, JournalStatus::Committed);
        assert!(result.local_cleanup_complete);
        assert_eq!(
            fs::read(&fixture.destination).unwrap(),
            fixture.source_bytes
        );
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert_eq!(result.backup.manifest().files.len(), 1);
        assert!(!fixture
            .local
            .join("staging")
            .join(result.operation_id.file_stem())
            .exists());

        let journal_text = fs::read_to_string(
            fixture
                .local
                .join("journals")
                .join(format!("{}.json", result.operation_id.file_stem())),
        )
        .unwrap();
        assert!(!journal_text.contains(fixture.root.to_string_lossy().as_ref()));
        assert!(!journal_text.contains("root-1"));
        let authorization_text = fs::read_to_string(recovery_authorization_path(
            &fixture
                .local
                .join("journals")
                .join(RECOVERY_AUTHORIZATION_DIRECTORY),
            &result.operation_id,
        ))
        .unwrap();
        assert!(!authorization_text.contains(fixture.root.to_string_lossy().as_ref()));
        assert!(!authorization_text.contains("root-1"));
    }

    #[test]
    fn legacy_committed_journal_remains_readable_with_v1_backup_preserved() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let (operation_id, legacy_manifest_path) =
            fixture.write_legacy_operation_state("committed", None);
        let legacy_manifest = fs::read(&legacy_manifest_path).unwrap();

        let journal = executor.operation_journal(&operation_id).unwrap().unwrap();

        assert_eq!(journal.schema, LEGACY_JOURNAL_SCHEMA);
        assert_eq!(journal.status, JournalStatus::Committed);
        assert_eq!(journal.recovery_binding, LEGACY_RECOVERY_BINDING);
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());
        assert!(matches!(
            executor.recover_incomplete_operation(
                &fixture.plan.root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::PlanConsumed)
        ));
        assert_eq!(fs::read(&legacy_manifest_path).unwrap(), legacy_manifest);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert!(!fixture.destination.exists());
    }

    #[test]
    fn legacy_incomplete_state_is_abandoned_without_deleting_media_or_blocking_root() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        let target = open_destination_target(
            &fixture.root,
            &fixture.plan.operation.destination_relative_path,
            &operation_id,
        )
        .unwrap();
        let legacy_partial = fixture
            .destination
            .parent()
            .unwrap()
            .join(&target.temporary_name);
        let legacy_partial_bytes = b"legacy partial preserved for manual inspection";
        fs::write(&legacy_partial, legacy_partial_bytes).unwrap();
        let legacy_identity = file_identity(&File::open(&legacy_partial).unwrap()).unwrap();
        let (written_operation_id, legacy_manifest_path) =
            fixture.write_legacy_operation_state("applying", Some(&legacy_identity));
        assert_eq!(written_operation_id, operation_id);
        let legacy_manifest = fs::read(&legacy_manifest_path).unwrap();

        let journal = executor.operation_journal(&operation_id).unwrap().unwrap();

        assert_eq!(journal.schema, LEGACY_JOURNAL_SCHEMA);
        assert_eq!(journal.status, JournalStatus::Abandoned);
        assert_eq!(
            journal.failure_code.as_deref(),
            Some(LEGACY_RECOVERY_FAILURE)
        );
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());
        assert!(matches!(
            executor.recover_incomplete_operation(
                &fixture.plan.root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::PlanConsumed)
        ));
        assert_eq!(fs::read(&legacy_partial).unwrap(), legacy_partial_bytes);
        assert_eq!(fs::read(&legacy_manifest_path).unwrap(), legacy_manifest);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);

        let independent_plan = fixture.plan_for_destination("SET/PROJECT/independent.wav", 31);
        let result = executor
            .execute(&independent_plan, &fixture.authority)
            .unwrap();
        assert_eq!(result.journal.status, JournalStatus::Committed);
        assert_eq!(
            fs::read(fixture.root.join("SET/PROJECT/independent.wav")).unwrap(),
            fixture.source_bytes
        );
        assert_eq!(fs::read(&legacy_partial).unwrap(), legacy_partial_bytes);
    }

    #[test]
    fn stale_source_and_existing_destination_fail_before_media_changes() {
        let fixture = Fixture::new();
        fs::write(&fixture.source, b"changed after planning").unwrap();
        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::SourceChanged)
        ));
        assert!(!fixture.destination.exists());

        let fixture = Fixture::new();
        fs::write(&fixture.destination, b"existing user data").unwrap();
        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::DestinationExists)
        ));
        assert_eq!(
            fs::read(&fixture.destination).unwrap(),
            b"existing user data"
        );
    }

    #[test]
    fn unrelated_existing_snapshot_cannot_bypass_the_verified_backup_gate() {
        let fixture = Fixture::new();
        let snapshot_id = SnapshotId::for_plan(&fixture.plan);
        let snapshot_directory = fixture
            .local
            .join("backups")
            .join(snapshot_id.as_str().strip_prefix("snapshot:v1:").unwrap());
        fs::create_dir_all(snapshot_directory.join("files")).unwrap();
        let manifest = ot_backup::BackupManifest {
            schema: "masterocta-backup:v2".into(),
            snapshot_id: snapshot_id.as_str().into(),
            plan_id: format!("plan:v1:{}", "b".repeat(64)),
            source_fingerprint: format!("rootfp:v1:{}", "c".repeat(64)),
            base_observed_revision: fixture.plan.base_observed_revision,
            source_relative_path: fixture.plan.operation.source.relative_path.as_str().into(),
            destination_relative_path: fixture
                .plan
                .operation
                .destination_relative_path
                .as_str()
                .into(),
            recovery_binding: recovery_binding_for_plan(&fixture.plan).unwrap(),
            complete: true,
            files: vec![],
        };
        fs::write(
            snapshot_directory.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::Backup(BackupError::InvalidManifest(
                "plan_snapshot_binding"
            )))
        ));
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn read_only_or_changed_authority_fails_closed() {
        let fixture = Fixture::new();
        fixture.authority.root.lock().unwrap().write_enabled = false;
        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::Authority(AuthorityError::ReadOnly))
        ));
        assert!(!fixture.destination.exists());

        let fixture = Fixture::new();
        fixture.authority.root.lock().unwrap().observed_revision = 2;
        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::RootChanged)
        ));
        assert!(!fixture.destination.exists());
    }

    #[test]
    fn structurally_forged_additive_plan_is_rejected_before_local_or_media_writes() {
        let fixture = Fixture::new();
        let mut plan = fixture.plan.clone();
        plan.backup_relative_paths.clear();

        assert!(matches!(
            fixture.executor().execute(&plan, &fixture.authority),
            Err(ExecutorError::InvalidPlan)
        ));
        assert!(!fixture.destination.exists());
        assert!(!fixture.local.exists());
    }

    #[test]
    fn destination_changed_after_planning_is_rejected_before_local_or_media_writes() {
        let fixture = Fixture::new();
        let mut plan = fixture.plan.clone();
        let changed_destination = fixture.root.join("SET/PROJECT/replaced.wav");
        plan.operation.destination_relative_path =
            RootRelativePath::parse("SET/PROJECT/replaced.wav").unwrap();

        assert!(matches!(
            fixture.executor().execute(&plan, &fixture.authority),
            Err(ExecutorError::InvalidPlan)
        ));
        assert!(!fixture.destination.exists());
        assert!(!changed_destination.exists());
        assert!(!fixture.local.exists());
    }

    #[test]
    fn a_late_root_path_change_rolls_back_the_destination() {
        let fixture = Fixture::new();
        let changed_path = fixture._temp.path().join("remounted-root");
        fs::create_dir(&changed_path).unwrap();
        let authority = LateRootChangeAuthority {
            root: fixture.authority.root.lock().unwrap().clone(),
            changed_path: changed_path.canonicalize().unwrap(),
            resolutions: AtomicUsize::new(0),
        };

        assert!(matches!(
            fixture.executor().execute(&fixture.plan, &authority),
            Err(ExecutorError::RootChanged)
        ));
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[cfg(unix)]
    #[test]
    fn a_destination_parent_swap_cannot_redirect_the_write_outside_the_root() {
        let fixture = Fixture::new();
        let outside = fixture._temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        let authority = SwapDestinationParentAuthority {
            root: fixture.authority.root.lock().unwrap().clone(),
            destination_parent: fixture.root.join("SET/PROJECT"),
            outside: outside.clone(),
            resolutions: AtomicUsize::new(0),
        };

        assert!(matches!(
            fixture.executor().execute(&fixture.plan, &authority),
            Err(ExecutorError::SymlinkEscape)
        ));
        assert!(!outside.join("kick.wav").exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn a_source_change_during_copy_rolls_back_the_destination() {
        let fixture = Fixture::new();
        let authority = LateSourceChangeAuthority {
            root: fixture.authority.root.lock().unwrap().clone(),
            source: fixture.source.clone(),
            resolutions: AtomicUsize::new(0),
        };

        assert!(matches!(
            fixture.executor().execute(&fixture.plan, &authority),
            Err(ExecutorError::SourceChanged)
        ));
        assert!(!fixture.destination.exists());
        assert_eq!(
            fs::read(&fixture.source).unwrap(),
            b"changed during execution"
        );
    }

    #[test]
    fn every_controlled_fault_rolls_back_without_changing_the_source() {
        for fault in [
            FaultPoint::Prepared,
            FaultPoint::DestinationCreated,
            FaultPoint::DestinationPartialWrite,
            FaultPoint::DestinationWrite,
            FaultPoint::DestinationPublished,
            FaultPoint::Verification,
        ] {
            let fixture = Fixture::new();
            let before = fs::read(&fixture.source).unwrap();
            let result = fixture.executor().execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                fault,
                false,
            );

            assert!(matches!(result, Err(ExecutorError::InjectedFault(_))));
            assert_eq!(fs::read(&fixture.source).unwrap(), before);
            assert!(!fixture.destination.exists());
        }
    }

    #[test]
    fn immediate_rollback_preserves_equal_size_rewritten_published_content() {
        let fixture = Fixture::new();
        let operation_id = OperationId::for_plan(&fixture.plan);
        let target = open_destination_target(
            &fixture.root,
            &fixture.plan.operation.destination_relative_path,
            &operation_id,
        )
        .unwrap();
        let mut destination = create_media_destination(target, &fixture.plan).unwrap();
        copy_payload_to_media(&fixture.source, &mut destination.file, &fixture.plan).unwrap();
        destination.identity = file_identity(&destination.file).unwrap();
        let original_modified = destination.file.metadata().unwrap().modified().unwrap();
        publish_media_destination(&mut destination).unwrap();

        let replacement = vec![b'x'; fixture.source_bytes.len()];
        let mut external = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&fixture.destination)
            .unwrap();
        external.write_all(&replacement).unwrap();
        external.sync_all().unwrap();
        external
            .set_times(std::fs::FileTimes::new().set_modified(original_modified))
            .unwrap();
        assert!(recovery_identity_matches(
            &file_identity(&external).unwrap(),
            &destination.identity,
        ));

        assert!(matches!(
            rollback_media_destination(&destination),
            Err(ExecutorError::RecoveryRequired)
        ));
        assert_eq!(fs::read(&fixture.destination).unwrap(), replacement);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn crash_after_destination_write_is_recovered_from_the_journal() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        assert!(fixture.destination.exists());

        let journal = executor
            .recover_incomplete(&fixture.plan, &fixture.authority)
            .unwrap();

        assert_eq!(journal.status, JournalStatus::RolledBack);
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn recovery_checkpoints_terminal_state_before_staging_cleanup_failure() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        let staging = fixture.local.join("staging").join(operation_id.file_stem());
        fs::write(
            staging.join(STAGING_CLEANUP_FAILURE_SENTINEL),
            b"synthetic cleanup fault",
        )
        .unwrap();

        let recovery = executor.recover_incomplete_operation(
            &fixture.plan.root_id,
            &operation_id,
            &fixture.authority,
        );

        assert!(matches!(recovery, Err(ExecutorError::Io(_))));
        let terminal = executor.operation_journal(&operation_id).unwrap().unwrap();
        assert_eq!(terminal.status, JournalStatus::RolledBack);
        assert_eq!(
            terminal.failure_code.as_deref(),
            Some("RECOVERED_INCOMPLETE_OPERATION")
        );
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn crash_after_publication_before_identity_checkpoint_is_recovered() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationPublished,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        assert!(fixture.destination.exists());
        let pending = executor.operation_journal(&operation_id).unwrap().unwrap();
        assert_eq!(pending.status, JournalStatus::Applying);
        assert!(pending.destination_file_identity.is_some());

        let recovered = executor
            .recover_incomplete_operation(&fixture.plan.root_id, &operation_id, &fixture.authority)
            .unwrap();

        assert_eq!(recovered.status, JournalStatus::RolledBack);
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn journal_bound_recovery_survives_restart_without_a_general_write_grant() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        assert!(fixture.destination.exists());

        let reopened_root_id = RootId::new("root-reopened").unwrap();
        {
            let mut root = fixture.authority.root.lock().unwrap();
            root.root_id = reopened_root_id.clone();
            root.write_enabled = false;
        }

        let journal = executor
            .recover_incomplete_operation(&reopened_root_id, &operation_id, &fixture.authority)
            .unwrap();

        assert_eq!(journal.status, JournalStatus::RolledBack);
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());
        assert!(matches!(
            executor.recover_incomplete_operation(
                &reopened_root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::PlanConsumed)
        ));
    }

    #[test]
    fn recovery_rejects_an_automatically_rolled_back_journal() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                false,
            ),
            Err(ExecutorError::InjectedFault(_))
        ));
        assert!(!fixture.destination.exists());

        assert!(matches!(
            executor.recover_incomplete_operation(
                &fixture.plan.root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::PlanConsumed)
        ));
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn crash_before_the_identity_checkpoint_preserves_the_partial_and_unblocks_new_plans() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        let temporary = fixture
            .root
            .join("SET/PROJECT")
            .join(format!(".masterocta-{}.partial", operation_id.file_stem()));
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationCreated,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        assert_eq!(fs::metadata(&temporary).unwrap().len(), 0);
        let before = fs::read(&temporary).unwrap();
        let pending = executor.operation_journal(&operation_id).unwrap().unwrap();
        assert_eq!(pending.status, JournalStatus::Applying);
        assert!(pending.destination_file_identity.is_none());

        let abandoned = executor
            .recover_incomplete_operation(&fixture.plan.root_id, &operation_id, &fixture.authority)
            .unwrap();

        assert_eq!(abandoned.status, JournalStatus::Abandoned);
        assert_eq!(
            abandoned.failure_code.as_deref(),
            Some(UNIDENTIFIED_PARTIAL_FAILURE)
        );
        assert_eq!(fs::read(&temporary).unwrap(), before);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());

        let next = fixture.plan_for_destination("SET/PROJECT/next.wav", 8);
        let result = executor.execute(&next, &fixture.authority).unwrap();
        assert_eq!(result.journal.status, JournalStatus::Committed);
        assert_eq!(
            fs::read(fixture.root.join("SET/PROJECT/next.wav")).unwrap(),
            fixture.source_bytes
        );
        assert_eq!(fs::read(&temporary).unwrap(), before);
    }

    #[test]
    fn unidentified_nonempty_partial_remains_recovery_required_and_is_never_deleted() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        let temporary = fixture
            .root
            .join("SET/PROJECT")
            .join(format!(".masterocta-{}.partial", operation_id.file_stem()));
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationCreated,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        let replacement = b"unidentified replacement fixture";
        fs::write(&temporary, replacement).unwrap();

        assert!(matches!(
            executor.recover_incomplete_operation(
                &fixture.plan.root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::RecoveryRequired)
        ));

        assert_eq!(fs::read(&temporary).unwrap(), replacement);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        let pending = executor.operation_journal(&operation_id).unwrap().unwrap();
        assert_eq!(pending.status, JournalStatus::RecoveryRequired);
        assert_eq!(pending.failure_code.as_deref(), Some("DESTINATION_CHANGED"));
        assert_eq!(
            executor
                .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn recovery_destination_is_bound_to_the_verified_backup_manifest() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        let victim = fixture.root.join("SET/PROJECT/victim.wav");
        fs::write(&victim, &fixture.source_bytes).unwrap();
        let victim_file = File::open(&victim).unwrap();
        let journal_path = journal_path(
            &fixture.local.join("journals"),
            &OperationId::for_plan(&fixture.plan),
        );
        let mut journal = read_journal(&journal_path).unwrap();
        journal.destination_relative_path = "SET/PROJECT/victim.wav".into();
        journal.destination_file_identity = Some(file_identity(&victim_file).unwrap());
        write_journal(&journal_path, &journal).unwrap();

        assert!(matches!(
            executor.recover_incomplete_operation(
                &fixture.plan.root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::InvalidJournal)
        ));
        assert_eq!(fs::read(&victim).unwrap(), fixture.source_bytes);
        assert_eq!(
            fs::read(&fixture.destination).unwrap(),
            fixture.source_bytes
        );
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn sealed_plan_authorization_rejects_joint_manifest_and_journal_tampering() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));

        let victim = fixture.root.join("SET/PROJECT/victim.wav");
        fs::write(&victim, &fixture.source_bytes).unwrap();
        let victim_identity = file_identity(&File::open(&victim).unwrap()).unwrap();
        let journal_path = journal_path(&fixture.local.join("journals"), &operation_id);
        let mut journal = read_journal(&journal_path).unwrap();
        let snapshot_digest = operation_id
            .as_str()
            .strip_prefix(OPERATION_ID_PREFIX)
            .unwrap();
        let manifest_path = fixture
            .local
            .join("backups")
            .join(snapshot_digest)
            .join("manifest.json");
        let mut manifest: ot_backup::BackupManifest =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest.destination_relative_path = "SET/PROJECT/victim.wav".into();
        manifest.recovery_binding = public_recovery_binding_for_manifest(&manifest);
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        journal.destination_relative_path = manifest.destination_relative_path.clone();
        journal.recovery_binding = manifest.recovery_binding.clone();
        journal.destination_file_identity = Some(victim_identity);
        write_journal(&journal_path, &journal).unwrap();

        let authorization_path = recovery_authorization_path(
            &fixture
                .local
                .join("journals")
                .join(RECOVERY_AUTHORIZATION_DIRECTORY),
            &operation_id,
        );
        assert_eq!(
            fs::metadata(&authorization_path).unwrap().permissions().mode() & 0o222,
            0
        );
        assert!(matches!(
            executor.recover_incomplete_operation(
                &fixture.plan.root_id,
                &operation_id,
                &fixture.authority,
            ),
            Err(ExecutorError::InvalidJournal)
        ));
        assert_eq!(fs::read(&victim).unwrap(), fixture.source_bytes);
        assert_eq!(fs::read(&fixture.destination).unwrap(), fixture.source_bytes);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn recovery_quarantine_preserves_a_destination_replaced_after_verification() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        let target = open_destination_target(
            &fixture.root,
            &fixture.plan.operation.destination_relative_path,
            &operation_id,
        )
        .unwrap();
        let mut verified = open_regular_entry(&target.parent, &target.file_name)
            .unwrap()
            .unwrap();
        let expected_identity = file_identity(&verified).unwrap();
        verify_open_file_matching(
            &mut verified,
            fixture.plan.operation.source.byte_size,
            &fixture.plan.operation.source.content_hash,
        )
        .unwrap();

        let replacement = fixture.root.join("SET/PROJECT/replacement.tmp");
        let replacement_bytes = b"external replacement fixture";
        fs::write(&replacement, replacement_bytes).unwrap();
        fs::rename(&replacement, &fixture.destination).unwrap();

        assert!(matches!(
            quarantine_and_remove_entry(
                &target.parent,
                &target.file_name,
                &target.file_name,
                &target.published_quarantine_name,
                &mut verified,
                &expected_identity,
                Some((
                    fixture.plan.operation.source.byte_size,
                    &fixture.plan.operation.source.content_hash,
                )),
                false,
                false,
            ),
            Err(ExecutorError::RecoveryRequired)
        ));

        assert_eq!(fs::read(&fixture.destination).unwrap(), replacement_bytes);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert!(!fixture
            .destination
            .parent()
            .unwrap()
            .join(&target.published_quarantine_name)
            .exists());
    }

    #[test]
    fn recovery_revalidates_the_root_after_locking_and_immediately_before_mutation() {
        for change_at_resolution in [2, 3] {
            let fixture = Fixture::new();
            let executor = fixture.executor();
            let operation_id = OperationId::for_plan(&fixture.plan);
            assert!(matches!(
                executor.execute_with_fault(
                    &fixture.plan,
                    &fixture.authority,
                    FaultPoint::DestinationWrite,
                    true,
                ),
                Err(ExecutorError::SimulatedCrash)
            ));

            let replacement_root = fixture
                ._temp
                .path()
                .join(format!("replacement-{change_at_resolution}"));
            fs::create_dir_all(replacement_root.join("SET/PROJECT")).unwrap();
            let replacement_destination = replacement_root.join("SET/PROJECT/kick.wav");
            fs::write(&replacement_destination, &fixture.source_bytes).unwrap();
            let root = fixture.authority.root.lock().unwrap().clone();
            let initial = ApprovedRecoveryRoot {
                root_id: root.root_id.clone(),
                device_fingerprint: root.device_fingerprint.clone(),
                canonical_path: root.canonical_path,
                stable_device_identity: true,
            };
            let authority = ChangingRecoveryAuthority {
                initial: initial.clone(),
                changed: ApprovedRecoveryRoot {
                    canonical_path: replacement_root.canonicalize().unwrap(),
                    ..initial
                },
                change_at_resolution,
                resolutions: AtomicUsize::new(0),
            };

            assert!(matches!(
                executor.recover_incomplete_operation(
                    &fixture.plan.root_id,
                    &operation_id,
                    &authority,
                ),
                Err(ExecutorError::RootChanged)
            ));
            assert_eq!(
                fs::read(&fixture.destination).unwrap(),
                fixture.source_bytes
            );
            assert_eq!(
                fs::read(&replacement_destination).unwrap(),
                fixture.source_bytes
            );
            assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        }
    }

    #[test]
    fn journal_bound_recovery_preserves_media_when_the_verified_backup_changed() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        let snapshot_digest = operation_id
            .as_str()
            .strip_prefix(OPERATION_ID_PREFIX)
            .unwrap();
        fs::write(
            fixture
                .local
                .join("backups")
                .join(snapshot_digest)
                .join("files/SET/AUDIO/kick.wav"),
            b"tampered local backup",
        )
        .unwrap();

        let recovery = executor.recover_incomplete_operation(
            &fixture.plan.root_id,
            &operation_id,
            &fixture.authority,
        );

        assert!(matches!(
            recovery,
            Err(ExecutorError::Backup(BackupError::VerificationFailed(_)))
        ));
        assert_eq!(
            fs::read(&fixture.destination).unwrap(),
            fixture.source_bytes
        );
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn recovery_queries_surface_only_incomplete_journals_for_the_bound_root() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));

        let journal = executor.operation_journal(&operation_id).unwrap().unwrap();
        assert_eq!(journal.operation_id, operation_id.as_str());
        let incomplete = executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap();
        assert_eq!(incomplete.len(), 1);
        assert_eq!(incomplete[0].operation_id, operation_id.as_str());
        assert!(executor
            .incomplete_journals_for_root(&format!("rootfp:v1:{}", "b".repeat(64)))
            .unwrap()
            .is_empty());

        executor
            .recover_incomplete(&fixture.plan, &fixture.authority)
            .unwrap();
        assert!(executor
            .incomplete_journals_for_root(&fixture.plan.device_fingerprint)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn crash_during_destination_write_removes_only_the_recorded_partial_file() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        let temporary = fixture
            .root
            .join("SET/PROJECT")
            .join(format!(".masterocta-{}.partial", operation_id.file_stem()));
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationPartialWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        assert!(temporary.exists());
        assert!(!fixture.destination.exists());

        let journal = executor
            .recover_incomplete(&fixture.plan, &fixture.authority)
            .unwrap();

        assert_eq!(journal.status, JournalStatus::RolledBack);
        assert!(!temporary.exists());
        assert!(!fixture.destination.exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn recovery_never_deletes_a_replacement_at_the_destination_path() {
        let fixture = Fixture::new();
        let executor = fixture.executor();
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        fs::remove_file(&fixture.destination).unwrap();
        let replacement = vec![b'x'; fixture.source_bytes.len()];
        fs::write(&fixture.destination, &replacement).unwrap();

        let operation_id = OperationId::for_plan(&fixture.plan);
        let recovery = executor.recover_incomplete_operation(
            &fixture.plan.root_id,
            &operation_id,
            &fixture.authority,
        );
        assert!(
            matches!(recovery, Err(ExecutorError::RecoveryRequired)),
            "unexpected recovery result: {recovery:?}"
        );
        assert_eq!(fs::read(&fixture.destination).unwrap(), replacement);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[cfg(unix)]
    #[test]
    fn recovery_rejects_a_symlinked_operation_staging_directory_before_media_mutation() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let executor = fixture.executor();
        let operation_id = OperationId::for_plan(&fixture.plan);
        assert!(matches!(
            executor.execute_with_fault(
                &fixture.plan,
                &fixture.authority,
                FaultPoint::DestinationWrite,
                true,
            ),
            Err(ExecutorError::SimulatedCrash)
        ));
        let staging = fixture.local.join("staging").join(operation_id.file_stem());
        fs::remove_dir_all(&staging).unwrap();
        let outside = fixture._temp.path().join("outside-staging");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, &staging).unwrap();

        let recovery = executor.recover_incomplete_operation(
            &fixture.plan.root_id,
            &operation_id,
            &fixture.authority,
        );

        assert!(matches!(recovery, Err(ExecutorError::UnsafePath)));
        assert_eq!(
            fs::read(&fixture.destination).unwrap(),
            fixture.source_bytes
        );
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }

    #[test]
    fn an_orphaned_regular_journal_temporary_does_not_block_safe_execution() {
        let fixture = Fixture::new();
        let operation_id = OperationId::for_plan(&fixture.plan);
        let journal_directory = fixture.local.join("journals");
        fs::create_dir_all(&journal_directory).unwrap();
        let temporary = journal_directory.join(format!("{}.json.tmp", operation_id.file_stem()));
        fs::write(&temporary, b"incomplete journal write").unwrap();

        let result = fixture
            .executor()
            .execute(&fixture.plan, &fixture.authority)
            .unwrap();

        assert_eq!(result.journal.status, JournalStatus::Committed);
        assert!(!temporary.exists());
        assert_eq!(
            fs::read(&fixture.destination).unwrap(),
            fixture.source_bytes
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_destination_parent_is_rejected_without_touching_the_target() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = fixture._temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::remove_dir(fixture.root.join("SET/PROJECT")).unwrap();
        symlink(&outside, fixture.root.join("SET/PROJECT")).unwrap();

        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::SymlinkEscape)
        ));
        assert!(!outside.join("kick.wav").exists());
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
    }

    #[test]
    fn local_state_is_never_written_inside_the_approved_root() {
        let fixture = Fixture::new();
        let executor = AdditiveCopyExecutor::new(ExecutorLocalPaths {
            staging_directory: fixture.root.join(".masterocta/staging"),
            backup_directory: fixture.root.join(".masterocta/backups"),
            journal_directory: fixture.root.join(".masterocta/journals"),
        });

        assert!(matches!(
            executor.execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::LocalStateInsideRoot)
        ));
        assert!(!fixture.destination.exists());
        assert!(!fixture.root.join(".masterocta").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_lock_directory_cannot_redirect_local_state_onto_the_root() {
        let fixture = Fixture::new();
        let journals = fixture.local.join("journals");
        fs::create_dir_all(&journals).unwrap();
        std::os::unix::fs::symlink(fixture.root.join("SET/PROJECT"), journals.join("locks"))
            .unwrap();

        assert!(matches!(
            fixture
                .executor()
                .execute(&fixture.plan, &fixture.authority),
            Err(ExecutorError::SymlinkEscape)
        ));
        assert!(fs::read_dir(fixture.root.join("SET/PROJECT"))
            .unwrap()
            .next()
            .is_none());
        assert!(!fixture.destination.exists());
    }
}
