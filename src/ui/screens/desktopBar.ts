/**
 * What a run that computes on the desktop adds to the simulation screen (0.8.0, workstream J), as a lazy chunk so the first screen carries
 * none of it: the label on the map ("Running on the desktop", in the demo engine's slot), the link's own sentence in the existing error
 * chip, and, in the chip's own pattern, the one way out when the desktop is gone: "Continue on this device". A tap starts the same
 * scenario again on this device's engine, from the start (src/ui/desktopRestart.ts); nothing switches by itself, the last picture stays
 * until the tap, and nothing pops up: the chip is the one strip the screen has for a failure, and the label is where the person looks.
 */
import { continueOnDevice } from '../desktopRestart';
import { desktopSlot, type DecorateOptions, type DesktopApi } from '../desktopSlot';
import { CONTINUE_HERE, RESTARTED_HERE } from '../desktopWords';
import { h, show, text } from '../dom';

export function decorateSim(host: DesktopApi, o: DecorateOptions): () => void {
  const run = desktopSlot.get().run;
  // The label: the demo engine's slot, taken over (the desktop, not the demo engine, computes this run); a 2-D map still says so.
  const map2d = o.notice?.textContent === '2-D map';
  const banner = o.notice ?? o.root.appendChild(h('p', { class: 'mock-banner' }));
  banner.classList.add('engine-banner');
  banner.dataset.testid = 'engine-banner';
  text(banner, `${run?.label ?? ''}${map2d ? ' · 2-D map' : ''}`);

  // The chip: the sentence the link gave, and the action beside "Details".
  const errorText = o.chip.querySelector<HTMLElement>('.error-chip-text')!;
  const details = o.chip.querySelector('.error-chip-btn');
  errorText.classList.add('error-chip-says');
  o.chip.classList.add('error-chip-acts');
  let again = false;
  const go = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-text btn-sm error-chip-btn',
      hidden: true,
      dataset: { testid: 'continue-here' },
      on: {
        click: () => {
          const proxy = host.leave();
          if (!proxy) return;
          again = true;
          go.remove();
          errorText.classList.remove('error-chip-says');
          o.chip.classList.remove('error-chip-acts');
          text(errorText, 'Simulation problem');
          text(banner, RESTARTED_HERE);
          banner.classList.add('engine-banner-note');
          continueOnDevice({ session: o.session, proxy, makeController: o.makeController, announce: o.announce }).catch((e: unknown) => o.session.state.set({ error: e instanceof Error ? e.message : String(e) }));
        },
      },
    },
    CONTINUE_HERE,
  );
  if (details) o.chip.insertBefore(go, details);
  else o.chip.append(go);
  const show1 = (s: { error: string | null }): void => {
    if (again) return;
    if (s.error) text(errorText, s.error);
    show(go, !!s.error);
  };
  show1(o.session.state.get());
  const stop = o.session.state.subscribe(show1, ['error']);
  return () => {
    stop();
    go.remove();
  };
}
