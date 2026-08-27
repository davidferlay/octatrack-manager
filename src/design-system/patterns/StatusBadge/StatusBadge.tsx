import type { HTMLAttributes, ReactNode } from 'react'
import './StatusBadge.css'

export type StatusBadgeTone =
  | 'readonly'
  | 'safe'
  | 'warning'
  | 'danger'
  | 'neutral'

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusBadgeTone
  children: ReactNode
}

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  // Visual parity with RootRegistryPanel.css .root-mode-badge
  readonly: 'root-mode-badge',
  safe: 'mo-status-badge mo-status-badge--safe',
  warning: 'mo-status-badge mo-status-badge--warning',
  danger: 'mo-status-badge mo-status-badge--danger',
  neutral: 'mo-status-badge mo-status-badge--neutral',
}

/**
 * Presentational status pill. Does not absorb interactive usage/compat badges.
 */
export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: StatusBadgeProps) {
  const merged = [TONE_CLASS[tone], className].filter(Boolean).join(' ')
  return (
    <span className={merged} {...rest}>
      {children}
    </span>
  )
}
