import { describe, it, expect } from 'vitest'
import { filterProjects } from './filterProjects'
import type { OctatrackLocation, OctatrackProject } from '../types/projectManagement'

const project = (name: string): OctatrackProject => ({
  name,
  path: `/media/OCTATRACK/SET/${name}`,
  has_project_file: true,
  has_banks: true,
})

const locations: OctatrackLocation[] = [
  {
    name: 'OCTATRACK',
    path: '/media',
    device_type: 'CompactFlash',
    sets: [
      {
        name: 'DrumSet', path: '/media/OCTATRACK/DrumSet', has_audio_pool: true,
        projects: [project('KICKS_2024'), project('bassline-01')],
      },
      {
        name: 'PadSet', path: '/media/OCTATRACK/PadSet', has_audio_pool: true,
        projects: [project('pads-v3')],
      },
    ],
  },
]

const standalone: OctatrackProject[] = [project('old-kick-tests'), project('ambient-01')]

describe('filterProjects', () => {
  it('matches project names case-insensitively', () => {
    const result = filterProjects(locations, standalone, 'KICK')
    expect(result.locations[0].sets[0].projects.map(p => p.name)).toEqual(['KICKS_2024'])
    expect(result.standaloneProjects.map(p => p.name)).toEqual(['old-kick-tests'])
  })

  it('drops a Set whose projects all fail the match', () => {
    const result = filterProjects(locations, standalone, 'kick')
    expect(result.locations[0].sets.map(s => s.name)).toEqual(['DrumSet'])
  })

  it('drops a Location whose Sets all dropped', () => {
    const result = filterProjects(locations, standalone, 'nothing-matches-this')
    expect(result.locations).toEqual([])
    expect(result.standaloneProjects).toEqual([])
  })

  it('filters standalone projects independently of Sets', () => {
    // "ambient" exists only outside any Set: Sets must all drop, standalone must survive.
    const result = filterProjects(locations, standalone, 'ambient')
    expect(result.locations).toEqual([])
    expect(result.standaloneProjects.map(p => p.name)).toEqual(['ambient-01'])
  })

  // Positive control. Without this, an implementation that always returns nothing
  // would satisfy every assertion above.
  it('returns everything unchanged for an empty or whitespace query', () => {
    expect(filterProjects(locations, standalone, '')).toEqual({
      locations, standaloneProjects: standalone,
    })
    expect(filterProjects(locations, standalone, '   ')).toEqual({
      locations, standaloneProjects: standalone,
    })
  })

  it('does not match on Set name, Location name, or path', () => {
    // "DrumSet" is a Set name and "media" is in every path: neither is searchable.
    expect(filterProjects(locations, standalone, 'DrumSet').locations).toEqual([])
    expect(filterProjects(locations, standalone, 'media').locations).toEqual([])
    expect(filterProjects(locations, standalone, 'media').standaloneProjects).toEqual([])
  })

  it('does not mutate its inputs', () => {
    const before = JSON.stringify(locations)
    filterProjects(locations, standalone, 'kick')
    expect(JSON.stringify(locations)).toBe(before)
  })
})
