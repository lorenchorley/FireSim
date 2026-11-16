using System.Runtime.Intrinsics;
using Fs.Kernel.SpeedTest;

namespace Fs.Tests;

/// <summary>
/// Card T1.2: the checks that depend on which SIMD paths the JIT gives this process. They run in the ordinary test run (default hardware) and again, in
/// child processes, under other settings (<see cref="SpeedTestSeparateProcessTests"/>; the vectorization skill: do not flip process-wide settings inside
/// a test). The child tells which situation to expect through the environment variable <see cref="ExpectVariable"/>.
/// </summary>
[TestClass]
public sealed class SpeedTestPathChecks
{
    public const string ExpectVariable = "FS_SPEEDTEST_EXPECT";

    [TestMethod]
    public void TheProcessHasTheSimdSupportThatWasAskedFor()
    {
        string? expect = Environment.GetEnvironmentVariable(ExpectVariable);
        switch (expect)
        {
            case "hardware": // default settings, or AVX2 off: Vector128 is accelerated
            case "no-avx2":
                Assert.IsTrue(Vector128.IsHardwareAccelerated);
                break;
            case "software": // DOTNET_EnableHWIntrinsic=0: Vector128 runs through the software fallback
                Assert.IsFalse(Vector128.IsHardwareAccelerated);
                break;
            default:
                break; // ordinary run: nothing is asked for
        }
        Console.WriteLine($"Vector128.IsHardwareAccelerated={Vector128.IsHardwareAccelerated} Vector256={Vector256.IsHardwareAccelerated} Vector512={Vector512.IsHardwareAccelerated}");
    }

    [TestMethod]
    public void BothFrozenChecksumsAreReproducedByEveryPath()
    {
        foreach (KernelPath path in Enum.GetValues<KernelPath>())
        {
            var k1 = new StencilKernel(path);
            SpeedTest.Sweeps(k1, 3);
            Assert.AreEqual(SpeedTestConstants.FrozenStencilAfter3, k1.Checksum(), $"K1 {path} after 3 sweeps");
            var k2 = new CopyKernel(path);
            SpeedTest.Sweeps(k2, 2);
            Assert.AreEqual(SpeedTestConstants.FrozenCopyAfter2, k2.Checksum(), $"K2 {path} after 2 sweeps");
        }
    }

    [TestMethod]
    public void StencilVectorEqualsScalarBitForBitOnRandomInputsAndEveryRowTail()
    {
        // Rows of 1..12 interior cells (two doubles a vector: the tail is 0 or 1 cell, and 1 cell is under a whole vector), other seeds, five sweeps, every
        // part, every value compared as bits after each sweep.
        int cases = 0;
        for (int nx = 3; nx <= 14; nx++)
            for (int ny = 3; ny <= 5; ny++)
                for (uint seed = 1; seed <= 3; seed++)
                {
                    int nz = 3 + (int)((seed + (uint)nx) % 3);
                    var s = new StencilKernel(nx, ny, nz, seed * 7919 + (uint)nx, KernelPath.Scalar);
                    var v = new StencilKernel(nx, ny, nz, seed * 7919 + (uint)nx, KernelPath.Vector128);
                    for (int sweep = 1; sweep <= 5; sweep++)
                    {
                        SpeedTest.Sweeps(s, 1);
                        SpeedTest.Sweeps(v, 1);
                        AssertSameBits(s.Values, v.Values, $"stencil {nx}x{ny}x{nz} seed {seed} sweep {sweep}");
                    }
                    cases++;
                }
        Assert.AreEqual(12 * 3 * 3, cases);
    }

    [TestMethod]
    public void StencilVectorEqualsScalarOnTheAppGridFromDifferentSeeds()
    {
        for (uint seed = 100; seed < 104; seed++)
        {
            var s = new StencilKernel(45, 45, 20, seed, KernelPath.Scalar);
            var v = new StencilKernel(45, 45, 20, seed, KernelPath.Vector128);
            SpeedTest.Sweeps(s, 3);
            SpeedTest.Sweeps(v, 3);
            AssertSameBits(s.Values, v.Values, $"app grid seed {seed}");
        }
    }

    [TestMethod]
    public void CopyEveryPathCopiesExactlyTheRangeForEveryLengthAndOffset()
    {
        // Lengths 0..70 (under a vector, every remainder of 4, several whole vectors) at offsets 0..5, random bit patterns including NaNs and -0, a
        // guard of sentinel words either side that must stay untouched: scalar, vector and memmove all give the same destination.
        var rnd = new Lcg(5);
        const uint sentinel = 0xDEADBEEF;
        for (int length = 0; length <= 70; length++)
            for (int from = 0; from <= 5; from++)
            {
                int total = from + length + 7;
                float[] src = new float[total];
                for (int i = 0; i < total; i++)
                {
                    uint r = (uint)(rnd.Next() * 4294967296.0);
                    src[i] = BitConverter.UInt32BitsToSingle(i % 11 == 0 ? 0x7fc00000u | (r & 0x3fffff) : i % 13 == 0 ? 0x80000000u : r);
                }
                float[][] outputs = new float[3][];
                for (int m = 0; m < 3; m++)
                {
                    float[] dst = new float[total];
                    Array.Fill(dst, BitConverter.UInt32BitsToSingle(sentinel));
                    int to = from + length;
                    if (m == 0) CopyCore.CopyScalar(src, dst, from, to);
                    else if (m == 1) CopyCore.CopyVector128(src, dst, from, to);
                    else CopyCore.CopySpan(src, dst, from, to);
                    outputs[m] = dst;
                    for (int i = 0; i < total; i++)
                    {
                        uint want = i >= from && i < to ? BitConverter.SingleToUInt32Bits(src[i]) : sentinel;
                        Assert.AreEqual(want, BitConverter.SingleToUInt32Bits(dst[i]), $"method {m} length {length} from {from} index {i}");
                    }
                }
            }
    }

    [TestMethod]
    public void CopyVectorKernelEqualsScalarKernelAtOtherSizesAndPartCounts()
    {
        foreach ((int floats, int parts) in new[] { (8, 8), (24, 8), (40, 8), (3 * 7, 7), (1000, 8), (4 * 1020, 5), (65536, 8) })
        {
            var s = new CopyKernel(floats, parts, 31, KernelPath.Scalar);
            var v = new CopyKernel(floats, parts, 31, KernelPath.Vector128);
            for (int sweep = 1; sweep <= 3; sweep++)
            {
                SpeedTest.Sweeps(s, 1);
                SpeedTest.Sweeps(v, 1);
                AssertSameBits(s.Values, v.Values, $"copy {floats}/{parts} sweep {sweep}");
            }
        }
    }

    static void AssertSameBits(ReadOnlySpan<float> a, ReadOnlySpan<float> b, string what)
    {
        Assert.AreEqual(a.Length, b.Length, what);
        for (int i = 0; i < a.Length; i++)
            if (BitConverter.SingleToUInt32Bits(a[i]) != BitConverter.SingleToUInt32Bits(b[i]))
                Assert.Fail($"{what}: element {i} differs ({a[i]:R} vs {b[i]:R})");
    }
}
