/**
 * The maths of one-finger map dragging: "grab the ground and move it with the finger".
 *
 * OrbitControls' own pan moves the target by the finger's SCREEN delta scaled to the target distance, which is only right
 * for a plan view: at an oblique angle the ground moves slower than the finger (about 62 % at the default 52° tilt, where a
 * vertical finger move covers more ground than a pixel at the target stands for). A grab does it properly:
 *
 *   1. when the finger goes down, the ray through it is cut with the ground (the terrain heightfield; else the horizontal
 *      plane through the orbit target) and that point G is remembered;
 *   2. as the finger moves, the camera is translated over the ground by exactly the amount that makes the ray through the
 *      finger's NEW position pass through G again. Orientation does not change in a pan, so this is one ray / plane cut:
 *      T = G.xz − (o.xz + d.xz · t) with t the distance along the new ray d at which it is at G's height.
 *
 * G stays under the finger for any tilt, field of view and view inset (the NDC position is taken from the canvas rect and
 * the camera's own projection, setViewOffset included). Pure maths on THREE vectors: no DOM, unit-testable in Node.
 *
 * Nothing runs away near the horizon: at a flat angle one pixel of finger covers kilometres of ground there, so a finger's ray
 * is steepened to the line where the view would move {@link PAN.MAX_SPEEDUP} times faster than for a finger at the orbit target
 * (see {@link GroundGrab.begin}); a finger above that line (the sky, far ground) drags from it. When the ground is off the
 * domain or farther than {@link PAN.FAR} camera–target distances along the ray, the horizontal plane through the target is
 * grabbed, and as a last resort (a camera below its target) a view-plane drag at the target distance. A finger that is dragged
 * towards the horizon is rubber-banded at the same reach.
 */
import * as THREE from 'three';

/** Tuning of the one-finger pan and its glide (documented in docs/ARCHITECTURE.md → Camera). */
export const PAN = {
  /** Reach of a grab and of its rubber band, in camera–target distances. */
  FAR: 4,
  /**
   * The most a grab may speed the view up: at a flat viewing angle one pixel of finger covers kilometres of ground near the
   * horizon (a few pixels of drag would throw the camera across the domain), so a finger that lands on ground that would make the
   * view move more than this many times faster than a finger on the ground at the orbit target holds a point on its ray, nearer
   * and above that ground, instead (the far ground then lags the finger a little, as with any pan).
   */
  MAX_SPEEDUP: 5,
  /** Time constant (s) of the smoothing of the finger velocity that feeds the glide. */
  VELOCITY_TAU: 0.05,
  /** Glide: exponential decay time constant (s). */
  GLIDE_TAU: 0.25,
  /** Finger speed (screen px/s) below which letting go just stops the view; above it the view glides on. */
  FLING_MIN: 150,
  /** Cap of the glide's start speed (px/s): a wild flick glides at most {@link FLING_MAX} · {@link GLIDE_TAU} ≈ 750 px. */
  FLING_MAX: 3000,
  /** The glide ends when it has slowed to this speed (px/s). */
  STOP: 8,
} as const;

/** The part of the terrain heightfield a grab needs (HeightField satisfies it). */
export interface GrabSurface {
  /** First hit of a world ray with the terrain within `maxT` (multiples of the direction), or null. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): { t: number } | null;
}

/** World-space unit direction of the camera ray through an NDC position (no allocation). The camera's matrices must be current. */
export function rayDirection(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(ndcX, ndcY, 0.5).applyMatrix4(camera.projectionMatrixInverse); // a point in front of the camera, in view space
  return out.transformDirection(camera.matrixWorld); // rotate to world space and normalise
}

/** What a grab holds: 'ground' = a point on the terrain (or the target plane) that the finger keeps under it; 'view' = there was no ground under the finger, so the point at the target distance in the view plane is dragged instead. */
export type GrabKind = 'none' | 'ground' | 'view';

export class GroundGrab {
  private kind: GrabKind = 'none';
  /** The grabbed point (world). */
  readonly anchor = new THREE.Vector3();
  private reach = 1;
  private depth = 1;
  private readonly dir = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  /** Sine of the shallowest angle to the ground that a finger's ray is taken at (see {@link PAN.MAX_SPEEDUP}). */
  private sinMin = 0;
  /**
   * Where the grab took the finger's ray when it had to steepen it, minus where the finger was (NDC): added to the finger's
   * position from then on, so that a finger that landed in the sky (or on far ground) drags the pan from the steepest line like a
   * finger that landed on it, instead of doing nothing until it has travelled down to that line.
   */
  private offX = 0;
  private offY = 0;
  private readonly tmp = new THREE.Vector3();

  get active(): boolean {
    return this.kind !== 'none';
  }

  /** What the last {@link begin} grabbed. */
  get mode(): GrabKind {
    return this.kind;
  }

  /**
   * The distance along the ray (unit direction `d` from `o`) at which to hold the anchor: `t` (the ground), or nearer if holding
   * the ground there would speed the view up by more than {@link PAN.MAX_SPEEDUP}. The ground one pixel covers is about
   * (range ÷ sin of the ray's angle to the ground); the same measure for the orbit target (range `dist`, the view axis'
   * angle to the ground) is the yardstick.
   */
  private limitSpeedup(t: number, d: THREE.Vector3, o: THREE.Vector3, target: THREE.Vector3, dist: number): number {
    const sinRay = -d.y;
    if (!(sinRay > 1e-3)) return t;
    const sinAxis = THREE.MathUtils.clamp((o.y - target.y) / dist, 0.05, 1);
    return Math.min(t, (PAN.MAX_SPEEDUP * dist * sinRay) / sinAxis);
  }

  /**
   * A finger's ray, steepened to the shallowest angle to the ground that {@link PAN.MAX_SPEEDUP} allows (in place; the same
   * azimuth). Flat ground through the orbit target covers (sin of the view axis' angle to the ground ÷ sin of the ray's)²
   * times as much per pixel as the ground at the target, so the line on the screen where that reaches MAX_SPEEDUP is where
   * the pan stops following a finger that goes on towards the horizon or into the sky: nothing runs away there, and the
   * speed is continuous right up to that line. Returns whether the ray was changed.
   */
  private steepen(camera: THREE.PerspectiveCamera, d: THREE.Vector3): boolean {
    if (-d.y >= this.sinMin) return false;
    let hx = d.x;
    let hz = d.z;
    let hl = Math.hypot(hx, hz);
    if (hl < 1e-6) {
      // Looking straight up: any azimuth will do, the camera's own.
      this.fwd.set(0, 0, -1).transformDirection(camera.matrixWorld);
      hx = this.fwd.x;
      hz = this.fwd.z;
      hl = Math.hypot(hx, hz);
      if (hl < 1e-6) {
        hx = 0;
        hz = -1;
        hl = 1;
      }
    }
    const c = Math.sqrt(1 - this.sinMin * this.sinMin) / hl;
    d.set(hx * c, -this.sinMin, hz * c);
    return true;
  }

  /** Grab the ground under the NDC position (the finger went down). `target` is the orbit target (world). */
  begin(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, target: THREE.Vector3, surface: GrabSurface | null): void {
    camera.updateMatrixWorld();
    const o = camera.position;
    const dist = Math.max(1, o.distanceTo(target));
    this.sinMin = THREE.MathUtils.clamp((o.y - target.y) / dist, 0.05, 1) / Math.sqrt(PAN.MAX_SPEEDUP);
    const d = rayDirection(camera, ndcX, ndcY, this.dir);
    this.offX = 0;
    this.offY = 0;
    if (this.steepen(camera, d)) {
      const p = this.tmp.copy(o).addScaledVector(d, dist).project(camera); // where the steepened ray is on the screen
      this.offX = p.x - ndcX;
      this.offY = p.y - ndcY;
    }
    this.reach = PAN.FAR * dist;
    this.depth = dist;
    // 1. The terrain under the finger.
    if (surface) {
      const hit = surface.raycast(o.x, o.y, o.z, d.x, d.y, d.z, this.reach);
      if (hit && hit.t > 0 && hit.t <= this.reach) {
        this.anchor.copy(o).addScaledVector(d, this.limitSpeedup(hit.t, d, o, target, dist));
        this.kind = 'ground';
        return;
      }
    }
    // 2. The horizontal plane through the orbit target.
    if (d.y < -1e-3) {
      const t = (target.y - o.y) / d.y;
      if (t > 0 && t <= this.reach) {
        this.anchor.copy(o).addScaledVector(d, this.limitSpeedup(t, d, o, target, dist));
        this.kind = 'ground';
        return;
      }
    }
    // 3. Nothing to grab (finger above the horizon, or the ground is out of reach): drag the view plane at the target distance.
    this.fwd.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const k = d.dot(this.fwd);
    if (k < 0.05) {
      this.kind = 'none';
      return;
    }
    this.anchor.copy(o).addScaledVector(d, this.depth / k);
    this.kind = 'view';
  }

  /**
   * The horizontal translation (world x and z in `out`, y = 0) to add to the camera AND the target so the grabbed point is
   * under the NDC position again, for the camera as it is now. False when there is no grab or no solution (the caller
   * then does not move).
   */
  solve(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, out: THREE.Vector3): boolean {
    if (this.kind === 'none') return false;
    camera.updateMatrixWorld();
    const o = camera.position;
    const ground = this.kind === 'ground';
    const d = rayDirection(camera, ground ? ndcX + this.offX : ndcX, ground ? ndcY + this.offY : ndcY, this.dir);
    if (ground) this.steepen(camera, d);
    const a = this.anchor;
    if (ground) {
      // The distance along the new ray at which it is at the grabbed point's height; capped at the reach so a finger that
      // runs towards the horizon (or above it) does not send the camera off to infinity: the ground then lags the finger.
      let t = this.reach;
      if (Math.abs(d.y) > 1e-6) {
        const tt = (a.y - o.y) / d.y;
        if (tt > 0 && tt < t) t = tt;
      }
      out.set(a.x - o.x - d.x * t, 0, a.z - o.z - d.z * t);
      return true;
    }
    this.fwd.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const k = d.dot(this.fwd);
    if (k < 0.05) return false;
    const s = this.depth / k;
    out.set(a.x - o.x - d.x * s, 0, a.z - o.z - d.z * s);
    return true;
  }

  clear(): void {
    this.kind = 'none';
  }
}

/**
 * Light inertia of a released pan: the finger's velocity (smoothed over ~50 ms from the translations actually applied each
 * frame) decays exponentially (time constant {@link PAN.GLIDE_TAU}) after the finger lifts, and only if it was clearly
 * moving. World metres per second on the ground plane; `metresPerPx` (ground metres a screen pixel stands for) turns it
 * into the finger speed the thresholds are written in.
 */
export class PanMomentum {
  vx = 0;
  vz = 0;
  private on = false;

  get gliding(): boolean {
    return this.on;
  }

  /** Speed of the smoothed velocity in world m/s. */
  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Feed the translation (dx, dz metres) that was applied over `dt` seconds while the finger was dragging. */
  track(dx: number, dz: number, dt: number): void {
    if (!(dt > 1e-4)) return;
    const a = 1 - Math.exp(-dt / PAN.VELOCITY_TAU);
    this.vx += (dx / dt - this.vx) * a;
    this.vz += (dz / dt - this.vz) * a;
  }

  /** The finger lifted. Starts the glide and returns true if it was moving clearly faster than {@link PAN.FLING_MIN}. */
  release(metresPerPx: number): boolean {
    const px = metresPerPx > 0 ? this.speed / metresPerPx : 0;
    if (!(px >= PAN.FLING_MIN)) {
      this.stop();
      return false;
    }
    if (px > PAN.FLING_MAX) {
      const k = PAN.FLING_MAX / px;
      this.vx *= k;
      this.vz *= k;
    }
    this.on = true;
    return true;
  }

  /**
   * Advance the glide by `dt` seconds: the translation to apply is written to `out` (x, z) and the velocity decays. Returns
   * false (and `out` is zero) when no glide is running or it has just ended.
   */
  step(dt: number, metresPerPx: number, out: THREE.Vector3): boolean {
    out.set(0, 0, 0);
    if (!this.on) return false;
    const k = Math.exp(-Math.max(0, dt) / PAN.GLIDE_TAU);
    // The exact integral of v·e^(−t/τ) over the step, so the distance covered does not depend on the frame rate.
    const dist = PAN.GLIDE_TAU * (1 - k);
    out.set(this.vx * dist, 0, this.vz * dist);
    this.vx *= k;
    this.vz *= k;
    if (!(this.speed / Math.max(1e-9, metresPerPx) > PAN.STOP)) {
      this.stop();
    }
    return true;
  }

  /** Cancel the glide and forget the velocity (a new touch, a flight, a mode change, disposal). */
  stop(): void {
    this.on = false;
    this.vx = 0;
    this.vz = 0;
  }
}
