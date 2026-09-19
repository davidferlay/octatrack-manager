import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildNativeAcceptanceChildEnv,
  resolveCargoExecutable,
} from "./launch-native-acceptance-env.mjs";

const ROOT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LAUNCHER = join(ROOT_DIR, "scripts/launch-native-acceptance-tauri.sh");

function fakeCargoBin(root) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const cargoPath = join(binDir, "cargo");
  writeFileSync(cargoPath, "#!/bin/sh\nexit 0\n");
  chmodSync(cargoPath, 0o755);
  return cargoPath;
}

test("Case A: cargo on PATH is used", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-a-"));
  const cargoPath = fakeCargoBin(tmp);
  const binDir = join(tmp, "bin");
  const resolved = resolveCargoExecutable({
    pathEnv: binDir,
    cargoHome: join(tmp, "unused-cargo-home"),
    realHome: tmp,
  });
  assert.equal(resolved, cargoPath);
});

test("Case B: cargo missing from PATH but present under REAL_HOME/.cargo/bin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-b-"));
  const cargoPath = fakeCargoBin(join(tmp, ".cargo"));
  const resolved = resolveCargoExecutable({
    pathEnv: "/usr/bin:/bin",
    cargoHome: join(tmp, ".cargo"),
    realHome: tmp,
  });
  assert.equal(resolved, cargoPath);
});

test("Case C: missing cargo fails closed with explicit error", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-c-"));
  const result = buildNativeAcceptanceChildEnv({
    isolatedHome: join(tmp, "isolated"),
    realHome: tmp,
    pathEnv: "/usr/bin:/bin",
    cargoHome: join(tmp, "empty-cargo"),
    rustupHome: join(tmp, "empty-rustup"),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /cargo not found/);
  assert.match(result.error, /\.cargo\/bin/);
});

test("Case D/E: child uses isolated HOME and real toolchain homes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-de-"));
  const cargoPath = fakeCargoBin(join(tmp, ".cargo"));
  const isolated = join(tmp, "isolated-home");
  const result = buildNativeAcceptanceChildEnv({
    isolatedHome: isolated,
    realHome: tmp,
    pathEnv: dirname(cargoPath),
    cargoHome: join(tmp, ".cargo"),
    rustupHome: join(tmp, ".rustup"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.env.HOME, isolated);
  assert.equal(result.env.CARGO_HOME, join(tmp, ".cargo"));
  assert.equal(result.env.RUSTUP_HOME, join(tmp, ".rustup"));
  assert.ok(result.env.PATH.includes(dirname(cargoPath)));
});

test("Case F: launcher --print-child-env does not mutate parent HOME/PATH", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-f-"));
  fakeCargoBin(join(tmp, ".cargo"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });

  const parentHome = process.env.HOME;
  const parentPath = process.env.PATH;

  const nodeBinDir = dirname(process.execPath);
  const run = spawnSync(
    "bash",
    [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
    {
      env: {
        ...process.env,
        REAL_HOME: tmp,
        PATH: `${nodeBinDir}:/usr/bin:/bin`,
        HOME: parentHome,
      },
      encoding: "utf8",
    },
  );

  assert.equal(process.env.HOME, parentHome);
  assert.equal(process.env.PATH, parentPath);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const childEnv = JSON.parse(run.stdout.trim());
  assert.equal(childEnv.HOME, isolated);
  assert.equal(childEnv.CARGO_HOME, join(tmp, ".cargo"));
  assert.equal(childEnv.RUSTUP_HOME, join(tmp, ".rustup"));
  assert.ok(childEnv.PATH.includes(join(tmp, ".cargo", "bin")));
});

test("prepare script prints code-derived catalog path without bundle-id segment", () => {
  const prepare = readFileSync(
    join(ROOT_DIR, "scripts/prepare-ui-workspace-native-acceptance.sh"),
    "utf8",
  );
  assert.match(
    prepare,
    /Library\/Application Support\/MasterOCTa\/catalog\.sqlite3/,
  );
  assert.doesNotMatch(
    prepare,
    /Application Support\/\$\{BUNDLE_ID\}/,
  );
  assert.doesNotMatch(
    prepare,
    /jp\.d3nousan\.masterocta\/MasterOCTa/,
  );
});

test("native acceptance docs launch from current checkout, not historical #136 worktree", () => {
  const docs = readFileSync(
    join(ROOT_DIR, "docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md"),
    "utf8",
  );
  const operatorSection = docs.slice(docs.indexOf("## Operator commands (next)"));
  assert.doesNotMatch(
    operatorSection,
    /cd \.worktrees\/ui-workspace-native-acceptance-1/,
  );
  assert.match(
    operatorSection,
    /Library\/Application Support\/MasterOCTa\/catalog\.sqlite3/,
  );
});
