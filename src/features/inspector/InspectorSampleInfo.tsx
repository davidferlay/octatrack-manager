import type { LibraryAudioFile } from "../../api";
import { useTranslate } from "../../i18n";
import {
  displayStorageScopeLabel,
  fileExtensionFromName,
  formatCatalogBytes,
} from "../library/catalogBrowseModel";

export interface InspectorSampleInfoProps {
  file: LibraryAudioFile;
}

export function InspectorSampleInfo({ file }: InspectorSampleInfoProps) {
  const t = useTranslate();
  return (
    <dl className="mo-inspector-sample-info">
      <div>
        <dt>{t("inspector.infoName")}</dt>
        <dd>{file.displayName}</dd>
      </div>
      <div>
        <dt>{t("inspector.infoPath")}</dt>
        <dd><code>{file.relativePath}</code></dd>
      </div>
      <div>
        <dt>{t("inspector.infoSize")}</dt>
        <dd>{formatCatalogBytes(file.byteSize)}</dd>
      </div>
      <div>
        <dt>{t("inspector.infoFormat")}</dt>
        <dd>{fileExtensionFromName(file.displayName)}</dd>
      </div>
      <div>
        <dt>{t("inspector.infoScope")}</dt>
        <dd>{displayStorageScopeLabel(file.storageScope, t)}</dd>
      </div>
    </dl>
  );
}
