import { useState, useEffect } from "react";

export interface OverwriteModalProps {
  isOpen: boolean;
  fileName: string;
  remainingFiles: string[];
  onOverwrite: () => void;
  onOverwriteAll: () => void;
  onSkip: () => void;
  onSkipAll: () => void;
  onCancel: () => void;
}

export function OverwriteModal({ isOpen, fileName, remainingFiles, onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel }: OverwriteModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const hasMultipleRemaining = remainingFiles.length > 1;

  // Reset selection when modal opens/closes or when switching between single/multiple mode
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen, hasMultipleRemaining]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (hasMultipleRemaining) {
        // 5 buttons in grid: [Overwrite, Overwrite All], [Skip, Skip All], [Cancel]
        // Indices: 0=Overwrite, 1=Overwrite All, 2=Skip, 3=Skip All, 4=Cancel
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            if (selectedIndex === 4) setSelectedIndex(2);
            else if (selectedIndex === 2 || selectedIndex === 3) setSelectedIndex(selectedIndex - 2);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (selectedIndex === 0 || selectedIndex === 1) setSelectedIndex(selectedIndex + 2);
            else if (selectedIndex === 2 || selectedIndex === 3) setSelectedIndex(4);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (selectedIndex === 1) setSelectedIndex(0);
            else if (selectedIndex === 3) setSelectedIndex(2);
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (selectedIndex === 0) setSelectedIndex(1);
            else if (selectedIndex === 2) setSelectedIndex(3);
            break;
          case 'Enter':
            e.preventDefault();
            [onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel][selectedIndex]();
            break;
          case 'Escape':
            e.preventDefault();
            onCancel();
            break;
        }
      } else {
        // 3 buttons: [Overwrite, Skip], [Cancel]
        // Indices: 0=Overwrite, 1=Skip, 2=Cancel
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            if (selectedIndex === 2) setSelectedIndex(0);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (selectedIndex === 0 || selectedIndex === 1) setSelectedIndex(2);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (selectedIndex === 1) setSelectedIndex(0);
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (selectedIndex === 0) setSelectedIndex(1);
            break;
          case 'Enter':
            e.preventDefault();
            [onOverwrite, onSkip, onCancel][selectedIndex]();
            break;
          case 'Escape':
            e.preventDefault();
            onCancel();
            break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, hasMultipleRemaining, onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3><i className="fas fa-exclamation-triangle" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>File{hasMultipleRemaining ? 's' : ''} Already Exist{hasMultipleRemaining ? '' : 's'}</h3>
        </div>
        <div className="modal-body">
          {hasMultipleRemaining ? (
            <>
              <p>The following <strong>{remainingFiles.length} files</strong> already exist in the destination folder:</p>
              <ul style={{ maxHeight: '150px', overflowY: 'auto', margin: '0.5rem 0', paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--elektron-text-secondary)' }}>
                {remainingFiles.slice(0, 15).map((path, idx) => {
                  const name = path.split('/').pop() || path.split('\\').pop() || path;
                  return <li key={idx}>{name}</li>;
                })}
                {remainingFiles.length > 15 && <li style={{ fontStyle: 'italic' }}>...and {remainingFiles.length - 15} more</li>}
              </ul>
            </>
          ) : (
            <p>The file <strong>"{fileName}"</strong> already exists in the destination folder.</p>
          )}
          <p>What would you like to do?</p>
        </div>
        <div className="modal-footer">
          {hasMultipleRemaining ? (
            <>
              <div className="modal-buttons-row">
                <button className={`modal-button primary ${selectedIndex === 0 ? 'focused' : ''}`} onClick={onOverwrite}>
                  Overwrite
                </button>
                <button className={`modal-button ${selectedIndex === 1 ? 'focused' : ''}`} onClick={onOverwriteAll}>
                  Overwrite All ({remainingFiles.length})
                </button>
              </div>
              <div className="modal-buttons-row">
                <button className={`modal-button ${selectedIndex === 2 ? 'focused' : ''}`} onClick={onSkip}>
                  Skip
                </button>
                <button className={`modal-button ${selectedIndex === 3 ? 'focused' : ''}`} onClick={onSkipAll}>
                  Skip All ({remainingFiles.length})
                </button>
              </div>
              <div className="modal-buttons-row">
                <button className={`modal-button danger ${selectedIndex === 4 ? 'focused' : ''}`} onClick={onCancel}>
                  Cancel Import
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-buttons-row">
                <button className={`modal-button primary ${selectedIndex === 0 ? 'focused' : ''}`} onClick={onOverwrite}>
                  Overwrite
                </button>
                <button className={`modal-button ${selectedIndex === 1 ? 'focused' : ''}`} onClick={onSkip}>
                  Skip
                </button>
              </div>
              <div className="modal-buttons-row">
                <button className={`modal-button danger ${selectedIndex === 2 ? 'focused' : ''}`} onClick={onCancel}>
                  Cancel Import
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
