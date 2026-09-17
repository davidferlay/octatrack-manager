import { describe, expect, it } from "vitest";
import {
  defaultLibraryPreviewEndFrame,
  durationLabelForFrame,
  durationSeconds,
  formatPreviewFrameTimeSeconds,
  frame,
  frameFitsJsNumber,
  maxLibraryPreviewFrames,
  validateFrameRange,
  validateGeometryFrameRange,
} from "./frameMath";

describe("frameMath", () => {
  it("parses canonical decimal frame strings", () => {
    expect(frame("0")).toBe(0n);
    expect(frame("9007199254740993")).toBe(9007199254740993n);
    expect(frame("18446744073709551615")).toBe(18446744073709551615n);
  });

  it("rejects non-canonical frame strings", () => {
    expect(() => frame("01")).toThrow();
    expect(() => frame("-1")).toThrow();
  });

  it("derives duration from string frame counts without precision loss", () => {
    expect(durationSeconds("44100", 44100)).toBe(1);
    expect(durationSeconds("9007199254740992", 44100)).toBeCloseTo(
      9007199254740992 / 44100,
      5,
    );
  });

  it("formats preview frame times without invalid 60.000 seconds in the minute field", () => {
    const nearTwoMinutes = formatPreviewFrameTimeSeconds("5291999", 44100);
    expect(nearTwoMinutes).toBe("2:00.000");
    expect(nearTwoMinutes).not.toMatch(/:60\.000$/);
    expect(formatPreviewFrameTimeSeconds("44100", 44100)).toBe("1.000 s");
  });

  it("labels duration only when frames fit the JS safe integer range", () => {
    expect(durationLabelForFrame("44100", 44100)).toBe("0:01");
    expect(durationLabelForFrame("9007199254740993", 44100)).toBeNull();
    expect(frameFitsJsNumber("9007199254740993")).toBe(false);
  });

  it("validates half-open frame ranges against the file frame count", () => {
    expect(() => validateFrameRange("0", "100", "100", 44100, 2)).not.toThrow();
    expect(() => validateFrameRange("10", "10", "100", 44100, 2)).toThrow(/empty or inverted/);
    expect(() => validateFrameRange("0", "101", "100", 44100, 2)).toThrow(/beyond the file length/);
  });

  it("allows geometry-valid ranges beyond the Library preview limit for analysis handoff", () => {
    const sixtySeconds = maxLibraryPreviewFrames(44100, 2);
    const beyond = (sixtySeconds + 100n).toString();
    expect(() => validateGeometryFrameRange("0", beyond, (sixtySeconds + 200n).toString())).not.toThrow();
    expect(() => validateFrameRange("0", beyond, (sixtySeconds + 200n).toString(), 44100, 2)).toThrow(
      /60 second or 32 MiB/,
    );
  });

  it("rejects ranges over the Library 60s / 32 MiB preview limit", () => {
    const sixtySeconds = maxLibraryPreviewFrames(44100, 2);
    expect(() => validateFrameRange(
      "0",
      sixtySeconds.toString(),
      (sixtySeconds + 1n).toString(),
      44100,
      2,
    )).not.toThrow();
    expect(() => validateFrameRange(
      "0",
      (sixtySeconds + 1n).toString(),
      (sixtySeconds + 1n).toString(),
      44100,
      2,
    )).toThrow(/60 second or 32 MiB/);

    const maxByBytes = maxLibraryPreviewFrames(192000, 2);
    expect(maxByBytes).toBe(8388597n);
    expect(() => validateFrameRange("0", maxByBytes.toString(), "20000000", 192000, 2)).not.toThrow();
    expect(() => validateFrameRange(
      "0",
      (maxByBytes + 1n).toString(),
      "20000000",
      192000,
      2,
    )).toThrow(/60 second or 32 MiB/);
  });

  it("clamps the default range end to the Library preview limit", () => {
    expect(defaultLibraryPreviewEndFrame("44100", 44100, 2)).toBe("44100");
    expect(defaultLibraryPreviewEndFrame("3969000", 44100, 2)).toBe("2646000");
  });
});
