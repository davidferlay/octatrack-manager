import {
  forwardRef,
  type InputHTMLAttributes,
} from 'react'

export type InputVariant = 'modal' | 'plain'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant
  shaking?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { variant = 'modal', shaking = false, className, ...rest },
    ref,
  ) {
    const base = variant === 'modal' ? 'modal-input' : undefined
    const merged = [base, shaking ? 'shake' : undefined, className]
      .filter(Boolean)
      .join(' ')
    return <input ref={ref} className={merged || undefined} {...rest} />
  },
)
