---
sidebar_position: 6
sidebar_label: Edit Scenes
---

# Edit Scenes

The Scenes tab shows the 16 scenes of each Part: which parameters each one holds, at what value, and which two the crossfader sits between. In Edit mode every one of those can be changed.

## What a scene is

A scene is a set of parameter locks that the crossfader morphs towards. It is not a copy of the whole Part: it records only the parameters assigned to it, and every other parameter carries on from the Part itself.

- Each Part holds its own 16 scenes, so switching Part switches the scenes with it.
- A scene can hold any parameter of the SRC, AMP, LFO, FX1 and FX2 pages of an audio track, plus two scene-only settings, XLV and XVOL (see [XLV and XVOL](#xlv-and-xvol) below).
- Scenes are an audio-track thing. It does not apply to MIDI tracks.

To move scenes between Parts, banks or across projects, see [Copy Scenes](./copy-scenes.md).

## Opening the Scenes tab

1. Open a project.
2. Go to the Scenes tab in the project header.
3. Pick a bank, or All Banks to get one Scenes panel per bank.

The bank header is the same as on the Parts tab: the bank name, the Reload / Save / Save All buttons, and the four Part tabs.

The selected scene number is kept when switching bank, Part or tab, so the same scene can be read across banks.

## The scene grid

The row of 16 cards stands for the device's 16 trig keys.

- Each card shows its scene number and how many parameters it holds. A scene holding nothing shows a dash and is dimmed.
- The two scenes the crossfader sits between carry an orange A or B in their corner, or A/B when both ends point at the same scene.
- Clicking a card selects that scene. The mouse wheel over the grid steps through the scenes one at a time.
- Right-clicking a card opens a menu:
  - Assign to A / Assign to B points that crossfader end at this scene (Edit mode only).
  - Compare with A, Compare with B and Compare with selected open the [Compare](#compare) view with this scene against the one named.

## The crossfader

The crossfader can be used to assign scenes to either A or B ends: The left drop-down is the scene at the A end, the right one the scene at the B end.

### Muting A/B

The A and B letters at each end are also switches: In Edit mode, clicking one mutes that end, exactly as FUNC + SCENE A/B does on the device: the letter turns red and outlined, and at that end the scene's locks are ignored and the Part's own values apply.

Note that Mute is not stored in Part but in project file, so it applies to every bank, Part and pattern.

For the same reason, muting an end does not mark the Part as modified, and Save / Reload do not affect it. It can however be restored with [Undo](./undo-redo.md).

## Three ways of reading a Part

The tabs under the grid switch between three views of the same Part. Editing parameters and other scenes operations are available to each of them.

### Scene

Displays what the selected scene holds: Only the tracks the scene touches are shown, and only the parameters it holds, each named after the page it belongs to.

- SRC parameters are named after the track's machine
- FX parameters are named after the effect currently loaded in that slot
- Values read as the Parts pages show them
- Hovering on a parameter displays a field description (same as on Part tab)

### Matrix

Displays every parameter of all scenes the Part holds: one row per parameter, one column per scene. Useful to get a quick overview of which parameters are assigned to which scenes and compare what scenes are holding.

- A dash means that scene does not hold the parameter, so the Part's own value applies there.
- The column of the selected scene is highlighted in blue; the two crossfader ends are numbered in orange.
- Clicking a column heading selects that scene, as clicking a card does.

### Compare

Displays 2 scenes side by side and the parameters they hold.

- Each side has its own drop-down to pick the scene it reads. Clicking a card in the grid sets the left side.
- When both sides hold a parameter at different values, the difference is shown in the value the device displays: green when it increases from left to right, red when it decreases.
- Each track card counts how many of its parameters actually move.

## Editing scenes

Edting scenes and their parameters is available in Edit mode: with it, values can be changed and the editing buttons become visible.

### Changing values

- Type a new value into a value box, in the same units it reads in.
- Hover a value and turn the mouse wheel to step it one setting at a time.
- Drag a value up or down, as on the Parts pages.
- Click the cross beside a value to clear that parameter out of the scene.
- Turn on "Show all params" to list every parameter the scene could hold and assign new parameters to it.

### Scene operations

The buttons beside the view tabs work the same way in all three views.

| Action | What it does |
|---|---|
| Copy | Takes a copy of the selected scene. |
| Paste | Puts the copied scene into the target scenes, replacing what they hold. Works across the Parts of the same bank. |
| Clear | Empties the target scenes, so the crossfader leaves everything as the Part sets it there. |
| Randomize | Gives every value the target scenes hold a new one at random, within each parameter's own range. Which parameters are held does not change. |
| Gear beside Randomize | Opens [Randomize with bounds](#randomize-with-bounds). |
| Copy A to B / Copy B to A | Puts what one end's scene holds into the other end's scene. |
| Swap A/B | Exchanges what the two ends' scenes hold. The ends keep pointing where they point, so the fader now builds towards the other sound. |
| Show all params | Lists every parameter a scene could hold, not only the ones it does. Available outside Edit mode too. |

### Acting on several scenes

Which scenes Paste, Clear and Randomize act on depends on the view:

- Scene view: the selected scene.
- Matrix view: every selected scene.
- Compare view: both scenes being compared.

### Copying one track

In the Scene view, each track card has its own copy and paste buttons in its heading. Copy takes what the scene holds for that track; select another scene and press paste on the same track to put it there. The paste button turns green on the track it can go into.

A track can only be pasted into the same track: the same position is a different parameter on another machine.

### Randomize with bounds

The gear beside Randomize opens a window with more control over the reroll.

- Bounds:
  - "Window": Updates each value anywhere inside a slice of its own range, for example 50% to 100% for the top half.
  - "Drift": Updates each value around from where it already sits using the percentage set.
- Scenes: Only impact the scene(s) selected in the grid; or a hand-picked selection.
- Parameters: Select every parameter the chosen scenes hold, grouped by page and named by track. Untick a parameter to leave it alone, or a page heading to leave the whole page alone.

Percentages are used rather than values because the parameters have nothing in common: VOL runs 0-127 and an LFO speed -64-63, and "the top quarter" means the same for both. Every value lands on one the Octatrack own encoder can produce.

## XLV and XVOL

Two settings exist only in scenes:

- XLV is a track's crossfader level, applied after its effects.
- XVOL is the AMP page's sixth position, a volume applied before the effects. The device only shows it while a scene key is held, so the Parts editor has no knob for it and this tab is the only place it appears.

Both can only be MIN or MAX on the device. No value exists in between.

## Saving scenes

Scene data belongs to the Part, so scenes are saved exactly like [Part edits](./parts-editor.md#saving-and-committing-changes):

- Every change is written to the Part's working copy shortly after it is made, and the Part tab gains its unsaved asterisk.
- Save commits the Part, Save All every modified Part of the bank.
- Reload puts every scene of the Part back as it was last saved.
- The [Undo and Redo](./undo-redo.md) buttons in the project header take scene edits back too, sharing one history with the rest of the project.

:::warning
Editing scenes directly modifies your project files. While [automatic backups](../getting-started/quick-start.md#automatic-backups) provide a safety net, keep your own copies of your projects as well.
:::
