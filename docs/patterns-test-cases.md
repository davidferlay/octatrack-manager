# Patterns Tab - Manual QA Test Cases

## Test Cases

| # | Operation | Test | Steps | Pass Criteria |
|---|-----------|------|-------|---------------|
| **Trig Indicators** | | | | |
| PT1 | Indicators | Trigger glyph | Place a normal sample trig on the device, save, open the pattern | Step shows a solid orange circle |
| PT2 | Indicators | One-shot glyph | Place a one-shot trig (no normal trigger on the same step) | Step shows a solid yellow circle, no orange circle, no "1" text |
| PT3 | Indicators | Trigless glyph | Place a trigless trig | Step shows a solid green circle |
| PT4 | Indicators | Trigless lock glyph | Place a trigless lock (lock trig) | Step shows an outlined green circle (previously displayed nothing) |
| PT5 | Indicators | Rec trig glyph and color | Place a recorder trig | Step shows a red R |
| PT6 | Indicators | One-shot rec trig differentiated | Place a one-shot recorder trig | Step shows a yellow R (not red), legend lists "One-Shot Rec" |
| PT7 | Indicators | SRC3-only rec trig shown | Place a rec trig armed for SRC3 only (INAB/INCD off) | Step still shows the R indicator |
| PT8 | Indicators | Slide glyph | Place a slide trig | Step shows a cyan "/" character |
| PT9 | Indicators | Swing shown when amount above 50 | Set track swing amount above 50, place swing trigs | Swing steps show a green wave icon |
| PT10 | Indicators | Swing hidden at default amount | Leave track swing amount at 50, with swing trigs placed | No swing icons are displayed (50 has no audible effect) |
| PT11 | Indicators | Sample lock shows S without P | P-lock only a sample slot on a step (no other locks) | Step shows S but no P |
| PT12 | Indicators | P counts parameter locks | P-lock two or more machine/LFO/amp parameters on one step | Step shows "2P" (or the matching count) |
| PT13 | Indicators | Steps 17-64 match the device | Program distinct trigs on pages 2, 3 and 4, save, compare | Every trig appears on the exact same step as on the device (no half-page swaps) |
| **Step Details** | | | | |
| PT14 | Step Details | Trigless lock named | Click a trigless lock step | Details panel shows "Trig Type: Trigless Lock" |
| PT15 | Step Details | One-shot rec named | Click a one-shot rec trig step | Details panel shows "Recorder Trig: Yes (One-Shot)" |
| PT16 | Step Details | Slice number in slice mode | Track machine has SLIC on and plays a sliced sample; click a step with a STRT lock | Details show "STRT (Slice): N" where N is the slice number shown on the device |
| PT17 | Step Details | Raw start without slice mode | Same STRT lock but SLIC off or sample without slices | Details show "STRT (Start): raw value" |
| **Indicator Filters** | | | | |
| PT18 | Filters | Global chip hides everywhere | Click an indicator chip in the "Show:" row | That indicator disappears from every pattern grid; chip appears dimmed |
| PT19 | Filters | Global chip restores | Click the dimmed chip again | Indicator reappears in all patterns |
| PT20 | Filters | All / None | Click "None", then "All" | None hides every indicator in all patterns; All restores them |
| PT21 | Filters | Global filter persists | Hide some indicators, close and reopen the app | The same indicators are still hidden |
| PT22 | Filters | Legend badge is per pattern | With All Patterns displayed, click an indicator badge in one pattern's legend | Indicator disappears only in that pattern; other patterns keep it; badge appears dimmed |
| PT23 | Filters | Legend badge restores | Click the dimmed legend badge again | Indicator reappears in that pattern |
| PT24 | Filters | Globally hidden leaves legends | Hide an indicator via the global chip | It is removed from every pattern legend (no dead per-pattern toggle) |
| **Keyboard Navigation** | | | | |
| PT25 | Keyboard | Left/Right move selection | Click a step, press Right then Left | Details panel follows: next step, then back |
| PT26 | Keyboard | Tab / Shift+Tab move selection | With a step selected, press Tab then Shift+Tab | Same movement as Right / Left |
| PT27 | Keyboard | Up/Down jump a page row | On a 64-step pattern, select step 1, press Down then Up | Selection moves to step 17, then back to step 1 |
| PT28 | Keyboard | Edges clamp vertically | On a 16-step pattern, press Down | Selection does not move |
| PT29 | Keyboard | Escape closes details | With a step selected, press Escape | Details panel closes |
| PT30 | Keyboard | Right past last step jumps pattern | Single-pattern view, select the last step, press Right | Next pattern is selected with step 1 active |
| PT31 | Keyboard | Left before step 1 jumps back | Single-pattern view, select step 1, press Left | Previous pattern is selected with its last step active |
| PT32 | Keyboard | No hijack while typing | Focus a selector or input, press arrow keys | Normal control behavior; step selection does not move |
