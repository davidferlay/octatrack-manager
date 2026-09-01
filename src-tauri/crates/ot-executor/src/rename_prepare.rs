#![forbid(unsafe_code)]

use crate::{
    acquire_root_lock, open_root_regular_file, prepare_local_directory, sync_directory,
    validate_canonical_root, ApprovedExecutionRoot, ExecutorError, ExecutorLocalPaths, OperationId,
    WriteAuthority, RENAME_JOURNAL_DIRECTORY,
};
use ot_backup::{recovery_binding_for_rename_plan, BackupStore, VerifiedRenameBackup};
use ot_codec_ports::{rewrite_same_directory_path, ProjectReferenceCodec, SlotPathPatch};
use ot_domain::{
    ContentHash, RootRelativePath, SampleSlotKind, StateDocumentKind, StateDocumentRole,
};
use ot_plan::{PlanId, RenameImpactPlan, RenameReferenceUpdate, RenameStateDocumentImpact};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const RENAME_JOURNAL_SCHEMA: &str = "masterocta-rename-operation-journal:v1";
const RENAME_RECOVERY_AUTHORIZATION_SCHEMA: &str = "masterocta-rename-recovery-authorization:v1";
const RENAME_AUTHORIZATION_DIRECTORY: &str = "authorizations";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenameJournalOperationKind {
    RenameSample,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenameJournalStatus {
    Prepared,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenameStagedFileRole {
    DestinationAudio,
    ProjectWorking,
    ProjectSavedCheckpoint,
    DestinationSidecar,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameStagedFileRecord {
    pub relative_path: String,
    pub role: RenameStagedFileRole,
    pub backup_content_hash: String,
    pub staged_content_hash: String,
    pub byte_size: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameChangedSlot {
    pub kind: String,
    pub number: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameProjectRewriteRecord {
    pub relative_path: String,
    pub backup_content_hash: String,
    pub staged_content_hash: String,
    pub changed_slots: Vec<RenameChangedSlot>,
    pub patch_count: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameOperationJournal {
    pub schema: String,
    pub operation_id: String,
    pub plan_id: String,
    pub operation_kind: RenameJournalOperationKind,
    pub root_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub backup_snapshot_id: String,
    pub recovery_binding: String,
    pub reference_update_count: u64,
    pub staged_files: Vec<RenameStagedFileRecord>,
    pub project_rewrites: Vec<RenameProjectRewriteRecord>,
    pub status: RenameJournalStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameRecoveryAuthorization {
    pub schema: String,
    pub operation_id: String,
    pub plan_id: String,
    pub root_id: String,
    pub root_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub backup_snapshot_id: String,
    pub recovery_binding: String,
    pub source_byte_size: u64,
    pub source_content_hash: String,
    pub reference_update_count: u64,
    pub staged_files: Vec<RenameStagedFileRecord>,
    pub project_rewrites: Vec<RenameProjectRewriteRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenameSemanticDiff {
    pub staged_files: Vec<RenameStagedFileRecord>,
    pub project_rewrites: Vec<RenameProjectRewriteRecord>,
    pub total_staged_bytes: u64,
}

#[derive(Debug)]
pub struct RenamePrepareResult {
    pub operation_id: OperationId,
    pub backup: VerifiedRenameBackup,
    pub journal: RenameOperationJournal,
    pub authorization: RenameRecoveryAuthorization,
    pub semantic_diff: RenameSemanticDiff,
    pub staging_directory: PathBuf,
}

pub struct RenameSampleExecutor {
    local_paths: ExecutorLocalPaths,
}

impl RenameSampleExecutor {
    pub fn new(local_paths: ExecutorLocalPaths) -> Self {
        Self { local_paths }
    }

    pub fn prepare<C, A>(
        &self,
        plan: &RenameImpactPlan,
        codec: &C,
        authority: &A,
    ) -> Result<RenamePrepareResult, ExecutorError>
    where
        C: ProjectReferenceCodec,
        A: WriteAuthority,
    {
        validate_rename_plan_shape(plan)?;
        let operation_id = OperationId::for_rename_plan(plan);
        let root = validate_rename_authority(plan, authority.resolve_for_write(&plan.root_id)?)?;
        let staging_base =
            prepare_local_directory(&self.local_paths.staging_directory, &root.canonical_path)?;
        let journal_directory =
            prepare_local_directory(&self.local_paths.journal_directory, &root.canonical_path)?;
        let backup_directory =
            prepare_local_directory(&self.local_paths.backup_directory, &root.canonical_path)?;
        let _lock = acquire_root_lock(&journal_directory, &plan.device_fingerprint)?;

        let rename_journal_directory =
            prepare_rename_subdirectory(&journal_directory, RENAME_JOURNAL_DIRECTORY)?;
        let authorization_directory =
            prepare_rename_subdirectory(&rename_journal_directory, RENAME_AUTHORIZATION_DIRECTORY)?;
        let journal_path =
            rename_journal_directory.join(format!("{}.json", operation_id.file_stem()));
        match fs::symlink_metadata(&journal_path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(_) => return Err(ExecutorError::PlanConsumed),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ExecutorError::io(error)),
        }

        let backup_store = BackupStore::new(backup_directory);
        let backup = backup_store
            .verify_for_rename_plan(plan)
            .map_err(ExecutorError::Backup)?;
        if backup.manifest().recovery_binding
            != recovery_binding_for_rename_plan(plan).map_err(ExecutorError::Backup)?
        {
            return Err(ExecutorError::InvalidJournal);
        }

        let staging_rename = prepare_rename_subdirectory(&staging_base, RENAME_JOURNAL_DIRECTORY)?;
        let staging_root = staging_rename.join(operation_id.file_stem());
        match fs::symlink_metadata(&staging_root) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(_) => return Err(ExecutorError::PlanConsumed),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ExecutorError::io(error)),
        }
        fs::create_dir(&staging_root).map_err(ExecutorError::io)?;
        let files_root = staging_root.join("files");
        fs::create_dir(&files_root).map_err(ExecutorError::io)?;

        let populated = populate_rename_staging(plan, codec, backup.directory(), &files_root);
        if let Err(error) = populated {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error);
        }
        let (staged_files, project_rewrites) = populated.expect("staging error already returned");
        if let Err(error) = sync_directory(&files_root).and_then(|_| sync_directory(&staging_root))
        {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error);
        }

        let authorization = match ensure_rename_recovery_authorization(
            &authorization_directory,
            plan,
            &operation_id,
            backup.snapshot_id().as_str(),
            &staged_files,
            &project_rewrites,
        ) {
            Ok(authorization) => authorization,
            Err(error) => {
                let _ = fs::remove_dir_all(&staging_root);
                return Err(error);
            }
        };

        let journal = RenameOperationJournal {
            schema: RENAME_JOURNAL_SCHEMA.to_owned(),
            operation_id: operation_id.as_str().to_owned(),
            plan_id: plan.id.as_str().to_owned(),
            operation_kind: RenameJournalOperationKind::RenameSample,
            root_fingerprint: plan.device_fingerprint.clone(),
            base_observed_revision: plan.base_observed_revision,
            source_relative_path: plan.source_relative_path.as_str().to_owned(),
            destination_relative_path: plan.destination_relative_path.as_str().to_owned(),
            backup_snapshot_id: backup.snapshot_id().as_str().to_owned(),
            recovery_binding: authorization.recovery_binding.clone(),
            reference_update_count: plan.reference_update_count,
            staged_files: staged_files.clone(),
            project_rewrites: project_rewrites.clone(),
            status: RenameJournalStatus::Prepared,
        };
        if let Err(error) = write_rename_json(&journal_path, &journal, false) {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error);
        }

        let total_staged_bytes = staged_files
            .iter()
            .try_fold(0u64, |total, file| total.checked_add(file.byte_size))
            .ok_or(ExecutorError::FileTooLarge)?;
        Ok(RenamePrepareResult {
            operation_id,
            backup,
            journal,
            authorization,
            semantic_diff: RenameSemanticDiff {
                staged_files,
                project_rewrites,
                total_staged_bytes,
            },
            staging_directory: staging_root,
        })
    }

    pub fn rename_journal(
        &self,
        operation_id: &OperationId,
    ) -> Result<Option<RenameOperationJournal>, ExecutorError> {
        let journal_directory = match fs::symlink_metadata(&self.local_paths.journal_directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(ExecutorError::UnsafePath);
            }
            Ok(_) => self.local_paths.journal_directory.clone(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(ExecutorError::io(error)),
        };
        let path = journal_directory
            .join(RENAME_JOURNAL_DIRECTORY)
            .join(format!("{}.json", operation_id.file_stem()));
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                Err(ExecutorError::UnsafePath)
            }
            Ok(_) => {
                let journal = read_rename_journal(&path)?;
                if journal.operation_id != operation_id.as_str() {
                    return Err(ExecutorError::InvalidJournal);
                }
                Ok(Some(journal))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(ExecutorError::io(error)),
        }
    }
}

fn validate_rename_plan_shape(plan: &RenameImpactPlan) -> Result<(), ExecutorError> {
    plan.validate_integrity()
        .map_err(|_| ExecutorError::InvalidPlan)?;
    if plan.base_observed_revision == 0
        || plan.source_relative_path == plan.destination_relative_path
        || !plan.unresolved_references.is_empty()
        || plan.estimated_media_additional_bytes != 0
    {
        return Err(ExecutorError::InvalidPlan);
    }
    let expected_updates = plan
        .state_document_impacts
        .iter()
        .map(|document| document.reference_updates.len() as u64)
        .try_fold(0u64, |total, count| total.checked_add(count))
        .ok_or(ExecutorError::InvalidPlan)?;
    if expected_updates != plan.reference_update_count {
        return Err(ExecutorError::InvalidPlan);
    }
    for document in &plan.state_document_impacts {
        if document.kind != StateDocumentKind::Project || document.reference_updates.is_empty() {
            return Err(ExecutorError::InvalidPlan);
        }
        for update in &document.reference_updates {
            if update.from_relative_path != plan.source_relative_path
                || update.to_relative_path != plan.destination_relative_path
            {
                return Err(ExecutorError::InvalidPlan);
            }
        }
    }
    Ok(())
}

fn validate_rename_authority(
    plan: &RenameImpactPlan,
    root: ApprovedExecutionRoot,
) -> Result<ApprovedExecutionRoot, ExecutorError> {
    if root.root_id != plan.root_id
        || root.device_fingerprint != plan.device_fingerprint
        || root.observed_revision != plan.base_observed_revision
    {
        return Err(ExecutorError::RootChanged);
    }
    if !root.write_enabled {
        return Err(ExecutorError::Authority(crate::AuthorityError::ReadOnly));
    }
    if !root.stable_device_identity {
        return Err(ExecutorError::Authority(
            crate::AuthorityError::UnstableIdentity,
        ));
    }
    validate_canonical_root(&root.canonical_path)?;
    Ok(root)
}

fn prepare_rename_subdirectory(parent: &Path, name: &str) -> Result<PathBuf, ExecutorError> {
    let directory = parent.join(name);
    match fs::create_dir(&directory) {
        Ok(()) => sync_directory(parent)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(ExecutorError::io(error)),
    }
    let metadata = fs::symlink_metadata(&directory).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutorError::UnsafePath);
    }
    Ok(directory)
}

fn populate_rename_staging<C: ProjectReferenceCodec>(
    plan: &RenameImpactPlan,
    codec: &C,
    backup_directory: &Path,
    files_root: &Path,
) -> Result<(Vec<RenameStagedFileRecord>, Vec<RenameProjectRewriteRecord>), ExecutorError> {
    let backup_files = canonical_backup_files_root(backup_directory)?;
    let mut staged = Vec::new();
    let mut rewrites = Vec::new();
    let mut staged_paths = BTreeSet::new();

    let audio = copy_backup_file_to_staging(
        &backup_files,
        files_root,
        &plan.source_relative_path,
        &plan.destination_relative_path,
        &plan.source_content_hash,
        RenameStagedFileRole::DestinationAudio,
    )?;
    insert_unique_path(&mut staged_paths, &audio.relative_path)?;
    staged.push(audio);

    for sidecar in &plan.sidecar_impacts {
        let record = copy_backup_file_to_staging(
            &backup_files,
            files_root,
            &sidecar.source_sidecar_relative_path,
            &sidecar.destination_sidecar_relative_path,
            &sidecar.content_hash,
            RenameStagedFileRole::DestinationSidecar,
        )?;
        insert_unique_path(&mut staged_paths, &record.relative_path)?;
        staged.push(record);
    }

    for document in &plan.state_document_impacts {
        let (record, rewrite) =
            rewrite_project_into_staging(codec, &backup_files, files_root, document)?;
        insert_unique_path(&mut staged_paths, &record.relative_path)?;
        staged.push(record);
        rewrites.push(rewrite);
    }

    let mut expected = BTreeSet::new();
    expected.insert(plan.destination_relative_path.as_str().to_owned());
    for sidecar in &plan.sidecar_impacts {
        expected.insert(
            sidecar
                .destination_sidecar_relative_path
                .as_str()
                .to_owned(),
        );
    }
    for document in &plan.state_document_impacts {
        expected.insert(document.relative_path.as_str().to_owned());
    }
    if staged_paths != expected {
        return Err(ExecutorError::InvalidPlan);
    }
    reject_incomparable_paths(&staged_paths)?;

    staged.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    rewrites.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok((staged, rewrites))
}

fn canonical_backup_files_root(backup_directory: &Path) -> Result<PathBuf, ExecutorError> {
    let files = backup_directory.join("files");
    let metadata = fs::symlink_metadata(&files).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutorError::UnsafePath);
    }
    files.canonicalize().map_err(ExecutorError::io)
}

fn copy_backup_file_to_staging(
    backup_files: &Path,
    files_root: &Path,
    source_relative: &RootRelativePath,
    destination_relative: &RootRelativePath,
    expected_hash: &ContentHash,
    role: RenameStagedFileRole,
) -> Result<RenameStagedFileRecord, ExecutorError> {
    let mut source = open_root_regular_file(backup_files, source_relative)?;
    let destination = create_staging_destination(files_root, destination_relative)?;
    let (byte_size, staged_hash) = copy_and_hash(&mut source, &destination)?;
    if staged_hash != *expected_hash {
        return Err(ExecutorError::SourceChanged);
    }
    Ok(RenameStagedFileRecord {
        relative_path: destination_relative.as_str().to_owned(),
        role,
        backup_content_hash: expected_hash.as_str().to_owned(),
        staged_content_hash: staged_hash.as_str().to_owned(),
        byte_size,
    })
}

fn rewrite_project_into_staging<C: ProjectReferenceCodec>(
    codec: &C,
    backup_files: &Path,
    files_root: &Path,
    document: &RenameStateDocumentImpact,
) -> Result<(RenameStagedFileRecord, RenameProjectRewriteRecord), ExecutorError> {
    let mut source = open_root_regular_file(backup_files, &document.relative_path)?;
    let original = read_all(&mut source)?;
    let original_hash = hash_bytes(&original);
    if original_hash != document.content_hash || original.len() as u64 != document.byte_size {
        return Err(ExecutorError::SourceChanged);
    }
    let patches = build_slot_path_patches(codec, &original, &document.reference_updates)?;
    if patches.len() != document.reference_updates.len() {
        return Err(ExecutorError::InvalidPlan);
    }
    let encoded = codec
        .apply_path_patches(&original, &patches)
        .map_err(ExecutorError::ReferenceRewrite)?;
    if encoded.changed_slots.len() as u64 != plan_nonzero_patch_count(&patches)
        || encoded.changed_slots.is_empty()
        || encoded.bytes == original
    {
        return Err(ExecutorError::InvalidPlan);
    }
    let destination = create_staging_destination(files_root, &document.relative_path)?;
    write_new_synced(&destination, &encoded.bytes)?;
    let staged_hash = hash_bytes(&encoded.bytes);
    let role = match document.role {
        StateDocumentRole::Working => RenameStagedFileRole::ProjectWorking,
        StateDocumentRole::SavedCheckpoint => RenameStagedFileRole::ProjectSavedCheckpoint,
    };
    let record = RenameStagedFileRecord {
        relative_path: document.relative_path.as_str().to_owned(),
        role,
        backup_content_hash: document.content_hash.as_str().to_owned(),
        staged_content_hash: staged_hash.as_str().to_owned(),
        byte_size: encoded.bytes.len() as u64,
    };
    let rewrite = RenameProjectRewriteRecord {
        relative_path: document.relative_path.as_str().to_owned(),
        backup_content_hash: document.content_hash.as_str().to_owned(),
        staged_content_hash: staged_hash.as_str().to_owned(),
        changed_slots: encoded
            .changed_slots
            .iter()
            .map(|slot| RenameChangedSlot {
                kind: slot_kind_token(slot.kind()).to_owned(),
                number: slot.number(),
            })
            .collect(),
        patch_count: patches.len() as u64,
    };
    Ok((record, rewrite))
}

fn plan_nonzero_patch_count(patches: &[SlotPathPatch]) -> u64 {
    patches
        .iter()
        .filter(|patch| patch.from_raw_path != patch.to_raw_path)
        .count() as u64
}

fn build_slot_path_patches<C: ProjectReferenceCodec>(
    codec: &C,
    backup_bytes: &[u8],
    updates: &[RenameReferenceUpdate],
) -> Result<Vec<SlotPathPatch>, ExecutorError> {
    let inspected = codec
        .inspect_sample_paths(backup_bytes)
        .map_err(ExecutorError::ReferenceRewrite)?;
    let mut patches = Vec::with_capacity(updates.len());
    let mut seen = BTreeSet::new();
    for update in updates {
        if !seen.insert((
            slot_kind_token(update.slot.kind()).to_owned(),
            update.slot.number(),
        )) {
            return Err(ExecutorError::InvalidPlan);
        }
        let observed = inspected
            .iter()
            .find(|entry| entry.slot == update.slot)
            .ok_or(ExecutorError::InvalidPlan)?;
        raw_path_matches_relative(&observed.raw_path, update.from_relative_path.as_str())?;
        let to_basename = path_basename(update.to_relative_path.as_str())?;
        let to_raw_path = rewrite_same_directory_path(&observed.raw_path, to_basename)
            .map_err(ExecutorError::ReferenceRewrite)?;
        patches.push(SlotPathPatch {
            slot: update.slot,
            from_raw_path: observed.raw_path.clone(),
            to_raw_path,
        });
    }
    Ok(patches)
}

fn path_basename(relative: &str) -> Result<&str, ExecutorError> {
    relative
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or(ExecutorError::InvalidPlan)
}

fn raw_path_matches_relative(raw_path: &str, relative: &str) -> Result<(), ExecutorError> {
    let raw_parts = normalize_path_components(raw_path, true)?;
    let relative_parts = normalize_path_components(relative, false)?;
    if raw_parts.is_empty() || relative_parts.is_empty() || raw_parts.len() > relative_parts.len() {
        return Err(ExecutorError::InvalidPlan);
    }
    if raw_parts[raw_parts.len().saturating_sub(1)]
        != relative_parts[relative_parts.len().saturating_sub(1)]
    {
        return Err(ExecutorError::InvalidPlan);
    }
    let suffix = &relative_parts[relative_parts.len() - raw_parts.len()..];
    if suffix != raw_parts {
        return Err(ExecutorError::InvalidPlan);
    }
    Ok(())
}

fn normalize_path_components(
    path: &str,
    strip_leading_dotdot: bool,
) -> Result<Vec<&str>, ExecutorError> {
    let mut parts = Vec::new();
    for part in path.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if strip_leading_dotdot && parts.is_empty() {
                continue;
            }
            return Err(ExecutorError::InvalidPlan);
        }
        parts.push(part);
    }
    Ok(parts)
}

fn reject_incomparable_paths(paths: &BTreeSet<String>) -> Result<(), ExecutorError> {
    let listed = paths.iter().collect::<Vec<_>>();
    for (index, left) in listed.iter().enumerate() {
        for right in &listed[index + 1..] {
            if left.eq_ignore_ascii_case(right) {
                return Err(ExecutorError::UnsafePath);
            }
        }
    }
    Ok(())
}

fn slot_kind_token(kind: SampleSlotKind) -> &'static str {
    match kind {
        SampleSlotKind::Static => "static",
        SampleSlotKind::Flex => "flex",
    }
}

fn insert_unique_path(paths: &mut BTreeSet<String>, path: &str) -> Result<(), ExecutorError> {
    if !paths.insert(path.to_owned()) {
        return Err(ExecutorError::InvalidPlan);
    }
    Ok(())
}

fn create_staging_destination(
    files_root: &Path,
    relative_path: &RootRelativePath,
) -> Result<PathBuf, ExecutorError> {
    let mut destination = files_root.to_owned();
    let components = relative_path.as_str().split('/').collect::<Vec<_>>();
    for component in &components[..components.len() - 1] {
        destination.push(component);
        match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => return Err(ExecutorError::UnsafePath),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&destination).map_err(ExecutorError::io)?;
            }
            Err(error) => return Err(ExecutorError::io(error)),
        }
    }
    destination.push(components.last().expect("relative path is non-empty"));
    Ok(destination)
}

fn copy_and_hash(
    source: &mut File,
    destination: &Path,
) -> Result<(u64, ContentHash), ExecutorError> {
    let mut writer = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .map_err(ExecutorError::io)?;
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source.read(&mut buffer).map_err(ExecutorError::io)?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(ExecutorError::io)?;
        hasher.update(&buffer[..read]);
        byte_size = byte_size
            .checked_add(read as u64)
            .ok_or(ExecutorError::FileTooLarge)?;
    }
    writer.sync_all().map_err(ExecutorError::io)?;
    Ok((byte_size, content_hash_from_digest(hasher)))
}

fn read_all(source: &mut File) -> Result<Vec<u8>, ExecutorError> {
    let mut bytes = Vec::new();
    source.read_to_end(&mut bytes).map_err(ExecutorError::io)?;
    Ok(bytes)
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), ExecutorError> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(ExecutorError::io)?;
    file.write_all(bytes).map_err(ExecutorError::io)?;
    file.sync_all().map_err(ExecutorError::io)
}

fn hash_bytes(bytes: &[u8]) -> ContentHash {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    content_hash_from_digest(hasher)
}

fn content_hash_from_digest(hasher: Sha256) -> ContentHash {
    ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
        .expect("SHA-256 output is canonical")
}

fn ensure_rename_recovery_authorization(
    directory: &Path,
    plan: &RenameImpactPlan,
    operation_id: &OperationId,
    backup_snapshot_id: &str,
    staged_files: &[RenameStagedFileRecord],
    project_rewrites: &[RenameProjectRewriteRecord],
) -> Result<RenameRecoveryAuthorization, ExecutorError> {
    let expected = rename_recovery_authorization(
        plan,
        operation_id,
        backup_snapshot_id,
        staged_files,
        project_rewrites,
    )?;
    let path = directory.join(format!("{}.json", operation_id.file_stem()));
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ExecutorError::UnsafePath);
        }
        Ok(_) => {
            let existing = read_rename_authorization(&path)?;
            if existing != expected {
                return Err(ExecutorError::InvalidJournal);
            }
            return Ok(existing);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(ExecutorError::io(error)),
    }
    write_rename_json(&path, &expected, true)?;
    Ok(expected)
}

fn rename_recovery_authorization(
    plan: &RenameImpactPlan,
    operation_id: &OperationId,
    backup_snapshot_id: &str,
    staged_files: &[RenameStagedFileRecord],
    project_rewrites: &[RenameProjectRewriteRecord],
) -> Result<RenameRecoveryAuthorization, ExecutorError> {
    Ok(RenameRecoveryAuthorization {
        schema: RENAME_RECOVERY_AUTHORIZATION_SCHEMA.to_owned(),
        operation_id: operation_id.as_str().to_owned(),
        plan_id: plan.id.as_str().to_owned(),
        root_id: plan.root_id.as_str().to_owned(),
        root_fingerprint: plan.device_fingerprint.clone(),
        base_observed_revision: plan.base_observed_revision,
        source_relative_path: plan.source_relative_path.as_str().to_owned(),
        destination_relative_path: plan.destination_relative_path.as_str().to_owned(),
        backup_snapshot_id: backup_snapshot_id.to_owned(),
        recovery_binding: recovery_binding_for_rename_plan(plan).map_err(ExecutorError::Backup)?,
        source_byte_size: plan.source_byte_size,
        source_content_hash: plan.source_content_hash.as_str().to_owned(),
        reference_update_count: plan.reference_update_count,
        staged_files: staged_files.to_vec(),
        project_rewrites: project_rewrites.to_vec(),
    })
}

fn write_rename_json<T: Serialize>(
    path: &Path,
    value: &T,
    read_only: bool,
) -> Result<(), ExecutorError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| ExecutorError::Journal(error.to_string()))?;
    let temporary = path.with_extension("json.tmp");
    if temporary.exists() {
        let metadata = fs::symlink_metadata(&temporary).map_err(ExecutorError::io)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(ExecutorError::UnsafePath);
        }
        fs::remove_file(&temporary).map_err(ExecutorError::io)?;
    }
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(ExecutorError::io)?;
        file.write_all(&bytes).map_err(ExecutorError::io)?;
        file.sync_all().map_err(ExecutorError::io)?;
        if read_only {
            file.set_permissions(fs::Permissions::from_mode(0o400))
                .map_err(ExecutorError::io)?;
            file.sync_all().map_err(ExecutorError::io)?;
        }
        fs::rename(&temporary, path).map_err(ExecutorError::io)?;
        sync_directory(path.parent().ok_or(ExecutorError::UnsafePath)?)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn read_rename_journal(path: &Path) -> Result<RenameOperationJournal, ExecutorError> {
    let journal: RenameOperationJournal = serde_json::from_reader(open_regular_file(path)?)
        .map_err(|error| ExecutorError::Journal(error.to_string()))?;
    if journal.schema != RENAME_JOURNAL_SCHEMA
        || journal.operation_kind != RenameJournalOperationKind::RenameSample
        || journal.status != RenameJournalStatus::Prepared
        || PlanId::parse(journal.plan_id.clone()).is_err()
    {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(journal)
}

fn read_rename_authorization(path: &Path) -> Result<RenameRecoveryAuthorization, ExecutorError> {
    let authorization: RenameRecoveryAuthorization =
        serde_json::from_reader(open_regular_file(path)?)
            .map_err(|error| ExecutorError::Journal(error.to_string()))?;
    if authorization.schema != RENAME_RECOVERY_AUTHORIZATION_SCHEMA {
        return Err(ExecutorError::InvalidJournal);
    }
    Ok(authorization)
}

fn open_regular_file(path: &Path) -> Result<File, ExecutorError> {
    let metadata = fs::symlink_metadata(path).map_err(ExecutorError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ExecutorError::UnsafePath);
    }
    File::open(path).map_err(ExecutorError::io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ApprovedExecutionRoot, AuthorityError};
    use ot_backup::BackupStore;
    use ot_codec::MemoryProjectReferenceCodec;
    use ot_domain::{
        ContentHashFreshness, ParserProvenance, ProjectCompatibilityEvidence, RenameSampleIntent,
        RootId, RootRelativePath, SampleReferenceStatus, SampleSettingsParseStatus, SampleSlotId,
        SampleSlotKind, StateDocumentKind, StateDocumentParseStatus, StateDocumentRole,
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

    struct FixtureAuthority {
        root: Mutex<ApprovedExecutionRoot>,
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

    fn fingerprint() -> String {
        format!("rootfp:v1:{}", "a".repeat(64))
    }

    fn hash_of(bytes: &[u8]) -> ContentHash {
        hash_bytes(bytes)
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
            content_hash: hash_of(bytes),
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
                catalog_content_hash: hash_of(AUDIO_BYTES),
                live_relative_path: source.clone(),
                live_byte_size: AUDIO_BYTES.len() as u64,
                live_content_hash: hash_of(AUDIO_BYTES),
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
                    content_hash: hash_of(SIDECAR_BYTES),
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

    fn create_backup(root: &Path, local: &Path, plan: &RenameImpactPlan) -> VerifiedRenameBackup {
        BackupStore::new(local.join("backups"))
            .create_verified_for_rename(root, plan)
            .unwrap()
    }

    #[test]
    fn unused_sample_prepares_destination_audio_only_and_leaves_root_unchanged() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, false, false, false);
        let before = snapshot_root(&root);
        let plan = plan_from(facts(Vec::new(), false));
        create_backup(&root, &local, &plan);
        let executor = RenameSampleExecutor::new(local_paths(&local));
        let prepared = executor
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root))
            .unwrap();

        assert_eq!(prepared.journal.status, RenameJournalStatus::Prepared);
        assert_eq!(
            prepared.journal.operation_kind,
            RenameJournalOperationKind::RenameSample
        );
        assert_eq!(prepared.journal.schema, RENAME_JOURNAL_SCHEMA);
        assert_eq!(
            prepared
                .semantic_diff
                .staged_files
                .iter()
                .map(|file| (file.relative_path.as_str(), file.role))
                .collect::<Vec<_>>(),
            vec![(DESTINATION_PATH, RenameStagedFileRole::DestinationAudio)]
        );
        assert!(prepared.semantic_diff.project_rewrites.is_empty());
        assert_eq!(
            fs::read(
                prepared
                    .staging_directory
                    .join("files")
                    .join(DESTINATION_PATH)
            )
            .unwrap(),
            AUDIO_BYTES
        );
        assert!(!prepared
            .staging_directory
            .join("files")
            .join(SOURCE_PATH)
            .exists());
        assert_eq!(snapshot_root(&root), before);
        let journal_text = fs::read_to_string(
            local
                .join("journals")
                .join(RENAME_JOURNAL_DIRECTORY)
                .join(format!("{}.json", prepared.operation_id.file_stem())),
        )
        .unwrap();
        assert!(!journal_text.contains(root.to_string_lossy().as_ref()));
        assert!(!journal_text.contains("root-session-1"));
        assert!(prepared.authorization.root_id.contains("root-session-1"));
        assert!(!serde_json::to_string(&prepared.authorization)
            .unwrap()
            .contains(root.to_string_lossy().as_ref()));
        assert_eq!(
            prepared.authorization.staged_files,
            prepared.journal.staged_files
        );
        assert_eq!(
            prepared.authorization.project_rewrites,
            prepared.journal.project_rewrites
        );
    }

    #[test]
    fn working_document_and_sidecar_are_rewritten_only_on_mac_staging() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, true, true, false);
        let before = snapshot_root(&root);
        let plan = plan_from(facts(vec![assignment(WORK_PATH)], true));
        create_backup(&root, &local, &plan);
        let prepared = RenameSampleExecutor::new(local_paths(&local))
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root))
            .unwrap();

        let staged_work =
            fs::read(prepared.staging_directory.join("files").join(WORK_PATH)).unwrap();
        assert_ne!(staged_work, project_bytes());
        assert!(String::from_utf8(staged_work)
            .unwrap()
            .contains("../AUDIO/new-kick.wav"));
        assert_eq!(
            fs::read(
                prepared
                    .staging_directory
                    .join("files")
                    .join("SET/AUDIO/new-kick.ot")
            )
            .unwrap(),
            SIDECAR_BYTES
        );
        assert_eq!(prepared.semantic_diff.project_rewrites.len(), 1);
        assert_eq!(
            prepared.semantic_diff.project_rewrites[0].changed_slots,
            vec![RenameChangedSlot {
                kind: "static".into(),
                number: 1
            }]
        );
        assert_ne!(
            prepared.semantic_diff.project_rewrites[0].backup_content_hash,
            prepared.semantic_diff.project_rewrites[0].staged_content_hash
        );
        assert_eq!(snapshot_root(&root), before);
        assert!(!root.join(DESTINATION_PATH).exists());
        assert!(!root.join("SET/AUDIO/new-kick.ot").exists());
        assert_eq!(fs::read(root.join(WORK_PATH)).unwrap(), project_bytes());
        assert_eq!(
            prepared.authorization.staged_files,
            prepared.journal.staged_files
        );
        assert_eq!(
            prepared.authorization.project_rewrites,
            prepared.journal.project_rewrites
        );
    }

    #[test]
    fn missing_verified_backup_fails_before_staging_or_journal() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, false, false, false);
        let before = snapshot_root(&root);
        let plan = plan_from(facts(Vec::new(), false));
        let error = RenameSampleExecutor::new(local_paths(&local))
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root))
            .unwrap_err();
        assert!(matches!(error, ExecutorError::Backup(_)));
        assert_eq!(snapshot_root(&root), before);
        assert!(
            !local
                .join("journals")
                .join(RENAME_JOURNAL_DIRECTORY)
                .exists()
                || fs::read_dir(local.join("journals").join(RENAME_JOURNAL_DIRECTORY))
                    .map(|entries| entries.count())
                    .unwrap_or(0)
                    == 0
                || !local
                    .join("journals")
                    .join(RENAME_JOURNAL_DIRECTORY)
                    .join(format!(
                        "{}.json",
                        OperationId::for_rename_plan(&plan).file_stem()
                    ))
                    .exists()
        );
    }

    #[test]
    fn local_state_inside_the_root_is_rejected() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let plan = plan_from(facts(Vec::new(), false));
        create_backup(&root, &fixture.path().join("outside-backups"), &plan);
        let executor = RenameSampleExecutor::new(ExecutorLocalPaths {
            staging_directory: root.join(".masterocta/staging"),
            backup_directory: root.join(".masterocta/backups"),
            journal_directory: root.join(".masterocta/journals"),
        });
        assert!(matches!(
            executor.prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root)),
            Err(ExecutorError::LocalStateInsideRoot)
        ));
        assert!(!root.join(".masterocta").exists());
        assert!(!root.join(DESTINATION_PATH).exists());
    }

    #[test]
    fn prepared_journal_is_create_once() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, false, false, false);
        let plan = plan_from(facts(Vec::new(), false));
        create_backup(&root, &local, &plan);
        let executor = RenameSampleExecutor::new(local_paths(&local));
        executor
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root))
            .unwrap();
        assert!(matches!(
            executor.prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root)),
            Err(ExecutorError::PlanConsumed)
        ));
    }

    #[test]
    fn basename_mismatch_between_plan_and_project_path_fails_closed() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, false, true, false);
        fs::write(
            root.join(WORK_PATH),
            b"[SAMPLE]\nTYPE=STATIC\nSLOT=1\nPATH=../AUDIO/other.wav\n[/SAMPLE]\n",
        )
        .unwrap();
        let mut planning = facts(vec![assignment(WORK_PATH)], false);
        planning.state_documents[0].byte_size = fs::metadata(root.join(WORK_PATH)).unwrap().len();
        planning.state_documents[0].content_hash =
            hash_of(&fs::read(root.join(WORK_PATH)).unwrap());
        let plan = plan_from(planning);
        create_backup(&root, &local, &plan);
        let before = snapshot_root(&root);
        let error = RenameSampleExecutor::new(local_paths(&local))
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root))
            .unwrap_err();
        assert!(matches!(
            error,
            ExecutorError::InvalidPlan | ExecutorError::ReferenceRewrite(_)
        ));
        assert_eq!(snapshot_root(&root), before);
    }

    #[test]
    fn additive_copy_journal_scan_ignores_rename_subdirectory() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, false, false, false);
        let plan = plan_from(facts(Vec::new(), false));
        create_backup(&root, &local, &plan);
        RenameSampleExecutor::new(local_paths(&local))
            .prepare(&plan, &MemoryProjectReferenceCodec, &authority_for(&root))
            .unwrap();

        let additive = crate::AdditiveCopyExecutor::new(local_paths(&local));
        assert!(additive
            .incomplete_journals_for_root(&fingerprint())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn project_path_in_a_different_directory_fails_closed() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        write_tree(&root, false, true, false);
        fs::write(
            root.join(WORK_PATH),
            b"[SAMPLE]\nTYPE=STATIC\nSLOT=1\nPATH=../OTHER/kick.wav\n[/SAMPLE]\n",
        )
        .unwrap();
        let mut planning = facts(vec![assignment(WORK_PATH)], false);
        planning.state_documents[0].byte_size = fs::metadata(root.join(WORK_PATH)).unwrap().len();
        planning.state_documents[0].content_hash =
            hash_of(&fs::read(root.join(WORK_PATH)).unwrap());
        let plan = plan_from(planning);
        create_backup(&root, &local, &plan);
        let before = snapshot_root(&root);
        assert!(matches!(
            RenameSampleExecutor::new(local_paths(&local)).prepare(
                &plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&root)
            ),
            Err(ExecutorError::InvalidPlan)
        ));
        assert_eq!(snapshot_root(&root), before);
    }

    #[cfg(unix)]
    #[test]
    fn staging_rename_symlink_is_rejected_without_writing_the_target() {
        use std::os::unix::fs::symlink;

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let local = fixture.path().join("local");
        let outside = fixture.path().join("outside-media");
        write_tree(&root, false, false, false);
        let plan = plan_from(facts(Vec::new(), false));
        create_backup(&root, &local, &plan);
        fs::create_dir_all(local.join("staging")).unwrap();
        fs::create_dir(&outside).unwrap();
        symlink(
            &outside,
            local.join("staging").join(RENAME_JOURNAL_DIRECTORY),
        )
        .unwrap();
        let before_outside = snapshot_root(&outside);
        let before_root = snapshot_root(&root);
        assert!(matches!(
            RenameSampleExecutor::new(local_paths(&local)).prepare(
                &plan,
                &MemoryProjectReferenceCodec,
                &authority_for(&root)
            ),
            Err(ExecutorError::UnsafePath)
        ));
        assert_eq!(snapshot_root(&outside), before_outside);
        assert_eq!(snapshot_root(&root), before_root);
    }

    #[test]
    fn raw_path_suffix_must_match_the_planned_relative_path() {
        assert!(raw_path_matches_relative("../AUDIO/kick.wav", SOURCE_PATH).is_ok());
        assert!(raw_path_matches_relative("..\\AUDIO\\kick.wav", SOURCE_PATH).is_ok());
        assert!(raw_path_matches_relative("kick.wav", SOURCE_PATH).is_ok());
        assert!(raw_path_matches_relative("../OTHER/kick.wav", SOURCE_PATH).is_err());
        assert!(raw_path_matches_relative("../AUDIO/../kick.wav", SOURCE_PATH).is_err());
        assert!(raw_path_matches_relative("../AUDIO/other.wav", SOURCE_PATH).is_err());
    }
}
