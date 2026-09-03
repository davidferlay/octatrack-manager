import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RootSession } from "../../api";
import { CloneOperatorPanel } from "./CloneOperatorPanel";

function session(): RootSession {
  return {
    rootId: "root-opaque",
    displayName: "Fixture Root",
    deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
    mode: "read_only",
    observedRevision: 1,
    expiresInSeconds: 3600,
    writeGrantExpiresInSeconds: null,
    capabilities: { read: true, write: true, stableDeviceIdentity: true },
  };
}

describe("CloneOperatorPanel", () => {
  it("requires external acknowledgement before verify", async () => {
    const onVerifyExternal = vi.fn().mockResolvedValue(undefined);
    render(
      <CloneOperatorPanel
        session={session()}
        cloneVerification={null}
        sourceEvidenceRecorded
        onCreateManagedClone={vi.fn()}
        onRecordSourceEvidence={vi.fn()}
        onRegisterExternalClone={vi.fn()}
        onVerifyExternal={onVerifyExternal}
        onReverify={vi.fn()}
      />,
    );

    expect(screen.getByText("READ-ONLY SOURCE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify external clone" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", {
      name: /disposable clone and not the only copy/i,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Verify external clone" }));
    await waitFor(() => expect(onVerifyExternal).toHaveBeenCalledWith(true));
  });
});
