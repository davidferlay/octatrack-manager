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
  /** Effect assigned to the FX1 slot of every track, for checking an effect's layout. */
  fx1Type?: number
}

async function setupTauriMocks(page: Page, options?: MockOptions) {
  const opts = {
    partsEditedBitmask: options?.partsEditedBitmask ?? 0,
    partsSavedState: options?.partsSavedState ?? [1, 0, 0, 0],
    fx1Type: options?.fx1Type ?? 4,
  }
  await page.addInitScript((opts: { partsEditedBitmask: number; partsSavedState: number[]; fx1Type: number }) => {
    const makeMachine = (trackId: number) => ({
      track_id: trackId,
      machine_type: 'Flex',
      // Stored 0-based: track 1 plays Sample Slot 1
      static_slot_id: trackId,
      flex_slot_id: trackId,
      machine_params: { ptch: 64, strt: 0, len: 0, rate: 0, rtrg: 0, rtim: 0, in_ab: null, vol_ab: null, in_cd: null, vol_cd: null, dir: null, gain: null, op: null },
      machine_setup: { xloop: 0, slic: 0, len: 0, rate: 0, tstr: 0, tsns: 0 },
    })
    const makeVolume = (trackId: number, partId: number) => ({
      track_id: trackId,
      main: 100 + partId,
      cue: 40 + trackId,
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
    const makeRecorder = (trackId: number) => ({
      track_id: trackId,
      in_ab: 1, in_cd: 1, rlen: 64, trig: 0, src3: 0, xloop: 1,
      fin: 0, fout: 0, ab: 0, qrec: 255, qpl: 255, cd: 0,
    })
    const makeFx = (trackId: number) => ({
      track_id: trackId,
      fx1_type: opts.fx1Type, fx2_type: 8,
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
      volumes: tracks.map((t) => makeVolume(t, partId)),
      amps: tracks.map((t) => {
        const amp = makeAmp(t, partId)
        if (atkOverride !== undefined) amp.atk = atkOverride
        return amp
      }),
      lfos: tracks.map(makeLfo),
      fxs: tracks.map(makeFx),
      recorders: tracks.map(makeRecorder),
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
                // Slot ids are 1-based, as the file and the device number them.
                // Flex slots 1..3 hold a sample; everything else is empty.
                flex_slots: Array(128).fill(null).map((_, i) => ({ slot_id: i + 1, slot_type: 'Flex', path: i < 3 ? `../AUDIO/kick${i + 1}.wav` : null, gain: null, loop_mode: null, timestretch_mode: null, source_location: null, file_exists: i < 3, compatibility: null, file_format: null, bit_depth: null, sample_rate: null })),
                static_slots: Array(128).fill(null).map((_, i) => ({ slot_id: i + 1, slot_type: 'Static', path: i === 0 ? '../AUDIO/loop.wav' : null, gain: null, loop_mode: null, timestretch_mode: null, source_location: null, file_exists: i === 0, compatibility: null, file_format: null, bit_depth: null, sample_rate: null })),
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

  test('audio track shows All/SRC/AMP/LFO/FX1/FX2/REC page tabs', async ({ page }) => {
    const pageTabs = page.locator('.parts-page-tabs .parts-tab')
    await expect(pageTabs).toHaveText(['All', 'SRC', 'AMP', 'LFO', 'FX1', 'FX2', 'REC'])
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
    // The device labels it WDTH, and the filter fills all six knobs
    await expect(page.getByText('WDTH', { exact: true })).toBeVisible()
  })

  /**
   * Each label names the parameter at its own position, so an effect whose page leaves
   * a knob empty must leave a gap. Compacting the list silently points every later
   * knob at the wrong parameter - which is what these guard against.
   */
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

test.describe('Parts Editor - Sample slot per track and Part', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
  })

  test('shows the slot number in the header, beside the machine type', async ({ page }) => {
    const header = page.locator('.parts-track-header').first()
    // Stored 0-based, shown as the device numbers it: T1 plays Flex slot 1
    const field = header.locator('.parts-sample-field')
    // Labelled like the TRK/CUE controls beside it
    await expect(field.locator('.parts-level-label')).toHaveText('SLOT')
    await expect(field.locator('.param-value')).toHaveText('F001')
    // The filename is not in the header - it would truncate to nothing useful
    await expect(header).not.toContainText('kick1.wav')
    // It is in the tooltip, and in full in the picker
    await expect(field).toHaveAttribute('title', /F001 - kick1\.wav/)
    // The slot and the machine type sit together, on the right of the header
    const right = header.locator('.parts-track-header-right')
    await expect(right.locator('.parts-sample-field')).toHaveCount(1)
    await expect(right.locator('.machine-type')).toHaveCount(1)
  })

  test('the ALL page header reads badge and levels left, slot and machine right', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'ALL' }).click()
    const header = page.locator('.parts-track-header').first()

    // Inset on the ALL tab, where the header spans the full width of the card
    const pad = await header.evaluate(el => {
      const cs = getComputedStyle(el)
      return { left: cs.paddingLeft, right: cs.paddingRight }
    })
    expect(pad).toEqual({ left: '15px', right: '15px' })

    // Left: the track, then its levels
    const order = await header.evaluate(el => Array.from(el.children).map(c => c.className))
    expect(order[0]).toContain('track-badge')
    expect(order[1]).toContain('parts-track-levels')
    expect(order[2]).toContain('parts-track-header-right')

    // Right: the slot it plays, then the machine type
    const right = header.locator('.parts-track-header-right')
    await expect(right.locator('.parts-sample-field .param-value')).toHaveText('F001')
    await expect(right.locator('.machine-type')).toHaveText('Flex')
  })

  test('is read-only until Edit mode is on, and is styled exactly like a TRK/CUE control', async ({ page }) => {
    // The sample field wears .parts-level / .parts-level-label / .param-value, so it
    // matches the level controls beside it by construction. Compare the two live, in
    // the same instant, in both modes.
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'ALL' }).click()
    const compare = async () => await page.locator('.parts-track-header').first().evaluate(el => {
      const look = (n: Element | null) => {
        if (!n) return null
        const cs = getComputedStyle(n as HTMLElement)
        return {
          h: Math.round((n as HTMLElement).getBoundingClientRect().height * 100) / 100,
          border: cs.border, radius: cs.borderRadius, bg: cs.backgroundColor,
          shadow: cs.boxShadow, pad: cs.padding,
        }
      }
      return {
        level: {
          box: look(el.querySelector('.parts-track-levels .parts-level')),
          label: look(el.querySelector('.parts-track-levels .parts-level-label')),
          value: look(el.querySelector('.parts-track-levels .param-value')),
        },
        field: {
          box: look(el.querySelector('.parts-sample-field')),
          label: look(el.querySelector('.parts-sample-field .parts-level-label')),
          value: look(el.querySelector('.parts-sample-field .param-value')),
        },
      }
    })

    const field = page.locator('.parts-sample-field').first()
    await expect(field).toBeDisabled()
    const viewMode = await compare()
    expect(viewMode.field.box).toEqual(viewMode.level.box)
    expect(viewMode.field.label).toEqual(viewMode.level.label)
    expect(viewMode.field.value).toEqual(viewMode.level.value)

    await enterEditMode(page)
    await expect(field).toBeEnabled()
    await page.waitForTimeout(400) // let the .editable transition settle
    const editMode = await compare()
    expect(editMode.field.box).toEqual(editMode.level.box)
    expect(editMode.field.label).toEqual(editMode.level.label)
    expect(editMode.field.value).toEqual(editMode.level.value)
    // Edit mode really does change the value's look - on both alike
    expect(editMode.field.value).not.toEqual(viewMode.field.value)

    // The whole field is one button: no text caret over the value half
    const cursors = await field.evaluate(el => ({
      button: getComputedStyle(el).cursor,
      label: getComputedStyle(el.querySelector('.parts-level-label') as HTMLElement).cursor,
      value: getComputedStyle(el.querySelector('.param-value') as HTMLElement).cursor,
    }))
    expect(cursors).toEqual({ button: 'pointer', label: 'pointer', value: 'pointer' })
  })

  test('the picker lists the machine\'s own pool, with the assignment marked', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()

    const modal = page.locator('.slot-picker-modal')
    await expect(modal.locator('.modal-header h3')).toContainText('Flex Sample Slot')
    // Same header shape as the Tools list modals: icon, title, one muted info line
    await expect(modal.locator('.missing-samples-header-count'))
      .toHaveText('T1 - PART 1 - showing 3 of 3 slots')
    await expect(modal.locator('.modal-header h3 i.fa-list')).toHaveCount(1)
    await expect(modal.locator('tbody tr')).toHaveCount(3)
    await expect(modal.locator('tbody tr').first()).toContainText('F001')
    await expect(modal.locator('tbody tr').first()).toContainText('kick1.wav')
    // A Flex machine never offers the Static pool
    await expect(modal.locator('tbody tr', { hasText: 'loop.wav' })).toHaveCount(0)
    // The slot the track already plays is named, and the list opens on it
    await expect(modal.locator('.slot-picker-row.assigned')).toContainText('F001')
    await expect(modal.locator('.slot-picker-assigned-tag')).toHaveText('Assigned')
    // Reaches the row's right edge, and is not eaten by the long-filename fade that
    // every other sample cell in the app applies to its last tenth
    const edges = await modal.locator('.slot-picker-row.assigned .col-sample').evaluate(el => ({
      mask: getComputedStyle(el).maskImage,
      gap: Math.round(el.getBoundingClientRect().right
        - (el.querySelector('.slot-picker-assigned-tag') as HTMLElement).getBoundingClientRect().right),
    }))
    expect(edges.mask).toBe('none')
    expect(edges.gap).toBeLessThan(20)

    // Header is the Tools list-modal header, not a look-alike: .bank-card h3 leaks
    // into this modal and would otherwise underline and inflate the title
    const h3 = await modal.locator('.modal-header h3').evaluate(el => {
      const cs = getComputedStyle(el)
      return { pad: cs.padding, border: cs.borderBottomWidth, h: Math.round(el.getBoundingClientRect().height) }
    })
    expect(h3).toEqual({ pad: '0px', border: '0px', h: 21 })
    await expect(modal.locator('.slot-picker-row.cursor')).toContainText('F001')
    // The search box is not focused - the arrow keys belong to the list
    await expect(modal.locator('.header-search-input')).not.toBeFocused()
    // No per-row play button; playback is the transport bar, as on the Sample Slots pages
    await expect(modal.locator('.slot-picker-play')).toHaveCount(0)
    await expect(modal.locator('.sample-player-bar')).toBeVisible()
  })

  test('arrows move the selection and Enter assigns', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')

    await page.keyboard.press('ArrowDown')
    await expect(modal.locator('.slot-picker-row.cursor')).toContainText('F002')
    await page.keyboard.press('ArrowDown')
    await expect(modal.locator('.slot-picker-row.cursor')).toContainText('F003')
    // The selection stops at the end rather than wrapping
    await page.keyboard.press('ArrowDown')
    await expect(modal.locator('.slot-picker-row.cursor')).toContainText('F003')

    await page.keyboard.press('Enter')
    await expect(modal).toHaveCount(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].machines[0].flex_slot_id).toBe(2)
  })

  test('Ctrl+F focuses the search box, as on the Sample Slots pages', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')

    await page.keyboard.press('Control+f')
    await expect(modal.locator('.header-search-input')).toBeFocused()
  })

  test('scrolling past the end of the slot list does not scroll the page behind it', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    await expect(modal).toBeVisible()

    // Two guards: the list does not chain its own scroll, and the page behind is
    // locked - the wheel reaches it over the header, buttons and player bar too.
    const containment = await modal.evaluate(el => ({
      list: getComputedStyle(el.querySelector('.slot-picker-list') as HTMLElement).overscrollBehavior,
      body: getComputedStyle(document.body).overflow,
    }))
    expect(containment).toEqual({ list: 'contain', body: 'hidden' })

    // And behaviourally: wheel hard past the bottom of the list, page stays put
    const before = await page.evaluate(() => window.scrollY)
    const list = modal.locator('.slot-picker-list')
    await list.hover()
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before)

    // The lock is released on close - leaving it on would freeze the page
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
    await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  })

  test('the modal can be resized, like the Tools modals', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    await expect(modal.locator('.modal-resize-handle')).not.toHaveCount(0)
  })

  test('the slot list sorts, like the other tables', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    const firstSlot = () => modal.locator('tbody tr').first().locator('td').first()

    // Defaults to slot order
    await expect(firstSlot()).toHaveText('F001')
    await modal.locator('th', { hasText: 'Slot' }).click()
    await expect(firstSlot()).toHaveText('F003')

    // Sorting by Sample orders by filename, and reverses on a second click
    await modal.locator('th', { hasText: 'Sample' }).click()
    await expect(firstSlot()).toHaveText('F001')
    await modal.locator('th', { hasText: 'Sample' }).click()
    await expect(firstSlot()).toHaveText('F003')
  })

  test('the picker searches, and previews a sample like the Sample Slots pages', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')

    await modal.locator('.header-search-input').fill('kick3')
    await expect(modal.locator('tbody tr')).toHaveCount(1)
    await expect(modal.getByText('Showing 1 of 3 slots')).toBeVisible()
    await expect(modal.locator('.sample-player-bar')).toBeVisible()
  })

  test('picking another slot saves it against that Part and track', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    await modal.locator('tbody tr', { hasText: 'kick3.wav' }).click()
    await modal.getByRole('button', { name: 'Assign' }).click()

    await expect(modal).toHaveCount(0)
    await expect.poll(async () => (await getInvokeCalls(page, 'save_parts')).length).toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const saved = calls[calls.length - 1].args.partsData[0]
    expect(saved.part_id).toBe(0)
    expect(saved.machines[0].flex_slot_id).toBe(2)
    // The other pool is carried through untouched
    expect(saved.machines[0].static_slot_id).toBe(0)
    // And no other track moved
    expect(saved.machines[1].flex_slot_id).toBe(1)
    // The header field now names the slot that was picked
    await expect(page.locator('.parts-track-header').first().locator('.parts-sample-field .param-value')).toHaveText('F003')
  })

  test('assigning a slot recomputes the usage badges, and nothing else', async ({ page }) => {
    await enterEditMode(page)
    const before = await getInvokeCalls(page, 'compute_sample_usage')

    // A plain parameter edit must not trigger a usage rescan
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    const atk = page.locator('.param-item', { hasText: 'ATK' }).first().locator('input')
    await atk.fill('77')
    await atk.blur()
    await expect.poll(async () => (await getInvokeCalls(page, 'save_parts')).length).toBeGreaterThan(0)
    expect(await getInvokeCalls(page, 'compute_sample_usage')).toHaveLength(before.length)

    // Changing which slot a track plays does
    const metadataBefore = (await getInvokeCalls(page, 'load_project_metadata')).length
    const partsBefore = (await getInvokeCalls(page, 'load_parts_data')).length
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    await modal.locator('tbody tr', { hasText: 'kick3.wav' }).click()
    await modal.getByRole('button', { name: 'Assign' }).click()

    await expect
      .poll(async () => (await getInvokeCalls(page, 'compute_sample_usage')).length)
      .toBeGreaterThan(before.length)
    // Only the usage is recomputed - the project and its parts are not re-read
    expect(await getInvokeCalls(page, 'load_project_metadata')).toHaveLength(metadataBefore)
    expect(await getInvokeCalls(page, 'load_parts_data')).toHaveLength(partsBefore)
  })

  test('a slot row has a context menu with Play, reveal and copy path', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')

    await modal.locator('tbody tr', { hasText: 'kick2.wav' }).click({ button: 'right' })
    const menu = page.locator('.context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.locator('.context-menu-item')).toHaveCount(3)
    await expect(menu).toContainText('Play')
    await expect(menu).toContainText('Open in file explorer')
    await expect(menu).toContainText('Copy path to clipboard')

    // Right-clicking acts on the row under the pointer, so it selects it too
    await expect(modal.locator('.slot-picker-row.cursor')).toContainText('F002')

    // Reveal is given the resolved absolute path, not the slot's stored relative one
    await menu.getByText('Open in file explorer').click()
    await expect(menu).toHaveCount(0)
    const calls = await getInvokeCalls(page, 'reveal_in_file_manager')
    expect(calls[calls.length - 1].args.path).toBe('/test/project/../AUDIO/kick2.wav')
  })

  test('only the assigned row offers Un-assign, and it points the track at an empty slot', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    const menu = page.locator('.context-menu')

    // Track 1 plays slot 1, so kick1.wav is the assigned row
    await modal.locator('tbody tr', { hasText: 'kick1.wav' }).click({ button: 'right' })
    await expect(menu.locator('.context-menu-item')).toHaveCount(4)
    // Under Play, fenced off from the two file entries below it
    await expect(menu.locator('.context-menu-item').nth(1)).toHaveText('Un-assign')
    await expect(menu.locator('.context-menu-separator')).toHaveCount(2)
    // Slots 1-3 hold samples, so slot 4 is the first free one
    await expect(menu.getByText('Un-assign')).toHaveAttribute('title', /F004/)

    await menu.getByText('Un-assign').click()
    await expect(modal).toHaveCount(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].machines[0].flex_slot_id).toBe(3)
  })

  test('the context menu closes on Escape, leaving the picker open', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    await modal.locator('tbody tr').first().click({ button: 'right' })
    await expect(page.locator('.context-menu')).toBeVisible()

    // The menu is the topmost layer, so it takes the first Escape
    await page.keyboard.press('Escape')
    await expect(page.locator('.context-menu')).toHaveCount(0)
    await expect(modal).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('Escape closes the picker without assigning anything', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    await expect(page.locator('.slot-picker-modal')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.slot-picker-modal')).toHaveCount(0)
    expect(await getInvokeCalls(page, 'save_parts')).toHaveLength(0)
  })
})

test.describe('Parts Editor - Track and Cue volume', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
  })

  test('the track header carries the levels, separate from AMP VOL', async ({ page }) => {
    const levels = page.locator('.parts-track-levels').first()
    await expect(levels.locator('.parts-level', { hasText: 'TRK' }).locator('input')).toHaveValue('100')
    await expect(levels.locator('.parts-level', { hasText: 'CUE' }).locator('input')).toHaveValue('40')
    // AMP's own VOL is a different control in the parameter grid
    const main = page.locator('.parts-params-section', { hasText: 'MAIN' }).first()
    await expect(main.locator('.param-item', { hasText: 'VOL' }).locator('input')).toHaveValue('100')
  })

  test('the levels show on the ALL page as well as AMP', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'ALL' }).click()
    const levels = page.locator('.parts-track-levels').first()
    await expect(levels.locator('.parts-level', { hasText: 'TRK' }).locator('input')).toHaveValue('100')
    await expect(levels.locator('.parts-level', { hasText: 'CUE' }).locator('input')).toHaveValue('40')
    // And no MIXER block was added to the parameter grids
    await expect(page.locator('.parts-mixer-params')).toHaveCount(0)
  })

  test('editing the Track level saves it against that Part and track', async ({ page }) => {
    await enterEditMode(page)
    const track = page.locator('.parts-track-levels').first().locator('.parts-level', { hasText: 'TRK' }).locator('input')
    await track.fill('64')
    await track.blur()

    await expect.poll(async () => (await getInvokeCalls(page, 'save_parts')).length).toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const saved = calls[calls.length - 1].args.partsData[0]
    expect(saved.volumes[0].main).toBe(64)
    expect(saved.volumes[0].cue).toBe(40)
  })
})

test.describe('Parts Editor - Field ranges and widgets', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
    await enterEditMode(page)
  })

  /**
   * The parameter labelled `label` on the current page. Matched on the label element
   * rather than any descendant text: a selector's own options carry names too, and
   * RATE lists "TSTR" among its choices.
   */
  const paramItem = (page: Page, label: string) =>
    page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: new RegExp(`^${label}$`) }) })
      .first()

  const paramInput = (page: Page, label: string) =>
    paramItem(page, label).locator('input.param-value')

  const paramSelect = (page: Page, label: string) =>
    paramItem(page, label).locator('select.param-select')

  test('the AMP page offers the five parameters the device has, and no sixth', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    for (const label of ['ATK', 'HOLD', 'REL', 'VOL', 'BAL']) {
      await expect(page.locator('.param-label', { hasText: new RegExp(`^${label}$`) }).first())
        .toBeVisible()
    }
    // The sixth byte is not a control on the hardware, so it is not drawn
    await expect(page.locator('.param-label', { hasText: /^F$/ })).toHaveCount(0)
  })

  test('PTCH is typed in semitones and will not exceed an octave', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    const ptch = paramInput(page, 'PTCH')
    // The fixture's default of 64 is the centre, so it reads as no change
    await expect(ptch).toHaveValue('0.0')

    await ptch.fill('999')
    await ptch.blur()
    await expect(ptch).toHaveValue('12.0')
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].machines[0].machine_params.ptch).toBe(124)
  })

  test('PTCH will not go below an octave down either', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    const ptch = paramInput(page, 'PTCH')
    await ptch.fill('-999')
    await ptch.blur()
    await expect(ptch).toHaveValue('-12.0')
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].machines[0].machine_params.ptch).toBe(4)
  })

  test('a plain parameter still clamps to its own range', async ({ page }) => {
    const atk = paramInput(page, 'ATK')
    await atk.fill('500')
    await atk.blur()
    await expect(atk).toHaveValue('127')
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].amps[0].atk).toBe(127)
  })

  test('a setting with fixed values is a selector, not a free number', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    const amp = paramSelect(page, 'AMP')
    await expect(amp).toBeVisible()
    // The four envelope behaviours the device offers, by name
    await expect(amp.locator('option')).toHaveCount(4)
    await expect(amp.locator('option')).toHaveText(['ANLG', 'RTRG', 'R+T', 'TTRG'])
  })

  test('choosing from a selector saves the value behind the name', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    await paramSelect(page, 'AMP').selectOption('3')
    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].amps[0].amp_setup_amp).toBe(3)
  })

  test('a two-state setting reads as its two names', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    const slic = paramSelect(page, 'SLIC')
    await expect(slic.locator('option')).toHaveText(['OFF', 'ON'])
  })

  test('the settings a sample machine has read by the names the device uses', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    await expect(paramSelect(page, 'LOOP').locator('option'))
      .toHaveText(['OFF', 'AUTO', 'ON', 'PIPO'])
    await expect(paramSelect(page, 'TSTR').locator('option'))
      .toHaveText(['OFF', 'AUTO', 'NORM', 'BEAT'])
  })

  test('typing a semitone value stores the byte the device stores', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    const ptch = paramInput(page, 'PTCH')
    await ptch.fill('-12')
    await ptch.blur()
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].machines[0].machine_params.ptch).toBe(4)
  })

  test('the LFO target list keeps the device order while storing its own values', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'LFO' }).click()
    const pmtr = paramSelect(page, 'PMTR')
    // The AMP targets are listed before the LFO ones
    await expect(pmtr.locator('option').nth(6)).toHaveText('Amp Attack')
    await expect(pmtr.locator('option').nth(12)).toHaveText('LFO 1 Speed')

    // Picking "LFO 1 Speed" must store 6, not its position in the list
    await pmtr.selectOption({ label: 'LFO 1 Speed' })
    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].lfos[0].lfo1_pmtr).toBe(6)
  })

  test('the LFO target list offers exactly the targets the device has', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'LFO' }).click()
    // LFO 1 is the page's own default tab
    const pmtr = paramSelect(page, 'PMTR')
    await expect(pmtr.locator('option')).toHaveCount(30)
  })

  test('nothing in the editor can produce a value outside the range', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    await paramInput(page, 'STRT').fill('9999')
    await paramInput(page, 'STRT').blur()
    const calls = await getInvokeCalls(page, 'save_parts')
    const machine = calls[calls.length - 1].args.partsData[0].machines[0]
    for (const [field, value] of Object.entries(machine.machine_params)) {
      if (typeof value === 'number') {
        expect(value, field).toBeGreaterThanOrEqual(0)
        expect(value, field).toBeLessThanOrEqual(127)
      }
    }
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

/**
 * An effect's labels name parameters by position: the label at index n belongs to
 * parameter n+1. An effect whose page leaves a knob empty therefore needs an empty
 * entry in that position - compacting the list points every later knob at the wrong
 * parameter, which is silent and writes the wrong byte.
 *
 * These mock the effect directly rather than through the shared setup, so each gets
 * exactly one set of mocks.
 */
test.describe('Parts Editor - Recorder setup', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'REC' }).click()
  })

  test('shows the two setup pages the device has, in its order', async ({ page }) => {
    await expect(page.locator('.params-column-label', { hasText: 'SETUP 1' })).toBeVisible()
    await expect(page.locator('.params-column-label', { hasText: 'SETUP 2' })).toBeVisible()
    expect(await page.locator('.param-label').allTextContents()).toEqual([
      'INAB', 'INCD', 'RLEN', 'TRIG', 'SRC3', 'LOOP',
      'FIN', 'FOUT', 'AB', 'QREC', 'QPL', 'CD',
    ])
  })

  test('names the settings the device names', async ({ page }) => {
    const options = async (label: string) =>
      page.locator('.param-item')
        .filter({ has: page.locator('.param-label', { hasText: new RegExp(`^${label}$`) }) })
        .first().locator('select.param-select option').allTextContents()

    expect(await options('INAB')).toEqual(['-', 'A B', 'A', 'B', 'A+B'])
    expect(await options('TRIG')).toEqual(['ONE', 'ONE2', 'HOLD'])
    expect(await options('SRC3'))
      .toEqual(['-', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'MAIN', 'CUE'])
    expect(await options('LOOP')).toEqual(['OFF', 'ON'])
    // Quantisation keeps OFF outside its ordinary range
    expect((await options('QREC')).slice(0, 3)).toEqual(['OFF', 'PLEN', '1'])
  })

  test('editing a recorder setting saves it against that Part and track', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^SRC3$/ }) })
      .first().locator('select.param-select').selectOption('9') // MAIN

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].recorders[0].src3).toBe(9)
  })
})

test.describe('Parts Editor - Effect page layout', () => {
  async function openFx1(page: Page, fx1Type: number) {
    await setupTauriMocks(page, { fx1Type })
    await openPartsTab(page)
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'FX1' }).click()
  }

  test('an effect with a gap in its page keeps its later knobs on the right parameter', async ({ page }) => {
    // DJ EQ reads LS F, a gap, then HS F, LOWG, MIDG, HI G, and has no setup page
    await openFx1(page, 13)
    await expect(page.locator('.params-column-label', { hasText: 'MAIN - DJ EQ' })).toBeVisible()
    expect(await page.locator('.param-label').allTextContents())
      .toEqual(['LS F', 'HS F', 'LOWG', 'MIDG', 'HI G'])
  })

  test('a reverb keeps MIXF on the last setup slot, where the device puts it', async ({ page }) => {
    await openFx1(page, 20) // Gatebox plate reverb
    expect(await page.locator('.param-label').allTextContents())
      .toEqual(['TIME', 'DAMP', 'GATE', 'HP', 'LP', 'MIX', 'GVOL', 'BAL', 'MONO', 'MIXF'])

    await enterEditMode(page)
    const mixf = page.locator('.param-item').filter({ hasText: 'MIXF' }).locator('input.param-value')
    await mixf.fill('1')
    await mixf.blur()
    const calls = await getInvokeCalls(page, 'save_parts')
    const fx = calls[calls.length - 1].args.partsData[0].fxs[0]
    expect(fx.fx1_setup6).toBe(1)
    expect(fx.fx1_setup4).toBe(0)
  })

  test('the comb filter puts MIX last, past its empty slot', async ({ page }) => {
    await openFx1(page, 19)
    expect(await page.locator('.param-label').allTextContents())
      .toEqual(['PTCH', 'TUNE', 'LP', 'FB', 'MIX'])
  })

  test('the spring reverb leaves its first row to TIME alone', async ({ page }) => {
    await openFx1(page, 21)
    expect(await page.locator('.param-label').allTextContents())
      .toEqual(['TIME', 'HP', 'LP', 'MIX', 'TYPE', 'BAL'])
  })
})
