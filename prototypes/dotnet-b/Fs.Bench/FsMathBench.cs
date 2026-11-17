using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Configs;

namespace Fs.Bench;

/// <summary>
/// T1.3: ns per call of each function with the platform's <c>System.Math</c> (the baseline: glibc on linux-x64), the managed fdlibm port, CoreMathSharp and FsMath's
/// dispatcher (the default implementation behind a branch). Each benchmark is one loop over 4,096 calls with the call written out (FsMathLoops.g.cs), so the
/// reported time per operation is the time per call. The inputs are the first 4,096 calls of the "synthetic" input file of each function (the solver's ranges):
///   FSMATH_INPUTS=$SCRATCH/data/synthetic dotnet run -c Release --project Fs.Bench -- --filter "*FsMathBench*" --exporters json
/// (the default job for final numbers; <c>--job Dry</c> then <c>--job Short</c> while developing). Hypot has no System.Math member: its "platform" row is
/// double.Hypot, CoreLib's own managed algorithm, not libm.
/// </summary>
[GroupBenchmarksBy(BenchmarkLogicalGroupRule.ByParams)]
[CategoriesColumn]
public class FsMathBench
{
    private const int N = 4096;

    [Params("exp", "log", "pow", "sin", "cos", "tan", "atan", "atan2", "acos", "asin", "sinh", "cbrt", "log2", "log10", "hypot")]
    public string Fn { get; set; } = "exp";

    private double[] _x = [], _y = [];
    private FsMathLoops.Loop _platform = null!, _fdlibm = null!, _cms = null!, _fsmath = null!;

    [GlobalSetup]
    public void Setup()
    {
        string dir = Environment.GetEnvironmentVariable("FSMATH_INPUTS") ?? throw new InvalidOperationException("set FSMATH_INPUTS to the directory of the input files (gen-inputs.mjs)");
        int arity = FsMathTable.Arity(Fn);
        var bytes = File.ReadAllBytes(Path.Combine(dir, Fn + ".in"));
        _x = new double[N * arity];
        Buffer.BlockCopy(bytes, 0, _x, 0, N * arity * 8);
        _y = new double[N];
        _platform = FsMathLoops.Get("platform", Fn);
        _fdlibm = FsMathLoops.Get("fdlibm", Fn);
        _cms = FsMathLoops.Get("cms", Fn);
        _fsmath = FsMathLoops.Get("fsmath", Fn);
    }

    [Benchmark(Baseline = true, OperationsPerInvoke = N, Description = "platform Math")]
    public double Platform() { _platform(_x, _y, N); return _y[N - 1]; }

    [Benchmark(OperationsPerInvoke = N, Description = "FdLibm")]
    public double FdLibm() { _fdlibm(_x, _y, N); return _y[N - 1]; }

    [Benchmark(OperationsPerInvoke = N, Description = "CoreMathSharp")]
    public double CoreMathSharp() { _cms(_x, _y, N); return _y[N - 1]; }

    [Benchmark(OperationsPerInvoke = N, Description = "FsMath (default)")]
    public double FsMathDefault() { _fsmath(_x, _y, N); return _y[N - 1]; }
}
