# Tools Tab - Functional Test Cases

---

## Quick Smoke Test - 10 Critical Cases

Run these 10 tests first for rapid validation of core functionality.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| 1 | **Copy Bank** | Cross-project copy | Copy Bank A from Project1 to Bank B in Project2 | Success message. Open Project2, verify Bank B has copied data |
| 2 | **Copy Parts** | Multi-part copy | Click Source "All", verify destination syncs. Execute. | Success message. All 4 Parts copied |
| 3 | **Copy Patterns** | With Part assignment | Copy Patterns 1-4 with "User Selection" Part = Part 2 | Success message. All copied patterns show "→ Part 2" |
| 4 | **Copy Patterns** | Specific tracks only | Copy Pattern 1 with Track Scope = "Specific Tracks", select T1,T2 only | Success message. Only T1,T2 have triggers, other tracks empty |
| 5 | **Copy Tracks** | Part Parameters only | Select T1 source and dest, mode "Part Parameters". Execute. | Success message. Machine/Amp/LFO/FX copied, pattern triggers unchanged |
| 6 | **Copy Sample Slots** | Full range both types | Copy slots 1-128, Static+Flex, "Don't Copy" audio | Success message. All slot assignments copied |
| 7 | **Copy Sample Slots** | With Move to Pool | Copy slots 1-10 with "Move to Pool" (same Set) | Success message. Audio files in AUDIO POOL, paths updated |
| 8 | **Copy Sample Slots** | Default values | Select Copy Sample Slots, dest in same Set | "Static + Flex" and "Move to Pool" selected by default |
| 9 | **Validation** | No selection | Copy Tracks with no source/dest tracks selected | Execute button disabled, warning message shown |
| 10 | **General** | Operation switching | Switch between all 5 operations | Correct fields shown for each operation |

**Estimated time:** 15-20 minutes

---

## Prerequisites
- At least 2 Octatrack projects available (ideally in the same Set for Audio Pool tests)
- Projects should have sample data in Static and Flex slots
- Projects should have patterns with triggers and parameter locks
- Projects should have customized Parts with different machine types

---

## 1. Copy Banks

### 1.1 Default Values
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CB-D-01 | Default source bank | Open Copy Banks | Bank A selected |
| CB-D-02 | Default destination bank | Open Copy Banks | Bank A selected |

### 1.2 Source Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CB-S-01 | Source is single-select | Click Bank A, then Bank B | Only Bank B selected |
| CB-S-02 | Source can be deselected | Click selected Bank A | Bank A deselected |
| CB-S-03 | Execute disabled without source | Deselect source bank | Execute button disabled with message |

### 1.3 Destination Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CB-D-03 | Destination is multi-select | Click Bank A, then Bank B | Both A and B selected |
| CB-D-04 | Destination can be deselected | Click selected Bank A | Bank A deselected |
| CB-D-05 | All button selects all 16 banks | Click "All" button | All 16 banks selected |
| CB-D-06 | All button is toggleable | Click "All" when selected | All banks deselected |
| CB-D-07 | None button deselects all | Click "None" button | All banks deselected |
| CB-D-08 | Execute disabled without dest | Deselect all destination banks | Execute button disabled with message |

### 1.4 Data Integrity
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CB-I-01 | Verify all 4 Parts copied | Copy bank, check Parts tab in dest | All 4 Parts match source |
| CB-I-02 | Verify all 16 Patterns copied | Copy bank, check Patterns tab | All 16 patterns match source |
| CB-I-03 | Verify Part assignments preserved | Check pattern Part assignments after copy | Part assignments (1-4) match source |
| CB-I-04 | Verify parameter locks copied | Check pattern steps with P-locks | All P-lock data preserved |

---

## 2. Copy Parts

### 2.1 Default Values
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-D-01 | Default source bank | Open Copy Parts | Bank A selected |
| CP-D-02 | Default source part | Open Copy Parts | Part 1 selected |
| CP-D-03 | Default destination bank | Open Copy Parts | Bank A selected |
| CP-D-04 | Default destination part | Open Copy Parts | Part 1 selected |

### 2.2 Source Part Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-S-01 | Source Part is single-select | Click Part 1, then Part 2 | Only Part 2 selected |
| CP-S-02 | Source Part can be deselected | Click selected Part 1 | Part 1 deselected |
| CP-S-03 | Source All selects all 4 Parts | Click "All" button | All 4 Parts selected |
| CP-S-04 | Source All syncs destination | Click source "All" | Destination also shows All selected |
| CP-S-05 | Deselect All clears both | Click source "All" when selected | Both source and destination cleared |
| CP-S-06 | Click single Part exits All mode | When All selected, click Part 2 | Only Part 2 selected, destination re-enabled |

### 2.3 Destination Part Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-D-05 | Destination is multi-select (single source) | With single source, click Part 1, Part 2 | Both Parts selected |
| CP-D-06 | Destination can be deselected | Click selected Part 1 | Part 1 deselected |
| CP-D-07 | Destination disabled when source All | Click source "All" | All destination buttons disabled |
| CP-D-08 | Destination All selects all 4 | Click destination "All" (single source) | All 4 Parts selected |

### 2.4 Bank Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-B-01 | Source bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| CP-B-02 | Source bank can be deselected | Click selected Bank A | Bank A deselected |
| CP-B-03 | Destination bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| CP-B-04 | Destination bank can be deselected | Click selected Bank A | Bank A deselected |

### 2.5 Validation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-V-01 | No source Part | Deselect source Part | Execute disabled with message |
| CP-V-02 | No destination Part | Deselect destination Part | Execute disabled with message |
| CP-V-03 | No source bank | Deselect source bank | Execute disabled with message |
| CP-V-04 | No destination bank | Deselect destination bank | Execute disabled with message |

---

## 3. Copy Patterns

### 3.1 Default Values
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-D-01 | Default source bank | Open Copy Patterns | Bank A selected |
| CPT-D-02 | Default source pattern | Open Copy Patterns | Pattern 1 selected |
| CPT-D-03 | Default destination bank | Open Copy Patterns | Bank A selected |
| CPT-D-04 | Default destination pattern | Open Copy Patterns | Pattern 1 selected |
| CPT-D-05 | Default Part Assignment | Open Copy Patterns | "Keep Original" selected |
| CPT-D-06 | Default Track Scope | Open Copy Patterns | "All Tracks" selected |

### 3.2 Source Pattern Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-S-01 | Source is single-select | Click Pattern 1, then Pattern 2 | Only Pattern 2 selected |
| CPT-S-02 | Source can be deselected | Click selected Pattern 1 | Pattern 1 deselected |
| CPT-S-03 | Source All selects all 16 | Click "All" button | All 16 patterns selected |
| CPT-S-04 | Source All syncs destination | Click source "All" | Destination also shows All selected |
| CPT-S-05 | Deselect All clears both | Click source "All" when selected | Both source and destination cleared |
| CPT-S-06 | Click single Pattern exits All mode | When All selected, click Pattern 5 | Only Pattern 5 selected |

### 3.3 Destination Pattern Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-D-07 | Destination is multi-select (single source) | With single source, click Patterns 1, 2, 3 | All three selected |
| CPT-D-08 | Destination can be deselected | Click selected Pattern 1 | Pattern 1 deselected |
| CPT-D-09 | Destination disabled when source All | Click source "All" | All destination buttons disabled |
| CPT-D-10 | Destination All selects all 16 | Click destination "All" (single source) | All 16 patterns selected |
| CPT-D-11 | Destination None deselects all | Click destination "None" | All patterns deselected |

### 3.4 Part Assignment Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-PA-01 | Keep Original mode | Execute with "Keep Original" | Patterns keep their original Part numbers |
| CPT-PA-02 | Copy Source Part mode | Select "Copy Source" and execute | Part data also copied, patterns reference it |
| CPT-PA-03 | User Selection shows Part selector | Click "User Selection" | Part selector appears |
| CPT-PA-04 | Destination Part single-select | Click Part 1, then Part 2 | Only Part 2 selected |
| CPT-PA-05 | Destination Part can be deselected | Click selected Part 1 | Part 1 deselected |
| CPT-PA-06 | Execute disabled without Part (User Selection) | Deselect Part in User Selection mode | Execute disabled |

### 3.5 Track Scope Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-TS-01 | Specific Tracks shows track buttons | Click "Specific Tracks" | Track buttons appear (T1-T8, M1-M8) |
| CPT-TS-02 | No tracks selected by default | Switch to "Specific Tracks" | No tracks selected, Execute disabled |
| CPT-TS-03 | Tracks are multi-select | Click T1, T2, M1 | All three selected |
| CPT-TS-04 | Track can be deselected | Click selected T1 | T1 deselected |
| CPT-TS-05 | All button selects all 16 tracks | Click "All" | All 16 tracks selected |
| CPT-TS-06 | None button deselects all | Click "None" | All tracks deselected |

### 3.6 Bank Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-B-01 | Source bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| CPT-B-02 | Source bank can be deselected | Click selected Bank A | Bank A deselected |
| CPT-B-03 | Destination bank single-select | Click Bank A, then Bank B | Only Bank B selected |
| CPT-B-04 | Destination bank can be deselected | Click selected Bank A | Bank A deselected |

---

## 4. Copy Tracks

### 4.1 Default Values
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-D-01 | Default Copy Mode | Open Copy Tracks | "Part Parameters" selected |
| CT-D-02 | No default source tracks | Open Copy Tracks | No tracks selected |
| CT-D-03 | No default destination tracks | Open Copy Tracks | No tracks selected |
| CT-D-04 | Default source Part | Open Copy Tracks | Part 1 selected |
| CT-D-05 | Default destination Part | Open Copy Tracks | Part 1 selected |

### 4.2 Source Track Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-S-01 | Source is single-select | Click T1, then T2 | Only T2 selected |
| CT-S-02 | Source can be deselected | Click selected T1 | T1 deselected |

### 4.3 Track Type Locking
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-TL-01 | Select Audio disables MIDI (via dest) | Select dest MIDI track first | Source Audio tracks disabled |
| CT-TL-02 | Select MIDI disables Audio (via dest) | Select dest Audio track first | Source MIDI tracks disabled |
| CT-TL-03 | Dest MIDI disabled when source Audio | Select source T1 | Destination MIDI tracks disabled |
| CT-TL-04 | Dest Audio disabled when source MIDI | Select source M1 | Destination Audio tracks disabled |

### 4.4 All Audio / All MIDI Buttons
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-AA-01 | All Audio selects 8 Audio tracks | Click "All Audio" | All T1-T8 selected |
| CT-AA-02 | All MIDI selects 8 MIDI tracks | Click "All MIDI" | All M1-M8 selected |
| CT-AA-03 | All Audio syncs destination | Click source "All Audio" | Destination also has all Audio tracks selected |
| CT-AA-04 | All MIDI syncs destination | Click source "All MIDI" | Destination also has all MIDI tracks selected |
| CT-AA-05 | Deselect All Audio clears both | Click "All Audio" when selected | Both source and destination tracks cleared |
| CT-AA-06 | All Audio disabled when dest has MIDI | Select dest MIDI track first | "All Audio" button disabled |
| CT-AA-07 | All MIDI disabled when dest has Audio | Select dest Audio track first | "All MIDI" button disabled |
| CT-AA-08 | Click single track exits All mode | When All Audio selected, click T1 | Only T1 selected |

### 4.5 Destination Track Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-D-06 | Destination is multi-select (single source) | With T1 source, click T1, T2, T3 | All three selected |
| CT-D-07 | Destination can be deselected | Click selected T1 | T1 deselected |
| CT-D-08 | Destination disabled when source All | Click source "All Audio" | All destination track buttons disabled |
| CT-D-09 | Destination All Audio | Click dest "All Audio" (single source) | All 8 Audio tracks selected |
| CT-D-10 | Destination All MIDI | Click dest "All MIDI" (single source MIDI) | All 8 MIDI tracks selected |
| CT-D-11 | Destination None deselects all | Click "None" | All tracks deselected |

### 4.6 Part Selection
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-P-01 | Source Part single-select | Click Part 1, then Part 2 | Only Part 2 selected |
| CT-P-02 | Source Part can be deselected | Click selected Part 1 | Part 1 deselected |
| CT-P-03 | Source All syncs destination | Click source Part "All" | Destination Part also shows All selected |
| CT-P-04 | Deselect Part All clears both | Click source "All" when selected | Both source and destination Parts cleared |
| CT-P-05 | Destination Parts disabled when source All | Click source Part "All" | Destination Part buttons disabled |

### 4.7 Copy Mode Behavior
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-M-01 | Part Parameters mode | Select "Part Parameters" and execute | Only sound design copied (Machine, Amp, LFO, FX) |
| CT-M-02 | Both mode | Select "Both" and execute | Sound design AND pattern triggers copied |
| CT-M-03 | Pattern Triggers mode | Select "Pattern Triggers" and execute | Only step data copied (trigs, plocks) |

### 4.8 Validation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-V-01 | No tracks selected | Don't select any tracks | Execute disabled with message |
| CT-V-02 | No source tracks | Only select destination | Execute disabled with message |
| CT-V-03 | No destination tracks | Only select source | Execute disabled with message |

---

## 5. Copy Sample Slots

### 5.1 Default Values
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-D-01 | Default Slot Type | Open Copy Sample Slots | "Static + Flex" selected |
| CSS-D-02 | Default Audio Files (same Set) | Dest project in same Set | "Move to Pool" selected |
| CSS-D-03 | Default Editor Settings | Open Copy Sample Slots | Checkbox checked |

### 5.2 Slot Type Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-ST-01 | Flex Only | Click "Flex" and execute | Only Flex slots copied |
| CSS-ST-02 | Static + Flex | Click "Static + Flex" and execute | Both slot types copied |
| CSS-ST-03 | Static Only | Click "Static" and execute | Only Static slots copied |

### 5.3 Audio File Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-AF-01 | Copy option | Select "Copy" and execute | Audio files copied to dest project's sample folder |
| CSS-AF-02 | Move to Pool option | Select "Move to Pool" (same Set) and execute | Files moved to AUDIO POOL, paths updated |
| CSS-AF-03 | Don't Copy option | Select "Don't Copy" and execute | Only slot assignments copied, no files |
| CSS-AF-04 | Move to Pool disabled (different Sets) | Projects NOT in same Set | "Move to Pool" disabled |
| CSS-AF-05 | Auto-switch to Copy | Select dest NOT in same Set | Switches from "Move to Pool" to "Copy" |
| CSS-AF-06 | Auto-switch back to Move to Pool | Change dest to same-Set project | Switches back to "Move to Pool" (if no manual choice) |
| CSS-AF-07 | Manual selection preserved | Manually select "Copy", change dest | "Copy" remains selected |

### 5.4 Editor Settings Option
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-ES-01 | Include Editor Settings ON | Checkbox checked, execute | Gain, loop mode, timestretch copied |
| CSS-ES-02 | Include Editor Settings OFF | Uncheck, execute | Only path copied |

---

## 6. Error Handling

### 6.1 Validation Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-01 | No source selection | Don't select source | Execute disabled with message |
| ERR-02 | No destination selection | Don't select destination | Execute disabled with message |

### 6.2 File System Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-03 | Source project not found | Remove source project during operation | Error message displayed |
| ERR-04 | Dest project not found | Invalid dest project path | Error message displayed |
| ERR-05 | Permission denied | Read-only destination | Error message displayed |

---

## 7. E2E Test Coverage (119 tests)

The following functional tests are automated in `e2e/tools-tab.spec.ts`:

### Copy Banks (14 tests)
- Default source/destination bank is Bank A
- Source bank is single-select
- Source bank can be deselected
- Destination banks allow multiple selection
- Destination All button selects all banks
- Destination All button is toggleable
- Destination None button deselects all banks
- Destination bank can be deselected

### Copy Parts (17 tests)
- Default source/destination Part is Part 1
- Default source/destination Bank is Bank A
- Source part is single-select
- Source part can be deselected
- Source All button selects all parts and syncs destination
- Source All button deselects all when clicked again
- Destination parts allow multi-select when source is single
- Destination part can be deselected
- Destination parts disabled when source All is selected
- Source/Destination bank can be deselected
- Clicking single source part when All is selected exits All mode

### Copy Patterns (32 tests)
- Default source/destination Pattern is Pattern 1
- Default source/destination Bank is Bank A
- Default Part Assignment is "Keep Original"
- Default Track Scope is "All Tracks"
- Source pattern is single-select
- Source pattern can be deselected
- Source All button selects all patterns and syncs destination
- Source All button deselects all when clicked again
- Destination patterns allow multi-select when source is single
- Destination pattern can be deselected
- Destination patterns disabled when source All is selected
- Destination All/None button behaviors
- User Selection shows Destination Part selector
- Destination Part supports click-to-deselect
- Specific Tracks shows track buttons
- Track buttons are multi-select with click-to-deselect

### Copy Tracks (32 tests)
- Default Copy Mode is "Part Parameters"
- No default source/destination tracks
- Default source/destination Part is Part 1
- Execute button disabled when no tracks selected
- Source track selection is single-select
- Source track can be deselected
- Track type locking (Audio/MIDI mutual exclusivity)
- All Audio/All MIDI buttons select all tracks of type
- All Audio/All MIDI sync destination
- Deselecting All clears both source and destination
- All Audio disabled when dest has MIDI tracks (and vice versa)
- Destination tracks allow multi-select when source is single
- Destination disabled when source All is selected
- Destination All Audio/All MIDI/None buttons
- Part selection with All sync behavior

### Copy Sample Slots (6 tests)
- Default Slot Type is "Static + Flex"
- Default Audio Files is "Move to Pool" when projects in same Set
- Default Editor Settings is checked
- Slot Type selection changes

### General (10 tests)
- Operation selector has all 5 operations
- Switching operations updates correctly
- Execute button functionality

---

## Test Environment Checklist

- [ ] Octatrack project with all banks populated
- [ ] Octatrack project with partial banks (some missing)
- [ ] Two projects in the same Set
- [ ] Two projects in different Sets
- [ ] Standalone project (not in a Set)
- [ ] Project with AUDIO POOL directory
- [ ] Project without AUDIO POOL directory
- [ ] Project with Static and Flex samples assigned
- [ ] Project with complex patterns (P-locks, conditions, micro-timing)
- [ ] Project with customized Parts (different machines, FX)
