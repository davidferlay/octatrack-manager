import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlotPickerModal } from './SlotPickerModal'
import type { SlotChoice } from './PartsPanel'

/** 128 slots, with samples in the ones named - the shape the backend always returns. */
function pool(samples: Record<number, string>): SlotChoice[] {
  return Array.from({ length: 128 }, (_, i) => ({
    slot_id: i + 1,
    path: samples[i + 1] ?? null,
  }))
}

const slots = pool({ 1: '../AUDIO/kick.wav', 2: '../AUDIO/snare.wav', 5: '../AUDIO/hat.wav' })

/**
 * Renders the picker and lets its audio-preview effect settle. The effect loads the
 * sample under the cursor, so without the flush every test logs an act() warning for
 * a state update it never asked for.
 */
async function renderPicker(props: Partial<Parameters<typeof SlotPickerModal>[0]> = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const onClearCurrentSlot = vi.fn()
  render(
    <SlotPickerModal
      pool="Flex"
      slots={slots}
      currentSlotId={0}
      projectPath="/set/MyProject"
      trackLabel="T1"
      partLabel="Part 1"
      onPick={onPick}
      onClearCurrentSlot={onClearCurrentSlot}
      onClose={onClose}
      {...props}
    />,
  )
  await act(async () => {})
  return { onClearCurrentSlot, onPick, onClose }
}

/**
 * The slot table. Queries are scoped to it because the transport bar below also
 * shows the loaded sample's name, so a bare getByText matches twice.
 */
const table = () => document.querySelector('.slot-picker-list') as HTMLElement
const row = (filename: string) => within(table()).getByText(filename).closest('tr')!

/** Right-clicks a row and returns the menu that opens on it. */
async function menuOn(filename: string) {
  fireEvent.contextMenu(row(filename))
  // Right-clicking also selects, which reloads the preview - let that settle
  await act(async () => {})
  return document.querySelector('.context-menu') as HTMLElement
}

beforeEach(() => vi.clearAllMocks())

describe('the slot list', () => {
  it('lists the loaded slots of that pool only', async () => {
    await renderPicker()
    expect(screen.getAllByRole('row')).toHaveLength(4) // header + 3 loaded slots
    expect(within(table()).getByText('kick.wav')).toBeInTheDocument()
    expect(within(table()).getByText('hat.wav')).toBeInTheDocument()
  })

  it('numbers the slots the way the device does, with the pool prefix', async () => {
    await renderPicker()
    expect(screen.getByText('F001')).toBeInTheDocument()
    expect(screen.getByText('F005')).toBeInTheDocument()
    expect(screen.queryByText('F004')).not.toBeInTheDocument()
  })

  it('uses the Static prefix for a Static machine', async () => {
    await renderPicker({ pool: 'Static' })
    expect(screen.getByText('S001')).toBeInTheDocument()
  })

  it('tags the slot the track already plays', async () => {
    await renderPicker({ currentSlotId: 1 })
    const tagged = within(table()).getByText('Assigned').closest('tr')!
    expect(tagged).toHaveTextContent('F002')
    expect(tagged).toHaveTextContent('snare.wav')
  })

  it('still offers the assigned slot when its sample was cleared', async () => {
    await renderPicker({ currentSlotId: 41 })
    const empty = row('(empty)')
    expect(empty).toHaveTextContent('F042')
    expect(within(empty as HTMLElement).getByText('Assigned')).toBeInTheDocument()
  })

  it('says so when a search matches nothing', async () => {
    await renderPicker()
    await userEvent.type(screen.getByPlaceholderText('Search...'), 'tuba')
    expect(within(table()).getByText('No slot matches that search')).toBeInTheDocument()
  })

  it('searches on the filename and on the slot label', async () => {
    await renderPicker()
    const search = screen.getByPlaceholderText('Search...')
    await userEvent.type(search, 'sna')
    expect(within(table()).getByText('snare.wav')).toBeInTheDocument()
    expect(within(table()).queryByText('kick.wav')).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'F005')
    expect(within(table()).getByText('hat.wav')).toBeInTheDocument()
    expect(within(table()).queryByText('kick.wav')).not.toBeInTheDocument()
  })

  it('counts what is shown against what there is', async () => {
    await renderPicker()
    expect(screen.getByText(/showing 3 of 3 slots/)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Search...'), 'sna')
    expect(screen.getByText(/showing 1 of 3 slots/)).toBeInTheDocument()
  })

  it('names the track and the Part it is editing', async () => {
    await renderPicker({ trackLabel: 'T4', partLabel: 'Part 3' })
    expect(screen.getByText(/T4 - Part 3/)).toBeInTheDocument()
  })

  it('sorts by sample name, and reverses on a second click', async () => {
    await renderPicker()
    await userEvent.click(screen.getByText(/^Sample/))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('hat.wav')
    await userEvent.click(screen.getByText(/^Sample/))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('snare.wav')
  })

  it('opens sorted by slot, and the Slot header reverses it', async () => {
    await renderPicker()
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('F001')
    await userEvent.click(screen.getByText(/^Slot/))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('F005')
    await userEvent.click(screen.getByText(/^Slot/))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('F001')
  })
})

describe('choosing a slot', () => {
  it('assigns on double-click, passing the slot 0-based as the machine stores it', async () => {
    const { onPick, onClose } = await renderPicker()
    await userEvent.dblClick(row('hat.wav'))
    expect(onPick).toHaveBeenCalledWith(4) // F005
    expect(onClose).toHaveBeenCalled()
  })

  it('assigns the selected row from the Assign button', async () => {
    const { onPick } = await renderPicker()
    await userEvent.click(row('snare.wav'))
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('Cancel changes nothing', async () => {
    const { onPick, onClose } = await renderPicker()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('the row context menu', () => {
  it('offers Play, reveal and copy on an ordinary row', async () => {
    await renderPicker()
    const menu = await menuOn('snare.wav')
    expect(within(menu).getByText('Play')).toBeInTheDocument()
    expect(within(menu).getByText('Open in file explorer')).toBeInTheDocument()
    expect(within(menu).getByText('Copy path to clipboard')).toBeInTheDocument()
    expect(within(menu).queryByText('Un-assign')).not.toBeInTheDocument()
  })

  it('greys out every file entry for a slot holding nothing', async () => {
    await renderPicker({ currentSlotId: 41 })
    const menu = await menuOn('(empty)')
    for (const label of ['Play', 'Open in file explorer', 'Copy path to clipboard']) {
      expect(within(menu).getByText(label).closest('button')).toBeDisabled()
    }
  })
})

describe('Un-assign', () => {
  it('is offered on the assigned row, under Play', async () => {
    await renderPicker({ currentSlotId: 0 })
    const menu = await menuOn('kick.wav')
    const items = within(menu).getAllByRole('button')
    expect(items.map(b => b.textContent?.trim())).toEqual([
      'Play', 'Un-assign', 'Open in file explorer', 'Copy path to clipboard',
    ])
    expect(menu.querySelectorAll('.context-menu-separator')).toHaveLength(2)
  })

  it('points the track at the lowest-numbered empty slot of that pool', async () => {
    const { onPick, onClose } = await renderPicker({ currentSlotId: 0 })
    const menu = await menuOn('kick.wav')
    await userEvent.click(within(menu).getByText('Un-assign'))
    // Slots 1 and 2 hold samples, so slot 3 is the first free one - 2 zero-based
    expect(onPick).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalled()
  })

  it('names that slot before it is clicked', async () => {
    await renderPicker({ currentSlotId: 0 })
    const menu = await menuOn('kick.wav')
    expect(within(menu).getByText('Un-assign').closest('button'))
      .toHaveAttribute('title', expect.stringContaining('F003'))
  })

  it('is not offered on a row the track does not play', async () => {
    await renderPicker({ currentSlotId: 0 })
    expect(within(await menuOn('hat.wav')).queryByText('Un-assign')).not.toBeInTheDocument()
  })

  it('is not offered when the assigned slot already holds nothing', async () => {
    await renderPicker({ currentSlotId: 41 })
    expect(within(await menuOn('(empty)')).queryByText('Un-assign')).not.toBeInTheDocument()
  })

  /**
   * With no empty slot to move to, the only way to leave the track playing nothing is
   * to empty the slot it is on - which is what the device does. The track is not moved,
   * so the bank is untouched and only the pool is written.
   */
  describe('when every slot in the pool is taken', () => {
    const full = () => pool(Object.fromEntries(
      Array.from({ length: 128 }, (_, i) => [i + 1, `../AUDIO/s${i + 1}.wav`]),
    ))

    it('is still offered', async () => {
      await renderPicker({ slots: full(), currentSlotId: 0 })
      const entry = within(await menuOn('s1.wav')).getByText('Un-assign').closest('button')!
      expect(entry).toBeEnabled()
    })

    it('empties the slot the track is on, instead of moving the track', async () => {
      const { onPick, onClearCurrentSlot, onClose } = await renderPicker({
        slots: full(), currentSlotId: 0,
      })
      const menu = await menuOn('s1.wav')
      await userEvent.click(within(menu).getByText('Un-assign'))
      expect(onClearCurrentSlot).toHaveBeenCalled()
      expect(onPick).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('says which slot it will empty, and what that costs', async () => {
      await renderPicker({ slots: full(), currentSlotId: 0 })
      const entry = within(await menuOn('s1.wav')).getByText('Un-assign').closest('button')!
      expect(entry).toHaveAttribute('title', expect.stringContaining('empties F001'))
      expect(entry).toHaveAttribute('title', expect.stringContaining('loses its sample too'))
    })

    it("empties the track's own slot, not the first one", async () => {
      const { onClearCurrentSlot } = await renderPicker({ slots: full(), currentSlotId: 41 })
      const menu = await menuOn('s42.wav')
      const entry = within(menu).getByText('Un-assign').closest('button')!
      expect(entry).toHaveAttribute('title', expect.stringContaining('empties F042'))
      await userEvent.click(entry)
      expect(onClearCurrentSlot).toHaveBeenCalled()
    })
  })

  it('moves the track rather than emptying anything while the pool has room', async () => {
    const { onPick, onClearCurrentSlot } = await renderPicker({ currentSlotId: 0 })
    await userEvent.click(within(await menuOn('kick.wav')).getByText('Un-assign'))
    expect(onPick).toHaveBeenCalledWith(2)
    expect(onClearCurrentSlot).not.toHaveBeenCalled()
  })
})
