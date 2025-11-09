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
pub struct Pattern {
    pub id: u8,
    pub name: String,
    pub length: u16,
    pub part_assignment: u8,  // Which part (0-3 for Parts 1-4) this pattern is assigned to
    pub scale_mode: String,   // "Normal" or "Per Track"
    pub tempo_info: Option<String>,  // Pattern tempo if set, or None if using project tempo
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

                        patterns.push(Pattern {
                            id: pattern_id,
                            name: format!("Pattern {}", pattern_id + 1),
                            length: pattern_length,
                            part_assignment,
                            scale_mode,
                            tempo_info: None,  // Will add tempo calculation later if needed
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
