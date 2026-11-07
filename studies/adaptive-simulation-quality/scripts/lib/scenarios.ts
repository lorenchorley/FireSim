/**
 * The scenarios of the study. `std` is THE standard scenario (the same for every site; all headline numbers). The others vary one thing
 * each on Katoomba and Grose only, to show how much the sizing numbers depend on the one scenario per site (README, caveats).
 * The ignition is the flammable cell with slope30 < 10 deg nearest to `ignitionTarget` (metres east, north of the domain centre).
 */
export interface Scn {
  id: string;
  preset: 'hot-nw-sw-change' | 'mild-spring-hr' | 'catastrophic-black-summer' | 'calm-night-katabatic';
  ignitionTarget: [number, number];
  /** Domain side (m); default 6000. */
  extent?: number;
  /** Simulation tier; default 'fast'. */
  tier?: 'fast' | 'standard';
  note: string;
}

export const SCENARIOS: Record<string, Scn> = {
  std: { id: 'std', preset: 'hot-nw-sw-change', ignitionTarget: [-1500, 1500], note: 'standard: hot NW wind then a SW change, ignition NW of the centre' },
  'ign-sw': { id: 'ign-sw', preset: 'hot-nw-sw-change', ignitionTarget: [-1500, -1500], note: 'same weather, ignition SW of the centre (the fire runs along the domain, not across it)' },
  'ign-e': { id: 'ign-e', preset: 'hot-nw-sw-change', ignitionTarget: [1500, 0], note: 'same weather, ignition east of the centre (the fire starts downwind and backs, then the SW change turns the flank)' },
  mild: { id: 'mild', preset: 'mild-spring-hr', ignitionTarget: [-1500, 1500], note: 'mild spring day, same ignition as std' },
  wide: { id: 'wide', preset: 'hot-nw-sw-change', ignitionTarget: [-1500, 1500], extent: 9000, note: 'std in the whole bundled 9 km area (300 x 300 cells of 30 m, air columns of 200 m)' },
  std3d: { id: 'std3d', preset: 'hot-nw-sw-change', ignitionTarget: [-1500, 1500], tier: 'standard', note: 'std on the Standard tier (3-D air; the pyrogenic wind is off there, so the junction boost of the level set can fire)' },
  catastrophic: { id: 'catastrophic', preset: 'catastrophic-black-summer', ignitionTarget: [-1500, 1500], note: 'catastrophic day, same ignition as std' },
};

export const fieldsFile = (workDir: string, site: string, scn: string): string => `${workDir}${site}${scn === 'std' ? '' : '.' + scn}.fields.gz`;
