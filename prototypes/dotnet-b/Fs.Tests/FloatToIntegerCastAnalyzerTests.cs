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
            using System.Numerics;
            enum Colour : byte { Red, Green }
            class C
            {
                {{members}}
                void M(double d, float f, double? nd, long l, int i, Half h, Half? nh, decimal m, decimal? nm, Int128 big)
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
    // T0.4c: Half and decimal to an integer type, decimal to float/double, and the wide integers (the same hole)
    [DataRow("var x = (int)h;", "Half", "int")]
    [DataRow("var x = (long)h;", "Half", "long")]
    [DataRow("var x = (uint)h;", "Half", "uint")]
    [DataRow("var x = (ulong)h;", "Half", "ulong")]
    [DataRow("var x = (short)h;", "Half", "short")]
    [DataRow("var x = (ushort)h;", "Half", "ushort")]
    [DataRow("var x = (sbyte)h;", "Half", "sbyte")]
    [DataRow("var x = (byte)h;", "Half", "byte")]
    [DataRow("var x = (char)h;", "Half", "char")]
    [DataRow("var x = (nint)h;", "Half", "nint")]
    [DataRow("var x = (nuint)h;", "Half", "nuint")]
    [DataRow("var x = unchecked((int)h);", "Half", "int")]
    [DataRow("var x = checked((int)h);", "Half", "int")]
    [DataRow("var x = (int?)nh;", "Half?", "int?")]
    [DataRow("var x = (int)(Half)d;", "Half", "int")]
    [DataRow("var x = (int)m;", "decimal", "int")]
    [DataRow("var x = (long)m;", "decimal", "long")]
    [DataRow("var x = (uint)m;", "decimal", "uint")]
    [DataRow("var x = (ulong)m;", "decimal", "ulong")]
    [DataRow("var x = (short)m;", "decimal", "short")]
    [DataRow("var x = (ushort)m;", "decimal", "ushort")]
    [DataRow("var x = (sbyte)m;", "decimal", "sbyte")]
    [DataRow("var x = (byte)m;", "decimal", "byte")]
    [DataRow("var x = (char)m;", "decimal", "char")]
    [DataRow("var x = (nint)m;", "decimal", "nint")]
    [DataRow("var x = (nuint)m;", "decimal", "nuint")]
    [DataRow("var x = (Colour)m;", "decimal", "Colour")]
    [DataRow("var x = unchecked((int)m);", "decimal", "int")]
    [DataRow("var x = checked((long)m);", "decimal", "long")]
    [DataRow("var x = (int?)nm;", "decimal?", "int?")]
    [DataRow("var x = (int)Math.Floor(m);", "decimal", "int")]
    [DataRow("var x = (double)m;", "decimal", "double")]
    [DataRow("var x = (float)m;", "decimal", "float")]
    [DataRow("var x = (double?)nm;", "decimal?", "double?")]
    [DataRow("var x = (Half)m;", "decimal", "Half")]
    [DataRow("var x = (Int128)d;", "double", "Int128")]
    [DataRow("var x = (UInt128)f;", "float", "UInt128")]
    [DataRow("var x = (BigInteger)d;", "double", "BigInteger")]
    [DataRow("var x = (Int128)h;", "Half", "Int128")]
    [DataRow("var x = (BigInteger)m;", "decimal", "BigInteger")]
    // beyond the card, the same cast hidden in a foreach with a declared integer type (a compound assignment `i += d` does not compile)
    [DataRow("foreach (int x in new double[1]) { }", "double", "int")]
    [DataRow("foreach (long x in new float[1]) { }", "float", "long")]
    [DataRow("foreach (int x in new decimal[1]) { }", "decimal", "int")]
    [DataRow("foreach (int x in new Half[1]) { }", "Half", "int")]
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
    [DataRow("var x = (int)1.5m;")]
    [DataRow("var x = (double)1.5m;")]
    // T0.4c: the neighbours of the new rows stay allowed (exact, IEEE-defined or widening)
    [DataRow("var x = (double)h;")]
    [DataRow("var x = (float)h;")]
    [DataRow("var x = (Half)d;")]
    [DataRow("var x = (Half)f;")]
    [DataRow("var x = (Half)i;")]
    [DataRow("var x = (Half)l;")]
    [DataRow("var x = (decimal)d;")]
    [DataRow("var x = (decimal)f;")]
    [DataRow("var x = (decimal)i;")]
    [DataRow("var x = (decimal)l;")]
    [DataRow("var x = (double)i + (double)l;")]
    [DataRow("var x = (Int128)l;")]
    [DataRow("var x = (BigInteger)i;")]
    [DataRow("var x = (double)big;")]
    [DataRow("var x = (int)big;")]
    [DataRow("var x = m + 1;")]
    [DataRow("var x = m * 2m;")]
    [DataRow("decimal x = i;")]
    [DataRow("var x = (object)m;")]
    [DataRow("d += i; d *= 2; f += i; m += i; l += i; i += i; i *= 2; l <<= 2;")]
    [DataRow("foreach (var x in new double[1]) { }")]
    [DataRow("foreach (double x in new int[1]) { }")]
    [DataRow("foreach (int x in new int[1]) { }")]
    [DataRow("foreach (decimal x in new decimal[1]) { }")]
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
    public async Task ReportsEveryCastOfTheNewFormsOnItsOwn()
    {
        var messages = await Fs0001Async("var a = (int)h; var b = (double)m; var c = (double)h; var e = (decimal)d; foreach (int x in new decimal[1]) { } foreach (var y in new double[1]) { }");

        Assert.HasCount(3, messages, string.Join(Environment.NewLine, messages));
    }

    [TestMethod]
    public async Task IgnoresUserDefinedConversionsFromHalfAndDecimalToTheProgramsOwnTypes()
    {
        var messages = await Fs0001Async("var x = (Id)h; var y = (Id)m; var z = (int)new Id();", """
            struct Id { public static explicit operator Id(Half v) => default; public static explicit operator Id(decimal v) => default; public static explicit operator int(Id v) => 0; }
            """);

        CollectionAssert.AreEqual(Array.Empty<string>(), messages);
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
