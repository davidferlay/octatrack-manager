import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectContextMenu } from './ProjectContextMenu'
import type { ContextTarget, ClipboardState } from '../types/projectManagement'

const projectTarget: ContextTarget = {
  kind: 'project',
  project: { name: 'A', path: '/p/A', has_project_file: true, has_banks: true },
  setPath: '/s',
  setName: 'S',
}
const setTarget: ContextTarget = { kind: 'set', setPath: '/s', setName: 'S' }

const handlers = {
  onCopy: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onOpenInFileManager: vi.fn(),
  onPaste: vi.fn(),
  onCreateNew: vi.fn(),
  onClose: vi.fn(),
}

describe('ProjectContextMenu', () => {
  it('shows project items when target.kind = project', () => {
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={projectTarget}
        clipboard={null}
        {...handlers}
      />
    )
    expect(screen.getByText(/copy/i)).toBeInTheDocument()
    expect(screen.getByText(/rename/i)).toBeInTheDocument()
    expect(screen.getByText(/delete/i)).toBeInTheDocument()
    expect(screen.getByText(/open in file manager/i)).toBeInTheDocument()
    expect(screen.queryByText(/new project/i)).not.toBeInTheDocument()
  })

  it('shows set items when target.kind = set', () => {
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={setTarget}
        clipboard={null}
        {...handlers}
      />
    )
    expect(screen.getByText(/new project/i)).toBeInTheDocument()
    expect(screen.queryByText(/^copy$/i)).not.toBeInTheDocument()
  })

  it('hides Paste when clipboard is null', () => {
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={setTarget}
        clipboard={null}
        {...handlers}
      />
    )
    expect(screen.queryByText(/paste/i)).not.toBeInTheDocument()
  })

  it('shows Paste when clipboard is set', () => {
    const clipboard: ClipboardState = { path: '/p/A', name: 'A' }
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={setTarget}
        clipboard={clipboard}
        {...handlers}
      />
    )
    expect(screen.getByText(/paste/i)).toBeInTheDocument()
  })

  it('Escape closes the menu', () => {
    const onClose = vi.fn()
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={setTarget}
        clipboard={null}
        {...handlers}
        onClose={onClose}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('click outside closes the menu', async () => {
    const onClose = vi.fn()
    const u = userEvent.setup()
    render(
      <div data-testid="outside">
        <ProjectContextMenu
          x={0}
          y={0}
          target={setTarget}
          clipboard={null}
          {...handlers}
          onClose={onClose}
        />
      </div>
    )
    await u.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('Copy click invokes onCopy then closes', async () => {
    const onCopy = vi.fn()
    const onClose = vi.fn()
    const u = userEvent.setup()
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={projectTarget}
        clipboard={null}
        {...handlers}
        onCopy={onCopy}
        onClose={onClose}
      />
    )
    await u.click(screen.getByText(/copy/i))
    expect(onCopy).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not show Paste on project target even with clipboard', () => {
    const clipboard: ClipboardState = { path: '/p/A', name: 'A' }
    render(
      <ProjectContextMenu
        x={0}
        y={0}
        target={projectTarget}
        clipboard={clipboard}
        {...handlers}
      />
    )
    expect(screen.queryByText(/paste/i)).not.toBeInTheDocument()
  })
})
