import { test, expect, Page } from '@playwright/test'

/**
 * Tools Tab E2E Tests
 *
 * These tests use mock Tauri responses to test the Tools tab UI without the full Tauri backend.
 * The mock data simulates a loaded Octatrack project with banks, patterns, and sample slots.
 */

// Helper to inject Tauri mocks before page load
async function setupTauriMocks(page: Page) {
  await page.addInitScript(() => {
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
                audio_cued_tracks: [],
                midi_muted_tracks: [],
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
              name: `BANK ${String.fromCharCode(65 + i)}`,
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
            return [0, 1, 2, 3] // Banks A, B, C, D exist

          case 'scan_devices':
            return { locations: [], standalone_projects: [] }

          case 'check_project_in_set':
            return true

          case 'check_projects_in_same_set':
            return true

          case 'get_audio_pool_status':
            return { exists: false, path: null, set_path: '/test/set' }

          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }

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
  })
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

    // Should show Part Assignment options
    await expect(page.getByText('Part Assignment')).toBeVisible()
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

  test('Static + Flex is selected by default', async ({ page }) => {
    const staticFlexBtn = page.locator('.tools-toggle-btn', { hasText: 'Static + Flex' })
    await expect(staticFlexBtn).toHaveClass(/selected/)
  })

  test('clicking Slot Type button changes selection', async ({ page }) => {
    const flexBtn = page.locator('.tools-toggle-btn').filter({ hasText: /^Flex$/ })
    const staticFlexBtn = page.locator('.tools-toggle-btn', { hasText: 'Static + Flex' })

    await flexBtn.click()
    await page.waitForTimeout(200)

    await expect(flexBtn).toHaveClass(/selected/)
    await expect(staticFlexBtn).not.toHaveClass(/selected/)
  })

  test('Audio Files has three toggle buttons', async ({ page }) => {
    await expect(page.getByText('Audio Files')).toBeVisible()

    const copyBtn = page.locator('.tools-toggle-btn', { hasText: /^Copy$/ })
    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    const dontCopyBtn = page.locator('.tools-toggle-btn', { hasText: "Don't Copy" })

    await expect(copyBtn).toBeVisible()
    await expect(moveToPoolBtn).toBeVisible()
    await expect(dontCopyBtn).toBeVisible()
  })

  test('Move to Pool is selected by default when projects are in same Set', async ({ page }) => {
    // Our mock returns check_projects_in_same_set = true
    const moveToPoolBtn = page.locator('.tools-toggle-btn', { hasText: 'Move to Pool' })
    await expect(moveToPoolBtn).toHaveClass(/selected/)
  })

  test('Include Editor Settings checkbox is visible and checked by default', async ({ page }) => {
    const label = page.getByText('Include Editor Settings')
    await expect(label).toBeVisible()

    const checkbox = page.locator('.tools-checkbox input[type="checkbox"]')
    await expect(checkbox).toBeChecked()
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
    await expect(page.getByText('Part Assignment')).toBeVisible()
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
    await expect(page.getByText('Track Scope')).toBeVisible()
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

    // T1 should be selected by default
    const t1Button = trackButtons.locator('.tools-multi-btn.track-btn', { hasText: 'T1' })
    await expect(t1Button).toHaveClass(/selected/)

    // Deselect T1
    await t1Button.click()
    await page.waitForTimeout(200)
    await expect(t1Button).not.toHaveClass(/selected/)

    // No tracks should be selected now
    const selectedTracks = trackButtons.locator('.tools-multi-btn.track-btn.selected')
    await expect(selectedTracks).toHaveCount(0)

    // Execute button should be disabled
    const executeBtn = page.locator('.tools-execute-btn')
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

    // Verify order: Part Params, Both, Pattern Triggers
    await expect(buttons.nth(0)).toHaveText('Part Params')
    await expect(buttons.nth(1)).toHaveText('Both')
    await expect(buttons.nth(2)).toHaveText('Pattern Triggers')
  })

  test('Both is selected by default', async ({ page }) => {
    const bothBtn = page.locator('.tools-toggle-btn', { hasText: 'Both' })
    await expect(bothBtn).toHaveClass(/selected/)
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
    await expect(page.locator('.tools-project-selector-btn')).toBeVisible()
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

  test('Destination panel has Banks label (plural) for multi-select', async ({ page }) => {
    const destPanel = page.locator('.tools-dest-panel')
    const banksLabel = destPanel.locator('.tools-field label', { hasText: 'Banks' })
    await expect(banksLabel).toBeVisible()
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

    // All 16 banks should be selected
    const selectedBanks = destPanel.locator('.tools-multi-btn.bank-btn.selected')
    await expect(selectedBanks).toHaveCount(16)
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
