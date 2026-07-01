import { test, expect, Page } from '@playwright/test'

/**
 * Parts Editor E2E Tests
 *
 * Tests the Parts tab (PartsPanel) with mocked Tauri responses: part tabs, page tabs,
 * view/edit mode, param editing (auto-save to parts.unsaved), Save/Save All (commit),
 * Reload, and shared LFO tab persistence across bank changes.
 *
 * Mock data conventions:
 * - Part names from bank: PART 1, GROOVE, PART 3, PART 4
 * - amps[track].atk = 20 + partId (so switching parts is observable)
 * - reload_part returns atk = 99 (so reloading is observable)
 * - fx1_type = 4 (FILTER), fx2_type = 8 (DELAY)
 */

interface MockOptions {
  partsEditedBitmask?: number
  partsSavedState?: number[]
}

async function setupTauriMocks(page: Page, options?: MockOptions) {
  const opts = {
    partsEditedBitmask: options?.partsEditedBitmask ?? 0,
    partsSavedState: options?.partsSavedState ?? [1, 0, 0, 0],
  }
  await page.addInitScript((opts: { partsEditedBitmask: number; partsSavedState: number[] }) => {
    const makeMachine = (trackId: number) => ({
      track_id: trackId,
      machine_type: 'Flex',
      machine_params: { ptch: 64, strt: 0, len: 0, rate: 0, rtrg: 0, rtim: 0, in_ab: null, vol_ab: null, in_cd: null, vol_cd: null, dir: null, gain: null, op: null },
      machine_setup: { xloop: 0, slic: 0, len: 0, rate: 0, tstr: 0, tsns: 0 },
    })
    const makeAmp = (trackId: number, partId: number) => ({
      track_id: trackId,
      atk: 20 + partId, hold: 1, rel: 2, vol: 100, bal: 64, f: 3,
      amp_setup_amp: 0, amp_setup_sync: 0, amp_setup_atck: 0, amp_setup_fx1: 0, amp_setup_fx2: 0,
    })
    const makeLfo = (trackId: number) => ({
      track_id: trackId,
      spd1: 0, spd2: 0, spd3: 0, dep1: 0, dep2: 0, dep3: 0,
      lfo1_pmtr: 0, lfo2_pmtr: 0, lfo3_pmtr: 0,
      lfo1_wave: 0, lfo2_wave: 0, lfo3_wave: 0,
      lfo1_mult: 0, lfo2_mult: 0, lfo3_mult: 0,
      lfo1_trig: 0, lfo2_trig: 0, lfo3_trig: 0,
      custom_lfo_design: Array(16).fill(0),
    })
    const makeFx = (trackId: number) => ({
      track_id: trackId,
      fx1_type: 4, fx2_type: 8,
      fx1_param1: 0, fx1_param2: 0, fx1_param3: 0, fx1_param4: 0, fx1_param5: 0, fx1_param6: 0,
      fx2_param1: 0, fx2_param2: 0, fx2_param3: 0, fx2_param4: 0, fx2_param5: 0, fx2_param6: 0,
      fx1_setup1: 0, fx1_setup2: 0, fx1_setup3: 0, fx1_setup4: 0, fx1_setup5: 0, fx1_setup6: 0,
      fx2_setup1: 0, fx2_setup2: 0, fx2_setup3: 0, fx2_setup4: 0, fx2_setup5: 0, fx2_setup6: 0,
    })
    const makeMidiNote = (trackId: number) => ({
      track_id: trackId,
      note: 60, vel: 100, len: 6, not2: 0, not3: 0, not4: 0,
      chan: trackId + 1, bank: 0, prog: 0, sbnk: 0,
    })
    const makeMidiArp = (trackId: number) => ({
      track_id: trackId,
      tran: 0, leg: 0, mode: 0, spd: 0, rnge: 0, nlen: 0, len: 0, key: 0,
    })
    const makeMidiCtrl1 = (trackId: number) => ({
      track_id: trackId,
      pb: 0, at: 0, cc1: 0, cc2: 0, cc3: 0, cc4: 0,
      cc1_num: 1, cc2_num: 2, cc3_num: 3, cc4_num: 4,
    })
    const makeMidiCtrl2 = (trackId: number) => ({
      track_id: trackId,
      cc5: 0, cc6: 0, cc7: 0, cc8: 0, cc9: 0, cc10: 0,
      cc5_num: 5, cc6_num: 6, cc7_num: 7, cc8_num: 8, cc9_num: 9, cc10_num: 10,
    })
    const tracks = [0, 1, 2, 3, 4, 5, 6, 7]
    const makePart = (partId: number, atkOverride?: number) => ({
      part_id: partId,
      machines: tracks.map(makeMachine),
      amps: tracks.map((t) => {
        const amp = makeAmp(t, partId)
        if (atkOverride !== undefined) amp.atk = atkOverride
        return amp
      }),
      lfos: tracks.map(makeLfo),
      fxs: tracks.map(makeFx),
      midi_notes: tracks.map(makeMidiNote),
      midi_arps: tracks.map(makeMidiArp),
      midi_lfos: tracks.map(makeLfo),
      midi_ctrl1s: tracks.map(makeMidiCtrl1),
      midi_ctrl2s: tracks.map(makeMidiCtrl2),
    })

    const invokeCalls: { cmd: string; args: any }[] = []
    ;(window as any).__invokeCalls = invokeCalls

    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        invokeCalls.push({ cmd, args })
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
                flex_slots: Array(128).fill(null).map((_, i) => ({ slot_id: i, slot_type: 'Flex', path: null, gain: null, loop_mode: null, timestretch_mode: null, source_location: null, file_exists: false, compatibility: null, file_format: null, bit_depth: null, sample_rate: null })),
                static_slots: Array(128).fill(null).map((_, i) => ({ slot_id: i, slot_type: 'Static', path: null, gain: null, loop_mode: null, timestretch_mode: null, source_location: null, file_exists: false, compatibility: null, file_format: null, bit_depth: null, sample_rate: null })),
              },
            }

          case 'get_existing_banks':
            return [0, 1]

          case 'load_single_bank': {
            const bankIndex = args?.bankIndex ?? 0
            return {
              id: String.fromCharCode(65 + bankIndex),
              name: `BANK ${String.fromCharCode(65 + bankIndex)}`,
              index: bankIndex,
              parts: [
                { id: 0, name: 'PART 1', patterns: [] },
                { id: 1, name: 'GROOVE', patterns: [] },
                { id: 2, name: 'PART 3', patterns: [] },
                { id: 3, name: 'PART 4', patterns: [] },
              ],
            }
          }

          case 'load_parts_data':
            return {
              parts: [0, 1, 2, 3].map((partId) => makePart(partId)),
              parts_edited_bitmask: opts.partsEditedBitmask,
              parts_saved_state: opts.partsSavedState,
            }

          case 'reload_part':
            return makePart(args?.partId ?? 0, 99)

          case 'save_parts':
          case 'commit_part':
          case 'commit_all_parts':
          case 'backup_project_files':
            return null

          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'check_missing_source_files':
            return 0
          case 'get_audio_pool_status':
            return { exists: false, path: null, set_path: '/test/set' }
          case 'check_project_in_set':
            return true
          case 'get_slot_audio_paths':
            return []
          case 'plugin:app|version':
            return '1.0.0'

          default:
            console.warn('Unhandled mock invoke:', cmd)
            return null
        }
      },
      transformCallback: () => {},
    }
    ;(window as any).__TAURI__ = {
      invoke: (window as any).__TAURI_INTERNALS__.invoke,
    }
  }, opts)
}

async function getInvokeCalls(page: Page, cmd: string): Promise<{ cmd: string; args: any }[]> {
  return page.evaluate((c) => (window as any).__invokeCalls.filter((call: any) => call.cmd === c), cmd)
}

async function openPartsTab(page: Page) {
  await page.goto('/#/project?path=/test/project&name=TestProject')
  const partsTab = page.locator('.header-tab', { hasText: 'Parts' })
  await expect(partsTab).toBeVisible({ timeout: 10000 })
  await partsTab.click()
  await expect(page.locator('.bank-card-header h3', { hasText: 'Parts' })).toBeVisible({ timeout: 10000 })
}

async function enterEditMode(page: Page) {
  await page.locator('.mode-toggle').click()
  await expect(page.locator('.parts-edit-controls.visible')).toBeVisible()
}

// Locates the ATK param row for the first displayed track on the AMP page
function atkInput(page: Page) {
  return page
    .locator('.param-item')
    .filter({ has: page.getByText('ATK', { exact: true }) })
    .first()
    .locator('input.param-value')
}

async function selectTrack(page: Page, value: string) {
  await page.locator('#parts-track-select').selectOption(value)
}

test.describe('Parts Editor - Layout', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
  })

  test('shows four part tabs named from the bank', async ({ page }) => {
    const partTabs = page.locator('.parts-part-tab')
    await expect(partTabs).toHaveCount(4)
    await expect(partTabs.nth(0)).toContainText('PART 1 (1)')
    await expect(partTabs.nth(1)).toContainText('GROOVE (2)')
    await expect(partTabs.nth(2)).toContainText('PART 3 (3)')
    await expect(partTabs.nth(3)).toContainText('PART 4 (4)')
  })

  test('audio track shows All/SRC/AMP/LFO/FX1/FX2 page tabs', async ({ page }) => {
    const pageTabs = page.locator('.parts-page-tabs .parts-tab')
    await expect(pageTabs).toHaveText(['All', 'SRC', 'AMP', 'LFO', 'FX1', 'FX2'])
  })

  test('MIDI track shows All/NOTE/ARP/LFO/CTRL1/CTRL2 page tabs', async ({ page }) => {
    await selectTrack(page, '8') // M1
    const pageTabs = page.locator('.parts-page-tabs .parts-tab')
    await expect(pageTabs).toHaveText(['All', 'NOTE', 'ARP', 'LFO', 'CTRL1', 'CTRL2'])
  })

  test('FX1 page shows FILTER labels for fx1_type=4', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'FX1' }).click()
    await expect(page.locator('.params-column-label', { hasText: 'MAIN - FILTER' })).toBeVisible()
    await expect(page.getByText('BASE', { exact: true })).toBeVisible()
    await expect(page.getByText('WIDTH', { exact: true })).toBeVisible()
  })

  test('switching part tabs shows that part\'s values', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    await expect(atkInput(page)).toHaveValue('20') // part 1: atk = 20 + 0

    await page.locator('.parts-part-tab', { hasText: 'GROOVE' }).click()
    await expect(atkInput(page)).toHaveValue('21') // part 2: atk = 20 + 1
  })
})

test.describe('Parts Editor - View mode guards', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
  })

  test('edit controls are hidden in View mode', async ({ page }) => {
    await expect(page.locator('.parts-edit-controls.hidden')).toHaveCount(1)
    await expect(page.locator('.parts-edit-controls.visible')).toHaveCount(0)
  })

  test('param inputs are read-only in View mode', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    const input = atkInput(page)
    await expect(input).toHaveValue('20')
    await expect(input).not.toHaveClass(/editable/)
    await expect(input).toHaveAttribute('readonly', '')
  })
})

test.describe('Parts Editor - Editing and saving', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    await enterEditMode(page)
  })

  test('Save, Save All and Reload are disabled when nothing was modified', async ({ page }) => {
    await expect(page.locator('button', { hasText: 'Save All' })).toBeDisabled()
    await expect(page.locator('button.save-button', { hasText: /^Save$/ })).toBeDisabled()
    await expect(page.locator('button.cancel-button', { hasText: 'Reload' })).toBeDisabled()
  })

  test('editing a param auto-saves via save_parts and marks the part modified', async ({ page }) => {
    const input = atkInput(page)
    await input.fill('101')
    await input.blur()

    await expect(page.locator('.parts-part-tab', { hasText: 'PART 1' }).locator('.unsaved-indicator.visible')).toBeVisible()

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const lastCall = calls[calls.length - 1]
    expect(lastCall.args.path).toBe('/test/project')
    expect(lastCall.args.bankId).toBe('A')
    expect(lastCall.args.partsData).toHaveLength(1)
    expect(lastCall.args.partsData[0].part_id).toBe(0)
    expect(lastCall.args.partsData[0].amps[0].atk).toBe(101)

    await expect(page.locator('button.save-button', { hasText: /^Save$/ })).toBeEnabled()
    await expect(page.locator('button', { hasText: 'Save All' })).toBeEnabled()
  })

  test('Save commits the active part and clears the modified indicator', async ({ page }) => {
    const input = atkInput(page)
    await input.fill('101')
    await input.blur()
    await page.locator('button.save-button', { hasText: /^Save$/ }).click()

    const calls = await getInvokeCalls(page, 'commit_part')
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ path: '/test/project', bankId: 'A', partId: 0 })

    await expect(page.locator('.parts-part-tab', { hasText: 'PART 1' }).locator('.unsaved-indicator.visible')).toHaveCount(0)
    await expect(page.locator('button.save-button', { hasText: /^Save$/ })).toBeDisabled()
  })

  test('Save All commits all parts and clears all indicators', async ({ page }) => {
    const input = atkInput(page)
    await input.fill('101')
    await input.blur()
    await page.locator('button', { hasText: 'Save All' }).click()

    const calls = await getInvokeCalls(page, 'commit_all_parts')
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ path: '/test/project', bankId: 'A' })

    await expect(page.locator('.unsaved-indicator.visible')).toHaveCount(0)
    await expect(page.locator('button', { hasText: 'Save All' })).toBeDisabled()
  })

  test('Reload restores the saved values for the active part', async ({ page }) => {
    const input = atkInput(page)
    await input.fill('101')
    await input.blur()

    // Part 1 has valid saved state in the mock, so Reload is enabled once modified
    const reloadButton = page.locator('button.cancel-button', { hasText: 'Reload' })
    await expect(reloadButton).toBeEnabled()
    await reloadButton.click()

    const calls = await getInvokeCalls(page, 'reload_part')
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ path: '/test/project', bankId: 'A', partId: 0 })

    // reload_part mock returns atk = 99
    await expect(atkInput(page)).toHaveValue('99')
    await expect(page.locator('.unsaved-indicator.visible')).toHaveCount(0)
  })
})

test.describe('Parts Editor - Edited bitmask from bank file', () => {
  test('part edited on the device shows as modified; Reload blocked without saved state', async ({ page }) => {
    // Bit 1 set: GROOVE (part 2) was edited before the app opened; it has no saved state
    await setupTauriMocks(page, { partsEditedBitmask: 2, partsSavedState: [1, 0, 0, 0] })
    await openPartsTab(page)

    await expect(page.locator('.parts-part-tab', { hasText: 'GROOVE' }).locator('.unsaved-indicator.visible')).toBeVisible()

    await enterEditMode(page)
    await page.locator('.parts-part-tab', { hasText: 'GROOVE' }).click()

    await expect(page.locator('button.save-button', { hasText: /^Save$/ })).toBeEnabled()
    const reloadButton = page.locator('button.cancel-button', { hasText: 'Reload' })
    await expect(reloadButton).toBeDisabled()
    await expect(reloadButton).toHaveAttribute('title', 'No saved state yet: Save part first!')
  })
})

test.describe('Parts Editor - Shared LFO tab', () => {
  test('selected LFO tab persists across bank switching', async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'LFO' }).click()

    const lfo2Tab = page.locator('.parts-lfo-sidebar .parts-tab', { hasText: 'LFO 2' })
    await lfo2Tab.click()
    await expect(lfo2Tab).toHaveClass(/active/)

    // Switch to bank B; the LFO sub-tab selection is shared state in ProjectDetail
    await page.locator('#parts-bank-select').selectOption('1')
    await expect(page.locator('.bank-card-header h3', { hasText: 'BANK B' })).toBeVisible()
    await expect(page.locator('.parts-lfo-sidebar .parts-tab', { hasText: 'LFO 2' })).toHaveClass(/active/)
  })
})
