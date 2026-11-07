import { afterEach, describe, expect, it } from 'vitest';
import type { SimController } from '../sim/protocol';
import { desktopSlot, type DesktopApi } from './desktopSlot';
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

describe('the controller of a run (0.8.0, workstream J: the desktop engine)', () => {
  afterEach(() => desktopSlot.set({ host: null, run: null }));
  const hostWith = (take: () => SimController | null): DesktopApi => ({ take }) as unknown as DesktopApi;

  it('without a desktop host the in-app controller is made, as always (the demo engine in ?mock=1)', async () => {
    const s = await loadServices(true);
    const a = s.createController();
    const b = s.createController();
    expect(a).not.toBe(b); // a new one per run
    expect(a.constructor.name).toBe('MockSimController');
  });

  it('with a desktop host that has a link for this run, the run gets that controller; with This device chosen it still gets the in-app one', async () => {
    const s = await loadServices(true);
    const link = { id: 'the desktop link' } as unknown as SimController;
    desktopSlot.set({ host: hostWith(() => link) });
    expect(s.createController()).toBe(link);
    desktopSlot.set({ host: hostWith(() => null) });
    expect(s.createController().constructor.name).toBe('MockSimController');
  });

  it('createLocalController is always this device\'s engine, whatever the desktop host says (the standby of a desktop run, and the engine Continue on this device starts)', async () => {
    const s = await loadServices(true);
    const link = { id: 'the desktop link' } as unknown as SimController;
    desktopSlot.set({ host: hostWith(() => link) });
    const a = s.createLocalController();
    const b = s.createLocalController();
    expect(a).not.toBe(link);
    expect(a).not.toBe(b); // a new one each time: an engine that failed to start is never reused
    expect(a.constructor.name).toBe('MockSimController');
    desktopSlot.set({
      host: hostWith(() => {
        throw new Error('The desktop connection closed.');
      }),
    });
    expect(() => s.createLocalController()).not.toThrow(); // a gone link does not stop a run on this device
  });

  it('a desktop engine whose link is gone stops the run from starting (the build screen says why) instead of computing on this device in silence', async () => {
    const s = await loadServices(true);
    desktopSlot.set({
      host: hostWith(() => {
        throw new Error('The desktop connection closed.');
      }),
    });
    expect(() => s.createController()).toThrow('The desktop connection closed.');
  });
});
