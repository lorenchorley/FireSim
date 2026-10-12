# Cliff from photo

An ongoing topic. **Question:** can photographs of a cliff improve how FireSim draws it, and what the fire model knows about it?

**Status:** exploratory work outside the app. Using photos in the app is a **stretch goal in no release**
([plan](../../docs/plans/air-slice-wind-detail-honest-speed.md) section 15b, decision D29). Nothing in this topic changes the app.

## Why it matters

- The app's terrain is a stereo-derived 10 m elevation model, so its cliffs are soft ramps with no ledges (plan section 2, "Cliffs").
  Workstream H (0.3.0) sharpens them with procedural detail and changes what counts as a wall in the fire model: bare rock, not just steep
  ground, with vegetated gullies left open.
- A photo shows what top-down data cannot: how a face is built (ledges, joints, overhangs), what is bare and what is vegetated (shrubs on
  ledges, hanging swamps, vegetated gullies through a wall), and the profile of the edge.
- The fire model works on 20 to 30 m cells, so a cliff's ledge-scale shape changes the picture, not the fire. What changes the fire is bare
  rock versus vegetation, and where the chutes are. This topic keeps those two apart: **drawing** (looks) and **numbers** (fire behaviour).

## What is known so far

From [study 01](01-single-photo-depth/README.md), one photo of one sandstone cliff:

- **A photo gives a good relief sheet.** From the photo's viewpoint it reproduces the picture, and the shape alone shows joint grooves, ledge
  steps and recesses. It is a sheet of photo draped on guessed depth. It holds up from about 45 degrees left to 15 degrees right of where the
  photo was taken; further away it stretches, shows its back or has holes.
- **Steepness is the model's opinion.** The best model reads the faces as near vertical (median tilt about 0 degrees), which fits sandstone
  cliffs better than the app's terrain. Another model leans the same faces back by 27 to 50 degrees. Steepness from one photo needs a prior
  such as "cliff faces here are near vertical".
- **One photo cannot give measured geometry.** Scale, the direction the wall runs, and how far ledges project are all unknown. The study
  assumes the face is 600 m away; the metric model put it at a few metres.
- **Agreement is not accuracy.** Five depth models agree on what is nearer (rank correlation 0.91 to 0.99), but they share training lineage.
- **Ledge-scale detail is either a model's learned prior or invented from shading.** Neither is a measurement.

## Open questions

Suggested order. Each one that gets done becomes a numbered study folder and a row in the log below.

1. **Ground truth and scale.** Find a cliff that is also in the app's terrain (Katoomba, Grose, Kanangra, Tomah, ...). With a known place and
   viewpoint, compare the photo model's height, wall direction and steepness with the 10 m terrain, and calibrate the assumed distance.
   Needs: where study 01's photo was taken, or a new photo with a known position and direction.
2. **Several photos, real geometry.** Multi-view reconstruction (structure from motion; `pycolmap` installs, and Depth Anything 3 takes several
   images). How few photos, how far apart, give ledges at metre scale? Licence note: the Depth Anything 3 Giant and Nested models are CC BY-NC.
3. **Score the models.** Add Depth Pro, Marigold v2, MoGe-2 and other Depth Anything 3 sizes, and rank them against the ground truth from 1,
   not only against each other.
4. **A vertical-face prior.** Combine the model's relief with "faces are near vertical" and measure what it does to the other-viewpoint quality
   and to the steepness the models disagree about.
5. **Photo to bare rock and vegetation.** Mark bare rock, vegetated ledges and vegetated chutes on a few photos by hand, and compare with the
   canopy-based estimate planned for the fire model (plan 9d.4, spike S6). This is the part that could change fire behaviour.
6. **Photo to rock style.** Read ledge spacing relative to face height, joint direction, overhang share and colours from photos of each demo
   site, as parameters for the cliff shader (plan 9d.3 item 5).
7. **A small photo set** of the demo sites' cliffs, with the position, direction, date and licence of each recorded. Study 01's photo is the
   example of what not to repeat: it is in the repository with no source or licence recorded.
8. **Where is detail worth it?** Cliffs are the most complex terrain in the demo sites. Whether the simulation should spend more detail there,
   and near the front, is a separate stretch goal that is **not to be studied yet**: [adaptive-simulation-quality](../adaptive-simulation-quality/README.md).

## Log

| # | Date | Study | Outcome |
|---|---|---|---|
| 01 | 2026-10-12 | [Single-photo depth for a cliff sequence](01-single-photo-depth/README.md) | A relief sheet that is right near the photo's viewpoint and a hint of how steep the faces are; no measured geometry. Scale, wall direction and ledge depth are guesses. |

## Resume here

- **Run it:** `studies/cliff-from-photo/01-single-photo-depth/scripts/run_all.sh` (see that study's README; `START=2` skips the model runs).
- **The photo is in the repository** (`01-single-photo-depth/inputs/photo.jpg`), committed at the project owner's request on 2026-10-12 with its
  source and licence **unrecorded**; fill them in as soon as they are known (see [`inputs/README.md`](01-single-photo-depth/inputs/README.md)).
  The repository is public.
- **Where it was run:** a CPU-only cloud sandbox (4 cores, 16 GB, no GPU). PyPI, Hugging Face and the jsDelivr CDN were reachable and GitHub
  release pages were not. The first load of each 1.3 GB model from a cold disk took 2 to 3.5 minutes; inference took 12 to 45 seconds.
- **Depth Anything 3** needs its extra imports installed by hand (see `requirements.txt`).
- **Interactive viewer:** step 6 builds it. The copy published for the project owner as a private Claude artifact is not part of the repository.
- **Before committing anything here**, read the rules in [`../README.md`](../README.md): public repository, nothing third-party without its licence.
