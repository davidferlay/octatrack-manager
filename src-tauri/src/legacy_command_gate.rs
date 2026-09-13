//! Legacy IPC surface classification and write-stop boundary.
#![allow(dead_code)]
//!
//! Every non-v2 Tauri command must appear in exactly one of `READ_COMMANDS`,
//! `AUTHORIZED_COMMANDS`, or `DISABLED_COMMANDS`.

pub const LEGACY_WRITE_DISABLED: &str = "LEGACY_WRITE_DISABLED";

pub const READ_COMMANDS: &[&str] = &[
    "greet",
    "scan_devices",
    "scan_custom_directory",
    "load_project_metadata",
    "load_project_banks",
    "load_single_bank",
    "compute_sample_usage",
    "get_pool_usage",
    "list_set_projects",
    "get_existing_banks",
    "load_parts_data",
    "list_audio_directory",
    "list_audio_files_recursive",
    "list_audio_directory_recursive",
    "navigate_to_parent",
    "resolve_default_purge_destination",
    "get_home_directory",
    "expand_audio_paths",
    "inspect_audio_files",
    "get_audio_files_info",
    "get_system_resources",
    "check_project_in_set",
    "check_projects_in_same_set",
    "get_audio_pool_status",
    "validate_bank_sample_slots",
    "check_missing_source_files",
    "get_slot_audio_paths",
    "list_missing_samples",
    "search_project_dir",
    "search_audio_pool",
    "search_other_projects_of_set",
    "search_parent_projects",
    "search_directory",
    "scan_project_unused_files",
    "scan_pool_unused_files",
    "list_unused_slot_assignments",
    "cancel_audio_transfer",
    "project_manager::cancel_copy_operation",
    "project_manager::rescan_set",
];

pub const AUTHORIZED_COMMANDS: &[&str] = &[
    "read_audio_file",
    "rename_file",
    "delete_file",
    "delete_audio_files",
    "backup_project_files",
    "open_in_file_manager",
    "reveal_in_file_manager",
];

pub const DISABLED_COMMANDS: &[&str] = &[
    "save_parts",
    "save_memory_settings",
    "commit_part",
    "commit_all_parts",
    "reload_part",
    "create_new_directory",
    "create_audio_pool",
    "copy_audio_files",
    "copy_audio_files_to_project",
    "copy_audio_file_with_progress",
    "move_audio_files",
    "copy_bank",
    "copy_parts",
    "copy_patterns",
    "copy_tracks",
    "copy_sample_slots",
    "fix_missing_samples",
    "fix_pool_files",
    "fix_project_samples",
    "purge_project_files",
    "purge_pool_files",
    "assign_samples_to_slots",
    "clear_sample_slots",
    "clear_sample_keep_attributes",
    "reset_slot_attributes",
    "project_manager::create_project",
    "project_manager::copy_project",
    "project_manager::copy_project_with_progress",
    "project_manager::copy_set",
    "project_manager::rename_project",
    "project_manager::move_project",
    "project_manager::move_project_with_progress",
    "project_manager::move_set",
    "project_manager::move_set_with_progress",
    "project_manager::delete_project",
    "project_manager::create_set",
    "project_manager::rename_set",
    "project_manager::delete_set",
];

pub fn legacy_write_disabled_message() -> String {
    format!(
        "{LEGACY_WRITE_DISABLED}: legacy write commands are disabled; use v2 change/rename flows"
    )
}

pub fn is_disabled(command: &str) -> bool {
    DISABLED_COMMANDS.contains(&command)
}

#[macro_export]
macro_rules! deny_legacy_write {
    () => {
        return Err($crate::legacy_command_gate::legacy_write_disabled_message());
    };
}

pub fn all_legacy_commands() -> Vec<&'static str> {
    let mut all = Vec::with_capacity(84);
    all.extend_from_slice(READ_COMMANDS);
    all.extend_from_slice(AUTHORIZED_COMMANDS);
    all.extend_from_slice(DISABLED_COMMANDS);
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn legacy_command_classification_is_complete_and_disjoint() {
        let all = all_legacy_commands();
        assert_eq!(all.len(), 84);
        let unique: HashSet<_> = all.iter().copied().collect();
        assert_eq!(unique.len(), 84);
        assert_eq!(READ_COMMANDS.len(), 39);
        assert_eq!(AUTHORIZED_COMMANDS.len(), 7);
        assert_eq!(DISABLED_COMMANDS.len(), 38);
    }

    #[test]
    fn purge_commands_are_disabled_not_read() {
        assert!(is_disabled("purge_project_files"));
        assert!(is_disabled("purge_pool_files"));
        assert!(!READ_COMMANDS.contains(&"purge_project_files"));
    }

    #[test]
    fn disabled_message_is_stable() {
        assert!(legacy_write_disabled_message().starts_with(LEGACY_WRITE_DISABLED));
    }
}
