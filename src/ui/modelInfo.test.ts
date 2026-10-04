/**
 * "How this simulation works" content (modelInfo.ts): the rows follow the scenario and the engine's own report (cell
 * size, extent, tier), the fast and 3-D tiers are worded differently (also after a switch mid-run), fallbacks are
 * named, nothing prints undefined or NaN, the text export has every row, and the facts quoted from the specification
 * and the README are still true.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatasetRecord, DatasetSummary, EngineInfo, ScenarioData, SimSnapshot } from '../core/types';
import { LAYER_CATALOG } from '../render/layerCatalog';
import { Simulation } from '../sim/simulation';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { cardToText, describeModel as describeRaw, GLOSSARY, SPEC_EVIDENCE, SPEC_OPEN_ISSUES, type ModelCard, type ModelCardInput, type ModelRow } from './modelInfo';
import { DEFAULT_SETTINGS } from './settings';
import { buildRequest, defaultSetup } from './setupModel';

const settings = { ...DEFAULT_SETTINGS };

/** The card with its thin spaces (thousands groups) and no-break spaces (before units) as plain spaces, so the expectations stay readable. */
const describeModel = (input: ModelCardInput): ModelCard => JSON.parse(JSON.stringify(describeRaw(input)).replace(/[\u2009\u00a0\u202f]/g, ' ')) as ModelCard;
const root = resolve(__dirname, '../..');

/** Run a scenario a little and return its newest snapshot (with the engine info). */
function run(sc: ScenarioData, until: number, tier?: 'fast' | 'standard', after?: (sim: Simulation) => void): { snap: SimSnapshot; sim: Simulation } {
  let last: SimSnapshot | null = null;
  const sim = new Simulation(sc, { ...(tier ? { tier } : {}), hooks: { snapshot: (s) => (last = s) } });
  sim.advance(until);
  after?.(sim);
  return { snap: last!, sim };
}

const row = (card: ModelCard, id: string): ModelRow => {
  const r = card.sections.find((s) => s.id === 'glance')!.blocks.flatMap((b) => (b.type === 'rows' ? b.rows : [])).find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

/** Every string in the card (deep). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

function expectClean(card: ModelCard): void {
  for (const s of strings(card)) {
    expect(s, s).not.toMatch(/undefined|NaN|\[object|Infinity/);
    expect(s.trim().length, JSON.stringify(s)).toBeGreaterThan(0);
  }
}

const fastScenario = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });

describe('describeModel: live values follow the scenario and the engine', () => {
  const { snap } = run(fastScenario, 1200);
  const card = describeModel({ scenario: fastScenario, engine: snap.engine, snapshot: snap, settings });

  it('fast tier: 2-D fire, a fitted surface wind, and the engine’s own numbers', () => {
    expect(card.mode).toBe('live');
    expect(card.headline).toBe('Fire spreads in 2-D on a 30 m grid; the wind is a 2-D surface field fitted to the terrain (fast mode, no 3-D air flow).');
    const fire = row(card, 'fire');
    expect(fire.resolution).toContain('30 m cells (100 × 100 = 10 000 cells)');
    expect(fire.method).toContain('Vesta Mk2 (forest, 100 % of the burnable cells)');
    expect(fire.method).toContain('not simulated (no 3-D combustion)');
    expect(fire.live).toBe(true);
    const e = snap.engine!;
    if (e.fire.currentSubStepS! >= 10 - 1e-6) expect(fire.timeStep).toMatch(/^One sub-step per 10 s step now \(the fire is slow enough\)/);
    else {
      const sub = /^Sub-steps of ([\d.]+) s now, inside each 10 s step/.exec(fire.timeStep);
      expect(sub, fire.timeStep).not.toBeNull();
      expect(Number(sub![1])).toBeCloseTo(e.fire.currentSubStepS!, 0);
    }
    const atm = row(card, 'atmosphere');
    expect(atm.dimensions).toMatch(/^Fast mode: a 2-D surface wind/);
    expect(atm.resolution).toContain('30 × 30 columns 100 m apart (20 levels)');
    expect(atm.method).toContain('mass-consistent');
    expect(row(card, 'coupling').dimensions).toMatch(/2-D estimate/);
    expect(row(card, 'smoke').evidence).toBe('display');
    expect(row(card, 'embers').resolution).toMatch(/of 1 000 tracked particles/);
    expect(row(card, 'fuel').dimensions).toContain('not a 3-D block model');
    expect(row(card, 'weather').dimensions).toContain('not a weather map');
    expect(row(card, 'display').method).toContain('Trees are decorative');
    // Engine right now: live rows.
    const engine = card.sections.find((s) => s.id === 'engine')!;
    const facts = engine.blocks.flatMap((b) => (b.type === 'facts' ? b.facts : []));
    expect(facts.find((f) => f.id === 'eng-tier')!.value).toBe('Fast (surface wind)');
    expect(facts.find((f) => f.id === 'eng-step')!.value).toBe('10 s');
    expect(facts.find((f) => f.id === 'eng-embers')!.value).toBe(`${snap.stats.activeEmbers.toLocaleString('en-AU').replace(/,/g, ' ')} of 1 000 tracked`);
    expect(facts.find((f) => f.id === 'eng-checkpoints')!.value).toMatch(/^1 held, /);
    expectClean(card);
  }, 120000);

  it('what it can and cannot resolve is derived from the grids', () => {
    const lim = card.sections.find((s) => s.id === 'limits')!;
    const text = strings(lim).join('\n');
    expect(text).toContain('narrower than about 200 m'); // 2 × the 100 m wind grid
    expect(text).toContain('one 30 m fire cell');
    expect(text).toContain('3 km square');
    expect(text).toContain('Spread faster than 21.6 km/h'); // the 6 m/s level-set cap
    expect(text).toContain('forest head fires faster than 15 km/h');
    expect(text).toContain('no data assimilation');
    expect(text).toContain('fast mode: a 2-D estimate');
  });

  it('the text export contains every row, fact, bullet, layer and term', () => {
    const t = cardToText(card);
    expect(t.startsWith('TRAINING AID · NOT FOR OPERATIONAL USE')).toBe(true);
    for (const s of card.sections) {
      expect(t).toContain(`== ${s.title} ==`);
      for (const b of s.blocks) {
        if (b.type === 'rows') for (const r of b.rows) for (const v of [r.component, r.dimensions, r.resolution, r.timeStep, r.method, r.evidenceNote]) expect(t).toContain(v);
        if (b.type === 'facts') for (const f of b.facts) expect(t).toContain(`${f.key}: ${f.value}`);
        if (b.type === 'bullets') for (const x of b.bullets) expect(t).toContain(x.text);
        if (b.type === 'layers') for (const g of b.groups) for (const l of g.layers) expect(t).toContain(`${l.title} (`);
        if (b.type === 'glossary') for (const term of b.terms) expect(t).toContain(term.term);
      }
    }
  });

  it('lists every catalog layer with its dimensionality and a resolution worded from the scenario', () => {
    const block = card.sections.find((s) => s.id === 'layers')!.blocks[0]!;
    if (block.type !== 'layers') throw new Error('layers block');
    const lines = block.groups.flatMap((g) => g.layers);
    expect(lines.map((l) => l.id).sort()).toEqual(LAYER_CATALOG.map((l) => l.id).sort());
    expect(lines.find((l) => l.id === 'slope')!.resolution).toContain('30 m cells');
    expect(lines.find((l) => l.id === 'wind')!.resolution).toContain('100 m grid, surface wind only');
    expect(lines.find((l) => l.id === 'placeNames')!.dimension).toBe('2-D labels');
    expect(block.dimensions.length).toBeGreaterThanOrEqual(4);
  });

  it('fast tier: the smoke is one drawn column and the wind streaks follow a surface wind, never a 3-D volume (as the At a glance rows say)', () => {
    const block = card.sections.find((s) => s.id === 'layers')!.blocks[0]!;
    if (block.type !== 'layers') throw new Error('layers block');
    const lines = block.groups.flatMap((g) => g.layers);
    const smoke = lines.find((l) => l.id === 'smoke')!;
    expect(smoke.dimension).toBe('3-D objects');
    expect(smoke.resolution).toContain('One drawn column');
    expect(smoke.resolution).toContain('no smoke field');
    expect(lines.find((l) => l.id === 'wind')!.dimension).toBe('3-D objects');
    expect(lines.filter((l) => l.dimension === '3-D volume').map((l) => l.id)).toEqual([]);
    // The same card says so in the glance row.
    expect(row(card, 'smoke').dimensions).toMatch(/^Drawn only/);
  });

  it('terrain: a ground model coarser than the 10 m grid of the view is said to be interpolated, never presented as 10 m detail', () => {
    const srtm = JSON.parse(JSON.stringify(fastScenario)) as ScenarioData;
    srtm.datasets = [{ id: 'terrain', origin: 'live', native: { resolutionM: 30 } } as unknown as DatasetRecord];
    srtm.terrainHiRes = { grid: { ...fastScenario.terrain.grid, cellSize: 10 }, elevation: new Float32Array(0) };
    const c = describeModel({ scenario: srtm, engine: snap.engine, snapshot: snap, settings });
    const t = row(c, 'terrain');
    expect(t.resolution).toContain('a 10 m grid for the 3-D view and the air, smoothly interpolated from 30 m heights');
    expect(t.resolution).not.toContain('the 10 m ground model');
    const layers = c.sections.find((s) => s.id === 'layers')!.blocks[0]!;
    if (layers.type !== 'layers') throw new Error('layers block');
    expect(layers.groups.flatMap((g) => g.layers).find((l) => l.id === 'slope')!.resolution).toContain('interpolated from 30 m heights');
    // A finer source (the demo sites' 5 m model) keeps the plain wording.
    const dem = JSON.parse(JSON.stringify(srtm)) as ScenarioData;
    dem.datasets = [{ id: 'terrain', origin: 'bundled', native: { resolutionM: 5 } } as unknown as DatasetRecord];
    dem.terrainHiRes = srtm.terrainHiRes;
    expect(row(describeModel({ scenario: dem, engine: snap.engine, snapshot: snap, settings }), 'terrain').resolution).toContain('the 10 m ground model for the 3-D view and the air');
    // No claim of LiDAR anywhere in the card (the service says its heights are derived from stereo imagery).
    expect(JSON.stringify(c)).not.toMatch(/LiDAR/);
    expect(JSON.stringify(describeModel({ scenario: null, request: buildRequest(defaultSetup(), settings), settings }))).not.toMatch(/bundled LiDAR/);
  });

  it('before a run the Auto atmosphere row says the fast mode is the usual result on phones, and that this is not yet measured on phones', () => {
    const atm = row(describeModel({ scenario: null, request: buildRequest(defaultSetup(), settings), settings }), 'atmosphere');
    expect(atm.method).toMatch(/Most phones are expected to be too slow for the 3-D air, so the fast mode is the usual result/);
    expect(atm.method).toMatch(/measured on a computer, not yet on phones \(spec §16 item 20\)/);
    expect(SPEC_OPEN_ISSUES.find((x) => x.item === 20)!.plain).toMatch(/computer, not yet on target phones/);
  });
});

describe('describeModel: other cell sizes, extents and tiers change the rows', () => {
  it('a 20 m, 2.4 km scenario on the standard tier: 3-D wording and the real 3-D grid', () => {
    const sc = syntheticScenario({ extent: 2400, cellSize: 20, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });
    const { snap } = run(sc, 600, 'standard');
    const card = describeModel({ scenario: sc, engine: snap.engine, snapshot: snap, settings });
    expect(card.headline).toBe('Fire spreads in 2-D on a 20 m grid; the air above it is simulated in 3-D (24 × 24 × 20 cells, 100 m apart).');
    expect(row(card, 'fire').resolution).toContain('20 m cells (120 × 120 = 14 400 cells)');
    const atm = row(card, 'atmosphere');
    expect(atm.dimensions).toMatch(/^3-D: the air flow is simulated through time/);
    expect(atm.resolution).toMatch(/^24 × 24 columns 100 m apart, 20 levels from 30 m thick at the ground up to 3 000 m above the lowest ground$/);
    expect(atm.timeStep).toMatch(/now \(between 3 s and 12 s/);
    expect(row(card, 'coupling').dimensions).toMatch(/^Two-way/);
    expect(row(card, 'smoke').dimensions).toBe('3-D: a smoke field in the air');
    const lim = strings(card.sections.find((s) => s.id === 'limits')!).join('\n');
    expect(lim).toContain('narrower than about 200 m');
    expect(lim).not.toContain('fast mode: a 2-D estimate');
    expectClean(card);
  }, 240000);

  it('after a tier switch mid-run the wording follows the tier the engine reports', () => {
    const sc = syntheticScenario({ extent: 2400, ignitions: [pointIgnition('a', -300, 0, 0, 60)], options: { snapshotInterval: 300 } });
    let last: SimSnapshot | null = null;
    const sim = new Simulation(sc, { hooks: { snapshot: (s) => (last = s) } });
    sim.advance(2100);
    const before = describeModel({ scenario: sc, engine: last!.engine, settings });
    expect(before.headline).toContain('2-D surface field');
    sim.setQuality('standard');
    sim.advance(2400);
    const after = describeModel({ scenario: sc, engine: last!.engine, settings });
    expect(after.headline).toContain('simulated in 3-D (24 × 24 × 20 cells, 100 m apart)');
    const tier = after.sections.find((s) => s.id === 'engine')!.blocks.flatMap((b) => (b.type === 'facts' ? b.facts : [])).find((f) => f.id === 'eng-tier')!;
    expect(tier.value).toBe('Standard (3-D air)');
    expect(tier.note).toMatch(/Changed during the run: the standard 3-D atmosphere from 30 min/);
    expectClean(after);
  }, 240000);

  it('planned from a scenario before the engine reports; preview from the Setup request; the extent changes the air grid', () => {
    const planned = describeModel({ scenario: fastScenario, engine: null, settings });
    expect(planned.mode).toBe('planned');
    expect(planned.headline).toMatch(/^Planned: fire spreads in 2-D on a 30 m grid; the wind is a 2-D surface field/);
    expectClean(planned);
    const s = defaultSetup(Date.UTC(2026, 0, 10));
    const r6 = buildRequest({ ...s, extentKm: 6 }, settings, Date.UTC(2026, 0, 10));
    const p6 = describeModel({ scenario: null, request: r6, settings });
    expect(p6.mode).toBe('preview');
    // 6 km, 'auto': 30 m fire cells; the standard 3-D grid clamp(6000 / 45) = 133 m → 45 columns, 20 levels.
    expect(p6.headline).toBe(
      'Planned: fire spreads in 2-D on a 30 m grid; the air is simulated in 3-D (45 × 45 × 20 cells, 133 m apart) if this phone is fast enough, else the wind is a 2-D surface field (fast mode).',
    );
    expect(row(p6, 'fire').resolution).toContain('(200 × 200 = 40 000 cells)');
    expect(row(p6, 'atmosphere').resolution).toContain('up to at least 3 000 m');
    const r9 = buildRequest({ ...s, extentKm: 9, detail: 'fast' }, settings, Date.UTC(2026, 0, 10));
    const p9 = describeModel({ scenario: null, request: r9, settings });
    expect(p9.headline).toBe('Planned: fire spreads in 2-D on a 30 m grid; the wind is a 2-D surface field fitted to the terrain (fast mode, no 3-D air flow).');
    expect(row(p9, 'atmosphere').resolution).toContain('45 × 45 columns 200 m apart');
    const r3 = buildRequest({ ...s, extentKm: 3, detail: 'detailed' }, settings, Date.UTC(2026, 0, 10));
    const p3 = describeModel({ scenario: null, request: r3, settings });
    expect(p3.headline).toContain('on a 20 m grid');
    expect(p3.headline).toContain('(30 × 30 × 20 cells, 100 m apart)');
    for (const c of [p6, p9, p3]) expectClean(c);
    const data = p6.sections.find((x) => x.id === 'data')!;
    expect(data.blocks.some((b) => b.type === 'action')).toBe(true);
    expect(describeModel({ scenario: null, settings }).headline).toMatch(/Choose a place/);
    expectClean(describeModel({ scenario: null, settings }));
  });

  it('the demo engine is named as such and gives no live values', () => {
    const mockEngine = { ...(run(fastScenario, 300).snap.engine as EngineInfo), mock: true };
    const card = describeModel({ scenario: fastScenario, engine: mockEngine, settings, engineSource: 'mock' });
    expect(card.mode).toBe('mock');
    expect(card.headline).toMatch(/^Demo engine/);
    const engine = strings(card.sections.find((s) => s.id === 'engine')!).join(' ');
    expect(engine).toContain('None of the physics described on this page is being computed');
    expect(row(card, 'fire').live).toBe(false);
    expectClean(card);
  }, 120000);
});

describe('describeModel: data summary and fallbacks', () => {
  const fixture = (name: string): { datasets: DatasetRecord[]; summary: DatasetSummary } =>
    JSON.parse(readFileSync(resolve(root, `tests/fixtures/datasets/${name}.json`), 'utf8')) as { datasets: DatasetRecord[]; summary: DatasetSummary };

  it('an offline non-demo place: made-up terrain, inferred fuel and substitutes are named', () => {
    const f = fixture('offline-synthetic');
    const sc: ScenarioData = { ...fastScenario, datasets: f.datasets, datasetSummary: f.summary };
    const card = describeModel({ scenario: sc, engine: null, settings });
    expect(row(card, 'terrain').evidence).toBe('synthetic');
    expect(row(card, 'terrain').evidenceNote).toContain('made-up ground');
    expect(row(card, 'fuel').evidence).toBe('synthetic');
    expect(row(card, 'fuel').evidenceNote).toContain('inferred');
    const facts = card.sections.find((s) => s.id === 'data')!.blocks.flatMap((b) => (b.type === 'facts' ? b.facts : []));
    expect(facts.find((x) => x.id === 'data-count')!.value).toBe('15 (0 used, 7 substitutes, 7 not available, 1 not needed)');
    expect(facts.find((x) => x.id === 'data-network')!.value).toBe('Nothing (all from the app or this phone)');
    expect(facts.find((x) => x.id === 'data-fallbacks')!.value).toContain('Ground height');
    expectClean(card);
  });

  it('a download with unmeasured wire sizes is shown as an upper bound', () => {
    const f = fixture('live-nondemo');
    const summary: DatasetSummary = { ...f.summary, totals: { ...f.summary.totals, networkUnmeasuredBytes: 1_000_000 } };
    const card = describeModel({ scenario: { ...fastScenario, datasets: f.datasets, datasetSummary: summary }, engine: null, settings });
    const net = card.sections.find((s) => s.id === 'data')!.blocks.flatMap((b) => (b.type === 'facts' ? b.facts : [])).find((x) => x.id === 'data-network')!;
    expect(net.value).toBe('up to 2.3 MB');
    expect(net.note).toMatch(/upper bound/);
  });
});

describe('facts quoted from the specification and the README are still true', () => {
  const spec = readFileSync(resolve(root, 'docs/research/00-synthesis.md'), 'utf8');

  it('evidence tag counts of the model chapters (§4–§15)', () => {
    const body = spec.slice(spec.indexOf('\n## 4.'), spec.indexOf('\n## 16.'));
    const count = (t: string): number => (body.match(new RegExp(`\\[${t}(?=[\\] ,;:])`, 'g')) ?? []).length;
    expect({ verified: count('V'), literature: count('K'), derived: count('D'), heuristic: count('H'), unverified: (body.match(/UNVERIFIED/g) ?? []).length }).toEqual({
      verified: SPEC_EVIDENCE.verified,
      literature: SPEC_EVIDENCE.literature,
      derived: SPEC_EVIDENCE.derived,
      heuristic: SPEC_EVIDENCE.heuristic,
      unverified: SPEC_EVIDENCE.unverified,
    });
  });

  it('every open issue quoted is that item of §16', () => {
    const s16 = spec.slice(spec.indexOf('\n## 16.'), spec.indexOf('\n## 17.'));
    for (const i of SPEC_OPEN_ISSUES) expect(s16, `item ${i.item}`).toMatch(new RegExp(`\\n${i.item}\\. \\*\\*${i.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`));
  });

  it('the validation summary matches the README', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\n>\s?/g, ' ').replace(/\s+/g, ' ');
    expect(readme).toMatch(/§15 scenarios pass/);
    expect(readme).toMatch(/V20 speed gates are missed for very large \(≈ 3 000–5 000 ha\) fires/);
    expect(readme).toMatch(/≈ 1 % on average but up to ≈ 4 % in single cells \(V21\)/);
    expect(readme).toMatch(/one long forecast-fixture scenario is still an expected failure/);
    expect(readme).toMatch(/real fires are often faster than any model/);
  });

  it('the glossary explains the technical words the card uses', () => {
    const card = describeModel({ scenario: fastScenario, engine: null, settings } satisfies ModelCardInput);
    const text = cardToText(card).toLowerCase();
    const terms = GLOSSARY.map((g) => g.term.toLowerCase()).join(' | ');
    for (const word of ['level set', 'cfl', 'parameterised', 'resolved', 'empirical', 'mass-consistent', 'boussinesq', 'terrain-following', 'nudging', 'lagrangian', 'coupling', 'checkpoint', 'seed', 'data assimilation', 'upper air', 'tier', 'indraft']) {
      if (text.includes(word)) expect(terms, word).toContain(word);
    }
  });
});
