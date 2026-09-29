/**
 * Pure geometry of the places layers: clipping, resampling, ribbon attributes, houses, label candidates and
 * collision selection, zone rasterisation. Node only (no WebGL).
 */
import { describe, expect, it } from 'vitest';
import type { ContextLayers, RoadLine, ZonePolygon } from '../core/places';
import { EMPTY_CONTEXT } from '../core/places';
import {
  buildLabelCandidates,
  clipPolyline,
  FIRE_TRAIL_STYLE,
  homeInstances,
  houseGeometry,
  lineOfSightClear,
  RIBBON_STRIDE,
  RibbonBuilder,
  rasterizeZones,
  resamplePolyline,
  ROAD_WIDTH_M,
  roadDash,
  roadStyleIndex,
  sameOrigin,
  selectLabels,
  STYLE_COUNT,
  STYLES,
  zoneFrame,
  type ScreenItem,
} from './placesGeometry';

const flat = (): number => 100;
const origin = { lat: -33.7, lon: 150.3 };

describe('clipPolyline', () => {
  const b = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
  it('keeps a line that is inside as one piece', () => {
    const r = clipPolyline([10, 10, 50, 50, 90, 20], b);
    expect(r).toHaveLength(1);
    expect(Array.from(r[0]!)).toEqual([10, 10, 50, 50, 90, 20]);
  });
  it('cuts a line at the rectangle edge', () => {
    const r = clipPolyline([50, 50, 150, 50], b);
    expect(r).toHaveLength(1);
    expect(Array.from(r[0]!)).toEqual([50, 50, 100, 50]);
  });
  it('splits a line that leaves and re-enters', () => {
    const r = clipPolyline([50, 50, 150, 50, 150, 80, 50, 80], b);
    expect(r).toHaveLength(2);
    expect(Array.from(r[0]!)).toEqual([50, 50, 100, 50]);
    expect(Array.from(r[1]!)).toEqual([100, 80, 50, 80]);
  });
  it('drops lines fully outside', () => {
    expect(clipPolyline([-50, -50, -10, -10], b)).toHaveLength(0);
  });
});

describe('resamplePolyline', () => {
  it('limits the segment length and keeps the original vertices', () => {
    const r = resamplePolyline([0, 0, 45, 0, 45, 30], 20);
    // 45 m -> 3 pieces of 15 m; 30 m -> 2 pieces of 15 m.
    expect(r.xy.length / 2).toBe(1 + 3 + 2);
    expect(Array.from(r.xy.slice(6, 8))).toEqual([45, 0]);
    expect(r.along[5]).toBeCloseTo(75, 5);
    for (let i = 1; i < r.along.length; i++) expect(r.along[i]! - r.along[i - 1]!).toBeLessThanOrEqual(20 + 1e-4);
  });
});

describe('RibbonBuilder', () => {
  it('drapes a line: 2 vertices per resampled point with heights, half-width, dash period and style', () => {
    const rb = new RibbonBuilder();
    rb.addLine([0, 0, 100, 0], (x) => 50 + x * 0.1, { style: roadStyleIndex('local'), widthM: ROAD_WIDTH_M.local, periodM: 24 });
    const m = rb.build();
    expect(m.vertexCount).toBe(2 * 6); // 100 m / 20 m = 5 pieces -> 6 points
    expect(m.triangleCount).toBe(2 * 5);
    const at = (v: number, o: number): number => m.data[v * RIBBON_STRIDE + o]!;
    // heights follow the terrain function
    expect(at(0, 2)).toBeCloseTo(50, 5);
    expect(at(10, 2)).toBeCloseTo(50 + 100 * 0.1, 4);
    // straight line along +x: the left normal is +y for the 'across = +1' vertex, unit mitre
    expect(at(0, 3)).toBeCloseTo(0, 5);
    expect(at(0, 4)).toBeCloseTo(1, 5);
    expect(at(0, 5)).toBe(1);
    expect(at(1, 5)).toBe(-1);
    expect(at(0, 6)).toBe(3); // half of 6 m
    expect(at(10, 7)).toBeCloseTo(100, 4); // along
    expect(at(2, 8)).toBe(24);
    expect(at(2, 9)).toBe(roadStyleIndex('local'));
    // triangle indices stay in range
    for (const i of m.index) expect(i).toBeLessThan(m.vertexCount);
  });

  it('clamps the mitre at a hairpin instead of spiking', () => {
    const rb = new RibbonBuilder();
    rb.addLine([0, 0, 40, 0, 0, 2], flat, { style: 0, widthM: 6, periodM: 0, maxStep: 100 });
    const m = rb.build();
    for (let v = 0; v < m.vertexCount; v++) {
      const l = Math.hypot(m.data[v * RIBBON_STRIDE + 3]!, m.data[v * RIBBON_STRIDE + 4]!);
      expect(l).toBeLessThanOrEqual(1 / 0.45 + 1e-3);
    }
  });

  it('closes rings and joins the seam with a proper mitre', () => {
    const rb = new RibbonBuilder();
    rb.addLine([0, 0, 100, 0, 100, 100, 0, 100], flat, { style: 10, widthM: 0, periodM: 0, closed: true, maxStep: 200 });
    const m = rb.build();
    expect(m.vertexCount).toBe(2 * 5); // 4 corners + the repeated first point
    // first and last vertex pairs sit at the same corner with the same offset
    const g = (v: number, o: number): number => m.data[v * RIBBON_STRIDE + o]!;
    expect(g(0, 3)).toBeCloseTo(g(8, 3), 5);
    expect(g(0, 4)).toBeCloseTo(g(8, 4), 5);
    expect(Math.hypot(g(0, 3), g(0, 4))).toBeCloseTo(Math.SQRT2, 3);
  });

  it('uses 32-bit indices only when needed', () => {
    const rb = new RibbonBuilder();
    rb.addLine([0, 0, 100, 0], flat, { style: 0, widthM: 6, periodM: 0 });
    expect(rb.build().index).toBeInstanceOf(Uint16Array);
    const big = new RibbonBuilder();
    const xy: number[] = [];
    for (let i = 0; i < 40000; i++) xy.push(i * 10, (i % 2) * 5);
    big.addLine(xy, flat, { style: 0, widthM: 6, periodM: 0 });
    expect(big.build().index).toBeInstanceOf(Uint32Array);
  });
});

describe('road styles', () => {
  it('has a style for every ribbon kind and the widths of the brief', () => {
    expect(STYLES).toHaveLength(STYLE_COUNT);
    expect(ROAD_WIDTH_M).toMatchObject({ motorway: 14, primary: 14, arterial: 12, subarterial: 10, distributor: 8, local: 6, service: 4, track: 4, path: 2 });
    // never thinner than ~2 px: every road fill is at least 1.5 px, main roads and fire trails more
    for (let i = 0; i <= FIRE_TRAIL_STYLE; i++) expect(STYLES[i]!.minFillPx).toBeGreaterThanOrEqual(1.5);
    expect(STYLES[FIRE_TRAIL_STYLE]!.minFillPx).toBeGreaterThan(STYLES[roadStyleIndex('local')]!.minFillPx);
    expect(STYLES[FIRE_TRAIL_STYLE]!.casing.toLowerCase()).toBe('#ffffff'); // white halo
  });
  it('dashes unsealed roads and tracks, keeps sealed roads solid, dots paths', () => {
    expect(roadDash('local', 1).periodM).toBe(0);
    expect(roadDash('local', 0).periodM).toBe(0);
    expect(roadDash('local', 2).periodM).toBeGreaterThan(0);
    expect(roadDash('local', 3).periodM).toBeGreaterThan(roadDash('local', 2).periodM);
    expect(roadDash('track', 2).periodM).toBeGreaterThan(0);
    expect(roadDash('track', 0).periodM).toBeGreaterThan(0);
    expect(roadDash('path', 0).periodM).toBeGreaterThan(0);
    expect(roadDash('primary', 1).periodM).toBe(0);
  });
});

describe('sameOrigin', () => {
  it('accepts origins within a few metres and rejects other sites', () => {
    expect(sameOrigin({ lat: -33.715, lon: 150.285 }, { lat: -33.715, lon: 150.285 })).toBe(true);
    expect(sameOrigin({ lat: -33.715, lon: 150.285 }, { lat: -33.71501, lon: 150.28501 })).toBe(true);
    expect(sameOrigin({ lat: -33.715, lon: 150.285 }, { lat: -33.72, lon: 150.285 })).toBe(false);
    expect(sameOrigin({ lat: -33.715, lon: 150.285 }, { lat: -36.5, lon: 148.3 })).toBe(false);
  });
});

describe('houses and homes', () => {
  it('builds a closed-looking gabled box with unit normals', () => {
    const g = houseGeometry();
    expect(g.position.length / 3).toBe(30);
    expect(g.index.length / 3).toBe(14);
    for (let i = 0; i < g.normal.length; i += 3) expect(Math.hypot(g.normal[i]!, g.normal[i + 1]!, g.normal[i + 2]!)).toBeCloseTo(1, 5);
    let maxY = -Infinity;
    for (let i = 1; i < g.position.length; i += 3) maxY = Math.max(maxY, g.position[i]!);
    expect(maxY).toBeGreaterThan(4);
    expect(maxY).toBeLessThan(6);
    expect(new Set(g.part)).toEqual(new Set([0, 1]));
  });
  it('keeps only addresses inside the bounds, on the ground, with a deterministic random number', () => {
    const homes = Float32Array.from([10, 10, 5000, 5000, -20, 30]);
    const a = homeInstances(homes, { xMin: -100, xMax: 100, yMin: -100, yMax: 100 }, (x, y) => x + y);
    expect(a.n).toBe(2);
    expect(a.data[2]).toBe(20);
    expect(a.data[3]).toBeGreaterThanOrEqual(0);
    expect(a.data[3]).toBeLessThan(1);
    const b = homeInstances(homes, { xMin: -100, xMax: 100, yMin: -100, yMax: 100 }, (x, y) => x + y);
    expect(Array.from(b.data.slice(0, 8))).toEqual(Array.from(a.data.slice(0, 8)));
  });
});

function road(name: string | undefined, cls: RoadLine['cls'], xy: number[]): RoadLine {
  const f = Float32Array.from(xy);
  let len = 0;
  for (let i = 2; i < xy.length; i += 2) len += Math.hypot(xy[i]! - xy[i - 2]!, xy[i + 1]! - xy[i - 1]!);
  return { cls, surface: 1, name, xy: f, lengthM: len };
}

describe('label candidates and selection', () => {
  const bounds = { xMin: -4500, xMax: 4500, yMin: -4500, yMax: 4500 };
  it('places names, anchors main road names along the road and ignores the rest', () => {
    const ctx: ContextLayers = {
      ...EMPTY_CONTEXT(origin),
      places: [
        { name: 'Katoomba', kind: 'town', x: 0, y: 0 },
        { name: 'Katoomba', kind: 'suburb', x: 100, y: 50 }, // duplicate within 600 m: dropped
        { name: 'Faraway', kind: 'town', x: 20000, y: 0 }, // outside the domain
      ],
      roads: [
        road('Great Western Highway', 'primary', [-3000, 0, 3000, 0]),
        road('Some Lane', 'local', [0, 0, 100, 0]), // local roads are not labelled
        road(undefined, 'primary', [0, 100, 500, 100]), // unnamed
        road('Short Street', 'subarterial', [0, 200, 100, 200]),
      ],
    };
    const c = buildLabelCandidates(ctx, bounds, 900);
    const places = c.filter((l) => !l.group.startsWith('r:'));
    expect(places.map((p) => p.text)).toEqual(['Katoomba']);
    expect(places[0]!.kind).toBe('town');
    const gwh = c.filter((l) => l.text === 'Great Western Highway');
    expect(gwh.length).toBeGreaterThanOrEqual(6); // 6 km at 900 m spacing
    for (let i = 1; i < gwh.length; i++) expect(Math.abs(gwh[i]!.x - gwh[i - 1]!.x)).toBeCloseTo(900, 3);
    expect(gwh.every((l) => l.kind === 'road-primary')).toBe(true);
    // a short named road still gets one label (its longest piece)
    expect(c.filter((l) => l.text === 'Short Street')).toHaveLength(1);
    expect(c.some((l) => l.text === 'Some Lane')).toBe(false);
  });

  it('selects by priority without overlaps and keeps same-name labels apart', () => {
    const items: ScreenItem[] = [
      { x: 100, y: 100, w: 80, h: 16, priority: 50, group: 1 }, // 0
      { x: 130, y: 104, w: 80, h: 16, priority: 90, group: 2 }, // 1: overlaps 0, wins
      { x: 400, y: 100, w: 80, h: 16, priority: 60, group: 3 }, // 2
      { x: 480, y: 300, w: 80, h: 16, priority: 55, group: 3 }, // 3: same group as 2 and closer than the gap
      { x: 900, y: 300, w: 80, h: 16, priority: 54, group: 3 }, // 4: same group, far enough
      { x: 100, y: 500, w: 80, h: 16, priority: 10, group: 4 }, // 5
    ];
    const sel = selectLabels(items, 30, 4, 280);
    expect(sel).toEqual([1, 2, 4, 5]);
    // never more than max
    expect(selectLabels(items, 2, 4, 280)).toEqual([1, 2]);
    // no two selected boxes overlap
    for (const a of sel) {
      for (const b of sel) {
        if (a >= b) continue;
        const A = items[a]!;
        const B = items[b]!;
        expect(Math.abs(A.x - B.x) >= (A.w + B.w) / 2 || Math.abs(A.y - B.y) >= (A.h + B.h) / 2).toBe(true);
      }
    }
  });

  it('never selects more than 30 labels from a crowd', () => {
    const items: ScreenItem[] = [];
    for (let i = 0; i < 400; i++) items.push({ x: (i % 20) * 90, y: Math.floor(i / 20) * 40, w: 70, h: 16, priority: i % 7, group: i });
    const sel = selectLabels(items);
    expect(sel.length).toBe(30);
  });

  it('hides labels behind a ridge', () => {
    const ridge = (x: number): number => (Math.abs(x - 500) < 100 ? 400 : 100);
    const h = (x: number, _y: number): number => ridge(x);
    expect(lineOfSightClear(h, 1, [0, 0, 150], [1000, 0, 150])).toBe(false);
    expect(lineOfSightClear(h, 1, [0, 0, 1000], [1000, 0, 150])).toBe(true);
    // exaggeration makes the ridge taller
    expect(lineOfSightClear(h, 3, [0, 0, 1000], [1000, 0, 150 * 3])).toBe(false);
  });
});

describe('zone raster', () => {
  const square = (x0: number, y0: number, s: number): Float32Array => Float32Array.from([x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s]);
  const zone = (kind: ZonePolygon['kind'], rings: Float32Array[]): ZonePolygon => ({ code: 'R2', kind, name: 'x', rings });

  it('frames the zones with padding and a minimum size', () => {
    const f = zoneFrame([zone('residential', [square(-200, -100, 400)])], { xMin: -4500, xMax: 4500, yMin: -4500, yMax: 4500 })!;
    expect(f.size).toBeGreaterThanOrEqual(1500);
    expect(f.x0).toBeLessThan(-200);
    expect(f.x0 + f.size).toBeGreaterThan(200);
    expect(zoneFrame([], { xMin: 0, xMax: 1, yMin: 0, yMax: 1 })).toBeNull();
  });

  it('fills a square with exact area coverage and leaves the outside transparent', () => {
    const n = 64;
    const frame = { x0: 0, y0: 0, size: 640 }; // 10 m texels
    const px = rasterizeZones([zone('residential', [square(25, 25, 300)])], frame, n);
    const at = (i: number, j: number): number => px[(j * n + i) * 4 + 3]!;
    expect(at(10, 10)).toBeGreaterThan(80); // inside: opacity 0.36 -> ~92
    expect(at(0, 0)).toBe(0);
    expect(at(50, 50)).toBe(0);
    // Edge texel 2 covers x 20–30 m, only 25–30 m inside: half the opacity.
    expect(at(2, 10)).toBeGreaterThan(at(10, 10) * 0.4);
    expect(at(2, 10)).toBeLessThan(at(10, 10) * 0.6);
    // Premultiplied: colour never exceeds alpha
    for (let k = 0; k < px.length; k += 4) expect(px[k]!).toBeLessThanOrEqual(px[k + 3]! + 1);
  });

  it('cuts holes (even-odd) and puts row 0 at the south edge', () => {
    const n = 64;
    const frame = { x0: 0, y0: 0, size: 640 };
    const px = rasterizeZones([zone('commercial', [square(20, 20, 500), square(200, 200, 100)])], frame, n);
    const a = (i: number, j: number): number => px[(j * n + i) * 4 + 3]!;
    expect(a(5, 5)).toBeGreaterThan(90);
    expect(a(25, 25)).toBe(0); // inside the hole
    // a zone in the south-west corner only lights up low row numbers
    const sw = rasterizeZones([zone('residential', [square(10, 10, 100)])], frame, n);
    expect(sw[(3 * n + 3) * 4 + 3]!).toBeGreaterThan(0);
    expect(sw[(60 * n + 3) * 4 + 3]!).toBe(0);
  });

  it('is fast for a Katoomba-sized set', () => {
    const zs: ZonePolygon[] = [];
    for (let i = 0; i < 110; i++) {
      const pts: number[] = [];
      const cx = (i % 11) * 600 - 3000;
      const cy = Math.floor(i / 11) * 600 - 3000;
      for (let k = 0; k < 60; k++) {
        const a = (k / 60) * Math.PI * 2;
        const r = 220 + 60 * Math.sin(k * 3);
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      zs.push(zone('residential', [Float32Array.from(pts)]));
    }
    const t0 = performance.now();
    rasterizeZones(zs, { x0: -3500, y0: -3500, size: 7000 }, 1024);
    expect(performance.now() - t0).toBeLessThan(800);
  });
});
