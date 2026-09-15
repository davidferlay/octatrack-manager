import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useModalDismiss } from '../Modal/useModalDismiss'
import './Drawer.css'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useDrawerFocusTrap(
  open: boolean,
  panelRef: React.RefObject<HTMLDivElement | null>,
  returnFocusRef: React.RefObject<HTMLElement | null> | undefined,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const panel = panelRef.current
    if (panel === null) return

    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    const closeButton = panel.querySelector<HTMLElement>('.mo-drawer-close')
    const first = closeButton ?? focusables[0]
    first?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || panelRef.current === null) return
      const items = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
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
      const returnTarget = returnFocusRef?.current ?? previousFocusRef.current
      returnTarget?.focus()
    }
  }, [open, panelRef, returnFocusRef])
}

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: ReactNode
  closeAriaLabel: string
  /** When set, focus returns here after close instead of the pre-open active element. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
  panelClassName?: string
  bodyClassName?: string
  overlayClassName?: string
}

export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  children,
  closeAriaLabel,
  returnFocusRef,
  panelClassName,
  bodyClassName,
  overlayClassName,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalDismiss({ open, onClose, closeOnEscape: true, locked: false })

  useDrawerFocusTrap(open, panelRef, returnFocusRef)

  function handleOverlayClick() {
    onClose()
  }

  function handlePanelClick(event: MouseEvent) {
    event.stopPropagation()
  }

  const overlayClass = ['mo-drawer-overlay', overlayClassName].filter(Boolean).join(' ')
  const panelClass = [
    'mo-drawer-panel',
    open ? 'mo-drawer-panel--open' : 'mo-drawer-panel--stored',
    panelClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const bodyClass = ['mo-drawer-panel__body', bodyClassName].filter(Boolean).join(' ')

  return (
    <>
      {open && (
        <div className={overlayClass} onClick={handleOverlayClick} role="presentation" />
      )}
      <div
        ref={panelRef}
        className={panelClass}
        onClick={handlePanelClick}
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        inert={open ? undefined : true}
        aria-labelledby="mo-drawer-title"
        hidden={!open ? true : undefined}
      >
        <header className="mo-drawer-panel__header">
          <div className="mo-drawer-panel__title-block">
            {eyebrow != null && eyebrow !== '' && (
              <p className="mo-drawer-panel__eyebrow">{eyebrow}</p>
            )}
            <h2 id="mo-drawer-title" className="mo-drawer-panel__title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="mo-drawer-close"
            onClick={onClose}
            aria-label={closeAriaLabel}
          >
            ×
          </button>
        </header>
        <div className={bodyClass}>{children}</div>
      </div>
    </>
  )
}

export interface DrawerSectionProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
}

export function DrawerSection({ children, className, ...rest }: DrawerSectionProps) {
  const merged = ['mo-drawer-section', className].filter(Boolean).join(' ')
  return (
    <section className={merged} {...rest}>
      {children}
    </section>
  )
}
