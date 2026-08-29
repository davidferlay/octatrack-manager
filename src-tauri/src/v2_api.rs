use crate::audio_runtime::{AudioRuntimeError, SharedAudioRuntime};
use crate::catalog_runtime::SharedCatalog;
use crate::legacy_read_adapter::RegisteredLegacyLibrary;
use crate::root_registry::{RootRegistry, RootRegistryError, RootSession};
use ot_application::{
    ListLibrary, LoadLibrarySnapshot, LoadManualAssetMetadata, ReplaceManualAssetMetadata,
    StoreLibrarySnapshot,
};
use ot_audio::AudioError;
use ot_domain::{
    ContentHash, FileInstance, InvalidManualMetadata, LibraryProject, LibrarySet, LibrarySnapshot,
    ManualAssetMetadata, ManualNote, ManualTag, RootId, SampleReferenceStatus, SampleSlotKind,
    SampleStorageScope, SampleUsageEdge, SampleUsageKind,
};
use ot_storage_ports::{CatalogError, CatalogRootIdentity, CatalogRootObservation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
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

impl From<AudioRuntimeError> for ApiError {
    fn from(error: AudioRuntimeError) -> Self {
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
    /// Catalog usage edges (relative paths only). UI5 Usage Graph.
    usage_edges: Vec<SampleUsageEdgeDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleUsageEdgeDto {
    bank_document_relative_path: String,
    project_document_relative_path: String,
    slot_kind: &'static str,
    slot_number: u16,
    usage_kind: &'static str,
    track_index: u8,
    part_index: Option<u8>,
    pattern_index: Option<u8>,
    step_index: Option<u8>,
    audible: bool,
    referenced_file_relative_path: Option<String>,
    reference_status: &'static str,
}

impl SampleUsageEdgeDto {
    fn from_edge(edge: SampleUsageEdge) -> Self {
        Self {
            bank_document_relative_path: edge.bank_document_relative_path.as_str().to_owned(),
            project_document_relative_path: edge.project_document_relative_path.as_str().to_owned(),
            slot_kind: slot_kind_name(edge.slot.kind()),
            slot_number: edge.slot.number(),
            usage_kind: usage_kind_name(edge.usage_kind),
            track_index: edge.track_index,
            part_index: edge.part_index,
            pattern_index: edge.pattern_index,
            step_index: edge.step_index,
            audible: edge.audible,
            referenced_file_relative_path: edge
                .referenced_file_relative_path
                .map(|path| path.as_str().to_owned()),
            reference_status: reference_status_name(edge.reference_status),
        }
    }
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
            asset_id: opaque_asset_id(&file.content_hash),
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
        let usage_edges = snapshot
            .usage_edges
            .into_iter()
            .map(SampleUsageEdgeDto::from_edge)
            .collect();
        Self {
            sets: snapshot.sets.into_iter().map(Into::into).collect(),
            standalone_projects: snapshot
                .standalone_projects
                .into_iter()
                .map(Into::into)
                .collect(),
            audio_files,
            usage_edges,
        }
    }
}

fn opaque_file_instance_id(root_identity: &CatalogRootIdentity, file: &FileInstance) -> String {
    opaque_catalog_id(
        "fileinst:v1",
        &[root_identity.as_str(), file.relative_path.as_str()],
    )
}

fn opaque_asset_id(content_hash: &ContentHash) -> String {
    opaque_catalog_id("asset:v1", &[content_hash.as_str()])
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

fn slot_kind_name(kind: SampleSlotKind) -> &'static str {
    match kind {
        SampleSlotKind::Static => "static",
        SampleSlotKind::Flex => "flex",
    }
}

fn usage_kind_name(kind: SampleUsageKind) -> &'static str {
    match kind {
        SampleUsageKind::Machine => "machine",
        SampleUsageKind::SampleLock => "sample_lock",
    }
}

fn reference_status_name(status: SampleReferenceStatus) -> &'static str {
    match status {
        SampleReferenceStatus::Resolved => "resolved",
        SampleReferenceStatus::Missing => "missing",
        SampleReferenceStatus::InvalidPath => "invalid_path",
        SampleReferenceStatus::UnassignedSlot => "unassigned_slot",
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAssetMetadataDto {
    tags: Vec<String>,
    note: Option<String>,
}

impl From<ManualAssetMetadata> for ManualAssetMetadataDto {
    fn from(metadata: ManualAssetMetadata) -> Self {
        Self {
            tags: metadata
                .tags()
                .iter()
                .map(|tag| tag.as_str().to_owned())
                .collect(),
            note: metadata.note().map(|note| note.as_str().to_owned()),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceManualAssetMetadataDto {
    tags: Vec<String>,
    note: Option<String>,
}

fn parse_manual_asset_metadata(
    input: ReplaceManualAssetMetadataDto,
) -> Result<ManualAssetMetadata, ApiError> {
    let tags = input
        .tags
        .into_iter()
        .map(ManualTag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(manual_metadata_error)?;
    let note = input
        .note
        .map(ManualNote::parse)
        .transpose()
        .map_err(manual_metadata_error)?;
    ManualAssetMetadata::new(tags, note).map_err(manual_metadata_error)
}

fn manual_metadata_error(error: InvalidManualMetadata) -> ApiError {
    ApiError::new("INVALID_MANUAL_METADATA", error.to_string(), true)
}

fn validate_asset_id(asset_id: &str) -> Result<(), ApiError> {
    let digest = asset_id
        .strip_prefix("asset:v1:")
        .ok_or_else(invalid_asset_id)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid_asset_id());
    }
    Ok(())
}

fn invalid_asset_id() -> ApiError {
    ApiError::new(
        "INVALID_ASSET_ID",
        "asset ID must be an opaque asset:v1 identifier",
        false,
    )
}

fn content_hash_for_asset_id(
    snapshot: &LibrarySnapshot,
    asset_id: &str,
) -> Result<ContentHash, ApiError> {
    validate_asset_id(asset_id)?;
    let mut matched: Option<ContentHash> = None;
    for file in &snapshot.file_instances {
        if opaque_asset_id(&file.content_hash) != asset_id {
            continue;
        }
        if let Some(existing) = &matched {
            if existing != &file.content_hash {
                return Err(ApiError::new(
                    "CATALOG_INTEGRITY_ERROR",
                    "the catalog contains an ambiguous asset identity",
                    false,
                ));
            }
        } else {
            matched = Some(file.content_hash.clone());
        }
    }
    matched.ok_or_else(|| {
        ApiError::new(
            "CATALOG_ASSET_NOT_FOUND",
            "the requested audio asset is not present in this root snapshot",
            true,
        )
    })
}

#[derive(Clone, Debug)]
struct LiveAudioSource {
    content_hash: ContentHash,
    absolute_path: PathBuf,
}

fn files_for_asset_id(
    snapshot: &LibrarySnapshot,
    asset_id: &str,
) -> Result<Vec<FileInstance>, ApiError> {
    let content_hash = content_hash_for_asset_id(snapshot, asset_id)?;
    let mut files = snapshot
        .file_instances
        .iter()
        .filter(|file| file.content_hash == content_hash)
        .cloned()
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });
    if files.is_empty() {
        return Err(ApiError::new(
            "CATALOG_INTEGRITY_ERROR",
            "the catalog asset has no file instance",
            false,
        ));
    }
    Ok(files)
}

fn resolve_live_audio_sources(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<Vec<LiveAudioSource>, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    let files = files_for_asset_id(&snapshot, asset_id)?;
    let mut sources = Vec::with_capacity(files.len());
    for file in files {
        match resolved.resolve_regular_file(&file.relative_path) {
            Ok(absolute_path) => sources.push(LiveAudioSource {
                content_hash: file.content_hash,
                absolute_path,
            }),
            Err(RootRegistryError::NotRegularFile) => continue,
            Err(error) => return Err(error.into()),
        }
    }
    if sources.is_empty() {
        return Err(RootRegistryError::NotRegularFile.into());
    }
    Ok(sources)
}

fn with_live_audio_source<T>(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
    mut operation: impl FnMut(&LiveAudioSource) -> Result<T, AudioRuntimeError>,
) -> Result<T, ApiError> {
    let sources = resolve_live_audio_sources(registry, catalog, root_id, asset_id)?;
    let mut source_changed = None;
    let mut source_unavailable = None;
    for source in &sources {
        match operation(source) {
            Ok(result) => return Ok(result),
            Err(error @ AudioRuntimeError::Audio(AudioError::SourceChanged)) => {
                source_changed = Some(error);
            }
            Err(error @ AudioRuntimeError::Audio(AudioError::SourceUnavailable(_))) => {
                source_unavailable = Some(error);
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(source_changed
        .or(source_unavailable)
        .map(ApiError::from)
        .unwrap_or_else(|| RootRegistryError::NotRegularFile.into()))
}

fn resolve_live_asset(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<ContentHash, ApiError> {
    let resolved = registry.resolve(root_id)?;
    let identity = catalog_identity(&resolved.session)?;
    let snapshot = load_library_snapshot(catalog, &identity)?;
    content_hash_for_asset_id(&snapshot, asset_id)
}

fn load_manual_asset_metadata_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let content_hash = resolve_live_asset(registry, catalog, root_id, asset_id)?;
    let catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    LoadManualAssetMetadata::new(&*catalog)
        .execute(&content_hash)
        .map(Into::into)
        .map_err(catalog_error)
}

fn replace_manual_asset_metadata_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    root_id: &RootId,
    asset_id: &str,
    input: ReplaceManualAssetMetadataDto,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let content_hash = resolve_live_asset(registry, catalog, root_id, asset_id)?;
    let metadata = parse_manual_asset_metadata(input)?;
    let mut catalog = catalog.lock().map_err(|_| catalog_lock_error())?;
    ReplaceManualAssetMetadata::new(&mut *catalog)
        .execute(&content_hash, &metadata)
        .map_err(catalog_error)?;
    Ok(metadata.into())
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformPeakDto {
    min: f32,
    max: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioWaveformDto {
    analyzer_version: String,
    sample_rate: u32,
    channels: u16,
    frame_count: u64,
    duration_seconds: f64,
    samples_per_peak: u64,
    peaks: Vec<WaveformPeakDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPreviewTokenDto {
    preview_token: String,
    expires_in_seconds: u64,
    mime_type: &'static str,
    byte_length: usize,
    duration_millis: u64,
    truncated: bool,
}

fn get_audio_waveform_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    audio: &SharedAudioRuntime,
    root_id: &RootId,
    asset_id: &str,
    target_points: usize,
) -> Result<AudioWaveformDto, ApiError> {
    let waveform = with_live_audio_source(registry, catalog, root_id, asset_id, |source| {
        audio.waveform(
            asset_id,
            &source.content_hash,
            &source.absolute_path,
            target_points,
        )
    })?;
    Ok(AudioWaveformDto {
        analyzer_version: waveform.analyzer_version.into(),
        sample_rate: waveform.sample_rate,
        channels: waveform.channels,
        frame_count: waveform.frame_count,
        duration_seconds: waveform.duration_seconds(),
        samples_per_peak: waveform.samples_per_peak,
        peaks: waveform
            .peaks
            .into_iter()
            .map(|peak| WaveformPeakDto {
                min: peak.min,
                max: peak.max,
            })
            .collect(),
    })
}

fn create_audio_preview_sync(
    registry: &RootRegistry,
    catalog: &SharedCatalog,
    audio: &SharedAudioRuntime,
    root_id: &RootId,
    asset_id: &str,
) -> Result<AudioPreviewTokenDto, ApiError> {
    let ticket = with_live_audio_source(registry, catalog, root_id, asset_id, |source| {
        audio.create_preview_token(
            root_id,
            asset_id,
            &source.content_hash,
            &source.absolute_path,
        )
    })?;
    Ok(AudioPreviewTokenDto {
        preview_token: ticket.token,
        expires_in_seconds: ticket.expires_in_seconds,
        mime_type: "audio/wav",
        byte_length: ticket.byte_length,
        duration_millis: ticket.duration_millis,
        truncated: ticket.truncated,
    })
}

fn read_audio_preview_sync(
    registry: &RootRegistry,
    audio: &SharedAudioRuntime,
    root_id: &RootId,
    preview_token: &str,
) -> Result<Vec<u8>, ApiError> {
    registry.resolve(root_id)?;
    audio
        .read_preview(root_id, preview_token)
        .map_err(Into::into)
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

#[tauri::command]
pub async fn v2_asset_metadata_get(
    root_id: String,
    asset_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || {
        load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_asset_metadata_replace(
    root_id: String,
    asset_id: String,
    metadata: ReplaceManualAssetMetadataDto,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
) -> Result<ManualAssetMetadataDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    tauri::async_runtime::spawn_blocking(move || {
        replace_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id, metadata)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_audio_waveform_get(
    root_id: String,
    asset_id: String,
    target_points: u32,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    audio: State<'_, SharedAudioRuntime>,
) -> Result<AudioWaveformDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let target_points = usize::try_from(target_points).map_err(|_| {
        ApiError::new(
            "INVALID_AUDIO_REQUEST",
            "target points are outside the supported range",
            true,
        )
    })?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let audio = Arc::clone(audio.inner());
    tauri::async_runtime::spawn_blocking(move || {
        get_audio_waveform_sync(
            &registry,
            &catalog,
            &audio,
            &root_id,
            &asset_id,
            target_points,
        )
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_audio_preview_create(
    root_id: String,
    asset_id: String,
    registry: State<'_, Arc<RootRegistry>>,
    catalog: State<'_, SharedCatalog>,
    audio: State<'_, SharedAudioRuntime>,
) -> Result<AudioPreviewTokenDto, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let catalog = Arc::clone(catalog.inner());
    let audio = Arc::clone(audio.inner());
    tauri::async_runtime::spawn_blocking(move || {
        create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id)
    })
    .await
    .map_err(ApiError::task_failed)?
}

#[tauri::command]
pub async fn v2_audio_preview_read(
    root_id: String,
    preview_token: String,
    registry: State<'_, Arc<RootRegistry>>,
    audio: State<'_, SharedAudioRuntime>,
) -> Result<tauri::ipc::Response, ApiError> {
    let root_id = parse_root_id(root_id)?;
    let registry = Arc::clone(registry.inner());
    let audio = Arc::clone(audio.inner());
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_audio_preview_sync(&registry, &audio, &root_id, &preview_token)
    })
    .await
    .map_err(ApiError::task_failed)??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_runtime::open_shared_audio_runtime;
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

    fn write_test_wav(path: &Path) {
        let sample_rate = 8_000_u32;
        let channels = 1_u16;
        let samples = (0..4_000)
            .flat_map(|index| {
                let sample = if index % 200 < 100 {
                    i16::MAX / 2
                } else {
                    i16::MIN / 2
                };
                sample.to_le_bytes()
            })
            .collect::<Vec<_>>();
        let data_size = u32::try_from(samples.len()).unwrap();
        let byte_rate = sample_rate * u32::from(channels) * 2;
        let block_align = channels * 2;
        let mut wav = Vec::with_capacity(44 + samples.len());
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_size).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        wav.extend_from_slice(&samples);
        fs::write(path, wav).unwrap();
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
        assert!(dto.usage_edges.is_empty());

        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("audioFiles"));
        assert!(json.contains("usageEdges"));
        assert!(!json.contains("contentHash"));
        assert!(!json.contains(&content_hash));
        assert!(!json.contains("modifiedAt"));
        assert!(!json.contains(identity.as_str()));
        assert!(!json.contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn frontend_snapshot_dto_exposes_usage_edges_with_relative_paths_only() {
        use ot_domain::{
            ContentHashFreshness, ParserProvenance, RootRelativePath, SampleSlotId, SampleSlotKind,
            StateDocument, StateDocumentKind, StateDocumentParseStatus, StateDocumentRole,
        };

        let identity = CatalogRootIdentity::new(format!("rootfp:v1:{}", "a".repeat(64))).unwrap();
        let audio = FileInstance {
            relative_path: RootRelativePath::parse("SET_A/AUDIO/kick.wav").unwrap(),
            content_hash: ContentHash::parse(format!("sha256:{}", "c".repeat(64))).unwrap(),
            byte_size: 12,
            modified_at_unix_ns: Some(1),
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        };
        let project_document = RootRelativePath::parse("SET_A/PROJECT_A/project.work").unwrap();
        let bank_document = RootRelativePath::parse("SET_A/PROJECT_A/bank01.work").unwrap();
        let provenance = ParserProvenance {
            parser_name: "fixture".into(),
            parser_revision: "1".into(),
            source_version: None,
        };
        let snapshot = LibrarySnapshot {
            sets: vec![LibrarySet {
                display_name: "SET_A".into(),
                relative_path: RootRelativePath::parse("SET_A").unwrap(),
                has_audio_pool: true,
                projects: vec![LibraryProject {
                    display_name: "PROJECT_A".into(),
                    relative_path: RootRelativePath::parse("SET_A/PROJECT_A").unwrap(),
                    has_project_file: true,
                    has_banks: true,
                }],
            }],
            standalone_projects: vec![],
            audio_assets: vec![],
            file_instances: vec![audio.clone()],
            state_documents: vec![StateDocument {
                project_relative_path: RootRelativePath::parse("SET_A/PROJECT_A").unwrap(),
                source_relative_path: bank_document.clone(),
                kind: StateDocumentKind::Bank,
                role: StateDocumentRole::Working,
                bank_index: Some(0),
                parse_status: StateDocumentParseStatus::Parsed,
                parser_provenance: provenance,
            }],
            slot_assignments: vec![],
            usage_edges: vec![SampleUsageEdge {
                bank_document_relative_path: bank_document,
                project_document_relative_path: project_document,
                slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                usage_kind: SampleUsageKind::Machine,
                track_index: 0,
                part_index: Some(0),
                pattern_index: None,
                step_index: None,
                audible: true,
                referenced_file_relative_path: Some(audio.relative_path.clone()),
                reference_status: SampleReferenceStatus::Resolved,
            }],
            sample_settings: vec![],
        };

        let dto = LibrarySnapshotDto::from_catalog_snapshot(&identity, snapshot);
        assert_eq!(dto.usage_edges.len(), 1);
        assert_eq!(
            dto.usage_edges[0].referenced_file_relative_path.as_deref(),
            Some("SET_A/AUDIO/kick.wav")
        );
        assert_eq!(dto.usage_edges[0].slot_kind, "static");
        assert_eq!(dto.usage_edges[0].usage_kind, "machine");
        assert!(dto.usage_edges[0].audible);

        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("usageEdges"));
        assert!(json.contains("SET_A/PROJECT_A/bank01.work"));
        assert!(!json.contains("/private/"));
        assert!(!json.contains(identity.as_str()));
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
            opaque_asset_id(&original.content_hash),
            opaque_asset_id(&changed_content.content_hash)
        );
    }

    #[test]
    fn manual_metadata_api_round_trips_without_touching_the_audio_fixture() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio = root.path().join("SET_A/AUDIO/kick.wav");
        fs::write(&audio, b"read-only audio fixture").unwrap();
        let before = fs::read(&audio).unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();

        let saved = replace_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &asset_id,
            ReplaceManualAssetMetadataDto {
                tags: vec!["warm".into(), "kick".into()],
                note: Some("Main live kick".into()),
            },
        )
        .unwrap();
        let loaded =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id).unwrap();

        assert_eq!(saved.tags, vec!["kick", "warm"]);
        assert_eq!(saved.note.as_deref(), Some("Main live kick"));
        assert_eq!(loaded, saved);
        assert_eq!(fs::read(&audio).unwrap(), before);

        let json = serde_json::to_string(&loaded).unwrap();
        assert!(!json.contains("sha256:"));
        assert!(!json.contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn manual_metadata_api_rejects_invalid_or_unlisted_asset_ids() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_sync(&registry, &catalog, &root_id).unwrap();
        let raw_content_hash = snapshot.file_instances[0].content_hash.as_str();

        let raw_hash_error =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, raw_content_hash)
                .unwrap_err();
        let missing_error = load_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &format!("asset:v1:{}", "a".repeat(64)),
        )
        .unwrap_err();

        assert_eq!(raw_hash_error.code, "INVALID_ASSET_ID");
        assert_eq!(missing_error.code, "CATALOG_ASSET_NOT_FOUND");
    }

    #[test]
    fn manual_metadata_api_requires_live_root_authority() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();
        registry.close(&root_id).unwrap();

        let error =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id).unwrap_err();

        assert_eq!(error.code, "ROOT_NOT_APPROVED");
    }

    #[test]
    fn invalid_manual_metadata_is_rejected_before_replacing_existing_values() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        fs::write(root.path().join("SET_A/AUDIO/kick.wav"), b"audio fixture").unwrap();
        let registry = registry();
        let (_data_directory, catalog) = catalog();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();
        let original = replace_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &asset_id,
            ReplaceManualAssetMetadataDto {
                tags: vec!["kick".into()],
                note: Some("Keep this".into()),
            },
        )
        .unwrap();

        let error = replace_manual_asset_metadata_sync(
            &registry,
            &catalog,
            &root_id,
            &asset_id,
            ReplaceManualAssetMetadataDto {
                tags: vec!["duplicate".into(), "duplicate".into()],
                note: None,
            },
        )
        .unwrap_err();
        let loaded =
            load_manual_asset_metadata_sync(&registry, &catalog, &root_id, &asset_id).unwrap();

        assert_eq!(error.code, "INVALID_MANUAL_METADATA");
        assert_eq!(loaded, original);
    }

    #[test]
    fn waveform_and_preview_api_round_trip_without_exposing_paths_or_hashes() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio_path = root.path().join("SET_A/AUDIO/kick.wav");
        write_test_wav(&audio_path);
        let before = fs::read(&audio_path).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let audio = open_shared_audio_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();

        let waveform =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128).unwrap();
        let ticket =
            create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id).unwrap();
        let preview =
            read_audio_preview_sync(&registry, &audio, &root_id, &ticket.preview_token).unwrap();

        assert_eq!(waveform.analyzer_version, "waveform:v1");
        assert_eq!(waveform.sample_rate, 8_000);
        assert_eq!(waveform.channels, 1);
        assert!(!waveform.peaks.is_empty());
        assert_eq!(ticket.mime_type, "audio/wav");
        assert_eq!(&preview[0..4], b"RIFF");
        assert_eq!(&preview[8..12], b"WAVE");
        assert_eq!(preview.len(), ticket.byte_length);
        assert_eq!(fs::read(&audio_path).unwrap(), before);

        let response_json = format!(
            "{}{}",
            serde_json::to_string(&waveform).unwrap(),
            serde_json::to_string(&ticket).unwrap()
        );
        assert!(!response_json.contains("sha256:"));
        assert!(!response_json.contains(&asset_id));
        assert!(!response_json.contains(root.path().to_str().unwrap()));
        assert!(!ticket.preview_token.contains("kick"));
    }

    #[test]
    fn audio_api_uses_another_live_file_instance_for_the_same_asset() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let missing_path = root.path().join("SET_A/AUDIO/a-missing.wav");
        let live_path = root.path().join("SET_A/AUDIO/b-live.wav");
        write_test_wav(&missing_path);
        fs::copy(&missing_path, &live_path).unwrap();
        let live_before = fs::read(&live_path).unwrap();
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let audio = open_shared_audio_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot
            .audio_files
            .iter()
            .find(|file| file.relative_path.ends_with("a-missing.wav"))
            .unwrap()
            .asset_id
            .clone();
        assert_eq!(
            snapshot
                .audio_files
                .iter()
                .filter(|file| file.asset_id == asset_id)
                .count(),
            2
        );
        fs::remove_file(&missing_path).unwrap();

        let waveform =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128).unwrap();
        let ticket =
            create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id).unwrap();
        let preview =
            read_audio_preview_sync(&registry, &audio, &root_id, &ticket.preview_token).unwrap();

        assert!(!waveform.peaks.is_empty());
        assert_eq!(&preview[0..4], b"RIFF");
        assert_eq!(fs::read(&live_path).unwrap(), live_before);
    }

    #[test]
    fn audio_api_rehashes_the_source_and_requires_live_root_authority() {
        let root = TempDir::new().unwrap();
        create_set_project(root.path(), "SET_A", "PROJECT_A");
        let audio_path = root.path().join("SET_A/AUDIO/kick.wav");
        write_test_wav(&audio_path);
        let registry = registry();
        let data_directory = TempDir::new().unwrap();
        let catalog = open_shared_catalog(data_directory.path()).unwrap();
        let audio = open_shared_audio_runtime(data_directory.path()).unwrap();
        let session =
            register_root_sync(&registry, &catalog, root.path().to_str().unwrap()).unwrap();
        let root_id = RootId::new(session.root_id).unwrap();
        let snapshot = list_library_dto_sync(&registry, &catalog, &root_id).unwrap();
        let asset_id = snapshot.audio_files[0].asset_id.clone();
        let ticket =
            create_audio_preview_sync(&registry, &catalog, &audio, &root_id, &asset_id).unwrap();

        fs::write(&audio_path, b"changed after the catalog snapshot").unwrap();
        let changed =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128)
                .unwrap_err();
        assert_eq!(changed.code, "AUDIO_SOURCE_CHANGED");

        fs::remove_file(&audio_path).unwrap();
        let missing =
            get_audio_waveform_sync(&registry, &catalog, &audio, &root_id, &asset_id, 128)
                .unwrap_err();
        assert_eq!(missing.code, "AUDIO_SOURCE_UNAVAILABLE");

        registry.close(&root_id).unwrap();
        let closed = read_audio_preview_sync(&registry, &audio, &root_id, &ticket.preview_token)
            .unwrap_err();
        assert_eq!(closed.code, "ROOT_NOT_APPROVED");
    }
}
