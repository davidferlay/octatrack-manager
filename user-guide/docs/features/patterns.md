---
sidebar_position: 6
sidebar_label: View Patterns
---

# View Patterns

The Patterns tab provides a visual representation of the sequencer data. It allows to inspect triggers, parameter locks, and trig conditions of every step in projects - all at a glance.

![Patterns - Track Settings](/img/screenshots/patterns-audio-tracks-bis.png)

## Visualizing Triggers

Each pattern is displayed as a grid of steps. It matches the global or per-track length defined in Scale Setup menu of the Octatrack.

### Trig Types
- **Trigger:** Solid orange circle. A traditional sequencer trigger.
- **One-Shot:** Solid yellow circle. A trigger that plays only once, until re-armed.
- **Trigless:** Solid green circle. A trigger that changes parameters but does not restart the sample envelope.
- **Lock:** Outlined green circle. A trigless lock (lock trig) that holds parameter locks without triggering anything.
- **P-Lock:** Indicated by the letter **P** (or a count like **3P**). Shows that one or more parameter locks are present on that step. A step whose only lock is a sample lock shows **S** alone, without **P**.

### Specialized Indicators
- **/:** Slide trigger.
- **R:** Recorder trigger, shown in red - or in yellow when the recorder trig is One-Shot.
- **%:** Trig Condition (e.g., Fill, 50%).
- **X:** Trig Repeats.
- **µ:** Micro-timing offset.
- **V:** Velocity or Volume lock.
- **S:** Sample slot lock.
- **Swing:** A green wave icon indicates that a swing trig is active on that step. Swing trigs are hidden when the track's swing amount is 50 (the default), since they have no effect.

---

## Filtering Indicators

With every trig type, lock and modifier displayed at once, busy patterns can get dense. Things can be filtered out using two complementary filters:

- **Global filter:** The **Show:** chip row at the top of the tab lists every indicator. Click a chip to hide or show that indicator in **all patterns**; use **All** / **None** to toggle everything at once. Hidden chips appear dimmed. This filter is remembered across sessions.
- **Per-pattern filter:** The legend badges below each pattern grid are clickable too. Clicking one hides that indicator in **that pattern only** (click again to restore). These per-pattern choices last until the page is reloaded.

An indicator is displayed only if it is enabled both globally and in the pattern's legend. Indicators hidden globally are removed from the legends entirely.

---

## Detailed Step Inspection

Click on any step in the grid to open the **Parameter Details Panel**. This panel shows you every single piece of data associated with that specific trigger.

- **Notes & Chords:** For MIDI tracks, it shows the exact notes and even detects common chord types.
- **P-Lock Values:** Lists every parameter lock and its exact value.
- **Slices:** When the track's machine has **SLIC** enabled and its sample is sliced, a **STRT** lock selects a slice - the panel shows the slice number (**STRT (Slice)**) instead of the raw start value.
- **Micro-timing:** Shows the precise offset (+1/32 for instance).

![Patterns - Parameter Details](/img/screenshots/patterns-details.png)

![Patterns - Parameter Details](/img/screenshots/patterns-details-2.png)

![Patterns - Parameter Details](/img/screenshots/patterns-details-3.png)

When viewing all patterns at once, each track's triggers are displayed across multiple rows with full indicator detail:

![Patterns - All Patterns multi-track view](/img/screenshots/patterns-details-bis.png)

:::tip
**Hide Empty:** Toggle the **Hide empty** switch in the header to focus only on patterns that contain triggers.
:::

### Keyboard Navigation

Once a step is selected, you can move through the pattern from the keyboard:

- <kbd>←</kbd> / <kbd>→</kbd> or <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>: previous / next step.
- <kbd>↑</kbd> / <kbd>↓</kbd>: jump a full page row (16 steps) up or down.
- <kbd>Esc</kbd>: close the details panel.

When viewing a single pattern, moving past its last step continues into the next pattern (and moving before step 1 goes back to the previous one), so you can walk through a whole bank without touching the mouse.

---

## Pattern Navigation

- **Single Pattern:** Select a specific pattern (1–16) from the selector.
- **All Patterns:** View all sequences in a bank at once by selecting **All** from the pattern selector.

---

## Track Settings

Toggle **Track settings** in the header to see the configuration for each track within the bank.

This section shows:
- **Swing:** The swing amount (%) for each track.
- **Trig Mode:** The track's trig mode (e.g., Plays Free, One-Shot).
- **Quantization:** The trig quantization settings.
- **Start Silent:** Whether the track starts silently.

![Patterns - Track Settings toggle](/img/screenshots/patterns-details-track-settings.png)

---

## Advanced Pattern Data

![Patterns - Advanced info](/img/screenshots/patterns-details-infos.png)

### Part Assignment
Each pattern displays its assigned part as a **"→ Part N"** label. Hovering over this label shows a tooltip with the part's name, making it easy to identify parts at a glance.

### Scale & Length
The app displays the **Length** (in steps) and **Master Scale** (speed) for every pattern. If you are using **Per Track** scale mode, the individual track length and speed are shown instead.

### Chain Behavior
The **Chain Mode** indicator shows how the Octatrack will transition after this pattern finishes playing (e.g., chain after 16, 32, 64 steps).

---

## MIDI Patterns

For MIDI tracks, everything works the same - except triggers are replced by MIDI notes! The app detects and displays:
- The default note for the track.
- Chord information (major, minor, 7th, etc.) if multiple notes are triggered on a single step.

![Patterns - MIDI Tracks](/img/screenshots/patterns-midi-tracks.png)

![Patterns - MIDI Tracks detail](/img/screenshots/patterns-midi-tracks-bis.png)

