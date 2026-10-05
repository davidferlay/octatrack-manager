# Parts Tab - Manual QA Test Cases

Functional test cases for the Parts editor: the four Parts of a bank, their audio and
MIDI track pages, the parameter widgets, and saving to `parts.unsaved` / committing to
`parts.saved`. Covers behaviour only, not visual styling.

Preconditions unless stated otherwise: open a project, go to the Parts tab, and pick a
bank. A bank whose eight tracks use different machine types and different effects gives
the widest coverage in the fewest passes - the SRC pages and the FX parameter names both
change with what the track runs.

Several cases ask you to compare against the hardware. Where they do, make the setting on
the device first, save the project there, then open the same bank in the app.

## Navigation and layout

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE1 | Layout | Four Part tabs | Open the Parts tab | Four tabs are shown, each named from the bank - the device's own Part name, with its number beside it |
| PE2 | Layout | Switching Part shows that Part | Note a parameter value, switch to another Part tab | Every value on the page changes to that Part's values |
| PE3 | Layout | Audio page tabs | Select an audio track (T1-T8) | Page tabs read All, SRC, AMP, LFO, FX1, FX2, REC |
| PE4 | Layout | MIDI page tabs | Select a MIDI track | Page tabs read All, NOTE, ARP, LFO, CTRL1, CTRL2 |
| PE5 | Layout | FX tabs name the effect | Select a track whose FX1 slot holds an effect | The FX1 section heading names it, such as "FX1 - FILTER" |
| PE6 | Layout | All Audio Tracks | Set the track selector to All Audio Tracks | All eight audio tracks are shown side by side, each with its own header |
| PE7 | Layout | All MIDI Tracks | Set the track selector to All MIDI Tracks | All eight MIDI tracks are shown side by side |
| PE8 | Layout | Bank switch keeps the page | Pick a page tab, then switch bank | The same page tab is still selected for the new bank |
| PE9 | Layout | LFO sub-tab persists | On the LFO page select LFO 2, switch bank, return | LFO 2 is still the selected sub-tab |
| PE10 | Layout | Track header | Look at any track's header | It carries the track badge and TRK/CUE levels on the left, the sample slot and the machine type on the right |

## View and Edit modes

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE11 | Mode | Edit controls hidden in View | Open the Parts tab in View mode | No Reload, Save or Save All buttons are shown |
| PE12 | Mode | Edit controls shown in Edit | Switch to Edit mode | Reload, Save and Save All appear |
| PE13 | Mode | Keyboard toggle | Press E with no text field focused | Mode toggles between View and Edit |
| PE14 | Mode | Values read-only in View | In View mode, click into a parameter value and type | Nothing changes; no save is triggered |
| PE15 | Mode | Knobs inert in View | In View mode, drag a knob | The knob does not move and no value changes |
| PE16 | Mode | Lists inert in View | In View mode, click a parameter that shows a list value | The list does not open |
| PE17 | Mode | Edit marking is uniform | Switch to Edit mode and look over a page that mixes knobs and lists | Every editable value is outlined the same way - a list is marked exactly as a number is |
| PE18 | Mode | View mode stays legible | Switch back to View mode | Values stay readable; nothing is dimmed to the point of being hard to read |

## Parameter widgets

The device draws every parameter the same way: its name, then an indicator where the knob
sits, then the value as text. The app follows that.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE19 | Widget | Knob for a continuous value | Open SRC and look at PTCH, STRT, LEN | Each shows a rotary knob with the value in a box underneath |
| PE20 | Widget | Knob grows from the centre | Look at a value that reads either side of zero, such as AMP BAL or an LFO DEP | The knob's arc grows out of the middle, not from the left end |
| PE21 | Widget | Knob grows from the left | Look at a value that starts at zero, such as AMP ATK | The arc grows from the start of the travel |
| PE22 | Widget | Position bar for a list | Open SRC SETUP and look at LOOP, SLIC, RATE | Each shows a bar with a solid block marking where this value sits in the list, over the value name |
| PE23 | Widget | Position bar tracks the value | Change one of those settings to a later entry | The block moves right |
| PE24 | Widget | First and last entries | Set a list to its first entry, then its last | The block sits hard left, then hard right |
| PE25 | Widget | Long list still marks a position | Open a MIDI track's NOTE SETUP and look at CHAN (sixteen entries) | The block is narrow but still visible and still moves |
| PE26 | Widget | Waveform is drawn | Open LFO and look at WAVE | The waveform shape is drawn, not just named; its name is in the value box below |
| PE27 | Widget | Waveform matches the device | Set WAVE to each of TRI, SAW, RMP, SQR and RND in turn and compare with the device | Each drawn shape matches the device's. SAW is a plain rising line and RMP a ramp that resets - they are different shapes |
| PE28 | Widget | Designer slots draw nothing | Set WAVE to one of the eight designer slots | No shape is drawn (the designer slots have no fixed shape); the name still shows |
| PE29 | Widget | Values share one line | Look at a row that mixes a list and a knob, such as SRC SETUP RATE, TSTR and TSNS | All three value boxes sit on the same line |
| PE30 | Widget | Nothing is cut off | Look over every page for the widest values - ANLG, PTCH, SRC PTCH, -12.0, 0.005 | Every value is readable in full; none is cut short |

## Values and ranges

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE31 | Value | PTCH reads in semitones | Open SRC and look at PTCH | It reads as semitones, such as 0.0 or -12.0, not as a raw byte |
| PE32 | Value | PTCH stops at an octave up | In Edit mode type 24 into PTCH | It settles at +12.0, which is as far as the device goes |
| PE33 | Value | PTCH stops at an octave down | Type -24 into PTCH | It settles at -12.0 |
| PE34 | Value | PTCH stores what the device stores | Set PTCH to a value in the app, save, open the project on the device | The device shows the same semitone value |
| PE35 | Value | Centred values read as an offset | Look at AMP VOL, AMP BAL or an LFO DEP | They read from -64 to +63, with the device's centre reading 0 |
| PE36 | Value | A plain parameter clamps | Type a number past the end of any ordinary parameter's range | It settles on the nearest end of the range, never past it |
| PE37 | Value | Times read as times | Look at AMP HOLD and SRC RTIM | They read as the device reads them - 0.007, 1/128, INF - not as raw bytes |
| PE38 | Value | MIDI notes read as notes | Open a MIDI track's NOTE page | NOTE reads as a note name, such as C4 |
| PE39 | Value | Settings read by their device names | Open SRC SETUP on a sample machine | LOOP, SLIC, RATE and the rest read by the device's own words, such as OFF, AUTO, PTCH |
| PE40 | Value | A two-state setting reads as its two names | Find a setting the device shows as on or off | It offers exactly two entries, named as the device names them |
| PE41 | Value | Choosing a name stores its value | Pick a named entry, save, reopen the project on the device | The device shows the same entry |
| PE42 | Value | Nothing can leave the range | Work through a page typing out-of-range numbers into every value | No parameter can be left holding a value the device would not produce |
| PE43 | Value | OFF is preserved, not clamped | On the REC page set QREC and QPL to OFF, save, reopen | Both still read OFF - the setting is not folded into the ordinary range |

## Machine-specific SRC pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE44 | SRC | Static and Flex | Select a track running Static, then one running Flex | SRC MAIN shows PTCH, STRT, LEN, RATE, RTRG, RTIM |
| PE45 | SRC | Thru | Select a track running Thru | SRC MAIN shows INAB and its VOL, then INCD and its VOL - not the sample settings |
| PE46 | SRC | Thru has no setup | Look at a Thru track's SRC SETUP | No setup parameters are offered, as on the device |
| PE47 | SRC | Thru VOL is centred | Look at a Thru track's VOL | It reads either side of its centre, as the device shows it |
| PE48 | SRC | Neighbor | Select a track running Neighbor | SRC MAIN and SRC SETUP both offer nothing - a Neighbor machine listens to the preceding track and has no parameters of its own |
| PE49 | SRC | Pickup | Select a track running Pickup | SRC MAIN shows PTCH, DIR, LEN, GAIN and OP, as the device does |
| PE50 | SRC | Pickup GAIN reads in decibels | Look at a Pickup machine's GAIN | It reads in dB as the device does, from -INF at the bottom |
| PE51 | SRC | Pickup timestretch cannot be off | Open a Pickup machine's SRC SETUP and open TSTR | OFF is not offered - the manual states a Pickup machine cannot disable timestretch |
| PE52 | SRC | SETUP LEN follows SLIC | With SLIC off note SETUP LEN's entries, then turn SLIC on | The LEN entries change to the ones the device offers in slice mode |
| PE53 | SRC | Machine type shown | Look at any track header | It names the machine the track runs, and that name matches the device |

## AMP page

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE54 | AMP | Five parameters, not six | Open the AMP page | ATK, HOLD, REL, VOL and BAL are shown; there is no sixth knob (the device has none on this page) |
| PE55 | AMP | SETUP settings | Look at AMP SETUP | AMP, SYNC, ATCK, FX1 and FX2 are shown, each as a list |
| PE56 | AMP | HOLD runs to INF | Drive HOLD to its maximum | It reads INF, as the device does |
| PE57 | AMP | AMP VOL is not the track level | Change AMP VOL, then look at the TRK level in the header | They are separate values; changing one does not move the other |

## LFO pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE58 | LFO | Three LFOs and a designer | Open the LFO page | LFO 1, LFO 2, LFO 3 and DESIGN are offered |
| PE59 | LFO | Parameters per LFO | Select each LFO in turn | Each shows PMTR, WAVE, MULT, TRIG, SPD and DEP |
| PE60 | LFO | Targets are named after the track | Open PMTR on a track and compare with the same track on the device | The SRC targets are named after that machine's own parameters, not generic numbers |
| PE61 | LFO | Targets are named after the effects | Load an effect in FX1, then open PMTR | The FX1 targets name that effect and its parameter, such as PLTE MIX |
| PE62 | LFO | Unused effect slots named by letter | Point PMTR at a knob position the effect does not use | It reads as the device names it, such as DJEQ <B> |
| PE63 | LFO | Target list order matches the device | Scroll PMTR and compare the order with the device | The entries are in the same order, with the AMP targets before the LFO ones |
| PE64 | LFO | Target stores the right parameter | Pick a target in the app, save, open on the device | The device shows the same target - not a neighbouring one |
| PE65 | LFO | Changing the effect renames the targets | Change FX1 to a different effect, reopen PMTR | The FX1 target names follow the new effect |
| PE66 | LFO | MIDI LFO targets | Open a MIDI track's LFO page and open PMTR | The targets are that MIDI track's own parameters, not an audio track's |

## Effect pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE67 | FX | Parameters follow the effect | Change the effect loaded in FX1 | The FX1 parameter names change to that effect's |
| PE68 | FX | Six positions per page | Open any effect's MAIN and SETUP pages | Each page has six knob positions |
| PE69 | FX | Gaps are kept | Open the DJ EQ MAIN page | LS F is first, the second position is empty, then HS F, LOWG, MIDG, HI G - matching the device |
| PE70 | FX | Comb filter gap | Open the comb filter MAIN page | MIX is the sixth parameter, past an empty fifth |
| PE71 | FX | Spring reverb gap | Open the spring reverb MAIN page | TIME is alone on the first row, then HP, LP, MIX |
| PE72 | FX | Reverb setup gap | Open the plate or dark reverb SETUP page | MIXF is the last position, not the fourth |
| PE73 | FX | No setup page | Open the DJ EQ, flanger or comb filter SETUP page | No setup parameters are offered - the device gives these effects none |
| PE74 | FX | Device wording | Compare the filter's MAIN labels with the device | They read WDTH and DPTH, as the device writes them |
| PE75 | FX | A knob writes its own parameter | Change the last knob on a page that has a gap, save, open on the device | The device shows that same parameter changed, not the one beside it |

## Recorder setup

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE76 | REC | Two setup pages | Open the REC page | Two sections are shown, in the device's order |
| PE77 | REC | Page one settings | Look at the first section | INAB, INCD, RLEN, TRIG, SRC3 and LOOP are shown, named as the device names them |
| PE78 | REC | Page two settings | Look at the second section | FIN, FOUT, AB, QREC, QPL and CD are shown |
| PE79 | REC | Fades read in steps | Look at FIN and FOUT | They read as sequencer steps, as the device shows them |
| PE80 | REC | RLEN MAX | Drive RLEN to its maximum | It reads MAX |
| PE81 | REC | Saves against the right Part and track | Change a recorder setting, save, reopen on the device | Only that Part and that track's recorder changed |

## MIDI track pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE82 | MIDI | NOTE page | Open a MIDI track's NOTE page | NOTE, VEL, LEN and the three extra notes are shown, then CHAN, BANK, PROG and SBNK on setup |
| PE83 | MIDI | Bank and program can be Off | Set BANK, PROG or SBNK to its Off value, save, reopen | It still reads Off, not a number |
| PE84 | MIDI | ARP page | Open the ARP page | TRAN, LEG, MODE, SPD, RNGE and NLEN are shown on MAIN, LEN and KEY on SETUP |
| PE85 | MIDI | ARP key names | Open the ARP key list | It offers Off and the twenty-four major and minor keys, named as the device names them |
| PE86 | MIDI | CTRL pages | Open CTRL1 and CTRL2 | The controller assignments and their values are shown |
| PE87 | MIDI | Pitchbend is centred | Look at CTRL1 PB | It reads either side of zero, with the device's centre reading 0 |

## Sample slot per track and Part

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE88 | Slot | Slot shown in the header | Look at a track header | The sample slot number is shown beside the machine type |
| PE89 | Slot | Read-only in View mode | In View mode, click the slot control | Nothing opens |
| PE90 | Slot | Picker lists the right pool | In Edit mode, open the slot picker on a Flex machine, then on a Static one | Each lists its own pool, with the current assignment marked |
| PE91 | Slot | Keyboard selection | In the picker, use the arrow keys then press Enter | The highlighted slot is assigned |
| PE92 | Slot | Search | Press Ctrl+F in the picker, then type | The search box takes focus and the list filters |
| PE93 | Slot | Sorting | Click a picker column header | The slot list sorts by that column |
| PE94 | Slot | Preview | Preview a sample from the picker | It plays, as on the Sample Slots pages |
| PE95 | Slot | Escape closes without assigning | Open the picker, press Escape | The picker closes and the assignment is unchanged |
| PE96 | Slot | Row context menu | Right-click a slot row in the picker | The menu reads Play, then Un-assign on the assigned row only, then Open in file explorer and Copy path to clipboard |
| PE97 | Slot | Un-assign | Choose Un-assign on the assigned row | The track points at an empty slot |
| PE98 | Slot | Escape closes the menu, not the picker | With the context menu open, press Escape | The menu closes and the picker stays open |
| PE99 | Slot | Saved per Part and track | Assign a slot, save, open on the device | Only that Part and that track changed |
| PE100 | Slot | Usage badges follow | Assign a slot and watch the Flex/Static tab counts | The counts update and nothing else changes |

## Track and Cue levels

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE101 | Levels | Shown in the header | Look at a track header | TRK and CUE are shown there, on every page including All |
| PE102 | Levels | Read-only in View mode | In View mode, try to change TRK | Nothing changes |
| PE103 | Levels | Saved per Part and track | Change TRK, save, open on the device | That Part and track's level changed, and nothing else |

## Editing, saving and reloading

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE104 | Save | Buttons disabled when clean | Enter Edit mode without changing anything | Reload, Save and Save All are all disabled |
| PE105 | Save | Editing marks the Part | Change any parameter | That Part's tab is marked as modified |
| PE106 | Save | Save commits the active Part | Change a parameter, press Save | The modified marking clears for that Part only |
| PE107 | Save | Save All commits every Part | Modify two Parts, press Save All | Every modified marking clears |
| PE108 | Save | Reload restores the Part | Modify a Part, press Reload | Its values return to the last saved ones and the marking clears |
| PE109 | Save | Reload affects one Part | Modify two Parts, Reload one | Only that Part reverts; the other keeps its changes |
| PE110 | Save | Edited on the device | Edit a Part on the device without saving it there, then open the bank in the app | The app shows that Part as modified |
| PE111 | Save | Reload blocked without a saved state | On a Part the device has never saved, press Reload | Reload is refused rather than clearing the Part |
| PE112 | Save | Changes survive a reopen | Change a parameter, leave the Parts tab, come back | The change is still there and the Part is still marked modified |
| PE113 | Save | Committed values reach the device | Save, eject, open the project on the device | The device shows the edited values in that Part |
| PE114 | Save | Other Parts untouched | Change one Part, save, compare the other three on the device | They are unchanged |
