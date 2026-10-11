#!/usr/bin/env node
/**
 * Read-only receptacle for cross-bank Pattern Copy/Paste on P_BANK_PERSIST.
 *
 * Originally scaffolded as MO-PSE-BANK-COPY-PERSISTENCE-1. Scope corrected
 * before device-evidence promotion: the observed Octatrack operation is
 * Pattern A01 Copy, Bank B / Pattern B01 select, then Pattern Paste.
 * This is not Bank Copy semantics.
 *
 * status / analyze / verify-manifest do not write bank bytes.
 * write-manifest writes SHA256SUMS.json only. Does not encode banks or Apply.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_OFFSET } from "./pse-bank-identity-device.mjs";

export const META_SCHEMA = "masterocta.pse-pattern-paste-persistence-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-pattern-paste-persistence-manifest:v1";
export const WORK_ID = "MO-PSE-CROSS-BANK-PATTERN-PASTE-PERSISTENCE-1";
export const LEGACY_WORK_ID = "MO-PSE-BANK-COPY-PERSISTENCE-1";
export const OPERATION_KIND = "CROSS_BANK_PATTERN_COPY_PASTE";
export const RETIRED_CAPTURE_NAMES = ["s1_after_copy", "s2_after_destination_switch"];
export const RETIRED_TRANSITIONS = ["COPY", "DESTINATION_SWITCH"];

const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const META_CAP_BYTES = 256 * 1024;
const CAPTURE_NAME = /^[a-z0-9_]+$/;

export const REQUIRED_FILES = [
  "capture.meta.json",
  "project.work",
  "project.strd",
  "bank01.work",
  "bank01.strd",
  "bank02.work",
  "bank02.strd",
  "bank03.work",
  "bank03.strd",
  "bank04.work",
  "bank04.strd",
];

export const MATRIX_FILES = REQUIRED_FILES.filter((name) => name !== "capture.meta.json");

export const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_copy_persistence",
);

export const PLANNED_CAPTURES = [
  {
    name: "s0_baseline_saved",
    stage_id: "S0",
    stage_semantics: "BASELINE_SAVED",
    prior_transition: null,
  },
  {
    name: "s1_destination_selected_before_paste",
    stage_id: "S1",
    stage_semantics: "DESTINATION_SELECT_BEFORE_PASTE",
    prior_transition: "DESTINATION_SELECT_BEFORE_PASTE",
  },
  {
    name: "s2_after_pattern_paste",
    stage_id: "S2",
    stage_semantics: "PATTERN_PASTE",
    prior_transition: "PATTERN_PASTE",
  },
  {
    name: "s3_after_control_switch",
    stage_id: "S3",
    stage_semantics: "CONTROL_SWITCH",
    prior_transition: "CONTROL_SWITCH",
  },
  {
    name: "s4_after_project_save",
    stage_id: "S4",
    stage_semantics: "PROJECT_SAVE",
    prior_transition: "PROJECT_SAVE",
  },
  {
    name: "s5_after_project_reload",
    stage_id: "S5",
    stage_semantics: "PROJECT_RELOAD",
    prior_transition: "PROJECT_RELOAD",
  },
];

export const ADJACENT_TRANSITIONS = [
  {
    from: "s0_baseline_saved",
    to: "s1_destination_selected_before_paste",
    label: "DESTINATION_SELECT_BEFORE_PASTE",
  },
  {
    from: "s1_destination_selected_before_paste",
    to: "s2_after_pattern_paste",
    label: "PATTERN_PASTE",
  },
  {
    from: "s2_after_pattern_paste",
    to: "s3_after_control_switch",
    label: "CONTROL_SWITCH",
  },
  {
    from: "s3_after_control_switch",
    to: "s4_after_project_save",
    label: "PROJECT_SAVE",
  },
  {
    from: "s4_after_project_save",
    to: "s5_after_project_reload",
    label: "PROJECT_RELOAD",
  },
];

const STAGE_PRODUCED_BY = {
  S1: "DESTINATION_SELECT_BEFORE_PASTE",
  S2: "PATTERN_PASTE",
  S3: "CONTROL_SWITCH",
  S4: "PROJECT_SAVE",
  S5: "PROJECT_RELOAD",
};

const DEST_BANK = "bank02";

export function plannedCapture(captureName) {
  return PLANNED_CAPTURES.find((entry) => entry.name === captureName) ?? null;
}

export function parsePersistenceStatesSection(text) {
  const lines = text.split(/\n/).map((line) => line.replace(/\r$/, ""));
  const starts = lines
    .map((line, index) => (line.trim() === "[STATES]" ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return { ok: false, bank: null, pattern: null };
  let bankCount = 0;
  let patternCount = 0;
  let bank = null;
  let pattern = null;
  let closed = false;
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "[/STATES]") {
      closed = true;
      break;
    }
    const bankMatch = line.match(/^BANK=([0-9]+)$/);
    if (bankMatch) {
      bankCount += 1;
      bank = Number(bankMatch[1]);
      continue;
    }
    const patternMatch = line.match(/^PATTERN=([0-9]+)$/);
    if (patternMatch) {
      patternCount += 1;
      pattern = Number(patternMatch[1]);
    }
  }
  if (!closed || bankCount !== 1 || patternCount !== 1 || bank > 15 || pattern > 15) {
    return { ok: false, bank: null, pattern: null };
  }
  return { ok: true, bank, pattern };
}

export function assertPlannedCaptureName(captureName) {
  if (RETIRED_CAPTURE_NAMES.includes(captureName) || RETIRED_TRANSITIONS.includes(captureName)) {
    throw new Error(`Retired capture ordering is rejected: ${captureName}`);
  }
  if (!plannedCapture(captureName)) {
    throw new Error(`Not a planned capture: ${captureName}`);
  }
}

export function metaTemplate(planned) {
  return {
    schema: META_SCHEMA,
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
    operation_kind: OPERATION_KIND,
    stage_id: planned.stage_id,
    stage_semantics: planned.stage_semantics,
    prior_transition: planned.prior_transition,
    project_name: "P_BANK_PERSIST",
    device: "Octatrack MkII",
    os_version: "",
    device_generated: false,
    synthetic_modification: false,
    capture_sequence_proven: null,
    role_source_bank_ui: "A",
    role_destination_bank_ui: "B",
    role_untouched_bank_ui: "C",
    role_control_bank_ui: "D",
    source_pattern_ui: "A01",
    destination_pattern_ui: "B01",
    source_pattern_copy_to_clipboard_performed: null,
    source_sentinel_present_a: null,
    dest_sentinel_present_b: null,
    destination_ui_sentinel: null,
    destination_ui_sentinel_after_reload: null,
    save_operation: "",
    copy_confirmation: "",
    project_reloaded: null,
    capture_transport: "unknown",
    capture_required_mode_change: "unknown",
    capture_may_flush_device_state: "unknown",
    capture_date: "",
    operator_note:
      "TEMPLATE. Pattern A01 Copy, then Bank B / Pattern B01 select, then Pattern Paste. Not Bank Copy. Keep device_generated false until sequence provenance, OS, sentinels, and transport are recorded.",
  };
}

export function assertCanonicalFixtureRoot(root = FIXTURE_ROOT) {
  const rootResolved = path.resolve(root);
  let st;
  try {
    st = lstatSync(rootResolved);
  } catch (err) {
    if (err && err.code === "ENOENT") throw new Error("Fixture root does not exist");
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error("Symlink not allowed for fixture root");
  const parent = path.dirname(rootResolved);
  if (parent !== rootResolved && lstatSync(parent).isSymbolicLink()) {
    throw new Error("Symlink not allowed in fixture root parent");
  }
  return rootResolved;
}

export function resolveCaptureDir(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  if (!CAPTURE_NAME.test(captureName)) {
    throw new Error(`Invalid capture name (use [a-z0-9_]+): ${captureName}`);
  }
  const rootResolved = assertCanonicalFixtureRoot(root);
  const captureDir = path.resolve(rootResolved, captureName);
  const rel = path.relative(rootResolved, captureDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Capture path escapes fixture root: ${captureName}`);
  }
  let st;
  try {
    st = lstatSync(captureDir);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return captureDir;
  }
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed for capture directory: ${captureName}`);
  if (!st.isDirectory()) throw new Error(`Capture path is not a directory: ${captureName}`);
  const canonicalRel = path.relative(realpathSync(rootResolved), realpathSync(captureDir));
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new Error(`Capture path escapes fixture root: ${captureName}`);
  }
  return captureDir;
}

function assertRegularFile(filePath, label) {
  let st;
  try {
    st = lstatSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed in capture: ${label}`);
  if (!st.isFile()) throw new Error(`Not a regular file: ${label}`);
  return st;
}

function readMeta(captureDir) {
  const metaPath = path.join(captureDir, "capture.meta.json");
  const st = assertRegularFile(metaPath, "capture.meta.json");
  if (!st) throw Object.assign(new Error("capture.meta.json is missing"), { code: "ENOENT" });
  if (st.size > META_CAP_BYTES) throw new Error("capture.meta.json exceeds its size cap");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.synthetic_modification !== false) {
    throw new Error("synthetic_modification capture is not evidence");
  }
  return meta;
}

function provenanceReady(meta, planned, captureDir) {
  if (meta.device_generated !== true) return false;
  if (meta.schema !== META_SCHEMA) throw new Error("capture schema is not the pattern-paste schema");
  if (meta.operation_kind !== OPERATION_KIND) throw new Error("operation_kind is not cross-bank pattern paste");
  if (meta.capture_sequence_proven !== true) throw new Error("capture sequence is not proven");
  if (meta.work_id !== WORK_ID) throw new Error("capture provenance is incomplete");
  if (meta.stage_id !== planned.stage_id || meta.stage_semantics !== planned.stage_semantics) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.prior_transition !== planned.prior_transition) throw new Error("capture provenance is incomplete");
  // Require the structured operator record; neither labels nor byte deltas prove a save.
  if (planned.stage_id === "S4"
    && (typeof meta.save_operation !== "string" || meta.save_operation.trim() === "")) {
    throw new Error("S4 must record a non-empty save_operation");
  }
  if (RETIRED_TRANSITIONS.includes(meta.prior_transition)) {
    throw new Error("Retired capture ordering is rejected");
  }
  if (meta.device !== "Octatrack MkII" || meta.project_name !== "P_BANK_PERSIST") {
    throw new Error("capture provenance is incomplete");
  }
  if (
    meta.role_source_bank_ui !== "A"
    || meta.role_destination_bank_ui !== "B"
    || meta.role_untouched_bank_ui !== "C"
    || meta.role_control_bank_ui !== "D"
  ) {
    throw new Error("bank roles do not match the receptacle");
  }
  if (planned.stage_id === "S5") {
    if (meta.project_reloaded !== true) throw new Error("S5 must record project reload");
  } else if (meta.project_reloaded !== false) {
    throw new Error("S0-S4 must record project reload as not performed");
  }
  if (meta.source_pattern_ui !== "A01" || meta.destination_pattern_ui !== "B01") {
    throw new Error("pattern UI labels do not match the receptacle");
  }
  if (
    meta.source_pattern_copy_to_clipboard_performed !== true
    && meta.source_pattern_copy_to_clipboard_performed !== false
    && meta.source_pattern_copy_to_clipboard_performed !== null
  ) {
    throw new Error("capture provenance is incomplete");
  }
  if (planned.stage_id === "S0") {
    if (meta.source_pattern_copy_to_clipboard_performed !== false) {
      throw new Error("S0 must record clipboard copy as not yet performed");
    }
  } else if (meta.source_pattern_copy_to_clipboard_performed !== true) {
    throw new Error("S1-S5 must record clipboard copy as performed");
  }
  for (const key of ["os_version", "capture_date", "operator_note"]) {
    if (typeof meta[key] !== "string" || meta[key].trim() === "") {
      throw new Error("capture provenance is incomplete");
    }
  }
  for (const transportKey of [
    "capture_transport",
    "capture_required_mode_change",
    "capture_may_flush_device_state",
  ]) {
    if (typeof meta[transportKey] !== "string" || meta[transportKey].trim() === "") {
      throw new Error("capture provenance is incomplete");
    }
  }
  const projectPath = path.join(captureDir, "project.work");
  const projectStat = assertRegularFile(projectPath, "project.work");
  if (!projectStat) throw new Error("capture provenance is incomplete");
  if (projectStat.size > PROJECT_WORK_CAP_BYTES) {
    throw new Error("project.work exceeds 1 MiB");
  }
  const states = parsePersistenceStatesSection(readFileSync(projectPath, "latin1"));
  if (!states.ok) throw new Error("project.work [STATES] must contain one BANK and one PATTERN in 0..15");
  return true;
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function sizeCap(name) {
  if (name === "capture.meta.json" || name === "SHA256SUMS.json") return META_CAP_BYTES;
  if (name.startsWith("project.")) return PROJECT_WORK_CAP_BYTES;
  return BANK_FILE_CAP_BYTES;
}

export function buildManifest(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  const captureDir = resolveCaptureDir(captureName, root);
  const files = REQUIRED_FILES.flatMap((name) => {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) return [];
    if (st.size > sizeCap(name)) throw new Error(`${name} exceeds its size cap`);
    return [{ path: name, sha256: sha256File(full), size: st.size }];
  });
  return { schema: MANIFEST_SCHEMA, capture: captureName, files };
}

/** @type {((fd: number, data: string | Buffer) => void) | null} */
let manifestWriteImpl = null;

export function setManifestWriteImpl(fn) {
  manifestWriteImpl = fn;
}

export function writeRegularFileAtomic(filePath, contents) {
  const destination = path.resolve(filePath);
  let existing = null;
  try {
    existing = lstatSync(destination);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new Error("Refusing non-regular manifest destination: SHA256SUMS.json");
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial-${process.pid}`;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = openSync(partial, flags, 0o644);
    (manifestWriteImpl ?? writeFileSync)(fd, contents);
    closeSync(fd);
    fd = null;
    renameSync(partial, destination);
  } catch (err) {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failure during cleanup.
      }
    }
    try {
      unlinkSync(partial);
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }
}

export function writeManifest(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  assertCanonicalFixtureRoot(root);
  const captureDir = resolveCaptureDir(captureName, root);
  for (const name of REQUIRED_FILES) {
    const st = assertRegularFile(path.join(captureDir, name), name);
    if (!st) throw new Error(`write-manifest requires a regular ${name}`);
  }
  const manifest = buildManifest(captureName, root);
  writeRegularFileAtomic(
    path.join(captureDir, "SHA256SUMS.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function verifyManifest(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  const captureDir = resolveCaptureDir(captureName, root);
  const sidecar = path.join(captureDir, "SHA256SUMS.json");
  const st = assertRegularFile(sidecar, "SHA256SUMS.json");
  if (!st) throw new Error("SHA256SUMS.json is missing");
  if (st.size > META_CAP_BYTES) throw new Error("SHA256SUMS.json exceeds its size cap");
  const recorded = JSON.parse(readFileSync(sidecar, "utf8"));
  const fresh = buildManifest(captureName, root);
  const fileSetOk = Array.isArray(recorded.files)
    && recorded.files.length === REQUIRED_FILES.length
    && REQUIRED_FILES.every((name) => recorded.files.some((entry) => entry.path === name));
  return {
    ok: recorded.schema === MANIFEST_SCHEMA
      && recorded.capture === captureName
      && fileSetOk
      && JSON.stringify(recorded.files) === JSON.stringify(fresh.files),
    recorded_files: recorded.files ?? null,
    fresh_files: fresh.files,
  };
}

function captureRow(planned, root) {
  const plannedMeta = {
    capture_label: planned.name,
    stage_id: planned.stage_id,
    stage_semantics: planned.stage_semantics,
    prior_transition: planned.prior_transition,
  };
  let captureDir;
  try {
    captureDir = resolveCaptureDir(planned.name, root);
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
  let meta;
  try {
    meta = readMeta(captureDir);
  } catch (err) {
    if (err && (err.code === "ENOENT" || String(err.message).includes("missing"))) {
      return { ...plannedMeta, capture_status: "MISSING" };
    }
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
  try {
    if (meta.schema !== META_SCHEMA && meta.device_generated === true) {
      throw new Error("capture schema is not the pattern-paste schema");
    }
    if (!provenanceReady(meta, planned, captureDir)) {
      return { ...plannedMeta, capture_status: "WAITING" };
    }
    for (const name of REQUIRED_FILES) {
      const st = assertRegularFile(path.join(captureDir, name), name);
      if (!st) throw new Error(`device_generated capture is missing ${name}`);
      if (st.size > sizeCap(name)) throw new Error(`${name} exceeds its size cap`);
    }
    const verified = verifyManifest(planned.name, root);
    if (!verified.ok) throw new Error("SHA256SUMS.json is stale");
    return { ...plannedMeta, capture_status: "PRESENT", manifest_verified: true };
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
}

function frozenPolicyFields() {
  return {
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
    operation_kind: OPERATION_KIND,
    offset_585459_classification: "CONTENT_DEPENDENT",
    copy_state_doc_rule: "BLOCKED",
    active_bank_retarget_rule: "BLOCKED",
    bank_changeplan_readiness: "NOT_READY",
    issue_217: "OPEN",
    issue_221: "OPEN",
    copy_saved_checkpoint_semantics: "UNKNOWN",
    readiness_gap_working_saved_checkpoint: "OPEN",
    readiness_gap_bank_internal_identity: "OPEN",
    bank_internal_identity: "UNKNOWN",
    persistence_harness: "READY",
    scope_correction: "PASS",
  };
}

function stageHasComparedBytes(root, captureName) {
  const captureDir = path.join(root, captureName);
  return MATRIX_FILES.every((name) => {
    try {
      const st = lstatSync(path.join(captureDir, name));
      return st.isFile() && !st.isSymbolicLink();
    } catch {
      return false;
    }
  });
}

function sequenceProvenFromMeta(root) {
  return PLANNED_CAPTURES.every((planned) => {
    try {
      const meta = readMeta(resolveCaptureDir(planned.name, root));
      return meta.capture_sequence_proven === true;
    } catch {
      return false;
    }
  });
}

export function persistenceStatus(root = FIXTURE_ROOT) {
  const captures = PLANNED_CAPTURES.map((planned) => captureRow(planned, root));
  const bytesPresent = PLANNED_CAPTURES.some((planned) => stageHasComparedBytes(root, planned.name));
  const sequenceProven = sequenceProvenFromMeta(root);
  const rejected = captures.some((row) => row.capture_status === "REJECTED");
  const allPresent = captures.every((row) => row.capture_status === "PRESENT");
  const dataset = sequenceProven && allPresent && !rejected
    ? buildPatternPasteDatasetFromFixture(root)
    : null;
  const gate = dataset ? patternPasteSuccessGate(dataset.stages) : { ok: false, reason: null };
  const osConsistent = dataset
    ? dataset.stages.every((stage) => stage.meta.os_version === dataset.stages[0].meta.os_version)
    : false;
  const device_evidence_promotion = sequenceProven && allPresent && gate.ok && osConsistent
    ? "ALLOWED"
    : "BLOCKED";
  const base = {
    ...frozenPolicyFields(),
    capture_sequence_proven: sequenceProven ? "YES" : "NO",
    device_evidence_promotion,
    captures,
    pattern_paste_command_effect: "NOT_RUN",
    pattern_paste_effect_confirmed_on_device: "NOT_RUN",
    persistence_judgment: "NOT_RUN",
    cross_bank_pattern_paste_persistence: "NOT_RUN",
  };
  if (rejected) {
    return { ...base, device_capture: "REJECTED", result: "STOP_WITH_FINDINGS" };
  }
  if (!sequenceProven) {
    return {
      ...base,
      device_capture: bytesPresent ? "PRESENT_UNPROMOTED" : "WAITING_FOR_REAL_DEVICE",
      result: bytesPresent ? "STOP_FOR_OPERATOR_CONFIRMATION" : "WAITING_FOR_REAL_DEVICE",
    };
  }
  if (!allPresent || !gate.ok || !osConsistent) {
    return {
      ...base,
      device_capture: "INCOMPLETE",
      result: "STOP_FOR_OPERATOR_CONFIRMATION",
      pattern_paste_gate_reason: gate.reason,
    };
  }
  const judged = classifyPatternPaste(dataset);
  return {
    ...base,
    device_capture: "PASS",
    ...judged,
    result: judged.result,
  };
}

function readStageFilesFromDir(captureDir) {
  const files = {};
  for (const name of MATRIX_FILES) {
    const st = assertRegularFile(path.join(captureDir, name), name);
    if (!st) throw new Error(`missing ${name}`);
    files[name] = readFileSync(path.join(captureDir, name));
  }
  return files;
}

export function buildPatternPasteDatasetFromFixture(root, options = {}) {
  if (!sequenceProvenFromMeta(root)) {
    throw new Error("capture sequence is not proven");
  }
  const stages = PLANNED_CAPTURES.map((planned) => {
    const captureDir = resolveCaptureDir(planned.name, root);
    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      stage_semantics: planned.stage_semantics,
      prior_transition: planned.prior_transition,
      meta: readMeta(captureDir),
      files: readStageFilesFromDir(captureDir),
    };
  });
  return {
    stages,
    dest_typed_changed_on_pattern_paste: options.dest_typed_changed_on_pattern_paste ?? "NOT_RUN",
  };
}

function sentinelYes(value) {
  return value === true || value === "YES" || value === "PRESENT";
}

function sentinelNo(value) {
  return value === false || value === "NO" || value === "ABSENT";
}

export function patternPasteSuccessGate(stages) {
  const byId = Object.fromEntries(stages.map((stage) => [stage.stage_id, stage.meta]));
  const s0 = byId.S0;
  const s2 = byId.S2;
  if (!s0 || !s2) return { ok: false, reason: "MISSING_STAGE_META" };
  if (!sentinelYes(s0.source_sentinel_present_a)) return { ok: false, reason: "S0_SOURCE_SENTINEL" };
  if (!sentinelNo(s0.dest_sentinel_present_b)) return { ok: false, reason: "S0_DEST_SENTINEL" };
  if (s2.destination_ui_sentinel === "ABSENT" || s2.destination_ui_sentinel === "NO") {
    return { ok: false, reason: "S2_UI_SENTINEL_ABSENT" };
  }
  if (s2.destination_ui_sentinel !== "PRESENT") return { ok: false, reason: "S2_UI_SENTINEL" };
  return { ok: true, reason: null };
}

function buffersEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && left.equals(right);
}

export function buildTransitionMatrix(stages) {
  if (!stages[0] || stages[0].stage_id !== "S0") {
    throw new Error("Pattern paste dataset must start at S0");
  }
  for (const stage of stages) {
    if (RETIRED_TRANSITIONS.includes(stage.prior_transition)) {
      throw new Error("Retired capture ordering is rejected");
    }
  }
  const transitions = ADJACENT_TRANSITIONS.map((edge) => {
    const fromStage = stages.find((stage) => stage.capture_name === edge.from);
    const toStage = stages.find((stage) => stage.capture_name === edge.to);
    if (!fromStage || !toStage) throw new Error(`Missing stage for ${edge.label}`);
    const cells = MATRIX_FILES.map((fileName) => {
      const before = fromStage.files[fileName];
      const after = toStage.files[fileName];
      return {
        file: fileName,
        same_length: before.length === after.length,
        raw_equal: buffersEqual(before, after),
        sha256_before: sha256Buffer(before),
        sha256_after: sha256Buffer(after),
      };
    });
    return {
      transition: edge.label,
      from: edge.from,
      to: edge.to,
      length_mismatch: cells.some((cell) => !cell.same_length),
      cells,
    };
  });
  const firstChangedAt = (suffix) => {
    const fileName = `${DEST_BANK}.${suffix}`;
    const base = stages[0].files[fileName];
    for (const stage of stages.slice(1)) {
      if (!buffersEqual(base, stage.files[fileName])) return STAGE_PRODUCED_BY[stage.stage_id];
    }
    return "NONE";
  };
  return {
    baseline_stage: "S0",
    transitions,
    dest_work_first_changed_at: firstChangedAt("work"),
    dest_strd_first_changed_at: firstChangedAt("strd"),
    per_stage_pinned_offset: stages.map((stage) => ({
      stage_id: stage.stage_id,
      dest_work_offset: stage.files[`${DEST_BANK}.work`].length > PINNED_OFFSET
        ? stage.files[`${DEST_BANK}.work`][PINNED_OFFSET]
        : null,
      dest_strd_offset: stage.files[`${DEST_BANK}.strd`].length > PINNED_OFFSET
        ? stage.files[`${DEST_BANK}.strd`][PINNED_OFFSET]
        : null,
      offset_585459_classification: "CONTENT_DEPENDENT",
    })),
  };
}

function rawSideEffects(matrix, prefix) {
  const hits = matrix.transitions.flatMap((transition) => {
    const files = transition.cells
      .filter((cell) => cell.file.startsWith(prefix) && !cell.raw_equal)
      .map((cell) => cell.file);
    return files.length === 0 ? [] : [{ transition: transition.transition, files }];
  });
  return hits.length === 0 ? "NONE" : hits;
}

function changedOn(transition, fileName) {
  const cell = transition?.cells.find((entry) => entry.file === fileName);
  if (!cell) return "NOT_RUN";
  return cell.raw_equal ? "NO" : "YES";
}

function projectStateTransition(beforeStage, afterStage) {
  const before = parsePersistenceStatesSection(beforeStage.files["project.work"].toString("latin1"));
  const after = parsePersistenceStatesSection(afterStage.files["project.work"].toString("latin1"));
  return {
    bank_before: before.ok ? before.bank : null,
    bank_after: after.ok ? after.bank : null,
    pattern_before: before.ok ? before.pattern : null,
    pattern_after: after.ok ? after.pattern : null,
  };
}

function earliestChange(workAt, strdAt) {
  const order = [
    "DESTINATION_SELECT_BEFORE_PASTE",
    "PATTERN_PASTE",
    "CONTROL_SWITCH",
    "PROJECT_SAVE",
    "PROJECT_RELOAD",
  ];
  const hits = [workAt, strdAt].filter((value) => value && value !== "NONE");
  if (hits.length === 0) return "NONE";
  return hits.sort((left, right) => order.indexOf(left) - order.indexOf(right))[0];
}

function observationLabel(workAt, strdAt, confirmed, anyDestChange) {
  if (confirmed === "YES" && !anyDestChange) return "OBSERVED_RUNTIME_ONLY_OR_CAPTURE_TRANSPORT_UNRESOLVED";
  if (workAt === "PATTERN_PASTE" && strdAt === "PROJECT_SAVE") {
    return "OBSERVED_WORKING_CHECKPOINT_SEPARATION";
  }
  if (workAt === "PATTERN_PASTE" && strdAt === "PATTERN_PASTE") return "OBSERVED_BOTH_VISIBLE_AT_PATTERN_PASTE";
  if (workAt === "CONTROL_SWITCH" && strdAt === "CONTROL_SWITCH") {
    return "OBSERVED_FLUSH_ON_LEAVING_DESTINATION_CANDIDATE";
  }
  if (workAt === "CONTROL_SWITCH" && strdAt === "PROJECT_SAVE") {
    return "OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE";
  }
  if (workAt === "PROJECT_SAVE" && strdAt === "PROJECT_SAVE") return "OBSERVED_PROJECT_SAVE_PERSISTENCE_CANDIDATE";
  if (workAt === "PROJECT_RELOAD" || strdAt === "PROJECT_RELOAD") return "OBSERVED_PROJECT_RELOAD_DELTA";
  if (workAt === "NONE" && strdAt === "NONE") return "OBSERVED_NO_DESTINATION_DISK_CHANGE";
  return "OBSERVED_MIXED_TIMING";
}

export function classifyPatternPaste(dataset) {
  const shell = {
    ...frozenPolicyFields(),
    pattern_paste_command_effect: "NOT_RUN",
    pattern_paste_effect_confirmed_on_device: "NOT_RUN",
    persistence_judgment: "NOT_RUN",
    dest_work_first_changed_at: "NOT_RUN",
    dest_strd_first_changed_at: "NOT_RUN",
    pattern_paste_effect_first_observed_on_disk: "NOT_RUN",
    dest_work_changed_on_pattern_paste: "NOT_RUN",
    dest_strd_changed_on_pattern_paste: "NOT_RUN",
    dest_typed_changed_on_pattern_paste: dataset?.dest_typed_changed_on_pattern_paste ?? "NOT_RUN",
    pattern_paste_survives_project_reload: "UNKNOWN",
    working_checkpoint_separation_observed: "NOT_RUN",
    cross_bank_pattern_paste_persistence: "NOT_RUN",
    project_state_destination_select: null,
    project_state_pattern_paste: null,
    project_state_control_switch: null,
    project_state_save: null,
    project_state_reload: null,
    capture_transport_limitation: "UNKNOWN",
  };
  const stages = dataset?.stages;
  if (!Array.isArray(stages) || stages.length !== PLANNED_CAPTURES.length) {
    return { ...shell, result: "STOP_WITH_FINDINGS", persistence_judgment: "INCOMPLETE_DATASET" };
  }
  let matrix;
  try {
    matrix = buildTransitionMatrix(stages);
  } catch (err) {
    return { ...shell, result: "STOP_WITH_FINDINGS", persistence_judgment: "INCOMPLETE_DATASET", error: err.message };
  }
  shell.dest_work_first_changed_at = matrix.dest_work_first_changed_at;
  shell.dest_strd_first_changed_at = matrix.dest_strd_first_changed_at;
  shell.pattern_paste_effect_first_observed_on_disk = earliestChange(
    matrix.dest_work_first_changed_at,
    matrix.dest_strd_first_changed_at,
  );
  const paste = matrix.transitions.find((entry) => entry.transition === "PATTERN_PASTE");
  shell.dest_work_changed_on_pattern_paste = changedOn(paste, "bank02.work");
  shell.dest_strd_changed_on_pattern_paste = changedOn(paste, "bank02.strd");
  const byId = Object.fromEntries(stages.map((stage) => [stage.stage_id, stage]));
  shell.project_state_destination_select = projectStateTransition(byId.S0, byId.S1);
  shell.project_state_pattern_paste = projectStateTransition(byId.S1, byId.S2);
  shell.project_state_control_switch = projectStateTransition(byId.S2, byId.S3);
  shell.project_state_save = projectStateTransition(byId.S3, byId.S4);
  shell.project_state_reload = projectStateTransition(byId.S4, byId.S5);
  const parsedStates = stages.map((stage) => ({
    stage_id: stage.stage_id,
    ...parsePersistenceStatesSection(stage.files["project.work"].toString("latin1")),
  }));
  shell.project_bank_sequence = Object.fromEntries(parsedStates.map((entry) => [entry.stage_id, entry.ok ? entry.bank : null]));
  shell.project_pattern_sequence = Object.fromEntries(parsedStates.map((entry) => [entry.stage_id, entry.ok ? entry.pattern : null]));
  const bankS2 = shell.project_bank_sequence.S2;
  const bankS3 = shell.project_bank_sequence.S3;
  const bankS4 = shell.project_bank_sequence.S4;
  shell.project_work_active_bank_write_lag_observed = bankS2 != null && bankS2 === bankS3 && bankS3 !== bankS4
    ? "YES"
    : "NO";
  const bankByStage = shell.project_bank_sequence;
  const firstPersisted = ADJACENT_TRANSITIONS.find((edge) => {
    const fromId = PLANNED_CAPTURES.find((planned) => planned.name === edge.from)?.stage_id;
    const toId = PLANNED_CAPTURES.find((planned) => planned.name === edge.to)?.stage_id;
    return bankByStage[fromId] != null && bankByStage[toId] != null && bankByStage[fromId] !== bankByStage[toId];
  });
  shell.project_bank_selection_first_persisted_at = firstPersisted?.label ?? "NONE";
  shell.control_bank_selection_persisted_at = shell.project_work_active_bank_write_lag_observed === "YES"
    ? "PROJECT_SAVE"
    : "NOT_OBSERVED";
  shell.bank_c_side_effects = rawSideEffects(matrix, "bank03.");
  shell.bank_d_side_effects = rawSideEffects(matrix, "bank04.");
  shell.runtime_or_save_side_effect = shell.bank_c_side_effects === "NONE" && shell.bank_d_side_effects === "NONE"
    ? "NONE"
    : "PRESENT";
  const transportUnknown = stages.some((stage) => stage.meta.capture_transport === "unknown"
    || stage.meta.capture_transport == null
    || stage.meta.capture_transport === "");
  shell.capture_transport_limitation = transportUnknown ? "UNKNOWN" : "RECORDED";
  shell.copy_saved_checkpoint_semantics = "UNKNOWN";
  const s5 = byId.S5?.meta?.destination_ui_sentinel_after_reload;
  if (s5 === "PRESENT") shell.pattern_paste_survives_project_reload = "YES";
  else if (s5 === "ABSENT" || s5 === "NO") shell.pattern_paste_survives_project_reload = "NO";
  else shell.pattern_paste_survives_project_reload = "UNKNOWN";

  if (matrix.transitions.some((entry) => entry.length_mismatch)) {
    return { ...shell, result: "STOP_WITH_FINDINGS", persistence_judgment: "LENGTH_MISMATCH" };
  }
  const gate = patternPasteSuccessGate(stages);
  if (!gate.ok) {
    return {
      ...shell,
      pattern_paste_command_effect: "UNCONFIRMED",
      pattern_paste_effect_confirmed_on_device: "NO",
      persistence_judgment: "NOT_RUN",
      cross_bank_pattern_paste_persistence: "NOT_RUN",
      result: "STOP_WITH_FINDINGS",
      pattern_paste_gate_reason: gate.reason,
    };
  }
  shell.pattern_paste_command_effect = "CONFIRMED";
  shell.pattern_paste_effect_confirmed_on_device = "YES";
  const anyDestChange = shell.dest_work_first_changed_at !== "NONE" || shell.dest_strd_first_changed_at !== "NONE";
  shell.cross_bank_pattern_paste_persistence = observationLabel(
    shell.dest_work_first_changed_at,
    shell.dest_strd_first_changed_at,
    "YES",
    anyDestChange,
  );
  shell.working_checkpoint_separation_observed = shell.cross_bank_pattern_paste_persistence
    === "OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE"
    ? "YES"
    : "NO";
  shell.persistence_judgment = "OBSERVATION_ONLY";
  return { ...shell, result: "STOP_WITH_FINDINGS" };
}

export function analyzePatternPaste(root = FIXTURE_ROOT) {
  const status = persistenceStatus(root);
  if (status.capture_sequence_proven !== "YES" || status.device_capture !== "PASS") {
    return { ...status, fixture_no_write: "PASS" };
  }
  return { ...status, fixture_no_write: "PASS" };
}

function main() {
  const [, , command, captureName] = process.argv;
  try {
    if (command === "status") {
      console.log(JSON.stringify(persistenceStatus(), null, 2));
      return;
    }
    if (command === "analyze") {
      console.log(JSON.stringify(analyzePatternPaste(), null, 2));
      return;
    }
    if (command === "write-manifest") {
      if (!captureName) throw new Error("write-manifest requires a capture name");
      const manifest = writeManifest(captureName);
      console.log(`Wrote SHA256SUMS.json (${manifest.files.length} files)`);
      return;
    }
    if (command === "verify-manifest") {
      if (!captureName) throw new Error("verify-manifest requires a capture name");
      const result = verifyManifest(captureName);
      if (!result.ok) {
        console.error("manifest mismatch");
        process.exitCode = 1;
        return;
      }
      console.log("manifest matches");
      return;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.error(
    "Usage: node scripts/pse-pattern-paste-persistence.mjs <status|analyze|write-manifest|verify-manifest> [capture]",
  );
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
