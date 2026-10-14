/** Frame statistics ring (frameLog.ts) and its feed from FrameMeter: ring wrap, the 10 s window, stalls, pauses and idle gaps. */
import { describe, expect, it } from 'vitest';
import { FRAME_RING, FrameLog, SLOW_MS, STALL_MAX_MS } from './frameLog';
import { FrameMeter } from './perf';

describe('FrameLog', () => {
  it('has no numbers before the first frame', () => {
    expect(new FrameLog().summary()).toEqual({ fps10: null, meanMs: null, p95Ms: null, over33: 0, over100: 0, frames: 0 });
  });

  it('a steady 60 fps loop: mean 16.7 ms, 60 frames per second, nothing slow', () => {
    const log = new FrameLog();
    let t = 5000;
    for (let i = 0; i < 300; i++) log.add(1000 / 60, (t += 1000 / 60));
    const s = log.summary();
    expect(s.frames).toBe(FRAME_RING);
    expect(s.meanMs).toBeCloseTo(16.667, 2);
    expect(s.p95Ms).toBeCloseTo(16.667, 2);
    expect(s.fps10).toBeCloseTo(60, 1);
    expect([s.over33, s.over100]).toEqual([0, 0]);
  });

  it('the ring keeps the newest 120 intervals: old slow frames fall out when it wraps', () => {
    const log = new FrameLog();
    let t = 1000;
    for (let i = 0; i < 20; i++) log.add(150, (t += 150));
    expect(log.summary().over100).toBe(20);
    for (let i = 0; i < FRAME_RING; i++) log.add(16, (t += 16));
    const s = log.summary();
    expect(s.over100).toBe(0);
    expect(s.frames).toBe(FRAME_RING);
    expect(s.meanMs).toBeCloseTo(16, 3);
  });

  it('counts the slow frames and takes the 95th percentile from the ring', () => {
    const log = new FrameLog();
    let t = 0;
    // 100 frames: 90 at 16 ms, 8 at 50 ms (over 33), 2 at 200 ms (over 100 as well).
    const dts = [...Array(90).fill(16), ...Array(8).fill(50), ...Array(2).fill(200)] as number[];
    for (const dt of dts) log.add(dt, (t += dt));
    const s = log.summary();
    expect(s.frames).toBe(100);
    expect(s.over33).toBe(10);
    expect(s.over100).toBe(2);
    expect(s.p95Ms).toBe(50);
    expect(s.meanMs).toBeCloseTo((90 * 16 + 8 * 50 + 2 * 200) / 100, 5);
  });

  it('a 33.3 ms frame (the 30 fps playback cap) is not slow, 40 ms is', () => {
    const log = new FrameLog();
    log.add(33.4, 1000);
    expect(log.summary().over33).toBe(0);
    log.add(SLOW_MS + 1, 1100);
    expect(log.summary().over33).toBe(1);
  });

  it('the frame rate is over the last 10 s of drawing: seconds older than that are forgotten, idle time is not counted', () => {
    const log = new FrameLog();
    // 20 s at 30 fps, then 5 s of nothing drawn, then 2 s at 60 fps: the window ends at the last frame, so the old 30 fps seconds
    // 10 s or more before it are gone and the rest mixes (8 s at 30 fps, 2 s at 60 fps) by frames / time.
    let t = 0;
    for (let i = 0; i < 20 * 30; i++) log.add(1000 / 30, (t += 1000 / 30));
    t += 5000;
    for (let i = 0; i < 2 * 60; i++) log.add(1000 / 60, (t += 1000 / 60));
    const fps = log.summary().fps10!;
    expect(fps).toBeGreaterThan(30);
    expect(fps).toBeLessThan(45);
    // Only 60 fps frames in the last 10 s once they fill it.
    for (let i = 0; i < 12 * 60; i++) log.add(1000 / 60, (t += 1000 / 60));
    expect(log.summary().fps10).toBeCloseTo(60, 0);
  });

  it('ignores pauses over 2 s, zero and negative intervals; never produces NaN', () => {
    const log = new FrameLog();
    log.add(STALL_MAX_MS + 1, 10_000);
    log.add(0, 10_001);
    log.add(-5, 10_002);
    log.add(NaN, 10_003);
    expect(log.summary().frames).toBe(0);
    log.add(300, 11_000);
    const s = log.summary();
    expect(s.frames).toBe(1);
    expect(s.over100).toBe(1);
    for (const v of Object.values(s)) expect(typeof v === 'number' ? Number.isFinite(v) : v === null).toBe(true);
  });
});

describe('FrameMeter feeds the log', () => {
  it('records drawn frames and a stall the meter itself ignores, but not the first frame, an idle gap or renderNow-style breaks', () => {
    const m = new FrameMeter();
    let t = 1000;
    m.tick(t); // first frame: no interval yet
    for (let i = 0; i < 10; i++) m.tick((t += 16.7));
    expect(m.log.summary().frames).toBe(10);
    expect(m.tick((t += 400))).toBe(0); // a 400 ms stall: not a measured frame for the pixel ratio ...
    const s = m.log.summary();
    expect(s.frames).toBe(11); // ... but it is in the statistics as a very slow frame
    expect(s.over100).toBe(1);
    m.tick(-1e9); // the loop went idle: the chain is broken
    m.tick((t += 5000));
    m.tick((t += 16.7));
    expect(m.log.summary().frames).toBe(12);
    expect(m.fps).toBeGreaterThan(55);
  });
});
