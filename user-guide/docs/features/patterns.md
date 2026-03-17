---
sidebar_position: 6
---

# Patterns

The Patterns tab provides a visual representation of your sequencer data. It allows you to inspect every trigger, parameter lock, and trig condition in your project with a level of detail that is not possible on the hardware.

![Patterns - Detailed view](/img/screenshots/patterns-audio-tracks.png)

## Visualizing Triggers

Each pattern is displayed as a grid of 16 steps (for patterns up to 16 steps, or scrollable for longer ones).

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

---

## Pattern Navigation

- **Single Pattern:** Select a specific pattern (1–16) from the selector.
- **All Patterns:** View all sequences in a bank at once by selecting **All** from the pattern selector.
- **Hide Empty:** Toggle the **Hide empty** switch in the header to focus only on patterns that contain triggers.

---

## Track Settings

Toggle **Track settings** in the header to see the configuration for each track within the bank.

This section shows:
- **Swing:** The swing amount (%) for each track.
- **Trig Mode:** The track's trig mode (e.g., Plays Free, One-Shot).
- **Quantization:** The trig quantization settings.
- **Start Silent:** Whether the track starts silently.

![Patterns - Track Settings](/img/screenshots/patterns-audio-tracks-bis.png)

---

## Advanced Sequencer Data

### Scale & Length
The app displays the **Length** (in steps) and **Master Scale** (speed) for every pattern. If you are using **Per Track** scale mode, the individual track length and speed are shown instead.

### Chain Behavior
The **Chain Mode** indicator shows how the Octatrack will transition after this pattern finishes playing (e.g., chain after 16, 32, 64 steps).

### MIDI Track Details
For MIDI tracks, the app detects and displays:
- The MIDI channel.
- The default note for the track.
- Chord information (major, minor, 7th, etc.) if multiple notes are triggered on a single step.

![Patterns - MIDI Tracks](/img/screenshots/patterns-midi-tracks.png)
