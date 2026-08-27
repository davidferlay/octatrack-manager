import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RootApi, RootSession } from "../../api";
import { RootRegistryPanel } from "./RootRegistryPanel";

const session: RootSession = {
  rootId: "root-opaque",
  displayName: "Fixture Root",
  deviceFingerprint: "0123456789abcdef",
  mode: "read_only",
  observedRevision: 1,
  expiresInSeconds: 3600,
  capabilities: {
    read: true,
    write: false,
    stableDeviceIdentity: true,
  },
};

function fakeApi(): RootApi {
  return {
    registerRoot: vi.fn().mockResolvedValue(session),
    rootStatus: vi.fn().mockResolvedValue(session),
    closeRoot: vi.fn().mockResolvedValue(undefined),
    listLibrary: vi.fn().mockResolvedValue({
      sets: [{
        displayName: "LIVE_SET",
        relativePath: "LIVE_SET",
        hasAudioPool: true,
        projects: [{
          displayName: "PROJECT_A",
          relativePath: "LIVE_SET/PROJECT_A",
          hasProjectFile: true,
          hasBanks: true,
        }],
      }],
      standaloneProjects: [],
    }),
  };
}

describe("RootRegistryPanel", () => {
  it("does nothing when the native picker is cancelled", async () => {
    const api = fakeApi();
    const selectDirectory = vi.fn().mockResolvedValue(null);
    render(<RootRegistryPanel api={api} selectDirectory={selectDirectory} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    await waitFor(() => expect(selectDirectory).toHaveBeenCalledOnce());
    expect(api.registerRoot).not.toHaveBeenCalled();
    expect(api.listLibrary).not.toHaveBeenCalled();
  });

  it("reports a native picker failure without registering a root", async () => {
    const api = fakeApi();
    const selectDirectory = vi.fn().mockRejectedValue(new Error("picker unavailable"));
    render(<RootRegistryPanel api={api} selectDirectory={selectDirectory} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    expect(await screen.findByRole("alert")).toHaveTextContent("picker unavailable");
    expect(api.registerRoot).not.toHaveBeenCalled();
  });

  it("renders only backend-approved display names and relative paths", async () => {
    const api = fakeApi();
    const rawPath = "/private/tmp/secret-fixture-root";
    render(
      <RootRegistryPanel
        api={api}
        selectDirectory={vi.fn().mockResolvedValue(rawPath)}
      />,
    );

    expect(screen.getByText("READ ONLY")).toHaveClass("root-mode-badge");

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    expect(await screen.findByText("PROJECT_A")).toBeInTheDocument();
    expect(screen.getByText("LIVE_SET/PROJECT_A")).toBeInTheDocument();
    expect(screen.queryByText(rawPath)).not.toBeInTheDocument();
    expect(api.registerRoot).toHaveBeenCalledWith(rawPath);
    expect(api.listLibrary).toHaveBeenCalledWith("root-opaque");
  });
});
