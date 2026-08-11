import { test, expect } from '@playwright/test'

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
