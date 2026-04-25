// Allow certain clippy lints that would require significant refactoring
#![allow(clippy::too_many_arguments)]

mod audio_pool;
mod device_detection;
pub mod project_manager;
mod project_reader;

use audio_pool::{
    cancel_transfer, copy_files_with_overwrite, copy_single_file_with_progress, create_directory,
    delete_files, get_parent_directory, list_directory, move_files, register_cancellation_token,
    remove_cancellation_token, rename_file as rename_file_impl, AudioFileInfo,
};
use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{
    are_projects_in_same_set,
    check_missing_source_files as check_missing_source_files_impl,
    commit_all_parts_data,
    commit_part_data,
    // Copy operations
    copy_bank as copy_bank_impl,
    copy_parts as copy_parts_impl,
    copy_patterns as copy_patterns_impl,
    copy_sample_slots as copy_sample_slots_impl,
    copy_tracks as copy_tracks_impl,
    create_audio_pool as create_audio_pool_impl,
    get_audio_pool_status as get_audio_pool_status_impl,
    get_existing_bank_indices,
    // Set and Audio Pool helpers
    is_project_in_set,
    read_parts_data,
    read_project_banks,
    read_project_metadata,
    read_single_bank,
    reload_part_data,
    save_parts_data,
    AudioPoolStatus,
    Bank,
    PartData,
    PartsDataResponse,
    // Types
    ProjectMetadata,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
struct CopyProgressEvent {
    file_path: String,
    transfer_id: String,
    stage: String, // "converting", "writing", "copying", "complete", "cancelled"
    progress: f32, // 0.0 to 1.0
}

#[derive(Clone, Serialize)]
struct SystemResources {
    cpu_cores: usize,
    available_memory_mb: u64,
    recommended_concurrency: usize,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn scan_devices() -> ScanResult {
    discover_devices()
}

#[tauri::command]
fn scan_custom_directory(path: String) -> ScanResult {
    scan_directory(&path)
}

#[tauri::command]
async fn load_project_metadata(path: String) -> Result<ProjectMetadata, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || read_project_metadata(&path))
        .await
        .unwrap()
}

#[tauri::command]
async fn load_project_banks(path: String) -> Result<Vec<Bank>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || read_project_banks(&path))
        .await
        .unwrap()
}

#[tauri::command]
async fn load_single_bank(path: String, bank_index: u8) -> Result<Option<Bank>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || read_single_bank(&path, bank_index))
        .await
        .unwrap()
}

#[tauri::command]
async fn get_existing_banks(path: String) -> Vec<u8> {
    // Returns list of bank indices (0-15) that have existing bank files
    tauri::async_runtime::spawn_blocking(move || get_existing_bank_indices(&path))
        .await
        .unwrap()
}

#[tauri::command]
async fn load_parts_data(path: String, bank_id: String) -> Result<PartsDataResponse, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || read_parts_data(&path, &bank_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn save_parts(
    path: String,
    bank_id: String,
    parts_data: Vec<PartData>,
) -> Result<(), String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || save_parts_data(&path, &bank_id, parts_data))
        .await
        .unwrap()
}

#[tauri::command]
async fn commit_part(path: String, bank_id: String, part_id: u8) -> Result<(), String> {
    // Commit a part: copy parts.unsaved to parts.saved (like Octatrack's "SAVE" command)
    tauri::async_runtime::spawn_blocking(move || commit_part_data(&path, &bank_id, part_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn commit_all_parts(path: String, bank_id: String) -> Result<(), String> {
    // Commit all parts: copy all parts.unsaved to parts.saved (like Octatrack's "SAVE ALL" command)
    tauri::async_runtime::spawn_blocking(move || commit_all_parts_data(&path, &bank_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn reload_part(path: String, bank_id: String, part_id: u8) -> Result<PartData, String> {
    // Reload a part: copy parts.saved back to parts.unsaved (like Octatrack's "RELOAD" command)
    tauri::async_runtime::spawn_blocking(move || reload_part_data(&path, &bank_id, part_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn list_audio_directory(path: String) -> Result<Vec<AudioFileInfo>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || list_directory(&path))
        .await
        .unwrap()
}

#[tauri::command]
fn navigate_to_parent(path: String) -> Result<String, String> {
    get_parent_directory(&path)
}

#[tauri::command]
fn create_new_directory(path: String, name: String) -> Result<String, String> {
    create_directory(&path, &name)
}

#[tauri::command]
async fn copy_audio_files(
    source_paths: Vec<String>,
    destination_dir: String,
    overwrite: Option<bool>,
) -> Result<Vec<String>, String> {
    let should_overwrite = overwrite.unwrap_or(false);
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        copy_files_with_overwrite(source_paths, &destination_dir, should_overwrite)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn copy_audio_file_with_progress(
    app: AppHandle,
    source_path: String,
    destination_dir: String,
    transfer_id: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let should_overwrite = overwrite.unwrap_or(false);
    let source_path_clone = source_path.clone();
    let transfer_id_for_callback = transfer_id.clone();
    let transfer_id_for_cleanup = transfer_id.clone();

    // Register cancellation token for this transfer
    let cancel_token = register_cancellation_token(&transfer_id);

    // Create progress callback that also checks for cancellation
    let progress_callback = move |stage: &str, progress: f32| {
        let _ = app.emit(
            "copy-progress",
            CopyProgressEvent {
                file_path: source_path_clone.clone(),
                transfer_id: transfer_id_for_callback.clone(),
                stage: stage.to_string(),
                progress,
            },
        );
    };

    // Run on a blocking thread pool
    let result = tauri::async_runtime::spawn_blocking(move || {
        copy_single_file_with_progress(
            &source_path,
            &destination_dir,
            should_overwrite,
            progress_callback,
            Some(cancel_token),
        )
    })
    .await
    .unwrap();

    // Clean up cancellation token
    remove_cancellation_token(&transfer_id_for_cleanup);

    result
}

#[tauri::command]
fn cancel_audio_transfer(transfer_id: String) -> bool {
    cancel_transfer(&transfer_id)
}

#[tauri::command]
async fn move_audio_files(
    source_paths: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || move_files(source_paths, &destination_dir))
        .await
        .unwrap()
}

#[tauri::command]
async fn delete_audio_files(file_paths: Vec<String>) -> Result<usize, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || delete_files(file_paths))
        .await
        .unwrap()
}

#[tauri::command]
fn get_home_directory() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    rename_file_impl(&old_path, &new_name)
}

#[tauri::command]
fn delete_file(path: String) -> Result<usize, String> {
    delete_files(vec![path])
}

#[tauri::command]
fn open_in_file_manager(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open file manager: {}", e))
}

/// Calculate recommended concurrency based on CPU cores and available memory.
/// This is extracted as a separate function for testability.
fn calculate_recommended_concurrency(cpu_cores: usize, available_memory_mb: u64) -> usize {
    // Calculate recommended concurrency based on:
    // - CPU cores (primary factor)
    // - Available memory (each conversion can use ~200-500MB)
    // Leave at least 1 core for the system and UI
    let cpu_based = (cpu_cores as f64 * 0.75).ceil() as usize;

    // Memory-based limit: assume ~300MB per conversion task
    let memory_based = (available_memory_mb / 300) as usize;

    // Take the minimum of both constraints, with bounds [1, 8]
    cpu_based.min(memory_based).clamp(1, 8)
}

#[tauri::command]
fn get_system_resources() -> SystemResources {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_cores = sys.cpus().len();
    let available_memory_mb = sys.available_memory() / (1024 * 1024);
    let recommended = calculate_recommended_concurrency(cpu_cores, available_memory_mb);

    SystemResources {
        cpu_cores,
        available_memory_mb,
        recommended_concurrency: recommended,
    }
}

// ============================================================================
// Tools Tab - Set and Audio Pool Commands
// ============================================================================

#[tauri::command]
async fn check_project_in_set(project_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || is_project_in_set(&project_path))
        .await
        .unwrap()
}

#[tauri::command]
async fn check_projects_in_same_set(project1: String, project2: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || are_projects_in_same_set(&project1, &project2))
        .await
        .unwrap()
}

#[tauri::command]
async fn get_audio_pool_status(project_path: String) -> Result<AudioPoolStatus, String> {
    tauri::async_runtime::spawn_blocking(move || get_audio_pool_status_impl(&project_path))
        .await
        .unwrap()
}

#[tauri::command]
async fn create_audio_pool(project_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || create_audio_pool_impl(&project_path))
        .await
        .unwrap()
}

// ============================================================================
// Tools Tab - Copy Operations Commands
// ============================================================================

#[tauri::command]
async fn copy_bank(
    source_project: String,
    source_bank_index: u8,
    dest_project: String,
    dest_bank_indices: Vec<u8>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_bank_impl(
            &source_project,
            source_bank_index,
            &dest_project,
            &dest_bank_indices,
        )
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn copy_parts(
    source_project: String,
    source_bank_index: u8,
    source_part_indices: Vec<u8>,
    dest_project: String,
    dest_bank_index: u8,
    dest_part_indices: Vec<u8>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_parts_impl(
            &source_project,
            source_bank_index,
            source_part_indices,
            &dest_project,
            dest_bank_index,
            dest_part_indices,
        )
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn copy_patterns(
    source_project: String,
    source_bank_index: u8,
    source_pattern_indices: Vec<u8>,
    dest_project: String,
    dest_bank_index: u8,
    dest_pattern_indices: Vec<u8>,
    part_assignment_mode: String,
    dest_part: Option<u8>,
    track_mode: String,
    track_indices: Option<Vec<u8>>,
    mode_scope: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_patterns_impl(
            &source_project,
            source_bank_index,
            source_pattern_indices,
            &dest_project,
            dest_bank_index,
            dest_pattern_indices,
            &part_assignment_mode,
            dest_part,
            &track_mode,
            track_indices,
            mode_scope.as_deref().unwrap_or("audio"),
        )
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn copy_tracks(
    source_project: String,
    source_bank_index: u8,
    source_part_index: Option<u8>, // None = all parts (0-3)
    source_track_indices: Vec<u8>,
    dest_project: String,
    dest_bank_index: u8,
    dest_part_indices: Option<Vec<u8>>, // None = all parts (synced with source), Some = specific parts
    dest_track_indices: Vec<u8>,
    mode: String,
    source_pattern_index: Option<u8>, // None = all 16 patterns, Some(0-15) = specific
    dest_pattern_indices: Option<Vec<u8>>, // None = all 16 patterns, Some = specific (1-to-many)
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Build the list of (src_pattern, dest_pattern) pairs to process
        let pattern_pairs: Vec<(Option<u8>, Option<u8>)> = match (&source_pattern_index, &dest_pattern_indices) {
            (None, None) => vec![(None, None)],                  // All → All (1-to-1)
            (Some(src), None) => vec![(Some(*src), None)],       // Specific → All
            (Some(src), Some(dsts)) => {
                // 1-to-many: copy source pattern to each destination pattern
                dsts.iter().map(|&d| (Some(*src), Some(d))).collect()
            }
            (None, Some(_)) => {
                return Err("Cannot specify destination patterns when source is 'All'".to_string());
            }
        };

        match (source_part_index, &dest_part_indices) {
            (None, None) => {
                // Copy tracks across all 4 parts (1-to-1 mapping)
                for part_idx in 0..4u8 {
                    for &(src_pat, dst_pat) in &pattern_pairs {
                        copy_tracks_impl(
                            &source_project,
                            source_bank_index,
                            part_idx,
                            source_track_indices.clone(),
                            &dest_project,
                            dest_bank_index,
                            part_idx,
                            dest_track_indices.clone(),
                            &mode,
                            src_pat,
                            dst_pat,
                        )?;
                    }
                }
                Ok(())
            }
            (Some(src), Some(dst_indices)) => {
                // Copy source part to each selected destination part (1-to-many)
                for &dst in dst_indices {
                    for &(src_pat, dst_pat) in &pattern_pairs {
                        copy_tracks_impl(
                            &source_project,
                            source_bank_index,
                            src,
                            source_track_indices.clone(),
                            &dest_project,
                            dest_bank_index,
                            dst,
                            dest_track_indices.clone(),
                            &mode,
                            src_pat,
                            dst_pat,
                        )?;
                    }
                }
                Ok(())
            }
            _ => Err("Both source and destination part indices must be specified or both must be None (all parts)".to_string())
        }
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn copy_sample_slots(
    source_project: String,
    dest_project: String,
    slot_type: String,
    source_indices: Vec<u8>,
    dest_indices: Vec<u8>,
    audio_mode: String,
    include_editor_settings: bool,
) -> Result<project_reader::CopySlotsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_sample_slots_impl(
            &source_project,
            &dest_project,
            &slot_type,
            source_indices,
            dest_indices,
            &audio_mode,
            include_editor_settings,
        )
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn check_missing_source_files(
    project_path: String,
    slot_type: String,
    source_indices: Vec<u8>,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_missing_source_files_impl(&project_path, &slot_type, source_indices)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn get_slot_audio_paths(
    project_path: String,
    slot_type: String,
    source_indices: Vec<u8>,
    flatten: bool,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::get_slot_audio_paths(&project_path, &slot_type, source_indices, flatten)
    })
    .await
    .unwrap()
}

/// Back up specific files from a project before modifying them.
/// Creates a timestamped subdirectory under `<project_path>/backups/` and copies the listed files.
fn backup_project_files_impl(
    project_path: &str,
    files: &[String],
    label: &str,
) -> Result<String, String> {
    use std::path::Path;

    let project_dir = Path::new(project_path);
    if !project_dir.exists() {
        return Err(format!("Project path does not exist: {}", project_path));
    }

    // Build timestamp directory name: YYYY-MM-DD_HH-MM-SS_label
    let now = chrono::Local::now();
    let dir_name = format!("{}_{}", now.format("%Y-%m-%d_%H-%M-%S"), label);
    let backup_dir = project_dir.join("backups").join(&dir_name);

    // Only create the backup dir if at least one source file actually exists
    let existing_files: Vec<_> = files
        .iter()
        .filter(|f| project_dir.join(f).exists())
        .collect();

    if existing_files.is_empty() {
        return Ok("No files to back up".to_string());
    }

    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    let mut copied = 0u32;
    for file in &existing_files {
        let src = project_dir.join(file);
        let dest = backup_dir.join(file);
        // Preserve subdirectory structure (e.g. AUDIO/sample.wav)
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::copy(&src, &dest).is_ok() {
            copied += 1;
        }
    }

    println!(
        "[BACKUP] {} file(s) backed up to {}",
        copied,
        backup_dir.display()
    );
    Ok(format!("{} file(s) backed up", copied))
}

#[tauri::command]
async fn backup_project_files(
    project_path: String,
    files: Vec<String>,
    label: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup_project_files_impl(&project_path, &files, &label)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn list_missing_samples(
    project_path: String,
) -> Result<Vec<project_reader::MissingSample>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::list_missing_samples(&project_path)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn search_project_dir(
    project_path: String,
    filenames: Vec<String>,
) -> Result<Vec<project_reader::FoundSample>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::search_project_dir(&project_path, filenames)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn search_audio_pool(
    project_path: String,
    filenames: Vec<String>,
) -> Result<Vec<project_reader::FoundSample>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::search_audio_pool(&project_path, filenames)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn search_other_projects_of_set(
    project_path: String,
    filenames: Vec<String>,
) -> Result<Vec<project_reader::FoundSample>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::search_other_projects_of_set(&project_path, filenames)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn search_parent_projects(
    project_path: String,
    filenames: Vec<String>,
) -> Result<Vec<project_reader::FoundSample>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::search_parent_projects(&project_path, filenames)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn search_directory(
    dir_path: String,
    filenames: Vec<String>,
) -> Result<Vec<project_reader::FoundSample>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::search_directory(&dir_path, filenames)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn fix_missing_samples(
    project_path: String,
    resolutions: Vec<project_reader::SampleResolution>,
) -> Result<project_reader::FixResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::fix_missing_samples(&project_path, resolutions)
    })
    .await
    .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Clear WebView session storage in the background on app startup
            let window = app.get_webview_window("main").unwrap();
            std::thread::spawn(move || {
                // Small delay to ensure WebView is ready
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = window.eval("sessionStorage.clear()");
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            scan_devices,
            scan_custom_directory,
            load_project_metadata,
            load_project_banks,
            load_single_bank,
            get_existing_banks,
            load_parts_data,
            save_parts,
            commit_part,
            commit_all_parts,
            reload_part,
            list_audio_directory,
            navigate_to_parent,
            create_new_directory,
            copy_audio_files,
            copy_audio_file_with_progress,
            cancel_audio_transfer,
            move_audio_files,
            delete_audio_files,
            get_home_directory,
            rename_file,
            delete_file,
            open_in_file_manager,
            get_system_resources,
            // Tools Tab - Set and Audio Pool
            check_project_in_set,
            check_projects_in_same_set,
            get_audio_pool_status,
            create_audio_pool,
            // Tools Tab - Copy Operations
            copy_bank,
            copy_parts,
            copy_patterns,
            copy_tracks,
            copy_sample_slots,
            check_missing_source_files,
            get_slot_audio_paths,
            backup_project_files,
            // Tools Tab - Fix Missing Samples
            list_missing_samples,
            search_project_dir,
            search_audio_pool,
            search_other_projects_of_set,
            search_parent_projects,
            search_directory,
            fix_missing_samples
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // greet function tests
    // =========================================================================

    #[test]
    fn test_greet_basic() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_empty_name() {
        let result = greet("");
        assert_eq!(result, "Hello, ! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_unicode_name() {
        let result = greet("世界");
        assert_eq!(result, "Hello, 世界! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_special_characters() {
        let result = greet("O'Brien");
        assert!(result.contains("O'Brien"));
    }

    // =========================================================================
    // get_home_directory function tests
    // =========================================================================

    #[test]
    fn test_get_home_directory_returns_path() {
        let result = get_home_directory();
        assert!(result.is_ok(), "Should return home directory");
        let path = result.unwrap();
        assert!(!path.is_empty(), "Home directory path should not be empty");
    }

    #[test]
    fn test_get_home_directory_is_absolute() {
        let result = get_home_directory();
        assert!(result.is_ok());
        let path = result.unwrap();
        // On Unix, absolute paths start with /
        // On Windows, they start with a drive letter like C:\
        assert!(
            path.starts_with('/') || path.chars().nth(1) == Some(':'),
            "Home directory should be an absolute path: {}",
            path
        );
    }

    // =========================================================================
    // calculate_recommended_concurrency tests
    // =========================================================================

    #[test]
    fn test_concurrency_minimum_bound() {
        // Even with very low resources, should return at least 1
        let result = calculate_recommended_concurrency(1, 100);
        assert_eq!(result, 1, "Minimum concurrency should be 1");
    }

    #[test]
    fn test_concurrency_maximum_bound() {
        // Even with very high resources, should cap at 8
        let result = calculate_recommended_concurrency(64, 64000);
        assert_eq!(result, 8, "Maximum concurrency should be 8");
    }

    #[test]
    fn test_concurrency_cpu_limited() {
        // 4 cores, plenty of memory -> CPU limited
        // CPU-based: ceil(4 * 0.75) = ceil(3.0) = 3
        // Memory-based: 8000 / 300 = 26
        // min(3, 26) = 3, clamped to [1,8] = 3
        let result = calculate_recommended_concurrency(4, 8000);
        assert_eq!(result, 3, "Should be CPU limited");
    }

    #[test]
    fn test_concurrency_memory_limited() {
        // 16 cores, low memory -> memory limited
        // CPU-based: ceil(16 * 0.75) = ceil(12.0) = 12
        // Memory-based: 600 / 300 = 2
        // min(12, 2) = 2, clamped to [1,8] = 2
        let result = calculate_recommended_concurrency(16, 600);
        assert_eq!(result, 2, "Should be memory limited");
    }

    #[test]
    fn test_concurrency_balanced() {
        // 8 cores, moderate memory
        // CPU-based: ceil(8 * 0.75) = ceil(6.0) = 6
        // Memory-based: 2400 / 300 = 8
        // min(6, 8) = 6, clamped to [1,8] = 6
        let result = calculate_recommended_concurrency(8, 2400);
        assert_eq!(result, 6, "Should be balanced");
    }

    #[test]
    fn test_concurrency_zero_memory() {
        // Edge case: zero memory reported
        let result = calculate_recommended_concurrency(4, 0);
        assert_eq!(result, 1, "Should return minimum with zero memory");
    }

    #[test]
    fn test_concurrency_single_core() {
        // Single core system
        // CPU-based: ceil(1 * 0.75) = ceil(0.75) = 1
        let result = calculate_recommended_concurrency(1, 8000);
        assert_eq!(result, 1, "Single core should return 1");
    }

    #[test]
    fn test_concurrency_two_cores() {
        // Two core system
        // CPU-based: ceil(2 * 0.75) = ceil(1.5) = 2
        let result = calculate_recommended_concurrency(2, 8000);
        assert_eq!(result, 2, "Two cores should return 2");
    }

    // =========================================================================
    // get_system_resources integration test
    // =========================================================================

    #[test]
    fn test_get_system_resources_returns_valid_data() {
        let resources = get_system_resources();

        // Should have at least 1 CPU core
        assert!(resources.cpu_cores >= 1, "Should have at least 1 CPU core");

        // Concurrency should be within bounds
        assert!(
            resources.recommended_concurrency >= 1 && resources.recommended_concurrency <= 8,
            "Recommended concurrency {} should be between 1 and 8",
            resources.recommended_concurrency
        );
    }

    // =========================================================================
    // backup_project_files_impl tests
    // =========================================================================

    #[test]
    fn test_backup_copies_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        std::fs::write(project.join("bank01.work"), b"bank1data").unwrap();
        std::fs::write(project.join("bank02.work"), b"bank2data").unwrap();

        let files = vec!["bank01.work".to_string(), "bank02.work".to_string()];
        let result = backup_project_files_impl(project.to_str().unwrap(), &files, "copy_bank");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "2 file(s) backed up");

        // Verify backup directory was created
        let backups_dir = project.join("backups");
        assert!(backups_dir.exists());
        let entries: Vec<_> = std::fs::read_dir(&backups_dir).unwrap().collect();
        assert_eq!(entries.len(), 1);

        // Verify files were copied with correct content
        let backup_subdir = entries[0].as_ref().unwrap().path();
        assert_eq!(
            std::fs::read(backup_subdir.join("bank01.work")).unwrap(),
            b"bank1data"
        );
        assert_eq!(
            std::fs::read(backup_subdir.join("bank02.work")).unwrap(),
            b"bank2data"
        );
    }

    #[test]
    fn test_backup_skips_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        std::fs::write(project.join("bank01.work"), b"data").unwrap();

        let files = vec![
            "bank01.work".to_string(),
            "bank99.work".to_string(), // does not exist
        ];
        let result = backup_project_files_impl(project.to_str().unwrap(), &files, "test");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "1 file(s) backed up");
    }

    #[test]
    fn test_backup_no_existing_files_skips_directory_creation() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();

        let files = vec!["nonexistent.work".to_string()];
        let result = backup_project_files_impl(project.to_str().unwrap(), &files, "test");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "No files to back up");
        assert!(!project.join("backups").exists());
    }

    #[test]
    fn test_backup_invalid_project_path() {
        let result = backup_project_files_impl(
            "/nonexistent/path/to/project",
            &["bank01.work".to_string()],
            "test",
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_backup_preserves_subdirectory_structure() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        std::fs::create_dir_all(project.join("AUDIO")).unwrap();
        std::fs::write(project.join("AUDIO/sample.wav"), b"wavdata").unwrap();

        let files = vec!["AUDIO/sample.wav".to_string()];
        let result =
            backup_project_files_impl(project.to_str().unwrap(), &files, "copy_sample_slots");
        assert!(result.is_ok());

        let backups_dir = project.join("backups");
        let entries: Vec<_> = std::fs::read_dir(&backups_dir).unwrap().collect();
        let backup_subdir = entries[0].as_ref().unwrap().path();
        assert_eq!(
            std::fs::read(backup_subdir.join("AUDIO/sample.wav")).unwrap(),
            b"wavdata"
        );
    }

    #[test]
    fn test_backup_directory_name_contains_label() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        std::fs::write(project.join("bank01.work"), b"data").unwrap();

        let files = vec!["bank01.work".to_string()];
        let _ = backup_project_files_impl(project.to_str().unwrap(), &files, "edit_mode");

        let backups_dir = project.join("backups");
        let entries: Vec<_> = std::fs::read_dir(&backups_dir).unwrap().collect();
        let dir_name = entries[0].as_ref().unwrap().file_name();
        let dir_name_str = dir_name.to_str().unwrap();
        assert!(
            dir_name_str.ends_with("_edit_mode"),
            "Backup dir name '{}' should end with '_edit_mode'",
            dir_name_str
        );
    }
}
