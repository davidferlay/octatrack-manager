---
sidebar_position: 2
---

# Compatibility

Octatrack Manager is designed to work seamlessly with your Elektron Octatrack projects, but there are some critical compatibility requirements you should be aware of.

## Octatrack Firmware Requirement

:::warning
**Important:** Octatrack Manager is only compatible with projects saved on **Octatrack OS version 1.40 or later**.
:::

The project file format changed significantly in OS 1.40. If you attempt to open a project that was last saved on an older firmware version, the app may misread the data or fail to load the project entirely.

### How to update an older project:
1. Insert your CF card into your Octatrack.
2. Ensure your Octatrack is running **OS 1.40 or later**.
3. Load the older project on the device.
4. Save the project on the device (press **[FUNC] + [YES]**).
5. Eject the CF card and scan it again with Octatrack Manager.

---

## Operating Systems

Octatrack Manager is a cross-platform desktop application.

| Platform | Supported Versions |
|----------|--------------------|
| **Linux** | Debian/Ubuntu (`.deb`), Fedora/RHEL (`.rpm`), and universal `.AppImage`. |
| **macOS** | macOS 11 (Big Sur) and later. Supports both Intel and Apple Silicon (M1/M2/M3) natively. |
| **Windows** | Windows 10 and Windows 11. |

---

## Supported File Formats

### Project Files
Octatrack Manager reads the native binary files found in your project folder:
- **`project.work`**: Contains project-level settings (mixer, MIDI, slots).
- **`bank01.work` through `bank16.work`**: Contains all bank-specific data (parts, patterns).

### Audio Files
The app supports a wide range of audio formats. It automatically handles the conversion to the Octatrack's native format when you add samples to your **Audio Pool**.

#### Natively Supported (No Conversion)
These files are copied directly if they meet the Octatrack's specifications:
- **WAV:** 16-bit or 24-bit, 44.1 kHz, Mono or Stereo.
- **AIFF:** 16-bit or 24-bit, 44.1 kHz, Mono or Stereo.

#### Automatically Converted on Import
The following formats are **not** playable on the Octatrack, but Octatrack Manager will automatically convert them to **WAV 44.1 kHz** during the import process:
- **MP3**, **FLAC**, **OGG Vorbis**, **M4A / AAC**.
- **WAV/AIFF at other sample rates:** (e.g., 48 kHz, 96 kHz) are automatically resampled to 44.1 kHz using high-quality Sinc interpolation.

---

## Technical Limitations

- **Disk-Based Operation:** Octatrack Manager operates directly on the files on your CF card or computer. It does not connect to the Octatrack via USB for "live" control or parameter syncing.
- **Project Loading:** The app currently focuses on one "active" project at a time in the detail view. However, the **Tools** tab allows you to select any other project on your system as a destination for copy operations.
- **Hardware Integration:** To see your changes on the Octatrack, you must eject the CF card from your computer, insert it into the Octatrack, and load (or reload) the project on the device.
- **OS 1.40+ Only:** As noted above, older projects must be updated on the hardware first. The app cannot "up-convert" old project files automatically.
