#![forbid(unsafe_code)]

use fs2::FileExt;
use ot_backup::{BackupError, BackupStore, SnapshotId, VerifiedBackup};
use ot_domain::{ContentHash, RootId, RootRelativePath};
use ot_plan::{ChangePlan, PlanId};
use rustix::fs::{self as descriptor_fs, AtFlags, Mode, OFlags, RenameFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

const JOURNAL_SCHEMA: &str = "masterocta-operation-journal:v2";
const OPERATION_ID_PREFIX: &str = "operation:v1:";

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
}

struct MediaDestination {
    target: DestinationTarget,
    file: File,
    identity: JournalFileIdentity,
    published: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalStatus {
    Prepared,
    Applying,
    Verifying,
    Committed,
    RolledBack,
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
    pub destination_file_identity: Option<JournalFileIdentity>,
    pub status: JournalStatus,
    pub failure_code: Option<String>,
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
            JournalStatus::Committed | JournalStatus::RolledBack => {
                return Ok(journal);
            }
            JournalStatus::RecoveryRequired
            | JournalStatus::Prepared
            | JournalStatus::Applying
            | JournalStatus::Verifying => {}
        }

        let target = open_destination_target(
            &root.canonical_path,
            &plan.operation.destination_relative_path,
            &operation_id,
        )?;
        if let Err(error) = recover_media_destination(&target, &journal, plan) {
            journal.status = JournalStatus::RecoveryRequired;
            journal.failure_code = Some("DESTINATION_CHANGED".into());
            write_journal(&journal_path, &journal)?;
            return Err(error);
        }
        cleanup_staging(&self.local_paths.staging_directory, &operation_id)?;
        journal.status = JournalStatus::RolledBack;
        journal.failure_code = Some("RECOVERED_INCOMPLETE_OPERATION".into());
        write_journal(&journal_path, &journal)?;
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
            if name.to_str() == Some("locks") {
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
                    JournalStatus::Committed | JournalStatus::RolledBack
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
        let journal_path = journal_path(&journal_directory, &operation_id);
        if journal_path.exists() {
            let journal = read_journal(&journal_path)?;
            return Err(match journal.status {
                JournalStatus::Committed | JournalStatus::RolledBack => ExecutorError::PlanConsumed,
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
        let mut journal = new_journal(plan, &operation_id, backup.snapshot_id());
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
        let mut media_destination = match create_media_destination(destination_target) {
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
    DestinationPartialWrite,
    DestinationWrite,
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
    let metadata = fs::symlink_metadata(&root.canonical_path).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutorError::UnsafePath);
    }
    let canonical = root
        .canonical_path
        .canonicalize()
        .map_err(ExecutorError::io)?;
    if canonical != root.canonical_path {
        return Err(ExecutorError::UnsafePath);
    }
    Ok(root)
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

fn create_media_destination(target: DestinationTarget) -> Result<MediaDestination, ExecutorError> {
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
    file.seek(SeekFrom::Start(0)).map_err(ExecutorError::io)?;
    let (size, hash) = hash_reader(file)?;
    if size == plan.operation.source.byte_size && hash == plan.operation.source.content_hash {
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

fn same_open_directory(left: &File, right: &File) -> Result<bool, ExecutorError> {
    Ok(file_identity(left)? == file_identity(right)?)
}

fn rollback_media_destination(destination: &MediaDestination) -> Result<(), ExecutorError> {
    let name = if destination.published {
        &destination.target.file_name
    } else {
        &destination.target.temporary_name
    };
    if let Some(current) = open_regular_entry(&destination.target.parent, name)? {
        if !same_file_identity(&current, &destination.identity)? {
            return Err(ExecutorError::RecoveryRequired);
        }
        descriptor_fs::unlinkat(&destination.target.parent, name.as_str(), AtFlags::empty())
            .map_err(|error| ExecutorError::io(std::io::Error::from(error)))?;
        destination
            .target
            .parent
            .sync_all()
            .map_err(ExecutorError::io)?;
    }
    Ok(())
}

fn recover_media_destination(
    target: &DestinationTarget,
    journal: &OperationJournal,
    plan: &ChangePlan,
) -> Result<(), ExecutorError> {
    let destination = open_regular_entry(&target.parent, &target.file_name)?;
    let temporary = open_regular_entry(&target.parent, &target.temporary_name)?;
    let (name, mut file, published) = match (destination, temporary) {
        (None, None) => return Ok(()),
        (Some(_), Some(_)) => return Err(ExecutorError::RecoveryRequired),
        (Some(file), None) => (&target.file_name, file, true),
        (None, Some(file)) => (&target.temporary_name, file, false),
    };
    let expected = journal
        .destination_file_identity
        .as_ref()
        .ok_or(ExecutorError::RecoveryRequired)?;
    if !same_file_identity(&file, expected)? {
        return Err(ExecutorError::RecoveryRequired);
    }
    if published && verify_open_file(&mut file, plan).is_err() {
        return Err(ExecutorError::RecoveryRequired);
    }
    descriptor_fs::unlinkat(&target.parent, name.as_str(), AtFlags::empty())
        .map_err(|error| ExecutorError::io(std::io::Error::from(error)))?;
    target.parent.sync_all().map_err(ExecutorError::io)
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
    snapshot_id: &SnapshotId,
) -> OperationJournal {
    OperationJournal {
        schema: JOURNAL_SCHEMA.into(),
        operation_id: operation_id.as_str().into(),
        plan_id: plan.id.as_str().into(),
        root_fingerprint: plan.device_fingerprint.clone(),
        base_observed_revision: plan.base_observed_revision,
        source_relative_path: plan.operation.source.relative_path.as_str().into(),
        destination_relative_path: plan.operation.destination_relative_path.as_str().into(),
        backup_snapshot_id: snapshot_id.as_str().into(),
        destination_file_identity: None,
        status: JournalStatus::Prepared,
        failure_code: None,
    }
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
    serde_json::from_reader(file).map_err(|error| ExecutorError::Journal(error.to_string()))
}

fn validate_standalone_journal(
    journal: &OperationJournal,
    operation_id: &OperationId,
    path: &Path,
) -> Result<(), ExecutorError> {
    if journal.schema != JOURNAL_SCHEMA
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
        || RootRelativePath::parse(&journal.source_relative_path).is_err()
        || RootRelativePath::parse(&journal.destination_relative_path).is_err()
        || journal.source_relative_path == journal.destination_relative_path
    {
        return Err(ExecutorError::InvalidJournal);
    }
    validate_root_fingerprint(&journal.root_fingerprint).map_err(|_| ExecutorError::InvalidJournal)
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

fn validate_journal(
    journal: &OperationJournal,
    plan: &ChangePlan,
    operation_id: &OperationId,
) -> Result<(), ExecutorError> {
    if journal.schema != JOURNAL_SCHEMA
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
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(ExecutorError::io)?;
        sync_directory(base)?;
    }
    Ok(())
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
            schema: "masterocta-backup:v1".into(),
            snapshot_id: snapshot_id.as_str().into(),
            plan_id: format!("plan:v1:{}", "b".repeat(64)),
            source_fingerprint: format!("rootfp:v1:{}", "c".repeat(64)),
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
            Err(ExecutorError::Backup(BackupError::PlanBindingMismatch))
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
            FaultPoint::DestinationPartialWrite,
            FaultPoint::DestinationWrite,
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

        let recovery = executor.recover_incomplete(&fixture.plan, &fixture.authority);
        assert!(
            matches!(recovery, Err(ExecutorError::RecoveryRequired)),
            "unexpected recovery result: {recovery:?}"
        );
        assert_eq!(fs::read(&fixture.destination).unwrap(), replacement);
        assert_eq!(fs::read(&fixture.source).unwrap(), fixture.source_bytes);
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
