import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatternSelector, ALL_PATTERNS } from './PatternSelector'

describe('PatternSelector', () => {
  it('renders 16 pattern options plus All Patterns', () => {
    render(
      <PatternSelector id="test" value={0} onChange={() => {}} />
    )
    const select = screen.getByRole('combobox')
    const options = select.querySelectorAll('option')
    // 1 "All Patterns" + 16 individual patterns
    expect(options.length).toBe(17)
    expect(options[0].textContent).toBe('All Patterns')
    expect(options[1].textContent).toBe('Pattern 1')
    expect(options[16].textContent).toBe('Pattern 16')
  })

  it('fires onChange with correct pattern index', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <PatternSelector id="test" value={ALL_PATTERNS} onChange={handleChange} />
    )
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, '5')
    expect(handleChange).toHaveBeenCalledWith(5)
  })

  it('marks current pattern as Active', () => {
    render(
      <PatternSelector id="test" value={0} onChange={() => {}} currentPattern={3} />
    )
    const select = screen.getByRole('combobox')
    const options = select.querySelectorAll('option')
    // Pattern 4 (index 3) should be marked Active
    expect(options[4].textContent).toBe('Pattern 4 (Active)')
    // Other patterns should not
    expect(options[1].textContent).toBe('Pattern 1')
    expect(options[5].textContent).toBe('Pattern 5')
  })

  it('ALL_PATTERNS constant equals -1', () => {
    expect(ALL_PATTERNS).toBe(-1)
  })
})
