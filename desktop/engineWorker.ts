/**
 * The worker thread of one desktop session (contract 0.8.0 J, 3.2): `SimHost` on `parentPort`, the way src/sim/worker.ts
 * runs it on a Web Worker's scope, with codec frames in place of structured clones. Frames from the client are decoded
 * here and the host's messages are encoded here, so a scenario or a snapshot is never copied on the thread that serves the
 * socket. Every frame leaves as one transferred buffer.
 *
 * Flow control: when the link to the client is behind, the main thread says `{ hold: true }` and the next chunk of the run
 * waits (holdGate.ts) until it says `{ hold: false }`. The run only gets slower; the results do not change.
 */
import { MessageChannel, parentPort, workerData } from 'node:worker_threads';
import { SimHost } from '../src/sim/host';
import type { FromWorker, ToWorker } from '../src/sim/protocol';
import { CodecError, decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import type { EngineWorkerData, HoldMessage } from './engine';
import { HoldGate } from './holdGate';

const port = parentPort;
if (!port) throw new Error('desktop/engineWorker.ts runs as a worker thread.');
const options = (workerData ?? {}) as EngineWorkerData;

/** Yield to this thread's message queue, then run `fn` (like src/sim/worker.ts), unless the link is behind. */
const channel = new MessageChannel();
const gate = new HoldGate(() => channel.port2.postMessage(0));
channel.port1.on('message', () => gate.onWake());
channel.port1.unref();

/** A failure of the engine goes to the client as the engine's own sentence: the first line only (the rest of a stack names this computer's files). */
const forClient = (msg: FromWorker): FromWorker => (msg.type === 'error' ? { type: 'error', message: msg.message.split('\n')[0]! } : msg);

function post(msg: FromWorker): void {
  let bytes: Uint8Array;
  try {
    bytes = encodeMessage(forClient(msg));
  } catch (e) {
    bytes = encodeMessage({ type: 'error', message: e instanceof CodecError ? 'The desktop could not send a message of the simulation.' : 'The desktop could not encode a message of the simulation.' });
  }
  port!.postMessage(bytes, [bytes.buffer as ArrayBuffer]);
}

const host = new SimHost(
  { post: (msg) => post(msg) },
  { schedule: gate.schedule, transfer: true, ...(options.chunkMs !== undefined ? { chunkMs: options.chunkMs } : {}), ...(options.simulation ? { simulation: options.simulation } : {}) },
);

port.on('message', (m: unknown) => {
  if (m instanceof Uint8Array) {
    let msg: ReturnType<typeof decodeMessage>;
    try {
      msg = decodeMessage(m);
    } catch (e) {
      post({ type: 'error', message: e instanceof CodecError ? `The desktop could not read a message: ${e.message}` : 'The desktop could not read a message.' });
      return;
    }
    if (msg.type !== 'ping' && msg.type !== 'pong') host.handle(msg as ToWorker);
  } else if (m && typeof (m as HoldMessage).hold === 'boolean') {
    gate.hold((m as HoldMessage).hold);
  }
});
