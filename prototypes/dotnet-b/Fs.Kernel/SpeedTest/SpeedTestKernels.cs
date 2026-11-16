using System.Runtime.InteropServices;

namespace Fs.Kernel.SpeedTest;

/// <summary>
/// The two FROZEN speed-test kernels of the app (src/ui/speedTestKernels.ts, version 1), ported to C# for the option B prototype (card T1.2).
///
///   K1 "air stencil": a 45 x 45 x 20 float32 grid (40,500 cells); each sweep a 7-point stencil plus a trilinear gather at a displaced point for every
///      interior cell; values and displacements from a fixed 32-bit LCG.
///   K2 "memory copy": a 16 MiB float32 array copied into another by a plain loop, eight chunks a sweep.
///
/// Contract (what makes the two frozen checksums come out): float32 storage, DOUBLE arithmetic everywhere the TypeScript has a JavaScript number
/// (so every float32 read is widened to double first; the only float32 roundings are the stores, exactly where the TypeScript's typed-array stores
/// round), no fused multiply-add, no reordering of any sum. Both kernels are single-threaded in the TypeScript (one worker, no threads), so the C# ones
/// are too: a sweep is <see cref="ISpeedKernel.Parts"/> calls of <see cref="ISpeedKernel.Part"/> in order, then <see cref="ISpeedKernel.End"/>.
///
/// Rule 5 / 10.4 notes: no System.Math transcendental, no float-to-integer cast (the one place the TypeScript truncates, <c>x | 0</c> on a value in
/// [0.1, 44.9], is done by integer arithmetic, see <see cref="StencilCore"/>), no TensorPrimitives, no Vector&lt;T&gt;, no horizontal sums.
/// </summary>
public static class SpeedTestConstants
{
    /// <summary>The fixed seed of every input.</summary>
    public const uint Seed = 20261030;
    public const int StencilNx = 45;
    public const int StencilNy = 45;
    public const int StencilNz = 20;
    /// <summary>The copy's array: 16 MiB of float32, in <see cref="CopyParts"/> chunks a sweep.</summary>
    public const int CopyFloats = 4 * 1024 * 1024;
    public const int CopyParts = 8;
    /// <summary>K2's seed: <c>SPEED_TEST_SEED ^ 0x5bd1e995</c>.</summary>
    public const uint CopySeed = Seed ^ 0x5bd1e995u;

    /// <summary>What the kernels computed when version 1 was frozen (src/ui/speedTest.test.ts:26).</summary>
    public const uint FrozenStencilAfter3 = 0x7d268009;
    public const uint FrozenCopyAfter2 = 0x1e84aad9;
}

/// <summary>Which implementation a kernel runs. Both must give identical bits.</summary>
public enum KernelPath
{
    /// <summary>The contract: plain scalar loops, the same arithmetic order as the TypeScript.</summary>
    Scalar,
    /// <summary>Element-wise <c>Vector128</c> (2 doubles or 4 floats per vector), no reductions; bit-identical to <see cref="Scalar"/>.</summary>
    Vector128,
}

/// <summary>One timed kernel (mirror of the TypeScript <c>Kernel</c> interface).</summary>
public interface ISpeedKernel
{
    /// <summary>K1: cell updates a sweep (the interior cells). K2: bytes copied a sweep.</summary>
    long Work { get; }
    int Parts { get; }
    void Part(int p);
    /// <summary>Called once after the last part of a sweep (the buffers swap).</summary>
    void End();
    /// <summary>The state the next sweep would read.</summary>
    ReadOnlySpan<float> Values { get; }
    /// <summary>FNV-1a over the 32-bit words of <see cref="Values"/>: what the frozen-kernel test pins.</summary>
    uint Checksum();
}

/// <summary>A 32-bit linear congruential generator (Numerical Recipes constants): the next unit-interval double [0, 1) each call.</summary>
public struct Lcg
{
    uint _s;
    public Lcg(uint seed) => _s = seed;

    public double Next()
    {
        _s = unchecked(_s * 1664525u + 1013904223u); // Math.imul(s, 1664525) + 1013904223 >>> 0
        return _s / 4294967296.0;
    }
}

public static class SpeedTest
{
    /// <summary>FNV-1a over the 32-bit words of a float32 array (the TypeScript <c>fnv</c>).</summary>
    public static uint Fnv(ReadOnlySpan<float> a)
    {
        ReadOnlySpan<uint> w = MemoryMarshal.Cast<float, uint>(a);
        uint h = 0x811c9dc5;
        for (int i = 0; i < w.Length; i++)
            h = unchecked((h ^ w[i]) * 16777619u);
        return h;
    }

    /// <summary>Run <paramref name="count"/> whole sweeps (no clock): what the checksum test and a warm-up call use (the TypeScript <c>sweeps</c>).</summary>
    public static void Sweeps(ISpeedKernel k, int count)
    {
        for (int s = 0; s < count; s++)
        {
            for (int p = 0; p < k.Parts; p++) k.Part(p);
            k.End();
        }
    }
}
