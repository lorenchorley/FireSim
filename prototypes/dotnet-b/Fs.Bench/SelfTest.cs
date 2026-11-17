using System.Runtime.Intrinsics;
using Fs.Kernel;

namespace Fs.Bench;

/// <summary>
/// `Fs.Bench selftest`: every SIMD mode this process can run against the scalar contract, bit for bit, over grid shapes that cover the vector tails
/// (row lengths 1, 2, 3 = Count128 + 1, 4 = Count256, 5, 7, 8, 9, 15, 16, 17 ... 100 and the blocks of 4 vectors), empty / single-cell / sparse / dense
/// sources, square and non-square grids, odd fire-grid sizes, and the parallel path on 1, 2, 4 and 8 threads.
/// Run it in separate processes to force each path: default, DOTNET_EnableAVX2=0 (Vector256 not accelerated, Auto becomes V128) and
/// DOTNET_EnableHWIntrinsic=0 (no SIMD: Auto becomes Scalar). The process prints which path Auto took, so the log shows the path was really forced.
/// </summary>
public static class SelfTest
{
    public static int Run(Action<string> log)
    {
        log($"selftest: Vector128.IsHardwareAccelerated={Vector128.IsHardwareAccelerated} Vector256.IsHardwareAccelerated={Vector256.IsHardwareAccelerated} Vector512.IsHardwareAccelerated={Vector512.IsHardwareAccelerated}");
        int[] nxs = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 23, 24, 25, 31, 32, 33, 34, 35, 47, 48, 49, 63, 64, 65, 100 };
        int[] nys = { 1, 2, 3, 5, 8, 13, 100 };
        var rng = new Random(20261112);
        int shapes = 0, comparisons = 0, failures = 0;
        foreach (int nx in nxs)
        {
            foreach (int ny in nys)
            {
                if (nx * ny > 2500 && nx != 100 && ny != 100) continue; // keep it quick: the big ones only on the long axes
                // coarse nx..: fire sizes 2*nx and 2*nx - 1 (the coarsening is ceil(n/2)): both parities
                foreach (int odd in new[] { 0, 1 })
                {
                    int fnx = Math.Max(1, 2 * nx - odd), fny = Math.Max(1, 2 * ny - (odd ^ (nx & 1)));
                    shapes++;
                    var k = new PyrogenicKernel(fnx, fny, 30);
                    foreach (var q in Sources(fnx, fny, rng))
                    {
                        k.SolveScalar(q);
                        var psi = (double[])k.Psi.Clone();
                        var up = (float[])k.Up.Clone();
                        var vp = (float[])k.Vp.Clone();
                        foreach (var m in Check.AvailableModes())
                        {
                            var km = new PyrogenicKernel(fnx, fny, 30);
                            km.Solve(q, m);
                            comparisons++;
                            if (!Check.Same(km, psi, up, vp)) { failures++; log($"FAIL mode {m} nx={fnx} ny={fny} (coarse {nx}x{ny})"); }
                            if (!AllFinite(km)) { failures++; log($"FAIL non-finite output, mode {m} nx={fnx} ny={fny}"); }
                        }
                        foreach (int t in new[] { 1, 2, 4, 8 })
                        {
                            k.SolveParallel(q, t);
                            comparisons++;
                            if (!Check.Same(k, psi, up, vp)) { failures++; log($"FAIL parallel x{t} nx={fnx} ny={fny}"); }
                        }
                    }
                }
            }
        }
        log($"selftest: {shapes} shapes, {comparisons} comparisons with the scalar form, {failures} failures");
        return failures == 0 ? 0 : 1;
    }

    static bool AllFinite(PyrogenicKernel k)
    {
        foreach (var v in k.Psi) if (!double.IsFinite(v)) return false;
        foreach (var v in k.Up) if (!float.IsFinite(v)) return false;
        foreach (var v in k.Vp) if (!float.IsFinite(v)) return false;
        return true;
    }

    static IEnumerable<float[]> Sources(int nx, int ny, Random rng)
    {
        yield return new float[nx * ny]; // nothing burning: all-zero fields
        var one = new float[nx * ny];
        one[rng.Next(one.Length)] = 81f; // a single cell
        yield return one;
        foreach (double density in new[] { 0.03, 0.3, 1.0 })
        {
            var q = new float[nx * ny];
            for (int i = 0; i < q.Length; i++) if (rng.NextDouble() < density) q[i] = (float)(rng.NextDouble() * 80 + 0.5);
            yield return q;
        }
    }
}
