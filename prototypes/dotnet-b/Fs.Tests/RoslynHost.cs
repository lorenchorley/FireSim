using System.Collections.Immutable;
using System.Reflection;
using System.Runtime.Loader;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Text;

namespace Fs.Tests;

/// <summary>Compiles C# snippets in process against the running runtime's own assemblies and runs analyzers over them.</summary>
internal static class RoslynHost
{
    private static readonly Lazy<ImmutableArray<MetadataReference>> s_references = new(() =>
    {
        var tpa = (string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!;
        return tpa.Split(Path.PathSeparator)
            .Where(p => p.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            .Select(p => (MetadataReference)MetadataReference.CreateFromFile(p))
            .ToImmutableArray();
    });

    private static readonly object s_resolveLock = new();
    private static readonly HashSet<string> s_resolving = new();

    public static CSharpCompilation Compile(string source, string fileName = "Snippet.cs")
    {
        var tree = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(LanguageVersion.Latest), path: fileName);
        return CSharpCompilation.Create("Snippet", new[] { tree }, s_references.Value,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, allowUnsafe: true, nullableContextOptions: NullableContextOptions.Enable));
    }

    /// <summary>The compilation's own errors, as text: a snippet must compile, or a clean analyzer result would mean nothing.</summary>
    public static string[] CompilerErrors(Compilation compilation) =>
        compilation.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).Select(d => d.ToString()).ToArray();

    public static async Task<ImmutableArray<Diagnostic>> AnalyzeAsync(
        Compilation compilation, ImmutableArray<DiagnosticAnalyzer> analyzers, params AdditionalText[] additionalFiles)
    {
        var withAnalyzers = compilation.WithAnalyzers(analyzers, new AnalyzerOptions(additionalFiles.ToImmutableArray<AdditionalText>()));
        return await withAnalyzers.GetAnalyzerDiagnosticsAsync();
    }

    /// <summary>The analyzers inside an analyzer assembly on disk, as the compiler would load them.</summary>
    public static ImmutableArray<DiagnosticAnalyzer> LoadCSharpAnalyzers(string assemblyPath)
    {
        // the analyzer's own sibling assemblies (BannedApiAnalyzers.dll, next to the C# one) are not on the test host's probing path
        var directory = Path.GetDirectoryName(assemblyPath)!;
        lock (s_resolveLock)
        {
            if (!s_resolving.Contains(directory))
            {
                s_resolving.Add(directory);
                AssemblyLoadContext.Default.Resolving += (context, name) =>
                {
                    var candidate = Path.Combine(directory, name.Name + ".dll");
                    return File.Exists(candidate) ? context.LoadFromAssemblyPath(candidate) : null;
                };
            }
        }
        var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(assemblyPath);
        var analyzers = ImmutableArray.CreateBuilder<DiagnosticAnalyzer>();
        foreach (var type in assembly.GetTypes())
        {
            if (type.IsAbstract || !typeof(DiagnosticAnalyzer).IsAssignableFrom(type)) continue;
            var attribute = type.GetCustomAttribute<DiagnosticAnalyzerAttribute>();
            if (attribute is null || !attribute.Languages.Contains(LanguageNames.CSharp)) continue;
            analyzers.Add((DiagnosticAnalyzer)Activator.CreateInstance(type)!);
        }
        return analyzers.ToImmutable();
    }

    public sealed class TextFile(string path, string content) : AdditionalText
    {
        public override string Path { get; } = path;
        public override SourceText GetText(CancellationToken cancellationToken = default) => SourceText.From(content);
    }
}
