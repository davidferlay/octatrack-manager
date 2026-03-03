---
sidebar_position: 1
---

# Introduction

**Octatrack Manager** is a task-oriented desktop application designed to simplify the management of your Elektron Octatrack projects.

Whether you are preparing for a live set, organizing years of studio work, or deep-diving into sound design, Octatrack Manager provides a clear, high-level view of your data and powerful tools that are not available directly on the hardware.

![Octatrack Manager - Project discovery](/img/project-discovery.png)

## Why use Octatrack Manager?

The Octatrack is a deep and powerful machine, but its small screen can make certain tasks tedious. Octatrack Manager bridges this gap by bringing your projects to your computer, allowing you to:

- **Save Time:** Perform bulk operations like copying banks or parts between projects (work in progress).
- **Visualize Your Projects:** See your patterns, triggers, and parameter locks clearly on a large screen.
- **Organize Your Library:** Manage your sample library with automatic format conversion and high-quality resampling.
- **Design Sounds Comfortably:** Edit machine parameters, effects, and LFOs with a dedicated interface, including a custom LFO designer.
- **Maintain Data Integrity:** Inspect projects safely with a read-only view, or use the "Edit" mode to make intentional changes.

## Core Capabilities

- **Project Discovery:** Automatically scans CF cards, USB drives, and local backups to find your projects.
- **In-Depth Inspection:** View mixer settings, MIDI configuration, memory allocation, and metronome settings for any project.
- **Pattern Visualization:** Explore every step of your sequences, including micro-timing, trig conditions, and chord information for MIDI tracks.
- **Audio Pool Management:** Browse your samples with detailed metadata (channels, bit depth, sample rate) and transfer files with automatic WAV conversion.
- **Cross-Project Copying (WIP):** Move banks, parts, patterns, tracks, and sample slots between projects (coming soon).
- **Parts Editing:** Modify sound design snapshots for both audio and MIDI tracks, with full support for machine parameters and effects.

## Essential Concepts

If you are new to the Octatrack or just need a refresher, here is how the app organizes your data:

| Concept | What it is |
|---------|-------------|
| **Set** | The top-level folder on your CF card. It contains an `AUDIO/` folder and multiple projects. |
| **Audio Pool** | The `AUDIO/` folder inside a Set. This is the shared library where all your projects look for samples. |
| **Project** | A collection of 16 banks. It also stores global settings like the mixer and MIDI configuration. |
| **Bank** | A container for 16 patterns and 4 parts. Banks are named A through P. |
| **Part** | A "kit" or "snapshot" of all settings for all 16 tracks. A bank can switch between 4 different parts. |
| **Pattern** | A sequence of notes or triggers. Patterns are assigned to one of the 4 parts in their bank. |
| **Sample Slot** | A reference to an audio file. **Static slots** stream from the card (for long samples), while **Flex slots** load into RAM (for manipulation). |

## Compatibility & Safety

:::important
**OS Requirement:** Octatrack Manager requires projects saved on **Octatrack OS 1.40 or later**. Projects from older versions must be opened and re-saved on the hardware first.
:::

**Data Safety:** Octatrack Manager treats your data with care. It uses the `ot-tools-io` library to ensure binary compatibility. When you make changes in "Edit" mode, the app writes to `.unsaved` files (similar to how the Octatrack works internally) before you commit them to your final project.

## Ready to start?

Follow the [Installation](./getting-started/installation.md) guide to get the app, then jump into the [Quick Start](./getting-started/quick-start.md) to open your first project.
