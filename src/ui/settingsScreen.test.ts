/**
 * Settings & About, the parts that must not be typed in: the tap-to-copy links of the attributions come from the providers
 * and licences the data-set records use, the performance hint is worded from the profiles and the builder's cell rule, and
 * the About block's version and build id are read from package.json and the bundle name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CC_BY_4, LICENCES, PROVIDERS } from '../scenario/recordKit';
import { APP_VERSION, buildId, bundleHash } from './buildInfo';
import { ATTRIBUTIONS } from './content';
import { attributionLinks, performanceHint } from './screens/settings';
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
