/**
 * The simulated link of the throttled-link measurement (desktop/throttle.ts): it holds a direction to its rate, adds its delay, keeps the
 * bytes in order and whole, pushes back on a sender that is faster than the link (so the sender's own buffer is what grows), and cleans up.
 * Real sockets on 127.0.0.1, small amounts, so each test takes well under a second.
 */
import { createHash } from 'node:crypto';
import { connect, createConnection, createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { throttledLink, type LinkShape, type ThrottledLink } from './throttle';
import { waitFor } from './testHelpers';

const servers: Server[] = [];
const sockets: Socket[] = [];
const links: ThrottledLink[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  for (const l of links.splice(0)) await l.close();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

async function listen(onConnection: (s: Socket) => void): Promise<number> {
  const server = createServer((s) => {
    sockets.push(s);
    s.on('error', () => undefined);
    onConnection(s);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as { port: number }).port;
}

async function link(targetPort: number, shape: LinkShape): Promise<ThrottledLink> {
  const l = await throttledLink({ host: '127.0.0.1', port: targetPort }, shape);
  links.push(l);
  return l;
}

function client(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => resolve(s));
    sockets.push(s);
    s.on('error', (e) => reject(e));
  });
}

const echo = (s: Socket): void => void s.pipe(s);

describe('a throttled link', () => {
  it('holds a direction to its rate: 400 kB at 16 Mbit/s takes about 0.2 s, not 0 and not much more', async () => {
    let got = 0;
    const port = await listen((s) => s.on('data', (d: Buffer) => (got += d.length)));
    const l = await link(port, { bitsPerSecond: 16_000_000, oneWayDelayMs: 0 });
    const c = await client(l.port);
    const t0 = performance.now();
    c.write(Buffer.alloc(400_000, 1));
    await waitFor(() => got === 400_000, 5000, '400 kB to arrive');
    const took = performance.now() - t0;
    expect(took).toBeGreaterThan(180); // 400 000 B x 8 / 16 000 000 b/s = 200 ms (a first segment goes out at once)
    expect(took).toBeLessThan(900);
  });

  it('adds its delay to each way: a byte that is echoed back takes about two delays', async () => {
    const port = await listen(echo);
    const l = await link(port, { bitsPerSecond: 100_000_000, oneWayDelayMs: 60 });
    const c = await client(l.port);
    const t0 = performance.now();
    c.write('x');
    await new Promise<void>((r) => c.once('data', () => r()));
    const took = performance.now() - t0;
    expect(took).toBeGreaterThanOrEqual(115); // 2 x 60 ms
    expect(took).toBeLessThan(500);
  });

  it('keeps every byte, whole and in order, in both directions', async () => {
    const port = await listen(echo);
    const l = await link(port, { bitsPerSecond: 200_000_000, oneWayDelayMs: 2 });
    const c = await client(l.port);
    const data = Buffer.alloc(3_000_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 8)) & 255;
    const back: Buffer[] = [];
    let n = 0;
    c.on('data', (d: Buffer) => {
      back.push(d);
      n += d.length;
    });
    c.write(data);
    await waitFor(() => n === data.length, 20000, 'the echo');
    expect(createHash('sha256').update(Buffer.concat(back)).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'));
    expect(l.stats.up.bytes).toBe(data.length);
    expect(l.stats.down.bytes).toBe(data.length);
  });

  it('pushes back on a sender that is faster than the link: only the queue is held in the link, the rest waits in the sender', async () => {
    let received = 0;
    const port = await listen((s) => s.on('data', (d: Buffer) => (received += d.length)));
    const l = await link(port, { bitsPerSecond: 8_000_000, oneWayDelayMs: 5, queueBytes: 128 * 1024 });
    const c = await client(l.port);
    const big = Buffer.alloc(16 * 1024 * 1024, 7); // 16 MiB at 1 MB/s would take 16 s
    c.write(big);
    await waitFor(() => received > 500_000, 10000, 'half a megabyte to have arrived');
    // Half a megabyte has gone through, so 15 MiB or so are still in the sender (its Node write queue, the kernel's buffers): the link holds its queue and no more.
    expect(l.stats.up.peakQueuedBytes).toBeLessThanOrEqual(128 * 1024 + 64 * 1024 + 16 * 1024);
    expect(c.writableLength).toBeGreaterThan(1024 * 1024);
    expect(received).toBeLessThan(big.length);
  }, 30000);

  it('keeps the two directions apart: a slow way down does not hold up the way up', async () => {
    const port = await listen((s) => {
      s.write(Buffer.alloc(2_000_000, 3)); // the host sends a lot, down
      s.on('data', () => s.write('ack'));
    });
    const l = await link(port, { bitsPerSecond: 8_000_000, oneWayDelayMs: 10 });
    const c = await client(l.port);
    let down = 0;
    c.on('data', (d: Buffer) => (down += d.length));
    await waitFor(() => down > 100_000, 5000, 'the stream down to start');
    const t0 = performance.now();
    c.write('ping');
    await waitFor(() => down > 0 && l.stats.up.bytes >= 4, 5000, 'the ping to arrive');
    expect(performance.now() - t0).toBeLessThan(400); // while 2 MB (2 s) are still coming down
    expect(down).toBeLessThan(2_000_000);
  }, 20000);

  it('passes a close on: the client ending ends the far side after what was sent, and a host that goes away closes the client', async () => {
    let ended = false;
    let all = 0;
    const port = await listen((s) => {
      s.on('data', (d: Buffer) => (all += d.length));
      s.on('end', () => {
        ended = true;
        s.end();
      });
    });
    const l = await link(port, { bitsPerSecond: 16_000_000, oneWayDelayMs: 5 });
    const c = await client(l.port);
    c.end(Buffer.alloc(100_000, 1));
    await waitFor(() => ended, 5000, 'the far side to see the end');
    expect(all).toBe(100_000); // nothing was lost before the end
    const gone = await listen((s) => s.destroy());
    const l2 = await link(gone, { bitsPerSecond: 1_000_000, oneWayDelayMs: 0 });
    const c2 = await client(l2.port);
    await new Promise<void>((r) => c2.once('close', () => r()));
  });

  it('a host that is not there closes the client and does not crash the process', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as { port: number }).port;
    await new Promise<void>((r) => dead.close(() => r()));
    const l = await link(port, { bitsPerSecond: 1_000_000, oneWayDelayMs: 0 });
    const c = createConnection(l.port, '127.0.0.1');
    sockets.push(c);
    c.on('error', () => undefined);
    await new Promise<void>((r) => c.once('close', () => r()));
  });

  it('stops everything when it is closed, with sockets still open', async () => {
    const port = await listen(echo);
    const l = await throttledLink({ host: '127.0.0.1', port }, { bitsPerSecond: 8_000_000, oneWayDelayMs: 5 });
    const c = await client(l.port);
    c.write(Buffer.alloc(1_000_000));
    await l.close();
    await new Promise<void>((r) => (c.destroyed ? r() : c.once('close', () => r())));
    await expect(client(l.port)).rejects.toBeDefined(); // nothing listens any more
  });

  it('refuses a link with no rate', async () => {
    await expect(throttledLink({ host: '127.0.0.1', port: 1 }, { bitsPerSecond: 0, oneWayDelayMs: 0 })).rejects.toThrow(/rate above 0/);
    await expect(throttledLink({ host: '127.0.0.1', port: 1 }, { bitsPerSecond: 1e6, oneWayDelayMs: -1 })).rejects.toThrow(/delay of 0 or more/);
  });
});
