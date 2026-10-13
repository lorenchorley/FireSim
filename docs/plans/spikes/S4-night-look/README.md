# S4: night map lighting (Realistic, Brighter, Daylight)

Spike S4 of [the plan](../../air-slice-wind-detail-honest-speed.md), section 10 (M0), for workstream F (section 9b). Nothing in the app was changed. The prototype was built and measured in a scratch git worktree (branch `spike/s4-night`, local, never pushed) and is kept as [`prototype.patch`](prototype.patch): **a throwaway starting point for the lane, not reviewed code.** Everything below was measured on commit `ca8e637` (release 0.2.2 plus the M0 contracts commit) with Node 22.22.2, Vite 8.3.1, three.js 0.186.1 and Chromium 141 with SwiftShader (software GL), in the render harness `src/render/dev.html`, 412 x 915 px, device scale 1.

"Luma" is 0.2126 R + 0.7152 G + 0.0722 B of the 8-bit sRGB values of a screenshot (0 to 255), the number the lane's e2e test can compute from a `fast-png` decode. "L*" is CIE lightness of a mean luma. "Realistic", "Brighter" and "Daylight" are the three looks. A number marked [guess] was not measured. Every table below is printed by `node docs/plans/spikes/S4-night-look/shoot.mjs tables <section>` (the section is named in each caption; see "How to reproduce").

## Summary

1. **The design is sound in structure, and it works as built in the real renderer.** The shared uniforms the map shaders read carry a blended "map lighting", `uNight` stays the real night, a new `uMapNight` serves the sites that dim the map, and the sky dome and the smoke have their own sets. Measured: by day, and with the sun at +8 degrees or more, all three looks are pixel-identical (18 frames, 9 per site: three cameras at three times; 0 differing pixels); Realistic is pixel-identical to an unpatched HEAD in 32 of 33 frames (11 clock states, three cameras, places layers on, embers off), and differs in 86 of 377,000 pixels in the 33rd (section `head`, Cost and safety); the sky region is identical between looks (0 differing pixels) at night, at dusk and by day; draw calls (17), triangles (418,990), programs (11), geometries (17) and textures (14) do not change between looks; a look change creates nothing and takes 0.007 ms (`setNightLook` alone); the console stayed empty in the `head` and `cost` runs. The plan's own acceptance points hold, and the fire stands out in Daylight about as well as it does by day (point 5).
2. **The lighting maths in 9b.3 needs corrections, and its plumbing needs two additions.** In order of how much they matter:
   - **Direction blend.** Blending the sun direction as plain vectors by `w` makes Brighter's light swing with the real sun's azimuth all night. The real sun is below the horizon with no light, but its direction still gets weight `1 - w`. From 02:00 to 04:00 Brighter's ground contrast (std of luma on neutral grey) is 11.3 against 16.0 at 21:30; with the light-weighted blend it stays at 17.2. Weight each direction by the light it carries instead: then every look is lit from the fixed sun all night. (`night` section, shot 14.)
   - **Smoke body.** The plan's table puts `smokeLayer.ts:60,78` under map lighting. That turns the plume into a pale cloud in a night sky and cuts the fire's contrast by 0.01 to 0.05 (Michelson) with 2 to 5 times the bright clutter. Keep the smoke body on the real lighting (it needs its own five uniforms). (`fire` section, shot 08.)
   - **Cast shadows.** They follow the real sun and switch off below +0.5 degrees. With the blend that gives a step of 4.2 luma levels in the Daylight ground at +0.5 degrees, and shadows from the setting sun on a map lit from the north-west. Scale them by `1 - w`: the step falls to 0.8. One new uniform (`uShadowGain`) and one shader line. (`shadow` section, shot 13.)
   - **Light blend.** Colour and intensity blended separately make the sun's light (their product) go with `w` squared when the real sun is black at night: Brighter gets a quarter of Daylight's sun, not half. Blend colour times intensity instead. At matched brightness the picture barely changes (relief 0.270 against 0.276 of mean at Katoomba, 0.184 against 0.168 at Thredbo), so this is a correctness fix, and it moves the Brighter mix from 0.55 to 0.3. (`brighter` section.)
   - **Signature.** `mapLighting(real, look, sunElevation)` cannot blend the direction: `SkyLighting` has no azimuth. Pass the real sun's world direction; the elevation is already `real.sunElevation`.
3. **Constants** (details in Findings):

   | Constant | Plan | Recommended | Why |
   | --- | --- | --- | --- |
   | Brighter mix `m` | 0.55 | **0.3** (with the product blend; 0.55 stays right only with the plan's blend) | Brighter sits 58 % / 62 % of the way from Realistic to Daylight in lightness (Katoomba / Thredbo); the plan's own 0.55 sits at 56 % / 59 % |
   | Daylight mix | 1 | 1 | |
   | Fade window | 8 to -2 deg | 8 to -2 deg | smooth, monotone, identical at 8 deg and above |
   | Fixed sun azimuth | 315 deg | 315 deg | best of 8 at both sites |
   | Fixed sun elevation | 40 deg | **30 deg** (judgement call, see (c)) | +11 % / +25 % ground contrast on Plain and fuel-colour maps, no change on the photo map, 9 to 13 % darker |
   | Fog density | x (1 - w) | **unchanged** | the dark fog takes 15 % off the far band at most; the cut is not needed |
   | Smoke body | map lighting | **real lighting** | fire contrast, clutter |
   | Cast shadows | real sun | real sun x (1 - w) | step at +0.5 deg |
   | Exposure | blended | blended | flames are 10 to 30 % less bright-orange area in Daylight; accepted, folding it in is optional |

4. **Numbers for the lane's e2e test** (Katoomba, standard view, 22:00; mean luma of the ground region / sky region): Realistic 10.0 / 33.8, Brighter 36.5 / 33.8, Daylight 54.9 / 33.8. Thredbo: 17.0 / 34.2, 57.0 / 34.2, 83.6 / 34.2. The sky region has 0 differing pixels between looks. Full table and suggested assertions under "Luminance table".
5. **The fire stands out in Daylight as it does by day.** Michelson contrast of the bright-orange pixels against the rest of the frame, six views: Daylight 0.37 to 0.48 (Katoomba) and 0.25 to 0.37 (Thredbo), by day 0.35 to 0.45 and 0.17 to 0.27, Realistic at night 0.52 to 0.74 and 0.65 to 0.71. Daylight loses the night advantage on purpose, which is why D13 keeps Realistic as the default. With every plan setting the contrast is 0.02 to 0.07 lower and falls just under the day value in 2 of 6 views.
6. **Audit of the plan's shader table.** Every `uNight`, `uExposure`, `uSunI` and `uAmbI` site in the table is real and correctly placed, apart from the smoke body (point 2). The table misses the cast-shadow term (`terrainLayer.ts:205`) and does not say that `uExposure` has three jobs (surface light, emissive tone mapping, fog colour). The shared-uniform contract test (`vegetationLayer.test.ts`) needs `uMapNight` in its helper.

## Question

After dark the 3-D map's ground, photo, trees and roads are dimmed and tinted blue, so relief is hard to read (plan 9b.2). Workstream F adds Layers, Map type, **Night lighting**: Realistic (today, the default), Brighter and Daylight. They blend the map's lighting toward a fixed north-west sun while the sky, stars and the fire's glow keep following the clock. The plan (9b.3) says the numbers are "tuned in spike S4", which also "checks that the fire still stands out in Daylight, since judging fires at night is a training point". S4 prototypes the design in the real renderer, tunes the numbers with screenshots and measured luminance, and says whether the plan's design is sound.

## Method

- **Prototype** (`prototype.patch`, about 300 changed lines in 11 files under `src/render`, plus a 130-line unit test file). `mapLighting` in `sky.ts`; `SceneView.setNightLook` and `applyLighting`; own sun and exposure uniforms for the sky dome; own lighting uniforms for the smoke body; `uMapNight` in the road, house, label and tree shaders; `uShadowGain` in the terrain shader; harness parameters. Every constant lives in the object `MAP_LOOK` in `sky.ts`, with an override from the URL, so each option can be switched without a rebuild (`nlMix nlHigh nlLow nlAz nlEl nlFog nlExp nlSmoke nlShadow nlDir nlBlend`, listed in the header of `dev.ts`). The defaults are the recommended values. The plan as written is `nlMix=0.55&nlEl=40&nlFog=1&nlSmoke=1&nlShadow=0&nlDir=vector&nlBlend=separate`. `nightLook=realistic|brighter|daylight` picks the look; `start=22` is 22:00 on the harness's day (21 December 2019, AEDT); `startMin`, `plain=1` and `quality` are also read.
- **Reproducible frames.** `shoot.mjs` stops the harness's render loop, freezes `performance.now`, re-reads the synthetic fire's snapshot, and renders each frame with three `renderNow()` calls (so the canopy is settled) before reading the canvas as PNG. Two renders of the same state differ by at most 1 pixel of 377,000. Frames of one look are compared with frames of another in the same page: the camera, the fire, the embers and the smoke are the same.
- **Sites and views.** Katoomba (steep sandstone escarpment, the fire runs up the slope) and Thredbo (gentler alpine valley with a town). "Standard view": the harness's default framing (target and distance of the fire) with the camera at azimuth 200 and tilt 72, which leaves a band of sky. "Default view": the same at tilt 58. "Close" and "front" views: 1500 m and 800 m from the fire front. Relief views: camera azimuth 45, 135, 225 and 315 at tilt 58 and the plan view. The sun's elevation at dusk and dawn comes from the renderer's own `solarPosition`.
- **Regions** (fractions of the frame): ground `[0.04, 0.70, 0.96, 0.97]`, sky `[0.03, 0.015, 0.45, 0.10]` (shot 04 draws them).
- **Metrics.** Mean luma of a region. Relief: the standard deviation of luma over the ground with the neutral grey map type, no trees, roads or fire (so only light shapes it); "std/mean" divides by the mean luma. Fire: pixels with R >= 200 and R - B >= 90 below the top quarter are "fire"; Michelson = (Lfire - Lbg) / (Lfire + Lbg) with Lbg the mean luma of all other pixels there; "clutter" is the share of non-fire pixels with luma above 110. These are heuristics, not a perception test.
- **Cross-checks.** The luminance table was recomputed with Python PIL (`python3 -I`) from the same frames: the means agree to 0.05 or better. Realistic was compared with an unpatched HEAD served from `git archive` on another port.

## Findings

### Luminance table (the e2e thresholds)

Section `luminance`. Standard view, 22:00 (night), sun at +4 and -2 degrees (dusk), 13:00 (day).

```
ground region [0.04,0.7,0.96,0.97], sky region [0.03,0.015,0.45,0.1] (fractions of the 412 x 915 frame)

katoomba: look           night 22:00    dusk el +4    dusk el -2     day 13:00   (ground / sky)
katoomba  realistic     10.0 / 33.8   40.5 /162.2   25.5 /125.4   67.8 /178.9
katoomba  brighter      36.5 / 33.8   43.3 /162.2   39.3 /125.4   67.8 /178.9
katoomba  daylight      54.9 / 33.8   49.5 /162.2   59.4 /125.4   67.8 /178.9
repeat of Realistic at night differs from the first by 1 pixels (noise floor of the method)
  night 22:00  sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 254119 / 254286; sha1 b94be3811f 8b4edda8f1 a8e5a3406a
  dusk el +4   sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 247142 / 252914; sha1 fd779f0261 7b207a1182 7e2d203752
  dusk el -2   sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 253554 / 254243; sha1 adfd189f54 0704f0976b 9330e50842
  day 13:00    sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 0 / 0; sha1 eadcd11769 eadcd11769 eadcd11769
katoomba: 9 day or sun >= +8 deg frames (3 cameras x 3 times), pixels that differ between Realistic and Brighter or Daylight: 0

thredbo: look           night 22:00    dusk el +4    dusk el -2     day 13:00   (ground / sky)
thredbo   realistic     17.0 / 34.2   45.2 /165.8   25.6 /124.0   94.0 /185.3
thredbo   brighter      57.0 / 34.2   50.3 /165.8   51.7 /124.0   94.0 /185.3
thredbo   daylight      83.6 / 34.2   61.5 /165.8   84.4 /124.0   94.0 /185.3
repeat of Realistic at night differs from the first by 0 pixels (noise floor of the method)
  night 22:00  sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 277857 / 277901; sha1 35d7b56c8c 8b755f30f6 1665da41f2
  dusk el +4   sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 277299 / 277829; sha1 2b872c880d 8fa6a882bd 6d744bb9ce
  dusk el -2   sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 277851 / 277898; sha1 98d1f1ed9b 6fb2f3d3ea 9577646884
  day 13:00    sky region differs between looks by 0 / 0 pixels (Brighter / Daylight vs Realistic); whole frame 0 / 0; sha1 47b556dc18 47b556dc18 47b556dc18
thredbo: 9 day or sun >= +8 deg frames (3 cameras x 3 times), pixels that differ between Realistic and Brighter or Daylight: 0
```

Suggested assertions for the lane's e2e test, relative so a different camera or site still works (re-measure in the app's own view; the thresholds are half of the smallest measured gap):

| Check | Measured here | Suggested assertion |
| --- | --- | --- |
| Ground rises Realistic < Brighter < Daylight at night | Katoomba 10.0, 36.5, 54.9 (gaps 26.5 and 18.4); Thredbo 17.0, 57.0, 83.6 (gaps 40.0 and 26.6) | `B - R >= 12` and `D - B >= 9` luma levels |
| Sky region does not change | 0 differing pixels in all three looks, night, dusk and day; mean 33.75 and 34.18 | each look's sky mean within 0.5 of Realistic's (or 0 differing pixels) |
| No sun disc | looking NW and up 32 degrees from eye level, region [0, 0, 1, 0.55]: mean luma 20.90 / 20.82 / 20.81 (Realistic / Brighter / Daylight); 90.39 with the sky sharing the map sun. Pixels do differ (43,259 and 69,625 of 207,236) because the region also holds the lit hills at its foot (shot 12); the sky itself looks the same | the region's mean luma within 0.5 of Realistic's (the bug lifts it by 70), or a region that holds only sky. The standard orbit camera cannot see the disc (it is 30 degrees up and the view tops out near 5 to 20 degrees), only the exposure half of the bug shows there (sky mean 25.30 against 33.75, all 13,494 pixels differ) |
| By day nothing changes | 0 pixels | whole frame identical, or a luma difference under 0.5 |
| Dusk, sun at -2 degrees | ground R/B/D 25.5 / 39.3 / 59.4 (Katoomba), 25.6 / 51.7 / 84.4 (Thredbo) | `D - R >= 15` |

### Answers to (a) to (g)

**(a) Is m = 0.55 a good Brighter?** As the plan blends it, yes. With colour and intensity blended separately, the direction blended as vectors by `w` and the sun at 40 degrees, m = 0.55 gives a night ground luma of 37.9 (Katoomba) and 57.1 (Thredbo): 3.7 and 3.4 times Realistic's, and 65 % of Daylight's (58.6 and 87.8 with the plan's sun). In lightness (L*) it sits 56 % and 59 % of the way from Realistic to Daylight, so the three looks are close to evenly spaced (shots 01 and 02). With the sun's light blended as colour times intensity (correction 4 below) the same step is **m = 0.3** (58 % and 62 %); m = 0.25 is the exact middle (51 % and 56 %). The setting is not touchy: from m = 0.25 to 0.4 the position moves from 0.51 to 0.68 at Katoomba. Section `brighter`:

```
katoomba: Realistic luma 10.2 L* 2.8   Daylight luma 54.3 L* 22.8   (recommended settings)
   corrected blend, m = 0.2           luma  30.4  L*  11.5  pos 0.44  std 8.5  std/mean 0.279
   corrected blend, m = 0.25          luma  33.5  L*  13.0  pos 0.51  std 9.2  std/mean 0.274
   corrected blend, m = 0.3           luma  36.2  L*  14.3  pos 0.58  std 9.8  std/mean 0.270
   corrected blend, m = 0.35          luma  38.5  L*  15.4  pos 0.63  std 10.3  std/mean 0.266
   corrected blend, m = 0.4           luma  40.7  L*  16.5  pos 0.68  std 10.8  std/mean 0.264
   corrected blend, m = 0.5           luma  44.4  L*  18.2  pos 0.77  std 11.5  std/mean 0.260
   corrected blend, m = 0.55          luma  45.9  L*  18.9  pos 0.81  std 11.9  std/mean 0.259
   plan as written: Daylight luma 58.6 L* 24.7
   plan blend, m = 0.45                  luma  32.0  L*  12.3  pos 0.43  std 9.2  std/mean 0.288
   plan blend, m = 0.5                   luma  35.0  L*  13.7  pos 0.50  std 9.9  std/mean 0.282
   plan blend, m = 0.55                  luma  37.9  L*  15.1  pos 0.56  std 10.5  std/mean 0.276
   plan blend, m = 0.6                   luma  40.7  L*  16.5  pos 0.62  std 11.0  std/mean 0.270
thredbo: Realistic luma 17.0 L* 5.1   Daylight luma 83.0 L* 35.3   (recommended settings)
   corrected blend, m = 0.2           luma  48.2  L*  20.0  pos 0.49  std 9.1  std/mean 0.188
   corrected blend, m = 0.25          luma  52.7  L*  22.0  pos 0.56  std 9.8  std/mean 0.186
   corrected blend, m = 0.3           luma  56.6  L*  23.8  pos 0.62  std 10.4  std/mean 0.184
   corrected blend, m = 0.35          luma  60.1  L*  25.3  pos 0.67  std 11.0  std/mean 0.183
   corrected blend, m = 0.4           luma  63.2  L*  26.7  pos 0.72  std 11.5  std/mean 0.182
   corrected blend, m = 0.5           luma  68.4  L*  29.0  pos 0.79  std 12.3  std/mean 0.180
   corrected blend, m = 0.55          luma  70.7  L*  30.0  pos 0.83  std 12.7  std/mean 0.180
   plan as written: Daylight luma 87.8 L* 37.3
   plan blend, m = 0.45                  luma  48.7  L*  20.2  pos 0.47  std 8.3  std/mean 0.171
   plan blend, m = 0.5                   luma  52.9  L*  22.1  pos 0.53  std 9.0  std/mean 0.169
   plan blend, m = 0.55                  luma  57.1  L*  24.0  pos 0.59  std 9.6  std/mean 0.168
   plan blend, m = 0.6                   luma  61.2  L*  25.8  pos 0.64  std 10.2  std/mean 0.167
```

**(b) Is the fade from 8 to -2 degrees good?** Yes. With the sun at +8 degrees or more nothing changes (0 differing pixels in the standard view, and in the day frames at three cameras). Below +8 the weight rises smoothly: Daylight 0.10 at +6, 0.35 at +4, 0.65 at +2, 0.90 at 0 and 1.00 at -2; Brighter is 0.3 of that. The lighting numbers are continuous and monotone (unit test, 0.1 degree steps). The Daylight ground luma goes 47.4 (+8), 49.4 (+4), 58.4 (0), 59.3 (-2) with no step and no dip, while Realistic falls from 47.4 to 25.5 at -2 and 11.8 at -12. Brighter holds near 40 through dusk (47.4, 43.2, 41.7, 39.2). Daylight has fully taken over when the real map becomes too dark to read, and at +4 degrees (about 25 minutes before sunset on 21 December) the change is only just visible (shot 03). Dawn behaves the same (ground luma 46.0, 49.4, 56.1, 59.3 at +8, +4, +1, -2). One flaw, found by sweeping finely: the cast shadows switch off at +0.5 degrees, a step of 4.2 luma levels in Daylight (correction 3). Section `fade` (dusk rows; the last column says the frame is pixel-identical to Realistic):

```
el(deg) clock   w(B)  w(D)  sunI R/B/D          ambI R/B/D          exposure R/B/D    ground R / B / D        sky R / B / D     frame identical to Realistic
   10   19:11  0.00  0.00  1.00/1.00/1.00   0.44/0.44/0.44   1.00/1.00/1.00    51.1  51.1  51.1   181.2 181.2 181.2   yes (pixel-identical)
    8   19:21  0.00  0.00  0.89/0.89/0.89   0.43/0.43/0.43   1.00/1.00/1.00    47.4  47.4  47.4   174.8 174.8 174.8   yes (pixel-identical)
    6   19:32  0.03  0.10  0.77/0.79/0.83   0.41/0.41/0.42   1.00/1.00/1.00    43.9  44.6  46.3   168.5 168.5 168.5   no
    4   19:43  0.11  0.35  0.66/0.73/0.89   0.40/0.40/0.42   1.00/1.00/1.00    40.5  43.2  49.4   162.2 162.2 162.2   no
    2   19:54  0.19  0.65  0.55/0.70/1.04   0.38/0.40/0.44   1.00/1.00/1.00    37.2  42.9  54.4   155.8 155.8 155.8   no
    1   20:00  0.24  0.78  0.46/0.65/1.12   0.37/0.39/0.46   1.00/1.00/1.00    34.3  41.6  56.2   148.3 148.3 148.3   no
  0.6   20:03  0.25  0.83  0.42/0.64/1.15   0.36/0.39/0.46   1.00/1.00/1.00    33.1  41.1  56.9   145.4 145.4 145.4   no
  0.4   20:04  0.26  0.85  0.40/0.63/1.17   0.36/0.39/0.46   1.00/1.00/1.00    32.7  42.1  57.9   143.9 143.9 143.9   no
    0   20:07  0.27  0.90  0.36/0.61/1.20   0.36/0.39/0.47   1.00/1.00/1.00    31.4  41.7  58.4   140.4 140.4 140.4   no
   -2   20:15  0.30  1.00  0.17/0.51/1.30   0.33/0.38/0.48   1.00/1.00/1.00    25.5  39.2  59.3   125.4 125.4 125.4   no
   -6   20:37  0.30  1.00  0.03/0.41/1.30   0.30/0.36/0.48   1.24/1.17/1.00    15.8  35.7  56.2    81.0  81.0  81.0   no
  -12   21:13  0.30  1.00  0.00/0.39/1.30   0.28/0.34/0.48   1.60/1.42/1.00    11.8  37.1  55.0    48.1  48.1  48.1   no
dawn (sun in the east, so the blend goes from a different direction):
  el  8 az 113.0  ground R/B/D 46.0 46.0 46.0
  el  4 az 115.8  ground R/B/D 39.7 42.0 49.4
  el  1 az 118.1  ground R/B/D 33.9 41.7 56.1
  el -2 az 120.2  ground R/B/D 25.4 40.3 59.3
```

**(c) Is the fixed north-west sun at 40 degrees up the best fixed direction?** The azimuth, yes; the elevation, a lower sun reads better on neutral maps. Section `relief` measures the standard deviation of the ground's luma on the neutral grey map type (no photo, trees, roads or fire), Daylight at night, averaged over four camera headings (the camera sits at azimuth 45, 135, 225 or 315 and looks the other way, tilt 58) and the plan view.
- *Azimuth* (sun at 30 degrees). 315 is the best of eight at both sites: Katoomba 24.2, Thredbo 23.2. Next come 270 (23.0 and 20.2) and 0 (21.2 and 19.8). Azimuths 90 to 225 are worst (14.7 to 18.5 at Katoomba, 11.4 to 15.7 at Thredbo).
- *Heading.* Any fixed sun is weakest with the sun behind the camera: with the camera north-west of the target looking south-east, the 315 sun gives 17.3 (Katoomba) and 19.1 (Thredbo) against 29.7 and 28.9 for the best heading. A sun that follows the camera (azimuth equal to the view direction plus or minus 45 degrees) does not help: averages 22.0 and 22.8 at Katoomba and 19.7 and 18.8 at Thredbo, against 24.2 and 23.2 for the fixed sun, and its worst headings are no better. I saw no relief inversion in the plan, orbit or eye-level screenshots (a visual judgement, not measured). Shots 05 and 06.
- *Elevation* (sun at 315). Contrast rises as the sun gets lower. std/mean is 0.120 (55 degrees), 0.160 (40), 0.195 (30), 0.223 (20) at Katoomba, and 0.092, 0.145, 0.209, 0.264 at Thredbo. The average std peaks at 30 degrees at Katoomba (24.2 against 21.8 at 40) and at 25 at Thredbo (23.9; 23.2 at 30; 18.5 at 40). The price is brightness: mean luma 138 (40) and 126 (30) at Katoomba, 128 and 112 at Thredbo.
- *Photo map type* (the default), with trees and roads: no measurable difference between 40 and 30 degrees (std 15.5 and 15.4 at Katoomba, 19.8 and 19.1 at Thredbo), because the photo carries its own shading and the scene light is applied at half contrast.

So keep azimuth 315. 30 degrees reads clearly better than 40 on Plain and fuel-colour maps, most at the heading with the sun behind the camera (shot 05), and costs 5 to 7 % of the ground luma on the photo map (Daylight 54.3 against 58.6 at Katoomba and 83.0 against 87.8 at Thredbo in the default view). It is a judgement call, and keeping 40 loses little. All 40-degree numbers above use the plan's target lighting; the 30-degree target is `skyLighting(30)`, whose sun and ambient intensities are within 2 % of those at 40.

```
katoomba: sun elevation 30 deg, azimuth sweep
sun az   0 el 30            20.0  25.6  24.0  16.0  20.1 | avg 21.2 min 16.0 | mean luma 122.1 | std/mean avg 0.175 min 0.122
sun az  45 el 30            13.8  20.2  22.5  18.9  18.0 | avg 18.7 min 13.8 | mean luma 120.0 | std/mean avg 0.157 min 0.107
sun az  90 el 30            13.6  17.8  21.4  21.3  18.4 | avg 18.5 min 13.6 | mean luma 121.2 | std/mean avg 0.154 min 0.103
sun az 135 el 30            12.3  14.1  18.6  21.1  17.9 | avg 16.8 min 12.3 | mean luma 125.2 | std/mean avg 0.136 min 0.094
sun az 180 el 30            13.6  12.6  13.4  17.7  16.1 | avg 14.7 min 12.6 | mean luma 129.7 | std/mean avg 0.114 min 0.093
sun az 225 el 30            21.3  20.9  14.8  14.3  17.3 | avg 17.7 min 14.3 | mean luma 131.8 | std/mean avg 0.136 min 0.105
sun az 270 el 30            26.7  28.5  21.7  17.0  21.3 | avg 23.0 min 17.0 | mean luma 130.0 | std/mean avg 0.179 min 0.120
sun az 315 el 30            26.5  29.7  25.1  17.3  22.6 | avg 24.2 min 17.3 | mean luma 126.0 | std/mean avg 0.195 min 0.124
katoomba: sun azimuth 315, elevation sweep
sun az 315 el 20            24.0  26.2  23.5  18.7  21.8 | avg 22.8 min 18.7 | mean luma 103.7 | std/mean avg 0.223 min 0.159
sun az 315 el 25            25.6  28.3  24.6  18.1  22.4 | avg 23.8 min 18.1 | mean luma 114.6 | std/mean avg 0.211 min 0.141
sun az 315 el 30            26.5  29.7  25.1  17.3  22.6 | avg 24.2 min 17.3 | mean luma 126.0 | std/mean avg 0.195 min 0.124
sun az 315 el 35            25.6  29.0  23.8  15.7  21.3 | avg 23.1 min 15.7 | mean luma 132.4 | std/mean avg 0.177 min 0.108
sun az 315 el 40            24.4  28.0  22.5  14.1  19.9 | avg 21.8 min 14.1 | mean luma 138.4 | std/mean avg 0.160 min 0.094
sun az 315 el 55            20.2  24.9  18.9  10.7  16.0 | avg 18.1 min 10.7 | mean luma 153.2 | std/mean avg 0.120 min 0.066
katoomba: camera-relative sun (azimuth = viewing direction + offset), el 30; the plan view has no heading, so it uses 315
relative -45                13.6  28.5  24.0  21.3  22.6 | avg 22.0 min 13.6 | mean luma 121.6 | std/mean avg 0.182 min 0.106
relative +45                26.7  25.6  21.4  17.7  22.6 | avg 22.8 min 17.7 | mean luma 120.8 | std/mean avg 0.189 min 0.142
katoomba: photo map type with trees and roads, std of luma, elevation 40 vs 30 (azimuth 315)
   el 40:  14.7  17.7  12.6  14.7  17.9 | avg 15.5
   el 30:  14.4  17.6  12.6  14.9  17.6 | avg 15.4

thredbo: sun elevation 30 deg, azimuth sweep
sun az   0 el 30            19.6  23.6  19.5  15.7  20.7 | avg 19.8 min 15.7 | mean luma 116.9 | std/mean avg 0.171 min 0.122
sun az  45 el 30            15.6  13.0  12.8   9.8  12.2 | avg 12.7 min 9.8 | mean luma 126.4 | std/mean avg 0.101 min 0.075
sun az  90 el 30            11.4  13.4   9.4  12.0  10.8 | avg 11.4 min 9.4 | mean luma 133.4 | std/mean avg 0.085 min 0.070
sun az 135 el 30            13.9  18.6  11.9  16.4  15.8 | avg 15.3 min 11.9 | mean luma 135.0 | std/mean avg 0.114 min 0.083
sun az 180 el 30            18.4  16.9  12.7  14.6  15.7 | avg 15.7 min 12.7 | mean luma 131.4 | std/mean avg 0.119 min 0.091
sun az 225 el 30            20.8  16.5  12.4  12.9  14.4 | avg 15.4 min 12.4 | mean luma 124.0 | std/mean avg 0.125 min 0.096
sun az 270 el 30            22.0  24.3  17.8  16.8  19.9 | avg 20.2 min 16.8 | mean luma 115.5 | std/mean avg 0.176 min 0.135
sun az 315 el 30            21.5  28.9  22.2  19.1  24.3 | avg 23.2 min 19.1 | mean luma 111.8 | std/mean avg 0.209 min 0.152
thredbo: sun azimuth 315, elevation sweep
sun az 315 el 20            20.7  29.1  19.9  20.8  24.6 | avg 23.0 min 19.9 | mean luma 87.7 | std/mean avg 0.264 min 0.205
sun az 315 el 25            22.0  30.0  22.1  20.2  25.1 | avg 23.9 min 20.2 | mean luma 98.9 | std/mean avg 0.243 min 0.179
sun az 315 el 30            21.5  28.9  22.2  19.1  24.3 | avg 23.2 min 19.1 | mean luma 111.8 | std/mean avg 0.209 min 0.152
sun az 315 el 35            19.1  25.8  19.8  17.2  21.7 | avg 20.7 min 17.2 | mean luma 120.4 | std/mean avg 0.173 min 0.129
sun az 315 el 40            16.9  23.1  17.5  15.5  19.5 | avg 18.5 min 15.5 | mean luma 128.1 | std/mean avg 0.145 min 0.111
sun az 315 el 55            12.2  16.8  12.7  11.4  14.2 | avg 13.5 min 11.4 | mean luma 146.9 | std/mean avg 0.092 min 0.073
thredbo: camera-relative sun (azimuth = viewing direction + offset), el 30; the plan view has no heading, so it uses 315
relative -45                18.4  24.3  19.5  12.0  24.3 | avg 19.7 min 12.0 | mean luma 120.1 | std/mean avg 0.168 min 0.091
relative +45                22.0  23.6   9.4  14.6  24.3 | avg 18.8 min 9.4 | mean luma 121.8 | std/mean avg 0.158 min 0.070
thredbo: photo map type with trees and roads, std of luma, elevation 40 vs 30 (azimuth 315)
   el 40:  19.9  20.3  19.5  20.2  19.3 | avg 19.8
   el 30:  19.0  19.7  18.8  19.3  18.4 | avg 19.1
```

**(d) The fog law.** The plan's cut (`density x (1 - w)`) is not needed. The fog colour stays the real dark one, so at night the fog takes light away from distant terrain; it does not swallow it. Section `fog`, wide view (9.5 km, the farthest terrain at the top), Daylight at night, mean luma of a far band and a near band:

```
haze 0  Daylight, fog density x (1 - 0 * w):  far 69.5  near 53.1  far/near 1.31
haze 0  Daylight, fog density x (1 - 0.5 * w):  far 71.0  near 53.6  far/near 1.32
haze 0  Daylight, fog density x (1 - 1 * w):  far 71.5  near 53.8  far/near 1.33
haze 0  Realistic (today): far 14.4  near 8.5    day 13:00: far 96.5  near 70.6
haze 1  Daylight, fog density x (1 - 0 * w):  far 60.4  near 50.4  far/near 1.20
haze 1  Daylight, fog density x (1 - 0.5 * w):  far 68.5  near 52.9  far/near 1.30
haze 1  Daylight, fog density x (1 - 1 * w):  far 71.5  near 53.8  far/near 1.33
haze 1  Realistic (today): far 21.7  near 13.2    day 13:00: far 122.0  near 88.9
```

At the heavy smoke haze of the synthetic plume the far band loses 16 % of its luma to the fog (71.5 to 60.4), the near band 6 % (53.8 to 50.4), and the far band is still 1.20 times brighter than the near band (1.33 with the full cut); without haze the loss is 3 % and 1 %. The half cut and the full cut give crisper but flatter distance (shot 11, fourth tile, is the full cut). The unchanged fog also keeps the horizon coupled to the sky: at dusk the fog colour is the sunset glow, at night the dark blue, so the far terrain follows the sky without any code. Leaving it unchanged removes one line from the plan.

**(e) Does the fire still stand out in Daylight?** Yes, about as well as by day, and not as well as in Realistic. Section `fire`, six views (wide, close, front at each site). Michelson contrast of the bright-orange pixels against everything else below the top quarter of the frame:

```
katoomba wide:  setting                                fire%   Lfire   Lbg   Michelson  clutter%
  day 13:00 (Realistic)                         1.33   179.4  85.9   0.353     15.8
  night Realistic                               1.44   171.8  25.7   0.740      1.8
  night Brighter (recommended settings)         1.50   173.4  46.6   0.576      2.0
  night Daylight (recommended settings)         1.56   174.7  61.5   0.479      2.6
  night Daylight, smoke body on map light (plan)  1.54   178.0  69.1   0.440     12.6
  night Daylight, exposure folded (flames at night level)  1.57   175.0  62.3   0.475      3.0
  night Daylight, all plan settings             1.64   179.5  73.8   0.417     13.8

katoomba close:  setting                                fire%   Lfire   Lbg   Michelson  clutter%
  day 13:00 (Realistic)                         2.92   177.9  67.3   0.451      5.6
  night Realistic                               3.29   171.3  29.7   0.705      2.6
  night Brighter (recommended settings)         3.33   173.3  49.0   0.560      2.7
  night Daylight (recommended settings)         3.22   174.9  63.7   0.466      3.1
  night Daylight, smoke body on map light (plan)  3.12   177.6  66.6   0.455      7.8
  night Daylight, exposure folded (flames at night level)  3.58   176.5  65.4   0.459      3.9
  night Daylight, all plan settings             3.12   178.4  69.2   0.441      8.2

katoomba front:  setting                                fire%   Lfire   Lbg   Michelson  clutter%
  day 13:00 (Realistic)                         0.51   164.5  77.1   0.362     19.6
  night Realistic                               4.35   159.5  50.1   0.522      4.8
  night Brighter (recommended settings)         4.40   160.4  63.1   0.435      7.7
  night Daylight (recommended settings)         4.12   161.2  74.0   0.371     12.4
  night Daylight, smoke body on map light (plan)  3.06   171.4  83.6   0.344     25.9
  night Daylight, exposure folded (flames at night level)  4.66   161.9  75.6   0.363     13.4
  night Daylight, all plan settings             2.86   172.2  85.6   0.336     27.7

thredbo wide:  setting                                fire%   Lfire   Lbg   Michelson  clutter%
  day 13:00 (Realistic)                         0.53   155.1 110.3   0.169     45.4
  night Realistic                               0.44   142.3  23.8   0.714      0.7
  night Brighter (recommended settings)         0.45   145.4  61.4   0.406      0.8
  night Daylight (recommended settings)         0.44   144.8  86.7   0.251     11.5
  night Daylight, smoke body on map light (plan)  0.52   151.7  92.7   0.242     20.9
  night Daylight, exposure folded (flames at night level)  0.49   150.1  86.9   0.267     11.6
  night Daylight, all plan settings             0.53   153.7  98.8   0.217     31.6

thredbo close:  setting                                fire%   Lfire   Lbg   Michelson  clutter%
  day 13:00 (Realistic)                         1.46   170.4 100.5   0.258     31.3
  night Realistic                               1.22   157.6  28.4   0.695      1.8
  night Brighter (recommended settings)         1.21   160.6  57.0   0.476      1.9
  night Daylight (recommended settings)         1.05   162.0  77.6   0.352      4.0
  night Daylight, smoke body on map light (plan)  1.33   165.8  84.1   0.327     13.0
  night Daylight, exposure folded (flames at night level)  1.39   167.6  78.4   0.363      4.4
  night Daylight, all plan settings             1.35   167.2  89.5   0.303     19.1

thredbo front:  setting                                fire%   Lfire   Lbg   Michelson  clutter%
  day 13:00 (Realistic)                         1.95   171.9  99.7   0.266     48.7
  night Realistic                               1.66   158.4  33.9   0.648      2.3
  night Brighter (recommended settings)         1.64   161.6  58.5   0.468      2.3
  night Daylight (recommended settings)         1.41   166.5  77.1   0.367      4.1
  night Daylight, smoke body on map light (plan)  1.75   168.2  87.3   0.317     13.9
  night Daylight, exposure folded (flames at night level)  1.86   169.1  78.6   0.366      5.1
  night Daylight, all plan settings             1.79   169.4  91.9   0.297     24.7
```

Summary of the rows with the recommended settings, Daylight: Katoomba 0.479, 0.466, 0.371 (by day 0.353, 0.451, 0.362; Realistic night 0.740, 0.705, 0.522); Thredbo 0.251, 0.352, 0.367 (by day 0.169, 0.258, 0.266; Realistic night 0.714, 0.695, 0.648). The flames, embers and ground fire keep their night gain, and their pixel area is within 15 % of Realistic's (1.56 against 1.44 % wide at Katoomba; the two Thredbo close views are 14 and 15 % smaller). The plan's own settings are 0.02 to 0.07 lower and fall just under the day value in two of six views (Katoomba close and front); the cause is mostly the smoke body (correction 2). Folding the exposure in (`nlExp=fold`) leaves the contrast alone and adds 11 to 32 % more bright-orange area at close range (3.58 against 3.22 % at Katoomba close, 1.39 against 1.05 % at Thredbo close). Shot 07 is the close view at day, Realistic, Brighter and Daylight; shot 08 is the smoke.

**(f) Imagery on and off, and the Plain map type.** All three map types rise Realistic < Brighter < Daylight and keep the fire clearly visible (shot 09). Section `maptypes`, ground luma at night with the day value for scale:

```
katoomba  photo         R  10.2  B  36.2  D  54.3   (day 13:00 Realistic 70.4)
katoomba  fuel colours  R  17.3  B  47.7  D  69.2   (day 13:00 Realistic 94.1)
katoomba  plain         R  35.5  B  85.6  D 120.6   (day 13:00 Realistic 152.3)
thredbo   photo         R  17.0  B  56.6  D  83.0   (day 13:00 Realistic 95.9)
thredbo   fuel colours  R  17.5  B  51.0  D  74.1   (day 13:00 Realistic 97.6)
thredbo   plain         R  36.0  B  89.5  D 126.3   (day 13:00 Realistic 160.7)
```

The Plain map is where the lighting shows most (a clean grey hillshade with the fire as the only colour, shot 09 bottom row). The photo's own seams show up once the map is lit: Katoomba has a paler rectangle in the middle of the slope and Thredbo a paler parallelogram (shots 01, 02, 09). They are in the photo by day too and nothing in the lighting makes them worse, but a trainee will see them at night now.

**(g) Roads, labels and trees.** They follow the map lighting and read as by day in Daylight (shots 10 and 11). Section `town` compares the same view at 22:00 with 13:00: the mean absolute luma difference to day, and the P99 luma (roads and labels are the brightest ground features):

```
thredbo: day 13:00 P99 241.2  mean 114.9  names shown: Thredbo, Alpine Way
   night realistic  mean |difference to day| 84.8   P99 183.9   mean 30.1
   night brighter   mean |difference to day| 41.8   P99 213.0   mean 73.1
   night daylight   mean |difference to day| 13.2   P99 237.6   mean 101.9
katoomba: day 13:00 P99 246.0  mean 126.8  names shown: Katoomba, Yosemite, Great Western Highway, Katoomba Street, Gang Gang Street
   night realistic  mean |difference to day| 66.2   P99 188.8   mean 60.6
   night brighter   mean |difference to day| 32.1   P99 219.2   mean 94.6
   night daylight   mean |difference to day| 5.5   P99 245.0   mean 122.3
```

Roads, fire trails and labels lose their night dimming and cool tint (they use `uMapNight`); houses keep their lit windows (real `uNight`); the trees lose the moonlight add and show their full colour; eye-level trees (shot 11) have the day's depth. Daylight is not as bright as noon: the sun is at 30 degrees, so the flat ground has about 0.5 of the noon sun term (the plain ground at Katoomba is 126 against 153 luma at 55 degrees, and the photo ground 54.9 against 67.8 at 13:00 in the standard view).

### Corrections to the plan's maths (found while tuning)

Plan 9b.3 describes the maths in one paragraph. Four things in it do not survive the prototype, and one detail is missing. Each was found by a number or a picture that did not look right, then confirmed with the switch named.

**1. Weight the direction by the light each sun carries, not by `w`** (`nlDir=light` against `nlDir=vector`). The plan blends the sun direction as vectors, `real x (1 - w) + target x w`. At night the real sun has no light, but its direction still counts with weight `1 - w`. That direction is the real sun clamped to -2 degrees at the real azimuth, which turns with the clock (west-south-west at dusk, north at midnight, east-south-east at dawn). So Brighter's light swings all night. Section `night`, Brighter, neutral ground, plan view (std of luma / mean luma):

```
clock    vector blend (plan)   light-weighted blend   (std / mean luma)
20:45     15.3 /  70.7           16.1 /  85.8      (real sun el -7.2, az 235.5)
21:30     16.0 /  75.1           17.2 /  91.2      (real sun el -14.6, az 228.1)
00:00     13.5 /  76.1           17.2 /  90.9      (real sun el -31.3, az 195.3)
02:00     11.3 /  77.2           17.2 /  90.9      (real sun el -30.9, az 163.1)
04:00     11.3 /  76.5           17.2 /  90.9      (real sun el -18.1, az 136.2)
05:30      9.6 /  70.8           14.5 /  86.4      (real sun el -3.5, az 121.4)
```

In shot 14 the shadows fall on a different side at 21:30, 00:00 and 03:00 and the relief is flatter by 03:00 with the plan's blend, while the light-weighted one gives the same picture at all three times. Daylight is spared at night (`w` is 1) but not at dusk. The fix weights the vectors by `(1 - w) x real sun intensity` and `w x target intensity`: at night the first is 0, so every look is lit from the fixed sun until the real sun has light again, and at dusk the direction moves smoothly from the setting sun to the fixed one. Unit test: at night the direction of every look equals the target's for any real azimuth.

**2. Keep the smoke body on the real lighting** (`nlSmoke=0` against `nlSmoke=1`). Plan row 1 lists `smokeLayer.ts:60,78` as map lighting. In Daylight at night that makes the plume a pale grey-pink cloud in a dark sky (shot 08, tiles 1 and 3). At Katoomba front 26 % of the non-fire pixels are brighter than luma 110 against 12 % with the real lighting, and the fire's Michelson contrast falls by 0.01 to 0.05 (section `fire`, rows "smoke body on map light"). With the real lighting the plume keeps its night look in all three looks, so it is the same in all three frames, which also keeps the e2e sky region identical when the plume reaches it. The price: over a lit map the plume is a dark veil (shot 08, tiles 2 and 4; Thredbo shows it most) and it hides the lit ground behind it a little more than the pale one. It needs its own five uniforms (`uSunColour uSunI uSkyAmb uAmbI uExposure`), as the sky dome needs its own.

**3. Fade the cast shadows with `w`** (`nlShadow=1` against `nlShadow=0`). The shadows follow the real sun and switch off below +0.5 degrees. With the map lit by the blended sun this gives shadows from the setting sun on a map lit from the north-west, and a step when they switch off. Section `shadow`, Daylight, ground luma either side of the cut-off:

```
el      cast shadows as in the plan   shadows scaled by (1 - w)
    4       49.1                        49.4
    2       53.1                        54.4
    1       53.3                        56.2
  0.8       53.6                        56.6
  0.6       53.5                        56.9
 0.55       53.6                        57.0
 0.45       57.8                        57.8
  0.3       58.0                        58.0
    0       58.4                        58.4
   -2       59.3                        59.3
step across 0.55 -> 0.45: plan 4.2, scaled 0.8 luma levels
```

Shot 13 shows the two frames and their difference times 6. Multiplying the terrain's shadow term by `uShadowGain = 1 - w` (one uniform, one shader line, `terrainLayer.ts:205`) removes most of the step. A better factor is the share of the sun's light that comes from the real sun, which is smaller still at dusk, but `1 - w` is enough.

**4. Blend colour times intensity** (`nlBlend=product` against `nlBlend=separate`). The plan blends the sun colour and the sun intensity on their own. At night the real sun is black and has intensity 0, so the sun's light, their product, goes with `w` squared: Brighter gets a quarter of Daylight's sun, not half. Blending the product and dividing the blended intensity out again makes the light go with `w` (ambient is treated the same way; its real values are not zero, so it matters little). At matched brightness the picture barely changes (section `brighter`: std/mean 0.270 against 0.276 at Katoomba, 0.184 against 0.168 at Thredbo), so this is a correctness fix more than a visible one. It does change what `m` means: m is now the share of Daylight's light, and the Brighter mix goes from 0.55 to 0.3. Unit test: at night Brighter's sun light is `m` times Daylight's.

**5. The signature.** `mapLighting(real, look, sunElevation)` cannot blend the direction because `SkyLighting` has no azimuth, and the elevation is already `real.sunElevation`. The prototype takes the real sun's world direction instead: `mapLighting(real, look, realSunDir, weightScale = 1)`. The last argument lets the smoke ask for a share of the map lighting in the spike; the lane does not need it.

### Audit of the plan's shader table (9b.3)

Every site in the plan's table was checked in the running renderer. "Follows" means the picture changes as the look changes with no shader edit.

| Plan site | Plan class | Result |
| --- | --- | --- |
| `terrainLayer.ts:62-63,204-218` ground and photo | map lighting | Follows, on the photo, fuel colours and plain. One shader line added for the shadows (correction 3) |
| `terrainLayer.ts:383-397` skirt | map lighting | Follows |
| `treeShaders.ts:269-272,397-401` | map lighting | Follows |
| `placesLayer.ts:296-309` houses | map lighting | Follows |
| `smokeLayer.ts:60,78` smoke body | map lighting | **Wrong class: real lighting** (correction 2) |
| `glsl.ts:42-57` exposure | map lighting | Blended as the plan says; see the exposure note below |
| `streaks.ts:132`, `crossSectionLayer.ts:81` | exposure only | No effect: their colours are in display space; the exposure reaches them only through the fog colour |
| `fireLayer.ts:133` flames | exposure only | Blended; it is emissive tone mapping, see the exposure note |
| `placesLayer.ts:226-227` roads, `:309` house floor, `:352` labels, `treeShaders.ts:409` moonlight | `uMapNight` | Done: `uMapNight` replaces `uNight` in the road, house floor, label and tree shaders. Verified in Brighter and Daylight |
| `skyDome.ts:40-44` sun disc, stars | real | Own sun, colour, intensity and exposure uniforms; stars stay real. Verified (shots 12; sky region 0 differing pixels) |
| `fireLayer.ts:91`, `smokeLayer.ts:80`, `placesLayer.ts:313`, `terrainLayer.ts:226`, `SceneView.ts:1034` | real | Unchanged, as the plan says |

**What the table misses.**
- `terrainLayer.ts:205` (`float shadow = shade.b`): the cast shadows, which need `uShadowGain` (correction 3).
- `glsl.ts:71`: `fsFog` shows the fog colour through `fsDisplay`, so the fog colour is multiplied by the shared exposure.
- **`uExposure` does three jobs**: the exposure of lit surfaces (`fsDisplay`), the exposure of emissive light (`fsTonemap`: flames, ground fire, flames on trees, fire on roads, fire light on smoke) and the fog colour. The plan blends it for all three. Measured: acceptable. In Daylight the emissive paths lose up to 37 % of their exposure (1.6 to 1.0) before the tone curve, which shows as 10 to 30 % less bright-orange area at close range and no change in contrast (answer (e)). Giving the emissive paths the real exposure would need a second exposure uniform in about ten materials that include `TONEMAP`, or folding the map exposure into `uSunI` and `uAmbI` (`nlExp=fold`; roads have no light term, so they need a `uMapGain` multiply). Not recommended.
- `src/render/vegetationLayer.test.ts` keeps a contract test that every uniform the tree shader reads exists per material; its helper needs `uMapNight` (the prototype adds it).
- The plan says "no shader change" for row 1. Five shaders change by one to three lines each (terrain, road, house, label, tree); the smoke and the sky change only in JavaScript.

### Cost and safety

Section `cost`:

```
night realistic  draw calls 17  triangles 418990  programs 11  geometries 17  textures 14
night brighter   draw calls 17  triangles 418990  programs 11  geometries 17  textures 14
night daylight   draw calls 17  triangles 418990  programs 11  geometries 17  textures 14
day   realistic  draw calls 17  triangles 418990  programs 11  geometries 17  textures 14
day   brighter   draw calls 17  triangles 418990  programs 11  geometries 17  textures 14
day   daylight   draw calls 17  triangles 418990  programs 11  geometries 17  textures 14
30 look changes with a frame after each: programs 11 -> 11, geometries 17 -> 17, textures 14 -> 14
setNightLook alone (recompute of the lighting and uniform writes, no frame): 0.007 ms per call (mean of 3000 calls)
quality=low              draw calls / triangles  Realistic 13/134454  Brighter 13/134454  Daylight 13/134454
quality=high             draw calls / triangles  Realistic 13/405462  Brighter 13/405462  Daylight 13/405462
wind=surface&arrows=1    draw calls / triangles  Realistic 15/264162  Brighter 15/264162  Daylight 15/264162
cross=1                  draw calls / triangles  Realistic 16/269646  Brighter 16/269646  Daylight 16/269646
```

Realistic against an unpatched HEAD (a copy of `ca8e637` served on another port), same states, pixel for pixel, section `head`. Embers are off because two page loads seed their ember particles differently, which shows as streaks in the fire (about 17,000 pixels) in every frame, even by day; everything else in those frames is identical:

```
  dusk el 30 / default: 86 pixels differ (max 19); draw calls 15 / 15, triangles 415390 / 415390
32 of 33 frames identical (pixels, draw calls and triangles)
```

The one frame that differs is the first of the section, dusk with the sun at 30 degrees, default view: 86 pixels (0.02 %), at most 19 levels, scattered over the frame. It repeats exactly, so it is not noise, and it goes away when the prototype's shadow fade is switched off (`nlShadow=0`), but the shadow-gain uniform reads 1 after the frame in both cases and I did not find the cause. A first-frame effect is the likeliest, and the lane's own e2e (Realistic against a golden frame) will show whether it matters.

- Draw calls, triangles, programs, geometries and textures are identical in the three looks, at night and by day.
- A look change creates nothing: 30 changes with a frame after each leave programs, geometries and textures as they were. `setNightLook` alone takes 0.007 ms (the lighting recompute and the uniform writes); it does not recompute the cast shadows, because their key (sun azimuth and elevation) has not changed. No rebuild, no pause.
- No shader compile error and no console warning in the `head` and `cost` runs (`shoot.mjs` prints every page console message except the harness's missing favicon: "none"). The final run of the other sections was cut short before it printed that summary, so they are not covered.
- Shader cost: the terrain and road fragment shaders gain one multiply each; no new texture read, loop or varying [guess: not measurable on a phone].
- `tsc --noEmit` passes. The new `mapLighting.test.ts` (8 tests) passes, and so do `misc`, `placesLayer` and `vegetationLayer` tests once `uMapNight` is in the contract helper. I did not run the full suite.

## Verdict

**The design is sound and should be built, with the corrections above.** In the real renderer it does what the plan asks: after dark the ground, photo, trees and roads read as by day, lit from the north-west; the sky, the stars and the fire's glow still follow the clock; by day nothing changes (0 differing pixels); Realistic is pixel-identical to today in 32 of 33 frames (86 pixels differ in the other, unexplained, see Cost and safety); the look changes through uniforms only; and it costs no draw call or triangle. The fire stands out in Daylight as it does by day, and the three looks are well spaced.

What is wrong in the plan as written, in order: the direction blend (Brighter's relief swings and fades through the night), the smoke classification (a pale plume in a dark sky and a weaker fire), the cast shadows (a step of 4.2 luma levels, about 8 %, at +0.5 degrees), the colour-times-intensity product (a quarter sun at Brighter), and the `mapLighting` signature (no azimuth). None of them changes the architecture. All five are small in code.

What is not good, and will be seen on the phone:
- **Dusk mismatch.** At -2 to -6 degrees the sky is still sunset orange or twilight purple while the Daylight map is fully lit with a neutral sun; the map looks greener than the sky suggests (shot 03, bottom row). It is what Daylight means; the fade makes it last about 55 minutes (from +4 to -6 degrees, 19:43 to 20:37 on 21 December) and nothing smaller fixes it.
- **Daylight is not noon.** The sun is at 30 degrees, so the flat ground gets about half the noon sun term: 54.9 against 67.8 luma at Katoomba, 83.6 against 94.0 at Thredbo (standard view).
- **Photo seams.** The aerial photos have pale tiles that are invisible in Realistic and plain in Brighter and Daylight (shots 01, 02, 09). They are in the photo by day too.
- **Smoke as a dark veil** over a lit map (shot 08, right tiles).
- **The photo map type shows little more relief** from a lower sun (answer (c)).

## Recommendation

1. **Build workstream F as planned, with these changes to the plan text** (size S still holds: the prototype is about 300 changed lines in 11 render files, plus 130 lines of tests):
   - 9b.3 *Lighting maths*: `m = 0, 0.3, 1`; target `skyLighting(30)` from azimuth 315; sun direction weighted by the light each sun carries; sun colour times intensity and the ambient blended as products; exposure blended as the plan says; signature `mapLighting(real, look, realSunDir)`.
   - 9b.3 *Uniform plumbing*: the smoke body gets its own set of five lighting uniforms from the real lighting; a new shared `uShadowGain = 1 - w`.
   - 9b.3 *table*: move `smokeLayer.ts:60,78` to the real rows; add `terrainLayer.ts:205` (shadows, `uShadowGain`); add the three jobs of `uExposure`.
   - 9b.3 *Shadows*: "scaled by `1 - w`" in place of "keep following the real sun". *Fog and fire*: fog colour and density stay as they are.
   - 9b.5 *tests*: add the night-direction test and the "Brighter is `m` times Daylight at night" test; add `uMapNight` to the `vegetationLayer.test.ts` helper; the e2e uses the numbers in the table above (relative margins), compares the sky region pixel for pixel, and looks for the sun disc from eye level toward the north-west and up.
2. **Keep D13 and D14.** Nothing found couples F to another workstream. F touches `terrainLayer.ts` in three places (an uniform declaration, its default value, one shader line); H-look edits that file, a trivial merge.
3. **Leave out** the fog cut and, unless you want flames at their night level in Daylight, the exposure fold.
4. **On the phone** (check-list item for F): look at Brighter and Daylight outdoors and in a dark room, with the fire running into the evening; check the dusk change, and that the plume reads as smoke.

## Limits

- **Software rendering** (SwiftShader): the same shaders and tone curve, but a phone GPU may differ in precision; no frame-time or battery numbers.
- **Synthetic fire** (`src/render/devScenario.ts`): flame, ember and plume counts are fabricated, so the fire contrast numbers describe this fire.
- **Two sites, one date.** 21 December 2019, so the dusk sun sets at azimuth 241 degrees (south-west). In winter it sets near 299 degrees, closer to the fixed sun [guess: the dusk blend is gentler then]. Clear sky: no cloud cover (real cloud dims the real lighting but not the target) [guess: it makes Daylight's step bigger on cloudy nights].
- **Nobody looked at it on a phone**, outdoors or in a dark cab. Every judgement is from 412 x 915 px desktop screenshots; a phone shows more detail.
- **The metrics are proxies:** the standard deviation of luma on neutral grey for relief, a colour rule for fire. No user test, no colour-vision check.
- **The e2e numbers are for the harness view**, not for the app's default camera and panels; the lane re-measures there.
- Only the 3-D map was checked. The 2-D mock has no night lighting. Wind streaks, arrows, the cross-section and icons are display-space colours the lighting never touches; I looked at them in Daylight in a screenshot not kept [they read as by day].
- The UI side (Layers panel row, preferences, reset) was not prototyped.

## How to reproduce

```
# a checkout of ca8e637 with node_modules (a git worktree is fine), the dev server on port 4304
git apply docs/plans/spikes/S4-night-look/prototype.patch
nice -n 8 npx vite --port 4304 --strictPort &

# optional, for the "head" section: an unpatched copy on another port, with its own dependency cache
mkdir /tmp/s4-head && git archive ca8e637 | tar -x -C /tmp/s4-head && ln -s "$PWD/node_modules" /tmp/s4-head/node_modules
sed -i "s#export default defineConfig(({ mode }) => ({#&\n  cacheDir: '/tmp/s4-head-cache',#" /tmp/s4-head/vite.config.ts
(cd /tmp/s4-head && nice -n 8 npx vite --port 4344 --strictPort &)

# the shots (14 JPEGs) and every table; about 30 minutes on 4 cores at a load of 8 (the `head` and `cost` sections alone take 5 minutes on a quiet machine)
S4_PORT=4304 S4_HEAD_PORT=4344 node docs/plans/spikes/S4-night-look/shoot.mjs all
# the head section alone; S4_HEAD_ONLY="day 13:00" limits the states, S4_DUMP=<folder> saves each differing frame pair with a difference mask,
# S4_HEAD_EXTRA=nlShadow=0 gives the prototype extra switches, S4_HEAD_PROBE=1 prints the shadow-gain uniform
S4_PORT=4304 S4_HEAD_PORT=4344 node docs/plans/spikes/S4-night-look/shoot.mjs tables head cost
# or one part
S4_PORT=4304 node docs/plans/spikes/S4-night-look/shoot.mjs tables fade fire
S4_OUT=/tmp/s4-shots S4_PORT=4304 node docs/plans/spikes/S4-night-look/shoot.mjs shots relief

# the unit tests
nice -n 8 npx vitest run src/render/mapLighting.test.ts src/render/vegetationLayer.test.ts
```

`PW_CHROMIUM` overrides the browser path. By hand, the harness takes: `http://localhost:4304/src/render/dev.html?start=22&t=7200&nightLook=daylight` (night, Brighter or Daylight), `&startMin=-60` (an hour earlier), `&site=thredbo`, `&plain=1&imagery=0` (Plain), `&town=Thredbo&context=1&homes=1&zones=1` (places), and the constants overrides `nlMix nlHigh nlLow nlAz nlEl nlFog nlExp nlSmoke nlShadow nlDir nlBlend`. The plan as written is `nlMix=0.55&nlEl=40&nlFog=1&nlSmoke=1&nlShadow=0&nlDir=vector&nlBlend=separate`.

## Files

- `README.md`: this note.
- `prototype.patch`: `git diff` of the worktree against `ca8e637` for `src/`: 13 files, 428 changed lines (389 added, 39 removed), including `src/render/mapLighting.test.ts`. **A throwaway starting point for the lane, not reviewed code**: the constants sit in a mutable object for tuning, `refreshLighting` and the `skyFromMap` switch exist only for the spike, and the UI is not touched.
- `shoot.mjs`: makes the shots and prints every table above (`node shoot.mjs all`; needs the patch served by a dev server).
- `shots/` (14 JPEGs, quality about 80, each under 120 kB, 910 kB in all):
  - `01-katoomba-night-three-looks.jpg`, `02-thredbo-night-three-looks.jpg`: the three looks at 22:00, default view.
  - `03-dusk-fade-katoomba.jpg`: Realistic over Daylight with the sun at +8, +4, 0, -2 and -6 degrees.
  - `04-e2e-regions-katoomba.jpg`: the ground and sky regions of the luminance table.
  - `05-relief-headings-katoomba.jpg`: neutral ground, four camera headings, sun at 40 and 30 degrees.
  - `06-sun-azimuth-plan-view.jpg`: the plan view for eight sun azimuths.
  - `07-fire-close-katoomba.jpg`: the fire front by day and in the three looks.
  - `08-smoke-light.jpg`: smoke body on map light (plan) and on real light, two sites.
  - `09-map-types-katoomba.jpg`: photo, fuel colours and Plain, three looks.
  - `10-town-thredbo.jpg`: roads, labels, houses and trees by day and in the three looks.
  - `11-eye-level-katoomba.jpg`: eye level by day, Realistic, Daylight, and the full fog cut.
  - `12-sky-sun-disc.jpg`: looking north-west and up: Realistic, Daylight, and the bug the plan guards against.
  - `13-shadow-step.jpg`: the cast-shadow step at +0.5 degrees, plan and fade, with difference images.
  - `14-brighter-through-the-night.jpg`: Brighter at 21:30, 00:00 and 03:00, plan blend and light-weighted blend.
