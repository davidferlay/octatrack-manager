import { useEffect, useRef } from 'react'

/**
 * Ctrl/Cmd+F focuses a search input; Escape clears it, then blurs.
 *
 * The preventDefault on Ctrl+F is load-bearing rather than cosmetic: WebKitGTK and
 * WebView2 both bind Ctrl+F to a native find bar that would otherwise open over the app.
 *
 * Escape only acts while `inputRef` holds focus, so the page-level Escape handlers
 * (deselect on the Home page, leave-project on ProjectDetail) keep working. Those
 * handlers already bail when an INPUT is focused, so nothing double-fires.
 */
export function useSearchShortcut(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onClear: () => void,
): void {
  // Held in a ref so callers do not have to memoise onClear to avoid resubscribing.
  const onClearRef = useRef(onClear)
  onClearRef.current = onClear

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current
      if (!input) return

      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        input.focus()
        input.select()
        return
      }

      if (e.key === 'Escape' && document.activeElement === input) {
        if (input.value) onClearRef.current()
        else input.blur()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inputRef])
}
