import { useEffect, useRef } from 'react'

export interface DeleteProjectDialogProps {
  projectName: string
  setName: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteProjectDialog({
  projectName,
  setName,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="fas fa-trash" style={{ color: '#dc3545', marginRight: '0.5rem' }}></i>Delete Project</h3>
        </div>
        <div className="modal-body">
          <p>
            Are you sure you want to delete <strong>"{projectName}"</strong> from{' '}
            <strong>{setName}</strong>?
          </p>
          <p style={{ color: '#dc3545' }}>This action cannot be undone.</p>
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button ref={cancelRef} className="modal-button" onClick={onCancel}>
              Cancel
            </button>
            <button className="modal-button danger" onClick={onConfirm}>
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
