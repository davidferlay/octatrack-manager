---
sidebar_position: 2
---

# Project Detail

The Project Detail page shows a comprehensive view of a single Octatrack project. It is divided into several panels.

![Project detail — overview](/img/screenshots/project-details.png)

:::info Roadmap
Everything displayed on this page is intended to be editable directly in the UI later on. Editing support is being added progressively — the [Parts Editor](./parts-editor.md) is available today, with the remaining sections to follow in future releases.
:::

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


## Navigation

Use the Bank Selector, Part Selector, Pattern Selector, and Track Selector to navigate the project data. See the dedicated [Navigation](./navigation.md) page for full details.



