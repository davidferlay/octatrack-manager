//! Lossless integer PCM WAV trim (byte-preserving payload).

use crate::content_hash_for_bytes;
use crate::pcm::{inspect_wav_layout, PcmError, MAX_SNAPSHOT_BYTES};
use ot_domain::slicing::FrameRange;
use ot_domain::{ContentHash, ExpectedTrimOutput};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrimVerifyError {
    MalformedOutput(&'static str),
    MetadataMismatch(&'static str),
    PcmMismatch(&'static str),
    HashMismatch,
}

impl fmt::Display for TrimVerifyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedOutput(message) => write!(formatter, "malformed trim output: {message}"),
            Self::MetadataMismatch(message) => {
                write!(formatter, "trim output metadata mismatch: {message}")
            }
            Self::PcmMismatch(message) => write!(formatter, "trim PCM mismatch: {message}"),
            Self::HashMismatch => formatter.write_str("trim output hash mismatch"),
        }
    }
}

impl std::error::Error for TrimVerifyError {}

/// Independently verify TRIM output: PCM slice equality (not full WAV header), metadata, hash.
pub fn verify_trim_wav_output(
    source_wav: &[u8],
    output_wav: &[u8],
    range: FrameRange,
    expected: &ExpectedTrimOutput,
    claimed_output_hash: &ContentHash,
    cancelled: &AtomicBool,
) -> Result<ContentHash, TrimVerifyError> {
    let source_layout = inspect_wav_layout(source_wav, cancelled)
        .map_err(|_| TrimVerifyError::MalformedOutput("invalid source wav"))?;
    let output_layout = inspect_wav_layout(output_wav, cancelled)
        .map_err(|_| TrimVerifyError::MalformedOutput("invalid output wav"))?;
    range
        .within(source_layout.info.frame_count)
        .map_err(|_| TrimVerifyError::MalformedOutput("trim range outside source"))?;
    if output_layout.info.frame_count != range.frame_count() {
        return Err(TrimVerifyError::MetadataMismatch("output frame count"));
    }
    if expected.frame_count != output_layout.info.frame_count
        || expected.sample_rate != output_layout.info.sample_rate
        || expected.channels != output_layout.info.channels
        || expected.bits_per_sample != output_layout.info.bits_per_sample
    {
        return Err(TrimVerifyError::MetadataMismatch(
            "processor expected metadata",
        ));
    }
    let source_align =
        u64::from(source_layout.info.channels) * u64::from(source_layout.info.bits_per_sample / 8);
    let output_align =
        u64::from(output_layout.info.channels) * u64::from(output_layout.info.bits_per_sample / 8);
    if source_align != output_align
        || source_layout.info.channels != output_layout.info.channels
        || source_layout.info.bits_per_sample != output_layout.info.bits_per_sample
    {
        return Err(TrimVerifyError::MetadataMismatch("channel layout"));
    }
    let start_byte = range.start().get().saturating_mul(source_align) as usize;
    let end_byte = range.end_exclusive().get().saturating_mul(source_align) as usize;
    if end_byte > source_layout.pcm_payload.len() || start_byte >= end_byte {
        return Err(TrimVerifyError::MalformedOutput(
            "invalid source byte range",
        ));
    }
    let source_slice = &source_layout.pcm_payload[start_byte..end_byte];
    if source_slice != output_layout.pcm_payload.as_slice() {
        return Err(TrimVerifyError::PcmMismatch(
            "source slice vs output payload",
        ));
    }
    let actual_hash = content_hash_for_bytes(output_wav);
    if actual_hash != *claimed_output_hash {
        return Err(TrimVerifyError::HashMismatch);
    }
    Ok(actual_hash)
}

pub fn test_minimal_wav(frames: u32) -> Vec<u8> {
    let mut pcm = vec![0_u8; frames as usize * 2];
    for (index, sample) in pcm.chunks_mut(2).enumerate() {
        if index.is_multiple_of(3) {
            sample.copy_from_slice(&i16::to_le_bytes(8192));
        }
    }
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF\0\0\0\0WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&44100_u32.to_le_bytes());
    bytes.extend_from_slice(&88200_u32.to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&pcm);
    let length = (bytes.len() - 8) as u32;
    bytes[4..8].copy_from_slice(&length.to_le_bytes());
    bytes
}

pub fn trim_wav_integer_pcm(
    source: &[u8],
    range: FrameRange,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, PcmError> {
    if source.len() > MAX_SNAPSHOT_BYTES {
        return Err(PcmError::LimitExceeded);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(PcmError::Cancelled);
    }
    let layout = inspect_wav_layout(source, cancelled)?;
    range
        .within(layout.info.frame_count)
        .map_err(|_| crate::AudioError::InvalidRequest("trim range outside source"))?;
    let alignment = u64::from(layout.info.channels) * u64::from(layout.info.bits_per_sample / 8);
    let start_byte = range.start().get().saturating_mul(alignment) as usize;
    let end_byte = range.end_exclusive().get().saturating_mul(alignment) as usize;
    if end_byte > layout.pcm_payload.len() || start_byte >= end_byte {
        return Err(crate::AudioError::InvalidRequest("invalid trim byte range").into());
    }
    let trimmed_pcm = &layout.pcm_payload[start_byte..end_byte];
    Ok(encode_integer_wav(
        &layout.fmt_chunk,
        layout.info.sample_rate,
        layout.info.channels,
        layout.info.bits_per_sample,
        trimmed_pcm,
    ))
}

fn encode_integer_wav(
    fmt_chunk: &[u8],
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    pcm_payload: &[u8],
) -> Vec<u8> {
    let block_align = u32::from(channels) * u32::from(bits_per_sample) / 8;
    let data_size = pcm_payload.len();
    let riff_size =
        4usize + 8 + fmt_chunk.len() + fmt_chunk.len() % 2 + 8 + data_size + data_size % 2;
    let mut out = Vec::with_capacity(8 + riff_size);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff_size as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&(fmt_chunk.len() as u32).to_le_bytes());
    out.extend_from_slice(fmt_chunk);
    if fmt_chunk.len() % 2 == 1 {
        out.push(0);
    }
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_size as u32).to_le_bytes());
    out.extend_from_slice(pcm_payload);
    if pcm_payload.len() % 2 == 1 {
        out.push(0);
    }
    let _ = (sample_rate, block_align);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use ot_domain::ExpectedTrimOutput;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn verify_accepts_valid_trim_output() {
        let wav = test_minimal_wav(100);
        let range = FrameRange::new(PcmFrame::new(10), PcmFrame::new(40)).unwrap();
        let trimmed = trim_wav_integer_pcm(&wav, range, &AtomicBool::new(false)).unwrap();
        let layout = inspect_wav_layout(&trimmed, &AtomicBool::new(false)).unwrap();
        let expected = ExpectedTrimOutput {
            sample_rate: layout.info.sample_rate,
            channels: layout.info.channels,
            bits_per_sample: layout.info.bits_per_sample,
            frame_count: layout.info.frame_count,
        };
        let hash = content_hash_for_bytes(&trimmed);
        verify_trim_wav_output(
            &wav,
            &trimmed,
            range,
            &expected,
            &hash,
            &AtomicBool::new(false),
        )
        .unwrap();
    }

    #[test]
    fn verify_rejects_pcm_byte_mutation() {
        let wav = test_minimal_wav(100);
        let range = FrameRange::new(PcmFrame::new(10), PcmFrame::new(40)).unwrap();
        let reference = trim_wav_integer_pcm(&wav, range, &AtomicBool::new(false)).unwrap();
        let mut trimmed = reference.clone();
        let layout = inspect_wav_layout(&reference, &AtomicBool::new(false)).unwrap();
        let payload_start = trimmed.len() - layout.pcm_payload.len();
        trimmed[payload_start] ^= 0x01;
        let expected = ExpectedTrimOutput {
            sample_rate: layout.info.sample_rate,
            channels: layout.info.channels,
            bits_per_sample: layout.info.bits_per_sample,
            frame_count: layout.info.frame_count,
        };
        let hash = content_hash_for_bytes(&trimmed);
        assert_eq!(
            verify_trim_wav_output(
                &wav,
                &trimmed,
                range,
                &expected,
                &hash,
                &AtomicBool::new(false),
            ),
            Err(TrimVerifyError::PcmMismatch(
                "source slice vs output payload"
            ))
        );
    }

    #[test]
    fn verify_rejects_wrong_claimed_hash() {
        let wav = test_minimal_wav(50);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(20)).unwrap();
        let trimmed = trim_wav_integer_pcm(&wav, range, &AtomicBool::new(false)).unwrap();
        let layout = inspect_wav_layout(&trimmed, &AtomicBool::new(false)).unwrap();
        let expected = ExpectedTrimOutput {
            sample_rate: layout.info.sample_rate,
            channels: layout.info.channels,
            bits_per_sample: layout.info.bits_per_sample,
            frame_count: layout.info.frame_count,
        };
        let wrong = ContentHash::parse(format!("sha256:{}", "a".repeat(64))).unwrap();
        assert_eq!(
            verify_trim_wav_output(
                &wav,
                &trimmed,
                range,
                &expected,
                &wrong,
                &AtomicBool::new(false),
            ),
            Err(TrimVerifyError::HashMismatch)
        );
    }

    #[test]
    fn trim_preserves_pcm_payload_bytes() {
        let wav = super::test_minimal_wav(100);
        let layout = inspect_wav_layout(&wav, &AtomicBool::new(false)).unwrap();
        let range = FrameRange::new(PcmFrame::new(10), PcmFrame::new(40)).unwrap();
        let trimmed = trim_wav_integer_pcm(&wav, range, &AtomicBool::new(false)).unwrap();
        let out_layout = inspect_wav_layout(&trimmed, &AtomicBool::new(false)).unwrap();
        assert_eq!(out_layout.info.frame_count, 30);
        assert_eq!(out_layout.info.sample_rate, layout.info.sample_rate);
        assert_eq!(out_layout.pcm_payload, layout.pcm_payload[10 * 2..40 * 2]);
    }
}
