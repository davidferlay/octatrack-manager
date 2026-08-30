import { test, expect, Page } from '@playwright/test'

/**
 * Tools Tab E2E Tests
 *
 * These tests use mock Tauri responses to test the Tools tab UI without the full Tauri backend.
 * The mock data simulates a loaded Octatrack project with banks, patterns, and sample slots.
 */

// Helper to inject Tauri mocks before page load
async function setupTauriMocks(page: Page, overrides?: { sameSet?: boolean; withOtherProject?: boolean; withAudioPool?: boolean }) {
  const sameSet = overrides?.sameSet ?? true
  const withOtherProject = overrides?.withOtherProject ?? false
  const withAudioPool = overrides?.withAudioPool ?? false
  await page.addInitScript((opts: { sameSet: boolean; withOtherProject: boolean; withAudioPool: boolean }) => {
    // Mock Tauri internals
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        console.log('Mock Tauri invoke:', cmd, args)

        switch (cmd) {
          case 'load_project_metadata':
            return {
              name: 'TestProject',
              tempo: 120.0,
              time_signature: '4/4',
              pattern_length: 16,
              os_version: '1.40F',
              current_state: {
                bank: 0,
                bank_name: 'BANK A',
                pattern: 0,
                part: 0,
                track: 0,
                muted_tracks: [],
                soloed_tracks: [],
                midi_mode: 0,
                track_othermode: 0,
                audio_muted_tracks: [],
                audio_soloed_tracks: [],
                audio_cued_tracks: [],
                midi_muted_tracks: [],
                midi_soloed_tracks: [],
              },
              mixer_settings: {
                gain_ab: 0,
                gain_cd: 0,
                dir_ab: 0,
                dir_cd: 0,
                phones_mix: 0,
                main_level: 100,
                cue_level: 100,
              },
              memory_settings: {
                load_24bit_flex: false,
                dynamic_recorders: false,
                record_24bit: false,
                reserved_recorder_count: 8,
                reserved_recorder_length: 16,
                flex_ram_free_mb: 85.5,
              },
              midi_settings: {
                trig_channels: [1, 2, 3, 4, 5, 6, 7, 8],
                auto_channel: 10,
                clock_send: true,
                clock_receive: true,
                transport_send: true,
                transport_receive: true,
                prog_change_send: false,
                prog_change_send_channel: 1,
                prog_change_receive: false,
                prog_change_receive_channel: 1,
              },
              metronome_settings: {
                enabled: false,
                main_volume: 64,
                cue_volume: 64,
                pitch: 64,
                tonal: false,
                preroll: 0,
                time_signature_numerator: 4,
                time_signature_denominator: 4,
              },
              sample_slots: {
                flex_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i,
                  slot_type: 'Flex',
                  path: i < 10 ? `/samples/flex_${i}.wav` : null,
                  gain: i < 10 ? 0 : null,
                  loop_mode: null,
                  timestretch_mode: null,
                  source_location: null,
                  file_exists: i < 10,
                  compatibility: null,
                  file_format: null,
                  bit_depth: null,
                  sample_rate: null,
                })),
                static_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i,
                  slot_type: 'Static',
                  path: i < 5 ? `/samples/static_${i}.wav` : null,
                  gain: i < 5 ? 0 : null,
                  loop_mode: null,
                  timestretch_mode: null,
                  source_location: null,
                  file_exists: i < 5,
                  compatibility: null,
                  file_format: null,
                  bit_depth: null,
                  sample_rate: null,
                })),
              },
            }

          case 'load_project_banks':
            return Array(16).fill(null).map((_, i) => ({
              name: `${args?.path === '/test/other-project' ? 'OTHER' : 'BANK'} ${String.fromCharCode(65 + i)}`,
              index: i,
              parts: [
                { name: 'PART 1', patterns: Array(16).fill(null).map((_, j) => ({
                  name: `Pattern ${j + 1}`,
                  part_assignment: 0,
                  length: 16,
                  scale_mode: 'Normal',
                  master_scale: '1x',
                  chain_mode: 'OFF',
                  tracks: Array(16).fill(null).map((_, k) => ({
                    track_id: k < 8 ? `T${k + 1}` : `M${k - 7}`,
                    track_type: k < 8 ? 'Audio' : 'MIDI',
                    steps: [],
                    swing_amount: 0,
                    pattern_settings: { trig_mode: 'ONE', trig_quant: 'DIRECT', start_silent: false, plays_free: false, oneshot_trk: false },
                  }))
                })) },
                { name: 'PART 2', patterns: [] },
                { name: 'PART 3', patterns: [] },
                { name: 'PART 4', patterns: [] },
              ],
            }))

          case 'get_existing_banks':
            // The other project holds fewer banks, so a source pane pointed at it
            // is visibly reading that project and not the one on screen.
            return args?.path === '/test/other-project' ? [0, 1] : [0, 1, 2, 3]

          case 'scan_devices':
            if (opts.withOtherProject) {
              return {
                locations: [{
                  name: 'TestLocation',
                  path: '/test/location',
                  device_type: 'LocalCopy',
                  sets: [{
                    name: 'Set1',
                    path: '/test/location/Set1',
                    has_audio_pool: false,
                    projects: [
                      { name: 'TestProject', path: '/test/project', has_project_file: true, has_banks: true },
                      { name: 'OtherProject', path: '/test/other-project', has_project_file: true, has_banks: true },
                    ],
                  }],
                }],
                standalone_projects: [],
              }
            }
            return { locations: [], standalone_projects: [] }

          case 'plugin:dialog|open':
            return (window as any).__browseDialogResult__ ?? null

          case 'scan_custom_directory':
            return (window as any).__scanCustomResult__ ?? { locations: [], standalone_projects: [] }

          case 'check_project_in_set':
            return true

          case 'check_projects_in_same_set':
            return opts.sameSet

          case 'get_audio_pool_status':
            return opts.withAudioPool
              ? { exists: true, path: '/test/set/AUDIO', set_path: '/test/set' }
              : { exists: false, path: null, set_path: '/test/set' }

          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }

          case 'check_missing_source_files':
            return 0

          case 'get_slot_audio_paths':
            return []

          case 'reveal_in_file_manager':
            (window as any).__lastRevealPath__ = args?.path
            return null

          case 'backup_project_files':
            if (!(window as any).__backupCalls__) (window as any).__backupCalls__ = []
            ;(window as any).__backupCalls__.push(args)
            return '0 file(s) backed up'

          case 'plugin:app|version':
            return '1.0.0'

          case 'load_single_bank': {
            const bankIndex = args?.bankIndex ?? 0
            return {
              name: `BANK ${String.fromCharCode(65 + bankIndex)}`,
              index: bankIndex,
              metadata: {
                load_24bit_flex: false,
                export_chain_parts: false,
                quantized_length: 'Default',
                trig_modes: Array(8).fill('One'),
              },
              parts: [
                {
                  name: 'PART 1',
                  patterns: Array(16).fill(null).map((_, j) => ({
                    name: `Pattern ${j + 1}`,
                    part_assignment: 0,
                    length: 16,
                    scale_mode: 'Normal',
                    master_scale: '1x',
                    chain_mode: 'OFF',
                    tracks: Array(16).fill(null).map((_, k) => ({
                      track_id: k < 8 ? `T${k + 1}` : `M${k - 7}`,
                      track_type: k < 8 ? 'Audio' : 'MIDI',
                      steps: [],
                      swing_amount: 0,
                      pattern_settings: { trig_mode: 'ONE', trig_quant: 'DIRECT', start_silent: false, plays_free: false, oneshot_trk: false },
                    }))
                  }))
                },
                { name: 'PART 2', patterns: [] },
                { name: 'PART 3', patterns: [] },
                { name: 'PART 4', patterns: [] },
              ],
            }
          }

          case 'copy_sample_slots':
            (window as any).__lastInvokeArgs__ = args
            return { shared_files_kept: 0 }

          case 'copy_bank':
            (window as any).__lastCopyBankArgs__ = args;
            ((window as any).__copyBankCalls__ ||= []).push(args);
            return {
              slots_copied_static: 0,
              slots_copied_flex: 0,
              slots_deduplicated: 0,
              shared_files_kept: 0,
              remap_log: [],
            }

          case 'validate_bank_sample_slots':
            (window as any).__lastValidateArgs__ = args
            return {
              static_needed: 3,
              flex_needed: 2,
              static_available: 120,
              flex_available: 125,
              static_dedup: 1,
              flex_dedup: 0,
              missing_files: 0,
              flex_ram_free_mb: 44.0,
              flex_ram_new_mb: 5.0,
              flex_ram_free_after_copy_mb: 39.0,
              flex_memory_warning: null,
              is_valid: true,
              error_message: null,
            }

          // Capture the payload, not just the fact of the call. Without this the suite
          // only ever proved which toggle *looks* selected - the panel could display
          // "Keep Original" and send copy_source_part and every test stayed green.
          case 'copy_parts':
          case 'copy_patterns':
          case 'copy_tracks':
            (window as any).__lastCopyArgs__ = { cmd, args }
            ;((window as any).__copyCalls__ ||= []).push({ cmd, args })
            return null

          case 'list_missing_samples':
            return [
              { filename: 'kick.wav', original_path: 'kick.wav', slot_type: 'flex', flex_slot_ids: [1], static_slot_ids: [] },
              { filename: 'snare.wav', original_path: 'snare.wav', slot_type: 'static', flex_slot_ids: [], static_slot_ids: [5] },
              { filename: 'hihat.wav', original_path: 'hihat.wav', slot_type: 'both', flex_slot_ids: [3], static_slot_ids: [3] },
            ]

          case 'search_project_dir':
            return [{ filename: 'kick.wav', found_path: '/test/project/kick.wav', source_project: null }]

          case 'search_audio_pool':
            return []

          case 'search_other_projects':
            return []

          case 'search_directory':
            return []

          case 'fix_missing_samples':
            return { resolved_count: 1, files_copied: 0, files_moved: 0, projects_updated: ['/test/project'] }

          default:
            console.warn('Unhandled mock invoke:', cmd)
            return null
        }
      },
      transformCallback: () => {},
    }

    // Also set up window.__TAURI__ for compatibility
    ;(window as any).__TAURI__ = {
      invoke: (window as any).__TAURI_INTERNALS__.invoke,
    }
  }, { sameSet, withOtherProject, withAudioPool })
}

test.describe('Tools Tab - UI Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    // Wait for React to render with mock data
    await page.waitForTimeout(2000)
  })

  test('Tools tab is visible in project header', async ({ page }) => {
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await expect(toolsTab).toBeVisible({ timeout: 10000 })
  })

  test('clicking Tools tab shows Tools panel', async ({ page }) => {
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()

    // Tools panel should be visible with operation selector
    const operationSelect = page.locator('.tools-section .tools-select')
    await expect(operationSelect).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Tools Tab - Operation Selector', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)
  })

  test('operation selector has all 5 copy operations', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await expect(operationSelect).toBeVisible()

    // Check all options are present
    await expect(operationSelect.locator('option[value="copy_bank"]')).toHaveText('Copy Banks')
    await expect(operationSelect.locator('option[value="copy_parts"]')).toHaveText('Copy Parts')
    await expect(operationSelect.locator('option[value="copy_patterns"]')).toHaveText('Copy Patterns')
    await expect(operationSelect.locator('option[value="copy_tracks"]')).toHaveText('Copy Tracks')
    await expect(operationSelect.locator('option[value="copy_sample_slots"]')).toHaveText('Copy Sample Slots')
  })

  test('switching operations updates the UI', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')

    // Switch to Copy Sample Slots
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)

    // Should show Slot Type options
    await expect(page.getByText('Slot Type')).toBeVisible()
    await expect(page.getByText('Audio Files')).toBeVisible()

    // Switch to Copy Patterns
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)

    // Should show Part Assignment options (use locator to avoid matching description text)
    const partAssignmentField = page.locator('.tools-field').filter({ hasText: 'Part Assignment' })
    await expect(partAssignmentField).toBeVisible()
  })

  test('Copy Patterns specific tracks do not bleed into Copy Tracks source', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    const optionsPanel = page.locator('.tools-options-panel')
    const sourcePanel = page.locator('.tools-source-panel')

    // Go to Copy Patterns, enable Specific Tracks, select T1 and T2
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
    const specificBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificBtn.click()
    await page.waitForTimeout(200)
    const trackButtons = optionsPanel.locator('.tools-multi-select.tracks-stacked')
    await trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T1' }).click()
    await page.waitForTimeout(100)
    await trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T2' }).click()
    await page.waitForTimeout(100)

    // Positive control: prove the selection actually took, otherwise the
    // "does not bleed" assertions below hold trivially.
    await expect(trackButtons.locator('.tools-multi-btn.track-btn.selected')).toHaveCount(2)

    // Switch to Copy Tracks
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)

    // Source tracks should be empty (no bleeding from Copy Patterns)
    const selectedSourceTracks = sourcePanel.locator('.tools-multi-btn.track-btn.selected')
    await expect(selectedSourceTracks).toHaveCount(0)

    // All source track buttons should be enabled
    const audioTrackButtons = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: /^T[1-8]$/ })
    for (let i = 0; i < 8; i++) {
      await expect(audioTrackButtons.nth(i)).not.toHaveClass(/disabled/)
    }
    const midiTrackButtons = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: /^M[1-8]$/ })
    for (let i = 0; i < 8; i++) {
      await expect(midiTrackButtons.nth(i)).not.toHaveClass(/disabled/)
    }
  })

  test('Copy Tracks source tracks do not bleed into Copy Patterns specific tracks', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    const sourcePanel = page.locator('.tools-source-panel')
    const optionsPanel = page.locator('.tools-options-panel')

    // Go to Copy Tracks, select source T3
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
    await sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T3' }).click()
    await page.waitForTimeout(200)

    // Switch to Copy Patterns, enable Specific Tracks
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
    const specificBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificBtn.click()
    await page.waitForTimeout(200)

    // No tracks should be selected (no bleeding from Copy Tracks)
    const trackButtons = optionsPanel.locator('.tools-multi-select.tracks-stacked')
    const selectedTracks = trackButtons.locator('.tools-multi-btn.track-btn.selected')
    await expect(selectedTracks).toHaveCount(0)
  })

  test('Copy Patterns specific tracks persist when switching away and back', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    const optionsPanel = page.locator('.tools-options-panel')

    // Go to Copy Patterns, enable Specific Tracks, select T1 and M3
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
    const specificBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificBtn.click()
    await page.waitForTimeout(200)
    const trackButtons = optionsPanel.locator('.tools-multi-select.tracks-stacked')
    await trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T1' }).click()
    await page.waitForTimeout(100)
    await trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'M3' }).click()
    await page.waitForTimeout(100)

    // Switch to Copy Tracks then back
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)

    // Re-enable Specific Tracks and verify selections persisted
    await specificBtn.click()
    await page.waitForTimeout(200)
    const trackButtonsAfter = optionsPanel.locator('.tools-multi-select.tracks-stacked')
    await expect(trackButtonsAfter.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })).toHaveClass(/selected/)
    await expect(trackButtonsAfter.locator('.tools-multi-btn.track-btn', { hasText: 'M3' })).toHaveClass(/selected/)
  })
})

test.describe('Tools Tab - Copy Sample Slots Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Sample Slots operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)
  })

  test('Slot Type has three toggle buttons', async ({ page }) => {
    const slotTypeLabel = page.getByText('Slot Type')
    await expect(slotTypeLabel).toBeVisible()

    // Find toggle buttons near the Slot Type label
    const toggleButtons = page.locator('.tools-toggle-btn')
    const slotTypeButtons = toggleButtons.filter({ hasText: /Flex|Static/ })
    await expect(slotTypeButtons).toHaveCount(3)
  })

  test('Flex is selected by default', async ({ page }) => {
    const flexBtn = page.locator('.tools-toggle-btn').filter({ hasText: /^Flex$/ })
    await expect(flexBtn).toHaveClass(/selected/)
  })

  test('clicking Slot Type button changes selection', async ({ page }) => {
    const flexBtn = page.locator('.tools-toggle-btn').filter({ hasText: /^Flex$/ })
    const staticFlexBtn = page.locator('.tools-toggle-btn', { hasText: 'Static + Flex' })

    await flexBtn.click()
    await page.waitForTimeout(200)

    await expect(flexBtn).toHaveClass(/selected/)
    await expect(staticFlexBtn).not.toHaveClass(/selected/)
  })

  test('Sample Assignments has Copy/Don\'t Copy toggle', async ({ page }) => {
    await expect(page.getByText('Sample Assignments')).toBeVisible()

    const copyBtn = page.locator('.tools-toggle-btn', { hasText: /^Copy$/ }).first()
    const dontCopyBtn = page.locator('.tools-toggle-btn', { hasText: "Don't Copy" }).first()

    await expect(copyBtn).toBeVisible()
    await expect(dontCopyBtn).toBeVisible()
  })

  test('Copy is selected by default for Sample Assignments', async ({ page }) => {
    const copyBtn = page.locator('.tools-toggle-btn', { hasText: /^Copy$/ }).first()
    await expect(copyBtn).toHaveClass(/selected/)
  })

  test('Audio Files sub-options visible when assignments Copy selected', async ({ page }) => {
    await expect(page.getByText('Audio Files')).toBeVisible()

    const mirrorBtn = page.locator('.tools-toggle-btn', { hasText: 'Mirror' })
    const copyAllBtn = page.locator('.tools-toggle-btn', { hasText: 'Copy to project' })
    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })

    await expect(mirrorBtn).toBeVisible()
    await expect(copyAllBtn).toBeVisible()
    await expect(moveToPoolBtn).toBeVisible()
  })

  test('Audio Files sub-options hidden when assignments Don\'t Copy selected', async ({ page }) => {
    const dontCopyBtn = page.locator('.tools-toggle-btn', { hasText: "Don't Copy" }).first()
    await dontCopyBtn.click()
    await page.waitForTimeout(200)

    await expect(page.locator('.tools-toggle-btn', { hasText: 'Mirror' })).not.toBeVisible()
  })

  test('Sample Attributes has Copy/Don\'t Copy toggle with attribute list', async ({ page }) => {
    await expect(page.getByText('Sample Attributes')).toBeVisible()

    // Default is Don't Copy — attribute rows should be hidden
    await expect(page.locator('.tools-attr-row', { hasText: 'Gain' })).not.toBeVisible()

    // Click Copy to show attribute list
    const attrSection = page.locator('.tools-field:has(label:text("Sample Attributes"))')
    await attrSection.locator('.tools-toggle-btn', { hasText: /^Copy$/ }).click()
    await page.waitForTimeout(200)

    // Attribute rows should now be visible
    await expect(page.locator('.tools-attr-row', { hasText: 'Gain' })).toBeVisible()
    await expect(page.locator('.tools-attr-row', { hasText: 'BPM / Tempo' })).toBeVisible()
    await expect(page.locator('.tools-attr-row', { hasText: 'Slices' })).toBeVisible()
    await expect(page.getByText('Select all')).toBeVisible()
    await expect(page.locator('.tools-attribute-actions').getByText('None')).toBeVisible()
  })

  test('Attribute list hidden when attributes Don\'t Copy selected', async ({ page }) => {
    // First enable Copy for attributes
    const attrSection = page.locator('.tools-field:has(label:text("Sample Attributes"))')
    await attrSection.locator('.tools-toggle-btn', { hasText: /^Copy$/ }).click()
    await page.waitForTimeout(200)
    await expect(page.locator('.tools-attr-row', { hasText: 'Gain' })).toBeVisible()

    // Now click Don't Copy for Sample Attributes
    await attrSection.locator('.tools-toggle-btn', { hasText: "Don't Copy" }).click()
    await page.waitForTimeout(200)

    await expect(page.locator('.tools-attr-row', { hasText: 'Gain' })).not.toBeVisible()
  })

  test('Individual attribute toggles work independently', async ({ page }) => {
    // Enable Copy for attributes by clicking the Copy button next to "Sample Attributes" label
    const attrSection = page.locator('.tools-field:has(label:text("Sample Attributes"))')
    const attrCopyBtn = attrSection.locator('.tools-toggle-btn', { hasText: /^Copy$/ })
    await attrCopyBtn.click()
    await page.waitForTimeout(300)

    // All attributes should be selected by default
    const gainBtn = page.locator('button.tools-attr-row', { hasText: 'Gain' })
    await expect(gainBtn).toBeVisible()
    await expect(gainBtn).toHaveClass(/selected/)

    // Click Gain to deselect it
    await gainBtn.click()
    await page.waitForTimeout(200)

    // Gain should be deselected, but BPM should still be selected
    await expect(gainBtn).not.toHaveClass(/selected/)
    const bpmBtn = page.locator('button.tools-attr-row', { hasText: 'BPM / Tempo' })
    await expect(bpmBtn).toHaveClass(/selected/)
  })

  test('None button deselects all, then individual select works', async ({ page }) => {
    // Enable Copy for attributes
    const attrSection = page.locator('.tools-field:has(label:text("Sample Attributes"))')
    await attrSection.locator('.tools-toggle-btn', { hasText: /^Copy$/ }).click()
    await page.waitForTimeout(300)

    // Click None to deselect all
    await page.locator('.tools-attribute-actions').getByText('None').click()
    await page.waitForTimeout(200)

    // All should be deselected
    const selectedAttrs = page.locator('button.tools-attr-row.selected')
    await expect(selectedAttrs).toHaveCount(0)

    // Click Gain to select it individually
    const gainBtn = page.locator('button.tools-attr-row', { hasText: 'Gain' })
    await gainBtn.click()
    await page.waitForTimeout(200)

    await expect(gainBtn).toHaveClass(/selected/)
    // Only 1 should be selected
    await expect(page.locator('button.tools-attr-row.selected')).toHaveCount(1)
  })

  test('Execute sends correct attribute_selection with partial selection', async ({ page }) => {
    // Enable Copy for attributes
    const attrSection = page.locator('.tools-field:has(label:text("Sample Attributes"))')
    await attrSection.locator('.tools-toggle-btn', { hasText: /^Copy$/ }).click()
    await page.waitForTimeout(300)

    // Click None, then select only Gain and Slices
    await page.locator('.tools-attribute-actions').getByText('None').click()
    await page.waitForTimeout(200)
    await page.locator('button.tools-attr-row', { hasText: 'Gain' }).click()
    await page.locator('button.tools-attr-row', { hasText: 'Slices' }).click()
    await page.waitForTimeout(200)

    // Execute and check the invoke args
    const executeBtn = page.locator('.tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(1000)

    const lastCall = await page.evaluate(() => (window as any).__lastInvokeArgs__)
    expect(lastCall?.attributeSelection).toEqual(['gain', 'slices'])
  })

  test('Execute sends empty attributeSelection when attributes Don\'t Copy', async ({ page }) => {
    // Attributes default to Don't Copy, just execute
    const executeBtn = page.locator('.tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(1000)

    const lastCall = await page.evaluate(() => (window as any).__lastInvokeArgs__)
    expect(lastCall?.attributeSelection).toEqual([])
  })

  test('Both Don\'t Copy disables Execute button', async ({ page }) => {
    // Set Assignments to Don't Copy
    const dontCopyBtns = page.locator('.tools-toggle-btn', { hasText: "Don't Copy" })
    await dontCopyBtns.first().click()
    await page.waitForTimeout(200)

    // Attributes already defaults to Don't Copy
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Move to Pool is enabled when projects are in the same Set', async ({ page }) => {
    // Default mock returns check_projects_in_same_set: true
    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await expect(moveToPoolBtn).toBeEnabled()
  })

  test('Copy mode backup does not include source project backup', async ({ page }) => {
    // Clear any previous backup calls
    await page.evaluate(() => { (window as any).__backupCalls__ = [] })

    // Copy is already selected by default, click Execute
    const executeBtn = page.locator('.tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(1000)

    // Check backup calls — only destination backup, no source backup
    const backupCalls = await page.evaluate(() => (window as any).__backupCalls__ || [])
    expect(backupCalls.length).toBe(1)
    expect(backupCalls[0].label).toBe('copy_sample_slots')
  })

  test('Move to Pool backup includes source project.work', async ({ page }) => {
    // Clear any previous backup calls
    await page.evaluate(() => { (window as any).__backupCalls__ = [] })

    // Select Move to Pool mode
    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await moveToPoolBtn.click()
    await page.waitForTimeout(200)

    // Click Execute
    const executeBtn = page.locator('.tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(1000)

    // Check backup calls
    const backupCalls = await page.evaluate(() => (window as any).__backupCalls__ || [])
    expect(backupCalls.length).toBe(2)

    // First call: destination backup (project.work, markers.work)
    expect(backupCalls[0].files).toContain('project.work')
    expect(backupCalls[0].files).toContain('markers.work')
    expect(backupCalls[0].label).toBe('copy_sample_slots')

    // Second call: source backup (project.work + audio files)
    expect(backupCalls[1].files).toContain('project.work')
    expect(backupCalls[1].label).toBe('move_to_pool_source')
  })
})

test.describe('Tools Tab - Destination Modal Browse', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, { sameSet: false, withOtherProject: true })
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)

    await page.locator('.tools-dest-panel .tools-project-selector-btn').click()
    await expect(page.locator('.project-selector-modal')).toBeVisible()
  })

  const browseBtn = (page: Page) =>
    page.locator('.project-selector-modal .scan-button', { hasText: 'Browse...' })

  test('Browse offers every project found under the selected folder', async ({ page }) => {
    // like the homepage, browsing a plain folder scans it recursively
    await page.evaluate(() => {
      ;(window as any).__browseDialogResult__ = '/browse/root'
      ;(window as any).__scanCustomResult__ = {
        locations: [{
          name: 'root', path: '/browse/root', device_type: 'LocalCopy',
          sets: [{
            name: 'SetX', path: '/browse/root/SetX', has_audio_pool: false,
            projects: [{ name: 'SetProject', path: '/browse/root/SetX/SetProject', has_project_file: true, has_banks: true }],
          }],
        }],
        standalone_projects: [
          { name: 'LooseProject', path: '/browse/root/LooseProject', has_project_file: true, has_banks: true },
        ],
      }
    })
    await browseBtn(page).click()

    const manualSection = page.locator('.project-selector-manual')
    await expect(manualSection).toBeVisible()
    await expect(manualSection.locator('h4')).toContainText('Manual Browse - 2 Projects')
    await expect(manualSection.locator('.project-selector-card')).toHaveCount(2)

    // the section is collapsible, open by default after a browse; the closed
    // state collapses to zero height (grid-template-rows: 0fr + overflow hidden)
    const contentHeight = async () =>
      (await manualSection.locator('.sets-section-content').boundingBox())?.height ?? 0
    await manualSection.locator('h4').click()
    await expect(manualSection.locator('.sets-section')).toHaveClass(/closed/)
    await expect.poll(contentHeight).toBeLessThanOrEqual(1)
    await manualSection.locator('h4').click()
    await expect(manualSection.locator('.sets-section')).toHaveClass(/open/)
    await expect.poll(contentHeight).toBeGreaterThan(20)

    await manualSection.locator('.project-selector-card', { hasText: 'SetProject' }).click()
    await expect(page.locator('.project-selector-modal')).toHaveCount(0)
    await expect(page.locator('.tools-dest-panel .tools-project-selector-name')).toContainText('SetProject')
  })

  test('a long Browse result wraps instead of overflowing the modal', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as any).__browseDialogResult__ = '/browse/root'
      ;(window as any).__scanCustomResult__ = {
        locations: [],
        standalone_projects: Array(20).fill(null).map((_, i) => (
          { name: `VERY_LONG_PROJECT_NAME_${i + 1}`, path: `/browse/root/p${i + 1}`, has_project_file: true, has_banks: true }
        )),
      }
    })
    await browseBtn(page).click()

    const manualSection = page.locator('.project-selector-manual')
    await expect(manualSection.locator('.project-selector-card')).toHaveCount(20)

    const overflow = await page.evaluate(() => {
      const modal = document.querySelector('.project-selector-modal') as HTMLElement
      return {
        modalOverflow: modal.scrollWidth - modal.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(overflow.modalOverflow).toBe(0)
    expect(overflow.pageOverflow).toBe(0)
  })

  test('Browse selects the folder directly when it is itself a project', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as any).__browseDialogResult__ = '/browse/MyProject'
      ;(window as any).__scanCustomResult__ = {
        locations: [],
        standalone_projects: [
          { name: 'MyProject', path: '/browse/MyProject', has_project_file: true, has_banks: true },
        ],
      }
    })
    await browseBtn(page).click()
    await expect(page.locator('.project-selector-modal')).toHaveCount(0)
    await expect(page.locator('.tools-dest-panel .tools-project-selector-name')).toContainText('MyProject')
  })

  test('Browse reports when no project is found under the folder', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as any).__browseDialogResult__ = '/browse/empty'
      ;(window as any).__scanCustomResult__ = { locations: [], standalone_projects: [] }
    })
    await browseBtn(page).click()
    await expect(page.locator('.error-modal')).toContainText('No Octatrack project found in the selected folder')
  })
})

test.describe('Tools Tab - Copy Sample Slots Not Same Set', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, { sameSet: false, withOtherProject: true })
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Sample Slots operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)

    // Open project selector and pick OtherProject (different set)
    const destButton = page.locator('.tools-dest-panel .tools-project-selector-btn')
    await destButton.click()
    await page.waitForTimeout(300)

    // Click "Rescan for Projects" to populate the list
    const rescanBtn = page.locator('.project-selector-modal .scan-button', { hasText: 'Rescan for Projects' })
    await rescanBtn.click()
    await page.waitForTimeout(500)

    // Expand location (collapsed by default in modal)
    const locationHeader = page.locator('.project-selector-modal .location-header').first()
    await expect(locationHeader).toBeAttached({ timeout: 5000 })
    await page.evaluate(() => {
      const el = document.querySelector('.project-selector-modal .location-header') as HTMLElement
      if (el) el.click()
    })
    await page.waitForTimeout(300)

    // Expand set within location
    await page.evaluate(() => {
      const el = document.querySelector('.project-selector-modal .set-header') as HTMLElement
      if (el) el.click()
    })
    await page.waitForTimeout(300)

    // Select the other project
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.project-selector-card')
      for (const card of cards) {
        if (card.textContent?.includes('OtherProject')) {
          (card as HTMLElement).click()
          break
        }
      }
    })

    // Wait for destination to update (modal closes, UI reflects new project)
    await expect(page.locator('.tools-dest-panel .tools-project-selector-name')).toContainText('OtherProject', { timeout: 5000 })
    await page.waitForTimeout(500)
  })

  test('Move to Pool is disabled when projects are not in the same Set', async ({ page }) => {
    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await expect(moveToPoolBtn).toBeDisabled()
  })

  test('Mirror is disabled when projects are not in the same Set', async ({ page }) => {
    const mirrorBtn = page.locator('.tools-toggle-btn', { hasText: 'Mirror' })
    await expect(mirrorBtn).toBeDisabled()
  })

  test('Copy to project remains selected when not in same Set', async ({ page }) => {
    const copyAllBtn = page.locator('.tools-toggle-btn', { hasText: 'Copy to project' })
    await expect(copyAllBtn).toHaveClass(/selected/)

    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await expect(moveToPoolBtn).not.toHaveClass(/selected/)

    const mirrorBtn = page.locator('.tools-toggle-btn', { hasText: 'Mirror' })
    await expect(mirrorBtn).not.toHaveClass(/selected/)
  })
})

test.describe('Tools Tab - Copy Patterns Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Patterns operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
  })

  test('Part Assignment selector is visible', async ({ page }) => {
    const partAssignmentField = page.locator('.tools-field').filter({ hasText: 'Part Assignment' })
    await expect(partAssignmentField).toBeVisible()
  })

  test('Part Assignment has three toggle buttons', async ({ page }) => {
    const partAssignmentField = page.locator('.tools-field').filter({ hasText: 'Part Assignment' })
    const toggleGroup = partAssignmentField.locator('.tools-toggle-group')

    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'Keep Original' })).toBeVisible()
    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'Copy Source' })).toBeVisible()
    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'User Selection' })).toBeVisible()
  })

  test('Keep Original is selected by default', async ({ page }) => {
    const keepOriginalBtn = page.locator('.tools-toggle-btn', { hasText: 'Keep Original' })
    await expect(keepOriginalBtn).toHaveClass(/selected/)
  })

  test('Track Scope selector is visible', async ({ page }) => {
    const trackScopeField = page.locator('.tools-field').filter({ hasText: 'Track Scope' })
    await expect(trackScopeField).toBeVisible()
  })

  test('Track Scope has two toggle buttons', async ({ page }) => {
    const trackScopeField = page.locator('.tools-field').filter({ hasText: 'Track Scope' })
    const toggleGroup = trackScopeField.locator('.tools-toggle-group')

    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'All Tracks' })).toBeVisible()
    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })).toBeVisible()
  })

  test('All Tracks is selected by default', async ({ page }) => {
    const allTracksBtn = page.locator('.tools-toggle-btn', { hasText: 'All Tracks' })
    await expect(allTracksBtn).toHaveClass(/selected/)
  })

  test('User Selection shows Destination Part selector', async ({ page }) => {
    const userSelectionBtn = page.locator('.tools-toggle-btn', { hasText: 'User Selection' })
    await userSelectionBtn.click()
    await page.waitForTimeout(200)

    // Destination Part selector should be visible
    await expect(page.getByText('Destination Part')).toBeVisible()

    // Part buttons should be visible
    const partCross = page.locator('.tools-options-panel .tools-part-cross')
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })).toBeVisible()
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })).toBeVisible()
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^3$/ })).toBeVisible()
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^4$/ })).toBeVisible()
  })

  test('Destination Part supports click-to-deselect', async ({ page }) => {
    const userSelectionBtn = page.locator('.tools-toggle-btn', { hasText: 'User Selection' })
    await userSelectionBtn.click()
    await page.waitForTimeout(200)

    const partCross = page.locator('.tools-options-panel .tools-part-cross')
    const part1 = partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })

    // Click part 1 to select it
    await part1.click()
    await page.waitForTimeout(200)
    await expect(part1).toHaveClass(/selected/)

    // Click part 1 again to deselect
    await part1.click()
    await page.waitForTimeout(200)
    await expect(part1).not.toHaveClass(/selected/)

    // Execute button should be disabled (no destination part selected)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination Part buttons have correct tooltips', async ({ page }) => {
    const userSelectionBtn = page.locator('.tools-toggle-btn', { hasText: 'User Selection' })
    await userSelectionBtn.click()
    await page.waitForTimeout(200)

    const partCross = page.locator('.tools-options-panel .tools-part-cross')

    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })).toHaveAttribute('title', 'Part 1')
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })).toHaveAttribute('title', 'Part 2')
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^3$/ })).toHaveAttribute('title', 'Part 3')
    await expect(partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^4$/ })).toHaveAttribute('title', 'Part 4')
  })

  test('Specific Tracks shows track buttons in stacked layout', async ({ page }) => {
    const specificTracksBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificTracksBtn.click()
    await page.waitForTimeout(200)

    // Tracks field label should be visible
    await expect(page.locator('.tools-options-panel .tools-field label', { hasText: /^Tracks$/ })).toBeVisible()

    // Track buttons should be in stacked layout
    const trackButtons = page.locator('.tools-options-panel .tools-multi-select.tracks-stacked')
    await expect(trackButtons).toBeVisible()

    // Audio tracks T1-T8 should be visible
    await expect(trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })).toBeVisible()
    await expect(trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T8' })).toBeVisible()

    // MIDI tracks M1-M8 should be visible
    await expect(trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })).toBeVisible()
    await expect(trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'M8' })).toBeVisible()
  })

  test('Track buttons have correct tooltips', async ({ page }) => {
    const specificTracksBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificTracksBtn.click()
    await page.waitForTimeout(200)

    const trackButtons = page.locator('.tools-options-panel .tools-multi-select.tracks-stacked')

    // Check audio track tooltip
    const t1Button = trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await expect(t1Button).toHaveAttribute('title', 'Audio Track 1')

    // Check MIDI track tooltip
    const m1Button = trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await expect(m1Button).toHaveAttribute('title', 'MIDI Track 1')
  })

  test('Track buttons support click-to-deselect and Execute disabled when none selected', async ({ page }) => {
    const specificTracksBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificTracksBtn.click()
    await page.waitForTimeout(200)

    const trackButtons = page.locator('.tools-options-panel .tools-multi-select.tracks-stacked')

    // No tracks selected by default
    const t1Button = trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await expect(t1Button).not.toHaveClass(/selected/)

    // Execute button should be disabled (no tracks selected)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()

    // Select T1
    await t1Button.click()
    await page.waitForTimeout(200)
    await expect(t1Button).toHaveClass(/selected/)

    // Deselect T1
    await t1Button.click()
    await page.waitForTimeout(200)
    await expect(t1Button).not.toHaveClass(/selected/)

    // No tracks should be selected now
    const selectedTracks = trackButtons.locator('.tools-multi-btn.track-btn.selected')
    await expect(selectedTracks).toHaveCount(0)

    // Execute button should be disabled
    await expect(executeBtn).toBeDisabled()
  })
})

test.describe('Tools Tab - Copy Tracks Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Tracks operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
  })

  test('Copy Mode selector is visible', async ({ page }) => {
    await expect(page.getByText('Copy Mode')).toBeVisible()
  })

  test('Copy Mode has three toggle buttons in correct order', async ({ page }) => {
    const copyModeField = page.locator('.tools-field').filter({ hasText: 'Copy Mode' })
    const toggleGroup = copyModeField.locator('.tools-toggle-group')
    const buttons = toggleGroup.locator('.tools-toggle-btn')

    // Verify order: Part Parameters, Both, Pattern Triggers
    await expect(buttons.nth(0)).toHaveText('Part Parameters')
    await expect(buttons.nth(1)).toHaveText('Both')
    await expect(buttons.nth(2)).toHaveText('Pattern Triggers')
  })

  test('Part Parameters is selected by default', async ({ page }) => {
    const partParamsBtn = page.locator('.tools-toggle-btn', { hasText: 'Part Parameters' })
    await expect(partParamsBtn).toHaveClass(/selected/)
  })

  test('No source tracks selected by default', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const selectedTracks = sourcePanel.locator('.tools-multi-btn.track-btn.selected')
    await expect(selectedTracks).toHaveCount(0)
  })

  test('No destination tracks selected by default', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const selectedTracks = destPanel.locator('.tools-multi-btn.track-btn.selected')
    await expect(selectedTracks).toHaveCount(0)
  })

  test('Source Part 1 is selected by default', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const part1 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(part1).toHaveClass(/selected/)
  })

  test('Destination Part 1 is selected by default', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const part1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(part1).toHaveClass(/selected/)
  })

  test('Execute button disabled when no tracks selected', async ({ page }) => {
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Source track selection is single-select', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const t1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    const t2 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T2' })

    // Click T1 to select it
    await t1.click()
    await page.waitForTimeout(200)
    await expect(t1).toHaveClass(/selected/)

    // Click T2 - should switch selection
    await t2.click()
    await page.waitForTimeout(200)
    await expect(t2).toHaveClass(/selected/)
    await expect(t1).not.toHaveClass(/selected/)
  })

  test('Source track can be deselected by clicking it again', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const t1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })

    // Click T1 to select it
    await t1.click()
    await page.waitForTimeout(200)
    await expect(t1).toHaveClass(/selected/)

    // Click T1 again to deselect
    await t1.click()
    await page.waitForTimeout(200)
    await expect(t1).not.toHaveClass(/selected/)
  })

  test('Selecting Audio source track disables MIDI source tracks', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const t1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })

    // First select destination MIDI track to lock source type
    const destPanel = page.locator('.tools-dest-panel')
    const destM1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await destM1.click()
    await page.waitForTimeout(200)

    // Source Audio tracks should be disabled
    await expect(t1).toHaveClass(/disabled/)
  })

  test('Selecting MIDI source track disables Audio source tracks', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const m1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })

    // First select destination Audio track to lock source type
    const destPanel = page.locator('.tools-dest-panel')
    const destT1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await destT1.click()
    await page.waitForTimeout(200)

    // Source MIDI tracks should be disabled
    await expect(m1).toHaveClass(/disabled/)
  })

  test('Destination tracks allow multi-select when source is single track', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')

    // Select source T1
    const sourceT1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await sourceT1.click()
    await page.waitForTimeout(200)

    // Select multiple destination Audio tracks
    const destT1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    const destT2 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T2' })
    const destT3 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T3' })

    await destT1.click()
    await page.waitForTimeout(200)
    await destT2.click()
    await page.waitForTimeout(200)
    await destT3.click()
    await page.waitForTimeout(200)

    // All three should be selected
    await expect(destT1).toHaveClass(/selected/)
    await expect(destT2).toHaveClass(/selected/)
    await expect(destT3).toHaveClass(/selected/)
  })

  test('Destination MIDI tracks disabled when source Audio track selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')

    // Select source T1 (Audio)
    const sourceT1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await sourceT1.click()
    await page.waitForTimeout(200)

    // Destination MIDI tracks should be disabled
    const destM1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await expect(destM1).toHaveClass(/disabled/)
  })

  test('Destination Audio tracks disabled when source MIDI track selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')

    // Select source M1 (MIDI)
    const sourceM1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await sourceM1.click()
    await page.waitForTimeout(200)

    // Destination Audio tracks should be disabled
    const destT1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await expect(destT1).toHaveClass(/disabled/)
  })

  test('Source All Audio button selects all 8 Audio tracks', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const allAudioBtn = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })

    await allAudioBtn.click()
    await page.waitForTimeout(200)

    // All 8 audio tracks should be selected
    const selectedAudio = sourcePanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^T[1-8]$/ })
    await expect(selectedAudio).toHaveCount(8)
  })

  test('Source All MIDI button selects all 8 MIDI tracks', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const allMidiBtn = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All MIDI' })

    await allMidiBtn.click()
    await page.waitForTimeout(200)

    // All 8 MIDI tracks should be selected
    const selectedMidi = sourcePanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^M[1-8]$/ })
    await expect(selectedMidi).toHaveCount(8)
  })

  test('Source All Audio syncs destination to All Audio', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllAudio = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })

    await sourceAllAudio.click()
    await page.waitForTimeout(200)

    // Destination should also have all 8 Audio tracks selected
    const destSelectedAudio = destPanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^T[1-8]$/ })
    await expect(destSelectedAudio).toHaveCount(8)
  })

  test('Source All MIDI syncs destination to All MIDI', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllMidi = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All MIDI' })

    await sourceAllMidi.click()
    await page.waitForTimeout(200)

    // Destination should also have all 8 MIDI tracks selected
    const destSelectedMidi = destPanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^M[1-8]$/ })
    await expect(destSelectedMidi).toHaveCount(8)
  })

  test('Deselecting source All Audio clears both source and destination', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllAudio = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })

    // Select All Audio
    await sourceAllAudio.click()
    await page.waitForTimeout(200)

    // Positive control: without this, the count-0 assertions below would also
    // pass if the .selected class were renamed and nothing ever matched.
    const sourceSelected = sourcePanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^[TM][1-8]$/ })
    await expect(sourceSelected).toHaveCount(8)

    // Deselect by clicking again
    await sourceAllAudio.click()
    await page.waitForTimeout(200)

    // No source tracks should be selected
    await expect(sourceSelected).toHaveCount(0)

    // No destination tracks should be selected
    const destSelected = destPanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^[TM][1-8]$/ })
    await expect(destSelected).toHaveCount(0)
  })

  test('Destination tracks are disabled when source All Audio is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllAudio = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })

    await sourceAllAudio.click()
    await page.waitForTimeout(200)

    // Destination track buttons should have disabled class
    const destT1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await expect(destT1).toHaveClass(/disabled/)

    // Destination tracks container should have disabled class
    const destTracksContainer = destPanel.locator('.tools-multi-select.tracks-stacked')
    await expect(destTracksContainer).toHaveClass(/disabled/)
  })

  test('Destination All Audio and All MIDI buttons are disabled when source All is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllAudio = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })

    await sourceAllAudio.click()
    await page.waitForTimeout(200)

    const destAllAudio = destPanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })
    const destAllMidi = destPanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All MIDI' })
    const destNone = destPanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'None' })

    await expect(destAllAudio).toBeDisabled()
    await expect(destAllMidi).toBeDisabled()
    await expect(destNone).toBeDisabled()
  })

  test('Source All Audio button is disabled when destination has MIDI tracks', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')

    // First select a source MIDI track, then a destination MIDI track
    const sourceM1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await sourceM1.click()
    await page.waitForTimeout(200)

    const destM1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await destM1.click()
    await page.waitForTimeout(200)

    // Deselect source to make All buttons available
    await sourceM1.click()
    await page.waitForTimeout(200)

    // All Audio should be disabled because dest has MIDI
    const sourceAllAudio = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })
    await expect(sourceAllAudio).toBeDisabled()
  })

  test('Destination None button deselects all tracks', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')

    // Select source T1
    const sourceT1 = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await sourceT1.click()
    await page.waitForTimeout(200)

    // Select multiple destination tracks
    const destT1 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    const destT2 = destPanel.locator('.tools-multi-btn.track-btn', { hasText: 'T2' })
    await destT1.click()
    await page.waitForTimeout(200)
    await destT2.click()
    await page.waitForTimeout(200)

    // Click None button
    const destNone = destPanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'None' })
    await destNone.click()
    await page.waitForTimeout(200)

    // No destination tracks should be selected
    const destSelected = destPanel.locator('.tools-multi-btn.track-btn.selected').filter({ hasText: /^[TM][1-8]$/ })
    await expect(destSelected).toHaveCount(0)
  })

  test('Source Part All button syncs destination to All', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllPart = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    await sourceAllPart.click()
    await page.waitForTimeout(200)

    // Source All should be selected
    await expect(sourceAllPart).toHaveClass(/selected/)

    // Destination All should also be selected
    const destAllPart = destPanel.locator('.tools-toggle-btn.part-btn.part-all')
    await expect(destAllPart).toHaveClass(/selected/)
  })

  test('Destination Parts are disabled when source All is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllPart = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    await sourceAllPart.click()
    await page.waitForTimeout(200)

    // Destination part buttons should be disabled
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(destPart1).toBeDisabled()

    // Destination part cross should have disabled class
    const destPartCross = destPanel.locator('.tools-part-cross')
    await expect(destPartCross).toHaveClass(/disabled/)
  })

  test('Deselecting source All Part clears both source and destination parts', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllPart = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    // Select All
    await sourceAllPart.click()
    await page.waitForTimeout(200)

    // Deselect by clicking again
    await sourceAllPart.click()
    await page.waitForTimeout(200)

    // No source parts should be selected
    const sourceSelectedParts = sourcePanel.locator('.tools-toggle-btn.part-btn.selected')
    await expect(sourceSelectedParts).toHaveCount(0)

    // No destination parts should be selected
    const destSelectedParts = destPanel.locator('.tools-toggle-btn.part-btn.selected')
    await expect(destSelectedParts).toHaveCount(0)
  })

  test('Track buttons have correct tooltips', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')

    // Check audio track tooltip
    const t1Button = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await expect(t1Button).toHaveAttribute('title', 'Audio Track 1')

    // Check MIDI track tooltip
    const m1Button = sourcePanel.locator('.tools-multi-btn.track-btn', { hasText: 'M1' })
    await expect(m1Button).toHaveAttribute('title', 'MIDI Track 1')
  })

  test('Part buttons have correct tooltips', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')

    // Check part 1 tooltip
    const part1 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(part1).toHaveAttribute('title', 'Part 1')

    // Check All button tooltip
    const allPart = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')
    await expect(allPart).toHaveAttribute('title', 'Select all Parts')
  })

  test('Destination Part buttons show sync tooltip when source All is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllPart = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    await sourceAllPart.click()
    await page.waitForTimeout(200)

    // Destination part buttons should show sync tooltip
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(destPart1).toHaveAttribute('title', 'Synced with source All selection')
  })

  test('Clicking single source Part when All is selected switches to single mode', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAllPart = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')
    const sourcePart2 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })

    // First select All
    await sourceAllPart.click()
    await page.waitForTimeout(200)

    // All should be selected
    await expect(sourceAllPart).toHaveClass(/selected/)

    // Click part 2 to switch to single mode
    await sourcePart2.click()
    await page.waitForTimeout(200)

    // Only part 2 should be selected, All should be deselected
    await expect(sourcePart2).toHaveClass(/selected/)
    await expect(sourceAllPart).not.toHaveClass(/selected/)

    // Destination parts should no longer be disabled
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(destPart1).not.toBeDisabled()
  })

  test('Selected All Audio/MIDI buttons have correct styling (solid orange)', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const sourceAllAudio = sourcePanel.locator('.tools-multi-btn.track-btn.tools-select-all', { hasText: 'All Audio' })

    await sourceAllAudio.click()
    await page.waitForTimeout(200)

    // All Audio button should have selected class
    await expect(sourceAllAudio).toHaveClass(/selected/)
  })
})

test.describe('Tools Tab - Destination Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)
  })

  test('Destination panel is visible', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    await expect(destPanel).toBeVisible()
  })

  test('Destination header is visible', async ({ page }) => {
    await expect(page.locator('.tools-dest-panel h3')).toHaveText('Destination')
  })

  test('Project selector is visible', async ({ page }) => {
    await expect(page.locator('.tools-dest-panel .tools-project-selector-btn')).toBeVisible()
  })
})

test.describe('Tools Tab - Copy Banks Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Copy Banks is selected by default, but ensure it
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_bank')
    await page.waitForTimeout(300)
  })

  test('Source panel has Bank label (singular) for single-select', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankLabel = sourcePanel.locator('.tools-field label', { hasText: 'Bank' })
    await expect(bankLabel).toBeVisible()
  })

  test('Destination panel has Banks label (plural) for multi-select', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const banksLabel = destPanel.locator('.tools-field label', { hasText: 'Banks' })
    await expect(banksLabel).toBeVisible()
  })

  test('Default source bank is Bank A', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)
  })

  test('Default destination bank is Bank A', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)
  })

  test('Source bank is single-select (clicking another bank switches selection)', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    const bankB = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^B$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click Bank B to switch selection
    await bankB.click()
    await page.waitForTimeout(200)

    // Only Bank B should be selected
    await expect(bankA).not.toHaveClass(/selected/)
    await expect(bankB).toHaveClass(/selected/)
  })

  test('Source bank can be deselected by clicking it again', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')

    // Bank A should be selected by default (first loaded bank)
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)

    // Click bank A to deselect it
    await bankA.click()
    await page.waitForTimeout(200)

    // Bank A should no longer be selected
    await expect(bankA).not.toHaveClass(/selected/)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination banks selector allows multiple selection', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')

    // Use exact text match to avoid matching "All" button
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    const bankB = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^B$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank B to add it to selection
    await bankB.click()
    await page.waitForTimeout(200)

    // Both A and B should be selected
    await expect(bankA).toHaveClass(/selected/)
    await expect(bankB).toHaveClass(/selected/)
  })

  test('Destination banks has All button to select all banks', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const allButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    await expect(allButton).toBeVisible()

    // Click All button
    await allButton.click()
    await page.waitForTimeout(200)

    // All 16 banks should be selected (exclude All/None buttons)
    const selectedBanks = destPanel.locator('.tools-multi-btn.bank-btn.selected:not(.tools-select-all)')
    await expect(selectedBanks).toHaveCount(16)

    // All button should show selected styling
    await expect(allButton).toHaveClass(/selected/)
  })

  test('Destination All button is toggleable (clicking again deselects all)', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const allButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })

    // Click All button to select all
    await allButton.click()
    await page.waitForTimeout(200)
    await expect(allButton).toHaveClass(/selected/)

    // Click All button again to deselect all
    await allButton.click()
    await page.waitForTimeout(200)

    // No banks should be selected
    const selectedBanks = destPanel.locator('.tools-multi-btn.bank-btn.selected:not(.tools-select-all)')
    await expect(selectedBanks).toHaveCount(0)

    // All button should not be selected
    await expect(allButton).not.toHaveClass(/selected/)
  })

  test('Destination banks has None button to deselect all banks', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const noneButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await expect(noneButton).toBeVisible()

    // Click None button
    await noneButton.click()
    await page.waitForTimeout(200)

    // No banks should be selected
    const selectedBanks = destPanel.locator('.tools-multi-btn.bank-btn.selected')
    await expect(selectedBanks).toHaveCount(0)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Clicking selected destination bank deselects it', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')

    // Use exact text match to avoid matching "All" or "None" buttons
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank A to deselect it
    await bankA.click()
    await page.waitForTimeout(200)

    // Bank A should no longer be selected
    await expect(bankA).not.toHaveClass(/selected/)

    // Execute button should be disabled (no destination banks selected)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination All button has correct tooltip', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const allButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    await expect(allButton).toHaveAttribute('title', 'Select all banks')
  })

  test('Destination None button has correct tooltip', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const noneButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await expect(noneButton).toHaveAttribute('title', 'Deselect all banks')
  })
})

test.describe('Tools Tab - Copy Parts Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Parts operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_parts')
    await page.waitForTimeout(300)
  })

  test('Default source Part is Part 1', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const part1 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(part1).toHaveClass(/selected/)
  })

  test('Default destination Part is Part 1', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const part1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(part1).toHaveClass(/selected/)
  })

  test('Default source Bank is Bank A', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)
  })

  test('Default destination Bank is Bank A', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)
  })

  test('Part buttons have correct tooltips', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')

    const part1 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(part1).toHaveAttribute('title', 'Part 1')

    const part2 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })
    await expect(part2).toHaveAttribute('title', 'Part 2')
  })

  test('All button has correct tooltip', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const allBtn = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')
    await expect(allBtn).toHaveAttribute('title', 'Select all Parts')
  })

  test('Destination Parts show sync tooltip when source All is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    // Click source All
    await sourceAll.click()
    await page.waitForTimeout(200)

    // Destination part should show sync tooltip
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(destPart1).toHaveAttribute('title', 'Synced with source All selection')
  })

  test('Source part is single-select (clicking another part switches selection)', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const part1 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    const part2 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })

    // Part 1 should be selected by default
    await expect(part1).toHaveClass(/selected/)

    // Click part 2 to switch selection
    await part2.click()
    await page.waitForTimeout(200)

    // Only part 2 should be selected
    await expect(part1).not.toHaveClass(/selected/)
    await expect(part2).toHaveClass(/selected/)
  })

  test('Source part can be deselected by clicking it again', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const part1 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })

    // Part 1 should be selected by default
    await expect(part1).toHaveClass(/selected/)

    // Click part 1 to deselect
    await part1.click()
    await page.waitForTimeout(200)

    // Part 1 should no longer be selected
    await expect(part1).not.toHaveClass(/selected/)

    // Execute button should be disabled (no source part)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Source All button selects all parts and syncs destination', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    // Click All button
    await sourceAll.click()
    await page.waitForTimeout(200)

    // All source parts should be selected
    const sourceSelectedParts = sourcePanel.locator('.tools-toggle-btn.part-btn.selected')
    await expect(sourceSelectedParts).toHaveCount(5) // 4 parts + All button

    // All destination parts should also be selected
    const destSelectedParts = destPanel.locator('.tools-toggle-btn.part-btn.selected')
    await expect(destSelectedParts).toHaveCount(5) // 4 parts + All button
  })

  test('Source All button deselects all parts when clicked again', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')

    // Click All button to select all
    await sourceAll.click()
    await page.waitForTimeout(200)

    // Click All button again to deselect
    await sourceAll.click()
    await page.waitForTimeout(200)

    // No source parts should be selected
    const sourceSelectedParts = sourcePanel.locator('.tools-toggle-btn.part-btn.selected')
    await expect(sourceSelectedParts).toHaveCount(0)

    // No destination parts should be selected
    const destSelectedParts = destPanel.locator('.tools-toggle-btn.part-btn.selected')
    await expect(destSelectedParts).toHaveCount(0)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination parts allow multi-select when source is single part', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    const destPart2 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })
    const destPart3 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^3$/ })

    // Part 1 should be selected by default
    await expect(destPart1).toHaveClass(/selected/)

    // Click part 2 and 3 to add them
    await destPart2.click()
    await page.waitForTimeout(200)
    await destPart3.click()
    await page.waitForTimeout(200)

    // Parts 1, 2, and 3 should all be selected
    await expect(destPart1).toHaveClass(/selected/)
    await expect(destPart2).toHaveClass(/selected/)
    await expect(destPart3).toHaveClass(/selected/)
  })

  test('Destination part can be deselected by clicking it', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })

    // Part 1 should be selected by default
    await expect(destPart1).toHaveClass(/selected/)

    // Click part 1 to deselect
    await destPart1.click()
    await page.waitForTimeout(200)

    // Part 1 should no longer be selected
    await expect(destPart1).not.toHaveClass(/selected/)

    // Execute button should be disabled (no destination part)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination parts are disabled when source All is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })

    // Click source All button
    await sourceAll.click()
    await page.waitForTimeout(200)

    // Destination part buttons should be disabled
    await expect(destPart1).toBeDisabled()

    // Destination cross should have disabled class
    const destCross = destPanel.locator('.tools-part-cross')
    await expect(destCross).toHaveClass(/disabled/)
  })

  test('Source bank can be deselected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank A to deselect
    await bankA.click()
    await page.waitForTimeout(200)

    // Bank A should no longer be selected
    await expect(bankA).not.toHaveClass(/selected/)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination bank can be deselected', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank A to deselect
    await bankA.click()
    await page.waitForTimeout(200)

    // Bank A should no longer be selected
    await expect(bankA).not.toHaveClass(/selected/)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Clicking single source part when All is selected switches to single mode', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-toggle-btn.part-btn.part-all')
    const sourcePart2 = sourcePanel.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ })

    // First select All
    await sourceAll.click()
    await page.waitForTimeout(200)

    // All should be selected
    await expect(sourceAll).toHaveClass(/selected/)

    // Click part 2 to switch to single mode
    await sourcePart2.click()
    await page.waitForTimeout(200)

    // Only part 2 should be selected, All should be deselected
    await expect(sourcePart2).toHaveClass(/selected/)
    await expect(sourceAll).not.toHaveClass(/selected/)

    // Destination parts should no longer be disabled
    const destPart1 = destPanel.locator('.tools-toggle-btn.part-btn', { hasText: /^1$/ })
    await expect(destPart1).not.toBeDisabled()
  })
})

test.describe('Tools Tab - Copy Patterns Selection', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Patterns operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
  })

  test('Default source Pattern is Pattern 1', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const pattern1 = sourcePanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })
    await expect(pattern1).toHaveClass(/selected/)
  })

  test('Default destination Pattern is Pattern 1', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const pattern1 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })
    await expect(pattern1).toHaveClass(/selected/)
  })

  test('Default source Bank is Bank A', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)
  })

  test('Default destination Bank is Bank A', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    await expect(bankA).toHaveClass(/selected/)
  })

  test('Source pattern is single-select (clicking another pattern switches selection)', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const pattern1 = sourcePanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })
    const pattern2 = sourcePanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^2$/ })

    // Pattern 1 should be selected by default
    await expect(pattern1).toHaveClass(/selected/)

    // Click pattern 2 to switch selection
    await pattern2.click()
    await page.waitForTimeout(200)

    // Only pattern 2 should be selected
    await expect(pattern1).not.toHaveClass(/selected/)
    await expect(pattern2).toHaveClass(/selected/)
  })

  test('Source pattern can be deselected by clicking it again', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const pattern1 = sourcePanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })

    // Pattern 1 should be selected by default
    await expect(pattern1).toHaveClass(/selected/)

    // Click pattern 1 to deselect
    await pattern1.click()
    await page.waitForTimeout(200)

    // Pattern 1 should no longer be selected
    await expect(pattern1).not.toHaveClass(/selected/)

    // Execute button should be disabled (no source pattern)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Source All button selects all patterns and syncs destination', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-multi-btn.pattern-btn.tools-select-all')

    // Click All button
    await sourceAll.click()
    await page.waitForTimeout(200)

    // All source patterns should be selected (16 pattern buttons + All button)
    const sourceSelectedPatterns = sourcePanel.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(sourceSelectedPatterns).toHaveCount(17)

    // All destination patterns should also be selected (16 pattern buttons + All button)
    const destSelectedPatterns = destPanel.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(destSelectedPatterns).toHaveCount(17)
  })

  test('Source All button deselects all patterns when clicked again', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-multi-btn.pattern-btn.tools-select-all')

    // Click All button to select all
    await sourceAll.click()
    await page.waitForTimeout(200)

    // Click All button again to deselect
    await sourceAll.click()
    await page.waitForTimeout(200)

    // No source patterns should be selected
    const sourceSelectedPatterns = sourcePanel.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(sourceSelectedPatterns).toHaveCount(0)

    // No destination patterns should be selected
    const destSelectedPatterns = destPanel.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(destSelectedPatterns).toHaveCount(0)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination patterns allow multi-select when source is single pattern', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destPattern1 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })
    const destPattern2 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^2$/ })
    const destPattern3 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^3$/ })

    // Pattern 1 should be selected by default
    await expect(destPattern1).toHaveClass(/selected/)

    // Click pattern 2 and 3 to add them
    await destPattern2.click()
    await page.waitForTimeout(200)
    await destPattern3.click()
    await page.waitForTimeout(200)

    // Patterns 1, 2, and 3 should all be selected
    await expect(destPattern1).toHaveClass(/selected/)
    await expect(destPattern2).toHaveClass(/selected/)
    await expect(destPattern3).toHaveClass(/selected/)
  })

  test('Destination pattern can be deselected by clicking it', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destPattern1 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })

    // Pattern 1 should be selected by default
    await expect(destPattern1).toHaveClass(/selected/)

    // Click pattern 1 to deselect
    await destPattern1.click()
    await page.waitForTimeout(200)

    // Pattern 1 should no longer be selected
    await expect(destPattern1).not.toHaveClass(/selected/)

    // Execute button should be disabled (no destination pattern)
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination patterns are disabled when source All is selected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    const destPattern1 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })

    // Click source All button
    await sourceAll.click()
    await page.waitForTimeout(200)

    // Destination pattern buttons should be disabled
    await expect(destPattern1).toBeDisabled()

    // Find the pattern field specifically and check its multi-select has disabled class
    const patternField = destPanel.locator('.tools-field').filter({ hasText: 'Patterns' })
    const destMultiSelect = patternField.locator('.tools-multi-select.banks-stacked')
    await expect(destMultiSelect).toHaveClass(/disabled/)
  })

  test('Source bank can be deselected', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const bankA = sourcePanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank A to deselect
    await bankA.click()
    await page.waitForTimeout(200)

    // Bank A should no longer be selected
    await expect(bankA).not.toHaveClass(/selected/)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Destination bank can be deselected', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank A to deselect
    await bankA.click()
    await page.waitForTimeout(200)

    // Bank A should no longer be selected
    await expect(bankA).not.toHaveClass(/selected/)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Clicking single source pattern when All is selected switches to single mode', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const destPanel = page.locator('.tools-dest-panel')
    const sourceAll = sourcePanel.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    const sourcePattern5 = sourcePanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^5$/ })

    // First select All
    await sourceAll.click()
    await page.waitForTimeout(200)

    // All should be selected
    await expect(sourceAll).toHaveClass(/selected/)

    // Click pattern 5 to switch to single mode
    await sourcePattern5.click()
    await page.waitForTimeout(200)

    // Only pattern 5 should be selected, All should be deselected
    await expect(sourcePattern5).toHaveClass(/selected/)
    await expect(sourceAll).not.toHaveClass(/selected/)

    // Destination patterns should no longer be disabled
    const destPattern1 = destPanel.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ })
    await expect(destPattern1).not.toBeDisabled()
  })

  test('Destination All button selects all patterns when source is single', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destAll = destPanel.locator('.tools-multi-btn.pattern-btn.tools-select-all', { hasText: 'All' })

    // Click destination All button
    await destAll.click()
    await page.waitForTimeout(200)

    // All destination patterns should be selected (16 pattern buttons + All button)
    const destSelectedPatterns = destPanel.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(destSelectedPatterns).toHaveCount(17)
  })

  test('Destination None button deselects all patterns', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destNone = destPanel.locator('.tools-multi-btn.pattern-btn.tools-select-all', { hasText: 'None' })

    // Click destination None button
    await destNone.click()
    await page.waitForTimeout(200)

    // No destination patterns should be selected
    const destSelectedPatterns = destPanel.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(destSelectedPatterns).toHaveCount(0)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Source All button has correct tooltip', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const sourceAll = sourcePanel.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    await expect(sourceAll).toHaveAttribute('title', 'Select all patterns')
  })

  test('Destination All button has correct tooltip', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destAll = destPanel.locator('.tools-multi-btn.pattern-btn.tools-select-all', { hasText: 'All' })
    await expect(destAll).toHaveAttribute('title', 'Select all patterns')
  })

  test('Destination None button has correct tooltip', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const destNone = destPanel.locator('.tools-multi-btn.pattern-btn.tools-select-all', { hasText: 'None' })
    await expect(destNone).toHaveAttribute('title', 'Deselect all patterns')
  })
})

test.describe('Tools Tab - Execute Button', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)
  })

  test('Execute button is visible', async ({ page }) => {
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeVisible()
  })

  test('Execute button has correct text', async ({ page }) => {
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toContainText('Execute')
  })
})

test.describe('Tools Tab - Copy Patterns Mode Scope', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Patterns operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
  })

  test('Mode Scope is visible when All Tracks is selected', async ({ page }) => {
    // All Tracks is default, Mode Scope should be visible
    await expect(page.getByText('Mode Scope')).toBeVisible()
  })

  test('Mode Scope has three toggle buttons', async ({ page }) => {
    const modeScopeField = page.locator('.tools-field').filter({ hasText: 'Mode Scope' })
    const toggleGroup = modeScopeField.locator('.tools-toggle-group')

    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'Audio' })).toBeVisible()
    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'Both' })).toBeVisible()
    await expect(toggleGroup.locator('.tools-toggle-btn', { hasText: 'MIDI' })).toBeVisible()
  })

  test('Audio is selected by default', async ({ page }) => {
    const modeScopeField = page.locator('.tools-field').filter({ hasText: 'Mode Scope' })
    const audioBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'Audio' })
    await expect(audioBtn).toHaveClass(/selected/)
  })

  test('clicking Mode Scope button changes selection', async ({ page }) => {
    const modeScopeField = page.locator('.tools-field').filter({ hasText: 'Mode Scope' })
    const audioBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'Audio' })
    const bothBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'Both' })
    const midiBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'MIDI' })

    // Click Both
    await bothBtn.click()
    await page.waitForTimeout(200)
    await expect(bothBtn).toHaveClass(/selected/)
    await expect(audioBtn).not.toHaveClass(/selected/)

    // Click MIDI
    await midiBtn.click()
    await page.waitForTimeout(200)
    await expect(midiBtn).toHaveClass(/selected/)
    await expect(bothBtn).not.toHaveClass(/selected/)
  })

  test('Mode Scope is hidden when Specific Tracks is selected', async ({ page }) => {
    const specificTracksBtn = page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' })
    await specificTracksBtn.click()
    await page.waitForTimeout(200)

    // Mode Scope should not be visible
    const modeScopeField = page.locator('.tools-field').filter({ hasText: 'Mode Scope' })
    await expect(modeScopeField).not.toBeVisible()
  })

  test('Mode Scope buttons have correct tooltips', async ({ page }) => {
    const modeScopeField = page.locator('.tools-field').filter({ hasText: 'Mode Scope' })
    const audioBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'Audio' })
    const bothBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'Both' })
    const midiBtn = modeScopeField.locator('.tools-toggle-btn', { hasText: 'MIDI' })

    await expect(audioBtn).toHaveAttribute('title', 'Copy only Audio tracks (T1-T8)')
    await expect(bothBtn).toHaveAttribute('title', 'Copy both Audio and MIDI tracks')
    await expect(midiBtn).toHaveAttribute('title', 'Copy only MIDI tracks (M1-M8)')
  })
})

test.describe('Tools Tab - Copy Tracks Pattern Selector', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Tracks operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
  })

  test('Pattern selector is not visible when Part Parameters mode is selected', async ({ page }) => {
    // Part Parameters is the default
    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    await expect(patternField).not.toBeVisible()
  })

  test('Pattern selector is visible when Both mode is selected', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    await expect(patternField).toBeVisible()
  })

  test('Pattern selector is visible when Pattern Triggers mode is selected', async ({ page }) => {
    const trigBtn = page.locator('.tools-toggle-btn', { hasText: 'Pattern Triggers' })
    await trigBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    await expect(patternField).toBeVisible()
  })

  test('Source pattern selector has 16 pattern buttons and All button', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const patternButtons = patternField.locator('.tools-multi-btn.pattern-btn')

    // 16 pattern buttons + 1 All button = 17
    await expect(patternButtons).toHaveCount(17)

    // All button should be visible
    await expect(patternField.locator('.tools-multi-btn.pattern-btn.tools-select-all', { hasText: 'All' })).toBeVisible()
  })

  test('Source Pattern 1 is selected by default in Both mode', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const pattern1 = patternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    const allBtn = patternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')

    await expect(pattern1).toHaveClass(/selected/)
    await expect(allBtn).not.toHaveClass(/selected/)
  })

  test('Clicking specific source pattern deselects All', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const allBtn = patternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')

    // Click pattern 3
    const pattern3 = patternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^3$/ }).first()
    await pattern3.click()
    await page.waitForTimeout(200)

    await expect(pattern3).toHaveClass(/selected/)
    await expect(allBtn).not.toHaveClass(/selected/)
  })

  test('Destination pattern selector is disabled when source All is selected', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Explicitly select All (Both mode now defaults to Pattern 1)
    const sourcePanel = page.locator('.tools-source-panel')
    const sourcePatternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const allBtn = sourcePatternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    await allBtn.click()
    await page.waitForTimeout(200)

    const destPanel = page.locator('.tools-dest-panel')
    const patternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destPatternContainer = patternField.locator('.tools-multi-select')

    await expect(destPatternContainer).toHaveClass(/disabled/)
  })

  test('Destination pattern selector is enabled when source is specific pattern', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Both mode now defaults to Pattern 1 (specific), so dest should be enabled
    const destPanel = page.locator('.tools-dest-panel')
    const destPatternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destPatternContainer = destPatternField.locator('.tools-multi-select')

    await expect(destPatternContainer).not.toHaveClass(/disabled/)
  })

  test('Destination pattern buttons show sync tooltip when source All is selected', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Explicitly select All (Both mode now defaults to Pattern 1)
    const sourcePanel = page.locator('.tools-source-panel')
    const sourcePatternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const allBtn = sourcePatternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    await allBtn.click()
    await page.waitForTimeout(200)

    const destPanel = page.locator('.tools-dest-panel')
    const destPatternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destPattern1 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()

    await expect(destPattern1).toHaveAttribute('title', 'Synced with source All selection')
  })

  test('Source pattern can be deselected to re-enable All', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const allBtn = patternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')

    // Select specific pattern
    const pattern5 = patternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^5$/ }).first()
    await pattern5.click()
    await page.waitForTimeout(200)
    await expect(allBtn).not.toHaveClass(/selected/)

    // Click All to go back to All
    await allBtn.click()
    await page.waitForTimeout(200)
    await expect(allBtn).toHaveClass(/selected/)
  })

  test('Pattern buttons have correct tooltips', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    const sourcePanel = page.locator('.tools-source-panel')
    const patternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })

    const pattern1 = patternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    await expect(pattern1).toHaveAttribute('title', 'Pattern 1')

    const allBtn = patternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    await expect(allBtn).toHaveAttribute('title', 'All patterns')
  })
})

test.describe('Tools Tab - Copy Tracks Destination Patterns Multi-Select', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Tracks operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
  })

  test('Pattern Triggers mode defaults to Pattern 1 (not All)', async ({ page }) => {
    const trigBtn = page.locator('.tools-toggle-btn', { hasText: 'Pattern Triggers' })
    await trigBtn.click()
    await page.waitForTimeout(200)

    // Source pattern 1 should be selected
    const sourcePanel = page.locator('.tools-source-panel')
    const sourcePatternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const sourcePattern1 = sourcePatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    await expect(sourcePattern1).toHaveClass(/selected/)

    // Source All should NOT be selected
    const sourceAll = sourcePatternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    await expect(sourceAll).not.toHaveClass(/selected/)

    // Destination pattern 1 should be selected
    const destPanel = page.locator('.tools-dest-panel')
    const destPatternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destPattern1 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    await expect(destPattern1).toHaveClass(/selected/)
  })

  test('Both mode defaults to Pattern 1', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Source Pattern 1 should be selected (not All)
    const sourcePanel = page.locator('.tools-source-panel')
    const sourcePatternField = sourcePanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const sourcePattern1 = sourcePatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    const sourceAll = sourcePatternField.locator('.tools-multi-btn.pattern-btn.tools-select-all')
    await expect(sourcePattern1).toHaveClass(/selected/)
    await expect(sourceAll).not.toHaveClass(/selected/)
  })

  test('Destination patterns allow multi-select when source is specific pattern', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Both mode defaults to source Pattern 1, dest Pattern 1
    // Add more destination patterns
    const destPanel = page.locator('.tools-dest-panel')
    const destPatternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destPattern1 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    const destPattern2 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^2$/ }).first()
    const destPattern3 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^3$/ }).first()

    // Pattern 1 already selected by default
    await expect(destPattern1).toHaveClass(/selected/)

    // Add pattern 2 and 3
    await destPattern2.click()
    await page.waitForTimeout(200)
    await destPattern3.click()
    await page.waitForTimeout(200)

    // All three should be selected
    await expect(destPattern1).toHaveClass(/selected/)
    await expect(destPattern2).toHaveClass(/selected/)
    await expect(destPattern3).toHaveClass(/selected/)
  })

  test('Destination pattern can be deselected (multi-select)', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Both mode defaults to source Pattern 1, dest Pattern 1
    const destPanel = page.locator('.tools-dest-panel')
    const destPatternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destPattern1 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^1$/ }).first()
    const destPattern2 = destPatternField.locator('.tools-multi-btn.pattern-btn', { hasText: /^2$/ }).first()

    // Pattern 1 already selected, add pattern 2
    await destPattern2.click()
    await page.waitForTimeout(200)
    await expect(destPattern1).toHaveClass(/selected/)
    await expect(destPattern2).toHaveClass(/selected/)

    // Deselect pattern 2
    await destPattern2.click()
    await page.waitForTimeout(200)
    await expect(destPattern2).not.toHaveClass(/selected/)
    await expect(destPattern1).toHaveClass(/selected/)
  })

  test('Destination All button selects all patterns', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await bothBtn.click()
    await page.waitForTimeout(200)

    // Both mode defaults to source Pattern 1, so dest is enabled
    // Click dest All
    const destPanel = page.locator('.tools-dest-panel')
    const destPatternField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Pattern' }) })
    const destAll = destPatternField.locator('.tools-multi-btn.pattern-btn.tools-select-all', { hasText: 'All' })
    await destAll.click()
    await page.waitForTimeout(200)

    // All 16 patterns + All button should be selected
    const destSelectedPatterns = destPatternField.locator('.tools-multi-btn.pattern-btn.selected')
    await expect(destSelectedPatterns).toHaveCount(17)
  })
})

test.describe('Tools Tab - Operation Descriptions', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)
  })

  test('Copy Banks shows description', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_bank')
    await page.waitForTimeout(300)

    const description = page.locator('.tools-description-pane')
    await expect(description).toBeVisible()
    await expect(description).toContainText('Copies entire bank')
  })

  test('Copy Parts shows description', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_parts')
    await page.waitForTimeout(300)

    const description = page.locator('.tools-description-pane')
    await expect(description).toBeVisible()
    await expect(description).toContainText('Copies Part sound design')
  })

  test('Copy Patterns shows description', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)

    const description = page.locator('.tools-description-pane')
    await expect(description).toBeVisible()
    await expect(description).toContainText('Copies pattern step data')
  })

  test('Copy Tracks shows description', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)

    const description = page.locator('.tools-description-pane')
    await expect(description).toBeVisible()
    await expect(description).toContainText('Copies individual track data')
  })

  test('Copy Sample Slots shows description', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)

    const description = page.locator('.tools-description-pane')
    await expect(description).toBeVisible()
    await expect(description).toContainText('Copies sample slot assignments')
  })

  test('Copy Banks shows OPTIONS pane', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_bank')
    await page.waitForTimeout(300)

    const optionsPanel = page.locator('.tools-options-panel')
    await expect(optionsPanel).toBeVisible()
  })

  test('Copy Parts hides OPTIONS pane', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_parts')
    await page.waitForTimeout(300)

    const optionsPanel = page.locator('.tools-options-panel')
    await expect(optionsPanel).toHaveCount(0)
  })

  test('Copy Patterns shows OPTIONS pane', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)

    const optionsPanel = page.locator('.tools-options-panel')
    await expect(optionsPanel).toBeVisible()
  })

  test('Copy Sample Slots shows OPTIONS pane', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)

    const optionsPanel = page.locator('.tools-options-panel')
    await expect(optionsPanel).toBeVisible()
  })
})

test.describe('Tools Tab - Select Source Track Message', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    // Select Copy Tracks operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
  })

  test('Execute button shows track selection hint when no tracks selected', async ({ page }) => {
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
    // Title should mention track selection
    const title = await executeBtn.getAttribute('title')
    expect(title).toContain('track')
  })
})

test.describe('Tools Tab - Copy Parts Multi-Select Destination Banks', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_parts')
    await page.waitForTimeout(300)
  })

  test('Destination Banks label is plural (multi-select)', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const banksLabel = destPanel.locator('.tools-field label', { hasText: 'Banks' })
    await expect(banksLabel).toBeVisible()
  })

  test('Destination banks allow multiple selection', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    const bankB = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^B$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank B to add it
    await bankB.click()
    await page.waitForTimeout(200)

    // Both should be selected
    await expect(bankA).toHaveClass(/selected/)
    await expect(bankB).toHaveClass(/selected/)
  })

  test('Destination banks has All and None buttons', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const allButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    const noneButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await expect(allButton).toBeVisible()
    await expect(noneButton).toBeVisible()
  })

  test('Execute disabled when no destination bank selected', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const noneButton = destPanel.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await noneButton.click()
    await page.waitForTimeout(200)

    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })
})

test.describe('Tools Tab - Copy Sample Slots One/Range Mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    await page.waitForTimeout(300)
  })

  test('Range button is visible and selected by default', async ({ page }) => {
    const rangeBtn = page.locator('.tools-slot-all-btn', { hasText: 'Range' })
    await expect(rangeBtn).toBeVisible()
    await expect(rangeBtn).toHaveClass(/selected/)
  })

  test('One button is visible', async ({ page }) => {
    const oneBtn = page.locator('.tools-slot-all-btn', { hasText: 'One' })
    await expect(oneBtn).toBeVisible()
  })

  test('Clicking One shows a single-handle slider', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const oneBtn = sourcePanel.locator('.tools-slot-all-btn', { hasText: 'One' })
    await oneBtn.click()
    await page.waitForTimeout(200)

    // Source range slider should be visible with single-range class
    const rangeSlider = sourcePanel.locator('.tools-dual-range-slider.tools-single-range')
    await expect(rangeSlider).toBeVisible()

    // Should have exactly one range input (single handle)
    const rangeInputs = rangeSlider.locator('.tools-dual-range-input')
    await expect(rangeInputs).toHaveCount(1)

    // One button should be selected
    await expect(oneBtn).toHaveClass(/selected/)
  })

  test('Clicking Range shows a dual-handle slider', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')

    // First switch to One
    const oneBtn = sourcePanel.locator('.tools-slot-all-btn', { hasText: 'One' })
    await oneBtn.click()
    await page.waitForTimeout(200)

    // Switch back to Range
    const rangeBtn = sourcePanel.locator('.tools-slot-all-btn', { hasText: 'Range' })
    await rangeBtn.click()
    await page.waitForTimeout(200)

    // Range slider should be visible without single-range class
    const rangeSlider = sourcePanel.locator('.tools-dual-range-slider').first()
    await expect(rangeSlider).toBeVisible()
    await expect(rangeSlider).not.toHaveClass(/tools-single-range/)

    // Should have two range inputs (dual handles)
    const rangeInputs = rangeSlider.locator('.tools-dual-range-input')
    await expect(rangeInputs).toHaveCount(2)

    await expect(rangeBtn).toHaveClass(/selected/)
  })

  test('One mode shows single slot input', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    const oneBtn = sourcePanel.locator('.tools-slot-all-btn', { hasText: 'One' })
    await oneBtn.click()
    await page.waitForTimeout(200)

    // Should have exactly one input in the source range display
    const inputs = sourcePanel.locator('.tools-slot-range-display .tools-slot-value-input')
    await expect(inputs).toHaveCount(1)

    // Separator should not be visible
    const separator = sourcePanel.locator('.tools-slot-separator')
    await expect(separator).not.toBeVisible()
  })

  test('Range mode shows two slot inputs with separator', async ({ page }) => {
    const sourcePanel = page.locator('.tools-source-panel')
    // Range is default
    const inputs = sourcePanel.locator('.tools-slot-range-display .tools-slot-value-input')
    await expect(inputs).toHaveCount(2)

    const separator = sourcePanel.locator('.tools-slot-separator')
    await expect(separator).toBeVisible()
  })

  test('Execute button is disabled when destination overflows', async ({ page }) => {
    // Default source range is 1-128 (all 128 slots)
    // Set destination start to 2 so range 2-129 overflows
    const destInput = page.locator('.tools-slot-selector .tools-slot-value-input').last()
    await destInput.fill('2')
    await destInput.blur()
    await page.waitForTimeout(300)

    // Warning badge should be visible
    const warningBadge = page.locator('.tools-warning-badge')
    await expect(warningBadge).toBeVisible()
    await expect(warningBadge).toHaveText('Some slots will overflow')

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Execute button is re-enabled when overflow is resolved', async ({ page }) => {
    // Create overflow: set dest start to 2 with full range
    const destInput = page.locator('.tools-slot-selector .tools-slot-value-input').last()
    await destInput.fill('2')
    await destInput.blur()
    await page.waitForTimeout(300)

    // Confirm disabled
    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()

    // Fix overflow: reset dest start to 1
    await destInput.fill('1')
    await destInput.blur()
    await page.waitForTimeout(300)

    // Warning should disappear
    const warningBadge = page.locator('.tools-warning-badge')
    await expect(warningBadge).not.toBeVisible()

    // Execute button should be enabled again
    await expect(executeBtn).toBeEnabled()
  })
})

test.describe('Tools Tab - Fix Missing Samples', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(2000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)
  })

  test('Fix Missing Samples appears in operation dropdown', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await expect(operationSelect.locator('option[value="fix_missing_samples"]')).toHaveText('Fix Missing Samples')
  })

  test('selecting Fix Missing Samples shows status badge', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    // Status badge should show count
    const statusCount = page.locator('.tools-fix-status-count')
    await expect(statusCount).toBeVisible()
    await expect(statusCount).toHaveText('3')
  })

  test('missing files list modal shows correct slot data', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    // Open the modal via the missing files summary button
    const summaryBtn = page.locator('.tools-missing-files-summary')
    await summaryBtn.click()

    // Modal should be visible
    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal).toBeVisible()

    // Check table contents — 3 files expand to 4 rows (hihat is in both Flex and Static)
    const rows = modal.locator('.samples-table tbody tr')
    await expect(rows).toHaveCount(4)
  })

  test('Execute button is visible when missing files exist', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await expect(executeBtn).toBeVisible()
    await expect(executeBtn).toBeEnabled()
  })

  test('Execute button hidden when 0 missing files', async ({ page }) => {
    // Override to return empty list
    await page.evaluate(() => {
      const original = (window as any).__TAURI_INTERNALS__.invoke
      ;(window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'list_missing_samples') return []
        return original(cmd, args)
      }
    })

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await expect(executeBtn).not.toBeVisible()
  })

  test('clicking Execute opens modal with search steps', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(2500)

    // Modal should be visible
    const modal = page.locator('.fix-missing-modal')
    await expect(modal).toBeVisible()
  })

  test('progress modal shows Browse button when files are still missing', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    // Enable "Review before applying" to prevent auto-apply
    const checkbox = page.locator('.tools-options-panel .tools-checkbox input[type="checkbox"]')
    if (!(await checkbox.isChecked())) {
      await checkbox.click()
    }

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(4000)

    const modal = page.locator('.fix-missing-modal')
    await expect(modal).toBeVisible()

    // Browse button should be visible in the summary line
    const browseBtn = modal.locator('.fix-search-summary .tools-execute-btn', { hasText: 'Browse...' })
    await expect(browseBtn).toBeVisible()

    // Summary should mention still missing files
    const summary = modal.locator('.fix-search-summary')
    await expect(summary).toContainText('still missing')
  })

  test('Review changes button opens review modal with unified table', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    // Uncheck skip-review so Review changes button is visible
    const checkbox = page.locator('.tools-options-panel .tools-checkbox input[type="checkbox"]')
    if (!(await checkbox.isChecked())) {
      await checkbox.click()
    }

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(4000)

    const modal = page.locator('.fix-missing-modal')

    // Click Review changes to go to confirmation
    const reviewBtn = modal.locator('.fix-done-actions .tools-execute-btn', { hasText: 'Review changes' })
    await reviewBtn.click()
    await page.waitForTimeout(500)

    // Review title should be visible
    await expect(modal.locator('.modal-header h3')).toContainText('Review planned changes')

    // Should show status with found count
    await expect(modal.locator('.fix-confirm-status')).toBeVisible()

    // Unified table should have all 3 files (1 found + 2 not found)
    const rows = modal.locator('.fix-confirmation .samples-table tbody tr')
    await expect(rows).toHaveCount(3)

    // Should have Found checkmarks (1 green, 2 red)
    const foundBadges = modal.locator('.file-status-badge.file-exists')
    await expect(foundBadges).toHaveCount(1)
    const missingBadges = modal.locator('.file-status-badge.file-missing')
    await expect(missingBadges).toHaveCount(2)

    // Should have Apply Changes and Cancel buttons
    await expect(modal.locator('.fix-confirm-actions .tools-execute-btn', { hasText: 'Apply Changes' })).toBeVisible()
    await expect(modal.locator('.fix-confirm-actions .fix-cancel-btn').first()).toBeVisible()
  })

  test('review modal supports filtering by Found status', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    // Uncheck skip-review so Review changes button is visible
    const checkbox = page.locator('.tools-options-panel .tools-checkbox input[type="checkbox"]')
    if (!(await checkbox.isChecked())) {
      await checkbox.click()
    }

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(4000)

    const modal = page.locator('.fix-missing-modal')
    const reviewBtn = modal.locator('.fix-done-actions .tools-execute-btn', { hasText: 'Review changes' })
    await reviewBtn.click()
    await page.waitForTimeout(500)

    // Search box should be visible
    await expect(modal.locator('.header-search-input')).toBeVisible()

    // Filter icon for Found column should be visible
    const foundFilterIcon = modal.locator('.fix-confirmation .filterable-header .filter-icon').first()
    await expect(foundFilterIcon).toBeVisible()
  })

  test('review modal has resize handles', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(500)

    const modal = page.locator('.fix-missing-modal')

    // Should have left, right, and bottom resize handles
    await expect(modal.locator('.modal-resize-left')).toBeAttached()
    await expect(modal.locator('.modal-resize-right')).toBeAttached()
    await expect(modal.locator('.modal-resize-bottom')).toBeAttached()
  })

  test('missing samples list modal has resize handles', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    const summaryBtn = page.locator('.tools-missing-files-summary')
    await summaryBtn.click()

    const modal = page.locator('.missing-samples-list-modal')
    await expect(modal).toBeVisible()

    // Should have left, right, and bottom resize handles
    await expect(modal.locator('.modal-resize-left')).toBeAttached()
    await expect(modal.locator('.modal-resize-right')).toBeAttached()
    await expect(modal.locator('.modal-resize-bottom')).toBeAttached()
  })

  test('auto-apply option is visible in Options panel', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    const optionsPanel = page.locator('.tools-options-panel')
    await expect(optionsPanel).toBeVisible()

    const checkbox = optionsPanel.locator('.tools-checkbox input[type="checkbox"]')
    await expect(checkbox).toBeVisible()
    await expect(checkbox).not.toBeChecked()

    const label = optionsPanel.locator('.tools-checkbox label')
    await expect(label).toContainText('Review before applying changes')
  })

  test('done phase shows search steps and result in unified progress view', async ({ page }) => {
    // Override to make search find all samples
    await page.evaluate(() => {
      const original = (window as any).__TAURI_INTERNALS__.invoke
      ;(window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'search_project_dir') {
          return [
            { filename: 'kick.wav', found_path: '/test/project/kick.wav', source_project: null },
            { filename: 'snare.wav', found_path: '/test/project/snare.wav', source_project: null },
            { filename: 'hihat.wav', found_path: '/test/project/hihat.wav', source_project: null },
          ]
        }
        return original(cmd, args)
      }
    })

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('fix_missing_samples')
    await page.waitForTimeout(1000)

    // skipReview defaults to true, so auto-apply fires after all samples found
    const executeBtn = page.locator('.tools-fix-missing-layout .tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(4000)

    const modal = page.locator('.fix-missing-modal')

    // Progress section should be visible in done phase
    const progressSection = modal.locator('.fix-progress-section')
    await expect(progressSection).toBeVisible()

    // Search steps should still be visible
    const searchSteps = modal.locator('.fix-search-steps .fix-search-step')
    const count = await searchSteps.count()
    expect(count).toBeGreaterThanOrEqual(3)

    // Done button should be visible (auto-apply completed)
    await expect(modal.locator('.fix-done-actions .tools-execute-btn', { hasText: 'Done' })).toBeVisible()
  })
})

test.describe('Tools Tab - Copy Banks Sample Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_bank')
    await page.waitForTimeout(300)
  })

  test('Copy Sample Slots toggle defaults to Yes', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')
    const yesBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Yes' }).first()
    await expect(yesBtn).toHaveClass(/selected/)
  })

  test('Additional options are visible by default when Copy Sample Slots is Yes', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')

    // Sample Scope and Audio Files should be visible by default
    await expect(optionsPanel.locator('label', { hasText: 'Sample Scope' })).toBeVisible()
    await expect(optionsPanel.locator('label', { hasText: 'Audio Files' })).toBeVisible()

    // Click No to hide them
    const noBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'No' }).first()
    await noBtn.click()
    await page.waitForTimeout(300)

    // Now Sample Scope should be hidden
    await expect(optionsPanel.locator('label', { hasText: 'Sample Scope' })).toHaveCount(0)
  })

  test('Toggling Copy Sample Slots back to No hides additional options', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')

    // Enable
    const yesBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Yes' }).first()
    await yesBtn.click()
    await page.waitForTimeout(300)
    await expect(optionsPanel.locator('label', { hasText: 'Sample Scope' })).toBeVisible()

    // Disable
    const noBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'No' }).first()
    await noBtn.click()
    await page.waitForTimeout(300)
    await expect(optionsPanel.locator('label', { hasText: 'Sample Scope' })).toHaveCount(0)
  })

  test('Sample Scope defaults to Used by bank', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')
    const yesBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Yes' }).first()
    await yesBtn.click()
    await page.waitForTimeout(300)

    const referencedBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Used by bank' })
    await expect(referencedBtn).toHaveClass(/selected/)
  })

  test('Sample Scope can be switched to All assigned', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')
    const yesBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Yes' }).first()
    await yesBtn.click()
    await page.waitForTimeout(300)

    const allConfiguredBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'All assigned' })
    await allConfiguredBtn.click()
    await page.waitForTimeout(200)
    await expect(allConfiguredBtn).toHaveClass(/selected/)
  })

  test('Validation status appears when Copy Sample Slots is Yes', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')
    const yesBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Yes' }).first()
    await yesBtn.click()
    await page.waitForTimeout(500)

    const validationStatus = page.locator('.tools-validation-status')
    await expect(validationStatus).toBeVisible()
    // Mock returns is_valid=true with 5 slots to copy (3 static + 2 flex, 1 dedup)
    await expect(validationStatus).toContainText('5 slots to copy')
    await expect(validationStatus).toContainText('1 already in destination and reused')
    await expect(validationStatus).toHaveClass(/valid/)
  })

  test('Execute button disabled when validation fails', async ({ page }) => {
    // Override mock to return invalid validation
    await page.evaluate(() => {
      const origInvoke = (window as any).__TAURI_INTERNALS__.invoke
      ;(window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'validate_bank_sample_slots') {
          return {
            static_needed: 10,
            flex_needed: 5,
            static_available: 3,
            flex_available: 2,
            static_dedup: 0,
            flex_dedup: 0,
            is_valid: false,
            error_message: 'Not enough free Static slots: need 10, only 3 available',
            flex_ram_free_mb: 44.0,
            flex_ram_new_mb: 5.0,
            flex_ram_free_after_copy_mb: 39.0,
            flex_memory_warning: null,
          }
        }
        return origInvoke(cmd, args)
      }
    })

    // Toggle No then Yes to re-trigger validation with new mock
    const optionsPanel = page.locator('.tools-options-panel')
    const noBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'No' }).first()
    await noBtn.click()
    await page.waitForTimeout(200)
    const yesBtn = optionsPanel.locator('.tools-toggle-btn', { hasText: 'Yes' }).first()
    await yesBtn.click()
    await page.waitForTimeout(500)

    const validationStatus = page.locator('.tools-validation-status')
    await expect(validationStatus).toHaveClass(/invalid/)

    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Execute sends correct parameters with sample options', async ({ page }) => {
    const optionsPanel = page.locator('.tools-options-panel')

    // Default is Copy Sample Slots = Yes, so just wait for validation
    await page.waitForTimeout(500)

    // Click Execute
    const executeBtn = page.locator('.tools-execute-btn')
    await executeBtn.click()
    await page.waitForTimeout(1000)

    // Check the captured args
    const args = await page.evaluate(() => (window as any).__lastCopyBankArgs__)
    expect(args).toBeTruthy()
    expect(args.copySamples).toBe(true)
    expect(args.sampleScope).toBe('referenced_only')
    expect(args.audioMode).toBe('mirror')
    expect(args.slotPlacement).toBe('keep_position')
    expect(args.copyAttributes).toBe(true)
    expect(args.attributeSelection).toEqual(expect.arrayContaining(['gain', 'bpm', 'trim', 'slices']))
  })
})

test.describe('Tools Tab - Audio Pool Present', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, { withAudioPool: true })
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)
  })

  test('Copy Sample Slots shows Move to Pool option when Audio Pool exists', async ({ page }) => {
    // Select Copy Sample Slots operation
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    // Move to Pool should be available (not disabled)
    const moveToPool = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await expect(moveToPool).toBeVisible()
    await expect(moveToPool).not.toBeDisabled()
  })

  test('Copy Sample Slots Move to Pool activates when clicked', async ({ page }) => {
    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_sample_slots')
    const moveToPool = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await expect(moveToPool).toBeVisible()
    // Click it to verify it activates
    await moveToPool.click()
    await expect(moveToPool).toHaveClass(/selected/)
  })
})

test.describe('Tools Tab - Copy Patterns Multi-Select Destination Banks', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_patterns')
    await page.waitForTimeout(300)
  })

  test('Destination Banks label is plural (multi-select)', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const banksLabel = destPanel.locator('.tools-field label', { hasText: 'Banks' })
    await expect(banksLabel).toBeVisible()
  })

  test('Destination banks allow multiple selection', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    const bankB = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^B$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank B to add it
    await bankB.click()
    await page.waitForTimeout(200)

    // Both should be selected
    await expect(bankA).toHaveClass(/selected/)
    await expect(bankB).toHaveClass(/selected/)
  })

  test('Destination banks has All and None buttons', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const allButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    const noneButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await expect(allButton).toBeVisible()
    await expect(noneButton).toBeVisible()
  })

  test('All button selects all 16 banks', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const allButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    await allButton.click()
    await page.waitForTimeout(200)

    const selectedBanks = bankField.locator('.tools-multi-btn.bank-btn.selected')
    // All 16 bank buttons + the All button itself
    await expect(selectedBanks).toHaveCount(17)
  })

  test('None button deselects all banks', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const noneButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await noneButton.click()
    await page.waitForTimeout(200)

    const selectedBanks = bankField.locator('.tools-multi-btn.bank-btn.selected:not(.tools-select-all)')
    await expect(selectedBanks).toHaveCount(0)
  })

  test('Execute disabled when no destination bank selected', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const noneButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await noneButton.click()
    await page.waitForTimeout(200)

    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Deselecting a bank removes it from selection', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A is selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click to deselect
    await bankA.click()
    await page.waitForTimeout(200)

    await expect(bankA).not.toHaveClass(/selected/)
  })
})

test.describe('Tools Tab - Copy Tracks Multi-Select Destination Banks', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    const toolsTab = page.locator('.header-tab', { hasText: 'Tools' })
    await toolsTab.click()
    await page.waitForTimeout(500)

    const operationSelect = page.locator('.tools-section .tools-select')
    await operationSelect.selectOption('copy_tracks')
    await page.waitForTimeout(300)
  })

  test('Destination Banks label is plural (multi-select)', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const banksLabel = destPanel.locator('.tools-field label', { hasText: 'Banks' })
    await expect(banksLabel).toBeVisible()
  })

  test('Destination banks allow multiple selection', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })
    const bankC = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^C$/ })

    // Bank A should be selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click bank C to add it
    await bankC.click()
    await page.waitForTimeout(200)

    // Both should be selected
    await expect(bankA).toHaveClass(/selected/)
    await expect(bankC).toHaveClass(/selected/)
  })

  test('Destination banks has All and None buttons', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const allButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    const noneButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await expect(allButton).toBeVisible()
    await expect(noneButton).toBeVisible()
  })

  test('All button selects all 16 banks', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const allButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'All' })
    await allButton.click()
    await page.waitForTimeout(200)

    const selectedBanks = bankField.locator('.tools-multi-btn.bank-btn.selected')
    // All 16 bank buttons + the All button itself
    await expect(selectedBanks).toHaveCount(17)
  })

  test('None button deselects all banks', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const noneButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await noneButton.click()
    await page.waitForTimeout(200)

    const selectedBanks = bankField.locator('.tools-multi-btn.bank-btn.selected:not(.tools-select-all)')
    await expect(selectedBanks).toHaveCount(0)
  })

  test('Execute disabled when no destination bank selected', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankField = destPanel.locator('.tools-field').filter({ has: page.locator('label', { hasText: 'Banks' }) })
    const noneButton = bankField.locator('.tools-multi-btn.tools-select-all', { hasText: 'None' })
    await noneButton.click()
    await page.waitForTimeout(200)

    const executeBtn = page.locator('.tools-execute-btn')
    await expect(executeBtn).toBeDisabled()
  })

  test('Deselecting a bank removes it from selection', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const bankA = destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^A$/ })

    // Bank A is selected by default
    await expect(bankA).toHaveClass(/selected/)

    // Click to deselect
    await bankA.click()
    await page.waitForTimeout(200)

    await expect(bankA).not.toHaveClass(/selected/)
  })
})

// The suite above verifies which toggle *looks* selected. These verify what the panel
// actually SENDS - the payload the Rust side receives. Without them the panel could show
// "Keep Original" while sending copy_source_part, and every other test would still pass.
// The conditional null fields are the ones worth pinning: they encode "this option only
// applies in that mode", which is exactly what silently rots during a UI refactor.
test.describe('Tools Tab - Copy Operation Payloads', () => {
  async function openTools(page: import('@playwright/test').Page, operation: string) {
    await setupTauriMocks(page)
    await page.goto('/')
    await page.goto('/#/project?path=/test/project&name=TestProject')
    await page.waitForTimeout(1000)
    await page.locator('.header-tab', { hasText: 'Tools' }).click()
    await page.waitForTimeout(500)
    await page.locator('.tools-section .tools-select').selectOption(operation)
    await page.waitForTimeout(300)
  }

  async function execute(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
      delete (window as any).__lastCopyArgs__
      ;(window as any).__copyCalls__ = []
    })
    await page.locator('.tools-execute-btn').click()
    await page.waitForTimeout(800)
  }

  const lastArgs = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as any).__lastCopyArgs__)
  const allCalls = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as any).__copyCalls__ ?? [])

  test('Copy Patterns sends its defaults: keep assignment, all tracks, no specific part', async ({ page }) => {
    await openTools(page, 'copy_patterns')
    await execute(page)

    const call = await lastArgs(page)
    expect(call, 'copy_patterns should have been invoked').toBeTruthy()
    expect(call.cmd).toBe('copy_patterns')
    expect(call.args.partAssignmentMode).toBe('keep_original')
    expect(call.args.trackMode).toBe('all')
    // destPart only travels when the user picked one; trackIndices only when they
    // narrowed the tracks. Sending a stale value here would silently reassign parts.
    expect(call.args.destPart).toBeNull()
    expect(call.args.trackIndices).toBeNull()
    expect(call.args.modeScope).not.toBeNull()
  })

  test('Copy Patterns sends destPart only when a specific part is chosen', async ({ page }) => {
    await openTools(page, 'copy_patterns')
    const partAssignment = page.locator('.tools-field').filter({ hasText: 'Part Assignment' })
    await partAssignment.locator('.tools-toggle-btn', { hasText: 'User Selection' }).click()
    await page.waitForTimeout(200)
    // Execute stays disabled until a destination part is picked in this mode.
    const partCross = page.locator('.tools-options-panel .tools-part-cross')
    await partCross.locator('.tools-toggle-btn.part-btn', { hasText: /^2$/ }).click()
    await page.waitForTimeout(200)
    await execute(page)

    const call = await lastArgs(page)
    expect(call.args.partAssignmentMode).toBe('select_specific')
    expect(call.args.destPart).not.toBeNull()
  })

  test('Copy Patterns sends trackIndices and drops modeScope when tracks are narrowed', async ({ page }) => {
    await openTools(page, 'copy_patterns')
    const options = page.locator('.tools-options-panel')
    await page.locator('.tools-toggle-btn', { hasText: 'Specific Tracks' }).click()
    await page.waitForTimeout(200)
    // Execute stays disabled until at least one track is picked in this mode.
    await options.locator('.tools-multi-select.tracks-stacked .tools-multi-btn.track-btn', { hasText: 'T1' }).click()
    await page.waitForTimeout(200)
    await execute(page)

    const call = await lastArgs(page)
    expect(call.args.trackMode).toBe('specific')
    expect(Array.isArray(call.args.trackIndices)).toBe(true)
    // modeScope describes "all tracks" copying; carrying it alongside a specific
    // track list would be contradictory input for the backend.
    expect(call.args.modeScope).toBeNull()
  })

  test('Copy Patterns issues one call per destination bank', async ({ page }) => {
    await openTools(page, 'copy_patterns')
    const destPanel = page.locator('.tools-dest-panel')
    await destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^C$/ }).click()
    await page.waitForTimeout(200)
    await execute(page)

    const calls = await allCalls(page)
    const banks = calls.map((c: any) => c.args.destBankIndex).sort()
    expect(banks.length).toBeGreaterThan(1)
    expect(new Set(banks).size).toBe(banks.length)
  })

  async function pickTracks(page: import('@playwright/test').Page) {
    // Execute is disabled with the title "Select source and destination tracks"
    // until both ends have one.
    await page.locator('.tools-source-panel .tools-multi-btn.track-btn', { hasText: 'T1' }).first().click()
    await page.locator('.tools-dest-panel .tools-multi-btn.track-btn', { hasText: 'T1' }).first().click()
    await page.waitForTimeout(200)
  }

  test('Copy Tracks sends the selected mode and its pattern selection', async ({ page }) => {
    await openTools(page, 'copy_tracks')
    await pickTracks(page)
    await execute(page)

    const call = await lastArgs(page)
    expect(call, 'copy_tracks should have been invoked').toBeTruthy()
    expect(call.cmd).toBe('copy_tracks')
    expect(typeof call.args.mode).toBe('string')
    expect(Array.isArray(call.args.sourceTrackIndices)).toBe(true)
    expect(Array.isArray(call.args.destTrackIndices)).toBe(true)
  })

  test('Copy Tracks omits pattern indices entirely in part-params mode', async ({ page }) => {
    await openTools(page, 'copy_tracks')
    const copyMode = page.locator('.tools-field').filter({ hasText: 'Copy Mode' })
    const partParams = copyMode.locator('.tools-toggle-btn', { hasText: 'Part Parameters' })
    await partParams.click()
    await pickTracks(page)
    await execute(page)

    const call = await lastArgs(page)
    expect(call.args.mode).toBe('part_params')
    // Part parameters live outside patterns; sending pattern indices would ask the
    // backend to write trigs that this mode must not touch.
    expect(call.args.sourcePatternIndex).toBeNull()
    expect(call.args.destPatternIndices).toBeNull()
  })

  test('Copy Parts sends matching source and destination part indices', async ({ page }) => {
    await openTools(page, 'copy_parts')
    await execute(page)

    const call = await lastArgs(page)
    expect(call, 'copy_parts should have been invoked').toBeTruthy()
    expect(call.cmd).toBe('copy_parts')
    expect(Array.isArray(call.args.sourcePartIndices)).toBe(true)
    expect(Array.isArray(call.args.destPartIndices)).toBe(true)
    expect(call.args.sourcePartIndices.length).toBe(call.args.destPartIndices.length)
  })

  test('Copy Parts issues one call per destination bank', async ({ page }) => {
    await openTools(page, 'copy_parts')
    const destPanel = page.locator('.tools-dest-panel')
    await destPanel.locator('.tools-multi-btn.bank-btn', { hasText: /^D$/ }).click()
    await page.waitForTimeout(200)
    await execute(page)

    const calls = await allCalls(page)
    const banks = calls.map((c: any) => c.args.destBankIndex)
    expect(banks.length).toBeGreaterThan(1)
    expect(new Set(banks).size).toBe(banks.length)
  })

  test('every copy operation names the source project it was opened on', async ({ page }) => {
    for (const op of ['copy_parts', 'copy_patterns', 'copy_tracks']) {
      await openTools(page, op)
      if (op === 'copy_tracks') await pickTracks(page)
      await execute(page)
      const call = await lastArgs(page)
      expect(call, `${op} should have been invoked`).toBeTruthy()
      expect(call.args.sourceProject).toBe('/test/project')
      expect(call.args.destProject).toBeTruthy()
    }
  })
})

// ============================================================================
// Multi-item source selection (Copy Banks / Copy Patterns)
// ============================================================================

/** Open the Tools tab on the test project with `operation` selected. */
async function openToolsPanel(page: Page, operation: string, opts?: Parameters<typeof setupTauriMocks>[1]) {
  await setupTauriMocks(page, opts)
  await page.goto('/')
  await page.goto('/#/project?path=/test/project&name=TestProject')
  await page.waitForTimeout(1000)
  await page.locator('.header-tab', { hasText: 'Tools' }).click()
  await page.waitForTimeout(500)
  await page.locator('.tools-section .tools-select').selectOption(operation)
  await page.waitForTimeout(300)
}

async function runExecute(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__copyBankCalls__ = []
    ;(window as any).__copyCalls__ = []
  })
  await page.locator('.tools-execute-btn').click()
  await page.waitForTimeout(800)
}

const bankCalls = (page: Page) => page.evaluate(() => (window as any).__copyBankCalls__ ?? [])
const copyCalls = (page: Page) => page.evaluate(() => (window as any).__copyCalls__ ?? [])

/** Letters of the selected buttons in a panel, in DOM order. */
async function selectedLabels(page: Page, panel: string, kind: string) {
  return page.locator(`${panel} .tools-multi-btn.${kind}.selected:not(.tools-select-all)`).allTextContents()
}

test.describe('Tools Tab - Copy Banks multi-select source', () => {
  const source = '.tools-source-panel'
  const dest = '.tools-dest-panel'
  const bank = (page: Page, panel: string, letter: string) =>
    page.locator(`${panel} .tools-multi-btn.bank-btn`, { hasText: new RegExp(`^${letter}$`) })

  test.beforeEach(async ({ page }) => {
    await openToolsPanel(page, 'copy_bank')
  })

  test('starts on a single source bank', async ({ page }) => {
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['A'])
  })

  test('shift-click selects the range between the anchor and the click', async ({ page }) => {
    // Bank A is selected by default, so it is already the anchor.
    await bank(page, source, 'D').click({ modifiers: ['Shift'] })
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['A', 'B', 'C', 'D'])
  })

  test('shift-click backwards selects the same range', async ({ page }) => {
    await bank(page, source, 'D').click()
    await bank(page, source, 'B').click({ modifiers: ['Shift'] })
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['B', 'C', 'D'])
  })

  test('a second shift-click re-ranges from the same anchor', async ({ page }) => {
    await bank(page, source, 'D').click({ modifiers: ['Shift'] })
    await bank(page, source, 'B').click({ modifiers: ['Shift'] })
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['A', 'B'])
  })

  test('ctrl-click adds a bank without dropping the others', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['ControlOrMeta'] })
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['A', 'C'])
  })

  test('ctrl-click on a selected bank removes it', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['ControlOrMeta'] })
    await bank(page, source, 'A').click({ modifiers: ['ControlOrMeta'] })
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['C'])
  })

  test('a plain click collapses the selection back to one bank', async ({ page }) => {
    await bank(page, source, 'D').click({ modifiers: ['Shift'] })
    await bank(page, source, 'C').click()
    expect(await selectedLabels(page, source, 'bank-btn')).toEqual(['C'])
  })

  test('the destination locks to as many banks as the source', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    expect((await selectedLabels(page, dest, 'bank-btn')).length).toBe(3)
  })

  test('clicking a destination starts the run there', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    await bank(page, dest, 'E').click()
    expect(await selectedLabels(page, dest, 'bank-btn')).toEqual(['E', 'F', 'G'])
  })

  test('a run near the end slides back so it fits', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    await bank(page, dest, 'P').click()
    expect(await selectedLabels(page, dest, 'bank-btn')).toEqual(['N', 'O', 'P'])
  })

  test('the destination All button is disabled while the run is locked', async ({ page }) => {
    const all = page.locator(`${dest} .tools-multi-btn.bank-btn.tools-select-all`, { hasText: 'All' })
    await expect(all).toBeEnabled()
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    await expect(all).toBeDisabled()
  })

  test('one source bank still fans out to several destinations', async ({ page }) => {
    await bank(page, dest, 'C').click()
    await bank(page, dest, 'D').click()
    expect((await selectedLabels(page, dest, 'bank-btn')).length).toBeGreaterThan(1)

    await runExecute(page)
    const calls = await bankCalls(page)
    expect(calls).toHaveLength(1)
    expect(calls[0].sourceBankIndex).toBe(0)
    expect(calls[0].destBankIndices.length).toBeGreaterThan(1)
  })

  test('several source banks issue one call per pair', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    await bank(page, dest, 'I').click()
    await runExecute(page)

    const calls = await bankCalls(page)
    expect(calls).toHaveLength(3)
    const pairs = calls.map((c: any) => [c.sourceBankIndex, c.destBankIndices])
    expect(pairs.sort()).toEqual([[0, [8]], [1, [9]], [2, [10]]])
  })

  test('an overlapping shift up is copied from the top down', async ({ page }) => {
    // A,B,C -> B,C,D inside one project: B and C are both a source and a
    // destination, so the highest pair has to run first.
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    await bank(page, dest, 'B').click()
    await runExecute(page)

    const calls = await bankCalls(page)
    expect(calls.map((c: any) => c.sourceBankIndex)).toEqual([2, 1, 0])
  })

  test('an overlapping shift down is copied from the bottom up', async ({ page }) => {
    await bank(page, source, 'B').click()
    await bank(page, source, 'D').click({ modifiers: ['Shift'] })
    await bank(page, dest, 'A').click()
    await runExecute(page)

    const calls = await bankCalls(page)
    expect(calls.map((c: any) => c.sourceBankIndex)).toEqual([1, 2, 3])
  })

  test('sample validation is asked about every selected source bank', async ({ page }) => {
    await bank(page, source, 'C').click({ modifiers: ['Shift'] })
    await page.waitForTimeout(400)
    const args = await page.evaluate(() => (window as any).__lastValidateArgs__)
    expect(args.sourceBankIndices).toEqual([0, 1, 2])
  })
})

test.describe('Tools Tab - Copy Patterns multi-select source', () => {
  const source = '.tools-source-panel'
  const dest = '.tools-dest-panel'
  const pattern = (page: Page, panel: string, n: number) =>
    page.locator(`${panel} .tools-multi-btn.pattern-btn`, { hasText: new RegExp(`^${n}$`) })

  test.beforeEach(async ({ page }) => {
    await openToolsPanel(page, 'copy_patterns')
  })

  test('shift-click selects a range of source patterns', async ({ page }) => {
    // Pattern 1 is selected by default, so it is already the anchor.
    await pattern(page, source, 4).click({ modifiers: ['Shift'] })
    expect(await selectedLabels(page, source, 'pattern-btn')).toEqual(['1', '2', '3', '4'])
  })

  test('ctrl-click picks discrete source patterns', async ({ page }) => {
    await pattern(page, source, 5).click({ modifiers: ['ControlOrMeta'] })
    await pattern(page, source, 9).click({ modifiers: ['ControlOrMeta'] })
    expect(await selectedLabels(page, source, 'pattern-btn')).toEqual(['1', '5', '9'])
  })

  test('the destination locks to the same number of patterns', async ({ page }) => {
    await pattern(page, source, 3).click({ modifiers: ['Shift'] })
    expect((await selectedLabels(page, dest, 'pattern-btn')).length).toBe(3)

    await pattern(page, dest, 5).click()
    expect(await selectedLabels(page, dest, 'pattern-btn')).toEqual(['5', '6', '7'])
  })

  test('the destination run slides back so it fits', async ({ page }) => {
    await pattern(page, source, 3).click({ modifiers: ['Shift'] })
    await pattern(page, dest, 16).click()
    expect(await selectedLabels(page, dest, 'pattern-btn')).toEqual(['14', '15', '16'])
  })

  test('execute sends the source and destination patterns one for one', async ({ page }) => {
    await pattern(page, source, 5).click({ modifiers: ['ControlOrMeta'] })
    await pattern(page, source, 9).click({ modifiers: ['ControlOrMeta'] })
    await pattern(page, dest, 5).click()
    await runExecute(page)

    const calls = await copyCalls(page)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0].args.sourcePatternIndices).toEqual([0, 4, 8])
    expect(calls[0].args.destPatternIndices).toEqual([4, 5, 6])
  })

  test('one source pattern still fans out to several destinations', async ({ page }) => {
    await pattern(page, dest, 3).click()
    await pattern(page, dest, 4).click()
    await runExecute(page)

    const calls = await copyCalls(page)
    expect(calls[0].args.sourcePatternIndices).toEqual([0])
    expect(calls[0].args.destPatternIndices.length).toBeGreaterThan(1)
  })

  test('All selects every source pattern and syncs the destination', async ({ page }) => {
    await page.locator(`${source} .tools-multi-btn.pattern-btn.tools-select-all`, { hasText: 'All' }).click()
    expect((await selectedLabels(page, source, 'pattern-btn')).length).toBe(16)
    expect((await selectedLabels(page, dest, 'pattern-btn')).length).toBe(16)
    await expect(pattern(page, dest, 1)).toBeDisabled()
  })

  test('execute is blocked while the counts disagree', async ({ page }) => {
    await pattern(page, source, 3).click({ modifiers: ['Shift'] })
    await page.locator(`${dest} .tools-multi-btn.pattern-btn.tools-select-all`, { hasText: 'None' }).click()
    await expect(page.locator('.tools-execute-btn')).toBeDisabled()
  })
})

test.describe('Tools Tab - source project selection', () => {
  const sourceBtn = '.tools-source-panel .tools-project-selector-btn'
  const destBtn = '.tools-dest-panel .tools-project-selector-btn'

  /** Pick OtherProject in whichever picker is open. */
  async function pickOtherProject(page: Page) {
    await page.locator('.project-selector-modal .scan-button', { hasText: 'Rescan for Projects' }).click()
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      ;(document.querySelector('.project-selector-modal .location-header') as HTMLElement)?.click()
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      ;(document.querySelector('.project-selector-modal .set-header') as HTMLElement)?.click()
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      for (const card of document.querySelectorAll('.project-selector-card')) {
        if (card.textContent?.includes('OtherProject')) {
          ;(card as HTMLElement).click()
          return
        }
      }
    })
    await page.waitForTimeout(500)
  }

  test('the source panel has its own project selector, on the current project', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await expect(page.locator(sourceBtn)).toBeVisible()
    await expect(page.locator('.tools-source-panel .tools-project-selector-name')).toContainText('TestProject')
    await expect(page.locator('.tools-source-panel .tools-project-selector-current')).toBeVisible()
  })

  test('the picker opens titled for the pane that asked for it', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await expect(page.locator('.project-selector-modal h3')).toHaveText('Select Source Project')
    await page.locator('.project-selector-modal .modal-close').click()
    await page.locator(destBtn).click()
    await expect(page.locator('.project-selector-modal h3')).toHaveText('Select Destination Project')
  })

  test('the source picker offers no New Project card', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await page.locator('.project-selector-modal .scan-button', { hasText: 'Rescan for Projects' }).click()
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      ;(document.querySelector('.project-selector-modal .location-header') as HTMLElement)?.click()
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      ;(document.querySelector('.project-selector-modal .set-header') as HTMLElement)?.click()
    })
    await page.waitForTimeout(300)
    await expect(page.locator('.project-selector-modal .new-project-card')).toHaveCount(0)
  })

  test('choosing another project switches the source without touching the destination', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await pickOtherProject(page)

    await expect(page.locator('.tools-source-panel .tools-project-selector-name')).toContainText('OtherProject')
    await expect(page.locator('.tools-dest-panel .tools-project-selector-name')).toContainText('TestProject')
  })

  test('the source bank grid follows the source project', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    const sourceBankC = page.locator('.tools-source-panel .tools-multi-btn.bank-btn', { hasText: /^C$/ })
    await expect(sourceBankC).toBeEnabled()

    await page.locator(sourceBtn).click()
    await pickOtherProject(page)

    // OtherProject holds banks A and B only.
    await expect(sourceBankC).toBeDisabled()
    const sourceBankB = page.locator('.tools-source-panel .tools-multi-btn.bank-btn', { hasText: /^B$/ })
    await expect(sourceBankB).toBeEnabled()
    await sourceBankB.click({ modifiers: ['Shift'] })
    expect(await selectedLabels(page, '.tools-source-panel', 'bank-btn')).toEqual(['A', 'B'])
  })

  test('a source bank that the new project lacks is dropped from the selection', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    const sourcePanel = '.tools-source-panel'
    await page.locator(`${sourcePanel} .tools-multi-btn.bank-btn`, { hasText: /^C$/ }).click()
    expect(await selectedLabels(page, sourcePanel, 'bank-btn')).toEqual(['C'])

    await page.locator(sourceBtn).click()
    await pickOtherProject(page)
    expect(await selectedLabels(page, sourcePanel, 'bank-btn')).toEqual([])
  })

  test('copy_bank is sent with the chosen source project', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await pickOtherProject(page)
    await runExecute(page)

    const calls = await bankCalls(page)
    expect(calls).toHaveLength(1)
    expect(calls[0].sourceProject).toBe('/test/other-project')
    expect(calls[0].destProject).toBe('/test/project')
  })

  test('the picker search box waits for Ctrl+F rather than grabbing focus', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()

    const search = page.locator('.project-selector-modal .header-search-input')
    await expect(search).toBeVisible()
    await expect(search).not.toBeFocused()

    await page.keyboard.press('Control+f')
    await expect(search).toBeFocused()
  })

  test('the picker filters the list as you type and clears back', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await page.locator('.project-selector-modal .scan-button', { hasText: 'Rescan for Projects' }).click()
    await page.waitForTimeout(500)

    const search = page.locator('.project-selector-modal .header-search-input')
    await expect(search).toBeVisible()

    // A search expands the groups, so a hit is reachable without opening anything.
    await search.fill('other')
    await expect(page.locator('.project-selector-card', { hasText: 'OtherProject' })).toBeVisible()
    await expect(page.locator('.project-selector-card', { hasText: 'TestProject' })).toHaveCount(0)

    await search.fill('')
    await expect(page.locator('.project-selector-card', { hasText: 'TestProject' })).toHaveCount(1)
  })

  test('the picker says so when nothing matches, and the clear button brings the list back', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await page.locator('.project-selector-modal .scan-button', { hasText: 'Rescan for Projects' }).click()
    await page.waitForTimeout(500)

    const search = page.locator('.project-selector-modal .header-search-input')
    await search.fill('zzzznothing')
    await expect(page.locator('.project-selector-modal .no-matches')).toBeVisible()

    await page.locator('.project-selector-modal .no-matches button', { hasText: 'Clear search' }).click()
    await expect(page.locator('.project-selector-modal .no-matches')).toHaveCount(0)
    await expect(search).toHaveValue('')
  })

  test('group headers in the picker still collapse while a search is active', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.locator(sourceBtn).click()
    await page.locator('.project-selector-modal .scan-button', { hasText: 'Rescan for Projects' }).click()
    await page.waitForTimeout(500)

    await page.locator('.project-selector-modal .header-search-input').fill('project')
    const setSection = page.locator('.project-selector-modal .set-card').locator('.sets-section')
    await expect(setSection).toHaveClass(/open/)
    await page.locator('.project-selector-modal .set-header').click()
    await expect(setSection).toHaveClass(/closed/)
  })

  test('both project buttons offer a right-click path menu', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    for (const btn of [sourceBtn, destBtn]) {
      await page.locator(btn).click({ button: 'right' })
      const menu = page.locator('.context-menu')
      await expect(menu).toBeVisible()
      await expect(menu.locator('.context-menu-item', { hasText: 'Open in file explorer' })).toBeVisible()
      await expect(menu.locator('.context-menu-item', { hasText: 'Copy path to clipboard' })).toBeVisible()
      // Not Escape: that is the project page's own "go back" key.
      await page.locator('.tools-source-panel h3').click()
      await expect(menu).toHaveCount(0)
    }
  })

  test('the right-click menu reveals the project it was opened on', async ({ page }) => {
    await openToolsPanel(page, 'copy_bank', { withOtherProject: true })
    await page.evaluate(() => { (window as any).__revealed__ = [] })
    await page.locator(sourceBtn).click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Open in file explorer' }).click()
    // The mock records every invoke; assert the path it was handed.
    const revealed = await page.evaluate(() => (window as any).__lastRevealPath__)
    expect(revealed).toBe('/test/project')
  })

  test('the other copy tools carry the chosen source project too', async ({ page }) => {
    for (const op of ['copy_patterns', 'copy_parts']) {
      await openToolsPanel(page, op, { withOtherProject: true })
      await page.locator(sourceBtn).click()
      await pickOtherProject(page)
      await page.waitForTimeout(200)
      await runExecute(page)

      const calls = await copyCalls(page)
      expect(calls.length, `${op} should have been invoked`).toBeGreaterThan(0)
      expect(calls[0].args.sourceProject).toBe('/test/other-project')
    }
  })
})
