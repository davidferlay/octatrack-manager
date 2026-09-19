#!/usr/bin/env bash
# Run `pnpm exec tauri dev` with app-data isolation in a child process only.
# Parent shell HOME/PATH are not exported or mutated.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  echo "Usage: $0 <isolated_home> [repo_root]" >&2
  echo "       $0 --print-child-env <isolated_home> [repo_root]  (harness contract only)" >&2
  exit 2
}

PRINT_CHILD_ENV=0
if [[ "${1:-}" == "--print-child-env" ]]; then
  PRINT_CHILD_ENV=1
  shift
fi

if [[ $# -lt 1 ]]; then
  usage
fi

ISOLATED_HOME="$1"
ROOT_DIR="${2:-${ROOT_DIR}}"

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

CHILD_ENV_JSON="$(
  node "${ROOT_DIR}/scripts/launch-native-acceptance-env.mjs" \
    --real-home "${REAL_HOME}" \
    --isolated-home "${ISOLATED_HOME}" \
    --path "${REAL_PATH}" \
    ${CARGO_HOME:+--cargo-home "${CARGO_HOME}"} \
    ${RUSTUP_HOME:+--rustup-home "${RUSTUP_HOME}"}
)" || {
  echo "launch-native-acceptance-tauri: failed to resolve Rust toolchain for child process" >&2
  exit 1
}

if [[ "${PRINT_CHILD_ENV}" -eq 1 ]]; then
  printf '%s\n' "${CHILD_ENV_JSON}"
  exit 0
fi

export CHILD_ENV_JSON
CHILD_HOME="$(node -e 'console.log(JSON.parse(process.env.CHILD_ENV_JSON).HOME)')"
CHILD_PATH="$(node -e 'console.log(JSON.parse(process.env.CHILD_ENV_JSON).PATH)')"
CHILD_CARGO_HOME="$(node -e 'console.log(JSON.parse(process.env.CHILD_ENV_JSON).CARGO_HOME)')"
CHILD_RUSTUP_HOME="$(node -e 'console.log(JSON.parse(process.env.CHILD_ENV_JSON).RUSTUP_HOME)')"

export REAL_HOME ROOT_DIR
exec env \
  HOME="${CHILD_HOME}" \
  PATH="${CHILD_PATH}" \
  CARGO_HOME="${CHILD_CARGO_HOME}" \
  RUSTUP_HOME="${CHILD_RUSTUP_HOME}" \
  ROOT_DIR="${ROOT_DIR}" \
  bash -c 'cd "$ROOT_DIR" && git rev-parse HEAD && pnpm exec tauri dev'
