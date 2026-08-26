#![forbid(unsafe_code)]

use ot_domain::{LibrarySnapshot, RootId, RootRelativePath};
use std::fmt;

pub trait ProjectStorage {
    fn read_project_file(
        &self,
        root_id: &RootId,
        path: &RootRelativePath,
    ) -> Result<Vec<u8>, StorageError>;
}

pub trait ReadOnlyLibrary {
    fn list_library(&self, root_id: &RootId) -> Result<LibrarySnapshot, StorageError>;
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct CatalogRootIdentity(String);

impl CatalogRootIdentity {
    pub fn new(value: impl Into<String>) -> Result<Self, CatalogError> {
        let value = value.into();
        let digest = value
            .strip_prefix("rootfp:v1:")
            .ok_or(CatalogError::InvalidRootIdentity)?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(CatalogError::InvalidRootIdentity);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CatalogScanId(u64);

impl CatalogScanId {
    pub fn new(value: u64) -> Result<Self, CatalogError> {
        if value == 0 {
            return Err(CatalogError::InvalidScanId);
        }
        Ok(Self(value))
    }

    pub fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CatalogScanRevision(u64);

impl CatalogScanRevision {
    pub fn new(value: u64) -> Result<Self, CatalogError> {
        if value == 0 {
            return Err(CatalogError::InvalidScanRevision);
        }
        Ok(Self(value))
    }

    pub fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogRootObservation {
    pub identity: CatalogRootIdentity,
    pub identity_is_stable: bool,
    pub display_name: String,
    pub observed_revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogScanStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogFailureCode {
    SnapshotValidation,
    Persistence,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogScan {
    pub id: CatalogScanId,
    pub revision: CatalogScanRevision,
    pub status: CatalogScanStatus,
    pub failure_code: Option<CatalogFailureCode>,
}

pub trait LibraryCatalog {
    fn observe_root(&mut self, observation: &CatalogRootObservation) -> Result<(), CatalogError>;

    fn store_snapshot(
        &mut self,
        observation: &CatalogRootObservation,
        snapshot: &LibrarySnapshot,
    ) -> Result<CatalogScan, CatalogError>;

    fn load_latest_snapshot(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<Option<LibrarySnapshot>, CatalogError>;

    fn latest_scan(
        &self,
        identity: &CatalogRootIdentity,
    ) -> Result<Option<CatalogScan>, CatalogError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CatalogError {
    InvalidRootIdentity,
    InvalidScanId,
    InvalidScanRevision,
    DuplicateRelativePath(RootRelativePath),
    InvalidStoredData { field: &'static str },
    UnsupportedSchema { found: u64, supported: u64 },
    Migration { version: u64, message: String },
    Integrity { message: String },
    Unavailable { message: String },
}

impl fmt::Display for CatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRootIdentity => formatter.write_str("invalid catalog root identity"),
            Self::InvalidScanId => formatter.write_str("invalid catalog scan id"),
            Self::InvalidScanRevision => formatter.write_str("invalid catalog scan revision"),
            Self::DuplicateRelativePath(path) => {
                write!(
                    formatter,
                    "duplicate catalog relative path: {}",
                    path.as_str()
                )
            }
            Self::InvalidStoredData { field } => {
                write!(formatter, "catalog contains invalid stored data in {field}")
            }
            Self::UnsupportedSchema { found, supported } => write!(
                formatter,
                "catalog schema version {found} is newer than supported version {supported}"
            ),
            Self::Migration { version, message } => {
                write!(formatter, "catalog migration {version} failed: {message}")
            }
            Self::Integrity { message } => write!(formatter, "catalog integrity error: {message}"),
            Self::Unavailable { message } => write!(formatter, "catalog unavailable: {message}"),
        }
    }
}

impl std::error::Error for CatalogError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageError {
    message: String,
}

impl StorageError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StorageError {}
