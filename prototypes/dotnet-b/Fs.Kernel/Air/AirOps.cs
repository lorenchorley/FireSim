using System.Runtime.CompilerServices;
using System.Runtime.Intrinsics;

namespace Fs.Kernel.Air;

/// <summary>
/// <c>EllipticSolver.gradient</c> and <c>EllipticSolver.divergence</c> (src/atmosphere/solver.ts) on the fine grid, with the solver's scratch arrays.
/// Plain + - * / only (no <c>sqrt</c>, no transcendental call, no float-to-integer conversion); every product and sum in the TypeScript's order. The Float64
/// arrays are read directly; float32 fields (the atmosphere's u, v, w) are widened per element (<see cref="F32Word"/>).
///
/// <b>Parallel structure.</b> Both kernels are two element-wise phases with a barrier between them (phase 1 builds the w-face quantities per plane m from the
/// planes m and m-1 of the input; phase 2 builds the u and v faces, or the cell divergence, per plane k from the planes k and k+1 of phase 1's output and the
/// input). Within a phase every plane writes its own planes of the outputs and reads only the input and the previous phase's output, so planes are independent
/// chunks (one plane each, a constant, not a function of the thread count). There is no reduction.
/// </summary>
public sealed class AirOps
{
    readonly AirGrid _g;
    public AirMasks Masks;
    readonly double[] _sx, _sy, _wt;
    /// <summary>The gradient's result arrays (scratch, reused by every call, as in the TypeScript).</summary>
    public readonly double[] Gu, Gv, Gw;
    readonly Action<int> _gradP1, _gradP2;
    double[] _phi = [];
    AirExec _exec;
    DivJob<float, F32Word>? _divF;
    DivJob<double, F64Word>? _divD;

    public AirOps(AirGrid g, AirMasks masks)
    {
        _g = g; Masks = masks;
        _sx = new double[g.NW]; _sy = new double[g.NW]; _wt = new double[g.NW];
        Gu = new double[g.NU]; Gv = new double[g.NV]; Gw = new double[g.NW];
        _gradP1 = GradPlane1;
        _gradP2 = GradPlane2;
    }

    // ───────────────────────────── gradient ─────────────────────────────

    /// <summary>Physical gradient G phi on every face (0 on inactive faces), written to <see cref="Gu"/>, <see cref="Gv"/>, <see cref="Gw"/>.</summary>
    public void Gradient(double[] phi, AirExec exec)
    {
        var g = _g;
        int nz = g.Nz, plane = g.Plane;
        double[] sx = _sx, sy = _sy, gw = Gw;
        for (int c = 0; c < plane; c++)
        {
            sx[c] = 0; sy[c] = 0; gw[c] = 0;
            sx[nz * plane + c] = 0; sy[nz * plane + c] = 0;
        }
        _phi = phi; _exec = exec;
        // phase 1: planes m = 1 .. nz-1 (the sx, sy and gw of the interior w-faces)
        AirPar.Chunks(nz - 1, exec.Threads, _gradP1);
        {
            int o = nz * plane, ob = (nz - 1) * plane;
            double dzw = g.DzetaW[nz];
            bool top = Masks.TopActive;
            for (int c = 0; c < plane; c++) gw[o + c] = top ? -phi[ob + c] / (g.J[c] * dzw) : 0;
        }
        // phase 2: planes k = 0 .. nz-1 (gu and gv)
        AirPar.Chunks(nz, exec.Threads, _gradP2);
        _phi = [];
    }

    void GradPlane1(int idx)
    {
        var g = _g;
        int m = idx + 1, plane = g.Plane;
        double fz = g.Fzeta[m], dzw = g.DzetaW[m];
        int o = m * plane, ob = (m - 1) * plane;
        double[] phi = _phi, zsx = g.Zsx, zsy = g.Zsy, jj = g.J, sx = _sx, sy = _sy, gw = Gw;
        int c = 0;
        if (_exec.Vector)
        {
            Vector128<double> fzv = Vector128.Create(fz), dzwv = Vector128.Create(dzw);
            for (; c + 1 < plane; c += 2)
            {
                Vector128<double> d = Vector128.Create(phi, o + c) - Vector128.Create(phi, ob + c);
                (Vector128.Create(zsx, c) * fzv * d).CopyTo(sx, o + c);
                (Vector128.Create(zsy, c) * fzv * d).CopyTo(sy, o + c);
                (d / (Vector128.Create(jj, c) * dzwv)).CopyTo(gw, o + c);
            }
        }
        for (; c < plane; c++)
        {
            double d = phi[o + c] - phi[ob + c];
            sx[o + c] = zsx[c] * fz * d;
            sy[o + c] = zsy[c] * fz * d;
            gw[o + c] = d / (jj[c] * dzw);
        }
    }

    void GradPlane2(int k)
    {
        var g = _g;
        int nx = g.Nx, ny = g.Ny, plane = g.Plane, nx1 = nx + 1;
        double dx = g.Dx;
        double inv2dx = 2 / dx, invdx = 1 / dx;
        double[] phi = _phi, sx = _sx, sy = _sy, gu = Gu, gv = Gv, ju = g.Ju, jv = g.Jv;
        byte[] activeU = Masks.ActiveU, activeV = Masks.ActiveV;
        bool vec = _exec.Vector;
        double dzk = g.Dzeta[k];
        int o = k * plane, o1 = (k + 1) * plane;
        Vector128<double> invdxv = Vector128.Create(invdx), dzkv = Vector128.Create(dzk), quarter = Vector128.Create(0.25);
        for (int j = 0; j < ny; j++)
        {
            int row = j * nx, fr = (k * ny + j) * nx1, jr = j * nx1;
            {   // west boundary
                int f = fr;
                if (activeU[f] != 0)
                {
                    int cR = row;
                    double cross = 0.25 * (sx[o + cR] + sx[o1 + cR]);
                    gu[f] = phi[o + cR] * inv2dx - cross / (ju[jr] * dzk * 0.5);
                }
                else gu[f] = 0;
            }
            int iu = 1;
            if (vec)
            {
                for (; iu + 1 < nx; iu += 2)
                {
                    int cL = row + iu - 1, cR = cL + 1;
                    Vector128<double> cross = quarter * (Vector128.Create(sx, o + cL) + Vector128.Create(sx, o1 + cL) + Vector128.Create(sx, o + cR) + Vector128.Create(sx, o1 + cR));
                    Vector128<double> r = (Vector128.Create(phi, o + cR) - Vector128.Create(phi, o + cL)) * invdxv - cross / (Vector128.Create(ju, jr + iu) * dzkv);
                    r.CopyTo(gu, fr + iu);
                }
            }
            for (; iu < nx; iu++)
            {
                int cL = row + iu - 1, cR = cL + 1;
                double cross = 0.25 * (sx[o + cL] + sx[o1 + cL] + sx[o + cR] + sx[o1 + cR]);
                gu[fr + iu] = (phi[o + cR] - phi[o + cL]) * invdx - cross / (ju[jr + iu] * dzk);
            }
            {   // east boundary
                int f = fr + nx;
                if (activeU[f] != 0)
                {
                    int cL = row + nx - 1;
                    double cross = 0.25 * (sx[o + cL] + sx[o1 + cL]);
                    gu[f] = -phi[o + cL] * inv2dx - cross / (ju[jr + nx] * dzk * 0.5);
                }
                else gu[f] = 0;
            }
        }
        for (int jvv = 0; jvv <= ny; jvv++)
        {
            int fr = (k * (ny + 1) + jvv) * nx, jr = jvv * nx;
            if (jvv == 0 || jvv == ny)
            {
                int cRow = jvv == 0 ? 0 : (ny - 1) * nx;
                double sgn = jvv == 0 ? 1 : -1;
                for (int i = 0; i < nx; i++)
                {
                    int f = fr + i;
                    if (activeV[f] == 0) { gv[f] = 0; continue; }
                    int c = cRow + i;
                    double cross = 0.25 * (sy[o + c] + sy[o1 + c]);
                    gv[f] = sgn * phi[o + c] * inv2dx - cross / (jv[jr + i] * dzk * 0.5);
                }
            }
            else
            {
                int rowS = (jvv - 1) * nx, rowN = jvv * nx;
                int i = 0;
                if (vec)
                {
                    for (; i + 1 < nx; i += 2)
                    {
                        int cS = rowS + i, cN = rowN + i;
                        Vector128<double> cross = quarter * (Vector128.Create(sy, o + cS) + Vector128.Create(sy, o1 + cS) + Vector128.Create(sy, o + cN) + Vector128.Create(sy, o1 + cN));
                        Vector128<double> r = (Vector128.Create(phi, o + cN) - Vector128.Create(phi, o + cS)) * invdxv - cross / (Vector128.Create(jv, jr + i) * dzkv);
                        r.CopyTo(gv, fr + i);
                    }
                }
                for (; i < nx; i++)
                {
                    int cS = rowS + i, cN = rowN + i;
                    double cross = 0.25 * (sy[o + cS] + sy[o1 + cS] + sy[o + cN] + sy[o1 + cN]);
                    gv[fr + i] = (phi[o + cN] - phi[o + cS]) * invdx - cross / (jv[jr + i] * dzk);
                }
            }
        }
    }

    // ───────────────────────────── divergence ─────────────────────────────

    /// <summary>Volume-integrated divergence of a float32 face field (the atmosphere's u, v, w): W~ = w - u z_x - v z_y on interior w-faces, 0 at the ground, w at the top; <paramref name="scaleU"/>, <paramref name="scaleW"/> multiply the horizontal and vertical components.</summary>
    public void Divergence(float[] u, float[] v, float[] w, double[] output, double scaleU, double scaleW, AirExec exec)
        => (_divF ??= new DivJob<float, F32Word>(this)).Run(u, v, w, output, scaleU, scaleW, exec);

    /// <summary>The same for a Float64 face field (the gradient's gu, gv, gw: <c>applyFull</c>).</summary>
    public void Divergence(double[] u, double[] v, double[] w, double[] output, double scaleU, double scaleW, AirExec exec)
        => (_divD ??= new DivJob<double, F64Word>(this)).Run(u, v, w, output, scaleU, scaleW, exec);

    sealed class DivJob<TE, TW> where TE : unmanaged where TW : struct, IAirWord<TE>
    {
        readonly AirOps _o;
        readonly Action<int> _p1, _p2;
        TE[] _u = [], _v = [], _w = [];
        double[] _out = [];
        double _su, _sw;
        bool _vec;

        public DivJob(AirOps o)
        {
            _o = o;
            _p1 = Plane1;
            _p2 = Plane2;
        }

        public void Run(TE[] u, TE[] v, TE[] w, double[] output, double scaleU, double scaleW, AirExec exec)
        {
            var g = _o._g;
            int nz = g.Nz, plane = g.Plane;
            double[] wt = _o._wt;
            _u = u; _v = v; _w = w; _out = output; _su = scaleU; _sw = scaleW; _vec = exec.Vector;
            for (int c = 0; c < plane; c++)
            {
                wt[c] = 0;
                wt[nz * plane + c] = scaleW * TW.Load(w, nz * plane + c);
            }
            AirPar.Chunks(nz - 1, exec.Threads, _p1);
            AirPar.Chunks(nz, exec.Threads, _p2);
            _u = _v = _w = [];
            _out = [];
        }

        void Plane1(int idx)
        {
            var g = _o._g;
            int m = idx + 1, nx = g.Nx, ny = g.Ny, plane = g.Plane, nx1 = nx + 1;
            double fz = g.Fzeta[m];
            int kb = m - 1, o = m * plane;
            double[] wt = _o._wt, zsx = g.Zsx, zsy = g.Zsy;
            TE[] u = _u, v = _v, w = _w;
            double scaleU = _su, scaleW = _sw;
            double kk = 0.25 * scaleU * fz;
            Vector128<double> kkv = Vector128.Create(kk), swv = Vector128.Create(scaleW);
            for (int j = 0; j < ny; j++)
            {
                int ub = (kb * ny + j) * nx1, ua = (m * ny + j) * nx1;
                int vb = (kb * (ny + 1) + j) * nx, va = (m * (ny + 1) + j) * nx;
                int i = 0;
                if (_vec)
                {
                    for (; i + 1 < nx; i += 2)
                    {
                        int c = j * nx + i;
                        Vector128<double> uS = TW.Load2(u, ub + i) + TW.Load2(u, ub + i + 1) + TW.Load2(u, ua + i) + TW.Load2(u, ua + i + 1);
                        Vector128<double> vS = TW.Load2(v, vb + i) + TW.Load2(v, vb + i + nx) + TW.Load2(v, va + i) + TW.Load2(v, va + i + nx);
                        (swv * TW.Load2(w, o + c) - kkv * (Vector128.Create(zsx, c) * uS + Vector128.Create(zsy, c) * vS)).CopyTo(wt, o + c);
                    }
                }
                for (; i < nx; i++)
                {
                    int c = j * nx + i;
                    double uS = TW.Load(u, ub + i) + TW.Load(u, ub + i + 1) + TW.Load(u, ua + i) + TW.Load(u, ua + i + 1);
                    double vS = TW.Load(v, vb + i) + TW.Load(v, vb + i + nx) + TW.Load(v, va + i) + TW.Load(v, va + i + nx);
                    wt[o + c] = scaleW * TW.Load(w, o + c) - 0.25 * scaleU * fz * (zsx[c] * uS + zsy[c] * vS);
                }
            }
        }

        void Plane2(int k)
        {
            var g = _o._g;
            int nx = g.Nx, ny = g.Ny, plane = g.Plane, nx1 = nx + 1;
            double dx = g.Dx;
            double area = dx * dx;
            double dzk = g.Dzeta[k];
            double hx = dx * dzk * _su;
            int o = k * plane, o1 = (k + 1) * plane;
            double[] wt = _o._wt, ju = g.Ju, jv = g.Jv, output = _out;
            TE[] u = _u, v = _v;
            Vector128<double> hxv = Vector128.Create(hx), areav = Vector128.Create(area);
            for (int j = 0; j < ny; j++)
            {
                int fu = (k * ny + j) * nx1, jur = j * nx1;
                int fv = (k * (ny + 1) + j) * nx, jvr = j * nx;
                int i = 0;
                if (_vec)
                {
                    for (; i + 1 < nx; i += 2)
                    {
                        int c = j * nx + i;
                        Vector128<double> a = hxv * (Vector128.Create(ju, jur + i + 1) * TW.Load2(u, fu + i + 1) - Vector128.Create(ju, jur + i) * TW.Load2(u, fu + i));
                        Vector128<double> b = hxv * (Vector128.Create(jv, jvr + i + nx) * TW.Load2(v, fv + i + nx) - Vector128.Create(jv, jvr + i) * TW.Load2(v, fv + i));
                        Vector128<double> d = areav * (Vector128.Create(wt, o1 + c) - Vector128.Create(wt, o + c));
                        (a + b + d).CopyTo(output, o + c);
                    }
                }
                for (; i < nx; i++)
                {
                    int c = j * nx + i;
                    output[o + c] =
                        hx * (ju[jur + i + 1] * TW.Load(u, fu + i + 1) - ju[jur + i] * TW.Load(u, fu + i)) +
                        hx * (jv[jvr + i + nx] * TW.Load(v, fv + i + nx) - jv[jvr + i] * TW.Load(v, fv + i)) +
                        area * (wt[o1 + c] - wt[o + c]);
                }
            }
        }
    }
}
