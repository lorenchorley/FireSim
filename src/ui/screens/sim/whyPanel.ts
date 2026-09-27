/**
 * "Why here?" panel: the CellExplanation for a tapped point — narrative bullets, the multiplicative factor
 * breakdown of the spread rate (base × wind × slope × moisture × fuel × terrain) as log-scaled bars, fuel summary,
 * litter moisture, time since fire, arrival time, intensity, flame height and the dominant driver.
 */
import { SpreadDriver, type CellExplanation } from '../../../core/types';
import { h, setChildren } from '../../dom';
import { icon } from '../../icons';
import { compassName, formatClock, formatElapsedShort, formatIntensity, formatMetres, formatMultiplier, formatRos, formatWind, formatYears } from '../../format';
import { DRIVER_LABELS, LANDFORM_LABELS } from '../../labels';
import { driverColour } from '../../legends';
import type { SimContext } from './context';

export interface FactorRow {
  label: string;
  factor: number;
  /** Why this factor is what it is. */
  note: string;
}

/** Rows of the factor breakdown (pure). */
export function factorRows(e: CellExplanation): FactorRow[] {
  const f = e.factors;
  return [
    { label: 'Wind', factor: f.wind, note: `${compassName(e.windDir10)} ${Math.round(e.windSpeed10 * 3.6)} km/h` },
    { label: 'Slope', factor: f.slope, note: e.slopeDeg < 2 ? 'flat' : Math.abs(f.slope - 1) < 0.03 ? `${Math.round(e.slopeDeg)}° across the slope` : `${Math.round(e.slopeDeg)}° ${f.slope > 1 ? 'uphill' : 'downhill'}` },
    { label: 'Litter moisture', factor: f.moisture, note: `${e.deadFuelMoisture.toFixed(1)}%` },
    { label: 'Fuel', factor: f.fuel, note: 'load and structure' },
    { label: 'Terrain effects', factor: f.terrain, note: f.terrain > 1.05 ? 'eruptive / channelling' : 'none' },
  ];
}

/** Bar geometry for a multiplier on a log scale centred at ×1 (±50 % of the track at ×`maxF` or ÷`maxF`). */
export function barGeometry(factor: number, maxF = 16): { left: number; width: number; up: boolean } {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const frac = Math.min(1, Math.abs(Math.log(f)) / Math.log(maxF)) * 50;
  const up = f >= 1;
  return { left: up ? 50 : 50 - frac, width: Math.max(frac, 0.8), up };
}

export function createWhyPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const content = h('div', { class: 'panel-body' });
  const el = h('section', { class: 'tool-panel why-panel', dataset: { testid: 'why-panel' }, aria: { label: 'Why here?' } }, [
    h('header', { class: 'panel-head' }, [
      h('h2', { class: 'panel-title' }, [icon('why'), 'Why here?']),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon', aria: { label: 'Close' }, on: { click: onClose } }, icon('close')),
    ]),
    content,
  ]);

  const render = (): void => {
    const w = ctx.ui.get().why;
    if (!w) {
      setChildren(content, h('p', { class: 'hint' }, 'Tap anywhere on the map to see what drives the fire at that spot.'));
      return;
    }
    if (w.loading) {
      setChildren(content, h('p', { class: 'status-line' }, [h('span', { class: 'spinner', aria: { hidden: true } }), 'Working out why…']));
      return;
    }
    if (w.error || !w.explanation) {
      setChildren(content, h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, w.error ?? 'No explanation available here.')]));
      return;
    }
    const e = w.explanation;
    const burnt = Number.isFinite(e.arrivalTime);
    const unit = ctx.settings.get().units;
    const rows = factorRows(e);
    const base = e.factors.base;
    setChildren(content, [
      h('p', { class: 'why-place' }, [
        h('strong', null, LANDFORM_LABELS[e.landform] ?? 'Slope'),
        ` · ${Math.round(e.slopeDeg)}°\u00a0slope${Number.isFinite(e.aspectDeg) ? ` facing\u00a0${compassName(e.aspectDeg)}` : ''} · ${Math.round(e.elevation)}\u00a0m`,
      ]),
      h('p', { class: 'why-when' }, `At ${formatClock(ctx.absTime(w.time), ctx.tz)} (${formatElapsedShort(w.time)}) · updates as you play`),
      burnt && e.driver !== SpreadDriver.None
        ? h('p', { class: 'driver-chip' }, [h('span', { class: 'swatch', style: { background: driverColour(e.driver) } }), 'Main driver: ', h('strong', null, DRIVER_LABELS[e.driver])])
        : h('p', { class: 'driver-chip muted' }, [icon('info', { size: 18 }), burnt ? 'Burnt' : 'Not burnt yet — showing what a head fire would do here now']),
      h(
        'ul',
        { class: 'narrative' },
        e.narrative.map((n) => h('li', null, n)),
      ),
      h('h3', { class: 'sub-title' }, 'What sets the spread rate'),
      h('div', { class: 'factor-table', attrs: { role: 'table', 'aria-label': 'Spread-rate factors' } }, [
        h('div', { class: 'factor-row base', attrs: { role: 'row' } }, [
          h('span', { class: 'factor-label', attrs: { role: 'cell' } }, 'Flat ground, no wind'),
          h('span', { class: 'factor-bar', attrs: { role: 'cell' } }, h('span', { class: 'factor-note' }, 'starting point for this fuel')),
          h('span', { class: 'factor-value', attrs: { role: 'cell' } }, formatRos(base)),
        ]),
        ...rows.map((r) => {
          const g = barGeometry(r.factor);
          return h('div', { class: 'factor-row', attrs: { role: 'row' } }, [
            h('span', { class: 'factor-label', attrs: { role: 'cell' } }, [r.label, h('span', { class: 'factor-note' }, r.note)]),
            h('span', { class: 'factor-bar', attrs: { role: 'cell', 'aria-hidden': 'true' } }, [h('span', { class: 'factor-mid' }), h('span', { class: ['factor-fill', g.up ? 'up' : 'down'], style: { left: `${g.left}%`, width: `${g.width}%` } })]),
            h('span', { class: ['factor-value', r.factor >= 1.05 ? 'up' : r.factor <= 0.95 ? 'down' : ''], attrs: { role: 'cell' } }, formatMultiplier(r.factor)),
          ]);
        }),
        h('div', { class: 'factor-row total', attrs: { role: 'row' } }, [
          h('span', { class: 'factor-label', attrs: { role: 'cell' } }, burnt ? 'Spread rate here' : 'Head fire here now'),
          h('span', { class: 'factor-bar', attrs: { role: 'cell' } }),
          h('span', { class: 'factor-value', attrs: { role: 'cell' } }, formatRos(e.ros)),
        ]),
      ]),
      h('dl', { class: 'facts' }, [
        fact('Fuel', e.fuelSummary, 'wide'),
        fact('Litter moisture', `${e.deadFuelMoisture.toFixed(1)}%`),
        fact('Time since fire', formatYears(e.timeSinceFire)),
        fact('Wind here', `${compassName(e.windDir10)} ${formatWind(e.windSpeed10, unit)}`),
        fact('Fire arrived', burnt ? `${formatClock(ctx.absTime(e.arrivalTime), ctx.tz)} (${formatElapsedShort(e.arrivalTime)})` : 'Not yet'),
        fact('Intensity', burnt ? formatIntensity(e.intensity) : '–'),
        fact('Flame height', burnt ? formatMetres(e.flameHeight) : '–'),
      ]),
    ]);
  };
  const unsub = ctx.ui.subscribe(render, ['why']);
  render();
  return { el, destroy: unsub };
}

function fact(label: string, value: string, cls?: string): HTMLElement[] {
  return [h('dt', { class: cls }, label), h('dd', { class: cls }, value)];
}
