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
  /** How many Flex slots hold a sample. The default of 3 leaves the picker too short
   *  to scroll, which is no use for anything about where the list opens. */
  loadedFlexSlots?: number
  /** The Flex slot T1 plays, zero-based. Default is its track number. */
  t1FlexSlot?: number
  /** Whether each crossfader end is muted on the device. Neither, by default. */
  sceneMutes?: [boolean, boolean]
  /**
   * What the project page's background read-ahead of the scenes finds. Off by
   * default, as a bank the read-ahead has not reached yet behaves: the Scenes tab
   * reads the bank itself. `'fail'` is a bank the read-ahead could not read.
   */
  preloadScenes?: boolean | 'fail'
}

async function setupTauriMocks(page: Page, options?: MockOptions) {
  const opts = {
    partsEditedBitmask: options?.partsEditedBitmask ?? 0,
    partsSavedState: options?.partsSavedState ?? [1, 0, 0, 0],
    fx1Type: options?.fx1Type ?? 4,
    loadedFlexSlots: options?.loadedFlexSlots ?? 3,
    t1FlexSlot: options?.t1FlexSlot ?? null,
    sceneMutes: options?.sceneMutes ?? ([false, false] as [boolean, boolean]),
    preloadScenes: options?.preloadScenes ?? false,
  }
  await page.addInitScript((opts: { partsEditedBitmask: number; partsSavedState: number[]; fx1Type: number; loadedFlexSlots: number; t1FlexSlot: number | null; sceneMutes: [boolean, boolean]; preloadScenes: boolean | 'fail' }) => {
    const makeMachine = (trackId: number) => ({
      track_id: trackId,
      machine_type: 'Flex',
      // Stored 0-based: track 1 plays Sample Slot 1
      static_slot_id: trackId,
      flex_slot_id: trackId === 0 && opts.t1FlexSlot !== null ? opts.t1FlexSlot : trackId,
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

    /** One Part's sixteen scenes. Three hold something; the rest are empty,
     *  as a real Part mostly is. */
    const makeScenes = () => {
          // Three scenes hold something; the rest are empty, as a real Part mostly is
          const held: Record<number, Record<string, unknown>> = {
            0: { amp: [null, null, null, 100, null, null], xlv: 64 },
            2: { machine: [70, null, null, null, null, null], fx1: [null, 30, null, null, null, null] },
            5: { lfo: [null, null, null, 12, null, null], amp: [null, null, null, null, null, 9] },
          }
          const six = () => [null, null, null, null, null, null]
          return {
            scenes: Array.from({ length: 16 }, (_, sceneId) => {
              const tracks = Array.from({ length: 8 }, (_, trackId) => ({
                track_id: trackId,
                machine: six(), lfo: six(), amp: six(), fx1: six(), fx2: six(), xlv: null,
                // Only track 1 carries anything, which keeps the fixture readable
                ...(trackId === 0 ? (held[sceneId] ?? {}) : {}),
              }))
              const locked_count = tracks.reduce((n, t) => n
                + [t.machine, t.lfo, t.amp, t.fx1, t.fx2]
                  .reduce((m, page) => m + (page as (number | null)[]).filter(v => v !== null).length, 0)
                + (t.xlv === null ? 0 : 1), 0)
              return { scene_id: sceneId, tracks, locked_count }
            }),
            scene_a: 0,
            scene_b: 8,
            machine_types: Array(8).fill('Flex'),
            fx1_types: Array(8).fill(opts.fx1Type),
            fx2_types: Array(8).fill(8),
            parts_edited_bitmask: opts.partsEditedBitmask,
            parts_saved_state: opts.partsSavedState,
            scene_a_muted: opts.sceneMutes[0],
            scene_b_muted: opts.sceneMutes[1],
          }
    }

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
                flex_slots: Array(128).fill(null).map((_, i) => ({ slot_id: i + 1, slot_type: 'Flex', path: i < opts.loadedFlexSlots ? `../AUDIO/kick${i + 1}.wav` : null, gain: null, loop_mode: null, timestretch_mode: null, source_location: null, file_exists: i < opts.loadedFlexSlots, compatibility: null, file_format: null, bit_depth: null, sample_rate: null })),
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

          case 'load_scenes':
            return makeScenes()

          // One read of the bank covering all four of its Parts, which is what the
          // project page reads ahead with
          case 'load_bank_scenes':
            if (opts.preloadScenes === 'fail') throw new Error('bank will not read')
            if (!opts.preloadScenes) return null
            return [0, 1, 2, 3].map(() => makeScenes())

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

  /**
   * The ALL page packs the panes the device's own pages leave half empty: an LFO has
   * six settings and no setup page, so two LFOs share a pane rather than each taking
   * one. REC rides along in the space that frees up.
   */
  test('the ALL page pairs the LFO panes and carries REC', async ({ page }) => {
    const titles = await page.locator('.parts-track-wide .params-label').allTextContents()
    expect(titles).toEqual([
      'SRC', 'AMP', 'LFO 1 / LFO 2', 'LFO 3 / DESIGN',
      'FX1 - FILTER', 'FX2 - DELAY', 'REC',
    ])
  })

  test('the paired panes name each LFO inside', async ({ page }) => {
    const lfo = page.locator('.parts-all-section')
      .filter({ has: page.locator('.params-label', { hasText: 'LFO 1 / LFO 2' }) })
    await expect(lfo.locator('.params-column-label')).toHaveText(['LFO 1', 'LFO 2'])
    const design = page.locator('.parts-all-section')
      .filter({ has: page.locator('.params-label', { hasText: 'LFO 3 / DESIGN' }) })
    await expect(design.locator('.params-column-label')).toHaveText(['LFO 3', 'DESIGN'])
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

  test('MIDI track shows All/NOTE/ARP/LFO/CTRL 1/CTRL 2 page tabs', async ({ page }) => {
    await selectTrack(page, '8') // M1
    const pageTabs = page.locator('.parts-page-tabs .parts-tab')
    await expect(pageTabs).toHaveText(['All', 'NOTE', 'ARP', 'LFO', 'CTRL 1', 'CTRL 2'])
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

    // Short enough that the page is certainly taller than the window, so "it scrolls"
    // means something. Left to the default size this rests on the page happening to
    // overflow, which a few pixels of padding anywhere above can take away.
    await page.setViewportSize({ width: 1280, height: 400 })
    await expect
      .poll(() => page.evaluate(() => document.body.scrollHeight > window.innerHeight))
      .toBe(true)
    // Scrolled outright rather than with the wheel: a frozen page refuses this just the
    // same, and it does not depend on what happens to sit under the pointer, which is
    // what the lock is being checked against.
    await page.evaluate(() => window.scrollTo(0, 300))
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

  /**
   * Opening the picker and settling on the slot the track already plays is not an edit.
   * Writing anyway marked the Part modified for a look, which then had to be saved or
   * reloaded to clear.
   */
  test('picking the slot it already plays writes nothing', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    const modal = page.locator('.slot-picker-modal')
    // T1 opens on the slot it plays, so Assign straight away re-picks the same one
    await modal.getByRole('button', { name: 'Assign' }).click()
    await expect(modal).toHaveCount(0)

    await page.waitForTimeout(900) // past the save debounce
    expect(await getInvokeCalls(page, 'save_parts')).toHaveLength(0)
    await expect(page.locator('.parts-part-tab').first()).not.toHaveClass(/modified/)
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
    // AMP's own VOL is a different control in the parameter grid, and reads either
    // side of its centre as the device shows it - the fixture's 100 is 36 above it
    const main = page.locator('.parts-params-section', { hasText: 'MAIN' }).first()
    await expect(main.locator('.param-item', { hasText: 'VOL' }).locator('input')).toHaveValue('36')
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

  /**
   * Both levels are plain 0-127 - measured from the device's own min and max preset
   * projects - so they are held to the same contract as every parameter on the pages
   * below rather than taking whatever is typed.
   */
  const level = (page: Page, which: 'TRK' | 'CUE') =>
    page.locator('.parts-track-levels').first()
      .locator('.parts-level', { hasText: which })

  for (const which of ['TRK', 'CUE'] as const) {
    test(`the ${which} level will not go past the device range`, async ({ page }) => {
      await enterEditMode(page)
      const input = level(page, which).locator('input')

      await input.fill('999')
      await expect(input).toHaveValue('127')
      await input.fill('-5')
      await expect(input).toHaveValue('0')
    })

    test(`the ${which} level ignores something that is not a number`, async ({ page }) => {
      await enterEditMode(page)
      const input = level(page, which).locator('input')
      const before = await input.inputValue()
      await input.fill('abc')
      await expect(input).toHaveValue(before)
    })

    test(`the ${which} level steps with the wheel, like any other field`, async ({ page }) => {
      await enterEditMode(page)
      const input = level(page, which).locator('input')
      const before = Number(await input.inputValue())

      await input.hover()
      await page.mouse.wheel(0, -120)
      await expect(input).toHaveValue(String(before + 1))
      await page.mouse.wheel(0, 120)
      await page.mouse.wheel(0, 120)
      await expect(input).toHaveValue(String(before - 1))
    })

    test(`the ${which} level wheel stops at the ends of the range`, async ({ page }) => {
      await enterEditMode(page)
      const input = level(page, which).locator('input')
      await input.fill('127')
      await input.hover()
      await page.mouse.wheel(0, -120)
      await expect(input).toHaveValue('127')
      await input.fill('0')
      await page.mouse.wheel(0, 120)
      await expect(input).toHaveValue('0')
    })

    test(`the ${which} level does not step outside Edit mode`, async ({ page }) => {
      const input = level(page, which).locator('input')
      const before = await input.inputValue()
      await input.hover()
      await page.mouse.wheel(0, -120)
      await expect(input).toHaveValue(before)
    })
  }

  test('a level clamped by typing is the value that reaches the file', async ({ page }) => {
    await enterEditMode(page)
    const input = level(page, 'CUE').locator('input')
    await input.fill('200')
    await input.blur()

    await expect.poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].volumes[0].cue).toBe(127)
  })
})

/** The strip of pages is one control, like the scene grid, so the wheel runs it. */
test.describe('Parts Editor - Stepping the page tabs with the wheel', () => {
  const active = (page: Page) => page.locator('.parts-page-tabs .parts-tab.active')

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
  })

  test('moves to the next page and back', async ({ page }) => {
    await selectTrack(page, '0')
    await expect(active(page)).toHaveText('All')

    await page.locator('.parts-page-tabs').hover()
    await page.mouse.wheel(0, -120)
    await expect(active(page)).toHaveText('SRC')
    await page.mouse.wheel(0, -120)
    await expect(active(page)).toHaveText('AMP')
    await page.mouse.wheel(0, 120)
    await expect(active(page)).toHaveText('SRC')
  })

  test('stops at either end rather than wrapping', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs').hover()
    // ALL is the first, so there is nothing before it
    await page.mouse.wheel(0, 120)
    await expect(active(page)).toHaveText('All')

    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120)
    await expect(active(page)).toHaveText('REC')
  })

  /** A MIDI track has one page fewer, and REC is not one of them. */
  test('stops at the last page a MIDI track has', async ({ page }) => {
    await selectTrack(page, '8')
    await page.locator('.parts-page-tabs').hover()
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120)
    await expect(active(page)).toHaveText('CTRL 2')
  })

  test('works anywhere over the strip, not only over a tab', async ({ page }) => {
    await selectTrack(page, '0')
    const box = (await page.locator('.parts-page-tabs').boundingBox())!
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.mouse.wheel(0, -120)
    await expect(active(page)).toHaveText('SRC')
  })

  test('steps without Edit mode, because it only changes what is shown', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs').hover()
    await page.mouse.wheel(0, -120)
    await expect(active(page)).toHaveText('SRC')
    expect(await getInvokeCalls(page, 'save_parts')).toHaveLength(0)
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

  /**
   * The device flips a two-setting parameter rather than offering a list of the one
   * other value, so the app does too - and SETUP LEN shows why this follows the number
   * of settings and not the kind of field: SLIC turns it into a longer list.
   */
  test('a two-state setting switches on click, naming both settings', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    const slic = paramItem(page, 'SLIC').locator('button.param-toggle')
    await expect(slic).toHaveText('OFF')
    await expect(paramItem(page, 'SLIC').locator('select.param-select')).toHaveCount(0)
    await slic.click()
    await expect(slic).toHaveText('ON')
    await slic.click()
    await expect(slic).toHaveText('OFF')
  })

  test('switching a two-state setting saves the value behind the name', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    await paramItem(page, 'SLIC').locator('button.param-toggle').click()
    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    expect(calls[calls.length - 1].args.partsData[0].machines[0].machine_setup.slic).toBe(1)
  })

  test('a two-state setting is inert in View mode', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    await page.locator('.mode-toggle').click()
    const slic = paramItem(page, 'SLIC').locator('button.param-toggle')
    await expect(slic).toBeDisabled()
    await expect(slic).toHaveText('OFF')
  })

  test('a list of more than two keeps its drop-down', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    await expect(paramSelect(page, 'LOOP').locator('option')).toHaveCount(4)
    await expect(paramItem(page, 'LOOP').locator('button.param-toggle')).toHaveCount(0)
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

  test('a setting with a list shows where in that list it sits', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    const amp = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^AMP$/ }) }).first()
    await expect(amp.locator('.param-position-bar')).toBeVisible()

    const markerLeft = async () => amp.locator('.param-position-marker')
      .evaluate(el => parseFloat((el as HTMLElement).style.left))
    const atFirst = await markerLeft()
    await amp.locator('select.param-select').selectOption('3')
    expect(await markerLeft()).toBeGreaterThan(atFirst)
  })

  /**
   * The device stacks every parameter the same way - name, indicator, value - so the
   * values line up across a page whatever the control above them is. Reserving the
   * knob's height for a list's indicator is what holds that line; without it a list
   * sits higher than the knob beside it and the row staggers.
   */
  test('a list and a knob put their values on the same line', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'SRC' }).click()
    // TSTR is a list and TSNS a knob, and the device puts them side by side. RATE
    // completes that row but is not used here: SRC MAIN has a RATE as well.
    const tops = await Promise.all(['TSTR', 'TSNS'].map(async label => {
      const box = await paramItem(page, label).locator('.param-value').boundingBox()
      return Math.round(box!.y)
    }))
    expect(new Set(tops).size, `tops were ${tops.join(', ')}`).toBe(1)
  })

  test('a value is wide enough to be read in full', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    // ANLG is the widest label on this page and used to be cut down to ANL
    const amp = paramSelect(page, 'AMP')
    await expect(amp).toHaveValue('0')
    const clipped = await amp.evaluate(el => el.scrollWidth > el.clientWidth)
    expect(clipped).toBe(false)
  })

  test('edit mode marks a list the same way it marks a number', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'AMP' }).click()
    await expect(paramSelect(page, 'AMP')).toHaveClass(/editable/)
    await expect(paramInput(page, 'ATK')).toHaveClass(/editable/)
    await page.locator('.mode-toggle').click()
    await expect(paramSelect(page, 'AMP')).not.toHaveClass(/editable/)
    await expect(paramInput(page, 'ATK')).not.toHaveClass(/editable/)
  })

  test('the LFO waveform is drawn, not only named', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'LFO' }).click()
    const wave = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^WAVE$/ }) }).first()
    await expect(wave.locator('svg.param-wave-glyph')).toBeVisible()
    // A designer slot holds whatever was drawn on its DESIGN page, so it gets a
    // stand-in rather than an empty space - marked as a stand-in, not passed off
    // as one of the fixed shapes
    await wave.locator('select.param-select').selectOption('11') // T1
    await expect(wave.locator('svg.param-wave-glyph')).toBeVisible()
    await expect(wave.locator('svg.param-wave-glyph')).toHaveClass(/designed/)
    await wave.locator('select.param-select').selectOption('0') // TRI
    await expect(wave.locator('svg.param-wave-glyph')).not.toHaveClass(/designed/)
  })

  test('the LFO target list keeps the device order while storing its own values', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: 'LFO' }).click()
    const pmtr = paramSelect(page, 'PMTR')
    // The AMP targets are listed before the LFO ones
    await expect(pmtr.locator('option').nth(6)).toHaveText('AMP ATK')
    await expect(pmtr.locator('option').nth(12)).toHaveText('LFO1 SPD')

    // Picking the LFO 1 speed target must store 6, not its position in the list
    await pmtr.selectOption({ label: 'LFO1 SPD' })
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
    // LOOP has two settings, so it is a switch: it names one at a time, both in turn
    const loop = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^LOOP$/ }) })
      .first().locator('button.param-toggle')
    const first = await loop.textContent()
    await enterEditMode(page)
    await loop.click()
    expect([first, await loop.textContent()].sort()).toEqual(['OFF', 'ON'])
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

/**
 * Hovering a parameter has to say what it does. The wording lives in the app; what is
 * worth guarding here is that every parameter the editor draws actually carries it -
 * a field added to a page without a line of help hovers blank, and nothing else notices.
 */
test.describe('Parts Editor - Parameter help', () => {
  const blankTips = (page: Page) =>
    page.locator('.param-item').evaluateAll(els =>
      els
        .filter(e => !(e.getAttribute('title') ?? '').trim())
        .map(e => e.querySelector('.param-label')?.textContent ?? '?'))

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
  })

  test('every audio parameter says what it does', async ({ page }) => {
    await selectTrack(page, '0')
    for (const tab of ['SRC', 'AMP', 'LFO', 'FX1', 'FX2', 'REC', 'All']) {
      await page.locator('.parts-page-tabs .parts-tab', { hasText: new RegExp(`^${tab}$`) }).click()
      await expect.poll(() => blankTips(page), { message: `${tab} page` }).toEqual([])
    }
  })

  test('every MIDI parameter says what it does', async ({ page }) => {
    await selectTrack(page, '8')
    for (const tab of ['NOTE', 'ARP', 'LFO', 'CTRL 1', 'CTRL 2', 'All']) {
      await page.locator('.parts-page-tabs .parts-tab', { hasText: new RegExp(`^${tab}$`) }).click()
      await expect.poll(() => blankTips(page), { message: `${tab} page` }).toEqual([])
    }
  })

  test('a setting with named values explains each of them', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^SRC$/ }).click()
    const tip = await page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^LOOP$/ }) })
      .first().getAttribute('title')
    const lines = tip!.split('\n')
    expect(lines[0]).toMatch(/^LOOP - /)
    expect(lines.slice(1).map(l => l.split(':')[0])).toEqual(['OFF', 'AUTO', 'ON', 'PIPO'])
  })

  test('an effect knob is explained by the effect that is loaded', async ({ page }) => {
    await selectTrack(page, '0')
    // The mocks load a filter in FX1 and a delay in FX2; both label a knob BASE
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
    const filter = await page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^BASE$/ }) })
      .first().getAttribute('title')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    const delay = await page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^BASE$/ }) })
      .first().getAttribute('title')
    expect(filter).toContain('cutoff')
    expect(delay).toContain('feedback')
    expect(filter).not.toBe(delay)
  })
})

test.describe('Parts Editor - Tab and header help', () => {
  const blank = (page: Page, sel: string) =>
    page.locator(sel).evaluateAll(els =>
      els
        .filter(e => !(e.getAttribute('title') ?? '').trim())
        .map(e => e.textContent?.trim() ?? '?'))

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
  })

  test('every Part tab says what a Part is', async ({ page }) => {
    await expect.poll(() => blank(page, '.parts-part-tab')).toEqual([])
    const tip = await page.locator('.parts-part-tab').first().getAttribute('title')
    // Named first, so the tooltip says which Part before it says what a Part is
    expect(tip!.split('\n')[0]).toMatch(/^PART 1 \(1\) - /)
    expect(tip).toContain('Switching Part also switches the samples')
  })

  test('a modified Part says so as well', async ({ page }) => {
    await enterEditMode(page)
    await atkInput(page).fill('42')
    await atkInput(page).blur()
    const tip = await page.locator('.parts-part-tab').first().getAttribute('title')
    expect(tip).toContain('Modified')
    expect(tip).toContain('Reload discards them')
  })

  test('every audio page tab says what the page is for', async ({ page }) => {
    await selectTrack(page, '0')
    await expect.poll(() => blank(page, '.parts-page-tabs .parts-tab')).toEqual([])
  })

  test('every MIDI page tab says what the page is for', async ({ page }) => {
    await selectTrack(page, '8')
    await expect.poll(() => blank(page, '.parts-page-tabs .parts-tab')).toEqual([])
  })

  test('every LFO sub-tab says which LFO it is', async ({ page }) => {
    await selectTrack(page, '0')
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^LFO$/ }).click()
    await expect.poll(() => blank(page, '.parts-lfo-sidebar .parts-tab')).toEqual([])
    // Which LFOs can modulate which is the thing worth saying here
    const lfo1 = page.locator('.parts-lfo-sidebar .parts-tab', { hasText: 'LFO 1' })
    await expect(lfo1).toHaveAttribute('title', /modulated by LFO 2 and LFO 3/)
  })

  test('every track header field explains itself', async ({ page }) => {
    await selectTrack(page, '0')
    await expect
      .poll(() => blank(page, '.parts-track-header .track-badge, .parts-level, .machine-type'))
      .toEqual([])
  })

  test('the machine badge explains that machine', async ({ page }) => {
    await selectTrack(page, '0')
    // The mocks run Flex on every track
    await expect(page.locator('.machine-type').first())
      .toHaveAttribute('title', /Flex machine: plays its sample from RAM/)
  })

  test('the levels are told apart', async ({ page }) => {
    await selectTrack(page, '0')
    const tip = async (label: string) => page.locator('.parts-level')
      .filter({ has: page.locator('.parts-level-label', { hasText: new RegExp(`^${label}$`) }) })
      .first().getAttribute('title')
    expect(await tip('TRK')).toContain('after the effects')
    expect(await tip('CUE')).toContain('cue outputs')
  })

  test('the slot field says which pool it picks from', async ({ page }) => {
    await selectTrack(page, '0')
    const tip = await page.locator('.parts-sample-field').first().getAttribute('title')
    expect(tip).toContain('Flex Sample Slot')
    expect(tip).toContain('Turn on Edit mode to change it')
    await enterEditMode(page)
    expect(await page.locator('.parts-sample-field').first().getAttribute('title'))
      .toContain('Click to pick another slot')
  })
})

/**
 * Changing a track's machine from the editor. The machine decides what the SRC page
 * even shows, so the picker lives in the track header where every page carries it.
 */
test.describe('Parts Editor - Machine type', () => {
  const machinePicker = (page: Page) =>
    page.locator('.parts-track-header select.machine-type').first()

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
  })

  test('is a badge in View mode and a picker in Edit mode', async ({ page }) => {
    await expect(page.locator('.parts-track-header span.machine-type').first())
      .toHaveText('Flex')
    await expect(machinePicker(page)).toHaveCount(0)

    await enterEditMode(page)
    await expect(machinePicker(page)).toHaveValue('Flex')
  })

  test('offers the five machines the device has', async ({ page }) => {
    await enterEditMode(page)
    await selectTrack(page, '1') // T2 has a neighbour, so it can run a Neighbor machine
    await expect(machinePicker(page).locator('option'))
      .toHaveText(['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup'])
  })

  /** Manual A.4: a Neighbor machine listens to the track before it, and T1 and T5
   *  are the first of their group, so the device will not let them run one. */
  test('does not offer Neighbor on the tracks that have no neighbour', async ({ page }) => {
    await enterEditMode(page)
    for (const track of ['0', '4']) {
      await selectTrack(page, track)
      await expect(machinePicker(page).locator('option')).toHaveText(
        ['Static', 'Flex', 'Thru', 'Pickup'],
        { timeout: 5000 },
      )
    }
  })

  test('saves the machine against that Part and track', async ({ page }) => {
    await enterEditMode(page)
    await machinePicker(page).selectOption('Pickup')

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const saved = calls[calls.length - 1].args.partsData[0]
    expect(saved.part_id).toBe(0)
    expect(saved.machines[0].machine_type).toBe('Pickup')
    // Only the track that was changed
    expect(saved.machines[1].machine_type).toBe('Flex')
  })

  test('marks the Part modified', async ({ page }) => {
    await enterEditMode(page)
    await machinePicker(page).selectOption('Thru')
    await expect(page.locator('.parts-part-tab').first()).toHaveClass(/modified/)
  })

  test('the SRC page becomes the new machine\'s', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^SRC$/ }).click()
    // A Flex machine's SRC MAIN
    await expect(page.locator('.param-label', { hasText: /^STRT$/ })).toHaveCount(1)

    await machinePicker(page).selectOption('Thru')
    // A Thru machine has the inputs instead, and no setup parameters at all
    await expect(page.locator('.param-label', { hasText: /^INAB$/ })).toHaveCount(1)
    await expect(page.locator('.param-label', { hasText: /^STRT$/ })).toHaveCount(0)
  })

  /**
   * The six SRC slots are shared storage each machine reads differently, so a byte
   * left by the old machine would land on a parameter it was never meant for.
   */
  test('resets the SRC parameters to the new machine\'s defaults', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^SRC$/ }).click()
    await machinePicker(page).selectOption('Pickup')

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const machine = calls[calls.length - 1].args.partsData[0].machines[0]
    expect(machine.machine_params.ptch).toBe(64) // centre, not whatever Flex held
    expect(machine.machine_params.dir).toBe(2)
    expect(machine.machine_params.op).toBe(1)
  })

  /**
   * Switching back is not an undo. The rule is that the machine you pick starts at its
   * own defaults, in both directions - Reload Part is what puts a Part back.
   */
  test('switching back resets again rather than restoring', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^SRC$/ }).click()
    const strt = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^STRT$/ }) })
      .first().locator('input.param-value')
    await strt.fill('99')
    await strt.blur()
    await expect(strt).toHaveValue('99')

    // Thru does not use that slot, so the byte survives while the track runs Thru
    await machinePicker(page).selectOption('Thru')
    await expect(page.locator('.param-label', { hasText: /^STRT$/ })).toHaveCount(0)

    // ...but Flex does use it, so coming back starts it at the Flex default
    await machinePicker(page).selectOption('Flex')
    await expect(strt).toHaveValue('0')
  })

  test('leaves the rest of the track alone', async ({ page }) => {
    await enterEditMode(page)
    await machinePicker(page).selectOption('Thru')

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const saved = calls[calls.length - 1].args.partsData[0]
    // The AMP page, the levels and both sample slots belong to the track, not to its
    // machine - switching back has to find them where they were
    expect(saved.amps[0].atk).toBe(20)
    expect(saved.volumes[0].main).toBe(100)
    expect(saved.machines[0].flex_slot_id).toBe(0)
    expect(saved.machines[0].static_slot_id).toBe(0)
  })

  test('the track selector follows the new machine', async ({ page }) => {
    await enterEditMode(page)
    // The first entry is "All Audio Tracks", so T1 is the option whose value is 0
    const t1 = page.locator('#parts-track-select option[value="0"]')
    await expect(t1).toContainText('Flex')
    await machinePicker(page).selectOption('Thru')
    await expect(t1).toContainText('Thru')
  })

  test('a MIDI track keeps its plain badge', async ({ page }) => {
    await enterEditMode(page)
    await selectTrack(page, '8')
    await expect(page.locator('.parts-track-header span.machine-type').first())
      .toHaveText('MIDI')
    await expect(machinePicker(page)).toHaveCount(0)
  })
})

/**
 * Loading a different effect into one of a track's two blocks. The picker replaces the
 * effect's name wherever a heading shows it, so every FX heading can change it.
 */
test.describe('Parts Editor - Effect type', () => {
  const fxPicker = (page: Page) => page.locator('select.fx-type-select').first()

  /**
   * The parts Part sent by the save that `act` triggers.
   *
   * Counting the calls first matters: these tests change a parameter before changing
   * the effect, and the parameter's own debounced save lands first. Without the count,
   * the assertions read that earlier save and pass or fail for the wrong reason.
   */
  // Whatever the action resolves to is ignored; selectOption, for one, answers with
  // the values it picked
  const savedAfter = async (page: Page, act: () => Promise<unknown>) => {
    const before = (await getInvokeCalls(page, 'save_parts')).length
    await act()
    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(before)
    const calls = await getInvokeCalls(page, 'save_parts')
    return calls[calls.length - 1].args.partsData[0]
  }

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
  })

  /**
   * Manual 11.4.10: "The selectable effects differ between the two effect pages."
   * The delay and the three reverbs are FX2's alone.
   */
  test.describe('what each block offers', () => {
    const options = (page: Page) =>
      fxPicker(page).locator('option').allTextContents()

    test('FX1 leaves out the delay and the reverbs', async ({ page }) => {
      await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
      await enterEditMode(page)
      const names = await options(page)
      for (const absent of ['DELAY', 'PLATE REVERB', 'SPRING REVERB', 'DARK REVERB']) {
        expect(names, absent).not.toContain(absent)
      }
      expect(names).toHaveLength(11)
      expect(names[0]).toBe('OFF')
    })

    test('FX2 offers all fifteen', async ({ page }) => {
      await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
      await enterEditMode(page)
      const names = await options(page)
      for (const present of ['DELAY', 'PLATE REVERB', 'SPRING REVERB', 'DARK REVERB']) {
        expect(names, present).toContain(present)
      }
      expect(names).toHaveLength(15)
    })

    /**
     * A project made elsewhere could hold one in FX1. The picker still has to name
     * what is loaded, or it would silently read as a different effect.
     */
    test('FX1 still names an effect it would not offer', async ({ page }) => {
      await setupTauriMocks(page, { fx1Type: 8 })
      await page.reload()
      await openPartsTab(page)
      await selectTrack(page, '0')
      await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
      await enterEditMode(page)

      await expect(fxPicker(page)).toHaveValue('8')
      const names = await options(page)
      expect(names).toContain('DELAY')
      expect(names).toHaveLength(12)
    })
  })

  test('is a name in View mode and a picker in Edit mode', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
    await expect(page.locator('.params-column-label').first()).toHaveText('MAIN - FILTER')
    await expect(fxPicker(page)).toHaveCount(0)

    await enterEditMode(page)
    await expect(fxPicker(page)).toHaveValue('4')
  })

  test('offers every effect in the order the device lists them', async ({ page }) => {
    await enterEditMode(page)
    // FX2, because only it offers the whole list - see "what each block offers" above
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    await expect(fxPicker(page).locator('option')).toHaveText([
      'OFF', 'FILTER', 'EQ', 'DJ EQ', 'PHASER', 'FLANGER', 'CHORUS', 'SPATIALIZER',
      'COMB FILTER', 'COMPRESSOR', 'LO-FI', 'DELAY', 'PLATE REVERB', 'SPRING REVERB',
      'DARK REVERB',
    ])
  })

  test('saves the effect against that Part, track and block', async ({ page }) => {
    await enterEditMode(page)
    // A reverb, which is FX2's to offer
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    await fxPicker(page).selectOption('20') // PLATE REVERB

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const saved = calls[calls.length - 1].args.partsData[0]
    expect(saved.fxs[0].fx2_type).toBe(20)
    // The other block and the other tracks are left where they were
    expect(saved.fxs[0].fx1_type).toBe(4)
    expect(saved.fxs[1].fx2_type).toBe(8)
  })

  test('the parameter names follow the new effect', async ({ page }) => {
    await enterEditMode(page)
    // FX2 starts on the delay in the fixture, and the reverbs are its to offer
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    await expect(page.locator('.param-label', { hasText: /^FB$/ })).toHaveCount(1)

    await fxPicker(page).selectOption('21') // SPRING REVERB
    await expect(page.locator('.param-label', { hasText: /^TIME$/ })).toHaveCount(1)
    await expect(page.locator('.param-label', { hasText: /^FB$/ })).toHaveCount(0)
    // The spring reverb leaves its first row to TIME alone. The blank positions keep
    // their cells, so HP, LP and MIX stay in the columns the device puts them in.
    const cells = page.locator('.params-grid').first().locator('.param-item')
    await expect(cells).toHaveCount(6)
    await expect(cells.nth(1)).toHaveClass(/param-item-empty/)
    await expect(cells.nth(2)).toHaveClass(/param-item-empty/)
    await expect(cells.nth(3)).toContainText('HP')
  })

  test('the parameter help follows the new effect', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    await fxPicker(page).selectOption('20') // PLATE REVERB
    const tip = await page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^TIME$/ }) })
      .first().getAttribute('title')
    expect(tip).toContain('Decay time')
  })

  /**
   * An LFO target names the effect and the parameter it points at, so loading another
   * effect has to rename those too, or the LFO page keeps naming an effect that is no
   * longer there.
   */
  test('the LFO target names follow the new effect', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^LFO$/ }).click()
    const pmtr = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^PMTR$/ }) })
      .first().locator('select.param-select')
    await expect(pmtr.locator('option').nth(18)).toHaveText('FLTR BASE')

    // An effect FX1 can take - its reverbs belong to FX2
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
    await fxPicker(page).selectOption('16') // PHASER
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^LFO$/ }).click()
    await expect(pmtr.locator('option').nth(18)).toHaveText('PHSR CNTR')
  })

  /**
   * A block holds one set of twelve parameters, not one per effect, so the device
   * resets them when an effect is loaded - otherwise a reverb's decay time would arrive
   * as a phaser's centre frequency. The values are the ones read off the hardware.
   */
  test('resets the twelve parameters to what the device writes', async ({ page }) => {
    await enterEditMode(page)
    // FX2, because the reverbs are its to offer. It holds the delay in the fixture,
    // which has a BASE of its own at a different position
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    const base = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^BASE$/ }) })
      .first().locator('input.param-value')
    await base.fill('77')
    await base.blur()

    const fx = (await savedAfter(page, () => fxPicker(page).selectOption('21'))).fxs[0]
    expect(fx.fx2_param1).toBe(23) // TIME, not the 77 left by the delay
    expect(fx.fx2_param4).toBe(20) // HP
    expect(fx.fx2_param5).toBe(127) // LP
    expect(fx.fx2_setup1).toBe(1) // TYPE, which the device shows as 2
  })

  /**
   * A knob position the effect leaves blank is one the device never writes, so the
   * reset has to step over it rather than zeroing it.
   */
  test('steps over the positions the new effect leaves blank', async ({ page }) => {
    await enterEditMode(page)
    // FX2, which holds the delay in the fixture - its FB is the second position, the
    // one the spring reverb leaves blank
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    const fb = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^FB$/ }) })
      .first().locator('input.param-value')
    await fb.fill('99')
    await fb.blur()

    // The spring reverb leaves its second and third MAIN positions blank
    const saved = await savedAfter(page, () => fxPicker(page).selectOption('21'))
    expect(saved.fxs[0].fx2_param2).toBe(99)
  })

  test('leaves a block set to OFF as it was', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
    const base = page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: /^BASE$/ }) })
      .first().locator('input.param-value')
    await base.fill('77')
    await base.blur()

    const fx = (await savedAfter(page, () => fxPicker(page).selectOption('0'))).fxs[0]
    expect(fx.fx1_type).toBe(0)
    expect(fx.fx1_param1).toBe(77)
  })

  test('resets the other block when that one changes', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    await fxPicker(page).selectOption('24') // COMPRESSOR

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const fx = calls[calls.length - 1].args.partsData[0].fxs[0]
    expect(fx.fx2_param1).toBe(64) // ATK
    expect(fx.fx2_param6).toBe(127) // MIX
    // FX1 is untouched - the mocks leave its filter parameters at zero
    expect(fx.fx1_param1).toBe(0)
  })

  test('both blocks can be changed independently', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX2$/ }).click()
    await fxPicker(page).selectOption('28') // LO-FI

    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_parts')).length)
      .toBeGreaterThan(0)
    const calls = await getInvokeCalls(page, 'save_parts')
    const saved = calls[calls.length - 1].args.partsData[0]
    expect(saved.fxs[0].fx2_type).toBe(28)
    expect(saved.fxs[0].fx1_type).toBe(4)
  })

  test('marks the Part modified', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^FX1$/ }).click()
    await fxPicker(page).selectOption('24')
    await expect(page.locator('.parts-part-tab').first()).toHaveClass(/modified/)
  })

  /**
   * The heading is centred, so anything that changes the width of the effect name moves
   * the whole line. A select is as wide as its widest option whatever is selected, so
   * without sizing it to the name it is showing, every mode toggle shunted FX1 - OFF
   * sideways by the difference between OFF and SPRING REVERB.
   */
  test('the heading does not move when Edit mode goes on', async ({ page }) => {
    const label = page.locator('.parts-all-section')
      .filter({ has: page.locator('.params-label', { hasText: /^FX1 - / }) })
      .locator('.params-label')
    const geometry = async () => {
      const field = await label.locator('.fx-type-value, .fx-type-field').boundingBox()
      return { x: Math.round(field!.x), width: Math.round(field!.width) }
    }

    const view = await geometry()
    await enterEditMode(page)
    expect(await geometry()).toEqual(view)
  })

  test('the ALL page heading changes it too', async ({ page }) => {
    await enterEditMode(page)
    // A reverb, so FX2's heading - the one block that offers it
    const heading = page.locator('.parts-all-section')
      .filter({ has: page.locator('.params-label', { hasText: /^FX2 - / }) })
    await expect(heading.locator('select.fx-type-select')).toHaveValue('8')
    await heading.locator('select.fx-type-select').selectOption('22')
    await expect(heading.locator('.param-label', { hasText: /^SHVG$/ })).toHaveCount(1)
  })

  test('each ALL page heading offers its own block list', async ({ page }) => {
    await enterEditMode(page)
    const list = (block: 'FX1' | 'FX2') => page.locator('.parts-all-section')
      .filter({ has: page.locator('.params-label', { hasText: new RegExp(`^${block} - `) }) })
      .locator('select.fx-type-select option')
    await expect(list('FX1')).toHaveCount(11)
    await expect(list('FX2')).toHaveCount(15)
  })
})

/**
 * Where the picker opens. The default mock pool holds three samples, which is too short
 * a list to scroll at all, so these load it up.
 */
test.describe('Parts Editor - Slot picker opens on the assignment', () => {
  const openPicker = async (page: Page) => {
    await openPartsTab(page)
    await selectTrack(page, '0')
    await enterEditMode(page)
    await page.locator('.parts-sample-field').first().click()
    await expect(page.locator('.slot-picker-modal')).toBeVisible()
  }

  /** Where the assigned row sits relative to the list it scrolls inside. */
  const placement = (page: Page) => page.evaluate(() => {
    const row = document.querySelector('.slot-picker-row.assigned') as HTMLElement
    const list = row.closest('.slot-picker-list') as HTMLElement
    const r = row.getBoundingClientRect()
    const l = list.getBoundingClientRect()
    return {
      isCursor: row.classList.contains('cursor'),
      inView: r.top >= l.top && r.bottom <= l.bottom,
      // 0 at the top of the list, 1 at the bottom
      position: (r.top + r.height / 2 - l.top) / l.height,
    }
  })

  test('scrolls to the assigned sample, not to the top of the list', async ({ page }) => {
    await setupTauriMocks(page, { loadedFlexSlots: 128, t1FlexSlot: 99 })
    await openPicker(page)

    const at = await placement(page)
    expect(at.isCursor).toBe(true)
    expect(at.inView).toBe(true)
    // Centred rather than scraping an edge: a row pinned to the bottom with nothing
    // under it does not read as having been scrolled to
    expect(at.position).toBeGreaterThan(0.25)
    expect(at.position).toBeLessThan(0.75)
  })

  test('scrolls to it even when its slot holds nothing', async ({ page }) => {
    // The assigned row is synthesised for an empty slot and pushed to the front of the
    // list before being sorted back into its numbered place - so the index the list
    // opens on has to be read from the displayed order, not the unsorted one
    await setupTauriMocks(page, { loadedFlexSlots: 100, t1FlexSlot: 120 })
    await openPicker(page)

    const at = await placement(page)
    expect(at.isCursor).toBe(true)
    expect(at.inView).toBe(true)
  })

  test('leaves a list too short to scroll alone', async ({ page }) => {
    await setupTauriMocks(page, { loadedFlexSlots: 3, t1FlexSlot: 0 })
    await openPicker(page)

    const at = await placement(page)
    expect(at.isCursor).toBe(true)
    expect(at.inView).toBe(true)
    const scrolled = await page.locator('.slot-picker-list').evaluate(el => el.scrollTop)
    expect(scrolled).toBe(0)
  })

  test('arrow keys move the cursor without jumping the list around', async ({ page }) => {
    await setupTauriMocks(page, { loadedFlexSlots: 128, t1FlexSlot: 99 })
    await openPicker(page)
    const before = await page.locator('.slot-picker-list').evaluate(el => el.scrollTop)

    await page.keyboard.press('ArrowDown')
    const after = await page.locator('.slot-picker-list').evaluate(el => el.scrollTop)
    // One row down is still on screen, so nothing needs to scroll
    expect(after).toBe(before)
  })
})

/**
 * Running through a field's values with the wheel, rather than opening a list or
 * dragging a knob. Up is more, down is less, everywhere.
 */
test.describe('Parts Editor - Scroll wheel', () => {
  const cell = (page: Page, label: string) =>
    page.locator('.param-item')
      .filter({ has: page.locator('.param-label', { hasText: new RegExp(`^${label}$`) }) })
      .first()

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)
    await selectTrack(page, '0')
  })

  test('steps a knob value up and down', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^AMP$/ }).click()
    const atk = cell(page, 'ATK')
    const value = atk.locator('input.param-value')
    await expect(value).toHaveValue('20')

    await atk.hover()
    await page.mouse.wheel(0, -120)
    await expect(value).toHaveValue('21')
    await page.mouse.wheel(0, 120)
    await page.mouse.wheel(0, 120)
    await expect(value).toHaveValue('19')
  })

  /**
   * Only the controls answer. A page made mostly of parameters has to stay scrollable,
   * and a cell-wide target would mean scrolling it quietly edited everything the
   * pointer passed over.
   */
  test('answers over the knob and over the readout', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^AMP$/ }).click()
    const atk = cell(page, 'ATK')
    const value = atk.locator('input.param-value')

    await atk.locator('.param-control').hover()
    await page.mouse.wheel(0, -120)
    await expect(value).toHaveValue('21')

    await value.hover()
    await page.mouse.wheel(0, -120)
    await expect(value).toHaveValue('22')
  })

  test('leaves the name alone, so the page can still be scrolled past it', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^AMP$/ }).click()
    const atk = cell(page, 'ATK')
    await atk.locator('.param-label').hover()
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(200)
    await expect(atk.locator('input.param-value')).toHaveValue('20')
  })

  test('walks a drop-down through its own entries', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^SRC$/ }).click()
    const loop = cell(page, 'LOOP').locator('select.param-select')
    await expect(loop).toHaveValue('0')
    await loop.hover()
    await page.mouse.wheel(0, -120)
    await expect(loop).toHaveValue('1')
  })

  test('flips a two-value setting', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^SRC$/ }).click()
    const slic = cell(page, 'SLIC')
    await expect(slic.locator('button.param-toggle')).toHaveText('OFF')
    await slic.hover()
    await page.mouse.wheel(0, -120)
    await expect(slic.locator('button.param-toggle')).toHaveText('ON')
  })

  test('stops at the end of the range instead of wrapping', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^AMP$/ }).click()
    const atk = cell(page, 'ATK')
    await atk.hover()
    // ATK starts at 20 and its floor is 0
    for (let i = 0; i < 25; i++) await page.mouse.wheel(0, 120)
    await expect(atk.locator('input.param-value')).toHaveValue('0')
  })

  test('does nothing in View mode', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^AMP$/ }).click()
    const atk = cell(page, 'ATK')
    await atk.hover()
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(200)
    await expect(atk.locator('input.param-value')).toHaveValue('20')
  })

  /** A field that changed under the pointer is not one the page should scroll past. */
  test('does not scroll the page while a value is being stepped', async ({ page }) => {
    await enterEditMode(page)
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^All$/ }).click()
    await page.setViewportSize({ width: 1200, height: 500 })
    const atk = cell(page, 'ATK')
    await atk.locator('.param-control').hover()
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
  })

  test('scrolls the page over everything that is not a control', async ({ page }) => {
    await page.locator('.parts-page-tabs .parts-tab', { hasText: /^All$/ }).click()
    await page.setViewportSize({ width: 1200, height: 500 })
    await cell(page, 'ATK').locator('.param-label').hover()
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  })

  test('steps the track selector, which is an ordinary drop-down', async ({ page }) => {
    const badge = page.locator('.parts-track-header .track-badge').first()
    await expect(badge).toHaveText('T1')
    await page.locator('#parts-track-select').hover()
    await page.mouse.wheel(0, -120)
    // The whole page follows, so the wheel really went through React
    await expect(badge).toHaveText('T2')
  })
})

/**
 * A scene is a snapshot the crossfader morphs towards. It holds only the parameters put
 * into it - everything else carries on from the Part - so it reads as a list of what it
 * holds rather than as a second set of parameter pages.
 */
test.describe('Scenes', () => {
  const openScenes = async (page: Page) => {
    await page.goto('/#/project?path=%2Fmock%2FTESTPROJECT&name=TESTPROJECT')
    await page.getByRole('button', { name: 'Scenes', exact: true }).click()
    await expect(page.locator('.scenes-grid')).toBeVisible()
  }

  const card = (page: Page, number: number) =>
    page.locator('.scene-card').nth(number - 1)

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openScenes(page)
  })

  test('shows the sixteen scenes a Part has', async ({ page }) => {
    await expect(page.locator('.scene-card')).toHaveCount(16)
    await expect(card(page, 1).locator('.scene-number')).toHaveText('1')
    await expect(card(page, 16).locator('.scene-number')).toHaveText('16')
  })

  test('says how many parameters each one holds', async ({ page }) => {
    await expect(card(page, 1).locator('.scene-count')).toHaveText('2')
    await expect(card(page, 3).locator('.scene-count')).toHaveText('2')
    // A scene holding nothing shows a dash rather than a zero
    await expect(card(page, 4).locator('.scene-count')).toHaveText('-')
    await expect(card(page, 4)).toHaveClass(/empty/)
  })

  /** Which two the crossfader sits between is a Part setting, not part of a scene. */
  test('marks the two ends of the crossfader', async ({ page }) => {
    await expect(card(page, 1).locator('.scene-end')).toHaveText('A')
    await expect(card(page, 9).locator('.scene-end')).toHaveText('B')
    await expect(card(page, 2).locator('.scene-end')).toHaveCount(0)
    // ...and the fader itself says the same, with a pair of ends rather than a sentence
    await expect(page.locator('.crossfader-scene').first()).toHaveValue('0')
    await expect(page.locator('.crossfader-scene').last()).toHaveValue('8')
  })

  test('lists what the selected scene holds, by track', async ({ page }) => {
    await expect(page.locator('.scene-detail-title')).toHaveText('Scene 1')
    const rows = page.locator('.scene-track').first().locator('.scene-locks tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('AMP')
    await expect(rows.nth(0)).toContainText('VOL')
    await expect(rows.nth(1)).toContainText('XLV')
  })

  /** The same formatting the Parts pages use, so a value reads as the device shows it. */
  test('reads a value the way the device does, not as a raw byte', async ({ page }) => {
    // AMP VOL is centred, so the stored 100 reads as +36 from the middle
    const value = page.locator('.scene-track').first().locator('input.scene-value').first()
    await expect(value).toHaveValue('36')
    // The byte behind it is not shown anywhere - what the device reads is the value
    await expect(value).not.toHaveAttribute('title', /Stored as/)
  })

  test('shows only the tracks a scene touches', async ({ page }) => {
    // The fixture puts everything on track 1
    await expect(page.locator('.scene-track')).toHaveCount(1)
    await expect(page.locator('.scene-track').first()).toContainText('T1')
  })

  test('names an SRC position after the machine the track runs', async ({ page }) => {
    await card(page, 3).click()
    const rows = page.locator('.scene-track').first().locator('.scene-locks tr')
    // Position one of a Flex machine is PTCH, and it reads in semitones
    await expect(rows.nth(0)).toContainText('SRC')
    await expect(rows.nth(0)).toContainText('PTCH')
    await expect(rows.nth(0).locator('input.scene-value')).toHaveValue('1.2')
  })

  test('names an FX position after the effect that is loaded', async ({ page }) => {
    await card(page, 3).click()
    const rows = page.locator('.scene-track').first().locator('.scene-locks tr')
    // The mock loads a filter, whose second position is WDTH
    await expect(rows.nth(1)).toContainText('FLTR')
    await expect(rows.nth(1)).toContainText('WDTH')
  })

  /**
   * XVOL is the AMP page's sixth position. The device only shows it while a scene key
   * is held, so a scene is the only place it can be set - and the Parts editor offers
   * no knob for it at all.
   */
  test('shows the AMP parameter only a scene can set', async ({ page }) => {
    await card(page, 6).click()
    const rows = page.locator('.scene-track').first().locator('.scene-locks tr')
    await expect(rows.filter({ hasText: 'XVOL' })).toHaveCount(1)
  })

  test('says so plainly when a scene holds nothing', async ({ page }) => {
    await card(page, 4).click()
    await expect(page.locator('.scene-detail-sub')).toHaveText('Nothing held')
    await expect(page.locator('.scene-empty-message')).toBeVisible()
    await expect(page.locator('.scene-track')).toHaveCount(0)
  })

  test('scenes belong to a Part, so switching Part reloads them', async ({ page }) => {
    const before = (await getInvokeCalls(page, 'load_scenes')).length
    await page.locator('.parts-part-tab', { hasText: 'GROOVE' }).click()
    await expect
      .poll(async () => (await getInvokeCalls(page, 'load_scenes')).length)
      .toBeGreaterThan(before)
    const calls = await getInvokeCalls(page, 'load_scenes')
    expect(calls[calls.length - 1].args.partId).toBe(1)
  })

  test('is read-only until Edit mode is on', async ({ page }) => {
    // "Show all params" is always there - it changes what is shown, not what is stored
    await expect(page.locator('.scene-action:not(.scene-show-all)')).toHaveCount(0)
    await expect(page.locator('.scene-show-all')).toBeVisible()
    await expect(page.locator('input.scene-value').first()).not.toHaveClass(/editable/)
    await expect(page.locator('.scene-clear-one')).toHaveCount(0)
  })

  test.describe('editing', () => {
    test.beforeEach(async ({ page }) => {
      await page.locator('.mode-toggle').click()
    })

    const saved = async (page: Page, act: () => Promise<void>) => {
      const before = (await getInvokeCalls(page, 'save_scene')).length
      await act()
      await expect
        .poll(async () => (await getInvokeCalls(page, 'save_scene')).length)
        .toBeGreaterThan(before)
      const calls = await getInvokeCalls(page, 'save_scene')
      return calls[calls.length - 1].args
    }

    test('changes a value a scene holds', async ({ page }) => {
      const value = page.locator('input.scene-value').first()
      const args = await saved(page, async () => {
        await value.fill('40')
      })
      expect(args.sceneId).toBe(0)
      // AMP VOL is the fourth position and centred, so +40 is stored as 104
      expect(args.tracks[0].amp[3]).toBe(104)
    })

    /**
     * Taking a parameter out is writing nothing to it. The device records that as a
     * value of its own, so there is nothing special about it.
     */
    test('takes a parameter out of a scene', async ({ page }) => {
      const args = await saved(page, async () => {
        await page.locator('.scene-clear-one').first().click()
      })
      expect(args.tracks[0].amp[3]).toBeNull()
      await expect(page.locator('.scene-card').first().locator('.scene-count')).toHaveText('1')
    })

    test('puts a parameter into a scene', async ({ page }) => {
      await page.locator('.scene-show-all').click()
      const row = page.locator('.scene-track').first().locator('tr')
        .filter({ hasText: 'PTCH' }).first()
      await expect(row).toHaveClass(/unheld/)

      const args = await saved(page, async () => {
        await row.locator('.scene-add').click()
      })
      // PTCH starts at its own default, which is the centre of its range
      expect(args.tracks[0].machine[0]).toBe(64)
      await expect(row).not.toHaveClass(/unheld/)
    })

    test('shows everything a scene could hold, on request', async ({ page }) => {
      const rows = page.locator('.scene-track').first().locator('.scene-locks tr')
      await expect(rows).toHaveCount(2)
      await page.locator('.scene-show-all').click()
      // Every position of every page the track's machine and effects actually use
      await expect(rows).not.toHaveCount(2)
      await expect(rows.filter({ hasText: 'XVOL' })).toHaveCount(1)
    })

    test('copies one scene onto another', async ({ page }) => {
      await page.getByRole('button', { name: 'Copy', exact: true }).click()
      await page.locator('.scene-card').nth(3).click()
      await expect(page.locator('.scene-detail-sub')).toHaveText('Nothing held')

      const args = await saved(page, async () => {
        await page.locator('.scene-action', { hasText: 'Paste' }).click()
      })
      expect(args.sceneId).toBe(3)
      expect(args.tracks[0].amp[3]).toBe(100)
      await expect(page.locator('.scene-card').nth(3).locator('.scene-count')).toHaveText('2')
    })

    test('will not paste before something has been copied', async ({ page }) => {
      await expect(page.locator('.scene-action', { hasText: 'Paste' })).toBeDisabled()
      await page.getByRole('button', { name: 'Copy', exact: true }).click()
      await expect(page.locator('.scene-action', { hasText: 'Paste' })).toBeEnabled()
    })

    test('empties a scene', async ({ page }) => {
      const args = await saved(page, async () => {
        await page.locator('.scene-action', { hasText: 'Clear' }).click()
      })
      expect(args.tracks.every((t: { amp: (number | null)[]; xlv: number | null }) =>
        t.amp.every(v => v === null) && t.xlv === null)).toBe(true)
      await expect(page.locator('.scene-detail-sub')).toHaveText('Nothing held')
    })

    test('cannot empty a scene that is already empty', async ({ page }) => {
      await page.locator('.scene-card').nth(3).click()
      await expect(page.locator('.scene-action', { hasText: 'Clear' })).toBeDisabled()
    })

    test('steps a value with the wheel', async ({ page }) => {
      const value = page.locator('input.scene-value').first()
      await expect(value).toHaveValue('36')
      await value.hover()
      await page.mouse.wheel(0, -120)
      await expect(value).toHaveValue('37')
    })

    test('writes against the Part being shown', async ({ page }) => {
      await page.locator('.parts-part-tab', { hasText: 'GROOVE' }).click()
      const args = await saved(page, async () => {
        await page.locator('input.scene-value').first().fill('20')
      })
      expect(args.partId).toBe(1)
    })
  })

  /**
   * The crossfader sits between two of the sixteen, which belongs to the Part rather
   * than to either scene - so it is shown and set on its own.
   */
  test.describe('the crossfader', () => {
    test('shows which scene each end reaches', async ({ page }) => {
      const xf = page.locator('.crossfader')
      await expect(xf.locator('.crossfader-scene').first()).toHaveValue('0')
      await expect(xf.locator('.crossfader-scene').last()).toHaveValue('8')
      await expect(xf.locator('.crossfader-end-label').first()).toHaveText('A')
      await expect(xf.locator('.crossfader-end-label').last()).toHaveText('B')
    })

    test('marks an end that has nothing to morph towards', async ({ page }) => {
      // Scene 9 holds nothing in the fixture
      await expect(page.locator('.crossfader-scene').last().locator('option[value="8"]'))
        .toHaveText('9 (empty)')
    })

    test('is read-only until Edit mode is on', async ({ page }) => {
      await expect(page.locator('.crossfader-scene').first()).toBeDisabled()
      await page.locator('.mode-toggle').click()
      await expect(page.locator('.crossfader-scene').first()).toBeEnabled()
    })

    test('moves an end, and says so to the Part rather than to a scene', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await page.locator('.crossfader-scene').first().selectOption('5')

      await expect
        .poll(async () => (await getInvokeCalls(page, 'save_crossfader')).length)
        .toBeGreaterThan(0)
      const calls = await getInvokeCalls(page, 'save_crossfader')
      expect(calls[calls.length - 1].args).toMatchObject({ partId: 0, sceneA: 5, sceneB: 8 })
      // What the scenes hold is untouched - nothing was written to a scene
      expect(await getInvokeCalls(page, 'save_scene')).toHaveLength(0)
    })

    test('can be stepped with the wheel, like any other list', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      const a = page.locator('.crossfader-scene').first()
      await a.hover()
      await page.mouse.wheel(0, -120)
      await expect(a).toHaveValue('1')
    })

    test('says when both ends are the same scene', async ({ page }) => {
      await expect(page.locator('.toast-notification')).toHaveCount(0)
      await page.locator('.mode-toggle').click()
      await page.locator('.crossfader-scene').last().selectOption('0')
      await expect(page.locator('.toast-notification'))
        .toContainText('moving the fader changes nothing')
      // It floats clear of the row rather than widening it
      await expect(page.locator('.crossfader .toast-notification')).toHaveCount(0)
    })

    /**
     * Muting an end is FUNC + SCENE A/B on the device, kept with the project rather than
     * with the Part. It is shown either way round: without it, a scene full of locks
     * that does nothing looks like a bug in the scene.
     */
    test.describe('muting an end', () => {
      /** The letter is the switch, as the crossed-out letter is on the device */
      const ends = (page: Page) => page.locator('.crossfader-end-label')

      test('shows both ends live when neither is muted', async ({ page }) => {
        await expect(ends(page)).toHaveCount(2)
        await expect(ends(page).first()).not.toHaveClass(/muted/)
        await expect(ends(page).last()).not.toHaveClass(/muted/)
      })

      test('reads the mute off the project, per end', async ({ page }) => {
        await setupTauriMocks(page, { sceneMutes: [false, true] })
        // A hash-only goto is a same-document navigation, so the new mock would never
        // be installed - the reload is what re-runs the init scripts.
        await page.reload()
        await openScenes(page)

        await expect(ends(page).first()).not.toHaveClass(/muted/)
        await expect(ends(page).last()).toHaveClass(/muted/)
        await expect(ends(page).last()).toHaveAttribute('aria-pressed', 'true')
        await expect(ends(page).last()).toHaveAttribute('title', /FUNC \+ SCENE B/)
        // The letter is still the letter
        await expect(ends(page).last()).toHaveText('B')
      })

      test('is read-only until Edit mode is on', async ({ page }) => {
        await expect(ends(page).first()).toBeDisabled()
        await page.locator('.mode-toggle').click()
        await expect(ends(page).first()).toBeEnabled()
      })

      test('mutes the end it was clicked on, and says so to the project', async ({ page }) => {
        await page.locator('.mode-toggle').click()
        await ends(page).last().click()

        await expect(ends(page).last()).toHaveClass(/muted/)
        await expect(ends(page).first()).not.toHaveClass(/muted/)
        await expect
          .poll(async () => (await getInvokeCalls(page, 'save_scene_mute')).length)
          .toBe(1)
        const calls = await getInvokeCalls(page, 'save_scene_mute')
        expect(calls[0].args).toMatchObject({ end: 'B', muted: true })
        // It belongs to the project, so nothing was written to the bank
        expect(await getInvokeCalls(page, 'save_crossfader')).toHaveLength(0)
        expect(await getInvokeCalls(page, 'save_scene')).toHaveLength(0)
      })

      test('unmutes again', async ({ page }) => {
        await page.locator('.mode-toggle').click()
        const a = ends(page).first()
        await a.click()
        await expect(a).toHaveClass(/muted/)
        await expect
          .poll(async () => (await getInvokeCalls(page, 'save_scene_mute')).length)
          .toBe(1)

        await a.click()
        await expect(a).not.toHaveClass(/muted/)
        await expect
          .poll(async () => (await getInvokeCalls(page, 'save_scene_mute')).length)
          .toBe(2)
        const calls = await getInvokeCalls(page, 'save_scene_mute')
        expect(calls.map(c => c.args.muted)).toEqual([true, false])
        expect(calls.every(c => c.args.end === 'A')).toBe(true)
      })

      /**
       * The write waits, the way the Parts editor's does behind its knobs. Clicking
       * twice before it settles is one change of mind, so it is one write of where it
       * ended up rather than two of every step on the way.
       */
      test('a change of mind before it settles is a single write', async ({ page }) => {
        await page.locator('.mode-toggle').click()
        const a = ends(page).first()
        await a.click()
        await a.click()
        await expect(a).not.toHaveClass(/muted/)

        await expect
          .poll(async () => (await getInvokeCalls(page, 'save_scene_mute')).length,
            { timeout: 3000 })
          .toBe(1)
        const calls = await getInvokeCalls(page, 'save_scene_mute')
        expect(calls[0].args).toMatchObject({ end: 'A', muted: false })
      })
    })

    /** Copying between the ends is a crossfader action, so it sits with the ends */
    test.describe('copying between the ends', () => {
      test('is offered only in Edit mode, with the scene own actions', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Copy A to B' })).toHaveCount(0)
        await page.locator('.mode-toggle').click()
        const actions = page.locator('.scene-detail-head .scene-actions')
        await expect(actions.getByRole('button', { name: 'Copy A to B' })).toBeVisible()
        await expect(actions.getByRole('button', { name: 'Copy B to A' })).toBeVisible()
      })

      test('puts what one end holds into the other end', async ({ page }) => {
        await page.locator('.mode-toggle').click()
        // A is scene 1, which holds two parameters; B is scene 9, which holds none
        await page.getByRole('button', { name: 'Copy A to B' }).click()

        await expect
          .poll(async () => (await getInvokeCalls(page, 'save_scene')).length)
          .toBe(1)
        const call = (await getInvokeCalls(page, 'save_scene'))[0]
        expect(call.args.sceneId).toBe(8)
        expect(call.args.tracks[0].amp[3]).toBe(100)
        expect(call.args.tracks[0].xlv).toBe(64)
      })

      test('shows the scene it just wrote', async ({ page }) => {
        await page.locator('.mode-toggle').click()
        await page.getByRole('button', { name: 'Copy A to B' }).click()
        await expect(page.locator('.scene-detail-title')).toContainText('Scene 9')
        await expect(page.locator('.toast-notification')).toContainText('scene 9')
      })

      test('is refused when both ends are the same scene', async ({ page }) => {
        await page.locator('.mode-toggle').click()
        await page.locator('.crossfader-scene').last().selectOption('0')
        await expect(page.getByRole('button', { name: 'Copy A to B' })).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Copy B to A' })).toBeDisabled()
      })
    })
  })

  /**
   * Shuffling the values, not which parameters are held: which parameters a scene
   * reaches for is the musical decision, and only the app knows each one's legal range.
   */
  test.describe('randomising a scene', () => {
    test.beforeEach(async ({ page }) => {
      await page.locator('.mode-toggle').click()
    })

    test('is refused on a scene that holds nothing', async ({ page }) => {
      await page.locator('.scene-card').nth(8).click()
      await expect(page.getByRole('button', { name: 'Randomize' })).toBeDisabled()
    })

    test('gives every held value a new one, and holds the same parameters', async ({ page }) => {
      await page.getByRole('button', { name: 'Randomize' }).click()

      await expect
        .poll(async () => (await getInvokeCalls(page, 'save_scene')).length)
        .toBe(1)
      const track = (await getInvokeCalls(page, 'save_scene'))[0].args.tracks[0]
      // Scene 1 holds AMP VOL and XLV on track 1, and nothing else, before and after
      expect(track.amp.map((v: number | null) => v === null)).toEqual(
        [true, true, true, false, true, true])
      expect(track.xlv).not.toBeNull()
      expect(track.machine).toEqual([null, null, null, null, null, null])
    })

    test('stays inside each parameter own range', async ({ page }) => {
      const seen = new Set<number>()
      for (let i = 0; i < 8; i++) {
        await page.getByRole('button', { name: 'Randomize' }).click()
        await expect
          .poll(async () => (await getInvokeCalls(page, 'save_scene')).length)
          .toBe(i + 1)
        const track = (await getInvokeCalls(page, 'save_scene'))[i].args.tracks[0]
        // AMP VOL is a 0-127 level; XLV is one of two settings and nothing between
        expect(track.amp[3]).toBeGreaterThanOrEqual(0)
        expect(track.amp[3]).toBeLessThanOrEqual(127)
        expect([0, 127]).toContain(track.xlv)
        seen.add(track.amp[3])
      }
      // Eight rolls of a 128-value parameter landing on one number is not randomness
      expect(seen.size).toBeGreaterThan(1)
    })
  })

  /**
   * Scene data lives in the Part, so the Scenes editor writes the same `parts.unsaved`
   * the Parts editor does - and has to offer the same way back from it.
   */
  test.describe('saving the Part', () => {
    const header = (page: Page) => page.locator('.scenes-panel .bank-card-header')

    test('wears the same header as the Parts editor', async ({ page }) => {
      await expect(header(page).locator('h3')).toContainText('Scenes')
      await expect(header(page).locator('.parts-part-tabs .parts-part-tab')).toHaveCount(4)
    })

    test('offers Reload, Save and Save All only in Edit mode', async ({ page }) => {
      await expect(header(page).locator('.parts-edit-controls')).toHaveClass(/hidden/)
      await page.locator('.mode-toggle').click()
      await expect(header(page).locator('.parts-edit-controls')).toHaveClass(/visible/)
      for (const name of ['Reload', 'Save', 'Save All']) {
        await expect(header(page).getByRole('button', { name, exact: true })).toBeVisible()
      }
    })

    test('has nothing to save until a scene is changed', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await expect(header(page).getByRole('button', { name: 'Save', exact: true }))
        .toBeDisabled()
      await expect(header(page).getByRole('button', { name: 'Save All' })).toBeDisabled()
    })

    test('a scene edit marks the Part, and Save commits it', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await page.getByRole('button', { name: 'Clear' }).click()

      const save = header(page).getByRole('button', { name: 'Save', exact: true })
      await expect(save).toBeEnabled()
      // ...and the Part's own tab says so, as it does on the Parts page
      await expect(page.locator('.parts-part-tab').first().locator('.unsaved-indicator'))
        .toHaveClass(/visible/)

      await save.click()
      await expect
        .poll(async () => (await getInvokeCalls(page, 'commit_part')).length)
        .toBe(1)
      expect((await getInvokeCalls(page, 'commit_part'))[0].args).toMatchObject({ partId: 0 })
      await expect(save).toBeDisabled()
    })

    test('Reload needs a saved copy to go back to', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await page.getByRole('button', { name: 'Clear' }).click()
      const reload = header(page).getByRole('button', { name: 'Reload' })
      // Part 1 has a saved copy in the fixture, so Reload is offered once it is dirty
      await expect(reload).toBeEnabled()

      await reload.click()
      await expect
        .poll(async () => (await getInvokeCalls(page, 'reload_part')).length)
        .toBe(1)
      // The scenes are read again, because reloading replaced every one of them
      await expect
        .poll(async () => (await getInvokeCalls(page, 'load_scenes')).length)
        .toBeGreaterThan(1)
    })

    test('muting an end is project state, so it does not dirty the Part', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await page.locator('.crossfader-end-label').first().click()
      await expect
        .poll(async () => (await getInvokeCalls(page, 'save_scene_mute')).length)
        .toBe(1)
      await expect(header(page).getByRole('button', { name: 'Save', exact: true }))
        .toBeDisabled()
    })
  })

  /**
   * A scene is built a track at a time, so moving one track's settings to the next
   * scene is the edit that comes up - copying the whole scene would bring the other
   * seven along with it.
   */
  test.describe('copying one track between scenes', () => {
    const head = (page: Page, track: number) =>
      page.locator('.scene-track').nth(track).locator('.scene-track-head')
    const copy = (page: Page, track: number) =>
      head(page, track).getByRole('button', { name: `Copy track ${track + 1}` })
    const paste = (page: Page, track: number) =>
      head(page, track).getByRole('button', { name: `Paste track ${track + 1}` })

    test('is offered only in Edit mode', async ({ page }) => {
      await expect(page.locator('.scene-track-actions')).toHaveCount(0)
      await page.locator('.mode-toggle').click()
      await expect(copy(page, 0)).toBeVisible()
      await expect(paste(page, 0)).toBeVisible()
    })

    test('will not paste before something has been copied', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await expect(paste(page, 0)).toBeDisabled()
    })

    test('puts one track from one scene into another, leaving the rest alone', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      // Scene 1 holds AMP VOL 100 and XLV 64 on track 1
      await copy(page, 0).click()
      await page.locator('.scene-card').nth(5).click()
      await expect(paste(page, 0)).toBeEnabled()
      await paste(page, 0).click()

      await expect
        .poll(async () => (await getInvokeCalls(page, 'save_scene')).length)
        .toBe(1)
      const call = (await getInvokeCalls(page, 'save_scene'))[0]
      expect(call.args.sceneId).toBe(5)
      expect(call.args.tracks[0].amp[3]).toBe(100)
      expect(call.args.tracks[0].xlv).toBe(64)
      // Scene 6 holds an LFO value and an AMP one on track 1 in the fixture, both of
      // which the paste replaces - and every other track is untouched
      expect(call.args.tracks[1].amp).toEqual([null, null, null, null, null, null])
      expect(call.args.tracks.length).toBe(8)
    })

    test('only offers the track it was copied from', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await copy(page, 0).click()
      await page.locator('.scene-card').nth(5).click()
      // Only tracks holding something are listed, so the rest need showing first
      await page.locator('.scene-show-all').click()
      await expect(page.locator('.scene-track')).toHaveCount(8)
      await expect(paste(page, 0)).toBeEnabled()
      // Position four of the SRC page is a different parameter on another machine,
      // so the same bytes are not offered to a different track
      await expect(paste(page, 1)).toBeDisabled()
      await expect(paste(page, 7)).toBeDisabled()
    })

    /** Eight tracks and one of them will take it: green says which, without reading. */
    test('marks where the copy can go', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await expect(paste(page, 0)).not.toHaveClass(/armed/)

      await copy(page, 0).click()
      // Not yet: it is still the scene it came from
      await expect(paste(page, 0)).not.toHaveClass(/armed/)

      await page.locator('.scene-card').nth(5).click()
      await expect(paste(page, 0)).toHaveClass(/armed/)
      await page.locator('.scene-show-all').click()
      await expect(paste(page, 1)).not.toHaveClass(/armed/)
    })

    test('the count stays put when Edit mode is toggled', async ({ page }) => {
      const count = page.locator('.scene-track').first().locator('.scene-track-count')
      const before = await count.boundingBox()
      await page.locator('.mode-toggle').click()
      await expect(page.locator('.scene-track-actions').first()).toBeVisible()
      expect((await count.boundingBox())?.x).toBe(before?.x)
    })

    test('will not paste a track back into the scene it came from', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await copy(page, 0).click()
      await expect(paste(page, 0)).toBeDisabled()
      await expect(paste(page, 0)).toHaveAttribute('title', /Already this scene/)
    })

    test('says what it did', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await copy(page, 0).click()
      await expect(page.locator('.toast-notification'))
        .toContainText('T1 scene params copied from scene 1')
      await page.locator('.scene-card').nth(2).click()
      await paste(page, 0).click()
      await expect(page.locator('.toast-notification'))
        .toContainText('T1 scene params from scene 1 put into scene 3')
    })

    test('keeps the whole-scene clipboard separate', async ({ page }) => {
      await page.locator('.mode-toggle').click()
      await page.getByRole('button', { name: 'Copy', exact: true }).click()
      await copy(page, 0).click()
      // The scene copied first is still there to paste
      await page.locator('.scene-card').nth(3).click()
      await expect(page.getByRole('button', { name: 'Paste', exact: true })).toBeEnabled()
    })
  })

  /**
   * The scene number means the same thing in every bank and Part, so there is nothing
   * to reset when one of those changes - and losing the scene on the way to another
   * tab and back is the thing that makes picking it again a chore.
   */
  test.describe('remembering the scene', () => {
    // The card's own text is the A/B marker, the number and the count run together,
    // so the number is read from its own element
    const selectedScene = (page: Page) =>
      page.locator('.scene-card.active').locator('.scene-number')

    test('keeps it when the tab is left and come back to', async ({ page }) => {
      await card(page, 6).click()
      await expect(selectedScene(page)).toHaveText(/^6/)

      await page.getByRole('button', { name: 'Parts', exact: true }).click()
      await expect(page.locator('.scenes-grid')).toHaveCount(0)
      await page.getByRole('button', { name: 'Scenes', exact: true }).click()
      await expect(selectedScene(page)).toHaveText(/^6/)
    })

    test('keeps it across a Part change', async ({ page }) => {
      await card(page, 11).click()
      await page.locator('.parts-part-tab').nth(2).click()
      await expect(selectedScene(page)).toHaveText(/^11/)
    })

    test('keeps it when the page is left entirely', async ({ page }) => {
      await card(page, 4).click()
      await expect(selectedScene(page)).toHaveText('4')
      await page.goto('/')
      await openScenes(page)
      await expect(selectedScene(page)).toHaveText(/^4/)
    })

    test('starts at the first scene for a project not seen before', async ({ page }) => {
      await expect(selectedScene(page)).toHaveText(/^1/)
    })
  })

  /**
   * The same help the Parts pages give, because they are the same parameters - a scene
   * sets FLTR BASE, not something of its own, and knowing what it does is the same
   * question in both places.
   */
  test.describe('what each row explains', () => {
    const row = (page: Page, label: string) =>
      page.locator('.scene-track').first().locator('.scene-locks tr')
        .filter({ has: page.locator('.scene-lock-label', { hasText: new RegExp(`^${label}$`) }) })

    test('explains an AMP parameter the way the Parts page does', async ({ page }) => {
      await expect(row(page, 'VOL')).toHaveAttribute('title', /^VOL - Track volume before/)
    })

    test('explains the two a scene alone can set', async ({ page }) => {
      await expect(row(page, 'XLV')).toHaveAttribute('title', /after the track effects/)
      await expect(row(page, 'XLV')).toHaveAttribute('title', /MIN:/)

      await page.locator('.scene-show-all').click()
      await expect(row(page, 'XVOL')).toHaveAttribute('title', /before the track effects/)
    })

    test('names an effect parameter by the effect that is loaded', async ({ page }) => {
      await page.locator('.scene-show-all').click()
      // The fixture runs a filter in FX1, so its first position is the filter's BASE
      const base = page.locator('.scene-track').first().locator('.scene-locks tr')
        .filter({ has: page.locator('.scene-lock-page', { hasText: /^FLTR$/ }) }).first()
      await expect(base).toHaveAttribute('title', /^BASE - /)
    })

    test('explains a parameter the scene does not hold either', async ({ page }) => {
      await page.locator('.scene-show-all').click()
      await expect(row(page, 'ATK').first()).toHaveAttribute('title', /^ATK - /)
    })
  })

  /** The row of sixteen is one control, so the wheel runs through it. */
  test.describe('stepping the grid with the wheel', () => {
    const selected = (page: Page) =>
      page.locator('.scene-card.active').locator('.scene-number')

    test('moves to the next scene and back', async ({ page }) => {
      await page.locator('.scenes-grid').hover()
      await page.mouse.wheel(0, -120)
      await expect(selected(page)).toHaveText('2')
      await page.mouse.wheel(0, 120)
      await expect(selected(page)).toHaveText('1')
    })

    test('works anywhere over the grid, not only over a card', async ({ page }) => {
      const box = (await page.locator('.scenes-grid').boundingBox())!
      // The grid's own padding, which is not a card
      await page.mouse.move(box.x + 3, box.y + 3)
      await page.mouse.wheel(0, -120)
      await expect(selected(page)).toHaveText('2')
    })

    test('stops at each end rather than wrapping', async ({ page }) => {
      await page.locator('.scenes-grid').hover()
      await page.mouse.wheel(0, 120)
      await expect(selected(page)).toHaveText('1')

      await card(page, 16).click()
      await page.locator('.scenes-grid').hover()
      await page.mouse.wheel(0, -120)
      await expect(selected(page)).toHaveText('16')
    })

    test('steps without Edit mode, because it only changes what is shown', async ({ page }) => {
      await page.locator('.scenes-grid').hover()
      await page.mouse.wheel(0, -120)
      await expect(selected(page)).toHaveText('2')
      // ...and nothing was written
      expect(await getInvokeCalls(page, 'save_scene')).toHaveLength(0)
    })
  })

  /**
   * Blue, not the orange every device-value control uses: this button changes what is
   * on screen, not what is stored. Checked because the generic action hover sits later
   * in the stylesheet at the same specificity and would otherwise win.
   */
  test('Show all params hovers blue, not orange', async ({ page }) => {
    const button = page.locator('.scene-show-all')
    const border = () => button.evaluate(el => getComputedStyle(el).borderTopColor)

    await button.hover()
    expect(await border()).toBe('rgb(93, 173, 226)')

    await button.click()
    await expect(button).toHaveClass(/\bon\b/)
    await button.hover()
    expect(await border()).toBe('rgb(138, 198, 234)')
  })

  /**
   * The project page reads every bank's scenes in the background as soon as the banks
   * are loaded, so the tab - and All Banks above all, which is sixteen bank reads -
   * shows scenes rather than a row of "Reading bank...".
   */
  test.describe('reading the banks ahead', () => {
    /**
     * A hash-only goto is a same-document navigation, so a new mock would never be
     * installed - the reload is what re-runs the init scripts. It also lands back on
     * the project page with no tab chosen, which is where the read-ahead has to work.
     */
    const reopenProject = async (page: Page, preloadScenes: boolean | 'fail') => {
      await setupTauriMocks(page, { preloadScenes })
      await page.reload()
      await expect(page.getByRole('button', { name: 'Scenes', exact: true })).toBeVisible()
    }

    const bankScenesCalls = (page: Page) => getInvokeCalls(page, 'load_bank_scenes')

    test('reads every bank without the tab being opened', async ({ page }) => {
      await reopenProject(page, true)

      await expect
        .poll(async () => (await bankScenesCalls(page)).map(c => c.args.bankId))
        .toEqual(['A', 'B'])
      expect(await getInvokeCalls(page, 'load_scenes')).toHaveLength(0)
    })

    test('one call covers all four Parts of a bank', async ({ page }) => {
      await reopenProject(page, true)
      await expect.poll(async () => (await bankScenesCalls(page)).length).toBe(2)

      expect((await bankScenesCalls(page)).map(c => c.args)).toEqual([
        { path: '/mock/TESTPROJECT', bankId: 'A' },
        { path: '/mock/TESTPROJECT', bankId: 'B' },
      ])
    })

    test('reads each bank once, however long the tab stays open', async ({ page }) => {
      await reopenProject(page, true)
      await expect.poll(async () => (await bankScenesCalls(page)).length).toBe(2)

      await page.getByRole('button', { name: 'Scenes', exact: true }).click()
      await expect(page.locator('.scene-card')).toHaveCount(16)
      await page.locator('.scenes-panel .parts-tab', { hasText: 'GROOVE' }).click()
      await expect(page.locator('.scene-card')).toHaveCount(16)

      expect(await bankScenesCalls(page)).toHaveLength(2)
    })

    test('shows the scenes without reading the bank again', async ({ page }) => {
      await reopenProject(page, true)
      await expect.poll(async () => (await bankScenesCalls(page)).length).toBe(2)

      await page.getByRole('button', { name: 'Scenes', exact: true }).click()

      await expect(page.locator('.scene-card')).toHaveCount(16)
      expect(await getInvokeCalls(page, 'load_scenes')).toHaveLength(0)
    })

    test('switching Part uses what was read ahead for that Part', async ({ page }) => {
      await reopenProject(page, true)
      await expect.poll(async () => (await bankScenesCalls(page)).length).toBe(2)
      await page.getByRole('button', { name: 'Scenes', exact: true }).click()

      await page.locator('.scenes-panel .parts-tab', { hasText: 'GROOVE' }).click()

      await expect(page.locator('.scene-card')).toHaveCount(16)
      expect(await getInvokeCalls(page, 'load_scenes')).toHaveLength(0)
    })

    test('a bank the read-ahead could not read is read by the tab itself',
      async ({ page }) => {
        await reopenProject(page, 'fail')
        await page.getByRole('button', { name: 'Scenes', exact: true }).click()

        await expect(page.locator('.scene-card')).toHaveCount(16)
        expect((await getInvokeCalls(page, 'load_scenes')).length).toBeGreaterThan(0)
      })
  })

  /** Every bank at once, which is the selection the read-ahead exists for. */
  test.describe('every bank at once', () => {
    const selector = (page: Page) => page.locator('#scenes-bank-select')

    const openAllBanks = async (page: Page) => {
      await setupTauriMocks(page, { preloadScenes: true })
      await page.reload()
      await page.getByRole('button', { name: 'Scenes', exact: true }).click()
      await expect(page.locator('.scenes-grid')).toHaveCount(1)
    }

    test('offers All Banks once the banks are loaded', async ({ page }) => {
      const all = selector(page).locator('option[value="-1"]')
      await expect(all).toHaveText('All Banks')
      await expect(all).not.toBeDisabled()
    })

    test('shows one scene grid per bank', async ({ page }) => {
      await openAllBanks(page)

      await selector(page).selectOption('-1')

      await expect(page.locator('.scenes-grid')).toHaveCount(2)
      await expect(page.locator('.scene-card')).toHaveCount(32)
    })

    test('names each bank it shows', async ({ page }) => {
      await openAllBanks(page)
      await selector(page).selectOption('-1')

      const headings = page.locator('.scenes-panel .bank-card-header h3')
      await expect(headings.first()).toContainText('BANK A')
      await expect(headings.nth(1)).toContainText('BANK B')
    })

    test('shows them from what was read ahead, not by reading again', async ({ page }) => {
      await openAllBanks(page)
      await selector(page).selectOption('-1')

      await expect(page.locator('.scenes-grid')).toHaveCount(2)
      expect(await getInvokeCalls(page, 'load_scenes')).toHaveLength(0)
    })

    test('shows the same scene in every bank', async ({ page }) => {
      await openAllBanks(page)
      await card(page, 6).click()

      await selector(page).selectOption('-1')

      await expect(page.locator('.scene-card.selected')).toHaveCount(2)
      for (const selected of await page.locator('.scene-card.selected').all()) {
        await expect(selected.locator('.scene-number')).toHaveText('6')
      }
    })

    test('goes back to one bank again', async ({ page }) => {
      await openAllBanks(page)
      await selector(page).selectOption('-1')
      await expect(page.locator('.scenes-grid')).toHaveCount(2)

      await selector(page).selectOption('1')

      await expect(page.locator('.scenes-grid')).toHaveCount(1)
      await expect(page.locator('.scenes-panel .bank-card-header h3')).toContainText('BANK B')
    })
  })

  test('selecting a scene does not reload anything', async ({ page }) => {
    const before = (await getInvokeCalls(page, 'load_scenes')).length
    await card(page, 6).click()
    await expect(page.locator('.scene-detail-title')).toHaveText('Scene 6')
    expect(await getInvokeCalls(page, 'load_scenes')).toHaveLength(before)
  })
})

test.describe('Parts Editor - Nothing overflows sideways', () => {
  /** The card's padding is the only room there is: a child that bleeds past it with a
   *  negative margin puts a horizontal scrollbar on the whole window. */
  test('no page is wider than the window', async ({ page }) => {
    await setupTauriMocks(page)
    await openPartsTab(page)

    for (const label of await page.locator('.parts-page-tabs .parts-tab').allTextContents()) {
      await page.locator('.parts-page-tabs .parts-tab', { hasText: label }).first().click()
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }))
      expect(widths.scroll, `${label} page overflows sideways`).toBe(widths.client)
    }
  })
})
