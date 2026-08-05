import { useEffect, useMemo, useRef, useState } from 'react';
import { ColumnToggle, HeaderActions, useCopyFeedback, useModalResize } from './FixPoolFilesModal';

/** Matches the Rust `PurgeUnit` enum's `#[serde(tag = "kind")]` shape exactly. */
export type PurgeUnit =
  | { kind: 'File'; path: string; origin: string; size: number }
  | { kind: 'Directory'; path: string; origin: string; file_count: number; size: number };

function baseName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** The containing directory of `path` - the "Location" column/field below,
 * so two same-named files in different folders are distinguishable on the
 * one screen whose entire purpose is confirming exactly what's about to be
 * removed. */
function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type PurgeSortColumn = 'name' | 'location' | 'origin' | 'size';

const PURGE_COLUMNS: { id: PurgeSortColumn; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'location', label: 'Location' },
  { id: 'origin', label: 'Origin' },
  { id: 'size', label: 'Size' },
];

interface PurgeRow {
  unit: PurgeUnit;
  name: string;
  location: string;
  origin: string;
  size: number;
}

/**
 * Lightweight sortable/filterable table for purge rows - deliberately
 * separate from `usePoolTable` (FixPoolFilesModal.tsx), which is built
 * around per-file Format/Bit/kHz inspection and single-file convert
 * actions, neither of which apply to already-known-unused files or to
 * whole-directory rows.
 */
export function usePurgeTable(units: PurgeUnit[]) {
  const [searchText, setSearchText] = useState('');
  const [sortColumn, setSortColumn] = useState<PurgeSortColumn>('origin');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [originFilter, setOriginFilter] = useState('all');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());

  const allColumns = PURGE_COLUMNS;
  const origins = useMemo(() => Array.from(new Set(units.map(u => u.origin))).sort(), [units]);

  const rows = useMemo<PurgeRow[]>(() => {
    let filtered = units.map(unit => ({
      unit,
      name: baseName(unit.path),
      location: dirName(unit.path),
      origin: unit.origin,
      size: unit.size,
    }));

    if (originFilter !== 'all') filtered = filtered.filter(r => r.origin === originFilter);
    if (searchText.trim()) {
      const needle = searchText.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(needle) || r.unit.path.toLowerCase().includes(needle));
    }

    filtered.sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (sortColumn === 'size') return (a.size - b.size) * dir;
      return a[sortColumn].localeCompare(b[sortColumn]) * dir;
    });

    return filtered;
  }, [units, searchText, originFilter, sortColumn, sortDirection]);

  const totalSize = useMemo(() => units.reduce((sum, u) => sum + u.size, 0), [units]);
  const totalDirs = useMemo(() => units.filter(u => u.kind === 'Directory').length, [units]);

  return {
    rows, allColumns, hiddenCols, toggleCol: (id: string) => setHiddenCols(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }),
    searchText, setSearchText,
    sortColumn, setSortColumn, sortDirection, setSortDirection,
    originFilter, setOriginFilter, origins,
    totalSize, totalDirs,
  };
}

export function purgeTableTsv(table: ReturnType<typeof usePurgeTable>): string {
  const header = ['Name', 'Location', 'Origin', 'Size'].join('\t');
  const lines = table.rows.map(r => [r.name, r.location, r.origin, formatSize(r.size)].join('\t'));
  return [header, ...lines].join('\n');
}

export function PurgeUnitsTable({ table }: { table: ReturnType<typeof usePurgeTable> }) {
  const { rows, hiddenCols } = table;
  return (
    <table className="pool-files-table">
      <thead>
        <tr>
          {!hiddenCols.has('name') && <th>Name</th>}
          {!hiddenCols.has('location') && <th>Location</th>}
          {!hiddenCols.has('origin') && <th>Origin</th>}
          {!hiddenCols.has('size') && <th>Size</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.unit.path}>
            {!hiddenCols.has('name') && (
              <td title={r.unit.path}>
                {r.unit.kind === 'Directory' && <i className="fas fa-folder" title={`${r.unit.file_count} files`}></i>}
                {' '}
                {r.name}
                {r.unit.kind === 'Directory' && <span className="pool-dir-file-count"> ({r.unit.file_count} files)</span>}
              </td>
            )}
            {!hiddenCols.has('location') && <td title={r.location}>{r.location}</td>}
            {!hiddenCols.has('origin') && <td>{r.origin}</td>}
            {!hiddenCols.has('size') && <td>{formatSize(r.size)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Read-only preview modal, opened from the status button. */
export function PurgeUnusedListModal({ units, scope, onClose }: {
  units: PurgeUnit[];
  scope: 'project' | 'pool';
  onClose: () => void;
}) {
  const table = usePurgeTable(units);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();
  const title = scope === 'project' ? 'Unused Project Samples' : 'Unused Audio Pool Samples';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={modalRef} className="modal-content missing-samples-list-modal pool-list-modal" onClick={(e) => e.stopPropagation()} style={style}>
        {handles}
        <div className="modal-header missing-samples-header">
          <h3><i className="fas fa-list"></i> {title}</h3>
          <div className="missing-samples-header-info">
            <span className="missing-samples-header-count">Showing {table.rows.length} of {units.length} items</span>
          </div>
          <HeaderActions
            searchText={table.searchText}
            setSearchText={table.setSearchText}
            onCopy={() => copy(purgeTableTsv(table))}
            copyFeedback={copyFeedback}
            columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={table.toggleCol} />}
          />
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="table-wrapper">
            <PurgeUnitsTable table={table} />
          </div>
        </div>
      </div>
    </div>
  );
}

export interface PurgeResult {
  files_removed: string[];
  dirs_removed: string[];
  bytes_reclaimed: number;
  slots_cleared: number;
  projects_updated: string[];
  errors: string[];
}

type Phase = 'review' | 'removing' | 'done' | 'error';

export interface PurgeFilesModalProps {
  /** "project" or "pool" - only affects labels/titles. */
  scope: 'project' | 'pool';
  /** Absolute path of the project or Audio Pool directory being purged. */
  scopePath: string;
  /** The reviewed plan. */
  units: PurgeUnit[];
  /** 'delete' sends to the OS Trash; a destination path moves files there instead. */
  mode: 'delete' | { destinationDir: string };
  /** Skip the review screen and start immediately - only ever true for Move mode (Delete mode always forces review, enforced by the caller). */
  skipReview?: boolean;
  /**
   * Count of loaded-but-untriggered sample slots that will also be cleared
   * this run (from `count_unused_slot_assignments`/`count_slots_eligible_for_clearing`),
   * shown in the review summary alongside the file/directory counts so this
   * second destructive effect of the "Clear unused sample slot assignments"
   * option is visible before Apply Changes, not just on the done screen.
   * `undefined`/`null` when that option is off - no extra line is shown.
   */
  slotsToClear?: number | null;
  onClose: () => void;
  onPurged?: (result: PurgeResult) => void;
  /** The actual purge call - the only backend-command-shaped detail that differs between project and pool scope. */
  runPurge: (plan: PurgeUnit[], destinationDir: string | null) => Promise<PurgeResult>;
}

/**
 * Shared review/apply flow behind both "Purge Project Samples" and "Purge
 * Audio Pool Samples" - same review -> removing -> done/error phase shape
 * as FixSamplesModal (FixPoolFilesModal.tsx), without its per-file
 * progress/cancellation machinery: deleting/moving is fast local filesystem
 * work, not audio conversion, so a brief spinner is enough - no event
 * listening, no transfer_id/cancellation plumbing needed.
 *
 * `scopePath` is accepted (not read here) purely to keep this component's
 * prop shape consistent with `PurgeUnusedListModal` above and with the
 * Fix*Modal family - callers pass it through uniformly even though the
 * review table already shows full origin/size per row without it.
 */
export function PurgeFilesModal({ scope, units, mode, skipReview = false, slotsToClear, onClose, onPurged, runPurge }: PurgeFilesModalProps) {
  const [phase, setPhase] = useState<Phase>(skipReview ? 'removing' : 'review');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<PurgeResult | null>(null);
  const table = usePurgeTable(units);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();
  const startedRef = useRef(false);

  const isDelete = mode === 'delete';
  const doneLabel = scope === 'project' ? 'Purge Project Samples' : 'Purge Audio Pool Samples';
  const progressingLabel = isDelete ? 'Sending to Trash...' : 'Moving...';

  const start = () => {
    setPhase('removing');
    const destinationDir = isDelete ? null : mode.destinationDir;
    runPurge(units, destinationDir)
      .then((r) => {
        setResult(r);
        setPhase('done');
        onPurged?.(r);
      })
      .catch((e) => {
        setErrorMsg(String(e));
        setPhase('error');
      });
  };

  // Kick off immediately when review is skipped (Move mode with the review
  // checkbox off). startedRef (same guard pattern FixSamplesModal uses)
  // ensures this fires exactly once even if the component re-renders while
  // 'removing'.
  useEffect(() => {
    if (skipReview && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay" onClick={phase !== 'removing' ? onClose : undefined}>
      <div
        ref={modalRef}
        className={`modal-content missing-samples-list-modal pool-list-modal${phase !== 'review' ? ' fix-pool-modal-narrow' : ''}`}
        onClick={(e) => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className={`modal-header${phase === 'review' ? ' missing-samples-header' : ''}`}>
          <h3>
            {phase === 'review' && <><i className="fas fa-trash"></i> Review planned changes - {units.length} item{units.length !== 1 ? 's' : ''}</>}
            {phase === 'removing' && <><i className="fas fa-trash" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>{progressingLabel}</>}
            {phase === 'done' && <><i className="fas fa-trash" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>{doneLabel}</>}
            {phase === 'error' && 'Error'}
          </h3>
          {phase === 'review' && (
            <HeaderActions
              searchText={table.searchText}
              setSearchText={table.setSearchText}
              onCopy={() => copy(purgeTableTsv(table))}
              copyFeedback={copyFeedback}
              columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={table.toggleCol} />}
            />
          )}
          {phase !== 'removing' && <button className="modal-close" onClick={onClose}>&times;</button>}
        </div>

        <div className={`modal-body${phase === 'review' ? ' fix-confirm-body' : ''}`}>
          {phase === 'review' && (
            <div className="fix-confirmation">
              <div className="fix-confirm-table-wrapper">
                <PurgeUnitsTable table={table} />
              </div>
              <div className="fix-progress-section">
                <p className="fix-confirm-status" style={isDelete ? { color: '#dc3545' } : undefined}>
                  {units.length} item{units.length !== 1 ? 's' : ''}, {table.totalDirs} director{table.totalDirs !== 1 ? 'ies' : 'y'}, ~{formatSize(table.totalSize)}
                  {isDelete ? ' will be moved to the Trash.' : ` will be moved to ${mode.destinationDir}.`}
                </p>
                {typeof slotsToClear === 'number' && (
                  <p className="fix-confirm-status">
                    {slotsToClear} unused sample slot assignment{slotsToClear !== 1 ? 's' : ''} will also be cleared.
                  </p>
                )}
                <div className="fix-done-actions">
                  <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button
                    className={`tools-execute-btn${isDelete ? ' tools-execute-btn-danger' : ''}`}
                    onClick={start}
                  >
                    Apply Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === 'removing' && (
            <div className="fix-pool-progress">
              <div className="fix-search-step running">
                <span className="fix-step-icon"><span className="loading-spinner-small"></span></span>
                <span className="fix-step-label">{progressingLabel}</span>
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="fix-pool-summary">
              <p>
                <i className="fas fa-check" style={{ color: '#2ecc71', marginRight: '0.5rem' }}></i>
                {result.files_removed.length} file{result.files_removed.length !== 1 ? 's' : ''} and {result.dirs_removed.length} director{result.dirs_removed.length !== 1 ? 'ies' : 'y'} removed ({formatSize(result.bytes_reclaimed)} reclaimed).
                {result.slots_cleared > 0 && (
                  <><br />{result.slots_cleared} unused sample slot assignment{result.slots_cleared !== 1 ? 's' : ''} cleared.</>
                )}
              </p>
              {result.errors.length > 0 && (
                <div className="fix-done-failures">
                  <div className="fix-done-failures-label">{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</div>
                  <div className="fix-done-failures-table-wrapper">
                    <table className="fix-done-failures-table">
                      <tbody>
                        {result.errors.map((e, i) => <tr key={i}><td>{e}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="fix-done-actions">
                <button className="tools-execute-btn" onClick={onClose}>Close</button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <>
              <div className="fix-done-error"><p>{errorMsg}</p></div>
              <div className="fix-done-actions">
                <button className="fix-cancel-btn" onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
