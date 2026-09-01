use crate::root_registry::{ResolvedRoot, RootRegistryError};
use ot_domain::{
    ContentHash, ContentHashFreshness, FileInstance, LibrarySnapshot, RootRelativePath,
    SampleSettingsOwner, SampleSettingsParseStatus, StateDocument, StateDocumentKind,
    StateDocumentRole,
};
use ot_plan::{
    classify_destination_state, derive_file_instance_id, PathComparisonMode,
    RenameDestinationObservation, RenameDestinationState, RenameRootObservation,
    RenameSamplePlanningFacts, RenameSidecarObservation, RenameSlotAssignmentObservation,
    RenameSourceObservation, RenameStateDocumentObservation, RenameUnsafePathReason,
    RenameUsageEdgeObservation, UnicodeNormalizationForm,
};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use unicode_normalization::{is_nfc, is_nfd, UnicodeNormalization};

#[derive(Debug, Eq, PartialEq)]
pub enum RenamePlanningFactsError {
    CatalogStale,
    AudioSourceUnavailable,
    InvalidDestinationPath(String),
    SymlinkEscape,
    NotRegularFile,
    PermissionDenied,
    Unavailable,
    InternalError,
}

impl RenamePlanningFactsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::CatalogStale => "CATALOG_STALE",
            Self::AudioSourceUnavailable => "AUDIO_SOURCE_UNAVAILABLE",
            Self::InvalidDestinationPath(_) => "INVALID_DESTINATION_PATH",
            Self::SymlinkEscape => "SYMLINK_ESCAPE",
            Self::NotRegularFile => "NOT_REGULAR_FILE",
            Self::PermissionDenied => "PERMISSION_DENIED",
            Self::Unavailable => "ROOT_UNAVAILABLE",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}

impl std::fmt::Display for RenamePlanningFactsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CatalogStale => {
                formatter.write_str("catalog observation no longer matches the live source sample")
            }
            Self::AudioSourceUnavailable => {
                formatter.write_str("the source sample could not be read")
            }
            Self::InvalidDestinationPath(message) => write!(formatter, "{message}"),
            Self::SymlinkEscape => formatter.write_str("path escapes through a symbolic link"),
            Self::NotRegularFile => formatter.write_str("path does not refer to a regular file"),
            Self::PermissionDenied => formatter.write_str("permission denied"),
            Self::Unavailable => formatter.write_str("the registered root is unavailable"),
            Self::InternalError => formatter.write_str("planning facts could not be assembled"),
        }
    }
}

impl std::error::Error for RenamePlanningFactsError {}

impl From<RootRegistryError> for RenamePlanningFactsError {
    fn from(error: RootRegistryError) -> Self {
        match error {
            RootRegistryError::SymlinkEscape => Self::SymlinkEscape,
            RootRegistryError::NotRegularFile => Self::NotRegularFile,
            RootRegistryError::PermissionDenied => Self::PermissionDenied,
            RootRegistryError::Unavailable => Self::Unavailable,
            _ => Self::Unavailable,
        }
    }
}

pub fn ensure_same_directory_rename(
    source: &RootRelativePath,
    destination: &RootRelativePath,
) -> Result<(), RenamePlanningFactsError> {
    if path_parent(source.as_str()) != path_parent(destination.as_str()) {
        return Err(RenamePlanningFactsError::InvalidDestinationPath(
            "rename destination must stay in the same directory as the source sample".into(),
        ));
    }
    Ok(())
}

pub fn build_rename_planning_facts(
    resolved: &ResolvedRoot,
    snapshot: &LibrarySnapshot,
    scan_revision: u64,
    source: &FileInstance,
    destination: RootRelativePath,
) -> Result<RenameSamplePlanningFacts, RenamePlanningFactsError> {
    ensure_same_directory_rename(&source.relative_path, &destination)?;

    let source_path = resolved.resolve_regular_file(&source.relative_path)?;
    let (live_byte_size, live_content_hash) = hash_live_file(&source_path)?;

    if live_byte_size != source.byte_size || live_content_hash != source.content_hash {
        return Err(RenamePlanningFactsError::CatalogStale);
    }

    let hash_freshness = ContentHashFreshness::ComputedThisScan;

    let destination_state = observe_destination_state(resolved, &destination, snapshot)?;
    let sidecar_destination =
        observe_sidecar_destination(resolved, &destination, snapshot, &source.relative_path)?;

    Ok(RenameSamplePlanningFacts {
        root: RenameRootObservation {
            root_id: resolved.session.root_id.clone(),
            device_fingerprint: resolved.session.device_fingerprint.clone(),
            live_observed_revision: resolved.session.observed_revision,
            base_catalog_scan_revision: scan_revision,
            scan_completed: true,
            identity_is_stable: resolved.session.capabilities.stable_device_identity,
        },
        source: RenameSourceObservation {
            file_instance_id: derive_file_instance_id(
                &resolved.session.device_fingerprint,
                &source.relative_path,
            ),
            catalog_relative_path: source.relative_path.clone(),
            catalog_byte_size: source.byte_size,
            catalog_content_hash: source.content_hash.clone(),
            live_relative_path: source.relative_path.clone(),
            live_byte_size,
            live_content_hash,
            hash_freshness,
        },
        destination: RenameDestinationObservation {
            intended_relative_path: destination.clone(),
            state: destination_state,
        },
        sidecar_destination,
        state_documents: snapshot
            .state_documents
            .iter()
            .map(|document| map_state_document(resolved, document))
            .collect::<Result<Vec<_>, _>>()?,
        slot_assignments: snapshot
            .slot_assignments
            .iter()
            .map(|assignment| RenameSlotAssignmentObservation {
                project_document_relative_path: assignment.project_document_relative_path.clone(),
                slot: assignment.slot,
                referenced_file_relative_path: assignment.referenced_file_relative_path.clone(),
                reference_status: assignment.reference_status,
            })
            .collect(),
        usage_edges: snapshot
            .usage_edges
            .iter()
            .map(|edge| RenameUsageEdgeObservation {
                bank_document_relative_path: edge.bank_document_relative_path.clone(),
                project_document_relative_path: edge.project_document_relative_path.clone(),
                slot: edge.slot,
                usage_kind: edge.usage_kind,
                referenced_file_relative_path: edge.referenced_file_relative_path.clone(),
                reference_status: edge.reference_status,
            })
            .collect(),
        sidecars: collect_sidecar_observations(resolved, snapshot, &source.relative_path)?,
        usage_graph_complete: true,
        set_project_coverage_complete: derive_set_project_coverage_complete(snapshot),
    })
}

fn derive_set_project_coverage_complete(snapshot: &LibrarySnapshot) -> bool {
    snapshot
        .sets
        .iter()
        .flat_map(|set| set.projects.iter())
        .chain(snapshot.standalone_projects.iter())
        .filter(|project| project.has_project_file)
        .all(|project| {
            snapshot.state_documents.iter().any(|document| {
                document.kind == StateDocumentKind::Project
                    && document.role == StateDocumentRole::Working
                    && document.project_relative_path == project.relative_path
            })
        })
}

fn map_state_document(
    resolved: &ResolvedRoot,
    document: &StateDocument,
) -> Result<RenameStateDocumentObservation, RenamePlanningFactsError> {
    let path = resolved
        .resolve_regular_file(&document.source_relative_path)
        .map_err(RenamePlanningFactsError::from)?;
    let (byte_size, content_hash) = hash_live_file(&path)?;
    Ok(RenameStateDocumentObservation {
        relative_path: document.source_relative_path.clone(),
        kind: document.kind,
        role: document.role,
        byte_size,
        content_hash,
        parse_status: document.parse_status,
        parser_provenance: document.parser_provenance.clone(),
    })
}

fn collect_sidecar_observations(
    resolved: &ResolvedRoot,
    snapshot: &LibrarySnapshot,
    source_relative_path: &RootRelativePath,
) -> Result<Vec<RenameSidecarObservation>, RenamePlanningFactsError> {
    let mut observations = Vec::new();
    for settings in &snapshot.sample_settings {
        if settings.owner != SampleSettingsOwner::FileInstanceSidecar {
            continue;
        }
        let Some(owner_path) = settings.file_instance_relative_path.as_ref() else {
            continue;
        };
        if owner_path != source_relative_path {
            continue;
        }
        let sidecar_path = resolved
            .resolve_regular_file(&settings.source_relative_path)
            .map_err(RenamePlanningFactsError::from)?;
        if !sidecar_path.exists() {
            continue;
        }
        let (byte_size, content_hash) = hash_live_file(&sidecar_path)?;
        let ownership_is_unique = snapshot
            .sample_settings
            .iter()
            .filter(|candidate| {
                candidate.owner == SampleSettingsOwner::FileInstanceSidecar
                    && candidate
                        .file_instance_relative_path
                        .as_ref()
                        .is_some_and(|path| path == source_relative_path)
            })
            .count()
            == 1;
        observations.push(RenameSidecarObservation {
            sidecar_relative_path: settings.source_relative_path.clone(),
            owning_audio_relative_path: source_relative_path.clone(),
            byte_size,
            content_hash,
            parse_status: settings.parse_status,
            parser_provenance: settings.parser_provenance.clone(),
            ownership_is_unique,
        });
    }
    Ok(observations)
}

fn observe_sidecar_destination(
    resolved: &ResolvedRoot,
    audio_destination: &RootRelativePath,
    snapshot: &LibrarySnapshot,
    source_relative_path: &RootRelativePath,
) -> Result<Option<RenameDestinationObservation>, RenamePlanningFactsError> {
    let has_sidecar = snapshot.sample_settings.iter().any(|settings| {
        settings.owner == SampleSettingsOwner::FileInstanceSidecar
            && settings
                .file_instance_relative_path
                .as_ref()
                .is_some_and(|path| path == source_relative_path)
            && settings.parse_status == SampleSettingsParseStatus::Parsed
    });
    if !has_sidecar {
        return Ok(None);
    }
    let Some((prefix, _extension)) = audio_destination.as_str().rsplit_once('.') else {
        return Ok(None);
    };
    let sidecar_relative = RootRelativePath::parse(format!("{prefix}.ot"))
        .map_err(|error| RenamePlanningFactsError::InvalidDestinationPath(error.to_string()))?;
    let state = observe_destination_state(resolved, &sidecar_relative, snapshot)?;
    Ok(Some(RenameDestinationObservation {
        intended_relative_path: sidecar_relative,
        state,
    }))
}

fn observe_destination_state(
    resolved: &ResolvedRoot,
    intended: &RootRelativePath,
    snapshot: &LibrarySnapshot,
) -> Result<RenameDestinationState, RenamePlanningFactsError> {
    let parent = path_parent(intended.as_str());
    let sibling_paths = sibling_paths_in_parent(resolved, snapshot, parent)?;

    if let Ok(path) = resolved.resolve_regular_file(intended) {
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Ok(RenameDestinationState::UnsafePath {
                    reason: RenameUnsafePathReason::SymlinkEscape,
                });
            }
            Ok(metadata) if metadata.is_file() => {
                let (byte_size, content_hash) = hash_live_file(&path)?;
                return Ok(RenameDestinationState::Existing {
                    relative_path: intended.clone(),
                    byte_size,
                    content_hash,
                });
            }
            Ok(_) => {
                return Ok(RenameDestinationState::UnsafePath {
                    reason: RenameUnsafePathReason::InvalidComponent,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(RenamePlanningFactsError::PermissionDenied);
            }
            Err(_) => return Err(RenamePlanningFactsError::Unavailable),
        }
    }

    if let Some((existing, normalization)) =
        find_unicode_normalization_collision(intended, &sibling_paths)
    {
        return Ok(RenameDestinationState::NormalizationCollision {
            existing_relative_path: existing,
            normalization,
        });
    }

    Ok(classify_destination_state(
        intended,
        &sibling_paths,
        PathComparisonMode::CaseInsensitive,
    ))
}

fn sibling_paths_in_parent(
    resolved: &ResolvedRoot,
    snapshot: &LibrarySnapshot,
    parent: &str,
) -> Result<Vec<RootRelativePath>, RenamePlanningFactsError> {
    let mut paths = HashSet::new();
    for file in &snapshot.file_instances {
        if path_parent(file.relative_path.as_str()) == parent {
            paths.insert(file.relative_path.clone());
        }
    }

    let parent_abs = if parent.is_empty() {
        resolved.canonical_path.clone()
    } else {
        resolved
            .canonical_path
            .join(parent.split('/').collect::<PathBuf>())
    };

    if parent_abs.exists() {
        let entries = fs::read_dir(&parent_abs).map_err(|error| match error.kind() {
            std::io::ErrorKind::PermissionDenied => RenamePlanningFactsError::PermissionDenied,
            std::io::ErrorKind::NotFound => RenamePlanningFactsError::InvalidDestinationPath(
                "destination parent directory does not exist".into(),
            ),
            _ => RenamePlanningFactsError::Unavailable,
        })?;
        for entry in entries {
            let entry = entry.map_err(|_| RenamePlanningFactsError::Unavailable)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|_| RenamePlanningFactsError::Unavailable)?;
            if metadata.file_type().is_symlink() {
                return Err(RenamePlanningFactsError::SymlinkEscape);
            }
            let relative = if parent.is_empty() {
                RootRelativePath::parse(name)
            } else {
                RootRelativePath::parse(format!("{parent}/{name}"))
            }
            .map_err(|error| RenamePlanningFactsError::InvalidDestinationPath(error.to_string()))?;
            paths.insert(relative);
        }
    }

    Ok(paths.into_iter().collect())
}

fn find_unicode_normalization_collision(
    intended: &RootRelativePath,
    siblings: &[RootRelativePath],
) -> Option<(RootRelativePath, UnicodeNormalizationForm)> {
    let intended_parent = path_parent(intended.as_str());
    let intended_name = path_basename(intended.as_str())?;
    let intended_nfc: String = intended_name.nfc().collect();
    let intended_nfd: String = intended_name.nfd().collect();

    for sibling in siblings {
        if path_parent(sibling.as_str()) != intended_parent {
            continue;
        }
        if sibling == intended {
            continue;
        }
        let Some(sibling_name) = path_basename(sibling.as_str()) else {
            continue;
        };
        if sibling_name == intended_name {
            continue;
        }
        let sibling_nfc: String = sibling_name.nfc().collect();
        let sibling_nfd: String = sibling_name.nfd().collect();
        if sibling_nfc == intended_nfc && !is_nfc(intended_name) {
            return Some((sibling.clone(), UnicodeNormalizationForm::Nfc));
        }
        if sibling_nfd == intended_nfd && !is_nfd(intended_name) {
            return Some((sibling.clone(), UnicodeNormalizationForm::Nfd));
        }
    }
    None
}

pub fn hash_live_file(path: &Path) -> Result<(u64, ContentHash), RenamePlanningFactsError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| RenamePlanningFactsError::NotRegularFile)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(RenamePlanningFactsError::NotRegularFile);
    }
    let mut file = open_regular_file_nofollow(path)?;
    let before = file
        .metadata()
        .map_err(|_| RenamePlanningFactsError::NotRegularFile)?;
    if !before.is_file() {
        return Err(RenamePlanningFactsError::NotRegularFile);
    }
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| RenamePlanningFactsError::AudioSourceUnavailable)?;
        if read == 0 {
            break;
        }
        bytes = bytes
            .checked_add(read as u64)
            .ok_or(RenamePlanningFactsError::InternalError)?;
        hasher.update(&buffer[..read]);
    }
    let after = file
        .metadata()
        .map_err(|_| RenamePlanningFactsError::NotRegularFile)?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || bytes != after.len()
    {
        return Err(RenamePlanningFactsError::CatalogStale);
    }
    ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
        .map(|hash| (bytes, hash))
        .map_err(|_| RenamePlanningFactsError::InternalError)
}

fn open_regular_file_nofollow(path: &Path) -> Result<File, RenamePlanningFactsError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|_| RenamePlanningFactsError::NotRegularFile)
    }
    #[cfg(not(unix))]
    {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| RenamePlanningFactsError::NotRegularFile)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(RenamePlanningFactsError::NotRegularFile);
        }
        File::open(path).map_err(|_| RenamePlanningFactsError::NotRegularFile)
    }
}

fn path_parent(relative: &str) -> &str {
    relative
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
}

fn path_basename(relative: &str) -> Option<&str> {
    relative.rsplit('/').next()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::root_registry::RootRegistry;
    use ot_domain::SampleStorageScope;
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::TempDir;

    struct StableIdentity;

    impl crate::root_registry::DeviceIdentityProvider for StableIdentity {
        fn observe(
            &self,
            _root: &Path,
        ) -> Result<crate::root_registry::DeviceObservation, RootRegistryError> {
            Ok(crate::root_registry::DeviceObservation {
                stable_key: "fixture-volume".into(),
                filesystem_type: Some("fixturefs".into()),
                total_capacity: Some(4096),
                mount_token: "fixture-mount".into(),
                stable: true,
            })
        }
    }

    fn resolved(root: &Path) -> ResolvedRoot {
        let registry = RootRegistry::new(Arc::new(StableIdentity), Duration::from_secs(60));
        let session = registry.register(root.to_str().unwrap()).unwrap();
        registry.resolve(&session.root_id).unwrap()
    }

    fn file_instance(path: &str, hash_seed: u8) -> FileInstance {
        let hash = format!("sha256:{hash_seed:0>64x}");
        FileInstance {
            relative_path: RootRelativePath::parse(path).unwrap(),
            content_hash: ContentHash::parse(hash).unwrap(),
            byte_size: 100,
            modified_at_unix_ns: None,
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        }
    }

    #[test]
    fn cross_directory_destination_is_rejected_before_facts_build() {
        let source = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let destination = RootRelativePath::parse("SET/AUDIO/sub/kick.wav").unwrap();
        assert!(matches!(
            ensure_same_directory_rename(&source, &destination),
            Err(RenamePlanningFactsError::InvalidDestinationPath(_))
        ));
    }

    #[test]
    fn stale_catalog_hash_is_detected() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("SET/AUDIO")).unwrap();
        let wav = temp.path().join("SET/AUDIO/kick.wav");
        fs::write(&wav, vec![0_u8; 100]).unwrap();
        let resolved = resolved(temp.path());
        let mut source = file_instance("SET/AUDIO/kick.wav", 1);
        source.content_hash = ContentHash::parse(format!("sha256:{}", "f".repeat(64))).unwrap();
        let destination = RootRelativePath::parse("SET/AUDIO/kick-2.wav").unwrap();
        assert_eq!(
            build_rename_planning_facts(
                &resolved,
                &LibrarySnapshot::default(),
                1,
                &source,
                destination,
            ),
            Err(RenamePlanningFactsError::CatalogStale)
        );
    }
}
