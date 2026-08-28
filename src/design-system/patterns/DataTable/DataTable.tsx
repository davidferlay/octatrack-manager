import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
} from 'react'
import './DataTable.css'

export interface DataTableProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function DataTableRoot({ children, className, ...rest }: DataTableProps) {
  const merged = ['mo-data-table', className].filter(Boolean).join(' ')
  return (
    <div className={merged} {...rest}>
      {children}
    </div>
  )
}

export interface DataTableToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function DataTableToolbar({ children, className, ...rest }: DataTableToolbarProps) {
  const merged = className
  return (
    <div className={merged} {...rest}>
      {children}
    </div>
  )
}

export interface DataTableWrapperProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

const DataTableWrapper = forwardRef<HTMLDivElement, DataTableWrapperProps>(
  function DataTableWrapper({ children, className, ...rest }, ref) {
    const merged = ['mo-data-table__wrapper', className].filter(Boolean).join(' ')
    return (
      <div ref={ref} className={merged} {...rest}>
        {children}
      </div>
    )
  },
)

export interface DataTableLoadingProps {
  colSpan: number
  children?: ReactNode
}

function DataTableLoading({ colSpan, children = 'Loading...' }: DataTableLoadingProps) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: 'center', opacity: 0.5 }}>
        {children}
      </td>
    </tr>
  )
}

export interface DataTableEmptyProps extends TdHTMLAttributes<HTMLTableCellElement> {
  colSpan: number
  children: ReactNode
}

function DataTableEmpty({ colSpan, children, style, ...rest }: DataTableEmptyProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{ textAlign: 'center', opacity: 0.5, ...style }}
        {...rest}
      >
        {children}
      </td>
    </tr>
  )
}

/**
 * Presentational table shell for file/project lists.
 * Domain filtering, TanStack wiring, DnD, and selection stay in feature tables.
 */
export const DataTable = Object.assign(DataTableRoot, {
  Toolbar: DataTableToolbar,
  Wrapper: DataTableWrapper,
  Loading: DataTableLoading,
  Empty: DataTableEmpty,
})
