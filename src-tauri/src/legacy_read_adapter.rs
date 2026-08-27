use crate::device_detection::{scan_directory, OctatrackProject};
use crate::project_reader::{compute_sample_usage_for_documents, read_raw_sample_fields};
use ot_domain::{
    AudioAsset, ContentHash, ContentHashFreshness, FileInstance, LibraryProject, LibrarySet,
    LibrarySnapshot, ParserProvenance, RootId, RootRelativePath, SampleReferenceStatus,
    SampleSettings, SampleSettingsEvidence, SampleSettingsOwner, SampleSettingsParseStatus,
    SampleSlice, SampleSlotId, SampleSlotKind, SampleStorageScope, SampleUsageEdge,
    SampleUsageKind, SlotAssignment, StateDocument, StateDocumentKind, StateDocumentParseStatus,
    StateDocumentRole,
};
use ot_storage_ports::{ReadOnlyLibrary, StorageError};
use ot_tools_io::banks::BANK_FILE_VERSION;
use ot_tools_io::{
    BankFile, HasChecksumField, HasFileVersionField, HasHeaderField, MarkersFile, OctatrackFileIO,
    ProjectFile, SampleSettingsFile,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

pub struct RegisteredLegacyLibrary {
    root_id: RootId,
    canonical_root: PathBuf,
    baseline: Vec<FileInstance>,
}

impl RegisteredLegacyLibrary {
    pub fn new(root_id: RootId, canonical_root: PathBuf, baseline: Vec<FileInstance>) -> Self {
        Self {
            root_id,
            canonical_root,
            baseline,
        }
    }
}

impl ReadOnlyLibrary for RegisteredLegacyLibrary {
    fn list_library(&self, root_id: &RootId) -> Result<LibrarySnapshot, StorageError> {
        if root_id != &self.root_id {
            return Err(StorageError::new("ROOT_NOT_APPROVED: root id mismatch"));
        }
        scan_registered_root(&self.canonical_root, &self.baseline)
    }
}

fn scan_registered_root(
    canonical_root: &Path,
    baseline: &[FileInstance],
) -> Result<LibrarySnapshot, StorageError> {
    let root = canonical_root
        .to_str()
        .ok_or_else(|| StorageError::new("UNSUPPORTED_FORMAT: root path is not valid UTF-8"))?;
    let legacy = scan_directory(root);
    let mut seen_sets = HashSet::new();
    let mut sets = Vec::new();

    for location in legacy.locations {
        for legacy_set in location.sets {
            let relative_path = checked_relative_path(canonical_root, Path::new(&legacy_set.path))?;
            if !seen_sets.insert(relative_path.as_str().to_owned()) {
                continue;
            }
            let mut projects = legacy_set
                .projects
                .into_iter()
                .map(|project| map_project(canonical_root, project))
                .collect::<Result<Vec<_>, _>>()?;
            projects.sort_by(|left, right| {
                left.relative_path
                    .as_str()
                    .cmp(right.relative_path.as_str())
            });
            sets.push(LibrarySet {
                display_name: legacy_set.name,
                relative_path,
                has_audio_pool: legacy_set.has_audio_pool,
                projects,
            });
        }
    }
    sets.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });

    let mut seen_projects = HashSet::new();
    let mut standalone_projects = Vec::new();
    for project in legacy.standalone_projects {
        let project = map_project(canonical_root, project)?;
        if seen_projects.insert(project.relative_path.as_str().to_owned()) {
            standalone_projects.push(project);
        }
    }
    standalone_projects.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });

    let mut snapshot = LibrarySnapshot {
        sets,
        standalone_projects,
        ..LibrarySnapshot::default()
    };
    let (audio_assets, file_instances) = scan_audio_inventory(canonical_root, &snapshot, baseline)?;
    snapshot.audio_assets = audio_assets;
    snapshot.file_instances = file_instances;
    let (state_documents, slot_assignments, usage_edges) =
        scan_state_inventory(canonical_root, &snapshot)?;
    snapshot.state_documents = state_documents;
    snapshot.slot_assignments = slot_assignments;
    snapshot.usage_edges = usage_edges;
    snapshot.sample_settings = scan_sample_settings(canonical_root, &snapshot)?;
    Ok(snapshot)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileMetadataObservation {
    byte_size: u64,
    modified_at_unix_ns: Option<i64>,
}

fn scan_audio_inventory(
    canonical_root: &Path,
    topology: &LibrarySnapshot,
    baseline: &[FileInstance],
) -> Result<(Vec<AudioAsset>, Vec<FileInstance>), StorageError> {
    scan_audio_inventory_with(canonical_root, topology, baseline, &mut |path, expected| {
        hash_regular_file(path, expected)
    })
}

fn scan_audio_inventory_with<F>(
    canonical_root: &Path,
    topology: &LibrarySnapshot,
    baseline: &[FileInstance],
    hasher: &mut F,
) -> Result<(Vec<AudioAsset>, Vec<FileInstance>), StorageError>
where
    F: FnMut(&Path, FileMetadataObservation) -> Result<ContentHash, StorageError>,
{
    let baseline_by_path = baseline
        .iter()
        .map(|instance| (instance.relative_path.as_str(), instance))
        .collect::<HashMap<_, _>>();
    let mut candidates = Vec::new();
    collect_audio_candidates(
        canonical_root,
        canonical_root,
        &mut Vec::new(),
        &mut candidates,
    )?;
    candidates.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));

    let mut file_instances = Vec::with_capacity(candidates.len());
    let mut assets = BTreeMap::<String, AudioAsset>::new();
    for (relative_path, absolute_path, observed) in candidates {
        let (content_hash, hash_freshness) =
            match baseline_by_path.get(relative_path.as_str()).copied() {
                Some(previous) if can_reuse_hash(observed, previous) => {
                    verify_unchanged_regular_file(&absolute_path, observed)?;
                    (
                        previous.content_hash.clone(),
                        ContentHashFreshness::ReusedUnchangedMetadata,
                    )
                }
                _ => (
                    hasher(&absolute_path, observed)?,
                    ContentHashFreshness::ComputedThisScan,
                ),
            };
        let storage_scope = classify_storage_scope(&relative_path, topology);
        assets
            .entry(content_hash.as_str().to_owned())
            .or_insert_with(|| AudioAsset {
                content_hash: content_hash.clone(),
                byte_size: observed.byte_size,
            });
        file_instances.push(FileInstance {
            relative_path,
            content_hash,
            byte_size: observed.byte_size,
            modified_at_unix_ns: observed.modified_at_unix_ns,
            storage_scope,
            hash_freshness,
        });
    }

    Ok((assets.into_values().collect(), file_instances))
}

fn collect_audio_candidates(
    canonical_root: &Path,
    directory: &Path,
    components: &mut Vec<String>,
    candidates: &mut Vec<(RootRelativePath, PathBuf, FileMetadataObservation)>,
) -> Result<(), StorageError> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        components.push(name.clone());
        if metadata.file_type().is_dir() {
            collect_audio_candidates(canonical_root, &path, components, candidates)?;
        } else if metadata.file_type().is_file() && is_inventory_audio_file(&name) {
            let canonical = path
                .canonicalize()
                .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
            if !canonical.starts_with(canonical_root) {
                return Err(StorageError::new(
                    "PATH_ESCAPE: audio candidate left its registered root",
                ));
            }
            let relative_path = RootRelativePath::from_components(components.iter())
                .map_err(|error| StorageError::new(format!("PATH_ESCAPE: {error}")))?;
            candidates.push((
                relative_path,
                path,
                FileMetadataObservation {
                    byte_size: metadata.len(),
                    modified_at_unix_ns: modified_at_unix_ns(&metadata),
                },
            ));
        }
        components.pop();
    }
    Ok(())
}

fn is_inventory_audio_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("wav")
                || extension.eq_ignore_ascii_case("aif")
                || extension.eq_ignore_ascii_case("aiff")
        })
}

fn modified_at_unix_ns(metadata: &fs::Metadata) -> Option<i64> {
    let modified = metadata.modified().ok()?;
    match modified.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_nanos()).ok(),
        Err(error) => i64::try_from(error.duration().as_nanos())
            .ok()
            .and_then(|value| value.checked_neg()),
    }
}

fn can_reuse_hash(current: FileMetadataObservation, previous: &FileInstance) -> bool {
    current.modified_at_unix_ns.is_some()
        && current.byte_size == previous.byte_size
        && current.modified_at_unix_ns == previous.modified_at_unix_ns
}

fn verify_unchanged_regular_file(
    path: &Path,
    expected: FileMetadataObservation,
) -> Result<(), StorageError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_file()
        || metadata_observation(&metadata) != expected
    {
        return Err(StorageError::new(
            "LIBRARY_SCAN_FAILED: audio file changed during incremental scan",
        ));
    }
    Ok(())
}
fn hash_regular_file(
    path: &Path,
    expected: FileMetadataObservation,
) -> Result<ContentHash, StorageError> {
    hash_regular_file_with_hook(path, expected, |_| {})
}

fn hash_regular_file_with_hook<F>(
    path: &Path,
    expected: FileMetadataObservation,
    after_read: F,
) -> Result<ContentHash, StorageError>
where
    F: FnOnce(&Path),
{
    let before = fs::symlink_metadata(path)
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
    if !before.file_type().is_file() || before.file_type().is_symlink() {
        return Err(StorageError::new(
            "SYMLINK_ESCAPE: audio candidate is no longer a regular file",
        ));
    }
    if metadata_observation(&before) != expected {
        return Err(StorageError::new(
            "LIBRARY_SCAN_FAILED: audio file changed before hashing",
        ));
    }

    let file = fs::File::open(path)
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
    let mut reader = BufReader::new(file);
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }

    after_read(path);
    let after = fs::symlink_metadata(path)
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))?;
    if !after.file_type().is_file()
        || after.file_type().is_symlink()
        || metadata_observation(&after) != expected
    {
        return Err(StorageError::new(
            "LIBRARY_SCAN_FAILED: audio file changed while hashing",
        ));
    }
    let lowercase_hex = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    ContentHash::parse(format!("sha256:{lowercase_hex}"))
        .map_err(|error| StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}")))
}

fn metadata_observation(metadata: &fs::Metadata) -> FileMetadataObservation {
    FileMetadataObservation {
        byte_size: metadata.len(),
        modified_at_unix_ns: modified_at_unix_ns(metadata),
    }
}

fn classify_storage_scope(
    relative_path: &RootRelativePath,
    topology: &LibrarySnapshot,
) -> SampleStorageScope {
    let candidate = relative_path.as_str().split('/').collect::<Vec<_>>();
    for set in &topology.sets {
        let set_components = set.relative_path.as_str().split('/').collect::<Vec<_>>();
        if candidate.len() > set_components.len() + 1
            && candidate.starts_with(&set_components)
            && candidate[set_components.len()] == "AUDIO"
        {
            return SampleStorageScope::SetAudioPool;
        }
    }
    let project_paths = topology
        .sets
        .iter()
        .flat_map(|set| set.projects.iter())
        .chain(topology.standalone_projects.iter());
    for project in project_paths {
        let project_components = project
            .relative_path
            .as_str()
            .split('/')
            .collect::<Vec<_>>();
        if candidate.len() > project_components.len() && candidate.starts_with(&project_components)
        {
            return SampleStorageScope::ProjectLocal;
        }
    }
    SampleStorageScope::Unclassified
}

const STATE_PARSER_NAME: &str = "masterocta/ot-tools-io";
const STATE_PARSER_REVISION: &str = "cd246d8a595647364eb4cc78211033b2d1302526";

type StateInventory = (
    Vec<StateDocument>,
    Vec<SlotAssignment>,
    Vec<SampleUsageEdge>,
);

fn scan_state_inventory(
    canonical_root: &Path,
    topology: &LibrarySnapshot,
) -> Result<StateInventory, StorageError> {
    let inventory_paths = topology
        .file_instances
        .iter()
        .map(|instance| instance.relative_path.as_str().to_owned())
        .collect::<HashSet<_>>();
    let mut projects = topology
        .sets
        .iter()
        .flat_map(|set| set.projects.iter())
        .chain(topology.standalone_projects.iter())
        .collect::<Vec<_>>();
    projects.sort_by(|left, right| {
        left.relative_path
            .as_str()
            .cmp(right.relative_path.as_str())
    });

    let mut state_documents = Vec::new();
    let mut slot_assignments = Vec::new();
    let mut usage_edges = Vec::new();
    let mut assignment_lookup = HashMap::<(String, SampleSlotKind, u16), SlotAssignment>::new();

    for project in projects {
        let project_directory = resolve_relative_for_read(canonical_root, &project.relative_path)?;
        for (role, extension) in [
            (StateDocumentRole::Working, "work"),
            (StateDocumentRole::SavedCheckpoint, "strd"),
        ] {
            let project_file_name = format!("project.{extension}");
            let project_source = join_relative(&project.relative_path, &project_file_name)?;
            let project_file = project_directory.join(&project_file_name);
            let mut parsed_project_source = None;

            if is_regular_source_file(canonical_root, &project_file)? {
                let (parse_status, provenance, assignments) = parse_project_state(
                    &project.relative_path,
                    &project_source,
                    &project_file,
                    &inventory_paths,
                );
                if parse_status == StateDocumentParseStatus::Parsed {
                    parsed_project_source = Some(project_source.clone());
                    for assignment in assignments {
                        assignment_lookup.insert(
                            (
                                project_source.as_str().to_owned(),
                                assignment.slot.kind(),
                                assignment.slot.number(),
                            ),
                            assignment.clone(),
                        );
                        slot_assignments.push(assignment);
                    }
                }
                state_documents.push(StateDocument {
                    project_relative_path: project.relative_path.clone(),
                    source_relative_path: project_source.clone(),
                    kind: StateDocumentKind::Project,
                    role,
                    bank_index: None,
                    parse_status,
                    parser_provenance: provenance,
                });
            }

            for bank_index in 0..16_u8 {
                let bank_file_name = format!("bank{:02}.{extension}", bank_index + 1);
                let bank_source = join_relative(&project.relative_path, &bank_file_name)?;
                let bank_file = project_directory.join(&bank_file_name);
                if !is_regular_source_file(canonical_root, &bank_file)? {
                    continue;
                }

                let (mut parse_status, provenance) = parse_bank_state(&bank_file);
                if parse_status == StateDocumentParseStatus::Parsed {
                    if let Some(project_source) = &parsed_project_source {
                        match compute_sample_usage_for_documents(
                            &project_file,
                            &bank_file,
                            bank_index,
                        ) {
                            Ok(usage) => {
                                append_usage_edges(
                                    &bank_source,
                                    project_source,
                                    &usage.static_usage,
                                    SampleSlotKind::Static,
                                    &assignment_lookup,
                                    &mut usage_edges,
                                );
                                append_usage_edges(
                                    &bank_source,
                                    project_source,
                                    &usage.flex_usage,
                                    SampleSlotKind::Flex,
                                    &assignment_lookup,
                                    &mut usage_edges,
                                );
                            }
                            Err(_) => parse_status = StateDocumentParseStatus::Malformed,
                        }
                    }
                }
                state_documents.push(StateDocument {
                    project_relative_path: project.relative_path.clone(),
                    source_relative_path: bank_source,
                    kind: StateDocumentKind::Bank,
                    role,
                    bank_index: Some(bank_index),
                    parse_status,
                    parser_provenance: provenance,
                });
            }
        }
    }

    state_documents.sort_by(|left, right| {
        left.source_relative_path
            .as_str()
            .cmp(right.source_relative_path.as_str())
    });
    slot_assignments.sort_by(|left, right| {
        (
            left.project_document_relative_path.as_str(),
            slot_kind_order(left.slot.kind()),
            left.slot.number(),
        )
            .cmp(&(
                right.project_document_relative_path.as_str(),
                slot_kind_order(right.slot.kind()),
                right.slot.number(),
            ))
    });
    usage_edges.sort_by(|left, right| {
        (
            left.bank_document_relative_path.as_str(),
            slot_kind_order(left.slot.kind()),
            left.slot.number(),
            left.track_index,
            left.part_index,
            left.pattern_index,
            left.step_index,
        )
            .cmp(&(
                right.bank_document_relative_path.as_str(),
                slot_kind_order(right.slot.kind()),
                right.slot.number(),
                right.track_index,
                right.part_index,
                right.pattern_index,
                right.step_index,
            ))
    });
    Ok((state_documents, slot_assignments, usage_edges))
}

fn scan_sample_settings(
    canonical_root: &Path,
    snapshot: &LibrarySnapshot,
) -> Result<Vec<SampleSettings>, StorageError> {
    let mut settings = scan_slot_local_settings(canonical_root, snapshot)?;
    settings.extend(scan_file_sidecar_settings(canonical_root, snapshot)?);
    settings.sort_by(|left, right| {
        (
            settings_owner_order(left.owner),
            left.source_relative_path.as_str(),
            left.slot.map(|slot| slot_kind_order(slot.kind())),
            left.slot.map(SampleSlotId::number),
        )
            .cmp(&(
                settings_owner_order(right.owner),
                right.source_relative_path.as_str(),
                right.slot.map(|slot| slot_kind_order(slot.kind())),
                right.slot.map(SampleSlotId::number),
            ))
    });
    Ok(settings)
}

fn scan_slot_local_settings(
    canonical_root: &Path,
    snapshot: &LibrarySnapshot,
) -> Result<Vec<SampleSettings>, StorageError> {
    let mut output = Vec::new();
    for document in snapshot.state_documents.iter().filter(|document| {
        document.kind == StateDocumentKind::Project
            && document.parse_status == StateDocumentParseStatus::Parsed
    }) {
        let source_file =
            resolve_relative_for_read(canonical_root, &document.source_relative_path)?;
        let raw_fields = read_raw_sample_fields(&source_file);
        let marker_name = match document.role {
            StateDocumentRole::Working => "markers.work",
            StateDocumentRole::SavedCheckpoint => "markers.strd",
        };
        let marker_relative = join_relative(&document.project_relative_path, marker_name)?;
        let marker_file = source_file.with_file_name(marker_name);
        let (markers, marker_status, marker_source) =
            read_markers_source(canonical_root, &marker_file, marker_relative)?;

        for assignment in snapshot.slot_assignments.iter().filter(|assignment| {
            assignment.project_document_relative_path == document.source_relative_path
        }) {
            let mut sample_settings = empty_sample_settings(
                SampleSettingsOwner::SlotAssignment,
                document.source_relative_path.clone(),
                document.parser_provenance.clone(),
                document.parser_provenance.source_version.clone(),
            );
            sample_settings.project_document_relative_path =
                Some(document.source_relative_path.clone());
            sample_settings.slot = Some(assignment.slot);
            sample_settings.marker_source_relative_path = marker_source.clone();
            let Ok(raw_fields) = &raw_fields else {
                sample_settings.parse_status = SampleSettingsParseStatus::Malformed;
                output.push(sample_settings);
                continue;
            };
            let Some(fields) = raw_fields.get(&(
                match assignment.slot.kind() {
                    SampleSlotKind::Static => "STATIC".to_owned(),
                    SampleSlotKind::Flex => "FLEX".to_owned(),
                },
                assignment.slot.number(),
            )) else {
                sample_settings.parse_status = SampleSettingsParseStatus::Malformed;
                output.push(sample_settings);
                continue;
            };
            if let Some(status) = marker_status {
                sample_settings.parse_status = status;
                output.push(sample_settings);
                continue;
            }
            if apply_raw_slot_fields(&mut sample_settings, fields).is_err() {
                sample_settings.parse_status = SampleSettingsParseStatus::Malformed;
                clear_decoded_settings(&mut sample_settings);
                output.push(sample_settings);
                continue;
            }
            if let Some(markers) = &markers {
                let slot_index = usize::from(assignment.slot.number() - 1);
                let slot_markers = match assignment.slot.kind() {
                    SampleSlotKind::Static => &markers.static_slots[slot_index],
                    SampleSlotKind::Flex => &markers.flex_slots[slot_index],
                };
                sample_settings.trim_start = Some(slot_markers.trim_offset);
                sample_settings.trim_end = Some(slot_markers.trim_end);
                sample_settings.loop_start = Some(slot_markers.loop_point);
                sample_settings.slices = slot_markers
                    .slices
                    .iter()
                    .take(slot_markers.slice_count as usize)
                    .enumerate()
                    .map(|(index, slice)| SampleSlice {
                        index: index as u8,
                        trim_start: slice.trim_start,
                        trim_end: slice.trim_end,
                        loop_start: slice.loop_start,
                    })
                    .collect();
            }
            output.push(sample_settings);
        }
    }
    Ok(output)
}

type MarkersSourceRead = (
    Option<MarkersFile>,
    Option<SampleSettingsParseStatus>,
    Option<RootRelativePath>,
);

fn read_markers_source(
    canonical_root: &Path,
    marker_file: &Path,
    marker_relative: RootRelativePath,
) -> Result<MarkersSourceRead, StorageError> {
    if !is_regular_source_file(canonical_root, marker_file)? {
        return Ok((None, None, None));
    }
    let markers = match MarkersFile::from_data_file(marker_file) {
        Ok(markers) => markers,
        Err(_) => {
            return Ok((
                None,
                Some(SampleSettingsParseStatus::Malformed),
                Some(marker_relative),
            ))
        }
    };
    if !markers.check_file_version().unwrap_or(false) {
        return Ok((
            None,
            Some(SampleSettingsParseStatus::UnsupportedVersion),
            Some(marker_relative),
        ));
    }
    if !markers.check_header().unwrap_or(false)
        || !markers.check_checksum().unwrap_or(false)
        || markers.validate().is_err()
    {
        return Ok((
            None,
            Some(SampleSettingsParseStatus::Malformed),
            Some(marker_relative),
        ));
    }
    Ok((Some(markers), None, Some(marker_relative)))
}

fn scan_file_sidecar_settings(
    canonical_root: &Path,
    snapshot: &LibrarySnapshot,
) -> Result<Vec<SampleSettings>, StorageError> {
    let mut by_sidecar = BTreeMap::<String, Vec<&FileInstance>>::new();
    for instance in &snapshot.file_instances {
        let Some((stem, _extension)) = instance.relative_path.as_str().rsplit_once('.') else {
            continue;
        };
        by_sidecar
            .entry(format!("{stem}.ot"))
            .or_default()
            .push(instance);
    }
    let mut output = Vec::new();
    for (sidecar_path, owners) in by_sidecar {
        let sidecar_relative = RootRelativePath::parse(&sidecar_path)
            .map_err(|error| StorageError::new(format!("PATH_ESCAPE: {error}")))?;
        let audio_file = resolve_relative_for_read(canonical_root, &owners[0].relative_path)?;
        let sidecar_file = audio_file.with_extension("ot");
        if !is_regular_source_file(canonical_root, &sidecar_file)? {
            continue;
        }
        if owners.len() != 1 {
            return Err(StorageError::new(
                "UNSUPPORTED_FORMAT: one .ot sidecar matched multiple audio files",
            ));
        }
        output.push(parse_sidecar_settings(
            &sidecar_file,
            sidecar_relative,
            owners[0].relative_path.clone(),
        ));
    }
    Ok(output)
}

fn parse_sidecar_settings(
    sidecar_file: &Path,
    sidecar_relative: RootRelativePath,
    file_instance_relative: RootRelativePath,
) -> SampleSettings {
    let parsed = match SampleSettingsFile::from_data_file(sidecar_file) {
        Ok(parsed) => parsed,
        Err(_) => {
            let mut settings = empty_sample_settings(
                SampleSettingsOwner::FileInstanceSidecar,
                sidecar_relative,
                parser_provenance(None),
                None,
            );
            settings.file_instance_relative_path = Some(file_instance_relative);
            settings.parse_status = SampleSettingsParseStatus::Malformed;
            return settings;
        }
    };
    let source_version = Some(format!("sample-settings:{}", parsed.datatype_version));
    let mut settings = empty_sample_settings(
        SampleSettingsOwner::FileInstanceSidecar,
        sidecar_relative,
        parser_provenance(source_version),
        None,
    );
    settings.file_instance_relative_path = Some(file_instance_relative);
    if !parsed.check_file_version().unwrap_or(false) {
        settings.parse_status = SampleSettingsParseStatus::UnsupportedVersion;
        return settings;
    }
    if parsed.validate().is_err() {
        settings.parse_status = SampleSettingsParseStatus::Malformed;
        return settings;
    }
    settings.gain = Some(parsed.gain);
    settings.tempo_x24 = Some(parsed.tempo);
    settings.trim_bars_x100 = Some(parsed.trim_bar_len);
    settings.loop_bars_x100 = Some(parsed.loop_bar_len);
    settings.stretch_mode = Some(parsed.stretch);
    settings.loop_mode = Some(parsed.loop_mode);
    settings.trig_quantization = Some(i32::from(parsed.quantization));
    settings.trim_start = Some(parsed.trim_start);
    settings.trim_end = Some(parsed.trim_end);
    settings.loop_start = Some(parsed.loop_start);
    settings.slices = parsed
        .slices
        .iter()
        .take(parsed.slices_len as usize)
        .enumerate()
        .map(|(index, slice)| SampleSlice {
            index: index as u8,
            trim_start: slice.trim_start,
            trim_end: slice.trim_end,
            loop_start: slice.loop_start,
        })
        .collect();
    settings
}

fn empty_sample_settings(
    owner: SampleSettingsOwner,
    source_relative_path: RootRelativePath,
    parser_provenance: ParserProvenance,
    source_os_version: Option<String>,
) -> SampleSettings {
    SampleSettings {
        owner,
        source_relative_path,
        marker_source_relative_path: None,
        project_document_relative_path: None,
        slot: None,
        file_instance_relative_path: None,
        parse_status: SampleSettingsParseStatus::Parsed,
        parser_provenance,
        source_os_version,
        evidence: SampleSettingsEvidence::LegacyImplementationObservation,
        gain: None,
        tempo_x24: None,
        trim_bars_x100: None,
        loop_bars_x100: None,
        stretch_mode: None,
        loop_mode: None,
        trig_quantization: None,
        trim_start: None,
        trim_end: None,
        loop_start: None,
        slices: Vec::new(),
    }
}

fn apply_raw_slot_fields(
    settings: &mut SampleSettings,
    fields: &HashMap<String, String>,
) -> Result<(), ()> {
    settings.gain = parse_optional(fields, "GAIN")?;
    settings.tempo_x24 = parse_optional(fields, "BPMX24")?;
    settings.trim_bars_x100 = parse_optional(fields, "TRIM_BARSX100")?;
    settings.stretch_mode = parse_optional(fields, "TSMODE")?;
    settings.loop_mode = parse_optional(fields, "LOOPMODE")?;
    settings.trig_quantization = parse_optional(fields, "TRIGQUANTIZATION")?;
    Ok(())
}

fn parse_optional<T>(fields: &HashMap<String, String>, key: &str) -> Result<Option<T>, ()>
where
    T: std::str::FromStr,
{
    fields
        .get(key)
        .map(|value| value.parse::<T>().map_err(|_| ()))
        .transpose()
}

fn clear_decoded_settings(settings: &mut SampleSettings) {
    settings.gain = None;
    settings.tempo_x24 = None;
    settings.trim_bars_x100 = None;
    settings.loop_bars_x100 = None;
    settings.stretch_mode = None;
    settings.loop_mode = None;
    settings.trig_quantization = None;
    settings.trim_start = None;
    settings.trim_end = None;
    settings.loop_start = None;
    settings.slices.clear();
}

fn settings_owner_order(owner: SampleSettingsOwner) -> u8 {
    match owner {
        SampleSettingsOwner::SlotAssignment => 0,
        SampleSettingsOwner::FileInstanceSidecar => 1,
    }
}

fn parse_project_state(
    project_relative_path: &RootRelativePath,
    source_relative_path: &RootRelativePath,
    source_file: &Path,
    inventory_paths: &HashSet<String>,
) -> (
    StateDocumentParseStatus,
    ParserProvenance,
    Vec<SlotAssignment>,
) {
    let parsed = match ProjectFile::from_data_file(source_file) {
        Ok(parsed) => parsed,
        Err(_) => {
            return (
                StateDocumentParseStatus::Malformed,
                parser_provenance(None),
                Vec::new(),
            )
        }
    };
    let source_version = Some(parsed.metadata.os_version.clone());
    match parsed.check_compatible_os_version() {
        Ok(true) => {}
        Ok(false) => {
            return (
                StateDocumentParseStatus::UnsupportedVersion,
                parser_provenance(source_version),
                Vec::new(),
            )
        }
        Err(_) => {
            return (
                StateDocumentParseStatus::Malformed,
                parser_provenance(source_version),
                Vec::new(),
            )
        }
    }
    let raw_fields = match read_raw_sample_fields(source_file) {
        Ok(fields) => fields,
        Err(_) => {
            return (
                StateDocumentParseStatus::Malformed,
                parser_provenance(source_version),
                Vec::new(),
            )
        }
    };
    let mut fields = raw_fields.into_iter().collect::<Vec<_>>();
    fields.sort_by(|left, right| left.0.cmp(&right.0));
    let mut assignments = Vec::new();
    for ((slot_type, slot_number), fields) in fields {
        let Some(path) = fields.get("PATH").filter(|path| !path.is_empty()) else {
            continue;
        };
        let Some(slot_kind) = parse_slot_kind(&slot_type) else {
            return (
                StateDocumentParseStatus::Malformed,
                parser_provenance(source_version),
                Vec::new(),
            );
        };
        let slot = match SampleSlotId::new(slot_kind, slot_number) {
            Ok(slot) => slot,
            Err(_) => {
                return (
                    StateDocumentParseStatus::Malformed,
                    parser_provenance(source_version),
                    Vec::new(),
                )
            }
        };
        let (referenced_file_relative_path, reference_status) =
            match resolve_project_reference(project_relative_path, path) {
                Ok(target) if inventory_paths.contains(target.as_str()) => {
                    (Some(target), SampleReferenceStatus::Resolved)
                }
                Ok(target) => (Some(target), SampleReferenceStatus::Missing),
                Err(()) => (None, SampleReferenceStatus::InvalidPath),
            };
        assignments.push(SlotAssignment {
            project_document_relative_path: source_relative_path.clone(),
            slot,
            referenced_file_relative_path,
            reference_status,
        });
    }
    (
        StateDocumentParseStatus::Parsed,
        parser_provenance(source_version),
        assignments,
    )
}

fn parse_bank_state(source_file: &Path) -> (StateDocumentParseStatus, ParserProvenance) {
    match BankFile::from_data_file(source_file) {
        Ok(bank) => {
            let source_version = Some(format!("bank:{}", bank.datatype_version));
            let status = if bank.datatype_version == BANK_FILE_VERSION {
                StateDocumentParseStatus::Parsed
            } else {
                StateDocumentParseStatus::UnsupportedVersion
            };
            (status, parser_provenance(source_version))
        }
        Err(_) => (StateDocumentParseStatus::Malformed, parser_provenance(None)),
    }
}

fn parser_provenance(source_version: Option<String>) -> ParserProvenance {
    ParserProvenance {
        parser_name: STATE_PARSER_NAME.into(),
        parser_revision: STATE_PARSER_REVISION.into(),
        source_version,
    }
}

fn parse_slot_kind(value: &str) -> Option<SampleSlotKind> {
    match value.to_ascii_uppercase().as_str() {
        "STATIC" => Some(SampleSlotKind::Static),
        "FLEX" => Some(SampleSlotKind::Flex),
        _ => None,
    }
}

fn append_usage_edges(
    bank_source: &RootRelativePath,
    project_source: &RootRelativePath,
    usage_by_slot: &[Vec<crate::project_reader::SlotUsageEntry>],
    slot_kind: SampleSlotKind,
    assignments: &HashMap<(String, SampleSlotKind, u16), SlotAssignment>,
    output: &mut Vec<SampleUsageEdge>,
) {
    for (slot_index, entries) in usage_by_slot.iter().enumerate() {
        let Ok(slot_number) = u16::try_from(slot_index + 1) else {
            continue;
        };
        let Ok(slot) = SampleSlotId::new(slot_kind, slot_number) else {
            continue;
        };
        let assignment =
            assignments.get(&(project_source.as_str().to_owned(), slot_kind, slot_number));
        for entry in entries {
            let (referenced_file_relative_path, reference_status) = assignment
                .map(|assignment| {
                    (
                        assignment.referenced_file_relative_path.clone(),
                        assignment.reference_status,
                    )
                })
                .unwrap_or((None, SampleReferenceStatus::UnassignedSlot));
            let usage_kind = match entry.kind.as_str() {
                "machine" => SampleUsageKind::Machine,
                "lock" => SampleUsageKind::SampleLock,
                _ => continue,
            };
            output.push(SampleUsageEdge {
                bank_document_relative_path: bank_source.clone(),
                project_document_relative_path: project_source.clone(),
                slot,
                usage_kind,
                track_index: entry.track,
                part_index: entry.part,
                pattern_index: entry.pattern,
                step_index: entry.step,
                audible: entry.audible,
                referenced_file_relative_path,
                reference_status,
            });
        }
    }
}

fn resolve_project_reference(
    project_relative_path: &RootRelativePath,
    raw_reference: &str,
) -> Result<RootRelativePath, ()> {
    let bytes = raw_reference.as_bytes();
    if raw_reference.starts_with(['/', '\\'])
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || raw_reference.contains('\0')
    {
        return Err(());
    }
    let mut components = project_relative_path
        .as_str()
        .split('/')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for component in raw_reference.split(['/', '\\']) {
        match component {
            "" => return Err(()),
            "." => {}
            ".." => {
                if components.pop().is_none() {
                    return Err(());
                }
            }
            component => components.push(component.to_owned()),
        }
    }
    RootRelativePath::from_components(components).map_err(|_| ())
}

fn join_relative(parent: &RootRelativePath, child: &str) -> Result<RootRelativePath, StorageError> {
    RootRelativePath::from_components(parent.as_str().split('/').chain([child]))
        .map_err(|error| StorageError::new(format!("PATH_ESCAPE: {error}")))
}

fn is_regular_source_file(canonical_root: &Path, path: &Path) -> Result<bool, StorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}"))),
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Ok(false);
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
    if !canonical.starts_with(canonical_root) {
        return Err(StorageError::new(
            "PATH_ESCAPE: state document left its registered root",
        ));
    }
    Ok(true)
}

fn slot_kind_order(kind: SampleSlotKind) -> u8 {
    match kind {
        SampleSlotKind::Static => 0,
        SampleSlotKind::Flex => 1,
    }
}

fn map_project(
    canonical_root: &Path,
    project: OctatrackProject,
) -> Result<LibraryProject, StorageError> {
    Ok(LibraryProject {
        display_name: project.name,
        relative_path: checked_relative_path(canonical_root, Path::new(&project.path))?,
        has_project_file: project.has_project_file,
        has_banks: project.has_banks,
    })
}

fn checked_relative_path(root: &Path, candidate: &Path) -> Result<RootRelativePath, StorageError> {
    let canonical = candidate
        .canonicalize()
        .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
    let relative = canonical
        .strip_prefix(root)
        .map_err(|_| StorageError::new("PATH_ESCAPE: scanned path left its registered root"))?;
    relative_path_from_path(relative)
}

fn relative_path_from_path(path: &Path) -> Result<RootRelativePath, StorageError> {
    let components = path
        .components()
        .map(|component| match component {
            Component::Normal(component) => component
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| StorageError::new("UNSUPPORTED_FORMAT: path is not valid UTF-8")),
            _ => Err(StorageError::new(
                "PATH_ESCAPE: path contains a non-relative component",
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    RootRelativePath::from_components(components)
        .map_err(|error| StorageError::new(format!("PATH_ESCAPE: {error}")))
}

pub(crate) fn resolve_relative_for_read(
    root: &Path,
    relative: &RootRelativePath,
) -> Result<PathBuf, StorageError> {
    let mut candidate = root.to_path_buf();
    for component in relative.as_str().split('/') {
        candidate.push(component);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
        if metadata.file_type().is_symlink() {
            return Err(StorageError::new(
                "SYMLINK_ESCAPE: symlinks are not valid read targets",
            ));
        }
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
    if !canonical.starts_with(root) {
        return Err(StorageError::new(
            "PATH_ESCAPE: resolved path left its registered root",
        ));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    fn create_project(root: &Path, relative: &str) {
        let project = root.join(relative);
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("project.work"), b"project fixture").unwrap();
        fs::write(project.join("bank01.work"), b"bank fixture").unwrap();
    }

    fn snapshot_files(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        let mut files = BTreeMap::new();
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file() {
                let relative = entry.path().strip_prefix(root).unwrap().to_path_buf();
                files.insert(relative, fs::read(entry.path()).unwrap());
            }
        }
        files
    }

    #[test]
    fn lists_sets_and_projects_without_exposing_absolute_paths() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("LIVE_SET")).unwrap();
        fs::create_dir(root.path().join("LIVE_SET/AUDIO")).unwrap();
        create_project(root.path(), "LIVE_SET/PROJECT_A");
        let canonical_root = root.path().canonicalize().unwrap();

        let snapshot = scan_registered_root(&canonical_root, &[]).unwrap();

        assert_eq!(snapshot.sets.len(), 1);
        assert_eq!(snapshot.sets[0].relative_path.as_str(), "LIVE_SET");
        assert_eq!(
            snapshot.sets[0].projects[0].relative_path.as_str(),
            "LIVE_SET/PROJECT_A"
        );
        assert!(!snapshot.sets[0].projects[0]
            .relative_path
            .as_str()
            .contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn read_only_scan_leaves_every_fixture_byte_unchanged() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("SET")).unwrap();
        fs::create_dir(root.path().join("SET/AUDIO")).unwrap();
        create_project(root.path(), "SET/PROJECT");
        let before = snapshot_files(root.path());
        let canonical_root = root.path().canonicalize().unwrap();

        let _snapshot = scan_registered_root(&canonical_root, &[]).unwrap();

        assert_eq!(snapshot_files(root.path()), before);
    }

    #[test]
    fn path_outside_the_registered_root_is_rejected() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let project = outside.path().join("OUTSIDE_PROJECT");
        fs::create_dir(&project).unwrap();

        let error = checked_relative_path(root.path(), &project).unwrap_err();

        assert!(error.message().starts_with("PATH_ESCAPE:"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected_and_not_scanned() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::create_dir(outside.path().join("OUTSIDE_SET")).unwrap();
        fs::create_dir(outside.path().join("OUTSIDE_SET/AUDIO")).unwrap();
        create_project(outside.path(), "OUTSIDE_SET/PROJECT");
        symlink(
            outside.path().join("OUTSIDE_SET"),
            root.path().join("ESCAPE"),
        )
        .unwrap();

        let snapshot = scan_registered_root(root.path(), &[]).unwrap();
        assert!(snapshot.sets.is_empty());

        let relative = RootRelativePath::parse("ESCAPE/PROJECT/project.work").unwrap();
        let error = resolve_relative_for_read(root.path(), &relative).unwrap_err();
        assert!(error.message().starts_with("SYMLINK_ESCAPE:"));
    }

    fn inventory_topology() -> LibrarySnapshot {
        LibrarySnapshot {
            sets: vec![LibrarySet {
                display_name: "SET".into(),
                relative_path: RootRelativePath::parse("SET").unwrap(),
                has_audio_pool: true,
                projects: vec![LibraryProject {
                    display_name: "PROJECT".into(),
                    relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
                    has_project_file: true,
                    has_banks: true,
                }],
            }],
            standalone_projects: vec![LibraryProject {
                display_name: "STANDALONE".into(),
                relative_path: RootRelativePath::parse("STANDALONE").unwrap(),
                has_project_file: true,
                has_banks: true,
            }],
            ..LibrarySnapshot::default()
        }
    }

    fn test_hash(hex_digit: char) -> ContentHash {
        ContentHash::parse(format!("sha256:{}", hex_digit.to_string().repeat(64))).unwrap()
    }

    fn snapshot_with_static_slot_one() -> LibrarySnapshot {
        let source = RootRelativePath::parse("SET/PROJECT/project.work").unwrap();
        LibrarySnapshot {
            state_documents: vec![StateDocument {
                project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
                source_relative_path: source.clone(),
                kind: StateDocumentKind::Project,
                role: StateDocumentRole::Working,
                bank_index: None,
                parse_status: StateDocumentParseStatus::Parsed,
                parser_provenance: parser_provenance(Some("1.40A".into())),
            }],
            slot_assignments: vec![SlotAssignment {
                project_document_relative_path: source,
                slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
                referenced_file_relative_path: Some(
                    RootRelativePath::parse("SET/AUDIO/missing.wav").unwrap(),
                ),
                reference_status: SampleReferenceStatus::Missing,
            }],
            ..LibrarySnapshot::default()
        }
    }

    #[test]
    fn missing_or_malformed_raw_slot_blocks_are_recorded_as_malformed_rows() {
        for project_contents in [
            "[SAMPLE]\nTYPE=STATIC\nSLOT=2\n[/SAMPLE]\n",
            "[SAMPLE]\nTYPE=STATIC\nSLOT=1\nGAIN=48\n",
        ] {
            let root = TempDir::new().unwrap();
            let project_directory = root.path().join("SET/PROJECT");
            fs::create_dir_all(&project_directory).unwrap();
            fs::write(
                project_directory.join("project.work"),
                project_contents.as_bytes(),
            )
            .unwrap();
            let before = snapshot_files(root.path());
            let canonical = root.path().canonicalize().unwrap();

            let settings =
                scan_slot_local_settings(&canonical, &snapshot_with_static_slot_one()).unwrap();

            assert_eq!(settings.len(), 1);
            assert_eq!(
                settings[0].slot,
                SampleSlotId::new(SampleSlotKind::Static, 1).ok()
            );
            assert_eq!(
                settings[0].parse_status,
                SampleSettingsParseStatus::Malformed
            );
            assert!(settings[0].gain.is_none());
            assert!(settings[0].tempo_x24.is_none());
            assert!(settings[0].slices.is_empty());
            assert_eq!(snapshot_files(root.path()), before);
        }
    }

    #[test]
    fn state_inventory_indexes_working_and_saved_documents_with_usage_and_provenance() {
        let root = TempDir::new().unwrap();
        let project_directory = root.path().join("SET/PROJECT");
        fs::create_dir_all(&project_directory).unwrap();
        let fixture_directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/real_device");
        for name in ["project.work", "markers.work", "bank01.work", "bank01.strd"] {
            fs::copy(fixture_directory.join(name), project_directory.join(name)).unwrap();
        }
        fs::copy(
            fixture_directory.join("project.work"),
            project_directory.join("project.strd"),
        )
        .unwrap();
        let copied_audio = root.path().join("SET/AUDIO/Elektron/Acdrum.wav");
        fs::create_dir_all(copied_audio.parent().unwrap()).unwrap();
        fs::write(copied_audio, [0_u8]).unwrap();
        let before = snapshot_files(root.path());
        let canonical = root.path().canonicalize().unwrap();
        let mut topology = inventory_topology();
        topology.standalone_projects.clear();
        topology.file_instances.push(FileInstance {
            relative_path: RootRelativePath::parse("SET/AUDIO/Elektron/Acdrum.wav").unwrap(),
            content_hash: test_hash('a'),
            byte_size: 1,
            modified_at_unix_ns: Some(1),
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        });

        let (documents, assignments, usage_edges) =
            scan_state_inventory(&canonical, &topology).unwrap();
        topology.state_documents = documents.clone();
        topology.slot_assignments = assignments.clone();
        topology.usage_edges = usage_edges.clone();
        let sample_settings = scan_sample_settings(&canonical, &topology).unwrap();

        assert_eq!(documents.len(), 4);
        assert!(documents.iter().all(|document| {
            document.parse_status == StateDocumentParseStatus::Parsed
                && document.parser_provenance.parser_revision == STATE_PARSER_REVISION
        }));
        assert!(documents.iter().any(|document| {
            document.kind == StateDocumentKind::Project
                && document.role == StateDocumentRole::Working
        }));
        assert!(documents.iter().any(|document| {
            document.kind == StateDocumentKind::Bank
                && document.role == StateDocumentRole::SavedCheckpoint
        }));
        assert!(assignments.iter().any(|assignment| {
            assignment.slot == SampleSlotId::new(SampleSlotKind::Static, 5).unwrap()
                && assignment.reference_status == SampleReferenceStatus::Resolved
        }));
        assert!(assignments
            .iter()
            .any(|assignment| assignment.reference_status == SampleReferenceStatus::Missing));
        assert!(!usage_edges.is_empty());
        assert!(!sample_settings.is_empty());
        assert!(sample_settings.iter().all(|settings| {
            settings.owner == SampleSettingsOwner::SlotAssignment
                && settings.parse_status == SampleSettingsParseStatus::Parsed
        }));
        assert!(sample_settings.iter().any(|settings| {
            settings.source_relative_path.as_str() == "SET/PROJECT/project.work"
                && settings
                    .marker_source_relative_path
                    .as_ref()
                    .is_some_and(|path| path.as_str() == "SET/PROJECT/markers.work")
        }));
        assert!(sample_settings.iter().any(|settings| {
            settings.source_relative_path.as_str() == "SET/PROJECT/project.strd"
                && settings.marker_source_relative_path.is_none()
        }));
        assert!(sample_settings.iter().any(|settings| {
            settings.slot == SampleSlotId::new(SampleSlotKind::Static, 5).ok()
                && settings.gain == Some(48)
        }));
        assert!(usage_edges.iter().all(|edge| !edge
            .project_document_relative_path
            .as_str()
            .starts_with('/')));
        assert_eq!(snapshot_files(root.path()), before);
        assert!(
            !format!("{documents:?}{assignments:?}{usage_edges:?}{sample_settings:?}")
                .contains(root.path().to_str().unwrap())
        );
    }

    #[test]
    fn state_inventory_records_malformed_project_without_partial_usage() {
        let root = TempDir::new().unwrap();
        let project_directory = root.path().join("SET/PROJECT");
        fs::create_dir_all(&project_directory).unwrap();
        fs::write(project_directory.join("project.work"), b"not a project").unwrap();
        let fixture_directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/real_device");
        fs::copy(
            fixture_directory.join("bank01.work"),
            project_directory.join("bank01.work"),
        )
        .unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let mut topology = inventory_topology();
        topology.standalone_projects.clear();

        let (documents, assignments, usage_edges) =
            scan_state_inventory(&canonical, &topology).unwrap();

        assert_eq!(documents.len(), 2);
        assert!(documents.iter().any(|document| {
            document.kind == StateDocumentKind::Project
                && document.parse_status == StateDocumentParseStatus::Malformed
        }));
        assert!(documents.iter().any(|document| {
            document.kind == StateDocumentKind::Bank
                && document.parse_status == StateDocumentParseStatus::Parsed
        }));
        assert!(assignments.is_empty());
        assert!(usage_edges.is_empty());
    }

    #[test]
    fn validated_sample_sidecar_exposes_settings_and_slices_without_writing_fixture() {
        use ot_tools_io::types::{Slice, SlotMarkers};

        let root = TempDir::new().unwrap();
        let audio = root.path().join("SET/PROJECT/kick.wav");
        fs::create_dir_all(audio.parent().unwrap()).unwrap();
        fs::write(&audio, b"copied audio fixture").unwrap();
        let mut markers = SlotMarkers {
            trim_end: 1000,
            slice_count: 1,
            ..Default::default()
        };
        markers.slices[0] = Slice {
            trim_start: 0,
            trim_end: 1000,
            loop_start: u32::MAX,
        };
        SampleSettingsFile::new(
            markers,
            Some(48),
            Some(2880),
            Some(400),
            Some(400),
            None,
            None,
            None,
        )
        .unwrap()
        .to_data_file(&audio.with_extension("ot"))
        .unwrap();
        let before = snapshot_files(root.path());
        let canonical = root.path().canonicalize().unwrap();
        let snapshot = LibrarySnapshot {
            file_instances: vec![FileInstance {
                relative_path: RootRelativePath::parse("SET/PROJECT/kick.wav").unwrap(),
                content_hash: test_hash('b'),
                byte_size: 20,
                modified_at_unix_ns: Some(1),
                storage_scope: SampleStorageScope::ProjectLocal,
                hash_freshness: ContentHashFreshness::ComputedThisScan,
            }],
            ..LibrarySnapshot::default()
        };

        let settings = scan_file_sidecar_settings(&canonical, &snapshot).unwrap();

        assert_eq!(settings.len(), 1);
        assert_eq!(settings[0].parse_status, SampleSettingsParseStatus::Parsed);
        assert_eq!(
            settings[0].source_relative_path.as_str(),
            "SET/PROJECT/kick.ot"
        );
        assert_eq!(settings[0].gain, Some(48));
        assert_eq!(settings[0].tempo_x24, Some(2880));
        assert_eq!(settings[0].slices.len(), 1);
        assert_eq!(settings[0].slices[0].trim_end, 1000);
        assert_eq!(snapshot_files(root.path()), before);
        assert!(!format!("{settings:?}").contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn ambiguous_sample_sidecar_owner_fails_closed() {
        use ot_tools_io::types::SlotMarkers;

        let root = TempDir::new().unwrap();
        let project = root.path().join("SET/PROJECT");
        fs::create_dir_all(&project).unwrap();
        for name in ["kick.wav", "kick.aif"] {
            fs::write(project.join(name), b"copied audio fixture").unwrap();
        }
        let audio = project.join("kick.wav");
        let markers = SlotMarkers {
            trim_end: 1000,
            ..Default::default()
        };
        SampleSettingsFile::new(markers, None, None, None, None, None, None, None)
            .unwrap()
            .to_data_file(&audio.with_extension("ot"))
            .unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let snapshot = LibrarySnapshot {
            file_instances: ["SET/PROJECT/kick.wav", "SET/PROJECT/kick.aif"]
                .into_iter()
                .enumerate()
                .map(|(index, path)| FileInstance {
                    relative_path: RootRelativePath::parse(path).unwrap(),
                    content_hash: test_hash(if index == 0 { 'c' } else { 'd' }),
                    byte_size: 20,
                    modified_at_unix_ns: Some(1),
                    storage_scope: SampleStorageScope::ProjectLocal,
                    hash_freshness: ContentHashFreshness::ComputedThisScan,
                })
                .collect(),
            ..LibrarySnapshot::default()
        };

        let error = scan_file_sidecar_settings(&canonical, &snapshot).unwrap_err();

        assert!(error.message().starts_with("UNSUPPORTED_FORMAT:"));
    }

    #[test]
    fn project_reference_resolution_rejects_absolute_and_root_escape_paths() {
        let project = RootRelativePath::parse("SET/PROJECT").unwrap();
        assert_eq!(
            resolve_project_reference(&project, "../AUDIO/kick.wav")
                .unwrap()
                .as_str(),
            "SET/AUDIO/kick.wav"
        );
        for invalid in [
            "../../../outside.wav",
            "/tmp/outside.wav",
            r"C:\\outside.wav",
            r"..\\..\\..\\outside.wav",
            "nested//sample.wav",
        ] {
            assert!(resolve_project_reference(&project, invalid).is_err());
        }
    }

    #[test]
    fn inventory_detects_only_octatrack_candidates_and_is_deterministically_sorted() {
        let root = TempDir::new().unwrap();
        for (path, bytes) in [
            ("z.WAV", b"z".as_slice()),
            ("a.aif", b"a".as_slice()),
            ("m.AIFF", b"m".as_slice()),
            ("skip.mp3", b"mp3".as_slice()),
            ("skip.flac", b"flac".as_slice()),
            ("skip.ogg", b"ogg".as_slice()),
            ("skip.m4a", b"m4a".as_slice()),
            ("._fork.wav", b"fork".as_slice()),
            (".hidden.wav", b"hidden".as_slice()),
        ] {
            fs::write(root.path().join(path), bytes).unwrap();
        }
        fs::create_dir(root.path().join(".hidden-directory")).unwrap();
        fs::write(root.path().join(".hidden-directory/inside.wav"), b"hidden").unwrap();
        let before = snapshot_files(root.path());
        let canonical = root.path().canonicalize().unwrap();

        let (_assets, files) =
            scan_audio_inventory(&canonical, &LibrarySnapshot::default(), &[]).unwrap();

        assert_eq!(
            files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["a.aif", "m.AIFF", "z.WAV"]
        );
        assert!(files
            .iter()
            .all(|file| file.storage_scope == SampleStorageScope::Unclassified));
        assert_eq!(snapshot_files(root.path()), before);
        assert!(!format!("{files:?}").contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn scope_classification_uses_path_components_and_documented_precedence() {
        let topology = inventory_topology();
        let cases = [
            ("SET/AUDIO/Kicks/kick.wav", SampleStorageScope::SetAudioPool),
            ("SET/PROJECT/local.wav", SampleStorageScope::ProjectLocal),
            (
                "SET/PROJECT/AUDIO/local.wav",
                SampleStorageScope::ProjectLocal,
            ),
            ("STANDALONE/local.wav", SampleStorageScope::ProjectLocal),
            ("SET/AUDIO2/not-pool.wav", SampleStorageScope::Unclassified),
            (
                "SET/MY_AUDIO/not-pool.wav",
                SampleStorageScope::Unclassified,
            ),
            ("loose.wav", SampleStorageScope::Unclassified),
        ];

        for (path, expected) in cases {
            assert_eq!(
                classify_storage_scope(&RootRelativePath::parse(path).unwrap(), &topology),
                expected,
                "unexpected scope for {path}"
            );
        }
    }

    #[test]
    fn streaming_sha256_matches_a_known_fixture_hash() {
        let root = TempDir::new().unwrap();
        let file = root.path().join("known.wav");
        fs::write(&file, b"abc").unwrap();
        let expected = metadata_observation(&fs::symlink_metadata(&file).unwrap());

        let hash = hash_regular_file(&file, expected).unwrap();

        assert_eq!(
            hash.as_str(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn unchanged_metadata_reuses_hash_while_size_new_path_and_unknown_mtime_require_hashing() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("first.wav"), b"first").unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let topology = LibrarySnapshot::default();
        let mut first_calls = 0;
        let (_assets, first) =
            scan_audio_inventory_with(&canonical, &topology, &[], &mut |_path, _metadata| {
                first_calls += 1;
                Ok(test_hash('a'))
            })
            .unwrap();
        assert_eq!(first_calls, 1);

        let mut unchanged_calls = 0;
        let (_assets, unchanged) =
            scan_audio_inventory_with(&canonical, &topology, &first, &mut |_path, _metadata| {
                unchanged_calls += 1;
                Ok(test_hash('b'))
            })
            .unwrap();
        assert_eq!(unchanged_calls, 0);
        assert_eq!(
            unchanged[0].hash_freshness,
            ContentHashFreshness::ReusedUnchangedMetadata
        );

        let mut mtime_baseline = unchanged.clone();
        mtime_baseline[0].modified_at_unix_ns =
            mtime_baseline[0].modified_at_unix_ns.map(|value| value + 1);
        let mut mtime_changed_calls = 0;
        let (_assets, mtime_changed) = scan_audio_inventory_with(
            &canonical,
            &topology,
            &mtime_baseline,
            &mut |_path, _metadata| {
                mtime_changed_calls += 1;
                Ok(test_hash('c'))
            },
        )
        .unwrap();
        assert_eq!(mtime_changed_calls, 1);
        assert_eq!(
            mtime_changed[0].hash_freshness,
            ContentHashFreshness::ComputedThisScan
        );

        fs::write(root.path().join("first.wav"), b"first changed").unwrap();
        fs::write(root.path().join("new.aiff"), b"new").unwrap();
        let mut changed_calls = 0;
        let (_assets, changed) = scan_audio_inventory_with(
            &canonical,
            &topology,
            &unchanged,
            &mut |_path, _metadata| {
                changed_calls += 1;
                Ok(if changed_calls == 1 {
                    test_hash('c')
                } else {
                    test_hash('d')
                })
            },
        )
        .unwrap();
        assert_eq!(changed_calls, 2);
        assert!(changed
            .iter()
            .all(|file| { file.hash_freshness == ContentHashFreshness::ComputedThisScan }));

        let mut previous = changed[0].clone();
        let current = FileMetadataObservation {
            byte_size: previous.byte_size,
            modified_at_unix_ns: previous.modified_at_unix_ns,
        };
        let unknown_mtime = FileMetadataObservation {
            byte_size: previous.byte_size,
            modified_at_unix_ns: None,
        };
        assert!(!can_reuse_hash(unknown_mtime, &previous));

        previous.modified_at_unix_ns = current.modified_at_unix_ns.map(|value| value + 1);
        assert!(!can_reuse_hash(current, &previous));
        previous.modified_at_unix_ns = None;
        assert!(!can_reuse_hash(current, &previous));
    }

    #[test]
    fn duplicate_bytes_create_one_asset_and_multiple_file_instances() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("first.wav"), b"same bytes").unwrap();
        fs::write(root.path().join("second.aif"), b"same bytes").unwrap();
        let canonical = root.path().canonicalize().unwrap();

        let (assets, files) =
            scan_audio_inventory(&canonical, &LibrarySnapshot::default(), &[]).unwrap();

        assert_eq!(assets.len(), 1);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].content_hash, files[1].content_hash);
    }

    #[test]
    fn metadata_change_during_hash_fails_the_scan() {
        let root = TempDir::new().unwrap();
        let file = root.path().join("changing.wav");
        fs::write(&file, b"before").unwrap();
        let expected = metadata_observation(&fs::symlink_metadata(&file).unwrap());

        let error = hash_regular_file_with_hook(&file, expected, |path| {
            fs::write(path, b"changed while hashing").unwrap();
        })
        .unwrap_err();

        assert!(error.message().contains("changed while hashing"));
    }

    #[cfg(unix)]
    #[test]
    fn inventory_never_follows_symlink_files_or_directories() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("outside.wav"), b"outside").unwrap();
        fs::create_dir(outside.path().join("directory")).unwrap();
        fs::write(outside.path().join("directory/inside.wav"), b"outside").unwrap();
        symlink(
            outside.path().join("outside.wav"),
            root.path().join("linked.wav"),
        )
        .unwrap();
        symlink(
            outside.path().join("directory"),
            root.path().join("linked-directory"),
        )
        .unwrap();
        fs::write(root.path().join("inside.wav"), b"inside").unwrap();
        let canonical = root.path().canonicalize().unwrap();

        let (_assets, files) =
            scan_audio_inventory(&canonical, &LibrarySnapshot::default(), &[]).unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative_path.as_str(), "inside.wav");
        assert_eq!(
            fs::read(outside.path().join("outside.wav")).unwrap(),
            b"outside"
        );
    }
}
