# Tools Tab - Manual QA Test Cases

## Prerequisites

- At least 2 Octatrack projects (ideally in the same Set for Audio Pool tests)
- Projects with sample data in Static and Flex slots
- Projects with patterns containing triggers and parameter locks
- Projects with customized Parts (different machine types, FX)



## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Copy Banks** | | | | |
| SM1 OK | Copy Banks | Copy single bank | Copy Bank A → Bank B (same project) | Bank B Parts + Patterns match Bank A |
| SM2 OK | Copy Banks | Copy to multiple banks | Copy Bank A → Banks B, C, D | All 3 destination banks match source |
| SM3 OK | Copy Banks | Cross-project copy | Copy Bank A from Project1 → Bank B in Project2 | Open Project2, verify Bank B data matches |
| **Copy Parts** | | | | |
| SM4 OK | Copy Parts | Copy single part | Copy Part 1 → Part 3 | Part 3 machines, amps, LFOs, FX match Part 1 |
| SM5 OK | Copy Parts | Copy All parts | Click source "All", execute | All 4 Parts copied including names |
| SM6 OK | Copy Parts | Cross-bank copy | Copy Part 1 Bank A → Part 2 Bank B | Bank B Part 2 matches Bank A Part 1 |
| SM7 | Copy Parts | Part names copied | Copy Part with custom name | Destination Part name matches source |
| SM8 OK | Copy Parts | Saved state copied | Copy a Part, check saved/unsaved states | Both saved and unsaved state copied to destination |
| SM9 OK | Copy Parts | Edited bitmask mirrored | Copy non-edited Part to destination | Destination edited bit cleared (mirrors source) |
| **Copy Patterns** | | | | |
| SM10 OK | Copy Patterns | Copy single pattern | Copy Pattern 1 → Pattern 5 | Pattern 5 trigs and data match Pattern 1 |
| SM11 OK | Copy Patterns | Copy All patterns 1-to-1 | Source All, execute | All 16 Patterns copied to destination 1-to-1 |
| SM12 OK | Copy Patterns | Copy single to multiple | Copy Pattern 1 → Patterns 5, 8, 12 | All 3 destination patterns match source Pattern 1 |
| SM13 OK | Copy Patterns | Cross-bank pattern copy | Copy Pattern 1 Bank A → Pattern 3 Bank C | Bank C Pattern 3 matches Bank A Pattern 1 |
| SM14 | Copy Patterns | Keep Original Part mode | Copy pattern with "Keep Original" | Copied pattern retains the **destination** pattern's existing Part assignment (not the source's) |
| SM15 | Copy Patterns | Copy Source Part mode | Copy pattern with "Copy Source" | Part data also copied, pattern references copied Part |
| SM16 OK | Copy Patterns | User Selection Part mode | Copy pattern with "User Selection" Part = Part 3 | Copied pattern assigned to Part 3 |
| SM17 OK | Copy Patterns | All Tracks copies everything | Copy pattern with "All Tracks" | All 16 tracks (T1-T8 + M1-M8) copied per Mode Scope |
| SM18 OK | Copy Patterns | Specific Tracks copies subset | Copy Pattern 1 with Specific Tracks (T1, T2 only) | Only T1, T2 trigs copied; other tracks untouched |
| SM19 OK | Copy Patterns | Audio scope copies only T1-T8 | Copy pattern with Mode Scope = Audio | Only audio track trigs copied; MIDI trigs untouched in destination |
| SM20 OK | Copy Patterns | Both scope copies all tracks | Copy pattern with Mode Scope = Both | Both audio and MIDI trigs copied |
| SM21 OK | Copy Patterns | MIDI scope copies only M1-M8 | Copy pattern with Mode Scope = MIDI | Only MIDI track trigs copied; audio trigs untouched in destination |
| **Copy Tracks** | | | | |
| SM22 | Copy Tracks | Audio single track | Copy T1 → T3 (Part params) | T3 Part params match T1 (both saved and unsaved state, part name, saved_state flag, edited bitmask) |
| SM23 OK | Copy Tracks | Audio All tracks | Source/Dest All Audio, execute | All 8 audio tracks copied |
| SM24 OK | Copy Tracks | MIDI single track | Copy M1 → M2 (Part params) | MIDI params, arp sequences, custom LFO match source |
| SM25 OK | Copy Tracks | MIDI All tracks | Source/Dest All MIDI, execute | All 8 MIDI tracks copied |
| SM26 OK | Copy Tracks | Cross-bank track copy | Copy T1 Bank A → T3 Bank B | Bank B T3 matches Bank A T1 |
| SM27 OK | Copy Tracks | Part Parameters mode | Execute with "Part Parameters" mode | Machine types, amp, LFO, FX, volumes, recorder setup copied; pattern trigs unchanged |
| SM28 OK | Copy Tracks | Both mode | Execute with "Both" mode | Sound design AND pattern triggers copied |
| SM29 OK | Copy Tracks | Pattern Triggers mode | Execute with "Pattern Triggers" mode | Only step data copied (trigs, trigless, P-locks, swing); Part params unchanged |
| SM30 OK | Copy Tracks | All patterns 1-to-1 | Both mode, All patterns (default), T1 → T2 | All 16 patterns' T2 triggers match T1 |
| SM31 OK | Copy Tracks | Specific source to specific dest pattern | Both mode, Pattern 1 → Pattern 5, T1 → T2 | T2 triggers in Pattern 5 match T1 triggers in Pattern 1 |
| SM32 OK | Copy Tracks | Source pattern to All dest patterns | Both mode, source Pattern 3 → dest All, T1 → T2 | All 16 dest patterns' T2 match source Pattern 3's T1 |
| SM33 OK | Copy Tracks | Machine types copied | Copy T1 Part params → T3 | Destination machine type matches source |
| SM34 OK | Copy Tracks | FX settings copied | Copy track with FX1/FX2 configured | FX parameters match source |
| SM35 OK | Copy Tracks | Volumes and amp copied | Copy track with custom volume/amp | Volume and amp settings match source |
| SM36 OK | Copy Tracks | Custom LFO copied | Copy track with custom LFO design | Custom LFO waveform and interpolation masks match source |
| SM37 | Copy Tracks | Recorder setup copied | Copy track with recorder configuration | Recorder source and settings match source |
| SM37b | Copy Tracks | Multi-select dest Parts | Copy T1 → T3, select dest Parts 1 and 3 | T3 params copied to both Part 1 and Part 3 in destination |
| **Copy Sample Slots** | | | | |
| SM38 | Copy Sample Slots | Copy single slot | Copy slot 1 → slot 1 (diff project) | Slot data matches source |
| SM39 | Copy Sample Slots | Copy slot range | Copy slots 1-10 → slots 50-59 | All 10 slot assignments copied correctly |
| SM40 | Copy Sample Slots | Copy all 128 slots | Select All (1-128), execute | All 128 slots copied |
| SM41 | Copy Sample Slots | Self-copy same project | Copy slot 1 → slot 2 (same project) | Slot 2 matches slot 1 |
| SM42 | Copy Sample Slots | Static + Flex | Select "Static + Flex", copy slots, execute | Both slot types copied |
| SM43 | Copy Sample Slots | Static only | Select "Static", copy slots, execute | Only Static slot data copied; Flex untouched |
| SM44 | Copy Sample Slots | Flex only | Select "Flex", copy slots, execute | Only Flex slot data copied; Static untouched |
| SM45 | Copy Sample Slots | Copy audio files | Select "Copy", execute | Audio files copied to dest project folder |
| SM46 | Copy Sample Slots | Don't Copy audio | Select "Don't Copy", execute | Slot assignments copied, no audio files transferred |
| SM47 | Copy Sample Slots | .ot file copied with audio | Copy slot with .ot metadata alongside .wav | Both .wav and .ot files present in destination |
| SM48 | Copy Sample Slots | Move to Pool | Select "Move to Pool" (same Set), execute | Files in AUDIO dir, slot paths updated to ../AUDIO/ |
| SM49 | Copy Sample Slots | Move to Pool deletes originals | Move to Pool, check source folder | Original .wav and .ot files deleted from source |
| SM50 | Copy Sample Slots | Move to Pool requires same Set | Dest project in different Set | Move to Pool unavailable; must use Copy or Don't Copy |
| SM51 | Copy Sample Slots | Audio mode auto-switches on dest change | Select "Move to Pool", change dest to diff-Set project | Switches to "Copy" automatically |
| SM52 | Copy Sample Slots | Editor Settings ON preserves all | Check box, copy slot with gain=100, BPM=150 | Dest slot gain=100, BPM=150, loop mode, timestretch match source |
| SM53 | Copy Sample Slots | Editor Settings OFF resets to defaults | Uncheck box, copy slot with gain=100 | Dest slot gain=72, BPM=120, loop/timestretch/trig quant reset to default |
| SM54 | Copy Sample Slots | Markers copied when ON | Check box, copy slot with custom trim/loop/slices | Dest markers (trim_offset, trim_end, loop_point, slices) match source |
| SM55 | Copy Sample Slots | Markers reset when OFF | Uncheck box, copy slot with markers | Dest markers reset to zero/default |
| SM56 | Copy Sample Slots | Flex markers copied | Copy Flex slot with editor settings ON | Flex slot markers in dest match source |
| SM57 | Copy Sample Slots | Markers file created if absent | Copy to project without markers.work | markers.work created in destination |
| SM58 | Copy Sample Slots | Missing source files warning | Select "Copy" audio mode, source slots reference missing .wav files | Warning badge shows "N missing file(s)" next to Audio Files label |
| SM59 | Copy Sample Slots | Dest slot mapping respected | Copy slot 1 → slot 10 (different project) | Slot data written to slot 10, not slot 1 |
