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
| AP17 | Browse | Search filter | Type text in the sidebar search box | Listing filters to matching file names |
| AP18 | Browse | Sort by column | Click a sidebar column header | Files sort by that column; folders stay grouped first |
| AP50 | Browse | Remember pane state across navigation | Open the pane, enter a subdirectory, scroll, then open the Audio Pool page and return via "Back to project" | Pane reopens at the same subdirectory and scroll position; Edit mode is preserved |
| **Assign via in-app drag (Edit mode)** | | | | |
| AP19 | Assign | Drag file to empty slot | In Edit mode, drag a sidebar file onto an empty slot row | Slot receives the file; PATH set and OT defaults applied (GAIN 72, etc.) |
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
| AP41 | Slot menu | Right-click a slot | Right-click any slot row | Context menu: Clear sample, Reset attributes to defaults, Import audio file(s) from system, Import audio directory from system, Open in file explorer |
| AP42 | Slot menu | Clear sample (Edit) | In Edit mode, right-click a filled slot → Clear sample | Slot becomes empty; Flex RAM (Flex tab) updates |
| AP43 | Slot menu | Disabled on empty slot | Right-click an empty slot | "Clear sample" and "Reset attributes" are disabled (nothing to clear) |
| AP44 | Slot menu | Reset attributes (Edit) | In Edit mode, right-click a filled slot → Reset attributes | Attributes reset to OT defaults (GAIN 72, TSMODE 2, LOOPMODE 0, TRIGQUANTIZATION -1); path unchanged |
| AP45 | Slot menu | Import file(s) to slot (Edit) | In Edit mode, right-click a slot → Import audio file(s) from system | File picker (multi-select) opens; chosen files are copied into the project (progress pane opens) and fill consecutive slots from that one |
| AP60 | Slot menu | Import directory to slot (Edit) | In Edit mode, right-click a slot → Import audio directory from system | Folder picker opens; audio files (recursive) are copied into the project and fill consecutive empty slots from that one |
| AP46 | Slot menu | Disabled in View mode | In View mode, right-click a slot | All mutating items are disabled; each shows a "Toggle Edit mode to modify slots" tooltip |
| AP79 | Slot menu | Clear applies to all selected | In Edit mode, select several filled slots, right-click one of them → Clear samples | Every selected slot is cleared (label reads "Clear samples"); Flex RAM updates |
| AP80 | Slot menu | Reset applies to all selected | In Edit mode, select several filled slots, right-click one → Reset attributes to defaults | Every selected slot's attributes reset to OT defaults; each sample path is kept |
| AP81 | Slot menu | Right-click outside selection | With some slots selected, right-click a different (unselected) slot → Clear sample | Only the right-clicked slot is affected (action targets the selection only when the right-clicked slot is part of it) |
| **OT-style file size** | | | | |
| AP82 | Size column | Toggle the slot Size column | In the slot table ☰ Show/Hide Columns menu, enable "Size" | A Size column appears showing each filled slot's size; empty slots show "-" |
| AP83 | Size column | OT calculation (not on-disk) | Compare a slot's Size with the file's size on disk | The value is the PCM sample-data size (frames × channels × bytes; 24-bit = 3 bytes, 16-bit = 2), not the larger on-disk size (which includes headers) |
| AP84 | Size column | Sortable | Enable Size, click the Size header | Rows sort by size (empty slots sort as smallest) |
| AP85 | Pool size | Pane/page sizes use OT calc | Open the Audio Pool pane or page and read a file's Size | The size matches the OT PCM-data calculation (same logic as flex samples), not the raw on-disk file size |
| **Open Audio Pool page (button lives in the pane)** | | | | |
| AP47 | Open page | Button present with pool | Open the Audio Pool pane in a Set with a pool | An open-Audio-Pool-page button (external-link icon) shows in the pane toolbar, between the pane toggle and the Import dropdown |
| AP48 | Open page | Hidden without pool | Open Flex tab for a project not in a Set | Neither the pane toggle nor the open-page button is shown |
| AP49 | Open page | Navigates to pool page | Click the open-Audio-Pool-page button | App navigates to the full Audio Pool page for this Set |
| AP61 | Open page | Back to project returns to tab | On the Audio Pool page reached via AP49, click "Back to project" | App returns to the originating project on the same (Flex/Static) tab; the generic "Back" button is not shown in this journey |
| **Transfers toggle** | | | | |
| AP62 | Transfers | Toggle in slot toolbar | Trigger a pool/slot import so transfers exist | A transfers toggle (exchange icon + count badge) is shown in the slot table toolbar |
| AP63 | Transfers | Active styling | While the progress pane is open | The transfers toggle uses the orange active style; clicking it hides/shows the pane |
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
| AP71 | Shortcut | Delete clears selected slots | In Edit mode, select one or more filled slots, press Delete (or Backspace) | The selected slots are cleared; Flex RAM (Flex tab) updates |
| AP72 | Shortcut | Delete ignored in View mode | In View mode, select a slot, press Delete | Nothing is cleared (slot mutation requires Edit mode) |
| AP73 | Shortcut | Ignored while typing | Focus the search box and press `a` / Delete | The keystroke edits the search text; no pane toggle / clear happens |
| **Drag a directory to slots** | | | | |
| AP74 | Dir drag | Drag pool folder to a slot (Edit) | In Edit mode, drag a folder from the Audio Pool pane onto a slot | The folder's audio files (found recursively) fill consecutive empty slots starting at the drop target |
| AP75 | Dir drag | Single click still navigates | Single-click a folder in the pane | The pane navigates into the folder (a click without dragging does not start a drag) |
| AP76 | Dir drop | Drop OS folder on a slot (Edit) | In Edit mode, drag a folder from the OS file manager onto a slot | The folder's audio files (recursive) are copied into the project and fill consecutive empty slots — no "directory" error |
| AP77 | Dir drop | Drop OS folder on the pane | Drag a folder from the OS file manager onto the Audio Pool pane | The folder's audio files (recursive) are imported into the current AUDIO/ directory |
| **Cancel an in-app drag** | | | | |
| AP78 | Cancel | Escape cancels drag | Start dragging a pool file/folder over a slot, then press Escape before releasing | The drag is cancelled with no assignment; the drag preview disappears and no slot changes |
