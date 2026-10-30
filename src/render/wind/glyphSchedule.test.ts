/**
 * The decisions of the wind glyph layer, as pure functions: what makes the drawn picture out of date and which fact wins, the
 * 250 ms throttle with a fake clock, how many segments the frame can still take, and the log of slice times.
 */
import { describe, expect, it } from 'vitest';
import { REBUILD_MIN_GAP_MS } from './glyphPose';
import { LEVEL_EDGES, metresPerPixelAt, planLod } from './glyphLod';
import { detailPlan, mayRebuild, rebuildReason, segmentCap, SliceLog, type BuiltPicture, type PictureNow } from './glyphSchedule';
import { DETAIL_GEOMETRY, FRAME_TRIANGLE_LIMIT, GLYPH_CAPS, type Box, type LodPlan } from './glyphTypes';

/** The camera of these tests: 3 km from a target on the ground at (0, 0), looking down at it from the south at about 56 degrees. */
const EYE: [number, number, number] = [0, 2500, 1700];
const DISTANCE = Math.hypot(EYE[0], EYE[1], EYE[2]);
const PITCH = Math.atan2(EYE[1], EYE[2]);
/** The orientation of that camera turned `yawDeg` about the vertical axis (a yaw times the pitch, as a quaternion x, y, z, w). */
const quat = (yawDeg = 0): [number, number, number, number] => {
  const sy = Math.sin((yawDeg * Math.PI) / 360);
  const cy = Math.cos((yawDeg * Math.PI) / 360);
  const sx = -Math.sin(PITCH / 2);
  const cx = Math.cos(PITCH / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
};
/** [eye xyz, target x, target z, quaternion xyzw, cssW, cssH, vex]. */
const pose = (o: { eye?: [number, number, number]; yaw?: number; css?: [number, number]; vex?: number } = {}): Float64Array => {
  const [ex, ey, ez] = o.eye ?? EYE;
  const [qx, qy, qz, qw] = quat(o.yaw);
  const [w, h] = o.css ?? [400, 800];
  return Float64Array.of(ex, ey, ez, 0, 0, qx, qy, qz, qw, w, h, o.vex ?? 1);
};
const BOX: Box = { x0: -2000, y0: -2000, x1: 2000, y1: 2000 };
const built = (o: Partial<BuiltPicture> = {}): BuiltPicture => ({ dataSerial: 4, height: 'fire', level: 3, spacingExp: 7, pose: pose(), proj: Float64Array.of(50, 0, 0), box: BOX, ...o });
const now = (o: Partial<PictureNow> = {}): PictureNow => ({ dataSerial: 4, height: 'fire', level: 3, spacingExp: 7, pose: pose(), proj: Float64Array.of(50, 0, 0), distanceM: DISTANCE, ...o });
const inside = (): Box => ({ x0: -1500, y0: -1500, x1: 1500, y1: 1500 });

describe('rebuildReason', () => {
  it('asks for the first picture when none is drawn', () => {
    expect(rebuildReason(null, now(), inside)).toBe('first');
  });

  it('keeps a picture that nothing has changed', () => {
    expect(rebuildReason(built(), now(), inside)).toBeNull();
  });

  it('names new data, a new height, a new level and a new lattice, in that order', () => {
    expect(rebuildReason(built(), now({ dataSerial: 5 }), inside)).toBe('snapshot');
    expect(rebuildReason(built(), now({ height: 300 }), inside)).toBe('height');
    expect(rebuildReason(built(), now({ level: 4 }), inside)).toBe('level');
    expect(rebuildReason(built(), now({ spacingExp: 8 }), inside)).toBe('lattice');
    expect(rebuildReason(built(), now({ dataSerial: 5, height: 300, level: 4, spacingExp: 8 }), inside)).toBe('snapshot');
    expect(rebuildReason(built(), now({ height: 300, level: 4, spacingExp: 8 }), inside)).toBe('height');
    expect(rebuildReason(built(), now({ level: 4, spacingExp: 8 }), inside)).toBe('level');
  });

  it('compares the pose with the BUILT picture, so small drifts add up', () => {
    // 3 km out: the camera may move max(12 m, 10 % of 3 km) = 300 m before the picture is old.
    expect(rebuildReason(built(), now({ pose: pose({ eye: [200, 2500, 1700] }) }), inside)).toBeNull();
    expect(rebuildReason(built(), now({ pose: pose({ eye: [400, 2500, 1700] }) }), inside)).toBe('moved');
    // Another 200 m from where the picture was built is not a small step any more, however small the last frame's.
    expect(rebuildReason(built({ pose: pose({ eye: [200, 2500, 1700] }) }), now({ pose: pose({ eye: [450, 2500, 1700] }) }), inside)).toBeNull();
    expect(rebuildReason(built(), now({ pose: pose({ eye: [450, 2500, 1700] }) }), inside)).toBe('moved');
  });

  it('turns after about 10 degrees, and resizes with the canvas or the exaggeration', () => {
    expect(rebuildReason(built(), now({ pose: pose({ yaw: 15 }) }), inside)).toBe('turned');
    expect(rebuildReason(built(), now({ pose: pose({ yaw: 4 }) }), inside)).toBeNull();
    expect(rebuildReason(built(), now({ pose: pose({ css: [400, 700] }) }), inside)).not.toBeNull();
    expect(rebuildReason(built(), now({ pose: pose({ vex: 2 }) }), inside)).not.toBeNull();
  });

  it('notices a panel opening: the projection moves although the camera does not', () => {
    expect(rebuildReason(built(), now({ proj: Float64Array.of(61, 0, 0.2) }), inside)).toBe('resized');
  });

  it('leaves the built box only when the visible ground is no longer inside it', () => {
    expect(rebuildReason(built(), now(), () => ({ x0: -2000, y0: -2000, x1: 2000, y1: 2000 }))).toBeNull();
    expect(rebuildReason(built(), now(), () => ({ x0: -1500, y0: -1500, x1: 2300, y1: 1500 }))).toBe('left-box');
    // Nothing visible (the camera looks at the sky) cannot be outside anything.
    expect(rebuildReason(built(), now(), () => null)).toBeNull();
  });

  it('asks for the visible ground only when nothing cheaper decided', () => {
    let asked = 0;
    const visible = (): Box => {
      asked++;
      return inside();
    };
    rebuildReason(null, now(), visible);
    rebuildReason(built(), now({ dataSerial: 9 }), visible);
    rebuildReason(built(), now({ level: 1 }), visible);
    rebuildReason(built(), now({ pose: pose({ eye: [900, 2500, 1700] }) }), visible);
    expect(asked).toBe(0);
    rebuildReason(built(), now(), visible);
    expect(asked).toBe(1);
  });
});

describe('mayRebuild (the 250 ms throttle, counted from the last swap)', () => {
  it('lets the first picture start at once', () => {
    expect(mayRebuild('first', 0, 0, false)).toBe(true);
    expect(mayRebuild('first', 10, 5, false)).toBe(true);
  });

  it('holds every other reason until 250 ms after the last swap', () => {
    expect(REBUILD_MIN_GAP_MS).toBe(250);
    for (const r of ['snapshot', 'height', 'level', 'lattice', 'moved', 'turned', 'zoomed', 'resized', 'left-box', 'exaggeration'] as const) {
      expect(mayRebuild(r, 1100, 1000, false), r).toBe(false);
      expect(mayRebuild(r, 1249, 1000, false), r).toBe(false);
      expect(mayRebuild(r, 1250, 1000, false), r).toBe(true);
    }
  });

  it('never holds back a settled frame (screenshots, tests)', () => {
    expect(mayRebuild('moved', 1001, 1000, true)).toBe(true);
  });

  it('is immediate after a long rest and before any swap', () => {
    expect(mayRebuild('snapshot', 60_000, 1000, false)).toBe(true);
    expect(mayRebuild('height', 0, -Infinity, false)).toBe(true);
  });

  it('allows four rebuilds a second at most while the camera keeps moving', () => {
    let last = -Infinity;
    let swaps = 0;
    for (let t = 0; t < 10_000; t += 16) {
      if (mayRebuild('moved', t, last, false)) {
        last = t;
        swaps++;
      }
    }
    expect(swaps / 10).toBeLessThanOrEqual(4);
    expect(swaps / 10).toBeGreaterThan(3);
  });
});

describe('segmentCap (the frame stays inside the triangle budget)', () => {
  const tier = GLYPH_CAPS.high.segments;

  it('is the tier cap while the rest of the frame leaves room', () => {
    expect(segmentCap(tier, 0, 0)).toBe(tier);
    expect(segmentCap(tier, 495_000, 0)).toBe(tier); // 495k + 4 x 12k = 543k
  });

  it('shrinks to what fits, 4 triangles to a segment', () => {
    expect(segmentCap(tier, 540_000, 0)).toBe(2500);
    expect(segmentCap(tier, FRAME_TRIANGLE_LIMIT, 0)).toBe(0);
    expect(segmentCap(tier, FRAME_TRIANGLE_LIMIT + 5000, 0)).toBe(0);
  });

  it('does not count its own picture against itself', () => {
    // The last frame held 3,000 of our segments (12,000 triangles) among 540,000: the rest is 528,000.
    expect(segmentCap(tier, 540_000, 3000)).toBe(5500);
    expect(segmentCap(tier, 12_000, 3000)).toBe(tier);
  });

  it('never goes past 550,000 triangles for any frame the layer can see', () => {
    for (const frame of [0, 100_000, 300_000, 450_000, 520_000, 549_000, 550_000, 600_000]) {
      for (const own of [0, 400, 4000, tier]) {
        const cap = segmentCap(tier, Math.max(frame, 4 * own), own);
        const others = Math.max(frame, 4 * own) - 4 * own;
        expect(others + 4 * cap).toBeLessThanOrEqual(Math.max(FRAME_TRIANGLE_LIMIT, others));
        expect(cap).toBeLessThanOrEqual(tier);
        expect(cap).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('segmentCap for the detailed streaks (2 triangles a segment, one batch)', () => {
  const tier = GLYPH_CAPS.high.segments;

  it('keeps the glyph pair as it was: 4 triangles a segment is the default', () => {
    for (const frame of [0, 200_000, 540_000, 560_000]) for (const own of [0, 3000]) expect(segmentCap(tier, frame, own, 4)).toBe(segmentCap(tier, frame, own));
  });

  it('is the tier cap while the rest of the frame leaves room, and shrinks 2 triangles to a segment', () => {
    expect(segmentCap(tier, 0, 0, 2)).toBe(tier);
    expect(segmentCap(tier, 526_000, 0, 2)).toBe(tier); // 526k + 2 x 12k = 550k
    expect(segmentCap(tier, 540_000, 0, 2)).toBe(5000);
    expect(segmentCap(tier, FRAME_TRIANGLE_LIMIT, 0, 2)).toBe(0);
    expect(segmentCap(tier, FRAME_TRIANGLE_LIMIT + 1, 0, 2)).toBe(0);
  });

  it('does not count its own picture against itself: 2 triangles of the last frame for each segment it drew', () => {
    // 3,000 detailed segments (6,000 triangles) among 540,000: the rest is 534,000, which leaves 16,000 triangles, 8,000 segments.
    expect(segmentCap(tier, 540_000, 3000, 2)).toBe(8000);
    expect(segmentCap(tier, 6000, 3000, 2)).toBe(tier);
  });

  it('never goes past 550,000 triangles for any frame the layer can see', () => {
    for (const frame of [0, 300_000, 520_000, 549_000, 550_000, 600_000]) {
      for (const own of [0, 400, 4000, tier]) {
        const cap = segmentCap(tier, Math.max(frame, 2 * own), own, 2);
        const others = Math.max(frame, 2 * own) - 2 * own;
        expect(others + 2 * cap).toBeLessThanOrEqual(Math.max(FRAME_TRIANGLE_LIMIT, others));
        expect(cap).toBeGreaterThanOrEqual(0);
        expect(cap).toBeLessThanOrEqual(tier);
      }
    }
  });
});

describe('detailPlan (what the most detailed level draws: the detailed streaks)', () => {
  const FOV = 50;
  const H = 800;
  /** The plan `planLod` gives at the middle of a screen `distance` metres from a 133 m cell, then the streaks' numbers on top. */
  const plan = (distance: number, prev: LodPlan | null, prevExp: number | null): { lod: LodPlan; exp: number } => {
    const mpp = metresPerPixelAt(distance, FOV, H);
    const lod = planLod(133 / mpp, mpp, prev, prev ?? undefined);
    return { lod, exp: lod.level === 4 ? detailPlan(lod, mpp, prevExp) : -99 };
  };

  it('puts the streaks\' geometry in the plan and leaves what the zoom decided alone', () => {
    const mpp = metresPerPixelAt(300, FOV, H);
    const lod = planLod(133 / mpp, mpp, null);
    const before = { level: lod.level, cellPx: lod.cellPx, mppCentre: lod.mppCentre };
    detailPlan(lod, mpp, null);
    expect(before.level).toBe(4);
    expect({ level: lod.level, cellPx: lod.cellPx, mppCentre: lod.mppCentre }).toEqual(before);
    expect(lod).toMatchObject({ spacingPx: DETAIL_GEOMETRY.spacingPx, curved: true, jitter: DETAIL_GEOMETRY.jitter });
    expect(lod.lengthPx).toEqual({ min: DETAIL_GEOMETRY.minPx, max: DETAIL_GEOMETRY.maxPx, pxPerMs: DETAIL_GEOMETRY.pxPerMs });
  });

  it('puts the lattice on a power of two of metres that is not denser than 40 px, as the curved levels do', () => {
    for (const mpp of [0.05, 0.3, 0.9, 1.31, 2.6]) {
      const lod = planLod(133 / mpp, mpp, null);
      const exp = detailPlan(lod, mpp, null);
      expect(lod.spacingM).toBe(2 ** exp);
      expect(lod.spacingM / mpp, `at ${mpp} m a pixel`).toBeGreaterThanOrEqual(DETAIL_GEOMETRY.spacingPx - 1e-9); // never denser than 40 px
      expect(lod.spacingM / mpp).toBeLessThan(2 * DETAIL_GEOMETRY.spacingPx + 1e-9); // and under twice that
    }
  });

  it('gives one lattice per zoom from either side, except inside the narrow band at an octave edge', () => {
    // Zoom in, then out, over about five octaves of the most detailed level: the exponent at each distance is the same going either way, but for the band.
    const dists: number[] = [];
    for (let d = 1100; d > 40; d /= 1.04) dists.push(d);
    const up = new Map<number, number>();
    let prev: LodPlan | null = null;
    let prevExp: number | null = null;
    for (const d of dists) {
      const r = plan(d, prev, prevExp);
      prev = r.lod;
      prevExp = r.exp;
      up.set(d, r.exp);
    }
    prev = null;
    prevExp = null;
    let differs = 0;
    for (const d of [...dists].reverse()) {
      const r = plan(d, prev, prevExp);
      prev = r.lod;
      prevExp = r.exp;
      const a = up.get(d)!;
      if (r.exp !== a) {
        differs++;
        expect(Math.abs(r.exp - a)).toBe(1); // one octave at the very most
        const t = Math.log2(DETAIL_GEOMETRY.spacingPx * metresPerPixelAt(d, FOV, H));
        expect(Math.abs(t - Math.round(t)), `at ${d.toFixed(0)} m`).toBeLessThanOrEqual(0.06 + 1e-9); // and only within the band of an octave edge
      }
    }
    expect(differs, 'the two ways do differ somewhere: the band is there').toBeGreaterThan(0);
  });

  it('holds the kept lattice inside the band and takes the new one outside it', () => {
    const mpp = (px: number): number => px / DETAIL_GEOMETRY.spacingPx; // log2(40 x mpp) = log2(px)
    const lod = planLod(500, mpp(64), null);
    expect(detailPlan(lod, mpp(64), null)).toBe(6); // 64 m on the lattice edge: the exponent 6 owns (5, 6]
    expect(detailPlan(lod, mpp(64 * 2 ** 0.04), 6)).toBe(6); // 0.04 of an octave past the edge: still 6
    expect(detailPlan(lod, mpp(64 * 2 ** 0.1), 6)).toBe(7); // 0.1: 7
    expect(detailPlan(lod, mpp(64 * 2 ** 0.1), null)).toBe(7);
    expect(detailPlan(lod, mpp(64 * 2 ** 0.04), null)).toBe(7); // no previous lattice: the zoom alone decides
  });

  it('does nothing odd for a plan with no metres a pixel', () => {
    const lod = planLod(500, 0.5, null);
    expect(detailPlan(lod, 0, null)).toBe(0);
    expect(lod.spacingM).toBe(1);
    expect(LEVEL_EDGES[3]).toBe(90); // (the level edges are planLod's, untouched)
  });
});

describe('SliceLog', () => {
  it('reads zero before any slice', () => {
    const log = new SliceLog();
    expect(log.p95()).toBe(0);
    expect(log.max()).toBe(0);
    expect(log.slicesLast).toBe(0);
    expect(log.lastMs).toBe(0);
  });

  it('keeps the last 64 slices for the p95 and the maximum', () => {
    const log = new SliceLog();
    for (let i = 1; i <= 100; i++) log.push(i); // the ring holds 37..100
    expect(log.max()).toBe(100);
    expect(log.p95()).toBe(97); // nearest rank: ceil(0.95 x 64) = 61st of 37..100
    for (let i = 0; i < 64; i++) log.push(1);
    expect(log.max()).toBe(1);
    expect(log.p95()).toBe(1);
  });

  it('reports the slices and the work of the last whole rebuild, and drops an abandoned one', () => {
    const log = new SliceLog();
    log.push(1.5);
    log.push(2.5);
    log.finish();
    expect(log.slicesLast).toBe(2);
    expect(log.lastMs).toBeCloseTo(4, 9);
    log.push(9);
    log.abandon();
    log.push(1);
    log.finish();
    expect(log.slicesLast).toBe(1);
    expect(log.lastMs).toBe(1);
    expect(log.max()).toBe(9); // the abandoned slice was real work
  });
});
