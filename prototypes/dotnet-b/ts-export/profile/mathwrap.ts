/**
 * Counting wrappers for the transcendental `Math` functions (stage 1, T1.1). Imported FIRST by profile.ts so that every module of the
 * solver sees the wrapped functions (ES modules evaluate in import order). Active only when FS_COUNT=1: the timed runs leave `Math` alone.
 *
 * Besides the exact count per function it samples the call site: every SAMPLE-th call (all functions together except `sqrt`, which is exact in IEEE and would swamp the others) captures a short stack and
 * records the first frame outside this file. Samples are held until `takeSamples()` hands them to the phase that just ended.
 */
export const COUNTED = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot', 'sqrt', '**', '**2'] as const;
export type Counted = (typeof COUNTED)[number];

export const counts: Record<string, number> = Object.fromEntries(COUNTED.map((k) => [k, 0]));
export const SAMPLE = 16;
let calls = 0;
/** pending[fn][site] = samples since the last take */
let pending: Record<string, Record<string, number>> = {};

const SELF = 'mathwrap';
function site(): string {
  const o: { stack?: string } = {};
  Error.captureStackTrace(o);
  const lines = (o.stack ?? '').split('\n').slice(1);
  for (const l of lines) {
    if (l.includes(SELF)) continue;
    // "    at fn (file:///.../src/x/y.mjs:12:3)" or "    at file:///...:12:3"
    const m = /at (?:(.+?) \()?(?:file:\/\/)?(.*?):(\d+):\d+\)?$/.exec(l.trim());
    if (!m) return l.trim();
    const file = m[2]!.replace(/^.*\/(src|ts-export)\//, '$1/').replace(/\.mjs$/, '.ts');
    return `${m[1] ?? '<anon>'} @ ${file}`;
  }
  return '<unknown>';
}

export function installMathCounters(): void {
  Error.stackTraceLimit = 8;
  for (const k of COUNTED) {
    if (k.startsWith('**')) continue; // counted by globalThis.__fsStarStar (profile.ts)
    const orig = (Math as unknown as Record<string, (...a: number[]) => number>)[k]!;
    const wrapped = function (a?: number, b?: number, c?: number): number {
      counts[k]!++;
      if (k !== 'sqrt' && ++calls % SAMPLE === 0) {
        const s = site();
        const p = (pending[k] ??= {});
        p[s] = (p[s] ?? 0) + 1;
      }
      // two-argument (pow, atan2, hypot) and three-argument (hypot) calls pass through unchanged.
      return b === undefined ? orig(a as number) : c === undefined ? orig(a as number, b) : orig(a as number, b, c);
    };
    Object.defineProperty(wrapped, 'name', { value: k });
    (Math as unknown as Record<string, unknown>)[k] = wrapped;
  }
}

/** Takes the samples recorded since the last call. */
export function takeSamples(): Record<string, Record<string, number>> {
  const p = pending;
  pending = {};
  return p;
}

/**
 * `**` calls, as rewritten by run.mjs build --count: counted apart, '**2' (exponent 2) and '**' (any other). Defined when this module loads, because
 * the solver's own modules use `**` while they load (before profile.ts's body runs).
 */
declare global {
  // eslint-disable-next-line no-var
  var __fsStarStar: (a: number, b: number) => number;
}
globalThis.__fsStarStar = (a: number, b: number): number => {
  counts[b === 2 ? '**2' : '**']!++;
  return a ** b;
};
