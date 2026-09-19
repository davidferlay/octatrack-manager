#!/usr/bin/env bash
# Isolated HOME + managed synthetic Set for MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SHORT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ISOLATED_HOME="${MASTEROCTA_NATIVE_ACCEPTANCE_HOME:-/tmp/masterocta-ui-native-${SHORT}-${STAMP}}"

mkdir -p "${ISOLATED_HOME}"

echo "work_id=MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1"
echo "commit=${COMMIT}"
echo "isolated_home=${ISOLATED_HOME}"

MANIFEST_JSON="$(node "${ROOT_DIR}/scripts/generate-ui-workspace-native-fixture.mjs")"
echo "${MANIFEST_JSON}" > "${ISOLATED_HOME}/fixture-manifest.json"

FIXTURE_ROOT="$(printf '%s' "${MANIFEST_JSON}" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const m=JSON.parse(s);
    process.stdout.write(m.fixtureRoot);
  });
")"
RANGE_WAV="${FIXTURE_ROOT}/SET/AUDIO/RANGE.wav"

if ! node "${ROOT_DIR}/scripts/verify-ui-workspace-range-sha.mjs" "${RANGE_WAV}"; then
  echo "fixture_integrity=FAIL" >&2
  exit 1
fi

echo "fixture_root=${FIXTURE_ROOT}"
echo "${MANIFEST_JSON}"

# Bundle ID is app identity only; current data_dir() does not insert it as a path segment.
BUNDLE_ID="jp.d3nousan.masterocta"
EXPECTED_CATALOG="${ISOLATED_HOME}/Library/Application Support/MasterOCTa/catalog.sqlite3"

cat <<EOF

Catalog path (code-derived expectation — not proof of runtime isolation):
  bundle_identifier=${BUNDLE_ID} (app identity; not a catalog path segment)
  tauri_data_dir=\${HOME}/Library/Application Support
  catalog_sqlite=${EXPECTED_CATALOG}
  macOS note: /tmp and /private/tmp are the same volume; lsof may show /private/tmp/...

Isolation verification (operator — after register + rescan in isolated session):
  test -f "${EXPECTED_CATALOG}"
  Do not treat HOME= alone as sufficient; confirm catalog appears only under isolated_home above.
  Isolation proof also needs a live native process handle on that catalog (lsof), not just file existence.

Launch (child process — parent shell HOME/PATH unchanged):
  REAL_HOME="\${REAL_HOME:-\$HOME}" \\
    ${ROOT_DIR}/scripts/launch-native-acceptance-tauri.sh $(printf '%q' "${ISOLATED_HOME}") $(printf '%q' "${ROOT_DIR}")

Register folder (read-only): ${FIXTURE_ROOT}

Post-acceptance WAV integrity (separate from generation check):
  node ${ROOT_DIR}/scripts/verify-ui-workspace-range-sha.mjs $(printf '%q' "${RANGE_WAV}")

EOF
