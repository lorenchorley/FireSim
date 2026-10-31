/**
 * "Colour the map by speed" (0.7.0, E1b): the rules of the chip, in node (the DOM of the chip is checked in e2e/wind-map.spec.ts). The chip reads and
 * writes the heat map `overlay` and nothing else, is pressed exactly while the Wind speed map is the heat map, needs what the Wind speed row needs, and
 * the one Wind height rule is the same for the view, the legend and the Layers panel.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYER_CATALOG, availabilityContext, layerById } from '../../../render/layerCatalog';
import { DEFAULT_LAYERS } from '../../../render/layers';
import { WIND_HEIGHTS } from '../../../render/wind/glyphTypes';
import { heightLabel } from './glyphWords';
import { MAP_CHIP_LABEL, mapHeightNow, mapNoDataNow, windMapChipState, windMapPatch, windMapReasonLine, windSpeedSubline } from './windMapWords';

const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

describe('the chip', () => {
  it('is called "Colour the map by speed", in sentence case, with no dash', () => {
    expect(MAP_CHIP_LABEL).toBe('Colour the map by speed');
    expect(MAP_CHIP_LABEL).not.toMatch(/[—–]/);
  });

  it('writes the heat map key and nothing else: on is the Wind speed map, off is no heat map', () => {
    expect(windMapPatch(true)).toEqual({ overlay: 'windSpeed' });
    expect(windMapPatch(false)).toEqual({ overlay: 'none' });
    expect(Object.keys(windMapPatch(true))).toEqual(['overlay']);
  });

  it('is pressed exactly while the Wind speed map is the heat map, whatever else is shown', () => {
    for (const overlay of ['none', 'slope', 'arrival', 'moisture', 'elevation'] as const) expect(windMapChipState(overlay, { ok: true }).pressed, overlay).toBe(false);
    expect(windMapChipState('windSpeed', { ok: true }).pressed).toBe(true);
  });

  it('needs what the Wind speed row needs: greyed with the row’s own reason when there is no fire, operable once it is on', () => {
    const row = layerById('windSpeed')!;
    const noFire = row.available({ ...availabilityContext({ fire: false }), hasAirWind: true }); // (an air picture with a wind, no fire marked yet)
    expect(noFire.ok).toBe(false);
    const st = windMapChipState('none', noFire);
    expect(st).toEqual({ pressed: false, disabled: true, reason: noFire.reason! });
    expect(st.reason).toBe('Needs a fire: mark one first');
    // A chip that is on stays operable so it can always be turned off, even if the fire goes (a new run).
    expect(windMapChipState('windSpeed', noFire)).toEqual({ pressed: true, disabled: false, reason: noFire.reason! });
    expect(windMapChipState('none', { ok: true })).toEqual({ pressed: false, disabled: false, reason: '' });
    expect(windMapChipState('none', { ok: false })).toMatchObject({ disabled: true, reason: 'Not available here' });
  });

  it('says why it is greyed in one caption line, the Wind speed row\'s own reason after its name, and nothing when it can be used', () => {
    expect(windMapReasonLine('Needs a fire: mark one first')).toBe('Colour the map by speed. Needs a fire: mark one first.');
    expect(windMapReasonLine('')).toBe('');
    expect(windMapReasonLine('Needs a fire: mark one first')).not.toMatch(/[—–]/);
  });

  it('is the chip itself, with no wrapper and no node of its own for the reason (the Layers panel has no node to spare)', () => {
    const src = read('windMapSwitch.ts');
    expect(src).toContain('el: button,');
    expect(src).not.toMatch(/h\(\s*'(div|p|span)'/);
  });

  it('works out "a fire is marked" the way the Layers panel does (an ignition, or ground already burnt), not as "a snapshot exists"', () => {
    const fire = 'st.ignitions.length > 0 || (st.snapshot?.stats?.burntAreaHa ?? 0) > 0';
    expect(read('windMapSwitch.ts')).toContain(fire);
    expect(read('layersPanel.ts')).toContain('st.ignitions.length > 0 || (st.snapshot?.stats?.burntAreaHa ?? 0) > 0');
  });

  it('is built with the Wind height chips and told to repaint with them (the one pre-wired hook of windGlyphControls)', () => {
    const c = read('windGlyphControls.ts');
    expect(c).toContain('createWindMapSwitch(ctx)');
    expect(c).toContain('options.mapSwitch.update(options.caption.id)');
    expect(c).toContain('windMapReasonLine(options.mapSwitch.reason())'); // (the reason is a caption line: the chip is the only node it adds)
    expect(c).toContain('options?.mapSwitch.destroy()');
    expect(c).toContain("[chips.el, mapSwitch.el, caption, level]");
  });
});

describe('the Wind height the map follows', () => {
  const snap = { fireWind: {} };
  it('is the arrows’ height while they are on, and the 10 m wind while they are off', () => {
    for (const h of WIND_HEIGHTS) {
      expect(mapHeightNow({ windGlyphs: true, windHeight: h }, snap), String(h)).toBe(h);
      expect(mapHeightNow({ windGlyphs: false, windHeight: h }, snap), String(h)).toBe('fire');
    }
  });

  it('is the 10 m wind for What the fire feels when the picture has no fireWind (before the first snapshot, a replay from before 0.7.0, the demo engine)', () => {
    for (const none of [null, undefined, {}, { fireWind: undefined }]) expect(mapHeightNow({ windGlyphs: true, windHeight: 'felt' }, none), JSON.stringify(none)).toBe('fire');
    expect(mapHeightNow({ windGlyphs: true, windHeight: 300 }, null)).toBe(300);
  });

  it('starts as What the fire feels with the arrows off: the new default, and the Wind speed map at its start is the 10 m one', () => {
    expect(DEFAULT_LAYERS.windHeight).toBe('felt');
    expect(DEFAULT_LAYERS.windGlyphs).toBe(false);
    expect(mapHeightNow(DEFAULT_LAYERS, snap)).toBe('fire');
  });
});

describe('a Wind height in metres on a picture with no 3-D wind (0.7.0, raster verifier F1)', () => {
  const grid = { nx: 4, ny: 4, cellSize: 150 };
  const withAir = (volume: boolean): { fireWind: unknown; atmosphere: never } => ({ fireWind: {}, atmosphere: { grid, nz: 2, u: new Float32Array(volume ? 32 : 0), v: new Float32Array(volume ? 32 : 0), w: new Float32Array(volume ? 32 : 0), thetaAnomaly: new Float32Array(0), smoke: new Float32Array(0) } as never });

  it('has no data: asked of the same picture as the height, true only for a height in metres without the volume', () => {
    expect(mapNoDataNow({ windGlyphs: true, windHeight: 300 }, withAir(false))).toBe(true);
    expect(mapNoDataNow({ windGlyphs: true, windHeight: 300 }, withAir(true))).toBe(false);
    for (const h of ['felt', 50, 2000] as const) expect(mapNoDataNow({ windGlyphs: true, windHeight: h }, withAir(false)), String(h)).toBe(h !== 'felt');
    // With the arrows off the map is the 10 m one, whatever height is chosen, and the 10 m wind is always there to draw.
    expect(mapNoDataNow({ windGlyphs: false, windHeight: 300 }, withAir(false))).toBe(false);
    // No picture yet: nothing to say.
    for (const none of [null, undefined]) expect(mapNoDataNow({ windGlyphs: true, windHeight: 300 }, none)).toBe(false);
  });

  it('is said by every legend the map has and drawn as nothing by the view: the map legend, the Layers panel (twice) and the scene pass it on, and the scene gives the field its height', () => {
    expect(read('mapLegend.ts')).toContain('windNoData: mapNoDataNow(s, ctx.session.state.get().snapshot)');
    expect(read('mapLegend.ts')).toMatch(/\$\{s\.overlay === 'windSpeed' && mapNoDataNow\(s, ctx\.session\.state\.get\(\)\.snapshot\) \? '\|nodata' : ''\}/); // (a thinned frame comes and goes as the time is scrubbed: the card redraws)
    const panel = read('layersPanel.ts');
    expect(panel.match(/windNoData: mapNoDataNow\(/g)).toHaveLength(2);
    expect(panel).toMatch(/mapNoDataNow\(s, ctx\.session\.state\.get\(\)\.snapshot\) \? '\.nodata' : ''/);
    const scene = readFileSync(join(__dirname, '../../../render/SceneView.ts'), 'utf8');
    expect(scene).toMatch(/\.\.\.\(kind === 'windSpeed' \? \{ windHeight \} : \{\}\)/); // overlayField then returns no field for a height with no map, not the 10 m wind
    expect(scene).toContain('windNoData: windMapNoData(this.windMapShown(), this.snap?.atmosphere)');
  });
});

describe('the second line of the Wind speed row', () => {
  it('is "In km/h" at 10 m (as it was), and says which wind it is at any other height', () => {
    expect(windSpeedSubline('In km/h', 'fire')).toBe('In km/h');
    expect(windSpeedSubline('In km/h', 'felt')).toBe('In km/h, the wind the fire feels');
    expect(windSpeedSubline('In km/h', 100)).toBe('In km/h, at 100 m');
    expect(windSpeedSubline('In km/h', 2000)).toBe('In km/h, at 2 km');
    for (const h of WIND_HEIGHTS) expect(windSpeedSubline('In km/h', h)).not.toMatch(/[—–]/);
    expect(heightLabel(1000)).toBe('1 km');
  });

  it('the catalog row keeps its why and says in its what that it can follow the arrows’ height; there is still one heat row per kind', () => {
    const row = layerById('windSpeed')!;
    expect(row.what).toBe('How fast the wind is blowing near the ground, place by place, or at the height you chose for the arrows.');
    expect(row.why).toContain('on a calm night the wind the fire feels can differ a lot from this map');
    expect(LAYER_CATALOG.filter((l) => l.heat?.overlay === 'windSpeed')).toHaveLength(1);
  });
});
