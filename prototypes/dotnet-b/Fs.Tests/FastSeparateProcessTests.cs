using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Fs.Tests;

/// <summary>
/// Card T1.4b, the T1.2 and T1.4a arrangement again (vectorization skill, plan section 9): every SIMD situation in its own process. Each test starts this test assembly
/// (<c>dotnet Fs.Tests.dll --filter ...FastPathChecks</c>) with one runtime setting and tells the child what to expect, so a setting that did nothing fails the child. By hand:
/// <c>DOTNET_EnableHWIntrinsic=0 FS_FAST_EXPECT=software dotnet test --project prototypes/dotnet-b/Fs.Tests -- --filter "FullyQualifiedName~FastPathChecks"</c>.
/// Not testable here: arm64 (<c>Vector128</c> maps to NEON) and WebAssembly (T1.4b runs the same case runner in the Mono WebAssembly build under Node).
/// </summary>
[TestClass]
public sealed class FastSeparateProcessTests
{
    [TestMethod]
    public void DefaultHardware() => RunChild("hardware");

    [TestMethod]
    public void Avx2Disabled() => RunChild("no-avx2", ("DOTNET_EnableAVX2", "0"));

    [TestMethod]
    public void Avx512AndAvx2Disabled() => RunChild("no-avx2", ("DOTNET_EnableAVX2", "0"), ("DOTNET_EnableAVX512F", "0"));

    [TestMethod]
    public void HardwareIntrinsicsDisabledSoftwareFallback() => RunChild("software", ("DOTNET_EnableHWIntrinsic", "0"));

    [TestMethod]
    public void TieredCompilationOffFullOptimisationFromTheFirstCall() => RunChild("hardware", ("DOTNET_TieredCompilation", "0"));

    [TestMethod]
    public void TieredPgoOffAndOnStackReplacementOff() => RunChild("hardware", ("DOTNET_TieredPGO", "0"), ("DOTNET_TC_OnStackReplacement", "0"));

    static string DotnetHost()
    {
        string? host = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH");
        if (!string.IsNullOrEmpty(host) && File.Exists(host)) return host;
        string? self = Environment.ProcessPath;
        if (self is not null && Path.GetFileNameWithoutExtension(self) == "dotnet") return self;
        string root = Path.GetFullPath(Path.Combine(RuntimeEnvironment.GetRuntimeDirectory(), "..", "..", ".."));
        string candidate = Path.Combine(root, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        if (File.Exists(candidate)) return candidate;
        Assert.Inconclusive("cannot find the dotnet host to start the child process");
        return "";
    }

    static void RunChild(string expect, params (string Name, string Value)[] env)
    {
        if (Environment.GetEnvironmentVariable("FS_FAST_CHILD") == "1") return; // a child never starts children
        if (!File.Exists(Path.Combine(FastTestData.FixturesRoot(), "fx-k6f-900", "header.json")))
        {
            Assert.Inconclusive("the fixture is missing (see LevelSetKernelTests)");
            return;
        }
        string dll = typeof(FastSeparateProcessTests).Assembly.Location;
        string results = Path.Combine(Path.GetTempPath(), "fs-fast-child-" + Guid.NewGuid().ToString("N"));
        var psi = new ProcessStartInfo(DotnetHost())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(dll)!,
        };
        foreach (string a in new[] { dll, "--filter", "FullyQualifiedName~FastPathChecks", "--minimum-expected-tests", FastPathChecks.TestCount.ToString(), "--progress", "off", "--no-ansi", "--results-directory", results })
            psi.ArgumentList.Add(a);
        psi.Environment["FS_FAST_CHILD"] = "1";
        psi.Environment[FastPathChecks.ExpectVariable] = expect;
        foreach (string k in new[] { "DOTNET_EnableAVX2", "DOTNET_EnableAVX512F", "DOTNET_EnableHWIntrinsic", "DOTNET_TieredCompilation", "DOTNET_TieredPGO", "DOTNET_TC_OnStackReplacement" })
            psi.Environment.Remove(k);
        foreach ((string name, string value) in env) psi.Environment[name] = value;
        try
        {
            using Process p = Process.Start(psi)!;
            Task<string> stdout = p.StandardOutput.ReadToEndAsync();
            Task<string> stderr = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(TimeSpan.FromMinutes(10)))
            {
                p.Kill(entireProcessTree: true);
                Assert.Fail("the child test process did not finish in 10 minutes");
            }
            string output = stdout.GetAwaiter().GetResult() + stderr.GetAwaiter().GetResult();
            Assert.AreEqual(0, p.ExitCode, $"child with {string.Join(" ", env.Select(e => $"{e.Name}={e.Value}"))} (expect {expect}) failed:\n{output}");
            StringAssert.Contains(output, $"succeeded: {FastPathChecks.TestCount}", "the child must have run all the path checks");
        }
        finally
        {
            try { Directory.Delete(results, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}
