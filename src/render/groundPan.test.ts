import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { GroundGrab, PAN, PanMomentum, rayDirection } from './groundPan';
import { HeightField } from './heightfield';

const origin = { lat: -33.7, lon: 150.3 };
const grid = makeGridSpec(origin, 8000, 40);

function terrain(fn: (x: number, y: number) => number, vex = 1): HeightField {
  const z = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) z[j * grid.nx + i] = fn(grid.x0 + i * grid.cellSize, grid.y0 + j * grid.cellSize);
  return new HeightField(grid, z, vex);
}
const flat = (): HeightField => terrain(() => 0);
const hills = (): HeightField => terrain((x, y) => 300 + 60 * Math.sin(x / 700) * Math.cos(y / 900) + 0.02 * x);

/** The camera of the orbit view: `d` from `target` at compass azimuth / polar angle (deg), 50° vertical fov, optional view insets. */
function orbitCamera(target: THREE.Vector3, d: number, azDeg: number, polarDeg: number, insets?: { top: number; bottom: number }): THREE.PerspectiveCamera {
  const W = 400;
  const H = 800;
  const cam = new THREE.PerspectiveCamera(50, W / H, 2, 200000);
  const az = THREE.MathUtils.degToRad(azDeg);
  const po = THREE.MathUtils.degToRad(polarDeg);
  cam.position.set(target.x + Math.sin(az) * Math.sin(po) * d, target.y + Math.cos(po) * d, target.z - Math.cos(az) * Math.sin(po) * d);
  cam.lookAt(target);
  if (insets) {
    // The same widened frame CameraRig.applyViewOffset builds for panels covering the top and bottom of the canvas.
    const dy = (insets.top - insets.bottom) / 2;
    const fh = H + 2 * Math.abs(dy);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) * (fh / H)));
    cam.aspect = W / fh;
    cam.setViewOffset(W, fh, 0, Math.abs(dy) - dy, W, H);
  }
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/** Where the ray through an NDC position meets the horizontal plane at height y (world), or null. */
function planeHit(cam: THREE.PerspectiveCamera, ndcX: number, ndcY: number, y: number): THREE.Vector3 | null {
  const d = rayDirection(cam, ndcX, ndcY, new THREE.Vector3());
  if (Math.abs(d.y) < 1e-9) return null;
  const t = (y - cam.position.y) / d.y;
  return t > 0 ? cam.position.clone().addScaledVector(d, t) : null;
}

const CASES: { polar: number; insets?: { top: number; bottom: number } }[] = [
  { polar: 10 },
  { polar: 30 },
  { polar: 52 }, // the default orbit tilt
  { polar: 52, insets: { top: 90, bottom: 320 } }, // a tool panel covers the lower part of the canvas
  { polar: 68 },
  { polar: 74, insets: { top: 80, bottom: 0 } },
];

describe('GroundGrab: the grabbed ground stays under the finger', () => {
  for (const [name, make] of [
    ['flat ground', flat],
    ['rolling hills', hills],
  ] as const) {
    for (const c of CASES) {
      it(`${name}, polar ${c.polar}°${c.insets ? ', view insets' : ''}: after A → B the ground point under B is the one grabbed at A (≤ 1 cm)`, () => {
        const hf = make();
        const target = new THREE.Vector3(150, hf.worldHeightAt(150, -200), 200);
        target.y = hf.worldHeightAt(target.x, -target.z);
        const cam = orbitCamera(target, 3000, 200, c.polar, c.insets);
        const grab = new GroundGrab();
        const A: [number, number] = [0.15, -0.35];
        grab.begin(cam, A[0], A[1], target, hf);
        expect(grab.mode).toBe('ground');
        const g0 = grab.anchor.clone();
        // The finger first sits on the anchor.
        const t0 = new THREE.Vector3();
        expect(grab.solve(cam, A[0], A[1], t0)).toBe(true);
        expect(Math.hypot(t0.x, t0.z)).toBeLessThan(1e-6);
        // Then it travels along a path (several hops, like pointer moves): every hop keeps the anchor under it.
        const T = new THREE.Vector3();
        for (const B of [[-0.05, -0.2], [-0.3, 0.05], [-0.45, 0.2], [0.35, -0.6]] as const) {
          expect(grab.solve(cam, B[0], B[1], T)).toBe(true);
          cam.position.add(T);
          cam.updateMatrixWorld();
          // The ray through B now passes through the anchor ...
          const d = rayDirection(cam, B[0], B[1], new THREE.Vector3());
          const toAnchor = g0.clone().sub(cam.position);
          const sin = d.clone().cross(toAnchor.normalize()).length();
          expect(sin * g0.distanceTo(cam.position)).toBeLessThan(0.01);
          // ... and is the first ground it meets: the heightfield pick under the finger is the grabbed point.
          const hit = hf.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z)!;
          expect(hit).not.toBeNull();
          expect(Math.hypot(hit.x - g0.x, hit.y + g0.z)).toBeLessThan(0.01);
          // Pure translation over the ground: the camera did not change height or orientation.
          expect(T.y).toBe(0);
        }
      });
    }
  }

  it('moves the ground with the finger where OrbitControls would lag (vertical drag at 52° tilt: ground moves at ~62 % of the finger)', () => {
    const hf = flat();
    const target = new THREE.Vector3(0, 0, 0);
    const cam = orbitCamera(target, 3000, 180, 52);
    const grab = new GroundGrab();
    grab.begin(cam, 0, 0, target, hf); // the target itself under a finger at the centre
    // Per pixel, OrbitControls' screen-delta pan moves the target by 2 d tan(fov/2) / height metres.
    const orbitPerPx = (2 * 3000 * Math.tan(THREE.MathUtils.degToRad(25))) / 800;
    const T = new THREE.Vector3();
    // A 2 px drag: the grab moves the ground by the exact amount, the lag shows as the ratio sin(38°) ≈ 0.62 ...
    grab.solve(cam, 0, -2 * (2 / 800), T);
    expect(orbitPerPx * 2 / Math.hypot(T.x, T.z)).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(90 - 52)), 2);
    // ... and a 100 px drag (of 800) keeps the grabbed ground exactly under the finger.
    const dyNdc = -2 * (100 / 800);
    grab.solve(cam, 0, dyNdc, T);
    cam.position.add(T);
    cam.updateMatrixWorld();
    const p = planeHit(cam, 0, dyNdc, 0)!;
    expect(Math.hypot(p.x - grab.anchor.x, p.z - grab.anchor.z)).toBeLessThan(1e-6);
    expect(Math.hypot(T.x, T.z)).toBeGreaterThan(orbitPerPx * 100 * 1.3);
  });

  it('takes vertical exaggeration into account (world heights)', () => {
    const hf = terrain((x) => 100 + 0.05 * x, 3);
    const target = new THREE.Vector3(0, hf.worldHeightAt(0, 0), 0);
    const cam = orbitCamera(target, 2500, 120, 50);
    const grab = new GroundGrab();
    grab.begin(cam, -0.2, -0.1, target, hf);
    expect(grab.mode).toBe('ground');
    expect(grab.anchor.y).toBeCloseTo(hf.worldHeightAt(grab.anchor.x, -grab.anchor.z), 2);
    const T = new THREE.Vector3();
    grab.solve(cam, 0.3, 0.2, T);
    cam.position.add(T);
    cam.updateMatrixWorld();
    const d = rayDirection(cam, 0.3, 0.2, new THREE.Vector3());
    const hit = hf.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z)!;
    expect(Math.hypot(hit.x - grab.anchor.x, hit.y + grab.anchor.z)).toBeLessThan(0.01);
  });
});

describe('GroundGrab: no runaway near the horizon', () => {
  /** Ground metres the view moves per pixel of finger movement (vertical, 800 px canvas) for a finger that lands at `ndcY`. */
  function metresPerPixel(polar: number, ndcY: number, surface: HeightField | null, dist = 3000): number {
    const target = new THREE.Vector3(0, surface ? surface.worldHeightAt(0, 0) : 0, 0);
    const cam = orbitCamera(target, dist, 180, polar);
    const grab = new GroundGrab();
    grab.begin(cam, 0, ndcY, target, surface);
    const T = new THREE.Vector3();
    expect(grab.solve(cam, 0, ndcY - 2 * (4 / 800), T)).toBe(true); // 4 px
    return Math.hypot(T.x, T.z) / 4;
  }

  it('a finger that lands near the horizon moves the view at most MAX_SPEEDUP times as fast as one at the orbit target', () => {
    expect(PAN.MAX_SPEEDUP).toBeLessThanOrEqual(8); // (the cap is a few times, not hundreds)
    for (const polar of [60, 70, 78, 84]) {
      const centre = metresPerPixel(polar, 0, flat());
      // Down the screen from the horizon, in steps; the ground there covers anything from km to m per pixel.
      for (const ndcY of [0.9, 0.7, 0.5, 0.3, 0.1]) {
        const v = metresPerPixel(polar, ndcY, flat());
        expect(v, `polar ${polar}°, ndc y ${ndcY}`).toBeLessThan(centre * PAN.MAX_SPEEDUP * 1.1);
      }
    }
  });

  it('with the terrain too (hills near the horizon), the speed falls off smoothly from the capped value instead of jumping', () => {
    const hf = hills();
    const centre = metresPerPixel(78, 0, hf);
    // Down the screen from just below the horizon (ndc y ≈ 0.46), start points 11 px apart.
    const speeds: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const v = metresPerPixel(78, 0.44 - i * 0.025, hf);
      if (v > 0.2 * centre) speeds.push(v); // (above the line where the speed limit is reached the ground does not follow a vertical drag)
    }
    expect(speeds.length).toBeGreaterThan(10);
    for (const v of speeds) expect(v).toBeLessThan(centre * PAN.MAX_SPEEDUP * 1.1);
    for (let i = 1; i < speeds.length; i++) expect(Math.max(speeds[i]! / speeds[i - 1]!, speeds[i - 1]! / speeds[i]!)).toBeLessThan(1.6);
  });

  it('a finger that lands in the sky or on far ground drags from the speed-limit line: no jump at the start, no dead zone going down, no pull going up', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = orbitCamera(target, 3000, 200, 75);
    const grab = new GroundGrab();
    const T = new THREE.Vector3();
    const centre = metresPerPixel(75, 0, flat());
    for (const ndcY of [0.95, 0.8, 0.6]) {
      grab.begin(cam, 0.1, ndcY, target, flat());
      expect(grab.mode).toBe('ground');
      expect(grab.solve(cam, 0.1, ndcY, T)).toBe(true);
      expect(Math.hypot(T.x, T.z), `the finger has not moved: nothing moves (ndc y ${ndcY})`).toBeLessThan(1e-6);
      // 4 px down: the view follows at once, at no more than the limit
      expect(grab.solve(cam, 0.1, ndcY - 2 * (4 / 800), T)).toBe(true);
      const down = Math.hypot(T.x, T.z) / 4;
      expect(down, `moves with a finger that goes down (ndc y ${ndcY})`).toBeGreaterThan(0.3 * centre);
      expect(down).toBeLessThan(PAN.MAX_SPEEDUP * centre * 1.1);
      // 40 px up: the camera is not thrown back
      expect(grab.solve(cam, 0.1, Math.min(1, ndcY + 2 * (40 / 800)), T)).toBe(true);
      expect(Math.hypot(T.x, T.z)).toBeLessThan(0.02 * centre * 40);
    }
  });

  it('is still exact wherever the ground is not that much faster than the target (the default tilt, the whole canvas)', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = orbitCamera(target, 3000, 200, 52);
    const grab = new GroundGrab();
    const T = new THREE.Vector3();
    for (const ndcY of [0.75, 0.5, 0, -0.5, -0.95]) {
      grab.begin(cam, 0.1, ndcY, target, flat());
      const g = grab.anchor.clone();
      expect(grab.solve(cam, -0.2, ndcY - 0.1, T)).toBe(true);
      const c2 = cam.clone();
      c2.position.add(T);
      c2.updateMatrixWorld();
      const p = planeHit(c2, -0.2, ndcY - 0.1, 0)!;
      expect(Math.hypot(p.x - g.x, p.z - g.z), `ndc y ${ndcY}`).toBeLessThan(0.01);
    }
  });
});

describe('GroundGrab: fallbacks', () => {
  it('without a heightfield the horizontal plane through the target is grabbed', () => {
    const target = new THREE.Vector3(0, 250, 0);
    const cam = orbitCamera(target, 2000, 90, 45);
    const grab = new GroundGrab();
    grab.begin(cam, 0.2, -0.2, target, null);
    expect(grab.mode).toBe('ground');
    expect(grab.anchor.y).toBeCloseTo(250, 6);
    const T = new THREE.Vector3();
    grab.solve(cam, -0.3, 0.1, T);
    cam.position.add(T);
    cam.updateMatrixWorld();
    const p = planeHit(cam, -0.3, 0.1, 250)!;
    expect(Math.hypot(p.x - grab.anchor.x, p.z - grab.anchor.z)).toBeLessThan(1e-6);
  });

  it('a ray that misses the domain (camera looks past the edge) grabs the target plane instead', () => {
    const hf = flat();
    // Target well outside the 8 km domain: the ray never meets the heightfield box.
    const target = new THREE.Vector3(20000, 0, 0);
    const cam = orbitCamera(target, 3000, 180, 50);
    const grab = new GroundGrab();
    grab.begin(cam, 0, 0, target, hf);
    expect(grab.mode).toBe('ground');
    expect(grab.anchor.y).toBeCloseTo(0, 6);
  });

  it('a finger above the horizon holds the ground at the steepest line the speed limit allows: bounded, finite, nothing flies away', () => {
    const hf = flat();
    const target = new THREE.Vector3(0, 0, 0);
    const D = 3000;
    const cam = orbitCamera(target, D, 200, 84, undefined); // 6° above the horizon: the top of the screen is in the sky
    const grab = new GroundGrab();
    grab.begin(cam, 0, 0.95, target, hf);
    expect(grab.mode).toBe('ground');
    expect(grab.anchor.distanceTo(cam.position)).toBeLessThan(PAN.FAR * D);
    expect(grab.anchor.y).toBeLessThan(cam.position.y); // below the camera, whatever the finger's ray does
    const T = new THREE.Vector3();
    expect(grab.solve(cam, 0.3, 0.6, T)).toBe(true);
    expect(Number.isFinite(T.x) && Number.isFinite(T.z)).toBe(true);
    expect(Math.hypot(T.x, T.z)).toBeLessThan(2 * D);
    expect(T.y).toBe(0);
    // A small finger move is a small camera move.
    const small = new THREE.Vector3();
    grab.solve(cam, 0.01, 0.95, small);
    expect(Math.hypot(small.x, small.z)).toBeLessThan(0.05 * D);
  });

  it('ground farther than 4 camera–target distances is never held (grazing view): a finger just under the horizon holds nearer ground', () => {
    const hf = flat();
    const target = new THREE.Vector3(0, 0, 0);
    const cam = orbitCamera(target, 3000, 200, 84);
    const grab = new GroundGrab();
    // 84° polar: the ray 24° above the optical axis' lower edge … pick a finger just under the horizon: ground ≫ 4 D away.
    const horizon = (() => {
      // NDC y of the horizon: project a far point on the horizon line.
      const p = new THREE.Vector3(cam.position.x - Math.sin(THREE.MathUtils.degToRad(200)) * 1e6, cam.position.y, cam.position.z + Math.cos(THREE.MathUtils.degToRad(200)) * 1e6);
      return p.project(cam).y;
    })();
    grab.begin(cam, 0, horizon - 0.01, target, hf);
    expect(grab.mode).toBe('ground');
    expect(grab.anchor.distanceTo(cam.position)).toBeLessThanOrEqual(PAN.FAR * 3000 + 1e-6);
    // Without a pan to hold (a camera below the target looking up), the view plane is dragged instead.
    const low = orbitCamera(new THREE.Vector3(0, 900, 0), 3000, 200, 120);
    const g2 = new GroundGrab();
    g2.begin(low, 0, 0.3, new THREE.Vector3(0, 900, 0), null);
    expect(g2.mode).toBe('view');
  });

  it('a grabbed point dragged towards and over the horizon is rubber-banded at the reach, never infinite', () => {
    const hf = flat();
    const target = new THREE.Vector3(0, 0, 0);
    const D = 3000;
    const cam = orbitCamera(target, D, 200, 60);
    const grab = new GroundGrab();
    grab.begin(cam, 0, -0.3, target, hf);
    expect(grab.mode).toBe('ground');
    const T = new THREE.Vector3();
    let prev = 0;
    for (let y = -0.2; y <= 1; y += 0.05) {
      expect(grab.solve(cam, 0, y, T)).toBe(true);
      const m = Math.hypot(T.x, T.z);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeLessThan((PAN.FAR + 1) * D + 1);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-6); // continuous and monotonic as the finger rises
      prev = m;
    }
  });

  it('solve before begin, and after clear, does nothing', () => {
    const cam = orbitCamera(new THREE.Vector3(), 1000, 0, 40);
    const grab = new GroundGrab();
    const T = new THREE.Vector3(7, 7, 7);
    expect(grab.solve(cam, 0, 0, T)).toBe(false);
    grab.begin(cam, 0, 0, new THREE.Vector3(), null);
    expect(grab.active).toBe(true);
    grab.clear();
    expect(grab.active).toBe(false);
    expect(grab.solve(cam, 0, 0, T)).toBe(false);
  });
});

describe('PanMomentum: light inertia after release', () => {
  const MPP = 3; // ground metres per screen pixel

  /** Drag at `pxPerS` for 0.3 s at 60 Hz. */
  function drag(m: PanMomentum, pxPerS: number): void {
    const dt = 1 / 60;
    for (let i = 0; i < 18; i++) m.track(pxPerS * MPP * dt, 0, dt);
  }

  it('a slow or resting finger just stops the view', () => {
    const m = new PanMomentum();
    drag(m, PAN.FLING_MIN * 0.5);
    expect(m.release(MPP)).toBe(false);
    expect(m.gliding).toBe(false);
    expect(m.speed).toBe(0);
    // A finger that came to rest before lifting has no velocity left.
    const r = new PanMomentum();
    drag(r, 800);
    for (let i = 0; i < 12; i++) r.track(0, 0, 1 / 60); // 200 ms without moving
    expect(r.release(MPP)).toBe(false);
  });

  it('a moving finger glides: exponential decay with the 250 ms time constant, ending in ~1 s', () => {
    const m = new PanMomentum();
    drag(m, 1200);
    const v0 = m.speed;
    expect(v0 / MPP).toBeGreaterThan(1100);
    expect(m.release(MPP)).toBe(true);
    const out = new THREE.Vector3();
    let travelled = 0;
    let t = 0;
    const dt = 1 / 60;
    while (m.step(dt, MPP, out) && t < 5) {
      travelled += out.x;
      t += dt;
      if (Math.abs(t - PAN.GLIDE_TAU) < dt / 2) expect(m.speed / v0).toBeCloseTo(Math.exp(-1), 1);
      expect(out.z).toBe(0);
    }
    expect(m.gliding).toBe(false);
    // Total distance = v0 · τ (minus the tail below the stop speed): 1200 px/s · 0.25 s = 300 px.
    expect(travelled / MPP).toBeGreaterThan(285);
    expect(travelled / MPP).toBeLessThan(300.5);
    expect(t).toBeLessThan(1.4);
    expect(t).toBeGreaterThan(0.6);
  });

  it('the distance of a glide does not depend on the frame rate', () => {
    const total = (dt: number): number => {
      const m = new PanMomentum();
      drag(m, 1500);
      m.release(MPP);
      const out = new THREE.Vector3();
      let s = 0;
      for (let i = 0; i < 1000 && m.step(dt, MPP, out); i++) s += out.x;
      return s;
    };
    expect(total(1 / 30) / total(1 / 120)).toBeGreaterThan(0.98);
    expect(total(1 / 30) / total(1 / 120)).toBeLessThan(1.02);
  });

  it('a wild flick is capped', () => {
    const m = new PanMomentum();
    drag(m, 20000);
    expect(m.release(MPP)).toBe(true);
    expect(m.speed / MPP).toBeCloseTo(PAN.FLING_MAX, 3);
  });

  it('stop() cancels the glide at once (a new touch, a flight, a mode change, disposal)', () => {
    const m = new PanMomentum();
    drag(m, 1000);
    m.release(MPP);
    m.stop();
    const out = new THREE.Vector3(1, 1, 1);
    expect(m.step(1 / 60, MPP, out)).toBe(false);
    expect(out.length()).toBe(0);
    expect(m.gliding).toBe(false);
  });
});
