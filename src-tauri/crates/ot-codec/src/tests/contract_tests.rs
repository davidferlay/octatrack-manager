use super::{read_fixture, real_device_project_work, sample_block, slot, synthetic};
use crate::{decode_windows_1258, rewrite_same_directory_path, MemoryProjectReferenceCodec};
use ot_codec_ports::{
    EncodedPatch, ProjectReferenceCodec, ReferenceRewriteError, SlotPathPatch, SlotPathRef,
};
use ot_domain::{SampleSlotId, SampleSlotKind};
use ot_tools_io::{OctatrackFileIO, ProjectFile};

const FLEX_33_PATH: &str = "../AUDIO/Loopmasters/Loops/Drum & Bass/Music Loops/JM_172_D_Atmos.wav";
const STATIC_33_PATH: &str =
    "../AUDIO/Loopmasters/Sounds and FX/Drum Hits/Claps & Snares/BRS_Clap.wav";
const FLEX_33_RENAMED: &str = "JM_172_D_Atmos_renamed.wav";

fn codec() -> MemoryProjectReferenceCodec {
    MemoryProjectReferenceCodec
}

fn apply(
    bytes: &[u8],
    target: SampleSlotId,
    from: &str,
    to: &str,
) -> Result<EncodedPatch, ReferenceRewriteError> {
    codec().apply_path_patches(
        bytes,
        &[SlotPathPatch {
            slot: target,
            from_raw_path: from.to_owned(),
            to_raw_path: to.to_owned(),
        }],
    )
}

fn with_real_device_fixture<R>(run: impl FnOnce(&[u8]) -> R) -> R {
    let path = real_device_project_work();
    let before = read_fixture(&path);
    let result = run(&before);
    let after = read_fixture(&path);
    assert_eq!(
        after, before,
        "tracked real_device/project.work must stay read-only"
    );
    result
}

fn replace_unique_bytes(haystack: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    let matches = haystack
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count();
    assert_eq!(
        matches, 1,
        "expected the PATH value to appear exactly once in the document"
    );
    let start = haystack
        .windows(needle.len())
        .position(|window| window == needle)
        .expect("unique PATH value");
    let mut output = Vec::with_capacity(haystack.len() - needle.len() + replacement.len());
    output.extend_from_slice(&haystack[..start]);
    output.extend_from_slice(replacement);
    output.extend_from_slice(&haystack[start + needle.len()..]);
    output
}

fn line_windows_equal(text: &str, expected: &[&str]) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    lines
        .windows(expected.len())
        .any(|window| window == expected)
}

fn rewrite_flex_33(original: &[u8]) -> (EncodedPatch, String) {
    let inspect = codec().inspect_sample_paths(original).unwrap();
    let flex = inspect
        .iter()
        .find(|entry| entry.slot == slot(SampleSlotKind::Flex, 33))
        .unwrap();
    assert_eq!(flex.raw_path, FLEX_33_PATH);
    let to = rewrite_same_directory_path(&flex.raw_path, FLEX_33_RENAMED).unwrap();
    let patched = apply(original, flex.slot, &flex.raw_path, &to).unwrap();
    (patched, to)
}

fn three_slot_document() -> (Vec<u8>, String, String, String) {
    let flex = "../AUDIO/pool/kick.wav";
    let stat = "../AUDIO/pool/snare.wav";
    let local = "local-hat.wav";
    let text = format!(
        "[META]\r\nVERSION=19\r\n[/META]\r\n\r\n{}\r\n\r\n{}\r\n\r\n{}\r\n",
        sample_block("FLEX", "001", flex),
        sample_block("STATIC", "002", stat),
        sample_block("FLEX", "003", local)
    );
    (
        synthetic(&text),
        flex.to_owned(),
        stat.to_owned(),
        local.to_owned(),
    )
}

/// C1 — the only byte delta is the targeted PATH value.
#[test]
fn real_device_rewrite_changes_only_target_path_value_bytes() {
    with_real_device_fixture(|original| {
        let (patched, to) = rewrite_flex_33(original);
        let expected = replace_unique_bytes(original, FLEX_33_PATH.as_bytes(), to.as_bytes());
        assert_eq!(patched.bytes, expected);
        assert_eq!(patched.changed_slots, vec![slot(SampleSlotKind::Flex, 33)]);
    });
}

/// C2 — Flex 33 and Static 33 are distinct identities; SLOT=033 is kept.
#[test]
fn real_device_flex_033_rewrite_leaves_static_033_untouched() {
    with_real_device_fixture(|original| {
        let original_text = decode_windows_1258(original).unwrap();
        assert_eq!(original_text.matches("SLOT=033").count(), 2);
        assert!(line_windows_equal(
            &original_text,
            &["TYPE=FLEX", "SLOT=033", &format!("PATH={FLEX_33_PATH}")]
        ));
        assert!(line_windows_equal(
            &original_text,
            &["TYPE=STATIC", "SLOT=033", &format!("PATH={STATIC_33_PATH}")]
        ));

        let (patched, to) = rewrite_flex_33(original);
        let after = codec().inspect_sample_paths(&patched.bytes).unwrap();
        let stat = after
            .iter()
            .find(|entry| entry.slot == slot(SampleSlotKind::Static, 33))
            .unwrap();
        assert_eq!(stat.raw_path, STATIC_33_PATH);
        assert_eq!(
            after
                .iter()
                .find(|entry| entry.slot == slot(SampleSlotKind::Flex, 33))
                .unwrap()
                .raw_path,
            to
        );

        let patched_text = decode_windows_1258(&patched.bytes).unwrap();
        assert_eq!(patched_text.matches("SLOT=033").count(), 2);
        assert!(line_windows_equal(
            &patched_text,
            &["TYPE=FLEX", "SLOT=033", &format!("PATH={to}")]
        ));
        assert!(line_windows_equal(
            &patched_text,
            &["TYPE=STATIC", "SLOT=033", &format!("PATH={STATIC_33_PATH}")]
        ));
    });
}

/// C3 — Flex recorder buffers 129–136 stay empty and uninspectable.
#[test]
fn real_device_recorder_flex_129_136_remain_empty_after_rewrite() {
    with_real_device_fixture(|original| {
        let before = codec().inspect_sample_paths(original).unwrap();
        assert!(before.iter().all(|entry| entry.slot.number() <= 128));

        let (patched, _) = rewrite_flex_33(original);
        let after = codec().inspect_sample_paths(&patched.bytes).unwrap();
        assert!(after.iter().all(|entry| entry.slot.number() <= 128));
        assert_eq!(after.len(), before.len());

        let patched_text = decode_windows_1258(&patched.bytes).unwrap();
        for number in 129u16..=136 {
            let slot_line = format!("SLOT={number:03}");
            assert!(line_windows_equal(
                &patched_text,
                &["TYPE=FLEX", &slot_line, "PATH="]
            ));
        }
    });
}

/// C4 — two of three synthetic slots can be patched independently.
#[test]
fn apply_rewrites_two_slots_and_leaves_the_third() {
    let (bytes, flex, stat, local) = three_slot_document();
    let to_flex = rewrite_same_directory_path(&flex, "kick-2.wav").unwrap();
    let to_local = rewrite_same_directory_path(&local, "local-hat-2.wav").unwrap();
    let patched = codec()
        .apply_path_patches(
            &bytes,
            &[
                SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 1),
                    from_raw_path: flex,
                    to_raw_path: to_flex.clone(),
                },
                SlotPathPatch {
                    slot: slot(SampleSlotKind::Flex, 3),
                    from_raw_path: local,
                    to_raw_path: to_local.clone(),
                },
            ],
        )
        .unwrap();
    assert_eq!(
        patched.changed_slots,
        vec![slot(SampleSlotKind::Flex, 1), slot(SampleSlotKind::Flex, 3)]
    );
    let inspect = codec().inspect_sample_paths(&patched.bytes).unwrap();
    assert_eq!(
        inspect
            .iter()
            .map(|entry| entry.raw_path.as_str())
            .collect::<Vec<_>>(),
        vec![to_flex.as_str(), stat.as_str(), to_local.as_str()]
    );
}

/// C5 — working and saved documents with distinct PATH values are independent.
#[test]
fn working_and_saved_with_distinct_paths_are_patched_independently() {
    let working_path = "../AUDIO/pool/kick.wav";
    let saved_path = "../AUDIO/pool/kick-saved.wav";
    let working = synthetic(&format!(
        "{}\r\n",
        sample_block("FLEX", "001", working_path)
    ));
    let saved = synthetic(&format!("{}\r\n", sample_block("FLEX", "001", saved_path)));
    let to_working = rewrite_same_directory_path(working_path, "kick-b.wav").unwrap();
    let to_saved = rewrite_same_directory_path(saved_path, "kick-saved-b.wav").unwrap();

    let working_patched = apply(
        &working,
        slot(SampleSlotKind::Flex, 1),
        working_path,
        &to_working,
    )
    .unwrap();
    assert_eq!(
        codec().inspect_sample_paths(&saved).unwrap()[0].raw_path,
        saved_path
    );
    assert_eq!(
        codec()
            .inspect_sample_paths(&working_patched.bytes)
            .unwrap()[0]
            .raw_path,
        to_working
    );

    let saved_patched =
        apply(&saved, slot(SampleSlotKind::Flex, 1), saved_path, &to_saved).unwrap();
    assert_eq!(
        codec().inspect_sample_paths(&saved_patched.bytes).unwrap()[0].raw_path,
        to_saved
    );
    assert_ne!(working_patched.bytes, saved_patched.bytes);
    assert_ne!(working_patched.bytes, saved);
}

/// C6 — observed directory text including spaces and `&` survives basename rewrite.
#[test]
fn real_device_space_and_ampersand_prefix_survives_basename_rewrite() {
    with_real_device_fixture(|original| {
        let (patched, to) = rewrite_flex_33(original);
        assert!(to.contains("Drum & Bass"));
        assert!(to.ends_with(FLEX_33_RENAMED));
        let patched_text = decode_windows_1258(&patched.bytes).unwrap();
        assert!(patched_text.contains("Drum & Bass/Music Loops/JM_172_D_Atmos_renamed.wav"));
        assert!(!patched_text.contains(FLEX_33_PATH));
    });
}

/// C7 — a backslash separator is kept by apply, not only by the helper.
#[test]
fn apply_preserves_backslash_separator() {
    let from = "folder\\kick.wav";
    let bytes = synthetic(&format!("{}\r\n", sample_block("FLEX", "001", from)));
    let to = rewrite_same_directory_path(from, "kick-2.wav").unwrap();
    assert_eq!(to, "folder\\kick-2.wav");
    let patched = apply(&bytes, slot(SampleSlotKind::Flex, 1), from, &to).unwrap();
    assert_eq!(
        codec().inspect_sample_paths(&patched.bytes).unwrap()[0].raw_path,
        to
    );
    let text = decode_windows_1258(&patched.bytes).unwrap();
    assert!(text.contains("PATH=folder\\kick-2.wav"));
    assert!(!text.contains("folder/kick"));
}

/// C8 — a project-local basename is rewritten without inventing `../`.
#[test]
fn apply_renames_project_local_basename_only() {
    let from = "kick.wav";
    let bytes = synthetic(&format!("{}\r\n", sample_block("FLEX", "001", from)));
    let to = rewrite_same_directory_path(from, "kick-2.wav").unwrap();
    assert_eq!(to, "kick-2.wav");
    let patched = apply(&bytes, slot(SampleSlotKind::Flex, 1), from, &to).unwrap();
    let text = decode_windows_1258(&patched.bytes).unwrap();
    assert!(text.contains("PATH=kick-2.wav"));
    assert!(!text.contains("../"));
    assert!(!text.contains('\\'));
}

/// C9 — surgical rewrite is not `ProjectFile::to_bytes`.
#[test]
fn real_device_rewrite_is_not_ot_tools_io_full_serialize() {
    with_real_device_fixture(|original| {
        let noop = codec().apply_path_patches(original, &[]).unwrap();
        assert_eq!(noop.bytes, original);

        let parsed = ProjectFile::from_bytes(original).expect("ot-tools-io parses fixture");
        let serialized = parsed.to_bytes().expect("ot-tools-io serializes fixture");
        assert_ne!(
            serialized, original,
            "ot-tools-io full serialize is lossy on this fixture"
        );

        let (patched, _) = rewrite_flex_33(original);
        assert_ne!(patched.bytes, serialized);

        let original_text = decode_windows_1258(original).unwrap();
        let patched_text = decode_windows_1258(&patched.bytes).unwrap();
        let serialized_text = String::from_utf8_lossy(&serialized);
        assert_eq!(original_text.matches("TRIM_BARSx100=").count(), 15);
        assert_eq!(patched_text.matches("TRIM_BARSx100=").count(), 15);
        assert!(
            serialized_text.matches("TRIM_BARSx100=").count() < 15,
            "full serialize must not be the surgical PATH rewrite"
        );
        assert_eq!(
            patched_text.matches("TRIGQUANTIZATION=-1").count(),
            original_text.matches("TRIGQUANTIZATION=-1").count()
        );
    });
}

/// C10 — lowercase sample tags are not accepted as blocks.
#[test]
fn lowercase_sample_tags_fail_closed() {
    let lowercase = synthetic("[sample]\r\nTYPE=FLEX\r\nSLOT=001\r\nPATH=a.wav\r\n[/sample]\r\n");
    assert_eq!(
        codec().inspect_sample_paths(&lowercase),
        Err(ReferenceRewriteError::NestedSampleBlock)
    );

    let mixed = synthetic(&format!(
        "[sample]\r\n{}\r\n",
        sample_block("FLEX", "001", "a.wav")
    ));
    assert_eq!(
        codec().inspect_sample_paths(&mixed),
        Err(ReferenceRewriteError::NestedSampleBlock)
    );
}

/// C11 — a lowercase `path=` key is preserved through rewrite.
#[test]
fn lowercase_path_key_is_preserved() {
    let bytes = synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\npath=kick.wav\r\n[/SAMPLE]\r\n");
    let patched = apply(
        &bytes,
        slot(SampleSlotKind::Flex, 1),
        "kick.wav",
        "kick-2.wav",
    )
    .unwrap();
    let text = decode_windows_1258(&patched.bytes).unwrap();
    assert!(text.contains("path=kick-2.wav"));
    assert!(!text.contains("PATH=kick-2.wav"));
    assert!(!text.contains("path=kick.wav"));
}

/// C12 — zero-padded SLOT text is not normalized.
#[test]
fn zero_padded_slot_line_is_preserved() {
    let bytes = synthetic(&format!("{}\r\n", sample_block("FLEX", "033", "kick.wav")));
    let patched = apply(
        &bytes,
        slot(SampleSlotKind::Flex, 33),
        "kick.wav",
        "kick-2.wav",
    )
    .unwrap();
    let text = decode_windows_1258(&patched.bytes).unwrap();
    assert!(text.contains("SLOT=033"));
    assert!(!text.contains("SLOT=33\r"));
    assert!(!text.contains("SLOT=33\n"));
}

/// C13 — irreversible source bytes fail inspect when a 1258 identity
/// mismatch exists. `encoding_rs::WINDOWS_1258` is byte-bijective for all
/// 256 values, so inspect cannot observe a non-identity document; the
/// reachable `IrreversibleEncoding` path is apply-time encode of an
/// unmappable destination.
#[test]
fn irreversible_source_bytes_fail_inspect() {
    let mut non_identity = Vec::new();
    for byte in 0u8..=255 {
        let source = [byte];
        let (decoded, _, had_errors) = encoding_rs::WINDOWS_1258.decode(&source);
        let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(decoded.as_ref());
        if had_errors || had_unmappable || encoded.as_ref() != [byte] {
            non_identity.push(byte);
        }
    }

    if let Some(&byte) = non_identity.first() {
        let mut bytes = synthetic(&format!("{}\r\n", sample_block("FLEX", "001", "a.wav")));
        bytes.push(byte);
        assert_eq!(
            codec().inspect_sample_paths(&bytes),
            Err(ReferenceRewriteError::IrreversibleEncoding)
        );
        return;
    }

    let bytes = synthetic(&format!("{}\r\n", sample_block("FLEX", "001", "a.wav")));
    assert_eq!(
        codec().inspect_sample_paths(&bytes),
        Ok(vec![SlotPathRef {
            slot: slot(SampleSlotKind::Flex, 1),
            raw_path: "a.wav".to_owned(),
        }])
    );
    assert_eq!(
        apply(
            &bytes,
            slot(SampleSlotKind::Flex, 1),
            "a.wav",
            "\u{2603}.wav"
        ),
        Err(ReferenceRewriteError::IrreversibleEncoding)
    );
}

/// C14 — `.` and `..` are not valid destination basenames.
#[test]
fn rewrite_rejects_dot_and_dotdot_basename() {
    assert_eq!(
        rewrite_same_directory_path("kick.wav", "."),
        Err(ReferenceRewriteError::InvalidBasename)
    );
    assert_eq!(
        rewrite_same_directory_path("kick.wav", ".."),
        Err(ReferenceRewriteError::InvalidBasename)
    );
    assert_eq!(
        rewrite_same_directory_path("../AUDIO/pool/kick.wav", ".."),
        Err(ReferenceRewriteError::InvalidBasename)
    );

    let (bytes, flex, _) = super::two_slot_document();
    assert_eq!(
        apply(
            &bytes,
            slot(SampleSlotKind::Flex, 1),
            &flex,
            "../AUDIO/pool/."
        ),
        Err(ReferenceRewriteError::InvalidBasename)
    );
    assert_eq!(
        apply(
            &bytes,
            slot(SampleSlotKind::Flex, 1),
            &flex,
            "../AUDIO/pool/.."
        ),
        Err(ReferenceRewriteError::InvalidBasename)
    );
}

/// C15 — changing `/` to `\` (or the reverse) is a directory change, not a rename.
#[test]
fn apply_rejects_separator_style_change() {
    let from = "../AUDIO/a.wav";
    let bytes = synthetic(&format!("{}\r\n", sample_block("FLEX", "001", from)));
    assert_eq!(
        apply(
            &bytes,
            slot(SampleSlotKind::Flex, 1),
            from,
            "../AUDIO\\a.wav"
        ),
        Err(ReferenceRewriteError::DirectoryChangeRejected)
    );

    let from_backslash = "folder\\kick.wav";
    let backslash_doc = synthetic(&format!(
        "{}\r\n",
        sample_block("FLEX", "001", from_backslash)
    ));
    assert_eq!(
        apply(
            &backslash_doc,
            slot(SampleSlotKind::Flex, 1),
            from_backslash,
            "folder/kick-2.wav"
        ),
        Err(ReferenceRewriteError::DirectoryChangeRejected)
    );
}

#[test]
fn leading_space_on_path_line_is_missing_path() {
    let bytes = synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\n PATH=a.wav\r\n[/SAMPLE]\r\n");
    assert_eq!(
        codec().inspect_sample_paths(&bytes),
        Err(ReferenceRewriteError::MissingPath)
    );
}

#[test]
fn unsupported_type_recorder_fails() {
    let bytes = synthetic(&sample_block("RECORDER", "001", "a.wav"));
    assert_eq!(
        codec().inspect_sample_paths(&bytes),
        Err(ReferenceRewriteError::UnsupportedSlotType)
    );
}

#[test]
fn missing_type_and_missing_slot_fail() {
    let missing_type = synthetic("[SAMPLE]\r\nSLOT=001\r\nPATH=a.wav\r\n[/SAMPLE]\r\n");
    assert_eq!(
        codec().inspect_sample_paths(&missing_type),
        Err(ReferenceRewriteError::MissingType)
    );

    let missing_slot = synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nPATH=a.wav\r\n[/SAMPLE]\r\n");
    assert_eq!(
        codec().inspect_sample_paths(&missing_slot),
        Err(ReferenceRewriteError::MissingSlot)
    );
}

#[test]
fn nul_in_path_fails() {
    let with_nul = synthetic("[SAMPLE]\r\nTYPE=FLEX\r\nSLOT=001\r\nPATH=a\0.wav\r\n[/SAMPLE]\r\n");
    assert_eq!(
        codec().inspect_sample_paths(&with_nul),
        Err(ReferenceRewriteError::UnsafePathText)
    );

    let (bytes, flex, _) = super::two_slot_document();
    assert_eq!(
        apply(
            &bytes,
            slot(SampleSlotKind::Flex, 1),
            &flex,
            "../AUDIO/pool/kick\0.wav"
        ),
        Err(ReferenceRewriteError::UnsafePathText)
    );
}

#[test]
fn from_equals_to_on_real_device_is_byte_identical() {
    with_real_device_fixture(|original| {
        let patched = apply(
            original,
            slot(SampleSlotKind::Flex, 33),
            FLEX_33_PATH,
            FLEX_33_PATH,
        )
        .unwrap();
        assert_eq!(patched.bytes, original);
        assert!(patched.changed_slots.is_empty());
    });
}

#[test]
fn inspect_order_matches_document_order() {
    let text = format!(
        "{}\r\n{}\r\n{}\r\n{}\r\n",
        sample_block("STATIC", "005", "e.wav"),
        sample_block("FLEX", "002", "b.wav"),
        sample_block("FLEX", "129", ""),
        sample_block("STATIC", "001", "a.wav")
    );
    let bytes = synthetic(&text);
    let inspect = codec().inspect_sample_paths(&bytes).unwrap();
    let slots: Vec<SlotPathRef> = inspect;
    assert_eq!(
        slots
            .iter()
            .map(|entry| (entry.slot, entry.raw_path.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (slot(SampleSlotKind::Static, 5), "e.wav"),
            (slot(SampleSlotKind::Flex, 2), "b.wav"),
            (slot(SampleSlotKind::Static, 1), "a.wav"),
        ]
    );
}

#[test]
fn apply_does_not_inject_crlf_into_lf_only_document() {
    let from = "kick.wav";
    let bytes = synthetic(&format!(
        "[SAMPLE]\nTYPE=FLEX\nSLOT=001\nPATH={from}\n[/SAMPLE]\n"
    ));
    assert!(
        !decode_windows_1258(&bytes).unwrap().contains('\r'),
        "precondition: LF-only source"
    );
    let patched = apply(&bytes, slot(SampleSlotKind::Flex, 1), from, "kick-2.wav").unwrap();
    let text = decode_windows_1258(&patched.bytes).unwrap();
    assert!(text.contains("PATH=kick-2.wav"));
    assert!(!text.contains('\r'));
    assert!(!patched.bytes.contains(&b'\r'));
}
