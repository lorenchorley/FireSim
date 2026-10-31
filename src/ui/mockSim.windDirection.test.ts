/**
 * Wind direction in the demo engine (contract D-CONTRACT-060-wind, sections 4 and 7.2 item 8): the mock has no
 * atmosphere, but the e2e runs with `?mock=1`, so a change must show in the weather and in the fire's head, a removal must
 * take it back and tell the UI ('rewound'), as the real engine does.
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioData, SimSnapshot, WindDirectionEdit } from '../core/types';
import { angleDiffDeg } from '../core/units';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { MockSimController, mockBuildScenario } from './mocks';

const turn = (id: string, dir: number, time: number): WindDirectionEdit => ({ kind: 'windDirection', id, dir, time });
const SOUTH = turn('w1', 180, 600);

function scenario(edits: WindDirectionEdit[] = []): ScenarioData {
  return { ...syntheticScenario({ windFromDeg: 270, windKmh: 36, slopeDeg: 0, extent: 3000, duration: 3600, ignitions: [pointIgnition('a', -600, 0, 0, 60)], options: { snapshotInterval: 60 } }), edits };
}

interface Rig {
  sim: MockSimController;
  snaps: Map<number, SimSnapshot>;
  rewound: number[];
  runTo: (t: number) => Promise<void>;
}

async function rig(sc: ScenarioData): Promise<Rig> {
  const sim = new MockSimController();
  const snaps = new Map<number, SimSnapshot>();
  const rewound: number[] = [];
  sim.on('snapshot', (s) => snaps.set(s.time, s));
  sim.on('rewound', (t) => rewound.push(t));
  let running = false;
  let at = 0;
  sim.on('status', (s) => {
    running = s.running;
    at = s.time;
  });
  await sim.init(sc);
  const runTo = async (t: number): Promise<void> => {
    sim.run(t);
    const t0 = Date.now();
    while ((running || at < t) && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 10));
    expect(at).toBe(t);
  };
  return { sim, snaps, rewound, runTo };
}

const dir = (r: Rig, t: number): number => r.snaps.get(t)!.stats.weather.windDir10;

describe('the demo engine and a Wind direction change', () => {
  it('a change given with the scenario shows in the weather from its time: turning, then held; the speed is the forecast\'s', async () => {
    const plain = await rig(scenario());
    await plain.runTo(1800);
    const r = await rig(scenario([SOUTH]));
    await r.runTo(1800);
    expect(dir(r, 600)).toBeCloseTo(270, 6);
    expect(dir(r, 1200)).toBeCloseTo(203.33, 1);
    expect(dir(r, 1800)).toBeCloseTo(180, 6);
    for (const t of [600, 1200, 1800]) {
      expect(r.snaps.get(t)!.stats.weather.windSpeed10, `speed t=${t}`).toBeCloseTo(plain.snaps.get(t)!.stats.weather.windSpeed10, 6);
      expect(dir(plain, t)).toBeCloseTo(270, 6);
    }
    plain.sim.dispose();
    r.sim.dispose();
  }, 60000);

  it('the fire follows it: on a real site the head and the area are not the old wind\'s, and the fire before the change is the old wind\'s', async () => {
    const site = await mockBuildScenario(
      {
        centre: { lat: -33.715, lon: 150.285 },
        extent: 3000,
        demoSiteId: 'katoomba',
        weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start: Date.UTC(2026, 0, 10, 0) },
        duration: 6 * 3600,
        options: { fireCellSize: 60, snapshotInterval: 60 },
        online: false,
      },
      () => undefined,
    );
    const start = { ...site, ignitions: [pointIgnition('a', -300, -200, 0, 60)] };
    const change = turn('w1', 90, 1200); // a westerly of the forecast's, turned to come from the east
    const plain = await rig(start);
    await plain.runTo(3600);
    const r = await rig({ ...start, edits: [change] });
    await r.runTo(3600);
    // the demo's solution is a travel-time search, not bitwise: the cells reached before the change stay (to a cell at the edge)
    expect(r.snaps.get(600)!.stats.burntAreaHa).toBe(plain.snaps.get(600)!.stats.burntAreaHa);
    expect(Math.abs(r.snaps.get(1200)!.stats.burntAreaHa - plain.snaps.get(1200)!.stats.burntAreaHa)).toBeLessThan(2);
    expect(dir(r, 3600)).toBeCloseTo(90, 6);
    const head = (x: Rig, t: number): number => x.snaps.get(t)!.stats.headDir;
    expect(Math.abs(angleDiffDeg(head(r, 3600), head(plain, 3600)))).toBeGreaterThan(20);
    expect(r.snaps.get(3600)!.stats.burntAreaHa).not.toBe(plain.snaps.get(3600)!.stats.burntAreaHa);
    plain.sim.dispose();
    r.sim.dispose();
  }, 120000);

  it('an edit made later rewinds to its time and the results after it follow the change', async () => {
    const r = await rig(scenario());
    await r.runTo(1800);
    expect(dir(r, 1800)).toBeCloseTo(270, 6);
    r.sim.edit(SOUTH, 600);
    expect(r.rewound).toEqual([600]);
    await r.runTo(1800);
    expect(dir(r, 1800)).toBeCloseTo(180, 6);
    r.sim.dispose();
  }, 60000);

  it('removing a change that has started takes the wind back and rewinds to its time; one that has not started just goes', async () => {
    const r = await rig(scenario([SOUTH]));
    await r.runTo(1800);
    expect(dir(r, 1800)).toBeCloseTo(180, 6);
    r.sim.removeEdit('w1');
    expect(r.rewound).toEqual([600]);
    await r.runTo(1800);
    expect(dir(r, 1800)).toBeCloseTo(270, 6);

    r.sim.edit(turn('later', 90, 3000), 3000);
    r.rewound.length = 0;
    r.sim.removeEdit('later');
    expect(r.rewound).toEqual([]);
    r.sim.dispose();
  }, 60000);

  it('a change not on a whole minute starts at the next one, and a second change cuts the first', async () => {
    const r = await rig(scenario());
    r.sim.edit(turn('odd', 180, 541), 541);
    await r.runTo(1200);
    expect(dir(r, 1200)).toBeCloseTo(203.33, 1); // as a change at 600
    r.sim.edit(turn('two', 90, 1200), 1200);
    await r.runTo(2400);
    expect(dir(r, 2400)).toBeCloseTo(90, 6);
    r.sim.dispose();
  }, 60000);

  it('the Danger card for the forecast swing is not raised once a change that has started replaces the swing', async () => {
    // The preset's forecast swings from NW to SW 4 hours in: the card is due 30 minutes before, with fire on the ground.
    const site = await mockBuildScenario(
      {
        centre: { lat: -33.715, lon: 150.285 },
        extent: 3000,
        demoSiteId: 'katoomba',
        weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start: Date.UTC(2026, 0, 10, 0) },
        duration: 6 * 3600,
        options: { fireCellSize: 60, snapshotInterval: 60 },
        online: false,
      },
      () => undefined,
    );
    const start = { ...site, ignitions: [pointIgnition('a', -300, -200, 0, 60)] };
    const titles = (r: Rig): string[] => [...r.snaps.values()].flatMap((s) => s.insights.map((i) => i.title));
    const plain = await rig(start);
    await plain.runTo(4 * 3600);
    expect(titles(plain)).toContain('Wind change in 30 minutes');
    const r = await rig({ ...start, edits: [SOUTH] }); // starts at 600 s, long before the swing
    await r.runTo(4 * 3600);
    expect(titles(r)).not.toContain('Wind change in 30 minutes');
    plain.sim.dispose();
    r.sim.dispose();
  }, 120000);

  it('a change made for later replaces the forecast swing from the moment it was made (madeAt), so its Danger card is not raised; without madeAt it is until the change starts (0.7.0)', async () => {
    const site = await mockBuildScenario(
      {
        centre: { lat: -33.715, lon: 150.285 },
        extent: 3000,
        demoSiteId: 'katoomba',
        weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start: Date.UTC(2026, 0, 10, 0) },
        duration: 6 * 3600,
        options: { fireCellSize: 60, snapshotInterval: 60 },
        online: false,
      },
      () => undefined,
    );
    const start = { ...site, ignitions: [pointIgnition('a', -300, -200, 0, 60)] };
    const titles = (r: Rig): string[] => [...r.snaps.values()].flatMap((s) => s.insights.map((i) => i.title));
    // The change starts at 3 h 45 min, after the card is due (30 minutes before the swing at 4 h, so at 3 h 30 min) and before the swing.
    const later = turn('later', 90, 13500);
    const unmade = await rig({ ...start, edits: [later] });
    await unmade.runTo(4 * 3600);
    expect(titles(unmade)).toContain('Wind change in 30 minutes');
    const made = await rig({ ...start, edits: [{ ...later, madeAt: 600 }] });
    await made.runTo(4 * 3600);
    expect(titles(made)).not.toContain('Wind change in 30 minutes');
    unmade.sim.dispose();
    made.sim.dispose();
  }, 180000);

  it('a change of the user\'s raises its own wind-change card (Watch, its own key, in the user\'s words), once, from when it was made or 30 minutes before it starts', async () => {
    const own = (r: Rig): SimSnapshot['insights'] => [...r.snaps.values()].flatMap((s) => s.insights).filter((i) => i.key?.startsWith('wind-change:user:'));
    // Made at 0 for 1800: due at once.
    const r = await rig(scenario([{ ...SOUTH, time: 1800, madeAt: 0 }]));
    await r.runTo(2400);
    const cards = own(r);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'wind-change', severity: 'watch', key: 'wind-change:user:w1', title: 'Your wind change: this flank becomes the head', time: 0 });
    expect(cards[0]!.body).toMatch(/^You set the wind to swing from W to S, starting at about .+ \(in 30 min\)\. It takes 15 minutes to turn, and the wind will then be about 36 km\/h\./);
    expect(cards[0]!.factors.map((f) => f.label)).toEqual(['New wind', 'Change time']);
    r.sim.dispose();

    // Set later, at the head (1200) for 3300: due 30 minutes before it starts, which is 1500.
    const l = await rig(scenario());
    await l.runTo(1200);
    l.sim.edit({ ...turn('w2', 180, 3300), madeAt: 1200 }, 3300);
    await l.runTo(3000);
    const later = own(l);
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({ key: 'wind-change:user:w2', time: 1500 });
    // Made at the head for "now" (it starts at the head): raised when it was made, with no countdown.
    const n = await rig(scenario());
    await n.runTo(600);
    n.sim.edit({ ...turn('w3', 180, 600), madeAt: 600 }, 600);
    await n.runTo(1200);
    expect(own(n)).toHaveLength(1);
    expect(own(n)[0]).toMatchObject({ time: 600 });
    expect(own(n)[0]!.body).toMatch(/starting at about [^()]+\. It takes/);
    l.sim.dispose();
    n.sim.dispose();
  }, 120000);

  it('removing a change made for later rewinds to when it was made (not to its start), and its card is not raised again (0.7.0)', async () => {
    const own = (r: Rig): SimSnapshot['insights'] => [...r.snaps.values()].flatMap((s) => s.insights).filter((i) => i.key?.startsWith('wind-change:user:'));
    const r = await rig(scenario());
    await r.runTo(600);
    r.sim.edit({ ...turn('w1', 180, 3300), madeAt: 600 }, 3300); // made at 600, due 30 minutes before it starts: 1500
    await r.runTo(1800);
    expect(own(r)).toHaveLength(1);
    r.rewound.length = 0;
    r.sim.removeEdit('w1');
    expect(r.rewound).toEqual([600]); // not 3300: it has not started, but its card was raised from the first minute after it was made
    for (const t of [...r.snaps.keys()].filter((t) => t > 600)) r.snaps.delete(t);
    await r.runTo(3000);
    expect(own(r)).toEqual([]);
    r.sim.dispose();
  }, 120000);

  it('a turn of 30 degrees, or a wind of 12 km/h after it, raises no card of its own', async () => {
    const small = await rig(scenario([{ ...turn('h', 240, 1800), madeAt: 0 }]));
    await small.runTo(1800);
    expect([...small.snaps.values()].flatMap((s) => s.insights).filter((i) => i.key?.startsWith('wind-change:user:'))).toEqual([]);
    const slow = await rig({ ...syntheticScenario({ windFromDeg: 270, windKmh: 12, slopeDeg: 0, extent: 3000, duration: 3600, ignitions: [pointIgnition('a', -600, 0, 0, 60)], options: { snapshotInterval: 60 } }), edits: [{ ...turn('s', 180, 1800), madeAt: 0 }] });
    await slow.runTo(1800);
    expect([...slow.snaps.values()].flatMap((s) => s.insights).filter((i) => i.key?.startsWith('wind-change:user:'))).toEqual([]);
    small.sim.dispose();
    slow.sim.dispose();
  }, 120000);

  it('explain reads the changed wind too', async () => {
    const r = await rig(scenario([SOUTH]));
    await r.runTo(1800);
    const ex = await r.sim.explain(-300, 0, 1800);
    expect(ex.narrative.length).toBeGreaterThan(0);
    r.sim.dispose();
  }, 60000);
});
