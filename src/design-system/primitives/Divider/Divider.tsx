import type { HTMLAttributes } from 'react'

export type DividerVariant = 'toolbar' | 'plain'

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  variant?: DividerVariant
}

export function Divider({
  variant = 'toolbar',
  className,
  ...rest
}: DividerProps) {
  const base = variant === 'toolbar' ? 'toolbar-separator' : undefined
  const merged = [base, className].filter(Boolean).join(' ')
  return (
    <div
      role="separator"
      className={merged || undefined}
      {...rest}
    />
  )
}
