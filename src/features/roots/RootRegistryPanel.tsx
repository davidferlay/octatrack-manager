import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  rootApi,
  type LibrarySnapshot,
  type RootApi,
  type RootSession,
} from "../../api";
import { Badge, Button } from "../../design-system";
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
  selectDirectory?: RootDirectoryPicker;
}

export function RootRegistryPanel({
  api = rootApi,
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
    <section className="root-registry-panel" aria-labelledby="root-registry-title">
      <div className="root-registry-heading">
        <div>
          <div className="root-registry-title-row">
            <h2 id="root-registry-title">Read-only source</h2>
            <Badge tone="success">READ ONLY</Badge>
          </div>
          <p>Next-generation root session. Only the native picker may submit an absolute path.</p>
        </div>
        {session === null ? (
          <Button variant="secondary" disabled={busy} onClick={registerRoot}>
            {busy ? "Registering..." : "Choose root..."}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={closeRoot}>
            {busy ? "Closing..." : "Close root"}
          </Button>
        )}
      </div>

      {error !== null && (
        <p className="root-registry-error" role="alert">
          {error}
        </p>
      )}

      {session !== null && library !== null && (
        <div className="root-registry-content">
          <dl className="root-session-summary">
            <div>
              <dt>Source</dt>
              <dd>{session.displayName}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd>{session.deviceFingerprint.slice(0, 12)}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>Read only</dd>
            </div>
          </dl>

          <CatalogLibraryBrowser snapshot={library} />
        </div>
      )}
    </section>
  );
}
