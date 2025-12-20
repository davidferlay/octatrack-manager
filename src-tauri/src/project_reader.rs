use ot_tools_io::{BankFile, HasChecksumField, OctatrackFileIO, ProjectFile};
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
    pub midi_settings: MidiSettings,
    pub metronome_settings: MetronomeSettings,
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
pub struct MidiSettings {
    // MIDI Channels
    pub trig_channels: Vec<i8>,     // 8 MIDI track channels (1-16 or -1 for disabled)
    pub auto_channel: i8,           // Auto channel (1-16 or -1 for disabled)
    // MIDI Sync
    pub clock_send: bool,
    pub clock_receive: bool,
    pub transport_send: bool,
    pub transport_receive: bool,
    // Program Change
    pub prog_change_send: bool,
    pub prog_change_send_channel: i8,  // 1-16 or -1 for disabled
    pub prog_change_receive: bool,
    pub prog_change_receive_channel: i8, // 1-16 or -1 for disabled
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetronomeSettings {
    pub enabled: bool,
    pub main_volume: u8,
    pub cue_volume: u8,
    pub pitch: u8,
    pub tonal: bool,
    pub preroll: u8,
    pub time_signature_numerator: u8,
    pub time_signature_denominator: u8,
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
    pub path: Option<String>,
    pub gain: Option<u8>,
    pub loop_mode: Option<String>,
    pub timestretch_mode: Option<String>,
    pub source_location: Option<String>,
    pub file_exists: bool,
    pub compatibility: Option<String>, // "compatible", "wrong_rate", "incompatible", "unknown"
    pub file_format: Option<String>,   // "WAV", "AIFF", etc.
    pub bit_depth: Option<u32>,        // 16, 24, etc.
    pub sample_rate: Option<u32>,      // 44100, 48000, etc.
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

// Parts machine parameter structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackMachine {
    pub track_id: u8,              // 0-7 for audio tracks T1-T8
    pub machine_type: String,      // "Static", "Flex", "Thru", "Neighbor", "Pickup"
    pub machine_params: MachineParamValues,
    pub machine_setup: MachineSetupValues,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineParamValues {
    // FLEX/STATIC parameters
    pub ptch: Option<u8>,
    pub strt: Option<u8>,
    pub len: Option<u8>,
    pub rate: Option<u8>,
    pub rtrg: Option<u8>,
    pub rtim: Option<u8>,
    // THRU parameters
    pub in_ab: Option<u8>,
    pub vol_ab: Option<u8>,
    pub in_cd: Option<u8>,
    pub vol_cd: Option<u8>,
    // PICKUP parameters (ptch and len are shared with FLEX/STATIC above)
    pub dir: Option<u8>,
    pub gain: Option<u8>,
    pub op: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineSetupValues {
    // FLEX/STATIC setup parameters
    pub xloop: Option<u8>,
    pub slic: Option<u8>,
    pub len: Option<u8>,
    pub rate: Option<u8>,
    pub tstr: Option<u8>,
    pub tsns: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackAmp {
    pub track_id: u8,              // 0-7 for audio tracks T1-T8
    pub atk: u8,
    pub hold: u8,
    pub rel: u8,
    pub vol: u8,
    pub bal: u8,
    pub f: u8,
    // AMP SETUP parameters
    pub amp_setup_amp: u8,         // Envelope type
    pub amp_setup_sync: u8,        // Sync setting
    pub amp_setup_atck: u8,        // Attack curve
    pub amp_setup_fx1: u8,         // FX1 routing
    pub amp_setup_fx2: u8,         // FX2 routing
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackLfo {
    pub track_id: u8,              // 0-7 for audio tracks T1-T8
    // MAIN LFO parameters
    pub spd1: u8,                  // Speed of LFO 1
    pub spd2: u8,                  // Speed of LFO 2
    pub spd3: u8,                  // Speed of LFO 3
    pub dep1: u8,                  // Depth of LFO 1
    pub dep2: u8,                  // Depth of LFO 2
    pub dep3: u8,                  // Depth of LFO 3
    // SETUP LFO parameters (Setup 1: Parameter Target & Wave)
    pub lfo1_pmtr: u8,             // LFO 1 Parameter Target
    pub lfo2_pmtr: u8,             // LFO 2 Parameter Target
    pub lfo3_pmtr: u8,             // LFO 3 Parameter Target
    pub lfo1_wave: u8,             // LFO 1 Waveform
    pub lfo2_wave: u8,             // LFO 2 Waveform
    pub lfo3_wave: u8,             // LFO 3 Waveform
    // SETUP LFO parameters (Setup 2: Multiplier & Trigger)
    pub lfo1_mult: u8,             // LFO 1 Speed Multiplier
    pub lfo2_mult: u8,             // LFO 2 Speed Multiplier
    pub lfo3_mult: u8,             // LFO 3 Speed Multiplier
    pub lfo1_trig: u8,             // LFO 1 Trigger Mode
    pub lfo2_trig: u8,             // LFO 2 Trigger Mode
    pub lfo3_trig: u8,             // LFO 3 Trigger Mode
    // CUSTOM LFO Design (16-step waveform)
    pub custom_lfo_design: Vec<u8>, // 16 values (0-255) representing custom waveform shape
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackFx {
    pub track_id: u8,              // 0-7 for audio tracks T1-T8
    pub fx1_type: u8,              // FX1 effect type (0-24+)
    pub fx2_type: u8,              // FX2 effect type (0-24+)
    // FX1 main parameters (6 params)
    pub fx1_param1: u8,
    pub fx1_param2: u8,
    pub fx1_param3: u8,
    pub fx1_param4: u8,
    pub fx1_param5: u8,
    pub fx1_param6: u8,
    // FX2 main parameters (6 params)
    pub fx2_param1: u8,
    pub fx2_param2: u8,
    pub fx2_param3: u8,
    pub fx2_param4: u8,
    pub fx2_param5: u8,
    pub fx2_param6: u8,
    // FX1 setup parameters (6 params)
    pub fx1_setup1: u8,
    pub fx1_setup2: u8,
    pub fx1_setup3: u8,
    pub fx1_setup4: u8,
    pub fx1_setup5: u8,
    pub fx1_setup6: u8,
    // FX2 setup parameters (6 params)
    pub fx2_setup1: u8,
    pub fx2_setup2: u8,
    pub fx2_setup3: u8,
    pub fx2_setup4: u8,
    pub fx2_setup5: u8,
    pub fx2_setup6: u8,
}

// MIDI track parameter structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackMidiNote {
    pub track_id: u8,              // 0-7 for MIDI tracks M1-M8
    // NOTE MAIN parameters
    pub note: u8,
    pub vel: u8,
    pub len: u8,
    pub not2: u8,
    pub not3: u8,
    pub not4: u8,
    // NOTE SETUP parameters
    pub chan: u8,                  // MIDI channel
    pub bank: u8,                  // Bank select
    pub prog: u8,                  // Program change
    pub sbnk: u8,                  // Sub bank
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackMidiArp {
    pub track_id: u8,              // 0-7 for MIDI tracks M1-M8
    // ARP MAIN parameters
    pub tran: u8,                  // Transpose
    pub leg: u8,                   // Legato
    pub mode: u8,                  // Arpeggiator mode
    pub spd: u8,                   // Speed
    pub rnge: u8,                  // Range
    pub nlen: u8,                  // Note length
    // ARP SETUP parameters
    pub len: u8,                   // Arp sequence length
    pub key: u8,                   // Scale/key setting
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackMidiCtrl1 {
    pub track_id: u8,              // 0-7 for MIDI tracks M1-M8
    // CTRL1 MAIN parameters
    pub pb: u8,                    // Pitch bend
    pub at: u8,                    // Aftertouch
    pub cc1: u8,                   // CC1 value
    pub cc2: u8,                   // CC2 value
    pub cc3: u8,                   // CC3 value
    pub cc4: u8,                   // CC4 value
    // CTRL1 SETUP parameters (CC numbers, not values)
    pub cc1_num: u8,               // CC1 number
    pub cc2_num: u8,               // CC2 number
    pub cc3_num: u8,               // CC3 number
    pub cc4_num: u8,               // CC4 number
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartTrackMidiCtrl2 {
    pub track_id: u8,              // 0-7 for MIDI tracks M1-M8
    // CTRL2 MAIN parameters
    pub cc5: u8,                   // CC5 value
    pub cc6: u8,                   // CC6 value
    pub cc7: u8,                   // CC7 value
    pub cc8: u8,                   // CC8 value
    pub cc9: u8,                   // CC9 value
    pub cc10: u8,                  // CC10 value
    // CTRL2 SETUP parameters (CC numbers, not values)
    pub cc5_num: u8,               // CC5 number
    pub cc6_num: u8,               // CC6 number
    pub cc7_num: u8,               // CC7 number
    pub cc8_num: u8,               // CC8 number
    pub cc9_num: u8,               // CC9 number
    pub cc10_num: u8,              // CC10 number
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartData {
    pub part_id: u8,               // 0-3 for Parts 1-4
    pub machines: Vec<PartTrackMachine>,  // 8 audio tracks
    pub amps: Vec<PartTrackAmp>,          // 8 audio tracks
    pub lfos: Vec<PartTrackLfo>,          // 8 audio tracks (also used for MIDI LFOs)
    pub fxs: Vec<PartTrackFx>,            // 8 audio tracks
    pub midi_notes: Vec<PartTrackMidiNote>,  // 8 MIDI tracks
    pub midi_arps: Vec<PartTrackMidiArp>,    // 8 MIDI tracks
    pub midi_lfos: Vec<PartTrackLfo>,        // 8 MIDI tracks (reuses audio LFO structure)
    pub midi_ctrl1s: Vec<PartTrackMidiCtrl1>, // 8 MIDI tracks
    pub midi_ctrl2s: Vec<PartTrackMidiCtrl2>, // 8 MIDI tracks
}

/// Response from read_parts_data that includes bank-level state flags
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartsDataResponse {
    pub parts: Vec<PartData>,
    /// Bitmask indicating which parts have unsaved changes (bit 0 = Part 1, etc.)
    pub parts_edited_bitmask: u8,
    /// Array of 4 values indicating if each part has valid saved state for reload (1 = yes, 0 = no)
    pub parts_saved_state: [u8; 4],
}

/// Check audio file compatibility with Octatrack
/// Returns: "compatible", "wrong_rate", "incompatible", or "unknown"
struct AudioInfo {
    compatibility: String,
    file_format: Option<String>,
    bit_depth: Option<u32>,
    sample_rate: Option<u32>,
}

fn check_audio_compatibility(file_path: &Path) -> AudioInfo {
    // Try to open as WAV file first
    if let Ok(reader) = hound::WavReader::open(file_path) {
        let spec = reader.spec();
        let sample_rate = spec.sample_rate;
        let bits_per_sample = spec.bits_per_sample as u32;

        // Octatrack supports 16 or 24 bit / 44.1 kHz
        let valid_bit_depth = bits_per_sample == 16 || bits_per_sample == 24;
        let correct_sample_rate = sample_rate == 44100;

        let compatibility = if valid_bit_depth && correct_sample_rate {
            "compatible".to_string()
        } else if valid_bit_depth && !correct_sample_rate {
            // Wrong sample rate but valid bit depth - plays at wrong speed
            "wrong_rate".to_string()
        } else {
            // Invalid bit depth - incompatible
            "incompatible".to_string()
        };

        return AudioInfo {
            compatibility,
            file_format: Some("WAV".to_string()),
            bit_depth: Some(bits_per_sample),
            sample_rate: Some(sample_rate),
        };
    }

    // Try to open as AIFF file
    if let Ok(file) = std::fs::File::open(file_path) {
        let mut stream = std::io::BufReader::new(file);
        if let Ok(reader) = aifc::AifcReader::new(&mut stream) {
            let info = reader.info();
            let sample_rate = info.sample_rate as u32;
            let bits_per_sample = info.comm_sample_size as u32;

            // Octatrack supports 16 or 24 bit / 44.1 kHz
            let valid_bit_depth = bits_per_sample == 16 || bits_per_sample == 24;
            let correct_sample_rate = sample_rate == 44100;

            let compatibility = if valid_bit_depth && correct_sample_rate {
                "compatible".to_string()
            } else if valid_bit_depth && !correct_sample_rate {
                // Wrong sample rate but valid bit depth - plays at wrong speed
                "wrong_rate".to_string()
            } else {
                // Invalid bit depth - incompatible
                "incompatible".to_string()
            };

            return AudioInfo {
                compatibility,
                file_format: Some("AIFF".to_string()),
                bit_depth: Some(bits_per_sample),
                sample_rate: Some(sample_rate),
            };
        }
    }

    // Not WAV or AIFF, or failed to parse
    AudioInfo {
        compatibility: "unknown".to_string(),
        file_format: None,
        bit_depth: None,
        sample_rate: None,
    }
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

            // Extract MIDI settings
            let midi_channels = &project.settings.control.midi.channels;
            let midi_sync = &project.settings.control.midi.sync;
            let midi_settings = MidiSettings {
                trig_channels: vec![
                    midi_channels.midi_trig_ch1,
                    midi_channels.midi_trig_ch2,
                    midi_channels.midi_trig_ch3,
                    midi_channels.midi_trig_ch4,
                    midi_channels.midi_trig_ch5,
                    midi_channels.midi_trig_ch6,
                    midi_channels.midi_trig_ch7,
                    midi_channels.midi_trig_ch8,
                ],
                auto_channel: midi_channels.midi_auto_channel,
                clock_send: midi_sync.midi_clock_send,
                clock_receive: midi_sync.midi_clock_receive,
                transport_send: midi_sync.midi_transport_send,
                transport_receive: midi_sync.midi_transport_receive,
                prog_change_send: midi_sync.midi_progchange_send,
                prog_change_send_channel: midi_sync.midi_progchange_send_channel.into(),
                prog_change_receive: midi_sync.midi_progchange_receive,
                prog_change_receive_channel: midi_sync.midi_progchange_receive_channel.into(),
            };

            // Extract metronome settings
            let metronome = &project.settings.control.metronome;
            let metronome_settings = MetronomeSettings {
                enabled: metronome.metronome_enabled,
                main_volume: metronome.metronome_main_volume,
                cue_volume: metronome.metronome_cue_volume,
                pitch: metronome.metronome_pitch,
                tonal: metronome.metronome_tonal,
                preroll: metronome.metronome_preroll,
                time_signature_numerator: metronome.metronome_time_signature + 1,  // 0-indexed to 1-indexed
                time_signature_denominator: 2u8.pow(metronome.metronome_time_signature_denominator as u32),
            };

            // Extract sample slots - include all 128 slots (empty and filled)
            let mut static_slots = Vec::new();
            for slot_id in 1..=128 {
                let slot_opt = project.slots.static_slots.get((slot_id - 1) as usize);
                if let Some(Some(slot)) = slot_opt {
                    if let Some(sample_path) = &slot.path {
                        let path_str = sample_path.to_string_lossy().to_string();
                        let source_location = if path_str.contains("/AUDIO/") || path_str.contains("\\AUDIO\\") ||
                                                  path_str.starts_with("AUDIO/") || path_str.starts_with("AUDIO\\") {
                            Some("Audio Pool".to_string())
                        } else {
                            Some("Project".to_string())
                        };
                        // Check if file exists by resolving the path relative to project directory
                        let full_path = path.join(&path_str);
                        let file_exists = full_path.exists();

                        // Check audio compatibility if file exists
                        let audio_info = if file_exists {
                            check_audio_compatibility(&full_path)
                        } else {
                            AudioInfo {
                                compatibility: "unknown".to_string(),
                                file_format: None,
                                bit_depth: None,
                                sample_rate: None,
                            }
                        };

                        static_slots.push(SampleSlot {
                            slot_id,
                            slot_type: "Static".to_string(),
                            path: Some(path_str),
                            gain: Some(slot.gain),
                            loop_mode: Some(format!("{:?}", slot.loop_mode)),
                            timestretch_mode: Some(format!("{:?}", slot.timestrech_mode)),
                            source_location,
                            file_exists,
                            compatibility: Some(audio_info.compatibility),
                            file_format: audio_info.file_format,
                            bit_depth: audio_info.bit_depth,
                            sample_rate: audio_info.sample_rate,
                        });
                    } else {
                        // Slot exists but has no sample
                        static_slots.push(SampleSlot {
                            slot_id,
                            slot_type: "Static".to_string(),
                            path: None,
                            gain: None,
                            loop_mode: None,
                            timestretch_mode: None,
                            source_location: None,
                            file_exists: false,
                            compatibility: None,
                            file_format: None,
                            bit_depth: None,
                            sample_rate: None,
                        });
                    }
                } else {
                    // Slot doesn't exist or is None
                    static_slots.push(SampleSlot {
                        slot_id,
                        slot_type: "Static".to_string(),
                        path: None,
                        gain: None,
                        loop_mode: None,
                        timestretch_mode: None,
                        source_location: None,
                        file_exists: false,
                        compatibility: None,
                        file_format: None,
                        bit_depth: None,
                        sample_rate: None,
                    });
                }
            }

            let mut flex_slots = Vec::new();
            for slot_id in 1..=128 {
                let slot_opt = project.slots.flex_slots.get((slot_id - 1) as usize);
                if let Some(Some(slot)) = slot_opt {
                    if let Some(sample_path) = &slot.path {
                        let path_str = sample_path.to_string_lossy().to_string();
                        let source_location = if path_str.contains("/AUDIO/") || path_str.contains("\\AUDIO\\") ||
                                                  path_str.starts_with("AUDIO/") || path_str.starts_with("AUDIO\\") {
                            Some("Audio Pool".to_string())
                        } else {
                            Some("Project".to_string())
                        };
                        // Check if file exists by resolving the path relative to project directory
                        let full_path = path.join(&path_str);
                        let file_exists = full_path.exists();

                        // Check audio compatibility if file exists
                        let audio_info = if file_exists {
                            check_audio_compatibility(&full_path)
                        } else {
                            AudioInfo {
                                compatibility: "unknown".to_string(),
                                file_format: None,
                                bit_depth: None,
                                sample_rate: None,
                            }
                        };

                        flex_slots.push(SampleSlot {
                            slot_id,
                            slot_type: "Flex".to_string(),
                            path: Some(path_str),
                            gain: Some(slot.gain),
                            loop_mode: Some(format!("{:?}", slot.loop_mode)),
                            timestretch_mode: Some(format!("{:?}", slot.timestrech_mode)),
                            source_location,
                            file_exists,
                            compatibility: Some(audio_info.compatibility),
                            file_format: audio_info.file_format,
                            bit_depth: audio_info.bit_depth,
                            sample_rate: audio_info.sample_rate,
                        });
                    } else {
                        // Slot exists but has no sample
                        flex_slots.push(SampleSlot {
                            slot_id,
                            slot_type: "Flex".to_string(),
                            path: None,
                            gain: None,
                            loop_mode: None,
                            timestretch_mode: None,
                            source_location: None,
                            file_exists: false,
                            compatibility: None,
                            file_format: None,
                            bit_depth: None,
                            sample_rate: None,
                        });
                    }
                } else {
                    // Slot doesn't exist or is None
                    flex_slots.push(SampleSlot {
                        slot_id,
                        slot_type: "Flex".to_string(),
                        path: None,
                        gain: None,
                        loop_mode: None,
                        timestretch_mode: None,
                        source_location: None,
                        file_exists: false,
                        compatibility: None,
                        file_format: None,
                        bit_depth: None,
                        sample_rate: None,
                    });
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
                midi_settings,
                metronome_settings,
                sample_slots,
                os_version,
            })
        }
        Err(e) => Err(format!("Failed to read project file: {:?}", e)),
    }
}

const BANK_LETTERS: [&str; 16] = [
    "A", "B", "C", "D", "E", "F", "G", "H",
    "I", "J", "K", "L", "M", "N", "O", "P"
];

/// Read a single bank by index (0-15, corresponding to banks A-P)
/// This is optimized to only read the single bank file.
pub fn read_single_bank(project_path: &str, bank_index: u8) -> Result<Option<Bank>, String> {
    if bank_index >= 16 {
        return Err(format!("Invalid bank index: {}. Must be 0-15.", bank_index));
    }

    let path = Path::new(project_path);
    let bank_num = (bank_index as usize) + 1;

    // Find the bank file
    let bank_file_name = format!("bank{:02}.work", bank_num);
    let mut bank_file_path = path.join(&bank_file_name);

    if !bank_file_path.exists() {
        let bank_file_name = format!("bank{:02}.strd", bank_num);
        bank_file_path = path.join(&bank_file_name);
        if !bank_file_path.exists() {
            return Ok(None); // Bank doesn't exist
        }
    }

    // Read only this bank using read_project_banks_internal
    match read_project_banks_internal(project_path, Some(bank_index)) {
        Ok(banks) => Ok(banks.into_iter().next()),
        Err(e) => Err(e),
    }
}

pub fn read_project_banks(project_path: &str) -> Result<Vec<Bank>, String> {
    read_project_banks_internal(project_path, None)
}

fn read_project_banks_internal(project_path: &str, target_bank_index: Option<u8>) -> Result<Vec<Bank>, String> {
    let path = Path::new(project_path);
    let mut banks = Vec::new();

    // Bank files are named bank01.work, bank02.work, etc.
    // Octatrack supports up to 16 banks (A-P)

    for (idx, bank_letter) in BANK_LETTERS.iter().enumerate() {
        // Skip banks that aren't the target (if a target is specified)
        if let Some(target) = target_bank_index {
            if idx != target as usize {
                continue;
            }
        }

        let bank_num = idx + 1;
        let bank_file_name = format!("bank{:02}.work", bank_num);
        let mut bank_file_path = path.join(&bank_file_name);

        if !bank_file_path.exists() {
            // Try .strd extension
            let bank_file_name = format!("bank{:02}.strd", bank_num);
            bank_file_path = path.join(&bank_file_name);
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
                    // Extract part name from the byte array (stop at first null byte)
                    let part_name_bytes = &bank_data.part_names[part_id as usize];
                    let null_pos = part_name_bytes.iter().position(|&b| b == 0).unwrap_or(part_name_bytes.len());
                    let part_name = String::from_utf8_lossy(&part_name_bytes[..null_pos]).to_string();
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
                            // The multiplier is a range selector, not a multiplication factor:
                            // mult=0: 2-255, mult=1: 256-511, mult=2: 512-767, mult=3: 768-1023, mult=4: 1024, mult=255: INF
                            let master_len = if pattern.scale.master_len_per_track_multiplier == 255 {
                                "INF".to_string()
                            } else if pattern.scale.master_len_per_track_multiplier == 4 {
                                "1024".to_string()
                            } else if pattern.scale.master_len_per_track_multiplier == 0 {
                                let len = pattern.scale.master_len_per_track as u16;
                                format!("{}", len)
                            } else {
                                let len = (256 * pattern.scale.master_len_per_track_multiplier as u16)
                                    + pattern.scale.master_len_per_track as u16;
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
                // If we're targeting a specific bank and it failed, return the error
                if target_bank_index.is_some() {
                    return Err(format!("Failed to read bank {}: {:?}", bank_letter, e));
                }
                // Otherwise continue with other banks
            }
        }
    }

    Ok(banks)
}

/// Read Parts machine and AMP parameters from a specific bank
pub fn read_parts_data(project_path: &str, bank_id: &str) -> Result<PartsDataResponse, String> {
    let path = Path::new(project_path);

    // Convert bank letter (A-P) to bank number (1-16)
    let bank_letters = [
        "A", "B", "C", "D", "E", "F", "G", "H",
        "I", "J", "K", "L", "M", "N", "O", "P"
    ];

    let bank_num = bank_letters.iter()
        .position(|&letter| letter == bank_id)
        .map(|idx| idx + 1)
        .ok_or_else(|| format!("Invalid bank ID: {}", bank_id))?;

    let bank_file_name = format!("bank{:02}.work", bank_num);
    let mut bank_file_path = path.join(&bank_file_name);

    if !bank_file_path.exists() {
        // Try .strd extension
        let bank_file_name = format!("bank{:02}.strd", bank_num);
        bank_file_path = path.join(&bank_file_name);
        if !bank_file_path.exists() {
            return Err(format!("Bank file not found: {}", bank_id));
        }
    }

    let bank_data = BankFile::from_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to read bank file: {:?}", e))?;

    let mut parts_data = Vec::new();

    // Each bank has 4 parts (0-3)
    // Use parts.unsaved which is the working state loaded by the Octatrack
    // (parts.saved is only used when explicitly saving a Part via the Part menu)
    for part_id in 0..4 {
        let part = &bank_data.parts.unsaved.0[part_id as usize];

        let mut machines = Vec::new();
        let mut amps = Vec::new();
        let mut lfos = Vec::new();
        let mut fxs = Vec::new();

        // Process 8 audio tracks (tracks 0-7)
        for track_id in 0..8 {
            // Get machine type (0=Static, 1=Flex, 2=Thru, 3=Neighbor, 4=Pickup)
            let machine_type_id = part.audio_track_machine_types[track_id as usize];
            let machine_type = match machine_type_id {
                0 => "Static",
                1 => "Flex",
                2 => "Thru",
                3 => "Neighbor",
                4 => "Pickup",
                _ => "Unknown",
            }.to_string();

            // Get machine parameters (SRC page)
            let machine_params_values = &part.audio_track_machine_params[track_id as usize];
            let machine_params_setup = &part.audio_track_machine_setup[track_id as usize];

            let machine_params = match machine_type_id {
                0 | 1 => {
                    // Static or Flex machine
                    let params_std = &machine_params_values.static_machine;
                    MachineParamValues {
                        ptch: Some(params_std.ptch),
                        strt: Some(params_std.strt),
                        len: Some(params_std.len),
                        rate: Some(params_std.rate),
                        rtrg: Some(params_std.rtrg),
                        rtim: Some(params_std.rtim),
                        in_ab: None,
                        vol_ab: None,
                        in_cd: None,
                        vol_cd: None,
                        dir: None,
                        gain: None,
                        op: None,
                    }
                },
                2 => {
                    // Thru machine
                    let params_thru = &machine_params_values.thru_machine;
                    MachineParamValues {
                        ptch: None,
                        strt: None,
                        len: None,
                        rate: None,
                        rtrg: None,
                        rtim: None,
                        in_ab: Some(params_thru.in_ab),
                        vol_ab: Some(params_thru.vol_ab),
                        in_cd: Some(params_thru.in_cd),
                        vol_cd: Some(params_thru.vol_cd),
                        dir: None,
                        gain: None,
                        op: None,
                    }
                },
                4 => {
                    // Pickup machine
                    let params_pickup = &machine_params_values.pickup_machine;
                    MachineParamValues {
                        ptch: Some(params_pickup.ptch),
                        strt: None,
                        len: Some(params_pickup.len),
                        rate: None,
                        rtrg: None,
                        rtim: None,
                        in_ab: None,
                        vol_ab: None,
                        in_cd: None,
                        vol_cd: None,
                        dir: Some(params_pickup.dir),
                        gain: Some(params_pickup.gain),
                        op: Some(params_pickup.op),
                    }
                },
                _ => {
                    // Neighbor (type 3) or unknown - no parameters
                    MachineParamValues {
                        ptch: None,
                        strt: None,
                        len: None,
                        rate: None,
                        rtrg: None,
                        rtim: None,
                        in_ab: None,
                        vol_ab: None,
                        in_cd: None,
                        vol_cd: None,
                        dir: None,
                        gain: None,
                        op: None,
                    }
                }
            };

            let machine_setup = match machine_type_id {
                0 | 1 => {
                    // Static or Flex machine
                    let setup_std = &machine_params_setup.static_machine;
                    MachineSetupValues {
                        xloop: Some(setup_std.xloop),
                        slic: Some(setup_std.slic),
                        len: Some(setup_std.len),
                        rate: Some(setup_std.rate),
                        tstr: Some(setup_std.tstr),
                        tsns: Some(setup_std.tsns),
                    }
                },
                4 => {
                    // Pickup machine
                    let setup_pickup = &machine_params_setup.pickup_machine;
                    MachineSetupValues {
                        xloop: None,
                        slic: None,
                        len: None,
                        rate: None,
                        tstr: Some(setup_pickup.tstr),
                        tsns: Some(setup_pickup.tsns),
                    }
                },
                _ => {
                    // Thru (type 2), Neighbor (type 3), or unknown - no setup params
                    MachineSetupValues {
                        xloop: None,
                        slic: None,
                        len: None,
                        rate: None,
                        tstr: None,
                        tsns: None,
                    }
                }
            };

            machines.push(PartTrackMachine {
                track_id,
                machine_type,
                machine_params,
                machine_setup,
            });

            // Get AMP parameters
            let amp_params = &part.audio_track_params_values[track_id as usize].amp;
            let amp_setup = &part.audio_track_params_setup[track_id as usize].amp;

            amps.push(PartTrackAmp {
                track_id,
                atk: amp_params.atk,
                hold: amp_params.hold,
                rel: amp_params.rel,
                vol: amp_params.vol,
                bal: amp_params.bal,
                f: amp_params.f,
                amp_setup_amp: amp_setup.amp,
                amp_setup_sync: amp_setup.sync,
                amp_setup_atck: amp_setup.atck,
                amp_setup_fx1: amp_setup.fx1,
                amp_setup_fx2: amp_setup.fx2,
            });

            // Get LFO parameters
            let lfo_params = &part.audio_track_params_values[track_id as usize].lfo;
            let lfo_setup_1 = &part.audio_track_params_setup[track_id as usize].lfo_setup_1;
            let lfo_setup_2 = &part.audio_track_params_setup[track_id as usize].lfo_setup_2;

            // Get custom LFO design (16-step waveform)
            let custom_lfo_design = part.audio_tracks_custom_lfo_designs[track_id as usize].0.to_vec();

            lfos.push(PartTrackLfo {
                track_id,
                // MAIN LFO parameters
                spd1: lfo_params.spd1,
                spd2: lfo_params.spd2,
                spd3: lfo_params.spd3,
                dep1: lfo_params.dep1,
                dep2: lfo_params.dep2,
                dep3: lfo_params.dep3,
                // SETUP LFO parameters (Setup 1)
                lfo1_pmtr: lfo_setup_1.lfo1_pmtr,
                lfo2_pmtr: lfo_setup_1.lfo2_pmtr,
                lfo3_pmtr: lfo_setup_1.lfo3_pmtr,
                lfo1_wave: lfo_setup_1.lfo1_wave,
                lfo2_wave: lfo_setup_1.lfo2_wave,
                lfo3_wave: lfo_setup_1.lfo3_wave,
                // SETUP LFO parameters (Setup 2)
                lfo1_mult: lfo_setup_2.lfo1_mult,
                lfo2_mult: lfo_setup_2.lfo2_mult,
                lfo3_mult: lfo_setup_2.lfo3_mult,
                lfo1_trig: lfo_setup_2.lfo1_trig,
                lfo2_trig: lfo_setup_2.lfo2_trig,
                lfo3_trig: lfo_setup_2.lfo3_trig,
                // CUSTOM LFO Design
                custom_lfo_design,
            });

            // Get FX types and parameters
            let fx1_type = part.audio_track_fx1[track_id as usize];
            let fx2_type = part.audio_track_fx2[track_id as usize];

            // Get FX1 main parameters
            let fx1_params = &part.audio_track_params_values[track_id as usize].fx1;

            // Get FX2 main parameters
            let fx2_params = &part.audio_track_params_values[track_id as usize].fx2;

            // Get FX1 setup parameters
            let fx1_setup = &part.audio_track_params_setup[track_id as usize].fx1;

            // Get FX2 setup parameters
            let fx2_setup = &part.audio_track_params_setup[track_id as usize].fx2;

            fxs.push(PartTrackFx {
                track_id,
                fx1_type,
                fx2_type,
                // FX1 main parameters
                fx1_param1: fx1_params.param_1,
                fx1_param2: fx1_params.param_2,
                fx1_param3: fx1_params.param_3,
                fx1_param4: fx1_params.param_4,
                fx1_param5: fx1_params.param_5,
                fx1_param6: fx1_params.param_6,
                // FX2 main parameters
                fx2_param1: fx2_params.param_1,
                fx2_param2: fx2_params.param_2,
                fx2_param3: fx2_params.param_3,
                fx2_param4: fx2_params.param_4,
                fx2_param5: fx2_params.param_5,
                fx2_param6: fx2_params.param_6,
                // FX1 setup parameters
                fx1_setup1: fx1_setup.setting1,
                fx1_setup2: fx1_setup.setting2,
                fx1_setup3: fx1_setup.setting3,
                fx1_setup4: fx1_setup.setting4,
                fx1_setup5: fx1_setup.setting5,
                fx1_setup6: fx1_setup.setting6,
                // FX2 setup parameters
                fx2_setup1: fx2_setup.setting1,
                fx2_setup2: fx2_setup.setting2,
                fx2_setup3: fx2_setup.setting3,
                fx2_setup4: fx2_setup.setting4,
                fx2_setup5: fx2_setup.setting5,
                fx2_setup6: fx2_setup.setting6,
            });
        }

        // Process 8 MIDI tracks (tracks 0-7)
        let mut midi_notes = Vec::new();
        let mut midi_arps = Vec::new();
        let mut midi_lfos = Vec::new();
        let mut midi_ctrl1s = Vec::new();
        let mut midi_ctrl2s = Vec::new();

        for track_id in 0..8 {
            // Get MIDI NOTE parameters
            let midi_note_params = &part.midi_track_params_values[track_id as usize].midi;
            let midi_note_setup = &part.midi_track_params_setup[track_id as usize].note;

            midi_notes.push(PartTrackMidiNote {
                track_id,
                // NOTE MAIN parameters
                note: midi_note_params.note,
                vel: midi_note_params.vel,
                len: midi_note_params.len,
                not2: midi_note_params.not2,
                not3: midi_note_params.not3,
                not4: midi_note_params.not4,
                // NOTE SETUP parameters
                chan: midi_note_setup.chan,
                bank: midi_note_setup.bank,
                prog: midi_note_setup.prog,
                sbnk: midi_note_setup.sbank,
            });

            // Get MIDI ARP parameters
            let midi_arp_params = &part.midi_track_params_values[track_id as usize].arp;
            let midi_arp_setup = &part.midi_track_params_setup[track_id as usize].arp;

            midi_arps.push(PartTrackMidiArp {
                track_id,
                // ARP MAIN parameters
                tran: midi_arp_params.tran,
                leg: midi_arp_params.leg,
                mode: midi_arp_params.mode,
                spd: midi_arp_params.spd,
                rnge: midi_arp_params.rnge,
                nlen: midi_arp_params.nlen,
                // ARP SETUP parameters
                len: midi_arp_setup.len,
                key: midi_arp_setup.key,
            });

            // Get MIDI LFO parameters (reuse audio LFO structure)
            let midi_lfo_params = &part.midi_track_params_values[track_id as usize].lfo;
            let midi_lfo_setup_1 = &part.midi_track_params_setup[track_id as usize].lfo1;
            let midi_lfo_setup_2 = &part.midi_track_params_setup[track_id as usize].lfo2;

            // Get custom LFO design for MIDI tracks
            let midi_custom_lfo_design = part.midi_tracks_custom_lfos[track_id as usize].0.to_vec();

            midi_lfos.push(PartTrackLfo {
                track_id,
                // MAIN LFO parameters
                spd1: midi_lfo_params.spd1,
                spd2: midi_lfo_params.spd2,
                spd3: midi_lfo_params.spd3,
                dep1: midi_lfo_params.dep1,
                dep2: midi_lfo_params.dep2,
                dep3: midi_lfo_params.dep3,
                // SETUP LFO parameters (Setup 1)
                lfo1_pmtr: midi_lfo_setup_1.lfo1_pmtr,
                lfo2_pmtr: midi_lfo_setup_1.lfo2_pmtr,
                lfo3_pmtr: midi_lfo_setup_1.lfo3_pmtr,
                lfo1_wave: midi_lfo_setup_1.lfo1_wave,
                lfo2_wave: midi_lfo_setup_1.lfo2_wave,
                lfo3_wave: midi_lfo_setup_1.lfo3_wave,
                // SETUP LFO parameters (Setup 2)
                lfo1_mult: midi_lfo_setup_2.lfo1_mult,
                lfo2_mult: midi_lfo_setup_2.lfo2_mult,
                lfo3_mult: midi_lfo_setup_2.lfo3_mult,
                lfo1_trig: midi_lfo_setup_2.lfo1_trig,
                lfo2_trig: midi_lfo_setup_2.lfo2_trig,
                lfo3_trig: midi_lfo_setup_2.lfo3_trig,
                // CUSTOM LFO Design
                custom_lfo_design: midi_custom_lfo_design,
            });

            // Get MIDI CTRL1 parameters
            let midi_ctrl1_params = &part.midi_track_params_values[track_id as usize].ctrl1;
            let midi_ctrl1_setup = &part.midi_track_params_setup[track_id as usize].ctrl1;

            midi_ctrl1s.push(PartTrackMidiCtrl1 {
                track_id,
                // CTRL1 MAIN parameters
                pb: midi_ctrl1_params.pb,
                at: midi_ctrl1_params.at,
                cc1: midi_ctrl1_params.cc1,
                cc2: midi_ctrl1_params.cc2,
                cc3: midi_ctrl1_params.cc3,
                cc4: midi_ctrl1_params.cc4,
                // CTRL1 SETUP parameters (CC numbers)
                cc1_num: midi_ctrl1_setup.cc1,
                cc2_num: midi_ctrl1_setup.cc2,
                cc3_num: midi_ctrl1_setup.cc3,
                cc4_num: midi_ctrl1_setup.cc4,
            });

            // Get MIDI CTRL2 parameters
            let midi_ctrl2_params = &part.midi_track_params_values[track_id as usize].ctrl2;
            let midi_ctrl2_setup = &part.midi_track_params_setup[track_id as usize].ctrl2;

            midi_ctrl2s.push(PartTrackMidiCtrl2 {
                track_id,
                // CTRL2 MAIN parameters
                cc5: midi_ctrl2_params.cc5,
                cc6: midi_ctrl2_params.cc6,
                cc7: midi_ctrl2_params.cc7,
                cc8: midi_ctrl2_params.cc8,
                cc9: midi_ctrl2_params.cc9,
                cc10: midi_ctrl2_params.cc10,
                // CTRL2 SETUP parameters (CC numbers)
                cc5_num: midi_ctrl2_setup.cc5,
                cc6_num: midi_ctrl2_setup.cc6,
                cc7_num: midi_ctrl2_setup.cc7,
                cc8_num: midi_ctrl2_setup.cc8,
                cc9_num: midi_ctrl2_setup.cc9,
                cc10_num: midi_ctrl2_setup.cc10,
            });
        }

        parts_data.push(PartData {
            part_id,
            machines,
            amps,
            lfos,
            fxs,
            midi_notes,
            midi_arps,
            midi_lfos,
            midi_ctrl1s,
            midi_ctrl2s,
        });
    }

    Ok(PartsDataResponse {
        parts: parts_data,
        parts_edited_bitmask: bank_data.parts_edited_bitmask,
        parts_saved_state: bank_data.parts_saved_state,
    })
}

/// Save modified Parts data back to a bank file
pub fn save_parts_data(project_path: &str, bank_id: &str, parts_data: Vec<PartData>) -> Result<(), String> {
    let path = Path::new(project_path);

    // Convert bank letter (A-P) to bank number (1-16)
    let bank_letters = [
        "A", "B", "C", "D", "E", "F", "G", "H",
        "I", "J", "K", "L", "M", "N", "O", "P"
    ];

    let bank_num = bank_letters.iter()
        .position(|&letter| letter == bank_id)
        .map(|idx| idx + 1)
        .ok_or_else(|| format!("Invalid bank ID: {}", bank_id))?;

    let bank_file_name = format!("bank{:02}.work", bank_num);
    let mut bank_file_path = path.join(&bank_file_name);

    if !bank_file_path.exists() {
        // Try .strd extension
        let bank_file_name = format!("bank{:02}.strd", bank_num);
        bank_file_path = path.join(&bank_file_name);
        if !bank_file_path.exists() {
            return Err(format!("Bank file not found: {}", bank_id));
        }
    }

    // Read the existing bank file
    let mut bank_data = BankFile::from_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to read bank file: {:?}", e))?;

    // Update the parts with the provided data
    // We ONLY write to parts.unsaved (the working copy), NOT parts.saved (the backup)
    // - parts.unsaved = working state that gets loaded; this is what we modify
    // - parts.saved = backup state used by "Reload Part" function on Octatrack
    // By keeping parts.saved unchanged, the user can use "Reload Part" on the Octatrack
    // to restore the original values before our edits.
    for part_data in &parts_data {
        let part_id = part_data.part_id as usize;
        if part_id >= 4 {
            continue; // Skip invalid part IDs
        }

        // Get mutable reference to the unsaved (working) copy only
        let part_unsaved = &mut bank_data.parts.unsaved.0[part_id];

        // Update audio track parameters for each track
        for track_id in 0..8 {
            // Update AMP parameters
            if let Some(amp) = part_data.amps.get(track_id) {
                println!("[DEBUG] Writing to parts.unsaved ONLY - Part {}, Track {}: ATK before={}, ATK after={}",
                         part_id, track_id,
                         part_unsaved.audio_track_params_values[track_id].amp.atk,
                         amp.atk);

                part_unsaved.audio_track_params_values[track_id].amp.atk = amp.atk;
                part_unsaved.audio_track_params_values[track_id].amp.hold = amp.hold;
                part_unsaved.audio_track_params_values[track_id].amp.rel = amp.rel;
                part_unsaved.audio_track_params_values[track_id].amp.vol = amp.vol;
                part_unsaved.audio_track_params_values[track_id].amp.bal = amp.bal;
                part_unsaved.audio_track_params_values[track_id].amp.f = amp.f;

                // AMP Setup parameters
                part_unsaved.audio_track_params_setup[track_id].amp.amp = amp.amp_setup_amp;
                part_unsaved.audio_track_params_setup[track_id].amp.sync = amp.amp_setup_sync;
                part_unsaved.audio_track_params_setup[track_id].amp.atck = amp.amp_setup_atck;
                part_unsaved.audio_track_params_setup[track_id].amp.fx1 = amp.amp_setup_fx1;
                part_unsaved.audio_track_params_setup[track_id].amp.fx2 = amp.amp_setup_fx2;
            }

            // Update LFO parameters
            if let Some(lfo) = part_data.lfos.get(track_id) {
                // Main LFO values
                part_unsaved.audio_track_params_values[track_id].lfo.spd1 = lfo.spd1;
                part_unsaved.audio_track_params_values[track_id].lfo.spd2 = lfo.spd2;
                part_unsaved.audio_track_params_values[track_id].lfo.spd3 = lfo.spd3;
                part_unsaved.audio_track_params_values[track_id].lfo.dep1 = lfo.dep1;
                part_unsaved.audio_track_params_values[track_id].lfo.dep2 = lfo.dep2;
                part_unsaved.audio_track_params_values[track_id].lfo.dep3 = lfo.dep3;

                // LFO Setup 1 (Parameter Target & Wave)
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_1.lfo1_pmtr = lfo.lfo1_pmtr;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_1.lfo2_pmtr = lfo.lfo2_pmtr;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_1.lfo3_pmtr = lfo.lfo3_pmtr;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_1.lfo1_wave = lfo.lfo1_wave;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_1.lfo2_wave = lfo.lfo2_wave;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_1.lfo3_wave = lfo.lfo3_wave;

                // LFO Setup 2 (Multiplier & Trigger)
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_2.lfo1_mult = lfo.lfo1_mult;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_2.lfo2_mult = lfo.lfo2_mult;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_2.lfo3_mult = lfo.lfo3_mult;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_2.lfo1_trig = lfo.lfo1_trig;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_2.lfo2_trig = lfo.lfo2_trig;
                part_unsaved.audio_track_params_setup[track_id].lfo_setup_2.lfo3_trig = lfo.lfo3_trig;

                // Custom LFO design
                if lfo.custom_lfo_design.len() == 16 {
                    for (i, &val) in lfo.custom_lfo_design.iter().enumerate() {
                        part_unsaved.audio_tracks_custom_lfo_designs[track_id].0[i] = val;
                    }
                }
            }

            // Update FX parameters
            if let Some(fx) = part_data.fxs.get(track_id) {
                // FX types
                part_unsaved.audio_track_fx1[track_id] = fx.fx1_type;
                part_unsaved.audio_track_fx2[track_id] = fx.fx2_type;

                // FX1 main parameters
                part_unsaved.audio_track_params_values[track_id].fx1.param_1 = fx.fx1_param1;
                part_unsaved.audio_track_params_values[track_id].fx1.param_2 = fx.fx1_param2;
                part_unsaved.audio_track_params_values[track_id].fx1.param_3 = fx.fx1_param3;
                part_unsaved.audio_track_params_values[track_id].fx1.param_4 = fx.fx1_param4;
                part_unsaved.audio_track_params_values[track_id].fx1.param_5 = fx.fx1_param5;
                part_unsaved.audio_track_params_values[track_id].fx1.param_6 = fx.fx1_param6;

                // FX2 main parameters
                part_unsaved.audio_track_params_values[track_id].fx2.param_1 = fx.fx2_param1;
                part_unsaved.audio_track_params_values[track_id].fx2.param_2 = fx.fx2_param2;
                part_unsaved.audio_track_params_values[track_id].fx2.param_3 = fx.fx2_param3;
                part_unsaved.audio_track_params_values[track_id].fx2.param_4 = fx.fx2_param4;
                part_unsaved.audio_track_params_values[track_id].fx2.param_5 = fx.fx2_param5;
                part_unsaved.audio_track_params_values[track_id].fx2.param_6 = fx.fx2_param6;

                // FX1 setup parameters
                part_unsaved.audio_track_params_setup[track_id].fx1.setting1 = fx.fx1_setup1;
                part_unsaved.audio_track_params_setup[track_id].fx1.setting2 = fx.fx1_setup2;
                part_unsaved.audio_track_params_setup[track_id].fx1.setting3 = fx.fx1_setup3;
                part_unsaved.audio_track_params_setup[track_id].fx1.setting4 = fx.fx1_setup4;
                part_unsaved.audio_track_params_setup[track_id].fx1.setting5 = fx.fx1_setup5;
                part_unsaved.audio_track_params_setup[track_id].fx1.setting6 = fx.fx1_setup6;

                // FX2 setup parameters
                part_unsaved.audio_track_params_setup[track_id].fx2.setting1 = fx.fx2_setup1;
                part_unsaved.audio_track_params_setup[track_id].fx2.setting2 = fx.fx2_setup2;
                part_unsaved.audio_track_params_setup[track_id].fx2.setting3 = fx.fx2_setup3;
                part_unsaved.audio_track_params_setup[track_id].fx2.setting4 = fx.fx2_setup4;
                part_unsaved.audio_track_params_setup[track_id].fx2.setting5 = fx.fx2_setup5;
                part_unsaved.audio_track_params_setup[track_id].fx2.setting6 = fx.fx2_setup6;
            }

            // Update Machine parameters (SRC page)
            if let Some(machine) = part_data.machines.get(track_id) {
                let machine_type = part_unsaved.audio_track_machine_types[track_id];

                match machine_type {
                    0 | 1 => {
                        // Static or Flex machine
                        if let Some(ptch) = machine.machine_params.ptch {
                            part_unsaved.audio_track_machine_params[track_id].static_machine.ptch = ptch;
                        }
                        if let Some(strt) = machine.machine_params.strt {
                            part_unsaved.audio_track_machine_params[track_id].static_machine.strt = strt;
                        }
                        if let Some(len) = machine.machine_params.len {
                            part_unsaved.audio_track_machine_params[track_id].static_machine.len = len;
                        }
                        if let Some(rate) = machine.machine_params.rate {
                            part_unsaved.audio_track_machine_params[track_id].static_machine.rate = rate;
                        }
                        if let Some(rtrg) = machine.machine_params.rtrg {
                            part_unsaved.audio_track_machine_params[track_id].static_machine.rtrg = rtrg;
                        }
                        if let Some(rtim) = machine.machine_params.rtim {
                            part_unsaved.audio_track_machine_params[track_id].static_machine.rtim = rtim;
                        }

                        // Machine setup
                        if let Some(xloop) = machine.machine_setup.xloop {
                            part_unsaved.audio_track_machine_setup[track_id].static_machine.xloop = xloop;
                        }
                        if let Some(slic) = machine.machine_setup.slic {
                            part_unsaved.audio_track_machine_setup[track_id].static_machine.slic = slic;
                        }
                        if let Some(len) = machine.machine_setup.len {
                            part_unsaved.audio_track_machine_setup[track_id].static_machine.len = len;
                        }
                        if let Some(rate) = machine.machine_setup.rate {
                            part_unsaved.audio_track_machine_setup[track_id].static_machine.rate = rate;
                        }
                        if let Some(tstr) = machine.machine_setup.tstr {
                            part_unsaved.audio_track_machine_setup[track_id].static_machine.tstr = tstr;
                        }
                        if let Some(tsns) = machine.machine_setup.tsns {
                            part_unsaved.audio_track_machine_setup[track_id].static_machine.tsns = tsns;
                        }
                    },
                    2 => {
                        // Thru machine
                        if let Some(in_ab) = machine.machine_params.in_ab {
                            part_unsaved.audio_track_machine_params[track_id].thru_machine.in_ab = in_ab;
                        }
                        if let Some(vol_ab) = machine.machine_params.vol_ab {
                            part_unsaved.audio_track_machine_params[track_id].thru_machine.vol_ab = vol_ab;
                        }
                        if let Some(in_cd) = machine.machine_params.in_cd {
                            part_unsaved.audio_track_machine_params[track_id].thru_machine.in_cd = in_cd;
                        }
                        if let Some(vol_cd) = machine.machine_params.vol_cd {
                            part_unsaved.audio_track_machine_params[track_id].thru_machine.vol_cd = vol_cd;
                        }
                    },
                    4 => {
                        // Pickup machine
                        if let Some(ptch) = machine.machine_params.ptch {
                            part_unsaved.audio_track_machine_params[track_id].pickup_machine.ptch = ptch;
                        }
                        if let Some(len) = machine.machine_params.len {
                            part_unsaved.audio_track_machine_params[track_id].pickup_machine.len = len;
                        }
                        if let Some(dir) = machine.machine_params.dir {
                            part_unsaved.audio_track_machine_params[track_id].pickup_machine.dir = dir;
                        }
                        if let Some(gain) = machine.machine_params.gain {
                            part_unsaved.audio_track_machine_params[track_id].pickup_machine.gain = gain;
                        }
                        if let Some(op) = machine.machine_params.op {
                            part_unsaved.audio_track_machine_params[track_id].pickup_machine.op = op;
                        }
                    },
                    _ => {
                        // Neighbor (type 3) or unknown - no parameters to update
                    }
                }
            }
        }

        // Update MIDI track parameters
        for track_id in 0..8 {
            // Update MIDI NOTE parameters
            if let Some(midi_note) = part_data.midi_notes.get(track_id) {
                part_unsaved.midi_track_params_values[track_id].midi.note = midi_note.note;
                part_unsaved.midi_track_params_values[track_id].midi.vel = midi_note.vel;
                part_unsaved.midi_track_params_values[track_id].midi.len = midi_note.len;
                part_unsaved.midi_track_params_values[track_id].midi.not2 = midi_note.not2;
                part_unsaved.midi_track_params_values[track_id].midi.not3 = midi_note.not3;
                part_unsaved.midi_track_params_values[track_id].midi.not4 = midi_note.not4;

                // NOTE Setup parameters
                part_unsaved.midi_track_params_setup[track_id].note.chan = midi_note.chan;
                part_unsaved.midi_track_params_setup[track_id].note.bank = midi_note.bank;
                part_unsaved.midi_track_params_setup[track_id].note.prog = midi_note.prog;
                part_unsaved.midi_track_params_setup[track_id].note.sbank = midi_note.sbnk;
            }

            // Update MIDI ARP parameters
            if let Some(midi_arp) = part_data.midi_arps.get(track_id) {
                part_unsaved.midi_track_params_values[track_id].arp.tran = midi_arp.tran;
                part_unsaved.midi_track_params_values[track_id].arp.leg = midi_arp.leg;
                part_unsaved.midi_track_params_values[track_id].arp.mode = midi_arp.mode;
                part_unsaved.midi_track_params_values[track_id].arp.spd = midi_arp.spd;
                part_unsaved.midi_track_params_values[track_id].arp.rnge = midi_arp.rnge;
                part_unsaved.midi_track_params_values[track_id].arp.nlen = midi_arp.nlen;

                // ARP Setup parameters
                part_unsaved.midi_track_params_setup[track_id].arp.len = midi_arp.len;
                part_unsaved.midi_track_params_setup[track_id].arp.key = midi_arp.key;
            }

            // Update MIDI LFO parameters
            if let Some(midi_lfo) = part_data.midi_lfos.get(track_id) {
                // Main LFO values
                part_unsaved.midi_track_params_values[track_id].lfo.spd1 = midi_lfo.spd1;
                part_unsaved.midi_track_params_values[track_id].lfo.spd2 = midi_lfo.spd2;
                part_unsaved.midi_track_params_values[track_id].lfo.spd3 = midi_lfo.spd3;
                part_unsaved.midi_track_params_values[track_id].lfo.dep1 = midi_lfo.dep1;
                part_unsaved.midi_track_params_values[track_id].lfo.dep2 = midi_lfo.dep2;
                part_unsaved.midi_track_params_values[track_id].lfo.dep3 = midi_lfo.dep3;

                // LFO Setup 1 (Parameter Target & Wave)
                part_unsaved.midi_track_params_setup[track_id].lfo1.lfo1_pmtr = midi_lfo.lfo1_pmtr;
                part_unsaved.midi_track_params_setup[track_id].lfo1.lfo2_pmtr = midi_lfo.lfo2_pmtr;
                part_unsaved.midi_track_params_setup[track_id].lfo1.lfo3_pmtr = midi_lfo.lfo3_pmtr;
                part_unsaved.midi_track_params_setup[track_id].lfo1.lfo1_wave = midi_lfo.lfo1_wave;
                part_unsaved.midi_track_params_setup[track_id].lfo1.lfo2_wave = midi_lfo.lfo2_wave;
                part_unsaved.midi_track_params_setup[track_id].lfo1.lfo3_wave = midi_lfo.lfo3_wave;

                // LFO Setup 2 (Multiplier & Trigger)
                part_unsaved.midi_track_params_setup[track_id].lfo2.lfo1_mult = midi_lfo.lfo1_mult;
                part_unsaved.midi_track_params_setup[track_id].lfo2.lfo2_mult = midi_lfo.lfo2_mult;
                part_unsaved.midi_track_params_setup[track_id].lfo2.lfo3_mult = midi_lfo.lfo3_mult;
                part_unsaved.midi_track_params_setup[track_id].lfo2.lfo1_trig = midi_lfo.lfo1_trig;
                part_unsaved.midi_track_params_setup[track_id].lfo2.lfo2_trig = midi_lfo.lfo2_trig;
                part_unsaved.midi_track_params_setup[track_id].lfo2.lfo3_trig = midi_lfo.lfo3_trig;

                // Custom LFO design
                if midi_lfo.custom_lfo_design.len() == 16 {
                    for (i, &val) in midi_lfo.custom_lfo_design.iter().enumerate() {
                        part_unsaved.midi_tracks_custom_lfos[track_id].0[i] = val;
                    }
                }
            }

            // Update MIDI CTRL1 parameters
            if let Some(midi_ctrl1) = part_data.midi_ctrl1s.get(track_id) {
                part_unsaved.midi_track_params_values[track_id].ctrl1.pb = midi_ctrl1.pb;
                part_unsaved.midi_track_params_values[track_id].ctrl1.at = midi_ctrl1.at;
                part_unsaved.midi_track_params_values[track_id].ctrl1.cc1 = midi_ctrl1.cc1;
                part_unsaved.midi_track_params_values[track_id].ctrl1.cc2 = midi_ctrl1.cc2;
                part_unsaved.midi_track_params_values[track_id].ctrl1.cc3 = midi_ctrl1.cc3;
                part_unsaved.midi_track_params_values[track_id].ctrl1.cc4 = midi_ctrl1.cc4;

                // CTRL1 Setup parameters (CC numbers)
                part_unsaved.midi_track_params_setup[track_id].ctrl1.cc1 = midi_ctrl1.cc1_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl1.cc2 = midi_ctrl1.cc2_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl1.cc3 = midi_ctrl1.cc3_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl1.cc4 = midi_ctrl1.cc4_num;
            }

            // Update MIDI CTRL2 parameters
            if let Some(midi_ctrl2) = part_data.midi_ctrl2s.get(track_id) {
                part_unsaved.midi_track_params_values[track_id].ctrl2.cc5 = midi_ctrl2.cc5;
                part_unsaved.midi_track_params_values[track_id].ctrl2.cc6 = midi_ctrl2.cc6;
                part_unsaved.midi_track_params_values[track_id].ctrl2.cc7 = midi_ctrl2.cc7;
                part_unsaved.midi_track_params_values[track_id].ctrl2.cc8 = midi_ctrl2.cc8;
                part_unsaved.midi_track_params_values[track_id].ctrl2.cc9 = midi_ctrl2.cc9;
                part_unsaved.midi_track_params_values[track_id].ctrl2.cc10 = midi_ctrl2.cc10;

                // CTRL2 Setup parameters (CC numbers)
                part_unsaved.midi_track_params_setup[track_id].ctrl2.cc5 = midi_ctrl2.cc5_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl2.cc6 = midi_ctrl2.cc6_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl2.cc7 = midi_ctrl2.cc7_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl2.cc8 = midi_ctrl2.cc8_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl2.cc9 = midi_ctrl2.cc9_num;
                part_unsaved.midi_track_params_setup[track_id].ctrl2.cc10 = midi_ctrl2.cc10_num;
            }
        }
    }

    // Update parts_edited_bitmask to indicate which parts have been modified
    // Bitmask: Part 1 = bit 0 (1), Part 2 = bit 1 (2), Part 3 = bit 2 (4), Part 4 = bit 3 (8)
    // NOTE: We do NOT set parts_saved_state here because we're only editing parts.unsaved,
    // not committing changes to parts.saved. This allows "Reload Part" to work on the Octatrack.
    for part_data in &parts_data {
        let part_id = part_data.part_id as usize;
        if part_id < 4 {
            bank_data.parts_edited_bitmask |= 1 << part_id;
            // Don't touch parts_saved_state - we're editing, not saving/committing
        }
    }
    println!("[DEBUG] parts_edited_bitmask after update: {}", bank_data.parts_edited_bitmask);
    println!("[DEBUG] parts_saved_state unchanged: {:?}", bank_data.parts_saved_state);

    // Debug: Verify part headers and part_id values in both saved and unsaved
    for i in 0..4 {
        let unsaved = &bank_data.parts.unsaved.0[i];
        let saved = &bank_data.parts.saved.0[i];
        println!("[DEBUG] Part {} - unsaved header: {:02X?}, part_id: {}", i, unsaved.header, unsaved.part_id);
        println!("[DEBUG] Part {} - saved header: {:02X?}, part_id: {}", i, saved.header, saved.part_id);
        // Log ATK value for Track 0 as our test parameter
        println!("[DEBUG] Part {} - unsaved ATK[0]: {}, saved ATK[0]: {}",
            i,
            unsaved.audio_track_params_values[0].amp.atk,
            saved.audio_track_params_values[0].amp.atk);
    }

    // Recalculate checksum before saving
    let old_checksum = bank_data.checksum;
    bank_data.checksum = bank_data.calculate_checksum()
        .map_err(|e| format!("Failed to calculate checksum: {:?}", e))?;
    println!("[DEBUG] Checksum: old={}, new={}", old_checksum, bank_data.checksum);

    // Write the modified bank file back
    bank_data.to_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to write bank file: {:?}", e))?;
    println!("[DEBUG] Bank file written successfully");

    // VERIFICATION: Read the file back and verify the data persisted correctly
    let verify_bank = BankFile::from_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to verify bank file: {:?}", e))?;
    println!("[DEBUG VERIFY] parts_saved_state after re-read: {:?}", verify_bank.parts_saved_state);
    println!("[DEBUG VERIFY] parts_edited_bitmask after re-read: {}", verify_bank.parts_edited_bitmask);
    println!("[DEBUG VERIFY] checksum after re-read: {}", verify_bank.checksum);
    for i in 0..4 {
        let saved = &verify_bank.parts.saved.0[i];
        println!("[DEBUG VERIFY] Part {} saved ATK[0]: {}", i, saved.audio_track_params_values[0].amp.atk);
    }

    Ok(())
}

/// Commit a single part: copy parts.unsaved to parts.saved (like Octatrack's "SAVE" command)
/// This makes the current working state become the "saved" state that can be reloaded to later.
pub fn commit_part_data(project_path: &str, bank_id: &str, part_id: u8) -> Result<(), String> {
    let path = Path::new(project_path);

    // Convert bank letter (A-P) to bank number (1-16)
    let bank_letters = [
        "A", "B", "C", "D", "E", "F", "G", "H",
        "I", "J", "K", "L", "M", "N", "O", "P"
    ];

    let bank_num = bank_letters.iter()
        .position(|&letter| letter == bank_id)
        .map(|idx| idx + 1)
        .ok_or_else(|| format!("Invalid bank ID: {}", bank_id))?;

    let bank_file_name = format!("bank{:02}.work", bank_num);
    let mut bank_file_path = path.join(&bank_file_name);

    if !bank_file_path.exists() {
        let bank_file_name = format!("bank{:02}.strd", bank_num);
        bank_file_path = path.join(&bank_file_name);
        if !bank_file_path.exists() {
            return Err(format!("Bank file not found: {}", bank_id));
        }
    }

    // Read the existing bank file
    let mut bank_data = BankFile::from_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to read bank file: {:?}", e))?;

    let part_idx = part_id as usize;
    if part_idx >= 4 {
        return Err(format!("Invalid part ID: {} (must be 0-3)", part_id));
    }

    println!("[DEBUG] Committing part {} (copying unsaved to saved)", part_idx);

    // Copy the unsaved part to saved part (deep copy)
    // This is what the Octatrack's "SAVE" command does
    bank_data.parts.saved.0[part_idx] = bank_data.parts.unsaved.0[part_idx].clone();

    // Set parts_saved_state to indicate this part now has valid saved data
    bank_data.parts_saved_state[part_idx] = 1;

    // Clear the edited bit for this part since we just committed its changes
    bank_data.parts_edited_bitmask &= !(1 << part_idx);

    println!("[DEBUG] parts_edited_bitmask after commit: {}", bank_data.parts_edited_bitmask);
    println!("[DEBUG] parts_saved_state after commit: {:?}", bank_data.parts_saved_state);

    // Recalculate checksum
    bank_data.checksum = bank_data.calculate_checksum()
        .map_err(|e| format!("Failed to calculate checksum: {:?}", e))?;

    // Write the modified bank file back
    bank_data.to_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to write bank file: {:?}", e))?;

    println!("[DEBUG] Part {} committed successfully", part_idx);

    Ok(())
}

/// Commit all parts: copy all parts.unsaved to parts.saved (like Octatrack's "SAVE ALL" command)
pub fn commit_all_parts_data(project_path: &str, bank_id: &str) -> Result<(), String> {
    let path = Path::new(project_path);

    let bank_letters = [
        "A", "B", "C", "D", "E", "F", "G", "H",
        "I", "J", "K", "L", "M", "N", "O", "P"
    ];

    let bank_num = bank_letters.iter()
        .position(|&letter| letter == bank_id)
        .map(|idx| idx + 1)
        .ok_or_else(|| format!("Invalid bank ID: {}", bank_id))?;

    let bank_file_name = format!("bank{:02}.work", bank_num);
    let mut bank_file_path = path.join(&bank_file_name);

    if !bank_file_path.exists() {
        let bank_file_name = format!("bank{:02}.strd", bank_num);
        bank_file_path = path.join(&bank_file_name);
        if !bank_file_path.exists() {
            return Err(format!("Bank file not found: {}", bank_id));
        }
    }

    let mut bank_data = BankFile::from_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to read bank file: {:?}", e))?;

    println!("[DEBUG] Committing all parts (copying unsaved to saved)");

    // Copy all unsaved parts to saved parts
    for part_idx in 0..4 {
        bank_data.parts.saved.0[part_idx] = bank_data.parts.unsaved.0[part_idx].clone();
        bank_data.parts_saved_state[part_idx] = 1;
    }

    // Clear all edited bits
    bank_data.parts_edited_bitmask = 0;

    println!("[DEBUG] parts_edited_bitmask after commit all: {}", bank_data.parts_edited_bitmask);
    println!("[DEBUG] parts_saved_state after commit all: {:?}", bank_data.parts_saved_state);

    bank_data.checksum = bank_data.calculate_checksum()
        .map_err(|e| format!("Failed to calculate checksum: {:?}", e))?;

    bank_data.to_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to write bank file: {:?}", e))?;

    println!("[DEBUG] All parts committed successfully");

    Ok(())
}

/// Reload a single part: copy parts.saved back to parts.unsaved (like Octatrack's "RELOAD" command)
/// Returns the reloaded part data so the frontend can update its state.
pub fn reload_part_data(project_path: &str, bank_id: &str, part_id: u8) -> Result<PartData, String> {
    let path = Path::new(project_path);

    let bank_letters = [
        "A", "B", "C", "D", "E", "F", "G", "H",
        "I", "J", "K", "L", "M", "N", "O", "P"
    ];

    let bank_num = bank_letters.iter()
        .position(|&letter| letter == bank_id)
        .map(|idx| idx + 1)
        .ok_or_else(|| format!("Invalid bank ID: {}", bank_id))?;

    let bank_file_name = format!("bank{:02}.work", bank_num);
    let mut bank_file_path = path.join(&bank_file_name);

    if !bank_file_path.exists() {
        let bank_file_name = format!("bank{:02}.strd", bank_num);
        bank_file_path = path.join(&bank_file_name);
        if !bank_file_path.exists() {
            return Err(format!("Bank file not found: {}", bank_id));
        }
    }

    let mut bank_data = BankFile::from_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to read bank file: {:?}", e))?;

    let part_idx = part_id as usize;
    if part_idx >= 4 {
        return Err(format!("Invalid part ID: {} (must be 0-3)", part_id));
    }

    // Check if this part has valid saved data to reload from
    if bank_data.parts_saved_state[part_idx] != 1 {
        return Err("SAVE PART FIRST".to_string());
    }

    println!("[DEBUG] Reloading part {} (copying saved to unsaved)", part_idx);

    // Copy the saved part back to unsaved part
    bank_data.parts.unsaved.0[part_idx] = bank_data.parts.saved.0[part_idx].clone();

    // Clear the edited bit for this part since we just reloaded it
    bank_data.parts_edited_bitmask &= !(1 << part_idx);

    println!("[DEBUG] parts_edited_bitmask after reload: {}", bank_data.parts_edited_bitmask);

    bank_data.checksum = bank_data.calculate_checksum()
        .map_err(|e| format!("Failed to calculate checksum: {:?}", e))?;

    bank_data.to_data_file(&bank_file_path)
        .map_err(|e| format!("Failed to write bank file: {:?}", e))?;

    println!("[DEBUG] Part {} reloaded successfully", part_idx);

    // Read all parts data and return the specific part
    let response = read_parts_data(project_path, bank_id)?;
    response.parts.into_iter()
        .find(|p| p.part_id == part_id)
        .ok_or_else(|| format!("Failed to find reloaded part {}", part_id))
}
