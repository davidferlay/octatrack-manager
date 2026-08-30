import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectSelectorModal, type SelectorLocation, type SelectorProject } from './ProjectSelectorModal'

const other: SelectorProject = { name: 'OtherProject', path: '/set/Other', has_project_file: true, has_banks: true }
const noProjectFile: SelectorProject = { name: 'Empty', path: '/set/Empty', has_project_file: false, has_banks: false }

const locations: SelectorLocation[] = [{
  name: 'Card',
  path: '/card',
  device_type: 'CompactFlash',
  sets: [{ name: 'Set1', path: '/card/Set1', has_audio_pool: true, projects: [
    { name: 'MyProject', path: '/set/MyProject', has_project_file: true, has_banks: true },
    other,
  ] }],
}]

function renderModal(props: Partial<React.ComponentProps<typeof ProjectSelectorModal>> = {}) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(
    <ProjectSelectorModal
      title="Select Source Project"
      value="/set/MyProject"
      onSelect={onSelect}
      onClose={onClose}
      currentProjectPath="/set/MyProject"
      currentProjectName="MyProject"
      locations={[]}
      standaloneProjects={[]}
      browsedProjects={[]}
      isManualBrowseOpen={true}
      setIsManualBrowseOpen={() => {}}
      onRescan={() => {}}
      onBrowse={() => {}}
      isScanning={false}
      {...props}
    />
  )
  return { onSelect, onClose }
}

describe('ProjectSelectorModal', () => {
  it('shows the title it was given', () => {
    renderModal({ title: 'Select Destination Project' })
    expect(screen.getByText('Select Destination Project')).toBeInTheDocument()
  })

  it('always offers the current project, marked as current', () => {
    renderModal()
    expect(screen.getByText('Current Project')).toBeInTheDocument()
    expect(screen.getByText('MyProject')).toBeInTheDocument()
  })

  it('reports the current project when its card is clicked', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderModal({ value: '/set/Other' })
    await user.click(screen.getByText('MyProject'))
    expect(onSelect).toHaveBeenCalledWith('/set/MyProject')
  })

  it('reports a browsed project when its card is clicked', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderModal({ browsedProjects: [{ name: 'OtherProject', path: '/set/Other' }] })
    await user.click(screen.getByText('OtherProject'))
    expect(onSelect).toHaveBeenCalledWith('/set/Other')
  })

  it('leaves the current project out of the browsed list', () => {
    renderModal({ browsedProjects: [{ name: 'MyProject', path: '/set/MyProject' }] })
    expect(screen.queryByText(/Manual Browse/)).not.toBeInTheDocument()
  })

  it('lists individual projects that have a project file', () => {
    renderModal({ standaloneProjects: [other] })
    expect(screen.getByText('1 Individual Project')).toBeInTheDocument()
  })

  it('skips individual entries with no project file', () => {
    renderModal({ standaloneProjects: [noProjectFile] })
    expect(screen.queryByText(/Individual Project/)).not.toBeInTheDocument()
  })

  it('offers a New Project card only when a creator is supplied', async () => {
    const user = userEvent.setup()
    const onCreateProject = vi.fn()
    const { rerender } = render(
      <ProjectSelectorModal
        title="Select Destination Project"
        value="/set/MyProject"
        onSelect={() => {}}
        onClose={() => {}}
        currentProjectPath="/set/MyProject"
        currentProjectName="MyProject"
        locations={locations}
        standaloneProjects={[]}
        browsedProjects={[]}
        isManualBrowseOpen={true}
        setIsManualBrowseOpen={() => {}}
        onRescan={() => {}}
        onBrowse={() => {}}
        isScanning={false}
        onCreateProject={onCreateProject}
      />
    )
    // The set holding the current project starts expanded.
    const newProject = screen.getByLabelText('New project in Set1')
    await user.click(newProject)
    expect(onCreateProject).toHaveBeenCalledWith('/card/Set1', 'Set1')

    rerender(
      <ProjectSelectorModal
        title="Select Source Project"
        value="/set/MyProject"
        onSelect={() => {}}
        onClose={() => {}}
        currentProjectPath="/set/MyProject"
        currentProjectName="MyProject"
        locations={locations}
        standaloneProjects={[]}
        browsedProjects={[]}
        isManualBrowseOpen={true}
        setIsManualBrowseOpen={() => {}}
        onRescan={() => {}}
        onBrowse={() => {}}
        isScanning={false}
      />
    )
    expect(screen.queryByLabelText('New project in Set1')).not.toBeInTheDocument()
  })

  it('opens on the set holding the current project', () => {
    renderModal({ locations })
    // OtherProject shares that set, so it is visible without expanding anything.
    expect(screen.getByText('OtherProject')).toBeInTheDocument()
  })

  it('closes on the close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: '×' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('says it is scanning while a rescan runs', () => {
    renderModal({ isScanning: true })
    expect(screen.getByText('Scanning...')).toBeInTheDocument()
  })
})

describe('ProjectSelectorModal - search', () => {
  it('does not steal focus when the picker opens', () => {
    renderModal({ locations })
    expect(screen.getByLabelText('Search projects')).not.toHaveFocus()
  })

  it('focuses the search box on Ctrl+F', async () => {
    const user = userEvent.setup()
    renderModal({ locations })
    const input = screen.getByLabelText('Search projects')
    expect(input).not.toHaveFocus()

    await user.keyboard('{Control>}f{/Control}')
    expect(input).toHaveFocus()
  })

  it('Escape clears the query while the search box has focus', async () => {
    const user = userEvent.setup()
    renderModal({ locations })
    const input = screen.getByLabelText('Search projects')
    await user.keyboard('{Control>}f{/Control}')
    await user.type(input, 'other')
    expect(input).toHaveValue('other')

    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('narrows the list to matching project names', async () => {
    const user = userEvent.setup()
    renderModal({ locations })
    expect(screen.getByText('OtherProject')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search projects'), 'other')
    expect(screen.getByText('OtherProject')).toBeInTheDocument()
    // The current project card goes too, so a search shows only hits.
    expect(screen.queryByText('Current Project')).not.toBeInTheDocument()
  })

  it('keeps the current project when its name matches', async () => {
    const user = userEvent.setup()
    renderModal({ locations })
    await user.type(screen.getByLabelText('Search projects'), 'my')
    expect(screen.getByText('Current Project')).toBeInTheDocument()
  })

  it('filters browsed results too', async () => {
    const user = userEvent.setup()
    renderModal({ browsedProjects: [
      { name: 'OtherProject', path: '/set/Other' },
      { name: 'Unrelated', path: '/set/Unrelated' },
    ] })
    await user.type(screen.getByLabelText('Search projects'), 'other')
    expect(screen.getByText('OtherProject')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated')).not.toBeInTheDocument()
  })

  it('says when nothing matches and clears back to the full list', async () => {
    const user = userEvent.setup()
    renderModal({ locations })
    const input = screen.getByLabelText('Search projects')
    await user.type(input, 'zzzznothing')
    expect(screen.getByText(/No projects match/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.queryByText(/No projects match/)).not.toBeInTheDocument()
    expect(screen.getByText('OtherProject')).toBeInTheDocument()
  })

  it('expands the groups so hits are visible, and restores the shape after', async () => {
    const user = userEvent.setup()
    // With locations present the Individual group starts collapsed, so the search
    // has to open it for the hit inside to be reachable.
    renderModal({ locations, standaloneProjects: [{ ...other, name: 'LoneOther', path: '/lone/LoneOther' }] })
    const section = () => screen.getByText(/Individual Project/).nextElementSibling
    expect(section()?.className).toContain('closed')

    const input = screen.getByLabelText('Search projects')
    await user.type(input, 'loneother')
    expect(section()?.className).toContain('open')

    await user.clear(input)
    expect(section()?.className).toContain('closed')
  })

  it('lets a group be collapsed while the search is running', async () => {
    const user = userEvent.setup()
    renderModal({ locations, standaloneProjects: [{ ...other, name: 'LoneOther', path: '/lone/LoneOther' }] })
    const input = screen.getByLabelText('Search projects')
    await user.type(input, 'loneother')

    const header = screen.getByText(/Individual Project/)
    expect(header.nextElementSibling?.className).toContain('open')
    await user.click(header)
    expect(header.nextElementSibling?.className).toContain('closed')
  })
})
