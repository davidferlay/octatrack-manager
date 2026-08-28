import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DataTable } from './DataTable'

describe('DataTable', () => {
  it('renders shell with toolbar and wrapper', () => {
    render(
      <DataTable data-testid="root" className="audio-file-table-container">
        <DataTable.Toolbar className="filter-results-info">Counts</DataTable.Toolbar>
        <DataTable.Wrapper className="table-wrapper">
          <table>
            <tbody>
              <tr>
                <td>row</td>
              </tr>
            </tbody>
          </table>
        </DataTable.Wrapper>
      </DataTable>,
    )
    expect(screen.getByTestId('root')).toHaveClass('mo-data-table')
    expect(screen.getByTestId('root')).toHaveClass('audio-file-table-container')
    expect(screen.getByText('Counts')).toHaveClass('filter-results-info')
    expect(screen.getByText('row').closest('.table-wrapper')).toHaveClass('mo-data-table__wrapper')
  })

  it('renders loading and empty rows', () => {
    const onEmpty = vi.fn()
    const { rerender } = render(
      <table>
        <tbody>
          <DataTable.Loading colSpan={3} />
        </tbody>
      </table>,
    )
    expect(screen.getByText('Loading...')).toBeInTheDocument()

    rerender(
      <table>
        <tbody>
          <DataTable.Empty colSpan={3} onClick={onEmpty} style={{ cursor: 'pointer' }}>
            No files
          </DataTable.Empty>
        </tbody>
      </table>,
    )
    fireEvent.click(screen.getByText('No files'))
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })
})
