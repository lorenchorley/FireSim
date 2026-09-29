import { describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';
import { FuelType, Landform, SpreadDriver } from '../core/types';
import { makeGridSpec } from '../core/grid';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents } from '../sim/protocol';
import { OVERLAY_OPTIONS, legendFor, rampGradient } from './legends';
import { buildRequest, beltRh, defaultSetup, detailHint, persistable, restoreSetup, validateSetup } from './setupModel';
import { MAX_REPLAY_SPEED, SimSession, advanceClock, baselineAt, runTarget } from './session';
import { FUEL_PRESETS, fuelEditFor } from './fuelPresets';
import { imageryCrop } from './imagery';
import { barGeometry, factorRows } from './screens/sim/whyPanel';
import { tzOffsetHours, zonedDate, zonedTime } from './format';
import { DEFAULT_SETTINGS, performanceProfile, resolveTheme } from './settings';
import { Emitter } from './store';
import { detectWindChanges } from './weatherCalc';

const NOW = Date.UTC(2026, 0, 10, 2, 0); // 13:00 AEDT

describe('setup model', () => {
  it('defaults to a buildable Katoomba preset scenario', () => {
    const s = defaultSetup(NOW);
    expect(validateSetup(s, NOW)).toEqual([]);
    const r = buildRequest(s, 'auto', NOW);
    expect(r.demoSiteId).toBe('katoomba');
    expect(r.extent).toBe(6000);
    expect(r.duration).toBe(6 * 3600);
    expect(r.options?.fireCellSize).toBe(30);
    expect(r.weather.kind).toBe('preset');
    // Presets start on their canonical day at their teaching hour (20 Dec 11:00 LMST for the NW-wind day, spec
    // §11.3), rounded to 10 min: 12:00 AEDT at Katoomba.
    if (r.weather.kind === 'preset') expect(r.weather.start).toBe(Date.UTC(2026, 11, 20, 1, 0));
  });

  it('maps detail to fire cell size, performance to the engine tier, and the step settings to the engine options', () => {
    const s = { ...defaultSetup(NOW), detail: 'detailed' as const, extentKm: 9 as const };
    const r = buildRequest(s, 'battery', NOW);
    expect(r.options?.fireCellSize).toBe(20);
    expect(r.options?.tier).toBe('fast');
    // A bare mode no longer ties the display step to the performance mode: the engine default (60 s) applies.
    expect(r.options?.snapshotInterval).toBeUndefined();
    const u = buildRequest(s, { performance: 'quality', timeStep: 10, solverStep: 2 }, NOW);
    expect(u.options).toMatchObject({ tier: 'high', snapshotInterval: 10, maxStepS: 2, fireCellSize: 20 });
    const d = buildRequest(s, { ...DEFAULT_SETTINGS }, NOW);
    expect(d.options).toMatchObject({ snapshotInterval: 60, maxStepS: 0, tier: 'auto' });
    expect(detailHint(9, 'detailed')).toMatch(/20 m cells · 203k cells/);
  });

  it('builds belt-kit and manual series with a wind change', () => {
    const belt = { ...defaultSetup(NOW), weather: 'belt' as const, belt: { dry: 30, wet: 20, windKmh: 25, windDir: 300, time: NOW, droughtFactor: 9 } };
    const rb = buildRequest(belt, 'auto', NOW);
    expect(rb.weather.kind).toBe('manual');
    if (rb.weather.kind === 'manual') {
      expect(rb.weather.series.kind).toBe('belt-kit');
      expect(rb.weather.series.hours[1]!.relativeHumidity).toBeCloseTo(beltRh(belt.belt, 950), 5);
      expect(rb.weather.series.droughtFactor).toBe(9);
    }
    const manual = { ...defaultSetup(NOW), weather: 'manual' as const };
    const rm = buildRequest(manual, 'auto', NOW);
    if (rm.weather.kind !== 'manual') throw new Error('expected manual');
    expect(detectWindChanges(rm.weather.series.hours)).toHaveLength(1);
  });

  it('validates coordinates, past times and belt readings', () => {
    const s = { ...defaultSetup(NOW), where: 'manual' as const, manualText: 'nonsense' };
    expect(validateSetup(s, NOW)[0]).toMatch(/coordinates/);
    const ok = { ...s, manualText: '-33.7, 150.3' };
    expect(validateSetup(ok, NOW)).toEqual([]);
    expect(buildRequest(ok, 'auto', NOW).demoSiteId).toBeUndefined();
    expect(validateSetup({ ...defaultSetup(NOW), where: 'gps' }, NOW)[0]).toMatch(/location/);
    expect(validateSetup({ ...defaultSetup(NOW), weather: 'past', pastTime: NOW + 3600_000 }, NOW)).toHaveLength(1);
    const bad = { ...defaultSetup(NOW), weather: 'belt' as const, belt: { ...defaultSetup(NOW).belt, dry: 20, wet: 25 } };
    expect(validateSetup(bad, NOW)[0]).toMatch(/wet bulb/i);
  });

  it('persists without the GPS fix and restores safely', () => {
    const s = { ...defaultSetup(NOW), gps: { position: { lat: -33.7, lon: 150.3 }, accuracy: 12 }, where: 'gps' as const, durationH: 9 };
    const p = persistable(s);
    expect('gps' in p).toBe(false);
    const r = restoreSetup(JSON.parse(JSON.stringify(p)), NOW);
    expect(r.durationH).toBe(9);
    expect(r.where).toBe('demo'); // a fix is needed again
    expect(restoreSetup({ demoSiteId: 'nowhere', extentKm: 7 } as never, NOW).demoSiteId).toBe('katoomba');
  });
});

describe('time zone helpers', () => {
  it('handles AEDT and AEST', () => {
    expect(tzOffsetHours(Date.UTC(2026, 0, 10, 2))).toBe(11);
    expect(tzOffsetHours(Date.UTC(2026, 6, 10, 2))).toBe(10);
    expect(zonedTime('2026-01-10', 11)).toBe(Date.UTC(2026, 0, 10, 0));
    expect(zonedTime('2026-07-10', 11)).toBe(Date.UTC(2026, 6, 10, 1));
    expect(zonedDate(Date.UTC(2026, 0, 9, 14))).toBe('2026-01-10');
  });
});

describe('session clock helpers', () => {
  it('plans a bounded look-ahead', () => {
    expect(runTarget(0, 60, 21600, 300)).toBe(1800);
    expect(runTarget(0, 600, 21600, 300)).toBe(18000);
    expect(runTarget(20000, 600, 21600, 300)).toBe(21600);
    expect(runTarget(100, Infinity, 21600, 300)).toBe(21600);
    // Any speed: a slow one still looks half an hour ahead; a display step of 10 s does not shrink the look-ahead.
    expect(runTarget(0, 0.5, 21600, 10)).toBe(1800);
    expect(runTarget(0, 45, 21600, 10)).toBe(1800);
    expect(runTarget(0, 3600, 21600, 10)).toBe(21600);
  });

  it('advances at the playback speed, waits for the worker and never goes back', () => {
    expect(advanceClock(0, 3600, 60, 0.5, 21600)).toBe(30);
    expect(advanceClock(3590, 3600, 60, 1, 21600)).toBe(3600);
    expect(advanceClock(3700, 3600, 60, 1, 21600)).toBe(3700);
    // As fast as possible: follows the newest result; replays history very fast (not instantly) after a jump back.
    expect(advanceClock(5000, 5000, Infinity, 0.016, 21600)).toBe(5000);
    expect(advanceClock(4990, 5000, Infinity, 0.016, 21600)).toBe(5000);
    expect(advanceClock(100, 5000, Infinity, 0.016, 21600)).toBeCloseTo(100 + MAX_REPLAY_SPEED * 0.016, 6);
    // Any positive speed works.
    expect(advanceClock(0, 3600, 0.5, 1, 21600)).toBe(0.5);
    expect(advanceClock(0, 90000, 3600, 0.25, 21600)).toBe(900);
  });

  it('interpolates the what-if baseline', () => {
    const c = {
      label: 'x',
      since: 0,
      baseline: [
        { time: 300, burntAreaHa: 10, perimeterKm: 1, maxIntensity: 100, spotFires: 0 },
        { time: 900, burntAreaHa: 30, perimeterKm: 3, maxIntensity: 300, spotFires: 1 },
      ],
    };
    expect(baselineAt(c, 600)!.burntAreaHa).toBeCloseTo(20);
    expect(baselineAt(c, 100)).toBeNull();
    expect(baselineAt(c, 2000)).toBeNull();
  });
});

// ───────────────────────────── SimSession with fakes ─────────────────────────────

class FakeController implements SimController {
  readonly calls: { name: string; args: unknown[] }[] = [];
  private readonly ev = new Emitter<SimEvents>();
  async init(): Promise<Insight[]> {
    this.calls.push({ name: 'init', args: [] });
    return [];
  }
  run(until: number): void {
    this.calls.push({ name: 'run', args: [until] });
  }
  pause(): void {
    this.calls.push({ name: 'pause', args: [] });
  }
  ignite(i: Ignition): void {
    this.calls.push({ name: 'ignite', args: [i] });
  }
  edit(e: ScenarioEdit, t: number): void {
    this.calls.push({ name: 'edit', args: [e, t] });
  }
  removeIgnition(id: string): void {
    this.calls.push({ name: 'removeIgnition', args: [id] });
  }
  removeEdit(id: string): void {
    this.calls.push({ name: 'removeEdit', args: [id] });
  }
  rewind(t: number): void {
    this.calls.push({ name: 'rewind', args: [t] });
  }
  setOption(k: string, v: number | boolean): void {
    this.calls.push({ name: 'setOption', args: [k, v] });
  }
  setQuality(tier: string): void {
    this.calls.push({ name: 'setQuality', args: [tier] });
  }
  async explain(x: number, y: number, time?: number): Promise<CellExplanation> {
    this.calls.push({ name: 'explain', args: [x, y, time] });
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

const nullView = new Proxy({}, { get: () => () => null }) as unknown as SceneViewApi;

function fakeScenario(): ScenarioData {
  return { id: 's', name: 's', origin: { lat: 0, lon: 0 }, extent: 3000, startTime: 0, duration: 7200, ignitions: [], edits: [], options: { snapshotInterval: 300, coupling: 1, embers: true, mountainPhenomena: true } } as unknown as ScenarioData;
}

function snap(time: number, insights: Insight[] = []): SimSnapshot {
  return { time, insights, spotFires: [], stats: { time } } as unknown as SimSnapshot;
}

const insight = (id: string, time: number, severity: Insight['severity'] = 'danger'): Insight => ({ id, kind: 'general', severity, time, x: 0, y: 0, title: id, body: '', factors: [] });

describe('SimSession', () => {
  it('stores snapshots, reveals insights as the clock passes them, and rewinds before past edits', async () => {
    const c = new FakeController();
    const s = new SimSession(fakeScenario(), c, nullView, { maxBytes: 1e9 });
    await s.start();
    const revealed: string[] = [];
    s.events.on('reveal', (i) => revealed.push(i.id));
    for (let t = 0; t <= 1800; t += 300) c.emit('snapshot', snap(t, t === 900 ? [insight('a', 800)] : []));
    expect(s.state.get().headTime).toBe(1800);
    expect(s.state.get().viewTime).toBe(0);
    expect(s.visibleInsights().map((i) => i.id)).toEqual([]); // not yet revealed at t = 0
    s.seek(1200);
    expect(s.state.get().snapshot?.time).toBe(1200);
    expect(revealed).toEqual(['a']);
    expect(s.isLive()).toBe(false);
    expect(s.state.get().reviewing).toBe(true);

    // Ignite while viewing the past → rewind to the view time, drop later results.
    const ign = s.ignite({ id: 'f', kind: 'point', points: [[0, 0]], origin: 'observed' });
    expect(ign.time).toBe(1200);
    const names = c.calls.map((x) => x.name);
    expect(names.slice(-2)).toEqual(['rewind', 'ignite']);
    expect(c.calls.at(-2)!.args[0]).toBe(1200);
    expect(s.snapshots.range()!.end).toBe(1200);
    expect(s.state.get().headTime).toBe(1200);
    expect(s.isLive()).toBe(true); // the edit made the view time the present

    // Wind edits apply from the view time; explain passes the view time.
    s.edit({ kind: 'wind', id: 'w', x: 0, y: 0, radius: 500, speed: 5, dir: 90, time: 0 });
    expect((c.calls.at(-1)!.args[0] as { time: number }).time).toBe(1200);
    await s.explain(10, 20);
    expect(c.calls.at(-1)).toEqual({ name: 'explain', args: [10, 20, 1200] });
    s.dispose();
  });

  it('what-if re-run records a baseline and sets options', async () => {
    const c = new FakeController();
    const s = new SimSession(fakeScenario(), c, nullView, { maxBytes: 1e9 });
    await s.start();
    for (let t = 0; t <= 1800; t += 300) c.emit('snapshot', { ...snap(t), stats: { time: t, burntAreaHa: t / 100, perimeterKm: 1, maxIntensity: 1, spotFires: 0 } } as unknown as SimSnapshot);
    s.seek(600);
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= () => 0;
    s.rerunWith({ coupling: 0, embers: true, mountainPhenomena: true }, 'feedback off');
    expect(c.calls.filter((x) => x.name === 'setOption').map((x) => x.args)).toEqual([
      ['coupling', 0],
      ['embers', true],
      ['mountainPhenomena', true],
    ]);
    expect(s.state.get().compare!.baseline.map((b) => b.time)).toEqual([900, 1200, 1500, 1800]);
    expect(c.calls.some((x) => x.name === 'run')).toBe(true);
    s.dispose();
  });
});

describe('SimSession playback control', () => {
  it('a pause from a reveal listener (pause on danger) does not restart the worker', async () => {
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= () => 0;
    (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame ??= () => undefined;
    const c = new FakeController();
    const s = new SimSession(fakeScenario(), c, nullView, { maxBytes: 1e9 });
    await s.start();
    s.setSpeed(Infinity);
    s.events.on('reveal', (i) => {
      if (i.severity === 'danger') s.pause();
    });
    s.play();
    c.emit('snapshot', snap(300, [insight('d', 250)]));
    expect(s.state.get().playing).toBe(false);
    const names = c.calls.map((x) => x.name);
    expect(names.at(-1)).toBe('pause');
    s.dispose();
  });

  it('removing an ignition drops every result after its time and asks the worker to undo it', async () => {
    const c = new FakeController();
    const s = new SimSession(fakeScenario(), c, nullView, { maxBytes: 1e9 });
    await s.start();
    for (let t = 0; t <= 600; t += 300) c.emit('snapshot', snap(t));
    s.seek(600);
    const a = s.ignite({ id: 'a', kind: 'point', points: [[0, 0]], origin: 'observed' });
    for (let t = 900; t <= 1800; t += 300) c.emit('snapshot', snap(t, [insight(`i${t}`, t - 10, 'watch')]));
    s.seek(1800);
    s.removeIgnition(a.id);
    expect(c.calls.some((x) => x.name === 'removeIgnition' && x.args[0] === 'a')).toBe(true);
    expect(s.state.get().ignitions).toEqual([]);
    expect(s.snapshots.range()!.end).toBe(600);
    expect(s.state.get().insights).toEqual([]);
    expect(s.state.get().viewTime).toBe(1800);
    s.dispose();
  });
});

// ───────────────────────────── other pure pieces ─────────────────────────────

describe('fuel presets', () => {
  it('turn a tap into a circle edit and a stroke into one polygon', () => {
    const tap = fuelEditFor('nofuel', [[10, 20]], 50, 'e1');
    expect(tap.shape).toEqual({ kind: 'circle', x: 10, y: 20, radius: 50 });
    expect(tap.setType).toBe(FuelType.NonFuel);
    const stroke = fuelEditFor(
      'litter',
      [
        [0, 0],
        [200, 0],
      ],
      30,
      'e2',
    );
    expect(stroke.shape.kind).toBe('polygon');
    expect(stroke.surfaceHazardDelta).toBe(1);
    expect(new Set(FUEL_PRESETS.map((p) => p.id)).size).toBe(6);
  });
});

describe('imagery crop', () => {
  const meta = { cellSize: 8, n: 1125, centre: { lat: -33.715, lon: 150.285 }, extent: 9000 };
  it('crops the centre of the 9 km image for a 6 km domain', () => {
    const g = makeGridSpec(meta.centre, 6000, 30);
    const c = imageryCrop(meta, g)!;
    expect(c.sx).toBeCloseTo(1500 / 8, 1);
    expect(c.sy).toBeCloseTo(1500 / 8, 1);
    expect(c.sw).toBeCloseTo(6000 / 8, 1);
  });
  it('refuses domains outside the image', () => {
    const g = makeGridSpec({ lat: -33.6, lon: 150.285 }, 6000, 30);
    expect(imageryCrop(meta, g)).toBeNull();
  });
});

describe('legends and why-here helpers', () => {
  it('every overlay has a legend with colours', () => {
    for (const o of OVERLAY_OPTIONS) {
      const l = legendFor(o.id);
      if (o.id === 'none') expect(l).toBeNull();
      else {
        expect(l).not.toBeNull();
        const items = l!.kind === 'ramp' ? l!.stops : l!.classes;
        expect(items.length).toBeGreaterThan(2);
        for (const it of items) expect(it.colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(rampGradient([{ colour: '#000000', label: '' }, { colour: '#ffffff', label: '' }])).toBe('linear-gradient(to right, #000000 0.0%, #ffffff 100.0%)');
  });

  it('factor rows and log bars', () => {
    const e = {
      windSpeed10: 10,
      windDir10: 315,
      slopeDeg: 20,
      deadFuelMoisture: 5,
      factors: { base: 0.03, wind: 8, slope: 4, moisture: 1.3, fuel: 1, terrain: 1 },
      landform: Landform.MidSlope,
      driver: SpreadDriver.WindAndSlope,
    } as unknown as CellExplanation;
    const rows = factorRows(e);
    expect(rows.map((r) => r.label)).toEqual(['Wind', 'Slope', 'Litter moisture', 'Fuel', 'Terrain effects']);
    expect(rows[0]!.note).toBe('NW 36 km/h: 110 m/h → 860 m/h'); // what the ×8 does to the still-air rate
    expect(rows[1]!.note).toBe('20° uphill · doubles every 10°');
    expect(barGeometry(16)).toEqual({ left: 50, width: 50, up: true });
    expect(barGeometry(0.25)).toEqual({ left: 25, width: 25, up: false });
    expect(barGeometry(1).width).toBeCloseTo(0.8);
  });
});

describe('settings', () => {
  it('resolves the theme and performance profile', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(performanceProfile('battery').smoke).toBe(false);
    expect(performanceProfile('quality').maxEmbers).toBe(4000);
  });
});
