---
sidebar_position: 2
---

# Copy Bank

![Copy Bank](/img/screenshots/tools-copy-bank.png)

The **Copy Bank** operation duplicates an entire bank — all 4 parts, all 16 patterns, their triggers, and all parameter locks — from a source project to one or more destination banks.

## What gets copied

- All 4 parts of the source bank
- All 16 patterns
- All step triggers in each pattern
- All parameter locks (plocks) for every step
- Part settings (machine assignments, amp, LFO, FX settings)
- Sample slot assignments within the part data

## Configuration

### Source bank

Select exactly **one** bank (A–P) as the source. Click the bank button to select it; click again to deselect.

### Destination bank(s)

Select one or more destination banks using the multi-select bank grid:

- Click individual bank buttons to toggle them on or off
- Click **All** to select all 16 banks simultaneously
- Click **None** to deselect everything

The destination bank(s) can be in:
- The **same project** as the source (to duplicate a bank internally)
- A **different project** (requires selecting a destination project)

:::caution
Existing data in the destination bank(s) will be **overwritten**. This operation cannot be undone from within the app — make a backup of the destination project before proceeding if in doubt.
:::

## Example workflow

**Goal**: Copy Bank A from "Project Alpha" to Bank C and Bank D in "Project Beta"

1. Open "Project Alpha" and click the **Tools** tab
2. Select **Copy Bank** operation
3. Click bank **A** as the source
4. Click **Select Destination Project** and choose "Project Beta"
5. Select banks **C** and **D** as destinations
6. Click **Execute**

## Tips

- Copy Bank is the fastest way to duplicate a complete bank's worth of patterns and sound design to a new location.
- You can copy a bank to itself if you want to normalise or reset data, though in practice this has no effect.
- If you only want to copy specific parts or patterns within a bank, use [Copy Parts](./copy-parts.md) or [Copy Patterns](./copy-patterns.md) instead.
