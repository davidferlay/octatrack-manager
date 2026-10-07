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
| SC27 | Edit | Put a parameter in | Turn on "Show everything", then click the dash beside a parameter the scene does not hold | It joins the scene at its default, and the count rises by one |
| SC28 | Edit | Show everything | Turn "Show everything" on and off | On, every parameter the track's machine and effects actually use is listed; off, only the ones the scene holds |
| SC29 | Edit | Positions the machine does not use | With "Show everything" on, look at a Thru or Neighbor track | Only the parameters that machine actually has are offered - a scene can store a byte elsewhere but the device has nothing to apply it to |
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
| SC42 | Fader | Both ends on one scene | Set both ends to the same scene | It says so - moving the fader on the device then changes nothing |
| SC43 | Fader | Per Part | Set the ends on one Part, then switch Part | Each Part has its own pair of ends |
| SC44 | Fader | The device agrees | Set the ends, save, then open the project on the device | The crossfader morphs between the scenes that were picked |
