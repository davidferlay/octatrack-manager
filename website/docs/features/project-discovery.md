---
sidebar_position: 1
---

# Project Discovery

The Home page is the starting point for finding and opening your Octatrack content.

![Project discovery — home page](/img/screenshots/project-discovery.png)

## Automatic scanning

Click **Scan for Devices** to trigger an automatic discovery pass. The app searches the following locations:

### Removable drives
- Mounted CF cards
- Mounted USB drives

### Home directory
| Path | Description |
|------|-------------|
| `~/Documents` | Documents folder |
| `~/Music` | Music folder |
| `~/Desktop` | Desktop |
| `~/Downloads` | Downloads folder |
| `~/octatrack` | Common Octatrack backup path |
| `~/Octatrack` | Alternative capitalisation |
| `~/OCTATRACK` | All-caps variant |

Click **Refresh** (↻) at any time to rescan all known locations. The button shows a spinning animation while the scan is running.

## Custom directory scanning

If your projects are in a non-standard location:

1. Click **Browse...**
2. Select the directory containing your Set(s) or project(s)
3. The app scans that directory and adds it to the results

Custom directories are remembered for the current session.

## Understanding the results

### Locations (Sets)

Sets are displayed grouped by the device or directory they were found in. Each location card shows:

- **Device type** — CF Card, USB, or Local Copy
- **Audio Pool status** — ✓ if the `AUDIO/` folder contains valid WAV/AIFF files, ✗ if it is absent or empty
- **Project count** — Number of projects inside the Set

Click **▶** to expand a location and see its individual projects. Click **▼** to collapse it.

Each project row shows:
- **Project name**
- **Project file status** — ✓ if `project.work` exists and is readable
- **Banks status** — ✓ if bank files are present

### Individual Projects

Projects that exist without a parent `AUDIO/` directory (i.e., not inside a proper Set) are grouped in the **Individual Projects** section at the bottom. These are typically standalone backups or projects copied without their audio pool.

## Sets vs Individual Projects

| | Set Project | Individual Project |
|--|------------|-------------------|
| Has `AUDIO/` folder | ✓ | ✗ |
| Can use Audio Pool manager | ✓ | ✗ |
| Can use "Move to Pool" in Tools | ✓ (same Set only) | ✗ |
| Full Tools support | ✓ | ✓ |
| Viewable in Project Detail | ✓ | ✓ |

## Opening a project

Click any project name to navigate to its [Project Detail](./project-detail.md) page. Use the back button in your browser or the breadcrumb to return to the Home page.
