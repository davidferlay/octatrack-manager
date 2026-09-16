#!/usr/bin/env node
/**
 * Synthetic Octatrack Set for MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1.
 * Creates a managed temp fixture root; does not accept arbitrary output paths.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupOwnedFixtureRoot,
  createManagedFixtureRoot,
  validateEmptyFixtureRoot,
  writeFileExclusive,
} from "./ui-workspace-fixture-safe.mjs";
import { M7_RANGE_SHA256 } from "./verify-ui-workspace-range-sha.mjs";

const RATE = 44_100;
const CHANNELS = 1;
const BITS = 16;
const PEAK = 0.8;

const A_DURATION_S = 6;
const A_FRAME_COUNT = RATE * A_DURATION_S;
export const ATTACK_FRAMES_A = [22_050, 66_150, 110_250, 198_450];
export const RANGE_A = { start: 44_100, endExclusive: 132_300 };
export const RANGE_B = { start: 176_400, endExclusive: 220_500 };

const B_DURATION_S = 4;
const B_FRAME_COUNT = RATE * B_DURATION_S;
const ATTACK_FRAMES_B = [8_820, 52_920, 132_300];

function burstSample(offset, rate) {
  const phase = ((offset * 1103515245 + 12345) >>> 0) >> 8 & 65535;
  return (
    (phase / 32768 - 1) *
    Math.exp(-offset / (rate * 0.002)) *
    PEAK
  );
}

function buildPcmWithAttacks(frameCount, attackFrames) {
  const samples = new Float32Array(frameCount);
  const burstLen = RATE / 100;
  for (const attack of attackFrames) {
    for (let offset = 0; offset < burstLen; offset++) {
      const n = attack + offset;
      if (n >= frameCount) break;
      samples[n] = burstSample(offset, RATE);
    }
  }
  return samples;
}

function floatToInt16(samples) {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return out;
}

function wavHeader(dataBytes, sampleRate = RATE) {
  const blockAlign = (CHANNELS * BITS) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function buildWavBuffer(pcmFloat) {
  const data = floatToInt16(pcmFloat);
  const file = Buffer.concat([wavHeader(data.length), data]);
  return { file, frameCount: pcmFloat.length };
}

/**
 * @param {string} root canonical fixture root
 * @param {string} relativePath
 * @param {Float32Array} pcmFloat
 */
function writeWav(root, relativePath, pcmFloat) {
  const wavPath = join(root, relativePath);
  const { file, frameCount } = buildWavBuffer(pcmFloat);
  writeFileExclusive(wavPath, file);
  const sha256 = createHash("sha256").update(file).digest("hex");
  return {
    pathRelative: relativePath.replace(/\\/g, "/"),
    byteSize: file.length,
    sha256,
    sampleRate: RATE,
    channels: CHANNELS,
    bitsPerSample: BITS,
    frameCount,
  };
}

function writeSilentWav(root, relativePath, durationS) {
  const frameCount = RATE * durationS;
  return writeWav(root, relativePath, new Float32Array(frameCount));
}

/**
 * @param {{ fixtureRoot?: string, managed?: boolean }} options
 */
export async function generateUiWorkspaceNativeFixture(options = {}) {
  let ownedRoot = null;
  let fixtureRoot;
  if (options.fixtureRoot) {
    fixtureRoot = validateEmptyFixtureRoot(options.fixtureRoot);
  } else {
    fixtureRoot = createManagedFixtureRoot();
    ownedRoot = fixtureRoot;
  }

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(scriptDir, "..");
    const projectFixture = join(
      repoRoot,
      "src-tauri/tests/fixtures/real_device_os_1_40/project.work",
    );
    const projectDir = join(fixtureRoot, "SET", "ACCEPT_PROJ");
    writeFileExclusive(
      join(projectDir, "project.work"),
      readFileSync(projectFixture),
    );
    const projectWorkSha = createHash("sha256")
      .update(readFileSync(join(projectDir, "project.work")))
      .digest("hex");

    const files = [];

    const sampleA = writeWav(
      fixtureRoot,
      "SET/AUDIO/RANGE.wav",
      buildPcmWithAttacks(A_FRAME_COUNT, ATTACK_FRAMES_A),
    );
    sampleA.role = "sampleA";
    sampleA.attackFrames = ATTACK_FRAMES_A;
    sampleA.rangeA = RANGE_A;
    sampleA.rangeB = RANGE_B;
    files.push(sampleA);

    const sampleB = writeWav(
      fixtureRoot,
      "SET/AUDIO/ALT_FOUR_SEC.wav",
      buildPcmWithAttacks(B_FRAME_COUNT, ATTACK_FRAMES_B),
    );
    sampleB.role = "sampleB";
    sampleB.attackFrames = ATTACK_FRAMES_B;
    files.push(sampleB);

    const ja = writeSilentWav(fixtureRoot, "SET/AUDIO/キック_受入.wav", 1);
    ja.role = "japaneseName";
    files.push(ja);

    const longName =
      "SET/AUDIO/very_long_disposable_name_for_layout_overflow_acceptance_check.wav";
    const long = writeSilentWav(fixtureRoot, longName, 1);
    long.role = "longName";
    files.push(long);

    const noSearch = writeSilentWav(fixtureRoot, "SET/AUDIO/zz_no_search_hit.wav", 1);
    noSearch.role = "searchZeroHint";
    files.push(noSearch);

    for (const [name, role] of [
      ["ops_clone_src.wav", "opsClone"],
      ["ops_rename_src.wav", "opsRename"],
      ["ops_copy_src.wav", "opsCopy"],
    ]) {
      const entry = writeSilentWav(fixtureRoot, `SET/AUDIO/${name}`, 1);
      entry.role = role;
      files.push(entry);
    }

    if (sampleA.sha256 !== M7_RANGE_SHA256) {
      throw new Error(
        `internal RANGE.wav SHA-256 drift: expected ${M7_RANGE_SHA256}, got ${sampleA.sha256}`,
      );
    }

    return {
      fixtureRoot,
      ownedRoot,
      generator: "generate-ui-workspace-native-fixture.mjs",
      setLayout: "SET/AUDIO/ (Set = directory containing AUDIO/)",
      project: {
        pathRelative: "SET/ACCEPT_PROJ/project.work",
        sha256: projectWorkSha,
        sourceFixture: "src-tauri/tests/fixtures/real_device_os_1_40/project.work",
      },
      acceptanceLocations: {
        emptyList: {
          catalogKind: "project",
          relativePath: "SET/ACCEPT_PROJ",
          displayName: "ACCEPT_PROJ",
          note: "Project location with zero indexed audio files (only project.work).",
        },
        searchZero: {
          catalogKind: "set_audio_pool",
          parentPath: "SET",
          exampleQuery: "xyzzy_nomatch",
          note: "Audio pool contains files; query with no matches yields zero hits.",
        },
      },
      files,
    };
  } catch (error) {
    if (ownedRoot) {
      cleanupOwnedFixtureRoot(ownedRoot);
    }
    throw error;
  }
}

async function main() {
  const manifest = await generateUiWorkspaceNativeFixture();
  console.log(JSON.stringify(manifest, null, 2));
}

function isMainModule() {
  const selfPath = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return selfPath === invoked;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
