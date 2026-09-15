import type { LibraryAudioFile } from "../../api";
import { Button } from "../../design-system";
import { useTranslate } from "../../i18n";
import {
  fileExtensionFromName,
  formatCatalogBytes,
} from "./catalogBrowseModel";
import { type CatalogFileSort } from "./catalogFileQuery";

export interface CatalogFileListProps {
  fileQuery: {
    visible: LibraryAudioFile[];
    page: number;
    lastPage: number;
    locationCount: number;
    matchingCount: number;
  };
  locationFiles: LibraryAudioFile[];
  search: string;
  sort: CatalogFileSort;
  selectedFileInstanceId: string | null;
  onSelectFile: (fileInstanceId: string) => void;
  onSearchChange?: (next: string) => void;
  onSortChange: (next: CatalogFileSort) => void;
  onPageChange: (next: number) => void;
  hideSearch?: boolean;
  showExtension?: boolean;
}

export function CatalogFileList({
  fileQuery,
  locationFiles,
  search,
  sort,
  selectedFileInstanceId,
  onSelectFile,
  onSearchChange,
  onSortChange,
  onPageChange,
  hideSearch = false,
  showExtension = false,
}: CatalogFileListProps) {
  const t = useTranslate();

  const emptyFilesMessage = locationFiles.length === 0
    ? t("library.noFilesHere")
    : search.trim() !== "" && fileQuery.matchingCount === 0
      ? t("library.noSearchMatches")
      : null;

  return (
    <div className="catalog-library-column catalog-library-files" aria-label={t("library.audioFilesAria")}>
      <h4>{t("library.audioFilesHeading")}</h4>
      <div className="catalog-library-search">
        {!hideSearch && onSearchChange !== undefined && (
          <label>
            {t("library.searchLabel")}
            <input
              type="search"
              aria-label={t("library.searchAria")}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t("library.searchPlaceholder")}
            />
          </label>
        )}
        <label>
          {t("library.sortLabel")}
          <select
            aria-label={t("library.sortAria")}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as CatalogFileSort)}
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
            onClick={() => onSelectFile(file.fileInstanceId)}
          >
            <div>
              <strong title={file.displayName}>{file.displayName}</strong>
              <code title={file.relativePath}>{file.relativePath}</code>
            </div>
            <span className="catalog-library-file__meta">
              {showExtension && (
                <span className="catalog-library-file__ext">
                  {fileExtensionFromName(file.displayName)}
                </span>
              )}
              {formatCatalogBytes(file.byteSize)}
            </span>
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
            onClick={() => onPageChange(Math.max(0, fileQuery.page - 1))}
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
            onClick={() => onPageChange(fileQuery.page + 1)}
          >
            {t("library.paginationNext")}
          </Button>
        </nav>
      )}
    </div>
  );
}
