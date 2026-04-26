import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectGrid } from './ProjectGrid'
import type { OctatrackProject } from '../types/projectManagement'

const mkProj = (name: string): OctatrackProject => ({
  name,
  path: `/s/${name}`,
  has_project_file: true,
  has_banks: true,
})

const baseProps = {
  setPath: '/s',
  setName: 'S',
  projects: [mkProj('A'), mkProj('B')],
  onProjectClick: vi.fn(),
  onCreateNew: vi.fn(),
  onContextMenu: vi.fn(),
}

describe('ProjectGrid', () => {
  it('renders one card per project plus a + card', () => {
    render(<ProjectGrid {...baseProps} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByLabelText(/new project/i)).toBeInTheDocument()
  })

  it('clicking a project card fires onProjectClick', async () => {
    const onProjectClick = vi.fn()
    const u = userEvent.setup()
    render(<ProjectGrid {...baseProps} onProjectClick={onProjectClick} />)
    await u.click(screen.getByText('A'))
    expect(onProjectClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }))
  })

  it('clicking + card fires onCreateNew', async () => {
    const onCreateNew = vi.fn()
    const u = userEvent.setup()
    render(<ProjectGrid {...baseProps} onCreateNew={onCreateNew} />)
    await u.click(screen.getByLabelText(/new project/i))
    expect(onCreateNew).toHaveBeenCalled()
  })

  it('right-clicking a project card fires onContextMenu with project target', async () => {
    const onContextMenu = vi.fn()
    const u = userEvent.setup()
    render(<ProjectGrid {...baseProps} onContextMenu={onContextMenu} />)
    await u.pointer({ keys: '[MouseRight]', target: screen.getByText('A') })
    expect(onContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ kind: 'project' }),
      })
    )
  })

  it('F2 fires onRenameRequest', () => {
    const onRenameRequest = vi.fn()
    render(<ProjectGrid {...baseProps} onRenameRequest={onRenameRequest} />)
    const card = screen.getByText('A').closest('.project-card')!
    fireEvent.keyDown(card, { key: 'F2' })
    expect(onRenameRequest).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }))
  })

  it('Delete fires onDeleteRequest', () => {
    const onDeleteRequest = vi.fn()
    render(<ProjectGrid {...baseProps} onDeleteRequest={onDeleteRequest} />)
    const card = screen.getByText('A').closest('.project-card')!
    fireEvent.keyDown(card, { key: 'Delete' })
    expect(onDeleteRequest).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }))
  })
})
