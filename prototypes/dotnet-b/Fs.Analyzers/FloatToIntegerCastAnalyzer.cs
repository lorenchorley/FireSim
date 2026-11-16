using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Operations;

namespace Fs.Analyzers;

/// <summary>
/// FS0001: an explicit cast from <c>float</c> or <c>double</c> to an integer type (or <c>char</c>, or an enum) in solver code.
/// Plan section 10.4: no raw float-to-integer casts; <c>FsConv</c> gives JavaScript's semantics. In .NET 11 an unchecked cast saturates on CoreCLR
/// and NativeAOT but not on Mono, and JavaScript wraps modulo 2^n, so a raw cast gives different answers on different runtimes.
///
/// What it reports: every explicit built-in numeric (or enum) conversion whose operand is <c>float</c>, <c>double</c> or a nullable of them and whose
/// target is <c>sbyte byte short ushort int uint long ulong nint nuint char</c> or an enum, inside <c>checked(...)</c> or <c>unchecked(...)</c> alike.
/// What it does not report: compile-time constants (the compiler folds them the same way everywhere), user-defined conversions, <c>Convert.ToInt32</c>
/// and the generic-math <c>int.CreateTruncating</c> family (not casts; section 10.4 names casts and the Math calls are covered by BannedSymbols.txt),
/// and <c>Half</c> (not named by the card).
/// The files FsMath.cs and FsConv.cs are exempt by name, through the .editorconfig at the root of prototypes/dotnet-b, not here.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class FloatToIntegerCastAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "FS0001";

    private static readonly DiagnosticDescriptor Rule = new(
        id: DiagnosticId,
        title: "Explicit float or double to integer cast in solver code",
        messageFormat: "Explicit cast from '{0}' to '{1}' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)",
        category: "FireSim.Determinism",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true,
        description: "Float-to-integer casts saturate on CoreCLR and NativeAOT, differ on Mono and wrap in JavaScript. Use FsConv.ToInt32, ToUint32, a typed-array store, Round, and so on.");

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterOperationAction(AnalyzeConversion, OperationKind.Conversion);
    }

    private static void AnalyzeConversion(OperationAnalysisContext context)
    {
        var conversion = (IConversionOperation)context.Operation;
        if (conversion.IsImplicit) return;                       // implicit float-to-integer conversions do not exist
        if (conversion.ConstantValue.HasValue) return;           // folded by the compiler
        if (!conversion.Conversion.Exists || conversion.Conversion.IsUserDefined) return;

        var from = Unwrap(conversion.Operand.Type);
        var to = Unwrap(conversion.Type);
        if (from is null || to is null) return;
        if (from.SpecialType != SpecialType.System_Single && from.SpecialType != SpecialType.System_Double) return;
        if (!IsIntegerLike(to)) return;

        context.ReportDiagnostic(Diagnostic.Create(Rule, conversion.Syntax.GetLocation(),
            conversion.Operand.Type!.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat),
            conversion.Type!.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat)));
    }

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
