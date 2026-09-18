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
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Button, Drawer } from "../../design-system";
import { createTranslate, readStoredLocaleId, useTranslate } from "../../i18n";
import {
  OperationsDrawerHost,
  type OperationsDrawerKind,
} from "../changes";
import {
  operationsDrawerKindForStatus,
  resolveRenameDrawerPin,
} from "../workspace/operationsStatus";
import { InspectorPane, InspectorTabbedAssetPanel } from "../inspector";
import { SliceWorkbench } from "../slicing/SliceWorkbench";
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
  const [renamePrepareBusy, setRenamePrepareBusy] = useState(false);
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
    effectiveSampleRate: librarySourceSampleRate,
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
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const userDismissedOperationsRef = useRef(false);
  const [cloneVerification, setCloneVerification] = useState<CloneVerification | null>(null);
  const [sourceEvidenceId, setSourceEvidenceId] = useState<string | null>(null);
  const [browseContext, setBrowseContext] = useState<CatalogBrowseContext | null>(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [centerView, setCenterView] = useState<AppShellCenterView>("list");
  const catalogEpochRef = useRef(0);
  const inspectorPaneRef = useRef<HTMLDivElement>(null);
  const sliceCancelRef = useRef<(() => void) | null>(null);
  const [sliceWorkspaceExpanded, setSliceWorkspaceExpanded] = useState(false);
  const [sliceAnalysisBusy, setSliceAnalysisBusy] = useState(false);
  const [compactSliceHost, setCompactSliceHost] = useState<HTMLDivElement | null>(null);
  const [expandedSliceHost, setExpandedSliceHost] = useState<HTMLDivElement | null>(null);
  const [e2eLayoutEpoch, setE2eLayoutEpoch] = useState(0);
  const layoutMatchesNarrow = useMediaQuery("(max-width: 840px)");

  useEffect(() => {
    const syncE2eLayout = () => setE2eLayoutEpoch((value) => value + 1);
    window.addEventListener("mo-e2e-narrow-change", syncE2eLayout);
    return () => window.removeEventListener("mo-e2e-narrow-change", syncE2eLayout);
  }, []);
  void e2eLayoutEpoch;
  const e2eForceNarrowWorkspace =
    typeof window !== "undefined"
    && (window as Window & { __E2E_FORCE_NARROW_WORKSPACE__?: boolean }).__E2E_FORCE_NARROW_WORKSPACE__ === true;
  const narrowActive = layoutMatchesNarrow || e2eForceNarrowWorkspace;

  const registerSliceAnalysisCancel = useCallback((cancel: (() => void) | null) => {
    sliceCancelRef.current = cancel;
  }, []);

  const openSliceWorkspace = useCallback(() => {
    setSliceWorkspaceExpanded(true);
    if (narrowActive) {
      setCenterView("list");
    }
  }, [narrowActive]);

  const closeSliceWorkspace = useCallback(() => {
    setSliceWorkspaceExpanded(false);
    if (narrowActive) {
      setCenterView("inspector");
    }
  }, [narrowActive]);

  useEffect(() => {
    setLocationSearch("");
    setCenterView("list");
    setNavigationOpen(true);
    setSliceWorkspaceExpanded(false);
  }, [session?.rootId]);

  useEffect(() => {
    if (selectedAsset === null) {
      setSliceWorkspaceExpanded(false);
    }
  }, [selectedAsset]);

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
    if (session === null || changeBusy || renamePrepareBusy) return;
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
      || changeBusy
      || renamePrepareBusy
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
    if (session === null || changeBusy || renamePrepareBusy) return;
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

  async function adoptCloneRoot(
    cloneRootId: string,
    options?: { preserveCloneDrawer?: boolean },
  ) {
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
    setPinnedAsset(null);
    const keepCloneDrawer = options?.preserveCloneDrawer === true
      && !userDismissedOperationsRef.current;
    if (keepCloneDrawer) {
      setOperationsKind("clone");
      setOperationsOpen(true);
    } else {
      setOperationsOpen(false);
    }
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
      await adoptCloneRoot(managed.cloneRootId, { preserveCloneDrawer: true });
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
  const narrowWorkspace = catalogReady && narrowActive;

  useEffect(() => {
    if (!narrowActive) {
      setNavigationOpen(true);
      return;
    }
    if (catalogReady) {
      setNavigationOpen(false);
    }
  }, [narrowActive, catalogReady]);
  const selectedLibraryFile = useMemo(() => {
    if (library === null || selectedAsset === null) return undefined;
    return library.audioFiles.find(
      (file) => file.fileInstanceId === selectedAsset.fileInstanceId,
    );
  }, [library, selectedAsset]);
  const writeEnabled = session?.mode === "write_enabled" && session.capabilities.write;
  const sessionInteractionBusy = busy || changeBusy || renamePrepareBusy;
  const writeBlocked = recovery === null
    || recovery.recoveryRequired
    || renameRecovery === null
    || renameRecovery.recoveryRequired;
  const renameBlocked = writeBlocked;
  const copyBlocked = recovery === null
    || renameRecovery === null
    || recovery.recoveryRequired
    || renameRecovery.recoveryRequired;

  function openOperations(
    kind: OperationsDrawerKind,
    asset?: CatalogAssetSelection,
    options?: { fromStatusBar?: boolean },
  ) {
    userDismissedOperationsRef.current = false;
    if (kind === "rename") {
      const decision = resolveRenameDrawerPin({
        renameRecovery,
        explicitAsset: asset,
        selectedAsset,
        writeEnabled: writeEnabled === true,
        writeBlocked,
        operatorOnly: options?.fromStatusBar === true,
      });
      if (!decision.open) return;
      if (!renamePrepareBusy && !changeBusy) {
        setPinnedAsset(decision.pin);
      }
      setOperationsKind("rename");
      setOperationsOpen(true);
      return;
    }
    if (kind === "copy") {
      const next = options?.fromStatusBar ? (asset ?? null) : (asset ?? selectedAsset);
      if (next === null) {
        if (recovery?.recoveryRequired !== true && recovery !== null) return;
      } else if (copyBlocked && recovery?.recoveryRequired !== true) {
        return;
      } else if (!renamePrepareBusy && !changeBusy) {
        setPinnedAsset(next);
      }
      setOperationsKind("copy");
      setOperationsOpen(true);
      return;
    }
    setOperationsKind("clone");
    setOperationsOpen(true);
  }

  function closeOperations() {
    userDismissedOperationsRef.current = true;
    setOperationsOpen(false);
  }

  function openOperationsFromStatus(focusTarget?: HTMLElement | null) {
    operationsReturnFocusRef.current = focusTarget ?? document.activeElement as HTMLElement | null;
    const kind = operationsDrawerKindForStatus({
      recovery,
      renameRecovery,
      fallback: operationsKind,
    });
    openOperations(kind, undefined, { fromStatusBar: true });
  }

  function openRenameForSelection(focusTarget?: HTMLElement | null) {
    if (renamePrepareBusy || changeBusy) return;
    if (selectedAsset === null) return;
    operationsReturnFocusRef.current = focusTarget ?? document.activeElement as HTMLElement | null;
    openOperations("rename", selectedAsset);
  }

  function openCopyForSelection(focusTarget?: HTMLElement | null) {
    if (renamePrepareBusy || changeBusy) return;
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
      busy={sessionInteractionBusy}
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
      <Button
        ref={navToggleRef}
        variant="secondary"
        aria-pressed={navigationOpen}
        onClick={() => setNavigationOpen((open) => !open)}
      >
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
      changeBusy={changeBusy || renamePrepareBusy}
      error={error}
      recovery={recovery}
      renameRecovery={renameRecovery}
      onOpenOperations={openOperationsFromStatus}
      onShowInspector={showInspectorPane}
      inspectorHidden={narrowWorkspace && centerView === "list"}
      onShowList={() => setCenterView("list")}
      listHidden={narrowWorkspace && centerView === "inspector"}
    />
  );

  const sourcesFooter = session !== null ? (
    <div className="root-registry-sources-footer">
      <Button
        variant="secondary"
        disabled={sessionInteractionBusy}
        aria-label={t("operations.openCloneAria")}
        onClick={() => openCloneOperations()}
      >
        {t("operations.openClone")}
      </Button>
    </div>
  ) : null;

  const workspaceShell = (
    <AppShell
      className={catalogReady ? "mo-app-shell--workspace" : undefined}
      sliceWorkspaceExpanded={sliceWorkspaceExpanded}
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
      narrowLayout={narrowWorkspace}
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
          <>
            <div
              className={[
                "root-registry-main-host",
                sliceWorkspaceExpanded ? "root-registry-pane--workspace-hidden" : "",
              ].filter(Boolean).join(" ")}
              hidden={sliceWorkspaceExpanded}
              aria-hidden={sliceWorkspaceExpanded}
              inert={sliceWorkspaceExpanded ? true : undefined}
              data-testid="catalog-workspace-main-host"
            >
              <CatalogWorkspaceMain
                totalFiles={library.audioFiles.length}
                catalogRefreshing={catalogRefreshing}
                catalogError={catalogError}
                onSampleRename={() => openRenameForSelection()}
                onSampleCopy={() => openCopyForSelection()}
                sampleRenameDisabled={renameBlocked || writeEnabled !== true}
                sampleCopyDisabled={copyBlocked}
                sampleOpsBusy={sessionInteractionBusy}
              />
            </div>
            {sliceWorkspaceExpanded && selectedAsset !== null && selectedLibraryFile !== undefined && (
              <div
                className="root-registry-slice-workspace"
                data-testid="slice-workspace-expanded-shell"
              >
                <header className="root-registry-slice-workspace__header">
                  <div className="root-registry-slice-workspace__titles">
                    <p className="root-registry-slice-workspace__name">{selectedLibraryFile.displayName}</p>
                    <code className="root-registry-slice-workspace__path">{selectedLibraryFile.relativePath}</code>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={t("inspector.exitSliceWorkspaceAria")}
                    onClick={closeSliceWorkspace}
                  >
                    {t("inspector.exitSliceWorkspace")}
                  </Button>
                </header>
                <div
                  ref={setExpandedSliceHost}
                  className="root-registry-slice-workspace__body"
                  data-testid="slice-workbench-expanded-host"
                />
              </div>
            )}
          </>
        ) : (
          <p className="root-registry-main-empty">{t("roots.mainEmpty")}</p>
        )
      }
      inspector={
        catalogReady ? (
          <div
            ref={inspectorPaneRef}
            tabIndex={-1}
            className="root-registry-inspector-host"
            aria-hidden={sliceWorkspaceExpanded}
            inert={sliceWorkspaceExpanded ? true : undefined}
            data-testid="inspector-workspace-host"
          >
            <InspectorPane
              assetLabel={selectedAsset?.displayName}
              relativePath={selectedAsset?.relativePath}
            >
              {selectedAsset !== null && session !== null && selectedLibraryFile !== undefined && (
                <div
                  key={`${session.rootId}:${selectedAsset.fileInstanceId}`}
                  className="mo-inspector-pane__tabbed-host"
                >
                  <InspectorTabbedAssetPanel
                    rootId={session.rootId}
                    file={selectedLibraryFile}
                    snapshot={library}
                    audioClient={audioClient}
                    metadataClient={metadataClient}
                    geometrySelectionGeneration={geometrySelectionGeneration}
                    librarySelectionRange={librarySelectionRange}
                    librarySourceSampleRate={librarySourceSampleRate}
                    stopPlaybackToken={stopLibraryPlaybackToken}
                    renameRecovery={renameRecovery}
                    renameBlocked={renameBlocked}
                    copyBlocked={copyBlocked}
                    renameBusy={sessionInteractionBusy}
                    writeEnabled={writeEnabled === true}
                    sliceWorkspaceExpanded={sliceWorkspaceExpanded}
                    sliceAnalysisBusy={sliceAnalysisBusy}
                    onRequestExpandSliceWorkspace={openSliceWorkspace}
                    onSliceAnalysisCancel={() => sliceCancelRef.current?.()}
                    onRename={() => openRenameForSelection()}
                    onCopy={() => openCopyForSelection()}
                    onCommittedGeometryRangeChange={handleLibraryGeometryRange}
                    onRequestStopLibraryPlayback={requestStopLibraryPlayback}
                    sliceCompactHostRef={setCompactSliceHost}
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
          {narrowWorkspace && (
            <Drawer
              open={navigationOpen}
              onClose={() => setNavigationOpen(false)}
              title={t("sources.title")}
              closeAriaLabel={t("workspace.sourcesDrawerCloseAria")}
              returnFocusRef={navToggleRef}
              overlayClassName="mo-drawer-overlay--sources-nav"
              panelClassName="mo-drawer-panel--sources-nav"
              bodyClassName="mo-drawer-panel__body--sources-nav"
            >
              <CatalogWorkspaceNav footer={sourcesFooter} />
            </Drawer>
          )}
          {selectedAsset !== null && selectedLibraryFile !== undefined && (
            <SliceWorkbench
              key={`${session.rootId}:${selectedAsset.fileInstanceId}`}
              rootId={session.rootId}
              fileInstanceId={selectedAsset.fileInstanceId}
              displayName={selectedLibraryFile.displayName}
              librarySelectionRange={librarySelectionRange}
              librarySourceSampleRate={librarySourceSampleRate}
              layout={sliceWorkspaceExpanded ? "expanded" : "compact"}
              hostElement={sliceWorkspaceExpanded ? expandedSliceHost : compactSliceHost}
              narrowExpanded={narrowWorkspace && sliceWorkspaceExpanded}
              onRequestStopLibraryPlayback={requestStopLibraryPlayback}
              onAnalysisBusyChange={setSliceAnalysisBusy}
              registerAnalysisCancel={registerSliceAnalysisCancel}
            />
          )}
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
          busy={sessionInteractionBusy}
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
          onRenamePrepareBusyChange={setRenamePrepareBusy}
          onRenameRecoveryChange={setRenameRecovery}
          onRecoveryChange={setRecovery}
        />
      )}
    </>
  );
}
