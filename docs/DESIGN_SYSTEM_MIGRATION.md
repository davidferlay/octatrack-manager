# Design System Migration

Status: Phase A on main; UI1 on main; **UI2 landing on main; UI3 next**  
Updated: 2026-08-29

## Purpose

Replace the Elektron-inspired CSS monolith in `src/App.css` with a stable
MasterOCTa design system **without changing product behavior or visuals** in
early PRs. Later PRs migrate screens onto shared primitives and patterns, then
optionally apply Masta-Octa branding.

This document is the frontend UI-kit migration source of truth. Backend next-core
work (`docs/NEXT_GENERATION_ARCHITECTURE.md`) proceeds in parallel and must not
be mixed into the same PR as design-system changes.

## Principles

1. Do not mix product-feature changes with UI-foundation changes in one PR.
2. Do not rewrite existing screens in one pass.
3. Migrate in order: **Design Token → Primitive → Pattern → Feature**.
4. Delete legacy CSS only after call sites reach zero.
5. Keep Masta-Octa branding separate from Elektron-compatible presentation
   (full brand swap is PR-UI6, only if formally decided).

**Forbidden during foundation PRs:** opportunistic React state refactors around
Drag & Drop, Modal flows, keyboard handling, audio preview, HomePage, or Audio
Pool. Those areas are behavior-dense; foundation work must wrap existing classes
and preserve interaction.

## Module placement

Architecture §8.2 lists `shared/` for pure UI. This migration implements that
role as:

```text
src/design-system/
├── tokens/
├── primitives/
├── patterns/          # StatusBadge, Toolbar, DataTable, SplitPane (DS4–DS6)
└── index.ts
```

`features/` stays domain UI. `design-system/` owns look-and-feel and shared
interaction chrome only.

## Token naming

Semantic `--mo-*` tokens are canonical for new code:

| Token | Role |
|-------|------|
| `--mo-canvas` | App background |
| `--mo-surface-1` | Primary panels |
| `--mo-surface-2` | Secondary panels |
| `--mo-surface-raised` | Raised panes (e.g. Audio Pool) |
| `--mo-surface-inset` | Inset toolbar/filter strips |
| `--mo-border` | Default borders |
| `--mo-border-strong` | Stronger borders |
| `--mo-text` | Primary text |
| `--mo-text-muted` | Secondary text |
| `--mo-text-dim` | Dim / placeholder-adjacent |
| `--mo-text-subtle` | Table header-level text |
| `--mo-text-soft` | Soft path / mono row text |
| `--mo-accent` | Selection / CTA (not “warning”) |
| `--mo-accent-hover` / `--mo-accent-pressed` | Accent states |
| `--mo-success` / `--mo-warning` / `--mo-danger` | Status |
| `--mo-info` | Informational highlights |

Legacy `--elektron-*` names remain as **compat aliases** pointing at `--mo-*`
until PR-DS7. Do not introduce new `--elektron-*` usages.

## Roadmap

```text
Phase A  DS1 Token → DS2 Primitive → DS3 Modal → DS4 Toolbar/Status → DS5 DataTable → DS6 SplitPane
Phase B  UI1 Sources → UI2 Project Workspace → UI3 Audio Library
Phase C  UI4 Notes/Inspector → UI5 Usage Graph
Phase D  UI6 Branding → DS7 Legacy CSS removal
```

### PR-DS1 — Design Token Foundation (done)

- Add `src/design-system/tokens/*`.
- Map current colors to `--mo-*`; keep `--elektron-*` aliases.
- Define spacing, typography, radius, motion, z-index scales.
- Classify hardcoded Audio Pool hex into tokens (no selector/layout changes).
- **Done when:** no intentional visual change; new code documents `--mo-*`.

### PR-DS2 — Primitive Components (done)

- Add Button, IconButton, Badge, Input, Spinner, Divider, Tooltip.
- Visual parity via existing CSS classes internally.
- Migrate low-risk call sites first (Home scan/browse/toolbar, simple modal
  footers, back buttons).
- **STOP if** disabled, focus, keyboard, or DnD-adjacent behavior changes.

### PR-DS3 — Modal / Overlay System (done)

- Formal `<Modal>` compound API using existing `.modal-*` classes.
- Unify ESC, backdrop click, submitting lock; preserve `main.tsx` global
  Escape behavior for `.modal-close` (or equivalent registry with zero behavior
  drift).
- First consumers: Create / Rename / Delete / Overwrite modals.
- Do not delete Audio Pool modal CSS duplicates until usage is zero (DS7).

### PR-DS4 — StatusBadge + Toolbar (done)

- Add `patterns/StatusBadge` (`readonly` reuses `.root-mode-badge`; other tones
  use `.mo-status-badge--*`).
- Add `patterns/Toolbar` + `Toolbar.Separator` (canonical `.toolbar-separator`
  in Toolbar.css; AudioPoolPage.css duplicate kept until DS7).
- Consumers: RootRegistry READ ONLY; Home / ProjectDetail refresh; Audio Pool
  Browse / Import / Refresh (transfers `copy-table-btn` left unchanged).
- **Out of scope:** filter-results-info, usage/compat badges, DnD, preview,
  View/Edit mode toggle, CSS deletion.

### PR-DS5 — DataTable Foundation (done)

- Add `patterns/DataTable` compound shell: Root, Toolbar, Wrapper, Loading, Empty.
- First consumer: `AudioFileTable` outer markup only (wrap, do not rewrite).
- TanStack wiring, filters, recursive search, DnD rows, usage/compat cells, and
  selection/cursor stay inside `AudioFileTable`.
- **Out of scope:** `SampleSlotsTable`, Fix/Purge modal tables, CSS deletion (DS7).

### PR-DS6 — SplitPane (done)

- Add `patterns/SplitPane` (`Primary`, `Divider`, `Secondary`) with controlled
  primary size % and drag clamp (20–80).
- First consumer: Audio Pool Files-tab horizontal split only.
- Divider keeps `.panel-divider` class for visual parity (CSS duplicate until DS7).
- **Out of scope:** AudioPoolSidebar resize, TransferProgressPanel height,
  vertical orientation, DnD/preview rewrites.

### PR-UI1 — Sources / AppShell (done)

- Add `src/app/AppShell` (Sources | Main | optional Inspector) using `SplitPane`.
- Add `features/sources/SourcesPane` for root-session chrome (READ ONLY,
  choose/close, fingerprint summary). No raw absolute paths in the UI.
- Compose `RootRegistryPanel` as AppShell + SourcesPane + `CatalogLibraryBrowser`
  in Main (preserves waveform `audioClient` wiring). HomePage legacy scan /
  DnD / project grid stay untouched.
- **Out of scope:** Inspector content (UI4), Project workspace rewrite (UI2),
  replacing legacy Home locations with Sources tree, branding (UI6).

### PR-UI2 — Project Workspace (done)

- Add `features/project-workspace` for catalog-backed project summary in AppShell Main.
- First consumer: wrap column browser when a Project location is selected in
  `CatalogLibraryBrowser` (display name, relative path, file/banks flags, local
  sample count). No raw absolute paths.
- **Out of scope:** rewriting legacy `ProjectDetail`, Pattern/Slot editors, writes,
  Inspector AppShell slot (UI4).

### PR-UI3 — Audio Library region (next)

- Formalize Audio Pool / set-library browsing chrome on AppShell Main (parallel to
  ProjectWorkspace), without rewriting Audio Pool page DnD.
- **Out of scope:** legacy AudioPoolPage rewrite, transfers, CSS deletion (DS7).

### Later (documented only until started)

| PR | Focus |
|----|--------|
| UI3 | Audio Library region formalization on AppShell |
| UI4–UI5 | Notes inspector + Usage Graph UI |
| UI6 | Branding rename artifacts only |
| DS7 | Remove unused `--elektron-*` and legacy classes; shrink App.css |

## Success criteria

**Milestone A (DS1–DS3):** color/spacing source of truth; Button/Input/Modal
dismiss policy in one place; look and DnD/preview/keyboard unchanged.

**After DS4:** StatusBadge and Toolbar are the single swap points for status
pills and header action clusters on migrated surfaces.

**After DS5:** DataTable is the shell for file-list tables; `AudioFileTable` is
the first consumer. Domain sorting/filtering/DnD remain feature-owned.

**After DS6:** SplitPane owns horizontal panel resize for Audio Pool Files tab.
Sidebar / transfer pane resizers remain page-local until a later pass.

**After UI1:** AppShell hosts Sources + Main for the next-gen root session on
HomePage; legacy discovery UI remains below it until UI2/UI3.

App.css is not “deleted”; it remains the legacy stylesheet until DS7.

## Verification (each DS PR)

```bash
pnpm run typecheck
pnpm run test:frontend
```

Manual smoke: Home scan/refresh, Project refresh, Audio Pool Browse/Import/Refresh,
RootRegistry READ ONLY, Escape/backdrop on Create/Rename/Delete/Overwrite.
Skip cargo unless Rust changes.
