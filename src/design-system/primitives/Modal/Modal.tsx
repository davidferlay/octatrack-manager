import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useModalDismiss } from './useModalDismiss'

interface ModalContextValue {
  onClose: () => void
  locked: boolean
  showCloseButton: boolean
}

const ModalContext = createContext<ModalContextValue | null>(null)
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useModalFocusTrap(open: boolean, locked: boolean, dialogRef: React.RefObject<HTMLDivElement | null>) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const dialog = dialogRef.current
    if (dialog === null) return

    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    const first = focusables[0]
    first?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || dialogRef.current === null) return
      const items = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open, locked, dialogRef])
}

function useModalContext(component: string): ModalContextValue {
  const ctx = useContext(ModalContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <Modal>`)
  }
  return ctx
}

export interface ModalProps {
  open?: boolean
  onClose: () => void
  children: ReactNode
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
  /** Disables Escape and backdrop dismiss (e.g. while submitting). */
  locked?: boolean
  showCloseButton?: boolean
  contentClassName?: string
  overlayClassName?: string
  /** When false, skip the shared Escape listener (caller handles keys). */
  manageEscape?: boolean
}

function ModalRoot({
  open = true,
  onClose,
  children,
  closeOnEscape = true,
  closeOnBackdrop = true,
  locked = false,
  showCloseButton = false,
  contentClassName,
  overlayClassName,
  manageEscape = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDismiss({
    open: open && manageEscape,
    onClose,
    closeOnEscape,
    locked,
  })
  useModalFocusTrap(open, locked, dialogRef)

  if (!open) return null

  function handleOverlayClick() {
    if (locked || !closeOnBackdrop) return
    onClose()
  }

  function handleContentClick(e: MouseEvent) {
    e.stopPropagation()
  }

  const overlayClass = ['modal-overlay', overlayClassName]
    .filter(Boolean)
    .join(' ')
  const contentClass = ['modal-content', contentClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <ModalContext.Provider value={{ onClose, locked, showCloseButton }}>
      <div
        className={overlayClass}
        onClick={handleOverlayClick}
        role="presentation"
      >
        <div
          ref={dialogRef}
          className={contentClass}
          onClick={handleContentClick}
          role="dialog"
          aria-modal="true"
        >
          {children}
        </div>
      </div>
    </ModalContext.Provider>
  )
}

export interface ModalHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function ModalHeader({ children, className, ...rest }: ModalHeaderProps) {
  const { onClose, locked, showCloseButton } = useModalContext('Modal.Header')
  const merged = ['modal-header', className].filter(Boolean).join(' ')
  return (
    <div className={merged} {...rest}>
      {children}
      {showCloseButton && (
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          disabled={locked}
          aria-label="Close"
        >
          ×
        </button>
      )}
    </div>
  )
}

export interface ModalBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function ModalBody({ children, className, ...rest }: ModalBodyProps) {
  const merged = ['modal-body', className].filter(Boolean).join(' ')
  return (
    <div className={merged} {...rest}>
      {children}
    </div>
  )
}

export interface ModalFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function ModalFooter({ children, className, ...rest }: ModalFooterProps) {
  const merged = ['modal-footer', className].filter(Boolean).join(' ')
  return (
    <div className={merged} {...rest}>
      {children}
    </div>
  )
}

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
})
