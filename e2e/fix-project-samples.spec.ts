import { test, expect, Page } from '@playwright/test'

/**
 * Fix Project Samples E2E Tests
 *
 * Covers the project-scoped counterpart to the Audio Pool's "Fix Audio Pool
 * Samples" tool (see fix-pool-files.spec.ts for the sibling coverage this
 * mirrors): the "Fix Project Samples" operation in the Tools tab, the
 * per-tab (Flex/Static) health glyph, and the "Convert to Octatrack format"
 * context-menu item on a Sample Slot row.
 *
 * Self-contained mock setup (not reusing tools-tab.spec.ts's setupTauriMocks,
 * which is a local, unexported helper in that file) — mirrors the self-contained
 * style already used by fix-pool-files.spec.ts.
 *
 * Scenario used throughout: project directory contains 4 audio files.
 *   - kick.mp3   - referenced by Flex slot 0, compatibility 'unknown'
 *   - snare48.wav - referenced by Static slot 0, compatibility 'wrong_rate'
 *   - loop.mp3   - NOT referenced by any slot, unsupported format (mp3)
 *   - good.wav   - NOT referenced by any slot, compatible (native, inspected)
 * So: 4 files scanned, 3 incompatible (kick.mp3, snare48.wav, loop.mp3).
 */
async function setupMocks(page: Page, options: { withAudioPool?: boolean } = {}) {
  const withAudioPool = options.withAudioPool ?? false
  await page.addInitScript((opts: { withAudioPool: boolean }) => {
    ;(window as any).__fixCalls = []
    ;(window as any).__backupCalls = []
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
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
                muted_tracks: [], soloed_tracks: [], midi_mode: 0, track_othermode: 0,
                audio_muted_tracks: [], audio_soloed_tracks: [], audio_cued_tracks: [],
                midi_muted_tracks: [], midi_soloed_tracks: [],
              },
              mixer_settings: { gain_ab: 0, gain_cd: 0, dir_ab: 0, dir_cd: 0, phones_mix: 0, main_level: 100, cue_level: 100 },
              memory_settings: {
                load_24bit_flex: false, dynamic_recorders: false, record_24bit: false,
                reserved_recorder_count: 8, reserved_recorder_length: 16, flex_ram_free_mb: 85.5,
              },
              midi_settings: {
                trig_channels: [1, 2, 3, 4, 5, 6, 7, 8], auto_channel: 10,
                clock_send: true, clock_receive: true, transport_send: true, transport_receive: true,
                prog_change_send: false, prog_change_send_channel: 1, prog_change_receive: false, prog_change_receive_channel: 1,
              },
              metronome_settings: {
                enabled: false, main_volume: 64, cue_volume: 64, pitch: 64, tonal: false,
                preroll: 0, time_signature_numerator: 4, time_signature_denominator: 4,
              },
              sample_slots: {
                flex_slots: Array(128).fill(null).map((_, i) => i === 0 ? {
                  slot_id: 0, slot_type: 'Flex', path: 'kick.mp3', gain: 0,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: true, compatibility: 'unknown', file_format: null,
                  bit_depth: null, sample_rate: null,
                } : {
                  slot_id: i, slot_type: 'Flex', path: null, gain: null,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: false, compatibility: null, file_format: null,
                  bit_depth: null, sample_rate: null,
                }),
                static_slots: Array(128).fill(null).map((_, i) => i === 0 ? {
                  slot_id: 0, slot_type: 'Static', path: 'snare48.wav', gain: 0,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: true, compatibility: 'wrong_rate', file_format: 'WAV',
                  bit_depth: 16, sample_rate: 48000,
                } : {
                  slot_id: i, slot_type: 'Static', path: null, gain: null,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: false, compatibility: null, file_format: null,
                  bit_depth: null, sample_rate: null,
                }),
              },
            }

          case 'load_project_banks':
            return Array(16).fill(null).map((_, i) => ({
              name: `BANK ${String.fromCharCode(65 + i)}`,
              index: i,
              parts: [
                { name: 'PART 1', patterns: [] },
                { name: 'PART 2', patterns: [] },
                { name: 'PART 3', patterns: [] },
                { name: 'PART 4', patterns: [] },
              ],
            }))

          case 'get_existing_banks':
            return [0]

          case 'load_single_bank': {
            const bankIndex = args?.bankIndex ?? 0
            return {
              name: `BANK ${String.fromCharCode(65 + bankIndex)}`,
              index: bankIndex,
              metadata: {
                load_24bit_flex: false, export_chain_parts: false,
                quantized_length: 'Default', trig_modes: Array(8).fill('One'),
              },
              parts: [
                { name: 'PART 1', patterns: [] },
                { name: 'PART 2', patterns: [] },
                { name: 'PART 3', patterns: [] },
                { name: 'PART 4', patterns: [] },
              ],
            }
          }

          case 'scan_devices':
            return { locations: [], standalone_projects: [] }

          case 'check_projects_in_same_set':
            return true

          case 'get_audio_pool_status':
            return opts.withAudioPool
              ? { exists: true, path: '/test/project/../AUDIO', set_path: '/test' }
              : { exists: false, path: null, set_path: null }

          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }

          case 'check_missing_source_files':
            return 0

          case 'get_slot_audio_paths':
            return []

          case 'validate_bank_sample_slots':
            return {
              static_needed: 0, flex_needed: 0, static_available: 128, flex_available: 128,
              static_dedup: 0, flex_dedup: 0, missing_files: 0,
              flex_ram_free_mb: 85.5, flex_ram_new_mb: 0, flex_ram_free_after_copy_mb: 85.5,
              flex_memory_warning: null, is_valid: true, error_message: null,
            }

          case 'backup_project_files':
            ;(window as any).__backupCalls.push(args)
            return '0 file(s) backed up'

          case 'plugin:app|version':
            return '1.0.0'

          // The recursive project-directory scan behind Fix Project Samples.
          // Includes the two referenced files (they are real files on disk)
          // plus two unreferenced ones: an unsupported mp3 and a compatible wav.
          case 'list_audio_files_recursive':
            if (args?.path === '/test/project') {
              return [
                '/test/project/kick.mp3',
                '/test/project/snare48.wav',
                '/test/project/loop.mp3',
                '/test/project/good.wav',
              ]
            }
            return []

          // Only native (wav/aiff) files not already known-incompatible via
          // slot metadata get inspected — here just the unreferenced good.wav.
          case 'inspect_audio_files':
            return (args?.paths ?? []).map((p: string) => ({
              path: p,
              compatibility: 'compatible',
            }))

          case 'list_audio_directory':
            return [
              { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: `${args?.path || ''}/kick.wav` },
            ]

          case 'fix_project_samples':
            ;(window as any).__fixCalls.push(args)
            return {
              outcomes: (args?.filePaths ?? []).map((p: string) => ({
                old_path: p,
                new_path: p.replace(/\.[^.]+$/, '.wav'),
                error: null,
              })),
              projects_updated: ['/test/project'],
              slots_updated: (args?.filePaths ?? []).length,
            }

          case 'plugin:event|listen':
            return 0
          case 'plugin:event|unlisten':
            return null
          case 'plugin:dialog|open':
            return null

          default:
            return null
        }
      },
      transformCallback: () => {},
    }
    ;(window as any).__TAURI__ = { invoke: (window as any).__TAURI_INTERNALS__.invoke }
  }, { withAudioPool })
}

async function openProjectPage(page: Page) {
  await page.goto('/#/project?path=/test/project&name=TestProject')
  await expect(page.locator('.header-tab', { hasText: 'Tools' })).toBeVisible({ timeout: 10000 })
}

test.describe('Fix Project Samples - Tools tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await openProjectPage(page)
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await page.locator('.tools-section .tools-select').selectOption('fix_project_samples')
  })

  test('scans referenced and unreferenced project files and shows a combined status count', async ({ page }) => {
    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('3')
    await expect(summary).toContainText('incompatible audio file')
    await expect(summary).toContainText('of 4 scanned')
  })

  test('opens the Incompatible Project Samples list modal with all 3 files', async ({ page }) => {
    await page.locator('.tools-missing-files-summary').click()
    const listModal = page.locator('.missing-samples-list-modal')
    await expect(listModal.getByText('Incompatible Project Samples')).toBeVisible()
    await expect(listModal.locator('tbody tr')).toHaveCount(3)
    await expect(listModal.locator('tbody')).toContainText('kick.mp3')
    await expect(listModal.locator('tbody')).toContainText('snare48.wav')
    await expect(listModal.locator('tbody')).toContainText('loop.mp3')
    await expect(listModal.locator('tbody')).not.toContainText('good.wav')
  })

  test('Execute opens the review modal, and Apply Changes calls fix_project_samples with the project path and file paths', async ({ page }) => {
    await expect(page.getByLabel('Review before applying changes')).toBeChecked()
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-pool-modal')
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('tbody tr')).toHaveCount(3)
    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    // ToolsPanel's onFixed callback only refreshes data - it does not close the
    // modal itself (mirrors AudioPoolPage's equivalent handler). The modal stays
    // open on its own "done" summary screen until the user clicks Close.
    await expect.poll(async () => page.evaluate(() => (window as any).__fixCalls.length)).toBe(1)
    await expect(modal.getByText('3 files converted.')).toBeVisible()

    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toHaveCount(0)

    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].projectPath).toBe('/test/project')
    expect(calls[0].filePaths).toEqual([
      '/test/project/kick.mp3',
      '/test/project/snare48.wav',
      '/test/project/loop.mp3',
    ])
  })

  test('disabling the review option makes Execute apply immediately', async ({ page }) => {
    await page.getByLabel('Review before applying changes').uncheck()
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.fix-pool-modal')
    await expect(modal.getByText('3 files converted.')).toBeVisible()
    await expect(modal.getByText('Review planned changes')).toHaveCount(0)

    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls[0].filePaths).toEqual([
      '/test/project/kick.mp3',
      '/test/project/snare48.wav',
      '/test/project/loop.mp3',
    ])
  })
})

test.describe('Fix Project Samples - health glyph', () => {
  test('the Flex tab glyph shows the incompatible count and clicking it opens Tools with Fix Project Samples pre-selected', async ({ page }) => {
    await setupMocks(page)
    await openProjectPage(page)
    await page.locator('.header-tab', { hasText: 'Flex' }).click()

    const glyph = page.locator('.pool-health-glyph.warning')
    await expect(glyph).toBeVisible()
    await expect(glyph).toHaveText('1') // only the Flex tab's own incompatible slot (kick.mp3)
    await expect(glyph).toHaveAttribute('title', '1 incompatible audio file found - click to fix')

    await glyph.click()
    await expect(page.locator('.header-tab.active', { hasText: 'Tools' })).toBeVisible()
    await expect(page.locator('.tools-section .tools-select')).toHaveValue('fix_project_samples')
  })

  test('the Static tab glyph is hidden while the Audio Pool pane is open', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openProjectPage(page)
    await page.locator('.header-tab', { hasText: 'Static' }).click()

    await expect(page.locator('.pool-health-glyph.warning')).toBeVisible()

    await page.locator('.audio-pool-toggle-btn').first().click()
    await expect(page.locator('.samples-tab.with-sidebar')).toBeVisible()
    await expect(page.locator('.pool-health-glyph.warning')).toHaveCount(0)
  })

  test('re-opening the Tools tab after the glyph is clicked does not keep re-forcing Fix Project Samples (one-shot pre-selection)', async ({ page }) => {
    await setupMocks(page)
    await openProjectPage(page)
    await page.locator('.header-tab', { hasText: 'Flex' }).click()
    await page.locator('.pool-health-glyph.warning').click()
    await expect(page.locator('.tools-section .tools-select')).toHaveValue('fix_project_samples')

    // Manually switch away from Fix Project Samples...
    await page.locator('.tools-section .tools-select').selectOption('copy_bank')
    // ...leave the Tools tab and come back: the manual choice must stick, not
    // get silently overridden back to fix_project_samples by a stale pre-selection.
    await page.locator('.header-tab', { hasText: 'Overview' }).click()
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await expect(page.locator('.tools-section .tools-select')).toHaveValue('copy_bank')
  })
})

test.describe('Fix Project Samples - Convert to Octatrack format context menu', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await openProjectPage(page)
    await page.locator('.header-tab', { hasText: 'Flex' }).click()
  })

  test('is disabled outside Edit mode', async ({ page }) => {
    const row = page.locator('tr', { hasText: 'kick.mp3' })
    await row.click({ button: 'right' })
    const item = page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' })
    await expect(item).toBeVisible()
    await expect(item).toBeDisabled()
  })

  test('calls fix_project_samples with the single resolved file path when clicked in Edit mode', async ({ page }) => {
    await page.locator('.mode-toggle').click() // View -> Edit
    await expect(page.locator('.mode-toggle-btn.active', { hasText: 'Edit' })).toBeVisible()

    const row = page.locator('tr', { hasText: 'kick.mp3' })
    await row.click({ button: 'right' })
    const item = page.locator('.context-menu-item', { hasText: 'Convert to Octatrack format' })
    await expect(item).toBeEnabled()
    await item.click()

    await expect.poll(async () => page.evaluate(() => (window as any).__fixCalls.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).__fixCalls)
    expect(calls[0].projectPath).toBe('/test/project')
    expect(calls[0].filePaths).toEqual(['/test/project/kick.mp3'])
  })
})
