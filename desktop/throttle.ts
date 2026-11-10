/**
 * A simulated network link between a client and the desktop host, for the throttled-link measurement (0.9.0 contract 4.2, item 6): a TCP proxy
 * on this computer that holds each direction to a rate and adds a delay, so that a real client and the real host can be run against "a slow
 * link" without a network. It is a MODEL of a link on one machine, not Wi-Fi: no loss, no jitter, no shared medium, no congestion control of
 * its own (the two real TCP connections on each side of it do what TCP does on a loopback); a fixed rate, a fixed delay, a fixed queue.
 *
 * Each direction is a pump. A chunk read from the sender is cut into segments; each segment is "sent" when the link is free (rate: its length
 * over the bits per second, one after another), and arrives `oneWayDelayMs` after that. While more than `queueBytes` are on the way the pump stops
 * reading its sender (as a full receive window would), so the sender's own socket buffer fills and, in the host, `ws.bufferedAmount` grows:
 * what the host's flow control watches. Time is read from `now` (default `performance.now`), so the arithmetic is tested without waiting.
 */
import { createConnection, createServer, type Server, type Socket } from 'node:net';

export interface LinkShape {
  /** What the link carries each way, in bits per second (20 Mbit/s is 20_000_000). */
  bitsPerSecond: number;
  /** What the link adds to each way, in ms (a round trip adds twice this). */
  oneWayDelayMs: number;
  /** Bytes that may be on the way in one direction before the pump stops reading its sender (default 256 KiB, a socket buffer's worth). */
  queueBytes?: number;
}

export interface DirectionStats {
  /** Bytes delivered. */
  bytes: number;
  /** The most bytes that were on the way at once. */
  peakQueuedBytes: number;
}

export interface ThrottledLink {
  /** The port to connect the client to (on 127.0.0.1). */
  readonly port: number;
  /** `up` is client to host, `down` is host to client, summed over every connection that went through. */
  readonly stats: { up: DirectionStats; down: DirectionStats };
  close(): Promise<void>;
}

/** A chunk is cut into segments of this size before it is timed, so that a big chunk does not arrive in one piece at the end of its time. */
const SEGMENT_BYTES = 16 * 1024;

interface Sent {
  data: Buffer;
  /** When it arrives (the `now` clock, ms). */
  at: number;
}

/** One direction of a link: what comes in on `from` goes out on `to` as the shape allows. */
export class Pump {
  private readonly queue: Sent[] = [];
  private queued = 0;
  /** When the link has finished sending what it has taken so far (ms). */
  private freeAt = 0;
  private reading = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ending = false;
  readonly stats: DirectionStats;

  constructor(
    private readonly from: Socket,
    private readonly to: Socket,
    private readonly shape: Required<LinkShape>,
    private readonly now: () => number,
    stats: DirectionStats,
  ) {
    this.stats = stats;
    from.on('data', (chunk: Buffer) => this.take(chunk));
    from.on('end', () => {
      this.ending = true;
      this.deliver();
    });
    to.on('drain', () => this.deliver());
  }

  private take(chunk: Buffer): void {
    const t = this.now();
    for (let o = 0; o < chunk.length; o += SEGMENT_BYTES) {
      const data = chunk.subarray(o, Math.min(chunk.length, o + SEGMENT_BYTES));
      this.freeAt = Math.max(this.freeAt, t) + (data.length * 8000) / this.shape.bitsPerSecond;
      this.queue.push({ data, at: this.freeAt + this.shape.oneWayDelayMs });
      this.queued += data.length;
    }
    this.stats.peakQueuedBytes = Math.max(this.stats.peakQueuedBytes, this.queued);
    if (this.reading && this.queued > this.shape.queueBytes) {
      this.reading = false;
      this.from.pause();
    }
    this.arm();
  }

  private arm(): void {
    if (this.timer !== undefined || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.deliver();
    }, Math.max(0, this.queue[0]!.at - this.now()));
  }

  private deliver(): void {
    const t = this.now();
    while (this.queue.length && this.queue[0]!.at <= t && !this.to.destroyed) {
      const s = this.queue.shift()!;
      this.queued -= s.data.length;
      this.stats.bytes += s.data.length;
      if (!this.to.write(s.data)) break; // the real socket on the far side is behind: wait for its drain
    }
    if (!this.reading && this.queued <= this.shape.queueBytes / 2) {
      this.reading = true;
      this.from.resume();
    }
    if (this.queue.length === 0 && this.ending && !this.to.destroyed) this.to.end();
    this.arm();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue.length = 0;
  }
}

/** Listen on a free port of 127.0.0.1 and pass every connection on to `target` through a link of this shape. */
export async function throttledLink(target: { host: string; port: number }, shape: LinkShape, now: () => number = () => performance.now()): Promise<ThrottledLink> {
  const full: Required<LinkShape> = { queueBytes: 256 * 1024, ...shape };
  if (!(full.bitsPerSecond > 0) || !(full.oneWayDelayMs >= 0)) throw new Error('A link needs a rate above 0 and a delay of 0 or more.');
  const stats = { up: { bytes: 0, peakQueuedBytes: 0 }, down: { bytes: 0, peakQueuedBytes: 0 } };
  const live = new Set<Socket>();
  const pumps = new Set<Pump>();
  // Half-open: a side that has finished sending (FIN) still has bytes on the way that must arrive before the far side is told, so a socket is not closed by the end of one direction.
  const server: Server = createServer({ allowHalfOpen: true }, (client) => {
    const host = createConnection({ host: target.host, port: target.port, allowHalfOpen: true });
    live.add(client);
    live.add(host);
    const up = new Pump(client, host, full, now, stats.up);
    const down = new Pump(host, client, full, now, stats.down);
    pumps.add(up);
    pumps.add(down);
    const end = (): void => {
      up.stop();
      down.stop();
      client.destroy();
      host.destroy();
      live.delete(client);
      live.delete(host);
      pumps.delete(up);
      pumps.delete(down);
    };
    for (const s of [client, host]) {
      s.on('error', end);
      s.on('close', end);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const p of pumps) p.stop();
        for (const s of live) s.destroy();
        server.close(() => resolve());
      }),
  };
}
