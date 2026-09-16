#!/usr/bin/env bash
# Post FIX-1 evidence replies on PR #136, resolve threads, update PR body.
#
# Run separately (do NOT paste extra words on the same line as gh auth login):
#   cd .../ui-workspace-native-acceptance-1
#   git pull
#   gh auth login
#   bash scripts/pr136-respond-and-resolve-reviews.sh
# Token lacks PR write? Refresh scopes, or:
#   bash scripts/pr136-respond-and-resolve-reviews.sh --body-only --summary-comment
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/scripts/pr136-reply-and-resolve.py" "$@"
