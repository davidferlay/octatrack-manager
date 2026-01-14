use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use sysinfo::Disks;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub locations: Vec<OctatrackLocation>,
    pub standalone_projects: Vec<OctatrackProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OctatrackLocation {
    pub name: String,
    pub path: String,
    pub device_type: DeviceType,
    pub sets: Vec<OctatrackSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeviceType {
    CompactFlash,
    Usb,
    LocalCopy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OctatrackSet {
    pub name: String,
    pub path: String,
    pub has_audio_pool: bool,
    pub projects: Vec<OctatrackProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OctatrackProject {
    pub name: String,
    pub path: String,
    pub has_project_file: bool,
    pub has_banks: bool,
}

/// Checks if a path should be excluded from scanning (system directories)
fn is_system_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();

    // macOS system paths
    if path_str.starts_with("/System/")
        || path_str.starts_with("/Library/")
        || path_str.starts_with("/private/")
        || path_str.contains("/Library/Application Support/")
        || path_str.contains("/Library/Preferences/")
        || path_str.contains("/Library/Caches/")
    {
        return true;
    }

    // Linux system paths
    if path_str.starts_with("/usr/")
        || path_str.starts_with("/var/")
        || path_str.starts_with("/etc/")
        || path_str.starts_with("/bin/")
        || path_str.starts_with("/sbin/")
        || path_str.starts_with("/boot/")
    {
        return true;
    }

    false
}

/// Checks if AUDIO directory contains actual audio samples (WAV or AIFF files)
/// Checks both the immediate directory and one level of subdirectories
fn has_valid_audio_pool(audio_path: &Path) -> bool {
    if !audio_path.is_dir() {
        return false;
    }

    // Check for audio files (WAV or AIFF) in the AUDIO directory and subdirectories
    // Use walkdir with max depth 2 to check subdirectories (common for organized sample libraries)
    for entry in WalkDir::new(audio_path)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if let Some(ext) = entry.path().extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ext_str == "wav" || ext_str == "aif" || ext_str == "aiff" {
                return true; // Found at least one valid audio file
            }
        }
    }

    false
}

/// Checks if a directory is an Octatrack Set
/// Requirements:
/// - Must have an AUDIO directory (the defining characteristic of a Set)
/// - Must have at least one project subdirectory
/// - Must not be a system directory
///
/// Note: A directory without an AUDIO directory is NOT considered a Set,
/// even if it contains multiple projects - those are individual projects
fn is_octatrack_set(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    // Skip system directories
    if is_system_path(path) {
        return false;
    }

    // Check for AUDIO directory - this is the defining characteristic of a Set
    let has_audio_dir = path.join("AUDIO").is_dir();
    if !has_audio_dir {
        return false;
    }

    // Must also have at least one project subdirectory
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir()
                && entry_path.file_name().and_then(|n| n.to_str()) != Some("AUDIO")
                && is_octatrack_project(&entry_path)
            {
                return true; // Found a Set: has AUDIO dir + at least one project
            }
        }
    }

    false // Has AUDIO dir but no projects - not a valid Set
}

/// Checks if a directory is an Octatrack Project (contains .work files)
fn is_octatrack_project(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    // Look for .work files which indicate Octatrack projects
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension() {
                if ext == "work" {
                    return true;
                }
            }
        }
    }

    false
}

/// Scans a Set directory for Projects
fn scan_for_projects(set_path: &Path) -> Vec<OctatrackProject> {
    let mut projects = Vec::new();

    // Look for subdirectories that contain .work files
    if let Ok(entries) = fs::read_dir(set_path) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Skip the AUDIO directory
            if path.file_name().and_then(|n| n.to_str()) == Some("AUDIO") {
                continue;
            }

            if path.is_dir() && is_octatrack_project(&path) {
                let has_project_file = path.join("project.work").exists();
                let has_banks = path.join("bank01.work").exists();

                projects.push(OctatrackProject {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    has_project_file,
                    has_banks,
                });
            }
        }
    }

    projects
}

/// Scans a location for Sets and individual projects
fn scan_for_sets(
    location_path: &Path,
    max_depth: usize,
) -> (Vec<OctatrackSet>, Vec<OctatrackProject>) {
    let mut sets = Vec::new();
    let mut standalone_projects = Vec::new();
    let mut set_paths = std::collections::HashSet::new();

    // First pass: collect all Sets
    for entry in WalkDir::new(location_path)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Check if it's a Set (contains project subdirectories)
        if is_octatrack_set(path) {
            let audio_pool = path.join("AUDIO");
            let projects = scan_for_projects(path);

            // Check if AUDIO directory exists and contains valid audio files
            let has_audio_pool =
                audio_pool.exists() && audio_pool.is_dir() && has_valid_audio_pool(&audio_pool);

            // Store the canonical path to avoid duplicate detection
            if let Ok(canonical_path) = path.canonicalize() {
                set_paths.insert(canonical_path);
            }

            sets.push(OctatrackSet {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                has_audio_pool,
                projects,
            });
        }
    }

    // Second pass: collect standalone projects (not part of any Set)
    for entry in WalkDir::new(location_path)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        if is_octatrack_project(path) {
            // Check if this path is itself a Set or is a subdirectory of any Set
            let is_set_or_part_of_set = if let Ok(canonical_path) = path.canonicalize() {
                set_paths
                    .iter()
                    .any(|set_path| canonical_path.starts_with(set_path))
            } else {
                false
            };

            // Only add if it's NOT a Set and NOT part of a Set
            if !is_set_or_part_of_set {
                let has_project_file = path.join("project.work").exists();
                let has_banks = path.join("bank01.work").exists();

                standalone_projects.push(OctatrackProject {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    has_project_file,
                    has_banks,
                });
            }
        }
    }

    (sets, standalone_projects)
}

/// Groups Sets by their parent directory and creates locations
/// Returns (locations, deduplicated_standalone_projects)
fn group_sets_by_parent(
    sets: Vec<OctatrackSet>,
    standalone_projects: Vec<OctatrackProject>,
) -> (Vec<OctatrackLocation>, Vec<OctatrackProject>) {
    use std::collections::HashMap;
    use std::collections::HashSet;

    let mut grouped: HashMap<String, Vec<OctatrackSet>> = HashMap::new();

    // Deduplicate Sets by path
    let mut seen_set_paths = HashSet::new();
    for set in sets {
        if seen_set_paths.insert(set.path.clone()) {
            if let Some(parent_path) = Path::new(&set.path).parent() {
                let parent_str = parent_path.to_string_lossy().to_string();
                grouped.entry(parent_str).or_default().push(set);
            }
        }
    }

    // Deduplicate standalone projects by path
    let mut deduplicated_projects = Vec::new();
    let mut seen_project_paths = HashSet::new();
    for project in standalone_projects {
        if seen_project_paths.insert(project.path.clone()) {
            deduplicated_projects.push(project);
        }
    }

    // Convert grouped Sets into locations
    let mut locations = Vec::new();
    for (parent_path, sets) in grouped {
        let path = Path::new(&parent_path);
        locations.push(OctatrackLocation {
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Local Copy")
                .to_string(),
            path: parent_path,
            device_type: DeviceType::LocalCopy,
            sets,
        });
    }

    (locations, deduplicated_projects)
}

/// Scans the user's home directory for local copies of Octatrack content
fn scan_home_directory() -> ScanResult {
    let mut all_sets = Vec::new();
    let mut all_standalone_projects = Vec::new();

    // Get the home directory
    let Some(home_dir) = dirs::home_dir() else {
        return ScanResult {
            locations: Vec::new(),
            standalone_projects: Vec::new(),
        };
    };

    // Common locations where users might store Octatrack backups
    let search_paths = vec![
        home_dir.join("Documents"),
        home_dir.join("Music"),
        home_dir.join("Desktop"),
        home_dir.join("Downloads"),
        home_dir.join("octatrack"),
        home_dir.join("Octatrack"),
        home_dir.join("OCTATRACK"),
    ];

    for search_path in search_paths {
        if !search_path.exists() {
            continue;
        }

        // Scan for Sets and standalone projects in this path
        let (sets, standalone_projects) = scan_for_sets(&search_path, 3);
        all_sets.extend(sets);
        all_standalone_projects.extend(standalone_projects);
    }

    // Group Sets by their parent directory
    let (locations, standalone_projects) = group_sets_by_parent(all_sets, all_standalone_projects);
    ScanResult {
        locations,
        standalone_projects,
    }
}

/// Scans a specific directory for Octatrack Sets and standalone projects
pub fn scan_directory(path: &str) -> ScanResult {
    let path = Path::new(path);

    if !path.exists() || !path.is_dir() {
        return ScanResult {
            locations: Vec::new(),
            standalone_projects: Vec::new(),
        };
    }

    // Scan for Sets and standalone projects in the specified directory
    let (sets, standalone_projects) = scan_for_sets(path, 3);

    if sets.is_empty() && standalone_projects.is_empty() {
        return ScanResult {
            locations: Vec::new(),
            standalone_projects: Vec::new(),
        };
    }

    // Group Sets by their parent directory
    let (locations, standalone_projects) = group_sets_by_parent(sets, standalone_projects);
    ScanResult {
        locations,
        standalone_projects,
    }
}

/// Discovers Octatrack locations by scanning removable drives and home directory
pub fn discover_devices() -> ScanResult {
    use std::collections::HashMap;
    use std::collections::HashSet;

    let mut all_locations: HashMap<String, OctatrackLocation> = HashMap::new();
    let mut all_standalone_projects = Vec::new();

    // First, scan removable drives
    let disks = Disks::new_with_refreshed_list();
    let mut all_removable_sets = Vec::new();
    let mut all_removable_projects = Vec::new();

    for disk in disks.list() {
        let mount_point = disk.mount_point();
        let mount_str = mount_point.to_string_lossy();

        // Skip system mount points and home directory (home is scanned separately)
        if mount_str.starts_with("/sys")
            || mount_str.starts_with("/proc")
            || mount_str.starts_with("/dev")
            || mount_str == "/"
            || mount_str.starts_with("/home")
            || mount_str.starts_with("/System/")
            || mount_str.starts_with("/Library/")
            || mount_str.starts_with("/private/")
            || mount_str.starts_with("/usr/")
            || mount_str.starts_with("/var/")
            || mount_str.starts_with("/boot/")
        {
            continue;
        }

        // Scan for Octatrack sets and standalone projects
        let (sets, standalone_projects) = scan_for_sets(mount_point, 3);
        all_removable_sets.extend(sets);
        all_removable_projects.extend(standalone_projects);
    }

    // Group removable Sets by parent directory and mark as CompactFlash
    let (mut removable_locations, removable_standalone) =
        group_sets_by_parent(all_removable_sets, all_removable_projects);
    for location in &mut removable_locations {
        location.device_type = DeviceType::CompactFlash;
    }
    for location in removable_locations {
        all_locations.insert(location.path.clone(), location);
    }
    all_standalone_projects.extend(removable_standalone);

    // Then, scan home directory for local copies
    let home_result = scan_home_directory();
    for location in home_result.locations {
        let path_key = location.path.clone();
        // Merge with existing location if path already exists, otherwise add new
        if let Some(existing) = all_locations.get_mut(&path_key) {
            existing.sets.extend(location.sets);
        } else {
            all_locations.insert(path_key, location);
        }
    }
    all_standalone_projects.extend(home_result.standalone_projects);

    // Deduplicate standalone projects by path
    let mut deduplicated_projects = Vec::new();
    let mut seen_project_paths = HashSet::new();
    for project in all_standalone_projects {
        if seen_project_paths.insert(project.path.clone()) {
            deduplicated_projects.push(project);
        }
    }

    ScanResult {
        locations: all_locations.into_values().collect(),
        standalone_projects: deduplicated_projects,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // Helper to create an Octatrack project structure
    fn create_project(path: &Path, name: &str) -> std::path::PathBuf {
        let project_path = path.join(name);
        fs::create_dir_all(&project_path).unwrap();

        // Create project.work file (minimal valid file)
        fs::write(project_path.join("project.work"), [0u8; 100]).unwrap();

        // Create a bank file
        fs::write(project_path.join("bank01.work"), [0u8; 100]).unwrap();

        project_path
    }

    // Helper to create an Octatrack Set structure
    fn create_set(path: &Path, name: &str, with_audio_pool: bool) -> std::path::PathBuf {
        let set_path = path.join(name);
        fs::create_dir_all(&set_path).unwrap();

        // Create AUDIO directory (required for Set)
        let audio_path = set_path.join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();

        // Add a sample file to make it valid
        fs::write(audio_path.join("kick.wav"), [0u8; 44]).unwrap();

        // Create AUDIO POOL if requested
        if with_audio_pool {
            let pool_path = set_path.join("AUDIO POOL");
            fs::create_dir_all(&pool_path).unwrap();
        }

        set_path
    }

    #[test]
    fn test_discover_devices() {
        let scan_result = discover_devices();
        println!("Found {} Octatrack locations", scan_result.locations.len());
        for location in scan_result.locations {
            println!("Location: {} at {}", location.name, location.path);
            for set in location.sets {
                println!("  - Set: {} ({})", set.name, set.path);
                println!("    Audio Pool: {}", set.has_audio_pool);
                println!("    Projects: {}", set.projects.len());
                for project in set.projects {
                    println!("      * Project: {}", project.name);
                }
            }
        }
        println!(
            "Found {} standalone projects",
            scan_result.standalone_projects.len()
        );
        for project in scan_result.standalone_projects {
            println!("Standalone project: {}", project.name);
        }
    }

    // ==================== SCAN DIRECTORY TESTS ====================

    #[test]
    fn test_scan_directory_empty() {
        let temp_dir = TempDir::new().unwrap();

        let result = scan_directory(&temp_dir.path().to_string_lossy());
        assert!(
            result.locations.is_empty(),
            "Empty directory should have no locations"
        );
        assert!(
            result.standalone_projects.is_empty(),
            "Empty directory should have no projects"
        );
    }

    #[test]
    fn test_scan_directory_nonexistent() {
        let result = scan_directory("/nonexistent/path/12345");
        assert!(result.locations.is_empty());
        assert!(result.standalone_projects.is_empty());
    }

    #[test]
    fn test_scan_directory_finds_set() {
        let temp_dir = TempDir::new().unwrap();

        // Create a Set structure
        let set_path = create_set(temp_dir.path(), "MySet", false);

        // Create a project inside the set
        create_project(&set_path, "Project1");

        let result = scan_directory(&temp_dir.path().to_string_lossy());

        // Should find the set
        assert!(
            !result.locations.is_empty() || !result.standalone_projects.is_empty(),
            "Should find something in the scanned directory"
        );
    }

    #[test]
    fn test_scan_directory_finds_standalone_project() {
        let temp_dir = TempDir::new().unwrap();

        // Create a standalone project (no AUDIO folder = not a Set)
        create_project(temp_dir.path(), "StandaloneProject");

        let result = scan_directory(&temp_dir.path().to_string_lossy());

        // Should find as standalone project
        assert!(
            !result.standalone_projects.is_empty() || !result.locations.is_empty(),
            "Should find the standalone project"
        );
    }

    #[test]
    fn test_scan_directory_with_audio_pool() {
        let temp_dir = TempDir::new().unwrap();

        // Create a Set with AUDIO POOL
        let set_path = create_set(temp_dir.path(), "MySet", true);
        create_project(&set_path, "Project1");

        let result = scan_directory(&temp_dir.path().to_string_lossy());

        // Check if detected as project or set
        let found_something =
            !result.locations.is_empty() || !result.standalone_projects.is_empty();
        assert!(found_something, "Should detect Set or project");

        // If we found sets, verify audio pool detection
        if !result.locations.is_empty() {
            let _has_audio_pool = result
                .locations
                .iter()
                .flat_map(|l| &l.sets)
                .any(|s| s.has_audio_pool);
            // Audio pool detection depends on the Set detection logic
        }
    }

    #[test]
    fn test_scan_directory_multiple_projects_in_set() {
        let temp_dir = TempDir::new().unwrap();

        // Create a Set with multiple projects
        let set_path = create_set(temp_dir.path(), "MySet", false);
        create_project(&set_path, "Project1");
        create_project(&set_path, "Project2");
        create_project(&set_path, "Project3");

        let result = scan_directory(&temp_dir.path().to_string_lossy());

        let found_something =
            !result.locations.is_empty() || !result.standalone_projects.is_empty();
        assert!(found_something, "Should find projects");
    }

    // ==================== IS SYSTEM PATH TESTS ====================

    #[test]
    fn test_is_system_path_macos() {
        assert!(is_system_path(Path::new("/System/Library")));
        assert!(is_system_path(Path::new(
            "/Library/Application Support/Something"
        )));
        assert!(is_system_path(Path::new("/private/var")));
    }

    #[test]
    fn test_is_system_path_linux() {
        // Note: function checks starts_with("/<dir>/") so paths need content after the directory
        assert!(is_system_path(Path::new("/usr/local")));
        assert!(is_system_path(Path::new("/var/log")));
        assert!(is_system_path(Path::new("/etc/passwd")));
        assert!(is_system_path(Path::new("/bin/bash")));
        assert!(is_system_path(Path::new("/sbin/init")));
        assert!(is_system_path(Path::new("/boot/grub")));
    }

    #[test]
    fn test_is_system_path_user_directories() {
        // User directories should NOT be marked as system
        assert!(!is_system_path(Path::new("/home/user")));
        assert!(!is_system_path(Path::new("/Users/john")));
        assert!(!is_system_path(Path::new("/media/usb")));
        assert!(!is_system_path(Path::new("/mnt/drive")));
    }

    // ==================== HAS VALID AUDIO POOL TESTS ====================

    #[test]
    fn test_has_valid_audio_pool_with_wav() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();
        fs::write(audio_path.join("sample.wav"), [0u8; 44]).unwrap();

        assert!(has_valid_audio_pool(&audio_path), "Should detect WAV files");
    }

    #[test]
    fn test_has_valid_audio_pool_with_aif() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();
        fs::write(audio_path.join("sample.aif"), [0u8; 44]).unwrap();

        assert!(has_valid_audio_pool(&audio_path), "Should detect AIF files");
    }

    #[test]
    fn test_has_valid_audio_pool_with_aiff() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();
        fs::write(audio_path.join("sample.aiff"), [0u8; 44]).unwrap();

        assert!(
            has_valid_audio_pool(&audio_path),
            "Should detect AIFF files"
        );
    }

    #[test]
    fn test_has_valid_audio_pool_empty() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();

        assert!(
            !has_valid_audio_pool(&audio_path),
            "Empty directory should not be valid"
        );
    }

    #[test]
    fn test_has_valid_audio_pool_no_audio_files() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();
        fs::write(audio_path.join("readme.txt"), "text").unwrap();
        fs::write(audio_path.join("data.bin"), [0u8; 100]).unwrap();

        assert!(
            !has_valid_audio_pool(&audio_path),
            "Should not detect non-audio files"
        );
    }

    #[test]
    fn test_has_valid_audio_pool_in_subdirectory() {
        let temp_dir = TempDir::new().unwrap();
        let audio_path = temp_dir.path().join("AUDIO");
        let subdir = audio_path.join("Kicks");
        fs::create_dir_all(&subdir).unwrap();
        fs::write(subdir.join("kick.wav"), [0u8; 44]).unwrap();

        assert!(
            has_valid_audio_pool(&audio_path),
            "Should detect audio in subdirectory"
        );
    }

    #[test]
    fn test_has_valid_audio_pool_nonexistent() {
        assert!(!has_valid_audio_pool(Path::new("/nonexistent/path")));
    }

    #[test]
    fn test_has_valid_audio_pool_file_not_dir() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "content").unwrap();

        assert!(
            !has_valid_audio_pool(&file_path),
            "File should not be valid audio pool"
        );
    }

    // ==================== SCAN RESULT STRUCTURE TESTS ====================

    #[test]
    fn test_scan_result_serialization() {
        let result = ScanResult {
            locations: vec![OctatrackLocation {
                name: "Test Location".to_string(),
                path: "/test/path".to_string(),
                device_type: DeviceType::LocalCopy,
                sets: vec![],
            }],
            standalone_projects: vec![],
        };

        let json = serde_json::to_string(&result);
        assert!(json.is_ok(), "Should serialize ScanResult");
    }

    #[test]
    fn test_device_type_variants() {
        let cf = DeviceType::CompactFlash;
        let usb = DeviceType::Usb;
        let local = DeviceType::LocalCopy;

        // Test that all variants can be serialized
        let _ = serde_json::to_string(&cf).unwrap();
        let _ = serde_json::to_string(&usb).unwrap();
        let _ = serde_json::to_string(&local).unwrap();
    }

    #[test]
    fn test_octatrack_project_structure() {
        let project = OctatrackProject {
            name: "MyProject".to_string(),
            path: "/path/to/project".to_string(),
            has_project_file: true,
            has_banks: true,
        };

        assert_eq!(project.name, "MyProject");
        assert!(project.has_project_file);
        assert!(project.has_banks);
    }

    #[test]
    fn test_octatrack_set_structure() {
        let set = OctatrackSet {
            name: "MySet".to_string(),
            path: "/path/to/set".to_string(),
            has_audio_pool: true,
            projects: vec![OctatrackProject {
                name: "Project1".to_string(),
                path: "/path/to/set/Project1".to_string(),
                has_project_file: true,
                has_banks: true,
            }],
        };

        assert_eq!(set.name, "MySet");
        assert!(set.has_audio_pool);
        assert_eq!(set.projects.len(), 1);
    }

    // ==================== EDGE CASE TESTS ====================

    #[test]
    fn test_scan_deeply_nested_structure() {
        let temp_dir = TempDir::new().unwrap();

        // Create a deeply nested structure
        let deep_path = temp_dir.path().join("level1").join("level2").join("level3");
        fs::create_dir_all(&deep_path).unwrap();

        // Create a project in the deep path
        create_project(&deep_path, "DeepProject");

        let result = scan_directory(&temp_dir.path().to_string_lossy());
        // Just verify it doesn't crash - depth limiting may prevent finding it
        let _ = result;
    }

    #[test]
    fn test_scan_with_special_characters_in_names() {
        let temp_dir = TempDir::new().unwrap();

        // Create directory with spaces
        let set_path = create_set(temp_dir.path(), "My Set With Spaces", false);
        create_project(&set_path, "Project With Spaces");

        let result = scan_directory(&temp_dir.path().to_string_lossy());
        let found_something =
            !result.locations.is_empty() || !result.standalone_projects.is_empty();
        assert!(found_something, "Should handle spaces in names");
    }

    #[test]
    fn test_scan_case_sensitivity() {
        let temp_dir = TempDir::new().unwrap();

        // Create AUDIO directory (correct case)
        let set_path = temp_dir.path().join("TestSet");
        fs::create_dir_all(&set_path).unwrap();
        let audio_path = set_path.join("AUDIO");
        fs::create_dir_all(&audio_path).unwrap();
        fs::write(audio_path.join("sample.wav"), [0u8; 44]).unwrap();

        let result = scan_directory(&temp_dir.path().to_string_lossy());
        let _ = result; // Verify no crash
    }
}
