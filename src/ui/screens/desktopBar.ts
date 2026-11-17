/**
 * What a run that computes on the desktop adds to the simulation screen (0.8.0, workstream J), as a lazy chunk so the first screen carries
 * none of it: the label on the map ("Running on the desktop", in the demo engine's slot), the link's own sentence in the existing error
 * chip, and, in the chip's own pattern, the one way out when the desktop is gone: "Continue on this device". A tap starts the same
 * scenario again on this device's engine, from the start (src/ui/desktopRestart.ts); nothing switches by itself, the last picture stays
 * until the tap, and nothing pops up: the chip is the one strip the screen has for a failure, and the label is where the person looks.
 *
 * The link's END is what offers the action (`run.closed`, from the link's own `onClosed`); an engine's error message with the link still
 * open is only a message in the chip. The action is all or nothing: the button stays, busy, until this device's engine has started; if it
 * cannot, the chip says so in a sentence and the same button tries again with a fresh engine.
 */
import { detailChoice } from '../desktopDetailChoice';
import { continueOnDevice } from '../desktopRestart';
import { desktopSlot, type DecorateOptions, type DesktopApi } from '../desktopSlot';
import { CLOSED_LINK, CONTINUE_BUSY, CONTINUE_FAILED, CONTINUE_HERE, RESTARTED_HERE } from '../desktopWords';
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
  // A run with a finer Desktop detail that this device cannot run by itself (0.9.0, D35): the chip says so and offers the standard detail instead of a restart
  // that would fail; the grid is never lowered for the person, who sets up again (desktopDetailRun.ts decides, from the run's own grid and the device's memory).
  const refusal = o.continueRefusal?.() ?? null;
  let again = false; // the run is this device's now
  let busy = false;
  let failed = false;
  const go = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-text btn-sm error-chip-btn',
      hidden: true,
      dataset: { testid: 'continue-here' },
      on: {
        click: () => {
          if (refusal) {
            detailChoice.set({ level: 'standard' });
            host.choose('device');
            o.exit?.();
            return;
          }
          const proxy = host.proxy();
          if (!proxy || busy || again) return;
          busy = true;
          failed = false;
          refresh();
          continueOnDevice({
            session: o.session,
            proxy,
            makeController: o.makeController,
            announce: o.announce,
            // The new engine has answered: only now the desktop gives up its link, and the run, the chip and the label are this device's.
            started: () => {
              again = true;
              host.leave();
              go.remove();
              errorText.classList.remove('error-chip-says');
              o.chip.classList.remove('error-chip-acts');
              text(errorText, 'Simulation problem');
              text(banner, RESTARTED_HERE);
              banner.classList.add('engine-banner-note');
            },
          })
            .catch(() => {
              failed = true;
            })
            .finally(() => {
              busy = false;
              refresh();
            });
        },
      },
    },
    CONTINUE_HERE,
  );
  if (details) o.chip.insertBefore(go, details);
  else o.chip.append(go);

  /** The chip says what it knows: the link's sentence once the link ended (and the action), else the engine's message; after a failed start, that. */
  function refresh(): void {
    if (again) return;
    const r = desktopSlot.get().run;
    const s = o.session.state.get();
    const ended = !!r?.closed;
    // The link ended, and the session has not heard of it (a link that only says so through onClosed): it hears of it now, as an error, so playback stops and the chip shows.
    if (ended && !s.error) {
      host.proxy()?.fail(r?.closedReason ?? CLOSED_LINK);
      return;
    }
    if (s.error) text(errorText, failed ? CONTINUE_FAILED : ended ? (r?.closedReason ?? s.error) : s.error);
    text(go, busy ? CONTINUE_BUSY : CONTINUE_HERE);
    if (refusal && ended && s.error) {
      text(errorText, `${r?.closedReason ?? s.error} ${refusal.short}`);
      errorText.title = refusal.sentence;
      text(go, refusal.action);
    }
    go.disabled = busy;
    show(go, ended && !!s.error);
  }
  refresh();
  const stops = [o.session.state.subscribe(refresh, ['error']), desktopSlot.subscribe(refresh, ['run'])];
  return () => {
    for (const stop of stops) stop();
    go.remove();
  };
}
