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
 * The speed of the view is therefore the touched ground's own: ground near the camera (the bottom of the screen) moves the view
 * slowly, far ground (the top) fast, because that is how fast it moves on the screen when the camera moves. The orbit target and
 * its distance set nothing. Two limits hold the pan back, and only where there is no ground to hold:
 *
 *   - Terrain under the finger is held exactly down to {@link PAN.HORIZON_MARGIN_DEG} below the horizon. Nearer the horizon one
 *     pixel covers kilometres (the speed goes with 1 / sin² of the angle below the horizon), so a finger that lands or goes there
 *     holds the line at the margin: the speed stops rising and nothing runs away (a few pixels of drag cannot throw the camera
 *     across the domain). A finger that landed beyond the line keeps its offset to it (no dead zone going down, no pull going up).
 *   - A finger with NO terrain under it (the sky, or beyond the edge of the domain, which is not drawn) drags the horizontal plane
 *     through the orbit target, steepened to the line where that would move the view {@link PAN.SKY_SPEEDUP} times faster than
 *     a finger at the target (see {@link GroundGrab.begin}): there is no ground for the finger to hold, so the middle of the view
 *     sets the pace.
 *
 * As a last resort (a camera below its target) a view-plane drag at the target distance. A finger that is dragged towards the
 * horizon is rubber-banded at {@link PAN.FAR} camera–target distances.
 */
import * as THREE from 'three';

/** Tuning of the one-finger pan and its glide (documented in docs/ARCHITECTURE.md → Camera). */
export const PAN = {
  /**
   * Reach of a grab and of its rubber band, in camera–target distances. Visible ground of a zoomed-in oblique view is many
   * distances away (the far edge of a 6 km domain seen from 600 m is ten), so this is a sanity bound, not a limit that ground the
   * user can see meets.
   */
  FAR: 12,
  /**
   * Terrain under the finger is held exactly, at any tilt, down to this angle below the horizon (degrees). A finger nearer the
   * horizon, or above it, holds the line at this angle: one pixel there covers ground at 1 / sin² of the angle (some 20 times the
   * camera's height at 3°, without bound at 0°), so a few pixels of drag would throw the camera across the domain. At 3° it is
   * at most about 2 % of the domain per pixel, and the band is about 5 % of the screen's height (50 px of 915).
   */
  HORIZON_MARGIN_DEG: 3,
  /**
   * For a finger with no terrain under it (the sky, beyond the domain): the most the view may speed up compared with a finger on
   * the ground at the orbit target. The plane through the target is dragged there, and near the horizon it covers hundreds of
   * times the ground per pixel; a finger above the line where it reaches this many times holds the line instead.
   */
  SKY_SPEEDUP: 5,
  /** Time constant (s) of the smoothing of the finger velocity that feeds the glide. */
  VELOCITY_TAU: 0.05,
  /** Glide: exponential decay time constant (s). */
  GLIDE_TAU: 0.25,
  /** Finger speed (screen px/s) below which letting go just stops the view; above it the view glides on. */
  FLING_MIN: 150,
  /** Cap of the glide's start speed (the finger's screen px/s): a wild flick glides at most {@link FLING_MAX} · {@link GLIDE_TAU} ≈ 750 px. */
  FLING_MAX: 3000,
  /** The glide ends when it has slowed to this finger speed (px/s). */
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
  /** Sine of the shallowest angle to the ground that a finger's ray is taken at (see {@link PAN.HORIZON_MARGIN_DEG}, {@link PAN.SKY_SPEEDUP}). */
  private sinMin = 0;
  /**
   * Where the grab took the finger's ray when it had to steepen it, minus where the finger was (NDC): added to the finger's
   * position from then on, so that a finger that landed in the sky (or on ground within the margin of the horizon) drags the pan
   * from the steepest line like a finger that landed on it, instead of doing nothing until it has travelled down to that line.
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
   * A finger's ray, steepened to the shallowest angle below the horizon that this grab allows (`sinMin`; in place, the same
   * azimuth). Flat ground covers 1 / sin² of that angle per pixel, so the line on the screen where it is reached is where the
   * pan stops following a finger that goes on towards the horizon or into the sky: nothing runs away there, and the speed is
   * continuous right up to that line. Returns whether the ray was changed.
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

  /** Steepen the ray `d` of the finger at (ndcX, ndcY) to the line of this grab and remember how far that moved it on the screen. */
  private steepenWithOffset(camera: THREE.PerspectiveCamera, d: THREE.Vector3, ndcX: number, ndcY: number, dist: number): boolean {
    if (!this.steepen(camera, d)) return false;
    const p = this.tmp.copy(camera.position).addScaledVector(d, dist).project(camera); // where the steepened ray is on the screen
    this.offX = p.x - ndcX;
    this.offY = p.y - ndcY;
    return true;
  }

  /**
   * Grab the ground under the NDC position (the finger went down). `target` is the orbit target (world).
   *
   *   1. Terrain under the finger: the first hit of the finger's ray within the reach is held, exactly, as long as the ray is not
   *      within {@link PAN.HORIZON_MARGIN_DEG} of the horizon; a ray that is (or that points above it) is steepened to that line
   *      first and the terrain hit there is held. Nothing about the orbit target enters: the speed is the touched ground's.
   *   2. No terrain under the finger (the sky, beyond the domain, farther than the reach): the horizontal plane through the orbit
   *      target, with the ray steepened to the line where that plane would move the view {@link PAN.SKY_SPEEDUP} times faster
   *      than ground at the target (flat ground covers (sin of the view axis' angle to the ground ÷ sin of the ray's)² times as
   *      much per pixel as the ground at the target).
   *   3. Neither (a camera below its target): the view plane at the target distance.
   */
  begin(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, target: THREE.Vector3, surface: GrabSurface | null): void {
    camera.updateMatrixWorld();
    const o = camera.position;
    const dist = Math.max(1, o.distanceTo(target));
    this.offX = 0;
    this.offY = 0;
    this.reach = PAN.FAR * dist;
    this.depth = dist;
    const d = rayDirection(camera, ndcX, ndcY, this.dir);
    // 1. The terrain under the finger.
    if (surface) {
      let hit = surface.raycast(o.x, o.y, o.z, d.x, d.y, d.z, this.reach);
      if (hit && hit.t > 0 && hit.t <= this.reach) {
        this.sinMin = Math.sin(THREE.MathUtils.degToRad(PAN.HORIZON_MARGIN_DEG));
        if (this.steepenWithOffset(camera, d, ndcX, ndcY, dist)) hit = surface.raycast(o.x, o.y, o.z, d.x, d.y, d.z, this.reach);
        if (hit && hit.t > 0 && hit.t <= this.reach) {
          this.anchor.copy(o).addScaledVector(d, hit.t);
          this.kind = 'ground';
          return;
        }
        // (The steepened ray found no terrain: it left the domain. Treat the finger as one with no ground under it.)
        rayDirection(camera, ndcX, ndcY, d);
        this.offX = 0;
        this.offY = 0;
      }
    }
    // 2. The horizontal plane through the orbit target, with a ray no flatter than the line of SKY_SPEEDUP.
    this.sinMin = THREE.MathUtils.clamp((o.y - target.y) / dist, 0.05, 1) / Math.sqrt(PAN.SKY_SPEEDUP);
    this.steepenWithOffset(camera, d, ndcX, ndcY, dist);
    if (d.y < -1e-3) {
      const t = (target.y - o.y) / d.y;
      if (t > 0 && t <= this.reach) {
        this.anchor.copy(o).addScaledVector(d, t);
        this.kind = 'ground';
        return;
      }
    }
    // 3. Nothing to grab (the plane is out of reach, or the camera is below the target): drag the view plane at the target distance.
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
 * Light inertia of a released pan: the view's velocity over the ground (smoothed over ~50 ms from the translations actually
 * applied each frame, so it is the speed the finger had over the ground it touched) carries on after the finger lifts and
 * decays exponentially (time constant {@link PAN.GLIDE_TAU}), only if the finger was clearly moving. World metres per second
 * on the ground plane. The thresholds are written in the finger's screen speed (px/s); what turns one into the other is the
 * ground one pixel of the finger covered at the touched point, which the drag measures ({@link PanMomentum.track}): ground
 * near the camera moves the view slowly per pixel and far ground fast, so a flick at the bottom of the screen and one at the top
 * glide as the finger moved, not as the orbit target would have.
 */
export class PanMomentum {
  vx = 0;
  vz = 0;
  private on = false;
  /** The finger's screen speed (px/s) and the speed the grab asked of the view (m/s) over the drag, smoothed alike: their ratio is the ground a pixel stood for. */
  private fingerSpeed = 0;
  private askedSpeed = 0;
  /** Ground metres per finger pixel of the glide that is running (0: unknown, the caller's scale is used). */
  private scale = 0;

  get gliding(): boolean {
    return this.on;
  }

  /** Speed of the smoothed velocity in world m/s. */
  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * Ground metres one pixel of the finger covered at the touched point, measured over the drag (0 before the finger has moved).
   * A pixel is not the same ground in every direction, so this is the scale of the way the finger moved.
   */
  get metresPerFingerPx(): number {
    return this.fingerSpeed > 1 ? this.askedSpeed / this.fingerSpeed : 0;
  }

  /**
   * Feed the translation (dx, dz metres) that was applied over `dt` seconds while the finger was dragging, and, to give the
   * thresholds their finger speed, how far the finger itself went on the screen in that time (`fingerPx`) and how far the grab
   * asked the view to go for it (`askedM`, before the domain's clamp took part of it away; both are step lengths).
   */
  track(dx: number, dz: number, dt: number, fingerPx = 0, askedM = 0): void {
    if (!(dt > 1e-4)) return;
    const a = 1 - Math.exp(-dt / PAN.VELOCITY_TAU);
    this.vx += (dx / dt - this.vx) * a;
    this.vz += (dz / dt - this.vz) * a;
    this.fingerSpeed += (fingerPx / dt - this.fingerSpeed) * a;
    this.askedSpeed += (askedM / dt - this.askedSpeed) * a;
  }

  /**
   * The finger lifted. Starts the glide and returns true if the finger was moving clearly faster than {@link PAN.FLING_MIN}.
   * `metresPerPx` (ground metres a pixel stands for at the orbit target) is only used when the drag could not measure the
   * touched ground's own (no finger movement was fed to {@link PanMomentum.track}).
   */
  release(metresPerPx: number): boolean {
    const known = this.metresPerFingerPx;
    const scale = known > 0 ? known : metresPerPx;
    const px = scale > 0 ? this.speed / scale : 0;
    if (!(px >= PAN.FLING_MIN)) {
      this.stop();
      return false;
    }
    if (px > PAN.FLING_MAX) {
      const k = PAN.FLING_MAX / px;
      this.vx *= k;
      this.vz *= k;
    }
    this.scale = known;
    this.on = true;
    return true;
  }

  /**
   * Advance the glide by `dt` seconds: the translation to apply is written to `out` (x, z) and the velocity decays. Returns
   * false (and `out` is zero) when no glide is running or it has just ended. `metresPerPx` is as for {@link PanMomentum.release}.
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
    if (!(this.speed / Math.max(1e-9, this.scale > 0 ? this.scale : metresPerPx) > PAN.STOP)) {
      this.stop();
    }
    return true;
  }

  /** Cancel the glide and forget the velocity (a new touch, a flight, a mode change, disposal). */
  stop(): void {
    this.on = false;
    this.vx = 0;
    this.vz = 0;
    this.fingerSpeed = 0;
    this.askedSpeed = 0;
    this.scale = 0;
  }
}
