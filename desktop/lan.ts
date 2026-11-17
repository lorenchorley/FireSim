/**
 * Where the host listens and which addresses it prints (contract 0.8.0 J, 3.2; `--lan6` and `--bind` in 0.9.0). Pure: the network
 * interfaces are passed in.
 */
import { isIPv6 } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';

type Interfaces = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>;

/**
 * The address to listen on: this computer only (127.0.0.1) unless one of the flags says otherwise: `--lan` (every IPv4 interface,
 * 0.0.0.0), `--lan6` (every interface, `::`, which takes IPv4 too where the system allows) or `--bind ADDRESS`.
 */
export function bindAddress(o: { lan?: boolean; lan6?: boolean; bind?: string | null }): string {
  if (o.bind) return o.bind;
  if (o.lan6) return '::';
  return o.lan ? '0.0.0.0' : '127.0.0.1';
}

/** Whether `address` is this computer's own (loopback) and no other device can reach it: 127.x.x.x and ::1. */
export const isLoopback = (address: string): boolean => /^127\./.test(address) || address === '::1';

/** Whether `address` is every interface: 0.0.0.0 and ::. */
export const isWildcard = (address: string): boolean => address === '0.0.0.0' || address === '::';

/** Every non-internal IPv4 address of this computer, by interface name then address (a phone on the same network can use any of them). */
export function lanAddresses(interfaces: Interfaces): string[] {
  const out: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      // `family` is the string 'IPv4' in current Node and was the number 4 in some older ones.
      if (!i.internal && (i.family === 'IPv4' || (i.family as unknown) === 4)) out.push({ name, address: i.address });
    }
  }
  return out.sort((a, b) => (a.name === b.name ? a.address.localeCompare(b.address, 'en', { numeric: true }) : a.name.localeCompare(b.name))).map((x) => x.address);
}

/**
 * Every non-internal IPv6 address that another device can use in an address: not the link-local ones (fe80::/10 need a zone, the name
 * of the interface, which a browser's address cannot carry reliably), by interface name then address.
 */
export function lanAddresses6(interfaces: Interfaces): string[] {
  const out: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      if (!i.internal && (i.family === 'IPv6' || (i.family as unknown) === 6) && !/^fe[89ab]/i.test(i.address)) out.push({ name, address: i.address.toLowerCase() });
    }
  }
  return out.sort((a, b) => (a.name === b.name ? a.address.localeCompare(b.address) : a.name.localeCompare(b.name))).map((x) => x.address);
}

/** An address as it goes in a URL: an IPv6 address in brackets. */
export const urlHost = (address: string): string => (isIPv6(address) ? `[${address}]` : address);

/**
 * The address to open on this computer and, when the host listens beyond it, one per network address, each with the pairing code
 * in the fragment (`http://HOST:PORT/#code=CODE`): every IPv4 address for 0.0.0.0, every IPv4 and IPv6 one for `::`, and the one
 * address for `--bind`.
 */
export function pageUrls(o: { bind: string; port: number; code: string; interfaces: Interfaces }): string[] {
  const hosts = o.bind === '0.0.0.0' ? lanAddresses(o.interfaces) : o.bind === '::' ? [...lanAddresses(o.interfaces), ...lanAddresses6(o.interfaces)] : [o.bind];
  return hosts.map((h) => `http://${urlHost(h)}:${o.port}/#code=${o.code}`);
}
