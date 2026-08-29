import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  audioApi,
  changeApi,
  metadataApi,
  rootApi,
  type AudioApi,
  type ChangeApi,
  type ChangeRecoveryStatus,
  type LibrarySnapshot,
  type MetadataApi,
  type RootApi,
  type RootSession,
} from "../../api";
import { AppShell } from "../../app/index";
import { AdditiveCopyChangeDrawer } from "../changes";
import { InspectorPane } from "../inspector";
import {
  CatalogLibraryBrowser,
  type CatalogAssetSelection,
} from "../library/CatalogLibraryBrowser";
import { ManualAssetMetadataEditor } from "../metadata/ManualAssetMetadataEditor";
import { SourcesPane } from "../sources";
import { UsageGraphPanel } from "../usage";
import { WaveformPreview } from "../waveform/WaveformPreview";
import "./RootRegistryPanel.css";

export type RootDirectoryPicker = () => Promise<string | null>;

async function pickRootDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select a read-only Octatrack root",
  });
  return typeof selected === "string" ? selected : null;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}

interface RootRegistryPanelProps {
  api?: RootApi;
  audioClient?: AudioApi;
  metadataClient?: MetadataApi;
  changeClient?: ChangeApi;
  selectDirectory?: RootDirectoryPicker;
}

/**
 * HomePage entry for the next-gen root session.
 * Composes UI1 AppShell Sources + catalog Main + UI4/UI5 Inspector
 * (waveform, usage graph, tags/notes).
 */
export function RootRegistryPanel({
  api = rootApi,
  audioClient = audioApi,
  metadataClient = metadataApi,
  changeClient = changeApi,
  selectDirectory = pickRootDirectory,
}: RootRegistryPanelProps) {
  const [session, setSession] = useState<RootSession | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<CatalogAssetSelection | null>(null);
  const [recovery, setRecovery] = useState<ChangeRecoveryStatus | null>(null);

  async function registerRoot() {
    setBusy(true);
    setError(null);
    let registered: RootSession | null = null;
    try {
      const rawPath = await selectDirectory();
      if (rawPath === null) return;
      registered = await api.registerRoot(rawPath);
      const snapshot = await api.listLibrary(registered.rootId);
      setSession(registered);
      setLibrary(snapshot);
      setSelectedAsset(null);
      setChangeBusy(false);
      try {
        setRecovery(await changeClient.recoveryStatus(registered.rootId));
      } catch (reason) {
        setRecovery(null);
        setError(`Write safety status unavailable: ${errorMessage(reason)}`);
      }
    } catch (reason) {
      if (registered !== null) {
        await api.closeRoot(registered.rootId).catch(() => undefined);
      }
      setSession(null);
      setLibrary(null);
      setSelectedAsset(null);
      setRecovery(null);
      setChangeBusy(false);
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function closeRoot() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.closeRoot(session.rootId);
      setSession(null);
      setLibrary(null);
      setSelectedAsset(null);
      setRecovery(null);
      setChangeBusy(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function enableWrite() {
    if (session === null || recovery === null || recovery.recoveryRequired) return;
    setBusy(true);
    setError(null);
    try {
      const latestRecovery = await changeClient.recoveryStatus(session.rootId);
      setRecovery(latestRecovery);
      if (latestRecovery.recoveryRequired) {
        setError("An incomplete operation must be resolved before edit mode can be enabled.");
        return;
      }
      setSession(await api.enableWrite(session.rootId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshAfterCommit() {
    if (session === null) return;
    try {
      const [snapshot, latestRecovery] = await Promise.all([
        api.listLibrary(session.rootId),
        changeClient.recoveryStatus(session.rootId),
      ]);
      setLibrary(snapshot);
      setRecovery(latestRecovery);
      setSelectedAsset(null);
    } catch (reason) {
      setRecovery(null);
      setError(`The copy committed, but refresh failed: ${errorMessage(reason)}`);
    }
  }

  async function refreshSessionBeforeApply(): Promise<RootSession> {
    if (session === null) {
      throw new Error("The root session is no longer available.");
    }
    const refreshed = await api.rootStatus(session.rootId);
    setSession(refreshed);
    return refreshed;
  }

  const catalogReady = session !== null && library !== null;

  return (
    <AppShell
      sources={
        <SourcesPane
          session={session}
          busy={busy || changeBusy}
          error={error}
          onRegister={registerRoot}
          onClose={closeRoot}
          onEnableWrite={enableWrite}
          writeBlocked={recovery === null || recovery.recoveryRequired}
        />
      }
      main={
        catalogReady ? (
          <CatalogLibraryBrowser
            key={session.rootId}
            rootId={session.rootId}
            snapshot={library}
            audioClient={audioClient}
            metadataClient={metadataClient}
            inspectorPlacement="shell"
            onSelectedAssetChange={setSelectedAsset}
          />
        ) : (
          <p className="root-registry-main-empty">
            Choose a read-only root to browse the catalog library.
          </p>
        )
      }
      inspector={
        catalogReady ? (
          <InspectorPane
            assetLabel={selectedAsset?.displayName}
            relativePath={selectedAsset?.relativePath}
          >
            {selectedAsset !== null && (
              <div
                key={`${session.rootId}:${selectedAsset.assetId}:${selectedAsset.relativePath}`}
              >
                <WaveformPreview
                  api={audioClient}
                  rootId={session.rootId}
                  assetId={selectedAsset.assetId}
                  displayName={selectedAsset.displayName}
                />
                <UsageGraphPanel
                  relativePath={selectedAsset.relativePath}
                  edges={library.usageEdges}
                />
                <ManualAssetMetadataEditor
                  api={metadataClient}
                  rootId={session.rootId}
                  assetId={selectedAsset.assetId}
                  displayName={selectedAsset.displayName}
                />
              </div>
            )}
          </InspectorPane>
        ) : undefined
      }
      changeDrawer={
        catalogReady ? (
          <AdditiveCopyChangeDrawer
            session={session}
            selectedAsset={selectedAsset}
            recovery={recovery}
            api={changeClient}
            disabled={busy}
            refreshSession={refreshSessionBeforeApply}
            onCommitted={refreshAfterCommit}
            onBusyChange={setChangeBusy}
            onRecoveryChange={setRecovery}
          />
        ) : undefined
      }
    />
  );
}
