use ot_domain::RootId;
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceObservation {
    pub stable_key: String,
    pub filesystem_type: Option<String>,
    pub total_capacity: Option<u64>,
    pub mount_token: String,
    pub stable: bool,
}

impl DeviceObservation {
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
    pub capabilities: RootCapabilities,
}

#[derive(Clone)]
struct RootEntry {
    session: RootSession,
    canonical_path: PathBuf,
    observation: DeviceObservation,
    expires_at: Instant,
}

#[derive(Default)]
struct RegistryState {
    roots: HashMap<RootId, RootEntry>,
}

pub struct RootRegistry {
    state: Mutex<RegistryState>,
    identity_provider: Arc<dyn DeviceIdentityProvider>,
    ttl: Duration,
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
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
            ^ u128::from(std::process::id());
        Self {
            state: Mutex::new(RegistryState::default()),
            identity_provider,
            ttl,
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
            },
        );
        Ok(session)
    }

    pub fn resolve(&self, root_id: &RootId) -> Result<ResolvedRoot, RootRegistryError> {
        let mut state = self.lock_state()?;
        let Some(entry) = state.roots.get(root_id).cloned() else {
            return Err(RootRegistryError::NotApproved);
        };

        let now = Instant::now();
        if entry.expires_at <= now {
            state.roots.remove(root_id);
            return Err(RootRegistryError::Expired);
        }

        let observation = match self.identity_provider.observe(&entry.canonical_path) {
            Ok(observation) => observation,
            Err(error @ RootRegistryError::Removed) => {
                state.roots.remove(root_id);
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        if observation != entry.observation {
            state.roots.remove(root_id);
            return Err(RootRegistryError::Changed);
        }

        let mut session = entry.session;
        session.expires_in_seconds = entry.expires_at.saturating_duration_since(now).as_secs();
        Ok(ResolvedRoot {
            session,
            canonical_path: entry.canonical_path,
        })
    }

    pub fn close(&self, root_id: &RootId) -> Result<bool, RootRegistryError> {
        Ok(self.lock_state()?.roots.remove(root_id).is_some())
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
}
