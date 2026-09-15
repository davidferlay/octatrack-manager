import { renderHook, act } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { LibrarySnapshot } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { CATALOG_PAGE_SIZE } from "./catalogFileQuery";
import { useCatalogBrowse } from "./useCatalogBrowse";

function buildSnapshot(fileCount: number): LibrarySnapshot {
  const audioFiles = Array.from({ length: fileCount }, (_, index) => ({
    fileInstanceId: `file-${index}`,
    assetId: `asset-${index}`,
    displayName: `sample-${String(index).padStart(3, "0")}.wav`,
    relativePath: `LIVE_SET/AUDIO/sample-${String(index).padStart(3, "0")}.wav`,
    byteSize: 1024,
    storageScope: "set_audio_pool" as const,
  }));
  return {
    sets: [{
      displayName: "LIVE_SET",
      relativePath: "LIVE_SET",
      hasAudioPool: true,
      projects: [],
    }],
    standaloneProjects: [],
    audioFiles,
    usageEdges: [],
  };
}

function useExternalSearchBrowse(snapshot: LibrarySnapshot) {
  const [search, setSearch] = useState("");
  const browse = useCatalogBrowse(snapshot, {
    externalSearch: search,
    onSearchChange: setSearch,
  });
  return { browse, setSearch };
}

describe("useCatalogBrowse", () => {
  it("resets to page 0 when external search changes after paging", () => {
    const snapshot = buildSnapshot(CATALOG_PAGE_SIZE * 3 + 5);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(LocaleProvider, { initialLocaleId: "ja", children });
    const { result } = renderHook(() => useExternalSearchBrowse(snapshot), { wrapper });

    act(() => {
      result.current.browse.setRequestedPage(2);
    });
    expect(result.current.browse.fileQuery.page).toBe(2);

    act(() => {
      result.current.setSearch("sample");
    });
    expect(result.current.browse.fileQuery.page).toBe(0);
    expect(result.current.browse.fileQuery.lastPage).toBeGreaterThan(0);
    expect(result.current.browse.fileQuery.matchingCount).toBe(CATALOG_PAGE_SIZE * 3 + 5);
  });
});
