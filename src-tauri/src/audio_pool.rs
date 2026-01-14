// Allow certain clippy lints for clearer code
#![allow(clippy::needless_range_loop)] // indexed loop pattern is clearer for audio buffer operations
#![allow(clippy::collapsible_if)] // separate if statements are sometimes clearer

use once_cell::sync::Lazy;
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

// Global cancellation token registry
static CANCELLATION_TOKENS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Register a cancellation token for a transfer
pub fn register_cancellation_token(transfer_id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    let mut tokens = CANCELLATION_TOKENS.lock().unwrap();
    tokens.insert(transfer_id.to_string(), Arc::clone(&token));
    token
}

/// Cancel a transfer by its ID
pub fn cancel_transfer(transfer_id: &str) -> bool {
    let tokens = CANCELLATION_TOKENS.lock().unwrap();
    if let Some(token) = tokens.get(transfer_id) {
        token.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

/// Remove a cancellation token (cleanup after transfer completes)
pub fn remove_cancellation_token(transfer_id: &str) {
    let mut tokens = CANCELLATION_TOKENS.lock().unwrap();
    tokens.remove(transfer_id);
}

/// Check if a transfer has been cancelled
pub fn is_cancelled(token: &Arc<AtomicBool>) -> bool {
    token.load(Ordering::SeqCst)
}

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

    let entries = fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
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
    files.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(files)
}

/// Check if a file is an audio file based on extension
fn is_audio_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".wav")
        || lower.ends_with(".aif")
        || lower.ends_with(".aiff")
        || lower.ends_with(".mp3")
        || lower.ends_with(".flac")
        || lower.ends_with(".ogg")
        || lower.ends_with(".m4a")
}

/// Extract audio metadata from a file
fn extract_audio_metadata(path: &PathBuf) -> (Option<u32>, Option<u32>, Option<u32>) {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());

    match ext.as_deref() {
        Some("wav") => extract_wav_metadata(path),
        Some("aif") | Some("aiff") => extract_aiff_metadata(path),
        Some("mp3") | Some("flac") | Some("ogg") | Some("m4a") => extract_symphonia_metadata(path),
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
            // Use comm_sample_size which contains the actual bits per sample
            let bit_depth = if info.comm_sample_size > 0 {
                Some(info.comm_sample_size as u32)
            } else {
                None
            };
            return (channels, bit_depth, sample_rate);
        }
    }
    (None, None, None)
}

/// Extract metadata from MP3, FLAC, OGG, M4A files using symphonia
fn extract_symphonia_metadata(path: &PathBuf) -> (Option<u32>, Option<u32>, Option<u32>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, None, None),
    };

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let probed =
        match symphonia::default::get_probe().format(&hint, mss, &format_opts, &metadata_opts) {
            Ok(p) => p,
            Err(_) => return (None, None, None),
        };

    let mut format = probed.format;

    // Find the first audio track
    let track = match format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
    {
        Some(t) => t.clone(),
        None => return (None, None, None),
    };

    let codec_params = &track.codec_params;

    let channels = codec_params.channels.map(|c| c.count() as u32);
    let sample_rate = codec_params.sample_rate;

    // For formats like FLAC, bits_per_sample is available directly
    // For lossy formats like MP3/OGG/M4A, we need to decode a frame to get the output bit depth
    let bit_depth = if let Some(bps) = codec_params.bits_per_sample {
        Some(bps)
    } else {
        // Try to decode a frame to determine the output sample format
        let decoder_opts = DecoderOptions::default();
        if let Ok(mut decoder) = symphonia::default::get_codecs().make(codec_params, &decoder_opts)
        {
            // Try to decode the first packet to get sample format
            let mut detected_bits: Option<u32> = None;
            while let Ok(packet) = format.next_packet() {
                if packet.track_id() == track.id {
                    if let Ok(decoded) = decoder.decode(&packet) {
                        detected_bits = match decoded {
                            AudioBufferRef::U8(_) => Some(8),
                            AudioBufferRef::S16(_) => Some(16),
                            AudioBufferRef::S24(_) => Some(24),
                            AudioBufferRef::S32(_) => Some(32),
                            AudioBufferRef::F32(_) => Some(32),
                            AudioBufferRef::F64(_) => Some(64),
                            _ => None,
                        };
                        break;
                    }
                }
            }
            detected_bits
        } else {
            None
        }
    };

    (channels, bit_depth, sample_rate)
}

/// Target sample rate for Octatrack compatibility
const OCTATRACK_SAMPLE_RATE: u32 = 44100;

/// Check if audio file needs conversion for Octatrack compatibility
fn needs_conversion(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());

    match ext.as_deref() {
        // WAV and AIFF are potentially compatible, but may need sample rate/bit depth conversion
        Some("wav") => {
            if let Ok(reader) = hound::WavReader::open(path) {
                let spec = reader.spec();
                // Needs conversion if sample rate isn't 44.1kHz or bit depth is not 16/24
                spec.sample_rate != OCTATRACK_SAMPLE_RATE
                    || spec.bits_per_sample < 16
                    || spec.bits_per_sample > 24
            } else {
                true // Can't read, try to convert anyway
            }
        }
        Some("aif") | Some("aiff") => {
            if let Ok(file) = fs::File::open(path) {
                let mut stream = BufReader::new(file);
                if let Ok(reader) = aifc::AifcReader::new(&mut stream) {
                    let info = reader.info();
                    let bit_depth = match info.sample_format {
                        aifc::SampleFormat::I16 => 16,
                        aifc::SampleFormat::I24 => 24,
                        aifc::SampleFormat::I32 => 32,
                        _ => 0,
                    };
                    // Needs conversion if sample rate isn't 44.1kHz or bit depth is not 16/24
                    (info.sample_rate as u32) != OCTATRACK_SAMPLE_RATE
                        || !(16..=24).contains(&bit_depth)
                } else {
                    true
                }
            } else {
                true
            }
        }
        // All other formats definitely need conversion
        Some("mp3") | Some("flac") | Some("ogg") | Some("m4a") | Some("aac") => true,
        _ => false, // Not an audio file we handle
    }
}

/// Convert an audio file to Octatrack-compatible WAV format with progress reporting
/// Progress is dynamically computed based on required steps:
/// - If resampling needed: decoding (0-50%), resampling (50-80%), writing (80-100%)
/// - If no resampling: decoding (0-60%), writing (60-100%)
fn convert_to_octatrack_format_with_progress<F>(
    source_path: &Path,
    dest_path: &Path,
    progress_callback: &F,
    cancel_token: &Option<Arc<AtomicBool>>,
) -> Result<(), String>
where
    F: Fn(&str, f32),
{
    // Helper to check cancellation
    let check_cancelled = || -> Result<(), String> {
        if let Some(ref token) = cancel_token {
            if is_cancelled(token) {
                return Err("Transfer cancelled".to_string());
            }
        }
        Ok(())
    };

    check_cancelled()?;
    // Open the source file
    let file =
        fs::File::open(source_path).map_err(|e| format!("Failed to open source file: {}", e))?;

    // Get file size for progress estimation
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Create a hint to help the format probe
    let mut hint = Hint::new();
    if let Some(ext) = source_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    progress_callback("decoding", 0.01);

    // Probe the format
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe audio format: {}", e))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    let source_sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| "Could not determine sample rate".to_string())?;
    let channels = codec_params
        .channels
        .ok_or_else(|| "Could not determine channel count".to_string())?
        .count();

    // Determine source bit depth (default to 16 if unknown)
    let source_bits = codec_params.bits_per_sample.unwrap_or(16);

    // Determine target bit depth
    let target_bits: u16 = if source_bits < 16 {
        16
    } else if source_bits > 24 {
        24
    } else {
        source_bits as u16
    };

    // Determine if resampling is needed to compute progress ranges dynamically
    let needs_resampling = source_sample_rate != OCTATRACK_SAMPLE_RATE;

    // Dynamic progress ranges based on required steps
    // Weights approximate relative processing time for each step
    let (decode_weight, resample_weight, write_weight) = if needs_resampling {
        // Decoding: ~10%, Resampling: ~80%, Writing: ~10% (resampling is by far the slowest)
        (0.10, 0.80, 0.10)
    } else {
        // Decoding: ~60%, Writing: ~40% (no resampling)
        (0.60, 0.0, 0.40)
    };

    let decode_end = decode_weight;
    let resample_end = decode_end + resample_weight;
    // write_end is always 1.0

    // Create decoder
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    // Collect all samples
    let mut all_samples: Vec<Vec<f32>> = vec![Vec::new(); channels];
    let mut bytes_read: u64 = 0;

    loop {
        // Check for cancellation periodically during decoding
        check_cancelled()?;

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(e) => return Err(format!("Error reading packet: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        // Update progress based on bytes read (decoding is 0 to decode_end)
        bytes_read += packet.data.len() as u64;
        if file_size > 0 {
            let decode_progress = (bytes_read as f32 / file_size as f32).min(1.0) * decode_end;
            progress_callback("decoding", decode_progress);
        }

        let decoded = decoder
            .decode(&packet)
            .map_err(|e| format!("Decode error: {}", e))?;

        // Convert to f32 samples per channel
        match decoded {
            AudioBufferRef::F32(buf) => {
                for ch in 0..channels {
                    all_samples[ch].extend(buf.chan(ch).iter().cloned());
                }
            }
            AudioBufferRef::S32(buf) => {
                for ch in 0..channels {
                    all_samples[ch]
                        .extend(buf.chan(ch).iter().map(|&s| s as f32 / i32::MAX as f32));
                }
            }
            AudioBufferRef::S16(buf) => {
                for ch in 0..channels {
                    all_samples[ch]
                        .extend(buf.chan(ch).iter().map(|&s| s as f32 / i16::MAX as f32));
                }
            }
            AudioBufferRef::U8(buf) => {
                for ch in 0..channels {
                    all_samples[ch]
                        .extend(buf.chan(ch).iter().map(|&s| (s as f32 - 128.0) / 128.0));
                }
            }
            AudioBufferRef::S24(buf) => {
                for ch in 0..channels {
                    all_samples[ch].extend(buf.chan(ch).iter().map(|s| s.0 as f32 / 8388607.0));
                }
            }
            AudioBufferRef::F64(buf) => {
                for ch in 0..channels {
                    all_samples[ch].extend(buf.chan(ch).iter().map(|&s| s as f32));
                }
            }
            AudioBufferRef::U16(buf) => {
                for ch in 0..channels {
                    all_samples[ch]
                        .extend(buf.chan(ch).iter().map(|&s| (s as f32 - 32768.0) / 32768.0));
                }
            }
            AudioBufferRef::U24(buf) => {
                for ch in 0..channels {
                    all_samples[ch].extend(
                        buf.chan(ch)
                            .iter()
                            .map(|s| (s.0 as f32 - 8388608.0) / 8388608.0),
                    );
                }
            }
            AudioBufferRef::U32(buf) => {
                for ch in 0..channels {
                    all_samples[ch].extend(
                        buf.chan(ch)
                            .iter()
                            .map(|&s| (s as f32 - 2147483648.0) / 2147483648.0),
                    );
                }
            }
            AudioBufferRef::S8(buf) => {
                for ch in 0..channels {
                    all_samples[ch].extend(buf.chan(ch).iter().map(|&s| s as f32 / i8::MAX as f32));
                }
            }
        }
    }

    // Check if we got any samples
    if all_samples[0].is_empty() {
        return Err("No audio samples decoded".to_string());
    }

    progress_callback("decoding", decode_end);

    // Check cancellation before resampling
    check_cancelled()?;

    // Resample if necessary
    let resampled: Vec<Vec<f32>> = if needs_resampling {
        progress_callback("resampling", decode_end);
        resample_audio_with_progress(
            &all_samples,
            source_sample_rate,
            OCTATRACK_SAMPLE_RATE,
            cancel_token,
            |p| {
                // Map resampling progress (0-1) to overall progress (decode_end to resample_end)
                progress_callback("resampling", decode_end + p * resample_weight);
            },
        )?
    } else {
        all_samples
    };

    // Check cancellation before writing
    check_cancelled()?;

    // Write to WAV file (resample_end to 1.0)
    progress_callback("writing", resample_end);
    write_wav_file_with_progress(
        dest_path,
        &resampled,
        OCTATRACK_SAMPLE_RATE,
        target_bits,
        cancel_token,
        |p| {
            // Map writing progress (0-1) to overall progress (resample_end to 1.0)
            progress_callback("writing", resample_end + p * write_weight);
        },
    )?;
    progress_callback("complete", 1.0);

    Ok(())
}

/// Resample audio with progress reporting and cancellation support
fn resample_audio_with_progress<F>(
    samples: &[Vec<f32>],
    source_rate: u32,
    target_rate: u32,
    cancel_token: &Option<Arc<AtomicBool>>,
    progress_callback: F,
) -> Result<Vec<Vec<f32>>, String>
where
    F: Fn(f32),
{
    let channels = samples.len();
    let total_samples = samples[0].len();

    if total_samples == 0 {
        return Ok(vec![Vec::new(); channels]);
    }

    // Use a reasonable chunk size for processing
    let chunk_size = 1024;

    // Configure the resampler
    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let mut resampler = SincFixedIn::<f32>::new(
        target_rate as f64 / source_rate as f64,
        2.0, // max relative ratio (for slight variations)
        params,
        chunk_size,
        channels,
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    // Output buffers
    let mut output: Vec<Vec<f32>> = vec![Vec::new(); channels];

    // Process in chunks
    let mut pos = 0;
    while pos < total_samples {
        // Check for cancellation periodically during resampling
        if let Some(ref token) = cancel_token {
            if is_cancelled(token) {
                return Err("Transfer cancelled".to_string());
            }
        }

        let end = (pos + chunk_size).min(total_samples);
        let actual_chunk_size = end - pos;

        // Report progress
        let progress = pos as f32 / total_samples as f32;
        progress_callback(progress);

        // Prepare chunk (pad with zeros if needed for the last chunk)
        let mut chunk: Vec<Vec<f32>> = vec![vec![0.0; chunk_size]; channels];
        for ch in 0..channels {
            for i in 0..actual_chunk_size {
                chunk[ch][i] = samples[ch][pos + i];
            }
        }

        // Process chunk - None means all samples are valid
        let resampled = resampler
            .process(&chunk, None)
            .map_err(|e| format!("Resampling failed at position {}: {}", pos, e))?;

        // Append to output
        for ch in 0..channels {
            output[ch].extend(&resampled[ch]);
        }

        pos = end;
    }

    progress_callback(1.0);
    Ok(output)
}

/// Write samples to a WAV file with progress reporting and cancellation support
fn write_wav_file_with_progress<F>(
    path: &Path,
    samples: &[Vec<f32>],
    sample_rate: u32,
    bits_per_sample: u16,
    cancel_token: &Option<Arc<AtomicBool>>,
    progress_callback: F,
) -> Result<(), String>
where
    F: Fn(f32),
{
    let channels = samples.len() as u16;

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;

    let num_samples = samples[0].len();

    // Report progress every N samples to avoid excessive callbacks
    let progress_interval = (num_samples / 100).max(1000);
    let mut last_progress_report = 0;

    // Interleave samples and write
    for i in 0..num_samples {
        // Check for cancellation periodically during writing
        if i - last_progress_report >= progress_interval {
            // Check cancellation
            if let Some(ref token) = cancel_token {
                if is_cancelled(token) {
                    // Drop writer to release file handle before returning error
                    drop(writer);
                    return Err("Transfer cancelled".to_string());
                }
            }

            let progress = i as f32 / num_samples as f32;
            progress_callback(progress);
            last_progress_report = i;
        }

        for ch in 0..channels as usize {
            let sample = samples[ch].get(i).copied().unwrap_or(0.0);
            // Clamp to prevent overflow
            let clamped = sample.clamp(-1.0, 1.0);

            match bits_per_sample {
                16 => {
                    let s = (clamped * i16::MAX as f32) as i16;
                    writer
                        .write_sample(s)
                        .map_err(|e| format!("Write error: {}", e))?;
                }
                24 => {
                    let s = (clamped * 8388607.0) as i32;
                    writer
                        .write_sample(s)
                        .map_err(|e| format!("Write error: {}", e))?;
                }
                _ => {
                    let s = (clamped * i16::MAX as f32) as i16;
                    writer
                        .write_sample(s)
                        .map_err(|e| format!("Write error: {}", e))?;
                }
            }
        }
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
    progress_callback(1.0);

    Ok(())
}

/// Copy and convert audio file to Octatrack-compatible format if needed
fn copy_and_convert_audio(
    source_path: &Path,
    dest_dir: &Path,
    overwrite: bool,
) -> Result<PathBuf, String> {
    copy_and_convert_audio_with_progress(source_path, dest_dir, overwrite, |_, _| {}, None)
}

/// Copy and convert audio file with progress reporting and optional cancellation
fn copy_and_convert_audio_with_progress<F>(
    source_path: &Path,
    dest_dir: &Path,
    overwrite: bool,
    progress_callback: F,
    cancel_token: Option<Arc<AtomicBool>>,
) -> Result<PathBuf, String>
where
    F: Fn(&str, f32),
{
    // Helper to check cancellation
    let check_cancelled = || -> Result<(), String> {
        if let Some(ref token) = cancel_token {
            if is_cancelled(token) {
                return Err("Transfer cancelled".to_string());
            }
        }
        Ok(())
    };

    check_cancelled()?;

    let file_name = source_path
        .file_name()
        .ok_or_else(|| format!("Invalid file name: {}", source_path.display()))?;

    let file_name_str = file_name.to_string_lossy();

    // Determine if this is an audio file that needs processing
    let is_audio = is_audio_file(&file_name_str);

    if !is_audio {
        // Not an audio file, just copy it directly
        check_cancelled()?;
        progress_callback("copying", 0.0);
        let dest_file = dest_dir.join(file_name);
        if dest_file.exists() && !overwrite {
            return Err(format!(
                "File already exists: {}",
                dest_file.to_string_lossy()
            ));
        }
        if dest_file.exists() && overwrite {
            fs::remove_file(&dest_file)
                .map_err(|e| format!("Failed to remove existing file: {}", e))?;
        }
        check_cancelled()?;
        fs::copy(source_path, &dest_file).map_err(|e| format!("Failed to copy file: {}", e))?;
        progress_callback("complete", 1.0);
        return Ok(dest_file);
    }

    // Determine destination file name (always .wav for converted files)
    let needs_conv = needs_conversion(source_path);
    let dest_file_name = if needs_conv {
        // Change extension to .wav for converted files
        let stem = source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("audio");
        format!("{}.wav", stem)
    } else {
        file_name_str.to_string()
    };

    let dest_file = dest_dir.join(&dest_file_name);

    // Check if destination exists
    if dest_file.exists() && !overwrite {
        return Err(format!(
            "File already exists: {}",
            dest_file.to_string_lossy()
        ));
    }

    // Remove existing file if overwriting
    if dest_file.exists() && overwrite {
        fs::remove_file(&dest_file)
            .map_err(|e| format!("Failed to remove existing file: {}", e))?;
    }

    check_cancelled()?;

    // Convert or copy based on needs_conversion
    if needs_conv {
        progress_callback("converting", 0.0);
        let result = convert_to_octatrack_format_with_progress(
            source_path,
            &dest_file,
            &progress_callback,
            &cancel_token,
        );

        // If cancelled or errored, clean up partial file
        if result.is_err() {
            if dest_file.exists() {
                let _ = fs::remove_file(&dest_file);
            }
        }
        result?;
    } else {
        // File is already compatible, just copy
        progress_callback("copying", 0.0);
        check_cancelled()?;
        fs::copy(source_path, &dest_file).map_err(|e| format!("Failed to copy file: {}", e))?;
        progress_callback("complete", 1.0);
    }

    Ok(dest_file)
}

/// Public function to copy a single file with progress callback and optional cancellation token
pub fn copy_single_file_with_progress<F>(
    source_path: &str,
    destination_dir: &str,
    overwrite: bool,
    progress_callback: F,
    cancel_token: Option<Arc<AtomicBool>>,
) -> Result<String, String>
where
    F: Fn(&str, f32) + Send + 'static,
{
    let source = Path::new(source_path);
    let dest_dir = Path::new(destination_dir);

    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    if !dest_dir.exists() {
        return Err(format!(
            "Destination directory does not exist: {}",
            destination_dir
        ));
    }

    if source.is_dir() {
        return Err("Use copy_files_with_overwrite for directories".to_string());
    }

    let result = copy_and_convert_audio_with_progress(
        source,
        dest_dir,
        overwrite,
        progress_callback,
        cancel_token,
    )?;
    Ok(result.to_string_lossy().to_string())
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

    fs::create_dir(&new_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(new_dir.to_string_lossy().to_string())
}

/// Recursively copy a directory with audio conversion for Octatrack compatibility
fn copy_dir_recursive_with_conversion(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir(dst)
            .map_err(|e| format!("Failed to create directory {}: {}", dst.display(), e))?;
    }

    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();

        if src_path.is_dir() {
            let dst_path = dst.join(entry.file_name());
            copy_dir_recursive_with_conversion(&src_path, &dst_path)?;
        } else {
            // Use audio conversion for files (overwrite = true since we already handled removal at top level)
            copy_and_convert_audio(&src_path, dst, true)?;
        }
    }

    Ok(())
}

/// Copy files from source to destination with optional overwrite
/// Audio files are automatically converted to Octatrack-compatible format
pub fn copy_files_with_overwrite(
    source_paths: Vec<String>,
    destination_dir: &str,
    overwrite: bool,
) -> Result<Vec<String>, String> {
    let dest_path = Path::new(destination_dir);

    if !dest_path.exists() {
        return Err(format!(
            "Destination directory does not exist: {}",
            destination_dir
        ));
    }

    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
    }

    let mut copied_files = Vec::new();

    for source in source_paths.iter() {
        let source_path = Path::new(&source);

        if !source_path.exists() {
            return Err(format!("Source file does not exist: {}", source));
        }

        // Handle directory vs file copy
        if source_path.is_dir() {
            let file_name = source_path
                .file_name()
                .ok_or_else(|| format!("Invalid file name: {}", source))?;
            let dest_file = dest_path.join(file_name);

            // Check if destination directory already exists
            if dest_file.exists() && !overwrite {
                return Err(format!(
                    "Directory already exists: {}",
                    dest_file.to_string_lossy()
                ));
            }

            // If overwriting, remove existing directory first
            if dest_file.exists() && overwrite {
                fs::remove_dir_all(&dest_file)
                    .map_err(|e| format!("Failed to remove existing directory: {}", e))?;
            }

            copy_dir_recursive_with_conversion(source_path, &dest_file)?;
            copied_files.push(dest_file.to_string_lossy().to_string());
        } else {
            // Use audio conversion for files
            let result_path = copy_and_convert_audio(source_path, dest_path, overwrite)?;
            copied_files.push(result_path.to_string_lossy().to_string());
        }
    }

    Ok(copied_files)
}

/// Move files from source to destination
pub fn move_files(source_paths: Vec<String>, destination_dir: &str) -> Result<Vec<String>, String> {
    let dest_path = Path::new(destination_dir);

    if !dest_path.exists() {
        return Err(format!(
            "Destination directory does not exist: {}",
            destination_dir
        ));
    }

    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
    }

    let mut moved_files = Vec::new();

    for source in source_paths {
        let source_path = Path::new(&source);

        if !source_path.exists() {
            return Err(format!("Source file does not exist: {}", source));
        }

        let file_name = source_path
            .file_name()
            .ok_or_else(|| format!("Invalid file name: {}", source))?;

        let dest_file = dest_path.join(file_name);

        // Check if destination file already exists
        if dest_file.exists() {
            return Err(format!(
                "File already exists: {}",
                dest_file.to_string_lossy()
            ));
        }

        fs::rename(source_path, &dest_file).map_err(|e| format!("Failed to move file: {}", e))?;

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
            fs::remove_dir_all(file_path)
                .map_err(|e| format!("Failed to delete directory: {}", e))?;
        } else {
            fs::remove_file(file_path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }

        deleted_count += 1;
    }

    Ok(deleted_count)
}

/// Rename a file or directory
pub fn rename_file(old_path: &str, new_name: &str) -> Result<String, String> {
    let old_path = Path::new(old_path);

    if !old_path.exists() {
        return Err(format!("File does not exist: {}", old_path.display()));
    }

    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;

    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err(format!(
            "A file or folder with the name '{}' already exists",
            new_name
        ));
    }

    fs::rename(old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file("test.wav"));
        assert!(is_audio_file("test.WAV"));
        assert!(is_audio_file("test.aif"));
        assert!(is_audio_file("test.AIFF"));
        assert!(!is_audio_file("test.txt"));
        assert!(!is_audio_file("test.pdf"));
    }

    #[test]
    fn test_is_audio_file_all_formats() {
        // All supported audio formats
        assert!(is_audio_file("test.wav"));
        assert!(is_audio_file("test.aif"));
        assert!(is_audio_file("test.aiff"));
        assert!(is_audio_file("test.mp3"));
        assert!(is_audio_file("test.flac"));
        assert!(is_audio_file("test.ogg"));
        assert!(is_audio_file("test.m4a"));
    }

    #[test]
    fn test_is_audio_file_case_insensitive() {
        assert!(is_audio_file("test.WAV"));
        assert!(is_audio_file("test.Wav"));
        assert!(is_audio_file("test.MP3"));
        assert!(is_audio_file("test.Mp3"));
        assert!(is_audio_file("test.FLAC"));
    }

    // ==================== LIST DIRECTORY TESTS ====================

    #[test]
    fn test_list_directory_success() {
        let temp_dir = TempDir::new().unwrap();

        // Create some test files
        fs::write(temp_dir.path().join("test1.txt"), "content").unwrap();
        fs::write(temp_dir.path().join("test2.txt"), "content").unwrap();
        fs::create_dir(temp_dir.path().join("subdir")).unwrap();

        let result = list_directory(&temp_dir.path().to_string_lossy());
        assert!(result.is_ok(), "Should list directory: {:?}", result);

        let files = result.unwrap();
        assert_eq!(files.len(), 3, "Should find 3 items");
    }

    #[test]
    fn test_list_directory_empty() {
        let temp_dir = TempDir::new().unwrap();

        let result = list_directory(&temp_dir.path().to_string_lossy());
        assert!(result.is_ok());

        let files = result.unwrap();
        assert!(files.is_empty(), "Empty directory should have no files");
    }

    #[test]
    fn test_list_directory_nonexistent() {
        let result = list_directory("/nonexistent/path/12345");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_list_directory_not_a_directory() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "content").unwrap();

        let result = list_directory(&file_path.to_string_lossy());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    #[test]
    fn test_list_directory_skips_hidden_files() {
        let temp_dir = TempDir::new().unwrap();

        fs::write(temp_dir.path().join(".hidden"), "content").unwrap();
        fs::write(temp_dir.path().join("visible.txt"), "content").unwrap();

        let files = list_directory(&temp_dir.path().to_string_lossy()).unwrap();
        assert_eq!(files.len(), 1, "Should skip hidden files");
        assert_eq!(files[0].name, "visible.txt");
    }

    #[test]
    fn test_list_directory_identifies_directories() {
        let temp_dir = TempDir::new().unwrap();

        fs::write(temp_dir.path().join("file.txt"), "content").unwrap();
        fs::create_dir(temp_dir.path().join("subdir")).unwrap();

        let files = list_directory(&temp_dir.path().to_string_lossy()).unwrap();

        let dir_entry = files.iter().find(|f| f.name == "subdir").unwrap();
        assert!(dir_entry.is_directory, "Should identify directory");

        let file_entry = files.iter().find(|f| f.name == "file.txt").unwrap();
        assert!(!file_entry.is_directory, "Should identify file");
    }

    #[test]
    fn test_list_directory_reports_file_size() {
        let temp_dir = TempDir::new().unwrap();

        let content = "Hello, World!";
        fs::write(temp_dir.path().join("file.txt"), content).unwrap();

        let files = list_directory(&temp_dir.path().to_string_lossy()).unwrap();
        let file_entry = files.iter().find(|f| f.name == "file.txt").unwrap();

        assert_eq!(file_entry.size, content.len() as u64);
    }

    // ==================== GET PARENT DIRECTORY TESTS ====================

    #[test]
    fn test_get_parent_directory_success() {
        let result = get_parent_directory("/home/user/documents");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "/home/user");
    }

    #[test]
    fn test_get_parent_directory_nested() {
        let temp_dir = TempDir::new().unwrap();
        let nested = temp_dir.path().join("level1").join("level2");
        fs::create_dir_all(&nested).unwrap();

        let result = get_parent_directory(&nested.to_string_lossy());
        assert!(result.is_ok());

        let parent = result.unwrap();
        assert!(
            parent.ends_with("level1"),
            "Should return parent: {}",
            parent
        );
    }

    #[test]
    fn test_get_parent_directory_at_root() {
        let result = get_parent_directory("/");
        // Root has no parent
        assert!(result.is_err() || result.unwrap().is_empty());
    }

    // ==================== CREATE DIRECTORY TESTS ====================

    #[test]
    fn test_create_directory_success() {
        let temp_dir = TempDir::new().unwrap();

        let result = create_directory(&temp_dir.path().to_string_lossy(), "newdir");
        assert!(result.is_ok(), "Should create directory: {:?}", result);

        let new_path = temp_dir.path().join("newdir");
        assert!(new_path.exists(), "Directory should exist");
        assert!(new_path.is_dir(), "Should be a directory");
    }

    #[test]
    fn test_create_directory_already_exists() {
        let temp_dir = TempDir::new().unwrap();

        // Pre-create the directory
        fs::create_dir(temp_dir.path().join("existing")).unwrap();

        let result = create_directory(&temp_dir.path().to_string_lossy(), "existing");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_create_directory_returns_path() {
        let temp_dir = TempDir::new().unwrap();

        let result = create_directory(&temp_dir.path().to_string_lossy(), "mydir").unwrap();
        assert!(
            result.ends_with("mydir"),
            "Should return full path: {}",
            result
        );
    }

    // ==================== COPY FILES TESTS ====================

    #[test]
    fn test_copy_files_success() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        // Create source file
        let source_file = source_dir.path().join("test.txt");
        fs::write(&source_file, "content").unwrap();

        let result = copy_files_with_overwrite(
            vec![source_file.to_string_lossy().to_string()],
            &dest_dir.path().to_string_lossy(),
            false,
        );
        assert!(result.is_ok(), "Should copy file: {:?}", result);

        // Verify copied
        assert!(dest_dir.path().join("test.txt").exists());
    }

    #[test]
    fn test_copy_files_multiple() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        // Create multiple source files
        fs::write(source_dir.path().join("file1.txt"), "content1").unwrap();
        fs::write(source_dir.path().join("file2.txt"), "content2").unwrap();

        let result = copy_files_with_overwrite(
            vec![
                source_dir
                    .path()
                    .join("file1.txt")
                    .to_string_lossy()
                    .to_string(),
                source_dir
                    .path()
                    .join("file2.txt")
                    .to_string_lossy()
                    .to_string(),
            ],
            &dest_dir.path().to_string_lossy(),
            false,
        );
        assert!(result.is_ok());

        let copied = result.unwrap();
        assert_eq!(copied.len(), 2);
    }

    #[test]
    fn test_copy_files_no_overwrite_fails() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        // Create source and destination with same name
        let source_file = source_dir.path().join("test.txt");
        fs::write(&source_file, "source content").unwrap();
        fs::write(dest_dir.path().join("test.txt"), "dest content").unwrap();

        let result = copy_files_with_overwrite(
            vec![source_file.to_string_lossy().to_string()],
            &dest_dir.path().to_string_lossy(),
            false,
        );
        assert!(result.is_err(), "Should fail without overwrite");
    }

    #[test]
    fn test_copy_files_with_overwrite() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        // Create source and destination with same name
        let source_file = source_dir.path().join("test.txt");
        fs::write(&source_file, "new content").unwrap();
        fs::write(dest_dir.path().join("test.txt"), "old content").unwrap();

        let result = copy_files_with_overwrite(
            vec![source_file.to_string_lossy().to_string()],
            &dest_dir.path().to_string_lossy(),
            true,
        );
        assert!(result.is_ok(), "Should succeed with overwrite");

        // Verify content was overwritten
        let content = fs::read_to_string(dest_dir.path().join("test.txt")).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_copy_files_source_not_exists() {
        let dest_dir = TempDir::new().unwrap();

        let result = copy_files_with_overwrite(
            vec!["/nonexistent/file.txt".to_string()],
            &dest_dir.path().to_string_lossy(),
            false,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_copy_files_dest_not_exists() {
        let source_dir = TempDir::new().unwrap();
        let source_file = source_dir.path().join("test.txt");
        fs::write(&source_file, "content").unwrap();

        let result = copy_files_with_overwrite(
            vec![source_file.to_string_lossy().to_string()],
            "/nonexistent/path",
            false,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_copy_directory() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        // Create a directory with files
        let subdir = source_dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("file.txt"), "content").unwrap();

        let result = copy_files_with_overwrite(
            vec![subdir.to_string_lossy().to_string()],
            &dest_dir.path().to_string_lossy(),
            false,
        );
        assert!(result.is_ok(), "Should copy directory: {:?}", result);

        // Verify structure
        assert!(dest_dir.path().join("subdir").exists());
        assert!(dest_dir.path().join("subdir/file.txt").exists());
    }

    // ==================== MOVE FILES TESTS ====================

    #[test]
    fn test_move_files_success() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        let source_file = source_dir.path().join("test.txt");
        fs::write(&source_file, "content").unwrap();

        let result = move_files(
            vec![source_file.to_string_lossy().to_string()],
            &dest_dir.path().to_string_lossy(),
        );
        assert!(result.is_ok(), "Should move file: {:?}", result);

        // Source should not exist, dest should exist
        assert!(!source_file.exists(), "Source should be gone");
        assert!(
            dest_dir.path().join("test.txt").exists(),
            "Dest should exist"
        );
    }

    #[test]
    fn test_move_files_multiple() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        fs::write(source_dir.path().join("file1.txt"), "1").unwrap();
        fs::write(source_dir.path().join("file2.txt"), "2").unwrap();

        let result = move_files(
            vec![
                source_dir
                    .path()
                    .join("file1.txt")
                    .to_string_lossy()
                    .to_string(),
                source_dir
                    .path()
                    .join("file2.txt")
                    .to_string_lossy()
                    .to_string(),
            ],
            &dest_dir.path().to_string_lossy(),
        );
        assert!(result.is_ok());

        let moved = result.unwrap();
        assert_eq!(moved.len(), 2);
    }

    #[test]
    fn test_move_files_dest_exists_fails() {
        let source_dir = TempDir::new().unwrap();
        let dest_dir = TempDir::new().unwrap();

        let source_file = source_dir.path().join("test.txt");
        fs::write(&source_file, "source").unwrap();
        fs::write(dest_dir.path().join("test.txt"), "dest").unwrap();

        let result = move_files(
            vec![source_file.to_string_lossy().to_string()],
            &dest_dir.path().to_string_lossy(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_move_files_source_not_exists() {
        let dest_dir = TempDir::new().unwrap();

        let result = move_files(
            vec!["/nonexistent/file.txt".to_string()],
            &dest_dir.path().to_string_lossy(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    // ==================== DELETE FILES TESTS ====================

    #[test]
    fn test_delete_files_success() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "content").unwrap();

        let result = delete_files(vec![file_path.to_string_lossy().to_string()]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1, "Should delete 1 file");
        assert!(!file_path.exists(), "File should be deleted");
    }

    #[test]
    fn test_delete_files_multiple() {
        let temp_dir = TempDir::new().unwrap();

        let files: Vec<_> = (0..3)
            .map(|i| {
                let path = temp_dir.path().join(format!("file{}.txt", i));
                fs::write(&path, "content").unwrap();
                path.to_string_lossy().to_string()
            })
            .collect();

        let result = delete_files(files);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 3, "Should delete 3 files");
    }

    #[test]
    fn test_delete_directory() {
        let temp_dir = TempDir::new().unwrap();
        let subdir = temp_dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("file.txt"), "content").unwrap();

        let result = delete_files(vec![subdir.to_string_lossy().to_string()]);
        assert!(result.is_ok());
        assert!(!subdir.exists(), "Directory should be deleted");
    }

    #[test]
    fn test_delete_files_not_exists() {
        let result = delete_files(vec!["/nonexistent/file.txt".to_string()]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    // ==================== RENAME FILE TESTS ====================

    #[test]
    fn test_rename_file_success() {
        let temp_dir = TempDir::new().unwrap();
        let old_path = temp_dir.path().join("old.txt");
        fs::write(&old_path, "content").unwrap();

        let result = rename_file(&old_path.to_string_lossy(), "new.txt");
        assert!(result.is_ok(), "Should rename file: {:?}", result);

        assert!(!old_path.exists(), "Old path should not exist");
        assert!(
            temp_dir.path().join("new.txt").exists(),
            "New path should exist"
        );
    }

    #[test]
    fn test_rename_file_returns_new_path() {
        let temp_dir = TempDir::new().unwrap();
        let old_path = temp_dir.path().join("old.txt");
        fs::write(&old_path, "content").unwrap();

        let result = rename_file(&old_path.to_string_lossy(), "new.txt").unwrap();
        assert!(
            result.ends_with("new.txt"),
            "Should return new path: {}",
            result
        );
    }

    #[test]
    fn test_rename_directory() {
        let temp_dir = TempDir::new().unwrap();
        let old_dir = temp_dir.path().join("olddir");
        fs::create_dir(&old_dir).unwrap();

        let result = rename_file(&old_dir.to_string_lossy(), "newdir");
        assert!(result.is_ok());

        assert!(!old_dir.exists());
        assert!(temp_dir.path().join("newdir").exists());
    }

    #[test]
    fn test_rename_file_not_exists() {
        let result = rename_file("/nonexistent/file.txt", "new.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_rename_file_dest_exists() {
        let temp_dir = TempDir::new().unwrap();

        let old_path = temp_dir.path().join("old.txt");
        fs::write(&old_path, "old").unwrap();
        fs::write(temp_dir.path().join("existing.txt"), "existing").unwrap();

        let result = rename_file(&old_path.to_string_lossy(), "existing.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    // ==================== CANCELLATION TOKEN TESTS ====================

    #[test]
    fn test_register_cancellation_token() {
        let token = register_cancellation_token("test_transfer_1");
        assert!(
            !is_cancelled(&token),
            "Token should not be cancelled initially"
        );
    }

    #[test]
    fn test_cancel_transfer() {
        let token = register_cancellation_token("test_transfer_2");

        let cancelled = cancel_transfer("test_transfer_2");
        assert!(cancelled, "Should return true for existing token");
        assert!(is_cancelled(&token), "Token should be cancelled");

        // Cleanup
        remove_cancellation_token("test_transfer_2");
    }

    #[test]
    fn test_cancel_nonexistent_transfer() {
        let cancelled = cancel_transfer("nonexistent_transfer");
        assert!(!cancelled, "Should return false for non-existent token");
    }

    #[test]
    fn test_remove_cancellation_token() {
        register_cancellation_token("test_transfer_3");
        remove_cancellation_token("test_transfer_3");

        // After removal, cancel should return false
        let cancelled = cancel_transfer("test_transfer_3");
        assert!(!cancelled, "Token should be removed");
    }

    // =========================================================================
    // needs_conversion tests
    // =========================================================================

    /// Helper to create a test WAV file with specific parameters
    fn create_test_wav(path: &Path, sample_rate: u32, bits_per_sample: u16, num_samples: usize) {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate,
            bits_per_sample,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        for _ in 0..num_samples {
            match bits_per_sample {
                16 => {
                    writer.write_sample(0i16).unwrap();
                    writer.write_sample(0i16).unwrap();
                }
                24 => {
                    writer.write_sample(0i32).unwrap();
                    writer.write_sample(0i32).unwrap();
                }
                _ => {
                    writer.write_sample(0i16).unwrap();
                    writer.write_sample(0i16).unwrap();
                }
            }
        }
        writer.finalize().unwrap();
    }

    #[test]
    fn test_needs_conversion_compatible_wav_44100_16bit() {
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        create_test_wav(&wav_path, 44100, 16, 100);

        assert!(
            !super::needs_conversion(&wav_path),
            "44.1kHz 16-bit WAV should not need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_compatible_wav_44100_24bit() {
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        create_test_wav(&wav_path, 44100, 24, 100);

        assert!(
            !super::needs_conversion(&wav_path),
            "44.1kHz 24-bit WAV should not need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_wrong_sample_rate() {
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        create_test_wav(&wav_path, 48000, 16, 100);

        assert!(
            super::needs_conversion(&wav_path),
            "48kHz WAV should need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_wrong_sample_rate_96khz() {
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("test.wav");
        create_test_wav(&wav_path, 96000, 16, 100);

        assert!(
            super::needs_conversion(&wav_path),
            "96kHz WAV should need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_8bit_wav() {
        // 8-bit is less than 16-bit, should need conversion
        // Note: hound doesn't easily support 8-bit, so we test with the path logic
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("nonexistent.wav");
        // Non-existent file should return true (needs conversion/can't read)
        assert!(
            super::needs_conversion(&wav_path),
            "Unreadable WAV should need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_mp3() {
        let temp_dir = TempDir::new().unwrap();
        let mp3_path = temp_dir.path().join("test.mp3");
        fs::write(&mp3_path, b"fake mp3 data").unwrap();

        assert!(
            super::needs_conversion(&mp3_path),
            "MP3 should always need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_flac() {
        let temp_dir = TempDir::new().unwrap();
        let flac_path = temp_dir.path().join("test.flac");
        fs::write(&flac_path, b"fake flac data").unwrap();

        assert!(
            super::needs_conversion(&flac_path),
            "FLAC should always need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_ogg() {
        let temp_dir = TempDir::new().unwrap();
        let ogg_path = temp_dir.path().join("test.ogg");
        fs::write(&ogg_path, b"fake ogg data").unwrap();

        assert!(
            super::needs_conversion(&ogg_path),
            "OGG should always need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_non_audio_file() {
        let temp_dir = TempDir::new().unwrap();
        let txt_path = temp_dir.path().join("test.txt");
        fs::write(&txt_path, b"not an audio file").unwrap();

        assert!(
            !super::needs_conversion(&txt_path),
            "Non-audio file should not need conversion (we don't handle it)"
        );
    }

    #[test]
    fn test_needs_conversion_no_extension() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("noextension");
        fs::write(&path, b"data").unwrap();

        assert!(
            !super::needs_conversion(&path),
            "File without extension should not need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let mp3_path = temp_dir.path().join("test.MP3");
        fs::write(&mp3_path, b"fake mp3 data").unwrap();

        assert!(
            super::needs_conversion(&mp3_path),
            "MP3 extension should be case-insensitive"
        );
    }

    // =========================================================================
    // is_cancelled tests
    // =========================================================================

    #[test]
    fn test_is_cancelled_false_by_default() {
        let token = Arc::new(AtomicBool::new(false));
        assert!(
            !super::is_cancelled(&token),
            "Token should not be cancelled by default"
        );
    }

    #[test]
    fn test_is_cancelled_true_when_set() {
        let token = Arc::new(AtomicBool::new(false));
        token.store(true, Ordering::SeqCst);
        assert!(
            super::is_cancelled(&token),
            "Token should be cancelled when set to true"
        );
    }

    // =========================================================================
    // copy_single_file_with_progress tests
    // =========================================================================

    #[test]
    fn test_copy_single_file_compatible_wav() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("source.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create a compatible WAV file (44.1kHz, 16-bit)
        create_test_wav(&source_path, 44100, 16, 1000);

        let cancel_token = Arc::new(AtomicBool::new(false));
        let progress_calls = Arc::new(Mutex::new(Vec::new()));
        let progress_calls_clone = Arc::clone(&progress_calls);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false, // overwrite
            move |stage, progress| {
                progress_calls_clone
                    .lock()
                    .unwrap()
                    .push((stage.to_string(), progress));
            },
            Some(cancel_token),
        );

        assert!(result.is_ok(), "Copy should succeed: {:?}", result);
        let dest_path = result.unwrap();
        assert!(
            Path::new(&dest_path).exists(),
            "Destination file should exist"
        );

        // Check that progress was reported
        let calls = progress_calls.lock().unwrap();
        assert!(!calls.is_empty(), "Progress should have been reported");
    }

    #[test]
    fn test_copy_single_file_source_not_exists() {
        let temp_dir = TempDir::new().unwrap();
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let result = copy_single_file_with_progress(
            "/nonexistent/path/file.wav",
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(result.is_err(), "Should fail for non-existent source");
    }

    #[test]
    fn test_copy_single_file_dest_exists_no_overwrite() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("source.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 44100, 16, 100);

        // Create destination file
        let dest_file = dest_dir.join("source.wav");
        fs::write(&dest_file, b"existing").unwrap();

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false, // no overwrite
            |_, _| {},
            None,
        );

        assert!(
            result.is_err(),
            "Should fail when destination exists and overwrite is false"
        );
        assert!(
            result.unwrap_err().contains("already exists"),
            "Error should mention file exists"
        );
    }

    #[test]
    fn test_copy_single_file_dest_exists_with_overwrite() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("source.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 44100, 16, 100);

        // Create destination file
        let dest_file = dest_dir.join("source.wav");
        fs::write(&dest_file, b"existing").unwrap();
        let original_size = dest_file.metadata().unwrap().len();

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            true, // overwrite
            |_, _| {},
            None,
        );

        assert!(
            result.is_ok(),
            "Should succeed with overwrite: {:?}",
            result
        );

        // Check that file was actually overwritten (size changed)
        let new_size = dest_file.metadata().unwrap().len();
        assert_ne!(original_size, new_size, "File should have been overwritten");
    }

    #[test]
    fn test_copy_single_file_cancelled_before_start() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("source.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 44100, 16, 100);

        // Pre-cancel the token
        let cancel_token = Arc::new(AtomicBool::new(true));

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            Some(cancel_token),
        );

        assert!(result.is_err(), "Should fail when cancelled");
        assert!(
            result.unwrap_err().contains("cancelled"),
            "Error should mention cancellation"
        );
    }

    #[test]
    fn test_copy_single_file_progress_range() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("source.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create a compatible WAV file
        create_test_wav(&source_path, 44100, 16, 1000);

        let progress_values = Arc::new(Mutex::new(Vec::new()));
        let progress_values_clone = Arc::clone(&progress_values);

        let _ = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            move |_, progress| {
                progress_values_clone.lock().unwrap().push(progress);
            },
            None,
        );

        let values = progress_values.lock().unwrap();
        for &p in values.iter() {
            assert!(
                (0.0..=1.0).contains(&p),
                "Progress {} should be between 0.0 and 1.0",
                p
            );
        }
    }

    #[test]
    fn test_copy_single_file_preserves_filename() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("my_sample.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 44100, 16, 100);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(result.is_ok());
        let dest_path = result.unwrap();
        assert!(
            dest_path.ends_with("my_sample.wav"),
            "Should preserve original filename"
        );
    }

    // =========================================================================
    // Audio conversion edge cases
    // =========================================================================

    #[test]
    fn test_copy_converts_48khz_to_44100() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("source48k.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create 48kHz WAV that needs conversion
        create_test_wav(&source_path, 48000, 16, 1000);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(result.is_ok(), "Conversion should succeed: {:?}", result);

        // Verify the output is 44.1kHz
        let dest_path = result.unwrap();
        let reader = hound::WavReader::open(&dest_path).unwrap();
        assert_eq!(reader.spec().sample_rate, 44100, "Output should be 44.1kHz");
    }

    #[test]
    fn test_copy_single_file_empty_wav() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("empty.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create an empty WAV (0 samples)
        create_test_wav(&source_path, 44100, 16, 0);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        // Empty file should still copy successfully
        assert!(result.is_ok(), "Empty WAV should copy: {:?}", result);
    }

    // =========================================================================
    // Additional edge case tests
    // =========================================================================

    /// Helper to create a mono WAV file
    fn create_mono_wav(path: &Path, sample_rate: u32, bits_per_sample: u16, num_samples: usize) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        for i in 0..num_samples {
            // Create a simple sine wave pattern
            let sample = ((i as f32 * 0.1).sin() * 16000.0) as i16;
            writer.write_sample(sample).unwrap();
        }
        writer.finalize().unwrap();
    }

    #[test]
    fn test_copy_mono_wav_file() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("mono.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create a mono WAV file
        create_mono_wav(&source_path, 44100, 16, 1000);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(result.is_ok(), "Mono WAV should copy: {:?}", result);

        // Verify the output exists
        let dest_path = result.unwrap();
        assert!(Path::new(&dest_path).exists());
    }

    #[test]
    fn test_copy_mono_wav_needs_conversion() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("mono_48k.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create a mono 48kHz WAV file that needs conversion
        create_mono_wav(&source_path, 48000, 16, 1000);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(
            result.is_ok(),
            "Mono 48kHz WAV conversion should succeed: {:?}",
            result
        );

        // Verify output is 44.1kHz
        let dest_path = result.unwrap();
        let reader = hound::WavReader::open(&dest_path).unwrap();
        assert_eq!(reader.spec().sample_rate, 44100);
    }

    #[test]
    fn test_copy_22050hz_wav() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("22k.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 22050, 16, 1000);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(
            result.is_ok(),
            "22.05kHz WAV conversion should succeed: {:?}",
            result
        );

        let dest_path = result.unwrap();
        let reader = hound::WavReader::open(&dest_path).unwrap();
        assert_eq!(
            reader.spec().sample_rate,
            44100,
            "Should be upsampled to 44.1kHz"
        );
    }

    #[test]
    fn test_copy_96khz_wav() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("96k.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 96000, 16, 1000);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(
            result.is_ok(),
            "96kHz WAV conversion should succeed: {:?}",
            result
        );

        let dest_path = result.unwrap();
        let reader = hound::WavReader::open(&dest_path).unwrap();
        assert_eq!(
            reader.spec().sample_rate,
            44100,
            "Should be downsampled to 44.1kHz"
        );
    }

    #[test]
    fn test_copy_very_short_wav() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("short.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create a WAV with just 10 samples
        create_test_wav(&source_path, 44100, 16, 10);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(result.is_ok(), "Very short WAV should copy: {:?}", result);
    }

    #[test]
    fn test_copy_wav_with_spaces_in_name() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("my sample file.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 44100, 16, 100);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(result.is_ok(), "WAV with spaces should copy: {:?}", result);
        let dest_path = result.unwrap();
        assert!(dest_path.contains("my sample file.wav"));
    }

    #[test]
    fn test_copy_wav_with_unicode_name() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("サンプル_音声.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        create_test_wav(&source_path, 44100, 16, 100);

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        assert!(
            result.is_ok(),
            "WAV with unicode name should copy: {:?}",
            result
        );
    }

    #[test]
    fn test_needs_conversion_22khz() {
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("22k.wav");
        create_test_wav(&wav_path, 22050, 16, 100);

        assert!(
            super::needs_conversion(&wav_path),
            "22.05kHz should need conversion"
        );
    }

    #[test]
    fn test_needs_conversion_96khz() {
        let temp_dir = TempDir::new().unwrap();
        let wav_path = temp_dir.path().join("96k.wav");
        create_test_wav(&wav_path, 96000, 16, 100);

        assert!(
            super::needs_conversion(&wav_path),
            "96kHz should need conversion"
        );
    }

    #[test]
    fn test_copy_corrupted_wav_header() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("corrupted.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Write invalid WAV data (just some random bytes with .wav extension)
        fs::write(
            &source_path,
            b"RIFF\x00\x00\x00\x00WAVEfmt corrupted data here",
        )
        .unwrap();

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        // Should fail gracefully with an error, not panic
        assert!(result.is_err(), "Corrupted WAV should fail");
    }

    #[test]
    fn test_copy_non_audio_as_wav() {
        let temp_dir = TempDir::new().unwrap();
        let source_path = temp_dir.path().join("fake.wav");
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Write a text file with .wav extension
        fs::write(&source_path, b"This is not a WAV file at all!").unwrap();

        let result = copy_single_file_with_progress(
            source_path.to_str().unwrap(),
            dest_dir.to_str().unwrap(),
            false,
            |_, _| {},
            None,
        );

        // Should fail gracefully
        assert!(result.is_err(), "Fake WAV should fail");
    }

    #[test]
    fn test_list_directory_with_many_files() {
        let temp_dir = TempDir::new().unwrap();

        // Create 100 files
        for i in 0..100 {
            let file_path = temp_dir.path().join(format!("file_{:03}.wav", i));
            create_test_wav(&file_path, 44100, 16, 10);
        }

        let result = list_directory(temp_dir.path().to_str().unwrap());
        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 100, "Should list all 100 files");
    }

    #[test]
    fn test_copy_multiple_files_sequentially() {
        let temp_dir = TempDir::new().unwrap();
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // Create and copy 5 files sequentially
        for i in 0..5 {
            let source_path = temp_dir.path().join(format!("sample_{}.wav", i));
            create_test_wav(&source_path, 44100, 16, 100);

            let result = copy_single_file_with_progress(
                source_path.to_str().unwrap(),
                dest_dir.to_str().unwrap(),
                false,
                |_, _| {},
                None,
            );

            assert!(result.is_ok(), "Copy {} should succeed: {:?}", i, result);
        }

        // Verify all files exist
        let files = list_directory(dest_dir.to_str().unwrap()).unwrap();
        assert_eq!(files.len(), 5, "All 5 files should be copied");
    }

    #[test]
    fn test_needs_conversion_m4a() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("audio.m4a");
        fs::write(&path, b"fake m4a data").unwrap();

        assert!(super::needs_conversion(&path), "M4A should need conversion");
    }

    #[test]
    fn test_needs_conversion_aac() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("audio.aac");
        fs::write(&path, b"fake aac data").unwrap();

        assert!(super::needs_conversion(&path), "AAC should need conversion");
    }

    #[test]
    fn test_is_audio_file_m4a() {
        assert!(
            is_audio_file("song.m4a"),
            "M4A should be recognized as audio"
        );
    }

    #[test]
    fn test_is_audio_file_uppercase_extensions() {
        assert!(is_audio_file("song.WAV"), "WAV uppercase should be audio");
        assert!(is_audio_file("song.MP3"), "MP3 uppercase should be audio");
        assert!(is_audio_file("song.FLAC"), "FLAC uppercase should be audio");
    }

    #[test]
    fn test_is_audio_file_mixed_case() {
        assert!(is_audio_file("song.WaV"), "Mixed case should be audio");
        assert!(is_audio_file("song.Mp3"), "Mixed case should be audio");
    }
}
