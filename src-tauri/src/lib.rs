mod device_detection;
mod project_reader;
mod audio_pool;

use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{read_project_metadata, read_project_banks, read_parts_data, ProjectMetadata, Bank, PartData};
use audio_pool::{list_directory, get_parent_directory, create_directory, copy_files, move_files, delete_files, AudioFileInfo};

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
async fn load_parts_data(path: String, bank_id: String) -> Result<Vec<PartData>, String> {
    // Run on a blocking thread pool to avoid blocking the main event loop
    tauri::async_runtime::spawn_blocking(move || {
        read_parts_data(&path, &bank_id)
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
async fn copy_audio_files(source_paths: Vec<String>, destination_dir: String) -> Result<Vec<String>, String> {
    eprintln!("[COMMAND] copy_audio_files invoked");
    eprintln!("[COMMAND] source_paths: {:?}", source_paths);
    eprintln!("[COMMAND] destination_dir: {}", destination_dir);

    // Run on a blocking thread pool to avoid blocking the main event loop
    eprintln!("[COMMAND] Spawning blocking task");
    let result = tauri::async_runtime::spawn_blocking(move || {
        eprintln!("[COMMAND] Inside blocking task, calling copy_files");
        let res = copy_files(source_paths, &destination_dir);
        eprintln!("[COMMAND] copy_files returned: {:?}", res.is_ok());
        res
    }).await.unwrap();

    eprintln!("[COMMAND] Blocking task completed, returning result");
    result
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            scan_devices,
            scan_custom_directory,
            load_project_metadata,
            load_project_banks,
            load_parts_data,
            list_audio_directory,
            navigate_to_parent,
            create_new_directory,
            copy_audio_files,
            move_audio_files,
            delete_audio_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
