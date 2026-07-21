---
sidebar_position: 3
sidebar_label: Manage Audio Pool
---

# Manage Audio Pool

The Audio Pool is the shared sample library for your Octatrack Set. It is located in the **`AUDIO/`** folder at the top level of your Set. All projects within that Set can make use of samples from this directory and assign them to Static or Flex Sample Slots.

Octatrack Manager provides an interface for browsing, managing, importing and converting new samples to your pool.

![Audio Pool interface](/img/screenshots/audio-pool.png)

## Browsing the Pool

Access the Audio Pool of a Set from the **Home Page** by clicking the **Audio Pool** card within any Set:

<img src={require('@site/static/img/screenshots/project-discovery-audio-pool.png').default} alt="Audio Pool interface" style={{width: '58%', display: 'block', margin: '0 auto'}} />


### Right Panel: Your Audio Pool
This shows the contents of your `AUDIO/` directory. You can:
- **Navigate:** Double-click a folder to enter it. Click the breadcrumb to go back up.
- **Create Folders:** Click **+ New Folder** to organize your library.
- **Inspect Metadata:** Every audio file shows its sample rate, bit depth, and number of channels and size.
- **Check Compatibility:** The **Compat** column shows the same face icons as the Octatrack's sample browser — a smiley for playable files, a straight face for a wrong sample rate, and **??** for audio formats the device cannot play (MP3, FLAC, OGG, M4A). Non-audio files get no badge. See [Fixing Incompatible Files](#fixing-incompatible-files).
- **See Cross-Project Usage:** The **Usage** column shows, for each pool file, whether any project in the Set actually uses it — the same blue **✓ N** / gray **○ N** badges as the [Sample Slots Usage column](sample-slots.md#slot-usage). Click a badge to open a popover listing every usage, each prefixed with the project that references it (e.g. "ProjectA · Bank A · Part 1 · T1 · Machine"). The column can be sorted and filtered by Used / Referenced / Unused, just like on the Sample Slots tabs.
- **Filter and Sort:** Use the toolbar to filter by name, bit depth, sample rate, or audio format.
- **Search recursively:** Typing in the search box matches files and folders in the current directory and all of its subfolders (a spinner shows while deep folders are scanned).

### Left Panel: Your Computer
- This is a standard file browser that lets you explore your local hard drives to find samples you want to add to your Set.

---

## Adding Samples (Copy / Move)

Samples can be imported to Audio Pool in several ways:

- **Drag & drop from the Browser pane:** Drag one or more files into the Audio Pool. The drop target highlights while you hover. Several files can be added at once, as well as dragging a whole folder.
- **Drag from your computer:** Drag audio files or folders directly from OS file manager into Audio Pool pane.
- **Browser item right-click:** Right-click a file and select **Copy to Pool**.
- Select an audio file from Browser pane and click the **Copy button**

![Dragging a file from the Browser pane onto the Audio Pool](/img/screenshots/audio-pool-drag-drop.png)

<img src={require('@site/static/img/screenshots/audio-pool-copy-button.png').default} alt="Copy selected Audio files from button" style={{width: '64%', display: 'block', margin: '0 auto'}} />

<img src={require('@site/static/img/screenshots/audio-pool-copy-menu.png').default} alt="Copy selected Audio files from contextual menu" style={{width: '62%', display: 'block', margin: '0 auto'}} />

---

## Automatic Conversion

The Octatrack hardware is very specific about the audio formats it can play. Octatrack Manager converts all files added to Audio Pool automatically.

Conversion uses a **high-quality Sinc interpolation** algorithm (Blackman-Harris windowed) for the best possible audio fidelity.

### What happens during import?
- **Format:** All files (MP3, FLAC, AIFF, etc.) are converted to **WAV**.
- **Sample Rate:** Every file is resampled to **44.1 kHz** (the only rate the Octatrack supports).
- **Bit Depth:** 16-bit and 24-bit depths are preserved. Files with higher or lower bit depths are automatically adjusted to the closest supported value (16 or 24-bit).

### Progress Tracking
A progress bar appears for every file, showing the current stage of the transfer:
- **Decoding:** Reading and decoding the source file into raw audio data.
- **Resampling:** Changing the sample rate to 44.1 kHz (skipped if the source is already at 44.1 kHz).
- **Writing:** Converting to the target bit depth and creating the final file in WAV format.
- **Copying:** Simply moving the file if it is already in the correct format (no conversion needed).

![Audio file conversion in progress](/img/screenshots/audio-pool-conversion.png)

---

## Managing Conflicts

If you try to add a file with the same name as one that already exists in your pool, a conflict dialog will appear. You can choose to:
- **Overwrite:** Replace the old file with the new one.
- **Skip:** Keep the old file and don't import the new one.
- **Apply to All:** Use your choice for all subsequent conflicts in the current batch.

<img src={require('@site/static/img/screenshots/audio-pool-confirmation.png').default} alt="File conflict confirmation modal" style={{width: '64%', display: 'block', margin: '0 auto'}} />

---

## Fixing Incompatible Files

Automatic conversion covers files imported **through the app** — but a pool that was filled by hand (or by other tools) can contain MP3s, 48 kHz WAVs and other files the Octatrack silently refuses to play. Octatrack Manager finds and fixes those in place.

### Pool health indicator

The whole pool is scanned in the background when the Audio Pool page opens. Once the scan finishes, a glyph appears in the Audio Pool pane toolbar, next to the file count: an orange badge with a wrench icon and the number of incompatible files (clicking it opens the **Tools** tab with the fix tool ready), or a green check when everything is playable.

### Fixing a single file

Right-click any file with a non-smiley **Compat** badge and choose **Convert to Octatrack format**. With several incompatible files selected, the menu item converts them all at once. The conversion starts right away — no dialog: the file's **Compat** badge turns into a progress throbber, flashes a green checkmark on success, then settles back into a smiley. The same menu item is available in the [Audio Pool pane](sample-slots.md#the-audio-pool-pane) of a project's sample slots tabs.

### Fixing the whole pool

The **Tools** tab of the Audio Pool page hosts **Fix Audio Pool Samples**. Its Status pane reports how many audio files of the pool the Octatrack cannot play — just like the project's [Fix Missing Samples](fix-missing-samples.md) tool. Click the status summary to browse the list: File, Format, Bit, kHz, Size and Location columns, all sortable, filterable and drag-resizable, with search, a toggle-columns menu and copy to clipboard (the modal itself can be resized horizontally and vertically). **Execute** shows a **Review planned changes** screen with the same columns plus an Action column describing what each conversion will do before anything is touched (Location is hidden by default there — bring it back with the toggle-columns menu) — untick **Review before applying changes** in the Options panel to have Execute convert right away. Conversion runs with per-file progress and a Cancel button.

### What a fix does

- The file is converted to **44.1 kHz 16/24-bit WAV** — the same high-quality conversion used during import.
- The **original file is replaced**. A `loop.mp3` becomes `loop.wav` (a numbered suffix like `loop-1.wav` is used if that name is taken); a 48 kHz `snare.wav` keeps its exact name.
- **Sample slots are repointed automatically:** every project of the Set that referenced the old file is updated to the new name. Each modified project file is backed up first (under the project's `backups/` directory), so the change is reversible.

---

## Deleting Samples

To remove unwanted samples from your library:
1. Select one or more files in the right panel (Audio Pool).
2. Click **Delete**.
3. A confirmation dialog will appear to prevent accidental loss of data.

---

## Assigning Pool Samples to Slots

Audio Pool pane can be opened from a project's **Flex** or **Static** tab - where you can drag samples straight onto sample slots while in Edit mode.

See [Assigning & Managing Samples](sample-slots.md#assigning--managing-samples).

---

## Playback

An audio player is available the bottom of the page. Select an item from either the Browser or the Audio Pool pane to play it:
- Double-click a file to play it right away. You can also right-click it and choose **Play**.
- Use <kbd>↑</kbd> / <kbd>↓</kbd> to move to the previous / next slot and play it as you go.
- Press <kbd>Space</kbd> to **play / pause** the loaded sample.
- Hold <kbd>Ctrl</kbd> and press <kbd>←</kbd> / <kbd>→</kbd> to scrub backward / forward the timeline; or drag the play head to any position.
- Drag **VOL** up/down to change volume. You can also scroll over it, or hold <kbd>Ctrl</kbd> and press <kbd>↑</kbd> / <kbd>↓</kbd>.
- Click **LOOP** or use <kbd>Shift</kbd> + <kbd>L</kbd> to toggle sample repeat.
- Click **AUTO** or use <kbd>Shift</kbd> + <kbd>Enter</kbd>) to toggle auto playback when selecting a file.
- Press <kbd>B</kbd> to show or hide the left (Browse) panel.

![Audio player at the bottom of the Audio Pool page](/img/screenshots/audio-pool-playback.png)

Common audio formats are supported: WAV, AIFF, FLAC, MP3, OGG/Opus, and M4A/AAC.

The player is also available from [Sample Slots](sample-slots.md#playback) within projects.

---

## Tips

- **Batch Processing:** You can select and transfer dozens of folders at once. Octatrack Manager will handle the recursive conversion of every audio file within them.
- **External Drives:** You can browse and import samples from any connected external drive or shared network.
