---
sidebar_position: 5
sidebar_label: Edit Parts
---

# Edit Parts

The Parts Editor is the heart of sound design in Octatrack Manager. It allows to modify the four Parts ("snapshots" or "kits") available in each bank, giving you a powerful interface for tweaking machine parameters, effects, and LFOs.

![Parts Editor](/img/screenshots/parts-editor.png)

## Enabling Edit Mode

By default, Octatrack Manager is in a safe, read-only mode to prevent accidental changes. To start editing:

1. Open a project.
2. Go to the **Parts** tab.
3. Toggle the **Edit mode** switch in the project header.

When Edit Mode is active, the knobs and fields become interactive, and your changes will be written to disk.

Note that in the future, more than Parts will be editable in projects.

<img src={require('@site/static/img/screenshots/parts-editor-toggle.png').default} alt="View/Edit mode toggle" style={{width: '64%', display: 'block', margin: '0 auto'}} />


---

### Navigation Within the Editor

Use the PAGE tabs to switch between the different parameter pages (SRC, AMP, LFO, etc).

Both your parameter page selection and part selection persist when switching between banks, so you can quickly compare the same page across different banks.

The dropdown fields let you switch quickly between all Audio tracks, MIDI tracks, partrs and the 16 banks.

---

## Modifying Part Settings

The Parts Editor is organized into several pages, mirroring exactly the Octatrack. Although here we can display much more information on screen.

### Audio Track Pages (T1–T8)

- **SRC Page:** Configure the core parameters (Pitch, Start, Length, Rate, etc.) of selected machine (Flex, Static, Thru, Neighbor, etc). The machine itself can be changed from the track header - see [Changing a track's machine](#changing-a-tracks-machine) below. A Static or Flex track also shows which Sample Slot it plays - see [Changing the Sample a track plays](#changing-the-sample-a-track-plays) below.

![Parts Editor - SRC page](/img/screenshots/parts-editor-src.png)

- **AMP Page:** Adjust the envelope (Attack, Hold, Release), Volume, and Balance for the track, plus the mixer's own Track and Cue levels - see [Track and Cue levels](#track-and-cue-levels) below.

![Parts Editor - AMP page](/img/screenshots/parts-editor-amp.png)

- **FX1 & FX2 Pages:** Edit the two effect slots for each track. The effect loaded in a slot can be changed from its heading - see [Changing a track's effects](#changing-a-tracks-effects) below.

![Parts Editor - FX page](/img/screenshots/parts-editor-fx.png)

- **LFO Pages:** Configure the three LFOs per track, including speed, depth, and destination.

![Parts Editor - LFO page](/img/screenshots/parts-editor-lfo.png)

#### Changing a track's machine

In Edit mode, the machine badge in the track header (STATIC, FLEX, THRU, NEIGHBOR, PICKUP) becomes a selector. The machine is per Part, so a track can run Flex in Part 1 and Thru in Part 2.

- Switching machine resets the track's SRC MAIN and SETUP pages to the new machine's defaults, as each machine reads those slots differently (the second slot is STRT on Flex but DIR on Pickup). Switching back resets them again: use [Undo](./undo-redo.md) or Reload Part to recover from a mistake.
- T1 and T5 cannot run a Neighbor machine: Neighbor takes its audio from the previous track, and these are the first of their group of four (Octatrack manual, section A.4).

#### Changing a track's effects

In Edit mode, the effect name in an FX heading (`MAIN - FILTER` on FX1/FX2, `FX1 - FILTER` on ALL) becomes a selector listing OFF and the 14 effects, in the device's order.

- Loading an effect resets that block's parameters to the effect's defaults, as on the Octatrack.
- The parameter help and the LFO target names follow the loaded effect: an LFO on a filter's BASE reads `FLTR BASE`, and `PLTE TIME` once a plate reverb is loaded.

#### Changing the Sample a track plays

On the SRC and ALL pages, a Static or Flex track shows its slot in the track header (e.g. `SLOT F002`). Hover it to see the file name. In Edit mode, click it to open a Sample Slot picker that works like the [Sample Slots](./sample-slots.md) pages:

- Only loaded slots of the machine's own pool (Flex or Static) are listed, and the list opens on the slot tagged `Assigned`.
- Same preview and keys as the Sample Slots pages: arrows to move, <kbd>Space</kbd> to play, <kbd>Shift</kbd> + <kbd>Enter</kbd> for Auto-preview, <kbd>Shift</kbd> + <kbd>L</kbd> for Loop, <kbd>Ctrl</kbd> + <kbd>F</kbd> to search.
- <kbd>Enter</kbd>, double-click or Assign assigns the slot; <kbd>Escape</kbd> or Cancel closes without changes.
- Right-click a row for Play, Open in file explorer and Copy path to clipboard.

The assignment is per Part, and the slot of the pool the track is not using is preserved for when the machine changes back.

#### Un-assigning a sample

Right-click the `Assigned` row and choose Un-assign. The Octatrack has no "no sample" setting, so this points the track at the lowest-numbered empty slot of that pool, as a fresh project does. The menu entry names that slot, and is greyed out if all 128 slots are used.

### Recorder setup

The REC tab shows each audio track's two recorder setup pages, per Part, as the device lays them out:

- SETUP 1, what gets sampled: INAB / INCD (inputs), RLEN (length), TRIG (start/stop), SRC3 (internal source), LOOP.
- SETUP 2, how: FIN / FOUT (fades), AB / CD (input monitoring levels), QREC / QPL (quantisation, OFF by default).

#### Track and Cue levels

The track header on the AMP and ALL pages carries TRK and CUE, the device's mixer levels for that track (separate from the AMP page's VOL). They are stored per track and per Part, for every machine type.

### MIDI Track Pages (M1–M8)

- **NOTE Page:** Edit the MIDI channel, notes, velocity, and length for external sequencing.

![Parts Editor - MIDI Notes page](/img/screenshots/parts-editor-notes.png)

- **ARP Page:** Adjust the arpeggiator settings (Transpose, Legato, Mode, Speed, Range, Length).

![Parts Editor - MIDI Arp page](/img/screenshots/parts-editor-arp.png)

- **LFO Pages:** Adjust the three MIDI LFOs, draw custom LFO shapes.

![Parts Editor - MIDI LFO page](/img/screenshots/parts-editor-midi-lfo.png)

- **CTRL Pages:** Configure the MIDI CC parameters for external gear control.

![Parts Editor - MIDI CTRL1 page](/img/screenshots/parts-editor-ctrl1.png)


---

## Custom LFO Designer

Octatrack Manager features an intuitive **LFO Designer** that allows you to draw custom LFO waveforms - **freely with your mouse**.

1. Navigate to a track's LFO page.
2. Select the **DESIGN** tab.
3. Click and drag in the editor to draw your waveform.
4. The changes are updated in real-time in the project.


![LFO Designer edition](/img/screenshots/parts-editor-lfo-designer-edition.png)

![LFO Designer](/img/screenshots/parts-editor-lfo-designer.png)

---

## Saving and Committing Changes

Octatrack Manager follows the same **two-step process** for saving changes, **mirroring exactly** how the Octatrack works.

### 1. Live Editing
As you move a knob or change a setting, the change is **immediately written to project's Part**. Your edits are stored in the Parts's working state and will be persisted.

- An **unsaved indicator** (asterisk) will appear next to the part name to show that it contains uncommitted changes. Exactly like on the Octatrack.

<img src={require('@site/static/img/screenshots/parts-editor-unsaved.png').default} alt="Unsaved indicator on part tab" style={{width: '56%', display: 'block', margin: '0 auto'}} />

### 2. Reloading a Part
Live changes made can easily be discarded; allowing you to return to the last saved state of Part:

- Click the **Reload** button in the bank header.
- This will clear the unsaved changes.

To take back only the last few changes rather than everything since the last Save, use [Undo](./undo-redo.md) instead.

<img src={require('@site/static/img/screenshots/parts-editor-reload.png').default} alt="Reload, Save, and Save All buttons" style={{width: '50%', display: 'block', margin: '0 auto'}} />

### 3. Saving to Part
To commit your edits to the Part:

- Click **Save** to commit the current part, or **Save All** to commit all modified parts in the bank at once.
- The **unsaved indicator** will disappear, and your changes are now final.

<img src={require('@site/static/img/screenshots/parts-editor-save.png').default} alt="Parts Editor Save Button" style={{width: '50%', display: 'block', margin: '0 auto'}} />

---

## Data Safety

:::warning
**Important:** Editing parts directly modifies your project files. While [automatic backups](../getting-started/quick-start.md#automatic-backups) provide a safety net, it’s strongly advised to keep your own copies of your projects as well.
:::

- **Check Your Bank:** Ensure you have selected the correct bank (A–P) before you start editing.
- **Commit Often:** Be sure to understand how the Octactrack works with changes - as the app works exactly the same way.
- **Back Up:** Always maintain a separate backup of your CF card or project folder.
