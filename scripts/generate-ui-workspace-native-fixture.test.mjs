import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { generateUiWorkspaceNativeFixture } from "./generate-ui-workspace-native-fixture.mjs";
import {
  cleanupOwnedFixtureRoot,
  createManagedFixtureRoot,
  validateEmptyFixtureRoot,
} from "./ui-workspace-fixture-safe.mjs";
import {
  M7_RANGE_SHA256,
  sha256FileHex,
  verifyRangeWavSha256,
} from "./verify-ui-workspace-range-sha.mjs";

const PROJECT_SHA = "742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6";

test("managed generation matches M7 RANGE.wav SHA and sample B length", async () => {
  const manifest = await generateUiWorkspaceNativeFixture();
  try {
    const sampleA = manifest.files.find((f) => f.role === "sampleA");
    assert.equal(sampleA.sha256, M7_RANGE_SHA256);
    assert.equal(sampleA.frameCount, 264600);
    assert.equal(manifest.project.sha256, PROJECT_SHA);
    assert.ok(manifest.files.some((f) => f.role === "sampleB" && f.frameCount === 176400));
    const rangePath = join(manifest.fixtureRoot, "SET/AUDIO/RANGE.wav");
    assert.equal(sha256FileHex(rangePath), M7_RANGE_SHA256);
    verifyRangeWavSha256(rangePath);
    assert.ok(manifest.acceptanceLocations.emptyList.relativePath.includes("ACCEPT_PROJ"));
  } finally {
    cleanupOwnedFixtureRoot(manifest.fixtureRoot);
  }
});

test("verify RANGE.sha fails on tampered bytes", () => {
  const root = createManagedFixtureRoot();
  try {
    writeFileSync(join(root, "bad.wav"), Buffer.from("not-range"));
    assert.throws(() => verifyRangeWavSha256(join(root, "bad.wav")), /SHA-256 mismatch/);
  } finally {
    cleanupOwnedFixtureRoot(root);
  }
});

test("rejects non-empty fixture root and preserves sentinel", async () => {
  const root = createManagedFixtureRoot();
  const sentinel = join(root, "sentinel.txt");
  writeFileSync(sentinel, "keep-me", { flag: "wx" });
  const before = readFileSync(sentinel, "utf8");
  await assert.rejects(
    () => generateUiWorkspaceNativeFixture({ fixtureRoot: root }),
    /must be empty/,
  );
  assert.equal(readFileSync(sentinel, "utf8"), before);
  cleanupOwnedFixtureRoot(root);
});

test("rejects existing SET layout and preserves sentinel", async () => {
  const root = createManagedFixtureRoot();
  const sentinel = join(root, "sentinel.txt");
  writeFileSync(sentinel, "keep-me", { flag: "wx" });
  mkdirSync(join(root, "SET"));
  const before = readFileSync(sentinel, "utf8");
  await assert.rejects(
    () => generateUiWorkspaceNativeFixture({ fixtureRoot: root }),
    /must be empty|refusing to reuse/,
  );
  assert.equal(readFileSync(sentinel, "utf8"), before);
  cleanupOwnedFixtureRoot(root);
});

test("rejects fixture root symlink", async () => {
  const target = createManagedFixtureRoot();
  const linkParent = mkdtempSync(join(tmpdir(), "mo-ui-native-link-parent-"));
  const linkPath = join(linkParent, "link-root");
  symlinkSync(target, linkPath);
  try {
    assert.throws(() => validateEmptyFixtureRoot(linkPath), /must not be a symlink/);
    await assert.rejects(
      () => generateUiWorkspaceNativeFixture({ fixtureRoot: linkPath }),
      /must not be a symlink/,
    );
  } finally {
    rmSync(linkParent, { recursive: true, force: true });
    cleanupOwnedFixtureRoot(target);
  }
});

test("refuses second generation into same root", async () => {
  const root = createManagedFixtureRoot();
  try {
    await generateUiWorkspaceNativeFixture({ fixtureRoot: root });
    await assert.rejects(
      () => generateUiWorkspaceNativeFixture({ fixtureRoot: root }),
      /must be empty|refusing to reuse/,
    );
  } finally {
    cleanupOwnedFixtureRoot(root);
  }
});

test("supports unicode temp parent path", async () => {
  const parent = mkdtempSync(join(tmpdir(), "mo-ui-native-日本語-"));
  const root = mkdtempSync(join(parent, "set-"));
  try {
    const manifest = await generateUiWorkspaceNativeFixture({ fixtureRoot: root });
    assert.equal(
      sha256FileHex(join(manifest.fixtureRoot, "SET/AUDIO/RANGE.wav")),
      M7_RANGE_SHA256,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("CLI generation exits non-zero when RANGE path missing for verify script", () => {
  const verifyScript = join(
    dirname(fileURLToPath(import.meta.url)),
    "verify-ui-workspace-range-sha.mjs",
  );
  const missing = spawnSync(process.execPath, [verifyScript, join(tmpdir(), "missing-range.wav")], {
    encoding: "utf8",
  });
  assert.notEqual(missing.status, 0);
});
