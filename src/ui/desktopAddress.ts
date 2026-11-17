/**
 * The address of a desktop host that the person types (0.9.0, workstream P, decision D36). The Android app is not served by a host, so it
 * has none to ask: the person types where the desktop is, and the code. This file is the whole of what the page does with that address,
 * as pure functions, plus the one place it is remembered:
 *   - `parseDesktopAddress` turns what was typed into the base address of the link (`http://192.168.1.20:4300`) or says which part is
 *     wrong. It accepts an IPv4 address, a name, a bracketed IPv6 address, each with or without a port (4300 when none is typed) and with
 *     or without `http://` or `https://`; it refuses a path, a query, a fragment, credentials, any other scheme and a port that is not one.
 *   - `loadAddress` and `saveAddress` keep the address (and nothing else: never the code) in the app's preferences, so the box is filled
 *     in the next time. The code is typed again every time and lives in memory only (desktopHost.ts).
 * Nothing here asks the network.
 */
import { getPref, setPref } from './prefs';

/** The port the desktop host listens on unless it was started with another (desktop/README.md). */
export const DEFAULT_PORT = 4300;

/** Which part of the typed text is wrong. */
export type AddressProblem = 'empty' | 'scheme' | 'credentials' | 'path' | 'host' | 'ipv6' | 'port';

export type ParsedAddress =
  | {
      ok: true;
      /** `scheme://host:port`, no slash: what `connectRemote({ base })` and `detectHost({ base })` take. */
      base: string;
      scheme: 'http' | 'https';
      /** The host as the address bar writes it (lower case; an IPv6 address in square brackets). */
      host: string;
      port: number;
      /** `host:port`, for a sentence that says where the page is connecting. */
      shown: string;
    }
  | { ok: false; problem: AddressProblem };

const fail = (problem: AddressProblem): ParsedAddress => ({ ok: false, problem });

/** A DNS name: dot-separated labels of letters, digits and hyphens (none starting or ending with a hyphen). */
const NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Four numbers of 0 to 255, none with a leading zero (a browser reads `010` as octal, so it is refused rather than guessed at). */
function validIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  return !!m && m.slice(1).every((part) => (part === '0' || !part.startsWith('0')) && Number(part) <= 255);
}

/** `[...]` as typed (brackets included) is an IPv6 address the URL parser accepts. */
function validIpv6(bracketed: string): boolean {
  const inner = bracketed.slice(1, -1);
  if (!/^[0-9a-f:.]+$/i.test(inner) || (inner.match(/:/g)?.length ?? 0) < 2) return false;
  try {
    new URL(`http://${bracketed}`);
    return true;
  } catch {
    return false;
  }
}

export function parseDesktopAddress(input: string): ParsedAddress {
  const text = input.trim();
  if (!text) return fail('empty');
  if (/\s/.test(text)) return fail('host');
  if (text.includes('@')) return fail('credentials');
  let rest = text;
  let scheme: 'http' | 'https' = 'http';
  const given = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (given) {
    const s = given[1]!.toLowerCase();
    if (s !== 'http' && s !== 'https') return fail('scheme');
    scheme = s;
    rest = rest.slice(given[0].length);
  }
  // The authority ends at the first / ? or #. Only one slash after it is let through (a pasted address often has it).
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const tail = end === -1 ? '' : rest.slice(end);
  if (tail !== '' && tail !== '/') return fail('path');

  let host: string;
  let portText: string | undefined;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close === -1) return fail('host');
    host = authority.slice(0, close + 1);
    const after = authority.slice(close + 1);
    if (after !== '') {
      if (!after.startsWith(':')) return fail('host');
      portText = after.slice(1);
    }
    if (!validIpv6(host)) return fail('host');
  } else {
    const colons = authority.split(':').length - 1;
    if (colons > 1) return fail('ipv6'); // an IPv6 address without its brackets cannot be told from a host and a port
    const i = authority.indexOf(':');
    host = i === -1 ? authority : authority.slice(0, i);
    portText = i === -1 ? undefined : authority.slice(i + 1);
    if (!host) return fail('host');
    if (/^[0-9.]+$/.test(host)) {
      if (!validIpv4(host)) return fail('host');
    } else if (!NAME.test(host.toLowerCase())) return fail('host');
  }
  host = host.toLowerCase();

  let port = DEFAULT_PORT;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) return fail('port');
    port = Number(portText);
    if (port < 1 || port > 65535) return fail('port');
  }
  return { ok: true, base: `${scheme}://${host}:${port}`, scheme, host, port, shown: `${host}:${port}` };
}

/** The preference that holds the address (not the code). */
export const ADDRESS_PREF = 'desktopAddress';

/** The address typed last time, or ''. Never throws. */
export async function loadAddress(): Promise<string> {
  const v = await getPref<unknown>(ADDRESS_PREF, '');
  return typeof v === 'string' && parseDesktopAddress(v).ok ? v : '';
}

/** Remember the address typed (only one that parses; nothing else is stored, and never the code). */
export async function saveAddress(text: string): Promise<void> {
  const t = text.trim();
  if (parseDesktopAddress(t).ok) await setPref(ADDRESS_PREF, t);
}
