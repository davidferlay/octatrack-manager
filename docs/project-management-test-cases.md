# Project Management - Manual QA Test Cases

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Context Menu** | | | | |
| PM1 | Context Menu | Right-click project card | Right-click on any project card | Context menu appears with: Copy, Rename, Open in File Manager, Delete |
| PM2 | Context Menu | Right-click set header | Right-click on a Set header area | Context menu appears with: Copy Set, Rename Set, New Project, Delete Set |
| PM3 | Context Menu | Right-click set area | Right-click on the Set card background (not on a project card) | Context menu appears with: Copy Set, Rename Set, New Project, Delete Set |
| PM4 | Context Menu | Right-click grid background | Right-click on the projects-grid background (between cards) | Context menu appears with: Copy Set, Rename Set, New Project, Delete Set |
| PM5 | Context Menu | Paste project appears after copy | Copy a project, then right-click set header | "Paste Project" option appears alongside other Set actions |
| PM6 | Context Menu | No paste on project card | Copy a project, then right-click another project card | No "Paste Project" option in the menu |
| PM7 | Context Menu | Right-click location header | Right-click on a location header | Context menu appears with: New Set |
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
| PM23 | Create | Files created on disk | Create project, then open in file manager | Folder contains project.work and bank01.work through bank16.work |
| **Copy Project** | | | | |
| PM24 | Copy | Via context menu | Right-click project → Copy | Green-bordered toast appears briefly: "Copied 'PROJECT_NAME'" |
| PM25 | Copy | Via Ctrl+C | Focus a project card, press Ctrl+C | Same green toast confirmation appears |
| PM26 | Copy | Toast disappears | Copy a project | Toast fades out automatically after ~1.5 seconds |
| PM27 | Copy | Paste same set | Copy project, right-click same Set area → Paste Project | Progress modal appears; copy appears with "_2" suffix after completion |
| PM28 | Copy | Paste different set | Copy project in SetA, right-click SetB area → Paste Project | Progress modal appears; copy appears in SetB with original name |
| PM29 | Copy | Paste duplicate name | Copy "PROJ_A" to a Set that already has "PROJ_A" | Pasted project gets "_2" suffix; "_3" if "_2" also exists |
| PM30 | Copy | Paste via Ctrl+V | Copy with Ctrl+C, focus a card in another Set, press Ctrl+V | Project is pasted into that Set |
| PM31 | Copy | Name truncation | Copy a project with a long name to a Set where it already exists | Suffix "_2" applied; name truncated to fit 32-char limit |
| PM32 | Copy | Progress modal shows progress | Paste a project with many samples | Progress bar advances from 0% to 100%, label shows current operation |
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
| PM43 | Move | Drag to another set | Drag a project card to a different Set's grid | Project moves to the target Set, disappears from source |
| PM44 | Move | Same-set drag ignored | Drag a project card within the same Set | Nothing happens (no error, no move) |
| PM45 | Move | Cross-disk move safety | Move project between Sets on different disks | Project appears in destination; source removed only after verification |
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
| PM54 | Create Set | Valid name | Type "MYSET" and click Create | Set card appears in the location with empty project grid |
| PM55 | Create Set | AUDIO folder created | Create Set, open in file manager | Set folder contains an AUDIO subfolder |
| PM56 | Create Set | Duplicate name error | Type a Set name that already exists in the location | Error message shown, Create button disabled |
| PM57 | Create Set | Naming rules apply | Type invalid characters or exceed 32 chars | Same filtering and shake behavior as project create |
| PM58 | Copy Set | Via context menu | Right-click Set header → Copy Set | Toast appears: "Copied set 'SET_NAME'" |
| PM59 | Copy Set | Paste via location menu | Copy Set, right-click location header → Paste Set | Progress modal appears; Set copy with all projects appears after completion |
| PM60 | Copy Set | Duplicate name suffix | Paste Set in same location | Pasted Set gets "_2" suffix |
| PM61 | Copy Set | Progress and cancel | Paste a Set with many projects/samples | Progress bar shows advancement; Cancel stops operation and cleans up |
| PM62 | Rename Set | Via context menu | Right-click Set header → Rename Set | Rename modal opens with current Set name |
| PM63 | Rename Set | Valid rename | Change name to "NEWSET", click Rename | Set header updates to show new name |
| PM64 | Rename Set | Naming rules apply | Type invalid characters or exceed 32 chars | Same filtering and limits as project rename |
| PM65 | Delete Set | Via context menu | Right-click Set header → Delete Set | Confirmation dialog appears mentioning the Set name |
| PM66 | Delete Set | Confirm delete | Click Delete in confirmation dialog | Set card disappears, all projects and folder removed |
| PM67 | Delete Set | Cancel delete | Click Cancel in confirmation dialog | Dialog closes, Set remains |
| **Keyboard Navigation** | | | | |
| PM68 | Navigation | Tab navigates cards | Press Tab repeatedly on the projects page | Focus moves between project cards with visible orange border |
| PM69 | Navigation | Shift+Tab reverse | Press Shift+Tab | Focus moves backward through cards |
| PM70 | Navigation | Arrow keys within grid | Focus a card, press arrow keys | Focus moves to adjacent card in the expected direction |
| PM71 | Navigation | Enter opens project | Focus a project card, press Enter | Navigates to the project detail page |
| PM72 | Navigation | Focus style visible | Tab to a project card | Orange border and subtle lift effect visible on focused card |
| **Open in File Manager** | | | | |
| PM73 | File Manager | Via context menu | Right-click project → Open in File Manager | System file manager opens showing the project folder |
