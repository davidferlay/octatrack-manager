use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use hound;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioFileInfo {
    pub name: String,
    pub size: u64,
    pub channels: Option<u32>,
    pub bit_rate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub is_directory: bool,
    pub path: String,
}

/// List files in a directory with audio metadata
pub fn list_directory(path: &str) -> Result<Vec<AudioFileInfo>, String> {
    let dir_path = Path::new(path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut files = Vec::new();

    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let file_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files (starting with .)
        if file_name.starts_with('.') {
            continue;
        }

        let is_directory = metadata.is_dir();
        let size = if is_directory { 0 } else { metadata.len() };

        // Extract audio metadata if it's an audio file
        let (channels, bit_rate, sample_rate) = if !is_directory && is_audio_file(&file_name) {
            extract_audio_metadata(&file_path)
        } else {
            (None, None, None)
        };

        files.push(AudioFileInfo {
            name: file_name,
            size,
            channels,
            bit_rate,
            sample_rate,
            is_directory,
            path: file_path.to_string_lossy().to_string(),
        });
    }

    // Sort: directories first, then by name
    files.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(files)
}

/// Check if a file is an audio file based on extension
fn is_audio_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".wav") ||
    lower.ends_with(".aif") ||
    lower.ends_with(".aiff") ||
    lower.ends_with(".mp3") ||
    lower.ends_with(".flac") ||
    lower.ends_with(".ogg") ||
    lower.ends_with(".m4a")
}

/// Extract audio metadata from a file
fn extract_audio_metadata(path: &PathBuf) -> (Option<u32>, Option<u32>, Option<u32>) {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());

    match ext.as_deref() {
        Some("wav") => extract_wav_metadata(path),
        Some("aif") | Some("aiff") => extract_aiff_metadata(path),
        _ => (None, None, None),
    }
}

/// Extract metadata from WAV files
fn extract_wav_metadata(path: &PathBuf) -> (Option<u32>, Option<u32>, Option<u32>) {
    match hound::WavReader::open(path) {
        Ok(reader) => {
            let spec = reader.spec();
            let channels = Some(spec.channels as u32);
            let sample_rate = Some(spec.sample_rate);
            let bit_rate = Some(spec.bits_per_sample as u32);
            (channels, bit_rate, sample_rate)
        }
        Err(_) => (None, None, None),
    }
}

/// Extract metadata from AIFF files
fn extract_aiff_metadata(path: &PathBuf) -> (Option<u32>, Option<u32>, Option<u32>) {
    if let Ok(file) = fs::File::open(path) {
        let mut stream = std::io::BufReader::new(file);
        if let Ok(reader) = aifc::AifcReader::new(&mut stream) {
            let info = reader.info();
            let channels = Some(info.channels as u32);
            let sample_rate = Some(info.sample_rate as u32);
            // Extract bit depth from sample_format
            let bit_rate = match info.sample_format {
                aifc::SampleFormat::I16 => Some(16),
                aifc::SampleFormat::I24 => Some(24),
                aifc::SampleFormat::I32 => Some(32),
                _ => None,
            };
            return (channels, bit_rate, sample_rate);
        }
    }
    (None, None, None)
}

/// Navigate to parent directory
pub fn get_parent_directory(path: &str) -> Result<String, String> {
    let current_path = Path::new(path);

    if let Some(parent) = current_path.parent() {
        Ok(parent.to_string_lossy().to_string())
    } else {
        Err("Already at root directory".to_string())
    }
}

/// Create a new directory
pub fn create_directory(path: &str, name: &str) -> Result<String, String> {
    let parent = Path::new(path);
    let new_dir = parent.join(name);

    if new_dir.exists() {
        return Err(format!("Directory already exists: {}", name));
    }

    fs::create_dir(&new_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(new_dir.to_string_lossy().to_string())
}

/// Copy files from source to destination
pub fn copy_files(source_paths: Vec<String>, destination_dir: &str) -> Result<Vec<String>, String> {
    let dest_path = Path::new(destination_dir);

    if !dest_path.exists() {
        return Err(format!("Destination directory does not exist: {}", destination_dir));
    }

    if !dest_path.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination_dir));
    }

    let mut copied_files = Vec::new();

    for source in source_paths.iter() {
        let source_path = Path::new(&source);

        if !source_path.exists() {
            return Err(format!("Source file does not exist: {}", source));
        }

        let file_name = source_path.file_name()
            .ok_or_else(|| format!("Invalid file name: {}", source))?;

        let dest_file = dest_path.join(file_name);

        // Check if destination file already exists
        if dest_file.exists() {
            return Err(format!("File already exists: {}", dest_file.to_string_lossy()));
        }

        fs::copy(&source_path, &dest_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        copied_files.push(dest_file.to_string_lossy().to_string());
    }

    Ok(copied_files)
}

/// Move files from source to destination
pub fn move_files(source_paths: Vec<String>, destination_dir: &str) -> Result<Vec<String>, String> {
    let dest_path = Path::new(destination_dir);

    if !dest_path.exists() {
        return Err(format!("Destination directory does not exist: {}", destination_dir));
    }

    if !dest_path.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination_dir));
    }

    let mut moved_files = Vec::new();

    for source in source_paths {
        let source_path = Path::new(&source);

        if !source_path.exists() {
            return Err(format!("Source file does not exist: {}", source));
        }

        let file_name = source_path.file_name()
            .ok_or_else(|| format!("Invalid file name: {}", source))?;

        let dest_file = dest_path.join(file_name);

        // Check if destination file already exists
        if dest_file.exists() {
            return Err(format!("File already exists: {}", dest_file.to_string_lossy()));
        }

        fs::rename(&source_path, &dest_file)
            .map_err(|e| format!("Failed to move file: {}", e))?;

        moved_files.push(dest_file.to_string_lossy().to_string());
    }

    Ok(moved_files)
}

/// Delete files
pub fn delete_files(file_paths: Vec<String>) -> Result<usize, String> {
    let mut deleted_count = 0;

    for path in file_paths {
        let file_path = Path::new(&path);

        if !file_path.exists() {
            return Err(format!("File does not exist: {}", path));
        }

        if file_path.is_dir() {
            fs::remove_dir_all(&file_path)
                .map_err(|e| format!("Failed to delete directory: {}", e))?;
        } else {
            fs::remove_file(&file_path)
                .map_err(|e| format!("Failed to delete file: {}", e))?;
        }

        deleted_count += 1;
    }

    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file("test.wav"));
        assert!(is_audio_file("test.WAV"));
        assert!(is_audio_file("test.aif"));
        assert!(is_audio_file("test.AIFF"));
        assert!(!is_audio_file("test.txt"));
        assert!(!is_audio_file("test.pdf"));
    }
}
