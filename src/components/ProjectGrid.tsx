import { useDraggable } from '@dnd-kit/core'
import type { OctatrackProject, ContextMenuState } from '../types/projectManagement'

export interface ProjectGridProps {
  setPath: string
  setName: string
  projects: OctatrackProject[]
  onProjectClick: (project: OctatrackProject) => void
  onCreateNew: () => void
  onContextMenu: (state: ContextMenuState) => void
  // Keyboard shortcuts
  onCopy?: (project: OctatrackProject) => void
  onPaste?: () => void
  onDeleteRequest?: (project: OctatrackProject) => void
  onRenameRequest?: (project: OctatrackProject) => void
  clipboard?: { path: string; name: string } | null
}

function DraggableProjectCard({
  project,
  setPath,
  onProjectClick,
  onContextMenu,
  onKeyDown,
}: {
  project: OctatrackProject
  setPath: string
  onProjectClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `project:${project.path}`,
    data: { type: 'project', project, sourceSetPath: setPath },
  })

  return (
    <div
      ref={setNodeRef}
      className="project-card clickable-project"
      title="Click to view project details"
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      tabIndex={0}
      onClick={onProjectClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className="project-name">{project.name}</div>
      <div className="project-info">
        <span className={project.has_project_file ? "status-yes" : "status-no"}>
          {project.has_project_file ? "✓ Project" : "✗ Project"}
        </span>
        <span className={project.has_banks ? "status-yes" : "status-no"}>
          {project.has_banks ? "✓ Banks" : "✗ Banks"}
        </span>
      </div>
    </div>
  )
}

export function ProjectGrid({
  setPath,
  setName,
  projects,
  onProjectClick,
  onCreateNew,
  onContextMenu,
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
    const gridEl = e.currentTarget.parentElement
    if (!gridEl) return
    const cards = Array.from(
      gridEl.querySelectorAll('.project-card.clickable-project')
    ) as HTMLElement[]
    const idx = cards.indexOf(e.currentTarget)
    if (idx === -1) return

    let target: HTMLElement | undefined
    const currentLeft = e.currentTarget.offsetLeft
    const currentTop = e.currentTarget.offsetTop

    switch (e.key) {
      case 'ArrowRight':
        target = cards[idx + 1] ?? cards[0]
        break
      case 'ArrowLeft':
        target = cards[idx - 1] ?? cards[cards.length - 1]
        break
      case 'ArrowDown': {
        const below = cards.filter(c => c.offsetTop > currentTop + 10)
        if (below.length > 0) {
          const nextRowTop = below[0].offsetTop
          const nextRow = below.filter(c => Math.abs(c.offsetTop - nextRowTop) < 10)
          target = nextRow.reduce((best, c) =>
            Math.abs(c.offsetLeft - currentLeft) < Math.abs(best.offsetLeft - currentLeft) ? c : best
          )
        } else {
          target = cards[cards.length - 1]
        }
        break
      }
      case 'ArrowUp': {
        const above = cards.filter(c => c.offsetTop < currentTop - 10)
        if (above.length > 0) {
          const prevRowTop = above[above.length - 1].offsetTop
          const prevRow = above.filter(c => Math.abs(c.offsetTop - prevRowTop) < 10)
          target = prevRow.reduce((best, c) =>
            Math.abs(c.offsetLeft - currentLeft) < Math.abs(best.offsetLeft - currentLeft) ? c : best
          )
        } else {
          target = cards[0]
        }
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
        <DraggableProjectCard
          key={p.path}
          project={p}
          setPath={setPath}
          onProjectClick={() => onProjectClick(p)}
          onContextMenu={(e) => handleProjectContextMenu(e, p)}
          onKeyDown={(e) => handleCardKeyDown(e, p)}
        />
      ))}
      <div
        className="project-card new-project-card"
        role="button"
        tabIndex={0}
        aria-label={`New project in ${setName}`}
        onClick={onCreateNew}
        onKeyDown={(e) => { if (e.key === 'Enter') onCreateNew() }}
      >
        <div className="new-project-icon">+</div>
        <div className="new-project-label">New Project</div>
      </div>
    </>
  )
}
