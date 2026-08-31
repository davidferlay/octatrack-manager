#![forbid(unsafe_code)]

use ot_domain::{ProjectDocument, SampleSlotId};
use std::fmt;

pub trait ProjectCodec {
    fn decode_project(&self, bytes: &[u8]) -> Result<ProjectDocument, CodecError>;
}

/// Memory-only Project reference rewrite. Implementations must not touch the
/// filesystem; they accept document bytes and return patched bytes.
pub trait ProjectReferenceCodec {
    fn inspect_sample_paths(&self, bytes: &[u8])
        -> Result<Vec<SlotPathRef>, ReferenceRewriteError>;

    fn apply_path_patches(
        &self,
        original: &[u8],
        patches: &[SlotPathPatch],
    ) -> Result<EncodedPatch, ReferenceRewriteError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlotPathRef {
    pub slot: SampleSlotId,
    pub raw_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlotPathPatch {
    pub slot: SampleSlotId,
    pub from_raw_path: String,
    pub to_raw_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncodedPatch {
    pub bytes: Vec<u8>,
    pub changed_slots: Vec<SampleSlotId>,
    pub inspected_after: Vec<SlotPathRef>,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReferenceRewriteError {
    IrreversibleEncoding,
    UnclosedSampleBlock,
    MissingType,
    MissingSlot,
    InvalidSlot,
    UnsupportedSlotType,
    DuplicateField,
    DuplicateSlot { kind: String, number: u16 },
    DuplicatePathLine,
    MissingPath,
    EmptyPath,
    TargetSlotNotFound,
    DuplicatePatch,
    FromPathMismatch,
    DirectoryChangeRejected,
    InvalidBasename,
    UnsafePathText,
    NestedSampleBlock,
    UnexpectedSampleCloser,
    ReparseMismatch,
}

impl fmt::Display for ReferenceRewriteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::IrreversibleEncoding => {
                "project document is not a reversible Windows-1258 text document"
            }
            Self::UnclosedSampleBlock => "malformed project file: unclosed [SAMPLE] block",
            Self::MissingType => "malformed [SAMPLE] block: missing TYPE",
            Self::MissingSlot => "malformed [SAMPLE] block: missing SLOT",
            Self::InvalidSlot => "malformed [SAMPLE] block: SLOT is not a valid number",
            Self::UnsupportedSlotType => "malformed [SAMPLE] block: TYPE is not STATIC or FLEX",
            Self::DuplicateField => "malformed [SAMPLE] block: duplicated TYPE or SLOT",
            Self::DuplicateSlot { .. } => "malformed project file: duplicate TYPE+SLOT",
            Self::DuplicatePathLine => "malformed [SAMPLE] block: multiple PATH lines",
            Self::MissingPath => "malformed [SAMPLE] block: missing PATH",
            Self::EmptyPath => "sample PATH is empty and cannot be rewritten",
            Self::TargetSlotNotFound => "target sample slot is not present",
            Self::DuplicatePatch => "duplicate patch targets the same sample slot",
            Self::FromPathMismatch => "current PATH does not match the expected from value",
            Self::DirectoryChangeRejected => {
                "PATH rewrite must keep the observed directory prefix and separator"
            }
            Self::InvalidBasename => "PATH basename is empty, reserved, or contains a separator",
            Self::UnsafePathText => {
                "PATH contains a newline, NUL, or [SAMPLE] tag and cannot be rewritten"
            }
            Self::NestedSampleBlock => "malformed project file: nested [SAMPLE] block",
            Self::UnexpectedSampleCloser => "malformed project file: unexpected [/SAMPLE]",
            Self::ReparseMismatch => "rewritten document did not reparse to the expected PATH set",
        })
    }
}

impl std::error::Error for ReferenceRewriteError {}
