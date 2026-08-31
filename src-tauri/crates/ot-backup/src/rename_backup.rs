#![forbid(unsafe_code)]

use crate::{
    canonical_directory, collect_regular_files, copy_and_hash, create_backup_destination,
    hash_reader, open_root_regular_file, prepare_local_directory, sync_directory,
    validate_prefixed_digest, write_new_synced, BackupError, BackupStore, SnapshotId,
    SNAPSHOT_ID_PREFIX,
};
use ot_domain::{ContentHash, RootRelativePath, StateDocumentKind, StateDocumentRole};
use ot_plan::{PlanId, RenameImpactPlan, RenameSidecarImpact, RenameStateDocumentImpact};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

const RENAME_MANIFEST_SCHEMA: &str = "masterocta-rename-backup:v1";
const RENAME_RECOVERY_BINDING_PREFIX: &str = "recovery-binding:rename:v1:";
const RENAME_RECOVERY_CANONICAL_PREFIX: &[u8] = b"masterocta:rename-recovery-binding:v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenameBackupOperationKind {
    RenameSample,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenameBackupFileRole {
    SourceAudio,
    ProjectWorking,
    ProjectSavedCheckpoint,
    SampleSidecar,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameBackupFileManifest {
    pub relative_path: String,
    pub role: RenameBackupFileRole,
    pub byte_size: u64,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_sidecar_relative_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RenameBackupManifest {
    pub schema: String,
    pub operation_kind: RenameBackupOperationKind,
    pub snapshot_id: String,
    pub plan_id: String,
    pub root_fingerprint: String,
    pub base_observed_revision: u64,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub reference_update_count: u64,
    pub recovery_binding: String,
    pub complete: bool,
    pub files: Vec<RenameBackupFileManifest>,
}

#[derive(Clone, Debug)]
pub struct VerifiedRenameBackup {
    snapshot_id: SnapshotId,
    directory: PathBuf,
    manifest: RenameBackupManifest,
}

impl VerifiedRenameBackup {
    pub fn snapshot_id(&self) -> &SnapshotId {
        &self.snapshot_id
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn manifest(&self) -> &RenameBackupManifest {
        &self.manifest
    }
}

pub fn create_verified_for_rename(
    store: &BackupStore,
    source_root: &Path,
    plan: &RenameImpactPlan,
) -> Result<VerifiedRenameBackup, BackupError> {
    validate_rename_plan(plan)?;
    let expected = rename_backup_targets(plan)?;
    let source_root = canonical_directory(source_root)?;
    let base_directory = prepare_local_directory(store.base_directory(), &source_root)?;
    let snapshot_id = SnapshotId::for_rename_plan(plan);
    let final_directory = base_directory.join(snapshot_id.directory_name());
    let partial_directory =
        base_directory.join(format!("{}.partial", snapshot_id.directory_name()));
    if final_directory.exists() || partial_directory.exists() {
        return Err(BackupError::SnapshotExists);
    }

    fs::create_dir(&partial_directory).map_err(BackupError::io)?;
    if let Err(error) = populate_rename_partial(
        &source_root,
        plan,
        &expected,
        &snapshot_id,
        &partial_directory,
    ) {
        let _ = fs::remove_dir_all(&partial_directory);
        return Err(error);
    }

    sync_directory(&partial_directory.join("files"))?;
    sync_directory(&partial_directory)?;
    fs::rename(&partial_directory, &final_directory).map_err(BackupError::io)?;
    sync_directory(&base_directory)?;
    let backup = verify_rename_directory(&final_directory)?;
    validate_rename_plan_binding(&backup, plan)?;
    Ok(backup)
}

pub fn verify_for_rename_plan(
    store: &BackupStore,
    plan: &RenameImpactPlan,
) -> Result<VerifiedRenameBackup, BackupError> {
    validate_rename_plan(plan)?;
    let expected_snapshot_id = SnapshotId::for_rename_plan(plan);
    let base_directory = canonical_directory(store.base_directory())?;
    let directory = base_directory.join(expected_snapshot_id.directory_name());
    let backup = verify_rename_directory(&directory)?;
    validate_rename_plan_binding(&backup, plan)?;
    Ok(backup)
}

pub fn recovery_binding_for_rename_plan(plan: &RenameImpactPlan) -> Result<String, BackupError> {
    let expected = rename_backup_targets(plan)?;
    derive_rename_recovery_binding(plan, &SnapshotId::for_rename_plan(plan), &expected)
}

fn populate_rename_partial(
    source_root: &Path,
    plan: &RenameImpactPlan,
    expected: &RenameBackupTargets,
    snapshot_id: &SnapshotId,
    partial_directory: &Path,
) -> Result<(), BackupError> {
    let files_directory = partial_directory.join("files");
    fs::create_dir(&files_directory).map_err(BackupError::io)?;
    let mut files = Vec::with_capacity(expected.paths.len());

    for target in &expected.files {
        let mut source = open_root_regular_file(source_root, &target.relative_path)?;
        let destination = create_backup_destination(&files_directory, &target.relative_path)?;
        let (byte_size, content_hash) = copy_and_hash(&mut source, &destination)?;
        if byte_size != target.byte_size || content_hash != target.content_hash {
            return Err(BackupError::SourceChanged);
        }
        files.push(target.to_manifest());
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    let manifest = RenameBackupManifest {
        schema: RENAME_MANIFEST_SCHEMA.to_owned(),
        operation_kind: RenameBackupOperationKind::RenameSample,
        snapshot_id: snapshot_id.as_str().to_owned(),
        plan_id: plan.id.as_str().to_owned(),
        root_fingerprint: plan.device_fingerprint.clone(),
        base_observed_revision: plan.base_observed_revision,
        source_relative_path: plan.source_relative_path.as_str().to_owned(),
        destination_relative_path: plan.destination_relative_path.as_str().to_owned(),
        reference_update_count: plan.reference_update_count,
        recovery_binding: derive_rename_recovery_binding(plan, snapshot_id, expected)?,
        complete: true,
        files,
    };
    write_new_synced(
        &partial_directory.join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(BackupError::serialize)?,
    )?;
    let context = format!(
        "# MasterOCTa rename verified backup\n\n- Schema: `{}`\n- Operation: `rename_sample`\n- Snapshot: `{}`\n- Plan: `{}`\n- Root fingerprint: `{}`\n- Source: `{}`\n- Destination: `{}`\n- Reference updates: {}\n- Recovery binding: `{}`\n- Files: {}\n",
        RENAME_MANIFEST_SCHEMA,
        snapshot_id.as_str(),
        plan.id.as_str(),
        plan.device_fingerprint,
        plan.source_relative_path.as_str(),
        plan.destination_relative_path.as_str(),
        plan.reference_update_count,
        manifest.recovery_binding,
        manifest.files.len()
    );
    write_new_synced(&partial_directory.join("context.md"), context.as_bytes())?;
    verify_rename_manifest_files(partial_directory, &manifest)?;
    Ok(())
}

fn verify_rename_directory(directory: &Path) -> Result<VerifiedRenameBackup, BackupError> {
    let metadata = fs::symlink_metadata(directory).map_err(BackupError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BackupError::UnsafePath);
    }
    let manifest_path = directory.join("manifest.json");
    let manifest_metadata = fs::symlink_metadata(&manifest_path).map_err(BackupError::io)?;
    if manifest_metadata.file_type().is_symlink() || !manifest_metadata.is_file() {
        return Err(BackupError::UnsafePath);
    }
    let manifest: RenameBackupManifest =
        serde_json::from_reader(File::open(&manifest_path).map_err(BackupError::io)?)
            .map_err(BackupError::deserialize)?;
    validate_rename_manifest(&manifest)?;
    let snapshot_id = SnapshotId::parse(manifest.snapshot_id.clone())?;
    if directory.file_name().and_then(|name| name.to_str()) != Some(snapshot_id.directory_name()) {
        return Err(BackupError::InvalidManifest("snapshot_directory"));
    }
    verify_rename_manifest_files(directory, &manifest)?;
    Ok(VerifiedRenameBackup {
        snapshot_id,
        directory: directory.to_owned(),
        manifest,
    })
}

fn validate_rename_manifest(manifest: &RenameBackupManifest) -> Result<(), BackupError> {
    if manifest.schema != RENAME_MANIFEST_SCHEMA {
        return Err(BackupError::InvalidManifest("schema"));
    }
    if manifest.operation_kind != RenameBackupOperationKind::RenameSample {
        return Err(BackupError::InvalidManifest("operation_kind"));
    }
    if !manifest.complete {
        return Err(BackupError::IncompleteSnapshot);
    }
    SnapshotId::parse(manifest.snapshot_id.clone())?;
    PlanId::parse(manifest.plan_id.clone()).map_err(|_| BackupError::InvalidManifest("plan_id"))?;
    validate_prefixed_digest(&manifest.root_fingerprint, "rootfp:v1:")
        .map_err(|_| BackupError::InvalidManifest("root_fingerprint"))?;
    validate_prefixed_digest(&manifest.recovery_binding, RENAME_RECOVERY_BINDING_PREFIX)
        .map_err(|_| BackupError::InvalidManifest("recovery_binding"))?;
    let expected = recovery_binding_for_rename_manifest(manifest)?;
    if manifest.recovery_binding != expected {
        return Err(BackupError::InvalidManifest("recovery_binding"));
    }
    Ok(())
}

fn validate_rename_plan(plan: &RenameImpactPlan) -> Result<(), BackupError> {
    plan.validate_integrity()
        .map_err(|_| BackupError::PlanBindingMismatch)?;
    if plan.base_observed_revision == 0
        || plan.source_relative_path == plan.destination_relative_path
    {
        return Err(BackupError::PlanBindingMismatch);
    }
    Ok(())
}

fn validate_rename_plan_binding(
    backup: &VerifiedRenameBackup,
    plan: &RenameImpactPlan,
) -> Result<(), BackupError> {
    validate_rename_plan(plan)?;
    let expected = rename_backup_targets(plan)?;
    if backup.snapshot_id != SnapshotId::for_rename_plan(plan)
        || backup.manifest.schema != RENAME_MANIFEST_SCHEMA
        || backup.manifest.operation_kind != RenameBackupOperationKind::RenameSample
        || backup.manifest.plan_id != plan.id.as_str()
        || backup.manifest.root_fingerprint != plan.device_fingerprint
        || backup.manifest.base_observed_revision != plan.base_observed_revision
        || backup.manifest.source_relative_path != plan.source_relative_path.as_str()
        || backup.manifest.destination_relative_path != plan.destination_relative_path.as_str()
        || backup.manifest.reference_update_count != plan.reference_update_count
        || backup.manifest.recovery_binding
            != derive_rename_recovery_binding(plan, &backup.snapshot_id, &expected)?
    {
        return Err(BackupError::PlanBindingMismatch);
    }

    let manifest_paths = backup
        .manifest
        .files
        .iter()
        .map(|file| file.relative_path.clone())
        .collect::<BTreeSet<_>>();
    if manifest_paths != expected.paths
        || backup.manifest.files.len() != expected.files.len()
        || manifest_paths.len() != backup.manifest.files.len()
    {
        return Err(BackupError::PlanBindingMismatch);
    }

    for target in &expected.files {
        let observed = backup
            .manifest
            .files
            .iter()
            .find(|file| file.relative_path == target.relative_path.as_str())
            .ok_or(BackupError::PlanBindingMismatch)?;
        if observed.role != target.role
            || observed.byte_size != target.byte_size
            || observed.content_hash != target.content_hash.as_str()
            || observed.state_kind.as_deref() != target.state_kind
            || observed.state_role.as_deref() != target.state_role
            || observed.destination_sidecar_relative_path.as_deref()
                != target.destination_sidecar_relative_path.as_deref()
        {
            return Err(BackupError::PlanBindingMismatch);
        }
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct RenameBackupTargets {
    paths: BTreeSet<String>,
    files: Vec<RenameBackupTarget>,
}

#[derive(Clone, Debug)]
struct RenameBackupTarget {
    relative_path: RootRelativePath,
    role: RenameBackupFileRole,
    byte_size: u64,
    content_hash: ContentHash,
    state_kind: Option<&'static str>,
    state_role: Option<&'static str>,
    destination_sidecar_relative_path: Option<String>,
}

impl RenameBackupTarget {
    fn to_manifest(&self) -> RenameBackupFileManifest {
        RenameBackupFileManifest {
            relative_path: self.relative_path.as_str().to_owned(),
            role: self.role,
            byte_size: self.byte_size,
            content_hash: self.content_hash.as_str().to_owned(),
            state_kind: self.state_kind.map(str::to_owned),
            state_role: self.state_role.map(str::to_owned),
            destination_sidecar_relative_path: self.destination_sidecar_relative_path.clone(),
        }
    }
}

fn rename_backup_targets(plan: &RenameImpactPlan) -> Result<RenameBackupTargets, BackupError> {
    let mut files = Vec::new();
    files.push(RenameBackupTarget {
        relative_path: plan.source_relative_path.clone(),
        role: RenameBackupFileRole::SourceAudio,
        byte_size: plan.source_byte_size,
        content_hash: plan.source_content_hash.clone(),
        state_kind: None,
        state_role: None,
        destination_sidecar_relative_path: None,
    });
    for document in &plan.state_document_impacts {
        files.push(document_target(document)?);
    }
    for sidecar in &plan.sidecar_impacts {
        files.push(sidecar_target(sidecar)?);
    }

    let mut paths = BTreeSet::new();
    for file in &files {
        if !paths.insert(file.relative_path.as_str().to_owned()) {
            return Err(BackupError::PlanBindingMismatch);
        }
    }
    reject_incomparable_paths(&paths)?;

    let listed = plan
        .backup_relative_paths
        .iter()
        .map(|path| path.as_str().to_owned())
        .collect::<Vec<_>>();
    if listed.len() != paths.len() || listed.iter().any(|path| !paths.contains(path)) {
        return Err(BackupError::PlanBindingMismatch);
    }
    if listed.iter().any(|path| {
        path == plan.destination_relative_path.as_str()
            || plan
                .sidecar_impacts
                .iter()
                .any(|sidecar| sidecar.destination_sidecar_relative_path.as_str() == path)
    }) {
        return Err(BackupError::PlanBindingMismatch);
    }
    if paths.contains(plan.destination_relative_path.as_str()) {
        return Err(BackupError::PlanBindingMismatch);
    }
    for sidecar in &plan.sidecar_impacts {
        if paths.contains(sidecar.destination_sidecar_relative_path.as_str()) {
            return Err(BackupError::PlanBindingMismatch);
        }
    }

    files.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });
    Ok(RenameBackupTargets { paths, files })
}

fn document_target(
    document: &RenameStateDocumentImpact,
) -> Result<RenameBackupTarget, BackupError> {
    if document.kind != StateDocumentKind::Project {
        return Err(BackupError::PlanBindingMismatch);
    }
    let (role, state_role) = match document.role {
        StateDocumentRole::Working => (RenameBackupFileRole::ProjectWorking, "working"),
        StateDocumentRole::SavedCheckpoint => (
            RenameBackupFileRole::ProjectSavedCheckpoint,
            "saved_checkpoint",
        ),
    };
    Ok(RenameBackupTarget {
        relative_path: document.relative_path.clone(),
        role,
        byte_size: document.byte_size,
        content_hash: document.content_hash.clone(),
        state_kind: Some("project"),
        state_role: Some(state_role),
        destination_sidecar_relative_path: None,
    })
}

fn sidecar_target(sidecar: &RenameSidecarImpact) -> Result<RenameBackupTarget, BackupError> {
    Ok(RenameBackupTarget {
        relative_path: sidecar.source_sidecar_relative_path.clone(),
        role: RenameBackupFileRole::SampleSidecar,
        byte_size: sidecar.byte_size,
        content_hash: sidecar.content_hash.clone(),
        state_kind: None,
        state_role: None,
        destination_sidecar_relative_path: Some(
            sidecar
                .destination_sidecar_relative_path
                .as_str()
                .to_owned(),
        ),
    })
}

fn reject_incomparable_paths(paths: &BTreeSet<String>) -> Result<(), BackupError> {
    let listed = paths.iter().collect::<Vec<_>>();
    for (index, left) in listed.iter().enumerate() {
        for right in &listed[index + 1..] {
            if left.eq_ignore_ascii_case(right) {
                return Err(BackupError::UnsafePath);
            }
        }
    }
    Ok(())
}

fn derive_rename_recovery_binding(
    plan: &RenameImpactPlan,
    snapshot_id: &SnapshotId,
    expected: &RenameBackupTargets,
) -> Result<String, BackupError> {
    let mut hasher = Sha256::new();
    hasher.update(RENAME_RECOVERY_CANONICAL_PREFIX);
    encode_field(&mut hasher, 1, RENAME_MANIFEST_SCHEMA.as_bytes());
    encode_field(&mut hasher, 2, b"rename_sample");
    encode_field(&mut hasher, 3, plan.id.as_str().as_bytes());
    encode_field(&mut hasher, 4, snapshot_id.as_str().as_bytes());
    encode_field(&mut hasher, 5, plan.device_fingerprint.as_bytes());
    encode_field(&mut hasher, 6, &plan.base_observed_revision.to_be_bytes());
    encode_field(
        &mut hasher,
        7,
        plan.source_relative_path.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 8, &plan.source_byte_size.to_be_bytes());
    encode_field(&mut hasher, 9, plan.source_content_hash.as_str().as_bytes());
    encode_field(
        &mut hasher,
        10,
        plan.destination_relative_path.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 11, &plan.reference_update_count.to_be_bytes());
    encode_field(
        &mut hasher,
        12,
        &(expected.files.len() as u64).to_be_bytes(),
    );
    for file in &expected.files {
        encode_field(&mut hasher, 13, file.relative_path.as_str().as_bytes());
        encode_field(&mut hasher, 14, role_token(file.role).as_bytes());
        encode_field(&mut hasher, 15, &file.byte_size.to_be_bytes());
        encode_field(&mut hasher, 16, file.content_hash.as_str().as_bytes());
        encode_field(
            &mut hasher,
            17,
            file.state_kind.unwrap_or_default().as_bytes(),
        );
        encode_field(
            &mut hasher,
            18,
            file.state_role.unwrap_or_default().as_bytes(),
        );
        encode_field(
            &mut hasher,
            19,
            file.destination_sidecar_relative_path
                .as_deref()
                .unwrap_or_default()
                .as_bytes(),
        );
    }
    Ok(format!(
        "{RENAME_RECOVERY_BINDING_PREFIX}{:x}",
        hasher.finalize()
    ))
}

fn recovery_binding_for_rename_manifest(
    manifest: &RenameBackupManifest,
) -> Result<String, BackupError> {
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
    if !files.contains_key(source.as_str()) {
        return Err(BackupError::InvalidManifest("source_relative_path"));
    }
    reject_incomparable_paths(&files.keys().cloned().collect())?;

    let mut hasher = Sha256::new();
    hasher.update(RENAME_RECOVERY_CANONICAL_PREFIX);
    encode_field(&mut hasher, 1, manifest.schema.as_bytes());
    encode_field(&mut hasher, 2, b"rename_sample");
    encode_field(&mut hasher, 3, manifest.plan_id.as_bytes());
    encode_field(&mut hasher, 4, manifest.snapshot_id.as_bytes());
    encode_field(&mut hasher, 5, manifest.root_fingerprint.as_bytes());
    encode_field(
        &mut hasher,
        6,
        &manifest.base_observed_revision.to_be_bytes(),
    );
    encode_field(&mut hasher, 7, source.as_str().as_bytes());
    let source_file = files
        .get(source.as_str())
        .ok_or(BackupError::InvalidManifest("source_relative_path"))?;
    encode_field(&mut hasher, 8, &source_file.byte_size.to_be_bytes());
    encode_field(&mut hasher, 9, source_file.content_hash.as_bytes());
    encode_field(&mut hasher, 10, destination.as_str().as_bytes());
    encode_field(
        &mut hasher,
        11,
        &manifest.reference_update_count.to_be_bytes(),
    );
    encode_field(
        &mut hasher,
        12,
        &(manifest.files.len() as u64).to_be_bytes(),
    );
    let mut ordered = manifest.files.clone();
    ordered.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    for file in &ordered {
        encode_field(&mut hasher, 13, file.relative_path.as_bytes());
        encode_field(&mut hasher, 14, role_token(file.role).as_bytes());
        encode_field(&mut hasher, 15, &file.byte_size.to_be_bytes());
        encode_field(&mut hasher, 16, file.content_hash.as_bytes());
        encode_field(
            &mut hasher,
            17,
            file.state_kind.as_deref().unwrap_or_default().as_bytes(),
        );
        encode_field(
            &mut hasher,
            18,
            file.state_role.as_deref().unwrap_or_default().as_bytes(),
        );
        encode_field(
            &mut hasher,
            19,
            file.destination_sidecar_relative_path
                .as_deref()
                .unwrap_or_default()
                .as_bytes(),
        );
    }
    Ok(format!(
        "{RENAME_RECOVERY_BINDING_PREFIX}{:x}",
        hasher.finalize()
    ))
}

fn verify_rename_manifest_files(
    directory: &Path,
    manifest: &RenameBackupManifest,
) -> Result<(), BackupError> {
    let files_root = canonical_directory(&directory.join("files"))?;
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

fn role_token(role: RenameBackupFileRole) -> &'static str {
    match role {
        RenameBackupFileRole::SourceAudio => "source_audio",
        RenameBackupFileRole::ProjectWorking => "project_working",
        RenameBackupFileRole::ProjectSavedCheckpoint => "project_saved_checkpoint",
        RenameBackupFileRole::SampleSidecar => "sample_sidecar",
    }
}

fn encode_field(hasher: &mut Sha256, tag: u8, bytes: &[u8]) {
    hasher.update([tag]);
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::{
        ContentHashFreshness, ParserProvenance, ProjectCompatibilityEvidence, RenameSampleIntent,
        RootId, SampleReferenceStatus, SampleSettingsParseStatus, SampleSlotId, SampleSlotKind,
        StateDocumentParseStatus,
    };
    use ot_plan::{
        derive_file_instance_id, plan_rename_sample, sidecar_destination_for_audio_destination,
        RenameDestinationObservation, RenameDestinationState, RenamePlanningOutcome,
        RenameRootObservation, RenameSamplePlanningFacts, RenameSidecarObservation,
        RenameSlotAssignmentObservation, RenameSourceObservation, RenameStateDocumentObservation,
    };
    use sha2::{Digest, Sha256};
    use std::fs;
    use tempfile::TempDir;

    const SOURCE_PATH: &str = "SET/AUDIO/kick.wav";
    const DESTINATION_PATH: &str = "SET/AUDIO/new-kick.wav";
    const WORK_PATH: &str = "SET/PROJECT/project.work";
    const STRD_PATH: &str = "SET/PROJECT/project.strd";
    const SIDECAR_PATH: &str = "SET/AUDIO/kick.ot";
    const AUDIO_BYTES: &[u8] = b"rename-audio";
    const WORK_BYTES: &[u8] = b"working-project";
    const STRD_BYTES: &[u8] = b"saved-project";
    const SIDECAR_BYTES: &[u8] = b"sidecar-bytes";

    fn hash_bytes(bytes: &[u8]) -> ContentHash {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        ContentHash::parse(format!("sha256:{:x}", hasher.finalize())).unwrap()
    }

    fn fingerprint() -> String {
        format!("rootfp:v1:{}", "a".repeat(64))
    }

    fn snapshot_root(root: &Path) -> Vec<(PathBuf, u64, String)> {
        let mut entries = Vec::new();
        for entry in fs::read_dir(root).unwrap() {
            collect_snapshot(root, &entry.unwrap().path(), &mut entries);
        }
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

    fn unused_facts() -> RenameSamplePlanningFacts {
        facts(Vec::new(), Vec::new(), false)
    }

    fn facts(
        assignments: Vec<RenameSlotAssignmentObservation>,
        extra_documents: Vec<RenameStateDocumentObservation>,
        include_sidecar: bool,
    ) -> RenameSamplePlanningFacts {
        let source = RootRelativePath::parse(SOURCE_PATH).unwrap();
        let mut state_documents = vec![
            parsed_project(WORK_PATH, StateDocumentRole::Working, WORK_BYTES),
            parsed_project(STRD_PATH, StateDocumentRole::SavedCheckpoint, STRD_BYTES),
        ];
        state_documents.extend(extra_documents);
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
            state_documents,
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

    fn assignment(document: &str, number: u16) -> RenameSlotAssignmentObservation {
        RenameSlotAssignmentObservation {
            project_document_relative_path: RootRelativePath::parse(document).unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, number).unwrap(),
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
        if work {
            fs::write(root.join(WORK_PATH), WORK_BYTES).unwrap();
        }
        if strd {
            fs::write(root.join(STRD_PATH), STRD_BYTES).unwrap();
        }
    }

    fn backup_roles(backup: &VerifiedRenameBackup) -> Vec<(String, RenameBackupFileRole)> {
        backup
            .manifest()
            .files
            .iter()
            .map(|file| (file.relative_path.clone(), file.role))
            .collect()
    }

    #[test]
    fn unused_sample_backup_is_source_only_and_leaves_root_unchanged() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let before = snapshot_root(&root);
        let plan = plan_from(unused_facts());
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();
        let verified = store.verify_for_rename_plan(&plan).unwrap();

        assert_eq!(backup.snapshot_id(), verified.snapshot_id());
        assert_eq!(SnapshotId::for_rename_plan(&plan), *backup.snapshot_id());
        assert_eq!(
            backup_roles(&backup),
            vec![(SOURCE_PATH.to_owned(), RenameBackupFileRole::SourceAudio)]
        );
        assert_eq!(
            backup.manifest().recovery_binding,
            recovery_binding_for_rename_plan(&plan).unwrap()
        );
        assert_eq!(snapshot_root(&root), before);
        let manifest = fs::read_to_string(backup.directory().join("manifest.json")).unwrap();
        assert!(!manifest.contains(root.to_string_lossy().as_ref()));
        assert!(!manifest.contains("root-session-1"));
    }

    #[test]
    fn changed_source_bytes_fail_closed_and_leave_root_unchanged() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let plan = plan_from(unused_facts());
        fs::write(root.join(SOURCE_PATH), b"mutated-after-plan").unwrap();
        let before = snapshot_root(&root);
        let backups = fixture.path().join("local-backups");
        let store = BackupStore::new(&backups);
        assert!(matches!(
            store.create_verified_for_rename(&root, &plan),
            Err(BackupError::SourceChanged)
        ));
        assert_eq!(snapshot_root(&root), before);
        if backups.exists() {
            assert_eq!(fs::read_dir(&backups).unwrap().count(), 0);
        }
    }

    #[test]
    fn working_and_saved_documents_and_sidecar_are_backed_up() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, true);
        let plan = plan_from(facts(
            vec![assignment(WORK_PATH, 1), assignment(STRD_PATH, 2)],
            Vec::new(),
            true,
        ));
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();
        assert_eq!(
            backup_roles(&backup),
            vec![
                (SIDECAR_PATH.to_owned(), RenameBackupFileRole::SampleSidecar),
                (SOURCE_PATH.to_owned(), RenameBackupFileRole::SourceAudio),
                (
                    STRD_PATH.to_owned(),
                    RenameBackupFileRole::ProjectSavedCheckpoint
                ),
                (WORK_PATH.to_owned(), RenameBackupFileRole::ProjectWorking),
            ]
        );
        let sidecar = backup
            .manifest()
            .files
            .iter()
            .find(|file| file.role == RenameBackupFileRole::SampleSidecar)
            .unwrap();
        assert_eq!(
            sidecar.destination_sidecar_relative_path.as_deref(),
            Some("SET/AUDIO/new-kick.ot")
        );
        assert!(!backup
            .manifest()
            .files
            .iter()
            .any(|file| file.relative_path == DESTINATION_PATH));
    }

    #[test]
    fn working_only_and_saved_only_backups_are_independent() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, true, true);
        let store = BackupStore::new(fixture.path().join("local-backups"));

        let working = plan_from(facts(vec![assignment(WORK_PATH, 1)], Vec::new(), false));
        let working_backup = store.create_verified_for_rename(&root, &working).unwrap();
        assert_eq!(
            working_backup
                .manifest()
                .files
                .iter()
                .filter(|file| file.role != RenameBackupFileRole::SourceAudio)
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec![WORK_PATH]
        );

        let saved = plan_from(facts(vec![assignment(STRD_PATH, 1)], Vec::new(), false));
        let saved_backup = store.create_verified_for_rename(&root, &saved).unwrap();
        assert_eq!(
            saved_backup
                .manifest()
                .files
                .iter()
                .filter(|file| file.role != RenameBackupFileRole::SourceAudio)
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec![STRD_PATH]
        );
        assert_ne!(working_backup.snapshot_id(), saved_backup.snapshot_id());
    }

    #[test]
    fn snapshot_id_is_deterministic_and_v2_verify_rejects_rename_schema() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let plan = plan_from(unused_facts());
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let first = store.create_verified_for_rename(&root, &plan).unwrap();
        assert_eq!(
            SnapshotId::for_rename_plan(&plan),
            SnapshotId::for_rename_plan(&plan)
        );
        assert!(matches!(
            store.verify(first.snapshot_id()),
            Err(BackupError::InvalidManifest("schema") | BackupError::Deserialize(_))
        ));
        assert!(matches!(
            store.create_verified_for_rename(&root, &plan),
            Err(BackupError::SnapshotExists)
        ));
    }

    #[test]
    fn binding_and_tamper_changes_are_rejected() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, false);
        let plan = plan_from(facts(vec![assignment(WORK_PATH, 1)], Vec::new(), true));
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();

        let mut other = plan.clone();
        other.device_fingerprint = format!("rootfp:v1:{}", "b".repeat(64));
        assert!(matches!(
            store.verify_for_rename_plan(&other),
            Err(BackupError::PlanBindingMismatch)
        ));
        other = plan.clone();
        other.base_observed_revision = 99;
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.source_relative_path = RootRelativePath::parse("SET/AUDIO/other.wav").unwrap();
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.destination_relative_path = RootRelativePath::parse("SET/AUDIO/moved.wav").unwrap();
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.source_content_hash = hash_bytes(b"changed-hash");
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.source_byte_size = 1;
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.state_document_impacts[0].content_hash = hash_bytes(b"doc-changed");
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.sidecar_impacts[0].content_hash = hash_bytes(b"ot-changed");
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.sidecar_impacts[0].destination_sidecar_relative_path =
            RootRelativePath::parse("SET/AUDIO/other.ot").unwrap();
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.reference_update_count = 99;
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other
            .backup_relative_paths
            .push(plan.destination_relative_path.clone());
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.backup_relative_paths.pop();
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other
            .backup_relative_paths
            .push(other.backup_relative_paths[0].clone());
        assert!(store.verify_for_rename_plan(&other).is_err());
        other = plan.clone();
        other.id = PlanId::parse(format!("plan:v1:{}", "c".repeat(64))).unwrap();
        assert!(store.verify_for_rename_plan(&other).is_err());

        fs::write(
            backup.directory().join("files/SET/AUDIO/kick.wav"),
            b"tampered-audio",
        )
        .unwrap();
        assert!(matches!(
            store.verify_for_rename_plan(&plan),
            Err(BackupError::VerificationFailed(_))
        ));
    }

    #[test]
    fn project_and_sidecar_and_manifest_tampers_fail_closed() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, false);
        let plan = plan_from(facts(vec![assignment(WORK_PATH, 1)], Vec::new(), true));
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();

        fs::write(
            backup.directory().join("files/SET/PROJECT/project.work"),
            b"tampered-project",
        )
        .unwrap();
        assert!(store.verify_for_rename_plan(&plan).is_err());

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, false);
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();
        fs::write(
            backup.directory().join("files/SET/AUDIO/kick.ot"),
            b"tampered-ot",
        )
        .unwrap();
        assert!(store.verify_for_rename_plan(&plan).is_err());

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, false);
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();
        let manifest_path = backup.directory().join("manifest.json");
        let mut manifest: RenameBackupManifest =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest.files[0].content_hash = hash_bytes(b"wrong").as_str().to_owned();
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        assert!(store.verify_for_rename_plan(&plan).is_err());

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let unused = plan_from(unused_facts());
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &unused).unwrap();
        let manifest_path = backup.directory().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["complete"] = serde_json::Value::Bool(false);
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            store.verify_for_rename_plan(&unused),
            Err(BackupError::IncompleteSnapshot)
        ));
    }

    #[test]
    fn filesystem_safety_rejects_root_escape_symlink_directory_and_leftovers() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let plan = plan_from(unused_facts());
        assert!(matches!(
            BackupStore::new(root.join("inside")).create_verified_for_rename(&root, &plan),
            Err(BackupError::BackupInsideSourceRoot)
        ));

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        fs::remove_file(root.join(SOURCE_PATH)).unwrap();
        fs::create_dir(root.join(SOURCE_PATH)).unwrap();
        assert!(matches!(
            BackupStore::new(fixture.path().join("local-backups"))
                .create_verified_for_rename(&root, &plan),
            Err(BackupError::UnsafePath | BackupError::Io(_))
        ));

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let snapshot_id = SnapshotId::for_rename_plan(&plan);
        fs::create_dir_all(
            store
                .base_directory()
                .join(format!("{}.partial", snapshot_id.directory_name())),
        )
        .unwrap();
        assert!(matches!(
            store.create_verified_for_rename(&root, &plan),
            Err(BackupError::SnapshotExists)
        ));

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();
        fs::write(backup.directory().join("files/extra.bin"), b"nope").unwrap();
        assert!(matches!(
            store.verify_for_rename_plan(&plan),
            Err(BackupError::UnexpectedBackupContents)
        ));
        fs::remove_file(backup.directory().join("files/extra.bin")).unwrap();
        fs::remove_file(backup.directory().join("files/SET/AUDIO/kick.wav")).unwrap();
        assert!(store.verify_for_rename_plan(&plan).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn source_project_sidecar_and_manifest_symlinks_fail_closed() {
        use std::os::unix::fs::symlink;

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        let outside = fixture.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("kick.wav"), AUDIO_BYTES).unwrap();
        symlink(&outside, root.join("SET")).unwrap();
        let plan = plan_from(unused_facts());
        assert!(matches!(
            BackupStore::new(fixture.path().join("local-backups"))
                .create_verified_for_rename(&root, &plan),
            Err(BackupError::SymlinkEncountered(_) | BackupError::UnsafePath)
        ));

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, false);
        let plan = plan_from(facts(vec![assignment(WORK_PATH, 1)], Vec::new(), true));
        fs::remove_file(root.join(WORK_PATH)).unwrap();
        symlink(fixture.path().join("outside.work"), root.join(WORK_PATH)).unwrap();
        fs::write(fixture.path().join("outside.work"), WORK_BYTES).unwrap();
        assert!(BackupStore::new(fixture.path().join("local-backups"))
            .create_verified_for_rename(&root, &plan)
            .is_err());

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, true, true, false);
        let plan = plan_from(facts(vec![assignment(WORK_PATH, 1)], Vec::new(), true));
        fs::remove_file(root.join(SIDECAR_PATH)).unwrap();
        symlink(fixture.path().join("outside.ot"), root.join(SIDECAR_PATH)).unwrap();
        fs::write(fixture.path().join("outside.ot"), SIDECAR_BYTES).unwrap();
        assert!(BackupStore::new(fixture.path().join("local-backups"))
            .create_verified_for_rename(&root, &plan)
            .is_err());

        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let unused = plan_from(unused_facts());
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &unused).unwrap();
        let manifest = backup.directory().join("manifest.json");
        let copied = backup.directory().join("manifest.body");
        fs::copy(&manifest, &copied).unwrap();
        fs::remove_file(&manifest).unwrap();
        symlink(&copied, &manifest).unwrap();
        assert!(matches!(
            store.verify_for_rename_plan(&unused),
            Err(BackupError::UnsafePath)
        ));
    }

    #[test]
    fn operation_kind_and_recovery_binding_tampers_fail() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("root");
        write_tree(&root, false, false, false);
        let plan = plan_from(unused_facts());
        let store = BackupStore::new(fixture.path().join("local-backups"));
        let backup = store.create_verified_for_rename(&root, &plan).unwrap();
        let original_binding = recovery_binding_for_rename_plan(&plan).unwrap();
        let manifest_path = backup.directory().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["recovery_binding"] =
            serde_json::Value::String(format!("recovery-binding:rename:v1:{}", "d".repeat(64)));
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            store.verify_for_rename_plan(&plan),
            Err(BackupError::InvalidManifest("recovery_binding"))
        ));
        assert_ne!(
            original_binding,
            format!("recovery-binding:rename:v1:{}", "d".repeat(64))
        );
    }
}
