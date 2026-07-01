// Byte-fidelity regression tests against files written by a real Octatrack (OS 1.40B).
//
// Fixtures in tests/fixtures/real_device/ were copied unmodified from a device CF card.
// Each test parses a file with ot-tools-io and re-serializes it: any byte difference
// means a refactor (or an ot-tools-io upgrade) changed how we read or write device data.

use ot_tools_io::{ArrangementFile, BankFile, MarkersFile, OctatrackFileIO, ProjectFile};
use std::path::PathBuf;

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/real_device")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("cannot read fixture {name}: {e}"))
}

fn assert_roundtrip<T: OctatrackFileIO>(name: &str) {
    let original = fixture(name);
    let parsed = T::from_bytes(&original).unwrap_or_else(|e| panic!("cannot parse {name}: {e}"));
    let written = parsed
        .to_bytes()
        .unwrap_or_else(|e| panic!("cannot serialize {name}: {e}"));
    assert_eq!(
        written.len(),
        original.len(),
        "{name}: serialized length differs from device file"
    );
    if written != original {
        let first_diff = written
            .iter()
            .zip(original.iter())
            .position(|(a, b)| a != b)
            .unwrap();
        panic!(
            "{name}: serialized bytes differ from device file (first difference at offset {first_diff:#x})"
        );
    }
}

#[test]
fn bank_work_roundtrips_byte_identical() {
    assert_roundtrip::<BankFile>("bank01.work");
}

#[test]
fn bank_strd_roundtrips_byte_identical() {
    assert_roundtrip::<BankFile>("bank01.strd");
}

#[test]
fn markers_work_roundtrips_byte_identical() {
    assert_roundtrip::<MarkersFile>("markers.work");
}

#[test]
fn arrangement_work_roundtrips_byte_identical() {
    assert_roundtrip::<ArrangementFile>("arr01.work");
}

// project.work does NOT roundtrip byte-identical through ot-tools-io: on this fixture a
// full rewrite flips TRIGQUANTIZATION=-1 to 255 (34x), drops TRIM_BARSx100 (15x), and
// rewrites TEMPOx24=3027 as 3024 and MIDI_CLOCK_SEND=2 as 0. That is why the app edits
// project.work surgically as text (see replace_sample_fields_surgical in project_reader.rs);
// the surgical path is pinned by real_device_fixture_tests in that module. Here we only
// guard that parsing device files keeps working and that serialization is stable.
#[test]
fn project_work_parses_and_reserializes_stably() {
    let original = fixture("project.work");
    let parsed = ProjectFile::from_bytes(&original).expect("cannot parse device project.work");
    let first = parsed.to_bytes().expect("cannot serialize project.work");
    let reparsed = ProjectFile::from_bytes(&first).expect("cannot reparse serialized project.work");
    let second = reparsed
        .to_bytes()
        .expect("cannot reserialize project.work");
    assert_eq!(
        first, second,
        "ProjectFile serialization is not stable across a parse/write cycle"
    );
}
