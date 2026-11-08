/**
 * The memory bound of a session (0.9.0 contract 4.2, item 3): the estimate of what a scenario needs is above what real sessions held (lane H's
 * measurements, below) and above the plan's runs at 10 m, it follows what the scenario CLAIMS (a short message cannot ask for a big
 * session), it never throws on what is not a scenario, and the default of `--max-session-mib` is 60% of the memory shared by the sessions.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { syntheticScenario } from '../src/sim/testing/scenarios';
import { encodeMessage } from '../src/sim/remote/codec';
import { withoutContext } from '../src/sim/client';
import { defaultMaxSessionMib, MIB } from './memoryBound';
import { checkSession, estimateSessionBytes, MODEL_MARGIN, sizeOfScenario } from './sessionEstimate';

const size = (frameMiB: number, fireCells: number, extentM: number, maxEmbers = 4000) => ({ frameBytes: frameMiB * MIB, fireCells, extentM, maxEmbers });
const mib = (bytes: number): number => bytes / MIB;

/**
 * What real sessions held, measured by lane H on 2026-11-08 on this build machine: SimHost on a Katoomba demo scenario in a process of its own
 * (`node --expose-gc` of a build of desktop/measureSession.ts), `arrayBuffers + heapUsed` after a forced garbage collection at the end of a run of
 * 300 to 1800 s (the scenario counted once, no frame). Label, extent (m), message (MiB), fire cells, measured (MiB).
 */
const MEASURED: [string, number, number, number, number][] = [
  ['3 km fast, 30 m', 3000, 1.7, 10_000, 22.5 + 19.3],
  ['6 km fast, 30 m', 6000, 6.5, 40_000, 76.6 + 19.9],
  ['9 km fast, 30 m', 9000, 14.5, 90_000, 156.7 + 18.7],
  ['3 km standard, 30 m', 3000, 1.7, 10_000, 28.8 + 19.6],
  ['6 km standard, 30 m', 6000, 6.5, 40_000, 89 + 20.2],
  ['9 km standard, 30 m', 9000, 14.5, 90_000, 165.6 + 18.6],
  ['3 km high, 20 m', 3000, 3.3, 22_500, 49.6 + 19.8],
  ['6 km high, 20 m', 6000, 12.8, 90_000, 192.2 + 18.9],
  ['9 km high (30 m: too big for 20 m)', 9000, 14.5, 90_000, 194.4 + 18.3],
];

describe('the estimate of a session', () => {
  it('is above what real sessions held, at every extent and tier measured, and not more than four times above it', () => {
    for (const [label, extent, frame, cells, held] of MEASURED) {
      const est = mib(estimateSessionBytes(size(frame, cells, extent)));
      expect(est, `${label}: ${est.toFixed(0)} MiB estimated, ${held.toFixed(0)} held`).toBeGreaterThan(held);
      expect(est, label).toBeLessThan(held * 4);
    }
  });

  it("is above the plan's runs at 10 m: a peak of 1.2 GB for 6 km and 1.9 GB over 9 km (plan 15e; whole processes), and so a scenario of that size is allowed by the default on a 16 GB computer and refused on a small one", () => {
    const six = estimateSessionBytes(size(40, 360_000, 6000));
    const nine = estimateSessionBytes(size(83, 810_000, 9000));
    expect(mib(six)).toBeGreaterThan(1200);
    expect(mib(nine)).toBeGreaterThan(1900);
    const sixteenGiB = defaultMaxSessionMib(16 * 1024 * MIB, 3) * MIB;
    expect(nine).toBeLessThan(sixteenGiB);
    const eightGiB = defaultMaxSessionMib(8 * 1024 * MIB, 3) * MIB;
    expect(nine).toBeGreaterThan(eightGiB);
  });

  it('is above a real simulation of a small scenario of this tree, counting what Simulation.memoryReport() says it holds', () => {
    const scenario = syntheticScenario({ extent: 2400, options: { tier: 'standard', maxEmbers: 1000 } });
    const frame = encodeMessage({ type: 'init', scenario: withoutContext(scenario) }).byteLength;
    const sim = new Simulation(scenario, { tier: 'standard' });
    const held = sim.memoryReport().totalBytes;
    const claimed = sizeOfScenario(frame, scenario);
    expect(claimed.fireCells).toBe(scenario.terrain.grid.nx * scenario.terrain.grid.ny);
    expect(claimed.extentM).toBe(2400);
    expect(estimateSessionBytes(claimed)).toBeGreaterThan(held);
  });

  it('grows with each thing the scenario claims, and only with those: the message, the fire cells, the extent, the ember budget', () => {
    const base = estimateSessionBytes(size(10, 40_000, 6000));
    expect(estimateSessionBytes(size(20, 40_000, 6000))).toBeGreaterThan(base);
    expect(estimateSessionBytes(size(10, 80_000, 6000))).toBeGreaterThan(base);
    expect(estimateSessionBytes(size(10, 40_000, 30_000))).toBeGreaterThan(base);
    expect(estimateSessionBytes(size(10, 40_000, 6000, 32_000))).toBeGreaterThan(base);
    expect(estimateSessionBytes(size(10, 40_000, 6000))).toBe(base);
  });

  it('is made from what the scenario SAYS, not from how long the message is: a small message that claims a big grid or a big extent is a big session', () => {
    const limit = 2048 * MIB;
    expect(estimateSessionBytes(size(1, 100_000_000, 6000))).toBeGreaterThan(limit); // 10^8 fire cells in a 1 MiB message
    expect(estimateSessionBytes(size(1, 40_000, 5_000_000))).toBeGreaterThan(limit); // an air grid of 5000 km
    expect(estimateSessionBytes(size(1, 40_000, 6000, 100_000_000))).toBeGreaterThan(limit); // 10^8 embers
    expect(estimateSessionBytes(size(1, 40_000, 6000))).toBeLessThan(limit);
  });

  it('reads the claims of a decoded scenario: the larger of the terrain and the fuel grid, the extent, the ember budget (at least the tier default)', () => {
    const s = { extent: 9000, terrain: { grid: { nx: 300, ny: 300 } }, fuel: { grid: { nx: 600, ny: 600 } }, options: { maxEmbers: 32_000 } };
    expect(sizeOfScenario(5 * MIB, s)).toEqual({ frameBytes: 5 * MIB, fireCells: 360_000, extentM: 9000, maxEmbers: 32_000 });
    expect(sizeOfScenario(1, { ...s, options: { maxEmbers: 10 } }).maxEmbers).toBe(4000);
    expect(sizeOfScenario(1, { ...s, options: {} }).maxEmbers).toBe(4000);
  });

  it('counts anything that is not a positive finite number as nothing, and never throws on what is not a scenario (the engine says what is wrong with it)', () => {
    const junk: unknown[] = [undefined, null, 5, 'x', [], [1, 2], {}, { terrain: 5 }, { terrain: null }, { terrain: { grid: 'g' } }, { terrain: { grid: { nx: 'a', ny: -3 } } }, { terrain: { grid: { nx: NaN, ny: Infinity } } }, { extent: -1 }, { extent: NaN }, { extent: '9000' }, { options: null }, { options: { maxEmbers: NaN } }, { options: { maxEmbers: -5 } }];
    for (const j of junk) {
      const claimed = sizeOfScenario(1000, j);
      expect(claimed.fireCells, String(JSON.stringify(j))).toBe(0);
      expect(claimed.extentM).toBe(0);
      expect(claimed.maxEmbers).toBe(4000);
      expect(Number.isFinite(estimateSessionBytes(claimed))).toBe(true);
    }
    expect(sizeOfScenario(NaN, {}).frameBytes).toBe(0);
    expect(sizeOfScenario(-1, {}).frameBytes).toBe(0);
  });

  it('checks a scenario against a limit: fits, does not fit, and always fits when there is no limit', () => {
    const scenario = { extent: 6000, terrain: { grid: { nx: 200, ny: 200 } }, fuel: { grid: { nx: 200, ny: 200 } }, options: {} };
    const need = checkSession(7 * MIB, scenario, undefined);
    expect(need.ok).toBe(true);
    expect(need.limit).toBe(Infinity);
    expect(need.estimate).toBe(estimateSessionBytes(sizeOfScenario(7 * MIB, scenario)));
    expect(checkSession(7 * MIB, scenario, need.estimate).ok).toBe(true); // exactly at the limit
    const over = checkSession(7 * MIB, scenario, need.estimate - 1);
    expect(over).toMatchObject({ ok: false, estimate: need.estimate, limit: need.estimate - 1 });
  });

  it('keeps the margin it says it has: the model is the repository\'s own and the margin is a whole 2', () => {
    expect(MODEL_MARGIN).toBe(2);
  });
});

describe('the default of --max-session-mib', () => {
  it('is 60% of the computer\'s memory divided by the sessions that may run at once, in MiB', () => {
    expect(defaultMaxSessionMib(16 * 1024 * MIB, 3)).toBe(3276); // 0.6 x 16384 / 3
    expect(defaultMaxSessionMib(16 * 1024 * MIB, 1)).toBe(9830);
    expect(defaultMaxSessionMib(8 * 1024 * MIB, 4)).toBe(1228);
    expect(defaultMaxSessionMib(64 * 1024 * MIB, 4)).toBe(9830);
  });

  it('is at least 256 MiB, so a small computer can run the small scenarios, and copes with a session count of 0 or a fraction', () => {
    expect(defaultMaxSessionMib(1024 * MIB, 4)).toBe(256);
    expect(defaultMaxSessionMib(0, 3)).toBe(256);
    expect(defaultMaxSessionMib(16 * 1024 * MIB, 0)).toBe(9830);
    expect(defaultMaxSessionMib(16 * 1024 * MIB, 2.9)).toBe(4915);
  });

  it('lets every session use its share at once without the sessions together passing 60% of the memory', () => {
    for (const [total, sessions] of [[16, 3], [8, 4], [32, 4], [4, 1]] as const) expect(defaultMaxSessionMib(total * 1024 * MIB, sessions) * sessions).toBeLessThanOrEqual(0.6 * total * 1024 + 1);
  });
});
