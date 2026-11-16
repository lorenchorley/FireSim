using System.Text.Json;
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Configs;
using Fs.Kernel;
using Fs.Kernel.LevelSet;
using Fs.Tests;

namespace Fs.Bench;

/// <summary>The captured real frames of the fast tier (Fs.Bench/ts/fast/capture.ts): the same files Fs.Tests reads.</summary>
public sealed class FastBenchData : IFastData
{
    readonly byte[] _data;
    readonly Dictionary<string, (string Type, int Length, long Offset)> _arrays = [];
    public readonly JsonElement Header;

    FastBenchData(byte[] data, JsonElement header)
    {
        _data = data; Header = header;
        foreach (JsonElement a in header.GetProperty("arrays").EnumerateArray())
            _arrays[a.GetProperty("name").GetString()!] = (a.GetProperty("type").GetString()!, a.GetProperty("length").GetInt32(), a.GetProperty("byteOffset").GetInt64());
    }

    public static FastBenchData Load(string name)
    {
        string root = Environment.GetEnvironmentVariable("FS_FAST_FIXTURES") ?? Path.Combine(Environment.GetEnvironmentVariable("FIRESIM_SCRATCH") ?? "", "T1.4b");
        string dir = Path.Combine(root, "fx-" + name);
        using JsonDocument doc = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(dir, "header.json")));
        return new FastBenchData(File.ReadAllBytes(Path.Combine(dir, "data.bin")), doc.RootElement.Clone());
    }

    T[] Get<T>(string n) where T : unmanaged
    {
        var (_, len, off) = _arrays[n];
        var r = new T[len];
        Buffer.BlockCopy(_data, (int)off, r, 0, len * System.Runtime.CompilerServices.Unsafe.SizeOf<T>());
        return r;
    }

    public double[] F64(string n) => Get<double>(n);
    public float[] F32(string n) => Get<float>(n);
    public int[] I32(string n) => Get<int>(n);
    public byte[] U8(string n) => Get<byte>(n);
}

/// <summary>
/// The operations timed (T1.4b), built from one fixture: <c>EvalStage1</c> (<c>evaluate(phi, out, true)</c> with the replay hook; the prepStamp of the cells the real hook was asked
/// about is put back before each call), <c>EvalStage2</c> (<c>evaluate(phiS, out, false)</c>), <c>Reinit</c> (phi, band and bandCount restored before each call, a copy: the same in
/// the TypeScript), <c>Restore</c> alone, and <c>Pyro</c> (<c>solve</c> on a persistent instance). The same operations as Fs.Bench/ts/fast/bench.ts.
/// </summary>
public sealed class FastOps
{
    public readonly LevelSetCore Ls1, Ls2, Ls3;
    public readonly PyrogenicKernel Pyro;
    readonly int[] _hookCells, _prepBefore, _band0;
    readonly double[] _out1, _out2, _phi0;
    readonly float[] _q;
    readonly int _count3;

    public FastOps(string fixture)
    {
        FastBenchData data = FastBenchData.Load(fixture);
        FastCaseRunner.Meta meta = FastCaseRunner.ReadMeta(data.Header.GetProperty("meta"));
        JsonElement[] cases = data.Header.GetProperty("cases").EnumerateArray().ToArray();
        JsonElement Find(string kind, string? mode) => cases.First(c => c.GetProperty("kind").GetString() == kind && (mode is null || c.GetProperty("mode").GetString() == mode));
        JsonElement e1 = Find("evaluate", "e1"), e2 = Find("evaluate", "e2"), ri = Find("reinit", null), py = Find("pyro", null);
        var (ls1, hooks1) = FastCaseRunner.BuildLs(data, meta, e1, "plain");
        hooks1.Log = false;
        Ls1 = ls1;
        _hookCells = hooks1.HookCells;
        int[] prep = data.I32(e1.GetProperty("arrays").GetProperty("prepStamp").GetString()!);
        _prepBefore = _hookCells.Select(k => prep[k]).ToArray();
        _out1 = new double[ls1.BandCount];
        var (ls2, h2) = FastCaseRunner.BuildLs(data, meta, e2, "plain");
        h2.Log = false;
        Ls2 = ls2;
        _out2 = new double[ls2.BandCount];
        var (ls3, h3) = FastCaseRunner.BuildLs(data, meta, ri, "plain");
        h3.Log = false;
        Ls3 = ls3;
        _phi0 = (double[])ls3.Phi.Clone();
        _count3 = ls3.BandCount;
        _band0 = ls3.Band.AsSpan(0, _count3).ToArray();
        Pyro = FastCaseRunner.NewPyro(meta, py);
        _q = data.F32(py.GetProperty("q").GetString()!);
    }

    public double Eval1(KernelExec e)
    {
        for (int i = 0; i < _hookCells.Length; i++) Ls1.PrepStamp[_hookCells[i]] = _prepBefore[i];
        return Ls1.Evaluate(Ls1.Phi, _out1, true, e);
    }

    public double Eval2(KernelExec e) => Ls2.Evaluate(Ls2.PhiS, _out2, false, e);

    public int Restore()
    {
        Array.Copy(_phi0, Ls3.Phi, _phi0.Length);
        Array.Copy(_band0, Ls3.Band, _count3);
        Ls3.BandCount = _count3;
        return Ls3.BandCount;
    }

    public int Reinit(KernelExec e)
    {
        Restore();
        Ls3.Reinit(e);
        return Ls3.BandCount;
    }

    public float Solve(KernelExec e)
    {
        Pyro.Solve(_q, e);
        return Pyro.Up[1];
    }

    public (int Band, int Hooks, int ReinitBand, (int I0, int I1, int J0, int J1) Box) Sizes()
    {
        Restore();
        Ls3.Reinit(KernelExec.Scalar);
        var box = Ls3.Box;
        Restore();
        return (Ls1.BandCount, _hookCells.Length, _count3, box);
    }
}

/// <summary>
/// T1.4b: the fast tier's kernels, one operation each, on the real frames of katoomba6-fast-4h (900 s and 14,100 s). Forms: scalar, Vector128, Parallel.For on 4 threads (scalar
/// body), Parallel.For on 4 threads with the vector body; the default thresholds of the kernels (evaluate runs serially below 1,024 band cells, reinit's sweeps below 16,384 box
/// cells). The TypeScript is timed by Fs.Bench/ts/fast/bench.ts on the same files; ratios are made by <c>Fs.Bench fast-merge</c>.
/// </summary>
[MemoryDiagnoser]
[JsonExporterAttribute.Full]
[GroupBenchmarksBy(BenchmarkLogicalGroupRule.ByCategory, BenchmarkLogicalGroupRule.ByParams)]
[CategoriesColumn]
public class FastBench
{
    [Params("k6f-900", "k6f-late")]
    public string Fixture { get; set; } = "k6f-900";

    FastOps _o = null!;
    static readonly KernelExec Par4 = KernelExec.Par(4), ParVec4 = KernelExec.ParVec(4);

    [GlobalSetup]
    public void Setup()
    {
        _o = new FastOps(Fixture);
        ThreadPool.SetMinThreads(16, 16); // no thread-injection delay inside the timed runs
    }

    [Benchmark(Baseline = true), BenchmarkCategory("evalStage1")] public double EvalStage1_Scalar() => _o.Eval1(KernelExec.Scalar);
    [Benchmark, BenchmarkCategory("evalStage1")] public double EvalStage1_Vector() => _o.Eval1(KernelExec.Vec);
    [Benchmark, BenchmarkCategory("evalStage1")] public double EvalStage1_Parallel4() => _o.Eval1(Par4);
    [Benchmark, BenchmarkCategory("evalStage1")] public double EvalStage1_ParallelVector4() => _o.Eval1(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("evalStage2")] public double EvalStage2_Scalar() => _o.Eval2(KernelExec.Scalar);
    [Benchmark, BenchmarkCategory("evalStage2")] public double EvalStage2_Vector() => _o.Eval2(KernelExec.Vec);
    [Benchmark, BenchmarkCategory("evalStage2")] public double EvalStage2_Parallel4() => _o.Eval2(Par4);
    [Benchmark, BenchmarkCategory("evalStage2")] public double EvalStage2_ParallelVector4() => _o.Eval2(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("reinit")] public int Reinit_Scalar() => _o.Reinit(KernelExec.Scalar);
    [Benchmark, BenchmarkCategory("reinit")] public int Reinit_Vector() => _o.Reinit(KernelExec.Vec);
    [Benchmark, BenchmarkCategory("reinit")] public int Reinit_Parallel4() => _o.Reinit(Par4);
    [Benchmark, BenchmarkCategory("reinit")] public int Reinit_ParallelVector4() => _o.Reinit(ParVec4);

    [Benchmark(Baseline = true), BenchmarkCategory("restore")] public int Restore_Scalar() => _o.Restore();

    [Benchmark(Baseline = true), BenchmarkCategory("pyro")] public float Pyro_Scalar() => _o.Solve(KernelExec.Scalar);
    [Benchmark, BenchmarkCategory("pyro")] public float Pyro_Vector() => _o.Solve(KernelExec.Vec);
    [Benchmark, BenchmarkCategory("pyro")] public float Pyro_Parallel4() => _o.Solve(Par4);
    [Benchmark, BenchmarkCategory("pyro")] public float Pyro_ParallelVector4() => _o.Solve(ParVec4);
}
