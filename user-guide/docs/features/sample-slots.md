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

<img src={require('@site/static/img/screenshots/sample-slots-hover-compat.png').default} alt="Sample Slots - Hover compat" style={{width: '58%', display: 'block', margin: '0 auto'}} />

<img src={require('@site/static/img/screenshots/sample-slots-hover-status.png').default} alt="Sample Slots - Hover status" style={{width: '52%', display: 'block', margin: '0 auto'}} />

<img src={require('@site/static/img/screenshots/sample-slots-hover-source.png').default} alt="Sample Slots - Hover source" style={{width: '37%', display: 'block', margin: '0 auto'}} />

### Filtering and Sorting
The table includes a powerful toolbar to help you find what you need. 

Each column cna be sorted or filtered:
- **Filter:** Click on the 3 dots menu in column header to filter the slots form existing values.
- **Sort:** Click on any column header to sort the slots by name, path, gain, etc.

<img src={require('@site/static/img/screenshots/sample-slots-flex-filters-col-filter.png').default} alt="Sample Slots - Column filter" style={{width: '46%', display: 'block', margin: '0 auto'}} />

Additionally, you can also use these advanced features:
- **Hide Empty:** Toggle the switch to focus only on slots that have a sample assigned.
- **Search:** Type a name to filter the list instantly.

<img src={require('@site/static/img/screenshots/sample-slots-hide-empty.png').default} alt="Sample Slots - Hide Empty" style={{width: '54%', display: 'block', margin: '0 auto'}} />

<img src={require('@site/static/img/screenshots/sample-slots-search-bar.png').default} alt="Sample Slots - Search bar" style={{width: '60%', display: 'block', margin: '0 auto'}} />

![Sample Slots - Search results](/img/screenshots/sample-slots-search-results.png)

### Column Preferences
You can customize which columns are visible. Click the column menu icon in the toolbar to toggle column visibility. These preferences are remembered across sessions.

<img src={require('@site/static/img/screenshots/sample-slots-flex-filters-bis-col-selec.png').default} alt="Sample Slots - Column selector" style={{width: '50%', display: 'block', margin: '0 auto'}} />

![Sample Slots - Column visibility menu](/img/screenshots/sample-slots-flex-filters-bis.png)

