import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  audioApi,
  changeApi,
  cloneApi,
  metadataApi,
  renameApi,
  rootApi,
  type AudioApi,
  type ChangeApi,
  type ChangeRecoveryStatus,
  type CloneApi,
  type CloneVerification,
  type LibrarySnapshot,
  type MetadataApi,
  type RenameApi,
  type RenameRecoveryStatus,
  type RootApi,
  type RootSession,
} from "../../api";
import { AppShell } from "../../app/index";
import { Button } from "../../design-system";
import {
  AdditiveCopyChangeDrawer,
  CloneOperatorPanel,
  RenameOperatorPanel,
  RenamePreparedNotice,
  RenameSampleModal,
} from "../changes";
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
  const e2eRootPath = (window as Window & { __E2E_ROOT_PATH__?: string }).__E2E_ROOT_PATH__;
  if (typeof e2eRootPath === "string" && e2eRootPath !== "") {
    return e2eRootPath;
  }
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
  cloneClient?: CloneApi;
  renameClient?: RenameApi;
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
  cloneClient = cloneApi,
  renameClient = renameApi,
  selectDirectory = pickRootDirectory,
}: RootRegistryPanelProps) {
  const [session, setSession] = useState<RootSession | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<CatalogAssetSelection | null>(null);
  const [recovery, setRecovery] = useState<ChangeRecoveryStatus | null>(null);
  const [renameRecovery, setRenameRecovery] = useState<RenameRecoveryStatus | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameModalAsset, setRenameModalAsset] = useState<CatalogAssetSelection | null>(null);
  const [cloneVerification, setCloneVerification] = useState<CloneVerification | null>(null);
  const [sourceEvidenceId, setSourceEvidenceId] = useState<string | null>(null);

  async function refreshCloneVerification(rootId: string) {
    try {
      setCloneVerification((await cloneClient.verificationStatus(rootId)) ?? null);
    } catch {
      setCloneVerification(null);
    }
  }

  async function refreshRenameRecovery(rootId: string) {
    try {
      setRenameRecovery(await renameClient.recoveryStatus(rootId));
    } catch (reason) {
      setRenameRecovery(null);
      setError(`Rename safety status unavailable: ${errorMessage(reason)}`);
    }
  }

  useEffect(() => {
    if (renameModalAsset === null || selectedAsset === null) return;
    if (
      renameModalAsset.fileInstanceId !== selectedAsset.fileInstanceId
      || renameModalAsset.relativePath !== selectedAsset.relativePath
    ) {
      setRenameModalOpen(false);
      setRenameModalAsset(null);
    }
  }, [renameModalAsset, selectedAsset]);

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
        await refreshRenameRecovery(registered.rootId);
        await refreshCloneVerification(registered.rootId);
      } catch (reason) {
        setRecovery(null);
        setRenameRecovery(null);
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
      setRenameRecovery(null);
      setCloneVerification(null);
      setSourceEvidenceId(null);
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
      setRenameRecovery(null);
      setRenameModalOpen(false);
      setRenameModalAsset(null);
      setCloneVerification(null);
      setChangeBusy(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function enableWrite() {
    if (
      session === null
      || recovery === null
      || recovery.recoveryRequired
      || renameRecovery === null
      || renameRecovery.recoveryRequired
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setRenameModalOpen(false);
    setRenameModalAsset(null);
    try {
      const latestRecovery = await changeClient.recoveryStatus(session.rootId);
      setRecovery(latestRecovery);
      if (latestRecovery.recoveryRequired) {
        setError("An incomplete operation must be resolved before edit mode can be enabled.");
        return;
      }
      const latestRenameRecovery = await renameClient.recoveryStatus(session.rootId);
      setRenameRecovery(latestRenameRecovery);
      if (latestRenameRecovery.recoveryRequired) {
        setError("An incomplete rename operation must be resolved before edit mode can be enabled.");
        return;
      }
      setSession(await api.enableWrite(session.rootId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disableWrite() {
    if (session === null) return;
    if (!(session.mode === "write_enabled" && session.capabilities.write)) return;
    setBusy(true);
    setError(null);
    setRenameModalOpen(false);
    setRenameModalAsset(null);
    try {
      setSession(await api.disableWrite(session.rootId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshAfterWrite(failureMessage: string) {
    if (session === null) return;
    try {
      const [latestSession, snapshot, latestRecovery] = await Promise.all([
        api.rootStatus(session.rootId),
        api.listLibrary(session.rootId),
        changeClient.recoveryStatus(session.rootId),
      ]);
      setSession(latestSession);
      setLibrary(snapshot);
      setRecovery(latestRecovery);
      setSelectedAsset(null);
      await refreshRenameRecovery(session.rootId);
      await refreshCloneVerification(session.rootId);
    } catch (reason) {
      setRecovery(null);
      setRenameRecovery(null);
      setError(`${failureMessage}: ${errorMessage(reason)}`);
    }
  }

  async function refreshAfterRenamePrepared() {
    if (session === null) return;
    try {
      const latestSession = await api.rootStatus(session.rootId);
      setSession(latestSession);
      await refreshRenameRecovery(session.rootId);
    } catch (reason) {
      setRenameRecovery(null);
      setError(`Rename was prepared, but status refresh failed: ${errorMessage(reason)}`);
    }
  }

  async function refreshAfterCommit() {
    await refreshAfterWrite("The copy committed, but refresh failed");
  }

  async function refreshAfterRecovery() {
    await refreshAfterWrite("The rollback completed, but refresh failed");
  }

  async function refreshAfterRenameApplied() {
    await refreshAfterWrite("The rename committed, but refresh failed");
  }

  async function refreshAfterRenameRecovery() {
    await refreshAfterWrite("The rename rollback completed, but refresh failed");
  }

  async function adoptCloneRoot(cloneRootId: string) {
    const [latestSession, snapshot] = await Promise.all([
      api.rootStatus(cloneRootId),
      api.listLibrary(cloneRootId),
    ]);
    setSession(latestSession);
    setLibrary(snapshot);
    setSelectedAsset(null);
    setRenameModalOpen(false);
    setRenameModalAsset(null);
    setRecovery(await changeClient.recoveryStatus(cloneRootId));
    await refreshRenameRecovery(cloneRootId);
    await refreshCloneVerification(cloneRootId);
  }

  async function handleCreateManagedClone() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      const managed = await cloneClient.createManagedClone(session.rootId);
      if (!managed.sourceRootClosed) {
        throw new Error("Managed clone creation did not close the source root.");
      }
      await adoptCloneRoot(managed.cloneRootId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordSourceEvidence() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      const evidence = await cloneClient.recordSourceEvidence(session.rootId);
      setSourceEvidenceId(evidence.sourceEvidenceId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterExternalClone() {
    setBusy(true);
    setError(null);
    try {
      const rawPath = await selectDirectory();
      if (rawPath === null) return;
      const registered = await api.registerRoot(rawPath);
      await adoptCloneRoot(registered.rootId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyExternalClone(acknowledgedDisposableClone: boolean) {
    if (session === null || sourceEvidenceId === null) return;
    setBusy(true);
    setError(null);
    try {
      await cloneClient.verifyExternal(
        session.rootId,
        sourceEvidenceId,
        acknowledgedDisposableClone,
      );
      await refreshCloneVerification(session.rootId);
      setSourceEvidenceId(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleReverifyClone() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      await cloneClient.reverify(session.rootId);
      await refreshCloneVerification(session.rootId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
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
  const writeEnabled = session?.mode === "write_enabled" && session.capabilities.write;
  const writeBlocked = recovery === null
    || recovery.recoveryRequired
    || renameRecovery === null
    || renameRecovery.recoveryRequired;
  const renameBlocked = writeBlocked;

  function openRenameModal() {
    if (selectedAsset === null || renameBlocked) return;
    setRenameModalAsset(selectedAsset);
    setRenameModalOpen(true);
  }

  return (
    <>
      <AppShell
      sources={
        <SourcesPane
          session={session}
          busy={busy || changeBusy}
          error={error}
          onRegister={registerRoot}
          onClose={closeRoot}
          onEnableWrite={enableWrite}
          onDisableWrite={disableWrite}
          writeBlocked={writeBlocked}
        >
          {catalogReady && (
            <CloneOperatorPanel
              session={session}
              cloneVerification={cloneVerification}
              busy={busy || changeBusy}
              sourceEvidenceRecorded={sourceEvidenceId !== null}
              onCreateManagedClone={handleCreateManagedClone}
              onRecordSourceEvidence={handleRecordSourceEvidence}
              onRegisterExternalClone={handleRegisterExternalClone}
              onVerifyExternal={handleVerifyExternalClone}
              onReverify={handleReverifyClone}
            />
          )}
        </SourcesPane>
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
                <RenamePreparedNotice recovery={renameRecovery} />
                <div className="root-registry-rename-actions">
                  <Button
                    variant="secondary"
                    disabled={busy || changeBusy || renameBlocked}
                    onClick={openRenameModal}
                    title={
                      !writeEnabled
                        ? "Enable edit mode in Sources before renaming"
                        : renameBlocked
                          ? "Resolve recovery before starting another rename"
                          : "Review and prepare a same-directory sample rename"
                    }
                  >
                    Rename
                  </Button>
                  {!writeEnabled && (
                    <p className="root-registry-rename-hint">Edit mode required</p>
                  )}
                </div>
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
          <>
            <RenameOperatorPanel
              session={session}
              changeRecovery={recovery}
              renameRecovery={renameRecovery}
              cloneVerification={cloneVerification}
              api={renameClient}
              changeClient={changeClient}
              disabled={busy}
              refreshSession={refreshSessionBeforeApply}
              onApplied={refreshAfterRenameApplied}
              onRecovered={refreshAfterRenameRecovery}
              onBusyChange={setChangeBusy}
              onRenameRecoveryChange={setRenameRecovery}
              onRecoveryChange={setRecovery}
            />
            <AdditiveCopyChangeDrawer
              session={session}
              selectedAsset={selectedAsset}
              recovery={recovery}
              renameRecovery={renameRecovery}
              api={changeClient}
              disabled={busy}
              refreshSession={refreshSessionBeforeApply}
              onCommitted={refreshAfterCommit}
              onRecovered={refreshAfterRecovery}
              onBusyChange={setChangeBusy}
              onRecoveryChange={setRecovery}
            />
          </>
        ) : undefined
      }
    />
    {catalogReady && renameModalOpen && renameModalAsset !== null && session !== null && (
      <RenameSampleModal
        open={renameModalOpen}
        session={session}
        selectedAsset={renameModalAsset}
        changeRecovery={recovery}
        renameRecovery={renameRecovery}
        api={renameClient}
        onClose={() => {
          setRenameModalOpen(false);
          setRenameModalAsset(null);
        }}
        refreshSession={refreshSessionBeforeApply}
        onPrepared={refreshAfterRenamePrepared}
        onRenameRecoveryChange={setRenameRecovery}
      />
    )}
    </>
  );
}
