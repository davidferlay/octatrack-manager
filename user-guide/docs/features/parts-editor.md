---
sidebar_position: 5
---

# Parts Editor

The Parts Editor is the heart of your sound design in Octatrack Manager. It allows you to modify the four "snapshots" (kits) available in each bank, giving you a powerful interface for tweaking machine parameters, effects, and LFOs.

![Parts Editor](/img/screenshots/parts-editor.png)

## Enabling Edit Mode

By default, Octatrack Manager is in a safe, read-only mode to prevent accidental changes. To start editing:

1. Open a project.
2. Go to the **Parts** tab.
3. Toggle the **Edit mode** switch in the project header.

When Edit Mode is active, the knobs and fields become interactive, and your changes will be written to disk.

---

## Modifying Part Settings

The Parts Editor is organized into several pages, similar to the hardware interface but displayed with much more detail.

### Audio Track Pages (T1–T8)

- **Machine Page:** Select and configure the machine type (e.g., Flex, Static, Thru, Neighbor) and its six core parameters (Pitch, Start, Length, Rate, etc.).
- **Amp Page:** Adjust the envelope (Attack, Hold, Release), Volume, and Balance for the track.
- **FX1 & FX2 Pages:** Edit the two effect slots for each track. All Octatrack effects are supported, from Delay and Reverb to Filter and Compressor.
- **LFO Pages:** Configure the three LFOs per track, including speed, depth, and destination.

### MIDI Track Pages (M1–M8)

- **MIDI Page:** Edit the MIDI channel, notes, velocity, and length for external sequencing.
- **LFO Pages:** Adjust the three MIDI LFOs.

### Navigation Within the Editor

Use the tabs at the bottom of the track panel to switch between the different parameter pages (Machine, LFO, Amp, FX1, FX2). Both your parameter page selection and part selection persist when switching between banks, so you can quickly compare the same page across different banks.

---

## Custom LFO Designer

Octatrack Manager features a powerful **LFO Designer** that allows you to draw custom LFO waveforms freely with your mouse.

1. Navigate to a track's LFO page.
2. Select the **DESIGN** tab.
3. Click and drag in the editor to draw your waveform.
4. The changes are updated in real-time in the project.

![LFO Designer](/img/screenshots/parts-editor-lfo-designer.png)

---

## Saving and Committing Changes

Octatrack Manager follows a safe, two-step process for saving changes, mirroring how the Octatrack works internally.

### 1. Automatic "Unsaved" Save
As you move a knob or change a setting, the app automatically writes the change to an **`.unsaved`** file on your disk. This ensures that your work is not lost if the app closes unexpectedly.

- An **unsaved indicator** (circle icon) will appear next to the bank name in the editor to show that it contains uncommitted changes.

### 2. Committing to the Project
To make your changes permanent and readable by the Octatrack hardware:

- Click the **Save** (diskette) icon in the bank header.
- The app will copy the data from the `.unsaved` file into the actual project file (`bankXX.work`).
- The **unsaved indicator** will disappear, and your changes are now final.

![Parts Editor Save Button](/img/screenshots/parts-editor-save.png)

### Reloading a Part
If you have made changes but want to discard them and return to the last saved state:

- Click the **Reload** (arrow) icon in the bank header.
- This will overwrite your unsaved changes with the data from the last committed project file.

---

## Data Safety Tips

:::warning
**Important:** Editing parts directly modifies your project files on disk. While the app uses a safe "unsaved" system, we highly recommend keeping a backup of your project before making significant changes.
:::

- **Check Your Bank:** Ensure you have selected the correct bank (A–P) before you start editing.
- **Commit Often:** Once you are happy with your sound design, commit your changes so you don't lose track of your progress.
- **Back Up:** Always maintain a separate backup of your CF card or project folder.
