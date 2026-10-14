/**
 * Settings & About, the parts that must not be typed in: the tap-to-copy links of the attributions come from the providers
 * and licences the data-set records use, the performance hint is worded from the profiles and the builder's cell rule, the
 * picture quality hint and its heads-up for High on a phone the guess calls Low, and the About block's version and build id are read from package.json and the bundle name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CC_BY_4, LICENCES, PROVIDERS } from '../scenario/recordKit';
import { APP_VERSION, buildId, bundleHash } from './buildInfo';
import { ATTRIBUTIONS } from './content';
import { attributionLinks, performanceHint, PICTURE_QUALITY_HINT, pictureQualityNote } from './screens/settings';
import { performanceProfile } from './settings';

describe('attribution links', () => {
  it('every link is a provider or licence page the records use, never a request URL', () => {
    const known = new Set<string>([CC_BY_4.url!, ...Object.values(PROVIDERS).map((p) => (p as { url?: string }).url), ...Object.values(LICENCES).map((l) => (l as { url?: string }).url)].filter((u): u is string => !!u));
    for (const a of ATTRIBUTIONS) {
      for (const l of attributionLinks(a)) {
        expect(known.has(l.url), `${a.name}: ${l.url}`).toBe(true);
        expect(l.url).toMatch(/^https:\/\/[^?#]+$/);
      }
    }
  });

  it('the NSW and Open-Meteo sources get their provider and licence pages', () => {
    const by = (name: string) => attributionLinks(ATTRIBUTIONS.find((a) => a.name.startsWith(name))!);
    expect(by('Open-Meteo').map((l) => l.url)).toEqual([PROVIDERS.openMeteo.url, LICENCES.openMeteo.url]);
    expect(by('NSW Spatial Services (elevation)').map((l) => l.url)).toEqual([PROVIDERS.spatial.url, CC_BY_4.url]);
    expect(by('NSW National Parks').map((l) => l.url)[0]).toBe(PROVIDERS.npws.url);
    expect(by('SRTM').map((l) => l.url)).toEqual([PROVIDERS.awsTerrain.url, LICENCES.publicDomain.url]);
  });
});

describe('performance hint', () => {
  it('names the numbers of the profiles', () => {
    const t = performanceHint();
    expect(t).toContain(performanceProfile('battery').maxEmbers.toLocaleString('en-AU'));
    expect(t).toContain(performanceProfile('quality').maxEmbers.toLocaleString('en-AU'));
    expect(t).toContain('20 m cells for areas up to 6 km');
    expect(t).toContain('simple 2-D wind');
  });
});

describe('picture quality hint and note', () => {
  const low = { tier: 'low', cores: 4, memoryGb: 3 } as const;

  it('the hint says what Auto, Detail and High do, that the picture still lowers itself, and when it applies', () => {
    expect(PICTURE_QUALITY_HINT).toContain("Auto picks from this phone's cores and memory; Detail also asks for High.");
    expect(PICTURE_QUALITY_HINT).toContain('High draws more terrain and trees and needs more memory');
    expect(PICTURE_QUALITY_HINT).toContain('lowers its resolution by itself if the frame rate stays under 30');
    expect(PICTURE_QUALITY_HINT).toContain('Applies to the next model you build.');
  });

  it('High on a phone the guess calls Low gets the heads-up, with that phone\'s numbers', () => {
    expect(pictureQualityNote('high', 'auto', low)).toBe('This phone looks like a Low device (4 cores, 3 GB). High may run slowly or close the app.');
    expect(pictureQualityNote('high', 'battery', { tier: 'low', cores: 2, memoryGb: 1 })).toBe('This phone looks like a Low device (2 cores, 1 GB). High may run slowly or close the app.');
  });

  it('Auto under Detail asks for High, so it gets the same heads-up; Auto under Saver or Balanced does not', () => {
    expect(pictureQualityNote('auto', 'quality', low)).toMatch(/^This phone looks like a Low device/);
    expect(pictureQualityNote('auto', 'auto', low)).toBeNull();
    expect(pictureQualityNote('auto', 'battery', low)).toBeNull();
  });

  it('nothing for Low or Medium, nor for High on a phone the guess calls Medium or High', () => {
    expect(pictureQualityNote('low', 'quality', low)).toBeNull();
    expect(pictureQualityNote('medium', 'quality', low)).toBeNull();
    expect(pictureQualityNote('high', 'auto', { tier: 'medium', cores: 6, memoryGb: 4 })).toBeNull();
    expect(pictureQualityNote('high', 'quality', { tier: 'high', cores: 8, memoryGb: 8 })).toBeNull();
  });

  it('says so when the browser does not report the numbers (they count as 4 cores and 4 GB, which gives Low)', () => {
    expect(pictureQualityNote('high', 'auto', { tier: 'low', cores: null, memoryGb: null })).toBe('This phone looks like a Low device (cores not reported, memory not reported). High may run slowly or close the app.');
    expect(pictureQualityNote('high', 'auto', { tier: 'low', cores: 1, memoryGb: 0.5 })).toContain('(1 core, 0.5 GB)');
  });
});

describe('build info', () => {
  it('version from package.json, build id from the bundle name', () => {
    expect(APP_VERSION).toBe(JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version);
    expect(bundleHash('https://localhost/assets/index-BX3k9aQz.js')).toBe('BX3k9aQz');
    expect(bundleHash('capacitor://localhost/assets/settings-a1B2c3D4.js?v=1')).toBe('a1B2c3D4');
    expect(bundleHash('https://localhost/assets/index-Ab-Cd_Ef.js')).toBe('Ab-Cd_Ef');
    expect(bundleHash('http://localhost:5173/src/ui/buildInfo.ts')).toBeNull();
    expect(buildId('https://x/assets/index-BX3k9aQz.js', false)).toBe('BX3k9aQz');
    expect(buildId('https://x/assets/index-BX3k9aQz.js', true)).toBe('development');
  });
});
