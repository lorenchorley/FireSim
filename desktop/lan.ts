/**
 * Which addresses the host prints, and binds to (contract 0.8.0 J, 3.2). Pure: the network interfaces are passed in.
 */
import type { NetworkInterfaceInfo } from 'node:os';

/** The host listens on this computer only, unless `--lan` asks for every interface. */
export const bindAddress = (lan: boolean): string => (lan ? '0.0.0.0' : '127.0.0.1');

/** Every non-internal IPv4 address of this computer, by interface name then address (a phone on the same network can use any of them). */
export function lanAddresses(interfaces: Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>): string[] {
  const out: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      // `family` is the string 'IPv4' in current Node and was the number 4 in some older ones.
      if (!i.internal && (i.family === 'IPv4' || (i.family as unknown) === 4)) out.push({ name, address: i.address });
    }
  }
  return out.sort((a, b) => (a.name === b.name ? a.address.localeCompare(b.address, 'en', { numeric: true }) : a.name.localeCompare(b.name))).map((x) => x.address);
}

/** The address to open on this computer and, with `--lan`, one per LAN address, each with the pairing code in the fragment (`http://HOST:PORT/#code=CODE`). */
export function pageUrls(o: { lan: boolean; port: number; code: string; interfaces: Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>> }): string[] {
  const hosts = o.lan ? lanAddresses(o.interfaces) : ['127.0.0.1'];
  return hosts.map((h) => `http://${h}:${o.port}/#code=${o.code}`);
}
