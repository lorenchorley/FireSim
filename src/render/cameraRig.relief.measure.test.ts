/**
 * Measurement harness (not a regression test; `cameraRig.relief.test.ts` holds the assertions): how the camera behaves when a
 * finger drags the map over the real Katoomba relief, per viewing angle and view distance, over 6 places × 8 directions × the
 * drag lengths. Runs only with RELIEF_MEASURE=1 and prints one table (a few seconds):
 *
 *   RELIEF_MEASURE=1 npx vitest run src/render/cameraRig.relief.measure.test.ts --silent=false
 *
 * Tilts are polar angles from vertical (0 = the top view). Optional environment: RELIEF_TILTS=30,52 RELIEF_DISTS=1000,3000
 * RELIEF_LENS=100,300 (finger drag lengths, px) RELIEF_SPEED=50 (px/s; a drag that ends in a glide is left out, the glide moves the
 * picture on purpose) RELIEF_SETTLE=240 (frames watched after the lift) RELIEF_MESH=320 (heightfield samples per side).
 *
 * Columns: creep = how far (px) the ground that was under the finger moves on the screen after the lift (median, 90th
 * percentile, worst); step/avg = the camera's largest step in the drag over its average step; jerk = its largest change of step
 * (in average steps); flips = frames in which it stepped against its previous step (a flip-flop); path/net = length of the
 * camera's path over the straight distance; grab = the ground that was under the finger, from the finger at the end (px: large
 * only where the grab holds a nearer point than the ground at a flat angle, by design); dist = the orbit distance after the drag
 * over before (10th / 50th / 90th percentile, smallest, largest; the picture's scale at the middle of the screen changes the same
 * way); minAGL = the camera's lowest height above the ground. Drags that reached the edge of the domain or whose camera flew into
 * the terrain (clearance clamp) are counted apart and left out of the smoothness and scale columns.
 */
import { describe, it } from 'vitest';
import { katoombaHeightField, makeRig, runDrag, type DragResult } from './testing/rigHarness';

const on = !!process.env.RELIEF_MEASURE;
const list = (name: string, dflt: string): number[] => (process.env[name] ?? dflt).split(',').map(Number);

const PLACES: [number, number][] = [
  [0, 0],
  [-1000, 1000],
  [1500, -1500],
  [500, -2500],
  [-2000, -1000],
  [2000, 1500],
];
const DIRS = [0, 45, 90, 135, 180, 225, 270, 315];

const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))]!;
const f = (v: number, n = 1): string => v.toFixed(n).padStart(7);

(on ? describe : describe.skip)('relief measurement', () => {
  it('prints the table', async () => {
    const hf = await katoombaHeightField(Number(process.env.RELIEF_MESH ?? 320));
    const h = makeRig(hf);
    const speed = Number(process.env.RELIEF_SPEED ?? 50);
    const lines = [
      `mesh=${hf.grid.nx}  finger ${speed} px/s`,
      'tilt dist |   n | creep px: med   p90   max | step/avg: p90 max | jerk: p90 max | flips max | path/net max | grab px max | dist ratio: p10 p50 p90 min max | minAGL m | settle fr max',
    ];
    const worst: string[] = [];
    for (const tilt of list('RELIEF_TILTS', '30,45,52,60,70,75'))
      for (const distance of list('RELIEF_DISTS', '1000,3000')) {
        const rs: DragResult[] = [];
        let glides = 0;
        let edges = 0;
        let grounded = 0;
        let worstAll = { creep: 0, tag: '' };
        for (const [x, y] of PLACES)
          for (const len of list('RELIEF_LENS', '100,200,300,400'))
            for (const dirDeg of DIRS) {
              const r = runDrag(h, { x, y, distance, polar: tilt, top: tilt === 0, len, dirDeg, speed, settle: Number(process.env.RELIEF_SETTLE ?? 240) });
              if (!r) continue;
              if (r.glided) {
                glides++;
                continue;
              }
              if (r.creepMax > worstAll.creep) worstAll = { creep: r.creepMax, tag: `${x},${y} len ${len} dir ${dirDeg}${r.edge ? ' (edge)' : ''}${r.grounded ? ' (grounded)' : ''}` };
              if (r.edge) edges++;
              if (r.grounded) grounded++;
              if (!r.edge && !r.grounded) rs.push(r);
            }
        const col = (g: (r: DragResult) => number, p: number): string => f(q(rs.map(g), p), 2);
        lines.push(
          `${String(tilt).padStart(4)} ${String(distance).padStart(4)} |${String(rs.length).padStart(4)} |` +
            ` ${col((r) => r.creepMax, 0.5)} ${col((r) => r.creepMax, 0.9)} ${f(Math.max(...rs.map((r) => r.creepMax)))} |` +
            ` ${col((r) => r.peakStep / r.avgStep, 0.9)} ${f(Math.max(...rs.map((r) => r.peakStep / r.avgStep)))} |` +
            ` ${col((r) => r.jerk, 0.9)} ${f(Math.max(...rs.map((r) => r.jerk)), 2)} | ${f(Math.max(...rs.map((r) => r.flips)), 0)} | ${f(Math.max(...rs.map((r) => r.pathOverNet)), 2)} |` +
            ` ${f(Math.max(...rs.map((r) => r.grabError)))} |` +
            ` ${col((r) => r.distanceRatio, 0.1)} ${col((r) => r.distanceRatio, 0.5)} ${col((r) => r.distanceRatio, 0.9)} ${f(Math.min(...rs.map((r) => r.distanceRatio)), 2)} ${f(Math.max(...rs.map((r) => r.distanceRatio)), 2)} |` +
            ` ${f(Math.min(...rs.map((r) => r.minAgl)), 0)} | ${f(Math.max(...rs.map((r) => r.settledAfter)), 0)}`,
        );
        worst.push(`tilt ${tilt} d ${distance}: ${glides} glided, ${edges} reached the domain edge, ${grounded} flew into the ground; worst creep over all the others ${worstAll.creep.toFixed(1)} px (${worstAll.tag})`);
      }
    console.log([...lines, ...worst].join('\n'));
  }, 600000);
});
