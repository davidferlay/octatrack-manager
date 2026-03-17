---
sidebar_position: 7
---

# Sample Slots

The Sample Slots tabs (**Flex** and **Static**) allow you to browse and manage the 256 samples assigned to your project. This is a powerful view for finding specific sounds and understanding how your project's memory is organized.

![Sample Slots - Flex Table](/img/screenshots/sample-slots-flex.png)

## Static vs. Flex Slots

The Octatrack manages memory in two distinct ways:

- **Static Slots (128):** Samples are streamed directly from the CF card. Use these for long recordings, backing tracks, or large sample libraries.
- **Flex Slots (128):** Samples are loaded into the Octatrack's RAM. Use these for real-time manipulation, slicing, and intensive sound design.

---

## Exploring the Table

Every row in the table represents a slot (S1–S128 or F1–F128). The table provides several pieces of information:

| Column | What it shows |
|--------|----------------|
| **Slot** | The slot number (prefixed with S or F). |
| **Name** | The filename of the sample. Empty slots are clearly labeled. |
| **Path** | The full directory path within your `AUDIO/` folder. |
| **Gain** | The gain setting for that sample slot. |
| **Loop** | Shows whether the sample is set to loop (Off, Normal). |
| **Timestretch** | Shows the timestretch mode (Off, Normal, Beat). |
| **BPM** | The detected or set BPM for the sample. |

---

## Managing Your Slots

### Filtering and Sorting
The table includes a powerful toolbar to help you find what you need:
- **Search:** Type a name to filter the list instantly.
- **Hide Empty:** Toggle the switch to focus only on slots that have a sample assigned.
- **Sort:** Click on any column header to sort the slots by name, path, or gain.

![Sample Slots - Filters](/img/screenshots/sample-slots-flex-filters.png)

### Column Preferences
You can customize which columns are visible. Right-click any column header to toggle visibility. These preferences are remembered across sessions.

---

## Using Slot Data in Tools

The data from your sample slots can be used in several cross-project operations.

- **Copy Sample Slots:** Use the [Tools Overview](./tools/index.md) to copy your slot assignments (and even the audio files themselves) from one project to another.
- **Move to Pool:** If you are working on a project that has samples scattered in its project folder, the **Move to Pool** tool can gather them all into your Set's `AUDIO/` folder automatically.

---

## Technical Details

### BPM Calculation
The Octatrack stores BPM information in a specific format. Octatrack Manager decodes this automatically and displays it as a standard BPM value.

### Sample Paths
The app handles both relative and absolute paths within your Set. If a sample is missing from your `AUDIO/` folder, the name will appear, but you may see a warning indicator.
