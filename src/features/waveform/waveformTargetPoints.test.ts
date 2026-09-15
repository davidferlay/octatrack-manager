import { describe, expect, it } from "vitest";
import {
  readPlotContainerWidthCss,
  targetPointsFromPlotWidthCss,
  WAVEFORM_PLOT_WIDTH_FALLBACK_CSS,
  WAVEFORM_TARGET_POINTS_MAX,
  WAVEFORM_TARGET_POINTS_MIN,
} from "./waveformTargetPoints";

describe("readPlotContainerWidthCss", () => {
  it("uses fallback when layout width is zero", () => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    expect(readPlotContainerWidthCss(element)).toBe(WAVEFORM_PLOT_WIDTH_FALLBACK_CSS);
  });
});

describe("targetPointsFromPlotWidthCss", () => {
  it("returns null for non-positive or non-finite width", () => {
    expect(targetPointsFromPlotWidthCss(0)).toBeNull();
    expect(targetPointsFromPlotWidthCss(-1)).toBeNull();
    expect(targetPointsFromPlotWidthCss(Number.NaN)).toBeNull();
  });

  it("quantizes to 64-point steps and clamps to backend bounds", () => {
    expect(targetPointsFromPlotWidthCss(100)).toBe(128);
    expect(targetPointsFromPlotWidthCss(640)).toBe(640);
    expect(targetPointsFromPlotWidthCss(16)).toBe(WAVEFORM_TARGET_POINTS_MIN);
    expect(targetPointsFromPlotWidthCss(5000)).toBe(WAVEFORM_TARGET_POINTS_MAX);
  });

  it("maps typical inspector plot widths without exceeding max", () => {
    expect(targetPointsFromPlotWidthCss(280)).toBe(256);
    expect(targetPointsFromPlotWidthCss(420)).toBe(448);
  });
});
