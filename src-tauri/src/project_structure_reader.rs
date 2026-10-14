//! Read-only Project structure adapter (`MO-PSE-READ-MODEL-1`).
//!
//! Reads `bankNN.work` and `bankNN.strd` as independent documents inside an
//! already-registered canonical root. Each Bank file is opened once with a
//! non-following descriptor, and that descriptor is checked against the
//! registered root before its bytes are decoded. Symlinked or non-regular
//! Bank files are absent. Filesystem I/O failures propagate; decode failures
//! stay malformed and expose no Pattern or Part values. This module exposes
//! no write path.

// Wired to `v2_project_structure_read`; exercised by tests until then.
#![cfg_attr(not(test), allow(dead_code))]

use crate::bank_validation::bank_parse_status;
use crate::legacy_read_adapter::{join_relative, resolve_relative_for_read};
use crate::project_compatibility::{evaluate_project_compatibility, ProjectCompatibility};
use ot_domain::project_structure::{
    pattern_playback_scale, per_track_master_length, project_arrangement_selection,
    project_bank_selection, project_pattern_selection, state_role_rank, BankIndex, BankStructure,
    MachineKind, PartIndex, PartStructure, PatternIndex, PatternScale, PatternStructure,
    ProjectStateDocument, ProjectStructure, TrackIndex, TrackPlayback, TrackScale, TrackStructure,
    BANK_UNMODELED_DEPENDENCIES,
};
use ot_domain::{
    track_slot_from_raw::track_slot_reference_from_machine, RootRelativePath,
    StateDocumentParseStatus, StateDocumentRole,
};
use ot_storage_ports::StorageError;
use ot_tools_io::{BankFile, OctatrackFileIO};
use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

/// Working `project.work` documents in tracked fixtures are under 8 KiB.
/// `project_manager` records an empty `project.work` at about 3 KiB. One
/// mebibyte is the allocation cap for this text document.
const PROJECT_WORK_MAX_BYTES: u64 = 1024 * 1024;

pub(crate) fn read_project_structure(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let project_directory = resolve_relative_for_read(canonical_root, project_relative_path)?;
    read_banks_in_directory(canonical_root, &project_directory, project_relative_path)
}

/// Read a single Project state document through a non-following descriptor.
pub(crate) fn read_contained_state_document_bytes(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
    file_name: &str,
) -> Result<Option<Vec<u8>>, StorageError> {
    let project_directory = resolve_relative_for_read(canonical_root, project_relative_path)?;
    read_contained_state_document_bytes_in_directory(canonical_root, &project_directory, file_name)
}

#[cfg(unix)]
fn read_contained_state_document_bytes_in_directory(
    canonical_root: &Path,
    project_directory: &Path,
    file_name: &str,
) -> Result<Option<Vec<u8>>, StorageError> {
    let project_dir = open_contained_directory(canonical_root, project_directory)?;
    read_contained_bank_bytes(canonical_root, &project_dir, file_name)
}

#[cfg(not(unix))]
fn read_contained_state_document_bytes_in_directory(
    canonical_root: &Path,
    project_directory: &Path,
    file_name: &str,
) -> Result<Option<Vec<u8>>, StorageError> {
    let _ = (canonical_root, project_directory, file_name);
    Err(StorageError::new(
        "LIBRARY_SCAN_FAILED: contained state document reads require a non-following descriptor",
    ))
}

#[cfg(unix)]
fn read_banks_in_directory(
    canonical_root: &Path,
    project_directory: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let project_dir = open_contained_directory(canonical_root, project_directory)?;
    let project_state =
        read_working_project_state(canonical_root, &project_dir, project_relative_path)?;
    let track_eight_is_master =
        project_state.as_ref().and_then(|state| state.master_track) == Some(true);
    let mut banks = Vec::new();
    for bank in BankIndex::all() {
        for (role, extension) in [
            (StateDocumentRole::Working, "work"),
            (StateDocumentRole::SavedCheckpoint, "strd"),
        ] {
            let file_name = format!("bank{:02}.{extension}", bank.file_number());
            let Some(bytes) = read_contained_bank_bytes(canonical_root, &project_dir, &file_name)?
            else {
                continue;
            };
            let source_relative_path = join_relative(project_relative_path, &file_name)?;
            banks.push(read_bank_document(
                bank,
                role,
                source_relative_path,
                &bytes,
                track_eight_is_master,
            ));
        }
    }
    banks.sort_by_key(|entry| (entry.bank, state_role_rank(entry.role)));
    Ok(ProjectStructure {
        project_relative_path: project_relative_path.clone(),
        project_state,
        banks,
    })
}

#[cfg(unix)]
fn read_working_project_state(
    canonical_root: &Path,
    project_dir: &File,
    project_relative_path: &RootRelativePath,
) -> Result<Option<ProjectStateDocument>, StorageError> {
    // Working only. `project.strd` is a separate checkpoint and is not a fallback.
    let Some(bytes) = read_contained_project_work(canonical_root, project_dir)? else {
        return Ok(None);
    };
    let source_relative_path = join_relative(project_relative_path, "project.work")?;
    Ok(Some(project_state_from_bytes(source_relative_path, &bytes)))
}

#[cfg(unix)]
fn project_state_from_bytes(
    source_relative_path: RootRelativePath,
    bytes: &[u8],
) -> ProjectStateDocument {
    let withheld = |parse_status| ProjectStateDocument {
        role: StateDocumentRole::Working,
        source_relative_path: source_relative_path.clone(),
        parse_status,
        bank: None,
        pattern: None,
        arrangement: None,
        master_track: None,
    };
    let Ok(project) = ot_tools_io::ProjectFile::from_bytes(bytes) else {
        return withheld(StateDocumentParseStatus::Malformed);
    };
    // Includes the verified VERSION=19 / R0173 / 1.40 fixture exception.
    // Upstream `check_compatible_os_version` alone rejects that file.
    // Arrangement slots are evidenced only for that same R0173 / 1.40 pair.
    let decision = evaluate_project_compatibility(&project);
    let (os_revision, os_release) = decision
        .os_version
        .as_ref()
        .map(|version| (version.revision.as_str(), version.release.as_str()))
        .unwrap_or(("", ""));
    match decision.compatibility {
        ProjectCompatibility::Supported { .. } => ProjectStateDocument {
            role: StateDocumentRole::Working,
            source_relative_path,
            parse_status: StateDocumentParseStatus::Parsed,
            bank: Some(project_bank_selection(project.states.bank)),
            pattern: Some(project_pattern_selection(project.states.pattern)),
            arrangement: Some(project_arrangement_selection(
                project.states.arrangement,
                os_revision,
                os_release,
            )),
            master_track: Some(project.settings.control.audio.master_track),
        },
        ProjectCompatibility::UnsupportedVersion => {
            withheld(StateDocumentParseStatus::UnsupportedVersion)
        }
        ProjectCompatibility::Malformed => withheld(StateDocumentParseStatus::Malformed),
    }
}

#[cfg(not(unix))]
fn read_banks_in_directory(
    canonical_root: &Path,
    project_directory: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let _ = (canonical_root, project_directory, project_relative_path);
    Err(StorageError::new(
        "LIBRARY_SCAN_FAILED: contained bank reads require a non-following descriptor",
    ))
}

fn read_bank_document(
    bank: BankIndex,
    role: StateDocumentRole,
    source_relative_path: RootRelativePath,
    bytes: &[u8],
    track_eight_is_master: bool,
) -> BankStructure {
    let mut structure = BankStructure {
        bank,
        role,
        source_relative_path,
        parse_status: StateDocumentParseStatus::Malformed,
        patterns: Vec::new(),
        parts: Vec::new(),
        unmodeled: BANK_UNMODELED_DEPENDENCIES.to_vec(),
    };
    // Bytes were already read from a contained descriptor. A decode failure is
    // format damage, not a filesystem error.
    let Ok(decoded) = BankFile::from_bytes(bytes) else {
        return structure;
    };
    structure.parse_status = bank_parse_status(&decoded);
    if structure.parse_status != StateDocumentParseStatus::Parsed {
        return structure;
    }
    match (
        bank_patterns(&decoded),
        bank_parts(&decoded, track_eight_is_master),
    ) {
        (Some(patterns), Some(parts)) => {
            structure.patterns = patterns;
            structure.parts = parts;
        }
        _ => structure.parse_status = StateDocumentParseStatus::Malformed,
    }
    structure
}

fn bank_patterns(bank: &BankFile) -> Option<Vec<PatternStructure>> {
    PatternIndex::all()
        .map(|index| {
            let pattern = bank.patterns.0.get(usize::from(index.get()))?;
            Some(PatternStructure {
                index,
                part: PartIndex::new(pattern.part_assignment).ok()?,
                scale: pattern_scale(pattern),
            })
        })
        .collect()
}

fn pattern_scale(pattern: &ot_tools_io::patterns::Pattern) -> PatternScale {
    match pattern.scale.scale_mode {
        0 => PatternScale::Normal {
            master_length: u16::from(pattern.scale.master_len),
            master_scale: pattern_playback_scale(pattern.scale.master_scale),
        },
        1 => PatternScale::PerTrack {
            master_length: per_track_master_length(
                pattern.scale.master_len_per_track_multiplier,
                pattern.scale.master_len_per_track,
            ),
            master_scale: pattern_playback_scale(pattern.scale.master_scale_per_track),
            tracks: TrackIndex::all()
                .zip(pattern.audio_track_trigs.0.iter())
                .map(|(track, audio)| TrackScale {
                    track,
                    length: audio.scale_per_track_mode.per_track_len,
                    scale: pattern_playback_scale(audio.scale_per_track_mode.per_track_scale),
                })
                .collect(),
        },
        raw => PatternScale::Unrecognized { raw },
    }
}

fn bank_parts(bank: &BankFile, track_eight_is_master: bool) -> Option<Vec<PartStructure>> {
    PartIndex::all()
        .map(|index| {
            let part = bank.parts.unsaved.0.get(usize::from(index.get()))?;
            let tracks = TrackIndex::all()
                .map(|track| {
                    let position = usize::from(track.get());
                    let machine =
                        MachineKind::from_raw(*part.audio_track_machine_types.get(position)?);
                    let slots = part.audio_track_machine_slots.get(position)?;
                    let playback = if track_eight_is_master && track.get() == 7 {
                        TrackPlayback::Master
                    } else {
                        let slot = track_slot_reference_from_machine(
                            machine,
                            slots.static_slot_id,
                            slots.flex_slot_id,
                        );
                        TrackPlayback::Audio { machine, slot }
                    };
                    Some(TrackStructure {
                        index: track,
                        playback,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(PartStructure { index, tracks })
        })
        .collect()
}

#[cfg(unix)]
fn open_contained_directory(canonical_root: &Path, directory: &Path) -> Result<File, StorageError> {
    let file = open_nofollow_read(directory).map_err(map_directory_open_error)?;
    let metadata = file.metadata().map_err(io_unavailable)?;
    if !metadata.is_dir() {
        return Err(StorageError::new(
            "ROOT_REMOVED: project path is not a directory",
        ));
    }
    ensure_descriptor_inside_root(canonical_root, &file)?;
    Ok(file)
}

#[cfg(unix)]
fn read_contained_bank_bytes(
    canonical_root: &Path,
    project_dir: &File,
    file_name: &str,
) -> Result<Option<Vec<u8>>, StorageError> {
    let Some(mut file) = open_contained_descriptor(project_dir, file_name)? else {
        return Ok(None);
    };
    if !prepare_regular_descriptor(&file)? {
        return Ok(None);
    }
    ensure_descriptor_inside_root(canonical_root, &file)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(io_unavailable)?;
    Ok(Some(bytes))
}

#[cfg(unix)]
fn read_contained_project_work(
    canonical_root: &Path,
    project_dir: &File,
) -> Result<Option<Vec<u8>>, StorageError> {
    let Some(mut file) = open_contained_descriptor(project_dir, "project.work")? else {
        return Ok(None);
    };
    if !prepare_regular_descriptor(&file)? {
        return Ok(None);
    }
    ensure_descriptor_inside_root(canonical_root, &file)?;
    read_bounded_project_work(&mut file).map(Some)
}

/// `true` when the descriptor is a regular file and can be read.
/// FIFOs and other non-regular types are rejected before any read so
/// `O_RDONLY` cannot block waiting for a writer.
#[cfg(unix)]
fn prepare_regular_descriptor(file: &File) -> Result<bool, StorageError> {
    let metadata = file.metadata().map_err(io_unavailable)?;
    if !metadata.file_type().is_file() {
        return Ok(false);
    }
    clear_nonblock(file)?;
    Ok(true)
}

#[cfg(unix)]
fn read_bounded_project_work(file: &mut File) -> Result<Vec<u8>, StorageError> {
    let before = file.metadata().map_err(io_unavailable)?;
    if before.len() > PROJECT_WORK_MAX_BYTES {
        return Err(StorageError::new(
            "LIBRARY_SCAN_FAILED: project.work exceeds the read limit",
        ));
    }
    let mut bytes = Vec::new();
    let expected = usize::try_from(before.len()).map_err(|_| {
        StorageError::new("LIBRARY_SCAN_FAILED: project.work length is not addressable")
    })?;
    bytes.try_reserve(expected).map_err(|_| {
        StorageError::new("LIBRARY_SCAN_FAILED: project.work could not be buffered")
    })?;
    file.take(before.len())
        .read_to_end(&mut bytes)
        .map_err(io_unavailable)?;
    let after = file.metadata().map_err(io_unavailable)?;
    if after.len() != before.len() || bytes.len() != expected {
        return Err(StorageError::new(
            "LIBRARY_SCAN_FAILED: project.work changed while it was read",
        ));
    }
    Ok(bytes)
}

#[cfg(unix)]
fn open_nofollow_read(path: &Path) -> Result<File, std::io::Error> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

#[cfg(unix)]
fn open_contained_descriptor(
    project_dir: &File,
    file_name: &str,
) -> Result<Option<File>, StorageError> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = std::ffi::CString::new(file_name).map_err(|_| {
        StorageError::new("PATH_ESCAPE: bank file name is not a single path component")
    })?;
    // SAFETY: `project_dir` owns an open directory descriptor. `name` is a
    // NUL-terminated single component. A non-negative result is a new fd
    // transferred to `File` below.
    let fd = unsafe {
        libc::openat(
            project_dir.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == ErrorKind::NotFound || is_symlink_open_error(&error) {
            return Ok(None);
        }
        return Err(io_unavailable(error));
    }
    // SAFETY: `fd` was just created by `openat` and is not owned elsewhere.
    Ok(Some(unsafe { File::from_raw_fd(fd) }))
}

#[cfg(unix)]
fn clear_nonblock(file: &File) -> Result<(), StorageError> {
    use std::os::fd::AsRawFd;
    let fd = file.as_raw_fd();
    // SAFETY: `fd` is owned by `file` and `F_GETFL` / `F_SETFL` only touch its status flags.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io_unavailable(std::io::Error::last_os_error()));
    }
    let updated = flags & !libc::O_NONBLOCK;
    // SAFETY: same owned descriptor; the new flags drop `O_NONBLOCK` after the type check.
    if unsafe { libc::fcntl(fd, libc::F_SETFL, updated) } < 0 {
        return Err(io_unavailable(std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_descriptor_inside_root(canonical_root: &Path, file: &File) -> Result<(), StorageError> {
    let opened = opened_file_path(file).map_err(io_unavailable)?;
    if opened.starts_with(canonical_root) {
        Ok(())
    } else {
        Err(StorageError::new(
            "PATH_ESCAPE: opened descriptor left its registered root",
        ))
    }
}

#[cfg(target_os = "linux")]
fn opened_file_path(file: &File) -> Result<PathBuf, std::io::Error> {
    use std::os::fd::AsRawFd;
    let link = format!("/proc/self/fd/{}", file.as_raw_fd());
    let path = std::fs::read_link(link)?;
    Ok(strip_proc_deleted(path))
}

#[cfg(target_os = "macos")]
fn opened_file_path(file: &File) -> Result<PathBuf, std::io::Error> {
    use std::os::fd::AsRawFd;
    let mut buf = vec![0u8; libc::PATH_MAX as usize];
    // SAFETY: `file` is an open descriptor and `buf` is at least PATH_MAX bytes,
    // which is what F_GETPATH writes a NUL-terminated path into.
    let rc = unsafe {
        libc::fcntl(
            file.as_raw_fd(),
            libc::F_GETPATH,
            buf.as_mut_ptr().cast::<libc::c_char>(),
        )
    };
    if rc == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let bytes = buf.split(|byte| *byte == 0).next().unwrap_or(&[]);
    let text = std::str::from_utf8(bytes)
        .map_err(|error| std::io::Error::new(ErrorKind::InvalidData, error))?;
    Ok(PathBuf::from(text))
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn opened_file_path(file: &File) -> Result<PathBuf, std::io::Error> {
    let _ = file;
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "opened descriptor path is unavailable",
    ))
}

#[cfg(target_os = "linux")]
fn strip_proc_deleted(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    match text.strip_suffix(" (deleted)") {
        Some(stripped) => PathBuf::from(stripped),
        None => path,
    }
}

#[cfg(unix)]
fn map_directory_open_error(error: std::io::Error) -> StorageError {
    if error.kind() == ErrorKind::NotFound {
        StorageError::new(format!("ROOT_REMOVED: {error}"))
    } else if is_symlink_open_error(&error) {
        StorageError::new("SYMLINK_ESCAPE: symlinks are not valid read targets")
    } else {
        io_unavailable(error)
    }
}

#[cfg(unix)]
fn is_symlink_open_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(unix)]
fn io_unavailable(error: std::io::Error) -> StorageError {
    StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::project_structure::TrackSlotReference;
    use ot_domain::track_slot_from_raw::track_slot_reference_from_raw;
    use ot_domain::{RecorderBufferId, SampleSlotId, SampleSlotKind};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    /// Copies the listed fixture files into `<tmp>/SET/PROJECT/` and returns the
    /// canonical temporary root. Tracked fixtures are never read in place.
    fn copied_project(fixture: &str, files: &[&str]) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for file in files {
            fs::copy(fixture_dir(fixture).join(file), project.join(file)).unwrap();
        }
        let root = temp.path().canonicalize().unwrap();
        (temp, root)
    }

    fn project_path() -> RootRelativePath {
        RootRelativePath::parse(PROJECT).unwrap()
    }

    fn tree_digest(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
        walkdir::WalkDir::new(root)
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| {
                let bytes = fs::read(entry.path()).unwrap();
                let digest = format!("{:x}", Sha256::digest(&bytes));
                (
                    entry.path().strip_prefix(root).unwrap().to_path_buf(),
                    (bytes.len() as u64, digest),
                )
            })
            .collect()
    }

    fn bank_a() -> BankIndex {
        BankIndex::new(0).unwrap()
    }

    #[test]
    fn working_and_saved_bank_documents_stay_separate_entries() {
        let (_temp, root) = copied_project(
            "real_device",
            &[
                "project.work",
                "bank01.work",
                "bank01.strd",
                "markers.work",
                "arr01.work",
            ],
        );
        let structure = read_project_structure(&root, &project_path()).unwrap();

        let roles: Vec<_> = structure
            .banks
            .iter()
            .map(|entry| (entry.bank.get(), entry.role))
            .collect();
        assert_eq!(
            roles,
            vec![
                (0, StateDocumentRole::Working),
                (0, StateDocumentRole::SavedCheckpoint)
            ]
        );
        for entry in &structure.banks {
            assert_eq!(entry.parse_status, StateDocumentParseStatus::Parsed);
            assert_eq!(entry.patterns.len(), 16);
            assert_eq!(entry.parts.len(), 4);
            assert!(entry.parts.iter().all(|part| part.tracks.len() == 8));
            assert_eq!(entry.unmodeled, BANK_UNMODELED_DEPENDENCIES.to_vec());
        }
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .source_relative_path
                .as_str(),
            "SET/PROJECT/bank01.work"
        );
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::SavedCheckpoint)
                .unwrap()
                .source_relative_path
                .as_str(),
            "SET/PROJECT/bank01.strd"
        );
    }

    #[test]
    fn working_only_bank_does_not_invent_a_saved_checkpoint() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(structure.banks.len(), 1);
        assert_eq!(structure.banks[0].role, StateDocumentRole::Working);
        assert!(structure
            .bank(bank_a(), StateDocumentRole::SavedCheckpoint)
            .is_none());
    }

    #[test]
    fn saved_only_bank_is_not_promoted_to_working() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.strd"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(structure.banks.len(), 1);
        assert_eq!(structure.banks[0].role, StateDocumentRole::SavedCheckpoint);
        assert!(structure
            .bank(bank_a(), StateDocumentRole::Working)
            .is_none());
    }

    #[test]
    fn pattern_part_assignment_matches_the_legacy_reader() {
        for fixture in ["real_device", "multipart"] {
            let (_temp, root) = copied_project(fixture, &["project.work", "bank01.work"]);
            let structure = read_project_structure(&root, &project_path()).unwrap();
            let working = structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap();

            let project_dir = root.join(PROJECT);
            let legacy =
                crate::project_reader::read_project_banks(project_dir.to_str().unwrap()).unwrap();
            let legacy_patterns = &legacy[0].parts[0].patterns;
            assert_eq!(legacy_patterns.len(), 16);
            for legacy_pattern in legacy_patterns {
                let pattern = working
                    .pattern(PatternIndex::new(legacy_pattern.id).unwrap())
                    .unwrap();
                assert_eq!(
                    pattern.part.get(),
                    legacy_pattern.part_assignment,
                    "{fixture}"
                );
            }
        }
    }

    #[test]
    fn multipart_fixture_uses_more_than_one_part() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        let used_parts = PartIndex::all()
            .filter(|part| working.patterns_using_part(*part).next().is_some())
            .count();
        assert!(used_parts > 1);
    }

    #[test]
    fn multipart_pattern_part_cycle_matches_tracked_fixture() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(working.unmodeled, BANK_UNMODELED_DEPENDENCIES.to_vec());
        for index in 0..16u8 {
            let pattern = working.pattern(PatternIndex::new(index).unwrap()).unwrap();
            assert_eq!(pattern.part.get(), index % 4, "pattern {index}");
        }
        for part in 0..4u8 {
            let track = &working.part(PartIndex::new(part).unwrap()).unwrap().tracks[2];
            let (machine, slot) = audio_playback(track);
            assert_eq!(machine, MachineKind::Static);
            assert_eq!(
                slot,
                TrackSlotReference::Slot(
                    SampleSlotId::new(SampleSlotKind::Static, 41 + u16::from(part)).unwrap()
                )
            );
        }
    }

    fn assert_working_selection(structure: &ProjectStructure, arrangement_raw: u8) {
        let state = structure.project_state.as_ref().unwrap();
        assert_eq!(state.role, StateDocumentRole::Working);
        assert_eq!(state.parse_status, StateDocumentParseStatus::Parsed);
        assert_eq!(
            state.source_relative_path.as_str(),
            "SET/PROJECT/project.work"
        );
        let bank = match state.bank.unwrap() {
            ot_domain::project_structure::ProjectBankSelection::Selected(index) => index,
            other => panic!("expected selected bank, got {other:?}"),
        };
        let pattern = match state.pattern.unwrap() {
            ot_domain::project_structure::ProjectPatternSelection::Selected(index) => index,
            other => panic!("expected selected pattern, got {other:?}"),
        };
        assert_eq!(bank, bank_a());
        assert_eq!(bank.file_number(), 1);
        assert_eq!(pattern, PatternIndex::new(0).unwrap());
        assert_eq!(state.master_track, Some(true));
        // `real_device` and `multipart` are OS 1.40B. Arrangement slots are
        // evidenced only for R0173 / 1.40, so an in-range raw stays unrecognized.
        assert_eq!(
            state.arrangement,
            Some(
                ot_domain::project_structure::ProjectArrangementSelection::Unrecognized(
                    arrangement_raw
                )
            )
        );
        let working = structure.bank(bank, StateDocumentRole::Working).unwrap();
        assert_eq!(working.bank, bank);
        assert!(working.pattern(pattern).is_some());
    }

    #[test]
    fn real_device_project_work_selects_bank_a_and_pattern_zero() {
        let fixture = fixture_dir("real_device").join("project.work");
        let tracked_before = fs::read(&fixture).unwrap();
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let before = tree_digest(&root);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_working_selection(&structure, 0);
        assert_eq!(tree_digest(&root), before);
        assert_eq!(fs::read(&fixture).unwrap(), tracked_before);
    }

    #[test]
    fn multipart_project_work_selects_the_same_bank_and_pattern_indices() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_working_selection(&structure, 0);
    }

    #[test]
    fn missing_project_work_does_not_fall_back_to_saved_checkpoint() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let project = root.join(PROJECT);
        fs::rename(project.join("project.work"), project.join("project.strd")).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure.project_state.is_none());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
    }

    #[test]
    fn malformed_project_work_withholds_selection() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        fs::write(root.join(PROJECT).join("project.work"), b"not a project").unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let state = structure.project_state.as_ref().unwrap();
        assert_eq!(state.parse_status, StateDocumentParseStatus::Malformed);
        assert!(state.bank.is_none());
        assert!(state.pattern.is_none());
        assert!(state.arrangement.is_none());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
    }

    #[test]
    fn unsupported_project_os_withholds_selection() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let path = root.join(PROJECT).join("project.work");
        let mut bytes = fs::read(&path).unwrap();
        let current = b"OS_VERSION=R0177     1.40B";
        let start = bytes
            .windows(current.len())
            .position(|window| window == current)
            .unwrap();
        bytes.splice(
            start..start + current.len(),
            b"OS_VERSION=R0177     1.39D".iter().copied(),
        );
        fs::write(&path, bytes).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let state = structure.project_state.as_ref().unwrap();
        assert_eq!(
            state.parse_status,
            StateDocumentParseStatus::UnsupportedVersion
        );
        assert!(state.bank.is_none());
        assert!(state.pattern.is_none());
        assert!(state.arrangement.is_none());
    }

    fn replace_states_assignment(root: &Path, key: &str, value: u8) {
        let path = root.join(PROJECT).join("project.work");
        let bytes = fs::read(&path).unwrap();
        let needle = format!("{key}=");
        let start = bytes
            .windows(needle.len())
            .position(|window| window == needle.as_bytes())
            .unwrap_or_else(|| panic!("missing {key}"));
        let value_start = start + needle.len();
        let value_end = bytes[value_start..]
            .iter()
            .position(|byte| *byte == b'\r')
            .unwrap()
            + value_start;
        let mut next = bytes[..value_start].to_vec();
        next.extend(value.to_string().into_bytes());
        next.extend_from_slice(&bytes[value_end..]);
        fs::write(&path, next).unwrap();
    }

    #[test]
    fn device_arrangement_captures_map_ui_selection_to_arr_files() {
        for (fixture, raw) in [
            ("pse_arrangement_device/arrangement_1", 0_u8),
            ("pse_arrangement_device/arrangement_2", 1),
            ("pse_arrangement_device/arrangement_8", 7),
        ] {
            let fixture_file = fixture_dir(fixture).join("project.work");
            let tracked_before = fs::read(&fixture_file).unwrap();
            let (_temp, root) = copied_project(fixture, &["project.work"]);
            let before = tree_digest(&root);
            let structure = read_project_structure(&root, &project_path()).unwrap();
            let state = structure.project_state.as_ref().unwrap();
            let ot_domain::project_structure::ProjectArrangementSelection::Selected(index) =
                state.arrangement.unwrap()
            else {
                panic!("{fixture} arrangement must be selected");
            };
            assert_eq!(index.get(), raw, "{fixture}");
            assert_eq!(index.file_number(), raw + 1, "{fixture}");
            assert_eq!(tree_digest(&root), before);
            assert_eq!(fs::read(&fixture_file).unwrap(), tracked_before);
        }
    }

    #[test]
    fn out_of_range_bank_and_pattern_stay_unrecognized() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        replace_states_assignment(&root, "BANK", 16);
        replace_states_assignment(&root, "PATTERN", 16);
        replace_states_assignment(&root, "ARRANGEMENT", 8);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let state = structure.project_state.as_ref().unwrap();
        assert_eq!(state.parse_status, StateDocumentParseStatus::Parsed);
        assert_eq!(
            state.bank,
            Some(ot_domain::project_structure::ProjectBankSelection::Unrecognized(16))
        );
        assert_eq!(
            state.pattern,
            Some(ot_domain::project_structure::ProjectPatternSelection::Unrecognized(16))
        );
        assert_eq!(
            state.arrangement,
            Some(ot_domain::project_structure::ProjectArrangementSelection::Unrecognized(8))
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_project_work_is_not_followed() {
        let (temp, root) = copied_project("real_device", &["bank01.work"]);
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("project.work");
        fs::copy(fixture_dir("real_device").join("project.work"), &target).unwrap();
        std::os::unix::fs::symlink(&target, temp.path().join(PROJECT).join("project.work"))
            .unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure.project_state.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_project_work_is_a_storage_error() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = fixture_dir("real_device").join("project.work");
        let tracked_before = fs::read(&fixture).unwrap();
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let project_file = root.join(PROJECT).join("project.work");
        let before = tree_digest(&root);
        let mut permissions = fs::metadata(&project_file).unwrap().permissions();
        permissions.set_mode(0o0);
        fs::set_permissions(&project_file, permissions.clone()).unwrap();
        assert!(fs::File::open(&project_file).is_err());
        let error = read_project_structure(&root, &project_path()).unwrap_err();
        assert!(
            error.message().starts_with("LIBRARY_SCAN_FAILED"),
            "{}",
            error.message()
        );
        permissions.set_mode(0o644);
        fs::set_permissions(&project_file, permissions).unwrap();
        assert_eq!(tree_digest(&root), before);
        assert_eq!(fs::read(&fixture).unwrap(), tracked_before);
    }

    #[test]
    fn verified_os_1_40_project_work_keeps_active_selection() {
        let fixture = fixture_dir("real_device_os_1_40").join("project.work");
        let tracked_before = fs::read(&fixture).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&tracked_before)),
            "742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6"
        );
        let (_temp, root) = copied_project("real_device_os_1_40", &["project.work"]);
        let before = tree_digest(&root);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure.banks.is_empty());
        let state = structure.project_state.as_ref().unwrap();
        assert_eq!(state.parse_status, StateDocumentParseStatus::Parsed);
        assert_eq!(
            state.bank,
            Some(ot_domain::project_structure::ProjectBankSelection::Selected(bank_a()))
        );
        assert_eq!(bank_a().letter(), 'A');
        assert_eq!(bank_a().file_number(), 1);
        assert_eq!(
            state.pattern,
            Some(
                ot_domain::project_structure::ProjectPatternSelection::Selected(
                    PatternIndex::new(0).unwrap()
                )
            )
        );
        assert_eq!(
            state.arrangement,
            Some(
                ot_domain::project_structure::ProjectArrangementSelection::Selected(
                    ot_domain::project_structure::ArrangementIndex::new(0).unwrap()
                )
            )
        );
        assert_eq!(state.master_track, Some(true));
        assert_eq!(tree_digest(&root), before);
        assert_eq!(fs::read(&fixture).unwrap(), tracked_before);
    }

    #[cfg(unix)]
    #[test]
    fn fifo_project_work_is_absent_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::time::{Duration, Instant};

        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let project_work = root.join(PROJECT).join("project.work");
        let name = CString::new(project_work.as_os_str().as_bytes()).unwrap();
        let created = unsafe { libc::mkfifo(name.as_ptr(), 0o644) };
        assert_eq!(created, 0, "{}", std::io::Error::last_os_error());

        let started = Instant::now();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "opening a project.work FIFO blocked"
        );
        assert!(structure.project_state.is_none());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
    }

    #[cfg(unix)]
    #[test]
    fn oversized_project_work_is_rejected_before_parsing() {
        let fixture = fixture_dir("real_device").join("project.work");
        let tracked_before = fs::read(&fixture).unwrap();
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let project_work = root.join(PROJECT).join("project.work");
        let file = fs::OpenOptions::new()
            .write(true)
            .open(&project_work)
            .unwrap();
        file.set_len(PROJECT_WORK_MAX_BYTES + 1).unwrap();
        drop(file);

        let error = read_project_structure(&root, &project_path()).unwrap_err();
        assert!(
            error.message().starts_with("LIBRARY_SCAN_FAILED"),
            "{}",
            error.message()
        );
        assert!(
            error.message().contains("exceeds the read limit"),
            "{}",
            error.message()
        );
        assert_eq!(fs::read(&fixture).unwrap(), tracked_before);
    }

    fn audio_playback(track: &TrackStructure) -> (MachineKind, TrackSlotReference) {
        match track.playback {
            TrackPlayback::Audio { machine, slot } => (machine, slot),
            TrackPlayback::Master => panic!("track {} is the master track", track.index.get()),
        }
    }

    fn set_master_track_text(root: &Path, value: &str) {
        let path = root.join(PROJECT).join("project.work");
        let bytes = fs::read(&path).unwrap();
        let needle = b"MASTER_TRACK=";
        let start = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        let value_start = start + needle.len();
        let value_end = bytes[value_start..]
            .iter()
            .position(|byte| *byte == b'\r')
            .unwrap()
            + value_start;
        let mut next = bytes[..value_start].to_vec();
        next.extend(value.as_bytes());
        next.extend_from_slice(&bytes[value_end..]);
        fs::write(path, next).unwrap();
    }

    fn rewrite_working_bank(root: &Path, edit: impl FnOnce(&mut BankFile)) {
        let path = root.join(PROJECT).join("bank01.work");
        let mut bank = BankFile::from_bytes(&fs::read(&path).unwrap()).unwrap();
        edit(&mut bank);
        fs::write(path, bank.to_bytes().unwrap()).unwrap();
    }

    fn audio_tracks_before_eight(structure: &ProjectStructure) -> Vec<TrackPlayback> {
        structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap()
            .parts
            .iter()
            .flat_map(|part| part.tracks.iter().take(7).map(|track| track.playback))
            .collect()
    }

    fn assert_track_eight(structure: &ProjectStructure, master: bool) {
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        for part in &working.parts {
            for track in part.tracks.iter().take(7) {
                assert!(
                    matches!(track.playback, TrackPlayback::Audio { .. }),
                    "track {} changed role",
                    track.index.get()
                );
            }
            let eighth = &part.tracks[7];
            assert_eq!(eighth.index.get(), 7);
            if master {
                assert_eq!(eighth.playback, TrackPlayback::Master);
            } else {
                assert!(matches!(eighth.playback, TrackPlayback::Audio { .. }));
            }
        }
    }

    #[test]
    fn real_device_track_eight_is_master_without_a_slot() {
        let project = fixture_dir("real_device").join("project.work");
        let bank = fixture_dir("real_device").join("bank01.work");
        let project_before = fs::read(&project).unwrap();
        let bank_before = fs::read(&bank).unwrap();
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(
            structure.project_state.as_ref().unwrap().master_track,
            Some(true)
        );
        assert_track_eight(&structure, true);
        assert_eq!(fs::read(&project).unwrap(), project_before);
        assert_eq!(fs::read(&bank).unwrap(), bank_before);
    }

    #[test]
    fn master_track_off_keeps_track_eight_as_audio() {
        let project = fixture_dir("real_device").join("project.work");
        let project_before = fs::read(&project).unwrap();
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let enabled = read_project_structure(&root, &project_path()).unwrap();
        let audio_tracks = audio_tracks_before_eight(&enabled);
        set_master_track_text(&root, "0");
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(
            structure.project_state.as_ref().unwrap().master_track,
            Some(false)
        );
        assert_track_eight(&structure, false);
        assert_eq!(audio_tracks_before_eight(&structure), audio_tracks);
        assert_eq!(fs::read(&project).unwrap(), project_before);
    }

    #[test]
    fn master_track_values_other_than_one_stay_audio() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        set_master_track_text(&root, "2");
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(
            structure.project_state.as_ref().unwrap().master_track,
            Some(false)
        );
        assert_track_eight(&structure, false);

        set_master_track_text(&root, "no");
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let state = structure.project_state.as_ref().unwrap();
        assert_eq!(state.parse_status, StateDocumentParseStatus::Malformed);
        assert!(state.master_track.is_none());
        assert!(state.bank.is_none());
        assert_track_eight(&structure, false);
    }

    #[test]
    fn missing_project_work_leaves_track_eight_as_audio() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let project = root.join(PROJECT);
        fs::rename(project.join("project.work"), project.join("project.strd")).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure.project_state.is_none());
        assert_track_eight(&structure, false);
    }

    fn legacy_scale_name(
        scale: ot_domain::project_structure::PatternPlaybackScale,
    ) -> &'static str {
        use ot_domain::project_structure::PatternPlaybackScale;
        match scale {
            PatternPlaybackScale::Times2 => "2x",
            PatternPlaybackScale::Times3Over2 => "3/2x",
            PatternPlaybackScale::Times1 => "1x",
            PatternPlaybackScale::Times3Over4 => "3/4x",
            PatternPlaybackScale::Times1Over2 => "1/2x",
            PatternPlaybackScale::Times1Over4 => "1/4x",
            PatternPlaybackScale::Times1Over8 => "1/8x",
            PatternPlaybackScale::Unrecognized(raw) => panic!("unrecognized scale {raw}"),
        }
    }

    #[test]
    fn tracked_patterns_keep_scale_mode_and_lengths() {
        for fixture in ["real_device", "multipart"] {
            let (_temp, root) = copied_project(fixture, &["project.work", "bank01.work"]);
            let structure = read_project_structure(&root, &project_path()).unwrap();
            let working = structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap();
            let legacy =
                crate::project_reader::read_project_banks(root.join(PROJECT).to_str().unwrap())
                    .unwrap();
            let mut per_track = 0;
            for legacy_pattern in &legacy[0].parts[0].patterns {
                let pattern = working
                    .pattern(PatternIndex::new(legacy_pattern.id).unwrap())
                    .unwrap();
                match &pattern.scale {
                    PatternScale::Normal {
                        master_length,
                        master_scale,
                    } => {
                        assert_eq!(legacy_pattern.scale_mode, "Normal", "{fixture}");
                        assert_eq!(*master_length, legacy_pattern.length, "{fixture}");
                        assert_eq!(
                            legacy_scale_name(*master_scale),
                            legacy_pattern.master_scale,
                            "{fixture}"
                        );
                        assert!(legacy_pattern.per_track_settings.is_none(), "{fixture}");
                    }
                    PatternScale::PerTrack {
                        master_length,
                        master_scale,
                        tracks,
                    } => {
                        per_track += 1;
                        assert_eq!(legacy_pattern.scale_mode, "Per Track", "{fixture}");
                        let settings = legacy_pattern.per_track_settings.as_ref().unwrap();
                        match master_length {
                            ot_domain::project_structure::PatternMasterLength::Finite(steps) => {
                                assert_eq!(settings.master_len, steps.to_string(), "{fixture}");
                            }
                            ot_domain::project_structure::PatternMasterLength::Infinite => {
                                assert_eq!(settings.master_len, "INF", "{fixture}");
                            }
                            other => panic!("{fixture} undocumented master length {other:?}"),
                        }
                        assert_eq!(
                            legacy_scale_name(*master_scale),
                            settings.master_scale,
                            "{fixture}"
                        );
                        assert_eq!(tracks.len(), 8);
                        for (track, legacy_track) in tracks.iter().zip(legacy_pattern.tracks.iter())
                        {
                            assert_eq!(track.track.get(), legacy_track.track_id, "{fixture}");
                            assert_eq!(Some(track.length), legacy_track.per_track_len, "{fixture}");
                            assert_eq!(
                                Some(legacy_scale_name(track.scale).to_owned()),
                                legacy_track.per_track_scale,
                                "{fixture}"
                            );
                        }
                    }
                    PatternScale::Unrecognized { raw } => {
                        panic!("{fixture} pattern {} scale mode {raw}", pattern.index.get());
                    }
                }
            }
            if fixture == "real_device" {
                assert!(per_track > 0, "real_device has a per-track pattern");
                match &working
                    .pattern(PatternIndex::new(0).unwrap())
                    .unwrap()
                    .scale
                {
                    PatternScale::PerTrack { tracks, .. } => {
                        assert_eq!(tracks[1].length, 12);
                        assert_eq!(tracks[5].length, 64);
                    }
                    other => panic!("real_device pattern 0 is {other:?}"),
                }
            }
        }
    }

    #[test]
    fn per_track_scale_round_trip_keeps_each_track() {
        let bank_fixture = fixture_dir("real_device").join("bank01.work");
        let bank_before = fs::read(&bank_fixture).unwrap();
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let before = read_project_structure(&root, &project_path()).unwrap();
        rewrite_working_bank(&root, |bank| {
            let pattern = &mut bank.patterns.0[0];
            pattern.scale.scale_mode = 1;
            pattern.scale.master_len_per_track_multiplier = 1;
            pattern.scale.master_len_per_track = 4;
            pattern.scale.master_scale_per_track = 4;
            for (index, track) in pattern.audio_track_trigs.0.iter_mut().enumerate() {
                track.scale_per_track_mode.per_track_len = 8 + u8::try_from(index).unwrap();
                track.scale_per_track_mode.per_track_scale = u8::try_from(index % 7).unwrap();
            }
        });
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        match &working
            .pattern(PatternIndex::new(0).unwrap())
            .unwrap()
            .scale
        {
            PatternScale::PerTrack {
                master_length,
                master_scale,
                tracks,
            } => {
                assert_eq!(
                    *master_length,
                    ot_domain::project_structure::PatternMasterLength::Finite(260)
                );
                assert_eq!(
                    *master_scale,
                    ot_domain::project_structure::PatternPlaybackScale::Times1Over2
                );
                assert_eq!(tracks.len(), 8);
                for (index, track) in tracks.iter().enumerate() {
                    assert_eq!(track.track.get(), u8::try_from(index).unwrap());
                    assert_eq!(track.length, 8 + u8::try_from(index).unwrap());
                    assert_eq!(
                        track.scale,
                        ot_domain::project_structure::pattern_playback_scale(
                            u8::try_from(index % 7).unwrap()
                        )
                    );
                }
            }
            other => panic!("pattern 0 scale is {other:?}"),
        }
        let untouched = before.bank(bank_a(), StateDocumentRole::Working).unwrap();
        for index in 1..16u8 {
            let pattern = PatternIndex::new(index).unwrap();
            assert_eq!(
                working.pattern(pattern).unwrap().scale,
                untouched.pattern(pattern).unwrap().scale
            );
        }
        assert_eq!(fs::read(&bank_fixture).unwrap(), bank_before);
    }

    #[test]
    fn per_track_inf_master_length_is_not_finite() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        rewrite_working_bank(&root, |bank| {
            let pattern = &mut bank.patterns.0[0];
            pattern.scale.scale_mode = 1;
            pattern.scale.master_len_per_track_multiplier = 255;
            pattern.scale.master_len_per_track = 255;
            let sibling = &mut bank.patterns.0[1];
            sibling.scale.scale_mode = 0;
            sibling.scale.master_len = 255;
            sibling.scale.master_scale = 2;
        });
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        match &working
            .pattern(PatternIndex::new(0).unwrap())
            .unwrap()
            .scale
        {
            PatternScale::PerTrack { master_length, .. } => {
                assert_eq!(
                    *master_length,
                    ot_domain::project_structure::PatternMasterLength::Infinite
                );
            }
            other => panic!("pattern 0 scale is {other:?}"),
        }
        match &working
            .pattern(PatternIndex::new(1).unwrap())
            .unwrap()
            .scale
        {
            PatternScale::Normal {
                master_length,
                master_scale,
            } => {
                assert_eq!(*master_length, 255);
                assert_eq!(
                    *master_scale,
                    ot_domain::project_structure::PatternPlaybackScale::Times1
                );
            }
            other => panic!("pattern 1 scale is {other:?}"),
        }

        rewrite_working_bank(&root, |bank| {
            let pattern = &mut bank.patterns.0[0];
            pattern.scale.scale_mode = 1;
            pattern.scale.master_len_per_track_multiplier = 255;
            pattern.scale.master_len_per_track = 16;
        });
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        match &working
            .pattern(PatternIndex::new(0).unwrap())
            .unwrap()
            .scale
        {
            PatternScale::PerTrack { master_length, .. } => {
                assert_eq!(
                    *master_length,
                    ot_domain::project_structure::PatternMasterLength::Unrecognized {
                        multiplier: 255,
                        length: 16
                    }
                );
            }
            other => panic!("pattern 0 scale is {other:?}"),
        }
    }

    #[test]
    fn unrecognized_scale_mode_and_scale_stay_raw() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        rewrite_working_bank(&root, |bank| {
            bank.patterns.0[0].scale.scale_mode = 2;
            bank.patterns.0[1].scale.scale_mode = 0;
            bank.patterns.0[1].scale.master_scale = 9;
            bank.patterns.0[2].scale.scale_mode = 1;
            bank.patterns.0[2].scale.master_len_per_track_multiplier = 0;
            bank.patterns.0[2].scale.master_len_per_track = 16;
            bank.patterns.0[2].audio_track_trigs.0[3]
                .scale_per_track_mode
                .per_track_scale = 9;
        });
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(
            working
                .pattern(PatternIndex::new(0).unwrap())
                .unwrap()
                .scale,
            PatternScale::Unrecognized { raw: 2 }
        );
        match &working
            .pattern(PatternIndex::new(1).unwrap())
            .unwrap()
            .scale
        {
            PatternScale::Normal { master_scale, .. } => {
                assert_eq!(
                    *master_scale,
                    ot_domain::project_structure::PatternPlaybackScale::Unrecognized(9)
                );
            }
            other => panic!("pattern 1 scale is {other:?}"),
        }
        match &working
            .pattern(PatternIndex::new(2).unwrap())
            .unwrap()
            .scale
        {
            PatternScale::PerTrack { tracks, .. } => {
                assert_eq!(
                    tracks[3].scale,
                    ot_domain::project_structure::PatternPlaybackScale::Unrecognized(9)
                );
            }
            other => panic!("pattern 2 scale is {other:?}"),
        }
    }

    #[test]
    fn real_device_patterns_all_use_part_zero() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(working.patterns.len(), 16);
        for pattern in &working.patterns {
            assert_eq!(pattern.part.get(), 0);
        }
        assert_eq!(working.unmodeled, BANK_UNMODELED_DEPENDENCIES.to_vec());
    }

    #[test]
    fn track_slots_match_catalog_machine_usage_edges() {
        for fixture in ["real_device", "multipart"] {
            let (_temp, root) = copied_project(fixture, &["project.work", "bank01.work"]);
            let structure = read_project_structure(&root, &project_path()).unwrap();
            let working = structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap();

            let project_dir = root.join(PROJECT);
            let usage = crate::project_reader::compute_sample_usage_for_documents(
                &project_dir.join("project.work"),
                &project_dir.join("bank01.work"),
                0,
            )
            .unwrap();
            let mut compared = 0;
            for (kind, pool) in [
                (SampleSlotKind::Static, &usage.static_usage),
                (SampleSlotKind::Flex, &usage.flex_usage),
            ] {
                for (index, entries) in pool.iter().enumerate() {
                    for entry in entries.iter().filter(|entry| entry.kind == "machine") {
                        let part = working
                            .part(PartIndex::new(entry.part.unwrap()).unwrap())
                            .unwrap();
                        let track = &part.tracks[usize::from(entry.track)];
                        let expected =
                            SampleSlotId::new(kind, u16::try_from(index + 1).unwrap()).unwrap();
                        let (_, slot) = audio_playback(track);
                        assert_eq!(slot, TrackSlotReference::Slot(expected), "{fixture}");
                        compared += 1;
                    }
                }
            }
            assert!(
                compared > 0,
                "{fixture} produced no machine usage to compare"
            );
        }
    }

    #[test]
    fn undecodable_bank_is_malformed_without_partial_structure() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        fs::write(root.join(PROJECT).join("bank02.work"), b"not a bank").unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let broken = structure
            .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(broken.parse_status, StateDocumentParseStatus::Malformed);
        assert!(broken.patterns.is_empty());
        assert!(broken.parts.is_empty());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
    }

    #[test]
    fn bank_failing_validation_is_malformed_without_partial_structure() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let bank_file = root.join(PROJECT).join("bank01.work");
        let mut bytes = fs::read(&bank_file).unwrap();
        bytes[0] ^= 0x01;
        fs::write(&bank_file, bytes).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let entry = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_ne!(entry.parse_status, StateDocumentParseStatus::Parsed);
        assert!(entry.patterns.is_empty());
        assert!(entry.parts.is_empty());
    }

    #[test]
    fn reading_structure_leaves_every_file_byte_identical() {
        let (_temp, root) = copied_project(
            "real_device",
            &[
                "project.work",
                "bank01.work",
                "bank01.strd",
                "markers.work",
                "arr01.work",
            ],
        );
        let before = tree_digest(&root);
        read_project_structure(&root, &project_path()).unwrap();
        read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(tree_digest(&root), before);
    }

    #[test]
    fn repeated_reads_return_equal_structure() {
        let (_temp, root) = copied_project(
            "real_device",
            &["project.work", "bank01.work", "bank01.strd"],
        );
        let first = read_project_structure(&root, &project_path()).unwrap();
        let second = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(first, second);
        let roles: Vec<_> = first
            .banks
            .iter()
            .map(|entry| (entry.bank.get(), entry.role))
            .collect();
        assert_eq!(
            roles,
            vec![
                (0, StateDocumentRole::Working),
                (0, StateDocumentRole::SavedCheckpoint)
            ]
        );
    }

    #[test]
    fn project_path_escaping_the_root_is_rejected() {
        let (_temp, root) = copied_project("real_device", &["project.work"]);
        assert!(RootRelativePath::parse("../outside").is_err());
        let missing = RootRelativePath::parse("SET/MISSING").unwrap();
        assert!(read_project_structure(&root, &missing).is_err());
    }

    #[test]
    fn missing_project_rejection_leaves_fixture_bytes_unchanged() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let before = tree_digest(&root);
        let missing = RootRelativePath::parse("SET/MISSING").unwrap();
        assert!(read_project_structure(&root, &missing).is_err());
        assert_eq!(tree_digest(&root), before);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_bank_file_is_a_storage_error() {
        use std::os::unix::fs::PermissionsExt;
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let bank = root.join(PROJECT).join("bank02.work");
        fs::copy(root.join(PROJECT).join("bank01.work"), &bank).unwrap();
        let before = tree_digest(&root);
        let mut permissions = fs::metadata(&bank).unwrap().permissions();
        permissions.set_mode(0o0);
        fs::set_permissions(&bank, permissions.clone()).unwrap();
        assert!(
            fs::File::open(&bank).is_err(),
            "mode 000 must deny this user from reading the bank"
        );
        let error = read_project_structure(&root, &project_path()).unwrap_err();
        assert!(
            error.message().starts_with("LIBRARY_SCAN_FAILED"),
            "{}",
            error.message()
        );
        permissions.set_mode(0o644);
        fs::set_permissions(&bank, permissions).unwrap();
        assert_eq!(tree_digest(&root), before);
    }

    #[test]
    fn directory_named_as_bank_file_is_absent() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        fs::create_dir(root.join(PROJECT).join("bank02.work")).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure
            .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
            .is_none());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_bank_is_treated_as_absent() {
        let (temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("bank02.work");
        fs::copy(fixture_dir("real_device").join("bank01.work"), &target).unwrap();
        std::os::unix::fs::symlink(&target, temp.path().join(PROJECT).join("bank02.work")).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure
            .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
            .is_none());
    }

    #[test]
    fn machine_slot_raw_values_map_without_guessing() {
        let flex = SampleSlotKind::Flex;
        assert_eq!(
            track_slot_reference_from_raw(flex, 0),
            TrackSlotReference::Slot(SampleSlotId::new(flex, 1).unwrap())
        );
        assert_eq!(
            track_slot_reference_from_raw(flex, 127),
            TrackSlotReference::Slot(SampleSlotId::new(flex, 128).unwrap())
        );
        assert_eq!(
            track_slot_reference_from_raw(flex, 255),
            TrackSlotReference::Unassigned
        );
        assert_eq!(
            track_slot_reference_from_raw(flex, 129),
            TrackSlotReference::RecorderBuffer(RecorderBufferId::new(129).unwrap())
        );
        assert_eq!(
            track_slot_reference_from_raw(flex, 128),
            TrackSlotReference::Unrecognized(128)
        );
        assert_eq!(
            track_slot_reference_from_raw(SampleSlotKind::Static, 129),
            TrackSlotReference::Unrecognized(129)
        );
    }

    #[test]
    fn external_copy_harness_reads_when_root_is_set() {
        let Ok(root) = std::env::var("PSE_READ_MODEL_ROOT") else {
            return;
        };
        // Registered roots are canonical. macOS /var -> /private/var must not
        // be treated as PATH_ESCAPE when the copied tree itself did not move.
        let root = PathBuf::from(root)
            .canonicalize()
            .expect("copied fixture root");
        let project = RootRelativePath::parse(
            std::env::var("PSE_READ_MODEL_PROJECT")
                .as_deref()
                .unwrap_or("SET/PROJECT"),
        )
        .expect("project path");
        let expect = std::env::var("PSE_READ_MODEL_EXPECT").unwrap_or_else(|_| "ok".into());
        match expect.as_str() {
            "ok" => {
                let first = read_project_structure(Path::new(&root), &project).unwrap();
                let second = read_project_structure(Path::new(&root), &project).unwrap();
                assert_eq!(first, second);
                assert!(first
                    .banks
                    .iter()
                    .any(|entry| entry.parse_status == StateDocumentParseStatus::Parsed));
                assert!(first
                    .banks
                    .iter()
                    .filter(|entry| entry.parse_status == StateDocumentParseStatus::Parsed)
                    .all(|entry| entry.unmodeled == BANK_UNMODELED_DEPENDENCIES.to_vec()));
            }
            "missing" => {
                let missing = RootRelativePath::parse("SET/MISSING").unwrap();
                assert!(read_project_structure(Path::new(&root), &missing).is_err());
            }
            "mixed" => {
                let structure = read_project_structure(Path::new(&root), &project).unwrap();
                let broken = structure
                    .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
                    .unwrap();
                assert_eq!(broken.parse_status, StateDocumentParseStatus::Malformed);
                assert!(broken.patterns.is_empty());
                assert!(broken.parts.is_empty());
                assert_eq!(
                    structure
                        .bank(bank_a(), StateDocumentRole::Working)
                        .unwrap()
                        .parse_status,
                    StateDocumentParseStatus::Parsed
                );
            }
            "symlink_absent" => {
                let structure = read_project_structure(Path::new(&root), &project).unwrap();
                assert!(structure
                    .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
                    .is_none());
                assert_eq!(
                    structure
                        .bank(bank_a(), StateDocumentRole::Working)
                        .unwrap()
                        .parse_status,
                    StateDocumentParseStatus::Parsed
                );
            }
            other => panic!("unknown PSE_READ_MODEL_EXPECT {other}"),
        }
        eprintln!("PSE_READ_MODEL_HARNESS_OK={expect}");
    }
}
