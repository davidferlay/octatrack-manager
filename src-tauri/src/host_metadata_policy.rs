//! Shared host OS metadata policy for clone integrity and registered-root scans.
//!
//! Only this explicit allowlist is ignored. Unknown unreadable paths stay
//! fail-closed. Unknown dot-prefixed names are not ignored because they are hidden.

use std::path::Path;

/// Host OS metadata excluded from Octatrack semantic filesystem walks.
/// Only explicit names are omitted; unknown unreadable paths remain fail-closed.
pub(crate) fn is_ignored_host_metadata(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    matches!(
        name,
        ".Spotlight-V100" | ".Trashes" | ".fseventsd" | ".DS_Store"
    ) || name.starts_with("._")
}

#[cfg(test)]
mod tests {
    use super::is_ignored_host_metadata;
    use std::path::Path;

    #[test]
    fn allowlist_matches_known_macos_metadata_only() {
        assert!(is_ignored_host_metadata(Path::new(".Spotlight-V100")));
        assert!(is_ignored_host_metadata(Path::new(".Trashes")));
        assert!(is_ignored_host_metadata(Path::new(".fseventsd")));
        assert!(is_ignored_host_metadata(Path::new(".DS_Store")));
        assert!(is_ignored_host_metadata(Path::new("._test.wav")));

        assert!(!is_ignored_host_metadata(Path::new("unexpected.bin")));
        assert!(!is_ignored_host_metadata(Path::new(".hidden")));
        assert!(!is_ignored_host_metadata(Path::new(".not-macos-metadata")));
        assert!(!is_ignored_host_metadata(Path::new("extra")));
        assert!(!is_ignored_host_metadata(Path::new("Set")));
        assert!(!is_ignored_host_metadata(Path::new(".random-dir")));
        assert!(!is_ignored_host_metadata(Path::new(".custom")));
    }
}
