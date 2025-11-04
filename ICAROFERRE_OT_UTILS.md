# ot_utils Library Capabilities Analysis

## Overview

The ot_utils library is a Rust crate for concatenating multiple audio samples into a single .wav file and automatically generating the corresponding .ot (slice) metadata file for the Elektron Octatrack sampler. This allows musicians to group related samples (e.g., multiple kick drums) into one sample slot, conserving valuable machine resources on the Octatrack.


## Author & Inspiration

- Author: Ícaro Ferre (icaroferre)
- Inspired by: OctaChainer tool by Kai Drange
- License: GPL-3.0
- Repository: https://github.com/icaroferre/ot_utils
- Documentation: https://docs.rs/ot_utils

## Core Technology Stack

- Audio I/O: Built on `hound` (v3.5.1) for WAV file reading/writing
- Language: Rust (100%)
- Size: 18KB, 228 lines of code
- Version: 0.1.5 (latest as of Aug 21, 2025)
- Ranking: #293 in Audio category on Lib.rs

## Purpose & Use Cases

### Primary Use Case
Consolidate multiple audio samples into a single WAV file with slice markers, allowing the Octatrack to access each original sample as an individual slice. This is ideal for:

- Sample slot conservation: Use 1 slot instead of 16 for a kick drum collection
- Pattern organization: Keep related sounds together (hi-hats, snares, etc.)
- Performance efficiency: Quick access to variations via slice selection
- Workflow optimization: Batch process sample collections

### Workflow Benefits
Instead of loading individual samples across multiple slots:
```
Slot 1: Kick_01.wav
Slot 2: Kick_02.wav
...
Slot 16: Kick_16.wav
```

You can load one sliced sample:
```
Slot 1: Kicks.wav (with 16 slices)
  - Slice 1 = Kick_01
  - Slice 2 = Kick_02
  ...
  - Slice 16 = Kick_16
```

## Public API

### Structs

#### 1. Slicer - Main Library Struct

The primary interface for concatenating samples and generating output files.

Fields:
- `output_folder: String` - Directory where generated files will be saved
- `output_filename: String` - Name for output files (without extension)
- `sample_rate: u32` - Audio sample rate (e.g., 44100, 48000)
- `slices: Vec<OTSlice>` - Collection of slice metadata
- `filelist: Vec<PathBuf>` - Queue of audio files to process
- `stereo: bool` - Stereo audio support flag (currently mono only)
- `tempo: u32` - BPM/tempo value

Methods:

```rust
// Create a new Slicer instance
pub fn new() -> Slicer

// Clear all slices and reset sample offset
pub fn clear(&mut self)

// Add an audio file to the concatenation queue
pub fn add_file(&mut self, filepath: String) -> Result<(), Box<dyn Error>>

// Generate the .ot file and rename the concatenated .wav file
// even_spacing: if true, spaces slices evenly regardless of actual lengths
pub fn generate_ot_file(&mut self, even_spacing: bool) -> Result<(), Box<dyn Error>>
```

Default Implementation:
```rust
impl Default for Slicer {
    fn default() -> Self {
        Slicer {
            output_folder: String::new(),
            output_filename: String::new(),
            sample_rate: 44100,
            slices: Vec::new(),
            filelist: Vec::new(),
            stereo: false,
            tempo: 120,
        }
    }
}
```

#### 2. OTSlice - Individual Slice Metadata

Represents a single slice within the concatenated sample.

Fields:
- `start_point: u32` - Starting position in samples
- `length: u32` - Slice duration in samples
- `loop_point: u32` - Loop point position in samples

Traits:
- `Copy`, `Send`, `Sync`, `Freeze` - Simple data container

## .OT File Format

### Technical Specification

The .ot file is a binary metadata sidecar file that accompanies .wav files on the Octatrack.

File Contents:
- Gain settings (default +12dB for recordings)
- Trim values (in sample counts)
- Slice boundaries (start/end positions as sample points)
- Loop settings (loop start and length)
- Sample attributes (various playback settings)

Data Encoding:
- All values stored in hexadecimal
- Positions measured in sample counts, not time
- Requires checksum byte at end (sum of all bytes)
- Uses big-endian byte order (bswap32 for position calculations)

File Relationship:
The .ot file must be kept in the same folder as its corresponding .wav file. When the Octatrack loads the .wav, it automatically applies settings from the .ot file.

### Slice Position Calculation

For a 100-sample file divided into 4 equal slices:
```
Slice 1: samples 0-25
Slice 2: samples 25-50
Slice 3: samples 50-75
Slice 4: samples 75-100
```

## Usage Examples

### Basic Usage

```rust
use ot_utils::Slicer;
use std::fs;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut slicer = Slicer::default();

    // Set output configuration
    slicer.output_folder = "path/to/output".to_string();
    slicer.output_filename = "kick_collection".to_string();
    slicer.sample_rate = 48000;

    // Add audio files
    let folder = Path::new("path/to/kick/samples");
    if folder.is_dir() {
        for entry in fs::read_dir(folder)? {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("wav") {
                slicer.add_file(path.to_string_lossy().to_string())?;
            }
        }
    }

    // Generate output files
    slicer.generate_ot_file(false)?;

    Ok(())
}
```

### With Even Spacing

```rust
// Generate with evenly-spaced slices (ignores actual sample lengths)
slicer.generate_ot_file(true)?;
```

This creates slices of equal duration regardless of the original file lengths, useful for creating grids or step sequences.

### Processing Multiple Folders

```rust
use ot_utils::Slicer;
use std::fs;

fn process_sample_folders(root: &str) -> Result<(), Box<dyn std::error::Error>> {
    for entry in fs::read_dir(root)? {
        let folder = entry?.path();

        if !folder.is_dir() {
            continue;
        }

        let mut slicer = Slicer::default();
        slicer.output_folder = folder.to_string_lossy().to_string();
        slicer.output_filename = folder
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Add all .wav files in this folder
        for wav_file in fs::read_dir(&folder)? {
            let path = wav_file?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("wav") {
                slicer.add_file(path.to_string_lossy().to_string())?;
            }
        }

        slicer.generate_ot_file(false)?;
        println!("Processed: {}", folder.display());
    }

    Ok(())
}
```

## Current Limitations

### Audio Format Restrictions

Supported:
- ✅ Mono (1 channel)
- ✅ 16-bit depth
- ✅ WAV format only

Not Supported:
- ❌ Stereo files
- ❌ 24-bit or 32-bit depth
- ❌ Other formats (AIFF, FLAC, MP3, etc.)

### Planned Features

According to the developer discussions:
- Stereo support
- 24/32-bit depth support
- Better error handling
- Visual feedback for split accuracy

## Related Tool: AudioHit

AudioHit is a command-line utility built on top of ot_utils that extends its functionality:

Additional Features:
- Automatic audio trimming and fading
- File splitting into multiple samples
- Format conversion
- Sample rate reduction
- Speed adjustment (e.g., 4x acceleration)
- Batch processing multiple operations in one command

Workflow Consolidation:
AudioHit combines tasks that typically require 3-4 separate applications:
1. Split files
2. Convert formats
3. Trim samples
4. Apply fading
5. Adjust speed
6. Concatenate with .ot generation

Repository: https://github.com/icaroferre/AudioHit

## Integration with Octatrack Manager

### Potential Use Cases

#### 1. Sample Chain Generator
Add UI to create sample chains from folders:

```rust
#[tauri::command]
fn create_sample_chain(
    input_folder: String,
    output_name: String,
    even_spacing: bool,
) -> Result<String, String> {
    use ot_utils::Slicer;

    let mut slicer = Slicer::default();
    slicer.output_folder = input_folder.clone();
    slicer.output_filename = output_name;

    // Add all .wav files
    for entry in std::fs::read_dir(&input_folder).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("wav") {
            slicer.add_file(path.to_string_lossy().to_string())
                .map_err(|e| e.to_string())?;
        }
    }

    slicer.generate_ot_file(even_spacing)
        .map_err(|e| e.to_string())?;

    Ok(format!("Created {}.wav and {}.ot", slicer.output_filename, slicer.output_filename))
}
```

#### 2. Batch Sample Organizer
Process multiple folders of samples at once:

```rust
#[tauri::command]
fn batch_create_chains(root_folder: String) -> Result<Vec<String>, String> {
    use ot_utils::Slicer;
    use std::fs;

    let mut results = Vec::new();

    for entry in fs::read_dir(&root_folder).map_err(|e| e.to_string())? {
        let folder = entry.map_err(|e| e.to_string())?.path();

        if !folder.is_dir() {
            continue;
        }

        let mut slicer = Slicer::default();
        slicer.output_folder = folder.to_string_lossy().to_string();
        slicer.output_filename = folder
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        for wav in fs::read_dir(&folder).map_err(|e| e.to_string())? {
            let path = wav.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("wav") {
                slicer.add_file(path.to_string_lossy().to_string())
                    .map_err(|e| e.to_string())?;
            }
        }

        slicer.generate_ot_file(false)
            .map_err(|e| e.to_string())?;

        results.push(format!("✓ {}", folder.file_name().unwrap().to_string_lossy()));
    }

    Ok(results)
}
```

#### 3. Sample Inspector
View slice information from existing .ot files:

```rust
#[derive(serde::Serialize)]
struct SliceInfo {
    index: usize,
    start_point: u32,
    length: u32,
    loop_point: u32,
    duration_ms: f64,
}

#[tauri::command]
fn inspect_slices(ot_file_path: String, sample_rate: u32) -> Result<Vec<SliceInfo>, String> {
    // This would require reading .ot file format
    // ot_utils doesn't currently expose a reader, only a writer
    // We'd need to implement .ot file parsing
    todo!("Implement .ot file reader")
}
```

### Frontend UI Ideas

Sample Chain Builder:
```
┌─────────────────────────────────────┐
│   Sample Chain Builder              │
├─────────────────────────────────────┤
│ Input Folder: [Browse...]           │
│ Output Name:  [kick_collection]     │
│                                     │
│ Files to chain (16):                │
│ ✓ kick_01.wav                       │
│ ✓ kick_02.wav                       │
│ ✓ ...                               │
│                                     │
│ Options:                            │
│ □ Even spacing                      │
│ Sample Rate: [44100 ▼]              │
│                                     │
│ [Generate Chain]                    │
└─────────────────────────────────────┘
```

Batch Processor:
```
┌─────────────────────────────────────┐
│   Batch Sample Chain Creator        │
├─────────────────────────────────────┤
│ Root Folder: [Browse...]            │
│                                     │
│ Found 5 folders:                    │
│ ✓ Kicks/                            │
│ ✓ Snares/                           │
│ ✓ HiHats/                           │
│ ✓ Toms/                             │
│ ✓ Cymbals/                          │
│                                     │
│ Progress: [██████████] 5/5          │
│                                     │
│ Results:                            │
│ ✓ Created Kicks.wav (12 slices)    │
│ ✓ Created Snares.wav (8 slices)    │
│ ✓ Created HiHats.wav (16 slices)   │
│ ...                                 │
└─────────────────────────────────────┘
```

## Comparison: ot_utils vs ot-tools-io

| Feature | ot_utils | ot-tools-io |
|---------|----------|-------------|
| Purpose | Create sample chains | Read/write Octatrack project files |
| File Types | .wav + .ot only | .work, .strd, .ot files |
| Scope | Sample preparation | Complete project management |
| Audio Processing | Concatenation | None (metadata only) |
| Project Files | ❌ No | ✅ Yes |
| Format Conversion | ❌ No | ✅ YAML/JSON |
| Sample Chains | ✅ Yes | ❌ No |
| Dependencies | hound (audio) | serde, bincode |
| Use Case | Pre-Octatrack sample prep | Post-Octatrack file editing |

### Complementary Usage

These libraries serve different purposes:

1. ot_utils: Prepare samples *before* loading to Octatrack
   - Organize sample collections
   - Create efficient sample chains
   - Save device memory

2. ot-tools-io: Manage projects *after* creation on Octatrack
   - Edit project settings
   - Copy patterns between banks
   - Backup/restore projects
   - Analyze project structure

Combined Workflow:
```
Sample Collection (folders)
        ↓
    ot_utils (chain samples)
        ↓
  Octatrack (create music)
        ↓
   ot-tools-io (edit/backup)
```

## Advanced Topics

### Understanding Sample Offsets

When concatenating samples, ot_utils tracks cumulative offsets:

```rust
// Pseudo-code representation
let mut current_offset = 0;

for file in wav_files {
    let samples = read_wav_samples(file);

    slices.push(OTSlice {
        start_point: current_offset,
        length: samples.len() as u32,
        loop_point: current_offset, // Or custom loop point
    });

    current_offset += samples.len() as u32;

    // Append samples to output wav
    output_wav.append(samples);
}
```

### Even Spacing Algorithm

When `even_spacing = true`, slice boundaries are calculated differently:

```rust
// Pseudo-code
let total_samples = wav_length;
let num_slices = filelist.len();
let slice_length = total_samples / num_slices;

for i in 0..num_slices {
    slices.push(OTSlice {
        start_point: i * slice_length,
        length: slice_length,
        loop_point: i * slice_length,
    });
}
```

This creates a grid of equal-length slices, useful for step sequencing or chromatic playing.

### .OT File Binary Structure

Based on OctaChainer source code analysis:

```
Offset | Size | Description
-------|------|-------------
0x00   | ?    | Header/magic bytes
?      | 4    | Sample rate (32-bit, big-endian)
?      | 4    | Gain setting (hexadecimal)
?      | 4    | Trim start (sample count)
?      | 4    | Trim end (sample count)
?      | ?    | Slice data (variable length)
       |      |   - Per slice: start, length, loop_point (each 4 bytes)
?      | 1    | Checksum (sum of all bytes)
```

*Note: Exact structure may vary by Octatrack OS version*

## References & Resources

### Official Resources
- Documentation: https://docs.rs/ot_utils
- Repository: https://github.com/icaroferre/ot_utils
- Crates.io: https://crates.io/crates/ot_utils

### Related Projects
- AudioHit: CLI built on ot_utils - https://github.com/icaroferre/AudioHit
- OctaChainer: Original Qt-based tool - https://github.com/KaiDrange/OctaChainer
- ot-tools-io: Octatrack project file I/O - https://gitlab.com/ot-tools/ot-tools-io

### Community Resources
- Elektronauts Forum: https://www.elektronauts.com
  - AudioHit announcement: /t/audiohit-ot-utils-cli-and-rust-library-for-the-octatrack/135533
  - .OT format discussion: /t/ot-format-definition/160601

### Dependencies
- hound v3.5.1: WAV file I/O - https://docs.rs/hound

## Recommended Features for Octatrack Manager

### High Priority
1. ✅ Sample Chain Builder - GUI for creating chains from folders
2. ✅ Batch Chain Creator - Process multiple folders at once
3. ✅ Drag-and-drop - Reorder samples before chaining

### Medium Priority
4. ⚠️ Preview slices - Visual waveform with slice markers
5. ⚠️ Custom loop points - Set loop per slice
6. ⚠️ .OT reader - View existing slice data (requires implementation)

### Low Priority
7. ⏳ Slice editor - Modify existing .ot files
8. ⏳ Auto-detect silence - Smart slice boundaries
9. ⏳ Normalize levels - Consistent volume across slices

### Blocked (Library Limitations)
- ❌ Stereo support (awaiting library update)
- ❌ 24/32-bit files (awaiting library update)
- ❌ Non-WAV formats (out of scope)

---

*Last Updated: 2025-11-04*
*Library Version Analyzed: 0.1.5*
*Status: Actively maintained*
