use ot_domain::ProjectCompatibilityEvidence;
use ot_tools_io::ProjectFile;

const VERIFIED_PROJECT_VERSION: u32 = 19;
const VERIFIED_OS_REVISION: &str = "R0173";
const VERIFIED_OS_RELEASE: &str = "1.40";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UpstreamCompatibility {
    Supported,
    Unsupported,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProjectCompatibility {
    Supported {
        evidence: ProjectCompatibilityEvidence,
    },
    UnsupportedVersion,
    Malformed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectOsVersion {
    pub(crate) revision: String,
    pub(crate) release: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectCompatibilityDecision {
    pub(crate) compatibility: ProjectCompatibility,
    pub(crate) upstream: UpstreamCompatibility,
    pub(crate) project_version: u32,
    pub(crate) os_version: Option<ProjectOsVersion>,
}

pub(crate) fn evaluate_project_compatibility(
    project: &ProjectFile,
) -> ProjectCompatibilityDecision {
    evaluate_metadata(
        project.metadata.project_version,
        &project.metadata.os_version,
        project
            .check_compatible_os_version()
            .map_err(|_| UpstreamCompatibility::Error),
    )
}

fn evaluate_metadata(
    project_version: u32,
    os_version: &str,
    upstream_result: Result<bool, UpstreamCompatibility>,
) -> ProjectCompatibilityDecision {
    let os_version = parse_os_version(os_version);
    let upstream = match upstream_result {
        Ok(true) => UpstreamCompatibility::Supported,
        Ok(false) => UpstreamCompatibility::Unsupported,
        Err(_) => UpstreamCompatibility::Error,
    };
    let compatibility = match upstream {
        UpstreamCompatibility::Supported => ProjectCompatibility::Supported {
            evidence: ProjectCompatibilityEvidence::UpstreamLibrary,
        },
        UpstreamCompatibility::Error => ProjectCompatibility::Malformed,
        UpstreamCompatibility::Unsupported
            if project_version == VERIFIED_PROJECT_VERSION
                && os_version.as_ref().is_some_and(|version| {
                    version.revision == VERIFIED_OS_REVISION
                        && version.release == VERIFIED_OS_RELEASE
                }) =>
        {
            ProjectCompatibility::Supported {
                evidence: ProjectCompatibilityEvidence::VerifiedMasterOctaFixture,
            }
        }
        UpstreamCompatibility::Unsupported => ProjectCompatibility::UnsupportedVersion,
    };

    ProjectCompatibilityDecision {
        compatibility,
        upstream,
        project_version,
        os_version,
    }
}

fn parse_os_version(value: &str) -> Option<ProjectOsVersion> {
    let separator_start = value.as_bytes().iter().position(|byte| *byte == b' ')?;
    let revision = &value[..separator_start];
    let separator_end = value.as_bytes()[separator_start..]
        .iter()
        .position(|byte| *byte != b' ')
        .map(|offset| separator_start + offset)?;
    let release = &value[separator_end..];

    if release.contains(' ') || !valid_revision(revision) || !valid_release(release) {
        return None;
    }

    Some(ProjectOsVersion {
        revision: revision.to_owned(),
        release: release.to_owned(),
    })
}

fn valid_revision(value: &str) -> bool {
    value.len() == 5
        && value.starts_with('R')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_digit)
}

fn valid_release(value: &str) -> bool {
    let Some((major, minor_and_suffix)) = value.split_once('.') else {
        return false;
    };
    if major.is_empty() || !major.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let bytes = minor_and_suffix.as_bytes();
    matches!(bytes.len(), 2 | 3)
        && bytes[..2].iter().all(u8::is_ascii_digit)
        && (bytes.len() == 2 || bytes[2].is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_reader::read_raw_sample_fields;
    use ot_tools_io::OctatrackFileIO;
    use sha2::{Digest, Sha256};
    use std::{fs, path::Path};

    const REAL_DEVICE_FIXTURE_SHA256: &str =
        "742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6";

    fn evaluate(
        project_version: u32,
        os_version: &str,
        upstream_result: Result<bool, UpstreamCompatibility>,
    ) -> ProjectCompatibilityDecision {
        evaluate_metadata(project_version, os_version, upstream_result)
    }

    #[test]
    fn parses_verified_device_os_version() {
        assert_eq!(
            parse_os_version("R0173      1.40"),
            Some(ProjectOsVersion {
                revision: "R0173".into(),
                release: "1.40".into(),
            })
        );
    }

    #[test]
    fn accepts_only_ascii_space_count_variation_between_tokens() {
        assert_eq!(
            parse_os_version("R0173 1.40"),
            parse_os_version("R0173      1.40")
        );
        assert!(parse_os_version("R0173\t1.40").is_none());
        assert!(parse_os_version(" R0173 1.40").is_none());
        assert!(parse_os_version("R0173 1.40 ").is_none());
    }

    #[test]
    fn rejects_trailing_junk() {
        assert!(parse_os_version("R0173 1.40 unknown").is_none());
    }

    #[test]
    fn does_not_treat_1_40b_as_the_verified_1_40_override() {
        let decision = evaluate(19, "R0177     1.40B", Ok(false));

        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::UnsupportedVersion
        );
        assert_eq!(decision.os_version.unwrap().release, "1.40B");
    }

    #[test]
    fn requires_project_version_19_for_the_override() {
        let decision = evaluate(20, "R0173 1.40", Ok(false));

        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::UnsupportedVersion
        );
    }

    #[test]
    fn rejects_unknown_revision() {
        let decision = evaluate(19, "R0174 1.40", Ok(false));

        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::UnsupportedVersion
        );
    }

    #[test]
    fn rejects_unknown_release() {
        let decision = evaluate(19, "R0173 1.41", Ok(false));

        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::UnsupportedVersion
        );
    }

    #[test]
    fn rejects_malformed_os_versions() {
        for value in [
            "R0173 1.40BETA",
            "R01730 1.40",
            "R0173 1.4",
            "R0173/1.40",
            "1.40",
        ] {
            let decision = evaluate(19, value, Ok(false));
            assert_eq!(
                decision.compatibility,
                ProjectCompatibility::UnsupportedVersion,
                "{value}"
            );
            assert!(decision.os_version.is_none(), "{value}");
        }
    }

    #[test]
    fn preserves_upstream_supported_versions() {
        let decision = evaluate(19, "R0177     1.40B", Ok(true));

        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::Supported {
                evidence: ProjectCompatibilityEvidence::UpstreamLibrary,
            }
        );
        assert_eq!(decision.upstream, UpstreamCompatibility::Supported);
    }

    #[test]
    fn supports_only_the_verified_local_override() {
        let supported = evaluate(19, "R0173      1.40", Ok(false));
        let unsupported = evaluate(19, "R0172 1.40", Ok(false));

        assert_eq!(
            supported.compatibility,
            ProjectCompatibility::Supported {
                evidence: ProjectCompatibilityEvidence::VerifiedMasterOctaFixture,
            }
        );
        assert_eq!(supported.upstream, UpstreamCompatibility::Unsupported);
        assert_eq!(supported.project_version, 19);
        assert_eq!(
            unsupported.compatibility,
            ProjectCompatibility::UnsupportedVersion
        );
    }

    #[test]
    fn treats_upstream_errors_as_malformed() {
        let decision = evaluate(19, "R0173 1.40", Err(UpstreamCompatibility::Error));

        assert_eq!(decision.compatibility, ProjectCompatibility::Malformed);
        assert_eq!(decision.upstream, UpstreamCompatibility::Error);
    }

    #[test]
    fn real_device_1_40_fixture_is_supported_without_serializing_it() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/real_device_os_1_40/project.work");
        let before = fs::read(&fixture).unwrap();
        let before_hash = format!("{:x}", Sha256::digest(&before));

        assert_eq!(before.len(), 2898);
        assert_eq!(before_hash, REAL_DEVICE_FIXTURE_SHA256);

        let project = ProjectFile::from_bytes(&before).unwrap();
        assert_eq!(project.metadata.filetype, "OCTATRACK DPS-1 PROJECT");
        assert_eq!(project.metadata.project_version, 19);
        assert_eq!(project.metadata.os_version, "R0173      1.40");
        assert!(!project.check_compatible_os_version().unwrap());

        let raw_samples = read_raw_sample_fields(&fixture).unwrap();
        assert_eq!(raw_samples.len(), 8);
        assert!(raw_samples.iter().all(|((slot_type, slot), fields)| {
            slot_type == "FLEX"
                && (129..=136).contains(slot)
                && fields.get("PATH").is_some_and(String::is_empty)
        }));

        let decision = evaluate_project_compatibility(&project);
        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::Supported {
                evidence: ProjectCompatibilityEvidence::VerifiedMasterOctaFixture,
            }
        );
        assert_eq!(decision.upstream, UpstreamCompatibility::Unsupported);
        assert_eq!(
            decision.os_version,
            Some(ProjectOsVersion {
                revision: "R0173".into(),
                release: "1.40".into(),
            })
        );

        let after = fs::read(&fixture).unwrap();
        assert_eq!(after, before);
        assert_eq!(
            format!("{:x}", Sha256::digest(&after)),
            REAL_DEVICE_FIXTURE_SHA256
        );
    }

    #[test]
    fn existing_real_device_1_40b_fixture_keeps_upstream_evidence() {
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/real_device/project.work");
        let project = ProjectFile::from_data_file(&fixture).unwrap();

        assert_eq!(project.metadata.project_version, 19);
        assert_eq!(project.metadata.os_version, "R0177     1.40B");
        let decision = evaluate_project_compatibility(&project);
        assert_eq!(
            decision.compatibility,
            ProjectCompatibility::Supported {
                evidence: ProjectCompatibilityEvidence::UpstreamLibrary,
            }
        );
        assert_eq!(decision.upstream, UpstreamCompatibility::Supported);
    }
}
