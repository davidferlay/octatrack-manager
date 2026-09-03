import { vi } from "vitest";
import type { RenameApi } from "../api";

/** Stub methods added in Phase 4D for tests that only exercise prepare flow. */
export function renameOperatorApiStubs(): Pick<
  RenameApi,
  | "getPreparedPlan"
  | "continuationStatus"
  | "continueOperation"
  | "apply"
  | "verifyCommitted"
  | "recover"
  | "verifyRolledBack"
> {
  return {
    getPreparedPlan: vi.fn(),
    continuationStatus: vi.fn(),
    continueOperation: vi.fn(),
    apply: vi.fn(),
    verifyCommitted: vi.fn(),
    recover: vi.fn(),
    verifyRolledBack: vi.fn(),
  };
}
