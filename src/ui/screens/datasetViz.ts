/**
 * Small pictures of a data set for the Data sets screen: a heat-map preview drawn once on a canvas from the scenario's
 * own arrays, with the SAME values and colour scale as the matching heat map of the 3-D view (render/fields.ts
 * overlayField + render/legends.ts overlayScale / overlayColour / legendFor), and its legend with the share of the area
 * in each class. North is up. A light hill shade (from the terrain grid, when the field is on it) makes the ground
 * readable; the colours are otherwise the heat map's.
 *
 * {@link heatPreviewData} is pure (typed arrays in, pixels and legend facts out; unit-tested); {@link heatPreview} puts it
 * on a canvas and returns a dispose() that frees the pixels when the page closes.
 */
import { formatPercent } from '../../core/datasets';
import type { ScenarioData, SimSnapshot } from '../../core/types';
import { overlayField, type OverlaySources } from '../../render/fields';
import { legendFor, NO_DATA_THRESHOLD, overlayColour, overlayScale, type LegendSpec } from '../../render/legends';
import type { OverlayKind } from '../../render/layers';
import { h } from '../dom';
import { clean } from './datasetsModel';

export interface HeatPreviewData {
  overlay: OverlayKind;
  width: number;
  height: number;
  /** RGBA pixels, row 0 = north. */
  rgba: Uint8ClampedArray;
  legend: LegendSpec | null;
  /** Legend rows with the share of the valued cells in each (categorical: only the classes present, largest first). */
  keys: { colour: string; label: string; share: number }[];
  /** Lowest and highest value in this area, in legend units (continuous maps). */
  range: [number, number] | null;
  /** Share of the cells with no value (drawn clear or in the no-data colour). */
  noDataShare: number;
  cells: number;
}

/**
 * The preview of a heat map for a scenario (and the latest snapshot for the live maps: moisture, wind), or null when the
 * map cannot be computed from what is loaded (no roads for the distance map, no 3-D wind yet).
 */
export function heatPreviewData(overlay: OverlayKind, scenario: Pick<ScenarioData, 'terrain' | 'fuel' | 'context'>, snapshot?: Pick<SimSnapshot, 'moisture' | 'atmosphere' | 'layers' | 'fire'> | null): HeatPreviewData | null {
  if (overlay === 'none') return null;
  const src: OverlaySources = {
    terrain: scenario.terrain,
    fuel: scenario.fuel,
    context: scenario.context ?? null,
    moisture: snapshot?.moisture ?? null,
    atmosphere: snapshot?.atmosphere ?? null,
    layers: snapshot?.layers ?? null,
    fire: snapshot?.fire ?? null,
  };
  let field;
  try {
    field = overlayField(overlay, src);
  } catch {
    return null;
  }
  if (!field) return null;
  const t = scenario.terrain;
  const ctx = Number.isFinite(t.minElevation) && Number.isFinite(t.maxElevation) && t.maxElevation > t.minElevation ? { elevationRange: [t.minElevation, t.maxElevation] as const } : {};
  const scale = overlayScale(overlay, ctx);
  if (!scale) return null;
  const legend = legendFor(overlay, ctx);
  const { nx, ny } = field.grid;
  const n = nx * ny;
  const vals = field.values;
  const rgba = new Uint8ClampedArray(n * 4);
  // A light hill shade from the terrain when the field is on the terrain grid (sun from the north-west, 45° up).
  const shadeOk = t.grid.nx === nx && t.grid.ny === ny && t.slopeDeg.length === n;
  const sunAz = (315 * Math.PI) / 180;
  const sunZen = (45 * Math.PI) / 180;
  let lo = Infinity;
  let hi = -Infinity;
  let noData = 0;
  const counts = new Map<number, number>();
  const classOf = (v: number): number => {
    if (!legend || legend.kind !== 'classes') return -1;
    let k = 0;
    for (let i = 0; i < legend.entries.length; i++) if (v >= legend.entries[i]!.value) k = i;
    return k;
  };
  for (let j = 0; j < ny; j++) {
    const row = ny - 1 - j; // north up
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const v = vals[k]!;
      const p = (row * nx + i) * 4;
      const valued = Number.isFinite(v) && v > NO_DATA_THRESHOLD;
      if (!valued) noData++;
      else {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        const key = legend?.kind === 'categorical' ? Math.round(v) : legend?.kind === 'classes' ? classOf(v) : -1;
        if (key >= 0) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const c = overlayColour(scale, v);
      if (!c) continue;
      let s = 1;
      if (shadeOk) {
        const sl = (t.slopeDeg[k]! * Math.PI) / 180;
        const asp = t.aspectDeg[k]!;
        const lambert = Number.isFinite(asp) ? Math.cos(sunZen) * Math.cos(sl) + Math.sin(sunZen) * Math.sin(sl) * Math.cos(sunAz - (asp * Math.PI) / 180) : Math.cos(sunZen);
        s = 0.8 + 0.28 * Math.max(0, Math.min(1, lambert));
      }
      rgba[p] = Math.round(Math.min(1, c[0] * s) * 255);
      rgba[p + 1] = Math.round(Math.min(1, c[1] * s) * 255);
      rgba[p + 2] = Math.round(Math.min(1, c[2] * s) * 255);
      rgba[p + 3] = Math.round(c[3] * 255);
    }
  }
  const valued = n - noData;
  let keys: HeatPreviewData['keys'] = [];
  if (legend) {
    if (legend.kind === 'categorical') {
      keys = legend.entries
        .map((e) => ({ colour: e.colour, label: clean(e.label), share: valued > 0 ? (counts.get(Math.round(e.value)) ?? 0) / valued : 0 }))
        .filter((e) => e.share > 0 && e.label)
        .sort((a, b) => b.share - a.share);
    } else if (legend.kind === 'classes') {
      keys = legend.entries.map((e, i) => ({ colour: e.colour, label: clean(e.label), share: valued > 0 ? (counts.get(i) ?? 0) / valued : 0 })).filter((e) => e.label);
    } else keys = legend.entries.map((e) => ({ colour: e.colour, label: clean(e.label), share: 0 })).filter((e) => e.label);
  }
  return {
    overlay,
    width: nx,
    height: ny,
    rgba,
    legend,
    keys,
    range: valued > 0 && Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null,
    noDataShare: n > 0 ? noData / n : 0,
    cells: n,
  };
}

const num = (v: number): string => {
  const a = Math.abs(v);
  return a >= 1000 ? Math.round(v).toLocaleString('en-AU').replace(/,/g, ' ') : a >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
};

/** The preview on a canvas with its legend. `title` names the picture for screen readers. */
export function heatPreview(d: HeatPreviewData, title: string): { el: HTMLElement; dispose(): void } {
  const canvas = h('canvas', { class: 'ds-thumb-canvas', width: d.width, height: d.height, attrs: { role: 'img', 'aria-label': `${title}: preview of the heat map, north up` } });
  const g = canvas.getContext('2d');
  if (g) {
    const img = g.createImageData(d.width, d.height);
    img.data.set(d.rgba);
    g.putImageData(img, 0, 0);
  }
  if (d.legend?.kind === 'categorical') canvas.classList.add('is-categorical');
  const L = d.legend;
  const unit = clean(L?.units);
  const legendEl: HTMLElement[] = [];
  if (L) {
    if ((L.kind === 'continuous' || L.kind === 'cyclic') && L.gradient) {
      const first = d.keys[0];
      const last = d.keys[d.keys.length - 1];
      legendEl.push(
        h('div', { class: 'ds-ramp-wrap' }, [
          h('span', { class: 'ds-ramp', style: `background:${L.gradient}`, attrs: { role: 'img', 'aria-label': `Colour scale from ${first?.label ?? ''} to ${last?.label ?? ''}${unit ? ` ${unit}` : ''}` } }),
          h('span', { class: 'ds-ramp-ends t-caption' }, [h('span', null, first?.label ?? ''), h('span', null, `${last?.label ?? ''}${unit && !/[a-z%°]$/i.test(last?.label ?? '') ? ` ${unit}` : ''}`)]),
        ]),
      );
      if (d.range && L.kind === 'continuous') legendEl.push(h('p', { class: 't-caption ds-range' }, `In this area: ${num(d.range[0])} to ${num(d.range[1])}${unit && !/^(time since start|score)/.test(unit) ? ` ${unit}` : ''}`));
    } else {
      legendEl.push(
        h(
          'div',
          { class: 'chips ds-legend', attrs: { role: 'list', 'aria-label': `${clean(L.title) || title}: colour key` } },
          d.keys.map((k) => h('span', { class: 'legend-chip', attrs: { role: 'listitem' } }, [h('span', { class: 'swatch', style: `background:${k.colour}` }), `${k.label}${k.share > 0 ? ` · ${formatPercent(k.share)}` : ''}`])),
        ),
      );
    }
    if (d.noDataShare > 0 && L.noData?.label) {
      const clear = /^#[0-9a-f]{6}00$/i.test(L.noData.colour) || L.noData.colour === 'transparent';
      legendEl.push(
        h('div', { class: 'chips ds-legend' }, h('span', { class: 'legend-chip' }, [h('span', { class: ['swatch', clear && 'ds-swatch-clear'], style: clear ? undefined : `background:${L.noData.colour}` }), `${clean(L.noData.label)} · ${formatPercent(d.noDataShare)}`])),
      );
    }
    if (L.note) legendEl.push(h('p', { class: 'hint ds-legend-note' }, clean(L.note)));
  }
  const el = h('figure', { class: 'ds-thumb' }, [
    h('div', { class: 'ds-thumb-frame' }, [canvas, h('span', { class: 'ds-north t-caption', aria: { hidden: true } }, 'N ↑')]),
    h('figcaption', { class: 'ds-thumb-legend' }, [h('span', { class: 'ds-thumb-title' }, `${clean(L?.title) || title}${unit && L?.kind !== 'categorical' ? ` (${unit})` : ''}`), ...legendEl]),
  ]);
  return {
    el,
    dispose() {
      // Free the pixels at once (a canvas keeps its backing store until it is collected).
      canvas.width = 0;
      canvas.height = 0;
      el.remove();
    },
  };
}
