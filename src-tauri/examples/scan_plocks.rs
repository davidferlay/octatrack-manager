// Debug utility: scan a project for machine parameter locks (esp. STRT/param2, used as
// slice selector in slice mode) and print slot slice counts from markers.work.
// Usage: cargo run --example scan_plocks -- <project_dir>
use ot_tools_io::{BankFile, MarkersFile, OctatrackFileIO};
use std::path::Path;

fn main() {
    let dir = std::env::args().nth(1).expect("project dir");
    let dir = Path::new(&dir);

    let markers = MarkersFile::from_data_file(&dir.join("markers.work")).expect("markers");
    for (i, slot) in markers.static_slots.iter().enumerate() {
        if slot.slice_count > 0 {
            println!("static slot {:3}: {} slices", i + 1, slot.slice_count);
        }
    }
    for (i, slot) in markers.flex_slots.iter().enumerate() {
        if slot.slice_count > 0 {
            println!("flex slot {:3}: {} slices", i + 1, slot.slice_count);
        }
    }

    for bank_no in 1..=16 {
        let path = dir.join(format!("bank{:02}.work", bank_no));
        if !path.exists() {
            continue;
        }
        let bank = match BankFile::from_data_file(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        for (part_no, part) in bank.parts.unsaved.0.iter().enumerate() {
            for t in 0..8 {
                let setup = &part.audio_track_machine_setup[t];
                let slot = &part.audio_track_machine_slots[t];
                let mtype = part.audio_track_machine_types[t];
                if mtype <= 1 {
                    println!(
                        "bank {:2} part {} track {}: machine={} slot(static={},flex={}) slic(static={},flex={})",
                        bank_no, part_no + 1, t + 1, mtype,
                        slot.static_slot_id, slot.flex_slot_id,
                        setup.static_machine.slic, setup.flex_machine.slic
                    );
                }
            }
        }
        for (p, pattern) in bank.patterns.0.iter().enumerate() {
            for (t, track) in pattern.audio_track_trigs.0.iter().enumerate() {
                for (s, plocks) in track.plocks.0.iter().enumerate() {
                    let m = &plocks.machine;
                    let vals = [m.param1, m.param2, m.param3, m.param4, m.param5, m.param6];
                    if vals.iter().any(|&v| v != 255) {
                        println!(
                            "bank {:2} pattern {:2} track {} step {:2}: machine={:?} static_slot={} flex_slot={}",
                            bank_no,
                            p + 1,
                            t + 1,
                            s + 1,
                            vals,
                            plocks.static_slot_id,
                            plocks.flex_slot_id
                        );
                    }
                }
            }
        }
    }
}
