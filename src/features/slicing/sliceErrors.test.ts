import { describe, expect, it } from "vitest";
import { tEn, tJa } from "../../i18n/testStrings";
import {
  normalizeSliceError,
  shouldShowDiagnosticDetail,
  sliceErrorSummary,
} from "./sliceErrors";

describe("sliceErrors", () => {
  it("preserves INVALID_SLICE_REQUEST backend message as diagnostic detail", () => {
    const state = normalizeSliceError({
      code: "INVALID_SLICE_REQUEST",
      message: "preview exceeds 30 seconds or 16 MiB",
    });
    expect(state.code).toBe("INVALID_SLICE_REQUEST");
    expect(state.detail).toBe("preview exceeds 30 seconds or 16 MiB");
    expect(shouldShowDiagnosticDetail(state)).toBe(true);
    expect(sliceErrorSummary(tJa, state)).toBe(tJa("slicing.error.INVALID_SLICE_REQUEST"));
    expect(sliceErrorSummary(tEn, state)).toBe(tEn("slicing.error.INVALID_SLICE_REQUEST"));
  });

  it("keeps distinct INVALID messages for operator diagnosis", () => {
    const outside = normalizeSliceError({
      code: "INVALID_SLICE_REQUEST",
      message: "range is outside the analyzed PCM",
    });
    const history = normalizeSliceError({
      code: "INVALID_SLICE_REQUEST",
      message: "history is empty",
    });
    expect(outside.detail).not.toBe(history.detail);
    expect(sliceErrorSummary(tJa, outside)).toBe(tJa("slicing.error.INVALID_SLICE_REQUEST"));
  });

  it("uses translated summary only for structured non-INVALID codes", () => {
    const state = normalizeSliceError({
      code: "ANALYSIS_REGION_MISMATCH",
      message: "existing draft uses a different analysis region",
    });
    expect(shouldShowDiagnosticDetail(state)).toBe(false);
    expect(sliceErrorSummary(tJa, state)).toBe(tJa("slicing.error.ANALYSIS_REGION_MISMATCH"));
  });

  it("normalizes string and Error inputs", () => {
    expect(normalizeSliceError("Region end must follow its start.")).toEqual({
      detail: "Region end must follow its start.",
    });
    expect(normalizeSliceError(new Error("boom")).detail).toBe("boom");
  });
});
