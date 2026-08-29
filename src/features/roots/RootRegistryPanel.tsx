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
import { SourcesPane } from "../sources";
import { CatalogLibraryBrowser } from "../library/CatalogLibraryBrowser";
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
 * Composes UI1 AppShell Sources + catalog Library browser in Main.
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
    } catch (reason) {
      if (registered !== null) {
        await api.closeRoot(registered.rootId).catch(() => undefined);
      }
      setSession(null);
      setLibrary(null);
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
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

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
        session !== null && library !== null ? (
          <CatalogLibraryBrowser
            rootId={session.rootId}
            snapshot={library}
            audioClient={audioClient}
            metadataClient={metadataClient}
          />
        ) : (
          <p className="root-registry-main-empty">
            Choose a read-only root to browse the catalog library.
          </p>
        )
      }
    />
  );
}
