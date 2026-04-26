---
sidebar_position: 4
---

# Project Management

Manage Octatrack projects directly from Projects List — create new ones, copy, rename, move across Sets, and delete.

## Context Menu

Right-click to access project management actions:

- **On a project card:** Copy, Rename, Open in File Manager, Delete.
- **On a Set header, Set area, or grid background:** New Project, and Paste Project (when a project has been copied).

## Creating a Project

Click the **+** card at the end of any Set's grid, or right-click a Set header and choose **New Project**.

- Maximum **12 characters** — same limit as on the device.
- Allowed characters (matching the Octatrack hardware charset):
  - **Letters:** A–Z, a–z
  - **Digits:** 0–9
  - **Accented:** Å Ä Ö Ü Ø ø å ä ö ü, À–ß, à–ÿ
  - **Symbols:** `space` `!` `#` `$` `%` `&` `'` `(` `)` `+` `,` `-` `.` `;` `=` `>` `@` `[` `]` `^` `_` `{` `}` `~`
  - **Extended:** ¡ ¢ £ ¤ ¥ ¦ ¨ © « ¬ ® ¯ ° ± ² ³ ´ µ ¶ · ¸ ¹ º » ¼ ½ ¾ ¿ × ÷
- Characters not in this set are silently rejected — the input field shakes briefly to signal a disallowed character.
- Hover the **ⓘ** icon inside the name field to see the full allowed character list.

A new project is created with a default `project.work` and 16 empty `bank01.work` … `bank16.work` files, ready to load on the device.

## Copying a Project

1. Right-click a project → **Copy**, or focus the card and press **Ctrl+C**. A confirmation toast briefly appears at the bottom of the screen.
2. Right-click a Set header, Set area, or grid background → **Paste Project**, or focus a card in that Set and press **Ctrl+V**.

The pasted copy is renamed `_2`, `_3`, … if the name is already taken in the destination Set. Long names are truncated to keep within the 12-character limit.

## Renaming a Project

- Right-click → **Rename**, or focus the card and press **F2**.
- Type the new name. Press **Enter** to confirm, **Escape** to cancel.

The same character set, 12-character limit, and shake feedback apply.

## Moving a Project

Drag any project card onto another Set's grid. The project moves immediately. Same-Set drops are ignored.

If the destination is on the same disk, the move is atomic. Across disks, Manager copies the project first, verifies file count and sizes match, then deletes the source — your project is never lost.

## Deleting a Project

Right-click → **Delete**, or focus the card and press **Delete**.

**Delete is the only operation with a confirmation dialog** — it's destructive and cannot be undone. Cancel is the default focus, so pressing Enter immediately on the dialog will not delete the project.

## Keyboard Navigation

Project cards can be navigated with the keyboard. The focused card is highlighted with an orange border.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Navigate between project cards |
| `↑ ↓ ← →` | Move focus within a Set's grid |
| `Enter` | Open focused project |
| `F2` | Rename focused project |
| `Delete` | Delete focused project (with confirmation) |
| `Ctrl+C` | Copy focused project to clipboard |
| `Ctrl+V` | Paste clipboard into focused Set |
| `Escape` | Cancel rename / close menu / close dialog |

## Limits

- 12 characters per project name (OT hardware limit)
- 128 projects per Set (OT hardware limit)
- Disk-space check runs before any write — if space is short, no partial files are created.
