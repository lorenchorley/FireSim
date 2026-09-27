/** Bitwise fingerprints of snapshots for determinism tests (FNV-1a over the bytes of every typed array + JSON of the rest). */
import type { SimSnapshot } from '../../core/types';

function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function hashValue(h: number, v: unknown, skip: ReadonlySet<string>, path: string): number {
  if (ArrayBuffer.isView(v)) return fnv(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  if (v === null || typeof v !== 'object') return fnv(h, new TextEncoder().encode(`${path}=${typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : JSON.stringify(v)};`));
  if (Array.isArray(v)) {
    v.forEach((x, i) => (h = hashValue(h, x, skip, `${path}[${i}]`)));
    return h;
  }
  for (const k of Object.keys(v as object).sort()) {
    const p = path ? `${path}.${k}` : k;
    if (skip.has(p)) continue;
    h = hashValue(h, (v as Record<string, unknown>)[k], skip, p);
  }
  return h;
}

/** Hash of a snapshot, skipping wall-clock fields (stats.msPerSimMinute). */
export function snapshotHash(s: SimSnapshot, skip: readonly string[] = ['stats.msPerSimMinute']): number {
  return hashValue(0x811c9dc5, s, new Set(skip), '');
}

/** Per-part hashes (to see which part diverged). */
export function snapshotPartHashes(s: SimSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  const skip = new Set(['stats.msPerSimMinute']);
  for (const k of Object.keys(s)) out[k] = hashValue(0x811c9dc5, (s as unknown as Record<string, unknown>)[k], skip, k);
  if (s.layers) for (const k of Object.keys(s.layers)) out[`layers.${k}`] = hashValue(0x811c9dc5, s.layers[k], skip, k);
  const f = s.fire as unknown as Record<string, unknown>;
  for (const k of Object.keys(f)) out[`fire.${k}`] = hashValue(0x811c9dc5, f[k], skip, k);
  return out;
}
