#![forbid(unsafe_code)]

use ot_domain::ContentHash;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const WAVEFORM_ANALYZER_VERSION: &str = "waveform:v1";
pub const MIN_TARGET_POINTS: usize = 32;
pub const MAX_TARGET_POINTS: usize = 4096;
const BASE_SAMPLES_PER_PEAK: u64 = 256;
const LEVEL_SCALE: usize = 4;
const MAX_CACHE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PREVIEW_BYTES: usize = 32 * 1024 * 1024;
const MAX_PREVIEW_SECONDS: u64 = 60;
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct WaveformPeak {
    pub min: f32,
    pub max: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WaveformSlice {
    pub analyzer_version: &'static str,
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_count: u64,
    pub samples_per_peak: u64,
    pub peaks: Vec<WaveformPeak>,
    pub cache_hit: bool,
}

impl WaveformSlice {
    pub fn duration_seconds(&self) -> f64 {
        self.frame_count as f64 / f64::from(self.sample_rate)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreviewAudio {
    pub bytes: Vec<u8>,
    pub duration_millis: u64,
    pub truncated: bool,
}

#[derive(Debug)]
pub enum AudioError {
    InvalidRequest(&'static str),
    SourceUnavailable(String),
    SourceChanged,
    UnsupportedFormat,
    DecodeFailed(String),
    UnsafeCachePath(&'static str),
    CacheUnavailable(String),
}

impl AudioError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "INVALID_AUDIO_REQUEST",
            Self::SourceUnavailable(_) => "AUDIO_SOURCE_UNAVAILABLE",
            Self::SourceChanged => "AUDIO_SOURCE_CHANGED",
            Self::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Self::DecodeFailed(_) => "CORRUPT_SOURCE",
            Self::UnsafeCachePath(_) => "AUDIO_CACHE_UNSAFE",
            Self::CacheUnavailable(_) => "AUDIO_CACHE_UNAVAILABLE",
        }
    }

    pub fn recoverable(&self) -> bool {
        !matches!(self, Self::UnsafeCachePath(_))
    }
}

impl std::fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRequest(message) => formatter.write_str(message),
            Self::SourceUnavailable(message) => {
                write!(formatter, "audio source is unavailable: {message}")
            }
            Self::SourceChanged => {
                formatter.write_str("audio source content no longer matches the catalog snapshot")
            }
            Self::UnsupportedFormat => formatter.write_str("audio format is not supported"),
            Self::DecodeFailed(message) => write!(formatter, "audio decode failed: {message}"),
            Self::UnsafeCachePath(message) => write!(formatter, "unsafe waveform cache: {message}"),
            Self::CacheUnavailable(message) => {
                write!(formatter, "waveform cache is unavailable: {message}")
            }
        }
    }
}

impl std::error::Error for AudioError {}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CachedWaveform {
    analyzer_version: String,
    asset_id: String,
    sample_rate: u32,
    channels: u16,
    frame_count: u64,
    levels: Vec<CachedWaveformLevel>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CachedWaveformLevel {
    samples_per_peak: u64,
    peaks: Vec<WaveformPeak>,
}

pub struct WaveformCache {
    directory: PathBuf,
    operation: Mutex<()>,
}

impl WaveformCache {
    pub fn open(directory: impl Into<PathBuf>) -> Result<Self, AudioError> {
        let directory = directory.into();
        ensure_real_directory(&directory)?;
        Ok(Self {
            directory,
            operation: Mutex::new(()),
        })
    }

    pub fn waveform(
        &self,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
        target_points: usize,
    ) -> Result<WaveformSlice, AudioError> {
        if !(MIN_TARGET_POINTS..=MAX_TARGET_POINTS).contains(&target_points) {
            return Err(AudioError::InvalidRequest(
                "target points must be between 32 and 4096",
            ));
        }
        let digest = validate_asset_id(asset_id, expected_hash)?;
        let source = open_verified_source(source_path, expected_hash)?;
        let _operation = self
            .operation
            .lock()
            .map_err(|_| AudioError::CacheUnavailable("waveform cache lock was poisoned".into()))?;
        let cache_path = self.directory.join(format!("waveform-v1-{digest}.json"));
        reject_unsafe_cache_entry(&cache_path)?;

        if let Some(cached) = load_cache(&cache_path, asset_id)? {
            return select_level(cached, target_points, true);
        }

        let cached = analyze(source, source_path, asset_id)?;
        write_cache(&cache_path, &cached)?;
        select_level(cached, target_points, false)
    }
}

pub fn create_preview(
    expected_hash: &ContentHash,
    source_path: &Path,
) -> Result<PreviewAudio, AudioError> {
    let source = open_verified_source(source_path, expected_hash)?;
    let mut decoded = open_decoder(source, source_path)?;
    let mut pcm = Vec::new();
    let mut frame_count = 0_u64;
    let mut truncated = false;
    let mut sample_rate = 0_u32;
    let mut output_channels = 0_usize;

    while let Some(packet) = decoded.next_packet()? {
        let audio = decoded
            .decoder
            .decode(&packet)
            .map_err(|error| AudioError::DecodeFailed(error.to_string()))?;
        let spec = *audio.spec();
        let input_channels = spec.channels.count();
        if input_channels == 0 || spec.rate == 0 {
            return Err(AudioError::DecodeFailed(
                "decoded audio has no channels or sample rate".into(),
            ));
        }
        if sample_rate == 0 {
            sample_rate = spec.rate;
            output_channels = input_channels.min(2);
        } else if sample_rate != spec.rate || output_channels != input_channels.min(2) {
            return Err(AudioError::DecodeFailed(
                "audio parameters changed during decoding".into(),
            ));
        }

        let mut samples = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
        samples.copy_interleaved_ref(audio);
        let values = samples.samples();
        if !values.len().is_multiple_of(input_channels) {
            return Err(AudioError::DecodeFailed(
                "decoded sample buffer is not frame aligned".into(),
            ));
        }

        let max_frames_by_duration = u64::from(sample_rate) * MAX_PREVIEW_SECONDS;
        let max_frames_by_bytes =
            ((MAX_PREVIEW_BYTES.saturating_sub(44)) / (output_channels * 2)) as u64;
        let max_frames = max_frames_by_duration.min(max_frames_by_bytes);
        for frame in values.chunks_exact(input_channels) {
            if frame_count >= max_frames {
                truncated = true;
                break;
            }
            for sample in frame.iter().take(output_channels) {
                if !sample.is_finite() {
                    return Err(AudioError::DecodeFailed(
                        "decoded audio contains a non-finite sample".into(),
                    ));
                }
                let clamped = sample.clamp(-1.0, 1.0);
                let encoded = if clamped < 0.0 {
                    (clamped * 32768.0) as i16
                } else {
                    (clamped * 32767.0) as i16
                };
                pcm.extend_from_slice(&encoded.to_le_bytes());
            }
            frame_count += 1;
        }
        if truncated {
            break;
        }
    }

    if frame_count == 0 || sample_rate == 0 || output_channels == 0 {
        return Err(AudioError::DecodeFailed(
            "audio source contains no decodable samples".into(),
        ));
    }
    let bytes = encode_pcm_wav(&pcm, sample_rate, output_channels as u16)?;
    Ok(PreviewAudio {
        bytes,
        duration_millis: frame_count.saturating_mul(1000) / u64::from(sample_rate),
        truncated,
    })
}

fn analyze(source: File, source_path: &Path, asset_id: &str) -> Result<CachedWaveform, AudioError> {
    let mut decoded = open_decoder(source, source_path)?;
    let mut accumulator = PeakAccumulator::new(BASE_SAMPLES_PER_PEAK);
    let mut frame_count = 0_u64;
    let mut sample_rate = 0_u32;
    let mut channels = 0_usize;

    while let Some(packet) = decoded.next_packet()? {
        let audio = decoded
            .decoder
            .decode(&packet)
            .map_err(|error| AudioError::DecodeFailed(error.to_string()))?;
        let spec = *audio.spec();
        let packet_channels = spec.channels.count();
        if packet_channels == 0 || spec.rate == 0 {
            return Err(AudioError::DecodeFailed(
                "decoded audio has no channels or sample rate".into(),
            ));
        }
        if sample_rate == 0 {
            sample_rate = spec.rate;
            channels = packet_channels;
        } else if sample_rate != spec.rate || channels != packet_channels {
            return Err(AudioError::DecodeFailed(
                "audio parameters changed during decoding".into(),
            ));
        }

        let mut samples = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
        samples.copy_interleaved_ref(audio);
        let values = samples.samples();
        if !values.len().is_multiple_of(channels) {
            return Err(AudioError::DecodeFailed(
                "decoded sample buffer is not frame aligned".into(),
            ));
        }
        for frame in values.chunks_exact(channels) {
            let mut minimum = 1.0_f32;
            let mut maximum = -1.0_f32;
            for sample in frame {
                if !sample.is_finite() {
                    return Err(AudioError::DecodeFailed(
                        "decoded audio contains a non-finite sample".into(),
                    ));
                }
                minimum = minimum.min(*sample);
                maximum = maximum.max(*sample);
            }
            accumulator.push(minimum.clamp(-1.0, 1.0), maximum.clamp(-1.0, 1.0));
            frame_count += 1;
        }
    }

    if frame_count == 0 || sample_rate == 0 || channels == 0 {
        return Err(AudioError::DecodeFailed(
            "audio source contains no decodable samples".into(),
        ));
    }
    let base = accumulator.finish();
    let mut levels = vec![CachedWaveformLevel {
        samples_per_peak: BASE_SAMPLES_PER_PEAK,
        peaks: base,
    }];
    while levels
        .last()
        .is_some_and(|level| level.peaks.len() > MIN_TARGET_POINTS)
    {
        let previous = levels.last().expect("waveform always has a base level");
        let peaks = aggregate_peaks(&previous.peaks, LEVEL_SCALE);
        if peaks.len() == previous.peaks.len() {
            break;
        }
        levels.push(CachedWaveformLevel {
            samples_per_peak: previous.samples_per_peak * LEVEL_SCALE as u64,
            peaks,
        });
    }

    Ok(CachedWaveform {
        analyzer_version: WAVEFORM_ANALYZER_VERSION.into(),
        asset_id: asset_id.into(),
        sample_rate,
        channels: u16::try_from(channels)
            .map_err(|_| AudioError::DecodeFailed("too many audio channels".into()))?,
        frame_count,
        levels,
    })
}

struct DecoderState {
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
}

impl DecoderState {
    fn next_packet(&mut self) -> Result<Option<symphonia::core::formats::Packet>, AudioError> {
        loop {
            match self.format.next_packet() {
                Ok(packet) if packet.track_id() == self.track_id => return Ok(Some(packet)),
                Ok(_) => continue,
                Err(SymphoniaError::IoError(error))
                    if error.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    return Ok(None)
                }
                Err(error) => return Err(AudioError::DecodeFailed(error.to_string())),
            }
        }
    }
}

fn open_decoder(file: File, path: &Path) -> Result<DecoderState, AudioError> {
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| AudioError::UnsupportedFormat)?;
    let format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or(AudioError::UnsupportedFormat)?;
    let track_id = track.id;
    let decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| AudioError::UnsupportedFormat)?;
    Ok(DecoderState {
        format,
        decoder,
        track_id,
    })
}

struct PeakAccumulator {
    samples_per_peak: u64,
    count: u64,
    minimum: f32,
    maximum: f32,
    peaks: Vec<WaveformPeak>,
}

impl PeakAccumulator {
    fn new(samples_per_peak: u64) -> Self {
        Self {
            samples_per_peak,
            count: 0,
            minimum: 1.0,
            maximum: -1.0,
            peaks: Vec::new(),
        }
    }

    fn push(&mut self, minimum: f32, maximum: f32) {
        self.minimum = self.minimum.min(minimum);
        self.maximum = self.maximum.max(maximum);
        self.count += 1;
        if self.count == self.samples_per_peak {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.count == 0 {
            return;
        }
        self.peaks.push(WaveformPeak {
            min: self.minimum,
            max: self.maximum,
        });
        self.count = 0;
        self.minimum = 1.0;
        self.maximum = -1.0;
    }

    fn finish(mut self) -> Vec<WaveformPeak> {
        self.flush();
        self.peaks
    }
}

fn aggregate_peaks(peaks: &[WaveformPeak], scale: usize) -> Vec<WaveformPeak> {
    peaks
        .chunks(scale)
        .map(|chunk| WaveformPeak {
            min: chunk.iter().map(|peak| peak.min).fold(1.0, f32::min),
            max: chunk.iter().map(|peak| peak.max).fold(-1.0, f32::max),
        })
        .collect()
}

fn select_level(
    cached: CachedWaveform,
    target_points: usize,
    cache_hit: bool,
) -> Result<WaveformSlice, AudioError> {
    validate_cached_waveform(&cached)?;
    let level = cached
        .levels
        .iter()
        .find(|level| level.peaks.len() <= target_points)
        .or_else(|| cached.levels.last())
        .ok_or_else(|| AudioError::CacheUnavailable("waveform has no levels".into()))?;
    Ok(WaveformSlice {
        analyzer_version: WAVEFORM_ANALYZER_VERSION,
        sample_rate: cached.sample_rate,
        channels: cached.channels,
        frame_count: cached.frame_count,
        samples_per_peak: level.samples_per_peak,
        peaks: level.peaks.clone(),
        cache_hit,
    })
}

fn load_cache(path: &Path, asset_id: &str) -> Result<Option<CachedWaveform>, AudioError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(cache_io(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AudioError::UnsafeCachePath(
            "cache entry must be a regular file",
        ));
    }
    if metadata.len() > MAX_CACHE_BYTES {
        return Ok(None);
    }
    let reader = BufReader::new(File::open(path).map_err(cache_io)?);
    let cached: CachedWaveform = match serde_json::from_reader(reader) {
        Ok(cached) => cached,
        Err(_) => return Ok(None),
    };
    if cached.analyzer_version != WAVEFORM_ANALYZER_VERSION || cached.asset_id != asset_id {
        return Ok(None);
    }
    if validate_cached_waveform(&cached).is_err() {
        return Ok(None);
    }
    Ok(Some(cached))
}

fn validate_cached_waveform(cached: &CachedWaveform) -> Result<(), AudioError> {
    if cached.sample_rate == 0
        || cached.channels == 0
        || cached.frame_count == 0
        || cached.levels.is_empty()
    {
        return Err(AudioError::CacheUnavailable(
            "waveform metadata is invalid".into(),
        ));
    }
    let mut expected_scale = BASE_SAMPLES_PER_PEAK;
    for (index, level) in cached.levels.iter().enumerate() {
        let expected_peak_count = cached.frame_count.div_ceil(expected_scale);
        if level.samples_per_peak != expected_scale
            || level.peaks.is_empty()
            || u64::try_from(level.peaks.len()).ok() != Some(expected_peak_count)
        {
            return Err(AudioError::CacheUnavailable(
                "waveform level shape is invalid".into(),
            ));
        }
        if level.peaks.iter().any(|peak| {
            !peak.min.is_finite()
                || !peak.max.is_finite()
                || peak.min < -1.0
                || peak.max > 1.0
                || peak.min > peak.max
        }) {
            return Err(AudioError::CacheUnavailable(
                "waveform peak data is invalid".into(),
            ));
        }
        if index + 1 < cached.levels.len() {
            expected_scale = expected_scale
                .checked_mul(LEVEL_SCALE as u64)
                .ok_or_else(|| {
                    AudioError::CacheUnavailable("waveform level scale overflowed".into())
                })?;
        }
    }
    Ok(())
}

fn write_cache(path: &Path, cached: &CachedWaveform) -> Result<(), AudioError> {
    let encoded = serde_json::to_vec(cached).map_err(|error| {
        AudioError::CacheUnavailable(format!("could not encode cache: {error}"))
    })?;
    if encoded.len() as u64 > MAX_CACHE_BYTES {
        return Err(AudioError::CacheUnavailable(
            "waveform cache entry exceeds the size limit".into(),
        ));
    }
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_extension(format!("tmp-{}-{sequence}", std::process::id()));
    let result = (|| {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(cache_io)?;
        let mut writer = BufWriter::new(file);
        writer.write_all(&encoded).map_err(cache_io)?;
        writer.flush().map_err(cache_io)?;
        writer.get_ref().sync_all().map_err(cache_io)?;
        drop(writer);
        fs::rename(&temporary, path).map_err(cache_io)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn open_verified_source(path: &Path, expected_hash: &ContentHash) -> Result<File, AudioError> {
    let metadata = fs::symlink_metadata(path).map_err(source_io)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AudioError::SourceUnavailable(
            "source must be a regular non-symlink file".into(),
        ));
    }
    let mut file = File::open(path).map_err(source_io)?;
    if !file.metadata().map_err(source_io)?.is_file() {
        return Err(AudioError::SourceUnavailable(
            "source must be a regular file".into(),
        ));
    }
    let opened_metadata = fs::symlink_metadata(path).map_err(source_io)?;
    if opened_metadata.file_type().is_symlink() || !opened_metadata.is_file() {
        return Err(AudioError::SourceUnavailable(
            "source changed while it was being opened".into(),
        ));
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(source_io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("sha256:{:x}", hasher.finalize());
    if actual != expected_hash.as_str() {
        return Err(AudioError::SourceChanged);
    }
    file.rewind().map_err(source_io)?;
    Ok(file)
}

fn encode_pcm_wav(pcm: &[u8], sample_rate: u32, channels: u16) -> Result<Vec<u8>, AudioError> {
    let data_size = u32::try_from(pcm.len())
        .map_err(|_| AudioError::DecodeFailed("preview output is too large".into()))?;
    let block_align = channels
        .checked_mul(2)
        .ok_or_else(|| AudioError::DecodeFailed("invalid preview channel count".into()))?;
    let byte_rate = sample_rate
        .checked_mul(u32::from(block_align))
        .ok_or_else(|| AudioError::DecodeFailed("invalid preview sample rate".into()))?;
    let mut bytes = Vec::with_capacity(44 + pcm.len());
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36_u32 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block_align.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.extend_from_slice(pcm);
    Ok(bytes)
}

fn validate_asset_id<'a>(
    asset_id: &'a str,
    expected_hash: &ContentHash,
) -> Result<&'a str, AudioError> {
    let digest = asset_id
        .strip_prefix("asset:v1:")
        .ok_or(AudioError::InvalidRequest("invalid opaque asset ID"))?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AudioError::InvalidRequest("invalid opaque asset ID"));
    }
    let mut hasher = Sha256::new();
    hasher.update(b"asset:v1");
    hasher.update((expected_hash.as_str().len() as u64).to_be_bytes());
    hasher.update(expected_hash.as_str().as_bytes());
    let expected_asset_id = format!("asset:v1:{:x}", hasher.finalize());
    if asset_id != expected_asset_id {
        return Err(AudioError::InvalidRequest(
            "asset ID does not match the expected content identity",
        ));
    }
    Ok(digest)
}

fn ensure_real_directory(path: &Path) -> Result<(), AudioError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(AudioError::UnsafeCachePath(
                    "cache directory must be a real directory",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(cache_io)?;
        }
        Err(error) => return Err(cache_io(error)),
    }
    Ok(())
}

fn reject_unsafe_cache_entry(path: &Path) -> Result<(), AudioError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(
            AudioError::UnsafeCachePath("cache entry must be a regular file"),
        ),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cache_io(error)),
    }
}

fn source_io(error: std::io::Error) -> AudioError {
    AudioError::SourceUnavailable(error.to_string())
}

fn cache_io(error: std::io::Error) -> AudioError {
    AudioError::CacheUnavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;
    use tempfile::TempDir;

    fn write_wav(path: &Path, frames: usize) {
        let sample_rate = 44_100_u32;
        let channels = 2_u16;
        let mut pcm = Vec::with_capacity(frames * usize::from(channels) * 2);
        for frame in 0..frames {
            let sample = ((frame as f32 * 440.0 * 2.0 * PI / sample_rate as f32).sin()
                * 0.75
                * i16::MAX as f32) as i16;
            for _ in 0..channels {
                pcm.extend_from_slice(&sample.to_le_bytes());
            }
        }
        fs::write(path, encode_pcm_wav(&pcm, sample_rate, channels).unwrap()).unwrap();
    }

    fn write_aiff(path: &Path, frames: usize) {
        let channels = 1_u16;
        let mut pcm = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let sample = if frame % 128 < 64 {
                i16::MAX / 2
            } else {
                i16::MIN / 2
            };
            pcm.extend_from_slice(&sample.to_be_bytes());
        }
        let sound_chunk_size = 8_u32 + u32::try_from(pcm.len()).unwrap();
        let form_size = 4_u32 + (8 + 18) + (8 + sound_chunk_size);
        let mut aiff = Vec::with_capacity(form_size as usize + 8);
        aiff.extend_from_slice(b"FORM");
        aiff.extend_from_slice(&form_size.to_be_bytes());
        aiff.extend_from_slice(b"AIFFCOMM");
        aiff.extend_from_slice(&18_u32.to_be_bytes());
        aiff.extend_from_slice(&channels.to_be_bytes());
        aiff.extend_from_slice(&u32::try_from(frames).unwrap().to_be_bytes());
        aiff.extend_from_slice(&16_u16.to_be_bytes());
        aiff.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
        aiff.extend_from_slice(b"SSND");
        aiff.extend_from_slice(&sound_chunk_size.to_be_bytes());
        aiff.extend_from_slice(&0_u32.to_be_bytes());
        aiff.extend_from_slice(&0_u32.to_be_bytes());
        aiff.extend_from_slice(&pcm);
        fs::write(path, aiff).unwrap();
    }

    fn content_hash(path: &Path) -> ContentHash {
        let bytes = fs::read(path).unwrap();
        ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap()
    }

    fn asset_id(hash: &ContentHash) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"asset:v1");
        hasher.update((hash.as_str().len() as u64).to_be_bytes());
        hasher.update(hash.as_str().as_bytes());
        format!("asset:v1:{:x}", hasher.finalize())
    }

    #[test]
    fn creates_multiple_waveform_levels_and_reuses_the_cache() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 44_100 * 3);
        let before = fs::read(&audio_path).unwrap();
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCache::open(cache.path()).unwrap();

        let first = cache.waveform(&id, &hash, &audio_path, 400).unwrap();
        let second = cache.waveform(&id, &hash, &audio_path, 400).unwrap();

        assert!(!first.cache_hit);
        assert!(second.cache_hit);
        assert_eq!(first.peaks, second.peaks);
        assert!(first.peaks.len() <= 400);
        assert_eq!(first.sample_rate, 44_100);
        assert_eq!(first.channels, 2);
        assert_eq!(fs::read(&audio_path).unwrap(), before);
    }

    #[test]
    fn rejects_a_changed_source_before_returning_a_cached_waveform() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 4096);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCache::open(cache.path()).unwrap();
        cache.waveform(&id, &hash, &audio_path, 128).unwrap();
        fs::write(&audio_path, b"changed with the same catalog identity").unwrap();

        let error = cache.waveform(&id, &hash, &audio_path, 128).unwrap_err();

        assert!(matches!(error, AudioError::SourceChanged));
    }

    #[test]
    fn creates_a_bounded_browser_safe_pcm_preview() {
        let fixture = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 44_100);
        let before = fs::read(&audio_path).unwrap();
        let hash = content_hash(&audio_path);

        let preview = create_preview(&hash, &audio_path).unwrap();

        assert_eq!(&preview.bytes[0..4], b"RIFF");
        assert_eq!(&preview.bytes[8..12], b"WAVE");
        assert_eq!(preview.duration_millis, 1000);
        assert!(!preview.truncated);
        assert_eq!(fs::read(&audio_path).unwrap(), before);
    }

    #[test]
    fn decodes_aiff_for_waveform_and_pcm_preview() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.aiff");
        write_aiff(&audio_path, 4096);
        let before = fs::read(&audio_path).unwrap();
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCache::open(cache.path()).unwrap();

        let waveform = cache.waveform(&id, &hash, &audio_path, 128).unwrap();
        let preview = create_preview(&hash, &audio_path).unwrap();

        assert_eq!(waveform.sample_rate, 44_100);
        assert_eq!(waveform.channels, 1);
        assert_eq!(waveform.frame_count, 4096);
        assert_eq!(&preview.bytes[0..4], b"RIFF");
        assert_eq!(&preview.bytes[8..12], b"WAVE");
        assert_eq!(fs::read(&audio_path).unwrap(), before);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_cache_and_source_entries() {
        use std::os::unix::fs::symlink;

        let parent = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let cache_link = parent.path().join("cache");
        symlink(outside.path(), &cache_link).unwrap();
        assert!(matches!(
            WaveformCache::open(&cache_link),
            Err(AudioError::UnsafeCachePath(_))
        ));

        let source = parent.path().join("source.wav");
        let outside_audio = outside.path().join("outside.wav");
        write_wav(&outside_audio, 1024);
        symlink(&outside_audio, &source).unwrap();
        let hash = content_hash(&outside_audio);
        assert!(matches!(
            create_preview(&hash, &source),
            Err(AudioError::SourceUnavailable(_))
        ));
    }

    #[test]
    fn rejects_invalid_resolution_and_asset_identifiers() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 1024);
        let hash = content_hash(&audio_path);
        let cache = WaveformCache::open(cache.path()).unwrap();

        assert!(matches!(
            cache.waveform("asset:v1:not-opaque", &hash, &audio_path, 128),
            Err(AudioError::InvalidRequest(_))
        ));
        let id = asset_id(&hash);
        assert!(matches!(
            cache.waveform(&id, &hash, &audio_path, 1),
            Err(AudioError::InvalidRequest(_))
        ));
        let mismatched = format!("asset:v1:{}", "a".repeat(64));
        assert!(matches!(
            cache.waveform(&mismatched, &hash, &audio_path, 128),
            Err(AudioError::InvalidRequest(_))
        ));
    }

    #[test]
    fn regenerates_a_cache_with_inconsistent_frame_and_peak_counts() {
        let fixture = TempDir::new().unwrap();
        let cache_directory = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 4096);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let digest = id.strip_prefix("asset:v1:").unwrap();
        let cache_path = cache_directory
            .path()
            .join(format!("waveform-v1-{digest}.json"));
        let poisoned = CachedWaveform {
            analyzer_version: WAVEFORM_ANALYZER_VERSION.into(),
            asset_id: id.clone(),
            sample_rate: 44_100,
            channels: 2,
            frame_count: 4096,
            levels: vec![CachedWaveformLevel {
                samples_per_peak: BASE_SAMPLES_PER_PEAK,
                peaks: vec![WaveformPeak {
                    min: -0.1,
                    max: 0.1,
                }],
            }],
        };
        fs::write(&cache_path, serde_json::to_vec(&poisoned).unwrap()).unwrap();
        let cache = WaveformCache::open(cache_directory.path()).unwrap();

        let waveform = cache.waveform(&id, &hash, &audio_path, 128).unwrap();

        assert!(!waveform.cache_hit);
        assert_eq!(waveform.peaks.len(), 16);
    }
}
