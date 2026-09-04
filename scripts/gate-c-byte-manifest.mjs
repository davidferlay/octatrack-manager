#!/usr/bin/env node
/**
 * Deterministic pre/post per-file byte manifest for Human Gate C.
 *
 * Content hashes are SHA-256 of file bytes. Catalog hash reuse is never used.
 * Generated manifests may contain personal sample names; keep them outside the
 * repository and do not commit them.
 */
import { createHash } from "node:crypto";
import {
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  closeSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST_SCHEMA = "masterocta-gate-c-byte-manifest:v1";
export const EXCLUSION_POLICY = "host-metadata-allowlist:v1";
export const EXPECTED_SCHEMA = "masterocta-gate-c-expected-changes:v1";
export const COMPARE_SCHEMA = "masterocta-gate-c-byte-manifest-compare:v1";
export const EXCLUSION_POLICY_NAMES = [
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".DS_Store",
  "._*",
];

const HASH_PREFIX = "sha256:";
const PARTIAL_SUFFIX = ".partial";

export class ManifestStop extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManifestStop";
    this.code = code;
  }
}

export function isIgnoredHostMetadata(name) {
  return (
    name === ".Spotlight-V100" ||
    name === ".Trashes" ||
    name === ".fseventsd" ||
    name === ".DS_Store" ||
    name.startsWith("._")
  );
}

export function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function posixRelative(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ManifestStop(
      "PATH_ESCAPE",
      "captured path left the clone root",
    );
  }
  return relative.split(path.sep).join("/");
}

function fileTypeKind(stats) {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSocket()) return "socket";
  if (stats.isFIFO()) return "fifo";
  if (stats.isCharacterDevice() || stats.isBlockDevice()) return "device";
  return "unknown";
}

function assertAllowedKind(kind, relativePath) {
  if (kind === "file" || kind === "directory") {
    return;
  }
  throw new ManifestStop(
    "FORBIDDEN_ENTRY_TYPE",
    `forbidden entry type ${kind} at ${JSON.stringify(relativePath)}`,
  );
}

function openRegularFileNofollow(absolutePath) {
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW === undefined ? 0 : constants.O_NOFOLLOW);
  try {
    return openSync(absolutePath, flags);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not open ${JSON.stringify(absolutePath)}: ${error.code ?? error.message}`,
    );
  }
}

function hashRegularFile(absolutePath, expectedSize) {
  const before = lstatSync(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new ManifestStop(
      "FORBIDDEN_ENTRY_TYPE",
      "path is no longer a regular file",
    );
  }
  if (before.size !== expectedSize) {
    throw new ManifestStop(
      "CHANGED_DURING_CAPTURE",
      "file size changed before hashing",
    );
  }
  const fd = openRegularFileNofollow(absolutePath);
  const hasher = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) {
        break;
      }
      total += read;
      hasher.update(buffer.subarray(0, read));
    }
    if (total !== expectedSize) {
      throw new ManifestStop(
        "CHANGED_DURING_CAPTURE",
        "file size changed while hashing",
      );
    }
  } finally {
    closeSync(fd);
  }
  const after = lstatSync(absolutePath);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.size !== expectedSize ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw new ManifestStop(
      "CHANGED_DURING_CAPTURE",
      "file changed while hashing",
    );
  }
  return HASH_PREFIX + hasher.digest("hex");
}

function fileEntry(relativePath, stats, absolutePath) {
  return {
    relative_path: relativePath,
    entry_type: "file",
    byte_size: stats.size,
    sha256: hashRegularFile(absolutePath, stats.size),
  };
}

function directoryEntry(relativePath) {
  return {
    relative_path: relativePath,
    entry_type: "directory",
  };
}

export function decodeUtf8EntryName(name) {
  if (typeof name === "string") {
    if (Buffer.from(name, "utf8").toString("utf8") !== name) {
      throw new ManifestStop(
        "NON_UTF8_NAME",
        "directory contains a non-UTF-8 name",
      );
    }
    return name;
  }
  if (!Buffer.isBuffer(name)) {
    throw new ManifestStop(
      "NON_UTF8_NAME",
      "directory contains a non-UTF-8 name",
    );
  }
  const decoded = name.toString("utf8");
  if (Buffer.from(decoded, "utf8").compare(name) !== 0) {
    throw new ManifestStop(
      "NON_UTF8_NAME",
      "directory contains a non-UTF-8 name",
    );
  }
  return decoded;
}

function sortedDirentNames(directory) {
  let dirents;
  try {
    dirents = readdirSync(directory, { withFileTypes: true, encoding: "buffer" });
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not read directory ${JSON.stringify(directory)}: ${error.code ?? error.message}`,
    );
  }
  const names = [];
  for (const dirent of dirents) {
    names.push(decodeUtf8EntryName(dirent.name));
  }
  return names.sort(compareUtf8);
}

function walk(root, current, entries, excludedCount) {
  let stats;
  try {
    stats = lstatSync(current);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not stat ${JSON.stringify(current)}: ${error.code ?? error.message}`,
    );
  }
  const kind = fileTypeKind(stats);
  const relativePath = current === root ? "" : posixRelative(root, current);
  if (current !== root) {
    assertAllowedKind(kind, relativePath);
    if (kind === "directory") {
      entries.push(directoryEntry(relativePath));
    } else {
      entries.push(fileEntry(relativePath, stats, current));
    }
  } else if (kind !== "directory" || stats.isSymbolicLink()) {
    throw new ManifestStop(
      "INVALID_ROOT",
      "clone root must be a real directory",
    );
  }

  if (kind !== "directory") {
    return excludedCount;
  }

  for (const name of sortedDirentNames(current)) {
    if (isIgnoredHostMetadata(name)) {
      excludedCount += 1;
      continue;
    }
    excludedCount = walk(root, path.join(current, name), entries, excludedCount);
  }
  return excludedCount;
}

export function captureRoot(rootPath) {
  const root = path.resolve(rootPath);
  let rootStats;
  try {
    rootStats = lstatSync(root);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not stat clone root: ${error.code ?? error.message}`,
    );
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new ManifestStop(
      "INVALID_ROOT",
      "clone root must be a real directory, not a symlink",
    );
  }
  const entries = [];
  const excludedEntryCount = walk(root, root, entries, 0);
  entries.sort((left, right) =>
    compareUtf8(left.relative_path, right.relative_path),
  );
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.relative_path)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `duplicate relative path ${JSON.stringify(entry.relative_path)}`,
      );
    }
    seen.add(entry.relative_path);
  }
  return {
    schema: MANIFEST_SCHEMA,
    exclusion_policy: EXCLUSION_POLICY,
    exclusion_policy_names: [...EXCLUSION_POLICY_NAMES],
    excluded_entry_count: excludedEntryCount,
    entry_count: entries.length,
    entries,
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeManifestAtomic(outputPath, manifest) {
  const destination = path.resolve(outputPath);
  const directory = path.dirname(destination);
  mkdirSync(directory, { recursive: true });
  const partial = destination + PARTIAL_SUFFIX;
  try {
    writeFileSync(partial, serializeManifest(manifest), { flag: "w" });
    renameSync(partial, destination);
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // Ignore cleanup failure; the completed destination must not be a partial.
    }
    if (error instanceof ManifestStop) {
      throw error;
    }
    throw new ManifestStop(
      "WRITE_FAILED",
      `could not write manifest: ${error.code ?? error.message}`,
    );
  }
}

export function captureToFile(rootPath, outputPath) {
  const root = path.resolve(rootPath);
  const destination = path.resolve(outputPath);
  const relativeToRoot = path.relative(root, destination);
  const insideRoot =
    relativeToRoot === "" ||
    (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot));
  if (insideRoot) {
    throw new ManifestStop(
      "OUTPUT_INSIDE_ROOT",
      "write the manifest outside the clone root",
    );
  }
  const manifest = captureRoot(root);
  writeManifestAtomic(destination, manifest);
  return manifest;
}

function requireObject(value, code, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ManifestStop(code, message);
  }
  return value;
}

export function parseManifest(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestStop("MALFORMED_MANIFEST", `${label} is not valid JSON`);
  }
  const manifest = requireObject(
    parsed,
    "MALFORMED_MANIFEST",
    `${label} is not an object`,
  );
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new ManifestStop(
      "SCHEMA_MISMATCH",
      `${label} schema is ${JSON.stringify(manifest.schema)}`,
    );
  }
  if (manifest.exclusion_policy !== EXCLUSION_POLICY) {
    throw new ManifestStop(
      "EXCLUSION_POLICY_MISMATCH",
      `${label} exclusion policy is ${JSON.stringify(manifest.exclusion_policy)}`,
    );
  }
  if (!Array.isArray(manifest.entries)) {
    throw new ManifestStop("MALFORMED_MANIFEST", `${label} entries are missing`);
  }
  const seen = new Set();
  const entries = [];
  for (const entry of manifest.entries) {
    const item = requireObject(
      entry,
      "MALFORMED_MANIFEST",
      `${label} contains a malformed entry`,
    );
    if (typeof item.relative_path !== "string" || item.relative_path === "") {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} contains an entry without a relative path`,
      );
    }
    if (seen.has(item.relative_path)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `${label} duplicates ${JSON.stringify(item.relative_path)}`,
      );
    }
    seen.add(item.relative_path);
    if (item.entry_type === "file") {
      if (
        typeof item.byte_size !== "number" ||
        typeof item.sha256 !== "string" ||
        !item.sha256.startsWith(HASH_PREFIX)
      ) {
        throw new ManifestStop(
          "MALFORMED_MANIFEST",
          `${label} file entry ${JSON.stringify(item.relative_path)} is malformed`,
        );
      }
    } else if (item.entry_type !== "directory") {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} has unsupported entry type ${JSON.stringify(item.entry_type)}`,
      );
    }
    entries.push(item);
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (compareUtf8(entries[index - 1].relative_path, entries[index].relative_path) > 0) {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} entries are not in deterministic path order`,
      );
    }
  }
  return {
    ...manifest,
    entries,
  };
}

export function loadManifestFile(filePath, label) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not read ${label}: ${error.code ?? error.message}`,
    );
  }
  return parseManifest(raw, label);
}

function entryIdentity(entry) {
  if (entry.entry_type === "directory") {
    return { entry_type: "directory" };
  }
  return {
    entry_type: "file",
    byte_size: entry.byte_size,
    sha256: entry.sha256,
  };
}

function identitiesEqual(left, right) {
  return (
    left.entry_type === right.entry_type &&
    left.byte_size === right.byte_size &&
    left.sha256 === right.sha256
  );
}

export function diffManifests(pre, post) {
  const preByPath = new Map(pre.entries.map((entry) => [entry.relative_path, entry]));
  const postByPath = new Map(post.entries.map((entry) => [entry.relative_path, entry]));
  const paths = [
    ...new Set([...preByPath.keys(), ...postByPath.keys()]),
  ].sort(compareUtf8);
  const diffs = [];
  let unchangedCount = 0;
  for (const relativePath of paths) {
    const before = preByPath.get(relativePath);
    const after = postByPath.get(relativePath);
    if (before && after) {
      if (before.entry_type !== after.entry_type) {
        diffs.push({
          class: "type_changed",
          relative_path: relativePath,
          pre: before,
          post: after,
        });
      } else if (!identitiesEqual(entryIdentity(before), entryIdentity(after))) {
        diffs.push({
          class: "content_changed",
          relative_path: relativePath,
          pre: before,
          post: after,
        });
      } else {
        unchangedCount += 1;
      }
    } else if (before && !after) {
      diffs.push({
        class: "removed",
        relative_path: relativePath,
        pre: before,
        post: null,
      });
    } else {
      diffs.push({
        class: "added",
        relative_path: relativePath,
        pre: null,
        post: after,
      });
    }
  }
  return { diffs, unchangedCount };
}

export function parseExpectedChanges(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestStop("MALFORMED_EXPECTED", `${label} is not valid JSON`);
  }
  const expected = requireObject(
    parsed,
    "MALFORMED_EXPECTED",
    `${label} is not an object`,
  );
  if (expected.schema !== EXPECTED_SCHEMA) {
    throw new ManifestStop(
      "SCHEMA_MISMATCH",
      `${label} schema is ${JSON.stringify(expected.schema)}`,
    );
  }
  if (!Array.isArray(expected.changes)) {
    throw new ManifestStop("MALFORMED_EXPECTED", `${label} changes are missing`);
  }
  const changes = [];
  const seen = new Set();
  for (const change of expected.changes) {
    const item = requireObject(
      change,
      "MALFORMED_EXPECTED",
      `${label} contains a malformed change`,
    );
    const key = `${item.op}:${item.relative_path}`;
    if (
      typeof item.op !== "string" ||
      typeof item.relative_path !== "string" ||
      item.relative_path === ""
    ) {
      throw new ManifestStop("MALFORMED_EXPECTED", `${label} has an invalid change`);
    }
    if (seen.has(key)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `${label} duplicates ${JSON.stringify(key)}`,
      );
    }
    seen.add(key);
    if (
      (item.op === "added" || item.op === "content_changed") &&
      (typeof item.sha256 !== "string" || item.sha256 === "")
    ) {
      throw new ManifestStop(
        "INCOMPLETE_EXPECTED",
        `expected ${item.op} ${JSON.stringify(item.relative_path)} is missing sha256`,
      );
    }
    changes.push(item);
  }
  return { ...expected, changes };
}

function expectedMatchesDiff(expected, diff) {
  if (expected.relative_path !== diff.relative_path) {
    return false;
  }
  if (expected.op !== diff.class) {
    return false;
  }
  if (expected.op === "removed") {
    return (
      diff.pre !== null &&
      (expected.entry_type === undefined ||
        expected.entry_type === diff.pre.entry_type) &&
      (expected.sha256 === undefined || expected.sha256 === diff.pre.sha256)
    );
  }
  if (expected.op === "added") {
    return (
      diff.post !== null &&
      diff.post.entry_type === (expected.entry_type ?? "file") &&
      (expected.byte_size === undefined ||
        expected.byte_size === diff.post.byte_size) &&
      expected.sha256 === diff.post.sha256
    );
  }
  if (expected.op === "content_changed") {
    return (
      diff.pre !== null &&
      diff.post !== null &&
      diff.post.entry_type === (expected.entry_type ?? "file") &&
      expected.sha256 === diff.post.sha256 &&
      (expected.byte_size === undefined ||
        expected.byte_size === diff.post.byte_size)
    );
  }
  if (expected.op === "type_changed") {
    return diff.pre !== null && diff.post !== null;
  }
  return false;
}

export function compareManifests(pre, post, expected) {
  if (pre.schema !== post.schema) {
    return stopReport(pre, post, "SCHEMA_MISMATCH", "manifest schema mismatch", []);
  }
  if (pre.exclusion_policy !== post.exclusion_policy) {
    return stopReport(
      pre,
      post,
      "EXCLUSION_POLICY_MISMATCH",
      "exclusion policy mismatch",
      [],
    );
  }
  const { diffs, unchangedCount } = diffManifests(pre, post);
  if (!expected) {
    const unexplained = diffs.length > 0;
    return {
      schema: COMPARE_SCHEMA,
      verdict: unexplained ? "STOP" : "PASS",
      stop_reason: unexplained
        ? "NO_EXPECTED_CHANGES: all diffs must be matched to plan evidence"
        : null,
      pre_entry_count: pre.entry_count,
      post_entry_count: post.entry_count,
      unchanged_count: unchangedCount,
      unrelated_entries_unchanged: diffs.length === 0,
      diffs,
      unmatched_expected: [],
    };
  }
  const remaining = [...diffs];
  const unmatchedExpected = [];
  const matched = [];
  for (const change of expected.changes) {
    const index = remaining.findIndex((diff) => expectedMatchesDiff(change, diff));
    if (index === -1) {
      unmatchedExpected.push(change);
    } else {
      matched.push({ ...remaining[index], expected: true });
      remaining.splice(index, 1);
    }
  }
  const unexplained = remaining.map((diff) => ({ ...diff, expected: false }));
  const missing = unmatchedExpected.length > 0;
  const extra = unexplained.length > 0;
  let stopReason = null;
  if (missing && extra) {
    stopReason = "EXPECTED_MISMATCH: missing expected changes and unexplained diffs";
  } else if (missing) {
    stopReason = "EXPECTED_MISSING: an expected change did not occur";
  } else if (extra) {
    stopReason = "UNEXPECTED_DIFF: unexplained add/remove/modify/type change";
  }
  return {
    schema: COMPARE_SCHEMA,
    verdict: stopReason ? "STOP" : "PASS",
    stop_reason: stopReason,
    pre_entry_count: pre.entry_count,
    post_entry_count: post.entry_count,
    unchanged_count: unchangedCount,
    unrelated_entries_unchanged: unexplained.length === 0 && !missing,
    diffs: [...matched, ...unexplained],
    unmatched_expected: unmatchedExpected,
  };
}

function stopReport(pre, post, code, message, diffs) {
  return {
    schema: COMPARE_SCHEMA,
    verdict: "STOP",
    stop_reason: `${code}: ${message}`,
    pre_entry_count: pre.entry_count,
    post_entry_count: post.entry_count,
    unchanged_count: 0,
    unrelated_entries_unchanged: false,
    diffs,
    unmatched_expected: [],
  };
}

function assertContainedRelativePath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "") {
    throw new ManifestStop(
      "INVALID_PATH",
      `${label} is missing a relative path`,
    );
  }
  if (path.isAbsolute(relativePath)) {
    throw new ManifestStop(
      "PATH_ESCAPE",
      `${label} must be a root-relative path`,
    );
  }
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ManifestStop(
        "PATH_ESCAPE",
        `${label} must stay inside the clone root`,
      );
    }
  }
}

function appendExpectedChange(changes, seenPaths, change) {
  assertContainedRelativePath(change.relative_path, "expected change path");
  if (seenPaths.has(change.relative_path)) {
    throw new ManifestStop(
      "DUPLICATE_PATH",
      `expected changes duplicate ${JSON.stringify(change.relative_path)}`,
    );
  }
  seenPaths.add(change.relative_path);
  changes.push(change);
}

export function expectedFromPreparedPlan(plan) {
  const payload = plan.plan ?? plan;
  const sourcePath = payload.source_relative_path ?? payload.sourceRelativePath;
  const destinationPath =
    payload.destination_relative_path ?? payload.destinationRelativePath;
  const sourceHash = payload.source_content_hash ?? payload.sourceContentHash;
  const sourceSize = payload.source_byte_size ?? payload.sourceByteSize;
  if (
    typeof sourcePath !== "string" ||
    typeof destinationPath !== "string" ||
    typeof sourceHash !== "string"
  ) {
    throw new ManifestStop(
      "INCOMPLETE_EXPECTED",
      "prepared plan is missing source/destination path or source content hash",
    );
  }
  const changes = [];
  const seenPaths = new Set();
  appendExpectedChange(changes, seenPaths, {
    op: "removed",
    relative_path: sourcePath,
    entry_type: "file",
    sha256: sourceHash,
  });
  appendExpectedChange(changes, seenPaths, {
    op: "added",
    relative_path: destinationPath,
    entry_type: "file",
    byte_size: sourceSize,
    sha256: sourceHash,
  });
  const sidecarImpacts = payload.sidecar_impacts ?? payload.sidecarImpacts ?? [];
  for (const impact of sidecarImpacts) {
    const sourceSidecar =
      impact.source_sidecar_relative_path ?? impact.sourceSidecarRelativePath;
    const destSidecar =
      impact.destination_sidecar_relative_path ??
      impact.destinationSidecarRelativePath;
    const sidecarHash = impact.content_hash ?? impact.contentHash;
    const sidecarSize = impact.byte_size ?? impact.byteSize;
    if (
      typeof sourceSidecar !== "string" ||
      typeof destSidecar !== "string" ||
      typeof sidecarHash !== "string"
    ) {
      throw new ManifestStop(
        "INCOMPLETE_EXPECTED",
        "sidecar impact is missing paths or content hash",
      );
    }
    appendExpectedChange(changes, seenPaths, {
      op: "removed",
      relative_path: sourceSidecar,
      entry_type: "file",
      sha256: sidecarHash,
    });
    appendExpectedChange(changes, seenPaths, {
      op: "added",
      relative_path: destSidecar,
      entry_type: "file",
      byte_size: sidecarSize,
      sha256: sidecarHash,
    });
  }
  const documents =
    payload.state_document_impacts ?? payload.stateDocumentImpacts ?? [];
  const incompleteProjects = [];
  for (const document of documents) {
    const relativePath = document.relative_path ?? document.relativePath;
    if (typeof relativePath !== "string" || relativePath === "") {
      throw new ManifestStop(
        "INCOMPLETE_EXPECTED",
        "state document impact is missing a relative path",
      );
    }
    assertContainedRelativePath(relativePath, "state document impact path");
    const updates = document.reference_updates ?? document.referenceUpdates ?? [];
    if (!Array.isArray(updates) || updates.length === 0) {
      continue;
    }
    incompleteProjects.push(relativePath);
  }
  return {
    schema: EXPECTED_SCHEMA,
    changes,
    incomplete_project_post_hashes: incompleteProjects,
  };
}

export function formatSummary(report) {
  const lines = [
    `verdict: ${report.verdict}`,
    `unchanged: ${report.unchanged_count}`,
    `diffs: ${report.diffs.length}`,
    `unrelated_entries_unchanged: ${report.unrelated_entries_unchanged}`,
  ];
  if (report.stop_reason) {
    lines.push(`stop_reason: ${report.stop_reason}`);
  }
  for (const diff of report.diffs) {
    lines.push(
      `${diff.class}${diff.expected ? " (expected)" : ""} ${JSON.stringify(diff.relative_path)}`,
    );
  }
  for (const change of report.unmatched_expected ?? []) {
    lines.push(
      `missing expected ${change.op} ${JSON.stringify(change.relative_path)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage:
  node scripts/gate-c-byte-manifest.mjs capture --root <clone-root> --output <manifest.json>
  node scripts/gate-c-byte-manifest.mjs compare --pre <pre.json> --post <post.json> [--expected <expected.json>] [--report <report.json>]
  node scripts/gate-c-byte-manifest.mjs expected-from-prepared --plan <prepared-plan.json> --output <expected.json>

Keep generated manifests outside the repository. They may contain personal sample names.
Do not commit capture output.
`;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new ManifestStop("USAGE", `missing value for ${name}`);
  }
  return value;
}

function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];
  if (command === "capture") {
    const root = takeOption(args, "--root");
    const output = takeOption(args, "--output");
    if (!root || !output) {
      throw new ManifestStop("USAGE", usage());
    }
    const manifest = captureToFile(root, output);
    process.stdout.write(
      `captured entries=${manifest.entry_count} excluded=${manifest.excluded_entry_count} output=${output}\n`,
    );
    process.stdout.write(
      "Store this file outside the repository. Do not commit it.\n",
    );
    return 0;
  }
  if (command === "compare") {
    const prePath = takeOption(args, "--pre");
    const postPath = takeOption(args, "--post");
    const expectedPath = takeOption(args, "--expected");
    const reportPath = takeOption(args, "--report");
    if (!prePath || !postPath) {
      throw new ManifestStop("USAGE", usage());
    }
    const pre = loadManifestFile(prePath, "pre-run manifest");
    const post = loadManifestFile(postPath, "post-run manifest");
    let expected = null;
    if (expectedPath) {
      expected = parseExpectedChanges(
        readFileSync(expectedPath, "utf8"),
        "expected changes",
      );
    }
    const report = compareManifests(pre, post, expected);
    process.stdout.write(formatSummary(report));
    if (reportPath) {
      writeManifestAtomic(reportPath, report);
    }
    return report.verdict === "PASS" ? 0 : 2;
  }
  if (command === "expected-from-prepared") {
    const planPath = takeOption(args, "--plan");
    const output = takeOption(args, "--output");
    if (!planPath || !output) {
      throw new ManifestStop("USAGE", usage());
    }
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const expected = expectedFromPreparedPlan(plan);
    writeManifestAtomic(output, {
      schema: expected.schema,
      changes: expected.changes,
    });
    if (expected.incomplete_project_post_hashes.length > 0) {
      process.stderr.write(
        `STOP INCOMPLETE_EXPECTED: rewritten project post-write SHA256 is not in the prepared plan and was not invented: ${expected.incomplete_project_post_hashes.join(", ")}\n`,
      );
      process.stderr.write(
        "Audio/sidecar expected changes were written. Fill project content_changed hashes from apply-time rewrite evidence before compare can PASS.\n",
      );
      return 1;
    }
    process.stdout.write(`wrote expected changes to ${output}\n`);
    return 0;
  }
  throw new ManifestStop("USAGE", usage());
}

const invokedAsCli =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  try {
    process.exitCode = runCli(process.argv);
  } catch (error) {
    const code = error instanceof ManifestStop ? error.code : "ERROR";
    process.stderr.write(`STOP ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { runCli };
