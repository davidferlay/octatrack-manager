import { useEffect, useRef } from 'react'
import type { ContextTarget, ClipboardState } from '../types/projectManagement'

export interface ProjectContextMenuProps {
  x: number
  y: number
  target: ContextTarget
  clipboard: ClipboardState | null
  onCopy: () => void
  onRename: () => void
  onDelete: () => void
  onOpenInFileManager: () => void
  onPaste: () => void
  onCreateNew: () => void
  onClose: () => void
}

export function ProjectContextMenu(props: ProjectContextMenuProps) {
  const { x, y, target, clipboard, onClose } = props
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [onClose])

  function fire(handler: () => void) {
    return () => {
      handler()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ position: 'fixed', left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {target.kind === 'project' && (
        <>
          <button className="context-menu-item" onClick={fire(props.onCopy)}>
            <i className="fas fa-copy"></i> Copy
          </button>
          <button className="context-menu-item" onClick={fire(props.onRename)}>
            <i className="fas fa-edit"></i> Rename
          </button>
          <div className="context-menu-separator"></div>
          <button className="context-menu-item" onClick={fire(props.onOpenInFileManager)}>
            <i className="fas fa-folder-open"></i> Open in File Manager
          </button>
          <div className="context-menu-separator"></div>
          <button className="context-menu-item danger" onClick={fire(props.onDelete)}>
            <i className="fas fa-trash"></i> Delete
          </button>
        </>
      )}
      {target.kind === 'set' && (
        <>
          <button className="context-menu-item" onClick={fire(props.onCreateNew)}>
            <i className="fas fa-plus"></i> New Project
          </button>
          {clipboard && (
            <>
              <div className="context-menu-separator"></div>
              <button className="context-menu-item" onClick={fire(props.onPaste)}>
                <i className="fas fa-paste"></i> Paste Project
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
