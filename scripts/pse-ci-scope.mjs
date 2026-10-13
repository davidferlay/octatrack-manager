#!/usr/bin/env node
/**
 * Fail-closed path scope for Project Structure CI.
 *
 * Unknown git state is treated as in-scope. Docs-only changes are
 * NOT_APPLICABLE, never reported as a test PASS.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SCOPE_SCHEMA = "masterocta-pse-ci-scope:v1";

const IN_SCOPE_PREFIXES = [
  "src/api/projectStructure",
  "src/features/project-structure/",
  "e2e/project-structure-viewer.spec.ts",
  "src/features/roots/RootRegistryPanel.tsx",
  "src/features/library/CatalogWorkspaceViews.tsx",
  "src/features/library/CatalogLibraryBrowser.tsx",
  "src-tauri/src/project_structure_command.rs",
  "src-tauri/src/v2_api.rs",
  "src-tauri/src/project_structure_reader.rs",
  "src-tauri/src/sample_slot_boundary.rs",
  "src-tauri/src/bank_validation.rs",
  "src-tauri/src/legacy_read_adapter.rs",
  "src-tauri/crates/ot-domain/src/project_structure.rs",
  "src-tauri/crates/ot-codec/src/project_structure.rs",
  "src-tauri/crates/ot-domain/src/lib.rs",
  "src-tauri/crates/ot-plan/src/bank_mutation.rs",
  "src-tauri/crates/ot-plan/src/bank_changeplan.rs",
  "src-tauri/src/pse_bank_changeplan.rs",
  "src-tauri/crates/ot-plan/src/lib.rs",
  "src-tauri/crates/ot-plan/Cargo.toml",
  "src-tauri/src/bank_mutation_contract.rs",
  "src-tauri/tests/fixtures/",
  "scripts/pse-",
  "scripts/check-architecture.mjs",
  "scripts/check-containment.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  ".github/workflows/pse-ci.yml",
  ".github/workflows/ci.yml",
  "package.json",
  "pnpm-lock.yaml",
];

export function isInScopePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return IN_SCOPE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

export function decideScope({
  eventName,
  changedFiles,
  diffStatus = "ok",
} = {}) {
  if (eventName === "push") {
    return {
      schema: SCOPE_SCHEMA,
      in_scope: true,
      reason: "main push always runs the read-model jobs",
      changed_files: changedFiles ?? [],
    };
  }
  if (diffStatus !== "ok") {
    return {
      schema: SCOPE_SCHEMA,
      in_scope: true,
      reason: `fail-closed: changed-path state is ${diffStatus}`,
      changed_files: changedFiles ?? [],
    };
  }
  if (!Array.isArray(changedFiles)) {
    return {
      schema: SCOPE_SCHEMA,
      in_scope: true,
      reason: "fail-closed: changed-path list is unknown",
      changed_files: [],
    };
  }
  const matched = changedFiles.filter(isInScopePath);
  if (matched.length > 0) {
    return {
      schema: SCOPE_SCHEMA,
      in_scope: true,
      reason: `matched ${matched.join(",")}`,
      changed_files: changedFiles,
      matched,
    };
  }
  return {
    schema: SCOPE_SCHEMA,
    in_scope: false,
    reason:
      "docs-only or unrelated paths; rust read-model jobs are NOT_APPLICABLE, not PASS",
    changed_files: changedFiles,
    matched: [],
  };
}

export function gitChangedFiles(base, head, spawn = spawnSync) {
  const result = spawn(
    "git",
    ["diff", "--name-only", "--no-renames", `${base}...${head}`],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return {
      status: "error",
      files: [],
      detail: result.stderr || result.stdout || `git exit ${result.status}`,
    };
  }
  return {
    status: "ok",
    files: (result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : null;
}

export function resolveScopeFromArgs(args, env = process.env, spawn = spawnSync) {
  const eventName = takeOption(args, "--event") ?? env.GITHUB_EVENT_NAME ?? "";
  const base = takeOption(args, "--base") ?? env.PSE_SCOPE_BASE ?? "";
  const head = takeOption(args, "--head") ?? env.PSE_SCOPE_HEAD ?? "";
  let changedFiles;
  let diffStatus = "ok";
  if (args.includes("--files")) {
    const start = args.indexOf("--files") + 1;
    changedFiles = args.slice(start).filter((value) => !value.startsWith("--"));
  } else if (eventName === "push") {
    changedFiles = [];
  } else if (!base || !head) {
    diffStatus = "unknown";
    changedFiles = null;
  } else {
    const diff = gitChangedFiles(base, head, spawn);
    changedFiles = diff.files;
    diffStatus = diff.status;
  }
  return decideScope({ eventName, changedFiles, diffStatus });
}

export function runCli(argv, env = process.env, spawn = spawnSync) {
  const decision = resolveScopeFromArgs(argv.slice(2), env, spawn);
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `in_scope=${decision.in_scope}\nreason=${decision.reason}\n`,
    );
  }
  return 0;
}

const invokedAsCli =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  process.exitCode = runCli(process.argv);
}
