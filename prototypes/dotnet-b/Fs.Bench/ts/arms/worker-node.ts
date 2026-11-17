/** T1.5: Node `worker_threads` entry of every arm's worker (the code is in worker-core.ts). Built with ../build.mjs. */
import { parentPort } from 'node:worker_threads';
import { installWorker } from './worker-core';

if (!parentPort) throw new Error('worker-node.ts must run in a worker thread');
const port = parentPort;
installWorker({ post: (m) => port.postMessage(m), on: (cb) => port.on('message', cb) });
