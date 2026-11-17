/**
 * The named scenarios of the option B prototype (stage 3a). One table, read by export.ts. Everything the C# side needs to know about a
 * scenario is in the fixture's meta.json; this file is the source of those numbers.
 */
export interface ScenarioDef {
  name: string;
  description: string;
  /** Demo site id (`public/demo/<site>`); default 'katoomba'. */
  site?: string;
  /** Side of the domain (m). */
  extent: number;
  tier: 'fast' | 'standard' | 'high';
  seed: number;
  /** Civil (Australia/Sydney) start: [y, m, d, h]. */
  startCivil: [number, number, number, number];
  /** Scenario duration (s); the run stops earlier, at `runTo`. */
  duration: number;
  /** Seconds of fire to run. */
  runTo: number;
  /** Seconds between snapshots. */
  snapshotInterval: number;
  ignition: { kind: 'line'; id: string; from: [number, number]; to: [number, number]; time: number } | { kind: 'point'; id: string; at: [number, number]; radius: number; time: number };
  /**
   * 'tier-only': the scenario is built at the standard 30 m fire grid and only the engine's tier options (air grid, levels, first level,
   * ember cap) are those of `tier`. Without it the builder's own rules apply (the high tier builds 20 m fire cells up to 6 km).
   */
  grid?: 'builder' | 'tier-only';
  /** Extra engine options (the study's no-embers variants set `embers: false` to see how much of the seed noise is the ember model). */
  options?: { embers?: boolean };
  /** Published hashes the run must reproduce (time:hash), when the scenario is a regression anchor. */
  expectedHashes?: string;
}

const LINE = { kind: 'line', id: 'line310', from: [-570, -450], to: [-350, -230], time: 0 } as const;
const K = { startCivil: [2025, 12, 20, 12], duration: 3600, snapshotInterval: 60, runTo: 1800, seed: 11 } as const;

/**
 * The 4 h scenarios of stage 3 (T3.1a), all on the preset `hot-nw-sw-change` (demoScenario's default; the south-westerly change is at 15:00 local
 * mean solar time). They start at 14:00 civil (Sydney, AEDT), the start of the V20 scenario (`src/sim/validation/system.test.ts`) and of the
 * §15e desktop measurement, so that the change arrives about 2 h in (Katoomba, longitude 150.285: 15:00 LMST is 15:59 AEDT, 1 h 59 min after the
 * start; the Warrumbungles, longitude 149.02: 16:04 AEDT, 2 h 4 min) and the 4 h window holds the whole change. From 12:00, the start of the 3a scenarios, the change would come at 4 h, the
 * very end of the window. Snapshots every 300 s: 900, 1,800, 3,600, 7,200 and 14,400 s are all on the cadence, 48 pictures (about 115 MB for
 * katoomba6-fast-4h), and the time of first divergence of two runs is resolved to 5 min.
 */
const LONG = { startCivil: [2025, 12, 20, 14], duration: 14400, runTo: 14400, snapshotInterval: 300, seed: 11 } as const;
/** The Warrumbungles ignition of the §15e measurement (studies/desktop-simulation/01-cost-vs-detail: point (-1500, 1000), radius 60 m). */
const WARRUM = { kind: 'point', id: 'war-point', at: [-1500, 1000], radius: 60, time: 0 } as const;

const DEFS: ScenarioDef[] = [
  { name: 'katoomba3-fast', description: 'Katoomba demo site, 3 km, fast tier, seed 11, 310 m ignition line at t=0, civil start 2025-12-20 12:00, run to 1800 s', extent: 3000, tier: 'fast', ignition: LINE, ...K },
  { name: 'katoomba6-fast', description: 'Katoomba demo site, 6 km, fast tier, seed 11, 310 m ignition line at t=0, civil start 2025-12-20 12:00, run to 1800 s', extent: 6000, tier: 'fast', ignition: LINE, ...K },
  { name: 'katoomba3-standard', description: 'Katoomba demo site, 3 km, standard tier (3-D atmosphere), seed 11, 310 m ignition line at t=0, run to 1800 s', extent: 3000, tier: 'standard', ignition: LINE, ...K },
  { name: 'katoomba3-high', description: 'Katoomba demo site, 3 km, high tier as the builder makes it (20 m fire cells, 100 m air cells, 24 levels), seed 11, 310 m ignition line at t=0, run to 1800 s', extent: 3000, tier: 'high', ignition: LINE, ...K },
  { name: 'katoomba3-high30', description: 'Katoomba demo site, 3 km, high tier engine options on the standard 30 m fire grid (isolates the air model from the grid change), seed 11, 310 m ignition line, run to 1800 s', extent: 3000, tier: 'high', grid: 'tier-only', ignition: LINE, ...K },
  { name: 'katoomba3-fast-noembers', description: 'katoomba3-fast with the ember model switched off (option embers=false): the study of how much of the seed-to-seed noise is spotting', extent: 3000, tier: 'fast', options: { embers: false }, ignition: LINE, ...K },
  { name: 'katoomba3-standard-noembers', description: 'katoomba3-standard with the ember model switched off (option embers=false)', extent: 3000, tier: 'standard', options: { embers: false }, ignition: LINE, ...K },
  { name: 'katoomba3-high-noembers', description: 'katoomba3-high (20 m fire cells) with the ember model switched off', extent: 3000, tier: 'high', options: { embers: false }, ignition: LINE, ...K },
  { name: 'katoomba3-high30-noembers', description: 'katoomba3-high30 (high tier options on the 30 m fire grid) with the ember model switched off', extent: 3000, tier: 'high', grid: 'tier-only', options: { embers: false }, ignition: LINE, ...K },
  {
    name: 'katoomba3-point',
    description: 'Katoomba demo site, 3 km, fast tier, seed 11, point ignition (-800,300) radius 60 at t=0 (the scenario of src/sim/desktopDetail.determinism.test.ts), civil start 2025-12-20 14:00, run to 900 s',
    extent: 3000,
    tier: 'fast',
    seed: 11,
    startCivil: [2025, 12, 20, 14],
    duration: 3600,
    runTo: 900,
    snapshotInterval: 60,
    ignition: { kind: 'point', id: 'escarpment', at: [-800, 300], radius: 60, time: 0 },
  },
  {
    name: 'anchor-080-katoomba6-point',
    description:
      'Regression anchor, not a stage 3 scenario: the 0.8.0 run of src/sim/desktopDetail.determinism.test.ts (Katoomba 6 km, fast, seed 11, point (-2170,900) radius 60, civil start 14:00, to 900 s). Its hashes must equal the published ones, which proves this exporter drives the solver the way the app does.',
    extent: 6000,
    tier: 'fast',
    seed: 11,
    startCivil: [2025, 12, 20, 14],
    duration: 3600,
    runTo: 900,
    snapshotInterval: 60,
    ignition: { kind: 'point', id: 'escarpment', at: [-2170, 900], radius: 60, time: 0 },
    expectedHashes:
      '60:1084538110 120:3498841198 180:1526728740 240:1652064113 300:3663678893 360:3575792216 420:2912366359 480:3708820897 540:3981135305 600:4269165313 660:1265999462 720:2911373612 780:3197235222 840:3229478989 900:3943397813',
  },
  {
    name: 'katoomba6-fast-4h',
    description: 'Katoomba demo site, 6 km, fast tier, seed 11, 310 m ignition line at t=0, preset hot-nw-sw-change, civil start 2025-12-20 14:00 (the change comes about 2 h in), 4 h, snapshots every 300 s',
    extent: 6000,
    tier: 'fast',
    ignition: LINE,
    ...LONG,
  },
  {
    name: 'katoomba3-standard-4h',
    description: 'Katoomba demo site, 3 km, standard tier (3-D atmosphere), seed 11, 310 m ignition line at t=0, preset hot-nw-sw-change, civil start 2025-12-20 14:00, 4 h, snapshots every 300 s',
    extent: 3000,
    tier: 'standard',
    ignition: LINE,
    ...LONG,
  },
  {
    name: 'warrumbungles6-fast-4h',
    description: 'Warrumbungles demo site, 6 km, fast tier, seed 11, point ignition (-1500,1000) radius 60 at t=0 (the ignition of the 15e desktop measurement), preset hot-nw-sw-change, civil start 2025-12-20 14:00, 4 h, snapshots every 300 s',
    site: 'warrumbungles',
    extent: 6000,
    tier: 'fast',
    ignition: WARRUM,
    ...LONG,
  },
  {
    name: 'katoomba6-fast-4h-noembers',
    description: 'katoomba6-fast-4h with the ember model switched off (option embers=false)',
    extent: 6000,
    tier: 'fast',
    options: { embers: false },
    ignition: LINE,
    ...LONG,
  },
  {
    name: 'katoomba3-standard-4h-noembers',
    description: 'katoomba3-standard-4h with the ember model switched off (option embers=false)',
    extent: 3000,
    tier: 'standard',
    options: { embers: false },
    ignition: LINE,
    ...LONG,
  },
];

export const SCENARIOS: readonly ScenarioDef[] = DEFS;
export const scenarioByName = (n: string): ScenarioDef | undefined => DEFS.find((d) => d.name === n);
