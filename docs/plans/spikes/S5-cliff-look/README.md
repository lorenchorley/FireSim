# S5: cliff sharpening and the edge-keeping mesh on the real renderer

Spike S5 of milestone M0 in `docs/plans/air-slice-wind-detail-honest-speed.md` (9d.3 and 9d.5, decisions D17 to D19). It changes nothing in the app. The prototype is a throwaway patch cut from commit `ca8e637`; the numbers come from a gated vitest file; the pictures come from the render harness (`src/render/dev.html`) on Chromium with software rendering.

**Short answer.**
- The plan's numbers reproduce to the printed digit on all four sites.
- Sharpened terrain plus the edge-keeping mesh make tall faces (160 to 190 m) read as straight, steep walls with a crisp lip and foot at High, and as softer walls at Low. Faces under about 60 m stay ramps: that is the mesh's limit.
- The plan's lighting adds serrated lips and feet (spikes, icicles, voids) wherever the aerial photo is on, worst at Low. The cause is one texture doing two jobs: the 10 m slope that picks photo or banded rock disagrees with 22 or 40 m triangles. The fix: normals from the 10 m sharpened terrain, slope from the mesh.
- It is a wall, not yet rock: a plain striped sheet, with the photo smeared down it. That needs the rock detail of 9d.3.5, which this spike did not include.
- Steep-patch refinement is not needed for 0.3.0. No rung of the fallback ladder is needed once the slope comes from the mesh: build the plan's rule (R0), plus a despike on the finished mesh.

## Question

Cliffs in the 3-D view are not vertical and have no features. The bundled 10 m terrain has faces of 60 to 80 degrees, but the render mesh blurs and decimates it to 22 to 40 m, so cliffs read as ramps. Workstream H-look (plan 9d.3, display only) proposes three changes:

1. a sharpened copy of the 10 m terrain, steepened along the fall line in steep bands;
2. a mesh that keeps the edge (`decimateTerrain`): the blurred value on gentle ground, the unblurred bilinear sample where the vertex footprint is steep;
3. lighting from the sharpened 10 m terrain (a 10 m gradient texture built from it).

The plan's table of numbers came from a throwaway node script, and "whether it looks right is settled in S5". This note answers four things. Do the plan's numbers reproduce? Does the result look like rock walls on the real renderer, and which artifacts appear? Which rule and constants should be built? Is the steep-patch refinement (10 m triangles in steep zones) needed?

## Method

**The prototype** (`prototype.patch`; a throwaway starting point for the lane, not reviewed code; it covers `src/` only and applies cleanly to `ca8e637`):

- `src/render/cliffSharpen.ts`: `cliffSharpen(grid, elevation, opts)`, the rule of 9d.3.1 with every constant an option. The defaults are the plan's: gate `smoothstep(48, 62, Horn slope)`, spread one cell outwards at 0.6, a 3-cell window along the fall line (bilinear), a 0.5 m dead band, a despike pass at 10 m with a 2 m margin. It is the plan's whole-grid probe made efficient: one Horn pass on tan squared (no atan except on steep cells), weights by scatter, fall-line moves only for cells with a weight, a Jacobi despike with an early exit. It also has two fallback switches: `strength` (a multiplier on the weight) and `snap` (lip and foot only: a cell moves only if it sits in the outer `snap` fraction of its window's height range). `despikeGrid` is shared with the mesh.
- `src/render/fields.ts`: `decimateTerrain`, 9d.3.2 as written (blend `smoothstep(40, 55, steepest 10 m slope in the vertex footprint)` between the `decimateGrid` value and the unblurred bilinear sample), with an optional despike of the finished mesh; and `hybridGradient`.
- `src/render/terrainLayer.ts`: the lighting gradient texture can come from any grid (`LightGradient`), a second gradient can drive only the slope that picks strata and photo (`uGradS`, `uSplit`), and a flat-shading switch shows the mesh facets.
- `src/render/SceneView.ts`: `SceneViewOptions.cliff` (`sharpen`, `mesh: 'old' | 'keep'`, `light`), per-stage `performance.now()` timings in `cliffInfo`, and harness methods (`standAt`, `getPose`, `setPose`, `debugFlat`).
- `src/render/dev.ts`: the URL flags (below). `src/render/cameraRig.ts`: one flag that stops the rig seating the target on the terrain.
- Tests: `src/render/cliffSharpen.test.ts`, and two cases in `src/render/fields.test.ts` (`decimateTerrain` equals `decimateGrid` exactly below 40 degrees; a 150 m step stays a step).

Hillshade, sky view, cast shadows and the `HeightField` (picking, camera clamp, trees, flames) are built from the render mesh already, so they follow the sharpened mesh without further changes.

**The harness does not build its mesh the way the app does.** By default `dev.ts` loads elevation at `cell=20` and gives `setScenario` no `hiRes`, so its mesh comes from the 20 m fire-grid terrain (no blur at High, a 3 x 3 blur at Low). The app passes the 10 m DEM as `hiRes` (`simScreen.ts:108`, `scenario.terrainHiRes`), and the mesh comes from that: a 3 x 3 box blur at High (22.5 m cells), 5 x 5 at Low (40.3 m). I added `?hires=1`: the 10 m DEM from `loadElevation`, the fire-grid terrain from `fireTerrainFromHiRes(dem, 30)` (the app's default cell, so the lighting gradient is the 30 m one, as in the app), and `hiRes` to `setScenario`. Every picture uses it. The flags are listed in the header of `src/render/dev.ts` (patched): `sharpen=0|1` with `lo hi spread win str eps despike snap`; `mesh=old|keep` with `mlo mhi mdespike`; `light=0|1|meshgrid|mesh|hybrid|n10s-mesh|nmesh-s10`; `meshN=<n>` (900 draws the whole 10 m terrain as the mesh); `eye=ux,uy,lx,ly`; `marks=0`; `dbg=flat`.

**The drawings compared**, always at the same camera pose:

| label | flags | what it is |
|---|---|---|
| today | `sharpen=0 mesh=old light=0` | the app now: `decimateGrid` of the 10 m data, lighting from the 30 m fire-grid gradient |
| plan | `sharpen=1 mesh=keep light=1` | plan 9d.3 as written: sharpened 10 m terrain, edge-keeping mesh, one 10 m gradient texture (RG16F, 900 x 900) built from the sharpened terrain for both the normal and the slope |
| mesh-lit | `sharpen=1 mesh=keep light=meshgrid` | the same terrain and mesh, normal and slope both from the mesh's own Horn gradient (`lightTerrain` already computes it for the hillshade) |
| split | `sharpen=1 mesh=keep light=n10s-mesh` | normal from the 10 m sharpened terrain, slope from the mesh |

Mesh-lit and split are not in the plan. I added them after the plan's version showed artifacts (section 5). A reference drawing, `meshN=900`, uses the whole sharpened 10 m terrain as the mesh (1.6 million triangles, not shippable); it shows what the sharpening itself looks like when the mesh does not quantise it.

**Where and how the pictures were made.** Four sites, one sheer face each, chosen from the 10 m terrain by drop and run (not by how it renders): Katoomba (188 m drop, lip at 954 m, foot at 765 m, faces south), Kanangra (161 m, faces north-north-west), Grose (176 m, faces east), Tomah (126 m, faces west-south-west). My first picks for Kanangra and Grose, by the steepest cell, turned out to be long steep slopes with benches, not sheer faces. I swapped them for the sheer ones above and kept Grose's benched face (a 288 m drop) for the terracing check. Three viewpoints per face: an orbit view 1100 m away (800 m at Tomah) at 24 degrees above the horizon, 25 degrees off the fall line; a top-down view 800 m up (600 m at Tomah); an eye-level view (1.7 m) standing downhill of the face (260, 320, 260 and 120 m) looking at its centre. The harness runs a synthetic fire that has not started (`t=0`), at 13:00 local on 21 December 2019, with the photo and trees on and wind, smoke, flames and markers off. Frames are 412 x 915 at device scale 1, High unless stated.

All drawings of a view share one camera pose: the pose is read from the today drawing after the rig has seated itself, then held exactly for the others (`setPose`). This matters. The rig puts the view's target on the ground under the middle of the screen, and the sharpened ground there can be tens of metres from today's (75 m at Katoomba's face centre), so with separate poses the eye-level pictures were aimed at different heights and the sharpened cliffs looked taller than they are.

**What I looked for** in each picture, at full size and not in the composites: spikes, terraces, shimmer, odd lips, stretched or smeared textures, mesh cracks, lighting discontinuities, near-black pixels, and whether it reads as a rock wall. Shimmer was measured with two frames half a pixel apart. I am one reviewer.

**What was measured** (`tests/spikes/cliffSharpen.spike.test.ts`, gated by `FIRESIM_SPIKE=1`, self-contained): the plan's table re-run on all four sites; mesh edges for four ways of building the mesh and three tiers, and the single-vertex spikes of the mesh; timings per stage in node; the properties the plan lists for the pure tests (9d.6); what a mesh of a given spacing can show of a step; the fallback ladder; the drift of the drawn face from the data's; face heights and terracing; and what steep-patch refinement would cost in triangles. The test also holds the plan's probe (`steepenDir`, `despike`, `decimateKeep`) unchanged, to check the optimised prototype against it.

## Findings

### 1. The plan's numbers reproduce

`FIRESIM_SPIKE=1 nice -n 8 npx vitest run tests/spikes/cliffSharpen.spike.test.ts` re-runs the table of 9d.3 on the four bundled sites. Every entry equals the plan's at the printed precision (the test asserts the first four columns within the rounding). Data to new:

| Site | Steepest 10 m slope (deg) | Area over 70 deg (%) | High mesh edges over 70 deg (%) | Steepest High edge (deg) | Steepest Low edge (deg) | Drainage overlap (IoU, 5 ha) |
|---|---|---|---|---|---|---|
| Katoomba | 83.2 to 85.0 | 0.52 to 0.97 | 0.12 to 0.60 | 78.0 to 83.5 | 73.2 to 79.1 | 0.92 |
| Kanangra | 82.8 to 86.2 | 0.16 to 0.98 | 0.02 to 0.47 | 79.9 to 85.3 | 75.9 to 81.3 | 0.94 |
| Grose | 84.0 to 86.2 | 1.09 to 1.45 | 0.44 to 0.87 | 80.8 to 85.4 | 76.4 to 81.9 | 0.86 |
| Tomah | 73.5 to 81.7 | 0.02 to 0.79 | 0.00 to 0.31 | 67.3 to 79.2 | 60.7 to 72.3 | 0.91 |

The prototype here is an optimised rewrite, so I also kept the plan's whole-grid probe (`steepenDir`, `despike`, `decimateKeep`, copied from the scratch files) in the test and compared: the optimised `cliffSharpen` differs from the probe by at most 1.2e-4 m in any cell (float rounding; 0 cells differ by more than 1 mm), and `decimateTerrain` differs from the probe's `decimateKeep` by at most 6.1e-5 m. So the plan's table describes this prototype exactly.

The other numbers of 9d.3 (Katoomba, Kanangra, Grose, Tomah):

| | Cells with weight above 0 | Moved by 0.5 m or more | Mean move | Largest move | Despiked | Towers and pits of 10 m or more left |
|---|---|---|---|---|---|---|
| Katoomba | 36,255 (4.5 %) | 31,756 (3.9 %) | 19.0 m | 94.6 m | 46 | 0 and 0 |
| Kanangra | 62,290 (7.7 %) | 49,250 (6.1 %) | 13.2 m | 122.2 m | 48 | 0 and 0 |
| Grose | 56,990 (7.0 %) | 48,195 (6.0 %) | 20.9 m | 119.6 m | 86 | 0 and 0 |
| Tomah | 64,705 (8.0 %) | 49,105 (6.1 %) | 9.5 m | 54.5 m | 1 | 0 and 0 |

The plan says "about 4 to 7 % of cells move, by 8 to 19 m on average (up to about 120 m), the despike fixes 1 to 86 cells". That holds, with one entry slightly outside: Grose's mean move is 20.9 m, and Tomah's largest move is 54.5 m (the 120 m figure is Kanangra and Grose). The plan's "0.45 to 0.54 s in node for the unoptimised whole grid" also reproduces: the probe took 458 ms on Katoomba and 439 ms on Tomah on this machine.

**Drift of the drawn face (9d.3.7).** The plan says the drawn lip and foot can sit up to about three cells (30 m) from the data's. I measured, for every cell of the sharpened terrain at 45 degrees or more, the distance to the nearest data cell at 45 degrees or more: 95.1 to 96.5 % of them are in the data's own steep zone, 3.5 to 4.9 % are one cell (10 m) away, and at most 0.1 % (Kanangra) two cells (20 m). None is three cells away. The mesh then adds its own quantisation of up to a vertex spacing (22 m at High, 40 m at Low).

### 2. What each part does to the mesh

Share of triangle edges over 70 degrees, and the steepest edge, for the four ways of building the mesh (`decimateGrid` is today's box blur, "keep" is `decimateTerrain`, "sharp" is `cliffSharpen`; "plan" = sharp + keep):

| Site and tier | today | keep only | sharp only (blurred mesh) | plan (sharp + keep) |
|---|---|---|---|---|
| Katoomba, High 22.5 m | 0.12 % / 78.0 deg | 0.19 % / 80.6 | 0.42 % / 81.0 | 0.60 % / 83.5 |
| Kanangra, High | 0.02 % / 79.9 | 0.05 % / 81.6 | 0.21 % / 83.7 | 0.47 % / 85.3 |
| Grose, High | 0.44 % / 80.8 | 0.52 % / 83.2 | 0.75 % / 83.7 | 0.87 % / 85.4 |
| Tomah, High | 0.00 % / 67.3 | 0.00 % / 71.6 | 0.05 % / 75.5 | 0.31 % / 79.2 |
| Katoomba, Low 40.3 m | 0.02 % / 73.2 | 0.11 % / 76.3 | 0.13 % / 75.5 | 0.49 % / 79.1 |
| Kanangra, Low | 0.01 % / 75.9 | 0.03 % / 78.4 | 0.05 % / 78.7 | 0.22 % / 81.3 |
| Grose, Low | 0.25 % / 76.4 | 0.46 % / 79.5 | 0.51 % / 79.4 | 0.88 % / 81.9 |
| Tomah, Low | 0.00 % / 60.7 | 0.00 % / 65.7 | 0.00 % / 66.5 | 0.02 % / 72.3 |

Each part alone moves the numbers a little, and the two together move them far more. At Katoomba High, keep alone adds 0.07 points of edges over 70 degrees, sharpening alone adds 0.30 and both add 0.48. At Katoomba Low, 0.09, 0.11 and 0.47. A blurred mesh hides a sharpened step, and the unblurred mesh has no step to keep in the data. Medium is in the test output. The triangle count does not change in any of these: 318,402 (High, 400 x 400 samples), 203,522 (Medium) and 99,458 (Low); only heights change.

### 3. What the mesh alone can and cannot show

A mesh edge across a step of height H and vertex spacing s cannot be steeper than atan(H / s). The test slides an ideal step (one 10 m cell wide) across the vertex lattice in 1 m phases and reports the steepest edge (mean over phases; worst phase in brackets), for `decimateTerrain` ("keep") and `decimateGrid` ("blur"):

| Face height | 22.5 m spacing (High): ideal, keep, blur | 40.3 m spacing (Low): ideal, keep, blur |
|---|---|---|
| 30 m | 53.1, 52.5 (51.4), 42.2 deg | 36.7, 35.7 (32.6), 27.2 deg |
| 60 m | 69.4, 69.0 (68.3), 61.1 | 56.1, 55.1 (52.0), 45.6 |
| 100 m | 77.3, 77.0 (76.6), 71.7 | 68.0, 67.3 (64.9), 59.5 |
| 150 m | 81.5, 81.3 (80.9), 77.6 | 75.0, 74.4 (72.7), 68.5 |
| 300 m | 85.7, 85.6 (85.4), 83.7 | 82.3, 82.1 (81.1), 78.8 |

The edge-keeping mesh stays within 1 degree of the ideal on average (within 4 degrees in the worst phase at 40.3 m); the box blur loses 2 to 11 degrees at 22.5 m and 3 to 11 at 40.3 m. What the mesh cannot do, whatever the terrain: a face of 60 m has edges of at most 69 degrees on the High mesh and 56 degrees on the Low mesh, and a face of 30 m at most 53 and 37 degrees. Those are ramps. The plan's sentence "a face under about 60 m reads as a ramp on a 22 or 40 m mesh" is correct. One of the plan's test thresholds cannot be met: 9d.6 asks for at least 75 degrees between adjacent vertices of the 40 m mesh across a 150 m step, but 75.0 is the ideal (a step exactly between two vertices) and the worst phase gives 72.7. Use 72.

How many faces are tall? From the 10 m terrain, counting lip cells (a cell at 55 degrees or more with a gentler cell above it) and the drop to the foot (first cell under 45 degrees):

| Site | Lips | Drop under 30 m | 30 to 60 m | 60 to 100 m | 100 to 200 m | Over 200 m | Median drop |
|---|---|---|---|---|---|---|---|
| Katoomba | 2,590 | 9 % | 17 % | 27 % | 47 % | 0 % | 96 m |
| Kanangra | 1,559 | 18 % | 31 % | 22 % | 26 % | 3 % | 61 m |
| Grose | 3,659 | 12 % | 22 % | 12 % | 34 % | 19 % | 113 m |
| Tomah | 2,702 | 26 % | 51 % | 22 % | 1 % | 0 % | 42 m |

Faces under 100 m are 53 % of lips at Katoomba, 71 % at Kanangra, 46 % at Grose and 99 % at Tomah. So the mesh limit matters at all four sites, most at Tomah and Kanangra, where the median face is 42 and 61 m. (This counts lips, not area or visual weight: a few tall faces dominate what a person looks at.)

### 4. The pictures

Each composite in `shots/` has the drawings left to right: **today** (the app now), **plan** (9d.3 as written), **mesh-lit** and **split** (two lightings that I added, section 5). The panels of a view share one camera pose. High tier unless the name says Low. I looked at each panel at full size (412 x 915 PNG, the `raw` mode of `shoot.mjs`) before looking at the composite, and wrote down what I saw. All three sharpened drawings have the same geometry (sharpened terrain, edge-keeping mesh); they differ only in the lighting.

**Orbit views, High** (`katoomba-orbit-high.jpg`, `kanangra-orbit-high.jpg`, `grose-orbit-high.jpg`, `tomah-orbit-high.jpg`)
- Today: the faces read as rounded, draped slopes. The lip is a soft curve, the foot is a dark smudge, the stripes bend with the surface. At Grose the 176 m face has no visible lip and runs into the plateau.
- Plan: straight walls with serrated edges. At Katoomba, dark triangles 20 to 60 m wide hang from the lip and spikes stand up from the foot. At Grose there are dark vertical slits, a dark rectangle high on the wall and a small dark blotch. At Tomah the foot of the main band is jagged. Kanangra is the cleanest of the four: a few straight-edged pale and dark patches on the lower bench. None of this is in the mesh (mesh-lit has the same mesh without it).
- Mesh-lit: Katoomba (188 m), Kanangra (161 m) and Grose (176 m) read as steep straight walls with a clean lip and foot. No spikes. The face is a flat tan sheet.
- Split: the same clean wall with a crisper lip and some vertical structure on the face (buttresses and slots at Katoomba, a dark line under the lip), because the 10 m normals light it. It is the best of the three.
- Tomah (126 m face) becomes a stepped bank with two rock bands in the forest, more articulated than today's smooth slope, but not a wall. Trees stand on the bands (there is no tree rule yet).
- The pale vertical streak under the bright patch on the Katoomba plateau (also at Kanangra) is the aerial photo stretched down the face. It is in every drawing and harder-edged in the plan one.

**Top-down, 800 m up** (`top-high-katoomba-kanangra.jpg`, `top-high-grose-tomah.jpg`)
- Today: Katoomba and Grose show the face as a band of stripes like contour lines. Kanangra and Tomah show a faint broad band.
- The width of that band is set by the slope that picks banded rock. Along a fall-line profile through the face centre, the slope is at or above 50 degrees over 92 m (Katoomba) and 94 m (Grose) in today's 30 m fire-grid gradient, over 38 and 50 m in the 10 m data, 28 and 28 m in the sharpened 10 m terrain, and 68 and 60 m in the High mesh's own gradient (`BANDS` in section 5; one profile per face).
- So the plan drawing has the narrowest band with a crisp edge, which reads as a near-vertical wall seen from above. Its lip is quantised to the vertices: the edge zigzags with a 22 m period and the Katoomba band has one 40 m offset step. The Grose band ends in two dark slits.
- Mesh-lit and split bands are wider (about 60 to 70 m at High) with a soft edge. They keep a third to a half of the narrowing that the plan's band shows, because the mesh gradient averages over three 22 m cells.
- Kanangra and Tomah are hard to read from above in any drawing; the sharpened ones show narrow ledge bands (Tomah: three sinuous ones) where today has one broad faint band.

**Eye level, 1.7 m high, 120 to 320 m below the face** (`eye-high-katoomba-kanangra.jpg`, `eye-high-grose-tomah.jpg`)
- Today: smooth domes, no wall.
- Mesh-lit and split: a wall with an angular silhouette. At Kanangra and Tomah the stripes kink at the 22 m facet edges (chevrons) and the silhouette looks low-poly: close to a 22 m mesh a steep face is a few big flat triangles.
- Plan: a pale gradient patch along the top of the Katoomba wall, a dark rectangle at the top of the Grose wall and a dark spike at the Katoomba foot (all lighting mismatches).
- In every drawing a wall that fills the frame at 120 to 260 m is a plain striped sheet. Nothing in it says rock.

**Low tier** (`orbit-low-katoomba-grose.jpg`; 224 samples, 40.3 m)
- Plan fails visibly. At Katoomba, dark spikes stand up from the foot to about 40 % of the wall's height and icicles hang from the lip. At Grose there is an open dark void under the wall and ragged slits. The mismatch zone is one vertex spacing, so it doubles from High to Low.
- Mesh-lit is clean: a steep, rounded wall, softer than at High (the steepest edge across a 40 m spacing is 78 degrees for a 188 m face).
- Split is clean too and has more relief (light vertical bars on the Katoomba wall, a lighter rectangle at Grose). Those are 10 m normals painted on a 40 m mesh: the shading has a vertical structure that the geometry lacks. I have only seen still frames.

**Zoom levels** (`katoomba-wide-high.jpg` 3000 m, `katoomba-orbit-high.jpg` 1100 m, `katoomba-close-high.jpg` 450 m)
- 3000 m: today is a rounded curtain; mesh-lit and split are a vertical cliff band with a clean top edge. It reads as a cliff at once and is the best result in the set. The plan has a row of teeth along the foot.
- 450 m: the face fills the frame as a flat striped surface without features, in all drawings. The plan shows a pale smear patch and dark teeth.

**Where the wall comes from** (`katoomba-facets.jpg`, `katoomba-reference-10m.jpg`)
- Flat shading, no photo, no trees: the box-blurred data is a rounded mound; the sharpened terrain on a blurred mesh is steeper but still rounded; the sharpened terrain on the edge-keeping mesh is a row of sheer fins with a straight lip and foot. The wall is geometry.
- With the whole sharpened terrain as the mesh (1.6 million triangles, the reference), the picture at 1100 m is almost the same as the 22 m mesh, a little crisper at the lip and more ragged at the foot. The data's own 10 m terrain as the mesh is still a soft ramp. So for tall faces the sharpening, not the mesh resolution, makes the wall, and a 22 m mesh is enough once it is sharpened.

**Fallback ladder** (`katoomba-ladder.jpg`; top row the plan's lighting, bottom row split; R0 = the plan, R1 = gate 52 to 66, R2 = R1 and a one-cell window, R3 = R2 and lip-and-foot snapping at 0.25)
- Plan lighting: R0 and R1 are serrated; R2 has fewer and smaller teeth; R3 is clean but close to today's rounded look.
- Split lighting: all four rungs are clean. R2 and R3 round the lip and the wall bulges a little. R0 is the crispest and has no artifact to retreat from.

**Terraces** (`grose-terraces.jpg`; the whole 10 m terrain as the mesh, so the mesh hides nothing; panels: data, R0, strength 0.6, R3)
- The long benched face at Grose (a 288 m drop over about 220 m of run) becomes three near-vertical walls with benches between them under R0. Strength 0.6 keeps most of that; R3 is almost the data. Faces that meet 55 degrees again within 3 cells below their foot are 6 to 12 % of faces in the data and 19 to 23 % under R0 (8 to 12 % under R3; 6 to 9 % at strength 0.6, which is not on the plan's ladder). Terracing doubles or triples. The benches are changes of steepness already in the data, but the sharpening decides where the risers become vertical.

**Short faces and the 10 m mesh** (`short-faces.jpg`, `grose-refine.jpg`): section 8.

**Vertex spikes** (`vertex-spikes.jpg`; 320 m from the spike, same pose in all panels)
- The edge-keeping mesh samples the unblurred 10 m terrain at single vertices, and a few of those stand out. At High the mesh has 13, 12, 20 and 1 vertices (Katoomba, Kanangra, Grose, Tomah) at least 10 m above or below all eight neighbours (today 0), up to 29, 25, 44 and 15 m. Close up they show as a pointed fin (Katoomba) or a notch in the lip (Grose). A despike on the finished mesh at 10 m removes every one of them without changing the edge statistics (steepest edge and share over 70 degrees unchanged, except Kanangra 0.47 to 0.46 %). At Low a despike at 18 m removes only the 20 m ones.

**Without the aerial photo** (`no-photo-sun.jpg`; Kanangra at 13:00 and 17:00)
- With the photo off, the plan's lighting has no serration (the photo-versus-rock switch is gone) and plan and split look alike. The 10 m normals show buttresses and gullies lit and shadowed on the wall at 17:00; mesh-lit is a smoother wall. So the relief from the 10 m normals is real, and the serration is a property of the photo switch.

### 5. Lighting: where the artifacts come from

Plan 9d.3.3 builds the lighting gradient from the sharpened 10 m terrain. In the shader (`terrainLayer.ts`) that one texture does two jobs. It gives the normal (the lighting). Its length is also `slope`, which decides where banded rock replaces the photo (`steep = smoothstep(0.85, 1.6, slope)`, 40 to 58 degrees) and where the strata show. I split the two jobs to find which one makes the serrated lips and feet (the `light=` flags of the patched harness):

| name in the pictures | normal from | slope (strata, photo switch) from |
|---|---|---|
| today | 30 m fire-grid gradient | 30 m fire-grid gradient |
| plan | 10 m sharpened terrain | 10 m sharpened terrain |
| mesh-lit | the mesh's Horn gradient | the mesh's Horn gradient |
| split | 10 m sharpened terrain | the mesh's Horn gradient |
| split reversed | the mesh's Horn gradient | 10 m sharpened terrain |
| hybrid | 10 m terrain on gentle ground, mesh gradient where the slope is over 40 to 55 degrees | the same field |

Result (`lighting-sources.jpg`, three views, four of the lightings): **the artifacts follow the slope, not the normal.** Plan and split reversed have the teeth, icicles, slits and voids; split and mesh-lit do not. The 10 m normals are harmless, and they give the relief: without the photo (`no-photo-sun.jpg`) plan and split show buttresses and gullies lit and shadowed on the face while mesh-lit shows a smooth wall. Two more variants were rendered and are not in the composites. Hybrid (10 m terrain on gentle ground, mesh gradient on steep ground) is in between and brings back part of the teeth at Grose Low, so it is not worth its extra cost. Taking the smaller of the two slopes (`light=n10s-min`) brings the teeth back at the Katoomba lip and foot, because the 10 m slope still sets the switch wherever it is the lower. So the slope must come from the mesh alone.

So the plan's idea (let the 10 m terrain light the faces) works. The plan's wiring (let it also choose the rock colour) does not. At the lip and foot the 10 m terrain and a 22 or 40 m triangle disagree about where the face is by up to one vertex spacing, and a switch between photo and banded rock draws that disagreement as a spike. With the photo off there is no switch, and no spike.

The same disagreement will hit anything else that is classified at 10 m and drawn on the mesh. The rock mask of 9d.3.4 (R = bare steep rock from the 10 m slope) and the detail that is "evaluated only where R is above 0.25" (9d.3.5) are of that kind. That is an inference from the result above, not something I tested: build R so that it agrees with the mesh (from the mesh's slope, or widened by one vertex spacing), or the rock detail will be serrated in the same way.

The cost of using the mesh's slope is a wider band in a top-down view. Measured along a fall-line profile through each face centre (width in metres where the slope the shader uses is at or above 50 degrees; first and last position in metres, positive downhill):

| Face | today's 30 m gradient | 10 m data | 10 m sharpened | High mesh, today | High mesh, plan | Low mesh, plan |
|---|---|---|---|---|---|---|
| katoomba | 92 m (-40 to 50) | 38 m (-18 to 18) | 28 m (-18 to 8) | 74 m (-34 to 38) | 68 m (-38 to 28) | 94 m (-58 to 34) |
| grose | 94 m (-44 to 48) | 50 m (-40 to 28) | 28 m (-8 to 18) | 82 m (-38 to 42) | 60 m (-30 to 28) | 94 m (-34 to 58) |
| kanangra | 38 m (0 to 82) | 66 m (-116 to 96) | 60 m (-118 to 98) | 66 m (-8 to 96) | 82 m (-12 to 102) | 40 m (40 to 130) |
| tomah | 84 m (-28 to 54) | 104 m (-22 to 154) | 76 m (-16 to 150) | 94 m (-28 to 140) | 100 m (-26 to 152) | 76 m (-32 to 42) |

The mesh's own gradient gives 60 to 74 m at the two sheer faces against 28 m for the sharpened terrain and 92 to 94 m for today's lighting. Kanangra and Tomah are benched, so one profile does not say much there. Narrowing the mesh-slope band is a tuning for the lane (the smoothstep of 40 to 58 degrees was set for a 30 m gradient).

### 6. Artifacts, one by one

| Artifact | Where | How much | Cause | What I tried | Result |
|---|---|---|---|---|---|
| Serrated lip and foot (dark spikes, icicles, slits, pale patches, voids) | plan lighting, every site, worse at Low | spikes one vertex spacing wide (22 m High, 40 m Low), up to 40 % of the wall's height at Low | the 10 m `slope` picks strata or photo on 22 or 40 m triangles | mesh lighting; split; hybrid | gone with mesh-lit and split; partly back with hybrid |
| Single-vertex spikes (pointed fins, notches in the lip) | the edge-keeping mesh, seen within about 300 m | 13, 12, 20 and 1 vertices of 10 m or more per site at High (today 0), up to 29, 25, 44 and 15 m | unblurred samples of the 10 m terrain at isolated vertices | a despike on the mesh at 10 m (High), 18 m (Low) | all 10 m ones gone at High; edge statistics unchanged |
| Terracing (a long face becomes walls and benches) | the sharpened terrain, mostly Grose and Kanangra | faces that meet 55 degrees again within 3 cells below the foot: 19 to 23 % against 6 to 12 % in the data | the rule collapses a slope of varying steepness into steps | R3 (8 to 12 %), strength 0.6 (6 to 9 %) | both bring it back to the data's level, at a cost in steepness (section 10) |
| Photo smear (a pale vertical streak below a bright patch on the plateau) | all drawings, any face under a bright photo patch | one streak per face at Katoomba and Kanangra | the shader keeps 30 % of the photo on a vertical face (`mix(..., steep * 0.7)`) | nothing (9d.3.5 covers it) | not fixed here |
| Lip quantised to vertices (a 22 m zigzag; a 40 m offset step) | top-down views | one vertex spacing | a lip can only sit on a vertex | nothing; a resolution limit | refinement would reduce it |
| Kinked stripes and a low-poly silhouette | eye level, 120 to 320 m from the face | the 22 m triangles | the stripes follow height interpolated across a few big triangles | nothing | a resolution limit |
| Small terrain spikes (5 to 9.9 m) that the 10 m despike leaves | single cells of the sharpened terrain | 53, 81, 108 and 12 cells of 5 m or more per site (data: 1, 0, 3, 3) | the despike threshold | despike at 5 m | removes them (99 to 194 cells touched per site); I saw no picture in which they matter |
| Shimmer | none found | section 7 | | | |
| Mesh cracks | none | the mesh is one regular grid, so a crack cannot occur; the skirt and the outer ring are untouched | | | |
| Near-black pixels | none introduced | pixels under luminance 12: 0.00 % in every drawing and view except the Kanangra top view (0.05 to 0.10 %, today 0.09 %); pixels under 20: 0.00 % in today, mesh-lit and split except the Kanangra top view (0.43 to 0.50 % in all four drawings), while the plan drawing has 0.20 % (Katoomba orbit), 0.21 % (Katoomba top), 0.54 % (Katoomba close) and 0.03 % (Grose top, Katoomba Low): the dark spikes | | | |

### 7. Cost and shimmer

**Node** (the harness; median of 7 runs after 2 warm-ups, ms; quiet machine, load average 0.3 at the start):

| Site | `cliffSharpen` total (min) | of which slope pass, weights, moves, despike | `decimateGrid` High | `decimateTerrain` High | 10 m lighting texture data |
|---|---|---|---|---|---|
| katoomba | 28 (25) | 7, 6, 7, 3 | 11 (9) | 38 (36) | 165 (159) |
| kanangra | 32 (32) | 10, 9, 14, 5 | 10 (9) | 38 (37) | 163 (151) |
| grose | 29 (28) | 6, 7, 11, 3 | 10 (9) | 37 (36) | 157 (149) |
| tomah | 30 (29) | 7, 7, 18, 3 | 10 (9) | 34 (33) | 156 (152) |

**Browser** (`shoot.mjs timing`: a fresh page load per sample, so the JIT is cold like the first scenario build in the app; quiet machine (load average about 1); median over 4 cases (Katoomba and Grose, High and Low), 3 loads each; ms, range in brackets. An earlier run on a loaded machine (load average 6 to 12, 8 cases, 5 loads each) gave about 1.5 times these figures, for example 103 ms for `cliffSharpen` and 96 ms for `decimateTerrain`):

| Stage | today | plan | split |
|---|---|---|---|
| `cliffSharpen` | 0 | 68 (62 to 71) | 62 (56 to 67) |
| mesh decimation (`decimateGrid`, `decimateTerrain`) | 24 (19 to 26) | 61 (52 to 62) | 56 (48 to 68) |
| Horn gradients for the lighting (CPU): 10 m terrain, and for split also the mesh | 0 (0 to 3) | 42 (33 to 53) | 40 (38 to 43) |
| lighting texture build in `TerrainLayer` | 8 (8 to 10) | 32 (32 to 46) | 32 (28 to 34) |
| everything else in `setScenario` | 161 (103 to 235) | 170 (113 to 224) | 170 (105 to 239) |
| **sum of the stages** | **194 (132 to 268)** | **378 (304 to 433)** | **359 (285 to 443)** |

The "everything else" row (light terrain, hillshade, sky view, fuel and imagery textures, shade) is the same in all drawings; sky view alone is 137 to 155 ms at High and 50 to 67 ms at Low. The plan's CPU line (section 11) says for a phone `[est]`: sharpening at most 400 ms, mesh decimation at most 100 ms. At the plan's own desktop-to-phone ratio (2.7, from "150 ms desktop, about 400 ms phone") the sharpening is about 184 ms (inside), and at 5 times it is about 340 ms `[guess]`. The decimation is not inside: `decimateTerrain` took 61 ms cold here against 24 for `decimateGrid`, so 165 ms at 2.7 times and 305 ms at 5 times `[guess]`, and today's `decimateGrid` alone would already be 65 to 120 ms by the same ratios. The 10 m lighting texture (Horn gradient plus a texture build, about 74 ms here) is not in the plan's budget at all.

**Triangles and memory.** Triangles do not change: 318,402 (High, 400 x 400 samples), 203,522 (Medium) and 99,458 (Low). GPU memory: the plan's 10 m gradient texture is 900 x 900 RG16F = 3.24 MB (today's 30 m fire-grid gradient is 0.36 MB). The mesh's gradient, for split, is 0.64 MB at High, 0.41 MB at Medium and 0.2 MB at Low (or a per-vertex attribute of the same size, which saves a texture unit; not tested). CPU memory: the sharpened copy is 3.24 MB (a 900 x 900 Float32Array) and the working arrays peak at about 13 MB while it runs. A 12 km area (1200 x 1200) is 1.8 times all of these.

**No tile gate was needed.** Only about 4 to 8 % of the cells have a weight (36,000 to 65,000 of 810,000), so the moves and the despike touch few cells, and the whole-grid Horn pass is the largest single part (7 to 14 ms in node, of 26 to 39). A scenario with no cell over 48 degrees pays only that pass.

**Shimmer.** Two frames with the camera moved half a pixel (orbit: slid sideways; eye level: turned), terrain without trees, luminance difference in the part of the frame that is not within 3 px of an edge of frame A. Mean absolute difference in grey levels out of 255, with the share of those pixels that changed by more than 6 levels in brackets:

| Site | View | today | plan | mesh-lit | split |
|---|---|---|---|---|---|
| katoomba | orbit 1100 m | 0.58 (0.00 %) | 0.69 (0.01 %) | 0.60 (0.00 %) | 0.64 (0.01 %) |
| katoomba | orbit 3500 m | 1.44 (0.00 %) | 1.53 (0.03 %) | 1.45 (0.00 %) | 1.50 (0.02 %) |
| katoomba | orbit 8000 m | 2.38 (0.35 %) | 2.43 (0.44 %) | 2.39 (0.38 %) | 2.43 (0.38 %) |
| kanangra | orbit 1100 m | 0.71 (0.00 %) | 0.72 (0.01 %) | 0.71 (0.01 %) | 0.72 (0.01 %) |
| kanangra | orbit 3500 m | 1.54 (0.03 %) | 1.61 (0.06 %) | 1.56 (0.05 %) | 1.57 (0.05 %) |
| kanangra | orbit 8000 m | 2.25 (0.51 %) | 2.40 (0.64 %) | 2.28 (0.55 %) | 2.34 (0.57 %) |
| grose | orbit 1100 m | 0.43 (0.00 %) | 0.50 (0.01 %) | 0.45 (0.00 %) | 0.48 (0.00 %) |
| grose | orbit 3500 m | 1.35 (0.06 %) | 1.42 (0.06 %) | 1.36 (0.05 %) | 1.40 (0.07 %) |
| grose | orbit 8000 m | 1.98 (0.29 %) | 2.06 (0.36 %) | 2.00 (0.31 %) | 2.05 (0.32 %) |
| katoomba | eye level | 0.12 (0.00 %) | 0.15 (0.00 %) | 0.14 (0.00 %) | 0.14 (0.00 %) |
| kanangra | eye level | 0.07 (0.00 %) | 0.09 (0.00 %) | 0.09 (0.00 %) | 0.09 (0.00 %) |
| grose | eye level | 0.08 (0.00 %) | 0.08 (0.00 %) | 0.08 (0.00 %) | 0.08 (0.00 %) |

The three sharpened drawings equal today's to within 0.04 grey levels and 0.1 percentage points in the orbit views, and are 0.00 to 0.04 higher at eye level (largest: Katoomba, 0.09 today and 0.13 plan). I found no extra shimmer from the sharpened terrain or from the 900 x 900 lighting texture, which has no mipmaps (`minFilter` linear) and so could alias when zoomed out. The 8000 m view is the whole 9 km area; the terrain there is noisy in every drawing (more than 0.3 % of pixels change by more than 6 levels), and the sharpened ones are not worse.

### 8. Is steep-patch refinement needed?

Refinement means 10 m triangles inside steep zones. The pictures that bear on it:
- `short-faces.jpg`: a 78 m face at Katoomba (top) and a 58 m face at Tomah (bottom), from 520 m, as today, with the sharpened mesh (mesh-lit), and with the whole 10 m terrain as the mesh (what refinement would give). The 78 m face on the 22 m mesh is a steep rounded bank with a soft lip and a visible foot line. On the 10 m mesh it has a crisp lip and a distinct foot, and reads as a wall. The 58 m face is a green-tinted terraced bank on the 22 m mesh and a more distinct one on the 10 m mesh; neither reads as rock.
- `grose-refine.jpg`: the long benched face at Grose, 900 m. The 10 m mesh adds small dark pockets and ragged ledges; the wall itself, its lip and its foot are the same as on the 22 m mesh.
- `katoomba-reference-10m.jpg`: for a 188 m face at 1100 m the 22 m mesh and the 10 m mesh are almost the same picture.

What refinement costs (section 7b of the test: quads whose footprint has 45 degrees or more in the sharpened terrain, plus a margin of one quad, each replaced by 10 m cells):

| Site | High: flagged quads | High: extra triangles (total) | Low: extra triangles (total) |
|---|---|---|---|
| Katoomba | 9.6 % | +124,000 (443,000) | +212,000 (312,000) |
| Kanangra | 20.3 % | +264,000 (582,000) | +425,000 (525,000) |
| Grose | 16.7 % | +216,000 (535,000) | +365,000 (464,000) |
| Tomah | 23.8 % | +310,000 (628,000) | +521,000 (620,000) |

With the 55 degree flag instead of 45 the extras at High are +95,000 (Katoomba) to +194,000 (Tomah). The plan estimates +50,000 to +150,000 "at the cliffiest sites"; the count is 1.6 to 2 times that at three of the four sites, and Low gains the most in relative terms (the plan says High and Medium only). The count does not include the stitching between 10 m and 22 m triangles, which is where cracks would come from. Medium is in the test output.

**My call: do not build it for 0.3.0.**
1. Tall faces, the ones a person looks at, do not need it once they are sharpened: at 1100 m the 22 m mesh is as good as the 10 m one.
2. Faces of 60 to 80 m gain a crisp lip, but visibly only within about 600 m, and what they lack there is rock detail, which refinement does not give.
3. Faces under 60 m are 30 to 55 % of the lips at Kanangra and Tomah (section 3); they are not walls with or without refinement.
4. The cost is more than the plan estimated, it cannot be judged against the frame budget without a phone, and its stitching is unbuilt.

Revisit when the phone check-list (item 7) says short faces look wrong, and then try the cheapest form: High only, quads with 55 degrees or more.

### 9. The acceptance numbers of 9d.6, on the plan's rule (R0)

| Number | Katoomba | Kanangra | Grose | Tomah | Met |
|---|---|---|---|---|---|
| High mesh edges over 70 degrees, at least 0.3 % | 0.60 | 0.47 | 0.87 | 0.31 | yes, Tomah by 0.01 |
| steepest High edge at least 79 degrees | 83.5 | 85.3 | 85.4 | 79.2 | yes, Tomah by 0.2 |
| no tower or pit of 10 m or more in the sharpened terrain | 0, 0 | 0, 0 | 0, 0 | 0, 0 | yes |
| drainage overlap at least 0.85 | 0.92 | 0.94 | 0.86 | 0.91 | yes, Grose by 0.01 |
| sharpening at most 400 ms on the phone `[est]` | 26 to 39 ms in node, about 80 to 100 ms cold in Chromium | | | | probably (section 7) |
| (not in the plan) no tower or pit of 10 m or more in the drawn mesh | 13 | 12 | 20 | 1 | no, without a mesh despike |

They were taken from the same prototype, so they reproduce by construction, and Tomah is at the limit on two of them: nothing weaker than R0 passes at Tomah. They measure the mesh's edges, not the look. The drawing that fails visibly (the plan's serration) passes all of them.

### 10. The fallback ladder

Per-site numbers; the test prints more columns and the "alone" variants. "Acceptance" = High edges over 70 degrees at least 0.3 % (9d.6).

| Site | Rung | Steepest slope (deg) | Area over 70 deg (%) | High edges over 70 deg (%) | Low edges over 70 deg (%) | Drainage overlap | Cells moved | Mean move (m) | Spikes of 5 m or more | Faces with a bench below | Acceptance (0.3 %) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| katoomba | data (no sharpening) | 83.2 | 0.52 | 0.12 | 0.02 |  |  |  | 1 | 6 % |  |
|  | strength 0.6 alone | 84.1 | 0.87 | 0.49 | 0.31 | 0.97 | 30691 | 11.8 | 36 | 8 % | yes |
| kanangra | data (no sharpening) | 82.8 | 0.16 | 0.02 | 0.01 |  |  |  | 0 | 12 % |  |
|  | strength 0.6 alone | 85.0 | 0.68 | 0.29 | 0.11 | 0.97 | 46582 | 8.3 | 50 | 9 % | NO |
| grose | data (no sharpening) | 84.0 | 1.09 | 0.44 | 0.25 |  |  |  | 3 | 8 % |  |
|  | strength 0.6 alone | 85.2 | 1.24 | 0.73 | 0.75 | 0.93 | 46484 | 13.0 | 57 | 9 % | yes |
| tomah | data (no sharpening) | 73.5 | 0.02 | 0.00 | 0.00 |  |  |  | 3 | 9 % |  |
|  | strength 0.6 alone | 79.1 | 0.48 | 0.13 | 0.00 | 0.96 | 46080 | 6.1 | 3 | 6 % | NO |

With the plan's lighting the rungs R0 and R1 are serrated, R2 is less so and R3 is clean but close to today's look (`katoomba-ladder.jpg`, top row). With the mesh's slope every rung is clean (bottom row). So **R0 is the weakest rung that is needed once the lighting is fixed**: no rung of the ladder is a remedy for the serration, because the cause is the lighting. If the plan's lighting were kept, only R3 would be clean, and R3 fails the acceptance numbers at three sites (Katoomba 0.21, Kanangra 0.05, Tomah 0.01 against 0.3). R1 fails at Tomah only (0.22). Strength 0.6 (not on the plan's ladder) gives 0.49, 0.29, 0.73 and 0.13: it fails at Kanangra and Tomah.

## Verdict

**Does it look like rock walls?** Partly.
- Tall faces (Katoomba 188 m, Kanangra 161 m, Grose 176 m) at High, with the plan's sharpening and edge-keeping mesh and with the lighting fixed (section 5), read as straight, steep walls with a crisp lip and foot, from 450 m to 8 km. The best picture of the set is the 3 km view of Katoomba (`katoomba-wide-high.jpg`): a vertical cliff band where today there is a rounded curtain. The wall comes from the geometry (`katoomba-facets.jpg`).
- They do not yet read as rock. At 450 m and at eye level the wall is a plain striped sheet, the photo smears down it, and the 22 m triangles show as kinked stripes and a low-poly silhouette. Ledges, joints, stains and scree are the rock detail of 9d.3.5, which this spike did not include. The sharpening only supplies the wall for that detail to sit on.
- At Low (a 40 m mesh) a tall face is a steep rounded wall, softer than at High: its steepest edge is at most 78 degrees (188 m over 40 m).
- Faces under about 80 m (all of Tomah, parts of Katoomba and Kanangra) read as steep terraced banks on every tier. A 60 m face has edges of at most 69 degrees on the High mesh. That is the mesh's limit, as the plan says.

**Is the plan's rule sound?**
- *Sharpening (9d.3.1): yes.* It reproduces the plan's numbers to the printed digit, takes 28 to 32 ms in node (the plan expected under 150 ms) and about 68 ms cold in Chromium, is deterministic and bounded, and leaves no tower or pit of 10 m. It keeps gullies as slots (drainage overlap 0.86 to 0.94). No steep cell of the drawn terrain is more than 2 cells (20 m) from a steep cell of the data, and 96 % are in the data's own steep zone, so the 30 m allowance for lip and foot drift in 9d.3.7 is not used by the terrain (the 22 m or 40 m mesh adds its own quantisation on top). Its side effect is terracing: two to three times as many faces with a bench below them.
- *Edge-keeping mesh (9d.3.2): yes, with one addition.* It is bit-identical to `decimateGrid` below 40 degrees, costs no triangles, and stays within 1 degree of the best any mesh can do across a step (4 degrees in the worst phase at 40 m). It creates single-vertex spikes (up to 44 m) that a despike on the mesh removes. Cold, it takes 2.5 times as long as `decimateGrid` (61 ms against 24).
- *Lighting from the 10 m terrain (9d.3.3): the normals yes, the slope no.* The 10 m terrain should light the faces but should not choose their colour. As written it gives serrated lips and feet, worst at Low, because the 10 m `slope` that picks banded rock or photo disagrees with a 22 or 40 m triangle by up to one vertex spacing. The 10 m normals alone are clean and give the relief.
- *The acceptance numbers of 9d.6* reproduce, but they were taken from this prototype and they measure mesh edges, not the look. The serrated drawing passes all of them.

**What must change in the plan**
1. 9d.3.3: keep the 10 m gradient texture for the normal, and take the slope that picks strata and photo from the mesh (the gradient `lightTerrain` already computes for the hillshade; 400 x 400 RG16F, or a per-vertex attribute). Build the rock mask R of 9d.3.4 so that it agrees with the mesh too (inference, untested).
2. 9d.3.2: add a despike pass to the finished mesh (10 m at High and Medium, 18 m at Low, 2 m margin; tested).
3. 9d.6: the 40 m mesh test across a 150 m step should ask for 72 degrees, not 75 (75.0 is the ideal; the worst phase gives 72.7). Add a mesh-spike check. Treat "edges over 70 degrees" as a necessary check only: a serrated drawing passes it. The e2e edge-contrast check is weak too (section 9: edge strength rises 4 to 15 % in orbit views and not at eye level).
4. Section 11 and 9d.3: the 100 ms decimation budget is not met by the prototype (61 ms cold on this desktop). Budget it on the phone at a few hundred ms or optimise it. Add the lighting texture's cost (74 ms here) to the CPU line, and its 3.2 MB (plus 0.64 MB for the mesh gradient) to the GPU line.
5. 9d.3.3 and 9d.3.5: the photo smear survives sharpening and is more visible at hard lips. The photo-by-mask blend of 9d.3.5 is needed, not optional.
6. The refinement estimate: +124,000 to +310,000 triangles at High, not +50,000 to +150,000.

## Recommendation

| Item | Plan | Recommended | Evidence |
|---|---|---|---|
| Sharpening gate | smoothstep(48, 62) degrees | the same | R1 (52 to 66) fails the Tomah acceptance number (0.22 against 0.3) |
| Spread to neighbours | 0.6 | 0.6 | not varied |
| Window along the fall line | 3 cells | 3 cells | a one-cell window fails Kanangra (0.18) and Tomah (0.07) |
| Dead band | 0.5 m | 0.5 m | not varied |
| Strength (new knob) | 1 | 1; 0.6 if terracing is judged wrong on the phone | 0.6 brings the bench share back to the data's 6 to 9 % and costs steepness (Kanangra 0.29, Tomah 0.13) |
| Terrain despike | 10 m, 2 m margin | the same (5 m is also cheap: 12 to 194 cells touched) | no 10 m spike left; 5 to 9.9 m ones remain (12 to 108 per site) and I saw none in a picture |
| Mesh blend | smoothstep(40, 55) degrees | the same | not varied |
| Mesh despike (new) | none | 10 m at High and Medium, 18 m at Low, 2 m margin | removes every 10 m vertex spike at High; edge statistics unchanged |
| Normal for lighting | 10 m sharpened gradient | the same | gives the relief (`no-photo-sun.jpg`) |
| Slope for strata and photo switch | the same texture | the mesh's gradient | the artifacts follow the slope (`lighting-sources.jpg`) |
| Steep-patch refinement | build only if S5 shows it is needed | **do not build for 0.3.0** | section 8 |
| Fallback rung | ladder | **none: R0, the plan's rule** | with the mesh's slope every rung is clean, so no rung is needed |

The lane can start from `prototype.patch` (not reviewed code). `cliffSharpen.ts` is close to final. `decimateTerrain` wants the mesh despike and a cheaper footprint scan. The two lighting textures are in `terrainLayer.ts` (`uGrad`, `uGradS`, `uSplit`). The SceneView options and the harness methods are scaffolding and should not ship.

## Limits

- **Software rendering.** The pictures come from Chromium with SwiftShader (a CPU rasteriser behind ANGLE). It runs the same shaders, so geometry and lighting artifacts show, but filtering, precision and anti-aliasing differ from a phone GPU, and frame times mean nothing. I report no frame rate.
- **Timings are from a desktop.** Node and desktop Chromium on 4 cores, quiet for the final numbers (load average 0.3 to 1); the browser timings are four cases of three cold loads. The phone factor is not measured. The plan's own ratio is 2.7 (150 ms to 400 ms); I use 2.7 and 5 where I give phone figures, and mark them `[guess]`.
- **A synthetic fire and a synthetic fuel map.** The harness fabricates fuel from the bundled canopy (`fabricateFuel`) and the fire has not started in these pictures. Rock tint, strata, trees and the photo are the app's own, but the albedo is not a real scenario build.
- **Not the plan's rock detail.** There is no rock mask, no ledges, joints, overhang bands, stains, scree, tree removal from faces or photo-by-mask blending (9d.3.4 to 9d.3.6). The faces here are today's strata and rock tint on a steeper mesh. So the question "does it read as rock" is only half answered: this spike answers "does it read as a wall, and does the geometry hold up".
- **Nobody looked at it on a phone, and I am one reviewer.** I looked at 412 x 915 frames at device scale 1. A phone shows the same scene at 2.5 to 3 times the pixel density, where fine serration is more visible and stripes shimmer differently.
- **Four faces and a few extra ones.** One sheer face per site (chosen from the data by drop and run, not by look), plus a long benched face at Grose and two short faces. One sun position (13:00, 21 December) for the main set and 17:00 for two no-photo frames; no night, no vertical exaggeration, no Medium tier in the pictures.
- **Split and mesh-lit lighting are mine, not the plan's.** I tried them after the plan's lighting failed. They have had one reviewer and no phone. Split paints 10 m relief on a 22 or 40 m mesh; I have only seen still frames, and under camera motion that relief will not move with parallax.
- **The 10 m mesh is a stand-in for steep-patch refinement.** It draws the whole terrain at 10 m (1.6 million triangles). A real refinement draws 10 m triangles only in steep zones and needs crack-free stitching, which I did not build. The triangle counts for it are arithmetic, not a measured build.
- **Shimmer** was measured with a half-pixel camera move and a luminance difference. That finds texture flicker but not every kind of temporal artifact (popping, swimming under a long camera move).
- **The harness is not the app.** The app builds `terrainHiRes` and the fire grid from its own scenario build; I rebuilt them the same way with `fireTerrainFromHiRes` and the harness's synthetic fuel. Anything the app does after `setScenario` (the first frames, adaptive pixel ratio) is not in these numbers.

## How to reproduce

The numbers (about two minutes; no browser):

```
FIRESIM_SPIKE=1 nice -n 8 npx vitest run tests/spikes/cliffSharpen.spike.test.ts
# FIRESIM_SPIKE_OUT=<file> also writes the report; FIRESIM_SPIKE_REPS=7 sets the timed repetitions
```

Without `FIRESIM_SPIKE=1` the file is skipped, so `npm test` is unaffected. `npx tsc --noEmit -p .` passes with it.

The pictures need the prototype. From a checkout of `ca8e637` (or any tree where the patch applies):

```
git worktree add ../s5 ca8e637 && cd ../s5          # node_modules: npm ci, or link the main checkout's
git apply <repo>/docs/plans/spikes/S5-cliff-look/prototype.patch
nice -n 8 npx vite --port 4305 --strictPort &
# run the script from a tree that has @playwright/test and Chromium at /opt/pw-browsers/chromium (set CHROMIUM=... otherwise)
PORT=4305 node <repo>/docs/plans/spikes/S5-cliff-look/shoot.mjs shots       # the 20 JPEG composites (about 25 minutes under load)
PORT=4305 node <repo>/docs/plans/spikes/S5-cliff-look/shoot.mjs shimmer     # frame-pair flicker numbers (SITES, VIEWS, PANELS select)
PORT=4305 node <repo>/docs/plans/spikes/S5-cliff-look/shoot.mjs timing      # setScenario stage times in the browser (RUNS, SITES, PANELS)
PORT=4305 RAW=/tmp/s5raw node <repo>/docs/plans/spikes/S5-cliff-look/shoot.mjs raw   # every panel as a full-size PNG; `shots` then reuses them
```

A single picture by hand: `http://localhost:4305/src/render/dev.html?site=katoomba&hires=1&sharpen=1&mesh=keep&light=n10s-mesh&cam=2505,-1995,1100,206,66&hud=0&marks=0&wind=off&smoke=0&flames=0&embers=0&t=0`. Add `&sharpen=0&mesh=old&light=0` for today's drawing.

## Files

- `README.md`: this note.
- `prototype.patch`: `git diff ca8e637 -- src` of the worktree. A throwaway starting point for the lane, not reviewed code. It adds `src/render/cliffSharpen.ts` (+ test), `decimateTerrain` and `hybridGradient` in `src/render/fields.ts` (+ tests), the lighting-gradient sources and a flat-shading switch in `src/render/terrainLayer.ts`, the options, timings and harness methods in `src/render/SceneView.ts`, one flag in `src/render/cameraRig.ts`, and the URL flags in `src/render/dev.ts`. It also contains a `light=n10s-min` variant (the smaller of the 10 m slope and the mesh slope), added at the very end and not evaluated.
- `shoot.mjs`: the screenshot, flicker and timing script.
- `shots/`: the 20 pictures this note refers to (JPEG, quality 80).
- `tests/spikes/cliffSharpen.spike.test.ts`: the measuring harness (gated by `FIRESIM_SPIKE=1`; self-contained; holds the prototype functions and the plan's probe).
- `results.txt`: the raw report of the numbers harness (the run the tables of sections 1 to 3 and 7 to 10 come from).
