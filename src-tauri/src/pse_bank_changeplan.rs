//! Read-only Bank ChangePlan integration tests on committed PSE fixtures (#181).

#[cfg(test)]
mod tests {
    use crate::project_structure_command::PROJECT_STRUCTURE_SCHEMA;
    use crate::project_structure_reader::read_project_structure;
    use ot_domain::bank_state_documents::BankStateDocumentSet;
    use ot_domain::project_structure::BankIndex;
    use ot_domain::{RootId, RootRelativePath};
    use ot_plan::bank_changeplan::{plan_bank_change, BankChangeIntent, BankChangePlanningFacts};
    use ot_plan::bank_mutation::{ManifestEntry, ReadinessEvidence, TreeManifest};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    fn project_relative_path(name: &str) -> RootRelativePath {
        RootRelativePath::parse(format!("pse_bank_copy_persistence/{name}")).unwrap()
    }

    fn tree_digest(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
        let mut digest = BTreeMap::new();
        for entry in walkdir::WalkDir::new(root)
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
        {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|ext| ext == "work" || ext == "strd")
                || path
                    .file_name()
                    .is_some_and(|name| name == "SHA256SUMS.json" || name == "capture.meta.json")
            {
                let bytes = fs::read(path).unwrap();
                let hash = format!("{:x}", Sha256::digest(&bytes));
                digest.insert(
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    (bytes.len() as u64, hash),
                );
            }
        }
        digest
    }

    fn manifest_for_project(root: &Path, project: &RootRelativePath) -> TreeManifest {
        let project_dir = root.join(project.as_str());
        let mut manifest = TreeManifest::new();
        manifest.insert(project.clone(), ManifestEntry::Directory);
        let mut pending = vec![project_dir.clone()];
        while let Some(directory) = pending.pop() {
            let mut children: Vec<_> = fs::read_dir(&directory)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            children.sort();
            for child in children {
                let metadata = fs::symlink_metadata(&child).unwrap();
                let relative = RootRelativePath::parse(
                    child
                        .strip_prefix(root)
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .replace('\\', "/")
                        .as_str(),
                )
                .unwrap();
                let entry = if metadata.file_type().is_symlink() {
                    let target = fs::read_link(&child).unwrap();
                    ManifestEntry::Symlink {
                        target_digest: ot_domain::ContentHash::parse(format!(
                            "sha256:{:x}",
                            Sha256::digest(target.as_os_str().as_encoded_bytes())
                        ))
                        .unwrap(),
                    }
                } else if metadata.is_dir() {
                    pending.push(child);
                    ManifestEntry::Directory
                } else if metadata.is_file() {
                    let bytes = fs::read(&child).unwrap();
                    ManifestEntry::File {
                        byte_size: bytes.len() as u64,
                        content_hash: ot_domain::ContentHash::parse(format!(
                            "sha256:{:x}",
                            Sha256::digest(&bytes)
                        ))
                        .unwrap(),
                    }
                } else {
                    ManifestEntry::Other
                };
                manifest.insert(relative, entry);
            }
        }
        manifest
    }

    fn presence_from_structure(
        structure: &ot_domain::project_structure::ProjectStructure,
        bank: BankIndex,
    ) -> BankStateDocumentSet {
        let working = structure
            .bank(bank, ot_domain::StateDocumentRole::Working)
            .is_some();
        let saved = structure
            .bank(bank, ot_domain::StateDocumentRole::SavedCheckpoint)
            .is_some();
        BankStateDocumentSet::new(bank, working, saved)
    }

    fn manifest_without_path(manifest: &TreeManifest, omit: &RootRelativePath) -> TreeManifest {
        let mut out = TreeManifest::new();
        for (path, entry) in manifest.iter() {
            if path != omit {
                out.insert(path.clone(), entry.clone());
            }
        }
        out
    }

    fn planning_facts(
        root: &Path,
        capture: &str,
        source: BankIndex,
        destination: BankIndex,
    ) -> BankChangePlanningFacts {
        let project = project_relative_path(capture);
        let structure = read_project_structure(root, &project).unwrap();
        let observed_revision = 1;
        let reference_inventory = crate::bank_reference_inventory::build_bank_reference_inventory(
            root,
            &project,
            &structure,
            observed_revision,
        )
        .expect("reference inventory");
        BankChangePlanningFacts {
            root_id: RootId::new("root-session-fixture").unwrap(),
            device_fingerprint: format!("rootfp:v1:{}", "c".repeat(64)),
            observed_revision,
            identity_is_stable: true,
            read_model_schema: PROJECT_STRUCTURE_SCHEMA.to_owned(),
            project_relative_path: project.clone(),
            scope_manifest: manifest_for_project(root, &project),
            source_presence: presence_from_structure(&structure, source),
            destination_presence: presence_from_structure(&structure, destination),
            project_structure: structure,
            reference_inventory,
        }
    }

    #[test]
    fn observed_source_work_missing_from_manifest_rejects_plan_on_fixture() {
        use ot_plan::bank_changeplan::BankChangePlanError;

        let root = fixture_root();
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let mut facts = planning_facts(&root, "s0_baseline_saved", source, destination);
        let bank01_work =
            RootRelativePath::parse("pse_bank_copy_persistence/s0_baseline_saved/bank01.work")
                .unwrap();
        facts.scope_manifest = manifest_without_path(&facts.scope_manifest, &bank01_work);
        assert_eq!(
            plan_bank_change(
                BankChangeIntent::Copy {
                    source,
                    destination,
                },
                &facts,
                &ReadinessEvidence::current_main(),
            )
            .unwrap_err(),
            BankChangePlanError::ManifestEntryMissingForObservedDocument
        );
    }

    #[test]
    fn bank_changeplan_generation_leaves_committed_fixture_bytes_identical() {
        let root = fixture_root();
        let before = tree_digest(&root);
        let source = BankIndex::new(0).unwrap();
        let destination = BankIndex::new(1).unwrap();
        let facts = planning_facts(&root, "s0_baseline_saved", source, destination);
        let _plan = plan_bank_change(
            BankChangeIntent::Copy {
                source,
                destination,
            },
            &facts,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        let _plan = plan_bank_change(
            BankChangeIntent::Move {
                source,
                destination,
            },
            &facts,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        let _plan = plan_bank_change(
            BankChangeIntent::Swap {
                source,
                destination,
            },
            &facts,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert_eq!(tree_digest(&root), before);
    }

    #[test]
    fn bank_changeplan_generation_on_multi_device_fixture_is_read_only() {
        let root = fixture_root();
        let capture = "pse_bank_multi_device/bank_b_active";
        let project = RootRelativePath::parse(capture).unwrap();
        let before = tree_digest(&root);
        let source = BankIndex::new(1).unwrap();
        let destination = BankIndex::new(0).unwrap();
        let structure = read_project_structure(&root, &project).unwrap();
        let observed_revision = 1;
        let reference_inventory = crate::bank_reference_inventory::build_bank_reference_inventory(
            &root,
            &project,
            &structure,
            observed_revision,
        )
        .expect("reference inventory");
        let facts = BankChangePlanningFacts {
            root_id: RootId::new("root-session-fixture").unwrap(),
            device_fingerprint: format!("rootfp:v1:{}", "d".repeat(64)),
            observed_revision,
            identity_is_stable: true,
            read_model_schema: PROJECT_STRUCTURE_SCHEMA.to_owned(),
            project_relative_path: project.clone(),
            scope_manifest: manifest_for_project(&root, &project),
            source_presence: presence_from_structure(&structure, source),
            destination_presence: presence_from_structure(&structure, destination),
            project_structure: structure,
            reference_inventory,
        };
        plan_bank_change(
            BankChangeIntent::Move {
                source,
                destination,
            },
            &facts,
            &ReadinessEvidence::current_main(),
        )
        .unwrap();
        assert_eq!(tree_digest(&root), before);
    }
}
