---
sidebar_position: 4
---

# Patterns

A **pattern** is the fundamental sequencing unit of the Octatrack. It holds up to 16 steps of trigger data and parameter locks for all 8 audio tracks and 8 MIDI tracks. Each of the 16 banks (A–P) contains 4 parts, and each part holds 16 patterns — giving a total of 1,024 patterns per project.

![Pattern detail view](/img/screenshots/patterns-details.png)

![Pattern detail view — alternative](/img/screenshots/patterns-details-bis.png)

## Viewing patterns

Patterns are accessible from the **Project Detail** page once a bank is selected.

### Pattern Selector

The Pattern Selector displays all 16 patterns in the currently selected part as numbered buttons (1–16):

- The **active pattern** (last active when the project was saved) is highlighted
- Click any pattern button to select it and display its data below

### Selecting a bank and part first

Patterns are always viewed in the context of a bank and a part:

1. Select a bank (A–P) using the **Bank Selector**
2. Select a part (Part 1–4) using the **Parts** tabs
3. The Pattern Selector then shows the 16 patterns belonging to that part

## Pattern data

Each pattern stores the following information:

| Data | Description |
|------|-------------|
| **Step triggers** | Which steps are active for each track (up to 16 steps) |
| **Parameter locks** | Per-step overrides for any track parameter |
| **Pattern length** | Number of active steps (1–64, or per-track lengths) |
| **Scale settings** | Time scale multiplier and master/track scale mode |
| **Part assignment** | Which of the 4 parts this pattern uses for sound design |
| **Chain settings** | How the pattern chains to the next one |

![Pattern — audio tracks](/img/screenshots/patterns-audio-tracks.png)

![Pattern — audio tracks (additional view)](/img/screenshots/patterns-audio-tracks-bis.png)

![Pattern — audio tracks (extended)](/img/screenshots/patterns-audio-tracks-ter.png)

![Pattern — MIDI tracks](/img/screenshots/patterns-midi-tracks.png)

![Pattern — MIDI tracks (additional view)](/img/screenshots/patterns-midi-tracks-bis.png)

## Parameter locks

Parameter locks (plocks) let individual steps override the part's default values for any parameter — machine settings, amp, LFO, FX, or sample slot assignments. This is what makes Octatrack patterns so expressive: every step can have a completely different sound or behaviour.

Plocks are visible in the **Sample Slots** tables: slots that have per-step overrides are indicated alongside the base part values.

## Pattern length and scale

The Octatrack supports patterns from 1 to 64 steps. Patterns can also run at different time scales relative to the master tempo:

| Setting | Description |
|---------|-------------|
| **Length** | Number of steps in the pattern (default: 16) |
| **Scale** | Time multiplier: 1/8×, 1/4×, 1/2×, 1×, 2×, 3×, 4× |
| **Master/Track mode** | Whether tracks share the pattern length or run independently |

These values are preserved and displayed in Octatrack Manager.

## Copying patterns

Use the **[Copy Patterns](./tools/copy-patterns.md)** tool to duplicate one or more patterns to new locations — within the same bank, across banks, or to a different project entirely. The copy operation supports:

- Copying a single pattern to multiple destinations
- Copying all 16 patterns at once
- Choosing which tracks to include (all tracks or a specific subset)
- Configuring how part assignments are handled at the destination

See the [Copy Patterns](./tools/copy-patterns.md) documentation for full details.
