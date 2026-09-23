import { test, expect, Page } from '@playwright/test'

/**
 * Set-wide Fix Missing Samples, from the Audio Pool's Tools tab.
 *
 * Two projects of the Set each miss one file: PROJ1's sits in its own directory,
 * PROJ2's is nowhere. fix_missing_samples calls land on window.__fixCalls.
 */
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__fixCalls = []
    ;(window as any).__backupCalls = []
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
            ]
          case 'list_audio_files_recursive':
            return [`${pool}/kick.wav`]
          case 'list_set_projects':
            return [
              { name: 'PROJ1', path: '/test/set/PROJ1' },
              { name: 'PROJ2', path: '/test/set/PROJ2' },
            ]
          case 'list_missing_samples':
            if (args?.projectPath === '/test/set/PROJ1') {
              return [{ filename: 'lost1.wav', original_path: 'lost1.wav', slot_type: 'flex', flex_slot_ids: [3], static_slot_ids: [] }]
            }
            if (args?.projectPath === '/test/set/PROJ2') {
              return [{ filename: 'lost2.wav', original_path: 'lost2.wav', slot_type: 'static', flex_slot_ids: [], static_slot_ids: [7] }]
            }
            return []
          case 'search_project_dir':
            if (args?.projectPath === '/test/set/PROJ1') {
              return [{ filename: 'lost1.wav', found_path: '/test/set/PROJ1/samples/lost1.wav', source_project: null }]
            }
            return []
          case 'search_audio_pool':
          case 'search_other_projects_of_set':
            return []
          case 'inspect_audio_files':
            return (args?.paths ?? []).map((p: string) => ({ path: p, ot_size_bytes: 1024, compatibility: 'compatible' }))
          case 'get_audio_files_info':
            return (args?.paths ?? []).map((p: string) => ({ name: p.split('/').pop(), size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: p }))
          case 'get_pool_usage':
            return {}
          case 'backup_project_files':
            ;(window as any).__backupCalls.push(args)
            return null
          case 'fix_missing_samples':
            ;(window as any).__fixCalls.push(args)
            return { resolved_count: (args?.resolutions ?? []).length, files_copied: 0, files_moved: 0, projects_updated: [args?.projectPath] }
          default:
            return null
        }
      },
    }
  })
}

async function openTools(page: Page) {
  await page.goto('/#/audio-pool?path=/test/set/AUDIO&name=TestSet')
  await expect(page.locator('.dest-panel').getByText('kick.wav')).toBeVisible({ timeout: 10000 })
  await page.locator('.header-tab', { hasText: 'Tools' }).click()
  await page.locator('.tools-section .tools-select').selectOption('fix_missing_samples')
}

test.describe('Audio Pool - Fix Missing Samples across the Set', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
  })

  test('the status is a clickable summary, like the project tool, opening the Set-wide list', async ({ page }) => {
    await openTools(page)
    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('2')
    await expect(summary).toContainText('missing sample files')
    await expect(summary).toContainText('1 Flex, 1 Static')
    await expect(summary).toContainText('across 2 projects')

    await summary.click()
    const list = page.locator('.missing-samples-list-modal')
    await expect(list.locator('.modal-header h3')).toContainText('Missing Samples across Set')
    await expect(list.getByText('Showing 2 of 2 slots')).toBeVisible()
    // The Project column is what the per-project list does not have
    await expect(list.locator('thead')).toContainText('Project')
    await expect(list.locator('tbody tr', { hasText: 'lost1.wav' })).toContainText('PROJ1')
    await expect(list.locator('tbody tr', { hasText: 'lost2.wav' })).toContainText('PROJ2')
    await expect(list.locator('tbody tr', { hasText: 'lost1.wav' })).toContainText('F3')
    await expect(list.locator('tbody tr', { hasText: 'lost2.wav' })).toContainText('S7')
  })

  test('Execute shows the same search-steps screen as the project tool, then one review table', async ({ page }) => {
    await openTools(page)
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-missing-modal')
    await expect(modal.locator('.modal-header h3')).toContainText('Searching for missing samples across Set...')
    await expect(modal.locator('.fix-search-step', { hasText: 'Project directories' })).toContainText('1 found')
    await expect(modal.locator('.fix-search-step', { hasText: 'Audio Pool' })).toContainText('0 found')
    await expect(modal.locator('.fix-search-summary')).toContainText('1/2')
    await expect(modal.locator('.fix-search-summary')).toContainText('1 still missing')

    await modal.getByRole('button', { name: 'Review changes' }).click()
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('.fix-confirm-status')).toContainText('1/2')
    await expect(modal.locator('.fix-confirm-status')).toContainText('across 2 projects')

    const foundRow = modal.locator('tbody tr', { hasText: 'lost1.wav' })
    await expect(foundRow).toContainText('PROJ1')
    await expect(foundRow).toContainText('/test/set/PROJ1/samples/lost1.wav')
    await expect(foundRow).toContainText('Update path')

    const missingRow = modal.locator('tbody tr', { hasText: 'lost2.wav' })
    await expect(missingRow).toContainText('PROJ2')
    await expect(missingRow).toContainText('Not found')
  })

  test('the review table sorts and filters like the other review tables', async ({ page }) => {
    await openTools(page)
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()
    const modal = page.locator('.fix-missing-modal')
    await modal.getByRole('button', { name: 'Review changes' }).click()

    // Sorting by Project flips the row order
    const firstFile = () => modal.locator('tbody tr').first().locator('td').nth(1)
    await expect(firstFile()).toHaveText('lost1.wav')
    await modal.locator('.sortable-label', { hasText: 'Project' }).click()
    await expect(firstFile()).toHaveText('lost2.wav')

    // Filtering by project narrows the table and shows a badge
    await modal.locator('.filterable-header', { hasText: 'Project' }).locator('.filter-icon').click()
    await page.locator('.filter-dropdown .dropdown-option', { hasText: 'PROJ1' }).click()
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.locator('.filter-badge', { hasText: 'Project: PROJ1' })).toBeVisible()

    await modal.locator('.reset-filters-btn').click()
    await expect(modal.locator('tbody tr')).toHaveCount(2)
  })

  test('projects whose slots all resolve are left out of the count and the list', async ({ page }) => {
    // PROJ3 is in the Set but misses nothing - list_missing_samples returns [] for it
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === 'list_set_projects') {
          return [
            { name: 'PROJ1', path: '/test/set/PROJ1' },
            { name: 'PROJ2', path: '/test/set/PROJ2' },
            { name: 'PROJ3', path: '/test/set/PROJ3' },
          ]
        }
        return orig(cmd, args)
      }
    })
    await openTools(page)

    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('across 2 projects')
    await summary.click()
    await expect(page.locator('.missing-samples-list-modal tbody')).not.toContainText('PROJ3')
  })

  test('Escape closes the Set list modal and stays on the Audio Pool page', async ({ page }) => {
    await openTools(page)
    await page.locator('.tools-missing-files-summary').click()
    const list = page.locator('.missing-samples-list-modal')
    await expect(list).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    expect(page.url()).toContain('/audio-pool')
    await expect(page.locator('.pool-tools-panel')).toBeVisible()
  })

  test('Escape closes the fix modal once the search is done, not while it runs', async ({ page }) => {
    await openTools(page)
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()
    const modal = page.locator('.fix-missing-modal')
    await expect(modal.getByRole('button', { name: 'Review changes' })).toBeEnabled()

    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    // Back on the Tools tab, not navigated away
    await expect(page.locator('.pool-tools-panel')).toBeVisible()
  })

  test('Apply fixes each project on its own, backing it up first', async ({ page }) => {
    await openTools(page)
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()
    const modal = page.locator('.fix-missing-modal')
    await modal.getByRole('button', { name: 'Review changes' }).click()
    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    await expect(modal.locator('.fix-search-steps')).toContainText('1 samples resolved in 1 project')
    await expect(modal.getByRole('button', { name: 'Done' })).toBeVisible()

    const fixes = await page.evaluate(() => (window as any).__fixCalls)
    expect(fixes).toHaveLength(1)
    expect(fixes[0].projectPath).toBe('/test/set/PROJ1')
    expect(fixes[0].resolutions).toEqual([
      { filename: 'lost1.wav', found_path: '/test/set/PROJ1/samples/lost1.wav', action: 'update_path', new_slot_path: 'samples/lost1.wav' },
    ])

    const backups = await page.evaluate(() => (window as any).__backupCalls)
    expect(backups.map((b: any) => b.projectPath)).toEqual(['/test/set/PROJ1'])
  })
})
