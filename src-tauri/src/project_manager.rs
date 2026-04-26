//! Project management commands: create, copy, rename, move, delete, rescan.
//! See `docs/superpowers/specs/2026-04-25-project-management-design.md`.

use crate::device_detection::{
    has_valid_audio_pool, is_octatrack_set, scan_for_projects, OctatrackSet,
};
use fs2::available_space;
use ot_tools_io::{BankFile, OctatrackFileIO, ProjectFile};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Characters allowed in Octatrack project names, transcribed from MKII hardware.
/// Source of truth: hardware screenshots captured during the 2026-04-25 brainstorm.
/// Before shipping any UI that consumes this constant, verify each row below
/// against the hardware. Adding or removing characters here changes the contract
/// honoured by every create/copy/rename flow.
pub const OT_CHARSET: &str = concat!(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß",
    "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
    "¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷",
);

/// Subset of `OT_CHARSET` that the host filesystem cannot accept in a folder name.
/// These chars get a more specific error so the user understands why an
/// otherwise-legal Octatrack character is rejected at the desktop layer.
const FS_FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Hardware-imposed maximum length of an Octatrack project folder name.
pub(crate) const MAX_NAME_LEN: usize = 12;

/// Validates a candidate Octatrack project folder name against the hardware
/// charset, the host filesystem's forbidden characters, and the 12-character
/// limit. Order matters: empty → length → fs-forbidden → not-in-charset.
/// The fs-forbidden check intentionally fires before the charset check so that
/// characters like `/` (which are in `OT_CHARSET` but illegal in folder names)
/// produce the more specific "cannot be used in a folder name" message.
pub fn validate_project_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name is required".to_string());
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!("Name must be {} characters or less", MAX_NAME_LEN));
    }
    for c in name.chars() {
        if FS_FORBIDDEN.contains(&c) {
            return Err(format!(
                "Character '{}' is allowed on Octatrack but cannot be used in a folder name",
                c
            ));
        }
        if !OT_CHARSET.contains(c) {
            return Err(format!("Character '{}' is not supported on Octatrack", c));
        }
    }
    Ok(())
}

/// Safety margin (1 MB) added to required size when checking free space, to avoid
/// races with other writers and small overhead from filesystem metadata.
const FREE_SPACE_MARGIN: u64 = 1024 * 1024;

/// Verifies that `path`'s filesystem has at least `required_bytes` (+ a 1 MB safety margin).
/// Returns a user-facing error message on failure.
pub fn check_free_space(path: &Path, required_bytes: u64) -> Result<(), String> {
    let available = available_space(path)
        .map_err(|e| format!("Could not check free space at {}: {}", path.display(), e))?;
    let needed = required_bytes.saturating_add(FREE_SPACE_MARGIN);
    if available < needed {
        return Err(format!(
            "Not enough free space: need {} MB, available {} MB",
            needed / (1024 * 1024),
            available / (1024 * 1024),
        ));
    }
    Ok(())
}

/// Returns the total size in bytes of all regular files under `path` (recursive).
///
/// Walk errors (permission denied, broken entry, loop) are propagated so that
/// callers — typically a pre-flight space check before a copy — never
/// under-report the directory's true size. The upfront existence check exists
/// only to produce a clean `NotFound` error; a TOCTOU between the check and
/// the walk surfaces as a walk error, not silent success.
pub fn dir_size(path: &Path) -> std::io::Result<u64> {
    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Path does not exist: {}", path.display()),
        ));
    }
    let mut total: u64 = 0;
    for entry in WalkDir::new(path) {
        let entry = entry.map_err(std::io::Error::from)?;
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata()?.len());
        }
    }
    Ok(total)
}

/// Generates a non-colliding copy name in `dest_set` based on `base`.
/// Format: `"{base}_{n}"` for n = 2, 3, 4, …
/// If `"{base}_{n}"` exceeds 12 chars, the base is truncated until it fits.
pub fn next_available_copy_name(base: &str, dest_set: &Path) -> Result<String, String> {
    if base.is_empty() {
        return Err("Cannot generate copy name from empty base".to_string());
    }
    // Cap counter at 999 to bound the search; in practice users will not have hundreds of copies.
    for n in 2u32..=999 {
        let suffix = format!("_{}", n);
        let suffix_len = suffix.chars().count();
        let max_base_len = MAX_NAME_LEN.saturating_sub(suffix_len);
        let truncated_base: String = base.chars().take(max_base_len).collect();
        if truncated_base.is_empty() {
            return Err("Suffix too long to fit in 12-char limit".to_string());
        }
        let candidate = format!("{}{}", truncated_base, suffix);
        if !dest_set.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find an available copy name (tried up to _999)".to_string())
}

/// Approximate size of a default empty project on disk.
/// Breakdown: project.work (~150 KB) + 16 × bank files (~150 KB each) ≈ 2.5 MB.
/// 4 MB gives ~60 % headroom for filesystem metadata and format evolution.
const DEFAULT_PROJECT_SIZE_BYTES: u64 = 4 * 1024 * 1024;

/// Synchronous core of [`create_project`]. Tests call this directly so they
/// can assert behaviour without an async runtime; the public [`create_project`]
/// command is a thin wrapper that runs this on the blocking thread pool.
pub(crate) fn create_project_sync(set: &Path, name: &str) -> Result<String, String> {
    if !set.is_dir() {
        return Err(format!("Set path does not exist: {}", set.display()));
    }

    validate_project_name(name)?;

    let project_path: PathBuf = set.join(name);
    if project_path.exists() {
        return Err(format!(
            "A project named '{}' already exists in this Set",
            name
        ));
    }

    check_free_space(set, DEFAULT_PROJECT_SIZE_BYTES)?;

    fs::create_dir(&project_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            // TOCTOU: another process created the directory between our exists()
            // check above and this mkdir. Surface the same user-facing message.
            format!("A project named '{}' already exists in this Set", name)
        } else {
            format!("Failed to create project directory: {}", e)
        }
    })?;

    let project_file = ProjectFile::default();
    project_file
        .to_data_file(&project_path.join("project.work"))
        .map_err(|e| {
            // Best-effort cleanup on partial failure.
            let _ = fs::remove_dir_all(&project_path);
            format!("Failed to write project.work: {}", e)
        })?;

    for i in 1u8..=16 {
        let bank = BankFile::default();
        let bank_path: PathBuf = project_path.join(format!("bank{:02}.work", i));
        bank.to_data_file(&bank_path).map_err(|e| {
            let _ = fs::remove_dir_all(&project_path);
            format!("Failed to write bank{:02}.work: {}", i, e)
        })?;
    }

    Ok(project_path.to_string_lossy().into_owned())
}

/// Creates a new project under `set_path/name` with default ProjectFile + 16 BankFiles.
/// Returns the new project's absolute path.
///
/// Runs on the blocking thread pool so the Tauri async runtime stays
/// responsive while the 17 file writes hit (potentially slow) SD media.
#[tauri::command]
pub async fn create_project(set_path: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || create_project_sync(Path::new(&set_path), &name))
        .await
        .map_err(|e| format!("Background task failed: {}", e))?
}

/// Maximum number of projects allowed in a single Octatrack Set.
const MAX_PROJECTS_PER_SET: usize = 128;

/// Counts project subdirectories in `set_path` (excluding `AUDIO`).
fn count_projects_in_set(set: &Path) -> usize {
    fs::read_dir(set)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let p = e.path();
                    p.is_dir() && p.file_name().and_then(|n| n.to_str()) != Some("AUDIO")
                })
                .count()
        })
        .unwrap_or(0)
}

/// Recursively copies `src` directory to `dest`. Stops on first error.
fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Synchronous core of [`copy_project`].
pub(crate) fn copy_project_sync(src: &Path, dest_set: &Path) -> Result<String, String> {
    if !src.is_dir() {
        return Err(format!("Source project does not exist: {}", src.display()));
    }
    if !dest_set.is_dir() {
        return Err(format!(
            "Destination Set does not exist: {}",
            dest_set.display()
        ));
    }

    if count_projects_in_set(dest_set) >= MAX_PROJECTS_PER_SET {
        return Err(format!(
            "Destination Set is at the {}-project limit",
            MAX_PROJECTS_PER_SET
        ));
    }

    let base = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Source path has no valid name".to_string())?;

    // Cross-set copy keeps the original name when free; same-set copy generates _N.
    let dest_name = if !dest_set.join(base).exists() {
        base.to_string()
    } else {
        next_available_copy_name(base, dest_set)?
    };
    let dest_path = dest_set.join(&dest_name);

    let size = dir_size(src).map_err(|e| format!("Could not measure source size: {}", e))?;
    check_free_space(dest_set, size)?;

    copy_dir_recursive(src, &dest_path).map_err(|e| {
        let _ = fs::remove_dir_all(&dest_path);
        format!("Copy failed: {}", e)
    })?;

    Ok(dest_path.to_string_lossy().into_owned())
}

/// Copies `src_path` into `dest_set_path` with an auto-generated `_N` suffix.
/// Runs on the blocking thread pool.
#[tauri::command]
pub async fn copy_project(src_path: String, dest_set_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_project_sync(Path::new(&src_path), Path::new(&dest_set_path))
    })
    .await
    .map_err(|e| format!("Background task failed: {}", e))?
}

/// Synchronous core of [`rename_project`].
pub(crate) fn rename_project_sync(src: &Path, new_name: &str) -> Result<String, String> {
    if !src.is_dir() {
        return Err(format!("Project does not exist: {}", src.display()));
    }

    validate_project_name(new_name)?;

    let current_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Project path has no valid name".to_string())?;

    if current_name == new_name {
        return Ok(src.to_string_lossy().into_owned());
    }

    let parent = src
        .parent()
        .ok_or_else(|| "Project has no parent directory".to_string())?;
    let dest = parent.join(new_name);
    if dest.exists() {
        return Err(format!(
            "A project named '{}' already exists in this Set",
            new_name
        ));
    }

    fs::rename(src, &dest).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Renames an existing project directory in place (same parent Set).
/// Runs on the blocking thread pool.
#[tauri::command]
pub async fn rename_project(project_path: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_project_sync(Path::new(&project_path), &new_name)
    })
    .await
    .map_err(|e| format!("Background task failed: {}", e))?
}

/// Synchronous core of [`move_project`].
/// Same filesystem → atomic `fs::rename`. Cross-filesystem → copy → verify → delete (Task 10).
pub(crate) fn move_project_sync(src: &Path, dest_set: &Path) -> Result<String, String> {
    if !src.is_dir() {
        return Err(format!("Source project does not exist: {}", src.display()));
    }
    if !dest_set.is_dir() {
        return Err(format!(
            "Destination Set does not exist: {}",
            dest_set.display()
        ));
    }

    if count_projects_in_set(dest_set) >= MAX_PROJECTS_PER_SET {
        return Err(format!(
            "Destination Set is at the {}-project limit",
            MAX_PROJECTS_PER_SET
        ));
    }

    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Source path has no valid name".to_string())?
        .to_string();
    let dest_path = dest_set.join(&name);
    if dest_path.exists() {
        return Err(format!(
            "A project named '{}' already exists in this Set",
            name
        ));
    }

    // Try atomic rename first (works iff same filesystem).
    match fs::rename(src, &dest_path) {
        Ok(()) => Ok(dest_path.to_string_lossy().into_owned()),
        Err(e) if e.raw_os_error() == Some(libc_ex_dev()) => {
            // Cross-device: handled in Task 10 (currently a stub).
            move_project_cross_fs(src, &dest_path)
        }
        Err(e) => Err(format!("Move failed: {}", e)),
    }
}

/// Returns the platform-specific errno for cross-device rename failures.
/// Linux/macOS: EXDEV (18). Windows: ERROR_NOT_SAME_DEVICE (17).
#[cfg(unix)]
fn libc_ex_dev() -> i32 {
    18 // EXDEV
}
#[cfg(windows)]
fn libc_ex_dev() -> i32 {
    17 // ERROR_NOT_SAME_DEVICE
}

/// Cross-filesystem move: delegates to the inner implementation.
fn move_project_cross_fs(src: &Path, dest: &Path) -> Result<String, String> {
    move_project_cross_fs_impl(src, dest)
}

/// Cross-filesystem move: pre-flight space check → recursive copy → verify file count
/// and total size match → only then delete source. On any failure, leaves source intact
/// and removes the partial destination.
fn move_project_cross_fs_impl(src: &Path, dest: &Path) -> Result<String, String> {
    if dest.exists() {
        return Err(format!("Destination already exists: {}", dest.display()));
    }

    let dest_parent = dest
        .parent()
        .ok_or_else(|| "Destination has no parent".to_string())?;

    let size = dir_size(src).map_err(|e| format!("Could not measure source size: {}", e))?;
    check_free_space(dest_parent, size)?;

    let (src_count, src_size) =
        walk_count_size(src).map_err(|e| format!("Could not enumerate source: {}", e))?;

    if let Err(e) = copy_dir_recursive(src, dest) {
        let _ = fs::remove_dir_all(dest);
        return Err(format!("Copy failed: {}", e));
    }

    let (dst_count, dst_size) = match walk_count_size(dest) {
        Ok(x) => x,
        Err(e) => {
            let _ = fs::remove_dir_all(dest);
            return Err(format!("Could not verify destination: {}", e));
        }
    };

    if src_count != dst_count || src_size != dst_size {
        let _ = fs::remove_dir_all(dest);
        return Err(format!(
            "Verification failed: src={}/{} bytes, dst={}/{} bytes",
            src_count, src_size, dst_count, dst_size
        ));
    }

    fs::remove_dir_all(src)
        .map_err(|e| format!("Copy succeeded but source could not be deleted: {}", e))?;

    Ok(dest.to_string_lossy().into_owned())
}

fn walk_count_size(p: &Path) -> std::io::Result<(usize, u64)> {
    let mut count = 0usize;
    let mut size = 0u64;
    for entry in WalkDir::new(p) {
        let entry = entry.map_err(std::io::Error::from)?;
        if entry.file_type().is_file() {
            count += 1;
            size = size.saturating_add(entry.metadata()?.len());
        }
    }
    Ok((count, size))
}

/// Moves a project directory into a different Set.
/// Runs on the blocking thread pool.
#[tauri::command]
pub async fn move_project(src_path: String, dest_set_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_project_sync(Path::new(&src_path), Path::new(&dest_set_path))
    })
    .await
    .map_err(|e| format!("Background task failed: {}", e))?
}

/// Returns true if `path` looks like an OT project (contains a `.work` file).
fn is_project_dir(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|e| e == "work") {
                return true;
            }
        }
    }
    false
}

/// Synchronous core of [`delete_project`]. Refuses anything that doesn't look
/// like an OT project (contains no `.work` file) to avoid catastrophic mistakes.
pub(crate) fn delete_project_sync(p: &Path) -> Result<(), String> {
    if !p.exists() {
        return Err(format!("Project does not exist: {}", p.display()));
    }
    if !is_project_dir(p) {
        return Err(format!(
            "Refusing to delete: '{}' is not an Octatrack project directory",
            p.display()
        ));
    }
    fs::remove_dir_all(p).map_err(|e| format!("Delete failed: {}", e))
}

/// Recursively deletes a project directory.
/// Runs on the blocking thread pool.
#[tauri::command]
pub async fn delete_project(project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_project_sync(Path::new(&project_path)))
        .await
        .map_err(|e| format!("Background task failed: {}", e))?
}

// ── rescan_set ──────────────────────────────────────────────────────────

/// Re-scans an Octatrack Set directory and returns its current state.
///
/// Validates that `path` is a valid Octatrack Set, then rebuilds the
/// [`OctatrackSet`] struct with fresh project and audio-pool information.
pub(crate) fn rescan_set_sync(path: &Path) -> Result<OctatrackSet, String> {
    if !is_octatrack_set(path) {
        return Err(format!(
            "Path is not a valid Octatrack Set: {}",
            path.display()
        ));
    }
    let audio_pool_path = path.join("AUDIO");
    let has_audio_pool = audio_pool_path.is_dir() && has_valid_audio_pool(&audio_pool_path);
    let projects = scan_for_projects(path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    Ok(OctatrackSet {
        name,
        path: path.to_string_lossy().into_owned(),
        has_audio_pool,
        projects,
    })
}

#[tauri::command]
pub async fn rescan_set(set_path: String) -> Result<OctatrackSet, String> {
    tauri::async_runtime::spawn_blocking(move || rescan_set_sync(Path::new(&set_path)))
        .await
        .map_err(|e| format!("Background task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_tools_io::{BankFile, OctatrackFileIO, ProjectFile};
    use std::fs;
    use std::path::PathBuf;

    fn tmp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("create tempdir")
    }

    fn make_project(set: &Path, name: &str) {
        let p = set.join(name);
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("project.work"), b"x").unwrap();
    }

    fn populate_project(p: &Path) {
        fs::create_dir_all(p).unwrap();
        fs::write(p.join("project.work"), vec![0u8; 1024]).unwrap();
        for i in 1..=16 {
            fs::write(p.join(format!("bank{:02}.work", i)), vec![i as u8; 100]).unwrap();
        }
    }

    #[test]
    fn copy_project_creates_independent_copy() {
        let set = tmp_dir();
        let src = set.path().join("ORIG");
        populate_project(&src);

        let new_path = copy_project_sync(&src, set.path()).unwrap();

        let new = Path::new(&new_path);
        assert_eq!(new.file_name().unwrap().to_string_lossy(), "ORIG_2");
        assert!(new.join("project.work").is_file());
        assert_eq!(
            fs::read(src.join("project.work")).unwrap(),
            fs::read(new.join("project.work")).unwrap(),
        );
    }

    #[test]
    fn copy_project_advances_suffix() {
        let set = tmp_dir();
        populate_project(&set.path().join("ORIG"));
        populate_project(&set.path().join("ORIG_2"));
        let new_path = copy_project_sync(&set.path().join("ORIG"), set.path()).unwrap();
        assert!(new_path.ends_with("ORIG_3"));
    }

    #[test]
    fn copy_project_works_cross_set() {
        let src_set = tmp_dir();
        let dst_set = tmp_dir();
        populate_project(&src_set.path().join("ORIG"));
        let new_path = copy_project_sync(&src_set.path().join("ORIG"), dst_set.path()).unwrap();
        assert!(new_path.ends_with("ORIG"));
        assert!(Path::new(&new_path).join("project.work").is_file());
    }

    #[test]
    fn copy_project_fails_at_128_project_limit() {
        let set = tmp_dir();
        for i in 0..128 {
            populate_project(&set.path().join(format!("P{:03}", i)));
        }
        let src = set.path().join("P000");
        let err = copy_project_sync(&src, set.path()).unwrap_err();
        assert!(err.contains("128"), "expected limit error, got: {}", err);
    }

    #[test]
    fn copy_name_first_unused_is_underscore_2() {
        let set = tmp_dir();
        make_project(set.path(), "FOO");
        let name = next_available_copy_name("FOO", set.path()).unwrap();
        assert_eq!(name, "FOO_2");
    }

    #[test]
    fn copy_name_advances_to_3_when_2_taken() {
        let set = tmp_dir();
        make_project(set.path(), "FOO");
        make_project(set.path(), "FOO_2");
        let name = next_available_copy_name("FOO", set.path()).unwrap();
        assert_eq!(name, "FOO_3");
    }

    #[test]
    fn copy_name_skips_to_first_available() {
        let set = tmp_dir();
        make_project(set.path(), "FOO");
        make_project(set.path(), "FOO_2");
        make_project(set.path(), "FOO_4");
        let name = next_available_copy_name("FOO", set.path()).unwrap();
        assert_eq!(name, "FOO_3");
    }

    #[test]
    fn copy_name_truncates_when_base_plus_suffix_exceeds_12() {
        let set = tmp_dir();
        // base="LONG_PROJECT" (12) + "_2" (2) = 14 → truncate base to 10 → "LONG_PROJE_2" (12)
        let name = next_available_copy_name("LONG_PROJECT", set.path()).unwrap();
        assert_eq!(name, "LONG_PROJE_2");
        assert!(name.chars().count() <= 12);
    }

    #[test]
    fn copy_name_truncates_for_multidigit_suffix() {
        let set = tmp_dir();
        // Pre-fill _2..=_9 so we land on _10.
        for i in 2..=9 {
            make_project(set.path(), &format!("MY_PROJECTS_{}", i));
        }
        let name = next_available_copy_name("MY_PROJECTS", set.path()).unwrap();
        assert!(name.chars().count() <= 12);
        assert!(!set.path().join(&name).exists());
        assert!(name.starts_with("MY_PROJ"));
    }

    #[test]
    fn copy_name_keeps_full_base_when_it_fits() {
        let set = tmp_dir();
        // base="MY_PROJECT" (10) + "_2" (2) = 12 → exact fit, no truncation
        let name = next_available_copy_name("MY_PROJECT", set.path()).unwrap();
        assert_eq!(name, "MY_PROJECT_2");
    }

    #[test]
    fn check_free_space_passes_when_required_is_zero() {
        let dir = tmp_dir();
        assert!(check_free_space(dir.path(), 0).is_ok());
    }

    #[test]
    fn check_free_space_passes_when_required_is_small() {
        let dir = tmp_dir();
        assert!(check_free_space(dir.path(), 1024).is_ok());
    }

    #[test]
    fn check_free_space_fails_when_required_exceeds_available() {
        let dir = tmp_dir();
        let err = check_free_space(dir.path(), u64::MAX).unwrap_err();
        assert!(err.contains("Not enough free space"));
        assert!(err.contains("need"));
        assert!(err.contains("available"));
    }

    #[test]
    #[cfg(unix)]
    fn check_free_space_returns_error_for_missing_path() {
        // On Unix, statvfs(2) returns ENOENT for missing paths.
        // On Windows, GetVolumePathNameW walks toward the root for a missing
        // leaf, so the call succeeds against the volume. Callers are expected
        // to pass extant paths anyway, so the missing-path branch is only
        // observable (and testable) on Unix.
        let bogus = PathBuf::from("/this/path/does/not/exist/anywhere");
        assert!(check_free_space(&bogus, 0).is_err());
    }

    #[test]
    fn accepts_simple_ascii() {
        assert_eq!(validate_project_name("PROJECT01"), Ok(()));
    }

    #[test]
    fn accepts_lowercase() {
        assert_eq!(validate_project_name("my_song"), Ok(()));
    }

    #[test]
    fn accepts_max_length() {
        assert_eq!(validate_project_name("ABCDEFGHIJKL"), Ok(()));
    }

    #[test]
    fn accepts_accented_chars() {
        // É, t, é — all in the OT charset
        assert_eq!(validate_project_name("Été"), Ok(()));
    }

    #[test]
    fn accepts_punctuation_in_charset() {
        assert_eq!(validate_project_name("A&B (mix)"), Ok(()));
    }

    #[test]
    fn rejects_empty() {
        let err = validate_project_name("").unwrap_err();
        assert_eq!(err, "Name is required");
    }

    #[test]
    fn rejects_too_long() {
        // 13 ASCII characters
        let err = validate_project_name("ABCDEFGHIJKLM").unwrap_err();
        assert!(err.contains("12 characters or less"), "unexpected: {err}");
    }

    #[test]
    fn rejects_too_long_unicode() {
        // 13 accented characters — byte length != char count
        let name: String = "é".repeat(13);
        assert_eq!(name.chars().count(), 13);
        let err = validate_project_name(&name).unwrap_err();
        assert!(err.contains("12 characters or less"), "unexpected: {err}");
    }

    #[test]
    fn rejects_fs_forbidden_slash() {
        let err = validate_project_name("a/b").unwrap_err();
        assert!(
            err.contains("cannot be used in a folder name"),
            "unexpected: {err}"
        );
        assert!(err.contains('/'), "missing char in error: {err}");
    }

    #[test]
    fn rejects_fs_forbidden_backslash() {
        let err = validate_project_name("a\\b").unwrap_err();
        assert!(
            err.contains("cannot be used in a folder name"),
            "unexpected: {err}"
        );
        assert!(err.contains('\\'), "missing char in error: {err}");
    }

    #[test]
    fn rejects_non_ot_char_emoji() {
        let err = validate_project_name("hi😀").unwrap_err();
        assert!(
            err.contains("not supported on Octatrack"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn rejects_non_ot_char_cjk() {
        let err = validate_project_name("日本").unwrap_err();
        assert!(
            err.contains("not supported on Octatrack"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn fs_forbidden_check_runs_before_charset_check() {
        // `/` is in OT_CHARSET (line " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~") but
        // also in FS_FORBIDDEN. The fs-forbidden message must win.
        assert!(OT_CHARSET.contains('/'));
        let err = validate_project_name("a/b").unwrap_err();
        assert!(
            err.contains("cannot be used in a folder name"),
            "expected fs-forbidden message, got: {err}"
        );
        assert!(
            !err.contains("not supported on Octatrack"),
            "got charset message instead of fs-forbidden: {err}"
        );
    }

    #[test]
    fn dir_size_empty_dir_is_zero() {
        let dir = tmp_dir();
        assert_eq!(dir_size(dir.path()).unwrap(), 0);
    }

    #[test]
    fn dir_size_sums_files_at_root() {
        let dir = tmp_dir();
        fs::write(dir.path().join("a.bin"), vec![0u8; 100]).unwrap();
        fs::write(dir.path().join("b.bin"), vec![0u8; 250]).unwrap();
        assert_eq!(dir_size(dir.path()).unwrap(), 350);
    }

    #[test]
    fn dir_size_recurses_into_subdirs() {
        let dir = tmp_dir();
        fs::write(dir.path().join("a.bin"), vec![0u8; 100]).unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("b.bin"), vec![0u8; 50]).unwrap();
        let subsub = sub.join("deeper");
        fs::create_dir(&subsub).unwrap();
        fs::write(subsub.join("c.bin"), vec![0u8; 25]).unwrap();
        assert_eq!(dir_size(dir.path()).unwrap(), 175);
    }

    #[test]
    fn dir_size_errors_on_missing_path() {
        let err = dir_size(Path::new("/no/such/path/here")).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn create_project_creates_dir_and_files() {
        let set = tmp_dir();
        let path = create_project_sync(set.path(), "MYPROJ").unwrap();
        let p = Path::new(&path);
        assert!(p.is_dir());
        assert!(p.join("project.work").is_file());
        for i in 1..=16 {
            assert!(
                p.join(format!("bank{:02}.work", i)).is_file(),
                "bank{:02}.work missing",
                i
            );
        }
        // Can read back the default project / banks.
        ProjectFile::from_data_file(&p.join("project.work")).unwrap();
        BankFile::from_data_file(&p.join("bank01.work")).unwrap();
    }

    #[test]
    fn create_project_rejects_invalid_name() {
        let set = tmp_dir();
        let err = create_project_sync(set.path(), "BAD/NAME").unwrap_err();
        assert!(err.contains("cannot be used in a folder name"));
    }

    #[test]
    fn create_project_rejects_duplicate_name() {
        let set = tmp_dir();
        make_project(set.path(), "EXISTS");
        let err = create_project_sync(set.path(), "EXISTS").unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn create_project_rejects_missing_set_path() {
        let err = create_project_sync(Path::new("/no/such/set/path"), "FOO").unwrap_err();
        assert!(err.contains("Set path does not exist"), "unexpected: {err}");
    }

    #[test]
    fn rename_project_changes_dir_name() {
        let set = tmp_dir();
        populate_project(&set.path().join("OLD"));
        let new_path = rename_project_sync(&set.path().join("OLD"), "NEW").unwrap();
        assert!(new_path.ends_with("NEW"));
        assert!(!set.path().join("OLD").exists());
        assert!(set.path().join("NEW").join("project.work").is_file());
    }

    #[test]
    fn rename_project_rejects_invalid_name() {
        let set = tmp_dir();
        populate_project(&set.path().join("OLD"));
        let err = rename_project_sync(&set.path().join("OLD"), "BAD/NAME").unwrap_err();
        assert!(err.contains("cannot be used in a folder name"));
    }

    #[test]
    fn rename_project_rejects_conflict() {
        let set = tmp_dir();
        populate_project(&set.path().join("OLD"));
        populate_project(&set.path().join("EXISTS"));
        let err = rename_project_sync(&set.path().join("OLD"), "EXISTS").unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn rename_project_same_name_is_noop() {
        let set = tmp_dir();
        populate_project(&set.path().join("SAME"));
        let path = set.path().join("SAME");
        let new_path = rename_project_sync(&path, "SAME").unwrap();
        assert_eq!(new_path, path.to_string_lossy());
    }

    #[test]
    fn move_project_same_fs_renames_atomically() {
        let root = tmp_dir();
        let src_set = root.path().join("SetA");
        let dst_set = root.path().join("SetB");
        fs::create_dir_all(&src_set).unwrap();
        fs::create_dir_all(&dst_set).unwrap();
        populate_project(&src_set.join("PROJ"));

        let new_path = move_project_sync(&src_set.join("PROJ"), &dst_set).unwrap();

        assert_eq!(new_path, dst_set.join("PROJ").to_string_lossy());
        assert!(!src_set.join("PROJ").exists());
        assert!(dst_set.join("PROJ").join("project.work").is_file());
    }

    #[test]
    fn move_project_rejects_name_conflict() {
        let root = tmp_dir();
        let src_set = root.path().join("SetA");
        let dst_set = root.path().join("SetB");
        fs::create_dir_all(&src_set).unwrap();
        fs::create_dir_all(&dst_set).unwrap();
        populate_project(&src_set.join("PROJ"));
        populate_project(&dst_set.join("PROJ"));

        let err = move_project_sync(&src_set.join("PROJ"), &dst_set).unwrap_err();
        assert!(err.contains("already exists"));
        // Source must remain.
        assert!(src_set.join("PROJ").join("project.work").is_file());
    }

    #[test]
    fn move_project_rejects_at_128_limit() {
        let root = tmp_dir();
        let src_set = root.path().join("SetA");
        let dst_set = root.path().join("SetB");
        fs::create_dir_all(&src_set).unwrap();
        fs::create_dir_all(&dst_set).unwrap();
        populate_project(&src_set.join("PROJ"));
        for i in 0..128 {
            populate_project(&dst_set.join(format!("P{:03}", i)));
        }
        let err = move_project_sync(&src_set.join("PROJ"), &dst_set).unwrap_err();
        assert!(err.contains("128"));
        assert!(src_set.join("PROJ").exists());
    }

    /// Helper: count files recursively, return (count, total_size).
    fn file_count_and_size(p: &Path) -> (usize, u64) {
        let mut count = 0;
        let mut size = 0u64;
        for entry in WalkDir::new(p) {
            let entry = entry.unwrap();
            if entry.file_type().is_file() {
                count += 1;
                size += entry.metadata().unwrap().len();
            }
        }
        (count, size)
    }

    #[test]
    fn move_cross_fs_helper_copies_verifies_deletes() {
        // We can't easily simulate a real cross-fs move, but we can call the inner
        // helper directly with two distinct directories.
        let root = tmp_dir();
        let src = root.path().join("SRC");
        let dest = root.path().join("DST");
        populate_project(&src);
        let (src_count, src_size) = file_count_and_size(&src);

        let result = move_project_cross_fs_impl(&src, &dest).unwrap();
        assert_eq!(result, dest.to_string_lossy());
        assert!(
            !src.exists(),
            "source should be deleted after successful copy+verify"
        );
        let (dst_count, dst_size) = file_count_and_size(&dest);
        assert_eq!(src_count, dst_count);
        assert_eq!(src_size, dst_size);
    }

    #[test]
    fn move_cross_fs_helper_leaves_source_when_dest_pre_exists() {
        let root = tmp_dir();
        let src = root.path().join("SRC");
        let dest = root.path().join("DST");
        populate_project(&src);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("intruder.txt"), b"x").unwrap();

        let err = move_project_cross_fs_impl(&src, &dest).unwrap_err();
        assert!(!err.is_empty());
        // Source intact.
        assert!(src.join("project.work").is_file());
        // Untouched intruder still there.
        assert!(dest.join("intruder.txt").is_file());
    }

    #[test]
    fn delete_project_removes_directory() {
        let set = tmp_dir();
        populate_project(&set.path().join("DOOMED"));
        delete_project_sync(&set.path().join("DOOMED")).unwrap();
        assert!(!set.path().join("DOOMED").exists());
    }

    #[test]
    fn delete_project_refuses_non_project_dir() {
        let set = tmp_dir();
        let bogus = set.path().join("not_a_project");
        fs::create_dir(&bogus).unwrap();
        // No .work files inside.
        let err = delete_project_sync(&bogus).unwrap_err();
        assert!(err.to_lowercase().contains("not") && err.to_lowercase().contains("project"));
        assert!(bogus.exists(), "non-project directory must not be deleted");
    }

    #[test]
    fn delete_project_errors_on_missing_path() {
        let err = delete_project_sync(Path::new("/no/such/path")).unwrap_err();
        assert!(err.contains("does not exist"), "unexpected: {err}");
    }

    // ── rescan_set tests ────────────────────────────────────────────────

    /// Helper: create a minimal valid Octatrack Set directory structure.
    fn make_set(root: &Path) -> PathBuf {
        // A valid set needs an AUDIO dir + at least one project dir with a .work file
        fs::create_dir_all(root.join("AUDIO")).unwrap();
        let proj = root.join("PROJ_A");
        fs::create_dir_all(&proj).unwrap();
        let pf = ProjectFile::default();
        OctatrackFileIO::to_data_file(&pf, &proj.join("project.work")).unwrap();
        root.to_path_buf()
    }

    #[test]
    fn rescan_set_returns_current_projects() {
        let set = tmp_dir();
        make_set(set.path());
        let result = rescan_set_sync(set.path()).unwrap();
        assert_eq!(result.projects.len(), 1);
        assert_eq!(result.projects[0].name, "PROJ_A");
    }

    #[test]
    fn rescan_set_reflects_deletions() {
        let set = tmp_dir();
        make_set(set.path());
        // Add a second project, scan, then delete it, rescan
        let proj_b = set.path().join("PROJ_B");
        fs::create_dir_all(&proj_b).unwrap();
        let pf = ProjectFile::default();
        OctatrackFileIO::to_data_file(&pf, &proj_b.join("project.work")).unwrap();
        let r1 = rescan_set_sync(set.path()).unwrap();
        assert_eq!(r1.projects.len(), 2);
        fs::remove_dir_all(&proj_b).unwrap();
        let r2 = rescan_set_sync(set.path()).unwrap();
        assert_eq!(r2.projects.len(), 1);
    }

    #[test]
    fn rescan_set_errors_on_non_set_dir() {
        let dir = tmp_dir();
        // Empty dir is not a valid set
        let err = rescan_set_sync(dir.path()).unwrap_err();
        assert!(
            err.contains("not a valid Octatrack Set"),
            "unexpected: {err}"
        );
    }
}
