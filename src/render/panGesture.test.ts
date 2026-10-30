/**
 * The pointer bookkeeping of PanGesture on its own (a fake element and a fake host, no OrbitControls): a pen is captured while
 * it is down (the browser captures a finger by itself, but not a pen: a stroke that leaves the canvas would lose its end), a
 * press whose end never arrived starts afresh, and every capture that was taken is given back. And the glide of a flick: it
 * carries on at the speed the finger had over the ground it touched, near or far, whatever the scale at the orbit target.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GrabSurface } from './groundPan';
import { PanGesture, type PanHost } from './panGesture';

type Handler = (e: FakePointer) => void;
interface FakePointer {
  type: string;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  stopped: boolean;
  stopImmediatePropagation(): void;
}

class FakeElement {
  readonly listeners: { type: string; fn: Handler }[] = [];
  /** Pointer ids captured now (what setPointerCapture / releasePointerCapture leave). */
  readonly captured = new Set<number>();
  addEventListener(type: string, fn: Handler): void {
    this.listeners.push({ type, fn });
  }
  removeEventListener(type: string, fn: Handler): void {
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 400, height: 800 };
  }
  fire(type: string, init: Partial<FakePointer>): FakePointer {
    const e: FakePointer = {
      type,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: false,
      clientX: 0,
      clientY: 0,
      stopped: false,
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...init,
    };
    for (const l of [...this.listeners]) if (l.type === type && !e.stopped) l.fn(e);
    return e;
  }
}

interface Setup {
  el: FakeElement;
  gesture: PanGesture;
  camera: THREE.PerspectiveCamera;
  events: string[];
  host: { canPan: boolean; accepts: boolean };
  /** The host's `metresPerPixel` (ground metres a pixel stands for at the orbit target). */
  mpp: { value: number };
  /** Run the per-frame step (16 ms) n times. */
  frames(n: number): void;
}

/** The ground plane y = 0 as a grab surface (so a finger holds a real point of it, near or far). */
const plane: GrabSurface = {
  raycast: (_ox, oy, _oz, _dx, dy, _dz, maxT = Infinity) => {
    const t = -oy / dy;
    return dy < 0 && t > 0 && t <= maxT ? { t } : null;
  },
};

function setup(surface: GrabSurface | null = null): Setup {
  const mpp = { value: 5 };
  const el = new FakeElement();
  const camera = new THREE.PerspectiveCamera(50, 0.5, 1, 100000);
  camera.position.set(0, 3000, 4000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const target = new THREE.Vector3(0, 0, 0);
  const flags = { canPan: true, accepts: true };
  const events: string[] = [];
  const host: PanHost = {
    camera,
    target: () => target,
    accepts: () => flags.accepts,
    canPan: () => flags.canPan,
    surface: () => surface,
    metresPerPixel: () => mpp.value,
    started: () => events.push('start'),
    ended: () => events.push('end'),
  };
  const gesture = new PanGesture(el as unknown as HTMLElement, host);
  let clock = 1000;
  return {
    el,
    gesture,
    camera,
    events,
    host: flags,
    mpp,
    frames(n) {
      for (let i = 0; i < n; i++) {
        clock += 16;
        // As CameraRig.update does: the pan or glide moves the camera, then the clamps (none here), then settle() is told how far it went.
        const x = camera.position.x;
        const z = camera.position.z;
        gesture.step(clock);
        gesture.settle(camera.position.x - x, camera.position.z - z);
      }
    },
  };
}

describe('PanGesture pointer bookkeeping', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('captures a pen while it is down (OrbitControls never sees it) and gives the capture back when it lifts', () => {
    const down = s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(down.stopped).toBe(true);
    expect(s.el.captured.has(7)).toBe(true);
    s.el.fire('pointerup', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 500 });
    expect(s.el.captured.size).toBe(0);
    expect(s.events).toEqual(['start', 'end']);
  });

  it('leaves a finger to the browser (its capture is implicit) and to OrbitControls', () => {
    const down = s.el.fire('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 500 });
    expect(down.stopped).toBe(false);
    expect(s.el.captured.size).toBe(0);
    s.el.fire('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 500 });
  });

  it('does not capture or hide a pen at eye level, where OrbitControls looks around with it', () => {
    s.host.canPan = false;
    const down = s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(down.stopped).toBe(false);
    expect(s.el.captured.size).toBe(0);
    s.el.fire('pointerup', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 500 });
  });

  it('a pen whose lift was never heard (it ended outside the canvas) does not block the next stroke, which starts where the pen lands', () => {
    // Reference: a fresh stroke from y 600 to y 580.
    const ref = setup();
    ref.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 600 });
    const r0 = ref.camera.position.clone();
    ref.el.fire('pointermove', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 580 });
    ref.frames(2);
    const expected = ref.camera.position.distanceTo(r0);
    expect(expected).toBeGreaterThan(20);

    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    s.el.fire('pointermove', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 450 });
    s.frames(2);
    // ... the pen goes up somewhere else: no pointerup arrives here. The same pen touches down again, 150 px lower.
    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 600 });
    expect(s.gesture.panning).toBe(true);
    s.frames(2);
    const p0 = s.camera.position.clone();
    s.el.fire('pointermove', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 580 });
    s.frames(2);
    // Only the 20 px of the new stroke move the view (not the 170 px from where the lost stroke left off).
    expect(s.camera.position.distanceTo(p0)).toBeCloseTo(expected, 0);
    s.el.fire('pointerup', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 580 });
    expect(s.el.captured.size).toBe(0);
    // Every start has its end.
    expect(s.events.filter((e) => e === 'start').length).toBe(s.events.filter((e) => e === 'end').length);
    expect(s.events.at(-1)).toBe('end');
  });

  it('gives every capture back when the gesture is reset (finger drawing took over) or disposed', () => {
    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(s.el.captured.size).toBe(1);
    s.gesture.reset();
    expect(s.el.captured.size).toBe(0);
    s.el.fire('pointerdown', { pointerId: 8, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(s.el.captured.size).toBe(1);
    s.gesture.dispose();
    expect(s.el.captured.size).toBe(0);
    expect(s.el.listeners.length).toBe(0);
  });

  it('a first finger of a new group drops a pen that is still tracked and its capture', () => {
    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(s.el.captured.has(7)).toBe(true);
    s.el.fire('pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 400 });
    expect(s.el.captured.size).toBe(0);
    expect(s.gesture.panning).toBe(true);
    s.el.fire('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 400 });
    expect(s.events.at(-1)).toBe('end');
  });
});

describe('PanGesture: the glide carries on at the speed the finger had over the ground it touched', () => {
  /**
   * A finger lands at (100, row) of the 400 × 800 canvas over the ground plane, moves `step` px to the right every frame (16 ms)
   * for 10 frames (so it stays on its row, over the same distance of ground) and lifts. Returns whether a glide began, the camera's
   * speed over the ground in the last frame of the drag and in the first of the glide (m/s), and the metres one pixel of the finger
   * covered (the drag's last frame).
   */
  function flick(row: number, step: number, hostMpp: number): { gliding: boolean; drag: number; glide: number; perPx: number } {
    const s = setup(plane);
    s.mpp.value = hostMpp;
    s.el.fire('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: row });
    s.frames(1);
    let x = 100;
    let before = s.camera.position.clone();
    let last = 0;
    for (let i = 0; i < 10; i++) {
      x += step;
      s.el.fire('pointermove', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: row });
      before = s.camera.position.clone();
      s.frames(1);
      last = s.camera.position.distanceTo(before);
    }
    s.el.fire('pointerup', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: row });
    const gliding = s.gesture.gliding;
    before = s.camera.position.clone();
    s.frames(1);
    return { gliding, drag: last / 0.016, glide: s.camera.position.distanceTo(before) / 0.016, perPx: last / step };
  }
  const NEAR = 760; // the bottom of the screen: ground 3.5 km from the camera, about 4 m a pixel
  const FAR = 120; // the upper part: ground 9 km away, about 11 m a pixel

  it('over near ground a flick of 300 px/s glides, though a pixel at the orbit target is many more metres than a pixel there', () => {
    // The host says a pixel at the orbit target is 20 m: scaled by that, the finger would have been 300 · 4 / 20 ≈ 60 px/s, too slow to glide.
    const f = flick(NEAR, 4.8, 20);
    expect(f.perPx, 'metres per pixel of the near ground').toBeLessThan(5);
    expect(f.gliding).toBe(true);
    expect(f.glide / f.drag, 'the glide goes on at the speed of the drag').toBeGreaterThan(0.85);
    expect(f.glide / f.drag).toBeLessThan(1.05);
  });

  it('over far ground a fast flick keeps its speed: it is not scaled down by the orbit target’s idea of a wild flick', () => {
    // A pixel there is ~11 m; the host says half a metre at the target: scaled by that the finger would have been ~20 000 px/s and its glide cut to 3000 / 20 000 of the speed.
    const f = flick(FAR, 16, 0.5);
    expect(f.perPx, 'metres per pixel of the far ground').toBeGreaterThan(8);
    expect(f.gliding).toBe(true);
    expect(f.glide / f.drag, 'the glide goes on at the speed of the drag').toBeGreaterThan(0.85);
    expect(f.glide / f.drag).toBeLessThan(1.05);
  });

  it('the same finger speed glides the view farther over far ground than over near ground, in proportion to the ground a pixel covers', () => {
    const near = flick(NEAR, 6, 5);
    const far = flick(FAR, 6, 5);
    expect(far.glide / near.glide).toBeGreaterThan(2);
    expect(far.glide / near.glide / (far.perPx / near.perPx)).toBeGreaterThan(0.9);
    expect(far.glide / near.glide / (far.perPx / near.perPx)).toBeLessThan(1.1);
  });

  it('a slow finger (60 px/s) still just stops the view, whatever the ground', () => {
    expect(flick(NEAR, 1, 20).gliding).toBe(false);
    expect(flick(FAR, 1, 0.5).gliding).toBe(false);
  });
});

