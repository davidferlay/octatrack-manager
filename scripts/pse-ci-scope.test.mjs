import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideScope,
  gitChangedFiles,
  isInScopePath,
} from "./pse-ci-scope.mjs";

describe("pse ci scope", () => {
  it("treats reader, fixture, script, lockfile, and workflow paths as in-scope", () => {
    for (const file of ["src/api/projectStructure.ts", "src/features/project-structure/ProjectStructureViewer.tsx", "src/features/library/CatalogWorkspaceViews.tsx", "src-tauri/src/project_structure_command.rs"]) assert.equal(isInScopePath(file), true);
    assert.equal(isInScopePath("src-tauri/src/project_structure_reader.rs"), true);
    assert.equal(isInScopePath("src-tauri/src/sample_slot_boundary.rs"), true);
    assert.equal(isInScopePath("src-tauri/tests/fixtures/real_device/bank01.work"), true);
    assert.equal(isInScopePath("src-tauri/crates/ot-plan/src/bank_mutation.rs"), true);
    assert.equal(isInScopePath("src-tauri/crates/ot-plan/src/bank_changeplan.rs"), true);
    assert.equal(isInScopePath("src-tauri/src/pse_bank_changeplan.rs"), true);
    assert.equal(isInScopePath("src-tauri/crates/ot-plan/Cargo.toml"), true);
    assert.equal(isInScopePath("src-tauri/src/bank_mutation_contract.rs"), true);
    assert.equal(isInScopePath("src-tauri/crates/ot-plan/src/rename.rs"), false);
    assert.equal(isInScopePath("scripts/pse-read-model-check.mjs"), true);
    assert.equal(isInScopePath("src-tauri/Cargo.lock"), true);
    assert.equal(isInScopePath(".github/workflows/pse-ci.yml"), true);
    assert.equal(isInScopePath("docs/testing/PSE_CI_FOUNDATION.md"), false);
    assert.equal(isInScopePath("docs/planning/DEVELOPMENT_STATUS.md"), false);
  });

  it("always runs on main push and fail-closes on unknown diffs", () => {
    assert.equal(decideScope({ eventName: "push", changedFiles: [] }).in_scope, true);
    assert.equal(
      decideScope({ eventName: "pull_request", diffStatus: "error" }).in_scope,
      true,
    );
    assert.equal(
      decideScope({ eventName: "pull_request", changedFiles: null }).in_scope,
      true,
    );
  });

  it("marks docs-only PRs out of scope without calling that a test PASS", () => {
    const decision = decideScope({
      eventName: "pull_request",
      changedFiles: ["docs/testing/PSE_CI_FOUNDATION.md"],
    });
    assert.equal(decision.in_scope, false);
    assert.match(decision.reason, /NOT_APPLICABLE/);
  });

  it("propagates git diff failures as an error status", () => {
    const diff = gitChangedFiles("a", "b", () => ({
      status: 2,
      stderr: "bad rev",
      stdout: "",
    }));
    assert.equal(diff.status, "error");
  });
});
