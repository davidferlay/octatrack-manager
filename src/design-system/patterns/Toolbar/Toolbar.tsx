import type { HTMLAttributes, ReactNode } from 'react'
import './Toolbar.css'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function ToolbarRoot({ children, className, ...rest }: ToolbarProps) {
  const merged = ['mo-toolbar', className].filter(Boolean).join(' ')
  return (
    <div role="toolbar" className={merged} {...rest}>
      {children}
    </div>
  )
}

export type ToolbarSeparatorProps = HTMLAttributes<HTMLDivElement>

function ToolbarSeparator({ className, ...rest }: ToolbarSeparatorProps) {
  const merged = ['toolbar-separator', className].filter(Boolean).join(' ')
  return <div role="separator" className={merged} {...rest} />
}

/**
 * Layout-only action cluster. Holds no domain state; children own behavior.
 */
export const Toolbar = Object.assign(ToolbarRoot, {
  Separator: ToolbarSeparator,
})
