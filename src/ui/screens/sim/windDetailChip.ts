/**
 * The Wind detail chip (0.6.0): a 44 px pill in the bottom-left stack of the map, directly above the legend card, that says how detailed the wind
 * on the map is at this zoom: the words "Wind detail" and four pips, a filled circle for each step reached and a ring for the rest (the shape carries
 * the step, not the colour). A tap opens the explanation, a bottom sheet of the top bar's popovers (windDetailSheet.ts, loaded on the first tap); simScreen.ts
 * places the chip and hands its button to the top bar.
 *
 * Thin by design (plan section 4, rule 8): what the chip shows is `windDetailState` (pure, tested); this file builds the element and paints it. The state
 * follows the layer's own statistics (`view.windGlyphStats()`), read four times a second only while a wind layer is on, the screen is in view and the page is
 * not hidden, and again at once when a switch, the camera mode or the air changes. The DOM is touched only when the state's key changes, so a still map costs
 * one object read and one string compare four times a second. No animation frame, no live region: nothing is announced for a zoom, and nothing pops up by itself.
 */
import { h, listen } from '../../dom';
import { icon } from '../../icons';
import type { SimContext } from './context';
import { createPips } from './windDetailPips';
import { chipLabel, windDetailInput, windDetailState } from './windDetailState';

/** How often the chip looks at the layer's statistics (ms): a zoom changes them and no store says so. */
const POLL_MS = 250;
export const WIND_DETAIL_LABEL = 'Wind detail';

export interface WindDetail {
  /** The chip (a button, hidden until there is a wind mark to describe): the top bar hangs the explanation sheet on it. */
  button: HTMLButtonElement;
  destroy(): void;
}

export function createWindDetail(ctx: SimContext): WindDetail {
  const pips = createPips();
  const button = h(
    'button',
    { type: 'button', class: 'chip chip-float wind-detail', hidden: true, dataset: { testid: 'wind-detail' }, aria: { haspopup: 'dialog', expanded: false, label: chipLabel(0) } },
    [icon('wind', { size: 18 }), h('span', { class: 'wd-label' }, WIND_DETAIL_LABEL), pips.el],
  );

  let key = '';
  const paint = (): void => {
    const s = windDetailState(windDetailInput(ctx));
    if (s.key === key) return;
    key = s.key;
    button.hidden = !s.visible;
    button.dataset.level = String(s.level);
    button.setAttribute('aria-label', chipLabel(s.level));
    pips.set(s.level);
  };

  // ───────────── the poll: only while it can be seen ─────────────
  let onScreen = typeof IntersectionObserver !== 'function';
  let timer: ReturnType<typeof setInterval> | null = null;
  const syncPoll = (): void => {
    const l = ctx.layers.get();
    const want = (l.windGlyphs || l.wind !== 'off') && onScreen && document.visibilityState !== 'hidden';
    if (want && !timer) timer = setInterval(paint, POLL_MS);
    else if (!want && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          const visible = entries[entries.length - 1]!.isIntersecting;
          if (visible === onScreen) return;
          onScreen = visible;
          if (visible) paint(); // the chip is current the moment the screen is in view
          syncPoll();
        })
      : null;
  io?.observe(ctx.mapEl);

  const refresh = (): void => {
    paint();
    syncPoll();
  };
  const unsubs = [
    ctx.layers.subscribe(refresh, ['windGlyphs', 'wind', 'windHeight']),
    ctx.ui.subscribe(paint, ['viewMode']),
    // The air arrives a moment after Play, and its kind (estimated or simulated) with it.
    ctx.session.state.subscribe(paint, ['snapshot']),
    listen(document, 'visibilitychange', refresh),
  ];
  refresh();

  return {
    button,
    destroy() {
      for (const u of unsubs) u();
      io?.disconnect();
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
