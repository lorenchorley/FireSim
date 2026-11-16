using System.Security.Cryptography;
using System.Text.Json;
using Fs.Kernel.Air;

namespace Fs.Tests;

/// <summary>
/// Card T1.4a test data. Two sources: (1) the fixtures made by Fs.Bench/ts/air/capture.ts from the real TypeScript solver (a folder with header.json + data.bin, found
/// through <c>FS_AIR_FIXTURES</c>, default <c>$FIRESIM_SCRATCH/T1.4a</c>) whose output hashes the real, unmodified TypeScript kernels produced, committed as the small
/// golden files Fs.Tests/golden/air-*.json; (2) synthetic grids from a fixed generator, for the checks of one form against another (every tail length).
/// </summary>
static class AirTestData
{
    public static string FixturesRoot()
    {
        string? e = Environment.GetEnvironmentVariable("FS_AIR_FIXTURES");
        if (!string.IsNullOrEmpty(e)) return e;
        string? s = Environment.GetEnvironmentVariable("FIRESIM_SCRATCH");
        return s is null ? "" : Path.Combine(s, "T1.4a");
    }

    /// <summary>SHA-256 (first 32 hex digits) of the raw bytes with every NaN replaced by the canonical quiet NaN, -0 kept: the hash capture.ts writes.</summary>
    public static string Hash(double[] a)
    {
        var c = new double[a.Length];
        for (int i = 0; i < a.Length; i++) c[i] = double.IsNaN(a[i]) ? BitConverter.Int64BitsToDouble(0x7ff8000000000000L) : a[i];
        return Hex(SHA256.HashData(System.Runtime.InteropServices.MemoryMarshal.AsBytes<double>(c)));
    }

    public static string Hash(float[] a)
    {
        var c = new float[a.Length];
        for (int i = 0; i < a.Length; i++) c[i] = float.IsNaN(a[i]) ? BitConverter.Int32BitsToSingle(0x7fc00000) : a[i];
        return Hex(SHA256.HashData(System.Runtime.InteropServices.MemoryMarshal.AsBytes<float>(c)));
    }

    static string Hex(byte[] h) => Convert.ToHexStringLower(h.AsSpan(0, 16));

    /// <summary>The edge-case recipe of capture.ts <c>poison</c>: NaN at every 331st element from salt, then -0 at every 211th from salt + 7.</summary>
    public static void Poison(double[] a, int salt)
    {
        for (int i = salt; i < a.Length; i += 331) a[i] = double.NaN;
        for (int i = salt + 7; i < a.Length; i += 211) a[i] = -0.0;
    }

    public static void Poison(float[] a, int salt)
    {
        for (int i = salt; i < a.Length; i += 331) a[i] = float.NaN;
        for (int i = salt + 7; i < a.Length; i += 211) a[i] = -0.0f;
    }

    /// <summary>Bit equality with every NaN equal to every NaN.</summary>
    public static bool SameBits(float[] a, float[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++)
        {
            bool na = float.IsNaN(a[i]), nb = float.IsNaN(b[i]);
            if (na != nb || (!na && BitConverter.SingleToInt32Bits(a[i]) != BitConverter.SingleToInt32Bits(b[i]))) return false;
        }
        return true;
    }

    public static bool SameBits(double[] a, double[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++)
        {
            bool na = double.IsNaN(a[i]), nb = double.IsNaN(b[i]);
            if (na != nb || (!na && BitConverter.DoubleToInt64Bits(a[i]) != BitConverter.DoubleToInt64Bits(b[i]))) return false;
        }
        return true;
    }

    // ───────────────────────────── the fixture ─────────────────────────────

    public sealed class Fixture
    {
        public readonly string Name;
        readonly byte[] _data;
        readonly Dictionary<string, (string Type, int Length, long Offset)> _arrays = [];
        public readonly JsonElement Header;
        public AirGrid Grid { get; }
        public bool TopActive { get; }

        Fixture(string name, byte[] data, JsonElement header)
        {
            Name = name; _data = data; Header = header;
            foreach (JsonElement a in header.GetProperty("arrays").EnumerateArray())
                _arrays[a.GetProperty("name").GetString()!] = (a.GetProperty("type").GetString()!, a.GetProperty("length").GetInt32(), a.GetProperty("byteOffset").GetInt64());
            JsonElement g = header.GetProperty("grid");
            Grid = new AirGrid(g.GetProperty("nx").GetInt32(), g.GetProperty("ny").GetInt32(), g.GetProperty("nz").GetInt32(), g.GetProperty("dx").GetDouble(), g.GetProperty("Hp").GetDouble(),
                F64("grid.dzeta"), F64("grid.dzetaW"), F64("grid.J"), F64("grid.Ju"), F64("grid.Jv"), F64("grid.zsx"), F64("grid.zsy"), F64("solver.fzeta"));
            TopActive = header.GetProperty("topActive").GetBoolean();
        }

        public static Fixture? TryLoad(string name)
        {
            string dir = Path.Combine(FixturesRoot(), name);
            if (!File.Exists(Path.Combine(dir, "header.json")) || !File.Exists(Path.Combine(dir, "data.bin"))) return null;
            using JsonDocument doc = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(dir, "header.json")));
            return new Fixture(name, File.ReadAllBytes(Path.Combine(dir, "data.bin")), doc.RootElement.Clone());
        }

        public double[] F64(string n)
        {
            var (type, len, off) = _arrays[n];
            if (type != "float64") throw new InvalidOperationException($"{n} is {type}");
            var r = new double[len];
            Buffer.BlockCopy(_data, (int)off, r, 0, len * 8);
            return r;
        }

        public float[] F32(string n)
        {
            var (type, len, off) = _arrays[n];
            if (type != "float32") throw new InvalidOperationException($"{n} is {type}");
            var r = new float[len];
            Buffer.BlockCopy(_data, (int)off, r, 0, len * 4);
            return r;
        }

        public byte[] U8(string n)
        {
            var (type, len, off) = _arrays[n];
            if (type != "uint8") throw new InvalidOperationException($"{n} is {type}");
            var r = new byte[len];
            Buffer.BlockCopy(_data, (int)off, r, 0, len);
            return r;
        }

        public bool IsF32(string n) => _arrays[n].Type == "float32";

        public AirLevel Level(int l)
        {
            JsonElement d = Header.GetProperty("levels")[l];
            int nx = d.GetProperty("nx").GetInt32(), ny = d.GetProperty("ny").GetInt32(), nz = d.GetProperty("nz").GetInt32();
            return new AirLevel(nx, ny, nz)
            {
                Cx = F32($"level{l}.cx"), Cy = F32($"level{l}.cy"), Cz = F32($"level{l}.cz"), TInv = F32($"level{l}.tInv"), TC = F32($"level{l}.tC"),
            };
        }

        public AirMasks RealMasks(bool? top = null) => new(U8("masks.activeU"), U8("masks.activeV"), top ?? TopActive);

        public AirMasks RecipeMasks(bool top)
        {
            var au = new byte[Grid.NU];
            var av = new byte[Grid.NV];
            for (int f = 0; f < au.Length; f++) au[f] = (byte)(f % 3 == 0 ? 0 : 1);
            for (int f = 0; f < av.Length; f++) av[f] = (byte)(f % 5 == 0 ? 0 : 1);
            return new AirMasks(au, av, top);
        }
    }

    /// <summary>One golden case, run on a form: the hashes of its outputs by role, and of its inputs by role (after the poison recipe).</summary>
    public static (Dictionary<string, string> Outputs, Dictionary<string, string> Inputs) RunCase(Fixture fx, JsonElement c, AirExec exec)
    {
        string kernel = c.GetProperty("kernel").GetString()!;
        JsonElement p = c.GetProperty("params");
        var outs = new Dictionary<string, string>();
        var ins = new Dictionary<string, string>();
        var inputs = c.GetProperty("inputs").EnumerateArray().ToList();
        int? Salt(JsonElement i) => i.TryGetProperty("poison", out JsonElement s) && s.ValueKind == JsonValueKind.Number ? s.GetInt32() : null;
        double[] D(JsonElement i)
        {
            double[] a = fx.F64(i.GetProperty("array").GetString()!);
            if (Salt(i) is int s) Poison(a, s);
            ins[i.GetProperty("role").GetString()!] = Hash(a);
            return a;
        }
        float[] F(JsonElement i)
        {
            float[] a = fx.F32(i.GetProperty("array").GetString()!);
            if (Salt(i) is int s) Poison(a, s);
            ins[i.GetProperty("role").GetString()!] = Hash(a);
            return a;
        }
        switch (kernel)
        {
            case "gradient":
            {
                bool top = p.GetProperty("topActive").GetBoolean();
                AirMasks masks = p.GetProperty("maskMode").GetString() == "real" ? fx.RealMasks(top) : fx.RecipeMasks(top);
                var ops = new AirOps(fx.Grid, masks);
                ops.Gradient(D(inputs[0]), exec);
                outs["gu"] = Hash(ops.Gu); outs["gv"] = Hash(ops.Gv); outs["gw"] = Hash(ops.Gw);
                break;
            }
            case "divergence":
            {
                var ops = new AirOps(fx.Grid, fx.RealMasks());
                var o = new double[fx.Grid.N];
                double su = p.GetProperty("scaleU").GetDouble(), sw = p.GetProperty("scaleW").GetDouble();
                if (fx.IsF32(inputs[0].GetProperty("array").GetString()!)) ops.Divergence(F(inputs[0]), F(inputs[1]), F(inputs[2]), o, su, sw, exec);
                else ops.Divergence(D(inputs[0]), D(inputs[1]), D(inputs[2]), o, su, sw, exec);
                outs["out"] = Hash(o);
                break;
            }
            case "advect":
            {
                int nxF = p.GetProperty("nxF").GetInt32(), nyF = p.GetProperty("nyF").GetInt32(), nzF = p.GetProperty("nzF").GetInt32();
                bool dual = p.GetProperty("dual").GetBoolean();
                float[] dx = F(inputs[0]), dy = F(inputs[1]), dz = F(inputs[2]), src = F(inputs[3]);
                float[]? src2 = dual ? F(inputs[4]) : null;
                var dst = new float[nxF * nyF * nzF];
                float[]? dst2 = dual ? new float[dst.Length] : null;
                new AirAdvect(fx.Grid).Run(dx, dy, dz, src, dst, nxF, nyF, nzF, p.GetProperty("ox").GetDouble(), p.GetProperty("oy").GetDouble(), p.GetProperty("oz").GetDouble(), src2, dst2, exec);
                outs["dst"] = Hash(dst);
                if (dual) outs["dst2"] = Hash(dst2!);
                break;
            }
            case "relax":
            {
                AirLevel lv = fx.Level(p.GetProperty("level").GetInt32());
                float[] b = F(inputs[0]), x = F(inputs[1]);
                new AirRelax { MinParallelCells = 0 }.Run(lv.WithBX(b, x), p.GetProperty("sweeps").GetInt32(), p.GetProperty("reverse").GetBoolean(), exec);
                outs["x"] = Hash(x);
                break;
            }
            default: throw new InvalidOperationException(kernel);
        }
        return (outs, ins);
    }

    public static JsonElement Golden(string name)
    {
        string path = Path.Combine(AppContext.BaseDirectory, "golden", $"air-{name}.json");
        using JsonDocument doc = JsonDocument.Parse(File.ReadAllBytes(path));
        return doc.RootElement.Clone();
    }

    // ───────────────────────────── synthetic data ─────────────────────────────

    /// <summary>A fixed generator: xorshift64*, values in [0, 1).</summary>
    public sealed class Rng(ulong seed)
    {
        ulong _s = seed * 0x9E3779B97F4A7C15UL + 0x1234567UL;
        public double Next()
        {
            _s ^= _s >> 12; _s ^= _s << 25; _s ^= _s >> 27;
            return (_s * 0x2545F4914F6CDD1DUL >> 11) * (1.0 / 9007199254740992.0);
        }
        public double Range(double lo, double hi) => lo + (hi - lo) * Next();
    }

    public static AirGrid SyntheticGrid(int nx, int ny, int nz, ulong seed)
    {
        var r = new Rng(seed);
        double[] Arr(int n, double lo, double hi) { var a = new double[n]; for (int i = 0; i < n; i++) a[i] = r.Range(lo, hi); return a; }
        return new AirGrid(nx, ny, nz, 100, 3000, Arr(nz, 20, 200), Arr(nz + 1, 20, 200), Arr(nx * ny, 0.7, 1.3), Arr((nx + 1) * ny, 0.7, 1.3), Arr(nx * (ny + 1), 0.7, 1.3),
            Arr(nx * ny, -0.4, 0.4), Arr(nx * ny, -0.4, 0.4), Arr(nz + 1, 0, 1));
    }

    public static float[] RandF(int n, ulong seed, double lo, double hi)
    {
        var r = new Rng(seed);
        var a = new float[n];
        for (int i = 0; i < n; i++) a[i] = (float)r.Range(lo, hi);
        return a;
    }

    public static double[] RandD(int n, ulong seed, double lo, double hi)
    {
        var r = new Rng(seed);
        var a = new double[n];
        for (int i = 0; i < n; i++) a[i] = r.Range(lo, hi);
        return a;
    }

    public static AirLevel SyntheticLevel(int nx, int ny, int nz, ulong seed)
    {
        var lv = new AirLevel(nx, ny, nz)
        {
            Cx = RandF((nx + 1) * ny * nz, seed + 1, 0, 1), Cy = RandF(nx * (ny + 1) * nz, seed + 2, 0, 1), Cz = RandF(nx * ny * (nz + 1), seed + 3, 0, 1),
            TInv = RandF(nx * ny * nz, seed + 4, 0.1, 2), TC = RandF(nx * ny * nz, seed + 5, 0, 0.5),
            B = RandF(nx * ny * nz, seed + 6, -1, 1), X = RandF(nx * ny * nz, seed + 7, -1, 1),
        };
        return lv;
    }
}
