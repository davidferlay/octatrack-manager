import { useState } from "react";

/**
 * Rename prompt for a single file or folder, shared by the Audio Pool page and
 * the Sample Slots audio pool pane. Owns nothing but the edited name: the
 * caller decides what renaming actually means (plain rename vs. rename plus
 * repointing every project that references the file).
 */
export function RenameFileModal({ name, onCancel, onConfirm }: {
  name: string;
  onCancel: () => void;
  onConfirm: (newName: string) => void;
}) {
  const [newName, setNewName] = useState(name);
  const trimmed = newName.trim();
  const submit = () => { if (trimmed) onConfirm(trimmed); };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="fas fa-edit" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Rename</h3>
        </div>
        <div className="modal-body">
          <p>Enter new name for <strong>"{name}"</strong>:</p>
          <input
            type="text"
            className="modal-input"
            aria-label="New name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
            autoFocus
          />
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onCancel}>Cancel</button>
            <button className="modal-button primary" onClick={submit} disabled={!trimmed}>
              Rename
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
