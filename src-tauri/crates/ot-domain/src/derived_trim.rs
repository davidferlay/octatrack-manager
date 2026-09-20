//! Derived TRIM intent/plan contracts (Mac-side; no media Apply).

use crate::slicing::{FrameRange, SliceCoordinateError};
use crate::{ContentHash, DerivationParameterEnvelope, ProcessorIdentity};

/// Well-known catalog root for Mac Application Support derived audio.
pub const MAC_DERIVED_AUDIO_ROOT_LABEL: &str = "masterocta.mac-derived-audio.v1";

/// `rootfp:v1:` + SHA-256(`masterocta.mac-derived-audio.v1`).
pub const MAC_DERIVED_AUDIO_ROOT_FINGERPRINT: &str =
    "rootfp:v1:13bdc6604b00a52484f01428a1a34715c78b14fb852702113a04631db05f6951";

pub const TRIM_PROCESSOR_NAME: &str = "masterocta-trim";
pub const TRIM_PROCESSOR_REVISION: &str = "pcm-wav-v1";

/// Relative path prefix for published derived WAV files (`v1/{hex}.wav`).
pub const DERIVED_AUDIO_PUBLISHED_PREFIX: &str = "v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrimIntent {
    source: ContentHash,
    range: FrameRange,
}

impl TrimIntent {
    pub fn new(source: ContentHash, range: FrameRange) -> Self {
        Self { source, range }
    }

    pub fn source(&self) -> &ContentHash {
        &self.source
    }

    pub fn range(&self) -> FrameRange {
        self.range
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpectedTrimOutput {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub frame_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrimPlan {
    source: ContentHash,
    source_hash_evidence: ContentHash,
    range: FrameRange,
    expected: ExpectedTrimOutput,
    processor: ProcessorIdentity,
    parameters: DerivationParameterEnvelope,
    published_relative_path: String,
}

impl TrimPlan {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        source: ContentHash,
        source_hash_evidence: ContentHash,
        range: FrameRange,
        expected: ExpectedTrimOutput,
        processor: ProcessorIdentity,
        parameters: DerivationParameterEnvelope,
        output_content_hash: &ContentHash,
    ) -> Result<Self, SliceCoordinateError> {
        if source_hash_evidence != source {
            return Err(SliceCoordinateError::OutsideSource);
        }
        if expected.frame_count != range.frame_count() {
            return Err(SliceCoordinateError::OutsideSource);
        }
        let hex = output_content_hash
            .as_str()
            .strip_prefix("sha256:")
            .ok_or(SliceCoordinateError::InvalidDecimal)?;
        if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(SliceCoordinateError::InvalidDecimal);
        }
        let published_relative_path = format!("{DERIVED_AUDIO_PUBLISHED_PREFIX}/{hex}.wav");
        Ok(Self {
            source,
            source_hash_evidence,
            range,
            expected,
            processor,
            parameters,
            published_relative_path,
        })
    }

    pub fn source(&self) -> &ContentHash {
        &self.source
    }

    pub fn source_hash_evidence(&self) -> &ContentHash {
        &self.source_hash_evidence
    }

    pub fn range(&self) -> FrameRange {
        self.range
    }

    pub fn expected(&self) -> &ExpectedTrimOutput {
        &self.expected
    }

    pub fn processor(&self) -> &ProcessorIdentity {
        &self.processor
    }

    pub fn parameters(&self) -> &DerivationParameterEnvelope {
        &self.parameters
    }

    pub fn published_relative_path(&self) -> &str {
        &self.published_relative_path
    }
}

pub fn standard_trim_processor() -> Result<ProcessorIdentity, crate::InvalidDerivation> {
    ProcessorIdentity::new(TRIM_PROCESSOR_NAME, TRIM_PROCESSOR_REVISION)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slicing::PcmFrame;
    use crate::ContentHash;

    fn hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    #[test]
    fn trim_plan_builds_content_addressed_relative_path() {
        let source = hash(1);
        let output = hash(2);
        let range = FrameRange::new(PcmFrame::new(10), PcmFrame::new(20)).unwrap();
        let plan = TrimPlan::new(
            source.clone(),
            source,
            range,
            ExpectedTrimOutput {
                sample_rate: 44_100,
                channels: 2,
                bits_per_sample: 16,
                frame_count: 10,
            },
            standard_trim_processor().unwrap(),
            DerivationParameterEnvelope::trim(range).unwrap(),
            &output,
        )
        .unwrap();
        assert!(plan.published_relative_path().starts_with("v1/"));
        assert!(plan.published_relative_path().ends_with(".wav"));
    }
}
