mod device_detection;
mod project_reader;
mod audio_pool;

use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{read_project_metadata, read_project_banks, read_parts_data, save_parts_data, commit_part_data, commit_all_parts_data, reload_part_data, ProjectMetadata, Bank, PartData, PartsDataResponse};
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
            get_system_resources
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
