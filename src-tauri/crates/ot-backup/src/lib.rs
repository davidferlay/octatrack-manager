#![forbid(unsafe_code)]

use ot_domain::{ContentHash, RootRelativePath};
use ot_plan::{ChangePlan, PlanId};
use rustix::fs::{self as descriptor_fs, Mode, OFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MANIFEST_SCHEMA: &str = "masterocta-backup:v2";
const SNAPSHOT_ID_PREFIX: &str = "snapshot:v1:";
const RECOVERY_BINDING_PREFIX: &str = "recovery-binding:v1:";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SnapshotId(String);

impl SnapshotId {
    pub fn for_plan(plan: &ChangePlan) -> Self {
        let digest = plan
            .id
            .as_str()
            .strip_prefix("plan:v1:")
            .expect("ChangePlan contains a validated PlanId");
        Self(format!("{SNAPSHOT_ID_PREFIX}{digest}"))
    }

    pub fn parse(value: impl Into<String>) -> Result<Self, BackupError> {
        let value = value.into();
        validate_prefixed_digest(&value, SNAPSHOT_ID_PREFIX)
            .map_err(|_| BackupError::InvalidManifest("snapshot_id"))?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn directory_name(&self) -> &str {
        self.0
            .strip_prefix(SNAPSHOT_ID_PREFIX)
            .expect("SnapshotId prefix is validated")
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BackupFileManifest {
    pub relative_path: String,
    pub byte_size: u64,
    pub content_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BackupManifest {
    pub schema: String,
    pub snapshot_id: String,
    pub plan_id: String,
    pub source_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub recovery_binding: String,
    pub complete: bool,
    pub files: Vec<BackupFileManifest>,
}

#[derive(Clone, Debug)]
pub struct VerifiedBackup {
    snapshot_id: SnapshotId,
    directory: PathBuf,
    manifest: BackupManifest,
}

impl VerifiedBackup {
    pub fn snapshot_id(&self) -> &SnapshotId {
        &self.snapshot_id
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn manifest(&self) -> &BackupManifest {
        &self.manifest
    }
}

#[derive(Clone, Debug)]
pub struct BackupStore {
    base_directory: PathBuf,
}

impl BackupStore {
    pub fn new(base_directory: impl Into<PathBuf>) -> Self {
        Self {
            base_directory: base_directory.into(),
        }
    }

    pub fn create_verified(
        &self,
        source_root: &Path,
        plan: &ChangePlan,
    ) -> Result<VerifiedBackup, BackupError> {
        validate_change_plan(plan)?;
        let source_root = canonical_directory(source_root)?;
        let base_directory = prepare_local_directory(&self.base_directory, &source_root)?;
        let snapshot_id = SnapshotId::for_plan(plan);
        let final_directory = base_directory.join(snapshot_id.directory_name());
        let partial_directory =
            base_directory.join(format!("{}.partial", snapshot_id.directory_name()));
        if final_directory.exists() || partial_directory.exists() {
            return Err(BackupError::SnapshotExists);
        }

        fs::create_dir(&partial_directory).map_err(BackupError::io)?;
        let result =
            self.populate_partial_snapshot(&source_root, plan, &snapshot_id, &partial_directory);
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&partial_directory);
            return Err(error);
        }

        sync_directory(&partial_directory)?;
        fs::rename(&partial_directory, &final_directory).map_err(BackupError::io)?;
        sync_directory(&base_directory)?;
        let backup = self.verify_directory(&final_directory)?;
        validate_plan_binding(&backup, plan)?;
        Ok(backup)
    }

    pub fn verify(&self, snapshot_id: &SnapshotId) -> Result<VerifiedBackup, BackupError> {
        let base_directory = canonical_directory(&self.base_directory)?;
        let directory = base_directory.join(snapshot_id.directory_name());
        self.verify_directory(&directory)
    }

    pub fn verify_for_plan(&self, plan: &ChangePlan) -> Result<VerifiedBackup, BackupError> {
        validate_change_plan(plan)?;
        let expected_snapshot_id = SnapshotId::for_plan(plan);
        let backup = self.verify(&expected_snapshot_id)?;
        validate_plan_binding(&backup, plan)?;
        Ok(backup)
    }

    fn populate_partial_snapshot(
        &self,
        source_root: &Path,
        plan: &ChangePlan,
        snapshot_id: &SnapshotId,
        partial_directory: &Path,
    ) -> Result<(), BackupError> {
        let files_directory = partial_directory.join("files");
        fs::create_dir(&files_directory).map_err(BackupError::io)?;
        let mut files = Vec::with_capacity(plan.backup_relative_paths.len());

        for relative_path in &plan.backup_relative_paths {
            let mut source = open_root_regular_file(source_root, relative_path)?;
            let destination = create_backup_destination(&files_directory, relative_path)?;
            let (byte_size, content_hash) = copy_and_hash(&mut source, &destination)?;

            if relative_path == &plan.operation.source.relative_path
                && (byte_size != plan.operation.source.byte_size
                    || content_hash != plan.operation.source.content_hash)
            {
                return Err(BackupError::SourceChanged);
            }
            files.push(BackupFileManifest {
                relative_path: relative_path.as_str().to_owned(),
                byte_size,
                content_hash: content_hash.as_str().to_owned(),
            });
        }
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

        let manifest = BackupManifest {
            schema: MANIFEST_SCHEMA.to_owned(),
            snapshot_id: snapshot_id.as_str().to_owned(),
            plan_id: plan.id.as_str().to_owned(),
            source_fingerprint: plan.device_fingerprint.clone(),
            base_observed_revision: plan.base_observed_revision,
            source_relative_path: plan.operation.source.relative_path.as_str().to_owned(),
            destination_relative_path: plan
                .operation
                .destination_relative_path
                .as_str()
                .to_owned(),
            recovery_binding: recovery_binding_for_plan(plan)?,
            complete: true,
            files,
        };
        write_new_synced(
            &partial_directory.join("manifest.json"),
            &serde_json::to_vec_pretty(&manifest).map_err(BackupError::serialize)?,
        )?;
        let context = format!(
            "# MasterOCTa verified backup\n\n- Schema: `{}`\n- Snapshot: `{}`\n- Plan: `{}`\n- Source fingerprint: `{}`\n- Source: `{}`\n- Destination: `{}`\n- Recovery binding: `{}`\n- Files: {}\n",
            MANIFEST_SCHEMA,
            snapshot_id.as_str(),
            plan.id.as_str(),
            plan.device_fingerprint,
            plan.operation.source.relative_path.as_str(),
            plan.operation.destination_relative_path.as_str(),
            manifest.recovery_binding,
            manifest.files.len()
        );
        write_new_synced(&partial_directory.join("context.md"), context.as_bytes())?;
        verify_manifest_files(partial_directory, &manifest)?;
        Ok(())
    }

    fn verify_directory(&self, directory: &Path) -> Result<VerifiedBackup, BackupError> {
        let metadata = fs::symlink_metadata(directory).map_err(BackupError::io)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(BackupError::UnsafePath);
        }
        let manifest_path = directory.join("manifest.json");
        let manifest_metadata = fs::symlink_metadata(&manifest_path).map_err(BackupError::io)?;
        if manifest_metadata.file_type().is_symlink() || !manifest_metadata.is_file() {
            return Err(BackupError::UnsafePath);
        }
        let manifest: BackupManifest =
            serde_json::from_reader(File::open(&manifest_path).map_err(BackupError::io)?)
                .map_err(BackupError::deserialize)?;
        validate_manifest(&manifest)?;
        let snapshot_id = SnapshotId::parse(manifest.snapshot_id.clone())?;
        if directory.file_name().and_then(|name| name.to_str())
            != Some(snapshot_id.directory_name())
        {
            return Err(BackupError::InvalidManifest("snapshot_directory"));
        }
        verify_manifest_files(directory, &manifest)?;
        Ok(VerifiedBackup {
            snapshot_id,
            directory: directory.to_owned(),
            manifest,
        })
    }
}

fn validate_manifest(manifest: &BackupManifest) -> Result<(), BackupError> {
    if manifest.schema != MANIFEST_SCHEMA {
        return Err(BackupError::InvalidManifest("schema"));
    }
    if !manifest.complete {
        return Err(BackupError::IncompleteSnapshot);
    }
    SnapshotId::parse(manifest.snapshot_id.clone())?;
    PlanId::parse(manifest.plan_id.clone()).map_err(|_| BackupError::InvalidManifest("plan_id"))?;
    validate_prefixed_digest(&manifest.source_fingerprint, "rootfp:v1:")
        .map_err(|_| BackupError::InvalidManifest("source_fingerprint"))?;
    validate_prefixed_digest(&manifest.recovery_binding, RECOVERY_BINDING_PREFIX)
        .map_err(|_| BackupError::InvalidManifest("recovery_binding"))?;
    let expected = recovery_binding_for_manifest(manifest)?;
    if manifest.recovery_binding != expected {
        return Err(BackupError::InvalidManifest("recovery_binding"));
    }
    Ok(())
}

pub fn recovery_binding_for_plan(plan: &ChangePlan) -> Result<String, BackupError> {
    validate_change_plan(plan)?;
    if plan.base_observed_revision == 0
        || plan.operation.source.relative_path == plan.operation.destination_relative_path
    {
        return Err(BackupError::PlanBindingMismatch);
    }
    let mut backup_paths = plan
        .backup_relative_paths
        .iter()
        .map(|path| path.as_str().to_owned())
        .collect::<Vec<_>>();
    backup_paths.sort();
    if backup_paths.windows(2).any(|pair| pair[0] == pair[1])
        || !backup_paths
            .iter()
            .any(|path| path == plan.operation.source.relative_path.as_str())
    {
        return Err(BackupError::PlanBindingMismatch);
    }
    Ok(derive_recovery_binding(
        plan.id.as_str(),
        SnapshotId::for_plan(plan).as_str(),
        &plan.device_fingerprint,
        plan.base_observed_revision,
        plan.operation.source.relative_path.as_str(),
        plan.operation.destination_relative_path.as_str(),
        plan.operation.source.byte_size,
        plan.operation.source.content_hash.as_str(),
        &backup_paths,
    ))
}

fn recovery_binding_for_manifest(manifest: &BackupManifest) -> Result<String, BackupError> {
    if manifest.base_observed_revision == 0 {
        return Err(BackupError::InvalidManifest("base_observed_revision"));
    }
    let plan_digest = manifest
        .plan_id
        .strip_prefix("plan:v1:")
        .ok_or(BackupError::InvalidManifest("plan_id"))?;
    let snapshot_digest = manifest
        .snapshot_id
        .strip_prefix(SNAPSHOT_ID_PREFIX)
        .ok_or(BackupError::InvalidManifest("snapshot_id"))?;
    if plan_digest != snapshot_digest {
        return Err(BackupError::InvalidManifest("plan_snapshot_binding"));
    }
    let source = RootRelativePath::parse(&manifest.source_relative_path)
        .map_err(|_| BackupError::InvalidManifest("source_relative_path"))?;
    let destination = RootRelativePath::parse(&manifest.destination_relative_path)
        .map_err(|_| BackupError::InvalidManifest("destination_relative_path"))?;
    if source == destination {
        return Err(BackupError::InvalidManifest("destination_relative_path"));
    }

    let mut files = BTreeMap::new();
    for file in &manifest.files {
        let relative = RootRelativePath::parse(&file.relative_path)
            .map_err(|_| BackupError::InvalidManifest("relative_path"))?;
        ContentHash::parse(file.content_hash.clone())
            .map_err(|_| BackupError::InvalidManifest("content_hash"))?;
        if files.insert(relative.as_str().to_owned(), file).is_some() {
            return Err(BackupError::InvalidManifest("duplicate_relative_path"));
        }
    }
    let source_file = files
        .get(source.as_str())
        .ok_or(BackupError::InvalidManifest("source_relative_path"))?;
    let backup_paths = files.keys().cloned().collect::<Vec<_>>();
    Ok(derive_recovery_binding(
        &manifest.plan_id,
        &manifest.snapshot_id,
        &manifest.source_fingerprint,
        manifest.base_observed_revision,
        source.as_str(),
        destination.as_str(),
        source_file.byte_size,
        &source_file.content_hash,
        &backup_paths,
    ))
}

#[allow(clippy::too_many_arguments)]
fn derive_recovery_binding(
    plan_id: &str,
    snapshot_id: &str,
    source_fingerprint: &str,
    base_observed_revision: u64,
    source_relative_path: &str,
    destination_relative_path: &str,
    source_byte_size: u64,
    source_content_hash: &str,
    backup_paths: &[String],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"masterocta:recovery-binding:v1");
    encode_recovery_field(&mut hasher, 1, plan_id.as_bytes());
    encode_recovery_field(&mut hasher, 2, snapshot_id.as_bytes());
    encode_recovery_field(&mut hasher, 3, source_fingerprint.as_bytes());
    encode_recovery_field(&mut hasher, 4, &base_observed_revision.to_be_bytes());
    encode_recovery_field(&mut hasher, 5, source_relative_path.as_bytes());
    encode_recovery_field(&mut hasher, 6, destination_relative_path.as_bytes());
    encode_recovery_field(&mut hasher, 7, &source_byte_size.to_be_bytes());
    encode_recovery_field(&mut hasher, 8, source_content_hash.as_bytes());
    encode_recovery_field(&mut hasher, 9, &(backup_paths.len() as u64).to_be_bytes());
    for path in backup_paths {
        encode_recovery_field(&mut hasher, 10, path.as_bytes());
    }
    format!("{RECOVERY_BINDING_PREFIX}{:x}", hasher.finalize())
}

fn encode_recovery_field(hasher: &mut Sha256, tag: u8, bytes: &[u8]) {
    hasher.update([tag]);
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn validate_plan_binding(backup: &VerifiedBackup, plan: &ChangePlan) -> Result<(), BackupError> {
    validate_change_plan(plan)?;
    if backup.snapshot_id != SnapshotId::for_plan(plan)
        || backup.manifest.plan_id != plan.id.as_str()
        || backup.manifest.source_fingerprint != plan.device_fingerprint
        || backup.manifest.base_observed_revision != plan.base_observed_revision
        || backup.manifest.source_relative_path != plan.operation.source.relative_path.as_str()
        || backup.manifest.destination_relative_path
            != plan.operation.destination_relative_path.as_str()
        || backup.manifest.recovery_binding != recovery_binding_for_plan(plan)?
    {
        return Err(BackupError::PlanBindingMismatch);
    }

    let expected_paths = plan
        .backup_relative_paths
        .iter()
        .map(|path| path.as_str())
        .collect::<BTreeSet<_>>();
    if expected_paths.len() != plan.backup_relative_paths.len()
        || !expected_paths.contains(plan.operation.source.relative_path.as_str())
    {
        return Err(BackupError::PlanBindingMismatch);
    }

    let manifest_files = backup
        .manifest
        .files
        .iter()
        .map(|file| (file.relative_path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    if manifest_files.len() != backup.manifest.files.len()
        || manifest_files.keys().copied().collect::<BTreeSet<_>>() != expected_paths
    {
        return Err(BackupError::PlanBindingMismatch);
    }

    let source = manifest_files
        .get(plan.operation.source.relative_path.as_str())
        .ok_or(BackupError::PlanBindingMismatch)?;
    if source.byte_size != plan.operation.source.byte_size
        || source.content_hash != plan.operation.source.content_hash.as_str()
    {
        return Err(BackupError::PlanBindingMismatch);
    }
    Ok(())
}

fn validate_change_plan(plan: &ChangePlan) -> Result<(), BackupError> {
    plan.validate_integrity()
        .map_err(|_| BackupError::PlanBindingMismatch)
}

fn verify_manifest_files(directory: &Path, manifest: &BackupManifest) -> Result<(), BackupError> {
    let files_root = directory.join("files");
    let files_root = canonical_directory(&files_root)?;
    let mut expected = BTreeSet::new();
    for manifest_file in &manifest.files {
        let relative = RootRelativePath::parse(&manifest_file.relative_path)
            .map_err(|_| BackupError::InvalidManifest("relative_path"))?;
        if !expected.insert(relative.as_str().to_owned()) {
            return Err(BackupError::InvalidManifest("duplicate_relative_path"));
        }
        let expected_hash = ContentHash::parse(manifest_file.content_hash.clone())
            .map_err(|_| BackupError::InvalidManifest("content_hash"))?;
        let mut backup_file = open_root_regular_file(&files_root, &relative)?;
        let (byte_size, actual_hash) = hash_reader(&mut backup_file)?;
        if byte_size != manifest_file.byte_size || actual_hash != expected_hash {
            return Err(BackupError::VerificationFailed(relative));
        }
    }
    let actual = collect_regular_files(&files_root)?;
    if actual != expected {
        return Err(BackupError::UnexpectedBackupContents);
    }
    Ok(())
}

fn canonical_directory(path: &Path) -> Result<PathBuf, BackupError> {
    let metadata = fs::symlink_metadata(path).map_err(BackupError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BackupError::UnsafePath);
    }
    path.canonicalize().map_err(BackupError::io)
}

fn prepare_local_directory(path: &Path, source_root: &Path) -> Result<PathBuf, BackupError> {
    reject_local_target_inside_root(path, source_root)?;
    fs::create_dir_all(path).map_err(BackupError::io)?;
    let canonical = canonical_directory(path)?;
    if canonical.starts_with(source_root) {
        return Err(BackupError::BackupInsideSourceRoot);
    }
    Ok(canonical)
}

fn reject_local_target_inside_root(path: &Path, source_root: &Path) -> Result<(), BackupError> {
    if !path.is_absolute() {
        return Err(BackupError::UnsafePath);
    }
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent().ok_or(BackupError::UnsafePath)?;
    }
    let canonical_existing = existing.canonicalize().map_err(BackupError::io)?;
    let suffix = path
        .strip_prefix(existing)
        .map_err(|_| BackupError::UnsafePath)?;
    if canonical_existing.join(suffix).starts_with(source_root) {
        return Err(BackupError::BackupInsideSourceRoot);
    }
    Ok(())
}

fn open_root_regular_file(
    root: &Path,
    relative_path: &RootRelativePath,
) -> Result<File, BackupError> {
    let components = relative_path.as_str().split('/').collect::<Vec<_>>();
    let root = descriptor_fs::open(
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|error| descriptor_path_error(error, relative_path))?;
    let mut parent = File::from(root);
    for component in &components[..components.len() - 1] {
        let child = descriptor_fs::openat(
            &parent,
            *component,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| descriptor_path_error(error, relative_path))?;
        parent = File::from(child);
    }
    let file = descriptor_fs::openat(
        &parent,
        *components.last().expect("relative path is non-empty"),
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|error| descriptor_path_error(error, relative_path))?;
    let file = File::from(file);
    if !file.metadata().map_err(BackupError::io)?.is_file() {
        return Err(BackupError::UnsafePath);
    }
    Ok(file)
}

fn descriptor_path_error(
    error: rustix::io::Errno,
    relative_path: &RootRelativePath,
) -> BackupError {
    if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
        BackupError::SymlinkEncountered(relative_path.clone())
    } else {
        BackupError::io(std::io::Error::from(error))
    }
}

fn create_backup_destination(
    files_root: &Path,
    relative_path: &RootRelativePath,
) -> Result<PathBuf, BackupError> {
    let mut destination = files_root.to_owned();
    let components = relative_path.as_str().split('/').collect::<Vec<_>>();
    for component in &components[..components.len() - 1] {
        destination.push(component);
        match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => return Err(BackupError::UnsafePath),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&destination).map_err(BackupError::io)?;
            }
            Err(error) => return Err(BackupError::io(error)),
        }
    }
    destination.push(components.last().expect("relative path is non-empty"));
    Ok(destination)
}

fn copy_and_hash(source: &mut File, destination: &Path) -> Result<(u64, ContentHash), BackupError> {
    let mut writer = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .map_err(BackupError::io)?;
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source.read(&mut buffer).map_err(BackupError::io)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(BackupError::io)?;
        hasher.update(&buffer[..read]);
        byte_size = byte_size
            .checked_add(read as u64)
            .ok_or(BackupError::FileTooLarge)?;
    }
    writer.sync_all().map_err(BackupError::io)?;
    let hash = ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
        .expect("SHA-256 output is canonical");
    Ok((byte_size, hash))
}

fn hash_reader(reader: &mut impl Read) -> Result<(u64, ContentHash), BackupError> {
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(BackupError::io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        byte_size = byte_size
            .checked_add(read as u64)
            .ok_or(BackupError::FileTooLarge)?;
    }
    let hash = ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
        .expect("SHA-256 output is canonical");
    Ok((byte_size, hash))
}

fn collect_regular_files(root: &Path) -> Result<BTreeSet<String>, BackupError> {
    fn visit(
        root: &Path,
        directory: &Path,
        result: &mut BTreeSet<String>,
    ) -> Result<(), BackupError> {
        let mut entries = fs::read_dir(directory)
            .map_err(BackupError::io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(BackupError::io)?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(BackupError::io)?;
            if metadata.file_type().is_symlink() {
                return Err(BackupError::UnsafePath);
            }
            if metadata.is_dir() {
                visit(root, &path, result)?;
            } else if metadata.is_file() {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| BackupError::PathEscape)?
                    .components()
                    .map(|component| component.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                result.insert(relative);
            } else {
                return Err(BackupError::UnsafePath);
            }
        }
        Ok(())
    }

    let mut result = BTreeSet::new();
    visit(root, root, &mut result)?;
    Ok(result)
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), BackupError> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(BackupError::io)?;
    file.write_all(bytes).map_err(BackupError::io)?;
    file.sync_all().map_err(BackupError::io)
}

fn sync_directory(path: &Path) -> Result<(), BackupError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(BackupError::io)
}

fn validate_prefixed_digest(value: &str, prefix: &str) -> Result<(), ()> {
    let digest = value.strip_prefix(prefix).ok_or(())?;
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(())
    }
}

#[derive(Debug)]
pub enum BackupError {
    Io(String),
    Serialize(String),
    Deserialize(String),
    InvalidManifest(&'static str),
    IncompleteSnapshot,
    SnapshotExists,
    PlanBindingMismatch,
    BackupInsideSourceRoot,
    SourceChanged,
    PathEscape,
    SymlinkEncountered(RootRelativePath),
    UnsafePath,
    FileTooLarge,
    VerificationFailed(RootRelativePath),
    UnexpectedBackupContents,
}

impl BackupError {
    fn io(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }

    fn serialize(error: serde_json::Error) -> Self {
        Self::Serialize(error.to_string())
    }

    fn deserialize(error: serde_json::Error) -> Self {
        Self::Deserialize(error.to_string())
    }
}

impl fmt::Display for BackupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => write!(formatter, "backup I/O failed: {message}"),
            Self::Serialize(message) => {
                write!(formatter, "backup manifest encoding failed: {message}")
            }
            Self::Deserialize(message) => {
                write!(formatter, "backup manifest decoding failed: {message}")
            }
            Self::InvalidManifest(field) => {
                write!(formatter, "backup manifest has invalid {field}")
            }
            Self::IncompleteSnapshot => formatter.write_str("backup snapshot is not complete"),
            Self::SnapshotExists => formatter.write_str("backup snapshot already exists"),
            Self::PlanBindingMismatch => {
                formatter.write_str("backup snapshot does not match its change plan")
            }
            Self::BackupInsideSourceRoot => {
                formatter.write_str("backup storage must be outside the source root")
            }
            Self::SourceChanged => {
                formatter.write_str("source changed before its backup was verified")
            }
            Self::PathEscape => formatter.write_str("backup path escaped its approved root"),
            Self::SymlinkEncountered(path) => write!(
                formatter,
                "backup path contains a symlink: {}",
                path.as_str()
            ),
            Self::UnsafePath => {
                formatter.write_str("backup encountered a non-regular or unsafe path")
            }
            Self::FileTooLarge => formatter.write_str("backup file size overflowed"),
            Self::VerificationFailed(path) => write!(
                formatter,
                "backup verification failed for {}",
                path.as_str()
            ),
            Self::UnexpectedBackupContents => {
                formatter.write_str("backup contains unmanifested files")
            }
        }
    }
}

impl std::error::Error for BackupError {}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_plan::{
        plan_additive_copy, AdditiveCopyIntent, AdditiveCopyPlanningFacts, PlanSeed,
        RootPlanObservation, SourceFileObservation,
    };
    use tempfile::TempDir;

    fn plan_for(bytes: &[u8]) -> ChangePlan {
        let root_id = ot_domain::RootId::new("root-1").unwrap();
        let source = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let hash = ContentHash::parse(format!("sha256:{:x}", hasher.finalize())).unwrap();
        plan_additive_copy(
            &AdditiveCopyIntent {
                root_id: root_id.clone(),
                source_relative_path: source.clone(),
                destination_relative_path: RootRelativePath::parse("SET/PROJECT/kick.wav").unwrap(),
            },
            &AdditiveCopyPlanningFacts {
                plan_seed: PlanSeed::new([7; 32]),
                root: RootPlanObservation {
                    root_id,
                    device_fingerprint: format!("rootfp:v1:{}", "a".repeat(64)),
                    observed_revision: 1,
                    identity_is_stable: true,
                },
                source: SourceFileObservation {
                    relative_path: source,
                    byte_size: bytes.len() as u64,
                    content_hash: hash,
                },
                destination_exists: false,
            },
        )
        .unwrap()
    }

    #[test]
    fn creates_and_reverifies_an_immutable_relative_only_snapshot() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let backups = fixture.path().join("local-backups");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        let bytes = b"synthetic audio fixture";
        fs::write(root.join("SET/AUDIO/kick.wav"), bytes).unwrap();
        let plan = plan_for(bytes);
        let store = BackupStore::new(&backups);

        let backup = store.create_verified(&root, &plan).unwrap();
        let verified = store.verify(backup.snapshot_id()).unwrap();

        assert_eq!(verified.manifest().files.len(), 1);
        assert_eq!(
            verified.manifest().destination_relative_path,
            plan.operation.destination_relative_path.as_str()
        );
        assert_eq!(
            verified.manifest().recovery_binding,
            recovery_binding_for_plan(&plan).unwrap()
        );
        assert_eq!(
            fs::read(verified.directory().join("files/SET/AUDIO/kick.wav")).unwrap(),
            bytes
        );
        let manifest_text = fs::read_to_string(verified.directory().join("manifest.json")).unwrap();
        let context_text = fs::read_to_string(verified.directory().join("context.md")).unwrap();
        let absolute = root.to_string_lossy();
        assert!(!manifest_text.contains(absolute.as_ref()));
        assert!(!context_text.contains(absolute.as_ref()));
        assert_eq!(fs::read(root.join("SET/AUDIO/kick.wav")).unwrap(), bytes);
    }

    #[test]
    fn rejects_changed_sources_and_backup_storage_inside_the_root() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::write(root.join("SET/AUDIO/kick.wav"), b"changed").unwrap();
        let plan = plan_for(b"original");

        let outside = BackupStore::new(fixture.path().join("local-backups"));
        assert!(matches!(
            outside.create_verified(&root, &plan),
            Err(BackupError::SourceChanged)
        ));
        assert!(matches!(
            BackupStore::new(root.join("backups")).create_verified(&root, &plan),
            Err(BackupError::BackupInsideSourceRoot)
        ));
        assert!(!root.join("backups").exists());
    }

    #[test]
    fn tampering_prevents_snapshot_verification() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let backups = fixture.path().join("local-backups");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::write(root.join("SET/AUDIO/kick.wav"), b"fixture").unwrap();
        let store = BackupStore::new(&backups);
        let backup = store.create_verified(&root, &plan_for(b"fixture")).unwrap();
        fs::write(
            backup.directory().join("files/SET/AUDIO/kick.wav"),
            b"tampered",
        )
        .unwrap();

        assert!(matches!(
            store.verify(backup.snapshot_id()),
            Err(BackupError::VerificationFailed(_))
        ));
    }

    #[test]
    fn tampering_with_the_recovery_destination_invalidates_the_snapshot() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let backups = fixture.path().join("local-backups");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::write(root.join("SET/AUDIO/kick.wav"), b"fixture").unwrap();
        let store = BackupStore::new(&backups);
        let backup = store.create_verified(&root, &plan_for(b"fixture")).unwrap();
        let manifest_path = backup.directory().join("manifest.json");
        let mut manifest: BackupManifest =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest.destination_relative_path = "SET/PROJECT/victim.wav".into();
        fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();

        assert!(matches!(
            store.verify(backup.snapshot_id()),
            Err(BackupError::InvalidManifest("recovery_binding"))
        ));
    }

    #[test]
    fn existing_snapshot_must_be_bound_to_the_exact_plan() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let backups = fixture.path().join("local-backups");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::write(root.join("SET/AUDIO/kick.wav"), b"fixture").unwrap();
        let plan = plan_for(b"fixture");
        let snapshot_id = SnapshotId::for_plan(&plan);
        let snapshot_directory = backups.join(snapshot_id.directory_name());
        fs::create_dir_all(snapshot_directory.join("files")).unwrap();
        let unrelated = BackupManifest {
            schema: MANIFEST_SCHEMA.to_owned(),
            snapshot_id: snapshot_id.as_str().to_owned(),
            plan_id: format!("plan:v1:{}", "b".repeat(64)),
            source_fingerprint: format!("rootfp:v1:{}", "c".repeat(64)),
            base_observed_revision: plan.base_observed_revision,
            source_relative_path: plan.operation.source.relative_path.as_str().into(),
            destination_relative_path: plan.operation.destination_relative_path.as_str().into(),
            recovery_binding: recovery_binding_for_plan(&plan).unwrap(),
            complete: true,
            files: vec![],
        };
        fs::write(
            snapshot_directory.join("manifest.json"),
            serde_json::to_vec_pretty(&unrelated).unwrap(),
        )
        .unwrap();

        assert!(matches!(
            BackupStore::new(&backups).verify_for_plan(&plan),
            Err(BackupError::InvalidManifest("plan_snapshot_binding"))
        ));
    }

    #[test]
    fn changed_plan_contents_cannot_reuse_a_verified_snapshot() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let backups = fixture.path().join("local-backups");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::write(root.join("SET/AUDIO/kick.wav"), b"fixture").unwrap();
        let mut plan = plan_for(b"fixture");
        let store = BackupStore::new(&backups);
        store.create_verified(&root, &plan).unwrap();

        plan.operation.destination_relative_path =
            RootRelativePath::parse("SET/PROJECT/replaced.wav").unwrap();
        assert!(matches!(
            store.verify_for_plan(&plan),
            Err(BackupError::PlanBindingMismatch)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_source_components_without_reading_the_target() {
        use std::os::unix::fs::symlink;

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let outside = fixture.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("kick.wav"), b"private").unwrap();
        symlink(&outside, root.join("SET")).unwrap();

        let error = BackupStore::new(fixture.path().join("local-backups"))
            .create_verified(&root, &plan_for(b"private"))
            .unwrap_err();

        assert!(matches!(error, BackupError::SymlinkEncountered(_)));
        assert_eq!(fs::read(outside.join("kick.wav")).unwrap(), b"private");
    }
}
