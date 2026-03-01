---
sidebar_position: 1
---

# Tools Overview

:::caution Work in progress — coming soon
The Tools feature is currently under active development and is **not yet available in the latest release**. It will be included in an upcoming version of Octatrack Manager. Stay tuned for updates on the [Elektronauts forum](https://www.elektronauts.com/t/project-manager-for-octatrack/) and the [GitHub releases page](https://github.com/davidferlay/octatrack-manager/releases/latest).
:::

The **Tools** tab on any Project Detail page provides five powerful copy operations for moving content between projects — or within the same project. All operations are non-destructive: they read source data and write it to the destination without modifying the source.

## Accessing the Tools tab

1. Open any project from the Home page
2. Click the **Tools** tab at the top of the Project Detail page

## Available operations

Select an operation using the radio buttons at the top of the Tools panel:

| Operation | What it copies |
|-----------|----------------|
| [Copy Bank](./copy-bank.md) | All 4 parts, all 16 patterns × 4 parts, all triggers and parameter locks |
| [Copy Parts](./copy-parts.md) | Selected parts and their pattern data within a bank |
| [Copy Patterns](./copy-patterns.md) | Selected patterns (triggers and parameter locks) with configurable track and part scope |
| [Copy Tracks](./copy-tracks.md) | Track sound design (machine/amp/LFO/FX) and/or pattern trigger data |
| [Copy Sample Slots](./copy-sample-slots.md) | Static and/or flex slot assignments, optionally with audio files |

## Selecting a destination project

Each operation requires a **destination project**. The source project is always the currently open project.

![Destination project selection menu](/img/screenshots/tools-destination-selector.png)

To set the destination:

1. Click **Select Destination Project** (or the destination project button)
2. A modal opens showing all discovered projects, organized by location
3. Browse and click any project to select it
4. Confirm the selection

Within the modal you can:
- Filter by Set or location type (CF Card, USB, Local Copy)
- Click **Scan** to rescan for devices
- Click **Browse...** to add a custom directory

The destination can be the **same project** as the source (useful for copying within a project).

## Audio pool status

When both a source and destination project are selected, the Tools tab shows an audio pool status summary:

| Status | Meaning |
|--------|---------|
| Source in Set | Whether the source project is part of a Set |
| Destination in Set | Whether the destination project is part of a Set |
| Same Set | Whether both projects share the same `AUDIO/` folder |

The **Same Set** status determines whether the **Move to Pool** audio option is available in [Copy Sample Slots](./copy-sample-slots.md).

## Executing an operation

1. Configure the source and destination settings for the selected operation
2. Select the destination project
3. Click **Execute**

The Execute button is disabled (greyed out) if required fields are missing or invalid. Hover over it to see a tooltip explaining what is missing.

After execution, a success or error message is displayed at the bottom of the panel.

## Validation

Each operation validates its inputs before executing. Common validation rules:

- Source and destination bank must be selected
- At least one source and one destination item must be selected
- For "Specific Tracks" scope, at least one track must be selected
- Source and destination cannot be identical where it would make no sense

The Tools panel displays inline validation messages to guide you.
