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
          case 'get_audio_files_info':
            return (args?.paths ?? []).map((p: string) => ({
              name: p.split('/').pop(),
              size: p.endsWith('loop.mp3') ? 4096 : 2048,
              channels: 2,
              bit_rate: p.endsWith('loop.mp3') ? null : 16,
              sample_rate: p.endsWith('snare48.wav') ? 48000 : p.endsWith('loop.mp3') ? null : 44100,
              is_directory: false,
              path: p,
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

  test('context menu converts an incompatible file inline, without any modal', async ({ page }) => {
    // Wait for the compat inspection before opening the menu (it gates the item)
    const row = page.locator('.dest-panel tr', { hasText: 'loop.mp3' })
    await expect(row.locator('.compat-badge')).toHaveText('??')
    await row.click({ button: 'right' })

    const item = page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' })
    await expect(item).toBeEnabled()
    // Reads as a fix action: green when available
    await expect(item).toHaveCSS('color', 'rgb(76, 175, 80)')
    await item.click()

    // The conversion runs inline: no review/progress modal, just the fix call + a refresh
    await expect.poll(async () => page.evaluate(() => (window as any).__fixCalls.length)).toBe(1)
    await expect(page.locator('.fix-pool-modal')).toHaveCount(0)

    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls[0].filePaths).toEqual(['/test/set/AUDIO/loop.mp3'])
    expect(calls[0].poolPath).toBe('/test/set/AUDIO')
    // The file list was reloaded so the Compat badges reflect the converted files
    await expect(page.locator('.dest-panel .compat-badge').first()).toBeVisible()
  })

  test('the Compat badge shows a throbber while a file converts inline', async ({ page }) => {
    // Make fix_pool_files hang until released so the converting state is observable
    await page.evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const original = internals.invoke
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === 'fix_pool_files') {
          await new Promise<void>(resolve => { (window as any).__releaseFix = resolve })
        }
        return original(cmd, args)
      }
    })

    const row = page.locator('.dest-panel tr', { hasText: 'snare48.wav' })
    await expect(row.locator('.compat-badge')).toHaveText(':|')
    const heightBefore = (await row.boundingBox())!.height
    await row.click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' }).click()

    // Badge replaced by the spinner while converting — without changing the row height
    await expect(row.locator('.loading-spinner-small')).toBeVisible()
    await expect(row.locator('.compat-badge')).toBeHidden()
    expect((await row.boundingBox())!.height).toBeCloseTo(heightBefore, 1)
    // Tooltip reports the conversion progress (no events delivered by the mock: 0%)
    await expect(row.locator('.compat-converting')).toHaveAttribute('title', 'Converting to Octatrack format... 0%')

    // While the file converts, the menu item cannot start a second conversion
    await row.click({ button: 'right' })
    const item = page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' })
    await expect(item).toBeDisabled()
    await expect(item).toHaveAttribute('title', 'Conversion in progress')
    await page.keyboard.press('Escape')

    await page.evaluate(() => (window as any).__releaseFix())
    // On success a green checkmark shows briefly — still without changing the row height
    await expect(row.locator('.compat-converted .fa-check-circle')).toBeVisible()
    await expect(row.locator('.compat-converted')).toHaveAttribute('title', 'Converted to Octatrack format')
    expect((await row.boundingBox())!.height).toBeCloseTo(heightBefore, 1)
    // ...then fades out and the badge is back (mock keeps listing the same file)
    await expect(row.locator('.compat-converted')).toHaveCount(0)
    await expect(row.locator('.loading-spinner-small')).toHaveCount(0)
    await expect(row.locator('.compat-badge')).toBeVisible()
  })

  test('the review table supports search and copy to clipboard', async ({ page }) => {
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-pool-modal')
    await expect(modal.locator('tbody tr')).toHaveCount(2)

    // Bold title carries the count; the table has the Format/Bit/kHz/Size columns
    await expect(modal.locator('.modal-header h3')).toContainText('Review planned changes - 2 incompatible audio files')
    await expect(modal.locator('thead')).toContainText('Format')
    await expect(modal.locator('thead')).toContainText('Bit')
    await expect(modal.locator('thead')).toContainText('kHz')
    await expect(modal.locator('thead')).toContainText('Size')
    // The count indicator always shows
    await expect(modal.getByText('Showing 2 of 2 files')).toBeVisible()
    // Location is hidden by default here; the toggle-columns menu brings it back
    await expect(modal.locator('thead')).not.toContainText('Location')
    await modal.locator('.column-visibility-btn').click()
    await modal.locator('.column-visibility-dropdown .dropdown-option', { hasText: 'Location' }).locator('input').check()
    await expect(modal.locator('thead')).toContainText('Location')
    await modal.locator('.column-visibility-dropdown .dropdown-option', { hasText: 'Location' }).locator('input').uncheck()
    await modal.locator('.column-visibility-btn').click()
    const snareRow = modal.locator('tbody tr', { hasText: 'snare48.wav' })
    await expect(snareRow).toContainText('WAV')
    await expect(snareRow).toContainText('16')
    await expect(snareRow).toContainText('48.0')
    await expect(snareRow).toContainText('2.0 KB')

    // Search narrows the listed rows and the header shows the filtered count
    await modal.locator('.header-search-input').fill('snare')
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.getByText('Showing 1 of 2 files')).toBeVisible()

    // Copy puts a TSV of the visible rows on the clipboard
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await modal.locator('.copy-table-btn').click()
    await expect(modal.locator('.copy-table-btn')).toHaveText('✓')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    // TSV mirrors the visible columns (Location hidden by default)
    expect(clip).toContain('File\tFormat\tBit\tkHz\tSize\tAction')
    expect(clip).toContain('snare48.wav')
    expect(clip).not.toContain('loop.mp3')

    // The Format filter dropdown narrows rows too
    await modal.locator('.header-search-input').fill('')
    await expect(modal.locator('tbody tr')).toHaveCount(2)
    await modal.locator('.filterable-header', { hasText: 'Format' }).locator('.filter-icon').click()
    await page.locator('.filter-dropdown .dropdown-option', { hasText: 'MP3' }).click()
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.locator('.filter-badge')).toContainText('Format: MP3')
    await page.locator('.reset-filters-btn').click()
    await expect(modal.locator('tbody tr')).toHaveCount(2)
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
    const browseBtn = page.locator('.toolbar-button', { hasText: 'Browse' })
    const importBtn = page.locator('.import-dropdown-container .toolbar-button')
    await expect(browseBtn).toBeDisabled()
    await expect(browseBtn).toHaveAttribute('title', 'Only available on the Files tab')
    await expect(importBtn).toBeDisabled()
    await expect(importBtn).toHaveAttribute('title', 'Only available on the Files tab')

    // Files-tab shortcuts are inert here: B must not toggle the (open by default) Browse panel
    await page.keyboard.press('b')
    await page.locator('.header-tab', { hasText: 'Files' }).click()
    await expect(page.locator('.source-panel')).toBeVisible()
    await page.locator('.header-tab', { hasText: 'Tools' }).click()

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
    // Same rich columns as the review table (Location visible here), plus the column toggle
    await expect(listModal.locator('thead')).toContainText('Format')
    await expect(listModal.locator('thead')).toContainText('Bit')
    await expect(listModal.locator('thead')).toContainText('kHz')
    await expect(listModal.locator('thead')).toContainText('Size')
    await expect(listModal.locator('thead')).toContainText('Location')
    await expect(listModal.locator('.column-visibility-btn')).toBeVisible()
    // Content-sized: with few rows there is no scrollbar and no dead space below the table
    const sizes = await listModal.locator('.table-wrapper').evaluate(el => ({
      scrollable: el.scrollHeight > el.clientHeight + 1,
      dead: el.clientHeight - (el.querySelector('table')?.getBoundingClientRect().height ?? 0),
    }))
    expect(sizes.scrollable).toBe(false)
    expect(sizes.dead).toBeLessThan(10)
    // Esc closes modals globally
    await page.keyboard.press('Escape')
    await expect(listModal).toHaveCount(0)

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

  test('the pane health glyph reports the background scan and opens the Tools tab', async ({ page }) => {
    // The pool is scanned in the background on page load; the pane title gets a warning glyph
    const glyph = page.locator('.pool-health-glyph')
    await expect(glyph).toHaveClass(/warning/)
    await expect(glyph).toHaveAttribute('title', '2 incompatible audio files found - click to fix')
    // Styled as a badge: wrench icon + count of incompatible files
    await expect(glyph).toHaveText('2')
    await expect(glyph.locator('.fa-wrench')).toBeVisible()

    await glyph.click()
    await expect(page.locator('.pool-tools-panel')).toBeVisible()
    await expect(page.locator('.tools-missing-files-summary')).toContainText('2')
  })

  test('resizing a pool modal by its bottom handle does not close it', async ({ page }) => {
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await page.locator('.tools-missing-files-summary').click()
    const listModal = page.locator('.missing-samples-list-modal')
    await expect(listModal).toBeVisible()

    const heightBefore = (await listModal.boundingBox())!.height
    const handle = listModal.locator('.modal-resize-bottom')
    const box = (await handle.boundingBox())!
    // Drag well past the max-height clamp so the pointer ends over the dark overlay
    await page.mouse.move(box.x + box.width / 2, box.y + 3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, 719, { steps: 5 })
    await page.mouse.up()

    // The click that follows the drag must not close the modal
    await expect(listModal).toBeVisible()
    expect((await listModal.boundingBox())!.height).toBeGreaterThan(heightBefore + 50)
    // A plain click on the overlay still closes it
    await page.mouse.click(5, 5)
    await expect(listModal).toHaveCount(0)
  })

  test('Shift+digit switches tabs and t toggles the Transfers pane', async ({ page }) => {
    await expect(page.locator('.audio-pool-status')).toBeVisible()
    await page.keyboard.press('Shift+Digit2')
    await expect(page.locator('.pool-tools-panel')).toBeVisible()
    await page.keyboard.press('Shift+Digit1')
    await expect(page.locator('.audio-pool-status')).toBeVisible()

    await expect(page.locator('.transfer-queue')).toHaveCount(0)
    await page.keyboard.press('t')
    await expect(page.locator('.transfer-queue')).toBeVisible()
    await page.keyboard.press('t')
    await expect(page.locator('.transfer-queue')).toHaveCount(0)
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
