import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { usePoolUsage, invalidatePoolUsage, renamePoolUsage } from './usePoolUsage'

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
  invalidatePoolUsage() // clear the module-level cache between tests
})

describe('usePoolUsage', () => {
  it('fetches get_pool_usage once, then serves a second mount from cache', async () => {
    mockInvoke.mockResolvedValue({ '/audio/kick.wav': [] })

    const a = renderHook(() => usePoolUsage('/set/AUDIO'))
    await waitFor(() => expect(a.result.current.usageLoading).toBe(false))
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    // A second consumer of the same pool path mounts after the fetch resolved —
    // it should read the cache instead of re-invoking get_pool_usage.
    const b = renderHook(() => usePoolUsage('/set/AUDIO'))
    expect(b.result.current.usageLoading).toBe(false)
    expect(b.result.current.usageMap).toEqual({ '/audio/kick.wav': [] })
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent fetches for the same pool path into one invoke call', async () => {
    let resolveInvoke: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(() => new Promise(resolve => { resolveInvoke = resolve }))

    const a = renderHook(() => usePoolUsage('/set/AUDIO'))
    const b = renderHook(() => usePoolUsage('/set/AUDIO'))
    expect(a.result.current.usageLoading).toBe(true)
    expect(b.result.current.usageLoading).toBe(true)
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    act(() => resolveInvoke({ '/audio/kick.wav': [] }))
    await waitFor(() => expect(a.result.current.usageLoading).toBe(false))
    await waitFor(() => expect(b.result.current.usageLoading).toBe(false))
  })

  it('invalidatePoolUsage(poolPath) drops the cache and re-fetches for mounted consumers', async () => {
    mockInvoke.mockResolvedValue({ '/audio/kick.wav': [{ project: 'P1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true, slot: null }] })
    const hook = renderHook(() => usePoolUsage('/set/AUDIO'))
    await waitFor(() => expect(hook.result.current.usageLoading).toBe(false))
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    mockInvoke.mockResolvedValue({})
    act(() => invalidatePoolUsage('/set/AUDIO'))
    await waitFor(() => expect(hook.result.current.usageLoading).toBe(false))
    await waitFor(() => expect(hook.result.current.usageMap).toEqual({}))
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('invalidating a different pool path does not affect this one\'s cache', async () => {
    mockInvoke.mockResolvedValue({ '/audio/kick.wav': [] })
    const hook = renderHook(() => usePoolUsage('/set/AUDIO'))
    await waitFor(() => expect(hook.result.current.usageLoading).toBe(false))
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    act(() => invalidatePoolUsage('/other-set/AUDIO'))
    // No re-fetch: this pool's cache is untouched.
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('returns an empty map without calling invoke when poolPath is not set', () => {
    const hook = renderHook(() => usePoolUsage(undefined))
    expect(hook.result.current.usageMap).toEqual({})
    expect(hook.result.current.usageLoading).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('renamePoolUsage', () => {
  const entry = { project: 'PROJ1', project_path: '/set/PROJ1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true, slot: null }

  it('moves a file\'s usage onto its new path without refetching', async () => {
    mockInvoke.mockResolvedValue({ '/set/audio/kick.wav': [entry], '/set/audio/snare.wav': [] })
    const { result } = renderHook(() => usePoolUsage('/set/AUDIO'))
    await waitFor(() => expect(result.current.usageLoading).toBe(false))
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    act(() => renamePoolUsage('/set/AUDIO', '/set/AUDIO/kick.wav', '/set/AUDIO/boom.wav'))

    // Re-keyed in place: the badge is correct immediately, no set-wide rescan.
    expect(result.current.usageMap).toEqual({ '/set/audio/boom.wav': [entry], '/set/audio/snare.wav': [] })
    expect(result.current.usageLoading).toBe(false)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('drops the old key for a file that had no usage at all', async () => {
    mockInvoke.mockResolvedValue({ '/set/audio/snare.wav': [] })
    const { result } = renderHook(() => usePoolUsage('/set/AUDIO'))
    await waitFor(() => expect(result.current.usageLoading).toBe(false))

    act(() => renamePoolUsage('/set/AUDIO', '/set/AUDIO/kick.wav', '/set/AUDIO/boom.wav'))
    expect(result.current.usageMap).toEqual({ '/set/audio/snare.wav': [] })
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('does nothing when that pool was never scanned', () => {
    expect(() => renamePoolUsage('/other/AUDIO', '/other/AUDIO/a.wav', '/other/AUDIO/b.wav')).not.toThrow()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
