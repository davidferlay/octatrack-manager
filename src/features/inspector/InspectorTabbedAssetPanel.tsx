import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  AudioApi,
  LibraryAudioFile,
  LibrarySnapshot,
  MetadataApi,
  RenameRecoveryStatus,
} from "../../api";
import { Button } from "../../design-system";
import { useTranslate } from "../../i18n";
import { SampleOperationsMenu } from "../changes";
import { preparedRenameCount } from "../workspace/operationsStatus";
import { ManualAssetMetadataEditor } from "../metadata/ManualAssetMetadataEditor";
import { SliceWorkbench } from "../slicing/SliceWorkbench";
import { UsageGraphPanel } from "../usage";
import type { LibraryCommittedGeometryRange } from "../waveform/WaveformPreview";
import { WaveformPreview } from "../waveform/WaveformPreview";
import { InspectorSampleInfo } from "./InspectorSampleInfo";
import "./InspectorTabbedAssetPanel.css";

export type InspectorTabId = "preview" | "slice" | "info" | "usage" | "notes";

const TAB_ORDER: InspectorTabId[] = ["preview", "slice", "info", "usage", "notes"];

export interface InspectorTabbedAssetPanelProps {
  rootId: string;
  file: LibraryAudioFile;
  snapshot: LibrarySnapshot;
  audioClient?: AudioApi;
  metadataClient?: MetadataApi;
  geometrySelectionGeneration: number;
  librarySelectionRange: LibraryCommittedGeometryRange | null;
  stopPlaybackToken: number;
  renameRecovery: RenameRecoveryStatus | null;
  renameBlocked: boolean;
  copyBlocked: boolean;
  renameBusy: boolean;
  writeEnabled: boolean;
  onRename: () => void;
  onCopy: () => void;
  onCommittedGeometryRangeChange: Parameters<
    typeof WaveformPreview
  >[0]["onCommittedGeometryRangeChange"];
  onRequestStopLibraryPlayback: () => void;
}

function tabIndexForTabs(active: InspectorTabId): Record<InspectorTabId, number> {
  return {
    preview: active === "preview" ? 0 : -1,
    slice: active === "slice" ? 0 : -1,
    info: active === "info" ? 0 : -1,
    usage: active === "usage" ? 0 : -1,
    notes: active === "notes" ? 0 : -1,
  };
}

export function InspectorTabbedAssetPanel({
  rootId,
  file,
  snapshot,
  audioClient,
  metadataClient,
  geometrySelectionGeneration,
  librarySelectionRange,
  stopPlaybackToken,
  renameRecovery,
  renameBlocked,
  copyBlocked,
  renameBusy,
  writeEnabled,
  onRename,
  onCopy,
  onCommittedGeometryRangeChange,
  onRequestStopLibraryPlayback,
}: InspectorTabbedAssetPanelProps) {
  const t = useTranslate();
  const tablistId = useId();
  const [activeTab, setActiveTab] = useState<InspectorTabId>("preview");
  const [playbackActive, setPlaybackActive] = useState(false);
  const [sliceAnalysisBusy, setSliceAnalysisBusy] = useState(false);
  const sliceCancelRef = useRef<(() => void) | null>(null);

  const registerSliceCancel = useCallback((cancel: (() => void) | null) => {
    sliceCancelRef.current = cancel;
  }, []);

  const tabLabels: Record<InspectorTabId, string> = {
    preview: t("inspector.tabPreview"),
    slice: t("inspector.tabSlice"),
    info: t("inspector.tabInfo"),
    usage: t("inspector.tabUsage"),
    notes: t("inspector.tabNotes"),
  };

  const tabIndices = tabIndexForTabs(activeTab);

  function focusTab(tabId: InspectorTabId) {
    setActiveTab(tabId);
    const button = document.getElementById(`${tablistId}-${tabId}`);
    button?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tabId: InspectorTabId) {
    const index = TAB_ORDER.indexOf(tabId);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (index + 1) % TAB_ORDER.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (index - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = TAB_ORDER.length - 1;
    } else {
      return;
    }
    focusTab(TAB_ORDER[nextIndex]);
  }

  const renameHintId = "mo-inspector-rename-hint";
  const headerActions = (
    <>
      {preparedRenameCount(renameRecovery) > 0 && (
        <p className="mo-inspector-tabbed__prepared-hint" role="status">
          {t("operations.preparedHint")}
        </p>
      )}
      <div className="mo-inspector-tabbed__rename">
        <SampleOperationsMenu
          renameDisabled={renameBlocked || !writeEnabled}
          copyDisabled={copyBlocked}
          renameBusy={renameBusy}
          renameHintId={renameHintId}
          onRename={onRename}
          onCopy={onCopy}
        />
        {!writeEnabled && (
          <p id={renameHintId} className="mo-inspector-tabbed__rename-hint">
            {t("inspector.renameNeedsEdit")}
          </p>
        )}
      </div>
    </>
  );

  const showPlaybackControls = playbackActive && activeTab !== "preview";
  const showAnalysisControls = sliceAnalysisBusy && activeTab !== "slice";
  const activityBar = (playbackActive || sliceAnalysisBusy) ? (
    <div className="mo-inspector-tabbed__activity" role="status">
      {playbackActive && (
        <span>{t("inspector.activityPlayback")}</span>
      )}
      {sliceAnalysisBusy && (
        <span>{t("inspector.activityAnalysis")}</span>
      )}
      {(showPlaybackControls || showAnalysisControls) && (
        <div className="mo-inspector-tabbed__activity-actions">
          {showPlaybackControls && (
            <Button type="button" variant="secondary" onClick={onRequestStopLibraryPlayback}>
              {t("waveform.stop")}
            </Button>
          )}
          {showAnalysisControls && (
            <>
              <Button type="button" variant="secondary" onClick={() => focusTab("slice")}>
                {t("inspector.showSliceTab")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => sliceCancelRef.current?.()}
              >
                {t("slicing.cancelAnalysis")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="mo-inspector-tabbed">
      <div className="mo-inspector-tabbed__header">
        <p className="mo-inspector-tabbed__asset">{file.displayName}</p>
        <code className="mo-inspector-tabbed__path">{file.relativePath}</code>
        {headerActions}
        {activityBar}
      </div>
      <div
        className="mo-inspector-tabbed__tablist"
        role="tablist"
        aria-label={t("inspector.tabListAria")}
        id={tablistId}
      >
        {TAB_ORDER.map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            id={`${tablistId}-${tabId}`}
            aria-selected={activeTab === tabId}
            aria-controls={`${tablistId}-panel-${tabId}`}
            tabIndex={tabIndices[tabId]}
            className="mo-inspector-tabbed__tab"
            onClick={() => setActiveTab(tabId)}
            onKeyDown={(event) => onTabKeyDown(event, tabId)}
          >
            {tabLabels[tabId]}
          </button>
        ))}
      </div>
      <div className="mo-inspector-tabbed__panels">
        <TabPanel
          id={`${tablistId}-panel-preview`}
          labelledBy={`${tablistId}-preview`}
          hidden={activeTab !== "preview"}
        >
          <WaveformPreview
            api={audioClient}
            rootId={rootId}
            assetId={file.assetId}
            fileInstanceId={file.fileInstanceId}
            geometrySelectionGeneration={geometrySelectionGeneration}
            displayName={file.displayName}
            onCommittedGeometryRangeChange={onCommittedGeometryRangeChange}
            stopPlaybackToken={stopPlaybackToken}
            layoutVisible={activeTab === "preview"}
            onPlaybackActivityChange={setPlaybackActive}
          />
        </TabPanel>
        <TabPanel
          id={`${tablistId}-panel-slice`}
          labelledBy={`${tablistId}-slice`}
          hidden={activeTab !== "slice"}
        >
          <SliceWorkbench
            rootId={rootId}
            fileInstanceId={file.fileInstanceId}
            displayName={file.displayName}
            librarySelectionRange={librarySelectionRange}
            onRequestStopLibraryPlayback={onRequestStopLibraryPlayback}
            onAnalysisBusyChange={setSliceAnalysisBusy}
            registerAnalysisCancel={registerSliceCancel}
          />
        </TabPanel>
        <TabPanel
          id={`${tablistId}-panel-info`}
          labelledBy={`${tablistId}-info`}
          hidden={activeTab !== "info"}
        >
          <InspectorSampleInfo file={file} />
        </TabPanel>
        <TabPanel
          id={`${tablistId}-panel-usage`}
          labelledBy={`${tablistId}-usage`}
          hidden={activeTab !== "usage"}
        >
          <UsageGraphPanel relativePath={file.relativePath} edges={snapshot.usageEdges} />
        </TabPanel>
        <TabPanel
          id={`${tablistId}-panel-notes`}
          labelledBy={`${tablistId}-notes`}
          hidden={activeTab !== "notes"}
        >
          <ManualAssetMetadataEditor
            api={metadataClient}
            rootId={rootId}
            assetId={file.assetId}
            displayName={file.displayName}
          />
        </TabPanel>
      </div>
    </div>
  );
}

function TabPanel({
  id,
  labelledBy,
  hidden,
  children,
}: {
  id: string;
  labelledBy: string;
  hidden: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      aria-hidden={hidden}
      inert={hidden ? true : undefined}
      className={[
        "mo-inspector-tabbed__panel",
        hidden ? "mo-inspector-tabbed__panel--hidden" : "",
      ].filter(Boolean).join(" ")}
    >
      {children}
    </section>
  );
}
