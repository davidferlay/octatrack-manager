# Octatrack Library Comparison & Integration Guide

## Executive Summary

This document compares the two main Rust libraries for Octatrack development and provides integration strategies for the Octatrack Manager application.

## Libraries Overview

### ot-tools-io (by dijksterhuis/Mike Robeson)
**Purpose**: Complete Octatrack project file I/O and management

**What it does:**
- Reads/writes Octatrack binary files (.work, .strd)
- Manages project settings, banks, patterns, arrangements
- Converts between binary ↔ YAML ↔ JSON
- Provides access to complete Octatrack data model

**What it doesn't do:**
- USB connectivity to devices
- Audio processing
- Sample file concatenation

### ot_utils (by icaroferre/Ícaro Ferre)
**Purpose**: Sample chain creation and .ot file generation

**What it does:**
- Concatenates multiple .wav files into one
- Generates .ot slice metadata files
- Optimizes sample slot usage

**What it doesn't do:**
- Read/write project files
- Manage banks or patterns
- Edit existing .ot files (write-only)

## Side-by-Side Comparison

| Feature | ot-tools-io | ot_utils |
|---------|-------------|----------|
| **License** | GPL-3.0+ | GPL-3.0 |
| **Repository** | GitLab | GitHub |
| **Maturity** | ~70-80% complete | Stable for mono 16-bit |
| **Code Size** | Large (full project model) | Small (228 LOC) |
| **Dependencies** | serde, bincode, many | hound |
| **Learning Curve** | Steep | Simple |

### File Type Support

| File Type | ot-tools-io | ot_utils |
|-----------|-------------|----------|
| project.work | ✅ Read/Write | ❌ |
| bank??.work | ✅ Read/Write | ❌ |
| arr??.work | ✅ Read/Write | ❌ |
| markers.work | ✅ Read/Write | ❌ |
| *.ot | ✅ Read/Write | ✅ Write only |
| *.wav | ❌ | ✅ Concatenate |

### Data Model Access

| Data | ot-tools-io | ot_utils |
|------|-------------|----------|
| Projects | ✅ Full | ❌ |
| Patterns | ✅ Full | ❌ |
| Parts | ✅ Full | ❌ |
| Trigs | ✅ Full | ❌ |
| Parameter Locks | ✅ Full | ❌ |
| Sample Slots | ✅ Full | ❌ |
| Slices | ✅ Read | ✅ Write |
| Audio Samples | ❌ | ✅ Concatenate |

### Format Conversion

| From/To | ot-tools-io | ot_utils |
|---------|-------------|----------|
| Binary → YAML | ✅ | ❌ |
| Binary → JSON | ✅ | ❌ |
| YAML → Binary | ✅ | ❌ |
| JSON → Binary | ✅ | ❌ |
| WAV files → Chain | ❌ | ✅ |

## Use Case Matrix

| Task | Best Library | Complexity |
|------|--------------|------------|
| Load project settings | ot-tools-io | Medium |
| View bank patterns | ot-tools-io | Medium |
| Edit parameter locks | ot-tools-io | High |
| Copy patterns between banks | ot-tools-io | Medium |
| Backup project to JSON | ot-tools-io | Low |
| Create sample chains | ot_utils | Low |
| Batch organize samples | ot_utils | Low |
| Generate .ot files | ot_utils | Low |
| Analyze project structure | ot-tools-io | High |
| Find unused samples | ot-tools-io | Medium |

## Integration Strategy for Octatrack Manager

### Phase 1: Device Discovery & Viewing (Current)
**Status**: ✅ Implemented
- [x] Scan for CF cards
- [x] Detect Octatrack sets
- [x] Display device list

**Libraries Used**: Neither (custom sysinfo-based)

### Phase 2: Sample Chain Management
**Priority**: High
**Library**: ot_utils

**Features to Implement:**
```rust
// Sample Chain Builder
#[tauri::command]
fn create_sample_chain(
    files: Vec<String>,
    output_folder: String,
    output_name: String,
    even_spacing: bool,
) -> Result<String, String>

// Batch Chain Creator
#[tauri::command]
fn batch_create_chains(
    root_folder: String,
) -> Result<Vec<ChainResult>, String>

// Get chain statistics
#[tauri::command]
fn analyze_chain(
    wav_path: String,
    ot_path: String,
) -> Result<ChainInfo, String>
```

**UI Components:**
- Drag-and-drop sample organizer
- Chain preview with waveform
- Batch folder processor
- Progress indicators

### Phase 3: Project Viewing
**Priority**: High
**Library**: ot-tools-io

**Features to Implement:**
```rust
// Load and display project
#[tauri::command]
fn load_project(
    project_path: String,
) -> Result<ProjectInfo, String>

// Load bank with patterns
#[tauri::command]
fn load_bank(
    bank_path: String,
) -> Result<BankInfo, String>

// Get sample slot assignments
#[tauri::command]
fn get_sample_slots(
    project_path: String,
) -> Result<Vec<SampleSlot>, String>
```

**UI Components:**
- Project browser
- Bank/pattern grid view
- Sample slot viewer
- Part (A/B/C/D) selector

### Phase 4: Project Management
**Priority**: Medium
**Library**: ot-tools-io

**Features to Implement:**
```rust
// Export project to JSON
#[tauri::command]
fn export_project(
    project_path: String,
    output_path: String,
) -> Result<(), String>

// Import project from JSON
#[tauri::command]
fn import_project(
    json_path: String,
    output_path: String,
) -> Result<(), String>

// Copy pattern between banks
#[tauri::command]
fn copy_pattern(
    source_bank: String,
    dest_bank: String,
    pattern_num: u8,
) -> Result<(), String>
```

**UI Components:**
- Backup/restore wizard
- Pattern clipboard
- Project diff viewer
- Validation warnings

### Phase 5: Advanced Features
**Priority**: Low
**Libraries**: Both

**Hybrid Features:**
1. **Smart Sample Assignment**
   - Use ot_utils to create chains
   - Use ot-tools-io to update project.work slots
   - One-click: folder → chain → assign to project

2. **Project Analysis**
   - Use ot-tools-io to scan all banks
   - Identify which samples are actually used
   - Suggest consolidation with ot_utils

3. **Complete Workflow**
   - Import samples
   - Auto-chain related samples (ot_utils)
   - Create project structure (ot-tools-io)
   - Configure patterns (ot-tools-io)

## Cargo.toml Configuration

Add both libraries to your dependencies:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Octatrack libraries
ot-tools-io = { git = "https://gitlab.com/ot-tools/ot-tools-io.git" }
ot_utils = "0.1.5"

# Supporting libraries
sysinfo = "0.32"
walkdir = "2"
hound = "3.5"  # If you need direct WAV access
```

## Module Organization

Suggested structure for src-tauri/src/:

```
src/
├── lib.rs                      # Main entry point
├── main.rs                     # Binary entry point
├── device_detection.rs         # Current CF card scanning
├── sample_chains/              # ot_utils integration
│   ├── mod.rs
│   ├── builder.rs              # Sample chain creation
│   └── analyzer.rs             # Chain inspection
├── project_manager/            # ot-tools-io integration
│   ├── mod.rs
│   ├── reader.rs               # Load projects/banks
│   ├── writer.rs               # Save/export projects
│   └── analyzer.rs             # Project analysis
└── utils/                      # Shared utilities
    ├── mod.rs
    ├── errors.rs               # Error handling
    └── types.rs                # Common types
```

## Error Handling Strategy

Create unified error type:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum OctaManagerError {
    #[error("Device detection error: {0}")]
    DeviceDetection(String),

    #[error("ot-tools-io error: {0}")]
    OtToolsIo(#[from] ot_tools_io::OtToolsIoError),

    #[error("ot_utils error: {0}")]
    OtUtils(String),

    #[error("File I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serde error: {0}")]
    Serde(#[from] serde_json::Error),
}

// Convert to string for Tauri commands
impl From<OctaManagerError> for String {
    fn from(err: OctaManagerError) -> String {
        err.to_string()
    }
}
```

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React)                   │
│  - Device List                                       │
│  - Sample Chain Builder                              │
│  - Project Browser                                   │
│  - Pattern Editor                                    │
└─────────────────────┬───────────────────────────────┘
                      │ Tauri Commands
                      ▼
┌─────────────────────────────────────────────────────┐
│              Rust Backend (Tauri)                    │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │   Device     │  │   Sample     │  │  Project   ││
│  │  Detection   │  │   Chains     │  │  Manager   ││
│  │              │  │              │  │            ││
│  │  sysinfo +   │  │  ot_utils    │  │ ot-tools-io││
│  │  walkdir     │  │              │  │            ││
│  └──────────────┘  └──────────────┘  └────────────┘│
└─────────────────────┬───────────────────────────────┘
                      │ File System Access
                      ▼
┌─────────────────────────────────────────────────────┐
│                File System                           │
│                                                      │
│  /media/OCTATRACK_CF/                               │
│  ├── Audio/                                         │
│  │   ├── sample1.wav                                │
│  │   ├── sample1.ot        ← ot_utils writes       │
│  │   └── ...                                        │
│  └── Presets/                                       │
│      ├── project.work       ← ot-tools-io r/w       │
│      ├── bank01.work        ← ot-tools-io r/w       │
│      ├── markers.work       ← ot-tools-io r/w       │
│      └── ...                                        │
└─────────────────────────────────────────────────────┘
```

## Recommended Development Order

1. ✅ **Device Discovery** (Completed)
   - Already implemented with sysinfo/walkdir

2. 🔄 **Sample Chain Builder** (Next)
   - Integrate ot_utils
   - Build UI for chain creation
   - Add batch processing

3. ⏭️ **Project Viewer** (After chains)
   - Integrate ot-tools-io
   - Display project metadata
   - Show bank/pattern structure

4. ⏭️ **Project Editor** (Advanced)
   - Modify projects
   - Copy patterns
   - Backup/restore

5. ⏭️ **Hybrid Features** (Final)
   - Smart sample management
   - Project analysis
   - Workflow automation

## Conclusion

Both libraries are **complementary** rather than competing:

- **ot_utils** = Sample preparation *before* Octatrack
- **ot-tools-io** = Project management *after* Octatrack

By integrating both, Octatrack Manager can provide a **complete workflow** from sample organization through project editing.

---

*Last Updated: 2025-11-04*
*Based on: ot-tools-io v0.5.0, ot_utils v0.1.5*
