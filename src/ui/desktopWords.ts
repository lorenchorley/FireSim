/**
 * The words of the desktop engine (0.8.0, workstream J): the Setup row, the line on a run that computes on the desktop, the
 * closed link. Plain words, sentence case, "about" for numbers, no em dashes (the voice of content.ts). Pure, so the node tests
 * pin them. The Help entry and the README say the longer version (what the desktop engine is and is not); these are the labels.
 */
import type { HostInfo } from './desktopTypes';

export const ENGINE_LABEL = 'Engine';
export const ENGINE_THIS_DEVICE = 'This device';
export const CODE_LABEL = 'Desktop code';
export const CODE_PLACEHOLDER = 'The code the desktop shows';

/** The label on the map while the run computes on the desktop (the pattern of the demo engine's label). */
export const RUNNING_ON_DESKTOP = 'Running on the desktop';
/** What the error chip says when the link goes (the controller's own sentence, the same words). */
export const CLOSED_LINK = 'The desktop connection closed.';

/** The sentence under the Engine chips, by what is chosen and what is known. */
export const ENGINE_HINT = {
  device: 'The simulation runs on this device.',
  desktopLink: 'The simulation runs on the desktop computer. The code came with the link you opened.',
  desktopCode: 'The simulation runs on the desktop computer. Type the code the desktop shows.',
  connecting: 'Connecting to the desktop…',
} as const;

/** What went wrong, said next to the code box (a note on the page, never a pop-up). */
export const ENGINE_PROBLEM = {
  needsCode: 'Type the code the desktop shows, then build again.',
  refused: 'The desktop did not accept that code. Check the code it shows and type it again. After several wrong tries it waits about a minute.',
  unreachable: 'Could not reach the desktop. Check that it is still running, then try again.',
  noLink: 'The desktop connection is not open. Go back to Setup and try again.',
} as const;

const NAME_MAX = 40;
const CHIP_NAME_MAX = 24;

/** A computer name the page can show: no control characters, one line, not too long (the host is on the same origin, but it is still text from outside). */
export function cleanName(name: string, max = NAME_MAX): string {
  const t = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 'this computer';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const coresWords = (n: number): string => `${n} ${n === 1 ? 'core' : 'cores'}`;

/** The second chip of the Engine row: "Desktop (Studio PC, 8 cores)". */
export const desktopChoiceLabel = (h: Pick<HostInfo, 'name' | 'cores'>): string => `Desktop (${cleanName(h.name, CHIP_NAME_MAX)}, ${coresWords(h.cores)})`;

/** The engine row of the debug statistics for a run on the desktop: its computer, Node and the round trip. */
export function engineWhereText(run: { name: string; cores: number; node: string; rttMs: number | null; closed: boolean }): string {
  const who = `Desktop ${cleanName(run.name)}, ${coresWords(run.cores)}, Node ${cleanName(run.node, 20)}`;
  if (run.closed) return `${who} (the connection closed)`;
  const rtt = run.rttMs;
  return `${who}, link ${typeof rtt === 'number' && Number.isFinite(rtt) ? `${rtt < 10 ? rtt.toFixed(1) : Math.round(rtt)} ms` : 'not measured yet'}`;
}
