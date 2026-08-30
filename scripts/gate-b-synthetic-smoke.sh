#!/usr/bin/env bash
# Gate B synthetic-disk smoke (no original SD/CF, synthetic WAV only).
# Creates an independently restorable image, baseline checksums, runs the
# recovery/authorization crate suite, performs an additive copy on the
# extracted media tree, and records evidence for human review.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="${GATE_B_COMMIT:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
SHORT_COMMIT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${GATE_B_WORK_DIR:-/tmp/gate-b-synthetic-smoke-${SHORT_COMMIT}-${STAMP}}"
IMAGE_DIR="${WORK}/image"
MEDIA_MOUNT="${WORK}/media"
EVIDENCE_DIR="${WORK}/evidence"
BASELINE_MANIFEST="${EVIDENCE_DIR}/baseline-sha256.txt"
POST_MANIFEST="${EVIDENCE_DIR}/post-additive-sha256.txt"
REPORT="${EVIDENCE_DIR}/GATE_B_SMOKE_REPORT.md"
CRATE_LOG="${EVIDENCE_DIR}/crate-tests.log"

mkdir -p "$IMAGE_DIR" "$MEDIA_MOUNT" "$EVIDENCE_DIR"

echo "== Gate B synthetic smoke =="
echo "commit=${COMMIT}"
echo "work=${WORK}"

# --- 1. Synthetic media tree (Octatrack-like layout, synthetic WAV only) ---
mkdir -p "${MEDIA_MOUNT}/SET/AUDIO" "${MEDIA_MOUNT}/SET/PROJECT" "${MEDIA_MOUNT}/SET/UNRELATED"
python3 - <<'PY' "${MEDIA_MOUNT}/SET/AUDIO/gate_b_synth.wav"
import struct, sys
path = sys.argv[1]
payload = b"MasterOCTa Gate B synthetic WAV fixture v1\n" + bytes(range(256)) * 8
data_size = len(payload)
fmt = struct.pack(
    "<4sI4s4sIHHIIHH4sI",
    b"RIFF", 36 + data_size, b"WAVE",
    b"fmt ", 16, 1, 1, 8000, 8000, 1, 8,
    b"data", data_size,
)
open(path, "wb").write(fmt + payload)
PY
printf 'unrelated sentinel for invariance\n' > "${MEDIA_MOUNT}/SET/UNRELATED/keep.txt"
printf 'project placeholder\n' > "${MEDIA_MOUNT}/SET/PROJECT/.keep"

# --- 2. Independently restorable image ---
IMAGE_TAR="${IMAGE_DIR}/gate-b-synthetic-media.tar.gz"
tar -C "$MEDIA_MOUNT" -czf "$IMAGE_TAR" .
IMAGE_SHA="$(sha256sum "$IMAGE_TAR" | awk '{print $1}')"
echo "${IMAGE_SHA}  gate-b-synthetic-media.tar.gz" > "${IMAGE_DIR}/SHA256SUMS"
RESTORE_CHECK="${WORK}/restore-check"
mkdir -p "$RESTORE_CHECK"
tar -C "$RESTORE_CHECK" -xzf "$IMAGE_TAR"
diff -ru "$MEDIA_MOUNT" "$RESTORE_CHECK" >/dev/null

# --- 3. Baseline checksums (relative paths only) ---
(
  cd "$MEDIA_MOUNT"
  find . -type f -print0 | sort -z | xargs -0 sha256sum
) > "$BASELINE_MANIFEST"
SOURCE_BASELINE="$(awk '/SET\/AUDIO\/gate_b_synth\.wav/{print $1}' "$BASELINE_MANIFEST")"
UNRELATED_BASELINE="$(awk '/SET\/UNRELATED\/keep\.txt/{print $1}' "$BASELINE_MANIFEST")"

# --- 4. Gate B crate criteria ---
cd "${ROOT_DIR}/src-tauri"
set +e
cargo test -p ot-plan -p ot-backup -p ot-executor --locked -- --nocapture \
  >"$CRATE_LOG" 2>&1
CRATE_STATUS=$?
set -e

pass_named() {
  rg -q "^test tests::${1} \\.\\.\\. ok$" "$CRATE_LOG"
}

CRIT_TAMPER=0
CRIT_CRASH_STOP=0
CRIT_READONLY=0
CRIT_SOURCE_BACKUP=0
CRIT_EXTERNAL=0
CRIT_APPROVAL=0
CRIT_REPLACEMENT=0

pass_named sealed_plan_authorization_rejects_joint_manifest_and_journal_tampering && CRIT_TAMPER=1
pass_named crash_after_destination_write_is_recovered_from_the_journal && CRIT_CRASH_STOP=1
pass_named journal_bound_recovery_survives_restart_without_a_general_write_grant && CRIT_READONLY=1
pass_named every_controlled_fault_rolls_back_without_changing_the_source && CRIT_SOURCE_BACKUP=1
pass_named recovery_never_deletes_a_replacement_at_the_destination_path && CRIT_EXTERNAL=1
pass_named additive_copy_commits_only_after_backup_and_verification && CRIT_APPROVAL=1
pass_named recovery_quarantine_preserves_a_destination_replaced_after_verification && CRIT_REPLACEMENT=1

# --- 5. Additive copy on the synthetic media (byte-identical copy to unused dest) ---
# Executor crash/approval/recovery semantics are proven by the crate suite above.
# This step proves the restorable synthetic image remains consistent under an
# additive destination write with source/unrelated invariance.
cp --update=none "${MEDIA_MOUNT}/SET/AUDIO/gate_b_synth.wav" \
  "${MEDIA_MOUNT}/SET/PROJECT/gate_b_synth_copy.wav"

(
  cd "$MEDIA_MOUNT"
  find . -type f -print0 | sort -z | xargs -0 sha256sum
) > "$POST_MANIFEST"

SOURCE_AFTER="$(awk '/SET\/AUDIO\/gate_b_synth\.wav/{print $1}' "$POST_MANIFEST")"
UNRELATED_AFTER="$(awk '/SET\/UNRELATED\/keep\.txt/{print $1}' "$POST_MANIFEST")"
DEST_HASH="$(awk '/SET\/PROJECT\/gate_b_synth_copy\.wav/{print $1}' "$POST_MANIFEST")"

SOURCE_OK=0
UNRELATED_OK=0
DEST_OK=0
[[ "$SOURCE_BASELINE" == "$SOURCE_AFTER" ]] && SOURCE_OK=1
[[ "$UNRELATED_BASELINE" == "$UNRELATED_AFTER" ]] && UNRELATED_OK=1
[[ -n "$DEST_HASH" && "$DEST_HASH" == "$SOURCE_AFTER" ]] && DEST_OK=1

# Restore original media from the independent image to prove recoverability.
RESTORE_MEDIA="${WORK}/media-restored"
mkdir -p "$RESTORE_MEDIA"
tar -C "$RESTORE_MEDIA" -xzf "$IMAGE_TAR"
RESTORE_OK=0
diff -ru "$RESTORE_CHECK" "$RESTORE_MEDIA" >/dev/null && RESTORE_OK=1
# Confirm restored tree matches baseline (no destination copy).
RESTORE_MANIFEST="${EVIDENCE_DIR}/restored-sha256.txt"
(
  cd "$RESTORE_MEDIA"
  find . -type f -print0 | sort -z | xargs -0 sha256sum
) > "$RESTORE_MANIFEST"
cmp -s "$BASELINE_MANIFEST" "$RESTORE_MANIFEST" && RESTORE_OK=1 || RESTORE_OK=0

OVERALL=FAIL
if [[ $CRATE_STATUS -eq 0 && $CRIT_TAMPER -eq 1 && $CRIT_CRASH_STOP -eq 1 \
   && $CRIT_READONLY -eq 1 && $CRIT_SOURCE_BACKUP -eq 1 && $CRIT_EXTERNAL -eq 1 \
   && $CRIT_APPROVAL -eq 1 && $CRIT_REPLACEMENT -eq 1 \
   && $SOURCE_OK -eq 1 && $UNRELATED_OK -eq 1 && $DEST_OK -eq 1 && $RESTORE_OK -eq 1 ]]; then
  OVERALL=PASS
fi

cat >"$REPORT" <<EOF
# Gate B synthetic-disk smoke evidence

## Identity

- application commit: \`${COMMIT}\`
- smoke stamp (UTC): ${STAMP}
- host OS: $(uname -s) $(uname -r)
- clone provenance: synthetic disk image generated by \`scripts/gate-b-synthetic-smoke.sh\` (not original SD/CF)
- original media disconnected: yes (no removable media used)
- restorable image SHA-256: \`${IMAGE_SHA}\`
- restorable image filename: \`gate-b-synthetic-media.tar.gz\`
- baseline manifest verified: yes
- restore round-trip of image: $([[ $RESTORE_OK -eq 1 ]] && echo yes || echo NO)

## Additive-copy result (synthetic media tree)

- synthetic WAV only: yes (\`SET/AUDIO/gate_b_synth.wav\`)
- source byte-for-byte unchanged: $([[ $SOURCE_OK -eq 1 ]] && echo yes || echo NO)
- destination equals source: $([[ $DEST_OK -eq 1 ]] && echo yes || echo NO)
- unrelated file unchanged: $([[ $UNRELATED_OK -eq 1 ]] && echo yes || echo NO)

## Recovery / Gate B criteria (ot-plan / ot-backup / ot-executor)

| Criterion | Result |
|---|---|
| recovery authorization tamper rejection | $([[ $CRIT_TAMPER -eq 1 ]] && echo PASS || echo FAIL) |
| crash leaves incomplete journal recoverable / blocks unsafe reuse | $([[ $CRIT_CRASH_STOP -eq 1 ]] && echo PASS || echo FAIL) |
| recovery without reusable write grant (read-only after) | $([[ $CRIT_READONLY -eq 1 ]] && echo PASS || echo FAIL) |
| source / backup retained across faults | $([[ $CRIT_SOURCE_BACKUP -eq 1 ]] && echo PASS || echo FAIL) |
| externally replaced destination not deleted | $([[ $CRIT_EXTERNAL -eq 1 ]] && echo PASS || echo FAIL) |
| replacement preserved after quarantine race | $([[ $CRIT_REPLACEMENT -eq 1 ]] && echo PASS || echo FAIL) |
| additive copy + backup verification | $([[ $CRIT_APPROVAL -eq 1 ]] && echo PASS || echo FAIL) |
| crate suite exit | $([[ $CRATE_STATUS -eq 0 ]] && echo PASS || echo FAIL) |

## Overall

- automated smoke: **${OVERALL}**
- human review of this report: pending

## Notes

- No updater, release, deploy, cloud sync, or remote filesystem was involved.
- Disposable synthetic image retained under the smoke work directory for human review.
- M5 must not begin until a human signs off this evidence.
EOF

echo
echo "REPORT=${REPORT}"
echo "OVERALL=${OVERALL}"
echo "IMAGE_SHA=${IMAGE_SHA}"

if [[ -d /opt/cursor/artifacts ]]; then
  cp "$REPORT" "/opt/cursor/artifacts/GATE_B_SMOKE_REPORT-${SHORT_COMMIT}.md"
  cp "$BASELINE_MANIFEST" "/opt/cursor/artifacts/GATE_B_baseline-${SHORT_COMMIT}.txt"
  cp "${IMAGE_DIR}/SHA256SUMS" "/opt/cursor/artifacts/GATE_B_image-${SHORT_COMMIT}.sha256"
fi

[[ "$OVERALL" == "PASS" ]]
