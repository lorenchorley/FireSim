/**
 * The camera over real relief (the bundled Katoomba DEM, the renderer's own decimation): what the orbit target does while a
 * finger drags the map and after it lifts.
 *
 * The target follows the terrain so that the pivot of a rotation is the ground under the middle of the screen. Translating the
 * whole rig up or down to do that (the first design) shakes the view while a finger holds the ground at a flat angle over
 * cliffs (the grab and the height feed each other: ±40 px per frame); holding the height during the drag and translating the rig
 * after the lift (the second) makes the picture creep by tens of pixels. So from ~22° tilt the camera never moves for the
 * terrain: only the target slides along the line of sight onto the ground under the middle of the screen (`CameraRig.settleTarget`),
 * which changes the orbit distance but not a pixel of the picture; near the top view, where the grab is steep and a vertical
 * translation changes nothing much, the rig still follows the terrain (the map scale stays the same).
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HeightField } from './heightfield';
import { H, W, katoombaHeightField, makeRig, runDrag, type DragResult, type RigHarness } from './testing/rigHarness';

let hf: HeightField;
beforeAll(async () => {
  hf = await katoombaHeightField(320);
});

/** Places with plenty of relief around them (local metres): the plateau edge, the gorge, the escarpment, flat plateau and valley floor. */
const PLACES: [number, number][] = [
  [0, 0],
  [-1000, 1000],
  [1500, -1500],
  [-2000, -1000],
  [2000, 1500],
];
const DIRS = [90, 270, 45, 180];

/** Every drag of a set that is a plain slow drag (no glide: the picture then moves on purpose) with its description. */
function runs(h: RigHarness, spec: { polar: number; distance: number; lens: number[]; top?: boolean }): { r: DragResult; tag: string }[] {
  const out: { r: DragResult; tag: string }[] = [];
  for (const [x, y] of PLACES)
    for (const len of spec.lens)
      for (const dirDeg of DIRS) {
        const r = runDrag(h, { x, y, distance: spec.distance, polar: spec.polar, top: spec.top, len, dirDeg, speed: 50 });
        if (r && !r.glided) out.push({ r, tag: `tilt ${spec.top ? 'top' : spec.polar} d ${spec.distance} at ${x},${y} len ${len} dir ${dirDeg}` });
      }
  return out;
}

describe('a drag over real relief: the picture does not creep after the finger lifts', () => {
  for (const tilt of [30, 45, 52, 60, 70, 75]) {
    it(`tilt ${tilt}°: the ground that was under the finger stays within 2 px (100–400 px drags, 5 places, 4 directions, 2 distances)`, () => {
      const h = makeRig(hf);
      const all = [...runs(h, { polar: tilt, distance: 1500, lens: [100, 250, 400] }), ...runs(h, { polar: tilt, distance: 4000, lens: [100, 250, 400] })];
      // A camera that was pushed up by the clearance clamp (it flew into the terrain) is held by that clamp, not by the drag.
      const set = all.filter((a) => !a.r.grounded);
      expect(set.length, 'drags checked').toBeGreaterThan(50);
      const worst = set.reduce((a, b) => (b.r.creepMax > a.r.creepMax ? b : a));
      expect(worst.r.creepMax, `largest creep (px): ${worst.tag}`).toBeLessThan(2);
    });
  }
});

describe('a drag over real relief: no flip-flop at flat angles, the grab is exact', () => {
  for (const tilt of [52, 60, 70, 75]) {
    it(`tilt ${tilt}°: the camera follows a steady finger steadily (no step against the previous one, a straight path)`, () => {
      const h = makeRig(hf);
      const set = runs(h, { polar: tilt, distance: 3000, lens: [300] }).filter((a) => !a.r.edge && !a.r.grounded);
      expect(set.length, 'drags checked').toBeGreaterThan(10);
      for (const { r, tag } of set) {
        expect(r.flips, `flip-flops: ${tag}`).toBe(0);
        expect(r.pathOverNet, `path / net: ${tag}`).toBeLessThan(1.15);
      }
    });
  }

  it('the ground under the finger stays under it (within 3 px) at the default tilt', () => {
    const h = makeRig(hf);
    for (const a of runs(h, { polar: 52, distance: 3000, lens: [100, 300] }).filter((q) => !q.r.edge && !q.r.grounded)) expect(a.r.grabError, a.tag).toBeLessThan(3);
  });
});

describe('re-seating the target: the camera does not move, the distance follows the ground', () => {
  /** The camera at 52° over the plateau edge, then the target lifted 300 m off the ground (as a zoom or a rotation can leave it). */
  function floating(polar: number, lift: number): RigHarness {
    const h = makeRig(hf);
    h.viewAt(0, 0, 3000, polar);
    h.rig.controls.target.y += lift;
    return h;
  }

  it('at 52° the camera stays exactly where it is while the target slides onto the ground, a few percent of the distance per frame', () => {
    const h = floating(52, 150);
    const cam = h.rig.camera.position.clone();
    let prev = h.rig.cameraState().distance;
    let biggest = 0;
    for (let i = 0; i < 200; i++) {
      h.frames(1);
      const d = h.rig.cameraState().distance;
      biggest = Math.max(biggest, Math.abs(d - prev) / prev);
      prev = d;
    }
    expect(h.rig.camera.position.distanceTo(cam), 'camera moved (m)').toBeLessThan(0.01);
    expect(biggest, 'largest change of the distance in one frame').toBeLessThan(0.045);
    const t = h.rig.controls.target;
    expect(Math.abs(t.y - hf.worldHeightAt(t.x, -t.z)), 'target above the ground (m)').toBeLessThan(0.5);
    // ... and it is on the line of sight (the picture of the ground at the middle of the screen is the target).
    const sight = h.rig.camera.position.clone().sub(t).normalize();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(h.rig.camera.quaternion).negate();
    expect(sight.dot(dir)).toBeGreaterThan(0.999999);
  });

  it('near the top view the whole rig follows the terrain instead: the distance stays, the camera rises and falls', () => {
    const h = floating(5, 150);
    const d0 = h.rig.cameraState().distance;
    const y0 = h.rig.camera.position.y;
    h.frames(200);
    expect(h.rig.cameraState().distance / d0).toBeGreaterThan(0.999);
    expect(h.rig.cameraState().distance / d0).toBeLessThan(1.001);
    expect(Math.abs(h.rig.camera.position.y - y0), 'camera height change (m)').toBeGreaterThan(50);
  });

  it('the rig follows the terrain below 22.5° and the target slides from there up, never both (21° / 24°)', () => {
    const below = floating(21, 150);
    const cam0 = below.rig.camera.position.clone();
    const d0 = below.rig.cameraState().distance;
    below.frames(200);
    expect(Math.abs(below.rig.camera.position.y - cam0.y), 'camera height change at 21° (m)').toBeGreaterThan(50);
    expect(below.rig.cameraState().distance / d0, 'distance at 21°').toBeCloseTo(1, 3);
    const above = floating(24, 150);
    const cam1 = above.rig.camera.position.clone();
    const d1 = above.rig.cameraState().distance;
    above.frames(200);
    expect(above.rig.camera.position.distanceTo(cam1), 'camera moved at 24° (m)').toBeLessThan(0.01);
    expect(Math.abs(above.rig.cameraState().distance / d1 - 1), 'distance change at 24°').toBeGreaterThan(0.02);
  });

  it('comes to rest: update() goes quiet (the on-demand renderer idles) and keeps the target on the ground', () => {
    for (const polar of [5, 22, 52, 70]) {
      const h = floating(polar, -120);
      const moving = h.frames(300);
      expect(moving.slice(-30).some(Boolean), `still moving after 300 frames at ${polar}°`).toBe(false);
      const t = h.rig.controls.target;
      expect(Math.abs(t.y - hf.worldHeightAt(t.x, -t.z)), `target off the ground at ${polar}° (m)`).toBeLessThan(0.5);
    }
  });
});

describe('the top view over relief: the map scale does not pulse', () => {
  it('a 300 px drag in the top view keeps the distance (the scale of the map) within 1 % and the picture still afterwards', () => {
    const h = makeRig(hf);
    const set = runs(h, { polar: 0, distance: 3000, lens: [100, 300], top: true });
    expect(set.length).toBeGreaterThan(20);
    for (const { r, tag } of set) {
      expect(Math.abs(r.distanceRatio - 1), `distance ratio: ${tag}`).toBeLessThan(0.01);
      expect(r.creepMax, `creep (px): ${tag}`).toBeLessThan(2);
    }
  });

  it('a nearly top-down orbit view (10°) behaves the same', () => {
    const h = makeRig(hf);
    for (const { r, tag } of runs(h, { polar: 10, distance: 3000, lens: [300] })) {
      expect(Math.abs(r.distanceRatio - 1), `distance ratio: ${tag}`).toBeLessThan(0.01);
      expect(r.creepMax, `creep (px): ${tag}`).toBeLessThan(2);
    }
  });
});

describe('the usual limits still hold over real relief', () => {
  /** Drag the finger back and forth and across the whole canvas for a few seconds, checking every frame. */
  function checkEveryFrame(polar: number, distance: number, place: [number, number], az: number): void {
    const h = makeRig(hf);
    h.viewAt(place[0], place[1], distance, polar, az);
    const rig = h.rig;
    const c = rig.controls;
    const cam = rig.camera.position;
    let x = W / 2;
    let y = H / 2;
    h.down(1, x, y);
    for (let i = 0; i < 700; i++) {
      // a triangle wave in both directions, 2.5 px per frame: ~1800 px of drag each way
      const p = (i * 2.5) % 800;
      x = W / 2 + 150 * Math.sin(i / 90);
      y = 200 + (p < 400 ? p : 800 - p);
      h.move(1, x, y);
      h.frames(1);
      const t = c.target;
      expect(t.x, `target x at frame ${i}`).toBeGreaterThanOrEqual(hf.xMin - 1e-6);
      expect(t.x, `target x at frame ${i}`).toBeLessThanOrEqual(hf.xMax + 1e-6);
      expect(-t.z, `target y at frame ${i}`).toBeGreaterThanOrEqual(hf.yMin - 1e-6);
      expect(-t.z, `target y at frame ${i}`).toBeLessThanOrEqual(hf.yMax + 1e-6);
      const ground = hf.worldHeightAt(THREE.MathUtils.clamp(cam.x, hf.xMin, hf.xMax), THREE.MathUtils.clamp(-cam.z, hf.yMin, hf.yMax));
      expect(cam.y - ground, `camera clearance at frame ${i}`).toBeGreaterThanOrEqual(Math.min(8, 0.03 * rig.cameraState().distance) - 1e-6);
      const d = rig.cameraState().distance;
      expect(d, `distance at frame ${i}`).toBeGreaterThanOrEqual(c.minDistance - 1e-6);
      expect(d, `distance at frame ${i}`).toBeLessThanOrEqual(c.maxDistance + 1e-6);
    }
    h.up(1);
    h.frames(120);
  }

  for (const [polar, distance] of [
    [52, 3000],
    [70, 3000],
    [75, 1200],
    [45, 80],
  ] as const) {
    it(`tilt ${polar}°, ${distance} m: the target stays inside the domain, the camera above the ground, the distance within its limits`, () => {
      checkEveryFrame(polar, distance, [500, -2500], 200);
      checkEveryFrame(polar, distance, [-3500, 3000], 20);
    });
  }

  it('150 px of finger over cliffs at a flat angle moves the camera by a few hundred metres, not kilometres (no runaway)', () => {
    const h = makeRig(hf);
    h.viewAt(1500, -1500, 2000, 70);
    const grabbed = h.pick(W / 2, 330)!;
    const mpp = (2 * 2000 * Math.tan((25 * Math.PI) / 180)) / H;
    const cam = h.rig.camera.position;
    const p0 = cam.clone();
    h.down(1, W / 2, 330);
    let path = 0;
    let prev = cam.clone();
    for (let i = 1; i <= 100; i++) {
      h.move(1, W / 2, 330 + 1.5 * i);
      h.frames(1);
      path += Math.hypot(cam.x - prev.x, cam.z - prev.z);
      prev = cam.clone();
    }
    h.up(1);
    h.frames(60);
    const net = Math.hypot(cam.x - p0.x, cam.z - p0.z);
    expect(path, 'path of the camera (m)').toBeLessThan(1.15 * net);
    expect(net, 'net displacement (m)').toBeLessThan(150 * mpp * 8); // 150 px of finger covers at most a few hundred metres here
    const under = h.screenOfGround(grabbed);
    expect(Math.hypot(under[0] - W / 2, under[1] - 480), 'the ground that was grabbed is still under the finger (px)').toBeLessThan(40);
  });
});

describe('the view comes to rest over real relief', () => {
  // The target slides along the line of sight to the first surface that the camera's ray meets. A search that started at the
  // target (within ±40 % of its distance) found a thin grazing ridge from some distances and the ground behind it from others, so
  // on rugged ground the target swung between the two for ever: update() never went quiet (the renderer never idled and the forest
  // was never re-placed) and the orbit distance oscillated by up to 8 %. Views that did that (x, y, distance, polar angle, azimuth):
  const SWINGING: [number, number, number, number, number][] = [
    [6, -1988, 3000, 52, 317],
    [-902, 902, 3000, 60, 329],
    [1258, -2132, 3000, 70, 34],
    [-360, 203, 300, 70, 87],
    [1891, -3258, 1500, 70, 282],
    [-1184, -2970, 3000, 70, 126],
    [165, -1800, 3000, 75, 287],
    [-128, -1194, 800, 75, 122],
    [605, 583, 1500, 80, 296],
    [-208, -703, 3000, 80, 142],
    // ... and, found with the first fix in place, three in the 15-30° blend that the design had then, where the rig followed the
    // ground under the target while the target slid to the surface the line of sight meets (a slow loop through the same kind of
    // grazing ridge; there is no blend any more, the rig follows below 22.5° and the target slides from there up):
    [2430, -1958, 5000, 19, 78],
    [2635, -2158, 300, 22, 73],
    [2272, -1771, 1500, 24, 62],
  ];

  it('a settled view goes quiet and its distance stops changing (views in which the target used to swing to and fro)', () => {
    const h = makeRig(hf);
    for (const [x, y, d, polar, az] of SWINGING) {
      h.viewAt(x, y, d, polar, az);
      h.frames(200);
      const label = `${x},${y} d ${d} ${polar}° az ${az}`;
      expect(h.frames(40).some(Boolean), `still moving: ${label}`).toBe(false);
      const ds: number[] = [];
      for (let i = 0; i < 20; i++) {
        h.frames(1);
        ds.push(h.rig.cameraState().distance);
      }
      expect((Math.max(...ds) - Math.min(...ds)) / ds[0]!, `distance still changing: ${label}`).toBeLessThan(1e-4);
    }
  });

  it('the target settles at the same distance wherever along the line of sight it starts (it is the ground the middle of the screen shows)', () => {
    const h = makeRig(hf);
    // (below ~22° the rig follows the terrain instead, and the distance stays where it is)
    for (const [x, y, d, polar, az] of SWINGING.filter((v) => v[3] >= 22.5)) {
      h.viewAt(x, y, d, polar, az);
      h.frames(200);
      const rig = h.rig;
      const cam = rig.camera.position.clone();
      const dir = rig.controls.target.clone().sub(cam).normalize();
      const rested = rig.cameraState().distance;
      for (const f of [0.6, 0.85, 1.2, 1.4]) {
        rig.controls.target.copy(cam).addScaledVector(dir, rested * f);
        h.frames(300);
        expect(rig.cameraState().distance, `from ${f} × the distance: ${x},${y} d ${d} ${polar}° az ${az}`).toBeCloseTo(rested, 0);
      }
      expect(rig.camera.position.distanceTo(cam), 'the camera did not move').toBeLessThan(0.01);
    }
  });

  it('settled views over the whole domain come to rest at every angle (a fixed sweep of 2 400 views)', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const h = makeRig(hf);
    const stuck: string[] = [];
    for (const polar of [18, 19, 20, 22, 24, 26, 30, 52, 60, 70, 75, 80])
      for (let k = 0; k < 200; k++) {
        const x = hf.xMin + 600 + rnd() * (hf.xMax - hf.xMin - 1200);
        const y = hf.yMin + 600 + rnd() * (hf.yMax - hf.yMin - 1200);
        const d = [300, 800, 1500, 3000, 5000][Math.floor(rnd() * 5)]!;
        const az = rnd() * 360;
        h.viewAt(x, y, d, polar, az);
        h.frames(200);
        if (h.frames(40).some(Boolean)) stuck.push(`${Math.round(x)},${Math.round(y)} d ${d} ${polar}° az ${Math.round(az)}`);
      }
    expect(stuck, 'views that never came to rest').toEqual([]);
  });
});
