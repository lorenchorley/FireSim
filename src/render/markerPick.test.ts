/** Which icon a tap is on (markerPick.ts): the radius rules, the pin offset, ranking, stacking, the projection and the homes. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ignition, Insight, SpotFire } from '../core/types';
import type { MapMarker } from './api';
import { HOME_HIT_PX, MIN_HIT_PX, homeCandidates, hitRadius, iconCandidate, iconCentre, markerRank, pickMarkerAt, projectPoint, type MarkerSource, type PickCandidate } from './markerPick';

const ignition = (origin: Ignition['origin'] = 'observed'): Ignition => ({ id: 'i1', kind: 'point', points: [[10, 20]], time: 0, origin });
const spot = { id: 1, x: 5, y: 6, time: 100, distance: 300, travel: 400 } as SpotFire;
const insight = { id: 'n1', kind: 'ridge-crest', severity: 'info', time: 0, x: 1, y: 2, title: 'Ridge', body: '', factors: [] } as Insight;

const YOU: MarkerSource = { kind: 'you', x: 0, y: 0 };
const IGN: MarkerSource = { kind: 'ignition', x: 10, y: 20, ignition: ignition() };
const SPOT: MarkerSource = { kind: 'spot', x: 5, y: 6, spot };
const INS: MarkerSource = { kind: 'insight', x: 1, y: 2, insight };
const HOME: MarkerSource = { kind: 'home', x: 3, y: 4 };

/** A candidate centred at (sx, sy) with a size, built directly (no pin offset). */
const at = (marker: MarkerSource, sx: number, sy: number, sizePx = 30): PickCandidate => iconCandidate(marker, sx, sy, sizePx, false);

describe('hit radius', () => {
  it('a tap inside the radius hits and just outside does not', () => {
    const c = [at(INS, 100, 100, 30)];
    expect(pickMarkerAt(100 + MIN_HIT_PX - 0.1, 100, c)?.kind).toBe('insight');
    expect(pickMarkerAt(100 + MIN_HIT_PX + 0.1, 100, c)).toBeNull();
    expect(pickMarkerAt(100, 100 - MIN_HIT_PX + 0.1, c)?.kind).toBe('insight');
    expect(pickMarkerAt(100 + 16, 100 + 16, c)).toBeNull(); // 22.6 px away along the diagonal: just out
    expect(pickMarkerAt(100 + 15, 100 + 15, c)?.kind).toBe('insight'); // 21.2 px: in
  });

  it('icons under 44 px get the 22 px minimum (a 22 px user dot is hit 22 px from its centre, not 11)', () => {
    const you = [at(YOU, 50, 50, 22)];
    expect(hitRadius(you[0]!)).toBe(22);
    expect(pickMarkerAt(50 + 21.9, 50, you)?.kind).toBe('you');
    expect(pickMarkerAt(50 + 22.1, 50, you)).toBeNull();
  });

  it('an icon bigger than 44 px keeps its own half size', () => {
    const big = [at(INS, 0, 0, 64)];
    expect(hitRadius(big[0]!)).toBe(32);
    expect(pickMarkerAt(31, 0, big)?.kind).toBe('insight');
    expect(pickMarkerAt(33, 0, big)).toBeNull();
  });

  it('a home uses 14 px whatever its size', () => {
    const home = [{ marker: HOME, sx: 0, sy: 0, halfPx: 40, rank: markerRank(HOME) }];
    expect(hitRadius(home[0]!)).toBe(HOME_HIT_PX);
    expect(pickMarkerAt(13.9, 0, home)?.kind).toBe('home');
    expect(pickMarkerAt(14.1, 0, home)).toBeNull();
  });

  it('no candidates, no hit', () => {
    expect(pickMarkerAt(0, 0, [])).toBeNull();
  });
});

describe('a pin stands on its anchor', () => {
  const anchor: [number, number] = [200, 300];
  const pin = [iconCandidate(IGN, anchor[0], anchor[1], 34, true)];

  it('its picture is centred half its height above the anchor', () => {
    expect(iconCentre(200, 300, 34, true)).toEqual([200, 283]);
    expect(iconCentre(200, 300, 34, false)).toEqual([200, 300]);
    expect(pin[0]!.sx).toBe(200);
    expect(pin[0]!.sy).toBe(283);
  });

  it('hits on its body and its tip but not 30 px below the tip', () => {
    expect(pickMarkerAt(200, 283, pin)?.kind).toBe('ignition'); // the middle of the picture
    expect(pickMarkerAt(200, 283 - 17, pin)?.kind).toBe('ignition'); // the top of the pin
    expect(pickMarkerAt(200, 300, pin)?.kind).toBe('ignition'); // the tip
    expect(pickMarkerAt(200, 305, pin)?.kind).toBe('ignition'); // 22 px from the centre: the edge
    expect(pickMarkerAt(200, 306, pin)).toBeNull();
    expect(pickMarkerAt(200, 330, pin)).toBeNull(); // 30 px below the tip
  });

  it('a tap on the ground where the tip is hits even though the picture is above it, and one on the ground above the pin does not', () => {
    expect(pickMarkerAt(200, 300, pin)).not.toBeNull();
    expect(pickMarkerAt(200, 283 - 23, pin)).toBeNull();
  });
});

describe('nearest wins, ties by rank, stacked count', () => {
  it('the nearest centre wins and says how many others were also hit', () => {
    const cands = [at(INS, 100, 100), at(SPOT, 110, 100, 26), at(YOU, 150, 100, 22)];
    const r = pickMarkerAt(108, 100, cands)!;
    expect(r.kind).toBe('spot');
    expect(r.others).toBe(1); // the insight is also within 22 px; the user dot is 42 px away
    expect(pickMarkerAt(100, 100, cands)!.kind).toBe('insight');
  });

  it('an exact tie goes to the higher rank: you, ignition, spot fire, insight, home', () => {
    const order: MarkerSource[] = [HOME, INS, SPOT, IGN, YOU];
    const cands = order.map((m) => at(m, 10, 10));
    const r = pickMarkerAt(10, 10, cands)!;
    expect(r.kind).toBe('you');
    expect(r.others).toBe(4);
    expect(pickMarkerAt(10, 10, cands.filter((c) => c.marker.kind !== 'you'))!.kind).toBe('ignition');
    expect(pickMarkerAt(10, 10, cands.filter((c) => c.marker.kind !== 'you' && c.marker.kind !== 'ignition'))!.kind).toBe('spot');
    expect(pickMarkerAt(10, 10, cands.filter((c) => c.marker.kind === 'insight' || c.marker.kind === 'home'))!.kind).toBe('insight');
  });

  it('a spot fire the user marked (an ignition with origin spot) ranks as a spot fire', () => {
    const marked: MarkerSource = { kind: 'ignition', x: 0, y: 0, ignition: ignition('spot') };
    expect(markerRank(marked)).toBe(markerRank(SPOT));
    expect(markerRank(marked)).toBeGreaterThan(markerRank(IGN));
    expect(pickMarkerAt(0, 0, [at(marked, 0, 0), at(IGN, 0, 0)])!.kind).toBe('ignition');
    expect((pickMarkerAt(0, 0, [at(marked, 0, 0), at(IGN, 0, 0)]) as Extract<MapMarker, { kind: 'ignition' }>).ignition.origin).toBe('observed');
  });

  it('an exact tie of the same rank goes to the earlier candidate', () => {
    const second: MarkerSource = { kind: 'spot', x: 9, y: 9, spot: { ...spot, id: 2 } };
    const r = pickMarkerAt(0, 0, [at(SPOT, 0, 0), at(second, 0, 0)])!;
    expect(r).toMatchObject({ kind: 'spot', x: 5, y: 6, others: 1 });
  });

  it('a lone icon has no others, and the result carries the icon\'s own spot and data', () => {
    const r = pickMarkerAt(0, 0, [at(IGN, 0, 0), at(INS, 500, 500)])!;
    expect(r).toMatchObject({ kind: 'ignition', x: 10, y: 20, others: 0 });
    expect((r as Extract<MapMarker, { kind: 'ignition' }>).ignition).toBe(IGN.kind === 'ignition' ? IGN.ignition : null);
  });
});

/** A perspective camera at the origin looking down -z (the view matrix is the identity); column-major like three.js. */
function perspective(fovYDeg: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan((fovYDeg * Math.PI) / 360);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

describe('projection', () => {
  const W = 400;
  const H = 800;
  const vp = perspective(60, W / H, 1, 10000);

  it('the point straight ahead lands in the middle of the view', () => {
    const [sx, sy] = projectPoint(vp, 0, 0, -50, W, H)!;
    expect(sx).toBeCloseTo(W / 2, 6);
    expect(sy).toBeCloseTo(H / 2, 6);
  });

  it('a point above the middle is higher on the screen (smaller y)', () => {
    expect(projectPoint(vp, 0, 10, -50, W, H)![1]).toBeLessThan(H / 2);
  });

  it('a point behind the camera (or on its plane) is excluded', () => {
    expect(projectPoint(vp, 0, 0, 50, W, H)).toBeNull();
    expect(projectPoint(vp, 0, 0, 0, W, H)).toBeNull();
    expect(projectPoint(vp, 30, 5, 1, W, H)).toBeNull();
  });

  it('is not clipped to the screen: a centre just off the edge can still be hit, and one far off cannot', () => {
    // find the x whose point lands 10 px beyond the right edge
    const z = -100;
    let x = 0;
    for (let lo = 0, hi = 500, i = 0; i < 60; i++) {
      x = (lo + hi) / 2;
      const s = projectPoint(vp, x, 0, z, W, H)![0];
      if (s < W + 10) lo = x;
      else hi = x;
    }
    const [sx, sy] = projectPoint(vp, x, 0, z, W, H)!;
    expect(sx).toBeCloseTo(W + 10, 3);
    const cand = [iconCandidate(INS, sx, sy, 30, false)];
    expect(pickMarkerAt(W - 5, sy, cand)?.kind).toBe('insight'); // a finger on the visible edge, 15 px from the centre
    expect(pickMarkerAt(W - 30, sy, cand)).toBeNull();
  });

  it('agrees with three.js (Vector3.project) for a camera looking at a slope', () => {
    const cam = new THREE.PerspectiveCamera(50, W / H, 5, 40000);
    cam.position.set(1200, 900, 700);
    cam.lookAt(100, 200, -300);
    cam.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    for (const p of [[100, 200, -300], [400, 150, -100], [-200, 600, -900], [900, 0, 500]] as const) {
      const ndc = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
      const s = projectPoint(m.elements, p[0], p[1], p[2], W, H)!;
      expect(s[0]).toBeCloseTo(((ndc.x + 1) / 2) * W, 4);
      expect(s[1]).toBeCloseTo(((1 - ndc.y) / 2) * H, 4);
    }
    // a point behind the camera is excluded, as the icon shader draws nothing for clip.w <= 0
    expect(projectPoint(m.elements, 2400, 1800, 1400, W, H)).toBeNull();
  });
});

describe('homes', () => {
  // Three homes on a 100 px grid on the screen; `project` is the identity (local metres = screen px).
  const homes = Float32Array.from([100, 100, 200, 100, 105, 108]);
  const project = (x: number, y: number): [number, number] => [x, y];
  const visible = (): boolean => false;

  it('nothing at all when the Homes layer is off', () => {
    expect(homeCandidates(homes, false, 100, 100, project, visible)).toEqual([]);
  });

  it('only the homes within 14 px of the tap are candidates', () => {
    const c = homeCandidates(homes, true, 100, 100, project, visible);
    expect(c.map((x) => [x.marker.x, x.marker.y])).toEqual([
      [100, 100],
      [105, 108],
    ]);
    expect(homeCandidates(homes, true, 100, 100 + 14.5, project, visible).map((x) => x.marker.x)).toEqual([105]);
    expect(homeCandidates(homes, true, 150, 150, project, visible)).toEqual([]);
  });

  it('a home hidden behind terrain is skipped, and so is one the projection drops (behind the camera)', () => {
    expect(homeCandidates(homes, true, 100, 100, project, (x) => x === 100)).toHaveLength(1);
    expect(homeCandidates(homes, true, 100, 100, (x, y) => (x === 100 ? null : [x, y]), visible)).toHaveLength(1);
  });

  it('the line-of-sight test only runs for homes in reach of the tap', () => {
    let calls = 0;
    homeCandidates(homes, true, 200, 100, project, () => (calls++, false));
    expect(calls).toBe(1);
  });

  it('a tap picks the nearest home, counts the others, and loses to any other icon at the same distance', () => {
    const c = homeCandidates(homes, true, 103, 104, project, visible);
    const r = pickMarkerAt(103, 104, c)!;
    expect(r).toMatchObject({ kind: 'home', x: 105, y: 108, others: 1 });
    const withIcon = [...c, at(INS, 103, 104)];
    expect(pickMarkerAt(103, 104, withIcon)!.kind).toBe('insight');
  });

  it('every candidate is a plain home marker (one per address)', () => {
    const c = homeCandidates(homes, true, 100, 100, project, visible);
    expect(c.every((x) => x.marker.kind === 'home' && x.rank === markerRank(HOME) && x.halfPx === HOME_HIT_PX)).toBe(true);
  });
});
