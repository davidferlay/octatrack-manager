use crate::device_detection::{scan_directory, OctatrackProject};
use ot_domain::{LibraryProject, LibrarySet, LibrarySnapshot, RootId, RootRelativePath};
use ot_storage_ports::{ReadOnlyLibrary, StorageError};
use std::collections::HashSet;
#[cfg(test)]
use std::fs;
use std::path::{Component, Path, PathBuf};

pub struct RegisteredLegacyLibrary {
    root_id: RootId,
    canonical_root: PathBuf,
}

impl RegisteredLegacyLibrary {
    pub fn new(root_id: RootId, canonical_root: PathBuf) -> Self {
        Self {
            root_id,
            canonical_root,
        }
    }
}

impl ReadOnlyLibrary for RegisteredLegacyLibrary {
    fn list_library(&self, root_id: &RootId) -> Result<LibrarySnapshot, StorageError> {
        if root_id != &self.root_id {
            return Err(StorageError::new("ROOT_NOT_APPROVED: root id mismatch"));
        }
        scan_registered_root(&self.canonical_root)
    }
}

fn scan_registered_root(canonical_root: &Path) -> Result<LibrarySnapshot, StorageError> {
    let root = canonical_root
        .to_str()
        .ok_or_else(|| StorageError::new("UNSUPPORTED_FORMAT: root path is not valid UTF-8"))?;
    let legacy = scan_directory(root);
    let mut seen_sets = HashSet::new();
    let mut sets = Vec::new();

    for location in legacy.locations {
        for legacy_set in location.sets {
            let relative_path = checked_relative_path(canonical_root, Path::new(&legacy_set.path))?;
            if !seen_sets.insert(relative_path.as_str().to_owned()) {
                continue;
            }
            let mut projects = legacy_set
                .projects
                .into_iter()
                .map(|project| map_project(canonical_root, project))
                .collect::<Result<Vec<_>, _>>()?;
            projects.sort_by(|left, right| {
                left.relative_path
                    .as_str()
                    .cmp(right.relative_path.as_str())
            });
            sets.push(LibrarySet {
                display_name: legacy_set.name,
                relative_path,
                has_audio_pool: legacy_set.has_audio_pool,
                projects,
            });
        }
    }
    sets.sort_by(|left, right| left.relative_path.as_str().cmp(right.relative_path.as_str()));

    let mut seen_projects = HashSet::new();
    let mut standalone_projects = Vec::new();
    for project in legacy.standalone_projects {
        let project = map_project(canonical_root, project)?;
        if seen_projects.insert(project.relative_path.as_str().to_owned()) {
            standalone_projects.push(project);
        }
    }
    standalone_projects
        .sort_by(|left, right| left.relative_path.as_str().cmp(right.relative_path.as_str()));

    Ok(LibrarySnapshot {
        sets,
        standalone_projects,
    })
}

fn map_project(
    canonical_root: &Path,
    project: OctatrackProject,
) -> Result<LibraryProject, StorageError> {
    Ok(LibraryProject {
        display_name: project.name,
        relative_path: checked_relative_path(canonical_root, Path::new(&project.path))?,
        has_project_file: project.has_project_file,
        has_banks: project.has_banks,
    })
}

fn checked_relative_path(root: &Path, candidate: &Path) -> Result<RootRelativePath, StorageError> {
    let canonical = candidate
        .canonicalize()
        .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
    let relative = canonical
        .strip_prefix(root)
        .map_err(|_| StorageError::new("PATH_ESCAPE: scanned path left its registered root"))?;
    relative_path_from_path(relative)
}

fn relative_path_from_path(path: &Path) -> Result<RootRelativePath, StorageError> {
    let components = path
        .components()
        .map(|component| match component {
            Component::Normal(component) => component
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| StorageError::new("UNSUPPORTED_FORMAT: path is not valid UTF-8")),
            _ => Err(StorageError::new(
                "PATH_ESCAPE: path contains a non-relative component",
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    RootRelativePath::from_components(components)
        .map_err(|error| StorageError::new(format!("PATH_ESCAPE: {error}")))
}

#[cfg(test)]
pub(crate) fn resolve_relative_for_read(
    root: &Path,
    relative: &RootRelativePath,
) -> Result<PathBuf, StorageError> {
    let mut candidate = root.to_path_buf();
    for component in relative.as_str().split('/') {
        candidate.push(component);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
        if metadata.file_type().is_symlink() {
            return Err(StorageError::new(
                "SYMLINK_ESCAPE: symlinks are not valid read targets",
            ));
        }
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| StorageError::new(format!("ROOT_REMOVED: {error}")))?;
    if !canonical.starts_with(root) {
        return Err(StorageError::new(
            "PATH_ESCAPE: resolved path left its registered root",
        ));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    fn create_project(root: &Path, relative: &str) {
        let project = root.join(relative);
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("project.work"), b"project fixture").unwrap();
        fs::write(project.join("bank01.work"), b"bank fixture").unwrap();
    }

    fn snapshot_files(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        let mut files = BTreeMap::new();
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file() {
                let relative = entry.path().strip_prefix(root).unwrap().to_path_buf();
                files.insert(relative, fs::read(entry.path()).unwrap());
            }
        }
        files
    }

    #[test]
    fn lists_sets_and_projects_without_exposing_absolute_paths() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("LIVE_SET")).unwrap();
        fs::create_dir(root.path().join("LIVE_SET/AUDIO")).unwrap();
        create_project(root.path(), "LIVE_SET/PROJECT_A");

        let snapshot = scan_registered_root(root.path()).unwrap();

        assert_eq!(snapshot.sets.len(), 1);
        assert_eq!(snapshot.sets[0].relative_path.as_str(), "LIVE_SET");
        assert_eq!(
            snapshot.sets[0].projects[0].relative_path.as_str(),
            "LIVE_SET/PROJECT_A"
        );
        assert!(!snapshot.sets[0]
            .projects[0]
            .relative_path
            .as_str()
            .contains(root.path().to_str().unwrap()));
    }

    #[test]
    fn read_only_scan_leaves_every_fixture_byte_unchanged() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("SET")).unwrap();
        fs::create_dir(root.path().join("SET/AUDIO")).unwrap();
        create_project(root.path(), "SET/PROJECT");
        let before = snapshot_files(root.path());

        let _snapshot = scan_registered_root(root.path()).unwrap();

        assert_eq!(snapshot_files(root.path()), before);
    }

    #[test]
    fn path_outside_the_registered_root_is_rejected() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let project = outside.path().join("OUTSIDE_PROJECT");
        fs::create_dir(&project).unwrap();

        let error = checked_relative_path(root.path(), &project).unwrap_err();

        assert!(error.message().starts_with("PATH_ESCAPE:"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected_and_not_scanned() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::create_dir(outside.path().join("OUTSIDE_SET")).unwrap();
        fs::create_dir(outside.path().join("OUTSIDE_SET/AUDIO")).unwrap();
        create_project(outside.path(), "OUTSIDE_SET/PROJECT");
        symlink(outside.path().join("OUTSIDE_SET"), root.path().join("ESCAPE")).unwrap();

        let snapshot = scan_registered_root(root.path()).unwrap();
        assert!(snapshot.sets.is_empty());

        let relative = RootRelativePath::parse("ESCAPE/PROJECT/project.work").unwrap();
        let error = resolve_relative_for_read(root.path(), &relative).unwrap_err();
        assert!(error.message().starts_with("SYMLINK_ESCAPE:"));
    }
}
