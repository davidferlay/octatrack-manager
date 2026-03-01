---
sidebar_position: 4
---

# Parts Editor

The Parts Editor lets you view and modify the sound design parameters of each part in a bank directly on your computer — without touching the Octatrack hardware.

![Parts editor — all pages overview](/img/screenshots/parts-editor.png)

:::warning Make a backup first
**Always make a backup copy of your project before editing any parameters.** The Parts Editor writes directly to your project files on disk. While changes can be reverted with **Reload Part**, a backup is your safety net against any unintended modifications.
:::

:::caution Input validation
There is currently **limited input validation** on parameter values. Entering out-of-range or nonsensical values may produce unexpected results on the Octatrack. Stick to the documented value ranges for each parameter. 👾
:::

## Opening the Parts Editor

The Parts Editor is embedded in the **Parts panel** on the Project Detail page. Select a bank using the Bank Selector, then click a **Part** tab (Part 1–4) to open that part's editor.

## Edit mode

By default, the Parts Editor is in **view-only mode** — all parameters are visible but cannot be modified.

To make changes, enable **Edit mode** by clicking the **Edit** toggle in the panel header. The interface updates to show interactive controls for all parameters.

:::info Expanding edit support
Edit mode is currently available for the **Parts tab** only. Support for editing other sections of the project will be added progressively in future releases.
:::

### How to change a value

Once Edit mode is enabled, every parameter can be modified in three ways:

| Method | How to use |
|--------|------------|
| **Type a number** | Click the value field and type a new number directly |
| **Drag the rotary knob** | Click and drag the knob up/down or left/right to sweep through values |
| **Arrow keys** | Focus a parameter and press <kbd>↑</kbd> / <kbd>↓</kbd> to increment or decrement the value |

### Auto-save as "unsaved" state

Editing in Octatrack Manager mirrors the **save/unsaved behaviour of the Octatrack itself**:

- Any change is **immediately and automatically written** to the part as an *unsaved* state
- The part tab displays an **asterisk \*** next to its name to indicate pending changes
- A **notification message** appears confirming the auto-save
- The **Reload Part** and **Save Part** buttons become active, giving you the choice to commit or discard

This means you can freely explore edits and revert them at any time with **Reload Part**, or permanently commit them with **Save Part**.

![Parts editor — unsaved state indicator](/img/screenshots/parts-editor-unsaved.png)

## Part tabs

Each bank has 4 parts. The part tabs show:

- **Part name** — custom name if set, otherwise "Part N"
- **\* (asterisk)** — appears next to the name when the part has unsaved changes

## Pages

The editor is organized into pages, accessible via tabs within each part. Audio tracks and MIDI tracks have different page sets.

### Audio track pages

| Page | Description |
|------|-------------|
| **ALL** | Overview of all parameters for the selected track |
| **SRC** | Source / machine parameters (parameters 1–6) |
| **AMP** | Amplitude and mixer settings |
| **LFO** | Three LFO editors |
| **FX1** | Effects slot 1 parameters |
| **FX2** | Effects slot 2 parameters |

### MIDI track pages

| Page | Description |
|------|-------------|
| **ALL** | Overview of all MIDI parameters |
| **NOTE** | Note, velocity, length, and multi-note settings |
| **ARP** | Arpeggiator settings |
| **LFO** | Three LFO editors |
| **CTRL1** | MIDI controller 1 assignments |
| **CTRL2** | MIDI controller 2 assignments |

## Track selector

![Parts editor — bank selector](/img/screenshots/parts-editor-bank-selector.png)

![Parts editor — track selector](/img/screenshots/parts-editor-track-selector.png)

Use the **Track Selector** (T1–T8 for audio, M1–M8 for MIDI) to choose which track's parameters are displayed in the editor. Multi-select is supported — selecting multiple tracks shows parameters that are shared or useful for comparison.

## Parameter reference

### SRC page (audio tracks)

The Source page shows the 6 machine-specific parameters for the selected track. Parameter names and ranges depend on the machine type assigned to the track (e.g., Flex Machine, Static Machine, Thru Machine, Neighbor Machine, Pickup Machine).

| Parameter | Description |
|-----------|-------------|
| **P1–P6** | Machine-specific parameters (name and range vary by machine) |

### AMP page (audio tracks)

![Parts editor — AMP page, all audio tracks](/img/screenshots/parts-editor-amp.png)

| Parameter | Range | Description |
|-----------|-------|-------------|
| **ATK** (Attack) | 0–127 | Amplitude envelope attack time |
| **HOLD** | 0–127 | Amplitude envelope hold time |
| **REL** (Release) | 0–127 | Amplitude envelope release time |
| **VOL** (Volume) | 0–127 | Track volume |
| **BAL** (Balance) | 0–127 | Pan / stereo balance |
| **F** (Filter) | 0–127 | Filter cutoff |

### LFO page (audio and MIDI tracks)

![Parts editor — LFO page, edit mode](/img/screenshots/parts-editor-lfo.png)

Three independent LFOs are available (LFO1, LFO2, LFO3). Each has its own sub-tab:

| Parameter | Description |
|-----------|-------------|
| **Speed** | LFO rate |
| **Depth** | LFO modulation depth |
| **Waveform** | LFO shape (sine, triangle, square, sawtooth, random, etc.) |

#### LFO Designer

![Parts editor — LFO Designer](/img/screenshots/parts-editor-lfo-designer.png)

Each LFO includes a **Designer** box — a graphical waveform display that doubles as an editor. In **Edit mode**, you can draw a completely custom LFO shape by clicking and dragging freely inside the designer box with your mouse.

- **Click and drag** anywhere in the box to sculpt the waveform shape
- The curve updates in real time as you draw
- The result is a custom waveform that will be used by that LFO on the Octatrack

This is equivalent to the LFO Designer feature on the Octatrack hardware itself.

### FX1 / FX2 pages (audio tracks)

Shows parameters for the two effects slots:

| Parameter | Description |
|-----------|-------------|
| **Effect type** | Which effect is loaded in this slot |
| **Parameters** | Effect-specific parameters (vary by effect type) |

### NOTE page (MIDI tracks)

![Parts editor — NOTE page, all MIDI tracks](/img/screenshots/parts-editor-notes.png)

| Parameter | Description |
|-----------|-------------|
| **Note** | MIDI note number |
| **Velocity** | MIDI velocity |
| **Length** | Note length |
| **Note 2–4** | Additional notes for multi-note chords |

### ARP page (MIDI tracks)

Arpeggiator settings for the MIDI track.

### CTRL1 / CTRL2 pages (MIDI tracks)

![Parts editor — CTRL1 page, all MIDI tracks, edit mode](/img/screenshots/parts-editor-ctrl1.png)

MIDI controller assignment pages for sending CC values.

## Parameter locks

Parameter locks allow individual steps in a pattern to override the part's default values. The Parts Editor displays per-step lock data alongside the part parameters. Locks are shown as overrides for:

- Machine parameters (SRC locks)
- Amp parameters (AMP locks)
- LFO parameters (LFO locks)
- Static / Flex slot assignments (slot locks)
- MIDI note, velocity, and length (MIDI locks)

## Saving changes

The editor provides three save actions:

| Action | Description |
|--------|-------------|
| **Save Part** | Commits changes for the currently selected part (copies `parts.unsaved` → `parts.saved`) |
| **Save All Parts** | Commits changes for all 4 parts in the current bank |
| **Reload Part** | Discards unsaved changes and reverts the part to its last saved state |

![Parts editor — save button](/img/screenshots/parts-editor-save.png)

![Parts editor — reload button](/img/screenshots/parts-editor-reload.png)

Changes are auto-saved to a temporary file (`parts.unsaved`) as you edit, using debouncing to avoid excessive writes. You must click **Save Part** or **Save All Parts** to permanently commit changes.

:::tip
Use **Save All Parts** before making a backup copy of a project to ensure all edited parts are written to the project files.
:::

## Modified indicator

When a part has unsaved changes, the part tab shows an **\*** asterisk next to the part name, and notification messages appear at the bottom of the editor. This indicator disappears after saving or reloading.

## All Banks mode

When the **All Banks** option is selected, the editor shows the same part number across all 16 banks simultaneously. This is useful for comparing or batch-editing the same part slot across your entire project set.
