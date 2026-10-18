//! `.ot` sample-settings files next to imported audio.
//!
//! A `.ot` sits next to its audio with the same stem (`amen.wav` + `amen.ot`) and holds trim,
//! loop point, up to 64 slices (all in sample frames), tempo, gain, timestretch, loop mode and
//! trig quantisation. The Octatrack reads it when the sample is loaded into a slot, whether the
//! sample sits in the project folder or in the Audio Pool (both checked on our own hardware, in
//! Testing/ot-import-test). It copies the values into the slot, which is what plays from then
//! on. A `.ot` reaching past the end of its audio is still applied, cut to the audio's length.
//!
//! Ported from OT Slots (`otfile.rs`, GPLv3 like this app), with the rules checked on our own
//! Octatrack (Testing/ot-import-test) and card copies:
//! - `[SAMPLE]`: `BPMx24=<tempo>` when the tempo has priority, `TRIM_BARSx100=<trim_bar_len>` when
//!   the trim length has it - byte 22 of the `.ot`, 0 or 1, whatever the timestretch mode - then
//!   `TSMODE`, `LOOPMODE`, `GAIN`, `TRIGQUANTIZATION` (255 is written as -1). The `.ot` tempo is
//!   already BPM x 24, and one outside 720..=7200 is moved to the nearest bound.
//! - markers: the `.ot`'s trim, loop point, all 64 slice entries as stored, and the count.

use ot_tools_io::slices::SLICE_LOOP_POINT_DISABLED;
use ot_tools_io::types::SlotMarkers;
use ot_tools_io::{HasChecksumField, OctatrackFileIO, SampleSettingsFile};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// How far past the audio's end a `.ot` position may be before the `.ot` counts as the wrong
/// one (rounding in other tools); positions inside the margin are clamped.
pub const END_MARGIN: u64 = 16;
const TEMPO_MIN: u32 = 720;
const TEMPO_MAX: u32 = 7200;
const OT_RATE: u32 = 44_100;

/// What happened to the `.ot` of one imported file.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OtOutcome {
    /// Copied as it was: the audio kept its sample rate.
    Copied,
    /// Copied with every position moved to the 44.1 kHz grid of the converted audio.
    Rescaled,
    /// Not copied: unreadable or invalid.
    Refused,
    /// The new audio has no `.ot`, so the one left from the file it replaced was backed up and
    /// removed - it described audio that is gone.
    Removed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OtCarry {
    /// The imported audio's file name in the project.
    pub audio: String,
    /// The `.ot`'s file name (the source's for Refused, the removed one for Removed).
    pub ot: String,
    pub outcome: OtOutcome,
    /// The source sample rate, for Rescaled.
    pub from_rate: Option<u32>,
    /// Why, for Refused.
    pub reason: Option<String>,
    /// An older `.ot` next to the audio was backed up before being replaced.
    pub replaced: bool,
    /// Positions past the end of the audio were cut to its length, as the device does.
    pub clamped: bool,
}

/// A slot assigned with a project-folder `.ot` next to its audio.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct OtApplied {
    pub slot_index: u16,
    pub ot: String,
    pub slices: u32,
    /// Positions past the end of the audio were cut to its length, as the device does.
    pub clamped: bool,
    /// Why the `.ot` was not used; the slot then got what a plain sample gets.
    pub error: Option<String>,
}

/// The `.ot` next to an audio file: same stem, any case. Hidden files (macOS `._` junk) are
/// not companions.
pub fn companion(audio: &Path) -> Option<PathBuf> {
    let stem = audio.file_stem()?.to_string_lossy().to_lowercase();
    let mut found: Vec<PathBuf> = std::fs::read_dir(audio.parent()?)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            !name.starts_with('.')
                && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ot"))
                && p.file_stem()
                    .is_some_and(|s| s.to_string_lossy().to_lowercase() == stem)
        })
        .collect();
    found.sort();
    found.into_iter().next()
}

/// Read a `.ot` and check it: checksum, gain, the three modes, trim, at most 64 slices, and
/// each used slice.
///
/// Not `SampleSettingsFile::validate()`: that requires every *unused* slice entry to be all
/// zeros, and real files often store them as (0, 0, no loop). It also refuses a tempo the
/// Octatrack simply moves into range, which is done here instead.
pub fn read_valid(path: &Path) -> Result<SampleSettingsFile, String> {
    use ot_tools_io::settings::{LoopMode, TimeStretchMode, TrigQuantizationMode};
    let name = name_of(path);
    let mut ot = SampleSettingsFile::from_data_file(path)
        .map_err(|e| format!("{name} can't be read ({e})"))?;
    let bad = |why: String| Err(format!("{name} isn't a valid .ot ({why})"));
    if !ot.check_checksum().unwrap_or(false) {
        return bad("bad checksum".into());
    }
    if ot.gain > 96 {
        return bad(format!("gain {}", ot.gain));
    }
    if LoopMode::try_from(ot.loop_mode).is_err()
        || TimeStretchMode::try_from(ot.stretch).is_err()
        || TrigQuantizationMode::try_from(ot.quantization as u32).is_err()
    {
        return bad("unknown loop, timestretch or quantisation mode".into());
    }
    if ot.trim_start > ot.trim_end {
        return bad(format!("trim {}..{}", ot.trim_start, ot.trim_end));
    }
    if ot.slices_len > 64 {
        return bad(format!("{} slices", ot.slices_len));
    }
    for (i, s) in ot.slices[..used(&ot)].iter().enumerate() {
        if let Err(e) = s.validate() {
            return bad(format!("slice {}: {e}", i + 1));
        }
    }
    let clamped = ot.tempo.clamp(TEMPO_MIN, TEMPO_MAX);
    if clamped != ot.tempo {
        ot.tempo = clamped;
        ot.checksum = ot.calculate_checksum().map_err(|e| e.to_string())?;
    }
    Ok(ot)
}

/// Does this `.ot` belong to audio of `frames` frames? Err says why not.
pub fn fits(ot: &SampleSettingsFile, frames: u64) -> Result<(), String> {
    let limit = frames + END_MARGIN;
    if ot.trim_end as u64 > limit {
        return Err(format!(
            "its trim end ({}) is past the end of the audio ({frames} frames)",
            ot.trim_end
        ));
    }
    for (i, s) in ot.slices[..used(ot)].iter().enumerate() {
        if s.trim_end as u64 > limit {
            return Err(format!(
                "slice {} ends at {}, past the end of the audio ({frames} frames)",
                i + 1,
                s.trim_end
            ));
        }
    }
    Ok(())
}

/// The `.ot` for audio resampled from `from_rate` to 44.1 kHz and now `new_frames` long: every
/// position x 44100 / rate, rounded, "no loop" kept, then clamped inside the audio. At 44.1 kHz
/// already, only the clamp applies.
pub fn rescale(ot: &SampleSettingsFile, from_rate: u32, new_frames: u64) -> SampleSettingsFile {
    let mut out = *ot;
    if from_rate != OT_RATE && from_rate > 0 {
        let r = |v: u32| -> u32 {
            if v == SLICE_LOOP_POINT_DISABLED {
                return v;
            }
            ((v as u64 * OT_RATE as u64 + from_rate as u64 / 2) / from_rate as u64)
                .min(u32::MAX as u64 - 1) as u32
        };
        out.trim_start = r(out.trim_start);
        out.trim_end = r(out.trim_end);
        out.loop_start = r(out.loop_start);
        let n = used(&out);
        for s in out.slices[..n].iter_mut() {
            s.trim_start = r(s.trim_start);
            s.trim_end = r(s.trim_end);
            s.loop_start = r(s.loop_start);
        }
    }
    clamp(&mut out, new_frames.min(u32::MAX as u64) as u32);
    out
}

/// The `[SAMPLE]` fields the Octatrack writes for a sample with this `.ot`, in the upper-case
/// keys `replace_sample_fields_surgical` takes. The one of BPMx24 / TRIM_BARSx100 that does not
/// apply is marked for deletion, so a slot reassigned over an older sample does not keep it.
///
/// Which one applies is the setting that has priority in the audio editor (the arrow next to
/// ORIGINAL TEMPO or TRIM LEN), stored in byte 22 - ot-tools-io's `unknown`. 1 is the trim
/// length: six recordings and AED_PROJD_OT on our cards got TRIM_BARSx100. 0 is the tempo:
/// every other device-assigned `.ot`, timestretched or not, got BPMx24.
pub fn slot_fields(ot: &SampleSettingsFile) -> HashMap<String, String> {
    use crate::project_reader::FIELD_DELETE;
    let tempo = ot.tempo.clamp(TEMPO_MIN, TEMPO_MAX);
    let mut f = HashMap::new();
    if ot.unknown != 1 {
        f.insert("BPMX24".into(), tempo.to_string());
        f.insert("TRIM_BARSX100".into(), FIELD_DELETE.into());
    } else {
        let bars = if ot.trim_bar_len > 0 {
            ot.trim_bar_len as u64
        } else {
            // bars = seconds x BPM / 240, x 100, with BPM = tempo / 24
            let frames = ot.trim_end.saturating_sub(ot.trim_start) as u64;
            (frames * tempo as u64 * 100 + 44_100 * 24 * 120) / (44_100 * 24 * 240)
        };
        f.insert("TRIM_BARSX100".into(), bars.to_string());
        f.insert("BPMX24".into(), FIELD_DELETE.into());
    }
    f.insert("TSMODE".into(), ot.stretch.to_string());
    f.insert("LOOPMODE".into(), ot.loop_mode.to_string());
    f.insert("GAIN".into(), ot.gain.to_string());
    f.insert(
        "TRIGQUANTIZATION".into(),
        (ot.quantization as i8).to_string(),
    );
    f
}

/// The slot's markers: the `.ot`'s trim, loop point, all 64 slices as stored, and the count.
pub fn slot_markers(ot: &SampleSettingsFile) -> SlotMarkers {
    SlotMarkers {
        trim_offset: ot.trim_start,
        trim_end: ot.trim_end,
        loop_point: ot.loop_start,
        slices: ot.slices,
        slice_count: ot.slices_len,
    }
}

/// Write a `.ot`. ot-tools-io recomputes its checksum on every encode.
pub fn write(ot: &SampleSettingsFile, path: &Path) -> Result<(), String> {
    ot.to_data_file(path)
        .map_err(|e| format!("Writing {}: {e}", name_of(path)))
}

/// The `.ot` to apply when assigning audio that is in place, and whether any of its positions
/// had to be cut to the audio's length: Ok(None) without one, Err with the reason when the one
/// there can't be read.
pub fn usable_for(audio: &Path, frames: u64) -> Result<Option<(SampleSettingsFile, bool)>, String> {
    let Some(ot_path) = companion(audio) else {
        return Ok(None);
    };
    let ot = read_valid(&ot_path)?;
    Ok(Some((
        rescale(&ot, OT_RATE, frames),
        fits(&ot, frames).is_err(),
    )))
}

/// Put an older `.ot` out of the way. In a project it goes to `backups/`, as every other file
/// the app replaces; elsewhere (the Audio Pool) it is renamed `.bak` in place, since a
/// `backups/` folder in the pool would show up in the device's file browser.
fn retire(old: &Path) -> Result<(), String> {
    let dir = old.parent().ok_or("No folder")?;
    if dir.join("project.work").exists() || dir.join("project.strd").exists() {
        return crate::project_reader::backup_and_delete_file(dir, old, "import_ot");
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let bak = dir.join(format!("{}.{}.bak", name_of(old), stamp));
    std::fs::rename(old, &bak).map_err(|e| format!("Moving {} aside: {e}", name_of(old)))
}

/// Bring the source's `.ot` along with audio just written to `dest_audio`, in a project or in
/// the Audio Pool.
///
/// `dest_audio` must be freshly written (copied, converted or overwritten), so any `.ot`
/// already next to it described other audio: it is put out of the way (see `retire`) before
/// the source's one, if readable, takes its place under the audio's name.
pub fn carry(source_audio: &Path, dest_audio: &Path) -> Result<Option<OtCarry>, String> {
    // A dropped folder is copied file by file, each audio file carrying its own .ot
    if source_audio.is_dir() || dest_audio.is_dir() {
        return Ok(None);
    }
    let audio = name_of(dest_audio);
    let carried = |ot: String, outcome, from_rate, reason, replaced, clamped| OtCarry {
        audio: audio.clone(),
        ot,
        outcome,
        from_rate,
        reason,
        replaced,
        clamped,
    };

    // Whatever sits next to the new audio describes the file it replaced
    let leftover = companion(dest_audio);
    if let Some(old) = &leftover {
        retire(old)?;
    }
    let replaced = leftover.is_some();

    let Some(source_ot) = companion(source_audio) else {
        return Ok(
            leftover.map(|old| carried(name_of(&old), OtOutcome::Removed, None, None, true, false))
        );
    };
    let refused = |why: String| {
        Ok(Some(carried(
            name_of(&source_ot),
            OtOutcome::Refused,
            None,
            Some(why),
            replaced,
            false,
        )))
    };
    let (Some((src_frames, src_rate)), Some((dest_frames, _))) = (
        crate::project_reader::audio_frames_and_rate(source_audio),
        crate::project_reader::audio_frames_and_rate(dest_audio),
    ) else {
        return refused(
            "the audio's length can't be read (only WAV and AIFF, the formats the Octatrack plays)"
                .into(),
        );
    };
    let ot = match read_valid(&source_ot) {
        Ok(ot) => ot,
        Err(why) => return refused(why),
    };
    // Applied even when it reaches past the end of the audio, cut to its length, as the device
    // does with such a .ot
    let clamped = fits(&ot, src_frames).is_err();

    let dest_ot = dest_audio.with_extension("ot");
    write(&rescale(&ot, src_rate, dest_frames), &dest_ot)?;
    let (outcome, from_rate) = if src_rate == OT_RATE {
        (OtOutcome::Copied, None)
    } else {
        (OtOutcome::Rescaled, Some(src_rate))
    };
    Ok(Some(carried(
        name_of(&dest_ot),
        outcome,
        from_rate,
        None,
        replaced,
        clamped,
    )))
}

fn name_of(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn used(ot: &SampleSettingsFile) -> usize {
    (ot.slices_len as usize).min(64)
}

/// Keep every position inside `frames` and each slice's start before its end; "no loop" stays.
fn clamp(ot: &mut SampleSettingsFile, frames: u32) {
    let frames = frames.max(1);
    let lp = |v: u32| {
        if v == SLICE_LOOP_POINT_DISABLED {
            v
        } else {
            v.min(frames - 1)
        }
    };
    ot.trim_start = ot.trim_start.min(frames - 1);
    ot.trim_end = ot.trim_end.min(frames).max(ot.trim_start + 1);
    ot.loop_start = lp(ot.loop_start);
    let n = used(ot);
    for s in ot.slices[..n].iter_mut() {
        s.trim_start = s.trim_start.min(frames - 1);
        s.trim_end = s.trim_end.min(frames).max(s.trim_start + 1);
        s.loop_start = lp(s.loop_start);
    }
}

/// Fixtures shared with `project_reader`'s assign tests.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use ot_tools_io::types::Slice;

    pub(crate) fn wav(path: &Path, rate: u32, frames: u64) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for _ in 0..frames {
            w.write_sample(0i16).unwrap();
        }
        w.finalize().unwrap();
    }

    /// A valid `.ot`: trim 0..trim_end, the given used slices, timestretch off, tempo 116 BPM.
    pub(crate) fn ot(trim_end: u32, slices: &[(u32, u32, u32)]) -> SampleSettingsFile {
        let mut table = [Slice::default(); 64];
        for (i, (s, e, l)) in slices.iter().enumerate() {
            table[i] = Slice {
                trim_start: *s,
                trim_end: *e,
                loop_start: *l,
            };
        }
        let markers = SlotMarkers {
            trim_offset: 0,
            trim_end,
            loop_point: 0,
            slices: table,
            slice_count: slices.len() as u32,
        };
        let mut f =
            SampleSettingsFile::new(markers, Some(72), Some(2784), None, None, None, None, None)
                .unwrap();
        f.stretch = 0;
        f.loop_mode = 1;
        f.quantization = 255;
        f.checksum = f.calculate_checksum().unwrap();
        f
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{ot, wav};
    use super::*;
    use crate::project_reader::FIELD_DELETE;
    use ot_tools_io::types::Slice;
    use tempfile::TempDir;

    #[test]
    fn companion_matches_the_stem_in_any_case_and_skips_appledouble_files() {
        let dir = TempDir::new().unwrap();
        wav(&dir.path().join("Kick.wav"), OT_RATE, 10);
        std::fs::write(dir.path().join("._Kick.ot"), b"junk").unwrap();
        assert_eq!(companion(&dir.path().join("Kick.wav")), None);

        write(&ot(10, &[]), &dir.path().join("kick.OT")).unwrap();
        assert_eq!(
            companion(&dir.path().join("Kick.wav")),
            Some(dir.path().join("kick.OT"))
        );
    }

    #[test]
    fn read_valid_takes_unused_slices_stored_as_no_loop_and_clamps_the_tempo() {
        let dir = TempDir::new().unwrap();
        let mut f = ot(1000, &[(0, 500, SLICE_LOOP_POINT_DISABLED)]);
        // An unused entry as real files store it, which validate() would refuse
        f.slices[5] = Slice {
            trim_start: 0,
            trim_end: 0,
            loop_start: SLICE_LOOP_POINT_DISABLED,
        };
        f.tempo = 24; // DigiChain's value; the Octatrack raises it to 720
        let path = dir.path().join("a.ot");
        write(&f, &path).unwrap();

        let read = read_valid(&path).unwrap();
        assert_eq!(read.tempo, 720);
        assert!(read.check_checksum().unwrap());
    }

    #[test]
    fn read_valid_refuses_a_bad_checksum() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.ot");
        write(&ot(1000, &[]), &path).unwrap();
        // Change the gain on disk (u16 BE at 0x2B) without updating the checksum
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[0x2C] = 60;
        std::fs::write(&path, bytes).unwrap();
        assert!(read_valid(&path).unwrap_err().contains("checksum"));
    }

    #[test]
    fn fits_allows_the_end_margin_and_refuses_past_it() {
        assert!(fits(&ot(1000 + END_MARGIN as u32, &[]), 1000).is_ok());
        assert!(fits(&ot(1001 + END_MARGIN as u32, &[]), 1000).is_err());
        let slice_past = ot(1000, &[(0, 2000, SLICE_LOOP_POINT_DISABLED)]);
        assert!(fits(&slice_past, 1000).unwrap_err().contains("slice 1"));
    }

    #[test]
    fn rescale_moves_every_position_to_the_44k1_grid() {
        let mut f = ot(
            48_000,
            &[
                (24_000, 48_000, SLICE_LOOP_POINT_DISABLED),
                (0, 24_000, 12_000),
            ],
        );
        f.loop_start = 12_000;
        let r = rescale(&f, 48_000, 44_100);
        assert_eq!(
            (r.trim_start, r.trim_end, r.loop_start),
            (0, 44_100, 11_025)
        );
        assert_eq!(
            (
                r.slices[0].trim_start,
                r.slices[0].trim_end,
                r.slices[0].loop_start
            ),
            (22_050, 44_100, SLICE_LOOP_POINT_DISABLED)
        );
        assert_eq!(
            (
                r.slices[1].trim_start,
                r.slices[1].trim_end,
                r.slices[1].loop_start
            ),
            (0, 22_050, 11_025)
        );
    }

    #[test]
    fn rescale_at_44k1_only_clamps_to_the_audio() {
        let r = rescale(
            &ot(1_010, &[(0, 1_010, SLICE_LOOP_POINT_DISABLED)]),
            OT_RATE,
            1_000,
        );
        assert_eq!((r.trim_end, r.slices[0].trim_end), (1_000, 1_000));
    }

    #[test]
    fn slot_fields_carry_the_tempo_when_it_has_priority() {
        let f = slot_fields(&ot(1000, &[]));
        assert_eq!(f["BPMX24"], "2784");
        assert_eq!(f["TRIM_BARSX100"], FIELD_DELETE);
        assert_eq!(f["TSMODE"], "0");
        assert_eq!(f["LOOPMODE"], "1");
        assert_eq!(f["GAIN"], "72");
        assert_eq!(f["TRIGQUANTIZATION"], "-1");
    }

    #[test]
    fn slot_fields_follow_the_priority_byte_not_the_timestretch_mode() {
        // ot-import-test on our Octatrack: sliced_b.ot, timestretch Normal and byte 22 at 0,
        // was assigned with BPMx24=2880 and no TRIM_BARSx100
        let mut o = ot(1000, &[]);
        o.stretch = 2;
        o.tempo = 2880;
        o.trim_bar_len = 200;
        let f = slot_fields(&o);
        assert_eq!(f["BPMX24"], "2880");
        assert_eq!(f["TRIM_BARSX100"], FIELD_DELETE);
        assert_eq!(f["TSMODE"], "2");
    }

    #[test]
    fn slot_fields_carry_the_bars_when_the_trim_length_has_priority() {
        // AED_PROJD_OT on our own hardware: byte 22 at 1, TS 3, bars 925, GAIN 51, quantise 2
        let mut o = ot(1000, &[]);
        o.unknown = 1;
        o.stretch = 3;
        o.trim_bar_len = 925;
        o.gain = 51;
        o.quantization = 2;
        let f = slot_fields(&o);
        assert_eq!(f["TRIM_BARSX100"], "925");
        assert_eq!(f["BPMX24"], FIELD_DELETE);
        assert_eq!((f["TSMODE"].as_str(), f["GAIN"].as_str()), ("3", "51"));
        assert_eq!(f["TRIGQUANTIZATION"], "2");
    }

    #[test]
    fn slot_markers_keep_all_64_entries_and_the_count() {
        let m = slot_markers(&ot(900, &[(10, 20, SLICE_LOOP_POINT_DISABLED)]));
        assert_eq!((m.trim_offset, m.trim_end, m.slice_count), (0, 900, 1));
        assert_eq!((m.slices[0].trim_start, m.slices[0].trim_end), (10, 20));
    }

    #[test]
    fn usable_for_clamps_an_ot_past_the_end_of_its_audio() {
        // ot-import-test on our Octatrack: a .ot whose trim end was 3x the audio was applied,
        // its trim end cut to the audio's length
        let dir = TempDir::new().unwrap();
        let audio = dir.path().join("kick.wav");
        wav(&audio, OT_RATE, 1000);
        assert_eq!(usable_for(&audio, 1000).unwrap(), None);
        write(&ot(5000, &[]), &dir.path().join("kick.ot")).unwrap();
        let (applied, clamped) = usable_for(&audio, 1000).unwrap().unwrap();
        assert_eq!((applied.trim_end, clamped), (1000, true));
    }

    #[test]
    fn usable_for_refuses_an_unreadable_ot() {
        let dir = TempDir::new().unwrap();
        let audio = dir.path().join("kick.wav");
        wav(&audio, OT_RATE, 1000);
        std::fs::write(dir.path().join("kick.ot"), b"not a .ot").unwrap();
        assert!(usable_for(&audio, 1000).is_err());
    }

    /// A source folder holding `name` (+ its `.ot` when given) and a project folder.
    fn setup(
        name: &str,
        rate: u32,
        frames: u64,
        source_ot: Option<SampleSettingsFile>,
    ) -> (TempDir, PathBuf, PathBuf) {
        let root = TempDir::new().unwrap();
        let src = root.path().join("src");
        let project = root.path().join("project");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("project.work"), b"").unwrap();
        wav(&src.join(name), rate, frames);
        if let Some(o) = source_ot {
            write(&o, &src.join(name).with_extension("ot")).unwrap();
        }
        (root, src.join(name), project)
    }

    #[test]
    fn carry_rescales_the_ot_of_a_resampled_import() {
        let (_root, src, project) = setup(
            "loop.wav",
            48_000,
            48_000,
            Some(ot(48_000, &[(24_000, 48_000, SLICE_LOOP_POINT_DISABLED)])),
        );
        let dest = project.join("loop.wav");
        wav(&dest, OT_RATE, 44_100); // what the conversion wrote

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!(c.outcome, OtOutcome::Rescaled);
        assert_eq!(
            (c.from_rate, c.ot.as_str(), c.replaced),
            (Some(48_000), "loop.ot", false)
        );
        let written = read_valid(&project.join("loop.ot")).unwrap();
        assert_eq!(
            (written.trim_end, written.slices[0].trim_start),
            (44_100, 22_050)
        );
    }

    #[test]
    fn carry_copies_the_ot_unchanged_when_the_rate_was_kept() {
        let source = ot(1000, &[(0, 500, SLICE_LOOP_POINT_DISABLED)]);
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, Some(source));
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!(c.outcome, OtOutcome::Copied);
        assert_eq!(read_valid(&project.join("kick.ot")).unwrap(), source);
    }

    #[test]
    fn carry_clamps_an_ot_past_the_end_of_its_audio() {
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, Some(ot(90_000, &[])));
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!((c.outcome, c.clamped), (OtOutcome::Copied, true));
        assert_eq!(read_valid(&project.join("kick.ot")).unwrap().trim_end, 1000);
    }

    #[test]
    fn carry_refuses_an_unreadable_ot() {
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, None);
        std::fs::write(src.with_extension("ot"), b"not a .ot").unwrap();
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!(c.outcome, OtOutcome::Refused);
        assert!(!project.join("kick.ot").exists());
    }

    #[test]
    fn carry_into_the_audio_pool_keeps_the_older_ot_as_a_bak_file() {
        // No backups/ folder in the pool: the device's file browser would list it
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, None);
        std::fs::remove_file(project.join("project.work")).unwrap();
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();
        write(&ot(1000, &[]), &project.join("kick.ot")).unwrap();

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!(c.outcome, OtOutcome::Removed);
        assert!(!project.join("kick.ot").exists() && !project.join("backups").exists());
        let baks: Vec<_> = std::fs::read_dir(&project)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".bak"))
            .collect();
        assert_eq!(baks.len(), 1);
    }

    #[test]
    fn carry_leaves_folders_alone() {
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, Some(ot(1000, &[])));
        assert_eq!(carry(src.parent().unwrap(), &project).unwrap(), None);
    }

    #[test]
    fn carry_backs_up_a_leftover_ot_when_the_new_audio_has_none() {
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, None);
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();
        write(&ot(1000, &[]), &project.join("kick.ot")).unwrap();

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!(c.outcome, OtOutcome::Removed);
        assert!(!project.join("kick.ot").exists());
        let backups: Vec<_> = std::fs::read_dir(project.join("backups"))
            .unwrap()
            .collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn carry_backs_up_the_older_ot_it_replaces() {
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, Some(ot(1000, &[])));
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();
        write(&ot(800, &[]), &project.join("kick.ot")).unwrap();

        let c = carry(&src, &dest).unwrap().unwrap();
        assert_eq!((c.outcome, c.replaced), (OtOutcome::Copied, true));
        assert_eq!(read_valid(&project.join("kick.ot")).unwrap().trim_end, 1000);
        assert!(project.join("backups").exists());
    }

    #[test]
    fn carry_does_nothing_without_any_ot() {
        let (_root, src, project) = setup("kick.wav", OT_RATE, 1000, None);
        let dest = project.join("kick.wav");
        std::fs::copy(&src, &dest).unwrap();
        assert_eq!(carry(&src, &dest).unwrap(), None);
    }
}
