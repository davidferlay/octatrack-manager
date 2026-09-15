import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AudioApi,
  LibraryAudioFile,
  LibraryProject,
  LibrarySet,
  LibrarySnapshot,
  MetadataApi,
} from "../../api";
import { audioApi, metadataApi } from "../../api";
import { Button } from "../../design-system";
import { useTranslate, type TranslateFn } from "../../i18n";
import { ManualAssetMetadataEditor } from "../metadata/ManualAssetMetadataEditor";
import { ProjectWorkspace } from "../project-workspace";
import { UsageGraphPanel } from "../usage";
import {
  WaveformPreview,
  type LibraryCommittedGeometryRange,
} from "../waveform/WaveformPreview";
import { SliceWorkbench } from "../slicing/SliceWorkbench";
import { AudioLibrary } from "./AudioLibrary";
import {
  type CatalogFileSort,
  queryCatalogFiles,
} from "./catalogFileQuery";
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

type SourceOption =
  | { key: string; kind: "set"; label: string; set: LibrarySet }
  | { key: string; kind: "standalone"; label: string }
  | { key: string; kind: "unclassified"; label: string };

type LocationOption =
  | { key: string; kind: "audio_pool"; label: string; parentPath: string }
  | { key: string; kind: "project"; label: string; project: LibraryProject }
  | { key: string; kind: "unclassified"; label: string };

function isWithin(relativePath: string, parentPath: string): boolean {
  return relativePath.startsWith(`${parentPath}/`);
}

function sourceOptions(snapshot: LibrarySnapshot): SourceOption[] {
  const options: SourceOption[] = snapshot.sets.map((set) => ({
    key: `set:${set.relativePath}`,
    kind: "set",
    label: set.displayName,
    set,
  }));
  if (snapshot.standaloneProjects.length > 0) {
    options.push({ key: "standalone", kind: "standalone", label: "Standalone" });
  }
  if (snapshot.audioFiles.some((file) => file.storageScope === "unclassified")) {
    options.push({ key: "unclassified", kind: "unclassified", label: "Unclassified" });
  }
  return options;
}

function locationsFor(
  source: SourceOption | undefined,
  snapshot: LibrarySnapshot,
): LocationOption[] {
  if (source?.kind === "set") {
    const locations: LocationOption[] = [];
    if (source.set.hasAudioPool) {
      locations.push({
        key: `pool:${source.set.relativePath}`,
        kind: "audio_pool",
        label: "Audio Pool",
        parentPath: source.set.relativePath,
      });
    }
    locations.push(
      ...source.set.projects.map((project) => ({
        key: `project:${project.relativePath}`,
        kind: "project" as const,
        label: project.displayName,
        project,
      })),
    );
    return locations;
  }
  if (source?.kind === "standalone") {
    return snapshot.standaloneProjects.map((project) => ({
      key: `project:${project.relativePath}`,
      kind: "project" as const,
      label: project.displayName,
      project,
    }));
  }
  if (source?.kind === "unclassified") {
    return [{ key: "unclassified", kind: "unclassified", label: "Unknown scope" }];
  }
  return [];
}

function filesFor(
  location: LocationOption | undefined,
  audioFiles: LibraryAudioFile[],
): LibraryAudioFile[] {
  const files = audioFiles.filter((file) => {
    if (location?.kind === "audio_pool") {
      return file.storageScope === "set_audio_pool"
        && isWithin(file.relativePath, location.parentPath);
    }
    if (location?.kind === "project") {
      return file.storageScope === "project_local"
        && isWithin(file.relativePath, location.project.relativePath);
    }
    return location?.kind === "unclassified" && file.storageScope === "unclassified";
  });
  return files.sort((left, right) => {
    if (left.relativePath < right.relativePath) return -1;
    if (left.relativePath > right.relativePath) return 1;
    return 0;
  });
}

function formatBytes(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function displaySourceLabel(source: SourceOption, t: TranslateFn): string {
  if (source.kind === "standalone") return t("library.sourceStandalone");
  if (source.kind === "unclassified") return t("library.sourceUnclassified");
  return source.label;
}

function displayLocationLabel(location: LocationOption, t: TranslateFn): string {
  if (location.kind === "audio_pool") return t("library.locationAudioPool");
  if (location.kind === "unclassified") return t("library.locationUnknownScope");
  return location.label;
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
  const sources = useMemo(() => sourceOptions(snapshot), [snapshot]);
  const [sourceKey, setSourceKey] = useState<string | null>(sources[0]?.key ?? null);
  const selectedSource = sources.find((source) => source.key === sourceKey) ?? sources[0];
  const locations = useMemo(
    () => locationsFor(selectedSource, snapshot),
    [selectedSource, snapshot],
  );
  const [locationKey, setLocationKey] = useState<string | null>(null);
  const selectedLocation = locations.find((location) => location.key === locationKey)
    ?? locations[0];
  const locationFiles = useMemo(
    () => filesFor(selectedLocation, snapshot.audioFiles),
    [selectedLocation, snapshot.audioFiles],
  );
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CatalogFileSort>("name");
  const [requestedPage, setRequestedPage] = useState(0);
  const fileQuery = useMemo(
    () => queryCatalogFiles({ files: locationFiles, search, sort, page: requestedPage }),
    [locationFiles, search, sort, requestedPage],
  );
  const [selectedFileInstanceId, setSelectedFileInstanceId] = useState<string | null>(null);
  const selectedFile = useMemo(() => {
    if (selectedFileInstanceId === null) return undefined;
    return locationFiles.find((file) => file.fileInstanceId === selectedFileInstanceId);
  }, [locationFiles, selectedFileInstanceId]);
  const shellInspector = inspectorPlacement === "shell";
  const [libraryGeometryRange, setLibraryGeometryRange] =
    useState<LibraryCommittedGeometryRange | null>(null);
  const [stopLibraryPlaybackToken, setStopLibraryPlaybackToken] = useState(0);
  const handleLibraryGeometryRange = useCallback(
    (range: LibraryCommittedGeometryRange | null) => {
      setLibraryGeometryRange(range);
    },
    [],
  );
  const requestStopLibraryPlayback = useCallback(() => {
    setStopLibraryPlaybackToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (
      selectedFileInstanceId !== null
      && !locationFiles.some((file) => file.fileInstanceId === selectedFileInstanceId)
    ) {
      setSelectedFileInstanceId(null);
    }
  }, [locationFiles, selectedFileInstanceId]);

  useEffect(() => {
    if (!onBrowseContextChange) return;
    if (selectedSource === undefined || selectedLocation === undefined) {
      onBrowseContextChange(null);
      return;
    }
    onBrowseContextChange({
      sourceLabel: displaySourceLabel(selectedSource, t),
      locationLabel: displayLocationLabel(selectedLocation, t),
      locationCount: fileQuery.locationCount,
      matchingCount: fileQuery.matchingCount,
      hasSearch: search.trim() !== "",
    });
  }, [
    onBrowseContextChange,
    selectedSource,
    selectedLocation,
    fileQuery.locationCount,
    fileQuery.matchingCount,
    search,
    t,
  ]);

  useEffect(() => {
    if (!onSelectedAssetChange) return;
    if (selectedFile === undefined) {
      onSelectedAssetChange(null);
      return;
    }
    onSelectedAssetChange({
      assetId: selectedFile.assetId,
      fileInstanceId: selectedFile.fileInstanceId,
      displayName: selectedFile.displayName,
      relativePath: selectedFile.relativePath,
    });
  }, [onSelectedAssetChange, selectedFile]);

  function selectSource(nextKey: string) {
    setSourceKey(nextKey);
    setLocationKey(null);
    setSelectedFileInstanceId(null);
    setRequestedPage(0);
  }

  function selectLocation(nextKey: string) {
    setLocationKey(nextKey);
    setSelectedFileInstanceId(null);
    setRequestedPage(0);
  }

  function changeSearch(nextSearch: string) {
    setSearch(nextSearch);
    setRequestedPage(0);
  }

  function changeSort(nextSort: CatalogFileSort) {
    setSort(nextSort);
    setRequestedPage(0);
  }

  if (sources.length === 0) {
    return <p className="catalog-library-empty">{t("library.noCatalogEntries")}</p>;
  }

  const emptyFilesMessage = locationFiles.length === 0
    ? t("library.noFilesHere")
    : search.trim() !== "" && fileQuery.matchingCount === 0
      ? t("library.noSearchMatches")
      : null;

  const detail = (
    <div
      className={[
        "catalog-library-detail",
        shellInspector ? "catalog-library-detail--files-only" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="catalog-library-column catalog-library-files" aria-label={t("library.audioFilesAria")}>
        <h4>{t("library.audioFilesHeading")}</h4>
        <div className="catalog-library-search">
          <label>
            {t("library.searchLabel")}
            <input
              type="search"
              aria-label={t("library.searchAria")}
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder={t("library.searchPlaceholder")}
            />
          </label>
          <label>
            {t("library.sortLabel")}
            <select
              aria-label={t("library.sortAria")}
              value={sort}
              onChange={(event) => changeSort(event.target.value as CatalogFileSort)}
            >
              <option value="name">{t("library.sortName")}</option>
              <option value="size">{t("library.sortSize")}</option>
            </select>
          </label>
        </div>
        <p className="catalog-library-file-count" aria-live="polite">
          {search.trim() !== ""
            ? t("library.fileCountSearch", {
                matching: fileQuery.matchingCount,
                total: fileQuery.locationCount,
              })
            : t("library.fileCountLocation", { total: fileQuery.locationCount })}
        </p>
        <div className="catalog-library-options">
          {fileQuery.visible.map((file) => (
            <button
              type="button"
              className="catalog-library-file"
              aria-pressed={file.fileInstanceId === selectedFileInstanceId}
              key={file.fileInstanceId}
              onClick={() => setSelectedFileInstanceId(file.fileInstanceId)}
            >
              <div>
                <strong>{file.displayName}</strong>
                <code>{file.relativePath}</code>
              </div>
              <span>{formatBytes(file.byteSize)}</span>
            </button>
          ))}
          {emptyFilesMessage !== null && (
            <p className="catalog-library-empty">{emptyFilesMessage}</p>
          )}
        </div>
        {fileQuery.lastPage > 0 && (
          <nav className="catalog-library-pagination" aria-label={t("library.paginationAria")}>
            <Button
              variant="secondary"
              disabled={fileQuery.page <= 0}
              onClick={() => setRequestedPage(Math.max(0, fileQuery.page - 1))}
            >
              {t("library.paginationPrevious")}
            </Button>
            <span>
              {t("library.paginationPage", {
                current: fileQuery.page + 1,
                last: fileQuery.lastPage + 1,
              })}
            </span>
            <Button
              variant="secondary"
              disabled={fileQuery.page >= fileQuery.lastPage}
              onClick={() => setRequestedPage(fileQuery.page + 1)}
            >
              {t("library.paginationNext")}
            </Button>
          </nav>
        )}
      </div>

      {!shellInspector && (
        <div className="catalog-library-column catalog-library-inspector" aria-label={t("library.assetInspectorAria")}>
          <h4>{t("library.inspectorColumn")}</h4>
          {selectedFile === undefined ? (
            <p className="catalog-library-empty">{t("library.selectFileForMetadata")}</p>
          ) : (
            <div
              className="catalog-library-inspector-content"
              key={`${rootId}:${selectedFile.assetId}:${selectedFile.relativePath}`}
            >
              <WaveformPreview
                api={audioClient}
                rootId={rootId}
                assetId={selectedFile.assetId}
                displayName={selectedFile.displayName}
                onCommittedGeometryRangeChange={handleLibraryGeometryRange}
                stopPlaybackToken={stopLibraryPlaybackToken}
              />
              <SliceWorkbench
                rootId={rootId}
                fileInstanceId={selectedFile.fileInstanceId}
                displayName={selectedFile.displayName}
                librarySelectionRange={libraryGeometryRange}
                onRequestStopLibraryPlayback={requestStopLibraryPlayback}
              />
              <UsageGraphPanel
                relativePath={selectedFile.relativePath}
                edges={snapshot.usageEdges}
              />
              <ManualAssetMetadataEditor
                api={metadataClient}
                rootId={rootId}
                assetId={selectedFile.assetId}
                displayName={selectedFile.displayName}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  let region = detail;
  if (selectedLocation?.kind === "project") {
    region = (
      <ProjectWorkspace
        project={selectedLocation.project}
        localSampleCount={locationFiles.length}
      >
        {detail}
      </ProjectWorkspace>
    );
  } else if (selectedLocation?.kind === "audio_pool") {
    region = (
      <AudioLibrary
        scope="audio_pool"
        parentPath={selectedLocation.parentPath}
        fileCount={locationFiles.length}
      >
        {detail}
      </AudioLibrary>
    );
  } else if (selectedLocation?.kind === "unclassified") {
    region = (
      <AudioLibrary scope="unclassified" fileCount={locationFiles.length}>
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
        <div className="catalog-library-column" aria-label={t("library.sourcesAria")}>
          <h4>{t("library.browseColumn")}</h4>
          <div className="catalog-library-options">
            {sources.map((source) => (
              <button
                type="button"
                className="catalog-library-option"
                aria-pressed={source.key === selectedSource?.key}
                key={source.key}
                onClick={() => selectSource(source.key)}
              >
                <span>{displaySourceLabel(source, t)}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>

        <div className="catalog-library-column" aria-label={t("library.locationsAria")}>
          <h4>{t("library.locationsColumn")}</h4>
          <div className="catalog-library-options">
            {locations.map((location) => (
              <button
                type="button"
                className="catalog-library-option"
                aria-pressed={location.key === selectedLocation?.key}
                key={location.key}
                onClick={() => selectLocation(location.key)}
              >
                <span>{displayLocationLabel(location, t)}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
            {locations.length === 0 && (
              <p className="catalog-library-empty">{t("library.noLocations")}</p>
            )}
          </div>
        </div>

        <div className="catalog-library-region">{region}</div>
      </div>
    </section>
  );
}
