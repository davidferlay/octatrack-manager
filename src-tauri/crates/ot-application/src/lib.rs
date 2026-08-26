#![forbid(unsafe_code)]

use ot_codec_ports::{CodecError, ProjectCodec};
use ot_domain::{LibrarySnapshot, ProjectDocument, RootId, RootRelativePath};
use ot_storage_ports::{ProjectStorage, ReadOnlyLibrary, StorageError};
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
}
