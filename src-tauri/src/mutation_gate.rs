use crate::rename_write_runtime::SharedRenameWriteRuntime;
use crate::root_registry::{RootRegistry, RootRegistryError};
use crate::write_runtime::SharedWriteRuntime;
use ot_domain::RootId;
use ot_executor::RenameJournalStatus;

pub fn ensure_cross_domain_mutation_allowed(
    registry: &RootRegistry,
    write: &SharedWriteRuntime,
    rename_runtime: &SharedRenameWriteRuntime,
    root_id: &RootId,
) -> Result<(), CrossDomainMutationBlocked> {
    let resolved = registry
        .resolve(root_id)
        .map_err(CrossDomainMutationBlocked::Registry)?;
    let fingerprint = resolved.session.device_fingerprint.as_str();
    let additive = write
        .recovery_required(fingerprint)
        .map_err(CrossDomainMutationBlocked::Write)?;
    if !additive.is_empty() {
        return Err(CrossDomainMutationBlocked::AdditiveRecoveryRequired);
    }
    let rename = rename_runtime
        .incomplete_operations(fingerprint)
        .map_err(CrossDomainMutationBlocked::Rename)?;
    if rename.iter().any(|status| {
        status.journal_status.is_some_and(|journal_status| {
            matches!(
                journal_status,
                RenameJournalStatus::Applying | RenameJournalStatus::RecoveryRequired
            )
        })
    }) {
        return Err(CrossDomainMutationBlocked::RenameRecoveryRequired);
    }
    Ok(())
}

#[derive(Debug)]
pub enum CrossDomainMutationBlocked {
    AdditiveRecoveryRequired,
    RenameRecoveryRequired,
    Registry(RootRegistryError),
    Write(crate::write_runtime::WriteRuntimeError),
    Rename(crate::rename_write_runtime::RenameWriteRuntimeError),
}

impl CrossDomainMutationBlocked {
    pub fn into_api_error(self) -> crate::v2_api::ApiError {
        match self {
            Self::AdditiveRecoveryRequired | Self::RenameRecoveryRequired => {
                crate::v2_api::cross_domain_recovery_required_error()
            }
            Self::Registry(error) => error.into(),
            Self::Write(error) => crate::v2_api::write_runtime_error(error),
            Self::Rename(error) => crate::v2_api::rename_runtime_error(error),
        }
    }
}
