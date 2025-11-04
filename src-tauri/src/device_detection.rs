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

/// Checks if a directory is an Octatrack Set (has an AUDIO subdirectory)
fn is_octatrack_set(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    // A Set MUST have an AUDIO directory (the audio pool)
    let audio_path = path.join("AUDIO");
    audio_path.exists() && audio_path.is_dir()
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

/// Scans the user's home directory for local copies of Octatrack content
fn scan_home_directory() -> Vec<OctatrackLocation> {
    let mut locations = Vec::new();

    // Get the home directory
    let Some(home_dir) = dirs::home_dir() else {
        return locations;
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

        // Check if this path itself is a location with Sets
        let sets = scan_for_sets(&search_path, 3);

        if !sets.is_empty() {
            locations.push(OctatrackLocation {
                name: search_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Local Copy")
                    .to_string(),
                path: search_path.to_string_lossy().to_string(),
                device_type: DeviceType::LocalCopy,
                sets,
            });
        }
    }

    locations
}

/// Discovers Octatrack locations by scanning removable drives and home directory
pub fn discover_devices() -> Vec<OctatrackLocation> {
    let mut locations = Vec::new();

    // First, scan removable drives
    let disks = Disks::new_with_refreshed_list();

    for disk in disks.list() {
        let mount_point = disk.mount_point();

        // Skip system mount points
        if mount_point.to_string_lossy().starts_with("/sys")
            || mount_point.to_string_lossy().starts_with("/proc")
            || mount_point.to_string_lossy().starts_with("/dev")
            || mount_point.to_string_lossy() == "/"
        {
            continue;
        }

        // Scan for Octatrack sets
        let sets = scan_for_sets(mount_point, 3);

        // If we found sets, this is likely an Octatrack location
        if !sets.is_empty() {
            locations.push(OctatrackLocation {
                name: disk
                    .name()
                    .to_string_lossy()
                    .to_string()
                    .trim()
                    .to_string(),
                path: mount_point.to_string_lossy().to_string(),
                device_type: DeviceType::CompactFlash,
                sets,
            });
        }
    }

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
