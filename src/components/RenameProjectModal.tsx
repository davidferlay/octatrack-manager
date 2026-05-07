import { useState, useEffect, useRef } from 'react'
import { filterProjectName, isCharAllowed, MAX_PROJECT_NAME_LEN } from '../utils/otCharset'
import { CharsetInfoIcon } from './CharsetInfoIcon'

export interface RenameProjectModalProps {
  projectName: string
  existingNames?: string[]
  onConfirm: (newName: string) => void
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const unchanged = name === projectName
  const duplicate = !unchanged && existingNames.includes(name)
  const empty = name.length === 0
  const error = empty ? 'Name is required' : duplicate ? (duplicateMessage ?? `A project named '${name}' already exists`) : null
  const canSubmit = !empty && !unchanged && !duplicate

  function triggerShake() {
    setShaking(false)
    // Force reflow to restart animation
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && canSubmit) {
      e.preventDefault()
      onConfirm(name)
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="fas fa-edit" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>{title}</h3>
        </div>
        <div className="modal-body">
          <p>Enter new name for <strong>"{projectName}"</strong>:</p>
          <div className="modal-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className={`modal-input${shaking ? ' shake' : ''}`}
              value={name}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              aria-label="New project name"
            />
            <CharsetInfoIcon />
          </div>
          <div className={`modal-char-counter${[...name].length >= MAX_PROJECT_NAME_LEN ? ' at-limit' : ''}`}>{[...name].length} / {MAX_PROJECT_NAME_LEN}</div>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="modal-button primary"
              onClick={() => canSubmit && onConfirm(name)}
              disabled={!canSubmit}
              title={unchanged ? 'Name is unchanged' : undefined}
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
