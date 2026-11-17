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

/// <summary>The operations timed are in FastOps.cs.</summary>
internal static class FastOpsFactory
{
    public static FastOps Create(string fixture)
    {
        FastBenchData data = FastBenchData.Load(fixture);
        return new FastOps(data, data.Header);
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
        _o = FastOpsFactory.Create(Fixture);
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
