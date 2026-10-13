import { test, expect, Page } from '@playwright/test'

test.describe('HomePage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Individual Projects groups are ordered by how many projects they hold', async ({ page }) => {
    // Group sizes deliberately out of path order: sorting by full path put a
    // 5-project folder above a 25-project one, which reads as arbitrary when
    // the header shows only the leaf name.
    await page.addInitScript(() => {
      const mk = (dir: string, n: number) =>
        Array.from({ length: n }, (_, i) => ({
          name: `P${i}`, path: `${dir}/P${i}`, has_project_file: true, has_banks: true,
        }))
      ;(window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === 'scan_devices') {
            return {
              locations: [],
              standalone_projects: [
                ...mk('/home/u/aaa-small', 2),
                ...mk('/home/u/zzz-big', 9),
                ...mk('/home/u/mmm-medium', 5),
                // Same size as mmm-medium: ties fall back to the shown name.
                ...mk('/home/u/bbb-medium', 5),
              ],
            }
          }
          return null
        },
      }
    })
    await page.reload()
    await page.getByRole('button', { name: /Scan/i }).first().click()

    const headers = page.locator('.standalone-group .standalone-group-header, .standalone-group > div').filter({ hasText: /- \d+ projects?/ })
    await expect(headers.first()).toBeVisible({ timeout: 10000 })
    const texts = (await headers.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())
    // Headers are uppercased by CSS; innerText reflects that.
    expect(texts).toEqual([
      'ZZZ-BIG- 9 projects',
      'BBB-MEDIUM- 5 projects',
      'MMM-MEDIUM- 5 projects',
      'AAA-SMALL- 2 projects',
    ])
  })

  test('has title and subtitle', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Octatrack Manager' })).toBeVisible()
    await expect(page.getByText('Discover and manage your Elektron Octatrack projects')).toBeVisible()
  })

  test('has scan button', async ({ page }) => {
    const scanButton = page.getByRole('button', { name: 'Scan for Projects' })
    await expect(scanButton).toBeVisible()
    await expect(scanButton).toBeEnabled()
  })

  test('has browse button', async ({ page }) => {
    const browseButton = page.getByRole('button', { name: 'Browse...' })
    await expect(browseButton).toBeVisible()
    await expect(browseButton).toBeEnabled()
  })

  test('has refresh button', async ({ page }) => {
    const refreshButton = page.locator('button[title="Refresh projects list"]')
    await expect(refreshButton).toBeVisible()
  })

  test('has version display', async ({ page }) => {
    // Version component should be present
    const versionElement = page.locator('.app-version-container')
    await expect(versionElement).toBeVisible()
  })

  test('scan button shows scanning state when clicked', async ({ page }) => {
    const scanButton = page.getByRole('button', { name: 'Scan for Projects' })

    // Click and check for loading state (will quickly fail since Tauri isn't available)
    await scanButton.click()

    // The button should briefly show "Scanning..." or error out
    // Since we're in browser-only mode, we just verify the button is clickable
    await expect(scanButton).toBeVisible()
  })

  test('search filters the project list and restores collapse state when cleared', async ({ page }) => {
    await page.addInitScript(() => {
      const proj = (name: string, dir: string) => ({
        name, path: `${dir}/${name}`, has_project_file: true, has_banks: true,
      })
      ;(window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === 'scan_devices') {
            return {
              locations: [{
                name: 'OCTATRACK', path: '/media', device_type: 'CompactFlash',
                sets: [
                  { name: 'DrumSet', path: '/media/OCTATRACK/DrumSet', has_audio_pool: true,
                    projects: [proj('KICKS_2024', '/media/OCTATRACK/DrumSet'),
                               proj('bassline-01', '/media/OCTATRACK/DrumSet')] },
                  { name: 'PadSet', path: '/media/OCTATRACK/PadSet', has_audio_pool: true,
                    projects: [proj('pads-v3', '/media/OCTATRACK/PadSet')] },
                ],
              }],
              standalone_projects: [],
            }
          }
          return null
        },
      }
    })
    await page.reload()
    await page.getByRole('button', { name: /Scan/i }).first().click()

    const search = page.getByLabel('Search projects')
    await expect(search).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('PadSet')).toBeVisible()

    // A Set with no matching project disappears; the one that matches auto-expands,
    // so the hit is visible without clicking anything open.
    await search.fill('kick')
    await expect(page.getByText('KICKS_2024')).toBeVisible()
    await expect(page.getByText('bassline-01')).toHaveCount(0)
    await expect(page.getByText('PadSet')).toHaveCount(0)

    // Clearing restores the full list.
    await search.fill('')
    await expect(page.getByText('PadSet')).toBeVisible()
  })

  test('group headers still collapse and expand while a search is active', async ({ page }) => {
    await page.addInitScript(() => {
      const proj = (name: string, dir: string) => ({
        name, path: `${dir}/${name}`, has_project_file: true, has_banks: true,
      })
      ;(window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === 'scan_devices') {
            return {
              locations: [{
                name: 'OCTATRACK', path: '/media', device_type: 'CompactFlash',
                sets: [
                  { name: 'DrumSet', path: '/media/OCTATRACK/DrumSet', has_audio_pool: true,
                    projects: [proj('KICKS_2024', '/media/OCTATRACK/DrumSet')] },
                ],
              }],
              standalone_projects: [proj('kick-standalone', '/other')],
            }
          }
          return null
        },
      }
    })
    await page.reload()
    await page.getByRole('button', { name: /Scan/i }).first().click()

    const search = page.getByLabel('Search projects')
    await expect(search).toBeVisible({ timeout: 10000 })
    await search.fill('kick')

    // The search opens every group, so both hits are visible up front.
    await expect(page.getByText('KICKS_2024')).toBeVisible()
    await expect(page.getByText('kick-standalone')).toBeVisible()

    // Collapsing a group mid-search used to be ignored: searchActive was OR-ed
    // into every open test, so the header toggled state nothing looked at. A
    // collapsed section keeps its box (0fr grid row plus opacity), so assert the
    // state the class and caret carry rather than Playwright visibility.
    const locationsHeader = page.locator('h2.clickable', { hasText: /Location/ })
    const locationsSection = locationsHeader.locator('xpath=following-sibling::div[1]')
    await expect(locationsSection).toHaveClass(/open/)

    await locationsHeader.click()
    await expect(locationsSection).toHaveClass(/closed/)
    await expect(locationsHeader).toContainText('\u25b6')

    await locationsHeader.click()
    await expect(locationsSection).toHaveClass(/open/)
    await expect(locationsHeader).toContainText('\u25bc')

    const individualHeader = page.locator('h2.clickable', { hasText: /Individual Project/ })
    const individualSection = individualHeader.locator('xpath=following-sibling::div[1]')
    await expect(individualSection).toHaveClass(/open/)
    await individualHeader.click()
    await expect(individualSection).toHaveClass(/closed/)

    // A Set inside a Location collapses too.
    const setSection = page.locator('.set-card', { hasText: 'DrumSet' }).locator('.sets-section')
    await expect(setSection).toHaveClass(/open/)
    await page.locator('.set-header', { hasText: 'DrumSet' }).click()
    await expect(setSection).toHaveClass(/closed/)
  })

  test('Ctrl+F focuses the project search box', async ({ page }) => {
    // Wait for the input to exist: pressing straight after goto() races the mount that
    // installs the keydown listener, and the press is silently lost.
    const search = page.getByLabel('Search projects')
    await expect(search).toBeVisible()

    await page.keyboard.press('Control+f')

    await expect(search).toBeFocused()
  })
})

test.describe('Navigation', () => {
  test('project route exists', async ({ page }) => {
    await page.goto('/#/project?path=test&name=test')
    // Page should render its main content without crashing
    await expect(page.locator('main.container')).toBeVisible()
  })

  test('audio pool route exists', async ({ page }) => {
    await page.goto('/#/audio-pool?path=test&name=test')
    // Page should render its main content without crashing
    await expect(page.locator('main.audio-pool-page')).toBeVisible()
  })

  test('can navigate back to home', async ({ page }) => {
    await page.goto('/#/project?path=test&name=test')
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Octatrack Manager' })).toBeVisible()
  })
})

test.describe('Accessibility', () => {
  test('buttons are keyboard accessible', async ({ page }) => {
    await page.goto('/')

    // Tab to scan button and verify focus
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Should be able to interact with buttons via keyboard
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })

  test('page has no obvious accessibility issues', async ({ page }) => {
    await page.goto('/')

    // Basic checks
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})



/**
 * Renaming moves the directory, so the list has to follow it.
 *
 * It used to follow by rescanning the Set, which is refused for anything whose parent
 * is not one - every project outside a Set - and the refusal was swallowed. The card
 * kept pointing at a directory that no longer existed, and opening it reported
 * "No project file found" while the device opened the project perfectly well.
 */
test.describe('Home - renaming a project', () => {
  const setup = async (page: Page, options: { inASet: boolean; rescanWorks: boolean }) => {
    await page.addInitScript((opts: { inASet: boolean; rescanWorks: boolean }) => {
      const calls: { cmd: string; args: any }[] = []
      ;(window as any).__invokeCalls = calls
      const project = {
        name: 'PROJ', path: '/media/HOLDER/PROJ', has_audio_pool: false,
        sample_count: 0, missing_count: 0, size_bytes: 0,
      }
      ;(window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string, args?: any) => {
          calls.push({ cmd, args })
          if (cmd === 'scan_devices') {
            return opts.inASet
              ? {
                locations: [{
                  name: 'OCTATRACK', path: '/media', device_type: 'CompactFlash',
                  sets: [{
                    name: 'HOLDER', path: '/media/HOLDER', has_audio_pool: true,
                    projects: [project],
                  }],
                }],
                standalone_projects: [],
              }
              : { locations: [], standalone_projects: [project] }
          }
          if (cmd === 'rename_project') return `/media/HOLDER/${args.newName}`
          if (cmd === 'rescan_set') {
            // What the backend answers for a parent that is not a Set
            if (!opts.rescanWorks) throw new Error('Path is not a valid Octatrack Set')
            return {
              name: 'HOLDER', path: '/media/HOLDER', has_audio_pool: true,
              projects: [{ ...project, name: 'PROJ=', path: '/media/HOLDER/PROJ=' }],
            }
          }
          return null
        },
      }
      ;(window as any).__TAURI__ = { invoke: (window as any).__TAURI_INTERNALS__.invoke }
    }, options)
    await page.goto('/')
    await page.getByRole('button', { name: /Scan/i }).first().click()
    await expect(page.locator('.project-card').first()).toBeVisible()
  }

  const renameTo = async (page: Page, name: string) => {
    await page.locator('.project-card').first().click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: /Rename/i }).click()
    await page.locator('input[type="text"]').last().fill(name)
    await page.getByRole('button', { name: /^Rename$/ }).click()
  }

  const openedPath = async (page: Page) => {
    await page.locator('.project-card').first().click()
    await expect.poll(async () => (await page.evaluate(() =>
      (window as any).__invokeCalls.filter((c: any) => c.cmd === 'load_project_metadata')
    )).length).toBeGreaterThan(0)
    const calls = await page.evaluate(() => (window as any).__invokeCalls
      .filter((c: any) => c.cmd === 'load_project_metadata'))
    return calls[calls.length - 1].args.path
  }

  test('a project outside a Set opens at its new path', async ({ page }) => {
    await setup(page, { inASet: false, rescanWorks: false })
    await renameTo(page, 'PROJ=')
    await expect(page.locator('.project-card').first()).toContainText('PROJ=')
    expect(await openedPath(page)).toBe('/media/HOLDER/PROJ=')
  })

  test('a project inside a Set opens at its new path', async ({ page }) => {
    await setup(page, { inASet: true, rescanWorks: true })
    await renameTo(page, 'PROJ=')
    expect(await openedPath(page)).toBe('/media/HOLDER/PROJ=')
  })

  /** The name is legal on the device, so it must survive the round trip intact. */
  test('a name ending in = survives being opened', async ({ page }) => {
    await setup(page, { inASet: false, rescanWorks: false })
    await renameTo(page, 'PROJ=')
    expect(await openedPath(page)).toBe('/media/HOLDER/PROJ=')
    expect(page.url()).toContain('PROJ%3D')
  })

  test('the new name is what the list shows', async ({ page }) => {
    await setup(page, { inASet: false, rescanWorks: false })
    await renameTo(page, 'RENAMED')
    await expect(page.locator('.project-card').first()).toContainText('RENAMED')
    expect(await openedPath(page)).toBe('/media/HOLDER/RENAMED')
  })
})
