#![forbid(unsafe_code)]

use ot_domain::{LibraryProject, LibrarySet, LibrarySnapshot, RootRelativePath};
use ot_storage_ports::{
    CatalogError, CatalogFailureCode, CatalogRootIdentity, CatalogRootObservation, CatalogScan,
    CatalogScanId, CatalogScanRevision, CatalogScanStatus, LibraryCatalog,
};
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use std::collections::HashSet;
use std::path::Path;

const LATEST_SCHEMA_VERSION: u64 = 1;
const MIGRATIONS: &[(u64, &str)] =
    &[(1, include_str!("../migrations/0001_catalog_foundation.sql"))];

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
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
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
        Ok(Some(LibrarySnapshot {
            sets,
            standalone_projects,
        }))
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
                "SELECT relative_path, display_name, has_project_file, has_banks \
                 FROM projects \
                 WHERE root_id = ?1 AND scan_session_id = ?2 \
                   AND is_standalone = 0 AND parent_set_relative_path = ?3 \
                 ORDER BY sort_order",
                false,
            )
        } else {
            (
                "SELECT relative_path, display_name, has_project_file, has_banks \
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
          parent_set_relative_path, has_project_file, has_banks, sort_order) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            root_row_id,
            scan_id,
            project.relative_path.as_str(),
            project.display_name,
            parent_set.is_none(),
            parent_set,
            project.has_project_file,
            project.has_banks,
            sort_order as i64,
        ],
    )?;
    Ok(())
}

fn validate_snapshot(snapshot: &LibrarySnapshot) -> Result<(), CatalogError> {
    let mut paths = HashSet::new();
    for set in &snapshot.sets {
        validate_unique_path(&mut paths, &set.relative_path)?;
        for project in &set.projects {
            validate_unique_path(&mut paths, &project.relative_path)?;
        }
    }
    for project in &snapshot.standalone_projects {
        validate_unique_path(&mut paths, &project.relative_path)?;
    }
    Ok(())
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
    row: (String, String, bool, bool),
) -> Result<LibraryProject, CatalogError> {
    Ok(LibraryProject {
        relative_path: stored_path(row.0)?,
        display_name: row.1,
        has_project_file: row.2,
        has_banks: row.3,
    })
}

fn stored_path(value: String) -> Result<RootRelativePath, CatalogError> {
    RootRelativePath::parse(value).map_err(|_| CatalogError::InvalidStoredData {
        field: "relative_path",
    })
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

    for (version, sql) in MIGRATIONS {
        if *version > current_version {
            apply_migration(connection, *version, sql)?;
        }
    }
    Ok(())
}

fn apply_migration(
    connection: &mut Connection,
    version: u64,
    sql: &str,
) -> Result<(), CatalogError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| migration_error(version, error))?;
    transaction
        .execute_batch(sql)
        .map_err(|error| migration_error(version, error))?;
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
        }
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
        assert_eq!(count, 1);
        drop(catalog);

        let reopened = SqliteCatalog::open(&path).unwrap();
        let count: i64 = reopened
            .connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        drop(reopened);
        drop(directory);
    }

    #[test]
    fn unknown_newer_schema_version_is_rejected() {
        let directory = TempDir::new().unwrap();
        let path = database_path(&directory, "future.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); \
                 INSERT INTO schema_migrations VALUES (2, 'future');",
            )
            .unwrap();
        drop(connection);

        let error = SqliteCatalog::open(path).err().unwrap();
        assert_eq!(
            error,
            CatalogError::UnsupportedSchema {
                found: 2,
                supported: 1,
            }
        );
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
        assert!(!foreign_keys.query([]).unwrap().next().unwrap().is_some());
        let integrity: String = catalog
            .connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
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
        };
        let second_snapshot = LibrarySnapshot {
            sets: vec![],
            standalone_projects: vec![project("Second", "SECOND")],
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
        let snapshot = LibrarySnapshot {
            sets: vec![],
            standalone_projects: vec![project("Project", "SET/PROJECT")],
        };

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

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        !needle.is_empty()
            && haystack
                .windows(needle.len())
                .any(|window| window == needle)
    }
}
