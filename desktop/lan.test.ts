/**
 * Where the host listens and which addresses it prints (contract 0.8.0 J, 3.2 and 5; `--lan6` and `--bind` in 0.9.0): the address
 * selection is a pure function.
 */
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { bindAddress, isLoopback, isWildcard, lanAddresses, lanAddresses6, pageUrls, urlHost } from './lan';

const nic = (address: string, o: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo => ({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/24`, ...o }) as NetworkInterfaceInfo;

const interfaces = {
  lo: [nic('127.0.0.1', { internal: true }), nic('::1', { family: 'IPv6', internal: true })],
  wlan0: [nic('192.168.1.20'), nic('fe80::1', { family: 'IPv6' }), nic('FD00::20', { family: 'IPv6' }), nic('2001:db8::7', { family: 'IPv6' })],
  eth0: [nic('10.0.0.5'), nic('10.0.0.12'), nic('fe91::2', { family: 'IPv6' })],
  docker0: [nic('172.17.0.1')],
  down: undefined,
  old: [nic('192.168.56.1', { family: 4 as unknown as 'IPv4' }), nic('fd00:1::9', { family: 6 as unknown as 'IPv6' })],
};

describe('--lan address selection', () => {
  it('lists every non-internal IPv4 address, by interface name then address, and no IPv6 and no loopback', () => {
    expect(lanAddresses(interfaces)).toEqual(['172.17.0.1', '10.0.0.5', '10.0.0.12', '192.168.56.1', '192.168.1.20']);
    expect(lanAddresses(interfaces)).not.toContain('127.0.0.1');
  });

  it('is empty when there is no network', () => {
    expect(lanAddresses({})).toEqual([]);
    expect(lanAddresses({ lo: [nic('127.0.0.1', { internal: true })] })).toEqual([]);
  });

  it('prints one address per LAN address with the code in the fragment, and only this computer without --lan', () => {
    const lan = pageUrls({ bind: '0.0.0.0', port: 4300, code: 'ABCD2345', interfaces });
    expect(lan).toEqual(['http://172.17.0.1:4300/#code=ABCD2345', 'http://10.0.0.5:4300/#code=ABCD2345', 'http://10.0.0.12:4300/#code=ABCD2345', 'http://192.168.56.1:4300/#code=ABCD2345', 'http://192.168.1.20:4300/#code=ABCD2345']);
    expect(pageUrls({ bind: '127.0.0.1', port: 4301, code: 'ABCD2345', interfaces })).toEqual(['http://127.0.0.1:4301/#code=ABCD2345']);
  });

  it('binds to this computer only unless a flag says otherwise: --lan is 0.0.0.0, --lan6 is ::, --bind is the address given', () => {
    expect(bindAddress({})).toBe('127.0.0.1');
    expect(bindAddress({ lan: false, lan6: false, bind: null })).toBe('127.0.0.1');
    expect(bindAddress({ lan: true })).toBe('0.0.0.0');
    expect(bindAddress({ lan6: true })).toBe('::');
    expect(bindAddress({ bind: '::1' })).toBe('::1');
    expect(bindAddress({ bind: '192.168.1.20' })).toBe('192.168.1.20');
  });
});

describe('IPv6', () => {
  it('lists every non-internal IPv6 address another device could use: not loopback, not link-local (fe80::/10 needs a zone), lower case, by interface then address', () => {
    expect(lanAddresses6(interfaces)).toEqual(['fd00:1::9', '2001:db8::7', 'fd00::20']);
    expect(lanAddresses6({})).toEqual([]);
    expect(lanAddresses6({ lo: [nic('::1', { family: 'IPv6', internal: true })] })).toEqual([]);
    for (const a of lanAddresses6({ x: [nic('fe80::1', { family: 'IPv6' }), nic('FEA0::1', { family: 'IPv6' }), nic('febf::1', { family: 'IPv6' })] })) throw new Error(`link-local ${a} listed`);
  });

  it('puts an IPv6 address in brackets in an address, and not an IPv4 address or a name', () => {
    expect(urlHost('::1')).toBe('[::1]');
    expect(urlHost('fd00::5')).toBe('[fd00::5]');
    expect(urlHost('192.168.1.20')).toBe('192.168.1.20');
  });

  it('prints [::1] for --bind ::1, the one address for another --bind, and every IPv4 and IPv6 address for ::', () => {
    expect(pageUrls({ bind: '::1', port: 4300, code: 'ABCD2345', interfaces })).toEqual(['http://[::1]:4300/#code=ABCD2345']);
    expect(pageUrls({ bind: '192.168.1.20', port: 4300, code: 'ABCD2345', interfaces })).toEqual(['http://192.168.1.20:4300/#code=ABCD2345']);
    expect(pageUrls({ bind: 'fd00::20', port: 4300, code: 'ABCD2345', interfaces })).toEqual(['http://[fd00::20]:4300/#code=ABCD2345']);
    const all = pageUrls({ bind: '::', port: 4300, code: 'ABCD2345', interfaces });
    expect(all).toEqual([...lanAddresses(interfaces).map((a) => `http://${a}:4300/#code=ABCD2345`), 'http://[fd00:1::9]:4300/#code=ABCD2345', 'http://[2001:db8::7]:4300/#code=ABCD2345', 'http://[fd00::20]:4300/#code=ABCD2345']);
  });

  it('says which addresses are this computer only (127.x.x.x and ::1) and which are every interface (0.0.0.0 and ::)', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1']) expect(isLoopback(a), a).toBe(true);
    for (const a of ['0.0.0.0', '::', '192.168.1.20', 'fd00::1', '::2', '1127.0.0.1']) expect(isLoopback(a), a).toBe(false);
    for (const a of ['0.0.0.0', '::']) expect(isWildcard(a), a).toBe(true);
    for (const a of ['127.0.0.1', '::1', '192.168.1.20']) expect(isWildcard(a), a).toBe(false);
  });
});
