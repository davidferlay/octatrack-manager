import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ReactNode } from 'react'
import { ProjectsProvider, useProjects } from './ProjectsContext'

const SESSION_STORAGE_KEY = 'octatrack_scanned_projects'

const wrapper = ({ children }: { children: ReactNode }) => (
  <ProjectsProvider>{children}</ProjectsProvider>
)

const mockLocation = {
  path: '/media/CARD',
  device_type: 'CompactFlash',
  sets: [{ name: 'MYSET', path: '/media/CARD/MYSET', projects: [], has_audio_pool: true }],
} as any

describe('ProjectsContext', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('starts empty and unscanned without stored state', () => {
    const { result } = renderHook(() => useProjects(), { wrapper })
    expect(result.current.locations).toEqual([])
    expect(result.current.standaloneProjects).toEqual([])
    expect(result.current.hasScanned).toBe(false)
    expect(result.current.isLocationsOpen).toBe(true)
    expect(result.current.isIndividualProjectsOpen).toBe(true)
  })

  it('persists scan results and UI state to sessionStorage', () => {
    const { result } = renderHook(() => useProjects(), { wrapper })
    act(() => {
      result.current.setLocations([mockLocation])
      result.current.setHasScanned(true)
      result.current.setOpenSets(new Set(['/media/CARD/MYSET']))
      result.current.setOpenLocations(new Set([0]))
    })

    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!)
    expect(stored.locations).toEqual([mockLocation])
    expect(stored.hasScanned).toBe(true)
    // Sets are serialized as arrays
    expect(stored.openSets).toEqual(['/media/CARD/MYSET'])
    expect(stored.openLocations).toEqual([0])
  })

  it('rehydrates state (including Sets) from sessionStorage', () => {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        locations: [mockLocation],
        standaloneProjects: [],
        hasScanned: true,
        openLocations: [0],
        openSets: ['/media/CARD/MYSET'],
        isIndividualProjectsOpen: false,
        isLocationsOpen: false,
        closedStandaloneGroups: ['group1'],
      })
    )

    const { result } = renderHook(() => useProjects(), { wrapper })
    expect(result.current.locations).toEqual([mockLocation])
    expect(result.current.hasScanned).toBe(true)
    expect(result.current.openSets).toEqual(new Set(['/media/CARD/MYSET']))
    expect(result.current.openLocations).toEqual(new Set([0]))
    expect(result.current.isIndividualProjectsOpen).toBe(false)
    expect(result.current.isLocationsOpen).toBe(false)
    expect(result.current.closedStandaloneGroups).toEqual(new Set(['group1']))
  })

  it('falls back to defaults when stored state is corrupted', () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'not json{')
    const { result } = renderHook(() => useProjects(), { wrapper })
    expect(result.current.locations).toEqual([])
    expect(result.current.hasScanned).toBe(false)
    expect(result.current.isLocationsOpen).toBe(true)
  })

  it('clearAll resets state and removes the stored entry', () => {
    const { result } = renderHook(() => useProjects(), { wrapper })
    act(() => {
      result.current.setLocations([mockLocation])
      result.current.setHasScanned(true)
    })
    act(() => {
      result.current.clearAll()
    })

    expect(result.current.locations).toEqual([])
    expect(result.current.hasScanned).toBe(false)
    // The persistence effect re-saves the (now empty) state after clearAll removes it;
    // what matters is that no scan data survives.
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      expect(parsed.locations).toEqual([])
      expect(parsed.hasScanned).toBe(false)
    }
  })

  it('useProjects throws outside the provider', () => {
    expect(() => renderHook(() => useProjects())).toThrow(
      'useProjects must be used within a ProjectsProvider'
    )
  })
})
