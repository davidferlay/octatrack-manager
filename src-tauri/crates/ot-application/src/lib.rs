#![forbid(unsafe_code)]

pub mod derived_trim;

pub use derived_trim::{
    ApplyTrimDerivation, DerivedAudioPublisher, TrimApplyError, TrimApplyResult, TrimWavProcessor,
    TrimWavResult,
};

use ot_codec_ports::{CodecError, ProjectCodec};
use ot_domain::{
    AssetDerivation, ContentHash, LibrarySnapshot, ManualAssetMetadata, ProjectDocument, RootId,
    RootRelativePath,
};
use ot_storage_ports::{
    AssetDerivationCatalog, AssetMetadataCatalog, CatalogError, CatalogRootIdentity,
    CatalogRootObservation, CatalogScan, LibraryCatalog, ProjectStorage, ReadOnlyLibrary,
    StorageError,
};
use std::fmt;

pub struct InspectProject<'a, S, C> {
    storage: &'a S,
    codec: &'a C,
}

impl<'a, S, C> InspectProject<'a, S, C>
where
    S: ProjectStorage,
    C: ProjectCodec,
{
    pub fn new(storage: &'a S, codec: &'a C) -> Self {
        Self { storage, codec }
    }

    pub fn execute(
        &self,
        root_id: &RootId,
        path: &RootRelativePath,
    ) -> Result<ProjectDocument, InspectProjectError> {
        let bytes = self.storage.read_project_file(root_id, path)?;
        Ok(self.codec.decode_project(&bytes)?)
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum InspectProjectError {
    Storage(StorageError),
    Codec(CodecError),
}

impl fmt::Display for InspectProjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(error) => write!(formatter, "could not read project: {error}"),
            Self::Codec(error) => write!(formatter, "could not decode project: {error}"),
        }
    }
}

impl std::error::Error for InspectProjectError {}

impl From<StorageError> for InspectProjectError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

impl From<CodecError> for InspectProjectError {
    fn from(error: CodecError) -> Self {
        Self::Codec(error)
    }
}

pub struct ListLibrary<'a, S> {
    storage: &'a S,
}

impl<'a, S> ListLibrary<'a, S>
where
    S: ReadOnlyLibrary,
{
    pub fn new(storage: &'a S) -> Self {
        Self { storage }
    }

    pub fn execute(&self, root_id: &RootId) -> Result<LibrarySnapshot, StorageError> {
        self.storage.list_library(root_id)
    }
}

pub struct StoreLibrarySnapshot<'a, C> {
    catalog: &'a mut C,
}

impl<'a, C> StoreLibrarySnapshot<'a, C>
where
    C: LibraryCatalog,
{
    pub fn new(catalog: &'a mut C) -> Self {
        Self { catalog }
    }

    pub fn execute(
        &mut self,
        observation: &CatalogRootObservation,
        snapshot: &LibrarySnapshot,
    ) -> Result<CatalogScan, CatalogError> {
        self.catalog.store_snapshot(observation, snapshot)
    }
}

pub struct LoadLibrarySnapshot<'a, C> {
    catalog: &'a C,
}

impl<'a, C> LoadLibrarySnapshot<'a, C>
where
    C: LibraryCatalog,
{
    pub fn new(catalog: &'a C) -> Self {
        Self { catalog }
    }

    pub fn execute(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<Option<LibrarySnapshot>, CatalogError> {
        self.catalog.load_latest_snapshot(identity)
    }
}

pub struct LoadManualAssetMetadata<'a, C> {
    catalog: &'a C,
}

impl<'a, C> LoadManualAssetMetadata<'a, C>
where
    C: AssetMetadataCatalog,
{
    pub fn new(catalog: &'a C) -> Self {
        Self { catalog }
    }

    pub fn execute(&self, asset: &ContentHash) -> Result<ManualAssetMetadata, CatalogError> {
        self.catalog.load_manual_asset_metadata(asset)
    }
}

pub struct RegisterAssetDerivation<'a, C> {
    catalog: &'a mut C,
}

impl<'a, C> RegisterAssetDerivation<'a, C>
where
    C: AssetDerivationCatalog,
{
    pub fn new(catalog: &'a mut C) -> Self {
        Self { catalog }
    }

    pub fn execute(&mut self, derivation: &AssetDerivation) -> Result<(), CatalogError> {
        self.catalog.register_asset_derivation(derivation)
    }
}

pub struct LoadAssetDerivation<'a, C> {
    catalog: &'a C,
}

impl<'a, C> LoadAssetDerivation<'a, C>
where
    C: AssetDerivationCatalog,
{
    pub fn new(catalog: &'a C) -> Self {
        Self { catalog }
    }

    pub fn execute(&self, output: &ContentHash) -> Result<Option<AssetDerivation>, CatalogError> {
        self.catalog.load_asset_derivation(output)
    }
}

pub struct ListDerivedChildren<'a, C> {
    catalog: &'a C,
}

impl<'a, C> ListDerivedChildren<'a, C>
where
    C: AssetDerivationCatalog,
{
    pub fn new(catalog: &'a C) -> Self {
        Self { catalog }
    }

    pub fn execute(&self, source: &ContentHash) -> Result<Vec<AssetDerivation>, CatalogError> {
        self.catalog.list_derived_children(source)
    }
}

pub struct ReplaceManualAssetMetadata<'a, C> {
    catalog: &'a mut C,
}

impl<'a, C> ReplaceManualAssetMetadata<'a, C>
where
    C: AssetMetadataCatalog,
{
    pub fn new(catalog: &'a mut C) -> Self {
        Self { catalog }
    }

    pub fn execute(
        &mut self,
        asset: &ContentHash,
        metadata: &ManualAssetMetadata,
    ) -> Result<(), CatalogError> {
        self.catalog.replace_manual_asset_metadata(asset, metadata)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::ProjectId;
    use std::cell::RefCell;

    struct RecordingStorage {
        calls: RefCell<Vec<(String, String)>>,
    }

    impl ProjectStorage for RecordingStorage {
        fn read_project_file(
            &self,
            root_id: &RootId,
            path: &RootRelativePath,
        ) -> Result<Vec<u8>, StorageError> {
            self.calls
                .borrow_mut()
                .push((root_id.as_str().into(), path.as_str().into()));
            Ok(b"demo".to_vec())
        }
    }

    struct FakeCodec;

    impl ProjectCodec for FakeCodec {
        fn decode_project(&self, bytes: &[u8]) -> Result<ProjectDocument, CodecError> {
            if bytes != b"demo" {
                return Err(CodecError::new("unexpected fixture"));
            }
            Ok(ProjectDocument {
                id: ProjectId::new("project-1").unwrap(),
                display_name: "Demo".into(),
            })
        }
    }

    #[test]
    fn composes_storage_and_codec_without_concrete_adapters() {
        let storage = RecordingStorage {
            calls: RefCell::new(Vec::new()),
        };
        let use_case = InspectProject::new(&storage, &FakeCodec);
        let root_id = RootId::new("root-1").unwrap();
        let path = RootRelativePath::parse("projects/demo/project.work").unwrap();

        let project = use_case.execute(&root_id, &path).unwrap();

        assert_eq!(project.display_name, "Demo");
        assert_eq!(
            storage.calls.into_inner(),
            vec![("root-1".into(), "projects/demo/project.work".into())]
        );
    }

    struct FakeLibrary;

    impl ReadOnlyLibrary for FakeLibrary {
        fn list_library(&self, root_id: &RootId) -> Result<LibrarySnapshot, StorageError> {
            if root_id.as_str() != "root-1" {
                return Err(StorageError::new("unexpected root"));
            }
            Ok(LibrarySnapshot::default())
        }
    }

    #[test]
    fn lists_a_library_by_opaque_root_id() {
        let root_id = RootId::new("root-1").unwrap();
        let snapshot = ListLibrary::new(&FakeLibrary).execute(&root_id).unwrap();

        assert_eq!(snapshot, LibrarySnapshot::default());
    }

    #[derive(Default)]
    struct FakeCatalog {
        identity: Option<CatalogRootIdentity>,
        snapshot: Option<LibrarySnapshot>,
    }

    impl LibraryCatalog for FakeCatalog {
        fn observe_root(
            &mut self,
            observation: &CatalogRootObservation,
        ) -> Result<(), CatalogError> {
            self.identity = Some(observation.identity.clone());
            Ok(())
        }

        fn store_snapshot(
            &mut self,
            observation: &CatalogRootObservation,
            snapshot: &LibrarySnapshot,
        ) -> Result<CatalogScan, CatalogError> {
            self.observe_root(observation)?;
            self.snapshot = Some(snapshot.clone());
            Ok(CatalogScan {
                id: ot_storage_ports::CatalogScanId::new(1).unwrap(),
                revision: ot_storage_ports::CatalogScanRevision::new(1).unwrap(),
                status: ot_storage_ports::CatalogScanStatus::Completed,
                failure_code: None,
            })
        }

        fn load_latest_snapshot(
            &self,
            identity: &CatalogRootIdentity,
        ) -> Result<Option<LibrarySnapshot>, CatalogError> {
            Ok((self.identity.as_ref() == Some(identity))
                .then(|| self.snapshot.clone())
                .flatten())
        }

        fn latest_scan(
            &self,
            _identity: &CatalogRootIdentity,
        ) -> Result<Option<CatalogScan>, CatalogError> {
            Ok(None)
        }
    }

    fn catalog_identity() -> CatalogRootIdentity {
        CatalogRootIdentity::new(format!("rootfp:v1:{}", "a".repeat(64))).unwrap()
    }

    #[test]
    fn stores_and_loads_snapshots_only_through_the_catalog_port() {
        let identity = catalog_identity();
        let observation = CatalogRootObservation {
            identity: identity.clone(),
            identity_is_stable: true,
            display_name: "Fixture root".into(),
            observed_revision: 7,
        };
        let snapshot = LibrarySnapshot::default();
        let mut catalog = FakeCatalog::default();

        let stored = StoreLibrarySnapshot::new(&mut catalog)
            .execute(&observation, &snapshot)
            .unwrap();
        let loaded = LoadLibrarySnapshot::new(&catalog)
            .execute(&identity)
            .unwrap();

        assert_eq!(
            stored.status,
            ot_storage_ports::CatalogScanStatus::Completed
        );
        assert_eq!(loaded, Some(snapshot));
        assert_eq!(catalog.identity, Some(identity));
    }

    struct FakeMetadataCatalog {
        expected_asset: ContentHash,
        metadata: ManualAssetMetadata,
    }

    impl AssetMetadataCatalog for FakeMetadataCatalog {
        fn load_manual_asset_metadata(
            &self,
            asset: &ContentHash,
        ) -> Result<ManualAssetMetadata, CatalogError> {
            if asset != &self.expected_asset {
                return Err(CatalogError::AssetNotFound);
            }
            Ok(self.metadata.clone())
        }

        fn replace_manual_asset_metadata(
            &mut self,
            asset: &ContentHash,
            metadata: &ManualAssetMetadata,
        ) -> Result<(), CatalogError> {
            if asset != &self.expected_asset {
                return Err(CatalogError::AssetNotFound);
            }
            self.metadata = metadata.clone();
            Ok(())
        }
    }

    #[test]
    fn manual_asset_metadata_use_cases_depend_only_on_the_catalog_port() {
        let asset = ContentHash::parse(format!("sha256:{}", "a".repeat(64))).unwrap();
        let replacement = ManualAssetMetadata::new(
            vec![ot_domain::ManualTag::parse("kick").unwrap()],
            Some(ot_domain::ManualNote::parse("Main kick").unwrap()),
        )
        .unwrap();
        let mut catalog = FakeMetadataCatalog {
            expected_asset: asset.clone(),
            metadata: ManualAssetMetadata::default(),
        };

        ReplaceManualAssetMetadata::new(&mut catalog)
            .execute(&asset, &replacement)
            .unwrap();
        let loaded = LoadManualAssetMetadata::new(&catalog)
            .execute(&asset)
            .unwrap();

        assert_eq!(loaded, replacement);
    }

    struct FakeDerivationCatalog {
        assets: std::collections::HashSet<ContentHash>,
        derivations: Vec<AssetDerivation>,
    }

    impl AssetDerivationCatalog for FakeDerivationCatalog {
        fn register_asset_derivation(
            &mut self,
            derivation: &AssetDerivation,
        ) -> Result<(), CatalogError> {
            if !self.assets.contains(derivation.output())
                || !self.assets.contains(derivation.source())
            {
                return Err(CatalogError::AssetNotFound);
            }
            if self
                .derivations
                .iter()
                .any(|existing| existing.output() == derivation.output())
            {
                return Err(CatalogError::Derivation(
                    ot_domain::InvalidDerivation::ConflictingLineage,
                ));
            }
            let edges: Vec<_> = self
                .derivations
                .iter()
                .map(|existing| ot_domain::DerivationEdge {
                    output: existing.output().clone(),
                    source: existing.source().clone(),
                })
                .collect();
            ot_domain::validate_new_derivation(&edges, derivation)
                .map_err(CatalogError::Derivation)?;
            self.derivations.push(derivation.clone());
            Ok(())
        }

        fn load_asset_derivation(
            &self,
            output: &ContentHash,
        ) -> Result<Option<AssetDerivation>, CatalogError> {
            Ok(self
                .derivations
                .iter()
                .find(|derivation| derivation.output() == output)
                .cloned())
        }

        fn list_derived_children(
            &self,
            source: &ContentHash,
        ) -> Result<Vec<AssetDerivation>, CatalogError> {
            Ok(self
                .derivations
                .iter()
                .filter(|derivation| derivation.source() == source)
                .cloned()
                .collect())
        }

        fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
            Ok(self
                .derivations
                .iter()
                .map(|derivation| (derivation.output().clone(), derivation.source().clone()))
                .collect())
        }
    }

    fn content_hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    #[test]
    fn asset_derivation_use_cases_reject_unknown_assets_and_conflicts() {
        let source = content_hash(1);
        let output = content_hash(2);
        let mut catalog = FakeDerivationCatalog {
            assets: [source.clone(), output.clone()].into_iter().collect(),
            derivations: Vec::new(),
        };
        let derivation = AssetDerivation::new(
            output.clone(),
            source.clone(),
            ot_domain::DerivationKind::Normalize,
            ot_domain::ProcessorIdentity::new("normalize", "1").unwrap(),
            ot_domain::DerivationParameterEnvelope::empty(),
            source.clone(),
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        RegisterAssetDerivation::new(&mut catalog)
            .execute(&derivation)
            .unwrap();
        let loaded = LoadAssetDerivation::new(&catalog)
            .execute(&output)
            .unwrap()
            .unwrap();
        assert_eq!(loaded, derivation);
        let conflict = AssetDerivation::new(
            output.clone(),
            source.clone(),
            ot_domain::DerivationKind::Trim,
            ot_domain::ProcessorIdentity::new("trim", "1").unwrap(),
            ot_domain::DerivationParameterEnvelope::trim(
                ot_domain::slicing::FrameRange::new(
                    ot_domain::slicing::PcmFrame::new(0),
                    ot_domain::slicing::PcmFrame::new(1),
                )
                .unwrap(),
            )
            .unwrap(),
            source.clone(),
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        assert!(matches!(
            RegisterAssetDerivation::new(&mut catalog).execute(&conflict),
            Err(CatalogError::Derivation(
                ot_domain::InvalidDerivation::ConflictingLineage
            ))
        ));
        let unknown_output = content_hash(7);
        catalog.assets.insert(unknown_output.clone());
        let unknown_source = content_hash(8);
        let missing_asset = AssetDerivation::new(
            unknown_output,
            unknown_source,
            ot_domain::DerivationKind::Resample,
            ot_domain::ProcessorIdentity::new("resample", "1").unwrap(),
            ot_domain::DerivationParameterEnvelope::empty(),
            content_hash(8),
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        assert!(matches!(
            RegisterAssetDerivation::new(&mut catalog).execute(&missing_asset),
            Err(CatalogError::AssetNotFound)
        ));
    }

    #[test]
    fn asset_derivation_use_case_rejects_stale_evidence() {
        let source = content_hash(4);
        let output = content_hash(5);
        let stale = AssetDerivation::new(
            output,
            source.clone(),
            ot_domain::DerivationKind::ImportProcess,
            ot_domain::ProcessorIdentity::new("import", "1").unwrap(),
            ot_domain::DerivationParameterEnvelope::empty(),
            content_hash(6),
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap_err();
        assert_eq!(stale, ot_domain::InvalidDerivation::StaleSourceEvidence);
    }
}
