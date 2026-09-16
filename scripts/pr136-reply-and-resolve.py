#!/usr/bin/env python3
"""Reply to PR #136 review threads (FIX-1 evidence), resolve, update PR body."""
from __future__ import annotations

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


def run_gh(args: list[str]) -> None:
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr or result.stdout or "gh failed\n")
        raise SystemExit(result.returncode)


def gh_graphql(query: str, **fields: str | int) -> dict:
    args = ["api", "graphql", "-f", f"query={query}"]
    for key, value in fields.items():
        flag = "-F" if isinstance(value, int) else "-f"
        args.extend([flag, f"{key}={value}"])
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr or result.stdout or "gh graphql failed\n")
        raise SystemExit(result.returncode)
    payload = json.loads(result.stdout)
    if payload.get("errors"):
        sys.stderr.write(json.dumps(payload["errors"], indent=2) + "\n")
        raise SystemExit(1)
    return payload


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    body_file = root / "docs/testing/PR136_BODY.md"

    run_gh(["auth", "status", "-h", "github.com"])
    run_gh(["repo", "view", REPO])

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
        body = REPLIES_BY_DB_ID.get(int(db_id))
        if body is None:
            continue
        matched += 1
        gh_graphql(REPLY_MUTATION, inReplyTo=node_id, body=body)
        print(f"Replied to comment databaseId={db_id}")
        gh_graphql(RESOLVE_MUTATION, threadId=thread["id"])
        print(f"Resolved thread {thread['id']}")

    if matched == 0:
        print(
            "No matching unresolved threads (already resolved/replied, or comment IDs changed).",
            file=sys.stderr,
        )

    if not body_file.is_file():
        sys.stderr.write(f"Missing {body_file}\n")
        raise SystemExit(1)

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


if __name__ == "__main__":
    main()
