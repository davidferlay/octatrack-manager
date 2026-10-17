//! Bank state-document byte validation for the native Bank Copy evidence harness.

use ot_tools_io::{BankFile, OctatrackFileIO};

/// Decode bytes as an Octatrack bank state document (`.work` / `.strd` schema).
pub fn validate_bank_state_document_bytes(bytes: &[u8]) -> Result<(), String> {
    BankFile::decode(bytes)
        .map(|_| ())
        .map_err(|err| err.to_string())
}
