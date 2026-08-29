import type { SampleUsageEdge } from '../../api'
import './UsageGraphPanel.css'

export interface UsageGraphPanelProps {
  /** Selected audio file root-relative path. */
  relativePath: string
  /** Full catalog usage graph for the registered root. */
  edges?: SampleUsageEdge[] | null
}

const BANK_LETTERS = 'ABCDEFGHIJKLMNOP'

/** Normalize root-relative paths for comparison (case / separators). */
export function relativePathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function projectLabel(projectDocumentRelativePath: string): string {
  const parts = projectDocumentRelativePath.split('/').filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]
  return projectDocumentRelativePath.replace(/\.(work|strd)$/i, '')
}

function bankLabel(bankDocumentRelativePath: string): string {
  const name = bankDocumentRelativePath.split('/').pop() ?? bankDocumentRelativePath
  const match = /^bank(\d+)/i.exec(name)
  if (match) {
    const number = Number(match[1])
    if (Number.isInteger(number) && number >= 1 && number <= BANK_LETTERS.length) {
      const letter = BANK_LETTERS[number - 1]
      return `Bank ${letter} (${number})`
    }
  }
  return name.replace(/\.(work|strd)$/i, '')
}

/** Working (.work) vs SavedCheckpoint (.strd) — independent M3-C2 projections. */
function stateRoleLabel(documentRelativePath: string): string | null {
  if (/\.work$/i.test(documentRelativePath)) return 'Working'
  if (/\.strd$/i.test(documentRelativePath)) return 'Saved'
  return null
}

function slotLabel(kind: SampleUsageEdge['slotKind'], number: number): string {
  const prefix = kind === 'flex' ? 'F' : 'S'
  return `${prefix}${String(number).padStart(3, '0')}`
}

function isMissingReference(status: SampleUsageEdge['referenceStatus']): boolean {
  return status === 'missing' || status === 'invalid_path'
}

function formatEdge(edge: SampleUsageEdge): string {
  const project = projectLabel(edge.projectDocumentRelativePath)
  const bank = bankLabel(edge.bankDocumentRelativePath)
  const slot = slotLabel(edge.slotKind, edge.slotNumber)
  const role = stateRoleLabel(edge.bankDocumentRelativePath)
  const roleSuffix = role != null ? ` · ${role}` : ''
  if (edge.usageKind === 'machine') {
    const part = (edge.partIndex ?? 0) + 1
    return `${project} · ${bank} · ${slot} · Part ${part} · T${edge.trackIndex + 1} · Machine${roleSuffix}`
  }
  const pattern = (edge.patternIndex ?? 0) + 1
  const step = (edge.stepIndex ?? 0) + 1
  return `${project} · ${bank} · ${slot} · Pattern ${pattern} · T${edge.trackIndex + 1} · Step ${step} · Lock${roleSuffix}`
}

export function edgesForRelativePath(
  edges: SampleUsageEdge[] | null | undefined,
  relativePath: string,
): SampleUsageEdge[] {
  if (edges == null || edges.length === 0) return []
  const key = relativePathKey(relativePath)
  return edges.filter((edge) => {
    const referenced = edge.referencedFileRelativePath
    return referenced != null && relativePathKey(referenced) === key
  })
}

/**
 * Read-only Usage Graph for a selected catalog audio file.
 * Filters M3-C2 usage edges by root-relative path — no absolute paths.
 */
export function UsageGraphPanel({
  relativePath,
  edges = [],
}: UsageGraphPanelProps) {
  const matched = edgesForRelativePath(edges, relativePath)
  const audibleCount = matched.filter((edge) => edge.audible).length
  const referencedCount = matched.length - audibleCount
  const missingCount = matched.filter((edge) =>
    isMissingReference(edge.referenceStatus),
  ).length

  return (
    <section className="mo-usage-graph" aria-label="Usage graph">
      <div className="mo-usage-graph__heading">
        <p>Usage</p>
        <ul className="mo-usage-graph__summary" aria-label="Usage summary">
          <li data-tone="audible">{audibleCount} used</li>
          <li data-tone="referenced">{referencedCount} referenced</li>
          {missingCount > 0 && (
            <li data-tone="missing">{missingCount} missing</li>
          )}
        </ul>
      </div>

      {matched.length === 0 ? (
        <p className="mo-usage-graph__empty">
          Not referenced in any indexed project of this root.
        </p>
      ) : (
        <ul className="mo-usage-graph__list">
          {matched.map((edge, index) => {
            const missing = isMissingReference(edge.referenceStatus)
            return (
              <li
                key={`${edge.bankDocumentRelativePath}:${edge.slotKind}:${edge.slotNumber}:${edge.usageKind}:${edge.trackIndex}:${edge.partIndex}:${edge.patternIndex}:${edge.stepIndex}:${index}`}
                data-audible={edge.audible}
                data-status={edge.referenceStatus}
              >
                <span className="mo-usage-graph__badges">
                  <span
                    className="mo-usage-graph__badge"
                    data-audible={edge.audible}
                  >
                    {edge.audible ? 'Used' : 'Referenced'}
                  </span>
                  {missing && (
                    <span className="mo-usage-graph__badge" data-tone="missing">
                      Missing
                    </span>
                  )}
                </span>
                <span className="mo-usage-graph__detail">{formatEdge(edge)}</span>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mo-usage-graph__boundary">
        Read-only catalog projection. Source media remains unchanged.
      </p>
    </section>
  )
}
