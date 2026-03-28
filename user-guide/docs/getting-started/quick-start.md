---
sidebar_position: 2
---

# Quick Start

This guide will get you up and running with Octatrack Manager in just a few minutes.

## 1. Scan for Projects

When you first open Octatrack Manager, your first task is to find your work.

Click **Scan for Projects** to let the app automatically search for:

- **Removable Drives:** Mounted CompactFlash cards and USB drives.
- **Common Paths:** Folders like `Documents`, `Music`, `Downloads`, and `Desktop`.
- **Octatrack Folders:** Any folder on your home directory named `octatrack`, `Octatrack`, or `OCTATRACK`.

If your projects are in a custom location which is not automatically detected (e.g., an external drive or a specific backup folder), click **Browse...** to select it manually.

![Project discovery — Home page](/img/screenshots/project-discovery.png)

## 2. Navigate Your Content

Found content is grouped into **Locations** (which are your Sets) and **Individual Projects**.

- **Locations:** Each card represents a Set on your disk or CF card. It shows the number of projects inside and if it has a valid Audio Pool.
- **Open a Project:** Click on any project name to enter the **Project Detail** view.
- **Access the Audio Pool of a Set:** Click the **Audio Pool** card within a Set to manage your samples.

## 3. Explore Project Details

Once a project is open, you can see everything about it.

The **Overview** tab shows your mixer, MIDI, memory, and metronome settings. This is a read-only view that helps you understand how the project was configured when last saved.

![Project detail — Overview](/img/screenshots/project-details.png)

### Switching Between Tabs

At the top of the project view, you can switch between several specialized views:

- **Parts:** Manage the 4 sound snapshots (kits) for each bank.
- **Patterns:** Visualize your sequences and triggers in detail.
- **Flex / Static:** Browse and filter the 256 sample slots.
- **Tools:** Access bulk copy operations between projects.

## 4. Edit a Part

To modify a part, navigate to the **Parts** tab and select a bank (A–P).

1. Click on a **Part** tab (Part 1, 2, 3, or 4).
2. Toggle **Edit mode** using the switch in the top header.
3. Use the knobs and fields to modify machine parameters, effects, and LFOs.
4. Each change is written to disk immediately as you make it.
5. Click **Save** to commit the current part, or **Save All** to commit all modified parts at once.

![Parts Editor](/img/screenshots/parts-editor.png)

## 5. Manage Your Audio Pool

In the **Audio Pool** view, you can move samples from your computer into your Set.

1. Browse your computer in the left panel and your Audio Pool in the right panel.
2. Select the audio files you want to add.
3. Click **Copy to Pool**.
4. Octatrack Manager will automatically convert them as needed.

![Audio Pool conversion](/img/screenshots/audio-pool-conversion.png)

## 6. Copy Content Between Projects

The **Tools** tab lets you copy content between banks and projects without touching the hardware. Select an operation from the dropdown, configure source, options, and destination, then execute.

### Available Operations

- **[Copy Banks](../features/tools/copy-bank.md):** Duplicate an entire bank (all 4 Parts + 16 Patterns) to one or more destination banks.
- **[Copy Parts](../features/tools/copy-parts.md):** Transfer Part sound design (machines, amps, LFOs, FX) between parts and banks.
- **[Copy Patterns](../features/tools/copy-patterns.md):** Copy patterns with configurable Part assignment and track scope.
- **[Copy Tracks](../features/tools/copy-tracks.md):** Copy individual track data — sound design, pattern triggers, or both.
- **[Copy Sample Slots](../features/tools/copy-sample-slots.md):** Copy sample slot assignments with optional audio file transfer and Audio Pool management.

All operations work within the same project or across different projects. The destination project can be selected from your scanned locations or browsed manually.

![Tools - Copy](/img/screenshots/tools-copy-bank.png)

:::tip
Your tool settings (selected operation, destination project, slot ranges, etc.) are remembered for each project during your session — you can switch tabs and come back without losing your configuration.
:::

---

## Tips

- **Back Up First:** Always keep a backup of your important projects before making major changes with "Edit" mode.
- **Refresh:** If you insert a CF card while the app is open, click the **Refresh** (↻) button in the header.
- **Version Check:** The app automatically checks for updates. Click the version number in the header to manually check or download the latest version.
