/**
 * The Air slices tool panel (workstream D, plan §8.1 and §8.3): a bottom panel like the other tools, with the placement controls
 * (Set start (A), Set end (B), Swap, Presets, then Place here / Cancel while placing), the quiet line that says what to do or why
 * not, and, below them, the side-view panel. The side view is a separate chunk (sliceTypes.ts, plan D10): it is requested when the
 * tool opens, shows a "Loading" line until it arrives and a "Try again" button if it does not, and receives the controls to place
 * between its legend and footer. The buttons work either way, because the 3-D curtain draws the line without the panel.
 *
 * Thin by design: every decision is in sliceToolModel.ts and every store write in sliceToolActions.ts (both unit-tested). This
 * file builds the elements, wires the events, keeps the keyboard focus where the person is, and passes the scene's slice to the
 * panel. Nothing here pops up by itself: no toast, no role=alert, announcements only for what the person just did.
 */
import { fireCentroid } from '../../../render/fields';
import { has3dAtmosphere, type SimContext } from './context';
import { h, listen, setChildren, svg, text, uniqueId } from '../../dom';
import { icon } from '../../icons';
import type { SlicePresetId, SliceProbePos, SliceUpdate } from '../../../render/slice/types';
import { createSliceToolActions, type SliceToolActions, type SliceToolHost } from './sliceToolActions';
import { loadSlicePanel } from './sliceToolLoad';
import {
  AIR_PANEL_SUBTITLE,
  AIR_PANEL_TITLE,
  CANCEL_LABEL,
  LOADING_LINE,
  NEEDS_3D_VIEW,
  PRESETS_LABEL,
  PRESET_LABEL,
  RETRY_LABEL,
  SET_LABEL,
  SWAP_LABEL,
  loadFailedView,
  type ControlsView,
  type SliceAnnMark,
  type SliceEnd,
} from './sliceToolModel';
import type { SlicePanelController, SlicePanelLoader, SlicePanelModule, SlicePanelOptions } from './sliceTypes';

const PRESET_IDS: readonly SlicePresetId[] = ['along', 'across', 'slope', 'me'];

/** A `.btn` whose label can change: the label is the span the shared button uses. */
function makeButton(label: string, o: { variant?: string; large?: boolean; testId: string; onClick: () => void }): { el: HTMLButtonElement; label(t: string): void } {
  const span = h('span', { class: 'btn-text' }, label);
  const el = h('button', { type: 'button', class: ['btn', `btn-${o.variant ?? 'secondary'}`, o.large && 'btn-lg'], dataset: { testid: o.testId }, on: { click: o.onClick } }, span);
  return { el, label: (t) => text(span, t) };
}

export function createAirPanel(ctx: SimContext, onClose: () => void, loadPanel: SlicePanelLoader = loadSlicePanel): { el: HTMLElement; destroy(): void } {
  const body = h('div', { class: 'panel-body slice-tool-body' });
  const el = h('section', { class: 'tool-panel slice-tool', dataset: { testid: 'air-panel' }, aria: { label: AIR_PANEL_TITLE } }, [
    h('header', { class: 'panel-head' }, [
      h('h2', { class: 'panel-title' }, [icon('line'), AIR_PANEL_TITLE, h('span', { class: 't-secondary' }, AIR_PANEL_SUBTITLE)]),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon', aria: { label: 'Close tool' }, dataset: { testid: 'air-close' }, on: { click: onClose } }, icon('close')),
    ]),
    body,
  ]);

  // The 2-D map has no air and no slice: one line, nothing to place.
  if (typeof ctx.view.slice !== 'function') {
    setChildren(body, h('p', { class: 'hint', dataset: { testid: 'slice-needs-3d' } }, NEEDS_3D_VIEW));
    return { el, destroy: () => undefined };
  }

  // The scene's rule for "there is a fire" (the centroid of the burning and the recently burnt cells), looked for once for each snapshot.
  let fireAt: { snap: unknown; has: boolean } | null = null;
  const hasFire = (): boolean => {
    const snap = ctx.session.state.get().snapshot;
    if (!snap) return false;
    if (fireAt?.snap !== snap) fireAt = { snap, has: fireCentroid(snap.fire, snap.time) !== null };
    return fireAt.has;
  };
  const host: SliceToolHost = {
    ui: ctx.ui,
    layers: ctx.layers,
    view: ctx.view,
    grid: () => ctx.session.state.get().snapshot?.atmosphere?.grid ?? ctx.scenario.terrain.grid,
    crosshair: () => ctx.pickCrosshair(),
    user: ctx.user,
    hasFire,
    announce: ctx.announce,
  };
  const actions: SliceToolActions = createSliceToolActions(host);
  actions.open();

  let destroyed = false;
  let switching3d = false;
  let presetsOpen = false;
  let panel: SlicePanelController | null = null;
  let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastKey = '';
  let wasPlacing: SliceEnd | null = null;
  /** What the panel was last told, so its own events are not echoed back to it. */
  let toldProbe: SliceProbePos | null = actions.state().probe;
  let toldCells = actions.state().showCells;

  // ───────────── the controls ─────────────
  /** Focus a button of the controls; the panel's body scrolls (short landscape), so one that is off screen is scrolled into view. */
  const focus = (e: HTMLElement | null | undefined): void => e?.focus();
  /** The picture is the top of the body: scrolled back to it after a tap far down on the controls (the panel's own focus does not scroll), and for a new reading on a short landscape screen (the picture is pinned there and the reading follows it). */
  const showPicture = (): void => {
    body.scrollTop = 0;
  };
  const shortLandscape = (): boolean => typeof matchMedia === 'function' && matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
  const setBtn: Record<SliceEnd, ReturnType<typeof makeButton>> = {
    a: makeButton(SET_LABEL.a, { testId: 'slice-set-a', onClick: () => startPlacing('a') }),
    b: makeButton(SET_LABEL.b, { testId: 'slice-set-b', onClick: () => startPlacing('b') }),
  };
  const swapBtn = makeButton(SWAP_LABEL, {
    testId: 'slice-swap',
    onClick: () => {
      actions.swap();
      render();
    },
  });
  const presetsId = uniqueId('slice-presets');
  let chevron = icon('chevron-down');
  let chevronUp = false;
  const presetsToggle = h(
    'button',
    { type: 'button', class: 'btn btn-secondary', dataset: { testid: 'slice-presets-toggle' }, aria: { expanded: false, controls: presetsId }, on: { click: () => togglePresets() } },
    [h('span', { class: 'btn-text' }, PRESETS_LABEL), chevron],
  );
  const idleRow = h('div', { class: 'row-actions slice-row' }, [setBtn.a.el, setBtn.b.el, swapBtn.el, presetsToggle]);
  const placeBtn = makeButton('Place A here', { variant: 'primary', large: true, testId: 'slice-place', onClick: () => placeHere() });
  const cancelBtn = makeButton(CANCEL_LABEL, { testId: 'slice-cancel', onClick: () => cancelPlacing() });
  const placingRow = h('div', { class: 'row-actions slice-row', hidden: true }, [placeBtn.el, cancelBtn.el]);
  const presetCells = PRESET_IDS.map((id) => {
    const why = h('p', { class: 'hint slice-why', id: `${presetsId}-${id}`, hidden: true });
    const btn = makeButton(PRESET_LABEL[id], { testId: `slice-preset-${id}`, onClick: () => choosePreset(id) });
    btn.el.setAttribute('aria-describedby', why.id);
    return { id, btn, why, wrap: h('div', { class: 'slice-preset' }, [btn.el, why]) };
  });
  const presetList = h('div', { class: 'slice-presets', id: presetsId, hidden: true }, presetCells.map((c) => c.wrap));
  const note = h('p', { class: 'hint slice-note', dataset: { testid: 'slice-note' }, hidden: true });
  const controls = h('div', { class: 'slice-tool-controls', dataset: { testid: 'slice-controls' } }, [idleRow, presetList, placingRow, note]);

  function apply(v: ControlsView): void {
    idleRow.hidden = !!v.placing;
    placingRow.hidden = !v.placing;
    for (const end of ['a', 'b'] as const) setBtn[end].el.classList.toggle('btn-tonal', v.next === end);
    swapBtn.el.disabled = v.swapDisabled;
    placeBtn.label(v.place.label);
    placeBtn.el.disabled = v.place.disabled;
    for (const c of presetCells) {
      const pv = v.presets.find((p) => p.id === c.id)!;
      c.btn.el.disabled = pv.disabled;
      c.btn.el.classList.toggle('btn-tonal', pv.active);
      c.btn.el.setAttribute('aria-pressed', String(pv.active));
      c.why.hidden = !pv.reason;
      text(c.why, pv.reason ?? '');
    }
    const open = presetsOpen && !v.placing;
    presetList.hidden = !open;
    presetsToggle.setAttribute('aria-expanded', String(open));
    if (open !== chevronUp) {
      chevronUp = open;
      const next = icon(open ? 'chevron-up' : 'chevron-down');
      chevron.replaceWith(next);
      chevron = next;
    }
    text(note, v.hint);
    note.hidden = !v.hint;
  }

  /** Redraw the controls from the model (only when something shows differently); keeps the placement poll running exactly while placing. */
  function render(): void {
    if (destroyed) return;
    const v = actions.controls(switching3d);
    const key = JSON.stringify(v) + String(presetsOpen);
    if (key !== lastKey) {
      lastKey = key;
      apply(v);
    }
    // A placement ended from outside the buttons (Back, Escape): the keyboard focus was on a button that is now put away.
    if (!v.placing && wasPlacing && placingRow.contains(document.activeElement)) focus(setBtn[wasPlacing].el);
    wasPlacing = v.placing;
    // The cross moves when the map is panned, and nothing tells us: while placing, look again a few times a second.
    if (v.placing && !pollTimer) pollTimer = setInterval(render, 150);
    else if (!v.placing && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPlacing(end: SliceEnd): void {
    presetsOpen = false;
    actions.startPlacing(end);
    render();
    focus(placeBtn.el.disabled ? cancelBtn.el : placeBtn.el);
  }
  function cancelPlacing(): void {
    const end = actions.state().placing;
    actions.cancelPlacing();
    render();
    focus(end ? setBtn[end].el : null);
  }
  function placeHere(): void {
    const end = actions.state().placing;
    const out = actions.placeHere();
    render();
    if (!end || !out.verdict.ok) return; // refused: the quiet line says why and the placement stays open
    const s = actions.state();
    if (out.firstLine && panel) {
      panel.focus();
      showPicture();
    } else focus(setBtn[out.wrote ? end : s.draft.a && !s.draft.b ? 'b' : 'a'].el);
  }
  function choosePreset(id: SlicePresetId): void {
    actions.preset(id);
    presetsOpen = false;
    render();
    if (panel) {
      panel.focus();
      showPicture();
    } else focus(presetsToggle);
  }
  function togglePresets(): void {
    presetsOpen = !presetsOpen;
    render();
  }

  // ───────────── the side-view panel (lazy chunk) ─────────────
  const loadingLine = h('p', { class: 'hint', dataset: { testid: 'slice-loading' } }, LOADING_LINE);
  const failedLine = h('p', { class: 'hint' });
  const retryBtn = makeButton(RETRY_LABEL, { testId: 'slice-load-retry', onClick: () => startLoad() }).el;
  const failedBox = h('div', { class: 'row-actions', dataset: { testid: 'slice-load-failed' } }, [failedLine, retryBtn]);
  let failures = 0;
  /** The side view did not arrive (or did not start): one line, and Try again the first time. */
  function loadFailed(): void {
    loadState = 'failed';
    const v = loadFailedView(++failures);
    text(failedLine, v.line);
    const hadFocus = document.activeElement === retryBtn;
    retryBtn.hidden = !v.retry;
    layoutBody();
    if (hadFocus && !v.retry) focus(setBtn.a.el); // the button the person pressed is put away
  }

  function layoutBody(): void {
    if (loadState === 'ready' && panel) setChildren(body, panel.el);
    else setChildren(body, [loadState === 'failed' ? failedBox : loadingLine, controls]);
  }

  const units = (): 'kmh' | 'ms' => ctx.settings.get().units;
  const vex = (): number => ctx.layers.get().verticalExaggeration;

  function mount(m: SlicePanelModule): void {
    const s = actions.state();
    const opts: SlicePanelOptions = {
      controls,
      absTime: (t) => ctx.absTime(t),
      tz: ctx.tz,
      units: units(),
      field: actions.field(),
      showCells: s.showCells,
      probe: s.probe,
      exaggeration: vex(),
      legend: (field, kind) => ctx.sceneLegends?.slice?.(field, kind) ?? null,
      announce: (msg) => ctx.announce(msg),
      onField: (f) => actions.setField(f),
      onProbe: (pos) => {
        toldProbe = pos;
        actions.setProbe(pos);
        if (pos && shortLandscape()) showPicture(); // (the reading is under the pinned picture, and the body may be scrolled down to the chips)
      },
      onShowCells: (on) => {
        toldCells = on;
        actions.setShowCells(on);
      },
      onUse3d: () => {
        // The same action as the Layers panel's button: re-compute from the last checkpoint with the 3-D air.
        ctx.session.controller.setQuality('standard');
        switching3d = true;
        ctx.announce('Switching to the 3-D atmosphere. The simulation re-computes from the last checkpoint.');
        render();
      },
    };
    const p = m.createSlicePanel(opts);
    panel = p;
    loadState = 'ready';
    layoutBody();
    p.setData(ctx.view.slice?.() ?? null);
    syncActive();
    render();
  }

  function startLoad(): void {
    if (loadState === 'loading' || loadState === 'ready' || destroyed) return;
    loadState = 'loading';
    layoutBody();
    let pending: Promise<SlicePanelModule>;
    try {
      pending = loadPanel();
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      (m) => {
        if (destroyed) return;
        try {
          mount(m);
        } catch {
          // A panel that fails while it is being made is as good as one that did not load: the controls stay, with Try again.
          try {
            panel?.destroy();
          } catch {
            // nothing more to undo
          }
          panel = null;
          loadFailed();
        }
      },
      () => {
        if (destroyed) return;
        loadFailed();
      },
    );
  }

  // ───────────── events from the app ─────────────
  let onScreen = true;
  function syncActive(): void {
    panel?.setActive(!destroyed && onScreen && document.visibilityState !== 'hidden');
  }
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          onScreen = entries[entries.length - 1]!.isIntersecting;
          syncActive();
        })
      : null;
  io?.observe(el);

  const onSlice = (update: SliceUpdate | null): void => {
    if (switching3d && has3dAtmosphere(ctx.session.state.get().snapshot)) switching3d = false;
    panel?.setData(update);
    panel?.setField(update?.field ?? actions.field());
    render();
  };
  const unsubs: (() => void)[] = [
    ctx.ui.subscribe((s) => {
      const st = s.slice;
      if (panel && st) {
        if (st.probe !== toldProbe) panel.setProbe(st.probe);
        if (st.showCells !== toldCells) panel.setShowCells(st.showCells);
      }
      if (st) {
        toldProbe = st.probe;
        toldCells = st.showCells;
      }
      render();
    }, ['slice']),
    ctx.layers.subscribe(() => {
      panel?.setField(actions.field());
      panel?.setExaggeration(vex());
      render();
    }, ['crossSection', 'verticalExaggeration']),
    ctx.settings.subscribe(() => panel?.setUnits(units()), ['units']),
    listen(document, 'visibilitychange', syncActive),
  ];
  const offSlice = ctx.view.onSlice?.(onSlice);
  if (offSlice) unsubs.push(offSlice);

  render();
  startLoad();

  return {
    el,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (pollTimer) clearInterval(pollTimer);
      for (const u of unsubs) u();
      io?.disconnect();
      // Focus goes back to the Tools button the tool was opened from (a press on the panel's own buttons, Back or Escape closed it).
      const returnTo = el.contains(document.activeElement) ? ctx.mapEl.parentElement?.querySelector<HTMLElement>('[data-testid="tools-menu"]') : null;
      panel?.setActive(false);
      panel?.destroy();
      panel = null;
      actions.close();
      returnTo?.focus({ preventScroll: true });
    },
  };
}

// ───────────── the marks on the map ─────────────
// Drawn by simScreen.ts into the `.annotations` SVG (data on the map: the same in every theme, inline styles, no animation). The colours are
// tokens (tokens.css: `--mark-slice`, the white `--map-halo`), so `npm run check:contrast` sees them.

const SLICE_INK = 'var(--mark-slice)';
const SLICE_PAPER = 'var(--map-halo)';

/** The glyph of one map mark: the line (casing and stroke), the A and B ends (a dashed ring while only tapped), the probe pin. */
export function sliceMarkElement(m: SliceAnnMark): SVGElement | SVGElement[] {
  switch (m.kind) {
    case 'slice':
      return [svg('path', { d: m.d, class: 'ann-stroke-casing', style: 'stroke-width:8px' }), svg('path', { d: m.d, class: 'ann-stroke', style: `stroke:${SLICE_INK};stroke-width:4px` })];
    case 'sliceA':
    case 'sliceB':
      return svg('g', { class: 'ann-slice-end', transform: `translate(${m.at[0]},${m.at[1]})` }, [
        svg('circle', { r: 15, class: 'ann-pin-dot', style: m.pending ? `fill:${SLICE_PAPER};stroke:${SLICE_INK};stroke-width:3px;stroke-dasharray:5 3` : `fill:${SLICE_INK}` }),
        svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `font:700 19px system-ui,sans-serif;fill:${m.pending ? SLICE_INK : SLICE_PAPER}` }, m.kind === 'sliceA' ? 'A' : 'B'),
      ]);
    case 'probe':
      return svg('g', { class: 'ann-slice-probe', transform: `translate(${m.at[0]},${m.at[1]})` }, [
        svg('circle', { r: 9, class: 'ann-pin-dot', style: `fill:${SLICE_PAPER};stroke:${SLICE_INK};stroke-width:3px` }),
        svg('circle', { r: 3.5, style: `fill:${SLICE_INK}` }),
      ]);
  }
}
