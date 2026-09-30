import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatasetRecord } from '../../../core/datasets';
import { imageryCredit } from '../../../core/datasets';
import { DEFAULT_LAYERS } from '../../../render/layers';
import { mapCredits } from './mapCredits';

const fixture = (name: string): DatasetRecord[] => JSON.parse(readFileSync(join(__dirname, '../../../../tests/fixtures/datasets', `${name}.json`), 'utf8')).datasets as DatasetRecord[];

describe('map attribution line', () => {
  const katoomba = fixture('katoomba-bundled');
  const on = { hasImagery: true, hasContext: true };

  it('credits the aerial photo first, with its capture-date text, then the places layers that are on and the ground', () => {
    const c = mapCredits(katoomba, DEFAULT_LAYERS, on);
    expect(c.parts[0]).toBe(imageryCredit(katoomba));
    expect(c.parts[0]).toMatch(/^Aerial photo /);
    expect(c.ids).toContain('roads');
    expect(c.ids).toContain('terrain');
    expect(c.text).toBe(c.parts.join(' · '));
    // Every credit is a real attribution string of the inventory (nothing typed in), and none is repeated.
    const attributions = new Set(katoomba.map((r) => r.attribution));
    for (const p of c.parts.slice(1)) expect(attributions.has(p)).toBe(true);
    expect(new Set(c.parts).size).toBe(c.parts.length);
  });

  it('drops the photo when it is switched off, and the places when their layers are off', () => {
    const c = mapCredits(katoomba, { ...DEFAULT_LAYERS, imagery: false, roads: false, fireTrails: false, placeNames: false, homes: false, zones: false }, on);
    expect(c.ids).not.toContain('imagery');
    expect(c.ids).not.toContain('roads');
    expect(c.ids).toContain('terrain');
  });

  it('a heat map shown on its own hides the photo and the trees, and credits the data behind it', () => {
    const c = mapCredits(katoomba, { ...DEFAULT_LAYERS, overlay: 'timeSinceFire', soloHeat: true }, on);
    expect(c.ids).not.toContain('imagery');
    expect(c.ids).toContain('fire-history');
  });

  it('never credits synthetic, derived or user data', () => {
    const c = mapCredits(katoomba, { ...DEFAULT_LAYERS, homes: true, zones: true }, on);
    for (const id of c.ids) {
      const r = katoomba.find((x) => x.id === id);
      if (!r) continue;
      expect(['synthetic', 'preset', 'user', 'derived']).not.toContain(r.origin);
    }
  });

  it('without an inventory it still credits the photo with its own attribution, and nothing else', () => {
    const c = mapCredits(undefined, DEFAULT_LAYERS, { ...on, imageryAttribution: '© Spatial Services NSW' });
    expect(c.text).toBe('Aerial photo © Spatial Services NSW');
    expect(mapCredits(undefined, { ...DEFAULT_LAYERS, imagery: false }, on).text).toBe('');
  });

  it('places are not credited when the place has no places data', () => {
    const c = mapCredits(katoomba, DEFAULT_LAYERS, { hasImagery: true, hasContext: false });
    expect(c.ids).not.toContain('roads');
  });
});
