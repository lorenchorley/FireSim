/**
 * What fills the "Recent events" ring (eventLog.ts) during a run (workstream A, §5.3): slow-run episodes derived from
 * `SessionState.pace` (level changes and the slowest ratio), the engine's own events (`EngineInfo.perf.events`, de-duplicated by
 * `seq`), the app going to the background and coming back, and the first time the history was thinned. Loaded as a small chunk
 * of its own when a run starts (simScreen.ts), so the entry carries only the ring.
 *
 * Events never carry a coordinate, a place name or an identifier. Nothing here changes a result: it only reads state.
 */
import { eventLog, type EventLog } from './eventLog';
import type { PerfEvent } from '../core/simTypes';
import type { PaceInfo, PaceLevel } from './paceTypes';
import type { SimSession } from './session';

/** A span of wall time in words: "5 s", "2 min 10 s", "1 h 3 min". */
export function waited(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/**
 * Turns the pace levels (`SessionState.pace`) into slow-run episodes: one event when playback falls behind, one when it starts
 * to wait or stops waiting while still behind, and one when it is back, with how long it lasted and the slowest speed seen
 * against the speed asked for.
 */
export class PaceWatch {
  private level: PaceLevel = 'ok';
  private t0 = 0;
  private worst = Infinity;

  constructor(private readonly log: EventLog) {}

  observe(pace: PaceInfo | null, runS: number): void {
    const level = pace?.level ?? 'ok';
    const was = this.level;
    if (level === 'ok' && was === 'ok') return;
    if (was === 'ok') {
      this.t0 = this.log.now();
      this.worst = Infinity;
    }
    // The slowest ratio is what playback achieved against what was asked for; the sentences name what the worker computes.
    const played = pace ? (pace.achieved ?? pace.capacity) : null;
    if (pace && level !== 'ok' && played !== null && pace.wanted > 0) this.worst = Math.min(this.worst, played / pace.wanted);
    if (level === was) return;
    this.level = level;
    const computing = pace ? (pace.capacity ?? pace.achieved) : null;
    const asked = pace ? `${Math.round(pace.wanted)}x` : '';
    const now = computing !== null ? `about ${Math.round(computing)}x` : 'slower';
    if (level === 'ok') {
      const worst = Number.isFinite(this.worst) ? ` Slowest: about ${Math.round(100 * Math.min(1, this.worst))} % of the speed asked for.` : '';
      const after = waited(this.log.now() - this.t0);
      this.log.add('slow', pace ? `Back at the speed asked for after ${after}.${worst}` : `The slow spell ended after ${after} (playback was paused, jumped or changed speed).${worst}`, runS);
    } else if (was === 'ok') {
      this.log.add('slow', level === 'waiting' ? `Playback is waiting for the simulation: computing ${now}, asked for ${asked}.` : `The simulation is falling behind: computing ${now}, asked for ${asked}.`, runS);
    } else {
      this.log.add('slow', level === 'waiting' ? 'Playback is now waiting for the simulation.' : 'Playback is no longer waiting, but the simulation is still behind.', runS);
    }
  }
}

/**
 * Watch one run: reset the log, then record slow-run episodes, the engine's events, going to the background and coming back,
 * and the first thinning of the history. Returns the stop function.
 */
export function watchRun(session: Pick<SimSession, 'state' | 'snapshots'> & Partial<Pick<SimSession, 'onEngineEvents'>>, log: EventLog = eventLog): () => void {
  log.begin();
  log.add('run', 'Run started.', 0);
  const pace = new PaceWatch(log);
  // An event is delivered with every snapshot that carries it, so the UI drops one it has seen. The key is the seq with the wall
  // time: a new engine instance restarts its seq at 1, and its events must not be taken for the old instance's.
  const seen = new Set<string>();
  let thinned = false;
  let hiddenAt = 0;
  const offPace = session.state.subscribe((s) => pace.observe(s.pace, s.viewTime), ['pace']);
  const take = (events: readonly PerfEvent[]): void => {
    for (const e of events) {
      const key = `${e.seq}@${e.wallMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 64) seen.delete(seen.values().next().value as string);
      log.add(e.kind, e.text, e.simS, e.wallMs);
    }
  };
  // The session hands over the events of every snapshot as it arrives; the picture on screen carries only the newest engine
  // report, so on its own it would lose the events of a snapshot that was not the newest when the picture changed.
  const offEvents = session.onEngineEvents?.(take);
  const offSnap = session.state.subscribe((s) => {
    if (!offEvents) take(s.snapshot?.engine?.perf?.events ?? []);
    const st = session.snapshots;
    if (!thinned && st.spacing > 1.5 * st.displayStep) {
      thinned = true;
      log.add('history', `The history memory is full: older pictures are now about ${Math.round(st.spacing)} s apart.`, s.viewTime);
    }
  }, ['snapshot']);
  const onVisibility = (): void => {
    const t = session.state.get().viewTime;
    if (document.hidden) {
      hiddenAt = log.now();
      log.add('app', 'The app went to the background.', t);
    } else if (hiddenAt) {
      log.add('app', `The app came back after ${waited(log.now() - hiddenAt)} in the background.`, t);
      hiddenAt = 0;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    offPace();
    offEvents?.();
    offSnap();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
