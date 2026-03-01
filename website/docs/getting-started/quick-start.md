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
- **Banks panel** — Navigate all 16 banks (A–P), 4 parts per bank, 16 patterns per part
- **Sample slots** — All 128 static and 128 flex slots with file paths and settings

Use the **Bank Selector** at the top to switch between banks. Use **Parts** tabs to switch between parts within a bank.

## 4. Manage your audio pool

Click **Audio Pool** in a project to browse the shared sample library for that Set. From there you can:

- Browse and filter audio files
- Copy or move files into the pool
- Delete unused samples

See the [Audio Pool](../features/audio-pool.md) guide for details.

## 5. Copy content between projects *(work in progress — coming soon)*

:::caution Work in progress — coming soon
This feature is currently under active development and is **not yet available in the latest release**. It will be included in an upcoming version of Octatrack Manager.
:::

The **Tools** tab on any project page lets you copy banks, parts, patterns, tracks, or sample slots between projects — even across different Sets or locations.

See the [Tools overview](../features/tools/index.md) for a full explanation of each copy operation.

## Tips

- Click **Refresh** (↻) on the home page to rescan after inserting a CF card or changing files on disk.
- The app remembers your column visibility, filters, and sort preferences for sample slot tables across sessions.
- You can use <kbd>Tab</kbd> and arrow keys to navigate most of the UI without a mouse.
