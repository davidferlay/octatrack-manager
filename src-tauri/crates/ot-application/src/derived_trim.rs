use ot_domain::{
    standard_trim_processor, AssetDerivation, ContentHash, DerivationKind,
    DerivationParameterEnvelope, ExpectedTrimOutput, TrimIntent, TrimPlan,
};
use ot_storage_ports::{
    AssetDerivationCatalog, CatalogError, DerivedAudioCatalog, DerivedFileUpsert,
};
use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrimApplyResult {
    pub output: ContentHash,
    pub source_unchanged: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrimApplyError {
    SourceMismatch,
    Catalog(CatalogError),
    Processor(String),
    Publish(String),
    Plan(String),
}

impl fmt::Display for TrimApplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceMismatch => {
                formatter.write_str("verified source hash does not match intent")
            }
            Self::Catalog(error) => write!(formatter, "catalog error: {error}"),
            Self::Processor(message) => write!(formatter, "trim processor error: {message}"),
            Self::Publish(message) => write!(formatter, "derived publish error: {message}"),
            Self::Plan(message) => write!(formatter, "trim plan error: {message}"),
        }
    }
}

impl std::error::Error for TrimApplyError {}

impl From<CatalogError> for TrimApplyError {
    fn from(error: CatalogError) -> Self {
        Self::Catalog(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrimWavResult {
    pub wav_bytes: Vec<u8>,
    pub expected: ExpectedTrimOutput,
    pub output_hash: ContentHash,
}

pub trait TrimWavProcessor {
    fn trim_wav(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
    ) -> Result<TrimWavResult, TrimApplyError>;
}

pub trait DerivedAudioPublisher {
    fn publish_trim_output(
        &mut self,
        plan: &TrimPlan,
        wav_bytes: &[u8],
        output_hash: &ContentHash,
    ) -> Result<(), TrimApplyError>;
}

pub struct ApplyTrimDerivation<'a, P, S, C> {
    processor: &'a P,
    publisher: &'a mut S,
    catalog: &'a mut C,
    created_at: &'a str,
}

impl<'a, P, S, C> ApplyTrimDerivation<'a, P, S, C>
where
    P: TrimWavProcessor,
    S: DerivedAudioPublisher,
    C: DerivedAudioCatalog + AssetDerivationCatalog,
{
    pub fn new(
        processor: &'a P,
        publisher: &'a mut S,
        catalog: &'a mut C,
        created_at: &'a str,
    ) -> Self {
        Self {
            processor,
            publisher,
            catalog,
            created_at,
        }
    }

    pub fn execute(
        &mut self,
        intent: &TrimIntent,
        verified_source_bytes: &[u8],
        verified_source_hash: &ContentHash,
        source_hash_before: &ContentHash,
    ) -> Result<TrimApplyResult, TrimApplyError> {
        if intent.source() != verified_source_hash || intent.source() != source_hash_before {
            return Err(TrimApplyError::SourceMismatch);
        }
        let TrimWavResult {
            wav_bytes,
            expected,
            output_hash,
        } = self.processor.trim_wav(verified_source_bytes, intent)?;
        let parameters = DerivationParameterEnvelope::trim(intent.range())
            .map_err(|error| TrimApplyError::Plan(error.to_string()))?;
        let processor =
            standard_trim_processor().map_err(|error| TrimApplyError::Plan(error.to_string()))?;
        let plan = TrimPlan::new(
            verified_source_hash.clone(),
            verified_source_hash.clone(),
            intent.range(),
            expected,
            processor.clone(),
            parameters.clone(),
            &output_hash,
        )
        .map_err(|_| TrimApplyError::Plan("invalid trim plan".into()))?;
        self.publisher
            .publish_trim_output(&plan, &wav_bytes, &output_hash)?;
        self.catalog.upsert_derived_file(&DerivedFileUpsert {
            content_hash: output_hash.clone(),
            byte_size: wav_bytes.len() as u64,
            relative_path: plan.published_relative_path().to_string(),
            modified_at_unix_ns: None,
        })?;
        let derivation = AssetDerivation::new(
            output_hash.clone(),
            verified_source_hash.clone(),
            DerivationKind::Trim,
            processor,
            parameters,
            verified_source_hash.clone(),
            self.created_at,
        )
        .map_err(|error| TrimApplyError::Plan(error.to_string()))?;
        self.catalog.register_asset_derivation(&derivation)?;
        Ok(TrimApplyResult {
            output: output_hash,
            source_unchanged: source_hash_before == verified_source_hash,
        })
    }
}
