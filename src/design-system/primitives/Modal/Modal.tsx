import {
  createContext,
  useContext,
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
  useModalDismiss({
    open: open && manageEscape,
    onClose,
    closeOnEscape,
    locked,
  })

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
