use ot_catalog::SqliteCatalog;
use ot_storage_ports::CatalogError;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

const CATALOG_DIRECTORY_NAME: &str = "OctatrackWorkbench";
const CATALOG_DATABASE_NAME: &str = "catalog.sqlite3";

pub type SharedCatalog = Arc<Mutex<SqliteCatalog>>;

pub fn open_shared_catalog(data_directory: &Path) -> Result<SharedCatalog, CatalogRuntimeError> {
    fs::create_dir_all(data_directory).map_err(|error| io_error("create data directory", error))?;
    let canonical_data_directory = data_directory
        .canonicalize()
        .map_err(|error| io_error("resolve data directory", error))?;
    let catalog_directory = canonical_data_directory.join(CATALOG_DIRECTORY_NAME);
    ensure_catalog_directory(&canonical_data_directory, &catalog_directory)?;

    let database_path = catalog_directory.join(CATALOG_DATABASE_NAME);
    reject_unsafe_database_entry(&database_path)?;
    let catalog = SqliteCatalog::open(&database_path).map_err(CatalogRuntimeError::Catalog)?;
    reject_unsafe_database_entry(&database_path)?;
    Ok(Arc::new(Mutex::new(catalog)))
}

fn ensure_catalog_directory(
    canonical_data_directory: &Path,
    catalog_directory: &Path,
) -> Result<(), CatalogRuntimeError> {
    match fs::symlink_metadata(catalog_directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(CatalogRuntimeError::UnsafeCatalogPath {
                    reason: "catalog directory must be a real directory",
                });
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(catalog_directory)
                .map_err(|error| io_error("create catalog directory", error))?;
        }
        Err(error) => return Err(io_error("inspect catalog directory", error)),
    }

    let canonical_catalog_directory = catalog_directory
        .canonicalize()
        .map_err(|error| io_error("resolve catalog directory", error))?;
    if !canonical_catalog_directory.starts_with(canonical_data_directory) {
        return Err(CatalogRuntimeError::UnsafeCatalogPath {
            reason: "catalog directory escaped the application data directory",
        });
    }
    Ok(())
}

fn reject_unsafe_database_entry(database_path: &Path) -> Result<(), CatalogRuntimeError> {
    match fs::symlink_metadata(database_path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(CatalogRuntimeError::UnsafeCatalogPath {
                    reason: "catalog database must be a regular file",
                });
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("inspect catalog database", error)),
    }
    Ok(())
}

#[derive(Debug)]
pub enum CatalogRuntimeError {
    Io {
        operation: &'static str,
        message: String,
    },
    UnsafeCatalogPath {
        reason: &'static str,
    },
    Catalog(CatalogError),
}

impl std::fmt::Display for CatalogRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { operation, message } => {
                write!(formatter, "could not {operation}: {message}")
            }
            Self::UnsafeCatalogPath { reason } => formatter.write_str(reason),
            Self::Catalog(error) => write!(formatter, "could not open catalog: {error}"),
        }
    }
}

impl std::error::Error for CatalogRuntimeError {}

fn io_error(operation: &'static str, error: std::io::Error) -> CatalogRuntimeError {
    CatalogRuntimeError::Io {
        operation,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn opens_only_the_named_catalog_inside_the_application_data_directory() {
        let data_directory = TempDir::new().unwrap();

        let first = open_shared_catalog(data_directory.path()).unwrap();
        drop(first);
        let second = open_shared_catalog(data_directory.path()).unwrap();
        drop(second);

        assert!(data_directory
            .path()
            .join(CATALOG_DIRECTORY_NAME)
            .join(CATALOG_DATABASE_NAME)
            .is_file());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_catalog_directory() {
        use std::os::unix::fs::symlink;

        let data_directory = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        symlink(
            outside.path(),
            data_directory.path().join(CATALOG_DIRECTORY_NAME),
        )
        .unwrap();

        let error = open_shared_catalog(data_directory.path()).err().unwrap();

        assert!(matches!(
            error,
            CatalogRuntimeError::UnsafeCatalogPath { .. }
        ));
        assert!(!outside.path().join(CATALOG_DATABASE_NAME).exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_catalog_database() {
        use std::os::unix::fs::symlink;

        let data_directory = TempDir::new().unwrap();
        let catalog_directory = data_directory.path().join(CATALOG_DIRECTORY_NAME);
        fs::create_dir(&catalog_directory).unwrap();
        let outside = data_directory.path().join("outside.sqlite3");
        fs::write(&outside, b"not a catalog").unwrap();
        symlink(&outside, catalog_directory.join(CATALOG_DATABASE_NAME)).unwrap();

        let error = open_shared_catalog(data_directory.path()).err().unwrap();

        assert!(matches!(
            error,
            CatalogRuntimeError::UnsafeCatalogPath { .. }
        ));
        assert_eq!(fs::read(outside).unwrap(), b"not a catalog");
    }
}
