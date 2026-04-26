//! Project management commands: create, copy, rename, move, delete, rescan.
//! See `docs/superpowers/specs/2026-04-25-project-management-design.md`.

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

/// Creates a new project under `set_path/name` with default ProjectFile + 16 BankFiles.
/// Returns the new project's absolute path.
#[tauri::command]
pub fn create_project(set_path: String, name: String) -> Result<String, String> {
    let set = Path::new(&set_path);
    if !set.is_dir() {
        return Err(format!("Set path does not exist: {}", set_path));
    }

    validate_project_name(&name)?;

    let project_path: PathBuf = set.join(&name);
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
        let path = create_project(
            set.path().to_string_lossy().into_owned(),
            "MYPROJ".to_string(),
        )
        .unwrap();
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
        let err = create_project(
            set.path().to_string_lossy().into_owned(),
            "BAD/NAME".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("cannot be used in a folder name"));
    }

    #[test]
    fn create_project_rejects_duplicate_name() {
        let set = tmp_dir();
        make_project(set.path(), "EXISTS");
        let err = create_project(
            set.path().to_string_lossy().into_owned(),
            "EXISTS".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn create_project_rejects_missing_set_path() {
        let err = create_project("/no/such/set/path".to_string(), "FOO".to_string()).unwrap_err();
        assert!(err.contains("Set path does not exist"), "unexpected: {err}");
    }
}
