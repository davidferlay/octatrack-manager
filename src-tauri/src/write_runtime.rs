use crate::root_registry::{RootRegistry, RootRegistryError};
use ot_domain::RootId;
#[cfg(test)]
use ot_domain::RootRelativePath;
use ot_executor::{
    AdditiveCopyExecutor, ApprovedExecutionRoot, AuthorityError, ExecutorError, ExecutorLocalPaths,
    JournalStatus, OperationId, WriteAuthority,
};
use ot_plan::{ChangePlan, PlanId};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PRODUCT_DIRECTORY: &str = "MasterOCTa";
const WRITE_STATE_DIRECTORY: &str = "write-state";
const DEFAULT_PLAN_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SESSION_PLANS: usize = 64;

pub type SharedWriteRuntime = Arc<WriteRuntime>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChangeOperationState {
    Planned,
    Applying,
    Committed,
    Failed,
    RecoveryRequired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangeOperationStatus {
    pub operation_id: OperationId,
    pub plan_id: PlanId,
    pub state: ChangeOperationState,
    pub catalog_refresh_required: bool,
    pub failure_code: Option<String>,
    pub backup_snapshot_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct StartedApply {
    pub plan: ChangePlan,
    pub operation_id: OperationId,
}

#[derive(Clone, Debug)]
struct StoredPlan {
    plan: ChangePlan,
    operation_id: OperationId,
    expires_at: Instant,
    state: ChangeOperationState,
    catalog_refresh_required: bool,
    failure_code: Option<String>,
    backup_snapshot_id: Option<String>,
}

#[derive(Default)]
struct WriteState {
    plans: HashMap<String, StoredPlan>,
}

pub struct WriteRuntime {
    executor: AdditiveCopyExecutor,
    state: Mutex<WriteState>,
    plan_ttl: Duration,
}

impl WriteRuntime {
    fn new(executor: AdditiveCopyExecutor, plan_ttl: Duration) -> Self {
        Self {
            executor,
            state: Mutex::new(WriteState::default()),
            plan_ttl,
        }
    }

    pub fn store_plan(&self, plan: ChangePlan) -> Result<ChangeOperationStatus, WriteRuntimeError> {
        plan.validate_integrity()
            .map_err(|_| WriteRuntimeError::InvalidPlan)?;
        let operation_id = OperationId::for_plan(&plan);
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        if state.plans.len() >= MAX_SESSION_PLANS {
            return Err(WriteRuntimeError::PlanLimitReached);
        }
        let key = plan.id.as_str().to_owned();
        if state.plans.contains_key(&key) {
            return Err(WriteRuntimeError::DuplicatePlan);
        }
        let stored = StoredPlan {
            plan,
            operation_id,
            expires_at: now + self.plan_ttl,
            state: ChangeOperationState::Planned,
            catalog_refresh_required: false,
            failure_code: None,
            backup_snapshot_id: None,
        };
        let status = status_from_stored(&stored);
        state.plans.insert(key, stored);
        Ok(status)
    }

    pub fn get_plan(
        &self,
        root_id: &RootId,
        plan_id: &str,
    ) -> Result<ChangePlan, WriteRuntimeError> {
        let plan_id = PlanId::parse(plan_id).map_err(|_| WriteRuntimeError::InvalidPlanId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get(plan_id.as_str())
            .ok_or(WriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(WriteRuntimeError::PlanNotFound);
        }
        Ok(stored.plan.clone())
    }

    pub fn begin_apply(
        &self,
        root_id: &RootId,
        plan_id: &str,
        approved_plan_id: &str,
    ) -> Result<StartedApply, WriteRuntimeError> {
        let plan_id = PlanId::parse(plan_id).map_err(|_| WriteRuntimeError::InvalidPlanId)?;
        let approved_plan_id =
            PlanId::parse(approved_plan_id).map_err(|_| WriteRuntimeError::ApprovalRequired)?;
        if plan_id != approved_plan_id {
            return Err(WriteRuntimeError::ApprovalRequired);
        }

        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get_mut(plan_id.as_str())
            .ok_or(WriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(WriteRuntimeError::PlanNotFound);
        }
        if stored.state != ChangeOperationState::Planned {
            return Err(WriteRuntimeError::PlanConsumed);
        }
        stored.state = ChangeOperationState::Applying;
        Ok(StartedApply {
            plan: stored.plan.clone(),
            operation_id: stored.operation_id.clone(),
        })
    }

    pub fn execute_started(
        &self,
        started: StartedApply,
        registry: &RootRegistry,
    ) -> Result<ChangeOperationStatus, WriteRuntimeError> {
        let authority = RegistryWriteAuthority { registry };
        let result = self.executor.execute(&started.plan, &authority);
        let mut state = self.lock_state()?;
        let stored = state
            .plans
            .get_mut(started.plan.id.as_str())
            .ok_or(WriteRuntimeError::PlanNotFound)?;
        if stored.state != ChangeOperationState::Applying
            || stored.operation_id != started.operation_id
        {
            return Err(WriteRuntimeError::InvalidTransition);
        }

        match result {
            Ok(result) => {
                stored.state = ChangeOperationState::Committed;
                stored.catalog_refresh_required = true;
                stored.backup_snapshot_id = Some(result.backup.snapshot_id().as_str().to_owned());
                stored.failure_code = None;
                Ok(status_from_stored(stored))
            }
            Err(error) => {
                stored.state = if matches!(error, ExecutorError::RecoveryRequired) {
                    ChangeOperationState::RecoveryRequired
                } else {
                    ChangeOperationState::Failed
                };
                stored.failure_code = Some(error.code().to_owned());
                Err(WriteRuntimeError::Executor(error))
            }
        }
    }

    pub fn mark_catalog_refreshed(
        &self,
        root_id: &RootId,
        operation_id: &OperationId,
    ) -> Result<ChangeOperationStatus, WriteRuntimeError> {
        let mut state = self.lock_state()?;
        let stored = state
            .plans
            .values_mut()
            .find(|stored| &stored.operation_id == operation_id && &stored.plan.root_id == root_id)
            .ok_or(WriteRuntimeError::OperationNotFound)?;
        if stored.state != ChangeOperationState::Committed {
            return Err(WriteRuntimeError::InvalidTransition);
        }
        stored.catalog_refresh_required = false;
        Ok(status_from_stored(stored))
    }

    pub fn status(
        &self,
        root_id: &RootId,
        operation_id: &str,
        root_fingerprint: &str,
    ) -> Result<ChangeOperationStatus, WriteRuntimeError> {
        let operation_id =
            OperationId::parse(operation_id).map_err(|_| WriteRuntimeError::InvalidOperationId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        if let Some(stored) = state
            .plans
            .values()
            .find(|stored| stored.operation_id == operation_id && &stored.plan.root_id == root_id)
        {
            return Ok(status_from_stored(stored));
        }
        drop(state);

        let journal = self
            .executor
            .operation_journal(&operation_id)
            .map_err(WriteRuntimeError::Executor)?
            .ok_or(WriteRuntimeError::OperationNotFound)?;
        if journal.root_fingerprint != root_fingerprint {
            return Err(WriteRuntimeError::OperationNotFound);
        }
        let plan_id = PlanId::parse(journal.plan_id).map_err(|_| WriteRuntimeError::InvalidPlan)?;
        let operation_state = state_from_journal(journal.status);
        Ok(ChangeOperationStatus {
            operation_id,
            plan_id,
            state: operation_state,
            catalog_refresh_required: matches!(operation_state, ChangeOperationState::Committed),
            failure_code: journal.failure_code,
            backup_snapshot_id: Some(journal.backup_snapshot_id),
        })
    }

    pub fn recovery_required(
        &self,
        root_fingerprint: &str,
    ) -> Result<Vec<ChangeOperationStatus>, WriteRuntimeError> {
        self.executor
            .incomplete_journals_for_root(root_fingerprint)
            .map_err(WriteRuntimeError::Executor)?
            .into_iter()
            .map(|journal| {
                let operation_id = OperationId::parse(journal.operation_id)
                    .map_err(|_| WriteRuntimeError::InvalidOperationId)?;
                let plan_id =
                    PlanId::parse(journal.plan_id).map_err(|_| WriteRuntimeError::InvalidPlan)?;
                Ok(ChangeOperationStatus {
                    operation_id,
                    plan_id,
                    state: ChangeOperationState::RecoveryRequired,
                    catalog_refresh_required: true,
                    failure_code: journal
                        .failure_code
                        .or_else(|| Some("INCOMPLETE_OPERATION".into())),
                    backup_snapshot_id: Some(journal.backup_snapshot_id),
                })
            })
            .collect()
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, WriteState>, WriteRuntimeError> {
        self.state
            .lock()
            .map_err(|_| WriteRuntimeError::Unavailable)
    }
}

pub fn open_shared_write_runtime(
    data_directory: &Path,
) -> Result<SharedWriteRuntime, WriteRuntimeError> {
    fs::create_dir_all(data_directory).map_err(WriteRuntimeError::io)?;
    let data_directory = canonical_directory(data_directory)?;
    let product_directory = data_directory.join(PRODUCT_DIRECTORY);
    ensure_real_directory(&data_directory, &product_directory)?;
    let product_directory = canonical_directory(&product_directory)?;
    let write_directory = product_directory.join(WRITE_STATE_DIRECTORY);
    ensure_real_directory(&product_directory, &write_directory)?;
    let write_directory = canonical_directory(&write_directory)?;
    Ok(Arc::new(WriteRuntime::new(
        AdditiveCopyExecutor::new(ExecutorLocalPaths {
            staging_directory: write_directory.join("staging"),
            backup_directory: write_directory.join("backups"),
            journal_directory: write_directory.join("journals"),
        }),
        DEFAULT_PLAN_TTL,
    )))
}

fn ensure_real_directory(parent: &Path, directory: &Path) -> Result<(), WriteRuntimeError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(WriteRuntimeError::UnsafeLocalState);
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(directory).map_err(WriteRuntimeError::io)?;
        }
        Err(error) => return Err(WriteRuntimeError::io(error)),
    }
    let canonical = canonical_directory(directory)?;
    if !canonical.starts_with(parent) {
        return Err(WriteRuntimeError::UnsafeLocalState);
    }
    Ok(())
}

fn canonical_directory(path: &Path) -> Result<std::path::PathBuf, WriteRuntimeError> {
    let metadata = fs::symlink_metadata(path).map_err(WriteRuntimeError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WriteRuntimeError::UnsafeLocalState);
    }
    path.canonicalize().map_err(WriteRuntimeError::io)
}

fn remove_expired_plans(state: &mut WriteState, now: Instant) {
    state.plans.retain(|_, stored| {
        stored.expires_at > now
            || matches!(
                stored.state,
                ChangeOperationState::Applying | ChangeOperationState::RecoveryRequired
            )
    });
}

fn status_from_stored(stored: &StoredPlan) -> ChangeOperationStatus {
    ChangeOperationStatus {
        operation_id: stored.operation_id.clone(),
        plan_id: stored.plan.id.clone(),
        state: stored.state,
        catalog_refresh_required: stored.catalog_refresh_required,
        failure_code: stored.failure_code.clone(),
        backup_snapshot_id: stored.backup_snapshot_id.clone(),
    }
}

fn state_from_journal(status: JournalStatus) -> ChangeOperationState {
    match status {
        JournalStatus::Prepared | JournalStatus::Applying | JournalStatus::Verifying => {
            ChangeOperationState::RecoveryRequired
        }
        JournalStatus::Committed => ChangeOperationState::Committed,
        JournalStatus::RolledBack => ChangeOperationState::Failed,
        JournalStatus::RecoveryRequired => ChangeOperationState::RecoveryRequired,
    }
}

struct RegistryWriteAuthority<'a> {
    registry: &'a RootRegistry,
}

impl WriteAuthority for RegistryWriteAuthority<'_> {
    fn resolve_for_write(&self, root_id: &RootId) -> Result<ApprovedExecutionRoot, AuthorityError> {
        let resolved = self
            .registry
            .resolve(root_id)
            .map_err(map_authority_error)?;
        Ok(ApprovedExecutionRoot {
            root_id: resolved.session.root_id,
            device_fingerprint: resolved.session.device_fingerprint,
            observed_revision: resolved.session.observed_revision,
            canonical_path: resolved.canonical_path,
            write_enabled: resolved.session.capabilities.write,
            stable_device_identity: resolved.session.capabilities.stable_device_identity,
        })
    }
}

fn map_authority_error(error: RootRegistryError) -> AuthorityError {
    match error {
        RootRegistryError::NotApproved => AuthorityError::NotApproved,
        RootRegistryError::Expired => AuthorityError::Expired,
        RootRegistryError::Removed => AuthorityError::Removed,
        RootRegistryError::Changed => AuthorityError::Changed,
        RootRegistryError::UnstableIdentity => AuthorityError::UnstableIdentity,
        other => AuthorityError::Unavailable(other.code().into()),
    }
}

#[derive(Debug)]
pub enum WriteRuntimeError {
    Io(String),
    UnsafeLocalState,
    Unavailable,
    InvalidPlan,
    InvalidPlanId,
    InvalidOperationId,
    PlanNotFound,
    OperationNotFound,
    DuplicatePlan,
    PlanLimitReached,
    ApprovalRequired,
    PlanConsumed,
    InvalidTransition,
    Executor(ExecutorError),
}

impl WriteRuntimeError {
    fn io(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) | Self::Unavailable => "WRITE_RUNTIME_UNAVAILABLE",
            Self::UnsafeLocalState => "UNSAFE_LOCAL_STATE",
            Self::InvalidPlan | Self::InvalidPlanId => "INVALID_PLAN",
            Self::InvalidOperationId => "INVALID_OPERATION_ID",
            Self::PlanNotFound => "PLAN_NOT_FOUND",
            Self::OperationNotFound => "OPERATION_NOT_FOUND",
            Self::DuplicatePlan => "DUPLICATE_PLAN",
            Self::PlanLimitReached => "PLAN_LIMIT_REACHED",
            Self::ApprovalRequired => "APPROVAL_REQUIRED",
            Self::PlanConsumed => "PLAN_CONSUMED",
            Self::InvalidTransition => "INVALID_OPERATION_STATE",
            Self::Executor(error) => error.code(),
        }
    }
}

impl std::fmt::Display for WriteRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) => write!(formatter, "write runtime I/O failed: {message}"),
            Self::Executor(error) => write!(formatter, "{error}"),
            other => formatter.write_str(match other {
                Self::UnsafeLocalState => {
                    "write state must stay in a real application data directory"
                }
                Self::Unavailable => "write runtime is unavailable",
                Self::InvalidPlan => "change plan failed integrity validation",
                Self::InvalidPlanId => "plan ID is not a versioned identifier",
                Self::InvalidOperationId => "operation ID is not a versioned identifier",
                Self::PlanNotFound => "change plan is not available in this session",
                Self::OperationNotFound => "operation is not available for this root",
                Self::DuplicatePlan => "the same plan is already registered",
                Self::PlanLimitReached => "too many change plans are retained in this session",
                Self::ApprovalRequired => "apply requires approval of the exact displayed plan ID",
                Self::PlanConsumed => "change plan has already been applied or attempted",
                Self::InvalidTransition => "change operation is in an invalid state",
                Self::Io(_) | Self::Executor(_) => unreachable!(),
            }),
        }
    }
}

impl std::error::Error for WriteRuntimeError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::root_registry::{DeviceIdentityProvider, DeviceObservation};
    use ot_domain::ContentHash;
    use ot_plan::{
        plan_additive_copy, AdditiveCopyIntent, AdditiveCopyPlanningFacts, PlanSeed,
        RootPlanObservation, SourceFileObservation,
    };
    use sha2::{Digest, Sha256};
    use tempfile::TempDir;

    struct StableIdentity;

    impl DeviceIdentityProvider for StableIdentity {
        fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
            Ok(DeviceObservation {
                stable_key: "fixture-volume".into(),
                filesystem_type: Some("testfs".into()),
                total_capacity: Some(1024 * 1024),
                mount_token: "fixture-mount".into(),
                stable: true,
            })
        }
    }

    fn fixture_plan(root_id: RootId, fingerprint: String, bytes: &[u8]) -> ChangePlan {
        let source = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let hash = ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap();
        plan_additive_copy(
            &AdditiveCopyIntent {
                root_id: root_id.clone(),
                source_relative_path: source.clone(),
                destination_relative_path: RootRelativePath::parse("SET/PROJECT/kick.wav").unwrap(),
            },
            &AdditiveCopyPlanningFacts {
                plan_seed: PlanSeed::new([9; 32]),
                root: RootPlanObservation {
                    root_id,
                    device_fingerprint: fingerprint,
                    observed_revision: 1,
                    identity_is_stable: true,
                },
                source: SourceFileObservation {
                    relative_path: source,
                    byte_size: bytes.len() as u64,
                    content_hash: hash,
                },
                destination_exists: false,
            },
        )
        .unwrap()
    }

    #[test]
    fn exact_plan_approval_is_one_shot_and_commits_a_verified_copy() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("approved-root");
        let data = fixture.path().join("application-support");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::create_dir_all(root.join("SET/PROJECT")).unwrap();
        let source_bytes = b"synthetic audio fixture only";
        fs::write(root.join("SET/AUDIO/kick.wav"), source_bytes).unwrap();
        let registry = RootRegistry::new(Arc::new(StableIdentity), Duration::from_secs(60));
        let session = registry.register(root.to_str().unwrap()).unwrap();
        registry.enable_write(&session.root_id).unwrap();
        let runtime = open_shared_write_runtime(&data).unwrap();
        let plan = fixture_plan(
            session.root_id.clone(),
            session.device_fingerprint.clone(),
            source_bytes,
        );
        runtime.store_plan(plan.clone()).unwrap();

        assert!(matches!(
            runtime.begin_apply(
                &session.root_id,
                plan.id.as_str(),
                "plan:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ),
            Err(WriteRuntimeError::ApprovalRequired)
        ));

        let started = runtime
            .begin_apply(&session.root_id, plan.id.as_str(), plan.id.as_str())
            .unwrap();
        let status = runtime.execute_started(started, &registry).unwrap();

        assert_eq!(status.state, ChangeOperationState::Committed);
        assert!(status.catalog_refresh_required);
        assert!(status.backup_snapshot_id.is_some());
        assert_eq!(
            fs::read(root.join("SET/PROJECT/kick.wav")).unwrap(),
            source_bytes
        );
        assert_eq!(
            fs::read(root.join("SET/AUDIO/kick.wav")).unwrap(),
            source_bytes
        );
        let refreshed = runtime
            .mark_catalog_refreshed(&session.root_id, &status.operation_id)
            .unwrap();
        assert!(!refreshed.catalog_refresh_required);
        assert!(
            !runtime
                .status(
                    &session.root_id,
                    status.operation_id.as_str(),
                    &session.device_fingerprint,
                )
                .unwrap()
                .catalog_refresh_required
        );
        assert!(matches!(
            runtime.begin_apply(&session.root_id, plan.id.as_str(), plan.id.as_str()),
            Err(WriteRuntimeError::PlanConsumed)
        ));
    }

    #[test]
    fn execution_without_a_live_write_grant_fails_closed() {
        let fixture = TempDir::new().unwrap();
        let root = fixture.path().join("approved-root");
        let data = fixture.path().join("application-support");
        fs::create_dir_all(root.join("SET/AUDIO")).unwrap();
        fs::create_dir_all(root.join("SET/PROJECT")).unwrap();
        let source_bytes = b"synthetic audio fixture only";
        fs::write(root.join("SET/AUDIO/kick.wav"), source_bytes).unwrap();
        let registry = RootRegistry::new(Arc::new(StableIdentity), Duration::from_secs(60));
        let session = registry.register(root.to_str().unwrap()).unwrap();
        let runtime = open_shared_write_runtime(&data).unwrap();
        let plan = fixture_plan(
            session.root_id.clone(),
            session.device_fingerprint.clone(),
            source_bytes,
        );
        runtime.store_plan(plan.clone()).unwrap();
        let started = runtime
            .begin_apply(&session.root_id, plan.id.as_str(), plan.id.as_str())
            .unwrap();

        let error = runtime.execute_started(started, &registry).unwrap_err();

        assert_eq!(error.code(), "AUTHORITY_FAILED");
        assert!(!root.join("SET/PROJECT/kick.wav").exists());
    }

    #[cfg(unix)]
    #[test]
    fn production_local_state_rejects_a_symlinked_write_directory() {
        use std::os::unix::fs::symlink;

        let fixture = TempDir::new().unwrap();
        let data = fixture.path().join("application-support");
        let outside = fixture.path().join("outside");
        fs::create_dir_all(data.join(PRODUCT_DIRECTORY)).unwrap();
        fs::create_dir(&outside).unwrap();
        symlink(
            &outside,
            data.join(PRODUCT_DIRECTORY).join(WRITE_STATE_DIRECTORY),
        )
        .unwrap();

        assert!(matches!(
            open_shared_write_runtime(&data),
            Err(WriteRuntimeError::UnsafeLocalState)
        ));
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }
}
