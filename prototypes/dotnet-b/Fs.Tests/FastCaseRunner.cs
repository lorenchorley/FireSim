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

    static bool s_noSystemSha;

    /// <summary>SHA-256: the platform's where it exists, else the managed one below (the browser's platform support for hashing is not something the check should depend on).</summary>
    public static byte[] Sha256(ReadOnlySpan<byte> data)
    {
        if (!s_noSystemSha)
        {
            try { return SHA256.HashData(data); }
            catch (PlatformNotSupportedException) { s_noSystemSha = true; }
        }
        return Sha256Managed(data);
    }

    static readonly uint[] K =
    [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    /// <summary>FIPS 180-4 SHA-256, managed (tested against the platform's in Fs.Tests).</summary>
    public static byte[] Sha256Managed(ReadOnlySpan<byte> data)
    {
        uint[] h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        long bits = (long)data.Length * 8;
        int padded = ((data.Length + 8) / 64 + 1) * 64;
        var m = new byte[padded];
        data.CopyTo(m);
        m[data.Length] = 0x80;
        for (int i = 0; i < 8; i++) m[padded - 1 - i] = (byte)(bits >> (8 * i));
        var w = new uint[64];
        for (int off = 0; off < padded; off += 64)
        {
            for (int i = 0; i < 16; i++) w[i] = (uint)(m[off + 4 * i] << 24 | m[off + 4 * i + 1] << 16 | m[off + 4 * i + 2] << 8 | m[off + 4 * i + 3]);
            for (int i = 16; i < 64; i++)
            {
                uint s0 = uint.RotateRight(w[i - 15], 7) ^ uint.RotateRight(w[i - 15], 18) ^ (w[i - 15] >> 3);
                uint s1 = uint.RotateRight(w[i - 2], 17) ^ uint.RotateRight(w[i - 2], 19) ^ (w[i - 2] >> 10);
                w[i] = w[i - 16] + s0 + w[i - 7] + s1;
            }
            uint a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
            for (int i = 0; i < 64; i++)
            {
                uint t1 = hh + (uint.RotateRight(e, 6) ^ uint.RotateRight(e, 11) ^ uint.RotateRight(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
                uint t2 = (uint.RotateRight(a, 2) ^ uint.RotateRight(a, 13) ^ uint.RotateRight(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
                hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
            }
            h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
        }
        var r = new byte[32];
        for (int i = 0; i < 8; i++) { r[4 * i] = (byte)(h[i] >> 24); r[4 * i + 1] = (byte)(h[i] >> 16); r[4 * i + 2] = (byte)(h[i] >> 8); r[4 * i + 3] = (byte)h[i]; }
        return r;
    }

    public static string Hash(ReadOnlySpan<double> a)
    {
        var c = new double[a.Length];
        for (int i = 0; i < a.Length; i++) c[i] = double.IsNaN(a[i]) ? BitConverter.Int64BitsToDouble(0x7ff8000000000000L) : a[i];
        return Hex(Sha256(System.Runtime.InteropServices.MemoryMarshal.AsBytes<double>(c)));
    }

    public static string Hash(ReadOnlySpan<float> a)
    {
        var c = new float[a.Length];
        for (int i = 0; i < a.Length; i++) c[i] = float.IsNaN(a[i]) ? BitConverter.Int32BitsToSingle(0x7fc00000) : a[i];
        return Hex(Sha256(System.Runtime.InteropServices.MemoryMarshal.AsBytes<float>(c)));
    }

    public static string Hash(ReadOnlySpan<int> a) => Hex(Sha256(System.Runtime.InteropServices.MemoryMarshal.AsBytes(a)));
    public static string Hash(ReadOnlySpan<byte> a) => Hex(Sha256(a));
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
        /// <summary>The cells the real call asked about (the benchmark puts their prepStamp back between calls). False for <see cref="Log"/> stops the sequence log (a timing loop would grow it without end).</summary>
        public readonly int[] HookCells;
        public bool Log = true;

        public ReplayHooks(LevelSetCore ls, int[] hookK, float[] hookV)
        {
            _ls = ls;
            HookCells = hookK;
            _vals = hookV;
            _index = new int[ls.N];
            Array.Fill(_index, -1);
            for (int i = 0; i < hookK.Length; i++) _index[hookK[i]] = i;
        }

        public void EnsureSpeed(int k)
        {
            if (Log) Seq.Add(k);
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
            if (Log) { Arrivals.Add(k); Arrivals.Add(tA); Arrivals.Add(r); Arrivals.Add(nx); Arrivals.Add(ny); }
        }
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
