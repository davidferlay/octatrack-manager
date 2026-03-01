---
sidebar_position: 2
---

# Compatibility

## Octatrack firmware

:::warning
Octatrack Manager is **only compatible with projects saved on OS version 1.40 or later**.

If you open a project in Octatrack Manager that was last saved on an older firmware version, the data may be misread or the project may fail to load entirely.
:::

**To update an older project:**

1. Insert the CF card into your Octatrack
2. Load the project on the device (make sure the Octatrack is running OS 1.40 or later)
3. Save the project on the device (press **FUNC + YES** on the Octatrack)
4. Eject the CF card and scan it with Octatrack Manager

## Operating systems

Octatrack Manager runs on the following platforms:

| Platform | Supported versions |
|----------|--------------------|
| **Linux** | Debian/Ubuntu (`.deb`), Fedora/RHEL (`.rpm`), universal (`.AppImage`) |
| **Windows** | Windows 10 and later |
| **macOS** | macOS 11 (Big Sur) and later, Intel and Apple Silicon |

## Project file formats

The app reads Octatrack's native binary file format:

| File | Description |
|------|-------------|
| `project.work` | Project metadata, mixer settings, MIDI settings, sample slot assignments |
| `bank01.work` – `bank16.work` | Individual bank data (parts, patterns, triggers, parameter locks) |

## Audio file formats

### Natively supported by Octatrack

These formats can be copied into the Audio Pool **without re-encoding** (provided they already meet the spec):

| Format | Requirements |
|--------|--------------|
| WAV | 16-bit or 24-bit, 44.1 kHz, stereo or mono |
| AIFF | 16-bit or 24-bit, 44.1 kHz, stereo or mono |

### Automatically converted on import

These formats are **not playable on the Octatrack hardware** in their original form, but Octatrack Manager **automatically converts them to WAV 44.1 kHz** when you copy or move them into the Audio Pool. No manual conversion step is needed.

| Format | Conversion output |
|--------|------------------|
| MP3 | WAV 44.1 kHz, bit depth from source |
| FLAC | WAV 44.1 kHz, bit depth preserved (up to 24-bit) |
| OGG Vorbis | WAV 44.1 kHz, bit depth from source |
| M4A / AAC | WAV 44.1 kHz, bit depth from source |

WAV and AIFF files that are **not at 44.1 kHz** (e.g., 48 kHz or 96 kHz) are also automatically resampled to 44.1 kHz on import using high-quality Sinc interpolation.

See [Automatic file conversion](../features/audio-pool.md#automatic-file-conversion) for the full details on how conversion works.

### Compatibility column in sample slot tables

The **Compatibility** column in the [sample slot tables](../features/project-detail.md#sample-slots) reflects whether a file is usable on the hardware:

| Value | Meaning |
|-------|---------|
| `compatible` | WAV or AIFF at 44.1 kHz with supported bit depth — plays natively |
| `wrong_rate` | WAV or AIFF but at an unsupported sample rate (e.g., 48 kHz) — needs resampling |
| `incompatible` | Format not supported by the Octatrack (MP3, FLAC, etc.) |

## Known limitations

- **Read-only for most data**: Octatrack Manager writes data only via explicit save actions (Parts Editor saves and Tools copy operations). All other browsing is non-destructive and read-only.
- **No live sync**: The app does not connect to the Octatrack over USB for live parameter control. It operates on project files on disk.
- **Single project open at a time**: The app currently shows one project at a time in the detail view, though the Tools tab lets you select any second project as a copy destination.
- **Parts editing scope**: The Parts Editor writes to the bank files on disk. Changes take effect on the Octatrack when the CF card is reinserted and the project is loaded.
