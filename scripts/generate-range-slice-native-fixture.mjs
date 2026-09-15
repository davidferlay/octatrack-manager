#!/usr/bin/env node
/**
 * Deterministic 44.1 kHz / 16-bit mono / 6 s WAV for M7 native range→slice acceptance.
 * Burst synthesis matches ot-audio onsets.rs `fixture()` (broadband burst, peak 0.8).
 *
 * Usage: node scripts/generate-range-slice-native-fixture.mjs <octatrack-root>
 * Creates: <root>/SET/AUDIO/RANGE.wav
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RATE = 44_100;
const CHANNELS = 1;
const BITS = 16;
const DURATION_S = 6;
const FRAME_COUNT = RATE * DURATION_S;
const PEAK = 0.8;

/** Annotated attack frames (absolute PCM). */
export const ATTACK_FRAMES = [22_050, 66_150, 110_250, 198_450];

/** Acceptance ranges (half-open). */
export const RANGE_A = { start: 44_100, endExclusive: 132_300 };
export const RANGE_B = { start: 176_400, endExclusive: 220_500 };

function burstSample(offset, rate) {
  const phase = ((offset * 1103515245 + 12345) >>> 0) >> 8 & 65535;
  const value =
    (phase / 32768 - 1) *
    Math.exp(-offset / (rate * 0.002)) *
    PEAK;
  return value;
}

function buildPcmFloat32() {
  const samples = new Float32Array(FRAME_COUNT);
  const burstLen = RATE / 100;
  for (const attack of ATTACK_FRAMES) {
    for (let offset = 0; offset < burstLen; offset++) {
      const n = attack + offset;
      if (n >= FRAME_COUNT) break;
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

function wavHeader(dataBytes) {
  const blockAlign = (CHANNELS * BITS) / 8;
  const byteRate = RATE * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: node scripts/generate-range-slice-native-fixture.mjs <octatrack-root>");
    process.exit(1);
  }

  const wavPath = join(root, "SET", "AUDIO", "RANGE.wav");
  await mkdir(dirname(wavPath), { recursive: true });

  const pcm = buildPcmFloat32();
  const data = floatToInt16(pcm);
  const file = Buffer.concat([wavHeader(data.length), data]);
  await writeFile(wavPath, file);

  const sha256 = createHash("sha256").update(file).digest("hex");
  const payload = {
    pathRelative: "SET/AUDIO/RANGE.wav",
    byteSize: file.length,
    sha256,
    sampleRate: RATE,
    channels: CHANNELS,
    bitsPerSample: BITS,
    frameCount: FRAME_COUNT,
    attackFrames: ATTACK_FRAMES,
    rangeA: RANGE_A,
    rangeB: RANGE_B,
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
