//! Library waveform v2: per-channel peaks with full-file cache and range queries.

use crate::wfm2::{
    aggregate_peaks, build_pyramid_levels, load_wfm2_metadata, read_level_peaks, write_wfm2,
    Wfm2Metadata, Wfm2Pyramid,
};
use crate::{
    ensure_real_directory, open_decoder, open_verified_source, reject_unsafe_cache_entry,
    validate_asset_id, wfm2, AudioError, WaveformPeak, MAX_CACHE_BYTES, MAX_TARGET_POINTS,
    MIN_TARGET_POINTS,
};
use ot_domain::ContentHash;
use std::collections::HashMap;
use std::fs::File;
use std::io::Seek;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use symphonia::core::audio::SampleBuffer;

pub const WAVEFORM_V2_ANALYZER_VERSION: &str = "waveform:v2";
const BASE_SAMPLES_PER_PEAK: u64 = 256;

#[derive(Clone, Debug, PartialEq)]
pub struct FrameRange {
    pub start: u64,
    pub end_exclusive: u64,
}

impl FrameRange {
    pub fn parse(start: &str, end_exclusive: &str, frame_count: u64) -> Result<Self, AudioError> {
        let start = parse_decimal_frame(start)?;
        let end_exclusive = parse_decimal_frame(end_exclusive)?;
        if start >= end_exclusive {
            return Err(AudioError::InvalidRequest(
                "frame range is empty or inverted",
            ));
        }
        if end_exclusive > frame_count {
            return Err(AudioError::InvalidRequest(
                "frame range extends beyond the source length",
            ));
        }
        Ok(Self {
            start,
            end_exclusive,
        })
    }

    pub fn full(frame_count: u64) -> Result<Self, AudioError> {
        if frame_count == 0 {
            return Err(AudioError::InvalidRequest(
                "audio source contains no frames",
            ));
        }
        Ok(Self {
            start: 0,
            end_exclusive: frame_count,
        })
    }

    pub fn len(&self) -> u64 {
        self.end_exclusive - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.start >= self.end_exclusive
    }
}

pub fn parse_decimal_frame(value: &str) -> Result<u64, AudioError> {
    if !value.chars().all(|ch| ch.is_ascii_digit()) || value.is_empty() {
        return Err(AudioError::InvalidRequest(
            "frame must be a canonical decimal u64",
        ));
    }
    if value.len() > 1 && value.starts_with('0') {
        return Err(AudioError::InvalidRequest(
            "frame must be a canonical decimal u64",
        ));
    }
    value
        .parse::<u64>()
        .map_err(|_| AudioError::InvalidRequest("frame must be a canonical decimal u64"))
}

#[derive(Clone, Debug, PartialEq)]
pub struct WaveformQueryResult {
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_count: u64,
    pub range: FrameRange,
    pub frames_per_peak: u64,
    pub channel_peaks: Vec<Vec<WaveformPeak>>,
    pub cache_hit: bool,
}

pub struct WaveformCacheV2 {
    directory: PathBuf,
    digest_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl WaveformCacheV2 {
    pub fn open(directory: impl Into<PathBuf>) -> Result<Self, AudioError> {
        let directory = directory.into();
        ensure_real_directory(&directory)?;
        Ok(Self {
            directory,
            digest_locks: Mutex::new(HashMap::new()),
        })
    }

    fn lock_digest(&self, digest: &str) -> Result<Arc<Mutex<()>>, AudioError> {
        let mut locks = self
            .digest_locks
            .lock()
            .map_err(|_| AudioError::CacheUnavailable("waveform cache lock was poisoned".into()))?;
        Ok(locks
            .entry(digest.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    pub fn query<F>(
        &self,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
        range: Option<(&str, &str)>,
        target_points: usize,
        check_cancel: &mut F,
    ) -> Result<WaveformQueryResult, AudioError>
    where
        F: FnMut() -> Result<(), AudioError>,
    {
        if !(MIN_TARGET_POINTS..=MAX_TARGET_POINTS).contains(&target_points) {
            return Err(AudioError::InvalidRequest(
                "target points must be between 32 and 4096",
            ));
        }
        let _digest = validate_asset_id(asset_id, expected_hash)?;
        check_cancel()?;
        let mut source = open_verified_source(source_path, expected_hash)?;
        check_cancel()?;
        let digest = asset_id
            .strip_prefix("asset:v1:")
            .expect("validated asset id");
        let cache_path = self.directory.join(format!("waveform-v2-{digest}.wfm2"));
        reject_unsafe_cache_entry(&cache_path)?;

        let digest_lock = self.lock_digest(digest)?;
        let _guard = digest_lock
            .lock()
            .map_err(|_| AudioError::CacheUnavailable("waveform cache lock was poisoned".into()))?;

        let (meta, cache_hit) = if let Some(meta) = load_wfm2_metadata(&cache_path, asset_id)? {
            (meta, true)
        } else {
            check_cancel()?;
            let pyramid = analyze(&mut source, source_path, asset_id, check_cancel)?;
            write_wfm2(&cache_path, &pyramid)?;
            let meta = load_wfm2_metadata(&cache_path, asset_id)?
                .expect("wfm2 cache should exist after write");
            (meta, false)
        };
        drop(_guard);

        let frame_count = meta.frame_count;
        let range = match range {
            Some((start, end_exclusive)) => FrameRange::parse(start, end_exclusive, frame_count)?,
            None => FrameRange::full(frame_count)?,
        };
        let channel_peaks = aggregate_range_peaks(
            &mut source,
            source_path,
            &cache_path,
            &meta,
            &range,
            target_points,
            check_cancel,
        )?;
        let frames_per_peak = range.len().div_ceil(target_points as u64).max(1);

        Ok(WaveformQueryResult {
            sample_rate: meta.sample_rate,
            channels: meta.channels,
            frame_count,
            range,
            frames_per_peak,
            channel_peaks,
            cache_hit,
        })
    }
}

fn select_waveform_level_index(meta: &Wfm2Metadata, frames_per_output_bucket: u64) -> usize {
    meta.levels
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, level)| {
            if level.frames_per_bucket <= frames_per_output_bucket {
                Some(index)
            } else {
                None
            }
        })
        .unwrap_or(0)
}

fn merge_peak(into: &mut WaveformPeak, from: WaveformPeak) {
    into.min = into.min.min(from.min);
    into.max = into.max.max(from.max);
}

fn merge_intervals(mut spans: Vec<(u64, u64)>) -> Vec<(u64, u64)> {
    if spans.is_empty() {
        return spans;
    }
    spans.sort_unstable_by_key(|span| span.0);
    let mut merged = vec![spans[0]];
    for (start, end) in spans.into_iter().skip(1) {
        let last = merged.last_mut().expect("merged spans");
        if start <= last.1 {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    merged
}

#[allow(clippy::needless_range_loop)]
fn aggregate_range_peaks<F>(
    source: &mut File,
    source_path: &Path,
    cache_path: &Path,
    meta: &Wfm2Metadata,
    range: &FrameRange,
    target_points: usize,
    check_cancel: &mut F,
) -> Result<Vec<Vec<WaveformPeak>>, AudioError>
where
    F: FnMut() -> Result<(), AudioError>,
{
    wfm2::validate_metadata(meta)?;
    let channels = usize::from(meta.channels);
    let range_len = range.len();
    if range_len == 0 {
        return Err(AudioError::InvalidRequest(
            "frame range is empty or inverted",
        ));
    }

    let frames_per_bucket = range_len.div_ceil(target_points as u64).max(1);
    let level_index = select_waveform_level_index(meta, frames_per_bucket);

    let mut channel_buckets: Vec<Vec<WaveformPeak>> = (0..channels)
        .map(|_| {
            (0..target_points)
                .map(|_| WaveformPeak {
                    min: f32::INFINITY,
                    max: f32::NEG_INFINITY,
                })
                .collect()
        })
        .collect();

    let mut residual_spans = Vec::new();

    for bucket_index in 0..target_points {
        check_cancel()?;
        let bucket_start = range.start + bucket_index as u64 * frames_per_bucket;
        if bucket_start >= range.end_exclusive {
            break;
        }
        let bucket_end = (bucket_start + frames_per_bucket).min(range.end_exclusive);
        fill_output_bucket_from_level(
            cache_path,
            meta,
            level_index,
            bucket_start,
            bucket_end,
            channels,
            bucket_index,
            &mut channel_buckets,
            &mut residual_spans,
            check_cancel,
        )?;
    }

    let residual_spans = merge_intervals(residual_spans);
    if !residual_spans.is_empty() {
        source.rewind().map_err(|error| {
            AudioError::SourceUnavailable(format!("could not rewind audio source: {error}"))
        })?;
        decode_residual_spans(
            source,
            source_path,
            channels,
            range,
            target_points,
            &residual_spans,
            &mut channel_buckets,
            check_cancel,
        )?;
    }

    for channel in &mut channel_buckets {
        for peak in channel.iter_mut() {
            if !peak.min.is_finite() {
                *peak = WaveformPeak { min: 0.0, max: 0.0 };
            }
        }
    }
    Ok(channel_buckets)
}

#[allow(clippy::too_many_arguments)]
fn fill_output_bucket_from_level<F>(
    cache_path: &Path,
    meta: &Wfm2Metadata,
    level_index: usize,
    bucket_start: u64,
    bucket_end: u64,
    channels: usize,
    bucket_index: usize,
    channel_buckets: &mut [Vec<WaveformPeak>],
    residual_spans: &mut Vec<(u64, u64)>,
    check_cancel: &mut F,
) -> Result<(), AudioError>
where
    F: FnMut() -> Result<(), AudioError>,
{
    check_cancel()?;
    let level = &meta.levels[level_index];
    let samples_per_peak = level.frames_per_bucket;
    let mut cursor = bucket_start;
    let first_peak = bucket_start.div_ceil(samples_per_peak);
    let last_peak = bucket_end.saturating_sub(1) / samples_per_peak;
    for peak_index in first_peak..=last_peak {
        let peak_start = peak_index * samples_per_peak;
        let peak_end = (peak_index + 1) * samples_per_peak;
        if peak_start >= bucket_start && peak_end <= bucket_end {
            if cursor < peak_start {
                if level_index == 0 {
                    residual_spans.push((cursor, peak_start));
                } else {
                    fill_output_bucket_from_level(
                        cache_path,
                        meta,
                        level_index - 1,
                        cursor,
                        peak_start,
                        channels,
                        bucket_index,
                        channel_buckets,
                        residual_spans,
                        check_cancel,
                    )?;
                }
            }
            for (channel_index, channel_bucket) in
                channel_buckets.iter_mut().enumerate().take(channels)
            {
                let peak = read_level_peaks(
                    cache_path,
                    meta,
                    level_index,
                    channel_index,
                    peak_index,
                    peak_index + 1,
                )?
                .into_iter()
                .next()
                .expect("single peak read");
                merge_peak(&mut channel_bucket[bucket_index], peak);
            }
            cursor = peak_end;
        }
    }
    if cursor < bucket_end {
        if level_index == 0 {
            residual_spans.push((cursor, bucket_end));
        } else {
            fill_output_bucket_from_level(
                cache_path,
                meta,
                level_index - 1,
                cursor,
                bucket_end,
                channels,
                bucket_index,
                channel_buckets,
                residual_spans,
                check_cancel,
            )?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn decode_residual_spans<F>(
    source: &mut File,
    source_path: &Path,
    channels: usize,
    range: &FrameRange,
    target_points: usize,
    spans: &[(u64, u64)],
    channel_buckets: &mut [Vec<WaveformPeak>],
    check_cancel: &mut F,
) -> Result<(), AudioError>
where
    F: FnMut() -> Result<(), AudioError>,
{
    let range_len = range.len();
    let max_frame = spans.iter().map(|span| span.1).max().unwrap_or(range.start);
    let mut decoded = open_decoder(
        source.try_clone().map_err(|error| {
            AudioError::SourceUnavailable(format!("could not clone audio source: {error}"))
        })?,
        source_path,
    )?;
    let mut frame_index = 0_u64;
    let mut sample_rate = 0_u32;
    let mut decoded_channels = 0_usize;

    'decode: while frame_index < max_frame {
        check_cancel()?;
        let Some(packet) = decoded.next_packet()? else {
            break;
        };
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
            decoded_channels = packet_channels;
        } else if sample_rate != spec.rate || decoded_channels != packet_channels {
            return Err(AudioError::DecodeFailed(
                "audio parameters changed during decoding".into(),
            ));
        }
        if decoded_channels != channels {
            return Err(AudioError::DecodeFailed(
                "decoded channel count does not match cached waveform".into(),
            ));
        }

        let mut samples = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
        samples.copy_interleaved_ref(audio);
        let values = samples.samples();
        if !values.len().is_multiple_of(decoded_channels) {
            return Err(AudioError::DecodeFailed(
                "decoded sample buffer is not frame aligned".into(),
            ));
        }
        for frame in values.chunks_exact(decoded_channels) {
            if spans
                .iter()
                .any(|(start, end)| frame_index >= *start && frame_index < *end)
                && frame_index >= range.start
                && frame_index < range.end_exclusive
            {
                let offset = frame_index - range.start;
                let bucket = (offset * target_points as u64 / range_len) as usize;
                let bucket = bucket.min(target_points - 1);
                for (channel_index, sample) in frame.iter().enumerate() {
                    if !sample.is_finite() {
                        return Err(AudioError::DecodeFailed(
                            "decoded audio contains a non-finite sample".into(),
                        ));
                    }
                    let sample = sample.clamp(-1.0, 1.0);
                    let peak = &mut channel_buckets[channel_index][bucket];
                    peak.min = peak.min.min(sample);
                    peak.max = peak.max.max(sample);
                }
            }
            frame_index += 1;
            if frame_index >= max_frame {
                break 'decode;
            }
        }
    }
    Ok(())
}

fn analyze<F>(
    source: &mut File,
    source_path: &Path,
    asset_id: &str,
    check_cancel: &mut F,
) -> Result<Wfm2Pyramid, AudioError>
where
    F: FnMut() -> Result<(), AudioError>,
{
    source.rewind().map_err(|error| {
        AudioError::SourceUnavailable(format!("could not rewind audio source: {error}"))
    })?;
    let mut decoded = open_decoder(
        source.try_clone().map_err(|error| {
            AudioError::SourceUnavailable(format!("could not clone audio source: {error}"))
        })?,
        source_path,
    )?;
    let mut frame_count = 0_u64;
    let mut sample_rate = 0_u32;
    let mut channels = 0_usize;
    let mut accumulators: Vec<ChannelPeakAccumulator> = Vec::new();

    while let Some(packet) = decoded.next_packet()? {
        check_cancel()?;
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
            accumulators = (0..channels)
                .map(|_| ChannelPeakAccumulator::new(BASE_SAMPLES_PER_PEAK))
                .collect();
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
            for (channel_index, sample) in frame.iter().enumerate() {
                if !sample.is_finite() {
                    return Err(AudioError::DecodeFailed(
                        "decoded audio contains a non-finite sample".into(),
                    ));
                }
                accumulators[channel_index].push(sample.clamp(-1.0, 1.0));
            }
            frame_count += 1;
        }
    }

    if frame_count == 0 || sample_rate == 0 || channels == 0 {
        return Err(AudioError::InvalidRequest(
            "audio source contains no frames",
        ));
    }

    let mut base_channels: Vec<Vec<WaveformPeak>> = accumulators
        .into_iter()
        .map(|accumulator| accumulator.finish())
        .collect();
    let mut base_frames = BASE_SAMPLES_PER_PEAK;
    let channels_u16 = u16::try_from(channels)
        .map_err(|_| AudioError::DecodeFailed("too many audio channels".into()))?;
    while wfm2::estimate_file_size(frame_count, channels_u16, base_frames) > MAX_CACHE_BYTES {
        base_channels = base_channels
            .iter()
            .map(|peaks| aggregate_peaks(peaks, wfm2::WFM2_LEVEL_SCALE as usize))
            .collect();
        base_frames = base_frames
            .checked_mul(u64::from(wfm2::WFM2_LEVEL_SCALE))
            .ok_or_else(|| {
                AudioError::CacheUnavailable("waveform base stride overflowed".into())
            })?;
    }
    let levels = build_pyramid_levels(base_channels, base_frames, frame_count);

    Ok(Wfm2Pyramid {
        asset_id: asset_id.into(),
        sample_rate,
        channels: channels_u16,
        frame_count,
        base_frames_per_bucket: base_frames,
        levels,
    })
}

struct ChannelPeakAccumulator {
    samples_per_peak: u64,
    count: u64,
    minimum: f32,
    maximum: f32,
    peaks: Vec<WaveformPeak>,
}

impl ChannelPeakAccumulator {
    fn new(samples_per_peak: u64) -> Self {
        Self {
            samples_per_peak,
            count: 0,
            minimum: 1.0,
            maximum: -1.0,
            peaks: Vec::new(),
        }
    }

    fn push(&mut self, sample: f32) {
        self.minimum = self.minimum.min(sample);
        self.maximum = self.maximum.max(sample);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{create_preview, WaveformCache};
    use sha2::{Digest, Sha256};
    use std::f32::consts::PI;
    use std::fs;
    use tempfile::TempDir;

    fn write_impulse_wav(path: &Path, frames: usize) {
        let sample_rate = 44_100_u32;
        let channels = 1_u16;
        let mut pcm = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let sample = if frame == 0 { i16::MAX / 2 } else { 0 };
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        fs::write(path, encode_pcm_wav(&pcm, sample_rate, channels)).unwrap();
    }

    fn write_wav(path: &Path, frames: usize) {
        let sample_rate = 44_100_u32;
        let channels = 2_u16;
        let mut pcm = Vec::with_capacity(frames * usize::from(channels) * 2);
        for frame in 0..frames {
            let sample = if frame % 128 == 0 {
                i16::MAX / 2
            } else {
                ((frame as f32 * 440.0 * 2.0 * PI / sample_rate as f32).sin()
                    * 0.75
                    * i16::MAX as f32) as i16
            };
            for channel in 0..channels {
                let value = if channel == 0 { sample } else { sample / 2 };
                pcm.extend_from_slice(&value.to_le_bytes());
            }
        }
        fs::write(path, encode_pcm_wav(&pcm, sample_rate, channels)).unwrap();
    }

    fn encode_pcm_wav(pcm: &[u8], sample_rate: u32, channels: u16) -> Vec<u8> {
        let data_size = u32::try_from(pcm.len()).unwrap();
        let block_align = channels * 2;
        let byte_rate = sample_rate * u32::from(block_align);
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
        bytes
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

    fn direct_range_decode(
        source_path: &Path,
        expected_hash: &ContentHash,
        channels: usize,
        range: &FrameRange,
        target_points: usize,
    ) -> Vec<Vec<WaveformPeak>> {
        let range_len = range.len();
        let mut channel_buckets: Vec<Vec<WaveformPeak>> = (0..channels)
            .map(|_| {
                (0..target_points)
                    .map(|_| WaveformPeak {
                        min: f32::INFINITY,
                        max: f32::NEG_INFINITY,
                    })
                    .collect()
            })
            .collect();
        let source = open_verified_source(source_path, expected_hash).unwrap();
        let mut decoded = open_decoder(source, source_path).unwrap();
        let mut frame_index = 0_u64;
        let mut decoded_channels = 0_usize;

        'decode: while frame_index < range.end_exclusive {
            let Some(packet) = decoded.next_packet().unwrap() else {
                break;
            };
            let audio = decoded.decoder.decode(&packet).unwrap();
            let spec = *audio.spec();
            let packet_channels = spec.channels.count();
            if decoded_channels == 0 {
                decoded_channels = packet_channels;
            }
            let mut samples = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
            samples.copy_interleaved_ref(audio);
            for frame in samples.samples().chunks_exact(decoded_channels) {
                if frame_index >= range.start && frame_index < range.end_exclusive {
                    let offset = frame_index - range.start;
                    let bucket = ((offset * target_points as u64 / range_len) as usize)
                        .min(target_points - 1);
                    for (channel_index, sample) in frame.iter().enumerate() {
                        let sample = sample.clamp(-1.0, 1.0);
                        let peak = &mut channel_buckets[channel_index][bucket];
                        peak.min = peak.min.min(sample);
                        peak.max = peak.max.max(sample);
                    }
                }
                frame_index += 1;
                if frame_index >= range.end_exclusive {
                    break 'decode;
                }
            }
        }
        for channel in &mut channel_buckets {
            for peak in channel.iter_mut() {
                if !peak.min.is_finite() {
                    *peak = WaveformPeak { min: 0.0, max: 0.0 };
                }
            }
        }
        channel_buckets
    }

    #[test]
    fn parses_decimal_frames_and_rejects_invalid_values() {
        assert_eq!(parse_decimal_frame("0").unwrap(), 0);
        assert_eq!(
            parse_decimal_frame("9007199254740993").unwrap(),
            9_007_199_254_740_993
        );
        assert_eq!(
            parse_decimal_frame("18446744073709551615").unwrap(),
            u64::MAX
        );
        assert!(parse_decimal_frame("01").is_err());
        assert!(parse_decimal_frame("").is_err());
        assert!(parse_decimal_frame("-1").is_err());
    }

    #[test]
    fn query_returns_per_channel_peaks_for_a_range() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 4096);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());

        cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();
        let partial = cache
            .query(
                &id,
                &hash,
                &audio_path,
                Some(("256", "512")),
                32,
                &mut cancel,
            )
            .unwrap();

        assert_eq!(partial.channels, 2);
        assert_eq!(partial.channel_peaks.len(), 2);
        assert_eq!(partial.channel_peaks[0].len(), 32);
        assert_ne!(partial.channel_peaks[0], partial.channel_peaks[1]);
        assert_eq!(partial.range.start, 256);
        assert_eq!(partial.range.end_exclusive, 512);
    }

    #[test]
    fn range_query_does_not_bleed_cached_peak_energy_outside_requested_frames() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("impulse.wav");
        write_impulse_wav(&audio_path, 512);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());

        cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();
        let partial = cache
            .query(
                &id,
                &hash,
                &audio_path,
                Some(("64", "128")),
                32,
                &mut cancel,
            )
            .unwrap();

        assert_eq!(partial.frames_per_peak, 2);
        assert_eq!(partial.channel_peaks[0].len(), 32);
        for peak in &partial.channel_peaks[0] {
            assert!(peak.min.abs() < f32::EPSILON);
            assert!(peak.max.abs() < f32::EPSILON);
        }
    }

    #[test]
    fn full_range_query_keeps_impulse_in_early_buckets_only() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("impulse.wav");
        write_impulse_wav(&audio_path, 512);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());

        let window = cache
            .query(&id, &hash, &audio_path, None, 640, &mut cancel)
            .unwrap();
        assert_eq!(window.channel_peaks[0].len(), 640);
        let silent_tail = window.channel_peaks[0]
            .iter()
            .skip(128)
            .all(|peak| peak.min.abs() < f32::EPSILON && peak.max.abs() < f32::EPSILON);
        assert!(silent_tail);
        assert!(
            window.channel_peaks[0][0].max.abs() > f32::EPSILON
                || window.channel_peaks[0][0].min.abs() > f32::EPSILON
        );
    }

    #[test]
    fn rejects_changed_source_after_cache_hit() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 4096);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());
        cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();
        fs::write(&audio_path, b"changed").unwrap();

        let error = cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap_err();

        assert!(matches!(error, AudioError::SourceChanged));
    }

    #[test]
    fn rejects_inverted_and_out_of_range_requests() {
        let range = FrameRange::parse("10", "10", 100);
        assert!(matches!(range, Err(AudioError::InvalidRequest(_))));
        let range = FrameRange::parse("10", "5", 100);
        assert!(matches!(range, Err(AudioError::InvalidRequest(_))));
        let range = FrameRange::parse("0", "101", 100);
        assert!(matches!(range, Err(AudioError::InvalidRequest(_))));
    }

    #[test]
    fn cached_pyramid_matches_direct_decode_for_ranges() {
        let fixture = TempDir::new().unwrap();
        let cache_dir = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 4096);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache_dir.path()).unwrap();
        let mut cancel = || Ok(());
        cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();

        for (start, end, points) in [
            ("0", "4096", 128_usize),
            ("256", "512", 32),
            ("10", "99", 64),
        ] {
            let range = FrameRange::parse(start, end, 4096).unwrap();
            let window = cache
                .query(
                    &id,
                    &hash,
                    &audio_path,
                    Some((start, end)),
                    points,
                    &mut cancel,
                )
                .unwrap();
            let direct = direct_range_decode(&audio_path, &hash, 2, &range, points);
            assert_eq!(window.channel_peaks, direct);
        }
    }

    #[test]
    fn second_query_reuses_wfm2_cache() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 2048);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());
        let first = cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();
        assert!(!first.cache_hit);
        let second = cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();
        assert!(second.cache_hit);
        let digest = id.strip_prefix("asset:v1:").unwrap();
        assert!(cache
            .directory
            .join(format!("waveform-v2-{digest}.wfm2"))
            .is_file());
    }

    #[test]
    fn corrupt_wfm2_cache_is_regenerated() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 1024);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());
        cache
            .query(&id, &hash, &audio_path, None, 64, &mut cancel)
            .unwrap();
        let digest = id.strip_prefix("asset:v1:").unwrap();
        let cache_path = cache.directory.join(format!("waveform-v2-{digest}.wfm2"));
        fs::write(&cache_path, b"broken-wfm2").unwrap();
        let rebuilt = cache
            .query(&id, &hash, &audio_path, None, 64, &mut cancel)
            .unwrap();
        assert!(!rebuilt.cache_hit);
        assert!(load_wfm2_metadata(&cache_path, &id).unwrap().is_some());
    }

    #[test]
    fn different_zoom_levels_use_pyramid_levels() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 8192);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let cache = WaveformCacheV2::open(cache.path()).unwrap();
        let mut cancel = || Ok(());
        cache
            .query(&id, &hash, &audio_path, None, 128, &mut cancel)
            .unwrap();
        let wide = cache
            .query(
                &id,
                &hash,
                &audio_path,
                Some(("0", "8192")),
                128,
                &mut cancel,
            )
            .unwrap();
        let narrow = cache
            .query(
                &id,
                &hash,
                &audio_path,
                Some(("0", "256")),
                4096,
                &mut cancel,
            )
            .unwrap();
        assert!(wide.frames_per_peak > narrow.frames_per_peak);
    }

    #[test]
    fn v1_preview_still_works_alongside_v2_cache() {
        let fixture = TempDir::new().unwrap();
        let cache = TempDir::new().unwrap();
        let audio_path = fixture.path().join("tone.wav");
        write_wav(&audio_path, 1024);
        let hash = content_hash(&audio_path);
        let id = asset_id(&hash);
        let v2 = WaveformCacheV2::open(cache.path()).unwrap();
        let v1 = WaveformCache::open(cache.path()).unwrap();
        let mut cancel = || Ok(());
        v2.query(&id, &hash, &audio_path, None, 64, &mut cancel)
            .unwrap();
        v1.waveform(&id, &hash, &audio_path, 64).unwrap();
        create_preview(&hash, &audio_path).unwrap();
    }
}
