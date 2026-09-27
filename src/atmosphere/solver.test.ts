import { describe, expect, it } from 'vitest';
import { buildAtmosGrid } from './grid';
import { EllipticSolver, allLateralActive } from './solver';
import { analyticTerrain, flatTerrain, katoombaTerrain } from './testUtils';
import { Rng } from '../core/rng';

function randomRhs(n: number, seed = 7): Float64Array {
  const r = new Rng(seed);
  const b = new Float64Array(n);
  for (let q = 0; q < n; q++) b[q] = r.next() - 0.5;
  return b;
}

describe('elliptic solver (§8.5)', () => {
  it('acceptance: 48×48×24, Δx 150 m, Δζ₁ 20 m, r 1.13, lateral Dirichlet: residual × < 1e-5 after 4 V-cycles', () => {
    const Hp = (20 * (1.13 ** 24 - 1)) / 0.13;
    const t = flatTerrain(48 * 150, 150, 500);
    const g = buildAtmosGrid(t, undefined, undefined, 'high', 48 * 150, { cellSize: 150, levels: 24, dz1: 20, atmosTop: Hp });
    expect(g.nx).toBe(48);
    expect(g.stretch).toBeCloseTo(1.13, 3);
    const s = new EllipticSolver(g, 1, 1, allLateralActive(g, false));
    const b = randomRhs(g.n);
    const phi = new Float64Array(g.n);
    const res = s.solve(phi, b, { tol: 0, minIter: 4, maxIter: 4, checkLast: true });
    expect(res.relResidual).toBeLessThan(1e-5);
  });

  it('A is symmetric (variational discretisation incl. metric cross terms) on steep terrain', () => {
    const t = analyticTerrain(6000, 60, (x, y) => 500 + 600 * Math.exp(-(x * x + y * y) / (2 * 900 * 900)));
    const g = buildAtmosGrid(t, undefined, undefined, 'standard', 6000);
    const s = new EllipticSolver(g, 0.5, 0.2, allLateralActive(g, true));
    const a = randomRhs(g.n, 1);
    const b = randomRhs(g.n, 2);
    const Aa = new Float64Array(g.n);
    const Ab = new Float64Array(g.n);
    s.applyFull(a, Aa);
    s.applyFull(b, Ab);
    let x = 0;
    let y = 0;
    for (let q = 0; q < g.n; q++) {
      x += b[q]! * Aa[q]!;
      y += a[q]! * Ab[q]!;
    }
    expect(Math.abs(x - y) / Math.abs(x)).toBeLessThan(1e-10);
  });

  it('converges on the Katoomba DEM (mass-consistent boundaries) to 1e-6', async () => {
    const { terrain, hiRes } = await katoombaTerrain(6000, 30);
    const g = buildAtmosGrid(terrain, hiRes, undefined, 'standard', 6000);
    const s = new EllipticSolver(g, 0.5, 0.5 / 4, allLateralActive(g, true));
    const b = randomRhs(g.n, 3);
    const phi = new Float64Array(g.n);
    const t0 = performance.now();
    const res = s.solve(phi, b, { tol: 1e-6, maxIter: 60, allowPcg: true });
    const ms = performance.now() - t0;
    expect(res.relResidual).toBeLessThan(1e-6);
    // Report for the performance log.
    process.stderr.write(`\n[atmos] Katoomba MC solve: ${res.iterations} its (${res.method}), rate ${res.rate.toFixed(3)}, ${ms.toFixed(0)} ms, max slope ${g.maxSlopeDeg.toFixed(1)}° after ${g.smoothingPasses} passes\n`);
  });
});
