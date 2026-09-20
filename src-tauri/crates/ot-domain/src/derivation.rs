use crate::slicing::{FrameRange, PcmFrame};
use crate::ContentHash;
use std::collections::HashSet;
use std::fmt;

const ENVELOPE_VERSION: &str = "v1";
const MAX_PROCESSOR_NAME_LEN: usize = 128;
const MAX_PROCESSOR_REVISION_LEN: usize = 64;
const MAX_CREATED_AT_LEN: usize = 40;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum DerivationKind {
    Trim,
    Normalize,
    Resample,
    BitDepthConvert,
    SliceExport,
    SampleChain,
    Stem,
    NodeRecordingProcess,
    ImportProcess,
}

impl DerivationKind {
    pub fn token(self) -> &'static str {
        match self {
            Self::Trim => "TRIM",
            Self::Normalize => "NORMALIZE",
            Self::Resample => "RESAMPLE",
            Self::BitDepthConvert => "BIT_DEPTH_CONVERT",
            Self::SliceExport => "SLICE_EXPORT",
            Self::SampleChain => "SAMPLE_CHAIN",
            Self::Stem => "STEM",
            Self::NodeRecordingProcess => "NODE_RECORDING_PROCESS",
            Self::ImportProcess => "IMPORT_PROCESS",
        }
    }

    pub fn parse_token(value: &str) -> Result<Self, InvalidDerivation> {
        match value {
            "TRIM" => Ok(Self::Trim),
            "NORMALIZE" => Ok(Self::Normalize),
            "RESAMPLE" => Ok(Self::Resample),
            "BIT_DEPTH_CONVERT" => Ok(Self::BitDepthConvert),
            "SLICE_EXPORT" => Ok(Self::SliceExport),
            "SAMPLE_CHAIN" => Ok(Self::SampleChain),
            "STEM" => Ok(Self::Stem),
            "NODE_RECORDING_PROCESS" => Ok(Self::NodeRecordingProcess),
            "IMPORT_PROCESS" => Ok(Self::ImportProcess),
            _ => Err(InvalidDerivation::UnknownKind),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StemRole {
    Kick,
    Snare,
    HiHat,
    Bass,
    Melody,
    Other,
    Vocal,
}

impl StemRole {
    pub fn token(self) -> &'static str {
        match self {
            Self::Kick => "KICK",
            Self::Snare => "SNARE",
            Self::HiHat => "HI_HAT",
            Self::Bass => "BASS",
            Self::Melody => "MELODY",
            Self::Other => "OTHER",
            Self::Vocal => "VOCAL",
        }
    }

    pub fn parse_token(value: &str) -> Result<Self, InvalidDerivation> {
        match value {
            "KICK" => Ok(Self::Kick),
            "SNARE" => Ok(Self::Snare),
            "HI_HAT" => Ok(Self::HiHat),
            "BASS" => Ok(Self::Bass),
            "MELODY" => Ok(Self::Melody),
            "OTHER" => Ok(Self::Other),
            "VOCAL" => Ok(Self::Vocal),
            _ => Err(InvalidDerivation::InvalidParameters),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DerivationParameters {
    Empty,
    Stem { role: StemRole },
    Trim { range: FrameRange },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DerivationParameterEnvelope {
    parameters: DerivationParameters,
}

impl DerivationParameterEnvelope {
    pub fn empty() -> Self {
        Self {
            parameters: DerivationParameters::Empty,
        }
    }

    pub fn stem(role: StemRole) -> Self {
        Self {
            parameters: DerivationParameters::Stem { role },
        }
    }

    pub fn trim(range: FrameRange) -> Result<Self, InvalidDerivation> {
        if range.frame_count() == 0 {
            return Err(InvalidDerivation::InvalidParameters);
        }
        Ok(Self {
            parameters: DerivationParameters::Trim { range },
        })
    }

    pub fn parameters(&self) -> &DerivationParameters {
        &self.parameters
    }

    pub fn encode(&self) -> String {
        match &self.parameters {
            DerivationParameters::Empty => format!("{ENVELOPE_VERSION}|kind=empty"),
            DerivationParameters::Stem { role } => {
                format!("{ENVELOPE_VERSION}|kind=stem|role={}", role.token())
            }
            DerivationParameters::Trim { range } => format!(
                "{ENVELOPE_VERSION}|kind=trim|start={}|end={}",
                range.start(),
                range.end_exclusive()
            ),
        }
    }

    pub fn decode(value: &str) -> Result<Self, InvalidDerivation> {
        let mut parts = value.split('|');
        let version = parts.next().ok_or(InvalidDerivation::InvalidParameters)?;
        if version != ENVELOPE_VERSION {
            return Err(InvalidDerivation::UnsupportedEnvelopeVersion);
        }
        let mut kind = None;
        let mut role = None;
        let mut start = None;
        let mut end = None;
        for part in parts {
            let Some((key, val)) = part.split_once('=') else {
                return Err(InvalidDerivation::InvalidParameters);
            };
            match key {
                "kind" => kind = Some(val),
                "role" => role = Some(val),
                "start" => start = Some(val),
                "end" => end = Some(val),
                _ => return Err(InvalidDerivation::InvalidParameters),
            }
        }
        match kind.ok_or(InvalidDerivation::InvalidParameters)? {
            "empty" => {
                if role.is_some() || start.is_some() || end.is_some() {
                    return Err(InvalidDerivation::InvalidParameters);
                }
                Ok(Self::empty())
            }
            "stem" => {
                if start.is_some() || end.is_some() {
                    return Err(InvalidDerivation::InvalidParameters);
                }
                Ok(Self::stem(StemRole::parse_token(
                    role.ok_or(InvalidDerivation::InvalidParameters)?,
                )?))
            }
            "trim" => {
                if role.is_some() {
                    return Err(InvalidDerivation::InvalidParameters);
                }
                let start =
                    PcmFrame::parse_decimal(start.ok_or(InvalidDerivation::InvalidParameters)?)
                        .map_err(|_| InvalidDerivation::InvalidParameters)?;
                let end = PcmFrame::parse_decimal(end.ok_or(InvalidDerivation::InvalidParameters)?)
                    .map_err(|_| InvalidDerivation::InvalidParameters)?;
                Self::trim(
                    FrameRange::new(start, end)
                        .map_err(|_| InvalidDerivation::InvalidParameters)?,
                )
            }
            _ => Err(InvalidDerivation::InvalidParameters),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessorIdentity {
    name: String,
    revision: String,
}

impl ProcessorIdentity {
    pub fn new(
        name: impl Into<String>,
        revision: impl Into<String>,
    ) -> Result<Self, InvalidDerivation> {
        let name = name.into();
        let revision = revision.into();
        validate_processor_field("processor name", &name, MAX_PROCESSOR_NAME_LEN)?;
        validate_processor_field("processor revision", &revision, MAX_PROCESSOR_REVISION_LEN)?;
        Ok(Self { name, revision })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn revision(&self) -> &str {
        &self.revision
    }
}

fn validate_processor_field(
    label: &'static str,
    value: &str,
    max_len: usize,
) -> Result<(), InvalidDerivation> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > max_len {
        return Err(InvalidDerivation::InvalidProcessorIdentity);
    }
    if trimmed != value {
        return Err(InvalidDerivation::InvalidProcessorIdentity);
    }
    if value.chars().any(char::is_control) {
        return Err(InvalidDerivation::InvalidProcessorIdentity);
    }
    let lower = value.to_ascii_lowercase();
    if lower.contains("rootfp:v1:")
        || lower.contains("fileinst:v1:")
        || lower.contains("asset:v1:")
        || value.contains('/')
        || value.contains('\\')
        || value.contains("sha256:")
    {
        return Err(InvalidDerivation::ForbiddenProcessorIdentity { field: label });
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetDerivation {
    output: ContentHash,
    source: ContentHash,
    kind: DerivationKind,
    processor: ProcessorIdentity,
    parameters: DerivationParameterEnvelope,
    source_hash_evidence: ContentHash,
    created_at: String,
}

impl AssetDerivation {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        output: ContentHash,
        source: ContentHash,
        kind: DerivationKind,
        processor: ProcessorIdentity,
        parameters: DerivationParameterEnvelope,
        source_hash_evidence: ContentHash,
        created_at: impl Into<String>,
    ) -> Result<Self, InvalidDerivation> {
        if output == source {
            return Err(InvalidDerivation::SelfReference);
        }
        if source_hash_evidence != source {
            return Err(InvalidDerivation::StaleSourceEvidence);
        }
        let created_at = created_at.into();
        validate_created_at(&created_at)?;
        validate_kind_parameters(kind, &parameters)?;
        Ok(Self {
            output,
            source,
            kind,
            processor,
            parameters,
            source_hash_evidence,
            created_at,
        })
    }

    pub fn output(&self) -> &ContentHash {
        &self.output
    }

    pub fn source(&self) -> &ContentHash {
        &self.source
    }

    pub fn kind(&self) -> DerivationKind {
        self.kind
    }

    pub fn processor(&self) -> &ProcessorIdentity {
        &self.processor
    }

    pub fn parameters(&self) -> &DerivationParameterEnvelope {
        &self.parameters
    }

    pub fn source_hash_evidence(&self) -> &ContentHash {
        &self.source_hash_evidence
    }

    pub fn created_at(&self) -> &str {
        &self.created_at
    }
}

fn validate_created_at(value: &str) -> Result<(), InvalidDerivation> {
    if value.is_empty() || value.len() > MAX_CREATED_AT_LEN {
        return Err(InvalidDerivation::InvalidCreatedAt);
    }
    if value.chars().any(char::is_control) {
        return Err(InvalidDerivation::InvalidCreatedAt);
    }
    Ok(())
}

fn validate_kind_parameters(
    kind: DerivationKind,
    envelope: &DerivationParameterEnvelope,
) -> Result<(), InvalidDerivation> {
    match kind {
        DerivationKind::Stem => match envelope.parameters() {
            DerivationParameters::Stem { .. } => Ok(()),
            DerivationParameters::Empty | DerivationParameters::Trim { .. } => {
                Err(InvalidDerivation::InvalidParameters)
            }
        },
        DerivationKind::Trim => match envelope.parameters() {
            DerivationParameters::Trim { .. } => Ok(()),
            DerivationParameters::Empty | DerivationParameters::Stem { .. } => {
                Err(InvalidDerivation::InvalidParameters)
            }
        },
        _ => match envelope.parameters() {
            DerivationParameters::Empty => Ok(()),
            DerivationParameters::Stem { .. } | DerivationParameters::Trim { .. } => {
                Err(InvalidDerivation::InvalidParameters)
            }
        },
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InvalidDerivation {
    SelfReference,
    Cycle,
    ConflictingLineage,
    StaleSourceEvidence,
    UnknownKind,
    InvalidParameters,
    UnsupportedEnvelopeVersion,
    InvalidProcessorIdentity,
    ForbiddenProcessorIdentity { field: &'static str },
    InvalidCreatedAt,
}

impl fmt::Display for InvalidDerivation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::SelfReference => {
                "derivation cannot reference the same asset as source and output"
            }
            Self::Cycle => "derivation would create a lineage cycle",
            Self::ConflictingLineage => "derived asset already has a registered parent",
            Self::StaleSourceEvidence => "source hash evidence does not match the source asset",
            Self::UnknownKind => "derivation kind is not supported",
            Self::InvalidParameters => "derivation parameters are invalid for the kind",
            Self::UnsupportedEnvelopeVersion => {
                "derivation parameter envelope version is unsupported"
            }
            Self::InvalidProcessorIdentity => "processor identity is invalid",
            Self::ForbiddenProcessorIdentity { field } => {
                return write!(
                    formatter,
                    "{field} must not contain paths, session identifiers, or content hashes"
                );
            }
            Self::InvalidCreatedAt => "derivation created_at timestamp is invalid",
        })
    }
}

impl std::error::Error for InvalidDerivation {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DerivationEdge {
    pub output: ContentHash,
    pub source: ContentHash,
}

pub fn would_create_cycle(
    existing: &[DerivationEdge],
    output: &ContentHash,
    source: &ContentHash,
) -> bool {
    if output == source {
        return true;
    }
    let mut current = source.clone();
    let mut visited = HashSet::new();
    loop {
        if current == *output {
            return true;
        }
        if !visited.insert(current.clone()) {
            return true;
        }
        let Some(parent) = existing
            .iter()
            .find(|edge| edge.output == current)
            .map(|edge| edge.source.clone())
        else {
            return false;
        };
        current = parent;
    }
}

pub fn validate_new_derivation(
    existing: &[DerivationEdge],
    derivation: &AssetDerivation,
) -> Result<(), InvalidDerivation> {
    if existing
        .iter()
        .any(|edge| edge.output == *derivation.output())
    {
        return Err(InvalidDerivation::ConflictingLineage);
    }
    if would_create_cycle(existing, derivation.output(), derivation.source()) {
        return Err(InvalidDerivation::Cycle);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ContentHash;

    fn hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    #[test]
    fn accepts_original_to_derived_lineage() {
        let source = hash(1);
        let output = hash(2);
        let derivation = AssetDerivation::new(
            output.clone(),
            source.clone(),
            DerivationKind::Normalize,
            ProcessorIdentity::new("normalize", "1").unwrap(),
            DerivationParameterEnvelope::empty(),
            source.clone(),
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        validate_new_derivation(&[], &derivation).unwrap();
    }

    #[test]
    fn rejects_self_reference() {
        let same = hash(1);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(1)).unwrap();
        let error = AssetDerivation::new(
            same.clone(),
            same.clone(),
            DerivationKind::Trim,
            ProcessorIdentity::new("trim", "1").unwrap(),
            DerivationParameterEnvelope::trim(range).unwrap(),
            same,
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap_err();
        assert_eq!(error, InvalidDerivation::SelfReference);
    }

    #[test]
    fn trim_envelope_round_trips() {
        let range = FrameRange::new(PcmFrame::new(100), PcmFrame::new(250)).unwrap();
        let envelope = DerivationParameterEnvelope::trim(range).unwrap();
        assert_eq!(
            envelope.encode(),
            "v1|kind=trim|start=100|end=250".to_string()
        );
        assert_eq!(
            DerivationParameterEnvelope::decode(&envelope.encode()).unwrap(),
            envelope
        );
    }

    #[test]
    fn rejects_trim_with_empty_envelope() {
        let source = hash(1);
        let output = hash(2);
        assert_eq!(
            AssetDerivation::new(
                output,
                source.clone(),
                DerivationKind::Trim,
                ProcessorIdentity::new("trim", "1").unwrap(),
                DerivationParameterEnvelope::empty(),
                source,
                "2026-09-20T00:00:00.000Z",
            )
            .unwrap_err(),
            InvalidDerivation::InvalidParameters
        );
    }

    #[test]
    fn rejects_cycle() {
        let a = hash(1);
        let b = hash(2);
        let c = hash(3);
        let existing = vec![
            DerivationEdge {
                output: b.clone(),
                source: a.clone(),
            },
            DerivationEdge {
                output: c.clone(),
                source: b.clone(),
            },
        ];
        let derivation = AssetDerivation::new(
            a.clone(),
            c.clone(),
            DerivationKind::ImportProcess,
            ProcessorIdentity::new("import", "1").unwrap(),
            DerivationParameterEnvelope::empty(),
            c.clone(),
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        assert_eq!(
            validate_new_derivation(&existing, &derivation).unwrap_err(),
            InvalidDerivation::Cycle
        );
    }

    #[test]
    fn rejects_conflicting_lineage() {
        let source = hash(1);
        let output = hash(2);
        let existing = vec![DerivationEdge {
            output: output.clone(),
            source: hash(9),
        }];
        let derivation = AssetDerivation::new(
            output,
            source.clone(),
            DerivationKind::Resample,
            ProcessorIdentity::new("resample", "1").unwrap(),
            DerivationParameterEnvelope::empty(),
            source,
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        assert_eq!(
            validate_new_derivation(&existing, &derivation).unwrap_err(),
            InvalidDerivation::ConflictingLineage
        );
    }

    #[test]
    fn stem_role_round_trips_through_envelope() {
        let envelope = DerivationParameterEnvelope::stem(StemRole::Kick);
        assert_eq!(envelope.encode(), "v1|kind=stem|role=KICK".to_string());
        let decoded = DerivationParameterEnvelope::decode(&envelope.encode()).unwrap();
        assert_eq!(decoded, envelope);
        let source = hash(1);
        let output = hash(2);
        AssetDerivation::new(
            output,
            source.clone(),
            DerivationKind::Stem,
            ProcessorIdentity::new("stem", "1").unwrap(),
            envelope,
            source,
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
    }

    #[test]
    fn rejects_processor_identity_with_paths_or_hashes() {
        assert_eq!(
            ProcessorIdentity::new("/tmp/processor", "1").unwrap_err(),
            InvalidDerivation::ForbiddenProcessorIdentity {
                field: "processor name"
            }
        );
        assert_eq!(
            ProcessorIdentity::new("sha256:abc", "1").unwrap_err(),
            InvalidDerivation::ForbiddenProcessorIdentity {
                field: "processor name"
            }
        );
    }
}
