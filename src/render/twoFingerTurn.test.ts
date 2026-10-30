/**
 * TwoFingerTurn on its own (a fake element and a fake OrbitControls, no rig): the midpoint's drag becomes the mirrored azimuth step and
 * the tilt step with OrbitControls' arithmetic, `step()` applies them damped and within the polar limits, OrbitControls' own turn
 * (`enableRotate`) is held off exactly while two fingers turn the view and given back on every way out. And the guard of the 0.7.0
 * change: nothing in `src` reaches OrbitControls' private `_rotateLeft` or `_handleTouchMoveDollyRotate` any more (they are named
 * below in pieces, so that this file does not mention them either).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { GESTURE } from './cameraRig';
import { TwoFingerTurn } from './twoFingerTurn';

// ───────────── a fake element and fake controls ─────────────

interface Pointer {
  type: string;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
}
type Handler = (e: Pointer) => void;

class FakeElement {
  readonly listeners: { type: string; fn: Handler; capture: boolean }[] = [];
  clientHeight = 800;
  addEventListener(type: string, fn: Handler, opts?: { capture?: boolean }): void {
    this.listeners.push({ type, fn, capture: !!opts?.capture });
  }
  removeEventListener(type: string, fn: Handler): void {
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  fire(type: string, id: number, x: number, y: number, extra: Partial<Pointer> = {}): void {
    const e: Pointer = { type, pointerId: id, pointerType: 'touch', isPrimary: false, clientX: x, clientY: y, ...extra };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
  }
}

interface FakeControls {
  enabled: boolean;
  enableRotate: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  touches: { ONE: number | null; TWO: number | null };
  target: THREE.Vector3;
  object: THREE.PerspectiveCamera;
}

const setupAt = (): { el: FakeElement; c: FakeControls; turn: TwoFingerTurn } => {
  const el = new FakeElement();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 3000, 4000); // polar angle atan(4000 / 3000) = 53.13° from vertical, from the south (z towards the viewer)
  const c: FakeControls = {
    enabled: true,
    enableRotate: true,
    enableDamping: false,
    dampingFactor: 0.12,
    rotateSpeed: GESTURE.rotateSpeed, // (2/3 · 1.15 since 0.7.0)
    minPolarAngle: 0,
    maxPolarAngle: THREE.MathUtils.degToRad(86),
    touches: { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE },
    target: new THREE.Vector3(),
    object: camera,
  };
  const turn = new TwoFingerTurn(el as unknown as HTMLElement, () => c as unknown as OrbitControls);
  return { el, c, turn };
};

/** Degrees the camera went round the target seen from above (anticlockwise positive, north up: x east, -z north), and its polar angle. */
const view = (c: FakeControls): { round: number; polar: number } => {
  const p = c.object.position;
  return { round: (Math.atan2(-p.z, p.x) * 180) / Math.PI, polar: (Math.acos(p.y / p.length()) * 180) / Math.PI };
};
const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
/** Degrees 100 px of drag of the midpoint turn or tilt the view on the 800 px screen of these tests: 360° · rotateSpeed · 100 / 800. */
const DEG_PER_100_PX = (360 * GESTURE.rotateSpeed * 100) / 800;

describe('TwoFingerTurn: the midpoint of two fingers turns and tilts the view, the turn mirrored', () => {
  let el: FakeElement;
  let c: FakeControls;
  let turn: TwoFingerTurn;
  beforeEach(() => {
    ({ el, c, turn } = setupAt());
  });

  /** Both fingers `dx`, `dy` px on, each in its own move event (a real hand), and then one step of the controls' update(). */
  const twoDown = (): void => {
    el.fire('pointerdown', 1, 150, 400, { isPrimary: true });
    el.fire('pointerdown', 2, 250, 400);
  };
  const shift = (dx: number, dy: number, from: [[number, number], [number, number]] = [[150, 400], [250, 400]]): void => {
    el.fire('pointermove', 1, from[0][0] + dx, from[0][1] + dy);
    el.fire('pointermove', 2, from[1][0] + dx, from[1][1] + dy);
  };

  it('100 px to the right turns the camera 34.5° anticlockwise seen from above (rotateSpeed 2/3 · 1.15 on an 800 px screen: 360° · 23/30 ÷ 8), the tilt does not change', () => {
    expect(DEG_PER_100_PX, '360° · 23/30 · 100 / 800').toBeCloseTo(34.5, 9);
    const a = view(c);
    twoDown();
    shift(100, 0);
    turn.step();
    const b = view(c);
    expect(wrap(b.round - a.round)).toBeCloseTo(DEG_PER_100_PX, 9);
    expect(b.polar).toBeCloseTo(a.polar, 9);
    expect(c.object.position.length(), 'the distance stays').toBeCloseTo(5000, 9);
  });

  it('100 px to the left turns it the other way, 100 px down tilts 34.5° towards the plan view, 50 px up 17.25° towards the horizon', () => {
    const a = view(c);
    twoDown();
    shift(-100, 0);
    turn.step();
    expect(wrap(view(c).round - a.round)).toBeCloseTo(-DEG_PER_100_PX, 9);
    ({ c, el, turn } = setupAt());
    twoDown();
    shift(0, 100);
    turn.step();
    expect(view(c).polar - a.polar).toBeCloseTo(-DEG_PER_100_PX, 9);
    expect(wrap(view(c).round - a.round)).toBeCloseTo(0, 9);
    ({ c, el, turn } = setupAt());
    twoDown();
    // (100 px up would be 34.5°: from the start polar angle of 53.13° that is 87.6°, past the 86° limit, which a test below covers: half the drag here)
    shift(0, -50);
    turn.step();
    expect(view(c).polar - a.polar).toBeCloseTo(DEG_PER_100_PX / 2, 9);
  });

  it('only the midpoint counts: fingers that move apart or together turn nothing', () => {
    const a = view(c);
    twoDown();
    el.fire('pointermove', 1, 100, 400);
    el.fire('pointermove', 2, 300, 400);
    turn.step();
    expect(wrap(view(c).round - a.round)).toBeCloseTo(0, 9);
    expect(view(c).polar).toBeCloseTo(a.polar, 9);
  });

  it('the speed is the controls’ rotateSpeed, the height the element’s', () => {
    c.rotateSpeed = 1;
    el.clientHeight = 400;
    const a = view(c);
    twoDown();
    shift(100, 0);
    turn.step();
    expect(wrap(view(c).round - a.round)).toBeCloseTo(360 * 100 / 400, 9); // a whole 90°: one screen height is a full turn at speed 1
  });

  it('with damping each step() applies a share dampingFactor of what is left, so the turn goes on after the fingers lift and dies away', () => {
    c.enableDamping = true;
    twoDown();
    shift(100, 0);
    el.fire('pointerup', 2, 350, 400);
    el.fire('pointerup', 1, 250, 400);
    const a = view(c);
    const steps: number[] = [];
    let last = a.round;
    for (let i = 0; i < 60; i++) {
      turn.step();
      const now = view(c).round;
      steps.push(wrap(now - last));
      last = now;
    }
    expect(steps[0]).toBeCloseTo(DEG_PER_100_PX * 0.12, 9);
    for (let i = 1; i < steps.length; i++) expect(steps[i]! / steps[i - 1]!).toBeCloseTo(0.88, 9);
    expect(wrap(last - a.round)).toBeCloseTo(DEG_PER_100_PX * (1 - 0.88 ** 60), 9);
  });

  it('the tilt stays within the polar limits; at the plan view the azimuth is not lost (the angle is kept just off the pole)', () => {
    twoDown();
    shift(0, -2000); // far up: towards the horizon
    turn.step();
    expect(view(c).polar).toBeCloseTo(86, 9);
    ({ c, el, turn } = setupAt());
    const a = view(c);
    twoDown();
    shift(0, 2000); // far down: to the plan view
    turn.step();
    const p = c.object.position;
    expect(Math.hypot(p.x, p.z), 'a little off the vertical, not exactly on it').toBeGreaterThan(0);
    expect(view(c).polar).toBeLessThan(0.001);
    expect(wrap(view(c).round - a.round), 'and still on the same side').toBeCloseTo(0, 6);
  });

  it('does nothing until two fingers are down, and nothing for a pen or a mouse', () => {
    const a = view(c);
    el.fire('pointerdown', 1, 150, 400, { isPrimary: true });
    el.fire('pointermove', 1, 250, 400);
    turn.step();
    expect(view(c).round).toBeCloseTo(a.round, 12);
    expect(c.enableRotate).toBe(true);
    el.fire('pointerdown', 2, 250, 400, { pointerType: 'pen' });
    el.fire('pointerdown', 3, 300, 400, { pointerType: 'mouse' });
    expect(c.enableRotate, 'a pen or a mouse is not a second finger').toBe(true);
  });

  it('does not take part where the two fingers are not the pinch-and-turn (eye level: touches.TWO is ROTATE) or while the controls are off', () => {
    c.touches.TWO = THREE.TOUCH.ROTATE;
    twoDown();
    expect(c.enableRotate).toBe(true);
    shift(100, 0);
    turn.step();
    expect(wrap(view(c).round)).toBeCloseTo(view(setupAt().c).round, 12);
    el.fire('pointerup', 2, 350, 400);
    el.fire('pointerup', 1, 250, 400);
    ({ c, el, turn } = setupAt());
    c.enabled = false;
    twoDown();
    expect(c.enableRotate, 'controls off').toBe(true);
    c.enabled = true;
    shift(100, 0);
    turn.step();
    expect(c.object.position.x, 'the fingers were never tracked').toBeCloseTo(0, 9);
  });

  it('does not hold (or turn) when OrbitControls’ own turn is switched off by someone else', () => {
    c.enableRotate = false;
    twoDown();
    shift(100, 0);
    turn.step();
    expect(c.object.position.x).toBeCloseTo(0, 9);
    el.fire('pointerup', 2, 350, 400);
    expect(c.enableRotate, 'it stays as it was found').toBe(false);
  });
});

describe('TwoFingerTurn: OrbitControls’ own turn is held off while two fingers are down and given back on every way out', () => {
  let el: FakeElement;
  let c: FakeControls;
  let turn: TwoFingerTurn;
  beforeEach(() => {
    ({ el, c, turn } = setupAt());
    el.fire('pointerdown', 1, 150, 400, { isPrimary: true });
  });

  it('held at the second finger, given back at the lift, the cancel and the lost capture of either', () => {
    for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      for (const which of [1, 2]) {
        el.fire('pointerdown', 2, 250, 400);
        expect(c.enableRotate, `${end} of ${which}: held`).toBe(false);
        el.fire(end, which, 200, 400);
        expect(c.enableRotate, `${end} of finger ${which}`).toBe(true);
        // the other finger is still down; put the lifted one back so that the next round starts with two fingers tracked again
        el.fire(end, which === 1 ? 2 : 1, 200, 400);
        el.fire('pointerdown', 1, 150, 400, { isPrimary: true });
      }
    }
  });

  it('a finger that begins a new group (primary) gives it back when the old group never ended', () => {
    el.fire('pointerdown', 2, 250, 400);
    expect(c.enableRotate).toBe(false);
    el.fire('pointerdown', 7, 100, 100, { isPrimary: true });
    expect(c.enableRotate).toBe(true);
  });

  it('a press of a finger that is still tracked starts it afresh, and a third finger is ignored', () => {
    el.fire('pointerdown', 2, 250, 400);
    el.fire('pointerdown', 3, 50, 50);
    expect(c.enableRotate).toBe(false);
    el.fire('pointerup', 3, 50, 50); // not tracked: nothing happens
    expect(c.enableRotate).toBe(false);
    el.fire('pointerdown', 2, 260, 400); // a second press of finger 2 without an end: one finger again, then two
    expect(c.enableRotate).toBe(false);
    el.fire('pointerup', 2, 260, 400);
    expect(c.enableRotate).toBe(true);
  });

  it('cancel() (the view mode changed) gives it back, keepHeld() (the mode’s settings were applied) puts it off again while the fingers still turn', () => {
    el.fire('pointerdown', 2, 250, 400);
    c.enableRotate = true; // the rig applies a mode's settings
    turn.keepHeld();
    expect(c.enableRotate, 'still two fingers').toBe(false);
    turn.cancel();
    expect(c.enableRotate).toBe(true);
    c.enableRotate = true;
    turn.keepHeld();
    expect(c.enableRotate, 'nothing is held any more').toBe(true);
    // the fingers stay tracked and do nothing until they lift: moving them turns nothing
    el.fire('pointermove', 1, 250, 400);
    turn.step();
    expect(c.object.position.x).toBeCloseTo(0, 9);
  });

  it('a flight or finger drawing (controls off) does not give it back, and the fingers’ moves are ignored meanwhile, as OrbitControls ignores them', () => {
    el.fire('pointerdown', 2, 250, 400);
    c.enabled = false;
    el.fire('pointermove', 1, 300, 400);
    el.fire('pointermove', 2, 400, 400);
    turn.step();
    expect(c.enableRotate).toBe(false);
    expect(c.object.position.x, 'nothing turned').toBeCloseTo(0, 9);
    c.enabled = true;
    el.fire('pointerup', 1, 300, 400);
    expect(c.enableRotate).toBe(true);
  });

  it('dispose() gives it back and removes every listener', () => {
    el.fire('pointerdown', 2, 250, 400);
    expect(el.listeners.length).toBeGreaterThan(0);
    turn.dispose();
    expect(c.enableRotate).toBe(true);
    expect(el.listeners.length).toBe(0);
  });

  it('its listeners are capture listeners (they run before OrbitControls’ own, which are not)', () => {
    expect(el.listeners.length).toBe(5);
    expect(el.listeners.every((l) => l.capture)).toBe(true);
  });
});

// ───────────── nothing in src reaches OrbitControls' private members ─────────────

const SRC = resolve(__dirname, '..');
const PRIVATE = [['_rotate', 'Left'], ['_handleTouchMove', 'DollyRotate']].map((p) => p.join(''));
/** The one file that may still use them: the 0.6.0 rig, kept frozen as the reference of `twoFingerTurn.diff.test.ts`. */
const REFERENCE = join('render', 'testing', 'cameraRig060.ts');

const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('the two-finger turn uses OrbitControls through its public API only', () => {
  const files = sources(SRC);
  const code = (file: string): string => strip(readFileSync(file, 'utf8'));

  it('no code in src (tests and helpers included) names a private OrbitControls member, but the frozen 0.6.0 reference rig', () => {
    expect(files.map((f) => relative(SRC, f))).toEqual(expect.arrayContaining([join('render', 'cameraRig.ts'), join('render', 'twoFingerTurn.ts'), REFERENCE]));
    const offenders = files.filter((f) => PRIVATE.some((name) => code(f).includes(name))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([REFERENCE]); // (and the reference does, so the search finds what it looks for)
  });

  it('the rig and the turn read no OrbitControls.prototype member and no member that starts with an underscore', () => {
    for (const file of [join('render', 'cameraRig.ts'), join('render', 'twoFingerTurn.ts')]) {
      const text = code(join(SRC, file));
      expect(text, file).not.toMatch(/\.prototype\b/);
      expect(text, `${file}: members of the controls`).not.toMatch(/\b(controls|c|orbit|OrbitControls)\s*(\)\s*)?\._\w/);
    }
  });

  it('TwoFingerTurnControls only overrides the public update()', () => {
    const text = code(join(SRC, 'render', 'cameraRig.ts'));
    const body = /class TwoFingerTurnControls extends OrbitControls \{([\s\S]*?)\n\}/.exec(text)![1]!;
    expect(body).toMatch(/override update\(/);
    expect(body.match(/override\s+\w+/g)).toEqual(['override update']);
    expect(body).not.toMatch(/\b_\w+\s*\(/);
  });
});
