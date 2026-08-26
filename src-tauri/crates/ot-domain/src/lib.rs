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
}
