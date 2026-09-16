import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AudioApi,
  LibrarySnapshot,
  MetadataApi,
} from "../../api";
import { audioApi, metadataApi } from "../../api";
import { useTranslate } from "../../i18n";
import { InspectorTabbedAssetPanel } from "../inspector";
import { ProjectWorkspace } from "../project-workspace";
import { useLibraryGeometrySelection } from "../waveform/libraryGeometrySelection";
import { AudioLibrary } from "./AudioLibrary";
import { CatalogFileList } from "./CatalogFileList";
import { CatalogLocationNav } from "./CatalogLocationNav";
import { useCatalogBrowse } from "./useCatalogBrowse";
import "./CatalogLibraryBrowser.css";

/** Opaque catalog asset selection for AppShell Inspector (UI4). */
export interface CatalogAssetSelection {
  assetId: string;
  fileInstanceId: string;
  displayName: string;
  relativePath: string;
}

export interface CatalogBrowseContext {
  sourceLabel: string;
  locationLabel: string;
  locationCount: number;
  matchingCount: number;
  hasSearch: boolean;
}

export type CatalogInspectorPlacement = "inline" | "shell";

interface CatalogLibraryBrowserProps {
  rootId: string;
  snapshot: LibrarySnapshot;
  audioClient?: AudioApi;
  metadataClient?: MetadataApi;
  /**
   * `inline` keeps the legacy fourth column.
   * `shell` hides it and reports selection via `onSelectedAssetChange` for AppShell Inspector.
   */
  inspectorPlacement?: CatalogInspectorPlacement;
  onSelectedAssetChange?: (selection: CatalogAssetSelection | null) => void;
  onBrowseContextChange?: (context: CatalogBrowseContext | null) => void;
}

export function CatalogLibraryBrowser({
  rootId,
  snapshot,
  audioClient = audioApi,
  metadataClient = metadataApi,
  inspectorPlacement = "inline",
  onSelectedAssetChange,
  onBrowseContextChange,
}: CatalogLibraryBrowserProps) {
  const t = useTranslate();
  const browse = useCatalogBrowse(snapshot, { onBrowseContextChange });
  const shellInspector = inspectorPlacement === "shell";
  const [stopLibraryPlaybackToken, setStopLibraryPlaybackToken] = useState(0);
  const geometryTarget = useMemo(
    () => (browse.selectedFile === undefined
      ? null
      : {
        rootId,
        fileInstanceId: browse.selectedFile.fileInstanceId,
        assetId: browse.selectedFile.assetId,
      }),
    [rootId, browse.selectedFile],
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

  useEffect(() => {
    if (!onSelectedAssetChange) return;
    if (browse.selectedFile === undefined) {
      onSelectedAssetChange(null);
      return;
    }
    onSelectedAssetChange({
      assetId: browse.selectedFile.assetId,
      fileInstanceId: browse.selectedFile.fileInstanceId,
      displayName: browse.selectedFile.displayName,
      relativePath: browse.selectedFile.relativePath,
    });
  }, [onSelectedAssetChange, browse.selectedFile]);

  if (browse.sources.length === 0) {
    return <p className="catalog-library-empty">{t("library.noCatalogEntries")}</p>;
  }

  const fileList = (
    <CatalogFileList
      fileQuery={browse.fileQuery}
      locationFiles={browse.locationFiles}
      search={browse.search}
      sort={browse.sort}
      selectedFileInstanceId={browse.selectedFileInstanceId}
      onSelectFile={(id) => browse.selectFileInstanceId(id)}
      onSearchChange={browse.setSearch}
      onSortChange={browse.setSort}
      onPageChange={browse.setRequestedPage}
    />
  );

  const detail = (
    <div
      className={[
        "catalog-library-detail",
        shellInspector ? "catalog-library-detail--files-only" : "",
      ].filter(Boolean).join(" ")}
    >
      {fileList}
      {!shellInspector && (
        <div className="catalog-library-column catalog-library-inspector" aria-label={t("library.assetInspectorAria")}>
          <h4>{t("library.inspectorColumn")}</h4>
          {browse.selectedFile === undefined ? (
            <p className="catalog-library-empty">{t("library.selectFileForMetadata")}</p>
          ) : (
            <div
              className="catalog-library-inspector-content"
              key={`${rootId}:${browse.selectedFile.fileInstanceId}`}
            >
              <InspectorTabbedAssetPanel
                rootId={rootId}
                file={browse.selectedFile}
                snapshot={snapshot}
                audioClient={audioClient}
                metadataClient={metadataClient}
                geometrySelectionGeneration={geometrySelectionGeneration}
                librarySelectionRange={librarySelectionRange}
                stopPlaybackToken={stopLibraryPlaybackToken}
                renameRecovery={null}
                renameBlocked
                copyBlocked
                renameBusy={false}
                writeEnabled={false}
                onRename={() => undefined}
                onCopy={() => undefined}
                onCommittedGeometryRangeChange={handleLibraryGeometryRange}
                onRequestStopLibraryPlayback={requestStopLibraryPlayback}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  let region = detail;
  if (browse.selectedLocation?.kind === "project") {
    region = (
      <ProjectWorkspace
        project={browse.selectedLocation.project}
        localSampleCount={browse.locationFiles.length}
      >
        {detail}
      </ProjectWorkspace>
    );
  } else if (browse.selectedLocation?.kind === "audio_pool") {
    region = (
      <AudioLibrary
        scope="audio_pool"
        parentPath={browse.selectedLocation.parentPath}
        fileCount={browse.locationFiles.length}
      >
        {detail}
      </AudioLibrary>
    );
  } else if (browse.selectedLocation?.kind === "unclassified") {
    region = (
      <AudioLibrary scope="unclassified" fileCount={browse.locationFiles.length}>
        {detail}
      </AudioLibrary>
    );
  }

  return (
    <section className="catalog-library" aria-labelledby="catalog-library-title">
      <div className="catalog-library-title-row">
        <div>
          <p className="catalog-library-kicker">{t("library.kicker")}</p>
          <h3 id="catalog-library-title">{t("library.title")}</h3>
        </div>
        <span className="catalog-library-count">
          {t("library.snapshotFileCount", { count: snapshot.audioFiles.length })}
        </span>
      </div>

      <div className="catalog-library-layout">
        <CatalogLocationNav
          variant="columns"
          sources={browse.sources}
          selectedSourceKey={browse.selectedSource?.key}
          locations={browse.locations}
          selectedLocationKey={browse.selectedLocation?.key}
          onSelectSource={browse.selectSource}
          onSelectLocation={browse.selectLocation}
        />
        <div className="catalog-library-region">{region}</div>
      </div>
    </section>
  );
}
