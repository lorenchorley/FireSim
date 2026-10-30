/**
 * The controls of the wind arrows and flow lines (0.5.0, stage E1): the "Arrows and flow lines" switch, and under it, once it is on, the
 * Wind height chips with a caption and a line about the zoom. One builder serves the Layers panel row and the Map view tab of the Air
 * slices tool, so the two are the same state by construction: both read and write the layer store (`ctx.layers`), the scene (`view.setLayers`)
 * and the remembered choices, and each listens to the store, so a change made in one is there when the other is shown.
 *
 * Thin by design (plan section 4, rule 8): what the control says is `glyphView` in glyphWords.ts (pure, tested); this file builds the
 * elements and paints that. The chips are built the first time the switch is on (the Layers panel's DOM budget). The caption follows
 * the layer's own statistics (`view.windGlyphStats()`), read twice a second only while the controls are on screen and the switch is on,
 * and text is rewritten only when it changed. Nothing pops up by itself, nothing is announced for a zoom, and nothing here changes the simulation.
 */
import { airKind, airTime, hasAirWind } from '../../../core/airView';
import { availabilityContext, layerById } from '../../../render/layerCatalog';
import type { LayerState } from '../../../render/layers';
import { h, listen, text, uniqueId } from '../../dom';
import { chipChoice, toggle, type Segmented } from '../../widgets';
import type { SimContext } from './context';
import { WIND_HEIGHT_CHIPS, WIND_HEIGHT_LABEL, glyphIntro, glyphView, windHeightOf, type GlyphAir } from './glyphWords';
import { rememberLayerChoice } from './layersPrefs';
import { createWindMapSwitch, type WindMapSwitch } from './windMapSwitch';

/** How often the caption looks at the layer's statistics while it is on screen (ms). */
const POLL_MS = 500;

export interface WindGlyphControls {
  /** The switch (a `label.toggle` with the test id `layer-windGlyphs`). */
  switchEl: HTMLElement;
  /** The box under it: why the switch cannot be used, and the Wind height chips, caption and zoom line while it is on. */
  settingsEl: HTMLElement;
  /** Put the keyboard focus on the switch. */
  focus(): void;
  destroy(): void;
}

/**
 * `intro`: one line under the switch while it is off, and `label`: the switch's name where "Wind" is not already in the heading above it. Both are for the
 * Map view tab, which has neither the Layers panel's "Wind and air" heading nor its (i) button; the Layers row keeps the catalog's title.
 */
export function createWindGlyphControls(ctx: Pick<SimContext, 'layers' | 'view' | 'session' | 'tz' | 'absTime'>, opts: { intro?: boolean; label?: string } = {}): WindGlyphControls {
  const { layers, view } = ctx;
  const info = layerById('windGlyphs')!;
  // The 3-D view draws the glyphs and reports on them; the 2-D stand-in map has neither (nor an air, nor a slice).
  const has3dView = typeof view.windGlyphStats === 'function' || typeof view.slice === 'function';

  /** The view first, then the store (its subscribers read the view's new state), then the remembered choice: the Layers panel's order. */
  const set = (p: Partial<LayerState>): void => {
    view.setLayers(p);
    layers.set(p);
    void rememberLayerChoice({ layers: p });
  };
  const availability = (): { ok: boolean; reason?: string } => {
    try {
      return info.available(availabilityContext({ snapshot: ctx.session.state.get().snapshot }));
    } catch {
      return { ok: false, reason: 'Not available here' };
    }
  };
  /** The air that is drawn: the picture shown, the grid it is on and when it was made (null before there is a wind to draw). */
  const airNow = (): GlyphAir | null => {
    const snap = ctx.session.state.get().snapshot;
    const atm = snap?.atmosphere;
    if (!snap || !atm || !hasAirWind(atm)) return null;
    return { cellM: atm.grid.cellSize, airTime: airTime(atm), shownTime: snap.time, diagnosed: airKind(atm) === 'diagnosed' };
  };

  // ───────────── the switch ─────────────
  const sw = toggle({ label: opts.label ?? info.title, checked: layers.get().windGlyphs, testId: 'layer-windGlyphs', onChange: (v) => set({ windGlyphs: v }) });
  const input = sw.el.querySelector('input')!;
  const reasonId = uniqueId('wg-reason');
  const reason = h('p', { class: 'hint wg-reason', id: reasonId, hidden: true, dataset: { testid: 'wind-glyph-reason' } });
  const introId = uniqueId('wg-intro');
  const intro = h('p', { class: 'hint wg-intro', id: introId, hidden: true, dataset: { testid: 'wind-glyph-intro' } });

  // ───────────── the chips, the caption and the zoom line (built the first time the switch is on) ─────────────
  interface Options {
    el: HTMLElement;
    chips: Segmented<string>;
    caption: HTMLElement;
    level: HTMLElement;
    mapSwitch: WindMapSwitch;
  }
  let options: Options | null = null;
  const buildOptions = (): Options => {
    const chips = chipChoice<string>({
      label: WIND_HEIGHT_LABEL,
      options: [...WIND_HEIGHT_CHIPS],
      value: String(layers.get().windHeight),
      testId: 'wind-height',
      onChange: (v) => {
        const height = windHeightOf(v);
        if (height !== null) set({ windHeight: height });
      },
    });
    const caption = h('p', { class: 'hint wg-caption', hidden: true, dataset: { testid: 'wind-glyph-caption' } });
    const level = h('p', { class: 'hint wg-level', hidden: true, dataset: { testid: 'wind-glyph-level' } });
    const mapSwitch = createWindMapSwitch(ctx); // "Colour the map by speed" (0.7.0, E1b): its chip sits under the height chips
    return { el: h('div', { class: 'wg-options' }, [chips.el, mapSwitch.el, caption, level]), chips, caption, level, mapSwitch };
  };
  const settingsEl = h('div', { class: 'wg-box', dataset: { testid: 'wind-glyph-box' } }, opts.intro ? [reason, intro] : reason);

  let lastOk = availability().ok;
  const paint = (): void => {
    const s = layers.get();
    const a = availability();
    lastOk = a.ok;
    sw.set(s.windGlyphs);
    const v = glyphView({
      height: s.windHeight,
      on: s.windGlyphs,
      has3dView,
      availability: a,
      stats: has3dView ? (view.windGlyphStats?.() ?? null) : null,
      air: airNow(),
      tz: ctx.tz,
      absTime: ctx.absTime,
    });
    // A switch that cannot be used says why, in words next to it; one that is on stays operable, so it can always be turned off.
    input.disabled = !!v.reason && !s.windGlyphs;
    text(reason, v.reason ?? '');
    reason.hidden = !v.reason;
    const hint = opts.intro ? glyphIntro(s.windGlyphs, v.reason) : '';
    text(intro, hint);
    intro.hidden = !hint;
    if (v.reason || hint) input.setAttribute('aria-describedby', v.reason ? reasonId : introId);
    else input.removeAttribute('aria-describedby');
    if (s.windGlyphs && !options) {
      options = buildOptions();
      settingsEl.append(options.el);
    }
    if (options) {
      // (A remembered "on" in the 2-D map has nothing to choose a height for: the reason above says so, and the switch stays operable to turn it off.)
      options.el.hidden = !s.windGlyphs || !has3dView;
      if (options.chips.get() !== String(s.windHeight)) options.chips.set(String(s.windHeight));
      options.mapSwitch.update();
      text(options.caption, v.caption.join('\n'));
      options.caption.hidden = v.caption.length === 0;
      text(options.level, v.level);
      options.level.hidden = v.level === '';
    }
    syncPoll();
  };

  // ───────────── the poll: only while it can be seen ─────────────
  let onScreen = typeof IntersectionObserver !== 'function';
  let timer: ReturnType<typeof setInterval> | null = null;
  function syncPoll(): void {
    const want = has3dView && !!options && layers.get().windGlyphs && onScreen && document.visibilityState !== 'hidden';
    if (want && !timer) timer = setInterval(paint, POLL_MS);
    else if (!want && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          const visible = entries[entries.length - 1]!.isIntersecting;
          if (visible === onScreen) return;
          onScreen = visible;
          if (visible) paint(); // (its own syncPoll) the numbers are current the moment it is shown
          else syncPoll();
        })
      : null;
  io?.observe(settingsEl);

  const unsubs = [
    layers.subscribe(paint, ['windGlyphs', 'windHeight']),
    // The air arrives a moment after Play: the switch comes alive then (only a change of the answer repaints; the poll does the rest).
    ctx.session.state.subscribe(() => {
      if (availability().ok !== lastOk) paint();
    }, ['snapshot']),
    listen(document, 'visibilitychange', syncPoll),
  ];
  paint();

  return {
    switchEl: sw.el,
    settingsEl,
    focus: () => input.focus(),
    destroy() {
      for (const u of unsubs) u();
      io?.disconnect();
      options?.mapSwitch.destroy();
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
