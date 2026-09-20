//! Immutable, bounded PCM input primitives for AUTO-SLICE-1.
//!
//! The caller must authorize/open the source through RootRegistry before passing
//! its reader here. This module accepts no paths and never writes source media.
//! This initial in-memory backend is limited to 64 MiB; the planned disk-backed
//! 2 GiB snapshot store and IPC lifecycle are separate integration work.

use crate::{open_decoder_stream, AudioError};
use ot_domain::slicing::FrameRange;
use ot_domain::ContentHash;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::mem::size_of;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::io::MediaSourceStream;

pub const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_REGION_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_REGION_SECONDS: u64 = 30;
const MAX_ANALYSIS_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug)]
pub enum PcmError {
    Cancelled,
    LimitExceeded,
    Audio(AudioError),
}

impl std::fmt::Display for PcmError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("PCM operation cancelled"),
            Self::LimitExceeded => formatter.write_str("PCM resource limit exceeded"),
            Self::Audio(error) => std::fmt::Display::fmt(error, formatter),
        }
    }
}

impl std::error::Error for PcmError {}

impl From<AudioError> for PcmError {
    fn from(error: AudioError) -> Self {
        Self::Audio(error)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PcmInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub frame_count: u64,
}

#[derive(Debug)]
pub struct PcmRegion {
    pub source: PcmInfo,
    pub range: FrameRange,
    /// Interleaved channel samples; frame count is len / source.channels.
    pub samples: Vec<f32>,
}

/// Bytes are owned, hash-verified and cannot change between decoder passes.
#[derive(Clone)]
pub struct PcmSnapshot {
    bytes: Arc<[u8]>,
    info: PcmInfo,
    extension: &'static str,
}

impl PcmSnapshot {
    pub fn read(
        mut source: impl Read,
        expected_hash: &ContentHash,
        cancelled: &AtomicBool,
    ) -> Result<Self, PcmError> {
        let mut bytes = Vec::new();
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            check_cancel(cancelled)?;
            let count = match source.read(&mut buffer) {
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                result => result.map_err(crate::source_io)?,
            };
            if count == 0 {
                break;
            }
            if count > MAX_SNAPSHOT_BYTES - bytes.len() {
                return Err(PcmError::LimitExceeded);
            }
            bytes.extend_from_slice(&buffer[..count]);
            hasher.update(&buffer[..count]);
        }
        check_cancel(cancelled)?;
        if format!("sha256:{:x}", hasher.finalize()) != expected_hash.as_str() {
            return Err(AudioError::SourceChanged.into());
        }
        let (info, extension) = inspect_container(&bytes, cancelled)?;
        check_cancel(cancelled)?;
        Ok(Self {
            bytes: bytes.into(),
            info,
            extension,
        })
    }

    pub fn info(&self) -> PcmInfo {
        self.info
    }

    /// Decode from frame zero for exact coordinates, retaining only the requested
    /// half-open range. Validate the entire stream before publishing any result.
    /// A later indexed backend may optimize this without changing the contract.
    pub fn region(&self, range: FrameRange, cancelled: &AtomicBool) -> Result<PcmRegion, PcmError> {
        if range.frame_count() > MAX_REGION_SECONDS * u64::from(self.info.sample_rate) {
            return Err(PcmError::LimitExceeded);
        }
        self.decode_range(range, MAX_REGION_BYTES, cancelled)
    }

    /// Selected analysis ROI plus real half-second context at both ends.
    /// The allocation ceiling rejects oversized requests, never truncates them.
    pub fn analysis_region(
        &self,
        region: FrameRange,
        cancelled: &AtomicBool,
    ) -> Result<PcmRegion, PcmError> {
        use ot_domain::slicing::PcmFrame;
        if region.within(self.info.frame_count).is_err()
            || region.frame_count() > 600 * u64::from(self.info.sample_rate)
        {
            return Err(AudioError::InvalidRequest("invalid analysis range").into());
        }
        let context = u64::from(self.info.sample_rate) / 2;
        let range = FrameRange::new(
            PcmFrame::new(region.start().get().saturating_sub(context)),
            PcmFrame::new(
                region
                    .end_exclusive()
                    .get()
                    .saturating_add(context)
                    .min(self.info.frame_count),
            ),
        )
        .map_err(|_| AudioError::InvalidRequest("invalid analysis context"))?;
        self.decode_range(range, MAX_ANALYSIS_BYTES, cancelled)
    }

    fn decode_range(
        &self,
        range: FrameRange,
        max_bytes: usize,
        cancelled: &AtomicBool,
    ) -> Result<PcmRegion, PcmError> {
        check_cancel(cancelled)?;
        range
            .within(self.info.frame_count)
            .map_err(|_| AudioError::InvalidRequest("PCM range is outside the source"))?;
        let channels = usize::from(self.info.channels);
        let sample_count = range.frame_count() * channels as u64;
        if sample_count > (max_bytes / size_of::<f32>()) as u64 {
            return Err(PcmError::LimitExceeded);
        }
        let stream = MediaSourceStream::new(
            Box::new(Cursor::new(Arc::clone(&self.bytes))),
            Default::default(),
        );
        let mut state = open_decoder_stream(stream, Path::new(self.extension))?;
        let mut samples = Vec::with_capacity(sample_count as usize);
        let mut frame = 0_u64;
        while let Some(packet) = state.next_packet()? {
            check_cancel(cancelled)?;
            let audio = state
                .decoder
                .decode(&packet)
                .map_err(|error| AudioError::DecodeFailed(error.to_string()))?;
            let spec = *audio.spec();
            if spec.rate != self.info.sample_rate || spec.channels.count() != channels {
                return Err(corrupt("PCM format changed during decoding"));
            }
            let mut buffer = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
            buffer.copy_interleaved_ref(audio);
            for channel_frame in buffer.samples().chunks_exact(channels) {
                if !channel_frame.iter().all(|value| value.is_finite()) {
                    return Err(corrupt("nonfinite PCM sample"));
                }
                if frame >= self.info.frame_count {
                    return Err(corrupt("decoded frames exceed container length"));
                }
                if frame >= range.start().get() && frame < range.end_exclusive().get() {
                    samples.extend_from_slice(channel_frame);
                }
                frame += 1;
            }
        }
        check_cancel(cancelled)?;
        if frame != self.info.frame_count || samples.len() != sample_count as usize {
            return Err(corrupt("decoded frame count differs from container length"));
        }
        Ok(PcmRegion {
            source: self.info,
            range,
            samples,
        })
    }
}

fn check_cancel(cancelled: &AtomicBool) -> Result<(), PcmError> {
    if cancelled.load(Ordering::Relaxed) {
        Err(PcmError::Cancelled)
    } else {
        Ok(())
    }
}

fn corrupt(message: &str) -> PcmError {
    AudioError::DecodeFailed(message.into()).into()
}

// Preflight only: Symphonia remains the decoder. Reject truncated containers,
// partial sample frames and ambiguous duplicate structural chunks before EOF
// can be interpreted as a successful decode. Unsupported variants fail closed.
fn inspect_container(
    bytes: &[u8],
    cancelled: &AtomicBool,
) -> Result<(PcmInfo, &'static str), PcmError> {
    if bytes.len() < 12 {
        return Err(corrupt("truncated PCM container"));
    }
    let little = match (&bytes[..4], &bytes[8..12]) {
        (b"RIFF", b"WAVE") => true,
        (b"FORM", b"AIFF") => false,
        _ => return Err(AudioError::UnsupportedFormat.into()),
    };
    let u32_at = |bytes: &[u8]| {
        let array = [bytes[0], bytes[1], bytes[2], bytes[3]];
        if little {
            u32::from_le_bytes(array)
        } else {
            u32::from_be_bytes(array)
        }
    };
    let u16_at = |bytes: &[u8]| {
        let array = [bytes[0], bytes[1]];
        if little {
            u16::from_le_bytes(array)
        } else {
            u16::from_be_bytes(array)
        }
    };
    if u64::from(u32_at(&bytes[4..8])) + 8 != bytes.len() as u64 {
        return Err(corrupt("PCM container size mismatch"));
    }
    let mut format = None;
    let mut data = None;
    let format_id = if little { b"fmt " } else { b"COMM" };
    let data_id = if little { b"data" } else { b"SSND" };
    let mut offset = 12;
    while offset < bytes.len() {
        check_cancel(cancelled)?;
        if bytes.len() - offset < 8 {
            return Err(corrupt("truncated chunk header"));
        }
        let id = &bytes[offset..offset + 4];
        let length = u32_at(&bytes[offset + 4..offset + 8]) as usize;
        offset += 8;
        if length > bytes.len() - offset {
            return Err(corrupt("chunk exceeds container"));
        }
        let payload = &bytes[offset..offset + length];
        if id == format_id {
            if format.replace(payload).is_some() {
                return Err(corrupt("duplicate format chunk"));
            }
        } else if id == data_id && data.replace(payload).is_some() {
            return Err(corrupt("duplicate audio chunk"));
        }
        offset += length + length % 2;
        if offset > bytes.len() {
            return Err(corrupt("missing chunk padding"));
        }
    }
    let format = format.ok_or_else(|| corrupt("missing format chunk"))?;
    let data = data.ok_or_else(|| corrupt("missing audio chunk"))?;
    let (channels, bits, rate, frame_count, byte_count) = if little {
        if format.len() < 16 || u16_at(format) != 1 {
            return Err(AudioError::UnsupportedFormat.into());
        }
        let channels = u16_at(&format[2..]);
        let rate = u32_at(&format[4..]);
        let bits = u16_at(&format[14..]);
        let alignment = u16_at(&format[12..]);
        let expected_alignment = u32::from(channels) * u32::from(bits) / 8;
        if alignment == 0
            || u32::from(alignment) != expected_alignment
            || u64::from(u32_at(&format[8..])) != u64::from(rate) * u64::from(alignment)
        {
            return Err(corrupt("invalid WAV frame alignment"));
        }
        (
            channels,
            bits,
            rate,
            data.len() as u64 / u64::from(alignment),
            data.len(),
        )
    } else {
        if format.len() != 18 || data.len() < 8 {
            return Err(corrupt("invalid AIFF structural chunk"));
        }
        // Exact IEEE 80-bit encodings of the two supported source rates.
        let rate = match &format[8..18] {
            [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0] => 44_100,
            [0x40, 0x0e, 0xbb, 0x80, 0, 0, 0, 0, 0, 0] => 48_000,
            _ => return Err(AudioError::UnsupportedFormat.into()),
        };
        let offset = u32_at(data) as usize;
        if offset > data.len() - 8 || u32_at(&data[4..]) != 0 {
            return Err(AudioError::UnsupportedFormat.into());
        }
        (
            u16_at(format),
            u16_at(&format[6..]),
            rate,
            u64::from(u32_at(&format[2..])),
            data.len() - 8 - offset,
        )
    };
    if !matches!(channels, 1 | 2) || !matches!(bits, 16 | 24) || !matches!(rate, 44_100 | 48_000) {
        return Err(AudioError::UnsupportedFormat.into());
    }
    let alignment = u64::from(channels) * u64::from(bits / 8);
    if frame_count == 0 || frame_count * alignment != byte_count as u64 {
        return Err(corrupt("empty or partial PCM frames"));
    }
    Ok((
        PcmInfo {
            sample_rate: rate,
            channels,
            bits_per_sample: bits,
            frame_count,
        },
        if little { "source.wav" } else { "source.aiff" },
    ))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WavLayout {
    pub info: PcmInfo,
    pub fmt_chunk: Vec<u8>,
    pub pcm_payload: Vec<u8>,
}

/// Integer PCM RIFF/WAVE layout for lossless trim/export (44.1/48 kHz, 16/24-bit).
pub fn inspect_wav_layout(bytes: &[u8], cancelled: &AtomicBool) -> Result<WavLayout, PcmError> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(AudioError::UnsupportedFormat.into());
    }
    let (info, _) = inspect_container(bytes, cancelled)?;
    let u32_at = |slice: &[u8]| u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
    let mut format = None;
    let mut data = None;
    let mut offset = 12;
    while offset < bytes.len() {
        check_cancel(cancelled)?;
        if bytes.len() - offset < 8 {
            return Err(corrupt("truncated chunk header"));
        }
        let id = &bytes[offset..offset + 4];
        let length = u32_at(&bytes[offset + 4..offset + 8]) as usize;
        offset += 8;
        if length > bytes.len() - offset {
            return Err(corrupt("chunk exceeds container"));
        }
        let payload = &bytes[offset..offset + length];
        if id == b"fmt " {
            if format.replace(payload.to_vec()).is_some() {
                return Err(corrupt("duplicate format chunk"));
            }
        } else if id == b"data" && data.replace(payload.to_vec()).is_some() {
            return Err(corrupt("duplicate audio chunk"));
        }
        offset += length + length % 2;
    }
    let fmt_chunk = format.ok_or_else(|| corrupt("missing format chunk"))?;
    let pcm_payload = data.ok_or_else(|| corrupt("missing audio chunk"))?;
    Ok(WavLayout {
        info,
        fmt_chunk,
        pcm_payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::slicing::PcmFrame;

    fn range(start: u64, end: u64) -> FrameRange {
        FrameRange::new(PcmFrame::new(start), PcmFrame::new(end)).unwrap()
    }

    fn hash(bytes: &[u8]) -> ContentHash {
        ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap()
    }

    fn snapshot(bytes: &[u8]) -> Result<PcmSnapshot, PcmError> {
        PcmSnapshot::read(bytes, &hash(bytes), &AtomicBool::new(false))
    }

    /// Synthetic integer PCM only. Channel pairs have opposite signs so an
    /// accidental stereo-to-mono average or sample/frame mixup is observable.
    fn fixture(aiff: bool, bits: u16, channels: u16, rate: u32, frames: u32) -> Vec<u8> {
        let mut pcm = Vec::new();
        for frame in 0..frames {
            for channel in 0..channels {
                let value = if frame.is_multiple_of(3) {
                    1 << (bits - 2)
                } else {
                    0_i32
                };
                let value = if channel == 0 { value } else { -value };
                if aiff {
                    pcm.extend_from_slice(&value.to_be_bytes()[4 - usize::from(bits / 8)..]);
                } else {
                    pcm.extend_from_slice(&value.to_le_bytes()[..usize::from(bits / 8)]);
                }
            }
        }
        let mut bytes = Vec::new();
        if aiff {
            bytes.extend_from_slice(b"FORM\0\0\0\0AIFFCOMM");
            bytes.extend_from_slice(&18_u32.to_be_bytes());
            bytes.extend_from_slice(&channels.to_be_bytes());
            bytes.extend_from_slice(&frames.to_be_bytes());
            bytes.extend_from_slice(&bits.to_be_bytes());
            bytes.extend_from_slice(if rate == 44_100 {
                &[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]
            } else {
                &[0x40, 0x0e, 0xbb, 0x80, 0, 0, 0, 0, 0, 0]
            });
            bytes.extend_from_slice(b"SSND");
            bytes.extend_from_slice(&(pcm.len() as u32 + 8).to_be_bytes());
            bytes.extend_from_slice(&[0; 8]);
        } else {
            bytes.extend_from_slice(b"RIFF\0\0\0\0WAVEfmt ");
            bytes.extend_from_slice(&16_u32.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&channels.to_le_bytes());
            bytes.extend_from_slice(&rate.to_le_bytes());
            let alignment = channels * bits / 8;
            bytes.extend_from_slice(&(rate * u32::from(alignment)).to_le_bytes());
            bytes.extend_from_slice(&alignment.to_le_bytes());
            bytes.extend_from_slice(&bits.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        }
        bytes.extend_from_slice(&pcm);
        if !pcm.len().is_multiple_of(2) {
            bytes.push(0);
        }
        let length = bytes.len() as u32 - 8;
        let length = if aiff {
            length.to_be_bytes()
        } else {
            length.to_le_bytes()
        };
        bytes[4..8].copy_from_slice(&length);
        bytes
    }

    #[test]
    fn decode_preserves_source_coordinates_precision_and_stereo_polarity() {
        for aiff in [false, true] {
            for bits in [16, 24] {
                for channels in [1, 2] {
                    for rate in [44_100, 48_000] {
                        let bytes = fixture(aiff, bits, channels, rate, 9);
                        let before = hash(&bytes);
                        let snapshot = snapshot(&bytes).unwrap();
                        let result = snapshot
                            .region(range(3, 7), &AtomicBool::new(false))
                            .unwrap();
                        assert_eq!(result.source.frame_count, 9);
                        assert_eq!(result.source.sample_rate, rate);
                        assert_eq!(result.source.bits_per_sample, bits);
                        assert_eq!(result.samples.len(), 4 * usize::from(channels));
                        assert_eq!(result.samples[0], 0.5);
                        if channels == 2 {
                            assert_eq!(result.samples[1], -0.5);
                        }
                        assert_eq!(hash(&bytes), before);
                        assert_eq!(
                            snapshot
                                .region(range(8, 9), &AtomicBool::new(false))
                                .unwrap()
                                .samples
                                .len(),
                            usize::from(channels)
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn region_after_sixty_seconds_is_not_truncated_preview_audio() {
        let rate = 44_100;
        let snapshot = snapshot(&fixture(false, 16, 1, rate, rate * 62)).unwrap();
        let start = u64::from(rate) * 61;
        let result = snapshot
            .region(range(start, start + 3), &AtomicBool::new(false))
            .unwrap();
        assert_eq!(result.samples, vec![0.5, 0.0, 0.0]);
        assert!(matches!(
            snapshot.region(range(0, u64::from(rate) * 31), &AtomicBool::new(false)),
            Err(PcmError::LimitExceeded)
        ));
        assert!(snapshot
            .region(range(0, u64::from(rate) * 63), &AtomicBool::new(false))
            .is_err());
    }

    #[test]
    fn cancellation_and_hash_mismatch_publish_nothing() {
        let bytes = fixture(false, 16, 1, 44_100, 9);
        assert!(matches!(
            PcmSnapshot::read(bytes.as_slice(), &hash(&bytes), &AtomicBool::new(true)),
            Err(PcmError::Cancelled)
        ));
        assert!(matches!(
            PcmSnapshot::read(bytes.as_slice(), &hash(b"changed"), &AtomicBool::new(false)),
            Err(PcmError::Audio(AudioError::SourceChanged))
        ));
        let snapshot = snapshot(&bytes).unwrap();
        assert!(matches!(
            snapshot.region(range(0, 1), &AtomicBool::new(true)),
            Err(PcmError::Cancelled)
        ));
    }

    #[test]
    fn immutable_snapshot_survives_changes_to_the_input_buffer() {
        let mut bytes = fixture(false, 24, 2, 48_000, 9);
        let snapshot = snapshot(&bytes).unwrap();
        bytes.fill(0);
        assert_eq!(
            snapshot
                .region(range(0, 1), &AtomicBool::new(false))
                .unwrap()
                .samples,
            vec![0.5, -0.5]
        );
    }

    #[test]
    fn malformed_containers_never_publish_partial_success() {
        for aiff in [false, true] {
            let valid = fixture(aiff, 24, 1, 44_100, 9);
            for length in [0, 11, valid.len() - 2, valid.len() - 1] {
                assert!(snapshot(&valid[..length]).is_err());
            }
            let mut trailing = valid.clone();
            trailing.push(0);
            assert!(snapshot(&trailing).is_err());
        }
        let mut partial = fixture(false, 16, 2, 44_100, 9);
        partial.pop();
        partial.pop();
        let length = partial.len() as u32 - 8;
        partial[4..8].copy_from_slice(&length.to_le_bytes());
        partial[40..44].copy_from_slice(&34_u32.to_le_bytes());
        assert!(snapshot(&partial).is_err());
        let mut wrong_frames = fixture(true, 16, 1, 44_100, 9);
        wrong_frames[22..26].copy_from_slice(&10_u32.to_be_bytes());
        assert!(snapshot(&wrong_frames).is_err());
        let mut bad_alignment = fixture(false, 16, 2, 44_100, 9);
        bad_alignment[32..34].copy_from_slice(&2_u16.to_le_bytes());
        assert!(snapshot(&bad_alignment).is_err());
    }

    #[test]
    fn snapshot_size_is_bounded_even_for_a_reader_without_a_length() {
        let reader = std::io::repeat(0).take(MAX_SNAPSHOT_BYTES as u64 + 1);
        assert!(matches!(
            PcmSnapshot::read(reader, &hash(&[]), &AtomicBool::new(false)),
            Err(PcmError::LimitExceeded)
        ));
    }

    #[test]
    fn duplicate_chunks_are_rejected_and_unknown_odd_chunks_are_skipped() {
        let valid = fixture(false, 16, 1, 44_100, 9);
        for duplicate in [&valid[12..36], &valid[36..]] {
            let mut bytes = valid.clone();
            bytes.extend_from_slice(duplicate);
            let length = bytes.len() as u32 - 8;
            bytes[4..8].copy_from_slice(&length.to_le_bytes());
            assert!(snapshot(&bytes).is_err());
        }
        let mut bytes = valid.clone();
        bytes.extend_from_slice(b"JUNK\x01\0\0\0x\0");
        let length = bytes.len() as u32 - 8;
        bytes[4..8].copy_from_slice(&length.to_le_bytes());
        let result = snapshot(&bytes)
            .unwrap()
            .region(range(0, 1), &AtomicBool::new(false))
            .unwrap();
        assert_eq!(result.samples, vec![0.5]);
    }

    #[test]
    fn cancellation_during_snapshot_read_is_observed_before_publication() {
        struct CancellingReader<'a> {
            cancelled: &'a AtomicBool,
        }
        impl Read for CancellingReader<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                self.cancelled.store(true, Ordering::Relaxed);
                buffer[0] = 0;
                Ok(1)
            }
        }
        let cancelled = AtomicBool::new(false);
        assert!(matches!(
            PcmSnapshot::read(
                CancellingReader {
                    cancelled: &cancelled,
                },
                &hash(&[]),
                &cancelled,
            ),
            Err(PcmError::Cancelled)
        ));
    }
}
