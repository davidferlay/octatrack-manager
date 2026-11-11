import { describe, it, expect } from 'vitest'
import { shortcutsFor } from './shortcuts'

const titles = (groups: ReturnType<typeof shortcutsFor>) => groups.map(g => g.title)
const actions = (groups: ReturnType<typeof shortcutsFor>) => groups.flatMap(g => g.rows.map(r => `${r.keys} | ${r.action}`))

describe('the shortcuts listed for each page', () => {
  it('the page comes first, then what works everywhere', () => {
    const groups = shortcutsFor('home')
    expect(titles(groups)).toEqual(['Projects list', 'Everywhere'])
    expect(actions(groups)).toContain('Ctrl + F | Search the projects')
  })

  it('everywhere includes the zoom and this window itself', () => {
    const everywhere = shortcutsFor('home').find(g => g.title === 'Everywhere')!
    expect(everywhere.rows.map(r => r.keys)).toEqual(expect.arrayContaining(['Ctrl + / - / 0', '?', 'Escape']))
  })

  it('on AZERTY, says , for ?, alone or with Cmd for Ctrl', () => {
    for (const mac of [false, true]) {
      const keys = shortcutsFor('home', undefined, mac, true).flatMap(g => g.rows.map(r => r.keys))
      expect(keys).toContain(',')
      expect(keys).not.toContain('?')
      expect(keys).toContain(mac ? 'Cmd + F' : 'Ctrl + F')
    }
  })

  it('a project lists what the open tab offers, then the whole project page', () => {
    expect(titles(shortcutsFor('project', 'flex-slots'))).toEqual(['Sample slots', 'Sample preview', 'Project', 'Everywhere'])
    expect(titles(shortcutsFor('project', 'parts'))).toEqual(['Parts', 'Project', 'Everywhere'])
    expect(titles(shortcutsFor('project', 'tools'))).toEqual(['Tools', 'Project', 'Everywhere'])
    // A tab with nothing of its own shows the project and global lists only
    expect(titles(shortcutsFor('project', 'overview'))).toEqual(['Project', 'Everywhere'])
  })

  it('names the keys each tab really uses', () => {
    expect(actions(shortcutsFor('project', 'parts'))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^D \| /),
      expect.stringMatching(/^E \| /),
    ]))
    expect(actions(shortcutsFor('project', 'static-slots'))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Space \| /),
      expect.stringMatching(/^Delete \| /),
      expect.stringMatching(/^Shift \+ click \| /),
    ]))
  })

  it('the Audio Pool page has its own list', () => {
    expect(titles(shortcutsFor('audio-pool'))).toEqual(['Audio Pool', 'Sample preview', 'Everywhere'])
    expect(actions(shortcutsFor('audio-pool'))).toEqual(expect.arrayContaining([expect.stringMatching(/^B \| /)]))
  })

  it('says Cmd instead of Ctrl on macOS', () => {
    expect(actions(shortcutsFor('home', undefined, true))).toContain('Cmd + F | Search the projects')
    expect(actions(shortcutsFor('home', undefined, true))).not.toEqual(expect.arrayContaining([expect.stringMatching(/Ctrl/)]))
  })
})
