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
    /// <summary>The scalar contract for one interior cell. Arithmetic is double, in the TypeScript's order; <paramref name="c"/> = z*nxy + j*nx + i.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static void Cell(float[] a, float[] b, float[] u, float[] v, float[] w, int nx, int nxy, int i, int j, int z, int c)
    {
        double around = (double)a[c - 1] + (double)a[c + 1] + (double)a[c - nx] + (double)a[c + nx] + (double)a[c - nxy] + (double)a[c + nxy];
        double x = i - (double)u[c];
        double y = j - (double)v[c];
        double s = z - (double)w[c];
        int i0 = x < i ? i - 1 : i; // == x | 0
        int j0 = y < j ? j - 1 : j;
        int k0 = s < z ? z - 1 : z;
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

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> Pair(float[] f, int idx) => Vector128.Create((double)f[idx], (double)f[idx + 1]);

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
                Vector128<double> x = Vector128.Create((double)i, (double)(i + 1)) - Pair(u, c);
                Vector128<double> y = jv - Pair(v, c);
                Vector128<double> s = zv - Pair(w, c);
                // the truncations, per lane, by integer arithmetic (as in Cell)
                int i0a = x.GetElement(0) < i ? i - 1 : i;
                int i0b = x.GetElement(1) < i + 1 ? i : i + 1;
                int j0a = y.GetElement(0) < j ? j - 1 : j;
                int j0b = y.GetElement(1) < j ? j - 1 : j;
                int k0a = s.GetElement(0) < z ? z - 1 : z;
                int k0b = s.GetElement(1) < z ? z - 1 : z;
                Vector128<double> fx = x - Vector128.Create((double)i0a, (double)i0b);
                Vector128<double> fy = y - Vector128.Create((double)j0a, (double)j0b);
                Vector128<double> fz = s - Vector128.Create((double)k0a, (double)k0b);
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
    static Vector128<double> Gather(float[] f, int ia, int ib) => Vector128.Create((double)f[ia], (double)f[ib]);
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
        else StencilCore.PartScalar(_a, _b, _u, _v, _w, _nx, _ny, p);
    }

    public void End() => (_a, _b) = (_b, _a);

    public ReadOnlySpan<float> Values => _a;

    public uint Checksum() => SpeedTest.Fnv(_a);
}
