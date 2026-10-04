/**
 * "How this simulation works" (user request: make the simulation's dimensionality and granularity available in-app
 * for full transparency). A full-screen dialog in the flat Maps look: a top app bar with a back arrow and the title, a
 * card with one honest headline sentence from the live values ("Fire spreads in 2-D on a 30 m grid; the air above it is
 * simulated in 3-D (45 × 45 × 20 cells, 200 m apart)"), then seven collapsible groups (the first open):
 *
 *   At a glance · What it can and cannot resolve · How sure are we? · Data in this run · Layers and what they show ·
 *   Engine right now · Words used
 *
 * The content is src/ui/modelInfo.ts (pure, tested); this file only draws it. While the page is open the live values
 * are refreshed at most once per second, in place (text nodes are patched, the structure is rebuilt only when it
 * changes, e.g. after a tier switch), so nothing jumps under the reader's finger. It never opens by itself, never
 * pauses or changes playback (it reads the newest snapshot only), and "Copy as text" confirms with a line of text, not
 * a pop-up. Escape and Android Back close it (the App forwards Back as Escape); Tab stays inside it.
 * Opened from Setup (no scenario) it shows the plan of the Setup's current choice.
 */
import type { ScenarioData, SimSnapshot } from '../../core/types';
import { h, setChildren, uniqueId } from '../dom';
import { icon } from '../icons';
import { cardToText, describeModel, EVIDENCE, type CardBlock, type CardBullet, type ModelCard, type ModelRow, type ModelSection } from '../modelInfo';
import type { Services } from '../modules';
import { badge, iconButton, kv } from '../primitives';
import { defaultSnapshotBudget } from '../session';
import type { Settings } from '../settings';
import { buildRequest, type SetupState } from '../setupModel';
import { appBar, button, copyText } from '../widgets';

export interface ModelCardOptions {
  /** The running scenario; null = a compact preview computed from `request` (opened from Setup). */
  scenario: ScenarioData | null;
  request?: SetupState;
  services: Services;
  getSnapshot?: () => SimSnapshot | null;
  settings: () => Settings;
  onClose(): void;
  onOpenDatasets?(datasetId?: string): void;
}

/** Live values are refreshed at most this often (ms) while the page is open. */
const REFRESH_MS = 1000;

const BULLET_ICON: Record<CardBullet['kind'], Parameters<typeof icon>[0]> = { can: 'check', cannot: 'close', parameterised: 'tune', issue: 'warning', note: 'info' };

export function createModelCardScreen(opts: ModelCardOptions): { el: HTMLElement; destroy(): void } {
  const titleId = uniqueId('mc-title');
  const el = h('section', {
    class: 'screen modelcard-screen',
    attrs: { role: 'dialog', 'aria-labelledby': titleId },
    aria: { modal: 'true' },
    dataset: { testid: 'model-card' },
  });

  const historyBudget = defaultSnapshotBudget();
  const input = (): Parameters<typeof describeModel>[0] => {
    const snapshot = opts.getSnapshot?.() ?? null;
    const settings = opts.settings();
    let request = null;
    if (!opts.scenario && opts.request) {
      try {
        request = buildRequest(opts.request, settings);
      } catch {
        request = null; // e.g. coordinates not valid yet: the card says to choose a place
      }
    }
    return {
      scenario: opts.scenario,
      engine: snapshot?.engine ?? null,
      snapshot,
      settings,
      request,
      historyBudgetBytes: historyBudget,
      engineSource: opts.services.sources.sim,
    };
  };

  let card: ModelCard = describeModel(input());
  const status = h('p', { class: 'mc-status t-secondary', attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { testid: 'model-card-status' } });
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string): void => {
    status.textContent = text;
    status.classList.toggle('is-shown', !!text);
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => say(''), 6000);
  };
  const copy = async (): Promise<void> => {
    const ok = await copyText(cardToText(card));
    say(ok ? 'Copied: the whole page as text, ready to paste.' : 'This phone did not allow copying.');
  };

  // ───────────── header ─────────────
  const bar = appBar({
    title: 'How this simulation works',
    titleId,
    onBack: () => opts.onClose(),
    backLabel: 'Close',
    backTestId: 'model-card-close',
    trailing: iconButton({ icon: 'copy', label: 'Copy as text', onClick: () => void copy(), testId: 'model-card-copy-icon' }),
  });
  const headline = h('p', { class: 'mc-headline', dataset: { testid: 'model-card-headline' } });
  const subtitle = h('p', { class: 'mc-subtitle t-secondary', dataset: { testid: 'model-card-mode' } });
  const modeBadge = h('div', { class: 'mc-mode' });
  const intro = h('section', { class: 'card mc-intro', aria: { label: 'Summary' } }, [
    modeBadge,
    headline,
    subtitle,
    h('div', { class: 'mc-actions cluster' }, [button({ label: 'Copy as text', icon: 'copy', size: 'sm', testId: 'model-card-copy', onClick: () => void copy() })]),
    status,
  ]);
  const main = h('main', { class: 'screen-main mc-main', dataset: { testid: 'model-card-main' } }, intro);
  el.append(bar, main);

  // ───────────── sections ─────────────
  interface Rendered {
    section: HTMLElement;
    body: HTMLElement;
    toggle: HTMLButtonElement;
    summary: HTMLElement;
    /** Stable key → text element (patched in place when only values change). */
    texts: Map<string, HTMLElement>;
    shape: string;
    json: string;
  }
  const rendered = new Map<string, Rendered>();
  const open = new Set<string>(['glance']);

  /** A text element registered under a stable key. */
  const t = (texts: Map<string, HTMLElement>, key: string, tag: 'p' | 'span' | 'h3' | 'dd' | 'dt' | 'strong', cls: string | null, value: string): HTMLElement => {
    const e = h(tag, { class: cls ?? undefined }, value);
    e.dataset.k = key;
    texts.set(key, e);
    return e;
  };

  const renderRow = (r: ModelRow, texts: Map<string, HTMLElement>): HTMLElement => {
    const ev = EVIDENCE[r.evidence];
    const k = (f: string): string => `row:${r.id}:${f}`;
    const keyed = (f: 'resolution' | 'timeStep' | 'method', label: string): { key: string; value: HTMLElement } => ({ key: label, value: t(texts, k(f), 'span', null, r[f]) });
    return h('article', { class: 'mc-row', dataset: { row: r.id, testid: `model-row-${r.id}` }, aria: { labelledby: `${titleId}-${r.id}` } }, [
      h('div', { class: 'mc-row-head' }, [
        h('h3', { class: 'mc-row-title', id: `${titleId}-${r.id}` }, r.component),
        h('span', { class: 'mc-badges' }, [
          (() => {
            const b = badge(ev.label, { tone: ev.tone, icon: ev.icon });
            b.classList.add('mc-evidence', `mc-ev-${r.evidence}`);
            b.dataset.evidence = r.evidence;
            return b;
          })(),
          r.live ? badge('Live', { tone: 'ok', dot: true }) : null,
        ]),
      ]),
      t(texts, k('dimensions'), 'p', 'mc-dims', r.dimensions),
      kv([keyed('resolution', 'Resolution'), keyed('timeStep', 'Time step'), keyed('method', 'Method')], { layout: 'stack', dense: true }),
      h('p', { class: 'mc-note t-secondary' }, [t(texts, k('note'), 'span', null, r.evidenceNote), h('span', { class: 'mc-ref' }, ` · spec ${r.specRef}`)]),
    ]);
  };

  const renderBlock = (s: ModelSection, b: CardBlock, i: number, texts: Map<string, HTMLElement>): HTMLElement | null => {
    const key = `${s.id}:${i}`;
    switch (b.type) {
      case 'rows':
        return h('div', { class: 'mc-rows' }, b.rows.map((r) => renderRow(r, texts)));
      case 'facts':
        return h('div', { class: 'mc-facts' }, [
          b.title ? h('h3', { class: 'sub-title mc-sub' }, b.title) : null,
          kv(
            b.facts.map((f) => ({
              key: f.key,
              value: h('span', { class: 'mc-fact', dataset: { fact: f.id } }, [
                t(texts, `fact:${f.id}:value`, 'span', 'mc-fact-value', f.value),
                f.note !== undefined ? t(texts, `fact:${f.id}:note`, 'span', 'mc-fact-note t-secondary', f.note) : null,
              ]),
            })),
            // Short numbers line up on the right; long values and notes go under their key.
            { label: b.title ?? s.title, layout: b.facts.every((f) => f.value.length <= 16 && f.note === undefined) ? 'right' : 'stack' },
          ),
        ]);
      case 'bullets':
        return h('div', { class: 'mc-bullets-block' }, [
          b.title ? h('h3', { class: 'sub-title mc-sub' }, b.title) : null,
          h(
            'ul',
            { class: 'mc-bullets' },
            b.bullets.map((x, j) =>
              h('li', { class: ['mc-bullet', `mc-${x.kind}`] }, [
                icon(BULLET_ICON[x.kind], { size: 18 }),
                h('span', null, [t(texts, `${key}:b${j}`, 'span', null, x.text), x.ref ? h('span', { class: 'mc-ref' }, ` ${x.ref}`) : null]),
              ]),
            ),
          ),
        ]);
      case 'text':
        return h('div', { class: ['callout', b.tone === 'warn' ? 'callout-warn' : 'callout-info', 'mc-callout'], attrs: { role: 'note' } }, [
          icon(b.tone === 'warn' ? 'warning' : 'info'),
          t(texts, `${key}:text`, 'p', null, b.text),
        ]);
      case 'legend':
        return h('div', { class: 'mc-legend' }, [
          h('h3', { class: 'sub-title mc-sub' }, b.title),
          h(
            'dl',
            { class: 'mc-legend-list' },
            b.items.map((it) => {
              const ev = EVIDENCE[it.level];
              return h('div', { class: 'mc-legend-item' }, [h('dt', null, badge(it.label, { tone: ev.tone, icon: ev.icon })), h('dd', { class: 't-secondary' }, it.gloss)]);
            }),
          ),
        ]);
      case 'layers':
        return h('div', { class: 'mc-layers' }, [
          h(
            'dl',
            { class: 'mc-dimensions' },
            b.dimensions.map((d) => h('div', { class: 'mc-dimension' }, [h('dt', null, badge(d.dimension)), h('dd', { class: 't-secondary' }, d.help)])),
          ),
          ...b.groups.map((g) =>
            h('div', { class: 'mc-layer-group' }, [
              h('h3', { class: 'sub-title mc-sub' }, g.title),
              h('p', { class: 'hint mc-blurb' }, g.blurb),
              h(
                'ul',
                { class: 'mc-layer-list', aria: { label: g.title } },
                g.layers.map((l) =>
                  h('li', { class: 'mc-layer', dataset: { layer: l.id } }, [
                    h('div', { class: 'mc-layer-head' }, [
                      h('span', { class: 'mc-layer-title' }, l.title),
                      badge(l.dimension),
                      h('span', { class: 'mc-layer-kind t-secondary' }, l.kind === 'heat' ? 'heat map' : l.kind === 'scene' ? 'on/off' : 'on/off + heat map'),
                    ]),
                    t(texts, `layer:${l.id}:res`, 'p', 'mc-layer-res t-secondary', l.resolution),
                    l.unavailable ? t(texts, `layer:${l.id}:na`, 'p', 'mc-layer-na t-secondary', `Not available now: ${l.unavailable}`) : null,
                  ]),
                ),
              ),
            ]),
          ),
        ]);
      case 'glossary':
        return h(
          'dl',
          { class: 'mc-glossary' },
          b.terms.map((g) => h('div', { class: 'mc-term' }, [h('dt', { class: 'mc-term-name' }, g.term), h('dd', { class: 't-secondary' }, g.gloss)])),
        );
      case 'action':
        if (!opts.onOpenDatasets) return null;
        return h('div', { class: 'mc-actions cluster' }, [
          button({ label: b.label, icon: 'database', variant: 'tonal', testId: 'model-card-datasets', onClick: () => opts.onOpenDatasets?.() }),
        ]);
    }
  };

  /** The keys of a section's text elements and its block types: equal shapes are patched in place. */
  const shapeOf = (s: ModelSection): string =>
    JSON.stringify(
      s.blocks.map((b) =>
        b.type === 'rows'
          ? ['rows', b.rows.map((r) => [r.id, r.evidence, r.live])]
          : b.type === 'facts'
            ? ['facts', b.title, b.facts.map((f) => [f.id, f.key, f.note !== undefined])]
            : b.type === 'bullets'
              ? ['bullets', b.title, b.bullets.length, b.bullets.map((x) => x.kind)]
              : b.type === 'layers'
                ? ['layers', b.groups.map((g) => g.layers.map((l) => [l.id, l.dimension, !!l.unavailable]))]
                : b.type === 'legend'
                  ? ['legend', b.items.map((i) => i.level)]
                  : b.type === 'text'
                    ? ['text', b.tone]
                    : [b.type],
      ),
    );

  /** Every patchable text of a section, under the same keys the renderer registered. */
  const textsOf = (s: ModelSection): Map<string, string> => {
    const out = new Map<string, string>();
    s.blocks.forEach((b, i) => {
      const key = `${s.id}:${i}`;
      if (b.type === 'rows')
        for (const r of b.rows) {
          out.set(`row:${r.id}:dimensions`, r.dimensions);
          out.set(`row:${r.id}:resolution`, r.resolution);
          out.set(`row:${r.id}:timeStep`, r.timeStep);
          out.set(`row:${r.id}:method`, r.method);
          out.set(`row:${r.id}:note`, r.evidenceNote);
        }
      else if (b.type === 'facts')
        for (const f of b.facts) {
          out.set(`fact:${f.id}:value`, f.value);
          if (f.note !== undefined) out.set(`fact:${f.id}:note`, f.note);
        }
      else if (b.type === 'bullets') b.bullets.forEach((x, j) => out.set(`${key}:b${j}`, x.text));
      else if (b.type === 'text') out.set(`${key}:text`, b.text);
      else if (b.type === 'layers')
        for (const g of b.groups)
          for (const l of g.layers) {
            out.set(`layer:${l.id}:res`, l.resolution);
            if (l.unavailable) out.set(`layer:${l.id}:na`, `Not available now: ${l.unavailable}`);
          }
    });
    return out;
  };

  const renderBody = (s: ModelSection, r: Pick<Rendered, 'body' | 'texts'>): void => {
    r.texts.clear();
    setChildren(
      r.body,
      s.blocks.map((b, i) => renderBlock(s, b, i, r.texts)),
    );
  };

  const setOpen = (r: Rendered, on: boolean, id: string): void => {
    if (on) open.add(id);
    else open.delete(id);
    r.toggle.setAttribute('aria-expanded', String(on));
    r.body.hidden = !on;
    r.section.classList.toggle('is-open', on);
  };

  const renderSection = (s: ModelSection): Rendered => {
    const bodyId = uniqueId(`mc-${s.id}`);
    const body = h('div', { class: 'mc-body', id: bodyId, dataset: { testid: `model-section-${s.id}-body` } });
    const summary = h('span', { class: 'mc-summary t-secondary' }, s.summary);
    const toggle = h(
      'button',
      { type: 'button', class: 'mc-toggle', aria: { expanded: 'false', controls: bodyId }, dataset: { testid: `model-section-${s.id}` } },
      [h('span', { class: 'mc-toggle-text' }, [h('span', { class: 'mc-toggle-title' }, s.title), summary]), icon('chevron-down', { class: 'mc-chevron' })],
    );
    const section = h('section', { class: ['card', 'mc-section'], dataset: { section: s.id } }, [h('h2', { class: 'mc-heading' }, toggle), body]);
    const r: Rendered = { section, body, toggle, summary, texts: new Map(), shape: shapeOf(s), json: JSON.stringify(s) };
    renderBody(s, r);
    toggle.addEventListener('click', () => setOpen(r, toggle.getAttribute('aria-expanded') !== 'true', s.id));
    setOpen(r, open.has(s.id), s.id);
    return r;
  };

  const paintIntro = (): void => {
    headline.textContent = card.headline;
    subtitle.textContent = card.subtitle;
    const label = card.mode === 'live' ? 'Live' : card.mode === 'mock' ? 'Demo engine' : card.mode === 'preview' ? 'Preview' : 'Planned';
    if (modeBadge.dataset.mode !== card.mode) {
      setChildren(modeBadge, badge(label, card.mode === 'live' ? { tone: 'ok', dot: true } : card.mode === 'mock' ? { tone: 'watch', icon: 'warning' } : { icon: 'calendar' }));
      modeBadge.dataset.mode = card.mode;
    }
  };

  const paintAll = (): void => {
    paintIntro();
    for (const r of rendered.values()) r.section.remove();
    rendered.clear();
    for (const s of card.sections) {
      const r = renderSection(s);
      rendered.set(s.id, r);
      main.append(r.section);
    }
  };

  /** New values: patch texts in place; rebuild a section only when its structure changed; keep focus and scroll. */
  const refresh = (): void => {
    const next = describeModel(input());
    const sameSections = next.sections.map((s) => s.id).join() === card.sections.map((s) => s.id).join();
    card = next;
    if (!sameSections) {
      const top = main.scrollTop;
      paintAll();
      main.scrollTop = top;
      return;
    }
    paintIntro();
    for (const s of card.sections) {
      const r = rendered.get(s.id);
      if (!r) continue;
      const json = JSON.stringify(s);
      if (json === r.json) continue;
      r.json = json;
      r.summary.textContent = s.summary;
      const shape = shapeOf(s);
      if (shape === r.shape) {
        for (const [k, v] of textsOf(s)) {
          const e = r.texts.get(k);
          if (e && e.textContent !== v) e.textContent = v;
        }
      } else {
        const hadFocus = r.body.contains(document.activeElement);
        r.shape = shape;
        renderBody(s, r);
        if (hadFocus) r.toggle.focus({ preventScroll: true });
      }
    }
  };

  paintAll();
  const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      refresh();
    } catch (e) {
      console.error(e);
    }
  }, REFRESH_MS);

  // ───────────── keyboard: Escape closes, Tab stays inside ─────────────
  el.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      // Stopped here: the App forwards Escape / Back as a synthetic key event that would otherwise bubble on to the
      // simulation underneath and close its dock as well (this page returns you to the same place).
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (x) => !x.closest('[hidden]') && x.offsetParent !== null,
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !el.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !el.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  });

  return {
    el,
    destroy() {
      clearInterval(timer);
      clearTimeout(statusTimer);
    },
  };
}
