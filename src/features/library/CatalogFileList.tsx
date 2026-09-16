import type { LibraryAudioFile } from "../../api";
import { Button } from "../../design-system";
import { useTranslate } from "../../i18n";
import { SampleOperationsMenu } from "../changes/SampleOperationsMenu";
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
  catalogRefreshing?: boolean;
  catalogError?: string | null;
  onSampleRename?: () => void;
  onSampleCopy?: () => void;
  sampleRenameDisabled?: boolean;
  sampleCopyDisabled?: boolean;
  sampleOpsBusy?: boolean;
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
  catalogRefreshing = false,
  catalogError = null,
  onSampleRename,
  onSampleCopy,
  sampleRenameDisabled = false,
  sampleCopyDisabled = false,
  sampleOpsBusy = false,
}: CatalogFileListProps) {
  const t = useTranslate();

  const emptyFilesMessage = locationFiles.length === 0
    ? t("library.noFilesHere")
    : search.trim() !== "" && fileQuery.matchingCount === 0
      ? t("library.noSearchMatches")
      : null;

  const selectedOffPage = selectedFileInstanceId !== null
    && !fileQuery.visible.some((file) => file.fileInstanceId === selectedFileInstanceId)
    && locationFiles.some((file) => file.fileInstanceId === selectedFileInstanceId);

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
      {catalogRefreshing && (
        <p className="catalog-library-list-status" role="status">
          {t("library.fileListRefreshing")}
        </p>
      )}
      {catalogError !== null && catalogError !== "" && (
        <p className="catalog-library-list-error" role="alert">
          {t("library.fileListLoadFailed")}
        </p>
      )}
      {selectedOffPage && (
        <p className="catalog-library-list-offpage" role="status">
          {t("library.selectionOffPage")}
        </p>
      )}
      {selectedFileInstanceId !== null && onSampleRename !== undefined && onSampleCopy !== undefined && (
        <SampleOperationsMenu
          renameDisabled={sampleRenameDisabled}
          copyDisabled={sampleCopyDisabled}
          renameBusy={sampleOpsBusy}
          onRename={onSampleRename}
          onCopy={onSampleCopy}
        />
      )}
      <div
        className="catalog-file-table"
        role="grid"
        aria-rowcount={fileQuery.visible.length + 1}
        aria-colcount={3}
      >
        <div className="catalog-file-table__header" role="row" aria-rowindex={1}>
          <span className="catalog-file-table__cell catalog-file-table__cell--name" role="columnheader">
            {t("library.columnName")}
          </span>
          <span className="catalog-file-table__cell catalog-file-table__cell--size" role="columnheader">
            {t("library.columnSize")}
          </span>
          <span className="catalog-file-table__cell catalog-file-table__cell--format" role="columnheader">
            {t("library.columnFormat")}
          </span>
        </div>
        <div className="catalog-file-table__body" role="rowgroup">
          {fileQuery.visible.map((file, index) => {
            const selected = file.fileInstanceId === selectedFileInstanceId;
            return (
              <div
                className="catalog-file-table__row"
                role="row"
                aria-rowindex={index + 2}
                tabIndex={0}
                aria-selected={selected}
                key={file.fileInstanceId}
                onClick={() => onSelectFile(file.fileInstanceId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectFile(file.fileInstanceId);
                  }
                }}
              >
                <span className="catalog-file-table__cell catalog-file-table__cell--name" role="gridcell">
                  <strong className="catalog-file-table__name" title={file.displayName}>
                    {file.displayName}
                  </strong>
                  <code className="catalog-file-table__path" title={file.relativePath}>
                    {file.relativePath}
                  </code>
                </span>
                <span className="catalog-file-table__cell catalog-file-table__cell--size" role="gridcell">
                  {formatCatalogBytes(file.byteSize)}
                </span>
                <span className="catalog-file-table__cell catalog-file-table__cell--format" role="gridcell">
                  {fileExtensionFromName(file.displayName)}
                </span>
              </div>
            );
          })}
        </div>
        {emptyFilesMessage !== null && fileQuery.visible.length === 0 && (
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
