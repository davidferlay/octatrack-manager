#!/usr/bin/env bash
# Gate C synthetic-clone smoke (tempfile clone only; no original SD/CF).
# Runs the rename crate regression suite and masterocta Gate C integration
# tests that prove Plan → Backup → Prepare → Apply → fresh catalog rescan
# (and rollback / fail-closed paths) on a synthetic Octatrack layout.
#
# Portable on macOS (BSD userland) and Linux (GNU userland).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="${GATE_C_COMMIT:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
SHORT_COMMIT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${GATE_C_WORK_DIR:-/tmp/gate-c-synthetic-smoke-${SHORT_COMMIT}-${STAMP}}"
EVIDENCE_DIR="${WORK}/evidence"
CRATE_LOG="${EVIDENCE_DIR}/crate-tests.log"
GATE_C_LOG="${EVIDENCE_DIR}/gate-c-tests.log"
REPORT="${EVIDENCE_DIR}/GATE_C_SMOKE_REPORT.md"

mkdir -p "$EVIDENCE_DIR"

pass_named() {
  local log="$1"
  local pattern="^test ${2} \\.\\.\\. ok$"
  if command -v rg >/dev/null 2>&1; then
    rg -q "${pattern}" "$log"
  else
    grep -E -q "${pattern}" "$log"
  fi
}

echo "== Gate C synthetic clone-rescan smoke =="
echo "commit=${COMMIT}"
echo "work=${WORK}"
echo "host=$(uname -s) $(uname -r)"

cd "${ROOT_DIR}/src-tauri"

set +e
cargo test -p ot-plan -p ot-backup --locked -- --nocapture \
  >"$CRATE_LOG" 2>&1
CRATE_STATUS=$?
if [[ $CRATE_STATUS -eq 0 ]]; then
  cargo test -p ot-executor --features test-seams --locked -- --nocapture \
    >>"$CRATE_LOG" 2>&1
  CRATE_STATUS=$?
fi

cargo test -p masterocta gate_c_ --features test-seams --locked -- --nocapture \
  >"$GATE_C_LOG" 2>&1
GATE_C_STATUS=$?
set -e

CRIT_APPLY_RESCAN=0
CRIT_ROLLBACK_RESCAN=0
CRIT_UNKNOWN_BYTES=0
CRIT_HOST_METADATA_REVERIFY=0

pass_named "$GATE_C_LOG" \
  "gate_c_clone_rescan::gate_c_rename_apply_then_fresh_rescan_has_zero_missing_references" \
  && CRIT_APPLY_RESCAN=1
pass_named "$GATE_C_LOG" \
  "gate_c_clone_rescan::gate_c_apply_fault_rolls_back_clone_and_rescan_restores_source" \
  && CRIT_ROLLBACK_RESCAN=1
pass_named "$GATE_C_LOG" \
  "gate_c_clone_rescan::gate_c_unknown_live_bytes_leave_recovery_required_without_overwrite" \
  && CRIT_UNKNOWN_BYTES=1
pass_named "$GATE_C_LOG" \
  "gate_c_clone_rescan::gate_c_host_metadata_mutation_does_not_fail_clone_reverify" \
  && CRIT_HOST_METADATA_REVERIFY=1

OVERALL=FAIL
if [[ $CRATE_STATUS -eq 0 && $GATE_C_STATUS -eq 0 \
   && $CRIT_APPLY_RESCAN -eq 1 && $CRIT_ROLLBACK_RESCAN -eq 1 \
   && $CRIT_UNKNOWN_BYTES -eq 1 && $CRIT_HOST_METADATA_REVERIFY -eq 1 ]]; then
  OVERALL=PASS
fi

cat >"$REPORT" <<EOF
# Gate C synthetic-clone rescan smoke evidence

## Identity

- application commit: \`${COMMIT}\`
- smoke stamp (UTC): ${STAMP}
- host OS: $(uname -s) $(uname -r)
- clone provenance: synthetic tempfile fixture inside \`masterocta\` Gate C tests (not original SD/CF)
- original media disconnected: yes (no removable media used)

## Automated Gate C criteria (masterocta \`gate_c_\` integration tests)

| Criterion | Result |
|---|---|
| apply → fresh catalog rescan → missing 0 / destination resolved | $([[ $CRIT_APPLY_RESCAN -eq 1 ]] && echo PASS || echo FAIL) |
| apply fault → rollback → rescan restores source references | $([[ $CRIT_ROLLBACK_RESCAN -eq 1 ]] && echo PASS || echo FAIL) |
| unknown live bytes → RecoveryRequired without overwrite | $([[ $CRIT_UNKNOWN_BYTES -eq 1 ]] && echo PASS || echo FAIL) |
| host metadata mutation → clone reverify remains valid | $([[ $CRIT_HOST_METADATA_REVERIFY -eq 1 ]] && echo PASS || echo FAIL) |
| ot-plan / ot-backup / ot-executor regression suite | $([[ $CRATE_STATUS -eq 0 ]] && echo PASS || echo FAIL) |
| gate_c integration exit | $([[ $GATE_C_STATUS -eq 0 ]] && echo PASS || echo FAIL) |

## Overall

- automated smoke: **${OVERALL}**
- human review of this report: pending

## Notes

- Clone baseline/post/rollback byte identity is asserted inside the Rust tests above.
- Fault injection runs only after \`Applying\` journal persistence (\`RenameApplyFault\` via \`test-seams\`).
- Production Tauri / frontend / RootRegistry write grants are not exercised here.
- Remaining Gate C work: controlled operator harness and real-hardware clone-load human smoke.
- Evidence under \`${WORK}\` is not committed to the repository.
EOF

echo
echo "REPORT=${REPORT}"
echo "OVERALL=${OVERALL}"

if [[ -d /opt/cursor/artifacts ]]; then
  cp "$REPORT" "/opt/cursor/artifacts/GATE_C_SMOKE_REPORT-${SHORT_COMMIT}.md"
fi

[[ "$OVERALL" == "PASS" ]]
