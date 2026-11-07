/**
 * Which addresses the host binds to and prints (contract 0.8.0 J, 3.2 and 5): `--lan` address selection is a pure function.
 */
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { bindAddress, lanAddresses, pageUrls } from './lan';

const nic = (address: string, o: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo => ({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/24`, ...o }) as NetworkInterfaceInfo;

const interfaces = {
  lo: [nic('127.0.0.1', { internal: true }), nic('::1', { family: 'IPv6', internal: true })],
  wlan0: [nic('192.168.1.20'), nic('fe80::1', { family: 'IPv6' })],
  eth0: [nic('10.0.0.5'), nic('10.0.0.12')],
  docker0: [nic('172.17.0.1')],
  down: undefined,
  old: [nic('192.168.56.1', { family: 4 as unknown as 'IPv4' })],
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
    const lan = pageUrls({ lan: true, port: 4300, code: 'ABCD2345', interfaces });
    expect(lan).toEqual(['http://172.17.0.1:4300/#code=ABCD2345', 'http://10.0.0.5:4300/#code=ABCD2345', 'http://10.0.0.12:4300/#code=ABCD2345', 'http://192.168.56.1:4300/#code=ABCD2345', 'http://192.168.1.20:4300/#code=ABCD2345']);
    expect(pageUrls({ lan: false, port: 4301, code: 'ABCD2345', interfaces })).toEqual(['http://127.0.0.1:4301/#code=ABCD2345']);
  });

  it('binds to this computer only unless --lan is given', () => {
    expect(bindAddress(false)).toBe('127.0.0.1');
    expect(bindAddress(true)).toBe('0.0.0.0');
  });
});
