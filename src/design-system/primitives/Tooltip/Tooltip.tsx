import type { HTMLAttributes, ReactNode } from 'react'

/**
 * Thin wrapper that preserves native `title` tooltips for visual/behavior parity.
 * Rich overlay tooltips can replace this later without changing call sites.
 */
export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  content: string
  children: ReactNode
}

export function Tooltip({ content, children, className, ...rest }: TooltipProps) {
  return (
    <span className={className} title={content} {...rest}>
      {children}
    </span>
  )
}
