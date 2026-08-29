import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SampleUsageEdge } from '../../api'
import {
  edgesForRelativePath,
  relativePathKey,
  UsageGraphPanel,
} from './UsageGraphPanel'

const edges: SampleUsageEdge[] = [
  {
    bankDocumentRelativePath: 'LIVE_SET/PROJECT_A/bank01.work',
    projectDocumentRelativePath: 'LIVE_SET/PROJECT_A/project.work',
    slotKind: 'static',
    slotNumber: 1,
    usageKind: 'machine',
    trackIndex: 0,
    partIndex: 0,
    patternIndex: null,
    stepIndex: null,
    audible: true,
    referencedFileRelativePath: 'LIVE_SET/AUDIO/KICK.wav',
    referenceStatus: 'resolved',
  },
  {
    bankDocumentRelativePath: 'LIVE_SET/PROJECT_A/bank01.strd',
    projectDocumentRelativePath: 'LIVE_SET/PROJECT_A/project.strd',
    slotKind: 'static',
    slotNumber: 1,
    usageKind: 'machine',
    trackIndex: 0,
    partIndex: 0,
    patternIndex: null,
    stepIndex: null,
    audible: true,
    referencedFileRelativePath: 'LIVE_SET/AUDIO/KICK.wav',
    referenceStatus: 'resolved',
  },
  {
    bankDocumentRelativePath: 'LIVE_SET/PROJECT_A/bank02.work',
    projectDocumentRelativePath: 'LIVE_SET/PROJECT_A/project.work',
    slotKind: 'flex',
    slotNumber: 12,
    usageKind: 'sample_lock',
    trackIndex: 3,
    partIndex: null,
    patternIndex: 1,
    stepIndex: 7,
    audible: false,
    referencedFileRelativePath: 'LIVE_SET/AUDIO/KICK.wav',
    referenceStatus: 'missing',
  },
  {
    bankDocumentRelativePath: 'LIVE_SET/PROJECT_B/bank01.work',
    projectDocumentRelativePath: 'LIVE_SET/PROJECT_B/project.work',
    slotKind: 'static',
    slotNumber: 2,
    usageKind: 'machine',
    trackIndex: 1,
    partIndex: 1,
    patternIndex: null,
    stepIndex: null,
    audible: true,
    referencedFileRelativePath: 'LIVE_SET/AUDIO/SNARE.wav',
    referenceStatus: 'resolved',
  },
]

describe('UsageGraphPanel', () => {
  it('filters edges to the selected relative path only', () => {
    expect(edgesForRelativePath(edges, 'LIVE_SET/AUDIO/KICK.wav')).toHaveLength(3)
    expect(edgesForRelativePath(edges, 'LIVE_SET/AUDIO/missing.wav')).toHaveLength(0)
  })

  it('matches referenced paths case-insensitively', () => {
    expect(relativePathKey('LIVE_SET\\AUDIO\\Kick.WAV')).toBe(
      'live_set/audio/kick.wav',
    )
    expect(
      edgesForRelativePath(edges, 'live_set/audio/kick.wav'),
    ).toHaveLength(3)
  })

  it('renders Working/Saved roles, missing badges, and no absolute paths', () => {
    render(
      <UsageGraphPanel
        relativePath="LIVE_SET/AUDIO/KICK.wav"
        edges={edges}
      />,
    )

    expect(screen.getByLabelText('Usage graph')).toBeInTheDocument()
    expect(screen.getByLabelText('Usage summary')).toHaveTextContent('2 used')
    expect(screen.getByLabelText('Usage summary')).toHaveTextContent('1 referenced')
    expect(screen.getByLabelText('Usage summary')).toHaveTextContent('1 missing')
    expect(
      screen.getByText(/PROJECT_A · Bank A \(1\) · S001 · Part 1 · T1 · Machine · Working/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/PROJECT_A · Bank A \(1\) · S001 · Part 1 · T1 · Machine · Saved/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/PROJECT_A · Bank B \(2\) · F012 · Pattern 2 · T4 · Step 8 · Lock · Working/),
    ).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('SNARE.wav')).not.toBeInTheDocument()
    expect(screen.queryByText(/\/private\//)).not.toBeInTheDocument()
  })

  it('shows an empty state when the file is unreferenced', () => {
    render(
      <UsageGraphPanel
        relativePath="LIVE_SET/AUDIO/UNUSED.wav"
        edges={edges}
      />,
    )

    expect(
      screen.getByText('Not referenced in any indexed project of this root.'),
    ).toBeInTheDocument()
  })

  it('tolerates missing usageEdges without crashing', () => {
    render(
      <UsageGraphPanel relativePath="LIVE_SET/AUDIO/KICK.wav" edges={null} />,
    )
    expect(
      screen.getByText('Not referenced in any indexed project of this root.'),
    ).toBeInTheDocument()
  })
})
