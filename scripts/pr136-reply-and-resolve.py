#!/usr/bin/env python3
"""Reply to PR #136 review threads (FIX-1 evidence), resolve, update PR body."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = "kaz4g/masterocta"
PR_NUMBER = 136
HEAD_SHA = "e1e586f121b0"
CI_RUN = "35073128124"

REPLIES_BY_DB_ID: dict[int, str] = {
    4022789669: (
        f"FIX-1 (bc78af6): scripts/ui-workspace-fixture-safe.mjs + generator no longer accepts "
        f"CLI output paths; managed temp only, validateEmptyFixtureRoot, exclusive wx, no delete-then-write. "
        f"Verified: pnpm run test:ui-native-fixture (8/8) on head {HEAD_SHA}."
    ),
    4022789673: (
        "FIX-1: traced lib.rs → open_shared_catalog; prepare + "
        "docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md distinguish code-derived catalog path "
        "(bundle jp.d3nousan.masterocta) vs observed path (NOT_RUN). HOME alone is not isolation proof."
    ),
    4022789681: (
        "FIX-1: scripts/launch-native-acceptance-tauri.sh keeps parent HOME/PATH; resolves node/pnpm/cargo "
        "via command -v; respects RUSTUP_HOME/CARGO_HOME. No unexpanded node/*/bin glob in parent shell."
    ),
    4022789686: (
        "FIX-1: scripts/verify-ui-workspace-range-sha.mjs hashes RANGE.wav bytes (expected 43ceb3dc…); "
        "prepare-ui-workspace-native-acceptance.sh exits non-zero on mismatch/missing. "
        "Covered in test:ui-native-fixture."
    ),
    4022789688: (
        "FIX-1 (bc78af6): ui_workspace_native_fixture_registers_and_lists_audio uses list_library_dto_sync "
        "(same path as v2_library_list) after register. "
        "cargo test --locked -p masterocta --features test-seams ui_workspace_native_fixture_registers_and_lists_audio."
    ),
    4022789692: (
        "FIX-1: test:ui-native-fixture in root pnpm test (package.json) and explicit CI step "
        f".github/workflows/ci.yml Frontend Checks. Green: https://github.com/kaz4g/masterocta/actions/runs/{CI_RUN} ({HEAD_SHA})."
    ),
    4022789696: (
        "FIX-1: removed EMPTY_SLOT; empty selectable location is Project SET/ACCEPT_PROJ (zero audio files). "
        "Search-zero is separate (pool + xyzzy_nomatch). Manifest + Rust assertion on project_local count."
    ),
    4022789700: (
        "FIX-1: --locked on package.json test:rust, CI Rust job, and acceptance doc commands. "
        "Lockfile drift fails CI instead of silent update."
    ),
}

PERMISSION_HINT = """
GitHub が AddPullRequestReviewComment / resolveReviewThread を拒否しました（トークン権限不足）。

Classic トークン:
  gh auth refresh -h github.com -s repo

Fine-grained PAT の場合:
  kaz4g/masterocta で Pull requests → Read and write を付与した PAT を作り、
  gh auth login --with-token  で差し替え

権限を直すまでの代替:
  1) bash scripts/pr136-respond-and-resolve-reviews.sh --body-only
  2) docs/testing/PR136_REVIEW_REPLIES.md を各スレッドに手動貼り付け → Resolve conversation
"""


THREADS_QUERY = """
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(first: 5) {
            nodes {
              id
              databaseId
            }
          }
        }
      }
    }
  }
}
"""

REPLY_MUTATION = """
mutation($inReplyTo: ID!, $body: String!) {
  addPullRequestReviewComment(input: { inReplyTo: $inReplyTo, body: $body }) {
    comment { id }
  }
}
"""

RESOLVE_MUTATION = """
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { isResolved }
  }
}
"""


class GhError(Exception):
    def __init__(self, message: str, *, permission: bool = False) -> None:
        super().__init__(message)
        self.permission = permission


def run_gh(args: list[str]) -> str:
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    combined = (result.stderr or "") + (result.stdout or "")
    if result.returncode != 0:
        permission = (
            "correct permissions" in combined.lower()
            or "resource not accessible" in combined.lower()
        )
        raise GhError(combined.strip() or "gh failed", permission=permission)
    return result.stdout


def gh_graphql(query: str, **fields: str | int) -> dict:
    args = ["api", "graphql", "-f", f"query={query}"]
    for key, value in fields.items():
        flag = "-F" if isinstance(value, int) else "-f"
        args.extend([flag, f"{key}={value}"])
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    combined = (result.stderr or "") + (result.stdout or "")
    if result.returncode != 0:
        permission = "correct permissions" in combined.lower()
        raise GhError(combined.strip(), permission=permission)
    payload = json.loads(result.stdout)
    if payload.get("errors"):
        text = json.dumps(payload["errors"])
        permission = "FORBIDDEN" in text or "insufficient" in text.lower()
        raise GhError(text, permission=permission)
    return payload


def update_pr_body(body_file: Path) -> None:
    run_gh(
        [
            "pr",
            "edit",
            str(PR_NUMBER),
            "--repo",
            REPO,
            "--body-file",
            str(body_file),
        ]
    )
    print(f"Updated PR #{PR_NUMBER} body from {body_file}")


def post_summary_comment(root: Path) -> None:
    manual = root / "docs/testing/PR136_REVIEW_REPLIES.md"
    body = (
        "## FIX-1 review responses (summary)\n\n"
        "Automated inline replies were blocked by token permissions. "
        "Evidence for all 8 Codex threads is in "
        f"[PR136_REVIEW_REPLIES.md](https://github.com/{REPO}/blob/feat/ui-workspace-native-acceptance-1/docs/testing/PR136_REVIEW_REPLIES.md) "
        "on this branch. Please resolve threads after verifying.\n"
    )
    if manual.is_file():
        body += f"\nLocal path: `{manual.relative_to(root)}`\n"
    run_gh(["pr", "comment", str(PR_NUMBER), "--repo", REPO, "--body", body])
    print("Posted summary PR comment (fallback).")


def reply_and_resolve_threads() -> int:
    payload = gh_graphql(
        THREADS_QUERY,
        owner="kaz4g",
        name="masterocta",
        number=PR_NUMBER,
    )
    threads = payload["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]

    matched = 0
    for thread in threads:
        if thread.get("isResolved"):
            continue
        comments = thread.get("comments", {}).get("nodes", [])
        if not comments:
            continue
        root_comment = comments[0]
        db_id = root_comment.get("databaseId")
        node_id = root_comment.get("id")
        if db_id is None or node_id is None:
            continue
        reply_body = REPLIES_BY_DB_ID.get(int(db_id))
        if reply_body is None:
            continue
        matched += 1
        gh_graphql(REPLY_MUTATION, inReplyTo=node_id, body=reply_body)
        print(f"Replied to comment databaseId={db_id}")
        gh_graphql(RESOLVE_MUTATION, threadId=thread["id"])
        print(f"Resolved thread {thread['id']}")

    return matched


def main() -> None:
    parser = argparse.ArgumentParser(description="PR #136 FIX-1 review housekeeping")
    parser.add_argument(
        "--body-only",
        action="store_true",
        help="Update PR description only (lower permission bar)",
    )
    parser.add_argument(
        "--summary-comment",
        action="store_true",
        help="After failure or with --body-only, post a summary PR comment",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    body_file = root / "docs/testing/PR136_BODY.md"

    run_gh(["auth", "status", "-h", "github.com"])
    run_gh(["repo", "view", REPO])

    if not body_file.is_file():
        sys.stderr.write(f"Missing {body_file}\n")
        raise SystemExit(1)

    update_pr_body(body_file)

    if args.body_only:
        if args.summary_comment:
            post_summary_comment(root)
        print("Skipped thread replies (--body-only).")
        return

    try:
        matched = reply_and_resolve_threads()
        if matched == 0:
            print(
                "No matching unresolved threads (already resolved/replied, or comment IDs changed)."
            )
    except GhError as err:
        sys.stderr.write(str(err) + "\n")
        if err.permission:
            sys.stderr.write(PERMISSION_HINT)
            if args.summary_comment:
                try:
                    post_summary_comment(root)
                except GhError as comment_err:
                    sys.stderr.write(str(comment_err) + "\n")
        raise SystemExit(1) from err


if __name__ == "__main__":
    main()
