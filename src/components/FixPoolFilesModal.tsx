import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CompatBadge, getFileFormat } from './AudioFileTable';

export interface IncompatibleFile {
  path: string;
  compatibility: string; // "wrong_rate" | "incompatible" | "unknown"
}

export interface PoolFixOutcome {
  old_path: string;
  new_path: string | null;
  error: string | null;
}

export interface PoolFixResult {
  outcomes: PoolFixOutcome[];
  projects_updated: string[];
  slots_updated: number;
}

export interface CopyProgressEvent {
  file_path: string;
  transfer_id: string;
  stage: string;
  progress: number;
}

const COMPAT_LABELS: Record<string, string> = {
  wrong_rate: 'Wrong sample rate',
  incompatible: 'Incompatible bit depth',
  unsupported_format: 'Unsupported audio format',
  unknown: 'Unrecognized format',
};

/** File name without its directory part. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Directory of `path` relative to the pool root, shown as AUDIO/... */
function poolLocation(path: string, poolPath: string): string {
  const rel = path.startsWith(poolPath) ? path.slice(poolPath.length).replace(/^[/\\]/, '') : path;
  const dir = rel.split(/[\\/]/).slice(0, -1).join('/');
  return dir ? `AUDIO/${dir}` : 'AUDIO/';
}

/** What the fix will do to this file, in user terms. */
function actionLabel(path: string): string {
  const name = baseName(path);
  const stem = name.replace(/\.[^.]+$/, '');
  return name.toLowerCase().endsWith('.wav')
    ? 'Convert in place (44.1 kHz WAV)'
    : `Convert to ${stem}.wav`;
}

/** Shared modal-header search box + copy-table button (fix-missing style). */
function HeaderActions({ searchText, setSearchText, onCopy, copyFeedback }: {
  searchText: string;
  setSearchText: (v: string) => void;
  onCopy: () => void;
  copyFeedback: 'idle' | 'copied';
}) {
  return (
    <div className="missing-samples-header-actions">
      <div className="header-search-container">
        <input
          type="text"
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="header-search-input"
        />
        {searchText && (
          <button className="header-search-clear" onClick={() => setSearchText('')} title="Clear search">×</button>
        )}
      </div>
      <button
        className={`copy-table-btn ${copyFeedback === 'copied' ? 'copied' : ''}`}
        onClick={onCopy}
        title="Copy table to clipboard (for Excel/Google Sheets)"
      >
        {copyFeedback === 'copied' ? '✓' : '⧉'}
      </button>
    </div>
  );
}

function useCopyFeedback(): ['idle' | 'copied', (text: string) => void] {
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');
  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopyFeedback('copied');
        setTimeout(() => setCopyFeedback('idle'), 2000);
      })
      .catch((err) => console.error('Failed to copy to clipboard:', err));
  };
  return [copyFeedback, copy];
}

type SortColumn = 'file' | 'compat' | 'location';

function useFileRows(files: IncompatibleFile[], poolPath: string) {
  const [searchText, setSearchText] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('file');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const rows = files
    .filter(f => !searchText || baseName(f.path).toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => {
      const key = (f: IncompatibleFile) =>
        sortColumn === 'file' ? baseName(f.path).toLowerCase()
          : sortColumn === 'compat' ? (COMPAT_LABELS[f.compatibility] ?? f.compatibility)
            : poolLocation(f.path, poolPath).toLowerCase();
      return key(a) < key(b) ? (sortDirection === 'asc' ? -1 : 1)
        : key(a) > key(b) ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });

  const sortIndicator = (column: SortColumn) =>
    sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

  return { rows, searchText, setSearchText, handleSort, sortIndicator };
}

/**
 * Read-only list of the incompatible pool files found by the Tools tab scan —
 * same look as the project's Missing Samples list modal.
 */
export function PoolIncompatibleListModal({ poolPath, files, onClose }: {
  poolPath: string;
  files: IncompatibleFile[];
  onClose: () => void;
}) {
  const { rows, searchText, setSearchText, handleSort, sortIndicator } = useFileRows(files, poolPath);
  const [copyFeedback, copy] = useCopyFeedback();

  const copyTable = () => {
    const tsv = [
      ['File', 'Format', 'Compatibility', 'Location'].join('\t'),
      ...rows.map(f => [baseName(f.path), getFileFormat(f.path), COMPAT_LABELS[f.compatibility] ?? f.compatibility, poolLocation(f.path, poolPath)].join('\t')),
    ].join('\n');
    copy(tsv);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content missing-samples-list-modal pool-list-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header missing-samples-header">
          <h3><i className="fas fa-list"></i> Incompatible Audio Pool Samples</h3>
          <div className="missing-samples-header-info">
            <span className="missing-samples-header-count">Showing {rows.length} of {files.length} files</span>
          </div>
          <HeaderActions searchText={searchText} setSearchText={setSearchText} onCopy={copyTable} copyFeedback={copyFeedback} />
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {/* Plain wrapper — the page-level .samples-tab class pins itself to viewport
              height, which would leave a tall empty body inside a modal */}
          <div className="table-wrapper">
            <table className="samples-table">
              <thead>
                <tr>
                  <th className="sortable col-sample" onClick={() => handleSort('file')}>File{sortIndicator('file')}</th>
                  <th style={{ width: 90 }}>Format</th>
                  <th className="sortable" style={{ width: 90, textAlign: 'center' }} onClick={() => handleSort('compat')}>Compat{sortIndicator('compat')}</th>
                  <th className="sortable" onClick={() => handleSort('location')}>Location{sortIndicator('location')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(f => (
                  <tr key={f.path}>
                    <td className="col-sample" title={f.path}>{baseName(f.path)}</td>
                    <td>{getFileFormat(f.path)}</td>
                    <td style={{ textAlign: 'center' }}><CompatBadge compatibility={f.compatibility} /></td>
                    <td className="fix-location-cell" title={poolLocation(f.path, poolPath)}>{poolLocation(f.path, poolPath)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** Absolute path of the Set's AUDIO directory. */
  poolPath: string;
  /** Incompatible files to convert. */
  files: IncompatibleFile[];
  /** Skip the review screen and start converting immediately. */
  skipReview?: boolean;
  onClose: () => void;
  /** Called once a fix run finished so callers can refresh their listings. */
  onFixed?: (result: PoolFixResult) => void;
}

type Phase = 'review' | 'converting' | 'done' | 'error';

/**
 * Fix Audio Pool Samples: converts pool files the Octatrack cannot play to
 * 44.1 kHz 16/24-bit WAV in place (originals replaced), then repoints sample-slot
 * references across every project of the Set (each project file is backed up first).
 * Mirrors the Fix Missing Samples review/apply flow.
 */
export function FixPoolFilesModal({ poolPath, files, skipReview = false, onClose, onFixed }: Props) {
  const [phase, setPhase] = useState<Phase>(skipReview ? 'converting' : 'review');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [currentFile, setCurrentFile] = useState<string>('');
  const [fileProgress, setFileProgress] = useState<number>(0);
  const [result, setResult] = useState<PoolFixResult | null>(null);
  const transferIdRef = useRef<string>(`fix-pool-${Date.now()}`);
  const startedRef = useRef(false);

  const { rows, searchText, setSearchText, handleSort, sortIndicator } = useFileRows(files, poolPath);
  const [copyFeedback, copy] = useCopyFeedback();

  const relName = (path: string) =>
    path.startsWith(poolPath) ? path.slice(poolPath.length).replace(/^[/\\]/, '') : path;

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
    invoke<PoolFixResult>('fix_pool_files', {
      poolPath,
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

  const copyTable = () => {
    const tsv = [
      ['File', 'Compatibility', 'Location', 'Action'].join('\t'),
      ...rows.map(f => [baseName(f.path), COMPAT_LABELS[f.compatibility] ?? f.compatibility, poolLocation(f.path, poolPath), actionLabel(f.path)].join('\t')),
    ].join('\n');
    copy(tsv);
  };

  const converting = phase === 'converting';
  const convertingIndex = converting
    ? Math.max(0, files.findIndex(f => f.path === currentFile))
    : 0;
  const failed = result?.outcomes.filter(o => o.error) ?? [];
  const converted = result?.outcomes.filter(o => !o.error) ?? [];

  return (
    <div className="modal-overlay" onClick={phase !== 'converting' ? onClose : undefined}>
      <div className="modal-content fix-missing-modal fix-pool-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`modal-header${phase === 'review' ? ' missing-samples-header' : ''}`}>
          <h3>
            {phase === 'review' && <><i className="fas fa-clipboard-check"></i> Review planned changes</>}
            {phase === 'converting' && <><i className="fas fa-wrench" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Fixing Audio Pool Samples...</>}
            {phase === 'done' && <><i className="fas fa-wrench" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Fix Audio Pool Samples</>}
            {phase === 'error' && 'Error'}
          </h3>
          {phase === 'review' && (
            <>
              <div className="missing-samples-header-info">
                <span className="fix-confirm-status">
                  <strong>{files.length}</strong> incompatible audio file{files.length === 1 ? '' : 's'}
                  {rows.length !== files.length && <span style={{ color: 'var(--elektron-text-secondary)', fontWeight: 400 }}> — showing {rows.length}</span>}
                </span>
              </div>
              <HeaderActions searchText={searchText} setSearchText={setSearchText} onCopy={copyTable} copyFeedback={copyFeedback} />
            </>
          )}
          {!converting && <button className="modal-close" onClick={onClose}>×</button>}
        </div>
        <div className="modal-body">
          {phase === 'review' && (
            <div className="fix-confirmation">
              <div className="fix-confirm-table-wrapper">
                <table className="samples-table">
                  <thead>
                    <tr>
                      <th className="sortable col-sample" onClick={() => handleSort('file')}>File{sortIndicator('file')}</th>
                      <th className="sortable" style={{ width: 90, textAlign: 'center' }} onClick={() => handleSort('compat')}>Compat{sortIndicator('compat')}</th>
                      <th className="sortable" onClick={() => handleSort('location')}>Location{sortIndicator('location')}</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(f => (
                      <tr key={f.path}>
                        <td className="col-sample" title={f.path}>{baseName(f.path)}</td>
                        <td style={{ textAlign: 'center' }}><CompatBadge compatibility={f.compatibility} /></td>
                        <td className="fix-location-cell" title={poolLocation(f.path, poolPath)}>{poolLocation(f.path, poolPath)}</td>
                        <td title="The original file is replaced; sample slots referencing it are updated in every project of this Set (after a backup)">{actionLabel(f.path)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="fix-confirm-actions">
                <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                <div style={{ flex: 1 }} />
                <button className="tools-execute-btn" onClick={() => setPhase('converting')}>
                  Apply Changes
                </button>
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
                      <li key={f.old_path} title={f.old_path}>{relName(f.old_path)} — {f.error}</li>
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
