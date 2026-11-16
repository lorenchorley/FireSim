using BenchmarkDotNet.Attributes;
using Fs.Kernel.SpeedTest;

namespace Fs.Bench;

/// <summary>
/// T1.2: the frozen K1 (air stencil, 45 x 45 x 20) in C#. One operation = one WHOLE SWEEP (the 18 parts, then End), the unit the TypeScript harness
/// (ts/speedtest-bench.ts) times too. The scalar form is the contract and the baseline; the TypeScript in Node is timed by that harness (it cannot be a
/// BDN case) and merged by <c>Fs.Bench speedtest-merge</c>. The kernel state evolves across invocations but stays in [0, 1] (no denormals), as in the app.
/// </summary>
[MemoryDiagnoser]
[JsonExporterAttribute.Full]
public class SpeedTestStencilBench
{
    StencilKernel _scalar = null!;
    StencilKernel _plain = null!;
    StencilKernel _vector = null!;

    [GlobalSetup]
    public void Setup()
    {
        _scalar = new StencilKernel(KernelPath.Scalar);
        _plain = new StencilKernel(KernelPath.ScalarPlain);
        _vector = new StencilKernel(KernelPath.Vector128);
    }

    static uint Sweep(StencilKernel k)
    {
        for (int p = 0; p < k.Parts; p++) k.Part(p);
        k.End();
        return (uint)k.Values.Length;
    }

    [Benchmark(Baseline = true)]
    public uint Scalar() => Sweep(_scalar);

    /// <summary>The literal port, <c>(double)f[i]</c> widenings: same bits, but the JIT's vcvtss2sd false dependency makes it about twice as slow (see the report).</summary>
    [Benchmark]
    public uint ScalarPlainWidening() => Sweep(_plain);

    [Benchmark]
    public uint Vector128() => Sweep(_vector);
}

/// <summary>
/// T1.2: the frozen K2 (16 MiB copy in 8 chunks) in C#: scalar loop (the contract, the baseline), element-wise Vector128, and, as a reference that is NOT
/// the contract, the platform's memmove (Span.CopyTo) to show the bandwidth ceiling. One operation = one whole sweep.
/// </summary>
[MemoryDiagnoser]
[JsonExporterAttribute.Full]
public class SpeedTestCopyBench
{
    CopyKernel _scalar = null!;
    CopyKernel _vector = null!;
    float[] _src = null!, _dst = null!;

    [GlobalSetup]
    public void Setup()
    {
        _scalar = new CopyKernel(KernelPath.Scalar);
        _vector = new CopyKernel(KernelPath.Vector128);
        _src = new float[SpeedTestConstants.CopyFloats];
        _dst = new float[SpeedTestConstants.CopyFloats];
        var rnd = new Lcg(SpeedTestConstants.CopySeed);
        for (int i = 0; i < _src.Length; i++) _src[i] = (float)rnd.Next();
    }

    static uint Sweep(CopyKernel k)
    {
        for (int p = 0; p < k.Parts; p++) k.Part(p);
        k.End();
        return (uint)k.Values.Length;
    }

    [Benchmark(Baseline = true)]
    public uint Scalar() => Sweep(_scalar);

    [Benchmark]
    public uint Vector128() => Sweep(_vector);

    [Benchmark]
    public uint MemmoveNotTheContract()
    {
        int chunk = _src.Length / SpeedTestConstants.CopyParts;
        for (int p = 0; p < SpeedTestConstants.CopyParts; p++) CopyCore.CopySpan(_src, _dst, p * chunk, (p + 1) * chunk);
        (_src, _dst) = (_dst, _src);
        _src[0] = (float)((double)_src[0] + 1);
        return (uint)_src.Length;
    }
}
