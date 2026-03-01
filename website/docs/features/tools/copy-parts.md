---
sidebar_position: 3
---

# Copy Parts

![Copy Parts](/img/screenshots/tools-copy-parts.png)

The **Copy Parts** operation copies one or more parts — including all their pattern data, triggers, and parameter locks — from a source bank to a destination bank.

## What gets copied

- Part settings (machine assignments, amp, LFO, FX parameters for all tracks)
- All 16 patterns within the part
- All step triggers in each pattern
- All parameter locks (plocks) in each pattern
- Sample slot assignments within the part

## Configuration

### Source part

Select the part(s) to copy:

- **Part 1–4** — Copy a single specific part
- **All** — Copy all 4 parts simultaneously (the destination part selection is synchronised automatically)

Click the selected option again to deselect it.

### Source bank

Select exactly one source bank (A–P).

### Destination part

Select one or more destination parts:

- Available only when a single source part is selected
- Multi-select is supported: copy one source part to multiple destinations
- Disabled (greyed out) when source is set to **All**

### Destination bank

Select exactly one destination bank (A–P). The destination bank can be:

- The **same bank** as the source (to duplicate parts within a bank)
- A **different bank** (same or different project)

### Destination project

By default the destination is the same project as the source. Click **Select Destination Project** to choose a different project.

## Validation

The Execute button requires:
- A source part selected
- A destination part selected
- A source bank selected
- A destination bank selected

## Example workflows

**Duplicate Part 2 to Part 4 within the same bank**

1. Select **Copy Parts** operation
2. Select **Part 2** as source
3. Select the bank (e.g., **A**) as both source and destination bank
4. Select **Part 4** as destination
5. Click **Execute**

**Copy all parts from Bank A to Bank B in the same project**

1. Select **Copy Parts** operation
2. Select **All** as source part
3. Select **A** as source bank
4. Select **B** as destination bank
5. Click **Execute** — all 4 parts are copied with their patterns

## Tips

- Use **Copy Parts** when you want to reorganise your sound design across banks without copying the full bank structure.
- Selecting **All** as source and destination bank is equivalent to [Copy Bank](./copy-bank.md) for the part data.
- If you only want to copy specific patterns within a part (not the whole part), use [Copy Patterns](./copy-patterns.md).
