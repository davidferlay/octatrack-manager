mod device_detection;
mod project_reader;

use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{read_project_metadata, read_project_banks, ProjectMetadata, Bank};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            scan_devices,
            scan_custom_directory,
            load_project_metadata,
            load_project_banks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
