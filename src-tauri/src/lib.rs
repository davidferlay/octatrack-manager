mod device_detection;

use device_detection::{discover_devices, scan_directory, OctatrackLocation};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn scan_devices() -> Vec<OctatrackLocation> {
    discover_devices()
}

#[tauri::command]
fn scan_custom_directory(path: String) -> Vec<OctatrackLocation> {
    scan_directory(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, scan_devices, scan_custom_directory])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
