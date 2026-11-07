/**
 * What guards the engine of the desktop host (contract 0.8.0 J, 3.2): the pairing code, the comparison of it, the limit on
 * wrong ones and the check of where a browser page came from. Pure functions and one small class, so each is tested alone.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

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

/**
 * A browser sends the page's origin with a WebSocket handshake. A page served by this host has the origin of the address it
 * was fetched from, so its host and port equal the request's `Host` header; a page from anywhere else does not. No Origin at
 * all is a client that is not a browser page (a script, the tests): it still needs the code.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (!host) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false; // includes the literal "null" of a sandboxed or file page
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.host.toLowerCase() === host.toLowerCase();
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
