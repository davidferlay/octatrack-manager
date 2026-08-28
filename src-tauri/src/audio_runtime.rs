use ot_audio::{create_preview, AudioError, WaveformCache, WaveformSlice};
use ot_domain::{ContentHash, RootId};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const WAVEFORM_CACHE_DIRECTORY: &str = "waveform-cache";
const DEFAULT_PREVIEW_TTL: Duration = Duration::from_secs(2 * 60);
const MAX_PREVIEW_TOKENS: usize = 8;

pub type SharedAudioRuntime = Arc<AudioRuntime>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreviewTicket {
    pub token: String,
    pub expires_in_seconds: u64,
    pub byte_length: usize,
    pub duration_millis: u64,
    pub truncated: bool,
}

struct PreviewRecord {
    root_id: RootId,
    bytes: Vec<u8>,
    expires_at: Instant,
}

#[derive(Default)]
struct PreviewState {
    records: HashMap<String, PreviewRecord>,
}

pub struct AudioRuntime {
    waveform_cache: WaveformCache,
    previews: Mutex<PreviewState>,
    preview_generation: Mutex<()>,
    preview_ttl: Duration,
    nonce: u128,
    next_token: AtomicU64,
}

impl AudioRuntime {
    fn open(data_directory: &Path, preview_ttl: Duration) -> Result<Self, AudioRuntimeError> {
        let canonical_data_directory = data_directory
            .canonicalize()
            .map_err(|error| runtime_io("resolve data directory", error))?;
        let product_directory = canonical_data_directory.join(PRODUCT_DIRECTORY);
        let product_metadata = fs::symlink_metadata(&product_directory)
            .map_err(|error| runtime_io("inspect product data directory", error))?;
        if product_metadata.file_type().is_symlink() || !product_metadata.is_dir() {
            return Err(AudioRuntimeError::UnsafePath(
                "product data directory must be a real directory",
            ));
        }
        let canonical_product_directory = product_directory
            .canonicalize()
            .map_err(|error| runtime_io("resolve product data directory", error))?;
        if !canonical_product_directory.starts_with(&canonical_data_directory) {
            return Err(AudioRuntimeError::UnsafePath(
                "product data directory escaped the application data directory",
            ));
        }
        let waveform_directory = canonical_product_directory.join(WAVEFORM_CACHE_DIRECTORY);
        let waveform_cache =
            WaveformCache::open(waveform_directory).map_err(AudioRuntimeError::Audio)?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
            ^ u128::from(std::process::id());
        Ok(Self {
            waveform_cache,
            previews: Mutex::new(PreviewState::default()),
            preview_generation: Mutex::new(()),
            preview_ttl,
            nonce,
            next_token: AtomicU64::new(1),
        })
    }

    pub fn waveform(
        &self,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
        target_points: usize,
    ) -> Result<WaveformSlice, AudioRuntimeError> {
        self.waveform_cache
            .waveform(asset_id, expected_hash, source_path, target_points)
            .map_err(AudioRuntimeError::Audio)
    }

    pub fn create_preview_token(
        &self,
        root_id: &RootId,
        asset_id: &str,
        expected_hash: &ContentHash,
        source_path: &Path,
    ) -> Result<PreviewTicket, AudioRuntimeError> {
        let _generation = self
            .preview_generation
            .lock()
            .map_err(|_| AudioRuntimeError::Unavailable)?;
        let preview =
            create_preview(expected_hash, source_path).map_err(AudioRuntimeError::Audio)?;
        let now = Instant::now();
        let expires_at = now + self.preview_ttl;
        let token = self.new_token(root_id, asset_id);
        let ticket = PreviewTicket {
            token: token.clone(),
            expires_in_seconds: self.preview_ttl.as_secs(),
            byte_length: preview.bytes.len(),
            duration_millis: preview.duration_millis,
            truncated: preview.truncated,
        };
        let mut state = self.lock_previews()?;
        state.records.retain(|_, record| record.expires_at > now);
        if state.records.len() >= MAX_PREVIEW_TOKENS {
            if let Some(oldest) = state
                .records
                .iter()
                .min_by_key(|(_, record)| record.expires_at)
                .map(|(token, _)| token.clone())
            {
                state.records.remove(&oldest);
            }
        }
        state.records.insert(
            token,
            PreviewRecord {
                root_id: root_id.clone(),
                bytes: preview.bytes,
                expires_at,
            },
        );
        Ok(ticket)
    }

    pub fn read_preview(
        &self,
        root_id: &RootId,
        token: &str,
    ) -> Result<Vec<u8>, AudioRuntimeError> {
        validate_preview_token(token)?;
        let now = Instant::now();
        let mut state = self.lock_previews()?;
        let Some(record) = state.records.get(token) else {
            return Err(AudioRuntimeError::InvalidPreviewToken);
        };
        if record.expires_at <= now {
            state.records.remove(token);
            return Err(AudioRuntimeError::ExpiredPreviewToken);
        }
        if state
            .records
            .get(token)
            .is_none_or(|record| &record.root_id != root_id)
        {
            return Err(AudioRuntimeError::InvalidPreviewToken);
        }
        let record = state
            .records
            .remove(token)
            .expect("preview record was checked");
        Ok(record.bytes)
    }

    fn new_token(&self, root_id: &RootId, asset_id: &str) -> String {
        let sequence = self.next_token.fetch_add(1, Ordering::Relaxed);
        let mut hasher = Sha256::new();
        hasher.update(b"preview:v1");
        hasher.update(self.nonce.to_be_bytes());
        hasher.update(sequence.to_be_bytes());
        hasher.update((root_id.as_str().len() as u64).to_be_bytes());
        hasher.update(root_id.as_str().as_bytes());
        hasher.update((asset_id.len() as u64).to_be_bytes());
        hasher.update(asset_id.as_bytes());
        format!("preview:v1:{:x}", hasher.finalize())
    }

    fn lock_previews(&self) -> Result<std::sync::MutexGuard<'_, PreviewState>, AudioRuntimeError> {
        self.previews
            .lock()
            .map_err(|_| AudioRuntimeError::Unavailable)
    }
}

pub fn open_shared_audio_runtime(
    data_directory: &Path,
) -> Result<SharedAudioRuntime, AudioRuntimeError> {
    Ok(Arc::new(AudioRuntime::open(
        data_directory,
        DEFAULT_PREVIEW_TTL,
    )?))
}

fn validate_preview_token(token: &str) -> Result<(), AudioRuntimeError> {
    let digest = token
        .strip_prefix("preview:v1:")
        .ok_or(AudioRuntimeError::InvalidPreviewToken)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AudioRuntimeError::InvalidPreviewToken);
    }
    Ok(())
}

#[derive(Debug)]
pub enum AudioRuntimeError {
    Io {
        operation: &'static str,
        message: String,
    },
    UnsafePath(&'static str),
    Audio(AudioError),
    InvalidPreviewToken,
    ExpiredPreviewToken,
    Unavailable,
}

impl AudioRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io { .. } | Self::Unavailable => "AUDIO_RUNTIME_UNAVAILABLE",
            Self::UnsafePath(_) => "AUDIO_CACHE_UNSAFE",
            Self::Audio(error) => error.code(),
            Self::InvalidPreviewToken => "PREVIEW_TOKEN_INVALID",
            Self::ExpiredPreviewToken => "PREVIEW_TOKEN_EXPIRED",
        }
    }

    pub fn recoverable(&self) -> bool {
        match self {
            Self::UnsafePath(_) | Self::Unavailable => false,
            Self::Audio(error) => error.recoverable(),
            Self::Io { .. } | Self::InvalidPreviewToken | Self::ExpiredPreviewToken => true,
        }
    }
}

impl std::fmt::Display for AudioRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { operation, message } => {
                write!(formatter, "could not {operation}: {message}")
            }
            Self::UnsafePath(message) => formatter.write_str(message),
            Self::Audio(error) => std::fmt::Display::fmt(error, formatter),
            Self::InvalidPreviewToken => formatter.write_str("preview token is invalid or expired"),
            Self::ExpiredPreviewToken => formatter.write_str("preview token has expired"),
            Self::Unavailable => formatter.write_str("audio runtime is unavailable"),
        }
    }
}

impl std::error::Error for AudioRuntimeError {}

fn runtime_io(operation: &'static str, error: std::io::Error) -> AudioRuntimeError {
    AudioRuntimeError::Io {
        operation,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn runtime(ttl: Duration) -> (TempDir, AudioRuntime) {
        let data = TempDir::new().unwrap();
        fs::create_dir(data.path().join(PRODUCT_DIRECTORY)).unwrap();
        let runtime = AudioRuntime::open(data.path(), ttl).unwrap();
        (data, runtime)
    }

    #[test]
    fn preview_tokens_are_opaque_and_bound_to_one_root() {
        let (_data, runtime) = runtime(Duration::from_secs(60));
        let root = RootId::new("root-one").unwrap();
        let other = RootId::new("root-two").unwrap();
        let token = runtime.new_token(&root, "asset:v1:opaque");
        runtime.previews.lock().unwrap().records.insert(
            token.clone(),
            PreviewRecord {
                root_id: root.clone(),
                bytes: b"preview".to_vec(),
                expires_at: Instant::now() + Duration::from_secs(60),
            },
        );

        assert!(token.starts_with("preview:v1:"));
        assert!(!token.contains(root.as_str()));
        assert!(matches!(
            runtime.read_preview(&other, &token),
            Err(AudioRuntimeError::InvalidPreviewToken)
        ));
        assert_eq!(runtime.read_preview(&root, &token).unwrap(), b"preview");
        assert!(matches!(
            runtime.read_preview(&root, &token),
            Err(AudioRuntimeError::InvalidPreviewToken)
        ));
    }

    #[test]
    fn expired_preview_tokens_fail_closed() {
        let (_data, runtime) = runtime(Duration::ZERO);
        let root = RootId::new("root-one").unwrap();
        let token = runtime.new_token(&root, "asset:v1:opaque");
        runtime.previews.lock().unwrap().records.insert(
            token.clone(),
            PreviewRecord {
                root_id: root.clone(),
                bytes: b"preview".to_vec(),
                expires_at: Instant::now(),
            },
        );

        assert!(matches!(
            runtime.read_preview(&root, &token),
            Err(AudioRuntimeError::ExpiredPreviewToken)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_waveform_cache_directory() {
        use std::os::unix::fs::symlink;

        let data = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let product = data.path().join(PRODUCT_DIRECTORY);
        fs::create_dir(&product).unwrap();
        symlink(outside.path(), product.join(WAVEFORM_CACHE_DIRECTORY)).unwrap();

        assert!(matches!(
            AudioRuntime::open(data.path(), Duration::from_secs(60)),
            Err(AudioRuntimeError::Audio(AudioError::UnsafeCachePath(_)))
        ));
    }
}
