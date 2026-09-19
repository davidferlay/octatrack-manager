//! Versioned binary multi-resolution waveform cache (WFM2).

use crate::{
    AudioError, WaveformPeak, MAX_CACHE_BYTES, MIN_TARGET_POINTS, WAVEFORM_V2_ANALYZER_VERSION,
};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

pub const WFM2_MAGIC: &[u8; 4] = b"WFM2";
pub const WFM2_FORMAT_VERSION: u16 = 1;
pub const WFM2_LEVEL_SCALE: u32 = 4;
pub const WFM2_MIN_BASE_FRAMES: u64 = 1;
pub const WFM2_MAX_BASE_FRAMES: u64 = 256;
pub const WFM2_MAX_LEVELS: usize = 32;
pub const WFM2_MAX_CHANNELS: u16 = 32;
pub const WFM2_MAX_ASSET_ID_BYTES: usize = 512;
pub const WFM2_MAX_ANALYZER_BYTES: usize = 64;
pub const PEAK_BYTES: u64 = 8;

static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wfm2LevelDesc {
    pub frames_per_bucket: u64,
    pub bucket_count: u64,
    pub data_offset: u64,
    pub data_size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wfm2Metadata {
    pub asset_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_count: u64,
    pub base_frames_per_bucket: u64,
    pub level_scale: u32,
    pub levels: Vec<Wfm2LevelDesc>,
    pub file_size: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Wfm2PyramidLevel {
    pub frames_per_bucket: u64,
    pub channels: Vec<Vec<WaveformPeak>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Wfm2Pyramid {
    pub asset_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_count: u64,
    pub base_frames_per_bucket: u64,
    pub levels: Vec<Wfm2PyramidLevel>,
}

pub fn choose_base_frames_per_bucket(frame_count: u64, channels: u16) -> u64 {
    let channels = u64::from(channels.max(1));
    let mut base = WFM2_MIN_BASE_FRAMES;
    while base < WFM2_MAX_BASE_FRAMES {
        if estimate_file_size(frame_count, channels as u16, base) <= MAX_CACHE_BYTES {
            return base;
        }
        base = base.saturating_mul(u64::from(WFM2_LEVEL_SCALE));
    }
    WFM2_MAX_BASE_FRAMES
}

pub fn estimate_file_size(frame_count: u64, channels: u16, base_frames: u64) -> u64 {
    let header = header_size_for(
        WFM2_MAX_ASSET_ID_BYTES,
        WAVEFORM_V2_ANALYZER_VERSION.len(),
        8,
    );
    let mut total = header;
    let mut scale = base_frames.max(1);
    for _ in 0..WFM2_MAX_LEVELS {
        let bucket_count = frame_count.div_ceil(scale);
        let level_bytes = bucket_count
            .saturating_mul(u64::from(channels))
            .saturating_mul(PEAK_BYTES);
        total = total.saturating_add(level_bytes);
        if bucket_count <= MIN_TARGET_POINTS as u64 {
            break;
        }
        scale = scale.saturating_mul(u64::from(WFM2_LEVEL_SCALE));
    }
    total
}

fn header_size_for(asset_id_len: usize, analyzer_len: usize, level_count: usize) -> u64 {
    8 + 4
        + analyzer_len as u64
        + 4
        + asset_id_len as u64
        + 4
        + 4
        + 8
        + 8
        + 8
        + 8
        + u64::try_from(level_count).unwrap_or(WFM2_MAX_LEVELS as u64) * 32
        + 8
}

pub fn build_pyramid_levels(
    base_channels: Vec<Vec<WaveformPeak>>,
    base_frames_per_bucket: u64,
    frame_count: u64,
) -> Vec<Wfm2PyramidLevel> {
    let mut levels = vec![Wfm2PyramidLevel {
        frames_per_bucket: base_frames_per_bucket,
        channels: base_channels,
    }];
    while levels.last().is_some_and(|level| {
        level
            .channels
            .first()
            .is_some_and(|peaks| peaks.len() > MIN_TARGET_POINTS)
    }) {
        let previous = levels.last().expect("waveform always has a base level");
        let channels = previous
            .channels
            .iter()
            .map(|peaks| aggregate_peaks(peaks, WFM2_LEVEL_SCALE as usize))
            .collect::<Vec<_>>();
        if channels
            .first()
            .is_some_and(|peaks| peaks.len() == previous.channels[0].len())
        {
            break;
        }
        levels.push(Wfm2PyramidLevel {
            frames_per_bucket: previous.frames_per_bucket * u64::from(WFM2_LEVEL_SCALE),
            channels,
        });
    }
    let _ = frame_count;
    levels
}

pub fn aggregate_peaks(peaks: &[WaveformPeak], scale: usize) -> Vec<WaveformPeak> {
    peaks
        .chunks(scale)
        .map(|chunk| WaveformPeak {
            min: chunk.iter().map(|peak| peak.min).fold(1.0, f32::min),
            max: chunk.iter().map(|peak| peak.max).fold(-1.0, f32::max),
        })
        .collect()
}

pub fn write_wfm2(path: &Path, pyramid: &Wfm2Pyramid) -> Result<(), AudioError> {
    validate_pyramid(pyramid)?;
    let encoded = encode_wfm2(pyramid)?;
    if encoded.len() as u64 > MAX_CACHE_BYTES {
        return Err(AudioError::CacheUnavailable(
            "waveform cache entry exceeds the size limit".into(),
        ));
    }
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_extension(format!("tmp-{}-{sequence}", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(cache_io)?;
        file.write_all(&encoded).map_err(cache_io)?;
        file.sync_all().map_err(cache_io)?;
        drop(file);
        fs::rename(&temporary, path).map_err(cache_io)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

pub fn load_wfm2_metadata(path: &Path, asset_id: &str) -> Result<Option<Wfm2Metadata>, AudioError> {
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
    let bytes = fs::read(path).map_err(cache_io)?;
    let parsed = match parse_wfm2(&bytes) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(None),
    };
    if parsed.asset_id != asset_id {
        return Ok(None);
    }
    Ok(Some(parsed))
}

pub fn read_level_peaks(
    path: &Path,
    meta: &Wfm2Metadata,
    level_index: usize,
    channel_index: usize,
    peak_start: u64,
    peak_end_exclusive: u64,
) -> Result<Vec<WaveformPeak>, AudioError> {
    validate_metadata(meta)?;
    let level = meta.levels.get(level_index).ok_or_else(|| {
        AudioError::CacheUnavailable("waveform level index is out of range".into())
    })?;
    if channel_index >= usize::from(meta.channels) {
        return Err(AudioError::CacheUnavailable(
            "waveform channel index is out of range".into(),
        ));
    }
    if peak_start >= peak_end_exclusive || peak_end_exclusive > level.bucket_count {
        return Err(AudioError::CacheUnavailable(
            "waveform peak range is invalid".into(),
        ));
    }
    let count = peak_end_exclusive - peak_start;
    let mut file = File::open(path).map_err(cache_io)?;
    let stride = u64::from(meta.channels) * PEAK_BYTES;
    let mut peaks = Vec::with_capacity(usize::try_from(count).map_err(|_| {
        AudioError::CacheUnavailable("waveform peak allocation is too large".into())
    })?);
    for peak_index in peak_start..peak_end_exclusive {
        let offset = level
            .data_offset
            .checked_add(peak_index.saturating_mul(stride))
            .and_then(|base| base.checked_add(u64::from(channel_index as u16) * PEAK_BYTES))
            .ok_or_else(|| {
                AudioError::CacheUnavailable("waveform peak offset overflowed".into())
            })?;
        file.seek(SeekFrom::Start(offset)).map_err(cache_io)?;
        let mut buf = [0_u8; 8];
        file.read_exact(&mut buf)
            .map_err(|_| AudioError::CacheUnavailable("waveform peak data is truncated".into()))?;
        let min = f32::from_le_bytes(buf[0..4].try_into().unwrap());
        let max = f32::from_le_bytes(buf[4..8].try_into().unwrap());
        if !peak_is_valid(min, max) {
            return Err(AudioError::CacheUnavailable(
                "waveform peak data is invalid".into(),
            ));
        }
        peaks.push(WaveformPeak { min, max });
    }
    Ok(peaks)
}

fn encode_wfm2(pyramid: &Wfm2Pyramid) -> Result<Vec<u8>, AudioError> {
    validate_pyramid(pyramid)?;
    let analyzer = WAVEFORM_V2_ANALYZER_VERSION.as_bytes();
    let asset_id = pyramid.asset_id.as_bytes();
    if analyzer.len() > WFM2_MAX_ANALYZER_BYTES || asset_id.len() > WFM2_MAX_ASSET_ID_BYTES {
        return Err(AudioError::CacheUnavailable(
            "waveform cache metadata is too large".into(),
        ));
    }
    let level_count = pyramid.levels.len();
    if level_count == 0 || level_count > WFM2_MAX_LEVELS {
        return Err(AudioError::CacheUnavailable(
            "waveform level count is invalid".into(),
        ));
    }

    let header_size = header_size_for(asset_id.len(), analyzer.len(), level_count);
    let mut data_offset = header_size;
    let mut level_descs = Vec::with_capacity(level_count);
    for level in &pyramid.levels {
        let bucket_count = u64::try_from(
            level.channels.first().map(|peaks| peaks.len()).unwrap_or(0),
        )
        .map_err(|_| AudioError::CacheUnavailable("waveform bucket count overflowed".into()))?;
        let data_size = bucket_count
            .checked_mul(u64::from(pyramid.channels))
            .and_then(|value| value.checked_mul(PEAK_BYTES))
            .ok_or_else(|| {
                AudioError::CacheUnavailable("waveform level data size overflowed".into())
            })?;
        level_descs.push(Wfm2LevelDesc {
            frames_per_bucket: level.frames_per_bucket,
            bucket_count,
            data_offset,
            data_size,
        });
        data_offset = data_offset
            .checked_add(data_size)
            .ok_or_else(|| AudioError::CacheUnavailable("waveform cache size overflowed".into()))?;
    }
    let file_size = data_offset;
    if file_size > MAX_CACHE_BYTES {
        return Err(AudioError::CacheUnavailable(
            "waveform cache entry exceeds the size limit".into(),
        ));
    }

    let mut bytes = Vec::with_capacity(usize::try_from(file_size).map_err(|_| {
        AudioError::CacheUnavailable("waveform cache allocation is too large".into())
    })?);
    bytes.extend_from_slice(WFM2_MAGIC);
    bytes.extend_from_slice(&WFM2_FORMAT_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&(analyzer.len() as u32).to_le_bytes());
    bytes.extend_from_slice(analyzer);
    bytes.extend_from_slice(&(asset_id.len() as u32).to_le_bytes());
    bytes.extend_from_slice(asset_id);
    bytes.extend_from_slice(&pyramid.sample_rate.to_le_bytes());
    bytes.extend_from_slice(&pyramid.channels.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&pyramid.frame_count.to_le_bytes());
    bytes.push(u8::try_from(level_count).unwrap());
    bytes.extend_from_slice(&[0_u8; 7]);
    bytes.extend_from_slice(&pyramid.base_frames_per_bucket.to_le_bytes());
    bytes.extend_from_slice(&WFM2_LEVEL_SCALE.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    for desc in &level_descs {
        bytes.extend_from_slice(&desc.frames_per_bucket.to_le_bytes());
        bytes.extend_from_slice(&desc.bucket_count.to_le_bytes());
        bytes.extend_from_slice(&desc.data_offset.to_le_bytes());
        bytes.extend_from_slice(&desc.data_size.to_le_bytes());
    }
    bytes.extend_from_slice(&file_size.to_le_bytes());

    if u64::try_from(bytes.len()).unwrap() != header_size {
        return Err(AudioError::CacheUnavailable(
            "waveform header size mismatch".into(),
        ));
    }

    for (level, desc) in pyramid.levels.iter().zip(level_descs.iter()) {
        if u64::try_from(bytes.len()).unwrap() != desc.data_offset {
            return Err(AudioError::CacheUnavailable(
                "waveform payload offset mismatch".into(),
            ));
        }
        for bucket_index in 0..desc.bucket_count as usize {
            for channel_index in 0..usize::from(pyramid.channels) {
                let peak = level.channels[channel_index][bucket_index];
                bytes.extend_from_slice(&peak.min.to_le_bytes());
                bytes.extend_from_slice(&peak.max.to_le_bytes());
            }
        }
    }
    if u64::try_from(bytes.len()).unwrap() != file_size {
        return Err(AudioError::CacheUnavailable(
            "waveform file size mismatch".into(),
        ));
    }
    Ok(bytes)
}

pub fn parse_wfm2(bytes: &[u8]) -> Result<Wfm2Metadata, AudioError> {
    if bytes.len() < 48 {
        return Err(invalid("waveform header is truncated"));
    }
    if bytes[0..4] != *WFM2_MAGIC {
        return Err(invalid("waveform magic is invalid"));
    }
    let format_version = u16::from_le_bytes(bytes[4..6].try_into().unwrap());
    if format_version != WFM2_FORMAT_VERSION {
        return Err(invalid("waveform format version is unsupported"));
    }
    let mut cursor = 8_usize;
    let analyzer_len = read_u32(bytes, &mut cursor)? as usize;
    if analyzer_len == 0 || analyzer_len > WFM2_MAX_ANALYZER_BYTES {
        return Err(invalid("waveform analyzer length is invalid"));
    }
    let analyzer = read_bytes(bytes, &mut cursor, analyzer_len)?;
    if analyzer != WAVEFORM_V2_ANALYZER_VERSION.as_bytes() {
        return Err(invalid("waveform analyzer version is unsupported"));
    }
    let asset_id_len = read_u32(bytes, &mut cursor)? as usize;
    if asset_id_len == 0 || asset_id_len > WFM2_MAX_ASSET_ID_BYTES {
        return Err(invalid("waveform asset id length is invalid"));
    }
    let asset_id = String::from_utf8(read_bytes(bytes, &mut cursor, asset_id_len)?.to_vec())
        .map_err(|_| invalid("waveform asset id is invalid utf-8"))?;
    if cursor + 16 > bytes.len() {
        return Err(invalid("waveform header is truncated"));
    }
    let sample_rate = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
    cursor += 4;
    let channels = u16::from_le_bytes(bytes[cursor..cursor + 2].try_into().unwrap());
    cursor += 4;
    if sample_rate == 0 || channels == 0 || channels > WFM2_MAX_CHANNELS {
        return Err(invalid("waveform channel metadata is invalid"));
    }
    let frame_count = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
    cursor += 8;
    if frame_count == 0 {
        return Err(invalid("waveform frame count is invalid"));
    }
    let level_count = bytes[cursor] as usize;
    cursor += 8;
    if level_count == 0 || level_count > WFM2_MAX_LEVELS {
        return Err(invalid("waveform level count is invalid"));
    }
    if cursor + 16 > bytes.len() {
        return Err(invalid("waveform header is truncated"));
    }
    let base_frames_per_bucket = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
    cursor += 8;
    let level_scale = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
    cursor += 8;
    if base_frames_per_bucket == 0 || level_scale != WFM2_LEVEL_SCALE {
        return Err(invalid("waveform pyramid metadata is invalid"));
    }
    let table_bytes = level_count
        .checked_mul(32)
        .ok_or_else(|| invalid("waveform level table overflowed"))?;
    if cursor + table_bytes + 8 > bytes.len() {
        return Err(invalid("waveform level table is truncated"));
    }
    let mut levels = Vec::with_capacity(level_count);
    let mut expected_scale = base_frames_per_bucket;
    for index in 0..level_count {
        let frames_per_bucket = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let bucket_count = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let data_offset = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let data_size = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        if frames_per_bucket != expected_scale || bucket_count == 0 {
            return Err(invalid("waveform level scale is invalid"));
        }
        let expected_buckets = frame_count.div_ceil(expected_scale);
        if bucket_count != expected_buckets {
            return Err(invalid("waveform bucket count mismatch"));
        }
        let expected_data_size = bucket_count
            .checked_mul(u64::from(channels))
            .and_then(|value| value.checked_mul(PEAK_BYTES))
            .ok_or_else(|| invalid("waveform level data size overflowed"))?;
        if data_size != expected_data_size {
            return Err(invalid("waveform level data size mismatch"));
        }
        if data_offset
            .checked_add(data_size)
            .ok_or_else(|| invalid("waveform level offset overflowed"))?
            > bytes.len() as u64
        {
            return Err(invalid("waveform level offset is out of range"));
        }
        levels.push(Wfm2LevelDesc {
            frames_per_bucket,
            bucket_count,
            data_offset,
            data_size,
        });
        if index + 1 < level_count {
            expected_scale = expected_scale
                .checked_mul(u64::from(level_scale))
                .ok_or_else(|| invalid("waveform level scale overflowed"))?;
        }
    }
    let file_size = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
    if file_size as usize != bytes.len() {
        return Err(invalid("waveform file size mismatch"));
    }
    let meta = Wfm2Metadata {
        asset_id,
        sample_rate,
        channels,
        frame_count,
        base_frames_per_bucket,
        level_scale,
        levels,
        file_size,
    };
    validate_metadata(&meta)?;
    Ok(meta)
}

pub fn validate_metadata(meta: &Wfm2Metadata) -> Result<(), AudioError> {
    if meta.sample_rate == 0
        || meta.channels == 0
        || meta.frame_count == 0
        || meta.levels.is_empty()
    {
        return Err(invalid("waveform metadata is invalid"));
    }
    let mut expected_scale = meta.base_frames_per_bucket;
    for (index, level) in meta.levels.iter().enumerate() {
        if level.frames_per_bucket != expected_scale {
            return Err(invalid("waveform level scale is invalid"));
        }
        let expected_buckets = meta.frame_count.div_ceil(expected_scale);
        if level.bucket_count != expected_buckets {
            return Err(invalid("waveform bucket count mismatch"));
        }
        let expected_data_size = level
            .bucket_count
            .checked_mul(u64::from(meta.channels))
            .and_then(|value| value.checked_mul(PEAK_BYTES))
            .ok_or_else(|| invalid("waveform level data size overflowed"))?;
        if level.data_size != expected_data_size {
            return Err(invalid("waveform level data size mismatch"));
        }
        if index + 1 < meta.levels.len() {
            expected_scale = expected_scale
                .checked_mul(u64::from(meta.level_scale))
                .ok_or_else(|| invalid("waveform level scale overflowed"))?;
        }
    }
    Ok(())
}

fn validate_pyramid(pyramid: &Wfm2Pyramid) -> Result<(), AudioError> {
    if pyramid.sample_rate == 0
        || pyramid.channels == 0
        || pyramid.frame_count == 0
        || pyramid.levels.is_empty()
        || pyramid.base_frames_per_bucket == 0
    {
        return Err(invalid("waveform pyramid metadata is invalid"));
    }
    let channel_count = usize::from(pyramid.channels);
    let mut expected_scale = pyramid.base_frames_per_bucket;
    for (index, level) in pyramid.levels.iter().enumerate() {
        if level.frames_per_bucket != expected_scale || level.channels.len() != channel_count {
            return Err(invalid("waveform pyramid shape is invalid"));
        }
        let expected_peak_count = pyramid.frame_count.div_ceil(expected_scale);
        for peaks in &level.channels {
            if peaks.len() as u64 != expected_peak_count {
                return Err(invalid("waveform pyramid peak count mismatch"));
            }
            if peaks.iter().any(|peak| !peak_is_valid(peak.min, peak.max)) {
                return Err(invalid("waveform peak data is invalid"));
            }
        }
        if index + 1 < pyramid.levels.len() {
            expected_scale = expected_scale
                .checked_mul(u64::from(WFM2_LEVEL_SCALE))
                .ok_or_else(|| invalid("waveform level scale overflowed"))?;
        }
    }
    Ok(())
}

fn peak_is_valid(min: f32, max: f32) -> bool {
    min.is_finite() && max.is_finite() && min >= -1.0 && max <= 1.0 && min <= max
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, AudioError> {
    if *cursor + 4 > bytes.len() {
        return Err(invalid("waveform header is truncated"));
    }
    let value = u32::from_le_bytes(bytes[*cursor..*cursor + 4].try_into().unwrap());
    *cursor += 4;
    Ok(value)
}

fn read_bytes<'a>(bytes: &'a [u8], cursor: &mut usize, len: usize) -> Result<&'a [u8], AudioError> {
    if *cursor + len > bytes.len() {
        return Err(invalid("waveform header is truncated"));
    }
    let slice = &bytes[*cursor..*cursor + len];
    *cursor += len;
    Ok(slice)
}

fn invalid(message: &str) -> AudioError {
    AudioError::CacheUnavailable(message.into())
}

fn cache_io(error: std::io::Error) -> AudioError {
    AudioError::CacheUnavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_pyramid(frames: u64, channels: u16, base: u64) -> Wfm2Pyramid {
        let bucket_count = frames.div_ceil(base) as usize;
        let channel_count = usize::from(channels);
        let mk = |value: f32| WaveformPeak {
            min: -value,
            max: value,
        };
        let base_channels: Vec<Vec<WaveformPeak>> = (0..channel_count)
            .map(|channel| {
                (0..bucket_count)
                    .map(|index| mk((index as f32 + channel as f32) * 0.01))
                    .collect()
            })
            .collect();
        let levels = build_pyramid_levels(base_channels, base, frames);
        Wfm2Pyramid {
            asset_id: "asset:v1:abc".into(),
            sample_rate: 44_100,
            channels,
            frame_count: frames,
            base_frames_per_bucket: base,
            levels,
        }
    }

    #[test]
    fn wfm2_round_trip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sample.wfm2");
        let pyramid = sample_pyramid(4096, 2, 256);
        write_wfm2(&path, &pyramid).unwrap();
        let meta = load_wfm2_metadata(&path, "asset:v1:abc").unwrap().unwrap();
        assert_eq!(meta.frame_count, 4096);
        assert_eq!(meta.channels, 2);
        let peaks = read_level_peaks(&path, &meta, 0, 0, 0, 4).unwrap();
        assert_eq!(peaks.len(), 4);
    }

    #[test]
    fn rejects_malformed_magic() {
        let err = parse_wfm2(b"NOPE").unwrap_err();
        assert!(matches!(err, AudioError::CacheUnavailable(_)));
    }

    #[test]
    fn rejects_unsupported_version() {
        let mut bytes = encode_wfm2(&sample_pyramid(128, 1, 64)).unwrap();
        bytes[5] = 9;
        assert!(parse_wfm2(&bytes).is_err());
    }

    #[test]
    fn rejects_truncated_header() {
        let bytes = encode_wfm2(&sample_pyramid(128, 1, 64)).unwrap();
        assert!(parse_wfm2(&bytes[..40]).is_err());
    }

    #[test]
    fn rejects_truncated_level_data() {
        let bytes = encode_wfm2(&sample_pyramid(128, 1, 64)).unwrap();
        assert!(parse_wfm2(&bytes[..bytes.len() - 4]).is_err());
    }

    #[test]
    fn rejects_invalid_offset() {
        let mut bytes = encode_wfm2(&sample_pyramid(128, 1, 64)).unwrap();
        let meta = parse_wfm2(&bytes).unwrap();
        let table_start = meta.levels[0].data_offset as usize - 32;
        bytes[table_start + 16..table_start + 24].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(parse_wfm2(&bytes).is_err());
    }

    #[test]
    fn rejects_absurd_bucket_count() {
        let mut bytes = encode_wfm2(&sample_pyramid(128, 1, 64)).unwrap();
        let level_table_start = bytes.len() - 8 - 32;
        bytes[level_table_start + 8..level_table_start + 16]
            .copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(parse_wfm2(&bytes).is_err());
    }

    #[test]
    fn rejects_invalid_channel_count() {
        let mut pyramid = sample_pyramid(128, 0, 64);
        pyramid.channels = 0;
        assert!(encode_wfm2(&pyramid).is_err());
    }

    #[test]
    fn choose_base_stride_respects_cache_limit() {
        let base = choose_base_frames_per_bucket(10_000_000, 2);
        assert!(base >= WFM2_MIN_BASE_FRAMES);
        assert!(estimate_file_size(10_000_000, 2, base) <= MAX_CACHE_BYTES);
    }

    #[test]
    fn frame_count_above_js_safe_integer_is_represented() {
        let frame_count = 9_007_199_254_740_993_u64;
        let meta = Wfm2Metadata {
            asset_id: "asset:v1:abc".into(),
            sample_rate: 48_000,
            channels: 1,
            frame_count,
            base_frames_per_bucket: 256,
            level_scale: WFM2_LEVEL_SCALE,
            levels: vec![Wfm2LevelDesc {
                frames_per_bucket: 256,
                bucket_count: frame_count.div_ceil(256),
                data_offset: 512,
                data_size: frame_count.div_ceil(256) * PEAK_BYTES,
            }],
            file_size: 512 + frame_count.div_ceil(256) * PEAK_BYTES,
        };
        assert_eq!(meta.frame_count.to_string(), "9007199254740993".to_string());
        assert!(validate_metadata(&meta).is_ok());
    }

    #[test]
    #[ignore = "local regression evidence only"]
    fn long_file_cache_size_observation() {
        let frames = 2_000_000_u64;
        let channels = 2_u16;
        let base = choose_base_frames_per_bucket(frames, channels);
        let size = estimate_file_size(frames, channels, base);
        assert!(size <= MAX_CACHE_BYTES);
        assert!(base >= WFM2_MIN_BASE_FRAMES);
    }
}
