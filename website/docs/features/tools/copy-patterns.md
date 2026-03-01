---
sidebar_position: 4
---

# Copy Patterns

![Copy Patterns](/img/screenshots/tools-copy-patterns.png)

The **Copy Patterns** operation copies one or more patterns — their triggers, parameter locks, pattern length, and scale/chain settings — from a source location to one or more destination patterns.

## What gets copied

- Step triggers for all selected tracks
- Parameter locks (plocks) for all selected tracks
- Pattern length
- Scale and chain settings
- Part assignment (configurable — see below)

## Configuration

### Source pattern

Select one pattern (1–16) or **All** to copy all 16 patterns:

- **Single pattern** — enables multi-select on destination
- **All** — destination is automatically synchronised (pattern 1 → 1, 2 → 2, etc.)

### Source bank

Select one source bank (A–P).

### Destination pattern(s)

- Selectable only when a single source pattern is selected
- Supports multi-select: copy one pattern to multiple destinations
- **All** button — select all 16 patterns
- **None** button — deselect all
- Disabled when source is set to **All**

### Destination bank

Select one destination bank (A–P).

### Destination project

By default the destination is the same project. Click **Select Destination Project** to choose a different project.

## Part assignment mode

Patterns in the Octatrack are linked to a part. When copying patterns, you have three options for how part assignments are handled:

### Keep Original

The destination pattern keeps its original part number. Use this when you want to merge trigger data into an existing sound design setup.

### Copy Source

The source part data is also copied alongside the pattern. The destination pattern will use the same part as the source. Use this to bring both the sequence and the sound design to the destination.

### User Selection

You choose which part number the destination pattern(s) will use:

- Select **Part 1–4** from the part picker
- All copied patterns will be assigned to that part
- The part selector shows a **→ Part N** indicator confirming the mapping

## Track scope

By default all 16 tracks (8 audio + 8 MIDI) are copied. Use the **Track Scope** option to restrict which tracks are included:

### All Tracks

Copy triggers and plocks for all 8 audio tracks and all 8 MIDI tracks.

### Specific Tracks

Choose exactly which tracks to copy:

- **T1–T8** — Audio tracks (shown in the top row)
- **M1–M8** — MIDI tracks (shown in the bottom row)
- **All** button — select all 16 tracks
- **None** button — deselect all

:::note
At least one track must be selected when using **Specific Tracks**. The Execute button is disabled if no tracks are selected.
:::

## Example workflows

**Copy pattern 1 from Bank A to patterns 5, 6, and 7 in Bank B**

1. Select **Copy Patterns** operation
2. Select **Pattern 1** as source
3. Select bank **A** as source bank
4. Select **Patterns 5, 6, 7** as destinations
5. Select bank **B** as destination bank
6. Choose **Keep Original** for part assignment
7. Click **Execute**

**Copy all patterns from Bank A to Bank B, bringing sound design along**

1. Select **Copy Patterns** operation
2. Select **All** as source pattern
3. Select bank **A** as source bank
4. Select bank **B** as destination bank
5. Choose **Copy Source** as part assignment mode
6. Click **Execute**

**Copy only the MIDI track data from Pattern 3**

1. Select **Copy Patterns** operation
2. Select **Pattern 3** as source
3. Set **Track Scope** to **Specific Tracks**
4. Click **All MIDI** or select individual M1–M8 tracks
5. Configure source and destination banks
6. Click **Execute**

## Tips

- **Copy Patterns** is the most granular of the copy operations — use it when you want to move sequences without disturbing sound design, or to reuse a groove on different parts.
- Combine with **Track Scope** to merge trigger data from one track into a pattern that already has other tracks configured.
- Use **Copy Source** part assignment when porting a complete musical idea (sequence + sound) to a new location.
