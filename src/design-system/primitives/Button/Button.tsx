import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'toolbar'
  | 'danger'
  | 'modal'
  | 'modalPrimary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  children?: ReactNode
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'scan-button',
  secondary: 'scan-button browse-button',
  toolbar: 'toolbar-button',
  danger: 'modal-button danger',
  modal: 'modal-button',
  modalPrimary: 'modal-button primary',
}

/**
 * Visual-parity button wrapper over existing App.css classes.
 * Prefer semantic variants; do not delete legacy classes until call sites are zero.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = 'primary', className, type = 'button', children, ...rest },
    ref,
  ) {
    const variantClass = VARIANT_CLASS[variant]
    const merged = [variantClass, className].filter(Boolean).join(' ')
    return (
      <button ref={ref} type={type} className={merged} {...rest}>
        {children}
      </button>
    )
  },
)
