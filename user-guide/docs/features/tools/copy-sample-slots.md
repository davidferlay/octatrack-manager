---
sidebar_position: 6
---

# Copy Sample Slots

**Copy Sample Slots** manages the 256 sample slots (128 Static, 128 Flex) across projects. It copies slot assignments and can transfer or reorganize the underlying audio files.

![Tools - Copy Sample Slots](/img/screenshots/tools-copy-sample-slots.png)

## Workflow

1. **Source:** The current project's sample slots are used as the source. Select which slots to copy (individual, range, or all 128).
2. **Destination:** Select the target project and destination slot positions.
3. **Configure Options:** Choose slot type, audio file handling, and editor settings.
4. **Execute:** Perform the sample slot copy.

---

## Configuration Options

### Slot Type
- **Static + Flex:** Copy both Static and Flex slot assignments.
- **Static Only:** Copy only Static slot assignments; Flex slots are untouched.
- **Flex Only:** Copy only Flex slot assignments; Static slots are untouched.

### Audio Files
- **Copy:** Copy referenced audio files (and their `.ot` metadata files) to the destination project's sample folder.
- **Move to Pool:** Move audio files to the Set's shared `AUDIO/` folder and update slot paths to `../AUDIO/`. Only available when source and destination projects are in the same Set. If a source file is also referenced by the opposite slot type (e.g., a file used by both a Static and Flex slot), the original file is kept to avoid breaking the other reference — the success message reports how many shared files were preserved.
- **Don't Copy:** Copy only the slot assignment data (file path reference); no audio files are transferred.

:::note
When the audio file mode is set to **Copy** or **Move to Pool**, a warning badge is displayed if any source audio files are missing on disk.
:::

### Include Editor Settings
When enabled, copies sample editor settings (gain, BPM, loop mode, timestretch) and markers (trim points, loop points, slices) from the source slots. When disabled, these settings are reset to defaults in the destination.

---

## Slot Mapping

Each copied slot is assigned the correct destination slot ID matching its position in the destination array. For example, copying source slot 2 to destination slot 10 results in a slot with `slot_id = 10`, not the source's original ID.

---

## Important Notes

- **Backup Recommended:** This tool modifies project files and can move/copy audio files on disk.
- **Move to Pool:** Only available when both projects are in the same Set. The option auto-switches to "Copy" if you select a destination project in a different Set.
- **Shared Files:** When using Move to Pool, files referenced by both Static and Flex slots are not deleted from the source location to prevent breaking cross-references.
