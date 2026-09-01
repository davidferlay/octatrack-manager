#![forbid(unsafe_code)]

use ot_codec_ports::{
    EncodedPatch, ProjectReferenceCodec, ReferenceRewriteError, SlotPathPatch, SlotPathRef,
};

pub use ot_codec_ports::rewrite_same_directory_path;
use ot_domain::{RootPathComponent, SampleSlotId, SampleSlotKind};
use std::collections::HashSet;
use std::ops::Range;

const SAMPLE_START: &str = "[SAMPLE]";
const SAMPLE_END: &str = "[/SAMPLE]";
/// Flex 129–136 appear as recorder buffers with empty PATH on tracked OS 1.40
/// fixtures. They are preserved but are not `SampleSlotId` rewrite targets.
const FLEX_RECORDER_MIN: u16 = 129;
const FLEX_RECORDER_MAX: u16 = 136;

/// Memory-only surgical PATH rewriter for Project `.work` / `.strd` documents.
///
/// The implementation never opens a filesystem path. Callers supply document
/// bytes and receive patched bytes. Only the `PATH=` value of targeted
/// `[SAMPLE]` blocks is replaced, and only when `from` / `to` share the same
/// observed directory prefix and separator (same-directory rename).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MemoryProjectReferenceCodec;

impl ProjectReferenceCodec for MemoryProjectReferenceCodec {
    fn inspect_sample_paths(
        &self,
        bytes: &[u8],
    ) -> Result<Vec<SlotPathRef>, ReferenceRewriteError> {
        let text = decode_windows_1258(bytes)?;
        Ok(inspectable_slots(&parse_sample_blocks(&text)?))
    }

    fn apply_path_patches(
        &self,
        original: &[u8],
        patches: &[SlotPathPatch],
    ) -> Result<EncodedPatch, ReferenceRewriteError> {
        apply_path_patches(original, patches)
    }
}

fn apply_path_patches(
    original: &[u8],
    patches: &[SlotPathPatch],
) -> Result<EncodedPatch, ReferenceRewriteError> {
    let text = decode_windows_1258(original)?;
    let blocks = parse_sample_blocks(&text)?;
    let inspect_before = inspectable_slots(&blocks);
    validate_unique_patch_targets(patches)?;

    let mut replacements = Vec::new();
    let mut changed_slots = Vec::new();
    for patch in patches {
        ensure_safe_raw_path(&patch.from_raw_path)?;
        ensure_safe_raw_path(&patch.to_raw_path)?;
        ensure_same_directory_rewrite(&patch.from_raw_path, &patch.to_raw_path)?;
        let block = blocks
            .iter()
            .find(|block| block.inspectable_slot() == Some(patch.slot))
            .ok_or(ReferenceRewriteError::TargetSlotNotFound)?;
        if block.raw_path != patch.from_raw_path {
            return Err(ReferenceRewriteError::FromPathMismatch);
        }
        if patch.from_raw_path == patch.to_raw_path {
            continue;
        }
        replacements.push((block.path_range.clone(), patch.to_raw_path.clone()));
        changed_slots.push(patch.slot);
    }

    if replacements.is_empty() {
        return Ok(EncodedPatch {
            bytes: original.to_vec(),
            changed_slots,
            inspected_after: inspect_before,
        });
    }

    replacements.sort_by_key(|(range, _)| range.start);
    let patched_text = apply_replacements(&text, &replacements)?;
    let bytes = encode_windows_1258(&patched_text)?;
    let inspected_after = MemoryProjectReferenceCodec.inspect_sample_paths(&bytes)?;
    verify_reparse(&inspect_before, &inspected_after, patches, &changed_slots)?;

    Ok(EncodedPatch {
        bytes,
        changed_slots,
        inspected_after,
    })
}

fn decode_windows_1258(bytes: &[u8]) -> Result<String, ReferenceRewriteError> {
    let (decoded, _, had_errors) = encoding_rs::WINDOWS_1258.decode(bytes);
    if had_errors {
        return Err(ReferenceRewriteError::IrreversibleEncoding);
    }
    let text = decoded.into_owned();
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(&text);
    if had_unmappable || encoded.as_ref() != bytes {
        return Err(ReferenceRewriteError::IrreversibleEncoding);
    }
    Ok(text)
}

fn encode_windows_1258(text: &str) -> Result<Vec<u8>, ReferenceRewriteError> {
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(text);
    if had_unmappable {
        return Err(ReferenceRewriteError::IrreversibleEncoding);
    }
    Ok(encoded.into_owned())
}

#[derive(Clone, Debug)]
struct SampleBlock {
    kind: SampleSlotKind,
    number: u16,
    raw_path: String,
    path_range: Range<usize>,
}

impl SampleBlock {
    fn inspectable_slot(&self) -> Option<SampleSlotId> {
        SampleSlotId::new(self.kind, self.number).ok()
    }
}

fn parse_sample_blocks(text: &str) -> Result<Vec<SampleBlock>, ReferenceRewriteError> {
    let lines = text_lines(text);
    let mut blocks = Vec::new();
    let mut seen = HashSet::new();
    let mut index = 0;
    while index < lines.len() {
        match classify_line(lines[index].content)? {
            LineKind::Other => {
                index += 1;
            }
            LineKind::Close => return Err(ReferenceRewriteError::UnexpectedSampleCloser),
            LineKind::Open => {
                index += 1;
                let mut slot_type = None;
                let mut slot_number = None;
                let mut path = None;
                loop {
                    if index >= lines.len() {
                        return Err(ReferenceRewriteError::UnclosedSampleBlock);
                    }
                    match classify_line(lines[index].content)? {
                        LineKind::Open => return Err(ReferenceRewriteError::NestedSampleBlock),
                        LineKind::Close => {
                            index += 1;
                            break;
                        }
                        LineKind::Other => {
                            let line = &lines[index];
                            if let Some(value) = field_value(line.content, "TYPE") {
                                if slot_type.is_some() {
                                    return Err(ReferenceRewriteError::DuplicateField);
                                }
                                slot_type = Some(parse_slot_kind(value)?);
                            } else if let Some(value) = field_value(line.content, "SLOT") {
                                if slot_number.is_some() {
                                    return Err(ReferenceRewriteError::DuplicateField);
                                }
                                slot_number = Some(parse_slot_number(value)?);
                            } else if let Some(value) = field_value(line.content, "PATH") {
                                if path.is_some() {
                                    return Err(ReferenceRewriteError::DuplicatePathLine);
                                }
                                ensure_safe_raw_path(value)?;
                                let value_start =
                                    line.content_start + line.content.len() - value.len();
                                let value_end = line.content_start + line.content.len();
                                path = Some((value_start..value_end, value.to_owned()));
                            }
                            index += 1;
                        }
                    }
                }
                let kind = slot_type.ok_or(ReferenceRewriteError::MissingType)?;
                let number = slot_number.ok_or(ReferenceRewriteError::MissingSlot)?;
                validate_observed_slot(kind, number)?;
                let (path_range, raw_path) = path.ok_or(ReferenceRewriteError::MissingPath)?;
                let block = SampleBlock {
                    kind,
                    number,
                    raw_path,
                    path_range,
                };
                if !seen.insert((block.kind, block.number)) {
                    return Err(ReferenceRewriteError::DuplicateSlot {
                        kind: slot_kind_token(block.kind).to_owned(),
                        number: block.number,
                    });
                }
                blocks.push(block);
            }
        }
    }
    Ok(blocks)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LineKind {
    Open,
    Close,
    Other,
}

struct TextLine<'a> {
    content: &'a str,
    content_start: usize,
}

fn text_lines(text: &str) -> Vec<TextLine<'_>> {
    let mut lines = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        let rest = &text[pos..];
        let step = rest.find('\n').map(|index| index + 1).unwrap_or(rest.len());
        let content = rest[..step].trim_end_matches(['\r', '\n']);
        lines.push(TextLine {
            content,
            content_start: pos,
        });
        pos += step;
        if step == rest.len() {
            break;
        }
    }
    lines
}

fn classify_line(line: &str) -> Result<LineKind, ReferenceRewriteError> {
    if line == SAMPLE_START {
        return Ok(LineKind::Open);
    }
    if line == SAMPLE_END {
        return Ok(LineKind::Close);
    }
    if line.eq_ignore_ascii_case(SAMPLE_START) || line.eq_ignore_ascii_case(SAMPLE_END) {
        return Err(ReferenceRewriteError::NestedSampleBlock);
    }
    if line.contains(SAMPLE_START) || line.contains(SAMPLE_END) {
        return Err(ReferenceRewriteError::NestedSampleBlock);
    }
    Ok(LineKind::Other)
}

fn validate_observed_slot(kind: SampleSlotKind, number: u16) -> Result<(), ReferenceRewriteError> {
    if SampleSlotId::new(kind, number).is_ok() || is_flex_recorder_buffer(kind, number) {
        Ok(())
    } else {
        Err(ReferenceRewriteError::InvalidSlot)
    }
}

fn is_flex_recorder_buffer(kind: SampleSlotKind, number: u16) -> bool {
    kind == SampleSlotKind::Flex && (FLEX_RECORDER_MIN..=FLEX_RECORDER_MAX).contains(&number)
}

fn ensure_safe_raw_path(path: &str) -> Result<(), ReferenceRewriteError> {
    if path.is_empty() {
        return Ok(());
    }
    if path.contains('\0')
        || path.contains('\n')
        || path.contains('\r')
        || path.contains(SAMPLE_START)
        || path.contains(SAMPLE_END)
    {
        return Err(ReferenceRewriteError::UnsafePathText);
    }
    Ok(())
}

fn inspectable_slots(blocks: &[SampleBlock]) -> Vec<SlotPathRef> {
    blocks
        .iter()
        .filter_map(|block| {
            block.inspectable_slot().map(|slot| SlotPathRef {
                slot,
                raw_path: block.raw_path.clone(),
            })
        })
        .collect()
}

fn validate_unique_patch_targets(patches: &[SlotPathPatch]) -> Result<(), ReferenceRewriteError> {
    let mut seen = HashSet::new();
    for patch in patches {
        if !seen.insert(patch.slot) {
            return Err(ReferenceRewriteError::DuplicatePatch);
        }
    }
    Ok(())
}

fn ensure_same_directory_rewrite(
    from_raw_path: &str,
    to_raw_path: &str,
) -> Result<(), ReferenceRewriteError> {
    let (from_prefix, from_basename) = split_dir_and_basename(from_raw_path)?;
    let (to_prefix, to_basename) = split_dir_and_basename(to_raw_path)?;
    if from_prefix != to_prefix {
        return Err(ReferenceRewriteError::DirectoryChangeRejected);
    }
    RootPathComponent::parse(from_basename).map_err(|_| ReferenceRewriteError::InvalidBasename)?;
    RootPathComponent::parse(to_basename).map_err(|_| ReferenceRewriteError::InvalidBasename)?;
    Ok(())
}

fn split_dir_and_basename(raw_path: &str) -> Result<(&str, &str), ReferenceRewriteError> {
    if raw_path.is_empty() {
        return Err(ReferenceRewriteError::EmptyPath);
    }
    if raw_path.contains('\0') {
        return Err(ReferenceRewriteError::InvalidBasename);
    }
    match raw_path.rfind(['/', '\\']) {
        Some(index) => {
            let basename = &raw_path[index + 1..];
            if basename.is_empty() {
                return Err(ReferenceRewriteError::EmptyPath);
            }
            Ok((&raw_path[..=index], basename))
        }
        None => Ok(("", raw_path)),
    }
}

fn apply_replacements(
    text: &str,
    replacements: &[(Range<usize>, String)],
) -> Result<String, ReferenceRewriteError> {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    for (range, replacement) in replacements {
        if range.start < cursor || range.end > text.len() || range.start > range.end {
            return Err(ReferenceRewriteError::ReparseMismatch);
        }
        output.push_str(&text[cursor..range.start]);
        output.push_str(replacement);
        cursor = range.end;
    }
    output.push_str(&text[cursor..]);
    Ok(output)
}

fn verify_reparse(
    before: &[SlotPathRef],
    after: &[SlotPathRef],
    patches: &[SlotPathPatch],
    changed_slots: &[SampleSlotId],
) -> Result<(), ReferenceRewriteError> {
    if before.len() != after.len() {
        return Err(ReferenceRewriteError::ReparseMismatch);
    }
    let changed: HashSet<_> = changed_slots.iter().copied().collect();
    for (expected, observed) in before.iter().zip(after.iter()) {
        if expected.slot != observed.slot {
            return Err(ReferenceRewriteError::ReparseMismatch);
        }
        let wanted = if changed.contains(&expected.slot) {
            patches
                .iter()
                .find(|patch| patch.slot == expected.slot)
                .map(|patch| patch.to_raw_path.as_str())
                .ok_or(ReferenceRewriteError::ReparseMismatch)?
        } else {
            expected.raw_path.as_str()
        };
        if observed.raw_path != wanted {
            return Err(ReferenceRewriteError::ReparseMismatch);
        }
    }
    Ok(())
}

fn field_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let line_bytes = line.as_bytes();
    let key_bytes = key.as_bytes();
    if line_bytes.len() < key_bytes.len() + 1 {
        return None;
    }
    if !line_bytes[..key_bytes.len()].eq_ignore_ascii_case(key_bytes) {
        return None;
    }
    if line_bytes[key_bytes.len()] != b'=' {
        return None;
    }
    Some(&line[key_bytes.len() + 1..])
}

fn parse_slot_kind(value: &str) -> Result<SampleSlotKind, ReferenceRewriteError> {
    if value.eq_ignore_ascii_case("STATIC") {
        Ok(SampleSlotKind::Static)
    } else if value.eq_ignore_ascii_case("FLEX") {
        Ok(SampleSlotKind::Flex)
    } else {
        Err(ReferenceRewriteError::UnsupportedSlotType)
    }
}

fn parse_slot_number(value: &str) -> Result<u16, ReferenceRewriteError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ReferenceRewriteError::InvalidSlot);
    }
    let number = value
        .parse::<u16>()
        .map_err(|_| ReferenceRewriteError::InvalidSlot)?;
    if number == 0 {
        return Err(ReferenceRewriteError::InvalidSlot);
    }
    Ok(number)
}

fn slot_kind_token(kind: SampleSlotKind) -> &'static str {
    match kind {
        SampleSlotKind::Static => "STATIC",
        SampleSlotKind::Flex => "FLEX",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::SampleSlotKind;
    use std::fs;
    use std::path::PathBuf;

    fn slot(kind: SampleSlotKind, number: u16) -> SampleSlotId {
        SampleSlotId::new(kind, number).unwrap()
    }

    fn synthetic(body: &str) -> Vec<u8> {
        encode_windows_1258(body).expect("synthetic document encodes")
    }

    fn sample_block(kind: &str, number: &str, path: &str) -> String {
        format!(
            "[SAMPLE]\r\nTYPE={kind}\r\nSLOT={number}\r\nPATH={path}\r\nTRIGQUANTIZATION=-1\r\nTRIM_BARSx100=1600\r\n[/SAMPLE]"
        )
    }

    fn two_slot_document() -> (Vec<u8>, String, String) {
        let flex = "../AUDIO/pool/kick.wav";
        let stat = "local-snare.wav";
        let text = format!(
            "[META]\r\nVERSION=19\r\n[/META]\r\n\r\n{}\r\n\r\n{}\r\n",
            sample_block("FLEX", "001", flex),
            sample_block("STATIC", "002", stat)
        );
        (synthetic(&text), flex.to_owned(), stat.to_owned())
    }

    fn real_device_project_work() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/real_device/project.work")
    }

    fn real_device_1_40_project_work() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/real_device_os_1_40/project.work")
    }

    fn read_fixture(path: &std::path::Path) -> Vec<u8> {
        fs::read(path).expect("read tracked fixture")
    }

    #[test]
    fn rewrite_same_directory_path_keeps_observed_prefix_and_separator() {
        assert_eq!(
            rewrite_same_directory_path("../AUDIO/pool/kick.wav", "kick-2.wav").unwrap(),
            "../AUDIO/pool/kick-2.wav"
        );
        assert_eq!(
            rewrite_same_directory_path("folder\\kick.wav", "kick-2.wav").unwrap(),
            "folder\\kick-2.wav"
        );
        assert_eq!(
            rewrite_same_directory_path("kick.wav", "kick-2.wav").unwrap(),
            "kick-2.wav"
        );
        assert_eq!(
            rewrite_same_directory_path("", "kick.wav"),
            Err(ReferenceRewriteError::EmptyPath)
        );
        assert_eq!(
            rewrite_same_directory_path("../AUDIO/kick.wav", "sub/kick.wav"),
            Err(ReferenceRewriteError::InvalidBasename)
        );
    }

    #[test]
    fn no_op_patches_return_original_bytes() {
        let (bytes, flex, stat) = two_slot_document();
        let codec = MemoryProjectReferenceCodec;
        let patched = codec
            .apply_path_patches(
                &bytes,
                &[
                    SlotPathPatch {
                        slot: slot(SampleSlotKind::Flex, 1),
                        from_raw_path: flex,
                        to_raw_path: "../AUDIO/pool/kick.wav".to_owned(),
                    },
                    SlotPathPatch {
                        slot: slot(SampleSlotKind::Static, 2),
                        from_raw_path: stat,
                        to_raw_path: "local-snare.wav".to_owned(),
                    },
                ],
            )
            .unwrap();
        assert_eq!(patched.bytes, bytes);
        assert!(patched.changed_slots.is_empty());
    }

    #[test]
    fn empty_patch_list_is_byte_identical() {
        let (bytes, _, _) = two_slot_document();
        let patched = MemoryProjectReferenceCodec
            .apply_path_patches(&bytes, &[])
            .unwrap();
        assert_eq!(patched.bytes, bytes);
    }

    #[test]
    fn flex_and_static_same_directory_rewrites_leave_other_slots_untouched() {
        let (bytes, flex, stat) = two_slot_document();
        let codec = MemoryProjectReferenceCodec;
        let to_flex = rewrite_same_directory_path(&flex, "kick-renamed.wav").unwrap();
        let patched = codec
            .apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: flex.clone(),
                    to_raw_path: to_flex.clone(),
                }],
            )
            .unwrap();
        assert_eq!(patched.changed_slots, vec![slot(SampleSlotKind::Flex, 1)]);
        let inspect = codec.inspect_sample_paths(&patched.bytes).unwrap();
        assert_eq!(inspect[0].raw_path, to_flex);
        assert_eq!(inspect[1].raw_path, stat);
        let text = decode_windows_1258(&patched.bytes).unwrap();
        assert!(text.contains("TRIGQUANTIZATION=-1"));
        assert!(text.contains("TRIM_BARSx100=1600"));
        assert_eq!(text.matches("TRIGQUANTIZATION=-1").count(), 2);
        assert!(!text.contains(&flex));
    }

    #[test]
    fn working_and_saved_documents_are_rewritten_independently() {
        let (working, flex, _) = two_slot_document();
        let saved = working.clone();
        let codec = MemoryProjectReferenceCodec;
        let to = rewrite_same_directory_path(&flex, "kick-b.wav").unwrap();
        let patch = [SlotPathPatch {
            slot: slot(SampleSlotKind::Flex, 1),
            from_raw_path: flex.clone(),
            to_raw_path: to.clone(),
        }];
        let working_patched = codec.apply_path_patches(&working, &patch).unwrap();
        assert_eq!(
            codec.inspect_sample_paths(&saved).unwrap()[0].raw_path,
            flex
        );
        assert_eq!(
            codec.inspect_sample_paths(&working_patched.bytes).unwrap()[0].raw_path,
            to
        );
        assert_ne!(working_patched.bytes, saved);
    }

    #[test]
    fn fail_closed_on_malformed_and_ambiguous_documents() {
        let codec = MemoryProjectReferenceCodec;
        let unclosed = synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\nPATH=kick.wav\r\n");
        assert_eq!(
            codec.inspect_sample_paths(&unclosed),
            Err(ReferenceRewriteError::UnclosedSampleBlock)
        );

        let duplicate = synthetic(&format!(
            "{}\r\n{}\r\n",
            sample_block("FLEX", "001", "a.wav"),
            sample_block("FLEX", "001", "b.wav")
        ));
        assert_eq!(
            codec.inspect_sample_paths(&duplicate),
            Err(ReferenceRewriteError::DuplicateSlot {
                kind: "FLEX".to_owned(),
                number: 1
            })
        );

        let missing_path = synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\n[/SAMPLE]\r\n");
        assert_eq!(
            codec.inspect_sample_paths(&missing_path),
            Err(ReferenceRewriteError::MissingPath)
        );

        let two_paths = synthetic(
            "[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\nPATH=a.wav\r\nPATH=b.wav\r\n[/SAMPLE]\r\n",
        );
        assert_eq!(
            codec.inspect_sample_paths(&two_paths),
            Err(ReferenceRewriteError::DuplicatePathLine)
        );

        let (bytes, flex, _) = two_slot_document();
        assert_eq!(
            codec.apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 3),
                    from_raw_path: flex.clone(),
                    to_raw_path: rewrite_same_directory_path(&flex, "x.wav").unwrap(),
                }]
            ),
            Err(ReferenceRewriteError::TargetSlotNotFound)
        );
        assert_eq!(
            codec.apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: "other.wav".to_owned(),
                    to_raw_path: "other-2.wav".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::FromPathMismatch)
        );
        assert_eq!(
            codec.apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: flex.clone(),
                    to_raw_path: "moved.wav".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::DirectoryChangeRejected)
        );
        assert_eq!(
            codec.apply_path_patches(
                &bytes,
                &[
                    SlotPathPatch {
                        slot: slot(SampleSlotKind::Flex, 1),
                        from_raw_path: flex.clone(),
                        to_raw_path: rewrite_same_directory_path(&flex, "a.wav").unwrap(),
                    },
                    SlotPathPatch {
                        slot: slot(SampleSlotKind::Flex, 1),
                        from_raw_path: flex.clone(),
                        to_raw_path: rewrite_same_directory_path("../AUDIO/pool/kick.wav", "b.wav")
                            .unwrap(),
                    },
                ]
            ),
            Err(ReferenceRewriteError::DuplicatePatch)
        );
        assert_eq!(
            codec.apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: flex,
                    to_raw_path: "../AUDIO/pool/\u{2603}.wav".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::IrreversibleEncoding)
        );
    }

    #[test]
    fn empty_path_cannot_be_rewritten() {
        let bytes = synthetic(&sample_block("STATIC", "001", ""));
        let inspect = MemoryProjectReferenceCodec
            .inspect_sample_paths(&bytes)
            .unwrap();
        assert_eq!(inspect[0].raw_path, "");
        assert_eq!(
            MemoryProjectReferenceCodec.apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Static, 1),
                    from_raw_path: String::new(),
                    to_raw_path: "kick.wav".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::EmptyPath)
        );
    }

    #[test]
    fn real_device_fixture_noop_and_single_slot_rewrite_preserve_unknown_fields() {
        let path = real_device_project_work();
        let before_on_disk = read_fixture(&path);
        let codec = MemoryProjectReferenceCodec;
        let inspect = codec.inspect_sample_paths(&before_on_disk).unwrap();
        let flex = inspect
            .iter()
            .find(|entry| entry.slot == slot(SampleSlotKind::Flex, 33))
            .unwrap();
        let stat = inspect
            .iter()
            .find(|entry| entry.slot == slot(SampleSlotKind::Static, 5))
            .unwrap();

        let noop = codec.apply_path_patches(&before_on_disk, &[]).unwrap();
        assert_eq!(noop.bytes, before_on_disk);

        let to_flex =
            rewrite_same_directory_path(&flex.raw_path, "JM_172_D_Atmos_renamed.wav").unwrap();
        let patched = codec
            .apply_path_patches(
                &before_on_disk,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 33),
                    from_raw_path: flex.raw_path.clone(),
                    to_raw_path: to_flex.clone(),
                }],
            )
            .unwrap();
        assert_ne!(patched.bytes, before_on_disk);
        let after = codec.inspect_sample_paths(&patched.bytes).unwrap();
        assert_eq!(after.len(), inspect.len());
        for (before, observed) in inspect.iter().zip(after.iter()) {
            if before.slot == slot(SampleSlotKind::Flex, 33) {
                assert_eq!(observed.raw_path, to_flex);
            } else {
                assert_eq!(observed.raw_path, before.raw_path);
            }
        }
        assert_eq!(
            stat.raw_path,
            after
                .iter()
                .find(|entry| entry.slot == stat.slot)
                .unwrap()
                .raw_path
        );

        let original_text = decode_windows_1258(&before_on_disk).unwrap();
        let patched_text = decode_windows_1258(&patched.bytes).unwrap();
        assert_eq!(
            patched_text.matches("TRIGQUANTIZATION=-1").count(),
            original_text.matches("TRIGQUANTIZATION=-1").count()
        );
        assert_eq!(patched_text.matches("TRIGQUANTIZATION=-1").count(), 34);
        assert_eq!(patched_text.matches("TRIM_BARSx100=").count(), 15);
        assert!(patched_text.contains("TEMPOx24=3027"));
        assert!(patched_text.contains("MIDI_CLOCK_SEND=2"));
        assert!(!patched_text.contains("TRIGQUANTIZATION=255"));

        let after_on_disk = read_fixture(&path);
        assert_eq!(after_on_disk, before_on_disk);
    }

    #[test]
    fn real_device_1_40_empty_path_fixture_is_read_only() {
        let path = real_device_1_40_project_work();
        let before = read_fixture(&path);
        assert_eq!(before.len(), 2898);
        let inspect = MemoryProjectReferenceCodec
            .inspect_sample_paths(&before)
            .unwrap();
        assert!(inspect.is_empty());
        assert_eq!(
            MemoryProjectReferenceCodec.apply_path_patches(
                &before,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: String::new(),
                    to_raw_path: "kick.wav".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::EmptyPath)
        );
        let after = read_fixture(&path);
        assert_eq!(after, before);
        assert_eq!(
            MemoryProjectReferenceCodec.apply_path_patches(
                &before,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: "kick.wav".to_owned(),
                    to_raw_path: "kick-2.wav".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::TargetSlotNotFound)
        );
    }

    #[test]
    fn path_containing_sample_end_tag_does_not_truncate_the_block() {
        let bytes = synthetic(
            "[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\nPATH=foo[/SAMPLE]/bar.wav\r\n[/SAMPLE]\r\n",
        );
        assert_eq!(
            MemoryProjectReferenceCodec.inspect_sample_paths(&bytes),
            Err(ReferenceRewriteError::NestedSampleBlock)
        );
    }

    #[test]
    fn leftover_and_nested_sample_tags_fail_closed() {
        let leftover = synthetic(&format!(
            "{}\r\n[/SAMPLE]\r\n",
            sample_block("FLEX", "001", "a.wav")
        ));
        assert_eq!(
            MemoryProjectReferenceCodec.inspect_sample_paths(&leftover),
            Err(ReferenceRewriteError::UnexpectedSampleCloser)
        );

        let nested = synthetic(
            "[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\nPATH=a.wav\r\n[SAMPLE]\r\n[/SAMPLE]\r\n",
        );
        assert_eq!(
            MemoryProjectReferenceCodec.inspect_sample_paths(&nested),
            Err(ReferenceRewriteError::NestedSampleBlock)
        );

        let comment_false_start = synthetic(&format!(
            "# [SAMPLE]\r\n{}\r\n",
            sample_block("FLEX", "001", "a.wav")
        ));
        assert_eq!(
            MemoryProjectReferenceCodec.inspect_sample_paths(&comment_false_start),
            Err(ReferenceRewriteError::NestedSampleBlock)
        );
    }

    #[test]
    fn out_of_range_and_signed_slots_fail_closed() {
        let static_200 = synthetic(&sample_block("STATIC", "200", "a.wav"));
        assert_eq!(
            MemoryProjectReferenceCodec.inspect_sample_paths(&static_200),
            Err(ReferenceRewriteError::InvalidSlot)
        );

        let plus_slot =
            synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=+33\r\nPATH=a.wav\r\n[/SAMPLE]\r\n");
        assert_eq!(
            MemoryProjectReferenceCodec.inspect_sample_paths(&plus_slot),
            Err(ReferenceRewriteError::InvalidSlot)
        );
    }

    #[test]
    fn newline_in_destination_path_is_rejected_before_rewrite() {
        let (bytes, flex, _) = two_slot_document();
        assert_eq!(
            MemoryProjectReferenceCodec.apply_path_patches(
                &bytes,
                &[SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: flex,
                    to_raw_path: "../AUDIO/pool/kick.wav\n# injected".to_owned(),
                }]
            ),
            Err(ReferenceRewriteError::UnsafePathText)
        );
    }

    mod contract_tests;
}
