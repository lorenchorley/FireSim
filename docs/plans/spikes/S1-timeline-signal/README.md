# Spike S1: where the speed signal sits on the timeline

Plan: `docs/plans/air-slice-wind-detail-honest-speed.md`, section 6.4 and decision D3. Done 2026-10-13 against HEAD `ca8e637`.

## Question

Workstream B shows a small signal when the simulation falls behind the playback speed. The plan has three candidate places for it and says "T1 unless the spike says otherwise": prototype all three, run the tap-target and layout audits, look at 412x915 and 844x390 in the four looks, and pick on these criteria: target at least 44 px, strip height unchanged, slider taps not stolen, audits green, glyph at most 20 px, meaning not carried by colour alone, discoverable.

## Verdict

**T1 is confirmed, with two corrections to the plan** (below). T2 is a workable fallback. T3 is rejected.

| Criterion | T1: button in the strip's 4th column | T2: "Behind" badge in the clock | T3: ring on the thumb, tap the thumb |
|---|---|---|---|
| Target at least 44 px | Yes: its own 44 x 44 button | The whole clock button (222 x 44 at 412 wide, 206 x 44 at 844 wide); the badge itself is 76 x 16 and is not a separate target | No separate target: the thumb is 20 px, and a 44 px zone is taken from the slider |
| Strip height unchanged | Yes, 64 px | Yes, 64 px | Yes, 64 px |
| Slider taps not stolen | Yes | Yes | **No**: a tap within 22 px of the thumb opens the sheet instead of seeking. At 412 wide that is up to 28 minutes of a 6 h run (11 minutes at 844 wide). A test tap 18 px from the thumb, which a plain seek would have turned into a 23 minute jump, opened the sheet |
| Tap-target audit | Green (behind and waiting, both sizes) | Green | Green |
| Layout budget | Unchanged from today at all 5 sizes | Unchanged | Unchanged |
| Glyph at most 20 px | Gauge glyph, 20 px | Gauge glyph, 14 px, plus the word "Behind" | None |
| Meaning not by colour alone | Glyph, ring thickness (1 px outline when behind, 3 px ring when waiting) and the accessible name | The word and the glyph | Ring thickness only: no word, no glyph |
| Discoverable | An icon at the end of the timeline; no word | A word, but in the top pill, away from the timeline | No |
| Screen reader | A native button in the tab order with `aria-expanded` | Reuses the existing `aria-live="polite"` state slot ("Computing", "Replay") | Needs a hidden focusable button (not prototyped) |
| Cost of the prototype | One button, about 30 lines of CSS, one icon | One badge, a section in the time sheet | About 40 lines of pointer logic to tell a tap from a drag |

Why not T2 as the default: the explanation opens in the time sheet, which has other jobs. At 844 x 390 the stub section already ends at y = 492 on a 390 px screen, so it is below the fold, and the real section (about twenty lines and two actions in the plan's sheet) will always need scrolling there. At 412 x 915 the stub fits (y 759 to 895 in a sheet from 283 to 915).

## Two corrections to the plan

1. **The amber line "between thumb and head" cannot be seen.** While `waiting` the clock is held at the newest result, so thumb and head are at the same place and the stretch between them has no length. The prototype draws a fixed 44 px run under the rail that ends at the thumb. It is decoration (`aria-hidden`); the button and its name carry the meaning. It crosses the hour ticks slightly, which looks fine.
2. **The amber ring is too faint in the two light looks.** Measured against the strip surface:

   | Look | Ring `--watch` | Glyph `--watch-ink` | Outline `--outline` |
   |---|---|---|---|
   | Light | 1.93 : 1 | 5.31 : 1 | 3.68 : 1 |
   | Dark | 9.28 : 1 | 9.28 : 1 | 4.65 : 1 |
   | High contrast light | 1.93 : 1 | 7.91 : 1 | 15.82 : 1 |
   | High contrast dark | 14.38 : 1 | 14.38 : 1 | 15.43 : 1 |

   A graphic needs 3 : 1 (4.5 : 1 in high contrast, `scripts/check-contrast.mjs`). The glyph passes everywhere, so the signal is readable, but the ring and the line alone would fail in both light looks. Draw the ring and the line in `--watch-ink` in the light looks (or add a 1 px `--watch-ink` edge) and add the pairs to the contrast checker's curated list; the automatic pairing does not see `box-shadow` rings.

## Things the plan did not say, found while building

- **The track shrinks by 44 px** (284 to 240 px at 412 wide, 716 to 672 at 844, 262 to 218 at 390, 232 to 188 at 360). The tick labels do **not** thin at 360 px or wider: all four stay. They thin from four to three only at 320 px wide.
- **Construction order.** `createPopoverGroup` takes its entries once, when the top bar is made, and the strip is made after the top bar. The prototype makes the strip first and hands its button to the top bar, which registers a fourth popover `pace` beside menu, time and speed; the strip's click calls `popovers.toggle('pace')`. Escape, outside tap and Back then work as for the other sheets (checked: Escape closes and focus returns to the button). The lane can instead give the group an `add()` method.
- **Seeking.** The button shares column 4 with Cancel, so the signal is hidden while a jump computes (`seekTarget !== null`).
- **A tap that opens the sheet leaves the clock where it is** (checked for T1 and T3).

## Method

- The patch `prototype.patch` (against `ca8e637`) adds all three candidates behind `?pace=t1|t2|t3` and forces a level with `?paceLevel=behind|waiting` (or by writing `session.state.pace` through `window.__firesim`). It uses the contract type `SessionState.pace` from the M0 contracts commit. The sheet is a two-sentence stub: the content is workstream B's.
- Mock engine and 2-D map, the same set-up as the repo's own audits (`?mock=1`). The clock is parked at 40 % of the 6 h run (14:24) with the newest result at the same time, which is the `waiting` condition.
- 412 x 915 and 844 x 390, four looks (light, dark, high contrast light, high contrast dark), each with no signal, then each candidate behind and waiting: 56 renders, device scale 2 for the crops (`shots/`), `metrics.json` has the measured boxes.
- `interact.json`: 26 touch checks (real touch events through Chromium): a tap on the track still seeks; the T1 button is 44 x 44, opens the sheet and leaves the clock alone, Escape closes it and focus returns, an outside tap closes it; the T2 badge sits in the clock button and a tap opens the time sheet with the new section; T3 taps and drags near the thumb. All 26 pass; the T3 line "taps stolen" is recorded as a finding, not a defect of the test.
- `audits.log`: `scripts/audit-tap-targets.mjs` for every candidate, level and size, and `scripts/layout-budget.mjs` for each candidate: all green, and the layout budget is identical to today (band 73.9, 76.0, 70.3, 65.6 and 77.4 % at 390x844, 412x915, 360x740, 360x640 and 844x390, against budgets of 72, 74, 68, 63 and 72 %), because the strip height does not change and the button sits inside the strip.

## Recommendation for the 0.3.0 lane

Build T1 as in plan 6.4 with: the ring and line in `--watch-ink` in the light looks; the line as a fixed run ending at the thumb; the button hidden while seeking; the sheet registered as a popover of the top bar's group; contrast pairs added for the ring. Keep T2 as the fallback if the shorter track is unwelcome. Decision D3 stays "T1".

## Limits

- Not seen on a phone, not tried with TalkBack, with a large font scale, forced colours or a right-to-left language.
- The real pace tracker does not exist yet: levels are forced, so nothing here says how often the signal will appear or how it behaves at the edges of its hysteresis.
- One reviewer looked at the 56 crops. The contact sheets in `shots/` show four looks in portrait and two in landscape; the others are reproducible.
- Software rendering (SwiftShader) behind the map; the strip itself is plain DOM, so its layout does not depend on it.

## How to reproduce

From a checkout at `ca8e637` with `node_modules` installed:

```
git apply docs/plans/spikes/S1-timeline-signal/prototype.patch
npx vite --port 4301 --strictPort &
BASE=http://localhost:4301 OUT=./s1-out/shots node docs/plans/spikes/S1-timeline-signal/tools/drive.mjs
BASE=http://localhost:4301 OUT=./s1-out node docs/plans/spikes/S1-timeline-signal/tools/interact.mjs
BASE=http://localhost:4301 bash docs/plans/spikes/S1-timeline-signal/tools/audits.sh
BASE=http://localhost:4301 node docs/plans/spikes/S1-timeline-signal/tools/narrow.mjs
BASE=http://localhost:4301 node docs/plans/spikes/S1-timeline-signal/tools/contrast.mjs
python3 -I docs/plans/spikes/S1-timeline-signal/tools/sheets.py ./s1-out/shots ./s1-out/sheets
```

## Files

`prototype.patch` (throwaway, not reviewed code), `metrics.json`, `interact.json`, `audits.log`, `shots/` (six contact sheets), `tools/` (the scripts above).
