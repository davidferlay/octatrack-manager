---
sidebar_position: 9
---

# Copy Parts

**Copy Parts** transfers Parts (sound design snapshots — the equivalent of a "kit") between different banks and projects. Useful to quickly move a sound you've developed to a new part.

![Tools - Copy Parts](/img/screenshots/tools-copy-parts.png)

## Workflow

1. **Source:** Choose the source project (the one you are viewing, by default), the bank (A–P), and the part (1–4, or All for 1-to-1 copy).
2. **Destination:** Choose the target project, one or more destination banks (A–P), and one or more destination parts.
3. **Execute:** Perform the part copy.

### Choosing the Source Project

The source pane has its own project selector, defaulting to the project you are viewing. Point it at another project to copy out of a project without opening it. It is the same picker as the destination one - see [Copy Banks](./copy-bank.md#choosing-the-source-and-destination-projects) for what it lists and how to browse for a project it does not know about.

---

## Data Copied

All sound design data for both audio and MIDI tracks:

### Audio Track Settings
- **Machine Type and Parameters:** Core sound engine settings defined in track parameter Pages.
- **Amplifier Settings:** Envelope, volume, and balance.
- **Effects (FX1 & FX2):** Assigned effects and their parameters.
- **LFOs:** Waveforms, speed, depth, and destination.

### MIDI Track Settings
- **MIDI Parameters:** Notes, velocity, length, and MIDI channel.
- **LFOs:** MIDI LFO configurations.

### Part Metadata
- **Part Names:** Custom part names are copied.
- **Saved State:** Both saved (backup) and unsaved (working) states are transferred.
- **Edited State:** Mirrors the source part's edited status.

---

## Important Notes

- **All Tracks Affected:** Part data includes parameters **of all Audio and MIDI tracks** of current bank - it's not tied to individual tracks.
- **Patterns Not Affected:** This operation only copies sound design settings (the Part), not sequences or triggers.
- **Automatic Backup:** The app automatically backs up destination bank files before executing. See [Quick Start](../getting-started/quick-start.md#11-automatic-backups) for details.
- **Sample Slot References:** This tool only copies the **reference to a sample slot id** (which Slot is assigned to track), not the Sample Slot metadata, nor audio file itself. Use [Copy Sample Slots](./copy-sample-slots.md) to transfer audio files.
