---
sidebar_position: 8
---

# Copy Banks

**Copy Banks** copies an entire bank — all 4 Parts and 16 Patterns — with optional sample slot transfer and automatic remapping. Useful to merge live sets or reorganize banks across your projects.

![Tools - Copy Banks](/img/screenshots/tools-copy-bank.png)

## Workflow

1. **Source:** Select the bank (A–P) to copy from the current project.
2. **Destination:** Choose the target project and one or more destination banks (A–P).
3. **Options:** Configure sample copying behavior.
4. **Execute:** Perform the bank copy.

---

## Data Copied

- **16 Patterns:** Sequences, triggers, parameter locks, and micro-timing.
- **4 Parts:** Machine settings, amplifier configuration, LFOs, and effects.
- **Part Assignments:** Pattern-to-part links.
- **Track Settings:** Swing, quantization, and other per-track parameters.
- **Sample Slots** (optional): Referenced sample slot assignments, audio files, and Audio Editor settings.

---

## Copy Sample Slots Option

When **Copy Sample Slots** is set to **Yes** (default), the app also copies the sample slots referenced by the source bank's tracks and patterns to the destination project.

### Sample Scope

Controls which sample slots are included:

| Mode | Description |
|------|-------------|
| **Used by bank** | Only slots actively referenced by the bank's Parts (track machines) and Patterns (sample locks). This is the most conservative option. |
| **All assigned** | All slots in the source project that have an audio file assigned, regardless of whether this bank uses them. |

<div style={{textAlign: 'center'}}>
<img
  src={require('@site/static/img/screenshots/tools-copy-bank-scope-used.png').default}
  alt="Sample Scope set to Used by bank"
  style={{width: '40%'}}
/><img
  src={require('@site/static/img/screenshots/tools-copy-bank-scope-all.png').default}
  alt="Sample Scope set to All assigned"
  style={{width: '40%'}}
/>
</div>

### Audio Files

Controls how audio files are handled at the destination:

| Mode | Description | Requirement |
|------|-------------|-------------|
| **Mirror** | Preserves source references: pool files stay as pool references (`../AUDIO/`), project-local files are copied to the destination project. | Same Set |
| **Copy to project** | Copies all referenced audio files into the destination project's root directory. Works across different Sets. | — |
| **Move to Pool** | Moves project-local files to the Set's Audio Pool (`AUDIO/` folder) and updates paths in both source and destination projects. | Same Set |

<img
  src={require('@site/static/img/screenshots/tools-copy-bank-audio-files.png').default}
  alt="Audio Files options"
  style={{width: '47%', display: 'block', margin: '0 auto'}}
/>

### Slot Placement

Controls where copied samples are placed in the destination's slot list:

| Mode | Description |
|------|-------------|
| **Keep position** | Places samples at the same slot number as the source. Falls back to the first free slot if that position is occupied. |
| **Stack from first** | Fills the first available slots starting from slot 1, packing samples tightly. |

<img
  src={require('@site/static/img/screenshots/tools-copy-bank-slot-placement.png').default}
  alt="Slot Placement options"
  style={{width: '47%', display: 'block', margin: '0 auto'}}
/>

### Slot Validation

Before executing, the app validates the destination project and shows a status indicator:

- **Green checkmark:** Sufficient free slots and Flex RAM available. Shows the number of slots to copy, with deduplication count if some files already exist at the destination.

<img
  src={require('@site/static/img/screenshots/tools-copy-bank-scope-used.png').default}
  alt="Green checkmark: sufficient free slots"
  style={{width: '48%', display: 'block', margin: '0 auto'}}
/>

- **Orange warning:**
  - Not enough free slots at the destination (e.g. "Not enough free Flex slots: need 70, only 1 available").
  - Source project has missing audio files (e.g. "55 audio files missing in source project"). Consider using [Fix Missing Samples](./fix-missing-samples.md) to resolve missing files first.

<div style={{textAlign: 'center'}}>
<img
  src={require('@site/static/img/screenshots/tools-copy-bank-validation-slots.png').default}
  alt="Validation warning: not enough free slots"
  style={{width: '46%'}}
/><img
  src={require('@site/static/img/screenshots/tools-copy-bank-validation-missing.png').default}
  alt="Validation warning: missing audio files in source project"
  style={{width: '48%'}}
/>
</div>

- **Red error:** Not enough free slots or insufficient Flex RAM. The Execute button is disabled with details in the tooltip.

<img
  src={require('@site/static/img/screenshots/tools-copy-bank-validation-ram.png').default}
  alt="Validation error: not enough Flex RAM"
  style={{width: '45%', display: 'block', margin: '0 auto'}}
/>

### Automatic Remapping

When copying samples, the app automatically remaps all slot references in the copied bank data (Parts and Patterns) to point to the new slot positions in the destination. If a file with the same name already exists in the destination, the existing slot is reused instead of creating a duplicate.

---

## Important Notes

- **Destructive Operation:** Copying a bank replaces all existing data at the destination.
- **Automatic Backup:** The app automatically backs up destination bank files before executing. See [Quick Start](../getting-started/quick-start.md#8-automatic-backups) for details.
- **Multi-bank Destination:** You can select multiple destination banks to copy the same source bank to several targets at once.
