# Tools Tab - Manual QA Test Cases

## Prerequisites

- At least 2 Octatrack projects (ideally in the same Set for Audio Pool tests)
- Projects with sample data in Static and Flex slots
- Projects with patterns containing triggers and parameter locks
- Projects with customized Parts (different machine types, FX)

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **General** | | | | |
| SM\1 | General | Tools tab visible | Open a project | "Tools" tab appears in header tabs |
| SM-2 | General | Tools tab opens panel | Click "Tools" tab | Tools panel appears with operation selector and source/dest panels |
| SM-3 | General | Operation selector lists all 5 | Click operation dropdown | Shows: Copy Banks, Copy Parts, Copy Patterns, Copy Tracks, Copy Sample Slots |
| SM-4 | General | Default operation | Open Tools tab | "Copy Banks" is selected |
| SM-5 | General | Switching operations updates UI | Switch between all 5 operations | Correct fields shown/hidden for each operation |
| SM-6 | General | Execute button visible | Open Tools tab | Execute button present at bottom |
| SM-7 | General | Settings persist in session | Change operation + options, switch tabs, return | All selections restored |
| **Destination Project Selector** | | | | |
| SM-8 | General | Current project shown by default | Open Tools tab | Destination shows current project name with "Current" badge |
| SM-9 | General | Project card tooltip shows path | Hover over a project card in selector modal | Full filesystem path shown in tooltip |
| SM-10 | General | Open project selector modal | Click destination project button | Modal opens with current project, browse button, and project list |
| SM-11 | General | Browse for project | Click "Browse..." in modal | File dialog opens; selected project appears in modal |
| SM-12 | General | Rescan for projects | Click "Rescan for Projects" | Project list refreshes; button disabled during scan |
| SM-13 | General | Select different destination | Click another project in modal | Modal closes, destination updates to selected project |
| SM-14 | General | Locations collapsible | Click location header in modal | Location expands/collapses showing Sets and projects |
| SM-15 | General | Audio Pool badge on Sets | View Set in modal | Shows "✓ Audio Pool" or "✗ Audio Pool" badge per Set |
| **Copy Banks — Defaults** | | | | |
| SM-16 | Copy Banks | Default source bank | Open Copy Banks | Bank A selected |
| SM-17 | Copy Banks | Default destination bank | Open Copy Banks | Bank A selected |
| **Copy Banks — Source** | | | | |
| SM-18 | Copy Banks | Source is single-select | Click Bank A, then Bank B | Only Bank B selected |
| SM-19 | Copy Banks | Source can be deselected | Click selected Bank A | Bank A deselected |
| SM-20 | Copy Banks | Bank tooltips | Hover source bank buttons | Loaded banks show name (e.g. "BANK A"), unloaded show "Bank not loaded" |
| **Copy Banks — Destination** | | | | |
| SM-21 | Copy Banks | Destination is multi-select | Click Bank A, then Bank B | Both A and B selected |
| SM-22 | Copy Banks | Destination can be deselected | Click selected Bank A | Bank A deselected |
| SM-23 | Copy Banks | All button selects all 16 | Click "All" | All 16 banks highlighted |
| SM-24 | Copy Banks | All button is toggleable | Click "All" when all selected | All banks deselected |
| SM-25 | Copy Banks | None button deselects all | Select some banks, click "None" | All banks deselected |
| **Copy Banks — Validation** | | | | |
| SM-26 | Copy Banks | No source bank | Deselect source bank | Execute disabled, tooltip: "Select a source bank" |
| SM-27 | Copy Banks | No destination banks | Deselect all destination banks | Execute disabled, tooltip: "Select at least one destination bank" |
| **Copy Banks — Execution** | | | | |
| SM-28 | Copy Banks | Copy single bank | Copy Bank A → Bank B (same project) | Success. Bank B Parts + Patterns match Bank A |
| SM-29 | Copy Banks | Copy to multiple banks | Copy Bank A → Banks B, C, D | Success. All 3 destination banks match source |
| SM-30 | Copy Banks | Cross-project copy | Copy Bank A from Project1 → Bank B in Project2 | Success. Open Project2, verify Bank B data |
| SM-31 | Copy Banks | Info text shown | Open Copy Banks | Shows "Copies entire bank including all 4 Parts and 16 Patterns." |
| **Copy Parts — Defaults** | | | | |
| SM-32 | Copy Parts | Default source bank | Open Copy Parts | Bank A selected |
| SM-33 | Copy Parts | Default source part | Open Copy Parts | Part 1 selected |
| SM-34 | Copy Parts | Default destination bank | Open Copy Parts | Bank A selected |
| SM-35 | Copy Parts | Default destination part | Open Copy Parts | Part 1 selected |
| **Copy Parts — Source Part** | | | | |
| SM-36 | Copy Parts | Source Part is single-select | Click Part 1, then Part 2 | Only Part 2 selected |
| SM-37 | Copy Parts | Source Part can be deselected | Click selected Part 1 | Part 1 deselected |
| SM-38 | Copy Parts | Source All selects all 4 | Click "All" | All 4 Parts highlighted |
| SM-39 | Copy Parts | Source All syncs destination | Click source "All" | Destination also shows All selected and disabled |
| SM-40 | Copy Parts | Deselect All clears both | Click source "All" when selected | Both source and destination cleared |
| SM-41 | Copy Parts | Click single Part exits All | When All selected, click Part 2 | Only Part 2 selected, destination re-enabled |
| SM-42 | Copy Parts | Part tooltips | Hover Part buttons | Shows "Part 1", "Part 2", etc. |
| SM-43 | Copy Parts | All button tooltip | Hover "All" button | Shows "All parts" |
| SM-44 | Copy Parts | Dest shows sync tooltip when All | Source All selected, hover dest Part | Shows "Synced with source All selection" |
| **Copy Parts — Destination Part** | | | | |
| SM-45 | Copy Parts | Dest is multi-select (single source) | With single source, click Part 1, Part 2 | Both Parts selected |
| SM-46 | Copy Parts | Dest Part can be deselected | Click selected Part 1 | Part 1 deselected |
| SM-47 | Copy Parts | Dest disabled when source All | Click source "All" | All destination Part buttons disabled |
| SM-48 | Copy Parts | Dest All selects all 4 | Click destination "All" (single source) | All 4 Parts selected |
| **Copy Parts — Bank Selection** | | | | |
| SM-49 | Copy Parts | Source bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| SM-50 | Copy Parts | Source bank can be deselected | Click selected Bank A | Bank A deselected |
| SM-51 | Copy Parts | Dest bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| SM-52 | Copy Parts | Dest bank can be deselected | Click selected Bank A | Bank A deselected |
| **Copy Parts — Validation** | | | | |
| SM-53 | Copy Parts | No source bank | Deselect source bank | Execute disabled, tooltip mentions bank |
| SM-54 | Copy Parts | No dest bank | Deselect destination bank | Execute disabled, tooltip mentions bank |
| SM-55 | Copy Parts | No source part | Deselect source part | Execute disabled, tooltip mentions part |
| SM-56 | Copy Parts | No dest part | Deselect destination part | Execute disabled, tooltip mentions part |
| **Copy Parts — Execution** | | | | |
| SM-57 | Copy Parts | Copy single part | Copy Part 1 → Part 3 | Success. Part 3 machines/amps/LFOs/FX match Part 1 |
| SM-58 | Copy Parts | Copy All parts | Click source "All", execute | Success. All 4 Parts copied including names |
| SM-59 | Copy Parts | Saved state copied | Copy a Part, check saved/unsaved | Both saved and unsaved state copied |
| SM-60 | Copy Parts | Part names copied | Copy Part with custom name | Destination Part name matches source |
| SM-61 | Copy Parts | Edited bitmask mirrored | Copy non-edited Part to destination | Destination edited bit cleared |
| SM-62 | Copy Parts | Info text shown | Open Copy Parts | Shows "Copies Part sound design (machines, amps, LFOs, FX)." |
| **Copy Patterns — Defaults** | | | | |
| SM-63 | Copy Patterns | Default source bank | Open Copy Patterns | Bank A selected |
| SM-64 | Copy Patterns | Default source pattern | Open Copy Patterns | Pattern 1 selected |
| SM-65 | Copy Patterns | Default dest bank | Open Copy Patterns | Bank A selected |
| SM-66 | Copy Patterns | Default dest pattern | Open Copy Patterns | Pattern 1 selected |
| SM-67 | Copy Patterns | Default Part Assignment | Open Copy Patterns | "Keep Original" selected |
| SM-68 | Copy Patterns | Default Track Scope | Open Copy Patterns | "All Tracks" selected |
| SM-69 | Copy Patterns | Default Mode Scope | Open Copy Patterns | "Audio" selected |
| **Copy Patterns — Source Pattern** | | | | |
| SM-70 | Copy Patterns | Source is single-select | Click Pattern 1, then Pattern 2 | Only Pattern 2 selected |
| SM-71 | Copy Patterns | Source can be deselected | Click selected Pattern 1 | Pattern 1 deselected |
| SM-72 | Copy Patterns | Source All selects all 16 | Click "All" | All 16 Patterns highlighted |
| SM-73 | Copy Patterns | Source All syncs destination | Click source "All" | Destination shows All selected and disabled |
| SM-74 | Copy Patterns | Deselect All clears both | Click source "All" when selected | Both source and destination cleared |
| SM-75 | Copy Patterns | Click single Pattern exits All | When All selected, click Pattern 5 | Only Pattern 5 selected |
| **Copy Patterns — Destination Pattern** | | | | |
| SM-76 | Copy Patterns | Dest is multi-select (single source) | With single source, click Patterns 1, 2, 3 | All three selected |
| SM-77 | Copy Patterns | Dest can be deselected | Click selected Pattern 1 | Pattern 1 deselected |
| SM-78 | Copy Patterns | Dest disabled when source All | Click source "All" | All destination buttons disabled |
| SM-79 | Copy Patterns | Dest All selects all 16 | Click destination "All" (single source) | All 16 Patterns selected |
| SM-80 | Copy Patterns | Dest None deselects all | Click destination "None" | All Patterns deselected |
| SM-81 | Copy Patterns | Dest shows sync tooltip when All | Source All selected, hover dest Pattern | Shows "Synced with source All selection" |
| **Copy Patterns — Bank Selection** | | | | |
| SM-82 | Copy Patterns | Source bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| SM-83 | Copy Patterns | Source bank can be deselected | Click selected Bank A | Bank A deselected |
| SM-84 | Copy Patterns | Dest bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| SM-85 | Copy Patterns | Dest bank can be deselected | Click selected Bank A | Bank A deselected |
| **Copy Patterns — Part Assignment** | | | | |
| SM-86 | Copy Patterns | Keep Original mode | Execute with "Keep Original" | Copied patterns retain their original Part assignments |
| SM-87 | Copy Patterns | Copy Source mode | Select "Copy Source", execute | Part data also copied, patterns reference copied Part |
| SM-88 | Copy Patterns | User Selection shows Part selector | Click "User Selection" | Part cross selector appears below |
| SM-89 | Copy Patterns | Dest Part single-select | In User Selection, click Part 1, then Part 2 | Only Part 2 selected |
| SM-90 | Copy Patterns | Dest Part can be deselected | Click selected Part 1 | Part 1 deselected |
| SM-91 | Copy Patterns | Execute disabled without Part | In User Selection, deselect Part | Execute disabled, tooltip: "Select a destination part" |
| SM-92 | Copy Patterns | Part button tooltips | Hover Part 1 in Part selector | Shows "Part 1" |
| **Copy Patterns — Track Scope** | | | | |
| SM-93 | Copy Patterns | All Tracks is default | Open Copy Patterns | "All Tracks" selected |
| SM-94 | Copy Patterns | Specific Tracks shows track buttons | Click "Specific Tracks" | Track buttons appear (T1-T8, M1-M8) in stacked layout |
| SM-95 | Copy Patterns | No tracks selected by default | Switch to "Specific Tracks" | No tracks selected |
| SM-96 | Copy Patterns | Tracks are multi-select | Click T1, T2, M1 | All three selected |
| SM-97 | Copy Patterns | Track can be deselected | Click selected T1 | T1 deselected |
| SM-98 | Copy Patterns | Execute disabled without tracks | In Specific Tracks, deselect all | Execute disabled, tooltip: "Select at least one track" |
| SM-99 | Copy Patterns | Track button tooltips | Hover T1 button | Shows "Audio Track 1" |
| SM-100 | Copy Patterns | MIDI track button tooltips | Hover M1 button | Shows "MIDI Track 1" |
| **Copy Patterns — Mode Scope** | | | | |
| SM-101 | Copy Patterns | Mode Scope visible when All Tracks | Open Copy Patterns (default All Tracks) | "Mode Scope" field visible with Audio / Both / MIDI buttons |
| SM-102 | Copy Patterns | Audio is default Mode Scope | Open Copy Patterns | "Audio" button selected |
| SM-103 | Copy Patterns | Click changes Mode Scope | Click "Both", then "MIDI" | Selection follows clicks, only one active at a time |
| SM-104 | Copy Patterns | Mode Scope hidden for Specific Tracks | Click "Specific Tracks" | Mode Scope field disappears |
| SM-105 | Copy Patterns | Mode Scope tooltip — Audio | Hover "Audio" button | "Copy only Audio tracks (T1-T8)" |
| SM-106 | Copy Patterns | Mode Scope tooltip — Both | Hover "Both" button | "Copy both Audio and MIDI tracks" |
| SM-107 | Copy Patterns | Mode Scope tooltip — MIDI | Hover "MIDI" button | "Copy only MIDI tracks (M1-M8)" |
| SM-108 | Copy Patterns | Audio scope copies only T1-T8 | Copy pattern with Mode Scope = Audio | Only audio track trigs copied; MIDI trigs untouched in destination |
| SM-109 | Copy Patterns | MIDI scope copies only M1-M8 | Copy pattern with Mode Scope = MIDI | Only MIDI track trigs copied; audio trigs untouched in destination |
| SM-110 | Copy Patterns | Both scope copies all | Copy pattern with Mode Scope = Both | Both audio and MIDI trigs copied |
| **Copy Patterns — Validation** | | | | |
| SM-111 | Copy Patterns | No source bank | Deselect source bank | Execute disabled |
| SM-112 | Copy Patterns | No dest bank | Deselect dest bank | Execute disabled |
| SM-113 | Copy Patterns | No source pattern | Deselect source pattern | Execute disabled |
| SM-114 | Copy Patterns | No dest pattern | Deselect dest patterns | Execute disabled |
| **Copy Patterns — Execution** | | | | |
| SM-115 | Copy Patterns | Copy single pattern | Copy Pattern 1 → Pattern 5 | Success. Pattern 5 matches Pattern 1 trigs and data |
| SM-116 | Copy Patterns | Copy All patterns | Source All, execute | All 16 Patterns copied 1-to-1 |
| SM-117 | Copy Patterns | Specific tracks only | Copy Pattern 1 with Specific Tracks (T1, T2 only) | Only T1, T2 trigs copied; other tracks untouched |
| **Copy Tracks — Defaults** | | | | |
| SM-118 | Copy Tracks | Default Copy Mode | Open Copy Tracks | "Part Parameters" selected |
| SM-119 | Copy Tracks | No default source tracks | Open Copy Tracks | No tracks selected |
| SM-120 | Copy Tracks | No default dest tracks | Open Copy Tracks | No tracks selected |
| SM-121 | Copy Tracks | Default source Part | Open Copy Tracks | Part 1 selected |
| SM-122 | Copy Tracks | Default dest Part | Open Copy Tracks | Part 1 selected |
| **Copy Tracks — Copy Mode** | | | | |
| SM-123 | Copy Tracks | Three mode buttons in order | View Copy Mode field | "Part Parameters", "Both", "Pattern Triggers" left-to-right |
| SM-124 | Copy Tracks | Part Parameters mode | Execute with Part Parameters | Machine types, amp, LFO, FX, volumes, recorder setup copied; pattern trigs unchanged |
| SM-125 | Copy Tracks | Both mode | Execute with Both | Sound design AND pattern triggers copied |
| SM-126 | Copy Tracks | Pattern Triggers mode | Execute with Pattern Triggers | Only step data copied (trigs, trigless, P-locks, swing) |
| **Copy Tracks — Source Track Selection** | | | | |
| SM-127 | Copy Tracks | Source is single-select | Click T1, then T2 | Only T2 selected |
| SM-128 | Copy Tracks | Source can be deselected | Click selected T1 | T1 deselected |
| SM-129 | Copy Tracks | Audio source disables MIDI source | Select T1 | MIDI source buttons (M1-M8) disabled |
| SM-130 | Copy Tracks | MIDI source disables Audio source | Select M1 | Audio source buttons (T1-T8) disabled |
| **Copy Tracks — All Audio / All MIDI** | | | | |
| SM-131 | Copy Tracks | All Audio selects T1-T8 | Click source "All Audio" | All 8 Audio tracks selected |
| SM-132 | Copy Tracks | All MIDI selects M1-M8 | Click source "All MIDI" | All 8 MIDI tracks selected |
| SM-133 | Copy Tracks | All Audio syncs destination | Click source "All Audio" | Destination also has all Audio tracks auto-selected |
| SM-134 | Copy Tracks | All MIDI syncs destination | Click source "All MIDI" | Destination also has all MIDI tracks auto-selected |
| SM-135 | Copy Tracks | Deselect All Audio clears both | Click "All Audio" when selected | Source and destination tracks both cleared |
| SM-136 | Copy Tracks | Dest tracks disabled when source All | Click source "All Audio" | All destination track buttons disabled |
| SM-137 | Copy Tracks | Dest All Audio/MIDI disabled when source All | Source "All Audio" selected | Dest "All Audio" and "All MIDI" buttons disabled |
| SM-138 | Copy Tracks | All Audio disabled when dest has MIDI | Select dest MIDI track first | Source "All Audio" button disabled |
| SM-139 | Copy Tracks | All MIDI disabled when dest has Audio | Select dest Audio track first | Source "All MIDI" button disabled |
| SM-140 | Copy Tracks | All Audio/MIDI selected styling | Click "All Audio" | Button has solid orange selected styling |
| **Copy Tracks — Destination Track Selection** | | | | |
| SM-141 | Copy Tracks | Dest is multi-select (single source) | With T1 source, click dest T1, T2, T3 | All three selected |
| SM-142 | Copy Tracks | Dest can be deselected | Click selected dest T1 | T1 deselected |
| SM-143 | Copy Tracks | Dest MIDI disabled when source Audio | Select source T1 | Dest M1-M8 disabled |
| SM-144 | Copy Tracks | Dest Audio disabled when source MIDI | Select source M1 | Dest T1-T8 disabled |
| SM-145 | Copy Tracks | Dest All Audio selects all Audio | Click dest "All Audio" (single Audio source) | All 8 dest Audio tracks selected |
| SM-146 | Copy Tracks | Dest None deselects all | Click dest "None" | All dest tracks deselected |
| SM-147 | Copy Tracks | Track button tooltips | Hover T1 | Shows "Audio Track 1" |
| **Copy Tracks — Part Selection** | | | | |
| SM-148 | Copy Tracks | Source Part single-select | Click Part 1, then Part 2 | Only Part 2 selected |
| SM-149 | Copy Tracks | Source Part can be deselected | Click selected Part 1 | Part 1 deselected (becomes -2, no selection) |
| SM-150 | Copy Tracks | Source All syncs dest | Click source Part "All" | Destination Part also shows All selected and disabled |
| SM-151 | Copy Tracks | Deselect Part All clears both | Click source Part "All" when selected | Both source and destination Parts cleared |
| SM-152 | Copy Tracks | Dest Parts disabled when source All | Click source Part "All" | Dest Part buttons disabled, sync tooltip shown |
| SM-153 | Copy Tracks | Click single Part exits All | When Part All selected, click Part 2 | Part 2 selected, destination re-enabled |
| SM-154 | Copy Tracks | Part tooltips | Hover Part buttons | Shows "Part 1", "Part 2", etc. |
| **Copy Tracks — Pattern Selector** | | | | |
| SM-155 | Copy Tracks | Pattern hidden in Part Parameters mode | Open Copy Tracks (default Part Parameters) | No Pattern field visible in source or dest |
| SM-156 | Copy Tracks | Pattern visible in Both mode | Select "Both" mode | Pattern field appears in both source and dest panels |
| SM-157 | Copy Tracks | Pattern visible in Pattern Triggers mode | Select "Pattern Triggers" mode | Pattern field appears in both source and dest panels |
| SM-158 | Copy Tracks | 16 buttons + All shown | Switch to Both mode, view source Pattern | 16 numbered buttons (two rows of 8) plus "All" button |
| SM-159 | Copy Tracks | Source All pattern default | Switch to Both mode | Source "All" pattern selected by default |
| SM-160 | Copy Tracks | Click specific deselects All | Click Pattern 3 in source | Pattern 3 selected, "All" deselected |
| SM-161 | Copy Tracks | Click All re-enables All | After selecting specific, click "All" | All selected again |
| SM-162 | Copy Tracks | Dest disabled when source All | Source Pattern "All" selected | Dest Pattern buttons all disabled with "disabled" class on container |
| SM-163 | Copy Tracks | Dest enabled when source specific | Select source Pattern 1 | Dest Pattern buttons enabled |
| SM-164 | Copy Tracks | Dest sync tooltip when source All | Source All, hover dest Pattern 1 | Shows "Synced with source All selection" |
| SM-165 | Copy Tracks | Pattern button tooltips | Hover Pattern 1 | Shows "Pattern 1" |
| SM-166 | Copy Tracks | All button tooltip | Hover "All" button | Shows "All patterns" |
| **Copy Tracks — Validation** | | | | |
| SM-167 | Copy Tracks | No tracks at all | Don't select any tracks | Execute disabled, tooltip: "Select source and destination tracks" |
| SM-168 | Copy Tracks | No source tracks | Only select destination tracks | Execute disabled, tooltip: "Select a source track" |
| SM-169 | Copy Tracks | No dest tracks | Only select source track | Execute disabled, tooltip: "Select at least one destination track" |
| SM-170 | Copy Tracks | No source part | Deselect source Part | Execute disabled, tooltip mentions part |
| SM-171 | Copy Tracks | No dest part | Deselect dest Part | Execute disabled, tooltip mentions part |
| SM-172 | Copy Tracks | Mixed track count rejected | Select 2-7 source tracks manually (not via All) | Execute disabled, tooltip: "Select one track or use All button" |
| **Copy Tracks — Execution** | | | | |
| SM-173 | Copy Tracks | Part params single track | Copy T1 Part params → T3 | Machine type, amp, LFO, FX, volumes, recorder setup match source |
| SM-174 | Copy Tracks | Part params copies custom LFO | Copy track with custom LFO design | Custom LFO waveform and interpolation masks copied |
| SM-175 | Copy Tracks | Pattern triggers single pattern | Both mode, Pattern 1 → Pattern 5, T1 → T2 | T2 triggers in Pattern 5 match T1 triggers in Pattern 1 |
| SM-176 | Copy Tracks | All patterns 1-to-1 | Both mode, All patterns, T1 → T2 | All 16 patterns' T2 triggers match T1 |
| SM-177 | Copy Tracks | Source pattern to All dest | Both mode, source Pattern 3 → dest All, T1 → T2 | All 16 dest patterns' T2 match source Pattern 3's T1 |
| SM-178 | Copy Tracks | MIDI track copy | Copy M1 → M2 (Part params) | MIDI params, arp sequences, custom LFO copied |
| SM-179 | Copy Tracks | All Audio copy | Source/Dest All Audio, execute | All 8 audio tracks copied (params and/or trigs per mode) |
| **Copy Sample Slots — Defaults** | | | | |
| SM-180 | Copy Sample Slots | Default Slot Type | Open Copy Sample Slots | "Static + Flex" selected |
| SM-181 | Copy Sample Slots | Default Audio Files (same Set) | Dest project in same Set | "Move to Pool" selected |
| SM-182 | Copy Sample Slots | Default Audio Files (diff Set) | Dest project NOT in same Set | "Copy" selected (Move to Pool disabled) |
| SM-183 | Copy Sample Slots | Default Editor Settings | Open Copy Sample Slots | Checkbox checked |
| SM-184 | Copy Sample Slots | Default slot range | Open Copy Sample Slots | All 128 slots (1-128) selected |
| **Copy Sample Slots — Source Slot Selection** | | | | |
| SM-185 | Copy Sample Slots | Slider adjusts range | Drag source range slider | Start/end values update; count display changes |
| SM-186 | Copy Sample Slots | Text input for range | Type "10" in start field, "20" in end field | Range updates to slots 10-20 (11 slots) |
| SM-187 | Copy Sample Slots | Invalid input reverts | Type "abc" in start field, press Enter | Reverts to previous valid value |
| SM-188 | Copy Sample Slots | All button selects 1-128 | Click "All" | Range set to 1-128 (128 slots) |
| SM-189 | Copy Sample Slots | One button selects single slot | Click "One" | Range set to single slot (1 slot) |
| SM-190 | Copy Sample Slots | Range enforces start ≤ end | Try to set start > end | Start clamped to not exceed end |
| **Copy Sample Slots — Destination Slot Selection** | | | | |
| SM-191 | Copy Sample Slots | Dest start editable | Type "50" in dest start field | Dest range starts at slot 50 |
| SM-192 | Copy Sample Slots | Dest end auto-calculated | Source has 10 slots, dest start = 50 | Dest end shows 59 (read-only) |
| SM-193 | Copy Sample Slots | Dest auto-syncs with source count | Change source range from 10 to 20 slots | Dest count updates to match |
| SM-194 | Copy Sample Slots | Overflow warning | Source 10 slots, dest start = 125 | Warning badge: "Some slots will overflow" |
| SM-195 | Copy Sample Slots | Reset button | Click dest "Reset" | Dest start resets to slot 1 |
| **Copy Sample Slots — Slot Type** | | | | |
| SM-196 | Copy Sample Slots | Flex only | Select "Flex", execute | Only Flex slots copied |
| SM-197 | Copy Sample Slots | Static + Flex | Select "Static + Flex", execute | Both slot types copied |
| SM-198 | Copy Sample Slots | Static only | Select "Static", execute | Only Static slots copied |
| **Copy Sample Slots — Audio Files Mode** | | | | |
| SM-199 | Copy Sample Slots | Copy option | Select "Copy", execute | Audio files copied to dest project folder |
| SM-200 | Copy Sample Slots | Move to Pool option | Select "Move to Pool" (same Set), execute | Files moved to AUDIO POOL dir, slot paths updated to ../AUDIO POOL/ |
| SM-201 | Copy Sample Slots | Don't Copy option | Select "Don't Copy", execute | Only slot assignments copied, no audio files transferred |
| SM-202 | Copy Sample Slots | Move to Pool disabled (diff Sets) | Dest project NOT in same Set | "Move to Pool" button disabled with tooltip |
| SM-203 | Copy Sample Slots | Auto-switch to Copy on Set change | Select "Move to Pool", change dest to diff-Set project | Switches to "Copy" automatically |
| SM-204 | Copy Sample Slots | Auto-switch back to Move to Pool | Change dest back to same-Set project (no manual change) | Switches back to "Move to Pool" |
| SM-205 | Copy Sample Slots | Manual selection preserved | Manually select "Copy", change dest to same-Set | "Copy" stays selected (not auto-switched) |
| SM-206 | Copy Sample Slots | Pool creation hint | Move to Pool, same Set, no existing pool | Shows "Pool will be created" inline hint |
| SM-207 | Copy Sample Slots | .ot file copied with audio | Copy slot that has .ot metadata file alongside .wav | Both .wav and .ot files copied to destination |
| SM-208 | Copy Sample Slots | Move to Pool deletes originals | Move to Pool, check source folder after | Original .wav and .ot files deleted from source |
| **Copy Sample Slots — Editor Settings** | | | | |
| SM-209 | Copy Sample Slots | Checkbox tooltip | Hover "Include Editor Settings" label | Shows "Gain, loop mode, timestretch" |
| SM-210 | Copy Sample Slots | Editor Settings ON preserves all | Check box, copy slot with gain=100, BPM=150 | Dest slot gain=100, BPM=150, loop mode, timestretch match source |
| SM-211 | Copy Sample Slots | Editor Settings OFF resets to defaults | Uncheck box, copy slot with gain=100 | Dest slot gain reset to 72, BPM reset to 120, loop/timestretch/trig quant default |
| SM-212 | Copy Sample Slots | Markers copied when ON | Check box, copy slot with custom trim/loop/slices | Dest markers (trim_offset, trim_end, loop_point, slices) match source |
| SM-213 | Copy Sample Slots | Markers reset when OFF | Uncheck box, copy slot | Dest markers reset to zero/default |
| SM-214 | Copy Sample Slots | Flex markers copied | Copy Flex slot with editor settings ON | Flex slot markers in dest match source |
| **Copy Sample Slots — Validation** | | | | |
| SM-215 | Copy Sample Slots | Mismatched slot counts | (API level) source/dest arrays differ in length | Error: "same length" |
| SM-216 | Copy Sample Slots | Slot index 0 invalid | (API level) pass slot index 0 | Error: "between 1 and 128" |
| SM-217 | Copy Sample Slots | Slot index 129 invalid | (API level) pass slot index 129 | Error: "between 1 and 128" |
| **Copy Sample Slots — Execution** | | | | |
| SM-218 | Copy Sample Slots | Copy single slot | Copy slot 1 → slot 1 (diff project) | Success. Slot data matches source |
| SM-219 | Copy Sample Slots | Copy slot range | Copy slots 1-10 → slots 50-59 | Success. All 10 slot assignments copied |
| SM-220 | Copy Sample Slots | Copy all 128 slots | Select All (1-128), execute | Success message. All slots copied |
| SM-221 | Copy Sample Slots | Self-copy same project | Copy slot 1 → slot 2 (same project) | Success. Slot 2 matches slot 1 |
| SM-222 | Copy Sample Slots | Markers file created if absent | Copy to project without markers.work | markers.work created in destination |
| **Execution Feedback** | | | | |
| SM-223 | General | Progress spinner during execution | Execute any operation | Button shows spinner + "Processing" text |
| SM-224 | General | Progress details panel | Execute any operation | Expandable progress details panel appears |
| SM-225 | General | Success message | Complete any valid operation | Green success modal with count and details |
| SM-226 | General | Error message | Trigger an error (e.g. invalid project path) | Red error modal with error description |
| SM-227 | General | Modal dismissable | Click overlay or close button on status modal | Modal closes |
