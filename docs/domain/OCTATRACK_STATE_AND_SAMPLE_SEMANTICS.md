# Octatrack state and sample semantics

- Status: M3-C2 read-only state inventory contract
- Target: Octatrack MkII / Octatrack OS 1.40+
- Scope: read-only domain meaning, state filename mapping, parser provenance, and catalog projection;
  no frontend API or write behavior

## 1. Purpose and boundary

This document fixes the vocabulary and ownership boundaries needed before the
catalog grows beyond Set and Project projections. It distinguishes Octatrack
state documents, sample locations, and settings ownership without claiming
unverified file-format details.

The domain contract remains independent of SQLite, Tauri, the filesystem, and
serialization. M3-C2 connects those pure types to the legacy read adapter and
SQLite catalog without exposing them through a Tauri command or frontend DTO.
Filename evidence and official operation semantics are recorded separately so
repository behavior is not presented as an undocumented vendor guarantee.

## 2. Domain hierarchy

```text
Root / removable media
└─ Set
   ├─ Set-scoped Audio Pool
   └─ Project
      ├─ Project-local samples
      ├─ Project state
      ├─ Banks
      │  └─ Bank state
      └─ Sample slot assignments
```

A Root is the approved read-only source boundary. A Set groups Projects and
owns its shared Audio Pool. A Project has its own state, Banks, slot
assignments, and may also contain Project-local samples.

Set Audio Pool files and Project-local files are not interchangeable ownership
categories:

- `SampleStorageScope::SetAudioPool` means a file is available from the
  Set-scoped shared pool.
- `SampleStorageScope::ProjectLocal` means a file is located in and scoped to a
  Project.
- `SampleStorageScope::Unclassified` preserves uncertainty when the observed
  layout cannot be classified safely. Scanners must not guess a narrower
  scope.

## 3. State documents

State has two independent axes:

- `StateDocumentKind` distinguishes Project state from Bank state.
- `StateDocumentRole` distinguishes the current working state from an
  explicitly saved checkpoint.

`Working` is the state currently being edited or used. `SavedCheckpoint` is the
logical restore point targeted by Octatrack SAVE/RELOAD behavior. A saved
checkpoint is not a Mac-side safety backup, an exported copy, or proof that a
file can be overwritten safely.

M3-C2 maps the repository's observed files as follows for read-only indexing:

| Kind | Working | SavedCheckpoint |
|---|---|---|
| Project | `project.work` | `project.strd` |
| Bank | `bankXX.work` | `bankXX.strd` |

The official OS 1.40A manual defines Project SAVE/RELOAD and per-Bank
SAVE/RELOAD semantics, which support the Working/SavedCheckpoint distinction.
It does not document these on-media filenames. The filename mapping therefore
comes from tracked repository fixtures, existing reader behavior, and the
pinned `ot-tools-io` revision. Each indexed document records parser name,
parser revision, source version when available, and an explicit `Parsed`,
`UnsupportedVersion`, or `Malformed` status. Unsupported or malformed documents
remain visible as read-only observations and do not produce partial slot or
usage projections.

## 4. Sample settings ownership

Two assignments of the same audio file may have different trim, start, loop,
slice, or related playback settings. Settings therefore have two possible
owners:

- `SampleSettingsOwner::SlotAssignment` represents unsaved, slot-specific
  state.
- `SampleSettingsOwner::FileInstanceSidecar` represents saved settings tied to
  a particular file instance, its sidecar, and a source revision.

This extends ADR-006 rather than weakening it. `AudioAsset` represents shared
audio content and may be identified by content hash. `FileInstance` represents
one occurrence at a validated relative path. Two file instances with the same
content hash can have different sidecars and saved-settings revisions, so
saved settings must not be attached only to `AudioAsset`.

Likewise, `SliceSet` is not unconditionally an `AudioAsset` property. A future
read model must retain whether slice information came from a slot assignment,
a file-instance sidecar, or another versioned source.

## 5. Operation semantics

The following operations are separate future Intents. M3-C0 records their
meaning but does not introduce production Rust intent types or write paths.

| Intent | Meaning | Physical file effect |
|---|---|---|
| `UnassignUnusedSlots` | Remove unused sample-slot assignments from Project state. | Must not delete files from the Audio Pool or Project directory. |
| `CollectProjectSamples` | Copy samples referenced by a Project into its Project directory and plan the required ownership/reference updates. | Additive copy plus future reference changes; not a purge. |
| `ExportProjectToSet` | Copy a Project and its referenced samples to another Set with a validated portable layout. | Not equivalent to a raw folder copy. |
| `DeleteUnreferencedFile` | Delete a physical file only after proving it is unreferenced. | Destructive; deferred until usage graph, verified backup, `ChangePlan`, and recovery journal exist. |

Purging or unassigning a slot is never evidence that the referenced physical
file is unused by every Project, Bank, or slot. Physical deletion remains a
separate safety-critical operation.

## 6. Catalog implementation boundary

M3-C1 implements the first read-only sample inventory projection. `AudioAsset`
holds SHA-256 content identity and byte size without a path. `FileInstance`
holds one validated root-relative path, byte size, optional mtime,
`SampleStorageScope`, and whether the hash was computed in the current scan or
reused from unchanged metadata. The reuse is a catalog optimization, not a
write precondition; every future write must rehash the actual file.

- M3-C2 adds Project/Bank working and saved-checkpoint projections, typed slot
  assignments, machine/sample-lock usage edges, missing/invalid/unassigned
  reference states, and parser provenance in schema v3. The entire projection
  participates in the existing root snapshot transaction and rollback path.
- M3-C3 adds slot-local settings, validated file-sidecar settings, and slice
  read models in schema v4. Slot-local rows are owned by a typed slot
  assignment and may reference the sibling `markers.work` or `markers.strd`
  observation. File-sidecar rows are owned by one `FileInstance`; a sidecar
  that could belong to multiple same-stem audio files fails closed instead of
  being attached heuristically.
- Every settings row records `Parsed`, `UnsupportedVersion`, or `Malformed`,
  the pinned parser revision, source revision when present, source OS version
  when the Project supplies it, and a categorical evidence source. Unsupported
  or malformed rows expose no partially decoded numeric values or slices.
- Numeric setting values remain their observed raw representations. M3-C3 does
  not infer friendly enum meanings, sidecar precedence, cross-OS equivalence,
  or a lossless write contract from field names or the legacy UI.

The catalog must store validated root-relative information and opaque catalog
identities only. It must not persist raw, canonical, or mount paths, session
`RootId` values, or unverified format constants. Unknown or conflicting source
data must remain explicitly unclassified or unsupported rather than being
silently normalized.

## 7. Write-safety conditions

Connecting these concepts to writes requires the M4 Intent → Plan → Apply
boundary. Before any collect, export, or delete is implemented, the system must
have a complete usage graph, stale-revision and content-hash checks, an explicit
diff and user approval, a verified Mac-side backup, a recovery journal, safe
application ordering, and post-write verification.

Unsupported OS versions, ambiguous state roles, unresolved references, and
unknown sidecar revisions remain read-only. Tests use synthetic or copied
fixtures; original SD/CF media is never a test target.

Project compatibility is owned by MasterOCTa at the legacy-reader boundary.
The pinned `ot-tools-io` result remains recorded and accepted when it reports
support. When it reports unsupported, the only local exception is the
fixture-verified combination `VERSION=19`, revision `R0173`, release `1.40`.
For this local exception, revision and release are exact tokens separated only
by ASCII spaces; unknown or malformed combinations do not qualify and remain
`UnsupportedVersion` when the upstream library reports unsupported. An
upstream compatibility-check error remains `Malformed`. This does not relax
the write gate: any state or sample-settings row that is not `Parsed` still
blocks write mode.

## 8. Source provenance and limits

| Source | Type and date | Use in this contract | Limits |
|---|---|---|---|
| Current repository code, tracked `real_device` fixtures, differential tests, and pinned `ot-tools-io` revision | Primary implementation evidence; current checkout | Root/Set/Project boundaries, `.work`/`.strd` filename observations, slot assignments, Bank usage coordinates, settings parser revision, raw setting values, and safety invariants | Fixture coverage is finite and does not make undocumented binary layouts a vendor guarantee; parser failures remain explicit. |
| Reviewed Octatrack MkII BaseProject fixture, `VERSION=19`, `R0173 / 1.40`, 2898 bytes, SHA256 `742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6` | Reproduced observation from a disposable disk-image copy | Exact local compatibility exception for Working and SavedCheckpoint roles | Evidence applies only to this exact Project/OS combination. It does not authorize a wider 1.x range or Project serialization. |
| [Elektron Octatrack MkII manual, OS 1.40A](https://www.elektron.se/wp-content/uploads/2024/09/Octatrack-User-Manual_ENG-OS1.40A_220204.pdf) | Official specification | Project SAVE/RELOAD and per-Bank SAVE/RELOAD semantics; SAVE SAMPLE SETTINGS links trim, slice, and attribute settings to the sample; slice marker operational meaning | The manual does not document on-media `.work`/`.strd` filename mapping, the `.ot` filename convention, or the binary field layout. |
| OCTATRACK DIARY R13 | Unofficial secondary source; 2016; Octatrack OS 1.25 | Supporting domain terminology and operational distinctions among shared/project samples, working/saved state, slot purge, collect, and export | Not authoritative for MkII OS 1.40+. No unverified numeric or format constraint is promoted to an implementation constant. |

The PDF is not copied, converted, quoted at length, or tracked in this
repository. Its metadata for this decision is:

```text
資料名: OCTATRACK DIARY R13
種別: 非公式二次資料
作成年: 2016
基準OS: Octatrack OS 1.25
用途: domain terminologyと操作意味論の補助
制約: MkII OS 1.40+で未確認の数値・format制約は実装定数にしない
```

## 9. Remaining verification for MkII OS 1.40+

The following remain `pending verification` and must not be inferred from the
2016 secondary source alone:

- whether `.work`/`.strd` filename behavior differs on later OS revisions;
- slice-count limits and recorder-buffer behavior beyond the indexed slot assignment scope;
- binary field layout, checksums, and version markers;
- filename rules beyond the indexed state-document patterns and the observed
  same-stem `.ot` sidecar convention;
- sidecar precedence, cross-OS compatibility, and lossless round-trip behavior;
- whether any scope or settings behavior differs across current MkII OS
  revisions.

These items require current official documentation plus repository or newly
reviewed fixtures before becoming parser behavior, schema constraints, or
domain constants.
