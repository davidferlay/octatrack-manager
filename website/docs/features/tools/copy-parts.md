---
sidebar_position: 3
---

# Copy Part

:::caution In Development — Coming Soon
The **Copy Part** feature is currently a work in progress and is not yet available in a stable release.
:::

The planned **Copy Part** tool is intended for transferring sound design snapshots—the equivalent of a "kit"—between different banks and projects. Use it to quickly move a sound you've developed to a new part.

![Tools - Copy Part](/img/screenshots/tools-copy-parts.png)

## Current Workflow (Experimental)

1. **Source:** Choose the source bank (A–P) and part (1–4) in the current project.
2. **Destination:** Choose the target project, bank, and one or more target parts.
3. **Execute:** Perform the part copy.

---

## Planned Data Coverage

When stable, copying a part is expected to include all sound design data for both audio and MIDI tracks:

### Audio Track Settings
- **Machine Type and Parameters:** Core sound engine settings.
- **Amplifier Settings:** Envelope, volume, and balance.
- **Effects (FX1 & FX2):** Assigned effects and their parameters.
- **LFOs:** Waveforms, speed, depth, and destination.

### MIDI Track Settings
- **MIDI Parameters:** Notes, velocity, length, and MIDI channel.
- **LFOs:** MIDI LFO configurations.

---

## Important Safety Notes

- **Patterns Not Affected:** This operation only copies the **sound design settings** (the part), not the sequences or triggers.
- **Experimental Status:** **Always back up your destination project** before using this tool. It writes directly to your project files.
- **Sample Slot References:** This copies the reference to a sample slot (S1, F32), not the sample itself.
