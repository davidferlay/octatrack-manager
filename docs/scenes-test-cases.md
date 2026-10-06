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
| SC4 | Grid | Crossfader ends marked | Look for the A and B markers | They sit on the two scenes the crossfader morphs between, and the line underneath names them |
| SC5 | Grid | Both ends on one scene | Open a Part whose A and B are the same scene | Both markers are on it, and the line says moving the crossfader changes nothing |
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
