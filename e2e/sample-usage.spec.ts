import { test, expect, Page } from '@playwright/test'

/**
 * Sample Slots Usage Column E2E Tests
 *
 * Tests the "Used" column with mocked compute_sample_usage: count badge,
 * usage details popover (machine assignments and sample locks), and the
 * Used/Unused column filter.
 */

async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    const emptyUsage = () => Array(128).fill(null).map(() => [])

    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        switch (cmd) {
          case 'load_project_metadata':
            return {
              name: 'TestProject',
              tempo: 120.0,
              time_signature: '4/4',
              pattern_length: 16,
              os_version: '1.40F',
              current_state: {
                bank: 0, bank_name: 'BANK A', pattern: 0, part: 0, track: 0,
                midi_mode: 0, track_othermode: 0,
                audio_muted_tracks: [], audio_soloed_tracks: [], audio_cued_tracks: [],
                midi_muted_tracks: [], midi_soloed_tracks: [],
              },
              mixer_settings: { gain_ab: 0, gain_cd: 0, dir_ab: 0, dir_cd: 0, phones_mix: 0, main_level: 100, cue_level: 100 },
              memory_settings: { load_24bit_flex: false, dynamic_recorders: false, record_24bit: false, reserved_recorder_count: 8, reserved_recorder_length: 16, flex_ram_free_mb: 85.5 },
              midi_settings: { trig_channels: [1, 2, 3, 4, 5, 6, 7, 8], auto_channel: 10, clock_send: true, clock_receive: true, transport_send: true, transport_receive: true, prog_change_send: false, prog_change_send_channel: 1, prog_change_receive: false, prog_change_receive_channel: 1 },
              metronome_settings: { enabled: false, main_volume: 64, cue_volume: 64, pitch: 64, tonal: false, preroll: 0, time_signature_numerator: 4, time_signature_denominator: 4 },
              sample_slots: {
                flex_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i + 1, slot_type: 'Flex',
                  path: i < 3 ? `/samples/flex_${i}.wav` : null,
                  gain: null, loop_mode: null, timestretch_mode: null,
                  source_location: i < 3 ? 'Project' : null, file_exists: i < 3,
                  compatibility: i < 3 ? 'compatible' : null, file_format: null, bit_depth: null, sample_rate: null,
                })),
                static_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i + 1, slot_type: 'Static', path: null, gain: null, loop_mode: null,
                  timestretch_mode: null, source_location: null, file_exists: false,
                  compatibility: null, file_format: null, bit_depth: null, sample_rate: null,
                })),
              },
            }
          case 'compute_sample_usage': {
            ;(window as any).__usageComputedAt__ = Date.now()
            const flex = emptyUsage()
            flex[0] = [
              { bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
              { bank: 1, kind: 'lock', track: 2, part: null, pattern: 4, step: 11, audible: true },
              { bank: 3, kind: 'machine', track: 0, part: 2, pattern: null, step: null, audible: false },
            ]
            // slot 2: referenced by a machine assignment but never trigged
            flex[1] = [
              { bank: 2, kind: 'machine', track: 4, part: 1, pattern: null, step: null, audible: false },
            ]
            return { static_usage: emptyUsage(), flex_usage: flex }
          }
          case 'get_existing_banks':
            return []
          case 'load_single_bank':
            return null
          case 'load_project_banks':
            return []
          case 'get_audio_pool_status':
            return { exists: false, path: null, set_path: null }
          case 'check_project_in_set':
            return false
          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'check_missing_source_files':
            return 0
          case 'get_slot_audio_paths':
            return []
          case 'plugin:app|version':
            return '1.0.0'
          default:
            return null
        }
      },
      transformCallback: () => {},
    }
    ;(window as any).__TAURI__ = {
      invoke: (window as any).__TAURI_INTERNALS__.invoke,
    }
  })
}

async function openFlexTab(page: Page) {
  await page.goto('/#/project?path=/test/TestProject&name=TestProject')
  const flexTab = page.locator('.header-tab', { hasText: 'Flex' })
  await expect(flexTab).toBeVisible({ timeout: 10000 })
  await flexTab.click()
  await expect(page.locator('.samples-table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('Sample slots - Used column', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await openFlexTab(page)
  })

  test('usage is computed at project load, before any slots tab is opened', async ({ page }) => {
    // fresh page load without touching the Flex/Static tabs
    await page.goto('/#/project?path=/test/TestProject&name=TestProject')
    await expect(page.locator('.header-tab', { hasText: 'Flex' })).toBeVisible({ timeout: 10000 })
    await expect.poll(() => page.evaluate(() => (window as any).__usageComputedAt__ ?? null)).not.toBeNull()
  })

  test('the Used header label is centered with the kebab at the right edge', async ({ page }) => {
    const layout = await page.evaluate(() => {
      const th = document.querySelector('th.col-used') as HTMLElement
      const label = th.querySelector('.sortable-label') as HTMLElement
      const kebab = th.querySelector('.filter-icon') as HTMLElement
      const thBox = th.getBoundingClientRect()
      const labelBox = label.getBoundingClientRect()
      const kebabBox = kebab.getBoundingClientRect()
      const content = th.querySelector('.header-content')!.getBoundingClientRect()
      return {
        labelOffCenter: Math.abs(labelBox.x + labelBox.width / 2 - (thBox.x + thBox.width / 2)),
        kebabFromRight: content.x + content.width - (kebabBox.x + kebabBox.width),
      }
    })
    expect(layout.labelOffCenter).toBeLessThan(3) // label centered in the column
    expect(layout.kebabFromRight).toBeLessThan(3) // kebab at the right edge, like other headers
  })

  test('shows count badges on used slots and a dash on unused ones', async ({ page }) => {
    await expect(page.locator('th.col-used')).toBeVisible()
    const rows = page.locator('.samples-table tbody tr')
    // slot 1: audible + never-trigged usages -> both badges, side by side
    await expect(rows.nth(0).locator('.usage-badge:not(.referenced)')).toHaveText(/✓ 2/)
    await expect(rows.nth(0).locator('.usage-badge.referenced')).toHaveText(/○ 1/)
    const green = await rows.nth(0).locator('.usage-badge:not(.referenced)').boundingBox()
    const gray = await rows.nth(0).locator('.usage-badge.referenced').boundingBox()
    expect(Math.abs(green!.y - gray!.y)).toBeLessThan(5) // one line, not stacked like a duplicated badge
    // slot 2: referenced but never trigged -> gray circle badge only
    await expect(rows.nth(1).locator('.usage-badge.referenced')).toHaveText(/○ 1/)
    await expect(rows.nth(1).locator('.usage-badge:not(.referenced)')).toHaveCount(0)
    // slot 3: no references at all
    await expect(rows.nth(2).locator('.usage-badge')).toHaveCount(0)
    await expect(rows.nth(2).locator('.usage-none')).toHaveText('—')
  })

  test('the green badge opens a popover scoped to audible usages', async ({ page }) => {
    await page.locator('.usage-badge').first().click()
    const popover = page.locator('.usage-popover')
    await expect(popover).toBeVisible()
    await expect(popover.locator('.usage-popover-header')).toContainText('F1 played in 2 places')
    await expect(popover.locator('.usage-popover-entry').nth(0)).toHaveText('Bank A · Part 1 · T1 · Machine')
    await expect(popover.locator('.usage-popover-entry').nth(1)).toHaveText('Bank B · Pattern 5 · T3 · Step 12 · Lock')

    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('the gray badge opens a popover scoped to never-trigged references', async ({ page }) => {
    const rows = page.locator('.samples-table tbody tr')
    await rows.nth(1).locator('.usage-badge.referenced').click()
    const popover = page.locator('.usage-popover')
    await expect(popover.locator('.usage-popover-header')).toContainText('F2 referenced in 1 place but not triggered')
    await expect(popover.locator('.usage-popover-entry')).toHaveText('Bank C · Part 2 · T5 · Machine')
  })

  test('Used, Referenced and Unused filters narrow the rows', async ({ page }) => {
    const rows = page.locator('.samples-table tbody tr')
    await expect(rows).toHaveCount(128)

    // Columns must not reflow horizontally as filters change the visible rows
    const usageBox = async () => (await page.locator('th.col-used').boundingBox())!
    const initialBox = await usageBox()
    const expectStableColumns = async () => {
      const box = await usageBox()
      expect(Math.abs(box.x - initialBox.x)).toBeLessThan(1)
      expect(Math.abs(box.width - initialBox.width)).toBeLessThan(1)
    }

    await page.locator('th.col-used .filter-icon').click()
    await page.locator('.filter-dropdown .dropdown-option', { hasText: 'Used (plays)' }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('F1')
    await expectStableColumns()

    await page.locator('th.col-used .filter-icon').click()
    await page.locator('.filter-dropdown .dropdown-option', { hasText: 'Referenced, not triggered' }).click()
    // F1 plays elsewhere but still has one silent reference, so it qualifies too
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('F1')
    await expect(rows.nth(1)).toContainText('F2')
    await expectStableColumns()

    await page.locator('th.col-used .filter-icon').click()
    await page.locator('.filter-dropdown .dropdown-option', { hasText: 'Unused' }).click()
    await expect(rows).toHaveCount(126)
    await expectStableColumns()

    await page.locator('th.col-used .filter-icon').click()
    await page.locator('.filter-dropdown .dropdown-option', { hasText: 'All' }).click()
    await expect(rows).toHaveCount(128)
  })
})
