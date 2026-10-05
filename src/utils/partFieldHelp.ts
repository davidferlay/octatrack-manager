/**
 * What each Part parameter does, for the tooltip shown on hover.
 *
 * Wording is condensed from the Octatrack user guide's parameter reference, with the
 * practical notes that are easy to get wrong kept in - that SRC LEN at its default of 1
 * sounds like a stutter, that AMP HOLD includes the attack phase, that an LFO can only
 * modulate an LFO with a lower number.
 *
 * A field's text answers "what does this change"; its `values` answer "what does this
 * setting mean", and are only filled in where the device names its settings. A knob
 * running over a numeric range has nothing useful to say per value, so it has none.
 */

export interface FieldHelp {
  /** What the parameter does. */
  text: string;
  /** What each named setting means, keyed by the name the editor shows. */
  values?: Record<string, string>;
}

/* ---------------------------------------------------------------- SRC, per machine */

/** The six sample settings Static and Flex share, plus their setup page. */
const SAMPLE_SRC: Record<string, FieldHelp> = {
  'machine_params.ptch': {
    text: 'Playback pitch, in semitones. An octave either way; whole numbers are semitones.',
  },
  'machine_params.strt': {
    text: 'Where in the sample playback begins. Counts in 128ths of the sample, or in slices when SETUP SLIC is on. A start past the last slice selects the last one.',
  },
  'machine_params.len': {
    text: 'How much of the sample one trig plays. What it counts is set by SETUP LEN - slices, or 128ths. Left at its default of 1 it plays a sliver and sounds like a stutter.',
  },
  'machine_params.rate': {
    text: 'Playback speed. Zero does not play at all; negative values play backwards. Whether it also shifts pitch is set by SETUP RATE.',
  },
  'machine_params.rtrg': {
    text: 'How many times a trig retriggers the sample. INF retriggers until the next trig.',
  },
  'machine_params.rtim': {
    text: 'Time between retrigs, relative to one sequencer step.',
  },
  'machine_setup.xloop': {
    text: 'Master loop mode for the track, overriding what each sample carries.',
    values: {
      OFF: 'the sample plays once and stops, however long the pattern is',
      AUTO: "each sample follows its own loop setting from the audio editor - the device's default",
      ON: 'the sample repeats for as long as the pattern runs',
      PIPO: 'ping-pong: forwards, then backwards, then forwards',
    },
  },
  'machine_setup.slic': {
    text: 'Whether MAIN STRT selects slices or counts in 128ths of the sample.',
    values: { OFF: 'STRT counts in 128ths', ON: 'STRT selects a slice' },
  },
  'machine_setup.len': {
    text: 'What MAIN LEN counts.',
    values: {
      OFF: 'LEN does nothing; the sample plays to its end',
      TIME: 'LEN counts in 128ths of the sample, or of the slice when SLIC is on',
      SLIC: 'LEN counts whole slices - 2 plays two slices per trig',
    },
  },
  'machine_setup.rate': {
    text: 'Whether MAIN RATE changes pitch along with speed.',
    values: {
      PTCH: 'speed and pitch move together, as on tape',
      TSTR: 'timestretch holds the pitch while the speed changes',
    },
  },
  'machine_setup.tstr': {
    text: 'Timestretch algorithm, which is what keeps a sample in time with the project tempo.',
    values: {
      OFF: 'no stretching - the sample plays at the tempo it was recorded at',
      AUTO: 'each sample follows its own setting from the audio editor',
      NORM: 'for material that is not rhythmic',
      BEAT: 'for rhythmic material; uses transient detection, tuned by TSNS',
    },
  },
  'machine_setup.tsns': {
    text: 'Transient sensitivity for the BEAT timestretch algorithm. Higher is more sensitive.',
  },
};

const THRU_SRC: Record<string, FieldHelp> = {
  'machine_params.in_ab': {
    text: 'Which of the AB inputs this track passes through.',
    values: {
      '-': 'ignore the AB inputs',
      'A B': 'stereo, A hard left and B hard right',
      A: 'input A only, in stereo',
      B: 'input B only, in stereo',
      'A+B': 'A and B summed',
    },
  },
  'machine_params.vol_ab': {
    text: 'Level of the signal taken from the AB inputs. The maximum boosts by 12 dB; the minimum mutes.',
  },
  'machine_params.in_cd': {
    text: 'Which of the CD inputs this track passes through.',
    values: {
      '-': 'ignore the CD inputs',
      'C D': 'stereo, C hard left and D hard right',
      C: 'input C only, in stereo',
      D: 'input D only, in stereo',
      'C+D': 'C and D summed',
    },
  },
  'machine_params.vol_cd': {
    text: 'Level of the signal taken from the CD inputs. The maximum boosts by 12 dB; the minimum mutes.',
  },
};

const PICKUP_SRC: Record<string, FieldHelp> = {
  'machine_params.ptch': {
    text: 'Playback pitch of the loop, in semitones. Must be left at 0 for overdubbing and replacing to work.',
  },
  'machine_params.dir': {
    text: 'Playback direction of the loop.',
  },
  'machine_params.len': {
    text: 'Length of a slave loop relative to the master loop. Only used while recording a new slave loop; it does nothing for the master loop, which is the one recorded first.',
  },
  'machine_params.gain': {
    text: 'Cuts or boosts the level of recordings and overdubs, in dB. This is what makes gradual fade-outs possible.',
  },
  'machine_params.op': {
    text: 'What the Pickup machine does when you record.',
    values: {
      GAIN: 'no recording at all - only the volume changes GAIN dictates, applied to the loop already there',
      DUB: 'overdub on top of the loop, at the level GAIN sets',
    },
  },
  'machine_setup.tstr': {
    text: 'Master timestretch setting for the track. A Pickup machine cannot turn timestretch off.',
    values: {
      AUTO: 'each sample follows its own setting from the audio editor',
      NORM: 'for material that is not rhythmic',
      BEAT: 'for rhythmic material',
    },
  },
  'machine_setup.tsns': {
    text: 'Transient sensitivity for the BEAT timestretch algorithm. Higher is more sensitive.',
  },
};

/* ------------------------------------------------------------------------- AMP page */

const ENVELOPE_TRIG_VALUES: Record<string, string> = {
  ANLG: 'starts from the level the envelope is already at, when a sample trig lands',
  RTRG: 'starts from zero on every sample trig, cutting the one before it',
  'R+T': 'starts from zero on a sample trig or a trigless trig',
  TTRG: 'starts from the current level on a sample trig or a trigless trig',
};

const AMP: Record<string, FieldHelp> = {
  atk: {
    text: 'How long the amplitude envelope takes to reach full level, as a fraction of the sample.',
  },
  hold: {
    text: 'How long the signal is held at full level, in sequencer steps. The attack is counted inside the hold, so hold is usually set longer than attack. INF holds until the next trig.',
  },
  rel: {
    text: 'How long the signal takes to fade out once the envelope is released.',
  },
  vol: {
    text: 'Track volume before the effects. Affects the main and cue outputs alike, and is separate from the TRK level in the header.',
  },
  bal: {
    text: 'Position in the stereo field, left to right.',
  },
  amp_setup_amp: {
    text: 'How one amplitude envelope behaves when it lands on top of another. Starting from zero cuts cleanly but can click; starting from the current level is smoother but can swallow the attack.',
    values: ENVELOPE_TRIG_VALUES,
  },
  amp_setup_sync: {
    text: 'Whether the amplitude envelope is synced to the project tempo.',
  },
  amp_setup_atck: {
    text: 'Shape of the attack.',
    values: { LIN: 'linear', LOG: 'exponential, which gives a smoother fade in' },
  },
  amp_setup_fx1: {
    text: 'How this envelope drives the effect in FX1 - the filter envelope for a multi mode filter, the phase for the lo-fi amplitude modulator. It does nothing for any other effect.',
    values: ENVELOPE_TRIG_VALUES,
  },
  amp_setup_fx2: {
    text: 'How this envelope drives the effect in FX2 - the filter envelope for a multi mode filter, the phase for the lo-fi amplitude modulator. It does nothing for any other effect.',
    values: ENVELOPE_TRIG_VALUES,
  },
};

/* ------------------------------------------------------------------------- LFO page */

const LFO_TRIG_VALUES: Record<string, string> = {
  FREE: 'runs continuously, never restarting or stopping',
  TRIG: 'restarts on a sample trig, then runs on until the next one',
  HOLD: 'runs free, but its output is latched at each sample trig and held until the next',
  ONE: 'restarts on a sample trig, runs one cycle, stops',
  HALF: 'restarts on a sample trig, runs half a cycle, stops',
  'SYNC TRIG': 'restarts when the track starts and every time the pattern loops',
  'SYNC ONE': 'restarts when the track starts, then runs one cycle',
  'SYNC HALF': 'restarts when the track starts, then runs half a cycle',
};

const LFO_PMTR: FieldHelp = {
  text: 'Which parameter this LFO modulates. Only MAIN page parameters can be modulated. An LFO can modulate another LFO only if that one has a lower number, so LFO 3 can drive LFO 1 and 2, and LFO 2 can drive LFO 1.',
};
const LFO_WAVE: FieldHelp = {
  text: 'Shape of the LFO. Eleven fixed waveforms, plus the eight T1-T8 shapes drawn on the DESIGN page.',
};
const LFO_MULT: FieldHelp = { text: 'Multiplies SPD, so one LFO can run from very slow to very fast.' };
const LFO_TRIG: FieldHelp = { text: 'What the LFO does when a sample is trigged.', values: LFO_TRIG_VALUES };
const LFO_SPD: FieldHelp = {
  text: 'Base speed of the LFO, always synced to the project tempo. 16, 32 and 64 land on straight beats. MULT scales this.',
};
const LFO_DEP: FieldHelp = {
  text: 'How much modulation reaches the target. At 127 the target can be driven to either extreme; with the target at its centre, 64 already reaches both ends.',
};

const LFO: Record<string, FieldHelp> = {};
for (const n of [1, 2, 3]) {
  const page = {
    [`lfo${n}_pmtr`]: LFO_PMTR,
    [`lfo${n}_wave`]: LFO_WAVE,
    [`lfo${n}_mult`]: LFO_MULT,
    [`lfo${n}_trig`]: LFO_TRIG,
    [`spd${n}`]: LFO_SPD,
    [`dep${n}`]: LFO_DEP,
  };
  Object.assign(LFO, page);
  // A MIDI track's LFOs are looked up under their own section, and work the same way -
  // the user guide sends the reader to the audio LFO pages for them
  for (const [key, help] of Object.entries(page)) LFO[`midi_lfos.${key}`] = help;
}

/* -------------------------------------------------------------- Track recorder page */

const RECORDER: Record<string, FieldHelp> = {
  'recorders.in_ab': {
    text: 'Which of the AB inputs the recorder samples. A source left at - records silence if you sample from it.',
    values: {
      '-': 'ignore the AB inputs',
      'A B': 'stereo, A hard left and B hard right',
      A: 'input A only, captured in stereo',
      B: 'input B only, captured in stereo',
      'A+B': 'A and B summed',
    },
  },
  'recorders.in_cd': {
    text: 'Which of the CD inputs the recorder samples. A source left at - records silence if you sample from it.',
    values: {
      '-': 'ignore the CD inputs',
      'C D': 'stereo, C hard left and D hard right',
      C: 'input C only, captured in stereo',
      D: 'input D only, captured in stereo',
      'C+D': 'C and D summed',
    },
  },
  'recorders.rlen': {
    text: 'How long the recorder samples for, in sequencer steps at the project tempo. It ignores the track scale, so 16 is always sixteen 16ths. MAX samples for as long as the reserved memory allows.',
  },
  'recorders.trig': {
    text: 'How the sampling process is started and stopped.',
    values: {
      ONE: 'samples for the length RLEN sets; pressing the key again restarts it',
      ONE2: 'samples for the length RLEN sets, and pressing the key again stops it early',
      HOLD: 'samples for as long as the key is held, up to the length RLEN sets',
    },
  },
  'recorders.src3': {
    text: 'Which internal source the recorder samples. It also decides what a sample trig plays when it shares a step with a recorder trig: at - the trig plays what is being recorded right then, otherwise it plays what the previous trig recorded.',
    values: {
      '-': 'no internal source',
      MAIN: 'the mix going to the main outputs',
      CUE: 'the mix going to the cue outputs',
    },
  },
  'recorders.xloop': {
    text: 'Whether the captured sample loops when it is played back.',
  },
  'recorders.fin': {
    text: 'Fade in applied as recording starts, in sequencer steps. Even a very short one keeps a looping recording from clicking.',
  },
  'recorders.fout': {
    text: 'Fade out applied after recording stops, in sequencer steps, and added to the length - 16 steps recorded with FOUT 2 gives an 18 step sample. For a Pickup machine it is applied to the start of the loop instead.',
  },
  'recorders.ab': {
    text: 'Monitoring level for the AB inputs. Only used by a Pickup machine. The signal runs through the track, so the track effects and output routing apply to it.',
  },
  'recorders.cd': {
    text: 'Monitoring level for the CD inputs. Only used by a Pickup machine. The signal runs through the track, so the track effects and output routing apply to it.',
  },
  'recorders.qrec': {
    text: 'Quantises the start of manual and Pickup machine sampling.',
    values: {
      OFF: 'no quantisation - recording starts at once',
      PLEN: 'recording starts when the pattern has played its full length',
    },
  },
  'recorders.qpl': {
    text: 'Quantises manual trigging of the recorder buffer. It has no effect on recorder trigs placed in the sequencer. This is the same setting as QUANTIZED TRIG in the audio editor.',
    values: {
      OFF: 'playback starts at once',
      PLEN: 'playback starts when the pattern has played its full length',
    },
  },
};

/* --------------------------------------------------------------------- MIDI tracks */

const MIDI: Record<string, FieldHelp> = {
  'midi_notes.note': { text: 'Root note the track sends.' },
  'midi_notes.vel': { text: 'Velocity of the notes sent. Zero is a note off.' },
  'midi_notes.len': {
    text: 'How long a note lasts before a note off is sent; the maximum is infinite. It also caps an arpeggio, which is cut off when the time is up.',
  },
  'midi_notes.not2': {
    text: 'A second note, offset from the root in semitones, so the track can send a chord. It transposes with the root. Zero removes it.',
  },
  'midi_notes.not3': {
    text: 'A third note, offset from the root in semitones. It transposes with the root. Zero removes it.',
  },
  'midi_notes.not4': {
    text: 'A fourth note, offset from the root in semitones. It transposes with the root. Zero removes it.',
  },
  'midi_notes.chan': { text: 'MIDI channel the track sends on.' },
  'midi_notes.bank': {
    text: 'Bank change message (MSB) sent whenever a pattern on another Part becomes active. Off sends none.',
  },
  'midi_notes.prog': {
    text: 'Program change message sent whenever a pattern on another Part becomes active. Off sends none.',
  },
  'midi_notes.sbnk': {
    text: 'Sub-bank change message (LSB) sent whenever a pattern on another Part becomes active. Off sends none.',
  },
  'midi_arps.tran': {
    text: 'Transposes the arpeggio in semitones. It transposes the track note trigs too, even with MODE off.',
  },
  'midi_arps.leg': {
    text: 'Legato. Affects the track note trigs even with MODE off.',
    values: {
      ON: 'overlapping notes play legato, releasing the old note after the new one, and NLEN sets the length',
      OFF: 'a note off is sent before each arpeggiated note',
    },
  },
  'midi_arps.mode': {
    text: 'Turns the arpeggiator on and sets the order the notes play in.',
    values: {
      OFF: 'arpeggiator off',
      TRUE: 'in the order the notes were entered',
      UP: 'low to high, per octave',
      DOWN: 'high to low, per octave',
      CYCL: 'up then down',
      SHFL: 'shuffled, a new order once every octave range is through',
      RND: 'random',
    },
  },
  'midi_arps.spd': {
    text: 'Arpeggiator speed, synced to the project tempo. 6 is sixteenth notes, 12 is eighths.',
  },
  'midi_arps.rnge': {
    text: 'Octave range. Each finished cycle transposes the notes an octave up until the range is reached, then it starts over.',
  },
  'midi_arps.nlen': { text: 'Length of the arpeggiated notes.' },
  'midi_arps.len': { text: 'Length of the arpeggio, up to sixteen steps.' },
  'midi_arps.key': {
    text: 'Forces the arpeggiated notes and their offsets into a key. Affects the track note trigs even with MODE off. Off lets every note play as set.',
  },
  'midi_ctrl1s.pb': { text: 'Pitch bend value the track sends.' },
  'midi_ctrl1s.at': { text: 'Aftertouch value the track sends.' },
};
for (const n of [1, 2, 3, 4]) {
  MIDI[`midi_ctrl1s.cc${n}`] = {
    text: `Value sent for the CC number set as CC${n}# on the CTRL 1 SETUP page.`,
  };
  MIDI[`midi_ctrl1s.cc${n}_num`] = { text: `Which CC number CC${n} sends on.` };
}
for (const n of [5, 6, 7, 8, 9, 10]) {
  MIDI[`midi_ctrl2s.cc${n}`] = {
    text: `Value sent for the CC number set as CC${n}# on the CTRL 2 SETUP page.`,
  };
  MIDI[`midi_ctrl2s.cc${n}_num`] = { text: `Which CC number CC${n} sends on.` };
}

/* ------------------------------------------------------------------- Effect pages */

/**
 * Effect parameters, by the effect's stored value and the label the knob carries.
 *
 * Keyed on the label rather than the slot number because an effect's page has gaps:
 * the label is what the person is hovering over, and it is unique within one effect.
 */
const FX: Record<number, Record<string, string>> = {
  // 12/24 dB multi mode filter
  4: {
    BASE: 'Base cutoff frequency. Sweeping this with WDTH at maximum makes the filter act as a high pass.',
    WDTH: 'Distance between the low pass and the high pass cutoff. Sweeping this with BASE at minimum makes the filter act as a low pass.',
    Q: 'Resonance at the cutoff frequencies.',
    DPTH: 'How far the filter envelope moves the cutoff. Negative values invert the envelope.',
    ATK: 'Attack time of the filter envelope.',
    DEC: 'Decay time of the filter envelope.',
    HP: 'High pass slope, 12 dB or 24 dB.',
    LP: 'Low pass slope, 12 dB or 24 dB.',
    ENV: 'Which cutoff the filter envelope moves.',
    HOLD: "Whether the filter envelope follows the AMP MAIN page's HOLD.",
    DIST: 'Headroom of the filter. The higher the value, the less headroom, so the more it overloads.',
  },
  // Spatializer
  5: {
    INP: 'Gain of the dry signal.',
    DPTH: 'Depth of the widened signal. Works together with WDTH.',
    WDTH: 'Amount of stereo spread. Works together with DPTH.',
    HP: 'High pass cutoff for the widened signal.',
    LP: 'Low pass cutoff for the widened signal.',
    SEND: 'Level of the widened signal.',
    PHSE: 'Reverses the phase of the wet signal, for neither channel, the left, the right, or both.',
    'M/S': 'Turns the MG and SG controls on and off.',
    MG: 'Mid gain.',
    SG: 'Side gain.',
  },
  // Echo freeze delay
  8: {
    TIME: 'Delay time, measured in 256th notes and relative to the tempo unless SYNC is off. 6 is a 1/16, 12 a 1/8, 24 a 1/4.',
    FB: 'How much of the delay output is fed back in, so how many echoes there are. 127 repeats indefinitely.',
    VOL: 'Main volume of the delay output.',
    BASE: 'High pass filtering of the signal coming out of the feedback loop.',
    WDTH: 'Low pass filtering of the feedback loop, relative to BASE.',
    SEND: 'How much of the track is sent into the delay.',
    X: 'Whether the delay works as a ping-pong delay.',
    TAPE: 'ON interpolates between delay times when TIME is changed, the way a tape echo bends. OFF jumps.',
    DIR: 'How much dry signal is mixed in with the delay. At minimum only the delay is heard.',
    SYNC: 'Whether the delay time follows the tempo.',
    LOCK: 'Freezes the delay buffer so it works as a repeater. With FB at 127 and SEND at 0 the buffer repeats indefinitely.',
    PASS: 'How the dry signal is routed while LOCK is on. 0 leaves only the buffer, which is what a repeater wants; 1 mixes dry back in.',
  },
  // 2-band parametric EQ
  12: {
    FRQ1: 'Centre frequency of the first band.',
    GN1: 'Cut or boost at the first band.',
    Q1: 'Width of the first band. Higher is narrower.',
    FRQ2: 'Centre frequency of the second band.',
    GN2: 'Cut or boost at the second band.',
    Q2: 'Width of the second band. Higher is narrower.',
    TYP1: 'How the first band works: low shelf, full parametric, or high shelf.',
    TYP2: 'How the second band works: low shelf, full parametric, or high shelf.',
  },
  // DJ style kill EQ
  13: {
    'LS F': 'Frequency of the low shelf filter.',
    'HS F': 'Frequency of the high shelf filter.',
    LOWG: 'Gain of the low band. Maximum boosts by 12 dB; minimum kills the band outright.',
    MIDG: 'Gain of the mid band. Maximum boosts by 12 dB; minimum kills the band outright.',
    'HI G': 'Gain of the high band. Maximum boosts by 12 dB; minimum kills the band outright.',
  },
  // 2-10 stage phaser
  16: {
    CNTR: 'Centre phase of the phase modulation.',
    DEP: 'Depth of the phase modulation.',
    SPD: 'Speed of the phase depth modulation.',
    FB: 'Feedback of the original signal.',
    WID: 'Stereo width of the affected signal.',
    MIX: 'Balance between the dry signal and the phased one.',
    NUM: 'How many phaser stages are used, from two to ten.',
  },
  // Flanger
  17: {
    DEL: 'Amount of delay applied to the flanged signal.',
    DEP: 'Depth of the flanger.',
    SPD: 'Speed of the flanger.',
    FB: 'Feedback of the original signal.',
    WID: 'Stereo width of the affected signal.',
    MIX: 'Balance between the dry signal and the flanged one.',
  },
  // 2-10 tap chorus
  18: {
    DEL: 'Delay time of the taps.',
    DEP: 'Depth of the modulation of the chorus taps.',
    SPD: 'Modulation speed of the taps.',
    FB: 'Feedback of the delay taps.',
    WID: 'Stereo width of the chorus output.',
    MIX: 'Balance between the dry signal and the chorused one.',
    TAPS: 'How many chorus taps are used, from two to ten.',
    FBLP: 'Low pass filtering of the feedback signal.',
  },
  // Comb filter
  19: {
    PTCH: 'Resonant frequency of the comb, which is the note it rings on.',
    TUNE: 'Fine tuning, up to two semitones either way.',
    LP: 'Low pass cutoff inside the feedback signal.',
    FB: 'Gain of the feedback signal, so how long and how hard it rings.',
    MIX: 'Balance between the dry signal and the wet one.',
  },
  // Gatebox plate reverb
  20: {
    TIME: 'Decay time: how long the reverb stays around before dying out.',
    DAMP: 'Damping, the effect of soft walls. Higher makes the sound die faster.',
    GATE: 'Gate time. The reverb is gated after this long if the level is low. At maximum the gate is off.',
    HP: 'High pass filtering of the reverb signal.',
    LP: 'Low pass filtering of the reverb signal.',
    MIX: 'Balance between the dry signal and the reverb. With MIXF set to SEND it works as an aux send instead.',
    GVOL: 'Threshold volume of the gated signal.',
    BAL: 'Left to right balance of the reverb.',
    MONO: 'Narrows the reverb from stereo to mono.',
    MIXF: 'Whether the MAIN page MIX acts as a mix control or as an aux send.',
  },
  // Spring reverb
  21: {
    TIME: 'Decay time of the springs.',
    HP: 'High pass cutoff of the springs.',
    LP: 'Low pass cutoff of the springs.',
    MIX: 'Balance between the dry signal and the reverb.',
    TYPE: 'Which spring, in three steps from slightly transparent to properly springy.',
    BAL: 'Left to right balance of the reverb.',
  },
  // Dark reverb
  22: {
    TIME: 'Decay time of the reverb.',
    SHVG: 'Damping above the shelving frequency SHVF sets. At maximum the treble stays in the tail; lowering it damps the treble away.',
    SHVF: 'Frequency of the shelving filter inside the reverb. With SHVG it is what makes the tail darker.',
    HP: 'High pass cutoff on the incoming signal.',
    LP: 'Low pass cutoff on the incoming signal.',
    MIX: 'Balance between the dry signal and the reverb. With MIXF set to SEND it works as an aux send instead.',
    PRE: 'Pre-delay: a short gap before the signal reaches the reverb.',
    BAL: 'Left to right balance of the reverb.',
    MONO: 'Narrows the reverb from stereo to mono.',
    MIXF: 'Whether the MAIN page MIX acts as a mix control or as an aux send.',
  },
  // Dynamix compressor
  24: {
    ATK: 'Attack time, 0.5 ms to 100 ms.',
    REL: 'Release time, 50 ms to 5 s.',
    THRS: 'Knee threshold: the level above which compression starts.',
    RAT: 'Compression ratio, from 1:1 to 1:255.',
    GAIN: 'Output level of the compressor, to make up what the compression took away.',
    MIX: 'Balance between the uncompressed signal and the compressed one, which is how parallel compression is done.',
    RMS: 'What the compressor reacts to. Zero watches for amplitude peaks; the maximum follows the overall energy of the signal.',
  },
  // Lo-fi collection
  28: {
    DIST: 'Signal overload distortion.',
    AMF: 'Modulation frequency of the amplitude modulator, which is a volume control driven by an oscillator. High settings change the timbre drastically.',
    SRR: 'Amount of sample rate reduction.',
    BRR: 'Amount of bit rate reduction.',
    AMD: 'Modulation depth of the amplitude modulator.',
    AMPH: 'Start phase of the amplitude modulation, in degrees. 90 starts high, 270 starts low.',
  },
};

/* --------------------------------------------------------------------------- lookup */

const SRC_BY_MACHINE: Record<string, Record<string, FieldHelp>> = {
  Static: SAMPLE_SRC,
  Flex: SAMPLE_SRC,
  Thru: THRU_SRC,
  Pickup: PICKUP_SRC,
  // A Neighbor machine has no parameters of its own - it listens to the track before it
  Neighbor: {},
};

const SHARED: Record<string, FieldHelp> = { ...AMP, ...LFO, ...RECORDER, ...MIDI };

/**
 * What to say about this field, or undefined when nothing has been written for it.
 *
 * `fxType` is the effect loaded in the slot, which is what decides an FX knob's meaning
 * - the same slot is TIME on a reverb and DEL on a flanger.
 */
export function fieldHelp(
  field: string,
  machineType?: string,
  ctx?: { label?: string; fxType?: number },
): FieldHelp | undefined {
  if (field.startsWith('machine_')) {
    return SRC_BY_MACHINE[machineType ?? '']?.[field];
  }
  if (/^fx[12]_(param|setup)[1-6]$/.test(field)) {
    const text = ctx?.fxType === undefined ? undefined : FX[ctx.fxType]?.[ctx.label ?? ''];
    return text ? { text } : undefined;
  }
  return SHARED[field];
}

/**
 * The tooltip text: what the parameter does, then what each named setting means.
 *
 * The settings are listed in full rather than only the current one, because the reason
 * to hover is usually to find out which one to pick.
 */
export function helpTitle(
  label: string,
  help: FieldHelp | undefined,
  extra?: string,
): string | undefined {
  if (!help) return extra;
  const lines = [`${label} - ${help.text}`];
  for (const [name, meaning] of Object.entries(help.values ?? {})) {
    lines.push(`${name}: ${meaning}`);
  }
  if (extra) lines.push(extra);
  return lines.join('\n');
}
