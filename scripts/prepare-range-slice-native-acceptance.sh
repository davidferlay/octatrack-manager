#!/usr/bin/env bash
# Prepare isolated HOME + synthetic Set for M7 native range→slice acceptance.
# Does not touch the operator's real Application Support tree.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SHORT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ISOLATED_HOME="${MASTEROCTA_NATIVE_ACCEPTANCE_HOME:-/tmp/masterocta-native-acceptance-${SHORT}-${STAMP}}"
FIXTURE_ROOT="${ISOLATED_HOME}/fixture-octatrack-root"

mkdir -p "${ISOLATED_HOME}"

echo "commit=${COMMIT}"
echo "isolated_home=${ISOLATED_HOME}"
echo "fixture_root=${FIXTURE_ROOT}"

MANIFEST="$(node "${ROOT_DIR}/scripts/generate-range-slice-native-fixture.mjs" "${FIXTURE_ROOT}")"
echo "${MANIFEST}" > "${ISOLATED_HOME}/fixture-manifest.json"
echo "${MANIFEST}"

cat <<EOF

Next (operator — keep Rust/Node on the real user home; only app data uses isolated HOME):
  REAL_HOME="\${REAL_HOME:-\$HOME}"
  export HOME="${ISOLATED_HOME}"
  export RUSTUP_HOME="\${REAL_HOME}/.rustup"
  export CARGO_HOME="\${REAL_HOME}/.cargo"
  export PATH="\${CARGO_HOME}/bin:\${REAL_HOME}/.nvm/versions/node/*/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  cd "${ROOT_DIR}" && git rev-parse HEAD
  pnpm run tauri:dev

Register folder (read-only): ${FIXTURE_ROOT}
Catalog (after register + rescan): \${HOME}/Library/Application Support/jp.d3nousan.masterocta/MasterOCTa/catalog.sqlite3

EOF
