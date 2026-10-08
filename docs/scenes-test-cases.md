# Scenes Tab - Manual QA Test Cases

Functional test cases for the Scenes tab: the sixteen scenes each Part holds, what each
one locks, and which two the crossfader sits between. Covers behaviour only, not styling.

A scene is a snapshot the crossfader morphs towards. It holds only the parameters put
into it; every other parameter carries on from the Part. That is why a scene reads as a
list of what it holds rather than as a second set of parameter pages.

Preconditions unless stated otherwise: open a project, go to the Scenes tab, and pick a
bank. A bank whose scenes were built on the device gives the most to look at.

## Reading a Part's scenes

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| SC1 | Grid | Sixteen scenes | Open the Scenes tab | Sixteen cards, numbered 1 to 16 |
| SC2 | Grid | How much each holds | Look at the cards | Each shows how many parameters it holds; one holding nothing shows a dash and is dimmed |
| SC3 | Grid | Counts match the device | Compare a scene's count with the same scene on the device | The same parameters are counted - every track, every page, plus the track's XLV |
| SC4 | Grid | Crossfader ends marked | Look for the A and B markers | They sit on the two scenes the crossfader morphs between, matching the fader below |
| SC5 | Grid | Both ends on one scene | Open a Part whose A and B are the same scene | Both markers are on it, and the fader says moving it changes nothing |
| SC6 | Select | Choosing a scene | Click a scene card | Its contents are listed below, and the card is marked as the chosen one |
| SC7 | Select | No reload on select | Click through several scenes | They switch at once - the bank is read once for the whole Part, not once per scene |

## What a scene holds

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| SC8 | Detail | Grouped by track | Choose a scene that locks several tracks | One block per track, each with its track badge and the machine it runs |
| SC9 | Detail | Only the tracks it touches | Choose a scene that locks one track | Only that track is shown, not eight headings with nothing under them |
| SC10 | Detail | Page named per lock | Look at the listed parameters | Each says which page it belongs to - SRC, AMP, LFO, the effect's own short name, or XLV |
| SC11 | Detail | SRC named after the machine | Compare a scene lock on a Flex track with one on a Pickup track | The first position reads PTCH on both, the second STRT on the Flex track and DIR on the Pickup one |
| SC12 | Detail | FX named after the effect | Load a filter in FX1, lock one of its parameters in a scene, then load a reverb | The lock is named after whichever effect is loaded - the same position reads differently |
| SC13 | Detail | Values read as the device shows them | Lock a centred parameter such as AMP VOL | It reads either side of zero, as the Parts pages show it, with the raw byte in the tooltip |
| SC14 | Detail | XVOL has a home here | Lock the AMP page's sixth position in a scene on the device | It is listed as XVOL. This is the only place it appears - the device shows it only while a scene key is held, so the Parts editor offers no knob for it |
| SC15 | Detail | The track's crossfader level | Lock a track's XLV in a scene | It is listed as XLV, separately from the parameter pages it does not belong to |
| SC16 | Detail | An empty scene says so | Choose a scene holding nothing | It says nothing is held and explains that the crossfader leaves everything as the Part sets it |
| SC17 | Detail | Untouched parameters are absent | Compare a scene's list against the device | Only the parameters the scene actually holds are listed - a parameter it leaves alone is not shown at any value |

## Scenes belong to a Part

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| SC18 | Part | Switching Part | Switch between the four Part tabs | The scenes change with the Part - each Part has its own sixteen |
| SC19 | Part | The Part follows the Parts tab | Pick a Part on the Parts tab, then open Scenes | The same Part is selected, and the other way round |
| SC20 | Part | Switching bank | Change bank | The scenes are those of the new bank's Part |
| SC21 | Part | Reading the working copy | Edit a scene on the device without saving the Part, then open the project | The edited values are shown - the tab reads the same working copy the Parts editor does, not the device's Reload Part backup |

## Changing what a scene holds

Editing is gated on Edit mode, as everywhere else. Writes go to the working copy of the
bank, the same one the Parts editor uses; the device's own Reload Part backup is never
touched.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| SC22 | Edit | Read-only in View mode | Look at a scene in View mode | The values cannot be typed into, and there are no Copy, Paste or Clear buttons |
| SC23 | Edit | Change a value | In Edit mode, type a new value into a parameter the scene holds | It is saved against that scene, that Part and that track, and the device plays the new value when the crossfader reaches that scene |
| SC24 | Edit | Values are typed as they read | Change a centred parameter such as AMP VOL to -20 | It is stored as the device would store it, not as the number typed |
| SC25 | Edit | Step with the wheel | Hover a value and turn the wheel | It steps one setting at a time, the same as on the Parts pages |
| SC26 | Edit | Take a parameter out | Click the x beside a parameter the scene holds | It leaves the scene, the count drops by one, and the device goes back to using the Part's own value there |
| SC27 | Edit | Put a parameter in | Turn on "Show all params", then click the dash beside a parameter the scene does not hold | It joins the scene at its default, and the count rises by one |
| SC28 | Edit | Show all params | Turn "Show all params" on and off | On, every parameter the track's machine and effects actually use is listed; off, only the ones the scene holds |
| SC29 | Edit | Positions the machine does not use | With "Show all params" on, look at a Thru or Neighbor track | Only the parameters that machine actually has are offered - a scene can store a byte elsewhere but the device has nothing to apply it to |
| SC30 | Edit | Copy and paste a scene | Copy one scene, select another, press Paste | The second holds exactly what the first did, and the first is unchanged |
| SC31 | Edit | Paste needs a copy first | Before copying anything, look at Paste | It is disabled until a scene has been copied |
| SC32 | Edit | Paste across Parts | Copy a scene, switch Part, then paste | The scene is written to the Part now being shown |
| SC33 | Edit | Empty a scene | Press Clear on a scene that holds something | It holds nothing afterwards, and Clear is then disabled |
| SC34 | Edit | Nothing else is disturbed | Change one scene, then check the other fifteen and the other Parts on the device | Only the scene that was edited changed |
| SC35 | Edit | The device agrees | Make an edit, save, then open the project on the device | The scene holds what the app showed, and the crossfader morphs to it |
| SC36 | Edit | Reload Part still works | Edit a scene in the app, then use Reload Part on the device | The device restores its own backup - the app never wrote to it |

## The crossfader

Which two scenes the fader sits between belongs to the Part, not to either scene, so it
is shown and set on its own and never touches what a scene holds.

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| SC37 | Fader | Both ends shown | Look at the fader below the scene list | Scene A at the left end, scene B at the right, with the travel drawn between them |
| SC38 | Fader | An end with nothing to reach | Point an end at a scene that holds nothing | That entry is marked as empty - the fader has nothing to morph towards there |
| SC39 | Fader | Read-only in View mode | Look at the fader in View mode | Neither end can be changed |
| SC40 | Fader | Move an end | In Edit mode, pick another scene for the A end | It is saved against the Part, and nothing a scene holds changes |
| SC41 | Fader | Step with the wheel | Hover an end and turn the wheel | It moves through the scenes one at a time |
| SC42 | Fader | Both ends on one scene | Set both ends to the same scene | A floating note says moving the fader then changes nothing |
| SC43 | Fader | Per Part | Set the ends on one Part, then switch Part | Each Part has its own pair of ends |
| SC44 | Fader | The device agrees | Set the ends, save, then open the project on the device | The crossfader morphs between the scenes that were picked |
| SC45 | Mute | Both ends live | Open Scenes on a project where neither end is muted | The A and B letters are both lit orange |
| SC46 | Mute | Reads the project | Mute scene slot B on the device, save, reopen the project | The B end fades back and its letter is outlined in red; the A end is unchanged |
| SC47 | Mute | Read-only outside Edit mode | Leave Edit mode off and click an end letter | Nothing changes; the letter is not clickable |
| SC48 | Mute | Mute an end | In Edit mode, click the A letter | It turns red and outlined, and the scene beside it fades back |
| SC49 | Mute | Unmute again | Click a red outlined letter | The end comes back to full strength |
| SC50 | Mute | One end at a time | Mute A | B is left alone |
| SC51 | Mute | Belongs to the project | Mute an end, then switch Part | The mute is the same on every Part of the project |
| SC52 | Mute | Nothing else is rewritten | Mute an end, then check the project's sample slots and settings | Every other value in the project file is as it was |
| SC53 | Mute | The device agrees | Mute an end, save, then open the project on the device | That scene slot is muted, as if FUNC + SCENE had been pressed |
| SC54 | Mute | What a mute does | Mute the end a scene full of locks sits on | On the device, that end leaves everything as the Part sets it |
| SC55 | Actions | Show all params stays put | Note where "Show all params" sits, then turn Edit mode on | Copy, Paste and Clear appear to its left and it does not move |
| SC56 | Actions | Show all params reads as on | Turn "Show all params" on | It is highlighted, and every parameter is listed |
| SC57 | Actions | Copy A to B | In Edit mode, with the ends on different scenes, press "Copy A to B" | The B end's scene holds what the A end's scene held, and is the one on show |
| SC58 | Actions | Copy B to A | Press "Copy B to A" | The A end's scene holds what the B end's scene held |
| SC59 | Actions | Copy between the same scene | Set both ends to one scene | Both copy buttons are refused |
| SC60 | Actions | Randomize keeps the shape | Press "Randomize" on a scene holding three parameters | It still holds those three, with new values |
| SC61 | Actions | Randomize stays legal | Randomize a scene holding a parameter with gaps in its range, several times | Every value is one the device's own encoder would produce |
| SC62 | Actions | Randomize on an empty scene | Select a scene holding nothing | "Randomize" is refused |
| SC63 | Actions | Randomize the device agrees | Randomize, save, then open the project on the device | The scene reads back the values the app showed |
| SC64 | Saving | The header matches Parts | Open Scenes | The same bank header as Parts: name, Reload/Save/Save All, and the four Part tabs |
| SC65 | Saving | Nothing to save at first | Open Scenes in Edit mode without changing anything | Save and Save All are refused |
| SC66 | Saving | A scene edit marks the Part | Change any scene value | The Part's tab gains its asterisk and Save becomes available |
| SC67 | Saving | Save commits the Part | Press Save | The Part's saved copy is replaced and the asterisk clears |
| SC68 | Saving | Reload discards scene edits | Change a scene, then press Reload | Every scene in the Part goes back to the saved copy |
| SC69 | Saving | Reload needs a saved copy | Open a Part never saved, change a scene | Reload is refused with "No saved state yet" |
| SC70 | Saving | The device agrees | Change a scene, save, open the project on the device | The Part shows no asterisk, and Reload Part restores what was saved |
| SC71 | Saving | A mute is not a Part edit | Mute an end | Save stays refused: the mute is project state, not Part data |
| SC72 | Saving | Writes wait | Turn a scene value quickly with the wheel | The bank is written once the turning stops, not once per notch |
| SC73 | Saving | A change of mind is one write | Mute and unmute an end quickly | One write, of where it ended up |
| SC74 | Track copy | Offered only in Edit mode | Look at a track's heading outside Edit mode | No copy or paste buttons |
| SC75 | Track copy | Nothing to paste at first | Enter Edit mode without copying | Paste is refused on every track |
| SC76 | Track copy | Copy one track | Press copy on a track, pick another scene, press paste on the same track | That scene holds what the first one held for that track |
| SC77 | Track copy | The other tracks are untouched | After the paste above, check the other seven tracks | They hold what they held before |
| SC78 | Track copy | Same track only | Copy track 1, then look at track 2's paste | It is refused: the same byte means a different parameter on another machine |
| SC79 | Track copy | Not back into its own scene | Copy a track and stay on that scene | Paste is refused, saying it is already this scene |
| SC80 | Track copy | Separate from the whole-scene clipboard | Copy a scene, then copy a track | The scene is still there to paste |
| SC81 | Track copy | The device agrees | Copy a track between scenes, save, open the project on the device | That scene holds the copied track's locks |
| SC82 | Loading | All Banks is offered | Open Scenes once the project has loaded | "All Banks" is selectable, not stuck on "(loading...)" |
| SC83 | Loading | All Banks shows every bank | Pick All Banks on Scenes | One Scenes panel per loaded bank |
| SC84 | Loading | Read ahead | Open a project, wait for the banks, then open Scenes | The scenes are already there, with no per-bank wait |
| SC85 | Track copy | Green marks the destination | Copy a track, then pick another scene | That track's paste button is green; the other tracks' are not |
| SC86 | Track copy | The count does not move | Note where a track's parameter count sits, then toggle Edit mode | The buttons appear to its left and the count stays put |
