import type { HTMLAttributes } from 'react'

export type SpinnerSize = 'default' | 'small'

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize
  /** When true, uses Font Awesome spin glyph (modal submit affordance). */
  fa?: boolean
  label?: string
}

export function Spinner({
  size = 'default',
  fa = false,
  label,
  className,
  ...rest
}: SpinnerProps) {
  if (fa) {
    const merged = ['fas', 'fa-spinner', 'fa-spin', className]
      .filter(Boolean)
      .join(' ')
    return (
      <i
        className={merged}
        aria-hidden={label ? undefined : true}
        aria-label={label}
        {...(rest as HTMLAttributes<HTMLElement>)}
      />
    )
  }

  const sizeClass =
    size === 'small' ? 'loading-spinner-small' : 'loading-spinner'
  const merged = [sizeClass, className].filter(Boolean).join(' ')
  return (
    <span
      className={merged}
      role="status"
      aria-label={label ?? 'Loading'}
      {...rest}
    />
  )
}
