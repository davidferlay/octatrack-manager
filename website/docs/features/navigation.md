---
sidebar_position: 3
---

# Navigation

The Bank Selector, Part Selector, Pattern Selector, and Track Selector are shared navigation controls available across the Project Detail view and the Parts Editor.

## Bank Selector

![Parts editor — bank selector](/img/screenshots/parts-editor-bank-selector.png)

The bank selector at the top shows all 16 banks (A–P) as buttons:

- **Highlighted button** — currently selected bank (for viewing)
- **Bold button** — bank that was active when the project was last saved
- **Greyed out** — bank with no data on disk

Click any bank button to load and display that bank's data.


## Track Selector

![Parts editor — track selector](/img/screenshots/parts-editor-track-selector.png)

Use the **Track Selector** (T1–T8 for audio, M1–M8 for MIDI) to choose which track's data is displayed. In the Project Detail view, the track selector also filters which tracks are shown in the sample slot tables.

- **T1–T8** — Audio tracks
- **M1–M8** — MIDI tracks
- **All Audio** — Select all audio tracks
- **All MIDI** — Select all MIDI tracks
- **None** — Deselect all

## Pattern Selector

Shows all 16 patterns in the selected bank. Click a pattern to highlight it and view it. See [Patterns](./patterns.md) for a detailed explanation of pattern data and how to copy patterns between projects.

## Part Selector

Within the selected bank, the **Parts** panel shows 4 tabs (Part 1–Part 4). Click a tab to view that part's data. The tab label shows the custom part name if one has been set.


## A note on partially compatible projects

When a project contains banks saved on an older or unsupported firmware version, those banks are greyed out in the selector and cannot be loaded. The app will display what it can read while clearly indicating which banks are unavailable.

![Bank selector — normal view](/img/screenshots/project-details-unsupported-banks.png)

![Bank selector — with unavailable banks](/img/screenshots/project-details-bank-selector.png)
