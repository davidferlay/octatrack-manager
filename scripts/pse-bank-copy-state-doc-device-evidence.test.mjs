import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ADJACENT_TRANSITIONS,
  DEST_BANK,
  FIXTURE_ROOT,
  META_SCHEMA,
  OPERATION_KIND,
  PINNED_OS_RELEASE,
  PINNED_OS_REVISION,
  PLANNED_CAPTURES,
  REQUIRED_FILES,
  SOURCE_BANK,
  WORK_ID,
  analyzeBankCopyEvidence,
  assertPlannedCaptureName,
  buildBankCopyDatasetFromFixture,
  buildManifest,
  buildTransitionMatrix,
  classifyBankCopyEvidence,
  classifyByteProvenance,
  evidenceStatus,
  metaTemplate,
  parseCaptureMayFlushState,
  parseProjectStatesSection,
  setBankDecodeValidator,
  verifyManifest,
  writeManifest,
} from "./pse-bank-copy-state-doc-device-evidence.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_S0 = path.join(
  SCRIPT_DIR,
  "../src-tauri/tests/fixtures/pse_bank_copy_persistence/s0_baseline_saved",
);
const FIXTURE_DIVERGED = path.join(
  SCRIPT_DIR,
  "../src-tauri/tests/fixtures/pse_bank_multi_device/bank_a_working_diverged",
);

test.before(() => {
  setBankDecodeValidator((paths) => {
    for (const filePath of paths) {
      if (readFileSync(filePath).length < 256) {
        throw new Error(`bank document too small to decode: ${filePath}`);
      }
    }
  });
});

test("planned bank-copy stages match the receptacle contract", () => {
  assert.deepEqual(PLANNED_CAPTURES.map((entry) => entry.stage_semantics), [
    "BASELINE_SAVED",
    "SOURCE_WORKING_DIVERGED_PRE_COPY",
    "IMMEDIATE_NATIVE_BANK_COPY",
    "CONTROL_SWITCH",
    "PROJECT_SAVE",
    "PROJECT_RELOAD",
  ]);
  assert.deepEqual(ADJACENT_TRANSITIONS.map((entry) => entry.label), [
    "SOURCE_WORKING_ONLY_EDIT",
    "NATIVE_BANK_COPY",
    "CONTROL_SWITCH",
    "PROJECT_SAVE",
    "PROJECT_RELOAD",
  ]);
});

test("parser accepts BANK/PATTERN in 0..15 only", () => {
  assert.deepEqual(parseProjectStatesSection(projectText(0, 3)), { ok: true, bank: 0, pattern: 3 });
  for (const value of [-1, 16, 255]) {
    assert.deepEqual(parseProjectStatesSection(projectText(value, 0)), { ok: false, bank: null, pattern: null });
    assert.deepEqual(parseProjectStatesSection(projectText(0, value)), { ok: false, bank: null, pattern: null });
  }
});

test("empty fixture root waits for real device", () => {
  const status = evidenceStatus(FIXTURE_ROOT);
  assert.equal(status.device_capture, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.result, "WAITING_FOR_OPERATOR_CAPTURE");
  assert.equal(status.copy_state_doc_rule, "BLOCKED");
});

test("S1 work==strd blocks promotion", () => {
  const root = materializeSyntheticCapture({ s1SourceDiverged: false });
  try {
    for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
    const row = evidenceStatus(root).captures.find((entry) => entry.stage_id === "S1");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /bank01\.work != bank01\.strd/);
    const judged = classifyBankCopyEvidence({ stages: syntheticStages({ s1SourceDiverged: false }) });
    assert.equal(judged.pre_source_work_strd_divergence, "FAIL");
    assert.equal(judged.result, "STOP_WITH_FINDINGS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing transport metadata blocks semantic attribution", () => {
  const judged = classifyBankCopyEvidence({
    stages: syntheticStages({ destWorkAt: "S2", transport: "unknown" }),
  });
  assert.equal(judged.immediate_copy_timing_attribution, "INCONCLUSIVE");
  assert.equal(judged.capture_transport_confidence, "UNKNOWN");
  assert.equal(judged.copy_state_doc_rule, "BLOCKED");
});

test("may-flush transport blocks immediate copy attribution", () => {
  const judged = classifyBankCopyEvidence({
    stages: syntheticStages({ destWorkAt: "S2", mayFlush: "yes" }),
  });
  assert.equal(judged.immediate_copy_timing_attribution, "INCONCLUSIVE");
  assert.equal(judged.capture_transport_confidence, "MAY_FLUSH");
});

test("ambiguous may-flush values stay unknown", () => {
  assert.equal(parseCaptureMayFlushState({ capture_may_flush_device_state: "maybe" }), "unknown");
  const judged = classifyBankCopyEvidence({
    stages: syntheticStages({ destWorkAt: "S2", mayFlush: "maybe" }),
  });
  assert.equal(judged.capture_transport_confidence, "UNKNOWN");
  assert.notEqual(judged.capture_transport_confidence, "PROVEN_NON_MUTATING");
});

test("provenance classifier distinguishes source roles", () => {
  const work = Buffer.from("source-working");
  const strd = Buffer.from("source-strd");
  assert.equal(classifyByteProvenance(work, { SOURCE_WORKING: work, SOURCE_SAVEDCHECKPOINT: strd }), "SOURCE_WORKING");
  assert.equal(classifyByteProvenance(strd, { SOURCE_WORKING: work, SOURCE_SAVEDCHECKPOINT: strd }), "SOURCE_SAVEDCHECKPOINT");
  assert.equal(classifyByteProvenance(Buffer.from("other"), { SOURCE_WORKING: work, SOURCE_SAVEDCHECKPOINT: strd }), "DERIVED_OTHER");
  assert.equal(
    classifyByteProvenance(work, { SOURCE_WORKING: work, SOURCE_SAVEDCHECKPOINT: work }),
    "AMBIGUOUS",
  );
});

test("immediate bank copy transition is detected on destination work", () => {
  const judged = classifyBankCopyEvidence({
    stages: syntheticStages({ destWorkAt: "S2", destStrdAt: "S4", transport: "recorded" }),
  });
  assert.equal(judged.pre_source_work_strd_divergence, "PASS");
  assert.equal(judged.dest_work_immediate_change, "YES");
  assert.equal(judged.dest_strd_immediate_change, "NO");
  assert.equal(judged.dest_work_first_changed_at, "NATIVE_BANK_COPY");
  assert.equal(judged.dest_strd_first_changed_at, "PROJECT_SAVE");
  assert.equal(judged.dest_work_provenance, "SOURCE_WORKING");
});

test("missing S2 copy_operation keeps copy_operation_proven NO", () => {
  const stages = syntheticStages({ destWorkAt: "S2", transport: "recorded" });
  stages[2].meta.copy_operation = "";
  const judged = classifyBankCopyEvidence({ stages });
  assert.equal(judged.copy_operation_proven, "NO");
});

test("complete synthetic capture promotes analysis when transport is recorded", () => {
  const root = materializeSyntheticCapture({ destWorkAt: "S2", destStrdAt: "S4", transport: "recorded" });
  try {
    const before = snapshotDeviceBinaryHashes(root);
    for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
    const status = evidenceStatus(root);
    assert.equal(status.device_evidence_promotion, "ALLOWED");
    assert.equal(status.device_capture, "PASS");
    assert.equal(status.copy_state_doc_rule, "BLOCKED");
    assert.equal(status.copy_saved_checkpoint_semantics, "UNKNOWN");
    assert.equal(analyzeBankCopyEvidence(root).fixture_no_write, "PASS");
    assert.equal(snapshotDeviceBinaryHashes(root), before);
    buildBankCopyDatasetFromFixture(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wrong firmware metadata blocks promotion", () => {
  const root = materializeSyntheticCapture({});
  try {
    const metaPath = path.join(root, "s0_baseline_saved", "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.os_release = "1.39";
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
    const status = evidenceStatus(root);
    const s0 = status.captures.find((entry) => entry.stage_id === "S0");
    assert.equal(s0.capture_status, "REJECTED");
    assert.match(s0.error, /R0173/);
    assert.equal(status.device_capture, "REJECTED");
    assert.equal(status.device_evidence_promotion, "BLOCKED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("UI state must match project.work [STATES]", () => {
  const root = materializeSyntheticCapture({ projectBank: 1 });
  try {
    for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
    const row = evidenceStatus(root).captures.find((entry) => entry.stage_id === "S0");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /do not match project\.work/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink bank file is rejected before read", () => {
  const root = materializeSyntheticCapture({});
  try {
    const target = path.join(root, "outside-bank.work");
    writeFileSync(target, readFileSync(path.join(FIXTURE_S0, "bank01.work")));
    const linkPath = path.join(root, "s1_source_working_diverged_pre_copy", "bank01.work");
    rmSync(linkPath);
    symlinkSync(target, linkPath);
    const row = evidenceStatus(root).captures.find((entry) => entry.stage_id === "S1");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /Symlink not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("truncated bank bytes block promotion", () => {
  const root = materializeSyntheticCapture({});
  try {
    writeFileSync(path.join(root, "s0_baseline_saved", "bank02.work"), Buffer.alloc(8));
    const row = evidenceStatus(root).captures.find((entry) => entry.stage_id === "S0");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /too small to decode|bank document too small/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dataset export requires every stage present", () => {
  const root = materializeSyntheticCapture({});
  try {
    assert.throws(() => buildBankCopyDatasetFromFixture(root), /every stage PRESENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink capture directory is rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-copy-link-"));
  try {
    mkdirSync(path.join(root, "outside"));
    symlinkSync(path.join(root, "outside"), path.join(root, "s0_baseline_saved"));
    const row = evidenceStatus(root).captures.find((entry) => entry.stage_id === "S0");
    assert.equal(row.capture_status, "REJECTED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid capture name is rejected", () => {
  assert.throws(() => assertPlannedCaptureName("not-a-stage"), /Not a planned capture/);
});

test("manifest stale after meta edit", () => {
  const root = materializeSyntheticCapture({});
  try {
    writeManifest("s2_immediately_after_bank_copy", root);
    assert.equal(verifyManifest("s2_immediately_after_bank_copy", root).ok, true);
    const metaPath = path.join(root, "s2_immediately_after_bank_copy", "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.operator_note = "changed after manifest";
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    assert.equal(verifyManifest("s2_immediately_after_bank_copy", root).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildTransitionMatrix reports hash-only changes", () => {
  const stages = syntheticStages({ destWorkAt: "S3", destStrdAt: "S4", transport: "recorded" });
  const matrix = buildTransitionMatrix(stages);
  const copy = matrix.transitions.find((entry) => entry.transition === "NATIVE_BANK_COPY");
  assert.equal(copy.cells.find((cell) => cell.file === `${DEST_BANK}.work`).changed, false);
  const control = matrix.transitions.find((entry) => entry.transition === "CONTROL_SWITCH");
  assert.equal(control.cells.find((cell) => cell.file === `${DEST_BANK}.work`).changed, true);
});

function projectText(bankRaw, patternRaw = 3) {
  return `[STATES]\nBANK=${bankRaw}\nPATTERN=${patternRaw}\n[/STATES]\n`;
}

function stageRank(stageId) {
  return Number(stageId.slice(1));
}

function transportMeta(options) {
  const transport = options.transport ?? "recorded";
  if (transport === "unknown") {
    return {
      capture_transport: "unknown",
      capture_required_mode_change: "unknown",
      capture_may_flush_device_state: "unknown",
    };
  }
  const mayFlush = options.mayFlush ?? "no";
  return {
    capture_transport: "Operator copied CF files via documented USB path",
    capture_required_mode_change: "no",
    capture_may_flush_device_state: mayFlush,
  };
}

function readFixture(base, name) {
  return readFileSync(path.join(base, name));
}

function diskStageFiles(planned, options = {}) {
  const {
    destWorkAt = "S2",
    destStrdAt = "S4",
    s1SourceDiverged = true,
    projectBank = 0,
    projectPattern = 3,
  } = options;
  const rank = stageRank(planned.stage_id);
  const files = {};
  for (const name of REQUIRED_FILES) {
    if (name === "capture.meta.json") continue;
    if (name === "project.work") {
      files[name] = Buffer.from(projectText(projectBank, projectPattern), "latin1");
      continue;
    }
    files[name] = readFixture(FIXTURE_S0, name);
  }
  if (rank >= stageRank("S1")) {
    if (s1SourceDiverged) {
      files["bank01.work"] = readFixture(FIXTURE_DIVERGED, "bank01.work");
    } else {
      const same = readFixture(FIXTURE_S0, "bank01.work");
      files["bank01.work"] = same;
      files["bank01.strd"] = same;
    }
  }
  if (rank >= stageRank(destWorkAt)) {
    files[`${DEST_BANK}.work`] = Buffer.from(files["bank01.work"]);
  }
  if (rank >= stageRank(destStrdAt)) {
    files[`${DEST_BANK}.strd`] = readFixture(FIXTURE_S0, "bank03.strd");
  }
  return files;
}

function syntheticStages(options = {}) {
  const {
    destWorkAt = "S2",
    destStrdAt = "S2",
    s1SourceDiverged = true,
    transport = "recorded",
    projectBankByStage = {},
  } = options;
  const baseBuf = (seed, byte = 0x10) => Buffer.from([seed, byte, byte, byte, 0, 0, 0, 0]);
  return PLANNED_CAPTURES.map((planned) => {
    const files = {};
    for (const name of REQUIRED_FILES) {
      if (name === "capture.meta.json") continue;
      if (name.startsWith("project.")) {
        files[name] = Buffer.from(projectText(projectBankByStage[planned.stage_id] ?? 0, 3), "latin1");
        continue;
      }
      const slot = Number(name.slice(4, 6));
      const role = name.endsWith(".work") ? "w" : "s";
      files[name] = baseBuf(slot, role === "w" ? 0x20 : 0x30);
    }
    if (stageRank(planned.stage_id) >= stageRank("S1")) {
      const workByte = 0xaa;
      const strdByte = s1SourceDiverged ? 0xbb : workByte;
      files[`${SOURCE_BANK}.work`] = baseBuf(1, workByte);
      files[`${SOURCE_BANK}.strd`] = baseBuf(1, strdByte);
    }
    if (stageRank(planned.stage_id) >= stageRank(destWorkAt)) {
      files[`${DEST_BANK}.work`] = Buffer.from(files[`${SOURCE_BANK}.work`]);
    }
    const mutateDest = (suffix, atStage) => {
      if (suffix === "work" && stageRank(planned.stage_id) >= stageRank(destWorkAt)) return;
      if (stageRank(planned.stage_id) >= stageRank(atStage)) {
        const key = `${DEST_BANK}.${suffix}`;
        const next = Buffer.from(files[key]);
        next[2] ^= 0x55;
        files[key] = next;
      }
    };
    mutateDest("work", destWorkAt);
    mutateDest("strd", destStrdAt);
    const meta = {
      ...metaTemplate(planned),
      ...transportMeta({ transport, mayFlush: options.mayFlush }),
      device_generated: true,
      capture_sequence_proven: true,
      os_revision: "R0173",
      os_release: "1.40",
      capture_date: "2026-10-17",
      operator_note: "synthetic bank copy capture",
      current_bank_ui: "A",
      current_pattern_ui: "A04",
      save_operation: planned.stage_id === "S0" || planned.stage_id === "S4" ? "Explicit project save" : "",
      working_edit_operation: planned.stage_id === "S1" ? "Small working-only edit on Bank A" : "",
      copy_operation: planned.stage_id === "S2" ? "Native Bank Copy A to D" : "",
      control_switch_operation: planned.stage_id === "S3" ? "Switch to control Bank B" : "",
      reload_operation: planned.stage_id === "S5" ? "Project reload" : "",
    };
    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      stage_semantics: planned.stage_semantics,
      prior_transition: planned.prior_transition,
      meta,
      files,
    };
  });
}

function materializeSyntheticCapture(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-copy-ready-"));
  for (const planned of PLANNED_CAPTURES) {
    const meta = {
      ...metaTemplate(planned),
      ...transportMeta(options),
      device_generated: true,
      capture_sequence_proven: true,
      os_revision: PINNED_OS_REVISION,
      os_release: PINNED_OS_RELEASE,
      capture_date: "2026-10-17",
      operator_note: "synthetic bank copy capture",
      current_bank_ui: "A",
      current_pattern_ui: "A04",
      save_operation: planned.stage_id === "S0" || planned.stage_id === "S4" ? "Explicit project save" : "",
      working_edit_operation: planned.stage_id === "S1" ? "Small working-only edit on Bank A" : "",
      copy_operation: planned.stage_id === "S2" ? "Native Bank Copy A to D" : "",
      control_switch_operation: planned.stage_id === "S3" ? "Switch to control Bank B" : "",
      reload_operation: planned.stage_id === "S5" ? "Project reload" : "",
    };
    const dir = path.join(root, planned.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "capture.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    for (const [name, buf] of Object.entries(diskStageFiles(planned, options))) {
      writeFileSync(path.join(dir, name), buf);
    }
  }
  return root;
}

const DEVICE_BINARY_FILES = REQUIRED_FILES.filter((name) => name !== "capture.meta.json" && name !== "SHA256SUMS.json");

function snapshotDeviceBinaryHashes(root) {
  const digest = createHash("sha256");
  for (const planned of PLANNED_CAPTURES) {
    for (const name of DEVICE_BINARY_FILES) {
      digest.update(planned.name);
      digest.update(name);
      digest.update(readFileSync(path.join(root, planned.name, name)));
    }
  }
  return digest.digest("hex");
}

function snapshotTree(root) {
  const digest = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = lstatSync(full);
      digest.update(name);
      if (st.isSymbolicLink()) {
        digest.update("symlink");
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) digest.update(readFileSync(full));
    }
  };
  walk(root);
  return digest.digest("hex");
}

test("meta template uses bank copy work id and operation kind", () => {
  const meta = metaTemplate(PLANNED_CAPTURES[0]);
  assert.equal(meta.schema, META_SCHEMA);
  assert.equal(meta.work_id, WORK_ID);
  assert.equal(meta.operation_kind, OPERATION_KIND);
  assert.equal(meta.device_generated, false);
});

test("oversized bank file is rejected during manifest build", () => {
  const root = materializeSyntheticCapture({});
  try {
    writeFileSync(path.join(root, "s0_baseline_saved", "bank01.work"), Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.throws(() => buildManifest("s0_baseline_saved", root), /bank01\.work exceeds its size cap/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
