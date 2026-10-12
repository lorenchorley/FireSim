# Adaptive simulation quality

A topic that has **not started**. **Question:** is it possible to increase the quality of the simulation according to the complexity of the
terrain and its importance to the fire?

**Status:** a stretch goal in no release ([plan](../../docs/plans/air-slice-wind-detail-honest-speed.md) section 15c, decision D30).
**Not to be studied straight away.** This page keeps the question and what the code already says about it, so that the investigation can start
from here when you decide. There is no study folder yet.

## Why it matters

- The fire and the air are computed at one resolution over the whole domain, but fire behaviour is not spread evenly: the front is a thin line,
  and the terrain that bends it (gullies, ridges, steep slopes, cliffs) is a small share of the area.
- Spending detail where it matters could give more quality for the same cost, or the same quality for less. The second matters on phones: in
  0.2.2, Auto chose the Fast (surface wind) model on the project owner's phone for a 3.6 % overshoot of its time budget (plan section 2).
- For training, the places a learner cares about are the ones near the front and near homes.

## Short answer so far

Yes in principle; nothing here is tested. Coupled fire models already do it: the atmosphere at one resolution and the fire on a finer mesh,
with nested domains (research note 07 section 2.1; WRF-SFIRE and ACCESS-Fire). What the app has today, and what could adapt (read from the code,
see plan section 15c):

| | Today | Could adapt |
|---|---|---|
| Fire grid | one cell size, 30 m, or 20 m in the high-detail setting up to 6 km (`src/scenario/params.ts`); the elevation data is 10 m | 10 m cells in boxes around the front where the terrain is complex |
| Level set | narrow band: rates only for unburnt cells within 4 cells of the front, time step from the fastest cell (`src/fire/spread/FireSpreadModel.ts`) | already front-local in cost; the detail is not |
| Air | one 150 to 200 m grid, one tier per run (Fast 2-D, or Standard or High 3-D) | a finer 3-D nest around the fire; could also make Detailed affordable on more phones |
| Embers | a cap per tier: 2000, 4000, 4000 (`src/sim/params.ts`) | more particles or finer steps near the front and near homes |
| Complex-terrain physics | only steep cells are candidates for lee separation and VLS | extend that gate to other expensive terms |
| Terrain complexity | measured per cell: landform, drainage, trench, slope P90, cliff fraction | a single "complexity" score |
| Importance | not measured | time until the front arrives, predicted spread, homes in the path, regime changes |

## Rules any design has to meet (plan section 4)

- **Rule 1:** results never depend on speed, display or statistics. Refinement has to be a pure function of the simulation state.
- **Rule 2:** no silent degradation. Refinement follows the terrain and the fire, never the load, and nothing changes "to keep up".
- **Rule 4:** honest labels. The map has to say where detail has been raised.
- Rewind and the determinism spec: refined state goes into the checkpoints.

## Open questions

Suggested order; none is started.

1. **How much of a domain needs fine treatment?** Build a quality map (complexity x importance) for the demo sites and measure the share of
   cells, and of run time, that are both important and complex. No change to the simulation. This sizes the possible gain before any design.
2. **Does resolution change the answer, and where?** Run a bundled scenario at 30, 20 and 10 m and compare arrival times, perimeter and
   spotting. If the runs agree except around complex terrain, adaptivity pays; if they differ everywhere, the calibration depends on
   resolution and that has to be understood first.
3. **Which lever first?** Rank the four levers (physics gate, embers, fire mesh, air nest) by gain and cost. The physics gate and the embers
   look cheapest.
4. **Can the decision be deterministic and visible?** Write the refinement rule as a function of state, with a label for the map and a
   checkpoint story.
5. **Does an air nest make the Detailed mode affordable?** Measure on a phone how much of a 3-D step is spent away from the fire.
6. **Where do the formulas stop being valid?** The slope factor, its caps and the sub-cell terms were set for 20 to 30 m cells; check them at
   10 m.

## Log

No studies yet. Rules for adding one are in [`../README.md`](../README.md).
