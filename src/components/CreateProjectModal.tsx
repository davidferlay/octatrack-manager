import { useState, useEffect, useRef, type ReactNode } from 'react'
import { filterProjectName, isCharAllowed, MAX_PROJECT_NAME_LEN } from '../utils/otCharset'
import { CharsetInfoIcon } from './CharsetInfoIcon'

export interface CreateProjectModalProps {
  setPath: string
  setName: string
  existingNames: string[]
  onConfirm: (name: string) => Promise<void> | void
  onCancel: () => void
  title?: string
  prompt?: ReactNode
  placeholder?: string
  duplicateMessage?: string
  buttonLabel?: string
}

export function CreateProjectModal({
  setName,
  existingNames,
  onConfirm,
  onCancel,
  title = 'New Project',
  prompt: promptText,
  placeholder = 'Project name',
  duplicateMessage,
  buttonLabel = 'Create',
}: CreateProjectModalProps) {
  const [name, setName_] = useState('')
  const [shaking, setShaking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shakeFrame = useRef<number | null>(null)

  useEffect(() => () => {
    if (shakeTimer.current !== null) clearTimeout(shakeTimer.current)
    if (shakeFrame.current !== null) cancelAnimationFrame(shakeFrame.current)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const empty = name.length === 0
  const duplicate = !empty && existingNames.includes(name)
  const error = empty ? 'Name is required' : duplicate ? (duplicateMessage ?? `A project named '${name}' already exists in this Set`) : null
  const canSubmit = !empty && !duplicate && !submitting

  /**
   * Flashes the shake animation. Both the frame request and the timer are held so
   * they can be cancelled: the modal can be closed inside the 400ms the shake lasts,
   * and a callback arriving after that would set state on a gone component.
   */
  function triggerShake() {
    setShaking(false)
    if (shakeFrame.current !== null) cancelAnimationFrame(shakeFrame.current)
    if (shakeTimer.current !== null) clearTimeout(shakeTimer.current)
    shakeFrame.current = requestAnimationFrame(() => {
      shakeFrame.current = null
      setShaking(true)
    })
    shakeTimer.current = setTimeout(() => {
      shakeTimer.current = null
      setShaking(false)
    }, 400)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [filtered, wasFiltered] = filterProjectName(e.target.value)
    const wasTruncated = [...e.target.value].filter(ch => isCharAllowed(ch)).length > MAX_PROJECT_NAME_LEN
    if (wasFiltered || wasTruncated) {
      triggerShake()
    }
    setName_(filtered)
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
      onCancel()
    } else if (e.key === 'Enter' && canSubmit) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="fas fa-plus" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>{title}</h3>
        </div>
        <div className="modal-body">
          <p>{promptText ?? <>Create a new project in <strong>{setName}</strong>:</>}</p>
          <div className="modal-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className={`modal-input${shaking ? ' shake' : ''}`}
              value={name}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label={placeholder}
              disabled={submitting}
            />
            <CharsetInfoIcon />
          </div>
          <div className={`modal-char-counter${[...name].length >= MAX_PROJECT_NAME_LEN ? ' at-limit' : ''}`}>{[...name].length} / {MAX_PROJECT_NAME_LEN}</div>
          {error && !empty && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button className="modal-button primary" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? <><i className="fas fa-spinner fa-spin" style={{ marginRight: '0.4rem' }}></i>Creating...</> : buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
