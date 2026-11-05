import { test, expect, Page } from '@playwright/test'

/**
 * Ctrl + / Ctrl - / Ctrl 0 zoom the whole UI (utils/uiZoom.ts). The webview zoom itself is
 * applied by the backend (ui_zoom.rs, unit-tested there); here the keys, the call and the
 * badge are checked in a real browser, with the backend mocked.
 */
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    ;(window as any).__invokeCalls = []
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args?: any) => {
        ;(window as any).__invokeCalls.push([cmd, args])
        switch (cmd) {
          case 'step_ui_zoom': {
            // The backend's levels, enough of them to step through here
            const levels = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
            const w = window as any
            const i = levels.indexOf(w.__zoom ?? 1)
            w.__zoom = args.step === 0 ? 1 : levels[Math.min(levels.length - 1, Math.max(0, i + args.step))]
            return w.__zoom
          }
          case 'plugin:event|listen':
            return 0
          case 'plugin:event|unlisten':
            return null
          case 'scan_devices':
            return {
              locations: [{
                name: 'Location1',
                path: '/dev',
                device_type: 'LocalCopy',
                sets: [{
                  name: 'TestSet',
                  path: '/dev/TestSet',
                  has_audio_pool: true,
                  // Enough projects to force the homepage to scroll.
                  projects: Array.from({ length: 40 }, (_, i) => ({
                    name: `Project${String(i).padStart(2, '0')}`,
                    path: `/dev/TestSet/Project${String(i).padStart(2, '0')}`,
                    has_project_file: true,
                    has_banks: true,
                  })),
                }],
              }],
              standalone_projects: [],
            }
          case 'get_home_directory':
            return '/home/user/samples'
          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'get_audio_pool_status':
            return { exists: false, path: null, set_path: null }
          case 'list_audio_directory':
            return []
          case 'list_audio_files_recursive':
            return []
          case 'inspect_audio_files':
            return []
          case 'list_set_projects':
            return []
          case 'get_pool_usage':
            return {}
          case 'load_project_metadata':
            return {
              name: args?.projectPath?.split('/').pop() ?? 'Project',
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
          case 'load_single_bank':
            return {
              name: 'BANK A',
              index: args?.bankIndex ?? 0,
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
          default:
            return null
        }
      },
    }
    ;(window as any).__TAURI__ = { invoke: (window as any).__TAURI_INTERNALS__.invoke }
  })
}

const zoomCalls = (page: Page) =>
  page.evaluate(() => (window as any).__invokeCalls.filter(([c]: [string]) => c === 'step_ui_zoom').map(([, a]: [string, any]) => a.step))

const badge = (page: Page) => page.locator('.zoom-toast')

test.describe('UI zoom from the keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible()
  })

  test('Ctrl + zooms in and says by how much', async ({ page }) => {
    await page.keyboard.press('Control+Equal')
    await expect(badge(page)).toHaveText('Zoom 110%')
    await page.keyboard.press('Control+Equal')
    await expect(badge(page)).toHaveText('Zoom 125%')
    await expect(badge(page)).toHaveCount(1)
    expect(await zoomCalls(page)).toEqual([1, 1])
  })

  test('Ctrl - zooms out and Ctrl 0 goes back to 100%', async ({ page }) => {
    await page.keyboard.press('Control+Minus')
    await expect(badge(page)).toHaveText('Zoom 90%')
    await page.keyboard.press('Control+Digit0')
    await expect(badge(page)).toHaveText('Zoom 100%')
    expect(await zoomCalls(page)).toEqual([-1, 0])
  })

  test('the keypad keys work too', async ({ page }) => {
    await page.keyboard.press('Control+NumpadAdd')
    await expect(badge(page)).toHaveText('Zoom 110%')
    await page.keyboard.press('Control+NumpadSubtract')
    await expect(badge(page)).toHaveText('Zoom 100%')
  })

  test('the badge goes away on its own', async ({ page }) => {
    await page.keyboard.press('Control+Equal')
    await expect(badge(page)).toBeVisible()
    await expect(badge(page)).toHaveCount(0, { timeout: 4000 })
  })

  test('typing in a field is left alone', async ({ page }) => {
    const search = page.getByPlaceholder('Search projects...')
    await search.click()
    await page.keyboard.type('a-b=0')
    await expect(search).toHaveValue('a-b=0')
    expect(await zoomCalls(page)).toEqual([])
  })
})
