import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { readPoolDir, writePoolDir } from './poolDir'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('poolDir', () => {
  it('starts at the pool root when nothing was remembered', () => {
    expect(readPoolDir('/set/AUDIO')).toBe('/set/AUDIO')
  })

  it('round-trips the browsed directory', () => {
    writePoolDir('/set/AUDIO', '/set/AUDIO/Drums/909')
    expect(readPoolDir('/set/AUDIO')).toBe('/set/AUDIO/Drums/909')
  })

  it('keys by pool, so page and pane share one location and other pools do not', () => {
    writePoolDir('/set/AUDIO', '/set/AUDIO/Drums')
    expect(readPoolDir('/other/AUDIO')).toBe('/other/AUDIO')
  })

  it('falls back to the root for a directory outside the pool', () => {
    sessionStorage.setItem('poolDir:/set/AUDIO', '/somewhere/else')
    expect(readPoolDir('/set/AUDIO')).toBe('/set/AUDIO')
  })

  it('ignores an empty pool path instead of writing a stray key', () => {
    writePoolDir('', '/set/AUDIO')
    expect(sessionStorage.length).toBe(0)
    expect(readPoolDir('')).toBe('')
  })

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => writePoolDir('/set/AUDIO', '/set/AUDIO/Drums')).not.toThrow()
    expect(readPoolDir('/set/AUDIO')).toBe('/set/AUDIO')
  })
})
