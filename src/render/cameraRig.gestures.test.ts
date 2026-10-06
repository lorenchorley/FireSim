/**
 * The touch state machine of CameraRig, driven with a minimal fake element (no browser): one finger grabs the ground and
 * pans, two fingers pinch and turn at once (OrbitControls' DOLLY_ROTATE), lifting or adding a finger switches without a jump,
 * extra fingers are ignored, cancel / interaction off / a flight end a drag, and a released flick glides on.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeGridSpec } from '../core/grid';
import { CameraRig, GESTURE } from './cameraRig';
import { rayDirection } from './groundPan';
import { HeightField } from './heightfield';

// ───────────── a minimal DOM ─────────────

interface Listener {
  type: string;
  fn: (e: FakeEvent) => void;
  capture: boolean;
}
interface FakeEvent {
  type: string;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  button: number;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  stopped: boolean;
  immediate: boolean;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

class FakeTarget {
  readonly listeners: Listener[] = [];
  addEventListener(type: string, fn: (e: FakeEvent) => void, opts?: boolean | { capture?: boolean }): void {
    this.listeners.push({ type, fn, capture: typeof opts === 'boolean' ? opts : !!opts?.capture });
  }
  removeEventListener(type: string, fn: (e: FakeEvent) => void, opts?: boolean | { capture?: boolean }): void {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this.listeners.splice(i, 1);
  }
}

const W = 400;
const H = 800;

class FakeElement extends FakeTarget {
  readonly style: Record<string, string> = {};
  clientWidth = W;
  clientHeight = H;
  constructor(readonly doc: FakeTarget) {
    super();
  }
  get ownerDocument(): FakeTarget {
    return this.doc;
  }
  getRootNode(): FakeTarget {
    return this.doc;
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
  }

  /** Dispatch like the DOM does for a pointer event on this element: target capture, target bubble, then the document. */
  fire(type: string, init: Partial<FakeEvent>): FakeEvent {
    const e: FakeEvent = {
      type,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: false,
      button: 0,
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      stopped: false,
      immediate: false,
      stopPropagation() {
        this.stopped = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
        this.immediate = true;
      },
      preventDefault() {},
      ...init,
    };
    e.pageX = e.clientX;
    e.pageY = e.clientY;
    const run = (list: Listener[]): void => {
      for (const l of [...list]) {
        if (e.immediate) return;
        l.fn(e);
      }
    };
    const own = this.listeners.filter((l) => l.type === type);
    run(own.filter((l) => l.capture));
    run(own.filter((l) => !l.capture));
    if (!e.stopped) run(this.doc.listeners.filter((l) => l.type === type && !l.capture));
    return e;
  }
}

// ───────────── the rig under test ─────────────

const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, 9000, 50);
function makeHf(): HeightField {
  const z = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++)
    for (let i = 0; i < grid.nx; i++) {
      const x = grid.x0 + i * grid.cellSize;
      const y = grid.y0 + j * grid.cellSize;
      z[j * grid.nx + i] = 600 + 70 * Math.sin(x / 800) * Math.cos(y / 1000) + 0.02 * x;
    }
  return new HeightField(grid, z, 1);
}

interface Rig {
  rig: CameraRig;
  el: FakeElement;
  hf: HeightField;
  /** Advance n frames of 16 ms; returns what update() reported for each. */
  frames(n: number): boolean[];
  /** Let ms of time pass without any frame (the view was covered by a screen, the page was in the background). */
  skip(ms: number): void;
  /** Advance n frames; returns how far (m) the orbit target moved over the ground in each. */
  slide(n: number): number[];
  down(id: number, x: number, y: number, init?: Partial<FakeEvent>): FakeEvent;
  move(id: number, x: number, y: number, init?: Partial<FakeEvent>): FakeEvent;
  up(id: number, init?: Partial<FakeEvent>): FakeEvent;
  cancel(id: number): FakeEvent;
  /** Local (x, y) of the terrain under a canvas position, as the picking does it. */
  pick(x: number, y: number): [number, number];
  /** The same for a canvas of another size (after a resize). */
  pickIn(x: number, y: number, w: number, h: number): [number, number];
  /** Fingers by id. */
  at: Map<number, [number, number]>;
  state(): ReturnType<CameraRig['cameraState']>;
  oc: { state: number; _pointers: number[] };
}

function setup(hf: HeightField = makeHf()): Rig {
  const doc = new FakeTarget();
  const el = new FakeElement(doc);
  const rig = new CameraRig(el as unknown as HTMLElement, W / H);
  rig.setHeightField(hf);
  rig.resize(W / H, W, H);
  rig.home(false);
  let clock = performance.now();
  const at = new Map<number, [number, number]>();
  const r: Rig = {
    rig,
    el,
    hf,
    at,
    frames(n) {
      const out: boolean[] = [];
      for (let i = 0; i < n; i++) {
        clock += 16;
        out.push(rig.update(clock));
      }
      return out;
    },
    skip(ms) {
      clock += ms;
    },
    slide(n) {
      const out: number[] = [];
      let prev = rig.cameraState().target;
      for (let i = 0; i < n; i++) {
        clock += 16;
        rig.update(clock);
        const t = rig.cameraState().target;
        out.push(Math.hypot(t[0] - prev[0], t[1] - prev[1]));
        prev = t;
      }
      return out;
    },
    down(id, x, y, init = {}) {
      const primary = at.size === 0;
      at.set(id, [x, y]);
      return el.fire('pointerdown', { pointerId: id, clientX: x, clientY: y, isPrimary: primary, ...init });
    },
    move(id, x, y, init = {}) {
      at.set(id, [x, y]);
      return el.fire('pointermove', { pointerId: id, clientX: x, clientY: y, ...init });
    },
    up(id, init = {}) {
      const [x, y] = at.get(id) ?? [0, 0];
      at.delete(id);
      return el.fire('pointerup', { pointerId: id, clientX: x, clientY: y, ...init });
    },
    cancel(id) {
      const [x, y] = at.get(id) ?? [0, 0];
      at.delete(id);
      return el.fire('pointercancel', { pointerId: id, clientX: x, clientY: y });
    },
    pick(x, y) {
      return r.pickIn(x, y, W, H);
    },
    pickIn(x, y, w, h) {
      const cam = rig.camera;
      cam.updateMatrixWorld();
      const d = rayDirection(cam, (x / w) * 2 - 1, -(y / h) * 2 + 1, new THREE.Vector3());
      const hit = hf.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z);
      if (!hit) throw new Error(`no ground under ${x},${y}`);
      return [hit.x, hit.y];
    },
    state: () => rig.cameraState(),
    oc: rig.controls as unknown as { state: number; _pointers: number[] },
  };
  r.frames(3);
  return r;
}

/** Drag fingers along a straight line in `steps` hops, a frame after each hop (a real finger: ~60 Hz). */
function drag(r: Rig, moves: { id: number; to: [number, number] }[], steps = 12): void {
  const from = moves.map((m) => r.at.get(m.id)!);
  for (let s = 1; s <= steps; s++) {
    moves.forEach((m, i) => r.move(m.id, from[i]![0] + ((m.to[0] - from[i]![0]) * s) / steps, from[i]![1] + ((m.to[1] - from[i]![1]) * s) / steps));
    r.frames(1);
  }
}

const dist2 = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Ground metres a canvas pixel stands for at the orbit target (the 50° field of view over the canvas height). */
const mppOf = (distance: number): number => (2 * distance * Math.tan(THREE.MathUtils.degToRad(25))) / H;

describe('CameraRig gestures: one finger pans like grabbing the map', () => {
  let r: Rig;
  beforeEach(() => {
    r = setup();
  });

  it('starts from the documented overview and reports the camera as numbers', () => {
    const s = r.state();
    expect(s.mode).toBe('orbit');
    expect(s.azimuthDeg).toBeCloseTo(200, 3);
    expect(s.polarDeg).toBeCloseTo(52, 3);
    expect(s.distance).toBeCloseTo((r.hf.xMax - r.hf.xMin) * 0.95, 0);
    expect(s.headingDeg).toBeCloseTo(20, 2); // looking north-north-east from the south-south-west
    expect(s.target[0]).toBeCloseTo(0, 3);
    expect(s.target[1]).toBeCloseTo(0, 3);
  });

  it('a one-finger drag moves the target, leaves azimuth / tilt / distance alone, and the grabbed ground stays under the finger', () => {
    const before = r.state();
    const grabbed = r.pick(200, 520);
    r.down(1, 200, 520);
    drag(r, [{ id: 1, to: [290, 330] }], 15);
    const mid = r.state();
    r.frames(10);
    r.up(1, { clientX: 290, clientY: 330 });
    r.frames(5);
    const after = r.state();
    expect(dist2(after.target, before.target)).toBeGreaterThan(300);
    expect(after.azimuthDeg).toBeCloseTo(before.azimuthDeg, 6);
    expect(after.polarDeg).toBeCloseTo(before.polarDeg, 4);
    // The camera-to-target distance is unchanged up to the terrain-clearance easing of the target height.
    expect(Math.abs(after.distance / before.distance - 1)).toBeLessThan(0.02);
    // Still the same ground under the finger, within a metre (the target height follows the terrain in 25 % steps).
    expect(dist2(r.pick(290, 330), grabbed)).toBeLessThan(2);
    expect(mid.mode).toBe('orbit');
  });

  it('keeps the ground under the finger with view insets (panels covering the canvas)', () => {
    r.rig.setViewInsets({ top: 70, bottom: 300 }, false);
    r.frames(3);
    const grabbed = r.pick(120, 250);
    r.down(1, 120, 250);
    drag(r, [{ id: 1, to: [260, 400] }], 14);
    r.frames(10);
    expect(dist2(r.pick(260, 400), grabbed)).toBeLessThan(2);
    r.up(1);
  });

  it('is the same in the top view (the finger drags the plan like a map)', () => {
    r.rig.setMode('top');
    r.frames(1);
    // Complete the flight: update() at a time beyond its end.
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    expect(r.state().polarDeg).toBeLessThan(0.2);
    const before = r.state();
    const grabbed = r.pick(250, 300);
    r.down(1, 250, 300);
    drag(r, [{ id: 1, to: [120, 480] }], 12);
    r.frames(8);
    r.up(1);
    const after = r.state();
    expect(dist2(after.target, before.target)).toBeGreaterThan(100);
    expect(after.polarDeg).toBeLessThan(0.2);
    expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeLessThan(0.5);
    expect(dist2(r.pick(120, 480), grabbed)).toBeLessThan(2);
  });

  it('reports "start" when a drag begins and "end" when the last finger lifts (the view\'s interacting flag), for a pen too', () => {
    const seen: string[] = [];
    r.rig.controls.addEventListener('start', () => seen.push('start'));
    r.rig.controls.addEventListener('end', () => seen.push('end'));
    r.down(1, 200, 500);
    expect(seen).toEqual(['start']);
    drag(r, [{ id: 1, to: [200, 400] }], 4);
    r.up(1);
    expect(seen.at(-1)).toBe('end');
    seen.length = 0;
    r.down(1, 200, 500, { pointerType: 'pen', isPrimary: true }); // OrbitControls never sees a pen: the end must come from here
    r.up(1, { pointerType: 'pen' });
    expect(seen).toEqual(['start', 'end']);
    // Two fingers: start once, end once the last one is up.
    seen.length = 0;
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    r.up(1);
    expect(seen.filter((x) => x === 'end')).toEqual([]); // still one finger down (a pan): not over
    r.up(2);
    expect(seen.filter((x) => x === 'end').length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toBe('start');
  });

  it('a tap (no movement) does not move the view; update() reports no motion', () => {
    const before = r.state();
    r.down(1, 200, 400);
    r.frames(4);
    r.up(1);
    const moved = r.frames(5);
    expect(moved.some(Boolean)).toBe(false);
    expect(dist2(r.state().target, before.target)).toBeLessThan(1e-3);
  });

  it('a tap with a few pixels of wobble: the ground under the finger at the lift is the ground that was touched', () => {
    const touched = r.pick(180, 450);
    r.down(1, 180, 450);
    for (const [dx, dy] of [[3, -2], [5, 4], [-2, 6], [4, 3]] as const) {
      r.move(1, 180 + dx, 450 + dy);
      r.frames(1);
    }
    r.up(1, { clientX: 184, clientY: 453 });
    // The host (simScreen) picks at the lift position: the same ground, to a fraction of a pixel.
    expect(dist2(r.pick(184, 453), touched)).toBeLessThan(0.3 * mppOf(r.state().distance));
    expect(r.frames(10).length).toBe(10);
  });

  it('a vertical-exaggeration change during a drag keeps the ground under the finger (the grab is re-taken)', () => {
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [220, 430] }], 6);
    r.frames(25);
    r.hf.vex = 2;
    r.rig.rescaleHeights(1, 2);
    r.frames(25);
    const grabbed = r.pick(220, 430);
    drag(r, [{ id: 1, to: [160, 380] }], 6);
    r.frames(25);
    expect(dist2(r.pick(160, 380), grabbed)).toBeLessThan(2);
    r.up(1);
  });

  it('the target stays inside the domain however far the finger drags', () => {
    r.down(1, 50, 100);
    drag(r, [{ id: 1, to: [350, 780] }], 20);
    for (let k = 0; k < 6; k++) {
      r.move(1, k % 2 ? 50 : 350, k % 2 ? 100 : 780);
      r.frames(20);
    }
    r.up(1);
    r.frames(20);
    const [x, y] = r.state().target;
    expect(Math.abs(x)).toBeLessThanOrEqual(4500 + 1e-3);
    expect(Math.abs(y)).toBeLessThanOrEqual(4500 + 1e-3);
  });

  it('the canvas changing shape under a dragging finger (the phone is turned) does not make the view jump', () => {
    r.down(1, 200, 520);
    drag(r, [{ id: 1, to: [230, 450] }], 6);
    r.frames(3);
    const before = r.state();
    const cam0 = r.rig.camera.position.clone();
    // 400 × 800 → 800 × 400 under the same finger.
    r.el.clientWidth = H;
    r.el.clientHeight = W;
    r.rig.resize(H / W, H, W);
    r.frames(3);
    const after = r.state();
    expect(dist2(after.target, before.target), 'the target did not jump').toBeLessThan(0.5 * mppOf(before.distance));
    expect(r.rig.camera.position.distanceTo(cam0)).toBeLessThan(0.5 * mppOf(before.distance));
    // And the finger carries on grabbing the ground that is under it now.
    const grabbed = r.pickIn(230, 450, H, W);
    drag(r, [{ id: 1, to: [330, 300] }], 6);
    r.frames(3);
    expect(dist2(r.pickIn(330, 300, H, W), grabbed)).toBeLessThan(2);
    r.up(1);
  });

  it('a finger that has pushed on past the edge of the domain and turns back is followed at once (no dead zone)', () => {
    // Push the view against the far edge with repeated drags (each lift lets go of the ground that was grabbed).
    for (let k = 0; k < 8; k++) {
      r.down(1, 200, 150);
      drag(r, [{ id: 1, to: [200, 700] }], 10);
      r.up(1);
      r.frames(60);
    }
    const edge = r.state().target;
    expect(Math.max(Math.abs(edge[0]), Math.abs(edge[1]))).toBeGreaterThan(Math.min(r.hf.xMax, r.hf.yMax) - 1); // at the edge: it cannot go further
    // A new drag that keeps pushing for 400 px, all of it against the edge ...
    r.down(1, 200, 150);
    drag(r, [{ id: 1, to: [200, 550] }], 16);
    expect(dist2(r.state().target, edge)).toBeLessThan(1);
    // ... then turns back by 40 px: the map follows within a few frames (it used to wait until the finger was back where the
    // ground it had grabbed was, 400 px of travel).
    drag(r, [{ id: 1, to: [200, 510] }], 4);
    r.frames(2);
    const mpp = mppOf(r.state().distance);
    expect(dist2(r.state().target, edge), 'the view moved with the finger that turned back').toBeGreaterThan(20 * mpp);
    r.up(1);
  });
});

describe('CameraRig gestures: two fingers turn, tilt and zoom at the same time', () => {
  let r: Rig;
  beforeEach(() => {
    r = setup();
  });

  it('maps to OrbitControls DOLLY_ROTATE with one finger doing nothing there', () => {
    expect(r.rig.controls.touches.ONE ?? null).toBeNull();
    expect(r.rig.controls.touches.TWO).toBe(THREE.TOUCH.DOLLY_ROTATE);
    expect(r.rig.controls.zoomSpeed).toBe(GESTURE.zoomSpeed);
    expect(r.rig.controls.rotateSpeed).toBe(GESTURE.rotateSpeed);
    expect(r.rig.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
    expect(r.rig.controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    expect(r.rig.controls.mouseButtons.MIDDLE).toBe(THREE.MOUSE.DOLLY);
  });

  it('a parallel horizontal drag turns the view (100 px ≈ 30°), target and distance unchanged', () => {
    const before = r.state();
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    drag(r, [
      { id: 1, to: [250, 400] },
      { id: 2, to: [350, 400] },
    ]);
    r.frames(120); // the damping lets the rotation finish
    r.up(2);
    r.up(1);
    const after = r.state();
    const turn = ((after.azimuthDeg - before.azimuthDeg + 540) % 360) - 180;
    expect(Math.abs(turn)).toBeCloseTo(((2 * Math.PI * GESTURE.rotateSpeed * 100) / H) * (180 / Math.PI), 0); // = 30°
    expect(after.polarDeg).toBeCloseTo(before.polarDeg, 3);
    expect(Math.abs(after.distance / before.distance - 1)).toBeLessThan(0.002); // (the target height follows the terrain)
    // The target stays: OrbitControls' zoom-to-cursor, run once per finger event, leaves a small residue (a few px per 100 px).
    expect(dist2(after.target, before.target)).toBeLessThan(15 * mppOf(before.distance));
  });

  it('a parallel vertical drag tilts the view, azimuth / target / distance unchanged', () => {
    const before = r.state();
    r.down(1, 150, 300);
    r.down(2, 250, 300);
    drag(r, [
      { id: 1, to: [150, 400] },
      { id: 2, to: [250, 400] },
    ]);
    r.frames(120);
    r.up(1);
    r.up(2);
    const after = r.state();
    expect(Math.abs(after.polarDeg - before.polarDeg)).toBeCloseTo(30, 0);
    expect(after.azimuthDeg).toBeCloseTo(before.azimuthDeg, 3);
    expect(Math.abs(after.distance / before.distance - 1)).toBeLessThan(0.002);
    expect(dist2(after.target, before.target)).toBeLessThan(15 * mppOf(before.distance));
  });

  it('a pinch zooms 1 : 1 (spacing × 3 → distance ÷ 3, and back), azimuth / tilt unchanged', () => {
    const before = r.state();
    r.down(1, 150, 400);
    r.down(2, 250, 400); // the midpoint is the centre of the canvas
    drag(r, [
      { id: 1, to: [50, 400] },
      { id: 2, to: [350, 400] },
    ]);
    r.frames(30);
    const mid = r.state();
    expect(mid.distance / before.distance).toBeCloseTo(1 / 3, 2);
    expect(Math.abs(mid.azimuthDeg - before.azimuthDeg)).toBeLessThan(0.05);
    expect(Math.abs(mid.polarDeg - before.polarDeg)).toBeLessThan(0.05);
    drag(r, [
      { id: 1, to: [150, 400] },
      { id: 2, to: [250, 400] },
    ]);
    r.frames(30);
    r.up(1);
    r.up(2);
    expect(r.state().distance / before.distance).toBeCloseTo(1, 2);
  });

  it('a pinch and a drag at the same time zoom AND turn / tilt (no mode lock)', () => {
    const before = r.state();
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    // The fingers spread to 3 × the spacing while their midpoint moves 80 px right and 60 px down.
    drag(
      r,
      [
        { id: 1, to: [330 - 150 - 0, 460] },
        { id: 2, to: [330 + 150, 460] },
      ],
      16,
    );
    r.frames(120);
    r.up(1);
    r.up(2);
    const after = r.state();
    expect(after.distance / before.distance).toBeLessThan(0.45);
    expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeGreaterThan(5);
    expect(Math.abs(after.polarDeg - before.polarDeg)).toBeGreaterThan(5);
  });

  it('the top view cannot tilt: two fingers turn and zoom only', () => {
    r.rig.setMode('top');
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    const before = r.state();
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    drag(r, [
      { id: 1, to: [150, 520] },
      { id: 2, to: [330, 520] },
    ]);
    r.frames(120);
    r.up(1);
    r.up(2);
    const after = r.state();
    expect(after.polarDeg).toBeLessThan(0.2);
    expect(after.distance / before.distance).toBeLessThan(0.65); // the spacing grew from 100 to 180
    // The midpoint moved 40 px to the right: 40 / 800 of a height = 12° of turn.
    expect(Math.abs(((after.azimuthDeg - before.azimuthDeg + 540) % 360) - 180)).toBeGreaterThan(9);
    expect(r.state().mode).toBe('top');
  });
});

describe('CameraRig gestures: switching between one and two fingers', () => {
  let r: Rig;
  beforeEach(() => {
    r = setup();
  });

  it('a second finger during a pan switches to the two-finger gesture without a jump', () => {
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [220, 420] }], 8);
    r.frames(2);
    r.frames(25); // the target height has followed the terrain
    const t = r.state();
    r.down(2, 300, 420); // second finger: pinch / turn from here
    r.frames(3);
    const t2 = r.state();
    expect(dist2(t2.target, t.target)).toBeLessThan(0.2);
    expect(t2.distance / t.distance).toBeCloseTo(1, 4);
    expect(t2.azimuthDeg).toBeCloseTo(t.azimuthDeg, 3);
    // And the pan no longer moves the view (the two-finger gesture does): fingers moving together turn, not pan.
    drag(r, [
      { id: 1, to: [240, 420] },
      { id: 2, to: [320, 420] },
    ]);
    r.frames(60);
    const t3 = r.state();
    expect(dist2(t3.target, t.target)).toBeLessThan(15 * mppOf(t.distance)); // turned about the target, not panned
    expect(Math.abs(t3.azimuthDeg - t.azimuthDeg)).toBeGreaterThan(2);
    r.up(2);
    r.up(1);
  });

  it('lifting one finger of a two-finger gesture carries on as a pan from where the other finger is, without a jump', () => {
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    drag(r, [
      { id: 1, to: [150, 430] },
      { id: 2, to: [250, 430] },
    ]);
    r.frames(120);
    const before = r.state();
    const under = r.pick(250, 430);
    r.up(1);
    r.frames(2);
    const after = r.state();
    expect(dist2(after.target, before.target)).toBeLessThan(0.2);
    expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeLessThan(0.05);
    // The remaining finger now pans: the ground that was under it follows it.
    drag(r, [{ id: 2, to: [180, 520] }], 12);
    r.frames(10);
    const moved = r.state();
    expect(dist2(moved.target, before.target)).toBeGreaterThan(200);
    expect(moved.azimuthDeg).toBeCloseTo(before.azimuthDeg, 3);
    expect(moved.polarDeg).toBeCloseTo(before.polarDeg, 3);
    expect(dist2(r.pick(180, 520), under)).toBeLessThan(3);
    r.up(2);
  });

  it('1 → 2 → 1 → 2 → 0 fingers in a row stays consistent: no stuck state, no exceptions', () => {
    for (let round = 0; round < 3; round++) {
      r.down(1, 180, 400);
      r.down(2, 260, 400);
      drag(r, [{ id: 2, to: [300, 420] }], 4);
      r.up(1);
      drag(r, [{ id: 2, to: [260, 470] }], 4);
      r.down(3 + round, 100, 300);
      drag(r, [{ id: 3 + round, to: [140, 330] }], 4);
      r.up(2);
      r.up(3 + round);
      r.frames(80);
      expect(r.oc._pointers.length).toBe(0);
    }
    // After all that one finger still pans.
    const before = r.state();
    r.down(1, 200, 450);
    drag(r, [{ id: 1, to: [200, 350] }], 8);
    r.frames(5);
    r.up(1);
    expect(dist2(r.state().target, before.target)).toBeGreaterThan(100);
  });

  it('fingers beyond the second are ignored: the two-finger gesture carries on, nothing jumps', () => {
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    drag(r, [
      { id: 1, to: [110, 400] },
      { id: 2, to: [290, 400] },
    ]);
    r.frames(10);
    const a = r.state();
    expect(r.oc._pointers.length).toBe(2);
    const third = r.down(3, 200, 700);
    expect(third.immediate).toBe(true); // stopped before OrbitControls could see it
    expect(r.oc._pointers.length).toBe(2);
    r.frames(2);
    // The third finger wanders about: nothing changes.
    const wander = r.move(3, 50, 100);
    expect(wander.immediate).toBe(true);
    r.move(3, 380, 780);
    r.frames(3);
    const b = r.state();
    expect(dist2(b.target, a.target)).toBeLessThan(0.5);
    expect(b.distance / a.distance).toBeCloseTo(1, 3);
    // The pinch still works with the extra finger down: spacing 180 → 90 halves... doubles the distance.
    drag(r, [
      { id: 1, to: [155, 400] },
      { id: 2, to: [245, 400] },
    ]);
    r.frames(5);
    expect(r.state().distance / a.distance).toBeCloseTo(2, 1);
    expect(r.up(3).immediate).toBe(true);
    expect(r.oc._pointers.length).toBe(2);
    r.up(1);
    r.up(2);
    expect(r.oc._pointers.length).toBe(0);
  });

  it('when the first of three fingers lifts, the second carries on as a pan and the extra stays ignored', () => {
    r.down(1, 150, 400);
    r.down(2, 250, 400);
    r.down(3, 200, 650);
    r.up(1);
    r.frames(2);
    const before = r.state();
    drag(r, [{ id: 2, to: [250, 330] }], 8);
    r.frames(8);
    expect(dist2(r.state().target, before.target)).toBeGreaterThan(100);
    drag(r, [{ id: 3, to: [100, 700] }], 4);
    r.up(3);
    r.up(2);
  });
});

describe('CameraRig gestures: cancel, interaction off, flights, glide', () => {
  let r: Rig;
  beforeEach(() => {
    r = setup();
  });

  it('pointercancel ends the pan without a glide', () => {
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [200, 250] }], 6); // a fast flick
    r.frames(25);
    const t = r.state().target;
    r.cancel(1);
    expect(Math.max(...r.slide(40))).toBeLessThan(1e-3);
    expect(dist2(r.state().target, t)).toBeLessThan(1e-3);
    // A fresh touch pans again.
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [200, 400] }], 5);
    r.frames(3);
    expect(dist2(r.state().target, t)).toBeGreaterThan(50);
    r.up(1);
  });

  it('lostpointercapture of a finger that is still down ends it like a cancel', () => {
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [200, 250] }], 6);
    r.frames(25);
    const t = r.state().target;
    r.el.fire('lostpointercapture', { pointerId: 1 });
    expect(Math.max(...r.slide(40))).toBeLessThan(1e-3);
    expect(dist2(r.state().target, t)).toBeLessThan(1e-3);
    r.at.clear();
  });

  it('with interaction off (finger drawing) nothing pans, glides or is tracked; switching it on again works', () => {
    r.rig.setInteractionEnabled(false);
    const t = r.state().target;
    const e = r.down(1, 200, 500);
    expect(e.immediate).toBe(false);
    drag(r, [{ id: 1, to: [200, 300] }], 8);
    r.up(1);
    r.frames(10);
    expect(dist2(r.state().target, t)).toBeLessThan(1e-3);
    r.rig.setInteractionEnabled(true);
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [200, 400] }], 6);
    r.frames(4);
    r.up(1);
    expect(dist2(r.state().target, t)).toBeGreaterThan(50);
  });

  it('switching interaction off mid-drag stops the drag and its glide', () => {
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [200, 300] }], 8);
    r.frames(25);
    const t = r.state().target;
    r.rig.setInteractionEnabled(false);
    r.up(1);
    expect(Math.max(...r.slide(40))).toBeLessThan(1e-3);
    expect(dist2(r.state().target, t)).toBeLessThan(1e-3);
  });

  it('a flight (fly to the fire, a view-mode change) ignores fingers and ends a drag in progress', () => {
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [220, 420] }], 6);
    r.rig.flyTo(500, 400, 3000);
    expect(r.rig.flying).toBe(true);
    // The finger that was down no longer pans, even though it keeps moving.
    drag(r, [{ id: 1, to: [320, 300] }], 6);
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    expect(r.rig.flying).toBe(false);
    const landed = r.state();
    expect(landed.target[0]).toBeCloseTo(500, 0);
    expect(landed.target[1]).toBeCloseTo(400, 0);
    // The old finger is still ignored after the flight (a pan is never resumed behind the user's back) ...
    drag(r, [{ id: 1, to: [200, 200] }], 6);
    r.frames(5);
    expect(dist2(r.state().target, landed.target)).toBeLessThan(0.5);
    r.up(1);
    // ... and a new one works.
    r.down(1, 200, 500);
    drag(r, [{ id: 1, to: [200, 400] }], 6);
    r.frames(4);
    r.up(1);
    expect(dist2(r.state().target, landed.target)).toBeGreaterThan(50);
  });

  it('a finger put down during a flight is ignored', () => {
    r.rig.flyTo(-900, 600, 2500);
    const e = r.down(1, 200, 500);
    expect(e.immediate).toBe(false);
    drag(r, [{ id: 1, to: [200, 300] }], 6);
    r.up(1);
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    const s = r.state();
    expect(s.target[0]).toBeCloseTo(-900, 0);
    expect(s.target[1]).toBeCloseTo(600, 0);
  });

  it('a fast flick glides on after the finger lifts (about 250 ms time constant), keeps update() reporting motion, and ends by itself', () => {
    r.down(1, 200, 600);
    // 1000 px/s: 16 px per 16 ms frame, for 24 frames.
    for (let i = 1; i <= 24; i++) {
      r.move(1, 200, 600 - 16 * i);
      r.frames(1);
    }
    const lifted = r.state().target;
    r.up(1);
    const moved: boolean[] = [];
    const steps: number[] = [];
    for (let i = 0; i < 90; i++) {
      const before = r.state().target;
      moved.push(r.frames(1)[0]!);
      steps.push(dist2(r.state().target, before));
    }
    const end = r.state().target;
    const mpp = (2 * r.state().distance * Math.tan(THREE.MathUtils.degToRad(25))) / H;
    // The glide is short and update() keeps reporting motion while it runs.
    expect(moved[0]).toBe(true);
    expect(moved[10]).toBe(true);
    expect(moved[20]).toBe(true);
    const last = steps.reduce((l, m, i) => (m > 0.2 * mpp ? i : l), -1); // last frame in which the view still moved by more than 0.2 px
    expect(last).toBeGreaterThan(25); // ≥ 0.4 s
    expect(last).toBeLessThan(80); // < 1.3 s
    // Exponential: the speed after one time constant (16 frames of 16 ms ≈ 256 ms) is about 1/e of the start.
    expect(steps[17]! / steps[1]!).toBeGreaterThan(0.25);
    expect(steps[17]! / steps[1]!).toBeLessThan(0.5);
    // It covered about v0 · τ = 1000 px · 0.25 s = 250 px of the finger's ground.
    const glided = dist2(end, lifted) / mpp;
    expect(glided).toBeGreaterThan(100);
    expect(glided).toBeLessThan(500);
    // A touch during the glide stops it dead.
    r.down(1, 200, 600);
    for (let i = 1; i <= 24; i++) {
      r.move(1, 200, 600 - 16 * i);
      r.frames(1);
    }
    r.up(1);
    r.frames(5);
    const t = r.state().target;
    r.down(2, 100, 100);
    r.frames(30);
    expect(dist2(r.state().target, t)).toBeLessThan(0.5);
    r.up(2);
  });

  it('a glide does not carry on (or jump ahead) after the frames stopped for a while, e.g. a screen covered the map', () => {
    r.down(1, 200, 600);
    for (let i = 1; i <= 12; i++) {
      r.move(1, 200, 600 - 16 * i);
      r.frames(1);
    }
    r.up(1);
    r.frames(2);
    expect(r.rig.gliding).toBe(true);
    const t = r.state().target;
    r.skip(3000); // the view was covered for three seconds: no frames
    r.frames(1);
    expect(r.rig.gliding).toBe(false);
    r.frames(60);
    expect(dist2(r.state().target, t)).toBeLessThan(1);
  });

  it('a slow release and a rest before lifting do not glide', () => {
    r.down(1, 200, 500);
    for (let i = 1; i <= 20; i++) {
      r.move(1, 200, 500 - 2 * i); // 125 px/s
      r.frames(1);
    }
    r.frames(15); // the finger rests
    r.frames(10);
    const t = r.state().target;
    r.up(1);
    expect(Math.max(...r.slide(40))).toBeLessThan(0.01);
    expect(dist2(r.state().target, t)).toBeLessThan(0.01);
  });

  it('a flight, a mode change and zoomBy end a glide', () => {
    const flick = (): void => {
      r.down(1, 200, 600);
      for (let i = 1; i <= 24; i++) {
        r.move(1, 200, 600 - 16 * i);
        r.frames(1);
      }
      r.up(1);
    };
    flick();
    r.frames(3);
    const before = r.state().target;
    r.rig.zoomBy(0.8); // a short flight
    for (let i = 0; i < 60 && r.rig.flying; i++) r.frames(1);
    expect(dist2(r.state().target, before)).toBeLessThan(1); // the glide did not carry on during or after it
    r.frames(30);
    expect(dist2(r.state().target, before)).toBeLessThan(1);
    flick();
    r.frames(3);
    r.rig.setMode('top');
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    expect(r.state().mode).toBe('top');
  });

  it('dispose removes the pointer listeners', () => {
    const n = r.el.listeners.length;
    expect(n).toBeGreaterThan(5);
    r.rig.dispose();
    expect(r.el.listeners.length).toBe(0);
    expect(r.el.doc.listeners.length).toBe(0);
  });
});

describe('CameraRig gestures: eye level, mouse, pen', () => {
  let r: Rig;
  beforeEach(() => {
    r = setup();
  });

  it('a finger that is still down when the view mode changes does not carry on rotating the new view (one-finger rotate is eye level)', () => {
    r.rig.setMode('ground', { user: [0, 0] });
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    r.down(1, 200, 400);
    drag(r, [{ id: 1, to: [240, 420] }], 4);
    expect(r.oc.state, 'looking around with one finger').toBe(3);
    r.frames(60); // (the damping of that turn has run out)
    r.rig.setMode('orbit');
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    const before = r.state();
    drag(r, [{ id: 1, to: [320, 520] }], 8);
    r.frames(30);
    const after = r.state();
    expect(after.mode).toBe('orbit');
    expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeLessThan(0.1);
    expect(Math.abs(after.polarDeg - before.polarDeg)).toBeLessThan(0.1);
    r.up(1);
    // The next touch pans as usual.
    r.down(1, 200, 520);
    drag(r, [{ id: 1, to: [200, 400] }], 8);
    r.frames(5);
    r.up(1);
    expect(dist2(r.state().target, before.target)).toBeGreaterThan(50);
  });

  it('eye level stays a first-person look-around: one finger turns the view, the eye does not move, an extra finger is ignored', () => {
    r.rig.setMode('ground', { user: [100, -200], lookAt: [900, 600] });
    for (let i = 0; i < 400 && r.rig.flying; i++) r.frames(1);
    r.frames(5);
    const eye = r.rig.camera.position.clone();
    const h0 = r.state().headingDeg;
    r.down(1, 200, 400);
    drag(r, [{ id: 1, to: [300, 400] }], 10);
    r.frames(80);
    const h1 = r.state().headingDeg;
    expect(Math.abs(((h1 - h0 + 540) % 360) - 180)).toBeGreaterThan(5);
    expect(r.rig.camera.position.distanceTo(eye)).toBeLessThan(0.05);
    // Two fingers also look around; a third is ignored.
    r.down(2, 100, 400);
    const third = r.down(3, 50, 50);
    expect(third.immediate).toBe(true);
    drag(r, [{ id: 2, to: [60, 400] }], 5);
    r.frames(60);
    expect(r.rig.camera.position.distanceTo(eye)).toBeLessThan(0.05);
    expect(r.state().mode).toBe('ground');
    r.up(3);
    r.up(2);
    r.up(1);
  });

  it('the mouse is left to OrbitControls: left drag pans, right drag rotates (orbit view), no glide', () => {
    const before = r.state();
    r.down(1, 200, 500, { pointerType: 'mouse', button: 0, isPrimary: true });
    expect(r.oc.state).toBeGreaterThan(-1);
    for (let i = 1; i <= 10; i++) {
      r.move(1, 200, 500 - 20 * i, { pointerType: 'mouse' });
      r.frames(1);
    }
    r.up(1, { pointerType: 'mouse' });
    r.frames(30);
    const panned = r.state();
    expect(dist2(panned.target, before.target)).toBeGreaterThan(100);
    expect(panned.azimuthDeg).toBeCloseTo(before.azimuthDeg, 4);
    expect(panned.polarDeg).toBeCloseTo(before.polarDeg, 3);
    r.down(1, 200, 500, { pointerType: 'mouse', button: 2, isPrimary: true });
    for (let i = 1; i <= 10; i++) {
      r.move(1, 200 + 10 * i, 500 + 10 * i, { pointerType: 'mouse' });
      r.frames(1);
    }
    r.up(1, { pointerType: 'mouse', button: 2 });
    r.frames(120);
    const rotated = r.state();
    expect(Math.abs(rotated.azimuthDeg - panned.azimuthDeg)).toBeGreaterThan(5);
    expect(Math.abs(rotated.polarDeg - panned.polarDeg)).toBeGreaterThan(5);
  });

  it('a pen pans like a finger and is hidden from OrbitControls (which would pan a second time as a mouse)', () => {
    const before = r.state();
    const e = r.down(1, 200, 500, { pointerType: 'pen', isPrimary: true });
    expect(e.immediate).toBe(true);
    expect(r.oc._pointers.length).toBe(0);
    for (let i = 1; i <= 10; i++) {
      const m = r.move(1, 200, 500 - 12 * i, { pointerType: 'pen' });
      expect(m.immediate).toBe(true);
      r.frames(1);
    }
    r.up(1, { pointerType: 'pen' });
    r.frames(60);
    const after = r.state();
    // 120 px of finger → the grabbed ground followed it (not OrbitControls' lagging pan on top of it).
    expect(dist2(after.target, before.target)).toBeGreaterThan(100);
    expect(after.azimuthDeg).toBeCloseTo(before.azimuthDeg, 4);
    expect(r.oc._pointers.length).toBe(0);
  });
});

describe('CameraRig gestures: a drag on rugged terrain at a flat viewing angle is steady', () => {
  // Steep ridges and valleys (slopes up to ~0.6 on top of a general rise), viewed at a low angle from 2 km: the finger grabs
  // ground far away where a small change of the camera's height moves the ground under the finger by several times as much
  // horizontally. If the target's height followed the terrain while the finger drags, that correction would feed back on itself.
  function ruggedHf(): HeightField {
    const z = new Float32Array(grid.nx * grid.ny);
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const x = grid.x0 + i * grid.cellSize;
        const y = grid.y0 + j * grid.cellSize;
        z[j * grid.nx + i] = 700 + 450 * Math.sin(x / 450) * Math.cos(y / 520) + 0.04 * x + 0.03 * y;
      }
    return new HeightField(grid, z, 1);
  }

  /** The default camera of the view tests, but `distance` from the target at `polarDeg` (azimuth 200°). */
  function viewAt(r: Rig, distance: number, polarDeg: number): void {
    const t = r.rig.groundPoint(0, 0);
    const az = THREE.MathUtils.degToRad(200);
    const po = THREE.MathUtils.degToRad(polarDeg);
    r.rig.goTo(t, new THREE.Vector3(t.x + Math.sin(az) * Math.sin(po) * distance, t.y + Math.cos(po) * distance, t.z - Math.cos(az) * Math.sin(po) * distance), 0);
    r.frames(30);
  }

  /** Canvas position (px) of a local ground point. */
  function screenOfGround(r: Rig, p: [number, number]): [number, number] {
    const v = r.rig.groundPoint(p[0], p[1]).project(r.rig.camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  }

  for (const [polar, y0] of [
    [70, 260],
    [70, 330],
    [75, 330],
    [62, 200],
  ] as const) {
    it(`polar ${polar}°, finger down at y ${y0}: the camera follows the finger smoothly (no flip-flop) and the grabbed ground stays under it`, () => {
      const r = setup(ruggedHf());
      viewAt(r, 2000, polar);
      const x0 = 200;
      const grabbed = r.pick(x0, y0);
      r.down(1, x0, y0);
      const positions: THREE.Vector3[] = [r.rig.camera.position.clone()];
      for (let i = 1; i <= 24; i++) {
        r.move(1, x0, y0 + 2.5 * i); // 150 px/s
        r.frames(1);
        positions.push(r.rig.camera.position.clone());
      }
      r.frames(6);
      positions.push(r.rig.camera.position.clone());
      const steps: number[] = [];
      for (let i = 1; i < positions.length; i++) steps.push(Math.hypot(positions[i]!.x - positions[i - 1]!.x, positions[i]!.z - positions[i - 1]!.z));
      const path = steps.reduce((a, b) => a + b, 0);
      const net = Math.hypot(positions.at(-1)!.x - positions[0]!.x, positions.at(-1)!.z - positions[0]!.z);
      const peak = Math.max(...steps);
      if (process.env.RV_DEBUG) console.log(polar, y0, 'path', Math.round(path), 'net', Math.round(net), 'peak', Math.round(peak), steps.map((v) => Math.round(v)).join(' '));
      // The finger moved at a constant speed: the camera travels (about) straight, at about a constant speed.
      expect(path, 'path length / net displacement').toBeLessThan(1.15 * net);
      expect(peak, 'largest frame step / average step').toBeLessThan(3 * (path / steps.length));
      // And the ground under the finger is still the ground that was grabbed (screen px).
      const now = screenOfGround(r, grabbed);
      expect(Math.hypot(now[0] - x0, now[1] - (y0 + 60)), 'grab error (px)').toBeLessThan(3);
      // After the finger lifts the height follows the terrain again, but gently: the view settles over about half a second
      // instead of lurching (it may have to move by a hundred pixels or so after a drag over high relief).
      r.up(1, { clientX: x0, clientY: y0 + 60 });
      let prev = screenOfGround(r, grabbed);
      let worst = 0;
      for (let i = 0; i < 45; i++) {
        r.frames(1);
        const p = screenOfGround(r, grabbed);
        worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[1] - prev[1]));
        prev = p;
      }
      expect(worst, 'largest on-screen step of the ground after the lift (px per frame)').toBeLessThan(10);
    });
  }
});
