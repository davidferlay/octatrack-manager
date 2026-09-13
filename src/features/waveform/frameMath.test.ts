import { describe, expect, it } from "vitest";
import {
  durationLabelForFrame,
  durationSeconds,
  frame,
  frameFitsJsNumber,
  validateFrameRange,
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

  it("labels duration only when frames fit the JS safe integer range", () => {
    expect(durationLabelForFrame("44100", 44100)).toBe("0:01");
    expect(durationLabelForFrame("9007199254740993", 44100)).toBeNull();
    expect(frameFitsJsNumber("9007199254740993")).toBe(false);
  });

  it("validates half-open frame ranges against the file frame count", () => {
    expect(() => validateFrameRange("0", "100", "100")).not.toThrow();
    expect(() => validateFrameRange("10", "10", "100")).toThrow(/empty or inverted/);
    expect(() => validateFrameRange("0", "101", "100")).toThrow(/beyond the file length/);
  });
});
