# MO-UI-SLICE-RANGE-HANDOFF-FIX-1

**Work ID:** `MO-UI-SLICE-RANGE-HANDOFF-FIX-1`  
**Base:** `main` after PR #136 merge  
**Branch:** `feat/ui-slice-range-handoff-fix-1`  

## Cause

Library preview committed geometry (`librarySelectionRange`) was already passed to `SliceWorkbench` and used by **Analyze selected range** / `v2_audio_onsets_start`. The Slice tab **manual** region fields (`regionStart` / `regionEnd`) are a separate path for **Detect attacks**; they stay empty by design. Operators saw empty fields and no pre-analysis display of the preview range.

## Fix

- Read-only **Library preview selection** block above **Analyze selected range**, showing the same `[start, end)` frames as the button sends.
- Optional time labels from waveform `sampleRate` (44100 Hz for M7 RANGE fixture).
- Manual region help text clarifies separation from preview selection.

## Verification (automated)

- `SliceWorkbench.test.tsx`: Range A `[44100, 132300)` display matches `api.start` payload; locale toggle; none state.
- `libraryGeometrySelection.test.ts`: `sampleRate` on binding.
- `WaveformPreview.test.tsx`: notification includes `sampleRate`.

## Native acceptance

**NOT_RUN** — mock/Vitest only. Re-run on device:

1. Open RANGE.wav, Preview tab: set `[44100, 132300)`.
2. Slice tab: confirm preview selection block shows same frames (and ~1.000 s → ~3.000 s @ 44100 Hz).
3. **この範囲を解析** → confirm IPC region (network/devtools or backend log).
4. Tab back to Preview: range unchanged; no auto-analysis.
5. Switch file: old range must not apply.

**Overall native product acceptance:** unchanged / NOT_COMPLETE where previously documented.
