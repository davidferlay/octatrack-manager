---
sidebar_position: 1
---

# Tools Overview

:::caution Work in Progress — Coming Soon
The **Tools** features are currently under active development and are **not yet available in a stable release**. They are included in the current version for testing purposes and to demonstrate the planned workflow.
:::

The **Tools** tab is designed to provide powerful bulk operations for moving content between different projects. Once stabilized, these tools will allow you to merge live sets, copy sound designs between banks, and reorganize your sample library without manual work on the hardware.

![Tools - Overview](/img/screenshots/tools-copy-bank.png)

## Planned Operations (In Development)

The following operations are currently being implemented and refined:

### 1. [Copy Banks](./copy-bank.md)
Move an entire bank (all 16 patterns and all 4 parts) from one project to another.

### 2. [Copy Parts](./copy-parts.md)
Copy the sound design (Machine, Amp, LFO, FX) for all 16 tracks from one part to another, within or across projects.

### 3. [Copy Patterns](./copy-patterns.md)
Move individual patterns within or inbetween projects, with options for track scope and part assignment.

### 4. [Copy Tracks](./copy-tracks.md)
Granular copying of settings for a single track (audio or MIDI) between parts and patterns.

### 5. [Copy Sample Slots](./copy-sample-slots.md)
Manage sample slot assignments across projects and automate the movement of audio files into the Audio Pool.

---

## Experimental Workflow

While in development, the tools generally follow this workflow:

1. **Select Source:** Choose the bank, part, or pattern you want to copy from.
2. **Select Destination:** Choose the target project and location.
3. **Configure Options:** Refine exactly what data is transferred.
4. **Execute:** Perform the copy operation.

---

## Safety and Data Integrity

:::warning
Because these features are **Work in Progress**, they may behave unexpectedly or be subject to changes in future updates.

**Always back up your project files** before using any feature in the Tools tab. The app writes directly to the destination project files, and these changes are not reversible within the app.
:::

- **Real-time Validation:** The interface attempt to prevent invalid selections, but users should verify all settings carefully.
- **Direct File Modification:** These tools modify your binary project files. Ensure you have copies of your important work.
