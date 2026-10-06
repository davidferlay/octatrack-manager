import { test, expect, Page } from '@playwright/test'

interface MockSet {
  name: string
  path: string
  has_audio_pool: boolean
  projects: { name: string; path: string; has_project_file: boolean; has_banks: boolean }[]
}

const initialState = {
  setA: {
    name: 'SetA',
    path: '/mock/SetA',
    has_audio_pool: true,
    projects: [
      { name: 'PROJ_A', path: '/mock/SetA/PROJ_A', has_project_file: true, has_banks: true },
      { name: 'PROJ_B', path: '/mock/SetA/PROJ_B', has_project_file: true, has_banks: true },
    ],
  } as MockSet,
  setB: {
    name: 'SetB',
    path: '/mock/SetB',
    has_audio_pool: true,
    projects: [
      { name: 'PROJ_C', path: '/mock/SetB/PROJ_C', has_project_file: true, has_banks: true },
    ],
  } as MockSet,
}

async function setupTauriMocks(page: Page) {
  await page.addInitScript((state) => {
    let currentState = JSON.parse(JSON.stringify(state)) as typeof state
    // Mock event plugin internals for listen/unlisten
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    }
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: (cb: any) => {
        // Return a callback ID (just a number)
        return 0
      },
      invoke: async (cmd: string, args: any) => {
        // Handle Tauri internal event plugin commands
        if (cmd === 'plugin:event|listen') {
          return 0 // return a listener id
        }
        if (cmd === 'plugin:event|unlisten') {
          return null
        }
        switch (cmd) {
          case 'scan_devices':
            return {
              locations: [
                {
                  name: 'TestLoc',
                  path: '/mock',
                  device_type: 'LocalCopy',
                  sets: Object.values(currentState),
                },
              ],
              standalone_projects: [],
            }
          case 'create_project': {
            const set = Object.values(currentState).find((s) => s.path === args.setPath)!
            const newPath = `${args.setPath}/${args.name}`
            set.projects.push({
              name: args.name,
              path: newPath,
              has_project_file: true,
              has_banks: true,
            })
            return newPath
          }
          case 'project_exists':
            // A bookmark is pruned when its project is no longer on disk
            return Object.values(currentState)
              .flatMap((s) => s.projects)
              .some((p) => p.path === args.projectPath)
          case 'delete_project': {
            for (const s of Object.values(currentState)) {
              s.projects = s.projects.filter((p) => p.path !== args.projectPath)
            }
            return null
          }
          case 'rename_project': {
            for (const s of Object.values(currentState)) {
              const p = s.projects.find((pr) => pr.path === args.projectPath)
              if (p) {
                p.name = args.newName
                p.path = `${s.path}/${args.newName}`
                return p.path
              }
            }
            throw new Error('Not found')
          }
          case 'copy_project_with_progress': {
            const src = Object.values(currentState)
              .flatMap((s) => s.projects)
              .find((p) => p.path === args.srcPath)!
            const dest = Object.values(currentState).find((s) => s.path === args.destSetPath)!
            const baseName = src.name
            let newName = baseName
            let n = 2
            while (dest.projects.some((p) => p.name === newName)) {
              newName = `${baseName}_${n}`
              n++
            }
            const newProj = {
              name: newName,
              path: `${dest.path}/${newName}`,
              has_project_file: true,
              has_banks: true,
            }
            dest.projects.push(newProj)
            return newProj.path
          }
          case 'move_project':
          case 'move_project_with_progress': {
            const dest = Object.values(currentState).find((s) => s.path === args.destSetPath)!
            for (const s of Object.values(currentState)) {
              const i = s.projects.findIndex((p) => p.path === args.srcPath)
              if (i >= 0) {
                const [moved] = s.projects.splice(i, 1)
                moved.path = `${dest.path}/${moved.name}`
                dest.projects.push(moved)
                return moved.path
              }
            }
            throw new Error('Not found')
          }
          case 'rescan_set': {
            return Object.values(currentState).find((s) => s.path === args.setPath)
          }
          case 'move_set':
          case 'move_set_with_progress': {
            // Find and remove from source location state, update path
            for (const s of Object.values(currentState)) {
              if (s.path === args.srcPath) {
                const destPath = `${args.destLocationPath}/${s.name}`
                s.path = destPath
                s.projects = s.projects.map((p) => ({
                  ...p,
                  path: `${destPath}/${p.name}`,
                }))
                return destPath
              }
            }
            throw new Error('Not found')
          }
          case 'create_set': {
            const newSet: MockSet = {
              name: args.name,
              path: `${args.locationPath}/${args.name}`,
              has_audio_pool: true,
              projects: [],
            }
            ;(currentState as any)[args.name] = newSet
            return newSet.path
          }
          case 'rename_set': {
            const set = Object.values(currentState).find((s) => s.path === args.setPath)
            if (set) {
              const parentPath = args.setPath.substring(0, args.setPath.lastIndexOf('/'))
              set.name = args.newName
              set.path = `${parentPath}/${args.newName}`
              return set.path
            }
            throw new Error('Not found')
          }
          case 'delete_set': {
            for (const key of Object.keys(currentState)) {
              if ((currentState as any)[key].path === args.setPath) {
                delete (currentState as any)[key]
                break
              }
            }
            return null
          }
          case 'copy_set': {
            const srcSet = Object.values(currentState).find((s) => s.path === args.srcPath)!
            const baseName = srcSet.name
            let newName = baseName
            let n = 2
            while (Object.values(currentState).some((s) => s.name === newName)) {
              newName = `${baseName}_${n}`
              n++
            }
            const newSet: MockSet = {
              name: newName,
              path: `${args.destLocationPath}/${newName}`,
              has_audio_pool: srcSet.has_audio_pool,
              projects: srcSet.projects.map((p) => ({
                ...p,
                path: `${args.destLocationPath}/${newName}/${p.name}`,
              })),
            }
            ;(currentState as any)[newName] = newSet
            return newSet.path
          }
          case 'cancel_copy_operation':
            return null
          default:
            return null
        }
      },
    }
  }, initialState)
}

test.beforeEach(async ({ page }) => {
  await setupTauriMocks(page)
  await page.goto('/')
  await page.getByRole('button', { name: /scan/i }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
})

// --- Bookmarks ---

test('bookmarking a project pins it to its own section, and it survives a reload', async ({ page }) => {
  await expect(page.locator('.bookmarked-projects')).toHaveCount(0)

  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()

  const section = page.locator('.bookmarked-projects')
  await expect(section).toBeVisible()
  await expect(section.getByText('PROJ_A')).toBeVisible()
  // The card names the Set it belongs to - it has no tree around it to say so
  await expect(section.locator('.bookmarked-set')).toHaveText('SetA')

  // A bookmark is there on launch, before any scan
  await page.reload()
  await expect(page.locator('.bookmarked-projects').getByText('PROJ_A')).toBeVisible()
  await expect(page.getByRole('button', { name: /scan/i })).toBeVisible()
})

test('a bookmarked project offers Unbookmark, which removes the section', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await expect(page.locator('.bookmarked-projects')).toBeVisible()

  await page.locator('.bookmarked-projects').getByText('PROJ_A').click({ button: 'right' })
  await expect(page.getByText('Unbookmark')).toBeVisible()
  await page.getByText('Unbookmark').click()
  await expect(page.locator('.bookmarked-projects')).toHaveCount(0)
})

/**
 * A bookmark is a shortcut to a project listed further down the page, and the card on
 * its own does not say where that is - its Set may not even be expanded.
 */
test('a bookmark can show where the original project lives', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()

  const section = page.locator('.bookmarked-projects')
  await section.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Show original project').click()

  // The card in the tree, not the bookmark card, and it flashes so it can be followed
  const original = page.locator('[data-project-path]')
    .filter({ has: page.getByText('PROJ_A', { exact: true }) })
    .filter({ hasNot: page.locator('.bookmarked-set') })
  await expect(original).toHaveClass(/revealed/)
  await expect(original).toBeInViewport()
})

test('showing the original opens the Set it is closed inside', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()

  /**
   * Whether the Set holding PROJ_A is expanded. Read from the app's own state rather
   * than from the card's visibility: a closed section clips its contents from an
   * ancestor, so the card keeps a box of its own and still counts as visible.
   */
  const setIsOpen = () => page.evaluate(() => {
    const card = document.querySelector('[data-project-path*="PROJ_A"]')
    return card?.closest('.sets-section')?.classList.contains('open') ?? false
  })

  // Clicked on the arrow rather than the middle of the header, which has its own controls
  await page.locator('.set-header.clickable').filter({ hasText: 'SetA' })
    .click({ position: { x: 8, y: 8 } })
  await expect.poll(setIsOpen).toBe(false)

  await page.locator('.bookmarked-projects').getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Show original project').click()

  await expect.poll(setIsOpen).toBe(true)
  await expect(page.locator('[data-project-path*="PROJ_A"]')).toHaveClass(/revealed/)
})

/**
 * A bookmark outlives the scan it came from - it is remembered across launches, while
 * the list below is whatever was scanned this time. Pointing at a project that is not
 * on the page has to say so rather than appear to do nothing.
 */
test('showing the original says so when the project is not in the list', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()

  // Back to a fresh launch. Bookmarks are kept for good; the scan results only live
  // for the session, so dropping them leaves the bookmark pointing at nothing listed.
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await expect(page.locator('[data-project-path]')).toHaveCount(0)
  await expect(page.locator('.bookmarked-projects')).toBeVisible()

  await page.locator('.bookmarked-projects').getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Show original project').click()

  const tip = page.locator('.toast-notification.tip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('Scan for projects first')
})

test('the original-project entry is only on bookmarks', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await page.keyboard.press('Escape')

  // Right-clicking the project itself - it is already where it lives
  await page.locator('[data-project-path]').filter({ hasText: 'PROJ_A' }).first()
    .click({ button: 'right' })
  await expect(page.getByText('Show original project')).toHaveCount(0)
})

test('renaming a bookmarked project carries the bookmark with it', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()

  await page.locator('.bookmarked-projects').getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/rename/i).click()
  await page.getByRole('textbox', { name: /new project name/i }).fill('RENAMED')
  await page.getByRole('button', { name: /^rename$/i }).click()

  const section = page.locator('.bookmarked-projects')
  await expect(section.getByText('RENAMED')).toBeVisible()
  await expect(section.getByText('PROJ_A')).toHaveCount(0)

  // The stored bookmark points at the new path, so a relaunch finds the project
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('otm.project-bookmarks') ?? '[]'))
  expect(stored).toHaveLength(1)
  expect(stored[0].name).toBe('RENAMED')
  expect(stored[0].path).toBe('/mock/SetA/RENAMED')
})

test('deleting a bookmarked project removes its bookmark', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await expect(page.locator('.bookmarked-projects')).toBeVisible()

  await page.locator('.bookmarked-projects').getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/delete/i).click()
  await page.getByRole('button', { name: /^delete$/i }).click()

  await expect(page.locator('.bookmarked-projects')).toHaveCount(0)
})

test('a bookmark whose project vanished outside the app is discarded on launch', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await expect(page.locator('.bookmarked-projects')).toBeVisible()

  // Same stored bookmark, but the project is no longer anywhere on disk
  await page.evaluate(() => {
    localStorage.setItem('otm.project-bookmarks', JSON.stringify([
      { path: '/gone/SetX/VANISHED', name: 'VANISHED', setPath: '/gone/SetX', setName: 'SetX' },
    ]))
  })
  await page.reload()
  await expect(page.locator('.bookmarked-projects')).toHaveCount(0)
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('otm.project-bookmarks'))).toBe('[]')
})

test('renaming the Set carries its bookmarks with it', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await expect(page.locator('.bookmarked-projects .bookmarked-set')).toHaveText('SetA')

  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/rename set/i).click()
  await page.getByRole('textbox', { name: /new project name/i }).fill('NEWSET')
  await page.getByRole('button', { name: /^rename$/i }).click()

  // The project did not move or change name, so its bookmark must survive the Set rename
  const section = page.locator('.bookmarked-projects')
  await expect(section.getByText('PROJ_A')).toBeVisible()
  await expect(section.locator('.bookmarked-set')).toHaveText('NEWSET')

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('otm.project-bookmarks') ?? '[]'))
  expect(stored[0].path).toBe('/mock/NEWSET/PROJ_A')
  expect(stored[0].setPath).toBe('/mock/NEWSET')
})

test('deleting the Set drops the bookmarks of the projects inside it', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await expect(page.locator('.bookmarked-projects .project-card')).toHaveCount(1)

  // SetB starts collapsed, so its projects are clipped until it is opened
  const setB = page.locator('.set-card')
    .filter({ has: page.locator('.set-name', { hasText: 'SetB' }) })
  await setB.locator('.set-header').click()
  await setB.getByText('PROJ_C').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await expect(page.locator('.bookmarked-projects .project-card')).toHaveCount(2)

  // SetA goes, taking PROJ_A with it - PROJ_C lives in SetB and must stay
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete Set' }).click()
  await page.getByRole('button', { name: /^delete$/i }).click()

  const section = page.locator('.bookmarked-projects')
  await expect(section.getByText('PROJ_A')).toHaveCount(0)
  await expect(section.getByText('PROJ_C')).toBeVisible()
})

test('a bookmarked card opens the project', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText('Bookmark', { exact: true }).click()
  await page.locator('.bookmarked-projects').getByText('PROJ_A').click()
  await expect.poll(() => page.url()).toContain('/project?')
})

// --- Project operations ---

test('create project via + card', async ({ page }) => {
  await page.getByLabel('New project in SetA').click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('NEW_ONE')
  await page.getByRole('button', { name: /^create$/i }).click()
  await expect(page.getByText('NEW_ONE')).toBeVisible()
})

test('create project silently filters invalid chars', async ({ page }) => {
  await page.getByLabel('New project in SetA').click()
  const input = page.getByRole('textbox', { name: 'Project name' })
  // Type text with invalid char — € should be silently removed
  await input.pressSequentially('BAD€OK')
  await expect(input).toHaveValue('BADOK')
})

test('rename via context menu', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/rename/i).click()
  const input = page.getByRole('textbox', { name: /new project name/i })
  await input.fill('RENAMED')
  await page.getByRole('button', { name: /^rename$/i }).click()
  await expect(page.getByText('RENAMED')).toBeVisible()
  await expect(page.getByText('PROJ_A')).not.toBeVisible()
})

test('delete with confirmation dialog', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/delete/i).click()
  await expect(page.getByText(/cannot be undone/i)).toBeVisible()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByText('PROJ_A')).not.toBeVisible()
})

test('delete cancellation keeps project', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/delete/i).click()
  await page.getByRole('button', { name: /cancel/i }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
})

test('copy + paste produces _2 suffix', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/paste/i).click()
  await expect(page.getByText('PROJ_A_2')).toBeVisible()
})

test('keyboard: Delete key opens confirmation', async ({ page }) => {
  // Focus the project-card div, not the inner text
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('Delete')
  await expect(page.getByText(/cannot be undone/i)).toBeVisible()
})

test('keyboard: F2 opens rename modal', async ({ page }) => {
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: /new project name/i })).toBeVisible()
})

test('copy shows confirmation toast', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.locator('.toast-notification')).toContainText('PROJ_A')
})

test('context menu on set-card header shows set actions', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await expect(page.getByRole('button', { name: 'Copy Set' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rename Set' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete Set' })).toBeVisible()
})

test('keyboard: Ctrl+C then Ctrl+V on Set grid pastes', async ({ page }) => {
  // First, open SetB by clicking its header
  await page.locator('.set-header').nth(1).click()
  await expect(page.getByText('PROJ_C')).toBeVisible()

  // Focus the project card (not inner text) and copy
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('Control+c')

  // Focus a card in SetB and paste
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_C' }).first().focus()
  await page.keyboard.press('Control+v')

  // PROJ_A pasted into SetB; in this mock state, name is unique so no _2 suffix.
  await expect(page.locator('.project-card', { hasText: 'PROJ_A' })).toHaveCount(2)
})

// --- Set operations ---

test('context menu on set header shows set operations', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await expect(page.getByText(/copy set/i)).toBeVisible()
  await expect(page.getByText(/rename set/i)).toBeVisible()
  await expect(page.getByText(/delete set/i)).toBeVisible()
})

test('rename set via context menu', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/rename set/i).click()
  const input = page.getByRole('textbox', { name: /new project name/i })
  await input.fill('NEWSET')
  await page.getByRole('button', { name: /^rename$/i }).click()
  await expect(page.locator('.set-name', { hasText: 'NEWSET' })).toBeVisible()
  await expect(page.locator('.set-name', { hasText: 'SetA' })).not.toBeVisible()
})

test('delete set via context menu', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete Set' }).click()
  await expect(page.getByRole('button', { name: /^delete$/i })).toBeVisible()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.locator('.set-name', { hasText: 'SetA' })).not.toBeVisible()
})

test('delete set cancellation keeps set', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/delete set/i).click()
  await page.getByRole('button', { name: /cancel/i }).click()
  await expect(page.locator('.set-name', { hasText: 'SetA' })).toBeVisible()
})

test('create set via location context menu', async ({ page }) => {
  await page.locator('.location-header').first().click({ button: 'right' })
  await page.getByText(/new set/i).click()
  const input = page.getByRole('textbox', { name: 'Set name' })
  await input.fill('BRAND_NEW')
  await page.getByRole('button', { name: /^create$/i }).click()
  await expect(page.locator('.set-name', { hasText: 'BRAND_NEW' })).toBeVisible()
})

test('copy set shows toast', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/copy set/i).click()
  await expect(page.locator('.toast-notification')).toContainText('SetA')
})

test('location context menu shows paste set when set copied', async ({ page }) => {
  // Copy a set first
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/copy set/i).click()
  // Right-click location header
  await page.locator('.location-header').first().click({ button: 'right' })
  await expect(page.getByText(/paste set/i)).toBeVisible()
})
