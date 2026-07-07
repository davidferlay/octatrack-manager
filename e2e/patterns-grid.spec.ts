import { test, expect, Page } from '@playwright/test'

/**
 * Patterns Tab Grid E2E Tests
 *
 * Tests the pattern step grid rendering with mocked Tauri responses:
 * trig type indicators (trigger, one-shot, trigless, trigless lock),
 * recorder vs one-shot recorder trigs, sample-lock-only steps (S without P),
 * the legend, and the step details panel including slice-mode STRT display.
 */

async function setupTauriMocks(page: Page) {
  await page.addInitScript(() => {
    const emptyStep = (n: number) => ({
      step: n, trigger: false, trigless: false, plock: false, oneshot: false, swing: false,
      slide: false, recorder: false, recorder_oneshot: false, trig_condition: null, trig_repeats: 0,
      micro_timing: null, notes: [], velocity: null, plock_count: 0, sample_slot: null,
      audio_plocks: null, midi_plocks: null,
    })

    // Track 1 (slice mode, slice_count 64):
    // step 1 trigger, step 2 one-shot, step 3 trigless, step 4 trigless lock,
    // step 5 rec trig, step 6 one-shot rec trig,
    // step 13 sample lock only (S, no P), step 15 STRT p-lock (slice 4)
    const t1Steps = Array(64).fill(null).map((_, i) => emptyStep(i)) as any[]
    t1Steps[0].trigger = true
    t1Steps[1].oneshot = true
    t1Steps[2].trigless = true
    t1Steps[3].plock = true
    t1Steps[4].recorder = true
    t1Steps[5].recorder = true
    t1Steps[5].recorder_oneshot = true
    t1Steps[12].trigger = true
    t1Steps[12].sample_slot = 1
    t1Steps[12].audio_plocks = { machine: {}, flex_slot_id: 0 }
    t1Steps[14].trigger = true
    t1Steps[14].plock_count = 1
    t1Steps[14].audio_plocks = { machine: { param2: 6 } }

    // Track 2 (no slice mode): same STRT p-lock must show the raw start value
    const t2Steps = Array(64).fill(null).map((_, i) => emptyStep(i)) as any[]
    t2Steps[14].trigger = true
    t2Steps[14].plock_count = 1
    t2Steps[14].audio_plocks = { machine: { param2: 6 } }

    const emptyCounts = { trigger: 0, trigless: 0, plock: 0, oneshot: 0, swing: 0, slide: 0, total: 0 }
    const makeTrack = (k: number) => ({
      track_id: k,
      track_type: k < 8 ? 'Audio' : 'MIDI',
      steps: k === 0 ? t1Steps : k === 1 ? t2Steps : [],
      swing_amount: 0,
      per_track_len: null,
      per_track_scale: null,
      default_note: null,
      assigned_sample_slot: k === 0 ? 1 : null,
      slice_count: k === 0 ? 64 : null,
      pattern_settings: { trig_mode: 'ONE', trig_quant: 'DIRECT', start_silent: false, plays_free: false, oneshot_trk: false },
      trig_counts: emptyCounts,
    })

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
            return [0]

          case 'load_single_bank':
            return {
              id: 'A', name: 'BANK A', index: 0,
              parts: [
                {
                  id: 0, name: 'PART 1',
                  patterns: Array(16).fill(null).map((_, j) => ({
                    id: j, name: `Pattern ${j + 1}`, part_assignment: 0, length: 16,
                    scale_mode: 'Normal', master_scale: '1x', chain_mode: 'Project', tempo_info: null,
                    active_tracks: 1, trig_counts: emptyCounts, per_track_settings: null, has_swing: false,
                    tracks: Array(16).fill(null).map((_, k) => makeTrack(k)),
                  })),
                },
                { id: 1, name: 'PART 2', patterns: [] },
                { id: 2, name: 'PART 3', patterns: [] },
                { id: 3, name: 'PART 4', patterns: [] },
              ],
            }

          case 'load_parts_data':
            return {
              parts: Array(4).fill(null).map((_, partId) => ({
                part_id: partId,
                machines: Array(8).fill(null).map((_, i) => ({
                  track_id: i,
                  machine_type: 'Flex',
                  machine_params: { ptch: null, strt: null, len: null, rate: null, rtrg: null, rtim: null, in_ab: null, vol_ab: null, in_cd: null, vol_cd: null, dir: null, gain: null, op: null },
                  machine_setup: { xloop: null, slic: null, len: null, rate: null, tstr: null, tsns: null },
                })),
                amps: [], lfos: [], fxs: [],
                midi_notes: [], midi_arps: [], midi_lfos: [], midi_ctrl1s: [], midi_ctrl2s: [],
              })),
              parts_edited_bitmask: 0,
              parts_saved_state: [0, 0, 0, 0],
            }

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
  })
}

test.describe('Patterns tab - step grid indicators', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    const patternsTab = page.locator('.header-tab', { hasText: 'Patterns' })
    await expect(patternsTab).toBeVisible({ timeout: 10000 })
    await patternsTab.click()
    await expect(page.locator('.pattern-step').first()).toBeVisible({ timeout: 10000 })
  })

  const stepCell = (page: Page, step: number) => page.locator('.track-grid .pattern-step').nth(step - 1)
  const recCell = (page: Page, step: number) => page.locator('.rec-grid .pattern-step').nth(step - 1)

  test('trigger, one-shot, trigless and trigless lock render as circles', async ({ page }) => {
    await expect(stepCell(page, 1).locator('.indicator-trigger i.fas.fa-circle')).toBeVisible()

    // one-shot: plain filled circle, no trigger circle, no "1" text
    await expect(stepCell(page, 2).locator('.indicator-oneshot i.fas.fa-circle')).toBeVisible()
    await expect(stepCell(page, 2).locator('.indicator-trigger')).toHaveCount(0)

    // trigless: plain filled circle
    await expect(stepCell(page, 3).locator('.indicator-trigless i.fas.fa-circle')).toBeVisible()

    // trigless lock: outlined circle, previously not displayed at all
    await expect(stepCell(page, 4).locator('.indicator-lock i.far.fa-circle')).toBeVisible()
    await expect(stepCell(page, 4).locator('.indicator-plock')).toHaveCount(0)
  })

  test('one-shot recorder trig is differentiated from recorder trig', async ({ page }) => {
    // recorder trigs render on their own grid, like on the hardware
    await expect(recCell(page, 5).locator('.indicator-recorder')).toHaveText('R')
    await expect(recCell(page, 5).locator('.indicator-recorder-oneshot')).toHaveCount(0)

    await expect(recCell(page, 6).locator('.indicator-recorder-oneshot')).toHaveText('R')
    await expect(recCell(page, 6).locator('.indicator-recorder')).toHaveCount(0)

    // the track grid never shows recorder indicators
    await expect(page.locator('.track-grid .indicator-recorder')).toHaveCount(0)
  })

  test('trig view toggle switches between track, both and rec grids', async ({ page }) => {
    // default "Both": track 1 has rec trigs, so both grids and captions show
    await expect(page.locator('.track-grid')).toBeVisible()
    await expect(page.locator('.rec-grid')).toBeVisible()
    await expect(page.locator('.pattern-grid-caption', { hasText: 'Sample trigs' })).toBeVisible()
    await expect(page.locator('.pattern-grid-caption', { hasText: 'Recorder trigs' })).toBeVisible()

    await page.locator('.tri-toggle-option', { hasText: 'Track' }).click()
    await expect(page.locator('.track-grid')).toBeVisible()
    await expect(page.locator('.rec-grid')).toHaveCount(0)

    await page.locator('.tri-toggle-option', { hasText: 'Rec' }).click()
    await expect(page.locator('.track-grid')).toHaveCount(0)
    await expect(page.locator('.rec-grid')).toBeVisible()

    await page.locator('.tri-toggle-option', { hasText: 'Both' }).click()
    await expect(page.locator('.track-grid')).toBeVisible()
    await expect(page.locator('.rec-grid')).toBeVisible()
  })

  test('Both hides the recorder grid when the track has no rec trigs', async ({ page }) => {
    // track 2 has no recorder trigs
    await page.locator('#patterns-track-select').selectOption('1')
    await expect(page.locator('.track-grid')).toBeVisible()
    await expect(page.locator('.rec-grid')).toHaveCount(0)
    // Rec view still shows the (empty) recorder grid explicitly
    await page.locator('.tri-toggle-option', { hasText: 'Rec' }).click()
    await expect(page.locator('.rec-grid')).toBeVisible()
  })

  test('sample-lock-only step shows S without P', async ({ page }) => {
    await expect(stepCell(page, 13).locator('.indicator-sample')).toHaveText('S')
    await expect(stepCell(page, 13).locator('.indicator-plock')).toHaveCount(0)
    await expect(stepCell(page, 15).locator('.indicator-plock')).toHaveText('P')
  })

  test('legend lists the new indicators', async ({ page }) => {
    const legend = page.locator('.pattern-grid-legend')
    await expect(legend.locator('.legend-item', { hasText: 'One-Shot Rec' })).toBeVisible()
    await expect(legend.locator('.legend-item', { hasText: /^\s*Lock\s*$/ })).toBeVisible()
    await expect(legend.locator('.legend-item', { hasText: 'One-Shot' }).first()).toBeVisible()
  })

  test('step details name the trig types', async ({ page }) => {
    await stepCell(page, 4).click()
    const panel = page.locator('.parameter-details-panel')
    await expect(panel).toContainText('Trigless Lock')

    await stepCell(page, 6).click()
    await expect(panel).toContainText('Recorder Trig:')
    await expect(panel).toContainText('Yes (One-Shot)')
  })

  test('STRT p-lock shows the slice number in slice mode', async ({ page }) => {
    await stepCell(page, 15).click()
    const panel = page.locator('.parameter-details-panel')
    // slice mode: stored value 6 = slice 6/2 + 1 = 4
    await expect(panel).toContainText('STRT (Slice):')
    await expect(panel).toContainText('4')
  })

  test('STRT p-lock shows the raw start value without slice mode', async ({ page }) => {
    // switch to track 2, which has no slice mode
    await page.locator('#patterns-track-select').selectOption('1')
    await expect(page.locator('.pattern-step').first()).toBeVisible()
    await stepCell(page, 15).click()
    const panel = page.locator('.parameter-details-panel')
    await expect(panel).toContainText('STRT (Start):')
    await expect(panel).toContainText('6')
  })
})

test.describe('Patterns tab - indicator filters', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    const patternsTab = page.locator('.header-tab', { hasText: 'Patterns' })
    await expect(patternsTab).toBeVisible({ timeout: 10000 })
    await patternsTab.click()
    await expect(page.locator('.pattern-step').first()).toBeVisible({ timeout: 10000 })
  })

  const chip = (page: Page, label: string) =>
    page.locator('.indicator-filter-chip', { hasText: label }).first()

  test('global filter chip hides an indicator in all patterns and persists', async ({ page }) => {
    await expect(page.locator('.indicator-recorder').first()).toBeVisible()

    await chip(page, 'Recorder').click()
    await expect(chip(page, 'Recorder')).toHaveClass(/off/)
    await expect(page.locator('.pattern-step .indicator-recorder')).toHaveCount(0)
    // globally hidden indicators leave the per-pattern legend too
    await expect(page.locator('.pattern-grid-legend .legend-item', { hasText: /^\s*R\s*Recorder\s*$/ })).toHaveCount(0)

    // persisted across reloads
    await page.reload()
    await page.locator('.header-tab', { hasText: 'Patterns' }).click()
    await expect(page.locator('.pattern-step').first()).toBeVisible({ timeout: 10000 })
    await expect(chip(page, 'Recorder')).toHaveClass(/off/)
    await expect(page.locator('.pattern-step .indicator-recorder')).toHaveCount(0)

    // toggle back on
    await chip(page, 'Recorder').click()
    await expect(page.locator('.pattern-step .indicator-recorder').first()).toBeVisible()
  })

  test('None hides every indicator and All restores them', async ({ page }) => {
    await expect(page.locator('.pattern-step .indicator-trigger').first()).toBeVisible()

    await chip(page, 'None').click()
    await expect(page.locator('.pattern-step .step-indicators span')).toHaveCount(0)
    await expect(chip(page, 'Trigger')).toHaveClass(/off/)

    await chip(page, 'All').click()
    await expect(page.locator('.pattern-step .indicator-trigger').first()).toBeVisible()
    await expect(chip(page, 'Trigger')).not.toHaveClass(/off/)
  })

  test('chips for indicators absent from the displayed patterns are disabled', async ({ page }) => {
    // track 1 has recorder trigs but no swing/slide steps
    await expect(chip(page, 'Recorder')).toBeEnabled()
    await expect(chip(page, 'Swing')).toBeDisabled()
    await expect(chip(page, 'Slide')).toBeDisabled()
  })

  test('MIDI Note/Chord chip only appears while MIDI tracks are displayed', async ({ page }) => {
    // default view shows an audio track
    await expect(page.locator('.indicator-filter-chip', { hasText: 'MIDI Note/Chord' })).toHaveCount(0)

    await page.locator('#patterns-track-select').selectOption('-2') // All MIDI Tracks
    await expect(chip(page, 'MIDI Note/Chord')).toBeVisible()
    // the mocked MIDI tracks have no trigs at all, so the chip is also disabled
    await expect(chip(page, 'MIDI Note/Chord')).toBeDisabled()

    await page.locator('#patterns-track-select').selectOption('0')
    await expect(page.locator('.indicator-filter-chip', { hasText: 'MIDI Note/Chord' })).toHaveCount(0)
  })

  test('the slide indicator uses the rising-arrow glyph', async ({ page }) => {
    // chip glyphs come from the same INDICATOR_DEFS as the grid
    await expect(chip(page, 'Slide').locator('.indicator-slide')).toHaveText('↗')
  })

  test('legend badge hides an indicator for its own pattern only', async ({ page }) => {
    // show all 16 patterns so there are several cards with legends
    await page.locator('select[id^="pattern-select"]').selectOption('-1')
    const cards = page.locator('.pattern-card')
    await expect(cards.nth(1)).toBeVisible()

    const firstCard = cards.nth(0)
    const secondCard = cards.nth(1)
    await expect(firstCard.locator('.indicator-recorder').first()).toBeVisible()
    await expect(secondCard.locator('.indicator-recorder').first()).toBeVisible()

    const badge = firstCard.locator('.pattern-grid-legend .legend-item', { hasText: /^\s*R\s*Recorder\s*$/ })
    await badge.click()
    await expect(badge).toHaveClass(/off/)
    await expect(firstCard.locator('.pattern-step .indicator-recorder')).toHaveCount(0)
    // the other pattern card is unaffected
    await expect(secondCard.locator('.pattern-step .indicator-recorder').first()).toBeVisible()

    // clicking again restores it
    await badge.click()
    await expect(firstCard.locator('.pattern-step .indicator-recorder').first()).toBeVisible()
  })
})

test.describe('Patterns tab - keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    const patternsTab = page.locator('.header-tab', { hasText: 'Patterns' })
    await expect(patternsTab).toBeVisible({ timeout: 10000 })
    await patternsTab.click()
    await expect(page.locator('.pattern-step').first()).toBeVisible({ timeout: 10000 })
  })

  const detailsHeader = (page: Page) => page.locator('.parameter-panel-header h4')

  test('arrow keys and Tab move the step selection', async ({ page }) => {
    await page.locator('.pattern-step').nth(0).click()
    await expect(detailsHeader(page)).toHaveText('Step 1 details')

    await page.keyboard.press('ArrowRight')
    await expect(detailsHeader(page)).toHaveText('Step 2 details')

    await page.keyboard.press('Tab')
    await expect(detailsHeader(page)).toHaveText('Step 3 details')

    await page.keyboard.press('Shift+Tab')
    await expect(detailsHeader(page)).toHaveText('Step 2 details')

    await page.keyboard.press('ArrowLeft')
    await expect(detailsHeader(page)).toHaveText('Step 1 details')

    await page.keyboard.press('Escape')
    await expect(page.locator('.parameter-details-panel')).toHaveCount(0)
  })

  test('arrows past the pattern edge switch to the neighbor pattern', async ({ page }) => {
    // last step of Pattern 1 (length 16)
    await page.locator('.pattern-step').nth(15).click()
    await expect(detailsHeader(page)).toHaveText('Step 16 details')

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.pattern-name')).toHaveText('Pattern 2')
    await expect(detailsHeader(page)).toHaveText('Step 1 details')

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.pattern-name')).toHaveText('Pattern 1')
    await expect(detailsHeader(page)).toHaveText('Step 16 details')
  })

  test('Up and Down move by a full page row when the pattern is long enough', async ({ page }) => {
    // Pattern 1 is 16 steps long: Down past the end must do nothing
    await page.locator('.pattern-step').nth(0).click()
    await page.keyboard.press('ArrowDown')
    await expect(detailsHeader(page)).toHaveText('Step 1 details')
  })
})
