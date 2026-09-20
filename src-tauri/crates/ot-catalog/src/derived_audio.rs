use crate::SqliteCatalog;
use ot_domain::RootRelativePath;
use ot_storage_ports::{
    CatalogError, CatalogRootIdentity, CatalogRootObservation, DerivedAudioCatalog,
    DerivedFileUpsert, LibraryCatalog,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

const DERIVED_ROOT_DISPLAY: &str = "Mac derived audio";

impl SqliteCatalog {
    fn ensure_derived_scan_session(&mut self, root_row_id: i64) -> Result<i64, CatalogError> {
        let existing: Option<i64> = self
            .connection
            .query_row(
                "SELECT scan_sessions.id FROM scan_sessions \
                 JOIN roots ON roots.id = scan_sessions.root_id \
                 WHERE roots.id = ?1 AND scan_sessions.status = 'completed' \
                 ORDER BY scan_sessions.revision DESC LIMIT 1",
                params![root_row_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(unavailable)?;
        if let Some(scan_id) = existing {
            return Ok(scan_id);
        }
        self.connection
            .execute(
                "INSERT INTO scan_sessions (root_id, revision, status, started_at, completed_at) \
                 VALUES (?1, 1, 'completed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![root_row_id],
            )
            .map_err(unavailable)?;
        let scan_id = self.connection.last_insert_rowid();
        self.connection
            .execute(
                "UPDATE roots SET latest_completed_scan_revision = 1 WHERE id = ?1",
                params![root_row_id],
            )
            .map_err(unavailable)?;
        Ok(scan_id)
    }
}

impl DerivedAudioCatalog for SqliteCatalog {
    fn ensure_derived_root(&mut self) -> Result<CatalogRootIdentity, CatalogError> {
        let identity = CatalogRootIdentity::new(ot_domain::MAC_DERIVED_AUDIO_ROOT_FINGERPRINT)
            .map_err(|_| CatalogError::InvalidRootIdentity)?;
        let observation = CatalogRootObservation {
            identity: identity.clone(),
            identity_is_stable: true,
            display_name: DERIVED_ROOT_DISPLAY.into(),
            observed_revision: 1,
        };
        self.observe_root(&observation)?;
        Ok(identity)
    }

    fn upsert_derived_file(&mut self, upsert: &DerivedFileUpsert) -> Result<(), CatalogError> {
        let identity = self.ensure_derived_root()?;
        let root_row_id = self
            .root_row_id(&identity)?
            .ok_or_else(|| CatalogError::Integrity {
                message: "derived root missing after observe".into(),
            })?;
        let scan_id = self.ensure_derived_scan_session(root_row_id)?;
        let relative_path = RootRelativePath::parse(&upsert.relative_path).map_err(|_| {
            CatalogError::Integrity {
                message: "invalid derived relative path".into(),
            }
        })?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        transaction
            .execute(
                "INSERT INTO audio_assets (content_hash, byte_size) VALUES (?1, ?2) \
                 ON CONFLICT(content_hash) DO NOTHING",
                params![upsert.content_hash.as_str(), upsert.byte_size as i64],
            )
            .map_err(unavailable)?;
        let (audio_asset_id, stored_size): (i64, i64) = transaction
            .query_row(
                "SELECT id, byte_size FROM audio_assets WHERE content_hash = ?1",
                params![upsert.content_hash.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(unavailable)?;
        if stored_size != upsert.byte_size as i64 {
            return Err(CatalogError::Integrity {
                message: "derived content hash byte size mismatch".into(),
            });
        }
        transaction
            .execute(
                "INSERT INTO file_instances \
                 (root_id, scan_session_id, relative_path, audio_asset_id, byte_size, \
                  modified_at_unix_ns, storage_scope, hash_freshness) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
                 ON CONFLICT(root_id, relative_path) DO UPDATE SET \
                    scan_session_id = excluded.scan_session_id, \
                    audio_asset_id = excluded.audio_asset_id, \
                    byte_size = excluded.byte_size, \
                    modified_at_unix_ns = excluded.modified_at_unix_ns, \
                    storage_scope = excluded.storage_scope, \
                    hash_freshness = excluded.hash_freshness",
                params![
                    root_row_id,
                    scan_id,
                    relative_path.as_str(),
                    audio_asset_id,
                    upsert.byte_size as i64,
                    upsert.modified_at_unix_ns,
                    "mac_derived",
                    "computed_this_scan",
                ],
            )
            .map_err(unavailable)?;
        transaction.commit().map_err(unavailable)?;
        Ok(())
    }
}

fn unavailable(error: rusqlite::Error) -> CatalogError {
    CatalogError::Unavailable {
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SqliteCatalog;
    use ot_domain::{ContentHash, SampleStorageScope};
    use ot_storage_ports::LibraryCatalog;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn hash(label: u8) -> ContentHash {
        ContentHash::parse(format!("sha256:{label:064x}")).unwrap()
    }

    fn database_path(directory: &TempDir) -> PathBuf {
        directory
            .path()
            .canonicalize()
            .unwrap()
            .join("derived.sqlite3")
    }

    #[test]
    fn upsert_derived_file_creates_mac_derived_instance() {
        let directory = TempDir::new().unwrap();
        let mut catalog = SqliteCatalog::open(database_path(&directory)).unwrap();
        let asset = hash(9);
        catalog
            .upsert_derived_file(&DerivedFileUpsert {
                content_hash: asset.clone(),
                byte_size: 128,
                relative_path: "v1/0900000000000000000000000000000000000000000000000000000000000000.wav"
                    .into(),
                modified_at_unix_ns: Some(1),
            })
            .unwrap();
        let identity = catalog.ensure_derived_root().unwrap();
        let snapshot = catalog.load_latest_snapshot(&identity).unwrap().unwrap();
        assert_eq!(snapshot.file_instances.len(), 1);
        assert_eq!(
            snapshot.file_instances[0].storage_scope,
            SampleStorageScope::MacDerived
        );
        assert_eq!(snapshot.file_instances[0].content_hash, asset);
    }
}
