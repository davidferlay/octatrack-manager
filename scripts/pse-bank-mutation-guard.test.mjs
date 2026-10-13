import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ISSUE_191_GATE_IDS,
  LEGACY_BANK_FAMILY_COMMANDS,
  REQUIRED_RUST_TARGETS,
  evaluateLedger,
  maskRustSource,
  runGuard,
  scanFrontendSource,
  scanLegacyGate,
  scanRustSource,
  scanV2CommandSurface,
} from "./pse-bank-mutation-guard.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const guardScript = path.join(repositoryRoot, "scripts/pse-bank-mutation-guard.mjs");
const readRepo = (relativePath) =>
  readFileSync(path.join(repositoryRoot, relativePath), "utf8");
const ledger = () => JSON.parse(readRepo("scripts/pse-bank-mutation-gates.json"));
const inventory = () => JSON.parse(readRepo("scripts/pse-read-model-inventory.json"));
const rules = (findings) => findings.map((entry) => entry.rule);

function withRepositoryCopy(mutate) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pse-bank-guard-"));
  try {
    const entries = [
      ...REQUIRED_RUST_TARGETS,
      "src-tauri/src/v2_api.rs",
      "src-tauri/src/legacy_command_gate.rs",
      "src/api/projectStructure.ts",
      "src/features/project-structure",
      "scripts/pse-bank-mutation-gates.json",
      "scripts/pse-read-model-inventory.json",
      "docs/planning/PSE_BANK_MUTATION_SAFETY_CONTRACT.md",
    ];
    for (const entry of entries) {
      cpSync(path.join(repositoryRoot, entry), path.join(temp, entry), { recursive: true });
    }
    mutate(temp);
    return spawnSync(process.execPath, [guardScript, "--root", temp], { encoding: "utf8" });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("pse-bank-mutation-guard on the current tree", () => {
  it("passes and reports every ledger gate as BLOCKED", () => {
    const report = runGuard({ repositoryRoot });
    assert.deepEqual(report.findings, []);
    assert.equal(report.verdict, "PASS");
    assert.equal(report.bank_apply, "NOT_AUTHORIZED");
    assert.deepEqual(report.gates, { BLOCKED: 13, ACTIVE: 5 });
    for (const target of REQUIRED_RUST_TARGETS) {
      assert.ok(report.scanned.rust.includes(target), target);
    }
    assert.ok(report.scanned.frontend.includes("src/api/projectStructure.ts"));
    assert.ok(
      report.scanned.frontend.includes(
        "src/features/project-structure/ProjectStructureViewer.tsx",
      ),
    );
    assert.ok(report.scanned.frontend.every((file) => !/\.test\./.test(file)));
  });

  it("scans the real reader only after removing its cfg(test) module", () => {
    const source = readRepo("src-tauri/src/project_structure_reader.rs");
    assert.deepEqual(scanRustSource("reader", source), []);
    const exposed = source.replace(/#\[cfg\(test\)\]\s*mod tests/, "mod tests");
    assert.ok(
      rules(scanRustSource("reader", exposed)).includes("RUST_WRITE_API"),
      "test helpers write to temporary copies, so the patterns must see them once exposed",
    );
  });
});

describe("Rust write-surface scan", () => {
  const cases = [
    ["std::fs::write", 'fn f(p: &Path) { std::fs::write(p, b"x").unwrap(); }'],
    ["fs::rename", "fn f() { fs::rename(a, b).ok(); }"],
    ["fs::remove_file", "fn f() { fs::remove_file(a).ok(); }"],
    ["File::create", "fn f() { let _ = File::create(p); }"],
    ["OpenOptions write", "fn f() { OpenOptions::new().write(true).open(p); }"],
    ["OpenOptions create", "fn f() { OpenOptions::new().read(true).create( true ).open(p); }"],
    ["write_all", "fn f(mut h: File) { h.write_all(b\"x\").unwrap(); }"],
    ["io::Write", "use std::io::Write;"],
    ["libc O_RDWR", "fn f() { let flags = libc::O_RDWR | libc::O_CLOEXEC; }"],
    ["libc unlinkat", "fn f() { unsafe { libc::unlinkat(fd, name, 0) }; }"],
    ["symlink", "fn f() { std::os::unix::fs::symlink(a, b).unwrap(); }"],
    ["to_data_file", "fn f(bank: BankFile) { bank.to_data_file(&p).unwrap(); }"],
    ["executor dependency", "use ot_executor::Executor;"],
    ["write runtime dependency", "use crate::write_runtime::apply;"],
  ];
  for (const [label, source] of cases) {
    it(`rejects ${label}`, () => {
      assert.deepEqual(rules(scanRustSource("x.rs", source)), ["RUST_WRITE_API"]);
    });
  }

  it("allows read-only opens and reads", () => {
    const source = [
      "fn f(p: &Path) -> std::io::Result<Vec<u8>> {",
      "    let _ = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(p)?;",
      "    let _ = libc::O_RDONLY | libc::O_NONBLOCK;",
      "    std::fs::read(p)",
      "}",
      "fn is_symlink_open_error() {}",
    ].join("\n");
    assert.deepEqual(scanRustSource("x.rs", source), []);
  });

  it("ignores comments, strings, and char literals", () => {
    const source = [
      "// fs::write(p, x) would be a write",
      "/* File::create(p) /* nested */ */",
      'const MESSAGE: &str = "fs::remove_file is never called";',
      'const RAW: &str = r#"libc::O_WRONLY "quoted" "#;',
      "const BRACE: char = '{';",
      "fn f<'a>(x: &'a str) -> &'a str { x }",
    ].join("\n");
    assert.deepEqual(scanRustSource("x.rs", source), []);
  });

  it("still scans production code placed after a test module", () => {
    const source = [
      "#[cfg(test)]",
      "mod tests {",
      "    fn helper() { fs::write(p, b\"{\").unwrap(); let c = '}'; }",
      "}",
      "fn production() { fs::write(p, b\"x\").unwrap(); }",
    ].join("\n");
    const findings = scanRustSource("x.rs", source);
    assert.equal(findings.length, 1);
    assert.match(findings[0].target, /x\.rs:5$/);
  });

  it("fails closed on unparseable source", () => {
    assert.deepEqual(rules(scanRustSource("x.rs", 'const S: &str = "open')), ["RUST_PARSE"]);
    assert.deepEqual(rules(scanRustSource("x.rs", "#[cfg(test)]\nmod tests {\n fn f() {")), [
      "RUST_PARSE",
    ]);
    assert.equal(maskRustSource("/* open").masked, null);
  });
});

describe("frontend write-surface scan", () => {
  const legacy = ["copy_bank", "save_parts"];

  it("allows the read command and the projectStructure API", () => {
    const viewer = [
      "import { useState } from 'react';",
      "import { projectStructureApi } from '../../api/projectStructure';",
      "import type { SampleUsageEdge } from '../../api';",
      "import { type Foo, type Bar } from '../../api/changes';",
    ].join("\n");
    assert.deepEqual(
      scanFrontendSource("src/features/project-structure/Viewer.tsx", viewer, legacy),
      [],
    );
    const api = [
      "import { ipcClient } from './client';",
      "client.request('v2_project_structure_read', {});",
    ].join("\n");
    assert.deepEqual(scanFrontendSource("src/api/projectStructure.ts", api, legacy), []);
  });

  const rejected = [
    ["a mutation IPC command", "client.request('v2_change_apply', {});", "FRONTEND_IPC"],
    ["root write enablement", 'invoke("v2_root_enable_write")', "FRONTEND_IPC"],
    ["a legacy Bank write", "invoke(`copy_bank`, args)", "FRONTEND_IPC"],
    ["direct Tauri invoke", "import { invoke } from '@tauri-apps/api/core';", "FRONTEND_IMPORT"],
    ["the api barrel value import", "import { renameApi } from '../../api';", "FRONTEND_IMPORT"],
    ["another api module", "import { changesApi } from '../../api/changes';", "FRONTEND_IMPORT"],
    ["the raw IPC client", "import { ipcClient } from '../../api/client';", "FRONTEND_IMPORT"],
    ["a dynamic api import", "const m = await import('../../api/rename');", "FRONTEND_IMPORT"],
  ];
  for (const [label, source, rule] of rejected) {
    it(`rejects ${label}`, () => {
      assert.deepEqual(
        rules(scanFrontendSource("src/features/project-structure/Viewer.tsx", source, legacy)),
        [rule],
      );
    });
  }
});

describe("v2 command surface and legacy gate", () => {
  const surface = (names) =>
    names.map((name) => `#[tauri::command]\npub async fn ${name}(\n) -> R {}`).join("\n");

  it("allows only the Project Structure read in the Bank family", () => {
    assert.deepEqual(scanV2CommandSurface(surface(["v2_project_structure_read", "v2_change_plan"])), []);
    for (const name of ["v2_bank_copy_apply", "v2_project_structure_write", "v2_bank_swap_plan"]) {
      assert.deepEqual(
        rules(scanV2CommandSurface(surface(["v2_project_structure_read", name]))),
        ["V2_SURFACE"],
        name,
      );
    }
  });

  it("fails closed when the read command or the surface cannot be found", () => {
    assert.deepEqual(rules(scanV2CommandSurface(surface(["v2_change_plan"]))), ["V2_SURFACE"]);
    assert.deepEqual(rules(scanV2CommandSurface("")), ["V2_SURFACE"]);
  });

  it("requires every legacy Bank-family write to stay disabled", () => {
    const source = readRepo("src-tauri/src/legacy_command_gate.rs");
    assert.deepEqual(scanLegacyGate(source), []);
    const moved = source.replace('    "copy_bank",\n', "").replace(
      "pub const AUTHORIZED_COMMANDS: &[&str] = &[\n",
      'pub const AUTHORIZED_COMMANDS: &[&str] = &[\n    "copy_bank",\n',
    );
    assert.equal(rules(scanLegacyGate(moved)).length, 2);
    assert.deepEqual(rules(scanLegacyGate("")), ["LEGACY_GATE"]);
    assert.ok(LEGACY_BANK_FAMILY_COMMANDS.includes("copy_bank"));
  });
});

describe("ChangePlan / Mutation gate ledger", () => {
  const repoFileExists = (relativePath) => existsSync(path.join(repositoryRoot, relativePath));
  const evaluate = (value, fileExists = repoFileExists) =>
    evaluateLedger(value, { inventory: inventory(), fileExists });

  it("covers every #191 ChangePlan and Mutation item exactly once", () => {
    const current = ledger();
    assert.deepEqual(evaluate(current).findings, []);
    assert.deepEqual(
      current.gates.map((gate) => gate.id).sort(),
      [...ISSUE_191_GATE_IDS].sort(),
    );
    assert.equal(current.contract.issue, 182);
    assert.equal(
      current.contract.document,
      "docs/planning/PSE_BANK_MUTATION_SAFETY_CONTRACT.md",
    );
    const activeChangePlan = new Set([
      "change-plan.bank-copy-deterministic",
      "change-plan.bank-move-deterministic",
      "change-plan.bank-swap-deterministic",
      "change-plan.stale-precondition-detection",
      "change-plan.plan-generation-no-write",
    ]);
    for (const gate of current.gates) {
      if (activeChangePlan.has(gate.id)) {
        assert.equal(gate.status, "ACTIVE", gate.id);
        assert.ok(gate.required_tests.length > 0, gate.id);
      } else {
        assert.deepEqual(gate.required_tests, [], gate.id);
        assert.equal(gate.status, "BLOCKED", gate.id);
      }
    }
  });

  it("checks contract rule and test mappings without activating gates", () => {
    const mapped = ledger();
    const gate = mapped.gates.find((entry) => entry.id === "mutation.expected-changed-files-only");
    assert.ok(gate.contract_rules.includes("BMS-CHANGESET"));
    assert.deepEqual(evaluate(mapped, () => true).findings, []);

    const unknownTest = ledger();
    unknownTest.gates.find((entry) => entry.id === gate.id).contract_tests = ["not_a_test"];
    assert.match(
      evaluate(unknownTest, () => true).findings[0].detail,
      /contract test not_a_test, which is not in/,
    );

    const badRule = ledger();
    badRule.gates.find((entry) => entry.id === gate.id).contract_rules = ["VERIFY"];
    assert.match(evaluate(badRule, () => true).findings[0].detail, /not a BMS-\* rule id/);

    const empty = ledger();
    empty.gates.find((entry) => entry.id === gate.id).contract_tests = [];
    assert.match(evaluate(empty, () => true).findings[0].detail, /non-empty array/);

    const noDocument = ledger();
    noDocument.contract.document = null;
    assert.match(evaluate(noDocument).findings[0].detail, /without a #182 contract document/);
  });

  it("fails when a gate is dropped or duplicated", () => {
    const dropped = ledger();
    dropped.gates = dropped.gates.filter((gate) => gate.id !== "recovery.rollback");
    assert.match(evaluate(dropped).findings[0].detail, /recovery\.rollback is missing/);
    const duplicated = ledger();
    duplicated.gates.push(duplicated.gates[0]);
    assert.match(evaluate(duplicated).findings[0].detail, /duplicate gate/);
  });

  it("rejects a BLOCKED gate that claims tests or has no blocker", () => {
    const blockedGate = (value) =>
      value.gates.find((entry) => entry.id === "mutation.pre-manifest");
    const claimed = ledger();
    blockedGate(claimed).required_tests = ["anything"];
    assert.match(evaluate(claimed).findings[0].detail, /BLOCKED but lists required tests/);
    const unexplained = ledger();
    blockedGate(unexplained).waits_on = [];
    assert.match(evaluate(unexplained).findings[0].detail, /without waits_on/);
  });

  it("keeps mutation and recovery gates BLOCKED until #182 / #183", () => {
    for (const id of ["mutation.pre-manifest", "recovery.rollback"]) {
      const active = ledger();
      const gate = active.gates.find((entry) => entry.id === id);
      gate.status = "ACTIVE";
      gate.required_tests = ["working_and_saved_bank_documents_stay_separate_entries"];
      assert.match(evaluate(active).findings[0].detail, /cannot be ACTIVE/, id);
    }
    const runner = ledger();
    runner.mutation_runner.implemented = true;
    assert.match(evaluate(runner).findings[0].detail, /mutation_runner\.implemented/);
  });

  it("allows an ACTIVE change-plan gate only with inventory-backed tests", () => {
    const changePlanGate = (value) =>
      value.gates.find((entry) => entry.id === "change-plan.bank-copy-deterministic");

    const empty = ledger();
    changePlanGate(empty).required_tests = [];
    assert.match(evaluate(empty).findings[0].detail, /ACTIVE without required tests/);

    const unknown = ledger();
    changePlanGate(unknown).required_tests = ["bank_copy_plan_is_deterministic"];
    assert.match(evaluate(unknown).findings[0].detail, /not in scripts\/pse-read-model-inventory\.json/);

    const backed = ledger();
    changePlanGate(backed).required_tests = ["bank_copy_changeplan_is_deterministic_and_blocked"];
    assert.deepEqual(evaluate(backed).findings, []);
    assert.deepEqual(evaluate(backed).summary, {
      BLOCKED: ISSUE_191_GATE_IDS.length - 5,
      ACTIVE: 5,
    });
  });

  it("requires the #182 contract hook and an existing contract document once set", () => {
    const wrongIssue = ledger();
    wrongIssue.contract.issue = 999;
    assert.match(evaluate(wrongIssue).findings[0].detail, /#182/);
    const missingDoc = ledger();
    missingDoc.contract.document = "docs/testing/BANK_MUTATION_SAFETY_CONTRACT.md";
    assert.match(evaluate(missingDoc).findings[0].detail, /does not exist/);
    assert.deepEqual(evaluate(missingDoc, () => true).findings, []);
  });

  it("rejects an unknown schema", () => {
    assert.match(evaluate({ schema: "other" }).findings[0].detail, /schema/);
  });
});

describe("pse-bank-mutation-guard CLI", () => {
  it("exits 0 on an unchanged copy of the guarded files", () => {
    const result = withRepositoryCopy(() => {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).verdict, "PASS");
  });

  it("exits non-zero when a new Bank module writes", () => {
    const result = withRepositoryCopy((root) => {
      writeFileSync(
        path.join(root, "src-tauri/src/bank_apply.rs"),
        "pub fn apply(p: &std::path::Path) { std::fs::write(p, b\"x\").unwrap(); }\n",
      );
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verdict, "FAIL");
    assert.ok(report.scanned.rust.includes("src-tauri/src/bank_apply.rs"));
  });

  it("exits non-zero when a new Bank editor feature calls a mutation command", () => {
    const result = withRepositoryCopy((root) => {
      const directory = path.join(root, "src/features/bank-editor");
      cpSync(path.join(root, "src/features/project-structure"), directory, { recursive: true });
      writeFileSync(
        path.join(directory, "BankApply.ts"),
        "export const run = (c) => c.request('v2_change_apply', {});\n",
      );
    });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).findings.some((entry) => entry.rule === "FRONTEND_IPC"));
  });

  it("exits non-zero when a required target is missing", () => {
    const result = withRepositoryCopy((root) => {
      rmSync(path.join(root, "src-tauri/src/bank_validation.rs"));
    });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).findings.some((entry) => entry.rule === "MISSING_TARGET"));
  });
});
