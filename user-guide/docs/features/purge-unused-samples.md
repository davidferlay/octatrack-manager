---
sidebar_position: 15
---

# Purge Unused Samples

Automatically finds audio files that are not referenced anywhere and either removes them or moved them into a user-selected directory.

It comes in two flavour:

| Tool | What it scans | Opens from |
|------|----------------|------------|
| **Purge Project Samples** | This project's own directory | [Projects](navigation.md) **Tools** tab |
| **Purge Audio Pool Samples** | The Set's shared `AUDIO/` pool, optionally every project's own directory too | [Audio Pool](audio-pool.md)'s **Tools** tab |

---

## What Counts as "Unused"

An audio file is unused when no sample slot references it in any way:

- No machine assignment on any track.
- No p-lock (sample-lock) on any step.
- No sample slot even has it **loaded**
    - Set [what to purge](#what-to-purge) to **Unused sample slots** or **Both** to also clear slots that hold a sample nothing ever triggers - along with handling the files that then become unused.

With **Purge Audio Pool Samples**, audio files located in Audio Pool are considered unused when no project of the Set reference them in any way.

---

## Workflow

1. Select **Purge Project Samples** or **Purge Audio Pool Samples** from the Tools tab's operation dropdown.
2. Pick what the run should do with the first option field: **Unused audio files**, **Unused sample slots**, or **Both**.
3. The scan runs automatically and the **Status** panel shows what was found, for example:
    - _"3 unused audio files to purge - of 128 scanned in project directory"_
    - _"9 unused sample slot assignments to clear"_ on a second line, when slots are in scope
    - A green **0** means everything is referenced
4. Click the status button to open a preview list of everything that will change.
5. Configure the remaining options described below, then click **Execute**.
6. Review the planned changes (mandatory for **Delete files**) and click **Apply Changes**.

---

## Configuration Options

### What to purge

The first option field decides what the run actually does:

| Choice | Effect |
|--------|--------|
| **Unused audio files** | Deletes or moves audio files nothing references. Sample slots are left untouched. |
| **Unused sample slots** | Empties slots that hold a sample nothing ever triggers. No file is deleted or moved. |
| **Both** | Clears those slots and removes the files that leaves unreferenced, in one run. |

Options that no longer apply are hidden - a slots-only run shows no **Delete/Move** choice, no destination folder and no **Exclude backups/ directory**.

Slots that have a file loaded but are never triggered by any machine assignment or p-lock get their assignment cleared entirely, so the slot is reset and ready for another sample. A machine assigned on a track that no pattern trigs counts as never triggered - the state the Usage column labels "referenced but not triggered".

Clearing a slot can also free the file it held, when that slot was the file's only reference. This is why the unused-file count grows when you switch from **Unused audio files** to **Both**: files held only by a slot that never triggers them are not unused until that slot is cleared. The status line attributes the difference, for example _"534 unused audio files to purge (105 freed by clearing slots)"_. A slot pointing at an **Audio Pool** file is cleared without its file being touched - pool files are shared across the Set, so removing those is the job of **Purge Audio Pool Samples**.

On **Purge Audio Pool Samples**, **Unused sample slots** and **Both** are only selectable once **Include all projects of Set** is checked, since slots live in projects rather than in the pool. Turning that checkbox back off resets the choice to **Unused audio files**.

### Include all projects of Set (Purge Audio Pool Samples only)

When enabled, every project of the Set is also scanned - in addition of the shared Set `AUDIO/` pool.

The unused count and preview list combines pool and per-project results together, and the status line reads _"of N scanned in Audio Pool and all Projects of Set"_ rather than _"in Audio Pool directory"_.

:::info
Clearing a slot assignment backs up the affected project's `project.work` first, under that project's `backups/` directory. See [Quick Start](../getting-started/quick-start.md#11-automatic-backups) for details.
:::

### Exclude backups/ directory

Keeps each project's `backups/` directory out of the **unused audio files** scan, so the copies stored there are never offered for removal. It sits on the same row as the option it qualifies - "Review before applying changes" on a project, "Include all projects of Set" on the Audio Pool - and only applies when files are in scope, so a slots-only run does not show it.

### Delete or Move files to folder

- **Delete files:** Sends every unused file (and therefore empty directory) to OS Trash Bin - recoverable there until emptied.
- **Move files to folder:** Moves every unused file (and therefore empty directory) into a destination folder (either default or user-selected one), grouped by origin.

### Review before applying changes

Displays the review table before anything is done.

- When **Delete files** option is selected, this step is mandatory - deleting always requires review.
- With **Move files to folder**, it's on by default but can be turned off, in which case files are processed immediately without a review step.

---

## Default Move Destination

Default destination directory of Move operation will be first found out of:
1. **Downloads** directory
2. **Desktop** directory
3. **Home** directory
4. **Set** root directory
5. **Project's** directory

The first candidate that actually exists on disk is used as default destination.

A different directory can be selected freely by user using the **"Browse..."** button.

---

## Directory Collapsing

When every audio file inside a folder (recursively) is unused, the whole folder is removed or moved as a single unit instead of being left empty:
- **When that happens, all non-audio files inside are swept along with it**
- All affected files will be listed in preview and review lists

The same applies to an individual file's `.ot` sidecar: it travels with its sample and is listed as a child row, unless another sample sharing that stem survives.

---

## Reading the Preview and Review Tables

Both tables list every change the run will make, one row per file or slot:

| Column | Meaning |
|--------|---------|
| **Slot** | Slot(s) holding this file, e.g. `S4` or `S9, S10, S11` when several slots share one sample. A dash means no slot references it. |
| **Action** | `Delete` / `Move` for a file being removed, `Clear slot` for a slot whose file stays on disk, `Delete + Clear` / `Move + Clear` when both happen. |
| **Format** | `Audio`, or `Other` for a non-audio file swept along. Hidden by default. |
| **Origin** | The project the file came from, or `Audio Pool`. |

Every column sorts and filters. Use the **Action** filter to isolate, say, only the slots being cleared. The hamburger menu toggles column visibility.

While the run works, a progress modal shows its position and the file being handled, with a **Cancel** button. Cancelling stops between items - nothing is ever left half-moved, and the summary reports only what actually completed.

---

## Moving Files: Folder Layout

When moved, files will land under:

```
<destination>/Unused Audio/<origin>/<relative path from that origin's root>
```

- `<origin>` is the project name the file came from, or `Audio Pool`
- The relative path inside the origin is preserved:
     - File at `AUDIO/kits/808/kick.wav`
     - moves to `<destination>/Unused Audio/Audio Pool/kits/808/kick.wav`

---

## See also

- [Manage Audio Pool](audio-pool.md) - browsing, importing and organizing the shared pool.
- [View & Manage Sample Slots](sample-slots.md) - assigning and clearing individual slots by hand.
- [Fix Missing Samples](fix-missing-samples.md) - for slots pointing at a file that no longer exists, the opposite problem to an unused file that's still on disk.
