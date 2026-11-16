using System.Security.Cryptography;
using System.Text.Json;
using Fs.Kernel;
using Fs.Kernel.LevelSet;

namespace Fs.Tests;

/// <summary>Where a fixture's arrays come from: files (Fs.Tests) or the entry points of the WebAssembly build (Fs.Wasm).</summary>
public interface IFastData
{
    double[] F64(string name);
    float[] F32(string name);
    int[] I32(string name);
    byte[] U8(string name);
}

/// <summary>
/// Card T1.4b: runs one recorded case of Fs.Bench/ts/fast/capture.ts (a frame of the REAL <c>LevelSetCore.evaluate</c> / <c>reinit</c> / <c>PyrogenicPotential.solve</c> of the fast
/// tier, with its variants) on the C# kernels, in the form asked for, and returns the same hashes the TypeScript harness (Fs.Bench/ts/fast/lib.ts) produced, under the same keys.
/// No test framework in this file: Fs.Tests compares the result with Fs.Tests/golden/fast-*.json, and Fs.Wasm compiles this very file and returns it to a Node driver, so that the
/// WebAssembly build is checked with the code that checked x64. Hash = SHA-256 (first 32 hex digits) of the raw bytes with NaN canonicalised and -0 kept. The variant recipes
/// (nan-src, nan-coef, the q variants) are written out in lib.ts and repeated here.
/// </summary>
public static class FastCaseRunner
{
    // ── hashing ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    static string Hex(byte[] h) => Convert.ToHexStringLower(h.AsSpan(0, 16));

    public static string Hash(ReadOnlySpan<double> a)
    {
        var c = new double[a.Length];
        for (int i = 0; i < a.Length; i++) c[i] = double.IsNaN(a[i]) ? BitConverter.Int64BitsToDouble(0x7ff8000000000000L) : a[i];
        return Hex(SHA256.HashData(System.Runtime.InteropServices.MemoryMarshal.AsBytes<double>(c)));
    }

    public static string Hash(ReadOnlySpan<float> a)
    {
        var c = new float[a.Length];
        for (int i = 0; i < a.Length; i++) c[i] = float.IsNaN(a[i]) ? BitConverter.Int32BitsToSingle(0x7fc00000) : a[i];
        return Hex(SHA256.HashData(System.Runtime.InteropServices.MemoryMarshal.AsBytes<float>(c)));
    }

    public static string Hash(ReadOnlySpan<int> a) => Hex(SHA256.HashData(System.Runtime.InteropServices.MemoryMarshal.AsBytes(a)));
    public static string Hash(ReadOnlySpan<byte> a) => Hex(SHA256.HashData(a));
    public static string Bits(double x) => BitConverter.DoubleToInt64Bits(x).ToString("x16");

    // ── fixture access ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    public sealed record Meta(int Nx, int Ny, double CellSize, LevelSetParams P, double PyroK, double PyroMax);

    public static Meta ReadMeta(JsonElement meta)
    {
        JsonElement g = meta.GetProperty("grid"), l = meta.GetProperty("levelSet"), py = meta.GetProperty("pyro");
        var p = new LevelSetParams(
            Nu: l.GetProperty("nu").GetDouble(), CflSafety: l.GetProperty("cflSafety").GetDouble(), CflGuard: l.GetProperty("cflGuard").GetDouble(), RosMaxMs: l.GetProperty("rosMaxMs").GetDouble(),
            BandCells: l.GetProperty("bandCells").GetInt32(), FarCells: l.GetProperty("farCells").GetInt32(), LazyPrepareCells: l.GetProperty("lazyPrepareCells").GetDouble(),
            ReinitEvery: l.GetProperty("reinitEvery").GetInt32(), BurntExtension: l.GetProperty("burntExtension").GetBoolean(),
            BurntExtensionMaxExtraCells: l.GetProperty("burntExtensionMaxExtraCells").GetDouble(), SweepIterations: l.GetProperty("sweepIterations").GetInt32(), NormalEps: l.GetProperty("normalEps").GetDouble());
        return new Meta(g.GetProperty("nx").GetInt32(), g.GetProperty("ny").GetInt32(), g.GetProperty("cellSize").GetDouble(), p, py.GetProperty("k").GetDouble(), py.GetProperty("max").GetDouble());
    }

    static string Arr(JsonElement c, string role) => c.GetProperty("arrays").GetProperty(role).GetString()!;
    static bool Has(JsonElement c, string role) => c.GetProperty("arrays").TryGetProperty(role, out _);

    // ── the recipes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    static void PoisonBand(float[] arr, int[] band, int count, int nanMod, int nanOff, int negMod, int negOff)
    {
        for (int a = 0; a < count; a++)
        {
            int k = band[a];
            if (nanMod > 0 && a % nanMod == nanOff) arr[k] = float.NaN;
            if (negMod > 0 && a % negMod == negOff) arr[k] = -0.0f;
        }
    }

    static void PoisonBand(double[] arr, int[] band, int count, int nanMod, int nanOff, int negMod, int negOff)
    {
        for (int a = 0; a < count; a++)
        {
            int k = band[a];
            if (nanMod > 0 && a % nanMod == nanOff) arr[k] = double.NaN;
            if (negMod > 0 && a % negMod == negOff) arr[k] = -0.0;
        }
    }

    /// <summary>The replay hook: the six coefficients the REAL hook wrote for each cell it was asked about, and the prepStamp, for every cell; only the prepStamp for a cell the real call did not ask about.</summary>
    public sealed class ReplayHooks : ILevelSetHooks
    {
        readonly LevelSetCore _ls;
        readonly int[] _index;
        readonly float[] _vals;
        public readonly List<int> Seq = [];
        public readonly List<double> Arrivals = [];

        public ReplayHooks(LevelSetCore ls, int[] hookK, float[] hookV)
        {
            _ls = ls;
            _vals = hookV;
            _index = new int[ls.N];
            Array.Fill(_index, -1);
            for (int i = 0; i < hookK.Length; i++) _index[hookK[i]] = i;
        }

        public void EnsureSpeed(int k)
        {
            Seq.Add(k);
            int i = _index[k];
            if (i >= 0)
            {
                _ls.SA2[k] = _vals[6 * i]; _ls.SB2[k] = _vals[6 * i + 1]; _ls.SC[k] = _vals[6 * i + 2];
                _ls.SEx[k] = _vals[6 * i + 3]; _ls.SEy[k] = _vals[6 * i + 4]; _ls.SVls[k] = _vals[6 * i + 5];
            }
            _ls.PrepStamp[k] = _ls.Stamp;
        }

        public void OnArrival(int k, double tA, double r, double nx, double ny)
        {
            Arrivals.Add(k); Arrivals.Add(tA); Arrivals.Add(r); Arrivals.Add(nx); Arrivals.Add(ny);
        }

        /// <summary>The cells the hook was asked about, to put their prepStamp back for a repeated timing run.</summary>
        public int[] AskedCells() => [.. Seq];
    }

    public static (LevelSetCore Ls, ReplayHooks Hooks) BuildLs(IFastData data, Meta meta, JsonElement c, string variant)
    {
        var ls = new LevelSetCore(meta.Nx, meta.Ny, meta.CellSize, meta.P);
        int count = c.GetProperty("count").GetInt32();
        double[] D(string role) => data.F64(Arr(c, role));
        float[] F(string role) => data.F32(Arr(c, role));
        Array.Copy(D("phi"), ls.Phi, ls.N);
        Array.Copy(Has(c, "phiS") ? D("phiS") : D("phi"), ls.PhiS, ls.N);
        Array.Copy(F("sA2"), ls.SA2, ls.N); Array.Copy(F("sB2"), ls.SB2, ls.N); Array.Copy(F("sC"), ls.SC, ls.N); Array.Copy(F("sEx"), ls.SEx, ls.N); Array.Copy(F("sEy"), ls.SEy, ls.N);
        Array.Copy(F("sVls"), ls.SVls, ls.N); Array.Copy(F("sJun"), ls.SJun, ls.N); Array.Copy(F("sBurnt"), ls.SBurnt, ls.N); Array.Copy(F("sTx"), ls.STx, ls.N); Array.Copy(F("sTy"), ls.STy, ls.N);
        Array.Copy(data.I32(Arr(c, "prepStamp")), ls.PrepStamp, ls.N);
        int[] band = data.I32(Arr(c, "band"));
        Array.Copy(band, ls.Band, count);
        ls.BandCount = count;
        if (Has(c, "inBand")) Array.Copy(data.U8(Arr(c, "inBand")), ls.InBand, ls.N);
        if (Has(c, "touched")) Array.Copy(data.U8(Arr(c, "touched")), ls.Touched, ls.N);
        ls.Stamp = c.GetProperty("stamp").GetInt32();
        ls.Lazy = c.GetProperty("lazy").GetBoolean();
        ls.SubCount = c.GetProperty("subCount").GetInt32();
        if (variant == "nan-src")
        {
            PoisonBand(ls.Phi, ls.Band, count, 13, 3, 17, 5);
            if (Has(c, "phiS")) PoisonBand(ls.PhiS, ls.Band, count, 13, 3, 17, 5);
            else Array.Copy(ls.Phi, ls.PhiS, ls.N);
        }
        else if (variant == "nan-coef")
        {
            PoisonBand(ls.SA2, ls.Band, count, 41, 4, 29, 6);
            PoisonBand(ls.SEx, ls.Band, count, 37, 2, 0, 0);
            PoisonBand(ls.SVls, ls.Band, count, 53, 7, 31, 9);
            PoisonBand(ls.STx, ls.Band, count, 43, 1, 0, 0);
            PoisonBand(ls.SBurnt, ls.Band, count, 47, 8, 0, 0);
        }
        else if (variant != "plain") throw new ArgumentException("unknown variant " + variant);
        int[] hookK = [];
        float[] hookV = [];
        if (c.TryGetProperty("hook", out JsonElement hk) && hk.ValueKind == JsonValueKind.Object)
        {
            hookK = data.I32(hk.GetProperty("k").GetString()!);
            hookV = data.F32(hk.GetProperty("vals").GetString()!);
        }
        var hooks = new ReplayHooks(ls, hookK, hookV);
        ls.Hooks = hooks;
        return (ls, hooks);
    }

    // ── level set: evaluate ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

    public static SortedDictionary<string, string> RunEvaluate(IFastData data, Meta meta, JsonElement c, string variant, KernelExec exec, int minParallelBand = -1)
    {
        var (ls, hooks) = BuildLs(data, meta, c, variant);
        if (minParallelBand >= 0) ls.MinParallelBand = minParallelBand;
        int count = ls.BandCount;
        string mode = c.GetProperty("mode").GetString()!;
        double[] src = c.GetProperty("srcField").GetString() == "phiS" ? ls.PhiS : ls.Phi;
        var o = new double[count];
        double maxC = ls.Evaluate(src, mode == "bound" ? null : o, mode != "e2", exec);
        var r = new SortedDictionary<string, string> { ["maxC"] = Bits(maxC) };
        if (mode != "bound") r["out"] = Hash(o);
        if (mode == "e1")
        {
            r["r1"] = Hash(ls.R1.AsSpan(0, count));
            r["n1x"] = Hash(ls.N1x.AsSpan(0, count));
            r["n1y"] = Hash(ls.N1y.AsSpan(0, count));
            r["hookSeq"] = Hash(hooks.Seq.ToArray());
            r["hookCount"] = hooks.Seq.Count.ToString();
            r["prep"] = Hash(ls.PrepStamp);
            var coef = new float[6 * ls.N];
            Array.Copy(ls.SA2, 0, coef, 0, ls.N); Array.Copy(ls.SB2, 0, coef, ls.N, ls.N); Array.Copy(ls.SC, 0, coef, 2 * ls.N, ls.N);
            Array.Copy(ls.SEx, 0, coef, 3 * ls.N, ls.N); Array.Copy(ls.SEy, 0, coef, 4 * ls.N, ls.N); Array.Copy(ls.SVls, 0, coef, 5 * ls.N, ls.N);
            r["coef"] = Hash(coef);
        }
        return r;
    }

    // ── level set: reinit ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    static string BoxHash(float[] a, int nx, (int I0, int I1, int J0, int J1) b)
    {
        var o = new float[(b.I1 - b.I0 + 1) * (b.J1 - b.J0 + 1)];
        int p = 0;
        for (int j = b.J0; j <= b.J1; j++) for (int i = b.I0; i <= b.I1; i++) o[p++] = a[j * nx + i];
        return Hash(o);
    }

    static string BoxHash(double[] a, int nx, (int I0, int I1, int J0, int J1) b)
    {
        var o = new double[(b.I1 - b.I0 + 1) * (b.J1 - b.J0 + 1)];
        int p = 0;
        for (int j = b.J0; j <= b.J1; j++) for (int i = b.I0; i <= b.I1; i++) o[p++] = a[j * nx + i];
        return Hash(o);
    }

    static string BoxHash(byte[] a, int nx, (int I0, int I1, int J0, int J1) b)
    {
        var o = new byte[(b.I1 - b.I0 + 1) * (b.J1 - b.J0 + 1)];
        int p = 0;
        for (int j = b.J0; j <= b.J1; j++) for (int i = b.I0; i <= b.I1; i++) o[p++] = a[j * nx + i];
        return Hash(o);
    }

    public static SortedDictionary<string, string> ReinitHashes(LevelSetCore ls, bool wide)
    {
        var box = ls.Box;
        int bc = ls.BandCount;
        return new SortedDictionary<string, string>
        {
            ["box"] = $"{box.I0},{box.I1},{box.J0},{box.J1}",
            ["phi"] = Hash(ls.Phi),
            ["phiS"] = Hash(ls.PhiS),
            ["bandCount"] = bc.ToString(),
            ["band"] = Hash(ls.Band.AsSpan(0, bc)),
            ["inBand"] = Hash(ls.InBand),
            ["touched"] = Hash(ls.Touched),
            ["dist"] = wide ? BoxHash(ls.DistWide, ls.Nx, box) : BoxHash(ls.Dist, ls.Nx, box),
            ["fixed"] = BoxHash(ls.Fixed, ls.Nx, box),
        };
    }

    public static SortedDictionary<string, string> RunReinit(IFastData data, Meta meta, JsonElement c, string variant, bool wide, KernelExec exec, int minParallelBox = -1)
    {
        var (ls, _) = BuildLs(data, meta, c, variant);
        if (minParallelBox >= 0) ls.MinParallelBox = minParallelBox;
        if (wide) ls.ReinitWide(exec); else ls.Reinit(exec);
        return ReinitHashes(ls, wide);
    }

    // ── level set: a sequence of sub-steps ───────────────────────────────────────────────────────────────────────────────────────────────

    public static SortedDictionary<string, string> RunAdvance(IFastData data, Meta meta, JsonElement c, KernelExec exec, int minParallelBand = -1, int minParallelBox = -1)
    {
        var (ls, hooks) = BuildLs(data, meta, c, "plain");
        if (minParallelBand >= 0) ls.MinParallelBand = minParallelBand;
        if (minParallelBox >= 0) ls.MinParallelBox = minParallelBox;
        int steps = c.GetProperty("steps").GetInt32();
        double dtMax = c.GetProperty("dtMax").GetDouble();
        double t = c.GetProperty("t").GetDouble();
        var r = new SortedDictionary<string, string>();
        for (int s = 0; s < steps; s++)
        {
            double dt = ls.Advance(t, dtMax, exec);
            t += dt;
            r[$"steps.{s}|dt"] = Bits(dt);
            r[$"steps.{s}|phi"] = Hash(ls.Phi);
            r[$"steps.{s}|bandCount"] = ls.BandCount.ToString();
            r[$"steps.{s}|band"] = Hash(ls.Band.AsSpan(0, ls.BandCount));
        }
        r["arrivals"] = Hash(hooks.Arrivals.ToArray());
        r["arrivalCount"] = (hooks.Arrivals.Count / 5).ToString();
        r["hookSeq"] = Hash(hooks.Seq.ToArray());
        r["sBurnt"] = Hash(ls.SBurnt);
        r["subCount"] = ls.SubCount.ToString();
        return r;
    }

    // ── pyrogenic ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    public static float[] PyroInput(float[] q, string variant)
    {
        var c = (float[])q.Clone();
        switch (variant)
        {
            case "plain": return c;
            case "nan-negzero-inf":
                for (int i = 3; i < c.Length; i += 331) c[i] = float.NaN;
                for (int i = 10; i < c.Length; i += 211) c[i] = -0.0f;
                for (int i = 5; i < c.Length; i += 997) c[i] = float.PositiveInfinity;
                return c;
            case "none": return new float[c.Length];
            case "single":
                var s = new float[c.Length];
                s[(c.Length >> 1) + 37] = 81f;
                return s;
            default: throw new ArgumentException("unknown q variant " + variant);
        }
    }

    public static SortedDictionary<string, string> PyroTables(PyrogenicKernel k)
    {
        var (sx, invNx, lamX) = k.Tables(false);
        var (sy, invNy, lamY) = k.Tables(true);
        return new SortedDictionary<string, string> { ["sx"] = Hash(sx), ["invNx"] = Hash(invNx), ["lamX"] = Hash(lamX), ["sy"] = Hash(sy), ["invNy"] = Hash(invNy), ["lamY"] = Hash(lamY) };
    }

    public static PyrogenicKernel NewPyro(Meta meta, JsonElement c) =>
        new(c.GetProperty("fireNx").GetInt32(), c.GetProperty("fireNy").GetInt32(), c.GetProperty("cellSize").GetDouble(), meta.PyroK, meta.PyroMax);

    public static SortedDictionary<string, string> PyroHashes(PyrogenicKernel k) =>
        new() { ["psi"] = Hash(k.Psi), ["up"] = Hash(k.Up), ["vp"] = Hash(k.Vp), ["gx"] = Hash(k.Gx), ["gy"] = Hash(k.Gy) };

    public static SortedDictionary<string, string> RunPyro(IFastData data, Meta meta, JsonElement c, string variant, KernelExec exec)
    {
        var k = NewPyro(meta, c);
        k.Solve(PyroInput(data.F32(c.GetProperty("q").GetString()!), variant), exec);
        return PyroHashes(k);
    }

    // ── the whole fixture ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every case and variant of the header's <c>cases</c> on one form, as flat key to hash maps, key = "caseId|variant|(float|wide|)". Fs.Wasm calls this and returns it as JSON; Fs.Tests
    /// uses the finer entry points and compares per case.
    /// </summary>
    public static SortedDictionary<string, string> RunAll(IFastData data, JsonElement header, KernelExec exec, Func<string, bool>? kindFilter = null, bool forceChunks = true)
    {
        int force = forceChunks ? 0 : -1;
        Meta meta = ReadMeta(header.GetProperty("meta"));
        var all = new SortedDictionary<string, string>();
        void Add(string prefix, SortedDictionary<string, string> r) { foreach (var kv in r) all[prefix + "|" + kv.Key] = kv.Value; }
        foreach (JsonElement c in header.GetProperty("cases").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!, kind = c.GetProperty("kind").GetString()!;
            if (kindFilter is not null && !kindFilter(kind)) continue;
            if (kind == "evaluate") foreach (string v in new[] { "plain", "nan-src", "nan-coef" }) Add($"{id}|{v}", RunEvaluate(data, meta, c, v, exec, force));
            else if (kind == "reinit")
                foreach (string v in new[] { "plain", "nan-src", "nan-coef" })
                {
                    Add($"{id}|{v}|float", RunReinit(data, meta, c, v, false, exec, force));
                    Add($"{id}|{v}|wide", RunReinit(data, meta, c, v, true, exec, force));
                }
            else if (kind == "advance") Add($"{id}|plain", RunAdvance(data, meta, c, exec, force, force));
            else
            {
                Add($"{id}|tables", PyroTables(NewPyro(meta, c)));
                foreach (string v in new[] { "plain", "nan-negzero-inf", "none", "single" }) Add($"{id}|{v}", RunPyro(data, meta, c, v, exec));
            }
        }
        return all;
    }

    /// <summary>The golden header's expected results, flattened to the same keys as <see cref="RunAll"/>.</summary>
    public static SortedDictionary<string, string> Expected(JsonElement header, Func<string, bool>? kindFilter = null)
    {
        var all = new SortedDictionary<string, string>();
        foreach (JsonElement c in header.GetProperty("cases").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!, kind = c.GetProperty("kind").GetString()!;
            if (kindFilter is not null && !kindFilter(kind)) continue;
            if (kind == "pyro") Flatten($"{id}|tables", c.GetProperty("tables"), all);
            foreach (JsonElement v in c.GetProperty("variants").EnumerateArray())
            {
                string name = v.GetProperty("name").GetString()!;
                JsonElement r = v.GetProperty("result");
                if (kind == "reinit") { Flatten($"{id}|{name}|float", r.GetProperty("float"), all); Flatten($"{id}|{name}|wide", r.GetProperty("wide"), all); }
                else Flatten($"{id}|{name}", r, all);
            }
        }
        return all;
    }

    // advance cases have no "variants" in the same shape: handled by the caller through ExpectedAdvance
    public static void Flatten(string prefix, JsonElement e, SortedDictionary<string, string> into)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (JsonProperty p in e.EnumerateObject()) Flatten(prefix + "|" + p.Name, p.Value, into);
                break;
            case JsonValueKind.Array:
                int i = 0;
                foreach (JsonElement x in e.EnumerateArray()) Flatten(prefix + "." + (i++), x, into);
                break;
            case JsonValueKind.String: into[prefix] = e.GetString()!; break;
            default: into[prefix] = e.GetRawText(); break;
        }
    }
}
