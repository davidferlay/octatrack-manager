//! Read-only native Bank Copy state-document evidence harness. No fixture writes.

#[cfg(test)]
mod tests {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use std::fs;
    use std::path::PathBuf;

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_copy_state_doc")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct ParsedStates {
        bank: u8,
        pattern: u8,
    }

    fn parse_states_section(project_text: &str) -> Option<ParsedStates> {
        let lines: Vec<&str> = project_text
            .lines()
            .map(|line| line.trim_end_matches('\r'))
            .collect();
        let starts: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.trim() == "[STATES]")
            .map(|(index, _)| index)
            .collect();
        if starts.len() != 1 {
            return None;
        }
        let mut bank_count = 0usize;
        let mut pattern_count = 0usize;
        let mut bank = None;
        let mut pattern = None;
        let mut closed = false;
        for line in lines.iter().skip(starts[0] + 1) {
            let trimmed = line.trim();
            if trimmed == "[/STATES]" {
                closed = true;
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("BANK=") {
                bank_count += 1;
                if let Ok(value) = rest.parse::<u16>() {
                    bank = u8::try_from(value).ok();
                }
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("PATTERN=") {
                pattern_count += 1;
                if let Ok(value) = rest.parse::<u16>() {
                    pattern = u8::try_from(value).ok();
                }
            }
        }
        if !closed || bank_count != 1 || pattern_count != 1 {
            return None;
        }
        Some(ParsedStates {
            bank: bank?,
            pattern: pattern?,
        })
    }

    fn typed_field_delta(pre: &BankFile, post: &BankFile) -> Vec<&'static str> {
        [
            ("patterns", pre.patterns != post.patterns),
            ("parts.saved", pre.parts.saved != post.parts.saved),
            ("parts.unsaved", pre.parts.unsaved != post.parts.unsaved),
            (
                "parts_saved_state",
                pre.parts_saved_state != post.parts_saved_state,
            ),
            (
                "parts_edited_bitmask",
                pre.parts_edited_bitmask != post.parts_edited_bitmask,
            ),
            ("part_names", pre.part_names != post.part_names),
        ]
        .into_iter()
        .filter_map(|(name, differs)| differs.then_some(name))
        .collect()
    }

    #[test]
    fn fixture_root_exists_and_waits_for_device_capture() {
        let root = fixture_root();
        assert!(
            root.is_dir(),
            "pse_bank_copy_state_doc fixture root must exist"
        );
        let s0 = root.join("s0_baseline_saved");
        assert!(
            !s0.join("capture.meta.json").is_file(),
            "device capture must not be fabricated in Phase A"
        );
    }

    #[test]
    fn project_states_parse_requires_close_tag_and_single_bank_pattern() {
        assert_eq!(
            parse_states_section("[STATES]\nBANK=0\nPATTERN=3\n[/STATES]\n"),
            Some(ParsedStates {
                bank: 0,
                pattern: 3
            })
        );
        assert_eq!(parse_states_section("[STATES]\nBANK=0\nPATTERN=3\n"), None);
    }

    #[test]
    fn typed_field_delta_helper_is_deterministic_on_identical_bank_files() {
        let bytes = include_bytes!("../tests/fixtures/real_device/bank01.work");
        let left = BankFile::decode(bytes).expect("decode bank01.work");
        let right = BankFile::decode(bytes).expect("decode bank01.work again");
        assert!(typed_field_delta(&left, &right).is_empty());
    }

    #[test]
    fn real_device_bank01_decodes_for_future_typed_comparison() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/real_device/bank01.work");
        let bytes = fs::read(path).expect("read real_device bank01.work");
        let _bank = BankFile::decode(&bytes).expect("decode real_device bank01.work");
    }
}
