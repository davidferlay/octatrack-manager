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
| AP14 | Browse | Back navigation | Inside a subdirectory, click the back (←) button | Listing returns to the parent directory |
| AP15 | Browse | Cannot go above AUDIO/ | At the AUDIO/ root, observe the back button | Back button is disabled (cannot navigate above the pool root) |
| AP16 | Browse | Path indicator | Navigate into a subdirectory | Bottom status bar shows the current path relative to AUDIO/ |
| AP17 | Browse | Search filter | Type text in the sidebar search box | Listing filters to matching file names |
| AP18 | Browse | Sort by column | Click a sidebar column header | Files sort by that column; folders stay grouped first |
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
| **Import into the pool from the pane** | | | | |
| AP32 | Import | Import icon present | Open the Audio Pool pane | A small Import (file-import) icon button is shown in the pane toolbar |
| AP33 | Import | Import opens dialog | Click the pane Import icon | System file picker opens (audio filters); chosen files import into the currently browsed AUDIO/ directory |
| AP34 | Import | Available in View mode | In View mode, use the pane Import icon | Import works (pool import does not modify the project) |
| AP35 | Import | Refresh after import | Complete an import | The imported file appears in the pane listing |
| **Audio Pool pane item context menu** | | | | |
| AP36 | Pane menu | Right-click a pool file | Right-click a file in the Audio Pool pane | Context menu appears with "Assign to first empty slot" |
| AP37 | Pane menu | Assign to first empty (Edit) | In Edit mode, choose "Assign to first empty slot" | File is assigned to the first empty slot (OT defaults applied) |
| AP38 | Pane menu | Multi-select assign | Select several pool files, right-click → assign to first empty | Files fill consecutive empty slots from the first empty one |
| AP39 | Pane menu | Disabled in View mode | In View mode, right-click a pool file | "Assign to first empty slot" is disabled with a "Toggle Edit mode" hint |
| AP40 | Pane menu | No menu on folders | Right-click a folder in the pane | No assign context menu appears (folders are for navigation) |
| **Sample slot item context menu** | | | | |
| AP41 | Slot menu | Right-click a slot | Right-click any slot row | Context menu: Clear sample, Reset attributes to defaults, Import audio file from system |
| AP42 | Slot menu | Clear sample (Edit) | In Edit mode, right-click a filled slot → Clear sample | Slot becomes empty; Flex RAM (Flex tab) updates |
| AP43 | Slot menu | Disabled on empty slot | Right-click an empty slot | "Clear sample" and "Reset attributes" are disabled (nothing to clear) |
| AP44 | Slot menu | Reset attributes (Edit) | In Edit mode, right-click a filled slot → Reset attributes | Attributes reset to OT defaults (GAIN 72, TSMODE 2, LOOPMODE 0, TRIGQUANTIZATION -1); path unchanged |
| AP45 | Slot menu | Import to slot (Edit) | In Edit mode, right-click a slot → Import audio file from system | File picker opens; chosen file is copied into the project and assigned to that slot |
| AP46 | Slot menu | Disabled in View mode | In View mode, right-click a slot | All mutating items are disabled with a "Toggle Edit mode" hint |
| **Open Audio Pool page** | | | | |
| AP47 | Open page | Button present with pool | Open Flex tab for a project in a Set with a pool | An open-Audio-Pool-page button (external-link icon) shows next to the show/hide toggle |
| AP48 | Open page | Hidden without pool | Open Flex tab for a project not in a Set | The open-Audio-Pool-page button is not shown |
| AP49 | Open page | Navigates to pool page | Click the open-Audio-Pool-page button | App navigates to the full Audio Pool page for this Set |
| **Copy back to source (Audio Pool page)** | | | | |
| AP31 | Copy back | Pool → source uses shared pipeline | On the Audio Pool page, copy a destination file back to the source directory | Transfer shows in the progress pane; overwrite modal appears if a same-named file already exists |
