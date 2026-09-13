import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseLegacyGateLists,
  validateLegacyCommandContainment,
} from "./legacy-command-gate.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const gatePath = path.join(repositoryRoot, "src-tauri/src/legacy_command_gate.rs");
const libPath = path.join(repositoryRoot, "src-tauri/src/lib.rs");
const pmPath = path.join(repositoryRoot, "src-tauri/src/project_manager.rs");

const gateRs = readFileSync(gatePath, "utf8");
const libRs = readFileSync(libPath, "utf8");
const projectManagerRs = readFileSync(pmPath, "utf8");

describe("legacy command containment (negative fixtures)", () => {
  it("passes on the real repository wiring", () => {
    const { errors } = validateLegacyCommandContainment({
      gateRs,
      libRs,
      projectManagerRs,
    });
    assert.deepEqual(errors, []);
  });

  it("fails when the gate module is removed but handlers remain", () => {
    const libWithoutGate = libRs.replace("mod legacy_command_gate;\n", "");
    const { errors } = validateLegacyCommandContainment({
      gateRs,
      libRs: libWithoutGate,
      projectManagerRs,
    });
    assert.ok(
      errors.some((e) => e.includes("mod legacy_command_gate")),
      errors.join("; "),
    );
  });

  it("fails when deny_legacy_write is not the first executable statement", () => {
    const libBroken = libRs.replace(
      "async fn create_audio_pool(project_path: String) -> Result<String, String> {\n    crate::deny_legacy_write!();",
      "async fn create_audio_pool(project_path: String) -> Result<String, String> {\n    let _ = project_path.len();\n    crate::deny_legacy_write!();",
    );
    const { errors } = validateLegacyCommandContainment({
      gateRs,
      libRs: libBroken,
      projectManagerRs,
    });
    assert.ok(
      errors.some((e) => e.includes("create_audio_pool")),
      errors.join("; "),
    );
  });

  it("fails when a disabled handler omits deny_legacy_write (body could continue)", () => {
    const libBroken = libRs.replace(
      "    crate::deny_legacy_write!();\n\n    // Run on a blocking thread pool to avoid blocking the main event loop\n    tauri::async_runtime::spawn_blocking(move || save_parts_data",
      "    // Run on a blocking thread pool to avoid blocking the main event loop\n    tauri::async_runtime::spawn_blocking(move || save_parts_data",
    );
    const { errors } = validateLegacyCommandContainment({
      gateRs,
      libRs: libBroken,
      projectManagerRs,
    });
    assert.ok(
      errors.some((e) => e.includes("save_parts")),
      errors.join("; "),
    );
  });

  it("fails when purge is misclassified as read", () => {
    const lists = parseLegacyGateLists(gateRs);
    const readWithPurge = [
      ...lists.READ_COMMANDS,
      "purge_project_files",
      "purge_pool_files",
    ];
    const disabledWithoutPurge = lists.DISABLED_COMMANDS.filter(
      (n) => n !== "purge_project_files" && n !== "purge_pool_files",
    );
    const gateBroken = gateRs
      .replace(
        /pub const READ_COMMANDS:[\s\S]*?\];/,
        `pub const READ_COMMANDS: &[&str] = &[\n${readWithPurge.map((n) => `    "${n}",`).join("\n")}\n];`,
      )
      .replace(
        /pub const DISABLED_COMMANDS:[\s\S]*?\];/,
        `pub const DISABLED_COMMANDS: &[&str] = &[\n${disabledWithoutPurge.map((n) => `    "${n}",`).join("\n")}\n];`,
      );
    const { errors } = validateLegacyCommandContainment({
      gateRs: gateBroken,
      libRs,
      projectManagerRs,
    });
    assert.ok(errors.length > 0, "expected misclassified purge to fail");
  });

  it("fails on duplicate classification entries", () => {
    const gateBroken = gateRs.replace(
      '"scan_devices",',
      '"scan_devices",\n    "scan_devices",',
    );
    const { errors } = validateLegacyCommandContainment({
      gateRs: gateBroken,
      libRs,
      projectManagerRs,
    });
    assert.ok(
      errors.some((e) => e.includes("duplicate")),
      errors.join("; "),
    );
  });

  it("fails when an unclassified command stays on generate_handler", () => {
    const libExtra = libRs.replace(
      "greet,",
      "greet,\n            rogue_legacy_command,",
    );
    const { errors } = validateLegacyCommandContainment({
      gateRs,
      libRs: libExtra,
      projectManagerRs,
    });
    assert.ok(
      errors.some((e) => e.includes("rogue_legacy_command")),
      errors.join("; "),
    );
  });
});
