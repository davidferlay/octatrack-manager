#!/usr/bin/env node
/**
 * Synthetic Octatrack Set for MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1.
 * RANGE.wav matches scripts/generate-range-slice-native-fixture.mjs (M7 contract).
 *
 * Usage: node scripts/generate-ui-workspace-native-fixture.mjs <octatrack-root>
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44_100;
const CHANNELS = 1;
const BITS = 16;
const PEAK = 0.8;

/** Sample A — 6 s (M7 RANGE.wav). */
const A_DURATION_S = 6;
const A_FRAME_COUNT = RATE * A_DURATION_S;
export const ATTACK_FRAMES_A = [22_050, 66_150, 110_250, 198_450];
export const RANGE_A = { start: 44_100, endExclusive: 132_300 };
export const RANGE_B = { start: 176_400, endExclusive: 220_500 };

/** Sample B — 4 s, distinct attacks. */
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

async function writeWav(root, relativePath, pcmFloat) {
  const wavPath = join(root, relativePath);
  await mkdir(dirname(wavPath), { recursive: true });
  const { file, frameCount } = buildWavBuffer(pcmFloat);
  await writeFile(wavPath, file);
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

async function writeSilentWav(root, relativePath, durationS) {
  const frameCount = RATE * durationS;
  return writeWav(root, relativePath, new Float32Array(frameCount));
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: node scripts/generate-ui-workspace-native-fixture.mjs <octatrack-root>");
    process.exit(1);
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(scriptDir, "..");
  const projectFixture = join(
    repoRoot,
    "src-tauri/tests/fixtures/real_device_os_1_40/project.work",
  );
  const projectDir = join(root, "SET", "ACCEPT_PROJ");
  await mkdir(projectDir, { recursive: true });
  await copyFile(projectFixture, join(projectDir, "project.work"));
  const projectWorkBytes = await readFile(join(projectDir, "project.work"));
  const projectWorkSha = createHash("sha256").update(projectWorkBytes).digest("hex");

  await mkdir(join(root, "SET", "AUDIO", "EMPTY_SLOT"), { recursive: true });

  const files = [];

  files.push(
    await writeWav(
      root,
      "SET/AUDIO/RANGE.wav",
      buildPcmWithAttacks(A_FRAME_COUNT, ATTACK_FRAMES_A),
    ),
  );
  const rangeMeta = files[files.length - 1];
  rangeMeta.role = "sampleA";
  rangeMeta.attackFrames = ATTACK_FRAMES_A;
  rangeMeta.rangeA = RANGE_A;
  rangeMeta.rangeB = RANGE_B;

  const sampleB = await writeWav(
    root,
    "SET/AUDIO/ALT_FOUR_SEC.wav",
    buildPcmWithAttacks(B_FRAME_COUNT, ATTACK_FRAMES_B),
  );
  sampleB.role = "sampleB";
  sampleB.attackFrames = ATTACK_FRAMES_B;
  files.push(sampleB);

  const ja = await writeSilentWav(root, "SET/AUDIO/キック_受入.wav", 1);
  ja.role = "japaneseName";
  files.push(ja);

  const longName =
    "SET/AUDIO/very_long_disposable_name_for_layout_overflow_acceptance_check.wav";
  const long = await writeSilentWav(root, longName, 1);
  long.role = "longName";
  files.push(long);

  const noSearch = await writeSilentWav(root, "SET/AUDIO/zz_no_search_hit.wav", 1);
  noSearch.role = "searchZeroHint";
  files.push(noSearch);

  for (const [name, role] of [
    ["ops_clone_src.wav", "opsClone"],
    ["ops_rename_src.wav", "opsRename"],
    ["ops_copy_src.wav", "opsCopy"],
  ]) {
    const entry = await writeSilentWav(root, `SET/AUDIO/${name}`, 1);
    entry.role = role;
    files.push(entry);
  }

  const manifest = {
    generator: "generate-ui-workspace-native-fixture.mjs",
    setLayout: "SET/AUDIO/ (Set = directory containing AUDIO/)",
    project: {
      pathRelative: "SET/ACCEPT_PROJ/project.work",
      sha256: projectWorkSha,
      sourceFixture: "src-tauri/tests/fixtures/real_device_os_1_40/project.work",
    },
    emptyLocation: "SET/AUDIO/EMPTY_SLOT/",
    searchNote: "Query that matches no file (e.g. xyzzy) yields zero hits; EMPTY_SLOT has no WAV.",
    files,
  };

  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
