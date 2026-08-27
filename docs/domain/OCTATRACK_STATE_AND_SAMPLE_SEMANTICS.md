# Octatrack state and sample semantics

- Status: M3-C0 domain contract
- Target: Octatrack MkII / Octatrack OS 1.40+
- Scope: read-only domain meaning; no file-name mapping, parser, catalog schema, or write behavior

## 1. Purpose and boundary

This document fixes the vocabulary and ownership boundaries needed before the
catalog grows beyond Set and Project projections. It distinguishes Octatrack
state documents, sample locations, and settings ownership without claiming
unverified file-format details.

The contract is intentionally independent of SQLite, Tauri, the filesystem,
and serialization. The current implementation consists only of pure types in
`ot-domain`. Concrete filename mappings, parsers, and persistence belong to
later M3 slices after repository fixtures and current official OS 1.40+
documentation agree.

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

M3-C0 does not map these roles to `.work`, `.strd`, or any other filename.
That mapping remains pending until current repository behavior, fixtures, and
official MkII OS 1.40+ documentation have been reconciled.

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

- M3-C2 may add Project/Bank working and saved-checkpoint projections, slot
  assignments, usage edges, missing references, and parser provenance.
- M3-C3 may add slot-local settings, file-sidecar settings, slice read models,
  source revision, confidence, and OS-version observations.

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

## 8. Source provenance and limits

| Source | Type and date | Use in this contract | Limits |
|---|---|---|---|
| Current repository code, fixtures, and differential tests | Primary implementation evidence; current checkout | Root/Set/Project boundaries, opaque identifiers, Asset/FileInstance inventory, and safety invariants | The catalog does not yet parse Project/Bank state, slot usage, audio headers, or sidecars; later parsers still require fixture evidence. |
| Elektron Octatrack MkII manual and OS 1.40+ documentation | Official current specification | Required authority for version-sensitive behavior before parser constants or filename mappings are implemented | Detailed reconciliation is pending; this PR makes no version-sensitive implementation claim. |
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

## 9. Pending verification for MkII OS 1.40+

The following remain `pending verification` and must not be inferred from the
2016 secondary source alone:

- the exact mapping between working/saved roles and filenames or save actions;
- sample-slot and slice-count limits;
- Bank, Pattern, Part, Track, and other entity limits;
- binary field layout, checksums, and version markers;
- filename rules and the exact relationship between names and SAVE behavior;
- sidecar filename, revision, precedence, and lossless round-trip behavior;
- whether any scope or settings behavior differs across current MkII OS
  revisions.

These items require current official documentation plus repository or newly
reviewed fixtures before becoming parser behavior, schema constraints, or
domain constants.
