import { test, expect, Page } from '@playwright/test'

/**
 * Track Selector E2E Tests
 *
 * Tests that audio tracks display their machine type (Flex, Static, Thru, etc.)
 * from the active part's data in the Track Selector dropdown.
 */

// Machine types for mock: T1=Flex, T2=Static, T3=Thru, T4=Neighbor, T5=Pickup, T6=Flex, T7=Static, T8=Flex
const MOCK_MACHINE_TYPES = ['Flex', 'Static', 'Thru', 'Neighbor', 'Pickup', 'Flex', 'Static', 'Flex']

async function setupTauriMocks(page: Page) {
  await page.addInitScript((machineTypes: string[]) => {
    (window as any).__TAURI_INTERNALS__ = {
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
                bank: 0,
                bank_name: 'BANK A',
                pattern: 0,
                part: 0,
                track: 2,
                muted_tracks: [],
                soloed_tracks: [],
                midi_mode: 0,
                track_othermode: 0,
                audio_muted_tracks: [],
                audio_cued_tracks: [],
                midi_muted_tracks: [],
              },
              mixer_settings: { gain_ab: 0, gain_cd: 0, dir_ab: 0, dir_cd: 0, phones_mix: 0, main_level: 100, cue_level: 100 },
              memory_settings: { load_24bit_flex: false, dynamic_recorders: false, record_24bit: false, reserved_recorder_count: 8, reserved_recorder_length: 16 },
              midi_settings: { trig_channels: [1,2,3,4,5,6,7,8], auto_channel: 10, clock_send: true, clock_receive: true, transport_send: true, transport_receive: true, prog_change_send: false, prog_change_send_channel: 1, prog_change_receive: false, prog_change_receive_channel: 1 },
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
                { id: 0, name: 'PART 1', patterns: Array(16).fill(null).map((_, j) => ({ id: j, name: `Pattern ${j + 1}`, part_assignment: 0, length: 16, scale_mode: 'Normal', master_scale: '1x', chain_mode: 'OFF', tempo_info: null, active_tracks: 0, trig_counts: { trigger: 0, trigless: 0, plock: 0, oneshot: 0, swing: 0, slide: 0, total: 0 }, per_track_settings: null, has_swing: false, tracks: Array(16).fill(null).map((_, k) => ({ track_id: k, track_type: k < 8 ? 'Audio' : 'MIDI', steps: [], swing_amount: 0, per_track_len: null, per_track_scale: null, default_note: null, pattern_settings: { trig_mode: 'ONE', trig_quant: 'DIRECT', start_silent: false, plays_free: false, oneshot_trk: false }, trig_counts: { trigger: 0, trigless: 0, plock: 0, oneshot: 0, swing: 0, slide: 0, total: 0 } })) })) },
                { id: 1, name: 'PART 2', patterns: [] },
                { id: 2, name: 'PART 3', patterns: [] },
                { id: 3, name: 'PART 4', patterns: [] },
              ],
            }
          }

          case 'load_parts_data': {
            const makeMachines = (types: string[]) => types.map((t: string, i: number) => ({
              track_id: i,
              machine_type: t,
              machine_params: { ptch: null, strt: null, len: null, rate: null, rtrg: null, rtim: null, in_ab: null, vol_ab: null, in_cd: null, vol_cd: null, dir: null, gain: null, op: null },
              machine_setup: { xloop: null, slic: null, len: null, rate: null, tstr: null, tsns: null },
            }))

            return {
              parts: Array(4).fill(null).map((_, partId) => ({
                part_id: partId,
                machines: makeMachines(partId === 0 ? machineTypes : Array(8).fill('Flex')),
                amps: [], lfos: [], fxs: [],
                midi_notes: [], midi_arps: [], midi_lfos: [], midi_ctrl1s: [], midi_ctrl2s: [],
              })),
              parts_edited_bitmask: 0,
              parts_saved_state: [0, 0, 0, 0],
            }
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
  }, MOCK_MACHINE_TYPES)
}

test.describe('Track Selector - Machine Types', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await page.goto('/#/project?path=/test/project&name=TestProject')
    // Wait for the Patterns tab to be available (metadata + banks loaded)
    const patternsTab = page.locator('.header-tab', { hasText: 'Patterns' })
    await expect(patternsTab).toBeVisible({ timeout: 10000 })
    // Navigate to Patterns tab where the TrackSelector is guaranteed to render
    await patternsTab.click()
  })

  test('shows machine types for all audio tracks', async ({ page }) => {
    const trackSelect = page.locator('#patterns-track-select')
    await expect(trackSelect).toBeVisible({ timeout: 10000 })

    await expect(trackSelect.locator('option[value="0"]')).toContainText('T1 (Flex)')
    await expect(trackSelect.locator('option[value="1"]')).toContainText('T2 (Static)')
    await expect(trackSelect.locator('option[value="2"]')).toContainText('T3 (Thru)')
    await expect(trackSelect.locator('option[value="3"]')).toContainText('T4 (Neighbor)')
    await expect(trackSelect.locator('option[value="4"]')).toContainText('T5 (Pickup)')
    await expect(trackSelect.locator('option[value="5"]')).toContainText('T6 (Flex)')
    await expect(trackSelect.locator('option[value="6"]')).toContainText('T7 (Static)')
    await expect(trackSelect.locator('option[value="7"]')).toContainText('T8 (Flex)')
  })

  test('MIDI tracks still show (MIDI) label', async ({ page }) => {
    const trackSelect = page.locator('#patterns-track-select')
    await expect(trackSelect).toBeVisible({ timeout: 10000 })

    await expect(trackSelect.locator('option[value="8"]')).toContainText('T1 (MIDI)')
    await expect(trackSelect.locator('option[value="9"]')).toContainText('T2 (MIDI)')
    await expect(trackSelect.locator('option[value="15"]')).toContainText('T8 (MIDI)')
  })

  test('active track shows Active indicator alongside machine type', async ({ page }) => {
    const trackSelect = page.locator('#patterns-track-select')
    await expect(trackSelect).toBeVisible({ timeout: 10000 })

    // Track 3 (index 2) is the current track in mock data
    await expect(trackSelect.locator('option[value="2"]')).toContainText('T3 (Thru) (Active)')
  })

  test('All Audio Tracks and All MIDI Tracks options are present', async ({ page }) => {
    const trackSelect = page.locator('#patterns-track-select')
    await expect(trackSelect).toBeVisible({ timeout: 10000 })

    await expect(trackSelect.locator('option[value="-1"]')).toHaveText('All Audio Tracks')
    await expect(trackSelect.locator('option[value="-2"]')).toHaveText('All MIDI Tracks')
  })

  test('machine types do not leak into MIDI track labels', async ({ page }) => {
    const trackSelect = page.locator('#patterns-track-select')
    await expect(trackSelect).toBeVisible({ timeout: 10000 })

    // Verify no MIDI track has machine type labels
    for (let i = 8; i <= 15; i++) {
      const option = trackSelect.locator(`option[value="${i}"]`)
      await expect(option).not.toContainText('Flex')
      await expect(option).not.toContainText('Static')
      await expect(option).not.toContainText('Thru')
      await expect(option).not.toContainText('Neighbor')
      await expect(option).not.toContainText('Pickup')
    }
  })
})
