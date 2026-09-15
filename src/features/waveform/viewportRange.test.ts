import { describe, expect, it } from "vitest";
import {
  clampViewportToFile,
  framesFromDragPixels,
  frameRangesEqual,
  fullFileViewport,
  panViewport,
  positionInViewport,
  viewportAroundRange,
  viewportLength,
  waveformQueryKey,
  zoomViewport,
} from "./viewportRange";

describe("fullFileViewport", () => {
  it("covers the entire file", () => {
    expect(fullFileViewport("44100")).toEqual({
      startFrame: "0",
      endFrameExclusive: "44100",
    });
  });

  it("handles zero-length files", () => {
    expect(fullFileViewport("0")).toEqual({
      startFrame: "0",
      endFrameExclusive: "0",
    });
  });
});

describe("zoomViewport", () => {
  it("zooms in around the center", () => {
    const view = { startFrame: "0", endFrameExclusive: "1000" };
    const zoomed = zoomViewport(view, "1000", true);
    expect(viewportLength(zoomed)).toBe(500n);
    expect(zoomed.startFrame).toBe("250");
    expect(zoomed.endFrameExclusive).toBe("750");
  });

  it("clamps at file start when the centered zoom would cross zero", () => {
    const clamped = clampViewportToFile(50n, 10n, "1000");
    expect(clamped.startFrame).toBe("0");
    expect(clamped.endFrameExclusive).toBe("50");
  });

  it("allows a one-frame minimum width", () => {
    const view = { startFrame: "10", endFrameExclusive: "12" };
    const zoomed = zoomViewport(view, "100", true);
    expect(viewportLength(zoomed)).toBe(1n);
  });

  it("zooms out by doubling the viewport width", () => {
    const view = { startFrame: "100", endFrameExclusive: "200" };
    const zoomed = zoomViewport(view, "1000", false);
    expect(viewportLength(zoomed)).toBe(200n);
    expect(zoomed.startFrame).toBe("50");
    expect(zoomed.endFrameExclusive).toBe("250");
  });

  it("cannot exceed the full file width when zooming out", () => {
    let view = { startFrame: "0", endFrameExclusive: "600" };
    view = zoomViewport(view, "1000", false);
    expect(view).toEqual(fullFileViewport("1000"));
  });
});

describe("panViewport", () => {
  it("moves earlier by one quarter of the viewport width", () => {
    const view = { startFrame: "400", endFrameExclusive: "800" };
    const panned = panViewport(view, "1000", -1);
    expect(panned.startFrame).toBe("300");
    expect(panned.endFrameExclusive).toBe("700");
  });

  it("clamps at the file end", () => {
    const view = { startFrame: "700", endFrameExclusive: "1000" };
    const panned = panViewport(view, "1000", 1);
    expect(panned.endFrameExclusive).toBe("1000");
    expect(viewportLength(panned)).toBe(300n);
  });
});

describe("viewportAroundRange", () => {
  it("fits the committed selection", () => {
    const selection = { startFrame: "100", endFrameExclusive: "200" };
    expect(viewportAroundRange(selection, "1000")).toEqual(selection);
  });
});

describe("framesFromDragPixels", () => {
  const view = { startFrame: "0", endFrameExclusive: "640" };

  it("maps left-to-right drags", () => {
    expect(framesFromDragPixels(view, 640, 64, 320)).toEqual({
      startFrame: "64",
      endFrameExclusive: "320",
    });
  });

  it("maps right-to-left drags to the same range", () => {
    expect(framesFromDragPixels(view, 640, 320, 64)).toEqual({
      startFrame: "64",
      endFrameExclusive: "320",
    });
  });

  it("rejects zero-width drags", () => {
    expect(framesFromDragPixels(view, 640, 100, 100)).toBeNull();
  });

  it("clamps coordinates outside the plot", () => {
    expect(framesFromDragPixels(view, 640, -50, 700)).toEqual({
      startFrame: "0",
      endFrameExclusive: "640",
    });
  });

  it("preserves precision beyond Number.MAX_SAFE_INTEGER", () => {
    const hugeView = {
      startFrame: "9007199254740992",
      endFrameExclusive: "9007199254740994",
    };
    const range = framesFromDragPixels(hugeView, 100, 0, 50);
    expect(range).toEqual({
      startFrame: "9007199254740992",
      endFrameExclusive: "9007199254740993",
    });
  });
});

describe("positionInViewport", () => {
  it("returns a ratio within the viewport", () => {
    const view = { startFrame: "100", endFrameExclusive: "200" };
    expect(positionInViewport("150", view)).toBe(0.5);
  });
});

describe("waveformQueryKey", () => {
  it("includes viewport endpoints and targetPoints", () => {
    const key = waveformQueryKey("root", "asset", { startFrame: "0", endFrameExclusive: "10" }, 640);
    expect(key).toContain("0");
    expect(key).toContain("10");
    expect(key).toContain("640");
    expect(frameRangesEqual(
      { startFrame: "0", endFrameExclusive: "10" },
      { startFrame: "0", endFrameExclusive: "10" },
    )).toBe(true);
  });
});
