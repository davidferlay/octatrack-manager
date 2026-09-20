use crate::SqliteCatalog;
use ot_domain::{
    validate_new_derivation, AssetDerivation, ContentHash, DerivationEdge, DerivationKind,
    DerivationParameterEnvelope, InvalidDerivation, ProcessorIdentity,
};
use ot_storage_ports::{AssetDerivationCatalog, CatalogError};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

fn unavailable(error: rusqlite::Error) -> CatalogError {
    CatalogError::Unavailable {
        message: error.to_string(),
    }
}

struct StoredDerivationRow {
    output_hash: ContentHash,
    source_hash: ContentHash,
    kind: String,
    processor_name: String,
    processor_revision: String,
    parameters_envelope: String,
    source_hash_evidence: String,
    created_at: String,
}

impl StoredDerivationRow {
    fn into_derivation(self) -> Result<AssetDerivation, CatalogError> {
        let kind = DerivationKind::parse_token(&self.kind).map_err(CatalogError::Derivation)?;
        let processor = ProcessorIdentity::new(self.processor_name, self.processor_revision)
            .map_err(CatalogError::Derivation)?;
        let parameters = DerivationParameterEnvelope::decode(&self.parameters_envelope)
            .map_err(CatalogError::Derivation)?;
        let evidence = ContentHash::parse(self.source_hash_evidence).map_err(|_| {
            CatalogError::InvalidStoredData {
                field: "derivation_source_hash_evidence",
            }
        })?;
        AssetDerivation::new(
            self.output_hash,
            self.source_hash,
            kind,
            processor,
            parameters,
            evidence,
            self.created_at,
        )
        .map_err(CatalogError::Derivation)
    }
}

fn lineage_semantically_equal(left: &AssetDerivation, right: &AssetDerivation) -> bool {
    left.output() == right.output()
        && left.source() == right.source()
        && left.kind() == right.kind()
        && left.processor() == right.processor()
        && left.parameters() == right.parameters()
        && left.source_hash_evidence() == right.source_hash_evidence()
}

impl SqliteCatalog {
    fn audio_asset_row_id(
        connection: &rusqlite::Connection,
        asset: &ContentHash,
    ) -> Result<i64, CatalogError> {
        connection
            .query_row(
                "SELECT id FROM audio_assets WHERE content_hash = ?1",
                params![asset.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(unavailable)?
            .ok_or(CatalogError::AssetNotFound)
    }

    fn load_derivation_edges(&self) -> Result<Vec<DerivationEdge>, CatalogError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT output.content_hash, source.content_hash \
                 FROM asset_derivations \
                 JOIN audio_assets AS output ON output.id = asset_derivations.output_audio_asset_id \
                 JOIN audio_assets AS source ON source.id = asset_derivations.source_audio_asset_id",
            )
            .map_err(unavailable)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(unavailable)?;
        let mut edges = Vec::new();
        for row in rows {
            let (output, source) = row.map_err(unavailable)?;
            let output =
                ContentHash::parse(output).map_err(|_| CatalogError::InvalidStoredData {
                    field: "derivation_output_hash",
                })?;
            let source =
                ContentHash::parse(source).map_err(|_| CatalogError::InvalidStoredData {
                    field: "derivation_source_hash",
                })?;
            edges.push(DerivationEdge { output, source });
        }
        Ok(edges)
    }
}

impl AssetDerivationCatalog for SqliteCatalog {
    fn register_asset_derivation(
        &mut self,
        derivation: &AssetDerivation,
    ) -> Result<(), CatalogError> {
        if let Some(existing) = self.load_asset_derivation(derivation.output())? {
            if lineage_semantically_equal(&existing, derivation) {
                return Ok(());
            }
            return Err(CatalogError::Derivation(
                InvalidDerivation::ConflictingLineage,
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let output_row_id = Self::audio_asset_row_id(&transaction, derivation.output())?;
        let source_row_id = Self::audio_asset_row_id(&transaction, derivation.source())?;
        let existing = {
            let mut statement = transaction
                .prepare(
                    "SELECT output.content_hash, source.content_hash \
                     FROM asset_derivations \
                     JOIN audio_assets AS output \
                       ON output.id = asset_derivations.output_audio_asset_id \
                     JOIN audio_assets AS source \
                       ON source.id = asset_derivations.source_audio_asset_id",
                )
                .map_err(unavailable)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(unavailable)?;
            let mut edges = Vec::new();
            for row in rows {
                let (output, source) = row.map_err(unavailable)?;
                let output =
                    ContentHash::parse(output).map_err(|_| CatalogError::InvalidStoredData {
                        field: "derivation_output_hash",
                    })?;
                let source =
                    ContentHash::parse(source).map_err(|_| CatalogError::InvalidStoredData {
                        field: "derivation_source_hash",
                    })?;
                edges.push(DerivationEdge { output, source });
            }
            edges
        };
        validate_new_derivation(&existing, derivation).map_err(CatalogError::Derivation)?;
        transaction
            .execute(
                "INSERT INTO asset_derivations \
                 (output_audio_asset_id, source_audio_asset_id, kind, processor_name, \
                  processor_revision, parameters_envelope, source_hash_evidence, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    output_row_id,
                    source_row_id,
                    derivation.kind().token(),
                    derivation.processor().name(),
                    derivation.processor().revision(),
                    derivation.parameters().encode(),
                    derivation.source_hash_evidence().as_str(),
                    derivation.created_at(),
                ],
            )
            .map_err(|error| {
                if error.to_string().contains("derivation cycle") {
                    CatalogError::Derivation(InvalidDerivation::Cycle)
                } else if error.to_string().contains("UNIQUE constraint failed") {
                    CatalogError::Derivation(InvalidDerivation::ConflictingLineage)
                } else {
                    unavailable(error)
                }
            })?;
        transaction.commit().map_err(unavailable)
    }

    fn load_asset_derivation(
        &self,
        output: &ContentHash,
    ) -> Result<Option<AssetDerivation>, CatalogError> {
        let row = self
            .connection
            .query_row(
                "SELECT source.content_hash, asset_derivations.kind, \
                        asset_derivations.processor_name, asset_derivations.processor_revision, \
                        asset_derivations.parameters_envelope, \
                        asset_derivations.source_hash_evidence, asset_derivations.created_at \
                 FROM asset_derivations \
                 JOIN audio_assets AS output \
                   ON output.id = asset_derivations.output_audio_asset_id \
                 JOIN audio_assets AS source \
                   ON source.id = asset_derivations.source_audio_asset_id \
                 WHERE output.content_hash = ?1",
                params![output.as_str()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .optional()
            .map_err(unavailable)?;
        let Some((
            source_hash,
            kind,
            processor_name,
            processor_revision,
            parameters_envelope,
            source_hash_evidence,
            created_at,
        )) = row
        else {
            return Ok(None);
        };
        let output_hash = output.clone();
        let source_hash =
            ContentHash::parse(source_hash).map_err(|_| CatalogError::InvalidStoredData {
                field: "derivation_source_hash",
            })?;
        Ok(Some(
            StoredDerivationRow {
                output_hash,
                source_hash,
                kind,
                processor_name,
                processor_revision,
                parameters_envelope,
                source_hash_evidence,
                created_at,
            }
            .into_derivation()?,
        ))
    }

    fn list_derived_children(
        &self,
        source: &ContentHash,
    ) -> Result<Vec<AssetDerivation>, CatalogError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT output.content_hash, source.content_hash, asset_derivations.kind, \
                        asset_derivations.processor_name, asset_derivations.processor_revision, \
                        asset_derivations.parameters_envelope, \
                        asset_derivations.source_hash_evidence, asset_derivations.created_at \
                 FROM asset_derivations \
                 JOIN audio_assets AS output \
                   ON output.id = asset_derivations.output_audio_asset_id \
                 JOIN audio_assets AS source \
                   ON source.id = asset_derivations.source_audio_asset_id \
                 WHERE source.content_hash = ?1 \
                 ORDER BY output.content_hash COLLATE BINARY",
            )
            .map_err(unavailable)?;
        let rows = statement
            .query_map(params![source.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(unavailable)?;
        let mut children = Vec::new();
        for row in rows {
            let (
                output_hash,
                source_hash,
                kind,
                processor_name,
                processor_revision,
                parameters_envelope,
                source_hash_evidence,
                created_at,
            ) = row.map_err(unavailable)?;
            let output_hash =
                ContentHash::parse(output_hash).map_err(|_| CatalogError::InvalidStoredData {
                    field: "derivation_output_hash",
                })?;
            let source_hash =
                ContentHash::parse(source_hash).map_err(|_| CatalogError::InvalidStoredData {
                    field: "derivation_source_hash",
                })?;
            children.push(
                StoredDerivationRow {
                    output_hash,
                    source_hash,
                    kind,
                    processor_name,
                    processor_revision,
                    parameters_envelope,
                    source_hash_evidence,
                    created_at,
                }
                .into_derivation()?,
            );
        }
        Ok(children)
    }

    fn list_derivation_edges(&self) -> Result<Vec<(ContentHash, ContentHash)>, CatalogError> {
        Ok(self
            .load_derivation_edges()?
            .into_iter()
            .map(|edge| (edge.output, edge.source))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SqliteCatalog;
    use ot_domain::{DerivationKind, DerivationParameterEnvelope, StemRole};
    use ot_storage_ports::LibraryCatalog;
    use rusqlite::Connection;
    use std::path::PathBuf;
    use tempfile::TempDir;

    const ROOT_FINGERPRINT: &str =
        "rootfp:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    fn database_path(directory: &TempDir, name: &str) -> PathBuf {
        directory.path().canonicalize().unwrap().join(name)
    }

    fn insert_asset(connection: &Connection, asset: &ContentHash, byte_size: i64) {
        connection
            .execute(
                "INSERT INTO audio_assets (content_hash, byte_size) VALUES (?1, ?2)",
                params![asset.as_str(), byte_size],
            )
            .unwrap();
    }

    fn open_catalog_with_assets(assets: &[(&ContentHash, i64)]) -> (TempDir, SqliteCatalog) {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "derivations.sqlite3");
        let catalog = SqliteCatalog::open(&path).unwrap();
        for (asset, size) in assets {
            insert_asset(&catalog.connection, asset, *size);
        }
        (directory, catalog)
    }

    fn sample_derivation(
        output: ContentHash,
        source: ContentHash,
        kind: DerivationKind,
    ) -> AssetDerivation {
        use ot_domain::slicing::{FrameRange, PcmFrame};
        let parameters = match kind {
            DerivationKind::Trim => DerivationParameterEnvelope::trim(
                FrameRange::new(PcmFrame::new(0), PcmFrame::new(1)).unwrap(),
            )
            .unwrap(),
            DerivationKind::Stem => DerivationParameterEnvelope::stem(StemRole::Kick),
            _ => DerivationParameterEnvelope::empty(),
        };
        AssetDerivation::new(
            output,
            source.clone(),
            kind,
            ProcessorIdentity::new("processor", "1").unwrap(),
            parameters,
            source,
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap()
    }

    #[test]
    fn lineage_round_trips_and_survives_reopen() {
        let source = hash(1);
        let output = hash(2);
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "persist.sqlite3");
        {
            let mut catalog = SqliteCatalog::open(&path).unwrap();
            insert_asset(&catalog.connection, &source, 100);
            insert_asset(&catalog.connection, &output, 80);
            let derivation =
                sample_derivation(output.clone(), source.clone(), DerivationKind::Trim);
            catalog.register_asset_derivation(&derivation).unwrap();
            let loaded = catalog.load_asset_derivation(&output).unwrap().unwrap();
            assert_eq!(loaded, derivation);
            let children = catalog.list_derived_children(&source).unwrap();
            assert_eq!(children.len(), 1);
            assert_eq!(children[0].output(), &output);
        }
        let reopened = SqliteCatalog::open(&path).unwrap();
        assert!(reopened.load_asset_derivation(&output).unwrap().is_some());
    }

    #[test]
    fn rescan_does_not_delete_registered_lineage() {
        let source = hash(10);
        let output = hash(11);
        let (directory, mut catalog) = open_catalog_with_assets(&[(&source, 100), (&output, 90)]);
        let derivation =
            sample_derivation(output.clone(), source.clone(), DerivationKind::Normalize);
        catalog.register_asset_derivation(&derivation).unwrap();

        let observation = ot_storage_ports::CatalogRootObservation {
            identity: ot_storage_ports::CatalogRootIdentity::new(ROOT_FINGERPRINT).unwrap(),
            identity_is_stable: true,
            display_name: "Fixture".into(),
            observed_revision: 1,
        };
        catalog
            .store_snapshot(&observation, &ot_domain::LibrarySnapshot::default())
            .unwrap();

        assert!(catalog.load_asset_derivation(&output).unwrap().is_some());
        drop(catalog);
        drop(directory);
    }

    #[test]
    fn transaction_rollback_leaves_no_partial_lineage() {
        let source = hash(20);
        let output = hash(21);
        let (_directory, mut catalog) = open_catalog_with_assets(&[(&source, 100), (&output, 90)]);
        let valid = sample_derivation(output.clone(), source.clone(), DerivationKind::Resample);
        catalog.register_asset_derivation(&valid).unwrap();
        let alternate_source = hash(22);
        insert_asset(&catalog.connection, &alternate_source, 70);
        let conflict = sample_derivation(output, alternate_source, DerivationKind::ImportProcess);
        assert!(matches!(
            catalog.register_asset_derivation(&conflict),
            Err(CatalogError::Derivation(
                InvalidDerivation::ConflictingLineage
            ))
        ));
        assert_eq!(catalog.list_derivation_edges().unwrap().len(), 1);
    }

    #[test]
    fn rejects_unknown_assets_and_cycles() {
        let source = hash(30);
        let output = hash(31);
        let middle = hash(32);
        let (_directory, mut catalog) =
            open_catalog_with_assets(&[(&source, 100), (&output, 90), (&middle, 80)]);
        catalog
            .register_asset_derivation(&sample_derivation(
                middle.clone(),
                source.clone(),
                DerivationKind::SampleChain,
            ))
            .unwrap();
        catalog
            .register_asset_derivation(&sample_derivation(
                output.clone(),
                middle.clone(),
                DerivationKind::SampleChain,
            ))
            .unwrap();
        let cycle = sample_derivation(source.clone(), output.clone(), DerivationKind::Stem);
        assert!(matches!(
            catalog.register_asset_derivation(&cycle),
            Err(CatalogError::Derivation(InvalidDerivation::Cycle))
        ));
        let missing = sample_derivation(hash(99), source, DerivationKind::Trim);
        assert!(matches!(
            catalog.register_asset_derivation(&missing),
            Err(CatalogError::AssetNotFound)
        ));
    }

    #[test]
    fn stem_role_persists_through_catalog() {
        let source = hash(40);
        let output = hash(41);
        let (_directory, mut catalog) = open_catalog_with_assets(&[(&source, 100), (&output, 90)]);
        let derivation = AssetDerivation::new(
            output.clone(),
            source.clone(),
            DerivationKind::Stem,
            ProcessorIdentity::new("stem", "1").unwrap(),
            DerivationParameterEnvelope::stem(StemRole::Kick),
            source,
            "2026-09-20T00:00:00.000Z",
        )
        .unwrap();
        catalog.register_asset_derivation(&derivation).unwrap();
        let loaded = catalog.load_asset_derivation(&output).unwrap().unwrap();
        assert_eq!(loaded.parameters().encode(), "v1|kind=stem|role=KICK");
    }
}
