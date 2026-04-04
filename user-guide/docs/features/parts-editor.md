---
sidebar_position: 5
---

# Parts Editor

The Parts Editor is the heart of sound design in Octatrack Manager. It allows to modify the four Parts ("snapshots" or "kits") available in each bank, giving you a powerful interface for tweaking machine parameters, effects, and LFOs.

![Parts Editor](/img/screenshots/parts-editor.png)

## Enabling Edit Mode

By default, Octatrack Manager is in a safe, read-only mode to prevent accidental changes. To start editing:

1. Open a project.
2. Go to the **Parts** tab.
3. Toggle the **Edit mode** switch in the project header.

When Edit Mode is active, the knobs and fields become interactive, and your changes will be written to disk.

Note that in the future, more than Parts will be editable in projects.

![View/Edit mode toggle](/img/screenshots/parts-editor-toggle.png)


---

### Navigation Within the Editor

Use the PAGE tabs to switch between the different parameter pages (SRC, AMP, LFO, etc). 

Both your parameter page selection and part selection persist when switching between banks, so you can quickly compare the same page across different banks. 

The dropdown fields let you switch quickly between all Audio tracks, MIDI tracks, partrs and the 16 banks.

---

## Modifying Part Settings

The Parts Editor is organized into several pages, mirroring exactly the Octatrack. Although here we can display much more information on screen.

### Audio Track Pages (T1–T8)

- **SRC Page:** Configure the core parameters (Pitch, Start, Length, Rate, etc.) of selected machine (Flex, Static, Thru, Neighbor, etc).

![Parts Editor - SRC page](/img/screenshots/parts-editor-src.png)

- **AMP Page:** Adjust the envelope (Attack, Hold, Release), Volume, and Balance for the track.

![Parts Editor - AMP page](/img/screenshots/parts-editor-amp.png)

- **FX1 & FX2 Pages:** Edit the two effect slots for each track.

![Parts Editor - FX page](/img/screenshots/parts-editor-fx.png)

- **LFO Pages:** Configure the three LFOs per track, including speed, depth, and destination.

![Parts Editor - LFO page](/img/screenshots/parts-editor-lfo.png)

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

![Unsaved indicator on part tab](/img/screenshots/parts-editor-unsaved.png)

### 2. Reloading a Part
Live changes made can easily be discarded; allowing you to return to the last saved state of Part:

- Click the **Reload** button in the bank header.
- This will clear the unsaved changes.

![Reload, Save, and Save All buttons](/img/screenshots/parts-editor-reload.png)

### 3. Saving to Part
To commit your edits to the Part:

- Click **Save** to commit the current part, or **Save All** to commit all modified parts in the bank at once.
- The **unsaved indicator** will disappear, and your changes are now final.

![Parts Editor Save Button](/img/screenshots/parts-editor-save.png)

---

## Data Safety

:::warning
**Important:** Editing parts directly modifies your project files. While [automatic backups](../getting-started/quick-start.md#7-automatic-backups) provide a safety net, it’s strongly advised to keep your own copies of your projects as well.
:::

- **Check Your Bank:** Ensure you have selected the correct bank (A–P) before you start editing.
- **Commit Often:** Be sure to understand how the Octactrack works with changes - as the app works exactly the same way.
- **Back Up:** Always maintain a separate backup of your CF card or project folder.
