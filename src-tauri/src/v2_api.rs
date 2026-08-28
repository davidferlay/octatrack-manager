use crate::catalog_runtime::SharedCatalog;
use crate::legacy_read_adapter::RegisteredLegacyLibrary;
use crate::root_registry::{RootRegistry, RootRegistryError, RootSession};
use ot_application::{ListLibrary, LoadLibrarySnapshot, StoreLibrarySnapshot};
use ot_domain::{
    FileInstance, LibraryProject, LibrarySet, LibrarySnapshot, RootId, SampleStorageScope,
};
use ot_storage_ports::{CatalogError, CatalogRootIdentity, CatalogRootObservation};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::State;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    code: String,
    message: String,
    recoverable: bool,
    details: Option<String>,
}

impl ApiError {
    fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
            details: None,
        }
    }

    fn task_failed(task: impl std::fmt::Display) -> Self {
        Self {
            code: "INTERNAL_ERROR".into(),
            message: "the read-only operation could not complete".into(),
            recoverable: true,
            details: Some(task.to_string()),
        }
    }
}

impl From<RootRegistryError> for ApiError {
    fn from(error: RootRegistryError) -> Self {
        Self::new(error.code(), error.to_string(), error.recoverable())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootCapabilitiesDto {
    read: bool,
    write: bool,
    stable_device_identity: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootSessionDto {
    root_id: String,
    display_name: String,
    device_fingerprint: String,
    mode: &'static str,
    observed_revision: u64,
    expires_in_seconds: u64,
    capabilities: RootCapabilitiesDto,
}

impl From<RootSession> for RootSessionDto {
    fn from(session: RootSession) -> Self {
        Self {
            root_id: session.root_id.as_str().to_owned(),
            display_name: session.display_name,
            device_fingerprint: session.device_fingerprint,
            mode: "read_only",
            observed_revision: session.observed_revision,
            expires_in_seconds: session.expires_in_seconds,
            capabilities: RootCapabilitiesDto {
                read: session.capabilities.read,
                write: session.capabilities.write,
                stable_device_identity: session.capabilities.stable_device_identity,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProjectDto {
    display_name: String,
    relative_path: String,
    has_project_file: bool,
    has_banks: bool,
}

impl From<LibraryProject> for LibraryProjectDto {
    fn from(project: LibraryProject) -> Self {
        Self {
            display_name: project.display_name,
            relative_path: project.relative_path.as_str().to_owned(),
            has_project_file: project.has_project_file,
            has_banks: project.has_banks,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySetDto {
    display_name: String,
    relative_path: String,
    has_audio_pool: bool,
    projects: Vec<LibraryProjectDto>,
}

impl From<LibrarySet> for LibrarySetDto {
    fn from(set: LibrarySet) -> Self {
        Self {
            display_name: set.display_name,
            relative_path: set.relative_path.as_str().to_owned(),
            has_audio_pool: set.has_audio_pool,
            projects: set.projects.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshotDto {
    sets: Vec<LibrarySetDto>,
    standalone_projects: Vec<LibraryProjectDto>,
    audio_files: Vec<LibraryAudioFileDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAudioFileDto {
    file_instance_id: String,
    asset_id: String,
    display_name: String,
    relative_path: String,
    byte_size: u64,
    storage_scope: &'static str,
}

impl LibraryAudioFileDto {
    fn from_catalog_file(root_identity: &CatalogRootIdentity, file: &FileInstance) -> Self {
        Self {
            file_instance_id: opaque_file_instance_id(root_identity, file),
            asset_id: opaque_asset_id(file),
            display_name: file
                .relative_path
                .as_str()
                .rsplit('/')
                .next()
                .expect("validated relative paths are non-empty")
                .to_owned(),
            relative_path: file.relative_path.as_str().to_owned(),
            byte_size: file.byte_size,
            storage_scope: storage_scope_name(file.storage_scope),
        }
    }
}

impl LibrarySnapshotDto {
    fn from_catalog_snapshot(
        root_identity: &CatalogRootIdentity,
        snapshot: LibrarySnapshot,
    ) -> Self {
        let audio_files = snapshot
            .file_instances
            .iter()
            .map(|file| LibraryAudioFileDto::from_catalog_file(root_identity, file))
            .collect();
        Self {
            sets: snapshot.sets.into_iter().map(Into::into).collect(),
            standalone_projects: snapshot
                .standalone_projects
                .into_iter()
                .map(Into::into)
                .collect(),
            audio_files,
        }
    }
}

fn opaque_file_instance_id(root_identity: &CatalogRootIdentity, file: &FileInstance) -> String {
    opaque_catalog_id(
        "fileinst:v1",
        &[root_identity.as_str(), file.relative_path.as_str()],
    )
}

fn opaque_asset_id(file: &FileInstance) -> String {
    opaque_catalog_id("asset:v1", &[file.content_hash.as_str()])
}

fn opaque_catalog_id(prefix: &str, values: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    for value in values {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    let digest = hasher.finalize();
    let lowercase_hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{prefix}:{lowercase_hex}")
}

fn storage_scope_name(scope: SampleStorageScope) -> &'static str {
    match scope {
        SampleStorageScope::SetAudioPool => "set_audio_pool",
        SampleStorageScope::ProjectLocal => "project_local",
        SampleStorageScope::Unclassified => "unclassified",
    }
}

fn parse_root_id(root_id: String) -> Result<RootId, ApiError> {
    RootId::new(root_id)
        .map_err(|error| ApiError::new("ROOT_NOT_APPROVED", error.to_string(), true))
}

#[cfg(test)]
fn list_library_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<LibrarySnapshot, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    load_library_snapshot(catalog, &identity)
}

fn list_library_dto_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<LibrarySnapshotDto, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    load_library_snapshot(catalog, &identity)
        .map(|snapshot| LibrarySnapshotDto::from_catalog_snapshot(&identity, snapshot))
}

fn load_library_snapshot(
    catalog: &SharedCatalog,
    identity: &CatalogRootIdentity,
) -> Result<LibrarySnapshot, ApiError> {
    let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    LoadLibrarySnapshot::new(&*catalog)
        .execute(identity)
        .map_err(catalog_error)?
        .ok_or_else(|| {
            ApiError::new(
                "CATALOG_NOT_INDEXED",
                "no successful catalog snapshot is available for this root",
                true,
            )
        })
}

fn scan_library_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
) -> Result<(RootSession, LibrarySnapshot), ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let baseline = {
        let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
        LoadLibrarySnapshot::new(&*catalog)
            .execute(&identity)
            .map_err(catalog_error)?
            .map(|snapshot| snapshot.file_instances)
            .unwrap_or_default()
    };
    let storage = RegisteredLegacyLibrary::new(root_id.clone(), resolved.canonical_path, baseline);
    ListLibrary::new(&storage)
        .execute(root_id)
        .map(|snapshot| (resolved.session, snapshot))
        .map_err(|error| storage_error(error.message()))
}

fn storage_error(message: &str) -> ApiError {
    let code = message
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .filter(|prefix| {
            matches!(
                *prefix,
                "ROOT_NOT_APPROVED"
                    | "ROOT_REMOVED"
                    | "PATH_ESCAPE"
                    | "SYMLINK_ESCAPE"
                    | "UNSUPPORTED_FORMAT"
            )
        })
        .unwrap_or("LIBRARY_SCAN_FAILED");
    ApiError::new(code, message, true)
}

fn catalog_identity(session: &RootSession) -> Result<CatalogRootIdentity, ApiError> {
    CatalogRootIdentity::new(session.device_fingerprint.clone()).map_err(catalog_error)
}

fn catalog_observation(session: &RootSession) -> Result<CatalogRootObservation, ApiError> {
    Ok(CatalogRootObservation {
        identity: catalog_identity(session)?,
        identity_is_stable: session.capabilities.stable_device_identity,
        display_name: session.display_name.clone(),
        observed_revision: session.observed_revision,
    })
}

fn store_library_snapshot(
    catalog: &SharedCatalog,
    session: &RootSession,
    snapshot: &LibrarySnapshot,
) -> Result<(), ApiError> {
    let observation = catalog_observation(session)?;
    let mut catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    StoreLibrarySnapshot::new(&mut *catalog)
        .execute(&observation, snapshot)
        .map(|_| ())
        .map_err(catalog_error)
}

fn catalog_lock_error() -> ApiError {
    ApiError::new(
        "CATALOG_UNAVAILABLE",
        "the local catalog is temporarily unavailable",
        true,
    )
}

fn catalog_error(error: CatalogError) -> ApiError {
    let (code, message, recoverable) = match &error {
        CatalogError::DuplicateRelativePath(_) => (
            "CATALOG_INDEX_INVALID",
            "the library scan contains duplicate relative paths",
            true,
        ),
        CatalogError::UnsupportedSchema { .. } => (
            "CATALOG_SCHEMA_UNSUPPORTED",
            "the catalog was created by a newer application version",
            false,
        ),
        CatalogError::Migration { .. } => (
            "CATALOG_MIGRATION_FAILED",
            "the local catalog schema could not be prepared",
            false,
        ),
        CatalogError::Unavailable { .. } => (
            "CATALOG_UNAVAILABLE",
            "the local catalog is temporarily unavailable",
            true,
        ),
        CatalogError::InvalidRootIdentity
        | CatalogError::InvalidScanId
        | CatalogError::InvalidScanRevision
        | CatalogError::InvalidStoredData { .. }
        | CatalogError::Integrity { .. } => (
            "CATALOG_INTEGRITY_ERROR",
            "the local catalog failed an integrity check",
            false,
        ),
        CatalogError::AssetNotFound => (
            "CATALOG_ASSET_NOT_FOUND",
            "the requested audio asset is not present in the catalog",
            true,
        ),
    };
    let mut api_error = ApiError::new(code, message, recoverable);
    api_error.details = Some(error.to_string());
    api_error
}

fn register_root_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    raw_path: &str,
) -> Result<RootSessionDto, ApiError> {
    let session = registry.register(raw_path)?;
    let (resolved_session, snapshot) = match scan_library_sync(registry, catalog, &session.root_id)
    {
        Ok(result) => result,
        Err(error) => {
            let _ = registry.close(&session.root_id);
            return Err(error);
        }
    };
    if snapshot.sets.is_empty() && snapshot.standalone_projects.is_empty() {
        let _ = registry.close(&session.root_id);
        return Err(ApiError::new(
            "UNSUPPORTED_FORMAT",
            "the selected folder does not contain an Octatrack Set or Project",
            true,
        ));
    }
    if let Err(error) = store_library_snapshot(catalog, &resolved_session, &snapshot) {
        let _ = registry.close(&session.root_id);
        return Err(error);
    }
    Ok(resolved_session.into())
}

#[tauri::command]
pub async fn v2_root_register(
    raw_path: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<RootSessionDto, ApiError> {
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || register_root_sync(&registry, &catalog, &raw_path))
        .await
        .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_root_status(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
) -> Result<RootSessionDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    tauri::async_runtime::spawn_blocking(move || {
        registry.resolve(&root_id).map(|root| root.session.into())
    })
    .await
    .map_err(ApiError::task_failed)?
    .map_err(ApiError::from)
}

#[tauri::command]
pub async fn v2_root_close(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
) -> Result<(), ApiError> {
    let root_id = parse_root_id(root_id)?;
    registry.close(&root_id)?;
    Ok(())
}

#[tauri::command]
pub async fn v2_library_list(
    root_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<LibrarySnapshotDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || {
        list_library_dto_sync(&registry, &catalog, &root_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog_runtime::open_shared_catalog;
    use crate::root_registry::{DeviceIdentityProvider, DeviceObservation};
    use std::fs;
    use std::path::Path;
    use std::time::Duration;
    use tempfile::TempDir;

    struct StableTestIdentity;

    impl DeviceIdentityProvider for StableTestIdentity {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            Ok(DeviceObservation {
                stable_key: "fixture-volume".into(),
                filesystem_type: Some("fixturefs".into()),
                total_capacity: Some(4096),
                mount_token: "fixture-mount".into(),
                stable: true,
            })
        }
    }

    fn registry() -> RootRegistry {
        RootRegistry::new(Arc::new(StableTestIdentity), Duration::from_secs(60))
    }

    fn catalog() -> (TempDir, SharedCatalog) {
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        (data_directory, catalog)
    }

    fn create_set_project(root: &Path, set_name: &str, project_name: &str) {
        let set = root.join(set_name);
        fs::create_dir_all(set.join("AUDIO")).unwrap();
        fs::create_dir_all(set.join(project_name)).unwrap();
        fs::write(set.join(project_name).join("project.work"), b"fixture").unwrap();
    }

    #[test]
    fn registration_rejects_folders_without_octatrack_content() {
        let root = TempDir::new().unwrap();
        let (_data_directory, catalog) = catalog();

        let error =
            register_root_sync(&registry(), &catalog, root.path().to_str().unwrap()).unwrap_err();

        assert_eq!(error.code, "UNSUPPORTED_FORMAT");
    }

    #[test]
    fn registration_indexes_and_query_returns_only_catalog_relative_paths() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let fixture_file = root.path().join("SET_A/PROJECT_A/project.work");
        let fixture_before = fs::read(&fixture_file).unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();

        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();

        assert_eq!(snapshot.sets[0].relative_path.as_str(), "SET_A");
        assert_eq!(
            snapshot.sets[0].projects[0].relative_path.as_str(),
            "SET_A/PROJECT_A"
        );
        assert_eq!(fs::read(fixture_file).unwrap(), fixture_before);
        assert!(!format!("{snapshot:?}").contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn catalog_query_does_not_rescan_the_registered_filesystem() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        fs::remove_dir_all(root.path().join("SET_A")).unwrap();

        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();

        assert_eq!(snapshot.sets[0].display_name, "SET_A");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "PROJECT_A");
    }

    #[test]
    fn catalog_query_survives_catalog_reopen() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        drop(catalog);

        let reopened_catalog = open_shared_catalog(data_directory.path()).unwrap();
        let snapshot = list_library_sync(&registry, &reopened_catalog, &root_id).unwrap();

        assert_eq!(snapshot.sets[0].display_name, "SET_A");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "PROJECT_A");
    }

    #[test]
    fn reregistering_the_root_replaces_the_catalog_projection() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "OLD_SET", "OLD_PROJECT");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let first = register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        fs::remove_dir_all(root.path().join("OLD_SET")).unwrap();
        create_set_project(root.path(), "NEW_SET", "NEW_PROJECT");

        let refreshed =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let snapshot = list_library_sync(
            &registry,
            &catalog,
            &RootId::new(refreshed.root_id.clone()).unwrap(),
        )
        .unwrap();

        assert_eq!(refreshed.root_id, first.root_id);
        assert_eq!(snapshot.sets.len(), 1);
        assert_eq!(snapshot.sets[0].display_name, "NEW_SET");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "NEW_PROJECT");
    }

    #[test]
    fn a_second_root_with_the_same_catalog_identity_cannot_replace_the_first() {
        let first_root = TempDir::new().unwrap();
        let second_root = TempDir::new().unwrap();
        create_set_project(first_root.path(), "FIRST_SET", "FIRST_PROJECT");
        create_set_project(second_root.path(), "SECOND_SET", "SECOND_PROJECT");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let first =
            register_root_sync(&registry, &catalog, first_root.path().to_str().unwrap()).unwrap();
        let first_root_id = RootId::new(first.root_id).unwrap();

        let error = register_root_sync(&registry, &catalog, second_root.path().to_str().unwrap())
            .unwrap_err();
        let snapshot = list_library_sync(&registry, &catalog, &first_root_id).unwrap();

        assert_eq!(error.code, "ROOT_IDENTITY_AMBIGUOUS");
        assert_eq!(snapshot.sets.len(), 1);
        assert_eq!(snapshot.sets[0].display_name, "FIRST_SET");
        assert_eq!(snapshot.sets[0].projects[0].display_name, "FIRST_PROJECT");
    }

    #[test]
    fn catalog_query_still_requires_live_root_authority() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        registry.close(&root_id).unwrap();

        let error = list_library_sync(&registry, &catalog, &root_id).unwrap_err();

        assert_eq!(error.code, "ROOT_NOT_APPROVED");
    }

    #[test]
    fn registration_stores_inventory_and_reregistration_uses_incremental_baseline() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio = root.path().join("SET_A/AUDIO/kick.wav");
        fs::write(&audio, b"audio fixture").unwrap();
        let before = fs::read(&audio).unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();

        let first = register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(first.root_id.clone()).unwrap();
        let first_snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        assert_eq!(first_snapshot.audio_assets.len(), 1);
        assert_eq!(first_snapshot.file_instances.len(), 1);
        assert_eq!(
            first_snapshot.file_instances[0].hash_freshness,
            ot_domain::ContentHashFreshness::ComputedThisScan
        );

        let second =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let second_snapshot =
            list_library_sync(&registry, &catalog, &RootId::new(second.root_id).unwrap()).unwrap();

        assert_eq!(
            second_snapshot.file_instances[0].hash_freshness,
            ot_domain::ContentHashFreshness::ReusedUnchangedMetadata
        );
        assert_eq!(fs::read(audio).unwrap(), before);
    }

    #[test]
    fn frontend_snapshot_dto_exposes_only_safe_file_inventory() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let snapshot =
            list_library_sync(&registry, &catalog, &RootId::new(session.root_id).unwrap()).unwrap();
        let content_hash = snapshot.file_instances[0].content_hash.as_str().to_owned();

        let identity = CatalogRootIdentity::new(session.device_fingerprint).unwrap();
        let dto = LibrarySnapshotDto::from_catalog_snapshot(&identity, snapshot);
        assert_eq!(dto.audio_files.len(), 1);
        assert_eq!(dto.audio_files[0].display_name, "kick.wav");
        assert_eq!(dto.audio_files[0].relative_path, "SET_A/AUDIO/kick.wav");
        assert_eq!(dto.audio_files[0].storage_scope, "set_audio_pool");
        assert!(dto.audio_files[0]
            .file_instance_id
            .starts_with("fileinst:v1:"));
        assert!(dto.audio_files[0].asset_id.starts_with("asset:v1:"));

        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("audioFiles"));
        assert!(!json.contains("contentHash"));
        assert!(!json.contains(&content_hash));
        assert!(!json.contains("modifiedAt"));
        assert!(!json.contains(identity.as_str()));
        assert!(!json.contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn file_instance_ids_are_root_scoped_and_stable_across_content_changes() {
        let root_identity =
            CatalogRootIdentity::new(format!("rootfp:v1:{}", "a".repeat(64))).unwrap();
        let other_root_identity =
            CatalogRootIdentity::new(format!("rootfp:v1:{}", "b".repeat(64))).unwrap();
        let original = FileInstance {
            relative_path: ot_domain::RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap(),
            content_hash: ot_domain::ContentHash::parse(format!("sha256:{}", "c".repeat(64)))
                .unwrap(),
            byte_size: 1024,
            modified_at_unix_ns: Some(1),
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ot_domain::ContentHashFreshness::ComputedThisScan,
        };
        let changed_content = FileInstance {
            content_hash: ot_domain::ContentHash::parse(format!("sha256:{}", "d".repeat(64)))
                .unwrap(),
            byte_size: 2048,
            modified_at_unix_ns: Some(2),
            ..original.clone()
        };

        assert_eq!(
            opaque_file_instance_id(&root_identity, &original),
            opaque_file_instance_id(&root_identity, &changed_content)
        );
        assert_ne!(
            opaque_file_instance_id(&root_identity, &original),
            opaque_file_instance_id(&other_root_identity, &original)
        );
        assert_ne!(
            opaque_asset_id(&original),
            opaque_asset_id(&changed_content)
        );
    }
}
