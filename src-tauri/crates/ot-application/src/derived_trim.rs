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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrimVerificationKind {
    HashMismatch,
    PcmMismatch,
    MetadataMismatch,
    MalformedOutput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrimApplyError {
    SourceMismatch,
    Catalog(CatalogError),
    Processor(String),
    Publish(String),
    Plan(String),
    Verification {
        kind: TrimVerificationKind,
        message: String,
    },
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
            Self::Verification { kind, message } => {
                write!(formatter, "trim verification failed ({kind:?}): {message}")
            }
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

pub trait TrimDerivationVerifier {
    fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError>;

    fn verify_trim_output(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
        output_wav: &[u8],
        expected: &ExpectedTrimOutput,
        claimed_output_hash: &ContentHash,
    ) -> Result<ContentHash, TrimApplyError>;
}

pub trait DerivedAudioPublisher {
    fn publish_trim_output(
        &mut self,
        plan: &TrimPlan,
        wav_bytes: &[u8],
        output_hash: &ContentHash,
    ) -> Result<(), TrimApplyError>;
}

pub struct ApplyTrimDerivation<'a, P, V, S, C> {
    processor: &'a P,
    verifier: &'a V,
    publisher: &'a mut S,
    catalog: &'a mut C,
    created_at: &'a str,
}

impl<'a, P, V, S, C> ApplyTrimDerivation<'a, P, V, S, C>
where
    P: TrimWavProcessor,
    V: TrimDerivationVerifier,
    S: DerivedAudioPublisher,
    C: DerivedAudioCatalog + AssetDerivationCatalog,
{
    pub fn new(
        processor: &'a P,
        verifier: &'a V,
        publisher: &'a mut S,
        catalog: &'a mut C,
        created_at: &'a str,
    ) -> Self {
        Self {
            processor,
            verifier,
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
        let recomputed_source = self.verifier.content_hash(verified_source_bytes)?;
        if intent.source() != verified_source_hash
            || intent.source() != source_hash_before
            || recomputed_source != *verified_source_hash
        {
            return Err(TrimApplyError::SourceMismatch);
        }
        let TrimWavResult {
            wav_bytes,
            expected,
            output_hash: claimed_output_hash,
        } = self.processor.trim_wav(verified_source_bytes, intent)?;
        let output_hash = self.verifier.verify_trim_output(
            verified_source_bytes,
            intent,
            &wav_bytes,
            &expected,
            &claimed_output_hash,
        )?;
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
        let loaded = self
            .catalog
            .load_asset_derivation(&output_hash)?
            .ok_or_else(|| TrimApplyError::Plan("lineage missing after registration".into()))?;
        if loaded.output() != derivation.output() || loaded.source() != derivation.source() {
            return Err(TrimApplyError::Plan(
                "lineage final verification failed".into(),
            ));
        }
        Ok(TrimApplyResult {
            output: output_hash,
            source_unchanged: source_hash_before == verified_source_hash,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct RecordingPublisher {
        publish_calls: AtomicUsize,
    }

    impl RecordingPublisher {
        fn new() -> Self {
            Self {
                publish_calls: AtomicUsize::new(0),
            }
        }
    }

    impl DerivedAudioPublisher for RecordingPublisher {
        fn publish_trim_output(
            &mut self,
            _plan: &TrimPlan,
            _wav_bytes: &[u8],
            _output_hash: &ContentHash,
        ) -> Result<(), TrimApplyError> {
            self.publish_calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct FakeCatalog {
        upsert_calls: RefCell<usize>,
        register_calls: RefCell<usize>,
        fail_upsert: bool,
        fail_register: bool,
        derivations: RefCell<Vec<AssetDerivation>>,
    }

    impl FakeCatalog {
        fn new() -> Self {
            Self {
                upsert_calls: RefCell::new(0),
                register_calls: RefCell::new(0),
                fail_upsert: false,
                fail_register: false,
                derivations: RefCell::new(Vec::new()),
            }
        }
    }

    impl DerivedAudioCatalog for FakeCatalog {
        fn ensure_derived_root(
            &mut self,
        ) -> Result<ot_storage_ports::CatalogRootIdentity, CatalogError> {
            ot_storage_ports::CatalogRootIdentity::new(
                ot_domain::MAC_DERIVED_AUDIO_ROOT_FINGERPRINT,
            )
            .map_err(|_| CatalogError::InvalidRootIdentity)
        }

        fn upsert_derived_file(&mut self, _upsert: &DerivedFileUpsert) -> Result<(), CatalogError> {
            *self.upsert_calls.borrow_mut() += 1;
            if self.fail_upsert {
                return Err(CatalogError::Integrity {
                    message: "injected upsert failure".into(),
                });
            }
            Ok(())
        }
    }

    impl AssetDerivationCatalog for FakeCatalog {
        fn register_asset_derivation(
            &mut self,
            derivation: &AssetDerivation,
        ) -> Result<(), CatalogError> {
            *self.register_calls.borrow_mut() += 1;
            if self.fail_register {
                return Err(CatalogError::Derivation(
                    ot_domain::InvalidDerivation::ConflictingLineage,
                ));
            }
            let mut store = self.derivations.borrow_mut();
            if store
                .iter()
                .any(|existing| existing.output() == derivation.output())
            {
                return Ok(());
            }
            store.push(derivation.clone());
            Ok(())
        }

        fn load_asset_derivation(
            &self,
            output: &ContentHash,
        ) -> Result<Option<AssetDerivation>, CatalogError> {
            Ok(self
                .derivations
                .borrow()
                .iter()
                .find(|d| d.output() == output)
                .cloned())
        }

        fn list_derived_children(
            &self,
            _source: &ContentHash,
        ) -> Result<Vec<AssetDerivation>, CatalogError> {
            Ok(Vec::new())
        }

        fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
            Ok(Vec::new())
        }
    }

    struct PassThroughVerifier {
        hash: ContentHash,
        verify_ok: bool,
        verify_kind: TrimVerificationKind,
    }

    impl TrimDerivationVerifier for PassThroughVerifier {
        fn content_hash(&self, _bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
            Ok(self.hash.clone())
        }

        fn verify_trim_output(
            &self,
            _source_bytes: &[u8],
            _intent: &TrimIntent,
            _output_wav: &[u8],
            _expected: &ExpectedTrimOutput,
            claimed_output_hash: &ContentHash,
        ) -> Result<ContentHash, TrimApplyError> {
            if self.verify_ok {
                Ok(claimed_output_hash.clone())
            } else {
                Err(TrimApplyError::Verification {
                    kind: self.verify_kind,
                    message: "injected".into(),
                })
            }
        }
    }

    struct FailingProcessor;

    impl TrimWavProcessor for FailingProcessor {
        fn trim_wav(
            &self,
            _source_bytes: &[u8],
            _intent: &TrimIntent,
        ) -> Result<TrimWavResult, TrimApplyError> {
            Err(TrimApplyError::Processor("fail".into()))
        }
    }

    struct StaticProcessor {
        result: TrimWavResult,
    }

    impl TrimWavProcessor for StaticProcessor {
        fn trim_wav(
            &self,
            _source_bytes: &[u8],
            _intent: &TrimIntent,
        ) -> Result<TrimWavResult, TrimApplyError> {
            Ok(self.result.clone())
        }
    }

    fn hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    fn sample_result(output_hash: ContentHash) -> TrimWavResult {
        TrimWavResult {
            wav_bytes: vec![0_u8; 64],
            expected: ExpectedTrimOutput {
                sample_rate: 44_100,
                channels: 1,
                bits_per_sample: 16,
                frame_count: 10,
            },
            output_hash,
        }
    }

    #[test]
    fn processor_failure_leaves_no_publish_or_catalog_side_effects() {
        let source = hash(1);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = FailingProcessor;
        let verifier = PassThroughVerifier {
            hash: source.clone(),
            verify_ok: true,
            verify_kind: TrimVerificationKind::HashMismatch,
        };
        let mut publisher = RecordingPublisher::new();
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"src", &source, &source),
            Err(TrimApplyError::Processor(_))
        ));
        assert_eq!(publisher.publish_calls.load(Ordering::SeqCst), 0);
        assert_eq!(*catalog.upsert_calls.borrow(), 0);
    }

    #[test]
    fn verification_hash_mismatch_skips_publish_and_catalog() {
        let source = hash(2);
        let output = hash(3);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = StaticProcessor {
            result: sample_result(output),
        };
        let verifier = PassThroughVerifier {
            hash: source.clone(),
            verify_ok: false,
            verify_kind: TrimVerificationKind::HashMismatch,
        };
        let mut publisher = RecordingPublisher::new();
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"src", &source, &source),
            Err(TrimApplyError::Verification {
                kind: TrimVerificationKind::HashMismatch,
                ..
            })
        ));
        assert_eq!(publisher.publish_calls.load(Ordering::SeqCst), 0);
        assert_eq!(*catalog.register_calls.borrow(), 0);
    }

    #[test]
    fn catalog_failure_after_publish_is_surfaced() {
        let source = hash(4);
        let output = hash(5);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = StaticProcessor {
            result: sample_result(output.clone()),
        };
        let verifier = PassThroughVerifier {
            hash: source.clone(),
            verify_ok: true,
            verify_kind: TrimVerificationKind::HashMismatch,
        };
        let mut publisher = RecordingPublisher::new();
        let mut catalog = FakeCatalog::new();
        catalog.fail_upsert = true;
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, b"src", &source, &source),
            Err(TrimApplyError::Catalog(_))
        ));
        assert_eq!(publisher.publish_calls.load(Ordering::SeqCst), 1);
        assert_eq!(*catalog.register_calls.borrow(), 0);
    }

    #[test]
    fn idempotent_retry_registers_lineage_once() {
        let source = hash(6);
        let output = hash(7);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(10)).unwrap();
        let intent = TrimIntent::new(source.clone(), range);
        let processor = StaticProcessor {
            result: sample_result(output.clone()),
        };
        let verifier = PassThroughVerifier {
            hash: source.clone(),
            verify_ok: true,
            verify_kind: TrimVerificationKind::HashMismatch,
        };
        let mut publisher = RecordingPublisher::new();
        let mut catalog = FakeCatalog::new();
        let mut apply = ApplyTrimDerivation::new(
            &processor,
            &verifier,
            &mut publisher,
            &mut catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply.execute(&intent, b"src", &source, &source).unwrap();
        apply.execute(&intent, b"src", &source, &source).unwrap();
        assert_eq!(*catalog.register_calls.borrow(), 2);
        assert_eq!(catalog.derivations.borrow().len(), 1);
    }
}
