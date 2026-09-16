const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isHiddenByAncestors(element: HTMLElement, boundary: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node !== null && node !== boundary) {
    if (node.hasAttribute('hidden')) return true
    if (node.getAttribute('aria-hidden') === 'true') return true
    if (node.hasAttribute('inert')) return true
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    node = node.parentElement
  }
  return false
}

/** Focusable elements that participate in keyboard navigation within `root`. */
export function queryTabFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled')
      && element.tabIndex !== -1
      && !isHiddenByAncestors(element, root),
  )
}

export { FOCUSABLE_SELECTOR }
