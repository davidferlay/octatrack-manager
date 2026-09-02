use ot_domain::{RootId, RootRelativePath};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(8 * 60 * 60);
const DEFAULT_WRITE_GRANT_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceObservation {
    pub stable_key: String,
    pub filesystem_type: Option<String>,
    pub total_capacity: Option<u64>,
    pub mount_token: String,
    pub stable: bool,
}

impl DeviceObservation {
    pub fn managed_clone(
        host: &DeviceObservation,
        managed_token: &str,
        clone_surface_id: &str,
    ) -> Self {
        Self {
            stable_key: format!(
                "managed-clone:{}:{}:{}",
                host.stable_key, managed_token, clone_surface_id
            ),
            filesystem_type: host.filesystem_type.clone(),
            total_capacity: host.total_capacity,
            mount_token: format!("{}:managed:{managed_token}", host.mount_token),
            stable: true,
        }
    }

    fn fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"rootfp:v1");
        encode_required_string(&mut hasher, 1, &self.stable_key);
        encode_optional_string(&mut hasher, 2, self.filesystem_type.as_deref());
        encode_optional_u64(&mut hasher, 3, self.total_capacity);
        let digest = hasher.finalize();
        let lowercase_hex = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        format!("rootfp:v1:{lowercase_hex}")
    }
}

fn encode_required_string(hasher: &mut Sha256, field_tag: u8, value: &str) {
    hasher.update([field_tag]);
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}

fn encode_optional_string(hasher: &mut Sha256, field_tag: u8, value: Option<&str>) {
    hasher.update([field_tag]);
    match value {
        Some(value) => {
            hasher.update([1]);
            hasher.update((value.len() as u64).to_be_bytes());
            hasher.update(value.as_bytes());
        }
        None => hasher.update([0]),
    }
}

fn encode_optional_u64(hasher: &mut Sha256, field_tag: u8, value: Option<u64>) {
    hasher.update([field_tag]);
    match value {
        Some(value) => {
            hasher.update([1]);
            hasher.update(value.to_be_bytes());
        }
        None => hasher.update([0]),
    }
}

pub trait DeviceIdentityProvider: Send + Sync {
    fn observe(&self, root: &Path) -> Result<DeviceObservation, RootRegistryError>;
}

#[derive(Default)]
pub struct SystemDeviceIdentityProvider;

impl DeviceIdentityProvider for SystemDeviceIdentityProvider {
    fn observe(&self, root: &Path) -> Result<DeviceObservation, RootRegistryError> {
        let metadata = fs::metadata(root).map_err(map_observation_error)?;
        if !metadata.is_dir() {
            return Err(RootRegistryError::NotDirectory);
        }

        #[cfg(unix)]
        let (fallback_key, mount_token) = {
            use std::os::unix::fs::MetadataExt;
            (
                format!("unix-device:{}", metadata.dev()),
                format!("{}:{}", metadata.dev(), metadata.ino()),
            )
        };

        #[cfg(not(unix))]
        let (fallback_key, mount_token) = {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            (
                format!("platform-unstable:{modified}"),
                format!("{}:{modified}", root.to_string_lossy()),
            )
        };

        #[cfg(target_os = "macos")]
        if let Some(info) = read_macos_volume_info(root) {
            if let Some(volume_uuid) = info.volume_uuid {
                return Ok(DeviceObservation {
                    stable_key: format!("volume-uuid:{volume_uuid}"),
                    filesystem_type: info.filesystem_type,
                    total_capacity: info.total_capacity,
                    mount_token,
                    stable: true,
                });
            }
        }

        Ok(DeviceObservation {
            stable_key: fallback_key,
            filesystem_type: None,
            total_capacity: None,
            mount_token,
            stable: false,
        })
    }
}

fn map_observation_error(error: std::io::Error) -> RootRegistryError {
    if error.kind() == std::io::ErrorKind::NotFound {
        RootRegistryError::Removed
    } else {
        RootRegistryError::Io(error.to_string())
    }
}

#[cfg(target_os = "macos")]
struct MacosVolumeInfo {
    volume_uuid: Option<String>,
    filesystem_type: Option<String>,
    total_capacity: Option<u64>,
}

#[cfg(target_os = "macos")]
fn read_macos_volume_info(root: &Path) -> Option<MacosVolumeInfo> {
    let output = Command::new("/usr/sbin/diskutil")
        .args(["info", "-plist"])
        .arg(root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let plist = String::from_utf8(output.stdout).ok()?;
    Some(MacosVolumeInfo {
        volume_uuid: plist_string(&plist, "VolumeUUID"),
        filesystem_type: plist_string(&plist, "FilesystemType"),
        total_capacity: plist_integer(&plist, "TotalSize"),
    })
}

#[cfg(target_os = "macos")]
fn plist_value<'a>(plist: &'a str, key: &str, tag: &str) -> Option<&'a str> {
    let key_marker = format!("<key>{key}</key>");
    let after_key = plist.split_once(&key_marker)?.1;
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let after_open = after_key.split_once(&open)?.1;
    Some(after_open.split_once(&close)?.0.trim())
}

#[cfg(target_os = "macos")]
fn plist_string(plist: &str, key: &str) -> Option<String> {
    plist_value(plist, key, "string").map(str::to_owned)
}

#[cfg(target_os = "macos")]
fn plist_integer(plist: &str, key: &str) -> Option<u64> {
    plist_value(plist, key, "integer")?.parse().ok()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootCapabilities {
    pub read: bool,
    pub write: bool,
    pub stable_device_identity: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootSession {
    pub root_id: RootId,
    pub display_name: String,
    pub device_fingerprint: String,
    pub observed_revision: u64,
    pub expires_in_seconds: u64,
    pub write_grant_expires_in_seconds: Option<u64>,
    pub capabilities: RootCapabilities,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RootRegistrationKind {
    UserPath,
    ManagedClone,
}

#[derive(Clone)]
struct RootEntry {
    session: RootSession,
    canonical_path: PathBuf,
    observation: DeviceObservation,
    expires_at: Instant,
    write_expires_at: Option<Instant>,
    registration_kind: RootRegistrationKind,
    managed_clones_root: Option<PathBuf>,
}

#[derive(Default)]
struct RegistryState {
    roots: HashMap<RootId, RootEntry>,
}

pub struct RootRegistry {
    state: Mutex<RegistryState>,
    identity_provider: Arc<dyn DeviceIdentityProvider>,
    ttl: Duration,
    write_ttl: Duration,
    nonce: u128,
    next_id: AtomicU64,
}

impl Default for RootRegistry {
    fn default() -> Self {
        Self::new(Arc::new(SystemDeviceIdentityProvider), DEFAULT_SESSION_TTL)
    }
}

impl RootRegistry {
    pub fn new(identity_provider: Arc<dyn DeviceIdentityProvider>, ttl: Duration) -> Self {
        Self::new_with_ttls(identity_provider, ttl, DEFAULT_WRITE_GRANT_TTL.min(ttl))
    }

    pub fn new_with_ttls(
        identity_provider: Arc<dyn DeviceIdentityProvider>,
        ttl: Duration,
        write_ttl: Duration,
    ) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
            ^ u128::from(std::process::id());
        Self {
            state: Mutex::new(RegistryState::default()),
            identity_provider,
            ttl,
            write_ttl: write_ttl.min(ttl),
            nonce,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn register(&self, raw_path: &str) -> Result<RootSession, RootRegistryError> {
        let candidate = Path::new(raw_path);
        if raw_path.trim().is_empty() || !candidate.is_absolute() {
            return Err(RootRegistryError::InvalidPath);
        }

        let canonical_path = candidate.canonicalize().map_err(map_registration_error)?;
        let metadata = fs::symlink_metadata(&canonical_path).map_err(map_registration_error)?;
        if !metadata.file_type().is_dir() {
            return Err(RootRegistryError::NotDirectory);
        }
        let observation = self.identity_provider.observe(&canonical_path)?;
        let fingerprint = observation.fingerprint();
        let now = Instant::now();
        let expires_at = now + self.ttl;
        let mut state = self.lock_state()?;

        let expired_ids = state
            .roots
            .iter()
            .filter(|(_, entry)| entry.expires_at <= now)
            .map(|(root_id, _)| root_id.clone())
            .collect::<Vec<_>>();
        for root_id in expired_ids {
            state.roots.remove(&root_id);
        }

        if state.roots.values().any(|entry| {
            entry.canonical_path != canonical_path
                && entry.session.device_fingerprint == fingerprint
        }) {
            return Err(RootRegistryError::AmbiguousIdentity);
        }

        let existing_root_id = state
            .roots
            .iter()
            .find(|(_, entry)| entry.canonical_path == canonical_path)
            .map(|(root_id, _)| root_id.clone());
        if let Some(existing_root_id) = existing_root_id {
            let observation_matches = state
                .roots
                .get(&existing_root_id)
                .is_some_and(|entry| entry.observation == observation);
            if observation_matches {
                let entry = state
                    .roots
                    .get_mut(&existing_root_id)
                    .ok_or(RootRegistryError::Unavailable)?;
                entry.expires_at = expires_at;
                entry.session.expires_in_seconds = self.ttl.as_secs();
                entry.write_expires_at = None;
                entry.session.write_grant_expires_in_seconds = None;
                entry.session.capabilities.write = false;
                return Ok(entry.session.clone());
            }

            // A newly selected device at the same mount path is a new authority.
            // Invalidate the stale session and issue a fresh opaque identifier.
            state.roots.remove(&existing_root_id);
        }

        let root_id = self.new_root_id(&canonical_path)?;
        let display_name = canonical_path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("Octatrack Root")
            .to_owned();
        let session = RootSession {
            root_id: root_id.clone(),
            display_name,
            device_fingerprint: fingerprint,
            observed_revision: 1,
            expires_in_seconds: self.ttl.as_secs(),
            write_grant_expires_in_seconds: None,
            capabilities: RootCapabilities {
                read: true,
                write: false,
                stable_device_identity: observation.stable,
            },
        };
        state.roots.insert(
            root_id,
            RootEntry {
                session: session.clone(),
                canonical_path,
                observation,
                expires_at,
                write_expires_at: None,
                registration_kind: RootRegistrationKind::UserPath,
                managed_clones_root: None,
            },
        );
        Ok(session)
    }

    pub fn register_managed_clone(
        &self,
        raw_path: &str,
        host_observation: &DeviceObservation,
        managed_token: &str,
        clone_surface_id: &str,
        managed_clones_root: &Path,
        baseline_manifest_binding: &str,
        expected_entry_count: u64,
    ) -> Result<RootSession, RootRegistryError> {
        let candidate = Path::new(raw_path);
        if raw_path.trim().is_empty() || !candidate.is_absolute() {
            return Err(RootRegistryError::InvalidPath);
        }
        let canonical_path = candidate.canonicalize().map_err(map_registration_error)?;
        let metadata = fs::symlink_metadata(&canonical_path).map_err(map_registration_error)?;
        if !metadata.file_type().is_dir() {
            return Err(RootRegistryError::NotDirectory);
        }
        let managed_root = managed_clones_root
            .canonicalize()
            .map_err(map_registration_error)?;
        if !canonical_path.starts_with(&managed_root) {
            return Err(RootRegistryError::PathEscape);
        }
        let token_component = canonical_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(RootRegistryError::InvalidPath)?;
        if token_component != managed_token {
            return Err(RootRegistryError::InvalidPath);
        }
        if !host_observation.stable {
            return Err(RootRegistryError::UnstableIdentity);
        }
        let observation =
            DeviceObservation::managed_clone(host_observation, managed_token, clone_surface_id);
        let fingerprint = observation.fingerprint();
        let now = Instant::now();
        let expires_at = now + self.ttl;
        let mut state = self.lock_state()?;

        let expired_ids = state
            .roots
            .iter()
            .filter(|(_, entry)| entry.expires_at <= now)
            .map(|(root_id, _)| root_id.clone())
            .collect::<Vec<_>>();
        for root_id in expired_ids {
            state.roots.remove(&root_id);
        }

        if state.roots.values().any(|entry| {
            entry.canonical_path != canonical_path
                && entry.session.device_fingerprint == fingerprint
        }) {
            return Err(RootRegistryError::AmbiguousIdentity);
        }

        let existing_root_id = state
            .roots
            .iter()
            .find(|(_, entry)| entry.canonical_path == canonical_path)
            .map(|(root_id, _)| root_id.clone());
        if let Some(existing_root_id) = existing_root_id {
            let entry = state
                .roots
                .get(&existing_root_id)
                .ok_or(RootRegistryError::Unavailable)?;
            if entry.registration_kind != RootRegistrationKind::ManagedClone
                || entry.observation != observation
                || entry.managed_clones_root.as_deref() != Some(managed_root.as_path())
            {
                state.roots.remove(&existing_root_id);
            } else {
                let entry = state
                    .roots
                    .get_mut(&existing_root_id)
                    .ok_or(RootRegistryError::Unavailable)?;
                entry.expires_at = expires_at;
                entry.session.expires_in_seconds = self.ttl.as_secs();
                entry.write_expires_at = None;
                entry.session.write_grant_expires_in_seconds = None;
                entry.session.capabilities.write = false;
                return Ok(entry.session.clone());
            }
        }

        let _ = (baseline_manifest_binding, expected_entry_count);
        let root_id = self.new_root_id(&canonical_path)?;
        let display_name = format!("Managed Clone ({managed_token})");
        let session = RootSession {
            root_id: root_id.clone(),
            display_name,
            device_fingerprint: fingerprint,
            observed_revision: 1,
            expires_in_seconds: self.ttl.as_secs(),
            write_grant_expires_in_seconds: None,
            capabilities: RootCapabilities {
                read: true,
                write: false,
                stable_device_identity: true,
            },
        };
        state.roots.insert(
            root_id,
            RootEntry {
                session: session.clone(),
                canonical_path,
                observation,
                expires_at,
                write_expires_at: None,
                registration_kind: RootRegistrationKind::ManagedClone,
                managed_clones_root: Some(managed_root),
            },
        );
        Ok(session)
    }

    fn refresh_observation(
        &self,
        entry: &RootEntry,
    ) -> Result<DeviceObservation, RootRegistryError> {
        let metadata =
            fs::symlink_metadata(&entry.canonical_path).map_err(map_observation_error)?;
        if !metadata.is_dir() {
            return Err(RootRegistryError::Removed);
        }
        if entry.registration_kind == RootRegistrationKind::ManagedClone {
            if let Some(managed_root) = entry.managed_clones_root.as_ref() {
                let managed_root = managed_root.canonicalize().map_err(map_observation_error)?;
                if !entry.canonical_path.starts_with(&managed_root) {
                    return Err(RootRegistryError::PathEscape);
                }
            }
            return Ok(entry.observation.clone());
        }
        let observation = self.identity_provider.observe(&entry.canonical_path)?;
        if observation != entry.observation {
            return Err(RootRegistryError::Changed);
        }
        Ok(observation)
    }

    pub fn stored_observation_for_root(
        &self,
        root_id: &RootId,
    ) -> Result<DeviceObservation, RootRegistryError> {
        let state = self.lock_state()?;
        state
            .roots
            .get(root_id)
            .map(|entry| entry.observation.clone())
            .ok_or(RootRegistryError::NotApproved)
    }

    pub fn resolve(&self, root_id: &RootId) -> Result<ResolvedRoot, RootRegistryError> {
        let mut state = self.lock_state()?;
        let Some(entry) = state.roots.get_mut(root_id) else {
            return Err(RootRegistryError::NotApproved);
        };

        let now = Instant::now();
        if entry.expires_at <= now {
            state.roots.remove(root_id);
            return Err(RootRegistryError::Expired);
        }
        if entry
            .write_expires_at
            .is_some_and(|expires_at| expires_at <= now)
        {
            entry.write_expires_at = None;
            entry.session.write_grant_expires_in_seconds = None;
            entry.session.capabilities.write = false;
        }
        let entry = entry.clone();

        if let Err(error @ RootRegistryError::Removed | error @ RootRegistryError::Changed) =
            self.refresh_observation(&entry)
        {
            state.roots.remove(root_id);
            return Err(error);
        }

        let mut session = entry.session;
        session.expires_in_seconds = entry.expires_at.saturating_duration_since(now).as_secs();
        session.write_grant_expires_in_seconds = entry
            .write_expires_at
            .map(|expires_at| expires_at.saturating_duration_since(now).as_secs());
        Ok(ResolvedRoot {
            session,
            canonical_path: entry.canonical_path,
        })
    }

    pub fn enable_write(&self, root_id: &RootId) -> Result<RootSession, RootRegistryError> {
        let now = Instant::now();
        let mut state = self.lock_state()?;
        let entry = state
            .roots
            .get(root_id)
            .cloned()
            .ok_or(RootRegistryError::NotApproved)?;
        if entry.expires_at <= now {
            state.roots.remove(root_id);
            return Err(RootRegistryError::Expired);
        }
        let observation = match self.refresh_observation(&entry) {
            Ok(observation) => observation,
            Err(error @ RootRegistryError::Removed | error @ RootRegistryError::Changed) => {
                state.roots.remove(root_id);
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        if !observation.stable {
            return Err(RootRegistryError::UnstableIdentity);
        }

        let entry = state
            .roots
            .get_mut(root_id)
            .ok_or(RootRegistryError::NotApproved)?;
        let write_expires_at = (now + self.write_ttl).min(entry.expires_at);
        entry.write_expires_at = Some(write_expires_at);
        entry.session.capabilities.write = write_expires_at > now;
        entry.session.write_grant_expires_in_seconds = entry
            .session
            .capabilities
            .write
            .then(|| write_expires_at.saturating_duration_since(now).as_secs());
        entry.session.expires_in_seconds =
            entry.expires_at.saturating_duration_since(now).as_secs();
        Ok(entry.session.clone())
    }

    pub fn disable_write(&self, root_id: &RootId) -> Result<RootSession, RootRegistryError> {
        let now = Instant::now();
        let mut state = self.lock_state()?;
        let expired = state
            .roots
            .get(root_id)
            .ok_or(RootRegistryError::NotApproved)?
            .expires_at
            <= now;
        if expired {
            state.roots.remove(root_id);
            return Err(RootRegistryError::Expired);
        }
        let entry = state
            .roots
            .get_mut(root_id)
            .ok_or(RootRegistryError::NotApproved)?;
        entry.write_expires_at = None;
        entry.session.write_grant_expires_in_seconds = None;
        entry.session.capabilities.write = false;
        entry.session.expires_in_seconds =
            entry.expires_at.saturating_duration_since(now).as_secs();
        Ok(entry.session.clone())
    }

    pub fn close(&self, root_id: &RootId) -> Result<bool, RootRegistryError> {
        Ok(self.lock_state()?.roots.remove(root_id).is_some())
    }

    /// Binds a successfully completed catalog scan revision to the live session.
    /// Fails closed when the root changed, expired, or the revision would regress.
    pub fn record_completed_scan_revision(
        &self,
        root_id: &RootId,
        scan_revision: u64,
    ) -> Result<RootSession, RootRegistryError> {
        if scan_revision == 0 {
            return Err(RootRegistryError::Unavailable);
        }

        let now = Instant::now();
        let mut state = self.lock_state()?;
        let Some(entry) = state.roots.get_mut(root_id) else {
            return Err(RootRegistryError::NotApproved);
        };
        if entry.expires_at <= now {
            state.roots.remove(root_id);
            return Err(RootRegistryError::Expired);
        }

        if let Err(error @ RootRegistryError::Removed | error @ RootRegistryError::Changed) =
            self.refresh_observation(entry)
        {
            state.roots.remove(root_id);
            return Err(error);
        }
        if scan_revision < entry.session.observed_revision {
            return Err(RootRegistryError::Changed);
        }

        entry.session.observed_revision = scan_revision;
        entry.session.expires_in_seconds =
            entry.expires_at.saturating_duration_since(now).as_secs();
        Ok(entry.session.clone())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, RegistryState>, RootRegistryError> {
        self.state
            .lock()
            .map_err(|_| RootRegistryError::Unavailable)
    }

    fn new_root_id(&self, canonical_path: &Path) -> Result<RootId, RootRegistryError> {
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut hasher = DefaultHasher::new();
        self.nonce.hash(&mut hasher);
        sequence.hash(&mut hasher);
        canonical_path.hash(&mut hasher);
        RootId::new(format!("root-{:016x}", hasher.finish()))
            .map_err(|_| RootRegistryError::Unavailable)
    }
}

fn map_registration_error(error: std::io::Error) -> RootRegistryError {
    match error.kind() {
        std::io::ErrorKind::NotFound => RootRegistryError::Removed,
        std::io::ErrorKind::PermissionDenied => RootRegistryError::PermissionDenied,
        _ => RootRegistryError::Io(error.to_string()),
    }
}

#[derive(Clone, Debug)]
pub struct ResolvedRoot {
    pub session: RootSession,
    pub canonical_path: PathBuf,
}

impl ResolvedRoot {
    pub fn resolve_regular_file(
        &self,
        relative_path: &RootRelativePath,
    ) -> Result<PathBuf, RootRegistryError> {
        let mut candidate = self.canonical_path.clone();
        let components = relative_path.as_str().split('/').collect::<Vec<_>>();
        for (index, component) in components.iter().enumerate() {
            if component.is_empty() || *component == "." || *component == ".." {
                return Err(RootRegistryError::PathEscape);
            }
            candidate.push(component);
            let metadata = fs::symlink_metadata(&candidate).map_err(map_resolve_file_error)?;
            if metadata.file_type().is_symlink() {
                return Err(RootRegistryError::SymlinkEscape);
            }
            let is_last = index + 1 == components.len();
            if (!is_last && !metadata.is_dir()) || (is_last && !metadata.is_file()) {
                return Err(RootRegistryError::NotRegularFile);
            }
        }

        let canonical = candidate.canonicalize().map_err(map_resolve_file_error)?;
        if !canonical.starts_with(&self.canonical_path) {
            return Err(RootRegistryError::PathEscape);
        }
        Ok(canonical)
    }
}

fn map_resolve_file_error(error: std::io::Error) -> RootRegistryError {
    match error.kind() {
        std::io::ErrorKind::NotFound => RootRegistryError::NotRegularFile,
        std::io::ErrorKind::PermissionDenied => RootRegistryError::PermissionDenied,
        _ => RootRegistryError::Io(error.to_string()),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RootRegistryError {
    InvalidPath,
    NotDirectory,
    PermissionDenied,
    NotApproved,
    Expired,
    Removed,
    Changed,
    AmbiguousIdentity,
    UnstableIdentity,
    PathEscape,
    SymlinkEscape,
    NotRegularFile,
    Io(String),
    Unavailable,
}

impl RootRegistryError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPath
            | Self::NotDirectory
            | Self::PermissionDenied
            | Self::NotApproved
            | Self::Expired => "ROOT_NOT_APPROVED",
            Self::Removed => "ROOT_REMOVED",
            Self::Changed => "ROOT_CHANGED",
            Self::AmbiguousIdentity => "ROOT_IDENTITY_AMBIGUOUS",
            Self::UnstableIdentity => "WRITE_NOT_SUPPORTED",
            Self::PathEscape => "PATH_ESCAPE",
            Self::SymlinkEscape => "SYMLINK_ESCAPE",
            Self::NotRegularFile => "AUDIO_SOURCE_UNAVAILABLE",
            Self::Io(_) | Self::Unavailable => "ROOT_UNAVAILABLE",
        }
    }

    pub fn recoverable(&self) -> bool {
        !matches!(self, Self::Unavailable)
    }
}

impl std::fmt::Display for RootRegistryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath => formatter.write_str("the selected root must be an absolute path"),
            Self::NotDirectory => formatter.write_str("the selected root is not a directory"),
            Self::PermissionDenied => formatter.write_str("the selected root cannot be read"),
            Self::NotApproved => formatter.write_str("the root is not registered"),
            Self::Expired => formatter.write_str("the root session has expired"),
            Self::Removed => formatter.write_str("the registered root is no longer available"),
            Self::Changed => formatter.write_str("the registered root or device identity changed"),
            Self::AmbiguousIdentity => formatter
                .write_str("another registered root has the same persistent device identity"),
            Self::UnstableIdentity => {
                formatter.write_str("the root does not have a stable device identity")
            }
            Self::PathEscape => {
                formatter.write_str("the requested file escaped the registered root")
            }
            Self::SymlinkEscape => {
                formatter.write_str("the requested file traverses a symbolic link")
            }
            Self::NotRegularFile => formatter.write_str("the requested path is not a regular file"),
            Self::Io(message) => {
                write!(
                    formatter,
                    "could not inspect the registered root: {message}"
                )
            }
            Self::Unavailable => formatter.write_str("the root registry is unavailable"),
        }
    }
}

impl std::error::Error for RootRegistryError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use tempfile::TempDir;

    struct FakeIdentityProvider {
        revision: AtomicU64,
        mount_revision: AtomicU64,
    }

    impl FakeIdentityProvider {
        fn new() -> Self {
            Self {
                revision: AtomicU64::new(1),
                mount_revision: AtomicU64::new(1),
            }
        }

        fn change_device(&self) {
            self.revision.fetch_add(1, Ordering::SeqCst);
        }

        fn remount(&self) {
            self.mount_revision.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl DeviceIdentityProvider for FakeIdentityProvider {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            let revision = self.revision.load(Ordering::SeqCst);
            let mount_revision = self.mount_revision.load(Ordering::SeqCst);
            Ok(DeviceObservation {
                stable_key: format!("volume-{revision}"),
                filesystem_type: Some("testfs".into()),
                total_capacity: Some(1024),
                mount_token: format!("mount-{mount_revision}"),
                stable: true,
            })
        }
    }

    struct UnstableIdentityProvider;

    impl DeviceIdentityProvider for UnstableIdentityProvider {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            Ok(DeviceObservation {
                stable_key: "fallback-device".into(),
                filesystem_type: None,
                total_capacity: None,
                mount_token: "fallback-mount".into(),
                stable: false,
            })
        }
    }

    fn fingerprint_fixture() -> DeviceObservation {
        DeviceObservation {
            stable_key: "volume-uuid:01234567-89AB-CDEF-0123-456789ABCDEF".into(),
            filesystem_type: Some("apfs".into()),
            total_capacity: Some(128_000_000_000),
            mount_token: "mount-session-1".into(),
            stable: true,
        }
    }

    #[test]
    fn persistent_fingerprint_has_a_versioned_golden_value() {
        assert_eq!(
            fingerprint_fixture().fingerprint(),
            "rootfp:v1:4342d1c11ddd19d77837ab238289322643d73359cd6f3f4ff5e013c3d48b213d"
        );
        assert_eq!(
            fingerprint_fixture().fingerprint(),
            fingerprint_fixture().fingerprint()
        );
    }

    #[test]
    fn persistent_fingerprint_detects_each_identity_field_change() {
        let baseline = fingerprint_fixture();
        let mut stable_key = baseline.clone();
        stable_key.stable_key.push_str("-replacement");
        let mut filesystem_type = baseline.clone();
        filesystem_type.filesystem_type = Some("exfat".into());
        let mut total_capacity = baseline.clone();
        total_capacity.total_capacity = Some(256_000_000_000);

        assert_ne!(baseline.fingerprint(), stable_key.fingerprint());
        assert_ne!(baseline.fingerprint(), filesystem_type.fingerprint());
        assert_ne!(baseline.fingerprint(), total_capacity.fingerprint());
    }

    #[test]
    fn persistent_fingerprint_distinguishes_missing_and_empty_fields() {
        let mut missing_filesystem = fingerprint_fixture();
        missing_filesystem.filesystem_type = None;
        let mut empty_filesystem = fingerprint_fixture();
        empty_filesystem.filesystem_type = Some(String::new());
        let mut missing_capacity = fingerprint_fixture();
        missing_capacity.total_capacity = None;
        let mut zero_capacity = fingerprint_fixture();
        zero_capacity.total_capacity = Some(0);

        assert_ne!(
            missing_filesystem.fingerprint(),
            empty_filesystem.fingerprint()
        );
        assert_ne!(missing_capacity.fingerprint(), zero_capacity.fingerprint());
    }

    #[test]
    fn mount_token_and_absolute_path_are_not_persistent_identity_inputs() {
        let baseline = fingerprint_fixture();
        let mut remounted = baseline.clone();
        remounted.mount_token = "/Volumes/OCTATRACK/private/session-2".into();

        assert_eq!(baseline.fingerprint(), remounted.fingerprint());
        assert!(!remounted.fingerprint().contains("/Volumes/OCTATRACK"));
    }

    #[test]
    fn duplicate_registration_reuses_the_opaque_id() {
        let root = TempDir::new().unwrap();
        let registry = RootRegistry::new(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
        );

        let first = registry.register(root.path().to_str().unwrap()).unwrap();
        let second = registry.register(root.path().to_str().unwrap()).unwrap();

        assert_eq!(first.root_id, second.root_id);
        assert!(!first
            .root_id
            .as_str()
            .contains(root.path().to_str().unwrap()));
        assert!(!first.capabilities.write);
        assert_eq!(first.write_grant_expires_in_seconds, None);
    }

    #[test]
    fn stable_roots_receive_only_a_session_limited_write_grant() {
        let root = TempDir::new().unwrap();
        let registry = RootRegistry::new_with_ttls(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
            Duration::from_secs(10),
        );
        let registered = registry.register(root.path().to_str().unwrap()).unwrap();

        let enabled = registry.enable_write(&registered.root_id).unwrap();

        assert!(enabled.capabilities.write);
        assert!(enabled.write_grant_expires_in_seconds.is_some());
        assert!(enabled.write_grant_expires_in_seconds.unwrap() <= 10);
        assert!(
            registry
                .resolve(&registered.root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );

        let registered_again = registry.register(root.path().to_str().unwrap()).unwrap();
        assert_eq!(registered_again.root_id, registered.root_id);
        assert!(!registered_again.capabilities.write);
        assert_eq!(registered_again.write_grant_expires_in_seconds, None);
    }

    #[test]
    fn write_grant_can_be_revoked_without_closing_the_read_session() {
        let root = TempDir::new().unwrap();
        let registry = RootRegistry::new_with_ttls(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
            Duration::from_secs(10),
        );
        let registered = registry.register(root.path().to_str().unwrap()).unwrap();
        assert!(
            registry
                .enable_write(&registered.root_id)
                .unwrap()
                .capabilities
                .write
        );

        let disabled = registry.disable_write(&registered.root_id).unwrap();

        assert!(disabled.capabilities.read);
        assert!(!disabled.capabilities.write);
        assert_eq!(disabled.write_grant_expires_in_seconds, None);
        assert!(
            !registry
                .resolve(&registered.root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );
    }

    #[test]
    fn unstable_roots_never_receive_a_write_grant() {
        let root = TempDir::new().unwrap();
        let registry =
            RootRegistry::new(Arc::new(UnstableIdentityProvider), Duration::from_secs(60));
        let registered = registry.register(root.path().to_str().unwrap()).unwrap();

        assert_eq!(
            registry.enable_write(&registered.root_id).unwrap_err(),
            RootRegistryError::UnstableIdentity
        );
        assert!(
            !registry
                .resolve(&registered.root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );
    }

    #[test]
    fn expired_write_grants_fall_back_to_read_only_without_expiring_the_root() {
        let root = TempDir::new().unwrap();
        let registry = RootRegistry::new_with_ttls(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
            Duration::ZERO,
        );
        let registered = registry.register(root.path().to_str().unwrap()).unwrap();

        let enabled = registry.enable_write(&registered.root_id).unwrap();
        assert!(!enabled.capabilities.write);
        assert_eq!(enabled.write_grant_expires_in_seconds, None);
        assert!(
            !registry
                .resolve(&registered.root_id)
                .unwrap()
                .session
                .capabilities
                .write
        );
    }

    #[test]
    fn different_roots_with_the_same_persistent_identity_are_rejected() {
        let first_root = TempDir::new().unwrap();
        let second_root = TempDir::new().unwrap();
        let registry = RootRegistry::new(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
        );
        let first = registry
            .register(first_root.path().to_str().unwrap())
            .unwrap();

        let error = registry
            .register(second_root.path().to_str().unwrap())
            .unwrap_err();

        assert_eq!(error, RootRegistryError::AmbiguousIdentity);
        assert!(registry.resolve(&first.root_id).is_ok());
    }

    #[test]
    fn unknown_and_expired_ids_are_rejected() {
        let root = TempDir::new().unwrap();
        let registry = RootRegistry::new(Arc::new(FakeIdentityProvider::new()), Duration::ZERO);
        let session = registry.register(root.path().to_str().unwrap()).unwrap();

        assert_eq!(
            registry.resolve(&session.root_id).unwrap_err(),
            RootRegistryError::Expired
        );
        assert_eq!(
            registry
                .resolve(&RootId::new("unknown-root").unwrap())
                .unwrap_err(),
            RootRegistryError::NotApproved
        );
    }

    #[test]
    fn removal_invalidates_the_session() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        fs::create_dir(&root).unwrap();
        let registry = RootRegistry::new(
            Arc::new(SystemDeviceIdentityProvider),
            Duration::from_secs(60),
        );
        let session = registry.register(root.to_str().unwrap()).unwrap();

        fs::remove_dir(&root).unwrap();

        assert_eq!(
            registry.resolve(&session.root_id).unwrap_err(),
            RootRegistryError::Removed
        );
    }

    #[test]
    fn fingerprint_change_invalidates_the_session() {
        let root = TempDir::new().unwrap();
        let provider = Arc::new(FakeIdentityProvider::new());
        let registry = RootRegistry::new(provider.clone(), Duration::from_secs(60));
        let session = registry.register(root.path().to_str().unwrap()).unwrap();

        provider.change_device();

        assert_eq!(
            registry.resolve(&session.root_id).unwrap_err(),
            RootRegistryError::Changed
        );
    }

    #[test]
    fn remount_invalidates_the_session_even_when_the_fingerprint_is_unchanged() {
        let root = TempDir::new().unwrap();
        let provider = Arc::new(FakeIdentityProvider::new());
        let registry = RootRegistry::new(provider.clone(), Duration::from_secs(60));
        let session = registry.register(root.path().to_str().unwrap()).unwrap();
        registry.enable_write(&session.root_id).unwrap();

        provider.remount();

        assert_eq!(
            registry.resolve(&session.root_id).unwrap_err(),
            RootRegistryError::Changed
        );
    }

    #[test]
    fn registering_replacement_media_issues_a_new_session() {
        let root = TempDir::new().unwrap();
        let provider = Arc::new(FakeIdentityProvider::new());
        let registry = RootRegistry::new(provider.clone(), Duration::from_secs(60));
        let first = registry.register(root.path().to_str().unwrap()).unwrap();

        provider.change_device();
        let second = registry.register(root.path().to_str().unwrap()).unwrap();

        assert_ne!(first.root_id, second.root_id);
        assert_eq!(
            registry.resolve(&first.root_id).unwrap_err(),
            RootRegistryError::NotApproved
        );
        assert!(registry.resolve(&second.root_id).is_ok());
    }

    #[test]
    fn resolved_root_opens_only_validated_regular_files() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("AUDIO")).unwrap();
        fs::write(root.path().join("AUDIO/kick.wav"), b"fixture").unwrap();
        let registry = RootRegistry::new(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
        );
        let session = registry.register(root.path().to_str().unwrap()).unwrap();
        let resolved = registry.resolve(&session.root_id).unwrap();
        let relative = RootRelativePath::parse("AUDIO/kick.wav").unwrap();

        let path = resolved.resolve_regular_file(&relative).unwrap();

        assert_eq!(fs::read(path).unwrap(), b"fixture");
    }

    #[cfg(unix)]
    #[test]
    fn resolved_root_rejects_symlinked_components() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("outside.wav"), b"private fixture").unwrap();
        symlink(outside.path(), root.path().join("AUDIO")).unwrap();
        let registry = RootRegistry::new(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
        );
        let session = registry.register(root.path().to_str().unwrap()).unwrap();
        let resolved = registry.resolve(&session.root_id).unwrap();
        let relative = RootRelativePath::parse("AUDIO/outside.wav").unwrap();

        let error = resolved.resolve_regular_file(&relative).unwrap_err();

        assert_eq!(error, RootRegistryError::SymlinkEscape);
        assert_eq!(
            fs::read(outside.path().join("outside.wav")).unwrap(),
            b"private fixture"
        );
    }

    #[test]
    fn completed_scan_revision_advances_monotonically_and_rejects_regression() {
        let root = TempDir::new().unwrap();
        let registry = RootRegistry::new(
            Arc::new(FakeIdentityProvider::new()),
            Duration::from_secs(60),
        );
        let session = registry.register(root.path().to_str().unwrap()).unwrap();
        assert_eq!(session.observed_revision, 1);

        let updated = registry
            .record_completed_scan_revision(&session.root_id, 3)
            .unwrap();
        assert_eq!(updated.observed_revision, 3);

        let refreshed = registry
            .record_completed_scan_revision(&session.root_id, 3)
            .unwrap();
        assert_eq!(refreshed.observed_revision, 3);

        assert_eq!(
            registry
                .record_completed_scan_revision(&session.root_id, 2)
                .unwrap_err(),
            RootRegistryError::Changed
        );
    }
}
