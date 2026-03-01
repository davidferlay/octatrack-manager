---
sidebar_position: 5
---

# Copy Tracks

![Copy Tracks](/img/screenshots/tools-copy-tracks.png)

The **Copy Tracks** operation copies track-level data from a source track to one or more destination tracks. You can choose to copy the sound design parameters, the pattern trigger data, or both.

## What can be copied

### Part parameters (sound design)
Machine parameters, amplitude settings (attack, hold, release, volume, balance, filter), all three LFO configurations, and FX slot parameters. This is the "voice" of the track — how it sounds.

### Pattern triggers (sequencer data)
Step triggers and parameter locks (plocks) for all patterns in the selected part. This is the "rhythm" of the track — what it plays.

### Both
Copies both sound design and trigger data in a single operation.

## Configuration

### Copy mode

Select one of three radio buttons:

| Mode | What is copied |
|------|----------------|
| **Part Parameters** | Sound design only (no triggers or plocks) |
| **Pattern Triggers** | Triggers and plocks only (no sound design) |
| **Both** | Complete track data |

### Source track

Select exactly one track as the source:

- **T1–T8** — Audio tracks
- **M1–M8** — MIDI tracks

### Source part

Select one part or **All**:

- **Part 1–4** — Copy from a single part
- **All** — Copy from all 4 parts simultaneously (destination part selection is locked to match)

### Source bank

Select one source bank (A–P).

### Destination track(s)

Select one or more destination tracks:

- Multi-select is supported when a single source track is selected
- **All Audio** button — select all T1–T8 (disabled if any MIDI destination is selected)
- **All MIDI** button — select all M1–M8 (disabled if any audio destination is selected)
- **None** button — deselect all

:::note Audio/MIDI locking
When you select an audio source track, only audio destination tracks are available. Selecting a MIDI source track restricts destinations to MIDI tracks only. This prevents mismatched type copying.
:::

### Destination part

Select which part(s) receive the copied data:

- Available only when a **single** source part is selected
- Disabled when source part is **All**
- Multi-select is supported

### Destination bank

Select one destination bank (A–P).

### Destination project

By default the destination is the same project. Click **Select Destination Project** to choose a different project.

## Example workflows

**Duplicate T1 sound design to T2 and T3 within the same bank**

1. Select **Copy Tracks** operation
2. Set mode to **Part Parameters**
3. Select **T1** as source track
4. Select **Part 1** as source part
5. Select the bank (e.g., **A**) as source and destination bank
6. Select **T2** and **T3** as destination tracks
7. Select **Part 1** as destination part
8. Click **Execute**

**Copy a MIDI sequence from M1 to M2 across all parts**

1. Select **Copy Tracks** operation
2. Set mode to **Pattern Triggers**
3. Select **M1** as source track
4. Select **All** as source part
5. Select **M2** as destination track
6. Configure source and destination banks
7. Click **Execute** — triggers from all 4 parts of M1 are copied to M2

**Copy a complete audio track (sound + sequence) to another project**

1. Select **Copy Tracks** operation
2. Set mode to **Both**
3. Select the source track, part, and bank
4. Click **Select Destination Project** and choose the target project
5. Select the destination track, part, and bank
6. Click **Execute**

## Tips

- Use **Part Parameters** only when you want to share a sound design (e.g., copy a kick drum synthesis to another track) without disturbing the existing sequence.
- Use **Pattern Triggers** only when you want to reuse a rhythmic pattern with a different sound.
- The **All** source part mode is useful for propagating a track's sound design change across all parts at once.
