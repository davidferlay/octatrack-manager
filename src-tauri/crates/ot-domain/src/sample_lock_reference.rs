//! Pure sample-lock field selection and audibility (#209). Shared by usage scan
//! and Bank ChangePlan reference inventory.

pub const SAMPLE_LOCK_SCAN_STEPS: usize = 64;

/// Effective pattern track length for sample-lock audibility (capped at 64 steps).
pub fn effective_sample_lock_track_length(
    scale_mode: u8,
    master_len: u8,
    per_track_len: u8,
) -> usize {
    let length = if scale_mode == 1 {
        per_track_len
    } else {
        master_len
    };
    (length as usize).min(SAMPLE_LOCK_SCAN_STEPS)
}

/// Raw machine-slot byte read from the correct pool for a sample lock.
pub fn locked_sample_slot_raw(
    machine_type: u8,
    static_slot_id: u8,
    flex_slot_id: u8,
) -> Option<u8> {
    match machine_type {
        0 => Some(static_slot_id),
        1 => Some(flex_slot_id),
        _ => None,
    }
}

pub fn sample_lock_is_audible(step_index: usize, track_length: usize) -> bool {
    step_index < track_length
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_sample_lock_uses_static_slot() {
        assert_eq!(locked_sample_slot_raw(0, 7, 99), Some(7));
    }

    #[test]
    fn flex_sample_lock_uses_flex_slot() {
        assert_eq!(locked_sample_slot_raw(1, 99, 8), Some(8));
    }

    #[test]
    fn sample_lock_scans_all_64_steps_constant() {
        assert_eq!(SAMPLE_LOCK_SCAN_STEPS, 64);
    }

    #[test]
    fn inaudible_leftover_lock_is_preserved_in_audibility_flag() {
        let track_length = effective_sample_lock_track_length(0, 4, 0);
        assert!(!sample_lock_is_audible(10, track_length));
        assert!(sample_lock_is_audible(3, track_length));
    }
}
