import { Button } from "../../design-system";
import { useTranslate } from "../../i18n";
import "./SampleOperationsMenu.css";

export interface SampleOperationsMenuProps {
  renameDisabled: boolean;
  copyDisabled: boolean;
  renameBusy?: boolean;
  renameHintId?: string;
  copyHintId?: string;
  onRename: () => void;
  onCopy: () => void;
}

export function SampleOperationsMenu({
  renameDisabled,
  copyDisabled,
  renameBusy = false,
  renameHintId,
  copyHintId,
  onRename,
  onCopy,
}: SampleOperationsMenuProps) {
  const t = useTranslate();
  return (
    <div className="mo-sample-ops" role="group" aria-label={t("operations.sampleMenuAria")}>
      <Button
        variant="secondary"
        disabled={renameBusy || renameDisabled}
        onClick={onRename}
        title={renameDisabled ? t("operations.renameDisabledTitle") : t("inspector.renameTitle")}
        aria-describedby={renameDisabled && renameHintId ? renameHintId : undefined}
      >
        {t("inspector.renameAction")}
      </Button>
      <Button
        variant="secondary"
        disabled={renameBusy || copyDisabled}
        onClick={onCopy}
        title={copyDisabled ? t("operations.copyDisabledTitle") : t("operations.copyTitle")}
        aria-describedby={copyDisabled && copyHintId ? copyHintId : undefined}
      >
        {t("operations.copyAction")}
      </Button>
    </div>
  );
}
