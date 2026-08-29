import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  audioApi,
  metadataApi,
  rootApi,
  type AudioApi,
  type LibrarySnapshot,
  type MetadataApi,
  type RootApi,
  type RootSession,
} from "../../api";
import { AppShell } from "../../app/index";
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
  selectDirectory = pickRootDirectory,
}: RootRegistryPanelProps) {
  const [session, setSession] = useState<RootSession | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<CatalogAssetSelection | null>(null);

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
    } catch (reason) {
      if (registered !== null) {
        await api.closeRoot(registered.rootId).catch(() => undefined);
      }
      setSession(null);
      setLibrary(null);
      setSelectedAsset(null);
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
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const catalogReady = session !== null && library !== null;

  return (
    <AppShell
      sources={
        <SourcesPane
          session={session}
          busy={busy}
          error={error}
          onRegister={registerRoot}
          onClose={closeRoot}
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
    />
  );
}
