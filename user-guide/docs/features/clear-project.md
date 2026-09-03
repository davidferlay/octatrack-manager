---
sidebar_position: 16
---

# Clear Project

Clear Project resets parts of project back to the factory-default state.

It can be found in the Tools tab of the project page.

:::warning
This is destructive and the app has no undo. Each file it is about to rewrite is however automatically backed up first (see [Automatic Backups](../getting-started/quick-start.md#12-automatic-backups)), so the previous state is manually recoverable from the project directory.
:::

## Workflow

1. Choose what to clear: Banks, Parts, Patterns, Tracks or Sample Slots.
2. Pick the target - which banks, which parts, and so on.
3. Execute, then confirm. The confirmation spells out exactly what is about to be reset.

Unlike the copy tools there is no source project: the blank state is the source, so the tool shows a single Target pane. It always acts on the project you are viewing.

## Scopes

### Banks

Resets whole banks. Every part and every pattern the bank holds is lost, part names included.

Several banks can be selected at once, the same way as in [Copy Banks](./copy-bank.md): shift-click for a range, ctrl-click to pick individual ones, or use the None / All row underneath. All covers every bank that exists on disk; banks that do not cannot be selected.

### Parts

Resets Parts of one bank, chosen on the same part cross as [Copy Parts](./copy-parts.md) - one part, or All four. Both the saved and the unsaved (working) state go back to default, and the part name goes back to "ONE", "TWO", "THREE" or "FOUR" - a leftover name would otherwise suggest content that is no longer there.

Patterns are a separate scope: clearing a Part leaves every pattern of the bank alone, including their part assignments.

### Patterns

Empties Patterns of one bank, selected on the same grid as [Copy Patterns](./copy-patterns.md) (shift-click for a range, ctrl-click to add, or the None / All row): every trig on every track, plus the scale and chaining settings, and the Part assignment back to Part 1.

Sound design lives in Parts, so clearing a Pattern does not touch any machine, FX or LFO setting.

### Tracks

The most granular scope, mirroring [Copy Tracks](./copy-tracks.md). Choose a bank, one or more tracks (T1-T8 for audio, M1-M8 for MIDI), a part (or All four, on the part cross), and a Clear Mode:

- Part Parameters: the per-track sound design (machine type, params, FX, volumes, LFO, recorder setup), in both the saved and unsaved states. Patterns are untouched, so the mode asks only for a Part.
- Both: sound design and sequencer data. Asks for both a Part and one or more Patterns.
- Pattern Triggers: only the sequencer data (trigs, trigless trigs, parameter locks) for the selected tracks. Parts are untouched, so the mode asks only for Patterns.

In the two trigger modes a Pattern grid appears under Clear Mode - pick the patterns that lose their trigs, or use its All row for the whole bank. Part Parameters is pattern-independent, so the grid is hidden in that mode.

Tracks that are not selected keep everything they had, in every mode.

### Sample Slots

Clears a range of sample slots: the sample assignment and its attributes go, the slot becomes empty.

Pick Flex, Static, or Both to clear the same range in each pool. The range uses the same control as [Copy Sample Slots](./copy-sample-slots.md) - type the bounds, drag the slider handles, or switch between One (a single slot) and Range.

The audio files themselves are left on disk. To remove files that no longer belong to anything, use [Purge Unused Samples](./purge-unused-samples.md) instead.

## See also

- [Copy Banks](./copy-bank.md), [Copy Parts](./copy-parts.md), [Copy Patterns](./copy-patterns.md), [Copy Tracks](./copy-tracks.md) - the operations this one undoes.
- [Purge Unused Samples](./purge-unused-samples.md) - for removing audio files, rather than emptying slots.
