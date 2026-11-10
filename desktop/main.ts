/**
 * `npm run desktop`: the command line of the desktop host (contract 0.8.0 J, 3.2; 0.9.0 contract 4.2). `desktop/run.mjs` builds this
 * file and the engine worker with Vite (the repository's own bundler) and calls {@link main}; the flags are in cli.ts and the
 * behaviour in server.ts.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism, hostname, networkInterfaces, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs, UsageError, USAGE } from './cli';
import { workerEngines } from './engine';
import { bindAddress, isLoopback, pageUrls } from './lan';
import { availableMemory, defaultMaxSessionMib, MIB } from './memoryBound';
import { OpenTokens, openUrl } from './openToken';
import { allowedHostNames, APP_ORIGINS, generateCode } from './security';
import { startHost } from './server';

export interface MainEnvironment {
  /** The built app: `dist/` of the repository. */
  distDir: string;
  /** The built engine worker (`engineWorker.mjs`). */
  workerFile: string | URL;
  /** Start the browser with this address (`--open`). Default: the system's own (`xdg-open`, `open` or `cmd /c start`); the tests pass their own. */
  launch?: (url: string) => void;
}

function openInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Could not open a browser (${cmd} is not available). Open the address above yourself.`));
    child.unref();
  } catch {
    console.log('Could not open a browser. Open the address above yourself.');
  }
}

/** Run the host until SIGINT or SIGTERM. Resolves with the exit code: 0 after a clean stop, 1 when it could not start, 2 for a wrong flag or no built app. */
export async function main(argv: readonly string[], env: MainEnvironment): Promise<number> {
  let options;
  try {
    options = parseArgs(argv, { cores: availableParallelism(), hostname: hostname() });
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!existsSync(join(env.distDir, 'index.html'))) {
    console.error(`There is no built app at ${env.distDir} (no index.html).\nBuild it first with:  npm run build\nand then start the host again with:  npm run desktop`);
    return 2;
  }
  const code = options.code ?? generateCode();
  const bind = bindAddress(options);
  const allowedOrigins = [...new Set([...(options.allowApp ? APP_ORIGINS : []), ...options.allowOrigins])];
  const maxSessionMib = options.maxSessionMib ?? defaultMaxSessionMib(availableMemory(totalmem(), process.constrainedMemory?.()), options.maxSessions);
  // `--open` starts the browser with a one-use link, not the code: the code would be in the launcher's arguments, which other users of the computer can read.
  const openTokens = options.open ? new OpenTokens() : undefined;
  let host;
  try {
    host = await startHost({
      distDir: env.distDir,
      port: options.port,
      bind,
      code,
      name: options.name,
      maxSessions: options.maxSessions,
      allowedHosts: allowedHostNames(hostname(), options.allowHosts),
      allowedOrigins,
      ...(openTokens ? { openTokens } : {}),
      maxFrameBytes: options.maxFrameMib * 1024 * 1024,
      engines: workerEngines(env.workerFile, { maxSessionBytes: maxSessionMib * MIB }, { maxOldGenerationSizeMb: options.workerHeapMib }),
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${options.port} is already in use. Pick another with --port N.`
        : err.code === 'EACCES'
          ? `Not allowed to listen on port ${options.port}. Pick another with --port N.`
          : err.code === 'EADDRNOTAVAIL'
            ? `Cannot listen on ${bind}: this computer has no such address. Check --bind.`
            : err.code === 'EAFNOSUPPORT'
              ? `Cannot listen on ${bind}: this computer has no IPv6 (or it is switched off).`
              : `The host could not start: ${err.message}`,
    );
    return 1;
  }
  // The stop is ready before the banner is printed: whoever reads the banner and then interrupts the host must find it listening for the signal.
  const stopped = new Promise<number>((resolve) => {
    let stopping = false;
    const stop = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      console.log(`\n${signal}: stopping.`);
      const hard = setTimeout(() => resolve(0), 5000);
      hard.unref();
      host.close().finally(() => resolve(0));
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  });
  const urls = pageUrls({ bind, port: host.port, code, interfaces: networkInterfaces() });
  const local = isLoopback(bind);
  // The one place the pairing code is printed: in the address, after the #, which a browser never sends to a server (with --lan, in each address).
  console.log(`FireSim desktop host "${options.name}"`);
  console.log(local ? 'Open this on this computer:' : 'Open one of these on this computer or on a phone on the same network:');
  for (const u of urls) console.log(`  ${u}`);
  if (!local && urls.length === 0) console.log('  (no network address found: connect to a network, or leave out --lan)');
  console.log('Pairing code: the part of the address after #code= (the page asks for it when the address has none)');
  if (allowedOrigins.length) console.log(`Apps may connect from: ${allowedOrigins.join(', ')} (the code is still needed; any app with one of these origins can try it).`);
  console.log(`Up to ${options.maxSessions} simulation${options.maxSessions === 1 ? '' : 's'} at once, each of at most about ${maxSessionMib.toLocaleString('en-US')} MiB of memory (--max-session-mib). ${local ? '' : 'There is no TLS: use this only on a network you trust. '}Ctrl+C stops it.`);
  // A V8 flag is for every thread of the process, and it wins over the limit given to a worker.
  if (/max-old-space-size/.test(`${process.env.NODE_OPTIONS ?? ''} ${process.execArgv.join(' ')}`)) {
    console.log(`Note: --max-old-space-size is set for Node itself (NODE_OPTIONS or the command line), and it replaces --worker-heap-mib (${options.workerHeapMib}) for the simulation threads.`);
  }
  if (openTokens) {
    const first = urls[0];
    if (first) {
      console.log('Opening the page in your browser.');
      (env.launch ?? openInBrowser)(openUrl(new URL(first).origin, openTokens.issue()));
    } else console.log('There is no address to open: open the page yourself.');
  }

  return stopped;
}
