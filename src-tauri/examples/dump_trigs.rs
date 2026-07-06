// Debug utility: dump raw trig data for a bank/pattern/track to verify mask decoding
// against ground truth from a real project. Usage:
//   cargo run --example dump_trigs -- <bank_file> <pattern_idx> <track_idx>
use ot_tools_io::{BankFile, OctatrackFileIO};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bank_path = &args[1];
    let pattern_idx: usize = args[2].parse().unwrap();
    let track_idx: usize = args[3].parse().unwrap();

    let bank = BankFile::from_data_file(std::path::Path::new(bank_path)).expect("load bank");
    let pattern = &bank.patterns.0[pattern_idx];
    let track = &pattern.audio_track_trigs.0[track_idx];
    let m = &track.trig_masks;

    println!("swing_amount: {}", track.swing_amount);
    println!("trigger:  {:?}", m.trigger);
    println!("trigless: {:?}", m.trigless);
    println!("plock:    {:?}", m.plock);
    println!("oneshot:  {:?}", m.oneshot);
    println!("swing:    {:?}", m.swing);
    println!("slide:    {:?}", m.slide);
    println!("recorder: {:?}", m.recorder);
    println!("unknown_3: {:?}", track.unknown_3);

    println!("\nper-step (non-default only):");
    for (i, plocks) in track.plocks.0.iter().enumerate() {
        let mach = &plocks.machine;
        let machine_vals = [
            mach.param1,
            mach.param2,
            mach.param3,
            mach.param4,
            mach.param5,
            mach.param6,
        ];
        let orc = track.trig_offsets_repeats_conditions[i];
        let has_plock = machine_vals.iter().any(|&v| v != 255)
            || plocks.static_slot_id != 255
            || plocks.flex_slot_id != 255;
        if has_plock || orc != [0, 0] {
            println!(
                "step {:2}: machine={:?} static_slot={} flex_slot={} offs_rep_cond={:?}",
                i + 1,
                machine_vals,
                plocks.static_slot_id,
                plocks.flex_slot_id,
                orc
            );
        }
    }
}
