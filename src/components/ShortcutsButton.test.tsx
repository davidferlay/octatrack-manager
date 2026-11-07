import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
import { ShortcutsButton } from './ShortcutsButton'

describe('the Shortcuts & zoom window', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string, args?: { step: number }) => {
      if (cmd === 'get_ui_zoom') return 1.1
      if (cmd === 'step_ui_zoom') return args!.step === 0 ? 1 : args!.step > 0 ? 1.25 : 1
      return null
    })
  })

  it('opens from the header icon, on the shortcuts of the page on screen', async () => {
    const user = userEvent.setup()
    render(<ShortcutsButton page="project" section="flex-slots" />)
    await user.click(screen.getByRole('button', { name: 'Shortcuts & zoom' }))
    const dialog = screen.getByRole('dialog', { name: 'Shortcuts & zoom' })
    const headings = [...dialog.querySelectorAll('h4')].map(h => h.textContent)
    expect(headings).toEqual(['Sample slots', 'Sample preview', 'Project', 'Everywhere'])
  })

  it('? opens and closes it, but typing ? in a field does not', async () => {
    const user = userEvent.setup()
    render(<><input aria-label="Name" /><ShortcutsButton page="home" /></>)
    await user.keyboard('?')
    expect(screen.getByRole('dialog', { name: 'Shortcuts & zoom' })).toBeInTheDocument()
    await user.keyboard('?')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Name'))
    await user.keyboard('?')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('?')
  })

  it('? still opens it from a value field, which never takes a ?', async () => {
    const user = userEvent.setup()
    render(<>
      <input type="text" className="param-value" aria-label="ATK" defaultValue="64" />
      <input type="text" className="param-value" aria-label="Locked" readOnly defaultValue="12" />
      <ShortcutsButton page="home" />
    </>)
    await user.click(screen.getByLabelText('ATK'))
    await user.keyboard('?')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // And the field did not take it
    expect(screen.getByLabelText('ATK')).toHaveValue('64')
    await user.keyboard('?')
    await user.click(screen.getByLabelText('Locked'))
    await user.keyboard('?')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('? opens it even when a page handler stops the key from bubbling', async () => {
    const user = userEvent.setup()
    render(<>
      <div tabIndex={0} aria-label="Card" onKeyDown={e => e.stopPropagation()} />
      <ShortcutsButton page="home" />
    </>)
    screen.getByLabelText('Card').focus()
    await user.keyboard('?')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a press that began inside does not close it when released on the backdrop', async () => {
    const user = userEvent.setup()
    render(<ShortcutsButton page="home" />)
    await user.click(screen.getByRole('button', { name: 'Shortcuts & zoom' }))
    const overlay = document.querySelector('.modal-overlay') as HTMLElement
    const value = screen.getByRole('status', { name: 'Zoom' })
    // Pressed on the value, released over the backdrop: the click lands on the backdrop
    fireEvent.pointerDown(value)
    fireEvent.click(overlay)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Pressed and released on the backdrop: closes
    fireEvent.pointerDown(overlay)
    fireEvent.click(overlay)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape and the close button close it', async () => {
    const user = userEvent.setup()
    render(<ShortcutsButton page="home" />)
    await user.click(screen.getByRole('button', { name: 'Shortcuts & zoom' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Shortcuts & zoom' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the zoom in force, with buttons to step it and one to reset it', async () => {
    const user = userEvent.setup()
    render(<ShortcutsButton page="home" />)
    await user.click(screen.getByRole('button', { name: 'Shortcuts & zoom' }))
    const value = await screen.findByRole('status', { name: 'Zoom' })
    await waitFor(() => expect(value).toHaveTextContent('110%'))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(invokeMock).toHaveBeenCalledWith('step_ui_zoom', { step: 1 })
    await waitFor(() => expect(value).toHaveTextContent('125%'))
    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(invokeMock).toHaveBeenCalledWith('step_ui_zoom', { step: -1 })
    await waitFor(() => expect(value).toHaveTextContent('100%'))
    // Already at 100%: nothing to reset
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(value).toHaveTextContent('125%'))
    await user.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }))
    expect(invokeMock).toHaveBeenCalledWith('step_ui_zoom', { step: 0 })
    await waitFor(() => expect(value).toHaveTextContent('100%'))
  })

  it('follows a zoom changed from the keyboard while it is open', async () => {
    const user = userEvent.setup()
    render(<ShortcutsButton page="home" />)
    await user.click(screen.getByRole('button', { name: 'Shortcuts & zoom' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Zoom' })).toHaveTextContent('110%'))
    act(() => { window.dispatchEvent(new CustomEvent('ui-zoom', { detail: 1.5 })) })
    await waitFor(() => expect(screen.getByRole('status', { name: 'Zoom' })).toHaveTextContent('150%'))
  })
})
