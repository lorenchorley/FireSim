/**
 * The one-finger grab on the real Katoomba relief (the bundled 10 m DEM, as the renderer's heightfield): the touched ground stays
 * exactly under the finger wherever the finger lands on ground that is visibly ground (more than the margin of PAN.HORIZON_MARGIN_DEG
 * below the horizon), at every tilt and zoom of a sweep over places, directions and the whole canvas of a portrait phone and a
 * landscape one. Until 0.7.0 a finger on far ground held a nearer point on its ray (the view was never to move more than 5 times as
 * fast as for ground at the orbit target) and the ground lagged the finger: in a zoomed-in oblique view of this relief 9 to 46 % of the
 * fingers, by up to tens of pixels (measured with the same sweep on the 0.6.0 code). And a few pixels of drag near the horizon never
 * throw the camera across the domain: the largest move of one 4 px step towards the horizon over the sweep is a few per cent of it.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { GroundGrab, PAN, rayDirection } from './groundPan';
import type { HeightField } from './heightfield';
import { katoombaHeightField } from './testing/rigHarness';

function camera(W: number, H: number, target: THREE.Vector3, d: number, azDeg: number, polarDeg: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(50, W / H, 2, 200000);
  const az = THREE.MathUtils.degToRad(azDeg);
  const po = THREE.MathUtils.degToRad(polarDeg);
  c.position.set(target.x + Math.sin(az) * Math.sin(po) * d, target.y + Math.cos(po) * d, target.z - Math.cos(az) * Math.sin(po) * d);
  c.lookAt(target);
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}

const PLACES: [number, number][] = [
  [0, 0],
  [-1000, 1000],
  [1500, -1500],
  [500, -2000],
  [-2000, -1000],
];

describe('GroundGrab on the real Katoomba relief', () => {
  let hf: HeightField;
  beforeAll(async () => {
    hf = await katoombaHeightField(320);
  });

  for (const [W, H] of [
    [412, 915],
    [844, 390],
  ] as const) {
    it(`${W}x${H}: the ground stays under the finger (≤ 0.3 px) at every tilt, zoom and place, and 4 px near the horizon move the camera by under 8 % of the domain`, () => {
      const domain = hf.xMax - hf.xMin;
      let tested = 0;
      let near = 0;
      let worstPx = 0;
      let worstStep = 0;
      for (const D of [600, 1500, 3000]) {
        for (const polar of [20, 30, 40, 52, 60, 70, 75, 80, 85]) {
          for (const [px, py] of PLACES) {
            for (const az of [0, 90, 200, 290]) {
              const target = new THREE.Vector3(px, hf.worldHeightAt(px, py), -py);
              const c0 = camera(W, H, target, D, az, polar);
              // The rig keeps the camera above the ground under it (3 % of the distance, at least 8 m): such views do not exist otherwise.
              const cx = THREE.MathUtils.clamp(c0.position.x, hf.xMin, hf.xMax);
              const cy = THREE.MathUtils.clamp(-c0.position.z, hf.yMin, hf.yMax);
              if (c0.position.y < hf.worldHeightAt(cx, cy) + Math.max(8, 0.03 * D)) continue;
              for (let fy = 0.03; fy < 0.97; fy += 0.06) {
                for (const fx of [0.25, 0.5, 0.8]) {
                  const ndcX = fx * 2 - 1;
                  const ndcY = 1 - 2 * fy;
                  const dir = rayDirection(c0, ndcX, ndcY, new THREE.Vector3());
                  const hit = hf.raycast(c0.position.x, c0.position.y, c0.position.z, dir.x, dir.y, dir.z);
                  if (!hit) continue; // the sky or beyond the domain: no ground to hold
                  const below = THREE.MathUtils.radToDeg(Math.asin(-dir.y));
                  const P = c0.position.clone().addScaledVector(dir, hit.t);
                  const grab = new GroundGrab();
                  grab.begin(c0, ndcX, ndcY, target, hf);
                  const T = new THREE.Vector3();
                  if (below < PAN.HORIZON_MARGIN_DEG + 0.5) {
                    // Within (or next to) the margin of the horizon: bounded, not exact. One 4 px move towards the horizon.
                    near++;
                    expect(grab.solve(c0, ndcX, Math.min(1, ndcY + (4 / H) * 2), T)).toBe(true);
                    worstStep = Math.max(worstStep, Math.hypot(T.x, T.z));
                    continue;
                  }
                  tested++;
                  // A drag of 40 px down the screen (up for a finger at the very bottom), in 8 hops: towards ground that is not nearer the horizon.
                  const c = c0.clone();
                  const sgn = fy > 0.8 ? 1 : -1;
                  for (let i = 1; i <= 8; i++) {
                    expect(grab.solve(c, ndcX, ndcY + (sgn * (40 / H) * 2 * i) / 8, T)).toBe(true);
                    c.position.add(T);
                    c.updateMatrixWorld();
                  }
                  const p = P.clone().project(c);
                  const err = Math.hypot(((p.x - ndcX) * W) / 2, ((p.y - (ndcY + sgn * (40 / H) * 2)) * H) / 2);
                  worstPx = Math.max(worstPx, err);
                }
              }
            }
          }
        }
      }
      expect(tested, 'fingers on visible ground').toBeGreaterThan(10000);
      expect(near, 'fingers within the margin of the horizon').toBeGreaterThan(200);
      expect(worstPx, 'the touched ground ends this far (px) from the finger').toBeLessThan(0.3);
      expect(worstStep, `the largest move (m) of one 4 px step towards the horizon (the domain is ${domain.toFixed(0)} m)`).toBeLessThan(0.08 * domain);
    });
  }
});
