use crate::legacy_read_adapter::RegisteredLegacyLibrary;
use crate::root_registry::{RootRegistry, RootRegistryError, RootSession};
use ot_application::ListLibrary;
use ot_domain::{LibraryProject, LibrarySet, LibrarySnapshot, RootId};
use serde::Serialize;
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
}

impl From<LibrarySnapshot> for LibrarySnapshotDto {
    fn from(snapshot: LibrarySnapshot) -> Self {
        Self {
            sets: snapshot.sets.into_iter().map(Into::into).collect(),
            standalone_projects: snapshot
                .standalone_projects
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

fn parse_root_id(root_id: String) -> Result<RootId, ApiError> {
    RootId::new(root_id)
        .map_err(|error| ApiError::new("ROOT_NOT_APPROVED", error.to_string(), true))
}

fn list_library_sync(
    registry: &RootRegistry,
    root_id: &RootId,
) -> Result<LibrarySnapshot, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let storage = RegisteredLegacyLibrary::new(root_id.clone(), resolved.canonical_path);
    ListLibrary::new(&storage)
        .execute(root_id)
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

fn register_root_sync(registry: &RootRegistry, raw_path: &str) -> Result<RootSessionDto, ApiError> {
    let session = registry.register(raw_path)?;
    let snapshot = match list_library_sync(registry, &session.root_id) {
        Ok(snapshot) => snapshot,
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
    Ok(session.into())
}

#[tauri::command]
pub async fn v2_root_register(
    raw_path: String,
    registry: State<'_, Arc<RootRegistry>>,
) -> Result<RootSessionDto, ApiError> {
    let registry = Arc::clone(registry.inner());
    tauri::async_runtime::spawn_blocking(move || register_root_sync(&registry, &raw_path))
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
) -> Result<LibrarySnapshotDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    tauri::async_runtime::spawn_blocking(move || list_library_sync(&registry, &root_id))
        .await
        .map_err(ApiError::task_failed)?
        .map(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn registration_rejects_folders_without_octatrack_content() {
        let root = TempDir::new().unwrap();

        let error = register_root_sync(&registry(), root.path().to_str().unwrap()).unwrap_err();

        assert_eq!(error.code, "UNSUPPORTED_FORMAT");
    }

    #[test]
    fn root_id_lists_only_relative_set_and_project_paths() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("SET_A")).unwrap();
        fs::create_dir(root.path().join("SET_A/AUDIO")).unwrap();
        fs::create_dir(root.path().join("SET_A/PROJECT_A")).unwrap();
        fs::write(root.path().join("SET_A/PROJECT_A/project.work"), b"fixture").unwrap();
        let registry = registry();
        let session = register_root_sync(&registry, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();

        let snapshot = list_library_sync(&registry, &root_id).unwrap();

        assert_eq!(snapshot.sets[0].relative_path.as_str(), "SET_A");
        assert_eq!(
            snapshot.sets[0].projects[0].relative_path.as_str(),
            "SET_A/PROJECT_A"
        );
    }
}
