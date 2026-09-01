# Rename preparation (Phase 3)

MasterOCTa can **review and prepare** a same-directory sample rename on a registered
Octatrack root. This workflow creates a verified Mac-side backup and a Prepared rename
journal. It does **not** rename files on Octatrack media yet.

## Requirements

- Register a root through **Sources → Choose root...**
- Switch to **Edit** mode (session-limited write grant)
- Select an indexed audio file in the catalog library

## Workflow

1. Open the **Inspector** for a selected sample.
2. Click **Rename**.
3. Enter a new **basename only** (same directory; no folder changes).
4. Click **Review Rename** and inspect:
   - rename diff
   - Project reference updates
   - sidecar impact
   - backup file count
5. Click **Approve & Prepare**.

On success, status shows **PREPARED**. A verified backup and prepared references exist on
the Mac. **No Octatrack media changes have been applied.**

## Limitations

- Same-directory rename only (basename change)
- Edit mode required; the UI does not silently enable write access
- Blocked plans (destination occupied, stale catalog, unresolved references, etc.) cannot be approved
- **Apply to clone/media** is not available in Phase 3

## After restart

If a Prepared rename journal exists, the Inspector shows that a prepared operation is
available even when the original review plan expired. This is not the same as a completed
rename on Octatrack media.
