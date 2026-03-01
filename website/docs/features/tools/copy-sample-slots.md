---
sidebar_position: 6
---

# Copy Sample Slots

![Copy Sample Slots](/img/screenshots/tools-copy-sample-slots.png)

The **Copy Sample Slots** operation copies sample slot assignments — and optionally their associated audio files — from a source project to a destination project. It supports flexible slot range mapping and three audio file handling modes.

## What gets copied

- Sample slot assignments (the reference from slot to audio file)
- Optionally: the audio files themselves
- Optionally: editor settings (gain, loop mode, timestretch mode)

## Configuration

### Slot type

Choose which slot type(s) to copy:

| Option | Slots included |
|--------|----------------|
| **Static + Flex** | All 128 static slots and all 128 flex slots (default) |
| **Static Only** | Static slots 1–128 |
| **Flex Only** | Flex slots 1–128 |

### Slot range

Define which slot numbers to include using the range inputs:

- **Source start / Source end** — the range of slots to copy from (e.g., 1 to 32)
- **Destination start / Destination end** — where those slots land in the destination (e.g., 50 to 81)

The source and destination ranges are independent. If the ranges are different sizes, the operation copies up to the length of the shorter range.

### Audio file options

Choose what to do with the audio files referenced by the slots:

#### Don't Copy (default)
Only the slot assignment (file path reference) is copied. No audio files are moved. Use this when both projects already have access to the same audio files (e.g., they share an audio pool).

#### Copy to Folder
Audio files are physically copied to a folder you specify. After copying, the slot paths in the destination are updated to point to the new location.

1. Select **Copy to Folder**
2. Click **Choose Folder** to select a target directory

#### Move to Pool
Available only when source and destination projects are **in the same Set** (share the same `AUDIO/` folder). Audio files are moved into the Set's `AUDIO/` folder, and slot paths are automatically updated to reference the pool.

This is the recommended option when consolidating samples from a project into a shared audio pool.

:::note
The **Move to Pool** option is greyed out if the source and destination projects are not in the same Set. Check the **Audio Pool Status** indicator in the Tools panel to verify.
:::

### Include editor settings

When enabled (default), copies the per-slot editor settings along with the slot assignment:

| Setting | Description |
|---------|-------------|
| **Gain** | Playback volume (0–127) |
| **Loop mode** | Off or Normal |
| **Timestretch mode** | Off, Normal, or Beat |

Disable this checkbox if you want to copy only the sample file path without overwriting the destination's own gain/loop/timestretch settings.

## Audio pool status

The Tools panel shows a status summary relevant to Copy Sample Slots:

| Indicator | Meaning |
|-----------|---------|
| **Source in Set** | Source project is part of a Set with an AUDIO folder |
| **Destination in Set** | Destination project is part of a Set with an AUDIO folder |
| **Same Set** | Both projects share the same AUDIO folder (enables Move to Pool) |

## Destination project

Click **Select Destination Project** to choose where the slots will be copied to. The destination can be:

- The **same project** (to rearrange or duplicate slots internally)
- A **different project** in the same Set
- A **different project** in a different Set

## Example workflows

**Consolidate samples from slots 1–20 into the audio pool**

1. Select **Copy Sample Slots** operation
2. Set **Slot Type** to **Static + Flex**
3. Set source range: 1 to 20; destination range: 1 to 20
4. Select **Move to Pool** as audio file option
5. Select destination project (same Set)
6. Click **Execute** — files are moved to `AUDIO/` and slot paths updated

**Copy sample assignments from Project A slots 1–10 to Project B slots 50–59**

1. Select **Copy Sample Slots** operation
2. Set **Slot Type** to **Static Only**
3. Set source range: 1 to 10
4. Set destination range: 50 to 59
5. Select **Don't Copy** (assuming audio files are already accessible)
6. Click **Select Destination Project** and choose Project B
7. Click **Execute**

**Share a sample layout between two projects without moving files**

1. Select **Copy Sample Slots** operation
2. Set **Slot Type** to **Static + Flex**
3. Keep full range (1–128)
4. Select **Don't Copy** for audio files
5. Disable **Include editor settings** if you want to keep each project's own gain/loop settings
6. Select the destination project
7. Click **Execute**

## Tips

- Before using **Move to Pool**, verify there is enough storage space in the AUDIO folder.
- Use **Don't Copy** when working with multiple projects that all reference the same audio pool — there is no need to copy the files again.
- The slot range mapping feature lets you reorganise slot assignments across projects without renaming or moving files.
