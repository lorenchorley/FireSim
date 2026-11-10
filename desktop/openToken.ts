/**
 * The one-use link of `--open` (0.9.0 contract 4.2, item 4). The browser is started with `http://HOST:PORT/__firesim/open?t=TOKEN`
 * and the host answers that request, once, with a redirect to `/#code=CODE`: the pairing code never appears in the launcher's
 * argument list (`ps`). A token is 256 bits from the operating system's random source, valid for 60 seconds and for one use, and the
 * host keeps no more than a few (and only their digests). Time is passed in, so tests need no clock.
 */
import { createHash, randomBytes } from 'node:crypto';

export const OPEN_PATH = '/__firesim/open';
export const OPEN_TOKEN_TTL_MS = 60_000;

export interface OpenTokenOptions {
  /** How long a token may be used after it was made (ms, default 60 000). */
  ttlMs?: number;
  now?: () => number;
  /** The source of a token (tests); default 32 random bytes in hexadecimal. */
  random?: () => string;
  /** The most tokens kept at once (default 8): the oldest go first. */
  capacity?: number;
}

const digest = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export class OpenTokens {
  /** The digest of each token to the time it stops being valid. */
  private readonly live = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly capacity: number;

  constructor(o: OpenTokenOptions = {}) {
    this.ttlMs = o.ttlMs ?? OPEN_TOKEN_TTL_MS;
    this.now = o.now ?? Date.now;
    this.random = o.random ?? (() => randomBytes(32).toString('hex'));
    this.capacity = o.capacity ?? 8;
  }

  /** A new token, valid for the next `ttlMs`. */
  issue(): string {
    this.sweep();
    while (this.live.size >= this.capacity) this.live.delete(this.live.keys().next().value as string);
    const token = this.random();
    this.live.set(digest(token), this.now() + this.ttlMs);
    return token;
  }

  /** True once for a token that was issued, has not been used and has not run out; false for anything else. A token that is tried is spent, in time or not. */
  redeem(token: unknown): boolean {
    if (typeof token !== 'string' || token.length === 0 || token.length > 256) return false;
    const key = digest(token);
    const until = this.live.get(key);
    if (until === undefined) return false;
    this.live.delete(key);
    return until >= this.now();
  }

  /** Tokens that are still valid (not used, not run out). */
  get size(): number {
    this.sweep();
    return this.live.size;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, until] of this.live) if (until < t) this.live.delete(k);
  }
}

/**
 * The address the browser is started with: the page's own address (`base`, like `http://127.0.0.1:4300`, the one the host printed
 * first, so the page has the same origin and the same saved data as one opened by hand) and the path with the token.
 */
export const openUrl = (base: string, token: string): string => `${base.replace(/\/$/, '')}${OPEN_PATH}?t=${token}`;
