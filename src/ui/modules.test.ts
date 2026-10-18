import { describe, expect, it } from 'vitest';
import { loadServices } from './modules';

describe('loadServices (the render module as the app loads it)', () => {
  it('gives the legends of the renderer, the wind arrows and flow lines among them', async () => {
    const s = await loadServices(false);
    expect(s.sources.scene).toBe('real');
    const l = s.sceneLegends;
    expect(l).not.toBeNull();
    expect(typeof l!.crossSection).toBe('function');
    expect(typeof l!.wind).toBe('function');
    expect(typeof l!.slice).toBe('function');
    expect(typeof l!.windGlyphs).toBe('function');
    expect(l!.windGlyphs!('at 100 m').title).toBe('Wind at 100 m');
  }, 60000);

  it('the 2-D map (?mock=1) has no scene legends', async () => {
    const s = await loadServices(true);
    expect(s.sources.scene).toBe('mock');
    expect(s.sceneLegends).toBeNull();
  });
});
