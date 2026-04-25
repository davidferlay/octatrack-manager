//! Project management commands: create, copy, rename, move, delete, rescan.
//! See `docs/superpowers/specs/2026-04-25-project-management-design.md`.

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
