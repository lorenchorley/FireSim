/**
 * The flags of `npm run desktop` (contract 0.8.0 J, 3.2; 0.9.0 contract 4.2).
 */
import { describe, expect, it } from 'vitest';
import { cleanName, defaultMaxSessions, DEFAULT_PORT, parseArgs, UsageError, USAGE } from './cli';

const defaults = { cores: 8, hostname: 'workstation' };
const base = { port: 4300, lan: false, lan6: false, bind: null, code: null, maxSessions: 4, open: false, name: 'workstation', allowHosts: [], allowOrigins: [], allowApp: false, maxFrameMib: 128, maxSessionMib: null, workerHeapMib: 4096, help: false };

describe('flags', () => {
  it('have the defaults of the contract: port 4300, this computer only, a random code, no browser, the host name, no app origins', () => {
    expect(parseArgs([], defaults)).toEqual(base);
    expect(DEFAULT_PORT).toBe(4300);
  });

  it('read every flag, with the value after it or after an =', () => {
    expect(parseArgs(['--port', '4301', '--lan', '--code', 'abcd2345', '--max-sessions', '2', '--open', '--name', 'Station 3'], defaults)).toEqual({ ...base, port: 4301, lan: true, code: 'ABCD2345', maxSessions: 2, open: true, name: 'Station 3' });
    expect(parseArgs(['--port=0', '--code=ZZZZ2222', '--name=A=B', '--max-sessions=1'], defaults)).toMatchObject({ port: 0, code: 'ZZZZ2222', name: 'A=B', maxSessions: 1 });
    expect(parseArgs(['--help'], defaults).help).toBe(true);
    expect(parseArgs(['-h'], defaults).help).toBe(true);
  });

  it('read --allow-host (repeatable, any case, with an = too), --max-frame-mib and --worker-heap-mib', () => {
    expect(parseArgs(['--allow-host', 'Station.LAN', '--allow-host=desk.example.org', '--max-frame-mib', '256', '--worker-heap-mib=2048'], defaults)).toMatchObject({ allowHosts: ['station.lan', 'desk.example.org'], maxFrameMib: 256, workerHeapMib: 2048 });
    expect(parseArgs(['--allow-host', 'a'], defaults).allowHosts).toEqual(['a']);
  });

  it('read --allow-origin (repeatable, written as a browser writes it, a repeat once) and --allow-app', () => {
    expect(parseArgs(['--allow-origin', 'https://localhost', '--allow-origin=HTTP://192.168.1.50:4173', '--allow-origin', 'https://localhost:443', '--allow-origin', 'http://[::1]:4173'], defaults).allowOrigins).toEqual(['https://localhost', 'http://192.168.1.50:4173', 'http://[::1]:4173']);
    const app = parseArgs(['--allow-app'], defaults);
    expect(app.allowApp).toBe(true);
    expect(app.allowOrigins).toEqual([]); // the shorthand is joined to the list where the host starts (main.ts)
    expect(parseArgs([], defaults).allowApp).toBe(false);
  });

  it('read --lan6 and --bind (an IPv4 or an IPv6 address, brackets allowed, any case), and --max-session-mib', () => {
    expect(parseArgs(['--lan6'], defaults)).toMatchObject({ lan6: true, lan: false, bind: null });
    expect(parseArgs(['--bind', '192.168.1.20'], defaults).bind).toBe('192.168.1.20');
    expect(parseArgs(['--bind=::1'], defaults).bind).toBe('::1');
    expect(parseArgs(['--bind', '::'], defaults).bind).toBe('::');
    expect(parseArgs(['--bind', '[FD00::5]'], defaults).bind).toBe('fd00::5');
    expect(parseArgs(['--bind', '0.0.0.0'], defaults).bind).toBe('0.0.0.0');
    expect(parseArgs(['--max-session-mib', '2048'], defaults).maxSessionMib).toBe(2048);
    expect(parseArgs(['--max-session-mib=64'], defaults).maxSessionMib).toBe(64);
  });

  it('default the sessions to cores minus one, at most 4, at least 1', () => {
    expect([1, 2, 3, 4, 5, 8, 64].map(defaultMaxSessions)).toEqual([1, 1, 2, 3, 4, 4, 4]);
    expect(parseArgs([], { cores: 2, hostname: 'x' }).maxSessions).toBe(1);
  });

  it('refuse what is wrong with a sentence, never a crash', () => {
    const bad: string[][] = [
      ['--port'], ['--port', 'abc'], ['--port', '-1'], ['--port', '65536'], ['--port', '1.5'],
      ['--max-sessions', '0'], ['--max-sessions', '257'],
      ['--code'], ['--code', 'short'], ['--code', 'has space!'],
      ['--allow-host'], ['--allow-host', 'a:4300'], ['--allow-host', 'a b'], ['--allow-host', ''],
      ['--max-frame-mib', '0'], ['--max-frame-mib', '1025'], ['--max-frame-mib', 'x'],
      ['--max-session-mib', '63'], ['--max-session-mib', 'x'], ['--max-session-mib'], ['--max-session-mib', '1048577'],
      ['--worker-heap-mib', '63'], ['--worker-heap-mib'],
      ['--allow-origin'], ['--allow-origin', ''], ['--allow-origin', '*'], ['--allow-origin', 'null'], ['--allow-origin', 'localhost'], ['--allow-origin', 'https://localhost/'], ['--allow-origin', 'https://localhost/app'], ['--allow-origin', 'https://user:pw@localhost'], ['--allow-origin', 'ftp://localhost'], ['--allow-origin', 'file://'], ['--allow-origin', 'https://*.example'],
      ['--bind'], ['--bind', ''], ['--bind', 'localhost'], ['--bind', 'desk.example'], ['--bind', '192.168.1'], ['--bind', '999.1.1.1'], ['--bind', '[::1'],
      ['--lan', '--lan6'], ['--lan', '--bind', '127.0.0.1'], ['--lan6', '--bind', '::1'], ['--bind', '::1', '--bind', '127.0.0.1', '--lan'],
      ['--name'], ['--name', ' '], ['--wat'], ['port', '1'],
    ];
    for (const argv of bad) {
      expect(() => parseArgs(argv, defaults), argv.join(' ')).toThrow(UsageError);
    }
  });

  it('says in its sentence what the flag wants (an origin is exactly scheme://host[:port]; one place to listen)', () => {
    expect(() => parseArgs(['--allow-origin', 'https://localhost/'], defaults)).toThrow(/scheme:\/\/host.*http, https or capacitor.*no path/);
    expect(() => parseArgs(['--lan', '--bind', '::1'], defaults)).toThrow(/--lan, --lan6 and --bind each say where to listen: give only one/);
    expect(() => parseArgs(['--bind', 'desk'], defaults)).toThrow(/needs an IP address/);
  });

  it('keep the name to plain text of at most 64 characters, and take the host name when it is empty', () => {
    expect(cleanName('Station\u0007\n3  ')).toBe('Station  3');
    expect(cleanName('x'.repeat(100))).toHaveLength(64);
    expect(parseArgs([], { cores: 4, hostname: '' }).name).toBe('FireSim desktop');
  });

  it('list every flag in the usage text', () => {
    for (const flag of ['--port', '--lan', '--lan6', '--bind', '--code', '--max-sessions', '--open', '--name', '--allow-host', '--allow-origin', '--allow-app', '--max-frame-mib', '--max-session-mib', '--worker-heap-mib', '--help']) expect(USAGE, flag).toContain(flag);
  });
});
