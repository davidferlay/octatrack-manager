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

If your projects are in a custom location (e.g., an external drive or a specific backup folder), click **Browse...** to select it manually.

![Project discovery — Home page](/img/screenshots/project-discovery.png)

## 2. Navigate Your Content

Found content is grouped into **Locations** (which are your Sets) and **Individual Projects**.

- **Locations:** Each card represents a Set on your disk or CF card. It shows the number of projects inside and if it has a valid Audio Pool.
- **Expand/Collapse:** Click the **▶** arrow on a location card to see the projects within it.
- **Open a Project:** Click on any project name to enter the **Project Detail** view.
- **Access the Audio Pool:** Click the **Audio Pool** card within a Set to manage your samples.

## 3. Explore Project Details

Once a project is open, you can see everything about it.

The **Overview** tab shows your mixer, MIDI, memory, and metronome settings. This is a read-only view that helps you understand how the project was configured when last saved.

![Project detail — Overview](/img/screenshots/project-details.png)

### Switching Between Tabs

At the top of the project view, you can switch between several specialized views:

- **Parts:** Manage the 4 sound snapshots (kits) for each bank.
- **Patterns:** Visualize your sequences and triggers in detail.
- **Flex / Static:** Browse and filter the 256 sample slots.
- **Tools (Coming Soon):** Access bulk copy operations between projects (Work in Progress).

## 4. Edit a Part

To modify a part, navigate to the **Parts** tab and select a bank (A–P).

1. Click on a **Part** tab (Part 1, 2, 3, or 4).
2. Toggle **Edit mode** using the switch in the top header.
3. Use the knobs and fields to modify machine parameters, effects, and LFOs.
4. Changes are saved to an `.unsaved` file automatically.
5. Click **Commit** (Save icon) to write the changes permanently to the project file.

![Parts Editor](/img/screenshots/parts-editor.png)

## 5. Manage Your Audio Pool

In the **Audio Pool** view, you can move samples from your computer into your Set.

1. Browse your computer in the right panel.
2. Select the audio files you want to add.
3. Click **Copy to Pool**.
4. Octatrack Manager will automatically convert them to the correct WAV format and resample them to 44.1 kHz if necessary.

![Audio Pool conversion](/img/screenshots/audio-pool-conversion.png)

## Tips for Success

- **Back Up First:** Always keep a backup of your important projects before making major changes with "Edit" mode.
- **Refresh:** If you insert a CF card while the app is open, click the **Refresh** (↻) button in the header.
- **Version Check:** The app automatically checks for updates. Click the version number in the header to manually check or download the latest version.
