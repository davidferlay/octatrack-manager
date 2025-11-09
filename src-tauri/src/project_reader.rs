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
    pub muted_tracks: Vec<u8>,
    pub soloed_tracks: Vec<u8>,
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
pub struct TrigStep {
    pub step: u8,              // Step number (0-63)
    pub trigger: bool,         // Has trigger trig
    pub trigless: bool,        // Has trigless trig
    pub plock: bool,           // Has parameter lock
    pub oneshot: bool,         // Has oneshot trig (audio only)
    pub swing: bool,           // Has swing trig
    pub slide: bool,           // Has slide trig (audio only)
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

            // Extract muted/soloed tracks
            let mut muted_tracks = Vec::new();
            let mut soloed_tracks = Vec::new();
            for i in 0..8 {
                if project.states.track_mute_mask & (1 << i) != 0 {
                    muted_tracks.push(i);
                }
                if project.states.track_solo_mask & (1 << i) != 0 {
                    soloed_tracks.push(i);
                }
            }

            let current_state = CurrentState {
                bank: project.states.bank,
                bank_name,
                pattern: project.states.pattern,
                part: project.states.part,
                track: project.states.track,
                muted_tracks,
                soloed_tracks,
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

                        let total_trigs = trigger_count + trigless_count + plock_count + oneshot_count;
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

                            let mut steps = Vec::new();
                            for step in 0..64 {
                                steps.push(TrigStep {
                                    step: step as u8,
                                    trigger: trigger_steps[step],
                                    trigless: trigless_steps[step],
                                    plock: plock_steps[step],
                                    oneshot: oneshot_steps[step],
                                    swing: swing_steps[step],
                                    slide: slide_steps[step],
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
                                    total: track_trigger_count + track_trigless_count + track_plock_count + track_oneshot_count,
                                },
                                steps,
                            });
                        }

                        // Process MIDI tracks (8-15)
                        for (idx, midi_track) in pattern.midi_track_trigs.0.iter().enumerate() {
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
                                steps.push(TrigStep {
                                    step: step as u8,
                                    trigger: trigger_steps[step],
                                    trigless: trigless_steps[step],
                                    plock: plock_steps[step],
                                    oneshot: false,  // MIDI tracks don't have oneshot trigs
                                    swing: swing_steps[step],
                                    slide: false,     // MIDI tracks don't have slide trigs
                                });
                            }

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
                                    total: track_trigger_count + track_trigless_count + track_plock_count,
                                },
                                steps,
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
