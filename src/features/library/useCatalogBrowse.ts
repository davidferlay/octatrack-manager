import { useEffect, useMemo, useState } from "react";
import type { LibraryAudioFile, LibrarySnapshot } from "../../api";
import { useTranslate } from "../../i18n";
import type { CatalogBrowseContext } from "./CatalogLibraryBrowser";
import {
  catalogFilesForLocation,
  catalogLocationsFor,
  catalogSourceOptions,
  displayCatalogLocationLabel,
  displayCatalogSourceLabel,
  type CatalogLocationOption,
  type CatalogSourceOption,
} from "./catalogBrowseModel";
import { type CatalogFileSort, queryCatalogFiles } from "./catalogFileQuery";

export interface CatalogBrowseState {
  sources: CatalogSourceOption[];
  selectedSource: CatalogSourceOption | undefined;
  locations: CatalogLocationOption[];
  selectedLocation: CatalogLocationOption | undefined;
  locationFiles: LibraryAudioFile[];
  search: string;
  sort: CatalogFileSort;
  requestedPage: number;
  fileQuery: ReturnType<typeof queryCatalogFiles>;
  selectedFileInstanceId: string | null;
  selectedFile: LibraryAudioFile | undefined;
  selectSource: (nextKey: string) => void;
  selectLocation: (nextKey: string) => void;
  setSearch: (next: string) => void;
  setSort: (next: CatalogFileSort) => void;
  setRequestedPage: (next: number) => void;
  selectFileInstanceId: (next: string | null) => void;
  resetForSnapshot: () => void;
}

export function useCatalogBrowse(
  snapshot: LibrarySnapshot,
  options?: {
    onBrowseContextChange?: (context: CatalogBrowseContext | null) => void;
    externalSearch?: string;
    onSearchChange?: (next: string) => void;
  },
): CatalogBrowseState {
  const t = useTranslate();
  const sources = useMemo(() => catalogSourceOptions(snapshot), [snapshot]);
  const [sourceKey, setSourceKey] = useState<string | null>(sources[0]?.key ?? null);
  const selectedSource = sources.find((source) => source.key === sourceKey) ?? sources[0];
  const locations = useMemo(
    () => catalogLocationsFor(selectedSource, snapshot),
    [selectedSource, snapshot],
  );
  const [locationKey, setLocationKey] = useState<string | null>(null);
  const selectedLocation = locations.find((location) => location.key === locationKey)
    ?? locations[0];
  const locationFiles = useMemo(
    () => catalogFilesForLocation(selectedLocation, snapshot.audioFiles),
    [selectedLocation, snapshot.audioFiles],
  );
  const [internalSearch, setInternalSearch] = useState("");
  const search = options?.externalSearch ?? internalSearch;
  const setSearch = options?.onSearchChange ?? setInternalSearch;
  const [sort, setSort] = useState<CatalogFileSort>("name");
  const [requestedPage, setRequestedPage] = useState(0);
  // Top-bar search calls setLocationSearch directly; reset page when external search changes.
  useEffect(() => {
    if (options?.externalSearch === undefined) return;
    setRequestedPage(0);
  }, [options?.externalSearch, search]);
  const fileQuery = useMemo(
    () => queryCatalogFiles({ files: locationFiles, search, sort, page: requestedPage }),
    [locationFiles, search, sort, requestedPage],
  );
  const [selectedFileInstanceId, setSelectedFileInstanceId] = useState<string | null>(null);
  const selectedFile = useMemo(() => {
    if (selectedFileInstanceId === null) return undefined;
    return locationFiles.find((file) => file.fileInstanceId === selectedFileInstanceId);
  }, [locationFiles, selectedFileInstanceId]);

  useEffect(() => {
    if (
      selectedFileInstanceId !== null
      && !locationFiles.some((file) => file.fileInstanceId === selectedFileInstanceId)
    ) {
      setSelectedFileInstanceId(null);
    }
  }, [locationFiles, selectedFileInstanceId]);

  useEffect(() => {
    if (!options?.onBrowseContextChange) return;
    if (selectedSource === undefined || selectedLocation === undefined) {
      options.onBrowseContextChange(null);
      return;
    }
    options.onBrowseContextChange({
      sourceLabel: displayCatalogSourceLabel(selectedSource, t),
      locationLabel: displayCatalogLocationLabel(selectedLocation, t),
      locationCount: fileQuery.locationCount,
      matchingCount: fileQuery.matchingCount,
      hasSearch: search.trim() !== "",
    });
  }, [
    options?.onBrowseContextChange,
    selectedSource,
    selectedLocation,
    fileQuery.locationCount,
    fileQuery.matchingCount,
    search,
    t,
  ]);

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

  function resetForSnapshot() {
    setSourceKey(sources[0]?.key ?? null);
    setLocationKey(null);
    setSelectedFileInstanceId(null);
    setRequestedPage(0);
    if (options?.externalSearch === undefined) {
      setInternalSearch("");
    }
  }

  return {
    sources,
    selectedSource,
    locations,
    selectedLocation,
    locationFiles,
    search,
    sort,
    requestedPage,
    fileQuery,
    selectedFileInstanceId,
    selectedFile,
    selectSource,
    selectLocation,
    setSearch: changeSearch,
    setSort: changeSort,
    setRequestedPage,
    selectFileInstanceId: setSelectedFileInstanceId,
    resetForSnapshot,
  };
}
