import { useState, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

interface CopyProgressEvent {
  transfer_id: string
  label: string
  progress: number
  stage: string
}

export interface CopyProgressModalProps {
  transferId: string
  label: string
  /** Tauri command name to invoke (e.g. 'copy_project_with_progress' or 'copy_set') */
  command: string
  /** Arguments for the Tauri command (excluding transferId which is added automatically) */
  commandArgs: Record<string, unknown>
  onComplete: (result: string) => void
  onCancel: () => void
  onError: (error: string) => void
}

export function CopyProgressModal({ transferId, label, command, commandArgs, onComplete, onCancel, onError }: CopyProgressModalProps) {
  const [progress, setProgress] = useState(0)
  const [currentLabel, setCurrentLabel] = useState(label)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)

  // Use refs for callbacks to avoid re-registering the listener on every render
  const onCompleteRef = useRef(onComplete)
  const onCancelRef = useRef(onCancel)
  const onErrorRef = useRef(onError)
  onCompleteRef.current = onComplete
  onCancelRef.current = onCancel
  onErrorRef.current = onError

  useEffect(() => {
    let unlistenFn: (() => void) | null = null
    let unmounted = false

    const run = async () => {
      // 1. Register the event listener FIRST
      unlistenFn = await listen<CopyProgressEvent>('copy-progress', (event) => {
        if (event.payload.transfer_id !== transferId) return

        if (event.payload.stage === 'complete') {
          setProgress(1)
        } else if (event.payload.stage === 'cancelled') {
          setCancelled(true)
          onCancelRef.current()
        } else if (event.payload.stage === 'error') {
          setError(event.payload.label)
          onErrorRef.current(event.payload.label)
        } else {
          setProgress(event.payload.progress)
          setCurrentLabel(event.payload.label)
        }
      })

      if (unmounted) {
        unlistenFn()
        return
      }

      // 2. THEN start the copy operation
      try {
        const result = await invoke<string>(command, { ...commandArgs, transferId })
        if (!unmounted) {
          onCompleteRef.current(result)
        }
      } catch (err) {
        if (!unmounted && String(err) !== 'Cancelled') {
          onErrorRef.current(String(err))
        }
      }
    }

    run()

    return () => {
      unmounted = true
      unlistenFn?.()
    }
  }, [transferId, command]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCancel() {
    try {
      await invoke('cancel_copy_operation', { transferId })
    } catch {
      // ignore — operation may have already completed
    }
  }

  const percent = Math.round(progress * 100)

  if (cancelled) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <i className="fas fa-copy" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>
            {error ? 'Copy Failed' : 'Copying...'}
          </h3>
        </div>
        <div className="modal-body">
          <p>{currentLabel}</p>
          {error ? (
            <div className="modal-error">{error}</div>
          ) : (
            <>
              <div className="copy-progress-bar">
                <div className="copy-progress-bar-fill" style={{ width: `${percent}%` }}></div>
              </div>
              <div className="copy-progress-percent">{percent}%</div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            {error ? (
              <button className="modal-button primary" onClick={onCancel}>
                Close
              </button>
            ) : (
              <button className="modal-button" onClick={handleCancel}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
