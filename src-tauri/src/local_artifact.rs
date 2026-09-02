use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const CLONE_SOURCE_EVIDENCE_PREFIX: &str = "clone-source-evidence:v1:";
pub const CLONE_VERIFICATION_PREFIX: &str = "clone-verification:v1:";
pub const CLONE_AUTHORITY_PREFIX: &str = "clone-authority:v1:";

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LocalArtifactError {
    InvalidArtifactId,
    ArtifactTampered,
    SymlinkForbidden,
    NotRegularFile,
    ContainmentViolation,
    Io,
}

impl LocalArtifactError {
    #[cfg(test)]
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidArtifactId => "CLONE_INVALID_ARTIFACT_ID",
            Self::ArtifactTampered => "CLONE_ARTIFACT_TAMPERED",
            Self::SymlinkForbidden => "CLONE_SYMLINK_FORBIDDEN",
            Self::NotRegularFile => "CLONE_NOT_REGULAR_FILE",
            Self::ContainmentViolation => "CLONE_ARTIFACT_UNAVAILABLE",
            Self::Io => "CLONE_IO_ERROR",
        }
    }

    #[cfg(test)]
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidArtifactId => "clone artifact identifier is invalid",
            Self::ArtifactTampered => "clone artifact content does not match the expected record",
            Self::SymlinkForbidden => "clone artifact storage rejected a symlink",
            Self::NotRegularFile => "clone artifact storage rejected a non-regular file",
            Self::ContainmentViolation => "clone artifact storage is unavailable",
            Self::Io => "clone artifact storage failed",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloneSourceEvidenceId(String);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloneVerificationId(String);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloneAuthorityId(String);

impl CloneSourceEvidenceId {
    pub fn parse(value: &str) -> Result<Self, LocalArtifactError> {
        validate_prefixed_sha256(value, CLONE_SOURCE_EVIDENCE_PREFIX)?;
        Ok(Self(value.to_owned()))
    }

    pub fn file_stem(&self) -> &str {
        self.0
            .strip_prefix(CLONE_SOURCE_EVIDENCE_PREFIX)
            .expect("validated clone source evidence id")
    }
}

impl CloneVerificationId {
    pub fn parse(value: &str) -> Result<Self, LocalArtifactError> {
        validate_prefixed_sha256(value, CLONE_VERIFICATION_PREFIX)?;
        Ok(Self(value.to_owned()))
    }

    pub fn file_stem(&self) -> &str {
        self.0
            .strip_prefix(CLONE_VERIFICATION_PREFIX)
            .expect("validated clone verification id")
    }
}

impl CloneAuthorityId {
    pub fn parse(value: &str) -> Result<Self, LocalArtifactError> {
        validate_prefixed_sha256(value, CLONE_AUTHORITY_PREFIX)?;
        Ok(Self(value.to_owned()))
    }

    pub fn file_stem(&self) -> &str {
        self.0
            .strip_prefix(CLONE_AUTHORITY_PREFIX)
            .expect("validated clone authority id")
    }
}

fn validate_prefixed_sha256(value: &str, prefix: &str) -> Result<(), LocalArtifactError> {
    if value.contains('/') || value.contains('\\') || Path::new(value).is_absolute() {
        return Err(LocalArtifactError::InvalidArtifactId);
    }
    let digest = value
        .strip_prefix(prefix)
        .ok_or(LocalArtifactError::InvalidArtifactId)?;
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(LocalArtifactError::InvalidArtifactId)
    }
}

pub struct LocalArtifactStore {
    artifacts_directory: PathBuf,
}

impl LocalArtifactStore {
    pub fn new(
        storage_root: PathBuf,
        artifacts_directory_name: &str,
    ) -> Result<Self, LocalArtifactError> {
        ensure_real_directory(&storage_root, &storage_root.join(artifacts_directory_name))?;
        let artifacts_directory = storage_root.join(artifacts_directory_name);
        let canonical = artifacts_directory
            .canonicalize()
            .map_err(|_| LocalArtifactError::Io)?;
        if !canonical.starts_with(
            storage_root
                .canonicalize()
                .map_err(|_| LocalArtifactError::Io)?,
        ) {
            return Err(LocalArtifactError::ContainmentViolation);
        }
        Ok(Self {
            artifacts_directory: canonical,
        })
    }

    pub fn artifact_path(&self, file_stem: &str) -> Result<PathBuf, LocalArtifactError> {
        if file_stem.contains('/') || file_stem.contains('\\') || file_stem.contains("..") {
            return Err(LocalArtifactError::InvalidArtifactId);
        }
        let path = self.artifacts_directory.join(format!("{file_stem}.json"));
        if !path.starts_with(&self.artifacts_directory) {
            return Err(LocalArtifactError::ContainmentViolation);
        }
        Ok(path)
    }

    pub fn write_json_create_once<T: Serialize>(
        &self,
        file_stem: &str,
        value: &T,
    ) -> Result<(), LocalArtifactError> {
        let path = self.artifact_path(file_stem)?;
        let serialized = serde_json::to_vec_pretty(value).map_err(|_| LocalArtifactError::Io)?;
        let expected_hash = content_hash(&serialized);
        match open_regular_file_for_write_create(&path) {
            Ok(mut file) => {
                file.write_all(&serialized)
                    .map_err(|_| LocalArtifactError::Io)?;
                file.sync_all().map_err(|_| LocalArtifactError::Io)?;
                sync_parent_directory(&path)?;
                Ok(())
            }
            Err(LocalArtifactError::Io) if path.exists() => {
                let existing = read_regular_file_bytes(&path)?;
                if content_hash(&existing) == expected_hash {
                    Ok(())
                } else {
                    Err(LocalArtifactError::ArtifactTampered)
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn read_json<T: DeserializeOwned>(&self, file_stem: &str) -> Result<T, LocalArtifactError> {
        let path = self.artifact_path(file_stem)?;
        let bytes = read_regular_file_bytes(&path)?;
        serde_json::from_slice(&bytes).map_err(|_| LocalArtifactError::Io)
    }
}

fn content_hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn read_regular_file_bytes(path: &Path) -> Result<Vec<u8>, LocalArtifactError> {
    let mut file = open_regular_file_for_read(path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|_| LocalArtifactError::Io)?;
    Ok(buffer)
}

fn open_regular_file_for_read(path: &Path) -> Result<File, LocalArtifactError> {
    reject_symlink(path)?;
    let file = open_nofollow(path, true).map_err(|_| LocalArtifactError::Io)?;
    let metadata = file.metadata().map_err(|_| LocalArtifactError::Io)?;
    if !metadata.is_file() {
        return Err(LocalArtifactError::NotRegularFile);
    }
    Ok(file)
}

fn open_regular_file_for_write_create(path: &Path) -> Result<File, LocalArtifactError> {
    reject_symlink(path)?;
    if path.exists() {
        return Err(LocalArtifactError::Io);
    }
    let parent = path
        .parent()
        .ok_or(LocalArtifactError::ContainmentViolation)?;
    reject_symlink(parent)?;
    let file = open_nofollow_create(path).map_err(|_| LocalArtifactError::Io)?;
    let metadata = file.metadata().map_err(|_| LocalArtifactError::Io)?;
    if !metadata.is_file() {
        return Err(LocalArtifactError::NotRegularFile);
    }
    Ok(file)
}

fn reject_symlink(path: &Path) -> Result<(), LocalArtifactError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(LocalArtifactError::SymlinkForbidden)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(LocalArtifactError::Io),
    }
}

#[cfg(unix)]
fn open_nofollow(path: &Path, read: bool) -> Result<File, std::io::Error> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(read)
        .write(!read)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(unix)]
fn open_nofollow_create(path: &Path) -> Result<File, std::io::Error> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(not(unix))]
fn open_nofollow(path: &Path, read: bool) -> Result<File, std::io::Error> {
    reject_symlink(path).map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
    if read {
        File::open(path)
    } else {
        OpenOptions::new().write(true).open(path)
    }
}

#[cfg(not(unix))]
fn open_nofollow_create(path: &Path) -> Result<File, std::io::Error> {
    reject_symlink(path).map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
    OpenOptions::new().write(true).create_new(true).open(path)
}

fn sync_parent_directory(path: &Path) -> Result<(), LocalArtifactError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    reject_symlink(parent)?;
    let directory = File::open(parent).map_err(|_| LocalArtifactError::Io)?;
    directory.sync_all().map_err(|_| LocalArtifactError::Io)
}

pub(crate) fn ensure_real_directory(
    parent: &Path,
    directory: &Path,
) -> Result<(), LocalArtifactError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(LocalArtifactError::NotRegularFile)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(directory).map_err(|_| LocalArtifactError::Io)?;
            Ok(())
        }
        Err(_) => Err(LocalArtifactError::Io),
    }
    .and_then(|_| {
        let canonical = directory
            .canonicalize()
            .map_err(|_| LocalArtifactError::Io)?;
        let parent_canonical = parent.canonicalize().map_err(|_| LocalArtifactError::Io)?;
        if !canonical.starts_with(&parent_canonical) {
            return Err(LocalArtifactError::ContainmentViolation);
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    #[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
    struct SampleRecord {
        value: String,
    }

    #[test]
    fn rejects_traversal_artifact_ids() {
        let err = CloneSourceEvidenceId::parse("../etc/passwd").unwrap_err();
        assert_eq!(err, LocalArtifactError::InvalidArtifactId);
    }

    #[test]
    fn rejects_wrong_prefix_artifact_ids() {
        let err = CloneVerificationId::parse("clone-authority:v1:abcd").unwrap_err();
        assert_eq!(err, LocalArtifactError::InvalidArtifactId);
    }

    #[test]
    fn create_once_is_idempotent_for_matching_content() {
        let temp = TempDir::new().unwrap();
        let store =
            LocalArtifactStore::new(temp.path().to_path_buf(), "clone-verifications").unwrap();
        let digest = "a".repeat(64);
        let id = format!("{CLONE_SOURCE_EVIDENCE_PREFIX}{digest}");
        let evidence_id = CloneSourceEvidenceId::parse(&id).unwrap();
        let record = SampleRecord {
            value: "evidence".into(),
        };
        store
            .write_json_create_once(evidence_id.file_stem(), &record)
            .unwrap();
        store
            .write_json_create_once(evidence_id.file_stem(), &record)
            .unwrap();
        let loaded: SampleRecord = store.read_json(evidence_id.file_stem()).unwrap();
        assert_eq!(loaded, record);
    }

    #[test]
    fn create_once_rejects_tampered_existing_artifact() {
        let temp = TempDir::new().unwrap();
        let store =
            LocalArtifactStore::new(temp.path().to_path_buf(), "clone-verifications").unwrap();
        let digest = "b".repeat(64);
        let id = format!("{CLONE_VERIFICATION_PREFIX}{digest}");
        let verification_id = CloneVerificationId::parse(&id).unwrap();
        let record = SampleRecord {
            value: "verified".into(),
        };
        store
            .write_json_create_once(verification_id.file_stem(), &record)
            .unwrap();
        let path = store.artifact_path(verification_id.file_stem()).unwrap();
        std::fs::write(path, br#"{"value":"tampered"}"#).unwrap();
        let err = store
            .write_json_create_once(verification_id.file_stem(), &record)
            .unwrap_err();
        assert_eq!(err, LocalArtifactError::ArtifactTampered);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_artifact_symlink() {
        let temp = TempDir::new().unwrap();
        let store =
            LocalArtifactStore::new(temp.path().to_path_buf(), "clone-verifications").unwrap();
        let digest = "c".repeat(64);
        let target = store.artifact_path(&digest).unwrap();
        std::fs::write(&target, b"{}").unwrap();
        let link = store
            .artifacts_directory
            .join(format!("{digest}-link.json"));
        symlink(&target, &link).unwrap();
        let err = read_regular_file_bytes(&link).unwrap_err();
        assert_eq!(err, LocalArtifactError::SymlinkForbidden);
    }
}
