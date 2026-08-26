#![forbid(unsafe_code)]

use ot_domain::ProjectDocument;
use std::fmt;

pub trait ProjectCodec {
    fn decode_project(&self, bytes: &[u8]) -> Result<ProjectDocument, CodecError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodecError {
    message: String,
}

impl CodecError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for CodecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CodecError {}
