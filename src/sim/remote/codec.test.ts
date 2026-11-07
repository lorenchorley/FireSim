/**
 * The wire codec of the desktop host (contract 0.8.0 J, 3.3 and 5): a round trip of every array kind, of views, empty
 * arrays, the numbers JSON cannot carry, nested and repeated arrays, of a real snapshot and a real scenario; what it
 * refuses; and a decoder that meets damaged and hostile frames with an error and never a hang.
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioData, SimSnapshot } from '../../core/types';
import { withoutContext } from '../client';
import type { FromWorker, ToWorker } from '../protocol';
import { Simulation } from '../simulation';
import { difference } from '../testing/compare';
import { demoScenario, pointIgnition, syntheticScenario } from '../testing/scenarios';
import { CodecError, decodeMessage, decodeValue, encodeMessage, encodeValue } from './codec';

const isView = (v: unknown): v is ArrayBufferView => ArrayBuffer.isView(v);
const bytesOf = (v: ArrayBufferView): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

function everyArray(v: unknown, f: (a: ArrayBufferView, path: string) => void, path = ''): void {
  if (isView(v)) return f(v, path);
  if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) everyArray(x, f, `${path}.${k}`);
}

const roundTrip = (v: unknown): unknown => decodeValue(encodeValue(v));

describe('codec round trip', () => {
  it('carries every array kind, including the extremes and the bit patterns of NaN', () => {
    const f32 = new Float32Array([0, -0, 1.5, NaN, Infinity, -Infinity, 3.4028234663852886e38, 1e-45]);
    const nanBits = new Uint32Array([0x7fc00001, 0xffc12345, 0x7f800001]);
    const msg = {
      f32,
      nan: new Float32Array(nanBits.buffer),
      f64: new Float64Array([Math.PI, -0, NaN, Number.MAX_VALUE, Number.MIN_VALUE]),
      i8: new Int8Array([-128, 0, 127]),
      u8: new Uint8Array([0, 1, 255]),
      u8c: new Uint8ClampedArray([0, 128, 255]),
      i16: new Int16Array([-32768, 0, 32767]),
      u16: new Uint16Array([0, 65535]),
      i32: new Int32Array([-2147483648, 2147483647]),
      u32: new Uint32Array([0, 4294967295]),
      i64: new BigInt64Array([-(2n ** 63n), 2n ** 63n - 1n]),
      u64: new BigUint64Array([0n, 2n ** 64n - 1n]),
    };
    const back = roundTrip(msg) as typeof msg;
    expect(difference(back, msg)).toBeNull();
    for (const k of Object.keys(msg) as (keyof typeof msg)[]) {
      expect(back[k].constructor, k).toBe(msg[k].constructor);
      expect(Array.from(bytesOf(back[k])), k).toEqual(Array.from(bytesOf(msg[k])));
    }
    expect(new Uint32Array(back.nan.buffer)[1]).toBe(0xffc12345);
  });

  it('encodes a view by its own elements only (a subarray, an offset into a bigger buffer, a shared buffer)', () => {
    const big = new Float32Array(100).map((_, i) => i);
    const sub = big.subarray(10, 14);
    const odd = new Uint8Array(new ArrayBuffer(64), 8, 5).fill(7);
    const shared = new Int32Array(new SharedArrayBuffer(32), 8, 3);
    shared.set([5, 6, 7]);
    const back = roundTrip({ sub, odd, shared }) as { sub: Float32Array; odd: Uint8Array; shared: Int32Array };
    expect(Array.from(back.sub)).toEqual([10, 11, 12, 13]);
    expect(Array.from(back.odd)).toEqual([7, 7, 7, 7, 7]);
    expect(Array.from(back.shared)).toEqual([5, 6, 7]);
    for (const a of [back.sub, back.odd, back.shared]) {
      expect(a.byteOffset).toBe(0);
      expect(a.buffer.byteLength).toBe(a.byteLength);
      expect(a.buffer).toBeInstanceOf(ArrayBuffer);
    }
    // The frame holds those elements and not the 400 bytes behind the subarray.
    expect(encodeValue({ sub }).byteLength).toBeLessThan(200);
  });

  it('carries empty arrays (alone, first, last and between others)', () => {
    const v = { a: new Float32Array(0), b: new Uint8Array([1, 2, 3]), c: new BigInt64Array(0), d: new Float64Array([4]), e: new Int16Array(0) };
    const back = roundTrip(v) as typeof v;
    expect(difference(back, v)).toBeNull();
    expect(back.a.length).toBe(0);
    expect(back.e.length).toBe(0);
  });

  it('carries NaN, the infinities and negative zero as numbers (alone and among others), and leaves undefined object fields out', () => {
    const v = { a: NaN, b: Infinity, c: -Infinity, d: -0, e: 0, f: [NaN, 1, -Infinity, -0], g: { h: -0 }, skip: undefined, ok: 'x', t: true, n: null, big: 2 ** 53, tiny: 5e-324 };
    const back = roundTrip(v) as Record<string, unknown>;
    expect(Number.isNaN(back.a)).toBe(true);
    expect(back.b).toBe(Infinity);
    expect(back.c).toBe(-Infinity);
    expect(Object.is(back.d, -0)).toBe(true);
    expect(Object.is(back.e, 0)).toBe(true);
    expect(Object.is((back.f as number[])[3], -0)).toBe(true);
    expect(Object.is((back.g as { h: number }).h, -0)).toBe(true);
    expect('skip' in back).toBe(false);
    expect(back.ok).toBe('x');
    expect(back.t).toBe(true);
    expect(back.n).toBeNull();
    expect(back.big).toBe(2 ** 53);
    expect(back.tiny).toBe(5e-324);
    expect(back).toEqual({ ...v, skip: undefined });
  });

  it('carries nested and repeated arrays, strings of every kind and an object with integer-like keys', () => {
    const shared = new Float32Array([1, 2, 3]);
    const v = {
      type: 'snapshot',
      list: [{ a: shared }, { a: shared }, [shared, [new Uint8Array([9])]]],
      text: 'Katoomba é \u{1F525}   "quoted" \\ \n lone \ud800 surrogate',
      keys: { 10: 'x', 2: 'y', b: 'z', a: 'w' },
      deep: { a: { b: { c: { d: new Int8Array([1]) } } } },
    };
    const back = roundTrip(v) as typeof v;
    expect(difference(back, v)).toBeNull();
    expect(back.text).toBe(v.text);
    // The repeats are separate copies, not one aliased array.
    expect((back.list[0] as { a: Float32Array }).a).not.toBe((back.list[1] as { a: Float32Array }).a);
  });

  it('lays a frame out as the contract says: u32 header length, JSON, padding to 8, arrays each on a multiple of 8', () => {
    const frame = encodeValue({ type: 'x', a: new Uint8Array([1, 2, 3]), b: new Float64Array([1.5]), c: new Int16Array([4, 5]) });
    const headerLength = new DataView(frame.buffer).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + headerLength)));
    expect(header.a).toEqual({ $ta: 'u8', o: 0, n: 3 });
    expect(header.b).toEqual({ $ta: 'f64', o: 8, n: 1 });
    expect(header.c).toEqual({ $ta: 'i16', o: 16, n: 2 });
    const bodyStart = Math.ceil((4 + headerLength) / 8) * 8;
    expect(frame.subarray(4 + headerLength, bodyStart).every((x) => x === 0)).toBe(true);
    expect(Array.from(frame.subarray(bodyStart, bodyStart + 3))).toEqual([1, 2, 3]);
    expect(new Float64Array(frame.slice(bodyStart + 8, bodyStart + 16).buffer)[0]).toBe(1.5);
    expect(frame.byteLength).toBe(bodyStart + 20);
  });

  it('decodes a frame held anywhere in a bigger buffer (a socket chunk), and what it returns owns aligned buffers', () => {
    const msg = { type: 'snapshot', a: new Float32Array([1, 2, 3, 4, 5]), b: new Float64Array([6, 7]) };
    const frame = encodeValue(msg);
    const holder = new Uint8Array(frame.byteLength + 13);
    holder.set(frame, 3);
    const back = decodeValue(holder.subarray(3, 3 + frame.byteLength)) as typeof msg;
    expect(difference(back, msg)).toBeNull();
    everyArray(back, (a, p) => {
      expect(a.byteOffset, p).toBe(0);
      expect(a.buffer.byteLength, p).toBe(a.byteLength);
      expect(a.byteOffset % 8, p).toBe(0);
    });
  });

  it('round trips every message type of the protocol and the two link messages', () => {
    const toWorker: ToWorker[] = [
      { type: 'run', until: 3600 },
      { type: 'pause' },
      { type: 'ignite', ignition: pointIgnition('a', 10, -20, 0, 45) },
      { type: 'explain', x: 1.5, y: -2, reqId: 7, time: 600 },
      { type: 'explain', x: 1.5, y: -2, reqId: 8 },
      { type: 'rewind', time: 120 },
      { type: 'setOption', key: 'maxStepS', value: 4 },
      { type: 'setOption', key: 'embers', value: false },
      { type: 'setQuality', tier: 'high' },
      { type: 'removeEdit', id: 'e1' },
      { type: 'removeIgnition', id: 'i1' },
    ];
    const fromWorker: FromWorker[] = [
      { type: 'status', time: 12, running: true, speed: 900.5, until: 3600 },
      { type: 'status', time: 12, running: false, speed: 0 },
      { type: 'error', message: 'It broke.\n at x' },
      { type: 'rewound', time: 60 },
      { type: 'ready', forecastInsights: [] },
    ];
    for (const m of [...toWorker, ...fromWorker, { type: 'ping', t: 12.25 } as const, { type: 'pong', t: 12.25 } as const]) expect(decodeMessage(encodeMessage(m))).toEqual(m);
  });
});

describe('codec with real data', () => {
  it('round trips a real snapshot of each tier (fire grid, moisture, embers, atmosphere, layers), bit for bit', () => {
    for (const tier of ['fast', 'standard'] as const) {
      const sim = new Simulation(syntheticScenario({ extent: 1500, ignitions: [pointIgnition('a', -300, 0, 0, 60)] }), { tier, skipSpinUp: true });
      sim.advance(240);
      const snapshot = sim.snapshot();
      const msg: FromWorker = { type: 'snapshot', snapshot };
      const frame = encodeMessage(msg);
      const back = decodeMessage(frame) as { type: 'snapshot'; snapshot: SimSnapshot };
      expect(difference(back, msg), tier).toBeNull();
      let arrays = 0;
      everyArray(back, () => arrays++);
      expect(arrays, tier).toBeGreaterThan(8);
      if (tier === 'standard') expect(back.snapshot.atmosphere, 'the 3-D tier carries the air').toBeDefined();
    }
  }, 60000);

  it('round trips a real ScenarioData (the Katoomba demo site) as an init message, and the context stays out of it', async () => {
    const scenario: ScenarioData = await demoScenario({ startCivil: [2025, 12, 20, 14], extent: 6000, tier: 'fast', duration: 3600 });
    const sent = withoutContext(scenario);
    const msg: ToWorker = { type: 'init', scenario: sent };
    const frame = encodeMessage(msg);
    expect(frame.byteLength).toBeGreaterThan(1_000_000);
    const back = decodeMessage(frame) as { type: 'init'; scenario: ScenarioData };
    expect(difference(back, msg)).toBeNull();
    expect(back.scenario.context).toBeUndefined();
    expect(back.scenario.terrain.elevation).toBeInstanceOf(Float32Array);
  }, 120000);
});

describe('codec refuses what it cannot carry', () => {
  class Point {
    x = 1;
  }
  const cases: [string, unknown, RegExp][] = [
    ['a Map', { a: { b: new Map([[1, 2]]) } }, /a Map .* at a\.b/],
    ['a Set', { s: new Set([1]) }, /a Set .* at s/],
    ['a Date', { when: new Date(0) }, /a Date .* at when/],
    ['a BigInt', { n: [1n] }, /a BigInt at n\.0/],
    ['a class instance', { p: new Point() }, /a Point .* at p/],
    ['a function', { f: () => 1 }, /a function at f/],
    ['a symbol', { s: Symbol('x') }, /a symbol at s/],
    ['undefined in an array', { list: [1, undefined, 3] }, /undefined .* at list\.1/],
    ['a hole in an array', { list: [1, , 3] }, /undefined .* at list\.1/], // eslint-disable-line no-sparse-arrays
    ['undefined as the message', undefined, /undefined .* at the top level/],
    ['a DataView', { v: new DataView(new ArrayBuffer(8)) }, /DataView/],
    ['a bare ArrayBuffer', { b: new ArrayBuffer(8) }, /an ArrayBuffer .* at b/],
    ['a typed array subclass of nothing known (a boxed number)', { n: new Number(1) }, /a Number .* at n/],
    ['the reserved key $ta', { $ta: 'f32' }, /reserved key "\$ta"/],
    ['the reserved key $num', { a: { $num: 'NaN' } }, /reserved key "\$num"/],
  ];
  for (const [name, value, message] of cases) {
    it(`${name}`, () => {
      expect(() => encodeValue(value)).toThrow(CodecError);
      expect(() => encodeValue(value)).toThrow(message);
    });
  }

  it('a cycle (and anything nested deeper than any message)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = { again: a };
    expect(() => encodeValue(a)).toThrow(/nested too deeply/);
    let deep: unknown = 1;
    for (let i = 0; i < 300; i++) deep = [deep];
    expect(() => encodeValue(deep)).toThrow(CodecError);
  });

  it('a message whose type is not there', () => {
    expect(() => decodeMessage(encodeValue({ no: 'type' }))).toThrow(/not a message/);
    expect(() => decodeMessage(encodeValue([1, 2]))).toThrow(CodecError);
    expect(() => decodeMessage(encodeValue(5))).toThrow(CodecError);
  });
});

/** A small deterministic generator (mulberry32) for the fuzz. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A frame built by hand: the header text as given and a body. */
function frame(header: string, body: Uint8Array = new Uint8Array(0), declaredLength?: number): Uint8Array {
  const h = new TextEncoder().encode(header);
  const start = Math.ceil((4 + h.byteLength) / 8) * 8;
  const out = new Uint8Array(start + body.byteLength);
  new DataView(out.buffer).setUint32(0, declaredLength ?? h.byteLength, true);
  out.set(h, 4);
  out.set(body, start);
  return out;
}

describe('codec decoder meets damaged and hostile frames', () => {
  const good = encodeMessage({ type: 'snapshot', snapshot: { time: 5, fire: { a: new Float32Array([1, 2, 3]), b: new Uint8Array([4, 5]) }, list: [{ c: new Float64Array([6]) }] } } as unknown as FromWorker);

  it('answers every short, truncated and bit-flipped frame with a value or a CodecError (several thousand of them)', () => {
    const rand = rng(12345);
    const t0 = Date.now();
    let errors = 0;
    let values = 0;
    const attempt = (bytes: Uint8Array): void => {
      try {
        decodeValue(bytes);
        values++;
      } catch (e) {
        expect(e, `a ${(e as Error)?.constructor?.name} escaped`).toBeInstanceOf(CodecError);
        errors++;
      }
    };
    for (let n = 0; n <= good.byteLength; n++) attempt(good.slice(0, n)); // every truncation
    for (let i = 0; i < 4000; i++) {
      const f = good.slice();
      const flips = 1 + Math.floor(rand() * 6);
      for (let k = 0; k < flips; k++) f[Math.floor(rand() * f.length)] = Math.floor(rand() * 256);
      attempt(f);
    }
    for (let i = 0; i < 500; i++) attempt(Uint8Array.from({ length: Math.floor(rand() * 200) }, () => Math.floor(rand() * 256))); // noise
    expect(errors).toBeGreaterThan(100);
    expect(values).toBeGreaterThan(0);
    expect(Date.now() - t0, 'no hang').toBeLessThan(20000);
  });

  it('refuses a header that lies about its length, is not JSON or is not UTF-8', () => {
    expect(() => decodeValue(new Uint8Array(0))).toThrow(CodecError);
    expect(() => decodeValue(frame('{"type":"x"}', undefined, 4_000_000_000))).toThrow(/shorter than its header/);
    expect(() => decodeValue(frame('{"type":'))).toThrow(/not valid JSON/);
    expect(() => decodeValue(frame('[1,2,'))).toThrow(CodecError);
    const bad = frame('{"type":"xx"}');
    bad[10] = 0xff; // not UTF-8
    expect(() => decodeValue(bad)).toThrow(/not valid JSON/);
  });

  it('refuses a typed array that is outside the body, misaligned, of an unknown kind, of a wrong shape or negative', () => {
    const body = new Uint8Array(32);
    const bad = [
      '{"type":"x","a":{"$ta":"f32","o":0,"n":9}}', // 36 bytes in 32
      '{"type":"x","a":{"$ta":"f32","o":8,"n":7}}', // starts inside, runs past the end
      '{"type":"x","a":{"$ta":"f32","o":4,"n":1}}', // not on a multiple of 8
      '{"type":"x","a":{"$ta":"f16","o":0,"n":1}}', // unknown kind
      '{"type":"x","a":{"$ta":"constructor","o":0,"n":1}}', // a name from the prototype chain
      '{"type":"x","a":{"$ta":"f32","o":0,"n":-1}}',
      '{"type":"x","a":{"$ta":"f32","o":-8,"n":1}}',
      '{"type":"x","a":{"$ta":"f32","o":0.5,"n":1}}',
      '{"type":"x","a":{"$ta":"f32","o":0,"n":1e300}}',
      '{"type":"x","a":{"$ta":"f32","o":"0","n":1}}',
      '{"type":"x","a":{"$ta":"f32","o":0,"n":1,"extra":1}}',
      '{"type":"x","a":{"$ta":"f32","o":0}}',
      '{"type":"x","a":{"$ta":5,"o":0,"n":1}}',
      '{"type":"x","a":{"$num":"nan"}}',
      '{"type":"x","a":{"$num":"NaN","extra":1}}',
      '{"type":"x","a":{"$num":5}}',
    ];
    for (const h of bad) expect(() => decodeValue(frame(h, body)), h).toThrow(CodecError);
    // and the well-formed neighbour of each is fine
    expect((decodeValue(frame('{"type":"x","a":{"$ta":"f32","o":0,"n":8}}', body)) as { a: Float32Array }).a.length).toBe(8);
  });

  it('does not let a header allocate more than the frame holds (arrays that overlap are refused)', () => {
    const body = new Uint8Array(64);
    const one = '{"$ta":"u8","o":0,"n":64}';
    expect(() => decodeValue(frame(`{"type":"x","a":${one},"b":${one}}`, body))).toThrow(/outside its body/);
    const many = `{"type":"x","list":[${Array.from({ length: 1000 }, () => '{"$ta":"f64","o":0,"n":8}').join(',')}]}`;
    expect(() => decodeValue(frame(many, body))).toThrow(CodecError);
    const t0 = Date.now();
    expect(() => decodeValue(frame('{"type":"x","a":{"$ta":"f64","o":0,"n":4503599627370496}}', body))).toThrow(CodecError); // 2^52 elements
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('refuses a header nested deeper than any message, however long (an error, not a stack overflow)', () => {
    const depth = 50_000;
    expect(() => decodeValue(frame(`${'['.repeat(depth)}${']'.repeat(depth)}`))).toThrow(CodecError);
    expect(() => decodeValue(frame(`${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`))).toThrow(CodecError);
  });

  it('keeps __proto__ as an ordinary field and the prototype of every object untouched', () => {
    const v = decodeValue(frame('{"type":"x","__proto__":{"polluted":1},"a":{"__proto__":{"deep":2}}}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.hasOwn(v, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).deep).toBeUndefined();
    expect((v.a as object) instanceof Object).toBe(true);
    expect(Object.getPrototypeOf(v.a)).toBe(Object.prototype);
  });
});
