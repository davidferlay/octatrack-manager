import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'

export type IconButtonVariant = 'sidebar' | 'back' | 'icon'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  children?: ReactNode
}

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  sidebar: 'sidebar-back-btn',
  back: 'back-button',
  icon: 'icon-button',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = 'icon', className, type = 'button', children, ...rest },
    ref,
  ) {
    const merged = [VARIANT_CLASS[variant], className].filter(Boolean).join(' ')
    return (
      <button ref={ref} type={type} className={merged} {...rest}>
        {children}
      </button>
    )
  },
)
