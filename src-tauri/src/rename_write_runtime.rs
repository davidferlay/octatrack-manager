use ot_domain::RootId;
use ot_plan::{PlanId, RenameImpactPlan};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_PLAN_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SESSION_PLANS: usize = 64;

pub type SharedRenameWriteRuntime = Arc<RenameWriteRuntime>;

#[derive(Clone, Debug)]
struct StoredRenamePlan {
    plan: RenameImpactPlan,
    expires_at: Instant,
}

#[derive(Default)]
struct RenameWriteState {
    plans: HashMap<String, StoredRenamePlan>,
}

pub struct RenameWriteRuntime {
    state: Mutex<RenameWriteState>,
    plan_ttl: Duration,
}

#[derive(Debug, Eq, PartialEq)]
pub enum RenameWriteRuntimeError {
    InvalidPlan,
    InvalidPlanId,
    PlanNotFound,
    PlanLimitReached,
    PlanIntegrityMismatch,
    Unavailable,
}

impl RenameWriteRuntime {
    pub fn new(plan_ttl: Duration) -> Self {
        Self {
            state: Mutex::new(RenameWriteState::default()),
            plan_ttl,
        }
    }

    pub fn store_plan(&self, plan: RenameImpactPlan) -> Result<(), RenameWriteRuntimeError> {
        plan.validate_integrity()
            .map_err(|_| RenameWriteRuntimeError::InvalidPlan)?;
        let key = plan.id.as_str().to_owned();
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);

        if let Some(existing) = state.plans.get(&key) {
            if existing.plan == plan {
                state
                    .plans
                    .get_mut(&key)
                    .expect("plan key exists")
                    .expires_at = now + self.plan_ttl;
                return Ok(());
            }
            return Err(RenameWriteRuntimeError::PlanIntegrityMismatch);
        }

        if state.plans.len() >= MAX_SESSION_PLANS {
            return Err(RenameWriteRuntimeError::PlanLimitReached);
        }

        state.plans.insert(
            key,
            StoredRenamePlan {
                plan,
                expires_at: now + self.plan_ttl,
            },
        );
        Ok(())
    }

    pub fn get_plan(
        &self,
        root_id: &RootId,
        plan_id: &str,
    ) -> Result<RenameImpactPlan, RenameWriteRuntimeError> {
        let plan_id = PlanId::parse(plan_id).map_err(|_| RenameWriteRuntimeError::InvalidPlanId)?;
        let now = Instant::now();
        let mut state = self.lock_state()?;
        remove_expired_plans(&mut state, now);
        let stored = state
            .plans
            .get(plan_id.as_str())
            .ok_or(RenameWriteRuntimeError::PlanNotFound)?;
        if &stored.plan.root_id != root_id {
            return Err(RenameWriteRuntimeError::PlanNotFound);
        }
        Ok(stored.plan.clone())
    }

    fn lock_state(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, RenameWriteState>, RenameWriteRuntimeError> {
        self.state
            .lock()
            .map_err(|_| RenameWriteRuntimeError::Unavailable)
    }
}

impl RenameWriteRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPlan | Self::InvalidPlanId | Self::PlanIntegrityMismatch => "INVALID_PLAN",
            Self::PlanNotFound => "PLAN_NOT_FOUND",
            Self::PlanLimitReached => "PLAN_LIMIT_REACHED",
            Self::Unavailable => "RENAME_RUNTIME_UNAVAILABLE",
        }
    }
}

impl std::fmt::Display for RenameWriteRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPlan => "rename plan failed integrity validation",
            Self::InvalidPlanId => "plan ID is not a versioned identifier",
            Self::PlanNotFound => "rename plan is not available in this session",
            Self::PlanLimitReached => "too many rename plans are retained in this session",
            Self::PlanIntegrityMismatch => {
                "a different rename plan already occupies this plan identifier"
            }
            Self::Unavailable => "rename plan runtime is unavailable",
        })
    }
}

impl std::error::Error for RenameWriteRuntimeError {}

pub fn open_shared_rename_write_runtime() -> SharedRenameWriteRuntime {
    Arc::new(RenameWriteRuntime::new(DEFAULT_PLAN_TTL))
}

fn remove_expired_plans(state: &mut RenameWriteState, now: Instant) {
    state.plans.retain(|_, stored| stored.expires_at > now);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::{ContentHash, FileInstanceId, RootRelativePath};
    use ot_plan::derive_rename_plan_id;

    fn sample_plan(root_id: &RootId, destination_suffix: &str) -> RenameImpactPlan {
        let destination =
            RootRelativePath::parse(format!("SET/AUDIO/kick-{destination_suffix}.wav")).unwrap();
        let source = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let hash = ContentHash::parse(format!("sha256:{}", "a".repeat(64))).unwrap();
        let mut plan = RenameImpactPlan {
            id: PlanId::parse(format!("plan:v1:{}", "0".repeat(64))).unwrap(),
            root_id: root_id.clone(),
            device_fingerprint: format!("rootfp:v1:{}", "b".repeat(64)),
            base_observed_revision: 1,
            source_file_instance_id: FileInstanceId::parse(format!(
                "fileinst:v1:{}",
                "c".repeat(64)
            ))
            .unwrap(),
            source_relative_path: source,
            source_byte_size: 44,
            source_content_hash: hash,
            destination_relative_path: destination,
            state_document_impacts: Vec::new(),
            usage_edge_impacts: Vec::new(),
            sidecar_impacts: Vec::new(),
            unresolved_references: Vec::new(),
            backup_relative_paths: Vec::new(),
            estimated_media_additional_bytes: 0,
            estimated_local_staging_bytes: 0,
            reference_update_count: 0,
            warnings: Vec::new(),
        };
        let id = derive_rename_plan_id(&plan);
        plan.id = id;
        plan
    }

    #[test]
    fn idempotent_store_refreshes_ttl_without_duplicate_error() {
        let runtime = RenameWriteRuntime::new(Duration::from_secs(60));
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id, "a");
        runtime.store_plan(plan.clone()).unwrap();
        runtime.store_plan(plan).unwrap();
    }

    #[test]
    fn get_plan_rejects_different_root() {
        let runtime = RenameWriteRuntime::new(Duration::from_secs(60));
        let root_a = RootId::new("root-a").unwrap();
        let root_b = RootId::new("root-b").unwrap();
        let plan = sample_plan(&root_a, "a");
        let plan_id = plan.id.as_str().to_owned();
        runtime.store_plan(plan).unwrap();
        assert_eq!(
            runtime.get_plan(&root_b, &plan_id),
            Err(RenameWriteRuntimeError::PlanNotFound)
        );
    }

    #[test]
    fn expired_plan_is_not_returned() {
        let runtime = RenameWriteRuntime::new(Duration::from_millis(1));
        let root_id = RootId::new("root-session-1").unwrap();
        let plan = sample_plan(&root_id, "a");
        let plan_id = plan.id.as_str().to_owned();
        runtime.store_plan(plan).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(
            runtime.get_plan(&root_id, &plan_id),
            Err(RenameWriteRuntimeError::PlanNotFound)
        );
    }

    #[test]
    fn plan_limit_is_enforced() {
        let runtime = RenameWriteRuntime::new(Duration::from_secs(60));
        let root_id = RootId::new("root-session-1").unwrap();
        for index in 0..MAX_SESSION_PLANS {
            runtime
                .store_plan(sample_plan(&root_id, &index.to_string()))
                .unwrap();
        }
        assert_eq!(
            runtime.store_plan(sample_plan(&root_id, "overflow")),
            Err(RenameWriteRuntimeError::PlanLimitReached)
        );
    }
}
