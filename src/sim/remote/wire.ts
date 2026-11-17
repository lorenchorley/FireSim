/**
 * What the page and the desktop host both have to know about the link and that is not the codec: the version of the link, the
 * close codes the host ends a connection with, and the one sentence of a refused scenario that the page recognises. No imports (the
 * page and the host share it).
 */

/** The version of the desktop link (the hello, the welcome, `/__firesim/host`): 1 in 0.8.0, 2 since 0.9.0 (less before the code, the welcome carries the host's info). */
export const LINK_PROTOCOL = 2;

/** Close codes of the link (desktop/README.md). 1xxx are the WebSocket's own; 4xxx are the host's, mostly in the spirit of the HTTP status of the same number. */
export const CLOSE = {
  normal: 1000,
  away: 1001,
  policy: 1008,
  failed: 1011,
  /** No good hello in time, or a frame that is not binary after it. */
  badHello: 4400,
  wrongCode: 4401,
  /** The hello was well formed but of another version of the link; the reason says the host's: `protocol 2`. */
  badProtocol: 4426,
  rateLimited: 4429,
  noSession: 4503,
} as const;

/**
 * The engine's error for a scenario that does not fit in the memory the host allows a session (`--max-session-mib`): an ordinary
 * `error` message, so the page's `init` rejects with this exact sentence and the page can word it. The link stays open and the
 * session takes another scenario (a smaller one) afterwards.
 */
export const TOO_BIG_MESSAGE = "This scenario is too big for the desktop's free memory.";
