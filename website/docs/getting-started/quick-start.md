---
sidebar_position: 2
---

# Quick Start

This guide walks you through the most common tasks in Octatrack Manager.

## 1. Scan for your projects

When you first open the app, click **Scan for Devices**. The app will automatically search:

- Mounted CF cards and USB drives
- Common home directory locations: `Documents`, `Music`, `Desktop`, `Downloads`
- Any folder named `octatrack`, `Octatrack`, or `OCTATRACK` in your home directory

If your projects are stored elsewhere, click **Browse...** to point the app to a custom directory.

## 2. Browse your Sets and projects

Found content is organized into two sections:

- **Locations** — Sets grouped by device type (CF Card, USB, Local Copy). Each Set shows the number of projects it contains and whether an Audio Pool is present.
- **Individual Projects** — Standalone projects that exist without a parent Set.

Click the **▶** arrow on any location card to expand or collapse it. Click any project name to open it.

## 3. View project details

The [Project Detail](../features/project-detail.md) view shows:

- **Metadata** — Tempo, time signature, OS version
- **Current state** — Active bank, pattern, part, track, muted/soloed tracks
- **Mixer settings** — Gains, levels, and cue settings
- **Banks panel** — Navigate all 16 banks (A–P), 4 parts per bank, 16 patterns per bank
- **Sample slots** — All 128 static and 128 flex slots with file paths and settings

Use the **Bank Selector** at the top to switch between banks. Use **Parts** tabs to switch between parts within a bank.

## 4. Edit parts

The [Parts Editor](../features/parts-editor.md) lets you modify sound design parameters for each part directly on your computer. Open it from the **Parts panel** on the Project Detail page: select a bank, click a **Part** tab (Part 1–4), then enable **Edit mode** using the toggle in the panel header.

From there you can edit machine parameters, effects, LFOs, and MIDI settings for all 8 audio and 8 MIDI tracks — including a dedicated **LFO Designer** where you can draw custom waveforms freely with the mouse.

:::warning
Always back up your project before editing any parameters. The Parts Editor writes directly to your project files on disk.
:::

## 5. Manage your audio pool

Click **Audio Pool** in a project to browse the shared sample library for that Set. From there you can:

- Browse and filter audio files
- Copy or move files into the pool
- Delete unused samples
- Automatically convert incompatible formats (MP3, FLAC, OGG, M4A) to WAV on import, and resample files not at 44.1 kHz

See the [Audio Pool](../features/audio-pool.md) guide for details.

## 6. Copy content between projects *(work in progress — coming soon)*

:::caution Work in progress — coming soon
This feature is currently under active development and is **not yet available in the latest release**. It will be included in an upcoming version of Octatrack Manager.
:::

The **Tools** tab on any project page lets you copy banks, parts, patterns, tracks, or sample slots between projects — even across different Sets or locations.

See the [Tools overview](../features/tools/index.md) for a full explanation of each copy operation.

## Tips

- Click **Refresh** (↻) on the home page to rescan after inserting a CF card or changing files on disk.
- The app remembers your column visibility, filters, and sort preferences for sample slot tables across sessions.
- You can use <kbd>Tab</kbd> and arrow keys to navigate most of the UI without a mouse.
