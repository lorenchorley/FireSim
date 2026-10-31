/**
 * The two-finger turn of 0.7.0 (`twoFingerTurn.ts`, OrbitControls' public API only) against the one of 0.6.0 (`testing/cameraRig060.ts`,
 * the old rig frozen, which overrides OrbitControls' private `_rotateLeft` and `_handleTouchMoveDollyRotate`). Both rigs are driven
 * with the same scripted fingers, mouse, mode changes and flights and a fake clock, and every frame is compared: the camera, the
 * orbit target, the camera's orientation, the reported compass numbers, whether `update()` said it moved, OrbitControls' gesture
 * state and its pointer count. Nothing may differ beyond rounding (the new turn goes through Cartesian and back each frame, the old one
 * stays in spherical coordinates inside OrbitControls: about 1e-12 relative, not bitwise).
 *
 * The scenarios are the ones the 0.6.0 verifier used (27 of them) plus the awkward ones: a flight, a mode change, interaction
 * off or a cancel in the middle of a turn, no damping, another damping factor, and a seeded random walk of fingers, modes and
 * flights. A harness that compared two stuck rigs would pass too, so each scenario says how far it must have moved, and the
 * sign of the turn is checked on its own.
 */
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeGridSpec } from '../core/grid';
import type { CameraState } from './api';
import { CameraRig, GESTURE } from './cameraRig';
import { HeightField } from './heightfield';
import { CameraRig as CameraRig060, GESTURE as GESTURE060 } from './testing/cameraRig060';
import { FakeElement, FakeTarget, H, W, katoombaHeightField } from './testing/rigHarness';

// 0.7.0 made the rotation 15 % faster on purpose (`GESTURE.rotateSpeed` 2/3 → 2/3 · 1.15, a change of that one constant). The frozen
// reference still says 2/3, so it is set to the new value here, before any rig is built (its constructor and every mode change read it):
// this file proves that the new turn is the old ARITHMETIC (OrbitControls' step, damping, limits), frame by frame, and the speed is the
// one thing that differs between the sources. Nothing else of the reference is touched and no tolerance below is wider for it.
(GESTURE060 as { rotateSpeed: number }).rotateSpeed = GESTURE.rotateSpeed;

let fake = 5_000_000;
vi.spyOn(performance, 'now').mockImplementation(() => fake);

/** What the two rigs have in common (the frozen one has other private members). */
interface RigLike {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly flying: boolean;
  setHeightField(hf: HeightField): void;
  resize(aspect: number, width?: number, height?: number): void;
  home(animate?: boolean): void;
  update(now: number): boolean;
  cameraState(): CameraState;
  setMode(mode: 'orbit' | 'top' | 'ground', opts?: { user?: [number, number] | null; lookAt?: [number, number] | null }): void;
  flyTo(x: number, y: number, distance?: number): void;
  zoomBy(factor: number): void;
  setInteractionEnabled(on: boolean): void;
  dispose(): void;
}
type RigCtor = new (dom: HTMLElement, aspect: number) => RigLike;

const grid = makeGridSpec({ lat: -33.7, lon: 150.3 }, 9000, 50);
function terrain(): HeightField {
  const z = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++)
    for (let i = 0; i < grid.nx; i++) {
      const x = grid.x0 + i * grid.cellSize;
      const y = grid.y0 + j * grid.cellSize;
      z[j * grid.nx + i] = 600 + 70 * Math.sin(x / 800) * Math.cos(y / 1000) + 0.02 * x;
    }
  return new HeightField(grid, z, 1);
}

interface Snap {
  p: [number, number, number];
  t: [number, number, number];
  q: [number, number, number, number];
  az: number;
  polar: number;
  dist: number;
  heading: number;
  mode: string;
  moved: boolean;
  /** OrbitControls' gesture state and how many pointers it tracks. */
  state: number;
  pointers: number;
  /** `enableRotate` (the new turn holds it false while two fingers are down). */
  rot: boolean;
  /** The scripted step that was running (random walks only), for the message of a difference. */
  op: string;
}
type Init = Record<string, unknown>;

class Sim {
  readonly el = new FakeElement(new FakeTarget());
  readonly rig: RigLike;
  readonly at = new Map<number, [number, number]>();
  readonly trace: Snap[] = [];
  readonly events: string[] = [];
  op = '';
  /** Fingers that went down while the controls were off (a flight, finger drawing): nothing tracks them; see `play`. */
  readonly ghosts = new Set<number>();
  /** Every scripted step with the number of frames before it (random walks only). */
  readonly log: { frame: number; op: string }[] = [];
  private readonly oc: { state: number; _pointers: number[] };

  constructor(Rig: RigCtor, hf: HeightField = terrain()) {
    fake = 5_000_000;
    this.rig = new Rig(this.el as unknown as HTMLElement, W / H);
    this.rig.setHeightField(hf);
    this.rig.resize(W / H, W, H);
    this.rig.home(false);
    this.rig.controls.addEventListener('start', () => this.events.push('start'));
    this.rig.controls.addEventListener('end', () => this.events.push('end'));
    this.oc = this.rig.controls as unknown as { state: number; _pointers: number[] };
    this.frames(3);
  }

  snap(moved: boolean): Snap {
    const s = this.rig.cameraState();
    const p = this.rig.camera.position;
    const t = this.rig.controls.target;
    const q = this.rig.camera.quaternion;
    return {
      p: [p.x, p.y, p.z],
      t: [t.x, t.y, t.z],
      q: [q.x, q.y, q.z, q.w],
      az: s.azimuthDeg,
      polar: s.polarDeg,
      dist: s.distance,
      heading: s.headingDeg,
      mode: s.mode,
      moved,
      state: this.oc.state,
      pointers: this.oc._pointers.length,
      rot: this.rig.controls.enableRotate,
      op: this.op,
    };
  }
  frames(n: number): void {
    for (let i = 0; i < n; i++) {
      fake += 16;
      const moved = this.rig.update(fake);
      this.trace.push(this.snap(moved));
    }
  }
  fire(type: string, init: Init): void {
    this.el.fire(type, init as never);
  }
  down(id: number, x: number, y: number, init: Init = {}): void {
    const primary = this.at.size === 0;
    if (this.rig.controls.enabled) this.ghosts.delete(id);
    else this.ghosts.add(id);
    this.at.set(id, [x, y]);
    this.fire('pointerdown', { pointerId: id, clientX: x, clientY: y, isPrimary: primary, ...init });
  }
  move(id: number, x: number, y: number, init: Init = {}): void {
    this.at.set(id, [x, y]);
    this.fire('pointermove', { pointerId: id, clientX: x, clientY: y, ...init });
  }
  up(id: number, init: Init = {}): void {
    const [x, y] = this.at.get(id) ?? [0, 0];
    this.at.delete(id);
    this.fire('pointerup', { pointerId: id, clientX: x, clientY: y, ...init });
  }
  cancel(id: number): void {
    const [x, y] = this.at.get(id) ?? [0, 0];
    this.at.delete(id);
    this.fire('pointercancel', { pointerId: id, clientX: x, clientY: y });
  }
  lost(id: number): void {
    const [x, y] = this.at.get(id) ?? [0, 0];
    this.at.delete(id);
    this.fire('lostpointercapture', { pointerId: id, clientX: x, clientY: y });
  }
  drag(moves: { id: number; to: [number, number] }[], steps = 12, init: Init = {}): void {
    const from = moves.map((m) => this.at.get(m.id)!);
    for (let s = 1; s <= steps; s++) {
      moves.forEach((m, i) => this.move(m.id, from[i]![0] + ((m.to[0] - from[i]![0]) * s) / steps, from[i]![1] + ((m.to[1] - from[i]![1]) * s) / steps, init));
      this.frames(1);
    }
  }
  /** Two fingers 100 px apart, the midpoint moved by (dx, dy), the spacing times `spread`, then lifted after `rest` frames. */
  two(dx: number, dy: number, spread = 1, steps = 12, rest = 120): void {
    this.down(1, 150, 400);
    this.down(2, 250, 400);
    this.drag(
      [
        { id: 1, to: [200 + dx - 50 * spread, 400 + dy] },
        { id: 2, to: [200 + dx + 50 * spread, 400 + dy] },
      ],
      steps,
    );
    this.frames(rest);
    this.up(2);
    this.up(1);
    this.frames(5);
  }
  toMode(m: 'orbit' | 'top' | 'ground', opts = {}): void {
    this.rig.setMode(m, opts);
    this.finishFlight();
    this.frames(5);
  }
  finishFlight(): void {
    for (let i = 0; i < 400 && this.rig.flying; i++) this.frames(1);
  }
}

/** Two fingers down at 150 and 250, dragged to the right by `dx` px (spread 1) in `steps` hops, a frame after each. */
function twoDown(s: Sim, dx = 60, steps = 6): void {
  s.down(1, 150, 400);
  s.down(2, 250, 400);
  s.drag(
    [
      { id: 1, to: [150 + dx, 400] },
      { id: 2, to: [250 + dx, 400] },
    ],
    steps,
  );
}
/** Both fingers on the screen drift on, `dx` px to the right, wherever they are. */
function drift(s: Sim, dx: number, steps = 6): void {
  const a = s.at.get(1)!;
  const b = s.at.get(2)!;
  s.drag(
    [
      { id: 1, to: [a[0] + dx, a[1] + 10] },
      { id: 2, to: [b[0] + dx, b[1] + 10] },
    ],
    steps,
  );
}
function liftAll(s: Sim): void {
  for (const id of [...s.at.keys()]) s.up(id);
  s.frames(120);
}

interface Scenario {
  run(s: Sim): void;
  /** The camera must have moved at least this far (degrees of azimuth + polar angle, or relative change of distance x 100) or the scenario proves nothing. */
  moves: number;
  /** Anything done to a rig before the scenario (damping). */
  setup?(s: Sim): void;
}

const scenarios: Record<string, Scenario> = {
  // ── nothing of the two-finger turn is involved: the update() override must be invisible
  'one finger pan with a flick glide': {
    moves: 1,
    run: (s) => {
      s.down(1, 200, 500);
      s.drag([{ id: 1, to: [330, 300] }], 8);
      s.up(1);
      s.frames(90);
    },
  },
  'one finger pan, slow release (no glide)': {
    moves: 1,
    run: (s) => {
      s.down(1, 200, 500);
      s.drag([{ id: 1, to: [260, 440] }], 10);
      s.frames(30);
      s.up(1);
      s.frames(60);
    },
  },
  'pen pan': {
    moves: 1,
    run: (s) => {
      s.down(1, 200, 500, { pointerType: 'pen', isPrimary: true });
      s.drag([{ id: 1, to: [200, 380] }], 10, { pointerType: 'pen' });
      s.up(1, { pointerType: 'pen' });
      s.frames(60);
    },
  },
  'mouse: left pan, right rotate, wheel': {
    moves: 5,
    run: (s) => {
      s.down(1, 200, 500, { pointerType: 'mouse', button: 0, isPrimary: true });
      for (let i = 1; i <= 10; i++) {
        s.move(1, 200, 500 - 20 * i, { pointerType: 'mouse' });
        s.frames(1);
      }
      s.up(1, { pointerType: 'mouse', button: 0 });
      s.frames(30);
      s.down(1, 200, 500, { pointerType: 'mouse', button: 2, isPrimary: true });
      for (let i = 1; i <= 10; i++) {
        s.move(1, 200 + 10 * i, 500 + 10 * i, { pointerType: 'mouse' });
        s.frames(1);
      }
      s.up(1, { pointerType: 'mouse', button: 2 });
      s.frames(120);
      for (const dy of [-300, -300, 200]) {
        s.fire('wheel', { deltaY: dy, clientX: 200, clientY: 400 });
        s.frames(10);
      }
    },
  },
  'eye level: one-finger look-around, a second finger, a third': {
    moves: 5,
    run: (s) => {
      s.toMode('ground', { user: [100, -200], lookAt: [900, 600] });
      s.down(1, 200, 400);
      s.drag([{ id: 1, to: [300, 420] }], 10);
      s.frames(80);
      s.down(2, 100, 400);
      s.down(3, 50, 50);
      s.drag([{ id: 2, to: [60, 400] }], 5);
      s.frames(60);
      s.up(3);
      s.up(2);
      s.up(1);
      s.frames(30);
    },
  },
  'fly-to, then a pan': {
    moves: 1,
    run: (s) => {
      s.rig.flyTo(500, 400, 3000);
      s.finishFlight();
      s.frames(5);
      s.down(1, 200, 500);
      s.drag([{ id: 1, to: [260, 300] }], 10);
      s.up(1);
      s.frames(60);
    },
  },
  // ── pinch and tilt
  'pinch out then in (zoom)': {
    moves: 20,
    run: (s) => {
      s.two(0, 0, 2.5);
      s.two(0, 0, 0.3);
    },
  },
  'pinch to the minimum distance and beyond': {
    moves: 20,
    run: (s) => {
      for (let i = 0; i < 8; i++) s.two(0, 0, 3, 10, 5);
      s.frames(60);
    },
  },
  'pinch out to the maximum distance and beyond': {
    moves: 20,
    run: (s) => {
      for (let i = 0; i < 8; i++) s.two(0, 0, 0.25, 10, 5);
      s.frames(60);
    },
  },
  'tilt down and up (vertical two-finger drag), to the extremes': {
    moves: 20,
    run: (s) => {
      s.two(0, 150);
      s.two(0, 150);
      s.two(0, -250);
      s.two(0, -250);
      s.two(0, -250);
    },
  },
  // ── the turn
  'orbit turn right (100 px)': { moves: 20, run: (s) => s.two(100, 0) },
  'orbit turn left (100 px)': { moves: 20, run: (s) => s.two(-100, 0) },
  'orbit turn a long way right (170 px: about 50 degrees)': { moves: 40, run: (s) => s.two(170, 0, 1, 20) },
  'orbit turn right then left, back and forth': {
    moves: 20,
    run: (s) => {
      s.two(120, 0);
      s.two(-60, 0);
      s.two(200, 0);
    },
  },
  'top view turn right': {
    moves: 20,
    run: (s) => {
      s.toMode('top');
      s.two(100, 0);
    },
  },
  'top view turn left with a pinch': {
    moves: 10,
    run: (s) => {
      s.toMode('top');
      s.two(-80, 40, 2);
    },
  },
  'combined pinch + turn + tilt in one movement': { moves: 20, run: (s) => s.two(70, 50, 2, 12) },
  'combined pinch in + turn left + tilt up': { moves: 20, run: (s) => s.two(-90, -60, 0.4, 12) },
  'turn at the minimum zoom': {
    moves: 20,
    run: (s) => {
      for (let i = 0; i < 8; i++) s.two(0, 0, 3, 10, 5);
      s.two(100, 0);
    },
  },
  'turn at the maximum zoom-out': {
    moves: 20,
    run: (s) => {
      for (let i = 0; i < 8; i++) s.two(0, 0, 0.25, 10, 5);
      s.two(100, 0);
    },
  },
  'turn at the tilt extreme (flat to the horizon)': {
    moves: 20,
    run: (s) => {
      s.two(0, -250);
      s.two(0, -250);
      s.two(100, 0);
    },
  },
  'turn at the tilt extreme (straight down)': {
    moves: 20,
    run: (s) => {
      s.two(0, 250);
      s.two(0, 250);
      s.two(100, 0);
    },
  },
  'fly-to, then turn': {
    moves: 20,
    run: (s) => {
      s.rig.flyTo(500, 400, 3000);
      s.finishFlight();
      s.frames(5);
      s.two(100, 0);
    },
  },
  'turn, lift one finger (pan from there), put it back (turn again) without a jump': {
    moves: 20,
    run: (s) => {
      s.down(1, 150, 400);
      s.down(2, 250, 400);
      s.drag(
        [
          { id: 1, to: [200, 400] },
          { id: 2, to: [300, 400] },
        ],
        8,
      );
      s.up(1);
      s.frames(3);
      s.drag([{ id: 2, to: [300, 450] }], 6);
      s.down(1, 180, 450);
      s.drag(
        [
          { id: 1, to: [230, 450] },
          { id: 2, to: [350, 450] },
        ],
        8,
      );
      s.frames(100);
      s.up(2);
      s.up(1);
    },
  },
  'a third finger during a turn': {
    moves: 20,
    run: (s) => {
      s.down(1, 150, 400);
      s.down(2, 250, 400);
      s.down(3, 100, 100);
      s.drag([{ id: 3, to: [300, 200] }], 4);
      s.drag(
        [
          { id: 1, to: [220, 400] },
          { id: 2, to: [320, 400] },
        ],
        10,
      );
      s.frames(100);
      s.up(3);
      s.up(2);
      s.up(1);
    },
  },
  'the first of three fingers lifts: the second pans, the third is ignored, then the first comes back and turns again': {
    moves: 20,
    run: (s) => {
      s.down(1, 150, 400);
      s.down(2, 250, 400);
      s.down(3, 200, 650);
      twoDown(s, 0, 1);
      s.up(1);
      s.drag([{ id: 2, to: [250, 330] }], 6);
      s.down(1, 120, 330);
      drift(s, 70, 8);
      liftAll(s);
    },
  },
  // ── what is left of a turn runs out however the gesture ends
  'pointercancel in the middle of a turn: the inertia runs on': {
    moves: 10,
    run: (s) => {
      twoDown(s, 80, 6);
      s.cancel(2);
      s.frames(60);
      s.cancel(1);
      s.frames(60);
    },
  },
  'lostpointercapture in the middle of a turn': {
    moves: 10,
    run: (s) => {
      twoDown(s, 80, 6);
      s.lost(1);
      s.frames(40);
      s.up(2);
      s.frames(60);
    },
  },
  // ── something else happens while the fingers are down
  'a flight starts in the middle of a turn; the fingers go on moving and are still down when it lands': {
    moves: 20,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.flyTo(500, 400, 3000);
      drift(s, 50, 6);
      s.finishFlight();
      s.frames(5);
      drift(s, 40, 6);
      liftAll(s);
    },
  },
  'a zoom-by flight in the middle of a turn: what is left of the turn is applied after it': {
    moves: 10,
    run: (s) => {
      twoDown(s, 80, 6);
      s.up(2);
      s.up(1);
      s.rig.zoomBy(0.8);
      s.finishFlight();
      s.frames(60);
    },
  },
  'interaction off in the middle of a turn, on again with the fingers still down': {
    moves: 20,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.setInteractionEnabled(false);
      drift(s, 50, 6);
      s.rig.setInteractionEnabled(true);
      drift(s, 40, 6);
      liftAll(s);
    },
  },
  'interaction off in the middle of a turn, the fingers lift meanwhile, a new pair turns after': {
    moves: 20,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.setInteractionEnabled(false);
      liftAll(s);
      s.rig.setInteractionEnabled(true);
      s.two(80, 0);
    },
  },
  'a fingers go down while interaction is off': {
    moves: 5,
    run: (s) => {
      s.rig.setInteractionEnabled(false);
      twoDown(s, 60, 6);
      s.rig.setInteractionEnabled(true);
      drift(s, 40, 6);
      liftAll(s);
      s.two(60, 0);
    },
  },
  'orbit to top in the middle of a turn; the fingers go on, lift, and a new pair turns the top view': {
    moves: 20,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.setMode('top');
      drift(s, 50, 6);
      s.finishFlight();
      drift(s, 40, 6);
      liftAll(s);
      s.two(80, 0);
    },
  },
  'top to orbit in the middle of a turn': {
    moves: 20,
    run: (s) => {
      s.toMode('top');
      twoDown(s, 60, 6);
      s.rig.setMode('orbit');
      drift(s, 50, 6);
      s.finishFlight();
      liftAll(s);
      s.two(80, 0);
    },
  },
  'the same mode set again in the middle of a turn': {
    moves: 20,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.setMode('orbit');
      drift(s, 50, 6);
      s.finishFlight();
      drift(s, 40, 6);
      liftAll(s);
      s.two(80, 0);
    },
  },
  'orbit to eye level in the middle of a turn, and back': {
    moves: 5,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.setMode('ground', { user: [100, -200], lookAt: [900, 600] });
      drift(s, 50, 6);
      s.finishFlight();
      liftAll(s);
      s.toMode('orbit');
      s.two(80, 0);
    },
  },
  'a jump (home) in the middle of a turn': {
    moves: 20,
    run: (s) => {
      twoDown(s, 60, 6);
      s.rig.home(false);
      drift(s, 50, 6);
      liftAll(s);
    },
  },
  // ── the damping's settings
  'no damping: the whole step at once': {
    moves: 20,
    setup: (s) => {
      s.rig.controls.enableDamping = false;
    },
    run: (s) => {
      s.two(100, 40, 1.5);
      s.two(-70, 0);
    },
  },
  'a stronger damping factor (0.3)': {
    moves: 20,
    setup: (s) => {
      s.rig.controls.dampingFactor = 0.3;
    },
    run: (s) => {
      s.two(100, 40, 1.5);
      s.two(-70, 0);
    },
  },
  'a different rotate speed (1.0)': {
    moves: 20,
    setup: (s) => {
      s.rig.controls.rotateSpeed = 1;
    },
    run: (s) => {
      s.two(100, 40, 1.5);
    },
  },
};

// ───────────── a seeded random walk of fingers, modes, flights and interaction ─────────────

type Op =
  | { k: 'down'; id: number; x: number; y: number }
  | { k: 'move'; id: number; x: number; y: number }
  | { k: 'up' | 'cancel' | 'lost'; id: number }
  | { k: 'frames'; n: number }
  | { k: 'mode'; m: 'orbit' | 'top' | 'ground' }
  | { k: 'interaction'; on: boolean }
  | { k: 'flyTo'; x: number; y: number }
  | { k: 'zoomBy'; f: number }
  | { k: 'home' };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random walk of about `length` steps. Two fingers are put down soon and move together (with a little of their own), because the
 * turn is what is compared; fingers also lift or are cancelled, the view mode changes, the camera flies or jumps, and interaction is
 * switched off and on. (No third finger: OrbitControls 0.6.0 takes the moves of a finger that nothing tracks, such as a third one
 * that PanGesture stopped hiding after a reset, for the pair's and jumps; the third finger has its own scenario.) `pairMoves` counts
 * the moves made while two fingers were down.
 */
function walk(seed: number, length: number): { ops: Op[]; pairMoves: number } {
  const r = rng(seed);
  const ops: Op[] = [];
  const down = new Map<number, [number, number]>();
  let pairMoves = 0;
  const chaos = [0, 0.4, 1, 2][seed % 4]!; // how often something else happens: never, rarely, now and then, often
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const clampX = (v: number): number => Math.min(390, Math.max(10, v));
  const clampY = (v: number): number => Math.min(790, Math.max(10, v));
  const moveTo = (id: number, x: number, y: number): void => {
    down.set(id, [clampX(x), clampY(y)]);
    ops.push({ k: 'move', id, x: clampX(x), y: clampY(y) });
  };
  while (ops.length < length) {
    const u = r();
    if (down.size < 2 && u < 0.3) {
      const id = [1, 2].find((i) => !down.has(i))!;
      const p: [number, number] = down.size === 1 ? [[...down.values()][0]![0] + 70 + r() * 60, [...down.values()][0]![1] + (r() - 0.5) * 40] : [60 + r() * 280, 150 + r() * 500];
      down.set(id, [clampX(p[0]), clampY(p[1])]);
      ops.push({ k: 'down', id, x: clampX(p[0]), y: clampY(p[1]) });
    } else if (u < 0.6 && down.size >= 2) {
      // the first two fingers drift together, a little apart or together as well
      const ids = [...down.keys()].slice(0, 2);
      const dx = (r() - 0.4) * 36;
      const dy = (r() - 0.5) * 24;
      for (const id of ids) {
        const p = down.get(id)!;
        moveTo(id, p[0] + dx + (r() - 0.5) * 10, p[1] + dy + (r() - 0.5) * 10);
        pairMoves++;
        if (r() < 0.5) ops.push({ k: 'frames', n: 1 });
      }
      ops.push({ k: 'frames', n: 1 });
    } else if (u < 0.7 && down.size > 0) {
      const id = pick([...down.keys()]);
      const p = down.get(id)!;
      moveTo(id, p[0] + (r() - 0.4) * 50, p[1] + (r() - 0.5) * 50);
      if (r() < 0.8) ops.push({ k: 'frames', n: 1 });
    } else if (u < 0.75 && down.size > 0) {
      const id = pick([...down.keys()]);
      down.delete(id);
      ops.push({ k: pick(['up', 'up', 'up', 'cancel'] as const), id });
    } else if (u < 1 - 0.025 * chaos) {
      ops.push({ k: 'frames', n: 1 + Math.floor(r() * 4) });
    } else {
      // something else happens (one step in 40 at chaos 1, none at 0)
      const v = r();
      if (v < 0.3) ops.push({ k: 'mode', m: pick(['orbit', 'orbit', 'top', 'ground'] as const) });
      else if (v < 0.5) ops.push({ k: 'interaction', on: r() < 0.5 });
      else if (v < 0.7) ops.push({ k: 'flyTo', x: (r() - 0.5) * 3000, y: (r() - 0.5) * 3000 });
      else if (v < 0.8) ops.push({ k: 'zoomBy', f: 0.6 + r() * 0.8 });
      else if (v < 0.9) ops.push({ k: 'home' });
      else ops.push({ k: 'frames', n: 12 });
    }
  }
  return { ops, pairMoves };
}

function play(s: Sim, ops: Op[]): void {
  for (const op of ops) {
    s.op = JSON.stringify(op);
    s.log.push({ frame: s.trace.length, op: s.op });
    switch (op.k) {
      case 'down':
        s.down(op.id, op.x, op.y);
        break;
      case 'move':
        // A finger that landed while the controls were off is not tracked by anything. OrbitControls (0.6.0) nevertheless takes its
        // later moves for a finger of a pair that other fingers make and jumps; the new turn ignores them. That is not compared.
        if (!s.ghosts.has(op.id)) s.move(op.id, op.x, op.y);
        break;
      case 'up':
        s.up(op.id);
        break;
      case 'cancel':
        s.cancel(op.id);
        break;
      case 'lost':
        s.lost(op.id);
        break;
      case 'frames':
        s.frames(op.n);
        break;
      case 'mode':
        s.rig.setMode(op.m, { user: [100, -200], lookAt: [900, 600] });
        break;
      case 'interaction':
        s.rig.setInteractionEnabled(op.on);
        break;
      case 'flyTo':
        s.rig.flyTo(op.x, op.y, 2500);
        break;
      case 'zoomBy':
        s.rig.zoomBy(op.f);
        break;
      case 'home':
        s.rig.home(false);
        break;
    }
  }
  s.rig.setInteractionEnabled(true);
  liftAll(s);
}

// ───────────── the comparison ─────────────

/**
 * Rounding only, the 1e-9 rad of the contract: camera and target as a share of the orbit distance (1e-9 rad seen from the target),
 * the compass numbers in degrees (1e-9 rad), the orientation as a rotation angle (looking straight down the roll is ill-conditioned:
 * a few micrometres of position noise turn it by 1e-9 rad).
 */
const TOL = { perDistance: 1e-9, degrees: (1e-9 * 180) / Math.PI, rotation: 1e-7 };
const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

interface Worst {
  metres: number;
  /** The same, as a share of the orbit distance (radians seen from the target). */
  rel: number;
  degrees: number;
  frames: number;
  travel: number;
  /** Frames in which the new rig held OrbitControls' own turn off, that is, two fingers were turning the view. */
  held: number;
}
const report = new Map<string, Worst>();

function compare(name: string, o: Sim, n: Sim): Worst {
  expect(n.trace.length, `${name}: frames`).toBe(o.trace.length);
  expect(n.events, `${name}: start / end events`).toEqual(o.events);
  const w: Worst = { metres: 0, rel: 0, degrees: 0, frames: o.trace.length, travel: 0, held: 0 };
  let first = null as string | null; // (set by note(), which the compiler does not follow)
  const note = (i: number, what: string, a: unknown, b: unknown): void => {
    first ??= `frame ${i}${o.trace[i]!.op ? ` (${o.trace[i]!.op})` : ''}: ${what}: old ${String(a)}, new ${String(b)}`;
  };
  for (let i = 0; i < o.trace.length; i++) {
    const A = o.trace[i]!;
    const B = n.trace[i]!;
    if (A.mode !== B.mode) note(i, 'mode', A.mode, B.mode);
    if (!A.rot) note(i, 'the 0.6.0 rig never switches enableRotate off', A.rot, B.rot);
    if (!B.rot) w.held++;
    if (A.moved !== B.moved) note(i, 'update() moved', A.moved, B.moved);
    if (A.state !== B.state) note(i, 'OrbitControls state', A.state, B.state);
    if (A.pointers !== B.pointers) note(i, 'OrbitControls pointers', A.pointers, B.pointers);
    for (let k = 0; k < 3; k++) {
      w.metres = Math.max(w.metres, Math.abs(A.p[k]! - B.p[k]!), Math.abs(A.t[k]! - B.t[k]!));
      w.rel = Math.max(w.rel, Math.max(Math.abs(A.p[k]! - B.p[k]!), Math.abs(A.t[k]! - B.t[k]!)) / Math.max(1, A.dist));
    }
    const dq = Math.max(...A.q.map((v, k) => Math.abs(v - B.q[k]!)));
    // A camera that looks straight down has two orientations (the roll about the view axis is free); compare the rotations, not the numbers.
    const qdot = Math.abs(A.q[0] * B.q[0] + A.q[1] * B.q[1] + A.q[2] * B.q[2] + A.q[3] * B.q[3]);
    const dRot = Math.min(dq, 2 * Math.acos(Math.min(1, qdot)));
    if (dRot > TOL.rotation) note(i, 'orientation', A.q.join(','), B.q.join(','));
    w.degrees = Math.max(w.degrees, Math.abs(wrap(A.az - B.az)), Math.abs(A.polar - B.polar), Math.abs(wrap(A.heading - B.heading)));
    if (i > 0) w.travel += Math.abs(wrap(A.az - o.trace[i - 1]!.az)) + Math.abs(A.polar - o.trace[i - 1]!.polar) + 100 * Math.abs(A.dist / o.trace[i - 1]!.dist - 1);
  }
  if (first) {
    const at = Number(/^frame (\d+)/.exec(first)![1]);
    const before = o.log.filter((l) => l.frame <= at).slice(process.env.TURN_DIFF_FULL ? 0 : -14);
    first += before.length ? `\nthe steps before it:\n${before.map((l) => `  frame ${l.frame}: ${l.op}`).join('\n')}` : '';
  }
  expect(first, `${name}: the first difference`).toBeNull();
  expect(w.rel, `${name}: worst camera / target difference (share of the orbit distance; ${w.metres.toExponential(1)} m)`).toBeLessThan(TOL.perDistance);
  expect(w.degrees, `${name}: worst compass difference (deg)`).toBeLessThan(TOL.degrees);
  report.set(name, w);
  return w;
}

function bothRigs(setup: ((s: Sim) => void) | undefined, run: (s: Sim) => void, hf?: HeightField): [Sim, Sim] {
  const o = new Sim(CameraRig060, hf);
  setup?.(o);
  run(o);
  const n = new Sim(CameraRig, hf);
  setup?.(n);
  run(n);
  return [o, n];
}

describe('the 0.7.0 two-finger turn against the 0.6.0 rig, frame by frame', () => {
  for (const [name, sc] of Object.entries(scenarios)) {
    it(name, () => {
      const [o, n] = bothRigs(sc.setup, sc.run);
      const w = compare(name, o, n);
      expect(w.travel, 'the camera moved (the scenario is not vacuous)').toBeGreaterThan(sc.moves);
      expect(n.rig.controls.enableRotate, 'OrbitControls’ own turn is given back').toBe(true);
    });
  }

  for (let seed = 1; seed <= 40; seed++) {
    it(`a random walk of fingers, modes, flights and interaction (seed ${seed})`, () => {
      const { ops, pairMoves } = walk(seed, 260);
      expect(pairMoves, 'moves with two fingers down (the turn is in play)').toBeGreaterThan(15);
      const [o, n] = bothRigs(undefined, (s) => play(s, ops));
      compare(`random walk ${seed}`, o, n);
      expect(n.rig.controls.enableRotate, 'OrbitControls’ own turn is given back').toBe(true);
    });
  }

  describe('on the real Katoomba relief (the bundled 10 m DEM: ridges and cliffs under the view, where the target slides onto the ground)', () => {
    let hf: HeightField;
    beforeAll(async () => {
      hf = await katoombaHeightField(320);
    });
    for (let seed = 101; seed <= 112; seed++) {
      it(`a random walk (seed ${seed})`, () => {
        const { ops } = walk(seed, 260);
        const [o, n] = bothRigs(undefined, (s) => play(s, ops), hf);
        compare(`Katoomba walk ${seed}`, o, n);
        expect(n.rig.controls.enableRotate).toBe(true);
      });
    }
  });

  it('the random walks have two fingers turning the view in a good share of their frames (so they test the turn, not an idle rig)', () => {
    const walks = [...report].filter(([k]) => k.startsWith('random walk'));
    expect(walks.length).toBe(40);
    const held = walks.reduce((a, [, w]) => a + w.held, 0);
    const frames = walks.reduce((a, [, w]) => a + w.frames, 0);
    expect(held / frames, 'share of frames with a turn in progress').toBeGreaterThan(0.3);
    expect(walks.filter(([, w]) => w.held > 20).length, 'walks with a real turn').toBeGreaterThan(25);
  });

  it('both turn the way the owner asked: a two-finger drag to the right takes the compass azimuth of the camera down, 34.5 degrees per 100 px (rotateSpeed 2/3 · 1.15: 30 × 1.15)', () => {
    const o = new Sim(CameraRig060);
    o.two(100, 0);
    const n = new Sim(CameraRig);
    n.two(100, 0);
    const d = (s: Sim): number => wrap(s.trace.at(-1)!.az - s.trace[2]!.az);
    expect(d(o)).toBeCloseTo(-34.5, 0);
    expect(d(n)).toBeCloseTo(-34.5, 0);
  });

  it('the reference runs at the speed of the 0.7.0 rig (the one constant set at the top of this file), also after a mode change re-applies it', () => {
    expect(GESTURE060.rotateSpeed).toBe(GESTURE.rotateSpeed);
    expect(GESTURE.rotateSpeed).toBeCloseTo(23 / 30, 12);
    const o = new Sim(CameraRig060);
    const n = new Sim(CameraRig);
    for (const s of [o, n]) {
      s.rig.setMode('top');
      s.rig.setMode('orbit');
      expect(s.rig.controls.rotateSpeed).toBe(GESTURE.rotateSpeed);
    }
  });

  afterAll(() => {
    if (!process.env.TURN_DIFF_VERBOSE) return;
    const lines = [...report].map(([k, w]) => `${w.metres.toExponential(2)} m  ${w.rel.toExponential(1)} rad  ${w.degrees.toExponential(2)} deg  ${String(w.frames).padStart(5)} frames  turning ${String(w.held).padStart(4)}  travel ${w.travel.toFixed(0).padStart(5)}  ${k}`);
    console.log(`\n${lines.join('\n')}`);
  });
});
