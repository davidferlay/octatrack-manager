import type { OctatrackProject, ContextMenuState } from '../types/projectManagement'

export interface ProjectGridProps {
  setPath: string
  setName: string
  projects: OctatrackProject[]
  onProjectClick: (project: OctatrackProject) => void
  onCreateNew: () => void
  onContextMenu: (state: ContextMenuState) => void
  // Drag-and-drop
  draggedProject?: { path: string; sourceSetPath: string } | null
  onDragStart?: (project: OctatrackProject) => void
  onDragEnd?: () => void
  onDropOnSet?: (sourceProjectPath: string, sourceSetPath: string, destSetPath: string) => void
  // Keyboard shortcuts
  onCopy?: (project: OctatrackProject) => void
  onPaste?: () => void
  onDeleteRequest?: (project: OctatrackProject) => void
  onRenameRequest?: (project: OctatrackProject) => void
  clipboard?: { path: string; name: string } | null
}

export function ProjectGrid({
  setPath,
  setName,
  projects,
  onProjectClick,
  onCreateNew,
  onContextMenu,
  draggedProject,
  onDragStart,
  onDragEnd,
  onDropOnSet,
  onCopy,
  onPaste,
  onDeleteRequest,
  onRenameRequest,
}: ProjectGridProps) {
  function handleProjectContextMenu(e: React.MouseEvent, project: OctatrackProject) {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'project', project, setPath, setName },
    })
  }

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>, project: OctatrackProject) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onProjectClick(project)
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      onRenameRequest?.(project)
      return
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      onDeleteRequest?.(project)
      return
    }
    if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onCopy?.(project)
      return
    }
    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onPaste?.()
      return
    }

    // Arrow nav within this grid only.
    const cards = Array.from(
      e.currentTarget.parentElement?.querySelectorAll('.project-card') ?? []
    ) as HTMLElement[]
    const idx = cards.indexOf(e.currentTarget)
    if (idx === -1) return

    let target: HTMLElement | undefined
    switch (e.key) {
      case 'ArrowRight':
        target = cards[idx + 1] ?? cards[0]
        break
      case 'ArrowLeft':
        target = cards[idx - 1] ?? cards[cards.length - 1]
        break
      case 'ArrowDown': {
        const cols = cards.filter((c) => c.offsetTop === cards[0].offsetTop).length
        target = cards[idx + cols] ?? cards[cards.length - 1]
        break
      }
      case 'ArrowUp': {
        const cols = cards.filter((c) => c.offsetTop === cards[0].offsetTop).length
        target = cards[idx - cols] ?? cards[0]
        break
      }
      default:
        return
    }
    e.preventDefault()
    target?.focus()
  }

  return (
    <>
      {projects.map((p) => (
        <div
          key={p.path}
          className="project-card clickable-project"
          tabIndex={0}
          draggable
          title="Click to view project details"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', p.path)
            onDragStart?.(p)
          }}
          onDragEnd={() => onDragEnd?.()}
          onClick={() => onProjectClick(p)}
          onContextMenu={(e) => handleProjectContextMenu(e, p)}
          onKeyDown={(e) => handleCardKeyDown(e, p)}
        >
          <div className="project-name">{p.name}</div>
          <div className="project-info">
            <span className={p.has_project_file ? "status-yes" : "status-no"}>
              {p.has_project_file ? "✓ Project" : "✗ Project"}
            </span>
            <span className={p.has_banks ? "status-yes" : "status-no"}>
              {p.has_banks ? "✓ Banks" : "✗ Banks"}
            </span>
          </div>
        </div>
      ))}
      <div
        className="project-card new-project-card"
        role="button"
        tabIndex={0}
        aria-label={`New project in ${setName}`}
        onClick={onCreateNew}
        onKeyDown={(e) => { if (e.key === 'Enter') onCreateNew() }}
        onDragOver={(e) => {
          if (draggedProject && draggedProject.sourceSetPath !== setPath) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={(e) => {
          if (!draggedProject || draggedProject.sourceSetPath === setPath) return
          e.preventDefault()
          onDropOnSet?.(draggedProject.path, draggedProject.sourceSetPath, setPath)
        }}
      >
        <div className="new-project-icon">+</div>
        <div className="new-project-label">New Project</div>
      </div>
    </>
  )
}
