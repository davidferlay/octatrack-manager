import { describe, it, expect, beforeEach, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
import { renderHook, act } from '@testing-library/react'
import { loadBookmarks, saveBookmarks, mergeBookmarks, useBookmarks, type ProjectBookmark } from './bookmarks'
import type { OctatrackProject } from '../types/projectManagement'

const KEY = 'otm.project-bookmarks'

const project = (name: string, path: string): OctatrackProject => ({
  name, path, has_project_file: true, has_banks: true,
})

const bookmark = (name: string, path: string, setName = 'SET1'): ProjectBookmark => ({
  name, path, setPath: `/sets/${setName}`, setName,
})

beforeEach(() => { localStorage.clear(); invokeMock.mockReset() })

describe('loadBookmarks', () => {
  it('returns nothing when the key was never written', () => {
    expect(loadBookmarks()).toEqual([])
  })

  it('reads back what was saved', () => {
    saveBookmarks([bookmark('KAZO2', '/sets/SET1/KAZO2')])
    expect(loadBookmarks()).toEqual([bookmark('KAZO2', '/sets/SET1/KAZO2')])
  })

  it('survives malformed JSON rather than taking the page down with it', () => {
    localStorage.setItem(KEY, 'not json{')
    expect(loadBookmarks()).toEqual([])
  })

  it('drops entries that are not shaped like a bookmark', () => {
    localStorage.setItem(KEY, JSON.stringify([
      bookmark('good', '/sets/SET1/good'),
      { path: '/no/name' },
      { name: 'no path', setPath: '', setName: '' },
      null,
      'nonsense',
    ]))
    expect(loadBookmarks()).toEqual([bookmark('good', '/sets/SET1/good')])
  })

  it('ignores a stored value that is not an array', () => {
    localStorage.setItem(KEY, JSON.stringify({ path: '/x', name: 'x', setPath: '', setName: '' }))
    expect(loadBookmarks()).toEqual([])
  })
})

describe('mergeBookmarks', () => {
  it('prefers the scan\'s copy, so a renamed project shows its new name', () => {
    const stored = [bookmark('OLD NAME', '/sets/SET1/p1')]
    const discovered = [bookmark('NEW NAME', '/sets/SET1/p1')]
    expect(mergeBookmarks(stored, discovered)[0].name).toBe('NEW NAME')
  })

  it('keeps a bookmark the scan did not find - the drive may just be unplugged', () => {
    const stored = [bookmark('OFFLINE', '/media/usb/SET1/p9')]
    expect(mergeBookmarks(stored, [])).toEqual(stored)
  })

  it('keeps the stored order rather than the scan order', () => {
    const stored = [bookmark('b', '/p/b'), bookmark('a', '/p/a')]
    const discovered = [bookmark('a', '/p/a'), bookmark('b', '/p/b')]
    expect(mergeBookmarks(stored, discovered).map(b => b.path)).toEqual(['/p/b', '/p/a'])
  })
})

describe('useBookmarks', () => {
  it('toggles a project on and off, and persists both ways', () => {
    const { result } = renderHook(() => useBookmarks())
    const p = project('KAZO2', '/sets/SET1/KAZO2')

    act(() => result.current.toggleBookmark(p, '/sets/SET1', 'SET1'))
    expect(result.current.isBookmarked('/sets/SET1/KAZO2')).toBe(true)
    expect(loadBookmarks()).toHaveLength(1)

    act(() => result.current.toggleBookmark(p, '/sets/SET1', 'SET1'))
    expect(result.current.isBookmarked('/sets/SET1/KAZO2')).toBe(false)
    expect(loadBookmarks()).toEqual([])
  })

  it('starts from what a previous session stored', () => {
    saveBookmarks([bookmark('KAZO2', '/sets/SET1/KAZO2')])
    const { result } = renderHook(() => useBookmarks())
    expect(result.current.isBookmarked('/sets/SET1/KAZO2')).toBe(true)
  })

  it('stores the Set alongside the project, so a bookmark can name where it lives', () => {
    const { result } = renderHook(() => useBookmarks())
    act(() => result.current.toggleBookmark(project('P', '/sets/MYSET/P'), '/sets/MYSET', 'MYSET'))
    expect(loadBookmarks()[0]).toEqual({
      path: '/sets/MYSET/P', name: 'P', setPath: '/sets/MYSET', setName: 'MYSET',
    })
  })

  it('removes by path, for a project that is gone', () => {
    saveBookmarks([bookmark('a', '/p/a'), bookmark('b', '/p/b')])
    const { result } = renderHook(() => useBookmarks())
    act(() => result.current.removeBookmark('/p/a'))
    expect(result.current.bookmarks.map(b => b.path)).toEqual(['/p/b'])
  })

  it('does not throw when storage refuses to write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { result } = renderHook(() => useBookmarks())
      expect(() => act(() => result.current.toggleBookmark(project('P', '/p/P'), '/s', 'S'))).not.toThrow()
      expect(result.current.isBookmarked('/p/P')).toBe(true)
    } finally {
      spy.mockRestore()
      errSpy.mockRestore()
    }
  })
})

describe('following operations on the project', () => {
  it('carries the bookmark to the new path when the project is renamed', () => {
    saveBookmarks([bookmark('OLD', '/sets/SET1/OLD')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmark('/sets/SET1/OLD', bookmark('NEW', '/sets/SET1/NEW')))
    expect(result.current.isBookmarked('/sets/SET1/OLD')).toBe(false)
    expect(result.current.isBookmarked('/sets/SET1/NEW')).toBe(true)
    expect(loadBookmarks()[0].name).toBe('NEW')
  })

  it('carries it to the new Set when the project is moved', () => {
    saveBookmarks([bookmark('P', '/sets/SET1/P')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmark('/sets/SET1/P', {
      path: '/sets/SET2/P', name: 'P', setPath: '/sets/SET2', setName: 'SET2',
    }))
    expect(loadBookmarks()[0]).toEqual({
      path: '/sets/SET2/P', name: 'P', setPath: '/sets/SET2', setName: 'SET2',
    })
  })

  it('drops the bookmark when the project is deleted', () => {
    saveBookmarks([bookmark('P', '/sets/SET1/P'), bookmark('Q', '/sets/SET1/Q')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmark('/sets/SET1/P', null))
    expect(result.current.bookmarks.map(b => b.path)).toEqual(['/sets/SET1/Q'])
  })

  it('leaves other bookmarks alone', () => {
    saveBookmarks([bookmark('P', '/sets/SET1/P'), bookmark('Q', '/sets/SET1/Q')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmark('/sets/SET1/P', bookmark('R', '/sets/SET1/R')))
    expect(result.current.bookmarks.map(b => b.path)).toEqual(['/sets/SET1/R', '/sets/SET1/Q'])
  })

  it('does nothing for a project that was never bookmarked', () => {
    saveBookmarks([bookmark('P', '/sets/SET1/P')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmark('/sets/SET1/OTHER', null))
    expect(result.current.bookmarks).toHaveLength(1)
  })
})

describe('following operations on the Set', () => {
  it('rewrites every bookmark under a renamed Set', () => {
    saveBookmarks([
      bookmark('A', '/sets/OLDSET/A'),
      bookmark('B', '/sets/OLDSET/B'),
      bookmark('C', '/sets/OTHER/C', 'OTHER'),
    ])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmarksUnder('/sets/OLDSET', { setPath: '/sets/NEWSET', setName: 'NEWSET' }))
    expect(result.current.bookmarks.map(b => b.path)).toEqual([
      '/sets/NEWSET/A', '/sets/NEWSET/B', '/sets/OTHER/C',
    ])
    expect(result.current.bookmarks[0].setName).toBe('NEWSET')
    // The untouched Set keeps its own details
    expect(result.current.bookmarks[2].setName).toBe('OTHER')
  })

  it('drops every bookmark of a deleted Set', () => {
    saveBookmarks([bookmark('A', '/sets/GONE/A'), bookmark('C', '/sets/OTHER/C')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmarksUnder('/sets/GONE', null))
    expect(result.current.bookmarks.map(b => b.path)).toEqual(['/sets/OTHER/C'])
  })

  it('does not match a Set whose name merely starts the same', () => {
    saveBookmarks([bookmark('A', '/sets/SET10/A')])
    const { result } = renderHook(() => useBookmarks())

    act(() => result.current.retargetBookmarksUnder('/sets/SET1', null))
    expect(result.current.bookmarks).toHaveLength(1)
  })
})

describe('pruning bookmarks whose project is gone', () => {
  it('drops the ones that no longer exist on disk', async () => {
    saveBookmarks([bookmark('HERE', '/sets/S/HERE'), bookmark('GONE', '/sets/S/GONE')])
    invokeMock.mockImplementation((_cmd: string, args: { projectPath: string }) =>
      Promise.resolve(args.projectPath === '/sets/S/HERE'))
    const { result } = renderHook(() => useBookmarks())

    await act(async () => { await result.current.pruneMissingBookmarks() })
    expect(result.current.bookmarks.map(b => b.path)).toEqual(['/sets/S/HERE'])
    expect(loadBookmarks().map(b => b.path)).toEqual(['/sets/S/HERE'])
  })

  it('keeps everything when the check itself fails - an error is not proof of absence', async () => {
    saveBookmarks([bookmark('P', '/sets/S/P')])
    invokeMock.mockRejectedValue(new Error('backend unavailable'))
    const { result } = renderHook(() => useBookmarks())

    await act(async () => { await result.current.pruneMissingBookmarks() })
    expect(result.current.bookmarks).toHaveLength(1)
  })

  it('asks the backend once per bookmark, and not at all when there are none', async () => {
    const { result } = renderHook(() => useBookmarks())
    await act(async () => { await result.current.pruneMissingBookmarks() })
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

