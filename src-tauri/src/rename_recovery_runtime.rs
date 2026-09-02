#![forbid(unsafe_code)]

use crate::root_registry::{ResolvedRoot, RootRegistryError};
use ot_domain::{
    ContentHash, LibrarySnapshot, RootId, SampleReferenceStatus, SampleSettingsOwner,
    StateDocumentParseStatus,
};

use ot_executor::RenameProjectRewriteRecord;
use ot_plan::RenameImpactPlan;

/// Binds historical rename transaction evidence to the current verified clone root
/// without reusing historical `RootId` as the live authority identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedRecoveryCloneRoot {
    pub current_root_id: RootId,
    pub current_device_fingerprint: String,
    pub historical_root_id: String,
    pub historical_device_fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollbackVerificationOutcome {
    pub verification_state: &'static str,
    pub verification_code: Option<&'static str>,
    pub rescan_completed: bool,
    pub observed_file_count: u64,
    pub restored_reference_count: u64,
    pub missing_reference_count: u64,
    pub invalid_reference_count: u64,
    pub unresolved_reference_count: u64,
}

pub fn verified_recovery_clone_root(
    resolved: &ResolvedRoot,
    historical_root_id: &str,
    historical_device_fingerprint: &str,
) -> VerifiedRecoveryCloneRoot {
    VerifiedRecoveryCloneRoot {
        current_root_id: resolved.session.root_id.clone(),
        current_device_fingerprint: resolved.session.device_fingerprint.clone(),
        historical_root_id: historical_root_id.to_owned(),
        historical_device_fingerprint: historical_device_fingerprint.to_owned(),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryCloneRootBindingError {
    FingerprintMismatch,
}

impl RecoveryCloneRootBindingError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::FingerprintMismatch => "ROOT_FINGERPRINT_MISMATCH",
        }
    }
}

pub fn ensure_recovery_clone_root_binding(
    binding: &VerifiedRecoveryCloneRoot,
) -> Result<(), RecoveryCloneRootBindingError> {
    if binding.current_device_fingerprint != binding.historical_device_fingerprint {
        return Err(RecoveryCloneRootBindingError::FingerprintMismatch);
    }
    Ok(())
}

pub fn evaluate_rollback_verification(
    resolved: &ResolvedRoot,
    snapshot: &LibrarySnapshot,
    plan: &RenameImpactPlan,
    project_rewrites: &[RenameProjectRewriteRecord],
    rescan_completed: bool,
) -> RollbackVerificationOutcome {
    let observed_file_count = snapshot.file_instances.len() as u64;
    let missing_reference_count =
        count_sample_reference_status(snapshot, SampleReferenceStatus::Missing);
    let invalid_reference_count =
        count_sample_reference_status(snapshot, SampleReferenceStatus::InvalidPath);
    let unresolved_reference_count = count_unrestored_planned_references(snapshot, plan);
    let restored_reference_count = count_restored_planned_references(snapshot, plan);
    let invalid_affected_document_count = count_invalid_affected_project_documents(snapshot, plan);
    let audio_failure = verify_rollback_audio_postconditions(resolved, plan);
    let project_hash_failure =
        verify_rollback_project_document_hashes(resolved, plan, project_rewrites);
    let sidecar_failure = verify_rollback_sidecar_postconditions(resolved, snapshot, plan);
    let source_present = snapshot
        .file_instances
        .iter()
        .any(|file| file.relative_path.as_str() == plan.source_relative_path.as_str());
    let destination_present = snapshot
        .file_instances
        .iter()
        .any(|file| file.relative_path.as_str() == plan.destination_relative_path.as_str());

    let mut verification_state = "passed";
    let mut verification_code = None;

    if !rescan_completed {
        verification_state = "failed";
        verification_code = Some("RESCAN_FAILED");
    } else if let Some(code) = audio_failure {
        verification_state = "failed";
        verification_code = Some(code);
    } else if !source_present {
        verification_state = "failed";
        verification_code = Some("SOURCE_CATALOG_MISSING");
    } else if destination_present {
        verification_state = "failed";
        verification_code = Some("DESTINATION_CATALOG_STILL_PRESENT");
    } else if let Some(code) = project_hash_failure {
        verification_state = "failed";
        verification_code = Some(code);
    } else if invalid_affected_document_count > 0 {
        verification_state = "failed";
        verification_code = Some("AFFECTED_PROJECT_INVALID");
    } else if let Some(code) = sidecar_failure {
        verification_state = "failed";
        verification_code = Some(code);
    } else if missing_reference_count > 0 {
        verification_state = "failed";
        verification_code = Some("MISSING_REFERENCES");
    } else if invalid_reference_count > 0 {
        verification_state = "failed";
        verification_code = Some("INVALID_REFERENCES");
    } else if unresolved_reference_count > 0 {
        verification_state = "failed";
        verification_code = Some("PLANNED_REFERENCES_NOT_RESTORED");
    }

    RollbackVerificationOutcome {
        verification_state,
        verification_code,
        rescan_completed,
        observed_file_count,
        restored_reference_count,
        missing_reference_count,
        invalid_reference_count,
        unresolved_reference_count,
    }
}

fn count_sample_reference_status(snapshot: &LibrarySnapshot, status: SampleReferenceStatus) -> u64 {
    snapshot
        .slot_assignments
        .iter()
        .filter(|assignment| assignment.reference_status == status)
        .count() as u64
        + snapshot
            .usage_edges
            .iter()
            .filter(|edge| edge.reference_status == status)
            .count() as u64
}

fn count_restored_planned_references(snapshot: &LibrarySnapshot, plan: &RenameImpactPlan) -> u64 {
    let assignment_count = plan
        .state_document_impacts
        .iter()
        .flat_map(|impact| &impact.reference_updates)
        .filter(|update| {
            snapshot.slot_assignments.iter().any(|assignment| {
                assignment.project_document_relative_path == update.project_document_relative_path
                    && assignment.slot == update.slot
                    && assignment.reference_status == SampleReferenceStatus::Resolved
                    && assignment.referenced_file_relative_path.as_ref()
                        == Some(&update.from_relative_path)
            })
        })
        .count() as u64;
    let usage_count = plan
        .usage_edge_impacts
        .iter()
        .filter(|impact| {
            snapshot.usage_edges.iter().any(|edge| {
                edge.bank_document_relative_path == impact.bank_document_relative_path
                    && edge.project_document_relative_path == impact.project_document_relative_path
                    && edge.slot == impact.slot
                    && edge.usage_kind == impact.usage_kind
                    && edge.reference_status == SampleReferenceStatus::Resolved
                    && edge.referenced_file_relative_path.as_ref()
                        == Some(&plan.source_relative_path)
            })
        })
        .count() as u64;
    assignment_count + usage_count
}

fn count_unrestored_planned_references(snapshot: &LibrarySnapshot, plan: &RenameImpactPlan) -> u64 {
    let unresolved_assignments = plan
        .state_document_impacts
        .iter()
        .flat_map(|impact| &impact.reference_updates)
        .filter(|update| {
            !snapshot.slot_assignments.iter().any(|assignment| {
                assignment.project_document_relative_path == update.project_document_relative_path
                    && assignment.slot == update.slot
                    && assignment.reference_status == SampleReferenceStatus::Resolved
                    && assignment.referenced_file_relative_path.as_ref()
                        == Some(&update.from_relative_path)
            })
        })
        .count() as u64;
    let unresolved_usage_edges = plan
        .usage_edge_impacts
        .iter()
        .filter(|impact| {
            !snapshot.usage_edges.iter().any(|edge| {
                edge.bank_document_relative_path == impact.bank_document_relative_path
                    && edge.project_document_relative_path == impact.project_document_relative_path
                    && edge.slot == impact.slot
                    && edge.usage_kind == impact.usage_kind
                    && edge.reference_status == SampleReferenceStatus::Resolved
                    && edge.referenced_file_relative_path.as_ref()
                        == Some(&plan.source_relative_path)
            })
        })
        .count() as u64;
    unresolved_assignments + unresolved_usage_edges
}

fn count_invalid_affected_project_documents(
    snapshot: &LibrarySnapshot,
    plan: &RenameImpactPlan,
) -> u64 {
    plan.state_document_impacts
        .iter()
        .filter(|impact| {
            !snapshot.state_documents.iter().any(|document| {
                document.source_relative_path == impact.relative_path
                    && document.kind == impact.kind
                    && document.role == impact.role
                    && document.parse_status == StateDocumentParseStatus::Parsed
            })
        })
        .count() as u64
}

fn verify_rollback_audio_postconditions(
    resolved: &ResolvedRoot,
    plan: &RenameImpactPlan,
) -> Option<&'static str> {
    let source = match resolved.resolve_regular_file(&plan.source_relative_path) {
        Ok(path) => path,
        Err(RootRegistryError::NotRegularFile) => return Some("SOURCE_NOT_RESTORED"),
        Err(_) => return Some("SOURCE_CHECK_FAILED"),
    };
    let Ok((byte_size, content_hash)) = hash_live_source(&source) else {
        return Some("SOURCE_CHECK_FAILED");
    };
    if byte_size != plan.source_byte_size || content_hash != plan.source_content_hash {
        return Some("SOURCE_HASH_MISMATCH");
    }
    match resolved.resolve_regular_file(&plan.destination_relative_path) {
        Err(RootRegistryError::NotRegularFile) => {}
        Ok(_) => return Some("DESTINATION_STILL_PRESENT"),
        Err(_) => return Some("DESTINATION_CHECK_FAILED"),
    }
    None
}

fn verify_rollback_project_document_hashes(
    resolved: &ResolvedRoot,
    plan: &RenameImpactPlan,
    project_rewrites: &[RenameProjectRewriteRecord],
) -> Option<&'static str> {
    for impact in &plan.state_document_impacts {
        if impact.reference_updates.is_empty() {
            continue;
        }
        let Some(rewrite) = project_rewrites
            .iter()
            .find(|rewrite| rewrite.relative_path == impact.relative_path.as_str())
        else {
            return Some("PROJECT_REWRITE_EVIDENCE_MISSING");
        };
        let path = match resolved.resolve_regular_file(&impact.relative_path) {
            Ok(path) => path,
            Err(RootRegistryError::NotRegularFile) => {
                return Some("AFFECTED_PROJECT_NOT_RESTORED");
            }
            Err(_) => return Some("AFFECTED_PROJECT_CHECK_FAILED"),
        };
        let Ok((_, content_hash)) = hash_live_source(&path) else {
            return Some("AFFECTED_PROJECT_CHECK_FAILED");
        };
        if content_hash.as_str() != rewrite.backup_content_hash {
            return Some("AFFECTED_PROJECT_HASH_MISMATCH");
        }
    }
    None
}

fn verify_rollback_sidecar_postconditions(
    resolved: &ResolvedRoot,
    snapshot: &LibrarySnapshot,
    plan: &RenameImpactPlan,
) -> Option<&'static str> {
    for impact in &plan.sidecar_impacts {
        let source = match resolved.resolve_regular_file(&impact.source_sidecar_relative_path) {
            Ok(path) => path,
            Err(RootRegistryError::NotRegularFile) => {
                return Some("SOURCE_SIDECAR_NOT_RESTORED");
            }
            Err(_) => return Some("SOURCE_SIDECAR_CHECK_FAILED"),
        };
        let Ok((byte_size, content_hash)) = hash_live_source(&source) else {
            return Some("SOURCE_SIDECAR_CHECK_FAILED");
        };
        if byte_size != impact.byte_size || content_hash != impact.content_hash {
            return Some("SOURCE_SIDECAR_HASH_MISMATCH");
        }
        match resolved.resolve_regular_file(&impact.destination_sidecar_relative_path) {
            Err(RootRegistryError::NotRegularFile) => {}
            Ok(_) => return Some("DESTINATION_SIDECAR_STILL_PRESENT"),
            Err(_) => return Some("DESTINATION_SIDECAR_CHECK_FAILED"),
        }
        let source_is_active = snapshot.sample_settings.iter().any(|settings| {
            settings.owner == SampleSettingsOwner::FileInstanceSidecar
                && settings.source_relative_path == impact.source_sidecar_relative_path
                && settings.file_instance_relative_path.as_ref() == Some(&plan.source_relative_path)
                && settings.parse_status == impact.parse_status
        });
        let destination_is_active = snapshot.sample_settings.iter().any(|settings| {
            settings.owner == SampleSettingsOwner::FileInstanceSidecar
                && settings.source_relative_path == impact.destination_sidecar_relative_path
        });
        if !source_is_active || destination_is_active {
            return Some("SIDECAR_CATALOG_MISMATCH");
        }
    }
    None
}

fn hash_live_source(path: &std::path::Path) -> Result<(u64, ContentHash), ()> {
    use sha2::{Digest, Sha256};
    use std::fs::File;
    use std::io::Read;

    let mut file = File::open(path).map_err(|_| ())?;
    let metadata = file.metadata().map_err(|_| ())?;
    let bytes = metadata.len();
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|_| ())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    ContentHash::parse(format!("sha256:{:x}", hasher.finalize()))
        .map(|hash| (bytes, hash))
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_recovery_clone_root_binding_requires_matching_fingerprints() {
        let binding = VerifiedRecoveryCloneRoot {
            current_root_id: RootId::new("root:v1:current").unwrap(),
            current_device_fingerprint: "rootfp:v1:current".into(),
            historical_root_id: "root:v1:historical".into(),
            historical_device_fingerprint: "rootfp:v1:historical".into(),
        };
        assert_eq!(
            ensure_recovery_clone_root_binding(&binding),
            Err(RecoveryCloneRootBindingError::FingerprintMismatch)
        );

        let matching = VerifiedRecoveryCloneRoot {
            historical_device_fingerprint: "rootfp:v1:current".into(),
            ..binding
        };
        assert!(ensure_recovery_clone_root_binding(&matching).is_ok());
    }

    #[test]
    fn verified_recovery_clone_root_keeps_historical_and_current_separate() {
        use crate::root_registry::{ResolvedRoot, RootCapabilities, RootSession};

        let resolved = ResolvedRoot {
            session: RootSession {
                root_id: RootId::new("root:v1:current").unwrap(),
                device_fingerprint: "rootfp:v1:current".into(),
                display_name: "clone".into(),
                observed_revision: 2,
                expires_in_seconds: 3600,
                write_grant_expires_in_seconds: None,
                capabilities: RootCapabilities {
                    read: true,
                    write: false,
                    stable_device_identity: true,
                },
            },
            canonical_path: std::path::PathBuf::from("/tmp/clone"),
        };
        let binding =
            verified_recovery_clone_root(&resolved, "root:v1:historical", "rootfp:v1:historical");
        assert_eq!(binding.current_root_id.as_str(), "root:v1:current");
        assert_eq!(binding.historical_root_id, "root:v1:historical");
        assert_ne!(binding.current_root_id.as_str(), binding.historical_root_id);
    }
}
