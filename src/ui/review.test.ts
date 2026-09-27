/**
 * Tests for behaviour fixed in review: marker pushes only on change, no double-drawn spot fires, de-duplicated
 * insights after a rewind, NSW-time date inputs, the camera-independent wind glyph, the replay memory budget and
 * the "Why here?" factor notes, the fuel-brush display copy, "Show me" layers and worker-initiated rewinds.
 */
import { describe, expect, it } from 'vitest';
import { FuelType, type CellExplanation, type FuelEdit, type FuelMap, type Ignition, type Insight, type ScenarioData, type ScenarioEdit, type SimSnapshot, type SpotFire } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents } from '../sim/protocol';
import { windScreenRotation, type Pt } from './brushGeometry';
import { fromZonedInput, toZonedInput } from './format';
import { fuelWithEdits } from './fuelDisplay';
import { showMePatch } from './showMe';
import { defaultSnapshotBudget, insightSignature, SimSession } from './session';
import { Emitter } from './store';
import { factorRows } from './screens/sim/whyPanel';

class FakeController implements SimController {
  private readonly ev = new Emitter<SimEvents>();
  readonly calls: string[] = [];
  async init(): Promise<Insight[]> {
    return [];
  }
  run(): void {
    this.calls.push('run');
  }
  pause(): void {
    this.calls.push('pause');
  }
  ignite(_i: Ignition): void {
    this.calls.push('ignite');
  }
  edit(_e: ScenarioEdit, _t: number): void {
    this.calls.push('edit');
  }
  removeEdit(): void {}
  rewind(): void {
    this.calls.push('rewind');
  }
  setOption(): void {}
  setQuality(): void {}
  async explain(): Promise<CellExplanation> {
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  emit<K extends keyof SimEvents>(e: K, ...a: Parameters<SimEvents[K]>): void {
    this.ev.emit(e, ...a);
  }
  dispose(): void {}
}

/** A SceneViewApi that records marker calls. */
function recordingView(): { view: SceneViewApi; calls: { insights: Insight[][]; ignitions: [Ignition[], SpotFire[]][] } } {
  const calls = { insights: [] as Insight[][], ignitions: [] as [Ignition[], SpotFire[]][] };
  const view = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'setInsights') return (i: Insight[]) => calls.insights.push(i);
        if (key === 'setIgnitions') return (i: Ignition[], s: SpotFire[]) => calls.ignitions.push([i, s]);
        return () => null;
      },
    },
  ) as unknown as SceneViewApi;
  return { view, calls };
}

const scenario = (): ScenarioData =>
  ({ id: 's', name: 's', origin: { lat: 0, lon: 0 }, extent: 3000, startTime: 0, duration: 7200, ignitions: [], edits: [], options: { snapshotInterval: 300, coupling: 1, embers: true, mountainPhenomena: true } }) as unknown as ScenarioData;

const spot: SpotFire = { id: 1, x: 100, y: 200, time: 300, distance: 400, travel: 450 };
const snap = (time: number, insights: Insight[] = [], spotFires: SpotFire[] = []): SimSnapshot => ({ time, insights, spotFires, stats: { time } }) as unknown as SimSnapshot;
const card = (id: string, time: number, x = 0): Insight => ({ id, kind: 'spotting', severity: 'watch', time, x, y: 0, title: id, body: '', factors: [] });

describe('SimSession → SceneView markers', () => {
  it('pushes insights and ignitions only when the visible set changes', async () => {
    const c = new FakeController();
    const { view, calls } = recordingView();
    const s = new SimSession(scenario(), c, view, { maxBytes: 1e9 });
    await s.start();
    for (let t = 0; t <= 1800; t += 300) c.emit('snapshot', snap(t, t === 600 ? [card('a', 500)] : []));
    const nIns = calls.insights.length;
    const nIgn = calls.ignitions.length;
    // Seeking around without crossing an insight time re-uses what the view already has.
    s.seek(100);
    s.seek(200);
    s.seek(300);
    expect(calls.insights.length).toBe(nIns);
    expect(calls.ignitions.length).toBe(nIgn);
    s.seek(900); // crosses card 'a'
    expect(calls.insights.length).toBe(nIns + 1);
    expect(calls.insights.at(-1)!.map((i) => i.id)).toEqual(['a']);
    s.ignite({ id: 'f', kind: 'point', points: [[0, 0]], origin: 'observed' });
    expect(calls.ignitions.at(-1)![0].map((i) => i.id)).toEqual(['f']);
    s.dispose();
  });

  it('does not pass simulated spot fires as user-marked spots (the view draws them from the snapshot)', async () => {
    const c = new FakeController();
    const { view, calls } = recordingView();
    const s = new SimSession(scenario(), c, view, { maxBytes: 1e9 });
    await s.start();
    c.emit('snapshot', snap(0));
    c.emit('snapshot', snap(300, [], [spot]));
    s.seek(300);
    expect(calls.ignitions.every(([, spots]) => spots.length === 0)).toBe(true);
    s.dispose();
  });

  it('drops insights the worker re-reports after a rewind, even with new ids', async () => {
    const c = new FakeController();
    const { view } = recordingView();
    const s = new SimSession(scenario(), c, view, { maxBytes: 1e9 });
    await s.start();
    for (let t = 0; t <= 1800; t += 300) c.emit('snapshot', snap(t, t === 600 ? [card('a', 500)] : t === 1500 ? [card('b', 1400, 900)] : []));
    s.seek(1200);
    s.ignite({ id: 'f', kind: 'point', points: [[0, 0]], origin: 'observed' }); // rewinds to 1200: 'b' is dropped
    expect(s.state.get().insights.map((i) => i.id)).toEqual(['a']);
    // The worker restarts from its 300 s checkpoint and regenerates 'a' under a new id.
    c.emit('snapshot', snap(600, [card('a-2', 500)]));
    expect(s.state.get().insights.map((i) => i.id)).toEqual(['a']);
    c.emit('snapshot', snap(900, [card('c', 850, 2000)]));
    expect(s.state.get().insights.map((i) => i.id)).toEqual(['a', 'c']);
    expect(insightSignature(card('x', 500))).toBe(insightSignature(card('y', 505, 20)));
    s.dispose();
  });
});

describe('NSW-time date inputs', () => {
  it('round-trips wall-clock times in Australia/Sydney across daylight saving', () => {
    // 14:30 AEDT on 10 Jan 2026 = 03:30 UTC; 14:30 AEST on 10 Jul 2026 = 04:30 UTC.
    expect(toZonedInput(Date.UTC(2026, 0, 10, 3, 30))).toBe('2026-01-10T14:30');
    expect(toZonedInput(Date.UTC(2026, 6, 10, 4, 30))).toBe('2026-07-10T14:30');
    expect(fromZonedInput('2026-01-10T14:30')).toBe(Date.UTC(2026, 0, 10, 3, 30));
    expect(fromZonedInput('2026-07-10T14:30')).toBe(Date.UTC(2026, 6, 10, 4, 30));
    const t = Date.UTC(2026, 9, 4, 23, 10); // just after the October change
    expect(fromZonedInput(toZonedInput(t))).toBe(t);
    expect(Number.isNaN(fromZonedInput(''))).toBe(true);
  });
});

describe('local wind glyph', () => {
  const at: Pt = [0, 0];
  const northUp = (p: Pt): [number, number] => [200 + p[0] / 10, 300 - p[1] / 10];
  it('points downwind on a north-up map', () => {
    expect(windScreenRotation(at, 0, northUp(at), northUp)).toBeCloseTo(0); // northerly blows down the screen
    expect(windScreenRotation(at, 90, northUp(at), northUp)).toBeCloseTo(90); // easterly blows to the left
    expect(Math.abs(windScreenRotation(at, 225, northUp(at), northUp))).toBeCloseTo(135); // south-westerly: up-right
  });
  it('follows the camera heading', () => {
    // Camera looking west: west is up the screen, north is to the right.
    const facingWest = (p: Pt): [number, number] => [200 + p[1] / 10, 300 + p[0] / 10];
    // A westerly blows east, i.e. down the screen, which is what an unrotated glyph shows.
    expect(windScreenRotation(at, 270, facingWest(at), facingWest)).toBeCloseTo(0);
    // Off-screen downwind point → north-up estimate.
    expect(windScreenRotation(at, 270, [0, 0], () => null)).toBe(270);
  });
});

describe('replay memory budget', () => {
  it('stays within 48–160 MB', () => {
    const MB = 1024 * 1024;
    expect(defaultSnapshotBudget(0.5)).toBe(48 * MB);
    expect(defaultSnapshotBudget(2) / MB).toBeCloseTo(122.9, 0);
    expect(defaultSnapshotBudget(8)).toBe(160 * MB);
  });
});

describe('Why here? factor notes', () => {
  const base = { windDir10: 315, windSpeed10: 10, deadFuelMoisture: 6, factors: { base: 0.01, wind: 3, slope: 1, moisture: 1, fuel: 1, terrain: 1 } };
  it('describes flat ground and cross-slope spread without claiming uphill', () => {
    expect(factorRows({ ...base, slopeDeg: 0.5 } as unknown as CellExplanation)[1]!.note).toBe('flat');
    expect(factorRows({ ...base, slopeDeg: 12 } as unknown as CellExplanation)[1]!.note).toBe('12° across the slope');
    expect(factorRows({ ...base, slopeDeg: 12, factors: { ...base.factors, slope: 2 } } as unknown as CellExplanation)[1]!.note).toBe('12° uphill');
  });
});

describe('fuel-brush display copy', () => {
  const grid = { nx: 10, ny: 10, cellSize: 10, x0: -45, y0: -45, origin: { lat: -33.7, lon: 150.3 } };
  const n = 100;
  const fill = (v: number): Float32Array => new Float32Array(n).fill(v);
  const base = (): FuelMap => ({
    grid,
    type: new Uint8Array(n).fill(FuelType.DryForestShrubby),
    surfaceHazard: fill(2),
    nearSurfaceHazard: fill(2),
    nearSurfaceHeight: fill(0.3),
    elevatedHazard: fill(2),
    elevatedHeight: fill(1.5),
    barkHazard: fill(1),
    surfaceLoad: fill(10),
    nearSurfaceLoad: fill(3),
    elevatedLoad: fill(4),
    barkLoad: fill(1),
    canopyHeight: fill(20),
    canopyCover: fill(0.5),
    curing: fill(0),
    timeSinceFire: fill(12),
    lastFireKind: new Uint8Array(n),
    sources: ['test'],
  });

  it('applies a circle to the cells whose centres are inside it (j = 0 is the south row)', () => {
    const f = base();
    const circle: FuelEdit = { kind: 'fuel', id: 'c', shape: { kind: 'circle', x: -45, y: -45, radius: 12 }, surfaceHazardDelta: 1 };
    const out = fuelWithEdits(f, [circle])!;
    // (−45,−45) is cell (0,0) in the south-west corner; neighbours at 10 m are inside, the diagonal (14 m) is not.
    const changed = [...out.surfaceHazard.keys()].filter((k) => out.surfaceHazard[k] !== 2);
    expect(changed).toEqual([0, 1, 10]);
    expect(out.surfaceHazard[0]).toBe(3);
    expect(out.surfaceLoad[0]).toBeCloseTo(15); // load scales with the score
    expect(f.surfaceHazard[0]).toBe(2); // the base map is untouched
  });

  it('clears fuel on a painted road and marks hazard reduction as recently burnt', () => {
    const road: FuelEdit = { kind: 'fuel', id: 'r', shape: { kind: 'polygon', points: [[-50, -6], [50, -6], [50, 6], [-50, 6]] }, setType: FuelType.NonFuel };
    const hr: FuelEdit = { kind: 'fuel', id: 'h', shape: { kind: 'circle', x: 35, y: 35, radius: 1 }, setTimeSinceFire: 1, surfaceHazardDelta: -3 };
    const out = fuelWithEdits(base(), [road, hr])!;
    const row = (j: number): number[] => [...out.type.slice(j * 10, j * 10 + 10)];
    expect(row(4)).toEqual(new Array(10).fill(FuelType.NonFuel)); // y = −5
    expect(row(5)).toEqual(new Array(10).fill(FuelType.NonFuel)); // y = +5
    expect(row(6)).toEqual(new Array(10).fill(FuelType.DryForestShrubby));
    expect(out.canopyCover[45]).toBe(0);
    const k = 8 * 10 + 8; // (35, 35)
    expect(out.timeSinceFire[k]).toBe(1);
    expect(out.surfaceHazard[k]).toBe(0);
    expect(out.surfaceLoad[k]).toBe(0);
  });

  it('returns the base when there are no fuel edits, and null for detached arrays', () => {
    const f = base();
    expect(fuelWithEdits(f, [{ kind: 'wind', id: 'w', x: 0, y: 0, radius: 100, speed: 5, dir: 90, time: 0 }])).toBe(f);
    expect(fuelWithEdits({ ...f, type: new Uint8Array(0) }, [])).toBeNull();
  });
});

describe('"Show me" layers', () => {
  const base = { kind: 'spotting' as const, x: 100, y: 200 };
  it('maps engine layer ids to the display (first overlay wins; plume adds a cross-section along the wind)', () => {
    expect(showMePatch({ ...base, showLayers: ['slope', 'spread'] }, 90)).toEqual({ overlay: 'slope' });
    expect(showMePatch({ ...base, showLayers: ['embers'] }, 90)).toEqual({ overlay: 'landing', embers: true });
    expect(showMePatch({ ...base, showLayers: ['wind', 'dmz'] }, 90)).toEqual({ wind: 'surface', overlay: 'dmz' });
    expect(showMePatch({ ...base, showLayers: ['plume'] }, 135)).toEqual({ wind: 'volume', crossSection: { enabled: true, azimuth: 135, centre: [100, 200] } });
  });
  it('falls back to a per-kind default without showLayers', () => {
    expect(showMePatch({ ...base, kind: 'upslope-run' }, 0)).toEqual({ overlay: 'slope' });
    expect(showMePatch({ ...base, kind: 'general' }, 0)).toEqual({});
  });
});

describe('worker-initiated rewind and detector keys', () => {
  class RewindingController extends FakeController {
    rewindTo(t: number): void {
      this.emit('rewound', t);
    }
  }
  it('drops results after the view time on "rewound", keeps what is on screen', async () => {
    const c = new RewindingController();
    const { view } = recordingView();
    const s = new SimSession(scenario(), c, view, { maxBytes: 1e9 });
    await s.start();
    for (let t = 0; t <= 1800; t += 300) c.emit('snapshot', snap(t, [card(`c${t}`, t - 10, t * 10)]));
    s.seek(900);
    c.rewindTo(300);
    expect(s.snapshots.range()!.end).toBe(900);
    expect(s.state.get().headTime).toBe(900);
    expect(s.state.get().insights.map((i) => i.id)).toEqual(['c0', 'c300', 'c600', 'c900']);
    s.dispose();
  });
  it('treats a re-report of the same detector key within 30 min as the same card, unless it escalates', async () => {
    const c = new FakeController();
    const { view } = recordingView();
    const s = new SimSession(scenario(), c, view, { maxBytes: 1e9 });
    await s.start();
    const keyed = (id: string, time: number, severity: Insight['severity'] = 'watch'): Insight => ({ ...card(id, time, time * 7), key: 'spotting:3:4', severity });
    c.emit('snapshot', snap(300, [keyed('k1', 290)]));
    c.emit('snapshot', snap(600, [keyed('k2', 590)]));
    expect(s.state.get().insights.map((i) => i.id)).toEqual(['k1']);
    c.emit('snapshot', snap(900, [keyed('k3', 890, 'danger')]));
    c.emit('snapshot', snap(2700, [keyed('k4', 2690)]));
    expect(s.state.get().insights.map((i) => i.id)).toEqual(['k1', 'k3', 'k4']);
    s.dispose();
  });
});
