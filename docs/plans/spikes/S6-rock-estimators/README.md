# S6: which estimator of bare rock should H-sim use?

Spike S6 of milestone M0 in `docs/plans/air-slice-wind-detail-honest-speed.md` (9d.4, 9d.5, decisions D17 to D23). It changes nothing in the app.

## Question

H-sim changes what a "wall" is in the fire model: today any fire cell steeper than 45 degrees (30 m mean), or with enough steep 10 m sub-cells, is an impassable wall whether the ground is bare rock or steep forest. H-sim wants a per-cell `rockFraction`, so that part-rock cells slow the fire, mostly-rock cells stop creeping fire, and narrow vegetated gullies through a rock band stay open. The plan needs an estimator of bare rock and names three: slope only, slope x (1 - canopy cover), and slope with a greenness index from the bundled aerial photo. D17 holds H-sim out of 0.3.0 if S6 misses its criteria. The plan does not state the criteria, so they are set below.

## Criteria (written first)

Everything in this section was written, and the constants of the harness it quotes were fixed, before any tile of the four study sites was looked at or scored. `tests/spikes/rockEstimators.spike.test.ts` holds the same numbers as `CONFIG` and `CRITERIA`; the hash of the two is `e5c07fa5a8477507` and `results.md` prints it again, so a later change shows as a different hash.

What was done before this section was fixed, in order:

1. The harness was run on the four sites into a scratch folder to get the E3 thresholds and to check that 20 patches could be chosen at each site. Those sheets were not opened.
2. A pilot on a fifth bundled site that is not in the study (budawangs, Pigeon House Mountain) was used to debug the sheets. It showed that steep faces are often in deep shadow in these photos. That is why the label rules below have a shadow rule and why a labelling aid with the shadows lifted exists.
3. After the pilot, the G1 and G2 populations were limited to tiles with a patch-mean steepFraction of 0.3 or more. The reason comes from the sampling design: below that no estimator can call a wall, so such tiles only dilute the rates. It was not decided from any label, because none existed.

### Estimators

All are per fire cell (30 m, the default `SCENARIO_PARAMS.fireCellM`). `steepFraction` is the share of the nine 10 m sub-cells in the cell at 55 degrees or more (the plan's `rockSlopeDeg`, an [H] guess), from `slopeDegOf`, the app's own function.

| id | rock value | note |
|---|---|---|
| E0 | the app's `features.cliff` mask (Landform.Cliff, or cliffFraction >= 0.3, or P90 slope >= 60 degrees) | today; for comparison only; it has no partial or chute class |
| F | `cliffFraction` (the 60 degree share) with the new classes | the plan's no-canopy fallback |
| E1 | steepFraction | slope only |
| E2 | steepFraction x (1 - canopy cover) | cover is the fire-grid cover the build makes from the bundled canopy (`loadCanopyLayer`) |
| E3 | steepFraction x (1 - photo vegetation share of the cell) | greenness index below |
| E23 | steepFraction x (1 - max(canopy cover, photo vegetation share)) | the combination: a cell is bare only if neither source says vegetation |
| E2c, E3c, E23c | the same three, but "steep AND bare" is taken per 10 m sub-cell and then averaged | secondary: avoids the product-of-means error where a cliff meets a forested plateau |
| E3T80, E3T120, E3D80, E3D120 | E3 with the threshold changed | the sensitivity runs below |

Classes (plan 9d.4 item 2), using the app's own `computeTerrainFeatures` output for drainage and trench on the same fire grid:

- chute: drainage cell, trench score >= 0.3 and rock >= 0.2 (the fire is allowed through);
- wall: rock >= 0.5 and not a chute;
- partial: 0.1 <= rock < 0.5;
- none: the rest.

### E3 index and threshold (fixed before any label)

- Index: ExG = 2g - r - b on chromatic coordinates (r, g, b divided by their sum), per photo pixel. A pixel is vegetation when ExG > T. The vegetation share of a cell is the exact area share of vegetation pixels inside its 30 m footprint.
- Threshold T: the 5th percentile of the ExG of the reference forest of the same photo. Reference forest = fire cells with a 30 m slope of 25 to 45 degrees, canopy cover >= 0.8 and no 10 m sub-cell at 55 degrees or more, so it is lit like the ground being judged. Why 5 %: about 5 % of true forest pixels will then look bare, and a fully steep forest cell then reaches a rock value of about 0.05 by pixel noise alone, under the 0.1 partial class.
- The four photos have different colour balance (median ExG of the reference forest 0.036 to 0.114), so T is set per site. Values fixed before labelling:

| site | reference cells | reference pixels | median ExG | T | deficit (median - T) |
|---|---|---|---|---|---|
| katoomba | 9356 | 131775 | 0.0485 | 0.0000 | 0.0485 |
| kanangra | 31358 | 440566 | 0.1139 | 0.0648 | 0.0490 |
| grose | 15380 | 216006 | 0.0452 | 0.0079 | 0.0373 |
| tomah | 21155 | 297842 | 0.0359 | -0.0143 | 0.0502 |

- Sensitivity: T x 0.8 and T x 1.2 as asked, and, because T is near zero at some sites so that +/-20 % of it moves nothing, also the deficit x 0.8 and x 1.2 (E3D80 and E3D120).

### Sample

- Seed 6006 for every random draw. 20 patches of 3 x 3 fire cells (90 m) per site, chosen from the numbers only, never after looking at the photo, with centres at least 9 cells (270 m) apart and at least 5 cells from the edge.
- 8 high: patch-mean steepFraction >= 0.5. 6 mid: 0.1 to 0.5. 4 disagree: steep patches (mean steepFraction >= 0.1) where E1, E2 and E3 disagree most (two ranked by the range of the three patch means, two by |E2 - E3|). 2 control: gentle forest (steepFraction < 0.02, slope < 15 degrees, canopy cover >= 0.6).
- Tile ids are in a seeded random order, so an id carries no stratum.
- A tile shows the aerial crop (270 m square, bicubic from the 8 m photo), the patch box (yellow), and the 10 m slope shading beside it. The blind sheets carry no estimator numbers; the other sheets do.

### Label rules (one rater, an AI, looking at 8 m photos; not an expert survey)

Labels: `rock`, `mixed`, `veg`, `chute`, `unsure`, each with a few words of evidence and a confidence (high or low). They are written from the photo crop (as is, and with the shadows lifted) before the estimator numbers or the slope panel are looked at.

- rock: bare cliff face or pavement is the main thing inside the yellow box: pale grey, cream or orange rock, or a smooth dark face with no tree texture whose sunlit part (pale rock, ledges, a bright rim) shows in the same crop.
- mixed: rock (as above) and vegetation (tree, shrub or grass texture, green or olive) each clearly cover at least about a fifth of the box.
- veg: tree, shrub or grass texture covers the box, whatever the ground is doing; shadow in which tree texture or crowns can be seen counts as vegetation.
- chute: a vegetated strip (green or textured, at least about one photo pixel wide) cuts across a rock band inside the box.
- unsure: the box is mostly deep shadow with no sunlit part of the same feature in the crop, or haze, or nothing can be told apart at 8 m pixels. A dark smooth patch alone is never "rock".

### Tile rules

A tile is a **wall tile** when at least 5 of its 9 cells are wall, a **partial tile** when it is not a wall tile and wall + partial cells number at least 3, and has a **chute** when at least 1 cell is a chute. A tile is **steep** when its patch-mean steepFraction is 0.3 or more.

### Pass criteria

The gates are judged on the four sites pooled (per-site numbers are reported, not gated). "Unsure" tiles are left out of every rate and counted separately.

- **G1, false walls.** Of the tiles I label `veg` that are steep, at most 10 % are wall tiles and at most 10 % of their cells are wall cells. Needs at least 8 such tiles. Why: a wall stops the fire completely, so a wall on steep forest is the costly error H-sim exists to remove, and 10 % is the most I would accept before "steep forest mostly burns" stops being a fair description.
- **G2, wall recall.** Of the tiles I label `rock` that are steep, at least 75 % are wall tiles. Needs at least 8 such tiles. Why: H-sim must still keep real rock bands as barriers; E0 keeps nearly all of them, so a quarter lost (they become partial and only slow the fire) is the most I would trade for fixing G1.
- **G3, chutes.** (a) At most 25 % of those rock tiles hold a chute cell, because a chute cell opens a hole in a wall and chutes are rare, narrow features. (b) At least 50 % of the tiles I label `chute` hold a chute cell, judged only when at least 3 tiles are labelled `chute`; otherwise "not testable", because 8 m pixels hide most chutes and the Katoomba chute test of 9d.6 then stays the only check of the chute rule.
- **Verdict rule.** An estimator passes when G1, G2 and G3(a) pass and G3(b) passes or is not testable. S6 passes when at least one of E1, E2, E3, E23, E2c, E3c, E23c passes (E0 and F are today's rule and the fallback, not candidates). Seven candidates are tried on 80 tiles, so a pass by luck is possible; the verdict says how many passed. A gate that cannot be judged for lack of labelled tiles is "inconclusive": S6 then does not pass, and I say so as "inconclusive", not as "the estimator failed".
- **Reported, not gated:** partial agreement on `mixed` tiles; wall precision; the AUC of each estimator for rock against steep forest; the share of E0's cliff cells that my labels call `veg` (the bug H-sim is meant to fix); the plan's own acceptance numbers (wall share at Katoomba 1.5 to 3.5 %, no wall cell with canopy cover above 0.6, at least 90 % of steep drainage cells passable), because the plan marks them as prototype numbers to be re-checked here; the wall, partial and chute shares of each whole fire grid; the registration of the photo against the terrain.

## Method, findings, verdict, recommendation, limits, reproduction, files

Written after scoring; see below.
