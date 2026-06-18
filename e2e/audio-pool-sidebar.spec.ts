import { test, expect, Page } from '@playwright/test'

// Mocks just enough backend for the Flex slots tab + Audio Pool sidebar.
async function setupMocks(page: Page, opts?: { withAudioPool?: boolean }) {
  const withAudioPool = opts?.withAudioPool ?? true
  await page.addInitScript((withAudioPool: boolean) => {
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string) => {
        switch (cmd) {
          case 'plugin:event|listen':
            return 0
          case 'plugin:event|unlisten':
            return null
          case 'get_audio_pool_status':
            return withAudioPool
              ? { exists: true, path: '/test/set/AUDIO', set_path: '/test/set' }
              : { exists: false, path: null, set_path: '/test/set' }
          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'list_audio_directory':
            return [
              { name: 'Drums', size: 0, channels: 0, bit_rate: 0, sample_rate: 0, is_directory: true, path: '/test/set/AUDIO/Drums' },
              { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: '/test/set/AUDIO/kick.wav' },
              { name: 'snare.wav', size: 2048, channels: 1, bit_rate: 24, sample_rate: 48000, is_directory: false, path: '/test/set/AUDIO/snare.wav' },
            ]
          case 'expand_audio_paths':
            return [] // dropped/dragged folders expand to their files; not exercised here
          case 'reveal_in_file_manager':
            return null
          case 'get_existing_banks':
            return [] // no banks to load — keeps the loader fast and lets tabs render
          case 'load_single_bank':
            return null
          case 'load_project_banks':
            return []
          case 'load_project_metadata':
            return {
              name: 'TestProject',
              tempo: 120.0,
              time_signature: '4/4',
              pattern_length: 16,
              os_version: '1.40F',
              current_state: {
                bank: 0, bank_name: 'BANK A', pattern: 0, part: 0, track: 0,
                muted_tracks: [], soloed_tracks: [], midi_mode: 0, track_othermode: 0,
                audio_muted_tracks: [], audio_cued_tracks: [], midi_muted_tracks: [],
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
                  slot_id: i + 1, slot_type: 'Flex',
                  path: i < 3 ? `/samples/flex_${i}.wav` : null,
                  gain: i < 3 ? 72 : null, loop_mode: null, timestretch_mode: null,
                  source_location: i < 3 ? 'Project' : null, file_exists: i < 3,
                  compatibility: i < 3 ? 'compatible' : null,
                  file_format: i < 3 ? 'WAV' : null, bit_depth: i < 3 ? 16 : null, sample_rate: i < 3 ? 44100 : null,
                })),
                static_slots: Array(128).fill(null).map((_, i) => ({
                  slot_id: i + 1, slot_type: 'Static', path: null, gain: null,
                  loop_mode: null, timestretch_mode: null, source_location: null,
                  file_exists: false, compatibility: null, file_format: null, bit_depth: null, sample_rate: null,
                })),
              },
            }
          default:
            return null
        }
      },
    }
  }, withAudioPool)
}

async function openFlexTab(page: Page) {
  await page.goto('/#/project?path=/test/set/TestProject&name=TestProject')
  await page.waitForTimeout(1500)
  const flexTab = page.locator('.header-tab', { hasText: 'Flex' })
  await flexTab.click()
  await page.waitForTimeout(500)
}

test.describe('Audio Pool sidebar in Flex slots', () => {
  test('shows the Audio Pool toggle when the project is in a Set with an AUDIO pool', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await expect(page.locator('.audio-pool-toggle-btn').first()).toBeVisible({ timeout: 10000 })
  })

  test('hides the Audio Pool toggle when there is no AUDIO pool', async ({ page }) => {
    await setupMocks(page, { withAudioPool: false })
    await openFlexTab(page)
    await expect(page.locator('.audio-pool-toggle-btn')).toHaveCount(0)
  })

  test('opening the pane shows the sidebar and reduces slot columns', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)

    // Non-essential columns visible before opening
    await expect(page.locator('th', { hasText: 'SOURCE' })).toBeVisible()

    await page.locator('.audio-pool-toggle-btn').first().click()
    await page.waitForTimeout(500)

    // Sidebar appears with audio files
    await expect(page.locator('.audio-pool-sidebar')).toBeVisible()
    await expect(page.locator('.audio-pool-sidebar').getByText('kick.wav')).toBeVisible()

    // Slot table reduced to essentials — Source/Gain hidden
    await expect(page.locator('.samples-table th', { hasText: 'SOURCE' })).toHaveCount(0)
    await expect(page.locator('.samples-table th', { hasText: 'GAIN' })).toHaveCount(0)
  })

  test('works in view mode (default) — toggle is enabled without entering edit mode', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    const toggle = page.locator('.audio-pool-toggle-btn').first()
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(page.locator('.audio-pool-sidebar')).toBeVisible()
  })

  test('shows the open-Audio-Pool-page button inside the pane when a pool exists', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    // The button now lives inside the Audio Pool pane — open it first
    await page.locator('.audio-pool-toggle-btn').first().click()
    await expect(page.locator('.audio-pool-page-btn')).toBeVisible()
  })

  test('hides the open-Audio-Pool-page button without a pool', async ({ page }) => {
    await setupMocks(page, { withAudioPool: false })
    await openFlexTab(page)
    await expect(page.locator('.audio-pool-page-btn')).toHaveCount(0)
  })

  test('pane shows an Import icon button', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.audio-pool-toggle-btn').first().click()
    await expect(page.locator('.audio-pool-sidebar button[title*="Import audio"]')).toBeVisible()
  })

  test('right-clicking a slot row opens the slot context menu', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    // First slot F1 has a sample in the mock
    const row = page.locator('.samples-table tbody tr').first()
    await row.click({ button: 'right' })
    await expect(page.getByText('Clear sample')).toBeVisible()
    await expect(page.getByText(/Reset attributes/i)).toBeVisible()
    await expect(page.getByText(/Import audio file\(s\) from system/i)).toBeVisible()
    await expect(page.getByText(/Import audio directory from system/i)).toBeVisible()
  })

  test('right-clicking a pool file shows "Assign to first empty slot"', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.audio-pool-toggle-btn').first().click()
    const file = page.locator('.audio-pool-sidebar tbody tr', { hasText: 'kick.wav' })
    await file.click({ button: 'right' })
    await expect(page.getByText(/Assign to first empty slot/i)).toBeVisible()
    // No slot selected yet → "Assign to selected slot" is absent
    await expect(page.getByText(/Assign to selected slot/i)).toHaveCount(0)
  })

  test('"Assign to selected slot" appears once a slot is selected', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.audio-pool-toggle-btn').first().click()
    // Select a slot row, then right-click a pool file
    await page.locator('.samples-table tbody tr').first().click()
    const file = page.locator('.audio-pool-sidebar tbody tr', { hasText: 'kick.wav' })
    await file.click({ button: 'right' })
    await expect(page.getByText(/Assign to selected slot/i)).toBeVisible()
  })

  test('the up button and pool-page button live in the pane header/path row', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.audio-pool-toggle-btn').first().click()
    // "Go up" button sits in the bottom path row, disabled at the AUDIO root
    const up = page.locator('.sidebar-path-row button[title="Go up"]')
    await expect(up).toBeVisible()
    await expect(up).toBeDisabled()
    // Open-page button sits in the pane toolbar
    await expect(page.locator('.audio-pool-page-btn')).toBeVisible()
  })

  test('slot context menu offers "Open in file explorer"', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.samples-table tbody tr').first().click({ button: 'right' })
    await expect(page.getByText(/Open in file explorer/i)).toBeVisible()
  })

  test('pool file context menu offers "Open in file explorer"', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.audio-pool-toggle-btn').first().click()
    await page.locator('.audio-pool-sidebar tbody tr', { hasText: 'kick.wav' }).click({ button: 'right' })
    await expect(page.getByText(/Open in file explorer/i)).toBeVisible()
  })

  test('pool directory context menu shows only "Open in file explorer" (no assign items)', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.audio-pool-toggle-btn').first().click()
    await page.locator('.audio-pool-sidebar tbody tr', { hasText: 'Drums' }).click({ button: 'right' })
    await expect(page.getByText(/Open in file explorer/i)).toBeVisible()
    await expect(page.getByText(/Assign to first empty slot/i)).toHaveCount(0)
  })

  test("pressing 'a' opens the Audio Pool pane", async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await expect(page.locator('.audio-pool-sidebar')).toHaveCount(0)
    await page.keyboard.press('a')
    await expect(page.locator('.audio-pool-sidebar')).toBeVisible()
  })

  test('project title right-click menu has open-in-explorer and copy-path', async ({ page }) => {
    await setupMocks(page, { withAudioPool: true })
    await openFlexTab(page)
    await page.locator('.project-header h1').click({ button: 'right' })
    await expect(page.getByText(/Open in file explorer/i)).toBeVisible()
    await expect(page.getByText(/Copy path to clipboard/i)).toBeVisible()
  })
})
