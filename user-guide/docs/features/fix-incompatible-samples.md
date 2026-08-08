---
sidebar_position: 14
sidebar_label: Fix Incompatible Samples
---

# Fix Incompatible Samples

The Octatrack hardware is very specific about the audio it can play: only WAV or AIFF, at 44.1 kHz, in 16- or 24-bit. Anything else is unsupported by the Octatrack.

This feature finds any incompatible files and converts them in place, wherever they live:
- in **Audio Pool**
- in individual **project's own directory**

| Tool | What | Opens from |
|------|-------|------------|
| **Fix Audio Pool Samples** | The Set's shared `AUDIO/` pool, optionally every project's own directory too | [Audio Pool](audio-pool.md)'s **Tools** tab |
| **Fix Project Samples** | This project's own directory, plus any pool file its slots reference | [Projects](navigation.md) **Tools** tab |

---

## Health Indicators

Both scopes are scanned automatically in the background, when opening either:

- **Audio Pool page:**
- **Project's Flex/Static tabs:**


Once the scan is complete, a health glyph appears. It can either indicate:
- The number of incompatible files found
    - Click it to go to **Fix Audio Pool Samples** or **Fix Project Samples**
- Or a green check if all audio files are playable by the Octatrack


Rescanning can be re-triggered fresh by clicking on:
- **Refresh file lists** in top right corner of Audio Pool page
- **Refresh project** (in top right corner of project page

---

## Fixing a single file

Specific audio files can  be converted specifically using the right-click contextual menu operation "*Convert to Octatrack format*":
- **In the Audio Pool** (pane or page): Right-click a file whose **Compat** badge isn't a happy smiley.
- **On a sample slot** (Flex/Static tab): Toggle on Edit mode and right-click a slot referencing an incompatible file.

Either way, conversion starts immediately in place and a progress throbber is displayed.

Every slot reference across all projects of Set is updated to reference the new converted file automatically.

---

## Fixing all files in bulk

In **Fix Audio Pool Samples:**

- Option "**Include all projects of Set**" can be enabled to include incompatible files found in any project's own directory, not just Audio Pool.

In **Fix Project Samples:**

- Option "**Include un-referenced samples of project**" can be enblaed to also include files found in the project's own directory that aren't assigned to any Sample Slot.

---

## Compatibility fix

- Each file is converted to **44.1 kHz 16/24-bit WAV** — the same high-quality conversion used during import into the pool.
- The **original file is replaced**: `loop.mp3` becomes `loop.wav` (a numbered suffix like `loop-1.wav` is used if that name is already taken); a 48 kHz `snare.wav` keeps its exact name.
- **Sample Slots references are updated automatically:** every project of Set that referenced an incompatible file is updated to use converted one if needed.

:::info
Each modified project file is backed up first (under that project's `backups/` directory)
:::

---

## See also

- [Manage Audio Pool](audio-pool.md) — browsing, importing and organizing the shared pool.
- [View & Manage Sample Slots](sample-slots.md) — the Audio Pool pane and per-slot Usage/Compat columns.
- [Fix Missing Samples](fix-missing-samples.md) — for slots pointing at a file that no longer exists at all, rather than one that exists but won't play.
