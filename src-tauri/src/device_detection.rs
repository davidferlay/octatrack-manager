use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use sysinfo::Disks;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OctatrackDevice {
    pub name: String,
    pub mount_point: String,
    pub device_type: DeviceType,
    pub sets: Vec<OctatrackSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeviceType {
    CompactFlash,
    Usb, // For future USB connectivity support
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OctatrackSet {
    pub name: String,
    pub path: String,
    pub has_audio: bool,
    pub has_presets: bool,
}

/// Checks if a directory is an Octatrack set by looking for Audio and Presets folders
fn is_octatrack_set(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    let audio_path = path.join("Audio");
    let presets_path = path.join("Presets");

    audio_path.exists() && presets_path.exists()
}

/// Checks if a directory contains Octatrack project files (.work files)
fn has_octatrack_project_files(presets_path: &Path) -> bool {
    if !presets_path.is_dir() {
        return false;
    }

    // Look for .work files which indicate Octatrack projects
    if let Ok(entries) = fs::read_dir(presets_path) {
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

/// Scans a mount point for Octatrack sets
fn scan_for_sets(mount_point: &Path) -> Vec<OctatrackSet> {
    let mut sets = Vec::new();

    // Walk through the directory tree, but not too deep (max 3 levels)
    for entry in WalkDir::new(mount_point)
        .max_depth(3)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        if is_octatrack_set(path) {
            let audio_path = path.join("Audio");
            let presets_path = path.join("Presets");

            let set = OctatrackSet {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                has_audio: audio_path.exists(),
                has_presets: has_octatrack_project_files(&presets_path),
            };

            sets.push(set);
        }
    }

    sets
}

/// Discovers Octatrack devices by scanning removable drives
pub fn discover_devices() -> Vec<OctatrackDevice> {
    let mut devices = Vec::new();
    let disks = Disks::new_with_refreshed_list();

    for disk in disks.list() {
        // Check if the disk is removable (this is a heuristic, might need adjustment)
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
        let sets = scan_for_sets(mount_point);

        // If we found sets, this is likely an Octatrack device
        if !sets.is_empty() {
            let device = OctatrackDevice {
                name: disk
                    .name()
                    .to_string_lossy()
                    .to_string()
                    .trim()
                    .to_string(),
                mount_point: mount_point.to_string_lossy().to_string(),
                device_type: DeviceType::CompactFlash,
                sets,
            };

            devices.push(device);
        }
    }

    devices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_devices() {
        let devices = discover_devices();
        println!("Found {} Octatrack devices", devices.len());
        for device in devices {
            println!("Device: {} at {}", device.name, device.mount_point);
            for set in device.sets {
                println!("  - Set: {} ({})", set.name, set.path);
            }
        }
    }
}
