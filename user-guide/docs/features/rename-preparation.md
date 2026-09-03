# Rename preparation and operator flow

Masta-Octa supports **review, prepare, continue, and apply** for same-directory sample
renames on a **verified disposable clone**. Preparation creates a verified Mac-side backup
and a durable prepared rename snapshot. Apply mutates only the verified clone session.

## Requirements

- Register a root through **Sources → Choose root...**
- Create or verify a **disposable clone** in **Clone operator**
- Switch to **Edit** mode (session-limited write grant) on the verified clone
- For planning only: select an indexed audio file in the catalog library

## Clone-first setup

1. On a read-only source root, use **Create managed disposable clone** (recommended) or
   record source evidence and verify an external disposable clone.
2. Confirm **VERIFIED CLONE** before rename apply or continuation.
3. Continue all rename write operations on the clone root, not the original source session.

## Prepare workflow

1. Open the **Inspector** for a selected sample.
2. Click **Rename**.
3. Enter a new **basename only** (same directory; no folder changes).
4. Click **Review Rename** and inspect impacts.
5. Click **Approve & Prepare**.

On success, status shows **PREPARED**. No Octatrack media changes have been applied yet.

## Operator workflow (Change Drawer)

Prepared and incomplete rename operations appear in **Rename operator** regardless of the
current catalog selection.

1. Review the durable prepared plan (source, destination, references, backup scope).
2. Check **Continue** approval and click **Continue prepared rename**.
3. After continuation authority is issued, check the separate **Apply** approval.
4. Click **Apply approved rename** on the verified clone.
5. Review **COMMITTED / VERIFIED** or re-run committed verification if needed.

Recovery-required operations use a separate rollback approval in the same panel.

## Limitations

- Same-directory rename only (basename change)
- Rename apply requires a verified disposable clone
- Blocked plans cannot be approved
- Human Gate C clone-load smoke on real Octatrack hardware remains a separate sign-off

## After restart

Prepared operations are rediscovered through rename recovery status. The operator panel
reloads the durable prepared plan through `v2_rename_get_prepared_plan` so Apply approval
can review the exact operation without the original in-memory plan store.
