/** The UI's built-in (fallback) legends for the data-layer heat maps say exactly what the renderer's legends say. */
import { describe, expect, it } from 'vitest';
import { legendFor as uiLegendFor } from '../ui/legends';
import { HEAT_OVERLAY_KINDS } from './layerCatalog';
import { legendFor } from './legends';

const DATA_KINDS = ['elevation', 'landform', 'canopyHeight', 'canopyCover', 'elevatedHazard', 'elevatedHeight', 'surfaceHazard', 'nearSurfaceHazard', 'barkHazard', 'grassCuring', 'fireHistoryKind', 'homeDensity', 'roadAccess', 'windSpeed'] as const;

describe('UI fallback legends mirror the renderer legends', () => {
  for (const kind of DATA_KINDS) {
    it(kind, () => {
      const ui = uiLegendFor(kind)!;
      const r = legendFor(kind, {})!;
      expect(ui, kind).not.toBeNull();
      expect(ui.title).toBe(r.title);
      expect(ui.unit).toBe(r.units);
      expect(ui.about).toBe(r.note);
      if (r.kind === 'continuous') {
        expect(ui.kind).toBe('ramp');
        if (ui.kind !== 'ramp') return;
        expect(ui.stops).toEqual(r.entries.map((e) => ({ colour: e.colour, label: e.label })));
        expect(ui.gradient).toBe(r.gradient);
        expect(ui.extra ?? []).toEqual(r.noData ? [{ colour: r.noData.colour, label: r.noData.label }] : []);
      } else {
        expect(ui.kind).toBe('classes');
        if (ui.kind !== 'classes') return;
        const expected = r.entries.map((e) => ({ colour: e.colour, label: e.label, ...(e.words ? { note: e.words } : {}) }));
        if (r.noData) expected.push({ colour: r.noData.colour, label: r.noData.label });
        expect(ui.classes).toEqual(expected);
      }
    });
  }

  it('every heat layer the renderer can draw has a built-in legend', () => {
    for (const kind of HEAT_OVERLAY_KINDS) expect(uiLegendFor(kind), kind).not.toBeNull();
  });
});
