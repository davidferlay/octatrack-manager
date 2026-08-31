#![forbid(unsafe_code)]

use ot_domain::{
    ContentHash, ContentHashFreshness, ParserProvenance, ProjectCompatibilityEvidence,
    RenameSampleIntent, RootId, RootRelativePath, SampleReferenceStatus, SampleSettingsParseStatus,
    SampleSlotId, SampleSlotKind, SampleUsageKind, StateDocumentKind, StateDocumentParseStatus,
    StateDocumentRole,
};
use ot_plan::derive_file_instance_id;
use ot_plan::{
    plan_rename_sample, sidecar_destination_for_audio_destination, validate_rename_plan_freshness,
    BlockedRenameImpact, RenameBlockReason, RenameDestinationObservation, RenameDestinationState,
    RenamePlanningOutcome, RenameRootObservation, RenameSamplePlanningFacts,
    RenameSidecarObservation, RenameSlotAssignmentObservation, RenameSourceObservation,
    RenameStaleReason, RenameStateDocumentObservation, RenameUsageEdgeObservation,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn sha256_file(path: &Path) -> String {
    let bytes = fs::read(path).expect("fixture bytes");
    format!("{:x}", Sha256::digest(bytes))
}

fn snapshot_directory(root: &Path) -> Vec<(PathBuf, u64, String)> {
    let mut entries = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path().to_path_buf();
        let relative = path
            .strip_prefix(root)
            .expect("relative path")
            .to_path_buf();
        let metadata = fs::metadata(&path).expect("metadata");
        entries.push((relative, metadata.len(), sha256_file(&path)));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries
}

fn hash(byte: u8) -> ContentHash {
    ContentHash::parse(format!("sha256:{}", format!("{byte:02x}").repeat(32))).unwrap()
}

fn build_fixture_facts(
    root_fingerprint: &str,
    source_path: &str,
    destination_path: &str,
    source_size: u64,
) -> RenameSamplePlanningFacts {
    let source = RootRelativePath::parse(source_path).unwrap();
    RenameSamplePlanningFacts {
        root: RenameRootObservation {
            root_id: RootId::new("integration-root").unwrap(),
            device_fingerprint: root_fingerprint.to_owned(),
            live_observed_revision: 3,
            base_catalog_scan_revision: 3,
            scan_completed: true,
            identity_is_stable: true,
        },
        source: RenameSourceObservation {
            file_instance_id: derive_file_instance_id(root_fingerprint, &source),
            catalog_relative_path: source.clone(),
            catalog_byte_size: source_size,
            catalog_content_hash: hash(b'a'),
            live_relative_path: source,
            live_byte_size: source_size,
            live_content_hash: hash(b'a'),
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        },
        destination: RenameDestinationObservation {
            intended_relative_path: RootRelativePath::parse(destination_path).unwrap(),
            state: RenameDestinationState::Absent,
        },
        sidecar_destination: sidecar_destination_for_audio_destination(destination_path),
        state_documents: vec![RenameStateDocumentObservation {
            relative_path: RootRelativePath::parse("SET/PROJECT/project.work").unwrap(),
            kind: StateDocumentKind::Project,
            role: StateDocumentRole::Working,
            byte_size: 256,
            content_hash: hash(b'p'),
            parse_status: StateDocumentParseStatus::Parsed,
            parser_provenance: ParserProvenance {
                parser_name: "integration".into(),
                parser_revision: "fixture".into(),
                source_version: Some("1.40A".into()),
                compatibility_evidence: Some(ProjectCompatibilityEvidence::UpstreamLibrary),
            },
        }],
        slot_assignments: vec![RenameSlotAssignmentObservation {
            project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                .unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
            reference_status: SampleReferenceStatus::Resolved,
        }],
        usage_edges: vec![RenameUsageEdgeObservation {
            bank_document_relative_path: RootRelativePath::parse("SET/PROJECT/bank01.work")
                .unwrap(),
            project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
                .unwrap(),
            slot: SampleSlotId::new(SampleSlotKind::Static, 1).unwrap(),
            usage_kind: SampleUsageKind::Machine,
            referenced_file_relative_path: Some(RootRelativePath::parse(source_path).unwrap()),
            reference_status: SampleReferenceStatus::Resolved,
        }],
        sidecars: vec![RenameSidecarObservation {
            sidecar_relative_path: RootRelativePath::parse("SET/AUDIO/kick.ot").unwrap(),
            owning_audio_relative_path: RootRelativePath::parse(source_path).unwrap(),
            byte_size: 32,
            content_hash: hash(b's'),
            parse_status: SampleSettingsParseStatus::Parsed,
            parser_provenance: ParserProvenance {
                parser_name: "integration".into(),
                parser_revision: "fixture".into(),
                source_version: None,
                compatibility_evidence: None,
            },
            ownership_is_unique: true,
        }],
        usage_graph_complete: true,
        set_project_coverage_complete: true,
    }
}

#[test]
fn rename_planning_leaves_fixture_bytes_unchanged() {
    let temp = TempDir::new().expect("tempdir");
    let root = temp.path();
    let audio_dir = root.join("SET/AUDIO");
    let project_dir = root.join("SET/PROJECT");
    fs::create_dir_all(&audio_dir).expect("audio dir");
    fs::create_dir_all(&project_dir).expect("project dir");
    fs::write(audio_dir.join("kick.wav"), b"sample-bytes").expect("audio");
    fs::write(audio_dir.join("kick.ot"), b"sidecar-bytes").expect("sidecar");
    fs::write(project_dir.join("project.work"), b"project-bytes").expect("project");
    fs::write(project_dir.join("bank01.work"), b"bank-bytes").expect("bank");

    let before = snapshot_directory(root);
    let root_fingerprint = format!("rootfp:v1:{}", "f".repeat(64));
    let facts = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    let intent = RenameSampleIntent {
        root_id: RootId::new("integration-root").unwrap(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
    };

    let outcome = plan_rename_sample(&intent, &facts);
    let after = snapshot_directory(root);

    assert_eq!(before, after);
    assert!(matches!(outcome, RenamePlanningOutcome::Planned(_)));
}

#[test]
fn stale_observations_mark_planned_rename_unapplyable() {
    let root_fingerprint = format!("rootfp:v1:{}", "f".repeat(64));
    let facts = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    let intent = RenameSampleIntent {
        root_id: RootId::new("integration-root").unwrap(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
    };
    let RenamePlanningOutcome::Planned(plan) = plan_rename_sample(&intent, &facts) else {
        panic!("expected planned rename");
    };

    let stale_cases = vec![
        (
            "scan revision",
            {
                let mut stale = facts.clone();
                stale.root.live_observed_revision = 4;
                stale
            },
            RenameStaleReason::ObservedRevisionChanged,
        ),
        (
            "source bytes",
            {
                let mut stale = facts.clone();
                stale.source.live_byte_size = 13;
                stale
            },
            RenameStaleReason::SourceSizeChanged,
        ),
        (
            "project document",
            {
                let mut stale = facts.clone();
                stale.state_documents[0].content_hash = hash(b'q');
                stale
            },
            RenameStaleReason::StateDocumentChanged {
                relative_path: RootRelativePath::parse("SET/PROJECT/project.work").unwrap(),
            },
        ),
        (
            "sidecar",
            {
                let mut stale = facts.clone();
                stale.sidecars[0].content_hash = hash(b't');
                stale
            },
            RenameStaleReason::SidecarChanged {
                relative_path: RootRelativePath::parse("SET/AUDIO/kick.ot").unwrap(),
            },
        ),
        (
            "destination occupancy",
            {
                let mut stale = facts.clone();
                stale.destination.state = RenameDestinationState::Existing {
                    relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
                    byte_size: 1,
                    content_hash: hash(b'd'),
                };
                stale
            },
            RenameStaleReason::DestinationStateChanged,
        ),
        (
            "remount fingerprint",
            {
                let mut stale = facts.clone();
                stale.root.device_fingerprint = format!("rootfp:v1:{}", "e".repeat(64));
                stale
            },
            RenameStaleReason::RootIdentityChanged,
        ),
    ];

    for (label, stale_facts, expected_reason) in stale_cases {
        let stale = validate_rename_plan_freshness(plan.as_ref(), &stale_facts).expect_err(label);
        assert!(
            stale.iter().any(|reason| reason == &expected_reason),
            "{label}: expected {expected_reason}, got {stale:?}"
        );
    }
}

#[test]
fn blocked_rename_reports_fail_closed_without_media_mutation() {
    let temp = TempDir::new().expect("tempdir");
    let root = temp.path();
    fs::create_dir_all(root.join("SET/AUDIO")).expect("audio dir");
    fs::write(root.join("SET/AUDIO/kick.wav"), b"sample-bytes").expect("audio");

    let before = snapshot_directory(root);
    let root_fingerprint = format!("rootfp:v1:{}", "f".repeat(64));
    let mut facts = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    facts.source.hash_freshness = ContentHashFreshness::ReusedUnchangedMetadata;
    let intent = RenameSampleIntent {
        root_id: RootId::new("integration-root").unwrap(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
    };

    let outcome = plan_rename_sample(&intent, &facts);
    let after = snapshot_directory(root);

    assert_eq!(before, after);
    assert!(matches!(
        outcome,
        RenamePlanningOutcome::Blocked(BlockedRenameImpact { .. })
    ));
}

#[test]
fn incomplete_graph_and_coverage_fail_closed_without_media_mutation() {
    let temp = TempDir::new().expect("tempdir");
    let root = temp.path();
    fs::create_dir_all(root.join("SET/AUDIO")).expect("audio dir");
    fs::write(root.join("SET/AUDIO/kick.wav"), b"sample-bytes").expect("audio");

    let before = snapshot_directory(root);
    let root_fingerprint = format!("rootfp:v1:{}", "f".repeat(64));

    let mut incomplete_graph = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    incomplete_graph.usage_graph_complete = false;
    let intent = RenameSampleIntent {
        root_id: RootId::new("integration-root").unwrap(),
        source_file_instance_id: incomplete_graph.source.file_instance_id.clone(),
        destination_relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
    };
    let graph_outcome = plan_rename_sample(&intent, &incomplete_graph);

    let mut incomplete_coverage = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    incomplete_coverage.set_project_coverage_complete = false;
    let coverage_outcome = plan_rename_sample(&intent, &incomplete_coverage);

    let after = snapshot_directory(root);
    assert_eq!(before, after);
    assert!(matches!(
        graph_outcome,
        RenamePlanningOutcome::Blocked(BlockedRenameImpact { block_reasons, .. })
            if block_reasons.iter().any(|reason| {
                matches!(reason, ot_plan::RenameBlockReason::IncompleteUsageGraph)
            })
    ));
    assert!(matches!(
        coverage_outcome,
        RenamePlanningOutcome::Blocked(BlockedRenameImpact { block_reasons, .. })
            if block_reasons.iter().any(|reason| {
                matches!(reason, ot_plan::RenameBlockReason::IncompleteSetProjectCoverage)
            })
    ));
}

#[test]
fn unparseable_project_blocks_without_media_mutation() {
    let temp = TempDir::new().expect("tempdir");
    let root = temp.path();
    fs::create_dir_all(root.join("SET/AUDIO")).expect("audio dir");
    fs::write(root.join("SET/AUDIO/kick.wav"), b"sample-bytes").expect("audio");

    let before = snapshot_directory(root);
    let root_fingerprint = format!("rootfp:v1:{}", "f".repeat(64));
    let mut facts = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    facts.slot_assignments.clear();
    facts.state_documents[0].parse_status = StateDocumentParseStatus::UnsupportedVersion;
    let intent = RenameSampleIntent {
        root_id: RootId::new("integration-root").unwrap(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
    };

    let outcome = plan_rename_sample(&intent, &facts);
    let after = snapshot_directory(root);
    assert_eq!(before, after);
    assert!(matches!(
        outcome,
        RenamePlanningOutcome::Blocked(BlockedRenameImpact { block_reasons, .. })
            if block_reasons.contains(&RenameBlockReason::UnsupportedStateDocument)
    ));
}

#[test]
fn destination_missing_slot_blocks_without_media_mutation() {
    let temp = TempDir::new().expect("tempdir");
    let root = temp.path();
    fs::create_dir_all(root.join("SET/AUDIO")).expect("audio dir");
    fs::write(root.join("SET/AUDIO/kick.wav"), b"sample-bytes").expect("audio");

    let before = snapshot_directory(root);
    let root_fingerprint = format!("rootfp:v1:{}", "f".repeat(64));
    let mut facts = build_fixture_facts(
        &root_fingerprint,
        "SET/AUDIO/kick.wav",
        "SET/AUDIO/new-kick.wav",
        12,
    );
    facts.slot_assignments = vec![RenameSlotAssignmentObservation {
        project_document_relative_path: RootRelativePath::parse("SET/PROJECT/project.work")
            .unwrap(),
        slot: SampleSlotId::new(SampleSlotKind::Static, 3).unwrap(),
        referenced_file_relative_path: Some(
            RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
        ),
        reference_status: SampleReferenceStatus::Missing,
    }];
    let intent = RenameSampleIntent {
        root_id: RootId::new("integration-root").unwrap(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: RootRelativePath::parse("SET/AUDIO/new-kick.wav").unwrap(),
    };

    let outcome = plan_rename_sample(&intent, &facts);
    let after = snapshot_directory(root);
    assert_eq!(before, after);
    match outcome {
        RenamePlanningOutcome::Blocked(blocked) => {
            assert!(blocked
                .block_reasons
                .contains(&RenameBlockReason::DestinationReferencedByUnresolvedSlot));
            assert_eq!(blocked.reference_update_count, 0);
        }
        RenamePlanningOutcome::Planned(_) => panic!("must not mint a plan"),
    }
}
