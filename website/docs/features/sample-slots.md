---
sidebar_position: 5
---

# Sample Slots

Each Octatrack project has two sets of sample slots, shown side by side in the Project Detail view:

- **Static Slots** (S1–S128) — samples loaded into RAM
- **Flex Slots** (F1–F128) — samples streamed from the CF card

![Static sample slots list](/img/screenshots/sample-slots-static.png)

![Flex sample slots list](/img/screenshots/sample-slots-flex.png)

:::info Roadmap
The Sample Slots view is planned to become a fully interactive sample management interface, with the Audio Pool integrated directly alongside it. Planned capabilities include:

- **Assign samples to slots** — browse the Audio Pool and assign files to any slot directly from the interface
- **Fix missing or moved samples** — automatically resolve broken references for samples that are still present in the Audio Pool but were moved or renamed
:::

## Table columns

| Column | Description |
|--------|-------------|
| **Slot** | Slot identifier (e.g., S1, F42) |
| **Sample** | Filename of the assigned sample |
| **Status** | ✓ file found on disk / ✗ file missing |
| **Source** | Where the sample is referenced from (pool, slot path) |
| **Gain** | Playback gain (0–127) |
| **Timestretch** | Time-stretching mode: Off, Normal, or Beat |
| **Loop** | Loop mode: Off or Normal |
| **Compatibility** | Whether the sample is compatible with the Octatrack |
| **Format** | Audio format (WAV, AIFF, etc.) |
| **Bit depth** | Sample bit depth (16, 24, 32-bit) |
| **Sample rate** | Sample rate in Hz (e.g., 44100, 48000) |

## Compatibility values

| Value | Meaning |
|-------|---------|
| `compatible` | File is natively supported by the Octatrack |
| `wrong_rate` | Correct format but unsupported sample rate |
| `incompatible` | File format not supported by the Octatrack |

## Filtering and sorting

Each table has a full set of filters accessible via the filter toolbar:

![Sample slots — filter toolbar](/img/screenshots/sample-slots-flex-filters.png)

![Sample slots — filter toolbar (additional filters)](/img/screenshots/sample-slots-flex-filters-bis.png)

- **Search** — filter rows by filename
- **Compatibility** — show only compatible / wrong_rate / incompatible
- **Status** — show only slots with a sample / show only empty slots
- **Source** — filter by source location
- **Gain, Timestretch, Loop, Format, Bit depth, Sample rate** — filter by any of these attributes

Click any column header to sort ascending or descending. Click again to reverse the sort direction.

## Column visibility

Click **Columns** to open the column visibility menu and show/hide individual columns. Your preferences are saved across sessions.

## Hide empty slots

Toggle **Hide empty slots** to remove rows where no sample is assigned. Useful for quickly seeing only the slots that are in use.

## Copy filename

Hover over a sample filename and click the copy icon to copy the filename to the clipboard.
