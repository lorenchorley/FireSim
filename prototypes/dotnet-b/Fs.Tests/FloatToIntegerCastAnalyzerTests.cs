using System.Collections.Immutable;
using Fs.Analyzers;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Fs.Tests;

[TestClass]
public sealed class FloatToIntegerCastAnalyzerTests
{
    private static async Task<string[]> Fs0001Async(string body, string members = "")
    {
        var source = $$"""
            using System;
            enum Colour : byte { Red, Green }
            class C
            {
                {{members}}
                void M(double d, float f, double? nd, long l, int i)
                {
                    {{body}}
                }
            }
            """;
        var compilation = RoslynHost.Compile(source);
        CollectionAssert.AreEqual(Array.Empty<string>(), RoslynHost.CompilerErrors(compilation), "the snippet must compile");
        var diagnostics = await RoslynHost.AnalyzeAsync(compilation, ImmutableArray.Create<DiagnosticAnalyzer>(new FloatToIntegerCastAnalyzer()));
        return diagnostics.Where(x => x.Id == FloatToIntegerCastAnalyzer.DiagnosticId).Select(x => x.GetMessage()).ToArray();
    }

    [TestMethod]
    [DataRow("var x = (int)d;", "double", "int")]
    [DataRow("var x = (int)f;", "float", "int")]
    [DataRow("var x = (long)d;", "double", "long")]
    [DataRow("var x = (uint)d;", "double", "uint")]
    [DataRow("var x = (ulong)f;", "float", "ulong")]
    [DataRow("var x = (short)d;", "double", "short")]
    [DataRow("var x = (ushort)d;", "double", "ushort")]
    [DataRow("var x = (sbyte)d;", "double", "sbyte")]
    [DataRow("var x = (byte)d;", "double", "byte")]
    [DataRow("var x = (char)d;", "double", "char")]
    [DataRow("var x = (nint)d;", "double", "nint")]
    [DataRow("var x = (nuint)d;", "double", "nuint")]
    [DataRow("var x = (Colour)d;", "double", "Colour")]
    [DataRow("var x = (int)Math.Floor(d);", "double", "int")]
    [DataRow("var x = (int)(d * 2.0 + 1.0);", "double", "int")]
    [DataRow("var x = unchecked((int)d);", "double", "int")]
    [DataRow("var x = checked((int)d);", "double", "int")]
    [DataRow("var x = (int?)nd;", "double?", "int?")]
    [DataRow("var x = (int)nd!.Value;", "double", "int")]
    public async Task ReportsExplicitFloatToIntegerCast(string body, string from, string to)
    {
        var messages = await Fs0001Async(body);

        Assert.HasCount(1, messages, string.Join(Environment.NewLine, messages));
        Assert.Contains($"from '{from}' to '{to}'", messages[0]);
        Assert.Contains("FsConv", messages[0]);
    }

    [TestMethod]
    [DataRow("var x = (double)i;")]
    [DataRow("var x = (float)d;")]
    [DataRow("var x = (double)f;")]
    [DataRow("double x = i;")]
    [DataRow("var x = (int)l;")]
    [DataRow("var x = (long)i;")]
    [DataRow("var x = (byte)i;")]
    [DataRow("var x = (int)3.5;")]
    [DataRow("const int x = (int)1e3;")]
    [DataRow("var x = (int)decimal.One;")]
    [DataRow("var x = Convert.ToInt32(d);")]
    [DataRow("var x = d > 1.0 ? i : -i;")]
    [DataRow("var x = (object)d;")]
    public async Task IgnoresEverythingElse(string body)
    {
        var messages = await Fs0001Async(body);

        CollectionAssert.AreEqual(Array.Empty<string>(), messages);
    }

    [TestMethod]
    public async Task ReportsEveryCastOnItsOwn()
    {
        var messages = await Fs0001Async("var a = (int)d; var b = (long)f; var c = (double)i; var e = (byte)d;");

        Assert.HasCount(3, messages);
    }

    [TestMethod]
    public async Task IgnoresUserDefinedConversionsFromDouble()
    {
        var messages = await Fs0001Async("var x = (Id)d;", """
            struct Id { public static explicit operator Id(double v) => default; }
            """);

        CollectionAssert.AreEqual(Array.Empty<string>(), messages);
    }

    [TestMethod]
    public void IsAnErrorByDefaultAndSupportsExactlyOneDiagnostic()
    {
        var analyzer = new FloatToIntegerCastAnalyzer();

        Assert.HasCount(1, analyzer.SupportedDiagnostics);
        Assert.AreEqual("FS0001", analyzer.SupportedDiagnostics[0].Id);
        Assert.AreEqual(Microsoft.CodeAnalysis.DiagnosticSeverity.Error, analyzer.SupportedDiagnostics[0].DefaultSeverity);
    }
}
