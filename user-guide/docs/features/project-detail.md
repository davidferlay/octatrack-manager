---
sidebar_position: 2
---

# Project Detail

The Project Detail page provides a comprehensive, high-level view of an Octatrack project. From here, you can inspect your project's settings, explore its patterns and parts, and manage its sample slots.

![Project Detail - Overview](/img/screenshots/project-details.png)

## Overview Tab

The **Overview** tab displays the global settings that define how your project behaves on the Octatrack. It is a read-only view that captures the exact state of the project when it was last saved on the hardware.

### Project Metadata
Located in the **Project Info** section, this shows:
- **Tempo:** The project BPM (40–300).
- **Time Sig:** The project's time signature (e.g., 4/4).
- **OS Version:** The firmware version used to save the project (e.g., 1.40B).

### Playback State
The **Current State** section reflects what was active on the device:
- **Bank & Pattern:** The currently active sequence.
- **Part:** The part (1–4) assigned to the current bank.
- **Mode:** Indicates whether the Octatrack was in Audio Mode or MIDI Mode.
- **Track Status:** Shows which audio and MIDI tracks were **Muted**, **Soloed**, or **Cued**.

### Mixer Settings
The **Mixer** section mirrors the Octatrack's project-level gain and routing configuration:
- **Gain AB / CD:** Input gain for the physical inputs.
- **Dir AB / CD:** Direct-through level for the inputs.
- **Phones Mix:** The blend between Main and Cue in the headphones.
- **Main / Cue Level:** The master output volumes.

### MIDI & Memory
- **MIDI Sync:** View whether Clock, Transport, and Program Change messages were enabled for send or receive.
- **MIDI Channels:** Shows the MIDI channel assigned to each track and the **Auto Channel**.
- **Memory:** Displays critical RAM allocation settings, such as **24-bit Flex** loading and **Dynamic Recorder** status.

### Metronome
The **Metronome** section displays all click track settings, including volume, pitch, and tonal/noise click preferences.

---

## Navigation Tabs

At the top of the project header, you can switch between several specialized views:

### Parts
The **Parts** tab takes you to the [Parts Editor](./parts-editor.md), where you can view and modify the sound design snapshots for each bank. This is where you edit machine types, effects, and LFOs.

### Patterns
The **Patterns** tab provides a visual representation of your sequencer data. You can inspect every trigger, parameter lock, and trig condition in your project. See [Patterns](./patterns.md) for details.

### Flex & Static Slots
The **Flex** and **Static** tabs list all 256 sample slots in your project. You can filter slots by name, check which slots are empty, and see the exact file path for every sample. See [Sample Slots](./sample-slots.md) for details.

### Tools
The **Tools** tab provides bulk operations for copying content between projects — banks, parts, patterns, tracks, and sample slots. See the [Tools Overview](./tools/index.md) for details on each operation.

---

## Action Bar

The header of the Project Detail page contains several important actions:

- **Back Button:** Return to the [Home Page](./project-discovery.md).
- **View/Edit Mode:** Use the toggle to switch between a safe, read-only view and **Edit Mode**, which enables changes in the Parts Editor.
- **Refresh (↻):** Reload the project from disk. Use this if you have manually replaced project files on your computer.
- **Save Status:** Displays when changes are being saved to `.unsaved` files or committed to the project.
- **Unsupported Banks Warning:** Appears if some bank files are from an older OS version. Click it for instructions on how to update them on your hardware.

---

## Multi-Bank View

In the **Parts** and **Patterns** tabs, you can use the **Bank Selector** to focus on a single bank (A–P) or select **All Banks** to see an overview of your entire project simultaneously. 

![Project details bank selector](/img/screenshots/project-details-bank-selector.png)

When viewing "All Banks", you can scroll through all 16 banks on a single page, making it much easier to organize complex projects.
