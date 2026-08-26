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
