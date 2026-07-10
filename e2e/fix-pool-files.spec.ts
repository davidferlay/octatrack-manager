import { test, expect, Page } from '@playwright/test'

// Mocks the Audio Pool page with one compatible and two incompatible pool files.
// fix_pool_files calls are recorded on window.__fixCalls for assertions.
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__fixCalls = []
    ;(window as any).__inspectCalls = []
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
            return [
              { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: `${args?.path || ''}/kick.wav` },
              { name: 'snare48.wav', size: 2048, channels: 2, bit_rate: 16, sample_rate: 48000, is_directory: false, path: `${args?.path || ''}/snare48.wav` },
              { name: 'loop.mp3', size: 4096, channels: 2, bit_rate: 0, sample_rate: 44100, is_directory: false, path: `${args?.path || ''}/loop.mp3` },
            ]
          case 'list_audio_files_recursive':
            return [`${pool}/kick.wav`, `${pool}/snare48.wav`, `${pool}/loop.mp3`]
          case 'inspect_audio_files':
            ;(window as any).__inspectCalls.push(args?.paths ?? [])
            return (args?.paths ?? []).map((p: string) => ({
              path: p,
              ot_size_bytes: 1024,
              compatibility: p.endsWith('snare48.wav') ? 'wrong_rate' : p.endsWith('loop.mp3') ? 'unknown' : 'compatible',
            }))
          case 'fix_pool_files':
            ;(window as any).__fixCalls.push(args)
            return {
              outcomes: (args?.filePaths ?? []).map((p: string) => ({
                old_path: p,
                new_path: p.replace(/\.[^.]+$/, '.wav'),
                error: null,
              })),
              projects_updated: ['/test/set/PROJ1'],
              slots_updated: 2,
            }
          case 'read_audio_file':
            return new ArrayBuffer(8)
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

test.describe('Audio Pool — fix incompatible files', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
  })

  test('the pool pane shows OT compatibility badges per file', async ({ page }) => {
    const dest = page.locator('.dest-panel')
    await expect(dest.locator('tr', { hasText: 'kick.wav' }).locator('.compat-badge')).toHaveText(':)')
    await expect(dest.locator('tr', { hasText: 'snare48.wav' }).locator('.compat-badge')).toHaveText(':|')
    // mp3 is classified by extension: unplayable audio, not "unrecognized"
    const mp3Badge = dest.locator('tr', { hasText: 'loop.mp3' }).locator('.compat-badge')
    await expect(mp3Badge).toHaveText('??')
    await expect(mp3Badge).toHaveAttribute('title', 'Audio format the Octatrack cannot play (convert to WAV)')

    // Only WAV/AIFF files are sent to inspect_audio_files — never mp3 & co
    const inspected: string[][] = await page.evaluate(() => (window as any).__inspectCalls)
    expect(inspected.length).toBeGreaterThan(0)
    for (const call of inspected) {
      for (const p of call) expect(p).toMatch(/\.(wav|aif|aiff)$/i)
    }
  })

  test('context menu converts an incompatible file after review', async ({ page }) => {
    // Wait for the compat inspection before opening the menu (it gates the item)
    const row = page.locator('.dest-panel tr', { hasText: 'loop.mp3' })
    await expect(row.locator('.compat-badge')).toHaveText('??')
    await row.click({ button: 'right' })

    const item = page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' })
    await expect(item).toBeEnabled()
    await item.click()

    // Review screen mirrors the Fix Missing Samples flow
    const modal = page.locator('.fix-pool-modal')
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.locator('tbody tr').first()).toContainText('Convert to loop.wav')
    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    await expect(modal.getByText('1 file converted.')).toBeVisible()
    await expect(modal.getByText(/2 sample slots updated\s+across 1 project/)).toBeVisible()

    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].filePaths).toEqual(['/test/set/AUDIO/loop.mp3'])
    expect(calls[0].poolPath).toBe('/test/set/AUDIO')
  })

  test('the review table supports search and copy to clipboard', async ({ page }) => {
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-pool-modal')
    await expect(modal.locator('tbody tr')).toHaveCount(2)

    // Search narrows the listed rows and the header shows the filtered count
    await modal.locator('.header-search-input').fill('snare')
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.getByText('— showing 1')).toBeVisible()

    // Copy puts a TSV of the visible rows on the clipboard
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await modal.locator('.copy-table-btn').click()
    await expect(modal.locator('.copy-table-btn')).toHaveText('✓')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('File\tCompatibility\tLocation\tAction')
    expect(clip).toContain('snare48.wav')
    expect(clip).not.toContain('loop.mp3')
  })

  test('context menu convert is disabled on a compatible file', async ({ page }) => {
    const row = page.locator('.dest-panel tr', { hasText: 'kick.wav' })
    await expect(row.locator('.compat-badge')).toHaveText(':)')
    await row.click({ button: 'right' })

    const item = page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' })
    await expect(item).toBeDisabled()
  })

  test('Tools tab auto-scans the pool, mirrors the fix-missing layout, and fixes the files', async ({ page }) => {
    // The bottom status bar only belongs to the Files tab
    await expect(page.locator('.audio-pool-status')).toBeVisible()

    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await expect(page.locator('.pool-tools-panel')).toBeVisible()
    await expect(page.locator('.audio-pool-status')).toHaveCount(0)
    await expect(page.locator('.tools-description-pane')).toBeVisible()

    // Browse and Import only make sense on the Files tab
    await expect(page.locator('.toolbar-button', { hasText: 'Browse' })).toBeDisabled()
    await expect(page.locator('.import-dropdown-container .toolbar-button')).toBeDisabled()

    // Auto-scan reports the incompatible count in the Status pane
    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('2')
    await expect(summary).toContainText('incompatible audio files')
    await expect(summary).toContainText('of 3 scanned')

    // Clicking the status summary opens the read-only list modal (search + copy)
    await page.locator('.tools-missing-files-summary').click()
    const listModal = page.locator('.missing-samples-list-modal')
    await expect(listModal.getByText('Incompatible Audio Pool Samples')).toBeVisible()
    await expect(listModal.locator('tbody tr')).toHaveCount(2)
    await expect(listModal.locator('.header-search-input')).toBeVisible()
    await expect(listModal.locator('.copy-table-btn')).toBeVisible()
    // Content-sized: with few rows there is no scrollbar and no dead space below the table
    const sizes = await listModal.locator('.table-wrapper').evaluate(el => ({
      scrollable: el.scrollHeight > el.clientHeight + 1,
      dead: el.clientHeight - (el.querySelector('table')?.getBoundingClientRect().height ?? 0),
    }))
    expect(sizes.scrollable).toBe(false)
    expect(sizes.dead).toBeLessThan(10)
    await listModal.locator('.modal-close').click()

    // Execute with "Review before applying changes" on (default) shows the review screen
    await expect(page.locator('.tools-options-panel input[type="checkbox"]')).toBeChecked()
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-pool-modal')
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('tbody tr')).toHaveCount(2)
    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    await expect(modal.getByText('2 files converted.')).toBeVisible()

    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls[0].filePaths).toEqual(['/test/set/AUDIO/snare48.wav', '/test/set/AUDIO/loop.mp3'])
  })

  test('disabling the review option makes Execute apply immediately', async ({ page }) => {
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await page.locator('.tools-options-panel input[type="checkbox"]').uncheck()
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-pool-modal')
    await expect(modal.getByText('2 files converted.')).toBeVisible()
    await expect(modal.getByText('Review planned changes')).toHaveCount(0)

    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls[0].filePaths).toEqual(['/test/set/AUDIO/snare48.wav', '/test/set/AUDIO/loop.mp3'])
  })
})
