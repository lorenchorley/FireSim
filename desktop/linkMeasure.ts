/**
 * The throttled-link measurement (0.9.0 contract 4.2, item 6): the REAL host (a process of its own, with its real engine thread) and a client
 * that speaks its protocol, with a simulated link between them (desktop/throttle.ts: a rate and a delay each way), while a real run streams
 * its snapshots. It records what the flow control (the hold at 16 MiB waiting to be sent, the release at 4 MiB) does to the host's memory and
 * to what the page waits for:
 *
 *   - the host's memory: its resident size before the client comes, at the end, and its peak (VmHWM of /proc, so Linux only);
 *   - the time to the first picture: from the scenario being sent to the first snapshot arriving (the scenario's upload, the engine's start, the
 *     first snapshot's download);
 *   - the round trip under load: a ping answered by the host every 250 ms, an explain (the page's "Why here?") every 2 s, and the time from a
 *     Pause to the host's "not running" status arriving: each waits behind the snapshots already queued for the link;
 *   - the throughput of the run, the time it took, how many frames and bytes, the time the client spends decoding a frame (a phone's would be
 *     longer), and what the host logged (the link was behind: the run was held back; a session closed for waiting too long).
 *
 * It is a measurement on one machine with a simulated link: no loss, no jitter, no Wi-Fi, a client that is a Node process and not a phone's browser.
 * Run it with the runner, which builds it and the host first:
 *
 *   node desktop/link.mjs SCENARIO LINK HOLD RUN_S
 *
 * SCENARIO katoomba30 (the Katoomba demo site, 6 km, 30 m cells, fast tier, a fire on the escarpment: 6.5 MB, snapshots of 2.2 MB) or synthetic10
 * (a synthetic 6 km scenario at 10 m cells, fast tier: 30 MB, snapshots of 15 MB, the size the finer detail of 0.9.0 sends).
 * LINK loopback (no link), or MBIT:RTT_MS (20:30 is 20 Mbit/s each way and a round trip of 30 ms, split in half each way).
 * HOLD HIGH:LOW in MiB (16:4 is the host's own pair), or off (the hold is set so high that it never acts).
 * RUN_S how far the run goes, in seconds of fire. Prints one line of JSON.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { withoutContext } from '../src/sim/client';
import { decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import { demoScenario, pointIgnition, syntheticScenario, withIgnitions } from '../src/sim/testing/scenarios';
import { throttledLink } from './throttle';

const MIB = 1024 * 1024;
const here = fileURLToPath(new URL('.', import.meta.url));
const CODE = 'MEASURE1';

const [scenarioArg, linkArg, holdArg, runArg] = process.argv.slice(2);
const runTo = Number(runArg);
const link = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(linkArg ?? '');
const hold = /^(\d+):(\d+)$/.exec(holdArg ?? '');
if (!['katoomba30', 'synthetic10'].includes(scenarioArg ?? '') || (linkArg !== 'loopback' && !link) || (holdArg !== 'off' && !hold) || !(runTo > 0)) {
  console.error('usage: node desktop/link.mjs katoomba30|synthetic10 loopback|MBIT:RTT_MS 16:4|off RUN_S');
  process.exit(2);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const percentile = (xs: number[], p: number): number | null => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]! : null);
const round = (x: number | null, d = 1): number | null => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const mib = (n: number): number => Math.round((n / MIB) * 10) / 10;

/** The resident size of a process now and at its peak (MiB), from /proc (Linux). */
function memoryOf(pid: number): { rss: number; peak: number } {
  const text = readFileSync(`/proc/${pid}/status`, 'utf8');
  const kb = (key: string): number => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0);
  return { rss: kb('VmRSS') / 1024, peak: kb('VmHWM') / 1024 };
}

async function scenarioOf(name: string) {
  if (name === 'synthetic10') return syntheticScenario({ extent: 6000, cellSize: 10, duration: 3600, ignitions: [pointIgnition('a', -1000, 0, 0, 60)], options: { snapshotInterval: 60, tier: 'fast', maxEmbers: 2000, seed: 11 } });
  const base = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: 3600 });
  return withIgnitions(base, [pointIgnition('escarpment', -2170, 900, 0, 60)], { snapshotInterval: 60, tier: 'fast', seed: 11 });
}

// ── the host: a process of its own, started from a small program that sets the pair of numbers the command line does not take ──
const work = mkdtempSync(join(tmpdir(), 'firesim-link-'));
mkdirSync(join(work, 'dist'));
writeFileSync(join(work, 'dist', 'index.html'), '<!doctype html><title>FireSim</title>');
const highMiB = hold ? Number(hold[1]) : 4096;
const lowMiB = hold ? Number(hold[2]) : 2048;
writeFileSync(
  join(work, 'host.mjs'),
  `import { startHost } from ${JSON.stringify(pathToFileURL(join(here, 'server.mjs')).href)};
import { workerEngines } from ${JSON.stringify(pathToFileURL(join(here, 'engine.mjs')).href)};
const h = await startHost({ distDir: ${JSON.stringify(join(work, 'dist'))}, port: 0, bind: '127.0.0.1', code: '${CODE}', name: 'link', maxSessions: 1,
  highWaterBytes: ${highMiB * MIB}, lowWaterBytes: ${lowMiB * MIB}, engines: workerEngines(new URL(${JSON.stringify(pathToFileURL(join(here, 'engineWorker.mjs')).href)}), { simulation: { minSnapshotWallMs: 0 } }) });
console.log('LISTENING ' + h.port);
`,
);
const host = spawn(process.execPath, [join(work, 'host.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
let hostLog = '';
host.stdout.on('data', (d: Buffer) => (hostLog += d));
host.stderr.on('data', (d: Buffer) => (hostLog += d));
const stopHost = (): void => {
  host.kill('SIGKILL');
  rmSync(work, { recursive: true, force: true });
};
for (let i = 0; i < 600 && !/LISTENING \d+/.test(hostLog); i++) await sleep(50);
const hostPort = Number(/LISTENING (\d+)/.exec(hostLog)?.[1]);
if (!hostPort) {
  console.error(`The host did not start:\n${hostLog}`);
  stopHost();
  process.exit(1);
}

const scenario = await scenarioOf(scenarioArg!);
const initFrame = encodeMessage({ type: 'init', scenario: withoutContext(scenario) });
const shape = link ? { bitsPerSecond: Number(link[1]) * 1_000_000, oneWayDelayMs: Number(link[2]) / 2 } : null;
const throttle = shape ? await throttledLink({ host: '127.0.0.1', port: hostPort }, shape) : null;
const clientPort = throttle ? throttle.port : hostPort;

await sleep(700);
const idle = memoryOf(host.pid!);

// ── the client: a raw WebSocket, so that every message and its time are seen ──
/** What the run has seen so far (an object, so that the callbacks that fill it and the loops that read it agree on its types). */
const seen = {
  closeCode: null as number | null,
  tReady: null as number | null,
  tFirstPicture: null as number | null,
  tRunEnd: null as number | null,
  frames: 0,
  bytes: 0,
  snapshots: 0,
  lastSnapshotTime: -1,
  pausedAt: 0,
  resumed: false,
  pauseMs: null as number | null,
  errorMessage: null as string | null,
};
const ws = new WebSocket(`ws://127.0.0.1:${clientPort}/__firesim/engine`, { maxPayload: 512 * MIB });
ws.on('close', (c) => (seen.closeCode = c));
ws.on('error', () => undefined);
await new Promise<void>((resolve, reject) => {
  ws.once('open', () => resolve());
  ws.once('error', reject);
});
const welcome = await new Promise<{ type: string }>((resolve) => {
  ws.once('message', (d: Buffer) => resolve(JSON.parse(d.toString()) as { type: string }));
  ws.send(JSON.stringify({ type: 'hello', protocol: 2, code: CODE }));
});
if (welcome.type !== 'welcome') {
  console.error('no welcome');
  stopHost();
  process.exit(1);
}

const t0 = performance.now();
const decodeMs: number[] = [];
const pongMs: number[] = [];
/** For each ping: when it was sent and how many bytes had reached the client by then, to say how much stood ahead of its answer. */
const pingsSent = new Map<number, { at: number; bytes: number }>();
const aheadMiB: number[] = [];
const timeline: { sentAtS: number; delayS: number; aheadMiB: number }[] = [];
const explainMs: number[] = [];
const pending = new Map<number, number>();
let reqId = 1;
let runStartedAt = 0;

ws.on('message', (d: Buffer, isBinary: boolean) => {
  if (!isBinary) return;
  const now = performance.now();
  seen.frames++;
  seen.bytes += d.length;
  const decodeStart = performance.now();
  const msg = decodeMessage(new Uint8Array(d.buffer, d.byteOffset, d.length));
  decodeMs.push(performance.now() - decodeStart);
  switch (msg.type) {
    case 'ready':
      seen.tReady ??= now;
      break;
    case 'snapshot':
      seen.tFirstPicture ??= now;
      seen.snapshots++;
      seen.lastSnapshotTime = msg.snapshot.time;
      break;
    case 'status':
      if (seen.pausedAt && !seen.resumed && !msg.running) {
        seen.pauseMs = now - seen.pausedAt;
        seen.resumed = true;
        ws.send(encodeMessage({ type: 'run', until: runTo }));
      }
      if (!msg.running && msg.time >= runTo - 1e-6 && seen.lastSnapshotTime >= runTo - 1e-6) seen.tRunEnd ??= now;
      break;
    case 'pong': {
      pongMs.push(now - msg.t);
      const ping = pingsSent.get(msg.t);
      if (ping) {
        pingsSent.delete(msg.t);
        const ahead = (seen.bytes - ping.bytes) / MIB;
        aheadMiB.push(ahead);
        if (pongMs.length % 20 === 1 && timeline.length < 12) timeline.push({ sentAtS: Math.round(((ping.at - t0) / 1000) * 10) / 10, delayS: Math.round(((now - ping.at) / 1000) * 10) / 10, aheadMiB: Math.round(ahead * 10) / 10 });
      }
      break;
    }
    case 'explain': {
      const sent = pending.get(msg.reqId);
      if (sent !== undefined) explainMs.push(now - sent);
      pending.delete(msg.reqId);
      break;
    }
    case 'error':
      seen.errorMessage = msg.message;
      break;
  }
});

// ── what the run does: upload, wait for the first picture, run, probe the link while it streams ──
const peakRss: number[] = [];
const sampler = setInterval(() => peakRss.push(memoryOf(host.pid!).rss), 250);
ws.send(initFrame);
for (let i = 0; i < 2400 && seen.tFirstPicture === null && seen.closeCode === null; i++) await sleep(25);
runStartedAt = performance.now();
ws.send(encodeMessage({ type: 'run', until: runTo }));
const pinger = setInterval(() => {
  if (ws.readyState !== ws.OPEN) return;
  const t = performance.now();
  pingsSent.set(t, { at: t, bytes: seen.bytes });
  ws.send(encodeMessage({ type: 'ping', t }));
}, 250);
const explainer = setInterval(() => {
  if (ws.readyState !== ws.OPEN || seen.tRunEnd !== null) return;
  const id = reqId++;
  pending.set(id, performance.now());
  ws.send(encodeMessage({ type: 'explain', x: 0, y: 0, reqId: id }));
}, 2000);
const pauser = setInterval(() => {
  if (seen.pausedAt || seen.tRunEnd !== null || seen.snapshots < 5 || ws.readyState !== ws.OPEN) return;
  seen.pausedAt = performance.now();
  ws.send(encodeMessage({ type: 'pause' }));
}, 50);
for (let i = 0; i < 12_000 && seen.tRunEnd === null && seen.closeCode === null && seen.errorMessage === null; i++) await sleep(50); // 10 minutes at most
const finished = performance.now();
clearInterval(pinger);
clearInterval(explainer);
clearInterval(pauser);
clearInterval(sampler);
await sleep(300);
const end = memoryOf(host.pid!);
ws.close();
if (throttle) await throttle.close();
stopHost();

const runMs = (seen.tRunEnd ?? finished) - runStartedAt;
console.log(
  JSON.stringify({
    scenario: scenarioArg,
    link: linkArg,
    hold: holdArg,
    runToS: runTo,
    ok: seen.tRunEnd !== null,
    closeCode: seen.closeCode,
    error: seen.errorMessage,
    scenarioMiB: mib(initFrame.byteLength),
    firstPictureMs: seen.tFirstPicture === null ? null : round(seen.tFirstPicture - t0, 0),
    readyMs: seen.tReady === null ? null : round(seen.tReady - t0, 0),
    runMs: round(runMs, 0),
    snapshots: seen.snapshots,
    frames: seen.frames,
    receivedMiB: mib(seen.bytes),
    throughputMiBps: round(seen.bytes / MIB / (runMs / 1000)),
    decodeMsP50: round(percentile(decodeMs, 50), 2),
    decodeMsMax: round(Math.max(0, ...decodeMs), 1),
    pong: { n: pongMs.length, p50: round(percentile(pongMs, 50)), p95: round(percentile(pongMs, 95)), max: round(Math.max(0, ...pongMs)), aheadMiBP50: round(percentile(aheadMiB, 50)), aheadMiBMax: round(Math.max(0, ...aheadMiB)), timeline },
    explain: { n: explainMs.length, p50: round(percentile(explainMs, 50)), max: round(Math.max(0, ...explainMs)) },
    pauseToStatusMs: seen.pauseMs === null ? null : round(seen.pauseMs, 0),
    hostRssMiB: { idle: Math.round(idle.rss), peak: Math.round(end.peak), end: Math.round(end.rss), sampledMax: Math.round(Math.max(0, ...peakRss)) },
    hostLogSlowLink: /slow link/.test(hostLog),
    hostLogClosedForSlowness: /waited to be sent for over/.test(hostLog),
    linkStats: throttle ? { upPeakQueuedKiB: Math.round(throttle.stats.up.peakQueuedBytes / 1024), downPeakQueuedKiB: Math.round(throttle.stats.down.peakQueuedBytes / 1024), downMiB: mib(throttle.stats.down.bytes) } : null,
  }),
);
process.exit(0);
