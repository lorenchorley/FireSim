import { describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, QualityTier, ScenarioData, ScenarioEdit } from '../core/types';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { SwitchableController } from './runController';
import { Emitter } from './store';

/** An engine that is only a record of its calls and an event line. */
class Engine implements SimController {
  readonly ev = new Emitter<SimEvents>();
  readonly calls: unknown[][] = [];
  disposed = 0;
  async init(s: ScenarioData): Promise<Insight[]> {
    this.calls.push(['init', s.name]);
    return [];
  }
  run(u: number): void {
    this.calls.push(['run', u]);
  }
  pause(): void {
    this.calls.push(['pause']);
  }
  ignite(i: Ignition): void {
    this.calls.push(['ignite', i.id]);
  }
  edit(e: ScenarioEdit, t: number): void {
    this.calls.push(['edit', e.id, t]);
  }
  removeEdit(id: string): void {
    this.calls.push(['removeEdit', id]);
  }
  removeIgnition(id: string): void {
    this.calls.push(['removeIgnition', id]);
  }
  rewind(t: number): void {
    this.calls.push(['rewind', t]);
  }
  setOption(k: SimOptionKey, v: number | boolean): void {
    this.calls.push(['setOption', k, v]);
  }
  setQuality(t: QualityTier): void {
    this.calls.push(['setQuality', t]);
  }
  async explain(x: number, y: number, t?: number): Promise<CellExplanation> {
    this.calls.push(['explain', x, y, t]);
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  dispose(): void {
    this.disposed++;
  }
}

const ign = (id: string): Ignition => ({ id, kind: 'point', points: [[0, 0]], time: 0, origin: 'observed' });
const fuel = (id: string): ScenarioEdit => ({ kind: 'fuel', id, shape: { kind: 'circle', x: 0, y: 0, radius: 10 } });

describe('SwitchableController', () => {
  it('every call goes to the target, unchanged', async () => {
    const e = new Engine();
    const c = new SwitchableController(e);
    expect(c.inner).toBe(e);
    await c.init({ name: 'n' } as ScenarioData);
    c.run(600);
    c.pause();
    c.ignite(ign('a'));
    c.edit(fuel('f'), 300);
    c.removeEdit('f');
    c.removeIgnition('a');
    c.rewind(60);
    c.setOption('coupling', 0.5);
    c.setQuality('fast');
    await c.explain(1, 2, 3);
    expect(e.calls).toEqual([['init', 'n'], ['run', 600], ['pause'], ['ignite', 'a'], ['edit', 'f', 300], ['removeEdit', 'f'], ['removeIgnition', 'a'], ['rewind', 60], ['setOption', 'coupling', 0.5], ['setQuality', 'fast'], ['explain', 1, 2, 3]]);
  });

  it('the engine events reach the listeners, and the listeners stay when the target changes', () => {
    const a = new Engine();
    const b = new Engine();
    const c = new SwitchableController(a);
    const seen: string[] = [];
    c.on('error', (m) => seen.push(`error ${m}`));
    c.on('status', (s) => seen.push(`status ${s.time}`));
    a.ev.emit('error', 'link lost');
    c.switchTo(b);
    a.ev.emit('error', 'a ghost'); // the old engine is no longer listened to
    b.ev.emit('status', { time: 5, running: true, speed: 1 });
    b.ev.emit('error', 'local');
    expect(seen).toEqual(['error link lost', 'status 5', 'error local']);
    expect(c.inner).toBe(b);
    expect(a.disposed).toBe(1); // the old target is finished with
    expect(b.disposed).toBe(0);
  });

  it('after a switch the calls go to the new target only', () => {
    const a = new Engine();
    const b = new Engine();
    const c = new SwitchableController(a);
    c.run(1);
    c.switchTo(b);
    c.run(2);
    expect(a.calls).toEqual([['run', 1]]);
    expect(b.calls).toEqual([['run', 2]]);
  });

  it('keeps the order the fires and changes were sent in: the newest call for a mark sent again, nothing for a mark taken away', () => {
    const c = new SwitchableController(new Engine());
    c.ignite(ign('a'));
    c.edit(fuel('f'), 0);
    c.ignite(ign('b'));
    c.edit(fuel('f'), 60); // sent again: it moves to the end
    expect(Object.fromEntries(c.order)).toEqual({ a: 0, b: 2, f: 3 });
    c.removeIgnition('a');
    c.removeEdit('f');
    expect(Object.fromEntries(c.order)).toEqual({ b: 2 });
  });

  it('dispose stops the events, drops the listeners and finishes the target', () => {
    const e = new Engine();
    const c = new SwitchableController(e);
    const seen: string[] = [];
    c.on('error', (m) => seen.push(m));
    c.dispose();
    e.ev.emit('error', 'late');
    expect(seen).toEqual([]);
    expect(e.disposed).toBe(1);
  });
});
