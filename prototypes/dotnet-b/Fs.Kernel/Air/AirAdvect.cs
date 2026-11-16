using System.Runtime.CompilerServices;
using System.Runtime.Intrinsics;

namespace Fs.Kernel.Air;

/// <summary>
/// <c>dynamics.advect</c> (src/atmosphere/dynamics.ts): semi-Lagrangian advection of a float32 field on a staggered grid, the departure point from the mean of
/// the two cell-centre displacements, trilinear in the field's own index space, clamped. float32 reads are widened, the arithmetic is double and the only
/// float32 rounding is the store (as the typed array). An optional second field shares the departure points.
///
/// The TypeScript truncates the clamped departure coordinate with <c>x | 0</c>; here <see cref="AirTrunc.NonNegative"/> does the same without a
/// float-to-integer cast (floor, then the low bits of floor + 2^52; NaN gives 0 as JavaScript's does; the result for a NaN displacement is then a NaN value, as in the TypeScript).
///
/// <b>Parallel structure.</b> Each destination element depends only on the read-only displacement and source arrays, so any set of output rows is independent:
/// the chunk is <see cref="RowsPerChunk"/> consecutive rows (kF, jF) of the output, a constant. No reduction.
/// <b>Vector form.</b> Two neighbouring points of a row in the two lanes; the departure coordinates, clamps, truncations (as exact integral doubles), weights and the
/// blend are vector; the eight source reads per lane are scalar gathers (the addresses are data dependent).
/// </summary>
public sealed class AirAdvect
{
    public const int RowsPerChunk = 16;

    readonly AirGrid _g;
    readonly Action<int> _chunk;
    float[] _dx = [], _dy = [], _dz = [], _src = [], _dst = [];
    float[]? _src2, _dst2;
    int _nxF, _nyF, _nzF;
    double _ox, _oy, _oz;
    bool _vec;

    public AirAdvect(AirGrid g)
    {
        _g = g;
        _chunk = Chunk;
    }

    public void Run(float[] dx, float[] dy, float[] dz, float[] src, float[] dst, int nxF, int nyF, int nzF, double ox, double oy, double oz, float[]? src2, float[]? dst2, AirExec exec)
    {
        _dx = dx; _dy = dy; _dz = dz; _src = src; _dst = dst; _src2 = src2; _dst2 = dst2;
        _nxF = nxF; _nyF = nyF; _nzF = nzF; _ox = ox; _oy = oy; _oz = oz; _vec = exec.Vector;
        int rows = nyF * nzF;
        AirPar.Chunks((rows + RowsPerChunk - 1) / RowsPerChunk, exec.Threads, _chunk);
        _src = _dst = _dx = _dy = _dz = [];
        _src2 = _dst2 = null;
    }

    void Chunk(int c)
    {
        int r0 = c * RowsPerChunk, r1 = Math.Min(_nyF * _nzF, r0 + RowsPerChunk);
        for (int r = r0; r < r1; r++) Row(r / _nyF, r % _nyF);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static double W(float[] f, int i) => F32Word.Load(f, i);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> G(float[] f, int a, int b) => F32Word.Gather2(f, a, b);

    void Row(int kF, int jF)
    {
        var g = _g;
        int nx = g.Nx, ny = g.Ny, nz = g.Nz, plane = g.Plane;
        int nxF = _nxF, nyF = _nyF, nzF = _nzF, planeF = nxF * nyF;
        double ox = _ox, oy = _oy, oz = _oz;
        int xF2 = nxF - 2, yF2 = nyF - 2, zF2 = nzF - 2;
        double xFmax = nxF - 1, yFmax = nyF - 1, zFmax = nzF - 1;
        int sxo = ox > 0 ? 1 : 0, syo = oy > 0 ? 1 : 0, szo = oz > 0 ? 1 : 0;
        float[] dx = _dx, dy = _dy, dz = _dz, src = _src, dst = _dst;
        float[]? src2 = _src2, dst2 = _dst2;

        double z = kF - oz;
        int k1 = kF < nz ? kF : nz - 1;
        int k0 = kF - szo < 0 ? 0 : kF - szo > nz - 1 ? nz - 1 : kF - szo;
        double y = jF - oy;
        int j1 = jF < ny ? jF : ny - 1;
        int j0 = jF - syo < 0 ? 0 : jF - syo > ny - 1 ? ny - 1 : jF - syo;
        int rowF = kF * planeF + jF * nxF;
        int r0 = k0 * plane + j0 * nx;
        int r1 = k1 * plane + j1 * nx;
        double yo = y + oy, zo = z + oz;   // the TypeScript's `y + oy` and `z + oz`, per row

        int iF = 0;
        if (_vec)
        {
            Vector128<double> half = Vector128.Create(0.5), zero = Vector128.Create(0.0), one = Vector128.Create(1.0);
            Vector128<double> yov = Vector128.Create(yo), zov = Vector128.Create(zo);
            Vector128<double> xmaxv = Vector128.Create(xFmax), ymaxv = Vector128.Create(yFmax), zmaxv = Vector128.Create(zFmax);
            Vector128<double> x2v = Vector128.Create((double)xF2), y2v = Vector128.Create((double)yF2), z2v = Vector128.Create((double)zF2);
            for (; iF + 1 < nxF; iF += 2)
            {
                int i1a = iF < nx ? iF : nx - 1, i1b = iF + 1 < nx ? iF + 1 : nx - 1;
                int i0a = iF - sxo < 0 ? 0 : iF - sxo > nx - 1 ? nx - 1 : iF - sxo;
                int i0b = iF + 1 - sxo < 0 ? 0 : iF + 1 - sxo > nx - 1 ? nx - 1 : iF + 1 - sxo;
                int c0a = r0 + i0a, c0b = r0 + i0b, c1a = r1 + i1a, c1b = r1 + i1b;
                Vector128<double> xd = Vector128.Create((double)iF, (double)(iF + 1)) - half * (G(dx, c0a, c0b) + G(dx, c1a, c1b));
                Vector128<double> yd = yov - half * (G(dy, c0a, c0b) + G(dy, c1a, c1b));
                Vector128<double> zd = zov - half * (G(dz, c0a, c0b) + G(dz, c1a, c1b));
                xd = Vector128.ConditionalSelect(Vector128.LessThan(xd, zero), zero, Vector128.ConditionalSelect(Vector128.GreaterThan(xd, xmaxv), xmaxv, xd));
                yd = Vector128.ConditionalSelect(Vector128.LessThan(yd, zero), zero, Vector128.ConditionalSelect(Vector128.GreaterThan(yd, ymaxv), ymaxv, yd));
                zd = Vector128.ConditionalSelect(Vector128.LessThan(zd, zero), zero, Vector128.ConditionalSelect(Vector128.GreaterThan(zd, zmaxv), zmaxv, zd));
                Vector128<double> fx = Trunc(xd, x2v, zero), fy = Trunc(yd, y2v, zero), fz = Trunc(zd, z2v, zero); // the integral doubles I, J, K (clamped), as exact +integers
                Vector128<double> tx = xd - fx, ty = yd - fy, tz = zd - fz;
                Vector128<long> bx = AirTrunc.Bits(fx), by = AirTrunc.Bits(fy), bz = AirTrunc.Bits(fz);
                int qa = (int)bz.GetElement(0) * planeF + (int)by.GetElement(0) * nxF + (int)bx.GetElement(0);
                int qb = (int)bz.GetElement(1) * planeF + (int)by.GetElement(1) * nxF + (int)bx.GetElement(1);
                Vector128<double> sx = one - tx, sy = one - ty, sz = one - tz;
                Vector128<double> w00 = sx * sy, w10 = tx * sy, w01 = sx * ty, w11 = tx * ty;
                Vector128<double> v = sz * (w00 * G(src, qa, qb) + w10 * G(src, qa + 1, qb + 1) + w01 * G(src, qa + nxF, qb + nxF) + w11 * G(src, qa + nxF + 1, qb + nxF + 1))
                                      + tz * (w00 * G(src, qa + planeF, qb + planeF) + w10 * G(src, qa + planeF + 1, qb + planeF + 1) + w01 * G(src, qa + planeF + nxF, qb + planeF + nxF) + w11 * G(src, qa + planeF + nxF + 1, qb + planeF + nxF + 1));
                dst[rowF + iF] = (float)v.GetElement(0);
                dst[rowF + iF + 1] = (float)v.GetElement(1);
                if (src2 is not null)
                {
                    Vector128<double> v2 = sz * (w00 * G(src2, qa, qb) + w10 * G(src2, qa + 1, qb + 1) + w01 * G(src2, qa + nxF, qb + nxF) + w11 * G(src2, qa + nxF + 1, qb + nxF + 1))
                                           + tz * (w00 * G(src2, qa + planeF, qb + planeF) + w10 * G(src2, qa + planeF + 1, qb + planeF + 1) + w01 * G(src2, qa + planeF + nxF, qb + planeF + nxF) + w11 * G(src2, qa + planeF + nxF + 1, qb + planeF + nxF + 1));
                    dst2![rowF + iF] = (float)v2.GetElement(0);
                    dst2[rowF + iF + 1] = (float)v2.GetElement(1);
                }
            }
        }
        for (; iF < nxF; iF++)
        {
            int i1 = iF < nx ? iF : nx - 1;
            int i0 = iF - sxo < 0 ? 0 : iF - sxo > nx - 1 ? nx - 1 : iF - sxo;
            int c0 = r0 + i0, c1 = r1 + i1;
            double xd = iF - 0.5 * (W(dx, c0) + W(dx, c1));
            double yd = yo - 0.5 * (W(dy, c0) + W(dy, c1));
            double zd = zo - 0.5 * (W(dz, c0) + W(dz, c1));
            xd = xd < 0 ? 0 : xd > xFmax ? xFmax : xd;
            yd = yd < 0 ? 0 : yd > yFmax ? yFmax : yd;
            zd = zd < 0 ? 0 : zd > zFmax ? zFmax : zd;
            int I = AirTrunc.NonNegative(xd);
            if (I > xF2) I = xF2;
            int J = AirTrunc.NonNegative(yd);
            if (J > yF2) J = yF2;
            int K = AirTrunc.NonNegative(zd);
            if (K > zF2) K = zF2;
            double tx = xd - I, ty = yd - J, tz = zd - K;
            int q = K * planeF + J * nxF + I;
            int a = q + 1, b = q + nxF, c = b + 1, d = q + planeF, e = d + 1, f = d + nxF, h = f + 1;
            double sx = 1 - tx, sy = 1 - ty, sz = 1 - tz;
            double w00 = sx * sy, w10 = tx * sy, w01 = sx * ty, w11 = tx * ty;
            dst[rowF + iF] = (float)(sz * (w00 * W(src, q) + w10 * W(src, a) + w01 * W(src, b) + w11 * W(src, c)) + tz * (w00 * W(src, d) + w10 * W(src, e) + w01 * W(src, f) + w11 * W(src, h)));
            if (src2 is not null)
                dst2![rowF + iF] = (float)(sz * (w00 * W(src2, q) + w10 * W(src2, a) + w01 * W(src2, b) + w11 * W(src2, c)) + tz * (w00 * W(src2, d) + w10 * W(src2, e) + w01 * W(src2, f) + w11 * W(src2, h)));
        }
    }

    /// <summary>x | 0 as an exact integral double per lane, then clamped to at most <paramref name="max"/> (the TypeScript's <c>if (I &gt; xF2) I = xF2</c>). NaN lanes give +0 (JavaScript's NaN | 0), and -0 gives +0.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> Trunc(Vector128<double> x, Vector128<double> max, Vector128<double> zero)
    {
        Vector128<double> fl = Vector128.ConditionalSelect(Vector128.Equals(x, x), Vector128.Floor(x), zero);
        fl = Vector128.ConditionalSelect(Vector128.GreaterThan(fl, max), max, fl);
        return fl + zero; // -0 + +0 = +0: the TypeScript subtracts the integer 0, not -0
    }
}
