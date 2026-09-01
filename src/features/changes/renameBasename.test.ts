import { describe, expect, it } from "vitest";
import {
  combineBasename,
  splitRelativePath,
  validateBasename,
} from "./renameBasename";

describe("renameBasename", () => {
  it("splits and recombines same-directory paths", () => {
    expect(splitRelativePath("LIVE_SET/AUDIO/KICK.wav")).toEqual({
      parentPath: "LIVE_SET/AUDIO",
      basename: "KICK.wav",
    });
    expect(combineBasename("LIVE_SET/AUDIO", "KICK_DEEP.wav")).toBe(
      "LIVE_SET/AUDIO/KICK_DEEP.wav",
    );
  });

  it("rejects unsafe basename input", () => {
    expect(validateBasename("", "KICK.wav")).toEqual({
      ok: false,
      message: "Enter a new file name.",
    });
    expect(validateBasename("../evil.wav", "KICK.wav").ok).toBe(false);
    expect(validateBasename("KICK.wav", "KICK.wav").ok).toBe(false);
  });
});
