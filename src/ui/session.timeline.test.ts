/**
 * The timeline contract of SimSession (jump to any time, fast-forward, scrubbing, display / solver step, speeds), with
 * a scripted fake engine (deterministic, driven by the test) and with the real engine through LocalSimController.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CellExplanation, Ignition, Insight, ScenarioData, ScenarioEdit, SimSnapshot } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { SimController, SimEvents, SimOptionKey } from '../sim/protocol';
import { LocalSimController } from '../sim/client';
import { pointIgnition, syntheticScenario } from '../sim/testing/scenarios';
import { SimSession } from './session';
import { bindStepSettings, DEFAULT_SETTINGS, type Settings } from './settings';
import { Emitter, Store } from './store';

// ───────────────────────────── a scripted engine ─────────────────────────────

/**
 * An engine the test drives: `run(until)` starts a run, `produce()` computes the next display step (or the run-end
 * snapshot at the first 10 s solver mark ≥ until), like the real host: snapshots at multiples of `step`, a run-end
 * snapshot when the run ends between them, then status(false).
 */
class FakeEngine implements SimController {
  private readonly ev = new Emitter<SimEvents>();
  readonly calls: { name: string; args: unknown[] }[] = [];
  time = 0;
  until = 0;
  running = false;
  step = 60;
  duration = 7200;
  insightsAt = new Map<number, Insight[]>();
  /** Do not report the start of a run (the test sends the report itself, after stale ones). */
  deferRunStatus = false;

  async init(): Promise<Insight[]> {
    return [];
  }
  run(until: number): void {
    this.calls.push({ name: 'run', args: [until] });
    this.until = Math.min(until, this.duration);
    this.running = true;
    if (!this.deferRunStatus) this.ev.emit('status', { time: this.time, running: true, speed: 500, until });
  }
  pause(): void {
    this.calls.push({ name: 'pause', args: [] });
    this.running = false;
    this.ev.emit('status', { time: this.time, running: false, speed: 0, until: this.until });
  }
  ignite(i: Ignition): void {
    this.calls.push({ name: 'ignite', args: [i] });
  }
  edit(e: ScenarioEdit, t: number): void {
    this.calls.push({ name: 'edit', args: [e, t] });
  }
  removeEdit(id: string): void {
    this.calls.push({ name: 'removeEdit', args: [id] });
  }
  removeIgnition(id: string): void {
    this.calls.push({ name: 'removeIgnition', args: [id] });
  }
  rewind(t: number): void {
    this.calls.push({ name: 'rewind', args: [t] });
    this.time = Math.floor(t / this.step) * this.step;
    this.ev.emit('rewound', t);
  }
  setOption(k: SimOptionKey, v: number | boolean): void {
    this.calls.push({ name: 'setOption', args: [k, v] });
    if (k === 'snapshotInterval') this.step = Number(v);
  }
  setQuality(): void {}
  async explain(): Promise<CellExplanation> {
    return {} as CellExplanation;
  }
  on<K extends keyof SimEvents>(e: K, cb: SimEvents[K]): () => void {
    return this.ev.on(e, cb);
  }
  emit<K extends keyof SimEvents>(e: K, ...a: Parameters<SimEvents[K]>): void {
    this.ev.emit(e, ...a);
  }
  dispose(): void {}

  names(): string[] {
    return this.calls.map((c) => c.name);
  }
  runs(): number[] {
    return this.calls.filter((c) => c.name === 'run').map((c) => c.args[0] as number);
  }

  snapshot(time: number): void {
    this.ev.emit('snapshot', { time, insights: this.insightsAt.get(time) ?? [], spotFires: [], stats: { time } } as unknown as SimSnapshot);
  }

  /** Compute one more display step while running; ends the run (run-end snapshot + status) at the target. */
  produce(): boolean {
    if (!this.running) return false;
    const nextMark = (Math.floor(this.time / this.step + 1e-9) + 1) * this.step;
    if (nextMark >= this.until - 1e-9) {
      // Reach the first 10 s mark at or after the target.
      const reached = Math.min(this.duration, Math.ceil(this.until / 10 - 1e-9) * 10);
      this.time = Math.max(this.time, reached);
      this.snapshot(this.time);
      this.running = false;
      this.ev.emit('status', { time: this.time, running: false, speed: 0, until: this.until });
      return false;
    }
    this.time = nextMark;
    this.snapshot(nextMark);
    return true;
  }
  produceAll(): void {
    while (this.produce());
  }
  /** t0 snapshot + a computed history up to `t` (paused). */
  history(t: number): void {
    this.snapshot(0);
    for (let x = this.step; x <= t; x += this.step) {
      this.time = x;
      this.snapshot(x);
    }
    this.time = t;
  }
}

const nullView = new Proxy({}, { get: () => () => null }) as unknown as SceneViewApi;

const scenario = (duration = 7200): ScenarioData =>
  ({ id: 's', name: 's', origin: { lat: 0, lon: 0 }, extent: 3000, startTime: 0, duration, ignitions: [], edits: [], options: { snapshotInterval: 60, coupling: 1, embers: true, mountainPhenomena: true } }) as unknown as ScenarioData;

const card = (id: string, time: number, severity: Insight['severity'] = 'watch'): Insight => ({ id, kind: 'general', severity, time, x: time * 7, y: 0, title: id, body: '', factors: [] });

// A manual animation-frame clock.
let frames: ((now: number) => void)[] = [];
let wall = 1000;
const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let savedRaf: unknown;
let savedCaf: unknown;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  frames = [];
  wall = performance.now();
  g.requestAnimationFrame = (cb: (now: number) => void): number => frames.push(cb);
  g.cancelAnimationFrame = (id: number): void => {
    frames[id - 1] = () => undefined;
  };
});
afterEach(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});
/** Run the pending animation frames after `ms` of wall time. */
function frame(ms: number): void {
  wall += ms;
  const now = wall;
  const cbs = frames;
  frames = [];
  for (const cb of cbs) cb(now);
}

async function make(engine = new FakeEngine(), duration = 7200): Promise<{ e: FakeEngine; s: SimSession }> {
  engine.duration = duration;
  const s = new SimSession(scenario(duration), engine, nullView, { maxBytes: 1e9 });
  await s.start();
  return { e: engine, s };
}

// ───────────────────────────── jumping within the computed range ─────────────────────────────

describe('seek within the computed range', () => {
  it('shows any earlier or later computed time at once and exactly, without starting the engine', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(437);
    let st = s.state.get();
    expect(st.viewTime).toBe(437);
    expect(st.snapshot!.time).toBe(437); // exact, not the 420 step
    expect(st.snapshot!.stats.time).toBe(420);
    expect(st.reviewing).toBe(true);
    expect(st.playing).toBe(false);
    expect(st.seekTarget).toBeNull();
    s.seek(1234.5);
    st = s.state.get();
    expect(st.viewTime).toBe(1234.5);
    expect(st.snapshot!.time).toBe(1234.5);
    s.seek(1800);
    expect(s.state.get().reviewing).toBe(false);
    expect(s.state.get().snapshot!.time).toBe(1800);
    expect(e.runs()).toEqual([]);
    s.seek(0);
    expect(s.state.get().viewTime).toBe(0);
    expect(s.state.get().snapshot!.time).toBe(0);
    s.dispose();
  });

  it('clamps to [0, duration] and ignores non-numbers', async () => {
    const { e, s } = await make(new FakeEngine(), 3600);
    e.history(600);
    s.seek(-50);
    expect(s.state.get().viewTime).toBe(0);
    s.seek(Number.NaN);
    s.seek(Infinity);
    expect(s.state.get().viewTime).toBe(0);
    expect(s.state.get().seekTarget).toBeNull();
    s.seek(1e9);
    expect(s.state.get().seekTarget).toBe(3600);
    s.dispose();
  });

  it('keeps playing after a jump when it was playing, and stays paused otherwise', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(600);
    expect(s.state.get().playing).toBe(false);
    s.play();
    expect(s.state.get().playing).toBe(true);
    s.seek(900);
    expect(s.state.get().playing).toBe(true);
    expect(s.state.get().viewTime).toBe(900);
    s.seek(300, { resume: false });
    expect(s.state.get().playing).toBe(false);
    expect(e.names().at(-1)).toBe('pause');
    s.seek(400, { resume: true });
    expect(s.state.get().playing).toBe(true);
    s.dispose();
  });

  it('stepBy moves the view by the given seconds, backwards or forwards, and keeps the play state', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(1000);
    s.stepBy(-60);
    expect(s.state.get().viewTime).toBe(940);
    s.stepBy(3600); // beyond the computed range: a fast-forward
    expect(s.state.get().seekTarget).toBe(4540);
    expect(e.runs()).toEqual([4540]);
    s.dispose();
  });
});

// ───────────────────────────── fast-forward ─────────────────────────────

describe('fast-forward beyond the computed range', () => {
  it('runs the engine to the target, the view follows every result, and stops exactly at the target', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(1800);
    let st = s.state.get();
    expect(st.seekTarget).toBe(1800);
    expect(st.playing).toBe(false);
    expect(e.runs()).toEqual([1800]);
    expect(st.viewTime).toBe(600); // starts at the newest computed picture
    const seen: number[] = [];
    const progress: number[] = [];
    s.state.subscribe((x) => {
      seen.push(x.viewTime);
      progress.push(x.seekProgress);
    }, ['viewTime']);
    while (e.produce()) {
      const now = s.state.get();
      expect(now.viewTime).toBe(now.headTime); // follows the newest result
      expect(now.viewTime).toBeLessThanOrEqual(1800);
      expect(now.seekTarget).toBe(1800);
    }
    st = s.state.get();
    expect(st.seekTarget).toBeNull();
    expect(st.seekProgress).toBe(0);
    expect(st.viewTime).toBe(1800);
    expect(st.snapshot!.time).toBe(1800);
    expect(st.playing).toBe(false);
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // never backwards
    expect(Math.max(...progress)).toBeGreaterThan(0.5);
    expect(Math.max(...progress)).toBeLessThanOrEqual(1);
    s.dispose();
  });

  it('progress is (min(head, target) − from) / (target − from)', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(600);
    s.seek(1800);
    expect(s.state.get().seekProgress).toBe(0);
    e.produce(); // 660
    expect(s.state.get().seekProgress).toBeCloseTo(60 / 1200, 6);
    e.produce(); // 720
    e.produce(); // 780
    expect(s.state.get().seekProgress).toBeCloseTo(180 / 1200, 6);
    s.dispose();
  });

  it('stops exactly at a time between two results even when the engine overshoots to its next solver mark', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(1237);
    e.produceAll();
    const st = s.state.get();
    expect(e.time).toBe(1240);
    expect(st.headTime).toBe(1240);
    expect(st.viewTime).toBe(1237);
    expect(st.snapshot!.time).toBe(1237);
    expect(st.seekTarget).toBeNull();
    // Back and forth inside the computed range afterwards is immediate.
    s.seek(1239);
    expect(s.state.get().snapshot!.time).toBe(1239);
    s.dispose();
  });

  it('plays on at the previous speed when the jump began while playing or with resume, else stays paused', async () => {
    const { e, s } = await make();
    e.history(600);
    s.setSpeed(120);
    s.play();
    s.seek(1500); // playing: resume by default
    expect(s.state.get().playing).toBe(false); // the clock waits during the jump
    e.produceAll();
    let st = s.state.get();
    expect(st.viewTime).toBe(1500);
    expect(st.playing).toBe(true);
    expect(st.speed).toBe(120);
    expect(e.runs().at(-1)).toBeGreaterThan(1500); // look-ahead run after landing
    s.pause();
    // From paused: no resume unless asked.
    s.seek(2500);
    e.produceAll();
    expect(s.state.get().playing).toBe(false);
    s.seek(3500, { resume: true });
    e.produceAll();
    expect(s.state.get().playing).toBe(true);
    s.pause();
    // play() during a jump means "and play on when you get there".
    s.seek(4500);
    s.play();
    expect(s.state.get().playing).toBe(false);
    e.produceAll();
    expect(s.state.get().playing).toBe(true);
    s.dispose();
  });

  it('a new seek retargets a jump in progress; one into the computed range ends it', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(1800);
    e.produce();
    e.produce();
    expect(s.state.get().viewTime).toBe(720);
    s.seek(3000);
    expect(s.state.get().seekTarget).toBe(3000);
    expect(e.runs()).toEqual([1800, 3000]);
    expect(s.state.get().seekProgress).toBe(0);
    e.produce();
    s.seek(300, { resume: false }); // into the computed range
    expect(s.state.get().seekTarget).toBeNull();
    expect(s.state.get().viewTime).toBe(300);
    expect(e.names().at(-1)).toBe('pause');
    s.seek(760); // 780 is computed
    expect(s.state.get().seekTarget).toBeNull();
    s.dispose();
  });

  it('pause(), toggle() and cancelSeek() cancel it and stay where the view is', async () => {
    for (const cancel of ['pause', 'toggle', 'cancelSeek'] as const) {
      const { e, s } = await make();
      e.history(600);
      s.seek(3000);
      e.produce();
      e.produce();
      s[cancel]();
      const st = s.state.get();
      expect(st.seekTarget, cancel).toBeNull();
      expect(st.seekProgress).toBe(0);
      expect(st.playing).toBe(false);
      expect(st.viewTime).toBe(720);
      expect(st.snapshot!.time).toBe(720);
      expect(e.names().at(-1)).toBe('pause');
      expect(e.running).toBe(false);
      s.dispose();
    }
    const { s } = await make();
    s.cancelSeek(); // no-op when idle
    expect(s.state.get().playing).toBe(false);
    s.dispose();
  });

  it('edits, ignitions and what-ifs during a jump cancel it and apply at the view time', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(3000);
    e.produce();
    e.produce();
    const ign = s.ignite({ id: 'x', kind: 'point', points: [[0, 0]], origin: 'observed' });
    expect(s.state.get().seekTarget).toBeNull();
    expect(ign.time).toBe(720);
    expect(e.names()).toContain('pause');
    // A what-if from the view time.
    s.seek(4000);
    e.produce();
    s.rerunWith({ coupling: 0, embers: true, mountainPhenomena: true }, 'x');
    expect(s.state.get().seekTarget).toBeNull();
    // Undo an ignition.
    s.seek(5000);
    s.removeIgnition('x');
    expect(s.state.get().seekTarget).toBeNull();
    s.seek(6000);
    s.edit({ kind: 'wind', id: 'w', x: 0, y: 0, radius: 100, speed: 5, dir: 90, time: 0 });
    expect(s.state.get().seekTarget).toBeNull();
    s.dispose();
  });

  it('reveals insight cards once each, in order, only for times the view has reached (also during a jump)', async () => {
    const { e, s } = await make();
    e.insightsAt.set(660, [card('a', 610)]);
    e.insightsAt.set(900, [card('b', 850), card('c', 890, 'danger')]);
    e.insightsAt.set(1200, [card('d', 1150)]);
    e.insightsAt.set(1500, [card('e', 1495)]);
    e.insightsAt.set(1510, [card('late', 1508)]); // in the run-end snapshot, after the target
    e.history(600);
    const revealed: { id: string; at: number }[] = [];
    s.events.on('reveal', (i) => revealed.push({ id: i.id, at: s.state.get().viewTime }));
    s.seek(600);
    s.seek(1505);
    while (e.produce()) {
      for (const i of s.state.get().insights) if (i.time > s.state.get().viewTime) expect(revealed.some((r) => r.id === i.id)).toBe(false);
    }
    expect(revealed.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const r of revealed) expect(r.at).toBeGreaterThanOrEqual(s.state.get().insights.find((i) => i.id === r.id)!.time);
    expect(s.state.get().viewTime).toBe(1505);
    // 'late' (1508) is known to the session but not shown yet; going there reveals it, and scrubbing back and forth does not repeat.
    expect(s.state.get().insights.map((i) => i.id)).toContain('late');
    expect(s.visibleInsights().map((i) => i.id)).not.toContain('late');
    s.seek(200);
    s.seek(1505);
    expect(revealed.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    s.seek(1509);
    expect(revealed.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'late']);
    s.dispose();
  });

  it('is unaffected by a pause made from a reveal listener (pause on Danger) when it lands', async () => {
    const { e, s } = await make();
    e.insightsAt.set(660, [card('d', 650, 'danger')]);
    e.history(600);
    s.events.on('reveal', (i) => {
      if (i.severity === 'danger') s.pause();
    });
    s.seek(700, { resume: true });
    e.produceAll();
    expect(s.state.get().playing).toBe(false);
    expect(s.state.get().seekTarget).toBeNull();
    s.dispose();
  });

  it('follows a worker rewind during the jump (results after the view are dropped, the jump goes on)', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(2400);
    e.produce();
    e.produce();
    e.produce(); // 780
    e.emit('rewound', 660);
    const st = s.state.get();
    expect(st.seekTarget).toBe(2400);
    expect(st.headTime).toBeGreaterThanOrEqual(660);
    expect(st.headTime).toBeLessThanOrEqual(780);
    e.produceAll();
    expect(s.state.get().viewTime).toBe(2400);
    expect(s.state.get().seekTarget).toBeNull();
    s.dispose();
  });

  it('ends at the newest result when the worker goes idle short of the target, or fails', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(3000);
    e.produce();
    e.produce();
    // A stale "not running" from before the run is ignored: the run has not been reported running yet... it has here.
    e.running = false;
    e.emit('status', { time: e.time, running: false, speed: 0 });
    expect(s.state.get().seekTarget).toBeNull();
    expect(s.state.get().viewTime).toBe(720);
    expect(s.state.get().playing).toBe(false);
    // An error ends it too, and stops playback.
    s.seek(3000);
    e.produce();
    e.emit('error', 'boom');
    expect(s.state.get().seekTarget).toBeNull();
    expect(s.state.get().error).toBe('boom');
    s.play();
    e.emit('error', 'again');
    expect(s.state.get().playing).toBe(false);
    s.dispose();
  });

  it('ignores reports of earlier runs (the echo of a pause, a look-ahead) that arrive during a jump', async () => {
    const { e, s } = await make();
    e.history(600);
    s.play();
    s.pause();
    e.deferRunStatus = true;
    s.seek(1800);
    // In flight from before: the pause's "not running" and a look-ahead's "running" for other targets.
    e.emit('status', { time: 600, running: true, speed: 0, until: 2400 });
    e.emit('status', { time: 600, running: false, speed: 0, until: 2400 });
    expect(s.state.get().seekTarget).toBe(1800);
    // A "not running" echo carrying this target, before the run is seen running, is ignored too.
    e.emit('status', { time: 600, running: false, speed: 0, until: 1800 });
    expect(s.state.get().seekTarget).toBe(1800);
    // The run itself reports running, then it stops short (the worker was paused elsewhere): the jump ends.
    e.emit('status', { time: 600, running: true, speed: 500, until: 1800 });
    e.emit('status', { time: 660, running: false, speed: 0, until: 1800 });
    expect(s.state.get().seekTarget).toBeNull();
    expect(s.state.get().viewTime).toBe(600);
    s.dispose();
  });
});

describe('fast-forward near the end of the scenario', () => {
  it('seek(duration) computes to the end and lands there; with resume it announces the end instead of playing', async () => {
    const { e, s } = await make(new FakeEngine(), 1800);
    e.history(600);
    let ended = 0;
    s.events.on('ended', () => ended++);
    s.seek(1800);
    expect(e.runs()).toEqual([1800]);
    e.produceAll();
    expect(s.state.get().viewTime).toBe(1800);
    expect(s.state.get().snapshot!.time).toBe(1800);
    expect(s.state.get().playing).toBe(false);
    expect(ended).toBe(0); // paused seek: nothing to announce
    s.seek(1000);
    s.seek(1800, { resume: true }); // inside the computed range now
    expect(s.state.get().playing).toBe(false);
    expect(ended).toBe(1);
    s.play(); // at the end: nothing to play
    expect(s.state.get().playing).toBe(false);
    s.dispose();
  });

  it('a jump a few seconds before the end stops there; the run may overshoot to the end', async () => {
    const { e, s } = await make(new FakeEngine(), 1800);
    e.history(600);
    s.seek(1795);
    e.produceAll();
    expect(s.state.get().viewTime).toBe(1795);
    expect(s.state.get().headTime).toBe(1800);
    expect(s.state.get().snapshot!.time).toBe(1795);
    s.dispose();
  });

  it('seek(0) from anywhere shows the start, exactly', async () => {
    const { e, s } = await make();
    e.history(1200);
    s.seek(1200);
    s.seek(0);
    expect(s.state.get().viewTime).toBe(0);
    expect(s.state.get().snapshot!.time).toBe(0);
    expect(s.state.get().reviewing).toBe(true);
    s.dispose();
  });
});

// ───────────────────────────── scrubbing ─────────────────────────────

describe('scrubbing', () => {
  it('beginScrub pauses, scrub previews without starting the engine, endScrub resumes if it was playing', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.play();
    const runsBefore = e.runs().length;
    s.beginScrub();
    expect(s.state.get().playing).toBe(false);
    expect(e.names().at(-1)).toBe('pause');
    s.scrub(500);
    expect(s.state.get().viewTime).toBe(500);
    expect(s.state.get().snapshot!.time).toBe(500);
    s.scrub(99999); // never beyond what is computed while dragging
    expect(s.state.get().viewTime).toBe(1800);
    s.scrub(731);
    expect(e.runs().length).toBe(runsBefore);
    s.endScrub(731);
    expect(s.state.get().viewTime).toBe(731);
    expect(s.state.get().playing).toBe(true);
    s.dispose();
  });

  it('a drag that began paused ends paused', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.beginScrub();
    s.scrub(900);
    s.endScrub(900);
    expect(s.state.get().playing).toBe(false);
    expect(s.state.get().viewTime).toBe(900);
    s.dispose();
  });

  it('ending a drag beyond the computed range starts a fast-forward that plays on when the drag began while playing', async () => {
    const { e, s } = await make();
    e.history(600);
    s.play();
    s.beginScrub();
    s.scrub(3000);
    expect(s.state.get().viewTime).toBe(600);
    s.endScrub(3000);
    expect(s.state.get().seekTarget).toBe(3000);
    e.produceAll();
    expect(s.state.get().viewTime).toBe(3000);
    expect(s.state.get().playing).toBe(true);
    s.dispose();
  });

  it('a drag begun during a fast-forward cancels it and resumes it at the drop point', async () => {
    const { e, s } = await make();
    e.history(600);
    s.seek(3000, { resume: true });
    e.produce();
    s.beginScrub();
    expect(s.state.get().seekTarget).toBeNull();
    s.scrub(300);
    s.endScrub(300);
    expect(s.state.get().playing).toBe(true);
    expect(s.state.get().viewTime).toBe(300);
    s.dispose();
  });
});

// ───────────────────────────── speed, steps ─────────────────────────────

describe('speed', () => {
  it('accepts any positive number or Infinity and ignores the rest', async () => {
    const { s } = await make();
    for (const v of [0.5, 1, 45, 7200, 86400, Infinity]) {
      s.setSpeed(v);
      expect(s.state.get().speed).toBe(v);
    }
    s.setSpeed(0);
    s.setSpeed(-3);
    s.setSpeed(Number.NaN);
    expect(s.state.get().speed).toBe(Infinity);
    s.dispose();
  });

  it('advances the view clock by speed × wall time and re-issues the run when the speed changes', async () => {
    const { e, s } = await make();
    e.history(3000);
    s.setSpeed(30);
    s.play();
    frame(16); // first frame: starts the clock
    for (let i = 0; i < 4; i++) frame(250); // (a frame never advances the clock by more than 0.25 s of wall time)
    const t1 = s.state.get().viewTime;
    expect(t1).toBeGreaterThan(25);
    expect(t1).toBeLessThan(40);
    s.setSpeed(600);
    const runs = e.runs().length;
    expect(runs).toBeGreaterThan(0);
    frame(250);
    expect(s.state.get().viewTime).toBeGreaterThan(t1 + 100);
    s.dispose();
  });

  it('the view never passes the newest result and never stops on its own', async () => {
    const { e, s } = await make();
    e.history(600);
    s.setSpeed(3600);
    s.play();
    for (let i = 0; i < 30; i++) frame(250);
    const st = s.state.get();
    expect(st.viewTime).toBe(600); // waiting for the engine
    expect(st.playing).toBe(true); // ...but still playing
    s.dispose();
  });

  it('playing to the end of the scenario stops playback and announces the end', async () => {
    const { e, s } = await make(new FakeEngine(), 600);
    e.history(600);
    let ended = 0;
    s.events.on('ended', () => ended++);
    s.seek(500);
    s.setSpeed(600);
    s.play();
    for (let i = 0; i < 10; i++) frame(250);
    expect(s.state.get().viewTime).toBe(600);
    expect(s.state.get().playing).toBe(false);
    expect(ended).toBe(1);
    s.dispose();
  });
});

describe('pictures while playing', () => {
  it('are rounded to about six per wall second (not one per frame) and exact when paused', async () => {
    const e = new FakeEngine();
    let updates: number[] = [];
    const view = new Proxy({}, { get: (_t, key) => (key === 'update' ? (snap: SimSnapshot) => updates.push(snap.time) : () => null) }) as unknown as SceneViewApi;
    const s = new SimSession(scenario(), e, view, { maxBytes: 1e9 });
    await s.start();
    e.history(3000);
    s.setSpeed(60);
    s.play();
    updates = [];
    for (let i = 0; i < 40; i++) frame(16); // ~0.64 s of wall time: about 38 sim seconds
    expect(s.state.get().viewTime).toBeGreaterThan(30);
    expect(updates.length).toBeGreaterThan(2);
    expect(updates.length).toBeLessThan(8);
    for (const t of updates) expect(t % 10).toBe(0); // speed 60 → 10 s pictures
    s.pause();
    s.seek(1234.5);
    expect(s.state.get().snapshot!.time).toBe(1234.5);
    // At speed 1 the pictures are one second apart.
    s.setSpeed(1);
    s.play();
    updates = [];
    for (let i = 0; i < 100; i++) frame(16);
    expect(updates.length).toBeLessThanOrEqual(3);
    for (const t of updates) expect(Number.isInteger(t)).toBe(true);
    s.dispose();
  });
});

describe('display step and solver step', () => {
  it('bindStepSettings keeps the session equal to the settings, now and on every change', async () => {
    const { e, s } = await make();
    e.history(600);
    const store = new Store<Settings>({ ...DEFAULT_SETTINGS, timeStep: 30 });
    const off = bindStepSettings(s, store);
    expect(s.state.get().timeStep).toBe(30); // applied at once (the session was built with 60)
    store.set({ timeStep: 10 });
    expect(s.state.get().timeStep).toBe(10);
    expect(e.calls.filter((c) => c.name === 'setOption').map((c) => c.args)).toEqual([['snapshotInterval', 30], ['snapshotInterval', 10]]);
    store.set({ solverStep: 2 });
    expect(s.state.get().solverStep).toBe(2);
    expect(e.names().slice(-2)).toEqual(['setOption', 'rewind']);
    store.set({ theme: 'dark' }); // unrelated
    off();
    store.set({ timeStep: 120 });
    expect(s.state.get().timeStep).toBe(10);
    s.dispose();
  });

  it('setTimeStep tells the engine now, without a rewind, and the session uses it for its look-ahead', async () => {
    const { e, s } = await make();
    e.history(600);
    s.setTimeStep(10);
    expect(e.calls.at(-1)).toEqual({ name: 'setOption', args: ['snapshotInterval', 10] });
    expect(s.state.get().timeStep).toBe(10);
    expect(e.names()).not.toContain('rewind');
    expect(s.snapshots.displayStep).toBe(10);
    s.setTimeStep(-1);
    s.setTimeStep(0);
    expect(s.state.get().timeStep).toBe(10);
    e.step = 10;
    e.snapshot(610);
    e.time = 610;
    expect(s.state.get().headTime).toBe(610);
    s.dispose();
  });

  it('setSolverStep is a what-if from the view time: the option, a rewind, and later results dropped', async () => {
    const { e, s } = await make();
    e.history(1800);
    s.seek(900);
    e.calls.length = 0;
    s.setSolverStep(2);
    expect(e.calls.map((c) => c.name)).toEqual(['setOption', 'rewind']);
    expect(e.calls[0]).toEqual({ name: 'setOption', args: ['maxStepS', 2] });
    expect(e.calls[1]).toEqual({ name: 'rewind', args: [900] });
    const st = s.state.get();
    expect(st.solverStep).toBe(2);
    expect(st.headTime).toBe(900);
    expect(st.viewTime).toBe(900);
    expect(s.snapshots.range()!.end).toBe(900);
    // The engine re-simulates and streams the later results again.
    e.snapshot(960);
    expect(s.state.get().headTime).toBe(960);
    // While playing it keeps playing, and a jump in progress ends.
    s.play();
    s.setSolverStep(0);
    expect(s.state.get().playing).toBe(true);
    s.seek(5000);
    s.setSolverStep(5);
    expect(s.state.get().seekTarget).toBeNull();
    s.dispose();
  });
});

// ───────────────────────────── with the real engine ─────────────────────────────

describe('SimSession with the real engine', () => {
  async function real(): Promise<{ s: SimSession; c: LocalSimController }> {
    const c = new LocalSimController({ chunkMs: 10, simulation: { minSnapshotWallMs: 0 } });
    const sc = syntheticScenario({ ignitions: [pointIgnition('a', -300, 0, 0, 60)], extent: 2400, duration: 3600 });
    const s = new SimSession(sc, c, nullView, { maxBytes: 1e9 });
    await s.start();
    return { s, c };
  }
  const until = async (pred: () => boolean, ms = 30000): Promise<void> => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  it('jumps to a time nobody computed yet, stops exactly there, and shows the exact fire front for any time before it', async () => {
    const { s } = await real();
    await until(() => s.state.get().snapshot !== null);
    s.seek(1237);
    expect(s.state.get().seekTarget).toBe(1237);
    await until(() => s.state.get().seekTarget === null);
    const st = s.state.get();
    expect(st.viewTime).toBe(1237);
    expect(st.snapshot!.time).toBe(1237);
    expect(st.headTime).toBeGreaterThanOrEqual(1237);
    expect(st.headTime).toBeLessThan(1250);
    expect(st.playing).toBe(false);
    const arrivals = (t: number): Float32Array => {
      s.seek(t);
      return s.state.get().snapshot!.fire.arrivalTime.slice();
    };
    const burnt = (a: Float32Array, t: number): number => a.reduce((n, x) => n + (x <= t ? 1 : 0), 0);
    const a1 = arrivals(600);
    const a2 = arrivals(601);
    const a3 = arrivals(1200);
    expect(s.state.get().snapshot!.time).toBe(1200);
    expect(burnt(a1, 600)).toBeGreaterThan(0);
    expect(burnt(a1, 1e9)).toBe(burnt(a1, 600)); // nothing burnt later than the time shown
    expect(burnt(a2, 601)).toBeGreaterThanOrEqual(burnt(a1, 600));
    expect(burnt(a3, 1200)).toBeGreaterThan(burnt(a1, 600));
    // Pictures for cells that arrive between two display steps: the front at 601 s is finer than the 60 s cadence.
    s.seek(1237);
    expect(s.state.get().snapshot!.fire.arrivalTime.length).toBe(a1.length);
    s.dispose();
  }, 60000);

  it('a jump that plays on continues at the chosen speed; pausing during it stays put', async () => {
    const { s } = await real();
    await until(() => s.state.get().snapshot !== null);
    s.setSpeed(600);
    s.seek(900, { resume: true });
    await until(() => s.state.get().seekTarget === null);
    expect(s.state.get().viewTime).toBe(900);
    expect(s.state.get().playing).toBe(true);
    s.pause();
    s.seek(3000);
    await until(() => s.state.get().headTime > 1500);
    s.pause();
    const t = s.state.get().viewTime;
    expect(t).toBeGreaterThan(900);
    expect(s.state.get().seekTarget).toBeNull();
    await new Promise((r) => setTimeout(r, 150));
    expect(s.state.get().viewTime).toBe(t);
    s.dispose();
  }, 60000);

  it('changing the display step and the solver step while running keeps the session consistent', async () => {
    const { s } = await real();
    await until(() => s.state.get().snapshot !== null);
    s.seek(600);
    await until(() => s.state.get().seekTarget === null);
    s.setTimeStep(10);
    s.seek(700);
    await until(() => s.state.get().seekTarget === null);
    expect(s.state.get().viewTime).toBe(700);
    expect(s.snapshots.times().some((t) => t % 60 !== 0 && t % 10 === 0)).toBe(true);
    s.setSolverStep(2); // re-runs from 700
    expect(s.state.get().headTime).toBeLessThanOrEqual(700);
    s.seek(900);
    await until(() => s.state.get().seekTarget === null);
    expect(s.state.get().viewTime).toBe(900);
    expect(s.state.get().snapshot!.time).toBe(900);
    s.dispose();
  }, 90000);
});
