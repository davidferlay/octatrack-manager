import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BankSelector, ALL_BANKS, formatBankName } from './BankSelector'

describe('formatBankName', () => {
  it('formats bank name with 1-indexed number', () => {
    expect(formatBankName('Bank A', 0)).toBe('Bank A (1)')
    expect(formatBankName('Bank B', 1)).toBe('Bank B (2)')
    expect(formatBankName('Custom Name', 15)).toBe('Custom Name (16)')
  })
})

describe('BankSelector', () => {
  const mockBanks = [
    { id: 'bank-a', name: 'Bank A', parts: [] },
    { id: 'bank-b', name: 'Bank B', parts: [] },
  ]

  it('renders with label', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('Bank:')).toBeInTheDocument()
  })

  it('renders select element with correct id', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={() => {}}
      />
    )
    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'test-bank')
  })

  it('shows loading state when no banks loaded', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={[]}
        value={0}
        onChange={() => {}}
        loadedBankIndices={new Set()}
      />
    )
    expect(screen.getByText('Loading banks...')).toBeInTheDocument()
  })

  it('disables select when no banks loaded', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={[]}
        value={0}
        onChange={() => {}}
        loadedBankIndices={new Set()}
      />
    )
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('shows All Banks option when allBanksLoaded is true', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={() => {}}
        loadedBankIndices={new Set([0, 1])}
        allBanksLoaded={true}
      />
    )
    expect(screen.getByText('All Banks')).toBeInTheDocument()
  })

  it('shows All Banks (loading...) when not all loaded', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={() => {}}
        loadedBankIndices={new Set([0])}
        allBanksLoaded={false}
      />
    )
    expect(screen.getByText('All Banks (loading...)')).toBeInTheDocument()
  })

  it('calls onChange when selection changes', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={handleChange}
        loadedBankIndices={new Set([0, 1])}
      />
    )

    await user.selectOptions(screen.getByRole('combobox'), '1')
    expect(handleChange).toHaveBeenCalledWith(1)
  })

  it('marks current bank as Active', () => {
    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={() => {}}
        currentBank={0}
        loadedBankIndices={new Set([0, 1])}
      />
    )
    expect(screen.getByText(/\(Active\)/)).toBeInTheDocument()
  })

  it('shows unsupported for failed banks', () => {
    const failedBanks = new Map([[1, 'Error loading']])

    render(
      <BankSelector
        id="test-bank"
        banks={mockBanks}
        value={0}
        onChange={() => {}}
        loadedBankIndices={new Set([0])}
        failedBankIndices={failedBanks}
      />
    )
    expect(screen.getByText('Bank B (unsupported)')).toBeInTheDocument()
  })

  it('exports ALL_BANKS constant as -1', () => {
    expect(ALL_BANKS).toBe(-1)
  })
})
