/**
 * The pairing code, its comparison, the limit on wrong ones and the origin check of the desktop host (contract 0.8.0 J, 3.2 and 5).
 */
import { describe, expect, it, vi } from 'vitest';

const timing = vi.hoisted(() => ({ calls: [] as [number, number][] }));
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView): boolean => {
      timing.calls.push([a.byteLength, b.byteLength]);
      return real.timingSafeEqual(a, b);
    },
  };
});

import { addressKey, CODE_ALPHABET, CODE_LENGTH, codesMatch, generateCode, normaliseCode, originAllowed, RateLimiter } from './security';

describe('pairing code', () => {
  it('is 8 characters of the alphabet without I, O, 0 and 1, from the random source', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(CODE_ALPHABET).toHaveLength(32);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(2000); // 32^8 codes: a repeat in 2000 would mean the source is not random
    expect(CODE_LENGTH).toBe(8);
  });

  it('takes each character from the picker, over the whole alphabet', () => {
    const asked: number[] = [];
    let i = 0;
    const code = generateCode((max) => {
      asked.push(max);
      return i++ * 4;
    });
    expect(asked).toEqual(Array(8).fill(32));
    expect(code).toBe([0, 4, 8, 12, 16, 20, 24, 28].map((k) => CODE_ALPHABET[k]).join(''));
  });

  it('is accepted as typed, in capitals or not, and refused when it cannot be a code', () => {
    expect(normaliseCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normaliseCode('A'.repeat(32))).toBe('A'.repeat(32));
    for (const bad of ['', 'ABC', 'A'.repeat(33), 'ABCD 2345', 'ABCD-2345', 'ABCD234é', 5, null, undefined, {}, ['ABCD2345']]) expect(normaliseCode(bad), String(bad)).toBeNull();
  });
});

describe('codesMatch', () => {
  it('says yes to the code (as typed in either case) and no to everything else', () => {
    expect(codesMatch('ABCD2345', 'ABCD2345')).toBe(true);
    expect(codesMatch('abcd2345', 'ABCD2345')).toBe(true);
    for (const bad of ['ABCD2346', 'ABCD234', 'ABCD23456', '', 'ZZZZZZZZ', 'ABCD2345 ' + 'x', 5, null, undefined, ['ABCD2345']]) expect(codesMatch(bad, 'ABCD2345'), String(bad)).toBe(false);
  });

  it('compares in constant time: always timingSafeEqual on two digests of the same length, whatever was given', () => {
    timing.calls.length = 0;
    codesMatch('ABCD2345', 'ABCD2345');
    codesMatch('A', 'ABCD2345');
    codesMatch('A'.repeat(32), 'ABCD2345');
    codesMatch('not a code at all', 'ABCD2345');
    codesMatch(undefined, 'ABCD2345');
    expect(timing.calls).toHaveLength(5);
    for (const [a, b] of timing.calls) {
      expect(a).toBe(32);
      expect(b).toBe(32);
    }
  });
});

describe('origin check', () => {
  const host = '192.168.1.20:4300';
  it('accepts a page served by this host and a client with no Origin', () => {
    expect(originAllowed('http://192.168.1.20:4300', host)).toBe(true);
    expect(originAllowed('http://LOCALHOST:4300', 'localhost:4300')).toBe(true);
    expect(originAllowed('http://[::1]:4300', '[::1]:4300')).toBe(true);
    expect(originAllowed('https://desktop.local', 'desktop.local')).toBe(true); // default port: neither side names it
    expect(originAllowed(undefined, host)).toBe(true);
    expect(originAllowed(undefined, undefined)).toBe(true);
  });

  it('refuses a page from another host, another port, a file, a sandbox or nothing readable', () => {
    for (const origin of ['http://evil.example', 'http://192.168.1.20:4301', 'http://192.168.1.20', 'http://192.168.1.21:4300', 'null', 'file://', '', 'not a url', 'chrome-extension://abcdef', 'ws://192.168.1.20:4300', 'http://192.168.1.20:4300.evil.example', 'http://evil.example/192.168.1.20:4300']) {
      expect(originAllowed(origin, host), origin).toBe(false);
    }
    expect(originAllowed('http://192.168.1.20:4300', undefined)).toBe(false);
    expect(originAllowed('http://192.168.1.20:4300', '')).toBe(false);
  });
});

describe('addressKey', () => {
  it('counts an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(addressKey('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(addressKey('::FFFF:10.0.0.1')).toBe('10.0.0.1');
    expect(addressKey('fe80::1')).toBe('fe80::1');
    expect(addressKey(undefined)).toBe('unknown');
  });
});

describe('rate limit on wrong codes', () => {
  it('refuses an address for 60 s after its 5th wrong code, and only that address', () => {
    const r = new RateLimiter();
    for (let i = 1; i <= 4; i++) {
      expect(r.recordFailure('a', 1000 * i), `failure ${i}`).toBe(false);
      expect(r.isBlocked('a', 1000 * i)).toBe(false);
    }
    expect(r.recordFailure('a', 5000)).toBe(true);
    expect(r.isBlocked('a', 5000)).toBe(true);
    expect(r.isBlocked('a', 64_999)).toBe(true);
    expect(r.isBlocked('a', 65_000)).toBe(false);
    expect(r.isBlocked('b', 5000)).toBe(false);
  });

  it('starts counting again after the time is up', () => {
    const r = new RateLimiter();
    for (let i = 0; i < 5; i++) r.recordFailure('a', 0);
    expect(r.isBlocked('a', 59_999)).toBe(true);
    expect(r.recordFailure('a', 61_000)).toBe(false); // the first of a new count
    for (let i = 0; i < 3; i++) expect(r.recordFailure('a', 61_000)).toBe(false);
    expect(r.recordFailure('a', 61_000)).toBe(true);
  });

  it('a right code clears the count, but not a refusal already made', () => {
    const r = new RateLimiter();
    for (let i = 0; i < 4; i++) r.recordFailure('a', 0);
    r.recordSuccess('a', 0);
    for (let i = 0; i < 4; i++) expect(r.recordFailure('a', 1)).toBe(false);
    expect(r.recordFailure('a', 1)).toBe(true);
    r.recordSuccess('a', 2);
    expect(r.isBlocked('a', 2)).toBe(true);
  });

  it('forgets old wrong codes, and cannot be grown without bound by a flood of addresses', () => {
    const r = new RateLimiter({ capacity: 50 });
    for (let i = 0; i < 4; i++) r.recordFailure('a', 0);
    expect(r.recordFailure('a', 700_000)).toBe(false); // ten minutes on: that was the first of a new count
    for (let i = 0; i < 10_000; i++) r.recordFailure(`10.0.${i >> 8}.${i & 255}`, 1000 + i);
    expect(r.size).toBeLessThanOrEqual(50);
  });
});
