---
sidebar_position: 3
---

# Audio Pool

The Audio Pool page lets you browse and manage the shared sample library (`AUDIO/` folder) associated with an Octatrack Set. It is accessible from any project that belongs to a Set.

:::note
The Audio Pool page is only available for projects that are part of a Set (i.e., the project is inside a directory that also contains an `AUDIO/` folder). Standalone individual projects do not have an Audio Pool.
:::

## Layout

![Audio Pool editor](/img/screenshots/audio-pool.png)

The Audio Pool page is divided into two panels:

- **Left panel** — The Audio Pool directory (your Set's `AUDIO/` folder and its subdirectories)
- **Right panel** — A source location for files you want to copy or move into the pool

Each panel has its own breadcrumb navigation bar.

## Browsing the Audio Pool

### Navigation

- Click a folder to enter it
- Click the **↑ Parent** button to go up one level
- The breadcrumb bar shows your current path

### Creating a folder

Click **+ New Folder** to create a subdirectory inside the current Audio Pool location. Enter a name in the dialog and confirm.

### Filtering and sorting

Each panel includes a toolbar with filter and sort controls:

| Control | Description |
|---------|-------------|
| **Search** | Filter files by name |
| **Format** | Filter by audio format: WAV, AIFF, MP3, FLAC, OGG, M4A |
| **Bit depth** | Filter by bit depth: all / 16-bit / 24-bit / 32-bit |
| **Sample rate** | Filter by sample rate: 44.1 kHz, 48 kHz, etc. |
| **Sort** | Sort by Name, Size, Format, Bit Rate, or Sample Rate |
| **Hide directories** | Toggle to show or hide subdirectory entries |

### File information

Each file row shows:

| Column | Description |
|--------|-------------|
| **Filename** | Name of the audio file |
| **Size** | File size (auto-formatted: B, KB, MB, GB) |
| **Channels** | Mono or stereo |
| **Bit depth** | 16, 24, or 32-bit |
| **Sample rate** | Sample rate in Hz |
| **Format** | Audio container format |

## Selecting files

- **Click** a file to select it
- **Ctrl+Click** (or **Cmd+Click** on macOS) to add/remove individual files from the selection
- **Shift+Click** to select a range of files
- **Arrow keys** to move through the list; <kbd>Enter</kbd> to select

## File operations

### Copying files to the pool

To copy files from the right panel into the Audio Pool:

1. Navigate to the source location in the right panel
2. Select one or more files
3. Click **Copy to Pool**

A progress bar appears for each file, showing:
- Transfer stage (converting, resampling, writing, copying)
- Transfer speed
- Estimated time remaining

### Moving files to the pool

Works the same as copying, but the source file is deleted after a successful transfer. Click **Move to Pool**.

### Deleting files

Select one or more files in the left panel (Audio Pool side) and click **Delete**. A confirmation dialog will appear before any files are removed.

### Opening in file manager

Right-click a file or folder and select **Open in File Manager** to open the location in your system's native file browser.

## Automatic file conversion

When you copy or move a file into the Audio Pool, Octatrack Manager automatically converts it to a format the Octatrack hardware can play — **you do not need to pre-convert files manually**.

### Supported input formats

All of the following formats are accepted as input:

| Format | Extensions |
|--------|------------|
| WAV | `.wav` |
| AIFF | `.aiff`, `.aif` |
| MP3 | `.mp3` |
| FLAC | `.flac` |
| OGG Vorbis | `.ogg` |
| M4A / AAC | `.m4a`, `.aac` |

### Output format

All files are converted to **WAV PCM** at **44.1 kHz**, which is the only sample rate natively supported by the Octatrack.

**Bit depth** is preserved from the source where possible:

| Source bit depth | Output bit depth |
|-----------------|-----------------|
| Less than 16-bit | 16-bit |
| 16-bit | 16-bit (unchanged) |
| 17–24-bit | Preserved as-is |
| Greater than 24-bit | 24-bit |

This means a 24-bit FLAC stays 24-bit WAV, and a 16-bit MP3 becomes a 16-bit WAV.

### When conversion happens

A file is converted if **any** of the following is true:

- It is in a compressed format (MP3, FLAC, OGG, M4A/AAC) — always converted
- It is WAV or AIFF but **not** at 44.1 kHz — resampled to 44.1 kHz
- It is WAV or AIFF with a bit depth outside the 16–24 range — bit depth adjusted

Files that are already **WAV or AIFF at 44.1 kHz with 16 or 24-bit depth** are copied directly without any re-encoding, preserving their quality exactly.

### Resampling quality

Resampling uses **high-quality Sinc interpolation** (Blackman-Harris windowed, oversampling factor 256) via the [Rubato](https://github.com/HEnquist/rubato) library — the same algorithm used in professional audio tools. No FFmpeg or external binary is required; conversion runs entirely within the app.

### Conversion progress

The progress indicator reflects the current stage of each file:

| Stage | Description |
|-------|-------------|
| **Decoding** | Reading and decoding the source file (MP3, FLAC, etc.) |
| **Resampling** | Converting the sample rate to 44.1 kHz |
| **Writing** | Encoding and writing the output WAV file |
| **Copying** | Copying an already-compatible file without re-encoding |
| **Complete** | Transfer finished successfully |

Files that require resampling spend most of their progress time in the **Resampling** stage, which is the most CPU-intensive step.

### Cancellation

Each transfer can be cancelled individually using the **Cancel** button next to its progress bar. If a transfer is cancelled mid-way, any partially written output file is automatically deleted.

## Transfer progress

![Audio file conversion in progress](/img/screenshots/audio-pool-conversion.png)

While a transfer is running, each file shows an individual progress entry:

- **Progress bar** — percentage complete
- **Speed** — current transfer speed (e.g., 12.3 MB/s)
- **ETA** — estimated time remaining
- **Stage** — what the transfer is currently doing (copying, converting, etc.)
- **Cancel** button — click to abort the transfer for that file

Once a transfer completes, the file list refreshes automatically.

## File conflict handling

![File conflict confirmation modal](/img/screenshots/audio-pool-confirmation.png)

If a file with the same name already exists at the destination, a dialog appears with these options:

| Option | Description |
|--------|-------------|
| **Overwrite** | Replace the existing file |
| **Overwrite All** | Replace this and all subsequent conflicting files |
| **Skip** | Keep the existing file and skip this one |
| **Skip All** | Skip this and all subsequent conflicts |
| **Cancel** | Abort the entire operation |

Navigate the dialog with arrow keys and confirm with <kbd>Enter</kbd>, or click the buttons directly.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move selection up/down in file list |
| <kbd>Enter</kbd> | Enter a directory / confirm selection |
| <kbd>Ctrl+A</kbd> | Select all files in panel |
| <kbd>Escape</kbd> | Cancel dialog / deselect all |
