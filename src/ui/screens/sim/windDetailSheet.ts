/**
 * The Wind detail sheet (0.6.0): the plain-words explanation of the chip. It says which step of wind detail the map shows, what the picture is and where
 * the wind is read, and what holds it back; at the closest zoom it says which part is the air model's and which part (the small eddies) is added for looks.
 * It opens only when the chip is tapped (a bottom sheet of the top bar's popover group: Escape, an outside tap and Back close it) and it is loaded on the
 * first tap, so the entry bundle does not carry the words. Every sentence comes from windDetailWords.ts; this file only lays them out and keeps them current
 * while the sheet is open, four times a second, in place and only when the words change. It says nothing by itself and changes nothing in the simulation.
 */
import { h, text } from '../../dom';
import type { SimContext } from './context';
import { heightLabel } from './glyphWords';
import { createPips } from './windDetailPips';
import { windDetailInput, windDetailState } from './windDetailState';
import { windDetailWords } from './windDetailWords';

/** How often the open sheet looks at the layer's statistics (ms): a camera that is still gliding can change the step under it. */
const POLL_MS = 250;

/** Fill the shell that the top bar made with `transportSheet()` (title, grab handle and Close are already there). */
export function mountWindDetailSheet(ctx: SimContext, panel: HTMLElement, opts: { close(): void }): { refresh(): void; destroy(): void } {
  const title = panel.querySelector('.bottom-sheet-title') as HTMLElement;
  const body = panel.querySelector('.tb-sheet-body') as HTMLElement;
  const pips = createPips();
  const lead = h('p', { class: 'wd-lead', dataset: { testid: 'wind-detail-lead' } });
  const rest = h('div', { class: 'wd-lines', dataset: { testid: 'wind-detail-lines' } });
  body.replaceChildren(h('div', { class: 'wd-head' }, [pips.el, lead]), rest);

  let shown = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  const paint = (): void => {
    const input = windDetailInput(ctx);
    const s = windDetailState(input);
    // The marks were switched off under the open sheet (a fly-to from outside, the air gone): there is nothing left to explain.
    if (!s.visible) {
      opts.close();
      return;
    }
    const w = windDetailWords(s, { heightLabel: heightLabel(input.height), height: input.height, cellM: input.stats?.cellM ?? null });
    const k = `${w.title}\n${s.level}\n${w.lines.join('\n')}`;
    if (k === shown) return;
    shown = k;
    text(title, w.title);
    pips.set(s.level);
    text(lead, w.lines[0] ?? '');
    rest.replaceChildren(...w.lines.slice(1).map((line) => h('p', { class: 'wd-line' }, line)));
  };
  /** Bring the sheet up to date (it does nothing while the sheet is closed) and keep it current while it is open: the timer stops itself soon after it closes. */
  function refresh(): void {
    if (panel.hidden) return;
    paint();
    timer ??= setInterval(() => {
      if (panel.hidden) {
        clearInterval(timer!);
        timer = null;
      } else paint();
    }, POLL_MS);
  }

  return {
    refresh,
    destroy() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
