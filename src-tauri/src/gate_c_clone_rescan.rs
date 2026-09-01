#![forbid(unsafe_code)]

use crate::catalog_runtime::{open_shared_catalog, SharedCatalog};
use crate::root_registry::{
    DeviceIdentityProvider, DeviceObservation, RootRegistry, RootRegistryError, RootSession,
};
use crate::test_fixtures;
use crate::v2_api::{
    gate_c_latest_completed_scan_revision, gate_c_register_and_index_root, gate_c_rescan_and_store,
};
use ot_backup::BackupStore;
use ot_codec::MemoryProjectReferenceCodec;
use ot_domain::{
    ContentHash, ContentHashFreshness, LibrarySnapshot, ParserProvenance, RenameSampleIntent,
    RootId, RootRelativePath, SampleReferenceStatus, SampleSettingsOwner,
    SampleSettingsParseStatus, StateDocument,
};
use ot_executor::{
    ApprovedExecutionRoot, ApprovedRecoveryRoot, AuthorityError, CloneWriteAuthority,
    ExecutorError, ExecutorLocalPaths, RecoveryAuthority, RenameApplyFault, RenameJournalStatus,
    RenameSampleExecutor, WriteAuthority,
};
use ot_plan::{
    derive_file_instance_id, plan_rename_sample, sidecar_destination_for_audio_destination,
    RenameDestinationObservation, RenameDestinationState, RenameImpactPlan, RenamePlanningOutcome,
    RenameRootObservation, RenameSamplePlanningFacts, RenameSidecarObservation,
    RenameSlotAssignmentObservation, RenameSourceObservation, RenameStateDocumentObservation,
    RenameUsageEdgeObservation,
};
use ot_tools_io::{types::SlotMarkers, OctatrackFileIO, SampleSettingsFile};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

const SOURCE_PATH: &str = "SET/AUDIO/pad.wav";
const DESTINATION_PATH: &str = "SET/AUDIO/new-pad.wav";
const SIDECAR_PATH: &str = "SET/AUDIO/pad.ot";
const DEST_SIDECAR_PATH: &str = "SET/AUDIO/new-pad.ot";
const SENTINEL_PATH: &str = "SET/UNRELATED/keep.txt";
const SENTINEL_BYTES: &[u8] = b"gate-c sentinel\n";

struct StableGateCIdentity;

impl DeviceIdentityProvider for StableGateCIdentity {
    fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
        Ok(DeviceObservation {
            stable_key: "gate-c-fixture-volume".into(),
            filesystem_type: Some("fixturefs".into()),
            total_capacity: Some(4096),
            mount_token: "gate-c-mount".into(),
            stable: true,
        })
    }
}

struct FixtureAuthority {
    root: Mutex<ApprovedExecutionRoot>,
}

impl WriteAuthority for FixtureAuthority {
    fn resolve_for_write(&self, root_id: &RootId) -> Result<ApprovedExecutionRoot, AuthorityError> {
        let root = self.root.lock().unwrap().clone();
        if &root.root_id != root_id {
            return Err(AuthorityError::NotApproved);
        }
        Ok(root)
    }
}

impl CloneWriteAuthority for FixtureAuthority {
    fn resolve_clone_for_write(
        &self,
        root_id: &RootId,
    ) -> Result<ot_executor::VerifiedCloneRoot, AuthorityError> {
        Ok(ot_executor::VerifiedCloneRoot::attest_temporary_copy(
            self.resolve_for_write(root_id)?,
        ))
    }
}

impl RecoveryAuthority for FixtureAuthority {
    fn resolve_for_recovery(
        &self,
        root_id: &RootId,
    ) -> Result<ApprovedRecoveryRoot, AuthorityError> {
        let root = self.root.lock().unwrap().clone();
        if &root.root_id != root_id {
            return Err(AuthorityError::NotApproved);
        }
        Ok(ApprovedRecoveryRoot {
            root_id: root.root_id,
            device_fingerprint: root.device_fingerprint,
            canonical_path: root.canonical_path,
            stable_device_identity: root.stable_device_identity,
        })
    }
}

struct PreparedClone {
    _temp: TempDir,
    original: PathBuf,
    clone: PathBuf,
    local: PathBuf,
    _catalog_dir: TempDir,
    catalog: SharedCatalog,
    registry: RootRegistry,
    session: RootSession,
    baseline_revision: u64,
    baseline_manifest: Vec<(PathBuf, u64, String)>,
    original_manifest: Vec<(PathBuf, u64, String)>,
    source_hash: String,
    plan: RenameImpactPlan,
    prepared: ot_executor::RenamePrepareResult,
    authority: FixtureAuthority,
    executor: RenameSampleExecutor,
}

fn sha256_file(path: &Path) -> String {
    format!(
        "{:x}",
        Sha256::digest(fs::read(path).expect("read fixture"))
    )
}

fn snapshot_manifest(root: &Path) -> Vec<(PathBuf, u64, String)> {
    let mut entries = Vec::new();
    collect_manifest(root, root, &mut entries);
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries
}

fn collect_manifest(root: &Path, path: &Path, entries: &mut Vec<(PathBuf, u64, String)>) {
    let metadata = fs::symlink_metadata(path).expect("metadata");
    if metadata.is_dir() {
        for entry in fs::read_dir(path).expect("read_dir") {
            collect_manifest(root, &entry.expect("entry").path(), entries);
        }
        return;
    }
    assert!(
        !metadata.file_type().is_symlink(),
        "symlinks are forbidden in gate-c fixtures"
    );
    let relative = path.strip_prefix(root).expect("relative").to_path_buf();
    entries.push((relative, metadata.len(), sha256_file(path)));
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create clone root");
    for entry in fs::read_dir(from).expect("read original") {
        let entry = entry.expect("entry");
        let metadata = fs::symlink_metadata(entry.path()).expect("metadata");
        assert!(!metadata.file_type().is_symlink());
        let dest = to.join(entry.file_name());
        if metadata.is_dir() {
            copy_tree(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), dest).expect("copy fixture file");
        }
    }
}

fn write_gate_c_wav(path: &Path, label: &str) {
    let payload = format!("MasterOCTa Gate C synthetic WAV: {label}\n").into_bytes();
    let sample_rate = 8_000_u32;
    let channels = 1_u16;
    let data_size = payload.len() as u32;
    let byte_rate = sample_rate * u32::from(channels) * 2;
    let block_align = channels * 2;
    let mut wav = Vec::with_capacity(44 + payload.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(&payload);
    fs::write(path, wav).expect("write wav");
}

fn write_pad_sidecar(audio_path: &Path) {
    let markers = SlotMarkers {
        trim_end: 1000,
        ..Default::default()
    };
    SampleSettingsFile::new(markers, None, None, None, None, None, None, None)
        .expect("sample settings")
        .to_data_file(&audio_path.with_extension("ot"))
        .expect("write sidecar");
}

fn build_original_tree(root: &Path) {
    let project_dir = root.join("SET/PROJECT");
    let audio_dir = root.join("SET/AUDIO");
    let unrelated_dir = root.join("SET/UNRELATED");
    fs::create_dir_all(&project_dir).expect("project dir");
    fs::create_dir_all(&audio_dir).expect("audio dir");
    fs::create_dir_all(&unrelated_dir).expect("sentinel dir");

    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/source_project/project.work");
    fs::copy(&fixture, project_dir.join("project.work")).expect("copy project.work");
    fs::copy(&fixture, project_dir.join("project.strd")).expect("copy project.strd");
    fs::write(
        project_dir.join("bank01.work"),
        test_fixtures::default_bank_bytes(),
    )
    .expect("bank work");
    fs::write(
        project_dir.join("bank01.strd"),
        test_fixtures::default_bank_bytes(),
    )
    .expect("bank strd");

    write_gate_c_wav(&project_dir.join("bass_loop.wav"), "bass_loop");
    write_gate_c_wav(&project_dir.join("drum_hit.wav"), "drum_hit");
    write_gate_c_wav(&audio_dir.join("pad.wav"), "pad");
    write_pad_sidecar(&audio_dir.join("pad.wav"));
    fs::write(root.join(SENTINEL_PATH), SENTINEL_BYTES).expect("sentinel");
}

fn local_paths(local: &Path) -> ExecutorLocalPaths {
    ExecutorLocalPaths {
        staging_directory: local.join("staging"),
        backup_directory: local.join("backups"),
        journal_directory: local.join("journals"),
    }
}

fn authority_for(root: &Path, session: &RootSession) -> FixtureAuthority {
    FixtureAuthority {
        root: Mutex::new(ApprovedExecutionRoot {
            root_id: session.root_id.clone(),
            device_fingerprint: session.device_fingerprint.clone(),
            observed_revision: session.observed_revision,
            canonical_path: root.canonicalize().expect("canonical clone"),
            write_enabled: true,
            stable_device_identity: true,
        }),
    }
}

fn sidecar_observations(root: &Path, snapshot: &LibrarySnapshot) -> Vec<RenameSidecarObservation> {
    let sidecar_path = root.join(SIDECAR_PATH);
    if !sidecar_path.exists() {
        return Vec::new();
    }
    let bytes = fs::read(&sidecar_path).expect("read sidecar");
    let parse_status = snapshot
        .sample_settings
        .iter()
        .find(|settings| {
            settings.owner == SampleSettingsOwner::FileInstanceSidecar
                && settings.source_relative_path.as_str() == SIDECAR_PATH
        })
        .map(|settings| settings.parse_status)
        .unwrap_or(SampleSettingsParseStatus::Parsed);
    let parser_provenance = snapshot
        .sample_settings
        .iter()
        .find(|settings| settings.source_relative_path.as_str() == SIDECAR_PATH)
        .map(|settings| settings.parser_provenance.clone())
        .unwrap_or(ParserProvenance {
            parser_name: "gate-c-fixture".into(),
            parser_revision: "test".into(),
            source_version: Some("sample-settings:1".into()),
            compatibility_evidence: None,
        });
    vec![RenameSidecarObservation {
        sidecar_relative_path: RootRelativePath::parse(SIDECAR_PATH).expect("sidecar path"),
        owning_audio_relative_path: RootRelativePath::parse(SOURCE_PATH).expect("source path"),
        byte_size: bytes.len() as u64,
        content_hash: ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&bytes)))
            .expect("sidecar hash"),
        parse_status,
        parser_provenance,
        ownership_is_unique: true,
    }]
}

fn map_state_document(root: &Path, document: &StateDocument) -> RenameStateDocumentObservation {
    let path = root.join(document.source_relative_path.as_str());
    let bytes = fs::read(&path).expect("read state document");
    RenameStateDocumentObservation {
        relative_path: document.source_relative_path.clone(),
        kind: document.kind,
        role: document.role,
        byte_size: bytes.len() as u64,
        content_hash: ContentHash::parse(format!("sha256:{:x}", Sha256::digest(&bytes)))
            .expect("state document hash"),
        parse_status: document.parse_status,
        parser_provenance: document.parser_provenance.clone(),
    }
}

fn planning_facts_from_snapshot(
    root: &Path,
    session: &RootSession,
    scan_revision: u64,
    snapshot: &LibrarySnapshot,
    source_path: &str,
    destination_path: &str,
) -> RenameSamplePlanningFacts {
    let source = RootRelativePath::parse(source_path).expect("source path");
    let source_instance = snapshot
        .file_instances
        .iter()
        .find(|file| file.relative_path.as_str() == source_path)
        .expect("source file instance");

    RenameSamplePlanningFacts {
        root: RenameRootObservation {
            root_id: session.root_id.clone(),
            device_fingerprint: session.device_fingerprint.clone(),
            live_observed_revision: session.observed_revision,
            base_catalog_scan_revision: scan_revision,
            scan_completed: true,
            identity_is_stable: session.capabilities.stable_device_identity,
        },
        source: RenameSourceObservation {
            file_instance_id: derive_file_instance_id(&session.device_fingerprint, &source),
            catalog_relative_path: source.clone(),
            catalog_byte_size: source_instance.byte_size,
            catalog_content_hash: source_instance.content_hash.clone(),
            live_relative_path: source.clone(),
            live_byte_size: source_instance.byte_size,
            live_content_hash: source_instance.content_hash.clone(),
            hash_freshness: ContentHashFreshness::ComputedThisScan,
        },
        destination: RenameDestinationObservation {
            intended_relative_path: RootRelativePath::parse(destination_path).expect("dest"),
            state: RenameDestinationState::Absent,
        },
        sidecar_destination: sidecar_destination_for_audio_destination(destination_path),
        state_documents: snapshot
            .state_documents
            .iter()
            .map(|document| map_state_document(root, document))
            .collect(),
        slot_assignments: snapshot
            .slot_assignments
            .iter()
            .map(|assignment| RenameSlotAssignmentObservation {
                project_document_relative_path: assignment.project_document_relative_path.clone(),
                slot: assignment.slot,
                referenced_file_relative_path: assignment.referenced_file_relative_path.clone(),
                reference_status: assignment.reference_status,
            })
            .collect(),
        usage_edges: snapshot
            .usage_edges
            .iter()
            .map(|edge| RenameUsageEdgeObservation {
                bank_document_relative_path: edge.bank_document_relative_path.clone(),
                project_document_relative_path: edge.project_document_relative_path.clone(),
                slot: edge.slot,
                usage_kind: edge.usage_kind,
                referenced_file_relative_path: edge.referenced_file_relative_path.clone(),
                reference_status: edge.reference_status,
            })
            .collect(),
        sidecars: sidecar_observations(root, snapshot),
        usage_graph_complete: true,
        set_project_coverage_complete: true,
    }
}

fn plan_from_facts(facts: RenameSamplePlanningFacts) -> RenameImpactPlan {
    let intent = RenameSampleIntent {
        root_id: facts.root.root_id.clone(),
        source_file_instance_id: facts.source.file_instance_id.clone(),
        destination_relative_path: facts.destination.intended_relative_path.clone(),
    };
    match plan_rename_sample(&intent, &facts) {
        RenamePlanningOutcome::Planned(plan) => *plan,
        RenamePlanningOutcome::Blocked(blocked) => {
            panic!(
                "expected planned rename, blocked by {:?}",
                blocked.block_reasons
            );
        }
    }
}

fn assert_no_absolute_paths_in_json(value: &str, clone_prefix: &str) {
    assert!(
        !value.contains(clone_prefix),
        "journal or authorization must not store absolute paths"
    );
}

struct ReferenceCounts {
    missing: usize,
    invalid_path: usize,
    blocking: usize,
    source_resolved: usize,
    destination_resolved: usize,
}

fn reference_counts(
    snapshot: &LibrarySnapshot,
    source: &str,
    destination: &str,
) -> ReferenceCounts {
    let source_path = RootRelativePath::parse(source).expect("source");
    let destination_path = RootRelativePath::parse(destination).expect("destination");
    let mut counts = ReferenceCounts {
        missing: 0,
        invalid_path: 0,
        blocking: 0,
        source_resolved: 0,
        destination_resolved: 0,
    };

    for assignment in &snapshot.slot_assignments {
        match assignment.reference_status {
            SampleReferenceStatus::Missing => counts.missing += 1,
            SampleReferenceStatus::InvalidPath => counts.invalid_path += 1,
            SampleReferenceStatus::UnassignedSlot => {}
            SampleReferenceStatus::Resolved => {
                if assignment.referenced_file_relative_path.as_ref() == Some(&source_path) {
                    counts.source_resolved += 1;
                }
                if assignment.referenced_file_relative_path.as_ref() == Some(&destination_path) {
                    counts.destination_resolved += 1;
                }
            }
        }
        if assignment.reference_status != SampleReferenceStatus::Resolved
            && assignment.reference_status != SampleReferenceStatus::UnassignedSlot
        {
            counts.blocking += 1;
        }
    }

    for edge in &snapshot.usage_edges {
        match edge.reference_status {
            SampleReferenceStatus::Missing => counts.missing += 1,
            SampleReferenceStatus::InvalidPath => counts.invalid_path += 1,
            SampleReferenceStatus::UnassignedSlot => {}
            SampleReferenceStatus::Resolved => {
                if edge.referenced_file_relative_path.as_ref() == Some(&source_path) {
                    counts.source_resolved += 1;
                }
                if edge.referenced_file_relative_path.as_ref() == Some(&destination_path) {
                    counts.destination_resolved += 1;
                }
            }
        }
        if edge.reference_status != SampleReferenceStatus::Resolved
            && edge.reference_status != SampleReferenceStatus::UnassignedSlot
        {
            counts.blocking += 1;
        }
    }

    counts
}

fn operation_journal_path(local: &Path, operation_id: &ot_executor::OperationId) -> PathBuf {
    let stem = operation_id
        .as_str()
        .strip_prefix("operation:v1:")
        .expect("operation id prefix");
    local.join("journals/rename").join(format!("{stem}.json"))
}

fn assert_post_apply_snapshot(snapshot: &LibrarySnapshot, source_hash: &str) {
    let destination = RootRelativePath::parse(DESTINATION_PATH).expect("destination");
    let dest = snapshot
        .file_instances
        .iter()
        .find(|file| file.relative_path == destination)
        .expect("destination instance");
    assert!(
        dest.content_hash.as_str() == format!("sha256:{source_hash}"),
        "destination hash must match renamed source bytes"
    );

    let counts = reference_counts(snapshot, SOURCE_PATH, DESTINATION_PATH);
    assert_eq!(counts.missing, 0, "missing references after rescan");
    assert_eq!(counts.invalid_path, 0, "invalid references after rescan");
    assert_eq!(counts.blocking, 0, "blocking references after rescan");
    assert_eq!(counts.source_resolved, 0, "source must not remain resolved");
    assert!(
        counts.destination_resolved > 0,
        "working/saved checkpoint must resolve destination"
    );

    assert!(
        snapshot.slot_assignments.iter().any(|assignment| {
            assignment.referenced_file_relative_path.as_ref() == Some(&destination)
                && (assignment.project_document_relative_path.as_str()
                    == "SET/PROJECT/project.work"
                    || assignment.project_document_relative_path.as_str()
                        == "SET/PROJECT/project.strd")
        }),
        "both working and saved checkpoint must reference destination"
    );

    assert!(
        snapshot
            .sample_settings
            .iter()
            .any(|settings| settings.source_relative_path.as_str() == DEST_SIDECAR_PATH),
        "sidecar must move with destination stem when co-renamed"
    );
}

fn assert_post_apply_clone(plan: &RenameImpactPlan, clone: &Path, source_hash: &str) {
    assert!(!clone.join(SOURCE_PATH).exists());
    assert!(clone.join(DESTINATION_PATH).exists());
    assert_eq!(sha256_file(&clone.join(DESTINATION_PATH)), source_hash);
    if !plan.sidecar_impacts.is_empty() {
        assert!(!clone.join(SIDECAR_PATH).exists());
        assert!(clone.join(DEST_SIDECAR_PATH).exists());
    }
}

fn sentinel_unchanged(
    post_manifest: &[(PathBuf, u64, String)],
    baseline_manifest: &[(PathBuf, u64, String)],
) {
    let sentinel = RootRelativePath::parse(SENTINEL_PATH).expect("sentinel");
    let sentinel_path = Path::new(sentinel.as_str());
    let baseline = baseline_manifest
        .iter()
        .find(|(path, _, _)| path.as_path() == sentinel_path)
        .expect("baseline sentinel");
    let post = post_manifest
        .iter()
        .find(|(path, _, _)| path.as_path() == sentinel_path)
        .expect("post sentinel");
    assert_eq!(baseline, post);
}

fn prepare_clone_fixture() -> PreparedClone {
    let temp = TempDir::new().expect("tempdir");
    let original = temp.path().join("original");
    let clone = temp.path().join("clone");
    let local = temp.path().join("local");
    build_original_tree(&original);
    let original_manifest = snapshot_manifest(&original);
    copy_tree(&original, &clone);

    let registry = RootRegistry::new(Arc::new(StableGateCIdentity), Duration::from_secs(60));
    let catalog_dir = TempDir::new().expect("catalog tempdir");
    let catalog = open_shared_catalog(catalog_dir.path()).expect("open catalog");
    let (session, baseline_snapshot) = gate_c_register_and_index_root(
        &registry,
        &catalog,
        clone.to_str().expect("utf8 clone path"),
    )
    .expect("register and baseline scan");
    let baseline_revision =
        gate_c_latest_completed_scan_revision(&catalog, &session.device_fingerprint)
            .expect("baseline revision");

    let facts = planning_facts_from_snapshot(
        &clone,
        &session,
        baseline_revision,
        &baseline_snapshot,
        SOURCE_PATH,
        DESTINATION_PATH,
    );
    let baseline_counts = reference_counts(&baseline_snapshot, SOURCE_PATH, DESTINATION_PATH);
    assert_eq!(baseline_counts.missing, 0, "baseline missing references");
    assert_eq!(baseline_counts.blocking, 0, "baseline blocking references");
    assert!(
        baseline_counts.source_resolved > 0,
        "baseline source must resolve"
    );

    let plan = plan_from_facts(facts);
    BackupStore::new(local.join("backups"))
        .create_verified_for_rename(&clone, &plan)
        .expect("rename backup");
    let authority = authority_for(&clone, &session);
    let executor = RenameSampleExecutor::new(local_paths(&local));
    let prepared = executor
        .prepare(&plan, &MemoryProjectReferenceCodec, &authority)
        .expect("prepare rename");

    let clone_prefix = clone
        .canonicalize()
        .expect("clone canonical")
        .to_string_lossy()
        .to_string();
    let journal_json = serde_json::to_string(&prepared.journal).expect("journal json");
    let authorization_json =
        serde_json::to_string(&prepared.authorization).expect("authorization json");
    assert_no_absolute_paths_in_json(&journal_json, &clone_prefix);
    assert_no_absolute_paths_in_json(&authorization_json, &clone_prefix);

    let source_hash = sha256_file(&clone.join(SOURCE_PATH));
    let baseline_manifest = snapshot_manifest(&clone);
    PreparedClone {
        _temp: temp,
        original,
        clone,
        local,
        _catalog_dir: catalog_dir,
        catalog,
        registry,
        session,
        baseline_revision,
        baseline_manifest,
        original_manifest,
        source_hash,
        plan,
        prepared,
        authority,
        executor,
    }
}

#[test]
fn gate_c_rename_apply_then_fresh_rescan_has_zero_missing_references() {
    let fixture = prepare_clone_fixture();
    fixture
        .executor
        .apply(
            &fixture.plan,
            &MemoryProjectReferenceCodec,
            &fixture.authority,
        )
        .expect("apply rename on clone");

    assert_post_apply_clone(&fixture.plan, &fixture.clone, &fixture.source_hash);
    assert_eq!(
        snapshot_manifest(&fixture.original),
        fixture.original_manifest
    );

    let post_manifest = snapshot_manifest(&fixture.clone);
    sentinel_unchanged(&post_manifest, &fixture.baseline_manifest);

    let (_, post_snapshot) = gate_c_rescan_and_store(
        &fixture.registry,
        &fixture.catalog,
        &fixture.session.root_id,
    )
    .expect("fresh rescan");
    let post_revision = gate_c_latest_completed_scan_revision(
        &fixture.catalog,
        &fixture.session.device_fingerprint,
    )
    .expect("post revision");
    assert!(post_revision > fixture.baseline_revision);
    assert_post_apply_snapshot(&post_snapshot, &fixture.source_hash);
}

#[test]
fn gate_c_apply_fault_rolls_back_clone_and_rescan_restores_source() {
    let fixture = prepare_clone_fixture();
    let error = fixture
        .executor
        .apply_with_fault(
            &fixture.plan,
            &MemoryProjectReferenceCodec,
            &fixture.authority,
            RenameApplyFault::DestinationPublished,
        )
        .expect_err("fault after Applying must fail");
    assert!(matches!(error, ExecutorError::InjectedFault(_)));
    assert_eq!(snapshot_manifest(&fixture.clone), fixture.baseline_manifest);
    assert_eq!(
        snapshot_manifest(&fixture.original),
        fixture.original_manifest
    );

    let journal = fixture
        .executor
        .rename_journal(&fixture.prepared.operation_id)
        .expect("journal lookup")
        .expect("journal exists");
    assert_eq!(journal.status, RenameJournalStatus::RolledBack);

    let (_, restored_snapshot) = gate_c_rescan_and_store(
        &fixture.registry,
        &fixture.catalog,
        &fixture.session.root_id,
    )
    .expect("rollback rescan");
    let counts = reference_counts(&restored_snapshot, SOURCE_PATH, DESTINATION_PATH);
    assert_eq!(counts.missing, 0);
    assert_eq!(counts.blocking, 0);
    assert!(counts.source_resolved > 0);
    assert_eq!(counts.destination_resolved, 0);
    assert!(fixture.clone.join(SOURCE_PATH).exists());
    assert!(!fixture.clone.join(DESTINATION_PATH).exists());
}

#[test]
fn gate_c_unknown_live_bytes_leave_recovery_required_without_overwrite() {
    let fixture = prepare_clone_fixture();
    fs::write(
        fixture.clone.join(DESTINATION_PATH),
        fixture.source_hash.as_bytes(),
    )
    .expect("dest");
    fs::write(fixture.clone.join(SOURCE_PATH), b"tampered-source").expect("tamper source");

    let journal_path = operation_journal_path(&fixture.local, &fixture.prepared.operation_id);
    let mut journal: ot_executor::RenameOperationJournal =
        serde_json::from_slice(&fs::read(&journal_path).expect("read journal"))
            .expect("decode journal");
    journal.status = RenameJournalStatus::Applying;
    fs::write(
        &journal_path,
        serde_json::to_string_pretty(&journal).expect("encode journal"),
    )
    .expect("persist applying");

    let before = snapshot_manifest(&fixture.clone);
    let error = fixture
        .executor
        .rollback(
            &fixture.session.root_id,
            &fixture.prepared.operation_id,
            &fixture.authority,
        )
        .expect_err("tampered source must fail closed");
    assert!(matches!(error, ExecutorError::RecoveryRequired));
    assert_eq!(snapshot_manifest(&fixture.clone), before);
    assert_eq!(
        fs::read(fixture.clone.join(SOURCE_PATH)).expect("source"),
        b"tampered-source"
    );
    assert_eq!(
        snapshot_manifest(&fixture.original),
        fixture.original_manifest
    );
}
