---
sidebar_position: 5
sidebar_label: Undo / Redo
---

# Undo / Redo

The editors write each change to the project a moment after it is made: there is no dialog to cancel out of. Undo and Redo are the way back from a change you did not mean, without needing the Part to have been saved first as the device's own Reload Part does.

## Where to find them

The Undo and Redo buttons sit in the project header, beside the View/Edit toggle. They are only shown in Edit mode, since there is nothing to take back while only reading.

- Hovering a button names what it would do, for example "Undo: Change scene 3" or "Redo: Save part 2".
- A button is greyed out when there is nothing to undo or redo in this project.
- After each step, the save status in the header says what was undone or redone.

The editors re-read the project after an undo or redo, so what is on screen always matches the files. The tab, view and selection you were on are kept.

## What can be undone

Every write made by the editors goes on one list, in the order it happened, whichever tab it was made from:

| Where | Change |
|---|---|
| [Parts](./parts-editor.md) | Any parameter change, machine, effect or sample slot assignment |
| [Parts](./parts-editor.md) and [Scenes](./scenes.md) | Save, Save All and Reload of a Part |
| [Scenes](./scenes.md) | Any scene change: values, Paste, Clear, Randomize, Swap A/B, track copies |
| [Scenes](./scenes.md) | Moving a crossfader end, muting or unmuting an end |
| [Overview](./project-detail.md) | Memory settings |
| [Flex / Static slots](./sample-slots.md) | Assigning samples, clearing slots or samples, resetting slot attributes |

A run of quick edits to the same thing, such as turning a value with the mouse wheel, is written once when it stops, so it is undone in one step.

Undoing a Save also puts back the Part's previously saved copy, so the device's Reload Part behaves as it did before that Save.

## What cannot be undone

Tools operations (Copy Banks, Parts, Scenes, Patterns, Tracks and Sample Slots, Clear Project, Fix Missing Samples, Fix Incompatible Samples, Purge Unused Samples) and Audio Pool file transfers are not on the list. Rely on [automatic backups](../getting-started/quick-start.md#automatic-backups) for those. Clearing sample slots with Clear Project is the one exception: it can be undone.

## How the history works

- Each project has its own history. Opening another project does not lose it, and an undo never reaches into a project other than the one open.
- Up to the last 50 changes per project can be undone.
- Undo steps back newest first; Redo walks forward again.
- Making a new change after undoing drops whatever could still be redone, as in any editor.
- The history only lasts while the app is running. Closing the app clears it.

:::tip
Undo restores whole files exactly as they were before the change, so the result is byte for byte what was there, not an approximation of it.
:::
