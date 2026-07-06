import { test, expect, Page } from '@playwright/test'

/**
 * Project Detail Overview Tab E2E Tests
 *
 * Tests the Overview tab with mocked Tauri responses: metadata display (project info,
 * current state, mixer, memory), the memory settings edit flow (debounced
 * save_memory_settings), reserve length clamping, and ?tab= routing.
 */

async function setupTauriMocks(page: Page) {
  await page.addInitScript(() => {
    const invokeCalls: { cmd: string; args: any }[] = []
    ;(window as any).__invokeCalls = invokeCalls

    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        invokeCalls.push({ cmd, args })
        switch (cmd) {
          case 'load_project_metadata':
            return {
              name: 'TestProject',
              tempo: 128.5,
              time_signature: '4/4',
              pattern_length: 16,
              os_version: '1.40C',
              current_state: {
                bank: 0, bank_name: 'BANK A', pattern: 3, part: 1, track: 0,
                midi_mode: 0, track_othermode: 0,
                audio_muted_tracks: [1, 2], audio_soloed_tracks: [4], audio_cued_tracks: [],
                midi_muted_tracks: [], midi_soloed_tracks: [6],
              },
              mixer_settings: { gain_ab: 12, gain_cd: -6, dir_ab: 0, dir_cd: 0, phones_mix: 32, main_level: 100, cue_level: 90 },
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
                { id: 0, name: 'PART 1', patterns: [] },
                { id: 1, name: 'PART 2', patterns: [] },
                { id: 2, name: 'PART 3', patterns: [] },
                { id: 3, name: 'PART 4', patterns: [] },
              ],
            }

          case 'load_parts_data':
            return { parts: [], parts_edited_bitmask: 0, parts_saved_state: [0, 0, 0, 0] }

          case 'save_memory_settings':
            return 42.5

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
  })
}

async function getInvokeCalls(page: Page, cmd: string): Promise<{ cmd: string; args: any }[]> {
  return page.evaluate((c) => (window as any).__invokeCalls.filter((call: any) => call.cmd === c), cmd)
}

function compactItem(page: Page, label: string) {
  return page
    .locator('.compact-item')
    .filter({ has: page.locator('.compact-label', { hasText: new RegExp(`^${label}$`) }) })
}

async function openOverview(page: Page) {
  await page.goto('/#/project?path=/test/project&name=TestProject')
  await expect(page.locator('.overview-tab')).toBeVisible({ timeout: 10000 })
}

test.describe('Overview - Metadata display', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openOverview(page)
  })

  test('project info shows tempo, time signature and OS version', async ({ page }) => {
    await expect(compactItem(page, 'Tempo').locator('.compact-value')).toHaveText('128.5 BPM')
    await expect(compactItem(page, 'Time Sig').first().locator('.compact-value')).toHaveText('4/4')
    await expect(compactItem(page, 'OS').locator('.compact-value')).toHaveText('1.40C')
  })

  test('audio and MIDI modes list muted and soloed tracks independently', async ({ page }) => {
    // Audio: tracks 2, 3 muted (0-based 1, 2), track 5 soloed (0-based 4)
    const audioMuted = compactItem(page, 'Muted').first()
    await expect(audioMuted.locator('.track-badge')).toHaveText(['T2', 'T3'])
    const audioSoloed = compactItem(page, 'Soloed').first()
    await expect(audioSoloed.locator('.track-badge')).toHaveText(['T5'])
    // MIDI: nothing muted, track 7 soloed (0-based 6, shown as MIDI track)
    const midiMuted = compactItem(page, 'Muted').nth(1)
    await expect(midiMuted.locator('.compact-value')).toHaveText('—')
    const midiSoloed = compactItem(page, 'Soloed').nth(1)
    await expect(midiSoloed.locator('.track-badge')).toHaveText(['T7'])
  })

  test('current state shows bank, 1-based pattern and part, and mode', async ({ page }) => {
    await expect(compactItem(page, 'Bank').locator('.compact-value')).toHaveText('BANK A')
    await expect(compactItem(page, 'Pattern').locator('.compact-value')).toHaveText('4') // pattern 3 is 1-based 4
    await expect(compactItem(page, 'Part').locator('.compact-value')).toHaveText('2') // part 1 is 1-based 2
    await expect(compactItem(page, 'Mode').locator('.compact-value')).toHaveText('Audio')
  })

  test('mixer section shows the project mixer values', async ({ page }) => {
    const mixer = page.locator('.overview-section', { has: page.locator('h2', { hasText: 'Mixer' }) })
    await expect(mixer.locator('.compact-value').nth(0)).toHaveText('12') // gain_ab
    await expect(mixer.locator('.compact-value').nth(1)).toHaveText('-6') // gain_cd
  })

  test('memory section shows read-only values in View mode', async ({ page }) => {
    await expect(compactItem(page, 'Flex Format').locator('.compact-value')).toHaveText('16-bit')
    await expect(compactItem(page, 'Dynamic Recorders').locator('.compact-value')).toHaveText('No')
    await expect(compactItem(page, 'Recorder Format').locator('.compact-value')).toHaveText('16-bit')
    await expect(compactItem(page, 'Reserve Recordings').locator('.compact-value')).toHaveText('R1-R8')
    await expect(compactItem(page, 'Reserve Length').locator('.compact-value')).toHaveText('16 s')
    // No editable controls in View mode
    await expect(page.locator('.compact-select')).toHaveCount(0)
    await expect(page.locator('.compact-input')).toHaveCount(0)
  })
})

test.describe('Overview - Memory settings editing', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
    await openOverview(page)
    await page.locator('.mode-toggle').click()
    await expect(page.locator('.compact-select').first()).toBeVisible()
  })

  test('changing Flex Format saves the full settings via save_memory_settings', async ({ page }) => {
    await compactItem(page, 'Flex Format').locator('select').selectOption('true')

    // Save is debounced by 500ms
    await expect
      .poll(async () => (await getInvokeCalls(page, 'save_memory_settings')).length, { timeout: 5000 })
      .toBeGreaterThan(0)

    const calls = await getInvokeCalls(page, 'save_memory_settings')
    const lastCall = calls[calls.length - 1]
    expect(lastCall.args.path).toBe('/test/project')
    expect(lastCall.args.settings.load_24bit_flex).toBe(true)
    expect(lastCall.args.settings.record_24bit).toBe(false)
    expect(lastCall.args.settings.reserved_recorder_count).toBe(8)
    expect(lastCall.args.settings.reserved_recorder_length).toBe(16)
  })

  test('reserve length is clamped to the maximum for 8 recorders at 16-bit', async ({ page }) => {
    const input = compactItem(page, 'Reserve Length').locator('input.compact-input')
    await input.fill('99')
    // Max for 8 recorders, 16-bit: floor(89652480 / (8 * 44100 * 2 * 2)) = 63
    await expect(input).toHaveValue('63')
  })

  test('reserve length is disabled when no recorders are reserved', async ({ page }) => {
    await compactItem(page, 'Reserve Recordings').locator('select').selectOption('0')
    await expect(compactItem(page, 'Reserve Length').locator('input.compact-input')).toBeDisabled()
  })
})

test.describe('Overview - Tab routing', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page)
  })

  test('?tab=tools opens the Tools tab', async ({ page }) => {
    await page.goto('/#/project?path=/test/project&name=TestProject&tab=tools')
    await expect(page.locator('.header-tab.active')).toHaveText('Tools', { timeout: 10000 })
  })

  test('an invalid ?tab= falls back to Overview', async ({ page }) => {
    await page.goto('/#/project?path=/test/project&name=TestProject&tab=bogus')
    await expect(page.locator('.header-tab.active')).toHaveText('Overview', { timeout: 10000 })
    await expect(page.locator('.overview-tab')).toBeVisible()
  })
})
