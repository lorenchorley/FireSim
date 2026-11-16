using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Fs.Tests;

/// <summary>
/// Card T1.2 (vectorization skill, plan section 9): every SIMD situation is tested in its own process, because the settings are process wide and the JIT
/// decides the code once. Each test starts this very test assembly again (<c>dotnet Fs.Tests.dll --filter ...SpeedTestPathChecks</c>) with one runtime
/// setting and tells the child what to expect through <see cref="SpeedTestPathChecks.ExpectVariable"/>, so a setting that silently did nothing fails the
/// child instead of passing. The child runs the frozen checksums on every path and the scalar-equals-vector checks (every tail length).
/// Same thing by hand: <c>DOTNET_EnableHWIntrinsic=0 FS_SPEEDTEST_EXPECT=software dotnet test --project prototypes/dotnet-b/Fs.Tests -- --filter "FullyQualifiedName~SpeedTestPathChecks"</c>.
/// Not testable here, and said so in reports/1-speedtest-kernels.md: arm64 (Vector128 maps to NEON) and WebAssembly (T1.6a).
/// </summary>
[TestClass]
public sealed class SpeedTestSeparateProcessTests
{
    // Names of the situations; the value is the (environment variable, value) pairs set for the child.
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
        // <root>/shared/Microsoft.NETCore.App/<version>/ -> <root>/dotnet
        string root = Path.GetFullPath(Path.Combine(RuntimeEnvironment.GetRuntimeDirectory(), "..", "..", ".."));
        string candidate = Path.Combine(root, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        if (File.Exists(candidate)) return candidate;
        Assert.Inconclusive("cannot find the dotnet host to start the child process");
        return "";
    }

    static void RunChild(string expect, params (string Name, string Value)[] env)
    {
        if (Environment.GetEnvironmentVariable("FS_SPEEDTEST_CHILD") == "1") return; // a child never starts children
        string dll = typeof(SpeedTestSeparateProcessTests).Assembly.Location;
        string results = Path.Combine(Path.GetTempPath(), "fs-speedtest-child-" + Guid.NewGuid().ToString("N"));
        var psi = new ProcessStartInfo(DotnetHost())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(dll)!,
        };
        foreach (string a in new[] { dll, "--filter", "FullyQualifiedName~SpeedTestPathChecks", "--minimum-expected-tests", "6", "--progress", "off", "--no-ansi", "--results-directory", results })
            psi.ArgumentList.Add(a);
        psi.Environment["FS_SPEEDTEST_CHILD"] = "1";
        psi.Environment[SpeedTestPathChecks.ExpectVariable] = expect;
        // a clean slate: none of the knobs of the other situations leaks in from the parent's environment
        foreach (string k in new[] { "DOTNET_EnableAVX2", "DOTNET_EnableAVX512F", "DOTNET_EnableHWIntrinsic", "DOTNET_TieredCompilation", "DOTNET_TieredPGO", "DOTNET_TC_OnStackReplacement" })
            psi.Environment.Remove(k);
        foreach ((string name, string value) in env) psi.Environment[name] = value;
        try
        {
            using Process p = Process.Start(psi)!;
            Task<string> stdout = p.StandardOutput.ReadToEndAsync();
            Task<string> stderr = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(TimeSpan.FromMinutes(5)))
            {
                p.Kill(entireProcessTree: true);
                Assert.Fail("the child test process did not finish in 5 minutes");
            }
            string output = stdout.GetAwaiter().GetResult() + stderr.GetAwaiter().GetResult();
            Assert.AreEqual(0, p.ExitCode, $"child with {string.Join(" ", env.Select(e => $"{e.Name}={e.Value}"))} (expect {expect}) failed:\n{output}");
            StringAssert.Contains(output, "succeeded: 6", "the child must have run the six path checks");
        }
        finally
        {
            try { Directory.Delete(results, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}
