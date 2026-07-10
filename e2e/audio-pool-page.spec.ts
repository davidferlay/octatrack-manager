import { test, expect, Page } from '@playwright/test'

// Mocks the standalone Audio Pool page (Source + Audio Pool panes). Records every
// copy_audio_file_with_progress call on window.__copyCalls so a drag can be asserted.
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__copyCalls = []
    ;(window as any).__invokeCalls = []
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    ;(window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args: any) => {
        ;(window as any).__invokeCalls.push([cmd, args])
        switch (cmd) {
          case 'plugin:event|listen':
            return 0
          case 'plugin:event|unlisten':
            return null
          case 'get_home_directory':
            return '/home/user/samples'
          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'list_audio_directory':
            return [
              { name: 'Loops', size: 0, channels: 0, bit_rate: 0, sample_rate: 0, is_directory: true, path: (args?.path || '') + '/Loops' },
              { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: (args?.path || '') + '/kick.wav' },
              { name: 'snare.wav', size: 2048, channels: 1, bit_rate: 24, sample_rate: 48000, is_directory: false, path: (args?.path || '') + '/snare.wav' },
            ]
          case 'copy_audio_file_with_progress':
            ;(window as any).__copyCalls.push(args)
            return (args?.destinationDir || '') + '/kick.wav'
          case 'read_audio_file':
            return new ArrayBuffer(8)
          default:
            return null
        }
      },
    }
  })
}

async function openPage(page: Page) {
  await page.goto('/#/audio-pool?path=/test/set/AUDIO&name=TestSet')
  // Both panes list files via list_audio_directory; wait for the Source pane to populate.
  await expect(page.locator('.source-panel').getByText('kick.wav')).toBeVisible({ timeout: 10000 })
}

test.describe('Audio Pool page — Source to Pool drag', () => {
  test('dragging a Source file onto the Audio Pool pane copies it (pointer-based, macOS-safe)', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)

    const row = page.locator('.source-panel tr', { hasText: 'kick.wav' }).first()
    const dest = page.locator('.dest-panel').first()
    const from = await row.boundingBox()
    const to = await dest.boundingBox()
    if (!from || !to) throw new Error('missing drag source/target')

    // Real @dnd-kit pointer drag: down on the row, move past the 5px activation, then over the pool pane.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await page.mouse.up()

    // The dnd-kit onDragEnd routed the dropped file through copyFilesToPool -> copy_audio_file_with_progress.
    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__copyCalls.length)
    }).toBeGreaterThan(0)

    const calls = await page.evaluate(() => (window as any).__copyCalls)
    expect(calls.some((c: any) => String(c.sourcePath).endsWith('kick.wav'))).toBe(true)
    expect(calls[0].destinationDir).toBe('/test/set/AUDIO')
  })

  test('a plain click on a Source folder selects it without copying', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)

    await page.locator('.source-panel tr', { hasText: 'Loops' }).first().click()
    await expect(page.locator('.source-panel tr.selected', { hasText: 'Loops' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__copyCalls.length)).toBe(0)
  })
})

test.describe('Audio Pool page — sample playback', () => {
  const readAudioPaths = (page: Page) =>
    page.evaluate(() =>
      (window as any).__invokeCalls.filter(([c]: [string]) => c === 'read_audio_file').map(([, a]: [string, any]) => a.path)
    )

  test('file context menu shows Play as its first item and plays the file', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
    await page.locator('.dest-panel tr', { hasText: 'kick.wav' }).first().click({ button: 'right' })
    const first = page.locator('.context-menu .context-menu-item').first()
    await expect(first).toHaveText(/Play/)
    await expect(first).toBeEnabled()
    await first.click()
    await expect.poll(async () => readAudioPaths(page)).toContain('/test/set/AUDIO/kick.wav')
  })

  test('directory context menu Play item is disabled', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
    await page.locator('.source-panel tr', { hasText: 'Loops' }).first().click({ button: 'right' })
    const first = page.locator('.context-menu .context-menu-item').first()
    await expect(first).toHaveText(/Play/)
    await expect(first).toBeDisabled()
  })

  test('double-clicking a Source file plays it', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
    await page.locator('.source-panel tr', { hasText: 'snare.wav' }).first().dblclick()
    await expect.poll(async () => readAudioPaths(page)).toContain('/home/user/samples/snare.wav')
  })

  test('double-clicking an Audio Pool file plays it', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
    await page.locator('.dest-panel tr', { hasText: 'snare.wav' }).first().dblclick()
    await expect.poll(async () => readAudioPaths(page)).toContain('/test/set/AUDIO/snare.wav')
  })

  test('double-clicking a Source folder still navigates into it (no playback)', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
    await page.locator('.source-panel tr', { hasText: 'Loops' }).first().dblclick()
    // Navigation re-lists the entered directory
    await expect
      .poll(async () => page.evaluate(() =>
        (window as any).__invokeCalls.some(([c, a]: [string, any]) => c === 'list_audio_directory' && a?.path === '/home/user/samples/Loops')
      ))
      .toBe(true)
    expect(await readAudioPaths(page)).toEqual([])
  })

  test('clicking the title copies the pool path; right-click opens the title menu', async ({ page }) => {
    await setupMocks(page)
    await openPage(page)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await page.locator('h1.pool-title').click()
    await expect(page.locator('.toast-notification')).toContainText('Path copied!')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/test/set/AUDIO')

    await page.locator('h1.pool-title').click({ button: 'right' })
    const menu = page.locator('.context-menu')
    await expect(menu.getByText('Open in file explorer')).toBeVisible()
    await menu.getByText('Open in file explorer').click()
    await expect
      .poll(async () => page.evaluate(() =>
        (window as any).__invokeCalls.some(([c, a]: [string, any]) => c === 'reveal_in_file_manager' && a?.path === '/test/set/AUDIO')
      ))
      .toBe(true)
  })
})
