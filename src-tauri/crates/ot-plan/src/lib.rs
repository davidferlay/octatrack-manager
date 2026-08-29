#![forbid(unsafe_code)]

use ot_domain::{ContentHash, RootId, RootRelativePath};
use sha2::{Digest, Sha256};
use std::fmt;

const ROOT_FINGERPRINT_PREFIX: &str = "rootfp:v1:";
const PLAN_ID_PREFIX: &str = "plan:v1:";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct PlanId(String);

impl PlanId {
    pub fn parse(value: impl Into<String>) -> Result<Self, PlanError> {
        let value = value.into();
        validate_prefixed_sha256(&value, PLAN_ID_PREFIX).map_err(|_| PlanError::InvalidPlanId)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanSeed([u8; 32]);

impl PlanSeed {
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootPlanObservation {
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub observed_revision: u64,
    pub identity_is_stable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceFileObservation {
    pub relative_path: RootRelativePath,
    pub byte_size: u64,
    pub content_hash: ContentHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdditiveCopyIntent {
    pub root_id: RootId,
    pub source_relative_path: RootRelativePath,
    pub destination_relative_path: RootRelativePath,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdditiveCopyPlanningFacts {
    pub plan_seed: PlanSeed,
    pub root: RootPlanObservation,
    pub source: SourceFileObservation,
    pub destination_exists: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FilePrecondition {
    pub relative_path: RootRelativePath,
    pub byte_size: u64,
    pub content_hash: ContentHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdditiveCopyOperation {
    pub source: FilePrecondition,
    pub destination_relative_path: RootRelativePath,
    pub destination_must_be_absent: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangePlan {
    pub id: PlanId,
    pub root_id: RootId,
    pub device_fingerprint: String,
    pub base_observed_revision: u64,
    pub operation: AdditiveCopyOperation,
    pub estimated_additional_bytes: u64,
    pub backup_relative_paths: Vec<RootRelativePath>,
}

pub fn plan_additive_copy(
    intent: &AdditiveCopyIntent,
    facts: &AdditiveCopyPlanningFacts,
) -> Result<ChangePlan, PlanError> {
    if intent.root_id != facts.root.root_id {
        return Err(PlanError::RootMismatch);
    }
    if !facts.root.identity_is_stable {
        return Err(PlanError::UnstableRootIdentity);
    }
    validate_prefixed_sha256(&facts.root.device_fingerprint, ROOT_FINGERPRINT_PREFIX)
        .map_err(|_| PlanError::InvalidRootFingerprint)?;
    if facts.root.observed_revision == 0 {
        return Err(PlanError::InvalidObservedRevision);
    }
    if intent.source_relative_path != facts.source.relative_path {
        return Err(PlanError::SourceObservationMismatch);
    }
    if intent.source_relative_path == intent.destination_relative_path {
        return Err(PlanError::SourceEqualsDestination);
    }
    if facts.destination_exists {
        return Err(PlanError::DestinationExists);
    }

    let id = derive_plan_id(intent, facts);
    Ok(ChangePlan {
        id,
        root_id: facts.root.root_id.clone(),
        device_fingerprint: facts.root.device_fingerprint.clone(),
        base_observed_revision: facts.root.observed_revision,
        operation: AdditiveCopyOperation {
            source: FilePrecondition {
                relative_path: facts.source.relative_path.clone(),
                byte_size: facts.source.byte_size,
                content_hash: facts.source.content_hash.clone(),
            },
            destination_relative_path: intent.destination_relative_path.clone(),
            destination_must_be_absent: true,
        },
        estimated_additional_bytes: facts.source.byte_size,
        backup_relative_paths: vec![facts.source.relative_path.clone()],
    })
}

fn derive_plan_id(intent: &AdditiveCopyIntent, facts: &AdditiveCopyPlanningFacts) -> PlanId {
    let mut hasher = Sha256::new();
    hasher.update(b"masterocta:additive-copy-plan:v1");
    encode_field(&mut hasher, 1, intent.root_id.as_str().as_bytes());
    encode_field(&mut hasher, 2, facts.plan_seed.as_bytes());
    encode_field(&mut hasher, 3, facts.root.device_fingerprint.as_bytes());
    encode_field(&mut hasher, 4, &facts.root.observed_revision.to_be_bytes());
    encode_field(
        &mut hasher,
        5,
        intent.source_relative_path.as_str().as_bytes(),
    );
    encode_field(
        &mut hasher,
        6,
        intent.destination_relative_path.as_str().as_bytes(),
    );
    encode_field(
        &mut hasher,
        7,
        facts.source.content_hash.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 8, &facts.source.byte_size.to_be_bytes());
    let digest = hasher.finalize();
    PlanId(format!("{PLAN_ID_PREFIX}{digest:x}"))
}

fn encode_field(hasher: &mut Sha256, tag: u8, bytes: &[u8]) {
    hasher.update([tag]);
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn validate_prefixed_sha256(value: &str, prefix: &str) -> Result<(), ()> {
    let digest = value.strip_prefix(prefix).ok_or(())?;
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlanError {
    InvalidPlanId,
    RootMismatch,
    UnstableRootIdentity,
    InvalidRootFingerprint,
    InvalidObservedRevision,
    SourceObservationMismatch,
    SourceEqualsDestination,
    DestinationExists,
}

impl fmt::Display for PlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPlanId => "plan ID is not a versioned SHA-256 identifier",
            Self::RootMismatch => "intent and observed source root do not match",
            Self::UnstableRootIdentity => "additive copy requires a stable root identity",
            Self::InvalidRootFingerprint => "root fingerprint is not a supported versioned value",
            Self::InvalidObservedRevision => "observed root revision must be non-zero",
            Self::SourceObservationMismatch => "source observation does not match the intent",
            Self::SourceEqualsDestination => "source and destination must be different paths",
            Self::DestinationExists => "additive copy destination must not already exist",
        })
    }
}

impl std::error::Error for PlanError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (AdditiveCopyIntent, AdditiveCopyPlanningFacts) {
        let root_id = RootId::new("root-session-1").unwrap();
        let source = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let destination = RootRelativePath::parse("SET/PROJECT/kick.wav").unwrap();
        (
            AdditiveCopyIntent {
                root_id: root_id.clone(),
                source_relative_path: source.clone(),
                destination_relative_path: destination,
            },
            AdditiveCopyPlanningFacts {
                plan_seed: PlanSeed::new([7; 32]),
                root: RootPlanObservation {
                    root_id,
                    device_fingerprint: format!("rootfp:v1:{}", "a".repeat(64)),
                    observed_revision: 7,
                    identity_is_stable: true,
                },
                source: SourceFileObservation {
                    relative_path: source,
                    byte_size: 4,
                    content_hash: ContentHash::parse(format!("sha256:{}", "b".repeat(64))).unwrap(),
                },
                destination_exists: false,
            },
        )
    }

    #[test]
    fn plans_a_deterministic_additive_only_copy() {
        let (intent, facts) = fixture();
        let first = plan_additive_copy(&intent, &facts).unwrap();
        let second = plan_additive_copy(&intent, &facts).unwrap();

        assert_eq!(first, second);
        assert!(first.id.as_str().starts_with(PLAN_ID_PREFIX));
        assert_eq!(first.estimated_additional_bytes, 4);
        assert!(first.operation.destination_must_be_absent);
        assert_eq!(
            first.backup_relative_paths,
            vec![intent.source_relative_path.clone()]
        );
        assert!(!first.id.as_str().contains("SET/AUDIO"));

        let mut replanned_facts = facts;
        replanned_facts.plan_seed = PlanSeed::new([8; 32]);
        let replanned = plan_additive_copy(&intent, &replanned_facts).unwrap();
        assert_ne!(first.id, replanned.id);
    }

    #[test]
    fn rejects_overwrite_same_path_and_unstable_authority() {
        let (mut intent, mut facts) = fixture();
        facts.destination_exists = true;
        assert_eq!(
            plan_additive_copy(&intent, &facts),
            Err(PlanError::DestinationExists)
        );

        facts.destination_exists = false;
        intent.destination_relative_path = intent.source_relative_path.clone();
        assert_eq!(
            plan_additive_copy(&intent, &facts),
            Err(PlanError::SourceEqualsDestination)
        );

        let (intent, mut facts) = fixture();
        facts.root.identity_is_stable = false;
        assert_eq!(
            plan_additive_copy(&intent, &facts),
            Err(PlanError::UnstableRootIdentity)
        );
    }

    #[test]
    fn rejects_mismatched_session_and_source_observations() {
        let (intent, mut facts) = fixture();
        facts.root.root_id = RootId::new("other-root").unwrap();
        assert_eq!(
            plan_additive_copy(&intent, &facts),
            Err(PlanError::RootMismatch)
        );

        let (intent, mut facts) = fixture();
        facts.source.relative_path = RootRelativePath::parse("SET/AUDIO/snare.wav").unwrap();
        assert_eq!(
            plan_additive_copy(&intent, &facts),
            Err(PlanError::SourceObservationMismatch)
        );
    }
}
