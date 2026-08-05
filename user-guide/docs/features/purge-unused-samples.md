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
    - [Clear unused sample slot assignments](#clear-unused-sample-slot-assignments) option can be enabled to additionaly clear slots assignements which are never actually triggered - along with handling the then un-used audio files.

With **Purge Audio Pool Samples**, audio files located in Audio Pool are considered unused when no project of the Set reference them in any way.

---

## Workflow

1. Select **Purge Project Samples** or **Purge Audio Pool Samples** from the Tools tab's operation dropdown.
2. The scan runs automatically and the **Status** panel shows the count of unused audio files like:
    - _"3 unused audio files - of 128 scanned"_
    - A green **0** means everything is referenced
3. Click the status button to open a preview list of said files
4. Configure the options described below, then click **Execute**.
5. Review the planned changes (mandatory for **Delete files**) and click **Apply Changes**.

---

## Configuration Options

### Include all projects of set (Purge Audio Pool Samples only)

When enabled, every project of the Set is also scanned - in addition of the shared Set `AUDIO/` pool.

The unused count and preview list combines pool and per-project results together.

### Clear unused sample slot assignments

When enabled, slots that have a file loaded but are never triggered by any machine assignment or p-lock have their assignment cleared as part of the clean up - freeing their file for removal too. The preview count updates live to include files that would become unused once those slots are cleared.

On **Purge Audio Pool Samples**, this option (as well as **Exclude backups/ directory** below) only appears if **Include all projects of set** is checked, since clearing slots happens at projects level.

Clearing a slot in one of the included projects can also free a pool file if that slot was the file's only reference anywhere in the Set.

:::info
Clearing a slot assignment backs up the affected project's `project.work` first, under that project's `backups/` directory. See [Quick Start](../getting-started/quick-start.md#11-automatic-backups) for details.
:::

### Exclude backups/ directory

Keeps the `backups/` directory located in Projects out of the scan.

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
