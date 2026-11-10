/**
 * The worker thread of one desktop session (contract 0.8.0 J, 3.2): `SimHost` on `parentPort`, the way src/sim/worker.ts
 * runs it on a Web Worker's scope, with codec frames in place of structured clones. Frames from the client are decoded
 * here and the host's messages are encoded here, so a scenario or a snapshot is never copied on the thread that serves the
 * socket. Every frame leaves as one transferred buffer.
 *
 * Flow control: when the link to the client is behind, the main thread says `{ hold: true }` and the next chunk of the run
 * waits (holdGate.ts) until it says `{ hold: false }`. The run only gets slower; the results do not change.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { SimHost } from '../src/sim/host';
import type { FromWorker, ToWorker } from '../src/sim/protocol';
import { CodecError, decodeMessage, encodeMessage } from '../src/sim/remote/codec';
import { TOO_BIG_MESSAGE } from '../src/sim/remote/wire';
import type { EngineWorkerData, HoldMessage, NoteMessage } from './engine';
import { HoldGate } from './holdGate';
import { MIB } from './memoryBound';
import { checkSession } from './sessionEstimate';

const port = parentPort;
if (!port) throw new Error('desktop/engineWorker.ts runs as a worker thread.');
const options = (workerData ?? {}) as EngineWorkerData;

/**
 * Yield to this thread's event loop, then run `fn`, unless the link is behind. An immediate and not the MessageChannel of src/sim/worker.ts: Node
 * takes the messages of a port in one go (up to 1000 in a turn, those a handler posts to its own port included), so a run that continues itself
 * through a channel never lets `parentPort` be read, and a `hold` from the host reaches the worker only when the run is over (measured: 64 MiB of
 * snapshots produced after the host had said hold at 11 MiB). Between two immediates the event loop turns, and a `hold` is read within a chunk (40 ms).
 */
const gate = new HoldGate(() => void setImmediate(() => gate.onWake()));

/** A failure of the engine goes to the client as the engine's own sentence: the first line only (the rest of a stack names this computer's files). */
const forClient = (msg: FromWorker): FromWorker => (msg.type === 'error' ? { type: 'error', message: msg.message.split('\n')[0]! } : msg);

/** A message of the protocol is only for a simulation that exists: until the first `init` everything else would wait in a queue without a limit. */
let initialised = false;
let dropped = false;

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
      msg = decodeMessage(m); // the decoder's own limits: a header of at most 8 MiB, at most 4096 typed arrays
    } catch (e) {
      post({ type: 'error', message: e instanceof CodecError ? `The desktop could not read a message: ${e.message}` : 'The desktop could not read a message.' });
      return;
    }
    if (msg.type === 'ping' || msg.type === 'pong') return;
    if (msg.type === 'init') {
      // A scenario that does not fit in the memory a session may have is refused here, before the simulation is built: an engine error the page
      // can word (its init rejects with the sentence), and the session stays open for a smaller scenario.
      const verdict = checkSession(m.byteLength, msg.scenario, options.maxSessionBytes);
      if (!verdict.ok) {
        port.postMessage({ note: `refused a scenario: about ${Math.round(verdict.estimate / MIB).toLocaleString('en-US')} MiB expected, ${Math.round(verdict.limit / MIB).toLocaleString('en-US')} MiB allowed for a session (--max-session-mib)` } satisfies NoteMessage);
        post({ type: 'error', message: TOO_BIG_MESSAGE });
        return;
      }
      initialised = true;
    } else if (!initialised) {
      // Dropped, and said once (the type is cut to letters so that a client cannot write what it likes into the log).
      if (!dropped) port.postMessage({ note: `dropped a "${msg.type.replace(/[^A-Za-z]/g, '').slice(0, 20)}" message that came before init (until init, only init is taken)` } satisfies NoteMessage);
      dropped = true;
      return;
    }
    host.handle(msg as ToWorker);
  } else if (m && typeof (m as HoldMessage).hold === 'boolean') {
    gate.hold((m as HoldMessage).hold);
  }
});
