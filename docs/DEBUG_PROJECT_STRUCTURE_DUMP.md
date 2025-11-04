# Debug Output - Project Structure Dump

This file contains a sample debug output from loading an Octatrack project using the ot-tools-io library. This serves as a reference for understanding the complete data structure available from project files.

## Date Generated
2025-11-05

## Source
Output from `npm run tauri:dev` when loading a project file.

## Complete Project Structure

```
Project structure: ProjectFile {
  metadata: OsMetadata {
    filetype: "OCTATRACK DPS-1 PROJECT",
    project_version: 19,
    os_version: "R0177     1.40B"
  },

  settings: Settings {
    write_protected: false,

    control: ControlMenu {
      audio: AudioControlPage {
        master_track: false,
        cue_studio_mode: false
      },

      input: InputControlPage {
        gate_ab: 127,
        gate_cd: 127,
        input_delay_compensation: false
      },

      sequencer: SequencerControlPage {
        pattern_change_chain_behaviour: 12,
        pattern_change_auto_silence_tracks: false,
        pattern_change_auto_trig_lfos: false
      },

      midi_sequencer: MidiSequencerControlPage,

      memory: MemoryControlPage {
        load_24bit_flex: true,
        dynamic_recorders: true,
        record_24bit: true,
        reserved_recorder_count: 8,
        reserved_recorder_length: 0
      },

      metronome: MetronomeControlPage {
        metronome_time_signature: 3,
        metronome_time_signature_denominator: 2,
        metronome_preroll: 0,
        metronome_cue_volume: 32,
        metronome_main_volume: 45,
        metronome_pitch: 12,
        metronome_tonal: true,
        metronome_enabled: false
      },

      midi: MidiSubMenu {
        control: MidiControlMidiPage {
          midi_audio_track_cc_in: false,
          midi_audio_track_cc_out: 1,
          midi_audio_track_note_in: 0,
          midi_audio_track_note_out: 1,
          midi_midi_track_cc_in: 1
        },

        sync: MidiSyncMidiPage {
          midi_clock_send: false,
          midi_clock_receive: false,
          midi_transport_send: true,
          midi_transport_receive: false,
          midi_progchange_send: false,
          midi_progchange_send_channel: Disabled,
          midi_progchange_receive: false,
          midi_progchange_receive_channel: Disabled
        },

        channels: MidiChannelsMidiPage {
          midi_trig_ch1: -1,
          midi_trig_ch2: -1,
          midi_trig_ch3: -1,
          midi_trig_ch4: -1,
          midi_trig_ch5: -1,
          midi_trig_ch6: -1,
          midi_trig_ch7: -1,
          midi_trig_ch8: -1,
          midi_auto_channel: -1
        }
      }
    },

    midi_soft_thru: false,

    mixer: MixerMenu {
      gain_ab: 64,
      gain_cd: 64,
      dir_ab: 0,
      dir_cd: 0,
      phones_mix: 64,
      main_to_cue: 0,
      main_level: 57,
      cue_level: 64
    },

    tempo: TempoMenu {
      tempo: 100,
      pattern_tempo_enabled: true
    },

    midi_tracks_trig_mode: MidiTrackTrigModes {
      trig_mode_midi_track_1: 0,
      trig_mode_midi_track_2: 0,
      trig_mode_midi_track_3: 0,
      trig_mode_midi_track_4: 0,
      trig_mode_midi_track_5: 0,
      trig_mode_midi_track_6: 0,
      trig_mode_midi_track_7: 0,
      trig_mode_midi_track_8: 0
    }
  },

  states: State {
    bank: 0,
    pattern: 3,
    arrangement: 0,
    arrangement_mode: 0,
    part: 0,
    track: 7,
    track_othermode: 7,
    scene_a_mute: true,
    scene_b_mute: false,
    track_cue_mask: 0,
    track_mute_mask: 59,
    track_solo_mask: 0,
    midi_track_mute_mask: 0,
    midi_track_solo_mask: 0,
    midi_mode: 0
  },

  slots: SlotsAttributes {
    static_slots: Array([
      Some(SlotAttributes {
        slot_type: Static,
        slot_id: 1,
        path: Some("LS_FX_07.wav"),
        timestrech_mode: Normal,
        loop_mode: Off,
        trig_quantization_mode: Direct,
        gain: 48,
        bpm: 2880
      }),
      Some(SlotAttributes {
        slot_type: Static,
        slot_id: 2,
        path: Some("SD_Reverse_CD.wav"),
        timestrech_mode: Off,
        loop_mode: Off,
        trig_quantization_mode: Direct,
        gain: 48,
        bpm: 2880
      }),
      None,
      None,
      Some(SlotAttributes {
        slot_type: Static,
        slot_id: 5,
        path: Some("DRT_808_Open_Hat_01.wav"),
        timestrech_mode: Off,
        loop_mode: Off,
        trig_quantization_mode: Direct,
        gain: 48,
        bpm: 2880
      }),
      None,
      None,
      Some(SlotAttributes {
        slot_type: Static,
        slot_id: 8,
        path: Some("SD_Reverse_Classic.wav"),
        timestrech_mode: Normal,
        loop_mode: Off,
        trig_quantization_mode: Direct,
        gain: 48,
        bpm: 2880
      }),
      // ... additional static slots (1-128) ...
    ]),

    flex_slots: Array([
      None,
      None,
      // ... (slots 1-32 are None) ...
      Some(SlotAttributes {
        slot_type: Flex,
        slot_id: 33,
        path: Some("SPMV_138_A#_Gated_Voice_02_(Wet).wav"),
        timestrech_mode: Normal,
        loop_mode: Normal,
        trig_quantization_mode: Direct,
        gain: 48,
        bpm: 2880
      }),
      // ... additional flex slots (1-64) ...
    ])
  }
}
```

## Key Observations

### Metadata
- **OS Version**: R0177 1.40B
- **Project Version**: 19
- **File Type**: OCTATRACK DPS-1 PROJECT

### Settings Available
1. **Control Settings**:
   - Audio control (master track, cue mode)
   - Input control (gate levels, delay compensation)
   - Sequencer control (pattern change behavior)
   - Memory control (24-bit options, recorder settings)
   - Metronome control (time signature, volume, pitch)
   - MIDI settings (CC, sync, transport, channels)

2. **Mixer Settings**:
   - Gain AB/CD: 64
   - Direct AB/CD: 0
   - Phones Mix: 64
   - Main Level: 57
   - Cue Level: 64

3. **Tempo Settings**:
   - Tempo: 100 BPM
   - Pattern tempo enabled: true

### Current State
- **Bank**: 0 (Bank A)
- **Pattern**: 3 (Pattern 4, 0-indexed)
- **Part**: 0 (Part 1)
- **Track**: 7 (Track 8)
- **Track Mute Mask**: 59 (binary: 00111011)
  - Tracks muted: T1, T2, T4, T5, T6
  - Tracks unmuted: T3, T7, T8

### Sample Slots
- **Static Slots**: 128 total slots available
  - Sparse allocation (not all slots filled)
  - Contains drum samples, FX samples, and loops

- **Flex Slots**: 64 total slots available
  - First 32 slots empty in this example
  - Contains vocal samples and longer audio files

### Sample Slot Attributes
Each slot (when populated) contains:
- `slot_type`: Static or Flex
- `slot_id`: Numeric ID (1-128 for static, 1-64 for flex)
- `path`: File path (relative to project audio folder)
- `timestrech_mode`: Off, Normal, Beat
- `loop_mode`: Off, Normal
- `trig_quantization_mode`: Direct, Pattern, etc.
- `gain`: 0-127 (48 = neutral/0dB)
- `bpm`: Internal BPM value (2880 = no timestretch)

## Notes

### Time Signature Calculation
- `metronome_time_signature: 3` → numerator = 3 + 1 = 4
- `metronome_time_signature_denominator: 2` → denominator = 2^2 = 4
- Result: 4/4 time signature

### Mute/Solo Masks
The track mute/solo states are stored as bit masks:
- Bit 0 = Track 1
- Bit 1 = Track 2
- ...
- Bit 7 = Track 8

### BPM Values in Slots
The `bpm` field in slot attributes:
- 2880 = neutral (no timestretch applied)
- Other values indicate timestretch is active

## Use Cases

This debug output is useful for:
1. Understanding the complete structure of project files
2. Identifying available data fields for UI display
3. Planning future features that utilize deeper project data
4. Debugging data extraction issues
5. Verifying that the ot-tools-io library is parsing data correctly
