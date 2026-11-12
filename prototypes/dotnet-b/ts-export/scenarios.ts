/**
 * The named scenarios of the option B prototype (stage 3a). One table, read by export.ts. Everything the C# side needs to know about a
 * scenario is in the fixture's meta.json; this file is the source of those numbers.
 */
export interface ScenarioDef {
  name: string;
  description: string;
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
];

export const SCENARIOS: readonly ScenarioDef[] = DEFS;
export const scenarioByName = (n: string): ScenarioDef | undefined => DEFS.find((d) => d.name === n);
