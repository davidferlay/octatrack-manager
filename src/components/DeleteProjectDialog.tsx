import { useState, useEffect, useRef, type ReactNode } from 'react'

export interface DeleteProjectDialogProps {
  projectName: string
  setName: string
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  title?: string
  message?: ReactNode
}

export function DeleteProjectDialog({
  projectName,
  setName,
  onConfirm,
  onCancel,
  title = 'Delete Project',
  message,
}: DeleteProjectDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [deleting, setDeleting] = useState(false)

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

  async function handleConfirm() {
    if (deleting) return
    setDeleting(true)
    try {
      await onConfirm()
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={deleting ? undefined : onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="fas fa-trash" style={{ color: '#dc3545', marginRight: '0.5rem' }}></i>{title}</h3>
        </div>
        <div className="modal-body">
          {deleting ? (
            <p style={{ textAlign: 'center' }}>
              <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.5rem' }}></i>
              Deleting...
            </p>
          ) : (
            <>
              <p>
                {message ?? <>Are you sure you want to delete <strong>"{projectName}"</strong> from{' '}
                <strong>{setName}</strong>?</>}
              </p>
              <p style={{ color: '#dc3545', textAlign: 'center' }}>This action cannot be undone.</p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button ref={cancelRef} className="modal-button" onClick={onCancel} disabled={deleting}>
              Cancel
            </button>
            <button className="modal-button danger" onClick={handleConfirm} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
