//! Project management commands: create, copy, rename, move, delete, rescan.
//! See `docs/superpowers/specs/2026-04-25-project-management-design.md`.

use fs2::available_space;
use std::path::Path;
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
pub fn dir_size(path: &Path) -> std::io::Result<u64> {
    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Path does not exist: {}", path.display()),
        ));
    }
    let mut total: u64 = 0;
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata()?.len());
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("create tempdir")
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

    use std::fs;

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
        assert!(dir_size(Path::new("/no/such/path/here")).is_err());
    }
}
