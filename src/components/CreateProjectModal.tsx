import { useState, useEffect, useRef } from 'react'
import { filterProjectName, MAX_PROJECT_NAME_LEN } from '../utils/otCharset'
import { CharsetInfoIcon } from './CharsetInfoIcon'

export interface CreateProjectModalProps {
  setPath: string
  setName: string
  existingNames: string[]
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function CreateProjectModal({
  setName,
  existingNames,
  onConfirm,
  onCancel,
}: CreateProjectModalProps) {
  const [name, setName_] = useState('')
  const [shaking, setShaking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const empty = name.length === 0
  const duplicate = !empty && existingNames.includes(name)
  const error = empty ? 'Name is required' : duplicate ? `A project named '${name}' already exists in this Set` : null
  const canSubmit = !empty && !duplicate

  function triggerShake() {
    setShaking(false)
    requestAnimationFrame(() => setShaking(true))
    setTimeout(() => setShaking(false), 400)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [filtered, wasFiltered] = filterProjectName(e.target.value)
    if (wasFiltered) {
      triggerShake()
    }
    setName_(filtered)
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
          <h3><i className="fas fa-plus" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>New Project</h3>
        </div>
        <div className="modal-body">
          <p>Create a new project in <strong>{setName}</strong>:</p>
          <div className="modal-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className={`modal-input${shaking ? ' shake' : ''}`}
              value={name}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Project name"
              aria-label="Project name"
            />
            <CharsetInfoIcon />
          </div>
          <div className={`modal-char-counter${[...name].length >= MAX_PROJECT_NAME_LEN ? ' at-limit' : ''}`}>{[...name].length} / {MAX_PROJECT_NAME_LEN}</div>
          {error && !empty && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onCancel}>
              Cancel
            </button>
            <button className="modal-button primary" onClick={() => canSubmit && onConfirm(name)} disabled={!canSubmit}>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
