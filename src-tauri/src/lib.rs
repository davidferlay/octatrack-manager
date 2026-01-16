// Allow certain clippy lints that would require significant refactoring
#![allow(clippy::too_many_arguments)]

mod audio_pool;
mod device_detection;
mod project_reader;

use audio_pool::{
    cancel_transfer, copy_files_with_overwrite, copy_single_file_with_progress, create_directory,
    delete_files, get_parent_directory, list_directory, move_files, register_cancellation_token,
    remove_cancellation_token, rename_file as rename_file_impl, AudioFileInfo,
};
use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{
    are_projects_in_same_set,
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
    dest_part_index: Option<u8>, // None = all parts (0-3)
    dest_track_indices: Vec<u8>,
    mode: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // If part indices are None, copy to all 4 parts (1-to-1 mapping)
        match (source_part_index, dest_part_index) {
            (None, None) => {
                // Copy tracks across all 4 parts
                for part_idx in 0..4u8 {
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
                    )?;
                }
                Ok(())
            }
            (Some(src), Some(dst)) => {
                // Copy tracks for specific parts
                copy_tracks_impl(
                    &source_project,
                    source_bank_index,
                    src,
                    source_track_indices,
                    &dest_project,
                    dest_bank_index,
                    dst,
                    dest_track_indices,
                    &mode,
                )
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
) -> Result<(), String> {
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
            copy_sample_slots
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
}
