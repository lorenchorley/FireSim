import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADDRESS_PREF, DEFAULT_PORT, loadAddress, parseDesktopAddress, saveAddress, type AddressProblem } from './desktopAddress';
import { getPref, setPref } from './prefs';

const base = (text: string): string | AddressProblem => {
  const r = parseDesktopAddress(text);
  return r.ok ? r.base : r.problem;
};

describe('parseDesktopAddress: what the person may type', () => {
  it('an IPv4 address, with and without a port: the default port is 4300', () => {
    expect(DEFAULT_PORT).toBe(4300);
    expect(base('192.168.1.20')).toBe('http://192.168.1.20:4300');
    expect(base('192.168.1.20:4300')).toBe('http://192.168.1.20:4300');
    expect(base('192.168.1.20:8080')).toBe('http://192.168.1.20:8080');
    expect(base('10.0.0.1')).toBe('http://10.0.0.1:4300');
    expect(base('  192.168.1.20  ')).toBe('http://192.168.1.20:4300'); // a pasted address has spaces around it
  });

  it('a name, with and without a port, in any case', () => {
    expect(base('desk')).toBe('http://desk:4300');
    expect(base('Desk.Local')).toBe('http://desk.local:4300');
    expect(base('studio-pc.lan:4301')).toBe('http://studio-pc.lan:4301');
    expect(base('localhost')).toBe('http://localhost:4300');
  });

  it('http:// and https:// are let through, with one trailing slash; the default port is 4300 for both', () => {
    expect(base('http://192.168.1.20')).toBe('http://192.168.1.20:4300');
    expect(base('http://192.168.1.20:4300/')).toBe('http://192.168.1.20:4300');
    expect(base('HTTP://Desk.local:4300')).toBe('http://desk.local:4300');
    expect(base('https://desk.example.com')).toBe('https://desk.example.com:4300');
    expect(base('https://desk.example.com:8443/')).toBe('https://desk.example.com:8443');
  });

  it('a bracketed IPv6 address, with and without a port', () => {
    expect(base('[fe80::1]')).toBe('http://[fe80::1]:4300');
    expect(base('[::1]:4300')).toBe('http://[::1]:4300');
    expect(base('http://[2001:DB8::7]:4310/')).toBe('http://[2001:db8::7]:4310');
    expect(base('[::ffff:192.168.1.20]')).toBe('http://[::ffff:192.168.1.20]:4300');
  });

  it('says where it connects, as host:port', () => {
    const r = parseDesktopAddress('Desk.local');
    expect(r).toMatchObject({ ok: true, host: 'desk.local', port: 4300, scheme: 'http', shown: 'desk.local:4300' });
  });
});

describe('parseDesktopAddress: what it refuses, and why', () => {
  it('nothing typed', () => {
    expect(base('')).toBe('empty');
    expect(base('   ')).toBe('empty');
  });

  it('a path, a query or a fragment', () => {
    expect(base('192.168.1.20/app')).toBe('path');
    expect(base('http://192.168.1.20:4300/__firesim/host')).toBe('path');
    expect(base('http://192.168.1.20:4300//')).toBe('path');
    expect(base('192.168.1.20:4300?x=1')).toBe('path');
    expect(base('192.168.1.20#code=ABCD2345')).toBe('path'); // the code never rides in the address
    expect(base('[::1]/x')).toBe('path');
  });

  it('credentials', () => {
    expect(base('user:pass@192.168.1.20')).toBe('credentials');
    expect(base('http://user@192.168.1.20:4300')).toBe('credentials');
    expect(base('http://192.168.1.20@evil.example')).toBe('credentials');
    expect(base('desk@evil.example/x')).toBe('credentials');
  });

  it('a scheme that is not http or https', () => {
    for (const s of ['ws', 'wss', 'ftp', 'file', 'javascript', 'data', 'capacitor']) expect(base(`${s}://192.168.1.20:4300`), s).toBe('scheme');
  });

  it('a port that is not one', () => {
    for (const p of ['0', '65536', '99999', '-1', 'abc', '', '43 00', '4300.5', '١٢٣']) expect(base(`192.168.1.20:${p}`), `port "${p}"`).toBe(p.includes(' ') ? 'host' : 'port');
    expect(base('desk:70000')).toBe('port');
    expect(base('[::1]:0')).toBe('port');
    expect(base('[::1]:x')).toBe('port');
    expect(base('65535'.padStart(1) + '.1.1.1')).toBe('host'); // not a dotted quad
  });

  it('a host that is not a computer\'s address', () => {
    for (const h of ['300.1.1.1', '1.2.3', '1.2.3.4.5', '192.168.001.20', '-bad.example', 'bad-.example', 'under_score', 'a..b', '.desk', 'desk.', 'sp ace', 'münchen.example', 'http://', '[::1', '[not-an-address]', '[1:2]', '[fe80::1%en0]', '[::1]x', ':4300']) {
      expect(base(h), h).toBe('host');
    }
  });

  it('an IPv6 address without its brackets (it cannot be told from a host and a port)', () => {
    expect(base('fe80::1')).toBe('ipv6');
    expect(base('::1')).toBe('ipv6');
    expect(base('2001:db8::7:4300')).toBe('ipv6');
  });

  it('never throws, whatever is typed', () => {
    for (const t of ['\u0000', '%00', '////', '[', ']', '[]', '@', ':', '::', 'http:', 'http:/x', 'a'.repeat(300), `${'a.'.repeat(130)}com`, '‮192.168.1.20', 'http://http://x', '🙂']) {
      expect(() => parseDesktopAddress(t), t).not.toThrow();
      expect(parseDesktopAddress(t).ok, t).toBe(false);
    }
  });

  it('a name of 253 characters is the longest; each label at most 63', () => {
    const label = 'a'.repeat(63);
    expect(base(`${label}.${label}.${label}.${'a'.repeat(61)}`)).toBe(`http://${label}.${label}.${label}.${'a'.repeat(61)}:4300`); // 253
    expect(base(`${label}.${label}.${label}.${'a'.repeat(62)}`)).toBe('host'); // 254
    expect(base(`${'a'.repeat(64)}.example`)).toBe('host');
  });
});

describe('the address is remembered, and nothing else', () => {
  it('saves a good address and loads it back; a bad one is not saved', async () => {
    await setPref(ADDRESS_PREF, null);
    expect(await loadAddress()).toBe('');
    await saveAddress('  192.168.1.20  ');
    expect(await getPref(ADDRESS_PREF, '')).toBe('192.168.1.20');
    expect(await loadAddress()).toBe('192.168.1.20');
    await saveAddress('http://user:pw@192.168.1.20'); // refused: nothing changes
    await saveAddress('');
    expect(await loadAddress()).toBe('192.168.1.20');
    await saveAddress('desk.local:4301');
    expect(await loadAddress()).toBe('desk.local:4301');
  });

  it('a saved value that is no longer an address is not offered', async () => {
    await setPref(ADDRESS_PREF, 'ws://x');
    expect(await loadAddress()).toBe('');
    await setPref(ADDRESS_PREF, 12);
    expect(await loadAddress()).toBe('');
    await setPref(ADDRESS_PREF, null);
  });

  it('this file has no code to store: it never mentions the pairing code', () => {
    const src = readFileSync(new URL('./desktopAddress.ts', import.meta.url), 'utf8');
    const stores = src.split('\n').filter((l) => /setPref|getPref/.test(l));
    expect(stores.join('\n')).not.toMatch(/code/i);
    expect(ADDRESS_PREF).toBe('desktopAddress');
  });
});
