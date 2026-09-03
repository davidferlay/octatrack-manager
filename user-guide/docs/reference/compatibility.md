---
sidebar_position: 2
---

# Compatibility

Masta-Octa is designed to work seamlessly with your Elektron Octatrack projects, but there are some critical compatibility requirements you should be aware of.

## Octatrack Firmware Requirement

:::warning
**Important:** Masta-Octa supports only Project versions that have been
explicitly verified or are recognized by its pinned parser. It does not assume
that every Octatrack OS version newer than 1.40 is compatible.
:::

The verified Project combinations currently include:

- Project `VERSION=19`, OS revision `R0173`, release `1.40`
- Project versions accepted by the pinned parser, currently OS releases
  `1.40A`, `1.40B`, and `1.40C`

The `R0173 / 1.40` exception is exact: the Project version must be 19 and both
the revision and release must match. Other values do not qualify for this local
exception; combinations not recognized by the pinned parser remain
unsupported. Masta-Octa may index an unsupported document for diagnosis, but
it keeps Edit mode unavailable.

If you attempt to open a project that was last saved on an older or unverified
firmware version, the app may be unable to parse it safely.

### How to update an older project:
1. Insert your CF card into your Octatrack.
2. Update the Octatrack to a firmware version that Masta-Octa recognizes, such as
   **OS 1.40A**, **1.40B**, or **1.40C**, or resave on the verified **R0173 / 1.40**
   combination.
3. Load the older project on the device.
4. Save the project on the device (press **[FUNC] + [YES]**).
5. Eject the CF card and scan it again with Masta-Octa.

---

## Operating Systems

Masta-Octa is a cross-platform desktop application.

| Platform | Supported Versions |
|----------|--------------------|
| **Linux** | Debian/Ubuntu (`.deb`), Fedora/RHEL (`.rpm`), and universal `.AppImage`. |
| **macOS** | macOS 10.13 (High Sierra) and later. Supports both Intel and Apple Silicon (M1/M2/M3) natively. |
| **Windows** | Windows 10 and Windows 11. |

---

## Supported File Formats

### Project Files
Masta-Octa reads the native binary files found in your project folder:
- **`project.work`**: Contains project-level settings (mixer, MIDI, slots).
- **`bank01.work` through `bank16.work`**: Contains all bank-specific data (parts, patterns).

### Audio Files
The app supports a wide range of audio formats. It automatically handles the conversion to the Octatrack's native format when you add samples to your **Audio Pool**.

#### Natively Supported (No Conversion)
These files are copied directly if they meet the Octatrack's specifications:
- **WAV:** 16-bit or 24-bit, 44.1 kHz, Mono or Stereo.
- **AIFF:** 16-bit or 24-bit, 44.1 kHz, Mono or Stereo.

#### Automatically Converted on Import
The following formats are **not** playable on the Octatrack, but Masta-Octa will automatically convert them to **WAV 44.1 kHz** during the import process:
- **MP3**, **FLAC**, **OGG Vorbis**, **M4A / AAC**.
- **WAV/AIFF at other sample rates:** (e.g., 48 kHz, 96 kHz) are automatically resampled to 44.1 kHz using high-quality Sinc interpolation.

---

## Technical Limitations

- **Disk-Based Operation:** Masta-Octa operates directly on the files on your CF card or computer. It does not connect to the Octatrack via USB for "live" control or parameter syncing.
- **Project Loading:** The app currently focuses on one "active" project at a time in the detail view. However, the **Tools** tab allows you to select any other project on your system as a destination for copy operations.
- **Hardware Integration:** To see your changes on the Octatrack, you must eject the CF card from your computer, insert it into the Octatrack, and load (or reload) the project on the device.
- **Verified Project Versions Only:** As noted above, unknown combinations
  remain read-only even if their release number appears newer. The app cannot
  "up-convert" old project files automatically.
