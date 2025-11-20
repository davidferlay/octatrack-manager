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
