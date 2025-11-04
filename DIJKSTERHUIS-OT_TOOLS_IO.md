# ot-tools-io Library Capabilities Analysis

## Overview

The **ot-tools-io** library is a Rust crate for reading, writing, and modifying binary data files used by the Elektron Octatrack DPS-1 sampler. It provides complete serialization/deserialization capabilities for all Octatrack file types.

## Author

- dijksterhuis (Mike Robeson)

## Core Technology Stack

- **Serialization**: Built on `serde` and `bincode`
- **Format Support**: Binary (.work/.strd), YAML, and JSON
- **Error Handling**: Custom `OtToolsIoError` type with `thiserror`
- **License**: GNU GPL v3.0+
- **Documentation**: https://docs.rs/ot-tools-io
- **Repository**: https://gitlab.com/ot-tools/ot-tools-io

## Supported File Types

### 1. **ProjectFile** (`project.*`)
- Project-level settings
- Sample slot configuration (Flex and Static)
- Audio pool management
- 128 Flex samples + 128 Static samples per project

### 2. **BankFile** (`bank??.work/strd`)
- Contains 16 patterns
- 4 parts (A, B, C, D)
- Pattern data including:
  - Trigs (triggers) for audio and MIDI tracks
  - Parameter locks per trig
  - Scene configurations
  - Track settings

### 3. **ArrangementFile** (`arr??.work/strd`)
- Song arrangement sequences
- Chain patterns together
- Timeline-based composition

### 4. **MarkersFile** (`markers.work/strd`)
- Sample slice definitions
- Loop points
- Trim markers for all sample slots

### 5. **SampleSettingsFile** (`*.ot`)
- Per-sample metadata
- Saved trim, slice, and attribute settings
- Stored alongside .wav files

## File Format Capabilities

### Reading Files
```rust
// From binary Octatrack files
ProjectFile::from_data_file(path)?

// From bytes
ProjectFile::from_bytes(&bytes)?

// From YAML
ProjectFile::from_yaml_file(path)?
ProjectFile::from_yaml_str(yaml_string)?

// From JSON
ProjectFile::from_json_file(path)?
ProjectFile::from_json_str(json_string)?
```

### Writing Files
```rust
// To binary format
project.to_data_file(path)?

// To bytes
let bytes = project.to_bytes()?

// To YAML
project.to_yaml_file(path)?
let yaml_string = project.to_yaml_string()?

// To JSON
project.to_json_file(path)?
let json_string = project.to_json_string()?
```

## Data Structures

### Parts Module (`ot_tools_io::parts`)

**Core Types:**
- `Part` - Individual part configuration
- `PartArray` - Container for 4 parts (A, B, C, D)
- `Parts` - Manages saved and unsaved part data

**Audio Track Parameters:**
- `MachineSetup` / `MachineParams` - Machine configuration (Static, Flex, Pickup, Thru, Neighbor)
- `AmplitudeParams` - Volume, pan, and amplitude controls
- `EffectParams` - Effects settings
- `LfoParams` - LFO configuration
- `CustomLfoDesign` - Custom LFO waveforms
- `RecorderSetup` - Recording buffer configuration
- `SceneParams` - Scene A/B parameter settings

**MIDI Track Parameters:**
- `MidiNoteParams` - Note configuration
- `MidiArpParams` - Arpeggiator settings
- `MidiCcParams` - Control change parameters
- `CustomArpSequence` - Custom arpeggiator sequences

**Enums:**
- `OnOrOff` - Basic state management
- `ActiveScenes` - Current scene selection

### Patterns Module (`ot_tools_io::patterns`)

**Core Pattern Types:**
- `Pattern` - Complete pattern with all tracks
- `PatternArray` - Container for multiple patterns

**Audio Track Data:**
- `AudioTrackTrigs` - Trig data for audio tracks
- `AudioTrackTrigMasks` - Bitmask representation
- `AudioTrackParameterLocks` - Per-trig parameter locks
- `AudioTrackParameterLocksArray` - Container for all locks

**MIDI Track Data:**
- `MidiTrackTrigs` - Trig data for MIDI tracks
- `MidiTrackTrigMasks` - MIDI trig bitmasks
- `MidiTrackParameterLocks` - MIDI parameter locks
- `MidiTrackTrigsArray` - MIDI trig containers

**Pattern Settings:**
- `TrackPatternSettings` - Playback settings per track
- `PatternScaleSettings` - Pattern-level scale configuration
- `TrackPerTrackModeScale` - Custom per-track scaling
- `PatternChainBehavior` - Pattern chaining settings

### Settings Module (`ot_tools_io::settings`)
Enums for various sample, slot, and marker settings configurations.

### Slices Module (`ot_tools_io::slices`)
Data structures for managing sample slices and slice points.

## Traits

### OctatrackFileIO
Main trait for file I/O operations. All file types implement this.

**Methods:**
- `from_data_file(path)` / `to_data_file(path)` - Binary file I/O
- `from_bytes(bytes)` / `to_bytes()` - Byte-level serialization
- `from_yaml_file(path)` / `to_yaml_file(path)` - YAML file I/O
- `from_yaml_str(s)` / `to_yaml_string()` - YAML string conversion
- `from_json_file(path)` / `to_json_file(path)` - JSON file I/O
- `from_json_str(s)` / `to_json_string()` - JSON string conversion
- `encode()` / `decode()` - Raw bincode encoding/decoding
- `repr(newlines)` - Debug representation

### File Integrity Traits
- `HasHeaderField` - Header validation
- `HasChecksumField` - Checksum calculation and validation
- `HasFileVersionField` - File version compatibility checking
- `CheckFileIntegrity` - Combined integrity checking (uses all above)

### Default Value Traits
- `Defaults` - Create default containers with N elements
- `IsDefault` - Check if data matches default state

## Derive Macros (ot-tools-io-derive)

Custom derive macros for internal types:
- `#[derive(Decodeable)]` - Implements `Decode` trait
- `#[derive(Encodeable)]` - Implements `Encode` trait
- `#[derive(DefaultsAsArray)]` - Implements `DefaultsArray` trait
- `#[derive(DefaultsAsArrayBoxed)]` - Implements `DefaultsArrayBoxed` trait

## Octatrack Data Model

### Hierarchy
```
Set/
├── Audio/                      # Sample files (.wav + .ot)
│   ├── sample1.wav
│   ├── sample1.ot             # SampleSettingsFile
│   └── ...
└── Presets/
    ├── project.work           # ProjectFile
    ├── markers.work           # MarkersFile
    ├── bank01.work            # BankFile (patterns 1-16)
    ├── bank02.work            # BankFile (patterns 17-32)
    ├── ...
    ├── bank16.work            # BankFile (patterns 241-256)
    ├── arr01.work             # ArrangementFile
    └── ...
```

### File Relationships
- **ProjectFile** defines 128 Flex + 128 Static sample slots
- **MarkersFile** contains slice/trim data for all sample slots
- **BankFiles** contain patterns that reference sample slots
- **ArrangementFiles** sequence patterns together
- **SampleSettingsFiles** (.ot) store per-sample metadata

### Track Configuration
Each pattern in a bank has:
- **8 Audio Tracks** (T1-T8)
  - Each can use different machine types (Static, Flex, Pickup, Thru, Neighbor)
  - 64 trigs per track (maximum)
  - Parameter locks per trig
  - Scene A/B configurations

- **8 MIDI Tracks** (T1-T8)
  - Note, arpeggiator, and CC parameters
  - 64 trigs per track
  - MIDI parameter locks

## Current Limitations

As noted in the documentation:
- ~70-80% test coverage
- All APIs are **unstable** and may change
- Some fields are still being reverse-engineered
- Arrangement checksumming is incomplete
- Designed for OS version 1.40B (compatible with 1.40A and 1.40C)

## Use Cases for Octatrack Manager

Based on these capabilities, here's what we can implement:

### ✅ Currently Feasible

1. **Project Browser**
   - Read and display all projects
   - Show sample slot assignments
   - View project settings

2. **Bank/Pattern Viewer**
   - Display all 16 banks
   - Show patterns within each bank
   - View parts (A, B, C, D)
   - Display trig data and parameter locks

3. **Sample Management**
   - List all samples in audio pool
   - View .ot metadata
   - Show slice points and loop markers

4. **Arrangement Viewer**
   - Display arrangement sequences
   - Show pattern chains

5. **Export/Import**
   - Convert projects to YAML/JSON for editing
   - Import modified YAML/JSON back to binary
   - Backup/restore projects

6. **Batch Operations**
   - Rename projects
   - Copy patterns between banks
   - Duplicate parts
   - Clear patterns/banks

7. **Analysis Tools**
   - Show which samples are used in patterns
   - Find unused sample slots
   - Analyze pattern complexity
   - Generate reports on project structure

### ❌ Not Currently Supported

1. **USB Connectivity**
   - Direct communication with powered-on Octatrack
   - Real-time sync
   - No USB protocol implementation in library

2. **Audio Processing**
   - Library handles metadata only, not audio DSP
   - Cannot resample or process .wav files
   - No audio playback capabilities

## Example Integration in Our App

Here's how we can extend our Tauri app:

```rust
use ot_tools_io::*;

#[tauri::command]
fn load_project(project_path: String) -> Result<ProjectFile, String> {
    ProjectFile::from_data_file(&project_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_bank(bank_path: String) -> Result<BankFile, String> {
    BankFile::from_data_file(&bank_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn export_project_to_json(project_path: String, output_path: String) -> Result<(), String> {
    let project = ProjectFile::from_data_file(&project_path)
        .map_err(|e| e.to_string())?;

    project.to_json_file(&output_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_project_from_json(json_path: String, output_path: String) -> Result<(), String> {
    let project = ProjectFile::from_json_file(&json_path)
        .map_err(|e| e.to_string())?;

    project.to_data_file(&output_path)
        .map_err(|e| e.to_string())
}
```

## Future Development

The library author mentioned plans for:
- **Language bindings**: Python, Node.js, C#
- More complete reverse engineering
- Stable API once all fields are documented

## Recommended Next Features for Our App

1. **Project Viewer** - Display project.work contents
2. **Bank Browser** - Show all patterns in a bank
3. **Pattern Editor** - View/edit trig data (read-only initially)
4. **Sample Slot Manager** - Show Flex/Static sample assignments
5. **Backup Tool** - Export entire sets to JSON for version control
6. **Pattern Library** - Share/import patterns between projects

## Resources

- **Docs**: https://docs.rs/ot-tools-io
- **Repository**: https://gitlab.com/ot-tools/ot-tools-io
- **Crate**: https://crates.io/crates/ot-tools-io
- **Community**: https://www.elektronauts.com (Octatrack forum)
- **Related Tool**: [ot_utils](https://github.com/icaroferre/ot_utils) - Sample slicing utility

---

*Last Updated: 2025-11-04*
*Library Version Analyzed: 0.5.0*
