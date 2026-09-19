import { describe, expect, it } from "vitest";
import { tEn, tJa } from "../../i18n/testStrings";
import {
  isAnalysisSessionInvalid,
  normalizeSliceError,
  shouldShowDiagnosticDetail,
  sliceErrorSummary,
} from "./sliceErrors";

describe("sliceErrors", () => {
  it("embeds INVALID_SLICE_REQUEST backend message in the alert summary", () => {
    const state = normalizeSliceError({
      code: "INVALID_SLICE_REQUEST",
      message: "preview exceeds 30 seconds or 16 MiB",
    });
    expect(state.code).toBe("INVALID_SLICE_REQUEST");
    expect(state.detail).toBe("preview exceeds 30 seconds or 16 MiB");
    expect(shouldShowDiagnosticDetail(state)).toBe(false);
    expect(sliceErrorSummary(tJa, state)).toBe(
      tJa("slicing.error.genericDetail", { detail: "preview exceeds 30 seconds or 16 MiB" }),
    );
    expect(sliceErrorSummary(tEn, state)).toBe(
      tEn("slicing.error.genericDetail", { detail: "preview exceeds 30 seconds or 16 MiB" }),
    );
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
    expect(sliceErrorSummary(tJa, outside)).toBe(
      tJa("slicing.error.genericDetail", { detail: "range is outside the analyzed PCM" }),
    );
  });

  it("falls back to catalog string when INVALID_SLICE_REQUEST has no message", () => {
    const state = normalizeSliceError({ code: "INVALID_SLICE_REQUEST" });
    expect(sliceErrorSummary(tJa, state)).toBe(tJa("slicing.error.INVALID_SLICE_REQUEST"));
  });

  it("uses translated summary only for structured non-INVALID codes", () => {
    const state = normalizeSliceError({
      code: "ANALYSIS_REGION_MISMATCH",
      message: "existing draft uses a different analysis region",
    });
    expect(shouldShowDiagnosticDetail(state)).toBe(false);
    expect(sliceErrorSummary(tJa, state)).toBe(tJa("slicing.error.ANALYSIS_REGION_MISMATCH"));
  });

  it("keeps ANALYSIS_NOT_FOUND copy and adds ANALYSIS_EXPIRED as a distinct code", () => {
    const missing = normalizeSliceError({
      code: "ANALYSIS_NOT_FOUND",
      message: "analysis or preview is unavailable",
    });
    const expired = normalizeSliceError({
      code: "ANALYSIS_EXPIRED",
      message: "the analysis session has expired",
    });
    expect(isAnalysisSessionInvalid(missing)).toBe(true);
    expect(isAnalysisSessionInvalid(expired)).toBe(true);
    expect(shouldShowDiagnosticDetail(missing)).toBe(false);
    expect(shouldShowDiagnosticDetail(expired)).toBe(false);
    expect(sliceErrorSummary(tJa, missing)).toBe(tJa("slicing.error.ANALYSIS_NOT_FOUND"));
    expect(sliceErrorSummary(tEn, missing)).toBe(tEn("slicing.error.ANALYSIS_NOT_FOUND"));
    expect(sliceErrorSummary(tJa, expired)).toBe(tJa("slicing.error.ANALYSIS_EXPIRED"));
    expect(sliceErrorSummary(tEn, expired)).toBe(tEn("slicing.error.ANALYSIS_EXPIRED"));
  });

  it("normalizes string and Error inputs", () => {
    expect(normalizeSliceError("Region end must follow its start.")).toEqual({
      detail: "Region end must follow its start.",
    });
    expect(normalizeSliceError(new Error("boom")).detail).toBe("boom");
  });
});
