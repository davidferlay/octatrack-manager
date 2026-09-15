import type { ReactNode } from "react";
import { useTranslate } from "../../i18n";
import {
  displayCatalogLocationLabel,
  displayCatalogSourceLabel,
} from "./catalogBrowseModel";
import { CatalogFileList } from "./CatalogFileList";
import { CatalogLocationNav } from "./CatalogLocationNav";
import { useCatalogBrowseContext } from "./CatalogBrowseContext";
import { AudioLibrary } from "./AudioLibrary";
import { ProjectWorkspace } from "../project-workspace";
import "./CatalogLibraryBrowser.css";

export function CatalogWorkspaceNav({ footer }: { footer?: ReactNode }) {
  const browse = useCatalogBrowseContext();
  const t = useTranslate();
  if (browse.sources.length === 0) {
    return (
      <>
        <p className="catalog-library-empty">{t("library.noCatalogEntries")}</p>
        {footer}
      </>
    );
  }
  return (
    <>
      <CatalogLocationNav
        variant="tree"
        sources={browse.sources}
        selectedSourceKey={browse.selectedSource?.key}
        locations={browse.locations}
        selectedLocationKey={browse.selectedLocation?.key}
        onSelectSource={browse.selectSource}
        onSelectLocation={browse.selectLocation}
      />
      {footer}
    </>
  );
}

export interface CatalogWorkspaceMainProps {
  totalFiles: number;
  catalogRefreshing?: boolean;
  catalogError?: string | null;
  onSampleRename?: () => void;
  onSampleCopy?: () => void;
  sampleRenameDisabled?: boolean;
  sampleCopyDisabled?: boolean;
  sampleOpsBusy?: boolean;
}

export function CatalogWorkspaceMain({
  totalFiles,
  catalogRefreshing = false,
  catalogError = null,
  onSampleRename,
  onSampleCopy,
  sampleRenameDisabled = false,
  sampleCopyDisabled = false,
  sampleOpsBusy = false,
}: CatalogWorkspaceMainProps) {
  const browse = useCatalogBrowseContext();
  const t = useTranslate();

  const fileList = (
    <CatalogFileList
      fileQuery={browse.fileQuery}
      locationFiles={browse.locationFiles}
      search={browse.search}
      sort={browse.sort}
      selectedFileInstanceId={browse.selectedFileInstanceId}
      onSelectFile={(id) => browse.selectFileInstanceId(id)}
      onSortChange={browse.setSort}
      onPageChange={browse.setRequestedPage}
      hideSearch
      catalogRefreshing={catalogRefreshing}
      catalogError={catalogError}
      onSampleRename={onSampleRename}
      onSampleCopy={onSampleCopy}
      sampleRenameDisabled={sampleRenameDisabled}
      sampleCopyDisabled={sampleCopyDisabled}
      sampleOpsBusy={sampleOpsBusy}
    />
  );

  const detail = (
    <div className="catalog-library-detail catalog-library-detail--files-only">
      {fileList}
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

  const trail = browse.selectedSource !== undefined && browse.selectedLocation !== undefined
    ? `${displayCatalogSourceLabel(browse.selectedSource, t)} › ${displayCatalogLocationLabel(browse.selectedLocation, t)}`
    : null;

  return (
    <section className="catalog-workspace-main" aria-labelledby="catalog-workspace-main-title">
      <div className="catalog-library-title-row">
        <div>
          <p className="catalog-library-kicker">{t("library.kicker")}</p>
          <h3 id="catalog-workspace-main-title">{t("library.title")}</h3>
          {trail !== null && (
            <p className="catalog-workspace-main__trail">{trail}</p>
          )}
        </div>
        <span className="catalog-library-count">
          {t("library.snapshotFileCount", { count: totalFiles })}
        </span>
      </div>
      <div className="catalog-workspace-main__region">{region}</div>
    </section>
  );
}
