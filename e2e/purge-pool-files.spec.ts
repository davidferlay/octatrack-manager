import { test, expect, Page } from '@playwright/test'

/**
 * Purge Audio Pool Samples E2E Tests
 *
 * Covers the "Purge Audio Pool Samples" operation added to the Audio Pool
 * page's Tools tab (Task 13): the Operation dropdown gaining a second
 * option, the "Include all projects of set" checkbox revealing its two
 * nested sub-options, and the Execute -> review -> Apply Changes flow that
 * calls `purge_pool_files` and refreshes pool usage/file listings.
 *
 * Self-contained mock setup mirroring e2e/fix-pool-files.spec.ts's
 * structure (own `page.addInitScript`, same `/#/audio-pool?path=...`
 * navigation and Files-tab-ready wait), extended with the purge-specific
 * commands: `scan_pool_unused_files`, `scan_project_unused_files`,
 * `purge_pool_files`, `resolve_default_purge_destination`,
 * `navigate_to_parent`, `list_set_projects`.
 *
 * Scenario used for the Execute flow: the pool directory contains exactly
 * one unused audio file, unused.wav, not referenced by any project of the
 * set.
 */
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__purgeCalls = []
    ;(window as any).__poolUsageCalls = []
    ;(window as any).__destListCalls = []
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args: any) => {
        const pool = '/test/set/AUDIO'
        switch (cmd) {
          case 'plugin:event|listen':
            return 0
          case 'plugin:event|unlisten':
            return null
          case 'get_home_directory':
            return '/home/user/samples'
          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'list_audio_directory':
            ;(window as any).__destListCalls.push(args?.path)
            return [
              { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: `${args?.path || ''}/kick.wav` },
            ]
          case 'list_set_projects':
            return []
          case 'list_audio_files_recursive':
            return [`${pool}/kick.wav`]
          case 'inspect_audio_files':
            return (args?.paths ?? []).map((p: string) => ({ path: p, ot_size_bytes: 1024, compatibility: 'compatible' }))
          case 'get_audio_files_info':
            return (args?.paths ?? []).map((p: string) => ({
              name: p.split('/').pop(), size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: p,
            }))
          case 'get_pool_usage':
            ;(window as any).__poolUsageCalls.push(args?.poolPath)
            return {}
          case 'read_audio_file':
            return new ArrayBuffer(8)
          case 'reveal_in_file_manager':
            return null

          // Purge-specific commands (Task 13's "Purge Audio Pool Samples" operation)

          case 'scan_pool_unused_files':
            return [
              { kind: 'File', path: '/test/set/AUDIO/unused.wav', origin: 'AUDIO', size: 4096 },
            ]
          case 'scan_project_unused_files':
            return []
          case 'resolve_default_purge_destination':
            return '/home/testuser/Downloads'
          case 'navigate_to_parent':
            return args.path.split('/').slice(0, -1).join('/')
          case 'purge_pool_files':
            ;(window as any).__purgeCalls.push(args)
            return {
              files_removed: [args.plan[0].path],
              dirs_removed: [],
              bytes_reclaimed: 4096,
              slots_cleared: 0,
              projects_updated: [],
              errors: [],
            }

          default:
            return null
        }
      },
    }
  })
}

async function openPage(page: Page) {
  await page.goto('/#/audio-pool?path=/test/set/AUDIO&name=TestSet')
  await expect(page.locator('.dest-panel').getByText('kick.wav')).toBeVisible({ timeout: 10000 })
}

async function openPurgeOperation(page: Page) {
  await openPage(page)
  await page.locator('.header-tab', { hasText: 'Tools' }).click()
  await page.locator('.tools-section .tools-select').selectOption('purge_pool_samples')
}

test.describe('Purge Audio Pool Samples', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
  })

  test('appears as a second option in the Operation dropdown', async ({ page }) => {
    await openPage(page)
    await page.locator('.header-tab', { hasText: 'Tools' }).click()

    const select = page.locator('.tools-section .tools-select')
    await expect(select.locator('option')).toHaveCount(2)
    const options = select.locator('option')
    await expect(options.nth(0)).toHaveText('Fix Audio Pool Samples')
    await expect(options.nth(0)).toHaveAttribute('value', 'fix_audio_pool')
    await expect(options.nth(1)).toHaveText('Purge Audio Pool Samples')
    await expect(options.nth(1)).toHaveAttribute('value', 'purge_pool_samples')
  })

  test('Include all projects of set reveals the two nested sub-options', async ({ page }) => {
    await openPurgeOperation(page)

    // Wait for the scan to settle so the options panel (gated on scan state
    // in the sibling Fix operation) has fully rendered.
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')

    const includeAllCheckbox = page.getByLabel('Include all projects of set')
    await expect(includeAllCheckbox).not.toBeChecked()
    await expect(page.getByLabel('Clear unused sample slot assignments')).toHaveCount(0)
    await expect(page.getByLabel('Exclude backups/ directory')).toHaveCount(0)

    await includeAllCheckbox.check()

    const clearSlotsCheckbox = page.getByLabel('Clear unused sample slot assignments')
    const excludeBackupsCheckbox = page.getByLabel('Exclude backups/ directory')
    await expect(clearSlotsCheckbox).toBeVisible()
    await expect(clearSlotsCheckbox).not.toBeChecked()
    await expect(excludeBackupsCheckbox).toBeVisible()
    // Exclude backups/ defaults to checked (purgeExcludeBackups initial state)
    await expect(excludeBackupsCheckbox).toBeChecked()

    // Unchecking hides them again
    await includeAllCheckbox.uncheck()
    await expect(page.getByLabel('Clear unused sample slot assignments')).toHaveCount(0)
    await expect(page.getByLabel('Exclude backups/ directory')).toHaveCount(0)
  })

  test('Execute with Delete mode moves reviewed files to Trash and refreshes pool usage', async ({ page }) => {
    await openPurgeOperation(page)

    // Wait for the scan to resolve before Execute is available.
    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('1')
    await expect(summary).toContainText('unused audio file')

    // Delete files is the default selection.
    await expect(page.getByLabel('Delete files')).toBeChecked()

    const poolUsageCallsBefore = await page.evaluate(() => (window as any).__poolUsageCalls.length)
    const destListCallsBefore = await page.evaluate(() => (window as any).__destListCalls.length)

    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.locator('tbody')).toContainText('unused.wav')

    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    await expect.poll(async () => page.evaluate(() => (window as any).__purgeCalls.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).__purgeCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].poolPath).toBe('/test/set/AUDIO')
    expect(calls[0].plan).toEqual([
      { kind: 'File', path: '/test/set/AUDIO/unused.wav', origin: 'AUDIO', size: 4096 },
    ])
    expect(calls[0].clearUnusedSlots).toBe(false)
    expect(calls[0].includedProjectPaths).toEqual([])
    expect(calls[0].destinationDir).toBe(null)

    // Mirrors Fix Audio Pool Samples' onFixed and Purge Project Samples'
    // onFixed/onPurged pattern: the review modal stays open on its own
    // "done" summary screen until the user clicks Close, rather than being
    // torn down by the parent the instant the purge call resolves.
    await expect(modal).toHaveCount(1)
    await expect(modal.getByText('1 file and 0 directories removed (4.0 KB reclaimed).')).toBeVisible()

    // onPurged's refresh: get_pool_usage is re-fetched (invalidatePoolUsage)
    // and the destination (pool) file listing is reloaded.
    await expect.poll(async () => page.evaluate(() => (window as any).__poolUsageCalls.length))
      .toBeGreaterThan(poolUsageCallsBefore)
    await expect.poll(async () => page.evaluate(() => (window as any).__destListCalls.length))
      .toBeGreaterThan(destListCallsBefore)

    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toHaveCount(0)
  })

  test('Move mode with review unchecked skips the review screen entirely and calls purge_pool_files directly', async ({ page }) => {
    await openPurgeOperation(page)

    // Wait for the scan to resolve before Execute is available.
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')

    await page.getByLabel('Move files to folder').check()
    // Wait for resolve_default_purge_destination to fill the destination
    // field - Execute stays disabled while it's blank (Finding 1's fix).
    const destinationInput = page.locator('.tools-options-panel input[type="text"]')
    await expect(destinationInput).toHaveValue('/home/testuser/Downloads')

    const reviewCheckbox = page.getByLabel('Review before applying changes')
    await expect(reviewCheckbox).toBeChecked()
    await reviewCheckbox.uncheck()

    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    // The review screen (with its Apply Changes confirmation step) must
    // never appear - this is the riskiest UI path in the whole feature,
    // since it fires a destructive move with zero confirmation.
    await expect(page.getByText('Review planned changes')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Apply Changes' })).toHaveCount(0)

    await expect.poll(async () => page.evaluate(() => (window as any).__purgeCalls.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).__purgeCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].poolPath).toBe('/test/set/AUDIO')
    expect(calls[0].plan).toEqual([
      { kind: 'File', path: '/test/set/AUDIO/unused.wav', origin: 'AUDIO', size: 4096 },
    ])
    expect(calls[0].includedProjectPaths).toEqual([])
    expect(calls[0].destinationDir).toBe('/home/testuser/Downloads')

    // Modal lands directly on its "done" summary screen (skipReview jumps
    // straight from mount to the removing/done phases).
    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal.getByText('1 file and 0 directories removed (4.0 KB reclaimed).')).toBeVisible()
  })
})
