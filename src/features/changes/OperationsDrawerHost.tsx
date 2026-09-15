import { useRef, type ReactNode } from "react";
import type {
  ChangeApi,
  ChangeRecoveryStatus,
  CloneVerification,
  RenameApi,
  RenameRecoveryStatus,
  RootSession,
} from "../../api";
import { Drawer } from "../../design-system";
import { useTranslate } from "../../i18n";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";
import { AdditiveCopyChangeDrawer } from "./AdditiveCopyChangeDrawer";
import { CloneOperatorPanel } from "./CloneOperatorPanel";
import { RenameOperatorPanel } from "./RenameOperatorPanel";
import { RenameSampleModal } from "./RenameSampleModal";
import "./OperationsDrawerHost.css";

export type OperationsDrawerKind = "clone" | "rename" | "copy";

export interface OperationsDrawerHostProps {
  open: boolean;
  kind: OperationsDrawerKind;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  session: RootSession;
  pinnedAsset: CatalogAssetSelection | null;
  recovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
  cloneVerification: CloneVerification | null;
  sourceEvidenceRecorded: boolean;
  busy: boolean;
  renameClient: RenameApi;
  changeClient: ChangeApi;
  cloneHandlers: {
    onCreateManagedClone: () => Promise<void>;
    onRecordSourceEvidence: () => Promise<void>;
    onRegisterExternalClone: () => Promise<void>;
    onVerifyExternal: (acknowledgedDisposableClone: boolean) => Promise<void>;
    onReverify: () => Promise<void>;
  };
  refreshSession: () => Promise<RootSession>;
  onRenamePrepared: () => Promise<void> | void;
  onRenameApplied: () => Promise<void> | void;
  onRenameRecovered: () => Promise<void> | void;
  onCopyCommitted: () => Promise<void> | void;
  onCopyRecovered: () => Promise<void> | void;
  onBusyChange: (busy: boolean) => void;
  onRenameRecoveryChange: (recovery: RenameRecoveryStatus) => void;
  onRecoveryChange: (recovery: ChangeRecoveryStatus) => void;
}

function drawerMeta(
  kind: OperationsDrawerKind,
  t: ReturnType<typeof useTranslate>,
): { title: string; eyebrow: string } {
  switch (kind) {
    case "clone":
      return { eyebrow: t("operations.eyebrowSafety"), title: t("operations.drawerCloneTitle") };
    case "rename":
      return { eyebrow: t("operations.eyebrowIntent"), title: t("operations.drawerRenameTitle") };
    case "copy":
      return { eyebrow: t("operations.eyebrowIntent"), title: t("operations.drawerCopyTitle") };
  }
}

export function OperationsDrawerHost({
  open,
  kind,
  onClose,
  returnFocusRef,
  session,
  pinnedAsset,
  recovery,
  renameRecovery,
  cloneVerification,
  sourceEvidenceRecorded,
  busy,
  renameClient,
  changeClient,
  cloneHandlers,
  refreshSession,
  onRenamePrepared,
  onRenameApplied,
  onRenameRecovered,
  onCopyCommitted,
  onCopyRecovered,
  onBusyChange,
  onRenameRecoveryChange,
  onRecoveryChange,
}: OperationsDrawerHostProps) {
  const t = useTranslate();
  const hostRef = useRef<HTMLDivElement>(null);
  const { title, eyebrow } = drawerMeta(kind, t);

  const targetBlock = pinnedAsset !== null ? (
    <div className="mo-operations-drawer__target" role="status">
      <span className="mo-operations-drawer__target-label">{t("operations.pinnedTarget")}</span>
      <strong>{pinnedAsset.displayName}</strong>
      <code>{pinnedAsset.relativePath}</code>
    </div>
  ) : null;

  const sectionProps = (active: boolean) => ({
    hidden: !active,
    "aria-hidden": !active,
    inert: active ? undefined : (true as const),
    className: active ? "mo-operations-drawer__section" : "mo-operations-drawer__section mo-operations-drawer__section--inactive",
  });

  const body: ReactNode = (
    <>
      <div {...sectionProps(open && kind === "clone")}>
        <CloneOperatorPanel
          session={session}
          cloneVerification={cloneVerification}
          busy={busy}
          sourceEvidenceRecorded={sourceEvidenceRecorded}
          onCreateManagedClone={cloneHandlers.onCreateManagedClone}
          onRecordSourceEvidence={cloneHandlers.onRecordSourceEvidence}
          onRegisterExternalClone={cloneHandlers.onRegisterExternalClone}
          onVerifyExternal={cloneHandlers.onVerifyExternal}
          onReverify={cloneHandlers.onReverify}
        />
      </div>
      <div {...sectionProps(open && kind === "rename")}>
        {targetBlock}
        {pinnedAsset !== null && (
          <RenameSampleModal
            presentation="embedded"
            visible={open && kind === "rename"}
            session={session}
            selectedAsset={pinnedAsset}
            changeRecovery={recovery}
            renameRecovery={renameRecovery}
            api={renameClient}
            onClose={onClose}
            refreshSession={refreshSession}
            onPrepared={onRenamePrepared}
            onRenameRecoveryChange={onRenameRecoveryChange}
          />
        )}
        <RenameOperatorPanel
          session={session}
          changeRecovery={recovery}
          renameRecovery={renameRecovery}
          cloneVerification={cloneVerification}
          api={renameClient}
          changeClient={changeClient}
          disabled={busy}
          refreshSession={refreshSession}
          onApplied={onRenameApplied}
          onRecovered={onRenameRecovered}
          onBusyChange={onBusyChange}
          onRenameRecoveryChange={onRenameRecoveryChange}
          onRecoveryChange={onRecoveryChange}
        />
      </div>
      <div {...sectionProps(open && kind === "copy")}>
        {targetBlock}
        <AdditiveCopyChangeDrawer
          session={session}
          targetAsset={pinnedAsset}
          recovery={recovery}
          renameRecovery={renameRecovery}
          api={changeClient}
          disabled={busy}
          embeddedInDrawer
          refreshSession={refreshSession}
          onCommitted={onCopyCommitted}
          onRecovered={onCopyRecovered}
          onBusyChange={onBusyChange}
          onRecoveryChange={onRecoveryChange}
        />
      </div>
    </>
  );

  return (
    <div ref={hostRef} className="mo-operations-drawer-host" data-testid="operations-drawer-host">
      <Drawer
        open={open}
        onClose={onClose}
        title={title}
        eyebrow={eyebrow}
        closeAriaLabel={t("operations.closeDrawer")}
        returnFocusRef={returnFocusRef}
        panelClassName="mo-operations-drawer-panel"
      >
        {body}
      </Drawer>
    </div>
  );
}
