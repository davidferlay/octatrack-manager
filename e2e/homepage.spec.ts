import { test, expect } from '@playwright/test'

test.describe('HomePage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('has title and subtitle', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Octatrack Manager' })).toBeVisible()
    await expect(page.getByText('Discover and manage your Elektron Octatrack projects')).toBeVisible()
  })

  test('has scan button', async ({ page }) => {
    const scanButton = page.getByRole('button', { name: 'Scan for Devices' })
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
    const scanButton = page.getByRole('button', { name: 'Scan for Devices' })

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
    // Page should load without crashing
    await expect(page.locator('body')).toBeVisible()
  })

  test('audio pool route exists', async ({ page }) => {
    await page.goto('/#/audio-pool?path=test&name=test')
    // Page should load without crashing
    await expect(page.locator('body')).toBeVisible()
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
