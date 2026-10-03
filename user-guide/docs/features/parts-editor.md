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

- **SRC Page:** Configure the core parameters (Pitch, Start, Length, Rate, etc.) of selected machine (Flex, Static, Thru, Neighbor, etc). A Static or Flex track also shows which Sample Slot it plays - see [Changing the Sample a track plays](#changing-the-sample-a-track-plays) below.

![Parts Editor - SRC page](/img/screenshots/parts-editor-src.png)

- **AMP Page:** Adjust the envelope (Attack, Hold, Release), Volume, and Balance for the track, plus the mixer's own Track and Cue levels - see [Track and Cue levels](#track-and-cue-levels) below.

![Parts Editor - AMP page](/img/screenshots/parts-editor-amp.png)

- **FX1 & FX2 Pages:** Edit the two effect slots for each track.

![Parts Editor - FX page](/img/screenshots/parts-editor-fx.png)

- **LFO Pages:** Configure the three LFOs per track, including speed, depth, and destination.

![Parts Editor - LFO page](/img/screenshots/parts-editor-lfo.png)

#### Changing the Sample a track plays

On the SRC and ALL pages, a track running a Static or Flex machine shows the slot it plays in the track header, next to its machine type, as a labelled `SLOT F002` field - the same shape as the TRK and CUE controls on the other side. Only the slot number is shown: a filename in a header either truncates to nothing useful or shoves the rest of the row around. Hovering names the file, and the picker lists it in full.

The field is styled exactly like the TRK and CUE controls beside it - the same box, label and value, and the same change of look when Edit mode goes on. Only Edit mode makes it clickable, and the whole field is one button, so it shows a hand cursor throughout rather than a text caret over the number.

The header reads the same way on every page: the track and its levels on the left, what it plays and on what machine on the right.

In Edit mode, clicking it opens a Sample Slot picker built like the [Sample Slots](./sample-slots.md) pages:

- Only the loaded slots of that machine's own pool are listed - a Flex machine never offers Static slots, and the other way round.
- The slot the track already plays is tagged `Assigned` at the right of its row, and the list opens on it.
- Moving the selection loads that sample, and plays it when Auto-preview is on, through the same transport bar the Sample Slots pages use.
- The keys are the same ones: arrows move the selection, Space plays and pauses, Ctrl and the arrows scrub and set the volume, Shift+Enter toggles Auto-preview, Shift+L toggles Loop, and Ctrl+F focuses the search box.
- Enter assigns the selected slot, as does double-clicking a row or pressing Assign. Escape or Cancel closes the picker without changing anything.
- The window can be resized from its edges, like the Tools modals.
- Right-clicking a row opens a menu with Play, Open in file explorer and Copy path to clipboard. Play sounds the sample whatever Auto-preview is set to. The entries are greyed out for a slot holding no file.
- Escape closes one layer at a time: the context menu first, then the picker.

The assignment is per Part, which is what makes it useful: the same track can play a different sample in Part 1 and Part 2, and switching Part on the device switches the sample with it.

The slot for the pool the track is not currently using is preserved, so changing the machine type later finds the slot the device left there.

The field is read-only until Edit mode is on, and the change is saved the same way every other Part parameter is.

#### Un-assigning a sample

The row tagged `Assigned` carries one extra entry in its context menu: Un-assign.

The Octatrack has no "no sample" setting for a machine - a Flex or Static machine always names a slot, and you assign by picking one and pressing YES on the device. So Un-assign does the only thing that means: it points the track at the lowest-numbered empty slot of that pool, which is where a fresh project leaves every machine. The menu entry names that slot before you click it, and is greyed out in the rare case that all 128 slots hold a sample.

The slot still shows a number afterwards - that is the device's own model, not a quirk of the app.

### Recorder setup

Each audio track has a recorder buffer, and the REC tab shows its two setup pages exactly as the device lays them out.

SETUP 1 is what gets sampled: INAB and INCD choose which inputs are taken, RLEN how long the recording runs (up to MAX), TRIG how sampling starts and stops, SRC3 which internal source is recorded, and LOOP whether the captured sample loops.

SETUP 2 shapes it: FIN and FOUT fade the recording in and out, AB and CD set the monitoring levels of the two input pairs, and QREC and QPL quantise recording and playback. Those last two rest at OFF, which the device stores outside their ordinary range - the app keeps it rather than pulling it down to the nearest step count.

The setup belongs to the Part, like everything else on these pages, so the same track can sample differently in different Parts.

#### Track and Cue levels

The track header on the AMP and ALL pages carries TRK and CUE - the device's mixer levels for that track. They are not the AMP page's own VOL, which is a separate parameter in the grid below.

They sit in the header rather than in a parameter block because they belong to the track rather than to any one page: that way they show on the ALL page too, without adding a column that would unbalance the parameter grids.

They are stored per track and per Part - the same track can sit at a different level in Part 1 and Part 2 - and exist for every machine type, including Thru, Neighbor and Pickup tracks that play no sample at all.

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

<img src={require('@site/static/img/screenshots/parts-editor-reload.png').default} alt="Reload, Save, and Save All buttons" style={{width: '50%', display: 'block', margin: '0 auto'}} />

### 3. Saving to Part
To commit your edits to the Part:

- Click **Save** to commit the current part, or **Save All** to commit all modified parts in the bank at once.
- The **unsaved indicator** will disappear, and your changes are now final.

<img src={require('@site/static/img/screenshots/parts-editor-save.png').default} alt="Parts Editor Save Button" style={{width: '50%', display: 'block', margin: '0 auto'}} />

---

## Data Safety

:::warning
**Important:** Editing parts directly modifies your project files. While [automatic backups](../getting-started/quick-start.md#12-automatic-backups) provide a safety net, it’s strongly advised to keep your own copies of your projects as well.
:::

- **Check Your Bank:** Ensure you have selected the correct bank (A–P) before you start editing.
- **Commit Often:** Be sure to understand how the Octactrack works with changes - as the app works exactly the same way.
- **Back Up:** Always maintain a separate backup of your CF card or project folder.
