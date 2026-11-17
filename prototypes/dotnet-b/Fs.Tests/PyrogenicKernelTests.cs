using System.Text.Json;
using Fs.Kernel;

namespace Fs.Tests;

/// <summary>
/// Card T1.4b, <c>PyrogenicPotential.solve</c> (the K1 salvage, now under the rules of plan 10.4 with no analyzer exemption). Reference data: the real, unmodified TypeScript solve on
/// real heat-flux fields of <c>katoomba6-fast-4h</c> at 900 s and 14,100 s, and on four variants of each (NaN, -0 and +Infinity sprinkled in; no source; one cell), compared as bits for
/// psi, the coarse gradient (both Float64: the intermediates that no float32 store has rounded), u_p and v_p, plus the sine tables. The kernel needs <c>FsMath.Sin</c> for its tables; with the
/// default fdlibm implementation that is Node 22's own <c>Math.sin</c> (T1.3: 0 mismatches in 23 million calls), so the TypeScript's bits need no shim; the default implementation is
/// asserted in the test.
/// </summary>
[TestClass]
public sealed class PyrogenicKernelTests
{
    static readonly Func<string, bool> PyroKinds = k => k == "pyro";

    internal static void CheckFixture(string name, IEnumerable<KernelExec> forms)
    {
        Assert.AreEqual(FsMathImplementation.FdLibm, FsMath.Implementation, "the default FsMath implementation is the one that equals Node 22's Math.sin");
        var data = FastTestData.Files.TryLoad(name);
        if (data is null)
        {
            Assert.Inconclusive($"the fixture fx-{name} is missing in {FastTestData.FixturesRoot()} (run Fs.Bench/ts/fast/regen.sh)");
            return;
        }
        JsonElement golden = FastTestData.Golden(name);
        var expected = FastCaseRunner.Expected(golden, PyroKinds);
        Assert.IsTrue(expected.Count >= 25, "expected values: " + expected.Count);
        var bad = new List<string>();
        int checks = 0;
        foreach (KernelExec exec in forms)
        {
            var got = FastCaseRunner.RunAll(data, data.Header, exec, PyroKinds);
            foreach (var kv in expected)
            {
                checks++;
                if (!got.TryGetValue(kv.Key, out string? g)) bad.Add($"[{FastTestData.Name(exec)}] {kv.Key}: not produced");
                else if (g != kv.Value) bad.Add($"[{FastTestData.Name(exec)}] {kv.Key}: {g} != {kv.Value}");
            }
        }
        Assert.AreEqual(0, bad.Count, $"{bad.Count} of {checks} hashes differ from the TypeScript's, first: {string.Join("; ", bad.Take(6))}");
    }

    [TestMethod]
    public void The900sFieldEqualsTheTypeScriptOnEveryForm() => CheckFixture("k6f-900", FastTestData.AllForms);

    [TestMethod]
    public void TheLateFieldEqualsTheTypeScriptOnEveryForm() => CheckFixture("k6f-late", FastTestData.AllForms);

    [TestMethod]
    public void TheDefaultFormsOfTheKernelEqualTheTypeScriptToo()
    {
        // the older entry points: SolveScalar, SolveVector128, Solve(mode), SolveParallel
        var data = FastTestData.Files.TryLoad("k6f-900");
        if (data is null) { Assert.Inconclusive("fixture missing"); return; }
        JsonElement golden = FastTestData.Golden("k6f-900");
        var meta = FastCaseRunner.ReadMeta(golden.GetProperty("meta"));
        JsonElement c = golden.GetProperty("cases").EnumerateArray().First(x => x.GetProperty("kind").GetString() == "pyro");
        string want = c.GetProperty("variants")[0].GetProperty("result").GetProperty("psi").GetString()!;
        float[] q = data.F32(c.GetProperty("q").GetString()!);
        foreach (Action<PyrogenicKernel> run in new Action<PyrogenicKernel>[]
        {
            k => k.SolveScalar(q), k => k.SolveVector128(q), k => k.Solve(q, SimdMode.Scalar), k => k.Solve(q, SimdMode.V128), k => k.SolveParallel(q, 1), k => k.SolveParallel(q, 4), k => k.SolveParallel(q, 8, SimdMode.Scalar),
        })
        {
            var k = FastCaseRunner.NewPyro(meta, c);
            run(k);
            Assert.AreEqual(want, FastCaseRunner.Hash(k.Psi));
        }
    }

    // ───────────────────────────── synthetic ─────────────────────────────

    static IEnumerable<float[]> Sources(int nx, int ny, FastTestData.Rng rng)
    {
        yield return new float[nx * ny]; // nothing burning
        var one = new float[nx * ny];
        one[rng.Int(one.Length)] = 81f;
        yield return one;
        foreach (double density in new[] { 0.03, 0.3, 1.0 })
        {
            var q = new float[nx * ny];
            for (int i = 0; i < q.Length; i++) if (rng.Next() < density) q[i] = (float)(rng.Next() * 80 + 0.5);
            yield return q;
        }
        var edge = new float[nx * ny]; // the last row and column only (the partial coarse cells of odd sizes)
        for (int i = 0; i < nx; i++) edge[(ny - 1) * nx + i] = 40f;
        for (int j = 0; j < ny; j++) edge[j * nx + nx - 1] = 20f;
        yield return edge;
        var poisoned = new float[nx * ny];
        for (int i = 0; i < poisoned.Length; i++) poisoned[i] = i % 7 == 0 ? float.NaN : i % 11 == 0 ? -0.0f : i % 13 == 0 ? -5f : i % 5 == 0 ? 12f : 0f;
        yield return poisoned;
    }

    static string[] Hashes(PyrogenicKernel k) => [FastCaseRunner.Hash(k.Psi), FastCaseRunner.Hash(k.Gx), FastCaseRunner.Hash(k.Gy), FastCaseRunner.Hash(k.Up), FastCaseRunner.Hash(k.Vp)];

    [TestMethod]
    public void EveryFormAgreesWithTheScalarFormOnEveryShapeAndRowLength()
    {
        // fire sizes from 1 to 100 cells (coarse 1 to 50: every tail of the two-lane and four-vector loops, odd and even fire sizes, a coarse grid of one cell)
        int[] sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 23, 24, 25, 31, 32, 33, 34, 35, 47, 48, 49, 63, 64, 65, 100];
        var rng = new FastTestData.Rng(20261116);
        int shapes = 0, checks = 0;
        var bad = new List<string>();
        foreach (int nx in sizes)
            foreach (int ny in new[] { 1, 2, 3, 5, 8, 13, 100 })
            {
                if (nx * ny > 2500 && nx != 100 && ny != 100) continue;
                shapes++;
                foreach (float[] q in Sources(nx, ny, rng))
                {
                    var r = new PyrogenicKernel(nx, ny, 30);
                    r.SolveScalar(q);
                    string[] reference = Hashes(r);
                    foreach (KernelExec exec in FastTestData.AllForms.Skip(1))
                    {
                        var k = new PyrogenicKernel(nx, ny, 30);
                        k.Solve(q, exec);
                        checks++;
                        if (!Hashes(k).SequenceEqual(reference)) bad.Add($"{nx}x{ny} [{FastTestData.Name(exec)}]");
                    }
                }
            }
        Assert.AreEqual(0, bad.Count, $"{bad.Count} of {checks} differ: {string.Join("; ", bad.Take(6))}");
        Assert.IsTrue(shapes > 100 && checks > 3000, $"{shapes} shapes {checks} checks");
    }

    [TestMethod]
    public void ResultsDoNotDependOnTheNumberOfThreadsOrOnWhatAnInstanceSolvedBefore()
    {
        var rng = new FastTestData.Rng(5);
        var qs = Sources(150, 120, rng).ToArray();
        // after a solve with nothing burning only psi, u_p and v_p are defined (zero): the coarse gradient is scratch that the TypeScript leaves as it was, and so does this port
        static string Key(PyrogenicKernel k, float[] q) => q.Any(v => v > 0) ? string.Concat(Hashes(k)) : string.Concat(Hashes(k).Where((_, i) => i != 1 && i != 2));
        var fresh = qs.Select(q => { var k = new PyrogenicKernel(150, 120, 30); k.SolveScalar(q); return Key(k, q); }).ToArray();
        foreach (int threads in new[] { 2, 3, 4, 5, 6, 8, 16 })
            foreach (bool vec in new[] { false, true })
            {
                var reused = new PyrogenicKernel(150, 120, 30); // one instance, all the fields in turn, in an order that alternates sparse and dense
                for (int r = 0; r < 2; r++)
                    for (int i = 0; i < qs.Length; i++)
                    {
                        int j = r == 0 ? i : qs.Length - 1 - i;
                        reused.Solve(qs[j], new KernelExec(vec, threads));
                        Assert.AreEqual(fresh[j], Key(reused, qs[j]), $"{threads} threads, vector {vec}, field {j}, round {r}");
                    }
            }
    }

    [TestMethod]
    public void NothingBurningGivesZeroFieldsAndASingleCellGivesAFiniteCappedWind()
    {
        foreach (KernelExec exec in FastTestData.AllForms)
        {
            var k = new PyrogenicKernel(60, 50, 30);
            k.Solve(new float[60 * 50], exec);
            Assert.IsTrue(k.Psi.All(v => v == 0) && k.Up.All(v => v == 0) && k.Vp.All(v => v == 0));
            var q = new float[60 * 50];
            q[25 * 60 + 30] = 5000f; // a huge source: the cap (5 m/s) must act
            k.Solve(q, exec);
            Assert.IsTrue(k.Up.All(float.IsFinite) && k.Vp.All(float.IsFinite));
            double max = 0;
            for (int i = 0; i < k.Up.Length; i++) max = Math.Max(max, Math.Sqrt((double)k.Up[i] * k.Up[i] + (double)k.Vp[i] * k.Vp[i]));
            Assert.IsTrue(max > 4.9 && max <= 5.0001, max.ToString());
        }
    }

    [TestMethod]
    public void TheSolutionSolvesThePoissonProblem()
    {
        // an independent check of the maths, not of the port: the 5-point Laplacian of psi on the coarse grid equals -k q / (cell count) up to the DST's exactness (Dirichlet psi = 0 at the
        // cell-centred boundary, so the stencil uses -psi as the ghost value, as the gradient does)
        int nx = 40, ny = 36;
        var q = new float[nx * ny];
        for (int j = 10; j < 20; j++) for (int i = 12; i < 25; i++) q[j * nx + i] = 30f;
        var k = new PyrogenicKernel(nx, ny, 30);
        k.SolveScalar(q);
        int cx = k.Nx, cy = k.Ny;
        double h = k.H, worst = 0, scale = 0;
        for (int J = 0; J < cy; J++)
            for (int I = 0; I < cx; I++)
            {
                double p = k.Psi[J * cx + I];
                double w = I > 0 ? k.Psi[J * cx + I - 1] : -p, e = I < cx - 1 ? k.Psi[J * cx + I + 1] : -p, s = J > 0 ? k.Psi[(J - 1) * cx + I] : -p, n = J < cy - 1 ? k.Psi[(J + 1) * cx + I] : -p;
                double lap = (w + e + s + n - 4 * p) / (h * h);
                double want = 0;
                double sum = 0; int cells = 0;
                for (int dj = 0; dj < 2; dj++) for (int di = 0; di < 2; di++) { int jj = 2 * J + dj, ii = 2 * I + di; if (jj < ny && ii < nx) { cells++; if (q[jj * nx + ii] > 0) sum += q[jj * nx + ii]; } }
                want = -6e-4 * sum / cells;
                worst = Math.Max(worst, Math.Abs(lap - want));
                scale = Math.Max(scale, Math.Abs(want));
            }
        Assert.IsTrue(worst < 1e-9 * scale + 1e-12, $"max |laplacian psi + k q| {worst:E3} against scale {scale:E3}");
    }

    // ───────────────────────────── mutation checks of the solve ─────────────────────────────

    readonly struct PyReverse : IPyroOps // the rows of every accumulation added in descending order
    {
        public static bool ReverseRows => true;
        public static double Scale(double psi, double f, double lamX, double lamY) => PyroLiteral.Scale(psi, f, lamX, lamY);
        public static double Lerp(double g0, double g1, double g2, double g3, double tx, double ty) => PyroLiteral.Lerp(g0, g1, g2, g3, tx, ty);
    }

    readonly struct PyScale : IPyroOps // psi * (f / (lamX + lamY)) instead of (psi * f) / (lamX + lamY)
    {
        public static bool ReverseRows => false;
        public static double Scale(double psi, double f, double lamX, double lamY) => psi * (f / (lamX + lamY));
        public static double Lerp(double g0, double g1, double g2, double g3, double tx, double ty) => PyroLiteral.Lerp(g0, g1, g2, g3, tx, ty);
    }

    readonly struct PyLerp : IPyroOps // the bilinear weights multiplied out: g0 (1-tx)(1-ty) + g1 tx (1-ty) + g2 (1-tx) ty + g3 tx ty
    {
        public static bool ReverseRows => false;
        public static double Scale(double psi, double f, double lamX, double lamY) => PyroLiteral.Scale(psi, f, lamX, lamY);
        public static double Lerp(double g0, double g1, double g2, double g3, double tx, double ty) => g0 * (1 - tx) * (1 - ty) + g1 * tx * (1 - ty) + g2 * (1 - tx) * ty + g3 * tx * ty;
    }

    readonly struct PySwap : IPyroOps // NOT a mutation: operands of single + and * swapped (the bits must be identical)
    {
        public static bool ReverseRows => false;
        public static double Scale(double psi, double f, double lamX, double lamY) => (f * psi) / (lamY + lamX);
        public static double Lerp(double g0, double g1, double g2, double g3, double tx, double ty) => (1 - ty) * ((1 - tx) * g0 + tx * g1) + ty * ((1 - tx) * g2 + tx * g3);
    }

    static Dictionary<string, string> PyHashes<TM>(PyrogenicKernel k, float[] q) where TM : struct, IPyroOps
    {
        k.SolveWith<TM>(q);
        return new Dictionary<string, string> { ["psi"] = FastCaseRunner.Hash(k.Psi), ["gx"] = FastCaseRunner.Hash(k.Gx), ["gy"] = FastCaseRunner.Hash(k.Gy), ["up"] = FastCaseRunner.Hash(k.Up), ["vp"] = FastCaseRunner.Hash(k.Vp) };
    }

    [TestMethod]
    public void OperandOrderSlipsInTheSolveAreCaughtOnTheRealFieldsAndAHarmlessSwapIsNot()
    {
        // psi, gx and gy are Float64 (the doubles the arithmetic produced); u_p and v_p are float32 stores of the interpolated gradient, which may hide a slip in the interpolation.
        string[] names = ["reverse", "scale", "lerp", "swap"];
        var caughtBy = names.ToDictionary(n => n, _ => new SortedSet<string>());
        var caughtFields = names.ToDictionary(n => n, _ => 0);
        int fields = 0;
        foreach (string name in new[] { "k6f-900", "k6f-late" })
        {
            var data = FastTestData.Files.TryLoad(name);
            if (data is null) { Assert.Inconclusive("fixture missing"); return; }
            JsonElement golden = FastTestData.Golden(name);
            var meta = FastCaseRunner.ReadMeta(golden.GetProperty("meta"));
            JsonElement c = golden.GetProperty("cases").EnumerateArray().First(x => x.GetProperty("kind").GetString() == "pyro");
            JsonElement plain = c.GetProperty("variants")[0].GetProperty("result");
            float[] q = data.F32(c.GetProperty("q").GetString()!);
            var control = PyHashes<PyroLiteral>(FastCaseRunner.NewPyro(meta, c), q);
            foreach (string key in control.Keys) Assert.AreEqual(plain.GetProperty(key).GetString(), control[key], $"control {name} {key}");
            fields++;
            void Compare(string mutant, Dictionary<string, string> m)
            {
                bool any = false;
                foreach (string key in control.Keys)
                    if (m[key] != control[key]) { caughtBy[mutant].Add(key); any = true; }
                if (any) caughtFields[mutant]++;
            }
            Compare("reverse", PyHashes<PyReverse>(FastCaseRunner.NewPyro(meta, c), q));
            Compare("scale", PyHashes<PyScale>(FastCaseRunner.NewPyro(meta, c), q));
            Compare("lerp", PyHashes<PyLerp>(FastCaseRunner.NewPyro(meta, c), q));
            Compare("swap", PyHashes<PySwap>(FastCaseRunner.NewPyro(meta, c), q));
            // why "lerp" hides: count, over the fire cells, how often the two interpolations differ as doubles and how often after the float32 store
            var kk = FastCaseRunner.NewPyro(meta, c);
            kk.SolveWith<PyroLiteral>(q);
            long cells = 0, dblDiff = 0, f32Diff = 0;
            for (int j = 0; j < kk.FireNy; j++)
            {
                double fy = Math.Min(Math.Max((j + 0.5) / 2 - 0.5, 0), kk.Ny - 1);
                int J0 = Math.Min((int)Math.Floor(fy), Math.Max(0, kk.Ny - 2));
                double ty = fy - J0;
                for (int i = 0; i < kk.FireNx; i++)
                {
                    double fx = Math.Min(Math.Max((i + 0.5) / 2 - 0.5, 0), kk.Nx - 1);
                    int I0 = Math.Min((int)Math.Floor(fx), Math.Max(0, kk.Nx - 2));
                    double tx = fx - I0;
                    int c0 = J0 * kk.Nx + I0, c1 = kk.Nx > 1 ? c0 + 1 : c0, c2 = kk.Ny > 1 ? c0 + kk.Nx : c0, c3 = kk.Nx > 1 && kk.Ny > 1 ? c0 + kk.Nx + 1 : c0;
                    double a = PyroLiteral.Lerp(kk.Gx[c0], kk.Gx[c1], kk.Gx[c2], kk.Gx[c3], tx, ty), b = PyLerp.Lerp(kk.Gx[c0], kk.Gx[c1], kk.Gx[c2], kk.Gx[c3], tx, ty);
                    cells++;
                    if (a != b) dblDiff++;
                    if ((float)a != (float)b) f32Diff++;
                }
            }
            FastTestData.Note($"pyrogenic lerp mutant, {name}: u differs as a double in {dblDiff} of {cells} fire cells, after the float32 store in {f32Diff} (before the 5 m/s cap)");
        }
        foreach (string n in names) FastTestData.Note($"pyrogenic mutant {n}: differs on {caughtFields[n]} of {fields} real fields, in outputs [{string.Join(",", caughtBy[n])}]");
        Assert.AreEqual(2, fields);
        Assert.AreEqual(0, caughtFields["swap"], "a commutative swap changes no bit");
        foreach (string n in new[] { "reverse", "scale" })
            Assert.IsTrue(caughtFields[n] >= 1, $"mutant {n} was not caught by any real field");
        // The interpolation mutant ("lerp") is NOT caught on these fields: u and v are doubles that are stored straight into the float32 u_p and v_p, and that store rounds the one-ulp
        // double difference away on every cell of both real fields (T1.4a's finding again). What pins that expression is the structure (the test of the literal port against the TypeScript's
        // bits, which uses the same expression in the same order), not this mutant. Recorded, not asserted either way, so that a future change of data that does catch it does not fail the build.
    }

    [TestMethod]
    public void ScalarAndVectorFormsAllocateNothingPerSolve()
    {
        var rng = new FastTestData.Rng(8);
        float[] q = Sources(200, 200, rng).ElementAt(3);
        var k = new PyrogenicKernel(200, 200, 30);
        foreach (KernelExec exec in new[] { KernelExec.Scalar, KernelExec.Vec })
        {
            for (int i = 0; i < 4; i++) k.Solve(q, exec);
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 6; i++) k.Solve(q, exec);
            Assert.AreEqual(0, GC.GetAllocatedBytesForCurrentThread() - before, FastTestData.Name(exec));
        }
    }
}
