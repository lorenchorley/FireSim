using System.Runtime.CompilerServices;
using System.Runtime.Intrinsics;

namespace Fs.Kernel.SpeedTest;

/// <summary>
/// K1, the air stencil (src/ui/speedTestKernels.ts <c>makeStencilKernel</c>). Interior cells only (the border is never written: both buffers hold the same
/// border for ever). The displacements must be under one cell (|u|, |v|, |w| &lt; 1; the app's are at most 0.9) so that the gather's eight corners are
/// always inside the grid.
///
/// The TypeScript truncates <c>x = i - u[c]</c> with <c>x | 0</c>. Here x is in (i - 1, i + 1) and positive (i &gt;= 1), so the truncation is i - 1 when
/// x &lt; i (a positive u that did not round away) and i otherwise: the same integer without any float-to-integer cast (plan 10.4).
/// </summary>
public static class StencilCore
{
    /// <summary>float32 to double, exactly (every float is a double). Written as a one-lane Vector128 widening so that the JIT emits <c>vcvtps2pd</c> (which writes a whole register) instead of <c>vcvtss2sd xmm6, xmm6, [mem]</c> (which also reads the old xmm6: a false dependency that chains all fourteen conversions of a cell, see the report).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static double W(float[] f, int idx) => Vector128.WidenLower(Vector128.CreateScalarUnsafe(f[idx])).ToScalar();

    /// <summary>The scalar contract for one interior cell. Arithmetic is double, in the TypeScript's order; <paramref name="c"/> = z*nxy + j*nx + i.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static void Cell(float[] a, float[] b, float[] u, float[] v, float[] w, int nx, int nxy, int i, int j, int z, int c)
    {
        double around = W(a, c - 1) + W(a, c + 1) + W(a, c - nx) + W(a, c + nx) + W(a, c - nxy) + W(a, c + nxy);
        double x = i - W(u, c);
        double y = j - W(v, c);
        double s = z - W(w, c);
        int i0 = i - (x < i ? 1 : 0); // == x | 0 (a compare to 0 or 1, not a branch)
        int j0 = j - (y < j ? 1 : 0);
        int k0 = z - (s < z ? 1 : 0);
        double fx = x - i0;
        double fy = y - j0;
        double fz = s - k0;
        int o = k0 * nxy + j0 * nx + i0;
        double c0 = (W(a, o) * (1 - fx) + W(a, o + 1) * fx) * (1 - fy) + (W(a, o + nx) * (1 - fx) + W(a, o + nx + 1) * fx) * fy;
        double c1 = (W(a, o + nxy) * (1 - fx) + W(a, o + nxy + 1) * fx) * (1 - fy)
                    + (W(a, o + nxy + nx) * (1 - fx) + W(a, o + nxy + nx + 1) * fx) * fy;
        b[c] = (float)(0.88 * (c0 * (1 - fz) + c1 * fz) + 0.02 * around);
    }

    /// <summary>The same cell with the plain widening <c>(double)f[idx]</c> (the literal port). Bit-identical to <see cref="Cell"/>; kept to measure what the false dependency costs (<see cref="KernelPath.ScalarPlain"/>).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static void CellPlain(float[] a, float[] b, float[] u, float[] v, float[] w, int nx, int nxy, int i, int j, int z, int c)
    {
        double around = (double)a[c - 1] + (double)a[c + 1] + (double)a[c - nx] + (double)a[c + nx] + (double)a[c - nxy] + (double)a[c + nxy];
        double x = i - (double)u[c];
        double y = j - (double)v[c];
        double s = z - (double)w[c];
        int i0 = i - (x < i ? 1 : 0); // == x | 0 (a compare to 0 or 1, not a branch)
        int j0 = j - (y < j ? 1 : 0);
        int k0 = z - (s < z ? 1 : 0);
        double fx = x - i0;
        double fy = y - j0;
        double fz = s - k0;
        int o = k0 * nxy + j0 * nx + i0;
        double c0 = ((double)a[o] * (1 - fx) + (double)a[o + 1] * fx) * (1 - fy) + ((double)a[o + nx] * (1 - fx) + (double)a[o + nx + 1] * fx) * fy;
        double c1 = ((double)a[o + nxy] * (1 - fx) + (double)a[o + nxy + 1] * fx) * (1 - fy)
                    + ((double)a[o + nxy + nx] * (1 - fx) + (double)a[o + nxy + nx + 1] * fx) * fy;
        b[c] = (float)(0.88 * (c0 * (1 - fz) + c1 * fz) + 0.02 * around);
    }

    /// <summary>Part <paramref name="p"/> of a sweep (the plane z = p + 1), scalar: the contract.</summary>
    public static void PartScalar(float[] a, float[] b, float[] u, float[] v, float[] w, int nx, int ny, int p)
    {
        int nxy = nx * ny;
        int z = p + 1;
        for (int j = 1; j < ny - 1; j++)
            for (int i = 1; i < nx - 1; i++)
                Cell(a, b, u, v, w, nx, nxy, i, j, z, z * nxy + j * nx + i);
    }

    /// <summary>Part <paramref name="p"/> of a sweep (the plane z = p + 1), scalar with the plain widening (see <see cref="CellPlain"/>).</summary>
    public static void PartScalarPlain(float[] a, float[] b, float[] u, float[] v, float[] w, int nx, int ny, int p)
    {
        int nxy = nx * ny;
        int z = p + 1;
        for (int j = 1; j < ny - 1; j++)
            for (int i = 1; i < nx - 1; i++)
                CellPlain(a, b, u, v, w, nx, nxy, i, j, z, z * nxy + j * nx + i);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> Pair(float[] f, int idx) => Vector128.WidenLower(Vector128.Create(f[idx], f[idx + 1], 0f, 0f));

    /// <summary>
    /// The same plane with two adjacent cells in each <c>Vector128&lt;double&gt;</c> (two lanes: a double is 64 bits). Every operation is the scalar's, lane for
    /// lane and in the same order, so the bits are identical; the gather's loads stay scalar (the addresses are data dependent) and an odd row ends with one scalar cell.
    /// </summary>
    public static void PartVector128(float[] a, float[] b, float[] u, float[] v, float[] w, int nx, int ny, int p)
    {
        int nxy = nx * ny;
        int z = p + 1;
        Vector128<double> one = Vector128.Create(1.0);
        Vector128<double> k88 = Vector128.Create(0.88);
        Vector128<double> k02 = Vector128.Create(0.02);
        Vector128<double> zv = Vector128.Create((double)z);
        for (int j = 1; j < ny - 1; j++)
        {
            Vector128<double> jv = Vector128.Create((double)j);
            int i = 1;
            for (; i + 1 < nx - 1; i += 2)
            {
                int c = z * nxy + j * nx + i;
                Vector128<double> around = Pair(a, c - 1) + Pair(a, c + 1) + Pair(a, c - nx) + Pair(a, c + nx) + Pair(a, c - nxy) + Pair(a, c + nxy);
                Vector128<double> ix = Vector128.Create((double)i, (double)(i + 1));
                Vector128<double> x = ix - Pair(u, c);
                Vector128<double> y = jv - Pair(v, c);
                Vector128<double> s = zv - Pair(w, c);
                // the truncations, per lane: a compare mask is -1 (x < cell: truncation is cell - 1) or 0 (it is the cell)
                Vector128<long> mx = Vector128.LessThan(x, ix).AsInt64();
                Vector128<long> my = Vector128.LessThan(y, jv).AsInt64();
                Vector128<long> mz = Vector128.LessThan(s, zv).AsInt64();
                int i0a = i + (int)mx.GetElement(0), i0b = i + 1 + (int)mx.GetElement(1);
                int j0a = j + (int)my.GetElement(0), j0b = j + (int)my.GetElement(1);
                int k0a = z + (int)mz.GetElement(0), k0b = z + (int)mz.GetElement(1);
                Vector128<double> fx = x - Vector128.ConditionalSelect(mx.AsDouble(), ix - one, ix);
                Vector128<double> fy = y - Vector128.ConditionalSelect(my.AsDouble(), jv - one, jv);
                Vector128<double> fz = s - Vector128.ConditionalSelect(mz.AsDouble(), zv - one, zv);
                int oa = k0a * nxy + j0a * nx + i0a;
                int ob = k0b * nxy + j0b * nx + i0b;
                Vector128<double> omx = one - fx;
                Vector128<double> omy = one - fy;
                Vector128<double> omz = one - fz;
                Vector128<double> c0 = (Gather(a, oa, ob) * omx + Gather(a, oa + 1, ob + 1) * fx) * omy
                                       + (Gather(a, oa + nx, ob + nx) * omx + Gather(a, oa + nx + 1, ob + nx + 1) * fx) * fy;
                Vector128<double> c1 = (Gather(a, oa + nxy, ob + nxy) * omx + Gather(a, oa + nxy + 1, ob + nxy + 1) * fx) * omy
                                       + (Gather(a, oa + nxy + nx, ob + nxy + nx) * omx + Gather(a, oa + nxy + nx + 1, ob + nxy + nx + 1) * fx) * fy;
                Vector128<double> r = k88 * (c0 * omz + c1 * fz) + k02 * around;
                b[c] = (float)r.GetElement(0);
                b[c + 1] = (float)r.GetElement(1);
            }
            if (i < nx - 1)
                Cell(a, b, u, v, w, nx, nxy, i, j, z, z * nxy + j * nx + i);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> Gather(float[] f, int ia, int ib) => Vector128.WidenLower(Vector128.Create(f[ia], f[ib], 0f, 0f));
}

/// <summary>K1 as a timed kernel: buffers, the fixed-seed inputs, the parts of a sweep.</summary>
public sealed class StencilKernel : ISpeedKernel
{
    readonly int _nx, _ny, _nz;
    readonly KernelPath _path;
    float[] _a, _b;
    readonly float[] _u, _v, _w;

    /// <summary>The app's kernel: 45 x 45 x 20 from the fixed seed.</summary>
    public StencilKernel(KernelPath path = KernelPath.Scalar)
        : this(SpeedTestConstants.StencilNx, SpeedTestConstants.StencilNy, SpeedTestConstants.StencilNz, SpeedTestConstants.Seed, path) { }

    /// <summary>The same construction on another grid or seed (for tests: other row lengths give other tail lengths). Needs nx, ny, nz &gt;= 3.</summary>
    public StencilKernel(int nx, int ny, int nz, uint seed, KernelPath path = KernelPath.Scalar)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(nx, 3);
        ArgumentOutOfRangeException.ThrowIfLessThan(ny, 3);
        ArgumentOutOfRangeException.ThrowIfLessThan(nz, 3);
        _nx = nx; _ny = ny; _nz = nz; _path = path;
        int n = nx * ny * nz;
        var rnd = new Lcg(seed);
        _a = new float[n];
        _b = new float[n];
        _u = new float[n];
        _v = new float[n];
        _w = new float[n];
        for (int i = 0; i < n; i++)
        {
            _a[i] = (float)rnd.Next();
            _u[i] = (float)(0.9 * (2 * rnd.Next() - 1));
            _v[i] = (float)(0.9 * (2 * rnd.Next() - 1));
            _w[i] = (float)(0.9 * (2 * rnd.Next() - 1));
        }
        Array.Copy(_a, _b, n); // the border is never written: both buffers hold the same border for ever
    }

    /// <summary>A kernel on caller-supplied state (copied), for edge-case tests (zero and tiny displacements). |displacement| must be under 1.</summary>
    public StencilKernel(int nx, int ny, int nz, float[] a, float[] u, float[] v, float[] w, KernelPath path)
    {
        _nx = nx; _ny = ny; _nz = nz; _path = path;
        _a = (float[])a.Clone();
        _b = (float[])a.Clone();
        _u = (float[])u.Clone();
        _v = (float[])v.Clone();
        _w = (float[])w.Clone();
    }

    public long Work => (long)(_nx - 2) * (_ny - 2) * (_nz - 2);
    public int Parts => _nz - 2;

    public void Part(int p)
    {
        if (_path == KernelPath.Vector128) StencilCore.PartVector128(_a, _b, _u, _v, _w, _nx, _ny, p);
        else if (_path == KernelPath.ScalarPlain) StencilCore.PartScalarPlain(_a, _b, _u, _v, _w, _nx, _ny, p);
        else StencilCore.PartScalar(_a, _b, _u, _v, _w, _nx, _ny, p);
    }

    public void End() => (_a, _b) = (_b, _a);

    public ReadOnlySpan<float> Values => _a;

    public uint Checksum() => SpeedTest.Fnv(_a);
}
