using BenchmarkDotNet.Attributes;
using Fs.Kernel;

namespace Fs.Bench;

/// <summary>
/// BenchmarkDotNet timings of the kernel forms on the captured fixture (set FS_FIXTURE_DIR to the fixture folder: BDN runs each case in a child
/// process, which inherits the environment). One operation = one full solve (coarsen, five dense transforms, gradient, bilinear to the fire grid).
/// The scalar form is the baseline; the TypeScript timing is made by ts/bench.ts in Node (it cannot be a BDN case) on the same inputs and merged
/// by `Fs.Bench merge`.
/// </summary>
[MemoryDiagnoser]
[JsonExporterAttribute.Full]
public class PyrogenicBench
{
    [Params("case0", "case1", "case2")]
    public string Case { get; set; } = "case1";

    float[] _q = Array.Empty<float>();
    PyrogenicKernel _k = null!;

    [GlobalSetup]
    public void Setup()
    {
        string? dir = Environment.GetEnvironmentVariable("FS_FIXTURE_DIR");
        if (string.IsNullOrEmpty(dir)) throw new InvalidOperationException("set FS_FIXTURE_DIR to the kernel fixture folder (see Fs.Bench/run-bench.sh)");
        var f = KernelFixture.Load(dir);
        _q = f.Cases.First(c => c.Name == Case).Q;
        _k = new PyrogenicKernel(f.FireNx, f.FireNy, f.CellSizeM, f.PyroK, f.PyroMax);
        ThreadPool.SetMinThreads(16, 16); // no thread-injection delay inside the timed runs
    }

    [Benchmark(Baseline = true)]
    public float[] Scalar() { _k.SolveScalar(_q); return _k.Up; }

    [Benchmark]
    public float[] TensorPrimitives() { _k.SolveTensor(_q); return _k.Up; }

    [Benchmark]
    public float[] Vector128() { _k.SolveVector128(_q); return _k.Up; }

    [Benchmark]
    public float[] Vector256() { _k.SolveVector256(_q); return _k.Up; }

    [Benchmark]
    public float[] Parallel1() { _k.SolveParallel(_q, 1); return _k.Up; }

    [Benchmark]
    public float[] Parallel2() { _k.SolveParallel(_q, 2); return _k.Up; }

    [Benchmark]
    public float[] Parallel4() { _k.SolveParallel(_q, 4); return _k.Up; }

    [Benchmark]
    public float[] Parallel8() { _k.SolveParallel(_q, 8); return _k.Up; }
}
