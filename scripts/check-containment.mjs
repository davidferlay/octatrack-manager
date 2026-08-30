#!/usr/bin/env node
/**
 * SEC-1 containment guard.
 *
 * Fail closed when P0 containment regresses:
 * - CSP must not be null
 * - updater must stay disabled / absent
 * - createUpdaterArtifacts must remain false
 * - GitHub Actions must pin full commit SHAs (no mutable tags)
 * - no NEW direct invoke() outside src/api (legacy call sites frozen)
 * - no NEW legacy commands on the safe-build generate_handler surface
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const failures = [];

function fail(message) {
  failures.push(message);
}

function walkFiles(directory, predicate, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target") {
        continue;
      }
      walkFiles(fullPath, predicate, out);
      continue;
    }
    if (predicate(fullPath, entry.name)) out.push(fullPath);
  }
  return out;
}

// --- CSP / updater / createUpdaterArtifacts ---
const tauriConfPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const csp = tauriConf?.app?.security?.csp;
if (csp === null || csp === undefined) {
  fail("tauri.conf.json app.security.csp must not be null/undefined");
} else if (typeof csp !== "object" || Array.isArray(csp)) {
  fail("tauri.conf.json app.security.csp must be a non-null object policy");
}

const createUpdaterArtifacts = tauriConf?.bundle?.createUpdaterArtifacts;
if (createUpdaterArtifacts !== false) {
  fail(
    `tauri.conf.json bundle.createUpdaterArtifacts must be false (found ${JSON.stringify(createUpdaterArtifacts)})`,
  );
}

const cargoToml = readFileSync(
  path.join(repositoryRoot, "src-tauri", "Cargo.toml"),
  "utf8",
);
const packageJson = readFileSync(path.join(repositoryRoot, "package.json"), "utf8");
const lockSnippet = readFileSync(path.join(repositoryRoot, "src-tauri", "Cargo.lock"), "utf8");
const forbiddenUpdaterMarkers = [
  /tauri-plugin-updater/,
  /@tauri-apps\/plugin-updater/,
  /plugins\.updater/,
  /"updater"\s*:\s*\{/,
  /createUpdaterArtifacts\s*:\s*true/,
];
for (const [label, text] of [
  ["src-tauri/Cargo.toml", cargoToml],
  ["package.json", packageJson],
  ["src-tauri/Cargo.lock", lockSnippet],
  ["src-tauri/tauri.conf.json", JSON.stringify(tauriConf)],
]) {
  for (const marker of forbiddenUpdaterMarkers) {
    if (marker.test(text)) {
      fail(`${label} must not reintroduce updater (${marker})`);
    }
  }
}

// --- GitHub Actions mutable tags ---
const workflowDir = path.join(repositoryRoot, ".github", "workflows");
const workflowFiles = walkFiles(workflowDir, (_full, name) => /\.ya?ml$/i.test(name));
const shaPinnedUses =
  /^\s*(?:-\s*)?uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\b/i;
const usesLine = /^\s*(?:-\s*)?uses:\s+/i;
const mutableUses =
  /^\s*(?:-\s*)?uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@(?:v?\d[\w.-]*|main|master|latest)\b/i;
for (const workflowPath of workflowFiles) {
  const relative = path.relative(repositoryRoot, workflowPath);
  const lines = readFileSync(workflowPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!usesLine.test(line)) return;
    if (line.includes("./")) return; // local composite actions
    if (mutableUses.test(line) || !shaPinnedUses.test(line)) {
      if (!/@[0-9a-f]{40}\b/i.test(line)) {
        fail(
          `${relative}:${index + 1} Actions use must pin a full 40-char commit SHA (no mutable tags)`,
        );
      }
    }
  });
}

// --- Frozen legacy generate_handler surface (non-v2) ---
const expectedLegacyCommands = [
  "greet",
  "scan_devices",
  "scan_custom_directory",
  "load_project_metadata",
  "load_project_banks",
  "load_single_bank",
  "compute_sample_usage",
  "get_pool_usage",
  "list_set_projects",
  "get_existing_banks",
  "load_parts_data",
  "save_parts",
  "save_memory_settings",
  "commit_part",
  "commit_all_parts",
  "reload_part",
  "list_audio_directory",
  "list_audio_files_recursive",
  "list_audio_directory_recursive",
  "navigate_to_parent",
  "create_new_directory",
  "resolve_default_purge_destination",
  "copy_audio_files",
  "copy_audio_files_to_project",
  "copy_audio_file_with_progress",
  "cancel_audio_transfer",
  "move_audio_files",
  "delete_audio_files",
  "get_home_directory",
  "rename_file",
  "delete_file",
  "open_in_file_manager",
  "reveal_in_file_manager",
  "read_audio_file",
  "expand_audio_paths",
  "inspect_audio_files",
  "get_audio_files_info",
  "get_system_resources",
  "check_project_in_set",
  "check_projects_in_same_set",
  "get_audio_pool_status",
  "create_audio_pool",
  "copy_bank",
  "validate_bank_sample_slots",
  "copy_parts",
  "copy_patterns",
  "copy_tracks",
  "copy_sample_slots",
  "check_missing_source_files",
  "get_slot_audio_paths",
  "backup_project_files",
  "list_missing_samples",
  "search_project_dir",
  "search_audio_pool",
  "search_other_projects_of_set",
  "search_parent_projects",
  "search_directory",
  "fix_missing_samples",
  "fix_pool_files",
  "fix_project_samples",
  "scan_project_unused_files",
  "scan_pool_unused_files",
  "purge_project_files",
  "purge_pool_files",
  "list_unused_slot_assignments",
  "assign_samples_to_slots",
  "clear_sample_slots",
  "clear_sample_keep_attributes",
  "reset_slot_attributes",
  "project_manager::create_project",
  "project_manager::copy_project",
  "project_manager::copy_project_with_progress",
  "project_manager::copy_set",
  "project_manager::cancel_copy_operation",
  "project_manager::rename_project",
  "project_manager::move_project",
  "project_manager::move_project_with_progress",
  "project_manager::move_set",
  "project_manager::move_set_with_progress",
  "project_manager::delete_project",
  "project_manager::rescan_set",
  "project_manager::create_set",
  "project_manager::rename_set",
  "project_manager::delete_set",
];

const libRs = readFileSync(path.join(repositoryRoot, "src-tauri", "src", "lib.rs"), "utf8");
const handlerMatch = libRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handlerMatch) {
  fail("src-tauri/src/lib.rs must contain tauri::generate_handler![...]");
} else {
  const entries = handlerMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line && !line.startsWith("//"));
  const legacy = entries.filter((entry) => !entry.startsWith("v2_api::"));
  const expected = [...expectedLegacyCommands];
  const actualSorted = [...legacy].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const added = actualSorted.filter((name) => !expectedSorted.includes(name));
    const removed = expectedSorted.filter((name) => !actualSorted.includes(name));
    if (added.length > 0) {
      fail(
        "safe-build legacy generate_handler grew unexpectedly: " + added.join(", "),
      );
    }
    if (removed.length > 0) {
      fail(
        "safe-build legacy generate_handler lost entries (update the SEC-1 freeze intentionally): " +
          removed.join(", "),
      );
    }
  }
}

// --- Frozen legacy frontend invoke() call sites outside src/api ---
const allowedLegacyInvokeFiles = new Set([
  "src/App.tsx",
  "src/components/AudioFileTable.tsx",
  "src/components/AudioPoolSidebar.test.tsx",
  "src/components/AudioPoolSidebar.tsx",
  "src/components/CopyProgressModal.tsx",
  "src/components/FixMissingSamplesModal.test.tsx",
  "src/components/FixMissingSamplesModal.tsx",
  "src/components/FixPoolFilesModal.tsx",
  "src/components/FixProjectFilesModal.tsx",
  "src/components/PartsPanel.tsx",
  "src/components/PurgeFilesModal.tsx",
  "src/components/SampleSlotsTable.test.tsx",
  "src/components/SampleSlotsTable.tsx",
  "src/components/ToolsPanel.tsx",
  "src/hooks/useAudioPoolTransfer.test.ts",
  "src/hooks/useAudioPoolTransfer.ts",
  "src/hooks/useAudioPreview.test.ts",
  "src/hooks/useAudioPreview.ts",
  "src/hooks/usePoolUsage.test.ts",
  "src/hooks/usePoolUsage.ts",
  "src/pages/AudioPoolPage.tsx",
  "src/pages/HomePage.tsx",
  "src/pages/ProjectDetail.tsx",
]);

const srcRoot = path.join(repositoryRoot, "src");
const invokeImport =
  /from\s+['"]@tauri-apps\/api(?:\/core)?['"]|require\(\s*['"]@tauri-apps\/api(?:\/core)?['"]\s*\)/;
const invokeCallSites = [];
for (const filePath of walkFiles(srcRoot, (_full, name) => /\.(tsx?|jsx?)$/.test(name))) {
  const relative = path.relative(repositoryRoot, filePath).split(path.sep).join("/");
  if (relative === "src/api/client.ts" || relative.startsWith("src/api/")) {
    // Central IPC client and api modules may import invoke.
    continue;
  }
  const contents = readFileSync(filePath, "utf8");
  if (!invokeImport.test(contents)) continue;
  // Only flag files that both import the core API and mention invoke(
  // (event/window/app imports without invoke are out of this rule).
  if (!/\binvoke\b/.test(contents)) continue;
  if (!allowedLegacyInvokeFiles.has(relative)) {
    invokeCallSites.push(relative);
  }
}
if (invokeCallSites.length > 0) {
  fail(
    "new direct invoke() outside src/api is forbidden; found in: " +
      invokeCallSites.sort().join(", "),
  );
}

// Also ensure listed allowlist files still exist (typos would silently widen).
for (const relative of allowedLegacyInvokeFiles) {
  try {
    statSync(path.join(repositoryRoot, relative));
  } catch {
    fail(`SEC-1 invoke allowlist references missing file: ${relative}`);
  }
}

if (failures.length > 0) {
  console.error("Containment check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Containment rules passed.");
