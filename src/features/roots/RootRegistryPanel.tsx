import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AppShell, type AppShellCenterView } from "../../app/index";
import { Button } from "../../design-system";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { createTranslate, readStoredLocaleId, useTranslate } from "../../i18n";
import {
  OperationsDrawerHost,
  type OperationsDrawerKind,
} from "../changes";
import {
  operationsDrawerKindForStatus,
  preparedRenameCount,
} from "../workspace/operationsStatus";
import { InspectorPane, InspectorTabbedAssetPanel } from "../inspector";
import { CatalogBrowseProvider } from "../library/CatalogBrowseContext";
import {
  type CatalogAssetSelection,
  type CatalogBrowseContext,
} from "../library/CatalogLibraryBrowser";
import { CatalogWorkspaceMain, CatalogWorkspaceNav } from "../library/CatalogWorkspaceViews";
import { WorkspaceStatusBar } from "../workspace/WorkspaceStatusBar";
import { WorkspaceTopBar } from "../workspace/WorkspaceTopBar";
import { useLibraryGeometrySelection } from "../waveform/libraryGeometrySelection";
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
    title: createTranslate(readStoredLocaleId())("roots.pickRootDialogTitle"),
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
  const t = useTranslate();
  const [session, setSession] = useState<RootSession | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<CatalogAssetSelection | null>(null);
  const [stopLibraryPlaybackToken, setStopLibraryPlaybackToken] = useState(0);
  const geometryTarget = useMemo(
    () => (session !== null && selectedAsset !== null
      ? {
        rootId: session.rootId,
        fileInstanceId: selectedAsset.fileInstanceId,
        assetId: selectedAsset.assetId,
      }
      : null),
    [session, selectedAsset],
  );
  const {
    selectionGeneration: geometrySelectionGeneration,
    effectiveRange: librarySelectionRange,
    notifyCommittedGeometryRange,
  } = useLibraryGeometrySelection(geometryTarget);
  const handleLibraryGeometryRange = useCallback(
    (_range: unknown, notification?: Parameters<typeof notifyCommittedGeometryRange>[0]) => {
      if (notification !== undefined) notifyCommittedGeometryRange(notification);
    },
    [notifyCommittedGeometryRange],
  );
  const requestStopLibraryPlayback = useCallback(() => {
    setStopLibraryPlaybackToken((token) => token + 1);
  }, []);
  const [recovery, setRecovery] = useState<ChangeRecoveryStatus | null>(null);
  const [renameRecovery, setRenameRecovery] = useState<RenameRecoveryStatus | null>(null);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [operationsKind, setOperationsKind] = useState<OperationsDrawerKind>("clone");
  const [pinnedAsset, setPinnedAsset] = useState<CatalogAssetSelection | null>(null);
  const operationsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [cloneVerification, setCloneVerification] = useState<CloneVerification | null>(null);
  const [sourceEvidenceId, setSourceEvidenceId] = useState<string | null>(null);
  const [browseContext, setBrowseContext] = useState<CatalogBrowseContext | null>(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [centerView, setCenterView] = useState<AppShellCenterView>("list");
  const catalogEpochRef = useRef(0);
  const inspectorPaneRef = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery("(max-width: 840px)");

  useEffect(() => {
    setLocationSearch("");
    setCenterView("list");
    setNavigationOpen(true);
  }, [session?.rootId]);

  useEffect(() => {
    if (!narrow) {
      setNavigationOpen(true);
    }
  }, [narrow]);

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

  async function registerRoot() {
    setBusy(true);
    setError(null);
    let registered: RootSession | null = null;
    try {
      const rawPath = await selectDirectory();
      if (rawPath === null) return;
      registered = await api.registerRoot(rawPath);
      catalogEpochRef.current += 1;
      const loadEpoch = catalogEpochRef.current;
      const snapshot = await api.listLibrary(registered.rootId);
      if (loadEpoch !== catalogEpochRef.current) return;
      setSession(registered);
      setLibrary(snapshot);
      setSelectedAsset(null);
      setBrowseContext(null);
      setChangeBusy(false);
      setCatalogError(null);
      setCatalogRefreshing(false);
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
      setBrowseContext(null);
      setRecovery(null);
      setRenameRecovery(null);
      setCloneVerification(null);
      setSourceEvidenceId(null);
      setChangeBusy(false);
      setCatalogError(null);
      setCatalogRefreshing(false);
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
      catalogEpochRef.current += 1;
      setSession(null);
      setLibrary(null);
      setSelectedAsset(null);
      setBrowseContext(null);
      setRecovery(null);
      setRenameRecovery(null);
      setOperationsOpen(false);
      setPinnedAsset(null);
      setCloneVerification(null);
      setChangeBusy(false);
      setCatalogError(null);
      setCatalogRefreshing(false);
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
    setOperationsOpen(false);
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
    setOperationsOpen(false);
    try {
      setSession(await api.disableWrite(session.rootId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshLibrary() {
    if (session === null) return;
    const loadEpoch = catalogEpochRef.current;
    setBusy(true);
    setCatalogRefreshing(true);
    setCatalogError(null);
    setError(null);
    try {
      const snapshot = await api.listLibrary(session.rootId);
      if (loadEpoch !== catalogEpochRef.current) return;
      setLibrary(snapshot);
    } catch (reason) {
      if (loadEpoch === catalogEpochRef.current) {
        const message = errorMessage(reason);
        setError(message);
        setCatalogError(message);
      }
    } finally {
      setBusy(false);
      setCatalogRefreshing(false);
    }
  }

  async function refreshAfterWrite(failureMessage: string) {
    if (session === null) return;
    const loadEpoch = catalogEpochRef.current;
    try {
      const [latestSession, snapshot, latestRecovery] = await Promise.all([
        api.rootStatus(session.rootId),
        api.listLibrary(session.rootId),
        changeClient.recoveryStatus(session.rootId),
      ]);
      if (loadEpoch !== catalogEpochRef.current) return;
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
    catalogEpochRef.current += 1;
    const loadEpoch = catalogEpochRef.current;
    const [latestSession, snapshot] = await Promise.all([
      api.rootStatus(cloneRootId),
      api.listLibrary(cloneRootId),
    ]);
    if (loadEpoch !== catalogEpochRef.current) return;
    setSession(latestSession);
    setLibrary(snapshot);
    setSelectedAsset(null);
    setOperationsOpen(false);
    setPinnedAsset(null);
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
  const selectedLibraryFile = useMemo(() => {
    if (library === null || selectedAsset === null) return undefined;
    return library.audioFiles.find(
      (file) => file.fileInstanceId === selectedAsset.fileInstanceId,
    );
  }, [library, selectedAsset]);
  const writeEnabled = session?.mode === "write_enabled" && session.capabilities.write;
  const writeBlocked = recovery === null
    || recovery.recoveryRequired
    || renameRecovery === null
    || renameRecovery.recoveryRequired;
  const renameBlocked = writeBlocked;
  const copyBlocked = recovery === null
    || renameRecovery === null
    || recovery.recoveryRequired
    || renameRecovery.recoveryRequired;

  function openOperations(kind: OperationsDrawerKind, asset?: CatalogAssetSelection) {
    if (kind === "rename" || kind === "copy") {
      const next = asset ?? selectedAsset;
      if (next === null) {
        if (kind === "copy" && recovery?.recoveryRequired === true) {
          // Recovery rollback UI does not require a pinned sample.
        } else if (kind === "rename" && preparedRenameCount(renameRecovery) > 0) {
          // Prepared rename continuation is plan-scoped; pin is optional.
        } else {
          return;
        }
      } else {
        if (kind === "rename" && renameBlocked) return;
        if (kind === "copy" && copyBlocked && recovery?.recoveryRequired !== true) return;
        setPinnedAsset(next);
      }
    }
    setOperationsKind(kind);
    setOperationsOpen(true);
  }

  function closeOperations() {
    setOperationsOpen(false);
  }

  function openOperationsFromStatus() {
    const kind = operationsDrawerKindForStatus({
      recovery,
      renameRecovery,
      fallback: operationsKind,
    });
    openOperations(kind);
  }

  function openRenameForSelection(focusTarget?: HTMLElement | null) {
    if (selectedAsset === null) return;
    operationsReturnFocusRef.current = focusTarget ?? document.activeElement as HTMLElement | null;
    openOperations("rename", selectedAsset);
  }

  function openCopyForSelection(focusTarget?: HTMLElement | null) {
    if (selectedAsset === null) return;
    operationsReturnFocusRef.current = focusTarget ?? document.activeElement as HTMLElement | null;
    openOperations("copy", selectedAsset);
  }

  function openCloneOperations(focusTarget?: HTMLElement | null) {
    operationsReturnFocusRef.current = focusTarget ?? document.activeElement as HTMLElement | null;
    openOperations("clone");
  }

  function showInspectorPane() {
    setCenterView("inspector");
    window.requestAnimationFrame(() => {
      inspectorPaneRef.current?.focus({ preventScroll: true });
    });
  }

  const topBar = (
    <WorkspaceTopBar
      session={session}
      writeEnabled={writeEnabled === true}
      writeBlocked={writeBlocked}
      busy={busy || changeBusy}
      search={locationSearch}
      onSearchChange={setLocationSearch}
      searchDisabled={!catalogReady}
      browseContext={browseContext}
      onChooseRoot={registerRoot}
      onRefreshCatalog={() => void refreshLibrary()}
      onCloseRoot={() => void closeRoot()}
      onEnableWrite={() => void enableWrite()}
      onDisableWrite={() => void disableWrite()}
      catalogReady={catalogReady}
      onOpenClone={() => openCloneOperations()}
    />
  );

  const narrowControls = (
    <div className="mo-app-shell__narrow-controls">
      <Button variant="secondary" onClick={() => setNavigationOpen((open) => !open)}>
        {t("workspace.toggleNav")}
      </Button>
      {catalogReady && (
        <>
          <Button
            variant="secondary"
            aria-pressed={centerView === "list"}
            onClick={() => setCenterView("list")}
          >
            {t("workspace.showList")}
          </Button>
          <Button
            variant="secondary"
            aria-pressed={centerView === "inspector"}
            onClick={() => setCenterView("inspector")}
          >
            {t("workspace.showInspector")}
          </Button>
        </>
      )}
    </div>
  );

  const statusBar = (
    <WorkspaceStatusBar
      connected={session !== null}
      busy={busy}
      changeBusy={changeBusy}
      error={error}
      recovery={recovery}
      renameRecovery={renameRecovery}
      onOpenOperations={openOperationsFromStatus}
      onShowInspector={showInspectorPane}
      inspectorHidden={narrow && centerView === "list"}
    />
  );

  const sourcesFooter = session !== null ? (
    <div className="root-registry-sources-footer">
      <Button
        variant="secondary"
        disabled={busy || changeBusy}
        aria-label={t("operations.openCloneAria")}
        onClick={() => openCloneOperations()}
      >
        {t("operations.openClone")}
      </Button>
    </div>
  ) : null;

  const workspaceShell = (
    <AppShell
      contextBar={(
        <>
          {topBar}
          {error !== null && (
            <p className="root-registry-context-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      narrowControls={narrowControls}
      narrowLayout={narrow}
      navigationOpen={navigationOpen}
      onNavigationOpenChange={setNavigationOpen}
      centerView={centerView}
      onCenterViewChange={setCenterView}
      sources={
        catalogReady ? (
          <CatalogWorkspaceNav footer={sourcesFooter} />
        ) : (
          <p className="root-registry-nav-empty">{t("roots.mainEmpty")}</p>
        )
      }
      main={
        catalogReady ? (
          <CatalogWorkspaceMain
            totalFiles={library.audioFiles.length}
            catalogRefreshing={catalogRefreshing}
            catalogError={catalogError}
            onSampleRename={() => openRenameForSelection()}
            onSampleCopy={() => openCopyForSelection()}
            sampleRenameDisabled={renameBlocked || writeEnabled !== true}
            sampleCopyDisabled={copyBlocked}
            sampleOpsBusy={busy || changeBusy}
          />
        ) : (
          <p className="root-registry-main-empty">{t("roots.mainEmpty")}</p>
        )
      }
      inspector={
        catalogReady ? (
          <div ref={inspectorPaneRef} tabIndex={-1} className="root-registry-inspector-host">
            <InspectorPane
              assetLabel={selectedAsset?.displayName}
              relativePath={selectedAsset?.relativePath}
            >
              {selectedAsset !== null && session !== null && selectedLibraryFile !== undefined && (
                <div key={`${session.rootId}:${selectedAsset.fileInstanceId}`}>
                  <InspectorTabbedAssetPanel
                    rootId={session.rootId}
                    file={selectedLibraryFile}
                    snapshot={library}
                    audioClient={audioClient}
                    metadataClient={metadataClient}
                    geometrySelectionGeneration={geometrySelectionGeneration}
                    librarySelectionRange={librarySelectionRange}
                    stopPlaybackToken={stopLibraryPlaybackToken}
                    renameRecovery={renameRecovery}
                    renameBlocked={renameBlocked}
                    copyBlocked={copyBlocked}
                    renameBusy={busy || changeBusy}
                    writeEnabled={writeEnabled === true}
                    onRename={() => openRenameForSelection()}
                    onCopy={() => openCopyForSelection()}
                    onCommittedGeometryRangeChange={handleLibraryGeometryRange}
                    onRequestStopLibraryPlayback={requestStopLibraryPlayback}
                  />
                </div>
              )}
            </InspectorPane>
          </div>
        ) : undefined
      }
      statusBar={statusBar}
    />
  );

  return (
    <>
      {catalogReady && session !== null && library !== null ? (
        <CatalogBrowseProvider
          key={session.rootId}
          snapshot={library}
          search={locationSearch}
          onSearchChange={setLocationSearch}
          onSelectedAssetChange={setSelectedAsset}
          onBrowseContextChange={setBrowseContext}
        >
          {workspaceShell}
        </CatalogBrowseProvider>
      ) : (
        workspaceShell
      )}
      {session !== null && (
        <OperationsDrawerHost
          open={operationsOpen}
          kind={operationsKind}
          onClose={closeOperations}
          returnFocusRef={operationsReturnFocusRef}
          session={session}
          pinnedAsset={pinnedAsset}
          recovery={recovery}
          renameRecovery={renameRecovery}
          cloneVerification={cloneVerification}
          sourceEvidenceRecorded={sourceEvidenceId !== null}
          busy={busy || changeBusy}
          renameClient={renameClient}
          changeClient={changeClient}
          cloneHandlers={{
            onCreateManagedClone: handleCreateManagedClone,
            onRecordSourceEvidence: handleRecordSourceEvidence,
            onRegisterExternalClone: handleRegisterExternalClone,
            onVerifyExternal: handleVerifyExternalClone,
            onReverify: handleReverifyClone,
          }}
          refreshSession={refreshSessionBeforeApply}
          onRenamePrepared={refreshAfterRenamePrepared}
          onRenameApplied={refreshAfterRenameApplied}
          onRenameRecovered={refreshAfterRenameRecovery}
          onCopyCommitted={refreshAfterCommit}
          onCopyRecovered={refreshAfterRecovery}
          onBusyChange={setChangeBusy}
          onRenameRecoveryChange={setRenameRecovery}
          onRecoveryChange={setRecovery}
        />
      )}
    </>
  );
}
