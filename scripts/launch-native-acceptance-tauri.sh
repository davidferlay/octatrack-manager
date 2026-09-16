#!/usr/bin/env bash
# Run tauri:dev with app-data isolation in a child process only (does not mutate parent shell).
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <isolated_home> [repo_root]" >&2
  exit 2
fi

ISOLATED_HOME="$1"
ROOT_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)}"

REAL_HOME="${REAL_HOME:-${HOME}}"
REAL_PATH="${PATH:-}"

prepend_dir_if_command() {
  local cmd="$1"
  local dir
  dir="$(command -v "${cmd}" 2>/dev/null || true)"
  if [[ -n "${dir}" ]]; then
    dir="$(dirname "${dir}")"
    if [[ ":${REAL_PATH}:" != *":${dir}:"* ]]; then
      REAL_PATH="${dir}:${REAL_PATH}"
    fi
  fi
}

prepend_dir_if_command node
prepend_dir_if_command pnpm
prepend_dir_if_command cargo

export REAL_HOME ROOT_DIR
exec env \
  HOME="${ISOLATED_HOME}" \
  PATH="${REAL_PATH}" \
  RUSTUP_HOME="${RUSTUP_HOME:-${REAL_HOME}/.rustup}" \
  CARGO_HOME="${CARGO_HOME:-${REAL_HOME}/.cargo}" \
  ROOT_DIR="${ROOT_DIR}" \
  bash -lc 'cd "$ROOT_DIR" && git rev-parse HEAD && pnpm run tauri:dev'
