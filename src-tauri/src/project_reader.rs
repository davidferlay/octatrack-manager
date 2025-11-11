use ot_tools_io::{BankFile, OctatrackFileIO, ProjectFile};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub name: String,
    pub tempo: f32,
    pub time_signature: String,
    pub pattern_length: u16,
    pub current_state: CurrentState,
    pub mixer_settings: MixerSettings,
    pub memory_settings: MemorySettings,
    pub sample_slots: SampleSlots,
    pub os_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentState {
    pub bank: u8,
    pub bank_name: String,
    pub pattern: u8,
    pub part: u8,
    pub track: u8,
    pub track_othermode: u8,
    pub midi_mode: u8,
    pub audio_muted_tracks: Vec<u8>,
    pub audio_soloed_tracks: Vec<u8>,
    pub audio_cued_tracks: Vec<u8>,
    pub midi_muted_tracks: Vec<u8>,
    pub midi_soloed_tracks: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MixerSettings {
    pub gain_ab: u8,
    pub gain_cd: u8,
    pub dir_ab: u8,
    pub dir_cd: u8,
    pub phones_mix: u8,
    pub main_level: u8,
    pub cue_level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySettings {
    pub load_24bit_flex: bool,
    pub dynamic_recorders: bool,
    pub record_24bit: bool,
    pub reserved_recorder_count: u8,
    pub reserved_recorder_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleSlots {
    pub static_slots: Vec<SampleSlot>,
    pub flex_slots: Vec<SampleSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleSlot {
    pub slot_id: u8,
    pub slot_type: String,
    pub path: String,
    pub gain: u8,
    pub loop_mode: String,
    pub timestretch_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrigCounts {
    pub trigger: u16,      // Standard trigger trigs
    pub trigless: u16,     // Trigless trigs (p-locks without triggering)
    pub plock: u16,        // Parameter lock trigs
    pub oneshot: u16,      // One-shot trigs
    pub swing: u16,        // Swing trigs
    pub slide: u16,        // Parameter slide trigs
    pub total: u16,        // Total of all trig types
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerTrackSettings {
    pub master_len: String,        // Master length in per-track mode (can be "INF")
    pub master_scale: String,      // Master scale in per-track mode
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackSettings {
    pub start_silent: bool,
    pub plays_free: bool,
    pub trig_mode: String,         // "ONE", "ONE2", "HOLD"
    pub trig_quant: String,        // Quantization setting
    pub oneshot_trk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioParameterLocks {
    pub machine: MachineParams,
    pub lfo: LfoParams,
    pub amp: AmpParams,
    pub static_slot_id: Option<u8>,
    pub flex_slot_id: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineParams {
    pub param1: Option<u8>,
    pub param2: Option<u8>,
    pub param3: Option<u8>,
    pub param4: Option<u8>,
    pub param5: Option<u8>,
    pub param6: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LfoParams {
    pub spd1: Option<u8>,
    pub spd2: Option<u8>,
    pub spd3: Option<u8>,
    pub dep1: Option<u8>,
    pub dep2: Option<u8>,
    pub dep3: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmpParams {
    pub atk: Option<u8>,
    pub hold: Option<u8>,
    pub rel: Option<u8>,
    pub vol: Option<u8>,
    pub bal: Option<u8>,
    pub f: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiParameterLocks {
    pub midi: MidiParams,
    pub lfo: LfoParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiParams {
    pub note: Option<u8>,
    pub vel: Option<u8>,
    pub len: Option<u8>,
    pub not2: Option<u8>,
    pub not3: Option<u8>,
    pub not4: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrigStep {
    pub step: u8,              // Step number (0-63)
    pub trigger: bool,         // Has trigger trig
    pub trigless: bool,        // Has trigless trig
    pub plock: bool,           // Has parameter lock
    pub oneshot: bool,         // Has oneshot trig (audio only)
    pub swing: bool,           // Has swing trig
    pub slide: bool,           // Has slide trig (audio only)
    pub recorder: bool,        // Has recorder trig (audio only)
    pub trig_condition: Option<String>, // Trig condition (Fill, NotFill, Pre, percentages, etc.)
    pub trig_repeats: u8,      // Number of trig repeats (0-7)
    pub micro_timing: Option<String>,  // Micro-timing offset (e.g., "+1/32", "-1/64")
    pub notes: Vec<u8>,        // MIDI note values (up to 4 notes for chords on MIDI tracks)
    pub velocity: Option<u8>,  // Velocity/level value (0-127)
    pub plock_count: u8,       // Number of parameter locks on this step
    pub sample_slot: Option<u8>, // Sample slot ID if locked (audio tracks)
    pub audio_plocks: Option<AudioParameterLocks>, // Audio parameter locks (audio tracks only)
    pub midi_plocks: Option<MidiParameterLocks>,   // MIDI parameter locks (MIDI tracks only)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInfo {
    pub track_id: u8,
    pub track_type: String,        // "Audio" or "MIDI"
    pub swing_amount: u8,          // 0-30 (50-80 on device)
    pub per_track_len: Option<u8>, // Track length in per-track mode
    pub per_track_scale: Option<String>, // Track scale in per-track mode
    pub pattern_settings: TrackSettings,
    pub trig_counts: TrigCounts,   // Per-track trig statistics
    pub steps: Vec<TrigStep>,      // Per-step trig information (64 steps)
    pub default_note: Option<u8>,  // Default note for MIDI tracks (0-127)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pattern {
    pub id: u8,
    pub name: String,
    pub length: u16,
    pub part_assignment: u8,       // Which part (0-3 for Parts 1-4) this pattern is assigned to
    pub scale_mode: String,        // "Normal" or "Per Track"
    pub master_scale: String,      // Playback speed multiplier (2x, 3/2x, 1x, 3/4x, 1/2x, 1/4x, 1/8x)
    pub chain_mode: String,        // "Project" or "Pattern"
    pub tempo_info: Option<String>, // Pattern tempo if set, or None if using project tempo
    pub active_tracks: u8,         // Number of tracks with at least one trigger trig
    pub trig_counts: TrigCounts,   // Detailed trig statistics
    pub per_track_settings: Option<PerTrackSettings>, // Settings for per-track mode
    pub has_swing: bool,           // Whether pattern has any swing trigs
    pub tracks: Vec<TrackInfo>,    // Per-track information
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Part {
    pub id: u8,
    pub name: String,
    pub patterns: Vec<Pattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bank {
    pub id: String,
    pub name: String,
    pub parts: Vec<Part>,
}

pub fn read_project_metadata(project_path: &str) -> Result<ProjectMetadata, String> {
    let path = Path::new(project_path);

    // Look for project.work or project.strd file
    let project_file_path = if path.join("project.work").exists() {
        path.join("project.work")
    } else if path.join("project.strd").exists() {
        path.join("project.strd")
    } else {
        return Err("No project file found".to_string());
    };

    match ProjectFile::from_data_file(&project_file_path) {
        Ok(project) => {
            // Extract tempo
            let tempo = project.settings.tempo.tempo as f32;

            // Extract time signature
            let numerator = project.settings.control.metronome.metronome_time_signature + 1;
            let denominator = 2u32.pow(project.settings.control.metronome.metronome_time_signature_denominator as u32);
            let time_signature = format!("{}/{}", numerator, denominator);

            // Extract current state
            let bank_letters = [
                "A", "B", "C", "D", "E", "F", "G", "H",
                "I", "J", "K", "L", "M", "N", "O", "P"
            ];
            let bank_name = bank_letters.get(project.states.bank as usize)
                .unwrap_or(&"A")
                .to_string();

            // Extract muted/soloed/cued audio tracks
            let mut audio_muted_tracks = Vec::new();
            let mut audio_soloed_tracks = Vec::new();
            let mut audio_cued_tracks = Vec::new();
            for i in 0..8 {
                if project.states.track_mute_mask & (1 << i) != 0 {
                    audio_muted_tracks.push(i);
                }
                if project.states.track_solo_mask & (1 << i) != 0 {
                    audio_soloed_tracks.push(i);
                }
                if project.states.track_cue_mask & (1 << i) != 0 {
                    audio_cued_tracks.push(i);
                }
            }

            // Extract muted/soloed MIDI tracks
            let mut midi_muted_tracks = Vec::new();
            let mut midi_soloed_tracks = Vec::new();
            for i in 0..8 {
                if project.states.midi_track_mute_mask & (1 << i) != 0 {
                    midi_muted_tracks.push(i);
                }
                if project.states.midi_track_solo_mask & (1 << i) != 0 {
                    midi_soloed_tracks.push(i);
                }
            }

            let current_state = CurrentState {
                bank: project.states.bank,
                bank_name,
                pattern: project.states.pattern,
                part: project.states.part,
                track: project.states.track,
                track_othermode: project.states.track_othermode,
                midi_mode: project.states.midi_mode,
                audio_muted_tracks,
                audio_soloed_tracks,
                audio_cued_tracks,
                midi_muted_tracks,
                midi_soloed_tracks,
            };

            // Extract mixer settings
            let mixer_settings = MixerSettings {
                gain_ab: project.settings.mixer.gain_ab,
                gain_cd: project.settings.mixer.gain_cd,
                dir_ab: project.settings.mixer.dir_ab,
                dir_cd: project.settings.mixer.dir_cd,
                phones_mix: project.settings.mixer.phones_mix,
                main_level: project.settings.mixer.main_level,
                cue_level: project.settings.mixer.cue_level,
            };

            // Extract memory settings
            let memory_settings = MemorySettings {
                load_24bit_flex: project.settings.control.memory.load_24bit_flex,
                dynamic_recorders: project.settings.control.memory.dynamic_recorders,
                record_24bit: project.settings.control.memory.record_24bit,
                reserved_recorder_count: project.settings.control.memory.reserved_recorder_count,
                reserved_recorder_length: project.settings.control.memory.reserved_recorder_length,
            };

            // Extract sample slots
            let mut static_slots = Vec::new();
            for slot_opt in project.slots.static_slots.iter() {
                if let Some(slot) = slot_opt {
                    if let Some(path) = &slot.path {
                        static_slots.push(SampleSlot {
                            slot_id: slot.slot_id,
                            slot_type: "Static".to_string(),
                            path: path.to_string_lossy().to_string(),
                            gain: slot.gain,
                            loop_mode: format!("{:?}", slot.loop_mode),
                            timestretch_mode: format!("{:?}", slot.timestrech_mode),
                        });
                    }
                }
            }

            let mut flex_slots = Vec::new();
            for slot_opt in project.slots.flex_slots.iter() {
                if let Some(slot) = slot_opt {
                    if let Some(path) = &slot.path {
                        flex_slots.push(SampleSlot {
                            slot_id: slot.slot_id,
                            slot_type: "Flex".to_string(),
                            path: path.to_string_lossy().to_string(),
                            gain: slot.gain,
                            loop_mode: format!("{:?}", slot.loop_mode),
                            timestretch_mode: format!("{:?}", slot.timestrech_mode),
                        });
                    }
                }
            }

            let sample_slots = SampleSlots {
                static_slots,
                flex_slots,
            };

            // Extract OS version
            let os_version = project.metadata.os_version.clone();

            // Extract current pattern length from the active bank file
            let pattern_length = {
                let current_bank = project.states.bank + 1; // Bank is 0-indexed, files are 1-indexed
                let current_pattern = project.states.pattern as usize;

                // Try to load the current bank file to get pattern length
                let bank_file_name = format!("bank{:02}.work", current_bank);
                let bank_file_path = path.join(&bank_file_name);

                // If .work doesn't exist, try .strd
                let bank_file_path = if bank_file_path.exists() {
                    bank_file_path
                } else {
                    let bank_file_name = format!("bank{:02}.strd", current_bank);
                    path.join(&bank_file_name)
                };

                // Try to read the bank file and extract pattern length
                if let Ok(bank_data) = BankFile::from_data_file(&bank_file_path) {
                    bank_data.patterns.0[current_pattern].scale.master_len as u16
                } else {
                    16 // Default to 16 if bank file can't be read
                }
            };

            // Extract metadata from the project file
            Ok(ProjectMetadata {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                tempo,
                time_signature,
                pattern_length,
                current_state,
                mixer_settings,
                memory_settings,
                sample_slots,
                os_version,
            })
        }
        Err(e) => Err(format!("Failed to read project file: {:?}", e)),
    }
}

pub fn read_project_banks(project_path: &str) -> Result<Vec<Bank>, String> {
    let path = Path::new(project_path);
    let mut banks = Vec::new();

    // Bank files are named bank01.work, bank02.work, etc.
    // Octatrack supports up to 16 banks (A-P)
    let bank_letters = [
        "A", "B", "C", "D", "E", "F", "G", "H",
        "I", "J", "K", "L", "M", "N", "O", "P"
    ];

    for (idx, bank_letter) in bank_letters.iter().enumerate() {
        let bank_num = idx + 1;
        let bank_file_name = format!("bank{:02}.work", bank_num);
        let bank_file_path = path.join(&bank_file_name);

        if !bank_file_path.exists() {
            // Try .strd extension
            let bank_file_name = format!("bank{:02}.strd", bank_num);
            let bank_file_path = path.join(&bank_file_name);
            if !bank_file_path.exists() {
                continue; // Skip missing banks
            }
        }

        match BankFile::from_data_file(&bank_file_path) {
            Ok(bank_data) => {
                // Debug print basic bank info
                eprintln!("Bank {} loaded successfully, part_names: {:?}", bank_letter, bank_data.part_names);

                let mut parts = Vec::new();

                // Each bank has 4 parts (1-4)
                for part_id in 0..4 {
                    // Extract part name from the byte array
                    let part_name_bytes = &bank_data.part_names[part_id as usize];
                    let part_name = String::from_utf8_lossy(part_name_bytes)
                        .trim_end_matches('\0')
                        .to_string();
                    let part_name = if part_name.is_empty() {
                        format!("Part {}", part_id + 1)
                    } else {
                        part_name
                    };

                    let mut patterns = Vec::new();

                    // Each part has 16 patterns (1-16)
                    for pattern_id in 0..16 {
                        // Extract actual pattern length from bank data
                        // Each pattern stores its master length in the scale settings
                        let pattern = &bank_data.patterns.0[pattern_id as usize];
                        let pattern_length = pattern.scale.master_len as u16;

                        // Extract part assignment (0-3 for Parts 1-4)
                        let part_assignment = pattern.part_assignment;

                        // Extract scale mode (0 = NORMAL, 1 = PER TRACK)
                        let scale_mode = if pattern.scale.scale_mode == 0 {
                            "Normal".to_string()
                        } else {
                            "Per Track".to_string()
                        };

                        // Extract master scale (playback speed multiplier)
                        // 0=2x, 1=3/2x, 2=1x, 3=3/4x, 4=1/2x, 5=1/4x, 6=1/8x
                        let master_scale = match pattern.scale.master_scale {
                            0 => "2x",
                            1 => "3/2x",
                            2 => "1x",
                            3 => "3/4x",
                            4 => "1/2x",
                            5 => "1/4x",
                            6 => "1/8x",
                            _ => "1x",
                        }.to_string();

                        // Extract chain mode
                        let chain_mode = if pattern.chain_behaviour.use_project_setting == 1 {
                            "Project".to_string()
                        } else {
                            "Pattern".to_string()
                        };

                        // Helper function to count set bits in trig masks
                        fn count_trigs(masks: &[u8]) -> u16 {
                            masks.iter().map(|&mask| mask.count_ones() as u16).sum()
                        }

                        // Helper function to decode trig bitmasks into a 64-element boolean array
                        // Trig masks are stored in a specific order across 8 bytes (see ot-tools-io docs)
                        fn decode_trig_masks(masks: &[u8]) -> [bool; 64] {
                            let mut steps = [false; 64];

                            // The masks are stored in this order (each byte = 8 steps):
                            // byte[0]: steps 48-55 (1st half of 4th page)
                            // byte[1]: steps 56-63 (2nd half of 4th page)
                            // byte[2]: steps 32-39 (1st half of 3rd page)
                            // byte[3]: steps 40-47 (2nd half of 3rd page)
                            // byte[4]: steps 16-23 (1st half of 2nd page)
                            // byte[5]: steps 24-31 (2nd half of 2nd page)
                            // byte[6]: steps 8-15  (2nd half of 1st page)
                            // byte[7]: steps 0-7   (1st half of 1st page)

                            let byte_to_step_offset = [48, 56, 32, 40, 16, 24, 8, 0];

                            for (byte_idx, &mask) in masks.iter().enumerate() {
                                let step_offset = byte_to_step_offset[byte_idx];
                                for bit_pos in 0..8 {
                                    if mask & (1 << bit_pos) != 0 {
                                        steps[step_offset + bit_pos] = true;
                                    }
                                }
                            }

                            steps
                        }

                        // Helper function to decode recorder trig masks (32-byte array)
                        // Only first 8 bytes are used for standard trig positions
                        fn decode_recorder_masks(masks: &[u8]) -> [bool; 64] {
                            let mut steps = [false; 64];
                            // Only use first 8 bytes, same encoding as other trig masks
                            if masks.len() >= 8 {
                                let byte_to_step_offset = [48, 56, 32, 40, 16, 24, 8, 0];
                                for (byte_idx, &mask) in masks[0..8].iter().enumerate() {
                                    let step_offset = byte_to_step_offset[byte_idx];
                                    for bit_pos in 0..8 {
                                        if mask & (1 << bit_pos) != 0 {
                                            steps[step_offset + bit_pos] = true;
                                        }
                                    }
                                }
                            }
                            steps
                        }

                        // Helper function to decode trig condition from byte value
                        fn decode_trig_condition(condition_byte: u8) -> Option<String> {
                            // Need to handle micro-timing offset in upper bit
                            let condition = condition_byte % 128;
                            match condition {
                                0 => None,
                                1 => Some("Fill".to_string()),
                                2 => Some("NotFill".to_string()),
                                3 => Some("Pre".to_string()),
                                4 => Some("NotPre".to_string()),
                                5 => Some("Nei".to_string()),
                                6 => Some("NotNei".to_string()),
                                7 => Some("1st".to_string()),
                                8 => Some("Not1st".to_string()),
                                9 => Some("1%".to_string()),
                                10 => Some("2%".to_string()),
                                11 => Some("4%".to_string()),
                                12 => Some("6%".to_string()),
                                13 => Some("9%".to_string()),
                                14 => Some("13%".to_string()),
                                15 => Some("19%".to_string()),
                                16 => Some("25%".to_string()),
                                17 => Some("33%".to_string()),
                                18 => Some("41%".to_string()),
                                19 => Some("50%".to_string()),
                                20 => Some("59%".to_string()),
                                21 => Some("67%".to_string()),
                                22 => Some("75%".to_string()),
                                23 => Some("81%".to_string()),
                                24 => Some("87%".to_string()),
                                25 => Some("91%".to_string()),
                                26 => Some("94%".to_string()),
                                27 => Some("96%".to_string()),
                                28 => Some("98%".to_string()),
                                29 => Some("99%".to_string()),
                                30 => Some("1:2".to_string()),
                                31 => Some("2:2".to_string()),
                                32 => Some("1:3".to_string()),
                                33 => Some("2:3".to_string()),
                                34 => Some("3:3".to_string()),
                                35 => Some("1:4".to_string()),
                                36 => Some("2:4".to_string()),
                                37 => Some("3:4".to_string()),
                                38 => Some("4:4".to_string()),
                                39 => Some("1:5".to_string()),
                                40 => Some("2:5".to_string()),
                                41 => Some("3:5".to_string()),
                                42 => Some("4:5".to_string()),
                                43 => Some("5:5".to_string()),
                                44 => Some("1:6".to_string()),
                                45 => Some("2:6".to_string()),
                                46 => Some("3:6".to_string()),
                                47 => Some("4:6".to_string()),
                                48 => Some("5:6".to_string()),
                                49 => Some("6:6".to_string()),
                                50 => Some("1:7".to_string()),
                                51 => Some("2:7".to_string()),
                                52 => Some("3:7".to_string()),
                                53 => Some("4:7".to_string()),
                                54 => Some("5:7".to_string()),
                                55 => Some("6:7".to_string()),
                                56 => Some("7:7".to_string()),
                                57 => Some("1:8".to_string()),
                                58 => Some("2:8".to_string()),
                                59 => Some("3:8".to_string()),
                                60 => Some("4:8".to_string()),
                                61 => Some("5:8".to_string()),
                                62 => Some("6:8".to_string()),
                                63 => Some("7:8".to_string()),
                                64 => Some("8:8".to_string()),
                                _ => None,
                            }
                        }

                        // Helper function to get trig repeat count from byte
                        fn get_trig_repeats(repeat_byte: u8) -> u8 {
                            // Trig repeats are encoded as: repeats * 32
                            // So divide by 32 to get the actual repeat count (0-7)
                            repeat_byte / 32
                        }

                        // Helper function to parse micro-timing offset (simplified)
                        fn parse_micro_timing(bytes: [u8; 2]) -> Option<String> {
                            let first = bytes[0] % 32;  // Remove trig repeat component
                            let second_offset = bytes[1] >= 128;

                            // Simple micro-timing detection
                            if first == 0 && !second_offset {
                                return None; // No offset
                            }

                            // Map common offset values (simplified)
                            match (first, second_offset) {
                                (0, false) => None,
                                (1, true) => Some("+1/128".to_string()),
                                (3, false) => Some("+1/64".to_string()),
                                (6, false) => Some("+1/32".to_string()),
                                (11, true) => Some("+23/384".to_string()),
                                (20, true) => Some("-23/384".to_string()),
                                (26, false) => Some("-1/32".to_string()),
                                (29, false) => Some("-1/64".to_string()),
                                (30, true) => Some("-1/128".to_string()),
                                _ => Some(format!("{}{}",if first < 15 {"+"} else {"-"}, "μ")),
                            }
                        }

                        // Helper function to count non-default parameter locks
                        fn count_audio_plocks(plock: &ot_tools_io::patterns::AudioTrackParameterLocks) -> u8 {
                            let mut count = 0;
                            if plock.machine.param1 != 255 { count += 1; }
                            if plock.machine.param2 != 255 { count += 1; }
                            if plock.machine.param3 != 255 { count += 1; }
                            if plock.machine.param4 != 255 { count += 1; }
                            if plock.machine.param5 != 255 { count += 1; }
                            if plock.machine.param6 != 255 { count += 1; }
                            if plock.lfo.spd1 != 255 { count += 1; }
                            if plock.lfo.spd2 != 255 { count += 1; }
                            if plock.lfo.spd3 != 255 { count += 1; }
                            if plock.lfo.dep1 != 255 { count += 1; }
                            if plock.lfo.dep2 != 255 { count += 1; }
                            if plock.lfo.dep3 != 255 { count += 1; }
                            if plock.amp.atk != 255 { count += 1; }
                            if plock.amp.hold != 255 { count += 1; }
                            if plock.amp.rel != 255 { count += 1; }
                            if plock.amp.vol != 255 { count += 1; }
                            if plock.amp.bal != 255 { count += 1; }
                            if plock.amp.f != 255 { count += 1; }
                            if plock.static_slot_id != 255 { count += 1; }
                            if plock.flex_slot_id != 255 { count += 1; }
                            count
                        }

                        fn count_midi_plocks(plock: &ot_tools_io::patterns::MidiTrackParameterLocks) -> u8 {
                            let mut count = 0;
                            if plock.midi.note != 255 { count += 1; }
                            if plock.midi.vel != 255 { count += 1; }
                            if plock.midi.len != 255 { count += 1; }
                            if plock.midi.not2 != 255 { count += 1; }
                            if plock.midi.not3 != 255 { count += 1; }
                            if plock.midi.not4 != 255 { count += 1; }
                            if plock.lfo.spd1 != 255 { count += 1; }
                            if plock.lfo.spd2 != 255 { count += 1; }
                            if plock.lfo.spd3 != 255 { count += 1; }
                            if plock.lfo.dep1 != 255 { count += 1; }
                            if plock.lfo.dep2 != 255 { count += 1; }
                            if plock.lfo.dep3 != 255 { count += 1; }
                            count
                        }

                        // Count all trig types across all tracks
                        let mut trigger_count = 0u16;
                        let mut trigless_count = 0u16;
                        let mut plock_count = 0u16;
                        let mut oneshot_count = 0u16;
                        let mut swing_count = 0u16;
                        let mut slide_count = 0u16;
                        let mut active_tracks = 0u8;

                        // Process audio tracks
                        for audio_track in &pattern.audio_track_trigs.0 {
                            trigger_count += count_trigs(&audio_track.trig_masks.trigger);
                            trigless_count += count_trigs(&audio_track.trig_masks.trigless);
                            plock_count += count_trigs(&audio_track.trig_masks.plock);
                            oneshot_count += count_trigs(&audio_track.trig_masks.oneshot);
                            swing_count += count_trigs(&audio_track.trig_masks.swing);
                            slide_count += count_trigs(&audio_track.trig_masks.slide);

                            if audio_track.trig_masks.trigger.iter().any(|&mask| mask != 0) {
                                active_tracks += 1;
                            }
                        }

                        // Process MIDI tracks
                        for midi_track in &pattern.midi_track_trigs.0 {
                            trigger_count += count_trigs(&midi_track.trig_masks.trigger);
                            trigless_count += count_trigs(&midi_track.trig_masks.trigless);
                            plock_count += count_trigs(&midi_track.trig_masks.plock);
                            swing_count += count_trigs(&midi_track.trig_masks.swing);

                            if midi_track.trig_masks.trigger.iter().any(|&mask| mask != 0) {
                                active_tracks += 1;
                            }
                        }

                        let total_trigs = trigger_count + trigless_count + plock_count + oneshot_count + swing_count + slide_count;
                        let has_swing = swing_count > 0;

                        let trig_counts = TrigCounts {
                            trigger: trigger_count,
                            trigless: trigless_count,
                            plock: plock_count,
                            oneshot: oneshot_count,
                            swing: swing_count,
                            slide: slide_count,
                            total: total_trigs,
                        };

                        // Extract per-track mode settings if in per-track mode
                        let per_track_settings = if pattern.scale.scale_mode == 1 {
                            // Calculate master length in per-track mode
                            let master_len = if pattern.scale.master_len_per_track == 255
                                && pattern.scale.master_len_per_track_multiplier == 255 {
                                "INF".to_string()
                            } else {
                                let len = (pattern.scale.master_len_per_track as u16 + 1)
                                    * (pattern.scale.master_len_per_track_multiplier as u16 + 1);
                                format!("{}", len)
                            };

                            let master_scale_pt = match pattern.scale.master_scale_per_track {
                                0 => "2x",
                                1 => "3/2x",
                                2 => "1x",
                                3 => "3/4x",
                                4 => "1/2x",
                                5 => "1/4x",
                                6 => "1/8x",
                                _ => "1x",
                            }.to_string();

                            Some(PerTrackSettings {
                                master_len,
                                master_scale: master_scale_pt,
                            })
                        } else {
                            None
                        };

                        // Calculate BPM from tempo bytes
                        // Formula: BPM = (tempo_1 + 1) * 10
                        // Default values are tempo_1: 11, tempo_2: 64 (= 120 BPM)
                        let bpm = (pattern.tempo_1 as u32 + 1) * 10;
                        let tempo_info = if pattern.tempo_1 != 11 || pattern.tempo_2 != 64 {
                            // Pattern has custom tempo
                            Some(format!("{} BPM", bpm))
                        } else {
                            None
                        };

                        // Extract per-track information
                        let mut tracks = Vec::new();

                        // Process audio tracks (0-7)
                        for (idx, audio_track) in pattern.audio_track_trigs.0.iter().enumerate() {
                            let track_trigger_count = count_trigs(&audio_track.trig_masks.trigger);
                            let track_trigless_count = count_trigs(&audio_track.trig_masks.trigless);
                            let track_plock_count = count_trigs(&audio_track.trig_masks.plock);
                            let track_oneshot_count = count_trigs(&audio_track.trig_masks.oneshot);
                            let track_swing_count = count_trigs(&audio_track.trig_masks.swing);
                            let track_slide_count = count_trigs(&audio_track.trig_masks.slide);

                            let trig_mode = match audio_track.pattern_settings.trig_mode {
                                0 => "ONE",
                                1 => "ONE2",
                                2 => "HOLD",
                                _ => "ONE",
                            }.to_string();

                            let trig_quant = match audio_track.pattern_settings.trig_quant {
                                0 => "TR.LEN",
                                1 => "1/16",
                                2 => "2/16",
                                3 => "3/16",
                                4 => "4/16",
                                5 => "6/16",
                                6 => "8/16",
                                7 => "12/16",
                                8 => "16/16",
                                9 => "24/16",
                                10 => "32/16",
                                11 => "48/16",
                                12 => "64/16",
                                13 => "96/16",
                                14 => "128/16",
                                15 => "192/16",
                                16 => "256/16",
                                255 => "DIRECT",
                                _ => "TR.LEN",
                            }.to_string();

                            let (per_track_len, per_track_scale) = if pattern.scale.scale_mode == 1 {
                                (
                                    Some(audio_track.scale_per_track_mode.per_track_len),
                                    Some(match audio_track.scale_per_track_mode.per_track_scale {
                                        0 => "2x",
                                        1 => "3/2x",
                                        2 => "1x",
                                        3 => "3/4x",
                                        4 => "1/2x",
                                        5 => "1/4x",
                                        6 => "1/8x",
                                        _ => "1x",
                                    }.to_string())
                                )
                            } else {
                                (None, None)
                            };

                            // Decode trig masks to get per-step information
                            let trigger_steps = decode_trig_masks(&audio_track.trig_masks.trigger);
                            let trigless_steps = decode_trig_masks(&audio_track.trig_masks.trigless);
                            let plock_steps = decode_trig_masks(&audio_track.trig_masks.plock);
                            let oneshot_steps = decode_trig_masks(&audio_track.trig_masks.oneshot);
                            let swing_steps = decode_trig_masks(&audio_track.trig_masks.swing);
                            let slide_steps = decode_trig_masks(&audio_track.trig_masks.slide);
                            let recorder_steps = decode_recorder_masks(&audio_track.trig_masks.recorder);

                            let mut steps = Vec::new();
                            for step in 0..64 {
                                let offset_repeat_cond = audio_track.trig_offsets_repeats_conditions[step];
                                let trig_repeats = get_trig_repeats(offset_repeat_cond[0]);
                                let trig_condition = decode_trig_condition(offset_repeat_cond[1]);
                                let micro_timing = parse_micro_timing(offset_repeat_cond);

                                let plock = &audio_track.plocks.0[step];
                                let plock_count = count_audio_plocks(plock);

                                // Get sample slot if locked
                                let sample_slot = if plock.static_slot_id != 255 {
                                    Some(plock.static_slot_id)
                                } else if plock.flex_slot_id != 255 {
                                    Some(plock.flex_slot_id)
                                } else {
                                    None
                                };

                                // Get velocity from amp parameter lock
                                let velocity = if plock.amp.vol != 255 {
                                    Some(plock.amp.vol)
                                } else {
                                    None
                                };

                                // Extract all audio parameter locks if this step has any
                                let audio_plocks = if plock_count > 0 {
                                    Some(AudioParameterLocks {
                                        machine: MachineParams {
                                            param1: if plock.machine.param1 != 255 { Some(plock.machine.param1) } else { None },
                                            param2: if plock.machine.param2 != 255 { Some(plock.machine.param2) } else { None },
                                            param3: if plock.machine.param3 != 255 { Some(plock.machine.param3) } else { None },
                                            param4: if plock.machine.param4 != 255 { Some(plock.machine.param4) } else { None },
                                            param5: if plock.machine.param5 != 255 { Some(plock.machine.param5) } else { None },
                                            param6: if plock.machine.param6 != 255 { Some(plock.machine.param6) } else { None },
                                        },
                                        lfo: LfoParams {
                                            spd1: if plock.lfo.spd1 != 255 { Some(plock.lfo.spd1) } else { None },
                                            spd2: if plock.lfo.spd2 != 255 { Some(plock.lfo.spd2) } else { None },
                                            spd3: if plock.lfo.spd3 != 255 { Some(plock.lfo.spd3) } else { None },
                                            dep1: if plock.lfo.dep1 != 255 { Some(plock.lfo.dep1) } else { None },
                                            dep2: if plock.lfo.dep2 != 255 { Some(plock.lfo.dep2) } else { None },
                                            dep3: if plock.lfo.dep3 != 255 { Some(plock.lfo.dep3) } else { None },
                                        },
                                        amp: AmpParams {
                                            atk: if plock.amp.atk != 255 { Some(plock.amp.atk) } else { None },
                                            hold: if plock.amp.hold != 255 { Some(plock.amp.hold) } else { None },
                                            rel: if plock.amp.rel != 255 { Some(plock.amp.rel) } else { None },
                                            vol: if plock.amp.vol != 255 { Some(plock.amp.vol) } else { None },
                                            bal: if plock.amp.bal != 255 { Some(plock.amp.bal) } else { None },
                                            f: if plock.amp.f != 255 { Some(plock.amp.f) } else { None },
                                        },
                                        static_slot_id: if plock.static_slot_id != 255 { Some(plock.static_slot_id) } else { None },
                                        flex_slot_id: if plock.flex_slot_id != 255 { Some(plock.flex_slot_id) } else { None },
                                    })
                                } else {
                                    None
                                };

                                steps.push(TrigStep {
                                    step: step as u8,
                                    trigger: trigger_steps[step],
                                    trigless: trigless_steps[step],
                                    plock: plock_steps[step],
                                    oneshot: oneshot_steps[step],
                                    swing: swing_steps[step],
                                    slide: slide_steps[step],
                                    recorder: recorder_steps[step],
                                    trig_condition,
                                    trig_repeats,
                                    micro_timing,
                                    notes: Vec::new(),  // No notes for audio tracks
                                    velocity,
                                    plock_count,
                                    sample_slot,
                                    audio_plocks,
                                    midi_plocks: None,  // No MIDI plocks for audio tracks
                                });
                            }

                            tracks.push(TrackInfo {
                                track_id: idx as u8,
                                track_type: "Audio".to_string(),
                                swing_amount: audio_track.swing_amount,
                                per_track_len,
                                per_track_scale,
                                pattern_settings: TrackSettings {
                                    start_silent: audio_track.pattern_settings.start_silent != 255,
                                    plays_free: audio_track.pattern_settings.plays_free != 0,
                                    trig_mode,
                                    trig_quant,
                                    oneshot_trk: audio_track.pattern_settings.oneshot_trk != 0,
                                },
                                trig_counts: TrigCounts {
                                    trigger: track_trigger_count,
                                    trigless: track_trigless_count,
                                    plock: track_plock_count,
                                    oneshot: track_oneshot_count,
                                    swing: track_swing_count,
                                    slide: track_slide_count,
                                    total: track_trigger_count + track_trigless_count + track_plock_count + track_oneshot_count + track_swing_count + track_slide_count,
                                },
                                steps,
                                default_note: None,  // Audio tracks don't have default notes
                            });
                        }

                        // Process MIDI tracks (8-15)
                        for (idx, midi_track) in pattern.midi_track_trigs.0.iter().enumerate() {
                            // Get default note from BankFile's Part data for this MIDI track
                            let track_default_note = bank_data.parts.unsaved[part_id as usize].midi_track_params_values[idx].midi.note;

                            let track_trigger_count = count_trigs(&midi_track.trig_masks.trigger);
                            let track_trigless_count = count_trigs(&midi_track.trig_masks.trigless);
                            let track_plock_count = count_trigs(&midi_track.trig_masks.plock);
                            let track_swing_count = count_trigs(&midi_track.trig_masks.swing);

                            let trig_mode = match midi_track.pattern_settings.trig_mode {
                                0 => "ONE",
                                1 => "ONE2",
                                2 => "HOLD",
                                _ => "ONE",
                            }.to_string();

                            let trig_quant = match midi_track.pattern_settings.trig_quant {
                                0 => "TR.LEN",
                                1 => "1/16",
                                2 => "2/16",
                                3 => "3/16",
                                4 => "4/16",
                                5 => "6/16",
                                6 => "8/16",
                                7 => "12/16",
                                8 => "16/16",
                                9 => "24/16",
                                10 => "32/16",
                                11 => "48/16",
                                12 => "64/16",
                                13 => "96/16",
                                14 => "128/16",
                                15 => "192/16",
                                16 => "256/16",
                                255 => "DIRECT",
                                _ => "TR.LEN",
                            }.to_string();

                            let (per_track_len, per_track_scale) = if pattern.scale.scale_mode == 1 {
                                (
                                    Some(midi_track.scale_per_track_mode.per_track_len),
                                    Some(match midi_track.scale_per_track_mode.per_track_scale {
                                        0 => "2x",
                                        1 => "3/2x",
                                        2 => "1x",
                                        3 => "3/4x",
                                        4 => "1/2x",
                                        5 => "1/4x",
                                        6 => "1/8x",
                                        _ => "1x",
                                    }.to_string())
                                )
                            } else {
                                (None, None)
                            };

                            // Decode trig masks to get per-step information
                            let trigger_steps = decode_trig_masks(&midi_track.trig_masks.trigger);
                            let trigless_steps = decode_trig_masks(&midi_track.trig_masks.trigless);
                            let plock_steps = decode_trig_masks(&midi_track.trig_masks.plock);
                            let swing_steps = decode_trig_masks(&midi_track.trig_masks.swing);

                            let mut steps = Vec::new();
                            for step in 0..64 {
                                let offset_repeat_cond = midi_track.trig_offsets_repeats_conditions[step];
                                let trig_repeats = get_trig_repeats(offset_repeat_cond[0]);
                                let trig_condition = decode_trig_condition(offset_repeat_cond[1]);
                                let micro_timing = parse_micro_timing(offset_repeat_cond);

                                let plock = &midi_track.plocks[step];
                                let plock_count = count_midi_plocks(plock);

                                // Get all MIDI notes (up to 4 for chords) from parameter locks
                                // NOT2, NOT3, NOT4 are stored as OFFSETS from the base note
                                let mut notes = Vec::new();

                                // Determine the base note: use parameter-locked NOTE if present, otherwise use track default
                                let base_note = if plock.midi.note != 255 {
                                    plock.midi.note
                                } else {
                                    track_default_note
                                };

                                // Debug logging
                                if plock_count > 0 {
                                    eprintln!("DEBUG: Step {} - base_note={}, not2={}, not3={}, not4={}",
                                        step, base_note, plock.midi.not2, plock.midi.not3, plock.midi.not4);
                                }

                                // Add NOTE1 if it's parameter-locked
                                if plock.midi.note != 255 {
                                    notes.push(plock.midi.note);
                                }

                                // Add NOT2, NOT3, NOT4 as offsets from the base note
                                // Octatrack stores offsets with 64 as center: stored_value = 64 + offset
                                // So to get the actual note: note = base_note + (stored_value - 64)
                                if plock.midi.not2 != 255 {
                                    let offset = (plock.midi.not2 as i16) - 64;
                                    let note2 = ((base_note as i16) + offset).clamp(0, 127) as u8;
                                    eprintln!("DEBUG: NOT2 calculation: {} + ({} - 64) = {} + {} = {}", base_note, plock.midi.not2, base_note, offset, note2);
                                    notes.push(note2);
                                }
                                if plock.midi.not3 != 255 {
                                    let offset = (plock.midi.not3 as i16) - 64;
                                    let note3 = ((base_note as i16) + offset).clamp(0, 127) as u8;
                                    eprintln!("DEBUG: NOT3 calculation: {} + ({} - 64) = {} + {} = {}", base_note, plock.midi.not3, base_note, offset, note3);
                                    notes.push(note3);
                                }
                                if plock.midi.not4 != 255 {
                                    let offset = (plock.midi.not4 as i16) - 64;
                                    let note4 = ((base_note as i16) + offset).clamp(0, 127) as u8;
                                    eprintln!("DEBUG: NOT4 calculation: {} + ({} - 64) = {} + {} = {}", base_note, plock.midi.not4, base_note, offset, note4);
                                    notes.push(note4);
                                }

                                let velocity = if plock.midi.vel != 255 {
                                    Some(plock.midi.vel)
                                } else {
                                    None
                                };

                                // Extract all MIDI parameter locks if this step has any
                                let midi_plocks = if plock_count > 0 {
                                    Some(MidiParameterLocks {
                                        midi: MidiParams {
                                            note: if plock.midi.note != 255 { Some(plock.midi.note) } else { None },
                                            vel: if plock.midi.vel != 255 { Some(plock.midi.vel) } else { None },
                                            len: if plock.midi.len != 255 { Some(plock.midi.len) } else { None },
                                            not2: if plock.midi.not2 != 255 { Some(plock.midi.not2) } else { None },
                                            not3: if plock.midi.not3 != 255 { Some(plock.midi.not3) } else { None },
                                            not4: if plock.midi.not4 != 255 { Some(plock.midi.not4) } else { None },
                                        },
                                        lfo: LfoParams {
                                            spd1: if plock.lfo.spd1 != 255 { Some(plock.lfo.spd1) } else { None },
                                            spd2: if plock.lfo.spd2 != 255 { Some(plock.lfo.spd2) } else { None },
                                            spd3: if plock.lfo.spd3 != 255 { Some(plock.lfo.spd3) } else { None },
                                            dep1: if plock.lfo.dep1 != 255 { Some(plock.lfo.dep1) } else { None },
                                            dep2: if plock.lfo.dep2 != 255 { Some(plock.lfo.dep2) } else { None },
                                            dep3: if plock.lfo.dep3 != 255 { Some(plock.lfo.dep3) } else { None },
                                        },
                                    })
                                } else {
                                    None
                                };

                                steps.push(TrigStep {
                                    step: step as u8,
                                    trigger: trigger_steps[step],
                                    trigless: trigless_steps[step],
                                    plock: plock_steps[step],
                                    oneshot: false,  // MIDI tracks don't have oneshot trigs
                                    swing: swing_steps[step],
                                    slide: false,     // MIDI tracks don't have slide trigs
                                    recorder: false,  // MIDI tracks don't have recorder trigs
                                    trig_condition,
                                    trig_repeats,
                                    micro_timing,
                                    notes,
                                    velocity,
                                    plock_count,
                                    sample_slot: None, // MIDI tracks don't have sample slots
                                    audio_plocks: None, // No audio plocks for MIDI tracks
                                    midi_plocks,
                                });
                            }

                            // Extract default note from BankFile's Part data for this MIDI track
                            let default_note = {
                                let midi_track_idx = idx; // idx is already 0-7 for MIDI tracks
                                Some(bank_data.parts.unsaved[part_id as usize].midi_track_params_values[midi_track_idx].midi.note)
                            };

                            tracks.push(TrackInfo {
                                track_id: (idx + 8) as u8,
                                track_type: "MIDI".to_string(),
                                swing_amount: midi_track.swing_amount,
                                per_track_len,
                                per_track_scale,
                                pattern_settings: TrackSettings {
                                    start_silent: midi_track.pattern_settings.start_silent != 255,
                                    plays_free: midi_track.pattern_settings.plays_free != 0,
                                    trig_mode,
                                    trig_quant,
                                    oneshot_trk: midi_track.pattern_settings.oneshot_trk != 0,
                                },
                                trig_counts: TrigCounts {
                                    trigger: track_trigger_count,
                                    trigless: track_trigless_count,
                                    plock: track_plock_count,
                                    oneshot: 0,  // MIDI tracks don't have oneshot trigs
                                    swing: track_swing_count,
                                    slide: 0,    // MIDI tracks don't have slide trigs
                                    total: track_trigger_count + track_trigless_count + track_plock_count + track_swing_count,
                                },
                                steps,
                                default_note,  // Default NOTE value from Part file
                            });
                        }

                        patterns.push(Pattern {
                            id: pattern_id,
                            name: format!("Pattern {}", pattern_id + 1),
                            length: pattern_length,
                            part_assignment,
                            scale_mode,
                            master_scale,
                            chain_mode,
                            tempo_info,
                            active_tracks,
                            trig_counts,
                            per_track_settings,
                            has_swing,
                            tracks,
                        });
                    }

                    parts.push(Part {
                        id: part_id,
                        name: part_name,
                        patterns,
                    });
                }

                banks.push(Bank {
                    id: bank_letter.to_string(),
                    name: format!("Bank {}", bank_letter),
                    parts,
                });
            }
            Err(e) => {
                eprintln!("Warning: Failed to read bank {}: {:?}", bank_letter, e);
                // Continue with other banks
            }
        }
    }

    Ok(banks)
}
