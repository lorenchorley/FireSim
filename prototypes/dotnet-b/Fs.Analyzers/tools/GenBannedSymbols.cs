// Regenerates ../../BannedSymbols.txt from the running .NET runtime's public API by reflection.
//
//   source env.sh && dotnet run Fs.Analyzers/tools/GenBannedSymbols.cs > BannedSymbols.txt     (from prototypes/dotnet-b/)
//
// Why a generator: BannedApiAnalyzers matches a method only by its full documentation-comment ID (a bare `M:System.Math.Exp` bans nothing,
// checked on 5.6.0), so every overload of every banned member needs its own line. The generator keeps the list complete for the runtime in
// use; Fs.Tests (BannedSymbolsCoverageTests) re-checks, with the same reflection, that nothing banned is missing.
//
// The rule (plan section 10.4): in solver code every function except Abs, Sqrt, Floor, Ceiling, Truncate, CopySign (and Min/Max, ported
// literally) goes through FsMath; no Math.FusedMultiplyAdd, TensorPrimitives, Vector<T>, horizontal vector sums or *Native members;
// every Math.Round overload is banned (FsConv.Round has JavaScript's rounding).
// Card T0.4b closed three more holes (sections 5 to 7 below): hardware fused multiply-add through the platform intrinsics, float-to-integer
// conversion hidden in System.Convert, and generic-math integer conversions (CreateTruncating/Saturating/Checked).
#pragma warning disable IL2070,IL2026 // reflection over runtime types in a throwaway generator
using System.Reflection;
using System.Runtime.Intrinsics;
using System.Text;

var lines = new List<string>();

// 1. System.Math and System.MathF: every public static method with a floating-point parameter that is not on the allowed list, plus every Round.
var allowedMath = new HashSet<string> { "Abs", "Sqrt", "Floor", "Ceiling", "Truncate", "CopySign", "Min", "Max" };
foreach (var t in new[] { typeof(Math), typeof(MathF) })
    foreach (var m in Methods(t))
    {
        bool fp = m.GetParameters().Any(p => IsFloat(p.ParameterType));
        bool banned = m.Name == "Round" || (!allowedMath.Contains(m.Name) && fp);
        if (banned) lines.Add(Line(m, ReasonMath(t, m)));
    }

// 2. double / float static members that duplicate Math (generic-math statics): the same names as banned for Math, plus the estimate and Native families.
var namedBanned = new HashSet<string>
{
    "Acos","Acosh","AcosPi","Asin","Asinh","AsinPi","Atan","Atanh","AtanPi","Atan2","Atan2Pi","Cbrt","Cos","CosPi","Cosh","Exp","Exp2","Exp10",
    "ExpM1","Exp2M1","Exp10M1","FusedMultiplyAdd","Hypot","ILogB","Ieee754Remainder","Log","Log2","Log10","LogP1","Log2P1","Log10P1","Pow","ReciprocalEstimate",
    "ReciprocalSqrtEstimate","RootN","Round","ScaleB","Sin","SinCos","SinPi","Sinh","Tan","TanPi","Tanh","MultiplyAddEstimate","BitIncrement","BitDecrement",
};
foreach (var t in new[] { typeof(double), typeof(float), typeof(Half) })
    foreach (var m in Methods(t))
        if (namedBanned.Contains(m.Name) || m.Name.EndsWith("Native"))
            lines.Add(Line(m, $"use FsMath (plan 10.4): {t.Name}.{m.Name} calls the platform maths library or an estimate"));

// 3. Vector64/128/256/512 and System.Numerics.Vector statics: transcendental, rounding, estimate, horizontal (Sum, Dot) and *Native members.
var vectorBanned = new HashSet<string>(namedBanned) { "Sum", "Dot" };
foreach (var t in new[] { typeof(Vector64), typeof(Vector128), typeof(Vector256), typeof(Vector512) })
    foreach (var m in Methods(t))
        if (vectorBanned.Contains(m.Name) || m.Name.EndsWith("Native"))
            lines.Add(Line(m, $"element-wise Vector128<T> only; reductions are scalar in a fixed order (plan 9, 10.4): {t.Name}.{m.Name} may differ by hardware"));

// 4. Whole types.
string[] types =
{
    "System.Numerics.Vector`1|Vector<T> is 256 bits on AVX2 and 128 on arm64 and WebAssembly, so the reduction order changes (plan 9)",
    "System.Numerics.Vector|its members work on Vector<T> (plan 9)",
    "System.Numerics.Tensors.TensorPrimitives|results may differ between operating systems and architectures (plan 9)",
    "System.Numerics.IExponentialFunctions`1|generic-math call into the platform maths library: use FsMath",
    "System.Numerics.IHyperbolicFunctions`1|generic-math call into the platform maths library: use FsMath",
    "System.Numerics.ILogarithmicFunctions`1|generic-math call into the platform maths library: use FsMath",
    "System.Numerics.IPowerFunctions`1|generic-math call into the platform maths library: use FsMath",
    "System.Numerics.IRootFunctions`1|generic-math call into the platform maths library: use FsMath",
    "System.Numerics.ITrigonometricFunctions`1|generic-math call into the platform maths library: use FsMath",
    "System.Numerics.IFloatingPoint`1|generic-math Round and friends: use FsMath / FsConv",
    "System.Numerics.IFloatingPointIeee754`1|generic-math Exp, Pow, FusedMultiplyAdd, ScaleB and friends: use FsMath",
    "System.Numerics.IBinaryFloatingPointIeee754`1|generic-math Exp, Pow, FusedMultiplyAdd, ScaleB and friends: use FsMath",
};
foreach (var s in types) { var p = s.Split('|'); lines.Add($"T:{p[0]};{p[1]}"); }
lines.Add("N:System.Numerics.Tensors;System.Numerics.Tensors (TensorPrimitives, Tensor<T>) may differ between operating systems and architectures (plan 9)");

// 5. T0.4b hole 1: fused multiply-add (and the multiply-add forms that may fuse) through the platform intrinsics. Math/MathF/double/float/Half.FusedMultiplyAdd
//    and Vector64/128/256/512.FusedMultiplyAdd are already in sections 1 to 3; here are the ISA classes, whose results differ between CPUs that fuse and CPUs
//    (or WebAssembly) that do not. Types are taken from the runtime's own assembly, nested ones (Arm64, X64, VL ...) included. By family:
//      - every member of X86.Fma (and the type itself, so IsSupported too):           hardware FMA
//      - every X86/Arm member named FusedMultiply* (Avx512F, Avx10v1, AdvSimd, AdvSimd.Arm64, Sve): hardware FMA
//      - every X86/Arm member named MultiplyAdd*/MultiplySubtract* with a float or double element (AdvSimd float forms, Sve FMAD/FMLA/FCMLA/FTMAD):
//        multiply-add that may be fused; the integer forms (MultiplyAddAdjacent, Sve2 integer forms) are exact and stay allowed
//    .NET 11.0.0 has no relaxed-SIMD members (no Wasm PackedSimd.Relaxed*, nothing relaxed on Vector128): the only "Estimate" and "Native" members of
//    Vector64/128/256/512 are banned in section 3. The completeness test in Fs.Tests reports new members after a runtime upgrade.
var isaTypes = typeof(Vector128).Assembly.GetExportedTypes().Where(IsIsaType).ToList();
foreach (var t in isaTypes)
{
    bool isFma = t.FullName!.StartsWith("System.Runtime.Intrinsics.X86.Fma", StringComparison.Ordinal);
    if (isFma) lines.Add($"T:{TypeId(t)};hardware fused multiply-add: results differ between CPUs that fuse and CPUs or WebAssembly that do not (plan 9, 10.4)");
    foreach (var m in Methods(t))
    {
        bool fused = m.Name.StartsWith("FusedMultiply", StringComparison.Ordinal);
        bool multiplyAdd = (m.Name.Contains("MultiplyAdd") || m.Name.Contains("MultiplySubtract")) && m.GetParameters().Any(p => HasFloatElement(p.ParameterType));
        if (isFma || fused || multiplyAdd)
            lines.Add(Line(m, $"hardware multiply-add may be fused (one rounding) or not (two): {TypeId(t)["System.Runtime.Intrinsics.".Length..]}.{m.Name} differs between CPUs and WebAssembly (plan 9, 10.4): write a * b + c"));
    }
}

// 6. T0.4b hole 2: float-to-integer conversion inside System.Convert. Convert.ToInt32(double) rounds half to even, a third rule beside C#'s cast (truncate)
//    and JavaScript's; FsConv has the JavaScript ones. Banned: every Convert.To* overload with a floating-point parameter, except those that return a
//    floating-point type (ToDouble(float): exact; ToSingle(double): the IEEE narrowing a (float) cast does) or string (ToString(double): formatting, not a
//    numeric conversion). That leaves ToSByte/Byte/Int16/UInt16/Int32/UInt32/Int64/UInt64/Char/Decimal/Boolean (double and float) banned.
//    The same conversion hides behind object (Convert.ChangeType(boxedDouble, typeof(int)), Convert.ToInt32(object), IConvertible.ToInt32): banned too.
var convertTargets = new HashSet<string> { "ToSByte", "ToByte", "ToInt16", "ToUInt16", "ToInt32", "ToUInt32", "ToInt64", "ToUInt64", "ToChar", "ToDecimal", "ToBoolean" };
foreach (var m in Methods(typeof(Convert)))
{
    bool floatParam = m.GetParameters().Any(p => IsFloat(p.ParameterType));
    bool floatOrStringResult = IsFloat(m.ReturnType) || m.ReturnType == typeof(string);
    bool objectSource = convertTargets.Contains(m.Name) && m.GetParameters().Length >= 1 && m.GetParameters()[0].ParameterType == typeof(object);
    if (m.Name.StartsWith("To", StringComparison.Ordinal) && floatParam && !floatOrStringResult)
        lines.Add(Line(m, $"use FsConv (JavaScript conversion semantics, plan 10.4): Convert.{m.Name}({m.GetParameters()[0].ParameterType.Name}) rounds half to even, a third rule beside the cast and JavaScript's"));
    else if (m.Name == "ChangeType" || objectSource)
        lines.Add(Line(m, $"use FsConv: Convert.{m.Name} on a boxed double or float converts with its own rounding (half to even), a third rule beside the cast and JavaScript's"));
}
foreach (var m in typeof(IConvertible).GetMethods())
    if (convertTargets.Contains(m.Name))
        lines.Add(Line(m, $"use FsConv: IConvertible.{m.Name} on a double or float converts with its own rounding, a third rule beside the cast and JavaScript's"));

// 7. T0.4b hole 3: generic-math conversions. int.CreateTruncating(double) and its Saturating/Checked siblings convert a float or double to an integer with a
//    rule of their own, not by a cast, so FS0001 does not see them. Banned on every integer type and on INumberBase<T> (T.CreateTruncating<TOther> in generic
//    code binds to the interface member). CreateX on double/float/Half (to a floating-point type) stays allowed. FsConv.cs may use them (exempt by name).
var createNames = new HashSet<string> { "CreateChecked", "CreateSaturating", "CreateTruncating" };
foreach (var t in new[] { typeof(sbyte), typeof(byte), typeof(short), typeof(ushort), typeof(int), typeof(uint), typeof(long), typeof(ulong), typeof(nint), typeof(nuint),
                          typeof(char), typeof(Int128), typeof(UInt128), typeof(System.Numerics.BigInteger) })
    foreach (var m in Methods(t))
        if (createNames.Contains(m.Name))
            lines.Add(Line(m, $"use FsConv (plan 10.4): {t.Name}.{m.Name} converts a float or double with its own rounding or saturation, not by a visible cast"));
foreach (var m in typeof(System.Numerics.INumberBase<>).GetMethods())
    if (createNames.Contains(m.Name))
        lines.Add(Line(m, $"use FsConv (plan 10.4): INumberBase<T>.{m.Name} converts a float or double with its own rounding or saturation, not by a visible cast"));

Console.Out.NewLine = "\n";
Console.WriteLine("# GENERATED by Fs.Analyzers/tools/GenBannedSymbols.cs on " + Environment.Version + " (" + RuntimeInformationName() + "): do not edit by hand.");
Console.WriteLine("# Regenerate (from prototypes/dotnet-b/, after `source env.sh`): dotnet run Fs.Analyzers/tools/GenBannedSymbols.cs > BannedSymbols.txt");
Console.WriteLine("# Applies to solver projects only (Fs.Analyzers/Solver.props); FsMath.cs, FsConv.cs and Fs.Kernel/Pyrogenic/ are exempt (.editorconfig).");
Console.WriteLine("# Plan: docs/plans/dotnet-option-b-plan.md sections 2 (rule 5), 9 and 10.4.");
foreach (var l in lines.Distinct().OrderBy(x => x, StringComparer.Ordinal)) Console.WriteLine(l);

static string RuntimeInformationName() => System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription;
static IEnumerable<MethodInfo> Methods(Type t) => t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly).Where(m => !m.IsSpecialName);
static bool IsIsaNamespace(string? ns) => ns is "System.Runtime.Intrinsics.X86" or "System.Runtime.Intrinsics.Arm" or "System.Runtime.Intrinsics.Wasm";
static bool IsIsaType(Type t) => IsIsaNamespace(t.Namespace) || (t.IsNested && IsIsaType(t.DeclaringType!));
// a float, double or Half, or a constructed type with one as an element (Vector128<float>, Vector<double>), by value, ref or pointer
static bool HasFloatElement(Type t)
{
    if (t.IsByRef || t.IsPointer || t.IsArray) return HasFloatElement(t.GetElementType()!);
    return IsFloat(t) || (t.IsConstructedGenericType && t.GetGenericArguments().Any(HasFloatElement));
}
static bool IsFloat(Type t) { t = t.IsByRef ? t.GetElementType()! : t; return t == typeof(double) || t == typeof(float) || t == typeof(Half); }

static string ReasonMath(Type t, MethodInfo m) => m.Name == "Round"
    ? $"use FsConv.Round (JavaScript Math.round: halves up): {t.Name}.Round has other tie rules"
    : $"use FsMath.{m.Name} (plan 10.4): {t.Name}.{m.Name} is not on the allowed list (Abs, Sqrt, Floor, Ceiling, Truncate, CopySign, Min, Max)";

static string Line(MethodInfo m, string reason) => $"M:{TypeId(m.DeclaringType!)}.{m.Name}{(m.IsGenericMethodDefinition ? "``" + m.GetGenericArguments().Length : "")}{ParamList(m)};{reason}";

static string ParamList(MethodInfo m)
{
    var ps = m.GetParameters();
    return ps.Length == 0 ? "" : "(" + string.Join(",", ps.Select(p => ParamId(p.ParameterType, m))) + ")";
}

// Documentation-comment ID of a parameter type: `N / ``N for generic parameters, {A,B} for constructed types, [] arrays, * pointers, @ by-ref.
static string ParamId(Type t, MethodInfo m)
{
    if (t.IsByRef) return ParamId(t.GetElementType()!, m) + "@";
    if (t.IsPointer) return ParamId(t.GetElementType()!, m) + "*";
    if (t.IsArray) return ParamId(t.GetElementType()!, m) + "[" + new string(',', t.GetArrayRank() - 1) + "]";
    if (t.IsGenericParameter)
        return t.DeclaringMethod != null ? "``" + t.GenericParameterPosition : "`" + t.GenericParameterPosition;
    if (t.IsConstructedGenericType)
        return TypeId(t.GetGenericTypeDefinition()).Split('`')[0] + "{" + string.Join(",", t.GetGenericArguments().Select(a => ParamId(a, m))) + "}";
    return TypeId(t);
}

static string TypeId(Type t)
{
    var sb = new StringBuilder();
    if (t.IsNested) sb.Append(TypeId(t.DeclaringType!)).Append('.').Append(t.Name);
    else sb.Append(t.Namespace).Append('.').Append(t.Name);
    return sb.ToString();
}
