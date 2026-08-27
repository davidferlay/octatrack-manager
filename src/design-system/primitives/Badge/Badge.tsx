import type { HTMLAttributes, ReactNode } from 'react'

export type BadgeTone = 'default' | 'success' | 'error'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  children?: ReactNode
}

const TONE_CLASS: Record<BadgeTone, string> = {
  default: 'badge',
  success: 'badge badge-success',
  error: 'badge badge-error',
}

export function Badge({
  tone = 'default',
  className,
  children,
  ...rest
}: BadgeProps) {
  const merged = [TONE_CLASS[tone], className].filter(Boolean).join(' ')
  return (
    <span className={merged} {...rest}>
      {children}
    </span>
  )
}
