//! Locks: values of a Part that Reload keeps instead of putting back to the saved copy.
//!
//! A value is named by a JSON pointer into the serialized `PartCopy` (see
//! `project_reader::copy_value`). Locks live in `<project>/om_parts-pinned-values.json`, shaped
//! `{"A": {"0": ["/part/fxs/0/fx1_param3"]}}` - bank letter, then Part index - and the
//! file is removed when no lock is left.
//!
//! A lock only means something while the two copies differ at its value, so every
//! write path prunes: what is stored is never trusted, `effective` re-derives what still
//! holds from the bank itself.

use crate::project_reader::{bank_file_path, copy_value};
use ot_tools_io::{BankFile, OctatrackFileIO};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Bank letter, then Part index, then the pointers locked there.
type Locks = BTreeMap<String, BTreeMap<u8, BTreeSet<String>>>;

const PART_SECTIONS: [&str; 11] = [
    "machines",
    "volumes",
    "amps",
    "lfos",
    "fxs",
    "recorders",
    "midi_notes",
    "midi_arps",
    "midi_lfos",
    "midi_ctrl1s",
    "midi_ctrl2s",
];
const SCENE_PAGES: [&str; 5] = ["machine", "lfo", "amp", "fx1", "fx2"];

pub fn locks_file(project: &str) -> PathBuf {
    Path::new(project).join("om_parts-pinned-values.json")
}

/// A decimal index in `0..max`, written the one canonical way (no sign, no leading
/// zero), so that two spellings of the same value cannot both be stored.
fn index(segment: &str, max: usize) -> bool {
    segment
        .parse::<usize>()
        .is_ok_and(|n| n < max && n.to_string() == segment)
}

/// Whether a pointer names a value a lock may be placed on.
pub fn valid_path(path: &str) -> bool {
    let seg: Vec<&str> = path.split('/').collect();
    if !seg[0].is_empty() {
        return false;
    }
    match seg[1..] {
        ["part", section, track, ref field @ ..] => {
            PART_SECTIONS.contains(&section)
                && index(track, 8)
                && !field.is_empty()
                && field.iter().all(|f| !f.is_empty())
        }
        ["scenes", "scene_a"] | ["scenes", "scene_b"] => true,
        ["scenes", "scenes", scene, "tracks", track, "xlv"] => index(scene, 16) && index(track, 8),
        ["scenes", "scenes", scene, "tracks", track, page, pos] => {
            index(scene, 16) && index(track, 8) && SCENE_PAGES.contains(&page) && index(pos, 6)
        }
        _ => false,
    }
}

/// The pointer of the type a parameter's meaning depends on, if it has one.
fn type_pointer(path: &str) -> Option<String> {
    let seg: Vec<&str> = path.split('/').collect();
    match seg[1..] {
        ["part", "machines", track, "machine_params" | "machine_setup", _, ..] => {
            Some(format!("/part/machines/{}/machine_type", track))
        }
        ["part", "fxs", track, field] => {
            let fx = field.get(..3)?;
            let rest = field.get(3..)?;
            let is_fx = fx == "fx1" || fx == "fx2";
            (is_fx && (rest.starts_with("_param") || rest.starts_with("_setup")))
                .then(|| format!("/part/fxs/{}/{}_type", track, fx))
        }
        _ => None,
    }
}

/// Static and Flex have the same fields, so a switch between them is not a change of
/// what the parameters mean. Every other machine is its own family.
fn family(v: &Value) -> Value {
    match v.as_str() {
        Some("Static") | Some("Flex") => Value::from("Static/Flex"),
        _ => v.clone(),
    }
}

fn load(project: &str) -> Locks {
    let file = locks_file(project);
    let Ok(text) = std::fs::read_to_string(&file) else {
        return Locks::new();
    };
    serde_json::from_str(&text).unwrap_or_else(|e| {
        eprintln!("Ignoring unreadable {}: {}", file.display(), e);
        Locks::new()
    })
}

fn store(project: &str, mut locks: Locks) -> Result<(), String> {
    for parts in locks.values_mut() {
        parts.retain(|_, set| !set.is_empty());
    }
    locks.retain(|_, parts| !parts.is_empty());
    let file = locks_file(project);
    if locks.is_empty() {
        return match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("Failed to remove locks file: {}", e))
            }
            _ => Ok(()),
        };
    }
    let text = serde_json::to_string_pretty(&locks).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| format!("Failed to write locks file: {}", e))
}

/// The stored locks of a bank that still hold, per Part. Writes nothing.
///
/// A lock holds when its pointer is valid (and not stale after an upgrade), the value
/// differs between the copies (R1, R2), and, for a parameter, its machine or effect type
/// is the same in both copies unless the type is itself locked (R4).
pub fn effective(project: &str, bank_id: &str) -> Result<Vec<Vec<String>>, String> {
    holding(project, bank_id, &load(project))
}

/// `effective` for locks that are not necessarily the stored ones.
fn holding(project: &str, bank_id: &str, stored: &Locks) -> Result<Vec<Vec<String>>, String> {
    let by_part = stored.get(bank_id);
    // A bank is 636 KB and most have no lock: every write path ends here, so the common
    // case must not parse it
    if by_part.is_none_or(|p| p.values().all(|set| set.is_empty())) {
        return Ok(vec![Vec::new(); 4]);
    }
    let bank = BankFile::from_data_file(&bank_file_path(project, bank_id)?)
        .map_err(|e| format!("Failed to read bank file: {:?}", e))?;
    Ok((0..4u8)
        .map(|id| {
            let i = id as usize;
            let Some(set) = by_part.and_then(|p| p.get(&id)) else {
                return Vec::new();
            };
            if bank.parts_saved_state[i] != 1 {
                return Vec::new();
            }
            let saved = copy_value(&bank, &bank.parts.saved.0[i], id);
            let edited = copy_value(&bank, &bank.parts.unsaved.0[i], id);
            set.iter()
                .filter(|p| valid_path(p))
                .filter(|p| match (saved.pointer(p), edited.pointer(p)) {
                    (Some(s), Some(e)) => s != e,
                    _ => false,
                })
                .filter(|p| {
                    let Some(t) = type_pointer(p) else {
                        return true;
                    };
                    set.contains(&t)
                        || match (saved.pointer(&t), edited.pointer(&t)) {
                            (Some(s), Some(e)) => family(s) == family(e),
                            _ => false,
                        }
                })
                .cloned()
                .collect()
        })
        .collect())
}

/// Stores what `effective` returns for the bank, dropping locks that no longer hold.
pub fn prune(project: &str, bank_id: &str) -> Result<(), String> {
    let mut locks = load(project);
    if locks
        .get(bank_id)
        .is_none_or(|p| p.values().all(|s| s.is_empty()))
    {
        return Ok(());
    }
    let kept = effective(project, bank_id)?;
    locks.insert(
        bank_id.to_string(),
        kept.into_iter()
            .enumerate()
            .map(|(i, v)| (i as u8, v.into_iter().collect()))
            .collect(),
    );
    store(project, locks)
}

/// Drops every stored lock of the given Parts, valid or not, removing the file when
/// nothing is left.
///
/// For operations that replace a Part's content outright (the copy tools): the locks
/// belonged to the content that is gone, and left alone they would attach to the new
/// content wherever it happens to differ, or come back on the first edit of a field.
pub fn forget(project: &str, bank_id: &str, parts: &[u8]) -> Result<(), String> {
    let mut locks = load(project);
    let Some(by_part) = locks.get_mut(bank_id) else {
        return Ok(());
    };
    let before = by_part.len();
    by_part.retain(|id, _| !parts.contains(id));
    if by_part.len() == before {
        return Ok(());
    }
    store(project, locks)
}

/// `prune` for every bank that holds a lock, for writes that may touch any of them (an
/// Undo or Redo puts back whole files without saying which banks they were).
pub fn prune_all(project: &str) -> Result<(), String> {
    for bank_id in load(project).keys() {
        prune(project, bank_id)?;
    }
    Ok(())
}

fn amend(locks: &mut Locks, bank_id: &str, part_id: u8, add: &[String], remove: &[String]) {
    let set = locks
        .entry(bank_id.to_string())
        .or_default()
        .entry(part_id)
        .or_default();
    set.extend(add.iter().filter(|p| valid_path(p)).cloned());
    for p in remove {
        set.remove(p);
    }
}

/// Adds and removes locks on one Part, then prunes, which refuses any lock whose value
/// matches the saved one (R1). Returns what holds afterwards.
pub fn set(
    project: &str,
    bank_id: &str,
    part_id: u8,
    add: &[String],
    remove: &[String],
) -> Result<Vec<Vec<String>>, String> {
    if part_id >= 4 {
        return Err(format!("Invalid part ID: {} (must be 0-3)", part_id));
    }
    bank_file_path(project, bank_id)?;
    let mut locks = load(project);
    amend(&mut locks, bank_id, part_id, add, remove);
    store(project, locks)?;
    prune(project, bank_id)?;
    effective(project, bank_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_reader::tests::TestProject;
    use crate::project_reader::{
        commit_part_data, part_data, read_part_copies, read_parts_data, reload_part_data,
        revert_part_values, save_parts_data, save_scene, PartData, SceneTrackLocks,
    };

    const ATK: &str = "/part/amps/0/atk";

    /// The name a user sees on the card, and the one QA cases and the guide give
    #[test]
    fn the_file_is_named_for_the_app() {
        assert_eq!(
            locks_file("/card/PROJECT").file_name().unwrap(),
            "om_parts-pinned-values.json"
        );
    }

    const SCENE_FX1_3: &str = "/scenes/scenes/2/tracks/1/fx1/3";
    const SCENE_FX1_2: &str = "/scenes/scenes/2/tracks/1/fx1/2";

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|p| p.to_string()).collect()
    }

    /// A value that is never the one given.
    fn bump(v: u8) -> u8 {
        if v < 60 {
            v + 3
        } else {
            v - 3
        }
    }

    fn bank(project: &TestProject) -> BankFile {
        BankFile::from_data_file(&bank_file_path(&project.path, "A").unwrap()).unwrap()
    }

    fn edit_part(project: &TestProject, f: impl FnOnce(&mut PartData)) {
        let mut part = read_parts_data(&project.path, "A").unwrap().parts.remove(0);
        f(&mut part);
        save_parts_data(&project.path, "A", vec![part]).unwrap();
    }

    fn edit_scene_track(
        project: &TestProject,
        scene: usize,
        track: usize,
        f: impl FnOnce(&mut SceneTrackLocks),
    ) {
        let copies = read_part_copies(&project.path, "A", 0).unwrap();
        let mut tracks = copies.edited.scenes.scenes[scene].tracks.clone();
        f(&mut tracks[track]);
        save_scene(&project.path, "A", 0, scene as u8, tracks).unwrap();
    }

    /// Part 1 saved with one scene lock (scene 3, T2, FX1 position 3), then left as it is.
    fn saved_project() -> TestProject {
        let project = TestProject::new();
        edit_scene_track(&project, 2, 1, |t| t.fx1[2] = Some(40));
        commit_part_data(&project.path, "A", 0).unwrap();
        project
    }

    fn atk_of(project: &TestProject) -> (u8, u8) {
        let b = bank(project);
        (
            b.parts.saved.0[0].audio_track_params_values[0].amp.atk,
            b.parts.unsaved.0[0].audio_track_params_values[0].amp.atk,
        )
    }

    #[test]
    fn reload_keeps_exactly_the_locked_values() {
        let project = saved_project();
        let saved_atk = atk_of(&project).0;
        edit_part(&project, |p| {
            p.amps[0].atk = bump(saved_atk);
            p.amps[0].rel = bump(p.amps[0].rel);
            p.lfos[0].spd1 = bump(p.lfos[0].spd1);
        });
        edit_scene_track(&project, 2, 1, |t| {
            t.fx1[3] = Some(77);
            t.fx1[2] = None;
        });
        let before = bank(&project);
        let edited = before.parts.unsaved.0[0];

        let kept = set(&project.path, "A", 0, &s(&[ATK, SCENE_FX1_3]), &[]).unwrap();
        assert_eq!(kept[0], s(&[ATK, SCENE_FX1_3]));
        reload_part_data(&project.path, "A", 0, &kept[0]).unwrap();

        let after = bank(&project);
        let mut expected = before.parts.saved.0[0];
        expected.audio_track_params_values[0].amp.atk = edited.audio_track_params_values[0].amp.atk;
        expected.scenes[2].0[1].fx1.param_4 = edited.scenes[2].0[1].fx1.param_4;
        assert_eq!(after.parts.unsaved.0[0], expected);
        assert_eq!(after.parts_edited_bitmask & 1, 1);
        assert_eq!(after.parts.saved.0[0], before.parts.saved.0[0]);
    }

    #[test]
    fn reload_with_a_group_lock_keeps_the_type_and_its_values() {
        let project = saved_project();
        edit_part(&project, |p| {
            let fx = &mut p.fxs[0];
            fx.fx1_type = if fx.fx1_type == 4 { 5 } else { 4 };
            fx.fx1_param1 = bump(fx.fx1_param1);
            fx.fx1_param2 = bump(fx.fx1_param2);
            fx.fx1_param4 = bump(fx.fx1_param4);
        });
        let b = bank(&project);
        let saved = serde_json::to_value(part_data(&b.parts.saved.0[0], 0)).unwrap();
        let edited = serde_json::to_value(part_data(&b.parts.unsaved.0[0], 0)).unwrap();
        let group = ["fx1_type", "fx1_param1", "fx1_param2"];
        let paths: Vec<String> = group.iter().map(|f| format!("/part/fxs/0/{}", f)).collect();

        let kept = set(&project.path, "A", 0, &paths, &[]).unwrap();
        assert_eq!(kept[0].len(), 3);
        reload_part_data(&project.path, "A", 0, &kept[0]).unwrap();

        let after = bank(&project);
        let mut expected = saved.clone();
        for f in group {
            expected["fxs"][0][f] = edited["fxs"][0][f].clone();
        }
        let got = serde_json::to_value(part_data(&after.parts.unsaved.0[0], 0)).unwrap();
        assert_eq!(got, expected);
        assert_ne!(got["fxs"][0]["fx1_param4"], edited["fxs"][0]["fx1_param4"]);
    }

    #[test]
    fn reload_without_locks_is_a_byte_copy() {
        let project = saved_project();
        edit_part(&project, |p| p.amps[0].atk = bump(p.amps[0].atk));
        reload_part_data(&project.path, "A", 0, &[]).unwrap();
        let b = bank(&project);
        assert_eq!(b.parts.unsaved.0[0], b.parts.saved.0[0]);
        assert_eq!(b.parts_edited_bitmask & 1, 0);
    }

    #[test]
    fn revert_puts_back_one_saved_value() {
        let project = saved_project();
        let saved_atk = atk_of(&project).0;
        edit_part(&project, |p| {
            p.amps[0].atk = bump(saved_atk);
            p.amps[0].rel = bump(p.amps[0].rel);
        });
        let rel_edited = bank(&project).parts.unsaved.0[0].audio_track_params_values[0]
            .amp
            .rel;

        let part = revert_part_values(&project.path, "A", 0, &s(&[ATK])).unwrap();

        let b = bank(&project);
        assert_eq!(atk_of(&project).1, saved_atk);
        assert_eq!(part.amps[0].atk, saved_atk);
        assert_eq!(
            b.parts.unsaved.0[0].audio_track_params_values[0].amp.rel,
            rel_edited
        );
        assert_eq!(b.parts_edited_bitmask & 1, 1);
    }

    #[test]
    fn revert_of_a_scene_lock_restores_and_removes() {
        let project = saved_project();
        edit_scene_track(&project, 2, 1, |t| {
            t.fx1[3] = Some(77);
            t.fx1[2] = None;
        });
        revert_part_values(&project.path, "A", 0, &s(&[SCENE_FX1_3, SCENE_FX1_2])).unwrap();
        let fx1 = read_part_copies(&project.path, "A", 0)
            .unwrap()
            .edited
            .scenes
            .scenes[2]
            .tracks[1]
            .fx1
            .clone();
        assert_eq!(fx1[3], None);
        assert_eq!(fx1[2], Some(40));
    }

    #[test]
    fn revert_without_a_saved_copy_is_refused() {
        let project = TestProject::new();
        assert_eq!(
            revert_part_values(&project.path, "A", 0, &s(&[ATK])).unwrap_err(),
            "SAVE PART FIRST"
        );
    }

    #[test]
    fn a_lock_on_a_matching_value_is_refused() {
        let project = saved_project();
        assert_eq!(
            set(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap()[0],
            Vec::<String>::new()
        );
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn a_lock_goes_when_its_value_is_edited_back() {
        let project = saved_project();
        let saved_atk = atk_of(&project).0;
        edit_part(&project, |p| p.amps[0].atk = bump(saved_atk));
        assert_eq!(
            set(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap()[0],
            s(&[ATK])
        );
        assert!(locks_file(&project.path).exists());

        edit_part(&project, |p| p.amps[0].atk = saved_atk);
        prune(&project.path, "A").unwrap();
        assert!(effective(&project.path, "A").unwrap()[0].is_empty());
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn save_clears_the_parts_locks() {
        let project = saved_project();
        edit_part(&project, |p| p.amps[0].atk = bump(p.amps[0].atk));
        set(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
        commit_part_data(&project.path, "A", 0).unwrap();
        prune(&project.path, "A").unwrap();
        assert!(effective(&project.path, "A").unwrap()[0].is_empty());
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn a_parameter_lock_goes_when_its_type_changes() {
        let project = saved_project();
        let path = "/part/fxs/0/fx1_param3";
        edit_part(&project, |p| {
            p.fxs[0].fx1_param3 = bump(p.fxs[0].fx1_param3)
        });
        assert_eq!(
            set(&project.path, "A", 0, &s(&[path]), &[]).unwrap()[0],
            s(&[path])
        );

        edit_part(&project, |p| {
            p.fxs[0].fx1_type = if p.fxs[0].fx1_type == 4 { 5 } else { 4 }
        });
        prune(&project.path, "A").unwrap();
        assert!(effective(&project.path, "A").unwrap()[0].is_empty());
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn a_parameter_lock_stays_when_static_becomes_flex() {
        let project = saved_project();
        let path = "/part/machines/0/machine_params/ptch";
        edit_part(&project, |p| {
            let m = &mut p.machines[0];
            m.machine_type = "Flex".into();
            m.machine_params.ptch = m.machine_params.ptch.map(bump);
        });
        assert_eq!(
            bank(&project).parts.saved.0[0].audio_track_machine_types[0],
            0
        );
        assert_eq!(
            set(&project.path, "A", 0, &s(&[path]), &[]).unwrap()[0],
            s(&[path])
        );
    }

    #[test]
    fn a_corrupt_locks_file_reads_as_no_locks() {
        let project = saved_project();
        std::fs::write(locks_file(&project.path), "{ not json").unwrap();
        assert!(effective(&project.path, "A")
            .unwrap()
            .iter()
            .all(|l| l.is_empty()));

        edit_part(&project, |p| p.amps[0].atk = bump(p.amps[0].atk));
        assert_eq!(
            set(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap()[0],
            s(&[ATK])
        );
        let text = std::fs::read_to_string(locks_file(&project.path)).unwrap();
        assert!(serde_json::from_str::<Value>(&text).is_ok());
    }

    #[test]
    fn an_unknown_path_is_ignored_and_pruned() {
        let project = saved_project();
        let stored = "/part/nope/0/x";
        std::fs::write(
            locks_file(&project.path),
            format!(r#"{{"A": {{"0": ["{}"]}}}}"#, stored),
        )
        .unwrap();
        edit_part(&project, |p| p.amps[0].atk = bump(p.amps[0].atk));

        reload_part_data(&project.path, "A", 0, &s(&[stored])).unwrap();
        let b = bank(&project);
        assert_eq!(b.parts.unsaved.0[0], b.parts.saved.0[0]);

        prune(&project.path, "A").unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn a_part_without_saved_copy_has_no_locks() {
        let project = TestProject::new();
        assert_eq!(bank(&project).parts_saved_state[0], 0);
        std::fs::write(
            locks_file(&project.path),
            format!(r#"{{"A": {{"0": ["{}"]}}}}"#, ATK),
        )
        .unwrap();
        assert!(effective(&project.path, "A").unwrap()[0].is_empty());
        assert_eq!(
            reload_part_data(&project.path, "A", 0, &s(&[ATK])).unwrap_err(),
            "SAVE PART FIRST"
        );
    }

    /// Bank A Part 1 with an unsaved edit of ATK that is locked, in a project whose bank
    /// B is untouched, so that B is a source to copy from.
    fn locked_project() -> TestProject {
        let project = saved_project();
        edit_part(&project, |p| p.amps[0].atk = bump(p.amps[0].atk));
        assert_eq!(
            set(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap()[0],
            s(&[ATK])
        );
        assert!(locks_file(&project.path).exists());
        project
    }

    #[test]
    fn forget_drops_only_the_given_parts() {
        let project = saved_project();
        std::fs::write(
            locks_file(&project.path),
            r#"{"A": {"0": ["/part/amps/0/atk"], "1": ["/part/amps/0/rel"]}, "B": {"0": ["/part/amps/0/atk"]}}"#,
        )
        .unwrap();
        forget(&project.path, "A", &[0, 2]).unwrap();
        let left = load(&project.path);
        assert!(!left["A"].contains_key(&0));
        assert!(left["A"].contains_key(&1));
        assert!(left["B"].contains_key(&0));

        forget(&project.path, "A", &[1]).unwrap();
        forget(&project.path, "B", &[0]).unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn copy_parts_forgets_the_destination_locks() {
        let project = locked_project();
        crate::project_reader::copy_parts(&project.path, 1, vec![0], &project.path, 0, vec![0])
            .unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn copy_parts_keeps_the_locks_of_other_parts() {
        let project = locked_project();
        crate::project_reader::copy_parts(&project.path, 1, vec![0], &project.path, 0, vec![1])
            .unwrap();
        assert_eq!(
            load(&project.path)["A"][&0],
            BTreeSet::from([ATK.to_string()])
        );
    }

    #[test]
    fn copy_bank_forgets_the_destination_locks() {
        let project = locked_project();
        crate::project_reader::copy_bank(
            &project.path,
            1,
            &project.path,
            &[0],
            false,
            "",
            "",
            "keep_position",
            false,
            &[],
        )
        .unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn copy_tracks_forgets_the_destination_locks_only_when_it_writes_part_params() {
        let project = locked_project();
        let copy = |mode: &str| {
            crate::project_reader::copy_tracks(
                &project.path,
                1,
                0,
                vec![0],
                &project.path,
                0,
                0,
                vec![0],
                mode,
                None,
                None,
            )
            .unwrap()
        };
        copy("pattern_triggers");
        assert!(locks_file(&project.path).exists());
        copy("part_params");
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn copy_scenes_prunes_the_destination_locks() {
        let project = saved_project();
        edit_scene_track(&project, 2, 1, |t| t.fx1[3] = Some(77));
        set(&project.path, "A", 0, &s(&[SCENE_FX1_3]), &[]).unwrap();
        assert!(locks_file(&project.path).exists());
        crate::project_reader::copy_scenes(
            &project.path,
            1,
            0,
            vec![2],
            &project.path,
            0,
            vec![0],
            vec![2],
        )
        .unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    const PICKUP_GROUP: [&str; 8] = [
        "/part/machines/0/machine_type",
        "/part/machines/0/machine_params/ptch",
        "/part/machines/0/machine_params/len",
        "/part/machines/0/machine_params/dir",
        "/part/machines/0/machine_params/gain",
        "/part/machines/0/machine_params/op",
        "/part/machines/0/machine_setup/tstr",
        "/part/machines/0/machine_setup/tsns",
    ];

    /// Track 1 becomes a Pickup machine with its own SRC SETUP, in the edited copy.
    fn make_track_one_a_pickup(project: &TestProject) {
        edit_part(project, |p| {
            let m = &mut p.machines[0];
            m.machine_type = "Pickup".into();
            m.machine_params.ptch = Some(40);
            m.machine_params.len = Some(2);
            m.machine_params.dir = Some(1);
            m.machine_params.gain = Some(50);
            m.machine_params.op = Some(1);
            m.machine_setup.tstr = Some(3);
            m.machine_setup.tsns = Some(100);
        });
    }

    #[test]
    fn pickup_tstr_and_tsns_are_saved() {
        let project = saved_project();
        make_track_one_a_pickup(&project);

        let setup = bank(&project).parts.unsaved.0[0].audio_track_machine_setup[0];
        assert_eq!(setup.pickup_machine.tstr, 3);
        assert_eq!(setup.pickup_machine.tsns, 100);
        let read = read_parts_data(&project.path, "A").unwrap().parts.remove(0);
        assert_eq!(read.machines[0].machine_setup.tstr, Some(3));
        assert_eq!(read.machines[0].machine_setup.tsns, Some(100));
    }

    #[test]
    fn reload_with_a_pickup_group_lock_keeps_its_type_and_values() {
        let project = saved_project();
        make_track_one_a_pickup(&project);
        let kept = set(&project.path, "A", 0, &s(&PICKUP_GROUP), &[]).unwrap();
        assert!(kept[0].contains(&PICKUP_GROUP[0].to_string()));
        assert!(kept[0].contains(&PICKUP_GROUP[6].to_string()));
        assert!(kept[0].contains(&PICKUP_GROUP[7].to_string()));

        reload_part_data(&project.path, "A", 0, &kept[0]).unwrap();

        let after = bank(&project).parts.unsaved.0[0];
        assert_eq!(after.audio_track_machine_types[0], 4);
        assert_eq!(after.audio_track_machine_setup[0].pickup_machine.tstr, 3);
        assert_eq!(after.audio_track_machine_setup[0].pickup_machine.tsns, 100);
        assert_eq!(after.audio_track_machine_params[0].pickup_machine.gain, 50);
    }

    #[test]
    fn revert_of_a_pickup_group_restores_the_saved_machine() {
        let project = saved_project();
        make_track_one_a_pickup(&project);
        revert_part_values(&project.path, "A", 0, &s(&PICKUP_GROUP)).unwrap();
        // What the Part shows, not its bytes: the Pickup fields stay in the file
        // behind the Static ones, as they do on the device
        let b = bank(&project);
        assert_eq!(b.parts.unsaved.0[0].audio_track_machine_types[0], 0);
        assert_eq!(
            serde_json::to_value(part_data(&b.parts.unsaved.0[0], 0)).unwrap(),
            serde_json::to_value(part_data(&b.parts.saved.0[0], 0)).unwrap()
        );
    }

    #[test]
    fn a_bank_without_locks_is_not_read() {
        let project = TestProject::new();
        std::fs::write(
            bank_file_path(&project.path, "A").unwrap(),
            b"not a bank file",
        )
        .unwrap();
        assert_eq!(
            effective(&project.path, "A").unwrap(),
            vec![Vec::<String>::new(); 4]
        );
        prune(&project.path, "A").unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn clear_banks_forgets_the_locks_of_the_cleared_bank_only() {
        let project = locked_project();
        crate::project_reader::clear_banks(&project.path, &[1]).unwrap();
        assert!(locks_file(&project.path).exists());
        crate::project_reader::clear_banks(&project.path, &[0]).unwrap();
        assert!(!locks_file(&project.path).exists());
    }

    #[test]
    fn valid_path_accepts_exactly_the_lockable_values() {
        for ok in [
            "/part/amps/0/atk",
            "/part/machines/7/machine_params/ptch",
            "/part/midi_ctrl2s/3/cc10",
            "/scenes/scenes/15/tracks/7/fx2/5",
            "/scenes/scenes/0/tracks/0/xlv",
            "/scenes/scene_a",
            "/scenes/scene_b",
        ] {
            assert!(valid_path(ok), "{}", ok);
        }
        for bad in [
            "",
            "/",
            "part/amps/0/atk",
            "/part/part_id",
            "/part/amps/8/atk",
            "/part/amps/01/atk",
            "/part/amps/0",
            "/part/nope/0/x",
            "/part/amps/0//atk",
            "/scenes/parts_saved_state",
            "/scenes/scenes/16/tracks/0/xlv",
            "/scenes/scenes/0/tracks/8/xlv",
            "/scenes/scenes/0/tracks/0/fx3/0",
            "/scenes/scenes/0/tracks/0/fx1/6",
            "/scenes/scenes/0/tracks/0/fx1",
            "/scenes/scene_c",
        ] {
            assert!(!valid_path(bad), "{}", bad);
        }
    }
}
