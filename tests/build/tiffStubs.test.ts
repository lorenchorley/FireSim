/**
 * vite.config.ts (`stubUnusedTiffCode`) leaves the GeoTIFF decoders the app never reads (LERC, ZSTD, JPEG, WebP) and pako out
 * of the build, and geotiff inflates with fflate instead. The unit tests run on the real geotiff and pako (the plugin applies
 * to builds only), so nothing else reads a Deflate TIFF through the build's version. This builds geotiff with the app's own
 * config, loads the result, and reads the kind of TIFF the Meta / WRI canopy COGs are (uint8, Deflate, predictor 2, 1-row
 * strips) and one big strip, against the same bytes read by the real geotiff and pako.
 */
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { build, type Rolldown } from 'vite';
import { fromArrayBuffer as fromArrayBufferReal } from 'geotiff';
import type * as TiffEntry from './tiffEntry';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PARAMS = { tileWidth: 8, tileHeight: 8, planarConfiguration: 1, bitsPerSample: [8], predictor: 1 };

/** A little-endian uint8 one-band TIFF: Deflate, horizontal predictor (2), `rowsPerStrip` rows per strip. */
function deflateTiff(w: number, h: number, pixels: Uint8Array, rowsPerStrip: number): ArrayBuffer {
  const strips: Uint8Array[] = [];
  for (let r0 = 0; r0 < h; r0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, h - r0);
    const raw = pixels.slice(r0 * w, (r0 + rows) * w);
    for (let r = 0; r < rows; r++) for (let c = w - 1; c > 0; c--) raw[r * w + c] = (raw[r * w + c]! - raw[r * w + c - 1]!) & 255; // undone by the reader
    strips.push(new Uint8Array(deflateSync(raw)));
  }
  const n = strips.length;
  const entries = 12;
  const ifdEnd = 8 + 2 + entries * 12 + 4;
  const offsetsAt = ifdEnd;
  const countsAt = offsetsAt + 4 * n;
  let at = countsAt + 4 * n;
  const buf = new ArrayBuffer(at + strips.reduce((a, s) => a + s.length, 0));
  const dv = new DataView(buf);
  dv.setUint16(0, 0x4949, true);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries, true);
  const SHORT = 3;
  const LONG = 4;
  const tags: [tag: number, type: number, count: number, value: number][] = [
    [256, LONG, 1, w],
    [257, LONG, 1, h],
    [258, SHORT, 1, 8],
    [259, SHORT, 1, 8], // Deflate
    [262, SHORT, 1, 1],
    [273, LONG, n, n === 1 ? 0 : offsetsAt], // one strip: the value sits in the entry (set below)
    [277, SHORT, 1, 1],
    [278, LONG, 1, rowsPerStrip],
    [279, LONG, n, n === 1 ? strips[0]!.length : countsAt],
    [284, SHORT, 1, 1],
    [317, SHORT, 1, 2], // horizontal differencing
    [339, SHORT, 1, 1],
  ];
  const dataAt = at;
  tags.forEach(([tag, type, count, value], e) => {
    const p = 10 + e * 12;
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (type === SHORT) dv.setUint16(p + 8, value, true);
    else dv.setUint32(p + 8, tag === 273 && n === 1 ? dataAt : value, true);
  });
  strips.forEach((s, i) => {
    dv.setUint32(offsetsAt + 4 * i, at, true);
    dv.setUint32(countsAt + 4 * i, s.length, true);
    new Uint8Array(buf, at, s.length).set(s);
    at += s.length;
  });
  return buf;
}

/** Canopy-like pixels (smooth patches plus noise) from a fixed seed, so every run reads the same file. */
function pixelsOf(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let s = 12345;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      out[r * w + c] = ((Math.floor(r / 9) * 37 + Math.floor(c / 13) * 11) & 63) + (s >>> 29);
    }
  return out;
}

let built: typeof TiffEntry;
let code = '';

beforeAll(async () => {
  const result = (await build({
    root: ROOT,
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    mode: 'capacitor',
    logLevel: 'silent',
    build: {
      write: false,
      sourcemap: false,
      copyPublicDir: false,
      lib: { entry: fileURLToPath(new URL('./tiffEntry.ts', import.meta.url)), formats: ['es'], fileName: 'tiff' },
      rolldownOptions: { output: { codeSplitting: false } }, // one module to load, decoders included
    },
  })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
  const chunk = (Array.isArray(result) ? result[0]! : result).output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('no chunk built');
  code = chunk.code;
  built = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as typeof TiffEntry;
}, 60000);

describe('the build without the unused GeoTIFF decoders', () => {
  it('has fflate in place of pako and the stub in place of the decoders', () => {
    expect(code).not.toContain('incorrect header check'); // pako
    expect(code).not.toContain('AGFzbQEAAAAB'); // the WebAssembly text of the LERC and ZSTD decoders
    expect(code).not.toContain('buildHuffmanTable: codeLength mismatch'); // the JPEG decoder
    expect(code).not.toContain('Cannot decode WebImage');
    expect(code).toContain('This build has no decoder for this TIFF compression');
    expect(code.length).toBeLessThan(150 * 1024); // the real thing is about 330 kB
  });

  it.each([
    ['one row per strip, like the Meta canopy COGs', 300, 64, 1],
    ['rows in strips of 7', 123, 49, 7],
    ['the whole image in one strip, past the 64 kB chunk of a streaming inflate', 300, 256, 256],
  ])('reads a Deflate TIFF with predictor 2 (%s) exactly as the real geotiff and pako do', async (_name, w, h, rowsPerStrip) => {
    const pixels = pixelsOf(w, h);
    const tiff = deflateTiff(w, h, pixels, rowsPerStrip);
    const read = async (open: typeof fromArrayBufferReal) => {
      const image = await (await open(tiff.slice(0))).getImage();
      expect([image.getWidth(), image.getHeight()]).toEqual([w, h]);
      return (await image.readRasters({ interleave: true })) as Uint8Array;
    };
    const real = await read(fromArrayBufferReal);
    expect(Buffer.from(real).equals(Buffer.from(pixels))).toBe(true); // the test's own TIFF is right
    const viaBuild = await read(built.fromArrayBuffer as typeof fromArrayBufferReal);
    expect(Buffer.from(viaBuild).equals(Buffer.from(pixels))).toBe(true);
  });

  it.each([
    ['LERC', 34887],
    ['ZSTD', 50000],
    ['JPEG', 7],
    ['WebP', 50001],
  ])('says so, and does not decode, a %s TIFF', async (_name, compression) => {
    await expect(built.getDecoder(compression, PARAMS)).rejects.toThrow('no decoder for this TIFF compression');
  });

  it('still has the decoders the app can meet', async () => {
    for (const compression of [1, 5, 8, 32773]) await expect(built.getDecoder(compression, PARAMS)).resolves.toBeDefined(); // raw, LZW, Deflate, PackBits
  });
});
