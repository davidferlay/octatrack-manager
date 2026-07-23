import { invoke } from '@tauri-apps/api/core';
import {
  ColumnToggle,
  FilterBadges,
  FixSamplesModal,
  HeaderActions,
  PoolFilesTable,
  poolTableTsv,
  useCopyFeedback,
  useModalResize,
  usePoolTable,
  type IncompatibleFile,
  type PoolFixResult,
  type PoolSortColumn,
} from './FixPoolFilesModal';
import type { PoolUsageEntry } from '../types/audioFile';

/**
 * Read-only list of a project's incompatible audio files (referenced-slot
 * files plus other incompatible files found in the project's own directory).
 * Structurally identical to PoolIncompatibleListModal, just project-scoped
 * copy and no Action column.
 */
export function ProjectIncompatibleListModal({ projectPath, files, onClose, usageMap, usageLoading }: {
  projectPath: string;
  files: IncompatibleFile[];
  onClose: () => void;
  usageMap?: Record<string, PoolUsageEntry[]>;
  usageLoading?: boolean;
}) {
  const table = usePoolTable(files, projectPath, false, ['size'], usageMap, usageLoading, true);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-content missing-samples-list-modal pool-list-modal"
        onClick={(e) => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className="modal-header missing-samples-header">
          <h3><i className="fas fa-list"></i> Incompatible Project Samples</h3>
          <div className="missing-samples-header-info">
            <span className="missing-samples-header-count">Showing {table.rows.length} of {files.length} files</span>
            <FilterBadges table={table} />
          </div>
          <HeaderActions
            searchText={table.searchText}
            setSearchText={table.setSearchText}
            onCopy={() => copy(poolTableTsv(table))}
            copyFeedback={copyFeedback}
            columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={(id) => table.toggleCol(id as PoolSortColumn)} />}
          />
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="table-wrapper">
            <PoolFilesTable table={table} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** Absolute path of the project directory. */
  projectPath: string;
  /** Incompatible files to convert. */
  files: IncompatibleFile[];
  /** Skip the review screen and start converting immediately. */
  skipReview?: boolean;
  onClose: () => void;
  /** Called once a fix run finished so callers can refresh their listings. */
  onFixed?: (result: PoolFixResult) => void;
  usageMap?: Record<string, PoolUsageEntry[]>;
  usageLoading?: boolean;
}

/**
 * Fix Project Samples: converts a project's incompatible referenced-slot and
 * unreferenced-directory files to 44.1 kHz 16/24-bit WAV in place (originals
 * replaced), then repoints sample-slot references across every project of
 * the Set (each project file is backed up first). A thin wrapper around the
 * shared FixSamplesModal (same review/convert/done flow as Fix Audio Pool
 * Samples), scoped to a project path and fix_project_samples.
 */
export function FixProjectFilesModal({ projectPath, files, skipReview = false, onClose, onFixed, usageMap, usageLoading }: Props) {
  return (
    <FixSamplesModal
      scopePath={projectPath}
      files={files}
      skipReview={skipReview}
      onClose={onClose}
      onFixed={onFixed}
      usageMap={usageMap}
      usageLoading={usageLoading}
      withSlot
      transferIdPrefix="fix-project"
      progressingLabel="Fixing Project Samples..."
      doneLabel="Fix Project Samples"
      runFix={(filePaths, transferId) => invoke<PoolFixResult>('fix_project_samples', { projectPath, filePaths, transferId })}
    />
  );
}
