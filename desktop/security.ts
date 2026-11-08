/**
 * What guards the engine of the desktop host (contract 0.8.0 J, 3.2): the pairing code, the comparison of it, the limit on
 * wrong ones and the check of where a browser page came from. Pure functions and one small class, so each is tested alone.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/** No I, O, 0 or 1: a code is read aloud and typed on a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/** A pairing code of 8 characters of {@link CODE_ALPHABET}, from the operating system's random source. */
export function generateCode(pick: (max: number) => number = (max) => randomInt(max)): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return s;
}

/** A code as typed (trimmed, in capitals), or null when it cannot be one (8 to 32 letters and digits: `--code` accepts any such). */
export function normaliseCode(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toUpperCase();
  return /^[A-Z0-9]{8,32}$/.test(t) ? t : null;
}

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** Whether `given` is the code, comparing in constant time (both are hashed to 32 bytes first, so the length is not a signal either). */
export function codesMatch(given: unknown, expected: string): boolean {
  const g = normaliseCode(given);
  const same = timingSafeEqual(digest(g ?? ''), digest(expected));
  return same && g !== null;
}

/** The origins of the apps that wrap this page: the Android app's WebView (`androidScheme` https) and the iOS one. `--allow-app` lists these two. */
export const APP_ORIGINS: readonly string[] = ['https://localhost', 'capacitor://localhost'];

/**
 * An origin as `--allow-origin` takes it and as a browser writes it in an `Origin` header: `scheme://host[:port]` with the scheme
 * http, https or capacitor, a name, an IPv4 address or an IPv6 address in brackets, and an optional port; lower case, with the
 * default port left out (a browser leaves it out too). No path, no query, no credentials, no `*` and no `null`: null for those.
 */
export function normaliseOrigin(s: unknown): string | null {
  if (typeof s !== 'string' || s.length > 300) return null;
  const m = /^(https?|capacitor):\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(s.trim());
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  let host = m[2]!.toLowerCase();
  if (host.startsWith('[')) {
    if (!isIPv6(host.slice(1, -1))) return null;
    // The way a browser writes it: compressed, as the URL parser does (the app scheme has no such parser here, and writes it as given).
    if (scheme !== 'capacitor') {
      try {
        host = new URL(`http://${host}`).hostname;
      } catch {
        return null;
      }
    }
  }
  const port = m[3] === undefined ? null : Number(m[3]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  const isDefault = port === null || (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
  return `${scheme}://${host}${isDefault ? '' : `:${port}`}`;
}

/** The listed origin that `origin` (an Origin header) is, in the form a browser expects back in `Access-Control-Allow-Origin`, or null. */
export function listedOrigin(origin: string | undefined, allowed: readonly string[]): string | null {
  const o = normaliseOrigin(origin);
  return o !== null && allowed.includes(o) ? o : null;
}

/**
 * A browser sends the page's origin with a WebSocket handshake. A page served by this host has the origin of the address it
 * was fetched from, so its host and port equal the request's `Host` header; a page from anywhere else does not, unless its origin
 * is one the owner listed (`--allow-origin`, `--allow-app`: `allowed`, each from `normaliseOrigin`). No Origin at all is a client
 * that is not a browser page (a script, the tests): it still needs the code.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: readonly string[] = []): boolean {
  if (origin === undefined) return true;
  if (listedOrigin(origin, allowed) !== null) return true;
  if (!host) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false; // includes the literal "null" of a sandboxed or file page
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.host.toLowerCase() === host.toLowerCase();
}

/**
 * The names under which a browser may reach this host (the `Host` header of every request and handshake). A page that a
 * DNS-rebinding attacker serves from his own name reaches this computer with that name in `Host` and an `Origin` that matches it,
 * so the Origin check alone lets it through; the host name is what it cannot fake. Allowed: an IPv4 literal, a bracketed IPv6
 * literal, `localhost`, and the names in `names` (this computer's name, `<name>.local` and the `--allow-host` ones). Anything else,
 * and a header that is missing or is not a host and an optional port, is refused.
 */
export function hostAllowed(header: string | undefined, names: readonly string[]): boolean {
  if (!header || header.length > 255) return false;
  const m = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(header);
  if (!m || (m[2] !== undefined && Number(m[2]) > 65535)) return false;
  const host = m[1]!.toLowerCase();
  if (host.startsWith('[')) return isIPv6(host.slice(1, -1));
  return isIPv4(host) || host === 'localhost' || names.includes(host);
}

/** This computer's names for `hostAllowed`: its host name, the same with `.local` (what a phone's mDNS finds), and the extra names, in lower case. */
export function allowedHostNames(hostname: string, extra: readonly string[] = []): string[] {
  const own = hostname.trim().toLowerCase();
  const names = own ? [own, ...(own.endsWith('.local') ? [] : [`${own}.local`])] : [];
  return [...new Set([...names, ...extra.map((x) => x.toLowerCase())])];
}

/** A name for `--allow-host`: letters, digits, dots and hyphens (no port, no brackets), at most 253 characters; lower-cased, or null. */
export function normaliseHostName(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(t) && t.length <= 253 ? t : null;
}

/** The address a connection counts under: IPv4-mapped IPv6 addresses are the IPv4 address. */
export function addressKey(address: string | undefined): string {
  if (!address) return 'unknown';
  return address.toLowerCase().replace(/^::ffff:/, '');
}

export interface RateLimitOptions {
  /** Wrong codes from one address before it is refused (default 5). */
  max?: number;
  /** How long it is refused (ms, default 60 000). */
  blockMs?: number;
  /** How long a wrong code is remembered while the address is not refused (ms, default 600 000). */
  forgetMs?: number;
  /** The most addresses remembered. */
  capacity?: number;
}

/** After `max` wrong codes from one address, that address is refused for `blockMs`. Time is passed in, so tests need no clock. */
export class RateLimiter {
  private readonly entries = new Map<string, { fails: number; last: number; blockedUntil: number }>();
  private readonly max: number;
  private readonly blockMs: number;
  private readonly forgetMs: number;
  private readonly capacity: number;

  constructor(o: RateLimitOptions = {}) {
    this.max = o.max ?? 5;
    this.blockMs = o.blockMs ?? 60_000;
    this.forgetMs = o.forgetMs ?? 600_000;
    this.capacity = o.capacity ?? 4096;
  }

  isBlocked(key: string, now: number): boolean {
    const e = this.entries.get(key);
    return e !== undefined && e.blockedUntil > now;
  }

  /** Count a wrong code; true when this one made the address refused. */
  recordFailure(key: string, now: number): boolean {
    this.sweep(now);
    let e = this.entries.get(key);
    if (!e || (e.blockedUntil > 0 && e.blockedUntil <= now) || now - e.last > this.forgetMs) this.entries.set(key, (e = { fails: 0, last: now, blockedUntil: 0 }));
    e.fails++;
    e.last = now;
    if (e.fails >= this.max) {
      e.blockedUntil = now + this.blockMs;
      return true;
    }
    return false;
  }

  /** A right code clears the count (an address that is refused stays refused until its time is up). */
  recordSuccess(key: string, now: number): void {
    if (!this.isBlocked(key, now)) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(now: number): void {
    if (this.entries.size < this.capacity) return;
    for (const [k, e] of this.entries) if (e.blockedUntil <= now && now - e.last > this.forgetMs) this.entries.delete(k);
    // Still full of addresses that are refused or recent: the oldest go (a flood of addresses cannot grow the table).
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value as string);
  }
}

/** Counts events in windows of `windowMs` (default one second); the time is passed in. For the ping and message limits of a session. */
export class FixedWindowCounter {
  private start = -Infinity;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs = 1000,
  ) {}

  /** Count one event at `now`; true when this window has now had more than `limit` of them. */
  exceeded(now: number): boolean {
    if (now - this.start >= this.windowMs) {
      this.start = now;
      this.count = 0;
    }
    return ++this.count > this.limit;
  }
}
