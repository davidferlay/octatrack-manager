import { test, expect, Page } from '@playwright/test'

/**
 * Homepage scroll position is remembered in sessionStorage when navigating
 * away to a project or the Audio Pool page, and restored when navigating
 * back - see HomePage.tsx's goTo/navigatingAwayRef and the scroll effects.
 * Regression coverage for a race condition where a stray 'scroll' event fired
 * during the outgoing page's async navigate() window could overwrite the
 * just-saved position with 0 right before HomePage unmounted.
 */
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args?: any) => {
        switch (cmd) {
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

test.describe('Homepage scroll restoration', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Scan for Projects' }).click()
    await expect(page.locator('.project-card').first()).toBeVisible({ timeout: 10000 })
  })

  test('scroll position survives a project round trip', async ({ page }) => {
    await page.mouse.move(640, 360)
    await page.mouse.wheel(0, 2000)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(scrollBefore).toBeGreaterThan(100)

    await page.locator('.project-card:not(.new-project-card)').last().click()
    await expect(page.locator('.back-button', { hasText: 'Back' })).toBeVisible({ timeout: 10000 })

    await page.locator('.back-button', { hasText: 'Back' }).click()
    await expect(page.locator('.project-card').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, -1)
  })

  test('scroll position survives an Audio Pool round trip', async ({ page }) => {
    await page.mouse.move(640, 360)
    await page.mouse.wheel(0, 2000)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(scrollBefore).toBeGreaterThan(100)

    await page.locator('.audio-pool-card').first().click()
    await expect(page.locator('main.audio-pool-page')).toBeVisible({ timeout: 10000 })

    await page.locator('.back-button', { hasText: 'Back' }).click()
    await expect(page.locator('.project-card').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, -1)
  })
})
