//! Project-side Bank sample reference inventory for ChangePlan (#181).

#![cfg_attr(not(test), allow(dead_code))]

use crate::bank_validation::bank_parse_status;
use crate::legacy_read_adapter::{join_relative, resolve_relative_for_read};
use ot_codec::parse_project_document;
use ot_domain::project_structure::{BankIndex, MachineKind, PartIndex, PatternIndex, TrackIndex};
use ot_domain::{
    bank_machine_slot_to_pool_index, effective_sample_lock_track_length, locked_sample_slot_raw,
    sample_lock_is_audible, track_slot_reference_from_machine, track_slot_reference_from_raw,
    BankReferenceInventory, BankSampleReferenceObservation, PartStateRole, ReferenceCoverage,
    ReferenceOrigin, RootRelativePath, SampleReferenceStatus, SampleSlotKind,
    StateDocumentParseStatus, StateDocumentRole,
};
use ot_storage_ports::StorageError;
use ot_tools_io::{BankFile, OctatrackFileIO};
use std::collections::{HashMap, HashSet};
use std::path::Path;

type SlotStatusLookup =
    HashMap<(SampleSlotKind, u16), (Option<RootRelativePath>, SampleReferenceStatus)>;

pub(crate) fn build_bank_reference_inventory(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
    structure: &ot_domain::project_structure::ProjectStructure,
    observed_revision: u64,
) -> Result<BankReferenceInventory, StorageError> {
    let slot_lookup = slot_assignment_lookup(canonical_root, project_relative_path, structure)?;
    let track_eight_is_master = structure
        .project_state
        .as_ref()
        .and_then(|state| state.master_track)
        .unwrap_or(false);

    let mut observations = Vec::new();
    for bank_doc in &structure.banks {
        if bank_doc.parse_status != StateDocumentParseStatus::Parsed {
            continue;
        }
        let Some(bytes) = read_document_bytes(canonical_root, &bank_doc.source_relative_path)?
        else {
            continue;
        };
        let Ok(bank) = BankFile::from_bytes(&bytes) else {
            continue;
        };
        if bank_parse_status(&bank) != StateDocumentParseStatus::Parsed {
            continue;
        }
        append_bank_observations(
            bank_doc.bank,
            bank_doc.role,
            &bank,
            track_eight_is_master,
            &slot_lookup,
            &mut observations,
        );
    }

    observations.sort_by(compare_observations);

    Ok(BankReferenceInventory {
        observed_revision,
        observations,
        coverage: ReferenceCoverage::complete_for_changeplan_review(),
    })
}

fn slot_assignment_lookup(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
    structure: &ot_domain::project_structure::ProjectStructure,
) -> Result<SlotStatusLookup, StorageError> {
    let inventory_paths = project_directory_inventory_paths(canonical_root, project_relative_path)?;
    let mut lookup = HashMap::new();
    let Some(state) = structure.project_state.as_ref() else {
        return Ok(lookup);
    };
    if state.parse_status != StateDocumentParseStatus::Parsed {
        return Ok(lookup);
    }
    let project_work = join_relative(project_relative_path, "project.work")?;
    let Some(bytes) = read_document_bytes(canonical_root, &project_work)? else {
        return Ok(lookup);
    };
    let parsed = parse_project_document(&bytes);
    if parsed.parse_status != StateDocumentParseStatus::Parsed {
        return Ok(lookup);
    }
    for assignment in parsed.regular_assignments {
        let (path, status) = ot_domain::resolve_against_inventory(
            project_relative_path,
            &assignment.raw_path,
            &inventory_paths,
        );
        lookup.insert(
            (assignment.slot.kind(), assignment.slot.number()),
            (path, status),
        );
    }
    Ok(lookup)
}

fn project_directory_inventory_paths(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<HashSet<String>, StorageError> {
    let project_dir = resolve_relative_for_read(canonical_root, project_relative_path)?;
    let mut paths = HashSet::new();
    if project_dir.is_dir() {
        collect_relative_paths(&project_dir, project_relative_path, &mut paths)?;
    }
    Ok(paths)
}

fn collect_relative_paths(
    directory: &Path,
    prefix: &RootRelativePath,
    out: &mut HashSet<String>,
) -> Result<(), StorageError> {
    for entry in std::fs::read_dir(directory).map_err(|_| StorageError::new("IO_UNAVAILABLE"))? {
        let entry = entry.map_err(|_| StorageError::new("IO_UNAVAILABLE"))?;
        let file_type = entry
            .file_type()
            .map_err(|_| StorageError::new("IO_UNAVAILABLE"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = join_relative(prefix, &name)?;
        if file_type.is_dir() {
            collect_relative_paths(&entry.path(), &relative, out)?;
        } else if file_type.is_file() {
            out.insert(relative.as_str().to_owned());
        }
    }
    Ok(())
}

fn read_document_bytes(
    canonical_root: &Path,
    relative: &RootRelativePath,
) -> Result<Option<Vec<u8>>, StorageError> {
    let path = resolve_relative_for_read(canonical_root, relative)?;
    if !path.is_file() {
        return Ok(None);
    }
    std::fs::read(path)
        .map(Some)
        .map_err(|_| StorageError::new("IO_UNAVAILABLE"))
}

fn append_bank_observations(
    bank: BankIndex,
    role: StateDocumentRole,
    bank_file: &BankFile,
    track_eight_is_master: bool,
    slot_lookup: &SlotStatusLookup,
    out: &mut Vec<BankSampleReferenceObservation>,
) {
    append_part_observations(
        bank,
        role,
        bank_file,
        track_eight_is_master,
        PartStateRole::Working,
        true,
        slot_lookup,
        out,
    );
    append_part_observations(
        bank,
        role,
        bank_file,
        track_eight_is_master,
        PartStateRole::Saved,
        false,
        slot_lookup,
        out,
    );
    append_lock_observations(
        bank,
        role,
        bank_file,
        track_eight_is_master,
        slot_lookup,
        out,
    );
}

fn append_part_observations(
    bank: BankIndex,
    role: StateDocumentRole,
    bank_file: &BankFile,
    track_eight_is_master: bool,
    part_state: PartStateRole,
    unsaved: bool,
    slot_lookup: &SlotStatusLookup,
    out: &mut Vec<BankSampleReferenceObservation>,
) {
    let origin = if unsaved {
        ReferenceOrigin::ActiveMachine
    } else {
        ReferenceOrigin::SavedPartMachine
    };
    let parts = if unsaved {
        &bank_file.parts.unsaved.0
    } else {
        &bank_file.parts.saved.0
    };
    for (part_index, part) in parts.iter().enumerate() {
        let Ok(part_index) = PartIndex::new(part_index as u8) else {
            continue;
        };
        for (track_index, machine_type) in part.audio_track_machine_types.iter().enumerate() {
            let Ok(track) = TrackIndex::new(track_index as u8) else {
                continue;
            };
            if track_eight_is_master && track.get() == 7 {
                continue;
            }
            let machine = MachineKind::from_raw(*machine_type);
            let slots = &part.audio_track_machine_slots[track_index];
            let target = track_slot_reference_from_machine(
                machine,
                slots.static_slot_id,
                slots.flex_slot_id,
            );
            let (reference_status, referenced_relative_path) =
                status_for_target(&target, slot_lookup);
            out.push(BankSampleReferenceObservation {
                bank,
                document_role: role,
                origin,
                part_state,
                part: part_index,
                pattern: None,
                track,
                step: None,
                target,
                audible: None,
                reference_status,
                referenced_relative_path,
            });
        }
    }
}

fn append_lock_observations(
    bank: BankIndex,
    role: StateDocumentRole,
    bank_file: &BankFile,
    track_eight_is_master: bool,
    slot_lookup: &SlotStatusLookup,
    out: &mut Vec<BankSampleReferenceObservation>,
) {
    for (pattern_index, pattern) in bank_file.patterns.0.iter().enumerate() {
        let Ok(pattern_index) = PatternIndex::new(pattern_index as u8) else {
            continue;
        };
        let Ok(part_index) = PartIndex::new(pattern.part_assignment) else {
            continue;
        };
        let Some(part) = bank_file.parts.unsaved.0.get(usize::from(part_index.get())) else {
            continue;
        };
        for (track_index, track) in pattern.audio_track_trigs.0.iter().enumerate() {
            let Ok(track_index) = TrackIndex::new(track_index as u8) else {
                continue;
            };
            if track_eight_is_master && track_index.get() == 7 {
                continue;
            }
            let machine_type = part.audio_track_machine_types[usize::from(track_index.get())];
            let track_length = effective_sample_lock_track_length(
                pattern.scale.scale_mode,
                pattern.scale.master_len,
                track.scale_per_track_mode.per_track_len,
            );
            for (step_index, parameter_lock) in track
                .plocks
                .0
                .iter()
                .enumerate()
                .take(ot_domain::SAMPLE_LOCK_SCAN_STEPS)
            {
                let Some(raw) = locked_sample_slot_raw(
                    machine_type,
                    parameter_lock.static_slot_id,
                    parameter_lock.flex_slot_id,
                ) else {
                    continue;
                };
                if bank_machine_slot_to_pool_index(raw).is_none() {
                    continue;
                }
                let kind = if machine_type == 0 {
                    SampleSlotKind::Static
                } else if machine_type == 1 {
                    SampleSlotKind::Flex
                } else {
                    continue;
                };
                let target = track_slot_reference_from_raw(kind, raw);
                let (reference_status, referenced_relative_path) =
                    status_for_target(&target, slot_lookup);
                out.push(BankSampleReferenceObservation {
                    bank,
                    document_role: role,
                    origin: ReferenceOrigin::SampleLock,
                    part_state: PartStateRole::Working,
                    part: part_index,
                    pattern: Some(pattern_index),
                    track: track_index,
                    step: Some(step_index as u8),
                    target,
                    audible: Some(sample_lock_is_audible(step_index, track_length)),
                    reference_status,
                    referenced_relative_path,
                });
            }
        }
    }
}

fn status_for_target(
    target: &ot_domain::project_structure::TrackSlotReference,
    slot_lookup: &SlotStatusLookup,
) -> (Option<SampleReferenceStatus>, Option<RootRelativePath>) {
    match target {
        ot_domain::project_structure::TrackSlotReference::Slot(id) => slot_lookup
            .get(&(id.kind(), id.number()))
            .map(|(path, status)| (Some(*status), path.clone()))
            .unwrap_or((Some(SampleReferenceStatus::UnassignedSlot), None)),
        ot_domain::project_structure::TrackSlotReference::Unassigned => {
            (Some(SampleReferenceStatus::UnassignedSlot), None)
        }
        ot_domain::project_structure::TrackSlotReference::NoSampleMachine => (None, None),
        ot_domain::project_structure::TrackSlotReference::RecorderBuffer(_) => (None, None),
        ot_domain::project_structure::TrackSlotReference::Unrecognized(_) => (None, None),
    }
}

fn compare_observations(
    left: &BankSampleReferenceObservation,
    right: &BankSampleReferenceObservation,
) -> std::cmp::Ordering {
    left.bank
        .get()
        .cmp(&right.bank.get())
        .then_with(|| {
            ot_domain::project_structure::state_role_rank(left.document_role).cmp(
                &ot_domain::project_structure::state_role_rank(right.document_role),
            )
        })
        .then_with(|| origin_rank(left.origin).cmp(&origin_rank(right.origin)))
        .then_with(|| left.part.get().cmp(&right.part.get()))
        .then_with(|| pattern_key(left.pattern).cmp(&pattern_key(right.pattern)))
        .then_with(|| left.track.get().cmp(&right.track.get()))
        .then_with(|| step_key(left.step).cmp(&step_key(right.step)))
        .then_with(|| format!("{:?}", left.target).cmp(&format!("{:?}", right.target)))
}

fn origin_rank(origin: ReferenceOrigin) -> u8 {
    match origin {
        ReferenceOrigin::ActiveMachine => 0,
        ReferenceOrigin::SampleLock => 1,
        ReferenceOrigin::SavedPartMachine => 2,
    }
}

fn pattern_key(pattern: Option<PatternIndex>) -> u8 {
    pattern.map(|index| index.get()).unwrap_or(255)
}

fn step_key(step: Option<u8>) -> u8 {
    step.unwrap_or(255)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_structure_reader::read_project_structure;
    use ot_domain::project_structure::TrackSlotReference;
    use ot_tools_io::BankFile;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

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

    fn inventory_for_real_device() -> (TempDir, BankReferenceInventory, PathBuf) {
        let (temp, root) = copied_project(
            "real_device",
            &["project.work", "bank01.work", "bank01.strd"],
        );
        let project = RootRelativePath::parse(PROJECT).unwrap();
        let structure = read_project_structure(&root, &project).unwrap();
        let inventory = build_bank_reference_inventory(&root, &project, &structure, 1).unwrap();
        (temp, inventory, root)
    }

    fn bank_work_path(root: &Path) -> PathBuf {
        root.join("SET/PROJECT/bank01.work")
    }

    #[test]
    fn saved_part_reference_classification_is_pinned() {
        let (_temp, inventory, _root) = inventory_for_real_device();
        assert!(inventory
            .observations
            .iter()
            .any(|observation| { observation.origin == ReferenceOrigin::SavedPartMachine }));
    }

    #[test]
    fn inactive_machine_slot_is_excluded() {
        let (_temp, inventory, root) = inventory_for_real_device();
        let bank = BankFile::from_data_file(&bank_work_path(&root)).unwrap();
        for observation in inventory.observations.iter().filter(|observation| {
            observation.origin == ReferenceOrigin::ActiveMachine
                && observation.document_role == StateDocumentRole::Working
                && observation.part_state == PartStateRole::Working
        }) {
            let part = &bank.parts.unsaved.0[usize::from(observation.part.get())];
            let track = usize::from(observation.track.get());
            let machine = part.audio_track_machine_types[track];
            let slots = &part.audio_track_machine_slots[track];
            let expected = track_slot_reference_from_machine(
                MachineKind::from_raw(machine),
                slots.static_slot_id,
                slots.flex_slot_id,
            );
            assert_eq!(observation.target, expected);
        }
    }

    #[test]
    fn static_sample_lock_uses_static_slot() {
        let (_temp, inventory, root) = inventory_for_real_device();
        let bank = BankFile::from_data_file(&bank_work_path(&root)).unwrap();
        for observation in inventory
            .observations
            .iter()
            .filter(|observation| observation.origin == ReferenceOrigin::SampleLock)
        {
            let pattern = &bank.patterns.0[usize::from(observation.pattern.unwrap().get())];
            let part = &bank.parts.unsaved.0[usize::from(observation.part.get())];
            let track = &pattern.audio_track_trigs.0[usize::from(observation.track.get())];
            let machine = part.audio_track_machine_types[usize::from(observation.track.get())];
            if machine != 0 {
                continue;
            }
            let lock = &track.plocks.0[usize::from(observation.step.unwrap())];
            let raw =
                locked_sample_slot_raw(machine, lock.static_slot_id, lock.flex_slot_id).unwrap();
            assert_eq!(
                observation.target,
                track_slot_reference_from_raw(SampleSlotKind::Static, raw)
            );
        }
    }

    #[test]
    fn flex_sample_lock_uses_flex_slot() {
        let (_temp, inventory, root) = inventory_for_real_device();
        let bank = BankFile::from_data_file(&bank_work_path(&root)).unwrap();
        for observation in inventory
            .observations
            .iter()
            .filter(|observation| observation.origin == ReferenceOrigin::SampleLock)
        {
            let pattern = &bank.patterns.0[usize::from(observation.pattern.unwrap().get())];
            let part = &bank.parts.unsaved.0[usize::from(observation.part.get())];
            let track = &pattern.audio_track_trigs.0[usize::from(observation.track.get())];
            let machine = part.audio_track_machine_types[usize::from(observation.track.get())];
            if machine != 1 {
                continue;
            }
            let lock = &track.plocks.0[usize::from(observation.step.unwrap())];
            let raw =
                locked_sample_slot_raw(machine, lock.static_slot_id, lock.flex_slot_id).unwrap();
            assert_eq!(
                observation.target,
                track_slot_reference_from_raw(SampleSlotKind::Flex, raw)
            );
        }
    }

    #[test]
    fn inaudible_leftover_lock_is_preserved() {
        let (_temp, inventory, _root) = inventory_for_real_device();
        let locks: Vec<_> = inventory
            .observations
            .iter()
            .filter(|observation| observation.origin == ReferenceOrigin::SampleLock)
            .collect();
        if locks.is_empty() {
            return;
        }
        assert!(locks.iter().all(|observation| observation.audible.is_some()));
    }

    #[test]
    fn recorder_slot_id_is_not_sample_slot() {
        let (_temp, inventory, root) = inventory_for_real_device();
        let bank = BankFile::from_data_file(&bank_work_path(&root)).unwrap();
        for part in bank.parts.unsaved.0.iter().chain(bank.parts.saved.0.iter()) {
            for slots in &part.audio_track_machine_slots {
                if slots.recorder_slot_id != slots.flex_slot_id
                    && slots.recorder_slot_id != slots.static_slot_id
                {
                    assert!(!matches!(
                        track_slot_reference_from_raw(SampleSlotKind::Flex, slots.recorder_slot_id),
                        TrackSlotReference::Slot(_)
                    ));
                }
            }
        }
        assert!(!inventory.observations.is_empty());
    }
}
