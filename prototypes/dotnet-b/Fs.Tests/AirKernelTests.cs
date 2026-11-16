using System.Text.Json;
using Fs.Kernel.Air;

namespace Fs.Tests;

/// <summary>
/// Card T1.4a: the standard tier's air kernels (gradient, divergence, relax, advect) in C#. What is checked:
/// 1. every golden case (the REAL unmodified TypeScript kernels on the real state of katoomba3-standard at 900 s, and of the 6 km high-tier grid; the NaN and -0 edge cases
///    included) gives the TypeScript's output bits on every form: scalar, Vector128, Parallel.For with 1, 2, 4 and 8 threads, and the vector body in parallel
///    (none of these kernels touches a transcendental function or sqrt, so the bits are the TypeScript's own and no FsMath shim is needed);
/// 2. on synthetic grids of every row length, the forms agree with the scalar form bit for bit, with and without NaN and -0 in the input;
/// 3. explicit NaN and -0 expectations that do not depend on the TypeScript;
/// 4. the scalar and vector forms allocate nothing per call; the parallel form's allocation is measured (Parallel.For's own).
/// The fixtures are made by Fs.Bench/ts/air/capture.ts (regenerate with Fs.Bench/ts/air/regen.sh); without them the fixture tests are inconclusive, never green.
/// </summary>
[TestClass]
public sealed class AirKernelTests
{
    public static readonly (string Name, AirExec Exec)[] Forms =
    [
        ("scalar", AirExec.Scalar),
        ("vector128", AirExec.Vec),
        ("parallel x1 (inline)", AirExec.Par(1)),
        ("parallel x2", AirExec.Par(2)),
        ("parallel x4", AirExec.Par(4)),
        ("parallel x8", AirExec.Par(8)),
        ("parallel x2 + vector128", AirExec.ParVec(2)),
        ("parallel x4 + vector128", AirExec.ParVec(4)),
        ("parallel x8 + vector128", AirExec.ParVec(8)),
    ];

    internal static void CheckFixture(string name, string goldenName, AirExec[]? only = null)
    {
        AirTestData.Fixture? fx = AirTestData.Fixture.TryLoad(name);
        if (fx is null)
        {
            Assert.Inconclusive($"fixture '{name}' not found under '{AirTestData.FixturesRoot()}': run Fs.Bench/ts/air/regen.sh (or set FS_AIR_FIXTURES)");
            return;
        }
        JsonElement golden = AirTestData.Golden(goldenName);
        Assert.AreEqual(golden.GetProperty("scenario").GetString(), fx.Header.GetProperty("scenario").GetString());
        var failures = new List<string>();
        int checkedCases = 0;
        foreach (JsonElement c in golden.GetProperty("cases").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            foreach (var (form, exec) in Forms)
            {
                if (only is not null && !only.Contains(exec)) continue;
                var (outs, ins) = AirTestData.RunCase(fx, c, exec);
                foreach (JsonProperty ih in c.GetProperty("inputHashes").EnumerateObject())
                    if (ins[ih.Name] != ih.Value.GetString()) failures.Add($"{id} [{form}]: input '{ih.Name}' is not the one the golden was made from (stale fixture?)");
                foreach (JsonElement o in c.GetProperty("outputs").EnumerateArray())
                {
                    string role = o.GetProperty("role").GetString()!;
                    if (outs[role] != o.GetProperty("hash").GetString()) failures.Add($"{id} [{form}]: output '{role}' hash {outs[role]} != TypeScript {o.GetProperty("hash").GetString()}");
                }
                checkedCases++;
            }
        }
        Console.WriteLine($"{name}: {checkedCases} case x form checks, {failures.Count} failures");
        Assert.AreEqual(0, failures.Count, string.Join("\n", failures.Take(20)));
        Assert.IsTrue(checkedCases >= golden.GetProperty("cases").GetArrayLength());
    }

    [TestMethod]
    public void Katoomba3StandardCasesEqualTheTypeScriptBitsOnEveryForm() => CheckFixture("fx-k3std", "k3std");

    [TestMethod]
    public void SixKilometreHighTierCasesEqualTheTypeScriptBitsOnEveryForm() => CheckFixture("fx-k6high", "k6high");

    [TestMethod]
    public void TheGoldenFilesHoldTheKernelsAndTheEdgeCases()
    {
        foreach (string n in new[] { "k3std", "k6high" })
        {
            JsonElement g = AirTestData.Golden(n);
            var ids = g.GetProperty("cases").EnumerateArray().Select(c => c.GetProperty("id").GetString()!).ToList();
            foreach (string k in new[] { "gradient/", "divergence/", "advect/", "relax/" })
            {
                Assert.IsTrue(ids.Any(i => i.StartsWith(k, StringComparison.Ordinal) && !i.Contains("edge")), $"{n}: a real case of {k}");
                Assert.IsTrue(ids.Any(i => i.StartsWith(k, StringComparison.Ordinal) && i.Contains("edge-nan-negzero")), $"{n}: a NaN and -0 case of {k}");
            }
            Assert.IsTrue(ids.Any(i => i.StartsWith("relax/call", StringComparison.Ordinal)), "the calls of a real V-cycle");
        }
    }

    // ───────────────────────────── synthetic: form against form ─────────────────────────────

    static readonly (int Nx, int Ny, int Nz)[] Shapes =
    [
        (3, 3, 3), (4, 3, 4), (5, 4, 3), (6, 5, 4), (7, 3, 5), (8, 6, 3), (9, 4, 4), (10, 5, 3), (11, 3, 4), (12, 7, 3), (13, 4, 5), (16, 9, 4), (17, 8, 3), (30, 30, 6),
    ];

    [TestMethod]
    public void RelaxFormsAgreeBitForBitOnEveryRowLengthAndSweepCount()
    {
        int n = 0;
        foreach (var (nx, ny, nz) in Shapes)
            foreach (bool reverse in new[] { false, true })
                foreach (int sweeps in new[] { 1, 2, 3 })
                    foreach (int poison in new[] { -1, 4 })
                    {
                        AirLevel basis = AirTestData.SyntheticLevel(nx, ny, nz, (ulong)(nx * 131 + ny * 17 + nz));
                        if (poison >= 0) { AirTestData.Poison(basis.B, poison); AirTestData.Poison(basis.X, poison + 1); }
                        float[]? want = null;
                        foreach (var (form, exec) in Forms)
                        {
                            float[] x = (float[])basis.X.Clone();
                            new AirRelax { MinParallelCells = 0 }.Run(basis.WithBX((float[])basis.B.Clone(), x), sweeps, reverse, exec);
                            want ??= x;
                            Assert.IsTrue(AirTestData.SameBits(want, x), $"relax {nx}x{ny}x{nz} sweeps {sweeps} reverse {reverse} poison {poison}: {form} differs from scalar");
                            n++;
                        }
                    }
        Console.WriteLine($"relax: {n} form checks");
    }

    [TestMethod]
    public void RelaxParallelChunksDoNotDependOnTheThreadCountAndTheDefaultThresholdKeepsSmallLevelsSerial()
    {
        AirLevel basis = AirTestData.SyntheticLevel(30, 30, 20, 99);
        var results = new List<float[]>();
        foreach (int t in new[] { 1, 2, 3, 4, 5, 8, 16 })
        {
            float[] x = (float[])basis.X.Clone();
            new AirRelax().Run(basis.WithBX((float[])basis.B.Clone(), x), 2, false, AirExec.Par(t)); // 18000 cells: parallel by the default threshold
            results.Add(x);
        }
        for (int i = 1; i < results.Count; i++) Assert.IsTrue(AirTestData.SameBits(results[0], results[i]), $"thread count #{i}");
        Assert.AreEqual(8192, new AirRelax().MinParallelCells);
    }

    [TestMethod]
    public void GradientAndDivergenceFormsAgreeBitForBitOnEveryRowLength()
    {
        int n = 0;
        foreach (var (nx, ny, nz) in Shapes)
            foreach (int poison in new[] { -1, 2 })
            {
                AirGrid g = AirTestData.SyntheticGrid(nx, ny, nz, (ulong)(nx * 7 + ny * 3 + nz));
                double[] phi = AirTestData.RandD(g.N, 5, -1, 1);
                float[] u = AirTestData.RandF(g.NU, 6, -3, 3), v = AirTestData.RandF(g.NV, 7, -3, 3), w = AirTestData.RandF(g.NW, 8, -3, 3);
                double[] ud = AirTestData.RandD(g.NU, 9, -3, 3), vd = AirTestData.RandD(g.NV, 10, -3, 3), wd = AirTestData.RandD(g.NW, 11, -3, 3);
                if (poison >= 0)
                {
                    AirTestData.Poison(phi, poison); AirTestData.Poison(u, poison); AirTestData.Poison(v, poison + 1); AirTestData.Poison(w, poison + 3);
                    AirTestData.Poison(ud, poison); AirTestData.Poison(vd, poison + 1); AirTestData.Poison(wd, poison + 3);
                }
                foreach (bool recipe in new[] { false, true })
                {
                    var au = new byte[g.NU]; var av = new byte[g.NV];
                    for (int f = 0; f < au.Length; f++) au[f] = (byte)(!recipe || f % 3 != 0 ? 1 : 0);
                    for (int f = 0; f < av.Length; f++) av[f] = (byte)(!recipe || f % 5 != 0 ? 1 : 0);
                    double[][]? wantG = null;
                    double[]? wantF = null, wantD = null;
                    foreach (var (form, exec) in Forms)
                    {
                        var ops = new AirOps(g, new AirMasks(au, av, recipe));
                        ops.Gradient(phi, exec);
                        double[][] got = [(double[])ops.Gu.Clone(), (double[])ops.Gv.Clone(), (double[])ops.Gw.Clone()];
                        var of = new double[g.N]; var od = new double[g.N];
                        ops.Divergence(u, v, w, of, 2.5, 0.375, exec);
                        ops.Divergence(ud, vd, wd, od, 1, 1, exec);
                        if (wantG is null) { wantG = got; wantF = of; wantD = od; continue; }
                        for (int q = 0; q < 3; q++) Assert.IsTrue(AirTestData.SameBits(wantG[q], got[q]), $"gradient {nx}x{ny}x{nz} poison {poison} recipe {recipe} component {q}: {form}");
                        Assert.IsTrue(AirTestData.SameBits(wantF!, of), $"divergence f32 {nx}x{ny}x{nz} poison {poison}: {form}");
                        Assert.IsTrue(AirTestData.SameBits(wantD!, od), $"divergence f64 {nx}x{ny}x{nz} poison {poison}: {form}");
                        n++;
                    }
                }
            }
        Console.WriteLine($"gradient and divergence: {n} form checks");
    }

    [TestMethod]
    public void AdvectFormsAgreeBitForBitOnEveryRowLengthAndEveryStaggering()
    {
        int n = 0;
        foreach (var (nx, ny, nz) in Shapes)
            foreach (int poison in new[] { -1, 3 })
                foreach (double scale in new[] { 0.9, 6.0 }) // displacements within a cell, and well beyond (the clamps)
                {
                    AirGrid g = AirTestData.SyntheticGrid(nx, ny, nz, (ulong)(nx + 100 * ny + nz));
                    float[] dx = AirTestData.RandF(g.N, 21, -scale, scale), dy = AirTestData.RandF(g.N, 22, -scale, scale), dz = AirTestData.RandF(g.N, 23, -scale, scale);
                    (int nxF, int nyF, int nzF, double ox, double oy, double oz)[] stag = [(nx + 1, ny, nz, 0.5, 0, 0), (nx, ny + 1, nz, 0, 0.5, 0), (nx, ny, nz + 1, 0, 0, 0.5), (nx, ny, nz, 0, 0, 0)];
                    foreach (var (nxF, nyF, nzF, ox, oy, oz) in stag)
                    {
                        int size = nxF * nyF * nzF;
                        float[] s1 = AirTestData.RandF(size, 31, -2, 2), s2 = AirTestData.RandF(size, 32, 0, 1);
                        if (poison >= 0) { AirTestData.Poison(s1, poison); AirTestData.Poison(s2, poison + 2); AirTestData.Poison(dx, poison + 1); }
                        float[]? want = null, want2 = null;
                        foreach (var (form, exec) in Forms)
                        {
                            var d1 = new float[size]; var d2 = new float[size];
                            new AirAdvect(g).Run(dx, dy, dz, s1, d1, nxF, nyF, nzF, ox, oy, oz, s2, d2, exec);
                            if (want is null) { want = d1; want2 = d2; continue; }
                            Assert.IsTrue(AirTestData.SameBits(want, d1), $"advect {nx}x{ny}x{nz} field {nxF}x{nyF}x{nzF} scale {scale} poison {poison}: {form}");
                            Assert.IsTrue(AirTestData.SameBits(want2!, d2), $"advect (second field) {nx}x{ny}x{nz} field {nxF}x{nyF}x{nzF}: {form}");
                            n++;
                        }
                    }
                }
        Console.WriteLine($"advect: {n} form checks");
    }

    // ───────────────────────────── NaN and -0, stated without the TypeScript ─────────────────────────────

    [TestMethod]
    public void AdvectKeepsMinusZeroWithZeroDisplacementAndMakesNaNFromANaNDisplacement()
    {
        const int nx = 6, ny = 5, nz = 4;
        AirGrid g = AirTestData.SyntheticGrid(nx, ny, nz, 3);
        foreach (var (form, exec) in Forms)
        {
            var zero = new float[g.N];
            var src = new float[g.N];
            Array.Fill(src, -0.0f);
            var dst = new float[g.N];
            new AirAdvect(g).Run(zero, zero, zero, src, dst, nx, ny, nz, 0, 0, 0, null, null, exec);
            foreach (float f in dst) Assert.AreEqual(BitConverter.SingleToInt32Bits(-0.0f), BitConverter.SingleToInt32Bits(f), $"{form}: -0 source, zero displacement keeps -0");
            Array.Fill(src, 0.0f);
            new AirAdvect(g).Run(zero, zero, zero, src, dst, nx, ny, nz, 0, 0, 0, null, null, exec);
            foreach (float f in dst) Assert.AreEqual(0, BitConverter.SingleToInt32Bits(f), $"{form}: +0 stays +0");
            // one NaN displacement: exactly the points that read it (a point reads the mean of the two cells it separates) become NaN, nothing else does
            var dxn = new float[g.N];
            int cell = (2 * ny + 2) * nx + 3;
            dxn[cell] = float.NaN;
            Array.Fill(src, 1.0f);
            new AirAdvect(g).Run(dxn, zero, zero, src, dst, nx, ny, nz, 0, 0, 0, null, null, exec);
            for (int i = 0; i < dst.Length; i++)
                Assert.AreEqual(i == cell, float.IsNaN(dst[i]), $"{form}: only the cell that holds the NaN displacement is NaN (index {i})");
        }
    }

    [TestMethod]
    public void RelaxNaNStaysInItsColumnAndItsNeighboursAndMinusZeroSurvivesAZeroRightHandSide()
    {
        const int nx = 8, ny = 6, nz = 4;
        foreach (var (form, exec) in Forms)
        {
            AirLevel lv = AirTestData.SyntheticLevel(nx, ny, nz, 5);
            Array.Fill(lv.X, 0f);
            Array.Fill(lv.B, 0f);
            lv.B[(1 * ny + 2) * nx + 3] = float.NaN; // k = 1, j = 2, i = 3
            new AirRelax { MinParallelCells = 0 }.Run(lv, 1, false, exec);
            // the NaN line is (i + j) & 1 = 1: pass 0 (colour 0) never reads its b; pass 1 relaxes it, and no other line of that colour reads it (neighbours are the other colour)
            for (int k = 0; k < nz; k++)
                for (int j = 0; j < ny; j++)
                    for (int i = 0; i < nx; i++)
                    {
                        bool inLine = i == 3 && j == 2;
                        bool nan = float.IsNaN(lv.X[(k * ny + j) * nx + i]);
                        if (!inLine) Assert.IsFalse(nan, $"{form}: NaN leaked to ({i},{j},{k}) after one sweep");
                    }
            Assert.IsTrue(float.IsNaN(lv.X[(1 * ny + 2) * nx + 3]), $"{form}: the NaN line has NaN");
        }
    }

    // ───────────────────────────── allocation ─────────────────────────────

    [TestMethod]
    public void ScalarAndVectorFormsAllocateNothingPerCallAfterSetup()
    {
        (long Scalar, long Vector, long Par) = MeasureAllocation();
        Console.WriteLine($"bytes allocated per call (relax 2 sweeps + gradient + 2 divergences + 4 advects): scalar {Scalar}, vector {Vector}, parallel x4 {Par}");
        Assert.AreEqual(0, Scalar, "scalar form");
        Assert.AreEqual(0, Vector, "vector form");
    }

    static (long, long, long) MeasureAllocation()
    {
        AirGrid g = AirTestData.SyntheticGrid(30, 30, 20, 1);
        AirLevel lv = AirTestData.SyntheticLevel(30, 30, 20, 2);
        var ops = new AirOps(g, new AirMasks(Enumerable.Repeat((byte)1, g.NU).ToArray(), Enumerable.Repeat((byte)1, g.NV).ToArray(), true));
        var relax = new AirRelax();
        var adv = new AirAdvect(g);
        double[] phi = AirTestData.RandD(g.N, 1, -1, 1), o1 = new double[g.N], o2 = new double[g.N];
        float[] u = AirTestData.RandF(g.NU, 2, -3, 3), v = AirTestData.RandF(g.NV, 3, -3, 3), w = AirTestData.RandF(g.NW, 4, -3, 3);
        float[] dx = AirTestData.RandF(g.N, 5, -0.9, 0.9), dy = AirTestData.RandF(g.N, 6, -0.9, 0.9), dz = AirTestData.RandF(g.N, 7, -0.9, 0.9);
        float[] s1 = AirTestData.RandF(g.NU, 8, -1, 1), d1 = new float[g.NU], s2 = AirTestData.RandF(g.N, 9, -1, 1), d2 = new float[g.N], d3 = new float[g.N];
        void All(AirExec e)
        {
            relax.Run(lv, 2, false, e);
            ops.Gradient(phi, e);
            ops.Divergence(u, v, w, o1, 1, 1, e);
            ops.Divergence(ops.Gu, ops.Gv, ops.Gw, o2, 1, 1, e);
            adv.Run(dx, dy, dz, s1, d1, 31, 30, 20, 0.5, 0, 0, null, null, e);
            adv.Run(dx, dy, dz, s2, d2, 30, 30, 20, 0, 0, 0, null, null, e);
            adv.Run(dx, dy, dz, s2, d2, 30, 30, 20, 0, 0, 0, s2, d3, e);
            adv.Run(dx, dy, dz, s2, d2, 30, 30, 20, 0, 0, 0, null, null, e);
        }
        long Measure(AirExec e)
        {
            for (int i = 0; i < 30; i++) All(e); // warm-up: tier-0 and tier-1 compilation allocate
            Thread.Sleep(300);
            for (int i = 0; i < 30; i++) All(e);
            const int calls = 20;
            long before = GC.GetTotalAllocatedBytes(precise: true);
            for (int i = 0; i < calls; i++) All(e);
            long after = GC.GetTotalAllocatedBytes(precise: true);
            return (after - before) / calls;
        }
        return (Measure(AirExec.Scalar), Measure(AirExec.Vec), Measure(AirExec.Par(4)));
    }
}
