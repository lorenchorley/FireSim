using System.Text.Json;
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Configs;
using Fs.Kernel.Air;

namespace Fs.Bench;

/// <summary>The captured real state (Fs.Bench/ts/air/capture.ts), enough to run the four kernels: the same files Fs.Tests reads.</summary>
public sealed class AirBenchFixture
{
    readonly byte[] _data;
    readonly Dictionary<string, (string Type, int Length, long Offset)> _arrays = [];
    public readonly JsonElement Header;
    public readonly AirGrid Grid;
    public readonly bool TopActive;

    AirBenchFixture(byte[] data, JsonElement header)
    {
        _data = data; Header = header;
        foreach (JsonElement a in header.GetProperty("arrays").EnumerateArray())
            _arrays[a.GetProperty("name").GetString()!] = (a.GetProperty("type").GetString()!, a.GetProperty("length").GetInt32(), a.GetProperty("byteOffset").GetInt64());
        JsonElement g = header.GetProperty("grid");
        Grid = new AirGrid(g.GetProperty("nx").GetInt32(), g.GetProperty("ny").GetInt32(), g.GetProperty("nz").GetInt32(), g.GetProperty("dx").GetDouble(), g.GetProperty("Hp").GetDouble(),
            F64("grid.dzeta"), F64("grid.dzetaW"), F64("grid.J"), F64("grid.Ju"), F64("grid.Jv"), F64("grid.zsx"), F64("grid.zsy"), F64("solver.fzeta"));
        TopActive = header.GetProperty("topActive").GetBoolean();
    }

    public static AirBenchFixture Load(string name)
    {
        string root = Environment.GetEnvironmentVariable("FS_AIR_FIXTURES") ?? Path.Combine(Environment.GetEnvironmentVariable("FIRESIM_SCRATCH") ?? "", "T1.4a");
        string dir = Path.Combine(root, name);
        using JsonDocument doc = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(dir, "header.json")));
        return new AirBenchFixture(File.ReadAllBytes(Path.Combine(dir, "data.bin")), doc.RootElement.Clone());
    }

    public double[] F64(string n) { var (_, len, off) = _arrays[n]; var r = new double[len]; Buffer.BlockCopy(_data, (int)off, r, 0, len * 8); return r; }
    public float[] F32(string n) { var (_, len, off) = _arrays[n]; var r = new float[len]; Buffer.BlockCopy(_data, (int)off, r, 0, len * 4); return r; }
    public byte[] U8(string n) { var (_, len, off) = _arrays[n]; var r = new byte[len]; Buffer.BlockCopy(_data, (int)off, r, 0, len); return r; }

    public AirLevel Level(int l)
    {
        JsonElement d = Header.GetProperty("levels")[l];
        return new AirLevel(d.GetProperty("nx").GetInt32(), d.GetProperty("ny").GetInt32(), d.GetProperty("nz").GetInt32())
        {
            Cx = F32($"level{l}.cx"), Cy = F32($"level{l}.cy"), Cz = F32($"level{l}.cz"), TInv = F32($"level{l}.tInv"), TC = F32($"level{l}.tC"),
        };
    }

    public AirMasks Masks() => new(U8("masks.activeU"), U8("masks.activeV"), TopActive);
}

/// <summary>
/// T1.4a: the standard tier's air kernels, one operation each, on the real state of the standard tier at 900 s: <c>RelaxCycle</c> the six relax calls of one V(2,2)
/// preconditioner (every level, each from its recorded input), <c>Gradient</c>, <c>DivergenceF32</c> (project's call, the atmosphere's u, v, w), <c>DivergenceF64</c>
/// (applyFull's call), <c>AdvectStep</c> the four advect calls of one atmosphere step (u, v, w, then th with the smoke field). Forms: scalar, Vector128, Parallel.For
/// on 4 threads (scalar body), Parallel.For on 4 threads with the vector body. The TypeScript is timed by Fs.Bench/ts/air/bench.ts on the same files; ratios are made by
/// <c>Fs.Bench air-merge</c>. The relax operation restores x from the recorded input before each call (a copy), in both languages.
/// </summary>
[MemoryDiagnoser]
[JsonExporterAttribute.Full]
[GroupBenchmarksBy(BenchmarkLogicalGroupRule.ByCategory, BenchmarkLogicalGroupRule.ByParams)]
[CategoriesColumn]
public class AirBench
{
    [Params("fx-k3std", "fx-k6high")]
    public string Fixture { get; set; } = "fx-k3std";

    AirBenchFixture _fx = null!;
    AirGrid _g = null!;
    AirOps _ops = null!;
    AirRelax _relax = null!;
    AirAdvect _adv = null!;
    double[] _phi = null!, _out = null!, _gu = null!, _gv = null!, _gw = null!;
    float[] _u = null!, _v = null!, _w = null!, _th = null!, _sm = null!, _dx = null!, _dy = null!, _dz = null!;
    float[] _du = null!, _dv = null!, _dw = null!, _dth = null!, _dsm = null!;
    (AirLevel Level, float[] XIn, float[] XBuf, int Sweeps, bool Reverse)[] _calls = null!;

    static readonly AirExec Par4 = AirExec.Par(4), ParVec4 = AirExec.ParVec(4);

    [GlobalSetup]
    public void Setup()
    {
        _fx = AirBenchFixture.Load(Fixture);
        _g = _fx.Grid;
        _ops = new AirOps(_g, _fx.Masks());
        _relax = new AirRelax();
        _adv = new AirAdvect(_g);
        int nx = _g.Nx, ny = _g.Ny, nz = _g.Nz;
        _phi = _fx.F64("field.phi"); _out = new double[_g.N];
        _gu = _fx.F64("derived.gu"); _gv = _fx.F64("derived.gv"); _gw = _fx.F64("derived.gw");
        _u = _fx.F32("field.u"); _v = _fx.F32("field.v"); _w = _fx.F32("field.w"); _th = _fx.F32("field.th"); _sm = _fx.F32("field.sm");
        _dx = _fx.F32("derived.Dx"); _dy = _fx.F32("derived.Dy"); _dz = _fx.F32("derived.Dz");
        _du = new float[(nx + 1) * ny * nz]; _dv = new float[nx * (ny + 1) * nz]; _dw = new float[nx * ny * (nz + 1)]; _dth = new float[_g.N]; _dsm = new float[_g.N];
        var levels = Enumerable.Range(0, _fx.Header.GetProperty("levels").GetArrayLength()).Select(_fx.Level).ToArray();
        var rc = _fx.Header.GetProperty("relaxCalls").EnumerateArray().ToArray();
        _calls = new (AirLevel, float[], float[], int, bool)[rc.Length];
        for (int i = 0; i < rc.Length; i++)
        {
            int l = rc[i].GetProperty("level").GetInt32();
            float[] xIn = _fx.F32($"call{i}.x");
            _calls[i] = (levels[l].WithBX(_fx.F32($"call{i}.b"), new float[xIn.Length]), xIn, new float[xIn.Length], rc[i].GetProperty("sweeps").GetInt32(), rc[i].GetProperty("reverse").GetBoolean());
        }
    }

    double RelaxCycle(AirExec e)
    {
        foreach (var (lv, xIn, _, sweeps, reverse) in _calls)
        {
            Array.Copy(xIn, lv.X, xIn.Length);
            _relax.Run(lv, sweeps, reverse, e);
        }
        return _calls[0].Level.X[0];
    }

    double Gradient(AirExec e)
    {
        _ops.Gradient(_phi, e);
        return _ops.Gu[1];
    }

    double DivF32(AirExec e)
    {
        _ops.Divergence(_u, _v, _w, _out, 1, 1, e);
        return _out[1];
    }

    double DivF64(AirExec e)
    {
        _ops.Divergence(_gu, _gv, _gw, _out, 1, 1, e);
        return _out[1];
    }

    double AdvectStep(AirExec e)
    {
        int nx = _g.Nx, ny = _g.Ny, nz = _g.Nz;
        _adv.Run(_dx, _dy, _dz, _u, _du, nx + 1, ny, nz, 0.5, 0, 0, null, null, e);
        _adv.Run(_dx, _dy, _dz, _v, _dv, nx, ny + 1, nz, 0, 0.5, 0, null, null, e);
        _adv.Run(_dx, _dy, _dz, _w, _dw, nx, ny, nz + 1, 0, 0, 0.5, null, null, e);
        _adv.Run(_dx, _dy, _dz, _th, _dth, nx, ny, nz, 0, 0, 0, _sm, _dsm, e);
        return _dth[1];
    }

    [Benchmark(Baseline = true), BenchmarkCategory("relax")] public double Relax_Scalar() => RelaxCycle(AirExec.Scalar);
    [Benchmark, BenchmarkCategory("relax")] public double Relax_Vector() => RelaxCycle(AirExec.Vec);
    [Benchmark, BenchmarkCategory("relax")] public double Relax_Parallel4() => RelaxCycle(Par4);
    [Benchmark, BenchmarkCategory("relax")] public double Relax_ParallelVector4() => RelaxCycle(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("gradient")] public double Gradient_Scalar() => Gradient(AirExec.Scalar);
    [Benchmark, BenchmarkCategory("gradient")] public double Gradient_Vector() => Gradient(AirExec.Vec);
    [Benchmark, BenchmarkCategory("gradient")] public double Gradient_Parallel4() => Gradient(Par4);
    [Benchmark, BenchmarkCategory("gradient")] public double Gradient_ParallelVector4() => Gradient(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("divergenceF32")] public double DivergenceF32_Scalar() => DivF32(AirExec.Scalar);
    [Benchmark, BenchmarkCategory("divergenceF32")] public double DivergenceF32_Vector() => DivF32(AirExec.Vec);
    [Benchmark, BenchmarkCategory("divergenceF32")] public double DivergenceF32_Parallel4() => DivF32(Par4);
    [Benchmark, BenchmarkCategory("divergenceF32")] public double DivergenceF32_ParallelVector4() => DivF32(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("divergenceF64")] public double DivergenceF64_Scalar() => DivF64(AirExec.Scalar);
    [Benchmark, BenchmarkCategory("divergenceF64")] public double DivergenceF64_Vector() => DivF64(AirExec.Vec);
    [Benchmark, BenchmarkCategory("divergenceF64")] public double DivergenceF64_Parallel4() => DivF64(Par4);
    [Benchmark, BenchmarkCategory("divergenceF64")] public double DivergenceF64_ParallelVector4() => DivF64(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("advect")] public double Advect_Scalar() => AdvectStep(AirExec.Scalar);
    [Benchmark, BenchmarkCategory("advect")] public double Advect_Vector() => AdvectStep(AirExec.Vec);
    [Benchmark, BenchmarkCategory("advect")] public double Advect_Parallel4() => AdvectStep(Par4);
    [Benchmark, BenchmarkCategory("advect")] public double Advect_ParallelVector4() => AdvectStep(ParVec4);
}
