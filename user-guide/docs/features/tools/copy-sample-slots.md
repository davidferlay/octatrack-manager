---
sidebar_position: 6
---

# Copy Sample Slots

:::caution In Development — Coming Soon
The **Copy Sample Slots** feature is a work in progress and is not yet considered stable.
:::

The planned **Copy Sample Slots** tool allows you to manage the 256 sample slots (128 Static, 128 Flex) across projects. It is designed to copy slot assignments and potentially move underlying audio files.

![Tools - Copy Sample Slots](/img/screenshots/tools-copy-sample-slots.png)

## Current Workflow (Experimental)

1. **Source Project:** The app uses the current project by default.
2. **Destination Project:** Select the project where slots will be copied.
3. **Configure Options:** Select which slot types to copy and how to handle the audio files.
4. **Execute:** Perform the sample slot copy.

---

## Planned Configuration Options

When stable, these features are intended to work as follows:

### Slot Type Selection
- **Static + Flex:** Copy all 256 slots.
- **Static Only:** Copy only static slot assignments.
- **Flex Only:** Copy only flex slot assignments.

### Planned Audio File Options
- **Copy:** Copy referenced audio files to the destination project's sample folder.
- **Move to Pool:** Move audio files to the Set's `AUDIO/` folder and update slot paths to `../AUDIO/` automatically.
- **Don't Copy:** Only copy the filename and path reference.

:::note
When the audio file mode is set to **Copy** or **Move to Pool**, a warning badge is displayed if any source audio files are missing on disk.
:::

---

## Important Safety Notes

- **Experimental Status:** This tool modifies both project files and potentially your file system (if Copy/Move options are used).
- **Backup Mandatory:** **Always back up your destination Set** before using this tool.
- **Move to Pool Requirements:** This option is planned only for projects within the same Set.
