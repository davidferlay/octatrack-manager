import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import './SplitPane.css'

interface SplitPaneContextValue {
  primarySize: number
  primaryVisible: boolean
  startResize: (e: ReactMouseEvent) => void
}

const SplitPaneContext = createContext<SplitPaneContextValue | null>(null)

function useSplitPaneContext(component: string): SplitPaneContextValue {
  const ctx = useContext(SplitPaneContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <SplitPane>`)
  }
  return ctx
}

export interface SplitPaneProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Primary pane width as percent of the container. */
  primarySize?: number
  defaultPrimarySize?: number
  onPrimarySizeChange?: (percent: number) => void
  minPrimary?: number
  maxPrimary?: number
  /** When false, primary pane and divider are hidden. */
  primaryVisible?: boolean
}

function SplitPaneRoot({
  children,
  className,
  primarySize: controlledSize,
  defaultPrimarySize = 50,
  onPrimarySizeChange,
  minPrimary = 20,
  maxPrimary = 80,
  primaryVisible = true,
  ...rest
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [uncontrolledSize, setUncontrolledSize] = useState(defaultPrimarySize)
  const [isResizing, setIsResizing] = useState(false)
  const primarySize = controlledSize ?? uncontrolledSize

  const setPrimarySize = useCallback(
    (percent: number) => {
      const clamped = Math.max(minPrimary, Math.min(maxPrimary, percent))
      if (controlledSize === undefined) {
        setUncontrolledSize(clamped)
      }
      onPrimarySizeChange?.(clamped)
    },
    [controlledSize, maxPrimary, minPrimary, onPrimarySizeChange],
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const percent = ((e.clientX - rect.left) / rect.width) * 100
      setPrimarySize(percent)
    }

    const handleMouseUp = () => setIsResizing(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setPrimarySize])

  const startResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const merged = ['mo-split-pane', className].filter(Boolean).join(' ')

  return (
    <SplitPaneContext.Provider
      value={{ primarySize, primaryVisible, startResize }}
    >
      <div ref={containerRef} className={merged} {...rest}>
        {children}
      </div>
    </SplitPaneContext.Provider>
  )
}

export interface SplitPanePrimaryProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function SplitPanePrimary({
  children,
  className,
  style,
  ...rest
}: SplitPanePrimaryProps) {
  const { primarySize, primaryVisible } = useSplitPaneContext('SplitPane.Primary')
  if (!primaryVisible) return null
  const merged = ['mo-split-pane__primary', className].filter(Boolean).join(' ')
  return (
    <div
      className={merged}
      style={{ width: `${primarySize}%`, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}

export type SplitPaneDividerProps = HTMLAttributes<HTMLDivElement>

function SplitPaneDivider({
  className,
  onMouseDown,
  ...rest
}: SplitPaneDividerProps) {
  const { primaryVisible, startResize } = useSplitPaneContext('SplitPane.Divider')
  if (!primaryVisible) return null
  const merged = ['mo-split-pane__divider', 'panel-divider', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={merged}
      onMouseDown={(e) => {
        startResize(e)
        onMouseDown?.(e)
      }}
      {...rest}
    />
  )
}

export interface SplitPaneSecondaryProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function SplitPaneSecondary({
  children,
  className,
  ...rest
}: SplitPaneSecondaryProps) {
  useSplitPaneContext('SplitPane.Secondary')
  const merged = ['mo-split-pane__secondary', className].filter(Boolean).join(' ')
  return (
    <div className={merged} {...rest}>
      {children}
    </div>
  )
}

/**
 * Horizontal split layout with a draggable divider.
 * Domain content (DnD, tables, preview) stays in the consumer.
 */
export const SplitPane = Object.assign(SplitPaneRoot, {
  Primary: SplitPanePrimary,
  Divider: SplitPaneDivider,
  Secondary: SplitPaneSecondary,
})
