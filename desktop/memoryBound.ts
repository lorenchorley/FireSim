/**
 * The memory a session may use on the desktop host (0.9.0 contract 4.2, item 3): the default of `--max-session-mib` and the bytes in a
 * MiB. Nothing here imports the simulation (the host's own thread loads this file); the estimate of what one scenario needs is in
 * sessionEstimate.ts, which only the engine's worker thread loads.
 */
export const MIB = 1024 * 1024;

/** The share of the computer's memory that all the sessions together may be estimated to need (the rest is for the system, the browser and the host). */
export const SESSION_MEMORY_SHARE = 0.6;

/** The least a session may be given by default, so that a small computer can still run the small scenarios. */
export const MIN_DEFAULT_SESSION_MIB = 256;

/**
 * The default of `--max-session-mib`: 60% of the computer's memory divided by the simulations that may run at once (`--max-sessions`),
 * in MiB, at least 256. With every slot in use the sessions can then not be estimated to need more than 60% of the memory in all.
 */
export const defaultMaxSessionMib = (totalBytes: number, maxSessions: number): number => Math.max(MIN_DEFAULT_SESSION_MIB, Math.floor((SESSION_MEMORY_SHARE * totalBytes) / MIB / Math.max(1, Math.floor(maxSessions))));
