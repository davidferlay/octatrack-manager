#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const M7_RANGE_SHA256 =
  "43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1";

/**
 * @param {string} rangeWavPath
 * @returns {string} computed sha256 hex
 */
export function sha256FileHex(rangeWavPath) {
  const bytes = readFileSync(rangeWavPath);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {string} rangeWavPath
 */
export function verifyRangeWavSha256(rangeWavPath) {
  const path = resolve(rangeWavPath);
  const actual = sha256FileHex(path);
  if (actual !== M7_RANGE_SHA256) {
    throw new Error(
      `RANGE.wav SHA-256 mismatch: expected ${M7_RANGE_SHA256}, got ${actual} (${path})`,
    );
  }
  return actual;
}

function main() {
  const wavPath = process.argv[2];
  if (!wavPath) {
    console.error("Usage: node scripts/verify-ui-workspace-range-sha.mjs <path/to/RANGE.wav>");
    process.exit(2);
  }
  try {
    const sha = verifyRangeWavSha256(wavPath);
    console.log(`range_sha256_ok=${sha}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
