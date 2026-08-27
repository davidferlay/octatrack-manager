#![forbid(unsafe_code)]

use std::fmt;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct RootId(String);

impl RootId {
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidIdentifier> {
        parse_identifier(value, "root").map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ProjectId(String);

impl ProjectId {
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidIdentifier> {
        parse_identifier(value, "project").map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn parse_identifier(
    value: impl Into<String>,
    kind: &'static str,
) -> Result<String, InvalidIdentifier> {
    let value = value.into();
    if value.trim().is_empty() {
        Err(InvalidIdentifier { kind })
    } else {
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvalidIdentifier {
    kind: &'static str,
}

impl fmt::Display for InvalidIdentifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} identifier must not be empty", self.kind)
    }
}

impl std::error::Error for InvalidIdentifier {}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct RootRelativePath(String);

impl RootRelativePath {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, InvalidRootRelativePath> {
        let value = value.as_ref();
        if value.is_empty() {
            return Err(InvalidRootRelativePath::Empty);
        }
        if value.starts_with(['/', '\\']) || has_windows_drive_prefix(value) {
            return Err(InvalidRootRelativePath::Absolute);
        }
        if value.contains('\0') {
            return Err(InvalidRootRelativePath::InvalidComponent);
        }

        let mut normalized = Vec::new();
        for component in value.split(['/', '\\']) {
            match component {
                ".." => return Err(InvalidRootRelativePath::Traversal),
                "" | "." => return Err(InvalidRootRelativePath::InvalidComponent),
                component => normalized.push(component),
            }
        }

        Ok(Self(normalized.join("/")))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn from_components<I, S>(components: I) -> Result<Self, InvalidRootRelativePath>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let components = components
            .into_iter()
            .map(|component| {
                RootPathComponent::parse(component)
                    .map(|component| component.as_str().to_owned())
                    .map_err(|_| InvalidRootRelativePath::InvalidComponent)
            })
            .collect::<Result<Vec<_>, _>>()?;

        if components.is_empty() {
            return Err(InvalidRootRelativePath::Empty);
        }

        Ok(Self(components.join("/")))
    }
}

fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InvalidRootRelativePath {
    Empty,
    Absolute,
    Traversal,
    InvalidComponent,
}

impl fmt::Display for InvalidRootRelativePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let reason = match self {
            Self::Empty => "path must not be empty",
            Self::Absolute => "path must be relative to a registered root",
            Self::Traversal => "path must not traverse outside its root",
            Self::InvalidComponent => "path contains an invalid component",
        };
        formatter.write_str(reason)
    }
}

impl std::error::Error for InvalidRootRelativePath {}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct RootPathComponent(String);

impl RootPathComponent {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, InvalidRootPathComponent> {
        let value = value.as_ref();
        if value.is_empty() || value == "." || value == ".." || value.contains('\0') {
            return Err(InvalidRootPathComponent);
        }
        if value.contains(['/', '\\']) || has_windows_drive_prefix(value) {
            return Err(InvalidRootPathComponent);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvalidRootPathComponent;

impl fmt::Display for InvalidRootPathComponent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("path component must be a non-empty basename without separators")
    }
}

impl std::error::Error for InvalidRootPathComponent {}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StateDocumentKind {
    Project,
    Bank,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StateDocumentRole {
    Working,
    SavedCheckpoint,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StateDocumentParseStatus {
    Parsed,
    UnsupportedVersion,
    Malformed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParserProvenance {
    pub parser_name: String,
    pub parser_revision: String,
    pub source_version: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StateDocument {
    pub project_relative_path: RootRelativePath,
    pub source_relative_path: RootRelativePath,
    pub kind: StateDocumentKind,
    pub role: StateDocumentRole,
    pub bank_index: Option<u8>,
    pub parse_status: StateDocumentParseStatus,
    pub parser_provenance: ParserProvenance,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleStorageScope {
    SetAudioPool,
    ProjectLocal,
    Unclassified,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleSlotKind {
    Static,
    Flex,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct SampleSlotId {
    kind: SampleSlotKind,
    number: u16,
}

impl SampleSlotId {
    pub fn new(kind: SampleSlotKind, number: u16) -> Result<Self, InvalidSampleSlotId> {
        let valid = match kind {
            SampleSlotKind::Static => (1..=128).contains(&number),
            SampleSlotKind::Flex => (1..=128).contains(&number),
        };
        if !valid {
            return Err(InvalidSampleSlotId { kind, number });
        }
        Ok(Self { kind, number })
    }

    pub fn kind(self) -> SampleSlotKind {
        self.kind
    }

    pub fn number(self) -> u16 {
        self.number
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvalidSampleSlotId {
    kind: SampleSlotKind,
    number: u16,
}

impl fmt::Display for InvalidSampleSlotId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid {:?} sample slot {}",
            self.kind, self.number
        )
    }
}

impl std::error::Error for InvalidSampleSlotId {}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleReferenceStatus {
    Resolved,
    Missing,
    InvalidPath,
    UnassignedSlot,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlotAssignment {
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub referenced_file_relative_path: Option<RootRelativePath>,
    pub reference_status: SampleReferenceStatus,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleUsageKind {
    Machine,
    SampleLock,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SampleUsageEdge {
    pub bank_document_relative_path: RootRelativePath,
    pub project_document_relative_path: RootRelativePath,
    pub slot: SampleSlotId,
    pub usage_kind: SampleUsageKind,
    pub track_index: u8,
    pub part_index: Option<u8>,
    pub pattern_index: Option<u8>,
    pub step_index: Option<u8>,
    pub audible: bool,
    pub referenced_file_relative_path: Option<RootRelativePath>,
    pub reference_status: SampleReferenceStatus,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ContentHash(String);

impl ContentHash {
    pub fn parse(value: impl Into<String>) -> Result<Self, InvalidContentHash> {
        let value = value.into();
        let digest = value.strip_prefix("sha256:").ok_or(InvalidContentHash)?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(InvalidContentHash);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvalidContentHash;

impl fmt::Display for InvalidContentHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(
            "content hash must be sha256 followed by 64 lowercase hexadecimal characters",
        )
    }
}

impl std::error::Error for InvalidContentHash {}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ContentHashFreshness {
    ComputedThisScan,
    ReusedUnchangedMetadata,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AudioAsset {
    pub content_hash: ContentHash,
    pub byte_size: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileInstance {
    pub relative_path: RootRelativePath,
    pub content_hash: ContentHash,
    pub byte_size: u64,
    pub modified_at_unix_ns: Option<i64>,
    pub storage_scope: SampleStorageScope,
    pub hash_freshness: ContentHashFreshness,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleSettingsOwner {
    SlotAssignment,
    FileInstanceSidecar,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleSettingsParseStatus {
    Parsed,
    UnsupportedVersion,
    Malformed,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SampleSettingsEvidence {
    OfficialDocumentation,
    ReproducedFixtureObservation,
    LegacyImplementationObservation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SampleSlice {
    pub index: u8,
    pub trim_start: u32,
    pub trim_end: u32,
    pub loop_start: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SampleSettings {
    pub owner: SampleSettingsOwner,
    pub source_relative_path: RootRelativePath,
    pub marker_source_relative_path: Option<RootRelativePath>,
    pub project_document_relative_path: Option<RootRelativePath>,
    pub slot: Option<SampleSlotId>,
    pub file_instance_relative_path: Option<RootRelativePath>,
    pub parse_status: SampleSettingsParseStatus,
    pub parser_provenance: ParserProvenance,
    pub source_os_version: Option<String>,
    pub evidence: SampleSettingsEvidence,
    pub gain: Option<u16>,
    pub tempo_x24: Option<u32>,
    pub trim_bars_x100: Option<u32>,
    pub loop_bars_x100: Option<u32>,
    pub stretch_mode: Option<u32>,
    pub loop_mode: Option<u32>,
    pub trig_quantization: Option<i32>,
    pub trim_start: Option<u32>,
    pub trim_end: Option<u32>,
    pub loop_start: Option<u32>,
    pub slices: Vec<SampleSlice>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LibraryProject {
    pub display_name: String,
    pub relative_path: RootRelativePath,
    pub has_project_file: bool,
    pub has_banks: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LibrarySet {
    pub display_name: String,
    pub relative_path: RootRelativePath,
    pub has_audio_pool: bool,
    pub projects: Vec<LibraryProject>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LibrarySnapshot {
    pub sets: Vec<LibrarySet>,
    pub standalone_projects: Vec<LibraryProject>,
    pub audio_assets: Vec<AudioAsset>,
    pub file_instances: Vec<FileInstance>,
    pub state_documents: Vec<StateDocument>,
    pub slot_assignments: Vec<SlotAssignment>,
    pub usage_edges: Vec<SampleUsageEdge>,
    pub sample_settings: Vec<SampleSettings>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectDocument {
    pub id: ProjectId,
    pub display_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_reject_blank_values() {
        assert!(RootId::new("  ").is_err());
        assert!(ProjectId::new("").is_err());
    }

    #[test]
    fn root_relative_paths_normalize_separators() {
        let path = RootRelativePath::parse(r"projects\demo\project.work").unwrap();
        assert_eq!(path.as_str(), "projects/demo/project.work");
    }

    #[test]
    fn root_relative_paths_reject_escape_attempts() {
        assert_eq!(
            RootRelativePath::parse("../outside.work"),
            Err(InvalidRootRelativePath::Traversal)
        );
        assert_eq!(
            RootRelativePath::parse("/absolute.work"),
            Err(InvalidRootRelativePath::Absolute)
        );
        assert_eq!(
            RootRelativePath::parse(r"C:\absolute.work"),
            Err(InvalidRootRelativePath::Absolute)
        );
    }

    #[test]
    fn path_components_reject_separators_and_traversal() {
        assert!(RootPathComponent::parse("SET/PROJECT").is_err());
        assert!(RootPathComponent::parse(r"SET\PROJECT").is_err());
        assert!(RootPathComponent::parse("..").is_err());
        assert!(RootPathComponent::parse(".").is_err());
    }

    #[test]
    fn relative_paths_can_be_built_only_from_valid_components() {
        let path = RootRelativePath::from_components(["SET", "PROJECT"]).unwrap();
        assert_eq!(path.as_str(), "SET/PROJECT");

        assert_eq!(
            RootRelativePath::from_components(["SET", "BAD/PROJECT"]),
            Err(InvalidRootRelativePath::InvalidComponent)
        );
    }

    #[test]
    fn state_document_axes_remain_independent() {
        assert_ne!(StateDocumentKind::Project, StateDocumentKind::Bank);
        assert_ne!(
            StateDocumentRole::Working,
            StateDocumentRole::SavedCheckpoint
        );
    }

    #[test]
    fn sample_storage_scopes_remain_distinct() {
        let scopes = [
            SampleStorageScope::SetAudioPool,
            SampleStorageScope::ProjectLocal,
            SampleStorageScope::Unclassified,
        ];

        assert_eq!(scopes.len(), 3);
        assert_ne!(scopes[0], scopes[1]);
        assert_ne!(scopes[0], scopes[2]);
        assert_ne!(scopes[1], scopes[2]);
    }

    #[test]
    fn content_hash_accepts_only_canonical_sha256_values() {
        let valid = format!("sha256:{}", "0123456789abcdef".repeat(4));
        assert_eq!(ContentHash::parse(&valid).unwrap().as_str(), valid);

        for invalid in [
            String::new(),
            "md5:0123456789abcdef0123456789abcdef".into(),
            format!("sha256:{}", "a".repeat(63)),
            format!("sha256:{}", "A".repeat(64)),
            format!("sha256:{}g", "a".repeat(63)),
        ] {
            assert!(ContentHash::parse(invalid).is_err());
        }
    }

    #[test]
    fn inventory_separates_content_identity_from_relative_path() {
        let hash = ContentHash::parse(format!("sha256:{}", "a".repeat(64))).unwrap();
        let asset = AudioAsset {
            content_hash: hash.clone(),
            byte_size: 4,
        };
        let instance = FileInstance {
            relative_path: RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap(),
            content_hash: hash,
            byte_size: 4,
            modified_at_unix_ns: Some(1),
            storage_scope: SampleStorageScope::SetAudioPool,
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        };

        assert_eq!(asset.byte_size, instance.byte_size);
        assert_eq!(instance.relative_path.as_str(), "SET/AUDIO/kick.wav");
        assert_ne!(
            ContentHashFreshness::ComputedThisScan,
            ContentHashFreshness::ReusedUnchangedMetadata
        );
    }

    #[test]
    fn sample_settings_owners_remain_distinct() {
        assert_ne!(
            SampleSettingsOwner::SlotAssignment,
            SampleSettingsOwner::FileInstanceSidecar
        );
    }

    #[test]
    fn sample_slot_ids_enforce_octatrack_pool_ranges() {
        assert!(SampleSlotId::new(SampleSlotKind::Static, 1).is_ok());
        assert!(SampleSlotId::new(SampleSlotKind::Static, 128).is_ok());
        assert!(SampleSlotId::new(SampleSlotKind::Static, 129).is_err());
        assert!(SampleSlotId::new(SampleSlotKind::Flex, 128).is_ok());
        assert!(SampleSlotId::new(SampleSlotKind::Flex, 129).is_err());
        assert!(SampleSlotId::new(SampleSlotKind::Flex, 0).is_err());
    }

    #[test]
    fn state_projection_keeps_source_and_target_paths_root_relative() {
        let project = RootRelativePath::parse("SET/PROJECT").unwrap();
        let project_document = RootRelativePath::parse("SET/PROJECT/project.work").unwrap();
        let target = RootRelativePath::parse("SET/AUDIO/kick.wav").unwrap();
        let document = StateDocument {
            project_relative_path: project,
            source_relative_path: project_document.clone(),
            kind: StateDocumentKind::Project,
            role: StateDocumentRole::Working,
            bank_index: None,
            parse_status: StateDocumentParseStatus::Parsed,
            parser_provenance: ParserProvenance {
                parser_name: "ot-tools-io".into(),
                parser_revision: "fixture".into(),
                source_version: Some("1.40A".into()),
            },
        };
        let assignment = SlotAssignment {
            project_document_relative_path: project_document,
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(target),
            reference_status: SampleReferenceStatus::Resolved,
        };

        assert_eq!(document.kind, StateDocumentKind::Project);
        assert_eq!(assignment.slot.number(), 1);
        assert_eq!(assignment.reference_status, SampleReferenceStatus::Resolved);
    }
}
