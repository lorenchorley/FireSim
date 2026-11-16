using Fs.Kernel.SpeedTest;

namespace Fs.Tests;

/// <summary>
/// Card T1.2: the frozen speed-test kernels in C# (Fs.Kernel/SpeedTest). These tests do not depend on which SIMD paths the process has; those are in
/// <see cref="SpeedTestPathChecks"/> (which the separate-process tests re-run under other settings).
/// The pinned numbers are the TypeScript test's (src/ui/speedTest.test.ts:26).
/// </summary>
[TestClass]
public sealed class SpeedTestKernelTests
{
    [TestMethod]
    public void TheKernelsHaveTheContractSizes()
    {
        // the sizes are compile-time constants: Work and Parts are what a kernel reports about them
        foreach (KernelPath path in Enum.GetValues<KernelPath>())
        {
            var k1 = new StencilKernel(path);
            Assert.AreEqual(43L * 43 * 18, k1.Work);
            Assert.AreEqual(18, k1.Parts);
            var k2 = new CopyKernel(path);
            Assert.AreEqual(16L * 1024 * 1024, k2.Work);
            Assert.AreEqual(8, k2.Parts);
        }
    }

    [TestMethod]
    public void ThePinnedNumbersAreTheTypeScriptTestsOwn()
    {
        // Read the TypeScript test from the repository (found by walking up from the test binary): the pinned checksums, the seed and the sizes must be the app's.
        string? dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "src", "ui", "speedTest.test.ts"))) dir = Path.GetDirectoryName(dir);
        if (dir is null) Assert.Inconclusive("the repository's src/ui/speedTest.test.ts is not reachable from the test binary");
        string test = File.ReadAllText(Path.Combine(dir, "src", "ui", "speedTest.test.ts"));
        string kernels = File.ReadAllText(Path.Combine(dir, "src", "ui", "speedTestKernels.ts"));
        StringAssert.Contains(test, $"stencilAfter3: 0x{SpeedTestConstants.FrozenStencilAfter3:x8}");
        StringAssert.Contains(test, $"copyAfter2: 0x{SpeedTestConstants.FrozenCopyAfter2:x8}");
        StringAssert.Contains(kernels, $"SPEED_TEST_SEED = {SpeedTestConstants.Seed};");
        StringAssert.Contains(kernels, $"STENCIL_NX = {SpeedTestConstants.StencilNx};");
        StringAssert.Contains(kernels, $"STENCIL_NY = {SpeedTestConstants.StencilNy};");
        StringAssert.Contains(kernels, $"STENCIL_NZ = {SpeedTestConstants.StencilNz};");
        StringAssert.Contains(kernels, "COPY_FLOATS = 4 * 1024 * 1024;");
        StringAssert.Contains(kernels, $"COPY_PARTS = {SpeedTestConstants.CopyParts};");
        StringAssert.Contains(kernels, "SPEED_TEST_SEED ^ 0x5bd1e995");
    }

    [TestMethod]
    public void TheGeneratorIsTheFixed32BitLcg()
    {
        var a = new Lcg(1);
        var b = new Lcg(1);
        double[] first = [a.Next(), a.Next(), a.Next()];
        double[] again = [b.Next(), b.Next(), b.Next()];
        CollectionAssert.AreEqual(first, again);
        Assert.AreEqual((1664525.0 + 1013904223.0) / 4294967296.0, first[0], 1e-12);
        foreach (double x in first)
        {
            Assert.IsGreaterThanOrEqualTo(0.0, x);
            Assert.IsLessThan(1.0, x);
        }
        // wraps modulo 2^32 exactly like Math.imul(...) >>> 0: seed 0xFFFFFFFF -> (0xFFFFFFFF * 1664525 + 1013904223) mod 2^32
        var w = new Lcg(0xFFFFFFFFu);
        uint expected = unchecked(0xFFFFFFFFu * 1664525u + 1013904223u);
        Assert.AreEqual(expected / 4294967296.0, w.Next());
    }

    [TestMethod]
    public void FnvMatchesTheDefinitionOnKnownWords()
    {
        // FNV-1a over 32-bit words (not bytes): the empty array hashes to the offset basis; one word w gives (basis ^ w) * prime.
        Assert.AreEqual(0x811c9dc5u, SpeedTest.Fnv(ReadOnlySpan<float>.Empty));
        float one = BitConverter.UInt32BitsToSingle(0x3f800000);
        Assert.AreEqual(unchecked((0x811c9dc5u ^ 0x3f800000u) * 16777619u), SpeedTest.Fnv([one]));
    }

    [TestMethod]
    public void BothKernelsStartFromTheSameStateEverytimeAndEverySweepChangesTheState()
    {
        foreach (KernelPath path in Enum.GetValues<KernelPath>())
        {
            var a = new StencilKernel(path);
            var b = new StencilKernel(path);
            Assert.AreEqual(a.Checksum(), b.Checksum());
            uint at0 = a.Checksum();
            SpeedTest.Sweeps(a, 1);
            Assert.AreNotEqual(at0, a.Checksum());
            SpeedTest.Sweeps(b, 1);
            Assert.AreEqual(a.Checksum(), b.Checksum());
            var c = new CopyKernel(path);
            uint c0 = c.Checksum();
            SpeedTest.Sweeps(c, 1);
            Assert.AreNotEqual(c0, c.Checksum());
        }
    }

    [TestMethod]
    public void K1AgreesWithANaiveStencilAndGatherAfterThreeSweepsAndStaysInUnitRange()
    {
        // The TypeScript test's oracle: eight corner weights added in another order, so the kernel differs in the last float bits at most.
        const int nx = SpeedTestConstants.StencilNx, ny = SpeedTestConstants.StencilNy, nz = SpeedTestConstants.StencilNz;
        const int n = nx * ny * nz;
        var rnd = new Lcg(SpeedTestConstants.Seed);
        float[] a = new float[n], u = new float[n], v = new float[n], w = new float[n];
        for (int i = 0; i < n; i++)
        {
            a[i] = (float)rnd.Next();
            u[i] = (float)(0.9 * (2 * rnd.Next() - 1));
            v[i] = (float)(0.9 * (2 * rnd.Next() - 1));
            w[i] = (float)(0.9 * (2 * rnd.Next() - 1));
        }
        static double At(float[] s, int i, int j, int k) => s[(k * ny + j) * nx + i];
        int[][] corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
        for (int sweep = 0; sweep < 3; sweep++)
        {
            float[] b = (float[])a.Clone();
            for (int k = 1; k < nz - 1; k++)
                for (int j = 1; j < ny - 1; j++)
                    for (int i = 1; i < nx - 1; i++)
                    {
                        int c = (k * ny + j) * nx + i;
                        double x = i - (double)u[c], y = j - (double)v[c], z = k - (double)w[c];
                        int i0 = (int)Math.Floor(x), j0 = (int)Math.Floor(y), k0 = (int)Math.Floor(z);
                        double fx = x - i0, fy = y - j0, fz = z - k0;
                        double gathered = 0;
                        foreach (int[] d in corners)
                            gathered += (d[0] != 0 ? fx : 1 - fx) * (d[1] != 0 ? fy : 1 - fy) * (d[2] != 0 ? fz : 1 - fz) * At(a, i0 + d[0], j0 + d[1], k0 + d[2]);
                        double around = At(a, i - 1, j, k) + At(a, i + 1, j, k) + At(a, i, j - 1, k) + At(a, i, j + 1, k) + At(a, i, j, k - 1) + At(a, i, j, k + 1);
                        b[c] = (float)(0.88 * gathered + 0.02 * around);
                    }
            a = b;
        }
        foreach (KernelPath path in Enum.GetValues<KernelPath>())
        {
            var kernel = new StencilKernel(path);
            SpeedTest.Sweeps(kernel, 3);
            ReadOnlySpan<float> got = kernel.Values;
            double worst = 0;
            for (int i = 0; i < n; i++) worst = Math.Max(worst, Math.Abs(got[i] - (double)a[i]));
            Assert.IsLessThan(1e-5, worst, $"{path}: worst difference from the oracle");
            foreach (float x in got) Assert.IsTrue(float.IsFinite(x) && x >= 0 && x <= 1, $"{path}: {x} is outside [0, 1]");
            Assert.IsGreaterThan(1000, new HashSet<float>(got.ToArray()).Count, "the field is not flat: three sweeps do not mix it away");
        }
    }

    [TestMethod]
    public void TheTruncationByIntegerArithmeticEqualsTheJavaScriptBitwiseOrOnEveryEdgeDisplacement()
    {
        // K1 replaces `x | 0` (x = i - u in (i - 1, i + 1), positive) by `x < i ? i - 1 : i`. Compare a kernel on grids made of edge displacements
        // (zero, signed zero, denormal-sized, the app's 0.9 limit, nearly one cell, values that round x back onto i) with a literal oracle that truncates
        // with a cast, bit for bit, after every sweep.
        float[] edges = [0f, -0f, 1e-30f, -1e-30f, 1e-8f, -1e-8f, 0.5f, -0.5f, 0.9f, -0.9f, 0.999f, -0.999f, 0.1f, -0.1f];
        const int nx = 7, ny = 5, nz = 5;
        const int n = nx * ny * nz;
        var rnd = new Lcg(77);
        float[] a = new float[n], u = new float[n], v = new float[n], w = new float[n];
        for (int i = 0; i < n; i++)
        {
            a[i] = (float)rnd.Next();
            u[i] = edges[(int)(rnd.Next() * edges.Length)];
            v[i] = edges[(int)(rnd.Next() * edges.Length)];
            w[i] = edges[(int)(rnd.Next() * edges.Length)];
        }
        var scalar = new StencilKernel(nx, ny, nz, a, u, v, w, KernelPath.Scalar);
        var vector = new StencilKernel(nx, ny, nz, a, u, v, w, KernelPath.Vector128);
        float[] o = (float[])a.Clone();
        for (int sweep = 0; sweep < 4; sweep++)
        {
            float[] b = (float[])o.Clone();
            for (int k = 1; k < nz - 1; k++)
                for (int j = 1; j < ny - 1; j++)
                    for (int i = 1; i < nx - 1; i++)
                    {
                        int c = (k * ny + j) * nx + i;
                        double around = (double)o[c - 1] + o[c + 1] + o[c - nx] + o[c + nx] + o[c - nx * ny] + o[c + nx * ny];
                        double x = i - (double)u[c], y = j - (double)v[c], s = k - (double)w[c];
                        int i0 = (int)x, j0 = (int)y, k0 = (int)s; // JavaScript `| 0` on a positive in-range value
                        double fx = x - i0, fy = y - j0, fz = s - k0;
                        int p = k0 * nx * ny + j0 * nx + i0;
                        double c0 = (o[p] * (1 - fx) + o[p + 1] * fx) * (1 - fy) + (o[p + nx] * (1 - fx) + o[p + nx + 1] * fx) * fy;
                        double c1 = (o[p + nx * ny] * (1 - fx) + o[p + nx * ny + 1] * fx) * (1 - fy) + (o[p + nx * ny + nx] * (1 - fx) + o[p + nx * ny + nx + 1] * fx) * fy;
                        b[c] = (float)(0.88 * (c0 * (1 - fz) + c1 * fz) + 0.02 * around);
                    }
            o = b;
            SpeedTest.Sweeps(scalar, 1);
            SpeedTest.Sweeps(vector, 1);
            CollectionAssert.AreEqual(Bits(o), Bits(scalar.Values), $"scalar differs from the cast oracle after sweep {sweep + 1}");
            CollectionAssert.AreEqual(Bits(o), Bits(vector.Values), $"vector differs from the cast oracle after sweep {sweep + 1}");
        }
    }

    [TestMethod]
    public void K2CopiesWholeSweepsAndRaisesTheFirstFloatOnceASweep()
    {
        // The pinned checksum is the checksum of the input with s[0] raised twice (src/ui/speedTest.test.ts, the K2 oracle test).
        var rnd = new Lcg(SpeedTestConstants.CopySeed);
        float[] s = new float[SpeedTestConstants.CopyFloats];
        for (int i = 0; i < s.Length; i++) s[i] = (float)rnd.Next();
        s[0] = (float)((double)(float)((double)s[0] + 1) + 1);
        Assert.AreEqual(SpeedTestConstants.FrozenCopyAfter2, SpeedTest.Fnv(s));
    }

    [TestMethod]
    public void TheKernelsAreDeterministicWhateverThePartsOrderOfASweep()
    {
        // Every part of K1 reads buffer a and writes buffer b only, and the parts write disjoint planes: running the parts in another order gives the
        // same bits (what any later threaded form relies on). Likewise K2's chunks.
        foreach (KernelPath path in Enum.GetValues<KernelPath>())
        {
            var inOrder = new StencilKernel(path);
            var reversed = new StencilKernel(path);
            SpeedTest.Sweeps(inOrder, 2);
            for (int s = 0; s < 2; s++)
            {
                for (int p = reversed.Parts - 1; p >= 0; p--) reversed.Part(p);
                reversed.End();
            }
            Assert.AreEqual(inOrder.Checksum(), reversed.Checksum());
            var copyInOrder = new CopyKernel(path);
            var copyReversed = new CopyKernel(path);
            SpeedTest.Sweeps(copyInOrder, 2);
            for (int s = 0; s < 2; s++)
            {
                for (int p = copyReversed.Parts - 1; p >= 0; p--) copyReversed.Part(p);
                copyReversed.End();
            }
            Assert.AreEqual(copyInOrder.Checksum(), copyReversed.Checksum());
        }
    }

    static uint[] Bits(ReadOnlySpan<float> f)
    {
        uint[] r = new uint[f.Length];
        for (int i = 0; i < r.Length; i++) r[i] = BitConverter.SingleToUInt32Bits(f[i]);
        return r;
    }
}
