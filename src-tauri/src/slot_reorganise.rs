//! Planning for moving and sorting sample slots. Pure logic, no file access: the caller says
//! which slots are taken and gets back the list of slot renumberings to apply.
//!
//! Slot numbers here are 1-based, 1 to 128. The Flex recorder buffers (129 to 136) are never a
//! source, a target or free space, so any plan that would use a number above 128 is an error.
//! A slot is taken when it is in the `taken` set; the caller decides that, so a slot that only
//! carries attributes (no PATH) belongs in it and is pushed along rather than overwritten.
//!
//! The push rule: the moved block is laid at `target..`, the slots it lands on are displaced in
//! slot order, and each displaced slot goes to the next position below that is free once the
//! sources have left. A single slot dropped on another taken slot swaps with it instead.

use crate::project_reader::{
    audio_frames_and_rate, bank_file_path, get_existing_bank_indices, join_sample_blocks,
    normalize_path_lexically, project_file_path, remap_bank_slot_references, split_sample_blocks,
    SampleBlock, BANK_LETTERS,
};
use ot_tools_io::types::SlotMarkers;
use ot_tools_io::{BankFile, HasChecksumField, MarkersFile, OctatrackFileIO};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::{Path, PathBuf};

/// Highest slot number a plan may use.
const MAX_SLOT: u8 = 128;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlotPlan {
    /// Every slot whose number changes, as (old, new).
    pub moves: Vec<(u8, u8)>,
    /// The pair when a single slot swapped places with the one it was dropped on.
    pub swapped: Option<(u8, u8)>,
    /// The subset of `moves` that was displaced by the block.
    pub pushed: Vec<(u8, u8)>,
}

impl SlotPlan {
    fn empty() -> Self {
        SlotPlan {
            moves: Vec::new(),
            swapped: None,
            pushed: Vec::new(),
        }
    }
}

/// Moves `sources` (any order, duplicates and empty slots ignored) so they sit side by side
/// from `target`, in slot order.
pub fn plan_move(taken: &BTreeSet<u8>, sources: &[u8], target: u8) -> Result<SlotPlan, String> {
    let block: BTreeSet<u8> = sources
        .iter()
        .copied()
        .filter(|s| taken.contains(s))
        .collect();
    let block: Vec<u8> = block.into_iter().collect();

    // One slot dropped on another taken slot trades places with it.
    if let [source] = block[..] {
        if (1..=MAX_SLOT).contains(&target) && target != source && taken.contains(&target) {
            return Ok(SlotPlan {
                moves: vec![(source, target), (target, source)],
                swapped: Some((source, target)),
                pushed: Vec::new(),
            });
        }
    }
    place_block(taken, &block, target)
}

/// Lays `block`, in the given order, at `target..`, pushing whatever it lands on down to the
/// nearest free slots. The block's own slots count as free, because they are leaving.
pub fn place_block(taken: &BTreeSet<u8>, block: &[u8], target: u8) -> Result<SlotPlan, String> {
    if block.is_empty() {
        return Err("No sample slot to move".to_string());
    }
    if block.iter().any(|s| !(1..=MAX_SLOT).contains(s)) {
        return Err("Sample slots go from 1 to 128".to_string());
    }
    if !(1..=MAX_SLOT).contains(&target) {
        return Err(format!("Slot {target} is not a sample slot (1 to 128)"));
    }
    let count = block.len();
    let end = target as usize + count - 1;
    if end > MAX_SLOT as usize {
        return Err(format!(
            "{count} slots from slot {target} would run past slot {MAX_SLOT}"
        ));
    }

    let mut occupied = taken.clone();
    for s in block {
        occupied.remove(s);
    }

    let mut plan = SlotPlan::empty();
    for (i, &old) in block.iter().enumerate() {
        let new = target + i as u8;
        if old != new {
            plan.moves.push((old, new));
        }
    }

    let end = end as u8;
    let mut queue: VecDeque<u8> = occupied.range(target..=end).copied().collect();
    let mut pos = end as u16 + 1;
    while let Some(&front) = queue.front() {
        if pos > MAX_SLOT as u16 {
            return Err(format!(
                "Not enough free slots below slot {target} to make room (slot {front} has nowhere to go)"
            ));
        }
        let p = pos as u8;
        if occupied.contains(&p) {
            queue.push_back(p);
        }
        queue.pop_front();
        plan.moves.push((front, p));
        plan.pushed.push((front, p));
        pos += 1;
    }
    Ok(plan)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortOrder {
    NameAsc,
    NameDesc,
    DurationDesc,
    DurationAsc,
    FolderThenName,
}

impl SortOrder {
    pub fn parse(id: &str) -> Option<SortOrder> {
        match id {
            "name-asc" => Some(SortOrder::NameAsc),
            "name-desc" => Some(SortOrder::NameDesc),
            "duration-desc" => Some(SortOrder::DurationDesc),
            "duration-asc" => Some(SortOrder::DurationAsc),
            "folder-name" => Some(SortOrder::FolderThenName),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SortEntry {
    pub slot: u8,
    /// None for a slot that only carries attributes: it has no name to sort by.
    pub path: Option<String>,
    pub duration_secs: Option<f64>,
}

fn split_path(path: &str) -> (String, String) {
    match path.rfind(['/', '\\']) {
        Some(i) => (path[..i].to_lowercase(), path[i + 1..].to_lowercase()),
        None => (String::new(), path.to_lowercase()),
    }
}

fn compare(a: &SortEntry, b: &SortEntry, order: SortOrder) -> Ordering {
    let (pa, pb) = match (&a.path, &b.path) {
        (Some(pa), Some(pb)) => (pa, pb),
        (Some(_), None) => return Ordering::Less,
        (None, Some(_)) => return Ordering::Greater,
        (None, None) => return a.slot.cmp(&b.slot),
    };
    let (folder_a, name_a) = split_path(pa);
    let (folder_b, name_b) = split_path(pb);
    let by_name = name_a.cmp(&name_b);
    let primary = match order {
        SortOrder::NameAsc => by_name,
        SortOrder::NameDesc => by_name.reverse(),
        SortOrder::FolderThenName => folder_a.cmp(&folder_b).then(by_name),
        SortOrder::DurationDesc | SortOrder::DurationAsc => {
            match (a.duration_secs, b.duration_secs) {
                (Some(da), Some(db)) if order == SortOrder::DurationDesc => db.total_cmp(&da),
                (Some(da), Some(db)) => da.total_cmp(&db),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => by_name,
            }
        }
    };
    primary.then(a.slot.cmp(&b.slot))
}

/// Sorts all of `entries`, or just the `selection`, and packs the result side by side: from
/// slot 1 for the whole list (closing gaps), from the selection's first slot otherwise.
pub fn plan_sort(
    taken: &BTreeSet<u8>,
    entries: &[SortEntry],
    order: SortOrder,
    selection: Option<&[u8]>,
) -> Result<SlotPlan, String> {
    let mut chosen: Vec<&SortEntry> = entries
        .iter()
        .filter(|e| taken.contains(&e.slot))
        .filter(|e| selection.is_none_or(|sel| sel.contains(&e.slot)))
        .collect();
    let Some(first) = chosen.iter().map(|e| e.slot).min() else {
        return Err("No sample slot to sort".to_string());
    };
    chosen.sort_by(|a, b| compare(a, b, order));
    let block: Vec<u8> = chosen.iter().map(|e| e.slot).collect();
    let target = if selection.is_some() { first } else { 1 };
    place_block(taken, &block, target)
}

/// Which of the two sample slot lists a move or sort works on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pool {
    Flex,
    Static,
}

impl Pool {
    /// The pool named by the frontend's slot type, "flex" or "static" in any case.
    pub fn parse(slot_type: &str) -> Option<Pool> {
        match slot_type.to_ascii_lowercase().as_str() {
            "flex" => Some(Pool::Flex),
            "static" => Some(Pool::Static),
            _ => None,
        }
    }

    /// The TYPE the device writes in this pool's `[SAMPLE]` blocks.
    pub fn tag(&self) -> &'static str {
        match self {
            Pool::Flex => "FLEX",
            Pool::Static => "STATIC",
        }
    }

    fn holds(&self, slot_type: &str) -> bool {
        slot_type.eq_ignore_ascii_case(self.tag())
    }
}

/// The value of one `KEY=value` line of a `[SAMPLE]` block, exactly as written.
fn block_field<'a>(block: &'a str, key: &str) -> Option<&'a str> {
    block
        .lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
}

/// The `[SAMPLE]` blocks of the project file the device reads.
fn read_project_blocks(project_path: &str) -> Result<Vec<SampleBlock>, String> {
    let path = project_file_path(project_path)?;
    let (_, blocks, _) = split_sample_blocks(&read_project_text(&path)?)?;
    Ok(blocks)
}

fn read_project_text(path: &Path) -> Result<String, String> {
    let raw = std::fs::read(path).map_err(|e| format!("Failed to read project file: {}", e))?;
    let (decoded, _, _) = encoding_rs::WINDOWS_1258.decode(&raw);
    Ok(decoded.into_owned())
}

/// The slots 1 to 128 of `pool` that hold something: every one with a `[SAMPLE]` block, PATH
/// or not, because a block without a sample still carries attributes a move must not bury.
pub fn taken_slots(project_path: &str, pool: Pool) -> Result<BTreeSet<u8>, String> {
    let blocks = read_project_blocks(project_path)?;
    Ok(blocks
        .iter()
        .filter(|(slot_type, slot, _)| pool.holds(slot_type) && is_slot(*slot))
        .map(|(_, slot, _)| *slot as u8)
        .collect())
}

fn is_slot(slot: u16) -> bool {
    (1..=MAX_SLOT as u16).contains(&slot)
}

/// What the sort orders need to know about each taken slot of `pool`, in slot order.
///
/// A slot without a PATH (attributes only) has no name. A sample whose file is missing or
/// unreadable has no duration; the sort puts both last rather than failing.
pub fn sort_entries(project_path: &str, pool: Pool) -> Result<Vec<SortEntry>, String> {
    let project_dir = Path::new(project_path);
    let blocks = read_project_blocks(project_path)?;
    let mut entries: BTreeMap<u8, SortEntry> = BTreeMap::new();
    for (slot_type, slot, text) in &blocks {
        if !pool.holds(slot_type) || !is_slot(*slot) {
            continue;
        }
        let slot = *slot as u8;
        entries.entry(slot).or_insert_with(|| {
            let path = block_field(text, "PATH")
                .filter(|p| !p.is_empty())
                .map(str::to_string);
            let duration_secs = path.as_deref().and_then(|p| duration_secs(project_dir, p));
            SortEntry {
                slot,
                path,
                duration_secs,
            }
        });
    }
    Ok(entries.into_values().collect())
}

/// A sample's length in seconds. PATH is relative to the project folder and may use the
/// device's backslashes.
fn duration_secs(project_dir: &Path, path: &str) -> Option<f64> {
    let file = normalize_path_lexically(&project_dir.join(path.replace('\\', "/")));
    let (frames, rate) = audio_frames_and_rate(&file)?;
    (rate > 0).then(|| frames as f64 / rate as f64)
}

/// Refuses moves the files cannot carry: a number outside 1 to 128 (the recorder buffers
/// above are never touched), a slot moved twice, or two slots sent to one number.
fn check_moves(moves: &[(u8, u8)]) -> Result<(), String> {
    let mut olds = BTreeSet::new();
    let mut news = BTreeSet::new();
    for &(old, new) in moves {
        for slot in [old, new] {
            if !(1..=MAX_SLOT).contains(&slot) {
                return Err(format!("Slot {slot} is not a sample slot (1 to 128)"));
            }
        }
        if !olds.insert(old) {
            return Err(format!("Slot {old} is moved twice"));
        }
        if !news.insert(new) {
            return Err(format!("Two slots would land on slot {new}"));
        }
    }
    Ok(())
}

/// Renumbers the `pool` blocks of a project file's text as `moves` (old, new) says.
///
/// Only each moved block's SLOT line changes, written with three digits as the device does;
/// every other byte of every block stays, and the blocks are put back in canonical order.
/// A move from a slot with no block, or onto a taken slot that is not itself moving, is
/// refused: the first would leave the slot's references pointing at nothing, the second would
/// leave two blocks on one number.
pub fn renumber_sample_blocks(
    content: &str,
    pool: Pool,
    moves: &[(u8, u8)],
) -> Result<String, String> {
    check_moves(moves)?;
    let map: HashMap<u16, u16> = moves
        .iter()
        .map(|&(old, new)| (old as u16, new as u16))
        .collect();
    let (pre, mut blocks, post) = split_sample_blocks(content)?;

    let present: BTreeSet<u16> = blocks
        .iter()
        .filter(|(slot_type, _, _)| pool.holds(slot_type))
        .map(|(_, slot, _)| *slot)
        .collect();
    for &(old, new) in moves {
        if !present.contains(&(old as u16)) {
            return Err(format!("{} slot {old} holds nothing to move", pool.tag()));
        }
        if present.contains(&(new as u16)) && !map.contains_key(&(new as u16)) {
            return Err(format!(
                "{} slot {new} is taken and would be overwritten",
                pool.tag()
            ));
        }
    }

    for (slot_type, slot, text) in blocks.iter_mut() {
        if !pool.holds(slot_type) {
            continue;
        }
        if let Some(&new) = map.get(slot) {
            *text = with_slot_line(text, new);
            *slot = new;
        }
    }
    Ok(join_sample_blocks(&pre, blocks, &post))
}

/// The block with its first SLOT line replaced, line ending kept.
fn with_slot_line(block: &str, slot: u16) -> String {
    let mut out = String::with_capacity(block.len());
    let mut done = false;
    for line in block.split_inclusive('\n') {
        if !done && line.starts_with("SLOT=") {
            let ending = &line[line.trim_end_matches(['\r', '\n']).len()..];
            out.push_str(&format!("SLOT={slot:03}{ending}"));
            done = true;
        } else {
            out.push_str(line);
        }
    }
    out
}

/// `moves` closed into a permutation of slot numbers: each slot that was empty and gets filled
/// (a new number that is no old one) is sent to a slot that is vacated (an old number that is
/// no new one), both taken in ascending order. The two sets are always the same size.
///
/// The `[SAMPLE]` blocks only need `moves`, since empty slots have none, but references and
/// markers need the whole permutation: a Part or lock that pointed at an empty slot must end
/// on an empty slot, not on the sample moved into it, and a vacated slot gets the markers the
/// filled one had. Every number comes from `moves`, so nothing above 128 appears.
fn complete_permutation(moves: &[(u8, u8)]) -> Vec<(u8, u8)> {
    let olds: BTreeSet<u8> = moves.iter().map(|&(old, _)| old).collect();
    let news: BTreeSet<u8> = moves.iter().map(|&(_, new)| new).collect();
    let filled = news.difference(&olds).copied();
    let vacated = olds.difference(&news).copied();
    moves.iter().copied().chain(filled.zip(vacated)).collect()
}

/// What a move did, for the frontend to word its notice, and the files it wrote.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlotMoveReport {
    pub moves: Vec<(u8, u8)>,
    pub swapped: Option<(u8, u8)>,
    pub pushed: Vec<(u8, u8)>,
    pub files_written: Vec<String>,
}

/// Carries out `plan` on the project at `project_path`: the `[SAMPLE]` blocks of `pool` are
/// renumbered in the project file, their markers entries move with them, and every Part slot
/// reference and trig sample lock of that pool, in every bank, is rewritten to the new numbers.
/// Markers and references follow `complete_permutation`, so the empty slots a move fills and
/// vacates trade places too and nothing that played silence before plays a sample after.
///
/// All or nothing: every new file is built in memory first, and any error (a plan that would
/// bury a slot, a file that does not parse) returns before anything is written. Only then is
/// `before_write` called with the paths about to be written, in order: the project file, the
/// markers file, then the banks by number. It is where the caller backs up and records undo;
/// an error from it stops the write. Banks the plan does not change are left alone, so they
/// are not backed up or snapshotted either. An empty plan writes nothing and never calls it.
pub fn apply_plan(
    project_path: &str,
    pool: Pool,
    plan: &SlotPlan,
    before_write: impl FnOnce(&[PathBuf]) -> Result<(), String>,
) -> Result<SlotMoveReport, String> {
    let mut report = SlotMoveReport {
        moves: plan.moves.clone(),
        swapped: plan.swapped,
        pushed: plan.pushed.clone(),
        files_written: Vec::new(),
    };
    if plan.moves.is_empty() {
        return Ok(report);
    }

    // The project file, renumbered as text: never through ProjectFile, which loses fields.
    let project_file = project_file_path(project_path)?;
    let renumbered = renumber_sample_blocks(&read_project_text(&project_file)?, pool, &plan.moves)?;
    let (encoded, _, _) = encoding_rs::WINDOWS_1258.encode(&renumbered);
    let mut writes: Vec<(PathBuf, Vec<u8>)> = vec![(project_file, encoded.into_owned())];

    // Checked by renumber_sample_blocks above, so it only adds pairs between slots 1 to 128.
    let permutation = complete_permutation(&plan.moves);

    // A project without a markers file has no markers to carry.
    let dir = Path::new(project_path);
    if let Some(markers_file) = ["markers.work", "markers.strd"]
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.exists())
    {
        let bytes = moved_markers(&markers_file, pool, &permutation)?;
        writes.push((markers_file, bytes));
    }

    // Bank data counts slots from 0.
    let remap: HashMap<u8, u8> = permutation
        .iter()
        .map(|&(old, new)| (old - 1, new - 1))
        .collect();
    let untouched = HashMap::new();
    let (static_remap, flex_remap) = match pool {
        Pool::Static => (&remap, &untouched),
        Pool::Flex => (&untouched, &remap),
    };
    for index in get_existing_bank_indices(project_path) {
        let letter = BANK_LETTERS[index as usize];
        let bank_file = bank_file_path(project_path, letter)?;
        let failed = |what: &str, e: ot_tools_io::OtToolsIoError| {
            format!("Failed to {what} bank {letter}: {e:?}")
        };
        let mut bank = BankFile::from_data_file(&bank_file).map_err(|e| failed("read", e))?;
        // Compared in memory, not with the bytes on disk: a bank the plan does not touch is
        // never rewritten just because its stored checksum or its bytes differ from what
        // ot-tools-io writes. Only a changed bank is checksummed and encoded, which is most
        // of the cost (measured on 16 banks: 6.8 s in a debug build when encoding all of them
        // twice to compare, against under 1 s for parsing alone).
        let before = bank.clone();
        remap_bank_slot_references(&mut bank, static_remap, flex_remap);
        if bank != before {
            bank.checksum = bank
                .calculate_checksum()
                .map_err(|e| failed("checksum", e))?;
            writes.push((bank_file, bank.to_bytes().map_err(|e| failed("encode", e))?));
        }
    }

    let paths: Vec<PathBuf> = writes.iter().map(|(path, _)| path.clone()).collect();
    before_write(&paths)?;
    // The bytes were encoded above, so nothing left can fail but the disk itself.
    for (path, bytes) in &writes {
        std::fs::write(path, bytes)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }
    report.files_written = paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    Ok(report)
}

/// The markers file with `pool`'s entries permuted by `permutation` (old, new, 1-based), encoded
/// with its checksum. Only entries 1 to 128 of that list change: `check_moves` has already
/// kept the recorder buffers out.
fn moved_markers(path: &Path, pool: Pool, permutation: &[(u8, u8)]) -> Result<Vec<u8>, String> {
    let mut markers = MarkersFile::from_data_file(path)
        .map_err(|e| format!("Failed to read markers file: {:?}", e))?;
    let entries: &mut [SlotMarkers] = match pool {
        Pool::Flex => &mut markers.flex_slots[..],
        Pool::Static => &mut markers.static_slots[..],
    };
    let before = entries.to_vec();
    for &(old, new) in permutation {
        entries[new as usize - 1] = before[old as usize - 1];
    }
    markers.checksum = markers
        .calculate_checksum()
        .map_err(|e| format!("Failed to checksum markers file: {:?}", e))?;
    markers
        .to_bytes()
        .map_err(|e| format!("Failed to encode markers file: {:?}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(slots: &[u8]) -> BTreeSet<u8> {
        slots.iter().copied().collect()
    }

    fn entry(slot: u8, path: Option<&str>, dur: Option<f64>) -> SortEntry {
        SortEntry {
            slot,
            path: path.map(str::to_string),
            duration_secs: dur,
        }
    }

    fn named(items: &[(u8, &str)]) -> (BTreeSet<u8>, Vec<SortEntry>) {
        let taken = items.iter().map(|(s, _)| *s).collect();
        let entries = items
            .iter()
            .map(|(s, p)| entry(*s, Some(p), None))
            .collect();
        (taken, entries)
    }

    #[test]
    fn one_slot_to_a_free_slot_moves_it() {
        let p = plan_move(&set(&[3]), &[3], 10).unwrap();
        assert_eq!(p.moves, vec![(3, 10)]);
        assert_eq!(p.swapped, None);
        assert!(p.pushed.is_empty());
    }

    #[test]
    fn one_slot_onto_a_taken_slot_swaps_them() {
        let p = plan_move(&set(&[3, 10]), &[3], 10).unwrap();
        assert_eq!(p.moves, vec![(3, 10), (10, 3)]);
        assert_eq!(p.swapped, Some((3, 10)));
        assert!(p.pushed.is_empty());
    }

    #[test]
    fn a_push_stops_at_the_first_free_slot() {
        // place_block, not plan_move: a lone source on a taken slot swaps (see the swap test).
        let p = place_block(&set(&[1, 3, 4, 5, 6, 8]), &[1], 3).unwrap();
        assert_eq!(p.moves, vec![(1, 3), (3, 4), (4, 5), (5, 6), (6, 7)]);
        assert_eq!(p.pushed, vec![(3, 4), (4, 5), (5, 6), (6, 7)]);
        assert!(!p.moves.iter().any(|m| m.0 == 8));
    }

    #[test]
    fn a_two_slot_push_needs_two_free_slots() {
        let p = plan_move(&set(&[1, 2, 3, 4, 5, 6, 8]), &[1, 2], 3).unwrap();
        assert_eq!(
            p.moves,
            vec![(1, 3), (2, 4), (3, 5), (4, 6), (5, 7), (6, 8), (8, 9)]
        );
    }

    #[test]
    fn ctrl_picks_close_up_into_a_block() {
        let p = plan_move(&set(&[2, 9, 20]), &[2, 20], 5).unwrap();
        assert_eq!(p.moves, vec![(2, 5), (20, 6)]);
    }

    #[test]
    fn empty_slots_in_a_run_are_left_behind() {
        let p = plan_move(&set(&[4, 6]), &[4, 5, 6], 10).unwrap();
        assert_eq!(p.moves, vec![(4, 10), (6, 11)]);
    }

    #[test]
    fn an_attribute_only_slot_is_pushed_not_overwritten() {
        // Slot 5 has attributes but no PATH; the caller still puts it in `taken`.
        let p = plan_move(&set(&[1, 2, 5]), &[1, 2], 5).unwrap();
        assert_eq!(p.moves, vec![(1, 5), (2, 6), (5, 7)]);
        assert_eq!(p.pushed, vec![(5, 7)]);
    }

    #[test]
    fn a_block_dropped_on_its_own_position_reuses_the_space_it_frees() {
        let p = plan_move(&set(&[3, 4, 5]), &[3, 4], 4).unwrap();
        assert_eq!(p.moves, vec![(3, 4), (4, 5), (5, 6)]);
        assert_eq!(p.pushed, vec![(5, 6)]);
    }

    #[test]
    fn no_room_below_the_drop_point_is_refused() {
        let mut t: Vec<u8> = (120..=128).collect();
        t.push(1);
        let e = place_block(&set(&t), &[1], 121).unwrap_err();
        assert!(e.contains("free slots"), "{e}");
    }

    #[test]
    fn a_block_running_past_slot_128_is_refused() {
        assert!(plan_move(&set(&[1, 2]), &[1, 2], 128).is_err());
    }

    #[test]
    fn the_recorder_buffers_are_never_a_target_or_space() {
        assert!(plan_move(&set(&[1]), &[1], 129).is_err());
        assert!(place_block(&set(&[1, 127, 128]), &[1], 127).is_err());
        assert!(plan_move(&set(&[1, 129]), &[129], 5).is_err());
    }

    #[test]
    fn nothing_taken_to_move_is_refused() {
        assert!(plan_move(&set(&[1]), &[5], 9).is_err());
    }

    #[test]
    fn dropping_a_slot_on_itself_moves_nothing() {
        let p = plan_move(&set(&[5]), &[5], 5).unwrap();
        assert_eq!(p, SlotPlan::empty());
    }

    #[test]
    fn sorting_the_whole_list_closes_the_gaps() {
        let (t, e) = named(&[(2, "c.wav"), (7, "a.wav"), (30, "b.wav")]);
        let p = plan_sort(&t, &e, SortOrder::NameAsc, None).unwrap();
        assert_eq!(p.moves, vec![(7, 1), (30, 2), (2, 3)]);
    }

    #[test]
    fn name_order_ignores_case_and_folders() {
        let (t, e) = named(&[(1, "bass/Snare.wav"), (2, "Drums/kick.wav")]);
        let p = plan_sort(&t, &e, SortOrder::NameAsc, None).unwrap();
        assert_eq!(p.moves, vec![(2, 1), (1, 2)]);
    }

    #[test]
    fn folder_then_name_groups_by_folder() {
        let (t, e) = named(&[
            (1, "b/z.wav"),
            (2, "a/y.wav"),
            (3, "b/a.wav"),
            (4, "a/b.wav"),
        ]);
        let p = plan_sort(&t, &e, SortOrder::FolderThenName, None).unwrap();
        // Order: a/b (4), a/y (2), b/a (3), b/z (1)
        assert_eq!(
            p.moves,
            vec![(4, 1), (2, 2), (3, 3), (1, 4)]
                .into_iter()
                .filter(|m| m.0 != m.1)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn duration_longest_first() {
        let t = set(&[1, 2, 3]);
        let e = vec![
            entry(1, Some("a.wav"), Some(1.0)),
            entry(2, Some("b.wav"), Some(3.0)),
            entry(3, Some("c.wav"), Some(2.0)),
        ];
        let p = plan_sort(&t, &e, SortOrder::DurationDesc, None).unwrap();
        assert_eq!(p.moves, vec![(2, 1), (3, 2), (1, 3)]);
    }

    #[test]
    fn duration_shortest_first() {
        let t = set(&[1, 2, 3]);
        let e = vec![
            entry(1, Some("a.wav"), Some(3.0)),
            entry(2, Some("b.wav"), Some(1.0)),
            entry(3, Some("c.wav"), Some(2.0)),
        ];
        let p = plan_sort(&t, &e, SortOrder::DurationAsc, None).unwrap();
        assert_eq!(p.moves, vec![(2, 1), (3, 2), (1, 3)]);
    }

    #[test]
    fn missing_durations_sort_last_by_name() {
        let t = set(&[1, 2, 3]);
        let e = vec![
            entry(1, Some("z.wav"), None),
            entry(2, Some("a.wav"), None),
            entry(3, Some("m.wav"), Some(1.0)),
        ];
        let p = plan_sort(&t, &e, SortOrder::DurationDesc, None).unwrap();
        // m (3) first, then a (2), then z (1)
        assert_eq!(
            p.moves,
            vec![(3, 1), (2, 2), (1, 3)]
                .into_iter()
                .filter(|m| m.0 != m.1)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn attribute_only_slots_sort_last() {
        let t = set(&[1, 2]);
        let e = vec![entry(1, None, None), entry(2, Some("a.wav"), Some(1.0))];
        for order in [
            SortOrder::NameAsc,
            SortOrder::NameDesc,
            SortOrder::DurationAsc,
        ] {
            let p = plan_sort(&t, &e, order, None).unwrap();
            assert_eq!(p.moves, vec![(2, 1), (1, 2)], "{order:?}");
        }
    }

    #[test]
    fn sorting_a_selection_packs_it_at_its_first_position() {
        let (t, e) = named(&[(2, "x.wav"), (5, "z.wav"), (6, "y.wav"), (9, "a.wav")]);
        let p = plan_sort(&t, &e, SortOrder::NameAsc, Some(&[5, 9])).unwrap();
        assert_eq!(p.moves, vec![(9, 5), (5, 6), (6, 7)]);
    }

    #[test]
    fn ties_keep_slot_order() {
        let (t, e) = named(&[(4, "a/kick.wav"), (2, "b/kick.wav"), (3, "c/kick.wav")]);
        let p = plan_sort(&t, &e, SortOrder::NameAsc, None).unwrap();
        // kick ties; slot order 2, 3, 4
        assert_eq!(p.moves, vec![(2, 1), (3, 2), (4, 3)]);
    }

    #[test]
    fn sort_ids_parse() {
        assert_eq!(
            SortOrder::parse("folder-name"),
            Some(SortOrder::FolderThenName)
        );
        assert_eq!(SortOrder::parse("nope"), None);
    }
}

#[cfg(test)]
mod apply_tests {
    use super::*;
    use crate::project_reader::tests::TestProject;
    use crate::project_reader::{assign_samples_to_slots, read_raw_sample_fields, SlotAssignment};
    use ot_tools_io::types::SlotMarkers;
    use ot_tools_io::{BankFile, HasChecksumField, MarkersFile, OctatrackFileIO};
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    /// A `[SAMPLE]` block in the device's own layout, with the fields ot-tools-io loses.
    fn block(slot_type: &str, slot: &str, path: &str, gain: u8) -> String {
        format!(
            "[SAMPLE]\r\nTYPE={slot_type}\r\nSLOT={slot}\r\nPATH={path}\r\nTRIM_BARSx100=400\r\nTSMODE=2\r\nLOOPMODE=1\r\nGAIN={gain}\r\nTRIGQUANTIZATION=-1\r\n[/SAMPLE]"
        )
    }

    fn file(blocks: &[String]) -> String {
        format!(
            "[SETTINGS]\r\nTEMPOx24=2880\r\n[/SETTINGS]\r\n\r\n{}\r\n\r\n############################\r\n\r\n",
            blocks.join("\r\n\r\n")
        )
    }

    fn dir(project: &TestProject) -> &Path {
        Path::new(&project.path)
    }

    /// A TestProject with an empty markers file and the given Flex slots assigned through the
    /// app's own assign command, so the `[SAMPLE]` blocks are the ones it really writes.
    fn project_with_flex(slots: &[(u16, &str)]) -> TestProject {
        let project = TestProject::new();
        MarkersFile::default()
            .to_data_file(&dir(&project).join("markers.work"))
            .unwrap();
        let assignments = slots
            .iter()
            .map(|(slot, path)| SlotAssignment {
                slot_index: *slot,
                audio_path: path.to_string(),
                set_defaults: true,
            })
            .collect();
        assign_samples_to_slots(&project.path, "FLEX", assignments).unwrap();
        project
    }

    /// Prepends a block to the project file, ahead of the recorder buffers.
    fn insert_block(project: &TestProject, text: &str) {
        let file = dir(project).join("project.work");
        let raw = std::fs::read(&file).unwrap();
        let (decoded, _, _) = encoding_rs::WINDOWS_1258.decode(&raw);
        let replaced = decoded.replacen("[SAMPLE]", &format!("{text}\r\n\r\n[SAMPLE]"), 1);
        let (encoded, _, _) = encoding_rs::WINDOWS_1258.encode(&replaced);
        std::fs::write(&file, encoded).unwrap();
    }

    fn set_gain(project: &TestProject, slot: u16, gain: u8) {
        let file = dir(project).join("project.work");
        let raw = std::fs::read(&file).unwrap();
        let (decoded, _, _) = encoding_rs::WINDOWS_1258.decode(&raw);
        let (pre, mut blocks, post) = crate::project_reader::split_sample_blocks(&decoded).unwrap();
        for (t, s, text) in blocks.iter_mut() {
            if t == "FLEX" && *s == slot {
                let line = text
                    .lines()
                    .find(|l| l.starts_with("GAIN="))
                    .unwrap()
                    .to_string();
                *text = text.replace(&line, &format!("GAIN={gain}"));
            }
        }
        let joined = crate::project_reader::join_sample_blocks(&pre, blocks, &post);
        let (encoded, _, _) = encoding_rs::WINDOWS_1258.encode(&joined);
        std::fs::write(&file, encoded).unwrap();
    }

    fn field(project: &TestProject, slot: u16, key: &str) -> Option<String> {
        let fields = read_raw_sample_fields(&dir(project).join("project.work")).unwrap();
        fields.get(&("FLEX".to_string(), slot))?.get(key).cloned()
    }

    fn bank_path(project: &TestProject, index: usize) -> PathBuf {
        dir(project).join(format!("bank{:02}.work", index + 1))
    }

    fn bank(project: &TestProject, index: usize) -> BankFile {
        BankFile::from_data_file(&bank_path(project, index)).unwrap()
    }

    fn edit_bank(project: &TestProject, index: usize, edit: impl FnOnce(&mut BankFile)) {
        let mut b = bank(project, index);
        edit(&mut b);
        b.checksum = b.calculate_checksum().unwrap();
        b.to_data_file(&bank_path(project, index)).unwrap();
    }

    fn markers(project: &TestProject) -> MarkersFile {
        MarkersFile::from_data_file(&dir(project).join("markers.work")).unwrap()
    }

    fn edit_markers(project: &TestProject, edit: impl FnOnce(&mut MarkersFile)) {
        let mut m = markers(project);
        edit(&mut m);
        m.checksum = m.calculate_checksum().unwrap();
        m.to_data_file(&dir(project).join("markers.work")).unwrap();
    }

    /// Every file of the project folder, by name, with its bytes.
    fn snapshot(project: &TestProject) -> BTreeMap<PathBuf, Vec<u8>> {
        std::fs::read_dir(dir(project))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.is_file())
            .map(|p| {
                let bytes = std::fs::read(&p).unwrap();
                (p, bytes)
            })
            .collect()
    }

    fn swap(project: &TestProject, a: u8, b: u8) -> SlotPlan {
        let taken = taken_slots(&project.path, Pool::Flex).unwrap();
        let plan = plan_move(&taken, &[a], b).unwrap();
        assert_eq!(plan.swapped, Some((a, b)), "fixture must hold both slots");
        plan
    }

    fn apply(project: &TestProject, plan: &SlotPlan) -> SlotMoveReport {
        apply_plan(&project.path, Pool::Flex, plan, |_| Ok(())).unwrap()
    }

    fn all_banks(project: &TestProject) -> Vec<String> {
        (0..16)
            .map(|i| bank_path(project, i).to_string_lossy().into_owned())
            .collect()
    }

    fn marked(trim_offset: u32, trim_end: u32, loop_point: u32, slice_count: u32) -> SlotMarkers {
        SlotMarkers {
            trim_offset,
            trim_end,
            loop_point,
            slice_count,
            ..Default::default()
        }
    }

    #[test]
    fn pool_names_parse_in_any_case() {
        assert_eq!(Pool::parse("flex"), Some(Pool::Flex));
        assert_eq!(Pool::parse("STATIC"), Some(Pool::Static));
        assert_eq!(Pool::parse("Static"), Some(Pool::Static));
        assert_eq!(Pool::parse("both"), None);
        assert_eq!(Pool::Flex.tag(), "FLEX");
        assert_eq!(Pool::Static.tag(), "STATIC");
    }

    #[test]
    fn renumbering_changes_only_the_slot_lines() {
        let before = file(&[
            block("FLEX", "001", "a.wav", 10),
            block("FLEX", "002", "b.wav", 20),
            block("FLEX", "003", "c.wav", 30),
        ]);
        let after = renumber_sample_blocks(&before, Pool::Flex, &[(1, 3), (3, 1)]).unwrap();
        let expected = file(&[
            block("FLEX", "001", "c.wav", 30),
            block("FLEX", "002", "b.wav", 20),
            block("FLEX", "003", "a.wav", 10),
        ]);
        assert_eq!(after, expected);
    }

    #[test]
    fn renumbering_writes_three_digit_slot_numbers() {
        let before = file(&[block("FLEX", "3", "a.wav", 10)]);
        let after = renumber_sample_blocks(&before, Pool::Flex, &[(3, 7)]).unwrap();
        assert_eq!(after, file(&[block("FLEX", "007", "a.wav", 10)]));
    }

    #[test]
    fn renumbering_never_touches_the_recorder_buffers_or_the_other_pool() {
        let before = file(&[
            block("FLEX", "001", "a.wav", 10),
            block("FLEX", "129", "", 72),
            block("STATIC", "001", "s.wav", 40),
        ]);
        let flex = renumber_sample_blocks(&before, Pool::Flex, &[(1, 5)]).unwrap();
        assert_eq!(
            flex,
            file(&[
                block("FLEX", "005", "a.wav", 10),
                block("FLEX", "129", "", 72),
                block("STATIC", "001", "s.wav", 40),
            ])
        );
        let stat = renumber_sample_blocks(&before, Pool::Static, &[(1, 2)]).unwrap();
        assert_eq!(
            stat,
            file(&[
                block("FLEX", "001", "a.wav", 10),
                block("FLEX", "129", "", 72),
                block("STATIC", "002", "s.wav", 40),
            ])
        );
        assert!(renumber_sample_blocks(&before, Pool::Flex, &[(1, 129)]).is_err());
        assert!(renumber_sample_blocks(&before, Pool::Flex, &[(129, 2)]).is_err());
    }

    #[test]
    fn renumbering_refuses_to_overwrite_or_to_move_an_empty_slot() {
        let before = file(&[
            block("FLEX", "001", "a.wav", 10),
            block("FLEX", "002", "b.wav", 20),
        ]);
        // 2 is taken and stays put: 1 landing there would bury it.
        assert!(renumber_sample_blocks(&before, Pool::Flex, &[(1, 2)]).is_err());
        // Nothing to carry from slot 3.
        assert!(renumber_sample_blocks(&before, Pool::Flex, &[(3, 4)]).is_err());
        // Two slots onto one.
        assert!(renumber_sample_blocks(&before, Pool::Flex, &[(1, 5), (2, 5)]).is_err());
    }

    #[test]
    fn taken_slots_count_a_block_without_a_path() {
        let project = project_with_flex(&[(2, "two.wav")]);
        // "Clear sample, keep attributes" leaves PATH= blank; some files have no PATH at all.
        insert_block(
            &project,
            "[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=004\r\nPATH=\r\nTSMODE=2\r\nLOOPMODE=1\r\nGAIN=60\r\nTRIGQUANTIZATION=-1\r\n[/SAMPLE]",
        );
        insert_block(
            &project,
            "[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=006\r\nTSMODE=2\r\nLOOPMODE=1\r\nGAIN=60\r\nTRIGQUANTIZATION=-1\r\n[/SAMPLE]",
        );
        let taken = taken_slots(&project.path, Pool::Flex).unwrap();
        assert_eq!(
            taken,
            BTreeSet::from([2, 4, 6]),
            "recorder buffers excluded"
        );
        assert!(taken_slots(&project.path, Pool::Static).unwrap().is_empty());
    }

    #[test]
    fn sort_entries_read_durations_and_tolerate_missing_files() {
        let project = TestProject::new();
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 44100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let write = |path: PathBuf, frames: u32| {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let mut w = hound::WavWriter::create(path, spec).unwrap();
            for _ in 0..frames * 2 {
                w.write_sample(0i16).unwrap();
            }
            w.finalize().unwrap();
        };
        write(dir(&project).join("one.wav"), 44100);
        write(dir(&project).join("sub").join("half.wav"), 22050);
        insert_block(&project, &block("FLEX", "001", "one.wav", 48));
        insert_block(&project, &block("FLEX", "002", "sub\\half.wav", 48));
        insert_block(&project, &block("FLEX", "003", "gone.wav", 48));
        insert_block(&project, &block("FLEX", "004", "", 48));

        let entries = sort_entries(&project.path, Pool::Flex).unwrap();
        assert_eq!(
            entries,
            vec![
                SortEntry {
                    slot: 1,
                    path: Some("one.wav".to_string()),
                    duration_secs: Some(1.0)
                },
                SortEntry {
                    slot: 2,
                    path: Some("sub\\half.wav".to_string()),
                    duration_secs: Some(0.5)
                },
                SortEntry {
                    slot: 3,
                    path: Some("gone.wav".to_string()),
                    duration_secs: None
                },
                SortEntry {
                    slot: 4,
                    path: None,
                    duration_secs: None
                },
            ]
        );
    }

    #[test]
    fn a_move_carries_the_sample_its_attributes_and_markers() {
        let project = project_with_flex(&[(1, "one.wav"), (2, "two.wav")]);
        set_gain(&project, 1, 100);
        let one = marked(10, 5000, 20, 2);
        let two = marked(0, 777, 0, 0);
        edit_markers(&project, |m| {
            m.flex_slots[0] = one;
            m.flex_slots[1] = two;
        });

        let report = apply(&project, &swap(&project, 1, 2));

        assert_eq!(field(&project, 2, "PATH").as_deref(), Some("one.wav"));
        assert_eq!(field(&project, 2, "GAIN").as_deref(), Some("100"));
        assert_eq!(field(&project, 1, "PATH").as_deref(), Some("two.wav"));
        assert_eq!(field(&project, 1, "GAIN").as_deref(), Some("48"));
        let m = markers(&project);
        assert_eq!(m.flex_slots[1], one);
        assert_eq!(m.flex_slots[0], two);
        assert_eq!(m.checksum, m.calculate_checksum().unwrap());
        assert_eq!(report.moves, vec![(1, 2), (2, 1)]);
        assert_eq!(report.swapped, Some((1, 2)));
    }

    #[test]
    fn a_move_rewrites_part_references_in_both_copies_and_all_banks() {
        let project = project_with_flex(&[(1, "one.wav"), (5, "five.wav")]);
        edit_bank(&project, 0, |b| {
            b.parts.unsaved.0[0].audio_track_machine_slots[0].flex_slot_id = 0;
            b.parts.saved.0[0].audio_track_machine_slots[0].flex_slot_id = 4;
        });
        edit_bank(&project, 2, |b| {
            b.parts.unsaved.0[0].audio_track_machine_slots[0].flex_slot_id = 0;
        });

        let report = apply(&project, &swap(&project, 1, 5));

        let a = bank(&project, 0);
        assert_eq!(
            a.parts.unsaved.0[0].audio_track_machine_slots[0].flex_slot_id,
            4
        );
        assert_eq!(
            a.parts.saved.0[0].audio_track_machine_slots[0].flex_slot_id,
            0
        );
        assert_eq!(a.checksum, a.calculate_checksum().unwrap());
        let c = bank(&project, 2);
        assert_eq!(
            c.parts.unsaved.0[0].audio_track_machine_slots[0].flex_slot_id,
            4
        );
        // Untouched banks point track 1 at slot 1 and track 5 at slot 5 by default: those
        // follow too, so every bank is written.
        let p = bank(&project, 9);
        assert_eq!(
            p.parts.saved.0[3].audio_track_machine_slots[0].flex_slot_id,
            4
        );
        assert_eq!(
            p.parts.saved.0[3].audio_track_machine_slots[4].flex_slot_id,
            0
        );
        assert_eq!(report.files_written[2..], all_banks(&project)[..]);
    }

    #[test]
    fn a_move_rewrites_sample_locks_through_the_tracks_machine() {
        let project = project_with_flex(&[(1, "one.wav"), (5, "five.wav")]);
        edit_bank(&project, 0, |b| {
            b.parts.unsaved.0[0].audio_track_machine_types[0] = 1; // Flex
            b.parts.unsaved.0[0].audio_track_machine_types[1] = 0; // Static
            let trigs = &mut b.patterns.0[0].audio_track_trigs.0;
            trigs[0].plocks.0[3].flex_slot_id = 0;
            trigs[1].plocks.0[3].flex_slot_id = 0;
        });

        apply(&project, &swap(&project, 1, 5));

        let trigs = &bank(&project, 0).patterns.0[0].audio_track_trigs.0;
        assert_eq!(trigs[0].plocks.0[3].flex_slot_id, 4, "Flex track follows");
        assert_eq!(
            trigs[1].plocks.0[3].flex_slot_id, 0,
            "Static track's lock stays"
        );
        assert_eq!(
            trigs[0].plocks.0[4].flex_slot_id, 255,
            "no lock stays no lock"
        );
    }

    #[test]
    fn the_other_pools_references_and_the_recorder_slot_stay() {
        let project = project_with_flex(&[(1, "one.wav"), (5, "five.wav")]);
        insert_block(&project, &block("STATIC", "001", "s.wav", 40));
        edit_markers(&project, |m| {
            m.static_slots[0] = marked(1, 2, 1, 0);
            m.static_slots[4] = marked(3, 4, 3, 0);
            m.flex_slots[128] = marked(5, 6, 5, 0);
        });
        let refs = |p: &TestProject| -> Vec<(u8, u8)> {
            (0..16)
                .flat_map(|i| {
                    let b = bank(p, i);
                    [b.parts.unsaved, b.parts.saved]
                        .into_iter()
                        .flat_map(|parts| parts.0.to_vec())
                        .flat_map(|part| part.audio_track_machine_slots.to_vec())
                        .map(|s| (s.static_slot_id, s.recorder_slot_id))
                        .collect::<Vec<_>>()
                })
                .collect()
        };
        let before_refs = refs(&project);
        let before_markers = markers(&project);
        let static_block = field_of(&project, "STATIC", 1);

        apply(&project, &swap(&project, 1, 5));

        assert_eq!(refs(&project), before_refs);
        let after_markers = markers(&project);
        assert_eq!(after_markers.static_slots, before_markers.static_slots);
        assert_eq!(
            after_markers.flex_slots[128..],
            before_markers.flex_slots[128..]
        );
        assert_eq!(field_of(&project, "STATIC", 1), static_block);
    }

    fn field_of(
        project: &TestProject,
        slot_type: &str,
        slot: u16,
    ) -> Option<Vec<(String, String)>> {
        let fields = read_raw_sample_fields(&dir(project).join("project.work")).unwrap();
        let mut f: Vec<_> = fields
            .get(&(slot_type.to_string(), slot))?
            .clone()
            .into_iter()
            .collect();
        f.sort();
        Some(f)
    }

    #[test]
    fn only_changed_banks_are_written() {
        let project = project_with_flex(&[(20, "a.wav"), (30, "b.wav")]);
        edit_bank(&project, 1, |b| {
            b.parts.unsaved.0[2].audio_track_machine_slots[3].flex_slot_id = 19;
        });
        let before = snapshot(&project);

        let report = apply(&project, &swap(&project, 20, 30));

        let expected = vec![
            dir(&project)
                .join("project.work")
                .to_string_lossy()
                .into_owned(),
            dir(&project)
                .join("markers.work")
                .to_string_lossy()
                .into_owned(),
            bank_path(&project, 1).to_string_lossy().into_owned(),
        ];
        assert_eq!(report.files_written, expected);
        let b = bank(&project, 1);
        assert_eq!(
            b.parts.unsaved.0[2].audio_track_machine_slots[3].flex_slot_id,
            29
        );
        let after = snapshot(&project);
        for i in (0..16).filter(|&i| i != 1) {
            let path = bank_path(&project, i);
            assert_eq!(after[&path], before[&path], "bank {} rewritten", i + 1);
        }
    }

    #[test]
    fn a_bank_whose_stored_checksum_differs_is_not_rewritten_for_nothing() {
        let project = project_with_flex(&[(20, "a.wav"), (30, "b.wav")]);
        // Bank C's references miss slots 20 and 30, but its stored checksum is not the one
        // ot-tools-io computes (another tool, another firmware, a stray byte).
        // Written as raw bytes: ot-tools-io's encoder would put its own checksum back.
        let mut before = std::fs::read(bank_path(&project, 2)).unwrap();
        let last = before.len() - 1;
        before[last] ^= 0x01;
        std::fs::write(bank_path(&project, 2), &before).unwrap();
        let c = bank(&project, 2);
        assert_ne!(
            c.checksum,
            c.calculate_checksum().unwrap(),
            "fixture set up"
        );

        let report = apply(&project, &swap(&project, 20, 30));

        let c_path = bank_path(&project, 2).to_string_lossy().into_owned();
        assert!(
            !report.files_written.contains(&c_path),
            "{:?}",
            report.files_written
        );
        assert_eq!(std::fs::read(bank_path(&project, 2)).unwrap(), before);
    }

    #[test]
    fn before_write_sees_every_file_written_and_can_stop_it() {
        let project = project_with_flex(&[(1, "one.wav"), (5, "five.wav")]);
        // Distinct markers, so the markers file really changes and the last check holds for it.
        edit_markers(&project, |m| m.flex_slots[0] = marked(10, 5000, 20, 2));
        let plan = swap(&project, 1, 5);
        let before = snapshot(&project);

        let mut seen: Vec<PathBuf> = Vec::new();
        let err = apply_plan(&project.path, Pool::Flex, &plan, |paths| {
            seen = paths.to_vec();
            Err("backup failed".to_string())
        })
        .unwrap_err();
        assert!(err.contains("backup failed"), "{err}");
        assert_eq!(snapshot(&project), before, "nothing written");

        let mut expected = vec![
            dir(&project).join("project.work"),
            dir(&project).join("markers.work"),
        ];
        expected.extend((0..16).map(|i| bank_path(&project, i)));
        assert_eq!(seen, expected);

        let mut seen_ok: Vec<PathBuf> = Vec::new();
        let report = apply_plan(&project.path, Pool::Flex, &plan, |paths| {
            seen_ok = paths.to_vec();
            Ok(())
        })
        .unwrap();
        let seen_ok: Vec<String> = seen_ok
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert_eq!(report.files_written, seen_ok);
        let after = snapshot(&project);
        for path in &expected {
            assert!(
                after[path] != before[path],
                "{} not written",
                path.display()
            );
        }
    }

    #[test]
    fn a_refused_plan_writes_nothing() {
        let project = project_with_flex(&[(1, "one.wav"), (5, "five.wav")]);
        let plan = swap(&project, 1, 5);
        let broken = bank_path(&project, 2);
        let bytes = std::fs::read(&broken).unwrap();
        std::fs::write(&broken, &bytes[..bytes.len() / 2]).unwrap();
        let before = snapshot(&project);

        let mut called = false;
        let result = apply_plan(&project.path, Pool::Flex, &plan, |_| {
            called = true;
            Ok(())
        });
        assert!(result.is_err());
        assert!(!called, "refused before asking to write");
        assert_eq!(snapshot(&project), before);
    }

    #[test]
    fn a_plan_that_would_bury_a_slot_writes_nothing() {
        let project = project_with_flex(&[(1, "one.wav"), (2, "two.wav")]);
        let plan = SlotPlan {
            moves: vec![(1, 2)],
            swapped: None,
            pushed: Vec::new(),
        };
        let before = snapshot(&project);
        assert!(apply_plan(&project.path, Pool::Flex, &plan, |_| Ok(())).is_err());
        assert_eq!(snapshot(&project), before);
    }

    #[test]
    fn complete_permutation_pairs_filled_empties_with_vacated_slots() {
        assert_eq!(complete_permutation(&[(3, 10)]), vec![(3, 10), (10, 3)]);
        let push = [(1, 3), (2, 4), (3, 5), (4, 6), (5, 7), (6, 8), (8, 9)];
        let mut expected = push.to_vec();
        expected.extend([(7, 1), (9, 2)]);
        assert_eq!(complete_permutation(&push), expected);
        let swap = [(1, 5), (5, 1)];
        assert_eq!(complete_permutation(&swap), swap.to_vec());
    }

    #[test]
    fn a_part_pointing_at_an_empty_slot_still_points_at_an_empty_slot() {
        // Default Parts point track 5 at Flex slot 5 (4), empty here, and track 1 at slot 1.
        let project = project_with_flex(&[(1, "one.wav")]);
        let taken = taken_slots(&project.path, Pool::Flex).unwrap();
        let plan = plan_move(&taken, &[1], 5).unwrap();
        assert_eq!(plan.moves, vec![(1, 5)]);

        apply(&project, &plan);

        assert_eq!(
            taken_slots(&project.path, Pool::Flex).unwrap(),
            BTreeSet::from([5])
        );
        let a = bank(&project, 0);
        for parts in [&a.parts.unsaved, &a.parts.saved] {
            let slots = &parts.0[0].audio_track_machine_slots;
            assert_eq!(slots[4].flex_slot_id, 0, "track 5 still on an empty slot");
            assert_eq!(slots[0].flex_slot_id, 4, "track 1 follows its sample");
        }
    }

    #[test]
    fn a_vacated_slot_takes_the_markers_the_empty_slot_had() {
        let project = project_with_flex(&[(1, "one.wav")]);
        let one = marked(10, 5000, 20, 2);
        let empty_five = marked(1, 99, 1, 0);
        edit_markers(&project, |m| {
            m.flex_slots[0] = one;
            m.flex_slots[4] = empty_five;
        });
        let taken = taken_slots(&project.path, Pool::Flex).unwrap();

        apply(&project, &plan_move(&taken, &[1], 5).unwrap());

        let m = markers(&project);
        assert_eq!(m.flex_slots[4], one);
        assert_eq!(m.flex_slots[0], empty_five);
    }

    #[test]
    fn an_empty_plan_writes_nothing() {
        let project = project_with_flex(&[(1, "one.wav")]);
        let before = snapshot(&project);
        let mut called = false;
        let report = apply_plan(&project.path, Pool::Flex, &SlotPlan::empty(), |_| {
            called = true;
            Ok(())
        })
        .unwrap();
        assert!(!called);
        assert!(report.files_written.is_empty());
        assert_eq!(snapshot(&project), before);
    }
}
