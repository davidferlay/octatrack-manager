mod device_detection;
mod project_reader;
mod audio_pool;

use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{
    read_project_metadata, read_project_banks, read_single_bank, get_existing_bank_indices,
    read_parts_data, save_parts_data, commit_part_data, commit_all_parts_data, reload_part_data,
    // Set and Audio Pool helpers
    is_project_in_set, are_projects_in_same_set, get_audio_pool_status as get_audio_pool_status_impl,
    create_audio_pool as create_audio_pool_impl,
    // Copy operations
    copy_bank as copy_bank_impl, copy_parts as copy_parts_impl, copy_patterns as copy_patterns_impl,
    copy_tracks as copy_tracks_impl, copy_sample_slots as copy_sample_slots_impl,
    // Types
    ProjectMetadata, Bank, PartData, PartsDataResponse, AudioPoolStatus,
};
use audio_pool::{list_directory, get_parent_directory, create_directory, copy_files_with_overwrite, copy_single_file_with_progress, move_files, delete_files, rename_file as rename_file_impl, AudioFileInfo, register_cancellation_token, cancel_transfer, remove_cancellation_token};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

#[derive(Clone, Serialize)]
struct CopyProgressEvent {
    file_path: String,
    transfer_id: String,
    stage: String,  // "converting", "writing", "copying", "complete", "cancelled"
    progress: f32,  // 0.0 to 1.0
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
    tauri::async_runtime::spawn_blocking(move || {
        read_project_metadata(&path)
    }).await.unwrap()
}

#[tauri::command]
async fn load_project_banks(path: String) -> Result<Vec<Bank>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        read_project_banks(&path)
    }).await.unwrap()
}

#[tauri::command]
async fn load_single_bank(path: String, bank_index: u8) -> Result<Option<Bank>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        read_single_bank(&path, bank_index)
    }).await.unwrap()
}

#[tauri::command]
async fn get_existing_banks(path: String) -> Vec<u8> {
    // Returns list of bank indices (0-15) that have existing bank files
    tauri::async_runtime::spawn_blocking(move || {
        get_existing_bank_indices(&path)
    }).await.unwrap()
}

#[tauri::command]
async fn load_parts_data(path: String, bank_id: String) -> Result<PartsDataResponse, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        read_parts_data(&path, &bank_id)
    }).await.unwrap()
}

#[tauri::command]
async fn save_parts(path: String, bank_id: String, parts_data: Vec<PartData>) -> Result<(), String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        save_parts_data(&path, &bank_id, parts_data)
    }).await.unwrap()
}

#[tauri::command]
async fn commit_part(path: String, bank_id: String, part_id: u8) -> Result<(), String> {
    // Commit a part: copy parts.unsaved to parts.saved (like Octatrack's "SAVE" command)
    tauri::async_runtime::spawn_blocking(move || {
        commit_part_data(&path, &bank_id, part_id)
    }).await.unwrap()
}

#[tauri::command]
async fn commit_all_parts(path: String, bank_id: String) -> Result<(), String> {
    // Commit all parts: copy all parts.unsaved to parts.saved (like Octatrack's "SAVE ALL" command)
    tauri::async_runtime::spawn_blocking(move || {
        commit_all_parts_data(&path, &bank_id)
    }).await.unwrap()
}

#[tauri::command]
async fn reload_part(path: String, bank_id: String, part_id: u8) -> Result<PartData, String> {
    // Reload a part: copy parts.saved back to parts.unsaved (like Octatrack's "RELOAD" command)
    tauri::async_runtime::spawn_blocking(move || {
        reload_part_data(&path, &bank_id, part_id)
    }).await.unwrap()
}

#[tauri::command]
async fn list_audio_directory(path: String) -> Result<Vec<AudioFileInfo>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        list_directory(&path)
    }).await.unwrap()
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
async fn copy_audio_files(source_paths: Vec<String>, destination_dir: String, overwrite: Option<bool>) -> Result<Vec<String>, String> {
    let should_overwrite = overwrite.unwrap_or(false);
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        copy_files_with_overwrite(source_paths, &destination_dir, should_overwrite)
    }).await.unwrap()
}

#[tauri::command]
async fn copy_audio_file_with_progress(
    app: AppHandle,
    source_path: String,
    destination_dir: String,
    transfer_id: String,
    overwrite: Option<bool>
) -> Result<String, String> {
    let should_overwrite = overwrite.unwrap_or(false);
    let source_path_clone = source_path.clone();
    let transfer_id_for_callback = transfer_id.clone();
    let transfer_id_for_cleanup = transfer_id.clone();

    // Register cancellation token for this transfer
    let cancel_token = register_cancellation_token(&transfer_id);

    // Create progress callback that also checks for cancellation
    let progress_callback = move |stage: &str, progress: f32| {
        let _ = app.emit("copy-progress", CopyProgressEvent {
            file_path: source_path_clone.clone(),
            transfer_id: transfer_id_for_callback.clone(),
            stage: stage.to_string(),
            progress,
        });
    };

    // Run on a blocking thread pool
    let result = tauri::async_runtime::spawn_blocking(move || {
        copy_single_file_with_progress(&source_path, &destination_dir, should_overwrite, progress_callback, Some(cancel_token))
    }).await.unwrap();

    // Clean up cancellation token
    remove_cancellation_token(&transfer_id_for_cleanup);

    result
}

#[tauri::command]
fn cancel_audio_transfer(transfer_id: String) -> bool {
    cancel_transfer(&transfer_id)
}

#[tauri::command]
async fn move_audio_files(source_paths: Vec<String>, destination_dir: String) -> Result<Vec<String>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        move_files(source_paths, &destination_dir)
    }).await.unwrap()
}

#[tauri::command]
async fn delete_audio_files(file_paths: Vec<String>) -> Result<usize, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        delete_files(file_paths)
    }).await.unwrap()
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

#[tauri::command]
fn get_system_resources() -> SystemResources {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_cores = sys.cpus().len();
    let available_memory_mb = sys.available_memory() / (1024 * 1024);

    // Calculate recommended concurrency based on:
    // - CPU cores (primary factor)
    // - Available memory (each conversion can use ~200-500MB)
    // Leave at least 1 core for the system and UI
    let cpu_based = (cpu_cores as f64 * 0.75).ceil() as usize;

    // Memory-based limit: assume ~300MB per conversion task
    let memory_based = (available_memory_mb / 300) as usize;

    // Take the minimum of both constraints, with bounds [1, 8]
    let recommended = cpu_based.min(memory_based).max(1).min(8);

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
    tauri::async_runtime::spawn_blocking(move || {
        is_project_in_set(&project_path)
    }).await.unwrap()
}

#[tauri::command]
async fn check_projects_in_same_set(project1: String, project2: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        are_projects_in_same_set(&project1, &project2)
    }).await.unwrap()
}

#[tauri::command]
async fn get_audio_pool_status(project_path: String) -> Result<AudioPoolStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_audio_pool_status_impl(&project_path)
    }).await.unwrap()
}

#[tauri::command]
async fn create_audio_pool(project_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_audio_pool_impl(&project_path)
    }).await.unwrap()
}

// ============================================================================
// Tools Tab - Copy Operations Commands
// ============================================================================

#[tauri::command]
async fn copy_bank(
    source_project: String,
    source_bank_index: u8,
    dest_project: String,
    dest_bank_index: u8,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_bank_impl(&source_project, source_bank_index, &dest_project, dest_bank_index)
    }).await.unwrap()
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
        copy_parts_impl(&source_project, source_bank_index, source_part_indices, &dest_project, dest_bank_index, dest_part_indices)
    }).await.unwrap()
}

#[tauri::command]
async fn copy_patterns(
    source_project: String,
    source_bank_index: u8,
    source_pattern_indices: Vec<u8>,
    dest_project: String,
    dest_bank_index: u8,
    dest_pattern_start: u8,
    part_assignment_mode: String,
    dest_part: Option<u8>,
    track_mode: String,
    track_indices: Option<Vec<u8>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_patterns_impl(
            &source_project, source_bank_index, source_pattern_indices,
            &dest_project, dest_bank_index, dest_pattern_start,
            &part_assignment_mode, dest_part, &track_mode, track_indices
        )
    }).await.unwrap()
}

#[tauri::command]
async fn copy_tracks(
    source_project: String,
    source_bank_index: u8,
    source_part_index: u8,
    source_track_indices: Vec<u8>,
    dest_project: String,
    dest_bank_index: u8,
    dest_part_index: u8,
    dest_track_indices: Vec<u8>,
    mode: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_tracks_impl(
            &source_project, source_bank_index, source_part_index, source_track_indices,
            &dest_project, dest_bank_index, dest_part_index, dest_track_indices, &mode
        )
    }).await.unwrap()
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
            &source_project, &dest_project, &slot_type,
            source_indices, dest_indices, &audio_mode, include_editor_settings
        )
    }).await.unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
