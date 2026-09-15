import { describe, expect, it } from "vitest";
import {
  applyGeometryNotification,
  selectEffectiveLibraryRange,
  type LibraryGeometryBinding,
  type LibraryGeometryNotification,
} from "./libraryGeometrySelection";

const targetA = {
  rootId: "root-1",
  fileInstanceId: "file-a",
  assetId: "asset-a",
};

const targetB = {
  rootId: "root-1",
  fileInstanceId: "file-b",
  assetId: "asset-b",
};

const rangeA = { startFrame: "1000", endFrameExclusive: "2000" };
const rangeB = { startFrame: "3000", endFrameExclusive: "4000" };

function notify(
  target: typeof targetA,
  generation: number,
  range: typeof rangeA | null,
): LibraryGeometryNotification {
  return { ...target, selectionGeneration: generation, range };
}

describe("libraryGeometrySelection", () => {
  it("ignores stale notify from previous sample after B is selected", () => {
    let stored: LibraryGeometryBinding | null = applyGeometryNotification(
      null,
      notify(targetB, 2, rangeB),
      targetB,
      2,
    );
    stored = applyGeometryNotification(stored, notify(targetA, 1, rangeA), targetB, 2);
    expect(selectEffectiveLibraryRange(stored, targetB, 2)).toEqual(rangeB);
  });

  it("ignores delayed notify from A after generation bumped for B", () => {
    let stored = applyGeometryNotification(null, notify(targetA, 1, rangeA), targetA, 1);
    stored = applyGeometryNotification(stored, notify(targetA, 1, rangeA), targetA, 2);
    expect(selectEffectiveLibraryRange(stored, targetA, 2)).toBeNull();
  });

  it("accepts matching notify for the active generation", () => {
    const stored = applyGeometryNotification(null, notify(targetB, 3, rangeB), targetB, 3);
    expect(selectEffectiveLibraryRange(stored, targetB, 3)).toEqual(rangeB);
  });

  it("clears effective range when root identity changes", () => {
    const stored = applyGeometryNotification(null, notify(targetA, 1, rangeA), targetA, 1);
    expect(selectEffectiveLibraryRange(stored, { ...targetA, rootId: "root-2" }, 1)).toBeNull();
  });

  it("does not resurrect old range on A→B→A when generation advanced", () => {
    let stored = applyGeometryNotification(null, notify(targetA, 1, rangeA), targetA, 1);
    stored = applyGeometryNotification(stored, notify(targetB, 2, rangeB), targetB, 2);
    stored = applyGeometryNotification(stored, notify(targetA, 1, rangeA), targetA, 3);
    expect(selectEffectiveLibraryRange(stored, targetA, 3)).toBeNull();
    stored = applyGeometryNotification(stored, notify(targetA, 3, rangeA), targetA, 3);
    expect(selectEffectiveLibraryRange(stored, targetA, 3)).toEqual(rangeA);
  });
});
