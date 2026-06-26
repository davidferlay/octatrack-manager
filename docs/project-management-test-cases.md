# Project Management - Manual QA Test Cases

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Context Menu** | | | | |
| PM1 | Context Menu | Right-click project card | Right-click on any project card | Context menu appears with: Copy, Rename, Open in File Manager, Copy path to clipboard, Delete |
| PM2 | Context Menu | Right-click set header | Right-click on a Set header area | Context menu appears with: Copy Set, Rename Set, New Project, Open in File Manager, Copy path to clipboard, Delete Set |
| PM3 | Context Menu | Right-click set area | Right-click on the Set card background (not on a project card) | Context menu appears with: Copy Set, Rename Set, New Project, Open in File Manager, Copy path to clipboard, Delete Set |
| PM4 | Context Menu | Right-click grid background | Right-click on the projects-grid background (between cards) | Context menu appears with: Copy Set, Rename Set, New Project, Open in File Manager, Copy path to clipboard, Delete Set |
| PM100 | Context Menu | Right-click "New project" card | Right-click on the "New Project" card inside a set | Set context menu appears (Copy Set, Rename Set, New Project, ...), same as right-clicking the set background |
| PM5 | Context Menu | Paste project appears after copy | Copy a project, then right-click set header | "Paste Project" option appears alongside other Set actions |
| PM6 | Context Menu | No paste on project card | Copy a project, then right-click another project card | No "Paste Project" option in the menu |
| PM7 | Context Menu | Right-click location header | Right-click on a location header | Context menu appears with: New Set, Open in File Manager |
| PM8 | Context Menu | Paste set appears after copy | Copy a Set, then right-click location header | "Paste Set" option appears alongside "New Set" |
| PM9 | Context Menu | Escape closes menu | Open context menu, press Escape | Menu disappears |
| PM10 | Context Menu | Click outside closes menu | Open context menu, click elsewhere | Menu disappears |
| PM11 | Context Menu | No native browser menu | Right-click anywhere on the home page | Native Tauri WebView context menu (Back/Forward/Reload) never appears |
| **Create Project** | | | | |
| PM12 | Create | Via + card | Click the "+" New Project card in a Set | Create Project modal opens with empty input, focus on text field |
| PM13 | Create | Via context menu | Right-click Set header → New Project | Create Project modal opens |
| PM14 | Create | Valid name | Type "MYPROJECT" and click Create | Project card appears in the Set grid |
| PM15 | Create | Max 32 chars | Type 35 characters | Only first 32 characters accepted; counter shows "32 / 32" in white |
| PM16 | Create | Invalid char silently filtered | Type "TEST€NAME" | Input shows "TESTNAME" (€ silently removed), field shakes briefly |
| PM17 | Create | FS-forbidden char filtered | Type "A/B" | Input shows "AB" (/ silently removed), field shakes |
| PM18 | Create | Duplicate name error | Type a name that already exists in the Set | Error message "already exists" shown, Create button disabled |
| PM19 | Create | Empty name disabled | Open modal without typing | Create button is disabled |
| PM20 | Create | Enter submits | Type valid name, press Enter | Project is created (same as clicking Create) |
| PM21 | Create | Escape cancels | Open modal, press Escape | Modal closes, no project created |
| PM22 | Create | Charset info icon | Hover the ⓘ icon inside the name field | Tooltip displays full list of allowed characters |
| PM23 | Create | Files created on disk | Create project, then open in file manager | Folder contains project.work, bank01.work through bank16.work, arr01.work through arr08.work, and markers.work |
| PM23b | Create | Signed TRIGQUANTIZATION | Create a project, open its project.work | Every TRIGQUANTIZATION value is `-1` (the signed DIRECT form the hardware writes), never `255` |
| **Copy Project** | | | | |
| PM24 | Copy | Via context menu | Right-click project → Copy | Green-bordered toast appears briefly: "Copied 'PROJECT_NAME'" |
| PM25 | Copy | Via Ctrl+C | Focus a project card, press Ctrl+C | Same green toast confirmation appears |
| PM26 | Copy | Toast disappears | Copy a project | Toast fades out automatically after ~1.5 seconds |
| PM27 | Copy | Paste same set | Copy project, right-click same Set area → Paste Project | Progress modal appears; copy appears with "_2" suffix after completion |
| PM28 | Copy | Paste different set | Copy project in SetA, right-click SetB area → Paste Project | Progress modal appears; copy appears in SetB with original name |
| PM29 | Copy | Paste duplicate name | Copy "PROJ_A" to a Set that already has "PROJ_A" | Pasted project gets "_2" suffix; "_3" if "_2" also exists |
| PM30 | Copy | Paste via Ctrl+V | Copy with Ctrl+C, focus a card in another Set, press Ctrl+V | Project is pasted into that Set |
| PM31 | Copy | Name truncation | Copy a project with a long name to a Set where it already exists | Suffix "_2" applied; name truncated to fit 32-char limit |
| PM32 | Copy | Progress modal shows progress and size | Paste a project with many samples | Progress bar advances from 0% to 100%; size shown (e.g. "52 MB / 523 MB"); label shows current operation |
| PM33 | Copy | Cancel copy | Click Cancel during copy progress | Copy operation stops, partial files cleaned up, modal closes |
| **Rename Project** | | | | |
| PM34 | Rename | Via context menu | Right-click project → Rename | Rename modal opens with current name pre-filled and selected |
| PM35 | Rename | Via F2 | Focus project card, press F2 | Rename modal opens |
| PM36 | Rename | Valid rename | Change name to "NEWNAME", click Rename | Card updates to show new name |
| PM37 | Rename | Unchanged name disabled | Open rename modal without changing the name | Rename button is disabled, "Name is unchanged" shown |
| PM38 | Rename | Invalid char filtered | Type invalid character in rename field | Character silently rejected, field shakes |
| PM39 | Rename | Max length enforced | Try to type beyond 32 characters | Input capped at 32; counter shows "32 / 32" in white |
| PM40 | Rename | Enter submits | Type valid new name, press Enter | Project is renamed |
| PM41 | Rename | Escape cancels | Press Escape in rename modal | Modal closes, name unchanged |
| PM42 | Rename | Charset info icon | Hover ⓘ icon in rename field | Same charset tooltip as in Create modal |
| **Move Project** | | | | |
| PM43 | Move | Drag to another set | Drag a project card to a different Set's drop zone | Progress modal appears; project moves to the target Set, disappears from source |
| PM44 | Move | Same-set drag ignored | Drag a project card within the same Set | Nothing happens (no error, no move) |
| PM45 | Move | Cross-disk move safety | Move project between Sets on different disks | Progress bar shows copy advancement; source removed only after verification |
| PM45b | Move | Drag overlay follows cursor | Drag a project card | Compact card-sized overlay follows cursor closely |
| PM45c | Move | Cancel move in progress | Click Cancel during a cross-disk project move | Operation stops, "Cancelling..." shown on button, partial copy cleaned up |
| **Move Set** | | | | |
| PM45d | Move | Drag set to another location | Drag a Set header to a different Location | Progress modal appears; Set moves to the target Location |
| PM45e | Move | Same-location drag ignored | Drag a Set header within the same Location | Nothing happens |
| PM45f | Move | Sets not highlighted during set drag | Drag a Set header over other Sets | Other Sets do NOT highlight as drop targets; only Locations highlight |
| PM45g | Move | Location highlights on set hover | Drag a Set header over a Location (including over its child Sets) | Location card highlights with orange border |
| PM45h | Move | Cross-disk set move | Move Set between Locations on different disks | Progress bar shows advancement; source removed after verification |
| PM45i | Move | Drag overlay for set | Drag a Set header | Same compact card-sized overlay as project drag |
| **Delete Project** | | | | |
| PM46 | Delete | Via context menu | Right-click project → Delete | Confirmation dialog appears with project name and Set name |
| PM47 | Delete | Via Delete key | Focus project card, press Delete | Same confirmation dialog appears |
| PM48 | Delete | Confirm delete | Click Delete in confirmation dialog | Project card disappears, folder removed from disk |
| PM49 | Delete | Cancel delete | Click Cancel in confirmation dialog | Dialog closes, project remains |
| PM50 | Delete | Cancel is default focus | Open delete confirmation | Cancel button has focus; pressing Enter does NOT delete |
| PM51 | Delete | Enter on Delete button | Tab to Delete button, press Enter | Project is deleted |
| PM52 | Delete | Escape cancels | Press Escape on confirmation dialog | Dialog closes, project remains |
| **Set Operations** | | | | |
| PM53 | Create Set | Via location context menu | Right-click location header → New Set | Create Set modal opens with empty input |
| PM54 | Create Set | Via + button | Click the "+" button in a location header | Create Set modal opens with empty input |
| PM55 | Create Set | Valid name | Type "MYSET" and click Create | Set card appears in the location with empty project grid |
| PM56 | Create Set | AUDIO folder created | Create Set, open in file manager | Set folder contains an AUDIO subfolder |
| PM57 | Create Set | Duplicate name error | Type a Set name that already exists in the location | Error message shown, Create button disabled |
| PM58 | Create Set | Naming rules apply | Type invalid characters or exceed 32 chars | Same filtering and shake behavior as project create |
| PM59 | Copy Set | Via context menu | Right-click Set header → Copy Set | Toast appears: "Copied set 'SET_NAME'" |
| PM60 | Copy Set | Paste via location menu | Copy Set, right-click location header → Paste Set | Progress modal appears; Set copy with all projects appears after completion |
| PM61 | Copy Set | Duplicate name suffix | Paste Set in same location | Pasted Set gets "_2" suffix |
| PM62 | Copy Set | Progress and cancel | Paste a Set with many projects/samples | Progress bar shows advancement with size info; Cancel stops operation and cleans up |
| PM63 | Rename Set | Via context menu | Right-click Set header → Rename Set | Rename modal opens with current Set name |
| PM64 | Rename Set | Valid rename | Change name to "NEWSET", click Rename | Set header updates to show new name |
| PM65 | Rename Set | Naming rules apply | Type invalid characters or exceed 32 chars | Same filtering and limits as project rename |
| PM66 | Delete Set | Via context menu | Right-click Set header → Delete Set | Confirmation dialog appears mentioning the Set name |
| PM67 | Delete Set | Confirm delete | Click Delete in confirmation dialog | Set card disappears, all projects and folder removed |
| PM68 | Delete Set | Cancel delete | Click Cancel in confirmation dialog | Dialog closes, Set remains |
| **Keyboard Navigation** | | | | |
| PM69 | Navigation | Tab navigates cards | Press Tab repeatedly on the projects page | Focus moves between project cards with visible orange border |
| PM70 | Navigation | Shift+Tab reverse | Press Shift+Tab | Focus moves backward through cards |
| PM71 | Navigation | Arrow keys within grid | Focus a card, press arrow keys | Focus moves to adjacent card in the expected direction |
| PM72 | Navigation | Enter opens project | Focus a project card, press Enter | Navigates to the project detail page |
| PM73 | Navigation | Focus style visible | Tab to a project card | Orange border and subtle lift effect visible on focused card |
| **Open in File Manager** | | | | |
| PM74 | File Manager | Via context menu on project | Right-click project → Open in File Manager | System file manager opens showing the project folder |
| PM75 | File Manager | Via context menu on set | Right-click Set header → Open in File Manager | System file manager opens showing the Set folder |
| PM76 | File Manager | Via context menu on location | Right-click location header → Open in File Manager | System file manager opens showing the location folder |
| **Loading States** | | | | |
| PM77 | Loading | Delete spinner | Delete a project on a slow disk | "Deleting..." spinner shown, both buttons disabled until complete |
| PM78 | Loading | Delete double-click prevented | Click Delete twice quickly in confirmation dialog | Only one delete operation runs; second click is ignored |
| PM79 | Loading | Create spinner | Create a project on a slow disk | "Creating..." spinner shown, input and buttons disabled until complete |
| PM80 | Loading | Rename spinner | Rename a project on a slow disk | "Renaming..." spinner shown, input and buttons disabled until complete |
| PM81 | Loading | Overlay click blocked during operation | While any modal shows a spinner, click the overlay background | Modal stays open (click is ignored) |
| **Copy Progress Size** | | | | |
| PM82 | Copy | Size displayed in progress modal | Paste a project with sample files | Progress modal shows copied/total size (e.g. "52 MB / 523 MB") on the left, percentage on the right |
| PM83 | Copy Set | Size displayed in progress modal | Paste a Set with multiple projects | Progress modal shows copied/total size alongside percentage |
| **Set Detection** | | | | |
| PM84 | Discovery | Empty set detected on scan | Create a folder with only an AUDIO/ subfolder, scan that directory | Empty Set appears in the location with 0 projects |
| PM85 | Discovery | Empty set persists after rescan | Create an empty Set via the app, click Refresh | Empty Set still appears after rescan |
| **Flex RAM Display** | | | | |
| PM86 | Flex RAM | FREE MEM shown on Flex tab | Open a project with Flex samples loaded, go to Flex tab | "FREE MEM: XX.X MB" badge shown in toolbar, value accounts for loaded samples |
| PM87 | Flex RAM | FREE MEM matches Octatrack | Compare FREE MEM value with Octatrack's Flex slot list menu | Values match within ±0.1 MiB (same memory settings, same loaded samples) |
| PM88 | Flex RAM | FREE MEM not shown on Static tab | Open a project, go to Static tab | No FREE MEM badge displayed |
| PM89 | Flex RAM | FREE MEM reflects recorder settings | Open projects with different recorder buffer settings | FREE MEM value differs according to reserved recorder count and length |
| PM90 | Flex RAM | Truncation display ≥10 MiB | Open a project where free RAM is ≥10 MiB | Value shown with 1 decimal place, truncated (floor), e.g. 72.04→72.0 |
| PM91 | Flex RAM | Truncation display <10 MiB | Open a project where free RAM is <10 MiB | Value shown with 2 decimal places, truncated (floor), e.g. 9.997→9.99 |
| PM92 | Flex RAM | Empty project shows 85.5 | Open a project with no flex samples and no reserved recorders | FREE MEM shows exactly 85.5 MB (total OT RAM) |
| PM93 | Flex RAM | 16-bit recorders reduce RAM | Open project with 8×16-bit recorders at 30s | FREE MEM shows 45.1 MB (formula: 8×30×44100×2×2 bytes reserved) |
| PM94 | Flex RAM | 24-bit recorders reduce RAM more | Open project with 8×24-bit recorders at 30s | FREE MEM shows 24.9 MB (formula: 8×30×44100×2×3 bytes reserved) |
| **Memory Settings (Edit Mode)** | | | | |
| PM95 | Memory Edit | Settings editable in Edit mode | Toggle Edit mode on Overview tab | Memory fields (Flex Format, Dynamic Recorders, Recorder Format, Reserve Recordings, Reserve Length) become editable dropdowns/inputs |
| PM96 | Memory Edit | Settings read-only in View mode | Toggle Edit mode off on Overview tab | Memory fields revert to read-only labels |
| PM97 | Memory Edit | Changing recorder count updates FREE MEM | In Edit mode, change Reserve Recordings from "None" to "R1-R8" | FREE MEM badge on Flex tab updates to reflect new recorder allocation |
| PM98 | Memory Edit | Reserve Length disabled when None | Set Reserve Recordings to "None" in Edit mode | Reserve Length input is disabled/greyed out |
| PM99 | Memory Edit | Reserve Length clamped to max | Set Reserve Recordings to "R1-R8" with 16-bit recorder format | Reserve Length max is clamped to 63 (floor(89652480/(8×44100×2×2))) |
| PM100 | Memory Edit | Changes saved with debounce | Change a memory setting in Edit mode | "Writing..." status appears briefly, then "Saved" — changes persist after page reload |
| PM101 | Memory Edit | Reserve Length empty when zero | Enter Edit mode with Reserve Length = 0 | Field shows empty (placeholder "0"), not the character "0"; typing "10" shows "10" (not "010") |
| PM102 | Memory Edit | Reserve Length rejects letters | Focus Reserve Length field, press letter keys (e.g. "e", "a") | No effect on field — letters are not accepted; "e" key propagates to toggle Edit mode off |
| PM103 | Memory Edit | Reserve Length only digits | Attempt to type "1e5" or "abc" in Reserve Length | Only digit characters accepted; non-digits silently rejected |
| PM104 | Memory Edit | "e" toggles edit mode from selects | Focus any Memory dropdown (Flex Format, Reserve Recordings, etc.), press "e" | Edit mode toggles off — "e" is not consumed by the select |
| PM105 | Memory Edit | Reserve Length "s" suffix in edit mode | Enter Edit mode, set Reserve Length to any value (e.g. 16) | "s" unit label displayed inside the field next to digits, at same position as in view mode |
| PM106 | Memory Edit | No vertical layout shift on toggle | Toggle Edit mode on and off on Overview tab | Reserve Length field does not shift vertically between edit and view modes |
| **Copy path to clipboard** | | | | |
| PM107 | Clipboard | Copy project path | Right-click a project → Copy path to clipboard | The project's absolute folder path is placed on the system clipboard |
| PM108 | Clipboard | Copy set path | Right-click a Set header → Copy path to clipboard | The Set's absolute folder path is placed on the system clipboard |
| **Pattern Detail / Overview** | | | | |
| PM109 | Pattern Detail | Sample Slot shown for normal trigs | Open a pattern, select a step that has a normal sample trig (Trigger) on an audio track | Step details show "Sample Slot: N" = the track's part-assigned slot (1-based), same as for p-locked steps |
| PM110 | Pattern Detail | Sample p-lock overrides shown slot | Select a step with a sample-lock p-lock | "Sample Slot:" shows the p-locked slot number, not the part-assigned one |
| PM111 | Overview | Tempo shows one decimal | Open the Overview tab | Tempo displays with one decimal place (e.g. "120.0 BPM", "143.5 BPM") |
