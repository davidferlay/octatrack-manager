import { useEffect, useMemo, useState } from "react";
import type {
  AudioApi,
  LibraryAudioFile,
  LibraryProject,
  LibrarySet,
  LibrarySnapshot,
  MetadataApi,
} from "../../api";
import { audioApi, metadataApi } from "../../api";
import { ManualAssetMetadataEditor } from "../metadata/ManualAssetMetadataEditor";
import { ProjectWorkspace } from "../project-workspace";
import { UsageGraphPanel } from "../usage";
import { WaveformPreview } from "../waveform/WaveformPreview";
import { AudioLibrary } from "./AudioLibrary";
import "./CatalogLibraryBrowser.css";

/** Opaque catalog asset selection for AppShell Inspector (UI4). */
export interface CatalogAssetSelection {
  assetId: string;
  fileInstanceId: string;
  displayName: string;
  relativePath: string;
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

export function CatalogLibraryBrowser({
  rootId,
  snapshot,
  audioClient = audioApi,
  metadataClient = metadataApi,
  inspectorPlacement = "inline",
  onSelectedAssetChange,
}: CatalogLibraryBrowserProps) {
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
  const audioFiles = useMemo(
    () => filesFor(selectedLocation, snapshot.audioFiles),
    [selectedLocation, snapshot.audioFiles],
  );
  const [selectedFileInstanceId, setSelectedFileInstanceId] = useState<string | null>(null);
  const selectedFile = audioFiles.find(
    (file) => file.fileInstanceId === selectedFileInstanceId,
  );
  const shellInspector = inspectorPlacement === "shell";

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
  }

  function selectLocation(nextKey: string) {
    setLocationKey(nextKey);
    setSelectedFileInstanceId(null);
  }

  if (sources.length === 0) {
    return <p className="catalog-library-empty">No catalog entries are available.</p>;
  }

  const detail = (
    <div
      className={[
        "catalog-library-detail",
        shellInspector ? "catalog-library-detail--files-only" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="catalog-library-column catalog-library-files" aria-label="Audio files">
        <h4>Audio files</h4>
        <div className="catalog-library-options">
          {audioFiles.map((file) => (
            <button
              type="button"
              className="catalog-library-file"
              aria-pressed={file.fileInstanceId === selectedFile?.fileInstanceId}
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
          {audioFiles.length === 0 && (
            <p className="catalog-library-empty">No audio files indexed here.</p>
          )}
        </div>
      </div>

      {!shellInspector && (
        <div className="catalog-library-column catalog-library-inspector" aria-label="Asset inspector">
          <h4>Inspector</h4>
          {selectedFile === undefined ? (
            <p className="catalog-library-empty">Select an audio file to edit local metadata.</p>
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
        localSampleCount={audioFiles.length}
      >
        {detail}
      </ProjectWorkspace>
    );
  } else if (selectedLocation?.kind === "audio_pool") {
    region = (
      <AudioLibrary
        scope="audio_pool"
        parentPath={selectedLocation.parentPath}
        fileCount={audioFiles.length}
      >
        {detail}
      </AudioLibrary>
    );
  } else if (selectedLocation?.kind === "unclassified") {
    region = (
      <AudioLibrary scope="unclassified" fileCount={audioFiles.length}>
        {detail}
      </AudioLibrary>
    );
  }

  return (
    <section className="catalog-library" aria-labelledby="catalog-library-title">
      <div className="catalog-library-title-row">
        <div>
          <p className="catalog-library-kicker">Catalog Library</p>
          <h3 id="catalog-library-title">Browse indexed audio</h3>
        </div>
        <span className="catalog-library-count">{snapshot.audioFiles.length} files</span>
      </div>

      <div className="catalog-library-layout">
        <div className="catalog-library-column" aria-label="Sources">
          <h4>Browse</h4>
          <div className="catalog-library-options">
            {sources.map((source) => (
              <button
                type="button"
                className="catalog-library-option"
                aria-pressed={source.key === selectedSource?.key}
                key={source.key}
                onClick={() => selectSource(source.key)}
              >
                <span>{source.label}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>

        <div className="catalog-library-column" aria-label="Locations">
          <h4>Locations</h4>
          <div className="catalog-library-options">
            {locations.map((location) => (
              <button
                type="button"
                className="catalog-library-option"
                aria-pressed={location.key === selectedLocation?.key}
                key={location.key}
                onClick={() => selectLocation(location.key)}
              >
                <span>{location.label}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
            {locations.length === 0 && (
              <p className="catalog-library-empty">No locations indexed.</p>
            )}
          </div>
        </div>

        <div className="catalog-library-region">{region}</div>
      </div>
    </section>
  );
}
