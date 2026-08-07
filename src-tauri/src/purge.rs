//! Detection and execution logic for the "Purge Project Samples" / "Purge
//! Audio Pool Samples" tools: finds audio files no sample slot references
//! anywhere, and deletes (to the OS Trash Bin) or moves them,
//! collapsing whole directories instead of emptying them file by file.

use serde::{Deserialize, Serialize};

/// A single audio file absorbed into a collapsed `PurgeUnit::Directory`,
/// carried forward with its own size/slots (not just its path) so the
/// review table can list it tree-style with real per-row values instead of
/// just a name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PurgeFileEntry {
    pub path: String,
    pub size: u64,
    /// Slot label(s) ("S1", "F2", ...) currently loading this file - only
    /// ever non-empty when the file became unused via a simulated "Clear
    /// unused sample slot assignments" run (see `slot_labels` below); a
    /// file no slot has ever loaded has none.
    pub slots: Vec<String>,
    /// `false` for a non-audio file (artwork, readme, `.ot` sidecar, ...)
    /// swept along because the directory around it collapsed. Such files are
    /// listed so the review/preview tables show everything that will actually
    /// be moved/deleted, but they're counted separately from audio files
    /// everywhere a count is shown.
    pub is_audio: bool,
}

/// One row in a purge plan: either a single unused audio file, or a whole
/// directory whose contents (recursively, audio or not) are 100% unused.
/// `origin` is `"Audio Pool"` or a project's directory name, matching the
/// existing `PoolUsageEntry.project` convention in `project_reader.rs` -
/// the frontend review table groups/labels rows by this field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum PurgeUnit {
    File {
        path: String,
        origin: String,
        size: u64,
        slots: Vec<String>,
        /// The `.ot` sidecar this file drags along when purged, if one exists
        /// on disk and isn't shared with a surviving same-stem sibling (see
        /// `ot_sidecar_if_unshared`). Listed so the review table accounts for
        /// every byte that leaves the disk instead of quietly sweeping it.
        /// Not folded into `size`: the execution paths add the sidecar's
        /// bytes themselves, and double-counting here would inflate
        /// `bytes_reclaimed`.
        sidecar: Option<PurgeFileEntry>,
    },
    Directory {
        path: String,
        origin: String,
        /// Audio files only - this is the number the "N unused audio files"
        /// counters add up.
        file_count: u32,
        /// Non-audio files swept along with the directory, counted and shown
        /// separately since they were never "unused samples" in the first
        /// place - they just happen to sit inside a directory that collapsed.
        non_audio_count: u32,
        /// Total bytes of everything inside, audio and non-audio alike -
        /// removing the directory reclaims all of it.
        size: u64,
        /// Every file absorbed into this collapsed directory (recursively,
        /// including from absorbed subdirectories, audio and non-audio
        /// alike), sorted alphabetically by path - lets the review/preview
        /// tables list them tree-style under the directory row instead of
        /// just showing a count.
        files: Vec<PurgeFileEntry>,
    },
}

impl PurgeUnit {
    pub fn path(&self) -> &str {
        match self {
            PurgeUnit::File { path, .. } | PurgeUnit::Directory { path, .. } => path,
        }
    }

    pub fn size(&self) -> u64 {
        match self {
            PurgeUnit::File { size, .. } | PurgeUnit::Directory { size, .. } => *size,
        }
    }
}

/// Downloads -> Desktop -> home directory -> `guaranteed_fallback` (the Set
/// root, or a standalone project's own directory - computed by the caller,
/// which already has the existing "is this project part of a Set" logic).
/// Uses the `dirs` crate (already a dependency) so locale-specific folder
/// names resolve correctly (e.g. a French "Telechargements") - no hardcoded
/// "Downloads" string.
pub fn resolve_default_purge_destination(guaranteed_fallback: &str) -> String {
    pick_first_existing(
        &[dirs::download_dir(), dirs::desktop_dir(), dirs::home_dir()],
        guaranteed_fallback,
    )
}

/// Pure/testable core of `resolve_default_purge_destination`, split out so
/// the fallback order can be unit-tested without touching real OS
/// directories. Returns the first candidate that both exists and is a
/// directory; falls back to `fallback` (assumed to always exist) otherwise.
fn pick_first_existing(candidates: &[Option<std::path::PathBuf>], fallback: &str) -> String {
    candidates
        .iter()
        .flatten()
        .find(|p| p.is_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// Collapses a flat list of unused audio files into a purge plan: a
/// directory becomes a single `PurgeUnit::Directory` when every audio file
/// inside it, recursively, is in `unused_files` - non-audio files inside
/// don't block collapse (they're swept along with the directory once it's
/// removed/moved as a unit, so they aren't individually tracked). Any
/// unused file that isn't absorbed into a collapsed directory becomes its
/// own `PurgeUnit::File`.
///
/// The scan root itself (`root`) is never eligible for collapse, even if
/// every audio file inside it is unused. This prevents deleting an entire
/// project or Audio Pool directory. The `root` parameter must be an exact
/// string match with the input used to build the unused files list (no
/// canonicalization or normalization) — it typically comes from the same
/// raw path string passed to `collect_audio_files_recursive()`.
///
/// `slot_labels` carries the "S1"/"F2"-style slot label(s) a small subset of
/// `unused_files` currently sit in (only ever non-empty for a file that
/// became unused via a simulated "Clear unused sample slot assignments"
/// run - see `compute_project_unused_files`/`compute_pool_unused_files`),
/// keyed by the exact same path string used in `unused_files`. Pass an
/// empty map when no such info is available.
fn build_purge_plan(
    unused_files: Vec<(String, String, u64)>,
    root: &std::path::Path,
    slot_labels: &std::collections::HashMap<String, Vec<String>>,
) -> Vec<PurgeUnit> {
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;

    let unused_map: HashMap<PathBuf, (String, u64)> = unused_files
        .into_iter()
        .map(|(path, origin, size)| (PathBuf::from(path), (origin, size)))
        .collect();
    let empty_slots: Vec<String> = Vec::new();
    let slots_for = |path: &PathBuf| -> &Vec<String> {
        slot_labels
            .get(&path.to_string_lossy().to_string())
            .unwrap_or(&empty_slots)
    };

    // Every distinct parent directory of an unused file is a collapse
    // candidate. Evaluated deepest-first so a directory's subdirectories are
    // already resolved by the time the directory itself is checked.
    let mut candidate_dirs: HashSet<PathBuf> = HashSet::new();
    for path in unused_map.keys() {
        if let Some(parent) = path.parent() {
            candidate_dirs.insert(parent.to_path_buf());
        }
    }
    let mut ordered: Vec<PathBuf> = candidate_dirs.into_iter().collect();
    ordered.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    /// Running totals for a directory that fully collapses, including
    /// everything rolled up from already-collapsed subdirectories.
    struct Collapsed {
        origin: String,
        file_count: u32,
        non_audio_count: u32,
        size: u64,
        files: Vec<PurgeFileEntry>,
    }

    let mut collapsed: HashMap<PathBuf, Collapsed> = HashMap::new();
    let mut absorbed: HashSet<PathBuf> = HashSet::new();

    for dir in &ordered {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        let mut file_count = 0u32;
        let mut non_audio_count = 0u32;
        let mut total_size = 0u64;
        let mut origin: Option<String> = None;
        let mut all_covered = true;
        let mut items_to_absorb: Vec<PathBuf> = Vec::new();
        let mut files: Vec<PurgeFileEntry> = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(sub) = collapsed.get(&path) {
                    origin.get_or_insert_with(|| sub.origin.clone());
                    file_count += sub.file_count;
                    non_audio_count += sub.non_audio_count;
                    total_size += sub.size;
                    files.extend(sub.files.iter().cloned());
                    items_to_absorb.push(path);
                } else {
                    all_covered = false;
                }
            } else if let Some((file_origin, size)) = unused_map.get(&path) {
                origin.get_or_insert_with(|| file_origin.clone());
                file_count += 1;
                total_size += size;
                files.push(PurgeFileEntry {
                    path: path.to_string_lossy().to_string(),
                    size: *size,
                    slots: slots_for(&path).clone(),
                    is_audio: true,
                });
                items_to_absorb.push(path);
            } else {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                if crate::audio_pool::is_audio_file(&name) {
                    // A real, still-referenced audio file - blocks collapse.
                    all_covered = false;
                } else {
                    // Swept along once the directory collapses. Listed and
                    // sized like any other row so the review table shows the
                    // full truth of what leaves the disk, but counted apart
                    // from the audio files.
                    non_audio_count += 1;
                    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    total_size += size;
                    files.push(PurgeFileEntry {
                        path: path.to_string_lossy().to_string(),
                        size,
                        slots: Vec::new(),
                        is_audio: false,
                    });
                }
            }
        }

        // `file_count > 0`: a directory holding nothing but non-audio files
        // is not an "unused samples" finding and must never be purged.
        if all_covered && file_count > 0 && dir.as_path() != root {
            if let Some(origin) = origin {
                collapsed.insert(
                    dir.clone(),
                    Collapsed {
                        origin,
                        file_count,
                        non_audio_count,
                        size: total_size,
                        files,
                    },
                );
                for path in items_to_absorb {
                    absorbed.insert(path);
                }
            }
        }
    }

    let mut units: Vec<PurgeUnit> = Vec::new();

    // Only emit the top of each collapsed chain (a collapsed dir whose
    // parent also collapsed is already accounted for by that parent).
    for (dir, c) in &collapsed {
        let parent_collapsed = dir.parent().is_some_and(|p| collapsed.contains_key(p));
        if !parent_collapsed {
            let mut file_entries = c.files.clone();
            file_entries.sort_by(|a, b| a.path.cmp(&b.path));
            units.push(PurgeUnit::Directory {
                path: dir.to_string_lossy().to_string(),
                origin: c.origin.clone(),
                file_count: c.file_count,
                non_audio_count: c.non_audio_count,
                size: c.size,
                files: file_entries,
            });
        }
    }

    // `ot_sidecar_if_unshared` decides sharing against the set of paths being
    // purged as individual files - exactly the non-absorbed keys below.
    let lone_paths: HashSet<String> = unused_map
        .keys()
        .filter(|p| !absorbed.contains(*p))
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    for (path, (origin, size)) in &unused_map {
        if !absorbed.contains(path) {
            let path_str = path.to_string_lossy().to_string();
            let sidecar = ot_sidecar_if_unshared(&path_str, &lone_paths).map(|ot| PurgeFileEntry {
                size: std::fs::metadata(&ot).map(|m| m.len()).unwrap_or(0),
                path: ot.to_string_lossy().to_string(),
                slots: Vec::new(),
                is_audio: false,
            });
            units.push(PurgeUnit::File {
                path: path_str,
                origin: origin.clone(),
                size: *size,
                slots: slots_for(path).clone(),
                sidecar,
            });
        }
    }

    units
}

/// Whether a slot's usage entries represent real usage (a machine
/// assignment or p-lock actually referencing it) as opposed to being merely
/// loaded-but-untriggered. Shared by `compute_project_unused_files`
/// (deciding whether a file is still referenced) and
/// `slots_eligible_for_clearing` (deciding whether a loaded slot may be
/// cleared) so the two questions - "is this file still used?" and "is this
/// slot still used?" - can never disagree, including on the `None` case
/// (slot id outside 1..=128, or a slot TYPE other than STATIC/FLEX):
/// treated conservatively as "has real usage", so an unrecognized slot is
/// never treated as purgeable/clearable by either path.
fn slot_has_real_usage(slot_entries: Option<&Vec<crate::project_reader::SlotUsageEntry>>) -> bool {
    match slot_entries {
        Some(entries) => !entries.is_empty(),
        None => true,
    }
}

/// Every audio file physically inside `project_path` that no slot of THIS
/// project references (machine assignment, p-lock, or - unless
/// `simulate_cleared_slots` is on - a loaded-but-untriggered slot).
/// `simulate_cleared_slots` is what live preview/scan uses whenever the
/// "Clear unused sample slot assignments" checkbox is on, so soon-to-be-
/// orphaned files show up in the review table without anything being
/// mutated yet.
pub fn compute_project_unused_files(
    project_path: &str,
    exclude_backups: bool,
    simulate_cleared_slots: bool,
) -> Result<Vec<PurgeUnit>, String> {
    use std::path::Path;

    let project_dir = crate::project_reader::normalize_path_lexically(Path::new(project_path));
    let project_file = if project_dir.join("project.work").exists() {
        project_dir.join("project.work")
    } else {
        project_dir.join("project.strd")
    };

    let raw_fields = crate::project_reader::read_raw_sample_fields(&project_file)?;
    let usage = crate::project_reader::compute_sample_usage(project_path)?;

    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Keyed by the same lowercased/normalized path as `referenced` - only
    // ever consulted for a file that ends up unused, which (given the loop
    // below) only happens for a loaded-but-untriggered slot while
    // `simulate_cleared_slots` is on.
    let mut slot_labels_by_key: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for ((slot_type, slot_id), fields) in &raw_fields {
        let Some(path_value) = fields.get("PATH") else {
            continue;
        };
        let resolved = crate::project_reader::normalize_path_lexically(
            &project_dir.join(path_value.replace('\\', "/")),
        )
        .to_string_lossy()
        .to_lowercase();

        let idx = (*slot_id as usize).saturating_sub(1);
        let slot_type_upper = slot_type.to_uppercase();
        let slot_entries = match slot_type_upper.as_str() {
            "STATIC" => usage.static_usage.get(idx),
            "FLEX" => usage.flex_usage.get(idx),
            _ => None,
        };
        let has_real_usage = slot_has_real_usage(slot_entries);

        if has_real_usage || !simulate_cleared_slots {
            referenced.insert(resolved.clone());
        }
        // else: loaded but never triggered, and we're simulating slot-clearing
        // -> leave it out of `referenced`, so the file shows up as unused.

        if slot_type_upper == "STATIC" || slot_type_upper == "FLEX" {
            let prefix = if slot_type_upper == "FLEX" { "F" } else { "S" };
            slot_labels_by_key
                .entry(resolved)
                .or_default()
                .push(format!("{}{}", prefix, slot_id));
        }
    }

    let origin = project_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let backups_dir = project_dir.join("backups");

    let mut unused: Vec<(String, String, u64)> = Vec::new();
    let mut slot_labels: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for file in crate::audio_pool::collect_audio_files_recursive(project_path)? {
        let file_path = Path::new(&file);
        if exclude_backups && file_path.starts_with(&backups_dir) {
            continue;
        }
        let key = crate::project_reader::normalize_path_lexically(file_path)
            .to_string_lossy()
            .to_lowercase();
        if referenced.contains(&key) {
            continue;
        }
        let size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
        if let Some(labels) = slot_labels_by_key.get(&key) {
            slot_labels.insert(file.clone(), labels.clone());
        }
        unused.push((file, origin.clone(), size));
    }

    Ok(build_purge_plan(
        unused,
        Path::new(project_path),
        &slot_labels,
    ))
}

/// Every audio file physically inside `pool_path` that no project of the
/// Set references, however weakly (reuses `compute_pool_usage`'s existing
/// "assigned but never triggered still counts as usage" semantics). When
/// `simulate_cleared_slots_for` names project(s) whose unused slot
/// assignments would also be cleared in this same run, an "assigned" entry
/// contributed by one of those projects is dropped from consideration first
/// - if that leaves a pool file with zero usage entries anywhere, it's
/// purgeable in this same preview too.
pub fn compute_pool_unused_files(
    pool_path: &str,
    simulate_cleared_slots_for: &[String],
) -> Result<Vec<PurgeUnit>, String> {
    use std::path::Path;

    let mut usage_map = crate::project_reader::compute_pool_usage(pool_path)?;

    // Slot label(s) of any "assigned" entry about to be dropped below - a
    // pool file only ends up unused because of one of these, so this is the
    // full set of labels any unused pool file could carry (mirrors
    // `compute_project_unused_files`'s per-project slot_labels_by_key).
    let mut slot_labels_by_key: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if !simulate_cleared_slots_for.is_empty() {
        let simulate_set: std::collections::HashSet<&String> =
            simulate_cleared_slots_for.iter().collect();
        for (key, entries) in &usage_map {
            for e in entries {
                if e.kind == "assigned" && simulate_set.contains(&e.project) {
                    if let Some(label) = &e.slot {
                        slot_labels_by_key
                            .entry(key.clone())
                            .or_default()
                            .push(label.clone());
                    }
                }
            }
        }
        for entries in usage_map.values_mut() {
            entries.retain(|e| !(e.kind == "assigned" && simulate_set.contains(&e.project)));
        }
        usage_map.retain(|_, entries| !entries.is_empty());
    }

    let mut unused: Vec<(String, String, u64)> = Vec::new();
    let mut slot_labels: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for file in crate::audio_pool::collect_audio_files_recursive(pool_path)? {
        let key = crate::project_reader::pool_usage_key(
            &crate::project_reader::normalize_path_lexically(Path::new(&file)),
        );
        if usage_map.contains_key(&key) {
            continue;
        }
        let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        if let Some(labels) = slot_labels_by_key.get(&key) {
            slot_labels.insert(file.clone(), labels.clone());
        }
        unused.push((file, "Audio Pool".to_string(), size));
    }

    Ok(build_purge_plan(unused, Path::new(pool_path), &slot_labels))
}

/// The `(slot_type, slot_id)` pairs (1-based ids, as stored in the project
/// file) that `clear_unused_slot_assignments` would clear: loaded (`PATH=`
/// set) but with no real usage per `slot_has_real_usage`. Split out so both
/// the actual clearing function and the non-mutating preview count below
/// share one answer to "which slots qualify" and can never disagree.
fn slots_eligible_for_clearing(project_path: &str) -> Result<(Vec<u16>, Vec<u16>), String> {
    use std::path::Path;

    let project_dir = crate::project_reader::normalize_path_lexically(Path::new(project_path));
    let project_file = if project_dir.join("project.work").exists() {
        project_dir.join("project.work")
    } else {
        project_dir.join("project.strd")
    };

    let raw_fields = crate::project_reader::read_raw_sample_fields(&project_file)?;
    let usage = crate::project_reader::compute_sample_usage(project_path)?;

    let mut static_to_clear: Vec<u16> = Vec::new();
    let mut flex_to_clear: Vec<u16> = Vec::new();

    for ((slot_type, slot_id), fields) in &raw_fields {
        if !fields.contains_key("PATH") {
            continue;
        }
        let idx = (*slot_id as usize).saturating_sub(1);
        let slot_type_upper = slot_type.to_uppercase();
        let slot_entries = match slot_type_upper.as_str() {
            "STATIC" => usage.static_usage.get(idx),
            "FLEX" => usage.flex_usage.get(idx),
            _ => None,
        };
        if !slot_has_real_usage(slot_entries) {
            match slot_type_upper.as_str() {
                "STATIC" => static_to_clear.push(*slot_id),
                "FLEX" => flex_to_clear.push(*slot_id),
                _ => {}
            }
        }
    }

    Ok((static_to_clear, flex_to_clear))
}

/// Clears every slot in `project_path` that has a file loaded but zero
/// usage entries from `compute_sample_usage` (machine assignment or p-lock)
/// - i.e. loaded but never actually triggered. Backs up `project.work`
/// first via the same `backup_project_files_impl` convention
/// `update_references_in_set` already relies on. Returns the number of
/// slots cleared.
pub fn clear_unused_slot_assignments(project_path: &str) -> Result<u32, String> {
    use std::path::Path;

    let (static_to_clear, flex_to_clear) = slots_eligible_for_clearing(project_path)?;
    let total = static_to_clear.len() + flex_to_clear.len();
    if total == 0 {
        return Ok(0);
    }

    let project_dir = crate::project_reader::normalize_path_lexically(Path::new(project_path));
    let project_file = if project_dir.join("project.work").exists() {
        project_dir.join("project.work")
    } else {
        project_dir.join("project.strd")
    };
    let file_name = project_file
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    crate::backup_project_files_impl(project_path, &[file_name], "purge_unused_samples")?;

    if !static_to_clear.is_empty() {
        crate::project_reader::clear_sample_slots(project_path, "STATIC", static_to_clear)?;
    }
    if !flex_to_clear.is_empty() {
        crate::project_reader::clear_sample_slots(project_path, "FLEX", flex_to_clear)?;
    }

    Ok(total as u32)
}

/// Non-mutating count of slots `clear_unused_slot_assignments` would clear -
/// used by the frontend's purge review screen so the "Clear unused sample
/// slot assignments" option's destructive scope is visible BEFORE the user
/// executes anything, not just after (previously this only surfaced on the
/// done screen via `PurgeResult::slots_cleared`). Shares
/// `slots_eligible_for_clearing` with the real clearing function so preview
/// and execute can never disagree on the count.
pub fn count_slots_eligible_for_clearing(project_path: &str) -> Result<u32, String> {
    let (static_to_clear, flex_to_clear) = slots_eligible_for_clearing(project_path)?;
    Ok((static_to_clear.len() + flex_to_clear.len()) as u32)
}

/// Clears unused slot assignments for each project in `project_paths`,
/// accumulating results into an already-in-progress `PurgeResult`. Called
/// AFTER a delete/move step has already completed successfully, so a
/// slot-clearing failure for one project is pushed into `result.errors`
/// (never returned as an `Err`, never aborts the loop) rather than
/// discarding the already-successful delete/move result and the
/// slot-clear counts/`projects_updated` entries already accumulated for
/// earlier projects. Shared by both `purge_project_files` and
/// `purge_pool_files` in `lib.rs`.
pub fn clear_unused_slots_for_projects(result: &mut PurgeResult, project_paths: &[String]) {
    for project_path in project_paths {
        match clear_unused_slot_assignments(project_path) {
            Ok(cleared) => {
                result.slots_cleared += cleared;
                if cleared > 0 {
                    result.projects_updated.push(project_path.clone());
                }
            }
            Err(e) => {
                result.errors.push(format!(
                    "Failed to clear unused slot assignments for {}: {}",
                    project_path, e
                ));
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PurgeResult {
    /// Paths of the standalone `PurgeUnit::File` units only - a file removed
    /// as part of a collapsed directory is not listed here (the directory is,
    /// under `dirs_removed`). Use `audio_files_removed` for a total count.
    pub files_removed: Vec<String>,
    pub dirs_removed: Vec<String>,
    /// Every audio file that left the disk: standalone units plus everything
    /// inside each removed directory. `files_removed.len()` undercounts by
    /// exactly the directory contents, which is what made the done screen
    /// report "0 files and 1 directory removed" for a 50-file directory.
    pub audio_files_removed: u32,
    /// Non-audio files swept along inside removed directories.
    pub non_audio_files_removed: u32,
    pub bytes_reclaimed: u64,
    pub slots_cleared: u32,
    pub projects_updated: Vec<String>,
    pub errors: Vec<String>,
    /// The user cancelled partway through: every count above reflects only
    /// the units that had already been processed, and the rest were left
    /// untouched. Nothing is half-done - cancellation is only ever honoured
    /// between units.
    pub cancelled: bool,
}

impl PurgeResult {
    /// Records one successfully removed unit into the path lists and the
    /// audio/non-audio totals. Shared by the trash and move paths so the two
    /// can never disagree on what a removed directory contributes.
    fn tally(&mut self, unit: &PurgeUnit) {
        match unit {
            PurgeUnit::File { path, sidecar, .. } => {
                self.files_removed.push(path.clone());
                self.audio_files_removed += 1;
                if sidecar.is_some() {
                    self.non_audio_files_removed += 1;
                }
            }
            PurgeUnit::Directory {
                path,
                file_count,
                non_audio_count,
                ..
            } => {
                self.dirs_removed.push(path.clone());
                self.audio_files_removed += file_count;
                self.non_audio_files_removed += non_audio_count;
            }
        }
    }
}

/// The `.ot` sidecar (Octatrack per-sample Audio Editor attribute file) for
/// an individual audio file, if one exists on disk AND is safe to sweep
/// along. An individual `PurgeUnit::File` purge must sweep this along too: a
/// stale `.ot` left behind re-imposes old slice/attribute data on any future
/// same-named file (the same hazard `project_reader.rs`'s
/// `backup_and_delete_ot_sibling` already guards against elsewhere).
/// `PurgeUnit::Directory` units don't need this - a directory purge already
/// moves/deletes everything inside it wholesale, `.ot` files included.
///
/// Octatrack names a `.ot` purely by stem, so two audio files that share a
/// stem but differ only in extension (e.g. `kick.wav` next to `kick.flac`)
/// also share one `.ot`. If only one of them is being purged, sweeping that
/// `.ot` away would silently strip slice/attribute data from the sibling
/// that survives - so this only returns the sidecar when every same-stem
/// audio sibling on disk is also present in `purged_paths`.
fn ot_sidecar_if_unshared(
    audio_path: &str,
    purged_paths: &std::collections::HashSet<String>,
) -> Option<std::path::PathBuf> {
    let path = std::path::Path::new(audio_path);
    let ot_path = path.with_extension("ot");
    if !ot_path.exists() {
        return None;
    }
    let dir = path.parent()?;
    let stem = path.file_stem()?;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let sibling = entry.path();
        if sibling == path {
            continue;
        }
        if sibling.file_stem() != Some(stem) {
            continue;
        }
        let sibling_name = sibling.file_name()?.to_string_lossy().to_string();
        if !crate::audio_pool::is_audio_file(&sibling_name) {
            continue;
        }
        if !purged_paths.contains(&sibling.to_string_lossy().to_string()) {
            return None; // a surviving sibling still needs this .ot
        }
    }
    Some(ot_path)
}

/// Per-unit progress reporting and cooperative cancellation for the two
/// execution paths below. A purge is a loop over independent units, so both
/// hooks act strictly between units: `on_unit` fires just before a unit is
/// touched, and `cancel` is only ever checked at the top of an iteration -
/// never mid-file, which would risk leaving a half-moved file behind.
pub struct PurgeProgress<'a> {
    /// `(path, index, total)` of the unit about to be processed.
    pub on_unit: &'a dyn Fn(&str, usize, usize),
    pub cancel: &'a std::sync::atomic::AtomicBool,
}

impl PurgeProgress<'_> {
    fn report(progress: Option<&PurgeProgress>, path: &str, index: usize, total: usize) {
        if let Some(p) = progress {
            (p.on_unit)(path, index, total);
        }
    }

    fn cancelled(progress: Option<&PurgeProgress>) -> bool {
        progress.is_some_and(|p| p.cancel.load(std::sync::atomic::Ordering::SeqCst))
    }
}

/// Sends every unit in `plan` to the OS Trash Bin (files and
/// directories alike - the `trash` crate moves a directory as a whole,
/// consistent with the directory-collapse goal of removing whole dirs
/// instead of emptying them out file by file). Recoverable by the user via
/// their system Trash Bin until they empty it - not a permanent,
/// unrecoverable delete. A `PurgeUnit::File`'s `.ot` sidecar (if any) is
/// trashed alongside it; a missing sidecar is not an error.
///
/// Trashed one unit at a time rather than in a single `delete_all` batch, so
/// progress can be reported and a cancel honoured between units. A unit that
/// fails to trash is recorded in `result.errors` and the rest still run -
/// same "one clash must not abort the batch" rule `move_purge_units` follows.
pub fn trash_purge_units(
    plan: &[PurgeUnit],
    origin_roots: &std::collections::HashMap<String, String>,
    progress: Option<&PurgeProgress>,
) -> Result<PurgeResult, String> {
    let purged_paths: std::collections::HashSet<String> = plan
        .iter()
        .filter_map(|u| match u {
            PurgeUnit::File { path, .. } => Some(path.clone()),
            PurgeUnit::Directory { .. } => None,
        })
        .collect();

    let mut result = PurgeResult::default();
    let mut queued_ot: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (index, unit) in plan.iter().enumerate() {
        if PurgeProgress::cancelled(progress) {
            result.cancelled = true;
            break;
        }
        PurgeProgress::report(progress, unit.path(), index, plan.len());

        let mut paths: Vec<String> = vec![unit.path().to_string()];
        let mut ot_bytes: u64 = 0;
        if let PurgeUnit::File { path, origin, .. } = unit {
            if let Some(ot_path) = ot_sidecar_if_unshared(path, &purged_paths) {
                let ot_str = ot_path.to_string_lossy().to_string();
                // Skip if an earlier same-stem sibling already swept it.
                if queued_ot.insert(ot_str.clone()) {
                    ot_bytes += std::fs::metadata(&ot_path).map(|m| m.len()).unwrap_or(0);
                    if origin != "Audio Pool" {
                        if let Some(root) = origin_roots.get(origin) {
                            if let Ok(rel) = ot_path.strip_prefix(std::path::Path::new(root)) {
                                if let Err(e) = crate::backup_project_files_impl(
                                    root,
                                    &[rel.to_string_lossy().to_string()],
                                    "purge_unused_samples",
                                ) {
                                    result.errors.push(format!(
                                        "Failed to back up {}: {}",
                                        ot_path.display(),
                                        e
                                    ));
                                }
                            }
                        }
                    }
                    paths.push(ot_str);
                }
            }
        }

        let path_refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        if let Err(e) = trash::delete_all(&path_refs) {
            result
                .errors
                .push(format!("Failed to trash {}: {}", unit.path(), e));
            continue;
        }

        result.bytes_reclaimed += unit.size() + ot_bytes;
        result.tally(unit);
    }

    Ok(result)
}

const PURGE_GROUPING_SUBDIR: &str = "Unused Audio";

/// Moves every unit in `plan` into
/// `<destination_dir>/Unused Audio/<origin>/<relative path from that
/// origin's root>`, creating directories as needed. A same-named collision
/// at the destination gets an auto-incrementing " (2)", " (3)", ... suffix
/// instead of erroring the whole batch out - unlike the existing
/// `move_files` (audio_pool.rs), a bulk purge shouldn't abort over one clash.
pub fn move_purge_units(
    plan: &[PurgeUnit],
    destination_dir: &str,
    origin_roots: &std::collections::HashMap<String, String>,
    progress: Option<&PurgeProgress>,
) -> Result<PurgeResult, String> {
    use std::path::Path;

    // Last-gate validation: an empty or relative destination (e.g. the
    // frontend's `purgeDestination` state starting as `''`, or a failed
    // `resolve_default_purge_destination`/`navigate_to_parent` call leaving
    // it unset) must never silently resolve against this process's working
    // directory - that would relocate files to an unpredictable place while
    // still reporting success.
    let trimmed_dest = destination_dir.trim();
    if trimmed_dest.is_empty() || !Path::new(trimmed_dest).is_absolute() {
        return Err(format!(
            "Invalid move destination '{}': must be a non-empty, absolute path",
            destination_dir
        ));
    }

    let dest_root = Path::new(trimmed_dest).join(PURGE_GROUPING_SUBDIR);
    let mut result = PurgeResult::default();

    let purged_paths: std::collections::HashSet<String> = plan
        .iter()
        .filter_map(|u| match u {
            PurgeUnit::File { path, .. } => Some(path.clone()),
            PurgeUnit::Directory { .. } => None,
        })
        .collect();

    for (index, unit) in plan.iter().enumerate() {
        if PurgeProgress::cancelled(progress) {
            result.cancelled = true;
            break;
        }
        PurgeProgress::report(progress, unit.path(), index, plan.len());

        let origin = match unit {
            PurgeUnit::File { origin, .. } | PurgeUnit::Directory { origin, .. } => origin,
        };
        let Some(root) = origin_roots.get(origin) else {
            result
                .errors
                .push(format!("Unknown origin '{}' for {}", origin, unit.path()));
            continue;
        };

        let source = Path::new(unit.path());
        let relative = match source.strip_prefix(Path::new(root)) {
            Ok(r) => r,
            Err(_) => {
                result.errors.push(format!(
                    "{} is not inside its origin root {}",
                    unit.path(),
                    root
                ));
                continue;
            }
        };

        let mut target = dest_root.join(origin).join(relative);
        if let Some(parent) = target.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                result
                    .errors
                    .push(format!("Failed to create {}: {}", parent.display(), e));
                continue;
            }
        }
        target = unique_destination(target);

        if let Err(e) = std::fs::rename(source, &target) {
            result
                .errors
                .push(format!("Failed to move {}: {}", unit.path(), e));
            continue;
        }

        result.bytes_reclaimed += unit.size();
        result.tally(unit);
        match unit {
            PurgeUnit::File { path, .. } => {
                // Sweep the .ot sidecar along too (Finding 5): derive its
                // destination from the audio file's own (already
                // collision-resolved) target so the pair stays named
                // together, then defensively re-run unique_destination in
                // case that derived name itself collides with a leftover
                // .ot at the destination.
                if let Some(ot_source) = ot_sidecar_if_unshared(path, &purged_paths) {
                    let ot_target = unique_destination(target.with_extension("ot"));
                    if origin != "Audio Pool" {
                        if let Ok(rel) = ot_source.strip_prefix(Path::new(root)) {
                            if let Err(e) = crate::backup_project_files_impl(
                                root,
                                &[rel.to_string_lossy().to_string()],
                                "purge_unused_samples",
                            ) {
                                result.errors.push(format!(
                                    "Failed to back up {}: {}",
                                    ot_source.display(),
                                    e
                                ));
                            }
                        }
                    }
                    result.bytes_reclaimed +=
                        std::fs::metadata(&ot_source).map(|m| m.len()).unwrap_or(0);
                    if let Err(e) = std::fs::rename(&ot_source, &ot_target) {
                        result.errors.push(format!(
                            "Failed to move .ot sidecar {}: {}",
                            ot_source.display(),
                            e
                        ));
                    }
                }
            }
            PurgeUnit::Directory { .. } => {} // no per-file sidecar work: the whole dir moves as a unit
        }
    }

    Ok(result)
}

/// If `target` already exists, append " (2)", " (3)", ... before the
/// extension (or at the end for an extension-less name/directory) until a
/// free name is found.
fn unique_destination(target: std::path::PathBuf) -> std::path::PathBuf {
    if !target.exists() {
        return target;
    }
    let parent = target.parent().unwrap_or_else(|| std::path::Path::new(""));
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = target.extension().map(|e| e.to_string_lossy().to_string());

    let mut n = 2;
    loop {
        let candidate_name = match &ext {
            Some(ext) => format!("{} ({}).{}", stem, n, ext),
            None => format!("{} ({})", stem, n),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purge_unit_serializes_with_a_kind_tag_the_frontend_can_discriminate_on() {
        let file = PurgeUnit::File {
            path: "/set/AUDIO/loop.wav".to_string(),
            origin: "Audio Pool".to_string(),
            size: 1234,
            slots: vec![],
            sidecar: None,
        };
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(json["kind"], "File");
        assert_eq!(json["path"], "/set/AUDIO/loop.wav");
        assert_eq!(json["size"], 1234);

        let dir = PurgeUnit::Directory {
            path: "/set/AUDIO/oldkit".to_string(),
            origin: "Audio Pool".to_string(),
            file_count: 3,
            non_audio_count: 0,
            size: 9000,
            files: vec![PurgeFileEntry {
                path: "/set/AUDIO/oldkit/kick.wav".to_string(),
                size: 500,
                slots: vec![],
                is_audio: true,
            }],
        };
        assert_eq!(dir.path(), "/set/AUDIO/oldkit");
        assert_eq!(dir.size(), 9000);
        let json = serde_json::to_value(&dir).unwrap();
        assert_eq!(json["kind"], "Directory");
        assert_eq!(json["file_count"], 3);
    }

    #[test]
    fn pick_first_existing_skips_missing_candidates_and_falls_back() {
        let temp = tempfile::TempDir::new().unwrap();
        let real_dir = temp.path().join("real");
        std::fs::create_dir(&real_dir).unwrap();
        let missing_dir = temp.path().join("does-not-exist");

        // First candidate missing, second real -> picks the second.
        let result = pick_first_existing(
            &[Some(missing_dir.clone()), Some(real_dir.clone())],
            "/fallback",
        );
        assert_eq!(result, real_dir.to_string_lossy().to_string());

        // Nothing exists -> falls back.
        let result = pick_first_existing(&[Some(missing_dir), None], "/fallback");
        assert_eq!(result, "/fallback");

        // Empty candidate list -> falls back.
        let result = pick_first_existing(&[], "/fallback");
        assert_eq!(result, "/fallback");
    }

    fn touch(path: &std::path::Path) {
        std::fs::write(path, b"x").unwrap();
    }

    #[test]
    fn a_directory_whose_audio_files_are_all_unused_collapses_to_one_unit() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().join("kit");
        std::fs::create_dir(&dir).unwrap();
        touch(&dir.join("kick.wav"));
        touch(&dir.join("snare.wav"));

        let unused = vec![
            (
                dir.join("kick.wav").to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
            (
                dir.join("snare.wav").to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
        ];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        match &plan[0] {
            PurgeUnit::Directory {
                path, file_count, ..
            } => {
                assert_eq!(path, &dir.to_string_lossy().to_string());
                assert_eq!(*file_count, 2);
            }
            other => panic!("expected a Directory unit, got {:?}", other),
        }
    }

    #[test]
    fn a_collapsed_directory_lists_and_counts_the_non_audio_files_it_sweeps_along() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().join("kit");
        std::fs::create_dir(&dir).unwrap();
        touch(&dir.join("kick.wav"));
        std::fs::write(dir.join("cover.jpg"), b"1234567890").unwrap();
        std::fs::write(dir.join("readme.txt"), b"abc").unwrap();

        let unused = vec![(
            dir.join("kick.wav").to_string_lossy().to_string(),
            "Audio Pool".to_string(),
            100,
        )];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        match &plan[0] {
            PurgeUnit::Directory {
                file_count,
                non_audio_count,
                size,
                files,
                ..
            } => {
                assert_eq!(*file_count, 1, "audio count stays audio-only");
                assert_eq!(*non_audio_count, 2);
                // 100 (declared audio size) + 10 (cover.jpg) + 3 (readme.txt)
                assert_eq!(*size, 113, "non-audio bytes are reclaimed too");
                let listed: Vec<(&str, bool)> = files
                    .iter()
                    .map(|f| (f.path.rsplit('/').next().unwrap_or(&f.path), f.is_audio))
                    .collect();
                assert_eq!(
                    listed,
                    vec![
                        ("cover.jpg", false),
                        ("kick.wav", true),
                        ("readme.txt", false)
                    ]
                );
            }
            other => panic!("expected a Directory unit, got {:?}", other),
        }
    }

    #[test]
    fn a_lone_file_carries_its_ot_sidecar_into_the_plan_so_the_review_table_can_show_it() {
        let temp = tempfile::TempDir::new().unwrap();
        let wav = temp.path().join("kick.wav");
        touch(&wav);
        std::fs::write(temp.path().join("kick.ot"), b"0123456789").unwrap();
        let no_sidecar = temp.path().join("snare.wav");
        touch(&no_sidecar);

        let unused = vec![
            (
                wav.to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
            (
                no_sidecar.to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
        ];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        let kick = plan
            .iter()
            .find(|u| u.path() == wav.to_string_lossy())
            .unwrap();
        match kick {
            PurgeUnit::File { size, sidecar, .. } => {
                let sidecar = sidecar.as_ref().expect("kick.wav drags kick.ot along");
                assert!(sidecar.path.ends_with("kick.ot"));
                assert_eq!(sidecar.size, 10);
                assert!(!sidecar.is_audio);
                // Not folded into the audio file's own size - the execution
                // paths add the sidecar's bytes separately.
                assert_eq!(*size, 1);
            }
            other => panic!("expected a File unit, got {:?}", other),
        }

        let snare = plan
            .iter()
            .find(|u| u.path() == no_sidecar.to_string_lossy())
            .unwrap();
        assert!(matches!(snare, PurgeUnit::File { sidecar: None, .. }));
    }

    /// Same rule the execution paths already follow: an `.ot` shared with a
    /// same-stem audio sibling that is NOT being purged must not be listed as
    /// going anywhere, because it isn't.
    #[test]
    fn a_shared_ot_sidecar_is_not_listed_when_a_same_stem_sibling_survives() {
        let temp = tempfile::TempDir::new().unwrap();
        let wav = temp.path().join("kick.wav");
        touch(&wav);
        touch(&temp.path().join("kick.flac")); // survives - still referenced
        std::fs::write(temp.path().join("kick.ot"), b"x").unwrap();

        let unused = vec![(
            wav.to_string_lossy().to_string(),
            "Audio Pool".to_string(),
            1,
        )];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        assert!(matches!(&plan[0], PurgeUnit::File { sidecar: None, .. }));
    }

    #[test]
    fn a_directory_holding_only_non_audio_files_is_never_purged() {
        let temp = tempfile::TempDir::new().unwrap();
        let lone = temp.path().join("stray.wav");
        touch(&lone);
        let docs = temp.path().join("docs");
        std::fs::create_dir(&docs).unwrap();
        touch(&docs.join("notes.txt"));

        let unused = vec![(
            lone.to_string_lossy().to_string(),
            "Audio Pool".to_string(),
            1,
        )];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        // Only the lone audio file - `docs/` holds no unused sample, so it is
        // not a finding no matter what else is inside it.
        assert_eq!(plan.len(), 1);
        assert!(
            matches!(&plan[0], PurgeUnit::File { path, .. } if path == &lone.to_string_lossy().to_string())
        );
    }

    #[test]
    fn a_collapsed_directory_lists_every_audio_file_it_absorbed() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().join("kit");
        std::fs::create_dir(&dir).unwrap();
        touch(&dir.join("kick.wav"));
        touch(&dir.join("snare.wav"));

        let unused = vec![
            (
                dir.join("kick.wav").to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
            (
                dir.join("snare.wav").to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
        ];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        match &plan[0] {
            PurgeUnit::Directory { files, .. } => {
                let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
                assert_eq!(
                    paths,
                    vec![
                        dir.join("kick.wav").to_string_lossy().to_string(),
                        dir.join("snare.wav").to_string_lossy().to_string(),
                    ],
                    "files should be sorted alphabetically"
                );
                assert!(
                    files.iter().all(|f| f.size == 1),
                    "each absorbed file entry should carry its own size"
                );
            }
            other => panic!("expected a Directory unit, got {:?}", other),
        }
    }

    #[test]
    fn build_purge_plan_attaches_provided_slot_labels_to_both_files_and_directory_children() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().join("kit");
        std::fs::create_dir(&dir).unwrap();
        touch(&dir.join("kick.wav"));
        touch(&temp.path().join("lone.wav"));

        let lone_path = temp.path().join("lone.wav").to_string_lossy().to_string();
        let kick_path = dir.join("kick.wav").to_string_lossy().to_string();

        let unused = vec![
            (lone_path.clone(), "Audio Pool".to_string(), 1),
            (kick_path.clone(), "Audio Pool".to_string(), 1),
        ];
        let mut slot_labels = std::collections::HashMap::new();
        slot_labels.insert(lone_path.clone(), vec!["S3".to_string()]);
        slot_labels.insert(kick_path.clone(), vec!["F5".to_string()]);

        let plan = build_purge_plan(unused, temp.path(), &slot_labels);

        assert_eq!(plan.len(), 2);
        let file_unit = plan
            .iter()
            .find(|u| matches!(u, PurgeUnit::File { .. }))
            .expect("lone.wav should be a standalone File unit");
        match file_unit {
            PurgeUnit::File { slots, .. } => assert_eq!(slots, &vec!["S3".to_string()]),
            _ => unreachable!(),
        }
        let dir_unit = plan
            .iter()
            .find(|u| matches!(u, PurgeUnit::Directory { .. }))
            .expect("kit/ should collapse into a Directory unit");
        match dir_unit {
            PurgeUnit::Directory { files, .. } => {
                assert_eq!(files.len(), 1);
                assert_eq!(files[0].slots, vec!["F5".to_string()]);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn a_directory_with_one_still_used_audio_file_does_not_collapse() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().join("kit");
        std::fs::create_dir(&dir).unwrap();
        touch(&dir.join("kick.wav")); // unused
        touch(&dir.join("keeper.wav")); // NOT in the unused list - still referenced

        let unused = vec![(
            dir.join("kick.wav").to_string_lossy().to_string(),
            "Audio Pool".to_string(),
            1,
        )];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        match &plan[0] {
            PurgeUnit::File { path, .. } => {
                assert_eq!(path, &dir.join("kick.wav").to_string_lossy().to_string())
            }
            other => panic!("expected a File unit, got {:?}", other),
        }
    }

    #[test]
    fn non_audio_files_are_swept_along_and_do_not_block_collapse() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().join("kit");
        std::fs::create_dir(&dir).unwrap();
        touch(&dir.join("kick.wav"));
        touch(&dir.join("notes.txt")); // stray non-audio file, never in the unused list

        let unused = vec![(
            dir.join("kick.wav").to_string_lossy().to_string(),
            "Audio Pool".to_string(),
            1,
        )];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        assert!(
            matches!(&plan[0], PurgeUnit::Directory { .. }),
            "notes.txt should not block collapse"
        );
    }

    #[test]
    fn nested_directories_collapse_bottom_up() {
        let temp = tempfile::TempDir::new().unwrap();
        let outer = temp.path().join("kits");
        let inner = outer.join("808");
        std::fs::create_dir_all(&inner).unwrap();
        touch(&inner.join("kick.wav"));
        touch(&outer.join("clap.wav"));

        let unused = vec![
            (
                inner.join("kick.wav").to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
            (
                outer.join("clap.wav").to_string_lossy().to_string(),
                "Audio Pool".to_string(),
                1,
            ),
        ];
        let plan = build_purge_plan(unused, temp.path(), &std::collections::HashMap::new());

        // Only the outer directory should be emitted (it fully subsumes the inner one).
        assert_eq!(plan.len(), 1);
        match &plan[0] {
            PurgeUnit::Directory {
                path,
                file_count,
                files,
                ..
            } => {
                assert_eq!(path, &outer.to_string_lossy().to_string());
                assert_eq!(*file_count, 2);
                // The inner (absorbed) directory's file is carried forward into
                // the outer unit's file list, not just its count/size -
                // sorted alphabetically by full path ("808/..." < "clap.wav").
                let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
                assert_eq!(
                    paths,
                    vec![
                        inner.join("kick.wav").to_string_lossy().to_string(),
                        outer.join("clap.wav").to_string_lossy().to_string(),
                    ]
                );
            }
            other => panic!("expected a Directory unit, got {:?}", other),
        }
    }

    #[test]
    fn the_scan_root_itself_never_collapses_even_if_everything_inside_is_unused() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path().join("PROJ");
        std::fs::create_dir(&root).unwrap();
        touch(&root.join("orphan.wav")); // the only audio file directly in the root
        touch(&root.join("project.work")); // stand-in for real project metadata - must never be swept away

        let unused = vec![(
            root.join("orphan.wav").to_string_lossy().to_string(),
            "PROJ".to_string(),
            1,
        )];
        let plan = build_purge_plan(unused, &root, &std::collections::HashMap::new());

        assert_eq!(plan.len(), 1);
        match &plan[0] {
            PurgeUnit::File { path, .. } => {
                assert_eq!(path, &root.join("orphan.wav").to_string_lossy().to_string())
            }
            other => panic!(
                "root directory must never collapse into a Directory unit, got {:?}",
                other
            ),
        }
        assert!(
            root.join("project.work").exists(),
            "sanity check only - this test never deletes anything"
        );
    }

    fn write_minimal_project_with_sample_block(
        project_dir: &std::path::Path,
        slot_type: &str,
        slot: u16,
        path: &str,
    ) {
        use ot_tools_io::{BankFile, OctatrackFileIO};

        let mut content = String::new();
        content.push_str("[META]\r\nTYPE=OCTATRACK DPS-1 PROJECT\r\nVERSION=19\r\n[/META]\r\n\r\n");
        content.push_str("[SAMPLE]\r\n");
        content.push_str(&format!("TYPE={}\r\n", slot_type));
        content.push_str(&format!("SLOT={}\r\n", slot));
        content.push_str(&format!("PATH={}\r\n", path));
        content.push_str("[/SAMPLE]\r\n\r\n");
        std::fs::write(project_dir.join("project.work"), content).unwrap();

        for bank_num in 1..=16 {
            BankFile::default()
                .to_data_file(&project_dir.join(format!("bank{:02}.work", bank_num)))
                .unwrap();
        }
    }

    /// Same as `write_minimal_project_with_sample_block` but with two
    /// `[SAMPLE]` blocks, both loaded (`PATH=`) but never triggered - used
    /// to verify a file loaded into more than one slot at once collects
    /// every one of those slots' labels, not just the first found.
    fn write_minimal_project_with_two_sample_blocks(
        project_dir: &std::path::Path,
        first: (&str, u16, &str),
        second: (&str, u16, &str),
    ) {
        use ot_tools_io::{BankFile, OctatrackFileIO};

        let mut content = String::new();
        content.push_str("[META]\r\nTYPE=OCTATRACK DPS-1 PROJECT\r\nVERSION=19\r\n[/META]\r\n\r\n");
        for (slot_type, slot, path) in [first, second] {
            content.push_str("[SAMPLE]\r\n");
            content.push_str(&format!("TYPE={}\r\n", slot_type));
            content.push_str(&format!("SLOT={}\r\n", slot));
            content.push_str(&format!("PATH={}\r\n", path));
            content.push_str("[/SAMPLE]\r\n\r\n");
        }
        std::fs::write(project_dir.join("project.work"), content).unwrap();

        for bank_num in 1..=16 {
            BankFile::default()
                .to_data_file(&project_dir.join(format!("bank{:02}.work", bank_num)))
                .unwrap();
        }
    }

    #[test]
    fn a_flex_slot_loaded_but_never_triggered_only_frees_its_file_when_simulating_clear() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_minimal_project_with_sample_block(&project_dir, "FLEX", 2, "loaded.wav");
        touch(&project_dir.join("loaded.wav"));

        let with_simulation =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, true).unwrap();
        assert_eq!(with_simulation.len(), 1);
        match &with_simulation[0] {
            PurgeUnit::File { slots, .. } => assert_eq!(
                slots,
                &vec!["F2".to_string()],
                "FLEX slot 2 should be labeled with the F prefix, not S"
            ),
            other => panic!("expected a File unit, got {:?}", other),
        }
    }

    #[test]
    fn a_file_loaded_into_two_slots_at_once_collects_both_slot_labels() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_minimal_project_with_two_sample_blocks(
            &project_dir,
            ("STATIC", 1, "loaded.wav"),
            ("FLEX", 2, "loaded.wav"),
        );
        touch(&project_dir.join("loaded.wav"));

        let with_simulation =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, true).unwrap();
        assert_eq!(with_simulation.len(), 1);
        match &with_simulation[0] {
            PurgeUnit::File { slots, .. } => {
                let mut sorted = slots.clone();
                sorted.sort();
                assert_eq!(sorted, vec!["F2".to_string(), "S1".to_string()]);
            }
            other => panic!("expected a File unit, got {:?}", other),
        }
    }

    #[test]
    fn a_file_with_no_slot_referencing_it_is_unused() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        touch(&project_dir.join("orphan.wav"));
        // Not referenced by any [SAMPLE] block at all.
        write_minimal_project_with_sample_block(&project_dir, "STATIC", 1, "referenced.wav");
        touch(&project_dir.join("referenced.wav"));

        let plan =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, false).unwrap();

        assert_eq!(plan.len(), 1);
        assert_eq!(
            plan[0].path(),
            project_dir.join("orphan.wav").to_string_lossy()
        );
    }

    #[test]
    fn a_slot_loaded_but_never_triggered_only_frees_its_file_when_simulating_clear() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_minimal_project_with_sample_block(&project_dir, "STATIC", 1, "loaded.wav");
        touch(&project_dir.join("loaded.wav"));

        let without_simulation =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, false).unwrap();
        assert!(
            without_simulation.is_empty(),
            "a loaded slot is real usage until something clears it"
        );

        let with_simulation =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, true).unwrap();
        assert_eq!(with_simulation.len(), 1);
        assert_eq!(
            with_simulation[0].path(),
            project_dir.join("loaded.wav").to_string_lossy()
        );
        match &with_simulation[0] {
            PurgeUnit::File { slots, .. } => assert_eq!(
                slots,
                &vec!["S1".to_string()],
                "the file's own STATIC slot 1 should be labeled, mirroring Fix Project Samples's Slot ID column"
            ),
            other => panic!("expected a File unit, got {:?}", other),
        }
    }

    #[test]
    fn backups_directory_is_excluded_by_default() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        let backups_dir = project_dir.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();
        touch(&backups_dir.join("old.wav"));
        write_minimal_project_with_sample_block(&project_dir, "STATIC", 1, "kept.wav");
        touch(&project_dir.join("kept.wav"));

        let excluded =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, false).unwrap();
        assert!(
            excluded.is_empty(),
            "backups/ should be invisible to the scan by default"
        );

        let included =
            compute_project_unused_files(&project_dir.to_string_lossy(), false, false).unwrap();
        // backups/ is not the scan root and its only audio content (old.wav)
        // is entirely unused, so it collapses to a single Directory unit
        // (same rule verified by
        // `a_directory_whose_audio_files_are_all_unused_collapses_to_one_unit`)
        // rather than surfacing as an individual File unit.
        assert_eq!(included.len(), 1);
        assert_eq!(included[0].path(), backups_dir.to_string_lossy());
    }

    #[test]
    fn a_pool_file_referenced_by_no_project_is_unused() {
        let temp = tempfile::TempDir::new().unwrap();
        let set_dir = temp.path();
        let pool_dir = set_dir.join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("orphan.wav"));

        let project_dir = set_dir.join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_minimal_project_with_sample_block(&project_dir, "STATIC", 1, "../AUDIO/kept.wav");
        touch(&pool_dir.join("kept.wav"));

        let plan = compute_pool_unused_files(&pool_dir.to_string_lossy(), &[]).unwrap();

        assert_eq!(plan.len(), 1);
        assert_eq!(
            plan[0].path(),
            pool_dir.join("orphan.wav").to_string_lossy()
        );
    }

    #[test]
    fn a_pool_file_only_assigned_in_a_project_being_slot_cleared_becomes_purgeable() {
        let temp = tempfile::TempDir::new().unwrap();
        let set_dir = temp.path();
        let pool_dir = set_dir.join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("loaded.wav"));

        let project_dir = set_dir.join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_minimal_project_with_sample_block(&project_dir, "STATIC", 1, "../AUDIO/loaded.wav");

        let without_simulation =
            compute_pool_unused_files(&pool_dir.to_string_lossy(), &[]).unwrap();
        assert!(
            without_simulation.is_empty(),
            "a loaded slot is real usage until something clears it"
        );

        let with_simulation =
            compute_pool_unused_files(&pool_dir.to_string_lossy(), &["PROJ".to_string()]).unwrap();
        assert_eq!(with_simulation.len(), 1);
        assert_eq!(
            with_simulation[0].path(),
            pool_dir.join("loaded.wav").to_string_lossy()
        );
        match &with_simulation[0] {
            PurgeUnit::File { slots, .. } => assert_eq!(
                slots,
                &vec!["S1".to_string()],
                "the slot label of PROJ's STATIC slot 1 should carry over from the dropped 'assigned' usage entry"
            ),
            other => panic!("expected a File unit, got {:?}", other),
        }
    }

    #[test]
    fn a_pool_file_assigned_in_two_projects_being_slot_cleared_collects_both_slot_labels() {
        let temp = tempfile::TempDir::new().unwrap();
        let set_dir = temp.path();
        let pool_dir = set_dir.join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("loaded.wav"));

        let proj_a = set_dir.join("PROJA");
        std::fs::create_dir(&proj_a).unwrap();
        write_minimal_project_with_sample_block(&proj_a, "STATIC", 1, "../AUDIO/loaded.wav");

        let proj_b = set_dir.join("PROJB");
        std::fs::create_dir(&proj_b).unwrap();
        write_minimal_project_with_sample_block(&proj_b, "FLEX", 2, "../AUDIO/loaded.wav");

        // Only PROJA is included in slot-clearing simulation - the file is
        // still real usage via PROJB's loaded slot, so it must not appear
        // as purgeable yet.
        let partial_simulation =
            compute_pool_unused_files(&pool_dir.to_string_lossy(), &["PROJA".to_string()]).unwrap();
        assert!(
            partial_simulation.is_empty(),
            "PROJB's slot is still real usage until it too is simulated as cleared"
        );

        let with_both_simulated = compute_pool_unused_files(
            &pool_dir.to_string_lossy(),
            &["PROJA".to_string(), "PROJB".to_string()],
        )
        .unwrap();
        assert_eq!(with_both_simulated.len(), 1);
        match &with_both_simulated[0] {
            PurgeUnit::File { slots, .. } => {
                let mut sorted = slots.clone();
                sorted.sort();
                assert_eq!(sorted, vec!["F2".to_string(), "S1".to_string()]);
            }
            other => panic!("expected a File unit, got {:?}", other),
        }
    }

    /// `write_minimal_project_with_sample_block` only writes `[META]` + `[SAMPLE]`,
    /// which is enough for `compute_sample_usage`/`read_raw_sample_fields` (raw text
    /// parsing) but NOT enough for `clear_sample_slots`, which re-reads the file via
    /// `read_project_metadata` -> `ProjectFile::from_data_file` after writing, and that
    /// needs `[SETTINGS]`/`[STATES]` plus the 8 recorder-buffer `[SAMPLE]` blocks to
    /// parse successfully. Mirrors the fixture project_reader.rs's own
    /// `clear_sample_slots` tests already use (`setup_project_for_assign` /
    /// `create_raw_project_work_with_custom_fields`), inlined here since that helper is
    /// `pub(super)` to project_reader.rs's own test module.
    fn write_full_project_with_sample_block(
        project_dir: &std::path::Path,
        slot_type: &str,
        slot: u16,
        path: &str,
    ) {
        use ot_tools_io::{BankFile, OctatrackFileIO};

        let mut content = String::new();
        content.push_str("[META]\r\n");
        content.push_str("TYPE=OCTATRACK DPS-1 PROJECT\r\n");
        content.push_str("VERSION=19\r\n");
        content.push_str("OS_VERSION=R0177     1.40B\r\n");
        content.push_str("[/META]\r\n\r\n");
        content.push_str("[SETTINGS]\r\n");
        content.push_str("WRITEPROTECTED=0\r\n");
        content.push_str("TEMPOx24=2880\r\n");
        content.push_str("PATTERN_TEMPO_ENABLED=0\r\n");
        content.push_str("MIDI_CLOCK_SEND=0\r\nMIDI_CLOCK_RECEIVE=0\r\n");
        content.push_str("MIDI_TRANSPORT_SEND=0\r\nMIDI_TRANSPORT_RECEIVE=0\r\n");
        content.push_str("MIDI_PROGRAM_CHANGE_SEND=0\r\nMIDI_PROGRAM_CHANGE_SEND_CH=-1\r\n");
        content.push_str("MIDI_PROGRAM_CHANGE_RECEIVE=0\r\nMIDI_PROGRAM_CHANGE_RECEIVE_CH=-1\r\n");
        content.push_str(
            "MIDI_TRIG_CH1=0\r\nMIDI_TRIG_CH2=1\r\nMIDI_TRIG_CH3=2\r\nMIDI_TRIG_CH4=3\r\n",
        );
        content.push_str(
            "MIDI_TRIG_CH5=4\r\nMIDI_TRIG_CH6=5\r\nMIDI_TRIG_CH7=6\r\nMIDI_TRIG_CH8=7\r\n",
        );
        content.push_str("MIDI_AUTO_CHANNEL=10\r\nMIDI_SOFT_THRU=0\r\n");
        content.push_str("MIDI_AUDIO_TRK_CC_IN=1\r\nMIDI_AUDIO_TRK_CC_OUT=3\r\n");
        content.push_str("MIDI_AUDIO_TRK_NOTE_IN=1\r\nMIDI_AUDIO_TRK_NOTE_OUT=3\r\n");
        content.push_str("MIDI_MIDI_TRK_CC_IN=1\r\n");
        content.push_str("PATTERN_CHANGE_CHAIN_BEHAVIOR=0\r\n");
        content.push_str("PATTERN_CHANGE_AUTO_SILENCE_TRACKS=0\r\n");
        content.push_str("PATTERN_CHANGE_AUTO_TRIG_LFOS=0\r\n");
        content.push_str("LOAD_24BIT_FLEX=0\r\nDYNAMIC_RECORDERS=0\r\nRECORD_24BIT=0\r\n");
        content.push_str("RESERVED_RECORDER_COUNT=8\r\nRESERVED_RECORDER_LENGTH=16\r\n");
        content.push_str("INPUT_DELAY_COMPENSATION=0\r\n");
        content.push_str("GATE_AB=127\r\nGATE_CD=127\r\nGAIN_AB=64\r\nGAIN_CD=64\r\n");
        content.push_str("DIR_AB=0\r\nDIR_CD=0\r\nPHONES_MIX=64\r\nMAIN_TO_CUE=0\r\n");
        content
            .push_str("MASTER_TRACK=0\r\nCUE_STUDIO_MODE=0\r\nMAIN_LEVEL=64\r\nCUE_LEVEL=64\r\n");
        content
            .push_str("METRONOME_TIME_SIGNATURE=3\r\nMETRONOME_TIME_SIGNATURE_DENOMINATOR=2\r\n");
        content.push_str(
            "METRONOME_PREROLL=0\r\nMETRONOME_CUE_VOLUME=32\r\nMETRONOME_MAIN_VOLUME=0\r\n",
        );
        content.push_str("METRONOME_PITCH=12\r\nMETRONOME_TONAL=1\r\nMETRONOME_ENABLED=0\r\n");
        content.push_str(
            "TRIG_MODE_MIDI=0\r\nTRIG_MODE_MIDI=0\r\nTRIG_MODE_MIDI=0\r\nTRIG_MODE_MIDI=0\r\n",
        );
        content.push_str(
            "TRIG_MODE_MIDI=0\r\nTRIG_MODE_MIDI=0\r\nTRIG_MODE_MIDI=0\r\nTRIG_MODE_MIDI=0\r\n",
        );
        content.push_str("[/SETTINGS]\r\n\r\n");
        content.push_str("[STATES]\r\n");
        content.push_str("BANK=0\r\nPATTERN=0\r\nARRANGEMENT=0\r\nARRANGEMENT_MODE=0\r\n");
        content.push_str("PART=0\r\nTRACK=0\r\nTRACK_OTHERMODE=0\r\n");
        content.push_str("SCENE_A_MUTE=0\r\nSCENE_B_MUTE=0\r\nTRACK_CUE_MASK=0\r\n");
        content.push_str("TRACK_MUTE_MASK=0\r\nTRACK_SOLO_MASK=0\r\n");
        content.push_str("MIDI_TRACK_MUTE_MASK=0\r\nMIDI_TRACK_SOLO_MASK=0\r\nMIDI_MODE=0\r\n");
        content.push_str("[/STATES]\r\n\r\n");
        content.push_str("############################\r\n");
        content.push_str("# Samples\r\n");
        content.push_str("############################\r\n\r\n");

        content.push_str("[SAMPLE]\r\n");
        content.push_str(&format!("TYPE={}\r\n", slot_type));
        content.push_str(&format!("SLOT={}\r\n", slot));
        content.push_str(&format!("PATH={}\r\n", path));
        content.push_str("TSMODE=2\r\nLOOPMODE=1\r\nGAIN=48\r\nTRIGQUANTIZATION=255\r\n");
        content.push_str("[/SAMPLE]\r\n\r\n");

        // Recording buffer slots (required by the ot-tools-io parser).
        for slot_id in 129..=136 {
            content.push_str("[SAMPLE]\r\n");
            content.push_str("TYPE=FLEX\r\n");
            content.push_str(&format!("SLOT={}\r\n", slot_id));
            content.push_str("PATH=\r\n");
            content.push_str("BPMx24=2880\r\nTSMODE=2\r\nLOOPMODE=0\r\nGAIN=72\r\n");
            content.push_str("TRIGQUANTIZATION=255\r\n");
            content.push_str("[/SAMPLE]\r\n\r\n");
        }

        content.push_str("############################\r\n\r\n");

        let (encoded, _, _) = encoding_rs::WINDOWS_1258.encode(&content);
        std::fs::write(project_dir.join("project.work"), &*encoded).unwrap();

        for bank_num in 1..=16 {
            BankFile::default()
                .to_data_file(&project_dir.join(format!("bank{:02}.work", bank_num)))
                .unwrap();
        }
    }

    #[test]
    fn clears_a_loaded_but_never_triggered_slot_and_backs_up_first() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_full_project_with_sample_block(&project_dir, "STATIC", 1, "loaded.wav");
        touch(&project_dir.join("loaded.wav"));

        let cleared = clear_unused_slot_assignments(&project_dir.to_string_lossy()).unwrap();
        assert_eq!(cleared, 1);

        let content = std::fs::read_to_string(project_dir.join("project.work")).unwrap();
        assert!(
            !content.contains("PATH=loaded.wav"),
            "the [SAMPLE] block should be gone: {content}"
        );

        let backups_dir = project_dir.join("backups");
        assert!(
            backups_dir.is_dir(),
            "clearing a slot should back up project.work first"
        );
        let backup_count = std::fs::read_dir(&backups_dir).unwrap().count();
        assert_eq!(backup_count, 1);
    }

    #[test]
    fn leaves_an_actually_used_slot_untouched() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();

        // Slot 1 (0-based idx 0) has a real machine assignment with a trigger, via bank01.
        use ot_tools_io::{BankFile, HasChecksumField, OctatrackFileIO};

        let mut bank1 = BankFile::default();
        let part = &mut bank1.parts.unsaved.0[0];
        part.audio_track_machine_types[0] = 0; // static machine
        part.audio_track_machine_slots[0].static_slot_id = 0; // 0-based slot 1
        bank1.patterns.0[0].audio_track_trigs.0[0]
            .trig_masks
            .trigger = [0, 1, 0, 0, 0, 0, 0, 0];
        bank1.checksum = bank1.calculate_checksum().unwrap();
        bank1
            .to_data_file(&project_dir.join("bank01.work"))
            .unwrap();
        for bank_num in 2..=16 {
            BankFile::default()
                .to_data_file(&project_dir.join(format!("bank{:02}.work", bank_num)))
                .unwrap();
        }

        let mut content = String::new();
        content.push_str("[META]\r\nTYPE=OCTATRACK DPS-1 PROJECT\r\nVERSION=19\r\n[/META]\r\n\r\n");
        content.push_str("[SAMPLE]\r\nTYPE=STATIC\r\nSLOT=1\r\nPATH=used.wav\r\n[/SAMPLE]\r\n\r\n");
        std::fs::write(project_dir.join("project.work"), content).unwrap();
        touch(&project_dir.join("used.wav"));

        let cleared = clear_unused_slot_assignments(&project_dir.to_string_lossy()).unwrap();
        assert_eq!(cleared, 0);
        let content = std::fs::read_to_string(project_dir.join("project.work")).unwrap();
        assert!(content.contains("PATH=used.wav"));
    }

    #[test]
    fn trash_purge_units_removes_files_from_their_original_location() {
        let temp = tempfile::TempDir::new().unwrap();
        let file_path = temp.path().join("gone.wav");
        touch(&file_path);

        let plan = vec![PurgeUnit::File {
            path: file_path.to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];

        let result = trash_purge_units(&plan, &std::collections::HashMap::new(), None).unwrap();

        assert!(!file_path.exists());
        assert_eq!(
            result.files_removed,
            vec![file_path.to_string_lossy().to_string()]
        );
        assert_eq!(result.bytes_reclaimed, 1);
        assert!(result.dirs_removed.is_empty());
    }

    #[test]
    fn move_purge_units_groups_by_origin_under_an_unused_audio_subfolder() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("orphan.wav"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("orphan.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        let expected = dest
            .join("Unused Audio")
            .join("Audio Pool")
            .join("orphan.wav");
        assert!(
            expected.is_file(),
            "expected {} to exist",
            expected.display()
        );
        assert!(!pool_dir.join("orphan.wav").exists());
        assert_eq!(result.files_removed, vec![plan[0].path().to_string()]);
    }

    /// The done screen used to read "0 files and 1 directory removed" for a
    /// directory holding 50 files, because `files_removed` only ever lists
    /// standalone units. Both execution paths must roll the directory's own
    /// contents into the audio/non-audio totals.
    #[test]
    fn removing_a_directory_counts_the_files_inside_it_not_just_the_directory() {
        for delete in [true, false] {
            let temp = tempfile::TempDir::new().unwrap();
            let pool_dir = temp.path().join("AUDIO");
            let kit_dir = pool_dir.join("oldkit");
            std::fs::create_dir_all(&kit_dir).unwrap();
            let lone = pool_dir.join("stray.wav");
            touch(&lone);
            let dest = temp.path().join("dest");
            std::fs::create_dir(&dest).unwrap();

            let plan = vec![
                PurgeUnit::Directory {
                    path: kit_dir.to_string_lossy().to_string(),
                    origin: "Audio Pool".to_string(),
                    file_count: 50,
                    non_audio_count: 3,
                    size: 1,
                    files: vec![],
                },
                PurgeUnit::File {
                    path: lone.to_string_lossy().to_string(),
                    origin: "Audio Pool".to_string(),
                    size: 1,
                    slots: vec![],
                    sidecar: None,
                },
            ];
            let mut origin_roots = std::collections::HashMap::new();
            origin_roots.insert(
                "Audio Pool".to_string(),
                pool_dir.to_string_lossy().to_string(),
            );

            let result = if delete {
                trash_purge_units(&plan, &origin_roots, None).unwrap()
            } else {
                move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap()
            };

            assert_eq!(result.errors, Vec::<String>::new(), "delete={}", delete);
            assert_eq!(result.dirs_removed.len(), 1, "delete={}", delete);
            assert_eq!(result.files_removed.len(), 1, "delete={}", delete);
            // 50 inside the directory + the 1 standalone file
            assert_eq!(result.audio_files_removed, 51, "delete={}", delete);
            assert_eq!(result.non_audio_files_removed, 3, "delete={}", delete);
        }
    }

    /// Builds a plan of `n` lone files in `dir`, all named `f{i}.wav`.
    fn plan_of_files(dir: &std::path::Path, n: usize) -> Vec<PurgeUnit> {
        (0..n)
            .map(|i| {
                let p = dir.join(format!("f{}.wav", i));
                touch(&p);
                PurgeUnit::File {
                    path: p.to_string_lossy().to_string(),
                    origin: "Audio Pool".to_string(),
                    size: 1,
                    slots: vec![],
                    sidecar: None,
                }
            })
            .collect()
    }

    #[test]
    fn progress_reports_every_unit_in_order_with_its_index_and_total() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir_all(&pool_dir).unwrap();
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();
        let plan = plan_of_files(&pool_dir, 3);
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let seen = std::sync::Mutex::new(Vec::new());
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let on_unit = |path: &str, index: usize, total: usize| {
            seen.lock()
                .unwrap()
                .push((path.rsplit('/').next().unwrap().to_string(), index, total));
        };
        let progress = PurgeProgress {
            on_unit: &on_unit,
            cancel: &cancel,
        };

        let result = move_purge_units(
            &plan,
            &dest.to_string_lossy(),
            &origin_roots,
            Some(&progress),
        )
        .unwrap();

        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                ("f0.wav".to_string(), 0, 3),
                ("f1.wav".to_string(), 1, 3),
                ("f2.wav".to_string(), 2, 3),
            ]
        );
        assert!(!result.cancelled);
        assert_eq!(result.audio_files_removed, 3);
    }

    /// Cancellation must be honoured strictly between units: everything up
    /// to the cancel point is fully done, everything after is untouched.
    /// Nothing may be left half-moved.
    #[test]
    fn cancelling_partway_stops_cleanly_between_units_and_leaves_the_rest_in_place() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir_all(&pool_dir).unwrap();
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();
        let plan = plan_of_files(&pool_dir, 4);
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let cancel = std::sync::atomic::AtomicBool::new(false);
        // Trip the flag while unit index 1 is being reported - so units 0 and
        // 1 complete and the loop breaks before unit 2.
        let on_unit = |_p: &str, index: usize, _t: usize| {
            if index == 1 {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        };
        let progress = PurgeProgress {
            on_unit: &on_unit,
            cancel: &cancel,
        };

        let result = move_purge_units(
            &plan,
            &dest.to_string_lossy(),
            &origin_roots,
            Some(&progress),
        )
        .unwrap();

        assert!(result.cancelled);
        assert_eq!(result.audio_files_removed, 2);
        assert_eq!(result.errors, Vec::<String>::new());
        let moved = dest.join("Unused Audio").join("Audio Pool");
        assert!(moved.join("f0.wav").is_file());
        assert!(moved.join("f1.wav").is_file());
        // Untouched: still at their original location, not at the destination.
        assert!(!moved.join("f2.wav").exists());
        assert!(pool_dir.join("f2.wav").is_file());
        assert!(pool_dir.join("f3.wav").is_file());
    }

    #[test]
    fn a_cancel_already_set_before_the_first_unit_removes_nothing_at_all() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir_all(&pool_dir).unwrap();
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();
        let plan = plan_of_files(&pool_dir, 2);
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let cancel = std::sync::atomic::AtomicBool::new(true);
        let on_unit = |_p: &str, _i: usize, _t: usize| panic!("must not touch any unit");
        let progress = PurgeProgress {
            on_unit: &on_unit,
            cancel: &cancel,
        };

        let result = move_purge_units(
            &plan,
            &dest.to_string_lossy(),
            &origin_roots,
            Some(&progress),
        )
        .unwrap();

        assert!(result.cancelled);
        assert_eq!(result.audio_files_removed, 0);
        assert!(pool_dir.join("f0.wav").is_file());
        assert!(pool_dir.join("f1.wav").is_file());
    }

    #[test]
    fn move_purge_units_preserves_relative_subpaths_for_directory_units() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        let kit_dir = pool_dir.join("kits").join("808");
        std::fs::create_dir_all(&kit_dir).unwrap();
        touch(&kit_dir.join("kick.wav"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![PurgeUnit::Directory {
            path: kit_dir.to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            file_count: 1,
            non_audio_count: 0,
            size: 1,
            files: vec![PurgeFileEntry {
                path: kit_dir.join("kick.wav").to_string_lossy().to_string(),
                size: 1,
                slots: vec![],
                is_audio: true,
            }],
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        let expected = dest
            .join("Unused Audio")
            .join("Audio Pool")
            .join("kits")
            .join("808");
        assert!(expected.is_dir());
        assert!(expected.join("kick.wav").is_file());
    }

    #[test]
    fn move_purge_units_auto_suffixes_a_name_collision_instead_of_erroring() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        let dest = temp.path().join("dest");
        let existing = dest.join("Unused Audio").join("Audio Pool");
        std::fs::create_dir_all(&existing).unwrap();
        touch(&existing.join("kick.wav")); // pre-existing collision

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        assert!(result.errors.is_empty());
        assert!(existing.join("kick (2).wav").is_file());
        assert!(!pool_dir.join("kick.wav").exists());
    }

    #[test]
    fn end_to_end_project_purge_with_slot_clearing_and_move() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        write_full_project_with_sample_block(&project_dir, "STATIC", 1, "loaded.wav");
        touch(&project_dir.join("loaded.wav"));
        touch(&project_dir.join("orphan.wav")); // never referenced at all

        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        // 1. Scan with slot-clearing simulated on (matches the checkbox being checked).
        let plan =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, true).unwrap();
        assert_eq!(
            plan.len(),
            2,
            "both loaded.wav and orphan.wav should show as unused"
        );

        // 2. Move the reviewed plan.
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "PROJ".to_string(),
            project_dir.to_string_lossy().to_string(),
        );
        let mut result =
            move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();
        assert!(result.errors.is_empty());
        assert!(!project_dir.join("loaded.wav").exists());
        assert!(!project_dir.join("orphan.wav").exists());

        // 3. Clear the now-orphaned slot, same as purge_project_files does after moving.
        let cleared = clear_unused_slot_assignments(&project_dir.to_string_lossy()).unwrap();
        result.slots_cleared = cleared;
        assert_eq!(result.slots_cleared, 1);
        let content = std::fs::read_to_string(project_dir.join("project.work")).unwrap();
        assert!(
            !content.contains("PATH=loaded.wav"),
            "the [SAMPLE] block for the cleared slot should be gone: {content}"
        );
    }

    // -----------------------------------------------------------------
    // Finding 1: an empty/relative move destination must be rejected, not
    // silently resolved against the process's working directory.
    // -----------------------------------------------------------------

    #[test]
    fn move_purge_units_rejects_an_empty_destination() {
        let plan = vec![PurgeUnit::File {
            path: "/anything/kick.wav".to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let origin_roots = std::collections::HashMap::new();

        let result = move_purge_units(&plan, "", &origin_roots, None);
        assert!(result.is_err(), "an empty destination must be rejected");
    }

    #[test]
    fn move_purge_units_rejects_a_relative_destination() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, "Unused Audio", &origin_roots, None);
        assert!(
            result.is_err(),
            "a relative destination must be rejected, not resolved against the process cwd"
        );
        // The source file must be left untouched - nothing should have moved.
        assert!(pool_dir.join("kick.wav").exists());
    }

    // -----------------------------------------------------------------
    // Finding 2: a slot-clearing failure for one project must not discard
    // an already-successful delete/move result, and must not stop the
    // remaining projects in a multi-project (pool) purge from being tried.
    // -----------------------------------------------------------------

    #[test]
    fn clear_unused_slots_for_projects_records_a_failure_without_losing_prior_progress() {
        let temp = tempfile::TempDir::new().unwrap();

        // A real project with a slot eligible for clearing.
        let good_project = temp.path().join("GOOD");
        std::fs::create_dir(&good_project).unwrap();
        write_full_project_with_sample_block(&good_project, "STATIC", 1, "loaded.wav");
        touch(&good_project.join("loaded.wav"));

        // A path that isn't a real project at all - clear_unused_slot_assignments
        // will fail reading its raw sample fields.
        let bad_project = temp.path().join("DOES_NOT_EXIST");

        let mut result = PurgeResult {
            files_removed: vec!["/already/removed/orphan.wav".to_string()],
            bytes_reclaimed: 1234,
            ..PurgeResult::default()
        };

        clear_unused_slots_for_projects(
            &mut result,
            &[
                bad_project.to_string_lossy().to_string(),
                good_project.to_string_lossy().to_string(),
            ],
        );

        // The already-successful delete/move result must survive untouched.
        assert_eq!(result.files_removed, vec!["/already/removed/orphan.wav"]);
        assert_eq!(result.bytes_reclaimed, 1234);

        // The failure is surfaced as an error, not a panic/early-return.
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains(&bad_project.to_string_lossy().to_string()));

        // Crucially, the loop did NOT stop after the failing project - the
        // next (good) project was still attempted and its slot cleared.
        assert_eq!(result.slots_cleared, 1);
        assert_eq!(
            result.projects_updated,
            vec![good_project.to_string_lossy().to_string()]
        );
    }

    // -----------------------------------------------------------------
    // Finding 5: an individual PurgeUnit::File purge must sweep its .ot
    // sidecar along, without failing when there is no sidecar to sweep.
    // -----------------------------------------------------------------

    #[test]
    fn trash_purge_units_also_removes_the_ot_sidecar_of_an_individual_file() {
        let temp = tempfile::TempDir::new().unwrap();
        let wav_path = temp.path().join("kick.wav");
        let ot_path = temp.path().join("kick.ot");
        touch(&wav_path);
        touch(&ot_path);

        let plan = vec![PurgeUnit::File {
            path: wav_path.to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];

        let result = trash_purge_units(&plan, &std::collections::HashMap::new(), None).unwrap();

        assert!(!wav_path.exists());
        assert!(
            !ot_path.exists(),
            ".ot sidecar should be trashed alongside its audio file"
        );
        // Only the audio file itself is reported as an individual row - the
        // sidecar's bytes are folded into bytes_reclaimed instead.
        assert_eq!(
            result.files_removed,
            vec![wav_path.to_string_lossy().to_string()]
        );
        assert_eq!(
            result.bytes_reclaimed,
            1 /* wav size */ + 1 /* ot size */
        );
    }

    #[test]
    fn trash_purge_units_does_not_error_when_no_ot_sidecar_exists() {
        let temp = tempfile::TempDir::new().unwrap();
        let wav_path = temp.path().join("kick.wav");
        touch(&wav_path);

        let plan = vec![PurgeUnit::File {
            path: wav_path.to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];

        let result = trash_purge_units(&plan, &std::collections::HashMap::new(), None).unwrap();

        assert!(!wav_path.exists());
        assert!(result.errors.is_empty());
        assert_eq!(result.bytes_reclaimed, 1);
    }

    #[test]
    fn move_purge_units_also_moves_the_ot_sidecar_of_an_individual_file() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        touch(&pool_dir.join("kick.ot"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        assert!(result.errors.is_empty());
        let expected_wav = dest
            .join("Unused Audio")
            .join("Audio Pool")
            .join("kick.wav");
        let expected_ot = dest.join("Unused Audio").join("Audio Pool").join("kick.ot");
        assert!(expected_wav.is_file());
        assert!(
            expected_ot.is_file(),
            ".ot sidecar should move alongside its audio file"
        );
        assert!(!pool_dir.join("kick.wav").exists());
        assert!(!pool_dir.join("kick.ot").exists());
    }

    #[test]
    fn move_purge_units_does_not_error_when_no_ot_sidecar_exists() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        assert!(result.errors.is_empty());
        assert!(!pool_dir.join("kick.wav").exists());
    }

    // -----------------------------------------------------------------
    // A purged file's .ot sidecar is an invisible side effect (never shown
    // in the reviewed plan). When it lives inside a project, back it up
    // before removing it, same as clear_unused_slot_assignments already
    // does for project.work/.strd.
    // -----------------------------------------------------------------

    #[test]
    fn trash_purge_units_backs_up_a_project_files_ot_sidecar_before_trashing_it() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        touch(&project_dir.join("kick.wav"));
        touch(&project_dir.join("kick.ot"));

        let plan = vec![PurgeUnit::File {
            path: project_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "PROJ".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "PROJ".to_string(),
            project_dir.to_string_lossy().to_string(),
        );

        trash_purge_units(&plan, &origin_roots, None).unwrap();

        let backups_dir = project_dir.join("backups");
        assert!(
            backups_dir.is_dir(),
            "expected a backups/ dir to be created"
        );
        let backed_up = std::fs::read_dir(&backups_dir)
            .unwrap()
            .flatten()
            .any(|entry| entry.path().join("kick.ot").is_file());
        assert!(
            backed_up,
            "expected kick.ot to be copied into a backups/ subdirectory"
        );
    }

    #[test]
    fn trash_purge_units_does_not_back_up_an_audio_pool_files_ot_sidecar() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        touch(&pool_dir.join("kick.ot"));

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        trash_purge_units(&plan, &origin_roots, None).unwrap();

        assert!(
            !pool_dir.join("backups").exists(),
            "the Audio Pool has no project to back up into - no backups/ dir should appear there"
        );
    }

    #[test]
    fn trash_purge_units_does_not_double_handle_an_ot_sidecar_shared_by_two_purged_files() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        touch(&pool_dir.join("kick.flac"));
        touch(&pool_dir.join("kick.ot"));

        let plan = vec![
            PurgeUnit::File {
                path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
                origin: "Audio Pool".to_string(),
                size: 1,
                slots: vec![],
                sidecar: None,
            },
            PurgeUnit::File {
                path: pool_dir.join("kick.flac").to_string_lossy().to_string(),
                origin: "Audio Pool".to_string(),
                size: 1,
                slots: vec![],
                sidecar: None,
            },
        ];

        let result = trash_purge_units(&plan, &std::collections::HashMap::new(), None).unwrap();

        assert!(
            result.errors.is_empty(),
            "a shared .ot sidecar must not be queued twice for trashing: {:?}",
            result.errors
        );
        assert!(!pool_dir.join("kick.wav").exists());
        assert!(!pool_dir.join("kick.flac").exists());
        assert!(!pool_dir.join("kick.ot").exists());
        assert_eq!(
            result.bytes_reclaimed, 3,
            "kick.ot's size should only be counted once"
        );
    }

    #[test]
    fn trash_purge_units_leaves_a_shared_ot_sidecar_untouched_when_a_same_stem_sibling_survives() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav")); // unused - being purged
        touch(&pool_dir.join("kick.flac")); // still used - NOT in the plan
        touch(&pool_dir.join("kick.ot"));

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];

        let result = trash_purge_units(&plan, &std::collections::HashMap::new(), None).unwrap();

        assert!(result.errors.is_empty());
        assert!(!pool_dir.join("kick.wav").exists());
        assert!(
            pool_dir.join("kick.ot").exists(),
            "kick.flac still needs kick.ot - it must not be trashed"
        );
        assert_eq!(
            result.bytes_reclaimed, 1,
            "kick.ot's bytes must not be reclaimed since it wasn't touched"
        );
    }

    #[test]
    fn move_purge_units_leaves_a_shared_ot_sidecar_untouched_when_a_same_stem_sibling_survives() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav")); // unused - being moved
        touch(&pool_dir.join("kick.flac")); // still used - NOT in the plan
        touch(&pool_dir.join("kick.ot"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        assert!(result.errors.is_empty());
        assert!(!pool_dir.join("kick.wav").exists());
        assert!(
            pool_dir.join("kick.ot").exists(),
            "kick.flac still needs kick.ot - it must not be moved"
        );
        assert!(!dest
            .join("Unused Audio")
            .join("Audio Pool")
            .join("kick.ot")
            .exists());
        assert_eq!(
            result.bytes_reclaimed, 1,
            "kick.ot's bytes must not be reclaimed since it wasn't touched"
        );
    }

    #[test]
    fn move_purge_units_backs_up_a_project_files_ot_sidecar_before_moving_it() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        touch(&project_dir.join("kick.wav"));
        touch(&project_dir.join("kick.ot"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![PurgeUnit::File {
            path: project_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "PROJ".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "PROJ".to_string(),
            project_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        assert!(result.errors.is_empty());
        let backups_dir = project_dir.join("backups");
        assert!(
            backups_dir.is_dir(),
            "expected a backups/ dir to be created"
        );
        let backed_up = std::fs::read_dir(&backups_dir)
            .unwrap()
            .flatten()
            .any(|entry| entry.path().join("kick.ot").is_file());
        assert!(
            backed_up,
            "expected kick.ot to be copied into a backups/ subdirectory before being moved"
        );
    }

    #[test]
    fn move_purge_units_does_not_double_handle_an_ot_sidecar_shared_by_two_purged_files() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        touch(&pool_dir.join("kick.flac"));
        touch(&pool_dir.join("kick.ot"));
        let dest = temp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let plan = vec![
            PurgeUnit::File {
                path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
                origin: "Audio Pool".to_string(),
                size: 1,
                slots: vec![],
                sidecar: None,
            },
            PurgeUnit::File {
                path: pool_dir.join("kick.flac").to_string_lossy().to_string(),
                origin: "Audio Pool".to_string(),
                size: 1,
                slots: vec![],
                sidecar: None,
            },
        ];
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert(
            "Audio Pool".to_string(),
            pool_dir.to_string_lossy().to_string(),
        );

        let result = move_purge_units(&plan, &dest.to_string_lossy(), &origin_roots, None).unwrap();

        assert!(
            result.errors.is_empty(),
            "a shared .ot sidecar must not be moved/renamed twice: {:?}",
            result.errors
        );
        let moved_dir = dest.join("Unused Audio").join("Audio Pool");
        assert!(moved_dir.join("kick.wav").is_file());
        assert!(moved_dir.join("kick.flac").is_file());
        assert!(
            moved_dir.join("kick.ot").is_file(),
            "kick.ot should have moved exactly once"
        );
        assert_eq!(
            result.bytes_reclaimed, 3,
            "kick.ot's size should only be counted once"
        );
    }

    #[test]
    fn trash_purge_units_sweeps_the_ot_sidecar_even_when_a_non_audio_same_stem_file_survives() {
        let temp = tempfile::TempDir::new().unwrap();
        let pool_dir = temp.path().join("AUDIO");
        std::fs::create_dir(&pool_dir).unwrap();
        touch(&pool_dir.join("kick.wav"));
        touch(&pool_dir.join("kick.ot"));
        touch(&pool_dir.join("kick.txt")); // same stem, not audio - must not block the sweep

        let plan = vec![PurgeUnit::File {
            path: pool_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "Audio Pool".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];

        let result = trash_purge_units(&plan, &std::collections::HashMap::new(), None).unwrap();

        assert!(result.errors.is_empty());
        assert!(!pool_dir.join("kick.wav").exists());
        assert!(
            !pool_dir.join("kick.ot").exists(),
            "a non-audio same-stem file must not be treated as a surviving sibling"
        );
        assert!(
            pool_dir.join("kick.txt").exists(),
            "the non-audio file itself is untouched - it was never part of the plan"
        );
        assert_eq!(result.bytes_reclaimed, 2);
    }

    #[test]
    fn trash_purge_units_skips_the_ot_backup_but_still_removes_the_file_when_origin_root_is_unresolved(
    ) {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        touch(&project_dir.join("kick.wav"));
        touch(&project_dir.join("kick.ot"));

        let plan = vec![PurgeUnit::File {
            path: project_dir.join("kick.wav").to_string_lossy().to_string(),
            origin: "PROJ".to_string(),
            size: 1,
            slots: vec![],
            sidecar: None,
        }];
        // origin_roots deliberately does not contain "PROJ".
        let origin_roots = std::collections::HashMap::new();

        let result = trash_purge_units(&plan, &origin_roots, None).unwrap();

        assert!(
            result.errors.is_empty(),
            "an unresolved origin must not surface as an error - it's a best-effort backup"
        );
        assert!(!project_dir.join("kick.wav").exists());
        assert!(
            !project_dir.join("kick.ot").exists(),
            "the file and its sidecar should still be trashed even without a resolvable backup root"
        );
        assert!(
            !project_dir.join("backups").exists(),
            "no backup could be made without a resolvable origin root"
        );
    }

    // -----------------------------------------------------------------
    // Finding 6: preview (compute_project_unused_files) and execute
    // (clear_unused_slot_assignments / count_slots_eligible_for_clearing)
    // must agree on slot eligibility, including the None case (a slot id
    // outside 1..=128, or a slot TYPE other than STATIC/FLEX).
    // -----------------------------------------------------------------

    #[test]
    fn slot_has_real_usage_treats_a_missing_lookup_as_real_usage() {
        use crate::project_reader::SlotUsageEntry;

        assert!(
            slot_has_real_usage(None),
            "an unrecognized slot id/type must be treated conservatively as used"
        );
        assert!(!slot_has_real_usage(Some(&vec![])));

        let entries = vec![SlotUsageEntry {
            bank: 0,
            kind: "machine".to_string(),
            track: 0,
            part: Some(0),
            pattern: None,
            step: None,
            audible: true,
        }];
        assert!(slot_has_real_usage(Some(&entries)));
    }

    #[test]
    fn an_out_of_range_slot_id_is_treated_consistently_by_preview_and_clear() {
        let temp = tempfile::TempDir::new().unwrap();
        let project_dir = temp.path().join("PROJ");
        std::fs::create_dir(&project_dir).unwrap();
        // SLOT=200 is outside the valid 1..=128 range, so
        // usage.static_usage.get(199) is None - this is the "unreachable in
        // practice today" case Finding 6 flags as a latent inconsistency.
        write_minimal_project_with_sample_block(&project_dir, "STATIC", 200, "weird.wav");
        touch(&project_dir.join("weird.wav"));

        let plan =
            compute_project_unused_files(&project_dir.to_string_lossy(), true, true).unwrap();
        assert!(
            plan.is_empty(),
            "an out-of-range slot must not be treated as purgeable by the preview path"
        );

        let eligible = count_slots_eligible_for_clearing(&project_dir.to_string_lossy()).unwrap();
        assert_eq!(
            eligible, 0,
            "an out-of-range slot must not be treated as clearable either - the two paths must agree"
        );
    }
}
