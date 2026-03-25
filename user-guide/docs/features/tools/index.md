---
sidebar_position: 1
---

# Tools Overview

The **Tools** tab provides powerful bulk operations for moving content between Octatrack projects. These tools let you merge live sets, copy sound designs between banks, and reorganize your sample library without manual work on the hardware.

![Tools - Overview](/img/screenshots/tools-copy-bank.png)

## Available Operations

### 1. [Copy Banks](./copy-bank.md)
Copy an entire bank (all 16 patterns and all 4 parts) to one or more destination banks, within or across projects.

### 2. [Copy Parts](./copy-parts.md)
Copy Part sound design (machines, amps, LFOs, FX) between parts, within or across projects.

### 3. [Copy Patterns](./copy-patterns.md)
Copy individual patterns between banks and projects, with configurable part assignment, track scope, and mode scope (Audio/Both/MIDI).

### 4. [Copy Tracks](./copy-tracks.md)
Copy individual track data (sound design and/or pattern triggers) between parts and patterns. Supports single-to-multiple track and pattern mapping.

### 5. [Copy Sample Slots](./copy-sample-slots.md)
Copy sample slot assignments between projects, with optional audio file transfer and Audio Pool management.

---

## General Workflow

All tools follow a consistent workflow:

1. **Select Source:** Choose the bank, part, pattern, or slots to copy from.
2. **Select Destination:** Choose the target project, bank, and location.
3. **Configure Options:** Refine exactly what data is transferred.
4. **Execute:** Perform the copy operation.

Each operation displays a description below the options explaining what it does.

---

## Safety and Data Integrity

:::warning
**Always back up your project files** before using Tools. The app writes directly to the destination project files, and these changes are not reversible within the app.
:::

- **Validation:** The interface prevents invalid selections (e.g., mixing audio and MIDI track types) and disables the Execute button until all required fields are set.
- **Direct File Modification:** These tools modify binary project files. Ensure you have backups of important work.
