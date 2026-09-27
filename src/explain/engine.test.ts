/**
 * InsightEngine rules (spec §10.1): 60 s cadence, persistence, 0.8 hysteresis, 15 min cool-down, severity escalation
 * bypassing the cool-down, at most 3 new insights per cycle ranked danger > watch > info → score → distance to the
 * head, kind-level de-duplication, and checkpoint/restore determinism. Uses scripted stub rules on the
 * SimStateView test double so the state machine is tested in isolation from the detectors.
 */
import { describe, expect, it } from 'vitest';
import type { Insight, InsightKind, InsightSeverity } from '../core/types';
import { InsightEngine } from './engine';
import { EXPLAIN_PARAMS } from './params';
import type { InsightRule } from './rules/types';
import type { Candidate } from './text';
import { TestWorld } from './testing/simState';

type Script = (cycle: number) => Candidate[];

/** A rule whose detector replays a script indexed by the engine cycle (set by the test loop). */
function stubRule(kind: InsightKind, script: Script, o: Partial<Pick<InsightRule, 'persistence' | 'cooldown' | 'dedupRadiusM'>> = {}): InsightRule & { cycle: number } {
  const r = {
    kind,
    priority: 'P0' as const,
    persistence: o.persistence ?? 2,
    cooldown: o.cooldown ?? 900,
    dedupRadiusM: o.dedupRadiusM ?? 0,
    cycle: 0,
    detect(): Candidate[] {
      return script(r.cycle);
    },
    render(c: Candidate) {
      return { title: `${kind} ${c.severity}`, body: 'Stub. Stub.', safety: 'Stub.', factors: [], source: 'test', confidence: 'physics' as const, showLayers: [] };
    },
  };
  return r;
}

const C = (key: string, score: number, severity: InsightSeverity = 'info', x = 0, y = 0): Candidate => ({ key, x, y, score, severity, values: {} });

/** Drive `cycles` detector cycles at 60 s; returns the insights of each cycle. */
function drive(eng: InsightEngine, w: TestWorld, rules: (InsightRule & { cycle: number })[], cycles: number, t0 = 60): Insight[][] {
  const out: Insight[][] = [];
  for (let c = 0; c < cycles; c++) {
    for (const r of rules) r.cycle = c;
    w.setTime(t0 + 60 * c);
    out.push(eng.update(w.view));
  }
  return out;
}

function world(): TestWorld {
  const w = new TestWorld();
  w.igniteDisc(0, 0, 150);
  return w;
}

const engineWith = (w: TestWorld, rules: InsightRule[]): InsightEngine => new InsightEngine(w.terrain, w.derived, w.fuel, w.features, { startTime: w.startMs, rules });

describe('cadence and persistence', () => {
  it('runs every 60 s of simulated time; calls in between return nothing', () => {
    const w = world();
    const r = stubRule('upslope-run', () => [C('upslope-run:1:1', 1.5)], { persistence: 1 });
    const eng = engineWith(w, [r]);
    w.setTime(60);
    expect(eng.update(w.view).length).toBe(1);
    w.setTime(90);
    expect(eng.update(w.view)).toEqual([]);
    w.setTime(119);
    expect(eng.update(w.view)).toEqual([]);
  });

  it('shows a card after the default 2 cycles of score ≥ 1 and not before; a single blip never shows', () => {
    const w = world();
    const r = stubRule('upslope-run', (c) => (c === 0 || c >= 2 ? [C('upslope-run:1:1', 1.2)] : []));
    const out = drive(engineWith(w, [r]), w, [r], 5);
    expect(out[0]).toEqual([]); // armed
    expect(out[1]).toEqual([]); // dropped → idle
    expect(out[2]).toEqual([]); // armed again
    expect(out[3]!.length).toBe(1); // persistence 2 reached
    expect(out[3]![0]!.key).toBe('upslope-run:1:1');
    expect(out[3]![0]!.time).toBe(60 + 3 * 60);
    expect(out[4]).toEqual([]); // stays shown, no repeat
  });

  it('per-rule persistence (plume-dominated uses 5) and per-candidate override', () => {
    const w = world();
    const r = stubRule('plume-dominated', () => [C('plume-dominated:1:1', 1)], { persistence: 5 });
    const o = stubRule('general', () => [{ ...C('general:light-wind:domain', 1), persistence: 3 }]);
    const out = drive(engineWith(w, [r, o]), w, [r, o], 6);
    const first = (key: string): number => out.findIndex((l) => l.some((i) => i.key === key));
    expect(first('plume-dominated:1:1')).toBe(4);
    expect(first('general:light-wind:domain')).toBe(2);
  });
});

describe('hysteresis, cool-down and escalation', () => {
  it('stays active while score ≥ 0.8, cools down for 15 min after it turns off, then can show again', () => {
    const w = world();
    // cycles: 0–1 on (shown at 1), 2–4 at 0.85 (still active), 5 at 0.5 (off → cool-down from t = 360 s),
    // 6–19 on again (inside the cool-down: nothing), from 20 on (t ≥ 360 + 900 = 1260 s → cycle 20) re-armed.
    const score = (c: number): number => (c <= 1 ? 1.3 : c <= 4 ? 0.85 : c === 5 ? 0.5 : 1.3);
    const r = stubRule('ridge-crest', (c) => [C('ridge-crest:3:4', score(c), 'watch')]);
    const out = drive(engineWith(w, [r]), w, [r], 24);
    const shownAt = out.map((l, c) => (l.length ? c : -1)).filter((c) => c >= 0);
    // Off at cycle 5 (t = 360 s); cool-down ends at t ≥ 1260 s (cycle 20): idle → armed at 20, shown at 21.
    expect(shownAt).toEqual([1, 21]);
    expect(EXPLAIN_PARAMS.engine.cooldownS).toBe(900);
    expect(EXPLAIN_PARAMS.engine.hysteresis).toBe(0.8);
  });

  it('a severity escalation bypasses persistence and the cool-down', () => {
    const w = world();
    // info shown at cycle 1; off at 3 (cool-down); watch at 4 → shown at once; danger at 5 → shown at once.
    const sev = (c: number): InsightSeverity | null => (c <= 2 ? 'info' : c === 3 ? null : c === 4 ? 'watch' : 'danger');
    const r = stubRule('gully-chimney', (c) => {
      const s = sev(c);
      return s ? [C('gully-chimney:2:2', 1.1, s)] : [];
    });
    const out = drive(engineWith(w, [r]), w, [r], 7);
    expect(out.map((l) => l.map((i) => i.severity))).toEqual([[], ['info'], [], [], ['watch'], ['danger'], []]);
  });

  it('a de-escalation during a shown card does not re-show it', () => {
    const w = world();
    const r = stubRule('crown-fire', (c) => [C('crown-fire:1:1', 1.5, c < 3 ? 'danger' : 'watch')]);
    const out = drive(engineWith(w, [r]), w, [r], 6);
    expect(out.flat().length).toBe(1);
    expect(out[1]![0]!.severity).toBe('danger');
  });
});

describe('ranking, cap and de-duplication', () => {
  it('at most 3 new insights per cycle, danger > watch > info, then score, then distance to the head', () => {
    const w = world();
    const cands = [
      C('upslope-run:9:9', 1.9, 'info', 100, 0),
      C('ridge-crest:1:1', 1.2, 'watch', 2000, 0),
      C('ridge-crest:1:2', 1.2, 'watch', 500, 0),
      C('crown-fire:1:1', 1.0, 'danger', 3000, 0),
      C('heavy-fuel:5:5', 1.5, 'watch', 100, 0),
    ];
    const rule = (kind: InsightKind) => stubRule(kind, () => cands.filter((c) => c.key.startsWith(kind)), { persistence: 1 });
    const rules = [rule('upslope-run'), rule('ridge-crest'), rule('crown-fire'), rule('heavy-fuel')];
    const out = drive(engineWith(w, rules), w, rules, 3);
    // Cycle 0: danger first, then the watch with the higher score, then the nearer of the two equal watches.
    expect(out[0]!.map((i) => i.key)).toEqual(['crown-fire:1:1', 'heavy-fuel:5:5', 'ridge-crest:1:2']);
    // Cycle 1: the rest (still armed and past persistence).
    expect(out[1]!.map((i) => i.key)).toEqual(['ridge-crest:1:1', 'upslope-run:9:9']);
    expect(out[2]).toEqual([]);
    expect(EXPLAIN_PARAMS.engine.maxNewPerCycle).toBe(3);
  });

  it('a new key of the same kind within the de-dup radius is suppressed unless more severe', () => {
    const w = world();
    const r = stubRule(
      'upslope-run',
      (c) => [C('upslope-run:1:1', 1.2, 'info', 0, 0), ...(c >= 2 ? [C('upslope-run:2:1', 1.2, 'info', 600, 0)] : []), ...(c >= 4 ? [C('upslope-run:3:1', 1.2, 'watch', 800, 0)] : [])],
      { persistence: 1, dedupRadiusM: 1000 },
    );
    const out = drive(engineWith(w, [r]), w, [r], 6);
    expect(out.flat().map((i) => i.key)).toEqual(['upslope-run:1:1', 'upslope-run:3:1']);
  });
});

describe('same-cycle de-duplication', () => {
  it('two new keys of one kind within the radius in the same cycle: only the higher-ranked one shows', () => {
    const w = world();
    const r = stubRule('upslope-run', () => [C('upslope-run:1:1', 1.2, 'info', 0, 0), C('upslope-run:2:1', 1.5, 'info', 500, 0), C('upslope-run:6:1', 1.1, 'info', 2500, 0)], {
      persistence: 1,
      dedupRadiusM: 1000,
    });
    const out = drive(engineWith(w, [r]), w, [r], 3);
    expect(out.flat().map((i) => i.key)).toEqual(['upslope-run:2:1', 'upslope-run:6:1']);
  });
});

describe('checkpoint / restore', () => {
  const script: Script = (c) => {
    const l: Candidate[] = [];
    if (c % 7 < 4) l.push(C('upslope-run:1:1', 1.2, c > 8 ? 'watch' : 'info'));
    if (c >= 3) l.push(C('ridge-crest:2:2', c % 5 === 0 ? 0.7 : 1.1, 'watch', 400, 0));
    if (c % 3 === 0) l.push(C('spot-fire:4:4', 1.5, 'info', 900, 0));
    return l;
  };
  const kinds: InsightKind[] = ['upslope-run', 'ridge-crest', 'spot-fire'];
  const mkRules = () => kinds.map((k) => stubRule(k, (c) => script(c).filter((x) => x.key.startsWith(k)), { persistence: k === 'spot-fire' ? 1 : 2, cooldown: 240 }));

  it('a restored engine reproduces the insights of the uninterrupted run exactly (rewind determinism, §12.4–§12.5)', () => {
    const w = world();
    const rA = mkRules();
    const A = engineWith(w, rA);
    const full = drive(A, w, rA, 30);

    const rB = mkRules();
    const B = engineWith(w, rB);
    drive(B, w, rB, 12);
    const cp = structuredClone(B.checkpoint());
    const tail = (eng: InsightEngine, rules: (InsightRule & { cycle: number })[]): Insight[][] => {
      const out: Insight[][] = [];
      for (let c = 12; c < 30; c++) {
        for (const r of rules) r.cycle = c;
        w.setTime(60 + 60 * c);
        out.push(eng.update(w.view));
      }
      return out;
    };
    const rC = mkRules();
    const Cn = engineWith(w, rC);
    Cn.restore(cp);
    expect(tail(Cn, rC)).toEqual(full.slice(12));
    // Restoring into the same engine after running on (rewind) also reproduces.
    tail(B, rB);
    B.restore(cp);
    expect(tail(B, rB)).toEqual(full.slice(12));
    expect(full.flat().length).toBeGreaterThan(5);
  });

  it('the full detector registry is rewind-deterministic too (fresh engine + restored checkpoint, spec §12.5)', () => {
    const tan = (d: number): number => Math.tan((d * Math.PI) / 180);
    /** A growing fire on a ridge with a slowly veering, strengthening wind; state depends only on the cycle. */
    const mk = (): TestWorld => new TestWorld({ elevation: (x, y) => 600 + 250 * Math.exp(-(x * x) / (2 * 600 * 600)) + tan(8) * y, temperature: 33, rh: 15, moisture: 6, droughtFactor: 10, kbdi: 160 });
    const setCycle = (w: TestWorld, c: number): void => {
      w.setWind((25 + c) / 3.6, 250 + 2 * c);
      w.igniteDisc(-900 + 15 * c, -300, 200 + 25 * c, { ros: 0.1 + 0.01 * c, intensity: 3000 + 400 * c, flameHeight: 3 + 0.3 * c });
      w.setTime(4 * 3600 + 60 * c);
    };
    const runCycles = (eng: InsightEngine, w: TestWorld, from: number, to: number): Insight[][] => {
      const out: Insight[][] = [];
      for (let c = from; c < to; c++) {
        setCycle(w, c);
        out.push(eng.update(w.view));
      }
      return out;
    };
    const wA = mk();
    const A = new InsightEngine(wA.terrain, wA.derived, wA.fuel, wA.features, { startTime: wA.startMs });
    const full = runCycles(A, wA, 0, 30);
    expect(full.flat().length).toBeGreaterThan(3);
    const wB = mk();
    const B = new InsightEngine(wB.terrain, wB.derived, wB.fuel, wB.features, { startTime: wB.startMs });
    runCycles(B, wB, 0, 12);
    const cp = structuredClone(B.checkpoint());
    const wC = mk();
    const C2 = new InsightEngine(wC.terrain, wC.derived, wC.fuel, wC.features, { startTime: wC.startMs });
    C2.restore(cp);
    expect(runCycles(C2, wC, 12, 30)).toEqual(full.slice(12));
  });

  it('rejects an unknown checkpoint', () => {
    const w = world();
    const eng = engineWith(w, []);
    expect(() => eng.restore({ v: 99 })).toThrow();
  });
});

describe('rendered insights', () => {
  it('carry id, kind, severity, sim time, location, key and the rule text', () => {
    const w = world();
    const r = stubRule('saddle-channelling', () => [C('saddle-channelling:3:7', 1.4, 'watch', 1200, -300)], { persistence: 1 });
    const [ins] = drive(engineWith(w, [r]), w, [r], 1)[0]!;
    expect(ins).toMatchObject({ kind: 'saddle-channelling', severity: 'watch', time: 60, x: 1200, y: -300, key: 'saddle-channelling:3:7', title: 'saddle-channelling watch' });
    expect(ins!.id).toBe('saddle-channelling:3:7@60');
  });
});
