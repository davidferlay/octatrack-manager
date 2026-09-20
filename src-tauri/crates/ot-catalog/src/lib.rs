#![forbid(unsafe_code)]

mod asset_derivations;
mod derived_audio;
mod slice_drafts;

use ot_domain::{
    AudioAsset, ContentHash, ContentHashFreshness, FileInstance, LibraryProject, LibrarySet,
    LibrarySnapshot, ManualAssetMetadata, ManualNote, ManualTag, ParserProvenance,
    ProjectCompatibilityEvidence, RootRelativePath, SampleReferenceStatus, SampleSettings,
    SampleSettingsEvidence, SampleSettingsOwner, SampleSettingsParseStatus, SampleSlice,
    SampleSlotId, SampleSlotKind, SampleStorageScope, SampleUsageEdge, SampleUsageKind,
    SlotAssignment, StateDocument, StateDocumentKind, StateDocumentParseStatus, StateDocumentRole,
};
use ot_storage_ports::{
    AssetMetadataCatalog, CatalogError, CatalogFailureCode, CatalogRootIdentity,
    CatalogRootObservation, CatalogScan, CatalogScanId, CatalogScanRevision, CatalogScanStatus,
    LibraryCatalog,
};
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

const LATEST_SCHEMA_VERSION: u64 = 13;
const PROJECTION_REPAIR_META_KEY: &str = "observational_projection_repair_applied";
const MIGRATION_REQUIRES_FOREIGN_KEYS_OFF: u64 = 8;
const MIGRATIONS: &[(u64, &str)] = &[
    // Entries are applied in ascending version order.
    (1, include_str!("../migrations/0001_catalog_foundation.sql")),
    (2, include_str!("../migrations/0002_file_inventory.sql")),
    (
        3,
        include_str!("../migrations/0003_project_usage_graph.sql"),
    ),
    (
        4,
        include_str!("../migrations/0004_sample_settings_slices.sql"),
    ),
    (
        5,
        include_str!("../migrations/0005_manual_asset_metadata.sql"),
    ),
    (
        6,
        include_str!("../migrations/0006_project_compatibility_evidence.sql"),
    ),
    (7, include_str!("../migrations/0007_slice_drafts.sql")),
    (
        8,
        include_str!("../migrations/0008_reference_ambiguous.sql"),
    ),
    (
        9,
        include_str!("../migrations/0009_has_saved_checkpoint.sql"),
    ),
    (
        10,
        include_str!("../migrations/0010_observational_projection_trust.sql"),
    ),
    (
        11,
        include_str!("../migrations/0011_projection_trust_repair.sql"),
    ),
    (12, include_str!("../migrations/0012_asset_derivations.sql")),
    (
        13,
        include_str!("../migrations/0013_mac_derived_storage_scope.sql"),
    ),
];

type StateProjection = (
    Vec<StateDocument>,
    Vec<SlotAssignment>,
    Vec<SampleUsageEdge>,
);

pub struct SqliteCatalog {
    connection: Connection,
}

impl SqliteCatalog {
    /// Opens a database through a path whose existing parent components have
    /// already been resolved and validated by the caller.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CatalogError> {
        let flags = OpenFlags::default() | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        let mut connection = Connection::open_with_flags(path, flags).map_err(unavailable)?;
        configure_connection(&connection)?;
        migrate(&mut connection)?;
        Ok(Self { connection })
    }

    /// Returns whether the catalog's observational projection may have been
    /// damaged by a pre-remediation schema migration and still requires rescan.
    pub fn observational_projection_untrusted(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<bool, CatalogError> {
        let Some(root_row_id) = self.root_row_id(identity)? else {
            return Ok(false);
        };
        let untrusted: i64 = self
            .connection
            .query_row(
                "SELECT observational_projection_untrusted FROM roots WHERE id = ?1",
                params![root_row_id],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        Ok(untrusted != 0)
    }

    /// Marks one root's observational projection untrusted until the next successful rescan.
    pub fn mark_observational_projection_untrusted(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<(), CatalogError> {
        let Some(root_row_id) = self.root_row_id(identity)? else {
            return Ok(());
        };
        self.connection
            .execute(
                "UPDATE roots SET observational_projection_untrusted = 1 WHERE id = ?1",
                params![root_row_id],
            )
            .map_err(unavailable)?;
        Ok(())
    }

    fn root_row_id(&self, identity: &CatalogRootIdentity) -> Result<Option<i64>, CatalogError> {
        self.connection
            .query_row(
                "SELECT id FROM roots WHERE fingerprint = ?1",
                params![identity.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(unavailable)
    }

    fn begin_scan(&self, root_row_id: i64) -> Result<CatalogScan, CatalogError> {
        let next_revision: i64 = self
            .connection
            .query_row(
                "SELECT COALESCE(MAX(revision), 0) + 1 FROM scan_sessions WHERE root_id = ?1",
                params![root_row_id],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        self.connection
            .execute(
                "INSERT INTO scan_sessions \
                 (root_id, revision, status, started_at) \
                 VALUES (?1, ?2, 'running', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![root_row_id, next_revision],
            )
            .map_err(unavailable)?;
        scan_from_database(
            self.connection.last_insert_rowid(),
            next_revision,
            "running",
            None,
        )
    }

    fn mark_failed(
        &self,
        scan_id: CatalogScanId,
        failure_code: CatalogFailureCode,
    ) -> Result<(), CatalogError> {
        self.connection
            .execute(
                "UPDATE scan_sessions \
                 SET status = 'failed', \
                     completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                     failure_code = ?1 \
                 WHERE id = ?2 AND status = 'running'",
                params![
                    failure_code_to_database(failure_code),
                    scan_id_to_i64(scan_id)?
                ],
            )
            .map_err(unavailable)?;
        Ok(())
    }

    fn replace_projection(
        &mut self,
        root_row_id: i64,
        scan: &CatalogScan,
        snapshot: &LibrarySnapshot,
    ) -> Result<(), rusqlite::Error> {
        self.connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "DELETE FROM usage_edges WHERE state_document_id IN (\
                SELECT id FROM state_documents WHERE root_id = ?1\
            )",
            [root_row_id],
        )?;
        transaction.execute(
            "DELETE FROM slot_assignments WHERE state_document_id IN (\
                SELECT id FROM state_documents WHERE root_id = ?1\
            )",
            [root_row_id],
        )?;
        transaction.execute(
            "DELETE FROM state_documents WHERE root_id = ?1",
            [root_row_id],
        )?;
        transaction.execute("DELETE FROM projects WHERE root_id = ?1", [root_row_id])?;
        transaction.execute("DELETE FROM sets WHERE root_id = ?1", [root_row_id])?;

        let scan_id = i64::try_from(scan.id.get())
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;

        for (set_order, set) in snapshot.sets.iter().enumerate() {
            transaction.execute(
                "INSERT INTO sets \
                 (root_id, scan_session_id, relative_path, display_name, has_audio_pool, sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    root_row_id,
                    scan_id,
                    set.relative_path.as_str(),
                    set.display_name,
                    set.has_audio_pool,
                    set_order as i64,
                ],
            )?;
            for (project_order, project) in set.projects.iter().enumerate() {
                insert_project(
                    &transaction,
                    root_row_id,
                    scan_id,
                    project,
                    Some(set.relative_path.as_str()),
                    project_order,
                )?;
            }
        }
        for (project_order, project) in snapshot.standalone_projects.iter().enumerate() {
            insert_project(
                &transaction,
                root_row_id,
                scan_id,
                project,
                None,
                project_order,
            )?;
        }

        for asset in &snapshot.audio_assets {
            transaction.execute(
                "INSERT INTO audio_assets (content_hash, byte_size) VALUES (?1, ?2) \
                 ON CONFLICT(content_hash) DO NOTHING",
                params![
                    asset.content_hash.as_str(),
                    byte_size_to_i64(asset.byte_size)?
                ],
            )?;
        }
        for instance in &snapshot.file_instances {
            let (audio_asset_id, stored_size): (i64, i64) = transaction.query_row(
                "SELECT id, byte_size FROM audio_assets WHERE content_hash = ?1",
                params![instance.content_hash.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let byte_size = byte_size_to_i64(instance.byte_size)?;
            if stored_size != byte_size {
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "content hash resolved to a different byte size",
                    ),
                )));
            }
            transaction.execute(
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
                    instance.relative_path.as_str(),
                    audio_asset_id,
                    byte_size,
                    instance.modified_at_unix_ns,
                    storage_scope_to_database(instance.storage_scope),
                    freshness_to_database(instance.hash_freshness),
                ],
            )?;
        }
        transaction.execute(
            "DELETE FROM file_instances WHERE root_id = ?1 AND scan_session_id <> ?2",
            params![root_row_id, scan_id],
        )?;
        transaction.execute(
            "DELETE FROM audio_assets WHERE NOT EXISTS (\
                 SELECT 1 FROM file_instances WHERE file_instances.audio_asset_id = audio_assets.id\
             ) AND NOT EXISTS (\
                 SELECT 1 FROM tag_assignments WHERE tag_assignments.audio_asset_id = audio_assets.id\
             ) AND NOT EXISTS (\
                 SELECT 1 FROM notes WHERE notes.audio_asset_id = audio_assets.id\
             ) AND NOT EXISTS (\
                 SELECT 1 FROM asset_derivations \
                 WHERE asset_derivations.output_audio_asset_id = audio_assets.id \
                    OR asset_derivations.source_audio_asset_id = audio_assets.id\
             )",
            [],
        )?;

        insert_state_projection(&transaction, root_row_id, scan_id, snapshot)?;
        transaction.execute(
            "DELETE FROM sample_settings WHERE root_id = ?1",
            [root_row_id],
        )?;
        insert_sample_settings(&transaction, root_row_id, scan_id, snapshot)?;

        transaction.execute(
            "UPDATE scan_sessions \
             SET status = 'completed', \
                 completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                 failure_code = NULL \
             WHERE id = ?1 AND status = 'running'",
            params![scan_id],
        )?;
        transaction.execute(
            "UPDATE roots SET latest_completed_scan_revision = ?1 WHERE id = ?2",
            params![scan_revision_to_i64(scan.revision)?, root_row_id],
        )?;
        transaction.execute(
            "UPDATE roots SET observational_projection_untrusted = 0 WHERE id = ?1",
            params![root_row_id],
        )?;
        transaction.commit()
    }
}

impl LibraryCatalog for SqliteCatalog {
    fn observe_root(&mut self, observation: &CatalogRootObservation) -> Result<(), CatalogError> {
        self.connection
            .execute(
                "INSERT INTO roots \
                 (fingerprint, identity_is_stable, display_name, last_observed_revision, last_observed_at) \
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
                 ON CONFLICT(fingerprint) DO UPDATE SET \
                     identity_is_stable = excluded.identity_is_stable, \
                     display_name = excluded.display_name, \
                     last_observed_revision = excluded.last_observed_revision, \
                     last_observed_at = excluded.last_observed_at",
                params![
                    observation.identity.as_str(),
                    observation.identity_is_stable,
                    observation.display_name,
                    i64::try_from(observation.observed_revision).map_err(|_| {
                        CatalogError::Integrity {
                            message: "observed revision exceeds SQLite INTEGER range".into(),
                        }
                    })?,
                ],
            )
            .map_err(unavailable)?;
        Ok(())
    }

    fn store_snapshot(
        &mut self,
        observation: &CatalogRootObservation,
        snapshot: &LibrarySnapshot,
    ) -> Result<CatalogScan, CatalogError> {
        self.observe_root(observation)?;
        let root_row_id =
            self.root_row_id(&observation.identity)?
                .ok_or_else(|| CatalogError::Integrity {
                    message: "observed root was not persisted".into(),
                })?;
        let mut scan = self.begin_scan(root_row_id)?;

        if let Err(error) = validate_snapshot(snapshot) {
            self.mark_failed(scan.id, CatalogFailureCode::SnapshotValidation)?;
            return Err(error);
        }

        if let Err(error) = self.replace_projection(root_row_id, &scan, snapshot) {
            self.mark_failed(scan.id, CatalogFailureCode::Persistence)?;
            return Err(unavailable(error));
        }

        scan.status = CatalogScanStatus::Completed;
        Ok(scan)
    }

    fn load_latest_snapshot(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<Option<LibrarySnapshot>, CatalogError> {
        let latest: Option<(i64, Option<i64>)> = self
            .connection
            .query_row(
                "SELECT id, latest_completed_scan_revision \
                 FROM roots WHERE fingerprint = ?1",
                params![identity.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(unavailable)?;
        let Some((root_row_id, Some(revision))) = latest else {
            return Ok(None);
        };
        let scan_id: i64 = self
            .connection
            .query_row(
                "SELECT id FROM scan_sessions \
                 WHERE root_id = ?1 AND revision = ?2 AND status = 'completed'",
                params![root_row_id, revision],
                |row| row.get(0),
            )
            .map_err(unavailable)?;

        let sets = self.load_sets(root_row_id, scan_id)?;
        let standalone_projects = self.load_projects(root_row_id, scan_id, None)?;
        let (audio_assets, file_instances) = self.load_file_inventory(root_row_id, scan_id)?;
        let (state_documents, slot_assignments, usage_edges) =
            self.load_state_inventory(root_row_id, scan_id)?;
        let sample_settings = self.load_sample_settings(root_row_id, scan_id)?;
        let snapshot = LibrarySnapshot {
            sets,
            standalone_projects,
            audio_assets,
            file_instances,
            state_documents,
            slot_assignments,
            usage_edges,
            sample_settings,
        };
        validate_snapshot(&snapshot)?;
        Ok(Some(snapshot))
    }

    fn latest_scan(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<Option<CatalogScan>, CatalogError> {
        self.connection
            .query_row(
                "SELECT scan_sessions.id, scan_sessions.revision, scan_sessions.status, \
                        scan_sessions.failure_code \
                 FROM scan_sessions \
                 JOIN roots ON roots.id = scan_sessions.root_id \
                 WHERE roots.fingerprint = ?1 \
                 ORDER BY scan_sessions.revision DESC LIMIT 1",
                params![identity.as_str()],
                |row| {
                    let id: i64 = row.get(0)?;
                    let revision: i64 = row.get(1)?;
                    let status: String = row.get(2)?;
                    let failure_code: Option<String> = row.get(3)?;
                    Ok((id, revision, status, failure_code))
                },
            )
            .optional()
            .map_err(unavailable)?
            .map(|(id, revision, status, failure_code)| {
                scan_from_database(id, revision, &status, failure_code.as_deref())
            })
            .transpose()
    }
}

impl AssetMetadataCatalog for SqliteCatalog {
    fn load_manual_asset_metadata(
        &self,
        asset: &ContentHash,
    ) -> Result<ManualAssetMetadata, CatalogError> {
        let asset_row_id = self
            .connection
            .query_row(
                "SELECT id FROM audio_assets WHERE content_hash = ?1",
                params![asset.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(unavailable)?
            .ok_or(CatalogError::AssetNotFound)?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT tags.name FROM tags \
                 JOIN tag_assignments ON tag_assignments.tag_id = tags.id \
                 WHERE tag_assignments.audio_asset_id = ?1 \
                   AND tag_assignments.source = 'user' \
                 ORDER BY tags.name COLLATE BINARY",
            )
            .map_err(unavailable)?;
        let rows = statement
            .query_map([asset_row_id], |row| row.get::<_, String>(0))
            .map_err(unavailable)?;
        let mut tags = Vec::new();
        for row in rows {
            let value = row.map_err(unavailable)?;
            let tag = ManualTag::parse(&value).map_err(|_| CatalogError::InvalidStoredData {
                field: "manual_tag",
            })?;
            if tag.as_str() != value {
                return Err(CatalogError::InvalidStoredData {
                    field: "manual_tag",
                });
            }
            tags.push(tag);
        }
        let note = self
            .connection
            .query_row(
                "SELECT body FROM notes WHERE audio_asset_id = ?1 AND source = 'user'",
                [asset_row_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(unavailable)?
            .map(ManualNote::parse)
            .transpose()
            .map_err(|_| CatalogError::InvalidStoredData {
                field: "manual_note",
            })?;
        ManualAssetMetadata::new(tags, note).map_err(|_| CatalogError::InvalidStoredData {
            field: "manual_asset_metadata",
        })
    }

    fn replace_manual_asset_metadata(
        &mut self,
        asset: &ContentHash,
        metadata: &ManualAssetMetadata,
    ) -> Result<(), CatalogError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let asset_row_id = transaction
            .query_row(
                "SELECT id FROM audio_assets WHERE content_hash = ?1",
                params![asset.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(unavailable)?
            .ok_or(CatalogError::AssetNotFound)?;

        transaction
            .execute(
                "DELETE FROM tag_assignments WHERE audio_asset_id = ?1 AND source = 'user'",
                [asset_row_id],
            )
            .map_err(unavailable)?;
        for tag in metadata.tags() {
            transaction
                .execute(
                    "INSERT INTO tags (name, created_at) \
                     VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
                     ON CONFLICT(name) DO NOTHING",
                    params![tag.as_str()],
                )
                .map_err(unavailable)?;
            transaction
                .execute(
                    "INSERT INTO tag_assignments \
                     (audio_asset_id, tag_id, source, assigned_at) \
                     SELECT ?1, id, 'user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
                     FROM tags WHERE name = ?2",
                    params![asset_row_id, tag.as_str()],
                )
                .map_err(unavailable)?;
        }

        match metadata.note() {
            Some(note) => {
                transaction
                    .execute(
                        "INSERT INTO notes \
                         (audio_asset_id, body, source, created_at, updated_at) \
                         VALUES (?1, ?2, 'user', \
                                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
                         ON CONFLICT(audio_asset_id, source) DO UPDATE SET \
                           body = excluded.body, source = 'user', \
                           updated_at = excluded.updated_at",
                        params![asset_row_id, note.as_str()],
                    )
                    .map_err(unavailable)?;
            }
            None => {
                transaction
                    .execute(
                        "DELETE FROM notes WHERE audio_asset_id = ?1 AND source = 'user'",
                        [asset_row_id],
                    )
                    .map_err(unavailable)?;
            }
        }
        transaction
            .execute(
                "DELETE FROM tags WHERE NOT EXISTS (\
                     SELECT 1 FROM tag_assignments WHERE tag_assignments.tag_id = tags.id\
                 )",
                [],
            )
            .map_err(unavailable)?;
        transaction
            .execute(
                "DELETE FROM audio_assets WHERE id = ?1 AND NOT EXISTS (\
                     SELECT 1 FROM file_instances WHERE file_instances.audio_asset_id = audio_assets.id\
                 ) AND NOT EXISTS (\
                     SELECT 1 FROM tag_assignments WHERE tag_assignments.audio_asset_id = audio_assets.id\
                 ) AND NOT EXISTS (\
                     SELECT 1 FROM notes WHERE notes.audio_asset_id = audio_assets.id\
                 ) AND NOT EXISTS (\
                     SELECT 1 FROM asset_derivations \
                     WHERE asset_derivations.output_audio_asset_id = audio_assets.id \
                        OR asset_derivations.source_audio_asset_id = audio_assets.id\
                 )",
                [asset_row_id],
            )
            .map_err(unavailable)?;
        transaction.commit().map_err(unavailable)
    }
}

impl SqliteCatalog {
    fn load_sets(&self, root_row_id: i64, scan_id: i64) -> Result<Vec<LibrarySet>, CatalogError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT relative_path, display_name, has_audio_pool \
                 FROM sets WHERE root_id = ?1 AND scan_session_id = ?2 \
                 ORDER BY sort_order",
            )
            .map_err(unavailable)?;
        let rows = statement
            .query_map(params![root_row_id, scan_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            })
            .map_err(unavailable)?;
        let mut sets = Vec::new();
        for row in rows {
            let (relative_path, display_name, has_audio_pool) = row.map_err(unavailable)?;
            let relative_path = stored_path(relative_path)?;
            let projects =
                self.load_projects(root_row_id, scan_id, Some(relative_path.as_str()))?;
            sets.push(LibrarySet {
                display_name,
                relative_path,
                has_audio_pool,
                projects,
            });
        }
        Ok(sets)
    }

    fn load_projects(
        &self,
        root_row_id: i64,
        scan_id: i64,
        parent_set: Option<&str>,
    ) -> Result<Vec<LibraryProject>, CatalogError> {
        let (sql, standalone) = if parent_set.is_some() {
            (
                "SELECT relative_path, display_name, has_project_file, has_saved_checkpoint, has_banks \
                 FROM projects \
                 WHERE root_id = ?1 AND scan_session_id = ?2 \
                   AND is_standalone = 0 AND parent_set_relative_path = ?3 \
                 ORDER BY sort_order",
                false,
            )
        } else {
            (
                "SELECT relative_path, display_name, has_project_file, has_saved_checkpoint, has_banks \
                 FROM projects \
                 WHERE root_id = ?1 AND scan_session_id = ?2 \
                   AND is_standalone = 1 AND parent_set_relative_path IS NULL \
                 ORDER BY sort_order",
                true,
            )
        };
        let mut statement = self.connection.prepare(sql).map_err(unavailable)?;
        let map_row = |row: &rusqlite::Row<'_>| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        };
        let mut projects = Vec::new();
        if standalone {
            let rows = statement
                .query_map(params![root_row_id, scan_id], map_row)
                .map_err(unavailable)?;
            for row in rows {
                projects.push(project_from_database(row.map_err(unavailable)?)?);
            }
        } else {
            let rows = statement
                .query_map(
                    params![root_row_id, scan_id, parent_set.expect("checked above")],
                    map_row,
                )
                .map_err(unavailable)?;
            for row in rows {
                projects.push(project_from_database(row.map_err(unavailable)?)?);
            }
        }
        Ok(projects)
    }

    fn load_file_inventory(
        &self,
        root_row_id: i64,
        scan_id: i64,
    ) -> Result<(Vec<AudioAsset>, Vec<FileInstance>), CatalogError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT file_instances.relative_path, audio_assets.content_hash, \
                        file_instances.byte_size, audio_assets.byte_size, \
                        file_instances.modified_at_unix_ns, file_instances.storage_scope, \
                        file_instances.hash_freshness \
                 FROM file_instances \
                 JOIN audio_assets ON audio_assets.id = file_instances.audio_asset_id \
                 WHERE file_instances.root_id = ?1 AND file_instances.scan_session_id = ?2 \
                 ORDER BY file_instances.relative_path",
            )
            .map_err(unavailable)?;
        let rows = statement
            .query_map(params![root_row_id, scan_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .map_err(unavailable)?;
        let mut assets = BTreeMap::<String, AudioAsset>::new();
        let mut instances = Vec::new();
        for row in rows {
            let (path, hash, instance_size, asset_size, modified, scope, freshness) =
                row.map_err(unavailable)?;
            if instance_size != asset_size {
                return Err(CatalogError::InvalidStoredData {
                    field: "audio_asset_byte_size",
                });
            }
            let byte_size =
                u64::try_from(instance_size).map_err(|_| CatalogError::InvalidStoredData {
                    field: "file_instance_byte_size",
                })?;
            let content_hash =
                ContentHash::parse(hash).map_err(|_| CatalogError::InvalidStoredData {
                    field: "content_hash",
                })?;
            assets
                .entry(content_hash.as_str().to_owned())
                .or_insert_with(|| AudioAsset {
                    content_hash: content_hash.clone(),
                    byte_size,
                });
            instances.push(FileInstance {
                relative_path: stored_path(path)?,
                content_hash,
                byte_size,
                modified_at_unix_ns: modified,
                storage_scope: storage_scope_from_database(&scope)?,
                hash_freshness: freshness_from_database(&freshness)?,
            });
        }
        Ok((assets.into_values().collect(), instances))
    }

    fn load_state_inventory(
        &self,
        root_row_id: i64,
        scan_id: i64,
    ) -> Result<StateProjection, CatalogError> {
        let mut document_statement = self
            .connection
            .prepare(
                "SELECT id, project_relative_path, source_relative_path, document_kind, \
                        document_role, bank_index, parse_status, parser_name, parser_revision, \
                        source_version, compatibility_evidence \
                 FROM state_documents \
                 WHERE root_id = ?1 AND scan_session_id = ?2 \
                 ORDER BY source_relative_path",
            )
            .map_err(unavailable)?;
        let document_rows = document_statement
            .query_map(params![root_row_id, scan_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                ))
            })
            .map_err(unavailable)?;
        let mut state_documents = Vec::new();
        for row in document_rows {
            let (
                _id,
                project_path,
                source_path,
                kind,
                role,
                bank_index,
                parse_status,
                parser_name,
                parser_revision,
                source_version,
                compatibility_evidence,
            ) = row.map_err(unavailable)?;
            state_documents.push(StateDocument {
                project_relative_path: stored_path(project_path)?,
                source_relative_path: stored_path(source_path)?,
                kind: document_kind_from_database(&kind)?,
                role: document_role_from_database(&role)?,
                bank_index: bank_index
                    .map(|value| {
                        u8::try_from(value).map_err(|_| CatalogError::InvalidStoredData {
                            field: "bank_index",
                        })
                    })
                    .transpose()?,
                parse_status: parse_status_from_database(&parse_status)?,
                parser_provenance: ParserProvenance {
                    parser_name,
                    parser_revision,
                    source_version,
                    compatibility_evidence: compatibility_evidence
                        .as_deref()
                        .map(project_compatibility_evidence_from_database)
                        .transpose()?,
                },
            });
        }

        let mut assignment_statement = self
            .connection
            .prepare(
                "SELECT state_documents.source_relative_path, slot_assignments.slot_kind, \
                        slot_assignments.slot_number, slot_assignments.referenced_relative_path, \
                        slot_assignments.reference_status \
                 FROM slot_assignments \
                 JOIN state_documents ON state_documents.id = slot_assignments.state_document_id \
                 WHERE state_documents.root_id = ?1 AND state_documents.scan_session_id = ?2 \
                 ORDER BY state_documents.source_relative_path, slot_assignments.slot_kind, \
                          slot_assignments.slot_number",
            )
            .map_err(unavailable)?;
        let assignment_rows = assignment_statement
            .query_map(params![root_row_id, scan_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(unavailable)?;
        let mut slot_assignments = Vec::new();
        for row in assignment_rows {
            let (document_path, slot_kind, slot_number, target, status) =
                row.map_err(unavailable)?;
            slot_assignments.push(SlotAssignment {
                project_document_relative_path: stored_path(document_path)?,
                slot: slot_id_from_database(&slot_kind, slot_number)?,
                referenced_file_relative_path: target.map(stored_path).transpose()?,
                reference_status: reference_status_from_database(&status)?,
            });
        }

        let mut usage_statement = self
            .connection
            .prepare(
                "SELECT bank_document.source_relative_path, \
                        project_document.source_relative_path, usage_edges.slot_kind, \
                        usage_edges.slot_number, usage_edges.usage_kind, usage_edges.track_index, \
                        usage_edges.part_index, usage_edges.pattern_index, usage_edges.step_index, \
                        usage_edges.audible, usage_edges.referenced_relative_path, \
                        usage_edges.reference_status \
                 FROM usage_edges \
                 JOIN state_documents AS bank_document \
                   ON bank_document.id = usage_edges.state_document_id \
                 JOIN state_documents AS project_document \
                   ON project_document.id = usage_edges.project_document_id \
                 WHERE bank_document.root_id = ?1 AND bank_document.scan_session_id = ?2 \
                 ORDER BY bank_document.source_relative_path, usage_edges.slot_kind, \
                          usage_edges.slot_number, usage_edges.track_index, usage_edges.part_index, \
                          usage_edges.pattern_index, usage_edges.step_index",
            )
            .map_err(unavailable)?;
        let usage_rows = usage_statement
            .query_map(params![root_row_id, scan_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, bool>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, String>(11)?,
                ))
            })
            .map_err(unavailable)?;
        let mut usage_edges = Vec::new();
        for row in usage_rows {
            let (
                bank_document,
                project_document,
                slot_kind,
                slot_number,
                usage_kind,
                track_index,
                part_index,
                pattern_index,
                step_index,
                audible,
                target,
                status,
            ) = row.map_err(unavailable)?;
            usage_edges.push(SampleUsageEdge {
                bank_document_relative_path: stored_path(bank_document)?,
                project_document_relative_path: stored_path(project_document)?,
                slot: slot_id_from_database(&slot_kind, slot_number)?,
                usage_kind: usage_kind_from_database(&usage_kind)?,
                track_index: index_from_database(track_index, "track_index")?,
                part_index: part_index
                    .map(|value| index_from_database(value, "part_index"))
                    .transpose()?,
                pattern_index: pattern_index
                    .map(|value| index_from_database(value, "pattern_index"))
                    .transpose()?,
                step_index: step_index
                    .map(|value| index_from_database(value, "step_index"))
                    .transpose()?,
                audible,
                referenced_file_relative_path: target.map(stored_path).transpose()?,
                reference_status: reference_status_from_database(&status)?,
            });
        }
        Ok((state_documents, slot_assignments, usage_edges))
    }

    fn load_sample_settings(
        &self,
        root_row_id: i64,
        scan_id: i64,
    ) -> Result<Vec<SampleSettings>, CatalogError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT sample_settings.id, sample_settings.owner_kind, \
                        sample_settings.source_relative_path, \
                        sample_settings.marker_source_relative_path, \
                        state_documents.source_relative_path, slot_assignments.slot_kind, \
                        slot_assignments.slot_number, file_instances.relative_path, \
                        sample_settings.parse_status, sample_settings.parser_name, \
                        sample_settings.parser_revision, sample_settings.source_version, \
                        sample_settings.source_os_version, sample_settings.evidence, \
                        sample_settings.gain, sample_settings.tempo_x24, \
                        sample_settings.trim_bars_x100, sample_settings.loop_bars_x100, \
                        sample_settings.stretch_mode, sample_settings.loop_mode, \
                        sample_settings.trig_quantization, sample_settings.trim_start, \
                        sample_settings.trim_end, sample_settings.loop_start \
                 FROM sample_settings \
                 LEFT JOIN slot_assignments \
                   ON slot_assignments.id = sample_settings.slot_assignment_id \
                 LEFT JOIN state_documents \
                   ON state_documents.id = slot_assignments.state_document_id \
                 LEFT JOIN file_instances \
                   ON file_instances.id = sample_settings.file_instance_id \
                 WHERE sample_settings.root_id = ?1 \
                   AND sample_settings.scan_session_id = ?2 \
                 ORDER BY CASE sample_settings.owner_kind \
                              WHEN 'slot_assignment' THEN 0 ELSE 1 END, \
                          sample_settings.source_relative_path, \
                          slot_assignments.slot_kind, slot_assignments.slot_number",
            )
            .map_err(unavailable)?;
        let rows = statement
            .query_map(params![root_row_id, scan_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, Option<i64>>(14)?,
                    row.get::<_, Option<i64>>(15)?,
                    row.get::<_, Option<i64>>(16)?,
                    row.get::<_, Option<i64>>(17)?,
                    row.get::<_, Option<i64>>(18)?,
                    row.get::<_, Option<i64>>(19)?,
                    row.get::<_, Option<i64>>(20)?,
                    row.get::<_, Option<i64>>(21)?,
                    row.get::<_, Option<i64>>(22)?,
                    row.get::<_, Option<i64>>(23)?,
                ))
            })
            .map_err(unavailable)?;
        let mut settings = Vec::new();
        for row in rows {
            let (
                settings_id,
                owner,
                source,
                marker_source,
                project_document,
                slot_kind,
                slot_number,
                file_instance,
                parse_status,
                parser_name,
                parser_revision,
                source_version,
                source_os_version,
                evidence,
                gain,
                tempo_x24,
                trim_bars_x100,
                loop_bars_x100,
                stretch_mode,
                loop_mode,
                trig_quantization,
                trim_start,
                trim_end,
                loop_start,
            ) = row.map_err(unavailable)?;
            let owner = settings_owner_from_database(&owner)?;
            let slot = match (slot_kind, slot_number) {
                (Some(kind), Some(number)) => Some(slot_id_from_database(&kind, number)?),
                (None, None) => None,
                _ => {
                    return Err(CatalogError::InvalidStoredData {
                        field: "settings_owner",
                    })
                }
            };
            let mut slice_statement = self
                .connection
                .prepare(
                    "SELECT slice_index, trim_start, trim_end, loop_start \
                     FROM sample_slices WHERE sample_settings_id = ?1 ORDER BY slice_index",
                )
                .map_err(unavailable)?;
            let slice_rows = slice_statement
                .query_map([settings_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(unavailable)?;
            let mut slices = Vec::new();
            for slice in slice_rows {
                let (index, start, end, loop_start) = slice.map_err(unavailable)?;
                slices.push(SampleSlice {
                    index: u8_from_database(index, "slice_index")?,
                    trim_start: u32_from_database(start, "slice_trim_start")?,
                    trim_end: u32_from_database(end, "slice_trim_end")?,
                    loop_start: u32_from_database(loop_start, "slice_loop_start")?,
                });
            }
            settings.push(SampleSettings {
                owner,
                source_relative_path: stored_path(source)?,
                marker_source_relative_path: marker_source.map(stored_path).transpose()?,
                project_document_relative_path: project_document.map(stored_path).transpose()?,
                slot,
                file_instance_relative_path: file_instance.map(stored_path).transpose()?,
                parse_status: settings_parse_status_from_database(&parse_status)?,
                parser_provenance: ParserProvenance {
                    parser_name,
                    parser_revision,
                    source_version,
                    compatibility_evidence: None,
                },
                source_os_version,
                evidence: settings_evidence_from_database(&evidence)?,
                gain: option_u16_from_database(gain, "settings_gain")?,
                tempo_x24: option_u32_from_database(tempo_x24, "settings_tempo")?,
                trim_bars_x100: option_u32_from_database(trim_bars_x100, "settings_trim_bars")?,
                loop_bars_x100: option_u32_from_database(loop_bars_x100, "settings_loop_bars")?,
                stretch_mode: option_u32_from_database(stretch_mode, "settings_stretch")?,
                loop_mode: option_u32_from_database(loop_mode, "settings_loop_mode")?,
                trig_quantization: trig_quantization
                    .map(|value| {
                        i32::try_from(value).map_err(|_| CatalogError::InvalidStoredData {
                            field: "settings_quantization",
                        })
                    })
                    .transpose()?,
                trim_start: option_u32_from_database(trim_start, "settings_trim_start")?,
                trim_end: option_u32_from_database(trim_end, "settings_trim_end")?,
                loop_start: option_u32_from_database(loop_start, "settings_loop_start")?,
                slices,
            });
        }
        Ok(settings)
    }
}

fn insert_project(
    transaction: &Transaction<'_>,
    root_row_id: i64,
    scan_id: i64,
    project: &LibraryProject,
    parent_set: Option<&str>,
    sort_order: usize,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO projects \
         (root_id, scan_session_id, relative_path, display_name, is_standalone, \
          parent_set_relative_path, has_project_file, has_saved_checkpoint, has_banks, sort_order) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            root_row_id,
            scan_id,
            project.relative_path.as_str(),
            project.display_name,
            parent_set.is_none(),
            parent_set,
            project.has_project_file,
            project.has_saved_checkpoint,
            project.has_banks,
            sort_order as i64,
        ],
    )?;
    Ok(())
}

fn insert_state_projection(
    transaction: &Transaction<'_>,
    root_row_id: i64,
    scan_id: i64,
    snapshot: &LibrarySnapshot,
) -> Result<(), rusqlite::Error> {
    let mut document_ids = HashMap::<String, i64>::new();
    for document in &snapshot.state_documents {
        transaction.execute(
            "INSERT INTO state_documents \
             (root_id, scan_session_id, project_relative_path, source_relative_path, \
              document_kind, document_role, bank_index, parse_status, parser_name, \
              parser_revision, source_version, compatibility_evidence) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                root_row_id,
                scan_id,
                document.project_relative_path.as_str(),
                document.source_relative_path.as_str(),
                document_kind_to_database(document.kind),
                document_role_to_database(document.role),
                document.bank_index.map(i64::from),
                parse_status_to_database(document.parse_status),
                document.parser_provenance.parser_name,
                document.parser_provenance.parser_revision,
                document.parser_provenance.source_version,
                document
                    .parser_provenance
                    .compatibility_evidence
                    .map(project_compatibility_evidence_to_database),
            ],
        )?;
        document_ids.insert(
            document.source_relative_path.as_str().to_owned(),
            transaction.last_insert_rowid(),
        );
    }

    let mut assignment_ids = HashMap::<(String, SampleSlotKind, u16), i64>::new();
    for assignment in &snapshot.slot_assignments {
        let document_id = document_ids
            .get(assignment.project_document_relative_path.as_str())
            .copied()
            .ok_or_else(|| sql_integrity_error("slot assignment document is missing"))?;
        transaction.execute(
            "INSERT INTO slot_assignments \
             (state_document_id, slot_kind, slot_number, referenced_relative_path, \
              reference_status) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                document_id,
                slot_kind_to_database(assignment.slot.kind()),
                i64::from(assignment.slot.number()),
                assignment
                    .referenced_file_relative_path
                    .as_ref()
                    .map(RootRelativePath::as_str),
                reference_status_to_database(assignment.reference_status),
            ],
        )?;
        assignment_ids.insert(
            (
                assignment
                    .project_document_relative_path
                    .as_str()
                    .to_owned(),
                assignment.slot.kind(),
                assignment.slot.number(),
            ),
            transaction.last_insert_rowid(),
        );
    }

    for edge in &snapshot.usage_edges {
        let bank_document_id = document_ids
            .get(edge.bank_document_relative_path.as_str())
            .copied()
            .ok_or_else(|| sql_integrity_error("usage bank document is missing"))?;
        let project_document_id = document_ids
            .get(edge.project_document_relative_path.as_str())
            .copied()
            .ok_or_else(|| sql_integrity_error("usage project document is missing"))?;
        let slot_assignment_id = assignment_ids
            .get(&(
                edge.project_document_relative_path.as_str().to_owned(),
                edge.slot.kind(),
                edge.slot.number(),
            ))
            .copied();
        transaction.execute(
            "INSERT INTO usage_edges \
             (state_document_id, project_document_id, slot_assignment_id, slot_kind, \
              slot_number, usage_kind, track_index, part_index, pattern_index, step_index, \
              audible, referenced_relative_path, reference_status) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                bank_document_id,
                project_document_id,
                slot_assignment_id,
                slot_kind_to_database(edge.slot.kind()),
                i64::from(edge.slot.number()),
                usage_kind_to_database(edge.usage_kind),
                i64::from(edge.track_index),
                edge.part_index.map(i64::from),
                edge.pattern_index.map(i64::from),
                edge.step_index.map(i64::from),
                edge.audible,
                edge.referenced_file_relative_path
                    .as_ref()
                    .map(RootRelativePath::as_str),
                reference_status_to_database(edge.reference_status),
            ],
        )?;
    }
    Ok(())
}

fn sql_integrity_error(message: &'static str) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    )))
}

fn insert_sample_settings(
    transaction: &Transaction<'_>,
    root_row_id: i64,
    scan_id: i64,
    snapshot: &LibrarySnapshot,
) -> Result<(), rusqlite::Error> {
    for settings in &snapshot.sample_settings {
        let (slot_assignment_id, file_instance_id) = match settings.owner {
            SampleSettingsOwner::SlotAssignment => {
                let project_document = settings
                    .project_document_relative_path
                    .as_ref()
                    .ok_or_else(|| {
                        sql_integrity_error("sample settings project document is missing")
                    })?;
                let slot = settings
                    .slot
                    .ok_or_else(|| sql_integrity_error("sample settings slot is missing"))?;
                let assignment_id = transaction.query_row(
                    "SELECT slot_assignments.id FROM slot_assignments \
                         JOIN state_documents \
                           ON state_documents.id = slot_assignments.state_document_id \
                         WHERE state_documents.root_id = ?1 \
                           AND state_documents.source_relative_path = ?2 \
                           AND slot_assignments.slot_kind = ?3 \
                           AND slot_assignments.slot_number = ?4",
                    params![
                        root_row_id,
                        project_document.as_str(),
                        slot_kind_to_database(slot.kind()),
                        i64::from(slot.number()),
                    ],
                    |row| row.get::<_, i64>(0),
                )?;
                (Some(assignment_id), None)
            }
            SampleSettingsOwner::FileInstanceSidecar => {
                let file_instance =
                    settings
                        .file_instance_relative_path
                        .as_ref()
                        .ok_or_else(|| {
                            sql_integrity_error("sample settings file instance is missing")
                        })?;
                let file_instance_id = transaction.query_row(
                    "SELECT id FROM file_instances WHERE root_id = ?1 AND relative_path = ?2",
                    params![root_row_id, file_instance.as_str()],
                    |row| row.get::<_, i64>(0),
                )?;
                (None, Some(file_instance_id))
            }
        };
        transaction.execute(
            "INSERT INTO sample_settings \
             (root_id, scan_session_id, owner_kind, source_relative_path, \
              marker_source_relative_path, slot_assignment_id, file_instance_id, parse_status, \
              parser_name, parser_revision, source_version, source_os_version, evidence, gain, \
              tempo_x24, trim_bars_x100, loop_bars_x100, stretch_mode, loop_mode, \
              trig_quantization, trim_start, trim_end, loop_start) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, \
                     ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                root_row_id,
                scan_id,
                settings_owner_to_database(settings.owner),
                settings.source_relative_path.as_str(),
                settings
                    .marker_source_relative_path
                    .as_ref()
                    .map(RootRelativePath::as_str),
                slot_assignment_id,
                file_instance_id,
                settings_parse_status_to_database(settings.parse_status),
                settings.parser_provenance.parser_name,
                settings.parser_provenance.parser_revision,
                settings.parser_provenance.source_version,
                settings.source_os_version,
                settings_evidence_to_database(settings.evidence),
                settings.gain.map(i64::from),
                settings.tempo_x24.map(i64::from),
                settings.trim_bars_x100.map(i64::from),
                settings.loop_bars_x100.map(i64::from),
                settings.stretch_mode.map(i64::from),
                settings.loop_mode.map(i64::from),
                settings.trig_quantization.map(i64::from),
                settings.trim_start.map(i64::from),
                settings.trim_end.map(i64::from),
                settings.loop_start.map(i64::from),
            ],
        )?;
        let settings_id = transaction.last_insert_rowid();
        for slice in &settings.slices {
            transaction.execute(
                "INSERT INTO sample_slices \
                 (sample_settings_id, slice_index, trim_start, trim_end, loop_start) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    settings_id,
                    i64::from(slice.index),
                    i64::from(slice.trim_start),
                    i64::from(slice.trim_end),
                    i64::from(slice.loop_start),
                ],
            )?;
        }
    }
    Ok(())
}

fn validate_snapshot(snapshot: &LibrarySnapshot) -> Result<(), CatalogError> {
    let mut topology_paths = HashSet::new();
    for set in &snapshot.sets {
        validate_unique_path(&mut topology_paths, &set.relative_path)?;
        for project in &set.projects {
            validate_unique_path(&mut topology_paths, &project.relative_path)?;
        }
    }
    for project in &snapshot.standalone_projects {
        validate_unique_path(&mut topology_paths, &project.relative_path)?;
    }
    let project_paths = snapshot
        .sets
        .iter()
        .flat_map(|set| set.projects.iter())
        .chain(snapshot.standalone_projects.iter())
        .map(|project| project.relative_path.as_str().to_owned())
        .collect::<HashSet<_>>();

    let mut assets = HashMap::new();
    for asset in &snapshot.audio_assets {
        if assets
            .insert(asset.content_hash.as_str(), asset.byte_size)
            .is_some()
        {
            return Err(CatalogError::Integrity {
                message: "duplicate audio asset content hash".into(),
            });
        }
    }
    let mut file_paths = HashSet::new();
    for instance in &snapshot.file_instances {
        validate_unique_path(&mut file_paths, &instance.relative_path)?;
        match assets.get(instance.content_hash.as_str()) {
            Some(byte_size) if *byte_size == instance.byte_size => {}
            Some(_) => {
                return Err(CatalogError::Integrity {
                    message: "audio asset and file instance byte sizes differ".into(),
                })
            }
            None => {
                return Err(CatalogError::Integrity {
                    message: "file instance references a missing audio asset".into(),
                })
            }
        }
    }

    let mut documents = HashMap::new();
    let mut document_identities = HashSet::new();
    for document in &snapshot.state_documents {
        if !project_paths.contains(document.project_relative_path.as_str()) {
            return Err(CatalogError::Integrity {
                message: "state document references an unknown project".into(),
            });
        }
        if !is_direct_child(
            &document.project_relative_path,
            &document.source_relative_path,
        ) {
            return Err(CatalogError::Integrity {
                message: "state document is outside its project directory".into(),
            });
        }
        let bank_shape_valid = match document.kind {
            StateDocumentKind::Project => document.bank_index.is_none(),
            StateDocumentKind::Bank => document.bank_index.is_some_and(|index| index < 16),
        };
        if !bank_shape_valid
            || document.parser_provenance.parser_name.trim().is_empty()
            || document.parser_provenance.parser_revision.trim().is_empty()
        {
            return Err(CatalogError::Integrity {
                message: "state document metadata is invalid".into(),
            });
        }
        let identity = (
            document.project_relative_path.as_str().to_owned(),
            document.kind,
            document.role,
            document.bank_index,
        );
        if !document_identities.insert(identity) {
            return Err(CatalogError::Integrity {
                message: "duplicate state document identity".into(),
            });
        }
        if documents
            .insert(document.source_relative_path.as_str().to_owned(), document)
            .is_some()
        {
            return Err(CatalogError::DuplicateRelativePath(
                document.source_relative_path.clone(),
            ));
        }
    }

    let mut assignments = HashMap::new();
    for assignment in &snapshot.slot_assignments {
        let document = documents
            .get(assignment.project_document_relative_path.as_str())
            .ok_or_else(|| CatalogError::Integrity {
                message: "slot assignment references a missing state document".into(),
            })?;
        if document.kind != StateDocumentKind::Project
            || document.parse_status != StateDocumentParseStatus::Parsed
        {
            return Err(CatalogError::Integrity {
                message: "slot assignment requires a parsed project document".into(),
            });
        }
        let target_exists = assignment
            .referenced_file_relative_path
            .as_ref()
            .is_some_and(|path| file_paths.contains(path.as_str()));
        let reference_valid = match assignment.reference_status {
            SampleReferenceStatus::Resolved => {
                assignment.referenced_file_relative_path.is_some() && target_exists
            }
            SampleReferenceStatus::Missing | SampleReferenceStatus::Ambiguous => {
                assignment.referenced_file_relative_path.is_some() && !target_exists
            }
            SampleReferenceStatus::InvalidPath => {
                assignment.referenced_file_relative_path.is_none()
            }
            SampleReferenceStatus::UnassignedSlot => false,
        };
        if !reference_valid {
            return Err(CatalogError::Integrity {
                message: "slot assignment reference status is inconsistent".into(),
            });
        }
        let key = (
            assignment
                .project_document_relative_path
                .as_str()
                .to_owned(),
            assignment.slot.kind(),
            assignment.slot.number(),
        );
        if assignments.insert(key, assignment).is_some() {
            return Err(CatalogError::Integrity {
                message: "duplicate slot assignment".into(),
            });
        }
    }

    let mut usage_coordinates = HashSet::new();
    for edge in &snapshot.usage_edges {
        let bank_document = documents
            .get(edge.bank_document_relative_path.as_str())
            .ok_or_else(|| CatalogError::Integrity {
                message: "usage edge references a missing bank document".into(),
            })?;
        if bank_document.kind != StateDocumentKind::Bank
            || bank_document.parse_status != StateDocumentParseStatus::Parsed
            || edge.track_index >= 8
            || edge.part_index.is_some_and(|index| index >= 4)
            || edge.pattern_index.is_some_and(|index| index >= 16)
            || edge.step_index.is_some_and(|index| index >= 64)
        {
            return Err(CatalogError::Integrity {
                message: "usage edge metadata is invalid".into(),
            });
        }
        let usage_shape_valid = match edge.usage_kind {
            SampleUsageKind::Machine => {
                edge.part_index.is_some()
                    && edge.pattern_index.is_none()
                    && edge.step_index.is_none()
            }
            SampleUsageKind::SampleLock => {
                edge.part_index.is_none()
                    && edge.pattern_index.is_some()
                    && edge.step_index.is_some()
            }
        };
        if !usage_shape_valid {
            return Err(CatalogError::Integrity {
                message: "usage edge coordinates do not match its kind".into(),
            });
        }
        let coordinate = (
            edge.bank_document_relative_path.as_str().to_owned(),
            edge.usage_kind,
            edge.track_index,
            edge.part_index,
            edge.pattern_index,
            edge.step_index,
        );
        if !usage_coordinates.insert(coordinate) {
            return Err(CatalogError::Integrity {
                message: "duplicate usage edge coordinate".into(),
            });
        }
        let assignment = assignments.get(&(
            edge.project_document_relative_path.as_str().to_owned(),
            edge.slot.kind(),
            edge.slot.number(),
        ));
        let project_document = documents
            .get(edge.project_document_relative_path.as_str())
            .ok_or_else(|| CatalogError::Integrity {
                message: "usage edge references a missing project document".into(),
            })?;
        if project_document.kind != StateDocumentKind::Project
            || project_document.parse_status != StateDocumentParseStatus::Parsed
            || project_document.project_relative_path != bank_document.project_relative_path
            || project_document.role != bank_document.role
        {
            return Err(CatalogError::Integrity {
                message: "usage edge crosses project or state-role boundaries".into(),
            });
        }
        let target_matches = match (edge.reference_status, assignment) {
            (SampleReferenceStatus::UnassignedSlot, None) => {
                edge.referenced_file_relative_path.is_none()
            }
            (status, Some(assignment)) if status != SampleReferenceStatus::UnassignedSlot => {
                status == assignment.reference_status
                    && edge.referenced_file_relative_path
                        == assignment.referenced_file_relative_path
            }
            _ => false,
        };
        if !target_matches {
            return Err(CatalogError::Integrity {
                message: "usage edge target does not match its slot assignment".into(),
            });
        }
    }

    let mut settings_owners = HashSet::new();
    for settings in &snapshot.sample_settings {
        if settings.parser_provenance.parser_name.trim().is_empty()
            || settings.parser_provenance.parser_revision.trim().is_empty()
        {
            return Err(CatalogError::Integrity {
                message: "sample settings parser provenance is invalid".into(),
            });
        }
        let owner_key = match settings.owner {
            SampleSettingsOwner::SlotAssignment => {
                let (Some(document_path), Some(slot), None) = (
                    settings.project_document_relative_path.as_ref(),
                    settings.slot,
                    settings.file_instance_relative_path.as_ref(),
                ) else {
                    return Err(CatalogError::Integrity {
                        message: "slot-local sample settings owner is invalid".into(),
                    });
                };
                if !assignments.contains_key(&(
                    document_path.as_str().to_owned(),
                    slot.kind(),
                    slot.number(),
                )) || settings.source_relative_path != *document_path
                {
                    return Err(CatalogError::Integrity {
                        message: "slot-local sample settings references an unknown assignment"
                            .into(),
                    });
                }
                if settings
                    .marker_source_relative_path
                    .as_ref()
                    .is_some_and(|marker| {
                        documents
                            .get(document_path.as_str())
                            .is_none_or(|document| {
                                !is_direct_child(&document.project_relative_path, marker)
                            })
                    })
                {
                    return Err(CatalogError::Integrity {
                        message: "sample marker source is outside its project directory".into(),
                    });
                }
                format!(
                    "slot:{}:{:?}:{}",
                    document_path.as_str(),
                    slot.kind(),
                    slot.number()
                )
            }
            SampleSettingsOwner::FileInstanceSidecar => {
                let (None, None, Some(file_path)) = (
                    settings.project_document_relative_path.as_ref(),
                    settings.slot,
                    settings.file_instance_relative_path.as_ref(),
                ) else {
                    return Err(CatalogError::Integrity {
                        message: "file-sidecar sample settings owner is invalid".into(),
                    });
                };
                if settings.marker_source_relative_path.is_some()
                    || !file_paths.contains(file_path.as_str())
                    || !is_matching_sidecar(file_path, &settings.source_relative_path)
                {
                    return Err(CatalogError::Integrity {
                        message: "file-sidecar sample settings source is invalid".into(),
                    });
                }
                format!("file:{}", file_path.as_str())
            }
        };
        if !settings_owners.insert(owner_key) {
            return Err(CatalogError::Integrity {
                message: "duplicate sample settings owner".into(),
            });
        }
        let has_values = settings.gain.is_some()
            || settings.tempo_x24.is_some()
            || settings.trim_bars_x100.is_some()
            || settings.loop_bars_x100.is_some()
            || settings.stretch_mode.is_some()
            || settings.loop_mode.is_some()
            || settings.trig_quantization.is_some()
            || settings.trim_start.is_some()
            || settings.trim_end.is_some()
            || settings.loop_start.is_some()
            || !settings.slices.is_empty();
        if settings.parse_status != SampleSettingsParseStatus::Parsed && has_values {
            return Err(CatalogError::Integrity {
                message: "unparsed sample settings must not expose decoded values".into(),
            });
        }
        let mut slice_indices = HashSet::new();
        for slice in &settings.slices {
            if slice.index >= 64 || !slice_indices.insert(slice.index) {
                return Err(CatalogError::Integrity {
                    message: "sample slice index is invalid or duplicated".into(),
                });
            }
        }
    }
    Ok(())
}

fn is_matching_sidecar(audio: &RootRelativePath, sidecar: &RootRelativePath) -> bool {
    let Some((audio_stem, _)) = audio.as_str().rsplit_once('.') else {
        return false;
    };
    sidecar.as_str() == format!("{audio_stem}.ot")
}

fn is_direct_child(parent: &RootRelativePath, child: &RootRelativePath) -> bool {
    child
        .as_str()
        .strip_prefix(parent.as_str())
        .and_then(|suffix| suffix.strip_prefix('/'))
        .is_some_and(|file_name| !file_name.is_empty() && !file_name.contains('/'))
}

fn validate_unique_path(
    paths: &mut HashSet<String>,
    path: &RootRelativePath,
) -> Result<(), CatalogError> {
    if !paths.insert(path.as_str().to_owned()) {
        return Err(CatalogError::DuplicateRelativePath(path.clone()));
    }
    Ok(())
}

fn project_from_database(
    row: (String, String, bool, bool, bool),
) -> Result<LibraryProject, CatalogError> {
    Ok(LibraryProject {
        relative_path: stored_path(row.0)?,
        display_name: row.1,
        has_project_file: row.2,
        has_saved_checkpoint: row.3,
        has_banks: row.4,
    })
}

fn stored_path(value: String) -> Result<RootRelativePath, CatalogError> {
    RootRelativePath::parse(value).map_err(|_| CatalogError::InvalidStoredData {
        field: "relative_path",
    })
}

fn byte_size_to_i64(value: u64) -> Result<i64, rusqlite::Error> {
    i64::try_from(value).map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

fn storage_scope_to_database(scope: SampleStorageScope) -> &'static str {
    match scope {
        SampleStorageScope::SetAudioPool => "set_audio_pool",
        SampleStorageScope::ProjectLocal => "project_local",
        SampleStorageScope::Unclassified => "unclassified",
        SampleStorageScope::MacDerived => "mac_derived",
    }
}

fn storage_scope_from_database(value: &str) -> Result<SampleStorageScope, CatalogError> {
    match value {
        "set_audio_pool" => Ok(SampleStorageScope::SetAudioPool),
        "project_local" => Ok(SampleStorageScope::ProjectLocal),
        "unclassified" => Ok(SampleStorageScope::Unclassified),
        "mac_derived" => Ok(SampleStorageScope::MacDerived),
        _ => Err(CatalogError::InvalidStoredData {
            field: "storage_scope",
        }),
    }
}

fn freshness_to_database(freshness: ContentHashFreshness) -> &'static str {
    match freshness {
        ContentHashFreshness::ComputedThisScan => "computed_this_scan",
        ContentHashFreshness::ReusedUnchangedMetadata => "reused_unchanged_metadata",
    }
}

fn freshness_from_database(value: &str) -> Result<ContentHashFreshness, CatalogError> {
    match value {
        "computed_this_scan" => Ok(ContentHashFreshness::ComputedThisScan),
        "reused_unchanged_metadata" => Ok(ContentHashFreshness::ReusedUnchangedMetadata),
        _ => Err(CatalogError::InvalidStoredData {
            field: "hash_freshness",
        }),
    }
}

fn settings_owner_to_database(owner: SampleSettingsOwner) -> &'static str {
    match owner {
        SampleSettingsOwner::SlotAssignment => "slot_assignment",
        SampleSettingsOwner::FileInstanceSidecar => "file_instance_sidecar",
    }
}

fn settings_owner_from_database(value: &str) -> Result<SampleSettingsOwner, CatalogError> {
    match value {
        "slot_assignment" => Ok(SampleSettingsOwner::SlotAssignment),
        "file_instance_sidecar" => Ok(SampleSettingsOwner::FileInstanceSidecar),
        _ => Err(CatalogError::InvalidStoredData {
            field: "sample_settings_owner",
        }),
    }
}

fn settings_parse_status_to_database(status: SampleSettingsParseStatus) -> &'static str {
    match status {
        SampleSettingsParseStatus::Parsed => "parsed",
        SampleSettingsParseStatus::UnsupportedVersion => "unsupported_version",
        SampleSettingsParseStatus::Malformed => "malformed",
    }
}

fn settings_parse_status_from_database(
    value: &str,
) -> Result<SampleSettingsParseStatus, CatalogError> {
    match value {
        "parsed" => Ok(SampleSettingsParseStatus::Parsed),
        "unsupported_version" => Ok(SampleSettingsParseStatus::UnsupportedVersion),
        "malformed" => Ok(SampleSettingsParseStatus::Malformed),
        _ => Err(CatalogError::InvalidStoredData {
            field: "sample_settings_parse_status",
        }),
    }
}

fn settings_evidence_to_database(evidence: SampleSettingsEvidence) -> &'static str {
    match evidence {
        SampleSettingsEvidence::OfficialDocumentation => "official_documentation",
        SampleSettingsEvidence::ReproducedFixtureObservation => "reproduced_fixture_observation",
        SampleSettingsEvidence::LegacyImplementationObservation => {
            "legacy_implementation_observation"
        }
    }
}

fn settings_evidence_from_database(value: &str) -> Result<SampleSettingsEvidence, CatalogError> {
    match value {
        "official_documentation" => Ok(SampleSettingsEvidence::OfficialDocumentation),
        "reproduced_fixture_observation" => {
            Ok(SampleSettingsEvidence::ReproducedFixtureObservation)
        }
        "legacy_implementation_observation" => {
            Ok(SampleSettingsEvidence::LegacyImplementationObservation)
        }
        _ => Err(CatalogError::InvalidStoredData {
            field: "sample_settings_evidence",
        }),
    }
}

fn project_compatibility_evidence_to_database(
    evidence: ProjectCompatibilityEvidence,
) -> &'static str {
    match evidence {
        ProjectCompatibilityEvidence::UpstreamLibrary => "upstream_library",
        ProjectCompatibilityEvidence::VerifiedMasterOctaFixture => "verified_master_octa_fixture",
    }
}

fn project_compatibility_evidence_from_database(
    value: &str,
) -> Result<ProjectCompatibilityEvidence, CatalogError> {
    match value {
        "upstream_library" => Ok(ProjectCompatibilityEvidence::UpstreamLibrary),
        "verified_master_octa_fixture" => {
            Ok(ProjectCompatibilityEvidence::VerifiedMasterOctaFixture)
        }
        _ => Err(CatalogError::InvalidStoredData {
            field: "compatibility_evidence",
        }),
    }
}

fn u8_from_database(value: i64, field: &'static str) -> Result<u8, CatalogError> {
    u8::try_from(value).map_err(|_| CatalogError::InvalidStoredData { field })
}

fn u32_from_database(value: i64, field: &'static str) -> Result<u32, CatalogError> {
    u32::try_from(value).map_err(|_| CatalogError::InvalidStoredData { field })
}

fn option_u16_from_database(
    value: Option<i64>,
    field: &'static str,
) -> Result<Option<u16>, CatalogError> {
    value
        .map(|value| u16::try_from(value).map_err(|_| CatalogError::InvalidStoredData { field }))
        .transpose()
}

fn option_u32_from_database(
    value: Option<i64>,
    field: &'static str,
) -> Result<Option<u32>, CatalogError> {
    value
        .map(|value| u32_from_database(value, field))
        .transpose()
}

fn document_kind_to_database(kind: StateDocumentKind) -> &'static str {
    match kind {
        StateDocumentKind::Project => "project",
        StateDocumentKind::Bank => "bank",
    }
}

fn document_kind_from_database(value: &str) -> Result<StateDocumentKind, CatalogError> {
    match value {
        "project" => Ok(StateDocumentKind::Project),
        "bank" => Ok(StateDocumentKind::Bank),
        _ => Err(CatalogError::InvalidStoredData {
            field: "document_kind",
        }),
    }
}

fn document_role_to_database(role: StateDocumentRole) -> &'static str {
    match role {
        StateDocumentRole::Working => "working",
        StateDocumentRole::SavedCheckpoint => "saved_checkpoint",
    }
}

fn document_role_from_database(value: &str) -> Result<StateDocumentRole, CatalogError> {
    match value {
        "working" => Ok(StateDocumentRole::Working),
        "saved_checkpoint" => Ok(StateDocumentRole::SavedCheckpoint),
        _ => Err(CatalogError::InvalidStoredData {
            field: "document_role",
        }),
    }
}

fn parse_status_to_database(status: StateDocumentParseStatus) -> &'static str {
    match status {
        StateDocumentParseStatus::Parsed => "parsed",
        StateDocumentParseStatus::UnsupportedVersion => "unsupported_version",
        StateDocumentParseStatus::Malformed => "malformed",
    }
}

fn parse_status_from_database(value: &str) -> Result<StateDocumentParseStatus, CatalogError> {
    match value {
        "parsed" => Ok(StateDocumentParseStatus::Parsed),
        "unsupported_version" => Ok(StateDocumentParseStatus::UnsupportedVersion),
        "malformed" => Ok(StateDocumentParseStatus::Malformed),
        _ => Err(CatalogError::InvalidStoredData {
            field: "parse_status",
        }),
    }
}

fn slot_kind_to_database(kind: SampleSlotKind) -> &'static str {
    match kind {
        SampleSlotKind::Static => "static",
        SampleSlotKind::Flex => "flex",
    }
}

fn slot_kind_from_database(value: &str) -> Result<SampleSlotKind, CatalogError> {
    match value {
        "static" => Ok(SampleSlotKind::Static),
        "flex" => Ok(SampleSlotKind::Flex),
        _ => Err(CatalogError::InvalidStoredData { field: "slot_kind" }),
    }
}

fn slot_id_from_database(kind: &str, number: i64) -> Result<SampleSlotId, CatalogError> {
    let kind = slot_kind_from_database(kind)?;
    let number = u16::try_from(number).map_err(|_| CatalogError::InvalidStoredData {
        field: "slot_number",
    })?;
    SampleSlotId::new(kind, number).map_err(|_| CatalogError::InvalidStoredData {
        field: "slot_number",
    })
}

fn reference_status_to_database(status: SampleReferenceStatus) -> &'static str {
    match status {
        SampleReferenceStatus::Resolved => "resolved",
        SampleReferenceStatus::Missing => "missing",
        SampleReferenceStatus::InvalidPath => "invalid_path",
        SampleReferenceStatus::Ambiguous => "ambiguous",
        SampleReferenceStatus::UnassignedSlot => "unassigned_slot",
    }
}

fn reference_status_from_database(value: &str) -> Result<SampleReferenceStatus, CatalogError> {
    match value {
        "resolved" => Ok(SampleReferenceStatus::Resolved),
        "missing" => Ok(SampleReferenceStatus::Missing),
        "invalid_path" => Ok(SampleReferenceStatus::InvalidPath),
        "ambiguous" => Ok(SampleReferenceStatus::Ambiguous),
        "unassigned_slot" => Ok(SampleReferenceStatus::UnassignedSlot),
        _ => Err(CatalogError::InvalidStoredData {
            field: "reference_status",
        }),
    }
}

fn usage_kind_to_database(kind: SampleUsageKind) -> &'static str {
    match kind {
        SampleUsageKind::Machine => "machine",
        SampleUsageKind::SampleLock => "sample_lock",
    }
}

fn usage_kind_from_database(value: &str) -> Result<SampleUsageKind, CatalogError> {
    match value {
        "machine" => Ok(SampleUsageKind::Machine),
        "sample_lock" => Ok(SampleUsageKind::SampleLock),
        _ => Err(CatalogError::InvalidStoredData {
            field: "usage_kind",
        }),
    }
}

fn index_from_database(value: i64, field: &'static str) -> Result<u8, CatalogError> {
    u8::try_from(value).map_err(|_| CatalogError::InvalidStoredData { field })
}

fn configure_connection(connection: &Connection) -> Result<(), CatalogError> {
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(unavailable)?;
    let enabled: bool = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .map_err(unavailable)?;
    if !enabled {
        return Err(CatalogError::Integrity {
            message: "SQLite foreign key enforcement is disabled".into(),
        });
    }
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), CatalogError> {
    let has_migration_table: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
            params!["schema_migrations"],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    let current_version = if has_migration_table {
        let version: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        u64::try_from(version).map_err(|_| CatalogError::InvalidStoredData {
            field: "schema_migration_version",
        })?
    } else {
        0
    };
    if current_version > LATEST_SCHEMA_VERSION {
        return Err(CatalogError::UnsupportedSchema {
            found: current_version,
            supported: LATEST_SCHEMA_VERSION,
        });
    }

    let version_before = current_version;

    for (version, sql) in MIGRATIONS {
        if *version > current_version {
            if *version == 11 {
                apply_migration_11_with_projection_repair(
                    connection,
                    *version,
                    sql,
                    version_before,
                )?;
            } else {
                apply_migration(connection, *version, sql)?;
            }
        }
    }

    backfill_project_discovery_flags(connection)?;

    configure_connection(connection)?;
    Ok(())
}

fn backfill_project_discovery_flags(connection: &Connection) -> Result<(), CatalogError> {
    let has_column: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('projects')
                WHERE name = 'has_saved_checkpoint'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if !has_column {
        return Ok(());
    }
    connection
        .execute_batch(
            "UPDATE projects SET has_saved_checkpoint = 1
             WHERE has_saved_checkpoint = 0 AND EXISTS (
                SELECT 1 FROM state_documents sd
                WHERE sd.root_id = projects.root_id
                  AND sd.scan_session_id = projects.scan_session_id
                  AND sd.project_relative_path = projects.relative_path
                  AND sd.document_kind = 'project'
                  AND sd.document_role = 'saved_checkpoint'
             );",
        )
        .map_err(unavailable)?;
    Ok(())
}

fn apply_migration_11_with_projection_repair(
    connection: &mut Connection,
    version: u64,
    sql: &str,
    version_before: u64,
) -> Result<(), CatalogError> {
    let migration_result = (|| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| migration_error(version, error))?;
        transaction
            .execute_batch(sql)
            .map_err(|error| migration_error(version, error))?;
        let repair_applied: i64 = transaction
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM catalog_meta WHERE key = ?1",
                params![PROJECTION_REPAIR_META_KEY],
                |row| row.get(0),
            )
            .map_err(|error| migration_error(version, error))?;
        if repair_applied == 0 {
            if version_before >= MIGRATION_REQUIRES_FOREIGN_KEYS_OFF {
                let has_column: bool = transaction
                    .query_row(
                        "SELECT EXISTS(
                            SELECT 1 FROM pragma_table_info('roots')
                            WHERE name = 'observational_projection_untrusted'
                        )",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|error| migration_error(version, error))?;
                if has_column {
                    transaction
                        .execute(
                            "UPDATE roots SET observational_projection_untrusted = 1",
                            [],
                        )
                        .map_err(|error| migration_error(version, error))?;
                }
            }
            transaction
                .execute(
                    "UPDATE catalog_meta SET value = '1' WHERE key = ?1",
                    params![PROJECTION_REPAIR_META_KEY],
                )
                .map_err(|error| migration_error(version, error))?;
        }
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at) \
                 VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![
                    i64::try_from(version).map_err(|error| CatalogError::Migration {
                        version,
                        message: error.to_string(),
                    })?
                ],
            )
            .map_err(|error| migration_error(version, error))?;
        transaction
            .commit()
            .map_err(|error| migration_error(version, error))
    })();
    migration_result
}

fn apply_migration(
    connection: &mut Connection,
    version: u64,
    sql: &str,
) -> Result<(), CatalogError> {
    let foreign_keys_off = version == MIGRATION_REQUIRES_FOREIGN_KEYS_OFF || version == 13;
    let previous_foreign_keys = if foreign_keys_off {
        Some(set_foreign_keys(connection, false)?)
    } else {
        None
    };

    let migration_result = (|| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| migration_error(version, error))?;
        transaction
            .execute_batch(sql)
            .map_err(|error| migration_error(version, error))?;
        if foreign_keys_off {
            set_foreign_keys(&transaction, true)?;
            assert_foreign_key_check(&transaction)?;
        }
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at) \
                 VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![
                    i64::try_from(version).map_err(|error| CatalogError::Migration {
                        version,
                        message: error.to_string(),
                    })?
                ],
            )
            .map_err(|error| migration_error(version, error))?;
        transaction
            .commit()
            .map_err(|error| migration_error(version, error))
    })();

    if let Some(previous) = previous_foreign_keys {
        restore_foreign_keys(connection, previous)?;
    }

    migration_result
}

fn set_foreign_keys(connection: &Connection, enabled: bool) -> Result<bool, CatalogError> {
    let previous: bool = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .map_err(unavailable)?;
    connection
        .pragma_update(None, "foreign_keys", enabled)
        .map_err(unavailable)?;
    Ok(previous)
}

fn restore_foreign_keys(connection: &Connection, previous: bool) -> Result<(), CatalogError> {
    set_foreign_keys(connection, previous)?;
    if previous {
        configure_connection(connection)?;
    }
    Ok(())
}

fn assert_foreign_key_check(connection: &Connection) -> Result<(), CatalogError> {
    let mut foreign_keys = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(unavailable)?;
    let mut rows = foreign_keys.query([]).map_err(unavailable)?;
    if rows.next().map_err(unavailable)?.is_some() {
        return Err(CatalogError::Integrity {
            message: "foreign key check failed after migration".into(),
        });
    }
    Ok(())
}

fn scan_from_database(
    id: i64,
    revision: i64,
    status: &str,
    failure_code: Option<&str>,
) -> Result<CatalogScan, CatalogError> {
    let id = u64::try_from(id)
        .ok()
        .and_then(|value| CatalogScanId::new(value).ok())
        .ok_or(CatalogError::InvalidStoredData { field: "scan_id" })?;
    let revision = u64::try_from(revision)
        .ok()
        .and_then(|value| CatalogScanRevision::new(value).ok())
        .ok_or(CatalogError::InvalidStoredData {
            field: "scan_revision",
        })?;
    let status = match status {
        "running" => CatalogScanStatus::Running,
        "completed" => CatalogScanStatus::Completed,
        "failed" => CatalogScanStatus::Failed,
        _ => {
            return Err(CatalogError::InvalidStoredData {
                field: "scan_status",
            })
        }
    };
    let failure_code = match failure_code {
        None => None,
        Some("SNAPSHOT_VALIDATION") => Some(CatalogFailureCode::SnapshotValidation),
        Some("PERSISTENCE") => Some(CatalogFailureCode::Persistence),
        Some(_) => {
            return Err(CatalogError::InvalidStoredData {
                field: "failure_code",
            })
        }
    };
    Ok(CatalogScan {
        id,
        revision,
        status,
        failure_code,
    })
}

fn failure_code_to_database(code: CatalogFailureCode) -> &'static str {
    match code {
        CatalogFailureCode::SnapshotValidation => "SNAPSHOT_VALIDATION",
        CatalogFailureCode::Persistence => "PERSISTENCE",
    }
}

fn scan_id_to_i64(scan_id: CatalogScanId) -> Result<i64, CatalogError> {
    i64::try_from(scan_id.get()).map_err(|_| CatalogError::InvalidScanId)
}

fn scan_revision_to_i64(revision: CatalogScanRevision) -> Result<i64, rusqlite::Error> {
    i64::try_from(revision.get())
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

fn unavailable(error: rusqlite::Error) -> CatalogError {
    CatalogError::Unavailable {
        message: error.to_string(),
    }
}

fn migration_error(version: u64, error: rusqlite::Error) -> CatalogError {
    CatalogError::Migration {
        version,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod migration_contract_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::RootId;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn database_path(directory: &TempDir, name: &str) -> PathBuf {
        directory.path().canonicalize().unwrap().join(name)
    }

    fn identity(hex_digit: char) -> CatalogRootIdentity {
        CatalogRootIdentity::new(format!("rootfp:v1:{}", hex_digit.to_string().repeat(64))).unwrap()
    }

    fn observation(hex_digit: char, name: &str) -> CatalogRootObservation {
        CatalogRootObservation {
            identity: identity(hex_digit),
            identity_is_stable: true,
            display_name: name.into(),
            observed_revision: 1,
        }
    }

    fn project(name: &str, path: &str) -> LibraryProject {
        LibraryProject {
            display_name: name.into(),
            relative_path: RootRelativePath::parse(path).unwrap(),
            has_project_file: true,
            has_saved_checkpoint: false,
            has_banks: true,
        }
    }

    fn populated_snapshot() -> LibrarySnapshot {
        LibrarySnapshot {
            sets: vec![LibrarySet {
                display_name: "ライブ・セット".into(),
                relative_path: RootRelativePath::parse("セット/ライブ").unwrap(),
                has_audio_pool: true,
                projects: vec![project("曲 α", "セット/ライブ/曲 α")],
            }],
            standalone_projects: vec![project("単独 β", "単独/β")],
            ..LibrarySnapshot::default()
        }
    }

    fn content_hash(hex_digit: char) -> ContentHash {
        ContentHash::parse(format!("sha256:{}", hex_digit.to_string().repeat(64))).unwrap()
    }

    fn file_instance(
        path: &str,
        hash_digit: char,
        byte_size: u64,
        modified_at_unix_ns: Option<i64>,
        storage_scope: SampleStorageScope,
    ) -> FileInstance {
        FileInstance {
            relative_path: RootRelativePath::parse(path).unwrap(),
            content_hash: content_hash(hash_digit),
            byte_size,
            modified_at_unix_ns,
            storage_scope,
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        }
    }

    fn snapshot_with_files(mut files: Vec<FileInstance>) -> LibrarySnapshot {
        files.sort_by(|left, right| {
            left.relative_path
                .as_str()
                .cmp(right.relative_path.as_str())
        });
        let mut assets = BTreeMap::new();
        for file in &files {
            assets
                .entry(file.content_hash.as_str().to_owned())
                .or_insert_with(|| AudioAsset {
                    content_hash: file.content_hash.clone(),
                    byte_size: file.byte_size,
                });
        }
        LibrarySnapshot {
            sets: vec![LibrarySet {
                display_name: "SET".into(),
                relative_path: RootRelativePath::parse("SET").unwrap(),
                has_audio_pool: true,
                projects: vec![project("PROJECT", "SET/PROJECT")],
            }],
            standalone_projects: vec![],
            audio_assets: assets.into_values().collect(),
            file_instances: files,
            ..LibrarySnapshot::default()
        }
    }

    fn snapshot_with_usage_graph() -> LibrarySnapshot {
        let target = file_instance(
            "SET/AUDIO/kick.wav",
            'a',
            4,
            Some(1),
            SampleStorageScope::SetAudioPool,
        );
        let mut snapshot = snapshot_with_files(vec![target.clone()]);
        let project_document = RootRelativePath::parse("SET/PROJECT/project.work").unwrap();
        let bank_document = RootRelativePath::parse("SET/PROJECT/bank01.work").unwrap();
        let provenance = ParserProvenance {
            parser_name: "masterocta/ot-tools-io".into(),
            parser_revision: "fixture-revision".into(),
            source_version: Some("1.40A".into()),
            compatibility_evidence: Some(ProjectCompatibilityEvidence::UpstreamLibrary),
        };
        snapshot.state_documents = vec![
            StateDocument {
                project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
                source_relative_path: bank_document.clone(),
                kind: StateDocumentKind::Bank,
                role: StateDocumentRole::Working,
                bank_index: Some(0),
                parse_status: StateDocumentParseStatus::Parsed,
                parser_provenance: ParserProvenance {
                    source_version: Some("bank:23".into()),
                    compatibility_evidence: None,
                    ..provenance.clone()
                },
            },
            StateDocument {
                project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
                source_relative_path: project_document.clone(),
                kind: StateDocumentKind::Project,
                role: StateDocumentRole::Working,
                bank_index: None,
                parse_status: StateDocumentParseStatus::Parsed,
                parser_provenance: provenance,
            },
        ];
        let assignment = SlotAssignment {
            project_document_relative_path: project_document.clone(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(target.relative_path.clone()),
            reference_status: SampleReferenceStatus::Resolved,
        };
        snapshot.slot_assignments = vec![assignment.clone()];
        snapshot.usage_edges = vec![SampleUsageEdge {
            bank_document_relative_path: bank_document,
            project_document_relative_path: project_document,
            slot: assignment.slot,
            usage_kind: SampleUsageKind::Machine,
            track_index: 0,
            part_index: Some(0),
            pattern_index: None,
            step_index: None,
            audible: true,
            referenced_file_relative_path: assignment.referenced_file_relative_path,
            reference_status: assignment.reference_status,
        }];
        snapshot
    }

    fn snapshot_with_sample_settings() -> LibrarySnapshot {
        let mut snapshot = snapshot_with_usage_graph();
        let project_document = RootRelativePath::parse("SET/PROJECT/project.work").unwrap();
        let audio_file = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let provenance = ParserProvenance {
            parser_name: "masterocta/ot-tools-io".into(),
            parser_revision: "fixture-revision".into(),
            source_version: Some("1.40A".into()),
            compatibility_evidence: None,
        };
        snapshot.sample_settings = vec![
            SampleSettings {
                owner: SampleSettingsOwner::SlotAssignment,
                source_relative_path: project_document.clone(),
                marker_source_relative_path: Some(
                    RootRelativePath::parse("SET/PROJECT/markers.work").unwrap(),
                ),
                project_document_relative_path: Some(project_document.clone()),
                slot: Some(SampleSlotId::new(SampleSlotKind::Static, 1).unwrap()),
                file_instance_relative_path: None,
                parse_status: SampleSettingsParseStatus::Parsed,
                parser_provenance: provenance.clone(),
                source_os_version: Some("1.40A".into()),
                evidence: SampleSettingsEvidence::ReproducedFixtureObservation,
                gain: Some(48),
                tempo_x24: Some(2880),
                trim_bars_x100: Some(400),
                loop_bars_x100: None,
                stretch_mode: Some(2),
                loop_mode: Some(0),
                trig_quantization: Some(-1),
                trim_start: Some(0),
                trim_end: Some(1000),
                loop_start: Some(0),
                slices: vec![SampleSlice {
                    index: 0,
                    trim_start: 0,
                    trim_end: 1000,
                    loop_start: u32::MAX,
                }],
            },
            SampleSettings {
                owner: SampleSettingsOwner::FileInstanceSidecar,
                source_relative_path: RootRelativePath::parse("SET/AUDIO/kick.ot").unwrap(),
                marker_source_relative_path: None,
                project_document_relative_path: None,
                slot: None,
                file_instance_relative_path: Some(audio_file),
                parse_status: SampleSettingsParseStatus::Parsed,
                parser_provenance: ParserProvenance {
                    source_version: Some("sample-settings:2".into()),
                    ..provenance
                },
                source_os_version: None,
                evidence: SampleSettingsEvidence::LegacyImplementationObservation,
                gain: Some(48),
                tempo_x24: Some(2880),
                trim_bars_x100: Some(400),
                loop_bars_x100: Some(400),
                stretch_mode: Some(2),
                loop_mode: Some(0),
                trig_quantization: Some(255),
                trim_start: Some(0),
                trim_end: Some(1000),
                loop_start: Some(0),
                slices: vec![],
            },
        ];
        snapshot
    }

    fn open_temp_catalog() -> (TempDir, std::path::PathBuf, SqliteCatalog) {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "catalog.sqlite3");
        let catalog = SqliteCatalog::open(&path).unwrap();
        (directory, path, catalog)
    }

    #[test]
    fn fresh_database_migrates_once_and_reopens_cleanly() {
        let (directory, path, catalog) = open_temp_catalog();
        let count: i64 = catalog
            .connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, LATEST_SCHEMA_VERSION as i64);
        drop(catalog);

        let reopened = SqliteCatalog::open(&path).unwrap();
        let count: i64 = reopened
            .connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, LATEST_SCHEMA_VERSION as i64);
        drop(reopened);
        drop(directory);
    }

    #[test]
    fn schema_v1_database_migrates_to_latest_without_losing_existing_projection() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v1.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migration(&mut connection, 1, MIGRATIONS[0].1).unwrap();
        connection
            .execute_batch(
                "INSERT INTO roots \
                   (id, fingerprint, identity_is_stable, display_name, last_observed_revision, \
                    last_observed_at, latest_completed_scan_revision) \
                 VALUES (1, 'rootfp:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', \
                         1, 'Existing', 1, 'now', 1); \
                 INSERT INTO scan_sessions \
                   (id, root_id, revision, status, started_at, completed_at) \
                 VALUES (1, 1, 1, 'completed', 'now', 'now'); \
                 INSERT INTO sets \
                   (root_id, scan_session_id, relative_path, display_name, has_audio_pool, sort_order) \
                 VALUES (1, 1, 'SET', 'Existing Set', 1, 0); \
                 INSERT INTO projects \
                   (root_id, scan_session_id, relative_path, display_name, is_standalone, \
                    parent_set_relative_path, has_project_file, has_banks, sort_order) \
                 VALUES (1, 1, 'SET/PROJECT', 'Existing Project', 0, 'SET', 1, 1, 0);",
            )
            .unwrap();
        drop(connection);

        let catalog = SqliteCatalog::open(&path).unwrap();
        let snapshot = catalog
            .load_latest_snapshot(&identity('a'))
            .unwrap()
            .unwrap();
        let versions: i64 = catalog
            .connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(versions, LATEST_SCHEMA_VERSION as i64);
        assert_eq!(snapshot.sets[0].display_name, "Existing Set");
        assert_eq!(
            snapshot.sets[0].projects[0].display_name,
            "Existing Project"
        );
        assert!(snapshot.file_instances.is_empty());
        assert!(!catalog
            .observational_projection_untrusted(&identity('a'))
            .unwrap());
    }

    #[test]
    fn unknown_newer_schema_version_is_rejected() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "future.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(&format!(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); \
                 INSERT INTO schema_migrations VALUES ({}, 'future');",
                LATEST_SCHEMA_VERSION + 1
            ))
            .unwrap();
        drop(connection);

        let error = SqliteCatalog::open(path).err().unwrap();
        assert_eq!(
            error,
            CatalogError::UnsupportedSchema {
                found: LATEST_SCHEMA_VERSION + 1,
                supported: LATEST_SCHEMA_VERSION,
            }
        );
    }

    fn apply_migrations_through_version(connection: &mut Connection, version: u64) {
        for (migration_version, sql) in MIGRATIONS {
            if *migration_version <= version {
                apply_migration(connection, *migration_version, sql).unwrap();
            }
        }
    }

    fn insert_populated_v7_projection(connection: &Connection) {
        let root_fingerprint =
            "rootfp:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let content_hash = format!("sha256:{}", "c".repeat(64));
        connection
            .execute_batch(&format!(
                "INSERT INTO roots \
                   (id, fingerprint, identity_is_stable, display_name, last_observed_revision, \
                    last_observed_at, latest_completed_scan_revision) \
                 VALUES (1, '{root_fingerprint}', \
                         1, 'V7 Root', 1, 'now', 1); \
                 INSERT INTO scan_sessions \
                   (id, root_id, revision, status, started_at, completed_at) \
                 VALUES (1, 1, 1, 'completed', 'now', 'now'); \
                 INSERT INTO sets \
                   (root_id, scan_session_id, relative_path, display_name, has_audio_pool, sort_order) \
                 VALUES (1, 1, 'SET', 'Set', 1, 0); \
                 INSERT INTO projects \
                   (root_id, scan_session_id, relative_path, display_name, is_standalone, \
                    parent_set_relative_path, has_project_file, has_banks, sort_order) \
                 VALUES (1, 1, 'SET/PROJECT', 'Project', 0, 'SET', 1, 1, 0); \
                 INSERT INTO audio_assets (id, content_hash, byte_size) \
                 VALUES (1, '{content_hash}', 4); \
                 INSERT INTO file_instances \
                   (id, root_id, scan_session_id, relative_path, audio_asset_id, byte_size, \
                    modified_at_unix_ns, storage_scope, hash_freshness) \
                 VALUES (1, 1, 1, 'SET/AUDIO/kick.wav', 1, 4, 1, 'set_audio_pool', 'computed_this_scan'); \
                 INSERT INTO state_documents \
                   (id, root_id, scan_session_id, project_relative_path, source_relative_path, \
                    document_kind, document_role, bank_index, parse_status, parser_name, \
                    parser_revision, source_version) \
                 VALUES \
                   (1, 1, 1, 'SET/PROJECT', 'SET/PROJECT/project.work', 'project', 'working', NULL, \
                    'parsed', 'masterocta/ot-codec-project', 'v1', '1.40'), \
                   (2, 1, 1, 'SET/PROJECT', 'SET/PROJECT/bank01.work', 'bank', 'working', 0, \
                    'parsed', 'masterocta/bank-validation', 'v1', 'bank:23'); \
                 INSERT INTO slot_assignments \
                   (id, state_document_id, slot_kind, slot_number, referenced_relative_path, reference_status) \
                 VALUES (1, 1, 'static', 1, 'SET/AUDIO/kick.wav', 'resolved'); \
                 INSERT INTO usage_edges \
                   (id, state_document_id, project_document_id, slot_assignment_id, slot_kind, slot_number, \
                    usage_kind, track_index, part_index, pattern_index, step_index, audible, \
                    referenced_relative_path, reference_status) \
                 VALUES (1, 2, 1, 1, 'static', 1, 'machine', 0, 0, NULL, NULL, 1, \
                         'SET/AUDIO/kick.wav', 'resolved'); \
                 INSERT INTO sample_settings \
                   (id, root_id, scan_session_id, owner_kind, source_relative_path, slot_assignment_id, \
                    parse_status, parser_name, parser_revision, evidence, gain) \
                 VALUES (1, 1, 1, 'slot_assignment', 'SET/PROJECT/project.work', 1, 'parsed', \
                         'masterocta/sample-settings', 'v1', 'legacy_implementation_observation', 48); \
                 INSERT INTO sample_slices \
                   (sample_settings_id, slice_index, trim_start, trim_end, loop_start) \
                 VALUES (1, 0, 0, 1000, 0); \
                 INSERT INTO tags (id, name, created_at) VALUES (1, 'kick-tag', 'now'); \
                 INSERT INTO tag_assignments (audio_asset_id, tag_id, source, assigned_at) \
                 VALUES (1, 1, 'user', 'now'); \
                 INSERT INTO notes (audio_asset_id, body, source, created_at, updated_at) \
                 VALUES (1, 'manual note', 'user', 'now', 'now');"
            ))
            .unwrap();
    }

    #[test]
    fn schema_v7_database_migrates_to_latest_without_losing_projection_data() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v7-populated.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 7);
        insert_populated_v7_projection(&connection);
        drop(connection);

        let catalog = SqliteCatalog::open(&path).unwrap();
        let counts: (i64, i64, i64, i64, i64, i64, i64) = catalog
            .connection
            .query_row(
                "SELECT \
                    (SELECT COUNT(*) FROM slot_assignments), \
                    (SELECT COUNT(*) FROM usage_edges), \
                    (SELECT COUNT(*) FROM sample_settings), \
                    (SELECT COUNT(*) FROM sample_slices), \
                    (SELECT COUNT(*) FROM tag_assignments), \
                    (SELECT COUNT(*) FROM notes), \
                    (SELECT COUNT(*) FROM schema_migrations)",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(counts, (1, 1, 1, 1, 1, 1, LATEST_SCHEMA_VERSION as i64));
        let slot_path: String = catalog
            .connection
            .query_row(
                "SELECT referenced_relative_path FROM slot_assignments WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(slot_path, "SET/AUDIO/kick.wav");
        assert!(!catalog
            .observational_projection_untrusted(&identity('b'))
            .unwrap());
    }

    #[test]
    fn existing_v9_database_marks_projection_untrusted_until_rescan() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v9-existing.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 9);
        let root_fingerprint = format!("rootfp:v1:{}", "d".repeat(64));
        connection
            .execute_batch(&format!(
                "INSERT INTO roots \
                   (id, fingerprint, identity_is_stable, display_name, last_observed_revision, \
                    last_observed_at, latest_completed_scan_revision) \
                 VALUES (1, '{root_fingerprint}', \
                         1, 'V9 Root', 1, 'now', 1);"
            ))
            .unwrap();
        drop(connection);

        let catalog = SqliteCatalog::open(&path).unwrap();
        assert!(catalog
            .observational_projection_untrusted(&identity('d'))
            .unwrap());
    }

    fn insert_trusted_v10_root(connection: &Connection, hex_digit: char) {
        let root_fingerprint = format!("rootfp:v1:{}", hex_digit.to_string().repeat(64));
        connection
            .execute_batch(&format!(
                "INSERT INTO roots \
                   (id, fingerprint, identity_is_stable, display_name, last_observed_revision, \
                    last_observed_at, latest_completed_scan_revision, \
                    observational_projection_untrusted) \
                 VALUES (1, '{root_fingerprint}', \
                         1, 'Trusted Root', 1, 'now', 1, 0);"
            ))
            .unwrap();
    }

    fn repair_applied_flag(connection: &Connection) -> i64 {
        connection
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM catalog_meta WHERE key = ?1",
                params![PROJECTION_REPAIR_META_KEY],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn existing_v10_database_marks_projection_untrusted_once_on_upgrade() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v10-trusted.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 10);
        insert_trusted_v10_root(&connection, 'e');
        drop(connection);

        let catalog = SqliteCatalog::open(&path).unwrap();
        assert!(catalog
            .observational_projection_untrusted(&identity('e'))
            .unwrap());
        assert_eq!(repair_applied_flag(&catalog.connection), 1);
        drop(catalog);

        let reopened = SqliteCatalog::open(&path).unwrap();
        assert!(reopened
            .observational_projection_untrusted(&identity('e'))
            .unwrap());
        assert_eq!(repair_applied_flag(&reopened.connection), 1);
    }

    #[test]
    fn projection_repair_rescan_and_reopen_preserves_trust() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v10-rescan-trust.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 10);
        insert_trusted_v10_root(&connection, 'f');
        drop(connection);

        let mut catalog = SqliteCatalog::open(&path).unwrap();
        assert!(catalog
            .observational_projection_untrusted(&identity('f'))
            .unwrap());
        catalog
            .store_snapshot(&observation('f', "Rescanned"), &populated_snapshot())
            .unwrap();
        assert!(!catalog
            .observational_projection_untrusted(&identity('f'))
            .unwrap());
        drop(catalog);

        for _ in 0..2 {
            let reopened = SqliteCatalog::open(&path).unwrap();
            assert!(!reopened
                .observational_projection_untrusted(&identity('f'))
                .unwrap());
        }
    }

    #[test]
    fn projection_repair_untrusts_roots_independently() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v10-ab-independent.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 10);
        let identity_a = identity('a');
        let identity_b = identity('b');
        let fp_a = identity_a.as_str();
        let fp_b = identity_b.as_str();
        connection
            .execute_batch(&format!(
                "INSERT INTO roots \
                   (id, fingerprint, identity_is_stable, display_name, last_observed_revision, \
                    last_observed_at, latest_completed_scan_revision, \
                    observational_projection_untrusted) \
                 VALUES \
                   (1, '{fp_a}', 1, 'Root A', 1, 'now', 1, 0), \
                   (2, '{fp_b}', 1, 'Root B', 1, 'now', 1, 0);"
            ))
            .unwrap();
        drop(connection);

        let mut catalog = SqliteCatalog::open(&path).unwrap();
        assert!(catalog
            .observational_projection_untrusted(&identity('a'))
            .unwrap());
        assert!(catalog
            .observational_projection_untrusted(&identity('b'))
            .unwrap());
        catalog
            .store_snapshot(&observation('a', "Root A"), &populated_snapshot())
            .unwrap();
        assert!(!catalog
            .observational_projection_untrusted(&identity('a'))
            .unwrap());
        assert!(catalog
            .observational_projection_untrusted(&identity('b'))
            .unwrap());
    }

    #[test]
    fn projection_repair_failure_can_be_retried_on_reopen() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "v10-repair-retry.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 10);
        insert_trusted_v10_root(&connection, 'c');
        drop(connection);

        let migration_11 = include_str!("../migrations/0011_projection_trust_repair.sql");
        let failing_sql = format!("{migration_11}\nTHIS IS NOT SQL;");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        let error =
            apply_migration_11_with_projection_repair(&mut connection, 11, &failing_sql, 10)
                .unwrap_err();
        assert!(matches!(error, CatalogError::Migration { version: 11, .. }));
        assert_eq!(max_schema_version(&connection), 10);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'catalog_meta'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        drop(connection);

        let catalog = SqliteCatalog::open(&path).unwrap();
        assert!(catalog
            .observational_projection_untrusted(&identity('c'))
            .unwrap());
        assert_eq!(repair_applied_flag(&catalog.connection), 1);
    }

    #[test]
    fn foreign_keys_are_restored_after_migration_0008() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "fk-restore.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 7);
        insert_populated_v7_projection(&connection);
        drop(connection);

        let catalog = SqliteCatalog::open(&path).unwrap();
        let enabled: bool = catalog
            .connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        assert!(enabled);
        let mut foreign_keys = catalog
            .connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap();
        assert!(foreign_keys.query([]).unwrap().next().unwrap().is_none());
    }

    fn foreign_keys_enabled(connection: &Connection) -> bool {
        connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap()
    }

    fn max_schema_version(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn slot_assignment_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM slot_assignments", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[test]
    fn migration_8_success_restores_foreign_keys_after_outside_transaction_toggle() {
        let mut connection = Connection::open_in_memory().unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 7);
        insert_populated_v7_projection(&connection);

        assert!(foreign_keys_enabled(&connection));
        assert_eq!(max_schema_version(&connection), 7);
        let assignments_before = slot_assignment_count(&connection);
        assert_eq!(assignments_before, 1);

        let migration_8 = include_str!("../migrations/0008_reference_ambiguous.sql");
        apply_migration(&mut connection, 8, migration_8).unwrap();

        assert!(foreign_keys_enabled(&connection));
        assert_eq!(max_schema_version(&connection), 8);
        assert_eq!(slot_assignment_count(&connection), assignments_before);
        let mut foreign_keys = connection.prepare("PRAGMA foreign_key_check").unwrap();
        assert!(foreign_keys.query([]).unwrap().next().unwrap().is_none());
    }

    #[test]
    fn migration_8_failure_restores_foreign_keys_and_preserves_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 7);
        insert_populated_v7_projection(&connection);

        assert!(foreign_keys_enabled(&connection));
        assert_eq!(max_schema_version(&connection), 7);
        let assignments_before = slot_assignment_count(&connection);

        let migration_8 = include_str!("../migrations/0008_reference_ambiguous.sql");
        let failing_sql = format!("{migration_8}\nTHIS IS NOT SQL;");
        let error = apply_migration(&mut connection, 8, &failing_sql).unwrap_err();
        assert!(matches!(error, CatalogError::Migration { version: 8, .. }));

        assert!(foreign_keys_enabled(&connection));
        assert_eq!(max_schema_version(&connection), 7);
        assert_eq!(slot_assignment_count(&connection), assignments_before);
    }

    #[test]
    fn migration_8_foreign_key_check_blocks_commit_and_preserves_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        configure_connection(&connection).unwrap();
        apply_migrations_through_version(&mut connection, 7);
        insert_populated_v7_projection(&connection);

        assert!(foreign_keys_enabled(&connection));
        assert_eq!(max_schema_version(&connection), 7);

        let migration_8 = include_str!("../migrations/0008_reference_ambiguous.sql");
        let orphan_insert = "
INSERT INTO slot_assignments (
    id, state_document_id, slot_kind, slot_number,
    referenced_relative_path, reference_status
) VALUES (99999, 99999, 'static', 99, 'SET/AUDIO/orphan.wav', 'resolved');";
        let violating_sql = format!("{migration_8}{orphan_insert}");
        let error = apply_migration(&mut connection, 8, &violating_sql).unwrap_err();
        assert!(matches!(
            error,
            CatalogError::Migration { version: 8, .. } | CatalogError::Integrity { .. }
        ));

        assert!(foreign_keys_enabled(&connection));
        assert_eq!(max_schema_version(&connection), 7);
        let orphan_exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM slot_assignments WHERE id = 99999)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!orphan_exists);
        assert_eq!(slot_assignment_count(&connection), 1);
    }

    #[cfg(unix)]
    #[test]
    fn database_symlinks_are_rejected_by_sqlite_open_flags() {
        use std::os::unix::fs::symlink;

        let directory = TempDir::new().unwrap();
        let target = database_path(&directory, "target.sqlite3");
        let link = database_path(&directory, "catalog.sqlite3");
        Connection::open(&target).unwrap();
        symlink(&target, &link).unwrap();

        let error = SqliteCatalog::open(link).err().unwrap();

        assert!(matches!(error, CatalogError::Unavailable { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn database_parent_symlinks_are_rejected_without_creating_an_outside_file() {
        use std::os::unix::fs::symlink;

        let container = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let linked_parent = database_path(&container, "catalog-parent");
        symlink(outside.path().canonicalize().unwrap(), &linked_parent).unwrap();

        let error = SqliteCatalog::open(linked_parent.join("catalog.sqlite3"))
            .err()
            .unwrap();

        assert!(matches!(error, CatalogError::Unavailable { .. }));
        assert!(!outside.path().join("catalog.sqlite3").exists());
    }

    #[test]
    fn failed_migration_rolls_back_every_schema_change() {
        let mut connection = Connection::open_in_memory().unwrap();
        configure_connection(&connection).unwrap();

        let error = apply_migration(
            &mut connection,
            1,
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT); \
             CREATE TABLE half_applied (id INTEGER); \
             THIS IS NOT SQL;",
        )
        .unwrap_err();

        assert!(matches!(error, CatalogError::Migration { version: 1, .. }));
        for table in ["schema_migrations", "half_applied"] {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(!exists);
        }
    }

    #[test]
    fn migrated_database_passes_foreign_key_and_integrity_checks() {
        let (_directory, _path, catalog) = open_temp_catalog();
        let mut foreign_keys = catalog
            .connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap();
        assert!(foreign_keys.query([]).unwrap().next().unwrap().is_none());
        let integrity: String = catalog
            .connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
    }

    #[test]
    fn state_documents_slots_and_usage_graph_round_trip_after_reopen() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "state-graph.sqlite3");
        let observation = observation('a', "State graph");
        let snapshot = snapshot_with_usage_graph();
        let mut catalog = SqliteCatalog::open(&path).unwrap();

        catalog.store_snapshot(&observation, &snapshot).unwrap();
        drop(catalog);

        let reopened = SqliteCatalog::open(&path).unwrap();
        assert_eq!(
            reopened
                .load_latest_snapshot(&observation.identity)
                .unwrap(),
            Some(snapshot)
        );
        let counts: (i64, i64, i64) = reopened
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM state_documents), \
                        (SELECT COUNT(*) FROM slot_assignments), \
                        (SELECT COUNT(*) FROM usage_edges)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(counts, (2, 1, 1));
    }

    #[test]
    fn slot_local_and_sidecar_settings_with_slices_round_trip_after_reopen() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "sample-settings.sqlite3");
        let observation = observation('7', "Sample settings");
        let snapshot = snapshot_with_sample_settings();
        let mut catalog = SqliteCatalog::open(&path).unwrap();

        catalog.store_snapshot(&observation, &snapshot).unwrap();
        drop(catalog);

        let reopened = SqliteCatalog::open(&path).unwrap();
        assert_eq!(
            reopened
                .load_latest_snapshot(&observation.identity)
                .unwrap(),
            Some(snapshot)
        );
        let counts: (i64, i64) = reopened
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM sample_settings), \
                        (SELECT COUNT(*) FROM sample_slices)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (2, 1));
    }

    #[test]
    fn rescan_with_unchanged_file_sidecar_settings_replaces_stale_projection() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('7', "Rescan sidecar");
        let snapshot = snapshot_with_sample_settings();

        catalog.store_snapshot(&observation, &snapshot).unwrap();
        let rescan = catalog.store_snapshot(&observation, &snapshot).unwrap();

        assert_eq!(rescan.revision.get(), 2);
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(snapshot)
        );
        let sidecar_count: i64 = catalog
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sample_settings \
                 WHERE owner_kind = 'file_instance_sidecar'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sidecar_count, 1);
    }

    #[test]
    fn sample_settings_owner_cannot_cross_root_or_scan_scope() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let first_observation = observation('7', "First settings root");
        let second_observation = observation('8', "Second settings root");
        let snapshot = snapshot_with_sample_settings();
        catalog
            .store_snapshot(&first_observation, &snapshot)
            .unwrap();
        catalog
            .store_snapshot(&second_observation, &snapshot)
            .unwrap();
        let first_root_id: i64 = catalog
            .connection
            .query_row(
                "SELECT id FROM roots WHERE fingerprint = ?1",
                [first_observation.identity.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        let second_root_id: i64 = catalog
            .connection
            .query_row(
                "SELECT id FROM roots WHERE fingerprint = ?1",
                [second_observation.identity.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        let foreign_slot_assignment_id: i64 = catalog
            .connection
            .query_row(
                "SELECT slot_assignments.id FROM slot_assignments \
                 JOIN state_documents \
                   ON state_documents.id = slot_assignments.state_document_id \
                 WHERE state_documents.root_id = ?1",
                [second_root_id],
                |row| row.get(0),
            )
            .unwrap();
        let foreign_file_instance_id: i64 = catalog
            .connection
            .query_row(
                "SELECT id FROM file_instances WHERE root_id = ?1 LIMIT 1",
                [second_root_id],
                |row| row.get(0),
            )
            .unwrap();

        let slot_error = catalog.connection.execute(
            "UPDATE sample_settings SET slot_assignment_id = ?1 \
             WHERE root_id = ?2 AND owner_kind = 'slot_assignment'",
            params![foreign_slot_assignment_id, first_root_id],
        );
        let file_error = catalog.connection.execute(
            "UPDATE sample_settings SET file_instance_id = ?1 \
             WHERE root_id = ?2 AND owner_kind = 'file_instance_sidecar'",
            params![foreign_file_instance_id, first_root_id],
        );

        assert!(slot_error.is_err());
        assert!(file_error.is_err());
        assert_eq!(
            catalog
                .load_latest_snapshot(&first_observation.identity)
                .unwrap(),
            Some(snapshot)
        );
    }

    #[test]
    fn sample_settings_failure_preserves_previous_successful_projection() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('8', "Settings rollback");
        let previous = snapshot_with_sample_settings();
        catalog.store_snapshot(&observation, &previous).unwrap();
        catalog
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_sample_slice BEFORE INSERT ON sample_slices \
                 BEGIN SELECT RAISE(ABORT, 'sample slice fault'); END;",
            )
            .unwrap();

        let error = catalog
            .store_snapshot(&observation, &snapshot_with_sample_settings())
            .unwrap_err();

        assert!(matches!(error, CatalogError::Unavailable { .. }));
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(previous)
        );
        let latest = catalog.latest_scan(&observation.identity).unwrap().unwrap();
        assert_eq!(latest.status, CatalogScanStatus::Failed);
        assert_eq!(latest.failure_code, Some(CatalogFailureCode::Persistence));
    }

    #[test]
    fn duplicate_state_document_identity_is_rejected() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('d', "Duplicate state document");
        let mut snapshot = snapshot_with_usage_graph();
        let mut duplicate = snapshot
            .state_documents
            .iter()
            .find(|document| document.kind == StateDocumentKind::Project)
            .unwrap()
            .clone();
        duplicate.source_relative_path =
            RootRelativePath::parse("SET/PROJECT/project-copy.work").unwrap();
        snapshot.state_documents.push(duplicate);

        let error = catalog.store_snapshot(&observation, &snapshot).unwrap_err();

        assert!(matches!(error, CatalogError::Integrity { .. }));
        assert_eq!(
            catalog
                .latest_scan(&observation.identity)
                .unwrap()
                .unwrap()
                .status,
            CatalogScanStatus::Failed
        );
    }

    #[test]
    fn duplicate_usage_coordinate_is_rejected() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('e', "Duplicate usage coordinate");
        let mut snapshot = snapshot_with_usage_graph();
        snapshot.usage_edges.push(snapshot.usage_edges[0].clone());

        let error = catalog.store_snapshot(&observation, &snapshot).unwrap_err();

        assert!(matches!(error, CatalogError::Integrity { .. }));
        assert_eq!(
            catalog
                .latest_scan(&observation.identity)
                .unwrap()
                .unwrap()
                .status,
            CatalogScanStatus::Failed
        );
    }

    #[test]
    fn usage_edge_project_document_cannot_be_removed() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('f', "Required project document");
        catalog
            .store_snapshot(&observation, &snapshot_with_usage_graph())
            .unwrap();

        let result = catalog
            .connection
            .execute("UPDATE usage_edges SET project_document_id = NULL", []);

        assert!(result.is_err());
        assert!(catalog
            .load_latest_snapshot(&observation.identity)
            .unwrap()
            .is_some());
    }

    #[test]
    fn corrupted_state_document_location_fails_closed_on_load() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('c', "Corrupted state path");
        catalog
            .store_snapshot(&observation, &snapshot_with_usage_graph())
            .unwrap();
        catalog
            .connection
            .execute(
                "UPDATE state_documents SET source_relative_path = 'SET/OTHER/bank01.work' \
                 WHERE document_kind = 'bank'",
                [],
            )
            .unwrap();

        let error = catalog
            .load_latest_snapshot(&observation.identity)
            .unwrap_err();

        assert!(matches!(error, CatalogError::Integrity { .. }));
    }

    #[test]
    fn usage_graph_failure_rolls_back_to_previous_successful_projection() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('b', "State rollback");
        let previous = snapshot_with_usage_graph();
        catalog.store_snapshot(&observation, &previous).unwrap();
        catalog
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_usage_graph BEFORE INSERT ON usage_edges \
                 BEGIN SELECT RAISE(ABORT, 'usage graph fault'); END;",
            )
            .unwrap();

        let error = catalog.store_snapshot(&observation, &previous).unwrap_err();

        assert!(matches!(error, CatalogError::Unavailable { .. }));
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(previous)
        );
        let latest = catalog.latest_scan(&observation.identity).unwrap().unwrap();
        assert_eq!(latest.status, CatalogScanStatus::Failed);
        assert_eq!(latest.failure_code, Some(CatalogFailureCode::Persistence));
    }

    #[test]
    fn set_and_standalone_projects_round_trip_with_unicode() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('a', "OCTATRACK");
        let snapshot = populated_snapshot();

        let scan = catalog.store_snapshot(&observation, &snapshot).unwrap();
        let loaded = catalog.load_latest_snapshot(&observation.identity).unwrap();

        assert_eq!(scan.status, CatalogScanStatus::Completed);
        assert_eq!(scan.revision.get(), 1);
        assert_eq!(loaded, Some(snapshot));
    }

    #[test]
    fn repeated_root_observation_updates_catalog_metadata_without_a_session_id() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let mut observed = observation('3', "Initial");
        catalog.observe_root(&observed).unwrap();
        observed.identity_is_stable = false;
        observed.display_name = "Updated".into();
        observed.observed_revision = 9;

        catalog.observe_root(&observed).unwrap();

        let stored: (bool, String, i64) = catalog
            .connection
            .query_row(
                "SELECT identity_is_stable, display_name, last_observed_revision \
                 FROM roots WHERE fingerprint = ?1",
                params![observed.identity.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored, (false, "Updated".into(), 9));
        assert_eq!(
            catalog.load_latest_snapshot(&observed.identity).unwrap(),
            None
        );
    }

    #[test]
    fn empty_snapshot_is_a_successful_latest_snapshot() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('b', "Empty");

        catalog
            .store_snapshot(&observation, &LibrarySnapshot::default())
            .unwrap();

        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(LibrarySnapshot::default())
        );
    }

    #[test]
    fn replacement_removes_stale_sets_and_projects() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('c', "Replacement");
        catalog
            .store_snapshot(&observation, &populated_snapshot())
            .unwrap();
        let replacement = LibrarySnapshot {
            sets: vec![],
            standalone_projects: vec![project("Only current", "CURRENT")],
            ..LibrarySnapshot::default()
        };

        let scan = catalog.store_snapshot(&observation, &replacement).unwrap();

        assert_eq!(scan.revision.get(), 2);
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(replacement)
        );
        let stale_count: i64 = catalog
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sets WHERE relative_path = ?1",
                params!["セット/ライブ"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale_count, 0);
    }

    #[test]
    fn different_root_identities_never_mix_snapshots() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let first = observation('d', "First");
        let second = observation('e', "Second");
        let first_snapshot = LibrarySnapshot {
            sets: vec![],
            standalone_projects: vec![project("First", "FIRST")],
            ..LibrarySnapshot::default()
        };
        let second_snapshot = LibrarySnapshot {
            sets: vec![],
            standalone_projects: vec![project("Second", "SECOND")],
            ..LibrarySnapshot::default()
        };

        catalog.store_snapshot(&first, &first_snapshot).unwrap();
        catalog.store_snapshot(&second, &second_snapshot).unwrap();

        assert_eq!(
            catalog.load_latest_snapshot(&first.identity).unwrap(),
            Some(first_snapshot)
        );
        assert_eq!(
            catalog.load_latest_snapshot(&second.identity).unwrap(),
            Some(second_snapshot)
        );
    }

    #[test]
    fn duplicate_relative_paths_are_rejected_and_recorded_as_failed() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('f', "Duplicates");
        catalog
            .store_snapshot(&observation, &LibrarySnapshot::default())
            .unwrap();
        let duplicate = project("Duplicate", "SAME");
        let snapshot = LibrarySnapshot {
            sets: vec![LibrarySet {
                display_name: "Same".into(),
                relative_path: RootRelativePath::parse("SAME").unwrap(),
                has_audio_pool: false,
                projects: vec![],
            }],
            standalone_projects: vec![duplicate],
            ..LibrarySnapshot::default()
        };

        let error = catalog.store_snapshot(&observation, &snapshot).unwrap_err();

        assert!(matches!(error, CatalogError::DuplicateRelativePath(_)));
        assert_eq!(
            catalog.latest_scan(&observation.identity).unwrap(),
            Some(CatalogScan {
                id: CatalogScanId::new(2).unwrap(),
                revision: CatalogScanRevision::new(2).unwrap(),
                status: CatalogScanStatus::Failed,
                failure_code: Some(CatalogFailureCode::SnapshotValidation),
            })
        );
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(LibrarySnapshot::default())
        );
    }

    #[test]
    fn failed_replacement_preserves_the_previous_successful_snapshot() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('1', "Rollback");
        let previous = populated_snapshot();
        catalog.store_snapshot(&observation, &previous).unwrap();
        catalog
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_test_project \
                 BEFORE INSERT ON projects \
                 WHEN NEW.display_name = 'FAIL' \
                 BEGIN SELECT RAISE(ABORT, 'test constraint'); END;",
            )
            .unwrap();
        let failing = LibrarySnapshot {
            sets: vec![],
            standalone_projects: vec![project("FAIL", "NEW")],
            ..LibrarySnapshot::default()
        };

        let error = catalog.store_snapshot(&observation, &failing).unwrap_err();

        assert!(matches!(error, CatalogError::Unavailable { .. }));
        let latest_scan = catalog.latest_scan(&observation.identity).unwrap().unwrap();
        assert_eq!(latest_scan.revision.get(), 2);
        assert_eq!(latest_scan.status, CatalogScanStatus::Failed);
        assert_eq!(
            latest_scan.failure_code,
            Some(CatalogFailureCode::Persistence)
        );
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(previous)
        );
    }

    #[test]
    fn catalog_never_persists_fixture_absolute_paths_or_session_root_ids() {
        let fixture = TempDir::new().unwrap();
        let fixture_file = fixture.path().join("SET/PROJECT/project.work");
        fs::create_dir_all(fixture_file.parent().unwrap()).unwrap();
        fs::write(&fixture_file, b"read-only fixture bytes").unwrap();
        let before = fs::read(&fixture_file).unwrap();
        let session_root_id = RootId::new("root-session-authority").unwrap();
        let (_database_directory, database_path, mut catalog) = open_temp_catalog();
        let observation = observation('2', "Safe catalog");
        let snapshot = snapshot_with_files(vec![file_instance(
            "SET/PROJECT/audio.wav",
            'a',
            16,
            Some(1),
            SampleStorageScope::ProjectLocal,
        )]);

        catalog.store_snapshot(&observation, &snapshot).unwrap();
        drop(catalog);

        assert_eq!(fs::read(&fixture_file).unwrap(), before);
        let database = fs::read(database_path).unwrap();
        let absolute_path = fixture.path().to_string_lossy();
        assert!(!contains_bytes(&database, absolute_path.as_bytes()));
        assert!(!contains_bytes(
            &database,
            session_root_id.as_str().as_bytes()
        ));
    }

    #[test]
    fn duplicate_content_round_trips_as_one_asset_and_two_file_instances_after_reopen() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "inventory.sqlite3");
        let mut catalog = SqliteCatalog::open(&path).unwrap();
        let observation = observation('4', "Inventory");
        let mut second = file_instance(
            "SET/PROJECT/copy.wav",
            'a',
            16,
            Some(2),
            SampleStorageScope::ProjectLocal,
        );
        second.hash_freshness = ContentHashFreshness::ReusedUnchangedMetadata;
        let snapshot = snapshot_with_files(vec![
            file_instance(
                "SET/AUDIO/original.wav",
                'a',
                16,
                Some(1),
                SampleStorageScope::SetAudioPool,
            ),
            second,
        ]);

        catalog.store_snapshot(&observation, &snapshot).unwrap();
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(snapshot.clone())
        );
        let counts: (i64, i64) = catalog
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM audio_assets), \
                        (SELECT COUNT(*) FROM file_instances)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 2));
        drop(catalog);

        let reopened = SqliteCatalog::open(path).unwrap();
        assert_eq!(
            reopened
                .load_latest_snapshot(&observation.identity)
                .unwrap(),
            Some(snapshot)
        );
    }

    #[test]
    fn replacement_tracks_add_change_remove_and_rename_while_preserving_same_path_row_id() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('5', "Replacement");
        let first = snapshot_with_files(vec![
            file_instance(
                "SET/AUDIO/rename-me.wav",
                'a',
                10,
                Some(1),
                SampleStorageScope::SetAudioPool,
            ),
            file_instance(
                "SET/PROJECT/stable-path.wav",
                'b',
                20,
                Some(1),
                SampleStorageScope::ProjectLocal,
            ),
            file_instance(
                "SET/AUDIO/delete-me.wav",
                'e',
                50,
                Some(1),
                SampleStorageScope::SetAudioPool,
            ),
        ]);
        catalog.store_snapshot(&observation, &first).unwrap();
        let original_row_id: i64 = catalog
            .connection
            .query_row(
                "SELECT id FROM file_instances WHERE relative_path = 'SET/PROJECT/stable-path.wav'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let replacement = snapshot_with_files(vec![
            file_instance(
                "SET/AUDIO/renamed.wav",
                'a',
                10,
                Some(1),
                SampleStorageScope::SetAudioPool,
            ),
            file_instance(
                "SET/PROJECT/stable-path.wav",
                'c',
                21,
                Some(2),
                SampleStorageScope::ProjectLocal,
            ),
            file_instance(
                "SET/AUDIO/added.wav",
                'd',
                30,
                Some(2),
                SampleStorageScope::SetAudioPool,
            ),
        ]);
        catalog.store_snapshot(&observation, &replacement).unwrap();

        let loaded = catalog
            .load_latest_snapshot(&observation.identity)
            .unwrap()
            .unwrap();
        assert_eq!(loaded, replacement);
        let current_row_id: i64 = catalog
            .connection
            .query_row(
                "SELECT id FROM file_instances WHERE relative_path = 'SET/PROJECT/stable-path.wav'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current_row_id, original_row_id);
        let stale: i64 = catalog
            .connection
            .query_row(
                "SELECT COUNT(*) FROM file_instances \
                 WHERE relative_path IN ('SET/AUDIO/rename-me.wav', 'SET/AUDIO/delete-me.wav')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale, 0);
        let orphaned: i64 = catalog
            .connection
            .query_row(
                "SELECT COUNT(*) FROM audio_assets WHERE content_hash IN (?1, ?2)",
                params![content_hash('b').as_str(), content_hash('e').as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphaned, 0);
    }

    #[test]
    fn duplicate_file_instance_path_is_rejected_without_replacing_latest_success() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('6', "Duplicate file");
        let previous = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/previous.wav",
            'a',
            1,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        catalog.store_snapshot(&observation, &previous).unwrap();
        let duplicate = file_instance(
            "SET/AUDIO/duplicate.wav",
            'b',
            2,
            Some(2),
            SampleStorageScope::SetAudioPool,
        );
        let invalid = snapshot_with_files(vec![duplicate.clone(), duplicate]);

        assert!(matches!(
            catalog.store_snapshot(&observation, &invalid),
            Err(CatalogError::DuplicateRelativePath(_))
        ));
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(previous)
        );
    }

    #[test]
    fn inventory_persistence_failure_rolls_back_to_previous_successful_projection() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('7', "Rollback inventory");
        let previous = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/previous.wav",
            'a',
            1,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        catalog.store_snapshot(&observation, &previous).unwrap();
        catalog
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_inventory_update BEFORE INSERT ON file_instances \
                 WHEN NEW.relative_path = 'SET/AUDIO/fail.wav' \
                 BEGIN SELECT RAISE(ABORT, 'test inventory failure'); END;",
            )
            .unwrap();
        let failing = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/fail.wav",
            'b',
            2,
            Some(2),
            SampleStorageScope::SetAudioPool,
        )]);

        assert!(matches!(
            catalog.store_snapshot(&observation, &failing),
            Err(CatalogError::Unavailable { .. })
        ));
        assert_eq!(
            catalog.load_latest_snapshot(&observation.identity).unwrap(),
            Some(previous)
        );
        assert_eq!(
            catalog
                .latest_scan(&observation.identity)
                .unwrap()
                .unwrap()
                .status,
            CatalogScanStatus::Failed
        );
    }

    #[test]
    fn file_inventory_never_mixes_distinct_root_identities() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let first = observation('8', "First inventory root");
        let second = observation('9', "Second inventory root");
        let first_snapshot = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/first.wav",
            'a',
            1,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        let second_snapshot = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/second.wav",
            'b',
            2,
            Some(2),
            SampleStorageScope::SetAudioPool,
        )]);

        catalog.store_snapshot(&first, &first_snapshot).unwrap();
        catalog.store_snapshot(&second, &second_snapshot).unwrap();

        assert_eq!(
            catalog
                .load_latest_snapshot(&first.identity)
                .unwrap()
                .unwrap()
                .file_instances[0]
                .relative_path
                .as_str(),
            "SET/AUDIO/first.wav"
        );
        assert_eq!(
            catalog
                .load_latest_snapshot(&second.identity)
                .unwrap()
                .unwrap()
                .file_instances[0]
                .relative_path
                .as_str(),
            "SET/AUDIO/second.wav"
        );
    }

    #[test]
    fn manual_asset_metadata_round_trips_after_reopen() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "manual-metadata.sqlite3");
        let observation = observation('a', "Manual metadata");
        let snapshot = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/kick.wav",
            'a',
            16,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        let metadata = ManualAssetMetadata::new(
            vec![
                ManualTag::parse("808").unwrap(),
                ManualTag::parse("キック").unwrap(),
            ],
            Some(ManualNote::parse("ライブ用\n低域を残す").unwrap()),
        )
        .unwrap();
        let mut catalog = SqliteCatalog::open(&path).unwrap();
        catalog.store_snapshot(&observation, &snapshot).unwrap();

        catalog
            .replace_manual_asset_metadata(&content_hash('a'), &metadata)
            .unwrap();
        assert_eq!(
            catalog
                .load_manual_asset_metadata(&content_hash('a'))
                .unwrap(),
            metadata
        );
        drop(catalog);

        let reopened = SqliteCatalog::open(path).unwrap();
        assert_eq!(
            reopened
                .load_manual_asset_metadata(&content_hash('a'))
                .unwrap(),
            metadata
        );
    }

    #[test]
    fn manual_metadata_uses_only_the_user_source_until_provenance_is_modeled() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('f', "Metadata source");
        let snapshot = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/source.wav",
            'f',
            16,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        let metadata = ManualAssetMetadata::new(
            vec![ManualTag::parse("source-check").unwrap()],
            Some(ManualNote::parse("User-authored note").unwrap()),
        )
        .unwrap();
        catalog.store_snapshot(&observation, &snapshot).unwrap();
        catalog
            .replace_manual_asset_metadata(&content_hash('f'), &metadata)
            .unwrap();

        let sources: (String, String) = catalog
            .connection
            .query_row(
                "SELECT tag_assignments.source, notes.source \
                 FROM tag_assignments CROSS JOIN notes",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(sources, ("user".into(), "user".into()));

        let unsupported_tag_source = catalog.connection.execute(
            "INSERT INTO tag_assignments (audio_asset_id, tag_id, source, assigned_at) \
             SELECT audio_asset_id, tag_id, 'ai', assigned_at FROM tag_assignments",
            [],
        );
        assert!(unsupported_tag_source.is_err());
        let unsupported_note_source = catalog.connection.execute(
            "INSERT INTO notes (audio_asset_id, body, source, created_at, updated_at) \
             SELECT audio_asset_id, body, 'analyzer', created_at, updated_at FROM notes",
            [],
        );
        assert!(unsupported_note_source.is_err());
    }

    #[test]
    fn manual_metadata_follows_content_across_rename_and_distinct_roots() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let first = observation('a', "First root");
        let second = observation('b', "Second root");
        let original = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/original.wav",
            'c',
            16,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        let renamed = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/renamed.wav",
            'c',
            16,
            Some(2),
            SampleStorageScope::SetAudioPool,
        )]);
        let duplicate_on_second_root = snapshot_with_files(vec![file_instance(
            "OTHER/AUDIO/copy.wav",
            'c',
            16,
            Some(3),
            SampleStorageScope::SetAudioPool,
        )]);
        let metadata =
            ManualAssetMetadata::new(vec![ManualTag::parse("shared-content").unwrap()], None)
                .unwrap();

        catalog.store_snapshot(&first, &original).unwrap();
        catalog
            .replace_manual_asset_metadata(&content_hash('c'), &metadata)
            .unwrap();
        catalog
            .store_snapshot(&first, &LibrarySnapshot::default())
            .unwrap();
        assert_eq!(
            catalog
                .load_manual_asset_metadata(&content_hash('c'))
                .unwrap(),
            metadata
        );
        catalog.store_snapshot(&first, &renamed).unwrap();
        catalog
            .store_snapshot(&second, &duplicate_on_second_root)
            .unwrap();

        assert_eq!(
            catalog
                .load_manual_asset_metadata(&content_hash('c'))
                .unwrap(),
            metadata
        );
        assert_eq!(
            catalog.load_latest_snapshot(&first.identity).unwrap(),
            Some(renamed)
        );
        assert_eq!(
            catalog.load_latest_snapshot(&second.identity).unwrap(),
            Some(duplicate_on_second_root)
        );
    }

    #[test]
    fn failed_manual_metadata_replacement_rolls_back() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        let observation = observation('d', "Metadata rollback");
        let snapshot = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/snare.wav",
            'd',
            8,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        let previous = ManualAssetMetadata::new(
            vec![ManualTag::parse("snare").unwrap()],
            Some(ManualNote::parse("Keep this").unwrap()),
        )
        .unwrap();
        catalog.store_snapshot(&observation, &snapshot).unwrap();
        catalog
            .replace_manual_asset_metadata(&content_hash('d'), &previous)
            .unwrap();
        catalog
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_manual_tag_assignment \
                 BEFORE INSERT ON tag_assignments \
                 WHEN NEW.source = 'user' \
                 BEGIN SELECT RAISE(ABORT, 'manual metadata fault'); END;",
            )
            .unwrap();
        let replacement =
            ManualAssetMetadata::new(vec![ManualTag::parse("replacement").unwrap()], None).unwrap();

        assert!(matches!(
            catalog.replace_manual_asset_metadata(&content_hash('d'), &replacement),
            Err(CatalogError::Unavailable { .. })
        ));
        assert_eq!(
            catalog
                .load_manual_asset_metadata(&content_hash('d'))
                .unwrap(),
            previous
        );
    }

    #[test]
    fn manual_metadata_rejects_unknown_assets_and_clears_orphans() {
        let (_directory, _path, mut catalog) = open_temp_catalog();
        assert_eq!(
            catalog.load_manual_asset_metadata(&content_hash('e')),
            Err(CatalogError::AssetNotFound)
        );

        let observation = observation('e', "Metadata cleanup");
        let snapshot = snapshot_with_files(vec![file_instance(
            "SET/AUDIO/hat.wav",
            'e',
            4,
            Some(1),
            SampleStorageScope::SetAudioPool,
        )]);
        catalog.store_snapshot(&observation, &snapshot).unwrap();
        catalog
            .replace_manual_asset_metadata(
                &content_hash('e'),
                &ManualAssetMetadata::new(
                    vec![ManualTag::parse("hat").unwrap()],
                    Some(ManualNote::parse("Short").unwrap()),
                )
                .unwrap(),
            )
            .unwrap();
        catalog
            .replace_manual_asset_metadata(&content_hash('e'), &ManualAssetMetadata::default())
            .unwrap();

        let counts: (i64, i64) = catalog
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM tags), (SELECT COUNT(*) FROM notes)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (0, 0));
        assert_eq!(
            catalog
                .load_manual_asset_metadata(&content_hash('e'))
                .unwrap(),
            ManualAssetMetadata::default()
        );
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        !needle.is_empty()
            && haystack
                .windows(needle.len())
                .any(|window| window == needle)
    }
}
