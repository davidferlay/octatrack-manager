use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use sysinfo::Disks;
use walkdir::WalkDir;

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
/// - Must have AUDIO subdirectory (structure requirement)
/// - Must have at least one subdirectory with .work files (projects)
/// - Must not be a system directory
/// Note: AUDIO directory can be empty - Sets with projects but no samples are valid
fn is_octatrack_set(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    // Skip system directories
    if is_system_path(path) {
        return false;
    }

    // A Set MUST have an AUDIO directory (the audio pool)
    let audio_path = path.join("AUDIO");
    if !audio_path.exists() || !audio_path.is_dir() {
        return false;
    }

    // Must have at least one subdirectory with .work files (projects)
    // This is the KEY requirement that distinguishes real Octatrack Sets from random folders
    let mut has_project = false;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir()
                && entry_path.file_name().and_then(|n| n.to_str()) != Some("AUDIO")
                && is_octatrack_project(&entry_path)
            {
                has_project = true;
                break;
            }
        }
    }

    if !has_project {
        return false; // No valid projects found - not an Octatrack Set
    }

    // At this point we have AUDIO directory + valid projects, so it's a Set
    // Optional: Verify AUDIO contents if it has files (quality check for false positives)
    // But an empty AUDIO directory with valid projects is still a valid Set
    if has_valid_audio_pool(&audio_path) {
        return true; // Has audio files - definitely valid
    }

    // AUDIO is empty, but we have valid projects, so still a valid Set
    // (Projects can exist without audio samples in the pool)
    true
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

/// Scans a location for Sets
fn scan_for_sets(location_path: &Path, max_depth: usize) -> Vec<OctatrackSet> {
    let mut sets = Vec::new();

    for entry in WalkDir::new(location_path)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        if is_octatrack_set(path) {
            let audio_pool = path.join("AUDIO");
            let projects = scan_for_projects(path);

            sets.push(OctatrackSet {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                has_audio_pool: audio_pool.exists() && audio_pool.is_dir(),
                projects,
            });
        }
    }

    sets
}

/// Groups Sets by their parent directory and creates locations
fn group_sets_by_parent(sets: Vec<OctatrackSet>) -> Vec<OctatrackLocation> {
    use std::collections::HashMap;

    let mut grouped: HashMap<String, Vec<OctatrackSet>> = HashMap::new();

    for set in sets {
        // Get the parent directory of this Set
        if let Some(parent_path) = Path::new(&set.path).parent() {
            let parent_str = parent_path.to_string_lossy().to_string();
            grouped.entry(parent_str).or_insert_with(Vec::new).push(set);
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

    locations
}

/// Scans the user's home directory for local copies of Octatrack content
fn scan_home_directory() -> Vec<OctatrackLocation> {
    let mut all_sets = Vec::new();

    // Get the home directory
    let Some(home_dir) = dirs::home_dir() else {
        return Vec::new();
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

        // Scan for Sets in this path
        let sets = scan_for_sets(&search_path, 3);
        all_sets.extend(sets);
    }

    // Group Sets by their parent directory
    group_sets_by_parent(all_sets)
}

/// Scans a specific directory for Octatrack Sets
pub fn scan_directory(path: &str) -> Vec<OctatrackLocation> {
    let path = Path::new(path);

    if !path.exists() || !path.is_dir() {
        return Vec::new();
    }

    // Scan for Sets in the specified directory
    let sets = scan_for_sets(path, 3);

    if sets.is_empty() {
        return Vec::new();
    }

    // Group Sets by their parent directory
    group_sets_by_parent(sets)
}

/// Discovers Octatrack locations by scanning removable drives and home directory
pub fn discover_devices() -> Vec<OctatrackLocation> {
    let mut locations = Vec::new();

    // First, scan removable drives
    let disks = Disks::new_with_refreshed_list();
    let mut all_removable_sets = Vec::new();

    for disk in disks.list() {
        let mount_point = disk.mount_point();
        let mount_str = mount_point.to_string_lossy();

        // Skip system mount points
        if mount_str.starts_with("/sys")
            || mount_str.starts_with("/proc")
            || mount_str.starts_with("/dev")
            || mount_str == "/"
            || mount_str.starts_with("/System/")
            || mount_str.starts_with("/Library/")
            || mount_str.starts_with("/private/")
            || mount_str.starts_with("/usr/")
            || mount_str.starts_with("/var/")
            || mount_str.starts_with("/boot/")
        {
            continue;
        }

        // Scan for Octatrack sets
        let sets = scan_for_sets(mount_point, 3);
        all_removable_sets.extend(sets);
    }

    // Group removable Sets by parent directory and mark as CompactFlash
    let mut removable_locations = group_sets_by_parent(all_removable_sets);
    for location in &mut removable_locations {
        location.device_type = DeviceType::CompactFlash;
    }
    locations.append(&mut removable_locations);

    // Then, scan home directory for local copies
    let mut home_locations = scan_home_directory();
    locations.append(&mut home_locations);

    locations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_devices() {
        let locations = discover_devices();
        println!("Found {} Octatrack locations", locations.len());
        for location in locations {
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
    }
}
