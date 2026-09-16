import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const M7_RANGE_SHA = "43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1";
const PROJECT_SHA = "742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6";

test("ui workspace native fixture keeps M7 RANGE.wav bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "mo-ui-native-fix-"));
  try {
    const script = join(dirname(fileURLToPath(import.meta.url)), "generate-ui-workspace-native-fixture.mjs");
    const out = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const manifest = JSON.parse(out.stdout);
    const sampleA = manifest.files.find((f) => f.role === "sampleA");
    assert.equal(sampleA.sha256, M7_RANGE_SHA);
    assert.equal(sampleA.frameCount, 264600);
    assert.equal(manifest.project.sha256, PROJECT_SHA);
    assert.ok(manifest.files.some((f) => f.role === "sampleB" && f.frameCount === 176400));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
