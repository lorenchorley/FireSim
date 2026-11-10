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
import { availableMemory, defaultMaxSessionMib, MIB } from './memoryBound';
import { checkSession, estimateSessionBytes, MODEL_MARGIN, sizeOfScenario } from './sessionEstimate';

const size = (frameMiB: number, fireCells: number, extentM: number, maxEmbers = 4000) => ({ frameBytes: frameMiB * MIB, fireCells, extentM, maxEmbers });
const mib = (bytes: number): number => bytes / MIB;

/**
 * What real sessions held, measured by lane H on 2026-11-08 on this build machine: SimHost on a scenario in a process of its own (`node desktop/measure.mjs
 * EXTENT TIER RUN_TO_S [CELL_M]`, which runs `node --expose-gc` on desktop/measureSession.ts), `arrayBuffers + heapUsed` after a forced garbage collection
 * at the end of a run of 300 to 1800 s (the scenario counted once, no frame). The first nine are the Katoomba demo site (30 m, and 20 m for the high tier
 * up to 6 km); the last three are `syntheticScenario({ extent, cellSize: 10 })`, the fire cell of the finer detail of 0.9.0 (the tool's fourth argument),
 * which the tree can run whatever lane K's builder does. Label, extent (m), message (MiB), fire cells, measured (MiB).
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
  ['6 km fast, 10 m (synthetic), 1800 s', 6000, 29.9, 360_000, 549.6 + 17.9],
  ['6 km high, 10 m (synthetic), 900 s', 6000, 29.9, 360_000, 568.5 + 18.3],
  ['9 km fast, 10 m (synthetic), 1800 s', 9000, 67.2, 810_000, 1220.6 + 21.4],
];

describe('the estimate of a session', () => {
  it('is above what real sessions held, at every extent, tier and fire cell measured (30 m, 20 m and 10 m), and not more than four times above it', () => {
    for (const [label, extent, frame, cells, held] of MEASURED) {
      const est = mib(estimateSessionBytes(size(frame, cells, extent)));
      expect(est, `${label}: ${est.toFixed(0)} MiB estimated, ${held.toFixed(0)} held`).toBeGreaterThan(held);
      expect(est, label).toBeLessThan(held * 4);
    }
  });

  it("is above the plan's runs at 10 m: a peak of 1.2 GB for 6 km and 1.9 GB over 9 km (plan 15e; whole processes), and so a scenario of that size is allowed by the default on a 16 GB computer and refused on a small one", () => {
    // the messages are lane K's figures for the Katoomba demo site at 10 m cells (6 km: 46.5 MiB, 9 km: 104.8 MiB, 82% of the default frame cap)
    const six = estimateSessionBytes(size(46.5, 360_000, 6000));
    const nine = estimateSessionBytes(size(104.8, 810_000, 9000));
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

  it('counts on the limit of the container or control group when it is lower than the computer\'s memory, and on the computer\'s when there is none (0, a huge figure or nothing)', () => {
    const total = 16 * 1024 * MIB;
    expect(availableMemory(total, 4 * 1024 * MIB)).toBe(4 * 1024 * MIB);
    for (const none of [undefined, 0, -1, total, total * 4, 2 ** 63]) expect(availableMemory(total, none), String(none)).toBe(total);
    expect(defaultMaxSessionMib(availableMemory(total, 4 * 1024 * MIB), 2)).toBe(1228);
  });

  it('lets every session use its share at once without the sessions together passing 60% of the memory', () => {
    for (const [total, sessions] of [[16, 3], [8, 4], [32, 4], [4, 1]] as const) expect(defaultMaxSessionMib(total * 1024 * MIB, sessions) * sessions).toBeLessThanOrEqual(0.6 * total * 1024 + 1);
  });
});
