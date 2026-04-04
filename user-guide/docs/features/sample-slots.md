---
sidebar_position: 7
---

# Sample Slots

The Sample Slots tabs (**Flex** and **Static**) allow you to browse and manage the 256 samples assigned to your project. This is a powerful view for finding specific sounds and understanding how your project's samples are organized.

![Sample Slots - Flex Table](/img/screenshots/sample-slots-flex.png)

## Static vs. Flex Slots

The Octatrack manages memory in two distinct ways:

- **Static Slots (128):** Samples are streamed directly from the CF card. Generaly used for long recordings, backing tracks, or large sample libraries.
- **Flex Slots (128):** Samples are loaded into the Octatrack's RAM. Generaly used for real-time manipulation, slicing, and intensive sound design.

![Sample Slots - Static Table](/img/screenshots/sample-slots-static.png)

---

## Exploring the Table

Every row in the table represents a slot (S1–S128 or F1–F128). The table provides several pieces of information:

| Column | What it shows |
|--------|----------------|
| **Slot** | The slot number (prefixed with "S" for Static or "F" for Flex). |
| **Name** | The filename of the sample. Hover on it to display the full file path - relative to project's folder. |
| **Compatibility** | Whether or not the audio file is compatible with Octatrack's audio engine. Uses same icons as on Octatrack. |
| **Status** | Whether or not the audio file is found at the exact location set for Sample Slot. |
| **Source** | Whether the audio file is located in Project's directory or the Set's Audio pool. |
| **Gain** | The gain setting for that sample slot. |
| **Timestretch** | Shows the timestretch mode (Off, Normal, Beat). |
| **Loop** | Shows whether the sample is set to loop (Off, Normal). |

![Sample Slots - Hover compat](/img/screenshots/sample-slots-hover-compat.png)

![Sample Slots - Hover status](/img/screenshots/sample-slots-hover-status.png)

![Sample Slots - Hover source](/img/screenshots/sample-slots-hover-source.png)

### Filtering and Sorting
The table includes a powerful toolbar to help you find what you need. 

Each column cna be sorted or filtered:
- **Filter:** Click on the 3 dots menu in column header to filter the slots form existing values.
- **Sort:** Click on any column header to sort the slots by name, path, gain, etc.

![Sample Slots - Column filter](/img/screenshots/sample-slots-flex-filters-col-filter.png)

Additionally, you can also use these advanced features:
- **Hide Empty:** Toggle the switch to focus only on slots that have a sample assigned.
- **Search:** Type a name to filter the list instantly.

![Sample Slots - Hide Empty](/img/screenshots/sample-slots-hide-empty.png)

![Sample Slots - Search bar](/img/screenshots/sample-slots-search-bar.png)

![Sample Slots - Search results](/img/screenshots/sample-slots-search-results.png)

### Column Preferences
You can customize which columns are visible. Click the column menu icon in the toolbar to toggle column visibility. These preferences are remembered across sessions.

![Sample Slots - Column selector](/img/screenshots/sample-slots-flex-filters-bis-col-selec.png)

![Sample Slots - Column visibility menu](/img/screenshots/sample-slots-flex-filters-bis.png)

