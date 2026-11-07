// Allow certain clippy lints that would require significant refactoring
#![allow(clippy::too_many_arguments)]

mod audio_pool;
mod device_detection;
mod ot_sidecar;
mod part_locks;
pub mod project_manager;
mod project_reader;
mod purge;
mod slot_reorganise;
mod ui_zoom;
mod window_size;
mod write_history;

use audio_pool::{
    cancel_transfer, collect_audio_files_recursive, copy_audio_files_or_use_existing,
    copy_files_with_overwrite, copy_single_file_with_progress, create_directory, delete_files,
    get_parent_directory, list_directory, move_files, register_cancellation_token,
    remove_cancellation_token, rename_file as rename_file_impl, AudioFileInfo,
};
use device_detection::{discover_devices, scan_directory, ScanResult};
use project_reader::{
    are_projects_in_same_set,
    assign_samples_to_slots as assign_samples_to_slots_impl,
    check_missing_source_files as check_missing_source_files_impl,
    commit_all_parts_data,
    commit_part_data,
    compute_pool_usage as compute_pool_usage_data,
    compute_sample_usage as compute_sample_usage_data,
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
    list_set_projects as list_set_projects_data,
    read_parts_data,
    read_project_banks,
    read_project_metadata,
    read_scenes,
    read_single_bank,
    reload_part_data,
    save_memory_settings_data,
    save_parts_data,
    // Slot assignment types
    AssignSamplesResult,
    AudioPoolStatus,
    Bank,
    // Types
    MemorySettings,
    PartData,
    PartsDataResponse,
    PoolUsageEntry,
    ProjectMetadata,
    SceneTrackLocks,
    ScenesResponse,
    SetProjectInfo,
    SlotAssignment,
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

// Both scans walk the filesystem, so they run on the blocking pool like
// `load_project_metadata`. A non-async `#[tauri::command]` is `ExecutionContext::Blocking`:
// the body runs inline on the thread handling the IPC message, i.e. the main thread, so the
// window stops repainting for the whole scan.
//
// The empty-result fallbacks only fire on a JoinError, i.e. the scan panicked. Both scans
// swallow every filesystem error already (`if let Ok` / `filter_map`), so there is nothing
// left to panic on - hence no error channel here. Give them one if that stops being true.
#[tauri::command]
async fn scan_devices() -> ScanResult {
    tauri::async_runtime::spawn_blocking(discover_devices)
        .await
        .unwrap_or_else(|_| ScanResult {
            locations: Vec::new(),
            standalone_projects: Vec::new(),
        })
}

#[tauri::command]
async fn scan_custom_directory(path: String) -> ScanResult {
    tauri::async_runtime::spawn_blocking(move || scan_directory(&path))
        .await
        .unwrap_or_else(|_| ScanResult {
            locations: Vec::new(),
            standalone_projects: Vec::new(),
        })
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
async fn compute_sample_usage(
    path: String,
) -> Result<crate::project_reader::SampleSlotUsage, String> {
    // Scans all 16 bank files; run on a blocking thread pool.
    tauri::async_runtime::spawn_blocking(move || compute_sample_usage_data(&path))
        .await
        .unwrap()
}

#[tauri::command]
async fn get_pool_usage(
    pool_path: String,
) -> Result<std::collections::HashMap<String, Vec<PoolUsageEntry>>, String> {
    // Scans every project in the set; run on a blocking thread pool.
    tauri::async_runtime::spawn_blocking(move || compute_pool_usage_data(&pool_path))
        .await
        .unwrap()
}

#[tauri::command]
async fn list_set_projects(pool_path: String) -> Result<Vec<SetProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_set_projects_data(&pool_path))
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
async fn load_scenes(path: String, bank_id: String, part_id: u8) -> Result<ScenesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || read_scenes(&path, &bank_id, part_id))
        .await
        .unwrap()
}

/// Every Part-writing command below takes `slot_files_lock` for its whole run, because
/// each one reads the bank, changes it and writes it back: two running side by side (a
/// scene edit and a crossfader move, say) would each write back a bank missing the
/// other's change. The editors queue several writes in the same moment, so this happens.
/// The guard is not re-entrant: none of these calls another.
///
/// Snapshots a bank before a write, so the write can be taken back.
///
/// Both copies travel together: the device keeps `.work` as what it is playing and
/// `.strd` as what was last saved to the card, and a half-undone bank would be a bank
/// whose two copies disagree about a write that no longer happened.
///
/// The locks file stays out: which values Reload keeps is not part of the history, and
/// an Undo re-checks them against the bank it puts back (`prune_all_locks`).
fn make_bank_undoable(path: &str, bank_id: &str, label: &str) -> Result<(), String> {
    let work = project_reader::bank_file_path(path, bank_id)?;
    let stored = work.with_extension("strd");
    let mut files = vec![work];
    if stored.exists() {
        files.push(stored);
    }
    write_history::record(path, label, &files)
}

/// After an Undo or Redo: the kept values are not part of the history, so the files it
/// put back may have made some of them match their saved value again.
fn prune_all_locks(path: &str) {
    if let Err(e) = part_locks::prune_all(path) {
        eprintln!("Could not prune part locks: {}", e);
    }
}

/// Drops the locks a write has made pointless. The write itself succeeded, so a failure
/// here is logged rather than returned: a stale lock is filtered out on read anyway.
fn prune_locks(path: &str, bank_id: &str) {
    if let Err(e) = part_locks::prune(path, bank_id) {
        eprintln!("Could not prune part locks: {}", e);
    }
}

fn save_scene_impl(
    path: &str,
    bank_id: &str,
    part_id: u8,
    scene_id: u8,
    tracks: Vec<SceneTrackLocks>,
) -> Result<(), String> {
    let _files = slot_files_lock();
    make_bank_undoable(path, bank_id, &format!("Change scene {}", scene_id + 1))?;
    project_reader::save_scene(path, bank_id, part_id, scene_id, tracks)?;
    prune_locks(path, bank_id);
    Ok(())
}

fn save_crossfader_impl(
    path: &str,
    bank_id: &str,
    part_id: u8,
    scene_a: u8,
    scene_b: u8,
) -> Result<(), String> {
    let _files = slot_files_lock();
    make_bank_undoable(path, bank_id, "Move a crossfader end")?;
    project_reader::save_crossfader(path, bank_id, part_id, scene_a, scene_b)?;
    prune_locks(path, bank_id);
    Ok(())
}

fn save_parts_impl(path: &str, bank_id: &str, parts_data: Vec<PartData>) -> Result<(), String> {
    let _files = slot_files_lock();
    make_bank_undoable(path, bank_id, "Change a part")?;
    save_parts_data(path, bank_id, parts_data)?;
    prune_locks(path, bank_id);
    Ok(())
}

fn commit_part_impl(path: &str, bank_id: &str, part_id: u8) -> Result<(), String> {
    let _files = slot_files_lock();
    make_bank_undoable(path, bank_id, &format!("Save part {}", part_id + 1))?;
    commit_part_data(path, bank_id, part_id)?;
    prune_locks(path, bank_id);
    Ok(())
}

fn commit_all_parts_impl(path: &str, bank_id: &str) -> Result<(), String> {
    let _files = slot_files_lock();
    make_bank_undoable(path, bank_id, "Save all parts")?;
    commit_all_parts_data(path, bank_id)?;
    prune_locks(path, bank_id);
    Ok(())
}

/// Reload puts the Saved values back, except the locked ones (R5): one write, one entry.
fn reload_part_impl(path: &str, bank_id: &str, part_id: u8) -> Result<PartData, String> {
    let _files = slot_files_lock();
    let keep = part_locks::effective(path, bank_id)?
        .into_iter()
        .nth(part_id as usize)
        .unwrap_or_default();
    make_bank_undoable(path, bank_id, &format!("Reload part {}", part_id + 1))?;
    let part = reload_part_data(path, bank_id, part_id, &keep)?;
    prune_locks(path, bank_id);
    Ok(part)
}

fn read_part_locks_impl(path: &str, bank_id: &str) -> Result<Vec<Vec<String>>, String> {
    part_locks::effective(path, bank_id)
}

fn set_part_locks_impl(
    path: &str,
    bank_id: &str,
    part_id: u8,
    add: &[String],
    remove: &[String],
) -> Result<Vec<Vec<String>>, String> {
    // Not an Undo step: which values Reload keeps is a choice about the next Reload,
    // not a change to the Part
    let _files = slot_files_lock();
    part_locks::set(path, bank_id, part_id, add, remove)
}

fn revert_part_values_impl(
    path: &str,
    bank_id: &str,
    part_id: u8,
    paths: &[String],
    label: &str,
) -> Result<PartData, String> {
    let _files = slot_files_lock();
    make_bank_undoable(path, bank_id, label)?;
    let part = project_reader::revert_part_values(path, bank_id, part_id, paths)?;
    prune_locks(path, bank_id);
    Ok(part)
}

/// Snapshots the project file before a write, for the settings that live there.
fn make_project_undoable(path: &str, label: &str) -> Result<(), String> {
    let file = project_reader::project_file_path(path)?;
    write_history::record(path, label, &[file])
}

/// Snapshots the files a sample slot operation writes.
///
/// A slot carries its sample in the project file and its trim window in the markers
/// file, and assigning one writes both. Taking back only half would leave a slot
/// pointing at one sample with another's trim window, which plays as silence.
fn make_slots_undoable(path: &str, label: &str) -> Result<(), String> {
    let dir = std::path::Path::new(path);
    let mut files = vec![project_reader::project_file_path(path)?];
    for name in ["markers.work", "markers.strd"] {
        let candidate = dir.join(name);
        if candidate.exists() {
            files.push(candidate);
            break;
        }
    }
    write_history::record(path, label, &files)
}

#[tauri::command]
async fn undo_write(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _files = slot_files_lock();
        let undone = write_history::undo(&path);
        prune_all_locks(&path);
        undone
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn redo_write(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _files = slot_files_lock();
        let redone = write_history::redo(&path);
        prune_all_locks(&path);
        redone
    })
    .await
    .unwrap()
}

#[tauri::command]
fn write_history_state(path: String) -> write_history::HistoryState {
    write_history::state(&path)
}

/// Drops a project's history when its files have changed underneath us - a Tools
/// operation or a refresh - because the snapshots no longer describe what is there.
#[tauri::command]
fn forget_write_history(path: String) {
    write_history::forget(&path)
}

#[tauri::command]
async fn save_scene(
    path: String,
    bank_id: String,
    part_id: u8,
    scene_id: u8,
    tracks: Vec<SceneTrackLocks>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_scene_impl(&path, &bank_id, part_id, scene_id, tracks)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn save_crossfader(
    path: String,
    bank_id: String,
    part_id: u8,
    scene_a: u8,
    scene_b: u8,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_crossfader_impl(&path, &bank_id, part_id, scene_a, scene_b)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn load_bank_scenes(
    path: String,
    bank_id: String,
) -> Result<Vec<project_reader::ScenesResponse>, String> {
    tauri::async_runtime::spawn_blocking(move || project_reader::read_bank_scenes(&path, &bank_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn save_scene_mute(path: String, end: String, muted: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let what = if muted { "Mute" } else { "Unmute" };
        make_project_undoable(&path, &format!("{} the {} end", what, end))?;
        project_reader::save_scene_mute(&path, &end, muted)
    })
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
    tauri::async_runtime::spawn_blocking(move || save_parts_impl(&path, &bank_id, parts_data))
        .await
        .unwrap()
}

#[tauri::command]
async fn save_memory_settings(path: String, settings: MemorySettings) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_project_undoable(&path, "Change the memory settings")?;
        save_memory_settings_data(&path, settings)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn assign_samples_to_slots(
    path: String,
    slot_type: String,
    assignments: Vec<SlotAssignment>,
) -> Result<AssignSamplesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_slots_undoable(&path, &format!("Assign {} sample slots", assignments.len()))?;
        assign_samples_to_slots_impl(&path, &slot_type, assignments)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn clear_sample_slots(
    path: String,
    slot_type: String,
    slot_indices: Vec<u16>,
) -> Result<AssignSamplesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_slots_undoable(&path, &format!("Clear {} sample slots", slot_indices.len()))?;
        project_reader::clear_sample_slots(&path, &slot_type, slot_indices)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn clear_sample_keep_attributes(
    path: String,
    slot_type: String,
    slot_indices: Vec<u16>,
) -> Result<AssignSamplesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_slots_undoable(&path, &format!("Clear {} samples", slot_indices.len()))?;
        project_reader::clear_sample_keep_attributes(&path, &slot_type, slot_indices)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn reset_slot_attributes(
    path: String,
    slot_type: String,
    slot_indices: Vec<u16>,
) -> Result<AssignSamplesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_slots_undoable(
            &path,
            &format!("Reset {} slot attributes", slot_indices.len()),
        )?;
        project_reader::reset_slot_attributes(&path, &slot_type, slot_indices)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn commit_part(path: String, bank_id: String, part_id: u8) -> Result<(), String> {
    // Commit a part: copy parts.unsaved to parts.saved (like Octatrack's "SAVE" command)
    tauri::async_runtime::spawn_blocking(move || commit_part_impl(&path, &bank_id, part_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn commit_all_parts(path: String, bank_id: String) -> Result<(), String> {
    // Commit all parts: copy all parts.unsaved to parts.saved (like Octatrack's "SAVE ALL" command)
    tauri::async_runtime::spawn_blocking(move || commit_all_parts_impl(&path, &bank_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn reload_part(path: String, bank_id: String, part_id: u8) -> Result<PartData, String> {
    // Reload a part: copy parts.saved back to parts.unsaved (like Octatrack's "RELOAD" command)
    tauri::async_runtime::spawn_blocking(move || reload_part_impl(&path, &bank_id, part_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn read_part_locks(path: String, bank_id: String) -> Result<Vec<Vec<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || read_part_locks_impl(&path, &bank_id))
        .await
        .unwrap()
}

#[tauri::command]
async fn set_part_locks(
    path: String,
    bank_id: String,
    part_id: u8,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<Vec<Vec<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_part_locks_impl(&path, &bank_id, part_id, &add, &remove)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn revert_part_values(
    path: String,
    bank_id: String,
    part_id: u8,
    paths: Vec<String>,
    label: String,
) -> Result<PartData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        revert_part_values_impl(&path, &bank_id, part_id, &paths, &label)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn read_part_copies(
    path: String,
    bank_id: String,
    part_id: u8,
) -> Result<project_reader::PartCopies, String> {
    // Both copies of a Part, so the editors can show what Save and Reload would overwrite
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::read_part_copies(&path, &bank_id, part_id)
    })
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
async fn list_audio_files_recursive(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || collect_audio_files_recursive(&path))
        .await
        .unwrap()
}

#[tauri::command]
async fn list_audio_directory_recursive(path: String) -> Result<Vec<AudioFileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || audio_pool::list_directory_recursive(&path))
        .await
        .unwrap()
}

/// Audio metadata (bit depth, sample rate, size) for an explicit list of files.
#[tauri::command]
async fn get_audio_files_info(paths: Vec<String>) -> Result<Vec<AudioFileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(audio_pool::files_info(&paths)))
        .await
        .unwrap()
}

/// Expand a mixed list of dropped/dragged paths (files + directories) into a flat list of
/// audio files, recursing into directories. Keeps copy/assign flows from choking on folders.
#[tauri::command]
async fn expand_audio_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || audio_pool::expand_audio_paths(&paths))
        .await
        .unwrap()
}

/// Inspect audio files (OT PCM size + compatibility) so the UI can validate slot drops.
#[tauri::command]
async fn inspect_audio_files(
    paths: Vec<String>,
) -> Result<Vec<project_reader::AudioFileCheck>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| project_reader::inspect_audio_file(std::path::Path::new(p)))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
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
fn resolve_default_purge_destination(guaranteed_fallback: String) -> String {
    purge::resolve_default_purge_destination(&guaranteed_fallback)
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
async fn copy_audio_files_to_project(
    source_paths: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_audio_files_or_use_existing(source_paths, &destination_dir)
    })
    .await
    .unwrap()
}

/// One audio file a project import wrote: where it came from and where it landed.
#[derive(serde::Deserialize)]
struct ImportedAudio {
    source: String,
    dest: String,
}

/// Bring each imported file's `.ot` along next to it, in a project or in the Audio Pool, after
/// the import wrote the audio and before any slot is assigned (which reads the `.ot`). One
/// entry per file, None where there was no `.ot` to handle.
#[tauri::command]
async fn carry_ot_sidecars(imported: Vec<ImportedAudio>) -> Vec<Option<ot_sidecar::OtCarry>> {
    tauri::async_runtime::spawn_blocking(move || {
        imported
            .iter()
            .map(|f| {
                let dest = std::path::Path::new(&f.dest);
                match ot_sidecar::carry(std::path::Path::new(&f.source), dest) {
                    Ok(carried) => carried,
                    // A failed backup or write is reported like a refused .ot: the audio
                    // is imported either way
                    Err(why) => Some(ot_sidecar::OtCarry {
                        audio: dest
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        ot: String::new(),
                        outcome: ot_sidecar::OtOutcome::Refused,
                        from_rate: None,
                        reason: Some(why),
                        replaced: false,
                        clamped: false,
                    }),
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
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

#[derive(Clone, Debug, Serialize)]
struct RenameResult {
    new_path: String,
    projects_updated: Vec<String>,
    slots_updated: u32,
}

/// Rename a file or folder. When `pool_path` is given and the target is a file,
/// every project of that Audio Pool's Set whose sample slots point at it is
/// repointed onto the new name (each rewritten project file is backed up first)
/// - a bare rename would otherwise silently break those slots.
///
/// Folders are renamed only: stored slot paths embed the folder name in their
/// directory part, which `update_pool_references` (basename-only) does not
/// rewrite.
#[tauri::command]
fn rename_file(
    old_path: String,
    new_name: String,
    pool_path: Option<String>,
) -> Result<RenameResult, String> {
    let was_file = std::path::Path::new(&old_path).is_file();
    let new_path = rename_file_impl(&old_path, &new_name)?;

    let refs = match pool_path {
        Some(pool) if was_file => {
            project_reader::update_pool_references(&pool, &[(old_path.clone(), new_path.clone())])?
        }
        _ => project_reader::PoolReferenceUpdate {
            projects_updated: vec![],
            slots_updated: 0,
        },
    };

    Ok(RenameResult {
        new_path,
        projects_updated: refs.projects_updated,
        slots_updated: refs.slots_updated,
    })
}

#[tauri::command]
fn delete_file(path: String) -> Result<usize, String> {
    delete_files(vec![path])
}

#[tauri::command]
fn open_in_file_manager(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open file manager: {}", e))
}

/// Reveal a path in the OS file explorer. Resolves `..` (sample paths are stored relative
/// to the project dir), then opens a directory's contents or highlights a file in its folder.
#[tauri::command]
fn reveal_in_file_manager(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = std::path::Path::new(&path);
    let canonical = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if canonical.is_dir() {
        app.opener()
            .open_path(canonical.to_string_lossy().to_string(), None::<&str>)
            .map_err(|e| format!("Failed to open in file manager: {}", e))
    } else {
        app.opener()
            .reveal_item_in_dir(&canonical)
            .map_err(|e| format!("Failed to reveal in file manager: {}", e))
    }
}

/// Read an audio file's raw bytes so the frontend can play it via a Blob URL.
/// On Linux webkit2gtk the `<audio>` element loads through GStreamer, which bypasses
/// the asset:// custom-scheme handler, so we hand the bytes to the webview directly.
/// Canonicalize to resolve `..` (slot paths are stored relative to the project dir).
#[tauri::command]
fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(read_audio_bytes(&path)?))
}

/// Read + canonicalize an audio file's bytes. Extracted from the command so it is
/// testable without constructing a `tauri::ipc::Response`.
fn read_audio_bytes(path: &str) -> Result<Vec<u8>, String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    std::fs::read(&canonical).map_err(|e| e.to_string())
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

/// Whether a project still sits at this path - a directory holding a project file.
///
/// Bookmarks keep a path across launches; this is how the home page tells a project
/// that was moved or deleted outside the app from one that is simply not in the last
/// scan (a collapsed group, a filtered search).
#[tauri::command]
async fn project_exists(project_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(is_project_dir(&project_path)))
        .await
        .unwrap()
}

/// Whether `path` is a directory still holding an Octatrack project.
///
/// A bookmark is dropped when this says no, so it asks for a project file rather
/// than just a directory: an empty folder left behind by a move is not a project,
/// and keeping a bookmark on it would point the user at nothing.
fn is_project_dir(path: &str) -> bool {
    let dir = std::path::Path::new(path);
    dir.is_dir() && (dir.join("project.work").exists() || dir.join("project.strd").exists())
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
    copy_samples: Option<bool>,
    sample_scope: Option<String>,
    audio_mode: Option<String>,
    slot_placement: Option<String>,
    copy_attributes: Option<bool>,
    attribute_selection: Option<Vec<String>>,
) -> Result<project_reader::CopyBankResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_bank_impl(
            &source_project,
            source_bank_index,
            &dest_project,
            &dest_bank_indices,
            copy_samples.unwrap_or(false),
            &sample_scope.unwrap_or_default(),
            &audio_mode.unwrap_or_default(),
            &slot_placement.unwrap_or_else(|| "keep_position".to_string()),
            copy_attributes.unwrap_or(false),
            &attribute_selection.unwrap_or_default(),
        )
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn validate_bank_sample_slots(
    source_project: String,
    source_bank_indices: Vec<u8>,
    dest_project: String,
    sample_scope: String,
    slot_placement: String,
) -> Result<project_reader::SlotValidationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::validate_bank_sample_slots(
            &source_project,
            &source_bank_indices,
            &dest_project,
            &sample_scope,
            &slot_placement,
        )
    })
    .await
    .unwrap()
}

/// Reset whole banks of the loaded project to the factory-default state.
#[tauri::command]
async fn clear_banks(project: String, bank_indices: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::clear_banks(&project, &bank_indices)
    })
    .await
    .unwrap()
}

/// Reset Parts of one bank (name included) to the factory default.
#[tauri::command]
async fn clear_parts(project: String, bank_index: u8, part_indices: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::clear_parts(&project, bank_index, &part_indices)
    })
    .await
    .unwrap()
}

/// Empty Patterns of one bank (all trigs, default scale/chain, Part 1).
#[tauri::command]
async fn clear_patterns(
    project: String,
    bank_index: u8,
    pattern_indices: Vec<u8>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::clear_patterns(&project, bank_index, &pattern_indices)
    })
    .await
    .unwrap()
}

/// Clear individual tracks: sound design ("part_params"), sequencer data
/// ("pattern_triggers") or "both". `pattern_indices` = None means all 16.
#[tauri::command]
async fn clear_tracks(
    project: String,
    bank_index: u8,
    part_index: u8,
    track_indices: Vec<u8>,
    mode: String,
    pattern_indices: Option<Vec<u8>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::clear_tracks(
            &project,
            bank_index,
            part_index,
            &track_indices,
            &mode,
            pattern_indices,
        )
    })
    .await
    .unwrap()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn copy_scenes(
    source_project: String,
    source_bank_index: u8,
    source_part_index: u8,
    source_scene_indices: Vec<u8>,
    dest_project: String,
    dest_bank_index: u8,
    dest_part_indices: Vec<u8>,
    dest_scene_indices: Vec<u8>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_reader::copy_scenes(
            &source_project,
            source_bank_index,
            source_part_index,
            source_scene_indices,
            &dest_project,
            dest_bank_index,
            dest_part_indices,
            dest_scene_indices,
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
    copy_assignments: bool,
    audio_mode: String,
    copy_attributes: bool,
    attribute_selection: Vec<String>,
) -> Result<project_reader::CopySlotsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_sample_slots_impl(
            &source_project,
            &dest_project,
            &slot_type,
            source_indices,
            dest_indices,
            copy_assignments,
            &audio_mode,
            copy_attributes,
            attribute_selection,
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

/// Backs up exactly `files` before an operation rewrites them, and fails if any copy fails.
///
/// `backup_project_files_impl` shrugs off a failed copy, which is fine for a courtesy backup
/// but not for a slot move: that one rewrites the project, markers and banks together and the
/// backup is the only way back if the app dies halfway. The folder is
/// `backups/YYYY-MM-DD_HH-MM-SS_<label>/` with each file at its path relative to the project;
/// when that name is taken (two moves in one second) `_2`, `_3`... is appended rather than
/// mixing two backups in one folder.
fn backup_files_strict(
    project_path: &str,
    files: &[std::path::PathBuf],
    label: &str,
) -> Result<std::path::PathBuf, String> {
    use std::path::Path;

    let project_dir = Path::new(project_path);
    let backups = project_dir.join("backups");
    std::fs::create_dir_all(&backups)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    let stem = format!(
        "{}_{}",
        chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"),
        label
    );
    // create_dir (not create_dir_all) fails when the folder exists, so a taken name is never reused.
    let mut attempt = 1u32;
    let backup_dir = loop {
        let name = if attempt == 1 {
            stem.clone()
        } else {
            format!("{}_{}", stem, attempt)
        };
        let candidate = backups.join(name);
        match std::fs::create_dir(&candidate) {
            Ok(()) => break candidate,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => attempt += 1,
            Err(e) => return Err(format!("Failed to create backup directory: {}", e)),
        }
    };

    for file in files {
        let relative = file.strip_prefix(project_dir).map_err(|_| {
            format!(
                "Cannot back up {}: it is outside the project",
                file.display()
            )
        })?;
        let dest = backup_dir.join(relative);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }
        std::fs::copy(file, &dest)
            .map_err(|e| format!("Failed to back up {}: {}", file.display(), e))?;
    }
    Ok(backup_dir)
}

/// Backs up and snapshots the files a slot reorganisation is about to write, so the move can
/// be undone from the app and, failing that, restored from the backup folder.
fn slot_move_before_write(
    path: &str,
    backup_label: &str,
    undo_label: &str,
    paths: &[std::path::PathBuf],
) -> Result<(), String> {
    backup_files_strict(path, paths, backup_label)?;
    write_history::record(path, undo_label, paths)
}

/// Lets one slot move, sort, undo or redo run at a time, across the whole app.
///
/// Tauri runs commands side by side, each of these on its own blocking thread. A move reads
/// the project and every bank, then writes them: a second move reading in between would remap
/// banks the first had already remapped, and its undo snapshot would hold a half-written
/// project. Undo and redo rewrite the same files, so they wait their turn too. Taken on the
/// blocking thread and dropped there, never held across an await.
fn slot_files_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    // It guards no data, so a holder that panicked leaves nothing behind to distrust
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn parse_pool(slot_type: &str) -> Result<slot_reorganise::Pool, String> {
    slot_reorganise::Pool::parse(slot_type)
        .ok_or_else(|| format!("Unknown slot type: {} (expected Flex or Static)", slot_type))
}

fn pool_word(pool: slot_reorganise::Pool) -> &'static str {
    match pool {
        slot_reorganise::Pool::Flex => "Flex",
        slot_reorganise::Pool::Static => "Static",
    }
}

/// The Undo label for a move: a swap names both slots, anything else counts the slots that
/// changed number on their own (empty or repeated sources move nothing; pushed slots are not
/// what the user moved).
fn move_words(pool: slot_reorganise::Pool, plan: &slot_reorganise::SlotPlan) -> String {
    let prefix = &pool_word(pool)[..1];
    if let Some((a, b)) = plan.swapped {
        return format!("Swap {prefix}{a:03} and {prefix}{b:03}");
    }
    let moved = plan
        .moves
        .iter()
        .filter(|m| !plan.pushed.contains(m))
        .count();
    let plural = if moved == 1 { "" } else { "s" };
    format!("Move {moved} {} slot{plural}", pool_word(pool))
}

/// Plans and applies a move in one call, so the project cannot change in between.
fn move_slots_impl(
    path: &str,
    slot_type: &str,
    sources: Vec<u8>,
    target: u8,
) -> Result<slot_reorganise::SlotMoveReport, String> {
    let _files = slot_files_lock();
    let pool = parse_pool(slot_type)?;
    let taken = slot_reorganise::taken_slots(path, pool)?;
    let plan = slot_reorganise::plan_move(&taken, &sources, target)?;
    let label = format!("move_{}_slots", pool.tag().to_lowercase());
    let words = move_words(pool, &plan);
    slot_reorganise::apply_plan(path, pool, &plan, |paths| {
        slot_move_before_write(path, &label, &words, paths)
    })
}

/// Plans and applies a sort in one call, so the project cannot change in between.
fn sort_slots_impl(
    path: &str,
    slot_type: &str,
    order: &str,
    selection: Option<Vec<u8>>,
) -> Result<slot_reorganise::SlotMoveReport, String> {
    let _files = slot_files_lock();
    let pool = parse_pool(slot_type)?;
    let sort_order = slot_reorganise::SortOrder::parse(order)
        .ok_or_else(|| format!("Unknown sort order: {}", order))?;
    let taken = slot_reorganise::taken_slots(path, pool)?;
    let entries = slot_reorganise::sort_entries(path, pool)?;
    let plan = slot_reorganise::plan_sort(&taken, &entries, sort_order, selection.as_deref())?;
    let label = format!("sort_{}_slots", pool.tag().to_lowercase());
    let by = match sort_order {
        slot_reorganise::SortOrder::NameAsc => "name A to Z",
        slot_reorganise::SortOrder::NameDesc => "name Z to A",
        slot_reorganise::SortOrder::DurationDesc => "duration, longest first",
        slot_reorganise::SortOrder::DurationAsc => "duration, shortest first",
        slot_reorganise::SortOrder::FolderThenName => "folder, then name",
    };
    let words = format!("Sort {} slots by {}", pool_word(pool), by);
    slot_reorganise::apply_plan(path, pool, &plan, |paths| {
        slot_move_before_write(path, &label, &words, paths)
    })
}

#[tauri::command]
async fn move_sample_slots(
    path: String,
    slot_type: String,
    sources: Vec<u8>,
    target: u8,
) -> Result<slot_reorganise::SlotMoveReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_slots_impl(&path, &slot_type, sources, target)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn sort_sample_slots(
    path: String,
    slot_type: String,
    order: String,
    selection: Option<Vec<u8>>,
) -> Result<slot_reorganise::SlotMoveReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sort_slots_impl(&path, &slot_type, &order, selection)
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

#[derive(Clone, Serialize)]
struct PoolFixResult {
    outcomes: Vec<audio_pool::PoolFixOutcome>,
    projects_updated: Vec<String>,
    slots_updated: u32,
}

/// Convert incompatible Audio Pool files to OT-compatible WAV in place (originals
/// replaced), then repoint sample-slot references across every project of the set.
/// Emits "copy-progress" events per file; cancellable via cancel_audio_transfer.
#[tauri::command]
async fn fix_pool_files(
    app: AppHandle,
    pool_path: String,
    file_paths: Vec<String>,
    transfer_id: String,
) -> Result<PoolFixResult, String> {
    let cancel_token = register_cancellation_token(&transfer_id);
    let transfer_id_for_cleanup = transfer_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut outcomes: Vec<audio_pool::PoolFixOutcome> = Vec::new();
        let mut renames: Vec<(String, String)> = Vec::new();
        // Files whose frames changed, so the slots playing them get their markers rescaled
        let mut resampled: Vec<project_reader::Resampled> = Vec::new();

        for path in &file_paths {
            if cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                outcomes.push(audio_pool::PoolFixOutcome {
                    old_path: path.clone(),
                    new_path: None,
                    error: Some("Cancelled".to_string()),
                });
                continue;
            }
            let app_for_cb = app.clone();
            let tid_for_cb = transfer_id.clone();
            let path_for_cb = path.clone();
            let progress_callback = move |stage: &str, progress: f32| {
                let _ = app_for_cb.emit(
                    "copy-progress",
                    CopyProgressEvent {
                        file_path: path_for_cb.clone(),
                        transfer_id: tid_for_cb.clone(),
                        stage: stage.to_string(),
                        progress,
                    },
                );
            };
            let before = project_reader::audio_frames_and_rate(std::path::Path::new(path));
            match audio_pool::convert_pool_file_in_place(
                std::path::Path::new(path),
                progress_callback,
                Some(cancel_token.clone()),
            ) {
                Ok(new_path) => {
                    let new_str = new_path.to_string_lossy().to_string();
                    if new_str != *path {
                        renames.push((path.clone(), new_str.clone()));
                    }
                    if let (Some((_, rate)), Some((frames, _))) =
                        (before, project_reader::audio_frames_and_rate(&new_path))
                    {
                        resampled.push((new_str.clone(), rate, frames));
                    }
                    outcomes.push(audio_pool::PoolFixOutcome {
                        old_path: path.clone(),
                        new_path: Some(new_str),
                        error: None,
                    });
                }
                Err(e) => outcomes.push(audio_pool::PoolFixOutcome {
                    old_path: path.clone(),
                    new_path: None,
                    error: Some(e),
                }),
            }
        }

        // Repoint slot references even if the run was cancelled midway:
        // already-converted files must not leave projects pointing at nothing.
        let refs = if renames.is_empty() {
            project_reader::PoolReferenceUpdate {
                projects_updated: vec![],
                slots_updated: 0,
            }
        } else {
            project_reader::update_pool_references(&pool_path, &renames)?
        };
        // After the repoint, so slots are found under the converted file's name
        project_reader::rescale_pool_markers(&pool_path, &resampled)?;

        Ok(PoolFixResult {
            outcomes,
            projects_updated: refs.projects_updated,
            slots_updated: refs.slots_updated,
        })
    })
    .await
    .unwrap();

    remove_cancellation_token(&transfer_id_for_cleanup);
    result
}

/// Convert incompatible files tied to a project (its own directory's files, or
/// pool-shared files referenced by its slots) to OT-compatible WAV in place,
/// then repoint sample-slot references across every project of the set.
/// Emits "copy-progress" events per file; cancellable via cancel_audio_transfer.
#[tauri::command]
async fn fix_project_samples(
    app: AppHandle,
    project_path: String,
    file_paths: Vec<String>,
    transfer_id: String,
) -> Result<PoolFixResult, String> {
    let cancel_token = register_cancellation_token(&transfer_id);
    let transfer_id_for_cleanup = transfer_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut outcomes: Vec<audio_pool::PoolFixOutcome> = Vec::new();
        let mut renames: Vec<(String, String)> = Vec::new();
        // Files whose frames changed, so the slots playing them get their markers rescaled
        let mut resampled: Vec<project_reader::Resampled> = Vec::new();

        for path in &file_paths {
            if cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                outcomes.push(audio_pool::PoolFixOutcome {
                    old_path: path.clone(),
                    new_path: None,
                    error: Some("Cancelled".to_string()),
                });
                continue;
            }
            let app_for_cb = app.clone();
            let tid_for_cb = transfer_id.clone();
            let path_for_cb = path.clone();
            let progress_callback = move |stage: &str, progress: f32| {
                let _ = app_for_cb.emit(
                    "copy-progress",
                    CopyProgressEvent {
                        file_path: path_for_cb.clone(),
                        transfer_id: tid_for_cb.clone(),
                        stage: stage.to_string(),
                        progress,
                    },
                );
            };
            let before = project_reader::audio_frames_and_rate(std::path::Path::new(path));
            match audio_pool::convert_pool_file_in_place(
                std::path::Path::new(path),
                progress_callback,
                Some(cancel_token.clone()),
            ) {
                Ok(new_path) => {
                    let new_str = new_path.to_string_lossy().to_string();
                    if new_str != *path {
                        renames.push((path.clone(), new_str.clone()));
                    }
                    if let (Some((_, rate)), Some((frames, _))) =
                        (before, project_reader::audio_frames_and_rate(&new_path))
                    {
                        resampled.push((new_str.clone(), rate, frames));
                    }
                    outcomes.push(audio_pool::PoolFixOutcome {
                        old_path: path.clone(),
                        new_path: Some(new_str),
                        error: None,
                    });
                }
                Err(e) => outcomes.push(audio_pool::PoolFixOutcome {
                    old_path: path.clone(),
                    new_path: None,
                    error: Some(e),
                }),
            }
        }

        // Repoint slot references even if the run was cancelled midway:
        // already-converted files must not leave projects pointing at nothing.
        let refs = if renames.is_empty() {
            project_reader::PoolReferenceUpdate {
                projects_updated: vec![],
                slots_updated: 0,
            }
        } else {
            project_reader::update_project_references(&project_path, &renames)?
        };
        // After the repoint, so slots are found under the converted file's name
        project_reader::rescale_project_markers(&project_path, &resampled)?;

        Ok(PoolFixResult {
            outcomes,
            projects_updated: refs.projects_updated,
            slots_updated: refs.slots_updated,
        })
    })
    .await
    .unwrap();

    remove_cancellation_token(&transfer_id_for_cleanup);
    result
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

#[tauri::command]
async fn scan_project_unused_files(
    project_path: String,
    exclude_backups: bool,
    simulate_cleared_slots: bool,
) -> Result<Vec<purge::PurgeUnit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        purge::compute_project_unused_files(&project_path, exclude_backups, simulate_cleared_slots)
    })
    .await
    .unwrap()
}

#[tauri::command]
async fn scan_pool_unused_files(
    pool_path: String,
    simulate_cleared_slots_for: Vec<String>,
) -> Result<Vec<purge::PurgeUnit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        purge::compute_pool_unused_files(&pool_path, &simulate_cleared_slots_for)
    })
    .await
    .unwrap()
}

/// Wires a purge run to the same `copy-progress` event stream and
/// `cancel_audio_transfer` registry the audio-conversion tools already use,
/// so the purge modal can show "Moving 3 / 12" plus the current path and
/// offer a Cancel button. `transfer_id: None` (no frontend listener) runs
/// exactly as before: no events, no cancellation, no token registered.
struct PurgeReporter {
    app: AppHandle,
    /// `Some` only when the frontend supplied a transfer id. Registered up
    /// front, in the async command body, so a Cancel that lands before the
    /// blocking task actually starts still takes effect - re-registering
    /// inside `with` would silently replace this token and drop that cancel.
    transfer: Option<(String, std::sync::Arc<std::sync::atomic::AtomicBool>)>,
}

impl PurgeReporter {
    fn new(app: AppHandle, transfer_id: Option<String>) -> Self {
        let transfer =
            transfer_id.map(|id| (id.clone(), audio_pool::register_cancellation_token(&id)));
        Self { app, transfer }
    }

    /// Runs `f` with a `PurgeProgress` bound to this transfer (or `None`
    /// when there is no transfer id), always releasing the cancellation
    /// token afterwards - including on the error path.
    fn with<F>(&self, f: F) -> Result<purge::PurgeResult, String>
    where
        F: FnOnce(Option<&purge::PurgeProgress>) -> Result<purge::PurgeResult, String>,
    {
        let Some((id, token)) = self.transfer.clone() else {
            return f(None);
        };
        let app = self.app.clone();
        let event_id = id.clone();
        let on_unit = move |path: &str, index: usize, total: usize| {
            let _ = app.emit(
                "copy-progress",
                CopyProgressEvent {
                    file_path: path.to_string(),
                    transfer_id: event_id.clone(),
                    stage: "purging".to_string(),
                    // 0.0..1.0 over the plan, matching the existing event's
                    // contract even though the modal counts units instead.
                    progress: if total == 0 {
                        0.0
                    } else {
                        index as f32 / total as f32
                    },
                },
            );
        };
        let result = f(Some(&purge::PurgeProgress {
            on_unit: &on_unit,
            cancel: &token,
        }));
        audio_pool::remove_cancellation_token(&id);
        result
    }
}

/// Purges (deletes to Trash, or moves) the reviewed `plan` for a single
/// project. `destination_dir: None` means delete; `Some(dir)` means move.
/// If `clear_unused_slots` is set, loaded-but-untriggered slots are cleared
/// first so the plan's already-simulated orphaned files are consistent with
/// what actually happens on disk.
#[tauri::command]
async fn purge_project_files(
    app: AppHandle,
    project_path: String,
    plan: Vec<purge::PurgeUnit>,
    clear_unused_slots: bool,
    destination_dir: Option<String>,
    transfer_id: Option<String>,
) -> Result<purge::PurgeResult, String> {
    let reporter = PurgeReporter::new(app, transfer_id);
    tauri::async_runtime::spawn_blocking(move || {
        let mut origin_roots = std::collections::HashMap::new();
        let project_name = std::path::Path::new(&project_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        origin_roots.insert(project_name, project_path.clone());

        let mut result = reporter.with(|progress| match &destination_dir {
            Some(dest) => purge::move_purge_units(&plan, dest, &origin_roots, progress),
            None => purge::trash_purge_units(&plan, &origin_roots, progress),
        })?;

        if clear_unused_slots {
            // The delete/move step above already succeeded - a slot-clearing
            // failure must be surfaced via result.errors, not `?`, or the
            // frontend would land on the modal's error phase claiming the
            // whole operation failed when the files are, in fact, already
            // gone/moved.
            purge::clear_unused_slots_for_projects(
                &mut result,
                std::slice::from_ref(&project_path),
            );
        }

        Ok(result)
    })
    .await
    .unwrap()
}

/// Purges the reviewed `plan` for the Audio Pool, optionally also clearing
/// unused slot assignments in every project of `included_project_paths`
/// (populated by the frontend only when "Include all projects of set" and
/// "Clear unused sample slot assignments" are both on).
#[tauri::command]
async fn purge_pool_files(
    app: AppHandle,
    pool_path: String,
    plan: Vec<purge::PurgeUnit>,
    clear_unused_slots: bool,
    included_project_paths: Vec<String>,
    destination_dir: Option<String>,
    transfer_id: Option<String>,
) -> Result<purge::PurgeResult, String> {
    let reporter = PurgeReporter::new(app, transfer_id);
    tauri::async_runtime::spawn_blocking(move || {
        let mut origin_roots = std::collections::HashMap::new();
        origin_roots.insert("Audio Pool".to_string(), pool_path.clone());
        for p in &included_project_paths {
            let name = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            origin_roots.insert(name, p.clone());
        }

        let mut result = reporter.with(|progress| match &destination_dir {
            Some(dest) => purge::move_purge_units(&plan, dest, &origin_roots, progress),
            None => purge::trash_purge_units(&plan, &origin_roots, progress),
        })?;

        if clear_unused_slots {
            // Same reasoning as purge_project_files: the delete/move step
            // already succeeded, so a slot-clearing failure for one project
            // must not discard the result or abort the remaining projects in
            // included_project_paths - it's surfaced per-project in
            // result.errors instead, and every other project is still tried.
            purge::clear_unused_slots_for_projects(&mut result, &included_project_paths);
        }

        Ok(result)
    })
    .await
    .unwrap()
}

/// Non-mutating list of the slots `clear_unused_slot_assignments` would
/// clear for `project_path`, each resolved to the file it holds. Lets the
/// purge preview/review tables list every slot clearing as its own row -
/// including the ones whose sample lives in the Audio Pool and therefore
/// keeps its file - instead of hiding that second, less obvious destructive
/// effect behind a single count.
#[tauri::command]
async fn list_unused_slot_assignments(
    project_path: String,
) -> Result<Vec<purge::ClearableSlot>, String> {
    tauri::async_runtime::spawn_blocking(move || purge::list_slots_to_clear(&project_path))
        .await
        .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Do NOT set WEBKIT_GST_ENABLE_AUDIO_MIXER here. It was added to make Web Audio
    // audible on Bluetooth (issue #7) and did, but it corrupts every Web Audio output on
    // the machine (issue #9). Measured on PipeWire 1.4.9 / webkit2gtk 2.50 by capturing
    // the sink monitor while playing a 440 Hz sine: mixer off gives 440.0 Hz at 0.00% THD,
    // identical to a `paplay` control; mixer on gives a 384 Hz fundamental with
    // non-harmonic sidebands 40 Hz apart. Forcing the AudioContext to the device's 48 kHz
    // does not help, so it is not a resampling mismatch - the mixer mangles the stream.
    // Bluetooth is handled in the frontend instead, which plays through an <audio>
    // element: measured clean on A2DP (440.0 Hz, 0.00% THD) with no mixer.

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let zoom =
                ui_zoom::zoom_file(app.handle()).map_or(1.0, |file| ui_zoom::saved_zoom(&file));
            app.manage(ui_zoom::UiZoom(std::sync::Mutex::new(zoom)));
            if zoom != 1.0 {
                let _ = window.set_zoom(zoom);
            }
            window_size::fit_to_monitor(&window, zoom);
            // Clear WebView session storage in the background on app startup
            std::thread::spawn(move || {
                // Small delay to ensure WebView is ready
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = window.eval("sessionStorage.clear()");
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ui_zoom::step_ui_zoom,
            ui_zoom::get_ui_zoom,
            scan_devices,
            scan_custom_directory,
            load_project_metadata,
            load_project_banks,
            load_single_bank,
            compute_sample_usage,
            get_pool_usage,
            list_set_projects,
            get_existing_banks,
            load_parts_data,
            load_scenes,
            save_scene,
            save_crossfader,
            save_scene_mute,
            load_bank_scenes,
            undo_write,
            redo_write,
            write_history_state,
            forget_write_history,
            save_parts,
            save_memory_settings,
            commit_part,
            commit_all_parts,
            reload_part,
            read_part_locks,
            set_part_locks,
            revert_part_values,
            read_part_copies,
            list_audio_directory,
            list_audio_files_recursive,
            list_audio_directory_recursive,
            navigate_to_parent,
            create_new_directory,
            resolve_default_purge_destination,
            copy_audio_files,
            copy_audio_files_to_project,
            carry_ot_sidecars,
            copy_audio_file_with_progress,
            cancel_audio_transfer,
            move_audio_files,
            delete_audio_files,
            get_home_directory,
            rename_file,
            delete_file,
            open_in_file_manager,
            reveal_in_file_manager,
            read_audio_file,
            expand_audio_paths,
            inspect_audio_files,
            get_audio_files_info,
            get_system_resources,
            // Tools Tab - Set and Audio Pool
            check_project_in_set,
            project_exists,
            check_projects_in_same_set,
            get_audio_pool_status,
            create_audio_pool,
            // Tools Tab - Copy Operations
            copy_bank,
            validate_bank_sample_slots,
            copy_parts,
            copy_scenes,
            copy_patterns,
            clear_banks,
            clear_parts,
            clear_patterns,
            clear_tracks,
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
            fix_missing_samples,
            fix_pool_files,
            fix_project_samples,
            // Purge Unused Samples
            scan_project_unused_files,
            scan_pool_unused_files,
            purge_project_files,
            purge_pool_files,
            list_unused_slot_assignments,
            // Sample slot assignment
            assign_samples_to_slots,
            clear_sample_slots,
            move_sample_slots,
            sort_sample_slots,
            clear_sample_keep_attributes,
            reset_slot_attributes,
            // Project Management
            project_manager::create_project,
            project_manager::copy_project,
            project_manager::copy_project_with_progress,
            project_manager::copy_set,
            project_manager::cancel_copy_operation,
            project_manager::rename_project,
            project_manager::move_project,
            project_manager::move_project_with_progress,
            project_manager::move_set,
            project_manager::move_set_with_progress,
            project_manager::delete_project,
            project_manager::rescan_set,
            project_manager::create_set,
            project_manager::rename_set,
            project_manager::delete_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    mod part_lock_commands {
        use super::*;
        use crate::project_reader::tests::TestProject;

        const ATK: &str = "/part/amps/0/atk";

        fn s(v: &[&str]) -> Vec<String> {
            v.iter().map(|p| p.to_string()).collect()
        }

        fn bank_bytes(project: &TestProject) -> Vec<u8> {
            std::fs::read(project_reader::bank_file_path(&project.path, "A").unwrap()).unwrap()
        }

        /// Part 1 saved, then its AMP ATK changed, so that value can be locked or reverted.
        fn edited_project() -> TestProject {
            let project = TestProject::new();
            commit_part_impl(&project.path, "A", 0).unwrap();
            let mut part = read_parts_data(&project.path, "A").unwrap().parts.remove(0);
            part.amps[0].atk = if part.amps[0].atk < 60 {
                part.amps[0].atk + 3
            } else {
                part.amps[0].atk - 3
            };
            save_parts_impl(&project.path, "A", vec![part]).unwrap();
            project
        }

        fn undo_label(project: &TestProject) -> Option<String> {
            write_history::state(&project.path).undo_label
        }

        #[test]
        fn writes_to_one_bank_at_once_do_not_overwrite_each_other() {
            for _ in 0..20 {
                let project = TestProject::new();
                let tracks = project_reader::read_part_copies(&project.path, "A", 0)
                    .unwrap()
                    .edited
                    .scenes
                    .scenes[1]
                    .tracks
                    .clone();
                let mut tracks = tracks;
                tracks[0].amp[0] = Some(77);
                let barrier = std::sync::Barrier::new(2);
                std::thread::scope(|s| {
                    s.spawn(|| {
                        barrier.wait();
                        save_scene_impl(&project.path, "A", 0, 1, tracks.clone()).unwrap();
                    });
                    s.spawn(|| {
                        barrier.wait();
                        save_crossfader_impl(&project.path, "A", 0, 3, 9).unwrap();
                    });
                });
                let after = project_reader::read_part_copies(&project.path, "A", 0)
                    .unwrap()
                    .edited
                    .scenes;
                assert_eq!(after.scenes[1].tracks[0].amp[0], Some(77));
                assert_eq!((after.scene_a, after.scene_b), (3, 9));
            }
        }

        #[test]
        fn keeping_values_adds_no_undo_entry() {
            let project = TestProject::new();
            commit_part_impl(&project.path, "A", 0).unwrap();
            let kept = set_part_locks_impl(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
            assert!(kept[0].is_empty(), "the value matches the saved one");
            assert_eq!(undo_label(&project), Some("Save part 1".to_string()));

            let project = edited_project();
            let kept = set_part_locks_impl(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
            assert_eq!(kept[0], s(&[ATK]));
            set_part_locks_impl(&project.path, "A", 0, &[], &s(&[ATK])).unwrap();
            assert_eq!(undo_label(&project), Some("Change a part".to_string()));
        }

        #[test]
        fn an_undo_leaves_the_kept_values_alone() {
            let project = edited_project();
            set_part_locks_impl(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
            // Another edit after the keep, then taken back: ATK still differs, so it is
            // still kept
            let mut part = read_parts_data(&project.path, "A").unwrap().parts.remove(0);
            part.amps[0].rel = if part.amps[0].rel < 60 { 70 } else { 20 };
            save_parts_impl(&project.path, "A", vec![part]).unwrap();
            let undo = tauri::async_runtime::block_on(undo_write(project.path.clone()));
            assert!(undo.unwrap().is_some());
            assert_eq!(
                read_part_locks_impl(&project.path, "A").unwrap()[0],
                s(&[ATK])
            );
        }

        #[test]
        fn an_undo_that_puts_a_kept_value_back_drops_its_keep() {
            let project = edited_project();
            set_part_locks_impl(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
            // Takes back the ATK edit itself, so the value matches the saved one again
            tauri::async_runtime::block_on(undo_write(project.path.clone())).unwrap();
            assert!(read_part_locks_impl(&project.path, "A").unwrap()[0].is_empty());
            assert!(!part_locks::locks_file(&project.path).exists());
        }

        #[test]
        fn undo_does_not_bring_back_what_save_or_revert_cleared() {
            for revert in [false, true] {
                let project = edited_project();
                set_part_locks_impl(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
                let before = bank_bytes(&project);
                if revert {
                    revert_part_values_impl(&project.path, "A", 0, &s(&[ATK]), "Revert T1 AMP ATK")
                        .unwrap();
                } else {
                    commit_part_impl(&project.path, "A", 0).unwrap();
                }
                assert!(read_part_locks_impl(&project.path, "A").unwrap()[0].is_empty());

                tauri::async_runtime::block_on(undo_write(project.path.clone())).unwrap();
                assert_eq!(bank_bytes(&project), before);
                assert!(read_part_locks_impl(&project.path, "A").unwrap()[0].is_empty());
            }
        }

        #[test]
        fn reload_keeps_locked_values_in_one_undo_entry() {
            let project = edited_project();
            // A second edit that is not locked, so Reload has something to put back
            let mut part = read_parts_data(&project.path, "A").unwrap().parts.remove(0);
            part.amps[0].rel = if part.amps[0].rel < 60 { 70 } else { 20 };
            save_parts_impl(&project.path, "A", vec![part]).unwrap();
            set_part_locks_impl(&project.path, "A", 0, &s(&[ATK]), &[]).unwrap();
            let before = bank_bytes(&project);

            let part = reload_part_impl(&project.path, "A", 0).unwrap();
            assert_ne!(bank_bytes(&project), before);
            let saved = read_parts_data(&project.path, "A").unwrap().parts.remove(0);
            assert_eq!(
                part.amps[0].atk, saved.amps[0].atk,
                "the locked value is kept"
            );
            assert_eq!(
                read_part_locks_impl(&project.path, "A").unwrap()[0],
                s(&[ATK])
            );

            write_history::undo(&project.path).unwrap();
            assert_eq!(bank_bytes(&project), before);
        }
    }

    mod slot_reorganise_commands {
        use super::*;
        use crate::project_reader::tests::TestProject;
        use crate::project_reader::{assign_samples_to_slots, SlotAssignment};
        use ot_tools_io::{BankFile, HasChecksumField, MarkersFile, OctatrackFileIO};
        use std::path::PathBuf;

        fn dir(project: &TestProject) -> &std::path::Path {
            std::path::Path::new(&project.path)
        }

        /// A project with an empty markers file and the given slots of `slot_type` assigned.
        fn project_with(slot_type: &str, slots: &[(u16, &str)]) -> TestProject {
            let project = TestProject::new();
            MarkersFile::default()
                .to_data_file(&dir(&project).join("markers.work"))
                .unwrap();
            let assignments = slots
                .iter()
                .map(|(slot, path)| SlotAssignment {
                    slot_index: *slot,
                    audio_path: path.to_string(),
                    set_defaults: true,
                })
                .collect();
            assign_samples_to_slots(&project.path, slot_type, assignments).unwrap();
            project
        }

        fn backup_dirs(project: &TestProject) -> Vec<PathBuf> {
            backup_dirs_of(&project.path)
        }

        #[test]
        fn strict_backup_fails_when_a_copy_fails() {
            let project = TestProject::new();
            let ok = dir(&project).join("project.work");
            let directory = dir(&project).join("subdir");
            std::fs::create_dir(&directory).unwrap();
            let err =
                backup_files_strict(&project.path, &[ok.clone(), directory], "t").unwrap_err();
            assert!(err.contains("subdir"), "{err}");

            let missing = dir(&project).join("nope.work");
            assert!(backup_files_strict(&project.path, &[ok, missing], "t").is_err());
        }

        #[test]
        fn strict_backup_never_reuses_a_folder() {
            let project = TestProject::new();
            let files = [dir(&project).join("project.work")];
            let mut made = std::collections::BTreeSet::new();
            for _ in 0..3 {
                made.insert(backup_files_strict(&project.path, &files, "t").unwrap());
            }
            assert_eq!(made.len(), 3, "{made:?}");
            for folder in &made {
                assert!(folder.join("project.work").is_file());
            }
        }

        #[test]
        fn a_move_is_backed_up_and_undone_in_one_step() {
            let project = project_with("STATIC", &[(1, "one.wav"), (5, "five.wav")]);
            let bank_path = dir(&project).join("bank01.work");
            let mut bank = BankFile::from_data_file(&bank_path).unwrap();
            bank.parts.unsaved.0[0].audio_track_machine_slots[0].static_slot_id = 0;
            bank.parts.unsaved.0[0].audio_track_machine_types[0] = 0; // Static
            bank.patterns.0[0].audio_track_trigs.0[0].plocks.0[3].flex_slot_id = 0;
            bank.checksum = bank.calculate_checksum().unwrap();
            bank.to_data_file(&bank_path).unwrap();

            let read_all = || -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
                std::fs::read_dir(dir(&project))
                    .unwrap()
                    .map(|e| e.unwrap().path())
                    .filter(|p| p.is_file())
                    .map(|p| {
                        let bytes = std::fs::read(&p).unwrap();
                        (p, bytes)
                    })
                    .collect()
            };
            let before = read_all();

            let report = move_slots_impl(&project.path, "static", vec![1], 5).unwrap();
            assert_eq!(report.swapped, Some((1, 5)));

            let moved = BankFile::from_data_file(&bank_path).unwrap();
            assert_eq!(
                moved.parts.unsaved.0[0].audio_track_machine_slots[0].static_slot_id, 4,
                "the Part follows"
            );
            assert_eq!(
                moved.patterns.0[0].audio_track_trigs.0[0].plocks.0[3].flex_slot_id, 4,
                "the Static track's lock follows"
            );

            // One backup folder holding every written file as it was before.
            let backups = backup_dirs(&project);
            assert_eq!(backups.len(), 1);
            assert!(backups[0].to_string_lossy().ends_with("_move_static_slots"));
            assert!(report.files_written.len() >= 3);
            for written in &report.files_written {
                let written = PathBuf::from(written);
                let name = written.file_name().unwrap();
                assert_eq!(
                    std::fs::read(backups[0].join(name)).unwrap(),
                    before[&written],
                    "{name:?}"
                );
            }

            let label = write_history::undo(&project.path).unwrap();
            assert_eq!(label.as_deref(), Some("Swap S001 and S005"));
            for written in &report.files_written {
                let written = PathBuf::from(written);
                assert_eq!(
                    std::fs::read(&written).unwrap(),
                    before[&written],
                    "{written:?}"
                );
            }
            assert!(
                write_history::undo(&project.path).unwrap().is_none(),
                "one step only"
            );
        }

        /// The project's files, by path, leaving out the backups folder.
        fn project_files(project: &TestProject) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
            std::fs::read_dir(dir(project))
                .unwrap()
                .map(|e| e.unwrap().path())
                .filter(|p| p.is_file())
                .map(|p| {
                    let bytes = std::fs::read(&p).unwrap();
                    (p.file_name().unwrap().into(), bytes)
                })
                .collect()
        }

        /// A Flex project with only banks A and B, so a move is quick to run.
        fn two_bank_project(slots: &[(u16, &str)]) -> TestProject {
            let project = project_with("FLEX", slots);
            for n in 3..=16 {
                std::fs::remove_file(dir(&project).join(format!("bank{n:02}.work"))).unwrap();
            }
            project
        }

        /// The Undo button names what a move did: the slots that really changed number, not
        /// the ones handed in (an empty slot or a repeat moves nothing).
        #[test]
        fn a_move_is_labelled_by_the_slots_it_moved() {
            let project = two_bank_project(&[(1, "one.wav"), (3, "three.wav")]);
            let undo_label = || write_history::state(&project.path).undo_label;

            move_slots_impl(&project.path, "flex", vec![1, 2, 3, 3], 10).unwrap();
            assert_eq!(undo_label().as_deref(), Some("Move 2 Flex slots"));

            move_slots_impl(&project.path, "flex", vec![10], 20).unwrap();
            assert_eq!(undo_label().as_deref(), Some("Move 1 Flex slot"));

            // A block whose first slot stays put: only the one that moved counts
            move_slots_impl(&project.path, "flex", vec![11, 20], 11).unwrap();
            assert_eq!(undo_label().as_deref(), Some("Move 1 Flex slot"));
        }

        /// Undo and redo rewrite the files a move writes, so they wait for one in flight.
        #[test]
        fn undo_and_redo_wait_for_a_move_in_flight() {
            let project = two_bank_project(&[(1, "one.wav")]);
            move_slots_impl(&project.path, "flex", vec![1], 10).unwrap();

            let waits_for_a_move = |undoing: bool| {
                let in_flight = slot_files_lock();
                let (done, finished) = std::sync::mpsc::channel();
                let path = project.path.clone();
                let step = std::thread::spawn(move || {
                    let answer = if undoing {
                        tauri::async_runtime::block_on(undo_write(path))
                    } else {
                        tauri::async_runtime::block_on(redo_write(path))
                    };
                    done.send(()).unwrap();
                    answer
                });
                assert!(
                    finished
                        .recv_timeout(std::time::Duration::from_millis(300))
                        .is_err(),
                    "undoing={undoing}: ran while a move held the files"
                );
                drop(in_flight);
                step.join().unwrap().unwrap()
            };
            assert!(waits_for_a_move(true).is_some(), "the move was undone");
            assert!(waits_for_a_move(false).is_some(), "and redone");
        }

        /// Tauri runs commands side by side, so two moves can be in flight at once. Both read
        /// the project before either writes it, and a bank remapped by both ends up pointing
        /// at the wrong slots. Whichever runs first, the files must come out as if the two had
        /// run one after the other.
        #[test]
        fn two_moves_at_once_run_one_after_the_other() {
            // Two banks keep it quick; reading them is still the window both moves overlap in
            let fresh = || two_bank_project(&[(1, "one.wav"), (2, "two.wav")]);
            // Slots 1 and 2: default Parts point at them, so both banks are rewritten by both
            let first = |p: &TestProject| move_slots_impl(&p.path, "flex", vec![1], 10);
            let second = |p: &TestProject| move_slots_impl(&p.path, "flex", vec![2], 11);

            let one_then_two = fresh();
            first(&one_then_two).unwrap();
            second(&one_then_two).unwrap();
            let two_then_one = fresh();
            second(&two_then_one).unwrap();
            first(&two_then_one).unwrap();
            let serial = [project_files(&one_then_two), project_files(&two_then_one)];

            for round in 0..3 {
                let both = fresh();
                let start = std::sync::Barrier::new(2);
                let (a, b) = std::thread::scope(|s| {
                    let a = s.spawn(|| {
                        start.wait();
                        first(&both)
                    });
                    let b = s.spawn(|| {
                        start.wait();
                        second(&both)
                    });
                    (a.join().unwrap(), b.join().unwrap())
                });
                assert!(a.is_ok() && b.is_ok(), "round {round}: {a:?} / {b:?}");
                let files = project_files(&both);
                assert!(
                    serial.contains(&files),
                    "round {round}: the two moves interleaved"
                );
            }
        }

        /// Moves on files written by a real Octatrack rather than ot-tools-io defaults: the
        /// `real_device` project (project, markers, bank A in both copies, arrangement), with
        /// the `multipart` bank, whose patterns run on Parts 1 to 4, as bank B.
        mod on_a_real_project {
            use super::*;
            use std::collections::BTreeMap;
            use tempfile::TempDir;

            struct RealProject {
                _dir: TempDir,
                path: String,
            }

            impl RealProject {
                fn file(&self, name: &str) -> PathBuf {
                    std::path::Path::new(&self.path).join(name)
                }

                fn bank(&self, name: &str) -> BankFile {
                    BankFile::from_data_file(&self.file(name)).unwrap()
                }

                fn files(&self) -> BTreeMap<String, Vec<u8>> {
                    std::fs::read_dir(&self.path)
                        .unwrap()
                        .map(|e| e.unwrap().path())
                        .filter(|p| p.is_file())
                        .map(|p| {
                            let bytes = std::fs::read(&p).unwrap();
                            (p.file_name().unwrap().to_string_lossy().into_owned(), bytes)
                        })
                        .collect()
                }
            }

            fn set_lock(bank: &mut BankFile, pattern: usize, track: usize, step: usize, id: u8) {
                bank.patterns.0[pattern].audio_track_trigs.0[track].plocks.0[step].flex_slot_id =
                    id;
            }

            fn lock(bank: &BankFile, pattern: usize, track: usize, step: usize) -> u8 {
                bank.patterns.0[pattern].audio_track_trigs.0[track].plocks.0[step].flex_slot_id
            }

            /// The shipped banks hold no sample lock, so a few are added, each on a track whose
            /// machine says which pool it plays (0-based ids: 43 is slot 44, 4 is slot 5...):
            /// - bank A, every pattern on Part 1 (tracks: 1 Thru, 2 Flex, 8 Static), pattern 1:
            ///   track 1 step 1 locks 43; track 2 steps 1 and 2 lock 43 and 4; track 8 steps 1
            ///   and 2 lock 4 and 43.
            /// - bank B: pattern 1 (Part 1, track 2 Flex) locks 43 and 40 on steps 1 and 2,
            ///   pattern 3 (Part 3, track 2 Static) locks 43 and 40 on steps 1 and 2.
            fn real_project() -> RealProject {
                let fixtures =
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
                let dir = TempDir::new().unwrap();
                let path = dir.path().to_string_lossy().into_owned();
                for name in [
                    "project.work",
                    "markers.work",
                    "bank01.work",
                    "bank01.strd",
                    "arr01.work",
                ] {
                    std::fs::copy(
                        fixtures.join("real_device").join(name),
                        dir.path().join(name),
                    )
                    .unwrap();
                }
                std::fs::copy(
                    fixtures.join("multipart/bank01.work"),
                    dir.path().join("bank02.work"),
                )
                .unwrap();
                let project = RealProject { _dir: dir, path };

                let mut a = project.bank("bank01.work");
                assert_eq!(
                    a.parts.unsaved.0[0].audio_track_machine_types,
                    [2, 1, 1, 1, 2, 1, 1, 0],
                    "fixture: bank A Part 1 machines"
                );
                set_lock(&mut a, 0, 0, 0, 43);
                set_lock(&mut a, 0, 1, 0, 43);
                set_lock(&mut a, 0, 1, 1, 4);
                set_lock(&mut a, 0, 7, 0, 4);
                set_lock(&mut a, 0, 7, 1, 43);
                a.to_data_file(&project.file("bank01.work")).unwrap();

                let mut b = project.bank("bank02.work");
                assert_eq!(b.patterns.0[0].part_assignment, 0, "fixture: B pattern 1");
                assert_eq!(b.patterns.0[2].part_assignment, 2, "fixture: B pattern 3");
                assert_eq!(b.parts.unsaved.0[0].audio_track_machine_types[1], 1);
                assert_eq!(b.parts.unsaved.0[2].audio_track_machine_types[1], 0);
                set_lock(&mut b, 0, 1, 0, 43);
                set_lock(&mut b, 0, 1, 1, 40);
                set_lock(&mut b, 2, 1, 0, 43);
                set_lock(&mut b, 2, 1, 1, 40);
                b.to_data_file(&project.file("bank02.work")).unwrap();
                project
            }

            /// The `[SAMPLE]` block for a slot, exactly as the file holds it.
            fn block_of<'a>(text: &'a str, slot_type: &str, slot: &str) -> &'a str {
                let head = format!("[SAMPLE]\r\nTYPE={slot_type}\r\nSLOT={slot}\r\n");
                let start = text.find(&head).unwrap_or_else(|| panic!("no {head:?}"));
                let end = start + text[start..].find("[/SAMPLE]").unwrap() + "[/SAMPLE]".len();
                &text[start..end]
            }

            fn renumbered(block: &str, from: &str, to: &str) -> String {
                block.replacen(&format!("SLOT={from}\r\n"), &format!("SLOT={to}\r\n"), 1)
            }

            /// Every slot reference of the Parts, both copies, with `a` and `b` traded.
            fn swap_part_refs(bank: &mut BankFile, flex: bool, a: u8, b: u8) {
                for parts in [&mut bank.parts.unsaved, &mut bank.parts.saved] {
                    for part in parts.0.iter_mut() {
                        for slot in part.audio_track_machine_slots.iter_mut() {
                            let id = if flex {
                                &mut slot.flex_slot_id
                            } else {
                                &mut slot.static_slot_id
                            };
                            if *id == a {
                                *id = b;
                            } else if *id == b {
                                *id = a;
                            }
                        }
                    }
                }
            }

            fn text(bytes: &[u8]) -> String {
                String::from_utf8(bytes.to_vec()).expect("the fixture is ASCII")
            }

            fn written(project: &RealProject, names: &[&str]) -> Vec<String> {
                names
                    .iter()
                    .map(|n| project.file(n).to_string_lossy().into_owned())
                    .collect()
            }

            #[test]
            fn moving_a_flex_slot_to_a_free_slot() {
                let project = real_project();
                let before = project.files();
                let (a, b) = (project.bank("bank01.work"), project.bank("bank02.work"));
                let markers = MarkersFile::from_data_file(&project.file("markers.work")).unwrap();
                assert_ne!(markers.flex_slots[43], markers.flex_slots[49], "fixture");

                // F044 is taken, F050 is free
                let report = move_slots_impl(&project.path, "flex", vec![44], 50).unwrap();
                assert_eq!(report.moves, vec![(44, 50)]);
                assert_eq!(
                    report.files_written,
                    written(
                        &project,
                        &["project.work", "markers.work", "bank01.work", "bank02.work"]
                    )
                );
                let after = project.files();

                // project.work: the block is renumbered and moved after F045, nothing else
                let old = text(&before["project.work"]);
                let moved = block_of(&old, "FLEX", "044");
                let next = block_of(&old, "FLEX", "045");
                let expected = old.replacen(&format!("{moved}\r\n\r\n"), "", 1).replacen(
                    &format!("{next}\r\n\r\n"),
                    &format!("{next}\r\n\r\n{}\r\n\r\n", renumbered(moved, "044", "050")),
                    1,
                );
                assert_eq!(text(&after["project.work"]), expected);

                // markers.work: entries 44 and 50 trade places, every other byte stays
                let mut expected_markers = markers.clone();
                expected_markers.flex_slots.swap(43, 49);
                assert_eq!(after["markers.work"], expected_markers.to_bytes().unwrap());

                // Parts: every Flex reference to 44 now says 50, in both copies, any machine
                // (bank A and B Part 1 tracks 1 and 5, a Thru and a Pickup slot)
                let (new_a, new_b) = (project.bank("bank01.work"), project.bank("bank02.work"));
                for bank in [&new_a, &new_b] {
                    for parts in [&bank.parts.unsaved, &bank.parts.saved] {
                        let slots = &parts.0[0].audio_track_machine_slots;
                        assert_eq!((slots[0].flex_slot_id, slots[4].flex_slot_id), (49, 49));
                    }
                }
                // Locks: only on tracks whose Part runs a Flex machine
                assert_eq!(lock(&new_a, 0, 0, 0), 43, "A track 1 is Thru: lock stays");
                assert_eq!(lock(&new_a, 0, 1, 0), 49, "A track 2 is Flex: lock follows");
                assert_eq!(lock(&new_a, 0, 1, 1), 4, "a lock on another slot stays");
                assert_eq!(lock(&new_a, 0, 7, 1), 43, "A track 8 is Static: lock stays");
                assert_eq!(lock(&new_b, 0, 1, 0), 49, "B Part 1 track 2 is Flex");
                assert_eq!(lock(&new_b, 2, 1, 0), 43, "B Part 3 track 2 is Static");

                // And every other byte of both banks is what it was
                let (mut expected_a, mut expected_b) = (a.clone(), b.clone());
                for bank in [&mut expected_a, &mut expected_b] {
                    swap_part_refs(bank, true, 43, 49);
                }
                set_lock(&mut expected_a, 0, 1, 0, 49);
                set_lock(&mut expected_b, 0, 1, 0, 49);
                assert_eq!(after["bank01.work"], expected_a.to_bytes().unwrap());
                assert_eq!(after["bank02.work"], expected_b.to_bytes().unwrap());

                // The device's saved copy and the arrangement are left alone
                assert_eq!(after["bank01.strd"], before["bank01.strd"]);
                assert_eq!(after["arr01.work"], before["arr01.work"]);

                // One Undo puts every file back
                write_history::undo(&project.path).unwrap();
                assert_eq!(project.files(), before);
            }

            #[test]
            fn swapping_two_static_slots() {
                let project = real_project();
                let before = project.files();
                let (a, b) = (project.bank("bank01.work"), project.bank("bank02.work"));
                let markers = MarkersFile::from_data_file(&project.file("markers.work")).unwrap();
                assert_ne!(markers.static_slots[4], markers.static_slots[40], "fixture");

                // S005 and S041 are both taken
                let report = move_slots_impl(&project.path, "static", vec![5], 41).unwrap();
                assert_eq!(report.swapped, Some((5, 41)));
                assert_eq!(
                    report.files_written,
                    written(
                        &project,
                        &["project.work", "markers.work", "bank01.work", "bank02.work"]
                    )
                );
                let after = project.files();

                // project.work: the two blocks trade places and numbers, nothing else
                let old = text(&before["project.work"]);
                let five = block_of(&old, "STATIC", "005");
                let forty_one = block_of(&old, "STATIC", "041");
                let expected = old
                    .replacen(five, "\u{0}", 1)
                    .replacen(forty_one, &renumbered(five, "005", "041"), 1)
                    .replacen('\u{0}', &renumbered(forty_one, "041", "005"), 1);
                assert_eq!(text(&after["project.work"]), expected);

                let mut expected_markers = markers.clone();
                expected_markers.static_slots.swap(4, 40);
                assert_eq!(after["markers.work"], expected_markers.to_bytes().unwrap());

                // Parts: 5 and 41 trade everywhere, the factory-default 5 on track 5 included
                let (new_a, new_b) = (project.bank("bank01.work"), project.bank("bank02.work"));
                let statics = |bank: &BankFile, part: usize| -> Vec<u8> {
                    bank.parts.unsaved.0[part]
                        .audio_track_machine_slots
                        .iter()
                        .map(|s| s.static_slot_id)
                        .collect()
                };
                assert_eq!(statics(&new_a, 0), [40, 1, 1, 1, 40, 40, 43, 7]);
                assert_eq!(statics(&new_a, 3), [0, 1, 2, 3, 40, 5, 6, 7]);
                assert_eq!(statics(&new_b, 0), [40, 1, 4, 1, 40, 40, 43, 7]);
                // Locks: only on tracks whose Part runs a Static machine
                assert_eq!(
                    lock(&new_a, 0, 7, 0),
                    40,
                    "A track 8 is Static: lock follows"
                );
                assert_eq!(lock(&new_a, 0, 1, 1), 4, "A track 2 is Flex: lock stays");
                assert_eq!(lock(&new_b, 2, 1, 1), 4, "B Part 3 track 2 is Static");
                assert_eq!(lock(&new_b, 0, 1, 1), 40, "B Part 1 track 2 is Flex");

                let (mut expected_a, mut expected_b) = (a.clone(), b.clone());
                for bank in [&mut expected_a, &mut expected_b] {
                    swap_part_refs(bank, false, 4, 40);
                }
                set_lock(&mut expected_a, 0, 7, 0, 40);
                set_lock(&mut expected_b, 2, 1, 1, 4);
                assert_eq!(after["bank01.work"], expected_a.to_bytes().unwrap());
                assert_eq!(after["bank02.work"], expected_b.to_bytes().unwrap());

                assert_eq!(after["bank01.strd"], before["bank01.strd"]);
                assert_eq!(after["arr01.work"], before["arr01.work"]);

                // Backed up as it was, and one Undo puts every file back
                let backups = backup_dirs_of(&project.path);
                assert_eq!(backups.len(), 1);
                for name in ["project.work", "markers.work", "bank01.work", "bank02.work"] {
                    assert_eq!(std::fs::read(backups[0].join(name)).unwrap(), before[name]);
                }
                write_history::undo(&project.path).unwrap();
                assert_eq!(project.files(), before);
            }
        }

        fn backup_dirs_of(path: &str) -> Vec<PathBuf> {
            let mut dirs: Vec<PathBuf> =
                std::fs::read_dir(std::path::Path::new(path).join("backups"))
                    .map(|rd| rd.map(|e| e.unwrap().path()).collect())
                    .unwrap_or_default();
            dirs.sort();
            dirs
        }

        #[test]
        fn a_sort_is_labelled_and_backed_up_per_pool() {
            let project = project_with("FLEX", &[(1, "b.wav"), (2, "a.wav")]);
            sort_slots_impl(&project.path, "Flex", "name-asc", None).unwrap();
            let backups = backup_dirs(&project);
            assert_eq!(backups.len(), 1);
            assert!(backups[0].to_string_lossy().ends_with("_sort_flex_slots"));
            let label = write_history::undo(&project.path).unwrap();
            assert_eq!(label.as_deref(), Some("Sort Flex slots by name A to Z"));
        }

        #[test]
        fn an_unknown_slot_type_or_order_is_refused() {
            let project = project_with("FLEX", &[(1, "a.wav"), (2, "b.wav")]);
            assert!(move_slots_impl(&project.path, "both", vec![1], 2).is_err());
            assert!(sort_slots_impl(&project.path, "recorder", "name-asc", None).is_err());
            assert!(sort_slots_impl(&project.path, "flex", "random", None).is_err());
            assert!(!dir(&project).join("backups").exists(), "nothing written");
        }
    }

    /// What the undo helpers snapshot before a write, and that the write comes back.
    ///
    /// The helpers decide which files one operation touches. Snapshot too few and an
    /// undo leaves the project half-restored, which is worse than not offering one:
    /// a bank whose two copies disagree, or a sample slot pointing at one file with
    /// another's trim window.
    mod undo_snapshots {
        use super::*;
        use tempfile::TempDir;

        struct Project {
            _dir: TempDir,
            path: String,
        }

        impl Project {
            /// A project with one bank and the files the device writes beside it.
            fn new() -> Self {
                let dir = TempDir::new().expect("temp dir");
                let at = dir.path();
                std::fs::write(
                    at.join("project.work"),
                    test_fixtures::default_project_bytes(),
                )
                .expect("project.work");
                for bank in 1..=2 {
                    for extension in ["work", "strd"] {
                        std::fs::write(
                            at.join(format!("bank{:02}.{}", bank, extension)),
                            test_fixtures::default_bank_bytes(),
                        )
                        .expect("bank file");
                    }
                }
                let path = at.to_string_lossy().to_string();
                Project { _dir: dir, path }
            }

            fn at(&self, name: &str) -> std::path::PathBuf {
                std::path::Path::new(&self.path).join(name)
            }

            fn put(&self, name: &str, contents: &str) {
                std::fs::write(self.at(name), contents).expect("write");
            }

            fn read(&self, name: &str) -> Vec<u8> {
                std::fs::read(self.at(name)).expect("read")
            }
        }

        #[test]
        fn test_a_bank_write_takes_both_copies_of_that_bank() {
            let project = Project::new();
            make_bank_undoable(&project.path, "A", "Change a part").unwrap();

            // The device keeps what it is playing and what it last saved side by side,
            // and a half-undone bank is one whose two copies disagree
            project.put("bank01.work", "edited work");
            project.put("bank01.strd", "edited stored");

            write_history::undo(&project.path).unwrap();

            assert_eq!(
                project.read("bank01.work"),
                test_fixtures::default_bank_bytes()
            );
            assert_eq!(
                project.read("bank01.strd"),
                test_fixtures::default_bank_bytes()
            );
        }

        #[test]
        fn test_a_bank_write_leaves_the_other_banks_alone() {
            let project = Project::new();
            make_bank_undoable(&project.path, "A", "Change a part").unwrap();
            project.put("bank01.work", "edited");
            project.put("bank02.work", "edited elsewhere");

            write_history::undo(&project.path).unwrap();

            assert_eq!(project.read("bank02.work"), b"edited elsewhere");
        }

        #[test]
        fn test_a_bank_with_no_stored_copy_is_still_undoable() {
            let project = Project::new();
            std::fs::remove_file(project.at("bank01.strd")).unwrap();

            make_bank_undoable(&project.path, "A", "Change a part").unwrap();
            project.put("bank01.work", "edited");
            write_history::undo(&project.path).unwrap();

            assert_eq!(
                project.read("bank01.work"),
                test_fixtures::default_bank_bytes()
            );
            assert!(!project.at("bank01.strd").exists(), "none was invented");
        }

        #[test]
        fn test_a_bank_that_does_not_exist_cannot_be_made_undoable() {
            let project = Project::new();
            assert!(make_bank_undoable(&project.path, "Z", "Change a part").is_err());
        }

        #[test]
        fn test_a_project_write_takes_the_project_file() {
            let project = Project::new();
            make_project_undoable(&project.path, "Mute the A end").unwrap();
            project.put("project.work", "edited");

            write_history::undo(&project.path).unwrap();

            assert_eq!(
                project.read("project.work"),
                test_fixtures::default_project_bytes()
            );
        }

        /// A slot carries its sample in the project file and its trim window in the
        /// markers file. Taking back only half leaves a slot pointing at one sample
        /// with another's trim window, which plays as silence.
        #[test]
        fn test_a_slot_write_takes_the_markers_file_too() {
            let project = Project::new();
            project.put("markers.work", "markers before");

            make_slots_undoable(&project.path, "Assign 1 sample slots").unwrap();
            project.put("project.work", "edited");
            project.put("markers.work", "markers after");

            write_history::undo(&project.path).unwrap();

            assert_eq!(
                project.read("project.work"),
                test_fixtures::default_project_bytes()
            );
            assert_eq!(project.read("markers.work"), b"markers before");
        }

        #[test]
        fn test_a_slot_write_falls_back_to_the_stored_markers() {
            let project = Project::new();
            project.put("markers.strd", "stored markers");

            make_slots_undoable(&project.path, "Assign 1 sample slots").unwrap();
            project.put("markers.strd", "edited");
            write_history::undo(&project.path).unwrap();

            assert_eq!(project.read("markers.strd"), b"stored markers");
        }

        #[test]
        fn test_a_slot_write_without_a_markers_file_is_still_undoable() {
            let project = Project::new();
            assert!(!project.at("markers.work").exists());

            make_slots_undoable(&project.path, "Assign 1 sample slots").unwrap();
            project.put("project.work", "edited");
            write_history::undo(&project.path).unwrap();

            assert_eq!(
                project.read("project.work"),
                test_fixtures::default_project_bytes()
            );
        }

        /// The whole way through: a real scene edit, taken back, read again.
        #[test]
        fn test_a_scene_edit_comes_back_byte_for_byte() {
            let project = Project::new();
            let before = project.read("bank01.work");

            make_bank_undoable(&project.path, "A", "Change scene 1").unwrap();
            let mut tracks = project_reader::read_scenes(&project.path, "A", 0)
                .unwrap()
                .scenes[0]
                .tracks
                .clone();
            tracks[0].amp[3] = Some(100);
            project_reader::save_scene(&project.path, "A", 0, 0, tracks).unwrap();

            let changed = project_reader::read_scenes(&project.path, "A", 0).unwrap();
            assert_eq!(
                changed.scenes[0].tracks[0].amp[3],
                Some(100),
                "the edit landed"
            );

            write_history::undo(&project.path).unwrap();

            let back = project_reader::read_scenes(&project.path, "A", 0).unwrap();
            assert_eq!(back.scenes[0].tracks[0].amp[3], None, "and was taken back");
            assert_eq!(project.read("bank01.work"), before, "byte for byte");
        }

        #[test]
        fn test_putting_a_scene_edit_back_again() {
            let project = Project::new();
            make_bank_undoable(&project.path, "A", "Change scene 1").unwrap();
            let mut tracks = project_reader::read_scenes(&project.path, "A", 0)
                .unwrap()
                .scenes[0]
                .tracks
                .clone();
            tracks[0].amp[3] = Some(100);
            project_reader::save_scene(&project.path, "A", 0, 0, tracks).unwrap();
            let edited = project.read("bank01.work");

            write_history::undo(&project.path).unwrap();
            write_history::redo(&project.path).unwrap();

            assert_eq!(project.read("bank01.work"), edited);
            assert_eq!(
                project_reader::read_scenes(&project.path, "A", 0)
                    .unwrap()
                    .scenes[0]
                    .tracks[0]
                    .amp[3],
                Some(100)
            );
        }
    }

    // =========================================================================
    // rename_file command tests
    // =========================================================================

    /// Minimal project.work with one [SAMPLE] block, enough for
    /// update_pool_references to find and rewrite a PATH= line.
    fn write_project_work(dir: &std::path::Path, path_value: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let content = format!(
            "[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=1\r\nPATH={}\r\nTRIM_BARSx100=-1\r\n[/SAMPLE]\r\n",
            path_value
        );
        let (encoded, _, _) = encoding_rs::WINDOWS_1258.encode(&content);
        std::fs::write(dir.join("project.work"), &*encoded).unwrap();
    }

    fn read_project_work(dir: &std::path::Path) -> String {
        let raw = std::fs::read(dir.join("project.work")).unwrap();
        encoding_rs::WINDOWS_1258.decode(&raw).0.to_string()
    }

    #[test]
    fn rename_file_repoints_pool_refs_across_the_set() {
        let temp = tempfile::TempDir::new().unwrap();
        let set = temp.path();
        let pool = set.join("AUDIO");
        std::fs::create_dir(&pool).unwrap();
        std::fs::write(pool.join("kick.wav"), b"x").unwrap();
        write_project_work(&set.join("PROJ1"), "../AUDIO/kick.wav");
        write_project_work(&set.join("PROJ2"), "../AUDIO/other.wav");

        let res = rename_file(
            pool.join("kick.wav").to_string_lossy().to_string(),
            "boom.wav".to_string(),
            Some(pool.to_string_lossy().to_string()),
        )
        .unwrap();

        assert!(pool.join("boom.wav").exists(), "file renamed on disk");
        assert!(!pool.join("kick.wav").exists());
        assert_eq!(res.slots_updated, 1);
        assert_eq!(res.projects_updated.len(), 1);
        assert!(read_project_work(&set.join("PROJ1")).contains("PATH=../AUDIO/boom.wav"));
        assert!(
            read_project_work(&set.join("PROJ2")).contains("PATH=../AUDIO/other.wav"),
            "unrelated slot untouched"
        );
    }

    #[test]
    fn rename_file_without_pool_path_touches_no_project() {
        let temp = tempfile::TempDir::new().unwrap();
        let set = temp.path();
        let pool = set.join("AUDIO");
        std::fs::create_dir(&pool).unwrap();
        std::fs::write(pool.join("kick.wav"), b"x").unwrap();
        write_project_work(&set.join("PROJ1"), "../AUDIO/kick.wav");

        let res = rename_file(
            pool.join("kick.wav").to_string_lossy().to_string(),
            "boom.wav".to_string(),
            None,
        )
        .unwrap();

        assert_eq!(res.slots_updated, 0);
        assert!(read_project_work(&set.join("PROJ1")).contains("PATH=../AUDIO/kick.wav"));
    }

    #[test]
    fn rename_file_leaves_folder_refs_alone() {
        let temp = tempfile::TempDir::new().unwrap();
        let set = temp.path();
        let pool = set.join("AUDIO");
        std::fs::create_dir_all(pool.join("kit")).unwrap();
        std::fs::write(pool.join("kit").join("kick.wav"), b"x").unwrap();
        write_project_work(&set.join("PROJ1"), "../AUDIO/kit/kick.wav");

        // Renaming the folder must not rewrite the basename of files inside it.
        let res = rename_file(
            pool.join("kit").to_string_lossy().to_string(),
            "drums".to_string(),
            Some(pool.to_string_lossy().to_string()),
        )
        .unwrap();

        assert_eq!(res.slots_updated, 0);
        assert!(read_project_work(&set.join("PROJ1")).contains("PATH=../AUDIO/kit/kick.wav"));
    }

    #[test]
    fn rename_file_refuses_an_existing_name() {
        let temp = tempfile::TempDir::new().unwrap();
        std::fs::write(temp.path().join("a.wav"), b"x").unwrap();
        std::fs::write(temp.path().join("b.wav"), b"x").unwrap();

        let err = rename_file(
            temp.path().join("a.wav").to_string_lossy().to_string(),
            "b.wav".to_string(),
            None,
        )
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {}", err);
        assert!(temp.path().join("a.wav").exists(), "original left in place");
    }

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

    // =========================================================================
    // read_audio_bytes tests
    // =========================================================================

    #[test]
    fn test_read_audio_bytes_returns_file_contents() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("kick.wav");
        std::fs::write(&file, b"RIFFsomePCMbytes").unwrap();

        let bytes = read_audio_bytes(file.to_str().unwrap()).unwrap();
        assert_eq!(bytes, b"RIFFsomePCMbytes");
    }

    #[test]
    fn test_read_audio_bytes_resolves_relative_traversal() {
        // Slot paths are stored relative to the project dir (e.g. ../AUDIO/x.wav);
        // canonicalize must resolve the ".." before reading.
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("AUDIO");
        let proj = dir.path().join("PROJ");
        std::fs::create_dir_all(&audio).unwrap();
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(audio.join("snare.wav"), b"snaredata").unwrap();

        let traversal = proj.join("../AUDIO/snare.wav");
        let bytes = read_audio_bytes(traversal.to_str().unwrap()).unwrap();
        assert_eq!(bytes, b"snaredata");
    }

    #[test]
    fn test_read_audio_bytes_errors_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist.wav");
        assert!(read_audio_bytes(missing.to_str().unwrap()).is_err());
    }

    // =========================================================================
    // project_exists - what bookmark pruning relies on
    // =========================================================================

    #[test]
    fn project_exists_accepts_a_live_project() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("PROJ");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("project.work"), b"x").unwrap();
        assert!(is_project_dir(proj.to_str().unwrap()));
    }

    #[test]
    fn project_exists_accepts_a_project_saved_but_never_worked_on() {
        // A project straight off the device has project.strd and no project.work
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("PROJ");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("project.strd"), b"x").unwrap();
        assert!(is_project_dir(proj.to_str().unwrap()));
    }

    #[test]
    fn project_exists_rejects_a_folder_the_project_was_moved_out_of() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("PROJ");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(!is_project_dir(empty.to_str().unwrap()));
    }

    #[test]
    fn project_exists_rejects_a_path_that_is_gone_or_is_a_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_project_dir(dir.path().join("NOPE").to_str().unwrap()));

        let file = dir.path().join("project.work");
        std::fs::write(&file, b"x").unwrap();
        assert!(!is_project_dir(file.to_str().unwrap()));
    }
}

/// Byte buffers for the default Octatrack files that test fixtures write
/// over and over.
///
/// A test project needs 17 files (16 banks + the project), and many tests
/// build two or three of them. Encoding a `BankFile` is expensive enough
/// that doing it per file dominated the entire test suite - it was ~2.8s of
/// fixture setup on every single test that touched a project, roughly 70s of
/// the 100s `cargo test` used to take.
///
/// `to_data_file` is just `to_bytes` followed by `File::create` +
/// `write_all`, and `default()` is a constant, so encoding once per process
/// and writing the cached buffer produces byte-identical files.
#[cfg(test)]
pub mod test_fixtures {
    use ot_tools_io::{BankFile, OctatrackFileIO, ProjectFile};

    pub fn default_bank_bytes() -> &'static [u8] {
        static BYTES: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
        BYTES.get_or_init(|| {
            BankFile::default()
                .to_bytes()
                .expect("Failed to encode default bank")
        })
    }

    pub fn default_project_bytes() -> &'static [u8] {
        static BYTES: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
        BYTES.get_or_init(|| {
            ProjectFile::default()
                .to_bytes()
                .expect("Failed to encode default project")
        })
    }
}
