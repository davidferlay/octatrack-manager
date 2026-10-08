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
| PE4 | Layout | MIDI page tabs | Select a MIDI track | Page tabs read All, NOTE, ARP, LFO, CTRL 1, CTRL 2 |
| PE5 | Layout | FX tabs name the effect | Select a track whose FX1 slot holds an effect | The FX1 section heading names it, such as "FX1 - FILTER" |
| PE6 | Layout | All Audio Tracks | Set the track selector to All Audio Tracks | All eight audio tracks are shown side by side, each with its own header |
| PE7 | Layout | All MIDI Tracks | Set the track selector to All MIDI Tracks | All eight MIDI tracks are shown side by side |
| PE8 | Layout | Bank switch keeps the page | Pick a page tab, then switch bank | The same page tab is still selected for the new bank |
| PE9 | Layout | LFO sub-tab persists | On the LFO page select LFO 2, switch bank, return | LFO 2 is still the selected sub-tab |
| PE10 | Layout | Track header | Look at any track's header | It carries the track badge and TRK/CUE levels on the left, the sample slot and the machine type on the right |

## The ALL page

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE11 | All | Pane order | Open the All page on an audio track | Seven panes, in two rows: SRC, AMP, LFO 1 / LFO 2, LFO 3 / DESIGN, then FX1, FX2, REC |
| PE12 | All | LFOs share a pane | Look at the LFO 1 / LFO 2 pane | It holds both LFOs, one above the other, each named inside the pane |
| PE13 | All | LFO 3 shares with the designer | Look at the LFO 3 / DESIGN pane | It holds LFO 3 above the designer waveform, each named inside the pane |
| PE14 | All | No empty LFO pane | Look over the LFO panes | None of them shows an empty SETUP pane, because the device gives an LFO no setup page |
| PE15 | All | Recorder reachable from All | Look at the REC pane | Both recorder setup pages are shown, the same ones the REC tab shows |
| PE16 | All | Editing from All saves | In Edit mode change a value in any All pane, save, reopen on the device | The change is there, against that Part and track |
| PE17 | All | Designer editable from All | In Edit mode change the designer waveform in the LFO 3 / DESIGN pane, save, reopen | The drawn shape is the one the device shows |
| PE18 | All | MIDI All page | Switch to a MIDI track and open All | The LFOs are paired the same way, with the same pane names |

## View and Edit modes

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE19 | Mode | Edit controls hidden in View | Open the Parts tab in View mode | No Reload, Save or Save All buttons are shown |
| PE20 | Mode | Edit controls shown in Edit | Switch to Edit mode | Reload, Save and Save All appear |
| PE21 | Mode | Keyboard toggle | Press E with no text field focused | Mode toggles between View and Edit |
| PE22 | Mode | Values read-only in View | In View mode, click into a parameter value and type | Nothing changes; no save is triggered |
| PE23 | Mode | Knobs inert in View | In View mode, drag a knob | The knob does not move and no value changes |
| PE24 | Mode | Lists inert in View | In View mode, click a parameter that shows a list value | The list does not open |
| PE25 | Mode | Switches inert in View | In View mode, click a two-value setting such as SRC SETUP SLIC | It does not switch |
| PE26 | Mode | Edit marking is uniform | Switch to Edit mode and look over a page that mixes knobs and lists | Every editable value is outlined the same way - a list is marked exactly as a number is |
| PE27 | Mode | View mode stays legible | Switch back to View mode | Values stay readable; nothing is dimmed to the point of being hard to read |

## Parameter widgets

The device draws every parameter the same way: its name, then an indicator where the knob
sits, then the value as text. The app follows that.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE28 | Widget | Knob for a continuous value | Open SRC and look at PTCH, STRT, LEN | Each shows a rotary knob with the value in a box underneath |
| PE29 | Widget | Knob grows from the centre | Look at a value that reads either side of zero, such as AMP BAL or an LFO DEP | The knob's arc grows out of the middle, not from the left end |
| PE30 | Widget | Knob grows from the left | Look at a value that starts at zero, such as AMP ATK | The arc grows from the start of the travel |
| PE31 | Widget | Position bar for a list | Open SRC SETUP and look at LOOP, SLIC, RATE | Each shows a bar with a solid block marking where this value sits in the list, over the value name |
| PE32 | Widget | Position bar tracks the value | Change one of those settings to a later entry | The block moves right |
| PE33 | Widget | First and last entries | Set a list to its first entry, then its last | The block sits hard left, then hard right |
| PE34 | Widget | Long list still marks a position | Open a MIDI track's NOTE SETUP and look at CHAN (sixteen entries) | The block is narrow but still visible and still moves |
| PE35 | Widget | Waveform is drawn | Open LFO and look at WAVE | The waveform shape is drawn, not just named; its name is in the value box below |
| PE36 | Widget | Waveform matches the device | Set WAVE to each of TRI, SAW, RMP, SQR and RND in turn and compare with the device | Each drawn shape matches the device's. SAW is a plain rising line and RMP a ramp that resets - they are different shapes |
| PE37 | Widget | Designer slots get a stand-in | Set WAVE to one of the eight designer slots, T1 to T8 | A stepped outline is drawn, dimmer than the fixed shapes, and the slot name still shows. It stands for the shape drawn on that track's DESIGN page rather than being it |
| PE38 | Widget | Two values switch on click | In Edit mode click SRC SETUP SLIC, then click it again | It switches OFF to ON and back; no list opens |
| PE39 | Widget | More than two values still list | In Edit mode click SRC SETUP LOOP (four settings) | A list opens with all four entries |
| PE40 | Widget | Values share one line | Look at a row that mixes a list and a knob, such as SRC SETUP RATE, TSTR and TSNS | All three value boxes sit on the same line |
| PE41 | Widget | Nothing is cut off | Look over every page for the widest values - ANLG, PTCH, SRC PTCH, -12.0, 0.005 | Every value is readable in full; none is cut short |

## Setting values with the scroll wheel

Up is more, down is less, throughout.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE42 | Wheel | Steps a knob | In Edit mode, hover a knob parameter and turn the wheel up, then down | The value goes up one step, then back down - the knob and its readout follow |
| PE43 | Wheel | Over the knob and the readout | Hover a parameter's knob, then its value box, turning the wheel on each | Both step the value |
| PE44 | Wheel | Not over its name | Hover the parameter's name and turn the wheel | The value does not change and the page scrolls as usual - a page made mostly of parameters has to stay scrollable |
| PE45 | Wheel | Walks a list | Hover a setting with named values, such as SRC SETUP LOOP, and turn the wheel | It moves through that setting's own entries, one per notch, without the list opening |
| PE46 | Wheel | Flips a two-value setting | Hover SRC SETUP SLIC and turn the wheel | It switches between OFF and ON |
| PE47 | Wheel | Stops at the ends | Keep turning the wheel past the bottom of a parameter's range | It stops at the end rather than wrapping round to the top |
| PE48 | Wheel | Read-only in View mode | In View mode, hover a parameter and turn the wheel | Nothing changes |
| PE49 | Wheel | The page stays put | On a page long enough to scroll, hover a parameter and turn the wheel | The value steps and the page does not scroll underneath it |
| PE50 | Wheel | The page still scrolls elsewhere | Turn the wheel with the pointer away from any parameter or drop-down | The page scrolls normally |
| PE51 | Wheel | A list at its end hands the wheel back | Set a drop-down to its first or last entry, then keep turning the wheel that way | The page scrolls, rather than being stuck because the pointer is over a list with nowhere left to go |
| PE52 | Wheel | Every drop-down in the app | Hover the bank, track, pattern and tools drop-downs in turn and use the wheel | Each steps through its own entries, and the page follows as if the entry had been picked from the list |
| PE53 | Wheel | A disabled drop-down | Hover a drop-down that is greyed out and use the wheel | Nothing changes, and the page scrolls as usual |

## Parameter help on hover

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE54 | Help | Every parameter explains itself | Hover each parameter on SRC, AMP, LFO, FX1, FX2 and REC | Each shows a tooltip naming the parameter and saying what it changes; none hovers blank |
| PE55 | Help | MIDI parameters too | Hover each parameter on NOTE, ARP, LFO, CTRL 1 and CTRL 2 | The same; none hovers blank |
| PE56 | Help | Named settings are explained | Hover SRC SETUP LOOP | The tooltip names the parameter, then explains OFF, AUTO, ON and PIPO on their own lines |
| PE57 | Help | A knob with a numeric range has no value list | Hover SRC PTCH | The tooltip explains the parameter; it does not try to list every value |
| PE58 | Help | An effect knob follows its effect | Load a filter in FX1 and a delay in FX2, then hover BASE on each page | The filter's BASE talks about the cutoff, the delay's about the feedback loop - the same slot reads differently |
| PE59 | Help | Changing the effect changes the help | Change the effect in FX1, then hover its knobs again | The tooltips follow the new effect |
| PE60 | Help | Help follows the machine | Hover SRC LEN on a sample machine, then on a Pickup machine | On the sample machine it is how much of the sample one trig plays; on the Pickup it is the slave loop length |
| PE61 | Help | A centred value still shows its stored byte | Hover a value that reads either side of zero, such as AMP BAL | The tooltip ends with the raw value the device stores |
| PE62 | Help | Help matches the manual | Spot-check several tooltips against the user guide's parameter reference | Each says the same thing the guide does for that parameter |
| PE63 | Help | Help in both modes | Hover a parameter in View mode, then in Edit mode | The tooltip is the same in both |
| PE64 | Help | Page tabs | Hover each page tab on an audio track, then on a MIDI track | Each says what that page is for; none hovers blank |
| PE65 | Help | Part tabs | Hover a Part tab | It names the Part, then explains what a Part holds and that switching Part also switches the samples, scenes and MIDI arpeggiator |
| PE66 | Help | A modified Part says so | Change a value, then hover that Part's tab | The tooltip adds that it is modified and that Reload discards the changes |
| PE67 | Help | LFO sub-tabs | On the LFO page, hover LFO 1, LFO 2, LFO 3 and DESIGN | Each says which LFO it is and which others can modulate it; DESIGN explains the custom shape |
| PE68 | Help | Track header | Hover the track badge, TRK, CUE, SLOT and the machine badge | Each explains itself; none hovers blank |
| PE69 | Help | TRK and CUE are told apart | Hover TRK, then CUE | TRK says it sits after the effects so it cuts the tails; CUE says it feeds the cue outputs independently |
| PE70 | Help | Machine badge follows the machine | Hover the machine badge on tracks running different machines | Each describes that machine - a Neighbor one notes it cannot sit on track 1 or 5, a Thru one that it needs a trig before it passes audio |
| PE71 | Help | Slot field | Hover SLOT in View mode, then in Edit mode | Both name the slot, the file and the pool; View mode says to turn on Edit mode, Edit mode says to click to pick another |

## Values and ranges

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE72 | Value | PTCH reads in semitones | Open SRC and look at PTCH | It reads as semitones, such as 0.0 or -12.0, not as a raw byte |
| PE73 | Value | PTCH stops at an octave up | In Edit mode type 24 into PTCH | It settles at +12.0, which is as far as the device goes |
| PE74 | Value | PTCH stops at an octave down | Type -24 into PTCH | It settles at -12.0 |
| PE75 | Value | PTCH stores what the device stores | Set PTCH to a value in the app, save, open the project on the device | The device shows the same semitone value |
| PE76 | Value | Centred values read as an offset | Look at AMP VOL, AMP BAL or an LFO DEP | They read from -64 to +63, with the device's centre reading 0 |
| PE77 | Value | A plain parameter clamps | Type a number past the end of any ordinary parameter's range | It settles on the nearest end of the range, never past it |
| PE78 | Value | Times read as times | Look at AMP HOLD and SRC RTIM | They read as the device reads them - 0.007, 1/128, INF - not as raw bytes |
| PE79 | Value | MIDI notes read as notes | Open a MIDI track's NOTE page | NOTE reads as a note name, such as C4 |
| PE80 | Value | Settings read by their device names | Open SRC SETUP on a sample machine | LOOP, SLIC, RATE and the rest read by the device's own words, such as OFF, AUTO, PTCH |
| PE81 | Value | A two-state setting reads as its two names | Click through a setting the device shows as on or off | It shows exactly two names in turn, as the device names them |
| PE82 | Value | Choosing a name stores its value | Pick a named entry, save, reopen the project on the device | The device shows the same entry |
| PE83 | Value | Nothing can leave the range | Work through a page typing out-of-range numbers into every value | No parameter can be left holding a value the device would not produce |
| PE84 | Value | OFF is preserved, not clamped | On the REC page set QREC and QPL to OFF, save, reopen | Both still read OFF - the setting is not folded into the ordinary range |

## Changing a track's machine

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE85 | Machine | Badge in View mode | Look at the machine badge in a track header in View mode | It names the machine and cannot be changed |
| PE86 | Machine | Picker in Edit mode | Switch to Edit mode | The badge becomes a picker, outlined like every other editable field |
| PE87 | Machine | Reachable from every page | Switch page tabs in Edit mode | The picker is in the track header, so it is on SRC, AMP, LFO, FX, REC and All alike |
| PE88 | Machine | The five machines | Open the picker on a track other than T1 or T5 | It offers Static, Flex, Thru, Neighbor and Pickup, in that order |
| PE89 | Machine | Neighbor is withheld from T1 and T5 | Open the picker on T1, then on T5 | Neighbor is not offered - those tracks have no preceding track to listen to |
| PE90 | Machine | The SRC page follows | On the SRC page, switch a Flex track to Thru | The page changes to INAB, VOL, INCD, VOL and the setup page empties |
| PE91 | Machine | Parameters reset to the new machine | Switch a track to Pickup, then look at SRC | PTCH is at centre and DIR and OP are at their defaults, not at bytes left by the old machine |
| PE92 | Machine | The rest of the track is untouched | Note the AMP, LFO, FX and REC values and the TRK level, then change the machine | All of them are unchanged - they belong to the track, not to its machine |
| PE93 | Machine | Switching back is not an undo | Set SRC STRT to 99 on a Flex track, switch to Thru, then back to Flex | STRT reads its Flex default again, not 99 - the machine you pick starts at its own defaults either way. Reload Part is what puts a Part back |
| PE94 | Machine | Both sample slots survive | Note the slot on a Flex track, switch to Static and back | The Flex slot is as it was; the Static slot was never disturbed |
| PE95 | Machine | Saved per Part and track | Change a machine, save, open the project on the device | Only that Part and that track changed machine |
| PE96 | Machine | Other Parts keep theirs | Change the machine on one Part, then look at the same track on the others | They keep the machine they had |
| PE97 | Machine | Marks the Part modified | Change a machine | The Part tab shows as modified, and Reload puts the old machine back |
| PE98 | Machine | The track selector follows | Change a machine and open the track selector | That track is now named after the new machine |
| PE99 | Machine | A MIDI track has none | Select a MIDI track in Edit mode | The header shows a plain MIDI badge with no picker |
| PE100 | Machine | The device accepts it | Change each of the five machines in turn, save, open each on the device | Each reads as the machine that was picked |

## Machine-specific SRC pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE101 | SRC | Static and Flex | Select a track running Static, then one running Flex | SRC MAIN shows PTCH, STRT, LEN, RATE, RTRG, RTIM |
| PE102 | SRC | Thru | Select a track running Thru | SRC MAIN shows INAB and its VOL, then INCD and its VOL - not the sample settings |
| PE103 | SRC | Thru has no setup | Look at a Thru track's SRC SETUP | No setup parameters are offered, as on the device |
| PE104 | SRC | Thru VOL is centred | Look at a Thru track's VOL | It reads either side of its centre, as the device shows it |
| PE105 | SRC | Neighbor | Select a track running Neighbor | SRC MAIN and SRC SETUP both offer nothing - a Neighbor machine listens to the preceding track and has no parameters of its own |
| PE106 | SRC | Pickup | Select a track running Pickup | SRC MAIN shows PTCH, DIR, LEN, GAIN and OP, as the device does |
| PE107 | SRC | Pickup GAIN reads in decibels | Look at a Pickup machine's GAIN | It reads in dB as the device does, from -INF at the bottom |
| PE108 | SRC | Pickup timestretch cannot be off | Open a Pickup machine's SRC SETUP and open TSTR | OFF is not offered - the manual states a Pickup machine cannot disable timestretch |
| PE109 | SRC | SETUP LEN follows SLIC | With SLIC off note SETUP LEN's entries, then turn SLIC on | The LEN entries change to the ones the device offers in slice mode |
| PE110 | SRC | Machine type shown | Look at any track header | It names the machine the track runs, and that name matches the device |

## AMP page

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE111 | AMP | Five parameters, not six | Open the AMP page | ATK, HOLD, REL, VOL and BAL are shown; there is no sixth knob (the device has none on this page) |
| PE112 | AMP | SETUP settings | Look at AMP SETUP | AMP, SYNC, ATCK, FX1 and FX2 are shown, each as a list |
| PE113 | AMP | HOLD runs to INF | Drive HOLD to its maximum | It reads INF, as the device does |
| PE114 | AMP | AMP VOL is not the track level | Change AMP VOL, then look at the TRK level in the header | They are separate values; changing one does not move the other |

## LFO pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE115 | LFO | Three LFOs and a designer | Open the LFO page | LFO 1, LFO 2, LFO 3 and DESIGN are offered |
| PE116 | LFO | Parameters per LFO | Select each LFO in turn | Each shows PMTR, WAVE, MULT, TRIG, SPD and DEP |
| PE117 | LFO | Targets are named after the track | Open PMTR on a track and compare with the same track on the device | The SRC targets are named after that machine's own parameters, not generic numbers |
| PE118 | LFO | Targets are named after the effects | Load an effect in FX1, then open PMTR | The FX1 targets name that effect and its parameter, such as PLTE MIX |
| PE119 | LFO | Unused effect slots named by letter | Point PMTR at a knob position the effect does not use | It reads as the device names it, such as DJEQ <B> |
| PE120 | LFO | Target list order matches the device | Scroll PMTR and compare the order with the device | The entries are in the same order, with the AMP targets before the LFO ones |
| PE121 | LFO | Target stores the right parameter | Pick a target in the app, save, open on the device | The device shows the same target - not a neighbouring one |
| PE122 | LFO | Changing the effect renames the targets | Change FX1 to a different effect, reopen PMTR | The FX1 target names follow the new effect |
| PE123 | LFO | MIDI LFO targets | Open a MIDI track's LFO page and open PMTR | The targets are that MIDI track's own parameters, not an audio track's |
| PE124 | LFO | MIDI targets read like the audio ones | Compare a MIDI track's PMTR list with an audio track's | Both name the page then the parameter in the device's abbreviations - NOTE VEL and ARP TRAN beside SRC PTCH and AMP ATK, never a long prose name |
| PE125 | LFO | MIDI target names match their pages | Pick a MIDI target, then open the page it names | The parameter is there under that exact name |
| PE126 | LFO | MIDI target stores the right parameter | Point a MIDI LFO at CTRL2 CC10, save, open on the device | The device shows that same target |

## Changing a track's effects

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE127 | Effect | Name in View mode | Look at an FX heading in View mode | It names the effect and cannot be changed |
| PE128 | Effect | Picker in Edit mode | Switch to Edit mode | The name becomes a picker, outlined like every other editable field |
| PE129 | Effect | The heading does not move | Look at an FX heading, then toggle Edit mode | The heading stays exactly where it was - the picker is sized to the effect it shows, not to the longest name in the list |
| PE130 | Effect | Every effect is offered | Open the picker | It offers OFF and the fifteen effects |
| PE131 | Effect | Both blocks | Change FX1, then FX2 | Each changes on its own; the other is untouched |
| PE132 | Effect | The knobs follow | Change a filter to a spring reverb | The page becomes TIME, HP, LP, MIX, and TIME keeps its row to itself as the device leaves it |
| PE133 | Effect | The help follows | Change the effect, then hover a knob | The tooltip is the new effect's |
| PE134 | Effect | The LFO targets follow | Point an LFO at an FX1 parameter, then change the FX1 effect | The target names the new effect, such as PLTE TIME in place of FLTR BASE |
| PE135 | Effect | Parameters reset to the device's own | Set a filter BASE to 77, change the block to a spring reverb | TIME reads 23, HP 20, LP 127 and SETUP TYPE reads 2 - the values the device writes when it loads a spring reverb, not the ones the filter left |
| PE136 | Effect | Blank positions are stepped over | Set a filter WDTH to 99, change the block to a spring reverb | The second position, which a spring reverb leaves blank, still holds 99 - the device never writes there |
| PE137 | Effect | OFF changes nothing but the type | Set a parameter, then set the block to OFF | The parameters are untouched; the device shows nothing for an empty block |
| PE138 | Effect | Each effect's own values | Load each effect in turn and compare with the device | Each comes up at the same values the device gives it |
| PE139 | Effect | Picker order matches the device | Open the picker and compare with the device's own list | OFF, Filter, EQ, DJ EQ, Phaser, Flanger, Chorus, Spatializer, Comb filter, Compressor, Lo-fi, Delay, Plate Rev, Spring Rev, Dark Rev |
| PE140 | Effect | Changeable from ALL | On the ALL page, change the effect in the FX1 heading | It changes there too, and the knobs below follow |
| PE141 | Effect | Saved per Part, track and block | Change an effect, save, open the project on the device | Only that Part, that track and that block changed |
| PE142 | Effect | Marks the Part modified | Change an effect | The Part tab shows as modified, and Reload puts the old effect back |
| PE143 | Effect | OFF empties the page | Set a block to OFF | The page shows no parameters, as the device does for a block with no effect |

## Effect pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE144 | FX | Parameters follow the effect | Change the effect loaded in FX1 | The FX1 parameter names change to that effect's |
| PE145 | FX | Six positions per page | Open any effect's MAIN and SETUP pages | Each page has six knob positions |
| PE146 | FX | Gaps are kept | Open the DJ EQ MAIN page | LS F is first, the second position is empty, then HS F, LOWG, MIDG, HI G - matching the device |
| PE147 | FX | Comb filter gap | Open the comb filter MAIN page | MIX is the sixth parameter, past an empty fifth |
| PE148 | FX | Spring reverb gap | Open the spring reverb MAIN page | TIME is alone on the first row, then HP, LP, MIX |
| PE149 | FX | Reverb setup gap | Open the plate or dark reverb SETUP page | MIXF is the last position, not the fourth |
| PE150 | FX | No setup page | Open the DJ EQ, flanger or comb filter SETUP page | No setup parameters are offered - the device gives these effects none |
| PE151 | FX | Device wording | Compare the filter's MAIN labels with the device | They read WDTH and DPTH, as the device writes them |
| PE152 | FX | A knob writes its own parameter | Change the last knob on a page that has a gap, save, open on the device | The device shows that same parameter changed, not the one beside it |

## Recorder setup

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE153 | REC | Two setup pages | Open the REC page | Two sections are shown, in the device's order |
| PE154 | REC | Page one settings | Look at the first section | INAB, INCD, RLEN, TRIG, SRC3 and LOOP are shown, named as the device names them |
| PE155 | REC | Page two settings | Look at the second section | FIN, FOUT, AB, QREC, QPL and CD are shown |
| PE156 | REC | Fades read in steps | Look at FIN and FOUT | They read as sequencer steps, as the device shows them |
| PE157 | REC | RLEN MAX | Drive RLEN to its maximum | It reads MAX |
| PE158 | REC | Saves against the right Part and track | Change a recorder setting, save, reopen on the device | Only that Part and that track's recorder changed |

## MIDI track pages

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE159 | MIDI | NOTE page | Open a MIDI track's NOTE page | NOTE, VEL, LEN and the three extra notes are shown, then CHAN, BANK, PROG and SBNK on setup |
| PE160 | MIDI | Bank and program can be Off | Set BANK, PROG or SBNK to its Off value, save, reopen | It still reads Off, not a number |
| PE161 | MIDI | ARP page | Open the ARP page | TRAN, LEG, MODE, SPD, RNGE and NLEN are shown on MAIN, LEN and KEY on SETUP |
| PE162 | MIDI | ARP key names | Open the ARP key list | It offers Off and the twenty-four major and minor keys, named as the device names them |
| PE163 | MIDI | CTRL pages | Open CTRL 1 and CTRL 2 | The controller assignments and their values are shown |
| PE164 | MIDI | Pitchbend is centred | Look at CTRL 1 PB | It reads either side of zero, with the device's centre reading 0 |

## Sample slot per track and Part

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE165 | Slot | Slot shown in the header | Look at a track header | The sample slot number is shown beside the machine type |
| PE166 | Slot | Read-only in View mode | In View mode, click the slot control | Nothing opens |
| PE167 | Slot | Picker lists the right pool | In Edit mode, open the slot picker on a Flex machine, then on a Static one | Each lists its own pool, with the current assignment marked |
| PE168 | Slot | Opens on the assigned sample | Open the picker on a track whose sample is well down a long list | The list is already scrolled to that sample, roughly centred, with it under the cursor |
| PE169 | Slot | Opens on it even when the slot is empty | Open the picker on a track pointing at a slot that holds nothing | The list is scrolled to that slot's row, under the cursor |
| PE170 | Slot | A short list does not scroll | Open the picker on a pool holding only a few samples | The list sits at the top, nothing is scrolled |
| PE171 | Slot | Arrows do not jump the list | Open the picker and press the down arrow once | The cursor moves one row and the list does not jump - it only scrolls once the cursor would leave the view |
| PE172 | Slot | Keyboard selection | In the picker, use the arrow keys then press Enter | The highlighted slot is assigned |
| PE173 | Slot | Search | Press Ctrl+F in the picker, then type | The search box takes focus and the list filters |
| PE174 | Slot | Sorting | Click a picker column header | The slot list sorts by that column |
| PE175 | Slot | Preview | Preview a sample from the picker | It plays, as on the Sample Slots pages |
| PE176 | Slot | Escape closes without assigning | Open the picker, press Escape | The picker closes and the assignment is unchanged |
| PE177 | Slot | Row context menu | Right-click a slot row in the picker | The menu reads Play, then Un-assign on the assigned row only, then Open in file explorer and Copy path to clipboard |
| PE178 | Slot | Un-assign | Choose Un-assign on the assigned row | The track points at an empty slot |
| PE179 | Slot | Un-assign with a full pool | Fill every slot of a pool, then choose Un-assign on the assigned row | It is still offered. It empties the slot the track is on and leaves the track there, which is what the device writes - the tooltip says which slot and warns that another track on it loses its sample too |
| PE180 | Slot | Un-assign does not move the track when the pool is full | After the above, look at the track header | It still names the same slot, which now holds nothing; the Part is not marked modified because only the pool changed |
| PE181 | Slot | Re-picking the same slot writes nothing | Open the picker and press Assign without moving the selection | Nothing is saved and the Part is not marked modified |
| PE182 | Slot | Escape closes the menu, not the picker | With the context menu open, press Escape | The menu closes and the picker stays open |
| PE183 | Slot | Saved per Part and track | Assign a slot, save, open on the device | Only that Part and that track changed |
| PE184 | Slot | Usage badges follow | Assign a slot and watch the Flex/Static tab counts | The counts update and nothing else changes |

## Track and Cue levels

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE185 | Levels | Shown in the header | Look at a track header | TRK and CUE are shown there, on every page including All |
| PE186 | Levels | Read-only in View mode | In View mode, try to change TRK | Nothing changes |
| PE187 | Levels | Saved per Part and track | Change TRK, save, open on the device | That Part and track's level changed, and nothing else |

## Editing, saving and reloading

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| PE188 | Save | Buttons disabled when clean | Enter Edit mode without changing anything | Reload, Save and Save All are all disabled |
| PE189 | Save | Editing marks the Part | Change any parameter | That Part's tab is marked as modified |
| PE190 | Save | Save commits the active Part | Change a parameter, press Save | The modified marking clears for that Part only |
| PE191 | Save | Save All commits every Part | Modify two Parts, press Save All | Every modified marking clears |
| PE192 | Save | Reload restores the Part | Modify a Part, press Reload | Its values return to the last saved ones and the marking clears |
| PE193 | Save | Reload affects one Part | Modify two Parts, Reload one | Only that Part reverts; the other keeps its changes |
| PE194 | Save | Edited on the device | Edit a Part on the device without saving it there, then open the bank in the app | The app shows that Part as modified |
| PE195 | Save | Reload blocked without a saved state | On a Part the device has never saved, press Reload | Reload is refused rather than clearing the Part |
| PE196 | Save | Changes survive a reopen | Change a parameter, leave the Parts tab, come back | The change is still there and the Part is still marked modified |
| PE197 | Save | Committed values reach the device | Save, eject, open the project on the device | The device shows the edited values in that Part |
| PE198 | Save | Other Parts untouched | Change one Part, save, compare the other three on the device | They are unchanged |
| PE199 | Pages | Wheel through the pages | Hover the page tab strip and turn the wheel | The page moves one at a time, ALL through REC |
| PE200 | Pages | Wheel stops at either end | Turn the wheel past ALL, then past REC | It holds at each end rather than wrapping |
| PE201 | Pages | A MIDI track has one page fewer | Select a MIDI track and wheel to the end | It stops at CTRL 2; there is no REC page |
| PE202 | Pages | Anywhere over the strip | Turn the wheel over the strip's padding, not a tab | The page still moves |
| PE203 | Levels | FX1 offers ten effects | Open FX1 in Edit mode | The delay and the three reverbs are not listed |
| PE204 | Levels | FX2 offers all fifteen | Open FX2 in Edit mode | The delay and the three reverbs are listed |
| PE205 | Levels | A block keeps naming what it holds | Open a project whose FX1 holds a reverb | The picker names it rather than reading as another effect |
| PE206 | Layout | No sideways scrollbar | Open each page tab at a normal window width | The window never scrolls horizontally |
