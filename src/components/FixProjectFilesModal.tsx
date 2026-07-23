import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ColumnToggle,
  FilterBadges,
  HeaderActions,
  PoolFilesTable,
  poolTableTsv,
  useCopyFeedback,
  useModalResize,
  usePoolTable,
  type CopyProgressEvent,
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
export function ProjectIncompatibleListModal({ projectPath, files, onClose, usageMap }: {
  projectPath: string;
  files: IncompatibleFile[];
  onClose: () => void;
  usageMap?: Record<string, PoolUsageEntry[]>;
}) {
  const table = usePoolTable(files, projectPath, false, ['size'], usageMap, false, true);
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
}

type Phase = 'review' | 'converting' | 'done' | 'error';

/**
 * Fix Project Samples: converts a project's incompatible referenced-slot and
 * unreferenced-directory files to 44.1 kHz 16/24-bit WAV in place (originals
 * replaced), then repoints sample-slot references across every project of
 * the Set (each project file is backed up first). Structurally identical to
 * FixPoolFilesModal, scoped to a project path and fix_project_samples.
 */
export function FixProjectFilesModal({ projectPath, files, skipReview = false, onClose, onFixed, usageMap }: Props) {
  const [phase, setPhase] = useState<Phase>(skipReview ? 'converting' : 'review');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [currentFile, setCurrentFile] = useState<string>('');
  const [fileProgress, setFileProgress] = useState<number>(0);
  const [result, setResult] = useState<PoolFixResult | null>(null);
  const transferIdRef = useRef<string>(`fix-project-${Date.now()}`);
  const startedRef = useRef(false);

  // Location and Size are hidden by default here - the Action column matters most for review
  const table = usePoolTable(files, projectPath, true, ['location', 'size'], usageMap, false, true);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();

  const relName = (path: string) =>
    path.startsWith(projectPath) ? path.slice(projectPath.length).replace(/^[/\\]/, '') : path;

  // Per-file conversion progress
  useEffect(() => {
    if (phase !== 'converting') return;
    let unlisten: (() => void) | undefined;
    listen<CopyProgressEvent>('copy-progress', (event) => {
      if (event.payload.transfer_id !== transferIdRef.current) return;
      setCurrentFile(event.payload.file_path);
      setFileProgress(event.payload.progress);
    }).then(fn => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [phase]);

  // Run the fix whenever the converting phase is entered (Apply Changes, or
  // immediately on mount when the review step is skipped)
  useEffect(() => {
    if (phase !== 'converting' || startedRef.current) return;
    startedRef.current = true;
    setCurrentFile(files[0]?.path ?? '');
    setFileProgress(0);
    invoke<PoolFixResult>('fix_project_samples', {
      projectPath,
      filePaths: files.map(f => f.path),
      transferId: transferIdRef.current,
    })
      .then(res => {
        setResult(res);
        setPhase('done');
        onFixed?.(res);
      })
      .catch(e => {
        setErrorMsg(String(e));
        setPhase('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleCancelConvert() {
    invoke('cancel_audio_transfer', { transferId: transferIdRef.current }).catch(() => {});
  }

  const converting = phase === 'converting';
  const convertingIndex = converting
    ? Math.max(0, files.findIndex(f => f.path === currentFile))
    : 0;
  const failed = result?.outcomes.filter(o => o.error) ?? [];
  const converted = result?.outcomes.filter(o => !o.error) ?? [];

  return (
    <div className="modal-overlay" onClick={phase !== 'converting' ? onClose : undefined}>
      <div
        ref={modalRef}
        className="modal-content fix-missing-modal fix-pool-modal"
        onClick={(e) => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className={`modal-header${phase === 'review' ? ' missing-samples-header' : ''}`}>
          <h3>
            {phase === 'review' && <><i className="fas fa-clipboard-check"></i> Review planned changes - {files.length} incompatible audio file{files.length === 1 ? '' : 's'}</>}
            {phase === 'converting' && <><i className="fas fa-wrench" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Fixing Project Samples...</>}
            {phase === 'done' && <><i className="fas fa-wrench" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Fix Project Samples</>}
            {phase === 'error' && 'Error'}
          </h3>
          {phase === 'review' && (
            <>
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
            </>
          )}
          {!converting && <button className="modal-close" onClick={onClose}>×</button>}
        </div>
        <div className={`modal-body${phase === 'review' ? ' fix-confirm-body' : ''}`}>
          {phase === 'review' && (
            <div className="fix-confirmation">
              <div className="fix-confirm-table-wrapper">
                <PoolFilesTable table={table} />
              </div>
              <div className="fix-progress-section">
                <div className="fix-done-actions">
                  <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button className="tools-execute-btn" onClick={() => setPhase('converting')}>
                    Apply Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {converting && (
            <div className="fix-pool-progress">
              <p>
                Converting {convertingIndex + 1} / {files.length}:{' '}
                <span className="fix-pool-current-file" title={currentFile}>{relName(currentFile)}</span>
              </p>
              <div className="copy-progress-bar">
                <div className="copy-progress-bar-fill" style={{ width: `${Math.round(fileProgress * 100)}%` }}></div>
              </div>
              <div className="fix-done-actions">
                <button className="fix-cancel-btn" onClick={handleCancelConvert}>Cancel</button>
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="fix-pool-summary">
              <p>
                <i className="fas fa-check" style={{ color: '#2ecc71', marginRight: '0.5rem' }}></i>
                {converted.length} file{converted.length === 1 ? '' : 's'} converted.
                {result.slots_updated > 0 && (
                  <> {result.slots_updated} sample slot{result.slots_updated === 1 ? '' : 's'} updated
                    {' '}across {result.projects_updated.length} project{result.projects_updated.length === 1 ? '' : 's'} (backed up first).</>
                )}
              </p>
              {failed.length > 0 && (
                <div className="fix-done-error">
                  <p>{failed.length} file{failed.length === 1 ? '' : 's'} could not be converted:</p>
                  <ul>
                    {failed.map(f => (
                      <li key={f.old_path} title={f.old_path}>{relName(f.old_path)} - {f.error}</li>
                    ))}
                  </ul>
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
