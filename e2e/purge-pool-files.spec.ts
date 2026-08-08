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
    ;(window as any).__scanCalls = []
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
            ;(window as any).__scanCalls.push(args)
            return [
              { kind: 'File', path: '/test/set/AUDIO/unused.wav', origin: 'AUDIO', size: 4096, slots: [], sidecar: null },
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
              audio_files_removed: 1,
              non_audio_files_removed: 0,
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

  test('scanning shows a live percentage that advances as each of the 5 background steps resolves', async ({ page }) => {
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      let poolScanCalls = 0
      internals.invoke = async (cmd: string, args?: any) => {
        // The loading state is gated on the pool-only scan (the first of the
        // 3 scan_pool_unused_files calls this effect fires) - hold just that
        // one back so the other 5 of the 6 background steps (project list,
        // both include-all variants, file totals, slot counts) resolve first and
        // progress reads 83% (5/6).
        if (cmd === 'scan_pool_unused_files') {
          poolScanCalls += 1
          if (poolScanCalls === 1) {
            await new Promise<void>(resolve => { (window as any).__releasePoolOnlyScan = resolve })
          }
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)

    await expect(page.locator('.tools-fix-status.loading')).toContainText('83%')

    await page.evaluate(() => (window as any).__releasePoolOnlyScan())
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')
  })

  test('a collapsed directory lists its files tree-style with Slot/Size, is collapsible, and offers a context menu', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__revealCalls = []
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'reveal_in_file_manager') {
          ;(window as any).__revealCalls.push(args?.path)
          return null
        }
        if (cmd === 'scan_pool_unused_files') {
          return [
            { kind: 'File', path: '/test/set/AUDIO/orphan.wav', origin: 'AUDIO', size: 2048, slots: [], sidecar: null },
            {
              kind: 'Directory',
              path: '/test/set/AUDIO/oldkit',
              origin: 'AUDIO',
              file_count: 2,
              non_audio_count: 1,
              size: 3584,
              files: [
                { path: '/test/set/AUDIO/oldkit/clap.wav', size: 1024, slots: [], is_audio: true },
                { path: '/test/set/AUDIO/oldkit/cover.jpg', size: 512, slots: [], is_audio: false },
                { path: '/test/set/AUDIO/oldkit/kick.wav', size: 2048, slots: ['F3'], is_audio: true },
              ],
            },
          ]
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    const summary = page.locator('.tools-missing-files-summary')
    // 1 lone file + the directory's own file_count (2) = 3 unused audio files.
    // The swept-along cover.jpg is reported apart from that headline count.
    await expect(summary).toContainText('3')
    // Real total from the recursive audio listing (the pool holds kick.wav),
    // with the related-file tail (cover.jpg) after it.
    await expect(summary).toHaveText(/3 unused audio files to purge - of 1 scanned in Audio Pool directory \+ 1 related file/)

    await summary.click()
    const listModal = page.locator('.missing-samples-list-modal')
    await expect(listModal.getByText('Unused Audio Pool Samples')).toBeVisible()

    // A short plan must not collapse the modal to a squat strip.
    expect(await listModal.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(355) // 360px floor, minus sub-pixel rounding

    const rows = listModal.locator('tbody tr')
    await expect(rows).toHaveCount(5)
    await expect(rows.nth(0)).toContainText('oldkit')
    await expect(rows.nth(0)).toContainText('2 audio + 1 other file')
    await expect(rows.nth(1)).toHaveClass(/purge-tree-child-row/)
    await expect(rows.nth(1)).toContainText('clap.wav')
    await expect(rows.nth(1)).toContainText('1.0 KB')
    // The non-audio file is listed too, flagged as such rather than hidden.
    await expect(rows.nth(2)).toHaveClass(/purge-tree-child-non-audio/)
    await expect(rows.nth(2)).toContainText('cover.jpg')
    await expect(rows.nth(2)).toContainText('512 B')
    await expect(rows.nth(3)).toHaveClass(/purge-tree-child-row/)
    await expect(rows.nth(3)).not.toHaveClass(/purge-tree-child-non-audio/)
    await expect(rows.nth(3)).toContainText('kick.wav')
    await expect(rows.nth(3)).toContainText('2.0 KB')
    await expect(rows.nth(3)).toContainText('F3')
    await expect(rows.nth(4)).toContainText('orphan.wav')

    // Collapsing the directory hides its tree-child rows; expanding restores them.
    await rows.first().locator('.purge-dir-collapse-btn').click()
    await expect(listModal.locator('tbody tr')).toHaveCount(2)
    await rows.first().locator('.purge-dir-collapse-btn').click()
    await expect(listModal.locator('tbody tr')).toHaveCount(5)

    // Searching reaches files inside the collapsed directory, narrowed to hits.
    const search = listModal.locator('.header-search-input')
    await search.fill('cover')
    await expect(listModal.locator('tbody tr')).toHaveCount(2)
    await expect(listModal.locator('tbody tr').nth(1)).toContainText('cover.jpg')
    await search.fill('')
    await expect(listModal.locator('tbody tr')).toHaveCount(5)

    // Right-click the lone file row -> context menu, each action targeting that exact row's path.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const orphanPath = '/test/set/AUDIO/orphan.wav'

    await rows.nth(4).click({ button: 'right' })
    let menu = page.locator('.context-menu')
    await expect(menu.getByText('Open in file explorer')).toBeVisible()
    await menu.getByText('Open in file explorer').click()
    await expect.poll(async () => page.evaluate(() => (window as any).__revealCalls)).toEqual([orphanPath])

    await rows.nth(4).click({ button: 'right' })
    menu = page.locator('.context-menu')
    await menu.getByText('Copy file path').click()
    await expect(menu).toHaveCount(0)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(orphanPath)
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

    const excludeBackupsCheckbox = page.getByLabel('Exclude backups/ directory')
    // Slot clearing now lives in the Purge scope selector, not a checkbox.
    await expect(page.getByRole('button', { name: 'Unused sample slots' })).toBeVisible()
    await expect(excludeBackupsCheckbox).toBeVisible()
    // Exclude backups/ defaults to checked (purgeExcludeBackups initial state)
    await expect(excludeBackupsCheckbox).toBeChecked()

    // Unchecking hides them again
    await includeAllCheckbox.uncheck()
    await expect(page.getByLabel('Clear unused sample slot assignments')).toHaveCount(0)
    await expect(page.getByLabel('Exclude backups/ directory')).toHaveCount(0)
  })

  test('toggling Include all projects of set, Exclude backups/ directory and Clear unused sample slot assignments never re-scans the backend', async ({ page }) => {
    await openPurgeOperation(page)
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')

    // All three scan variants (pool-only, include-all as-is, include-all
    // slots-simulated) are pre-fetched up front, in the background.
    await expect.poll(async () => page.evaluate(() => (window as any).__scanCalls.length)).toBe(3)
    const scanCallsAfterInitialLoad = await page.evaluate(() => (window as any).__scanCalls.length)

    const includeAllCheckbox = page.getByLabel('Include all projects of set')
    await includeAllCheckbox.check()
    await includeAllCheckbox.uncheck()
    await includeAllCheckbox.check()

    const excludeBackupsCheckbox = page.getByLabel('Exclude backups/ directory')
    await excludeBackupsCheckbox.uncheck()
    await excludeBackupsCheckbox.check()
    await page.getByRole('button', { name: 'Both' }).click()
    await page.getByRole('button', { name: 'Unused audio files' }).click()

    await expect(page.locator('.tools-fix-status.loading')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__scanCalls.length)).toBe(scanCallsAfterInitialLoad)
  })

  test('Execute with Delete mode moves reviewed files to Trash and refreshes pool usage', async ({ page }) => {
    await openPurgeOperation(page)

    // Wait for the scan to resolve before Execute is available.
    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('1')
    await expect(summary).toContainText('unused audio file')

    // Move files to folder is the default selection - switch to Delete for
    // this test's Trash flow (destinationDir: null below).
    await expect(page.getByRole('button', { name: 'Move files to folder' })).toHaveClass(/selected/)
    await page.getByRole('button', { name: 'Delete files' }).click()
    await expect(page.getByRole('button', { name: 'Delete files' })).toHaveClass(/selected/)

    const poolUsageCallsBefore = await page.evaluate(() => (window as any).__poolUsageCalls.length)
    const destListCallsBefore = await page.evaluate(() => (window as any).__destListCalls.length)

    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.locator('tbody')).toContainText('unused.wav')

    // Review modal is the same width as the preview/status modal (no wider
    // 'fix-pool-modal' class), and its Name column isn't squashed to a fixed
    // width by the Fix modals' generic 4-column review-table CSS.
    await expect(modal).not.toHaveClass(/fix-pool-modal(?!-narrow)/)
    const nameColWidth = await modal.locator('.purge-units-table colgroup col').nth(1).evaluate(el => (el as HTMLElement).style.width)
    expect(nameColWidth).toBe('')

    // Same min-height floor as the preview modal, so the two match on a one-row plan.
    expect(await modal.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(355) // 360px floor, minus sub-pixel rounding

    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    await expect.poll(async () => page.evaluate(() => (window as any).__purgeCalls.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).__purgeCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].poolPath).toBe('/test/set/AUDIO')
    expect(calls[0].plan).toEqual([
      { kind: 'File', path: '/test/set/AUDIO/unused.wav', origin: 'AUDIO', size: 4096, slots: [], sidecar: null },
    ])
    expect(calls[0].clearUnusedSlots).toBe(false)
    expect(calls[0].includedProjectPaths).toEqual([])
    expect(calls[0].destinationDir).toBe(null)

    // Mirrors Fix Audio Pool Samples' onFixed and Purge Project Samples'
    // onFixed/onPurged pattern: the review modal stays open on its own
    // "done" summary screen until the user clicks Close, rather than being
    // torn down by the parent the instant the purge call resolves.
    await expect(modal).toHaveCount(1)
    await expect(modal.getByText(/1 audio file,\s*sent to the Trash Bin\s*4\.0 KB reclaimed/)).toBeVisible()

    // onPurged's refresh: get_pool_usage is re-fetched (invalidatePoolUsage)
    // and the destination (pool) file listing is reloaded.
    await expect.poll(async () => page.evaluate(() => (window as any).__poolUsageCalls.length))
      .toBeGreaterThan(poolUsageCallsBefore)
    await expect.poll(async () => page.evaluate(() => (window as any).__destListCalls.length))
      .toBeGreaterThan(destListCallsBefore)

    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toHaveCount(0)
  })

  test('slot clearing follows the Purge selector, not Include all projects of set', async ({ page }) => {
    // list_set_projects returns [] by default in this spec's shared mock -
    // override it with a real project so there is somewhere for slots to live.
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'list_set_projects') return [{ name: 'ProjA', path: '/test/set/ProjA' }]
        if (cmd === 'list_unused_slot_assignments') {
          return [{ slot: 'S1', path: '/test/set/AUDIO/kick.wav', origin: 'Audio Pool', size: 1024 }]
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')

    // "Include all projects of set" widens where FILES are scanned. Sample
    // slots only ever live in projects, so a user who asked to clear them
    // means the Set's projects either way - gating the two together made a
    // pool-scope slot clear impossible to express.
    await page.getByRole('button', { name: 'Both' }).click()
    await expect(page.getByLabel('Include all projects of set')).not.toBeChecked()

    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()
    await page.locator('.missing-samples-list-modal').getByRole('button', { name: 'Apply Changes' }).click()

    await expect.poll(async () => page.evaluate(() => (window as any).__purgeCalls.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).__purgeCalls)
    expect(calls[0].clearUnusedSlots).toBe(true)
    expect(calls[0].includedProjectPaths).toEqual(['/test/set/ProjA'])

    // Files stay pool-scoped: the plan is still just the pool's own finding.
    expect(calls[0].plan).toHaveLength(1)
    expect(calls[0].plan[0].path).toBe('/test/set/AUDIO/unused.wav')
  })

  test('Move mode with review unchecked skips the review screen entirely and calls purge_pool_files directly', async ({ page }) => {
    await openPurgeOperation(page)

    // Wait for the scan to resolve before Execute is available.
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')

    await page.getByRole('button', { name: 'Move files to folder' }).click()
    // Wait for resolve_default_purge_destination to fill the destination
    // field - Execute stays disabled while it's blank (Finding 1's fix).
    const destinationButton = page.locator('.tools-destination-path')
    await expect(destinationButton).toHaveText('/home/testuser/Downloads')

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
      { kind: 'File', path: '/test/set/AUDIO/unused.wav', origin: 'AUDIO', size: 4096, slots: [], sidecar: null },
    ])
    expect(calls[0].includedProjectPaths).toEqual([])
    expect(calls[0].destinationDir).toBe('/home/testuser/Downloads')

    // Modal lands directly on its "done" summary screen (skipReview jumps
    // straight from mount to the removing/done phases).
    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal.getByText(/1 audio file,\s*moved to \/home\/testuser\/Downloads\s*4\.0 KB reclaimed/)).toBeVisible()
  })
})
