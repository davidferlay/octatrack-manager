//! Project-side Bank sample reference inventory for ChangePlan (#181).

#![cfg_attr(not(test), allow(dead_code))]

use crate::bank_validation::bank_parse_status;
use crate::legacy_read_adapter::root_audio_inventory_paths;
use crate::project_structure_reader::read_contained_state_document_bytes;
use ot_codec::parse_project_document;
use ot_domain::project_structure::{BankIndex, MachineKind, PartIndex, PatternIndex, TrackIndex};
use ot_domain::{
    effective_sample_lock_track_length, locked_sample_slot_raw, sample_lock_is_audible,
    track_slot_reference_from_machine, track_slot_reference_from_raw, BankReferenceInventory,
    BankSampleReferenceObservation, PartStateRole, ReferenceCoverage, ReferenceOrigin,
    RootRelativePath, SampleReferenceStatus, SampleSlotKind, StateDocumentParseStatus,
    StateDocumentRole,
};
use ot_storage_ports::StorageError;
use ot_tools_io::{BankFile, OctatrackFileIO};
use std::collections::HashMap;
use std::path::Path;

type SlotStatusLookup = HashMap<
    (StateDocumentRole, SampleSlotKind, u16),
    (Option<RootRelativePath>, SampleReferenceStatus),
>;

const BANK_REREAD_MISSING: &str =
    "BANK_REFERENCE_INVENTORY: parsed bank document missing on reread";
const BANK_REREAD_DECODE: &str =
    "BANK_REFERENCE_INVENTORY: parsed bank document could not be decoded on reread";

pub(crate) fn build_bank_reference_inventory(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
    structure: &ot_domain::project_structure::ProjectStructure,
    observed_revision: u64,
) -> Result<BankReferenceInventory, StorageError> {
    let slot_lookup = slot_assignment_lookup(canonical_root, project_relative_path)?;
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
        let Some(file_name) = bank_doc
            .source_relative_path
            .as_str()
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
        else {
            return Err(StorageError::new(BANK_REREAD_MISSING));
        };
        let Some(bytes) =
            read_contained_state_document_bytes(canonical_root, project_relative_path, file_name)?
        else {
            return Err(StorageError::new(BANK_REREAD_MISSING));
        };
        let Ok(bank) = BankFile::from_bytes(&bytes) else {
            return Err(StorageError::new(BANK_REREAD_DECODE));
        };
        if bank_parse_status(&bank) != StateDocumentParseStatus::Parsed {
            return Err(StorageError::new(BANK_REREAD_DECODE));
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
) -> Result<SlotStatusLookup, StorageError> {
    let inventory_paths = root_audio_inventory_paths(canonical_root)?;
    let mut lookup = HashMap::new();
    for (role, extension) in [
        (StateDocumentRole::Working, "work"),
        (StateDocumentRole::SavedCheckpoint, "strd"),
    ] {
        let file_name = format!("project.{extension}");
        let Some(bytes) =
            read_contained_state_document_bytes(canonical_root, project_relative_path, &file_name)?
        else {
            continue;
        };
        let parsed = parse_project_document(&bytes);
        if parsed.parse_status != StateDocumentParseStatus::Parsed {
            continue;
        }
        for assignment in parsed.regular_assignments {
            let (path, status) = ot_domain::resolve_against_inventory(
                project_relative_path,
                &assignment.raw_path,
                &inventory_paths,
            );
            lookup.insert(
                (role, assignment.slot.kind(), assignment.slot.number()),
                (path, status),
            );
        }
    }
    Ok(lookup)
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
                status_for_target(role, &target, slot_lookup);
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
                let kind = if machine_type == 0 {
                    SampleSlotKind::Static
                } else if machine_type == 1 {
                    SampleSlotKind::Flex
                } else {
                    continue;
                };
                let target = track_slot_reference_from_raw(kind, raw);
                let (reference_status, referenced_relative_path) =
                    status_for_target(role, &target, slot_lookup);
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
    document_role: StateDocumentRole,
    target: &ot_domain::project_structure::TrackSlotReference,
    slot_lookup: &SlotStatusLookup,
) -> (Option<SampleReferenceStatus>, Option<RootRelativePath>) {
    match target {
        ot_domain::project_structure::TrackSlotReference::Slot(id) => slot_lookup
            .get(&(document_role, id.kind(), id.number()))
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
    use ot_domain::SampleReferenceStatus;
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
    fn flex_recorder_buffer_lock_is_inventoried() {
        let (_temp, inventory, root) = inventory_for_real_device();
        let bank = BankFile::from_data_file(&bank_work_path(&root)).unwrap();
        let expects_recorder_lock = bank.patterns.0.iter().any(|pattern| {
            let Ok(part_index) = PartIndex::new(pattern.part_assignment) else {
                return false;
            };
            let Some(part) = bank.parts.unsaved.0.get(usize::from(part_index.get())) else {
                return false;
            };
            pattern
                .audio_track_trigs
                .0
                .iter()
                .enumerate()
                .any(|(track_index, track)| {
                    let machine = part.audio_track_machine_types[track_index];
                    if machine != 1 {
                        return false;
                    }
                    track
                        .plocks
                        .0
                        .iter()
                        .take(ot_domain::SAMPLE_LOCK_SCAN_STEPS)
                        .any(|lock| {
                            locked_sample_slot_raw(machine, lock.static_slot_id, lock.flex_slot_id)
                                .is_some_and(|raw| {
                                    matches!(
                                        track_slot_reference_from_raw(SampleSlotKind::Flex, raw),
                                        TrackSlotReference::RecorderBuffer(_)
                                    )
                                })
                        })
                })
        });
        if !expects_recorder_lock {
            return;
        }
        assert!(inventory.observations.iter().any(|observation| {
            observation.origin == ReferenceOrigin::SampleLock
                && matches!(observation.target, TrackSlotReference::RecorderBuffer(_))
        }));
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
        assert!(locks
            .iter()
            .all(|observation| observation.audible.is_some()));
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

    #[test]
    fn audio_pool_path_outside_project_resolves_against_root_inventory() {
        let temp = TempDir::new().unwrap();
        let audio = temp.path().join("SET/AUDIO");
        fs::create_dir_all(&audio).unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        fs::copy(
            fixture_dir("real_device").join("project.work"),
            project.join("project.work"),
        )
        .unwrap();
        fs::copy(
            fixture_dir("real_device").join("bank01.work"),
            project.join("bank01.work"),
        )
        .unwrap();
        let percs = audio.join("Elektron").join("Percs.wav");
        fs::create_dir_all(percs.parent().unwrap()).unwrap();
        fs::write(&percs, b"RIFF").unwrap();
        let root = temp.path().canonicalize().unwrap();
        let project_path = RootRelativePath::parse(PROJECT).unwrap();
        let structure = read_project_structure(&root, &project_path).unwrap();
        let inventory =
            build_bank_reference_inventory(&root, &project_path, &structure, 1).unwrap();
        assert!(inventory.observations.iter().any(|observation| {
            observation.reference_status == Some(SampleReferenceStatus::Resolved)
                && observation
                    .referenced_relative_path
                    .as_ref()
                    .is_some_and(|path| path.as_str() == "SET/AUDIO/Elektron/Percs.wav")
        }));
    }

    #[test]
    fn saved_checkpoint_uses_strd_slot_assignments() {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        let work = fs::read_to_string(fixture_dir("real_device").join("project.work")).unwrap();
        fs::write(project.join("project.work"), &work).unwrap();
        let strd = work.replace(
            "SLOT=045\r\nPATH=../AUDIO/Elektron/Percs.wav",
            "SLOT=045\r\nPATH=../AUDIO/Elektron/Acdrum.wav",
        );
        assert_ne!(work, strd);
        fs::write(project.join("project.strd"), strd).unwrap();
        for file in ["bank01.work", "bank01.strd"] {
            fs::copy(fixture_dir("real_device").join(file), project.join(file)).unwrap();
        }
        let audio = temp.path().join("SET/AUDIO/Elektron");
        fs::create_dir_all(&audio).unwrap();
        fs::write(audio.join("Percs.wav"), b"RIFF").unwrap();
        fs::write(audio.join("Acdrum.wav"), b"RIFF").unwrap();
        let root = temp.path().canonicalize().unwrap();
        let project_path = RootRelativePath::parse(PROJECT).unwrap();
        let structure = read_project_structure(&root, &project_path).unwrap();
        let inventory =
            build_bank_reference_inventory(&root, &project_path, &structure, 1).unwrap();
        let flex_45 = (
            SampleSlotKind::Flex,
            45_u16,
            RootRelativePath::parse("SET/AUDIO/Elektron/Percs.wav").unwrap(),
            RootRelativePath::parse("SET/AUDIO/Elektron/Acdrum.wav").unwrap(),
        );
        let working_path = inventory
            .observations
            .iter()
            .find(|observation| {
                observation.document_role == StateDocumentRole::Working
                    && observation.target
                        == TrackSlotReference::Slot(
                            ot_domain::SampleSlotId::new(flex_45.0, flex_45.1).unwrap(),
                        )
            })
            .and_then(|observation| observation.referenced_relative_path.clone());
        let checkpoint_path = inventory
            .observations
            .iter()
            .find(|observation| {
                observation.document_role == StateDocumentRole::SavedCheckpoint
                    && observation.target
                        == TrackSlotReference::Slot(
                            ot_domain::SampleSlotId::new(flex_45.0, flex_45.1).unwrap(),
                        )
            })
            .and_then(|observation| observation.referenced_relative_path.clone());
        assert_eq!(working_path.as_ref(), Some(&flex_45.2));
        assert_eq!(checkpoint_path.as_ref(), Some(&flex_45.3));
    }

    #[test]
    fn parsed_bank_missing_on_reread_fails_closed() {
        let (temp, root) = copied_project(
            "real_device",
            &["project.work", "bank01.work", "bank01.strd"],
        );
        let project = RootRelativePath::parse(PROJECT).unwrap();
        let structure = read_project_structure(&root, &project).unwrap();
        fs::remove_file(root.join("SET/PROJECT/bank01.work")).unwrap();
        let error = build_bank_reference_inventory(&root, &project, &structure, 1).unwrap_err();
        assert!(error.to_string().contains(BANK_REREAD_MISSING));
        drop(temp);
    }
}
