---
sidebar_position: 3
---

# Audio Pool

The Audio Pool is the shared sample library for your Octatrack Set. It is located in the **`AUDIO/`** folder at the top level of your Set. All projects within that Set can make use of samples from this directory and assign them to Static or Flex Sample Slots.

Octatrack Manager provides an interface for browsing, managing, importing and converting new samples to your pool.

![Audio Pool interface](/img/screenshots/audio-pool.png)

## Browsing the Pool

Access the Audio Pool of a Set from the **Home Page** by clicking the **Audio Pool** card within any Set:

![Audio Pool interface](/img/screenshots/project-discovery-audio-pool.png)


### Right Panel: Your Audio Pool
This shows the contents of your `AUDIO/` directory. You can:
- **Navigate:** Double-click a folder to enter it. Click the breadcrumb to go back up.
- **Create Folders:** Click **+ New Folder** to organize your library.
- **Inspect Metadata:** Every audio file shows its sample rate, bit depth, and number of channels.
- **Filter and Sort:** Use the toolbar to filter by name, bit depth, sample rate, or audio format.

### Left Panel: Your Computer
- This is a standard file browser that lets you explore your local hard drives to find samples you want to add to your Set.

---

## Adding Samples (Copy / Move)

Octatrack Manager simplifies the process of getting new sounds into your Octatrack.

1. **Select Source:** Browse to your samples in the left panel.
2. **Select Destination:** Navigate to the folder where you want them in the right panel.
3. **Execute:** Click **Copy** button or **Copy to Pool** in right-click contextual menu.

![Copy selected Audio files from button](/img/screenshots/audio-pool-copy-button.png)

![Copy selected Audio files from contextual menu](/img/screenshots/audio-pool-copy-menu.png)


### Progress Tracking
A progress bar appears for every file, showing the current stage of the transfer:
- **Decoding:** Reading and decoding the source file into raw audio data.
- **Resampling:** Changing the sample rate to 44.1 kHz (skipped if the source is already at 44.1 kHz).
- **Writing:** Converting to the target bit depth and creating the final file in WAV format.
- **Copying:** Simply moving the file if it is already in the correct format (no conversion needed).

![Audio file conversion in progress](/img/screenshots/audio-pool-conversion.png)

---

## Automatic Conversion

The Octatrack hardware is very specific about the audio formats it can play. Octatrack Manager takes care of all this automatically — **you never need to manually convert files again**.

### What happens during import?
- **Format:** All files (MP3, FLAC, AIFF, etc.) are converted to **WAV**.
- **Sample Rate:** Every file is resampled to **44.1 kHz** (the only rate the Octatrack supports).
- **Bit Depth:** 16-bit and 24-bit depths are preserved. Files with higher or lower bit depths are automatically adjusted to the closest supported value (16 or 24-bit).

### Quality
Conversion uses a **high-quality Sinc interpolation** algorithm (Blackman-Harris windowed) for the best possible audio fidelity.

---

## Managing Conflicts

If you try to add a file with the same name as one that already exists in your pool, a conflict dialog will appear. You can choose to:
- **Overwrite:** Replace the old file with the new one.
- **Skip:** Keep the old file and don't import the new one.
- **Apply to All:** Use your choice for all subsequent conflicts in the current batch.

![File conflict confirmation modal](/img/screenshots/audio-pool-confirmation.png)

---

## Deleting Samples

To remove unwanted samples from your library:
1. Select one or more files in the right panel (Audio Pool).
2. Click **Delete**.
3. A confirmation dialog will appear to prevent accidental loss of data.

---

## Tips

- **Batch Processing:** You can select and transfer dozens of folders at once. Octatrack Manager will handle the recursive conversion of every audio file within them.
- **External Drives:** You can browse and import samples from any connected external drive or shared network.
