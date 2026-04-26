# Project Management - Manual QA Test Cases

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Context Menu** | | | | |
| PM1 | Context Menu | Right-click project card | Right-click on any project card | Context menu appears with: Copy, Rename, Open in File Manager, Delete |
| PM2 | Context Menu | Right-click set header | Right-click on a Set header area | Context menu appears with: New Project |
| PM3 | Context Menu | Right-click set area | Right-click on the Set card background (not on a project card) | Context menu appears with: New Project |
| PM4 | Context Menu | Right-click grid background | Right-click on the projects-grid background (between cards) | Context menu appears with: New Project |
| PM5 | Context Menu | Paste appears after copy | Copy a project, then right-click set header | "Paste Project" option appears alongside "New Project" |
| PM6 | Context Menu | No paste on project card | Copy a project, then right-click another project card | No "Paste Project" option in the menu |
| PM7 | Context Menu | Escape closes menu | Open context menu, press Escape | Menu disappears |
| PM8 | Context Menu | Click outside closes menu | Open context menu, click elsewhere | Menu disappears |
| PM9 | Context Menu | No native browser menu | Right-click anywhere on the home page | Native Tauri WebView context menu (Back/Forward/Reload) never appears |
| **Create Project** | | | | |
| PM10 | Create | Via + card | Click the "+" New Project card in a Set | Create Project modal opens with empty input, focus on text field |
| PM11 | Create | Via context menu | Right-click Set header → New Project | Create Project modal opens |
| PM12 | Create | Valid name | Type "MYPROJECT" and click Create | Project card appears in the Set grid |
| PM13 | Create | Max 12 chars | Type 15 characters | Only first 12 characters accepted; counter shows "12 / 12" in white |
| PM14 | Create | Invalid char silently filtered | Type "TEST€NAME" | Input shows "TESTNAME" (€ silently removed), field shakes briefly |
| PM15 | Create | FS-forbidden char filtered | Type "A/B" | Input shows "AB" (/ silently removed), field shakes |
| PM16 | Create | Duplicate name error | Type a name that already exists in the Set | Error message "already exists" shown, Create button disabled |
| PM17 | Create | Empty name disabled | Open modal without typing | Create button is disabled |
| PM18 | Create | Enter submits | Type valid name, press Enter | Project is created (same as clicking Create) |
| PM19 | Create | Escape cancels | Open modal, press Escape | Modal closes, no project created |
| PM20 | Create | Charset info icon | Hover the ⓘ icon inside the name field | Tooltip displays full list of allowed characters |
| PM21 | Create | Files created on disk | Create project, then open in file manager | Folder contains project.work and bank01.work through bank16.work |
| **Copy Project** | | | | |
| PM22 | Copy | Via context menu | Right-click project → Copy | Green-bordered toast appears briefly: "Copied 'PROJECT_NAME'" |
| PM23 | Copy | Via Ctrl+C | Focus a project card, press Ctrl+C | Same green toast confirmation appears |
| PM24 | Copy | Toast disappears | Copy a project | Toast fades out automatically after ~1.5 seconds |
| PM25 | Copy | Paste same set | Copy project, right-click same Set area → Paste Project | Copy appears with "_2" suffix |
| PM26 | Copy | Paste different set | Copy project in SetA, right-click SetB area → Paste Project | Copy appears in SetB with original name (no suffix needed) |
| PM27 | Copy | Paste duplicate name | Copy "PROJ_A" to a Set that already has "PROJ_A" | Pasted project gets "_2" suffix; "_3" if "_2" also exists |
| PM28 | Copy | Paste via Ctrl+V | Copy with Ctrl+C, focus a card in another Set, press Ctrl+V | Project is pasted into that Set |
| PM29 | Copy | Name truncation | Copy a project named "LONG_PROJECT" (12 chars) to a Set where it already exists | Suffix "_2" applied; name truncated to fit 12-char limit |
| **Rename Project** | | | | |
| PM30 | Rename | Via context menu | Right-click project → Rename | Rename modal opens with current name pre-filled and selected |
| PM31 | Rename | Via F2 | Focus project card, press F2 | Rename modal opens |
| PM32 | Rename | Valid rename | Change name to "NEWNAME", click Rename | Card updates to show new name |
| PM33 | Rename | Unchanged name disabled | Open rename modal without changing the name | Rename button is disabled, "Name is unchanged" shown |
| PM34 | Rename | Invalid char filtered | Type invalid character in rename field | Character silently rejected, field shakes |
| PM35 | Rename | Max length enforced | Try to type beyond 12 characters | Input capped at 12; counter shows "12 / 12" in white |
| PM36 | Rename | Enter submits | Type valid new name, press Enter | Project is renamed |
| PM37 | Rename | Escape cancels | Press Escape in rename modal | Modal closes, name unchanged |
| PM38 | Rename | Charset info icon | Hover ⓘ icon in rename field | Same charset tooltip as in Create modal |
| **Move Project** | | | | |
| PM39 | Move | Drag to another set | Drag a project card to a different Set's grid | Project moves to the target Set, disappears from source |
| PM40 | Move | Same-set drag ignored | Drag a project card within the same Set | Nothing happens (no error, no move) |
| PM41 | Move | Cross-disk move safety | Move project between Sets on different disks | Project appears in destination; source removed only after verification |
| **Delete Project** | | | | |
| PM42 | Delete | Via context menu | Right-click project → Delete | Confirmation dialog appears with project name and Set name |
| PM43 | Delete | Via Delete key | Focus project card, press Delete | Same confirmation dialog appears |
| PM44 | Delete | Confirm delete | Click Delete in confirmation dialog | Project card disappears, folder removed from disk |
| PM45 | Delete | Cancel delete | Click Cancel in confirmation dialog | Dialog closes, project remains |
| PM46 | Delete | Cancel is default focus | Open delete confirmation | Cancel button has focus; pressing Enter does NOT delete |
| PM47 | Delete | Enter on Delete button | Tab to Delete button, press Enter | Project is deleted |
| PM48 | Delete | Escape cancels | Press Escape on confirmation dialog | Dialog closes, project remains |
| **Keyboard Navigation** | | | | |
| PM49 | Navigation | Tab navigates cards | Press Tab repeatedly on the projects page | Focus moves between project cards with visible orange border |
| PM50 | Navigation | Shift+Tab reverse | Press Shift+Tab | Focus moves backward through cards |
| PM51 | Navigation | Arrow keys within grid | Focus a card, press arrow keys | Focus moves to adjacent card in the expected direction |
| PM52 | Navigation | Enter opens project | Focus a project card, press Enter | Navigates to the project detail page |
| PM53 | Navigation | Focus style visible | Tab to a project card | Orange border and subtle lift effect visible on focused card |
| **Open in File Manager** | | | | |
| PM54 | File Manager | Via context menu | Right-click project → Open in File Manager | System file manager opens showing the project folder |
