/**
 * The flags of `npm run desktop` (contract 0.8.0 J, 3.2): `--port N`, `--lan`, `--code XXXXXXXX`, `--max-sessions N`,
 * `--open`, `--name TEXT`, and `--help`. Pure parsing, so it is tested without a process.
 */
import { normaliseCode } from './security';

export interface CliOptions {
  port: number;
  lan: boolean;
  /** Null: a random code. */
  code: string | null;
  maxSessions: number;
  open: boolean;
  name: string;
  help: boolean;
}

export class UsageError extends Error {}

export const DEFAULT_PORT = 4300;

/** At most 4 sessions and always one core left for the host itself and the browser. */
export const defaultMaxSessions = (cores: number): number => Math.max(1, Math.min(4, cores - 1));

export const USAGE = `Usage: npm run desktop [-- flags]

  --port N          port to listen on (default ${DEFAULT_PORT}; 0 picks a free one)
  --lan             listen on every network interface, so a phone on the same network can open the page
                    (default: this computer only, 127.0.0.1)
  --code CODE       pairing code, 8 to 32 letters and digits (default: a random one of 8)
  --max-sessions N  simulations that may run at once (default: cores - 1, at most 4, at least 1)
  --open            open the page in the default browser
  --name TEXT       the name users see (default: this computer's name)
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
  const o: CliOptions = { port: DEFAULT_PORT, lan: false, code: null, maxSessions: defaultMaxSessions(defaults.cores), open: false, name: cleanName(defaults.hostname) || 'FireSim desktop', help: false };
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
      case '--open':
        o.open = true;
        break;
      case '--help':
      case '-h':
        o.help = true;
        break;
      case '--max-sessions':
        o.maxSessions = integer(flag, value(), 1, 256);
        break;
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
  return o;
}
