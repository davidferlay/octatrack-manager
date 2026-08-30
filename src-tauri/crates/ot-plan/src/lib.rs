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

    pub fn parse_hex(value: &str) -> Result<Self, PlanError> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(PlanError::InvalidPlanSeed);
        }
        let mut bytes = [0u8; 32];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            let high = hex_nibble(chunk[0]).ok_or(PlanError::InvalidPlanSeed)?;
            let low = hex_nibble(chunk[1]).ok_or(PlanError::InvalidPlanSeed)?;
            bytes[index] = (high << 4) | low;
        }
        Ok(Self(bytes))
    }

    pub fn to_hex(&self) -> String {
        let mut hex = String::with_capacity(64);
        for byte in self.0 {
            use std::fmt::Write as _;
            let _ = write!(hex, "{byte:02x}");
        }
        hex
    }

    fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
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
    plan_seed: PlanSeed,
}

impl ChangePlan {
    pub fn plan_seed(&self) -> &PlanSeed {
        &self.plan_seed
    }

    pub fn validate_integrity(&self) -> Result<(), PlanError> {
        let expected = derive_plan_id_from_fields(
            &self.root_id,
            &self.plan_seed,
            &self.device_fingerprint,
            self.base_observed_revision,
            &self.operation.source.relative_path,
            &self.operation.destination_relative_path,
            &self.operation.source.content_hash,
            self.operation.source.byte_size,
        );
        if expected == self.id {
            Ok(())
        } else {
            Err(PlanError::IntegrityMismatch)
        }
    }
}

/// Re-derive the additive-copy PlanId from durable recovery fields.
///
/// Recovery authorization stores the plan seed so a rewritten destination
/// cannot keep the original operation/plan IDs without breaking SHA-256.
#[allow(clippy::too_many_arguments)]
pub fn derive_additive_copy_plan_id(
    root_id: &RootId,
    plan_seed: &PlanSeed,
    device_fingerprint: &str,
    observed_revision: u64,
    source_relative_path: &RootRelativePath,
    destination_relative_path: &RootRelativePath,
    source_content_hash: &ContentHash,
    source_byte_size: u64,
) -> PlanId {
    derive_plan_id_from_fields(
        root_id,
        plan_seed,
        device_fingerprint,
        observed_revision,
        source_relative_path,
        destination_relative_path,
        source_content_hash,
        source_byte_size,
    )
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
        plan_seed: facts.plan_seed.clone(),
    })
}

fn derive_plan_id(intent: &AdditiveCopyIntent, facts: &AdditiveCopyPlanningFacts) -> PlanId {
    derive_plan_id_from_fields(
        &intent.root_id,
        &facts.plan_seed,
        &facts.root.device_fingerprint,
        facts.root.observed_revision,
        &intent.source_relative_path,
        &intent.destination_relative_path,
        &facts.source.content_hash,
        facts.source.byte_size,
    )
}

#[allow(clippy::too_many_arguments)]
fn derive_plan_id_from_fields(
    root_id: &RootId,
    plan_seed: &PlanSeed,
    device_fingerprint: &str,
    observed_revision: u64,
    source_relative_path: &RootRelativePath,
    destination_relative_path: &RootRelativePath,
    source_content_hash: &ContentHash,
    source_byte_size: u64,
) -> PlanId {
    let mut hasher = Sha256::new();
    hasher.update(b"masterocta:additive-copy-plan:v1");
    encode_field(&mut hasher, 1, root_id.as_str().as_bytes());
    encode_field(&mut hasher, 2, plan_seed.as_bytes());
    encode_field(&mut hasher, 3, device_fingerprint.as_bytes());
    encode_field(&mut hasher, 4, &observed_revision.to_be_bytes());
    encode_field(&mut hasher, 5, source_relative_path.as_str().as_bytes());
    encode_field(
        &mut hasher,
        6,
        destination_relative_path.as_str().as_bytes(),
    );
    encode_field(&mut hasher, 7, source_content_hash.as_str().as_bytes());
    encode_field(&mut hasher, 8, &source_byte_size.to_be_bytes());
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
    InvalidPlanSeed,
    RootMismatch,
    UnstableRootIdentity,
    InvalidRootFingerprint,
    InvalidObservedRevision,
    SourceObservationMismatch,
    SourceEqualsDestination,
    DestinationExists,
    IntegrityMismatch,
}

impl fmt::Display for PlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPlanId => "plan ID is not a versioned SHA-256 identifier",
            Self::InvalidPlanSeed => "plan seed is not a 32-byte lowercase hex value",
            Self::RootMismatch => "intent and observed source root do not match",
            Self::UnstableRootIdentity => "additive copy requires a stable root identity",
            Self::InvalidRootFingerprint => "root fingerprint is not a supported versioned value",
            Self::InvalidObservedRevision => "observed root revision must be non-zero",
            Self::SourceObservationMismatch => "source observation does not match the intent",
            Self::SourceEqualsDestination => "source and destination must be different paths",
            Self::DestinationExists => "additive copy destination must not already exist",
            Self::IntegrityMismatch => "change plan contents do not match the versioned plan ID",
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

    #[test]
    fn plan_id_detects_a_destination_changed_after_planning() {
        let (intent, facts) = fixture();
        let mut plan = plan_additive_copy(&intent, &facts).unwrap();
        assert_eq!(plan.validate_integrity(), Ok(()));

        plan.operation.destination_relative_path =
            RootRelativePath::parse("SET/PROJECT/replaced.wav").unwrap();
        assert_eq!(plan.validate_integrity(), Err(PlanError::IntegrityMismatch));
    }
}
