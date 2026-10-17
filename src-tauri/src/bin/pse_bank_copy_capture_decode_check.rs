//! CLI helper for the Node Bank Copy evidence harness (decode-only, no writes).

use masterocta_lib::pse_bank_copy_state_doc_validate::validate_bank_state_document_bytes;
use std::env;
use std::fs;
use std::process::ExitCode;

fn main() -> ExitCode {
    let paths: Vec<String> = env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: pse_bank_copy_capture_decode_check <bank-file>...");
        return ExitCode::from(2);
    }
    for path in paths {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) => {
                eprintln!("{path}: read failed: {err}");
                return ExitCode::from(1);
            }
        };
        if let Err(err) = validate_bank_state_document_bytes(&bytes) {
            eprintln!("{path}: decode failed: {err}");
            return ExitCode::from(1);
        }
    }
    ExitCode::SUCCESS
}
