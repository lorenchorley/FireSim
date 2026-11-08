/**
 * The one-use link of `--open` (0.9.0 contract 4.2, item 4): valid once, for 60 seconds, 256 bits, kept as a digest. Time is passed in.
 */
import { describe, expect, it } from 'vitest';
import { OPEN_PATH, OPEN_TOKEN_TTL_MS, OpenTokens, openUrl } from './openToken';

describe('OpenTokens', () => {
  it('a token is 32 random bytes in hexadecimal, and two are not the same', () => {
    const t = new OpenTokens();
    const a = t.issue();
    const b = t.issue();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('works once: the first use is true and every later use is false', () => {
    const t = new OpenTokens();
    const token = t.issue();
    expect(t.redeem(token)).toBe(true);
    expect(t.redeem(token)).toBe(false);
    expect(t.redeem(token)).toBe(false);
    expect(t.size).toBe(0);
  });

  it('is valid for 60 seconds: at 60 s it still works, a moment after it does not', () => {
    expect(OPEN_TOKEN_TTL_MS).toBe(60_000);
    let now = 1_000_000;
    const t = new OpenTokens({ now: () => now });
    const live = t.issue();
    const late = t.issue();
    now += 60_000;
    expect(t.redeem(live)).toBe(true); // exactly at its time
    now += 1;
    expect(t.redeem(late)).toBe(false); // 60.001 s after it was made
  });

  it('is spent by a try that comes too late, and an expired token is forgotten', () => {
    let now = 0;
    const t = new OpenTokens({ now: () => now });
    const token = t.issue();
    now = 61_000;
    expect(t.size).toBe(0);
    expect(t.redeem(token)).toBe(false);
    now = 0;
    expect(t.redeem(token)).toBe(false);
  });

  it('refuses a token that was never issued, one that is nearly right, and anything that is not text', () => {
    const t = new OpenTokens({ random: () => 'a'.repeat(64) });
    const token = t.issue();
    for (const bad of ['', 'b'.repeat(64), 'a'.repeat(63), `${token}0`, token.toUpperCase(), ` ${token}`, 'x'.repeat(300), null, undefined, 5, {}, [token], true]) expect(t.redeem(bad), String(bad)).toBe(false);
    expect(t.redeem(token)).toBe(true); // the wrong tries did not spend it
  });

  it('keeps only a few tokens: the oldest go first, and only digests are kept', () => {
    const t = new OpenTokens({ capacity: 3 });
    const tokens = [t.issue(), t.issue(), t.issue(), t.issue(), t.issue()];
    expect(t.size).toBe(3);
    expect(tokens.map((x) => t.redeem(x))).toEqual([false, false, true, true, true]);
    const secret = new OpenTokens({ random: () => 'the-token-text' });
    secret.issue();
    expect(JSON.stringify([...(secret as unknown as { live: Map<string, number> }).live.keys()])).not.toContain('the-token-text');
  });

  it('the launcher\'s address is the page\'s own with the path and the token, and has no code in it', () => {
    expect(OPEN_PATH).toBe('/__firesim/open');
    expect(openUrl('http://127.0.0.1:4300', 'abc')).toBe('http://127.0.0.1:4300/__firesim/open?t=abc');
    expect(openUrl('http://[::1]:4300/', 'abc')).toBe('http://[::1]:4300/__firesim/open?t=abc');
    expect(openUrl('http://127.0.0.1:4300', 'abc')).not.toMatch(/code/i);
  });
});
