/**
 * Design system public entry.
 * Token CSS is imported from main.tsx (`./design-system/tokens/index.css`).
 */

export { Button, type ButtonProps, type ButtonVariant } from './primitives/Button'
export {
  IconButton,
  type IconButtonProps,
  type IconButtonVariant,
} from './primitives/IconButton'
export { Badge, type BadgeProps, type BadgeTone } from './primitives/Badge'
export { Input, type InputProps, type InputVariant } from './primitives/Input'
export { Spinner, type SpinnerProps, type SpinnerSize } from './primitives/Spinner'
export { Divider, type DividerProps, type DividerVariant } from './primitives/Divider'
export { Tooltip, type TooltipProps } from './primitives/Tooltip'
export {
  Modal,
  useModalDismiss,
  type ModalProps,
  type ModalHeaderProps,
  type ModalBodyProps,
  type ModalFooterProps,
  type UseModalDismissOptions,
} from './primitives/Modal'
export {
  StatusBadge,
  type StatusBadgeProps,
  type StatusBadgeTone,
} from './patterns/StatusBadge'
export {
  Toolbar,
  type ToolbarProps,
  type ToolbarSeparatorProps,
} from './patterns/Toolbar'
