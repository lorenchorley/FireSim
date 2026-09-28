/**
 * sim/ — orchestrator, coupling loop, worker (spec docs/research/00-synthesis.md §12; protocol §2.3).
 *
 *   Simulation          the coupled model (terrain features, fuel + edits, moisture, fire spread, atmosphere tier,
 *                       embers, insight engine) with the normative §12.2 step order, stats, snapshots, checkpoints
 *                       and rewind; synchronous, runs in the worker or in Node.
 *   SimClient           SimController over the Web Worker (src/sim/worker.ts); in-thread fallback without Worker.
 *   LocalSimController  SimController running the same host in the calling thread.
 *   SimHost             the chunked message loop shared by the worker and LocalSimController.
 */
export { Simulation, type SimulationOptions, type SimulationHooks, type SimulationTestHooks, type SimPerf } from './simulation';
export { SimClient, LocalSimController } from './client';
export { SimHost, snapshotTransferables, type HostPort, type SimHostOptions } from './host';
export { SIM_PARAMS, type SimParams } from './params';
export type { FromWorker, ToWorker, SimController, SimEvents, SimOptionKey } from './protocol';
