---
sidebar_position: 5
---

# Copy Track

:::caution In Development — Coming Soon
The **Copy Track** feature is a work in progress and is not yet available in a stable release.
:::

The planned **Copy Track** tool is the most granular bulk operation in Octatrack Manager. It allows you to copy the settings for a single audio or MIDI track between different parts or patterns.

![Tools - Copy Track](/img/screenshots/tools-copy-tracks.png)

## Current Workflow (Experimental)

1. **Source:** Select the bank (A–P), part (1–4), and specific track (T1–T8 or M1–M8).
2. **Destination:** Choose the target project, bank, parts (multiple destination parts can be selected), and tracks.
3. **Configure Options:** Select exactly what is copied (Parameters, Triggers, or Both).
4. **Execute:** Perform the track copy.

---

## Planned Copy Modes

When stable, these modes are intended to function as follows:

- **Part Parameters:** Copies the full Part state, including both saved (backup) and unsaved (working) track data, as well as part names, saved state flags, and edited bitmask. Pattern sequences are not affected.
- **Pattern Triggers:** Only copies the sequencer data (triggers, p-locks, micro-timing). Sound design settings remain unchanged.
- **Both:** Copies both sound design settings and sequencer data to ensure a complete transfer.

---

## Important Safety Notes

- **Track Type Consistency:** Audio tracks must be copied to audio targets (T1–T8), and MIDI tracks to MIDI targets (M1–M8).
- **Experimental Feature:** **Always back up your destination project** before using this tool. Changes are written directly to binary project files.
- **Sample Slot References:** This tool copies references to sample slots, not the samples themselves.
