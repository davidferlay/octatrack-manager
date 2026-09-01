#!/usr/bin/env node
/**
 * SEC-1 containment guard.
 *
 * Fail closed when P0 containment regresses:
 * - CSP must stay a restrictive non-null object policy (no * / unsafe-eval)
 * - platform Tauri configs are checked (base + tauri.*.conf.json merges)
 * - updater must stay disabled / absent
 * - createUpdaterArtifacts must remain false
 * - GitHub Actions (workflows + composite actions) must pin full commit SHAs
 * - no NEW direct invoke() command names outside src/api (call-site freeze)
 * - no NEW legacy commands on the safe-build generate_handler surface
 * - every v2_api:: generate_handler entry must match the approved v2 list
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "target"
      ) {
        continue;
      }
      walkFiles(fullPath, predicate, out);
      continue;
    }
    if (predicate(fullPath, entry.name)) out.push(fullPath);
  }
  return out;
}

function stripYamlInlineComment(line) {
  // Workflow `uses:` values are unquoted; strip trailing `# ...` comments.
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

function deepMerge(base, override) {
  if (override === null || typeof override !== "object" || Array.isArray(override)) {
    return override;
  }
  if (base === null || typeof base !== "object" || Array.isArray(base)) {
    return structuredClone(override);
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Exact restrictive CSP freeze from PR #28 / current tauri.conf.json. */
const expectedCsp = {
  "default-src": "'self'",
  "connect-src": "ipc: http://ipc.localhost https://ipc.localhost",
  "img-src": "'self' data: blob:",
  "media-src": "'self' blob:",
  "style-src": "'self' 'unsafe-inline'",
  "font-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'self'",
  "frame-ancestors": "'none'",
  "form-action": "'self'",
};

function assertRestrictiveCsp(csp, label) {
  if (csp === null || csp === undefined) {
    fail(`${label} app.security.csp must not be null/undefined`);
    return;
  }
  if (typeof csp !== "object" || Array.isArray(csp)) {
    fail(`${label} app.security.csp must be a non-null object policy`);
    return;
  }

  const actualKeys = Object.keys(csp).sort();
  const expectedKeys = Object.keys(expectedCsp).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(
      `${label} app.security.csp directive set must match the restrictive freeze ` +
        `(expected [${expectedKeys.join(", ")}], found [${actualKeys.join(", ")}])`,
    );
  }

  for (const [directive, expectedValue] of Object.entries(expectedCsp)) {
    const actualValue = csp[directive];
    if (actualValue !== expectedValue) {
      fail(
        `${label} app.security.csp["${directive}"] must be ${JSON.stringify(expectedValue)} ` +
          `(found ${JSON.stringify(actualValue)})`,
      );
    }
  }

  // Defense in depth: reject wildcard / unsafe-eval even if freeze is edited loosely.
  for (const [directive, value] of Object.entries(csp)) {
    if (typeof value !== "string") {
      fail(`${label} app.security.csp["${directive}"] must be a string`);
      continue;
    }
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.includes("*")) {
      fail(`${label} app.security.csp["${directive}"] must not allow '*'`);
    }
    if (tokens.includes("'unsafe-eval'")) {
      fail(
        `${label} app.security.csp["${directive}"] must not allow 'unsafe-eval'`,
      );
    }
  }
}

function assertCreateUpdaterArtifacts(conf, label) {
  const createUpdaterArtifacts = conf?.bundle?.createUpdaterArtifacts;
  if (createUpdaterArtifacts !== false) {
    fail(
      `${label} bundle.createUpdaterArtifacts must be false (found ${JSON.stringify(createUpdaterArtifacts)})`,
    );
  }
}

function scanUpdaterMarkers(label, text) {
  const forbiddenUpdaterMarkers = [
    /tauri-plugin-updater/,
    /@tauri-apps\/plugin-updater/,
    /plugins\.updater/,
    /"updater"\s*:\s*\{/,
    /createUpdaterArtifacts\s*:\s*true/,
    /updater:default/,
    /"updater:/,
  ];
  for (const marker of forbiddenUpdaterMarkers) {
    if (marker.test(text)) {
      fail(`${label} must not reintroduce updater (${marker})`);
    }
  }
}

// --- CSP / updater / createUpdaterArtifacts (base + platform overrides) ---
const tauriConfPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
assertRestrictiveCsp(tauriConf?.app?.security?.csp, "tauri.conf.json");
assertCreateUpdaterArtifacts(tauriConf, "tauri.conf.json");

const platformConfFiles = walkFiles(
  path.join(repositoryRoot, "src-tauri"),
  (full, name) =>
    /^tauri\..+\.conf\.json$/i.test(name) &&
    path.dirname(full) === path.join(repositoryRoot, "src-tauri"),
);

for (const platformPath of platformConfFiles) {
  const relative = path
    .relative(repositoryRoot, platformPath)
    .split(path.sep)
    .join("/");
  const platformConf = JSON.parse(readFileSync(platformPath, "utf8"));
  // Reject unsafe overrides in the platform file itself.
  if (
    Object.prototype.hasOwnProperty.call(platformConf, "app") ||
    Object.prototype.hasOwnProperty.call(platformConf?.app ?? {}, "security") ||
    Object.prototype.hasOwnProperty.call(
      platformConf?.app?.security ?? {},
      "csp",
    )
  ) {
    const platformCsp = platformConf?.app?.security?.csp;
    if (platformCsp !== undefined) {
      assertRestrictiveCsp(platformCsp, relative);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(
      platformConf?.bundle ?? {},
      "createUpdaterArtifacts",
    )
  ) {
    assertCreateUpdaterArtifacts(platformConf, relative);
  }
  scanUpdaterMarkers(relative, JSON.stringify(platformConf));

  // Validate the effective merged configuration Tauri would use for that target.
  const merged = deepMerge(tauriConf, platformConf);
  assertRestrictiveCsp(merged?.app?.security?.csp, `${relative} (merged)`);
  assertCreateUpdaterArtifacts(merged, `${relative} (merged)`);
  scanUpdaterMarkers(`${relative} (merged)`, JSON.stringify(merged));
}

const cargoToml = readFileSync(
  path.join(repositoryRoot, "src-tauri", "Cargo.toml"),
  "utf8",
);
const packageJson = readFileSync(path.join(repositoryRoot, "package.json"), "utf8");
const lockSnippet = readFileSync(
  path.join(repositoryRoot, "src-tauri", "Cargo.lock"),
  "utf8",
);

const updaterScanTargets = [
  ["src-tauri/Cargo.toml", cargoToml],
  ["package.json", packageJson],
  ["src-tauri/Cargo.lock", lockSnippet],
  ["src-tauri/tauri.conf.json", JSON.stringify(tauriConf)],
];
const capabilityFiles = walkFiles(
  path.join(repositoryRoot, "src-tauri"),
  (full, name) =>
    name.endsWith(".json") &&
    (full.includes(`${path.sep}capabilities${path.sep}`) ||
      name === "capabilities.json"),
);
for (const capabilityPath of capabilityFiles) {
  updaterScanTargets.push([
    path.relative(repositoryRoot, capabilityPath).split(path.sep).join("/"),
    readFileSync(capabilityPath, "utf8"),
  ]);
}

for (const [label, text] of updaterScanTargets) {
  scanUpdaterMarkers(label, text);
}

// Reject package scripts that inject extra --config overrides we do not audit.
if (/\btauri\b[\s\S]*--config\b/.test(packageJson)) {
  fail(
    "package.json must not pass tauri --config overrides (platform confs are audited via tauri.*.conf.json only)",
  );
}

// --- GitHub Actions mutable tags (workflows + composite actions) ---
const actionsScanRoots = [
  path.join(repositoryRoot, ".github", "workflows"),
  path.join(repositoryRoot, ".github", "actions"),
];
const usesLine = /^\s*(?:-\s*)?uses:\s+/i;
for (const scanRoot of actionsScanRoots) {
  const yamlFiles = walkFiles(scanRoot, (_full, name) =>
    /\.ya?ml$/i.test(name),
  );
  for (const workflowPath of yamlFiles) {
    const relative = path.relative(repositoryRoot, workflowPath);
    const lines = readFileSync(workflowPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!usesLine.test(line)) return;
      const withoutComment = stripYamlInlineComment(line).trimEnd();
      const match = withoutComment.match(/^\s*(?:-\s*)?uses:\s+(\S+)\s*$/i);
      if (!match) {
        fail(`${relative}:${index + 1} Actions uses line could not be parsed`);
        return;
      }
      const actionRef = match[1];
      if (actionRef.startsWith("./")) return; // local composite actions
      const at = actionRef.lastIndexOf("@");
      const pin = at === -1 ? "" : actionRef.slice(at + 1);
      if (!/^[0-9a-f]{40}$/i.test(pin)) {
        fail(
          `${relative}:${index + 1} Actions use must pin a full 40-char commit SHA (no mutable tags)`,
        );
      }
    });
  }
}

// --- Frozen legacy generate_handler surface (non-v2) + exact v2 allowlist ---
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

const expectedV2Commands = [
  "v2_asset_metadata_get",
  "v2_asset_metadata_replace",
  "v2_audio_preview_create",
  "v2_audio_preview_read",
  "v2_audio_waveform_get",
  "v2_change_apply",
  "v2_change_get_plan",
  "v2_change_plan",
  "v2_change_recover",
  "v2_change_recovery_status",
  "v2_change_status",
  "v2_library_list",
  "v2_rename_get_plan",
  "v2_rename_plan",
  "v2_root_close",
  "v2_root_disable_write",
  "v2_root_enable_write",
  "v2_root_register",
  "v2_root_status",
];

const libRs = readFileSync(
  path.join(repositoryRoot, "src-tauri", "src", "lib.rs"),
  "utf8",
);
const handlerMatch = libRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handlerMatch) {
  fail("src-tauri/src/lib.rs must contain tauri::generate_handler![...]");
} else {
  const entries = handlerMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line && !line.startsWith("//"));
  const legacy = entries.filter((entry) => !entry.startsWith("v2_api::"));
  const v2Entries = entries
    .filter((entry) => entry.startsWith("v2_api::"))
    .map((entry) => entry.slice("v2_api::".length));

  const actualLegacySorted = [...legacy].sort();
  const expectedLegacySorted = [...expectedLegacyCommands].sort();
  if (JSON.stringify(actualLegacySorted) !== JSON.stringify(expectedLegacySorted)) {
    const added = actualLegacySorted.filter(
      (name) => !expectedLegacySorted.includes(name),
    );
    const removed = expectedLegacySorted.filter(
      (name) => !actualLegacySorted.includes(name),
    );
    if (added.length > 0) {
      fail(
        "safe-build legacy generate_handler grew unexpectedly: " +
          added.join(", "),
      );
    }
    if (removed.length > 0) {
      fail(
        "safe-build legacy generate_handler lost entries (update the SEC-1 freeze intentionally): " +
          removed.join(", "),
      );
    }
  }

  const actualV2Sorted = [...v2Entries].sort();
  const expectedV2Sorted = [...expectedV2Commands].sort();
  if (JSON.stringify(actualV2Sorted) !== JSON.stringify(expectedV2Sorted)) {
    const added = actualV2Sorted.filter(
      (name) => !expectedV2Sorted.includes(name),
    );
    const removed = expectedV2Sorted.filter(
      (name) => !actualV2Sorted.includes(name),
    );
    if (added.length > 0) {
      fail(
        "safe-build v2_api:: generate_handler grew unexpectedly: " +
          added.join(", "),
      );
    }
    if (removed.length > 0) {
      fail(
        "safe-build v2_api:: generate_handler lost entries (update the SEC-1 freeze intentionally): " +
          removed.join(", "),
      );
    }
    // Catch non-v2_* symbols under the namespace prefix.
    const unexpected = v2Entries.filter(
      (name) => !/^v2_[a-z0-9_]+$/.test(name),
    );
    for (const name of unexpected) {
      fail(`v2_api:: handler entry must be an approved v2_* command: ${name}`);
    }
  }
}

// --- Frozen legacy frontend invoke() call sites (command names, not whole files) ---
const frozenLegacyInvokeCommandsByFile = {
  "src/App.tsx": ["scan_custom_directory", "scan_devices"],
  "src/components/AudioFileTable.tsx": [
    "inspect_audio_files",
    "list_audio_directory_recursive",
  ],
  "src/components/AudioPoolSidebar.tsx": [
    "fix_pool_files",
    "list_audio_directory",
    "list_audio_files_recursive",
    "reveal_in_file_manager",
  ],
  "src/components/CopyProgressModal.tsx": ["cancel_copy_operation"],
  "src/components/FixMissingSamplesModal.tsx": [
    "backup_project_files",
    "fix_missing_samples",
    "search_audio_pool",
    "search_directory",
    "search_other_projects_of_set",
    "search_parent_projects",
    "search_project_dir",
  ],
  "src/components/FixPoolFilesModal.tsx": [
    "cancel_audio_transfer",
    "fix_pool_files",
    "get_audio_files_info",
    "reveal_in_file_manager",
  ],
  "src/components/FixProjectFilesModal.tsx": ["fix_project_samples"],
  "src/components/PartsPanel.tsx": [
    "commit_all_parts",
    "commit_part",
    "load_parts_data",
    "reload_part",
    "save_parts",
  ],
  "src/components/PurgeFilesModal.tsx": [
    "cancel_audio_transfer",
    "reveal_in_file_manager",
  ],
  "src/components/SampleSlotsTable.tsx": [
    "assign_samples_to_slots",
    "clear_sample_keep_attributes",
    "clear_sample_slots",
    "copy_audio_files",
    "copy_audio_files_to_project",
    "expand_audio_paths",
    "fix_project_samples",
    "inspect_audio_files",
    "list_audio_files_recursive",
    "reset_slot_attributes",
    "reveal_in_file_manager",
  ],
  "src/components/ToolsPanel.tsx": [
    "backup_project_files",
    "check_missing_source_files",
    "check_projects_in_same_set",
    "copy_bank",
    "copy_parts",
    "copy_patterns",
    "copy_sample_slots",
    "copy_tracks",
    "create_project",
    "get_audio_pool_status",
    "get_slot_audio_paths",
    "inspect_audio_files",
    "list_audio_files_recursive",
    "list_missing_samples",
    "list_unused_slot_assignments",
    "purge_project_files",
    "resolve_default_purge_destination",
    "scan_custom_directory",
    "scan_devices",
    "scan_project_unused_files",
    "validate_bank_sample_slots",
  ],
  "src/hooks/useAudioPoolTransfer.ts": [
    "cancel_audio_transfer",
    "copy_audio_file_with_progress",
    "get_system_resources",
  ],
  "src/hooks/useAudioPreview.ts": ["read_audio_file"],
  "src/hooks/usePoolUsage.ts": ["get_pool_usage"],
  "src/pages/AudioPoolPage.tsx": [
    "create_new_directory",
    "delete_audio_files",
    "fix_pool_files",
    "get_home_directory",
    "inspect_audio_files",
    "list_audio_directory",
    "list_audio_files_recursive",
    "list_set_projects",
    "list_unused_slot_assignments",
    "navigate_to_parent",
    "open_in_file_manager",
    "purge_pool_files",
    "rename_file",
    "resolve_default_purge_destination",
    "reveal_in_file_manager",
    "scan_pool_unused_files",
    "scan_project_unused_files",
  ],
  "src/pages/HomePage.tsx": [
    "create_project",
    "create_set",
    "delete_project",
    "delete_set",
    "open_in_file_manager",
    "rename_project",
    "rename_set",
    "rescan_set",
    "scan_custom_directory",
    "scan_devices",
  ],
  "src/pages/ProjectDetail.tsx": [
    "backup_project_files",
    "compute_sample_usage",
    "get_audio_pool_status",
    "get_existing_banks",
    "get_system_resources",
    "load_parts_data",
    "load_project_metadata",
    "load_single_bank",
    "reveal_in_file_manager",
    "save_memory_settings",
  ],
};

/** Only CopyProgressModal may call invoke(commandVariable, ...). */
const allowedDynamicInvokeSites = new Set([
  "src/components/CopyProgressModal.tsx",
]);

/** Command names passed into CopyProgressModal's dynamic invoke. */
const frozenDynamicCopyCommands = [
  "copy_project_with_progress",
  "copy_set",
  "move_project_with_progress",
  "move_set_with_progress",
];

/**
 * Blank out line and block comments while preserving string literal contents and
 * line structure, so English "invoke (...)" in comments is not treated as a call.
 */
function blankComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "/") {
      out += "  ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
      const quote = source[i];
      out += quote;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function skipBalancedTypeArgs(source, index) {
  if (source[index] !== "<") return index;
  let depth = 0;
  for (let j = index; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === "<") {
      depth += 1;
    } else if (ch === ">") {
      depth -= 1;
      if (depth === 0) return j + 1;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      j += 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
    }
  }
  return index;
}

/** Extract invoke() call first-arguments from a TS/JS source file. */
function extractInvokeCalls(source) {
  const text = blankComments(source);
  const calls = [];
  const re = /\binvoke\b/g;
  let match;
  while ((match = re.exec(text))) {
    let i = match.index + match[0].length;
    while (/\s/.test(text[i] ?? "")) i += 1;
    i = skipBalancedTypeArgs(text, i);
    while (/\s/.test(text[i] ?? "")) i += 1;
    if (text[i] !== "(") continue;
    i += 1;
    while (/\s/.test(text[i] ?? "")) i += 1;
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      let literal = "";
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") {
          literal += text[i + 1] ?? "";
          i += 2;
          continue;
        }
        literal += text[i];
        i += 1;
      }
      calls.push({ kind: "literal", value: literal });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch ?? "")) {
      let identifier = "";
      while (/[\w$]/.test(text[i] ?? "")) {
        identifier += text[i];
        i += 1;
      }
      calls.push({ kind: "dynamic", value: identifier });
      continue;
    }
    calls.push({ kind: "other", value: (text.slice(i, i + 24) || "<eof>").trim() });
  }
  return calls;
}

const srcRoot = path.join(repositoryRoot, "src");
const actualInvokeCommandsByFile = new Map();
const dynamicInvokeFindings = [];

for (const filePath of walkFiles(srcRoot, (_full, name) =>
  /\.(tsx?|jsx?)$/.test(name),
)) {
  const relative = path
    .relative(repositoryRoot, filePath)
    .split(path.sep)
    .join("/");
  if (relative.startsWith("src/api/")) {
    // Central IPC client and api modules may import/call invoke.
    continue;
  }

  const contents = readFileSync(filePath, "utf8");
  const calls = extractInvokeCalls(contents);
  const literals = new Set();
  for (const call of calls) {
    if (call.kind === "literal") {
      literals.add(call.value);
      continue;
    }
    if (
      call.kind === "dynamic" &&
      allowedDynamicInvokeSites.has(relative) &&
      call.value === "command"
    ) {
      continue;
    }
    dynamicInvokeFindings.push(
      `${relative} (invoke(${call.kind === "dynamic" ? call.value : call.value}, ...))`,
    );
  }
  if (literals.size > 0) {
    actualInvokeCommandsByFile.set(relative, [...literals].sort());
  }
}

if (dynamicInvokeFindings.length > 0) {
  fail(
    "dynamic invoke() outside the CopyProgressModal command prop is forbidden; found: " +
      [...new Set(dynamicInvokeFindings)].sort().join(", "),
  );
}

const frozenFiles = Object.keys(frozenLegacyInvokeCommandsByFile).sort();
const actualFiles = [...actualInvokeCommandsByFile.keys()].sort();
for (const relative of actualFiles) {
  if (!Object.prototype.hasOwnProperty.call(frozenLegacyInvokeCommandsByFile, relative)) {
    fail(
      `new direct invoke() outside src/api is forbidden; found commands in: ${relative} ` +
        `(${actualInvokeCommandsByFile.get(relative).join(", ")})`,
    );
    continue;
  }
  const expected = [...frozenLegacyInvokeCommandsByFile[relative]].sort();
  const actual = actualInvokeCommandsByFile.get(relative);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));
    if (added.length > 0) {
      fail(
        `${relative} gained new invoke() commands (update SEC-1 freeze intentionally): ` +
          added.join(", "),
      );
    }
    if (removed.length > 0) {
      fail(
        `${relative} lost invoke() commands (update SEC-1 freeze intentionally): ` +
          removed.join(", "),
      );
    }
  }
}
for (const relative of frozenFiles) {
  if (!actualInvokeCommandsByFile.has(relative)) {
    fail(
      `SEC-1 invoke freeze expects commands in missing/empty file: ${relative}`,
    );
  }
  try {
    statSync(path.join(repositoryRoot, relative));
  } catch {
    fail(`SEC-1 invoke freeze references missing file: ${relative}`);
  }
}

// Freeze command names passed into CopyProgressModal's dynamic invoke(command, ...).
const copyProgressCommandLiterals = new Set();
const copyCommandProp =
  /\bcommand\s*:\s*['"]([a-z0-9_]+)['"]/g;
for (const filePath of walkFiles(srcRoot, (_full, name) =>
  /\.(tsx?|jsx?)$/.test(name),
)) {
  const relative = path
    .relative(repositoryRoot, filePath)
    .split(path.sep)
    .join("/");
  if (relative.startsWith("src/api/")) continue;
  const contents = readFileSync(filePath, "utf8");
  if (
    !contents.includes("CopyProgressModal") &&
    !contents.includes("copyProgress")
  ) {
    continue;
  }
  let match;
  const re = new RegExp(copyCommandProp.source, "g");
  while ((match = re.exec(contents))) {
    copyProgressCommandLiterals.add(match[1]);
  }
}
const actualDynamicSorted = [...copyProgressCommandLiterals].sort();
const expectedDynamicSorted = [...frozenDynamicCopyCommands].sort();
if (JSON.stringify(actualDynamicSorted) !== JSON.stringify(expectedDynamicSorted)) {
  const added = actualDynamicSorted.filter(
    (name) => !expectedDynamicSorted.includes(name),
  );
  const removed = expectedDynamicSorted.filter(
    (name) => !actualDynamicSorted.includes(name),
  );
  if (added.length > 0) {
    fail(
      "CopyProgressModal dynamic command surface grew unexpectedly: " +
        added.join(", "),
    );
  }
  if (removed.length > 0) {
    fail(
      "CopyProgressModal dynamic command surface lost entries (update SEC-1 freeze intentionally): " +
        removed.join(", "),
    );
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
