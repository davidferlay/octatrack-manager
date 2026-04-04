---
sidebar_position: 6
---

# Patterns

The Patterns tab provides a visual representation of the sequencer data. It allows to inspect triggers, parameter locks, and trig conditions of every step in projects - all at a glance.

![Patterns - Track Settings](/img/screenshots/patterns-audio-tracks-bis.png)

## Visualizing Triggers

Each pattern is displayed as a grid of steps. It matches the global or per-track length defined in Scale Setup menu of the Octatrack.

### Trig Types
- **Trigger:** Indicated by a solid circle. A traditional sequencer trigger.
- **Trigless:** Indicated by an empty circle. A trigger that changes parameters but does not restart the sample envelope.
- **P-Lock:** Indicated by the letter **P**. Shows that one or more parameter locks are present on that step.

### Specialized Indicators
- **1:** One-Shot trigger.
- **~:** Slide trigger.
- **R:** Recorder trigger.
- **%:** Trig Condition (e.g., Fill, 50%).
- **X:** Trig Repeats.
- **µ:** Micro-timing offset.
- **V:** Velocity or Volume lock.
- **S:** Sample slot lock.
- **Swing:** A wave icon indicates that a swing trig is active on that step.

---

## Detailed Step Inspection

Click on any step in the grid to open the **Parameter Details Panel**. This panel shows you every single piece of data associated with that specific trigger.

- **Notes & Chords:** For MIDI tracks, it shows the exact notes and even detects common chord types.
- **P-Lock Values:** Lists every parameter lock and its exact value.
- **Micro-timing:** Shows the precise offset (e.g., +1/32).

![Patterns - Parameter Details](/img/screenshots/patterns-details.png)

![Patterns - Parameter Details](/img/screenshots/patterns-details-2.png)

![Patterns - Parameter Details](/img/screenshots/patterns-details-3.png)

When viewing all patterns at once, each track's triggers are displayed across multiple rows with full indicator detail:

![Patterns - All Patterns multi-track view](/img/screenshots/patterns-details-bis.png)

:::tip
**Hide Empty:** Toggle the **Hide empty** switch in the header to focus only on patterns that contain triggers.
:::

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

