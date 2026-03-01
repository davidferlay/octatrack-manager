---
sidebar_position: 2
---

# Project Detail

The Project Detail page shows a comprehensive view of a single Octatrack project. It is divided into several panels.

![Project detail — overview](/img/screenshots/project-details.png)

## Project metadata

At the top of the page you'll find the core project settings:

| Field | Description |
|-------|-------------|
| **Name** | Project name as stored on disk |
| **Tempo** | BPM value (40–300) |
| **Time signature** | Beat structure (e.g., 4/4) |
| **OS version** | Octatrack firmware version used to save the project (e.g., 1.40B) |
| **Pattern length** | Default pattern length in steps |

## Current state

Shows what was active when the project was last saved on the Octatrack:

| Field | Description |
|-------|-------------|
| **Active bank** | Which of the 16 banks (A–P) was selected |
| **Active pattern** | Active pattern number (1–16) |
| **Active part** | Active part number (1–4) |
| **Active track** | Active track (T1–T8 for audio, M1–M8 for MIDI) |

### Track states

Visual badges indicate which tracks were:
- **Muted** — track output silenced
- **Soloed** — only this track plays
- **Cued** — track routed to cue output

## Mixer settings

The mixer panel shows the project-level gain and routing settings:

| Parameter | Range | Description |
|-----------|-------|-------------|
| **Gain AB** | 0–127 | Input gain for inputs A/B |
| **Gain CD** | 0–127 | Input gain for inputs C/D |
| **Direct AB** | 0–127 | Direct-through level for A/B |
| **Direct CD** | 0–127 | Direct-through level for C/D |
| **Phones mix** | 0–127 | Headphone mix level |
| **Main to cue** | 0–127 | Main output bleed into cue bus |
| **Main level** | 0–127 | Master output level |
| **Cue level** | 0–127 | Cue output level |

## Memory settings

Controls how the Octatrack manages RAM for samples:

| Setting | Description |
|---------|-------------|
| **Load 24-bit flex** | Whether 24-bit flex samples are loaded into RAM |
| **Dynamic recorders** | Enable dynamic recorder allocation |
| **Record 24-bit** | Record audio at 24-bit depth |
| **Reserved recorders** | Number of reserved recorder slots (0–8) |
| **Reserved recorder length** | Length allocated to reserved recorders |

## MIDI settings

Global MIDI configuration for the project:

| Setting | Description |
|---------|-------------|
| **Clock send / receive** | Send or receive MIDI clock |
| **Transport send / receive** | Send or receive MIDI start/stop |
| **Program change send / receive** | Send or receive program change messages |
| **Program change channels** | MIDI channels used for program change |
| **Auto channel** | Automatic MIDI channel assignment |
| **Per-track channel** | MIDI channel for each of the 8 audio tracks (–1 = disabled) |
| **CC in / out** | MIDI CC receive/send per audio track |
| **Note in / out** | MIDI note receive/send per audio track |

## Metronome settings

| Setting | Range | Description |
|---------|-------|-------------|
| **Enabled** | On/Off | Whether the click track is active |
| **Main volume** | 0–127 | Metronome level in main output |
| **Cue volume** | 0–127 | Metronome level in cue output |
| **Pitch** | 0–24 | Click pitch |
| **Tonal** | On/Off | Tonal (pitched) vs. noise click |
| **Preroll** | 0–4 bars | Count-in bars before playback |

## Bank navigation

### Bank Selector

The bank selector at the top shows all 16 banks (A–P) as buttons:

- **Highlighted button** — currently selected bank (for viewing)
- **Bold button** — bank that was active when the project was last saved
- **Greyed out** — bank with no data on disk

Click any bank button to load and display that bank's data.

![Bank selector — normal view](/img/screenshots/project-details-unsupported-banks.png)

![Bank selector — with unavailable banks](/img/screenshots/project-details-bank-selector.png)

### Parts panel

Within the selected bank, the **Parts** panel shows 4 tabs (Part 1–Part 4). Click a tab to view that part's data. The tab label shows the custom part name if one has been set.

### Pattern Selector

Shows all 16 patterns in the selected part. Click a pattern to highlight it and view it in the sample slot tables below. See [Patterns](./patterns.md) for a detailed explanation of pattern data and how to copy patterns between projects.

### Track Selector

Allows filtering which tracks are shown in the tables:

- **T1–T8** — Audio tracks
- **M1–M8** — MIDI tracks
- **All Audio** — Select all audio tracks
- **All MIDI** — Select all MIDI tracks
- **None** — Deselect all

Multi-select is supported.

## Sample Slots

Two tables are shown side by side:

- **Static Slots** (S1–S128) — samples loaded into RAM
- **Flex Slots** (F1–F128) — samples streamed from the CF card

![Static sample slots list](/img/screenshots/sample-slots-static.png)

![Flex sample slots list](/img/screenshots/sample-slots-flex.png)

### Table columns

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

### Compatibility values

| Value | Meaning |
|-------|---------|
| `compatible` | File is natively supported by the Octatrack |
| `wrong_rate` | Correct format but unsupported sample rate |
| `incompatible` | File format not supported by the Octatrack |

### Filtering and sorting

Each table has a full set of filters accessible via the filter toolbar:

![Sample slots — filter toolbar](/img/screenshots/sample-slots-flex-filters.png)

![Sample slots — filter toolbar (additional filters)](/img/screenshots/sample-slots-flex-filters-bis.png)

- **Search** — filter rows by filename
- **Compatibility** — show only compatible / wrong_rate / incompatible
- **Status** — show only slots with a sample / show only empty slots
- **Source** — filter by source location
- **Gain, Timestretch, Loop, Format, Bit depth, Sample rate** — filter by any of these attributes

Click any column header to sort ascending or descending. Click again to reverse the sort direction.

### Column visibility

Click **Columns** to open the column visibility menu and show/hide individual columns. Your preferences are saved across sessions.

### Hide empty slots

Toggle **Hide empty slots** to remove rows where no sample is assigned. Useful for quickly seeing only the slots that are in use.

### Copy filename

Hover over a sample filename and click the copy icon to copy the filename to the clipboard.

## Tabs

At the top of the page, two tabs are available:

| Tab | Description |
|-----|-------------|
| **Overview** | All the panels described above |
| **Tools** | Copy operations for banks, parts, patterns, tracks, and sample slots — see [Tools](./tools/index.md) |
