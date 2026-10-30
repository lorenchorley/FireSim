/** The four pips of the Wind detail chip and sheet (0.6.0): a filled circle for each step reached and a ring for the rest (the shape carries the step, not the colour). */
import { h } from '../../dom';

/** The steps of wind detail, one pip each. */
const STEPS = 4;

/** The four pips: a filled circle for each step reached and a ring for the rest. Decorative (the words carry the step); the chip and the sheet draw the same ones. */
export function createPips(): { el: HTMLElement; set(level: number): void } {
  const pips = Array.from({ length: STEPS }, () => h('span', { class: 'wd-pip' }));
  return { el: h('span', { class: 'wd-pips', aria: { hidden: true } }, pips), set: (level) => pips.forEach((p, n) => p.classList.toggle('is-on', n < level)) };
}
