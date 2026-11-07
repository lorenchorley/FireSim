/**
 * `npm run desktop`: the command line of the desktop host (contract 0.8.0 J, 3.2). `desktop/run.mjs` builds this file and
 * the engine worker with Vite (the repository's own bundler) and calls {@link main}; the flags are in cli.ts and the
 * behaviour in server.ts.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { parseArgs, UsageError, USAGE } from './cli';
import { workerEngines } from './engine';
import { bindAddress, pageUrls } from './lan';
import { generateCode } from './security';
import { startHost } from './server';

export interface MainEnvironment {
  /** The built app: `dist/` of the repository. */
  distDir: string;
  /** The built engine worker (`engineWorker.mjs`). */
  workerFile: string | URL;
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
  let host;
  try {
    host = await startHost({
      distDir: env.distDir,
      port: options.port,
      bind: bindAddress(options.lan),
      code,
      name: options.name,
      maxSessions: options.maxSessions,
      engines: workerEngines(env.workerFile),
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${options.port} is already in use. Pick another with --port N.`
        : err.code === 'EACCES'
          ? `Not allowed to listen on port ${options.port}. Pick another with --port N.`
          : `The host could not start: ${err.message}`,
    );
    return 1;
  }
  const urls = pageUrls({ lan: options.lan, port: host.port, code, interfaces: networkInterfaces() });
  // The one place the pairing code is printed. It is in the address, after the #, which a browser never sends to a server.
  console.log(`FireSim desktop host "${options.name}"`);
  console.log(options.lan ? 'Open one of these on this computer or on a phone on the same network:' : 'Open this on this computer:');
  for (const u of urls) console.log(`  ${u}`);
  if (options.lan && urls.length === 0) console.log('  (no network address found: connect to a network, or leave out --lan)');
  console.log(`Pairing code: ${code}`);
  console.log(`Up to ${options.maxSessions} simulation${options.maxSessions === 1 ? '' : 's'} at once. ${options.lan ? 'There is no TLS: use this only on a network you trust. ' : ''}Ctrl+C stops it.`);
  if (options.open && urls[0]) openInBrowser(urls[0]);

  return new Promise<number>((resolve) => {
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
}
