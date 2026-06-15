import { useState } from "react";
import { formatFileSize } from "./AudioFileTable";
import type { TransferItem } from "../types/transfer";

interface TransferProgressPanelProps {
  transfers: TransferItem[];
  isOpen: boolean;
  onClose: () => void;
  onCancelTransfer: (id: string) => Promise<void>;
  onClearFinished: () => void;
  onClearAll: () => void;
  height?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  className?: string;
}

export function TransferProgressPanel({
  transfers,
  isOpen,
  onClose,
  onCancelTransfer,
  onClearFinished,
  onClearAll,
  height = 200,
  onResizeStart,
  className,
}: TransferProgressPanelProps) {
  const [sortColumn, setSortColumn] = useState<'num' | 'progress' | 'file' | 'size' | 'status'>('num');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  if (!isOpen) return null;

  const activeTransfersCount = transfers.filter(t => t.status === "copying" || t.status === "pending").length;

  function handleSort(column: 'num' | 'progress' | 'file' | 'size' | 'status') {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  const sortedTransfers = [...transfers].map((t, idx) => ({ ...t, originalIndex: idx })).sort((a, b) => {
    let compareA: string | number;
    let compareB: string | number;

    switch (sortColumn) {
      case 'num':
        compareA = a.originalIndex;
        compareB = b.originalIndex;
        break;
      case 'progress':
        compareA = a.status === 'completed' ? 100 : a.fileSize > 0 ? (a.bytesTransferred / a.fileSize) * 100 : 0;
        compareB = b.status === 'completed' ? 100 : b.fileSize > 0 ? (b.bytesTransferred / b.fileSize) * 100 : 0;
        break;
      case 'file':
        compareA = a.fileName.toLowerCase();
        compareB = b.fileName.toLowerCase();
        break;
      case 'size':
        compareA = a.fileSize;
        compareB = b.fileSize;
        break;
      case 'status': {
        const statusOrder = { copying: 0, pending: 1, completed: 2, failed: 3, cancelled: 4 };
        compareA = statusOrder[a.status];
        compareB = statusOrder[b.status];
        break;
      }
      default:
        return 0;
    }

    if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
    if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className={`transfer-queue${className ? ` ${className}` : ''}`} style={{ height: `${height}px` }}>
      {onResizeStart && (
        <div
          className="transfer-resize-handle"
          onMouseDown={onResizeStart}
        />
      )}
      <div className="transfer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3>Transfers</h3>
          {activeTransfersCount > 0 && (
            <span className="transfer-count-badge">{activeTransfersCount} active</span>
          )}
        </div>
        <div className="transfer-controls">
          <button
            className="transfer-button"
            onClick={onClearFinished}
            disabled={transfers.filter(t => t.status === "completed" || t.status === "failed" || t.status === "cancelled").length === 0}
          >
            Clear finished
          </button>
          <button
            className="transfer-button"
            onClick={onClearAll}
            disabled={transfers.length === 0}
          >
            Clear all
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            title="Close"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      </div>
      <div className="transfer-list-container">
        <table className="transfer-list">
          <thead>
            <tr>
              <th className="transfer-col-num sortable" onClick={() => handleSort('num')}>
                # {sortColumn === 'num' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className="transfer-col-progress sortable" onClick={() => handleSort('progress')}>
                Progress {sortColumn === 'progress' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className="transfer-col-file sortable" onClick={() => handleSort('file')}>
                File {sortColumn === 'file' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className="transfer-col-size sortable" onClick={() => handleSort('size')}>
                Size {sortColumn === 'size' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className="transfer-col-status sortable" onClick={() => handleSort('status')}>
                Status {sortColumn === 'status' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className="transfer-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedTransfers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>
                  No transfers
                </td>
              </tr>
            ) : (
              sortedTransfers.map((transfer) => {
                // Compute progress percentage once to ensure bar and text are synchronized
                const progressPercent = transfer.status === 'completed' ? 100 :
                                       transfer.status === 'failed' || transfer.status === 'cancelled' ? 0 :
                                       transfer.progress !== undefined ? Math.min(transfer.progress * 100, 100) :
                                       0;
                return (
                  <tr key={transfer.id} className={`transfer-row transfer-${transfer.status}`}>
                    <td>{transfer.originalIndex + 1}</td>
                    <td>
                      <div className="progress-container">
                        <div
                          className={`progress-bar ${transfer.status === 'completed' ? 'completed' : ''}`}
                          style={{ width: `${progressPercent}%` }}
                        />
                        <span className="progress-text">
                          {transfer.status === 'failed' || transfer.status === 'cancelled' ? '-' : `${Math.round(progressPercent)}%`}
                        </span>
                      </div>
                    </td>
                    <td title={transfer.fileName}>{transfer.fileName}</td>
                    <td>{formatFileSize(transfer.fileSize)}</td>
                    <td>
                      <span
                        className={`status-badge status-${transfer.status}`}
                        title={transfer.error ? (transfer.error.includes('already exists') ? 'File already exists' : transfer.error) : (transfer.stage || '')}
                      >
                        {transfer.status === 'copying' && transfer.stage ? transfer.stage : transfer.status}
                      </span>
                    </td>
                    <td>
                      {(transfer.status === "copying" || transfer.status === "pending") && (
                        <button
                          className="icon-button small"
                          onClick={() => onCancelTransfer(transfer.id)}
                          title="Cancel transfer"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
