/**
 * Playback speed: the button shows the current speed; its popover (collapsed until asked for) has presets from 0.25× to
 * 1 h of fire per second and "as fast as possible", a logarithmic slider for any speed in between, and a custom field
 * (× or minutes per second). The chosen speed is remembered in the settings.
 */
import { h, text } from '../../dom';
import { icon } from '../../icons';
import { rangeFill } from '../../primitives';
import { formatPlaybackSpeed, formatSpeedHint, formatSpeedMultiple, formatSpeedRate } from '../../format';
import { speedFromStored, speedToStored } from '../../settings';
import type { SimContext } from './context';
import { customFieldValue, type CustomUnit, parseCustomSpeed, SLIDER_STEPS, SPEED_PRESETS, sliderToSpeed, speedToSlider } from './speedModel';
import { frameThrottle } from './transportKit';

export interface SpeedControl {
  button: HTMLButtonElement;
  panel: HTMLElement;
  destroy(): void;
}

export function createSpeedControl(ctx: SimContext): SpeedControl {
  const { session } = ctx;
  const label = h('span', { class: 'tb-speed-label' }, '60×');
  const button = h(
    'button',
    {
      type: 'button',
      class: 'tb-btn tb-speed',
      dataset: { testid: 'speed' },
      aria: { haspopup: 'dialog', expanded: false, label: 'Playback speed' },
    },
    [icon('speed', { size: 18 }), label],
  );

  const choose = (speed: number): void => {
    session.setSpeed(speed);
    remember(speed);
  };
  const remember = (speed: number): void => ctx.settings.set({ defaultSpeed: speedToStored(speed) });

  // ── presets ──
  const presetBtn = (sp: number): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        class: sp === Infinity ? 'tp-chip tp-chip-max speed-item' : 'tp-chip speed-item',
        dataset: { speed: String(sp) },
        aria: { pressed: false },
        on: { click: () => choose(sp) },
      },
      sp === Infinity
        ? [h('span', { class: 'tp-chip-main' }, 'Max'), h('span', { class: 'tp-chip-sub' }, 'As fast as possible')]
        : [h('span', { class: 'tp-chip-main' }, formatSpeedMultiple(sp)), h('span', { class: 'tp-chip-sub' }, formatSpeedRate(sp))],
    );
  const presets = [...SPEED_PRESETS, Infinity].map(presetBtn);

  // ── slider ──
  const sliderId = `spd-${Math.random().toString(36).slice(2, 7)}`;
  const sliderOut = h('output', { class: 'tp-value', attrs: { for: sliderId } }, '');
  const slider = h('input', {
    type: 'range',
    id: sliderId,
    class: 'tp-range',
    min: '0',
    max: String(SLIDER_STEPS),
    step: '1',
    value: '0',
    dataset: { testid: 'speed-slider' },
  });
  let sliding = false;
  const applySlider = frameThrottle<number>((pos) => session.setSpeed(sliderToSpeed(pos)));
  slider.addEventListener('input', () => {
    sliding = true;
    rangeFill(slider);
    applySlider.push(Number(slider.value));
  });
  slider.addEventListener('change', () => {
    applySlider.flush();
    sliding = false;
    remember(session.state.get().speed);
    sync();
  });

  // ── custom ──
  let unit: CustomUnit = 'x';
  const customInput = h('input', {
    type: 'number',
    class: 'tp-input',
    inputMode: 'decimal',
    step: 'any',
    min: '0',
    dataset: { testid: 'speed-custom' },
    aria: { label: 'Custom speed' },
    on: {
      keydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustom();
        }
      },
    },
  });
  const customMsg = h('p', { class: 'tp-msg', hidden: true, attrs: { role: 'status' } });
  const unitBtn = (u: CustomUnit, name: string): HTMLButtonElement =>
    h('button', { type: 'button', class: 'tp-seg', dataset: { unit: u, testid: `speed-unit-${u}` }, aria: { pressed: u === unit }, on: { click: () => setUnit(u) } }, name);
  const unitBtns = [unitBtn('x', '×'), unitBtn('minps', 'min/s')];
  function setUnit(u: CustomUnit): void {
    unit = u;
    for (const b of unitBtns) b.setAttribute('aria-pressed', String(b.dataset.unit === u));
    customInput.value = customFieldValue(session.state.get().speed, u);
  }
  function applyCustom(): void {
    const sp = parseCustomSpeed(customInput.valueAsNumber, unit);
    if (sp === null) {
      customMsg.hidden = false;
      text(customMsg, 'Type a number above 0.');
      customInput.focus();
      return;
    }
    const typed = customInput.valueAsNumber * (unit === 'minps' ? 60 : 1);
    customMsg.hidden = sp === typed;
    if (sp !== typed) text(customMsg, `Limited to ${formatPlaybackSpeed(sp)}.`);
    choose(sp);
    customInput.value = customFieldValue(sp, unit);
  }

  const hint = h('p', { class: 'tp-hint', attrs: { role: 'status' }, dataset: { testid: 'speed-hint' } });
  const panel = h(
    'div',
    {
      class: 'tb-pop tb-pop-right tp tp-2col',
      dataset: { testid: 'speed-popover' },
      attrs: { role: 'dialog', tabindex: '-1' },
      aria: { label: 'Playback speed' },
      hidden: true,
    },
    [
      h('div', { class: 'tp-col' }, [h('h2', { class: 'tp-title' }, 'Playback speed'), h('div', { class: 'tp-grid tp-speeds' }, presets)]),
      h('div', { class: 'tp-col' }, [
        hint,
        h('div', { class: 'tp-block' }, [
          h('div', { class: 'tp-row' }, [h('label', { class: 'tp-label', htmlFor: sliderId }, 'Any speed'), sliderOut]),
          slider,
          h('div', { class: 'tp-ends', aria: { hidden: true } }, [h('span', null, '0.25×'), h('span', null, '1 h/s')]),
        ]),
        h('div', { class: 'tp-block' }, [
          h('div', { class: 'tp-label' }, 'Custom'),
          h('div', { class: 'tp-custom' }, [
            customInput,
            h('div', { class: 'tp-segs', attrs: { role: 'group' }, aria: { label: 'Unit' } }, unitBtns),
            h('button', { type: 'button', class: 'tp-go', dataset: { testid: 'speed-custom-set' }, on: { click: applyCustom } }, 'Set'),
          ]),
          customMsg,
        ]),
      ]),
    ],
  );

  let key = Number.NaN;
  function sync(): void {
    const sp = session.state.get().speed;
    if (Object.is(sp, key) && !sliding) return;
    key = sp;
    text(label, formatPlaybackSpeed(sp));
    button.setAttribute('aria-label', `Playback speed ${formatPlaybackSpeed(sp)}, ${formatSpeedHint(sp)}`);
    text(hint, Number.isFinite(sp) ? `${formatSpeedMultiple(sp)} — ${formatSpeedHint(sp)}` : formatSpeedHint(sp));
    text(sliderOut, formatPlaybackSpeed(sp));
    for (const b of presets) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === sp));
    if (!sliding) {
      slider.value = String(speedToSlider(sp));
      rangeFill(slider);
      slider.setAttribute('aria-valuetext', `${formatPlaybackSpeed(sp)}, ${formatSpeedHint(sp)}`);
    }
    if (document.activeElement !== customInput) customInput.value = customFieldValue(sp, unit);
  }
  const unsub = session.state.subscribe(sync, ['speed']);
  // The speed the user last chose is the speed a new run starts at.
  session.setSpeed(speedFromStored(ctx.settings.get().defaultSpeed));
  sync();
  return {
    button,
    panel,
    destroy() {
      unsub();
      applySlider.cancel();
    },
  };
}
