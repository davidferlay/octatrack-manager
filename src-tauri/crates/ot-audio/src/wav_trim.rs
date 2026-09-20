//! Lossless integer PCM WAV trim (byte-preserving payload).

use crate::pcm::{inspect_wav_layout, PcmError, MAX_SNAPSHOT_BYTES};
use ot_domain::slicing::FrameRange;
use std::sync::atomic::{AtomicBool, Ordering};

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
    use std::sync::atomic::AtomicBool;

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
