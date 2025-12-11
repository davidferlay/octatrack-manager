# Octatrack Project File Writing - Technical Documentation

This document provides exhaustive technical details about successfully writing to Elektron Octatrack project files, specifically bank files (`.strd` format). This knowledge was gained through extensive reverse engineering and testing.

## Table of Contents

1. [File Structure Overview](#file-structure-overview)
2. [Bank File Architecture](#bank-file-architecture)
3. [Parts System Deep Dive](#parts-system-deep-dive)
4. [Writing Parts Data Correctly](#writing-parts-data-correctly)
5. [Checksum Calculation](#checksum-calculation)
6. [Common Pitfalls and Solutions](#common-pitfalls-and-solutions)
7. [Testing Methodology](#testing-methodology)

---

## File Structure Overview

### Project Directory Layout

An Octatrack project has the following structure:

```
PROJECT_NAME/
├── project.work          # Project metadata and settings
├── bank01.strd           # Bank A data
├── bank02.strd           # Bank B data
├── ...
├── bank16.strd           # Bank P data
└── arranger/             # Arranger data (optional)
```

### Bank File Naming Convention

- Bank files are named `bank01.strd` through `bank16.strd`
- Banks are labeled A-P in the Octatrack UI
- Mapping: `bank01.strd` = Bank A, `bank02.strd` = Bank B, etc.

---

## Bank File Architecture

### Overall Structure

Each bank file (`.strd`) contains:

| Section | Description |
|---------|-------------|
| Header | File identification and version info |
| Patterns (16) | Pattern data for patterns 1-16 |
| Parts | Both "unsaved" and "saved" copies of 4 parts |
| Track Parameters | Audio and MIDI track settings |
| Scenes | Scene data |
| Metadata | Various flags and state information |
| Checksum | File integrity verification |

### Critical Fields for Part Editing

```rust
struct BankFile {
    // ... other fields ...

    parts: PartsPair,           // Contains unsaved and saved copies
    parts_edited_bitmask: u8,   // Indicates which parts have unsaved changes
    parts_saved_state: [u8; 4], // Indicates which parts have valid saved data
    checksum: u16,              // File integrity checksum
}

struct PartsPair {
    unsaved: Parts,  // Working copy - what gets loaded and edited
    saved: Parts,    // Backup copy - used for "Reload Part" function
}

struct Parts([Part; 4]);  // 4 parts per bank
```

---

## Parts System Deep Dive

### The Dual-Copy Architecture

The Octatrack maintains **two copies** of each part in the bank file:

1. **`parts.unsaved`** (Working Copy)
   - This is the "live" data that gets loaded when you select a part
   - Changes made on the Octatrack are written here
   - This is what you see and edit in normal operation

2. **`parts.saved`** (Backup Copy)
   - This is a snapshot of the part at a specific point in time
   - Used by the "Reload Part" function to restore original values
   - Only updated when explicitly saving/committing changes

### Parts State Flags

#### `parts_edited_bitmask` (u8)

A bitmask indicating which parts have unsaved changes:

| Bit | Value | Meaning |
|-----|-------|---------|
| 0 | 1 | Part 1 has unsaved changes |
| 1 | 2 | Part 2 has unsaved changes |
| 2 | 4 | Part 3 has unsaved changes |
| 3 | 8 | Part 4 has unsaved changes |

Example: `parts_edited_bitmask = 5` means Parts 1 and 3 have unsaved changes (1 + 4 = 5)

#### `parts_saved_state` ([u8; 4])

An array indicating whether each part has valid saved (backup) data:

| Index | Value | Meaning |
|-------|-------|---------|
| 0 | 0 | Part 1 has no saved state (backup is empty/invalid) |
| 0 | 1 | Part 1 has valid saved state (backup can be restored) |
| 1 | 0/1 | Part 2 saved state |
| 2 | 0/1 | Part 3 saved state |
| 3 | 0/1 | Part 4 saved state |

### How the Octatrack Uses These

1. **On Project Load**: The Octatrack reads `parts.unsaved` to populate the working state
2. **When User Edits**: Changes go to `parts.unsaved`, and `parts_edited_bitmask` is updated
3. **On "Reload Part"**: If `parts_saved_state[part] == 1`, restore from `parts.saved`
4. **On "Save Part"**: Copy `parts.unsaved` to `parts.saved`, set `parts_saved_state[part] = 1`

---

## Writing Parts Data Correctly

### The Correct Approach

To properly write part parameter changes:

```rust
// 1. Read the existing bank file
let mut bank_data = BankFile::from_data_file(&bank_file_path)?;

// 2. ONLY modify parts.unsaved - leave parts.saved untouched!
for part_data in &parts_to_modify {
    let part_id = part_data.part_id as usize;
    let part_unsaved = &mut bank_data.parts.unsaved.0[part_id];

    // Update parameters in the unsaved copy only
    part_unsaved.audio_track_params_values[track_id].amp.atk = new_atk_value;
    // ... other parameters ...
}

// 3. Update parts_edited_bitmask for modified parts only
for part_data in &parts_to_modify {
    let part_id = part_data.part_id as usize;
    bank_data.parts_edited_bitmask |= 1 << part_id;
}

// 4. Do NOT set parts_saved_state - we're editing, not saving/committing

// 5. Recalculate checksum
bank_data.checksum = bank_data.calculate_checksum()?;

// 6. Write the file
bank_data.to_data_file(&bank_file_path)?;
```

### Why This Works

- **Only modifying `parts.unsaved`** ensures changes are visible when the Octatrack loads the project
- **Leaving `parts.saved` untouched** preserves the backup, allowing "Reload Part" to work
- **Setting `parts_edited_bitmask`** shows the `*` indicator only on modified parts
- **NOT setting `parts_saved_state`** maintains correct reload behavior

### What NOT to Do

**WRONG - Writing to both copies:**
```rust
// DON'T DO THIS - breaks "Reload Part" functionality
part_unsaved.audio_track_params_values[track_id].amp.atk = value;
part_saved.audio_track_params_values[track_id].amp.atk = value;  // NO!
```

**WRONG - Setting parts_saved_state when editing:**
```rust
// DON'T DO THIS - confuses the Octatrack's state management
bank_data.parts_saved_state[part_id] = 1;  // NO! Only set when committing
```

**WRONG - Modifying all parts when only one changed:**
```rust
// DON'T DO THIS - marks all parts as edited
for part_id in 0..4 {
    bank_data.parts_edited_bitmask |= 1 << part_id;  // NO!
}
// Instead, only set bits for parts that actually changed
```

---

## Checksum Calculation

### Importance

The checksum is **critical** - the Octatrack will reject files with invalid checksums or may exhibit undefined behavior.

### Algorithm

The checksum is calculated over the entire file content (excluding the checksum field itself):

```rust
impl BankFile {
    pub fn calculate_checksum(&self) -> Result<u16, Error> {
        // Serialize the entire structure to bytes
        let bytes = self.to_bytes()?;

        // Calculate sum of all bytes (excluding checksum bytes at the end)
        let checksum_offset = bytes.len() - 2;  // Last 2 bytes are checksum
        let sum: u32 = bytes[..checksum_offset]
            .iter()
            .map(|&b| b as u32)
            .sum();

        // Return as u16 (wrapping)
        Ok(sum as u16)
    }
}
```

### When to Recalculate

**Always recalculate the checksum after any modification to the bank file.**

```rust
// After making changes
bank_data.checksum = bank_data.calculate_checksum()?;
bank_data.to_data_file(&path)?;
```

---

## Common Pitfalls and Solutions

### Pitfall 1: Changes Not Visible on Octatrack

**Symptom**: You modify values, but the Octatrack shows original values.

**Causes and Solutions**:

1. **Writing to wrong copy**: Make sure you write to `parts.unsaved`, not `parts.saved`
2. **Checksum incorrect**: Always recalculate after modifications
3. **Caching in application**: Clear any application-level caches after writing

### Pitfall 2: All Parts Show as Modified

**Symptom**: After editing one part, all 4 parts show the `*` (unsaved) indicator.

**Cause**: Setting `parts_edited_bitmask` bits for all parts, not just modified ones.

**Solution**: Track which parts were actually modified and only set their bits:

```rust
// Track modified parts in your application
let mut modified_part_ids: HashSet<usize> = HashSet::new();

// When a part is modified
modified_part_ids.insert(part_id);

// When saving, only set bits for modified parts
for part_id in &modified_part_ids {
    bank_data.parts_edited_bitmask |= 1 << part_id;
}
```

### Pitfall 3: "Reload Part" Does Nothing

**Symptom**: Using "Reload Part" on the Octatrack doesn't restore original values.

**Cause**: Writing the same values to both `parts.unsaved` AND `parts.saved`.

**Solution**: Only write to `parts.unsaved`, leave `parts.saved` as the backup:

```rust
// CORRECT: Only modify unsaved
let part_unsaved = &mut bank_data.parts.unsaved.0[part_id];
part_unsaved.audio_track_params_values[track_id].amp.atk = new_value;

// parts.saved remains unchanged - this is the "reload" source
```

### Pitfall 4: Part Header Corruption

**Symptom**: Parts appear corrupted or won't load.

**Context**: Each Part has a 4-byte header that should be `[0x50, 0x41, 0x52, 0x54]` ("PART" in ASCII).

**Solution**: Never modify the header bytes. Only modify parameter values:

```rust
// Header structure
struct Part {
    header: [u8; 4],  // Should always be [0x50, 0x41, 0x52, 0x54] - DON'T MODIFY
    part_id: u8,
    // ... parameters to modify ...
}
```

### Pitfall 5: Application Cache Staleness

**Symptom**: After saving, reopening the project in your app shows old values.

**Cause**: Application caches (in-memory, IndexedDB, etc.) not invalidated.

**Solution**: Clear all caches after saving:

```typescript
// After successful save
await invoke('save_parts', { path, bankId, partsData });

// Clear caches
await clearProjectCache(projectPath);  // IndexedDB
setInMemoryProject(projectPath, null); // In-memory cache
```

---

## Testing Methodology

### Recommended Testing Workflow

1. **Create a Test Project**
   - Use a blank or simple project for testing
   - Make a backup copy before testing

2. **Test Single Parameter Changes**
   - Start with one parameter (e.g., AMP ATK on Part 1, Track 1)
   - Verify the change appears on the Octatrack
   - Verify only Part 1 shows `*` indicator
   - Verify "Reload Part" restores original value

3. **Test Multiple Part Changes**
   - Modify parameters on different parts
   - Verify correct `*` indicators
   - Verify each part can be reloaded independently

4. **Debug Logging**

   Add extensive logging during development:

   ```rust
   println!("[DEBUG] Writing to parts.unsaved ONLY - Part {}, Track {}: ATK before={}, after={}",
            part_id, track_id, old_value, new_value);
   println!("[DEBUG] parts_edited_bitmask after update: {}", bank_data.parts_edited_bitmask);
   println!("[DEBUG] parts_saved_state unchanged: {:?}", bank_data.parts_saved_state);
   ```

5. **Verification Read-Back**

   After writing, read the file back to verify:

   ```rust
   // Write
   bank_data.to_data_file(&path)?;

   // Verify
   let verify = BankFile::from_data_file(&path)?;
   println!("[VERIFY] ATK value: {}", verify.parts.unsaved.0[part_id]
       .audio_track_params_values[track_id].amp.atk);
   ```

### Hardware Testing Checklist

- [ ] Project loads without errors
- [ ] Modified parameter values are correct
- [ ] Only modified parts show `*` indicator
- [ ] "Reload Part" restores original values
- [ ] Unmodified parts remain unchanged
- [ ] Project can be saved on Octatrack without issues
- [ ] Changes persist after power cycle

---

## Part Parameter Reference

### Audio Track Parameters Structure

Each audio track in a part has the following parameter sections:

```rust
struct AudioTrackParams {
    // Main parameters (knob values)
    amp: AmpParams,      // ATK, HOLD, REL, VOL, BAL, F
    lfo: LfoParams,      // SPD1-3, DEP1-3
    fx1: FxParams,       // PARAM1-6
    fx2: FxParams,       // PARAM1-6
    src: SrcParams,      // Source-specific parameters

    // Setup parameters (menu settings)
    amp_setup: AmpSetup,
    lfo_setup_1: LfoSetup1,
    lfo_setup_2: LfoSetup2,
    fx1_setup: FxSetup,
    fx2_setup: FxSetup,
}
```

### MIDI Track Parameters Structure

```rust
struct MidiTrackParams {
    midi: MidiNoteParams,   // NOTE, VEL, LEN, NOT2-4
    arp: ArpParams,         // TRAN, LEG, MODE, SPD, RNGE, NLEN
    lfo: MidiLfoParams,     // SPD1-3, DEP1-3
    ctrl1: CtrlParams,      // CC values 1-5
    ctrl2: CtrlParams,      // CC values 6-10

    // Setup parameters
    note_setup: NoteSetup,
    arp_setup: ArpSetup,
    lfo_setup_1: LfoSetup1,
    lfo_setup_2: LfoSetup2,
    ctrl1_setup: CtrlSetup,
    ctrl2_setup: CtrlSetup,
}
```

---

## Summary

### Key Principles for Successful Part Writing

1. **Only modify `parts.unsaved`** - never touch `parts.saved` when editing
2. **Track which parts were actually modified** - don't mark all parts as edited
3. **Don't set `parts_saved_state`** when editing - only when committing/saving
4. **Always recalculate checksum** after any modification
5. **Clear application caches** after saving to ensure fresh data on reload
6. **Test on real hardware** - emulators may not catch all issues

### The Golden Rule

> Write to `parts.unsaved` as if you were the Octatrack making live edits.
> Leave `parts.saved` untouched as the restore point.
> The Octatrack's "Reload Part" needs that backup to function correctly.

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2024-12 | 1.0 | Initial documentation based on ot-tools-io library research |

## References

- [ot-tools-io Rust library](https://github.com/dijkstracula/ot-tools-io) - Binary parsing/writing
- Elektron Octatrack MK1/MK2 User Manual
- Empirical testing with Octatrack hardware
