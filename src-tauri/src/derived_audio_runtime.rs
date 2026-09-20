use ot_application::{
    DerivedAudioPublisher, TrimApplyError, TrimDerivationVerifier, TrimVerificationKind,
    TrimWavProcessor,
};
use ot_audio::{trim_wav_integer_pcm, TrimVerifyError};
use ot_domain::ContentHash;
use ot_domain::{ExpectedTrimOutput, TrimIntent, TrimPlan};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const DERIVED_DIRECTORY: &str = "derived-audio";
const STAGING_DIRECTORY: &str = "staging";
const PUBLISHED_DIRECTORY: &str = "published";

pub struct DerivedAudioRuntime {
    product_directory: PathBuf,
}

impl DerivedAudioRuntime {
    pub fn open(data_directory: &Path) -> Result<Self, DerivedAudioRuntimeError> {
        fs::create_dir_all(data_directory)
            .map_err(|error| runtime_io("create data directory", error))?;
        let canonical_data_directory = data_directory
            .canonicalize()
            .map_err(|error| runtime_io("resolve data directory", error))?;
        let product_directory = canonical_data_directory.join(PRODUCT_DIRECTORY);
        ensure_product_directory(&canonical_data_directory, &product_directory)?;
        let derived_root = product_directory.join(DERIVED_DIRECTORY);
        ensure_subdirectory(&product_directory, &derived_root)?;
        ensure_subdirectory(&derived_root, &derived_root.join(STAGING_DIRECTORY))?;
        ensure_subdirectory(&derived_root, &derived_root.join(PUBLISHED_DIRECTORY))?;
        Ok(Self { product_directory })
    }

    fn derived_root(&self) -> PathBuf {
        self.product_directory.join(DERIVED_DIRECTORY)
    }

    fn staging_directory(&self) -> PathBuf {
        self.derived_root().join(STAGING_DIRECTORY)
    }

    fn published_path(&self, relative: &str) -> Result<PathBuf, DerivedAudioRuntimeError> {
        if relative.contains("..") || relative.starts_with('/') {
            return Err(DerivedAudioRuntimeError::UnsafePath {
                reason: "derived publish path must stay root-relative",
            });
        }
        let published = self.derived_root().join(PUBLISHED_DIRECTORY);
        let candidate = published.join(relative);
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| runtime_io("create derived publish parent", error))?;
        }
        let canonical_published = published
            .canonicalize()
            .map_err(|error| runtime_io("resolve published directory", error))?;
        let canonical_parent = candidate
            .parent()
            .ok_or(DerivedAudioRuntimeError::UnsafePath {
                reason: "missing derived parent directory",
            })?
            .canonicalize()
            .map_err(|error| runtime_io("resolve derived publish parent", error))?;
        if !canonical_parent.starts_with(&canonical_published) {
            return Err(DerivedAudioRuntimeError::UnsafePath {
                reason: "derived publish path escaped published root",
            });
        }
        Ok(candidate)
    }
}

pub struct OtAudioTrimProcessor;

impl TrimWavProcessor for OtAudioTrimProcessor {
    fn trim_wav(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
    ) -> Result<ot_application::TrimWavResult, TrimApplyError> {
        let cancelled = AtomicBool::new(false);
        let wav_bytes = trim_wav_integer_pcm(source_bytes, intent.range(), &cancelled)
            .map_err(|error| TrimApplyError::Processor(error.to_string()))?;
        let layout = ot_audio::pcm::inspect_wav_layout(&wav_bytes, &cancelled)
            .map_err(|error| TrimApplyError::Processor(error.to_string()))?;
        Ok(ot_application::TrimWavResult {
            output_hash: ot_audio::content_hash_for_bytes(&wav_bytes),
            wav_bytes,
            expected: ExpectedTrimOutput {
                sample_rate: layout.info.sample_rate,
                channels: layout.info.channels,
                bits_per_sample: layout.info.bits_per_sample,
                frame_count: layout.info.frame_count,
            },
        })
    }
}

pub struct OtAudioTrimVerifier;

impl TrimDerivationVerifier for OtAudioTrimVerifier {
    fn content_hash(&self, bytes: &[u8]) -> Result<ContentHash, TrimApplyError> {
        Ok(ot_audio::content_hash_for_bytes(bytes))
    }

    fn verify_trim_output(
        &self,
        source_bytes: &[u8],
        intent: &TrimIntent,
        output_wav: &[u8],
        expected: &ExpectedTrimOutput,
        claimed_output_hash: &ContentHash,
    ) -> Result<ContentHash, TrimApplyError> {
        let cancelled = AtomicBool::new(false);
        ot_audio::verify_trim_wav_output(
            source_bytes,
            output_wav,
            intent.range(),
            expected,
            claimed_output_hash,
            &cancelled,
        )
        .map_err(map_trim_verify_error)
    }
}

fn map_trim_verify_error(error: TrimVerifyError) -> TrimApplyError {
    let kind = match error {
        TrimVerifyError::HashMismatch => TrimVerificationKind::HashMismatch,
        TrimVerifyError::PcmMismatch(_) => TrimVerificationKind::PcmMismatch,
        TrimVerifyError::MetadataMismatch(_) => TrimVerificationKind::MetadataMismatch,
        TrimVerifyError::MalformedOutput(_) => TrimVerificationKind::MalformedOutput,
    };
    TrimApplyError::Verification {
        kind,
        message: error.to_string(),
    }
}

fn recheck_publish_hash(wav_bytes: &[u8], output_hash: &ContentHash) -> Result<(), TrimApplyError> {
    let actual = ot_audio::content_hash_for_bytes(wav_bytes);
    if actual != *output_hash {
        return Err(TrimApplyError::Verification {
            kind: TrimVerificationKind::HashMismatch,
            message: "publish-time output hash recheck failed".into(),
        });
    }
    Ok(())
}

struct StagingPartGuard {
    path: PathBuf,
    armed: bool,
}

impl StagingPartGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StagingPartGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

impl DerivedAudioPublisher for DerivedAudioRuntime {
    fn publish_trim_output(
        &mut self,
        plan: &TrimPlan,
        wav_bytes: &[u8],
        output_hash: &ContentHash,
    ) -> Result<(), TrimApplyError> {
        recheck_publish_hash(wav_bytes, output_hash)?;
        let destination = self
            .published_path(plan.published_relative_path())
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        if destination.exists() {
            let existing = fs::read(&destination)
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
            let existing_hash =
                ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&existing)))
                    .map_err(|_| TrimApplyError::Publish("invalid existing hash".into()))?;
            if existing_hash == *output_hash {
                return Ok(());
            }
            return Err(TrimApplyError::Publish(
                "derived publish path already exists with different content".into(),
            ));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        }
        let staging_name = format!(
            "trim-{}-{}.part",
            output_hash.as_str().replace(':', ""),
            std::process::id()
        );
        let staging_path = self.staging_directory().join(staging_name);
        let mut guard = StagingPartGuard::new(staging_path.clone());
        {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staging_path)
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
            file.write_all(wav_bytes)
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
            file.sync_all()
                .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        }
        fs::rename(&staging_path, &destination)
            .map_err(|error| TrimApplyError::Publish(error.to_string()))?;
        guard.disarm();
        Ok(())
    }
}

#[derive(Debug)]
pub enum DerivedAudioRuntimeError {
    Io {
        operation: &'static str,
        message: String,
    },
    UnsafePath {
        reason: &'static str,
    },
}

impl std::fmt::Display for DerivedAudioRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { operation, message } => {
                write!(formatter, "could not {operation}: {message}")
            }
            Self::UnsafePath { reason } => formatter.write_str(reason),
        }
    }
}

impl std::error::Error for DerivedAudioRuntimeError {}

fn runtime_io(operation: &'static str, error: io::Error) -> DerivedAudioRuntimeError {
    DerivedAudioRuntimeError::Io {
        operation,
        message: error.to_string(),
    }
}

fn ensure_product_directory(
    canonical_data_directory: &Path,
    product_directory: &Path,
) -> Result<(), DerivedAudioRuntimeError> {
    match fs::symlink_metadata(product_directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(DerivedAudioRuntimeError::UnsafePath {
                    reason: "product directory must be a real directory",
                });
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(product_directory)
                .map_err(|error| runtime_io("create product directory", error))?;
        }
        Err(error) => return Err(runtime_io("inspect product directory", error)),
    }
    let canonical_product = product_directory
        .canonicalize()
        .map_err(|error| runtime_io("resolve product directory", error))?;
    if !canonical_product.starts_with(canonical_data_directory) {
        return Err(DerivedAudioRuntimeError::UnsafePath {
            reason: "product directory escaped application data directory",
        });
    }
    Ok(())
}

fn ensure_subdirectory(parent: &Path, directory: &Path) -> Result<(), DerivedAudioRuntimeError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(DerivedAudioRuntimeError::UnsafePath {
                    reason: "derived subdirectory must be a real directory",
                });
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(directory)
                .map_err(|error| runtime_io("create derived directory", error))?;
        }
        Err(error) => return Err(runtime_io("inspect derived directory", error)),
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| runtime_io("resolve derived parent", error))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| runtime_io("resolve derived directory", error))?;
    if !canonical_directory.starts_with(&canonical_parent) {
        return Err(DerivedAudioRuntimeError::UnsafePath {
            reason: "derived directory escaped product directory",
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_application::ApplyTrimDerivation;
    use ot_catalog::SqliteCatalog;
    use ot_domain::slicing::{FrameRange, PcmFrame};
    use ot_domain::{ContentHash, TrimIntent};
    use ot_storage_ports::{
        AssetDerivationCatalog, CatalogError, DerivedAudioCatalog, DerivedFileUpsert,
    };
    use sha2::{Digest, Sha256};
    use std::fs;
    use tempfile::TempDir;

    fn hash_bytes(bytes: &[u8]) -> ContentHash {
        ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap()
    }

    fn seed_source(catalog: &mut SqliteCatalog, source_bytes: &[u8]) -> ContentHash {
        let source_hash = hash_bytes(source_bytes);
        catalog
            .upsert_derived_file(&DerivedFileUpsert {
                content_hash: source_hash.clone(),
                byte_size: source_bytes.len() as u64,
                relative_path: "fixtures/source.wav".into(),
                modified_at_unix_ns: None,
            })
            .unwrap();
        source_hash
    }

    fn staging_parts(runtime: &DerivedAudioRuntime) -> Vec<PathBuf> {
        fs::read_dir(runtime.staging_directory())
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_name().to_string_lossy().ends_with(".part"))
                    .map(|entry| entry.path())
                    .collect()
            })
            .unwrap_or_default()
    }

    struct WrongHashProcessor;

    impl TrimWavProcessor for WrongHashProcessor {
        fn trim_wav(
            &self,
            source_bytes: &[u8],
            intent: &TrimIntent,
        ) -> Result<ot_application::TrimWavResult, TrimApplyError> {
            let inner = OtAudioTrimProcessor;
            let mut result = inner.trim_wav(source_bytes, intent)?;
            result.output_hash = ContentHash::parse(format!("sha256:{}", "b".repeat(64))).unwrap();
            Ok(result)
        }
    }

    struct PcmMutatingProcessor;

    impl TrimWavProcessor for PcmMutatingProcessor {
        fn trim_wav(
            &self,
            source_bytes: &[u8],
            intent: &TrimIntent,
        ) -> Result<ot_application::TrimWavResult, TrimApplyError> {
            let inner = OtAudioTrimProcessor;
            let mut result = inner.trim_wav(source_bytes, intent)?;
            let cancelled = AtomicBool::new(false);
            let layout = ot_audio::pcm::inspect_wav_layout(&result.wav_bytes, &cancelled)
                .map_err(|error| TrimApplyError::Processor(error.to_string()))?;
            let payload_start = result.wav_bytes.len() - layout.pcm_payload.len();
            result.wav_bytes[payload_start] ^= 0x01;
            result.output_hash = ot_audio::content_hash_for_bytes(&result.wav_bytes);
            Ok(result)
        }
    }

    struct FailUpsertCatalog<'a> {
        inner: &'a mut SqliteCatalog,
    }

    impl DerivedAudioCatalog for FailUpsertCatalog<'_> {
        fn ensure_derived_root(
            &mut self,
        ) -> Result<ot_storage_ports::CatalogRootIdentity, CatalogError> {
            self.inner.ensure_derived_root()
        }

        fn upsert_derived_file(&mut self, _upsert: &DerivedFileUpsert) -> Result<(), CatalogError> {
            Err(CatalogError::Integrity {
                message: "injected catalog upsert failure".into(),
            })
        }
    }

    impl AssetDerivationCatalog for FailUpsertCatalog<'_> {
        fn register_asset_derivation(
            &mut self,
            derivation: &ot_domain::AssetDerivation,
        ) -> Result<(), CatalogError> {
            self.inner.register_asset_derivation(derivation)
        }

        fn load_asset_derivation(
            &self,
            output: &ContentHash,
        ) -> Result<Option<ot_domain::AssetDerivation>, CatalogError> {
            self.inner.load_asset_derivation(output)
        }

        fn list_derived_children(
            &self,
            source: &ContentHash,
        ) -> Result<Vec<ot_domain::AssetDerivation>, CatalogError> {
            self.inner.list_derived_children(source)
        }

        fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
            self.inner.list_derivation_edges()
        }
    }

    struct FailRegisterCatalog<'a> {
        inner: &'a mut SqliteCatalog,
    }

    impl DerivedAudioCatalog for FailRegisterCatalog<'_> {
        fn ensure_derived_root(
            &mut self,
        ) -> Result<ot_storage_ports::CatalogRootIdentity, CatalogError> {
            self.inner.ensure_derived_root()
        }

        fn upsert_derived_file(&mut self, upsert: &DerivedFileUpsert) -> Result<(), CatalogError> {
            self.inner.upsert_derived_file(upsert)
        }
    }

    impl AssetDerivationCatalog for FailRegisterCatalog<'_> {
        fn register_asset_derivation(
            &mut self,
            _derivation: &ot_domain::AssetDerivation,
        ) -> Result<(), CatalogError> {
            Err(CatalogError::Derivation(
                ot_domain::InvalidDerivation::ConflictingLineage,
            ))
        }

        fn load_asset_derivation(
            &self,
            output: &ContentHash,
        ) -> Result<Option<ot_domain::AssetDerivation>, CatalogError> {
            self.inner.load_asset_derivation(output)
        }

        fn list_derived_children(
            &self,
            source: &ContentHash,
        ) -> Result<Vec<ot_domain::AssetDerivation>, CatalogError> {
            self.inner.list_derived_children(source)
        }

        fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
            self.inner.list_derivation_edges()
        }
    }

    #[test]
    fn trim_vertical_slice_registers_lineage_and_preserves_source() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(200);
        let source_hash = seed_source(&mut catalog, &source_bytes);
        let range = FrameRange::new(PcmFrame::new(40), PcmFrame::new(120)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let processor = OtAudioTrimProcessor;
        let verifier = OtAudioTrimVerifier;
        let before = hash_bytes(&source_bytes);
        let output = {
            let mut apply = ApplyTrimDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            let result = apply
                .execute(&intent, &source_bytes, &source_hash, &before)
                .unwrap();
            assert_eq!(hash_bytes(&source_bytes), before);
            assert!(result.source_unchanged);
            result.output
        };
        let loaded = catalog.load_asset_derivation(&output).unwrap().unwrap();
        assert_eq!(loaded.source(), &source_hash);
        assert_eq!(loaded.kind(), ot_domain::DerivationKind::Trim);
        {
            let mut apply = ApplyTrimDerivation::new(
                &processor,
                &verifier,
                &mut runtime,
                &mut *catalog,
                "2026-09-20T12:00:00.000Z",
            );
            apply
                .execute(&intent, &source_bytes, &source_hash, &before)
                .unwrap();
        }
    }

    #[test]
    fn wrong_hash_processor_is_rejected_before_publish() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(80);
        let source_hash = seed_source(&mut catalog, &source_bytes);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(40)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let before = hash_bytes(&source_bytes);
        let mut apply = ApplyTrimDerivation::new(
            &WrongHashProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, &source_bytes, &source_hash, &before),
            Err(TrimApplyError::Verification {
                kind: TrimVerificationKind::HashMismatch,
                ..
            })
        ));
        assert!(staging_parts(&runtime).is_empty());
        assert!(catalog
            .load_asset_derivation(&hash_bytes(b"x"))
            .unwrap()
            .is_none());
        assert_eq!(hash_bytes(&source_bytes), before);
    }

    #[test]
    fn pcm_mutation_is_rejected_before_publish() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(80);
        let source_hash = seed_source(&mut catalog, &source_bytes);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(40)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let before = hash_bytes(&source_bytes);
        let mut apply = ApplyTrimDerivation::new(
            &PcmMutatingProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(matches!(
            apply.execute(&intent, &source_bytes, &source_hash, &before),
            Err(TrimApplyError::Verification {
                kind: TrimVerificationKind::PcmMismatch,
                ..
            })
        ));
        assert!(staging_parts(&runtime).is_empty());
    }

    #[test]
    fn staging_write_failure_leaves_no_completed_output() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(60);
        let source_hash = seed_source(&mut catalog, &source_bytes);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(30)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let trimmed = OtAudioTrimProcessor
            .trim_wav(&source_bytes, &intent)
            .unwrap();
        let staging_name = format!(
            "trim-{}-{}.part",
            trimmed.output_hash.as_str().replace(':', ""),
            std::process::id()
        );
        fs::write(runtime.staging_directory().join(staging_name), b"block").unwrap();
        let before = hash_bytes(&source_bytes);
        let mut apply = ApplyTrimDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T00:00:00.000Z",
        );
        assert!(apply
            .execute(&intent, &source_bytes, &source_hash, &before)
            .is_err());
        assert!(catalog
            .load_asset_derivation(&trimmed.output_hash)
            .unwrap()
            .is_none());
    }

    #[test]
    fn staging_part_guard_cleans_on_rename_failure() {
        let data = TempDir::new().unwrap();
        let runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let staging_path = runtime.staging_directory().join("guard-test.part");
        fs::write(&staging_path, b"partial").unwrap();
        {
            let guard = StagingPartGuard::new(staging_path.clone());
            assert!(fs::rename(
                &staging_path,
                PathBuf::from("/this/publish/path/cannot/exist/out.wav")
            )
            .is_err());
            drop(guard);
        }
        assert!(!staging_path.exists());
        let unrelated = runtime.staging_directory().join("unrelated-keep.part");
        fs::write(&unrelated, b"keep").unwrap();
        assert!(unrelated.exists());
    }

    #[test]
    fn catalog_failure_after_publish_leaves_recoverable_orphan() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(70);
        let source_hash = seed_source(&mut catalog, &source_bytes);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(35)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let before = hash_bytes(&source_bytes);
        {
            let mut failing = FailUpsertCatalog { inner: &mut catalog };
            let mut apply = ApplyTrimDerivation::new(
                &OtAudioTrimProcessor,
                &OtAudioTrimVerifier,
                &mut runtime,
                &mut failing,
                "2026-09-20T00:00:00.000Z",
            );
            assert!(matches!(
                apply.execute(&intent, &source_bytes, &source_hash, &before),
                Err(TrimApplyError::Catalog(_))
            ));
        }
        let trimmed = OtAudioTrimProcessor
            .trim_wav(&source_bytes, &intent)
            .unwrap();
        let published = runtime
            .published_path(
                ot_domain::TrimPlan::new(
                    source_hash.clone(),
                    source_hash.clone(),
                    range,
                    trimmed.expected,
                    ot_domain::standard_trim_processor().unwrap(),
                    ot_domain::DerivationParameterEnvelope::trim(range).unwrap(),
                    &trimmed.output_hash,
                )
                .unwrap()
                .published_relative_path(),
            )
            .unwrap();
        assert!(published.is_file());
        assert!(catalog
            .load_asset_derivation(&trimmed.output_hash)
            .unwrap()
            .is_none());
        let mut apply = ApplyTrimDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply
            .execute(&intent, &source_bytes, &source_hash, &before)
            .unwrap();
        assert!(catalog
            .load_asset_derivation(&trimmed.output_hash)
            .unwrap()
            .is_some());
    }

    #[test]
    fn lineage_failure_after_catalog_allows_retry() {
        let data = TempDir::new().unwrap();
        let mut runtime = DerivedAudioRuntime::open(data.path()).unwrap();
        let shared_catalog = crate::catalog_runtime::open_shared_catalog(data.path()).unwrap();
        let mut catalog = shared_catalog.lock().unwrap();
        let source_bytes = ot_audio::test_minimal_wav(65);
        let source_hash = seed_source(&mut catalog, &source_bytes);
        let range = FrameRange::new(PcmFrame::new(0), PcmFrame::new(32)).unwrap();
        let intent = TrimIntent::new(source_hash.clone(), range);
        let before = hash_bytes(&source_bytes);
        {
            let mut failing = FailRegisterCatalog { inner: &mut catalog };
            let mut apply = ApplyTrimDerivation::new(
                &OtAudioTrimProcessor,
                &OtAudioTrimVerifier,
                &mut runtime,
                &mut failing,
                "2026-09-20T00:00:00.000Z",
            );
            assert!(matches!(
                apply.execute(&intent, &source_bytes, &source_hash, &before),
                Err(TrimApplyError::Catalog(_))
            ));
        }
        let trimmed = OtAudioTrimProcessor
            .trim_wav(&source_bytes, &intent)
            .unwrap();
        assert!(catalog
            .load_asset_derivation(&trimmed.output_hash)
            .unwrap()
            .is_none());
        let mut apply = ApplyTrimDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-09-20T00:00:00.000Z",
        );
        apply
            .execute(&intent, &source_bytes, &source_hash, &before)
            .unwrap();
        assert!(catalog
            .load_asset_derivation(&trimmed.output_hash)
            .unwrap()
            .is_some());
    }
}
