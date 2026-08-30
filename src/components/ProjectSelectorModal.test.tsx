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
