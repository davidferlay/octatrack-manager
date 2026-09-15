import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeApi, CloneApi, RenameApi, RootApi } from "../../api";
import { ThemeProvider } from "../../design-system/themes/ThemeProvider";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { tEn, tJa } from "../../i18n/testStrings";
import { renameOperatorApiStubs } from "../../test/renameApiStubs";
import { RootRegistryPanel } from "./RootRegistryPanel";

function fakeChangeApi(): ChangeApi {
  return {
    planAdditiveCopy: vi.fn(),
    getPlan: vi.fn(),
    applyChange: vi.fn(),
    changeStatus: vi.fn(),
    recoverChange: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue({
      schema: "change-recovery-status:v1",
      recoveryRequired: false,
      operations: [],
    }),
  };
}

function fakeRenameApi(): RenameApi {
  return {
    plan: vi.fn(),
    getPlan: vi.fn(),
    authorize: vi.fn(),
    createBackup: vi.fn(),
    prepare: vi.fn(),
    getStatus: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue({
      schema: "rename-recovery-status:v1",
      recoveryRequired: false,
      operations: [],
    }),
    ...renameOperatorApiStubs(),
  };
}

function fakeCloneApi(): CloneApi {
  return {
    recordSourceEvidence: vi.fn(),
    createManagedClone: vi.fn(),
    verifyExternal: vi.fn(),
    verificationStatus: vi.fn().mockResolvedValue(null),
    reverify: vi.fn(),
  };
}

function renderWorkspace(api: RootApi) {
  return render(
    <LocaleProvider initialLocaleId="ja">
      <ThemeProvider>
        <RootRegistryPanel
          api={api}
          changeClient={fakeChangeApi()}
          cloneClient={fakeCloneApi()}
          renameClient={fakeRenameApi()}
          selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
        />
      </ThemeProvider>
    </LocaleProvider>,
  );
}

describe("RootRegistryPanel workspace layout", () => {
  it("updates the center list when a catalog location is selected in the left nav", async () => {
    const api: RootApi = {
      registerRoot: vi.fn().mockResolvedValue({
        rootId: "root-opaque",
        displayName: "Fixture Root",
        deviceFingerprint: "0123456789abcdef",
        mode: "read_only",
        observedRevision: 1,
        expiresInSeconds: 3600,
        capabilities: { read: true, write: false, stableDeviceIdentity: true },
      }),
      rootStatus: vi.fn(),
      enableWrite: vi.fn(),
      disableWrite: vi.fn(),
      closeRoot: vi.fn(),
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
        audioFiles: [
          {
            fileInstanceId: "fileinst:v1:pool",
            assetId: "asset:v1:pool",
            displayName: "POOL.wav",
            relativePath: "LIVE_SET/AUDIO/POOL.wav",
            byteSize: 2048,
            storageScope: "set_audio_pool",
          },
          {
            fileInstanceId: "fileinst:v1:project",
            assetId: "asset:v1:project",
            displayName: "PROJECT.wav",
            relativePath: "LIVE_SET/PROJECT_A/PROJECT.wav",
            byteSize: 4096,
            storageScope: "project_local",
          },
        ],
        usageEdges: [],
      }),
    };

    renderWorkspace(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    expect(await screen.findByText("POOL.wav")).toBeInTheDocument();

    const nav = screen.getByLabelText(tJa("workspace.navAria"));
    fireEvent.click(within(nav).getByRole("button", { name: "PROJECT_A" }));
    await waitFor(() => {
      expect(screen.getByText("PROJECT.wav")).toBeInTheDocument();
      expect(screen.queryByText("POOL.wav")).not.toBeInTheDocument();
    });
  });

  it("does not call listLibrary again when switching display language", async () => {
    const listLibrary = vi.fn().mockResolvedValue({
      sets: [{
        displayName: "LIVE_SET",
        relativePath: "LIVE_SET",
        hasAudioPool: true,
        projects: [],
      }],
      standaloneProjects: [],
      audioFiles: [{
        fileInstanceId: "fileinst:v1:pool",
        assetId: "asset:v1:pool",
        displayName: "POOL.wav",
        relativePath: "LIVE_SET/AUDIO/POOL.wav",
        byteSize: 2048,
        storageScope: "set_audio_pool",
      }],
      usageEdges: [],
    });
    const api: RootApi = {
      registerRoot: vi.fn().mockResolvedValue({
        rootId: "root-opaque",
        displayName: "Fixture Root",
        deviceFingerprint: "0123456789abcdef",
        mode: "read_only",
        observedRevision: 1,
        expiresInSeconds: 3600,
        capabilities: { read: true, write: false, stableDeviceIdentity: true },
      }),
      rootStatus: vi.fn(),
      enableWrite: vi.fn(),
      disableWrite: vi.fn(),
      closeRoot: vi.fn(),
      listLibrary,
    };

    renderWorkspace(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("sources.chooseRoot") }));
    await screen.findByText("POOL.wav");
    expect(listLibrary).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(tJa("language.selectAria")), {
      target: { value: "en" },
    });
    await waitFor(() => {
      expect(screen.getByText(tEn("workspace.navHeading"))).toBeInTheDocument();
    });
    expect(listLibrary).toHaveBeenCalledTimes(1);
  });
});
