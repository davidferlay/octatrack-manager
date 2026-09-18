import { describe, expect, it } from "vitest";
import { applyWideSourcesNavTransition, resetWideSourcesNav } from "./wideSourcesNav";

describe("applyWideSourcesNavTransition", () => {
  it("records open while staying wide", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: false,
      wasNarrow: false,
      navigationOpen: true,
      recordedWideOpen: null,
    });
    expect(next).toEqual({
      nextOpen: true,
      recordedWideOpen: true,
      wasNarrow: false,
    });
  });

  it("records closed while staying wide", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: false,
      wasNarrow: false,
      navigationOpen: false,
      recordedWideOpen: true,
    });
    expect(next.recordedWideOpen).toBe(false);
    expect(next.nextOpen).toBe(false);
  });

  it("closes the drawer on enter-narrow without overwriting a closed wide snapshot", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: true,
      wasNarrow: false,
      navigationOpen: false,
      recordedWideOpen: false,
    });
    expect(next.nextOpen).toBe(false);
    expect(next.recordedWideOpen).toBe(false);
    expect(next.wasNarrow).toBe(true);
  });

  it("does not let a narrow drawer open overwrite the saved wide closed state", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: true,
      wasNarrow: true,
      navigationOpen: true,
      recordedWideOpen: false,
    });
    expect(next.nextOpen).toBe(true);
    expect(next.recordedWideOpen).toBe(false);
  });

  it("restores closed after leaving narrow", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: false,
      wasNarrow: true,
      navigationOpen: true,
      recordedWideOpen: false,
    });
    expect(next.nextOpen).toBe(false);
    expect(next.recordedWideOpen).toBe(false);
  });

  it("restores open after leaving narrow", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: false,
      wasNarrow: true,
      navigationOpen: false,
      recordedWideOpen: true,
    });
    expect(next.nextOpen).toBe(true);
  });

  it("uses default open when leaving narrow with no recorded wide state", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: true,
      narrowActive: false,
      wasNarrow: true,
      navigationOpen: false,
      recordedWideOpen: null,
    });
    expect(next.nextOpen).toBe(true);
    expect(next.recordedWideOpen).toBeNull();
  });

  it("does not record a wide preference before catalog is ready", () => {
    const next = applyWideSourcesNavTransition({
      catalogReady: false,
      narrowActive: true,
      wasNarrow: false,
      navigationOpen: true,
      recordedWideOpen: null,
    });
    expect(next.recordedWideOpen).toBeNull();
    expect(next.wasNarrow).toBe(false);
  });

  it("resets recorded state on root change", () => {
    expect(resetWideSourcesNav()).toEqual({
      nextOpen: true,
      recordedWideOpen: null,
      wasNarrow: false,
    });
  });
});
