import { useState, useEffect, useRef } from 'react'
import { filterProjectName, isCharAllowed, MAX_PROJECT_NAME_LEN } from '../utils/otCharset'
import { CharsetInfoIcon } from './CharsetInfoIcon'
import { Button, Input, Modal, Spinner } from '../design-system'

export interface RenameProjectModalProps {
  projectName: string
  existingNames?: string[]
  onConfirm: (newName: string) => Promise<void> | void
  onCancel: () => void
  title?: string
  duplicateMessage?: string
  buttonLabel?: string
}

export function RenameProjectModal({
  projectName,
  existingNames = [],
  onConfirm,
  onCancel,
  title = 'Rename Project',
  duplicateMessage,
  buttonLabel = 'Rename',
}: RenameProjectModalProps) {
  const [name, setName] = useState(projectName)
  const [shaking, setShaking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const unchanged = name === projectName
  const duplicate = !unchanged && existingNames.includes(name)
  const empty = name.length === 0
  const error = empty ? 'Name is required' : duplicate ? (duplicateMessage ?? `A project named '${name}' already exists`) : null
  const canSubmit = !empty && !unchanged && !duplicate && !submitting

  function triggerShake() {
    setShaking(false)
    requestAnimationFrame(() => setShaking(true))
    setTimeout(() => setShaking(false), 400)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [filtered, wasFiltered] = filterProjectName(e.target.value)
    const wasTruncated = [...e.target.value].filter(ch => isCharAllowed(ch)).length > MAX_PROJECT_NAME_LEN
    if (wasFiltered || wasTruncated) {
      triggerShake()
    }
    setName(filtered)
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onConfirm(name)
    } catch {
      setSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && canSubmit) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      locked={submitting}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
    >
      <Modal.Header>
        <h3><i className="fas fa-edit" style={{ color: 'var(--mo-accent)', marginRight: '0.5rem' }}></i>{title}</h3>
      </Modal.Header>
      <Modal.Body>
        <p>Enter new name for <strong>"{projectName}"</strong>:</p>
        <div className="modal-input-wrapper">
          <Input
            ref={inputRef}
            type="text"
            shaking={shaking}
            value={name}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-label="New project name"
            disabled={submitting}
          />
          <CharsetInfoIcon />
        </div>
        <div className={`modal-char-counter${[...name].length >= MAX_PROJECT_NAME_LEN ? ' at-limit' : ''}`}>{[...name].length} / {MAX_PROJECT_NAME_LEN}</div>
        {error && <div className="modal-error">{error}</div>}
      </Modal.Body>
      <Modal.Footer>
        <div className="modal-buttons-row">
          <Button variant="modal" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="modalPrimary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            title={unchanged ? 'Name is unchanged' : undefined}
          >
            {submitting ? <><Spinner fa style={{ marginRight: '0.4rem' }} />Renaming...</> : buttonLabel}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  )
}
