#!/usr/bin/env bash
# Post FIX-1 evidence replies on PR #136 review threads and resolve them.
# Requires: gh auth login (or GH_TOKEN) with repo scope on kaz4g/masterocta.
set -euo pipefail

REPO="${REPO:-kaz4g/masterocta}"
PR_NUMBER="${PR_NUMBER:-136}"
HEAD_SHA="${HEAD_SHA:-e1e586f121b0}"
CI_RUN="${CI_RUN:-35073128124}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! gh auth status >/dev/null 2>&1; then
  printf 'gh が未ログインです: gh auth login\n' >&2
  exit 1
fi

reply_to_comment() {
  local comment_id="$1"
  local body="$2"
  gh api "repos/${REPO}/pulls/comments/${comment_id}/replies" -f body="$body" >/dev/null
  printf 'Replied to comment %s\n' "$comment_id"
}

reply_to_comment 4022789669 "FIX-1 (\`bc78af6\`): \`scripts/ui-workspace-fixture-safe.mjs\` + generator no longer accepts CLI output paths; managed temp only, \`validateEmptyFixtureRoot\`, exclusive \`wx\`, no delete-then-write. Verified: \`pnpm run test:ui-native-fixture\` (8/8) on head \`${HEAD_SHA}\`."

reply_to_comment 4022789673 "FIX-1: traced \`lib.rs\` → \`open_shared_catalog\`; prepare + \`docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md\` distinguish **code-derived** catalog path (bundle \`jp.d3nousan.masterocta\`) vs **observed** path (**NOT_RUN**). \`HOME\` alone is not isolation proof."

reply_to_comment 4022789681 "FIX-1: \`scripts/launch-native-acceptance-tauri.sh\` keeps parent \`HOME\`/\`PATH\`; resolves node/pnpm/cargo via \`command -v\`; respects \`RUSTUP_HOME\`/\`CARGO_HOME\`. No unexpanded \`node/*/bin\` glob in parent shell."

reply_to_comment 4022789686 "FIX-1: \`scripts/verify-ui-workspace-range-sha.mjs\` hashes \`RANGE.wav\` bytes (expected \`43ceb3dc…\`); \`prepare-ui-workspace-native-acceptance.sh\` exits non-zero on mismatch/missing. Covered in \`test:ui-native-fixture\`."

reply_to_comment 4022789688 "FIX-1 (\`bc78af6\`): \`ui_workspace_native_fixture_registers_and_lists_audio\` uses \`list_library_dto_sync\` (same path as \`v2_library_list\`) after register. \`cargo test --locked -p masterocta --features test-seams ui_workspace_native_fixture_registers_and_lists_audio\`."

reply_to_comment 4022789692 "FIX-1: \`test:ui-native-fixture\` in root \`pnpm test\` (\`package.json\`) and explicit CI step \`.github/workflows/ci.yml\` Frontend Checks. Green: https://github.com/kaz4g/masterocta/actions/runs/${CI_RUN} (\`${HEAD_SHA}\`)."

reply_to_comment 4022789696 "FIX-1: removed \`EMPTY_SLOT\`; empty **selectable** location is Project \`SET/ACCEPT_PROJ\` (zero audio files). Search-zero is separate (pool + \`xyzzy_nomatch\`). Manifest + Rust assertion on \`project_local\` count."

reply_to_comment 4022789700 "FIX-1: \`--locked\` on \`package.json\` \`test:rust\`, CI Rust job, and acceptance doc commands. Lockfile drift fails CI instead of silent update."

THREADS_FILE="$(mktemp)"
trap 'rm -f "$THREADS_FILE"' EXIT

gh api graphql -f query="
  query {
    repository(owner: \"kaz4g\", name: \"masterocta\") {
      pullRequest(number: ${PR_NUMBER}) {
        reviewThreads(first: 50) {
          nodes {
            id
            isResolved
            comments(first: 1) { nodes { databaseId } }
          }
        }
      }
    }
  }" >"$THREADS_FILE"

python3 - "$THREADS_FILE" <<'PY' | while read -r thread_id; do
import json
import sys

target = {
    4022789669,
    4022789673,
    4022789681,
    4022789686,
    4022789688,
    4022789692,
    4022789696,
    4022789700,
}
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
threads = data["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
for thread in threads:
    if thread.get("isResolved"):
        continue
    comments = thread.get("comments", {}).get("nodes", [])
    if not comments:
        continue
    db_id = comments[0].get("databaseId")
    if db_id in target:
        print(thread["id"])
PY
  [[ -z "$thread_id" ]] && continue
  gh api graphql -f query="
    mutation(\$id: ID!) {
      resolveReviewThread(input: { threadId: \$id }) {
        thread { isResolved }
      }
    }" -f id="$thread_id" >/dev/null
  printf 'Resolved thread %s\n' "$thread_id"
done

gh pr edit "$PR_NUMBER" --repo "$REPO" --body-file docs/testing/PR136_BODY.md
printf 'Updated PR #%s body from docs/testing/PR136_BODY.md\n' "$PR_NUMBER"
