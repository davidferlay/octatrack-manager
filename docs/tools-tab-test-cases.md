# Tools Tab - Manual QA Test Cases

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Copy Banks** | | | | |
| SM1 OK | Copy Banks | Copy single bank | Copy Bank A → Bank B (same project) | Bank B Parts + Patterns match Bank A |
| SM2 OK | Copy Banks | Copy to multiple banks | Copy Bank A → Banks B, C, D | All 3 destination banks match source |
| SM3 OK | Copy Banks | Cross-project copy | Copy Bank A from Project1 → Bank B in Project2 | Open Project2, verify Bank B data matches |
| SM67 OK | Copy Parts | Multi-select dest Banks | Copy Part 1 → Banks A, B, C | Part 1 copied to all 3 destination banks |
| **Copy Parts** | | | | |
| SM4 OK | Copy Parts | Copy single part | Copy Part 1 → Part 3 | Part 3 machines, amps, LFOs, FX match Part 1 |
| SM5 OK | Copy Parts | Copy All parts | Click source "All", execute | All 4 Parts copied including names |
| SM6 OK | Copy Parts | Cross-bank copy | Copy Part 1 Bank A → Part 2 Bank B | Bank B Part 2 matches Bank A Part 1 |
| SM7 OK | Copy Parts | Part names copied | Copy Part with custom name | Destination Part name matches source |
| SM8 OK | Copy Parts | Saved state copied | Copy a Part, check saved/unsaved states | Both saved and unsaved state copied to destination |
| SM9 OK | Copy Parts | Edited bitmask mirrored | Copy non-edited Part to destination | Destination edited bit cleared (mirrors source) |
| **Copy Patterns** | | | | |
| SM10 OK | Copy Patterns | Copy single pattern | Copy Pattern 1 → Pattern 5 | Pattern 5 trigs and data match Pattern 1 |
| SM11 OK | Copy Patterns | Copy All patterns 1-to-1 | Source All, execute | All 16 Patterns copied to destination 1-to-1 |
| SM12 OK | Copy Patterns | Copy single to multiple | Copy Pattern 1 → Patterns 5, 8, 12 | All 3 destination patterns match source Pattern 1 |
| SM13 OK | Copy Patterns | Cross-bank pattern copy | Copy Pattern 1 Bank A → Pattern 3 Bank C | Bank C Pattern 3 matches Bank A Pattern 1 |
| SM14 OK | Copy Patterns | Keep Original Part mode | Copy pattern with "Keep Original" | Copied pattern retains the destination pattern's existing Part assignment (not the source's) |
| SM15 OK | Copy Patterns | Copy Source Part mode | Copy pattern with "Copy Source" | Part data also copied, pattern references copied Part |
| SM16 OK | Copy Patterns | User Selection Part mode | Copy pattern with "User Selection" Part = Part 3 | Copied pattern assigned to Part 3 |
| SM17 OK | Copy Patterns | All Tracks copies everything | Copy pattern with "All Tracks" | All 16 tracks (T1-T8 + M1-M8) copied per Mode Scope |
| SM18 OK | Copy Patterns | Specific Tracks copies subset | Copy Pattern 1 with Specific Tracks (T1, T2 only) | Only T1, T2 trigs copied; other tracks untouched |
| SM19 OK | Copy Patterns | Audio scope copies only T1-T8 | Copy pattern with Mode Scope = Audio | Only audio track trigs copied; MIDI trigs untouched in destination |
| SM20 OK | Copy Patterns | Both scope copies all tracks | Copy pattern with Mode Scope = Both | Both audio and MIDI trigs copied |
| SM21 OK | Copy Patterns | MIDI scope copies only M1-M8 | Copy pattern with Mode Scope = MIDI | Only MIDI track trigs copied; audio trigs untouched in destination |
| **Copy Tracks** | | | | |
| SM22 OK | Copy Tracks | Audio single track | Copy T1 → T3 (Part params) | T3 Part params match T1 (both saved and unsaved state); Part name NOT copied (destination Part is a hybrid) |
| SM23 OK | Copy Tracks | Audio tracks to all | Source/Dest All Audio, execute | All 8 audio tracks copied |
| SM23 OK | Copy Tracks | Audio single to all tracks | Copy T1 → All (T1-T8) | T1 audio track data copied to all 8 audio tracks |
| SM24 OK | Copy Tracks | MIDI single track | Copy M1 → M2 (Part params) | MIDI params, arp sequences, custom LFO match source |
| SM25 OK | Copy Tracks | MIDI All tracks | Source/Dest All MIDI, execute | All 8 MIDI tracks copied |
| SM26 OK | Copy Tracks | Cross-bank track copy | Copy T1 Bank A → T3 Bank B | Bank B T3 matches Bank A T1 |
| SM27 OK | Copy Tracks | Part Parameters mode | Execute with "Part Parameters" mode | Machine types, amp, LFO, FX, volumes, recorder setup copied; pattern trigs unchanged |
| SM28 OK | Copy Tracks | Both mode | Execute with "Both" mode | Sound design AND pattern triggers copied |
| SM29 OK | Copy Tracks | Pattern Triggers mode | Execute with "Pattern Triggers" mode | Only step data copied (trigs, trigless, P-locks, swing); Part params unchanged |
| SM30 OK | Copy Tracks | All patterns 1-to-1 | Both mode, All patterns (default), T1 → T2 | All 16 patterns' T2 triggers match T1 |
| SM30b OK | Copy Tracks | 1-to-multiple patterns | Both mode, Pattern 1 → Pattern 1+2, T1 → T1+T3 | Triggers of patterns 1 and 2 of tracks 1 and 3 should match T1 |
| SM31 OK | Copy Tracks | Specific source to specific dest pattern | Both mode, Pattern 1 → Pattern 5, T1 → T2 | T2 triggers in Pattern 5 match T1 triggers in Pattern 1 |
| SM32 OK | Copy Tracks | Source pattern to All dest patterns | Both mode, source Pattern 3 → dest All, T1 → T2 | All 16 dest patterns' T2 match source Pattern 3's T1 |
| SM33 OK | Copy Tracks | Machine types copied | Copy T1 Part params → T3 | Destination machine type matches source |
| SM34 OK | Copy Tracks | FX settings copied | Copy track with FX1/FX2 configured | FX parameters match source |
| SM35 OK | Copy Tracks | Volumes and amp copied | Copy track with custom volume/amp | Volume and amp settings match source |
| SM36 OK | Copy Tracks | Custom LFO copied | Copy track with custom LFO design | Custom LFO waveform and interpolation masks match source |
| SM37 | Copy Tracks | Recorder setup copied | Copy track with recorder configuration | Recorder source and settings match source |
| SM37b OK | Copy Tracks | Multi-select dest Parts | Copy T1 → T3, select dest Parts 1 and 3 | T3 params copied to both Part 1 and Part 3 in destination |
| **Copy Sample Slots** | | | | |
| SM38 OK | Copy Sample Slots | Copy single slot | Copy slot 1 → slot 2 (diff project) | Slot data matches source; dest slot_id = 2 (not source's 1) |
| SM39 OK | Copy Sample Slots | Copy slot range | Copy slots 1-10 → slots 50-59 | All 10 slot assignments copied; each dest slot_id matches its position |
| SM40 OK | Copy Sample Slots | Copy all 128 slots | Select All (1-128), execute | All 128 slots copied |
| SM41 OK | Copy Sample Slots | Self-copy same project | Copy slot 1 → slot 2 (same project) | Slot 2 matches slot 1 |
| SM42 OK | Copy Sample Slots | Static + Flex | Select "Static + Flex", copy slots, execute | Both slot types copied |
| SM43 OK | Copy Sample Slots | Static only | Select "Static", copy slots, execute | Only Static slot data copied; Flex untouched |
| SM44 OK | Copy Sample Slots | Flex only | Select "Flex", copy slots, execute | Only Flex slot data copied; Static untouched |
| SM45 OK | Copy Sample Slots | Copy audio files to project root | Select "Copy", execute with source files in project subdir or AUDIO pool | Audio files copied to dest project root (flat, by filename); slot paths updated to filename only |
| SM46 OK | Copy Sample Slots | Don't Copy audio | Select "Don't Copy", execute | Slot assignments copied, no audio files transferred |
| SM48 OK | Copy Sample Slots | Move to Pool | Select "Move to Pool" (same Set), execute | Files in AUDIO dir, slot paths updated to ../AUDIO/ in both source and destination projects |
| SM49 OK | Copy Sample Slots | Move to Pool deletes originals | Move to Pool, check source folder | Original .wav files deleted from source (except files also referenced by opposite slot type) |
| SM50 OK | Copy Sample Slots | Move to Pool requires same Set | Dest project in different Set | Move to Pool unavailable; must use Copy or Don't Copy |
| SM51 OK | Copy Sample Slots | Audio mode auto-switches on dest change | Select "Move to Pool", change dest to diff-Set project | Switches to "Copy" automatically |
| SM58 OK | Copy Sample Slots | Missing source files warning | Select "Copy" audio mode, source slots reference missing .wav files | Warning badge shows "N missing file(s)" next to Audio Files label |
| SM63 OK | Copy Sample Slots | Shared file kept on Move to Pool | Move to Pool with file shared between Static and Flex | Shared file NOT deleted; success message shows count of kept files |
| SM80 OK | Copy Sample Slots | Copy from AUDIO pool preserves source | Copy slots referencing ../AUDIO/ files to another project in same Set | Source files in AUDIO pool intact (not 0 bytes); dest files in project root |
| SM83 | Copy Sample Slots | Execute disabled on overflow | Range mode, source 1-50, set dest start to 100 | Warning "Some slots will overflow" shown; Execute button disabled with tooltip |
| SM54 | Copy Sample Slots | Markers copied when ON | Check box, copy slot with custom trim/loop/slices | Dest markers (trim_offset, trim_end, loop_point, slices) match source |
| SM55 | Copy Sample Slots | Markers reset when OFF | Uncheck box, copy slot with markers | Dest markers reset to zero/default |
| SM47 | Copy Sample Slots | .ot file copied when editor settings ON | Copy slot with .ot metadata, editor settings ON | Both .wav and .ot files present in destination |
| SM47b | Copy Sample Slots | .ot file NOT copied when editor settings OFF | Copy slot with .ot metadata, editor settings OFF | .wav copied but .ot file NOT present in destination |
| **Backup Feature** | | | | |
| SM75 OK | All operations | Backup before copy execute | Execute any copy operation | `backups/` directory created in dest project with timestamped subfolder containing destination files |
| SM81 OK | Copy Sample Slots | Backup source on Move to Pool | Execute Move to Pool | Source project `backups/` contains `project.work` and audio files that were moved/deleted; AUDIO pool files not backed up |
| SM76 OK | All operations | Backup on edit mode ON | Toggle View→Edit mode | `backups/` directory created with current bank file backed up |
| SM78 OK | All operations | Backup backs up dest audio by filename | Execute copy_sample_slots with audio mode Copy | Backup contains destination audio files (by filename) that would be overwritten |
| SM79 OK | All operations | Backup label in directory name | Execute different operations | Each backup dir name ends with operation label (e.g., `_copy_bank`, `_edit_mode`) |
| **Additional Tests** | | | | |
| SM74 | All operations | Auto-refresh on same-project copy | Copy any operation to current project | Project data refreshes automatically after successful copy |
| SM82 | Copy Sample Slots | Source project refreshes after Move to Pool | Execute Move to Pool to different project | Source (active) project UI refreshes to show updated ../AUDIO/ slot paths |
| **Fix Missing Samples** | | | | |
| FMS-01 | Fix Missing Samples | Status badge shows correct count | Select "Fix Missing Samples" from dropdown | Status badge shows number of unique missing files with Flex/Static breakdown |
| FMS-02 | Fix Missing Samples | Missing files table | Click "Show missing files" collapsible | Table shows filename and Slots column (Flex/Static/Both). "Both" highlighted |
| FMS-03 | Fix Missing Samples | Execute disabled when 0 missing | Select "Fix Missing Samples" when all sample files exist | Execute button not shown. Status badge shows 0 with green styling |
| FMS-04 | Fix Missing Samples | Pool options visible only with Set/Audio Pool | Open project in a Set with Audio Pool | "If found in Audio Pool" toggle visible. "If found in other Set projects" toggle visible |
| FMS-05 | Fix Missing Samples | Pool options hidden for standalone project | Open standalone project (not in a Set) | Neither pool-related toggle shown |
| FMS-06 | Fix Missing Samples | Search step 1 — Project directory | Place missing file in project subdirectory. Click Execute | Step 1 spinner → checkmark with count. File resolved with "Update path" action |
| FMS-07 | Fix Missing Samples | Search step 2 — Audio Pool | Place missing file in AUDIO/ directory. Click Execute | Step 2 finds file. With "Use from Pool": path update to ../AUDIO/. With "Copy to Project": file copied |
| FMS-08 | Fix Missing Samples | Search step 3 — Other projects | Place missing file in sibling project. Click Execute | Step 3 finds file. With "Copy to Project": file copied to project root. With "Move to Pool": file moved to AUDIO/, all projects updated |
| FMS-09 | Fix Missing Samples | Step 4 — Browse directory loop | Create missing files not in project/pool/siblings. Click Execute | Browse prompt appears after steps 1-3. Select directory with file. Found count updates. If still missing, loop repeats |
| FMS-10 | Fix Missing Samples | Step 4 — Skip | In browse prompt, click Skip | Proceeds to confirmation with partial results |
| FMS-11 | Fix Missing Samples | Same directory warning | Browse same directory twice | Warning displayed about already-searched directory |
| FMS-12 | Fix Missing Samples | Confirmation — path update only | File found in project subdirectory | Green "Update path → subdir/filename" in confirmation table |
| FMS-13 | Fix Missing Samples | Confirmation — copy from other project | File found in sibling project, "Copy to Project" selected | Blue "Copy to project ← ProjectB/filename" in confirmation |
| FMS-14 | Fix Missing Samples | Confirmation — move to pool | File found in sibling project, "Move to Pool" selected | Purple "Move to Pool + update path" in confirmation. "Other projects affected" section visible |
| FMS-15 | Fix Missing Samples | Confirmation — not found section | Some files not found anywhere | Red "Not found" section lists unresolved filenames |
| FMS-16 | Fix Missing Samples | Cancel from confirmation | Click Cancel on confirmation screen | Modal closes. No files modified. No backups created |
| FMS-17 | Fix Missing Samples | Apply changes — backup creation | Click "Apply Changes" on confirmation | Backup directory created under project/backups/ with label "fix_missing_samples" |
| FMS-18 | Fix Missing Samples | Apply changes — file copy | Apply with "Copy to Project" resolutions | Audio files (+.ot companions) copied to project root. Slot paths updated |
| FMS-19 | Fix Missing Samples | Apply changes — move to pool cross-project | Apply with "Move to Pool" from sibling project | File in AUDIO/. Original deleted from sibling. All sibling project paths updated |
| FMS-20 | Fix Missing Samples | Final summary | After Apply completes | Resolved count and not-found count displayed. Expandable details show per-file actions. Close returns to Tools panel |
| FMS-21 | Fix Missing Samples | .ot companion files handled | Missing file has .ot companion in found location | Both .wav and .ot are copied/moved together |
| FMS-22 | Fix Missing Samples | Auto-apply (Skip Review ON) | Enable "Skip Review" option (default). Execute fix with all samples found | Search completes → Apply starts automatically (no confirmation screen). Done phase shows resolved count |
| FMS-23 | Fix Missing Samples | Manual review (Skip Review OFF) | Disable "Skip Review" option. Execute fix | Search completes → browse prompt → Continue → confirmation table shown. Must click "Apply Changes" to proceed |
| FMS-24 | Fix Missing Samples | Previous button in confirmation | In confirmation screen (Skip Review OFF), click "Previous" | Returns to search results (browse_prompt phase). Can click Continue to go back to confirmation |
| FMS-25 | Fix Missing Samples | Pool subdirectory paths | Missing file found in AUDIO pool subdirectory (e.g., AUDIO/TECHNO/Atmos/file.wav). "Use from Pool" selected | Slot path updated to ../AUDIO/TECHNO/Atmos/file.wav (preserving subdirectory structure), not just ../AUDIO/file.wav |
| FMS-26 | Fix Missing Samples | Project refresh after apply | Apply changes successfully. Click Done to close modal | Tools panel refreshes missing count (should show 0 or reduced count). Sample Slots table reflects updated paths. No manual reload needed |
| FMS-27 | Fix Missing Samples | Both Flex and Static slots updated | Missing file referenced by both Flex slot(s) and Static slot(s). Apply fix | Both Flex and Static slot paths updated. Missing count decreases for both types |
| FMS-28 | Fix Missing Samples | Done phase progress view | Complete a fix (auto-apply or manual) | Done phase shows all search steps with checkmarks/skip icons and found counts. Summary shows "N/M missing files found". Done button closes modal |
