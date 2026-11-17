using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;

namespace Fs.Analyzers;

/// <summary>
/// FS0001: an explicit cast that turns a floating-point or decimal value into an integer (or <c>char</c>, or an enum), or a decimal into a binary
/// floating-point type, in solver code.
/// Plan section 10.4: no raw float-to-integer casts; <c>FsConv</c> gives JavaScript's semantics. In .NET 11 an unchecked cast saturates on CoreCLR
/// and NativeAOT but not on Mono, and JavaScript wraps modulo 2^n, so a raw cast gives different answers on different runtimes.
///
/// What it reports: every explicit numeric (or enum) conversion, inside <c>checked(...)</c> or <c>unchecked(...)</c> alike, from
///   - <c>float</c> or <c>double</c> (or a nullable of them; built-in conversions) to <c>sbyte byte short ushort int uint long ulong nint nuint char</c> or an enum;
///   - <c>Half</c> or <c>decimal</c> (card T0.4c; in the runtime these are user-defined operators of its own structs) to the same integer targets;
///   - <c>decimal</c> to <c>float</c>, <c>double</c> or <c>Half</c> (T0.4c);
///   - beyond the card, same hole: any of <c>float double Half decimal</c> to <c>Int128</c>, <c>UInt128</c> or <c>BigInteger</c> (also user-defined operators);
///   - beyond the card, same hole: the cast hidden in <c>foreach (int x in doubles)</c> (a compound assignment <c>i += d</c> needs no rule: C# rejects it).
/// What it does not report: compile-time constants (the compiler folds them the same way everywhere), user-defined conversions of the program's own
/// types (<c>(Id)d</c>), <c>Convert.ToInt32</c> and the generic-math <c>int.CreateTruncating</c> family (not casts; BannedSymbols.txt bans those), and the
/// exact or IEEE-defined conversions: <c>Half</c> to <c>float</c> or <c>double</c>, <c>float</c> or <c>double</c> to <c>Half</c> or <c>decimal</c>, integer to anything.
/// The files FsMath.cs and FsConv.cs are exempt by name, through the .editorconfig at the root of prototypes/dotnet-b, not here.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class FloatToIntegerCastAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "FS0001";

    private static readonly DiagnosticDescriptor Rule = new(
        id: DiagnosticId,
        title: "Explicit float, Half or decimal to integer cast in solver code",
        messageFormat: "Explicit cast from '{0}' to '{1}' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)",
        category: "FireSim.Determinism",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true,
        description: "Float-to-integer casts saturate on CoreCLR and NativeAOT, differ on Mono and wrap in JavaScript; Half and decimal casts have rules of their own. Use FsConv.ToInt32, ToUint32, a typed-array store, Round, and so on.");

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterOperationAction(AnalyzeConversion, OperationKind.Conversion);
        context.RegisterOperationAction(AnalyzeForEach, OperationKind.Loop);
    }

    // `foreach (int x in doubles)` casts every element with an explicit conversion that the operation tree does not show as an IConversionOperation: it is
    // in the semantic model's ForEachStatementInfo. (A compound assignment `i += d` is no hole: C# rejects it, CS0266, unless d converts to int implicitly.)
    private static void AnalyzeForEach(OperationAnalysisContext context)
    {
        if (context.Operation is not IForEachLoopOperation loop) return;
        if (loop.Syntax is not ForEachStatementSyntax syntax || loop.SemanticModel is null) return;
        if (loop.LoopControlVariable is not IVariableDeclaratorOperation { Symbol: { } variable }) return;
        var info = loop.SemanticModel.GetForEachStatementInfo(syntax);
        if (!info.ElementConversion.Exists || info.ElementConversion.IsIdentity || info.ElementConversion.IsImplicit) return;
        var element = Unwrap(info.ElementType);
        var target = Unwrap(variable.Type);
        if (element is null || target is null || !IsBanned(element, target)) return;

        context.ReportDiagnostic(Diagnostic.Create(Rule, syntax.Type.GetLocation(),
            info.ElementType!.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat),
            variable.Type.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat)));
    }

    private static void AnalyzeConversion(OperationAnalysisContext context)
    {
        var conversion = (IConversionOperation)context.Operation;
        if (conversion.IsImplicit) return;                       // implicit float-to-integer conversions do not exist
        if (conversion.ConstantValue.HasValue) return;           // folded by the compiler
        if (!conversion.Conversion.Exists) return;

        var from = Unwrap(conversion.Operand.Type);
        var to = Unwrap(conversion.Type);
        if (from is null || to is null) return;
        if (!IsBanned(from, to)) return;

        context.ReportDiagnostic(Diagnostic.Create(Rule, conversion.Syntax.GetLocation(),
            conversion.Operand.Type!.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat),
            conversion.Type!.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat)));
    }

    private static bool IsBanned(ITypeSymbol from, ITypeSymbol to)
    {
        // float and double: the built-in conversions to every integer-like type, and the user-defined ones to Int128, UInt128 and BigInteger
        if (from.SpecialType is SpecialType.System_Single or SpecialType.System_Double) return IsIntegerLike(to) || IsWideInteger(to);
        // Half and decimal are structs of the runtime: their conversions are user-defined operators
        bool isDecimal = from.SpecialType == SpecialType.System_Decimal;
        if (isDecimal || IsSystemType(from, "Half"))
        {
            if (IsIntegerLike(to) || IsWideInteger(to)) return true;
            // decimal to a binary floating-point type: a rounding of its own
            return isDecimal && (to.SpecialType is SpecialType.System_Single or SpecialType.System_Double || IsSystemType(to, "Half"));
        }
        return false;
    }

    private static bool IsSystemType(ITypeSymbol type, string name) =>
        type.Name == name && type.ContainingNamespace is { Name: "System", ContainingNamespace.IsGlobalNamespace: true };

    private static bool IsWideInteger(ITypeSymbol type) =>
        IsSystemType(type, "Int128") || IsSystemType(type, "UInt128")
        || (type.Name == "BigInteger" && type.ContainingNamespace is { Name: "Numerics", ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true } });

    private static ITypeSymbol? Unwrap(ITypeSymbol? type)
    {
        if (type is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nullable)
            return nullable.TypeArguments[0];
        return type;
    }

    private static bool IsIntegerLike(ITypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum) return true;
        switch (type.SpecialType)
        {
            case SpecialType.System_SByte:
            case SpecialType.System_Byte:
            case SpecialType.System_Int16:
            case SpecialType.System_UInt16:
            case SpecialType.System_Int32:
            case SpecialType.System_UInt32:
            case SpecialType.System_Int64:
            case SpecialType.System_UInt64:
            case SpecialType.System_IntPtr:
            case SpecialType.System_UIntPtr:
            case SpecialType.System_Char:
                return true;
            default:
                return false;
        }
    }
}
