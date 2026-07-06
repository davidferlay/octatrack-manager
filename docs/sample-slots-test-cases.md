# Audio Pool Sidebar & Sample Slot Assignment - Manual QA Test Cases

Functional test cases for browsing the Audio Pool from the Flex/Static slot tabs and
assigning samples to slots via drag & drop. Covers behavior only (not visual styling).

Preconditions unless stated otherwise: a project that **belongs to a Set** containing an
`AUDIO/` pool with at least a few audio files and one subdirectory. Open the project and
go to the **Flex** (or **Static**) tab.

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Toggle Availability** | | | | |
| AP1 | Toggle | Shown when pool exists | Open Flex tab for a project inside a Set with an AUDIO pool | An Audio Pool toggle button (columns icon) is shown in the toolbar |
| AP2 | Toggle | Hidden when no pool | Open Flex tab for a standalone project (not in a Set / no AUDIO pool) | No Audio Pool toggle button is shown |
| AP3 | Toggle | Available in View mode | With the project in View mode, hover the toggle | Button is enabled; tooltip notes the pane is read-only and Edit mode is needed to assign |
| AP4 | Toggle | Available in Edit mode | Switch to Edit mode, hover the toggle | Button is enabled; tooltip reads "Hide/Show Audio Pool" |
| AP5 | Toggle | Open the pane | Click the toggle | Audio Pool pane appears to the left of the slots table |
| AP6 | Toggle | Close the pane | Click the toggle again (or the in-pane toggle) | Audio Pool pane disappears |
| **Column Behavior** | | | | |
| AP7 | Columns | Reduce on open | Note the slot columns, then open the Audio Pool pane | Slots table reduces to Slot, Sample, Compat, Status only |
| AP8 | Columns | Restore on close | After AP7, close the Audio Pool pane | The previously visible slot columns are restored |
| AP9 | Columns | Manual toggle still works | Open pane, open the slots ☰ Show/Hide Columns menu, re-enable a hidden column | The column reappears while the pane stays open |
| AP10 | Columns | Sidebar default columns | Open the Audio Pool pane | Sidebar shows only Name and Size columns by default |
| AP11 | Columns | Sidebar reveal columns | In the sidebar ☰ menu, enable Format/Bit/kHz | Those columns appear in the sidebar |
| **Browsing** | | | | |
| AP12 | Browse | Lists pool files | Open the pane | Files and folders from the AUDIO/ root are listed |
| AP13 | Browse | Enter a subdirectory | Double-click a folder in the sidebar | Listing navigates into that folder |
| AP14 | Browse | Up navigation | Inside a subdirectory, click the up (↑) button in the bottom path row | Listing returns to the parent directory |
| AP15 | Browse | Cannot go above AUDIO/ | At the AUDIO/ root, observe the up (↑) button | Up button is disabled (cannot navigate above the pool root) |
| AP16 | Browse | Path indicator | Navigate into a subdirectory | Bottom path row shows the current path relative to AUDIO/ |
| AP17 | Browse | Search filter (recursive) | From any directory, type text in the sidebar search box | Listing shows matching files/folders from the current directory and all its subfolders (not just the current level; not above it) |
| AP96 | Browse | Search clears back to current dir | After AP17, clear the search box | Listing returns to the plain current-directory contents |
| AP97 | Browse | Hover shows pool-relative path | Hover over any file or folder in the pane | Tooltip shows the path relative to the pool root, e.g. `AUDIO/Drums/kick.wav` |
| AP101 | Browse | Search progress throbber | Type in the search box over a directory with many/deep subfolders | A small spinner shows in the search box while subfolders are scanned, replaced by the clear (×) button once results are listed |
| AP18 | Browse | Sort by column | Click a sidebar column header | Files sort by that column; folders stay grouped first |
| AP50 | Browse | Remember pane state across navigation | Open the pane, enter a subdirectory, scroll, then open the Audio Pool page and return via "Back to project" | Pane reopens at the same subdirectory and scroll position; Edit mode is preserved |
| **Assign via in-app drag (Edit mode)** | | | | |
| AP19 | Assign | Drag file to empty slot | In Edit mode, drag a sidebar file onto an empty slot row | Slot receives the file; PATH set and OT defaults applied (GAIN 48, TSMODE 2, TRIGQUANTIZATION -1, LOOPMODE 1 for Flex / 0 for Static); a TRIM_BARSx100 computed from the sample length is written; no BPMx24 line is written — matching the hardware |
| AP20 | Assign | Drag file to filled slot | Drag a sidebar file onto a non-empty slot | Only the slot PATH changes; existing attributes (gain, loop, etc.) are preserved |
| AP21 | Assign | Multi-file fills consecutive empties | Select several sidebar files, drag onto a slot | Files fill consecutive empty slots starting at the drop target |
| AP22 | Assign | Flex RAM updates | Assign a file in the Flex tab | The FREE MEM / FREE value updates to reflect the new assignment |
| AP23 | Assign | Drop target highlight | Drag over a slot row in Edit mode | The target row is visually highlighted while hovering |
| **Assign blocked in View mode** | | | | |
| AP24 | Guard | In-app drag blocked | In View mode, drag a sidebar file onto a slot | No assignment occurs; a warning appears: "Toggle Edit mode to assign samples to slots" |
| AP25 | Guard | No drop highlight in View mode | Drag over a slot row in View mode | No drop-target highlight on slot rows |
| AP26 | Guard | Browsing still works | In View mode, browse and search the sidebar | Browsing/searching works normally (read-only) |
| **OS drag & drop** | | | | |
| AP27 | OS drop | Drop OS file on slot (Edit) | In Edit mode, drag an audio file from the OS file manager onto a slot row | File is copied/converted into the project and assigned to the slot |
| AP28 | OS drop | Drop OS file on sidebar | Drag an audio file from the OS file manager onto the Audio Pool pane | File is imported (copied/converted) into the currently browsed AUDIO/ directory |
| AP29 | OS drop | Sidebar refresh after import | After AP28 completes | The new file appears in the sidebar listing |
| AP30 | OS drop | Blocked on slot in View mode | In View mode, drop an OS file on a slot row | No assignment occurs (slot assignment requires Edit mode) |
| **Slot selection** | | | | |
| AP51 | Select | Click selects a slot | Click a slot row | The row is highlighted (orange fill + outline), matching the Audio Pool table's selection style |
| AP52 | Select | Ctrl/Cmd-click toggles | Ctrl/Cmd-click several slot rows | Each toggles in/out of the selection independently |
| AP53 | Select | Shift-click extends a range | Click one slot, Shift-click another | All rows between the two (in display order) become selected |
| AP54 | Select | No count badge | Select one or more slots | No "N selected" badge is shown in the toolbar |
| AP91 | Select | Exclusive with the pane | With the Audio Pool pane open, select item(s) in the pane, then select a slot (and vice versa) | Selecting in one side clears the other — slot and pane selections are never both active at once |
| **Import into the pool from the pane** | | | | |
| AP32 | Import | Import dropdown present | Open the Audio Pool pane | A small Import (file-import) dropdown button is shown in the pane toolbar |
| AP33 | Import | Import Files… | Click Import → Files… | System file picker opens (audio filters); chosen files import into the currently browsed AUDIO/ directory |
| AP34 | Import | Available in View mode | In View mode, use the pane Import dropdown | Import works (pool import does not modify the project) |
| AP35 | Import | Refresh after import | Complete an import | The imported file appears in the pane listing |
| AP55 | Import | Import Folder… (recursive) | Click Import → Folder…, pick a folder that has audio files in subfolders | All audio files at every depth are imported into the current AUDIO/ directory |
| AP56 | Import | Progress pane opens | Trigger any pane import | The transfer progress pane opens automatically and shows per-file progress |
| **Audio Pool pane item context menu** | | | | |
| AP36 | Pane menu | Right-click a pool file | Right-click a file in the Audio Pool pane | Context menu appears with "Assign to first empty slot" |
| AP37 | Pane menu | Assign to first empty (Edit) | In Edit mode, choose "Assign to first empty slot" | File is assigned to the first empty slot (OT defaults applied) |
| AP38 | Pane menu | Multi-select assign | Select several pool files, right-click → assign to first empty | Files fill consecutive empty slots from the first empty one |
| AP39 | Pane menu | Disabled in View mode | In View mode, right-click a pool file | "Assign to first empty slot" is disabled; tooltip reads "Toggle Edit mode to assign to slots" |
| AP40 | Pane menu | No menu on folders | Right-click a folder in the pane | No assign context menu appears (folders are for navigation) |
| AP57 | Pane menu | Disabled when slots full | With no empty slot left, right-click a pool file | "Assign to first empty slot" is disabled; tooltip reads "No empty slot available" |
| AP58 | Pane menu | Assign to selected slot shown only when a slot is selected | Select a slot, then right-click a pool file | "Assign to selected slot" appears below "Assign to first empty slot"; it is absent when no slot is selected |
| AP59 | Pane menu | Assign to selected (Edit) | With a slot selected, choose "Assign to selected slot" | File is assigned starting at the selected (cursor) slot; multi-file fills consecutive empty slots from there |
| **Sample slot item context menu** | | | | |
| AP41 | Slot menu | Right-click a slot | Right-click any slot row | Context menu, in order: Clear sample & reset attributes, Clear sample assignment, Reset attributes to defaults, Import audio file(s) from system, Import audio directory from system, Open in file explorer |
| AP42 | Slot menu | Clear sample assignment keeps attributes (Edit) | In Edit mode, right-click a filled slot → Clear sample assignment | The sample reference is removed (slot shows no sample, Flex RAM updates) but the slot's attributes (GAIN, TSMODE, LOOPMODE, TRIGQUANTIZATION, TRIM_BARSx100) are kept; the sibling .ot (if any) is left in place |
| AP105 | Slot menu | Clear sample & reset attributes deletes the block (Edit) | In Edit mode, right-click a filled slot → Clear sample & reset attributes | The whole [SAMPLE] block is deleted: the slot returns to the fully-empty hardware state (no sample, attributes back to OT defaults) and any sibling .ot is backed up + deleted. Also enabled for an already-cleared slot that still has a lingering block (blank PATH but stored attributes); disabled only for a truly-empty slot and in View mode |
| AP43 | Slot menu | Disabled on empty slot | Right-click a truly-empty slot (no sample, no stored attributes) | "Clear sample assignment" and "Clear sample & reset attributes" are disabled (no block to act on); "Reset attributes to defaults" is also disabled (attributes already equal defaults — nothing to reset) |
| AP44 | Slot menu | Reset attributes (Edit) | In Edit mode, right-click a slot whose attributes differ from defaults → Reset attributes | Attributes reset to OT defaults (GAIN 48, TSMODE 2, TRIGQUANTIZATION -1, LOOPMODE 1 for Flex / 0 for Static); any stale BPMx24 / TRIM_BARSx100 line removed (the OT recomputes on load); path unchanged. The item is only enabled when the slot's attributes are not already at defaults |
| AP45 | Slot menu | Import file(s) to slot (Edit) | In Edit mode, right-click a slot → Import audio file(s) from system | File picker (multi-select) opens; chosen files are copied into the project (progress pane opens) and fill consecutive slots from that one |
| AP60 | Slot menu | Import directory to slot (Edit) | In Edit mode, right-click a slot → Import audio directory from system | Folder picker opens; audio files (recursive) are copied into the project and fill consecutive empty slots from that one |
| AP46 | Slot menu | Disabled in View mode | In View mode, right-click a slot | All mutating items are disabled; each shows a "Toggle Edit mode to modify slots" tooltip |
| AP79 | Slot menu | Clear applies to all selected | In Edit mode, select several filled slots, right-click one of them → Clear sample assignments | Every selected slot's sample is removed (attributes kept; label reads "Clear sample assignments"); Flex RAM updates. "Clear samples & reset attributes" applies to all selected too |
| AP80 | Slot menu | Reset applies to all selected | In Edit mode, select several filled slots, right-click one → Reset attributes to defaults | Every selected slot's attributes reset to OT defaults; each sample path is kept |
| AP81 | Slot menu | Right-click outside selection | With some slots selected, right-click a different (unselected) slot → Clear sample assignment | Only the right-clicked slot is affected (action targets the selection only when the right-clicked slot is part of it) |
| **OT-style file size** | | | | |
| AP82 | Size column | Toggle the slot Size column | In the slot table ☰ Show/Hide Columns menu, enable "Size" | A Size column appears showing each filled slot's size; empty slots show "-" |
| AP83 | Size column | OT calculation (not on-disk) | Compare a slot's Size with the file's size on disk | The value is the PCM sample-data size (frames × channels × bytes; 24-bit = 3 bytes, 16-bit = 2), not the larger on-disk size (which includes headers) |
| AP84 | Size column | Sortable | Enable Size, click the Size header | Rows sort by size (empty slots sort as smallest) |
| AP85 | Pool size | Pane/page sizes use OT calc | Open the Audio Pool pane or page and read a file's Size | The size matches the OT PCM-data calculation (same logic as flex samples), not the raw on-disk file size |
| **Slot drop validation** | | | | |
| AP86 | Drop guard | Non-audio dropped on slot | In Edit mode, drag a non-audio file (e.g. .txt) from the OS onto a slot | Nothing is assigned; a notice reads "No supported audio files in the dropped items" |
| AP87 | Drop guard | More files than empty slots | Drop N files where fewer than N empty slots follow the target | The files that fit are assigned to consecutive empty slots; a notice reports how many were skipped (not enough empty slots) |
| AP88 | Drop guard | Exceeds Flex RAM (Flex tab) | On the Flex tab, drop samples whose total OT size exceeds available Flex RAM | Files are assigned until the budget is reached; the rest are blocked with a notice "N skipped (not enough Flex RAM)". The check uses the exact free bytes (not the truncated MB shown on screen), so a sample that just fits is not falsely blocked |
| AP89 | Drop guard | No RAM limit on Static | Repeat AP88 on the Static tab | No Flex-RAM blocking occurs (static samples stream from the card) |
| AP90 | Drop guard | Incompatible audio (pool drag) | Drag a non-OT-compatible pool file (e.g. wrong sample rate) onto a slot | It is assigned but a notice warns it is not OT-compatible (may play incorrectly); dropping the same file from the OS instead auto-converts it on import |
| **Open Audio Pool page (button lives in the pane)** | | | | |
| AP47 | Open page | Button present with pool | Open the Audio Pool pane in a Set with a pool | An open-Audio-Pool-page button (external-link icon) shows in the pane toolbar, between the pane toggle and the Import dropdown |
| AP48 | Open page | Hidden without pool | Open Flex tab for a project not in a Set | Neither the pane toggle nor the open-page button is shown |
| AP49 | Open page | Navigates to pool page | Click the open-Audio-Pool-page button | App navigates to the full Audio Pool page for this Set |
| AP61 | Open page | Back to project returns to tab | On the Audio Pool page reached via AP49, click "Back to project" | App returns to the originating project on the same (Flex/Static) tab; the generic "Back" button is not shown in this journey |
| **Transfers toggle** | | | | |
| AP62 | Transfers | Toggle in slot toolbar | Trigger a pool/slot import so transfers exist | A transfers toggle (exchange icon + count badge) is shown in the slot table toolbar |
| AP63 | Transfers | Active styling | While the progress pane is open | The transfers toggle uses the orange active style; clicking it hides/shows the pane |
| **Audio Pool page — right (Audio Pool) pane** | | | | |
| AP98 | Page search | Recursive search | On the Audio Pool page, type in the right (Audio Pool) pane's search box | Matching files/folders from the current directory and all its subfolders are listed, not just the current level |
| AP99 | Page search | Hover shows pool-relative path | Hover over a file/folder in the right (Audio Pool) pane | Tooltip shows the path relative to the pool root, e.g. `AUDIO/Drums/kick.wav` |
| AP100 | Page search | Source pane unaffected | Type in the left (Source) pane's search box | Source pane filters only its current directory by name (no recursive search; tooltip shows the plain file name) |
| **Audio Pool page — Source pane folders** | | | | |
| AP106 | Source dir | Single click selects a folder | On the Audio Pool page, single-click a folder in the left (Source) pane | The folder is selected (highlighted); the pane does not navigate into it |
| AP107 | Source dir | Double click enters a folder | Double-click a folder in the Source pane | The pane navigates into that folder |
| AP108 | Source dir | Drag selected folder(s) to the pool | Select one or more folders in the Source pane, then drag them onto the right (Audio Pool) pane | The folders are copied recursively into the current AUDIO/ directory: audio converted, non-audio copied as-is, structure preserved; a transfer appears per dragged item |
| AP109 | Source drag | Drag file(s) to the pool | Drag one file (or several selected files/folders) from the Source pane onto the right (Audio Pool) pane | Each item is imported (audio converted when needed) into the current AUDIO/ directory; a drag overlay follows the cursor and a transfer appears per item. Works on macOS as well as Linux (pointer-based drag) |
| **Audio Pool page — OS drag & drop** | | | | |
| AP102 | OS drop | Drop OS files on the page | Drag one or more audio files from the OS file manager onto the Audio Pool page | Each file is imported (converted when needed) into the currently browsed AUDIO/ directory; a transfer appears per file |
| AP103 | OS drop | Drop an OS folder on the page | Drag a folder from the OS file manager onto the Audio Pool page | The folder is copied recursively into the current AUDIO/ directory under a same-named subfolder: audio files are converted to OT format, non-audio files are copied as-is, and the subfolder structure is preserved — no "directory" error |
| AP104 | OS drop | Drop multiple OS folders/mixed | Drag several folders (or a mix of files and folders) onto the page at once | Every dropped item is imported: files converted/copied, folders recursed; a transfer entry appears per top-level item |
| AP105 | OS drop | Folder merge overwrites | Drop an OS folder whose name already exists in the current directory | Contents are merged into the existing folder; colliding files are overwritten (no per-file conflict prompt for folder drops) |
| **Copy back to source (Audio Pool page)** | | | | |
| AP31 | Copy back | Pool → source uses shared pipeline | On the Audio Pool page, copy a destination file back to the source directory | Transfer shows in the progress pane; overwrite modal appears if a same-named file already exists |
| **Open in file explorer** | | | | |
| AP64 | Reveal | Slot → file explorer | Right-click a filled slot → Open in file explorer | The OS file explorer opens with the sample's file revealed/selected (works in View and Edit mode) |
| AP65 | Reveal | Disabled for empty/missing | Right-click an empty slot (or one whose file is missing) → observe Open in file explorer | The item is disabled (missing files show a "File not found" tooltip) |
| AP66 | Reveal | Pool file → file explorer | In the Audio Pool pane, right-click a file → Open in file explorer | The OS file explorer opens with that pool file revealed |
| AP67 | Reveal | Pool directory → file explorer | In the Audio Pool pane, right-click a folder → Open in file explorer | The OS file explorer opens that folder; the context menu shows only this item (no assign options for folders) |
| AP68 | Reveal | Project title menu | On the Project Detail page, right-click the project title | Context menu with "Open in file explorer" (opens the project folder) and "Copy path to clipboard" |
| AP69 | Reveal | Project title copy path | In the title menu, choose Copy path to clipboard | The project path is copied; a "Path copied!" toast appears (left-clicking the title still copies too) |
| **Keyboard shortcuts** | | | | |
| AP70 | Shortcut | 'a' toggles the pane | On a Flex/Static tab in a Set with a pool, press `a` (not while typing in a field) | The Audio Pool pane toggles open/closed |
| AP71 | Shortcut | Delete clears samples / resets attributes | In Edit mode, select slots, press Delete (or Backspace) | Per slot: a slot with a sample has its sample cleared (attributes kept); a slot with no sample has its attributes reset. So pressing Delete twice on the same slot first removes the sample, then clears its attributes. Mixed selections do both at once |
| AP72 | Shortcut | Delete ignored in View mode | In View mode, select a slot, press Delete | Nothing is cleared (slot mutation requires Edit mode) |
| AP73 | Shortcut | Ignored while typing | Focus the search box and press `a` / Delete | The keystroke edits the search text; no pane toggle / clear happens |
| **Drag a directory to slots** | | | | |
| AP74 | Dir drag | Drag pool folder to a slot (Edit) | In Edit mode, drag a folder from the Audio Pool pane onto a slot | The folder's audio files (found recursively) fill consecutive empty slots starting at the drop target |
| AP75 | Dir drag | Single click still navigates | Single-click a folder in the pane | The pane navigates into the folder (a click without dragging does not start a drag) |
| AP76 | Dir drop | Drop OS folder on a slot (Edit) | In Edit mode, drag a folder from the OS file manager onto a slot | The folder's audio files (recursive) are copied into the project and fill consecutive empty slots — no "directory" error |
| AP77 | Dir drop | Drop OS folder on the pane | Drag a folder from the OS file manager onto the Audio Pool pane | The folder's audio files (recursive) are imported into the current AUDIO/ directory |
| **Cancel an in-app drag** | | | | |
| AP78 | Cancel | Escape cancels drag | Start dragging a pool file/folder over a slot, then press Escape before releasing | The drag is cancelled with no assignment; the drag preview disappears and no slot changes |
| AP79 | Cancel | Escape mid-drag stays on the project | While dragging a pool file/folder over a slot on a Flex/Static tab, press Escape | The drag is cancelled but the app stays on the project (it does not navigate back to the projects list); a plain Escape with no drag still returns to the list |
| **Copy path to clipboard** | | | | |
| AP92 | Clipboard | Slot → copy path | Right-click a filled slot → Copy path to clipboard | The sample's absolute path (project folder + slot path) is placed on the clipboard; disabled for empty slots |
| AP93 | Clipboard | Pool pane file/dir → copy path | In the Audio Pool pane, right-click a file or folder → Copy path to clipboard | That item's absolute path is placed on the clipboard |
| AP94 | Clipboard | Pool page file/dir → copy path | On the Audio Pool page, right-click a file or folder → Copy path to clipboard | That item's absolute path is placed on the clipboard; disabled when multiple items are selected |
| **Edit mode persistence** | | | | |
| AP95 | Edit mode | Kept across pool round-trip | Enable Edit mode, open the Audio Pool page, click "Back to project" | The project reopens still in Edit mode |
| AP96 | Edit mode | Reset on Back to list | Enable Edit mode, click "Back" (or press Escape) to the projects list, reopen the same project | The project opens in View mode (Edit mode is not restored) |
| **Attribute defaults & reset (hardware parity)** | | | | |
| AP97 | Reset | Empty slot reset | In Edit mode, right-click an empty slot → Reset attributes to defaults | No error; the slot stays empty (any stray attribute block is removed so it matches the hardware's "no block" state) |
| AP98 | Reset | Deletes sibling .ot | Assign a sample whose audio file has a sibling `.ot` (e.g. `kick.wav` + `kick.ot`), then Reset attributes on that slot | The `.ot` file is backed up under the project's `backups/` folder, then deleted, so it can no longer re-impose custom attributes |
| AP99 | Reset | Multi-slot incl. empty | Select a mix of filled and empty slots, right-click → Reset attributes to defaults | Filled slots are normalized to defaults (path kept); empty slots are left with no block; sibling `.ot` files of filled slots are backed up + deleted |
| AP100 | Assign | Flex LOOPMODE default | In Edit mode, assign a sample to an empty Flex slot | The written block has LOOPMODE=1 and GAIN=48 (matches the hardware) |
| AP101 | Assign | Static LOOPMODE default | In Edit mode, assign a sample to an empty Static slot | The written block has LOOPMODE=0 and GAIN=48 (Flex-only difference) |
| AP102 | Assign | TRIM_BARSx100 computed | In Edit mode, assign a sample, then load the project on the Octatrack (or inspect project.work) | The slot's block has a TRIM_BARSx100 equal to the sample's musical length in bars × 100 (e.g. a 2-bar loop → 200, a half-bar one-shot → 50), matching what the OT writes when assigning the same file on hardware. The length uses the file's declared sample rate — confirmed on hardware with a 48 kHz file (1032000 frames ÷ 48000 = 21.5 s → 8 bars → 800), where the OT also wrote 800 (it uses the header rate, not the 44.1 kHz playback rate) |
| AP103 | Assign | No BPMx24 on assign | In Edit mode, assign a sample and inspect the slot's project.work block | The block contains TRIM_BARSx100 but no BPMx24 line (the hardware writes a per-slot tempo only when a slot is switched to Tempo mode, which is not part of assignment) |
| AP104 | Assign | Unreadable audio omits TRIM | In Edit mode, assign a slot to a path whose audio can't be read (missing/corrupt) | The assignment still succeeds with PATH + defaults, but no TRIM_BARSx100 is written (safe fallback; the OT will recompute on load) |
| **Sample preview & playback (player bar)** | | | | |
| PB1 | Player | Idle when nothing selected | Open a Flex/Static tab and select no slot | The playback bar shows no file name, no play control, and no timeline (idle) |
| PB2 | Player | Selecting an existing audio slot loads it | Click a slot whose file exists on disk | The bar shows the file name, a play control, a seek line, and the time as `0:00 / <duration>` |
| PB3 | Player | Play / pause | With a file loaded, click the play control | Playback starts, the control switches to pause, and the playhead advances; clicking again pauses |
| PB4 | Player | Seek | Drag or click along the seek line | The playhead jumps to that position; if playing, audio continues from the new position |
| PB5 | Player | Volume (drag / scroll) | Drag the VOL readout up/down, or scroll over it | The percentage changes between 0% and 100% and the loudness follows; the value persists across selections and app restarts |
| PB6 | Player | Auto-preview toggle | Click AUTO | AUTO turns on; selecting a single audio file now auto-plays it immediately. Toggling off returns to load-without-play. The setting persists |
| PB7 | Player | Loop toggle | Click LOOP, then play a sample to its end | LOOP turns on; the sample restarts from the beginning at the end (repeats). Toggling off plays once. The setting persists |
| PB8 | Player | Missing file is not played | Select a slot whose Status is "File missing from disk" | The bar stays idle (no name/play/timeline) and no file read is attempted |
| PB9 | Player | Non-audio path not processed | Select a slot or pool item whose extension is not a supported audio type (e.g. `.tar.gz`) | The bar stays idle; the file is never read or decoded (no UI freeze on large files) |
| PB10 | Player | Unreadable audio | Select an audio file that fails to decode | The bar shows the name with a "Can't play" note and the play control disabled |
| PB11 | Player | Supported formats | Select files of common audio types (wav, aiff, flac, mp3, ogg/opus, m4a/aac) | Each loads into the bar and plays |
| **Playback keyboard shortcuts (slots tab)** | | | | |
| PB12 | Shortcut | Space play/pause | With a file loaded, press Space (not while typing or while a button is focused) | Toggles play/pause |
| PB13 | Shortcut | Up/Down select + preview | Press Up/Down over the slots | The slot cursor moves to the previous/next slot, selects it, and previews it (auto-plays when AUTO is on, otherwise just loads) |
| PB14 | Shortcut | Ctrl+Left/Right scrub | Hold Ctrl and press Left/Right | The playhead scrubs backward/forward by a small fraction of the total duration |
| PB15 | Shortcut | Ctrl+Up/Down volume | Hold Ctrl and press Up/Down | Volume steps up/down by 5% |
| PB16 | Shortcut | Shift+Enter toggles AUTO | Press Shift+Enter | Auto-preview toggles (same as the AUTO control) |
| PB17 | Shortcut | Shift+L toggles LOOP | Press Shift+L | Loop toggles (same as the LOOP control) |
| PB18 | Shortcut | Left/Right switch panes | With the Audio Pool pane open, press Left/Right | Focus moves between the Audio Pool pane and the slots table; Up/Down then navigates within the focused side |
| PB19 | Shortcut | Ignored while typing | Focus the search box and press Space / Shift+L | The keystroke edits the text; no playback action occurs |
| **Audio Pool page - playback & navigation** | | | | |
| PB20 | Page | Arrow selection previews | On the Audio Pool page, use Up/Down in either pane to select an audio file | The selected file loads into the playback bar (auto-plays when AUTO is on) |
| PB21 | Page | 'b' toggles the Browse pane | Press `b` (not while typing) | The source (Browse) pane shows/hides |
| PB22 | Page | Enter enters a directory | With a folder at the cursor, press Enter | Navigation enters that directory |
| PB23 | Page | Backspace goes to parent | Press Backspace | Navigation goes up one directory (never above the pool/source root) |
| PB24 | Page | Space / Shift+Enter / Shift+L | Use these keys on the page | Space toggles play/pause; Shift+Enter toggles AUTO; Shift+L toggles LOOP (same as the slots tab) |
| PB25 | Page | Ctrl+arrows scrub / volume | Hold Ctrl with the arrows | Left/Right scrub the playhead; Up/Down adjust the volume |
| **Usage Column** | | | | |
| AP110 | Usage | Used column shows audible count badge | Open Flex or Static tab of a project where a slot is played by a track | The Used column shows a blue checkmark badge with the number of places the slot audibly plays |
| AP111 | Usage | Unused slot shows a dash | Look at a slot no machine references and no step locks | Used column shows a dash |
| AP112 | Usage | Blue badge popover lists audible usages | Click the blue badge of a slot assigned to a playing track machine | Popover header reads "played in N places" and lists only audible entries like "Bank A - Part 1 - T1 - Machine"; Escape or clicking elsewhere closes it |
| AP113 | Usage | Popover lists sample lock usages | Click the badge of a slot referenced by a sample lock | Popover lists entries like "Bank B - Ptn 5 - T3 - Step 12 - Lock" |
| AP114 | Usage | Gray badge popover lists never-trigged references | Open a fresh project (default slot-per-track machine assignments, no trigs) and click a gray circle badge | Popover header reads "referenced in N places, never trigged" and lists only the silent references; the blue and gray badges never show the same list |
| AP115 | Usage | Leftover locks beyond length ignored | Slot referenced only by a lock on a step beyond the pattern's length | Slot shows as unused |
| AP116 | Usage | Filter Used / Referenced / Unused | Open the Used column filter and pick each option | "Used (plays)" shows slots with audible usage; "Referenced, never trigged" shows slots with only silent references; "Unused" shows slots with none; Reset filters returns to All |
| AP117 | Usage | Sort by usage | Click the Used column header | Slots sort by audible usage count, references breaking ties |
| AP118 | Usage | Usage refreshes with project | Change slot usage on the device/file, click the refresh button, reopen the tab | Counts reflect the new state |
| AP119 | Usage | Badges centered and on one line | Look at a slot with both audible usages and never-trigged references | Both badges sit side by side on one line, centered in the column (never stacked); the column header label is centered too |
