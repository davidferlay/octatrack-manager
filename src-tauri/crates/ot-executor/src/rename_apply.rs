#![forbid(unsafe_code)]

use crate::rename_prepare::{
    hash_bytes, populate_rename_staging, prepare_rename_subdirectory, read_rename_authorization,
    read_rename_journal, remove_orphaned_rename_directory, replace_rename_json,
    validate_rename_authority, validate_rename_plan_shape, RenameJournalStatus,
    RenameOperationJournal, RenameProjectRewriteRecord, RenameRecoveryAuthorization,
    RenameSampleExecutor, RenameStagedFileRecord, RenameStagedFileRole,
    RENAME_AUTHORIZATION_DIRECTORY,
};
use crate::{
    acquire_root_lock, open_root_regular_file, prepare_local_directory, validate_canonical_root,
    ApprovedExecutionRoot, ApprovedRecoveryRoot, AuthorityError, ExecutorError, OperationId,
    RecoveryAuthority, RootId, RENAME_JOURNAL_DIRECTORY,
};
use ot_backup::{
    recovery_binding_for_rename_plan, BackupStore, RenameBackupFileRole, SnapshotId,
    VerifiedRenameBackup,
};
use ot_codec_ports::ProjectReferenceCodec;
use ot_domain::{ContentHash, RootRelativePath};
use ot_plan::{PlanId, RenameImpactPlan};
use rustix::fs::{self as descriptor_fs, AtFlags, Dir, Mode, OFlags, RenameFlags};

/// Temporary/cloned execution root. Distinct from [`ApprovedExecutionRoot`] so
/// apply cannot target a live mounted volume through a generic write grant.
#[derive(Clone, Debug)]
pub struct VerifiedCloneRoot {
    inner: ApprovedExecutionRoot,
}

impl VerifiedCloneRoot {
    /// Attest that `root` is a temporary copy, not original removable media.
    ///
    /// Callers must have copied the original into this tree first. The type
    /// system is the gate: [`RenameSampleExecutor::apply`] accepts only this
    /// capability, not a generic [`WriteAuthority`].
    pub fn attest_temporary_copy(root: ApprovedExecutionRoot) -> Self {
        Self { inner: root }
    }

    pub fn as_execution_root(&self) -> &ApprovedExecutionRoot {
        &self.inner
    }
}

/// Write authority that can only mint a [`VerifiedCloneRoot`].
pub trait CloneWriteAuthority {
    fn resolve_clone_for_write(
        &self,
        root_id: &RootId,
    ) -> Result<VerifiedCloneRoot, AuthorityError>;
}

/// Historical identity carried by a prepared rename plan.
///
/// This stays separate from [`ApprovedExecutionRoot`]: historical identity
/// must never be combined with a current filesystem path.
#[derive(Clone, Debug)]
pub struct HistoricalRenamePlanRoot {
    plan_id: PlanId,
    root_id: RootId,
    device_fingerprint: String,
    observed_revision: u64,
}

impl HistoricalRenamePlanRoot {
    pub fn new(
        plan_id: PlanId,
        root_id: RootId,
        device_fingerprint: String,
        observed_revision: u64,
    ) -> Self {
        Self {
            plan_id,
            root_id,
            device_fingerprint,
            observed_revision,
        }
    }
}

/// Explicit binding between historical plan evidence and the current,
/// independently verified clone root.
#[derive(Clone, Debug)]
pub struct VerifiedContinuationCloneRoot {
    historical: HistoricalRenamePlanRoot,
    current: ApprovedExecutionRoot,
}

impl VerifiedContinuationCloneRoot {
    pub fn attest_temporary_copy(
        historical: HistoricalRenamePlanRoot,
        current: ApprovedExecutionRoot,
    ) -> Self {
        Self {
            historical,
            current,
        }
    }
}

/// Continuation authority that resolves historical evidence separately from
/// the current verified clone root.
pub trait ContinuedCloneWriteAuthority {
    fn resolve_continued_clone_for_write(
        &self,
        plan_id: &PlanId,
        historical_root_id: &RootId,
    ) -> Result<VerifiedContinuationCloneRoot, AuthorityError>;
}
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct RenameApplyResult {
    pub operation_id: OperationId,
    pub journal: RenameOperationJournal,
    pub authorization: RenameRecoveryAuthorization,
}

#[cfg(feature = "test-seams")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenameApplyFault {
    DestinationPublished,
    ProjectReplaced,
    SourceQuarantined,
}

#[cfg(not(feature = "test-seams"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ApplyFault {
    DestinationPublished,
    ProjectReplaced,
    SourceQuarantined,
}

#[cfg(feature = "test-seams")]
type ApplyFault = RenameApplyFault;

struct PublishedNewFile {
    relative_path: RootRelativePath,
    staged_hash: ContentHash,
}

struct ReplacedExistingFile {
    relative_path: RootRelativePath,
    staged_hash: ContentHash,
}

struct QuarantinedSource {
    relative_path: RootRelativePath,
    backup_hash: ContentHash,
    sibling_stem: String,
}

impl RenameSampleExecutor {
    pub fn apply<C, A>(
        &self,
        plan: &RenameImpactPlan,
        codec: &C,
        authority: &A,
    ) -> Result<RenameApplyResult, ExecutorError>
    where
        C: ProjectReferenceCodec,
        A: CloneWriteAuthority,
    {
        self.apply_internal(
            plan,
            codec,
            || resolve_clone_write_authority(plan, authority),
            None,
        )
    }

    pub fn apply_continued<C, A>(
        &self,
        plan: &RenameImpactPlan,
        codec: &C,
        authority: &A,
    ) -> Result<RenameApplyResult, ExecutorError>
    where
        C: ProjectReferenceCodec,
        A: ContinuedCloneWriteAuthority,
    {
        self.apply_internal(
            plan,
            codec,
            || resolve_continued_clone_write_authority(plan, authority),
            None,
        )
    }

    pub fn rollback<A: RecoveryAuthority>(
        &self,
        live_root_id: &RootId,
        operation_id: &OperationId,
        authority: &A,
    ) -> Result<RenameOperationJournal, ExecutorError> {
        let initial_root = authority
            .resolve_for_recovery(live_root_id)
            .map_err(ExecutorError::Authority)?;
        let initial_root = validate_rename_recovery_authority(live_root_id, initial_root)?;
        let journal_directory = prepare_local_directory(
            &self.local_paths.journal_directory,
            &initial_root.canonical_path,
        )?;
        let backup_directory = prepare_local_directory(
            &self.local_paths.backup_directory,
            &initial_root.canonical_path,
        )?;
        let _lock = acquire_root_lock(&journal_directory, &initial_root.device_fingerprint)?;
        let root = revalidate_rename_recovery_authority(live_root_id, &initial_root, authority)?;
        let (journal_path, mut journal, authorization) =
            load_rename_artifacts(&journal_directory, operation_id)?;
        if journal.root_fingerprint != root.device_fingerprint
            || authorization.root_fingerprint != root.device_fingerprint
        {
            return Err(ExecutorError::RootChanged);
        }
        match journal.status {
            RenameJournalStatus::Prepared => {
                journal.status = RenameJournalStatus::RolledBack;
                journal.failure_code = Some("ROLLED_BACK_BEFORE_APPLY".into());
                replace_rename_json(&journal_path, &journal)?;
                return Ok(journal);
            }
            RenameJournalStatus::Applying | RenameJournalStatus::RecoveryRequired => {}
            RenameJournalStatus::Committed | RenameJournalStatus::RolledBack => {
                return Err(ExecutorError::PlanConsumed);
            }
        }
        let snapshot_id =
            SnapshotId::parse(journal.backup_snapshot_id.clone()).map_err(ExecutorError::Backup)?;
        let backup = BackupStore::new(backup_directory)
            .verify_rename_snapshot(&snapshot_id)
            .map_err(ExecutorError::Backup)?;
        if backup.manifest().recovery_binding != journal.recovery_binding
            || backup.manifest().recovery_binding != authorization.recovery_binding
            || backup.manifest().root_fingerprint != journal.root_fingerprint
        {
            return Err(ExecutorError::InvalidJournal);
        }
        let root = revalidate_rename_recovery_authority(live_root_id, &root, authority)?;
        rollback_clone_root(&root.canonical_path, &authorization, &backup, operation_id)?;
        journal.status = RenameJournalStatus::RolledBack;
        journal.failure_code = Some("EXPLICIT_ROLLBACK".into());
        replace_rename_json(&journal_path, &journal)?;
        Ok(journal)
    }

    #[cfg(feature = "test-seams")]
    pub fn apply_with_fault<C, A>(
        &self,
        plan: &RenameImpactPlan,
        codec: &C,
        authority: &A,
        fault: ApplyFault,
    ) -> Result<RenameApplyResult, ExecutorError>
    where
        C: ProjectReferenceCodec,
        A: CloneWriteAuthority,
    {
        self.apply_internal(
            plan,
            codec,
            || resolve_clone_write_authority(plan, authority),
            Some(fault),
        )
    }

    fn apply_internal<C, F>(
        &self,
        plan: &RenameImpactPlan,
        codec: &C,
        mut resolve_root: F,
        fault: Option<ApplyFault>,
    ) -> Result<RenameApplyResult, ExecutorError>
    where
        C: ProjectReferenceCodec,
        F: FnMut() -> Result<ApprovedExecutionRoot, ExecutorError>,
    {
        validate_rename_plan_shape(plan)?;
        let operation_id = OperationId::for_rename_plan(plan);
        let initial_clone = resolve_root()?;
        let staging_base = prepare_local_directory(
            &self.local_paths.staging_directory,
            &initial_clone.canonical_path,
        )?;
        let journal_directory = prepare_local_directory(
            &self.local_paths.journal_directory,
            &initial_clone.canonical_path,
        )?;
        let backup_directory = prepare_local_directory(
            &self.local_paths.backup_directory,
            &initial_clone.canonical_path,
        )?;
        let _lock = acquire_root_lock(&journal_directory, &plan.device_fingerprint)?;
        let clone_root = revalidate_apply_root(&initial_clone, &mut resolve_root)?;

        let (journal_path, mut journal, authorization) =
            load_prepared_artifacts(&journal_directory, plan, &operation_id)?;
        if journal.status != RenameJournalStatus::Prepared {
            return Err(match journal.status {
                RenameJournalStatus::Committed | RenameJournalStatus::RolledBack => {
                    ExecutorError::PlanConsumed
                }
                _ => ExecutorError::RecoveryRequired,
            });
        }

        let backup = BackupStore::new(backup_directory)
            .verify_for_rename_plan(plan)
            .map_err(ExecutorError::Backup)?;
        if backup.manifest().recovery_binding != authorization.recovery_binding
            || backup.manifest().recovery_binding
                != recovery_binding_for_rename_plan(plan).map_err(ExecutorError::Backup)?
        {
            return Err(ExecutorError::InvalidJournal);
        }

        let verify_root = rebuild_from_backup(
            &staging_base,
            &operation_id,
            plan,
            codec,
            backup.directory(),
            &journal.staged_files,
            &journal.project_rewrites,
            &authorization,
        )?;

        if let Err(error) = verify_live_preconditions(&clone_root.canonical_path, plan) {
            let _ = remove_orphaned_rename_directory(&verify_root);
            return Err(error);
        }

        journal.status = RenameJournalStatus::Applying;
        journal.failure_code = None;
        if let Err(error) = replace_rename_json(&journal_path, &journal) {
            let _ = remove_orphaned_rename_directory(&verify_root);
            return Err(error);
        }

        let clone_root = match revalidate_apply_root(&clone_root, &mut resolve_root) {
            Ok(root) => root,
            Err(error) => {
                let _ = remove_orphaned_rename_directory(&verify_root);
                return persist_apply_failure(
                    &journal_path,
                    journal,
                    &clone_root.canonical_path,
                    &authorization,
                    &backup,
                    &operation_id,
                    error,
                );
            }
        };

        let outcome = apply_to_clone(
            &clone_root.canonical_path,
            plan,
            &verify_root,
            &authorization,
            backup.directory(),
            &operation_id,
            fault,
        );
        let _ = remove_orphaned_rename_directory(&verify_root);
        match outcome {
            Ok(()) => {
                journal.status = RenameJournalStatus::Committed;
                journal.failure_code = None;
                if let Err(error) = replace_rename_json(&journal_path, &journal) {
                    return persist_apply_failure(
                        &journal_path,
                        journal,
                        &clone_root.canonical_path,
                        &authorization,
                        &backup,
                        &operation_id,
                        error,
                    );
                }
                Ok(RenameApplyResult {
                    operation_id,
                    journal,
                    authorization,
                })
            }
            Err(error) => persist_apply_failure(
                &journal_path,
                journal,
                &clone_root.canonical_path,
                &authorization,
                &backup,
                &operation_id,
                error,
            ),
        }
    }
}

fn persist_apply_failure(
    journal_path: &Path,
    mut journal: RenameOperationJournal,
    root: &Path,
    authorization: &RenameRecoveryAuthorization,
    backup: &VerifiedRenameBackup,
    operation_id: &OperationId,
    error: ExecutorError,
) -> Result<RenameApplyResult, ExecutorError> {
    match rollback_clone_root(root, authorization, backup, operation_id) {
        Ok(()) => {
            journal.status = RenameJournalStatus::RolledBack;
            journal.failure_code = Some(error.code().into());
            replace_rename_json(journal_path, &journal)?;
            Err(error)
        }
        Err(_) => {
            journal.status = RenameJournalStatus::RecoveryRequired;
            journal.failure_code = Some("ROLLBACK_CLONE_CHANGED".into());
            let _ = replace_rename_json(journal_path, &journal);
            Err(ExecutorError::RecoveryRequired)
        }
    }
}

fn resolve_clone_write_authority<A: CloneWriteAuthority>(
    plan: &RenameImpactPlan,
    authority: &A,
) -> Result<ApprovedExecutionRoot, ExecutorError> {
    let clone = authority
        .resolve_clone_for_write(&plan.root_id)
        .map_err(ExecutorError::Authority)?;
    validate_rename_authority(plan, clone.as_execution_root().clone())
}

fn resolve_continued_clone_write_authority<A: ContinuedCloneWriteAuthority>(
    plan: &RenameImpactPlan,
    authority: &A,
) -> Result<ApprovedExecutionRoot, ExecutorError> {
    let continuation = authority
        .resolve_continued_clone_for_write(&plan.id, &plan.root_id)
        .map_err(ExecutorError::Authority)?;
    let historical = &continuation.historical;
    if historical.plan_id != plan.id
        || historical.root_id != plan.root_id
        || historical.device_fingerprint != plan.device_fingerprint
        || historical.observed_revision != plan.base_observed_revision
    {
        return Err(ExecutorError::RootChanged);
    }
    let current = continuation.current;
    if current.device_fingerprint != historical.device_fingerprint {
        return Err(ExecutorError::RootChanged);
    }
    validate_current_clone_root(current)
}

fn validate_current_clone_root(
    root: ApprovedExecutionRoot,
) -> Result<ApprovedExecutionRoot, ExecutorError> {
    if !root.write_enabled {
        return Err(ExecutorError::Authority(AuthorityError::ReadOnly));
    }
    if !root.stable_device_identity {
        return Err(ExecutorError::Authority(AuthorityError::UnstableIdentity));
    }
    validate_canonical_root(&root.canonical_path)?;
    Ok(root)
}

fn revalidate_apply_root<F>(
    expected: &ApprovedExecutionRoot,
    resolve_root: &mut F,
) -> Result<ApprovedExecutionRoot, ExecutorError>
where
    F: FnMut() -> Result<ApprovedExecutionRoot, ExecutorError>,
{
    let current = resolve_root()?;
    if current.root_id != expected.root_id
        || current.device_fingerprint != expected.device_fingerprint
        || current.observed_revision != expected.observed_revision
        || current.canonical_path != expected.canonical_path
    {
        return Err(ExecutorError::RootChanged);
    }
    Ok(current)
}

fn validate_rename_recovery_authority(
    live_root_id: &RootId,
    root: ApprovedRecoveryRoot,
) -> Result<ApprovedRecoveryRoot, ExecutorError> {
    if &root.root_id != live_root_id {
        return Err(ExecutorError::RootChanged);
    }
    if !root.stable_device_identity {
        return Err(ExecutorError::Authority(AuthorityError::UnstableIdentity));
    }
    validate_canonical_root(&root.canonical_path)?;
    Ok(root)
}

fn revalidate_rename_recovery_authority<A: RecoveryAuthority>(
    live_root_id: &RootId,
    expected: &ApprovedRecoveryRoot,
    authority: &A,
) -> Result<ApprovedRecoveryRoot, ExecutorError> {
    let current = authority
        .resolve_for_recovery(live_root_id)
        .map_err(ExecutorError::Authority)?;
    let current = validate_rename_recovery_authority(live_root_id, current)?;
    if current.root_id != expected.root_id
        || current.device_fingerprint != expected.device_fingerprint
        || current.canonical_path != expected.canonical_path
    {
        return Err(ExecutorError::RootChanged);
    }
    Ok(current)
}

fn load_prepared_artifacts(
    journal_directory: &Path,
    plan: &RenameImpactPlan,
    operation_id: &OperationId,
) -> Result<(PathBuf, RenameOperationJournal, RenameRecoveryAuthorization), ExecutorError> {
    let (journal_path, journal, authorization) =
        load_rename_artifacts(journal_directory, operation_id)?;
    if journal.plan_id != plan.id.as_str()
        || journal.source_relative_path != plan.source_relative_path.as_str()
        || journal.destination_relative_path != plan.destination_relative_path.as_str()
        || authorization.root_id != plan.root_id.as_str()
        || authorization.source_relative_path != plan.source_relative_path.as_str()
        || authorization.source_content_hash != plan.source_content_hash.as_str()
    {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok((journal_path, journal, authorization))
}

fn load_rename_artifacts(
    journal_directory: &Path,
    operation_id: &OperationId,
) -> Result<(PathBuf, RenameOperationJournal, RenameRecoveryAuthorization), ExecutorError> {
    let rename_journal_directory =
        prepare_rename_subdirectory(journal_directory, RENAME_JOURNAL_DIRECTORY)?;
    let authorization_directory =
        prepare_rename_subdirectory(&rename_journal_directory, RENAME_AUTHORIZATION_DIRECTORY)?;
    let journal_path = rename_journal_directory.join(format!("{}.json", operation_id.file_stem()));
    let journal = match fs::symlink_metadata(&journal_path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ExecutorError::UnsafePath);
        }
        Ok(_) => read_rename_journal(&journal_path)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ExecutorError::InvalidJournal);
        }
        Err(error) => return Err(ExecutorError::io(error)),
    };
    if journal.operation_id != operation_id.as_str() {
        return Err(ExecutorError::InvalidJournal);
    }
    let authorization_path =
        authorization_directory.join(format!("{}.json", operation_id.file_stem()));
    let authorization = read_rename_authorization(&authorization_path)?;
    if authorization.operation_id != journal.operation_id
        || authorization.plan_id != journal.plan_id
        || authorization.staged_files != journal.staged_files
        || authorization.project_rewrites != journal.project_rewrites
        || authorization.backup_snapshot_id != journal.backup_snapshot_id
        || authorization.recovery_binding != journal.recovery_binding
        || authorization.source_relative_path != journal.source_relative_path
        || authorization.destination_relative_path != journal.destination_relative_path
        || authorization.root_fingerprint != journal.root_fingerprint
    {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok((journal_path, journal, authorization))
}

#[allow(clippy::too_many_arguments)]
fn rebuild_from_backup<C: ProjectReferenceCodec>(
    staging_base: &Path,
    operation_id: &OperationId,
    plan: &RenameImpactPlan,
    codec: &C,
    backup_directory: &Path,
    staged_files: &[RenameStagedFileRecord],
    project_rewrites: &[RenameProjectRewriteRecord],
    authorization: &RenameRecoveryAuthorization,
) -> Result<PathBuf, ExecutorError> {
    let staging_rename = prepare_rename_subdirectory(staging_base, RENAME_JOURNAL_DIRECTORY)?;
    let verify_root = staging_rename.join(format!("{}.apply-verify", operation_id.file_stem()));
    remove_orphaned_rename_directory(&verify_root)?;
    fs::create_dir(&verify_root).map_err(ExecutorError::io)?;
    let files_root = verify_root.join("files");
    fs::create_dir(&files_root).map_err(ExecutorError::io)?;
    let rebuilt = match populate_rename_staging(plan, codec, backup_directory, &files_root) {
        Ok(rebuilt) => rebuilt,
        Err(error) => {
            let _ = remove_orphaned_rename_directory(&verify_root);
            return Err(error);
        }
    };
    if rebuilt.0 != staged_files
        || rebuilt.1 != project_rewrites
        || rebuilt.0 != authorization.staged_files
        || rebuilt.1 != authorization.project_rewrites
    {
        let _ = remove_orphaned_rename_directory(&verify_root);
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(verify_root)
}

fn verify_live_preconditions(root: &Path, plan: &RenameImpactPlan) -> Result<(), ExecutorError> {
    verify_live_hash(
        root,
        &plan.source_relative_path,
        &plan.source_content_hash,
        plan.source_byte_size,
    )?;
    assert_destination_available(root, &plan.destination_relative_path)?;
    for sidecar in &plan.sidecar_impacts {
        verify_live_hash(
            root,
            &sidecar.source_sidecar_relative_path,
            &sidecar.content_hash,
            sidecar.byte_size,
        )?;
        assert_destination_available(root, &sidecar.destination_sidecar_relative_path)?;
    }
    for document in &plan.state_document_impacts {
        verify_live_hash(
            root,
            &document.relative_path,
            &document.content_hash,
            document.byte_size,
        )?;
    }
    Ok(())
}

fn assert_destination_available(
    root: &Path,
    destination: &RootRelativePath,
) -> Result<(), ExecutorError> {
    if live_file_exists(root, destination)? {
        return Err(ExecutorError::DestinationExists);
    }
    reject_ascii_case_collision(root, destination)
}

fn reject_ascii_case_collision(
    root: &Path,
    destination: &RootRelativePath,
) -> Result<(), ExecutorError> {
    let (parent, dest_name) = open_parent(root, destination)?;
    let listing = parent.try_clone().map_err(ExecutorError::io)?;
    let mut entries = Dir::read_from(listing).map_err(rename_open_error)?;
    while let Some(entry) = entries.read() {
        let entry = entry.map_err(rename_open_error)?;
        let Ok(name) = entry.file_name().to_str() else {
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        if name.eq_ignore_ascii_case(&dest_name) && name != dest_name {
            return Err(ExecutorError::DestinationExists);
        }
    }
    Ok(())
}

fn apply_to_clone(
    root: &Path,
    plan: &RenameImpactPlan,
    verify_root: &Path,
    authorization: &RenameRecoveryAuthorization,
    backup_directory: &Path,
    operation_id: &OperationId,
    fault: Option<ApplyFault>,
) -> Result<(), ExecutorError> {
    let files_root = verify_root.join("files");
    let mut published = Vec::new();
    let dest_audio = staged_record(authorization, RenameStagedFileRole::DestinationAudio)?;
    let dest_audio_path = RootRelativePath::parse(&dest_audio.relative_path)
        .map_err(|_| ExecutorError::InvalidJournal)?;
    let dest_audio_hash = ContentHash::parse(dest_audio.staged_content_hash.clone())
        .map_err(|_| ExecutorError::InvalidJournal)?;
    publish_new_media_file(
        root,
        &dest_audio_path,
        &read_verify_bytes(&files_root, &dest_audio_path)?,
        &dest_audio_hash,
        operation_id,
        "dest-audio",
    )?;
    published.push(PublishedNewFile {
        relative_path: dest_audio_path,
        staged_hash: dest_audio_hash,
    });
    for record in authorization
        .staged_files
        .iter()
        .filter(|record| record.role == RenameStagedFileRole::DestinationSidecar)
    {
        let path = RootRelativePath::parse(&record.relative_path)
            .map_err(|_| ExecutorError::InvalidJournal)?;
        let hash = ContentHash::parse(record.staged_content_hash.clone())
            .map_err(|_| ExecutorError::InvalidJournal)?;
        publish_new_media_file(
            root,
            &path,
            &read_verify_bytes(&files_root, &path)?,
            &hash,
            operation_id,
            "dest-sidecar",
        )?;
        published.push(PublishedNewFile {
            relative_path: path,
            staged_hash: hash,
        });
    }
    if fault == Some(ApplyFault::DestinationPublished) {
        return Err(ExecutorError::InjectedFault("after_destination_publish"));
    }

    let mut replaced = Vec::new();
    for record in authorization.staged_files.iter().filter(|record| {
        matches!(
            record.role,
            RenameStagedFileRole::ProjectWorking | RenameStagedFileRole::ProjectSavedCheckpoint
        )
    }) {
        let path = RootRelativePath::parse(&record.relative_path)
            .map_err(|_| ExecutorError::InvalidJournal)?;
        let backup_hash = ContentHash::parse(record.backup_content_hash.clone())
            .map_err(|_| ExecutorError::InvalidJournal)?;
        let staged_hash = ContentHash::parse(record.staged_content_hash.clone())
            .map_err(|_| ExecutorError::InvalidJournal)?;
        replace_existing_media_file(
            root,
            &path,
            &read_verify_bytes(&files_root, &path)?,
            &backup_hash,
            &staged_hash,
            operation_id,
            "project",
        )?;
        replaced.push(ReplacedExistingFile {
            relative_path: path,
            staged_hash,
        });
    }
    if fault == Some(ApplyFault::ProjectReplaced) {
        return Err(ExecutorError::InjectedFault("after_project_replace"));
    }

    for file in &published {
        verify_live_hash(
            root,
            &file.relative_path,
            &file.staged_hash,
            u64::try_from(read_verify_bytes(&files_root, &file.relative_path)?.len())
                .map_err(|_| ExecutorError::FileTooLarge)?,
        )?;
    }
    for file in &replaced {
        verify_live_hash(
            root,
            &file.relative_path,
            &file.staged_hash,
            u64::try_from(read_verify_bytes(&files_root, &file.relative_path)?.len())
                .map_err(|_| ExecutorError::FileTooLarge)?,
        )?;
    }

    let mut quarantined = Vec::new();
    quarantine_source_file(
        root,
        &plan.source_relative_path,
        &plan.source_content_hash,
        operation_id,
        "source-audio",
    )?;
    quarantined.push(QuarantinedSource {
        relative_path: plan.source_relative_path.clone(),
        backup_hash: plan.source_content_hash.clone(),
        sibling_stem: sibling_stem(
            operation_id,
            plan.source_relative_path.as_str(),
            "source-audio",
        ),
    });
    for sidecar in &plan.sidecar_impacts {
        quarantine_source_file(
            root,
            &sidecar.source_sidecar_relative_path,
            &sidecar.content_hash,
            operation_id,
            "source-sidecar",
        )?;
        quarantined.push(QuarantinedSource {
            relative_path: sidecar.source_sidecar_relative_path.clone(),
            backup_hash: sidecar.content_hash.clone(),
            sibling_stem: sibling_stem(
                operation_id,
                sidecar.source_sidecar_relative_path.as_str(),
                "source-sidecar",
            ),
        });
    }
    if fault == Some(ApplyFault::SourceQuarantined) {
        let _ = (&published, &replaced, &quarantined, backup_directory);
        return Err(ExecutorError::InjectedFault("after_source_quarantine"));
    }

    for source in &quarantined {
        if live_file_exists(root, &source.relative_path)? {
            return Err(ExecutorError::PostWriteVerificationFailed);
        }
    }
    unlink_source_quarantines(root, &quarantined)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RestoreDecision {
    AlreadyRestored,
    RestoreFromBackup,
    RemovePublished,
    Conflict,
}

fn rollback_clone_root(
    root: &Path,
    authorization: &RenameRecoveryAuthorization,
    backup: &VerifiedRenameBackup,
    operation_id: &OperationId,
) -> Result<(), ExecutorError> {
    let inventory = preflight_rollback(root, authorization, backup, operation_id)?;
    if inventory
        .iter()
        .any(|(_, decision)| *decision == RestoreDecision::Conflict)
    {
        return Err(ExecutorError::RecoveryRequired);
    }

    let backup_files = backup.directory().join("files");
    for (target, decision) in &inventory {
        match (target, decision) {
            (
                RollbackTarget::Published {
                    path,
                    staged_hash,
                    tag,
                },
                RestoreDecision::RemovePublished,
            ) => {
                remove_published_if_ours(root, path, staged_hash, operation_id, tag)?;
            }
            (
                RollbackTarget::Existing {
                    path,
                    backup_hash,
                    staged_hash,
                },
                RestoreDecision::RestoreFromBackup,
            ) => {
                restore_existing_from_backup(
                    root,
                    path,
                    &backup_files,
                    backup_hash,
                    staged_hash,
                    operation_id,
                )?;
            }
            (
                RollbackTarget::Source {
                    path,
                    backup_hash,
                    tag,
                },
                RestoreDecision::RestoreFromBackup,
            ) => {
                restore_source_from_backup(
                    root,
                    path,
                    &backup_files,
                    backup_hash,
                    operation_id,
                    tag,
                )?;
            }
            (_, RestoreDecision::AlreadyRestored) => {}
            (_, RestoreDecision::RemovePublished | RestoreDecision::RestoreFromBackup) => {
                return Err(ExecutorError::RecoveryRequired);
            }
            (_, RestoreDecision::Conflict) => unreachable!("conflicts already rejected"),
        }
        cleanup_known_siblings(root, target.relative_path(), operation_id, target.tags())?;
    }
    Ok(())
}

#[derive(Debug)]
enum RollbackTarget {
    Published {
        path: RootRelativePath,
        staged_hash: ContentHash,
        tag: &'static str,
    },
    Existing {
        path: RootRelativePath,
        backup_hash: ContentHash,
        staged_hash: ContentHash,
    },
    Source {
        path: RootRelativePath,
        backup_hash: ContentHash,
        tag: &'static str,
    },
}

impl RollbackTarget {
    fn relative_path(&self) -> &RootRelativePath {
        match self {
            Self::Published { path, .. }
            | Self::Existing { path, .. }
            | Self::Source { path, .. } => path,
        }
    }

    fn tags(&self) -> &'static [&'static str] {
        match self {
            Self::Published { tag, .. } | Self::Source { tag, .. } => match *tag {
                "dest-audio" => &["dest-audio"],
                "dest-sidecar" => &["dest-sidecar"],
                "source-audio" => &["source-audio"],
                "source-sidecar" => &["source-sidecar"],
                _ => &[],
            },
            Self::Existing { .. } => &["project", "project-restore"],
        }
    }
}

fn preflight_rollback(
    root: &Path,
    authorization: &RenameRecoveryAuthorization,
    backup: &VerifiedRenameBackup,
    operation_id: &OperationId,
) -> Result<Vec<(RollbackTarget, RestoreDecision)>, ExecutorError> {
    let mut inventory = Vec::new();
    for record in authorization.staged_files.iter().rev() {
        let path = RootRelativePath::parse(&record.relative_path)
            .map_err(|_| ExecutorError::InvalidJournal)?;
        match record.role {
            RenameStagedFileRole::DestinationAudio | RenameStagedFileRole::DestinationSidecar => {
                let staged = ContentHash::parse(record.staged_content_hash.clone())
                    .map_err(|_| ExecutorError::InvalidJournal)?;
                let decision =
                    classify_published(root, &path, &staged, operation_id, role_tag(record.role))?;
                inventory.push((
                    RollbackTarget::Published {
                        path,
                        staged_hash: staged,
                        tag: role_tag(record.role),
                    },
                    decision,
                ));
            }
            RenameStagedFileRole::ProjectWorking | RenameStagedFileRole::ProjectSavedCheckpoint => {
                let backup_hash = ContentHash::parse(record.backup_content_hash.clone())
                    .map_err(|_| ExecutorError::InvalidJournal)?;
                let staged_hash = ContentHash::parse(record.staged_content_hash.clone())
                    .map_err(|_| ExecutorError::InvalidJournal)?;
                let decision = classify_existing(root, &path, &backup_hash, &staged_hash)?;
                inventory.push((
                    RollbackTarget::Existing {
                        path,
                        backup_hash,
                        staged_hash,
                    },
                    decision,
                ));
            }
        }
    }
    let source = RootRelativePath::parse(&authorization.source_relative_path)
        .map_err(|_| ExecutorError::InvalidJournal)?;
    let source_hash = ContentHash::parse(authorization.source_content_hash.clone())
        .map_err(|_| ExecutorError::InvalidJournal)?;
    let decision = classify_source(root, &source, &source_hash, operation_id, "source-audio")?;
    inventory.push((
        RollbackTarget::Source {
            path: source,
            backup_hash: source_hash,
            tag: "source-audio",
        },
        decision,
    ));
    for file in &backup.manifest().files {
        if file.role != RenameBackupFileRole::SampleSidecar {
            continue;
        }
        let path = RootRelativePath::parse(&file.relative_path)
            .map_err(|_| ExecutorError::InvalidJournal)?;
        let hash = ContentHash::parse(file.content_hash.clone())
            .map_err(|_| ExecutorError::InvalidJournal)?;
        let decision = classify_source(root, &path, &hash, operation_id, "source-sidecar")?;
        inventory.push((
            RollbackTarget::Source {
                path,
                backup_hash: hash,
                tag: "source-sidecar",
            },
            decision,
        ));
    }
    Ok(inventory)
}

fn classify_published(
    root: &Path,
    relative: &RootRelativePath,
    staged_hash: &ContentHash,
    operation_id: &OperationId,
    tag: &str,
) -> Result<RestoreDecision, ExecutorError> {
    match live_hash(root, relative)? {
        None => {
            let (parent, _) = open_parent(root, relative)?;
            let temporary = temp_name(&sibling_stem(operation_id, relative.as_str(), tag));
            match open_regular_entry(&parent, &temporary)? {
                Some(mut file) => {
                    if open_hash(&mut file)? == *staged_hash {
                        Ok(RestoreDecision::RemovePublished)
                    } else {
                        Ok(RestoreDecision::Conflict)
                    }
                }
                None => Ok(RestoreDecision::AlreadyRestored),
            }
        }
        Some(live) if live == *staged_hash => Ok(RestoreDecision::RemovePublished),
        Some(_) => Ok(RestoreDecision::Conflict),
    }
}

fn classify_existing(
    root: &Path,
    relative: &RootRelativePath,
    backup_hash: &ContentHash,
    staged_hash: &ContentHash,
) -> Result<RestoreDecision, ExecutorError> {
    match live_hash(root, relative)? {
        None => Ok(RestoreDecision::RestoreFromBackup),
        Some(live) if live == *backup_hash => Ok(RestoreDecision::AlreadyRestored),
        Some(live) if live == *staged_hash => Ok(RestoreDecision::RestoreFromBackup),
        Some(_) => Ok(RestoreDecision::Conflict),
    }
}

fn classify_source(
    root: &Path,
    relative: &RootRelativePath,
    backup_hash: &ContentHash,
    _operation_id: &OperationId,
    _tag: &str,
) -> Result<RestoreDecision, ExecutorError> {
    match live_hash(root, relative)? {
        None => Ok(RestoreDecision::RestoreFromBackup),
        Some(live) if live == *backup_hash => Ok(RestoreDecision::AlreadyRestored),
        Some(_) => Ok(RestoreDecision::Conflict),
    }
}

fn live_hash(
    root: &Path,
    relative: &RootRelativePath,
) -> Result<Option<ContentHash>, ExecutorError> {
    if !live_file_exists(root, relative)? {
        return Ok(None);
    }
    let mut file = open_root_regular_file(root, relative)?;
    Ok(Some(open_hash(&mut file)?))
}

fn open_hash(file: &mut File) -> Result<ContentHash, ExecutorError> {
    file.seek(SeekFrom::Start(0)).map_err(ExecutorError::io)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(ExecutorError::io)?;
    Ok(hash_bytes(&bytes))
}

fn cleanup_known_siblings(
    root: &Path,
    relative: &RootRelativePath,
    operation_id: &OperationId,
    tags: &[&str],
) -> Result<(), ExecutorError> {
    let (parent, _) = open_parent(root, relative)?;
    for tag in tags {
        let stem = sibling_stem(operation_id, relative.as_str(), tag);
        for name in [temp_name(&stem), quarantine_name(&stem)] {
            match open_regular_entry(&parent, &name) {
                Ok(Some(_)) => {
                    descriptor_fs::unlinkat(&parent, name.as_str(), AtFlags::empty())
                        .map_err(rename_open_error)?;
                    parent.sync_all().map_err(ExecutorError::io)?;
                }
                Ok(None) => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(())
}

fn role_tag(role: RenameStagedFileRole) -> &'static str {
    match role {
        RenameStagedFileRole::DestinationAudio => "dest-audio",
        RenameStagedFileRole::DestinationSidecar => "dest-sidecar",
        RenameStagedFileRole::ProjectWorking | RenameStagedFileRole::ProjectSavedCheckpoint => {
            "project"
        }
    }
}

fn staged_record(
    authorization: &RenameRecoveryAuthorization,
    role: RenameStagedFileRole,
) -> Result<&RenameStagedFileRecord, ExecutorError> {
    authorization
        .staged_files
        .iter()
        .find(|record| record.role == role)
        .ok_or(ExecutorError::InvalidJournal)
}

fn read_verify_bytes(
    files_root: &Path,
    relative: &RootRelativePath,
) -> Result<Vec<u8>, ExecutorError> {
    let mut file = open_root_regular_file(files_root, relative)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(ExecutorError::io)?;
    Ok(bytes)
}

fn live_file_exists(root: &Path, relative: &RootRelativePath) -> Result<bool, ExecutorError> {
    let (parent, name) = open_parent(root, relative)?;
    Ok(open_regular_entry(&parent, &name)?.is_some())
}

fn verify_live_hash(
    root: &Path,
    relative: &RootRelativePath,
    expected: &ContentHash,
    expected_size: u64,
) -> Result<(), ExecutorError> {
    let mut file = open_root_regular_file(root, relative)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(ExecutorError::io)?;
    if bytes.len() as u64 != expected_size || hash_bytes(&bytes) != *expected {
        return Err(ExecutorError::SourceChanged);
    }
    Ok(())
}

fn sibling_stem(operation_id: &OperationId, relative: &str, tag: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(relative.as_bytes());
    hasher.update(tag.as_bytes());
    format!(
        ".masterocta-{}-{}-{:x}",
        operation_id.file_stem(),
        tag,
        hasher.finalize()
    )
}

fn temp_name(stem: &str) -> String {
    format!("{stem}.partial")
}

fn quarantine_name(stem: &str) -> String {
    format!("{stem}.quarantine")
}

fn publish_new_media_file(
    root: &Path,
    relative: &RootRelativePath,
    bytes: &[u8],
    expected: &ContentHash,
    operation_id: &OperationId,
    tag: &str,
) -> Result<(), ExecutorError> {
    let (parent, name) = open_parent(root, relative)?;
    if open_regular_entry(&parent, &name)?.is_some() {
        return Err(ExecutorError::DestinationExists);
    }
    let stem = sibling_stem(operation_id, relative.as_str(), tag);
    let temporary = temp_name(&stem);
    write_exclusive(&parent, &temporary, bytes, expected)?;
    descriptor_fs::renameat_with(
        &parent,
        temporary.as_str(),
        &parent,
        name.as_str(),
        RenameFlags::NOREPLACE,
    )
    .map_err(rename_publish_error)?;
    parent.sync_all().map_err(ExecutorError::io)
}

fn replace_existing_media_file(
    root: &Path,
    relative: &RootRelativePath,
    bytes: &[u8],
    backup_hash: &ContentHash,
    staged_hash: &ContentHash,
    operation_id: &OperationId,
    tag: &str,
) -> Result<(), ExecutorError> {
    let (parent, name) = open_parent(root, relative)?;
    verify_open_hash(
        &mut open_regular_entry(&parent, &name)?.ok_or(ExecutorError::SourceChanged)?,
        backup_hash,
    )?;
    let stem = sibling_stem(operation_id, relative.as_str(), tag);
    let temporary = temp_name(&stem);
    let quarantine = quarantine_name(&stem);
    write_exclusive(&parent, &temporary, bytes, staged_hash)?;
    descriptor_fs::renameat_with(
        &parent,
        name.as_str(),
        &parent,
        quarantine.as_str(),
        RenameFlags::NOREPLACE,
    )
    .map_err(rename_publish_error)?;
    if let Err(error) = descriptor_fs::renameat_with(
        &parent,
        temporary.as_str(),
        &parent,
        name.as_str(),
        RenameFlags::NOREPLACE,
    ) {
        let _ = descriptor_fs::renameat_with(
            &parent,
            quarantine.as_str(),
            &parent,
            name.as_str(),
            RenameFlags::NOREPLACE,
        );
        return Err(rename_publish_error(error));
    }
    descriptor_fs::unlinkat(&parent, quarantine.as_str(), AtFlags::empty())
        .map_err(rename_open_error)?;
    parent.sync_all().map_err(ExecutorError::io)
}

fn quarantine_source_file(
    root: &Path,
    relative: &RootRelativePath,
    expected: &ContentHash,
    operation_id: &OperationId,
    tag: &str,
) -> Result<(), ExecutorError> {
    let (parent, name) = open_parent(root, relative)?;
    verify_open_hash(
        &mut open_regular_entry(&parent, &name)?.ok_or(ExecutorError::SourceChanged)?,
        expected,
    )?;
    let quarantine = quarantine_name(&sibling_stem(operation_id, relative.as_str(), tag));
    descriptor_fs::renameat_with(
        &parent,
        name.as_str(),
        &parent,
        quarantine.as_str(),
        RenameFlags::NOREPLACE,
    )
    .map_err(rename_publish_error)?;
    parent.sync_all().map_err(ExecutorError::io)
}

fn unlink_source_quarantines(
    root: &Path,
    sources: &[QuarantinedSource],
) -> Result<(), ExecutorError> {
    for source in sources {
        let (parent, _) = open_parent(root, &source.relative_path)?;
        let quarantine = quarantine_name(&source.sibling_stem);
        match open_regular_entry(&parent, &quarantine) {
            Ok(Some(mut file)) => {
                verify_open_hash(&mut file, &source.backup_hash)?;
                descriptor_fs::unlinkat(&parent, quarantine.as_str(), AtFlags::empty())
                    .map_err(rename_open_error)?;
                parent.sync_all().map_err(ExecutorError::io)?;
            }
            Ok(None) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn remove_published_if_ours(
    root: &Path,
    relative: &RootRelativePath,
    staged_hash: &ContentHash,
    operation_id: &OperationId,
    tag: &str,
) -> Result<(), ExecutorError> {
    let (parent, name) = open_parent(root, relative)?;
    match open_regular_entry(&parent, &name) {
        Ok(Some(mut file)) => {
            verify_open_hash(&mut file, staged_hash)?;
            descriptor_fs::unlinkat(&parent, name.as_str(), AtFlags::empty())
                .map_err(rename_open_error)?;
            parent.sync_all().map_err(ExecutorError::io)
        }
        Ok(None) => {
            let temporary = temp_name(&sibling_stem(operation_id, relative.as_str(), tag));
            if let Some(mut file) = open_regular_entry(&parent, &temporary)? {
                verify_open_hash(&mut file, staged_hash)?;
                descriptor_fs::unlinkat(&parent, temporary.as_str(), AtFlags::empty())
                    .map_err(rename_open_error)?;
                parent.sync_all().map_err(ExecutorError::io)?;
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn restore_existing_from_backup(
    root: &Path,
    relative: &RootRelativePath,
    backup_files: &Path,
    backup_hash: &ContentHash,
    staged_hash: &ContentHash,
    operation_id: &OperationId,
) -> Result<(), ExecutorError> {
    match live_hash(root, relative)? {
        Some(live) if live == *backup_hash => {
            restore_project_quarantine(root, relative, backup_hash, operation_id)?;
            return Ok(());
        }
        Some(live) if live == *staged_hash => {}
        Some(_) => return Err(ExecutorError::RecoveryRequired),
        None => {}
    }
    let backup_bytes = read_verify_bytes(backup_files, relative)?;
    if hash_bytes(&backup_bytes) != *backup_hash {
        return Err(ExecutorError::InvalidJournal);
    }
    if live_file_exists(root, relative)? {
        replace_existing_media_file(
            root,
            relative,
            &backup_bytes,
            staged_hash,
            backup_hash,
            operation_id,
            "project-restore",
        )
    } else {
        publish_new_media_file(
            root,
            relative,
            &backup_bytes,
            backup_hash,
            operation_id,
            "project-restore",
        )
    }
}

fn restore_project_quarantine(
    root: &Path,
    relative: &RootRelativePath,
    backup_hash: &ContentHash,
    operation_id: &OperationId,
) -> Result<(), ExecutorError> {
    let (parent, _) = open_parent(root, relative)?;
    let quarantine = quarantine_name(&sibling_stem(operation_id, relative.as_str(), "project"));
    if let Some(mut file) = open_regular_entry(&parent, &quarantine)? {
        verify_open_hash(&mut file, backup_hash)?;
        descriptor_fs::unlinkat(&parent, quarantine.as_str(), AtFlags::empty())
            .map_err(rename_open_error)?;
        parent.sync_all().map_err(ExecutorError::io)?;
    }
    Ok(())
}

fn restore_source_from_backup(
    root: &Path,
    relative: &RootRelativePath,
    backup_files: &Path,
    backup_hash: &ContentHash,
    operation_id: &OperationId,
    tag: &str,
) -> Result<(), ExecutorError> {
    let (parent, name) = open_parent(root, relative)?;
    let quarantine = quarantine_name(&sibling_stem(operation_id, relative.as_str(), tag));
    if let Some(mut file) = open_regular_entry(&parent, &quarantine)? {
        verify_open_hash(&mut file, backup_hash)?;
        if open_regular_entry(&parent, &name)?.is_none() {
            descriptor_fs::renameat_with(
                &parent,
                quarantine.as_str(),
                &parent,
                name.as_str(),
                RenameFlags::NOREPLACE,
            )
            .map_err(rename_publish_error)?;
            parent.sync_all().map_err(ExecutorError::io)?;
            return Ok(());
        }
        descriptor_fs::unlinkat(&parent, quarantine.as_str(), AtFlags::empty())
            .map_err(rename_open_error)?;
        parent.sync_all().map_err(ExecutorError::io)?;
    }
    if let Ok(mut live) = open_root_regular_file(root, relative) {
        let mut bytes = Vec::new();
        live.read_to_end(&mut bytes).map_err(ExecutorError::io)?;
        if hash_bytes(&bytes) == *backup_hash {
            return Ok(());
        }
        return Err(ExecutorError::RecoveryRequired);
    }
    let backup_bytes = read_verify_bytes(backup_files, relative)?;
    if hash_bytes(&backup_bytes) != *backup_hash {
        return Err(ExecutorError::InvalidJournal);
    }
    publish_new_media_file(
        root,
        relative,
        &backup_bytes,
        backup_hash,
        operation_id,
        tag,
    )
}

fn write_exclusive(
    parent: &File,
    name: &str,
    bytes: &[u8],
    expected: &ContentHash,
) -> Result<(), ExecutorError> {
    let mut file = File::from(
        descriptor_fs::openat(
            parent,
            name,
            OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR | Mode::RGRP | Mode::ROTH,
        )
        .map_err(|error| {
            if error == rustix::io::Errno::EXIST {
                ExecutorError::DestinationExists
            } else {
                rename_open_error(error)
            }
        })?,
    );
    file.write_all(bytes).map_err(ExecutorError::io)?;
    file.sync_all().map_err(ExecutorError::io)?;
    if let Err(error) = verify_open_hash(&mut file, expected) {
        drop(file);
        let _ = descriptor_fs::unlinkat(parent, name, AtFlags::empty());
        let _ = parent.sync_all();
        return Err(error);
    }
    Ok(())
}

fn verify_open_hash(file: &mut File, expected: &ContentHash) -> Result<(), ExecutorError> {
    file.seek(SeekFrom::Start(0)).map_err(ExecutorError::io)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(ExecutorError::io)?;
    if hash_bytes(&bytes) != *expected {
        return Err(ExecutorError::PostWriteVerificationFailed);
    }
    Ok(())
}

fn open_parent(root: &Path, relative: &RootRelativePath) -> Result<(File, String), ExecutorError> {
    let components = relative.as_str().split('/').collect::<Vec<_>>();
    let root = descriptor_fs::open(
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(rename_open_error)?;
    let mut parent = File::from(root);
    for component in &components[..components.len() - 1] {
        let child = descriptor_fs::openat(
            &parent,
            *component,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(rename_open_error)?;
        parent = File::from(child);
    }
    Ok((
        parent,
        components
            .last()
            .expect("relative path is non-empty")
            .to_string(),
    ))
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
        Err(error) => Err(rename_open_error(error)),
    }
}

fn rename_open_error(error: rustix::io::Errno) -> ExecutorError {
    if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
        ExecutorError::SymlinkEscape
    } else {
        ExecutorError::io(std::io::Error::from(error))
    }
}

fn rename_publish_error(error: rustix::io::Errno) -> ExecutorError {
    if error == rustix::io::Errno::EXIST {
        ExecutorError::DestinationExists
    } else {
        rename_open_error(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rename_prepare::{RenameJournalStatus, RenamePrepareResult};
    use crate::{
        ApprovedExecutionRoot, ApprovedRecoveryRoot, AuthorityError, ExecutorLocalPaths,
        RecoveryAuthority, WriteAuthority,
    };
    use ot_backup::BackupStore;
    use ot_codec::MemoryProjectReferenceCodec;
    use ot_domain::{
        ContentHashFreshness, ParserProvenance, ProjectCompatibilityEvidence, RenameSampleIntent,
        RootId, SampleReferenceStatus, SampleSettingsParseStatus, SampleSlotId, SampleSlotKind,
        StateDocumentKind, StateDocumentParseStatus, StateDocumentRole,
    };
    use ot_plan::{
        derive_file_instance_id, plan_rename_sample, sidecar_destination_for_audio_destination,
        RenameDestinationObservation, RenameDestinationState, RenamePlanningOutcome,
        RenameRootObservation, RenameSamplePlanningFacts, RenameSidecarObservation,
        RenameSlotAssignmentObservation, RenameSourceObservation, RenameStateDocumentObservation,
    };
    use std::sync::Mutex;
    use tempfile::TempDir;

    const SOURCE_PATH: &str = "SET/AUDIO/kick.wav";
    const DESTINATION_PATH: &str = "SET/AUDIO/new-kick.wav";
    const WORK_PATH: &str = "SET/PROJECT/project.work";
    const STRD_PATH: &str = "SET/PROJECT/project.strd";
    const SIDECAR_PATH: &str = "SET/AUDIO/kick.ot";
    const AUDIO_BYTES: &[u8] = b"rename-audio";
    const SIDECAR_BYTES: &[u8] = b"sidecar-bytes";
    const WORK_PATH_VALUE: &str = "../AUDIO/kick.wav";
    const UNRELATED_PATH: &str = "SET/AUDIO/other.wav";
    const UNRELATED_BYTES: &[u8] = b"keep-me";

    struct FixtureAuthority {
        root: Mutex<ApprovedExecutionRoot>,
    }

    struct FixtureContinuedAuthority {
        continuation: VerifiedContinuationCloneRoot,
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

    impl CloneWriteAuthority for FixtureAuthority {
        fn resolve_clone_for_write(
            &self,
            root_id: &RootId,
        ) -> Result<VerifiedCloneRoot, AuthorityError> {
            Ok(VerifiedCloneRoot::attest_temporary_copy(
                self.resolve_for_write(root_id)?,
            ))
        }
    }

    impl ContinuedCloneWriteAuthority for FixtureContinuedAuthority {
        fn resolve_continued_clone_for_write(
            &self,
            _plan_id: &PlanId,
            _historical_root_id: &RootId,
        ) -> Result<VerifiedContinuationCloneRoot, AuthorityError> {
            Ok(self.continuation.clone())
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

    fn fingerprint() -> String {
        format!("rootfp:v1:{}", "a".repeat(64))
    }

    fn project_bytes() -> Vec<u8> {
        format!("[SAMPLE]\nTYPE=STATIC\nSLOT=1\nPATH={WORK_PATH_VALUE}\n[/SAMPLE]\n").into_bytes()
    }

    fn snapshot_root(root: &Path) -> Vec<(PathBuf, u64, String)> {
        let mut entries = Vec::new();
        collect_snapshot(root, root, &mut entries);
        entries.sort();
        entries
    }

    fn collect_snapshot(root: &Path, path: &Path, entries: &mut Vec<(PathBuf, u64, String)>) {
        let metadata = fs::symlink_metadata(path).unwrap();
        if metadata.is_dir() {
            for entry in fs::read_dir(path).unwrap() {
                collect_snapshot(root, &entry.unwrap().path(), entries);
            }
            return;
        }
        let relative = path.strip_prefix(root).unwrap().to_path_buf();
        let bytes = fs::read(path).unwrap();
        entries.push((
            relative,
            metadata.len(),
            format!("{:x}", Sha256::digest(bytes)),
        ));
    }

    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let metadata = fs::symlink_metadata(entry.path()).unwrap();
            let dest = to.join(entry.file_name());
            assert!(!metadata.file_type().is_symlink());
            if metadata.is_dir() {
                copy_tree(&entry.path(), &dest);
            } else {
                fs::copy(entry.path(), dest).unwrap();
            }
        }
    }

    fn parsed_project(
        path: &str,
        role: StateDocumentRole,
        bytes: &[u8],
    ) -> RenameStateDocumentObservation {
        RenameStateDocumentObservation {
            relative_path: RootRelativePath::parse(path).unwrap(),
            kind: StateDocumentKind::Project,
            role,
            byte_size: bytes.len() as u64,
            content_hash: hash_bytes(bytes),
            parse_status: StateDocumentParseStatus::Parsed,
            parser_provenance: ParserProvenance {
                parser_name: "fixture".into(),
                parser_revision: "test".into(),
                source_version: Some("1.40A".into()),
                compatibility_evidence: Some(ProjectCompatibilityEvidence::UpstreamLibrary),
            },
        }
    }

    fn facts(
        assignments: Vec<RenameSlotAssignmentObservation>,
        include_sidecar: bool,
    ) -> RenameSamplePlanningFacts {
        let source = RootRelativePath::parse(SOURCE_PATH).unwrap();
        let work = project_bytes();
        RenameSamplePlanningFacts {
            root: RenameRootObservation {
                root_id: RootId::new("root-session-1").unwrap(),
                device_fingerprint: fingerprint(),
                live_observed_revision: 9,
                base_catalog_scan_revision: 9,
                scan_completed: true,
                identity_is_stable: true,
            },
            source: RenameSourceObservation {
                file_instance_id: derive_file_instance_id(&fingerprint(), &source),
                catalog_relative_path: source.clone(),
                catalog_byte_size: AUDIO_BYTES.len() as u64,
                catalog_content_hash: hash_bytes(AUDIO_BYTES),
                live_relative_path: source.clone(),
                live_byte_size: AUDIO_BYTES.len() as u64,
                live_content_hash: hash_bytes(AUDIO_BYTES),
                hash_freshness: ContentHashFreshness::ComputedThisScan,
            },
            destination: RenameDestinationObservation {
                intended_relative_path: RootRelativePath::parse(DESTINATION_PATH).unwrap(),
                state: RenameDestinationState::Absent,
            },
            sidecar_destination: if include_sidecar {
                sidecar_destination_for_audio_destination(DESTINATION_PATH)
            } else {
                None
            },
            state_documents: vec![
                parsed_project(WORK_PATH, StateDocumentRole::Working, &work),
                parsed_project(STRD_PATH, StateDocumentRole::SavedCheckpoint, &work),
            ],
            slot_assignments: assignments,
            usage_edges: Vec::new(),
            sidecars: if include_sidecar {
                vec![RenameSidecarObservation {
                    sidecar_relative_path: RootRelativePath::parse(SIDECAR_PATH).unwrap(),
                    owning_audio_relative_path: source,
                    byte_size: SIDECAR_BYTES.len() as u64,
                    content_hash: hash_bytes(SIDECAR_BYTES),
                    parse_status: SampleSettingsParseStatus::Parsed,
                    parser_provenance: ParserProvenance {
                        parser_name: "fixture".into(),
                        parser_revision: "test".into(),
                        source_version: None,
                        compatibility_evidence: None,
                    },
                    ownership_is_unique: true,
                }]
            } else {
                Vec::new()
            },
            usage_graph_complete: true,
            set_project_coverage_complete: true,
        }
    }

    fn assignment(document: &str) -> RenameSlotAssignmentObservation {
        RenameSlotAssignmentObservation {
            project_document_relative_path: RootRelativePath::parse(document).unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(RootRelativePath::parse(SOURCE_PATH).unwrap()),
            reference_status: SampleReferenceStatus::Resolved,
        }
    }

    fn plan_from(facts: RenameSamplePlanningFacts) -> RenameImpactPlan {
        let intent = RenameSampleIntent {
            root_id: facts.root.root_id.clone(),
            source_file_instance_id: facts.source.file_instance_id.clone(),
            destination_relative_path: RootRelativePath::parse(DESTINATION_PATH).unwrap(),
        };
        match plan_rename_sample(&intent, &facts) {
            RenamePlanningOutcome::Planned(plan) => *plan,
            RenamePlanningOutcome::Blocked(blocked) => {
                panic!(
                    "expected planned rename, blocked by {:?}",
                    blocked.block_reasons
                )
            }
        }
    }

    fn write_tree(root: &Path, sidecar: bool, work: bool, strd: bool) {
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::create_dir_all(root.join("SET/PROJECT")).unwrap();
        fs::write(root.join(SOURCE_PATH), AUDIO_BYTES).unwrap();
        fs::write(root.join(UNRELATED_PATH), UNRELATED_BYTES).unwrap();
        if sidecar {
            fs::write(root.join(SIDECAR_PATH), SIDECAR_BYTES).unwrap();
        }
        let project = project_bytes();
        if work {
            fs::write(root.join(WORK_PATH), &project).unwrap();
        }
        if strd {
            fs::write(root.join(STRD_PATH), &project).unwrap();
        }
    }

    fn local_paths(local: &Path) -> ExecutorLocalPaths {
        ExecutorLocalPaths {
            staging_directory: local.join("staging"),
            backup_directory: local.join("backups"),
            journal_directory: local.join("journals"),
        }
    }

    fn authority_for(root: &Path) -> FixtureAuthority {
        FixtureAuthority {
            root: Mutex::new(ApprovedExecutionRoot {
                root_id: RootId::new("root-session-1").unwrap(),
                device_fingerprint: fingerprint(),
                observed_revision: 9,
                canonical_path: root.canonicalize().unwrap(),
                write_enabled: true,
                stable_device_identity: true,
            }),
        }
    }

    fn continued_authority_for(
        plan: &RenameImpactPlan,
        current_root: ApprovedExecutionRoot,
    ) -> FixtureContinuedAuthority {
        FixtureContinuedAuthority {
            continuation: VerifiedContinuationCloneRoot::attest_temporary_copy(
                HistoricalRenamePlanRoot::new(
                    plan.id.clone(),
                    plan.root_id.clone(),
                    plan.device_fingerprint.clone(),
                    plan.base_observed_revision,
                ),
                current_root,
            ),
        }
    }

    struct CloneFixture {
        _temp: TempDir,
        original: PathBuf,
        clone: PathBuf,
        local: PathBuf,
        plan: RenameImpactPlan,
        prepared: RenamePrepareResult,
        original_before: Vec<(PathBuf, u64, String)>,
        clone_before: Vec<(PathBuf, u64, String)>,
    }

    fn prepare_clone(
        include_sidecar: bool,
        work: bool,
        assignments: Vec<RenameSlotAssignmentObservation>,
    ) -> CloneFixture {
        let fixture = TempDir::new().unwrap();
        let original = fixture.path().join("original");
        let clone = fixture.path().join("clone");
        let local = fixture.path().join("local");
        write_tree(&original, include_sidecar, work, false);
        let original_before = snapshot_root(&original);
        copy_tree(&original, &clone);
        let clone_before = snapshot_root(&clone);
        let plan = plan_from(facts(assignments, include_sidecar));
        BackupStore::new(local.join("backups"))
            .create_verified_for_rename(&clone, &plan)
            .unwrap();
        let prepared = RenameSampleExecutor::new(local_paths(&local))
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&clone))
            .unwrap();
        CloneFixture {
            _temp: fixture,
            original,
            clone,
            local,
            plan,
            prepared,
            original_before,
            clone_before,
        }
    }

    #[test]
    fn continuation_root_keeps_current_identity_and_path_together() {
        let fixture = prepare_clone(false, false, Vec::new());
        let current_root_id = RootId::new("root-session-2").unwrap();
        let current_root = ApprovedExecutionRoot {
            root_id: current_root_id.clone(),
            device_fingerprint: fixture.plan.device_fingerprint.clone(),
            observed_revision: 10,
            canonical_path: fixture.clone.canonicalize().unwrap(),
            write_enabled: true,
            stable_device_identity: true,
        };
        let authority = continued_authority_for(&fixture.plan, current_root.clone());

        let resolved = resolve_continued_clone_write_authority(&fixture.plan, &authority).unwrap();
        assert_eq!(resolved.root_id, current_root_id);
        assert_eq!(resolved.observed_revision, 10);
        assert_eq!(resolved.canonical_path, current_root.canonical_path);
        assert_ne!(resolved.root_id, fixture.plan.root_id);
    }

    #[test]
    fn continuation_root_rejects_current_fingerprint_mismatch() {
        let fixture = prepare_clone(false, false, Vec::new());
        let current_root = ApprovedExecutionRoot {
            root_id: RootId::new("root-session-2").unwrap(),
            device_fingerprint: format!("rootfp:v1:{}", "b".repeat(64)),
            observed_revision: 10,
            canonical_path: fixture.clone.canonicalize().unwrap(),
            write_enabled: true,
            stable_device_identity: true,
        };
        let authority = continued_authority_for(&fixture.plan, current_root);

        let error = resolve_continued_clone_write_authority(&fixture.plan, &authority).unwrap_err();
        assert!(matches!(error, ExecutorError::RootChanged));
    }

    #[test]
    fn unused_sample_apply_commits_on_the_clone_and_leaves_the_original_unchanged() {
        let fixture = prepare_clone(false, false, Vec::new());
        let applied = RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
            )
            .unwrap();

        assert_eq!(applied.journal.status, RenameJournalStatus::Committed);
        assert_eq!(applied.operation_id, fixture.prepared.operation_id);
        assert_eq!(
            fs::read(fixture.clone.join(DESTINATION_PATH)).unwrap(),
            AUDIO_BYTES
        );
        assert!(!fixture.clone.join(SOURCE_PATH).exists());
        assert_eq!(
            fs::read(fixture.clone.join(UNRELATED_PATH)).unwrap(),
            UNRELATED_BYTES
        );
        assert_eq!(snapshot_root(&fixture.original), fixture.original_before);
        assert_eq!(
            RenameSampleExecutor::new(local_paths(&fixture.local))
                .rename_journal(&applied.operation_id)
                .unwrap()
                .unwrap()
                .status,
            RenameJournalStatus::Committed
        );
    }

    #[test]
    fn working_document_and_sidecar_apply_rewrites_only_the_clone() {
        let fixture = prepare_clone(true, true, vec![assignment(WORK_PATH)]);
        RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
            )
            .unwrap();

        assert_eq!(
            fs::read(fixture.clone.join(DESTINATION_PATH)).unwrap(),
            AUDIO_BYTES
        );
        assert_eq!(
            fs::read(fixture.clone.join("SET/AUDIO/new-kick.ot")).unwrap(),
            SIDECAR_BYTES
        );
        let work = String::from_utf8(fs::read(fixture.clone.join(WORK_PATH)).unwrap()).unwrap();
        assert!(work.contains("../AUDIO/new-kick.wav"));
        assert!(!work.contains("../AUDIO/kick.wav"));
        assert!(!fixture.clone.join(SOURCE_PATH).exists());
        assert!(!fixture.clone.join(SIDECAR_PATH).exists());
        assert_eq!(snapshot_root(&fixture.original), fixture.original_before);
        assert_eq!(
            fs::read(fixture.original.join(WORK_PATH)).unwrap(),
            project_bytes()
        );
    }

    #[test]
    fn destination_collision_fails_before_any_clone_mutation() {
        let fixture = prepare_clone(false, false, Vec::new());
        fs::write(fixture.clone.join(DESTINATION_PATH), b"already-there").unwrap();
        let before = snapshot_root(&fixture.clone);
        let error = RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
            )
            .unwrap_err();
        assert!(matches!(error, ExecutorError::DestinationExists));
        assert_eq!(snapshot_root(&fixture.clone), before);
        assert_ne!(fixture.clone_before, before);
    }

    #[test]
    fn apply_without_prepare_fails_closed() {
        let fixture = TempDir::new().unwrap();
        let clone = fixture.path().join("clone");
        let local = fixture.path().join("local");
        write_tree(&clone, false, false, false);
        let before = snapshot_root(&clone);
        let plan = plan_from(facts(Vec::new(), false));
        BackupStore::new(local.join("backups"))
            .create_verified_for_rename(&clone, &plan)
            .unwrap();
        let error = RenameSampleExecutor::new(local_paths(&local))
            .apply(&plan, &MemoryProjectReferenceCodec, &authority_for(&clone))
            .unwrap_err();
        assert!(matches!(error, ExecutorError::InvalidJournal));
        assert_eq!(snapshot_root(&clone), before);
    }

    #[test]
    fn committed_apply_cannot_run_again() {
        let fixture = prepare_clone(false, false, Vec::new());
        let executor = RenameSampleExecutor::new(local_paths(&fixture.local));
        executor
            .apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
            )
            .unwrap();
        assert!(matches!(
            executor.apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone)
            ),
            Err(ExecutorError::PlanConsumed)
        ));
    }

    #[cfg(feature = "test-seams")]
    #[test]
    fn fault_after_destination_publish_rolls_the_clone_back() {
        let fixture = prepare_clone(true, true, vec![assignment(WORK_PATH)]);
        let error = RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply_with_fault(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
                ApplyFault::DestinationPublished,
            )
            .unwrap_err();
        assert!(matches!(error, ExecutorError::InjectedFault(_)));
        assert_eq!(snapshot_root(&fixture.clone), fixture.clone_before);
        assert_eq!(snapshot_root(&fixture.original), fixture.original_before);
        assert_eq!(
            RenameSampleExecutor::new(local_paths(&fixture.local))
                .rename_journal(&fixture.prepared.operation_id)
                .unwrap()
                .unwrap()
                .status,
            RenameJournalStatus::RolledBack
        );
    }

    #[cfg(feature = "test-seams")]
    #[test]
    fn fault_after_project_replace_restores_project_bytes() {
        let fixture = prepare_clone(true, true, vec![assignment(WORK_PATH)]);
        RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply_with_fault(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
                ApplyFault::ProjectReplaced,
            )
            .unwrap_err();
        assert_eq!(snapshot_root(&fixture.clone), fixture.clone_before);
    }

    #[cfg(feature = "test-seams")]
    #[test]
    fn fault_after_source_quarantine_restores_the_source_file() {
        let fixture = prepare_clone(false, false, Vec::new());
        RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply_with_fault(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
                ApplyFault::SourceQuarantined,
            )
            .unwrap_err();
        assert_eq!(snapshot_root(&fixture.clone), fixture.clone_before);
    }

    #[test]
    fn explicit_rollback_of_a_prepared_journal_does_not_touch_the_clone() {
        let fixture = prepare_clone(false, false, Vec::new());
        let journal = RenameSampleExecutor::new(local_paths(&fixture.local))
            .rollback(
                &fixture.plan.root_id,
                &fixture.prepared.operation_id,
                &authority_for(&fixture.clone),
            )
            .unwrap();
        assert_eq!(journal.status, RenameJournalStatus::RolledBack);
        assert_eq!(snapshot_root(&fixture.clone), fixture.clone_before);
        assert_eq!(
            RenameSampleExecutor::new(local_paths(&fixture.local))
                .rename_journal(&fixture.prepared.operation_id)
                .unwrap()
                .unwrap()
                .status,
            RenameJournalStatus::RolledBack
        );
    }

    #[test]
    fn live_source_change_after_prepare_fails_before_clone_writes() {
        let fixture = prepare_clone(false, false, Vec::new());
        fs::write(fixture.clone.join(SOURCE_PATH), b"changed-after-prepare").unwrap();
        let before = snapshot_root(&fixture.clone);
        let error = RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
            )
            .unwrap_err();
        assert!(matches!(error, ExecutorError::SourceChanged));
        assert_eq!(snapshot_root(&fixture.clone), before);
    }

    fn mark_journal_applying(local: &Path, operation_id: &OperationId) {
        let path = local
            .join("journals/rename")
            .join(format!("{}.json", operation_id.file_stem()));
        let mut journal = read_rename_journal(&path).unwrap();
        journal.status = RenameJournalStatus::Applying;
        replace_rename_json(&path, &journal).unwrap();
    }

    #[test]
    fn ascii_case_collision_fails_before_any_clone_mutation() {
        let fixture = prepare_clone(false, false, Vec::new());
        fs::write(
            fixture.clone.join("SET/AUDIO/NEW-KICK.WAV"),
            b"case-collision",
        )
        .unwrap();
        let before = snapshot_root(&fixture.clone);
        let error = RenameSampleExecutor::new(local_paths(&fixture.local))
            .apply(
                &fixture.plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&fixture.clone),
            )
            .unwrap_err();
        assert!(matches!(error, ExecutorError::DestinationExists));
        assert_eq!(snapshot_root(&fixture.clone), before);
    }

    #[test]
    fn independently_changed_source_blocks_destination_delete() {
        let fixture = prepare_clone(false, false, Vec::new());
        fs::write(fixture.clone.join(DESTINATION_PATH), AUDIO_BYTES).unwrap();
        fs::write(fixture.clone.join(SOURCE_PATH), b"tampered-source").unwrap();
        mark_journal_applying(&fixture.local, &fixture.prepared.operation_id);
        let before = snapshot_root(&fixture.clone);
        let error = RenameSampleExecutor::new(local_paths(&fixture.local))
            .rollback(
                &fixture.plan.root_id,
                &fixture.prepared.operation_id,
                &authority_for(&fixture.clone),
            )
            .unwrap_err();
        assert!(matches!(error, ExecutorError::RecoveryRequired));
        assert_eq!(snapshot_root(&fixture.clone), before);
        assert_eq!(
            fs::read(fixture.clone.join(DESTINATION_PATH)).unwrap(),
            AUDIO_BYTES
        );
        assert_eq!(
            fs::read(fixture.clone.join(SOURCE_PATH)).unwrap(),
            b"tampered-source"
        );
        assert_eq!(
            RenameSampleExecutor::new(local_paths(&fixture.local))
                .rename_journal(&fixture.prepared.operation_id)
                .unwrap()
                .unwrap()
                .status,
            RenameJournalStatus::Applying
        );
    }

    #[test]
    fn independently_changed_project_is_not_overwritten() {
        let fixture = prepare_clone(true, true, vec![assignment(WORK_PATH)]);
        fs::write(fixture.clone.join(WORK_PATH), b"tampered-project").unwrap();
        mark_journal_applying(&fixture.local, &fixture.prepared.operation_id);
        let before = snapshot_root(&fixture.clone);
        let error = RenameSampleExecutor::new(local_paths(&fixture.local))
            .rollback(
                &fixture.plan.root_id,
                &fixture.prepared.operation_id,
                &authority_for(&fixture.clone),
            )
            .unwrap_err();
        assert!(matches!(error, ExecutorError::RecoveryRequired));
        assert_eq!(snapshot_root(&fixture.clone), before);
        assert_eq!(
            fs::read(fixture.clone.join(WORK_PATH)).unwrap(),
            b"tampered-project"
        );
    }

    #[test]
    fn leftover_project_partial_is_removed_on_rollback() {
        let fixture = prepare_clone(true, true, vec![assignment(WORK_PATH)]);
        let leftover = fixture.clone.join("SET/PROJECT").join(format!(
            "{}.partial",
            sibling_stem(&fixture.prepared.operation_id, WORK_PATH, "project")
        ));
        fs::write(&leftover, b"leftover-partial").unwrap();
        mark_journal_applying(&fixture.local, &fixture.prepared.operation_id);
        let journal = RenameSampleExecutor::new(local_paths(&fixture.local))
            .rollback(
                &fixture.plan.root_id,
                &fixture.prepared.operation_id,
                &authority_for(&fixture.clone),
            )
            .unwrap();
        assert_eq!(journal.status, RenameJournalStatus::RolledBack);
        assert!(!leftover.exists());
        assert_eq!(snapshot_root(&fixture.clone), fixture.clone_before);
    }

    #[test]
    fn rollback_survives_restart_without_a_general_write_grant() {
        let fixture = prepare_clone(false, false, Vec::new());
        fs::write(fixture.clone.join(DESTINATION_PATH), AUDIO_BYTES).unwrap();
        mark_journal_applying(&fixture.local, &fixture.prepared.operation_id);
        let remounted = RootId::new("root-reopened").unwrap();
        let authority = authority_for(&fixture.clone);
        {
            let mut root = authority.root.lock().unwrap();
            root.root_id = remounted.clone();
            root.write_enabled = false;
            root.observed_revision = 99;
        }
        let journal = RenameSampleExecutor::new(local_paths(&fixture.local))
            .rollback(&remounted, &fixture.prepared.operation_id, &authority)
            .unwrap();
        assert_eq!(journal.status, RenameJournalStatus::RolledBack);
        assert!(!fixture.clone.join(DESTINATION_PATH).exists());
        assert_eq!(
            fs::read(fixture.clone.join(SOURCE_PATH)).unwrap(),
            AUDIO_BYTES
        );
        assert_eq!(snapshot_root(&fixture.clone), fixture.clone_before);
        assert_eq!(snapshot_root(&fixture.original), fixture.original_before);
    }
}
