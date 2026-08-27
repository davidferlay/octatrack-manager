import { useEffect } from 'react'

export interface UseModalDismissOptions {
  open: boolean
  onClose: () => void
  closeOnEscape?: boolean
  /** When true, Escape / backdrop handlers must not fire. */
  locked?: boolean
}

/**
 * Document-level Escape dismiss for modals without a `.modal-close` button.
 * Global `main.tsx` handling still clicks `.modal-close` on the top overlay.
 */
export function useModalDismiss({
  open,
  onClose,
  closeOnEscape = true,
  locked = false,
}: UseModalDismissOptions): void {
  useEffect(() => {
    if (!open || !closeOnEscape || locked) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, closeOnEscape, locked, onClose])
}
