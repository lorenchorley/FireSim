/**
 * The flags of `npm run desktop` (contract 0.8.0 J, 3.2; 0.9.0 contract 4.2): `--port N`, `--lan`, `--lan6`, `--bind ADDRESS`,
 * `--code XXXXXXXX`, `--max-sessions N`, `--open`, `--name TEXT`, `--allow-host`, `--allow-origin`, `--allow-app`,
 * `--max-frame-mib`, `--max-session-mib`, `--worker-heap-mib` and `--help`. Pure parsing, so it is tested without a process.
 */
import { isIP } from 'node:net';
import { normaliseCode, normaliseHostName, normaliseOrigin } from './security';

export interface CliOptions {
  port: number;
  /** `--lan`: listen on every IPv4 interface (0.0.0.0). */
  lan: boolean;
  /** `--lan6`: listen on every interface, IPv6 included (`::`; on most computers that takes IPv4 too). */
  lan6: boolean;
  /** `--bind ADDRESS`: listen on this one address (an IPv4 or IPv6 address). Null: not given. */
  bind: string | null;
  /** Null: a random code. */
  code: string | null;
  maxSessions: number;
  open: boolean;
  name: string;
  /** Extra names under which a browser may reach the host (`--allow-host`, repeatable). */
  allowHosts: string[];
  /** Origins of pages that may open the engine link and read `/__firesim/host` besides the host's own page (`--allow-origin`, repeatable; each as `normaliseOrigin` writes it). */
  allowOrigins: string[];
  /** `--allow-app`: the origins of the Android and iOS apps (`https://localhost`, `capacitor://localhost`). */
  allowApp: boolean;
  /** The largest frame a client may send, in MiB (`--max-frame-mib`). */
  maxFrameMib: number;
  /** The most memory one session may be estimated to need, in MiB (`--max-session-mib`). Null: from the computer's memory and `--max-sessions` (memoryBound.ts). */
  maxSessionMib: number | null;
  /** The JavaScript heap of one session's worker thread, in MiB (`--worker-heap-mib`). */
  workerHeapMib: number;
  help: boolean;
}

export class UsageError extends Error {}

export const DEFAULT_PORT = 4300;
export const DEFAULT_MAX_FRAME_MIB = 128;
export const DEFAULT_WORKER_HEAP_MIB = 4096;

/** At most 4 sessions and always one core left for the host itself and the browser. */
export const defaultMaxSessions = (cores: number): number => Math.max(1, Math.min(4, cores - 1));

export const USAGE = `Usage: npm run desktop [-- flags]

  --port N          port to listen on (default ${DEFAULT_PORT}; 0 picks a free one)
  --lan             listen on every network interface (IPv4), so a phone on the same network can open the page
                    (default: this computer only, 127.0.0.1)
  --lan6            the same, and over IPv6 too (listens on ::, which on most computers takes IPv4 as well)
  --bind ADDRESS    listen on this one address only (an IPv4 or IPv6 address, such as 192.168.1.20 or ::1);
                    give one of --lan, --lan6 and --bind
  --code CODE       pairing code, 8 to 32 letters and digits (default: a random one of 8)
  --max-sessions N  simulations that may run at once (default: cores - 1, at most 4, at least 1)
  --open            open the page in the default browser (the address it opens has a one-use link in place of the code)
  --name TEXT       the name users see (default: this computer's name)
  --allow-host NAME a name a browser may use to reach this computer, besides an IP address, localhost, this computer's
                    own name and its .local name (repeat it for more): a request that names the host any other way is
                    refused with 421 (DNS rebinding), so a router's name for this computer needs this
  --allow-origin ORIGIN  a page from this origin (scheme://host[:port], exactly: http, https or capacitor, no path) may
                    connect to the engine and read /__firesim/host, besides the page this host serves (repeat it for
                    more). The pairing code is still needed
  --allow-app       the same for the apps (Android: https://localhost, iOS: capacitor://localhost); any app on a phone with
                    that origin may then try the code, so keep the code to yourself. Add --lan for another device to reach this one
  --max-frame-mib N the largest message a page may send, in MiB (default ${DEFAULT_MAX_FRAME_MIB}; a 6 km scenario is 6.5 MB, a 9 km one at 10 m about 83 MB)
  --max-session-mib N  the most memory one simulation may be expected to need, in MiB: a scenario whose estimate is above it is
                    refused (default: 60% of this computer's memory divided by --max-sessions)
  --worker-heap-mib N  the JavaScript heap of one simulation's worker thread, in MiB (default ${DEFAULT_WORKER_HEAP_MIB})
  --help            this text
`;

function integer(flag: string, v: string | undefined, min: number, max: number): number {
  if (v === undefined || !/^\d+$/.test(v)) throw new UsageError(`${flag} needs a whole number.`);
  const n = Number(v);
  if (n < min || n > max) throw new UsageError(`${flag} must be from ${min} to ${max}.`);
  return n;
}

/** The text users see as the host's name: no control characters, at most 64 characters. */
export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 64);
}

export function parseArgs(argv: readonly string[], defaults: { cores: number; hostname: string }): CliOptions {
  const o: CliOptions = {
    port: DEFAULT_PORT,
    lan: false,
    lan6: false,
    bind: null,
    code: null,
    maxSessions: defaultMaxSessions(defaults.cores),
    open: false,
    name: cleanName(defaults.hostname) || 'FireSim desktop',
    allowHosts: [],
    allowOrigins: [],
    allowApp: false,
    maxFrameMib: DEFAULT_MAX_FRAME_MIB,
    maxSessionMib: null,
    workerHeapMib: DEFAULT_WORKER_HEAP_MIB,
    help: false,
  };
  const args = [...argv];
  while (args.length) {
    const raw = args.shift()!;
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    const value = (): string | undefined => (eq > 0 ? raw.slice(eq + 1) : args.shift());
    switch (flag) {
      case '--port':
        o.port = integer(flag, value(), 0, 65535);
        break;
      case '--lan':
        o.lan = true;
        break;
      case '--lan6':
        o.lan6 = true;
        break;
      case '--bind': {
        const v = value()?.trim().replace(/^\[(.*)\]$/, '$1');
        if (!v || isIP(v) === 0) throw new UsageError('--bind needs an IP address: 127.0.0.1, 0.0.0.0, ::1, :: or the address of one network interface.');
        o.bind = v.toLowerCase();
        break;
      }
      case '--open':
        o.open = true;
        break;
      case '--allow-app':
        o.allowApp = true;
        break;
      case '--help':
      case '-h':
        o.help = true;
        break;
      case '--max-sessions':
        o.maxSessions = integer(flag, value(), 1, 256);
        break;
      case '--max-frame-mib':
        o.maxFrameMib = integer(flag, value(), 1, 1024);
        break;
      case '--max-session-mib':
        o.maxSessionMib = integer(flag, value(), 64, 1_048_576);
        break;
      case '--worker-heap-mib':
        o.workerHeapMib = integer(flag, value(), 64, 1_048_576);
        break;
      case '--allow-host': {
        const name = normaliseHostName(value());
        if (!name) throw new UsageError('--allow-host needs a name of letters, digits, dots and hyphens (no port).');
        o.allowHosts.push(name);
        break;
      }
      case '--allow-origin': {
        const origin = normaliseOrigin(value());
        if (!origin) throw new UsageError('--allow-origin needs an origin written exactly as scheme://host or scheme://host:port, with the scheme http, https or capacitor, for example https://localhost or http://192.168.1.20:4173 (no path, no *).');
        if (!o.allowOrigins.includes(origin)) o.allowOrigins.push(origin);
        break;
      }
      case '--code': {
        const code = normaliseCode(value());
        if (!code) throw new UsageError('--code must be 8 to 32 letters and digits.');
        o.code = code;
        break;
      }
      case '--name': {
        const name = cleanName(value() ?? '');
        if (!name) throw new UsageError('--name needs a text.');
        o.name = name;
        break;
      }
      default:
        throw new UsageError(`Unknown flag ${raw}.`);
    }
  }
  if ([o.lan, o.lan6, o.bind !== null].filter(Boolean).length > 1) throw new UsageError('--lan, --lan6 and --bind each say where to listen: give only one of them.');
  return o;
}
