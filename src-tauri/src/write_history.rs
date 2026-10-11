//! Undo and redo for the writes the editors make.
//!
//! The Parts and Scenes editors write straight to the card, a short moment after each
//! change, so there is no "discard" the way a dialog has one. The device's own Reload
//! Part is the only way back and it needs the Part to have been saved there first,
//! which it often has not been.
//!
//! So every write that can be taken back snapshots the bytes of the files it is about
//! to change, and undo writes those bytes again. Whole files rather than a description
//! of the change: a bank is 636 KB, the stack is shallow, and bytes cannot be wrong
//! about what the write did. Redo keeps the bytes it replaced, so the two walk the
//! same list in opposite directions.
//!
//! History is kept per project. Opening another project is not a reason to lose it,
//! and an undo must never reach into a project the user is no longer looking at.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// How many writes can be taken back, per project.
///
/// Each one holds every byte of the files it touched, and a bank file is 636 KB, so
/// this is a memory budget as much as a depth: twenty is about 13 MB in the worst case.
const DEPTH: usize = 20;

/// The files one write was about to change, as they were before it.
#[derive(Clone, Debug)]
struct Snapshot {
    /// What the write was, for the button's tooltip - "Save part GROOVE", say.
    label: String,
    /// None where the file did not exist yet, so undo removes it again.
    files: Vec<FileContents>,
}

#[derive(Default)]
struct History {
    undone: Vec<Snapshot>,
    redone: Vec<Snapshot>,
}

/// What the Undo and Redo buttons should show.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HistoryState {
    pub can_undo: bool,
    pub can_redo: bool,
    /// What undo would take back, or None when there is nothing to take back.
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
}

fn histories() -> &'static Mutex<HashMap<PathBuf, History>> {
    static HISTORIES: OnceLock<Mutex<HashMap<PathBuf, History>>> = OnceLock::new();
    HISTORIES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A file and its contents, or None where the file did not exist.
type FileContents = (PathBuf, Option<Vec<u8>>);

/// Reads the files as they are now, which is what undo will put back.
fn capture(paths: &[PathBuf]) -> Result<Vec<FileContents>, String> {
    paths
        .iter()
        .map(|path| {
            if !path.exists() {
                return Ok((path.clone(), None));
            }
            std::fs::read(path)
                .map(|bytes| (path.clone(), Some(bytes)))
                .map_err(|e| {
                    format!(
                        "Could not read {} to make it undoable: {}",
                        path.display(),
                        e
                    )
                })
        })
        .collect()
}

/// Puts a snapshot back, answering with what was there instead, for the other stack.
fn restore(snapshot: &Snapshot) -> Result<Snapshot, String> {
    let paths: Vec<PathBuf> = snapshot
        .files
        .iter()
        .map(|(path, _)| path.clone())
        .collect();
    let replaced = capture(&paths)?;

    for (path, bytes) in &snapshot.files {
        match bytes {
            Some(bytes) => std::fs::write(path, bytes)
                .map_err(|e| format!("Could not write {}: {}", path.display(), e))?,
            // The write created this file, so taking it back means removing it
            None => {
                if path.exists() {
                    std::fs::remove_file(path)
                        .map_err(|e| format!("Could not remove {}: {}", path.display(), e))?;
                }
            }
        }
    }

    Ok(Snapshot {
        label: snapshot.label.clone(),
        files: replaced,
    })
}

/// Snapshots `paths` before a write, so that write can be taken back.
///
/// Call this immediately before the write, not after. A new write makes whatever was
/// redone unreachable, which is what every editor's history does.
pub fn record(project: &str, label: &str, paths: &[PathBuf]) -> Result<(), String> {
    let snapshot = Snapshot {
        label: label.to_string(),
        files: capture(paths)?,
    };

    let mut all = histories()
        .lock()
        .map_err(|_| "History is poisoned".to_string())?;
    let history = all.entry(PathBuf::from(project)).or_default();
    history.undone.push(snapshot);
    if history.undone.len() > DEPTH {
        history.undone.remove(0);
    }
    history.redone.clear();
    Ok(())
}

/// Takes back the last recorded write, answering with what it was.
pub fn undo(project: &str) -> Result<Option<String>, String> {
    step(project, true)
}

/// Puts back the last undone write, answering with what it was.
pub fn redo(project: &str) -> Result<Option<String>, String> {
    step(project, false)
}

fn step(project: &str, undoing: bool) -> Result<Option<String>, String> {
    let mut all = histories()
        .lock()
        .map_err(|_| "History is poisoned".to_string())?;
    let Some(history) = all.get_mut(Path::new(project)) else {
        return Ok(None);
    };

    let from = if undoing {
        &mut history.undone
    } else {
        &mut history.redone
    };
    let Some(snapshot) = from.pop() else {
        return Ok(None);
    };

    // Restoring can fail halfway on a card pulled mid-write. The snapshot goes back on
    // its own stack so the state still describes what is there to try again.
    let replaced = match restore(&snapshot) {
        Ok(replaced) => replaced,
        Err(error) => {
            if undoing {
                history.undone.push(snapshot);
            } else {
                history.redone.push(snapshot);
            }
            return Err(error);
        }
    };

    let label = replaced.label.clone();
    if undoing {
        history.redone.push(replaced);
    } else {
        history.undone.push(replaced);
    }
    Ok(Some(label))
}

/// What the two buttons should offer for this project.
pub fn state(project: &str) -> HistoryState {
    let Ok(all) = histories().lock() else {
        return HistoryState {
            can_undo: false,
            can_redo: false,
            undo_label: None,
            redo_label: None,
        };
    };
    let Some(history) = all.get(Path::new(project)) else {
        return HistoryState {
            can_undo: false,
            can_redo: false,
            undo_label: None,
            redo_label: None,
        };
    };
    HistoryState {
        can_undo: !history.undone.is_empty(),
        can_redo: !history.redone.is_empty(),
        undo_label: history.undone.last().map(|s| s.label.clone()),
        redo_label: history.redone.last().map(|s| s.label.clone()),
    }
}

/// Forgets a project's history. Used when its files change underneath us - a refresh
/// or a Tools operation - where the snapshots no longer describe what is on the card.
pub fn forget(project: &str) {
    if let Ok(mut all) = histories().lock() {
        all.remove(Path::new(project));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Project {
        _dir: TempDir,
        path: String,
    }

    impl Project {
        fn new() -> Self {
            let dir = TempDir::new().expect("temp dir");
            let path = dir.path().to_string_lossy().to_string();
            Project { _dir: dir, path }
        }

        fn file(&self, name: &str) -> PathBuf {
            Path::new(&self.path).join(name)
        }

        fn write(&self, name: &str, contents: &str) -> PathBuf {
            let path = self.file(name);
            std::fs::write(&path, contents).expect("write");
            path
        }

        fn read(&self, name: &str) -> String {
            std::fs::read_to_string(self.file(name)).expect("read")
        }
    }

    #[test]
    fn test_nothing_to_undo_in_a_project_nothing_was_written_to() {
        let project = Project::new();
        assert_eq!(
            state(&project.path),
            HistoryState {
                can_undo: false,
                can_redo: false,
                undo_label: None,
                redo_label: None,
            }
        );
        assert_eq!(undo(&project.path).unwrap(), None);
        assert_eq!(redo(&project.path).unwrap(), None);
    }

    #[test]
    fn test_undo_puts_the_previous_bytes_back() {
        let project = Project::new();
        let bank = project.write("bank01.work", "before");

        record(&project.path, "Save part 1", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "after").unwrap();

        assert_eq!(
            undo(&project.path).unwrap(),
            Some("Save part 1".to_string())
        );
        assert_eq!(project.read("bank01.work"), "before");
    }

    #[test]
    fn test_redo_puts_the_write_back() {
        let project = Project::new();
        let bank = project.write("bank01.work", "before");

        record(&project.path, "Save part 1", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "after").unwrap();
        undo(&project.path).unwrap();

        assert_eq!(
            redo(&project.path).unwrap(),
            Some("Save part 1".to_string())
        );
        assert_eq!(project.read("bank01.work"), "after");
    }

    #[test]
    fn test_several_writes_come_back_newest_first() {
        let project = Project::new();
        let bank = project.write("bank01.work", "one");

        record(&project.path, "first", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "two").unwrap();
        record(&project.path, "second", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "three").unwrap();

        assert_eq!(undo(&project.path).unwrap(), Some("second".to_string()));
        assert_eq!(project.read("bank01.work"), "two");
        assert_eq!(undo(&project.path).unwrap(), Some("first".to_string()));
        assert_eq!(project.read("bank01.work"), "one");
        assert_eq!(undo(&project.path).unwrap(), None, "and no further");
    }

    #[test]
    fn test_one_write_can_cover_several_files() {
        let project = Project::new();
        let work = project.write("bank01.work", "work before");
        let strd = project.write("bank01.strd", "strd before");

        record(
            &project.path,
            "Save all parts",
            &[work.clone(), strd.clone()],
        )
        .unwrap();
        std::fs::write(&work, "work after").unwrap();
        std::fs::write(&strd, "strd after").unwrap();

        undo(&project.path).unwrap();
        assert_eq!(project.read("bank01.work"), "work before");
        assert_eq!(project.read("bank01.strd"), "strd before");
    }

    #[test]
    fn test_a_write_that_created_a_file_is_undone_by_removing_it() {
        let project = Project::new();
        let fresh = project.file("bank02.work");

        record(&project.path, "Create bank B", std::slice::from_ref(&fresh)).unwrap();
        std::fs::write(&fresh, "new bank").unwrap();

        undo(&project.path).unwrap();
        assert!(!fresh.exists(), "the file the write created is gone again");

        redo(&project.path).unwrap();
        assert_eq!(project.read("bank02.work"), "new bank", "and comes back");
    }

    #[test]
    fn test_a_new_write_makes_the_redone_ones_unreachable() {
        let project = Project::new();
        let bank = project.write("bank01.work", "one");

        record(&project.path, "first", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "two").unwrap();
        undo(&project.path).unwrap();
        assert!(state(&project.path).can_redo);

        record(&project.path, "second", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "three").unwrap();

        let now = state(&project.path);
        assert!(!now.can_redo, "the branch that was undone is gone");
        assert_eq!(now.undo_label, Some("second".to_string()));
    }

    #[test]
    fn test_undo_and_redo_can_be_walked_back_and_forth() {
        let project = Project::new();
        let bank = project.write("bank01.work", "one");

        record(&project.path, "edit", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "two").unwrap();

        for _ in 0..3 {
            undo(&project.path).unwrap();
            assert_eq!(project.read("bank01.work"), "one");
            redo(&project.path).unwrap();
            assert_eq!(project.read("bank01.work"), "two");
        }
    }

    #[test]
    fn test_the_labels_say_what_each_button_would_do() {
        let project = Project::new();
        let bank = project.write("bank01.work", "one");

        record(&project.path, "Mute the A end", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "two").unwrap();

        let before = state(&project.path);
        assert_eq!(before.undo_label, Some("Mute the A end".to_string()));
        assert_eq!(before.redo_label, None);

        undo(&project.path).unwrap();
        let after = state(&project.path);
        assert_eq!(after.undo_label, None);
        assert_eq!(after.redo_label, Some("Mute the A end".to_string()));
    }

    #[test]
    fn test_only_the_last_twenty_writes_are_kept() {
        let project = Project::new();
        let bank = project.write("bank01.work", "0");

        for n in 1..=25 {
            record(
                &project.path,
                &format!("edit {}", n),
                std::slice::from_ref(&bank),
            )
            .unwrap();
            std::fs::write(&bank, n.to_string()).unwrap();
        }

        let mut taken = 0;
        while undo(&project.path).unwrap().is_some() {
            taken += 1;
        }
        assert_eq!(taken, DEPTH, "the oldest writes fall off the end");
        // Twenty-five writes with twenty kept means it only goes back to the fifth
        assert_eq!(project.read("bank01.work"), "5");
    }

    #[test]
    fn test_each_project_has_its_own_history() {
        let one = Project::new();
        let other = Project::new();
        let bank = one.write("bank01.work", "one before");
        let their_bank = other.write("bank01.work", "other before");

        record(&one.path, "mine", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "one after").unwrap();
        std::fs::write(&their_bank, "other after").unwrap();

        assert!(
            !state(&other.path).can_undo,
            "the other project has no history"
        );
        undo(&one.path).unwrap();
        assert_eq!(one.read("bank01.work"), "one before");
        assert_eq!(
            other.read("bank01.work"),
            "other after",
            "undoing one project must not reach into another"
        );
    }

    #[test]
    fn test_forgetting_a_project_drops_its_history() {
        let project = Project::new();
        let bank = project.write("bank01.work", "one");
        record(&project.path, "edit", std::slice::from_ref(&bank)).unwrap();
        std::fs::write(&bank, "two").unwrap();

        forget(&project.path);

        assert!(!state(&project.path).can_undo);
        assert_eq!(
            project.read("bank01.work"),
            "two",
            "the file is left as it is"
        );
    }

    /// A write recorded against a file that cannot be read is a write that cannot be
    /// taken back. Saying so up front beats offering an undo that would not work.
    #[test]
    fn test_recording_an_unreadable_file_fails_rather_than_half_recording() {
        let project = Project::new();
        let readable = project.write("bank01.work", "one");
        let directory = project.file("notafile");
        std::fs::create_dir(&directory).unwrap();

        assert!(record(&project.path, "edit", &[readable, directory]).is_err());
        assert!(!state(&project.path).can_undo, "nothing was recorded");
    }
}
