//! The user's UI zoom: Ctrl + / Ctrl - / Ctrl 0 scale the whole page, on top of whatever
//! the platform already applies, and the choice is kept for the next launch.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

/// The levels a step moves through, as in a web browser.
const LEVELS: [f64; 11] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

/// The zoom in force, for the command to step from.
pub struct UiZoom(pub Mutex<f64>);

/// Next zoom from `current`: up a level for 1, down for -1, back to 100% for 0.
pub fn step_zoom(current: f64, step: i32) -> f64 {
    // A hair of slack, so a level read back from the file counts as that level
    const SLACK: f64 = 1e-6;
    match step.signum() {
        0 => 1.0,
        1 => LEVELS
            .iter()
            .copied()
            .find(|&level| level > current + SLACK)
            .unwrap_or(LEVELS[LEVELS.len() - 1]),
        _ => LEVELS
            .iter()
            .rev()
            .copied()
            .find(|&level| level < current - SLACK)
            .unwrap_or(LEVELS[0]),
    }
}

/// The zoom saved in `file`, or 100% when there is none or it makes no sense.
pub fn saved_zoom(file: &Path) -> f64 {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|text| text.trim().parse::<f64>().ok())
        .filter(|zoom| (LEVELS[0]..=LEVELS[LEVELS.len() - 1]).contains(zoom))
        .unwrap_or(1.0)
}

/// Saves `zoom` to `file`, creating its folder.
pub fn save_zoom(file: &Path, zoom: f64) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(file, zoom.to_string())
}

/// Where the zoom is kept: the app's config folder.
pub fn zoom_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("ui-zoom"))
}

/// The zoom in force (1 is 100%).
#[tauri::command]
pub fn get_ui_zoom(state: tauri::State<UiZoom>) -> Result<f64, String> {
    state.0.lock().map(|zoom| *zoom).map_err(|e| e.to_string())
}

/// Steps the zoom (1 up, -1 down, 0 back to 100%), applies it and keeps it. Returns the new zoom.
#[tauri::command]
pub fn step_ui_zoom(
    window: tauri::WebviewWindow,
    state: tauri::State<UiZoom>,
    step: i32,
) -> Result<f64, String> {
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let zoom = step_zoom(*current, step);
    window.set_zoom(zoom).map_err(|e| e.to_string())?;
    *current = zoom;
    // Failing to save only costs the next launch this zoom
    if let Some(file) = zoom_file(window.app_handle()) {
        let _ = save_zoom(&file, zoom);
    }
    Ok(zoom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_through_the_levels_and_resets() {
        assert_eq!(step_zoom(1.0, 1), 1.1);
        assert_eq!(step_zoom(1.0, -1), 0.9);
        assert_eq!(step_zoom(1.1, 1), 1.25);
        assert_eq!(step_zoom(0.9, -1), 0.8);
        assert_eq!(step_zoom(1.75, 0), 1.0);
    }

    #[test]
    fn stops_at_both_ends() {
        assert_eq!(step_zoom(2.0, 1), 2.0);
        assert_eq!(step_zoom(0.5, -1), 0.5);
    }

    #[test]
    fn a_value_between_levels_moves_to_the_next_one_in_that_direction() {
        assert_eq!(step_zoom(1.05, 1), 1.1);
        assert_eq!(step_zoom(1.05, -1), 1.0);
    }

    #[test]
    fn reads_back_what_it_saved() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join("ui-zoom");
        save_zoom(&file, 1.25).unwrap();
        assert_eq!(saved_zoom(&file), 1.25);
    }

    #[test]
    fn no_file_means_one_hundred_percent() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(saved_zoom(&dir.path().join("ui-zoom")), 1.0);
    }

    #[test]
    fn a_file_that_makes_no_sense_means_one_hundred_percent() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("ui-zoom");
        for junk in ["abc", "7", "0.1", "NaN", "inf", ""] {
            std::fs::write(&file, junk).unwrap();
            assert_eq!(saved_zoom(&file), 1.0, "{junk:?}");
        }
        std::fs::write(&file, " 0.9\n").unwrap();
        assert_eq!(saved_zoom(&file), 0.9);
    }
}
