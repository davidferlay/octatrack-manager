---
sidebar_position: 10
---

# Copy Scenes

Copy Scenes moves individual scenes between Parts, banks and projects.

It can be found in the Tools tab of the project page.

## What a scene is

Each Part holds 16 scenes. A scene is a set of parameter locks: for every track it can hold a value for any parameter of the machine, LFO, AMP, FX1 and FX2 pages, plus an XLV setting that mutes the track after its effects. Anything the scene does not hold is left at the Part's own value.

Two of the 16 are assigned to the crossfader, one to each end, and moving the fader morphs between them. Which two those are is a setting of the Part rather than of a scene, so it is not something this tool moves: the destination Part keeps pointing the fader wherever it pointed before.

Scenes are a Part thing, so a scene always belongs to a bank and a Part. Copy Scenes is the tool for moving one somewhere else; [Copy Parts](./copy-parts.md) moves all 16 at once as part of the whole Part.

## Workflow

1. Source: choose the project (the one you are viewing, by default), the bank, the Part and one or more scenes.
2. Destination: choose the project, one or more banks, one or more Parts, and where the scenes should land.
3. Execute.

Both Part fields are the cross the device draws, the same one [Copy Parts](./copy-parts.md) uses: 1 on top, 4 and 2 either side, 3 underneath, with All in the middle.

Pressing All on the source reads all four Parts at once. Four Parts can only pair with the same four, so the destination cross follows along and goes inert: each Part's scenes land in the Part they came from. It is the way to move a whole bank's scenes without touching any sound design.

The source pane has its own project selector, so a scene can be read out of a project without opening it. It is the same picker as the destination one - see [Copy Banks](./copy-bank.md#choosing-the-source-and-destination-projects) for what it lists and how to browse for a project it does not know about.

Only banks that exist on disk can be chosen as the source; the others are greyed out. A destination bank that does not exist is refused with an error when Execute runs.

### Selecting scenes

The source scene grid is the same control as the pattern grid of [Copy Patterns](./copy-patterns.md): shift-click for a range, ctrl-click to add individual scenes, or use the None / All row underneath. The destination grid has its own None / All row.

How the destination grid behaves depends on how many scenes are being copied:

- One source scene: pick as many destination scenes as you like. The same scene is written to each of them.
- Several source scenes: they are copied pairwise, so the destination has to hold exactly as many. Clicking a destination scene starts a run of that length there, and a line underneath spells the pairing out ("1, 2, 3 to 9, 10, 11"). A run that would pass scene 16 is pulled back so that it ends on it. The destination All is unavailable while a run is pairing up, since the count is already decided.

Execute stays unavailable while either side is missing a selection, and its tooltip names what is still needed.

## Data copied

- Every parameter lock the scene holds, across the machine, LFO, AMP, FX1 and FX2 pages of all 8 audio and 8 MIDI tracks.
- The XLV setting each track has in that scene.

Both the saved and the unsaved (working) state of the destination Part are written, so pressing Reload Part on the device keeps the copied scene rather than throwing it away.

## Important notes

- The destination Part keeps its sound: machines, FX, LFOs, amp settings, its name and its crossfader ends are untouched. Only the scenes you pointed at change.
- The source is left alone, including when source and destination are the same Part.
- Scenes hold values, not samples. A lock on a sample slot refers to a slot id; use [Copy Sample Slots](./copy-sample-slots.md) to move the slots themselves.
- When a bank is both read and written in the same run, it is written last, so the other destination banks read the original scenes rather than ones already overwritten.
- The app automatically backs up every destination bank file before executing. See [Quick Start](../getting-started/quick-start.md#12-automatic-backups) for details.
