import { test, expect, Page } from '@playwright/test'

/**
 * Purge Project Samples E2E Tests
 *
 * Covers the "Purge Project Samples" operation in the Project page's Tools
 * tab: the unused-file scan status button, the read-only preview list it
 * opens, the Delete/Move mode toggle's effect on the "Review before
 * applying changes" checkbox, and the Execute -> review -> Apply Changes
 * flow that calls `purge_project_files`.
 *
 * Self-contained mock setup mirroring e2e/fix-project-samples.spec.ts's
 * structure and style (own `load_project_metadata` fixture, own
 * `page.addInitScript`, same Tools-tab navigation helper), extended with
 * the purge-specific commands: `scan_project_unused_files`,
 * `purge_project_files`, `resolve_default_purge_destination`, and
 * `navigate_to_parent`.
 *
 * Scenario used throughout: the project directory contains exactly one
 * unused audio file, orphan.wav, not referenced by any sample slot.
 */
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__purgeCalls = []
    ;(window as any).__scanCalls = []
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        switch (cmd) {
          case 'scan_project_unused_files':
            ;(window as any).__scanCalls.push(args)
            return [
              { kind: 'File', path: '/projects/TestProject/orphan.wav', origin: 'TestProject', size: 2048, slots: [], sidecar: null },
            ]
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
                flex_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i, slot_type: 'Flex', path: null, gain: null,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: false, compatibility: null, file_format: null,
                  bit_depth: null, sample_rate: null,
                })),
                static_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i, slot_type: 'Static', path: null, gain: null,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: false, compatibility: null, file_format: null,
                  bit_depth: null, sample_rate: null,
                })),
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
            return { exists: false, path: null, set_path: null }

          case 'compute_sample_usage':
            return {
              flex_usage: Array(128).fill(null).map(() => []),
              static_usage: Array(128).fill(null).map(() => []),
            }

          case 'get_pool_usage':
            return {}

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
            return '0 file(s) backed up'

          case 'plugin:app|version':
            return '1.0.0'

          case 'list_audio_files_recursive':
            // 3 audio files in the project; only orphan.wav is unused. This
            // is the "of N scanned" denominator on the status button.
            return [
              '/projects/TestProject/orphan.wav',
              '/projects/TestProject/kick.wav',
              '/projects/TestProject/snare.wav',
            ]

          case 'inspect_audio_files':
            return []

          case 'list_audio_directory':
            return []

          case 'plugin:event|listen':
            return 0
          case 'plugin:event|unlisten':
            return null
          case 'plugin:dialog|open':
            return null
          case 'reveal_in_file_manager':
            return null

          // Purge-specific commands (Task 12's "Purge Project Samples" operation)

          case 'resolve_default_purge_destination':
            return '/home/testuser/Downloads'

          case 'navigate_to_parent':
            return args.path.split('/').slice(0, -1).join('/')

          case 'purge_project_files':
            ;(window as any).__purgeCalls.push(args)
            return {
              files_removed: [args.plan[0].path],
              dirs_removed: [],
              audio_files_removed: 1,
              non_audio_files_removed: 0,
              bytes_reclaimed: 2048,
              cancelled: false,
              slots_cleared: 0,
              projects_updated: [],
              errors: [],
            }

          default:
            return null
        }
      },
      transformCallback: () => {},
    }
    ;(window as any).__TAURI__ = { invoke: (window as any).__TAURI_INTERNALS__.invoke }
  })
}

async function openProjectPage(page: Page) {
  await page.goto('/#/project?path=/test/project&name=TestProject')
  await expect(page.locator('.header-tab', { hasText: 'Tools' })).toBeVisible({ timeout: 10000 })
}

async function openPurgeOperation(page: Page) {
  await openProjectPage(page)
  await page.locator('.header-tab', { hasText: 'Tools' }).click()
  await page.locator('.tools-section .tools-select').selectOption('purge_project_samples')
}

test.describe('Purge Project Samples', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
  })

  test('status button shows the unused file count and opens the preview list', async ({ page }) => {
    await openPurgeOperation(page)

    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('1')
    await expect(summary).toContainText('unused audio file')

    await summary.click()
    const listModal = page.locator('.missing-samples-list-modal')
    await expect(listModal.getByText('Unused Project Samples')).toBeVisible()

    await expect(listModal.locator('.missing-samples-header-count')).toHaveText('Showing 1 of 1 items')
    await expect(listModal.locator('tbody tr')).toHaveCount(1)
    await expect(listModal.locator('tbody')).toContainText('orphan.wav')

    // A single-row plan must not collapse the modal to a squat strip.
    expect(await listModal.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(355) // 360px floor, minus sub-pixel rounding
  })

  test('scanning shows a live percentage that advances as each background call resolves', async ({ page }) => {
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        // The loading state is gated on the "as-is" scan (simulateClearedSlots:
        // false) specifically - hold just that one back so the other 2 of the
        // 4 background calls resolve first and progress reads 75% (3/4).
        if (cmd === 'scan_project_unused_files' && args?.simulateClearedSlots === false) {
          await new Promise<void>(resolve => { (window as any).__releaseAsIsScan = resolve })
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)

    await expect(page.locator('.tools-fix-status.loading')).toContainText('75%')

    await page.evaluate(() => (window as any).__releaseAsIsScan())
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')
  })

  test('a collapsed directory lists its files tree-style and sorts before lone files', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__revealCalls = []
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'reveal_in_file_manager') {
          ;(window as any).__revealCalls.push(args?.path)
          return null
        }
        if (cmd === 'scan_project_unused_files') {
          return [
            {
              kind: 'File',
              path: '/projects/TestProject/orphan.wav',
              origin: 'TestProject',
              size: 2048,
              slots: [],
              sidecar: { path: '/projects/TestProject/orphan.ot', size: 256, slots: [], is_audio: false },
            },
            {
              kind: 'Directory',
              path: '/projects/TestProject/AUDIO/oldkit',
              origin: 'TestProject',
              file_count: 2,
              non_audio_count: 1,
              size: 3584,
              files: [
                { path: '/projects/TestProject/AUDIO/oldkit/clap.wav', size: 1024, slots: [], is_audio: true },
                { path: '/projects/TestProject/AUDIO/oldkit/cover.jpg', size: 512, slots: [], is_audio: false },
                { path: '/projects/TestProject/AUDIO/oldkit/kick.wav', size: 2048, slots: ['S1'], is_audio: true },
              ],
            },
          ]
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    const summary = page.locator('.tools-missing-files-summary')
    // 1 lone file + the directory's own file_count (2) = 3 unused audio
    // files - not 2 (which would be counting the directory as one item).
    // The swept-along cover.jpg is reported separately, never folded into
    // the "unused audio files" headline.
    await expect(summary).toContainText('3')
    // Real total from the recursive audio listing, not the unused count.
    // The related-file tail trails it: cover.jpg inside the directory plus
    // orphan.wav's own .ot sidecar.
    await expect(summary).toHaveText(/3 unused audio files - of 3 scanned \+ 2 related files/)

    await summary.click()
    const listModal = page.locator('.missing-samples-list-modal')
    await expect(listModal.getByText('Unused Project Samples')).toBeVisible()

    // Counts table ROWS, not plan units: 1 directory + its 3 children +
    // 1 lone file + its .ot sidecar. Counting units read "2 of 2".
    await expect(listModal.locator('.missing-samples-header-count')).toHaveText('Showing 6 of 6 items')

    // Directory row (with its three tree-style child rows) sorts before the lone file.
    const rows = listModal.locator('tbody tr')
    await expect(rows).toHaveCount(6)
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
    // Slot ID column - only kick.wav is still slot-loaded.
    await expect(rows.nth(3)).toContainText('S1')
    await expect(rows.nth(4)).toContainText('orphan.wav')
    // A lone file's .ot sidecar gets its own tree-child row, so nothing
    // leaves the disk unlisted.
    await expect(rows.nth(5)).toHaveClass(/purge-tree-child-non-audio/)
    await expect(rows.nth(5)).toContainText('orphan.ot')
    await expect(rows.nth(5)).toContainText('256 B')

    // Collapsing the directory hides its tree-child rows; expanding again restores them.
    await rows.nth(0).locator('.purge-dir-collapse-btn').click()
    await expect(listModal.locator('tbody tr')).toHaveCount(3)
    await expect(listModal.locator('tbody tr').nth(0)).not.toContainText('clap.wav')
    await rows.first().locator('.purge-dir-collapse-btn').click()
    await expect(listModal.locator('tbody tr')).toHaveCount(6)

    // Collapsing a directory takes its hidden children out of the count too.
    await rows.nth(0).locator('.purge-dir-collapse-btn').click()
    await expect(listModal.locator('.missing-samples-header-count')).toHaveText('Showing 3 of 6 items')
    await rows.first().locator('.purge-dir-collapse-btn').click()
    await expect(listModal.locator('.missing-samples-header-count')).toHaveText('Showing 6 of 6 items')

    // Searching matches files inside a collapsed directory, not just the
    // folder name - and narrows the tree to the hits.
    const search = listModal.locator('.header-search-input')
    await search.fill('clap')
    await expect(listModal.locator('tbody tr')).toHaveCount(2)
    await expect(listModal.locator('tbody tr').nth(0)).toContainText('oldkit')
    await expect(listModal.locator('tbody tr').nth(1)).toContainText('clap.wav')
    // Matching the folder itself keeps all of its children visible.
    await search.fill('oldkit')
    await expect(listModal.locator('tbody tr')).toHaveCount(4)
    await search.fill('')
    await expect(listModal.locator('tbody tr')).toHaveCount(6)

    // Right-click a tree-child row -> context menu with Open in file explorer + Copy file path,
    // each acting on that exact child file's path (not the parent directory's).
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const kickPath = '/projects/TestProject/AUDIO/oldkit/kick.wav'

    await rows.nth(3).click({ button: 'right' })
    let menu = page.locator('.context-menu')
    await expect(menu.getByText('Open in file explorer')).toBeVisible()
    await menu.getByText('Open in file explorer').click()
    await expect.poll(async () => page.evaluate(() => (window as any).__revealCalls)).toEqual([kickPath])

    await rows.nth(3).click({ button: 'right' })
    menu = page.locator('.context-menu')
    await menu.getByText('Copy file path').click()
    await expect(menu).toHaveCount(0)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(kickPath)

    // A plain left-click anywhere else dismisses the menu. The modal box
    // stops click propagation, so this only works with a capture-phase
    // listener - it silently regressed to "unclosable" without one.
    await rows.nth(3).click({ button: 'right' })
    await expect(page.locator('.context-menu')).toBeVisible()
    await listModal.locator('.modal-header h3').click()
    await expect(page.locator('.context-menu')).toHaveCount(0)
  })

  test('toggling Exclude backups/ directory and Clear unused sample slot assignments never re-scans the backend', async ({ page }) => {
    await openPurgeOperation(page)

    const summary = page.locator('.tools-missing-files-summary')
    await expect(summary).toContainText('1')

    // Both "as-is" and "slots simulated cleared" variants are pre-fetched
    // once in the background as soon as the operation is selected.
    await expect.poll(async () => page.evaluate(() => (window as any).__scanCalls.length)).toBe(2)

    const excludeBackupsCheckbox = page.getByLabel('Exclude backups/ directory')
    const clearSlotsCheckbox = page.getByLabel('Clear unused sample slot assignments')

    await excludeBackupsCheckbox.uncheck()
    await excludeBackupsCheckbox.check()
    await clearSlotsCheckbox.check()
    await clearSlotsCheckbox.uncheck()

    // No spinner should ever appear for these toggles - status stays visible throughout.
    await expect(summary).toContainText('1')
    await expect(page.locator('.tools-fix-status.loading')).toHaveCount(0)

    // Still exactly the 2 scans from the initial background prefetch.
    expect(await page.evaluate(() => (window as any).__scanCalls.length)).toBe(2)
  })

  test('Review before applying changes is forced on and disabled when Delete files is selected', async ({ page }) => {
    await openPurgeOperation(page)

    // Move files to folder is the default selection.
    await expect(page.getByRole('button', { name: 'Move files to folder' })).toHaveClass(/selected/)

    await page.getByRole('button', { name: 'Delete files' }).click()
    const reviewCheckbox = page.getByLabel('Review before applying changes')
    await expect(reviewCheckbox).toBeChecked()
    await expect(reviewCheckbox).toBeDisabled()

    await page.getByRole('button', { name: 'Move files to folder' }).click()
    await expect(reviewCheckbox).toBeEnabled()
    await expect(reviewCheckbox).toBeChecked()
  })

  test('Execute opens the review modal and Apply Changes calls purge_project_files', async ({ page }) => {
    await openPurgeOperation(page)

    // Wait for the scan to resolve before Execute is available.
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')

    // Move files to folder is the default selection - switch to Delete for
    // this test's Trash flow (destinationDir: null below).
    await page.getByRole('button', { name: 'Delete files' }).click()

    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal.getByText('Review planned changes')).toBeVisible()
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.locator('tbody')).toContainText('orphan.wav')

    // Review modal is the same width as the preview/status modal (no wider
    // 'fix-pool-modal' class), and its Name column isn't squashed to a fixed
    // width by the Fix modals' generic 4-column review-table CSS.
    await expect(modal).not.toHaveClass(/fix-pool-modal(?!-narrow)/)
    const nameColWidth = await modal.locator('.purge-units-table colgroup col').nth(1).evaluate(el => (el as HTMLElement).style.width)
    expect(nameColWidth).toBe('')

    // Same min-height floor as the preview modal, so the two match on a one-row plan.
    expect(await modal.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(355) // 360px floor, minus sub-pixel rounding

    // Summary banner: red for a delete, headline counts audio files, and the
    // destination reads as the Trash Bin rather than a folder path.
    const banner = modal.locator('.purge-confirm-banner')
    await expect(banner).toHaveClass(/purge-confirm-banner-danger/)
    await expect(banner.locator('.purge-confirm-headline')).toHaveText('1 audio file')
    await expect(banner.locator('.purge-confirm-sub')).toContainText('1 item')
    await expect(banner.locator('.purge-confirm-sub')).toContainText('0 directories')
    await expect(banner.locator('.purge-confirm-sub')).toContainText('2.0 KB')
    await expect(banner.locator('.purge-confirm-target')).toHaveText('will be sent to the Trash Bin')

    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    await expect.poll(async () => page.evaluate(() => (window as any).__purgeCalls.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).__purgeCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0].projectPath).toBe('/test/project')
    expect(calls[0].plan).toEqual([
      { kind: 'File', path: '/projects/TestProject/orphan.wav', origin: 'TestProject', size: 2048, slots: [], sidecar: null },
    ])
    expect(calls[0].clearUnusedSlots).toBe(false)
    expect(calls[0].destinationDir).toBe(null)

    // Mirrors Fix Project Samples' onFixed (fix-project-samples.spec.ts): the
    // review modal stays open on its own "done" summary screen until the
    // user clicks Close, rather than being torn down by the parent the
    // instant the purge call resolves.
    await expect(modal).toHaveCount(1)
    await expect(modal.getByText(/1 audio file,\s*sent to the Trash Bin\s*2\.0 KB reclaimed/)).toBeVisible()

    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toHaveCount(0)
  })

  test('the Move-mode review banner is orange, names the destination folder, and counts swept-along non-audio files', async ({ page }) => {
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'scan_project_unused_files') {
          return [{
            kind: 'Directory',
            path: '/projects/TestProject/AUDIO/oldkit',
            origin: 'TestProject',
            file_count: 2,
            non_audio_count: 3,
            size: 3584,
            files: [],
          }]
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    await expect(page.locator('.tools-missing-files-summary')).toContainText('2')

    // Move is the default action - no mode switch needed.
    await expect(page.locator('.tools-destination-path')).toHaveText('/home/testuser/Downloads')
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const banner = page.locator('.missing-samples-list-modal .purge-confirm-banner')
    await expect(banner).toBeVisible()
    // Orange (not the delete-mode red variant)
    await expect(banner).not.toHaveClass(/purge-confirm-banner-danger/)
    await expect(banner.locator('.purge-confirm-headline')).toHaveText('2 audio files + 3 related files')
    await expect(banner.locator('.purge-confirm-sub')).toContainText('1 directory')
    await expect(banner.locator('.purge-confirm-target')).toHaveText('will be moved to /home/testuser/Downloads')
  })

  test('the Slot column sorts by real slot number, not as text, keeping slot-less rows last', async ({ page }) => {
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'scan_project_unused_files') {
          const file = (name: string, slots: string[]) => ({
            kind: 'File',
            path: `/projects/TestProject/${name}.wav`,
            origin: 'TestProject',
            size: 1024,
            slots,
            sidecar: null,
          })
          return [
            file('e', ['S99']),
            file('c', ['S9']),
            file('d', ['S10']),
            file('a', ['F2']),
            file('none', []),
            file('b', ['S1']),
          ]
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    await page.locator('.tools-missing-files-summary').click()
    const listModal = page.locator('.missing-samples-list-modal')
    const slotCells = listModal.locator('tbody tr td.col-slot')

    await listModal.locator('th', { hasText: 'Slot' }).click()
    // Numeric, and flex grouped before static. Text sorting gave S1, S10,
    // S99, S9 - the reported bug.
    await expect(slotCells).toHaveText(['F2', 'S1', 'S9', 'S10', 'S99', '—'])

    // Reversing keeps the slot-less row last: "no slot" is an absence, not
    // a low value, so it never jumps to the top.
    await listModal.locator('th', { hasText: 'Slot' }).click()
    await expect(slotCells).toHaveText(['S99', 'S10', 'S9', 'S1', 'F2', '—'])
  })

  test('the Format column is hidden by default and filters the tree down to audio or non-audio files', async ({ page }) => {
    await page.addInitScript(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'scan_project_unused_files') {
          return [
            {
              kind: 'File',
              path: '/projects/TestProject/orphan.wav',
              origin: 'TestProject',
              size: 2048,
              slots: [],
              sidecar: { path: '/projects/TestProject/orphan.ot', size: 256, slots: [], is_audio: false },
            },
            {
              kind: 'Directory',
              path: '/projects/TestProject/AUDIO/oldkit',
              origin: 'TestProject',
              file_count: 1,
              non_audio_count: 1,
              size: 1536,
              files: [
                { path: '/projects/TestProject/AUDIO/oldkit/cover.jpg', size: 512, slots: [], is_audio: false },
                { path: '/projects/TestProject/AUDIO/oldkit/kick.wav', size: 1024, slots: [], is_audio: true },
              ],
            },
          ]
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    await page.locator('.tools-missing-files-summary').click()
    const listModal = page.locator('.missing-samples-list-modal')
    const rows = listModal.locator('tbody tr')
    await expect(rows).toHaveCount(5)

    // Hidden by default - the plan is overwhelmingly audio.
    await expect(listModal.locator('thead')).not.toContainText('Format')
    await listModal.locator('.column-visibility-btn').click()
    await listModal.getByText('Format', { exact: true }).click()
    await expect(listModal.locator('thead')).toContainText('Format')
    await listModal.locator('.column-visibility-btn').click()

    // Filter to non-audio: each parent stays as context, narrowed to its
    // non-audio children only.
    await listModal.locator('th.filterable-header', { hasText: 'Format' }).locator('.filter-icon').click()
    await page.locator('.filter-dropdown').getByText('Other', { exact: true }).click()
    await expect(rows).toHaveCount(4)
    await expect(listModal.locator('tbody')).toContainText('cover.jpg')
    await expect(listModal.locator('tbody')).toContainText('orphan.ot')
    await expect(listModal.locator('tbody')).not.toContainText('kick.wav')
    await expect(listModal.locator('.filter-badge')).toHaveText('Format: Other')

    // Filter to audio: the lone file survives on its own merit (it IS audio),
    // with its non-audio sidecar child hidden.
    await listModal.locator('th.filterable-header', { hasText: 'Format' }).locator('.filter-icon').click()
    await page.locator('.filter-dropdown').getByText('Audio', { exact: true }).click()
    // 3, not 4: orphan.wav keeps its own row but sheds its .ot child.
    await expect(rows).toHaveCount(3)
    await expect(listModal.locator('tbody')).toContainText('kick.wav')
    await expect(listModal.locator('tbody')).toContainText('orphan.wav')
    await expect(listModal.locator('tbody')).not.toContainText('cover.jpg')
    await expect(listModal.locator('tbody')).not.toContainText('orphan.ot')

    await listModal.locator('.reset-filters-btn').click()
    await expect(rows).toHaveCount(5)
  })

  test('executing shows a progress modal with position, current file and a working Cancel', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__cancelCalls = []
      const internals = (window as any).__TAURI_INTERNALS__
      const orig = internals.invoke
      internals.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'cancel_audio_transfer') {
          ;(window as any).__cancelCalls.push(args?.transferId)
          return true
        }
        if (cmd === 'purge_project_files') {
          // Record args up front: the wrapper hangs before delegating, so
          // orig's own __purgeCalls push has not happened yet.
          ;(window as any).__purgeArgs = args
          await new Promise<void>(resolve => { (window as any).__releasePurge = () => resolve() })
        }
        return orig(cmd, args)
      }
    })

    await openPurgeOperation(page)
    await expect(page.locator('.tools-missing-files-summary')).toContainText('1')
    await page.locator('.tools-execute-btn', { hasText: 'Execute' }).click()

    const modal = page.locator('.missing-samples-list-modal')
    await modal.getByRole('button', { name: 'Apply Changes' }).click()

    // Progress modal: N / M position plus the file currently being handled,
    // instead of the old bare "Moving..." spinner.
    const progress = modal.locator('.fix-pool-progress')
    await expect(progress.locator('.fix-step-label')).toHaveText('Moving 1 / 1')
    await expect(progress.locator('.fix-pool-progress-file')).toHaveText('orphan.wav')

    // A transfer id is passed through so the backend can tag its events and
    // register a matching cancellation token.
    const purgeArgs = await page.evaluate(() => (window as any).__purgeArgs)
    expect(typeof purgeArgs.transferId).toBe('string')
    expect(purgeArgs.transferId.length).toBeGreaterThan(0)

    // Cancel targets that same transfer, and disables itself so the request
    // can't be fired twice while the current item finishes.
    const cancel = progress.getByRole('button', { name: 'Cancel' })
    await cancel.click()
    expect(await page.evaluate(() => (window as any).__cancelCalls)).toEqual([purgeArgs.transferId])
    await expect(cancel).toBeDisabled()
    await expect(progress.locator('.fix-step-label')).toContainText('then stopping')

    await page.evaluate(() => (window as any).__releasePurge())
    await expect(modal.getByText('reclaimed')).toBeVisible()
  })

  test('Move mode with review unchecked skips the review screen entirely and calls purge_project_files directly', async ({ page }) => {
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
    expect(calls[0].projectPath).toBe('/test/project')
    expect(calls[0].plan).toEqual([
      { kind: 'File', path: '/projects/TestProject/orphan.wav', origin: 'TestProject', size: 2048, slots: [], sidecar: null },
    ])
    expect(calls[0].destinationDir).toBe('/home/testuser/Downloads')

    // Modal lands directly on its "done" summary screen (skipReview jumps
    // straight from mount to the removing/done phases).
    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal.getByText(/1 audio file,\s*moved to \/home\/testuser\/Downloads\s*2\.0 KB reclaimed/)).toBeVisible()
  })
})
