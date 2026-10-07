import type { LatLon } from '../core/geo';

/** Bundled demonstration sites in the mountainous regions of NSW (terrain is shipped with the app for offline use). */
export interface DemoSite {
  id: string;
  name: string;
  region: string;
  centre: LatLon;
  /** Short description of why the site is instructive. */
  teaching: string;
}

export const DEMO_SITES: DemoSite[] = [
  {
    id: 'katoomba',
    name: 'Katoomba – Narrow Neck & Megalong escarpment',
    region: 'Blue Mountains',
    centre: { lat: -33.715, lon: 150.285 },
    teaching: 'Sandstone plateau with 300 m cliffs dropping into the Megalong and Jamison valleys: ridge-top heath, wet gullies, lee-slope spotting.',
  },
  {
    id: 'grose',
    name: 'Blackheath – Grose Valley',
    region: 'Blue Mountains',
    centre: { lat: -33.62, lon: 150.33 },
    teaching: 'Deep gorge with steep north- and south-facing walls: aspect-driven fuel moisture, valley wind channelling, cross-valley spotting.',
  },
  {
    id: 'tomah',
    name: 'Mount Tomah',
    region: 'Blue Mountains',
    centre: { lat: -33.53, lon: 150.425 },
    teaching: 'Basalt-capped ridge on Bells Line of Road: tall wet forest on the high ground, rainforest in the steep gullies, dry forest and heath on the rest, all inside the 2019/20 Gospers Mountain fire perimeter.',
  },
  {
    id: 'kanangra',
    name: 'Kanangra Walls',
    region: 'Kanangra-Boyd',
    centre: { lat: -33.99, lon: 150.12 },
    teaching: 'Plateau edges and deep dissected valleys: fire running up gullies and chutes, lateral spread on lee slopes.',
  },
  {
    id: 'thredbo',
    name: 'Thredbo Valley',
    region: 'Snowy Mountains',
    centre: { lat: -36.5, lon: 148.3 },
    teaching: 'Long alpine valley: katabatic drainage winds at night, thermal belts, grass/heath above snow-gum woodland.',
  },
  {
    id: 'gospers',
    name: 'Gospers Mountain',
    region: 'Wollemi',
    centre: { lat: -32.98, lon: 150.6 },
    teaching: 'Remote dissected sandstone country where the 2019 Gospers Mountain mega-fire started.',
  },
  {
    id: 'budawangs',
    name: 'Pigeon House Mountain',
    region: 'Budawangs',
    centre: { lat: -35.35, lon: 150.27 },
    teaching: 'Isolated peak and escarpment: ridge speed-up, saddles, downslope winds on the coastal fall.',
  },
  {
    id: 'barrington',
    name: 'Barrington Tops escarpment',
    region: 'Barrington Tops',
    centre: { lat: -32.06, lon: 151.47 },
    teaching: 'High plateau with wet forest and steep escarpment slopes: moist gullies that stop fires and dry ridges that carry them.',
  },
  {
    id: 'warrumbungles',
    name: 'Warrumbungle Range',
    region: 'Warrumbungles',
    centre: { lat: -31.28, lon: 149.02 },
    teaching: 'Volcanic spires and grassy woodland valleys (2013 Wambelong fire): fast grass runs, chimneys, pyroconvection.',
  },
];

/** Side length (m) of terrain bundled for each demo site. */
export const DEMO_EXTENT_M = 9000;
/** Zoom level of bundled Terrarium tiles (~16 m/pixel at NSW latitudes; source data is SRTM 1″ ≈ 30 m). */
export const DEMO_TILE_ZOOM = 13;
