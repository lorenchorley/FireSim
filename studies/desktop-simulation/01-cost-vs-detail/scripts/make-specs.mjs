// Writes specs.json: the whole row matrix of study 01 (one fixed scenario per site; rows differ only in the knob named by the id).
//   node make-specs.mjs > specs.json
//
// Katoomba (6 km and 9 km): preset hot-nw-sw-change from 14:00 on 2025-12-20 (the V20 scenario of src/sim/validation/system.test.ts),
// point ignition at (-2170, 900) m, radius 60 m, seed 1, embers on. Warrumbungles: same preset and start, ignition (-1500, 1000) m.
const KAT = { site: 'katoomba', ignition: { x: -2170, y: 900, radius: 60 } };
const WAR = { site: 'warrumbungles', ignition: { x: -1500, y: 1000, radius: 60 } };
const H4 = 4 * 3600;
const H2 = 2 * 3600;
const row = (id, o) => ({ id, embers: true, tier: 'fast', cell: 30, extent: 6000, windowS: H4, chunkS: 300, hook: 'last', maxWallS: 540, ...o });

const rows = [
  // 1. fire cell size, fast tier (Katoomba 6 km, 4 h). The 15 m row needs a 5 m DEM grid (see launch.mjs).
  row('L30', { ...KAT, summary: true, chunkS: 300 }),
  row('L20', { ...KAT, cell: 20, summary: true }),
  row('L10', { ...KAT, cell: 10, summary: true }),
  row('L15', { ...KAT, cell: 15, hiResCellM: 5, summary: true }),
  // 4. air tiers, with the fire (30 m) and alone (no ignition)
  row('A-std30', { ...KAT, tier: 'standard' }),
  row('A-high30', { ...KAT, tier: 'high' }),
  row('AA-fast', { ...KAT, ignition: null, windowS: H2 }),
  row('AA-std', { ...KAT, ignition: null, tier: 'standard', windowS: H2 }),
  row('AA-high', { ...KAT, ignition: null, tier: 'high', windowS: H2 }),
  // noise: the cheapest row twice more
  row('L30-r2', { ...KAT }),
  row('L30-r3', { ...KAT }),
  // 3. embers: off, and the cap raised (the default fast cap is 2000)
  row('E-off', { ...KAT, embers: false }),
  row('E-8000', { ...KAT, maxEmbers: 8000 }),
  row('E-32000', { ...KAT, maxEmbers: 32000 }),
  // 2. step and cadence: the user's solver step limit (default: automatic = 10 s fast), the display step, and no snapshots at all
  row('T-step5', { ...KAT, maxStepS: 5 }),
  row('T-step2', { ...KAT, maxStepS: 2 }),
  row('T-step5-c20', { ...KAT, cell: 20, maxStepS: 5 }),
  row('N-nosnap', { ...KAT, hook: 'none' }),
  row('N-display10', { ...KAT, snapshotInterval: 10 }),
  // 4 (cont.) the 3-D tiers with 20 m cells (High = the app's High detail: 20 m cells and the 100 m air)
  row('A-std20', { ...KAT, tier: 'standard', cell: 20 }),
  row('A-high20', { ...KAT, tier: 'high', cell: 20, buildTier: 'high' }),
  // 6. determinism: same seed twice (two processes), other chunking, other seed (control)
  row('D-fast-a', { ...KAT, hook: 'hash', chunkS: 300 }),
  row('D-fast-b', { ...KAT, hook: 'hash', chunkS: 300 }),
  row('D-fast-chunk60', { ...KAT, hook: 'hash', chunkS: 60 }),
  row('D-fast-seed2', { ...KAT, hook: 'hash', seed: 2 }),
  row('D-std-a', { ...KAT, tier: 'standard', hook: 'hash', windowS: H2 }),
  row('D-std-b', { ...KAT, tier: 'standard', hook: 'hash', windowS: H2 }),
  // 5. where the time goes: V8 CPU profiles of the advance loop (slower than an unprofiled row; use the module laps for shares)
  row('P-fast30', { ...KAT, cpuProfile: 'P-fast30.cpuprofile' }),
  row('P-std30', { ...KAT, tier: 'standard', windowS: H2, cpuProfile: 'P-std30.cpuprofile' }),
  // a second site: Warrumbungles 6 km (grass woodland), 2 h
  row('W30', { ...WAR, windowS: H2, summary: true }),
  row('W20', { ...WAR, windowS: H2, cell: 20, summary: true }),
  row('W10', { ...WAR, windowS: H2, cell: 10, summary: true }),
  row('W-std30', { ...WAR, windowS: H2, tier: 'standard' }),
  // the history the app keeps (150 MB budget), with the same runs
  row('H-fast30', { ...KAT, hook: 'store' }),
  row('H-fast20', { ...KAT, cell: 20, hook: 'store' }),
  row('H-fast10', { ...KAT, cell: 10, hook: 'store' }),
  row('H-std30', { ...KAT, tier: 'standard', hook: 'store' }),
  // Katoomba 9 km (the extent of the bundled terrain): 4 h at 30 m, 20 m; 2 h at 10 m
  row('X30', { ...KAT, extent: 9000 }),
  row('X20', { ...KAT, extent: 9000, cell: 20 }),
  row('X-std30', { ...KAT, extent: 9000, tier: 'standard' }),
  row('X10', { ...KAT, extent: 9000, cell: 10, windowS: H2, maxWallS: 700 }),
  // noise: the most expensive fast row twice more
  row('L10-r2', { ...KAT, cell: 10 }),
  row('L10-r3', { ...KAT, cell: 10 }),
  // added after the first rows showed that the ember random draws move the burnt area by tens of per cent (embers off: 1002 ha,
  // cap 2000: 2483 ha, cap 8000: 2032 ha, cap 32000: 2933 ha at 4 h): the same ladders and step rows WITHOUT embers, so that the
  // differences between rows are the numerics of the fire front and the air only
  row('LN30', { ...KAT, embers: false, summary: true }),
  row('LN20', { ...KAT, embers: false, cell: 20, summary: true }),
  row('LN15', { ...KAT, embers: false, cell: 15, hiResCellM: 5, summary: true }),
  row('LN10', { ...KAT, embers: false, cell: 10, summary: true }),
  row('NT-step5', { ...KAT, embers: false, maxStepS: 5, summary: true }),
  row('NT-step2', { ...KAT, embers: false, maxStepS: 2, summary: true }),
  // a profile at 10 m (fireHeat grew faster than the cell count in the ladder: which function is it?), 2 h
  row('P-fast10', { ...KAT, cell: 10, windowS: H2, cpuProfile: 'P-fast10.cpuprofile' }),
  // the richest combinations: 10 m fire cells with the 3-D air (2 h)
  row('A-std10', { ...KAT, tier: 'standard', cell: 10, windowS: H2 }),
  row('A-high10', { ...KAT, tier: 'high', cell: 10, buildTier: 'high', windowS: H2 }),
  row('WN30', { ...WAR, embers: false, windowS: H2, summary: true }),
  row('WN20', { ...WAR, embers: false, windowS: H2, cell: 20, summary: true }),
  row('WN10', { ...WAR, embers: false, windowS: H2, cell: 10, summary: true }),
];
console.log(JSON.stringify(rows, null, 1));
