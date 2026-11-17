/**
 * The words of the desktop engine (0.8.0, workstream J): the Setup row, the line on a run that computes on the desktop, the
 * closed link. Plain words, sentence case, "about" for numbers, no em dashes (the voice of content.ts). Pure, so the node tests
 * pin them. The Help entry and the README say the longer version (what the desktop engine is and is not); these are the labels.
 */
import type { AddressProblem } from './desktopAddress';
import type { HostInfo } from './desktopTypes';

export const ENGINE_LABEL = 'Engine';
export const ENGINE_THIS_DEVICE = 'This device';
export const CODE_LABEL = 'Desktop code';
export const CODE_PLACEHOLDER = 'The code the desktop shows';
/** The Android app has no desktop to ask: the person types where it is (0.9.0). */
export const ADDRESS_LABEL = 'Desktop address';
export const ADDRESS_PLACEHOLDER = '192.168.1.20';
/** The second chip before the desktop has said who it is: on a page it serves, and in the app. After its welcome the chip names it (`desktopChoiceLabel`). */
export const ENGINE_DESKTOP = 'Desktop';
export const ENGINE_ANOTHER_COMPUTER = 'Desktop (another computer)';

/** The label on the map while the run computes on the desktop (the pattern of the demo engine's label). */
export const RUNNING_ON_DESKTOP = 'Running on the desktop';
/** What the error chip says when the link goes (the controller's own sentence, the same words). */
export const CLOSED_LINK = 'The desktop connection closed.';

/** The action in the error chip (and in the note on Setup) when the desktop is gone: start the same scenario again on this device. Never automatic. */
export const CONTINUE_HERE = 'Continue on this device';
/** What is said when it was tapped: the label on the map for the rest of that run, and the announcement. */
export const RESTARTED_HERE = 'Running on this device again, from the start.';
/** On the button while this device starts the run (the model is set up again: a few seconds). */
export const CONTINUE_BUSY = 'Starting on this device…';
/** In the chip when this device could not start it: the button stays, and a second tap tries again with a fresh engine. */
export const CONTINUE_FAILED = 'This device could not start the run. Tap to try again.';
/** The help line of the Insights tab's error note on a run whose desktop went away (the note itself keeps the link's sentence). It leads with the action. */
export const CLOSED_LINK_HELP =
  'Tap “Continue on this device” to run this scenario again here, from the start, with the fires and changes you marked. Until then the view keeps what the desktop had computed. Or open the menu (top left) and start a new scenario.';

/** The sentence under the Engine chips, by what is chosen and what is known. */
export const ENGINE_HINT = {
  device: 'The simulation runs on this device.',
  desktopLink: 'The simulation runs on the desktop computer. The code came with the link you opened.',
  desktopCode: 'The simulation runs on the desktop computer. Type the code the desktop shows.',
  /** The app (or the test seam): the desktop is another computer on this network, found by the address typed. */
  desktopAddress: 'The simulation runs on another computer on this network. Type the address and the code the desktop shows.',
  connecting: 'Connecting to the desktop…',
} as const;

/** What went wrong, said next to the code box (a note on the page, never a pop-up). */
export const ENGINE_PROBLEM = {
  needsCode: 'Type the code the desktop shows, then build again.',
  refused: 'The desktop did not accept that code. Check the code it shows and type it again. After several wrong tries it waits about a minute.',
  /** The right code or not, the desktop has stopped taking codes from this device for a while (after several wrong tries). */
  rateLimited: 'The desktop is waiting before it takes another code. Try again in about a minute.',
  unreachable: 'Could not reach the desktop. Check that it is still running, then try again.',
  noLink: 'The desktop connection is not open. Go back to Setup and try again.',
  /** Typed address (0.9.0): nothing was typed. */
  needsAddress: 'Type the desktop’s address, for example 192.168.1.20, then build again.',
  /** Typed address: nothing answered there. The host must be started with --lan (to be reachable at all) and --allow-app (to let the app in). */
  noAnswer: 'No desktop answered at that address. Check that it is running with --lan and --allow-app, and that this device is on the same network.',
  /** Typed address: something answered, but would not let this page or app connect (its origin is not on the desktop’s list). */
  notAllowed: 'The desktop is there but did not let this app connect. Start it with --allow-app (or with --allow-origin for this page), then try again.',
  /** The desktop has no session to spare (it was started with a limit and every one is in use). */
  noSession: 'The desktop has no free session. Close a run on it, or start it with more --max-sessions, then try again.',
} as const;

/** What is wrong with a typed address, said next to the box (the voice of the rest: plain words, an example, no jargon). */
export const ADDRESS_PROBLEM: Record<AddressProblem, string> = {
  empty: ENGINE_PROBLEM.needsAddress,
  scheme: 'The address can start with http:// or https:// or with nothing at all. Other kinds of address do not work here.',
  credentials: 'Leave out any user name and password. Type only the address, for example 192.168.1.20.',
  path: 'Type only the address and, if it has one, the port, for example 192.168.1.20:4300. Leave out anything after it.',
  host: 'That does not look like a computer’s address. Use numbers like 192.168.1.20, or the computer’s name.',
  ipv6: 'Put an IPv6 address in square brackets, for example [fe80::1].',
  port: 'The port must be a number from 1 to 65535. The desktop uses 4300 unless it was started with another.',
};

/**
 * The page and the desktop speak different versions of the link (a `RemoteVersionError`): the one thing to do is to update one of them. The
 * two numbers are said when the error has them.
 */
export function versionProblem(page: number | null, host: number | null): string {
  const numbers = page !== null && host !== null ? ` (this app speaks version ${page}, the desktop version ${host})` : '';
  return `This app and the desktop do not speak the same version of the link${numbers}. Update the app or the desktop host.`;
}

const NAME_MAX = 40;
const CHIP_NAME_MAX = 24;

/** A computer name the page can show: no control characters, one line, not too long (the host is on the same origin, but it is still text from outside). */
export function cleanName(name: string, max = NAME_MAX): string {
  const t = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 'this computer';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const coresWords = (n: number): string => `${n} ${n === 1 ? 'core' : 'cores'}`;

/**
 * The second chip of the Engine row, in two steps (0.9.0: before its code the host says nothing of itself): "Desktop" (or, in the app, "Desktop
 * (another computer)") until the desktop has welcomed the page, then "Desktop (Studio PC, 8 cores)".
 */
export const desktopChoiceLabel = (h: Pick<HostInfo, 'name' | 'cores'> | null, typed = false): string =>
  h ? `Desktop (${cleanName(h.name, CHIP_NAME_MAX)}, ${coresWords(h.cores)})` : typed ? ENGINE_ANOTHER_COMPUTER : ENGINE_DESKTOP;

/** The engine row of the debug statistics for a run on the desktop: its computer, Node and the round trip. */
export function engineWhereText(run: { name: string; cores: number; node: string; rttMs: number | null; closed: boolean; restarted?: boolean }): string {
  const who = `Desktop ${cleanName(run.name)}, ${coresWords(run.cores)}, Node ${cleanName(run.node, 20)}`;
  if (run.restarted) return 'This device (the run was started again here, from the start, after the desktop connection closed)';
  if (run.closed) return `${who} (the connection closed)`;
  const rtt = run.rttMs;
  return `${who}, link ${typeof rtt === 'number' && Number.isFinite(rtt) ? `${rtt < 10 ? rtt.toFixed(1) : Math.round(rtt)} ms` : 'not measured yet'}`;
}
