#!/usr/bin/env bash
# Isolated HOME + synthetic Set for MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SHORT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ISOLATED_HOME="${MASTEROCTA_NATIVE_ACCEPTANCE_HOME:-/tmp/masterocta-ui-native-${SHORT}-${STAMP}}"
FIXTURE_ROOT="${ISOLATED_HOME}/fixture-octatrack-root"

mkdir -p "${ISOLATED_HOME}"

echo "work_id=MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1"
echo "commit=${COMMIT}"
echo "isolated_home=${ISOLATED_HOME}"
echo "fixture_root=${FIXTURE_ROOT}"

MANIFEST="$(node "${ROOT_DIR}/scripts/generate-ui-workspace-native-fixture.mjs" "${FIXTURE_ROOT}")"
echo "${MANIFEST}" > "${ISOLATED_HOME}/fixture-manifest.json"
echo "${MANIFEST}"

# Post-generate integrity: sample A SHA must match M7 manifest when generator unchanged.
RANGE_SHA="$(echo "${MANIFEST}" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const m=JSON.parse(s);
    const r=m.files.find(f=>f.role==='sampleA');
    console.log(r.sha256);
  });
")"
echo "sampleA_sha256=${RANGE_SHA}"

cat <<EOF

Operator — app data only uses isolated HOME; keep Rust/Node on real user home:
  REAL_HOME="\${REAL_HOME:-\$HOME}"
  export HOME="${ISOLATED_HOME}"
  export RUSTUP_HOME="\${REAL_HOME}/.rustup"
  export CARGO_HOME="\${REAL_HOME}/.cargo"
  export PATH="\${CARGO_HOME}/bin:\${REAL_HOME}/.nvm/versions/node/*/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  cd "${ROOT_DIR}" && git rev-parse HEAD
  pnpm run tauri:dev

Register folder (read-only): ${FIXTURE_ROOT}
Catalog after register: \${HOME}/Library/Application Support/jp.d3nousan.masterocta/MasterOCTa/catalog.sqlite3

Verify fixture WAVs unchanged after acceptance:
  shasum -a 256 "${FIXTURE_ROOT}/SET/AUDIO/RANGE.wav"

EOF
