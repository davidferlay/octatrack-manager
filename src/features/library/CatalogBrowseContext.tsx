import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { LibrarySnapshot } from "../../api";
import type { CatalogAssetSelection, CatalogBrowseContext } from "./CatalogLibraryBrowser";
import { useCatalogBrowse, type CatalogBrowseState } from "./useCatalogBrowse";

interface CatalogBrowseProviderProps {
  snapshot: LibrarySnapshot;
  search: string;
  onSearchChange: (next: string) => void;
  onSelectedAssetChange: (selection: CatalogAssetSelection | null) => void;
  onBrowseContextChange: (context: CatalogBrowseContext | null) => void;
  children: ReactNode;
}

const CatalogBrowseContextValue = createContext<CatalogBrowseState | null>(null);

export function CatalogBrowseProvider({
  snapshot,
  search,
  onSearchChange,
  onSelectedAssetChange,
  onBrowseContextChange,
  children,
}: CatalogBrowseProviderProps) {
  const browse = useCatalogBrowse(snapshot, {
    onBrowseContextChange,
    externalSearch: search,
    onSearchChange,
  });

  useEffect(() => {
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
  }, [browse.selectedFile, onSelectedAssetChange]);

  return (
    <CatalogBrowseContextValue.Provider value={browse}>
      {children}
    </CatalogBrowseContextValue.Provider>
  );
}

export function useCatalogBrowseContext(): CatalogBrowseState {
  const value = useContext(CatalogBrowseContextValue);
  if (value === null) {
    throw new Error("useCatalogBrowseContext must be used within CatalogBrowseProvider");
  }
  return value;
}
