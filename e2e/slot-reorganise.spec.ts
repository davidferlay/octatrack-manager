import { test, expect, Page } from '@playwright/test'

/**
 * Reorganising sample slots: dragging rows, "Move to slot...", Tidy, and the
 * re-read after a move.
 *
 * The backend is mocked. move_sample_slots and sort_sample_slots record their
 * arguments and return a report: by default the dragged slots landing from the
 * target down, or whatever a test puts in window.__nextReport first. After a move,
 * load_project_metadata returns F2's sample on F8, so a re-read is visible in the
 * table itself and not only in the call log.
 */

const NAMES = ['kick.wav', 'snare.wav', 'hat.wav', 'clap.wav', 'bass.wav']

async function setupMocks(page: Page) {
  await page.addInitScript((names: string[]) => {
    const w = window as any
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    w.__invokeCalls = []
    w.__nextReport = null
    w.__moved = false

    const slot = (id: number, type: string, path: string | null) => ({
      slot_id: id, slot_type: type, path,
      gain: path ? 72 : null, loop_mode: null, timestretch_mode: null,
      source_location: path ? 'Project' : null, file_exists: !!path,
      compatibility: path ? 'compatible' : null, file_format: path ? 'WAV' : null,
      bit_depth: path ? 16 : null, sample_rate: path ? 44100 : null,
    })
    // F1-F5 and S1-S3 hold a sample; after a move F2's sample sits on F8
    const flexPath = (i: number) => {
      if (w.__moved && i === 1) return null
      if (w.__moved && i === 7) return names[1]
      return i < names.length ? names[i] : null
    }
    const metadata = () => ({
      name: 'TestProject', tempo: 120.0, time_signature: '4/4', pattern_length: 16, os_version: '1.40F',
      current_state: {
        bank: 0, bank_name: 'BANK A', pattern: 0, part: 0, track: 0, midi_mode: 0, track_othermode: 0,
        audio_muted_tracks: [], audio_soloed_tracks: [], audio_cued_tracks: [], midi_muted_tracks: [], midi_soloed_tracks: [],
      },
      mixer_settings: { gain_ab: 0, gain_cd: 0, dir_ab: 0, dir_cd: 0, phones_mix: 0, main_level: 100, cue_level: 100 },
      memory_settings: { load_24bit_flex: false, dynamic_recorders: false, record_24bit: false, reserved_recorder_count: 8, reserved_recorder_length: 16, flex_ram_free_mb: 85.5 },
      midi_settings: { trig_channels: [1, 2, 3, 4, 5, 6, 7, 8], auto_channel: 10, clock_send: true, clock_receive: true, transport_send: true, transport_receive: true, prog_change_send: false, prog_change_send_channel: 1, prog_change_receive: false, prog_change_receive_channel: 1 },
      metronome_settings: { enabled: false, main_volume: 64, cue_volume: 64, pitch: 64, tonal: false, preroll: 0, time_signature_numerator: 4, time_signature_denominator: 4 },
      sample_slots: {
        flex_slots: Array.from({ length: 128 }, (_, i) => slot(i + 1, 'Flex', flexPath(i))),
        static_slots: Array.from({ length: 128 }, (_, i) => slot(i + 1, 'Static', i < 3 ? names[i] : null)),
      },
    })
    const emptyUsage = () => Array.from({ length: 128 }, () => [])

    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args?: any) => {
        w.__invokeCalls.push([cmd, args])
        switch (cmd) {
          case 'plugin:event|listen':
            return 0
          case 'load_project_metadata':
            return metadata()
          case 'compute_sample_usage':
            return { flex_usage: emptyUsage(), static_usage: emptyUsage() }
          case 'move_sample_slots': {
            w.__moved = true
            const report = w.__nextReport ?? {
              moves: args.sources.map((s: number, i: number) => [s, args.target + i]),
              swapped: null, pushed: [], files_written: [],
            }
            w.__nextReport = null
            return report
          }
          case 'sort_sample_slots':
            // A test sets __hold to keep the sort running until it calls __release()
            if (w.__hold) await new Promise(resolve => { w.__release = resolve })
            return w.__nextReport ?? { moves: [[3, 1], [1, 2], [2, 3]], swapped: null, pushed: [], files_written: [] }
          case 'get_existing_banks':
          case 'load_project_banks':
          case 'get_slot_audio_paths':
            return []
          case 'get_audio_pool_status':
            return { exists: false, path: null, set_path: null }
          case 'check_project_in_set':
            return false
          case 'get_system_resources':
            return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: 4 }
          case 'check_missing_source_files':
            return 0
          case 'plugin:app|version':
            return '1.0.0'
          default:
            return null
        }
      },
    }
    w.__TAURI__ = { invoke: w.__TAURI_INTERNALS__.invoke }
  }, NAMES)
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as any).__invokeCalls.filter(([n]: [string]) => n === c).map(([, a]: [string, any]) => a), cmd)

const row = (page: Page, slotId: number) => page.locator(`.samples-table tbody tr[data-slot-id="${slotId}"]`)

async function openTab(page: Page, tab: 'Flex' | 'Static', edit = true) {
  await page.goto('/#/project?path=/test/TestProject&name=TestProject')
  const tabButton = page.locator('.header-tab', { hasText: tab })
  await expect(tabButton).toBeVisible({ timeout: 10000 })
  await tabButton.click()
  await expect(row(page, 1)).toBeVisible({ timeout: 10000 })
  if (edit) {
    await page.locator('.mode-toggle').click()
    await expect(page.locator('.mode-toggle-btn.active', { hasText: 'Edit' })).toBeVisible()
  }
}

/** A real dnd-kit pointer drag held over the target row: past the 5 px activation distance, then onto it. */
async function holdDragOver(page: Page, fromId: number, toId: number) {
  const from = (await row(page, fromId).boundingBox())!
  const to = (await row(page, toId).boundingBox())!
  const x = from.x + from.width / 2
  await page.mouse.move(x, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, from.y + from.height / 2 + 10, { steps: 4 })
  await page.mouse.move(x, to.y + to.height / 2, { steps: 10 })
}

/**
 * Drags onto a row and lets go once the drop box shows there, as a person would. dnd-kit
 * takes the drop target from its last render, so letting go before that render drops on
 * the row before (seen under load).
 */
async function dragRow(page: Page, fromId: number, toId: number) {
  await holdDragOver(page, fromId, toId)
  // The box starts on the target row: a box from the row before covers it too
  await expect(row(page, toId)).toHaveClass(/drop-block-first/)
  await page.mouse.up()
}

/** The same gesture where no drag should start, so there is no drop box to wait for. */
async function tryDrag(page: Page, fromId: number, toId: number) {
  await holdDragOver(page, fromId, toId)
  await page.mouse.up()
}

const dropRows = (page: Page) =>
  page.locator('.samples-table tbody tr.drop-block').evaluateAll(rows => rows.map(r => Number(r.getAttribute('data-slot-id'))))

const toast = (page: Page) => page.locator('.toast-notification')

/** Name order, descending, so the five samples stay at the top and the empty slots go below. */
async function sortByNameDesc(page: Page) {
  const label = page.locator('th.col-sample .sortable-label')
  await label.click()
  await label.click()
  await expect(page.locator('.samples-table tbody tr').first()).toHaveAttribute('data-slot-id', '2') // snare
}

test.describe('Reorganising sample slots', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
  })

  test('dragging one Flex slot onto a free row moves it there', async ({ page }) => {
    await openTab(page, 'Flex')
    await dragRow(page, 2, 8)
    await expect.poll(() => calls(page, 'move_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', sources: [2], target: 8 },
    ])
    await expect(toast(page)).toHaveText(/F002 moved to F008/)
    await expect(toast(page)).toHaveClass(/info/)
  })

  test('a Shift run drags as one call with the slots in order', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Shift'] })
    await dragRow(page, 2, 10)
    await expect.poll(() => calls(page, 'move_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', sources: [1, 2, 3], target: 10 },
    ])
    await expect(toast(page)).toHaveText(/3 slots moved to F010-F012/)
  })

  test('the drop box spans as many rows as there are slots being moved', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Shift'] })
    await holdDragOver(page, 2, 10)
    await expect.poll(() => dropRows(page)).toEqual([10, 11, 12])
    await expect(row(page, 10)).toHaveClass(/drop-block-first/)
    await expect(row(page, 12)).toHaveClass(/drop-block-last/)
    // One box, not three: no row in it is a single-row target
    await expect(page.locator('.samples-table tbody tr.drop-target-highlight')).toHaveCount(0)
    await page.mouse.up()
    await expect.poll(() => dropRows(page)).toEqual([])
  })

  test('the drop box counts only taken slots in a Shift run', async ({ page }) => {
    await openTab(page, 'Flex')
    // 4 and 5 hold samples, 6 and 7 are empty
    await row(page, 4).click()
    await row(page, 7).click({ modifiers: ['Shift'] })
    await holdDragOver(page, 4, 12)
    await expect.poll(() => dropRows(page)).toEqual([12, 13])
    await page.mouse.up()
  })

  test('one slot over a taken row frames just that row, the one it would swap with', async ({ page }) => {
    await openTab(page, 'Flex')
    await holdDragOver(page, 2, 4)
    await expect.poll(() => dropRows(page)).toEqual([4])
    await page.mouse.up()
  })

  test('no drop box over the row the drag started from', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Shift'] })
    const box = (await row(page, 2).boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 40, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, y, { steps: 5 })
    await expect(page.getByText('3 slots', { exact: true })).toBeVisible()
    expect(await dropRows(page)).toEqual([])
    await page.mouse.up()
  })

  test('a selection let go on the row it was grabbed by moves nothing', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Shift'] })
    // Sideways along row 2, well past the 5 px drag distance, and let go on row 2 itself
    const box = (await row(page, 2).boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 40, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, y, { steps: 5 })
    await expect(page.getByText('3 slots', { exact: true })).toBeVisible() // the drag is live
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(await calls(page, 'move_sample_slots')).toEqual([])
    await expect(toast(page)).toHaveCount(0)
  })

  test('Ctrl picks drag as one call with the slots in order', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 4).click()
    await row(page, 1).click({ modifiers: ['Control'] })
    await dragRow(page, 4, 10)
    await expect.poll(() => calls(page, 'move_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', sources: [1, 4], target: 10 },
    ])
  })

  test('dragging with the table sorted by name warns and moves nothing', async ({ page }) => {
    await openTab(page, 'Flex')
    await sortByNameDesc(page)
    await tryDrag(page, 2, 4)
    await expect(toast(page)).toHaveText(/Sort by slot and clear the filters to move slots by dragging/)
    await expect(toast(page)).toHaveClass(/warning/)
    expect(await calls(page, 'move_sample_slots')).toEqual([])
  })

  test('dragging with a search warns and moves nothing', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.locator('.header-search-input').fill('a') // every sample ends in .wav
    await expect(page.locator('.samples-table tbody tr')).toHaveCount(5)
    await tryDrag(page, 2, 4)
    await expect(toast(page)).toHaveText(/Sort by slot and clear the filters to move slots by dragging/)
    expect(await calls(page, 'move_sample_slots')).toEqual([])
  })

  test('a plain click still selects in Edit mode, with no warning', async ({ page }) => {
    await openTab(page, 'Flex')
    await sortByNameDesc(page)
    await row(page, 2).click()
    await expect(row(page, 2)).toHaveClass(/selected/)
    await expect(toast(page)).toHaveCount(0)
  })

  test('nothing drags in View mode', async ({ page }) => {
    await openTab(page, 'Flex', false)
    await tryDrag(page, 2, 8)
    await page.waitForTimeout(300)
    expect(await calls(page, 'move_sample_slots')).toEqual([])
    await expect(toast(page)).toHaveCount(0)
  })

  test('Hide empty on still drags, and a swap says so', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.locator('.toggle-switch', { hasText: 'Hide empty' }).click()
    await expect(page.locator('.samples-table tbody tr')).toHaveCount(5)
    await page.evaluate(() => {
      (window as any).__nextReport = { moves: [[1, 3], [3, 1]], swapped: [1, 3], pushed: [], files_written: [] }
    })
    await dragRow(page, 1, 3)
    await expect.poll(() => calls(page, 'move_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', sources: [1], target: 3 },
    ])
    await expect(toast(page)).toHaveText(/F001 and F003 swapped/)
    await expect(toast(page)).toHaveClass(/warning/)
  })

  test('with Hide empty on, the drop box ends on the last row shown', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.locator('.toggle-switch', { hasText: 'Hide empty' }).click()
    await expect(page.locator('.samples-table tbody tr')).toHaveCount(5)
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Shift'] })
    // Three slots over F4 land on F4-F6; F6 is empty, so hidden
    await holdDragOver(page, 2, 4)
    await expect.poll(() => dropRows(page)).toEqual([4, 5])
    await expect(row(page, 4)).toHaveClass(/drop-block-first/)
    await expect(row(page, 5)).toHaveClass(/drop-block-last/)
    await page.mouse.up()
  })

  test('the drag badge is as wide as its text, not the row', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Shift'] })
    await holdDragOver(page, 2, 10)
    const badge = (await page.getByText('3 slots', { exact: true }).boundingBox())!
    const rowBox = (await row(page, 10).boundingBox())!
    expect(badge.width).toBeLessThan(rowBox.width / 4)
    await page.mouse.up()
  })

  test('a push says how many slots were pushed down and where to', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 2).click({ modifiers: ['Shift'] })
    await page.evaluate(() => {
      (window as any).__nextReport = {
        moves: [[1, 3], [2, 4], [3, 5], [4, 6], [5, 7]], swapped: null,
        pushed: [[3, 5], [4, 6], [5, 7]], files_written: [],
      }
    })
    await dragRow(page, 1, 3)
    await expect(toast(page)).toHaveText(/2 slots moved to F003-F004, 3 slots pushed down \(F003-F005 now F005-F007\)/)
    await expect(toast(page)).toHaveClass(/warning/)
  })

  test('a refused move shows the reason and re-reads nothing', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.evaluate(() => {
      const w = window as any
      const inner = w.__TAURI_INTERNALS__.invoke
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args?: any) => {
        if (cmd === 'move_sample_slots') { w.__invokeCalls.push([cmd, args]); throw 'Not enough free slots below F008' }
        return inner(cmd, args)
      }
    })
    const before = (await calls(page, 'load_project_metadata')).length
    const historyBefore = (await calls(page, 'write_history_state')).length
    await dragRow(page, 2, 8)
    await expect(toast(page)).toHaveText(/Not enough free slots below F008/)
    await expect(toast(page)).toHaveClass(/warning/)
    expect((await calls(page, 'load_project_metadata')).length).toBe(before)
    // A failure partway through writing would leave an Undo entry, so the buttons ask again
    await expect.poll(async () => (await calls(page, 'write_history_state')).length).toBeGreaterThan(historyBefore)
  })

  test('after a move the slot list and the write history are read again', async ({ page }) => {
    await openTab(page, 'Flex')
    const metadataBefore = (await calls(page, 'load_project_metadata')).length
    const historyBefore = (await calls(page, 'write_history_state')).length
    await dragRow(page, 2, 8)
    await expect.poll(async () => (await calls(page, 'load_project_metadata')).length).toBeGreaterThan(metadataBefore)
    await expect.poll(async () => (await calls(page, 'write_history_state')).length).toBeGreaterThan(historyBefore)
    // The table shows what was read back, not the old numbers
    await expect(row(page, 8)).toContainText('snare.wav')
    await expect(row(page, 2)).not.toContainText('snare.wav')
  })

  test('the Static table moves Static slots', async ({ page }) => {
    await openTab(page, 'Static')
    await dragRow(page, 1, 6)
    await expect.poll(() => calls(page, 'move_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'static', sources: [1], target: 6 },
    ])
    await expect(toast(page)).toHaveText(/S001 moved to S006/)
  })

  test('Move to slot... moves the right-clicked slot to the slot picked on the slider', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 2).click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Move to slot...' }).click()
    const slider = page.getByRole('slider', { name: 'Target slot' })
    await expect(slider).toHaveValue('2')
    await slider.fill('20')
    await expect(page.getByTestId('move-target').locator('.move-slot-card-slot')).toHaveText('F020')
    await expect(page.getByTestId('move-target').locator('.move-slot-card-holds')).toHaveText('empty')
    await slider.press('Enter')
    await expect.poll(() => calls(page, 'move_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', sources: [2], target: 20 },
    ])
    await expect(page.locator('.modal-overlay')).toHaveCount(0)
  })

  test('the Move to slot... slider drags with the mouse and arrow keys', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 2).click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Move to slot...' }).click()
    const slider = page.getByRole('slider', { name: 'Target slot' })
    const box = (await slider.boundingBox())!
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2)
    await expect(slider).toHaveValue('128')
    await expect(page.getByTestId('move-target').locator('.move-slot-card-slot')).toHaveText('F128')
    await expect(page.getByTestId('move-target').locator('.move-slot-card-holds')).toHaveText('empty')
    // Hovering the thumb names the slot it points at
    const tip = page.locator('.move-slot-thumb-tip')
    await page.mouse.move(box.x + box.width / 2, box.y - 60)
    await expect(tip).toBeHidden()
    await page.mouse.move(box.x + box.width - 11, box.y + box.height / 2)
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('F128')
    await slider.press('Home')
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('2')
    // Back on the slot itself, there is nothing to move
    await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeDisabled()
  })

  test('a Tidy in progress shows a spinning, blue-bordered notice until it is done', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.evaluate(() => { (window as any).__hold = true })
    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    const notice = toast(page)
    await expect(notice).toHaveText(/Sorting slots\.\.\./)
    await expect(notice).toHaveClass(/busy/)
    await expect(notice.locator('.fa-spinner.fa-spin')).toHaveCount(1)
    await expect(notice).toHaveCSS('border-top-color', 'rgb(56, 139, 253)')
    // Other notices start fading at 1.2 s; this one is still fully shown well after
    await page.waitForTimeout(2000)
    await expect(notice).toHaveCSS('opacity', '1')
    await page.evaluate(() => (window as any).__release())
    await expect(notice).toHaveText(/3 slots renumbered/)
    await expect(notice).not.toHaveClass(/busy/)
  })

  test('Tidy shows its orders two per row, with Only selected slots centred above', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 2).click()
    await row(page, 4).click({ modifiers: ['Shift'] })
    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    const boxes = await page.getByRole('radio').evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()))
    expect(boxes).toHaveLength(5)
    expect(boxes[1].top).toBe(boxes[0].top)
    expect(boxes[1].left).toBeGreaterThan(boxes[0].right)
    expect(boxes[2].top).toBeGreaterThan(boxes[0].bottom)
    const only = (await page.getByRole('checkbox', { name: /Only selected slots/ }).boundingBox())!
    const body = (await page.locator('.modal-body').boundingBox())!
    expect(Math.abs((only.x + only.width / 2) - (body.x + body.width / 2))).toBeLessThan(2)
    expect(only.y + only.height).toBeLessThanOrEqual(boxes[0].top)
  })

  test('the Move to slot... thumb tip stays inside the window at both ends', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 3).click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Move to slot...' }).click()
    const slider = page.getByRole('slider', { name: 'Target slot' })
    const box = (await slider.boundingBox())!
    const modal = (await page.locator('.modal-content').boundingBox())!
    const tip = page.locator('.move-slot-thumb-tip')
    for (const value of [1, 128]) {
      await slider.fill(String(value))
      await page.mouse.move(box.x + 11 + (box.width - 22) * (value - 1) / 127, box.y + box.height / 2)
      await expect(tip).toBeVisible()
      await expect(tip).toContainText(value === 1 ? 'F001' : 'F128')
      const t = (await tip.boundingBox())!
      expect(t.x).toBeGreaterThanOrEqual(modal.x)
      expect(t.x + t.width).toBeLessThanOrEqual(modal.x + modal.width)
    }
  })

  test('the Shortcuts & zoom window lists the sample slot shortcuts on the Flex tab', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.getByRole('button', { name: 'Shortcuts & zoom' }).click()
    const dialog = page.getByRole('dialog', { name: 'Shortcuts & zoom' })
    await expect(dialog.locator('h4')).toHaveText(['Sample slots', 'Sample preview', 'Project', 'Everywhere'])
    await expect(dialog).toContainText('Edit mode: move the selected slots')
  })

  test('Tidy without a selection sorts the whole list', async ({ page }) => {
    await openTab(page, 'Flex')
    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    await expect(page.locator('.modal-header')).toContainText(/closes the gaps/i)
    const choice = page.getByRole('radio', { name: 'File name (Z to A)' })
    await expect(choice).toHaveAttribute('title', /Z first/)
    await choice.click()
    await expect(choice).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await expect.poll(() => calls(page, 'sort_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', order: 'name-desc', selection: null },
    ])
    await expect(toast(page)).toHaveText(/3 slots renumbered, sorted by file name \(Z to A\)/)
    await expect(page.locator('.modal-overlay')).toHaveCount(0)
  })

  test('Tidy sorts a Shift run on its own by default', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 2).click()
    await row(page, 4).click({ modifiers: ['Shift'] })
    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    const only = page.getByRole('checkbox', { name: 'Only selected slots, F002 to F004' })
    await expect(only).toBeChecked()
    await expect(only).toHaveAttribute('title', /F002 to F004 among themselves/)
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await expect.poll(() => calls(page, 'sort_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', order: 'name-asc', selection: [2, 3, 4] },
    ])
  })

  test('Tidy with a Shift run sorts the whole list once unticked', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 2).click()
    await row(page, 4).click({ modifiers: ['Shift'] })
    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    const only = page.getByRole('checkbox', { name: 'Only selected slots, F002 to F004' })
    await only.uncheck()
    await expect(only).not.toBeChecked()
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await expect.poll(() => calls(page, 'sort_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', order: 'name-asc', selection: null },
    ])
  })

  test('Tidy with scattered picks sorts the whole list', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 1).click()
    await row(page, 3).click({ modifiers: ['Control'] })
    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    await expect(page.locator('.modal-content').getByRole('checkbox')).toHaveCount(0)
    await expect(page.locator('.modal-content')).not.toContainText('continuous run')
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await expect.poll(() => calls(page, 'sort_sample_slots')).toEqual([
      { path: '/test/TestProject', slotType: 'flex', order: 'name-asc', selection: null },
    ])
  })

  test('the Move to slot... slider pins the moving slot and maps the taken ones', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 3).click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Move to slot...' }).click()
    const slider = page.getByRole('slider', { name: 'Target slot' })
    // The pin sits where the thumb starts, on F003
    const pin = (await page.locator('.move-slot-source-marker').boundingBox())!
    const sliderBox = (await slider.boundingBox())!
    const thumbX = sliderBox.x + 11 + (sliderBox.width - 22) * (2 / 127)
    expect(Math.abs(pin.x + pin.width / 2 - thumbX)).toBeLessThan(1.5)
    // F1-F5 hold samples, so the strip's first five cells are taken
    const cells = page.locator('.move-slot-map > span')
    await expect(cells).toHaveCount(128)
    expect(await cells.evaluateAll(c => c.flatMap((el, i) => el.classList.contains('taken') ? [i + 1] : []))).toEqual([1, 2, 3, 4, 5])
  })

  test('Escape closes both windows without calling anything or leaving the project', async ({ page }) => {
    await openTab(page, 'Flex')
    await row(page, 2).click({ button: 'right' })
    await page.locator('.context-menu-item', { hasText: 'Move to slot...' }).click()
    await page.getByRole('slider', { name: 'Target slot' }).fill('9')
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-overlay')).toHaveCount(0)

    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    await page.getByRole('radio', { name: 'Duration (shortest first)' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-overlay')).toHaveCount(0)

    await page.getByRole('button', { name: 'Tidy', exact: true }).click()
    await page.getByRole('button', { name: 'Sort', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-overlay')).toHaveCount(0)

    expect(await calls(page, 'move_sample_slots')).toEqual([])
    expect(await calls(page, 'sort_sample_slots')).toEqual([])
    await expect(page.locator('.header-tab', { hasText: 'Flex' })).toBeVisible()
    expect(page.url()).toContain('/project')
  })
})
