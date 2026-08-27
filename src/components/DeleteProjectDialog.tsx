import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Button, Modal, Spinner } from '../design-system'

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
  }, [])

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
    <Modal
      open
      onClose={onCancel}
      locked={deleting}
      closeOnBackdrop={!deleting}
      closeOnEscape={!deleting}
    >
      <Modal.Header>
        <h3><i className="fas fa-trash" style={{ color: 'var(--mo-danger)', marginRight: '0.5rem' }}></i>{title}</h3>
      </Modal.Header>
      <Modal.Body>
        {deleting ? (
          <p style={{ textAlign: 'center' }}>
            <Spinner fa style={{ marginRight: '0.5rem' }} />
            Deleting...
          </p>
        ) : (
          <>
            <p>
              {message ?? <>Are you sure you want to delete <strong>"{projectName}"</strong> from{' '}
              <strong>{setName}</strong>?</>}
            </p>
            <p style={{ color: 'var(--mo-danger)', textAlign: 'center' }}>This action cannot be undone.</p>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <div className="modal-buttons-row">
          <Button ref={cancelRef} variant="modal" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  )
}
