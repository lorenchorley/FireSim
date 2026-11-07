/**
 * The flags of `npm run desktop` (contract 0.8.0 J, 3.2).
 */
import { describe, expect, it } from 'vitest';
import { cleanName, defaultMaxSessions, DEFAULT_PORT, parseArgs, UsageError } from './cli';

const defaults = { cores: 8, hostname: 'workstation' };

describe('flags', () => {
  it('have the defaults of the contract: port 4300, this computer only, a random code, no browser, the host name', () => {
    expect(parseArgs([], defaults)).toEqual({ port: 4300, lan: false, code: null, maxSessions: 4, open: false, name: 'workstation', help: false });
    expect(DEFAULT_PORT).toBe(4300);
  });

  it('read every flag, with the value after it or after an =', () => {
    expect(parseArgs(['--port', '4301', '--lan', '--code', 'abcd2345', '--max-sessions', '2', '--open', '--name', 'Station 3'], defaults)).toEqual({ port: 4301, lan: true, code: 'ABCD2345', maxSessions: 2, open: true, name: 'Station 3', help: false });
    expect(parseArgs(['--port=0', '--code=ZZZZ2222', '--name=A=B', '--max-sessions=1'], defaults)).toMatchObject({ port: 0, code: 'ZZZZ2222', name: 'A=B', maxSessions: 1 });
    expect(parseArgs(['--help'], defaults).help).toBe(true);
    expect(parseArgs(['-h'], defaults).help).toBe(true);
  });

  it('default the sessions to cores minus one, at most 4, at least 1', () => {
    expect([1, 2, 3, 4, 5, 8, 64].map(defaultMaxSessions)).toEqual([1, 1, 2, 3, 4, 4, 4]);
    expect(parseArgs([], { cores: 2, hostname: 'x' }).maxSessions).toBe(1);
  });

  it('refuse what is wrong with a sentence, never a crash', () => {
    const bad: string[][] = [['--port'], ['--port', 'abc'], ['--port', '-1'], ['--port', '65536'], ['--port', '1.5'], ['--max-sessions', '0'], ['--max-sessions', '257'], ['--code'], ['--code', 'short'], ['--code', 'has space!'], ['--name'], ['--name', ' '], ['--wat'], ['port', '1']];
    for (const argv of bad) {
      expect(() => parseArgs(argv, defaults), argv.join(' ')).toThrow(UsageError);
    }
  });

  it('keep the name to plain text of at most 64 characters, and take the host name when it is empty', () => {
    expect(cleanName('Station\u0007\n3  ')).toBe('Station  3');
    expect(cleanName('x'.repeat(100))).toHaveLength(64);
    expect(parseArgs([], { cores: 4, hostname: '' }).name).toBe('FireSim desktop');
  });
});
