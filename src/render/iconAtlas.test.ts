/**
 * The map icons' drawing (iconAtlas.ts): every icon has a glyph, the picture in the panel is cut from the same atlas the 3-D layer
 * samples (one cached data URL per icon), the old module still exports the same names, and no three.js reaches the first screen
 * through it (the UI imports iconAtlas for the "Why here?" row; if it pulled in the 3-D code the entry chunk would carry it).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICON_ART, ICON_CELL, ICON_SLOTS, Icon, paintAtlas, severityIcon } from './iconAtlas';
import { Icon as LayerIcon, severityIcon as layerSeverityIcon } from './iconLayer';

const ICONS: Icon[] = Object.values(Icon).filter((v): v is Icon => typeof v === 'number');

/** A 2-D context that records which atlas cell every fill, stroke and text lands in (translate / save / restore tracked). */
class RecordingContext {
  readonly painted = new Set<number>();
  readonly images: number[][] = [];
  private tx = 0;
  private readonly stack: number[] = [];
  save(): void {
    this.stack.push(this.tx);
  }
  restore(): void {
    this.tx = this.stack.pop() ?? 0;
  }
  translate(x: number): void {
    this.tx += x;
  }
  private paint(): void {
    this.painted.add(Math.round(this.tx / ICON_CELL));
  }
  fill(): void {
    this.paint();
  }
  stroke(): void {
    this.paint();
  }
  fillText(): void {
    this.paint();
  }
  drawImage(...a: unknown[]): void {
    this.images.push(a.slice(1).map(Number));
  }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  arc(): void {}
  bezierCurveTo(): void {}
}

describe('the atlas drawing', () => {
  it('the icons are numbered 0 to 6 and fit the atlas', () => {
    expect(ICONS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Math.max(...ICONS)).toBeLessThan(ICON_SLOTS);
  });

  it('every Icon has a glyph: something is painted in its cell and it has a square of art to cut out', () => {
    const g = new RecordingContext();
    paintAtlas(g as unknown as CanvasRenderingContext2D);
    for (const icon of ICONS) {
      expect(g.painted.has(icon), `Icon ${Icon[icon]} is painted in its cell`).toBe(true);
      const art = ICON_ART[icon];
      expect(art, `Icon ${Icon[icon]} has an art box`).toBeDefined();
      const [cx, cy, half] = art;
      expect(cx - half).toBeGreaterThanOrEqual(0);
      expect(cy - half).toBeGreaterThanOrEqual(0);
      expect(cx + half).toBeLessThanOrEqual(ICON_CELL);
      expect(cy + half).toBeLessThanOrEqual(ICON_CELL);
    }
    expect([...g.painted].sort()).toEqual(ICONS); // and nothing is painted outside a known cell
  });

  it('severities map to the three insight shapes', () => {
    expect([severityIcon('info'), severityIcon('watch'), severityIcon('danger')]).toEqual([Icon.Info, Icon.Watch, Icon.Danger]);
  });

  it('iconLayer.ts still exports the same Icon and severityIcon', () => {
    expect(LayerIcon).toBe(Icon);
    expect(layerSeverityIcon).toBe(severityIcon);
  });
});

describe('iconGlyphUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** A document whose canvases record what is drawn on them, and whose toDataURL says what was cut out. */
  function stubDocument(): { created: () => number } {
    let n = 0;
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
        n++;
        const ctx = new RecordingContext();
        const cv = {
          width: 0,
          height: 0,
          getContext: () => ctx,
          toDataURL: () => `data:image/png;base64,${cv.width}x${cv.height}:${ctx.images.map((i) => i.join(',')).join(';')}`,
        };
        return cv;
      },
    });
    return { created: () => n };
  }

  it('is empty where there is no canvas (node)', async () => {
    const { iconGlyphUrl } = await import('./iconAtlas');
    expect(iconGlyphUrl(Icon.User)).toBe('');
  });

  it('gives every icon its own data URL, cut from its own cell of the atlas, and keeps it (one per icon)', async () => {
    const doc = stubDocument();
    const { iconGlyphUrl, ICON_ART: art, ICON_CELL: cell } = await import('./iconAtlas');
    const urls = ICONS.map((i) => iconGlyphUrl(i));
    expect(urls.every((u) => u.startsWith('data:image/png;base64,96x96:'))).toBe(true);
    expect(new Set(urls).size).toBe(ICONS.length);
    const made = doc.created();
    expect(made).toBe(1 + ICONS.length); // the atlas once, then one small canvas per icon
    // the second look is the cache: same strings, no new canvas
    expect(ICONS.map((i) => iconGlyphUrl(i))).toEqual(urls);
    expect(doc.created()).toBe(made);
    // the source square is the icon's art box, inside its own cell
    ICONS.forEach((i, k) => {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = urls[k]!.split('96x96:')[1]!.split(',').map(Number);
      const a = art[i] as readonly number[];
      expect([sx, sy, sw, sh, dx, dy, dw, dh]).toEqual([i * cell + a[0]! - a[2]!, a[1]! - a[2]!, a[2]! * 2, a[2]! * 2, 0, 0, 96, 96]);
      expect(sx).toBeGreaterThanOrEqual(i * cell);
      expect(sx! + sw!).toBeLessThanOrEqual((i + 1) * cell);
    });
  });

  it('another size is another picture of the same icon', async () => {
    stubDocument();
    const { iconGlyphUrl } = await import('./iconAtlas');
    expect(iconGlyphUrl(Icon.Spot, 48)).toContain('48x48');
    expect(iconGlyphUrl(Icon.Spot, 48)).not.toBe(iconGlyphUrl(Icon.Spot));
  });
});

// ── no three.js in the first screen's code through iconAtlas ──

const SRC = resolve(__dirname, '..');

/** The modules a TypeScript file imports at run time (type-only imports are erased and not followed). */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = new Set<string>();
  for (const re of [/\b(?:import|export)\b(?!\s+type\b)[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (let m = re.exec(text); m; m = re.exec(text)) found.add(m[1]!);
  }
  return [...found];
}

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, base, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Every file reachable from `entry` through relative imports, and the packages it names on the way. */
function closure(entry: string): { files: Map<string, string>; packages: Map<string, string> } {
  const files = new Map<string, string>([[entry, '']]);
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    for (const spec of importsOf(f)) {
      if (spec.startsWith('.')) {
        const r = resolveModule(f, spec);
        if (r && !files.has(r)) {
          files.set(r, f);
          queue.push(r);
        }
      } else if (!packages.has(spec)) packages.set(spec, f);
    }
  }
  return { files, packages };
}

describe('iconAtlas stays out of the 3-D code', () => {
  it('the walk finds the palette and the core types (so an empty answer cannot pass)', () => {
    const { files } = closure(join(SRC, 'render', 'iconAtlas.ts'));
    const names = [...files.keys()].map((f) => f.slice(SRC.length + 1));
    expect(names).toContain(join('render', 'palette.ts'));
    expect(names).toContain(join('core', 'types.ts'));
  });

  it('nothing reachable from iconAtlas.ts imports three', () => {
    const { files, packages } = closure(join(SRC, 'render', 'iconAtlas.ts'));
    const via = [...packages].filter(([p]) => p === 'three' || p.startsWith('three/')).map(([p, f]) => `${p} from ${f.slice(SRC.length + 1)}`);
    expect(via).toEqual([]);
    // and none of the render layers that do import it
    const layers = [...files.keys()].map((f) => f.slice(SRC.length + 1)).filter((f) => /render[\\/](\w+Layer|SceneView|cameraRig|textures|terrainLayer)\.ts$/.test(f));
    expect(layers).toEqual([]);
  });

  it('the walk does see three where it is imported (iconLayer.ts)', () => {
    expect([...closure(join(SRC, 'render', 'iconLayer.ts')).packages.keys()]).toContain('three');
  });
});
