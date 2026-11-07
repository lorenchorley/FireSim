// Step 3: print the README tables from data/summary.json (plain node, no dependencies):  node studies/adaptive-simulation-quality/scripts/03_tables.mjs
// Writes the same text to data/tables.md.
import { readFileSync, writeFileSync } from 'node:fs';

const DATA = new URL('../data/', import.meta.url).pathname;
const all = JSON.parse(readFileSync(`${DATA}summary.json`, 'utf8'));
const SITES = ['katoomba', 'grose', 'tomah', 'kanangra', 'thredbo', 'gospers', 'budawangs', 'barrington', 'warrumbungles'].filter((s) => all[s]);
const DETAIL = ['katoomba', 'grose'].filter((s) => all[s]);
const pct = (x, d = 0) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)} %`);
const num = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x).toLocaleString('en-AU').replace(/,/g, ' '));
const x2 = (x) => (x === null || x === undefined ? 'n/a' : `${x.toFixed(x < 10 ? 2 : 1)}`);
const out = [];
const table = (head, rows) => {
  out.push(`| ${head.join(' | ')} |`);
  out.push(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  out.push('');
};
const h = (t) => out.push(`**${t}**`, '');

h('T1. Terrain: how complex is each 6 km domain (30 m cells, 200 x 200 = 40 000 cells)');
table(
  ['Site', 'Cells that can burn', 'Steep-gate cells (slope30 >= 15 deg)', 'Mean complexity', 'Complexity >= 0.4', 'Complexity >= 0.6', 'Top-20 % cells inside the steep gate', 'Cells with a group at >= 0.5: S / C / G / L / R'],
  SITES.map((s) => {
    const t = all[s].terrain;
    const g = t.groupShareAtLeastHalf;
    return [all[s].name.split(' – ')[0], pct(t.flammableShare), pct(t.steepGateShare), t.complexityMeanOfCells.toFixed(2), pct(t.complexityAbove['0.4']), pct(t.complexityAbove['0.6']), pct(t.topSetsOverlap.top20ShareInSteepGate), ['S', 'C', 'G', 'L', 'R'].map((k) => pct(g[k])).join(' / ')];
  }),
);

h('T2. The standard run: how much of the domain the front reached, and what changed regime');
table(
  ['Site', 'Reached by 2 h', 'by 4 h', 'by 8 h', 'Homes in domain', 'Homes with burnt ground within 100 m by 4 h / 8 h', 'Junction boost / eruptive A.E / VLS zone / wind-change passage (cells, % of domain)'],
  SITES.map((s) => {
    const im = all[s].importance;
    const r = im.reached;
    const hm = im.homes;
    const rg = im.regime;
    const c = (k) => `${num(rg.cells[k])} (${pct(rg.shareOfDomain[k], 1)})`;
    return [all[s].name.split(' – ')[0], pct(r['2h'].shareOfDomain), pct(r['4h'].shareOfDomain), pct(r['8h'].shareOfDomain), num(hm.inDomain), hm.inDomain ? `${num(hm.within100m['4h'])} / ${num(hm.within100m['8h'])}` : 'no homes', [c('junction'), c('eruptive'), c('vls'), c('windChange')].join(' / ')];
  }),
);

h('T3. The key number: what share of the most complex cells does the front ever reach (reached = flammable and burnt within the window; of the whole set)');
table(
  ['Site', 'Top 10 %: can burn', 'by 4 h', 'by 8 h', 'Top 20 %: can burn', 'by 2 h', 'by 4 h', 'by 8 h', 'Top 30 %: can burn', 'by 4 h', 'by 8 h'],
  SITES.map((s) => {
    const [a, b, c] = all[s].staticSets;
    return [all[s].name.split(' – ')[0], pct(a.flammableShare), pct(a.reachedBy4h), pct(a.reachedBy8h), pct(b.flammableShare), pct(b.reachedBy2h), pct(b.reachedBy4h), pct(b.reachedBy8h), pct(c.flammableShare), pct(c.reachedBy4h), pct(c.reachedBy8h)];
  }),
);

h('T4. The front band: share of the domain inside it, and share of the band that is also in the top 20 % of complexity (mean over the run window 0 to 4 h / 0 to 8 h)');
table(
  ['Site', 'Band 4 cells (0 to 4 h / 0 to 8 h)', 'Band 10 cells', 'Band 20 cells', 'Band 10 and top 20 % (mean)', 'Band 10: share that is top 20 %', 'Cells ever in the 10-cell band', 'Top-20 % refined all run: share of it that is near the front'],
  SITES.map((s) => {
    const b = all[s].bands;
    const w = (k, hr) => b[k][`window${hr}h`];
    const pair = (k) => `${pct(w(k, 4).shareOfCellsMean, 1)} / ${pct(w(k, 8).shareOfCellsMean, 1)}`;
    return [all[s].name.split(' – ')[0], pair('ahead4'), pair('ahead10'), pair('ahead20'), `${pct(w('ahead10', 4).andTop20ShareOfCellsMean, 1)} / ${pct(w('ahead10', 8).andTop20ShareOfCellsMean, 1)}`, pct(w('ahead10', 8).shareOfBandThatIsTop20), pct(b.ahead10.union.shareOfCells), pct(b.ahead10.staticTop20Utilisation)];
  }),
);

for (const s of DETAIL) {
  const d = all[s];
  const c = d.cost;
  const N = d.terrain.cells;
  h(`T5 (${d.name.split(' – ')[0]}). Cost of each refinement rule in CELLS and in CELL-STEPS per simulated hour (assumed: 1 per cell-step, sub-step proportional to the cell size; ${num(c.assumptions.steps30PerSimHour)} sub-steps per hour at 30 m, measured in the run; dense accounting)`);
  const rows = [];
  const u = (k, label) => rows.push([label, '', num(c[k].cells), '', x2(c[k].cellStepsPerHM), `${x2(c[k].vsUniform30)}`, '']);
  u('uniform30', 'Uniform 30 m (today)');
  u('uniform20', 'Uniform 20 m');
  u('uniform10', 'Uniform 10 m');
  const lineStatic = (p, label) => {
    const ss = d.staticSets.find((x) => Math.abs(x.topShare - p) < 1e-9);
    const st = c.static[`top${Math.round(p * 100)}pct`];
    for (const r of ['20', '10']) rows.push([`${label} refined to ${r} m`, `${pct(ss.shareOfCells)} of cells, ${num(ss.areaHa)} ha`, num(st[`to${r}m`].cells), pct(st[`to${r}m`].cellsVsUniform), x2(st[`to${r}m`].cellStepsPerHM_localDt), x2(st[`to${r}m`].vsUniform30_localDt), `${pct(ss.reachedBy4h)} by 4 h, ${pct(ss.reachedBy8h)} by 8 h`]);
  };
  lineStatic(0.1, 'Static: top 10 % complexity');
  lineStatic(0.2, 'Static: top 20 % complexity');
  lineStatic(0.3, 'Static: top 30 % complexity');
  const lineBand = (key, label, which) => {
    const b = d.bands[key];
    const dyn = c.dynamic[key];
    const m = which === 'top' ? 'andTop20Mean' : 'liveMean';
    const win = b.window8h;
    const live = which === 'top' ? win.andTop20Mean : win.liveMean;
    const liveMax = which === 'top' ? win.andTop20Max : win.liveMax;
    for (const r of ['20', '10']) rows.push([`${label} refined to ${r} m`, `mean ${pct(live / N, 1)} (max ${pct(liveMax / N, 1)}) of cells`, num(dyn[m][`to${r}m`].cells), pct(dyn[m][`to${r}m`].cellsVsUniform), x2(dyn[m][`to${r}m`].cellStepsPerHM_localDt), x2(dyn[m][`to${r}m`].vsUniform30_localDt), `${pct(b.union.shareOfUnionReached)} of cells ever in the band burn`]);
  };
  lineBand('ahead4', 'Front band 4 cells (live, mean)', 'all');
  lineBand('ahead10', 'Front band 10 cells (live, mean)', 'all');
  lineBand('ahead20', 'Front band 20 cells (live, mean)', 'all');
  lineBand('ahead10', 'Front band 10 cells and top 20 % complexity (live, mean)', 'top');
  lineBand('ahead4', 'Front band 4 cells and top 20 % complexity (live, mean)', 'top');
  table(['Rule', 'Refined share (8 h window)', 'Cells in total', 'Cells vs uniform fine', 'Cell-steps per hour (millions)', 'Cell-steps vs uniform 30 m', 'What the front reaches'], rows);
}

h('T5b. The fire solver as it is today is already limited to a narrow band at the front, so its cost follows the front. Cost of finer cells for the BAND only, relative to today (band-cell-steps; 1.00 = today at 30 m). f = share of the 4-cell band that lies in the top 20 % of complexity (mean over the 8 h run). Uniform: band cells grow as 30/r and sub-steps as 30/r. Adaptive: only the complex part of the band is refined; with local time stepping the coarse part keeps its step, with one global step every front cell pays the finer step.');
table(
  ['Site', 'f', 'Uniform 20 m', 'Adaptive to 20 m, local step', 'Adaptive to 20 m, global step', 'Uniform 10 m', 'Adaptive to 10 m, local step', 'Adaptive to 10 m, global step'],
  SITES.map((s) => {
    const f = all[s].bands.ahead4.window8h.shareOfBandThatIsTop20;
    const row = [all[s].name.split(' – ')[0], f.toFixed(2)];
    for (const r of [20, 10]) {
      const k = 30 / r;
      row.push(x2(k * k), x2(1 + (k * k - 1) * f), x2(k * (1 - f + f * k)));
    }
    return row;
  }),
);

h('T6. The air grid: share of the air columns within D of the front (mean over 0 to 2 h / 0 to 4 h / 0 to 8 h; max over the run; share ever within D); columns of 133 m (the run\'s own grid), 150 and 200 m behave the same, see data/summary.json');
table(
  ['Site', 'D = 500 m', 'D = 1 km', 'D = 2 km'],
  SITES.map((s) => {
    const a = all[s].air_;
    const f = (D) => {
      const r = a[`133.33_${D}`];
      return `${pct(r.within2hMeanShare)} / ${pct(r.within4hMeanShare)} / ${pct(r.withinMeanShare)}; max ${pct(r.withinMaxShare)}; ever ${pct(r.unionShareOverRun)}`;
    };
    return [all[s].name.split(' – ')[0], f(500), f(1000), f(2000)];
  }),
);

h('T7. Does complexity point at where the code\'s regimes fire? Cells flagged inside the top 20 % vs outside, over the cells the front reached (lift = rate inside / rate outside; n/a = none on one side)');
table(
  ['Site', 'VLS zone: in / out of set (lift)', 'Eruptive A.E: in / out (lift)', 'Junction: in / out (lift)', 'Wind-change passage: in / out (lift)', 'Any regime flag: in / out (lift)'],
  SITES.map((s) => {
    const r = all[s].importance.regime.inTop20ReachedOnly;
    const f = (k) => `${num(r[k].inSet)} / ${num(r[k].outOfSet)} (${r[k].lift === null ? 'n/a' : r[k].lift.toFixed(1)})`;
    return [all[s].name.split(' – ')[0], f('vls'), f('eruptive'), f('junction'), f('windChange'), f('any')];
  }),
);

h('T9. How much the answer depends on the definition of complexity: the top 20 % by each alternative score (a group that is zero over most of the domain gives a set smaller than 20 %)');
{
  const rows = [];
  const names = { mean: 'Mean of the five groups (the definition used)', max: 'Max of the five', meanNoLandform: 'Mean without landform L', steepnessS: 'Steepness S alone', cliffC: 'Cliff C alone', gullyG: 'Gully G alone', landformL: 'Landform L alone', reliefR: '10 m relief R alone' };
  for (const s of DETAIL) {
    for (const [k, label] of Object.entries(names)) {
      const d = all[s].definitions[k];
      rows.push([all[s].name.split(' – ')[0], label, pct(d.shareOfCells), d.jaccardWithMean.toFixed(2), pct(d.flammableShare), pct(d.reachedBy4h), pct(d.reachedBy8h), pct(d.band10MeanShareOfCells, 1)]);
    }
  }
  table(['Site', 'Definition', 'Set, share of cells', 'Overlap with the mean-score set (Jaccard)', 'Can burn', 'Reached by 4 h', 'by 8 h', 'In the 10-cell band, mean share of domain'], rows);
}

const variants = Object.keys(all).filter((k) => k.includes('.'));
if (variants.length) {
  h('T8. One scenario per site: how the sizing numbers move with the scenario (Katoomba and Blackheath; ign-sw and ign-e = ignition south-west or east, mild and catastrophic = the other weather presets, wide = the whole 9 km area, std3d = the Standard tier)');
  const rows = [];
  for (const site of DETAIL) {
    for (const k of [site, ...variants.filter((v) => v.startsWith(`${site}.`))]) {
      const d = all[k];
      const b = d.staticSets[1];
      const w = d.bands.ahead10;
      const share = (id) => (d.modulesEnd ?? []).find((m) => m.id === id)?.share;
      rows.push([k.replace(/^grose/, 'blackheath').replace('.', ' / '), `${d.terrain.cells / 1000}k cells`, pct(d.importance.reachedEver.shareOfDomain), pct(b.reachedBy2h), pct(b.reachedBy4h), pct(b.reachedBy8h), pct(w.window8h.shareOfCellsMean, 1), pct(w.window8h.andTop20ShareOfCellsMean, 1), pct(d.air_['133.33_1000'].withinMeanShare), num(d.importance.regime.cells.junction), `${pct(share('air'))} / ${pct(share('fire'))}`]);
    }
  }
  table(['Scenario', 'Domain', 'Domain reached by 8 h', 'Top-20 % reached by 2 h', 'by 4 h', 'by 8 h', 'Band 10 share of domain (mean)', 'Band 10 and top 20 % (mean)', 'Air columns within 1 km (mean)', 'Junction-boost cells', 'Air / fire share of the step (measured here)'], rows);
}

const text = out.join('\n');
writeFileSync(`${DATA}tables.md`, text + '\n');
process.stdout.write(text + '\n');
