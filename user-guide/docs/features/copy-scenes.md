---
sidebar_position: 10
---

# Copy Scenes

**Copy Scenes** copies individual scenes between Parts, banks and projects, leaving the destination Part's sound design untouched. See [Edit Scenes](./scenes.md) for what a scene is.

## Workflow

1. **Source:** Choose the source project (the one you are viewing, by default), the bank (A–P), the part (1–4, or All) and one or more scenes.
2. **Destination:** Choose the target project, one or more destination banks (A–P), one or more destination parts, and the destination scenes.
3. **Execute:** Perform the scene copy.

Pressing All on the source part copies all four Parts 1-to-1: each Part's scenes land in the Part they came from.

### Selecting Scenes

The scene grids work like the pattern grid of [Copy Patterns](./copy-patterns.md): <kbd>Shift</kbd> + click for a range, <kbd>Ctrl</kbd> + click to add individual scenes, or the None / All buttons.

- **One source scene:** Pick any number of destination scenes; the same scene is written to each.
- **Several source scenes:** They are copied pairwise, so clicking a destination scene selects a run of the same length (e.g. "1, 2, 3 to 9, 10, 11").

### Choosing the Source Project

The source pane has its own project selector, defaulting to the project you are viewing. It is the same picker as the destination one - see [Copy Banks](./copy-bank.md#choosing-the-source-and-destination-projects) for details.

---

## Data Copied

- **Parameter Locks:** Every value the scene holds on the SRC, AMP, LFO, FX1 and FX2 pages of the 8 audio tracks.
- **XLV:** Each track's scene-only crossfader level.
- **Saved State:** Both saved (backup) and unsaved (working) states of the destination Part are written, so Reload Part on the device keeps the copied scenes.

---

## Important Notes

- **Audio Tracks Only:** The Octatrack stores scene data for audio tracks only, so MIDI tracks are never affected.
- **Destination Part Preserved:** Machines, FX, LFOs, amp settings, the Part name and its crossfader ends are untouched. Only the selected scenes change.
- **Whole Parts:** To copy a Part together with all its scenes, use [Copy Parts](./copy-parts.md).
- **Automatic Backup:** The app automatically backs up destination bank files before executing. See [Quick Start](../getting-started/quick-start.md#automatic-backups) for details.
- **Sample Slot References:** A scene holds values, not samples. Use [Copy Sample Slots](./copy-sample-slots.md) to transfer sample slots.
