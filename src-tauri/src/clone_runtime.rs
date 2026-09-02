#![forbid(unsafe_code)]
// Production apply wiring (Phase 4B) consumes the authority adapter and disk helpers below.
#![allow(dead_code)]

use crate::local_artifact::{
    ensure_real_directory, CloneBaselineEvidenceId, CloneSourceEvidenceId, LocalArtifactError,
    LocalArtifactStore,
};
use crate::root_registry::{ResolvedRoot, RootRegistry, RootRegistryError};
use ot_domain::RootId;
use ot_executor::{ApprovedExecutionRoot, AuthorityError, CloneWriteAuthority, VerifiedCloneRoot};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CLONE_BASELINE_EVIDENCE_SCHEMA: &str = "masterocta-clone-baseline-evidence:v1";
const CLONE_BASELINE_SCHEMA: &str = "masterocta-clone-baseline:v1";
const CLONE_SOURCE_EVIDENCE_SCHEMA: &str = "masterocta-clone-source-evidence:v1";
const CLONE_VERIFICATION_SCHEMA: &str = "masterocta-clone-verification:v1";
const CLONE_AUTHORITY_SCHEMA: &str = "masterocta-clone-authority:v1";
const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const MANAGED_CLONES_DIRECTORY: &str = "managed-clones";
const CLONE_VERIFICATIONS_DIRECTORY: &str = "clone-verifications";
const DEFAULT_VERIFICATION_TTL: Duration = Duration::from_secs(8 * 60 * 60);

pub type SharedCloneRuntime = Arc<CloneRuntime>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloneProvenance {
    AppManaged,
    External,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloneVerificationState {
    Verified,
    Tampered,
    Expired,
    Revoked,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CloneBaselineEntry {
    pub relative_path: String,
    pub byte_size: u64,
    pub content_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CloneBaselineManifest {
    pub schema: String,
    pub provenance: CloneProvenance,
    pub clone_root_id: String,
    pub clone_device_fingerprint: String,
    pub clone_surface_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_device_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_surface_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_evidence_id: Option<String>,
    pub created_at_unix: u64,
    pub entry_count: u64,
    pub entries: Vec<CloneBaselineEntry>,
    pub manifest_binding: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CloneSourceEvidenceRecord {
    pub schema: String,
    pub source_evidence_id: String,
    pub source_root_id: String,
    pub source_device_fingerprint: String,
    pub source_surface_id: String,
    pub created_at_unix: u64,
    pub entry_count: u64,
    pub entries: Vec<CloneBaselineEntry>,
    pub manifest_binding: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CloneBaselineEvidence {
    pub schema: String,
    pub baseline_evidence_id: String,
    pub provenance: CloneProvenance,
    pub clone_surface_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_evidence_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_token: Option<String>,
    pub manifest_binding: String,
    pub entry_count: u64,
    pub entries: Vec<CloneBaselineEntry>,
    pub format_version: u32,
    pub created_at_unix: u64,
}

#[derive(Clone, Debug)]
struct CloneVerificationLease {
    clone_verification_id: String,
    root_id: String,
    clone_device_fingerprint: String,
    baseline_evidence_id: String,
    clone_surface_id: String,
    provenance: CloneProvenance,
    source_evidence_id: Option<String>,
    baseline_manifest_binding: String,
    baseline_entry_count: u64,
    state: CloneVerificationState,
    verified_at_unix: u64,
    expires_at_unix: u64,
}

#[derive(Clone, Debug)]
struct CloneWriteAuthorityLease {
    clone_authority_id: String,
    clone_verification_id: String,
    root_id: String,
    baseline_evidence_id: String,
    baseline_manifest_binding: String,
    issued_at_unix: u64,
    expires_at_unix: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CloneVerificationRecord {
    pub schema: String,
    pub clone_verification_id: String,
    pub clone_root_id: String,
    pub clone_device_fingerprint: String,
    pub clone_surface_id: String,
    pub provenance: CloneProvenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_evidence_id: Option<String>,
    pub baseline_entry_count: u64,
    pub baseline_manifest_binding: String,
    pub state: CloneVerificationState,
    pub verified_at_unix: u64,
    pub expires_at_unix: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CloneAuthorityRecord {
    pub schema: String,
    pub clone_authority_id: String,
    pub clone_verification_id: String,
    pub clone_root_id: String,
    pub clone_device_fingerprint: String,
    pub clone_surface_id: String,
    pub baseline_manifest_binding: String,
    pub issued_at_unix: u64,
    pub expires_at_unix: u64,
}

#[derive(Clone, Debug)]
pub struct CloneVerificationStatus {
    pub clone_verification_id: String,
    pub clone_root_id: RootId,
    pub provenance: CloneProvenance,
    pub state: CloneVerificationState,
    pub entry_count: u64,
    pub expires_in_seconds: u64,
}

#[derive(Clone, Debug)]
pub struct ManagedCloneResult {
    pub clone_root_id: RootId,
    pub clone_verification_id: String,
    pub entry_count: u64,
    pub source_root_closed: bool,
}

#[derive(Default)]
struct CloneRuntimeState {
    verification_leases: BTreeMap<String, CloneVerificationLease>,
    authority_leases: BTreeMap<String, CloneWriteAuthorityLease>,
}

pub struct CloneRuntime {
    storage_root: PathBuf,
    artifact_store: LocalArtifactStore,
    state: Mutex<CloneRuntimeState>,
    verification_ttl: Duration,
}

#[derive(Debug)]
pub enum CloneRuntimeError {
    NotApproved,
    SourceEqualsClone,
    NestedRoot,
    SymlinkForbidden,
    SourceChangedDuringCopy,
    ManifestMismatch,
    SourceEvidenceRequired,
    SourceEvidenceMismatch,
    VerificationNotFound,
    VerificationExpired,
    VerificationTampered,
    CloneNotVerified,
    AuthorityNotFound,
    AuthorityExpired,
    AmbiguousIdentity,
    UnstableIdentity,
    InvalidArtifactId,
    ArtifactTampered,
    SpecialFileForbidden,
    Io,
    Unavailable,
}

impl CloneRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotApproved => "ROOT_NOT_APPROVED",
            Self::SourceEqualsClone => "CLONE_SOURCE_EQUALS_CLONE",
            Self::NestedRoot => "CLONE_NESTED_ROOT",
            Self::SymlinkForbidden => "CLONE_SYMLINK_FORBIDDEN",
            Self::SourceChangedDuringCopy => "CLONE_SOURCE_CHANGED",
            Self::ManifestMismatch => "CLONE_MANIFEST_MISMATCH",
            Self::SourceEvidenceRequired => "CLONE_SOURCE_EVIDENCE_REQUIRED",
            Self::SourceEvidenceMismatch => "CLONE_SOURCE_EVIDENCE_MISMATCH",
            Self::VerificationNotFound => "CLONE_VERIFICATION_NOT_FOUND",
            Self::VerificationExpired => "CLONE_VERIFICATION_EXPIRED",
            Self::VerificationTampered => "CLONE_TAMPERED",
            Self::CloneNotVerified => "CLONE_NOT_VERIFIED",
            Self::AuthorityNotFound => "CLONE_AUTHORITY_NOT_FOUND",
            Self::AuthorityExpired => "CLONE_AUTHORITY_EXPIRED",
            Self::AmbiguousIdentity => "ROOT_IDENTITY_AMBIGUOUS",
            Self::UnstableIdentity => "UNSTABLE_DEVICE_IDENTITY",
            Self::InvalidArtifactId => "CLONE_INVALID_ARTIFACT_ID",
            Self::ArtifactTampered => "CLONE_ARTIFACT_TAMPERED",
            Self::SpecialFileForbidden => "CLONE_SPECIAL_FILE_FORBIDDEN",
            Self::Io | Self::Unavailable => "CLONE_RUNTIME_UNAVAILABLE",
        }
    }

    pub fn public_message(&self) -> &'static str {
        match self {
            Self::NotApproved => "root session is not approved",
            Self::SourceEqualsClone => "source and clone roots must be distinct",
            Self::NestedRoot => "clone root cannot be nested inside source or vice versa",
            Self::SymlinkForbidden => "symlinks are forbidden in clone verification",
            Self::SourceChangedDuringCopy => "source tree changed during managed clone creation",
            Self::ManifestMismatch => "clone baseline does not match required manifest",
            Self::SourceEvidenceRequired => "external clone verification requires source evidence",
            Self::SourceEvidenceMismatch => "clone manifest does not match source evidence",
            Self::VerificationNotFound => "clone verification record was not found",
            Self::VerificationExpired => "clone verification has expired",
            Self::VerificationTampered => "clone filesystem changed after verification",
            Self::CloneNotVerified => "clone root is not verified for rename operations",
            Self::AuthorityNotFound => "clone authority was not found",
            Self::AuthorityExpired => "clone authority has expired",
            Self::AmbiguousIdentity => "root identity is ambiguous on this device",
            Self::UnstableIdentity => "clone operations require a stable device identity",
            Self::InvalidArtifactId => "clone artifact identifier is invalid",
            Self::ArtifactTampered => "clone artifact content does not match the expected record",
            Self::SpecialFileForbidden => "special files are forbidden in clone baselines",
            Self::Io => "clone runtime storage failed",
            Self::Unavailable => "clone runtime is unavailable",
        }
    }
}

impl std::fmt::Display for CloneRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.public_message())
    }
}

impl std::error::Error for CloneRuntimeError {}

impl CloneRuntime {
    pub fn new(
        storage_root: PathBuf,
        verification_ttl: Duration,
    ) -> Result<Self, CloneRuntimeError> {
        let artifact_store =
            LocalArtifactStore::new(storage_root.clone(), CLONE_VERIFICATIONS_DIRECTORY)
                .map_err(map_local_artifact_error)?;
        Ok(Self {
            storage_root,
            artifact_store,
            state: Mutex::new(CloneRuntimeState::default()),
            verification_ttl,
        })
    }

    pub fn record_source_evidence(
        &self,
        resolved: &ResolvedRoot,
    ) -> Result<CloneSourceEvidenceRecord, CloneRuntimeError> {
        if !resolved.session.capabilities.stable_device_identity {
            return Err(CloneRuntimeError::UnstableIdentity);
        }
        let surface_id = derive_root_surface_id(&resolved.canonical_path);
        let entries = scan_baseline_entries(&resolved.canonical_path)?;
        let manifest_binding = derive_manifest_binding(&entries);
        let source_evidence_id = derive_source_evidence_id(
            resolved.session.root_id.as_str(),
            &resolved.session.device_fingerprint,
            &surface_id,
            &manifest_binding,
        );
        let record = CloneSourceEvidenceRecord {
            schema: CLONE_SOURCE_EVIDENCE_SCHEMA.to_owned(),
            source_evidence_id: source_evidence_id.clone(),
            source_root_id: resolved.session.root_id.as_str().to_owned(),
            source_device_fingerprint: resolved.session.device_fingerprint.clone(),
            source_surface_id: surface_id,
            created_at_unix: unix_now(),
            entry_count: entries.len() as u64,
            entries,
            manifest_binding,
        };
        persist_source_evidence(&self.artifact_store, &record)?;
        Ok(record)
    }

    pub fn create_managed_clone(
        &self,
        _registry: &RootRegistry,
        source: &ResolvedRoot,
    ) -> Result<(PathBuf, String, Vec<CloneBaselineEntry>), CloneRuntimeError> {
        if !source.session.capabilities.stable_device_identity {
            return Err(CloneRuntimeError::UnstableIdentity);
        }
        let source_surface = derive_root_surface_id(&source.canonical_path);
        let source_before = scan_baseline_entries(&source.canonical_path)?;
        let clone_token = derive_managed_clone_token(
            source.session.root_id.as_str(),
            &source.session.device_fingerprint,
            &source_surface,
        );
        let managed_root = self.storage_root.join(MANAGED_CLONES_DIRECTORY);
        ensure_real_directory(&self.storage_root, &managed_root)
            .map_err(map_local_artifact_error)?;
        let partial = managed_root.join(format!("{clone_token}.partial"));
        let final_path = managed_root.join(&clone_token);
        remove_path_if_exists(&partial)?;
        remove_path_if_exists(&final_path)?;
        fs::create_dir(&partial).map_err(map_io_error)?;
        copy_tree_nofollow(&source.canonical_path, &partial)?;
        let source_after = scan_baseline_entries(&source.canonical_path)?;
        if source_before != source_after {
            let _ = fs::remove_dir_all(&partial);
            return Err(CloneRuntimeError::SourceChangedDuringCopy);
        }
        let clone_entries = scan_baseline_entries(&partial)?;
        if clone_entries != source_before {
            let _ = fs::remove_dir_all(&partial);
            return Err(CloneRuntimeError::ManifestMismatch);
        }
        fs::rename(&partial, &final_path).map_err(map_io_error)?;
        Ok((final_path, clone_token, clone_entries))
    }

    pub fn managed_clones_root(&self) -> PathBuf {
        self.storage_root.join(MANAGED_CLONES_DIRECTORY)
    }

    pub fn load_baseline_evidence(
        &self,
        baseline_evidence_id: &str,
    ) -> Result<CloneBaselineEvidence, CloneRuntimeError> {
        let artifact_id = CloneBaselineEvidenceId::parse(baseline_evidence_id)
            .map_err(|_| CloneRuntimeError::InvalidArtifactId)?;
        self.artifact_store
            .read_json(artifact_id.file_stem())
            .map_err(map_local_artifact_error)
    }

    pub fn verify_managed_clone_registration(
        &self,
        source: &ResolvedRoot,
        clone: &ResolvedRoot,
        entries: &[CloneBaselineEntry],
        managed_token: &str,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        reject_source_clone_relationship(source, clone)?;
        let live_entries = scan_baseline_entries(&clone.canonical_path)?;
        let manifest_binding = derive_manifest_binding(&live_entries);
        if live_entries != entries {
            return Err(CloneRuntimeError::ManifestMismatch);
        }
        let clone_surface = derive_root_surface_id(&clone.canonical_path);
        let baseline = build_baseline_evidence(
            CloneProvenance::AppManaged,
            &clone_surface,
            None,
            Some(managed_token.to_owned()),
            manifest_binding,
            live_entries,
        )?;
        persist_baseline_evidence(&self.artifact_store, &baseline)?;
        let lease = self.issue_verification_lease(clone, &baseline)?;
        Ok(verification_record_from_lease(clone, &lease))
    }

    pub fn verify_external_clone(
        &self,
        clone: &ResolvedRoot,
        source_evidence: &CloneSourceEvidenceRecord,
        acknowledged_disposable: bool,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        if !acknowledged_disposable {
            return Err(CloneRuntimeError::CloneNotVerified);
        }
        if !clone.session.capabilities.stable_device_identity {
            return Err(CloneRuntimeError::UnstableIdentity);
        }
        if clone.session.device_fingerprint == source_evidence.source_device_fingerprint {
            return Err(CloneRuntimeError::SourceEqualsClone);
        }
        let clone_surface = derive_root_surface_id(&clone.canonical_path);
        if clone_surface == source_evidence.source_surface_id {
            return Err(CloneRuntimeError::SourceEqualsClone);
        }
        let live_entries = scan_baseline_entries(&clone.canonical_path)?;
        let manifest_binding = derive_manifest_binding(&live_entries);
        if manifest_binding != source_evidence.manifest_binding
            || live_entries != source_evidence.entries
        {
            return Err(CloneRuntimeError::SourceEvidenceMismatch);
        }
        let baseline = build_baseline_evidence(
            CloneProvenance::External,
            &clone_surface,
            Some(source_evidence.source_evidence_id.clone()),
            None,
            manifest_binding,
            live_entries,
        )?;
        persist_baseline_evidence(&self.artifact_store, &baseline)?;
        let lease = self.issue_verification_lease(clone, &baseline)?;
        Ok(verification_record_from_lease(clone, &lease))
    }

    pub fn load_source_evidence(
        &self,
        source_evidence_id: &str,
    ) -> Result<CloneSourceEvidenceRecord, CloneRuntimeError> {
        let artifact_id = CloneSourceEvidenceId::parse(source_evidence_id)
            .map_err(|_| CloneRuntimeError::InvalidArtifactId)?;
        self.artifact_store
            .read_json(artifact_id.file_stem())
            .map_err(map_local_artifact_error)
    }

    pub fn verification_for_root(
        &self,
        root_id: &RootId,
    ) -> Result<Option<CloneVerificationRecord>, CloneRuntimeError> {
        let mut state = self.lock_state()?;
        purge_expired(&mut state);
        Ok(state
            .verification_leases
            .values()
            .find(|lease| lease.root_id == root_id.as_str())
            .map(|lease| verification_record_from_lease_id(root_id, lease)))
    }

    pub fn require_verified_root(
        &self,
        resolved: &ResolvedRoot,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        let record = self
            .verification_for_root(&resolved.session.root_id)?
            .ok_or(CloneRuntimeError::CloneNotVerified)?;
        self.validate_verification(resolved, &record)
    }

    pub fn reverify_root(
        &self,
        resolved: &ResolvedRoot,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        let mut lease = self
            .lock_state()?
            .verification_leases
            .values()
            .find(|lease| lease.root_id == resolved.session.root_id.as_str())
            .cloned()
            .ok_or(CloneRuntimeError::CloneNotVerified)?;
        self.validate_verification(resolved, &verification_record_from_lease(resolved, &lease))?;
        lease.verified_at_unix = unix_now();
        lease.expires_at_unix = unix_now() + self.verification_ttl.as_secs();
        lease.state = CloneVerificationState::Verified;
        let record = verification_record_from_lease(resolved, &lease);
        self.store_verification_lease(lease);
        Ok(record)
    }

    pub fn issue_clone_authority(
        &self,
        resolved: &ResolvedRoot,
    ) -> Result<CloneAuthorityRecord, CloneRuntimeError> {
        let verification = self.reverify_root(resolved)?;
        let authority = CloneWriteAuthorityLease {
            clone_authority_id: derive_clone_authority_id(
                &verification.clone_verification_id,
                resolved.session.root_id.as_str(),
                &verification.baseline_manifest_binding,
            ),
            clone_verification_id: verification.clone_verification_id.clone(),
            root_id: resolved.session.root_id.as_str().to_owned(),
            baseline_evidence_id: verification
                .source_evidence_id
                .clone()
                .unwrap_or_else(|| verification.clone_verification_id.clone()),
            baseline_manifest_binding: verification.baseline_manifest_binding.clone(),
            issued_at_unix: unix_now(),
            expires_at_unix: verification.expires_at_unix,
        };
        self.store_authority_lease(authority.clone());
        Ok(authority_record_from_lease(
            resolved,
            &authority,
            &verification,
        ))
    }

    pub fn require_clone_authority(
        &self,
        resolved: &ResolvedRoot,
        clone_authority_id: &str,
    ) -> Result<CloneAuthorityRecord, CloneRuntimeError> {
        let verification = self.require_verified_root(resolved)?;
        let authority = self
            .lock_state()?
            .authority_leases
            .get(clone_authority_id)
            .cloned()
            .ok_or(CloneRuntimeError::AuthorityNotFound)?;
        if authority.expires_at_unix <= unix_now() {
            return Err(CloneRuntimeError::AuthorityExpired);
        }
        if authority.root_id != resolved.session.root_id.as_str()
            || authority.clone_verification_id != verification.clone_verification_id
            || authority.baseline_manifest_binding != verification.baseline_manifest_binding
        {
            return Err(CloneRuntimeError::AuthorityNotFound);
        }
        Ok(authority_record_from_lease(
            resolved,
            &authority,
            &verification,
        ))
    }

    pub fn baseline_evidence_id_for_root(
        &self,
        root_id: &RootId,
    ) -> Result<String, CloneRuntimeError> {
        let state = self.lock_state()?;
        state
            .verification_leases
            .values()
            .find(|lease| lease.root_id == root_id.as_str())
            .map(|lease| lease.baseline_evidence_id.clone())
            .ok_or(CloneRuntimeError::CloneNotVerified)
    }

    pub fn verification_status(
        &self,
        resolved: &ResolvedRoot,
    ) -> Result<Option<CloneVerificationStatus>, CloneRuntimeError> {
        let Some(record) = self.verification_for_root(&resolved.session.root_id)? else {
            return Ok(None);
        };
        Ok(Some(CloneVerificationStatus {
            clone_verification_id: record.clone_verification_id,
            clone_root_id: resolved.session.root_id.clone(),
            provenance: record.provenance,
            state: record.state,
            entry_count: record.baseline_entry_count,
            expires_in_seconds: record.expires_at_unix.saturating_sub(unix_now()),
        }))
    }

    pub fn restore_verification_from_baseline(
        &self,
        clone: &ResolvedRoot,
        baseline_evidence_id: &str,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        let baseline = self.load_baseline_evidence(baseline_evidence_id)?;
        let live_entries = scan_baseline_entries(&clone.canonical_path)?;
        if derive_manifest_binding(&live_entries) != baseline.manifest_binding
            || live_entries != baseline.entries
        {
            return Err(CloneRuntimeError::VerificationTampered);
        }
        let lease = self.issue_verification_lease(clone, &baseline)?;
        Ok(verification_record_from_lease(clone, &lease))
    }

    pub fn revoke_for_root(&self, root_id: &RootId) {
        if let Ok(mut state) = self.lock_state() {
            state
                .verification_leases
                .retain(|_, lease| lease.root_id != root_id.as_str());
            state
                .authority_leases
                .retain(|_, lease| lease.root_id != root_id.as_str());
        }
    }

    #[cfg(test)]
    pub fn install_test_verification(
        &self,
        resolved: &ResolvedRoot,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        let entries = scan_baseline_entries(&resolved.canonical_path)?;
        let manifest_binding = derive_manifest_binding(&entries);
        let clone_surface = derive_root_surface_id(&resolved.canonical_path);
        let baseline = build_baseline_evidence(
            CloneProvenance::External,
            &clone_surface,
            None,
            None,
            manifest_binding,
            entries,
        )?;
        persist_baseline_evidence(&self.artifact_store, &baseline)?;
        let lease = self.issue_verification_lease(resolved, &baseline)?;
        Ok(verification_record_from_lease(resolved, &lease))
    }

    fn validate_verification(
        &self,
        resolved: &ResolvedRoot,
        record: &CloneVerificationRecord,
    ) -> Result<CloneVerificationRecord, CloneRuntimeError> {
        if record.expires_at_unix <= unix_now() {
            return Err(CloneRuntimeError::VerificationExpired);
        }
        if record.state != CloneVerificationState::Verified {
            return Err(CloneRuntimeError::VerificationTampered);
        }
        if record.clone_root_id != resolved.session.root_id.as_str()
            || record.clone_device_fingerprint != resolved.session.device_fingerprint
        {
            return Err(CloneRuntimeError::VerificationNotFound);
        }
        let surface_id = derive_root_surface_id(&resolved.canonical_path);
        if surface_id != record.clone_surface_id {
            return Err(CloneRuntimeError::VerificationTampered);
        }
        let live_entries = scan_baseline_entries(&resolved.canonical_path)?;
        let live_binding = derive_manifest_binding(&live_entries);
        if live_binding != record.baseline_manifest_binding {
            return Err(CloneRuntimeError::VerificationTampered);
        }
        Ok(record.clone())
    }

    fn issue_verification_lease(
        &self,
        clone: &ResolvedRoot,
        baseline: &CloneBaselineEvidence,
    ) -> Result<CloneVerificationLease, CloneRuntimeError> {
        let now = unix_now();
        let lease = CloneVerificationLease {
            clone_verification_id: derive_clone_verification_id(
                clone.session.root_id.as_str(),
                &clone.session.device_fingerprint,
                &baseline.clone_surface_id,
                &baseline.manifest_binding,
            ),
            root_id: clone.session.root_id.as_str().to_owned(),
            clone_device_fingerprint: clone.session.device_fingerprint.clone(),
            baseline_evidence_id: baseline.baseline_evidence_id.clone(),
            clone_surface_id: baseline.clone_surface_id.clone(),
            provenance: baseline.provenance,
            source_evidence_id: baseline.source_evidence_id.clone(),
            baseline_manifest_binding: baseline.manifest_binding.clone(),
            baseline_entry_count: baseline.entry_count,
            state: CloneVerificationState::Verified,
            verified_at_unix: now,
            expires_at_unix: now + self.verification_ttl.as_secs(),
        };
        self.store_verification_lease(lease.clone());
        Ok(lease)
    }

    fn store_verification_lease(&self, lease: CloneVerificationLease) {
        if let Ok(mut state) = self.lock_state() {
            state
                .verification_leases
                .insert(lease.clone_verification_id.clone(), lease);
        }
    }

    fn store_authority_lease(&self, lease: CloneWriteAuthorityLease) {
        if let Ok(mut state) = self.lock_state() {
            state
                .authority_leases
                .insert(lease.clone_authority_id.clone(), lease);
        }
    }

    fn lock_state(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, CloneRuntimeState>, CloneRuntimeError> {
        self.state
            .lock()
            .map_err(|_| CloneRuntimeError::Unavailable)
    }
}

pub struct RegistryCloneWriteAuthority<'a> {
    registry: &'a RootRegistry,
    clone_runtime: &'a CloneRuntime,
    clone_authority_id: String,
    plan_root_id: RootId,
}

impl<'a> RegistryCloneWriteAuthority<'a> {
    pub fn new(
        registry: &'a RootRegistry,
        clone_runtime: &'a CloneRuntime,
        clone_authority_id: String,
        plan_root_id: RootId,
    ) -> Self {
        Self {
            registry,
            clone_runtime,
            clone_authority_id,
            plan_root_id,
        }
    }
}

impl CloneWriteAuthority for RegistryCloneWriteAuthority<'_> {
    fn resolve_clone_for_write(
        &self,
        root_id: &RootId,
    ) -> Result<VerifiedCloneRoot, AuthorityError> {
        if root_id != &self.plan_root_id {
            return Err(AuthorityError::NotApproved);
        }
        let resolved = self
            .registry
            .resolve(root_id)
            .map_err(map_registry_authority)?;
        self.clone_runtime
            .require_clone_authority(&resolved, &self.clone_authority_id)
            .map_err(|_| AuthorityError::NotApproved)?;
        if !resolved.session.capabilities.write {
            return Err(AuthorityError::ReadOnly);
        }
        if !resolved.session.capabilities.stable_device_identity {
            return Err(AuthorityError::UnstableIdentity);
        }
        self.clone_runtime
            .require_verified_root(&resolved)
            .map_err(|_| AuthorityError::NotApproved)?;
        Ok(VerifiedCloneRoot::attest_temporary_copy(
            ApprovedExecutionRoot {
                root_id: resolved.session.root_id,
                device_fingerprint: resolved.session.device_fingerprint,
                observed_revision: resolved.session.observed_revision,
                canonical_path: resolved.canonical_path,
                write_enabled: resolved.session.capabilities.write,
                stable_device_identity: resolved.session.capabilities.stable_device_identity,
            },
        ))
    }
}

pub fn open_shared_clone_runtime(
    data_directory: &Path,
) -> Result<SharedCloneRuntime, CloneRuntimeError> {
    fs::create_dir_all(data_directory).map_err(map_io_error)?;
    let canonical = data_directory.canonicalize().map_err(map_io_error)?;
    let storage_root = canonical.join(PRODUCT_DIRECTORY);
    ensure_real_directory(&canonical, &storage_root).map_err(map_local_artifact_error)?;
    CloneRuntime::new(storage_root, DEFAULT_VERIFICATION_TTL).map(Arc::new)
}

fn build_baseline_evidence(
    provenance: CloneProvenance,
    clone_surface_id: &str,
    source_evidence_id: Option<String>,
    managed_token: Option<String>,
    manifest_binding: String,
    entries: Vec<CloneBaselineEntry>,
) -> Result<CloneBaselineEvidence, CloneRuntimeError> {
    let baseline_evidence_id = derive_baseline_evidence_id(
        clone_surface_id,
        &manifest_binding,
        provenance,
        managed_token.as_deref(),
        source_evidence_id.as_deref(),
    );
    Ok(CloneBaselineEvidence {
        schema: CLONE_BASELINE_EVIDENCE_SCHEMA.to_owned(),
        baseline_evidence_id,
        provenance,
        clone_surface_id: clone_surface_id.to_owned(),
        source_evidence_id,
        managed_token,
        manifest_binding,
        entry_count: entries.len() as u64,
        entries,
        format_version: 1,
        created_at_unix: unix_now(),
    })
}

fn verification_record_from_lease(
    resolved: &ResolvedRoot,
    lease: &CloneVerificationLease,
) -> CloneVerificationRecord {
    CloneVerificationRecord {
        schema: CLONE_VERIFICATION_SCHEMA.to_owned(),
        clone_verification_id: lease.clone_verification_id.clone(),
        clone_root_id: resolved.session.root_id.as_str().to_owned(),
        clone_device_fingerprint: resolved.session.device_fingerprint.clone(),
        clone_surface_id: lease.clone_surface_id.clone(),
        provenance: lease.provenance,
        source_evidence_id: lease.source_evidence_id.clone(),
        baseline_entry_count: lease.baseline_entry_count,
        baseline_manifest_binding: lease.baseline_manifest_binding.clone(),
        state: lease.state,
        verified_at_unix: lease.verified_at_unix,
        expires_at_unix: lease.expires_at_unix,
    }
}

fn verification_record_from_lease_id(
    root_id: &RootId,
    lease: &CloneVerificationLease,
) -> CloneVerificationRecord {
    CloneVerificationRecord {
        schema: CLONE_VERIFICATION_SCHEMA.to_owned(),
        clone_verification_id: lease.clone_verification_id.clone(),
        clone_root_id: root_id.as_str().to_owned(),
        clone_device_fingerprint: lease.clone_device_fingerprint.clone(),
        clone_surface_id: lease.clone_surface_id.clone(),
        provenance: lease.provenance,
        source_evidence_id: lease.source_evidence_id.clone(),
        baseline_entry_count: lease.baseline_entry_count,
        baseline_manifest_binding: lease.baseline_manifest_binding.clone(),
        state: lease.state,
        verified_at_unix: lease.verified_at_unix,
        expires_at_unix: lease.expires_at_unix,
    }
}

fn authority_record_from_lease(
    resolved: &ResolvedRoot,
    authority: &CloneWriteAuthorityLease,
    verification: &CloneVerificationRecord,
) -> CloneAuthorityRecord {
    CloneAuthorityRecord {
        schema: CLONE_AUTHORITY_SCHEMA.to_owned(),
        clone_authority_id: authority.clone_authority_id.clone(),
        clone_verification_id: authority.clone_verification_id.clone(),
        clone_root_id: resolved.session.root_id.as_str().to_owned(),
        clone_device_fingerprint: resolved.session.device_fingerprint.clone(),
        clone_surface_id: verification.clone_surface_id.clone(),
        baseline_manifest_binding: authority.baseline_manifest_binding.clone(),
        issued_at_unix: authority.issued_at_unix,
        expires_at_unix: authority.expires_at_unix,
    }
}

fn derive_baseline_evidence_id(
    clone_surface_id: &str,
    manifest_binding: &str,
    provenance: CloneProvenance,
    managed_token: Option<&str>,
    source_evidence_id: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"clone-baseline-evidence:v1");
    hasher.update(clone_surface_id.as_bytes());
    hasher.update(manifest_binding.as_bytes());
    match provenance {
        CloneProvenance::AppManaged => hasher.update(b"app-managed"),
        CloneProvenance::External => hasher.update(b"external"),
    }
    if let Some(token) = managed_token {
        hasher.update(token.as_bytes());
    }
    if let Some(source_evidence_id) = source_evidence_id {
        hasher.update(source_evidence_id.as_bytes());
    }
    format!(
        "clone-baseline-evidence:v1:{}",
        hex_digest(&hasher.finalize())
    )
}

fn persist_baseline_evidence(
    artifact_store: &LocalArtifactStore,
    record: &CloneBaselineEvidence,
) -> Result<(), CloneRuntimeError> {
    let artifact_id = CloneBaselineEvidenceId::parse(&record.baseline_evidence_id)
        .map_err(|_| CloneRuntimeError::InvalidArtifactId)?;
    artifact_store
        .write_json_create_once(artifact_id.file_stem(), record)
        .map_err(map_local_artifact_error)
}

fn reject_source_clone_relationship(
    source: &ResolvedRoot,
    clone: &ResolvedRoot,
) -> Result<(), CloneRuntimeError> {
    if source.session.root_id == clone.session.root_id {
        return Err(CloneRuntimeError::SourceEqualsClone);
    }
    let source_surface = derive_root_surface_id(&source.canonical_path);
    let clone_surface = derive_root_surface_id(&clone.canonical_path);
    if source_surface == clone_surface {
        return Err(CloneRuntimeError::SourceEqualsClone);
    }
    if source.session.device_fingerprint == clone.session.device_fingerprint
        && source.canonical_path != clone.canonical_path
    {
        return Err(CloneRuntimeError::AmbiguousIdentity);
    }
    if clone.canonical_path.starts_with(&source.canonical_path)
        || source.canonical_path.starts_with(&clone.canonical_path)
    {
        return Err(CloneRuntimeError::NestedRoot);
    }
    Ok(())
}

pub fn derive_root_surface_id(canonical_path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"rootsurface:v1");
    hasher.update(canonical_path.as_os_str().as_encoded_bytes());
    format!("rootsurface:v1:{}", hex_digest(&hasher.finalize()))
}

fn derive_manifest_binding(entries: &[CloneBaselineEntry]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"clone-baseline-binding:v1");
    hasher.update((entries.len() as u64).to_be_bytes());
    for entry in entries {
        hasher.update(entry.relative_path.as_bytes());
        hasher.update(entry.byte_size.to_be_bytes());
        hasher.update(entry.content_hash.as_bytes());
    }
    format!(
        "clone-baseline-binding:v1:{}",
        hex_digest(&hasher.finalize())
    )
}

fn derive_source_evidence_id(
    root_id: &str,
    fingerprint: &str,
    surface_id: &str,
    manifest_binding: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"clone-source-evidence:v1");
    hasher.update(root_id.as_bytes());
    hasher.update(fingerprint.as_bytes());
    hasher.update(surface_id.as_bytes());
    hasher.update(manifest_binding.as_bytes());
    format!(
        "clone-source-evidence:v1:{}",
        hex_digest(&hasher.finalize())
    )
}

fn derive_managed_clone_token(root_id: &str, fingerprint: &str, surface_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"managed-clone:v1");
    hasher.update(root_id.as_bytes());
    hasher.update(fingerprint.as_bytes());
    hasher.update(surface_id.as_bytes());
    hasher.update(unix_now().to_be_bytes());
    hex_digest(&hasher.finalize())
}

fn derive_clone_verification_id(
    root_id: &str,
    fingerprint: &str,
    surface_id: &str,
    manifest_binding: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"clone-verification:v1");
    hasher.update(root_id.as_bytes());
    hasher.update(fingerprint.as_bytes());
    hasher.update(surface_id.as_bytes());
    hasher.update(manifest_binding.as_bytes());
    format!("clone-verification:v1:{}", hex_digest(&hasher.finalize()))
}

fn derive_clone_authority_id(
    verification_id: &str,
    root_id: &str,
    manifest_binding: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"clone-authority:v1");
    hasher.update(verification_id.as_bytes());
    hasher.update(root_id.as_bytes());
    hasher.update(manifest_binding.as_bytes());
    format!("clone-authority:v1:{}", hex_digest(&hasher.finalize()))
}

pub(crate) fn scan_baseline_entries(
    root: &Path,
) -> Result<Vec<CloneBaselineEntry>, CloneRuntimeError> {
    let mut entries = Vec::new();
    collect_baseline_entries(root, root, &mut entries)?;
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(entries)
}

fn collect_baseline_entries(
    root: &Path,
    path: &Path,
    entries: &mut Vec<CloneBaselineEntry>,
) -> Result<(), CloneRuntimeError> {
    let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() {
        return Err(CloneRuntimeError::SymlinkForbidden);
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(map_io_error)? {
            let entry = entry.map_err(map_io_error)?;
            collect_baseline_entries(root, &entry.path(), entries)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(CloneRuntimeError::SpecialFileForbidden);
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| CloneRuntimeError::Unavailable)?
        .to_string_lossy()
        .replace('\\', "/");
    entries.push(CloneBaselineEntry {
        relative_path: relative,
        byte_size: metadata.len(),
        content_hash: hash_file(path)?,
    });
    Ok(())
}

fn copy_tree_nofollow(from: &Path, to: &Path) -> Result<(), CloneRuntimeError> {
    fs::create_dir_all(to).map_err(map_io_error)?;
    for entry in fs::read_dir(from).map_err(map_io_error)? {
        let entry = entry.map_err(map_io_error)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(map_io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(CloneRuntimeError::SymlinkForbidden);
        }
        let dest = to.join(entry.file_name());
        if metadata.is_dir() {
            copy_tree_nofollow(&entry.path(), &dest)?;
        } else if metadata.is_file() {
            copy_file_nofollow(&entry.path(), &dest)?;
        } else {
            return Err(CloneRuntimeError::SpecialFileForbidden);
        }
    }
    Ok(())
}

fn copy_file_nofollow(source: &Path, destination: &Path) -> Result<(), CloneRuntimeError> {
    let mut input = open_file_nofollow(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(map_io_error)?;
    std::io::copy(&mut input, &mut output).map_err(map_io_error)?;
    output.sync_all().map_err(map_io_error)?;
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, CloneRuntimeError> {
    let mut file = open_file_nofollow(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(map_io_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{}", hex_digest(&hasher.finalize())))
}

fn open_file_nofollow(path: &Path) -> Result<File, CloneRuntimeError> {
    let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CloneRuntimeError::SymlinkForbidden);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(map_io_error)
    }
    #[cfg(not(unix))]
    {
        File::open(path).map_err(map_io_error)
    }
}

fn persist_source_evidence(
    artifact_store: &LocalArtifactStore,
    record: &CloneSourceEvidenceRecord,
) -> Result<(), CloneRuntimeError> {
    let artifact_id = CloneSourceEvidenceId::parse(&record.source_evidence_id)
        .map_err(|_| CloneRuntimeError::InvalidArtifactId)?;
    artifact_store
        .write_json_create_once(artifact_id.file_stem(), record)
        .map_err(map_local_artifact_error)
}

fn remove_path_if_exists(path: &Path) -> Result<(), CloneRuntimeError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(CloneRuntimeError::SymlinkForbidden)
        }
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path).map_err(map_io_error),
        Ok(_) => fs::remove_file(path).map_err(map_io_error),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(map_io_error(error)),
    }
}

fn purge_expired(state: &mut CloneRuntimeState) {
    let now = unix_now();
    state
        .verification_leases
        .retain(|_, lease| lease.expires_at_unix > now);
    state
        .authority_leases
        .retain(|_, lease| lease.expires_at_unix > now);
}

fn count_entries_for_binding(
    _binding: &str,
    _storage_root: &Path,
) -> Result<u64, CloneRuntimeError> {
    Ok(0)
}

pub(crate) fn current_unix_time() -> u64 {
    unix_now()
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn map_io_error(_error: std::io::Error) -> CloneRuntimeError {
    CloneRuntimeError::Io
}

fn map_local_artifact_error(error: LocalArtifactError) -> CloneRuntimeError {
    match error {
        LocalArtifactError::InvalidArtifactId => CloneRuntimeError::InvalidArtifactId,
        LocalArtifactError::ArtifactTampered => CloneRuntimeError::ArtifactTampered,
        LocalArtifactError::SymlinkForbidden => CloneRuntimeError::SymlinkForbidden,
        LocalArtifactError::NotRegularFile => CloneRuntimeError::Unavailable,
        LocalArtifactError::ContainmentViolation => CloneRuntimeError::Unavailable,
        LocalArtifactError::Io => CloneRuntimeError::Io,
    }
}

fn map_registry_authority(error: RootRegistryError) -> AuthorityError {
    match error {
        RootRegistryError::NotApproved => AuthorityError::NotApproved,
        RootRegistryError::Expired => AuthorityError::Expired,
        RootRegistryError::Removed => AuthorityError::Removed,
        RootRegistryError::Changed => AuthorityError::Changed,
        RootRegistryError::UnstableIdentity => AuthorityError::UnstableIdentity,
        other => AuthorityError::Unavailable(other.code().into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::root_registry::{DeviceIdentityProvider, DeviceObservation, RootRegistry};
    use std::path::Path;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct PathStableIdentity;

    impl DeviceIdentityProvider for PathStableIdentity {
        fn observe(&self, root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            let stable_key = root.to_string_lossy().into_owned();
            Ok(DeviceObservation {
                stable_key: stable_key.clone(),
                filesystem_type: Some("apfs".into()),
                total_capacity: Some(1024),
                mount_token: stable_key,
                stable: true,
            })
        }
    }

    fn write_fixture_tree(root: &Path) {
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::create_dir_all(root.join("SET/UNRELATED")).unwrap();
        fs::write(root.join("SET/AUDIO/kick.wav"), b"kick-bytes").unwrap();
        fs::write(root.join("SET/UNRELATED/keep.txt"), b"sentinel\n").unwrap();
    }

    #[test]
    fn managed_clone_preserves_source_and_verifies_clone() {
        let source_dir = TempDir::new().unwrap();
        write_fixture_tree(source_dir.path());
        let data_dir = TempDir::new().unwrap();
        let registry = RootRegistry::new(Arc::new(PathStableIdentity), Duration::from_secs(3600));
        let clone_runtime = open_shared_clone_runtime(data_dir.path()).unwrap();
        let source_session = registry
            .register(source_dir.path().to_str().unwrap())
            .unwrap();
        let source = registry.resolve(&source_session.root_id).unwrap();
        let source_before = fs::read(source_dir.path().join("SET/AUDIO/kick.wav")).unwrap();
        let host_observation = registry
            .stored_observation_for_root(&source_session.root_id)
            .unwrap();
        let (clone_path, clone_token, entries) = clone_runtime
            .create_managed_clone(&registry, &source)
            .unwrap();
        assert_eq!(
            source_before,
            fs::read(source_dir.path().join("SET/AUDIO/kick.wav")).unwrap()
        );
        registry.close(&source_session.root_id).unwrap();
        let clone_session = registry
            .register_managed_clone(
                clone_path.to_str().unwrap(),
                &host_observation,
                &clone_token,
                &derive_root_surface_id(&clone_path),
                &clone_runtime.managed_clones_root(),
                "",
                entries.len() as u64,
            )
            .unwrap();
        let clone = registry.resolve(&clone_session.root_id).unwrap();
        let verification = clone_runtime
            .verify_managed_clone_registration(&source, &clone, &entries, &clone_token)
            .unwrap();
        assert_eq!(verification.state, CloneVerificationState::Verified);
        clone_runtime.require_verified_root(&clone).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn managed_clone_rejects_symlink_in_source_tree() {
        use std::os::unix::fs::symlink;

        let source_dir = TempDir::new().unwrap();
        write_fixture_tree(source_dir.path());
        symlink(
            source_dir.path().join("SET/AUDIO/kick.wav"),
            source_dir.path().join("SET/AUDIO/link.wav"),
        )
        .unwrap();
        let data_dir = TempDir::new().unwrap();
        let registry = RootRegistry::new(Arc::new(PathStableIdentity), Duration::from_secs(3600));
        let clone_runtime = open_shared_clone_runtime(data_dir.path()).unwrap();
        let source_session = registry
            .register(source_dir.path().to_str().unwrap())
            .unwrap();
        let source = registry.resolve(&source_session.root_id).unwrap();
        let error = clone_runtime
            .create_managed_clone(&registry, &source)
            .unwrap_err();
        assert!(matches!(error, CloneRuntimeError::SymlinkForbidden));
    }

    #[test]
    fn verification_detects_post_verify_tampering() {
        let root = TempDir::new().unwrap();
        write_fixture_tree(root.path());
        let data_dir = TempDir::new().unwrap();
        let registry = RootRegistry::new(Arc::new(PathStableIdentity), Duration::from_secs(3600));
        let clone_runtime = open_shared_clone_runtime(data_dir.path()).unwrap();
        let session = registry.register(root.path().to_str().unwrap()).unwrap();
        let resolved = registry.resolve(&session.root_id).unwrap();
        clone_runtime.install_test_verification(&resolved).unwrap();
        fs::write(root.path().join("SET/AUDIO/kick.wav"), b"tampered").unwrap();
        let error = clone_runtime.require_verified_root(&resolved).unwrap_err();
        assert!(matches!(error, CloneRuntimeError::VerificationTampered));
    }

    #[test]
    fn source_equals_clone_surface_is_rejected() {
        let root = TempDir::new().unwrap();
        write_fixture_tree(root.path());
        let registry = RootRegistry::default();
        let session = registry.register(root.path().to_str().unwrap()).unwrap();
        let resolved = registry.resolve(&session.root_id).unwrap();
        let error = reject_source_clone_relationship(&resolved, &resolved).unwrap_err();
        assert!(matches!(error, CloneRuntimeError::SourceEqualsClone));
    }

    #[test]
    fn managed_clone_storage_avoids_double_product_directory() {
        let source_dir = TempDir::new().unwrap();
        write_fixture_tree(source_dir.path());
        let data_dir = TempDir::new().unwrap();
        let registry = RootRegistry::new(Arc::new(PathStableIdentity), Duration::from_secs(3600));
        let clone_runtime = open_shared_clone_runtime(data_dir.path()).unwrap();
        let source_session = registry
            .register(source_dir.path().to_str().unwrap())
            .unwrap();
        let source = registry.resolve(&source_session.root_id).unwrap();
        let (clone_path, _, _) = clone_runtime
            .create_managed_clone(&registry, &source)
            .unwrap();
        let expected_parent = data_dir
            .path()
            .join(PRODUCT_DIRECTORY)
            .join(MANAGED_CLONES_DIRECTORY);
        assert!(clone_path.starts_with(expected_parent.canonicalize().unwrap()));
        assert!(!clone_path
            .to_string_lossy()
            .contains("MasterOCTa/MasterOCTa"));
    }

    #[test]
    fn load_source_evidence_rejects_invalid_artifact_id() {
        let data_dir = TempDir::new().unwrap();
        let clone_runtime = open_shared_clone_runtime(data_dir.path()).unwrap();
        let error = clone_runtime
            .load_source_evidence("../etc/passwd")
            .unwrap_err();
        assert!(matches!(error, CloneRuntimeError::InvalidArtifactId));
    }

    #[cfg(unix)]
    #[test]
    fn baseline_scan_rejects_special_files() {
        use std::process::Command;

        let root = TempDir::new().unwrap();
        write_fixture_tree(root.path());
        let fifo = root.path().join("SET/AUDIO/pipe.fifo");
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo should exist on unix test hosts");
        let error = scan_baseline_entries(root.path()).unwrap_err();
        assert!(matches!(error, CloneRuntimeError::SpecialFileForbidden));
    }
}
