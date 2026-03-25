---
sidebar_position: 3
---

# Copy Parts

**Copy Parts** transfers sound design snapshots — the equivalent of a "kit" — between different banks and projects. Use it to quickly move a sound you've developed to a new part.

![Tools - Copy Parts](/img/screenshots/tools-copy-parts.png)

## Workflow

1. **Source:** Choose the source bank (A–P) and part (1–4, or All for 1-to-1 copy).
2. **Destination:** Choose the target project, bank, and one or more destination parts.
3. **Execute:** Perform the part copy.

---

## Data Copied

All sound design data for both audio and MIDI tracks:

### Audio Track Settings
- **Machine Type and Parameters:** Core sound engine settings.
- **Amplifier Settings:** Envelope, volume, and balance.
- **Effects (FX1 & FX2):** Assigned effects and their parameters.
- **LFOs:** Waveforms, speed, depth, and destination.

### MIDI Track Settings
- **MIDI Parameters:** Notes, velocity, length, and MIDI channel.
- **LFOs:** MIDI LFO configurations.

### Part Metadata
- **Part Names:** Custom part names are copied.
- **Saved State:** Both saved (backup) and unsaved (working) states are transferred.
- **Edited Bitmask:** Mirrors the source part's edited status.

---

## Important Notes

- **Patterns Not Affected:** This operation only copies sound design settings (the Part), not sequences or triggers.
- **Backup Recommended:** Changes are written directly to binary project files.
- **Sample Slot References:** This copies the reference to a sample slot (e.g., S1, F32), not the audio file itself.
