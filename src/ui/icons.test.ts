/** The icon set: every drawing is valid path data on the 24 px grid, every old name still works, aliases resolve. */
import { describe, expect, it } from 'vitest';
import { ICON_ALIASES, ICON_NAMES, iconMarkup, type IconName } from './icons';

/** Names that existed before the design-system rework: they must keep working. */
const LEGACY_NAMES = [
  'why', 'flame', 'brush', 'wind', 'layers', 'whatif', 'play', 'pause', 'speed', 'settings', 'close', 'back', 'chevronUp', 'chevronDown', 'chevronRight',
  'locate', 'pin', 'check', 'warning', 'danger', 'info', 'thermometer', 'droplet', 'clock', 'top', 'cube', 'person', 'target', 'undo', 'trash', 'plus', 'minus',
  'sun', 'moon', 'online', 'offline', 'book', 'list', 'chart', 'stats', 'help', 'crosshair', 'line', 'point', 'compass', 'eye', 'map', 'replay', 'lock', 'leaf',
  'ember', 'gps',
] as const;

/** Names the design brief asks for. */
const REQUIRED_NAMES = [
  'layers', 'my-location', 'info', 'database', 'storage', 'road', 'home', 'tree', 'terrain', 'mountain', 'satellite', 'cloud', 'water-drop', 'wind', 'thermometer',
  'ruler', 'clock', 'download', 'upload', 'cloud-off', 'check', 'close', 'chevron-right', 'chevron-left', 'chevron-down', 'chevron-up', 'search', 'more-vert',
  'open-in-new', 'copy', 'warning', 'flame', 'filter', 'history', 'bar-chart', 'table', 'map', 'compass', 'tune', 'help', 'external-link', 'lock', 'sync', 'delete',
  'settings', 'contrast',
] as const;

/** End points (and control points) of an SVG path, in absolute coordinates. Enough of a path interpreter to bound-check the icons. */
function pathPoints(d: string): [number, number][] {
  const out: [number, number][] = [];
  const argc: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const seg of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const cmd = seg[1]!;
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const nums = (seg[2]!.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    if (lower === 'z') {
      x = sx;
      y = sy;
      continue;
    }
    const n = argc[lower]!;
    if (nums.length === 0 || nums.length % n !== 0) throw new Error(`bad argument count for ${cmd} in ${d}`);
    for (let i = 0; i < nums.length; i += n) {
      const a = nums.slice(i, i + n);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      if (lower === 'h') x = ox + a[0]!;
      else if (lower === 'v') y = oy + a[0]!;
      else if (lower === 'a') {
        x = ox + a[5]!;
        y = oy + a[6]!;
      } else {
        for (let k = 0; k + 1 < n; k += 2) if (k + 2 < n) out.push([ox + a[k]!, oy + a[k + 1]!]);
        x = ox + a[n - 2]!;
        y = oy + a[n - 1]!;
      }
      if (lower === 'm' && i === 0) {
        sx = x;
        sy = y;
      }
      out.push([x, y]);
    }
  }
  return out;
}

const known = (n: string): boolean => (ICON_NAMES as readonly string[]).includes(n) || n in ICON_ALIASES;

describe('icon set', () => {
  it('keeps every icon name the app used before', () => {
    expect(LEGACY_NAMES.filter((n) => !known(n))).toEqual([]);
  });

  it('has every icon the design brief lists', () => {
    expect(REQUIRED_NAMES.filter((n) => !known(n))).toEqual([]);
  });

  it('aliases point at real drawings', () => {
    for (const [alias, target] of Object.entries(ICON_ALIASES)) {
      expect(ICON_NAMES as readonly string[], `${alias} -> ${target}`).toContain(target);
      expect(ICON_NAMES as readonly string[], `${alias} must not shadow a drawing`).not.toContain(alias);
    }
  });

  it('has no duplicate drawings under different names (use an alias)', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const n of ICON_NAMES) {
      const d = iconMarkup(n).replace(/class="[^"]*"/, '');
      const other = seen.get(d);
      if (other) dups.push(`${n} == ${other}`);
      seen.set(d, n);
    }
    // why and help-circle are the same question mark on purpose (the tool and the generic help glyph); back and chevron-left too.
    expect(dups.sort()).toEqual(['chevron-left == back', 'help-circle == why']);
  });

  it('every drawing is valid path data whose points stay on the 24 px grid', () => {
    for (const n of ICON_NAMES) {
      const ds = [...iconMarkup(n).matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
      expect(ds.length, n).toBeGreaterThan(0);
      for (const d of ds) {
        const pts = pathPoints(d);
        expect(pts.length, `${n}: ${d}`).toBeGreaterThan(0);
        for (const [x, y] of pts) {
          expect(x, `${n}: ${d}`).toBeGreaterThanOrEqual(0.5);
          expect(x, `${n}: ${d}`).toBeLessThanOrEqual(23.5);
          expect(y, `${n}: ${d}`).toBeGreaterThanOrEqual(0.5);
          expect(y, `${n}: ${d}`).toBeLessThanOrEqual(23.5);
        }
      }
    }
  });

  it('markup uses currentColor and a 2 px round stroke by default', () => {
    const m = iconMarkup('flame');
    expect(m).toContain('stroke="currentColor"');
    expect(m).toContain('stroke-width="2"');
    expect(m).toContain('stroke-linecap="round"');
    expect(m).toContain('aria-hidden="true"');
    expect(iconMarkup('play')).toContain('fill="currentColor"');
    expect(iconMarkup('flame', { filled: true })).toContain('fill="currentColor"');
    expect(iconMarkup('my-location')).toContain('fill="currentColor" stroke="none"'); // the centre dot
  });

  it('an alias draws the same as its target', () => {
    const strip = (s: string): string => s.replace(/class="[^"]*"/, '');
    for (const [alias, target] of Object.entries(ICON_ALIASES)) expect(strip(iconMarkup(alias as IconName))).toBe(strip(iconMarkup(target as IconName)));
  });
});
