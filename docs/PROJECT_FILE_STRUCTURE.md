# Octatrack Project File Structure Documentation

This document provides exhaustive documentation of the data available in Octatrack project files (`.work` and `.strd` formats) and how to access it using the `ot-tools-io` library.

## Table of Contents

- [Overview](#overview)
- [File Structure](#file-structure)
- [Metadata](#metadata)
- [Settings](#settings)
  - [Control Menu](#control-menu)
  - [Mixer Settings](#mixer-settings)
  - [Tempo Settings](#tempo-settings)
  - [MIDI Settings](#midi-settings)
- [States](#states)
- [Sample Slots](#sample-slots)
- [Bank Files](#bank-files)
- [Code Examples](#code-examples)

---

## Overview

Octatrack project files contain comprehensive information about:
- Project metadata (OS version, file type)
- All settings and configurations
- Current state (active bank, pattern, part, track)
- Sample slots (128 static + 128 flex)
- Mixer configuration
- MIDI settings
- Track mute/solo states

## File Structure

```rust
use ot_tools_io::{ProjectFile, OctatrackFileIO};

// Load a project file
let project = ProjectFile::from_data_file("path/to/project.work")?;
```

The `ProjectFile` struct contains four main sections:
1. `metadata` - File metadata
2. `settings` - All project settings
3. `states` - Current playback state
4. `slots` - Sample slot assignments

---

## Metadata

### Structure

```rust
pub struct OsMetadata {
    pub filetype: String,      // "OCTATRACK DPS-1 PROJECT"
    pub project_version: u8,   // Project file version (e.g., 19)
    pub os_version: String,    // OS version (e.g., "R0177     1.40B")
}
```

### Access

```rust
let filetype = &project.metadata.filetype;
let project_version = project.metadata.project_version;
let os_version = &project.metadata.os_version;
```

### Example Values

```
filetype: "OCTATRACK DPS-1 PROJECT"
project_version: 19
os_version: "R0177     1.40B"
```

---

## Settings

### Control Menu

The control menu contains various audio, sequencer, and metronome settings.

#### Audio Control

```rust
pub struct AudioControlPage {
    pub master_track: bool,         // Master track enabled
    pub cue_studio_mode: bool,      // Cue studio mode enabled
}
```

**Access:**
```rust
let master_track = project.settings.control.audio.master_track;
let cue_mode = project.settings.control.audio.cue_studio_mode;
```

#### Input Control

```rust
pub struct InputControlPage {
    pub gate_ab: u8,                       // Gate threshold for AB inputs (0-127)
    pub gate_cd: u8,                       // Gate threshold for CD inputs (0-127)
    pub input_delay_compensation: bool,    // Input delay compensation enabled
}
```

**Access:**
```rust
let gate_ab = project.settings.control.input.gate_ab;
let gate_cd = project.settings.control.input.gate_cd;
let delay_comp = project.settings.control.input.input_delay_compensation;
```

#### Sequencer Control

```rust
pub struct SequencerControlPage {
    pub pattern_change_chain_behaviour: u8,         // Pattern chain behavior (0-15)
    pub pattern_change_auto_silence_tracks: bool,   // Auto-silence tracks on pattern change
    pub pattern_change_auto_trig_lfos: bool,        // Auto-trigger LFOs on pattern change
}
```

**Access:**
```rust
let chain_behaviour = project.settings.control.sequencer.pattern_change_chain_behaviour;
let auto_silence = project.settings.control.sequencer.pattern_change_auto_silence_tracks;
let auto_trig_lfos = project.settings.control.sequencer.pattern_change_auto_trig_lfos;
```

#### Memory Control

```rust
pub struct MemoryControlPage {
    pub load_24bit_flex: bool,              // Load flex samples in 24-bit
    pub dynamic_recorders: bool,            // Dynamic recorders enabled
    pub record_24bit: bool,                 // Record in 24-bit
    pub reserved_recorder_count: u8,        // Number of reserved recorders (0-8)
    pub reserved_recorder_length: u8,       // Reserved recorder length
}
```

**Access:**
```rust
let load_24bit = project.settings.control.memory.load_24bit_flex;
let dynamic_rec = project.settings.control.memory.dynamic_recorders;
let rec_24bit = project.settings.control.memory.record_24bit;
let rec_count = project.settings.control.memory.reserved_recorder_count;
let rec_length = project.settings.control.memory.reserved_recorder_length;
```

#### Metronome Control

```rust
pub struct MetronomeControlPage {
    pub metronome_time_signature: u8,              // Time signature numerator - 1 (e.g., 3 = 4/4)
    pub metronome_time_signature_denominator: u8,  // Denominator power (2 = 1/4, 3 = 1/8)
    pub metronome_preroll: u8,                     // Preroll bars (0-4)
    pub metronome_cue_volume: u8,                  // Cue volume (0-127)
    pub metronome_main_volume: u8,                 // Main volume (0-127)
    pub metronome_pitch: u8,                       // Pitch (0-24)
    pub metronome_tonal: bool,                     // Tonal metronome
    pub metronome_enabled: bool,                   // Metronome enabled
}
```

**Access & Calculation:**
```rust
// Time signature calculation
let numerator = project.settings.control.metronome.metronome_time_signature + 1;
let denominator = 2u32.pow(project.settings.control.metronome.metronome_time_signature_denominator as u32);
let time_signature = format!("{}/{}", numerator, denominator);

let preroll = project.settings.control.metronome.metronome_preroll;
let cue_vol = project.settings.control.metronome.metronome_cue_volume;
let main_vol = project.settings.control.metronome.metronome_main_volume;
let pitch = project.settings.control.metronome.metronome_pitch;
let tonal = project.settings.control.metronome.metronome_tonal;
let enabled = project.settings.control.metronome.metronome_enabled;
```

**Example:**
```
metronome_time_signature: 3       → 4/4 (3 + 1 = 4)
metronome_time_signature_denominator: 2  → 4 (2^2 = 4)
Result: "4/4"
```

### Mixer Settings

```rust
pub struct MixerMenu {
    pub gain_ab: u8,        // Gain for AB inputs (0-127)
    pub gain_cd: u8,        // Gain for CD inputs (0-127)
    pub dir_ab: u8,         // Direct monitoring AB (0-127)
    pub dir_cd: u8,         // Direct monitoring CD (0-127)
    pub phones_mix: u8,     // Headphones mix (0-127)
    pub main_to_cue: u8,    // Main to cue send (0-127)
    pub main_level: u8,     // Main output level (0-127)
    pub cue_level: u8,      // Cue output level (0-127)
}
```

**Access:**
```rust
let gain_ab = project.settings.mixer.gain_ab;
let gain_cd = project.settings.mixer.gain_cd;
let dir_ab = project.settings.mixer.dir_ab;
let dir_cd = project.settings.mixer.dir_cd;
let phones_mix = project.settings.mixer.phones_mix;
let main_to_cue = project.settings.mixer.main_to_cue;
let main_level = project.settings.mixer.main_level;
let cue_level = project.settings.mixer.cue_level;
```

**Example Values:**
```
gain_ab: 64
gain_cd: 64
dir_ab: 0
dir_cd: 0
phones_mix: 64
main_level: 57
cue_level: 64
```

### Tempo Settings

```rust
pub struct TempoMenu {
    pub tempo: u16,                  // BPM (40-300)
    pub pattern_tempo_enabled: bool, // Pattern tempo enabled
}
```

**Access:**
```rust
let tempo = project.settings.tempo.tempo as f32;
let pattern_tempo = project.settings.tempo.pattern_tempo_enabled;
```

**Example:**
```
tempo: 100
pattern_tempo_enabled: true
```

### MIDI Settings

#### MIDI Control

```rust
pub struct MidiControlMidiPage {
    pub midi_audio_track_cc_in: bool,     // Audio track CC in enabled
    pub midi_audio_track_cc_out: u8,      // Audio track CC out (0-2)
    pub midi_audio_track_note_in: u8,     // Audio track note in (0-2)
    pub midi_audio_track_note_out: u8,    // Audio track note out (0-2)
    pub midi_midi_track_cc_in: u8,        // MIDI track CC in (0-2)
}
```

**Access:**
```rust
let audio_cc_in = project.settings.control.midi.control.midi_audio_track_cc_in;
let audio_cc_out = project.settings.control.midi.control.midi_audio_track_cc_out;
let audio_note_in = project.settings.control.midi.control.midi_audio_track_note_in;
let audio_note_out = project.settings.control.midi.control.midi_audio_track_note_out;
let midi_cc_in = project.settings.control.midi.control.midi_midi_track_cc_in;
```

#### MIDI Sync

```rust
pub struct MidiSyncMidiPage {
    pub midi_clock_send: bool,                    // Send MIDI clock
    pub midi_clock_receive: bool,                 // Receive MIDI clock
    pub midi_transport_send: bool,                // Send transport messages
    pub midi_transport_receive: bool,             // Receive transport messages
    pub midi_progchange_send: bool,               // Send program change
    pub midi_progchange_send_channel: Channel,    // Program change send channel
    pub midi_progchange_receive: bool,            // Receive program change
    pub midi_progchange_receive_channel: Channel, // Program change receive channel
}
```

**Access:**
```rust
let clock_send = project.settings.control.midi.sync.midi_clock_send;
let clock_receive = project.settings.control.midi.sync.midi_clock_receive;
let transport_send = project.settings.control.midi.sync.midi_transport_send;
let transport_receive = project.settings.control.midi.sync.midi_transport_receive;
let pc_send = project.settings.control.midi.sync.midi_progchange_send;
let pc_receive = project.settings.control.midi.sync.midi_progchange_receive;
```

#### MIDI Channels

```rust
pub struct MidiChannelsMidiPage {
    pub midi_trig_ch1: i8,      // MIDI channel for track 1 (-1 = disabled, 0-15)
    pub midi_trig_ch2: i8,      // MIDI channel for track 2
    pub midi_trig_ch3: i8,      // MIDI channel for track 3
    pub midi_trig_ch4: i8,      // MIDI channel for track 4
    pub midi_trig_ch5: i8,      // MIDI channel for track 5
    pub midi_trig_ch6: i8,      // MIDI channel for track 6
    pub midi_trig_ch7: i8,      // MIDI channel for track 7
    pub midi_trig_ch8: i8,      // MIDI channel for track 8
    pub midi_auto_channel: i8,  // Auto channel (-1 = disabled)
}
```

**Access:**
```rust
let channels = [
    project.settings.control.midi.channels.midi_trig_ch1,
    project.settings.control.midi.channels.midi_trig_ch2,
    project.settings.control.midi.channels.midi_trig_ch3,
    project.settings.control.midi.channels.midi_trig_ch4,
    project.settings.control.midi.channels.midi_trig_ch5,
    project.settings.control.midi.channels.midi_trig_ch6,
    project.settings.control.midi.channels.midi_trig_ch7,
    project.settings.control.midi.channels.midi_trig_ch8,
];
let auto_channel = project.settings.control.midi.channels.midi_auto_channel;
```

### MIDI Track Trig Modes

```rust
pub struct MidiTrackTrigModes {
    pub trig_mode_midi_track_1: u8,  // Trig mode for MIDI track 1
    pub trig_mode_midi_track_2: u8,  // Trig mode for MIDI track 2
    pub trig_mode_midi_track_3: u8,  // Trig mode for MIDI track 3
    pub trig_mode_midi_track_4: u8,  // Trig mode for MIDI track 4
    pub trig_mode_midi_track_5: u8,  // Trig mode for MIDI track 5
    pub trig_mode_midi_track_6: u8,  // Trig mode for MIDI track 6
    pub trig_mode_midi_track_7: u8,  // Trig mode for MIDI track 7
    pub trig_mode_midi_track_8: u8,  // Trig mode for MIDI track 8
}
```

---

## States

The states section contains the current playback state of the project.

```rust
pub struct State {
    pub bank: u8,                   // Active bank (0-3 = A-D)
    pub pattern: u8,                // Active pattern (0-15)
    pub arrangement: u8,            // Active arrangement
    pub arrangement_mode: u8,       // Arrangement mode
    pub part: u8,                   // Active part (0-3)
    pub track: u8,                  // Active track (0-7)
    pub track_othermode: u8,        // Track other mode
    pub scene_a_mute: bool,         // Scene A mute state
    pub scene_b_mute: bool,         // Scene B mute state
    pub track_cue_mask: u8,         // Track cue mask (bitmask)
    pub track_mute_mask: u8,        // Track mute mask (bitmask)
    pub track_solo_mask: u8,        // Track solo mask (bitmask)
    pub midi_track_mute_mask: u8,   // MIDI track mute mask (bitmask)
    pub midi_track_solo_mask: u8,   // MIDI track solo mask (bitmask)
    pub midi_mode: u8,              // MIDI mode
}
```

### Access

**Basic State:**
```rust
let bank = project.states.bank;  // 0-3 (A-D)
let pattern = project.states.pattern;  // 0-15
let part = project.states.part;  // 0-3
let track = project.states.track;  // 0-7
```

**Bank Name Conversion:**
```rust
let bank_letters = ["A", "B", "C", "D"];
let bank_name = bank_letters.get(project.states.bank as usize)
    .unwrap_or(&"A")
    .to_string();
```

**Muted/Soloed Tracks (Bitmask Extraction):**
```rust
// Extract muted tracks from bitmask
let mut muted_tracks = Vec::new();
for i in 0..8 {
    if project.states.track_mute_mask & (1 << i) != 0 {
        muted_tracks.push(i);
    }
}

// Extract soloed tracks from bitmask
let mut soloed_tracks = Vec::new();
for i in 0..8 {
    if project.states.track_solo_mask & (1 << i) != 0 {
        soloed_tracks.push(i);
    }
}

// Extract cued tracks
let mut cued_tracks = Vec::new();
for i in 0..8 {
    if project.states.track_cue_mask & (1 << i) != 0 {
        cued_tracks.push(i);
    }
}
```

### Example Values

```
bank: 0 (Bank A)
pattern: 3 (Pattern 4, displayed as 1-indexed)
part: 0 (Part 1)
track: 7 (Track 8)
track_mute_mask: 59 (binary: 00111011 = tracks 0,1,3,4,5 muted)
track_solo_mask: 0 (no tracks soloed)
```

**Bitmask Example:**
```
track_mute_mask: 59 (decimal) = 00111011 (binary)
Bit 0 (value 1): SET   → Track 1 muted
Bit 1 (value 2): SET   → Track 2 muted
Bit 2 (value 4): CLEAR → Track 3 not muted
Bit 3 (value 8): SET   → Track 4 muted
Bit 4 (value 16): SET  → Track 5 muted
Bit 5 (value 32): SET  → Track 6 muted
Bit 6 (value 64): CLEAR → Track 7 not muted
Bit 7 (value 128): CLEAR → Track 8 not muted

Result: Tracks 1,2,4,5,6 are muted (indices 0,1,3,4,5)
```

---

## Sample Slots

The Octatrack has 128 static slots and 128 flex slots for samples.

### Structure

```rust
pub struct SlotsAttributes {
    pub static_slots: Array<Option<SlotAttributes>, 128>,
    pub flex_slots: Array<Option<SlotAttributes>, 128>,
}

pub struct SlotAttributes {
    pub slot_type: SlotType,              // Static or Flex
    pub slot_id: u8,                      // Slot number (1-128)
    pub path: Option<String>,             // Sample path (None if empty)
    pub timestrech_mode: TimestretchMode, // Off, Normal, Beat
    pub loop_mode: LoopMode,              // Off, Normal
    pub trig_quantization_mode: TrigQuantization, // Direct, Pattern, etc.
    pub gain: u8,                         // Gain (0-127)
    pub bpm: u16,                         // Detected/set BPM
}
```

### Enums

```rust
pub enum SlotType {
    Static,
    Flex,
}

pub enum TimestretchMode {
    Off,
    Normal,
    Beat,
}

pub enum LoopMode {
    Off,
    Normal,
}

pub enum TrigQuantization {
    Direct,
    Pattern,
    // ... other modes
}
```

### Access

**Iterate Through Static Slots:**
```rust
for slot_opt in project.slots.static_slots.iter() {
    if let Some(slot) = slot_opt {
        if let Some(path) = &slot.path {
            println!("Static Slot {}: {}", slot.slot_id, path);
            println!("  Gain: {}", slot.gain);
            println!("  Loop Mode: {:?}", slot.loop_mode);
            println!("  Timestretch: {:?}", slot.timestrech_mode);
            println!("  BPM: {}", slot.bpm);
        }
    }
}
```

**Iterate Through Flex Slots:**
```rust
for slot_opt in project.slots.flex_slots.iter() {
    if let Some(slot) = slot_opt {
        if let Some(path) = &slot.path {
            println!("Flex Slot {}: {}", slot.slot_id, path);
            println!("  Gain: {}", slot.gain);
            println!("  Loop Mode: {:?}", slot.loop_mode);
            println!("  Timestretch: {:?}", slot.timestrech_mode);
        }
    }
}
```

**Create Structured Data:**
```rust
let mut static_slots = Vec::new();
for slot_opt in project.slots.static_slots.iter() {
    if let Some(slot) = slot_opt {
        if let Some(path) = &slot.path {
            static_slots.push(SampleSlot {
                slot_id: slot.slot_id,
                slot_type: "Static".to_string(),
                path: path.clone(),
                gain: slot.gain,
                loop_mode: format!("{:?}", slot.loop_mode),
                timestretch_mode: format!("{:?}", slot.timestrech_mode),
            });
        }
    }
}
```

### Example Values

**Static Slot Example:**
```
slot_id: 1
slot_type: Static
path: Some("LS_FX_07.wav")
timestrech_mode: Normal
loop_mode: Off
trig_quantization_mode: Direct
gain: 48
bpm: 2880
```

**Flex Slot Example:**
```
slot_id: 33
slot_type: Flex
path: Some("SPMV_138_A#_Gated_Voice_02_(Wet).wav")
timestrech_mode: Normal
loop_mode: Normal
trig_quantization_mode: Direct
gain: 48
bpm: 2880
```

**Empty Slot:**
```
None  // No sample assigned to this slot
```

---

## Bank Files

Bank files (bank01.work, bank02.work, etc.) contain pattern and part information.

### Structure

```rust
use ot_tools_io::{BankFile, OctatrackFileIO};

let bank_file = BankFile::from_data_file("path/to/bank01.work")?;
```

### Available Data

```rust
pub struct BankFile {
    pub part_names: [[u8; 16]; 4],  // 4 parts, 16 bytes each for name
    pub patterns: Vec<Pattern>,      // 16 patterns per part
    // ... additional pattern data
}
```

### Access Part Names

```rust
use ot_tools_io::{BankFile, OctatrackFileIO};
use std::path::Path;

let bank_letters = ["A", "B", "C", "D"];

for (idx, bank_letter) in bank_letters.iter().enumerate() {
    let bank_num = idx + 1;
    let bank_file_name = format!("bank{:02}.work", bank_num);
    let bank_file_path = Path::new("project_path").join(&bank_file_name);

    if let Ok(bank_data) = BankFile::from_data_file(&bank_file_path) {
        // Extract part names
        for part_id in 0..4 {
            let part_name_bytes = &bank_data.part_names[part_id];
            let part_name = String::from_utf8_lossy(part_name_bytes)
                .trim_end_matches('\0')
                .to_string();

            let part_name = if part_name.is_empty() {
                format!("Part {}", part_id + 1)
            } else {
                part_name
            };

            println!("Bank {}, Part {}: {}", bank_letter, part_id + 1, part_name);
        }
    }
}
```

---

## Code Examples

### Complete Project Reader

```rust
use ot_tools_io::{ProjectFile, OctatrackFileIO};
use std::path::Path;

pub fn read_project_metadata(project_path: &str) -> Result<(), String> {
    let path = Path::new(project_path);

    // Find project file
    let project_file_path = if path.join("project.work").exists() {
        path.join("project.work")
    } else if path.join("project.strd").exists() {
        path.join("project.strd")
    } else {
        return Err("No project file found".to_string());
    };

    // Load project
    let project = ProjectFile::from_data_file(&project_file_path)
        .map_err(|e| format!("Failed to read project: {:?}", e))?;

    // Access metadata
    println!("OS Version: {}", project.metadata.os_version);

    // Access tempo
    println!("Tempo: {} BPM", project.settings.tempo.tempo);

    // Calculate time signature
    let numerator = project.settings.control.metronome.metronome_time_signature + 1;
    let denominator = 2u32.pow(
        project.settings.control.metronome.metronome_time_signature_denominator as u32
    );
    println!("Time Signature: {}/{}", numerator, denominator);

    // Access current state
    let bank_letters = ["A", "B", "C", "D"];
    let bank_name = bank_letters[project.states.bank as usize];
    println!("Bank: {}", bank_name);
    println!("Pattern: {}", project.states.pattern + 1);
    println!("Part: {}", project.states.part + 1);
    println!("Track: {}", project.states.track + 1);

    // Extract muted tracks
    let mut muted_tracks = Vec::new();
    for i in 0..8 {
        if project.states.track_mute_mask & (1 << i) != 0 {
            muted_tracks.push(i + 1);
        }
    }
    println!("Muted Tracks: {:?}", muted_tracks);

    // Access mixer settings
    println!("Main Level: {}", project.settings.mixer.main_level);
    println!("Cue Level: {}", project.settings.mixer.cue_level);

    // Count sample slots
    let static_count = project.slots.static_slots.iter()
        .filter(|s| s.is_some())
        .count();
    let flex_count = project.slots.flex_slots.iter()
        .filter(|s| s.is_some())
        .count();

    println!("Static Slots Used: {}/128", static_count);
    println!("Flex Slots Used: {}/128", flex_count);

    Ok(())
}
```

### Sample Slot Analyzer

```rust
use ot_tools_io::{ProjectFile, OctatrackFileIO};

pub fn analyze_sample_slots(project_path: &str) {
    let project = ProjectFile::from_data_file(project_path).unwrap();

    println!("=== STATIC SLOTS ===");
    for slot_opt in project.slots.static_slots.iter() {
        if let Some(slot) = slot_opt {
            if let Some(path) = &slot.path {
                println!("\nSlot S{}", slot.slot_id);
                println!("  Path: {}", path);
                println!("  Gain: {}", slot.gain);
                println!("  Loop: {:?}", slot.loop_mode);
                println!("  Timestretch: {:?}", slot.timestrech_mode);
                println!("  Quantization: {:?}", slot.trig_quantization_mode);
            }
        }
    }

    println!("\n=== FLEX SLOTS ===");
    for slot_opt in project.slots.flex_slots.iter() {
        if let Some(slot) = slot_opt {
            if let Some(path) = &slot.path {
                println!("\nSlot F{}", slot.slot_id);
                println!("  Path: {}", path);
                println!("  Gain: {}", slot.gain);
                println!("  Loop: {:?}", slot.loop_mode);
                println!("  Timestretch: {:?}", slot.timestrech_mode);
            }
        }
    }
}
```

### Full Project Inspector

```rust
use ot_tools_io::{ProjectFile, BankFile, OctatrackFileIO};
use std::path::Path;

pub fn inspect_project(project_path: &str) {
    let path = Path::new(project_path);

    // Load project file
    let project_file = path.join("project.work");
    let project = ProjectFile::from_data_file(&project_file).unwrap();

    println!("╔══════════════════════════════════════════╗");
    println!("║       OCTATRACK PROJECT INSPECTOR        ║");
    println!("╚══════════════════════════════════════════╝");

    // Metadata
    println!("\n📋 METADATA");
    println!("  OS Version: {}", project.metadata.os_version);
    println!("  Project Version: {}", project.metadata.project_version);

    // Settings
    println!("\n⚙️  SETTINGS");
    println!("  Tempo: {} BPM", project.settings.tempo.tempo);
    let num = project.settings.control.metronome.metronome_time_signature + 1;
    let den = 2u32.pow(project.settings.control.metronome.metronome_time_signature_denominator as u32);
    println!("  Time Signature: {}/{}", num, den);
    println!("  Pattern Tempo: {}", project.settings.tempo.pattern_tempo_enabled);

    // Current State
    println!("\n🎮 CURRENT STATE");
    let bank_letters = ["A", "B", "C", "D"];
    println!("  Bank: {}", bank_letters[project.states.bank as usize]);
    println!("  Pattern: {}", project.states.pattern + 1);
    println!("  Part: {}", project.states.part + 1);
    println!("  Track: {}", project.states.track + 1);

    // Track States
    let mut muted = Vec::new();
    let mut soloed = Vec::new();
    for i in 0..8 {
        if project.states.track_mute_mask & (1 << i) != 0 {
            muted.push(i + 1);
        }
        if project.states.track_solo_mask & (1 << i) != 0 {
            soloed.push(i + 1);
        }
    }
    if !muted.is_empty() {
        println!("  Muted Tracks: {:?}", muted);
    }
    if !soloed.is_empty() {
        println!("  Soloed Tracks: {:?}", soloed);
    }

    // Mixer
    println!("\n🎚️  MIXER");
    println!("  Gain AB: {}", project.settings.mixer.gain_ab);
    println!("  Gain CD: {}", project.settings.mixer.gain_cd);
    println!("  Main Level: {}", project.settings.mixer.main_level);
    println!("  Cue Level: {}", project.settings.mixer.cue_level);

    // Sample Slots
    println!("\n💾 SAMPLE SLOTS");
    let static_used = project.slots.static_slots.iter()
        .filter(|s| s.is_some() && s.as_ref().unwrap().path.is_some())
        .count();
    let flex_used = project.slots.flex_slots.iter()
        .filter(|s| s.is_some() && s.as_ref().unwrap().path.is_some())
        .count();
    println!("  Static: {}/128 used", static_used);
    println!("  Flex: {}/128 used", flex_used);

    // MIDI
    println!("\n🎹 MIDI");
    println!("  Clock Send: {}", project.settings.control.midi.sync.midi_clock_send);
    println!("  Clock Receive: {}", project.settings.control.midi.sync.midi_clock_receive);
    println!("  Transport Send: {}", project.settings.control.midi.sync.midi_transport_send);

    // Memory
    println!("\n💿 MEMORY");
    println!("  24-bit Flex: {}", project.settings.control.memory.load_24bit_flex);
    println!("  24-bit Recording: {}", project.settings.control.memory.record_24bit);
    println!("  Dynamic Recorders: {}", project.settings.control.memory.dynamic_recorders);
    println!("  Reserved Recorders: {}", project.settings.control.memory.reserved_recorder_count);
}
```

---

## Summary

This documentation covers all available data in Octatrack project files:

- **Metadata**: OS version, file type, project version
- **Settings**:
  - Audio, input, sequencer, memory, metronome controls
  - Mixer (8 parameters)
  - Tempo and time signature
  - Comprehensive MIDI settings
- **States**: Current bank, pattern, part, track, mute/solo masks
- **Sample Slots**: 256 total slots (128 static + 128 flex) with full attributes
- **Bank Files**: Part names and pattern data

All data is accessible through the `ot-tools-io` library's `ProjectFile` and `BankFile` structs.
