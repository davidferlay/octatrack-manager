//! Map Bank machine-slot raw bytes to [`TrackSlotReference`] without inactive-side fields.

use crate::project_structure::{MachineKind, TrackSlotReference};
use crate::{RecorderBufferId, SampleSlotId, SampleSlotKind};

pub const BANK_MACHINE_UNASSIGNED_SLOT: u8 = 255;

/// Map a Bank machine slot raw value to a 0-based usage pool index (slots 1–128).
pub fn bank_machine_slot_to_pool_index(slot_id: u8) -> Option<usize> {
    match slot_id {
        BANK_MACHINE_UNASSIGNED_SLOT => None,
        0..=127 => Some(slot_id as usize),
        _ => None,
    }
}

pub fn track_slot_reference_from_machine(
    machine: MachineKind,
    static_slot_id: u8,
    flex_slot_id: u8,
) -> TrackSlotReference {
    match machine {
        MachineKind::Static => {
            track_slot_reference_from_raw(SampleSlotKind::Static, static_slot_id)
        }
        MachineKind::Flex => track_slot_reference_from_raw(SampleSlotKind::Flex, flex_slot_id),
        _ => TrackSlotReference::NoSampleMachine,
    }
}

pub fn track_slot_reference_from_raw(kind: SampleSlotKind, raw: u8) -> TrackSlotReference {
    if raw == BANK_MACHINE_UNASSIGNED_SLOT {
        return TrackSlotReference::Unassigned;
    }
    if let Some(index) = bank_machine_slot_to_pool_index(raw) {
        return u16::try_from(index + 1)
            .ok()
            .and_then(|number| SampleSlotId::new(kind, number).ok())
            .map_or(
                TrackSlotReference::Unrecognized(raw),
                TrackSlotReference::Slot,
            );
    }
    if kind == SampleSlotKind::Flex {
        if let Ok(buffer) = RecorderBufferId::new(u16::from(raw)) {
            return TrackSlotReference::RecorderBuffer(buffer);
        }
    }
    TrackSlotReference::Unrecognized(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SampleSlotKind;

    #[test]
    fn recorder_buffer_type_is_preserved() {
        let slot = track_slot_reference_from_raw(SampleSlotKind::Flex, 129);
        assert!(matches!(slot, TrackSlotReference::RecorderBuffer(_)));
    }

    #[test]
    fn unrecognized_reference_is_preserved() {
        let slot = track_slot_reference_from_raw(SampleSlotKind::Static, 200);
        assert_eq!(slot, TrackSlotReference::Unrecognized(200));
    }

    #[test]
    fn recorder_slot_id_is_not_sample_slot() {
        let slot = track_slot_reference_from_raw(SampleSlotKind::Flex, 131);
        assert!(!matches!(slot, TrackSlotReference::Slot(_)));
    }
}
