/**
 * The idle clock (idleStop.ts): idle after a limit without a poke, woken by the next poke, never idle for a limit of 0 or Infinity or a clock that goes
 * backwards; and the option that sets the limit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IDLE_STOP_MS, IdleClock, idleStopLimit } from './idleStop';

describe('IdleClock', () => {
  it('is idle once the limit has passed since the last poke, and not a millisecond before', () => {
    const c = new IdleClock(60_000);
    c.poke(1_000);
    expect(c.idle(1_000)).toBe(false);
    expect(c.idle(1_000 + 60_000 - 1)).toBe(false);
    expect(c.idle(1_000 + 60_000)).toBe(true);
    expect(c.idle(1_000 + 600_000)).toBe(true);
  });

  it('a poke at now - limit + 1 is not idle, at now - limit is', () => {
    const now = 500_000;
    const a = new IdleClock(60_000);
    a.poke(now - 60_000 + 1);
    expect(a.idle(now)).toBe(false);
    const b = new IdleClock(60_000);
    b.poke(now - 60_000);
    expect(b.idle(now)).toBe(true);
  });

  it('activity inside the limit never says it woke anything', () => {
    const c = new IdleClock(10_000);
    expect(c.poke(0)).toBe(false);
    expect(c.poke(5_000)).toBe(false);
    expect(c.poke(14_999)).toBe(false); // 9 999 ms after the last one
    expect(c.poke(24_998)).toBe(false);
  });

  it('says true for the poke that woke a stopped view, false for the ones after it', () => {
    const c = new IdleClock(10_000);
    c.poke(0);
    expect(c.idle(10_000)).toBe(true);
    expect(c.poke(12_000)).toBe(true);
    expect(c.idle(12_000)).toBe(false);
    expect(c.poke(12_100)).toBe(false);
    expect(c.idle(12_000 + 9_999)).toBe(false);
    expect(c.idle(12_100 + 10_000)).toBe(true);
  });

  it('counts from the first look when nothing has poked yet (a view that was built and left alone still stops)', () => {
    const c = new IdleClock(10_000);
    expect(c.idle(100_000)).toBe(false); // the first look starts the count
    expect(c.idle(100_000 + 9_999)).toBe(false);
    expect(c.idle(100_000 + 10_000)).toBe(true);
  });

  it('a limit of 0, Infinity, a negative number or NaN is never', () => {
    for (const limit of [0, Infinity, -5, NaN]) {
      const c = new IdleClock(limit);
      c.poke(0);
      expect(c.idle(1e12), `limit ${limit}`).toBe(false);
      expect(c.poke(2e12), `limit ${limit}`).toBe(false);
    }
  });

  it('a clock that goes backwards is never idle', () => {
    const c = new IdleClock(10_000);
    c.poke(50_000);
    expect(c.idle(40_000)).toBe(false);
    expect(c.idle(0)).toBe(false);
    // and a poke at the earlier time starts the count there
    c.poke(0);
    expect(c.idle(9_999)).toBe(false);
    expect(c.idle(10_000)).toBe(true);
  });

  it('setLimit takes effect at once, from the last poke', () => {
    const c = new IdleClock(60_000);
    c.poke(0);
    expect(c.idle(20_000)).toBe(false);
    c.setLimit(10_000);
    expect(c.idle(20_000)).toBe(true);
    c.setLimit(0);
    expect(c.idle(20_000)).toBe(false);
  });
});

describe('idleStopLimit', () => {
  it('takes a number of ms, 0 and Infinity as they are', () => {
    expect(idleStopLimit(3000)).toBe(3000);
    expect(idleStopLimit(0)).toBe(0);
    expect(idleStopLimit(Infinity)).toBe(Infinity);
    expect(idleStopLimit(1500.5)).toBe(1500.5);
  });

  it('takes a numeric string (a query value)', () => {
    expect(idleStopLimit('3000')).toBe(3000);
    expect(idleStopLimit(' 250 ')).toBe(250);
    expect(idleStopLimit('0')).toBe(0);
  });

  it('anything else is the minute: absent, negative, NaN, text, empty, other types', () => {
    expect(IDLE_STOP_MS).toBe(60_000);
    for (const raw of [undefined, null, -1, -Infinity, NaN, 'soon', '', '  ', 'NaN', '-3', {}, [], true, () => 5]) {
      expect(idleStopLimit(raw), String(raw)).toBe(IDLE_STOP_MS);
    }
  });
});

describe('SceneView and the idle stop (source pins: the loop is not run here, so the wiring is read; each line is one thing the stop needs)', () => {
  const scene = readFileSync(new URL('./SceneView.ts', import.meta.url), 'utf8');
  /** The text of a method of SceneView, from its signature to the closing brace at two spaces. */
  const body = (name: string): string => {
    const m = new RegExp(`\\n  (?:private )?${name}\\([^\\n]*\\{\\n([\\s\\S]*?)\\n  \\}\\n`).exec(scene);
    expect(m, `a method ${name}`).not.toBeNull();
    return m![1]!;
  };

  it('the shader clock advances only while the view is not held still, and nowhere else', () => {
    expect(scene).toMatch(/if \(!idle\) this\.u\.uClock!\.value = \(this\.u\.uClock!\.value as number\) \+ dt;/);
    expect(scene.match(/uClock!\.value = /g)).toHaveLength(1);
  });

  it('the camera moving, a hand on it, time running and a flight are activity in the frame, and a gap between frames (the page was away) is too', () => {
    expect(scene).toMatch(/if \(moved \|\| playing \|\| this\.interacting \|\| this\.rig\.flying\) this\.activity\.poke\(now\);/);
    expect(scene).toMatch(/if \(this\.lastFrame && now - this\.lastFrame > STALL_MS\) this\.activity\.poke\(now\);/);
  });

  it('every ambient term of `animating` is held back while idle, and the layers are told when it changes (and a wake draws a frame)', () => {
    expect(scene).toMatch(/const animating =[\s\S]*?\(ambient && !idle\);/);
    const ambient = /const ambient =([\s\S]*?);\n/.exec(scene)![1]!;
    for (const term of ['this.flames.count', 'this.embers.active', 'this.wind.animating', 'this.glyphs.animating', 'this.focus !== null', 'this.user !== null', 'this.vegetation?.animating', 'this.snap?.spotFires']) {
      expect(ambient, term).toContain(term);
    }
    expect(scene).toMatch(/if \(idle !== this\.heldStill\) \{\s+this\.heldStill = idle;\s+this\.glyphs\.setPaused\(idle\);\s+if \(!idle\) this\.dirty = true;\s+\}/);
  });

  it('the CPU particles and the embers are not advanced while idle', () => {
    expect(scene).toMatch(/if \(!idle && this\.embers\.group\.visible && this\.embers\.active > 0\) this\.embers\.animate\(/);
    expect(scene).toMatch(/if \(!idle && this\.wind\.currentMode !== 'off' && this\.sampler\) this\.wind\.animate\(/);
  });

  it('a touch, the wheel, a key, the pointer or the page coming back to the front anywhere in the page is activity, and the listeners go with the view', () => {
    expect(scene).toMatch(/const ACTIVITY_EVENTS = \['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'\] as const;/);
    expect(scene).toMatch(/window\.addEventListener\(type, this\.onActivity, \{ capture: true, passive: true \}\)/);
    expect(scene).toMatch(/window\.removeEventListener\(type, this\.onActivity, \{ capture: true \}\)/);
    expect(scene).toMatch(/document\.addEventListener\('visibilitychange', this\.onVisible\)/);
    expect(scene).toMatch(/document\.removeEventListener\('visibilitychange', this\.onVisible\)/);
    expect(scene).toMatch(/private readonly onVisible = \(\): void => \{\s+if \(!document\.hidden\) this\.wake\(\);/);
  });

  it('a new picture, a layer, view mode, scenario, fuel, ignition, insight, size or uncovering change wakes it', () => {
    for (const name of ['setScenario', 'refreshFuel', 'update', 'setLayers', 'setIgnitions', 'setInsights', 'setViewMode', 'setCovered', 'resize']) {
      expect(body(name), name).toContain('this.wake();');
    }
  });

  it('the limit is the option, else the test seam window.__firesimIdleStopMs, read once through idleStopLimit', () => {
    expect(scene).toMatch(/new IdleClock\(idleStopLimit\(opts\.idleStopMs \?\? \(typeof window !== 'undefined' \? \(window as unknown as \{ __firesimIdleStopMs\?: unknown \}\)\.__firesimIdleStopMs : undefined\)\)\)/);
  });

  it('reduced motion reaches the old Wind streaks and the tree sway: at the start, on a change of the setting, and for every new vegetation layer', () => {
    expect(scene.match(/this\.wind\.setMotion\(!this\.motionQuery\?\.matches\)/g)).toHaveLength(2); // the constructor and onMotion
    const onMotion = /private readonly onMotion = \(\): void => \{([\s\S]*?)\};/.exec(scene)![1]!;
    expect(onMotion).toContain('this.vegetation?.setMotion(!this.motionQuery?.matches)');
    expect(body('setScenario')).toContain('this.vegetation.setMotion(!this.motionQuery?.matches);');
  });

  it('the glyph layer is given the canopy and the crowns only while the canopy is drawn, the plume per snapshot, and compiles ahead after a drawn frame', () => {
    const sync = body('syncCanopy');
    expect(sync).toContain('this.vegetation?.visible');
    expect(sync).toContain('this.glyphs.setCanopy(');
    expect(sync).toContain('this.glyphs.setCrowns(');
    expect(sync).toContain('crownSource()');
    expect(body('applyLayers')).toContain('this.syncCanopy();');
    expect(body('refreshFuel')).toContain('this.syncCanopy();');
    expect(body('update')).toContain('this.glyphs.setPlumes(plumeSites(c));');
    expect(scene).toMatch(/this\.renderer\.render\(this\.scene, cam\);\s+this\.lastDrawMs = now;\s+if \(this\.glyphsCompile === 'pending' && !this\.interacting\) this\.precompileGlyphs\(\);/);
    const compile = body('precompileGlyphs');
    expect(compile).toContain("this.renderer.extensions.has('KHR_parallel_shader_compile')"); // the silent question: `compileAsync` asks with `get`, which warns in the console where there is none
    expect(compile).toContain('this.renderer.compileAsync(this.glyphs.group, camera, this.scene)');
    expect(compile).toContain('this.renderer.compile(this.glyphs.group, camera, this.scene)'); // without it, in one go at a quiet moment
  });
});
