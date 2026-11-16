// FsMath: the one place where the solver's transcendental maths functions are implemented (plan docs/plans/dotnet-option-b-plan.md, rule 5 and 10.4, card T1.3).
//
// Why: .NET's System.Math calls the platform's C library (glibc, bionic, musl, ...), whose results differ in the last bit between platforms. One solver must
// give the same bits on CoreCLR x64, CoreCLR arm64 and Mono WebAssembly, so every function below is implemented in managed code from basic IEEE operations
// (+ - * /, Math.Sqrt, Math.Abs, Math.Floor, Math.CopySign...), which every one of those runtimes executes identically. Nothing here calls Math.Exp, Math.Sin,
// Math.Pow, Math.FusedMultiplyAdd, TensorPrimitives or Vector<T>.
//
// This file is exempt from the solver analyzers by name (.editorconfig, [FsMath.cs]) because it must use raw double-to-integer casts and the like. Keep it
// the only exempt file of the maths: everything is in this one file on purpose.
//
// Implementations (FsMath.Implementation selects; the default is the one the T1.3 report recommends):
//   FdLibm         a managed port of the fdlibm algorithms as V8 12.4 (Node 22) compiles them (src/base/ieee754.cc, tag 12.4.254.21).
//   CoreMathSharp  AndanteSoft.CoreMathSharp 1.0.0 (MIT), vendored as source in ThirdParty/CoreMathSharp/: correctly rounded results (CORE-MATH).
// Hypot is the same in both: a literal port of V8's own Math.hypot (src/builtins/math.tq), which is not libm in any engine. Pow follows JavaScript's
// special cases in both (pow(1, +-Infinity) and pow(+-1, NaN) are NaN).
//
// ---- fdlibm notice (the FdLibm class is derived from V8's port, which is adapted from fdlibm) ----
// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================
// The original source code covered by the above license above has been
// modified significantly by Google Inc.
// Copyright 2016 the V8 project authors. All rights reserved.
// V8's changes are under its BSD 3-clause licence (V8 LICENSE, "Copyright 2014, the V8 project authors. All rights reserved."): redistributions of source
// code must retain the above copyright notice, this list of conditions and the following disclaimer: THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND
// CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED; the name of Google Inc. may not be used to endorse derived products.
// Full texts: ThirdParty/FdLibm-NOTICE.md.

using System.Runtime.CompilerServices;

namespace Fs.Kernel;

/// <summary>Which managed implementation <see cref="FsMath"/> uses.</summary>
public enum FsMathImplementation
{
    /// <summary>The managed fdlibm port, aiming at the bits of Node 22's (V8 12.4) <c>Math</c>.</summary>
    FdLibm = 0,
    /// <summary>CoreMathSharp (a port of CORE-MATH): correctly rounded.</summary>
    CoreMathSharp = 1,
}

/// <summary>
/// Deterministic replacements for the transcendental <c>System.Math</c> functions the solver uses. Same bits on every runtime. See the file header.
/// </summary>
public static class FsMath
{
    private static FsMathImplementation s_impl = FsMathImplementation.FdLibm;

    /// <summary>Selects the implementation of every function below. Process-wide; set it once at start-up (tests and benchmarks switch it).</summary>
    public static FsMathImplementation Implementation
    {
        get => s_impl;
        set => s_impl = value;
    }

    public static double Exp(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Exp(x) : CoreMath.Exp(x);
    public static double Log(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Log(x) : CoreMath.Log(x);
    /// <summary>JavaScript's <c>Math.pow</c> / <c>**</c> (pow(1, +-Infinity) and pow(+-1, NaN) are NaN, pow(x, +-0) is 1 even for NaN).</summary>
    public static double Pow(double x, double y) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Pow(x, y) : CoreMath.Pow(x, y);
    public static double Sin(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Sin(x) : CoreMath.Sin(x);
    public static double Cos(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Cos(x) : CoreMath.Cos(x);
    public static double Tan(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Tan(x) : CoreMath.Tan(x);
    public static double Atan(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Atan(x) : CoreMath.Atan(x);
    public static double Atan2(double y, double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Atan2(y, x) : CoreMath.Atan2(y, x);
    public static double Acos(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Acos(x) : CoreMath.Acos(x);
    public static double Asin(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Asin(x) : CoreMath.Asin(x);
    public static double Sinh(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Sinh(x) : CoreMath.Sinh(x);
    public static double Cbrt(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Cbrt(x) : CoreMath.Cbrt(x);
    public static double Log2(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Log2(x) : CoreMath.Log2(x);
    public static double Log10(double x) => s_impl == FsMathImplementation.FdLibm ? FdLibm.Log10(x) : CoreMath.Log10(x);

    /// <summary>V8's <c>Math.hypot(x, y)</c>, ported literally (same for both implementations).</summary>
    public static double Hypot(double x, double y) => V8Hypot.Hypot(x, y);
    /// <summary>V8's <c>Math.hypot(x, y, z)</c>.</summary>
    public static double Hypot(double x, double y, double z) => V8Hypot.Hypot(x, y, z);

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    // V8's Math.hypot (src/builtins/math.tq, MathHypot): scale by the largest absolute value, Kahan-compensated sum of the squares, sqrt, scale back.
    // Not libm: only + - * / and Sqrt. Special cases as V8: any infinity gives +Infinity even beside a NaN, then any NaN gives NaN, then all zeros give +0.
    // ------------------------------------------------------------------------------------------------------------------------------------------------
    internal static class V8Hypot
    {
        public static double Hypot(double x, double y)
        {
            double ax = 0, ay = 0, max = 0;
            bool nan = false;
            if (double.IsNaN(x)) nan = true; else { ax = Math.Abs(x); if (ax > max) max = ax; }
            if (double.IsNaN(y)) nan = true; else { ay = Math.Abs(y); if (ay > max) max = ay; }
            if (max == double.PositiveInfinity) return double.PositiveInfinity;
            if (nan) return double.NaN;
            if (max == 0) return 0.0;
            double sum = 0, comp = 0;
            Step(ax, max, ref sum, ref comp);
            Step(ay, max, ref sum, ref comp);
            return Math.Sqrt(sum) * max;
        }

        public static double Hypot(double x, double y, double z)
        {
            double ax = 0, ay = 0, az = 0, max = 0;
            bool nan = false;
            if (double.IsNaN(x)) nan = true; else { ax = Math.Abs(x); if (ax > max) max = ax; }
            if (double.IsNaN(y)) nan = true; else { ay = Math.Abs(y); if (ay > max) max = ay; }
            if (double.IsNaN(z)) nan = true; else { az = Math.Abs(z); if (az > max) max = az; }
            if (max == double.PositiveInfinity) return double.PositiveInfinity;
            if (nan) return double.NaN;
            if (max == 0) return 0.0;
            double sum = 0, comp = 0;
            Step(ax, max, ref sum, ref comp);
            Step(ay, max, ref sum, ref comp);
            Step(az, max, ref sum, ref comp);
            return Math.Sqrt(sum) * max;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static void Step(double abs, double max, ref double sum, ref double compensation)
        {
            double n = abs / max;
            double summand = n * n - compensation;
            double preliminary = sum + summand;
            compensation = (preliminary - sum) - summand;
            sum = preliminary;
        }
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    // CoreMathSharp wiring (the vendored sources are in ThirdParty/CoreMathSharp; they provide every function the solver uses, so there is no fallback).
    // ------------------------------------------------------------------------------------------------------------------------------------------------
    /// <summary>The CoreMathSharp (CORE-MATH, correctly rounded) implementation.</summary>
    public static class CoreMath
    {
        public static double Exp(double x) => CoreMathSharp.StrictMath.Exp(x);
        public static double Log(double x) => CoreMathSharp.StrictMath.Log(x);
        public static double Sin(double x) => CoreMathSharp.StrictMath.Sin(x);
        public static double Cos(double x) => CoreMathSharp.StrictMath.Cos(x);
        public static double Tan(double x) => CoreMathSharp.StrictMath.Tan(x);
        public static double Atan(double x) => CoreMathSharp.StrictMath.Atan(x);
        public static double Atan2(double y, double x) => CoreMathSharp.StrictMath.Atan2(y, x);
        public static double Acos(double x) => CoreMathSharp.StrictMath.Acos(x);
        public static double Asin(double x) => CoreMathSharp.StrictMath.Asin(x);
        public static double Sinh(double x) => CoreMathSharp.StrictMath.Sinh(x);
        public static double Cbrt(double x) => CoreMathSharp.StrictMath.Cbrt(x);
        public static double Log2(double x) => CoreMathSharp.StrictMath.Log2(x);
        public static double Log10(double x) => CoreMathSharp.StrictMath.Log10(x);

        /// <summary>JavaScript's pow special cases on top of the IEEE (C99) correctly rounded pow.</summary>
        public static double Pow(double x, double y)
        {
            if (y == 0) return 1.0;                                      // x ** +-0 is 1, also for NaN x
            if (double.IsNaN(y) || double.IsNaN(x)) return double.NaN;   // C99 gives 1 for pow(1, NaN); JavaScript gives NaN
            if (double.IsInfinity(y) && Math.Abs(x) == 1.0) return double.NaN; // C99 gives 1 for pow(+-1, +-Infinity); JavaScript gives NaN
            return CoreMathSharp.StrictMath.Pow(x, y);
        }
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    // FdLibm: the fdlibm algorithms as V8 12.4 compiles them (src/base/ieee754.cc). The C++ macros EXTRACT_WORDS and friends become the helpers below;
    // int32/uint32 arithmetic wraps as in the C++ (the C# default is unchecked). The signaling NaNs V8 returns are plain NaN here (the sign and payload of a
    // NaN are not specified by the solver: hashes canonicalise NaN, plan 10.4).
    // ------------------------------------------------------------------------------------------------------------------------------------------------
    /// <summary>The managed fdlibm port: aims at the bits of Node 22 (V8 12.4) <c>Math</c>.</summary>
    public static class FdLibm
    {
        // ---- the word macros ----
        [MethodImpl(MethodImplOptions.AggressiveInlining)] private static int Hi(double d) => (int)(BitConverter.DoubleToUInt64Bits(d) >> 32);
        [MethodImpl(MethodImplOptions.AggressiveInlining)] private static uint Lo(double d) => (uint)BitConverter.DoubleToUInt64Bits(d);
        [MethodImpl(MethodImplOptions.AggressiveInlining)] private static double FromWords(int hi, uint lo) => BitConverter.UInt64BitsToDouble(((ulong)(uint)hi << 32) | lo);
        [MethodImpl(MethodImplOptions.AggressiveInlining)] private static double WithLo(double d, uint lo) => BitConverter.UInt64BitsToDouble((BitConverter.DoubleToUInt64Bits(d) & 0xFFFFFFFF00000000UL) | lo);
        [MethodImpl(MethodImplOptions.AggressiveInlining)] private static double WithHi(double d, int hi) => BitConverter.UInt64BitsToDouble((BitConverter.DoubleToUInt64Bits(d) & 0x00000000FFFFFFFFUL) | ((ulong)(uint)hi << 32));

        /// <summary>scalbn as in musl/fdlibm: x * 2^n with one rounding (only the subnormal results round).</summary>
        private static double Scalbn(double x, int n)
        {
            double y = x;
            if (n > 1023)
            {
                y *= 8.98846567431158E+307; // 2^1023
                n -= 1023;
                if (n > 1023)
                {
                    y *= 8.98846567431158E+307;
                    n -= 1023;
                    if (n > 1023) n = 1023;
                }
            }
            else if (n < -1022)
            {
                // make sure the final n < -53 to avoid double rounding in the subnormal range
                y *= 2.2250738585072014E-308 * 9007199254740992.0; // 2^-1022 * 2^53
                n += 1022 - 53;
                if (n < -1022)
                {
                    y *= 2.2250738585072014E-308 * 9007199254740992.0;
                    n += 1022 - 53;
                    if (n < -1022) n = -1022;
                }
            }
            return y * BitConverter.UInt64BitsToDouble((ulong)(0x3ff + n) << 52);
        }

        // ================================================================ argument reduction and kernels (sin, cos, tan) ================================================================

        private static ReadOnlySpan<int> TwoOverPi => new int[]
        {
            0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
            0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
            0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
            0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
            0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
            0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
            0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
            0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
            0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
            0x73A8C9, 0x60E27B, 0xC08C6B,
        };

        private static ReadOnlySpan<int> NPio2Hw => new int[]
        {
            0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
            0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
            0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
            0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
            0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
            0x404858EB, 0x404921FB,
        };

        private const double InvPio2 = 6.36619772367581382433e-01;  // 0x3FE45F30, 0x6DC9C883
        private const double Pio2_1 = 1.57079632673412561417e+00;   // 0x3FF921FB, 0x54400000
        private const double Pio2_1t = 6.07710050650619224932e-11;  // 0x3DD0B461, 0x1A626331
        private const double Pio2_2 = 6.07710050630396597660e-11;   // 0x3DD0B461, 0x1A600000
        private const double Pio2_2t = 2.02226624879595063154e-21;  // 0x3BA3198A, 0x2E037073
        private const double Pio2_3 = 2.02226624871116645580e-21;   // 0x3BA3198A, 0x2E000000
        private const double Pio2_3t = 8.47842766036889956997e-32;  // 0x397B839A, 0x252049C1
        private const double Two24 = 1.67772160000000000000e+07;    // 0x41700000, 0x00000000
        private const double TwoN24 = 5.96046447753906250000e-08;   // 0x3E700000, 0x00000000

        /// <summary>__ieee754_rem_pio2: x rem pi/2 as y0 + y1; returns n mod 8 (sign applied).</summary>
        private static int RemPio2(double x, out double y0, out double y1)
        {
            double z, w, t, r, fn;
            int hx = Hi(x);
            int ix = hx & 0x7FFFFFFF;
            if (ix <= 0x3FE921FB) { y0 = x; y1 = 0; return 0; } // |x| ~<= pi/4, no need for reduction
            if (ix < 0x4002D97C) // |x| < 3pi/4, special case with n=+-1
            {
                if (hx > 0)
                {
                    z = x - Pio2_1;
                    if (ix != 0x3FF921FB) // 33+53 bit pi is good enough
                    {
                        y0 = z - Pio2_1t;
                        y1 = (z - y0) - Pio2_1t;
                    }
                    else // near pi/2, use 33+33+53 bit pi
                    {
                        z -= Pio2_2;
                        y0 = z - Pio2_2t;
                        y1 = (z - y0) - Pio2_2t;
                    }
                    return 1;
                }
                else // negative x
                {
                    z = x + Pio2_1;
                    if (ix != 0x3FF921FB)
                    {
                        y0 = z + Pio2_1t;
                        y1 = (z - y0) + Pio2_1t;
                    }
                    else
                    {
                        z += Pio2_2;
                        y0 = z + Pio2_2t;
                        y1 = (z - y0) + Pio2_2t;
                    }
                    return -1;
                }
            }
            if (ix <= 0x413921FB) // |x| ~<= 2^19*(pi/2), medium size
            {
                t = Math.Abs(x);
                int n = (int)(t * InvPio2 + 0.5);
                fn = n;
                r = t - fn * Pio2_1;
                w = fn * Pio2_1t; // 1st round good to 85 bit
                if (n < 32 && ix != NPio2Hw[n - 1])
                {
                    y0 = r - w; // quick check no cancellation
                }
                else
                {
                    int j = ix >> 20;
                    y0 = r - w;
                    uint high = (uint)Hi(y0);
                    int i = j - (int)((high >> 20) & 0x7FF);
                    if (i > 16) // 2nd iteration needed, good to 118
                    {
                        t = r;
                        w = fn * Pio2_2;
                        r = t - w;
                        w = fn * Pio2_2t - ((t - r) - w);
                        y0 = r - w;
                        high = (uint)Hi(y0);
                        i = j - (int)((high >> 20) & 0x7FF);
                        if (i > 49) // 3rd iteration need, 151 bits acc
                        {
                            t = r; // will cover all possible cases
                            w = fn * Pio2_3;
                            r = t - w;
                            w = fn * Pio2_3t - ((t - r) - w);
                            y0 = r - w;
                        }
                    }
                }
                y1 = (r - y0) - w;
                if (hx < 0)
                {
                    y0 = -y0;
                    y1 = -y1;
                    return -n;
                }
                return n;
            }
            // all other (large) arguments
            if (ix >= 0x7FF00000) { y0 = y1 = x - x; return 0; } // x is inf or NaN
            // set z = scalbn(|x|, ilogb(x)-23)
            uint low = Lo(x);
            int e0 = (ix >> 20) - 1046; // e0 = ilogb(z)-23
            z = FromWords(ix - (int)((uint)e0 << 20), low);
            Span<double> tx = stackalloc double[3];
            for (int i = 0; i < 2; i++)
            {
                tx[i] = (int)z;
                z = (z - tx[i]) * Two24;
            }
            tx[2] = z;
            int nx = 3;
            while (tx[nx - 1] == 0.0) nx--; // skip zero term
            int nn = KernelRemPio2(tx, out y0, out y1, e0, nx);
            if (hx < 0)
            {
                y0 = -y0;
                y1 = -y1;
                return -nn;
            }
            return nn;
        }

        private static ReadOnlySpan<double> PIo2 => new double[]
        {
            1.57079625129699707031e+00, // 0x3FF921FB, 0x40000000
            7.54978941586159635335e-08, // 0x3E74442D, 0x00000000
            5.39030252995776476554e-15, // 0x3CF84698, 0x80000000
            3.28200341580791294123e-22, // 0x3B78CC51, 0x60000000
            1.27065575308067607349e-29, // 0x39F01B83, 0x80000000
            1.22933308981111328932e-36, // 0x387A2520, 0x40000000
            2.73370053816464559624e-44, // 0x36E38222, 0x80000000
            2.16741683877804819444e-51, // 0x3569F31D, 0x00000000
        };

        /// <summary>__kernel_rem_pio2 with prec = 2 (the only precision rem_pio2 uses): y = x - N*pi/2, returns N mod 8.</summary>
        private static int KernelRemPio2(Span<double> x, out double y0, out double y1, int e0, int nx)
        {
            ReadOnlySpan<int> ipio2 = TwoOverPi;
            ReadOnlySpan<double> pio2 = PIo2;
            Span<int> iq = stackalloc int[20];
            Span<double> f = stackalloc double[20];
            Span<double> fq = stackalloc double[20];
            Span<double> q = stackalloc double[20];
            iq.Clear(); f.Clear(); fq.Clear(); q.Clear();

            int jk = 4; // init_jk[2]
            int jp = jk;
            int jz, jx, jv, carry, n, i, j, k, m, q0, ih;
            double z, fw;

            // determine jx, jv, q0, note that 3 > q0
            jx = nx - 1;
            jv = (e0 - 3) / 24;
            if (jv < 0) jv = 0;
            q0 = e0 - 24 * (jv + 1);

            // set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk]
            j = jv - jx;
            m = jx + jk;
            for (i = 0; i <= m; i++, j++) f[i] = (j < 0) ? 0.0 : ipio2[j];

            // compute q[0], q[1], ... q[jk]
            for (i = 0; i <= jk; i++)
            {
                for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
                q[i] = fw;
            }

            jz = jk;
        recompute:
            // distill q[] into iq[] reversingly
            for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--)
            {
                fw = (int)(TwoN24 * z);
                iq[i] = (int)(z - Two24 * fw);
                z = q[j - 1] + fw;
            }

            // compute n
            z = Scalbn(z, q0);                 // actual value of z
            z -= 8.0 * Math.Floor(z * 0.125);  // trim off integer >= 8
            n = (int)z;
            z -= n;
            ih = 0;
            if (q0 > 0) // need iq[jz-1] to determine n
            {
                i = iq[jz - 1] >> (24 - q0);
                n += i;
                iq[jz - 1] -= i << (24 - q0);
                ih = iq[jz - 1] >> (23 - q0);
            }
            else if (q0 == 0)
            {
                ih = iq[jz - 1] >> 23;
            }
            else if (z >= 0.5)
            {
                ih = 2;
            }

            if (ih > 0) // q > 0.5
            {
                n += 1;
                carry = 0;
                for (i = 0; i < jz; i++) // compute 1-q
                {
                    j = iq[i];
                    if (carry == 0)
                    {
                        if (j != 0)
                        {
                            carry = 1;
                            iq[i] = 0x1000000 - j;
                        }
                    }
                    else
                    {
                        iq[i] = 0xFFFFFF - j;
                    }
                }
                if (q0 > 0) // rare case: chance is 1 in 12
                {
                    switch (q0)
                    {
                        case 1: iq[jz - 1] &= 0x7FFFFF; break;
                        case 2: iq[jz - 1] &= 0x3FFFFF; break;
                    }
                }
                if (ih == 2)
                {
                    z = 1.0 - z;
                    if (carry != 0) z -= Scalbn(1.0, q0);
                }
            }

            // check if recomputation is needed
            if (z == 0.0)
            {
                j = 0;
                for (i = jz - 1; i >= jk; i--) j |= iq[i];
                if (j == 0) // need recomputation
                {
                    for (k = 1; jk >= k && iq[jk - k] == 0; k++) { } // k = no. of terms needed
                    for (i = jz + 1; i <= jz + k; i++) // add q[jz+1] to q[jz+k]
                    {
                        f[jx + i] = ipio2[jv + i];
                        for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
                        q[i] = fw;
                    }
                    jz += k;
                    goto recompute;
                }
            }

            // chop off zero terms
            if (z == 0.0)
            {
                jz -= 1;
                q0 -= 24;
                while (iq[jz] == 0)
                {
                    jz--;
                    q0 -= 24;
                }
            }
            else // break z into 24-bit if necessary
            {
                z = Scalbn(z, -q0);
                if (z >= Two24)
                {
                    fw = (int)(TwoN24 * z);
                    iq[jz] = (int)(z - Two24 * fw);
                    jz += 1;
                    q0 += 24;
                    iq[jz] = (int)fw;
                }
                else
                {
                    iq[jz] = (int)z;
                }
            }

            // convert integer "bit" chunk to floating-point value
            fw = Scalbn(1.0, q0);
            for (i = jz; i >= 0; i--)
            {
                q[i] = fw * iq[i];
                fw *= TwoN24;
            }

            // compute PIo2[0,...,jp]*q[jz,...,0]
            for (i = jz; i >= 0; i--)
            {
                for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += pio2[k] * q[i + k];
                fq[jz - i] = fw;
            }

            // compress fq[] into y[] (prec 2)
            fw = 0.0;
            for (i = jz; i >= 0; i--) fw += fq[i];
            y0 = (ih == 0) ? fw : -fw;
            fw = fq[0] - fw;
            for (i = 1; i <= jz; i++) fw += fq[i];
            y1 = (ih == 0) ? fw : -fw;
            return n & 7;
        }

        // __kernel_cos
        private static double KernelCos(double x, double y)
        {
            const double one = 1.00000000000000000000e+00;
            const double C1 = 4.16666666666666019037e-02;   // 0x3FA55555, 0x5555554C
            const double C2 = -1.38888888888741095749e-03;  // 0xBF56C16C, 0x16C15177
            const double C3 = 2.48015872894767294178e-05;   // 0x3EFA01A0, 0x19CB1590
            const double C4 = -2.75573143513906633035e-07;  // 0xBE927E4F, 0x809C52AD
            const double C5 = 2.08757232129817482790e-09;   // 0x3E21EE9E, 0xBDB4B1C4
            const double C6 = -1.13596475577881948265e-11;  // 0xBDA8FAE9, 0xBE8838D4

            double a, iz, z, r, qx;
            int ix = Hi(x) & 0x7FFFFFFF; // ix = |x|'s high word
            if (ix < 0x3E400000) // if x < 2**-27
            {
                if ((int)x == 0) return one; // generate inexact
            }
            z = x * x;
            r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
            if (ix < 0x3FD33333) // if |x| < 0.3
            {
                return one - (0.5 * z - (z * r - x * y));
            }
            if (ix > 0x3FE90000) // x > 0.78125
            {
                qx = 0.28125;
            }
            else
            {
                qx = FromWords(ix - 0x00200000, 0); // x/4
            }
            iz = 0.5 * z - qx;
            a = one - qx;
            return a - (iz - (z * r - x * y));
        }

        // __kernel_sin
        private static double KernelSin(double x, double y, int iy)
        {
            const double half = 5.00000000000000000000e-01;
            const double S1 = -1.66666666666666324348e-01;  // 0xBFC55555, 0x55555549
            const double S2 = 8.33333333332248946124e-03;   // 0x3F811111, 0x1110F8A6
            const double S3 = -1.98412698298579493134e-04;  // 0xBF2A01A0, 0x19C161D5
            const double S4 = 2.75573137070700676789e-06;   // 0x3EC71DE3, 0x57B1FE7D
            const double S5 = -2.50507602534068634195e-08;  // 0xBE5AE5E6, 0x8A2B9CEB
            const double S6 = 1.58969099521155010221e-10;   // 0x3DE5D93A, 0x5ACFD57C

            double z, r, v;
            int ix = Hi(x) & 0x7FFFFFFF; // high word of x
            if (ix < 0x3E400000) // |x| < 2**-27
            {
                if ((int)x == 0) return x; // generate inexact
            }
            z = x * x;
            v = z * x;
            r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
            if (iy == 0) return x + v * (S1 + z * r);
            return x - ((z * (half * y - v * r) - y) - v * S1);
        }

        // __kernel_tan
        private static double KernelTan(double x, double y, int iy)
        {
            const double T0 = 3.33333333333334091986e-01;    // 3FD55555, 55555563
            const double T1 = 1.33333333333201242699e-01;    // 3FC11111, 1110FE7A
            const double T2 = 5.39682539762260521377e-02;    // 3FABA1BA, 1BB341FE
            const double T3 = 2.18694882948595424599e-02;    // 3F9664F4, 8406D637
            const double T4 = 8.86323982359930005737e-03;    // 3F8226E3, E96E8493
            const double T5 = 3.59207910759131235356e-03;    // 3F6D6D22, C9560328
            const double T6 = 1.45620945432529025516e-03;    // 3F57DBC8, FEE08315
            const double T7 = 5.88041240820264096874e-04;    // 3F4344D8, F2F26501
            const double T8 = 2.46463134818469906812e-04;    // 3F3026F7, 1A8D1068
            const double T9 = 7.81794442939557092300e-05;    // 3F147E88, A03792A6
            const double T10 = 7.14072491382608190305e-05;   // 3F12B80F, 32F0A7E9
            const double T11 = -1.85586374855275456654e-05;  // BEF375CB, DB605373
            const double T12 = 2.59073051863633712884e-05;   // 3EFB2A70, 74BF7AD4
            const double one = 1.00000000000000000000e+00;
            const double pio4 = 7.85398163397448278999e-01;  // 3FE921FB, 54442D18
            const double pio4lo = 3.06161699786838301793e-17; // 3C81A626, 33145C07

            double z, r, v, w, s;
            int hx = Hi(x);           // high word of x
            int ix = hx & 0x7FFFFFFF; // high word of |x|
            if (ix < 0x3E300000) // x < 2**-28
            {
                if ((int)x == 0) // generate inexact
                {
                    uint low = Lo(x);
                    if (((uint)ix | low | (uint)(iy + 1)) == 0)
                    {
                        return one / Math.Abs(x);
                    }
                    if (iy == 1) return x;
                    // compute -1 / (x+y) carefully
                    double a, t;
                    z = w = x + y;
                    z = WithLo(z, 0);
                    v = y - (z - x);
                    t = a = -one / w;
                    t = WithLo(t, 0);
                    s = one + t * z;
                    return t + a * (s + t * v);
                }
            }
            if (ix >= 0x3FE59428) // |x| >= 0.6744
            {
                if (hx < 0)
                {
                    x = -x;
                    y = -y;
                }
                z = pio4 - x;
                w = pio4lo - y;
                x = z + w;
                y = 0.0;
            }
            z = x * x;
            w = z * z;
            // Break x^5*(T[1]+x^2*T[2]+...) into x^5(T[1]+x^4*T[3]+...+x^20*T[11]) + x^5(x^2*(T[2]+x^4*T[4]+...+x^22*[T12]))
            r = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
            v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))));
            s = z * x;
            r = y + z * (s * (r + v) + y);
            r += T0 * s;
            w = x + r;
            if (ix >= 0x3FE59428)
            {
                v = iy;
                return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
            }
            if (iy == 1) return w;
            // compute -1.0 / (x+r) accurately
            {
                double a, t;
                z = w;
                z = WithLo(z, 0);
                v = r - (z - x);   // z+v = r+x
                t = a = -1.0 / w;  // a = -1.0/w
                t = WithLo(t, 0);
                s = 1.0 + t * z;
                return t + a * (s + t * v);
            }
        }

        /// <summary>Math.cos as V8 12.4 (fdlibm).</summary>
        public static double Cos(double x)
        {
            int ix = Hi(x) & 0x7FFFFFFF;
            if (ix <= 0x3FE921FB) return KernelCos(x, 0.0); // |x| ~< pi/4
            if (ix >= 0x7FF00000) return x - x;             // cos(Inf or NaN) is NaN
            int n = RemPio2(x, out double y0, out double y1);
            switch (n & 3)
            {
                case 0: return KernelCos(y0, y1);
                case 1: return -KernelSin(y0, y1, 1);
                case 2: return -KernelCos(y0, y1);
                default: return KernelSin(y0, y1, 1);
            }
        }

        /// <summary>Math.sin as V8 12.4 (fdlibm).</summary>
        public static double Sin(double x)
        {
            int ix = Hi(x) & 0x7FFFFFFF;
            if (ix <= 0x3FE921FB) return KernelSin(x, 0.0, 0); // |x| ~< pi/4
            if (ix >= 0x7FF00000) return x - x;                // sin(Inf or NaN) is NaN
            int n = RemPio2(x, out double y0, out double y1);
            switch (n & 3)
            {
                case 0: return KernelSin(y0, y1, 1);
                case 1: return KernelCos(y0, y1);
                case 2: return -KernelSin(y0, y1, 1);
                default: return -KernelCos(y0, y1);
            }
        }

        /// <summary>Math.tan as V8 12.4 (fdlibm).</summary>
        public static double Tan(double x)
        {
            int ix = Hi(x) & 0x7FFFFFFF;
            if (ix <= 0x3FE921FB) return KernelTan(x, 0.0, 1); // |x| ~< pi/4
            if (ix >= 0x7FF00000) return x - x;                // tan(Inf or NaN) is NaN
            int n = RemPio2(x, out double y0, out double y1);
            return KernelTan(y0, y1, 1 - ((n & 1) << 1));      // 1 -> n even, -1 -> n odd
        }

        // ================================================================ inverse trigonometric ================================================================

        private const double PiHi = 3.14159265358979311600e+00;      // 0x400921FB, 0x54442D18
        private const double Pio2Hi = 1.57079632679489655800e+00;   // 0x3FF921FB, 0x54442D18
        private const double Pio2Lo = 6.12323399573676603587e-17;   // 0x3C91A626, 0x33145C07
        private const double Pio4Hi = 7.85398163397448278999e-01;   // 0x3FE921FB, 0x54442D18
        private const double pS0 = 1.66666666666666657415e-01;      // 0x3FC55555, 0x55555555
        private const double pS1 = -3.25565818622400915405e-01;     // 0xBFD4D612, 0x03EB6F7D
        private const double pS2 = 2.01212532134862925881e-01;      // 0x3FC9C155, 0x0E884455
        private const double pS3 = -4.00555345006794114027e-02;     // 0xBFA48228, 0xB5688F3B
        private const double pS4 = 7.91534994289814532176e-04;      // 0x3F49EFE0, 0x7501B288
        private const double pS5 = 3.47933107596021167570e-05;      // 0x3F023DE1, 0x0DFDF709
        private const double qS1 = -2.40339491173441421878e+00;     // 0xC0033A27, 0x1C8A2D4B
        private const double qS2 = 2.02094576023350569471e+00;      // 0x40002AE5, 0x9C598AC8
        private const double qS3 = -6.88283971605453293030e-01;     // 0xBFE6066C, 0x1B8D0159
        private const double qS4 = 7.70381505559019352791e-02;      // 0x3FB3B8C5, 0xB12E9282

        /// <summary>Math.acos as V8 12.4 (fdlibm).</summary>
        public static double Acos(double x)
        {
            const double one = 1.00000000000000000000e+00;
            double z, p, q, r, w, s, c, df;
            int hx = Hi(x);
            int ix = hx & 0x7FFFFFFF;
            if (ix >= 0x3FF00000) // |x| >= 1
            {
                uint lx = Lo(x);
                if (((uint)(ix - 0x3FF00000) | lx) == 0) // |x|==1
                {
                    if (hx > 0) return 0.0;              // acos(1) = 0
                    return PiHi + 2.0 * Pio2Lo;          // acos(-1)= pi
                }
                return double.NaN;                       // acos(|x|>1) is NaN
            }
            if (ix < 0x3FE00000) // |x| < 0.5
            {
                if (ix <= 0x3C600000) return Pio2Hi + Pio2Lo; // if |x| < 2**-57
                z = x * x;
                p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
                q = one + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
                r = p / q;
                return Pio2Hi - (x - (Pio2Lo - x * r));
            }
            else if (hx < 0) // x < -0.5
            {
                z = (one + x) * 0.5;
                p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
                q = one + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
                s = Math.Sqrt(z);
                r = p / q;
                w = r * s - Pio2Lo;
                return PiHi - 2.0 * (s + w);
            }
            else // x > 0.5
            {
                z = (one - x) * 0.5;
                s = Math.Sqrt(z);
                df = s;
                df = WithLo(df, 0);
                c = (z - df * df) / (s + df);
                p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
                q = one + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
                r = p / q;
                w = r * s + c;
                return 2.0 * (df + w);
            }
        }

        /// <summary>Math.asin as V8 12.4 (fdlibm).</summary>
        public static double Asin(double x)
        {
            const double one = 1.00000000000000000000e+00;
            const double huge = 1.000e+300;
            double t, w, p, q, c, r, s;
            int hx = Hi(x);
            int ix = hx & 0x7FFFFFFF;
            t = 0;
            if (ix >= 0x3FF00000) // |x|>= 1
            {
                uint lx = Lo(x);
                if (((uint)(ix - 0x3FF00000) | lx) == 0) // asin(1)=+-pi/2 with inexact
                {
                    return x * Pio2Hi + x * Pio2Lo;
                }
                return double.NaN; // asin(|x|>1) is NaN
            }
            else if (ix < 0x3FE00000) // |x|<0.5
            {
                if (ix < 0x3E400000) // if |x| < 2**-27
                {
                    if (huge + x > one) return x; // return x with inexact if x!=0
                }
                else
                {
                    t = x * x;
                }
                p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
                q = one + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
                w = p / q;
                return x + x * w;
            }
            // 1 > |x| >= 0.5
            w = one - Math.Abs(x);
            t = w * 0.5;
            p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
            q = one + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
            s = Math.Sqrt(t);
            if (ix >= 0x3FEF3333) // if |x| > 0.975
            {
                w = p / q;
                t = Pio2Hi - (2.0 * (s + s * w) - Pio2Lo);
            }
            else
            {
                w = s;
                w = WithLo(w, 0);
                c = (t - w * w) / (s + w);
                r = p / q;
                p = 2.0 * s * r - (Pio2Lo - 2.0 * c);
                q = Pio4Hi - 2.0 * w;
                t = Pio4Hi - (p - q);
            }
            return hx > 0 ? t : -t;
        }

        private static ReadOnlySpan<double> AtanHi => new double[]
        {
            4.63647609000806093515e-01, // atan(0.5)hi 0x3FDDAC67, 0x0561BB4F
            7.85398163397448278999e-01, // atan(1.0)hi 0x3FE921FB, 0x54442D18
            9.82793723247329054082e-01, // atan(1.5)hi 0x3FEF730B, 0xD281F69B
            1.57079632679489655800e+00, // atan(inf)hi 0x3FF921FB, 0x54442D18
        };

        private static ReadOnlySpan<double> AtanLo => new double[]
        {
            2.26987774529616870924e-17, // atan(0.5)lo 0x3C7A2B7F, 0x222F65E2
            3.06161699786838301793e-17, // atan(1.0)lo 0x3C81A626, 0x33145C07
            1.39033110312309984516e-17, // atan(1.5)lo 0x3C700788, 0x7AF0CBBD
            6.12323399573676603587e-17, // atan(inf)lo 0x3C91A626, 0x33145C07
        };

        private static ReadOnlySpan<double> AT => new double[]
        {
            3.33333333333329318027e-01,  // 0x3FD55555, 0x5555550D
            -1.99999999998764832476e-01, // 0xBFC99999, 0x9998EBC4
            1.42857142725034663711e-01,  // 0x3FC24924, 0x920083FF
            -1.11111104054623557880e-01, // 0xBFBC71C6, 0xFE231671
            9.09088713343650656196e-02,  // 0x3FB745CD, 0xC54C206E
            -7.69187620504482999495e-02, // 0xBFB3B0F2, 0xAF749A6D
            6.66107313738753120669e-02,  // 0x3FB10D66, 0xA0D03D51
            -5.83357013379057348645e-02, // 0xBFADDE2D, 0x52DEFD9A
            4.97687799461593236017e-02,  // 0x3FA97B4B, 0x24760DEB
            -3.65315727442169155270e-02, // 0xBFA2B444, 0x2C6A6C2F
            1.62858201153657823623e-02,  // 0x3F90AD3A, 0xE322DA11
        };

        /// <summary>Math.atan as V8 12.4 (fdlibm).</summary>
        public static double Atan(double x)
        {
            const double one = 1.0, huge = 1.0e300;
            ReadOnlySpan<double> atanhi = AtanHi, atanlo = AtanLo, aT = AT;
            double w, s1, s2, z;
            int id;
            int hx = Hi(x);
            int ix = hx & 0x7FFFFFFF;
            if (ix >= 0x44100000) // if |x| >= 2^66
            {
                uint low = Lo(x);
                if (ix > 0x7FF00000 || (ix == 0x7FF00000 && (low != 0))) return x + x; // NaN
                if (hx > 0) return atanhi[3] + atanlo[3];
                return -atanhi[3] - atanlo[3];
            }
            if (ix < 0x3FDC0000) // |x| < 0.4375
            {
                if (ix < 0x3E400000) // |x| < 2^-27
                {
                    if (huge + x > one) return x; // raise inexact
                }
                id = -1;
            }
            else
            {
                x = Math.Abs(x);
                if (ix < 0x3FF30000) // |x| < 1.1875
                {
                    if (ix < 0x3FE60000) // 7/16 <=|x|<11/16
                    {
                        id = 0;
                        x = (2.0 * x - one) / (2.0 + x);
                    }
                    else // 11/16<=|x|< 19/16
                    {
                        id = 1;
                        x = (x - one) / (x + one);
                    }
                }
                else
                {
                    if (ix < 0x40038000) // |x| < 2.4375
                    {
                        id = 2;
                        x = (x - 1.5) / (one + 1.5 * x);
                    }
                    else // 2.4375 <= |x| < 2^66
                    {
                        id = 3;
                        x = -1.0 / x;
                    }
                }
            }
            // end of argument reduction
            z = x * x;
            w = z * z;
            // break sum from i=0 to 10 aT[i]z**(i+1) into odd and even poly
            s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
            s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
            if (id < 0) return x - x * (s1 + s2);
            z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
            return (hx < 0) ? -z : z;
        }

        /// <summary>Math.atan2 as V8 12.4 (fdlibm).</summary>
        public static double Atan2(double y, double x)
        {
            const double tiny = 1.0e-300;
            const double pi_o_4 = 7.8539816339744827900E-01; // 0x3FE921FB, 0x54442D18
            const double pi_o_2 = 1.5707963267948965580E+00; // 0x3FF921FB, 0x54442D18
            const double pi = 3.1415926535897931160E+00;     // 0x400921FB, 0x54442D18
            const double pi_lo = 1.2246467991473531772E-16;  // 0x3CA1A626, 0x33145C07

            double z;
            int k, m;
            int hx = Hi(x), ix = hx & 0x7FFFFFFF;
            uint lx = Lo(x);
            int hy = Hi(y), iy = hy & 0x7FFFFFFF;
            uint ly = Lo(y);
            if (((ix | (int)((lx | (uint)(-(int)lx)) >> 31)) > 0x7FF00000) ||
                ((iy | (int)((ly | (uint)(-(int)ly)) >> 31)) > 0x7FF00000))
            {
                return x + y; // x or y is NaN
            }
            if (((uint)(hx - 0x3FF00000) | lx) == 0) return Atan(y); // x=1.0
            m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2*sign(x)+sign(y)

            // when y = 0
            if (((uint)iy | ly) == 0)
            {
                switch (m)
                {
                    case 0:
                    case 1: return y;           // atan(+-0,+anything)=+-0
                    case 2: return pi + tiny;   // atan(+0,-anything) = pi
                    case 3: return -pi - tiny;  // atan(-0,-anything) =-pi
                }
            }
            // when x = 0
            if (((uint)ix | lx) == 0) return (hy < 0) ? -pi_o_2 - tiny : pi_o_2 + tiny;

            // when x is INF
            if (ix == 0x7FF00000)
            {
                if (iy == 0x7FF00000)
                {
                    switch (m)
                    {
                        case 0: return pi_o_4 + tiny;        // atan(+INF,+INF)
                        case 1: return -pi_o_4 - tiny;       // atan(-INF,+INF)
                        case 2: return 3.0 * pi_o_4 + tiny;  // atan(+INF,-INF)
                        case 3: return -3.0 * pi_o_4 - tiny; // atan(-INF,-INF)
                    }
                }
                else
                {
                    switch (m)
                    {
                        case 0: return 0.0;         // atan(+...,+INF)
                        case 1: return -0.0;        // atan(-...,+INF)
                        case 2: return pi + tiny;   // atan(+...,-INF)
                        case 3: return -pi - tiny;  // atan(-...,-INF)
                    }
                }
            }
            // when y is INF
            if (iy == 0x7FF00000) return (hy < 0) ? -pi_o_2 - tiny : pi_o_2 + tiny;

            // compute y/x
            k = (iy - ix) >> 20;
            if (k > 60) // |y/x| > 2**60
            {
                z = pi_o_2 + 0.5 * pi_lo;
                m &= 1;
            }
            else if (hx < 0 && k < -60)
            {
                z = 0.0; // 0 > |y|/x > -2**-60
            }
            else
            {
                z = Atan(Math.Abs(y / x)); // safe to do y/x
            }
            switch (m)
            {
                case 0: return z;                  // atan(+,+)
                case 1: return -z;                 // atan(-,+)
                case 2: return pi - (z - pi_lo);   // atan(+,-)
                default: return (z - pi_lo) - pi;  // atan(-,-)
            }
        }

        // ================================================================ exp, expm1, log, log2, log10 ================================================================

        /// <summary>Math.exp as V8 12.4 (fdlibm).</summary>
        public static double Exp(double x)
        {
            const double one = 1.0;
            const double o_threshold = 7.09782712893383973096e+02;  // 0x40862E42, 0xFEFA39EF
            const double u_threshold = -7.45133219101941108420e+02; // 0xC0874910, 0xD52D3051
            const double ln2HI = 6.93147180369123816490e-01;        // 0x3FE62E42, 0xFEE00000
            const double ln2LO = 1.90821492927058770002e-10;        // 0x3DEA39EF, 0x35793C76
            const double invln2 = 1.44269504088896338700e+00;       // 0x3FF71547, 0x652B82FE
            const double P1 = 1.66666666666666019037e-01;           // 0x3FC55555, 0x5555553E
            const double P2 = -2.77777777770155933842e-03;          // 0xBF66C16C, 0x16BEBD93
            const double P3 = 6.61375632143793436117e-05;           // 0x3F11566A, 0xAF25DE2C
            const double P4 = -1.65339022054652515390e-06;          // 0xBEBBBD41, 0xC5D26BF1
            const double P5 = 4.13813679705723846039e-08;           // 0x3E663769, 0x72BEA4D0
            const double E = 2.718281828459045;                     // 0x4005BF0A, 0x8B145769
            const double huge = 1.0e+300;
            const double twom1000 = 9.33263618503218878990e-302;    // 2**-1000=0x01700000,0
            const double two1023 = 8.988465674311579539e307;        // 0x1p1023

            double y, hi = 0.0, lo = 0.0, c, t, twopk;
            int k = 0, xsb;
            uint hx = (uint)Hi(x);
            xsb = (int)((hx >> 31) & 1); // sign bit of x
            hx &= 0x7FFFFFFF;            // high word of |x|

            // filter out non-finite argument
            if (hx >= 0x40862E42) // if |x|>=709.78...
            {
                if (hx >= 0x7FF00000)
                {
                    uint lx = Lo(x);
                    if (((hx & 0xFFFFF) | lx) != 0) return x + x; // NaN
                    return (xsb == 0) ? x : 0.0;                  // exp(+-inf)={inf,0}
                }
                if (x > o_threshold) return huge * huge;         // overflow
                if (x < u_threshold) return twom1000 * twom1000; // underflow
            }

            // argument reduction
            if (hx > 0x3FD62E42) // if |x| > 0.5 ln2
            {
                if (hx < 0x3FF0A2B2) // and |x| < 1.5 ln2
                {
                    // V8 special-cases exp(1) to return the correct value of E, as the computation below would get the last bit wrong.
                    if (x == 1.0) return E;
                    hi = x - (xsb == 0 ? ln2HI : -ln2HI);
                    lo = xsb == 0 ? ln2LO : -ln2LO;
                    k = 1 - xsb - xsb;
                }
                else
                {
                    k = (int)(invln2 * x + (xsb == 0 ? 0.5 : -0.5));
                    t = k;
                    hi = x - t * ln2HI; // t*ln2HI is exact here
                    lo = t * ln2LO;
                }
                x = hi - lo;
            }
            else if (hx < 0x3E300000) // when |x|<2**-28
            {
                if (huge + x > one) return one + x; // trigger inexact
            }
            else
            {
                k = 0;
            }

            // x is now in primary range
            t = x * x;
            if (k >= -1021)
            {
                twopk = FromWords(0x3FF00000 + (int)((uint)k << 20), 0);
            }
            else
            {
                twopk = FromWords(0x3FF00000 + (int)((uint)(k + 1000) << 20), 0);
            }
            c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
            if (k == 0)
            {
                return one - ((x * c) / (c - 2.0) - x);
            }
            y = one - ((lo - (x * c) / (2.0 - c)) - hi);
            if (k >= -1021)
            {
                if (k == 1024) return y * 2.0 * two1023;
                return y * twopk;
            }
            return y * twopk * twom1000;
        }

        /// <summary>expm1, needed by sinh (V8 12.4, fdlibm).</summary>
        private static double Expm1(double x)
        {
            const double one = 1.0;
            const double tiny = 1.0e-300;
            const double o_threshold = 7.09782712893383973096e+02; // 0x40862E42, 0xFEFA39EF
            const double ln2_hi = 6.93147180369123816490e-01;      // 0x3FE62E42, 0xFEE00000
            const double ln2_lo = 1.90821492927058770002e-10;      // 0x3DEA39EF, 0x35793C76
            const double invln2 = 1.44269504088896338700e+00;      // 0x3FF71547, 0x652B82FE
            const double Q1 = -3.33333333333331316428e-02;         // BFA11111 111110F4
            const double Q2 = 1.58730158725481460165e-03;          // 3F5A01A0 19FE5585
            const double Q3 = -7.93650757867487942473e-05;         // BF14CE19 9EAADBB7
            const double Q4 = 4.00821782732936239552e-06;          // 3ED0CFCA 86E65239
            const double Q5 = -2.01099218183624371326e-07;         // BE8AFDB7 6E09C32D
            const double huge = 1.0e+300;

            double y, hi, lo, c = 0.0, t, e, hxs, hfx, r1, twopk;
            int k;
            uint hx = (uint)Hi(x);
            uint xsb = hx & 0x80000000; // sign bit of x
            hx &= 0x7FFFFFFF;           // high word of |x|

            // filter out huge and non-finite argument
            if (hx >= 0x4043687A) // if |x|>=56*ln2
            {
                if (hx >= 0x40862E42) // if |x|>=709.78...
                {
                    if (hx >= 0x7FF00000)
                    {
                        uint low = Lo(x);
                        if (((hx & 0xFFFFF) | low) != 0) return x + x; // NaN
                        return (xsb == 0) ? x : -1.0;                  // exp(+-inf)={inf,-1}
                    }
                    if (x > o_threshold) return huge * huge; // overflow
                }
                if (xsb != 0) // x < -56*ln2, return -1.0 with inexact
                {
                    if (x + tiny < 0.0) return tiny - one; // return -1
                }
            }

            // argument reduction
            if (hx > 0x3FD62E42) // if |x| > 0.5 ln2
            {
                if (hx < 0x3FF0A2B2) // and |x| < 1.5 ln2
                {
                    if (xsb == 0)
                    {
                        hi = x - ln2_hi;
                        lo = ln2_lo;
                        k = 1;
                    }
                    else
                    {
                        hi = x + ln2_hi;
                        lo = -ln2_lo;
                        k = -1;
                    }
                }
                else
                {
                    k = (int)(invln2 * x + ((xsb == 0) ? 0.5 : -0.5));
                    t = k;
                    hi = x - t * ln2_hi; // t*ln2_hi is exact here
                    lo = t * ln2_lo;
                }
                x = hi - lo;
                c = (hi - x) - lo;
            }
            else if (hx < 0x3C900000) // when |x|<2**-54, return x
            {
                t = huge + x; // return x with inexact flags when x!=0
                return x - (t - (huge + x));
            }
            else
            {
                k = 0;
            }

            // x is now in primary range
            hfx = 0.5 * x;
            hxs = x * hfx;
            r1 = one + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
            t = 3.0 - r1 * hfx;
            e = hxs * ((r1 - t) / (6.0 - x * t));
            if (k == 0)
            {
                return x - (x * e - hxs); // c is 0
            }
            twopk = FromWords(0x3FF00000 + (int)((uint)k << 20), 0); // 2^k
            e = (x * (e - c) - c);
            e -= hxs;
            if (k == -1) return 0.5 * (x - e) - 0.5;
            if (k == 1)
            {
                if (x < -0.25) return -2.0 * (e - (x + 0.5));
                return one + 2.0 * (x - e);
            }
            if (k <= -2 || k > 56) // suffice to return exp(x)-1
            {
                y = one - (e - x);
                if (k == 1024) y = y * 2.0 * 8.98846567431158e+307;
                else y = y * twopk;
                return y - one;
            }
            t = one;
            if (k < 20)
            {
                t = WithHi(t, 0x3FF00000 - (0x200000 >> k)); // t=1-2^-k
                y = t - (e - x);
                y = y * twopk;
            }
            else
            {
                t = WithHi(t, (0x3FF - k) << 20); // 2^-k
                y = x - (e + t);
                y += one;
                y = y * twopk;
            }
            return y;
        }

        /// <summary>Math.log as V8 12.4 (fdlibm).</summary>
        public static double Log(double x)
        {
            const double ln2_hi = 6.93147180369123816490e-01; // 3fe62e42 fee00000
            const double ln2_lo = 1.90821492927058770002e-10; // 3dea39ef 35793c76
            const double two54 = 1.80143985094819840000e+16;  // 43500000 00000000
            const double Lg1 = 6.666666666666735130e-01;      // 3FE55555 55555593
            const double Lg2 = 3.999999999940941908e-01;      // 3FD99999 9997FA04
            const double Lg3 = 2.857142874366239149e-01;      // 3FD24924 94229359
            const double Lg4 = 2.222219843214978396e-01;      // 3FCC71C5 1D8E78AF
            const double Lg5 = 1.818357216161805012e-01;      // 3FC74664 96CB03DE
            const double Lg6 = 1.531383769920937332e-01;      // 3FC39A09 D078C69F
            const double Lg7 = 1.479819860511658591e-01;      // 3FC2F112 DF3E5244
            const double zero = 0.0;

            double hfsq, f, s, z, R, w, t1, t2, dk;
            int k, hx, i, j;
            uint lx;

            hx = Hi(x);
            lx = Lo(x);

            k = 0;
            if (hx < 0x00100000) // x < 2**-1022
            {
                if ((uint)((hx & 0x7FFFFFFF)) == 0 && lx == 0) return double.NegativeInfinity; // log(+-0)=-inf
                if (hx < 0) return double.NaN;                                                  // log(-#) = NaN
                k -= 54;
                x *= two54; // subnormal number, scale up x
                hx = Hi(x);
            }
            if (hx >= 0x7FF00000) return x + x;
            k += (hx >> 20) - 1023;
            hx &= 0x000FFFFF;
            i = (hx + 0x95F64) & 0x100000;
            x = WithHi(x, hx | (i ^ 0x3FF00000)); // normalize x or x/2
            k += (i >> 20);
            f = x - 1.0;
            if ((0x000FFFFF & (2 + hx)) < 3) // -2**-20 <= f < 2**-20
            {
                if (f == zero)
                {
                    if (k == 0) return zero;
                    dk = k;
                    return dk * ln2_hi + dk * ln2_lo;
                }
                R = f * f * (0.5 - 0.33333333333333333 * f);
                if (k == 0) return f - R;
                dk = k;
                return dk * ln2_hi - ((R - dk * ln2_lo) - f);
            }
            s = f / (2.0 + f);
            dk = k;
            z = s * s;
            i = hx - 0x6147A;
            w = z * z;
            j = 0x6B851 - hx;
            t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
            t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
            i |= j;
            R = t2 + t1;
            if (i > 0)
            {
                hfsq = 0.5 * f * f;
                if (k == 0) return f - (hfsq - s * (hfsq + R));
                return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
            }
            if (k == 0) return f - s * (f - R);
            return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
        }

        /// <summary>Math.log2 as V8 12.4 (the FreeBSD-derived fdlibm version).</summary>
        public static double Log2(double x)
        {
            const double two54 = 1.80143985094819840000e+16;   // 0x43500000, 0x00000000
            const double ivln2hi = 1.44269504072144627571e+00; // 0x3FF71547, 0x65200000
            const double ivln2lo = 1.67517131648865118353e-10; // 0x3DE705FC, 0x2EEFA200
            const double Lg1 = 6.666666666666735130e-01;       // 3FE55555 55555593
            const double Lg2 = 3.999999999940941908e-01;       // 3FD99999 9997FA04
            const double Lg3 = 2.857142874366239149e-01;       // 3FD24924 94229359
            const double Lg4 = 2.222219843214978396e-01;       // 3FCC71C5 1D8E78AF
            const double Lg5 = 1.818357216161805012e-01;       // 3FC74664 96CB03DE
            const double Lg6 = 1.531383769920937332e-01;       // 3FC39A09 D078C69F
            const double Lg7 = 1.479819860511658591e-01;       // 3FC2F112 DF3E5244

            double f, hfsq, hi, lo, r, val_hi, val_lo, w, y;
            int i, k, hx;
            uint lx;

            hx = Hi(x);
            lx = Lo(x);

            k = 0;
            if (hx < 0x00100000) // x < 2**-1022
            {
                if ((uint)(hx & 0x7FFFFFFF) == 0 && lx == 0) return double.NegativeInfinity; // log(+-0)=-inf
                if (hx < 0) return double.NaN;                                                // log(-#) = NaN
                k -= 54;
                x *= two54; // subnormal number, scale up x
                hx = Hi(x);
            }
            if (hx >= 0x7FF00000) return x + x;
            if (hx == 0x3FF00000 && lx == 0) return 0.0; // log(1) = +0
            k += (hx >> 20) - 1023;
            hx &= 0x000FFFFF;
            i = (hx + 0x95F64) & 0x100000;
            x = WithHi(x, hx | (i ^ 0x3FF00000)); // normalize x or x/2
            k += (i >> 20);
            y = k;
            f = x - 1.0;
            hfsq = 0.5 * f * f;
            // k_log1p(f)
            {
                double s = f / (2.0 + f);
                double z = s * s;
                double ww = z * z;
                double t1 = ww * (Lg2 + ww * (Lg4 + ww * Lg6));
                double t2 = z * (Lg1 + ww * (Lg3 + ww * (Lg5 + ww * Lg7)));
                double R = t2 + t1;
                r = s * (hfsq + R);
            }

            // f-hfsq must (for args near 1) be evaluated in extra precision to avoid a large cancellation when x is near sqrt(2) or 1/sqrt(2); see V8.
            hi = f - hfsq;
            hi = WithLo(hi, 0);
            lo = (f - hi) - hfsq + r;
            val_hi = hi * ivln2hi;
            val_lo = (lo + hi) * ivln2lo + lo * ivln2hi;

            // spadd(val_hi, val_lo, y), except for not using double_t:
            w = y + val_hi;
            val_lo += (y - w) + val_hi;
            val_hi = w;

            return val_lo + val_hi;
        }

        /// <summary>Math.log10 as V8 12.4 (the FreeBSD-derived fdlibm version, which calls log).</summary>
        public static double Log10(double x)
        {
            const double two54 = 1.80143985094819840000e+16;    // 0x43500000, 0x00000000
            const double ivln10 = 4.34294481903251816668e-01;
            const double log10_2hi = 3.01029995663611771306e-01; // 0x3FD34413, 0x509F6000
            const double log10_2lo = 3.69423907715893078616e-13; // 0x3D59FEF3, 0x11F12B36

            double y;
            int i, k, hx;
            uint lx;

            hx = Hi(x);
            lx = Lo(x);

            k = 0;
            if (hx < 0x00100000) // x < 2**-1022
            {
                if ((uint)(hx & 0x7FFFFFFF) == 0 && lx == 0) return double.NegativeInfinity; // log(+-0)=-inf
                if (hx < 0) return double.NaN;                                                // log(-#) = NaN
                k -= 54;
                x *= two54; // subnormal number, scale up x
                hx = Hi(x);
                lx = Lo(x);
            }
            if (hx >= 0x7FF00000) return x + x;
            if (hx == 0x3FF00000 && lx == 0) return 0.0; // log(1) = +0
            k += (hx >> 20) - 1023;

            i = (int)(((uint)k & 0x80000000u) >> 31);
            hx = (hx & 0x000FFFFF) | ((0x3FF - i) << 20);
            y = k + i;
            x = FromWords(hx, lx);

            double z = y * log10_2lo + ivln10 * Log(x);
            return z + y * log10_2hi;
        }

        // ================================================================ cbrt, sinh, pow ================================================================

        /// <summary>Math.cbrt as V8 12.4 (the FreeBSD-derived fdlibm version).</summary>
        public static double Cbrt(double x)
        {
            const uint B1 = 715094163; // (1023-1023/3-0.03306235651)*2**20
            const uint B2 = 696219795; // (1023-1023/3-54/3-0.03306235651)*2**20
            const double P0 = 1.87595182427177009643;   // 0x3FFE03E6, 0x0F61E692
            const double P1 = -1.88497979543377169875;  // 0xBFFE28E0, 0x92F02420
            const double P2 = 1.621429720105354466140;  // 0x3FF9F160, 0x4A49D6C2
            const double P3 = -0.758397934778766047437; // 0xBFE844CB, 0xBEE751D9
            const double P4 = 0.145996192886612446982;  // 0x3FC2B000, 0xD4E4EDD7

            int hx = Hi(x);
            uint low = Lo(x);
            double r, s, t = 0.0, w;
            uint sign = (uint)hx & 0x80000000; // sign = sign(x)
            hx ^= (int)sign;
            if (hx >= 0x7FF00000) return x + x; // cbrt(NaN,INF) is itself

            // Rough cbrt to 5 bits (see V8's comments)
            if (hx < 0x00100000) // zero or subnormal?
            {
                if (((uint)hx | low) == 0) return x; // cbrt(0) is itself
                t = WithHi(t, 0x43500000);           // set t= 2**54
                t *= x;
                uint high = (uint)Hi(t);
                t = FromWords((int)(sign | ((high & 0x7FFFFFFF) / 3 + B2)), 0);
            }
            else
            {
                t = FromWords((int)(sign | ((uint)hx / 3 + B1)), 0);
            }

            // New cbrt to 23 bits: cbrt(x) = t*cbrt(x/t**3) ~= t*P(t**3/x)
            r = (t * t) * (t / x);
            t = t * ((P0 + r * (P1 + r * P2)) + ((r * r) * r) * (P3 + r * P4));

            // Round t away from zero to 23 bits
            ulong bits = BitConverter.DoubleToUInt64Bits(t);
            bits = (bits + 0x80000000UL) & 0xFFFFFFFFC0000000UL;
            t = BitConverter.UInt64BitsToDouble(bits);

            // one step Newton iteration to 53 bits with error < 0.667 ulps
            s = t * t;             // t*t is exact
            r = x / s;             // error <= 0.5 ulps; |r| < |t|
            w = t + t;             // t+t is exact
            r = (r - t) / (w + r); // r-t is exact; w+r ~= 3*t
            t = t + t * r;         // error <= 0.5 + 0.5/3 + epsilon
            return t;
        }

        /// <summary>Math.sinh as V8 12.4.</summary>
        public static double Sinh(double x)
        {
            const double KSINH_OVERFLOW = 710.4758600739439;
            const double TWO_M28 = 3.725290298461914e-9; // 2^-28, empty lower half
            const double LOG_MAXD = 709.7822265625;      // 0x40862E42 00000000, empty lower half
            const double shuge = 1.0e307;

            double h = (x < 0) ? -0.5 : 0.5;
            // |x| in [0, 22]. return sign(x)*0.5*(E+E/(E+1))
            double ax = Math.Abs(x);
            if (ax < 22)
            {
                // For |x| < 2^-28, sinh(x) = x
                if (ax < TWO_M28) return x;
                double t = Expm1(ax);
                if (ax < 1) return h * (2 * t - t * t / (t + 1));
                return h * (t + t / (t + 1));
            }
            // |x| in [22, log(maxdouble)], return 0.5 * exp(|x|)
            if (ax < LOG_MAXD) return h * Exp(ax);
            // |x| in [log(maxdouble), overflowthreshold]
            if (ax <= KSINH_OVERFLOW)
            {
                double w = Exp(0.5 * ax);
                double t = h * w;
                return t * w;
            }
            // |x| > overflowthreshold or is NaN: Infinity of the appropriate sign or NaN
            return x * shuge;
        }

        /// <summary>Math.pow as V8 12.4 (fdlibm; JavaScript's special cases: pow(+-1, +-Infinity) and pow(1, NaN) are NaN, pow(x, +-0) is 1).</summary>
        public static double Pow(double x, double y)
        {
            ReadOnlySpan<double> bp = [1.0, 1.5];
            ReadOnlySpan<double> dp_h = [0.0, 5.84962487220764160156e-01];       // 0x3FE2B803, 0x40000000
            ReadOnlySpan<double> dp_l = [0.0, 1.35003920212974897128e-08];       // 0x3E4CFDEB, 0x43CFD006
            const double zero = 0.0, one = 1.0, two = 2.0;
            const double two53 = 9007199254740992.0;                              // 0x43400000, 0x00000000
            const double huge = 1.0e300, tiny = 1.0e-300;
            // poly coefs for (3/2)*(log(x)-2s-2/3*s**3
            const double L1 = 5.99999999999994648725e-01;     // 0x3FE33333, 0x33333303
            const double L2 = 4.28571428578550184252e-01;     // 0x3FDB6DB6, 0xDB6FABFF
            const double L3 = 3.33333329818377432918e-01;     // 0x3FD55555, 0x518F264D
            const double L4 = 2.72728123808534006489e-01;     // 0x3FD17460, 0xA91D4101
            const double L5 = 2.30660745775561754067e-01;     // 0x3FCD864A, 0x93C9DB65
            const double L6 = 2.06975017800338417784e-01;     // 0x3FCA7E28, 0x4A454EEF
            const double P1 = 1.66666666666666019037e-01;     // 0x3FC55555, 0x5555553E
            const double P2 = -2.77777777770155933842e-03;    // 0xBF66C16C, 0x16BEBD93
            const double P3 = 6.61375632143793436117e-05;     // 0x3F11566A, 0xAF25DE2C
            const double P4 = -1.65339022054652515390e-06;    // 0xBEBBBD41, 0xC5D26BF1
            const double P5 = 4.13813679705723846039e-08;     // 0x3E663769, 0x72BEA4D0
            const double lg2 = 6.93147180559945286227e-01;    // 0x3FE62E42, 0xFEFA39EF
            const double lg2_h = 6.93147182464599609375e-01;  // 0x3FE62E43, 0x00000000
            const double lg2_l = -1.90465429995776804525e-09; // 0xBE205C61, 0x0CA86C39
            const double ovt = 8.0085662595372944372e-0017;   // -(1024-log2(ovfl+.5ulp))
            const double cp = 9.61796693925975554329e-01;     // 0x3FEEC709, 0xDC3A03FD =2/(3ln2)
            const double cp_h = 9.61796700954437255859e-01;   // 0x3FEEC709, 0xE0000000 =(float)cp
            const double cp_l = -7.02846165095275826516e-09;  // 0xBE3E2FE0, 0x145B01F5 =tail cp_h
            const double ivln2 = 1.44269504088896338700e+00;  // 0x3FF71547, 0x652B82FE =1/ln2
            const double ivln2_h = 1.44269502162933349609e+00; // 0x3FF71547, 0x60000000 =24b 1/ln2
            const double ivln2_l = 1.92596299112661746887e-08; // 0x3E54AE0B, 0xF85DDF44 =1/ln2 tail

            double z, ax, z_h, z_l, p_h, p_l;
            double y1, t1, t2, r, s, t, u, v, w;
            int i, j, k, yisint, n;
            int hx, hy, ix, iy;
            uint lx, ly;

            hx = Hi(x); lx = Lo(x);
            hy = Hi(y); ly = Lo(y);
            ix = hx & 0x7fffffff;
            iy = hy & 0x7fffffff;

            // y==zero: x**0 = 1
            if (((uint)iy | ly) == 0) return one;

            // +-NaN return x+y
            if (ix > 0x7ff00000 || ((ix == 0x7ff00000) && (lx != 0)) || iy > 0x7ff00000 || ((iy == 0x7ff00000) && (ly != 0)))
            {
                return x + y;
            }

            // determine if y is an odd int when x < 0: yisint = 0 ... y is not an integer, 1 ... y is an odd int, 2 ... y is an even int
            yisint = 0;
            if (hx < 0)
            {
                if (iy >= 0x43400000)
                {
                    yisint = 2; // even integer y
                }
                else if (iy >= 0x3ff00000)
                {
                    k = (iy >> 20) - 0x3ff; // exponent
                    if (k > 20)
                    {
                        j = (int)(ly >> (52 - k));
                        if ((j << (52 - k)) == (int)ly) yisint = 2 - (j & 1);
                    }
                    else if (ly == 0)
                    {
                        j = iy >> (20 - k);
                        if ((j << (20 - k)) == iy) yisint = 2 - (j & 1);
                    }
                }
            }

            // special value of y
            if (ly == 0)
            {
                if (iy == 0x7ff00000) // y is +-inf
                {
                    if (((uint)(ix - 0x3ff00000) | lx) == 0) return double.NaN;  // (+-1)**+-inf is NaN (the ECMAScript behaviour)
                    if (ix >= 0x3ff00000) return (hy >= 0) ? y : zero;           // (|x|>1)**+-inf = inf,0
                    return (hy < 0) ? -y : zero;                                  // (|x|<1)**-,+inf = inf,0
                }
                if (iy == 0x3ff00000) // y is +-1
                {
                    if (hy < 0) return one / x;
                    return x;
                }
                if (hy == 0x40000000) return x * x; // y is 2
                if (hy == 0x3fe00000) // y is 0.5
                {
                    if (hx >= 0) return Math.Sqrt(x); // x >= +0
                }
            }

            ax = Math.Abs(x);
            // special value of x
            if (lx == 0)
            {
                if (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000)
                {
                    z = ax; // x is +-0,+-inf,+-1
                    if (hy < 0) z = one / z; // z = (1/|x|)
                    if (hx < 0)
                    {
                        if (((ix - 0x3ff00000) | yisint) == 0)
                        {
                            z = double.NaN; // (-1)**non-int is NaN
                        }
                        else if (yisint == 1)
                        {
                            z = -z; // (x<0)**odd = -(|x|**odd)
                        }
                    }
                    return z;
                }
            }

            n = (hx >> 31) + 1;

            // (x<0)**(non-int) is NaN
            if ((n | yisint) == 0) return double.NaN;

            s = one; // s (sign of result -ve**odd) = -1 else = 1
            if ((n | (yisint - 1)) == 0) s = -one; // (-ve)**(odd int)

            // |y| is huge
            if (iy > 0x41e00000) // if |y| > 2**31
            {
                if (iy > 0x43f00000) // if |y| > 2**64, must o/uflow
                {
                    if (ix <= 0x3fefffff) return (hy < 0) ? huge * huge : tiny * tiny;
                    if (ix >= 0x3ff00000) return (hy > 0) ? huge * huge : tiny * tiny;
                }
                // over/underflow if x is not close to one
                if (ix < 0x3fefffff) return (hy < 0) ? s * huge * huge : s * tiny * tiny;
                if (ix > 0x3ff00000) return (hy > 0) ? s * huge * huge : s * tiny * tiny;
                // now |1-x| is tiny <= 2**-20, suffice to compute log(x) by x-x^2/2+x^3/3-x^4/4
                t = ax - one; // t has 20 trailing zeros
                w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
                u = ivln2_h * t; // ivln2_h has 21 sig. bits
                v = t * ivln2_l - w * ivln2;
                t1 = u + v;
                t1 = WithLo(t1, 0);
                t2 = v - (t1 - u);
            }
            else
            {
                double ss, s2, s_h, s_l, t_h, t_l;
                n = 0;
                // take care subnormal number
                if (ix < 0x00100000)
                {
                    ax *= two53;
                    n -= 53;
                    ix = Hi(ax);
                }
                n += (ix >> 20) - 0x3ff;
                j = ix & 0x000fffff;
                // determine interval
                ix = j | 0x3ff00000; // normalize ix
                if (j <= 0x3988E)
                {
                    k = 0; // |x|<sqrt(3/2)
                }
                else if (j < 0xBB67A)
                {
                    k = 1; // |x|<sqrt(3)
                }
                else
                {
                    k = 0;
                    n += 1;
                    ix -= 0x00100000;
                }
                ax = WithHi(ax, ix);

                // compute ss = s_h+s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
                u = ax - bp[k]; // bp[0]=1.0, bp[1]=1.5
                v = one / (ax + bp[k]);
                ss = u * v;
                s_h = ss;
                s_h = WithLo(s_h, 0);
                // t_h=ax+bp[k] High
                t_h = zero;
                t_h = WithHi(t_h, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
                t_l = ax - (t_h - bp[k]);
                s_l = v * ((u - s_h * t_h) - s_h * t_l);
                // compute log(ax)
                s2 = ss * ss;
                r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
                r += s_l * (s_h + ss);
                s2 = s_h * s_h;
                t_h = 3.0 + s2 + r;
                t_h = WithLo(t_h, 0);
                t_l = r - ((t_h - 3.0) - s2);
                // u+v = ss*(1+...)
                u = s_h * t_h;
                v = s_l * t_h + t_l * ss;
                // 2/(3log2)*(ss+...)
                p_h = u + v;
                p_h = WithLo(p_h, 0);
                p_l = v - (p_h - u);
                z_h = cp_h * p_h; // cp_h+cp_l = 2/(3*log2)
                z_l = cp_l * p_h + p_l * cp + dp_l[k];
                // log2(ax) = (ss+..)*2/(3*log2) = n + dp_h + z_h + z_l
                t = n;
                t1 = (((z_h + z_l) + dp_h[k]) + t);
                t1 = WithLo(t1, 0);
                t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
            }

            // split up y into y1+y2 and compute (y1+y2)*(t1+t2)
            y1 = y;
            y1 = WithLo(y1, 0);
            p_l = (y - y1) * t1 + y * t2;
            p_h = y1 * t1;
            z = p_l + p_h;
            j = Hi(z);
            i = (int)Lo(z);
            if (j >= 0x40900000) // z >= 1024
            {
                if (((j - 0x40900000) | i) != 0) // if z > 1024
                {
                    return s * huge * huge; // overflow
                }
                if (p_l + ovt > z - p_h) return s * huge * huge; // overflow
            }
            else if ((j & 0x7fffffff) >= 0x4090cc00) // z <= -1075
            {
                if ((unchecked((uint)j - 0xc090cc00u) | (uint)i) != 0) // z < -1075
                {
                    return s * tiny * tiny; // underflow
                }
                if (p_l <= z - p_h) return s * tiny * tiny; // underflow
            }
            // compute 2**(p_h+p_l)
            i = j & 0x7fffffff;
            k = (i >> 20) - 0x3ff;
            n = 0;
            if (i > 0x3fe00000) // if |z| > 0.5, set n = [z+0.5]
            {
                n = j + (0x00100000 >> (k + 1));
                k = ((n & 0x7fffffff) >> 20) - 0x3ff; // new k for n
                t = zero;
                t = WithHi(t, n & ~(0x000fffff >> k));
                n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
                if (j < 0) n = -n;
                p_h -= t;
            }
            t = p_l + p_h;
            t = WithLo(t, 0);
            u = t * lg2_h;
            v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
            z = u + v;
            w = v - (z - u);
            t = z * z;
            t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
            r = (z * t1) / ((t1 - two) - (w + z * w));
            z = one - (r - z);
            j = Hi(z);
            j += (int)((uint)n << 20);
            if ((j >> 20) <= 0)
            {
                z = Scalbn(z, n); // subnormal output
            }
            else
            {
                z = WithHi(z, Hi(z) + (int)((uint)n << 20));
            }
            return s * z;
        }
    }
}
