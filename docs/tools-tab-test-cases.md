# Tools Tab - QA Test Cases

---

## Quick Smoke Test - 10 Critical Cases

Run these 10 tests first for rapid validation of core functionality.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| 1 | **Copy Bank** | Cross-project copy | Copy Bank A from Project1 to Bank B in Project2 | Success message. Open Project2, verify Bank B has copied data |
| 2 | **Copy Parts** | Multi-part copy | Copy Parts 1,2 to Parts 3,4 in same bank | Success message. Parts tab shows copied Part data in new positions |
| 3 | **Copy Patterns** | With Part assignment | Copy Patterns 1-4 with "Assign to Specific Part" = Part 2 | Success message. All copied patterns show "→ Part 2" |
| 4 | **Copy Patterns** | Specific tracks only | Copy Pattern 1 with Track Scope = "Specific", select T1,T2 only | Success message. Only T1,T2 have triggers, other tracks empty |
| 5 | **Copy Tracks** | Part params only | Copy T1 with mode "Part Params Only" | Success message. Machine/Amp/LFO/FX copied, pattern triggers unchanged |
| 6 | **Copy Sample Slots** | Full range both types | Copy slots 1-128, Static+Flex, "Don't Copy" audio | Success message. All slot assignments copied |
| 7 | **Copy Sample Slots** | With Move to Pool | Copy slots 1-10 with "Move to Pool" (same Set) | Success message. Audio files in AUDIO POOL, paths updated |
| 8 | **Copy Sample Slots** | Default values | Select Copy Sample Slots, dest in same Set | "Static + Flex" and "Move to Pool" selected by default |
| 9 | **Validation** | Part count mismatch | Select 2 source Parts, 3 destination Parts | Execute button disabled, warning message shown |
| 10 | **UI** | Operation switching | Switch between all 5 operations | UI updates correctly, no errors, appropriate fields shown |

**Estimated time:** 15-20 minutes

---

## Prerequisites
- At least 2 Octatrack projects available (ideally in the same Set for Audio Pool tests)
- Projects should have sample data in Static and Flex slots
- Projects should have patterns with triggers and parameter locks
- Projects should have customized Parts with different machine types

---

## 1. Copy Bank

### 1.1 Basic Functionality
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CB-01 | Copy bank to same project | Select Bank A as source, same project as dest, Bank B as dest bank. Execute. | Bank B contains exact copy of Bank A data |
| CB-02 | Copy bank to different project | Select Bank A, different project, Bank A. Execute. | Destination project Bank A updated with source data |
| CB-03 | Copy bank overwrites existing | Copy to a bank that already has data | Existing data replaced, no merge |
| CB-04 | Copy non-existent bank | Select a bank that doesn't exist (no .work file) | Error message displayed |

### 1.2 Data Integrity
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CB-05 | Verify all 4 Parts copied | Copy bank, check Parts tab in dest | All 4 Parts match source |
| CB-06 | Verify all 16 Patterns copied | Copy bank, check Patterns tab | All 16 patterns match source |
| CB-07 | Verify Part assignments preserved | Check pattern Part assignments after copy | Part assignments (1-4) match source |
| CB-08 | Verify parameter locks copied | Check pattern steps with P-locks | All P-lock data preserved |

---

## 2. Copy Parts

### 2.1 Basic Functionality
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-01 | Copy single Part | Select Part 1 source, Part 1 dest. Execute. | Part 1 copied successfully |
| CP-02 | Copy multiple Parts | Select Parts 1,2,3 source, Parts 2,3,4 dest. Execute. | Parts copied to new positions |
| CP-03 | Copy all Parts | Click "All" button, select matching dest Parts. Execute. | All 4 Parts copied |
| CP-04 | Copy Part to different bank | Source Bank A Part 1 to Bank B Part 3 | Part copied across banks |
| CP-05 | Copy Part to different project | Copy Part to another project | Part copied across projects |

### 2.2 Validation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-06 | Mismatched Part count | Select 2 source Parts but 3 dest Parts | Execute button disabled, warning shown |
| CP-07 | Same source and dest Part | Copy Part 1 to Part 1 in same bank | Operation completes (no-op or refresh) |

### 2.3 Data Integrity
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CP-08 | Verify Machine settings | Check all 8 audio track machines after copy | Machine types and params match |
| CP-09 | Verify Amp settings | Check ATK, HOLD, REL, VOL, BAL values | All Amp params match |
| CP-10 | Verify LFO settings | Check LFO speeds, depths, waveforms | All LFO params match |
| CP-11 | Verify FX settings | Check FX1/FX2 types and all params | All FX params match |
| CP-12 | Verify MIDI track settings | Check MIDI tracks NOTE, ARP, CTRL params | All MIDI params match |

---

## 3. Copy Patterns

### 3.1 Basic Functionality
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-01 | Copy single pattern | Select Pattern 1, dest Pattern 1. Execute. | Pattern copied |
| CPT-02 | Copy multiple patterns | Select Patterns 1-4, starting at Pattern 5. Execute. | Patterns copied to 5-8 |
| CPT-03 | Copy all 16 patterns | Select all patterns, starting at 1. Execute. | All patterns copied |
| CPT-04 | Copy patterns to different bank | Copy Pattern 1 from Bank A to Bank B | Pattern copied across banks |
| CPT-05 | Copy patterns to different project | Copy patterns to another project | Patterns copied across projects |

### 3.2 Part Assignment Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-06 | Keep Original assignment | Select "Keep Original" mode | Patterns keep their original Part numbers |
| CPT-07 | Copy Source Part | Select "Copy Source Part" mode | Part data also copied, patterns reference it |
| CPT-08 | Assign to Specific Part | Select "Assign to Specific Part", choose Part 3 | All copied patterns assigned to Part 3 |

### 3.3 Track Scope Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-09 | Copy all tracks | Select "All Tracks" | All 8 audio + 8 MIDI tracks copied |
| CPT-10 | Copy specific audio tracks | Select "Specific Tracks", choose T1, T2, T3 | Only selected audio tracks copied |
| CPT-11 | Copy specific MIDI tracks | Select M1, M2 only | Only MIDI track data copied |
| CPT-12 | Copy mixed tracks | Select T1, T2, M1, M2 | Both audio and MIDI tracks copied |

### 3.4 Edge Cases
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-13 | Pattern overflow | Copy 10 patterns starting at Pattern 10 | Warning shown (overflow), or only 6 patterns copied |
| CPT-14 | Empty pattern copy | Copy pattern with no triggers | Empty pattern copied successfully |
| CPT-15 | Pattern with complex P-locks | Copy pattern with many P-locks per step | All P-locks preserved |

### 3.5 Data Integrity
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CPT-16 | Verify pattern length | Check pattern length after copy | Length matches source |
| CPT-17 | Verify scale mode | Check Normal/Per-Track mode | Scale mode preserved |
| CPT-18 | Verify master scale | Check speed multiplier | Master scale preserved |
| CPT-19 | Verify chain mode | Check chain after setting | Chain mode preserved |
| CPT-20 | Verify all trigger types | Check trig, trigless, oneshot, swing, slide, recorder | All trigger types preserved |
| CPT-21 | Verify trig conditions | Check Fill, Pre, percentage conditions | Conditions preserved |
| CPT-22 | Verify micro-timing | Check step micro-timing offsets | Micro-timing preserved |

---

## 4. Copy Tracks

### 4.1 Basic Functionality
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-01 | Copy single audio track | Select T1 source, T1 dest. Execute. | Track copied |
| CT-02 | Copy multiple audio tracks | Select T1-T4, dest T5-T8. Execute. | 4 tracks copied |
| CT-03 | Copy single MIDI track | Select M1 source, M1 dest. Execute. | MIDI track copied |
| CT-04 | Copy all audio tracks | Select T1-T8 | All 8 audio tracks copied |
| CT-05 | Copy track to different Part | Source Part 1 T1 to Part 2 T1 | Track copied across Parts |
| CT-06 | Copy track to different bank | Copy track across banks | Track copied across banks |
| CT-07 | Copy track to different project | Copy track to another project | Track copied across projects |

### 4.2 Copy Mode Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-08 | Part Params + Pattern Triggers | Select "Both" mode | Machine, Amp, LFO, FX AND pattern steps copied |
| CT-09 | Part Params Only | Select "Part Params Only" | Only sound design copied, no pattern data |
| CT-10 | Pattern Triggers Only | Select "Pattern Triggers Only" | Only step data copied, no sound design |

### 4.3 Validation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-11 | Mismatched track count | Select 3 source tracks, 2 dest tracks | Execute disabled, warning shown |
| CT-12 | Copy audio to MIDI slot | Select T1 source, M1 dest | Operation completes (may have limited utility) |

### 4.4 Data Integrity
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CT-13 | Verify track swing | Check swing amount after copy | Swing preserved |
| CT-14 | Verify per-track length | Check per-track length setting | Length preserved |
| CT-15 | Verify per-track scale | Check per-track speed | Scale preserved |
| CT-16 | Verify trig mode | Check trig mode setting | Trig mode preserved |
| CT-17 | Verify trig quantization | Check quantize setting | Quantization preserved |

---

## 5. Copy Sample Slots

### 5.1 Basic Functionality
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-01 | Copy single slot | Select slot 1 to 1. Execute. | Slot assignment copied |
| CSS-02 | Copy slot range | Select slots 1-10 to 1-10. Execute. | 10 slots copied |
| CSS-03 | Copy all 128 slots | Select slots 1-128. Execute. | All slots copied |
| CSS-04 | Copy to different starting slot | Slots 1-10 to slots 50-59. Execute. | Slots copied to offset position |
| CSS-05 | Copy to different project | Copy slots to another project | Slots copied across projects |

### 5.2 Slot Type Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-06 | Default is Static + Flex | Open Copy Sample Slots | "Static + Flex" button selected by default |
| CSS-07 | Flex Only | Click "Flex" button | Only Flex slots copied |
| CSS-08 | Static + Flex | Click "Static + Flex" button | Both slot types copied |
| CSS-09 | Static Only | Click "Static" button | Only Static slots copied |

### 5.3 Audio File Options
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-10 | Default is Move to Pool (same Set) | Select dest project in same Set | "Move to Pool" selected by default |
| CSS-11 | Move to Pool option | Both projects in same Set, "Move to Pool" selected | Files moved to AUDIO POOL, paths updated in both projects |
| CSS-12 | Copy option | Click "Copy" button | Audio files copied to dest project's sample folder |
| CSS-13 | Don't Copy option | Click "Don't Copy" button | Only slot assignments copied, no files moved/copied |
| CSS-14 | Move to Pool disabled (different Sets) | Projects NOT in same Set | "Move to Pool" button disabled with tooltip |
| CSS-15 | Auto-switch to Copy when not same Set | Select dest project NOT in same Set | Automatically switches from "Move to Pool" to "Copy" |
| CSS-16 | Auto-switch back to Move to Pool | Change dest to project in same Set (no manual selection made) | Automatically switches back to "Move to Pool" |
| CSS-17 | Manual selection preserved | Manually select "Copy", then change dest to same-Set project | "Copy" remains selected (user choice preserved) |
| CSS-18 | Pool will be created hint | Same Set, "Move to Pool" selected, no AUDIO POOL exists | "Pool will be created" hint visible with tooltip |
| CSS-19 | Create Audio Pool | Audio Pool doesn't exist, execute with "Move to Pool" | Audio Pool directory created automatically |

### 5.4 Editor Settings Option
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-20 | Include Editor Settings ON (default) | Check "Include Editor Settings" checkbox | Gain, loop mode, timestretch copied |
| CSS-21 | Include Editor Settings OFF | Uncheck option | Only path copied, default settings used |

### 5.5 Validation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-22 | Slot overflow | 100 slots starting at slot 50 | Warning shown (overflow to 149) |
| CSS-23 | Empty slot copy | Copy slot with no sample assigned | Empty slot copied (clears dest) |
| CSS-24 | Missing source file | Slot references non-existent file | Warning or error shown |

### 5.6 Data Integrity
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CSS-25 | Verify file path | Check slot path after copy | Correct path set |
| CSS-26 | Verify gain setting | Check gain value | Gain preserved |
| CSS-27 | Verify loop mode | Check loop setting | Loop mode preserved |
| CSS-28 | Verify timestretch | Check timestretch mode | Timestretch preserved |

---

## 6. UI/UX Tests

### 6.1 General UI
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| UI-01 | Tab visibility | Open project, check header tabs | "Tools" tab visible |
| UI-02 | Tab switching | Click Tools tab | Tools panel displayed |
| UI-03 | Operation dropdown | Click operation selector | All 5 operations listed |
| UI-04 | Panel layout | View Tools panel | 3 columns: Source, Options, Destination |
| UI-05 | Responsive layout | Resize window narrow | Panels stack vertically |

### 6.2 Select Styling
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| UI-06 | Select appearance | View any select dropdown | Dark background, custom arrow |
| UI-07 | Select hover state | Hover over select | Border turns orange, arrow turns orange |
| UI-08 | Select focus state | Focus on select | Orange border with glow |
| UI-09 | Option styling | Open select dropdown | Options have dark background |

### 6.3 Multi-Select Buttons
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| UI-10 | Part buttons | View Part selection buttons | 4 buttons (1-4) + All button |
| UI-11 | Pattern buttons | View Pattern selection | 16 buttons in grid + All |
| UI-12 | Track buttons | View Track selection | Audio (T1-T8) and MIDI (M1-M8) groups |
| UI-13 | Button selection | Click button | Turns orange when selected |
| UI-14 | Button deselection | Click selected button | Returns to gray (if not last selected) |
| UI-15 | All button | Click "All" | All items selected |

### 6.4 Toggle Button Groups
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| UI-16 | Slot Type buttons | View Copy Sample Slots | 3 buttons: Flex, Static + Flex (selected), Static |
| UI-17 | Audio Files buttons | View Copy Sample Slots (same Set dest) | 3 buttons: Copy, Move to Pool (selected), Don't Copy |
| UI-18 | Audio Files buttons (different Set) | Select dest NOT in same Set | "Move to Pool" button disabled |
| UI-19 | Toggle selection | Click different toggle option | Previous deselected, new selected (orange) |
| UI-20 | Disabled toggle button | Hover on disabled "Move to Pool" | Tooltip explains why disabled |

### 6.5 Status Feedback
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| UI-21 | Execute button | View execute button | Orange button with icon |
| UI-22 | Loading state | Execute operation | Button shows spinner, "Executing..." |
| UI-23 | Success message | Complete operation | Green success message appears |
| UI-24 | Error message | Trigger error | Red error message appears |
| UI-25 | Warning messages | Trigger validation warning | Orange warning text below field |
| UI-26 | Pool will be created hint | Same Set, "Move to Pool", no AUDIO POOL | "Pool will be created" hint right-aligned |
| UI-27 | Pool hint tooltip | Hover on "Pool will be created" | Tooltip explains pool creation |

### 6.6 Dynamic UI Updates
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| UI-28 | Operation change | Switch operation type | Source/Options/Dest panels update |
| UI-29 | Project change | Select different dest project | Bank list updates for that project |
| UI-30 | Conditional options | Copy Patterns: select "Assign to Specific Part" | Part selector appears |
| UI-31 | Conditional options | Copy Patterns: select "Specific Tracks" | Track selector appears |
| UI-32 | Audio mode auto-switch | Change dest from same-Set to different-Set | Audio mode switches from "Move to Pool" to "Copy" |

---

## 7. Error Handling

### 7.1 Validation Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-01 | Bank index out of range | (internal) Send bank index > 15 | Error message displayed |
| ERR-02 | Part count mismatch | Different source/dest Part counts | Execute disabled |
| ERR-03 | Track count mismatch | Different source/dest Track counts | Execute disabled |
| ERR-04 | Slot index out of range | (internal) Send slot > 128 | Error message displayed |

### 7.2 File System Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-05 | Source project not found | Remove source project during operation | Error: project not found |
| ERR-06 | Dest project not found | Invalid dest project path | Error: project not found |
| ERR-07 | Source bank not found | Bank file missing | Error: bank not found |
| ERR-08 | Permission denied | Read-only destination | Error: permission denied |
| ERR-09 | Disk full | Fill disk, attempt copy with audio | Error: disk full |

### 7.3 Recovery
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-10 | Error recovery | After error, retry operation | Operation can be retried |
| ERR-11 | Partial failure | Multi-item copy partially fails | Clear error message, partial state indicated |

---

## 8. Cross-Project Tests

### 8.1 Same Set Operations
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| XP-01 | Same Set detection | Two projects in same Set | "Move to Audio Pool" available |
| XP-02 | Different Set detection | Projects in different Sets | "Move to Audio Pool" not available |
| XP-03 | Standalone project | Project not in any Set | "Move to Audio Pool" not available |

### 8.2 Audio Pool Operations
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| XP-04 | Audio Pool exists | Set has AUDIO POOL folder | Status shows exists |
| XP-05 | Audio Pool creation | Set has no AUDIO POOL | Created when "Move to Pool" used |
| XP-06 | Audio Pool path update | Move files to pool | Source project paths updated |

---

## 9. Performance Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| PERF-01 | Large bank copy | Copy bank with max data | Completes in reasonable time |
| PERF-02 | All patterns copy | Copy all 16 patterns | Completes in reasonable time |
| PERF-03 | All sample slots | Copy 128 slots with audio files | Completes, shows progress |
| PERF-04 | UI responsiveness | Execute long operation | UI remains responsive |

---

## 10. Regression Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| REG-01 | Other tabs unaffected | Use Tools, switch to Parts tab | Parts tab works normally |
| REG-02 | Project reload | After copy, refresh project | Changes visible after reload |
| REG-03 | Edit mode compatibility | Tools operations in Edit mode | No interference |
| REG-04 | Multiple operations | Execute multiple operations in sequence | All complete successfully |

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
