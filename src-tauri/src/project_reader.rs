use ot_tools_io::{BankFile, OctatrackFileIO, ProjectFile};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub name: String,
    pub tempo: f32,
    pub swing: u8,
    pub time_signature: String,
    pub pattern_length: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pattern {
    pub id: u8,
    pub name: String,
    pub length: u16,
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

            // Extract metadata from the project file
            Ok(ProjectMetadata {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                tempo,
                swing: 50, // TODO: Find swing in project settings if available
                time_signature,
                pattern_length: 16, // TODO: Extract from current pattern if needed
            })
        }
        Err(e) => Err(format!("Failed to read project file: {:?}", e)),
    }
}

pub fn read_project_banks(project_path: &str) -> Result<Vec<Bank>, String> {
    let path = Path::new(project_path);
    let mut banks = Vec::new();

    // Bank files are named bank01.work, bank02.work, etc.
    // Octatrack has banks A-D (1-4)
    let bank_letters = ["A", "B", "C", "D"];

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
                        patterns.push(Pattern {
                            id: pattern_id,
                            name: format!("Pattern {}", pattern_id + 1),
                            length: 16, // TODO: Extract actual pattern length from bank_data.patterns
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
