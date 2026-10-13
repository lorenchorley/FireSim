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

## Method

One vitest file, `tests/spikes/rockEstimators.spike.test.ts`, skipped unless `FIRESIM_SPIKE` is set. For each of katoomba, kanangra, grose and tomah it:

1. reads the bundled 10 m terrain, builds the 30 m fire terrain, the terrain features (drainage, trench score, today's cliff mask) and the fire-grid canopy cover with the app's own functions (`loadHiResDem`, `fireTerrainFromHiRes`, `computeTerrainFeatures`, `loadCanopyLayer`), offline from `public/demo/<site>/`;
2. decodes the aerial photo (1125 x 1125 pixels, 8 m, JPEG, 4:2:0 so the colour is at 16 m) with the JPEG decoder inside `geotiff` and computes ExG per pixel;
3. computes E0, F, E1, E2, E3, E23, the three sub-cell variants and the four E3 sensitivity runs for every fire cell;
4. chooses 20 patches from the numbers with seed 6006;
5. draws the contact sheets (bicubic crops of the photo; a small baseline JPEG encoder and a 5 x 7 font written in the file);
6. when `labels.json` exists, scores every estimator against it and writes `results.md`.

Checks built in: the block averaging reproduces the app's own `cliffFraction` exactly (largest difference 0.0 at all four sites); today's wall share from the app's own features matches the plan's figures (3.27, 4.31, 4.76 and 2.78 % against the plan's 3.3, 4.3, 4.8 and 2.8 %); E2, E3, E23 and F never exceed E1; the encoder is checked by decoding its own output (31 to 34 dB against the source) and PIL also opens every sheet; two runs give byte-identical sheets and an identical `results.md`.

**How the labels were made.** I (an AI) looked at each tile in a labelling aid made by the same harness: the photo crop as is, with the shadows lifted (gamma 0.55), as raw 8 m pixels, and in a wider 810 m crop for context. The slope panel and the estimator numbers were not looked at until `labels.json` was saved. Each label has a few words of evidence and a confidence (high 32, low 48 of 80). The aid is not in the folder; the blind sheets carry the same crops plus the slope panel. Aerial photo crops in all sheets: © Spatial Services NSW (CC BY 4.0). Terrain: © Spatial Services NSW (CC BY 4.0). Canopy: Meta and WRI, Tolan et al. 2024 (CC BY 4.0).

This is one rater looking at 8 m aerial photos. It is not an expert survey.

Disclosure about the labelling aid. It first held two views (as is, shadows lifted). I made tentative impressions of the 20 Katoomba tiles from those alone, then added the raw-pixel view and the wider 810 m crop, because the 270 m crop could not separate heath, the edge of a town and a cliff edge. All labels were written after that, using the wider crop, and several first impressions changed: brown smooth ground I first could not place (KT01, KT03, KT09, KT15, KT18, KT20) became veg once the wide crop showed heath, and two tiles I first took for rock or chute (KT10, KT17) became unsure.

## Findings

All numbers are at 30 m fire cells. Every table is in `results.md` with counts; the ones used here are repeated with counts.

### 1. Whole fire grid: wall, partial and chute shares

Wall share, with the number of wall cells of 90 000 (the plan's S6 line asks for wall, partial and chute shares; partial and chute are in the second table):

| site | E0 today | F cliffFraction | E1 slope only | E2 x (1 - cover) | E3 x (1 - photo green) | E23 |
|---|---|---|---|---|---|---|
| katoomba | 3.27 % (2941) | 1.30 % (1174) | 1.71 % (1537) | 0.55 % (491) | 0.28 % (253) | 0.13 % (117) |
| kanangra | 4.31 % (3876) | 0.81 % (733) | 1.62 % (1458) | 0.59 % (534) | 0.17 % (154) | 0.11 % (98) |
| grose | 4.76 % (4285) | 1.92 % (1729) | 2.52 % (2270) | 0.94 % (847) | 0.43 % (387) | 0.19 % (172) |
| tomah | 2.78 % (2499) | 0.45 % (408) | 1.13 % (1015) | 0.05 % (42) | 0.10 % (92) | 0.00 % (1) |

Partial / chute share (cells), E0 has neither:

| site | F | E1 | E2 | E3 | E23 |
|---|---|---|---|---|---|
| katoomba | 1.33 / 0.06 % (1198 / 56) | 1.55 / 0.09 % (1398 / 80) | 1.01 / 0.03 % (908 / 27) | 0.60 / 0.01 % (544 / 8) | 0.42 / 0.01 % (381 / 6) |
| kanangra | 1.45 / 0.12 % (1308 / 104) | 2.35 / 0.20 % (2114 / 176) | 1.30 / 0.10 % (1170 / 89) | 0.78 / 0.05 % (706 / 45) | 0.51 / 0.04 % (463 / 35) |
| grose | 1.99 / 0.13 % (1787 / 116) | 2.49 / 0.23 % (2243 / 210) | 1.36 / 0.09 % (1227 / 82) | 0.94 / 0.02 % (848 / 17) | 0.53 / 0.01 % (477 / 11) |
| tomah | 1.73 / 0.16 % (1559 / 147) | 2.99 / 0.40 % (2694 / 359) | 0.35 / 0.01 % (312 / 12) | 0.44 / 0.05 % (393 / 44) | 0.03 / 0.00 % (31 / 1) |

E1 at 50 and 60 degrees instead of 55 moves the Katoomba wall share to 2.18 % and 1.30 %, Kanangra to 3.04 % and 0.81 %, Grose to 3.25 % and 1.92 %, Tomah to 2.25 % and 0.45 % (`results.md` section 2). The 55 degree guess is not a small choice. E3 is also sensitive to its threshold: with the greenness deficit x 0.8 and x 1.2 the number of E3 wall cells changes by +39 % and -45 % at Katoomba, +21 % and -16 % at Kanangra, +52 % and -22 % at Grose, +60 % and -28 % at Tomah; T x 0.8 and x 1.2 move it less (between -17 % and +27 %), and not at all at Katoomba where T is zero. The whole-grid shares of all the E3 runs are in `results.md` section 2.

### 2. The plan's own acceptance numbers (9d.6)

- Wall share at Katoomba "about 1.5 to 3.5 %": E1 1.71 % is inside; F 1.30 % is just under; E2 0.55 %, E3 0.28 % and E23 0.13 % are far under. My guess: the range came from a slope-only rule, not from D20's E2.
- "No wall cell with canopy cover above 0.6": E2 and E23 meet it by construction (0 cells). E1 has 853 such wall cells at Katoomba, E3 109, E0 1714.
- "At least 90 % of steep drainage cells passable" (two definitions in `results.md` section 3): E0 fails everywhere (42 to 67 % with slope >= 35 degrees; 24 to 53 % with steepFraction >= 0.2). E1, F, E2, E3 and E23 pass at all four sites (91 to 100 %).

### 3. What each estimator does to today's wall cells (whole grid, no labels)

E2 opens 83 % of today's wall cells at Katoomba (2452 of 2941), 86 % at Kanangra, 80 % at Grose and 98 % at Tomah. Of the cells it opens, 37 % at Katoomba (905 cells) and 37 % at Grose are very steep (at least a quarter of their 10 m sub-cells at 65 degrees or more); 11 % at Kanangra and 14 % at Tomah. E1 opens 48 % at Katoomba and only 9 % of those are very steep. E3 and E23 open 91 to 100 %. (`results.md` section 3b.)

### 4. The hand check

80 tiles, chosen from the numbers, labelled from the photo:

| label | rock | mixed | veg | chute | unsure | tiles |
|---|---|---|---|---|---|---|
| katoomba | 1 | 2 | 13 | 0 | 4 | 20 |
| kanangra | 1 | 0 | 12 | 0 | 7 | 20 |
| grose | 3 | 4 | 11 | 0 | 2 | 20 |
| tomah | 0 | 0 | 19 | 0 | 1 | 20 |
| all | 5 | 6 | 55 | 0 | 14 | 80 |

Of the 55 veg tiles, 35 are steep (patch-mean steepFraction >= 0.3) and 20 are gentle (8 of them the controls). In these photos most steep ribbons look vegetated from above: bare rock is the main thing in the box in only 5 tiles, and no vegetated gully through a rock band could be seen at 8 m, so no tile is labelled chute. 14 tiles (18 %) are deep shadow and unsure; 10 of those 14 face south-east or south, away from the north-west sun that best explains the photo shading, and the 5 rock tiles face south-east, south-west and west (`results.md` section 7). So the check can only confirm sun-facing rock.

### 5. The gates, pooled (counts in brackets, Wilson 95 % interval in `results.md`)

| estimator | G1 steep veg tiles that are wall | G1 their wall cells | G2 rock tiles that are wall | G3a rock tiles with a chute | verdict |
|---|---|---|---|---|---|
| E0 today | 100 % (35/35) | 86 % (271/315) | 100 % (5/5) | 0 % (0/5) | FAIL (G1) |
| F | 31 % (11/35) | 43 % (137/315) | 80 % (4/5) | 20 % (1/5) | FAIL (G1) |
| E1 | 57 % (20/35) | 59 % (187/315) | 80 % (4/5) | 20 % (1/5) | FAIL (G1) |
| E2 | 9 % (3/35) | 17 % (54/315) | 80 % (4/5) | 20 % (1/5) | FAIL (G1, cells) |
| E3 | 0 % (0/35) | 5 % (17/315) | 0 % (0/5) | 0 % (0/5) | INCONCLUSIVE (G2) |
| E23 | 0 % (0/35) | 2 % (6/315) | 0 % (0/5) | 0 % (0/5) | INCONCLUSIVE (G2) |

G2 and G3a need 8 rock tiles and there are 5, so they are formally inconclusive for every estimator, and G3b is not testable because no tile is labelled chute. The sub-cell variants give the same verdicts (E2c fails G1 with 3/35 and 55/315; E3c and E23c are inconclusive). The E3 sensitivity runs (T x 0.8, T x 1.2, deficit x 0.8, deficit x 1.2) all pass G1 and all catch 0 of 5 rock tiles (E3 with deficit x 0.8 gives 24/315 wall cells in steep veg tiles). On the 32 high-confidence labels alone (13 steep veg tiles, no rock tile) the picture is the same: E1 5/13 tiles, E2 1/13 (cells 15 %), E3 and E23 0/13.

Other measures (not gated):

- Wall precision, strict (wall tiles that are rock): E0 5/44, F 4/15, E1 4/26, E2 4/7, E3 and E23 none called. The wall tiles in the 55 veg tiles and 6 mixed tiles are the false walls: E0 36 plus 3, E1 20 plus 2, E2 3 plus 0.
- AUC for rock against steep veg, from the patch mean rock value: E2 0.97, F 0.85, E1 0.77, E23 0.77, E0 0.73 (wall cell count), E3 0.63.
- Mixed tiles called partial or wall: E0 6/6, E1 5/6, F 4/6, E2 3/6, E3 and E23 0/6.
- Gentle veg tiles (20, of which 8 are the controls): E0 calls 1 of them a wall tile (37 wall cells in all), E1 none (16 wall cells), F none (6), E2 none (0), E3 none (1 cell). None of the 8 controls has even one wall cell under any estimator.
- Which tiles are false walls for E2: KN06 (grass and ferns among shadows, cover 0.05), GR07 (scrub, cover 0.01) and GR10 (scrub, cover 0.13). Two of the three have 56 % and 78 % of their sub-cells at 65 degrees or more. E2 misses one rock tile (GR01).
- E0's walls in the labelled sample: of its 384 wall cells in tiles that are not unsure, 308 (80 %) are in tiles I label veg (271 steep, 37 gentle), 32 (8 %) in mixed and 44 (11 %) in rock. A further 112 of E0's wall cells are in the 14 unsure tiles. The sample over-represents steep ground, so this is a share of the sample and not of the grid. It also overstates the bug, see the next point.
- Steep veg tiles are often cliff-like: 21 of the 35 have at least a fifth of their sub-cells at 65 degrees or more. A near-vertical face has almost no area seen from above, so a tile can show trees and still hold a real cliff. E1's 20 false-wall tiles split 14 cliff-like and 6 not; E2's 3 split 2 and 1.

### 6. Post-hoc looks (done after the labels existed; not part of the verdict)

- Steep forest proper: the 14 steep veg tiles under 0.2 cliff-like (slopes of 55 to 65 degrees under vegetation). Wall tiles: E0 14/14, E1 6/14, F 1/14, E2 1/14, E3 and E23 0/14. Wall cells: E0 77 %, E1 48 %, F 27 %, E2 14 % (18/126), E3 and E23 2 %. Even on this subset E2's cell rate is above the 10 % ceiling.
- E3 threshold sweep (T at the 1 % to 70 % quantile of the reference forest): no threshold meets G1 and G2 together. At the 50 % quantile 2 of 5 rock tiles are walls and 7 of 35 steep veg tiles are false walls (20 %); at 70 % it is 3 of 5 and 10 of 35 (29 %). The index separates poorly: AUC 0.57 to 0.79.
- The colour of the tiles does not separate the labels: mean ExG of rock tiles 0.059 and of steep veg tiles 0.057; mean luminance 68 and 67; mean photo vegetation share 0.83 and 0.88. Gentle forest is greener (ExG 0.081). The unsure tiles are very dark (mean luminance 29).

### 7. Registration of the photo against the terrain

The photo shading is best explained by a sun in the north-west (azimuth 292 to 338 degrees) at all four sites. The best shift is 1 to 2 photo pixels east and 1 to 2 south (8 to 16 m, correlation 0.45 to 0.75 with no shift, 0.48 to 0.80 at the best shift), the same direction at every site. It was not corrected. It is a quarter to a half of a fire cell.

## Verdict

**S6 does not pass by the criteria written first.** Seven candidates were tried (E1, E2, E3, E23 and the three sub-cell variants); none passed.

- E1, E2 and E2c fail G1: E1 calls 20 of 35 steep veg tiles walls (57 %), E2 and E2c 3 of 35 (9 %, inside the tile ceiling) but 17 % of their cells (ceiling 10 %).
- E3, E23, E3c and E23c pass G1 only because they call almost nothing a wall (23 and 10 wall cells in all the labelled tiles that are not unsure). They caught none of the 5 rock tiles. G2 is formally inconclusive, because it needs 8 rock tiles, but 0 of 5 cannot reach 75 % (Wilson upper bound 43 %), so in substance this is a fail.
- G3b is not testable: no tile is labelled chute. The chute rule is not validated by this spike; the Katoomba chute test of 9d.6 is still the only check of it.

Under D17 a missed S6 holds H-sim out of 0.3.0, and it ships as 0.3.1. H-look does not depend on it.

## Recommendation

1. **Hold H-sim for 0.3.1 (D17).** The evidence does not support shipping a rock estimator now, and it does not show that today's rule is right either: it shows the photos cannot settle the question.
2. **Estimator for 0.3.1: E2, slope x (1 - canopy cover), as D20 says.** It is the only candidate with a path to passing. It has the best ranking (AUC 0.97), it keeps 4 of 5 rock tiles and calls 3 of 35 steep veg tiles walls. Its misses are known: low scrub, heath and grass under 2 m have cover near 0 and are read as bare (KN06, GR07, GR10). It is not clear yet that its false walls are false: two of its three false-wall tiles are very steep (56 % and 78 % of their sub-cells at 65 degrees or more), so they may be real cliffs under scrub.
3. **Drop E3 and E23.** The ExG index at the pre-written threshold cannot tell pale rock from forest in these photos (rock tiles look as green as steep forest), no threshold fixes it, deep shadow defeats it, and it would need the photo decoded in the build (today it is display only) and would exist only for the nine bundled sites. E23 (E2 with the photo as a veto), the one combination tried, keeps none of the rock tiles. No combination was found that beats E2 alone, but only one was tried.
4. **Do not use slope alone as the estimator (E1, or F).** 57 % and 31 % of steep veg tiles are walls; and the 55 degree threshold moves the Katoomba wall share between 1.3 and 2.2 %.
5. **No canopy data: leave `rockFraction` undefined, so the model uses today's mask unchanged, and let the dataset record say "Rock: slope only".** The plan sentence "rockFraction = cliffFraction, today's rule, exactly as before" is not one rule: F with the new classes gives 1.30 % walls, 1.33 % partial and 0.06 % chute at Katoomba against today's 3.27 % walls, so it is not "as before". No slope-only estimator passes G1, so changing the no-canopy behaviour has no evidence behind it. F is the better slope-only candidate if you ever want one (31 % against 100 % false-wall tiles, 80 % against 100 % recall on 5 tiles; steep drainage passable 92 to 99 %), but it has not passed.
6. **Before 0.3.1, get better truth than top-down photos.** Someone who knows these escarpments can re-label the 80 tiles from the blind sheets (my guess: under an hour): replace the labels in `labels.json` and re-run, about one minute. That would settle the 14 unsure tiles and the 21 cliff-like veg tiles. Also draw a second sample of 40 or more tiles from E2's wall cells to measure its precision, from today's wall cells that E2 opens while very steep (905 at Katoomba), and from drained gullies for chutes. Oblique photos (section 15b, D29), LiDAR or mapped cliff lines are the sources that can see a face.
7. **Fix the plan's numbers:** the Katoomba wall share range for E2 is about 0.5 %, not 1.5 to 3.5 %; D20's "(1 minus canopy cover)" and the acceptance numbers disagree.

If you ship H-sim in 0.3.0 anyway, ship E2 and accept this: it opens 80 to 98 % of today's wall cells, a third of the opened cells at Katoomba and Grose are very steep ground, and the canopy raster that decides it is itself unvalidated over cliffs.

## Failure modes seen

- **Low scrub, heath and grass read as bare by the canopy cover** (the plan's worry, confirmed): KN06, GR07 and GR10 are all E2 false walls. Related: the canopy model also misses forest (TM07, a forest tile I label veg with high confidence, has cover 0.03).
- **Shadowed faces.** 14 of 80 tiles are deep shadow with mean luminance 29 against 67 elsewhere. They face south-east and south, away from the north-west sun. Rock and forest in shadow are both black, so the photo cannot confirm or refute walls there, and chromatic ExG on near-black pixels is noise. E1 calls 9 of the 14 walls, E2 2, E0 all 14.
- **Pale rock is as green as forest in this photo** by chromatic ExG (low saturation, brown-olive forest). The median ExG of the reference forest ranges from 0.036 (Tomah) to 0.114 (Kanangra) between photos, so one threshold cannot be shared between sites.
- **The top-down view cannot see near-vertical faces.** The DEM's steep ribbons look about 30 to 60 m wide on the sheets and many look vegetated in the photo; 21 of 35 steep veg tiles are cliff-like. This biases the check against estimators that call walls.
- **Photo and terrain are 1 to 2 pixels apart** (8 to 16 m) in one direction at all four sites, and cliffs can lean in an orthophoto made from a smoother surface (not measured).
- **Photo date against terrain date is unknown.** The photo is an NSW basemap mosaic (service copyright 2020); the terrain service's copyright year is 2019 (a stereo surface); the bundle files were captured on 2026-09-27. Flight dates are not recorded. Tomah's site text puts it inside the 2019/20 Gospers Mountain fire perimeter and the app ships 2019 replays at Grose and Kanangra, so fire effects on the photo colour are possible; they were not checked.
- **The terrain itself.** It is a stereo-imagery surface, so under tall forest steepness can come from the canopy (Tomah's steep tiles are mostly 55 to 65 degrees, under vegetation, with few cliff-like cells).
- **Colour resolution.** The JPEG stores colour at 16 m (4:2:0), so a gully 16 to 24 m wide has almost no colour of its own, and 8 m pixels cannot show ledges or chutes narrower than about 16 to 24 m. That is why no chute could be labelled.
- **The labels and E2 are not independent.** Both read the top-down look of the surface, so their agreement (AUC 0.97) does not show that either sees cliffs.
- **Product of means.** E2 and E3 take the product of cell means. The sub-cell variants (steep AND bare per 10 m cell) change the verdict nowhere: 54 against 55 false-wall cells for E2.

## Limits

- One rater, an AI, 80 tiles, 5 rock tiles, 0 chute tiles, 14 unsure, 48 low-confidence labels. Every rate has a wide interval (for example E2 recall 4/5, Wilson 38 to 96 %).
- The sample is stratified toward steep ground: shares in it are not shares of the grid.
- Seven candidates were scored on the same 80 tiles; a pass could have been luck, a miss could be the sample.
- Settings were fixed before any label (hash `e5c07fa5a8477507`). Nothing was tuned on the labels. The post-hoc looks in section 6 are labelled as such; the untuned results are the ones in sections 1 to 5.
- The harness changes nothing in the app. It reads the app's code as it was in the working tree on 2026-10-13; other lanes had made type-only changes (the M0 contract commit) and no logic the harness uses had changed.
- Results are for the 30 m fire cell. The 20 m High-detail cell was not run.

## How to reproduce

```
FIRESIM_SPIKE=1 nice -n 10 npx vitest run tests/spikes/rockEstimators.spike.test.ts --reporter=verbose
```

It takes about a minute. It writes the eight sheets and `results.md` into this folder (the default reporter hides the harness's log lines; `--reporter=verbose` shows them). Without `FIRESIM_SPIKE` the file is skipped, so `npm test` never runs it. Re-scoring with other labels: edit `labels.json` and run the same command. Other options: `FIRESIM_SPIKE_SITES=katoomba,grose` for fewer sites, `FIRESIM_SPIKE_OUT=<folder>` for another output folder, `FIRESIM_SPIKE_AID=<folder>` to also write the labelling aid sheets. Type check: `npx tsc --noEmit -p .`.

## Files

- `README.md` this note.
- `results.md` every table, generated; do not edit by hand.
- `labels.json` my 80 labels with evidence and confidence.
- `sheet-<site>-blind.jpg` (no estimator numbers) and `sheet-<site>.jpg` (with them) for katoomba, kanangra, grose and tomah. Each tile: the aerial crop with the 90 m patch box, and the 10 m slope shading beside it. Aerial photo: © Spatial Services NSW (CC BY 4.0).
- `tests/spikes/rockEstimators.spike.test.ts` the harness.

The folder is 2.3 MB.
