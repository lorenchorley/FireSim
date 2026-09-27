/**
 * Small, fast, seedable PRNG (mulberry32) so simulations are reproducible:
 * the same scenario + seed gives the same embers and spot fires.
 */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Standard normal via Box–Muller. */
  normal(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Log-normal with given median and geometric standard deviation (sigma of ln). */
  logNormal(median: number, sigmaLn: number): number {
    return median * Math.exp(sigmaLn * this.normal());
  }
  /** Poisson-distributed count (Knuth for small means, normal approximation for large). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
  /** Current internal state, so a simulation checkpoint can resume the same random stream. */
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
}
