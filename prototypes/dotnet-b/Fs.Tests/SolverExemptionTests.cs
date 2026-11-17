using System.Text.RegularExpressions;

namespace Fs.Tests;

/// <summary>
/// Card T1.4b: no folder of a solver project is exempt from the analyzers any more. Until then <c>Fs.Kernel/Pyrogenic/</c> (the K1 salvage) was exempt by path in
/// <c>.editorconfig</c>; the folder was brought under the rules of plan 10.4 and the section deleted. The real proof that the sources obey the rules is that
/// <c>dotnet build Fs.Kernel</c> succeeds with RS0030 and FS0001 as errors, and that <c>Fs.Analyzers/tools/demo-bad-solver.sh</c> (case 3) shows that a bad file in
/// <c>Fs.Kernel/Pyrogenic/</c> fails it. These tests pin the list of exempt paths and read the kernels' text for the patterns the analyzers ban, so that a
/// re-added exemption cannot go unnoticed here either.
/// </summary>
[TestClass]
public sealed class SolverExemptionTests
{
    static string RootDir([System.Runtime.CompilerServices.CallerFilePath] string here = "") => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, ".."));

    [TestMethod]
    public void OnlyFsMathFsConvAndTheVendoredSourcesAreExemptFromTheAnalyzers()
    {
        string path = Path.Combine(RootDir(), ".editorconfig");
        if (!File.Exists(path)) Assert.Inconclusive($"{path} not found (the tests run away from the source tree)");
        var exempt = new List<string>();
        string? section = null;
        foreach (string raw in File.ReadAllLines(path))
        {
            string line = raw.Trim();
            if (line.StartsWith('[') && line.EndsWith(']')) section = line[1..^1];
            else if (section is not null && section != "*.cs" && Regex.IsMatch(line, @"^dotnet_diagnostic\.(RS0030|FS0001)\.severity\s*=\s*(none|silent|suggestion|hidden|warning)$"))
            {
                if (!exempt.Contains(section)) exempt.Add(section);
            }
        }
        CollectionAssert.AreEquivalent(new[] { "FsMath.cs", "FsConv.cs", "Fs.Kernel/ThirdParty/**.cs" }, exempt, "the exempt paths of .editorconfig");
        StringAssert.DoesNotMatch(File.ReadAllText(path), new Regex(@"^\[[^\]]*Pyrogenic", RegexOptions.Multiline));
    }

    static readonly Regex Banned = new(
        @"\b(Math|MathF|double|float|Single|Double)\s*\.\s*(Exp|Exp2|Log|Log2|Log10|Pow|Sin|Cos|Tan|Asin|Acos|Atan|Atan2|Sinh|Cosh|Tanh|Asinh|Acosh|Atanh|Cbrt|Hypot|SinCos|FusedMultiplyAdd|Round|ScaleB|ILogB|IEEERemainder|ReciprocalEstimate|ReciprocalSqrtEstimate)\b|TensorPrimitives|\bVector<|\bVector256\b|\bVector512\b|\b[A-Za-z]+Native\s*\(|System\.Runtime\.Intrinsics\.(X86|Arm|Wasm)|\*\*",
        RegexOptions.Compiled);

    static string StripComments(string src)
    {
        src = Regex.Replace(src, @"/\*.*?\*/", "", RegexOptions.Singleline);
        src = Regex.Replace(src, @"""(\\.|[^""\\])*""", "\"\"");
        return Regex.Replace(src, @"//[^\n]*", "");
    }

    [TestMethod]
    public void TheFormerlyExemptAndTheNewFastTierKernelsCallNoPlatformMathsNoWideVectorsNoTensorPrimitives()
    {
        string dir = Path.Combine(RootDir(), "Fs.Kernel");
        if (!Directory.Exists(dir)) Assert.Inconclusive($"{dir} not found (the tests run away from the source tree)");
        var files = new List<string> { Path.Combine(dir, "KernelExec.cs") };
        foreach (string sub in new[] { "Pyrogenic", "LevelSet", "Air" }) if (Directory.Exists(Path.Combine(dir, sub))) files.AddRange(Directory.GetFiles(Path.Combine(dir, sub), "*.cs"));
        Assert.IsTrue(files.Count >= 5, "found only " + files.Count + " source files");
        var hits = new List<string>();
        foreach (string f in files)
        {
            var m = Banned.Match(StripComments(File.ReadAllText(f)));
            if (m.Success) hits.Add($"{Path.GetRelativePath(dir, f)}: {m.Value}");
        }
        Assert.AreEqual(0, hits.Count, "banned patterns: " + string.Join("; ", hits));
    }
}
