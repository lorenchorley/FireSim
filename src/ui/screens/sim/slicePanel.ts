/**
 * The Air slice side-view panel (plan §8.5): a flat Canvas 2-D picture of the air along a line, with colour chips, the
 * legend, a probe you can tap, drag or move with the arrow keys, the "Show model cells" switch and the honest footer.
 * This is the entry of its own lazy chunk (the tool loads it with `import('./slicePanel')` when it first opens): the
 * flow, probe and tick modules and src/styles/slice.css come with it.
 *
 * The panel draws only what it is given. The tool passes each `SliceUpdate` to `setData`; a tap on a chip, a probe move and
 * the switch go back up through the option callbacks. The words and the maths are in slicePanelModel.ts and the drawing is in
 * sliceDraw.ts (both tested without a DOM); this file wires them to the elements, the canvases and the events.
 */
import '../../../styles/slice.css';
import { sliceFieldScale } from '../../../render/palette';
import { createFlow, flowArrows, seedFlow, stepFlow, type FlowParticles } from '../../../render/slice/flow2d';
import { niceTicks } from '../../../render/slice/niceTicks';
import { moveProbe, probeAt, probeSentence } from '../../../render/slice/probe';
import { SLICE_FIELDS, type SliceData, type SliceFieldId, type SliceProbePos, type SliceProbeReading, type SliceUpdate } from '../../../render/slice/types';
import { h, listen, prefersReducedMotion, setChildren, text, uniqueId } from '../../dom';
import { formatNumber } from '../../format';
import { iconButton } from '../../primitives';
import { button, toggle } from '../../widgets';
import { drawArrows, drawProbe, drawScaleTag, drawStreaks, fadeTrail, paintStatic, type Ctx, type DrawColours, type DrawFont } from './sliceDraw';
import {
  FLOW_COUNT,
  FLOW_LIFE_S,
  TERRAIN_CAPTION,
  arrowGrid,
  axisTicks,
  canvasLabel,
  cellsNote,
  chipModel,
  disabledNotes,
  emptyState,
  flowCount,
  flowSlice,
  flowTick,
  flowTimeScale,
  footerCacheKey,
  footerRuns,
  legendView,
  makeLut,
  naturalBoxHeight,
  pickPos,
  plotLayout,
  rasterize,
  recordingLine,
  sameFlowSlice,
  scaleCaption,
  scaleTag,
  showsScaleTag,
  streakExaggeration,
  type FlowClock,
  type FlowSlice,
  type Lut,
  type PlotLayout,
  type Raster,
} from './slicePanelModel';
import { SLICE_USE_3D_LABEL, type SlicePanelController, type SlicePanelOptions } from './sliceTypes';

interface Buf {
  canvas: HTMLCanvasElement;
  ctx: Ctx | null;
}

function makeBuf(): Buf {
  const canvas = document.createElement('canvas');
  return { canvas, ctx: canvas.getContext('2d') };
}

/** The canvas while there is no slice: room for its few words, so the controls the tool gave come up the screen. */
const EMPTY_BOX_PX = 128;

const KEYS: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

export function createSlicePanel(options: SlicePanelOptions): SlicePanelController {
  let update: SliceUpdate | null = null;
  let data: SliceData | null = null;
  let field: SliceFieldId = options.field;
  let showCells = options.showCells;
  let units = options.units;
  let vex = options.exaggeration;
  let probe: SliceProbePos | null = options.probe;
  let reading: SliceProbeReading | null = null;
  let active = true;
  let destroyed = false;
  let reduced = prefersReducedMotion();
  const offs: (() => void)[] = [];

  // ───────────── elements ─────────────
  const canvas = h('canvas', { class: 'slice-canvas', tabIndex: 0, attrs: { role: 'img' }, dataset: { testid: 'slice-canvas', field, motion: reduced ? 'arrows' : 'streaks' } });
  const empty = h('div', { class: 'slice-empty', hidden: true, dataset: { testid: 'slice-empty' } });
  const readoutId = uniqueId('slice-readout');
  const readoutText = h('span', { class: 'slice-readout-text', id: readoutId, dataset: { testid: 'slice-readout-text' } });
  const readout = h('div', { class: 'slice-readout', hidden: true, dataset: { testid: 'slice-readout' } }, [
    readoutText,
    iconButton({ icon: 'close', label: 'Clear the probe', testId: 'slice-probe-clear', onClick: () => userProbe(null, false) }),
  ]);
  // The reading is not part of the picture's block: on a short landscape screen the picture stays pinned and the reading scrolls with the controls.
  const view = h('div', { class: 'slice-view' }, h('div', { class: 'slice-stage' }, [canvas, empty]));

  const reasonsId = uniqueId('slice-reasons');
  // The button comes first (it is what a person can act on), the words follow it, and the chips are described by the words. The whole block sits directly under the chips
  // (0.7.0): the button is beside the chips it explains, not below the controls, where it was a scroll away on a short screen.
  const reasons = h('div', { class: 'slice-reasons', hidden: true, dataset: { testid: 'slice-reasons' } });
  const chipEls = new Map<SliceFieldId, HTMLButtonElement>();
  for (const f of SLICE_FIELDS) {
    const name = f.name.toLowerCase() === f.label.toLowerCase() ? f.label : `${f.label}, ${f.name.toLowerCase()}`;
    chipEls.set(f.id, h('button', { type: 'button', class: 'chip slice-chip', aria: { pressed: false, label: name }, dataset: { testid: `slice-chip-${f.id}` }, on: { click: () => pickField(f.id) } }, f.label));
  }
  const chipRow = h('div', { class: 'chips chips-scroll slice-chips', attrs: { role: 'group' }, aria: { label: 'Colour the slice by' } }, [...chipEls.values()]);

  const legendHost = h('div', { dataset: { testid: 'slice-legend' } });
  const cellsToggle = toggle({
    label: 'Show model cells',
    description: 'One block for each cell the model really uses, with its own value.',
    checked: showCells,
    testId: 'slice-cells',
    onChange: (on) => {
      showCells = on;
      staticDirty = true;
      syncRecording();
      paint();
      options.onShowCells(on);
    },
  });
  const scaleWords = h('span', { dataset: { testid: 'slice-scale' } });
  const terrainLine = h('p', { class: 'hint slice-terrain', hidden: true, dataset: { testid: 'slice-terrain' } }, [scaleWords, ' ', TERRAIN_CAPTION]);
  // The time-lapse recording (0.4.1): what the cells switch cannot do on a recorded slice, and what is recorded. Plain text, nothing announced.
  const cellsNoteEl = h('p', { class: 'hint', hidden: true, dataset: { testid: 'slice-cells-note' } });
  const recordingEl = h('p', { class: 'hint', hidden: true, tabIndex: -1, dataset: { testid: 'slice-recording' } }); // (tabIndex -1: focused by Keep this line and Clear recording, not a stop of the Tab key)
  const footer = h('p', { class: 'hint slice-footer', hidden: true, dataset: { testid: 'slice-footer' } });
  const controlsWrap = h('div', { class: 'slice-controls' }, options.controls);
  // Order: picture, reading, chips, the notes of the chips that are off (the button and the words), legend, controls, the switch (and its note), the recording's
  // status, the caption, the footer. When there are notes (the fast tier) the legend goes after the controls, which stay as near the chips as the notes allow (`arrange`).
  const root = h('div', { class: 'slice-panel', dataset: { testid: 'slice-panel' } }, [view, readout, chipRow, reasons, legendHost, controlsWrap, cellsToggle.el, cellsNoteEl, recordingEl, terrainLine, footer]);
  let legendLast = false;
  function arrange(last: boolean): void {
    if (last === legendLast) return;
    legendLast = last;
    root.insertBefore(legendHost, last ? cellsToggle.el : controlsWrap);
  }

  // ───────────── canvases and what they hold ─────────────
  const ctx = canvas.getContext('2d');
  const still = makeBuf(); // the field, ground, axes (and the arrows): redrawn when the slice, field, size or switch changes
  const trail = makeBuf(); // the streaks, fading
  const rasterBuf = makeBuf(); // the lattice as an image, one pixel per lattice point
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let layout: PlotLayout | null = null;
  let colours: DrawColours | null = null;
  let font: DrawFont | null = null;
  let staticDirty = true;
  let tagText = ''; // the axis tag for the scale drawn now, or '' where the plot is too small for one
  let raster: Raster | null = null;
  let rasterKey = '';
  let rasterOf: SliceData | null = null; // a new slice object may carry the same `seq` as the last one: the image follows the object too
  const luts = new Map<SliceFieldId, Lut>();
  let flow: FlowParticles | null = null;
  let seededSlice: FlowSlice | null = null; // the slice the particles were last seeded (or kept) for
  let seededCount = 0;

  function lutFor(f: SliceFieldId): Lut {
    let l = luts.get(f);
    if (!l) {
      l = makeLut(sliceFieldScale(f));
      luts.set(f, l);
    }
    return l;
  }

  /** Token colours and the axis type, read from the computed style (so the theme, high contrast and the text size apply). */
  function readStyle(): void {
    const cs = getComputedStyle(canvas);
    const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
    const smallPx = (() => {
      const x = parseFloat(cs.getPropertyValue('--fs-xs'));
      return Number.isFinite(x) && x > 0 ? x : 12;
    })();
    colours = {
      ink: v('--text', '#202124'),
      muted: v('--muted', '#5f6368'),
      grid: v('--grid', 'rgba(32,33,36,0.12)'),
      surface: v('--surface', '#ffffff'),
      outline: v('--outline', '#80868b'),
      ground: v('--surface-3', '#e8eaed'),
      groundTint: v('--chart-moist', '#8a5a14'),
    };
    font = { small: `${v('--fw-regular', '400')} ${smallPx}px ${v('--font', 'system-ui, sans-serif')}`, smallPx };
  }

  /** Match the backing stores to the CSS box. Returns whether anything changed. */
  function size(): boolean {
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width);
    const hh = Math.round(r.height);
    const ratio = Math.min(3, globalThis.devicePixelRatio || 1);
    if (w < 8 || hh < 8) {
      const was = layout !== null;
      layout = null;
      cssW = 0;
      cssH = 0;
      return was;
    }
    if (w === cssW && hh === cssH && ratio === dpr && colours) return false;
    cssW = w;
    cssH = hh;
    dpr = ratio;
    for (const b of [canvas, still.canvas, trail.canvas]) {
      b.width = Math.round(w * dpr);
      b.height = Math.round(hh * dpr);
    }
    readStyle();
    staticDirty = true;
    return true;
  }

  /**
   * The canvas is as tall as its picture needs (`--slice-h`; the stylesheet caps it at the full box), so a long line at true scale
   * has no empty band above it and the controls come up the screen.
   */
  let boxPx = 0;
  function fitBox(px: number): void {
    if (px === boxPx) return;
    boxPx = px;
    canvas.style.setProperty('--slice-h', `${px}px`);
    size(); // measure the new box now, so the layout that follows is made for it
  }

  function computeLayout(): void {
    if (!data || !font || cssW < 8) {
      if (!data) fitBox(EMPTY_BOX_PX);
      layout = null;
      return;
    }
    // The widest height label is one of the two ends of the axis; measure it so the margin always holds it, at any text size.
    let labelW = 0;
    if (ctx) {
      ctx.font = font.small;
      labelW = Math.max(ctx.measureText(`${formatNumber(data.zMax)} m`).width, ctx.measureText(`${formatNumber(data.zMin)} m`).width);
    }
    const input = { length: data.line.length, zMin: data.zMin, zMax: data.zMax, exaggeration: vex, smallPx: font.smallPx, labelW };
    fitBox(naturalBoxHeight({ ...input, width: cssW }));
    layout = plotLayout({ ...input, width: cssW, height: cssH });
  }

  function ensureRaster(d: SliceData): void {
    const lut = lutFor(field);
    const key = `${d.seq}|${field}|${lut.lo}|${lut.hi}`;
    if (key === rasterKey && d === rasterOf && raster) return;
    rasterOf = d;
    raster = rasterize(d, field, lut, raster);
    rasterBuf.canvas.width = raster.width;
    rasterBuf.canvas.height = raster.height;
    rasterBuf.ctx?.putImageData(new ImageData(raster.rgba as Uint8ClampedArray<ArrayBuffer>, raster.width, raster.height), 0, 0);
    rasterKey = key;
  }

  function rebuildStill(l: PlotLayout, d: SliceData): void {
    if (!still.ctx || !colours || !font) return;
    ensureRaster(d);
    still.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = axisTicks(l, niceTicks, font.smallPx);
    paintStatic(still.ctx, { layout: l, data: d, field, colours, font, heightTicks: t.height, distanceTicks: t.distance, raster: rasterBuf.canvas, lut: lutFor(field), showCells });
    if (reduced && d.has.wind) {
      const g = arrowGrid(l);
      drawArrows(still.ctx, l, flowArrows(d, g.cols, g.rows, l.ratio), colours);
    }
    staticDirty = false;
  }

  /** Put the layers together: the still picture, the streaks, the probe. */
  function paint(): void {
    if (destroyed || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!layout || !data || !colours) return;
    if (staticDirty) rebuildStill(layout, data);
    ctx.drawImage(still.canvas, 0, 0);
    if (!reduced) ctx.drawImage(trail.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (font && tagText) drawScaleTag(ctx, layout, colours, font, tagText);
    if (reading) drawProbe(ctx, layout, reading.pos, colours);
  }

  function clearTrail(): void {
    trail.ctx?.clearRect(0, 0, trail.canvas.width, trail.canvas.height);
  }

  // ───────────── streaks: at most 24 a second, only while the panel is on screen and the page is visible ─────────────
  let raf = 0;
  const clock: FlowClock = { last: 0, acc: 0 };

  const wantStreaks = (): boolean => active && !destroyed && !reduced && !document.hidden && !!data && !!layout && data.has.wind;

  function ensureFlow(d: SliceData): void {
    if (reduced) return;
    if (!flow) flow = createFlow(FLOW_COUNT, 1);
    // A smaller plot (the short landscape panel) gets fewer streaks, so it is not a smear; many more particles than were seeded are seeded afresh
    // (a few more or fewer, from a pixel more or less of height, are not worth a restart). The same picture a moment later, for example a live
    // preset drifting with the fire, goes on with the streaks it has.
    const n = layout ? flowCount(layout) : FLOW_COUNT;
    const now = flowSlice(d);
    const same = sameFlowSlice(seededSlice, now) && n <= seededCount * 1.15;
    seededSlice = now;
    if (same) {
      flow.count = n;
      return;
    }
    flow.count = n;
    seedFlow(flow, d);
    seededCount = n;
    clearTrail();
  }

  function frame(t: number): void {
    raf = requestAnimationFrame(frame);
    if (dirty) catchUp(); // (a new slice that this frame's own callback has not drawn yet: never paint the new air into the old layout)
    const dt = flowTick(clock, t);
    if (!dt || !wantStreaks() || !flow || !data || !layout || !colours || !trail.ctx) return;
    stepFlow(flow, data, dt, { exaggeration: streakExaggeration(layout), timeScale: flowTimeScale(data.line.length), maxAgeS: FLOW_LIFE_S });
    trail.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fadeTrail(trail.ctx, cssW, cssH);
    drawStreaks(trail.ctx, layout, flow, colours);
    paint();
  }

  function syncLoop(): void {
    if (wantStreaks()) {
      if (!raf) {
        clock.last = 0;
        clock.acc = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // ───────────── words and small parts ─────────────
  const fieldName = (): string => SLICE_FIELDS.find((f) => f.id === field)?.name ?? 'the field';
  let notesKey = '';
  let legendKey = '';
  let footerKey = '';

  function syncChips(): void {
    const chips = chipModel(update?.fields, field);
    for (const c of chips) {
      const el = chipEls.get(c.id)!;
      el.setAttribute('aria-pressed', String(c.selected));
      if (c.available) {
        el.removeAttribute('aria-disabled');
        el.removeAttribute('aria-describedby');
      } else {
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('aria-describedby', reasonsId);
      }
    }
    // The reasons, word for word from the scene, and the button that helps: only while some chip is off.
    const notes = disabledNotes(chips);
    const key = notes.map((n) => `${n.labels.join('+')}:${n.reason}:${n.use3d}`).join('|');
    reasons.hidden = !data || notes.length === 0; // with no slice the chips are put away, and so are their reasons
    arrange(!reasons.hidden);
    if (key !== notesKey) {
      notesKey = key;
      setChildren(reasons, [
        notes.some((n) => n.use3d) ? button({ label: SLICE_USE_3D_LABEL, variant: 'tonal', class: 'slice-use3d', testId: 'slice-use3d', onClick: () => options.onUse3d() }) : null,
        h('div', { id: reasonsId }, notes.map((n) => h('p', { class: 'hint' }, n.reason))),
      ]);
    }
    canvas.dataset.field = field;
  }

  function syncLegend(): void {
    const ext = data ? (options.legend?.(field, data.kind) ?? null) : null;
    const lv = legendView(ext);
    const key = lv ? JSON.stringify(lv) : '';
    if (key === legendKey) return;
    legendKey = key;
    legendHost.hidden = !lv;
    setChildren(
      legendHost,
      lv
        ? h('div', { class: 'slice-legend' }, [
            h('div', { class: 'hint' }, lv.title),
            lv.gradient ? [h('div', { class: 'slice-ramp', style: { background: lv.gradient } }), h('div', { class: 'slice-ends' }, lv.ends.map((l) => h('span', null, l)))] : null,
            lv.classes.length ? h('div', { class: 'slice-classes' }, lv.classes.map((c) => h('span', null, [h('span', { class: 'slice-swatch', style: { background: c.colour } }), c.label]))) : null,
          ])
        : null,
    );
  }

  function syncFooter(): void {
    const d = data;
    footer.hidden = !d;
    terrainLine.hidden = !d;
    const key = footerCacheKey(d);
    if (key === footerKey) return;
    footerKey = key;
    if (!d) return;
    setChildren(
      footer,
      footerRuns(d, options.tz, options.absTime).map((r) => (r.keep ? r.text : h('span', { class: 'slice-more' }, r.text))),
    );
  }

  /** The recording's status line and the note under the cells switch: both follow the update and the switch, and say nothing without a slice. */
  function syncRecording(): void {
    const line = recordingLine(update, options.tz, options.absTime);
    recordingEl.hidden = !line;
    if (line) text(recordingEl, line);
    const note = cellsNote(showCells, data);
    cellsNoteEl.hidden = !note;
    if (note) text(cellsNoteEl, note);
  }

  /** The words for the drawn scale, in the caption under the controls and in the canvas's text alternative. */
  function syncScale(): void {
    tagText = layout && showsScaleTag(layout) ? scaleTag(layout.ratio) : '';
    if (layout) text(scaleWords, scaleCaption(layout.ratio));
  }

  function syncDom(): void {
    const e = emptyState(update);
    empty.hidden = !e;
    if (e) text(empty, e.text);
    // Nothing to colour or to draw cells of: the controls the tool gave come right under the words, with no scrolling to find them.
    chipRow.hidden = !data;
    cellsToggle.el.hidden = !data;
    canvas.setAttribute('aria-label', canvasLabel(data, fieldName()));
    canvas.dataset.seq = data ? String(data.seq) : '';
    syncScale();
    syncChips();
    syncLegend();
    syncRecording();
    syncFooter();
  }

  function updateReadout(): void {
    const on = !!reading && !!data;
    readout.hidden = !on;
    root.classList.toggle('slice-probing', on); // (the short landscape panel gives the footer's line to the reading while there is one)
    if (!on) {
      canvas.removeAttribute('aria-describedby');
      return;
    }
    text(readoutText, probeSentence(reading!, { units, kind: data!.kind }));
    canvas.setAttribute('aria-describedby', readoutId);
  }

  // ───────────── a new slice is drawn in the next display frame ─────────────
  let dirty = false; // `setData` has given a slice that the words, the layout and the picture have not caught up with
  let paintRaf = 0;

  /**
   * Put a new slice on screen: the layout, the words, the picture and the probe's reading, once however many slices came since the last frame.
   * It was done inside `setData`, which the scene calls from the update that places a line, and made that update about 10 ms longer at 4x CPU
   * (a 4x slowed phone): now `setData` only notes the slice and the repaint takes the next frame.
   */
  function catchUp(): void {
    if (paintRaf) {
      cancelAnimationFrame(paintRaf);
      paintRaf = 0;
    }
    if (!dirty || destroyed) return;
    dirty = false;
    if (!cssW) size(); // (a resize is the observer's: measuring the box at every slice would force a layout each time)
    computeLayout();
    if (data) {
      ensureFlow(data);
      staticDirty = true;
    }
    reading = data && probe ? probeAt(data, probe) : null;
    syncDom();
    updateReadout();
    paint();
    syncLoop();
  }

  // ───────────── input ─────────────
  let say = 0;
  /** A probe the user placed or moved (press, drag, arrow keys) or cleared (null). `speak`: a screen reader hears the reading, after a short pause so a held key does not queue. */
  function userProbe(pos: SliceProbePos | null, speak: boolean): void {
    if (dirty) catchUp();
    reading = data && pos ? probeAt(data, pos) : null;
    probe = reading ? reading.pos : null;
    updateReadout();
    paint();
    options.onProbe(probe);
    if (speak && reading && data) {
      const r = reading;
      const kind = data.kind;
      clearTimeout(say);
      say = window.setTimeout(() => options.announce(probeSentence(r, { units, kind })), 400);
    }
  }

  let dragging = false;
  const onPointer = (e: PointerEvent): void => {
    if (!data || !layout) return;
    if (e.type === 'pointerdown') {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
    } else if (!dragging) return; // no hover moves: a finger lifted off the glass or a mouse passing over must not move the probe
    const r = canvas.getBoundingClientRect();
    userProbe(pickPos(layout, e.clientX - r.left, e.clientY - r.top), false);
  };
  const endDrag = (e: PointerEvent): void => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  offs.push(
    listen(canvas, 'pointerdown', onPointer),
    listen(canvas, 'pointermove', onPointer),
    listen(canvas, 'pointerup', endDrag),
    listen(canvas, 'pointercancel', endDrag),
    listen(canvas, 'contextmenu', (e) => e.preventDefault()),
    listen(canvas, 'keydown', (e) => {
      const k = KEYS[e.key];
      if (k && data) {
        e.preventDefault();
        userProbe(moveProbe(data, probe, k, e.shiftKey), true);
      } else if (e.key === 'Escape' && probe) {
        e.preventDefault();
        e.stopPropagation();
        userProbe(null, false);
      }
    }),
    listen(document, 'visibilitychange', syncLoop),
  );

  function pickField(id: SliceFieldId): void {
    const c = chipModel(update?.fields, field).find((x) => x.id === id);
    // A chip that is off says why when it is tapped: the notes (and the button) are below the controls, so they are scrolled to.
    if (c && !c.available && !reasons.hidden) reasons.scrollIntoView?.({ block: 'nearest' });
    if (!c || !c.available || id === field) return;
    field = id;
    staticDirty = true;
    syncChips();
    syncLegend();
    canvas.setAttribute('aria-label', canvasLabel(data, fieldName()));
    paint();
    options.onField(id);
  }

  // ───────────── watching the box, the theme and the motion setting ─────────────
  const relayout = (force: boolean): void => {
    const changed = size();
    if (!changed && !force) return;
    computeLayout();
    if (data) ensureFlow(data);
    staticDirty = true;
    if (changed) clearTrail();
    syncDom();
    updateReadout();
    paint();
    syncLoop();
  };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => relayout(false));
    ro.observe(canvas);
    offs.push(() => ro.disconnect());
  }
  const retheme = (): void => {
    colours = null; // read again at the next size()
    relayout(true);
  };
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contrast', 'class', 'style'] });
    offs.push(() => mo.disconnect());
  }
  if (typeof matchMedia === 'function') {
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = (): void => {
      reduced = motion.matches;
      canvas.dataset.motion = reduced ? 'arrows' : 'streaks';
      if (reduced) {
        flow = null;
        seededSlice = null;
      } else if (data) ensureFlow(data);
      staticDirty = true;
      clearTrail();
      paint();
      syncLoop();
    };
    dark.addEventListener?.('change', retheme);
    motion.addEventListener?.('change', onMotion);
    offs.push(() => dark.removeEventListener?.('change', retheme), () => motion.removeEventListener?.('change', onMotion));
  }

  syncDom();

  return {
    el: root,
    setData(u) {
      update = u;
      data = u?.data ?? null;
      if (u) field = u.field;
      dirty = true;
      // Several slices in one frame are one repaint. Covered or off screen nothing is drawn: the next `setActive(true)` catches up.
      if (active && !paintRaf) {
        paintRaf = requestAnimationFrame(() => {
          paintRaf = 0;
          if (active) catchUp();
        });
      }
    },
    setProbe(pos) {
      if (dirty) catchUp();
      probe = pos;
      reading = data && pos ? probeAt(data, pos) : null;
      updateReadout();
      paint();
    },
    setField(f) {
      if (f === field) return;
      if (dirty) catchUp();
      field = f;
      staticDirty = true;
      syncChips();
      syncLegend();
      canvas.setAttribute('aria-label', canvasLabel(data, fieldName()));
      paint();
    },
    setShowCells(on) {
      if (on === showCells) return;
      if (dirty) catchUp();
      showCells = on;
      cellsToggle.set(on);
      staticDirty = true;
      syncRecording();
      paint();
    },
    setUnits(u) {
      if (dirty) catchUp();
      units = u;
      updateReadout();
    },
    setExaggeration(v) {
      if (v === vex) return;
      if (dirty) catchUp();
      vex = v;
      computeLayout();
      if (data) ensureFlow(data);
      staticDirty = true;
      clearTrail();
      syncScale();
      updateReadout();
      paint();
    },
    setActive(a) {
      active = a;
      if (a) {
        if (dirty) {
          dirty = false; // the full relayout below is the catch-up
          reading = data && probe ? probeAt(data, probe) : null;
        }
        relayout(true);
      } else syncLoop();
    },
    focus() {
      canvas.focus({ preventScroll: true });
    },
    focusRecording() {
      if (dirty) catchUp(); // (the words of the update the press just made, not the ones before it)
      if (recordingEl.hidden) return false;
      recordingEl.focus(); // scrolls to it, clear of the footer (`scroll-padding-bottom`), and a screen reader reads it
      return true;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (paintRaf) cancelAnimationFrame(paintRaf);
      paintRaf = 0;
      clearTimeout(say);
      for (const off of offs) off();
      offs.length = 0;
      for (const b of [canvas, still.canvas, trail.canvas, rasterBuf.canvas]) {
        b.width = 0;
        b.height = 0;
      }
    },
  };
}
