using System.Runtime.Intrinsics;

namespace Fs.Kernel.SpeedTest;

/// <summary>
/// K2, the memory copy (src/ui/speedTestKernels.ts <c>makeCopyKernel</c>): each sweep copies the whole array in <see cref="SpeedTestConstants.CopyParts"/>
/// chunks by a plain loop, swaps the two arrays and adds 1 to the first float (a double addition rounded back to float32, as the TypeScript's
/// typed-array store does), so the state depends on the number of sweeps.
/// </summary>
public static class CopyCore
{
    /// <summary>The scalar contract: <c>for (i = from; i &lt; to; i++) dst[i] = src[i]</c>. The JIT does not turn this into a memmove.</summary>
    public static void CopyScalar(float[] src, float[] dst, int from, int to)
    {
        for (int i = from; i < to; i++) dst[i] = src[i];
    }

    /// <summary>
    /// The same copy, four floats per <c>Vector128&lt;float&gt;</c>; a length that is not a multiple of four finishes by copying the last full vector again
    /// (a copy is idempotent and the arrays are distinct), a length under four by the scalar loop. Touches only <c>[from, to)</c>.
    /// </summary>
    public static void CopyVector128(float[] src, float[] dst, int from, int to)
    {
        int length = to - from;
        if (Vector128.IsHardwareAccelerated && length >= Vector128<float>.Count)
        {
            ReadOnlySpan<float> s = src.AsSpan(from, length);
            Span<float> d = dst.AsSpan(from, length);
            int i = 0;
            for (; i <= length - Vector128<float>.Count; i += Vector128<float>.Count)
                Vector128.Create(s.Slice(i)).CopyTo(d.Slice(i));
            if (i < length)
            {
                int last = length - Vector128<float>.Count;
                Vector128.Create(s.Slice(last)).CopyTo(d.Slice(last));
            }
            return;
        }
        CopyScalar(src, dst, from, to);
    }

    /// <summary>NOT the contract (the TypeScript says "a plain loop"): the platform's own memmove, to show the memory-bandwidth ceiling in the benchmark.</summary>
    public static void CopySpan(float[] src, float[] dst, int from, int to) => src.AsSpan(from, to - from).CopyTo(dst.AsSpan(from, to - from));
}

/// <summary>K2 as a timed kernel.</summary>
public sealed class CopyKernel : ISpeedKernel
{
    readonly int _floats, _parts;
    readonly KernelPath _path;
    float[] _src, _dst;

    /// <summary>The app's kernel: 4,194,304 floats (16 MiB) in 8 parts, from the fixed seed.</summary>
    public CopyKernel(KernelPath path = KernelPath.Scalar)
        : this(SpeedTestConstants.CopyFloats, SpeedTestConstants.CopyParts, SpeedTestConstants.CopySeed, path) { }

    /// <summary>The same construction at another size (for tests); <paramref name="floats"/> must be a multiple of <paramref name="parts"/>.</summary>
    public CopyKernel(int floats, int parts, uint seed, KernelPath path = KernelPath.Scalar)
    {
        if (parts < 1 || floats % parts != 0) throw new ArgumentException("floats must be a multiple of parts");
        _floats = floats; _parts = parts; _path = path;
        var rnd = new Lcg(seed);
        _src = new float[floats];
        _dst = new float[floats];
        for (int i = 0; i < floats; i++) _src[i] = (float)rnd.Next();
    }

    public long Work => (long)_floats * 4;
    public int Parts => _parts;

    public void Part(int p)
    {
        int chunk = _floats / _parts;
        int from = p * chunk;
        int to = (p + 1) * chunk;
        if (_path == KernelPath.Vector128) CopyCore.CopyVector128(_src, _dst, from, to);
        else CopyCore.CopyScalar(_src, _dst, from, to);
    }

    public void End()
    {
        (_src, _dst) = (_dst, _src);
        _src[0] = (float)((double)_src[0] + 1);
    }

    public ReadOnlySpan<float> Values => _src;

    public uint Checksum() => SpeedTest.Fnv(_src);
}
