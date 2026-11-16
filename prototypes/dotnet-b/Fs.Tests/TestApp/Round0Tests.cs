using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FsTestApp.Arms;
using FsTestApp.Device;
using FsTestApp.Results;
using FsTestApp.Round0;
using FsTestApp.Sending;
using FsTestApp.Session;

namespace Fs.Tests.TestApp;

/// <summary>Where the repository's files are, found from FsProto.slnx (prototypes/dotnet-b) upward.</summary>
internal static class RepoFiles
{
    public static string ProtoRoot()
    {
        string? dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "FsProto.slnx"))) dir = Path.GetDirectoryName(dir);
        Assert.IsNotNull(dir, "FsProto.slnx not found above the test binaries");
        return dir;
    }

    public static string Wwwroot() => Path.Combine(ProtoRoot(), "Fs.TestApp", "Resources", "Raw", "wwwroot");

    /// <summary>A file of the app's own source tree (src/...), or null when the tests run from a copy without it.</summary>
    public static string? Src(string relative)
    {
        string path = Path.GetFullPath(Path.Combine(ProtoRoot(), "..", "..", relative));
        return File.Exists(path) ? path : null;
    }
}

[TestClass]
public sealed class CpuFactsTests
{
    [TestMethod]
    [DataRow("1800000\n", 1800000L)]
    [DataRow("  300000  ", 300000L)]
    [DataRow("0", 0L)]
    [DataRow("max", null)]
    [DataRow("<unknown>", null)]
    [DataRow("", null)]
    [DataRow("-5", null)]
    [DataRow("1,8", null)]
    [DataRow(null, null)]
    public void FrequencyLinesParseOrAreNull(string? text, long? expected) => Assert.AreEqual(expected, CpuFacts.ParseKhz(text));

    [TestMethod]
    public void CpuListsUseTheKernelsRangeFormat()
    {
        CollectionAssert.AreEqual(new[] { 0, 1, 2, 3, 6, 8, 9 }, CpuFacts.ParseCpuList("0-3,6,8-9\n").ToArray());
        CollectionAssert.AreEqual(new[] { 0, 1, 2, 3 }, CpuFacts.ParseCpuList("0 1 2 3\n").ToArray(), "related_cpus is space separated");
        CollectionAssert.AreEqual(new[] { 7 }, CpuFacts.ParseCpuList("7").ToArray());
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("a-b")]
    [DataRow("5-2")]
    [DataRow("0-3,x")]
    [DataRow("0-100000000")]
    public void MalformedCpuListsGiveNothing(string text) => Assert.AreEqual(0, CpuFacts.ParseCpuList(text).Count);

    const string ArmCpuinfo = "processor\t: 0\nBogoMIPS\t: 26.00\nFeatures\t: fp asimd\nCPU implementer\t: 0x41\nCPU architecture: 8\nCPU variant\t: 0x0\nCPU part\t: 0xd05\nCPU revision\t: 0\n\n"
        + "processor\t: 1\nCPU implementer\t: 0x41\nCPU part\t: 0xd4e\n\nHardware\t: Some SoC\n";

    [TestMethod]
    public void ProcCpuinfoGivesImplementerAndPartPerProcessor()
    {
        var list = CpuFacts.ParseProcCpuinfo(ArmCpuinfo);
        Assert.AreEqual(2, list.Count);
        Assert.AreEqual(new ProcCpu(0, "0x41", "0xd05"), list[0]);
        Assert.AreEqual(new ProcCpu(1, "0x41", "0xd4e"), list[1]);
    }

    [TestMethod]
    public void ProcCpuinfoWithoutArmFieldsOrWithGarbageIsHarmless()
    {
        Assert.AreEqual(0, CpuFacts.ParseProcCpuinfo(null).Count);
        Assert.AreEqual(0, CpuFacts.ParseProcCpuinfo("no colon here\nmodel name: x").Count);
        var x86 = CpuFacts.ParseProcCpuinfo("processor : 0\nmodel name : Xeon\nprocessor : 1\nmodel name : Xeon\n");
        Assert.AreEqual(2, x86.Count);
        Assert.IsNull(x86[0].Part);
        var bad = CpuFacts.ParseProcCpuinfo("processor : 0\nCPU part : zz\nCPU implementer : 65\n");
        Assert.IsNull(bad[0].Part, "a non-hex part is not trusted");
        Assert.IsNull(bad[0].Implementer, "the kernel prints 0x..; plain digits are not trusted");
    }

    [TestMethod]
    public void ArmCoreNamesOnlyForArmsOwnCores()
    {
        Assert.AreEqual("Cortex-A55", CpuFacts.ArmCoreName("0x41", "0xd05"));
        Assert.AreEqual("Cortex-X3", CpuFacts.ArmCoreName("0x41", "0xd4e"));
        Assert.IsNull(CpuFacts.ArmCoreName("0x51", "0xd05"), "another implementer's part number means something else");
        Assert.IsNull(CpuFacts.ArmCoreName("0x41", "0xffff"));
        Assert.IsNull(CpuFacts.ArmCoreName(null, "0xd05"));
    }

    [TestMethod]
    public void ClustersGroupByMaximumFrequencyAscendingWithUnknownLast()
    {
        var g = CpuFacts.Clusters(new (int, long?)[] { (0, 1800000), (1, 1800000), (2, null), (3, 2800000), (4, 2400000), (5, 2400000) });
        CollectionAssert.AreEqual(new long?[] { 1800000, 2400000, 2800000, null }, g.Select(x => x.MaxKhz).ToArray());
        CollectionAssert.AreEqual(new[] { 4, 5 }, g[1].Cpus.ToArray());
    }

    [TestMethod]
    public void ThreeClusterPhoneGivesEightCoresAndThreeClusters()
    {
        var cpu = CpuFacts.Read(InMemorySysfs.ThreeClusterPhone(), logicalCores: 8);
        Assert.AreEqual("0-7", cpu["present"]!.ToString());
        var cores = (JsonArray)cpu["cores"]!;
        Assert.AreEqual(8, cores.Count);
        Assert.AreEqual(2800000, (long)cores[7]!["maxKhz"]!);
        Assert.AreEqual("Cortex-A55", cores[0]!["armCore"]!.ToString());
        Assert.AreEqual("schedutil", cores[0]!["governor"]!.ToString());
        Assert.IsTrue((bool)cpu["cpufreqRead"]!);
        var clusters = (JsonArray)cpu["clusters"]!;
        Assert.AreEqual(3, clusters.Count);
        Assert.AreEqual(4, ((JsonArray)clusters[0]!["cpus"]!).Count);
        Assert.AreEqual(1800000, (long)clusters[0]!["maxKhz"]!);
        Assert.IsNull(cpu["unreadable"], "everything was readable");
    }

    [TestMethod]
    public void RefusedFrequencyFilesAreRecordedAndTheRestStillWorks()
    {
        // newer Android versions can refuse /sys/devices/system/cpu/*/cpufreq to an app: every core still shows up, with no frequencies
        var fs = new InMemorySysfs().Add("/sys/devices/system/cpu/present", "0-3\n").Add("/proc/cpuinfo", "processor : 0\nCPU implementer : 0x41\nCPU part : 0xd05\n");
        for (int i = 0; i < 4; i++) fs.Refuse($"/sys/devices/system/cpu/cpu{i}/cpufreq/cpuinfo_max_freq");
        var cpu = CpuFacts.Read(fs, 4);
        Assert.AreEqual(4, ((JsonArray)cpu["cores"]!).Count);
        Assert.IsFalse((bool)cpu["cpufreqRead"]!);
        Assert.IsNull(((JsonArray)cpu["cores"]!)[0]!["maxKhz"]);
        var unreadable = (JsonArray)cpu["unreadable"]!;
        Assert.IsTrue(unreadable.Any(u => u!["error"]!.ToString().Contains("denied")), "the refusal is in the document");
        Assert.AreEqual(4, (int)unreadable.First(u => u!["error"]!.ToString().Contains("denied"))!["count"]!, "grouped by error: one entry, a count");
        Assert.AreEqual(1, ((JsonArray)cpu["clusters"]!).Count, "no frequencies: one group of unknown");
    }

    [TestMethod]
    public void CoresAreFoundByDirectoryWhenPresentIsUnreadable()
    {
        var fs = new InMemorySysfs();
        for (int i = 0; i < 3; i++) fs.Add($"/sys/devices/system/cpu/cpu{i}/cpufreq/cpuinfo_max_freq", "1000000\n");
        var cpu = CpuFacts.Read(fs, 3);
        Assert.AreEqual(3, ((JsonArray)cpu["cores"]!).Count);
        Assert.IsNull(cpu["present"]);
    }

    [TestMethod]
    public void NothingReadableStillGivesASection()
    {
        var cpu = CpuFacts.Read(new InMemorySysfs(), 6);
        Assert.AreEqual(6, (int)cpu["logicalCores"]!);
        Assert.AreEqual(0, ((JsonArray)cpu["cores"]!).Count);
        Assert.IsFalse((bool)cpu["cpufreqRead"]!);
    }
}

[TestClass]
public sealed class DeviceFactsTests
{
    static JsonObject Build(IDeviceProbe? probe = null, DeviceSnapshot? state = null)
        => DeviceFactsDocument.Build(probe ?? new FakeDeviceProbe(), state ?? new DeviceSnapshot { BatteryPercent = 77, IsCharging = true, Thermal = ThermalStatus.Light }, InMemorySysfs.ThreeClusterPhone(), 8);

    [TestMethod]
    public void SectionsStateAndCpuAreAllThere()
    {
        var d = Build();
        Assert.AreEqual(1, (int)d["schema"]!);
        Assert.AreEqual("Dry Run 1", d["hardware"]!["model"]!.ToString());
        Assert.AreEqual(36, (int)d["os"]!["sdkInt"]!);
        Assert.AreEqual(8, ((JsonArray)d["cpu"]!["cores"]!).Count);
        Assert.AreEqual("light", d["state"]!["thermalStatus"]!.ToString());
        Assert.AreEqual(77, (int)d["state"]!["batteryPercent"]!);
        Assert.IsTrue((bool)d["state"]!["charging"]!);
        Assert.IsNotNull(d["collectedMs"]);
    }

    [TestMethod]
    public void AFailingMemberOrSectionIsRecordedAndTheOthersStillRun()
    {
        var d = Build();
        var items = ((JsonArray)d["failures"]!).Select(f => f!["item"]!.ToString()).ToList();
        CollectionAssert.AreEquivalent(new[] { "screen.refreshRateHz", "battery.(whole section)" }, items);
        Assert.AreEqual(1080, (int)d["screen"]!["widthPx"]!, "the member before the failing one was kept");
        Assert.IsNull(d["screen"]!["refreshRateHz"]);
        Assert.IsNotNull(d["battery"], "a failed section is an empty object, not missing");
        StringAssert.Contains(((JsonArray)d["failures"]!).First(f => f!["item"]!.ToString().StartsWith("battery"))!["error"]!.ToString(), "refused");
    }

    [TestMethod]
    public void NanAndInfinityAreLeftOutNotWritten()
    {
        var d = Build();
        Assert.IsNull(d["screen"]!["density"], "NaN is not JSON");
        var bag = new FactBag();
        bag.Add("a", () => float.PositiveInfinity).Add("b", () => double.NaN).Add("c", () => 1.5).Add("d", () => (object?)null);
        Assert.IsNull(bag.Values["a"]);
        Assert.IsNull(bag.Values["b"]);
        Assert.AreEqual(1.5, (double)bag.Values["c"]!);
        Assert.IsNull(bag.Values["d"]);
        Assert.AreEqual(0, bag.Failures.Count);
    }

    [TestMethod]
    public void TheDocumentDoesNotDependOnTheCulture()
    {
        var old = CultureInfo.CurrentCulture;
        try
        {
            // a comma-decimal culture (the container runs in invariant-globalization mode, so de-DE itself is not available: clone the invariant one and change its separators)
            var comma = (CultureInfo)CultureInfo.InvariantCulture.Clone();
            comma.NumberFormat.NumberDecimalSeparator = ",";
            comma.NumberFormat.NumberGroupSeparator = ".";
            CultureInfo.CurrentCulture = comma;
            Assert.AreEqual("1,5", 1.5.ToString(CultureInfo.CurrentCulture), "the test culture really is comma-decimal");
            var bag = new FactBag();
            bag.Add("x", () => 1.5).Add("y", () => 1234567.891).Add("s", () => (object)new List<string> { "a", "b" });
            string json = bag.Values.ToJsonString();
            StringAssert.Contains(json, "\"x\":1.5");
            StringAssert.Contains(json, "1234567.891");
            Assert.IsFalse(json.Contains("1,5"), json);
            var other = Build();
            Assert.IsTrue(other.ToJsonString().Contains("\"thermalStatus\":\"light\""));
        }
        finally { CultureInfo.CurrentCulture = old; }
    }

    [TestMethod]
    public void StateLeavesUnreadValuesOut()
    {
        var s = DeviceFactsDocument.State(new DeviceSnapshot { Thermal = ThermalStatus.Unknown, ThermalHeadroom = double.NaN });
        Assert.AreEqual("unknown", s["thermalStatus"]!.ToString());
        Assert.IsNull(s["thermalHeadroom"]);
        Assert.IsNull(s["batteryPercent"]);
        Assert.IsNull(s["charging"]);
    }

    [TestMethod]
    public void DigestIsFirstShortAndSaysWhatWasFound()
    {
        var d = Build();
        Assert.AreEqual("digest", d.First().Key);
        string digest = Digests.Of(d)!;
        Assert.IsTrue(digest.Length <= Digests.MaxLength, digest);
        foreach (var piece in new[] { "Simulated Dry Run 1", "SM-0000", "android 16 sdk 36", "arm64-v8a", "7800 MB", "1080x?@?Hz", "kHz 1800000x4/2400000x3/2800000x1", "thermal light", "battery 77% charging", "2 unread" })
            StringAssert.Contains(digest, piece);
    }

    [TestMethod]
    public void ADigestThePageSuppliesIsReplacedNotTrusted()
    {
        var o = new JsonObject { ["digest"] = "from the page", ["x"] = 1 };
        Digests.Attach(o, "ours");
        Assert.AreEqual("ours", Digests.Of(o));
        Assert.AreEqual("digest", o.First().Key);
        Assert.AreEqual(2, o.Count);
    }

    [TestMethod]
    public void ThePhoneDocumentIsSchemaValidAndSmall()
    {
        var doc = TestDocs.Valid(arms: 0);
        doc.Arms.Add(new ArmRecord { Block = 0, Name = "device-facts", Runtime = "coreclr", DurationMs = 12, EstimatedSeconds = 2, Result = Build() });
        var errors = ResultValidator.Validate(doc);
        Assert.AreEqual(0, errors.Count, string.Join("; ", errors));
        Assert.IsTrue(ResultJsonContext.SerializeToUtf8(doc).Length < 12_000);
    }

    [TestMethod]
    public async Task TheArmReturnsTheDocumentAndStopsWhenCancelled()
    {
        var arm = new DeviceFactsArm(new FakeDeviceProbe(), new SimulatedDeviceState(), InMemorySysfs.ThreeClusterPhone());
        Assert.AreEqual("device-facts", arm.Name);
        var node = await arm.RunAsync(new Progress<ArmProgress>(), CancellationToken.None);
        Assert.AreEqual("Simulated", node["hardware"]!["manufacturer"]!.ToString());
        Assert.AreEqual("none", node["state"]!["thermalStatus"]!.ToString());
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() => arm.RunAsync(new Progress<ArmProgress>(), cts.Token));
    }

    [TestMethod]
    public async Task ADeviceThatCannotBeReadDoesNotStopTheArm()
    {
        var arm = new DeviceFactsArm(new FakeDeviceProbe(withFailures: false), new ThrowingDevice(), InMemorySysfs.ThreeClusterPhone());
        var node = await arm.RunAsync(new Progress<ArmProgress>(), CancellationToken.None);
        Assert.AreEqual("unknown", node["state"]!["thermalStatus"]!.ToString());
    }

    sealed class ThrowingDevice : IDeviceState
    {
        public DeviceSnapshot Read() => throw new InvalidOperationException("no device");
        public event Action<bool>? ForegroundChanged { add { } remove { } }
        public event Action<bool>? ScreenChanged { add { } remove { } }
        public event Action<bool>? NetworkChanged { add { } remove { } }
    }
}

[TestClass]
public sealed class KernelChecksTests
{
    static JsonObject Run(string stencil, string copy, double mcells, double gbps) => new()
    {
        ["stencilAfter3"] = stencil, ["copyAfter2"] = copy, ["stencilMcellsPerS"] = mcells, ["copyGBps"] = gbps, ["kernelsSha256"] = new string('a', 64),
    };

    static JsonObject Result(params JsonObject[] runs) => new() { ["runs"] = new JsonArray(runs.Select(r => (JsonNode)r).ToArray()) };

    [TestMethod]
    public void ThreeMatchingRunsGiveTheMediansAndTheAppsRatios()
    {
        var r = KernelChecks.Annotate(Result(Run("0x7d268009", "0x1e84aad9", 10, 2), Run("0x7d268009", "0x1e84aad9", 12, 2.2), Run("0x7d268009", "0x1e84aad9", 11, 2.1)));
        var v = (JsonObject)r["verdict"]!;
        Assert.IsTrue((bool)v["checksumsMatch"]!);
        Assert.AreEqual(3, (int)v["stencilChecksumRunsOk"]!);
        Assert.AreEqual(11.0, (double)v["stencilMcellsPerS"]!["median"]!);
        Assert.AreEqual(10.0, (double)v["stencilMcellsPerS"]!["min"]!);
        Assert.AreEqual(12.0, (double)v["stencilMcellsPerS"]!["max"]!);
        Assert.AreEqual(Math.Round(2.0 / 11 * 100, 2), (double)v["stencilMcellsPerS"]!["spreadPercent"]!);
        // the app's ratio: reference / measured, over 1 is slower than the build machine
        Assert.AreEqual(Math.Round(53.5 / 11, 3), (double)v["ratioVsReference"]!["stencil"]!);
        Assert.AreEqual(Math.Round(4.26 / 2.1, 3), (double)v["ratioVsReference"]!["copy"]!);
        Assert.AreEqual("digest", r.First().Key);
        StringAssert.Contains(Digests.Of(r)!, "checksums MATCH in 3 runs");
    }

    [TestMethod]
    public void OneWrongChecksumIsAMismatchAndSaysWhich()
    {
        var r = KernelChecks.Annotate(Result(Run("0x7d268009", "0x1e84aad9", 10, 2), Run("0x7d268008", "0x1e84aad9", 10, 2), Run("0x7d268009", "0x00000000", 10, 2)));
        var v = (JsonObject)r["verdict"]!;
        Assert.IsFalse((bool)v["checksumsMatch"]!);
        Assert.AreEqual(2, (int)v["stencilChecksumRunsOk"]!);
        Assert.AreEqual(2, (int)v["copyChecksumRunsOk"]!);
        StringAssert.Contains(v["why"]!.ToString(), "stencil matched in 2 of 3");
        Assert.AreEqual("0x7d268008", ((JsonArray)v["stencilSeen"]!)[1]!.ToString());
        StringAssert.Contains(Digests.Of(r)!, "MISMATCH");
    }

    [TestMethod]
    public void ChecksumsAreComparedAsTextExactly()
    {
        var upper = KernelChecks.Evaluate(Result(Run("0x7D268009", "0x1e84aad9", 10, 2)));
        Assert.IsFalse((bool)upper["checksumsMatch"]!, "the worker writes lower-case; anything else is not the frozen value");
        var missing = KernelChecks.Evaluate(Result(new JsonObject { ["stencilMcellsPerS"] = 10 }));
        Assert.IsFalse((bool)missing["checksumsMatch"]!);
    }

    [TestMethod]
    public void NoRunsAndNonObjectsStillGetAVerdict()
    {
        Assert.IsFalse((bool)KernelChecks.Evaluate(new JsonObject())["checksumsMatch"]!);
        Assert.AreEqual("no run finished", KernelChecks.Evaluate(new JsonObject())["why"]!.ToString());
        var odd = KernelChecks.Annotate(JsonValue.Create("not an object"));
        Assert.IsFalse((bool)odd["verdict"]!["checksumsMatch"]!);
        Assert.IsNotNull(odd["raw"]);
    }

    [TestMethod]
    public void MedianOfAnEvenCountIsTheMeanOfTheMiddleTwoAndBadNumbersAreIgnored()
    {
        var runs = new[] { Run("a", "b", 10, 1), Run("a", "b", 20, 1), Run("a", "b", 0, 1), Run("a", "b", -3, 1) };
        var s = KernelChecks.Stats(runs, "stencilMcellsPerS")!.Value;
        Assert.AreEqual(15.0, s.Median);
        Assert.AreEqual(2, (int)s.Json["n"]!);
        Assert.IsNull(KernelChecks.Stats(new[] { new JsonObject() }, "stencilMcellsPerS"));
    }

    [TestMethod]
    public void TheConstantsAreTheOnesInTheAppsOwnSpeedTest()
    {
        string? test = RepoFiles.Src("src/ui/speedTest.test.ts"), app = RepoFiles.Src("src/ui/speedTest.ts");
        if (test == null || app == null) { Assert.Inconclusive("src/ui/speedTest.ts not found next to the prototype"); return; }
        string t = File.ReadAllText(test), a = File.ReadAllText(app);
        StringAssert.Contains(t, $"stencilAfter3: {FrozenKernels.StencilAfter3}");
        StringAssert.Contains(t, $"copyAfter2: {FrozenKernels.CopyAfter2}");
        StringAssert.Contains(t, $"version: {FrozenKernels.Version},");
        StringAssert.Contains(a, $"SPEED_TEST_VERSION = {FrozenKernels.Version};");
        var refMatch = Regex.Match(a, @"SPEED_TEST_REFERENCE = \{ stencilMcellsPerS: ([0-9.]+), copyGBps: ([0-9.]+) \}");
        Assert.IsTrue(refMatch.Success, "SPEED_TEST_REFERENCE not found");
        Assert.AreEqual(FrozenKernels.ReferenceStencilMcellsPerS, double.Parse(refMatch.Groups[1].Value, CultureInfo.InvariantCulture));
        Assert.AreEqual(FrozenKernels.ReferenceCopyGBps, double.Parse(refMatch.Groups[2].Value, CultureInfo.InvariantCulture));
        StringAssert.Contains(a, $"SPEED_TEST_REFERENCE_DATE = '{FrozenKernels.ReferenceDate}'");
    }

    [TestMethod]
    public void TheCommittedBundleWasBuiltFromTheCurrentKernelsSource()
    {
        string bundle = Path.Combine(RepoFiles.Wwwroot(), "speedtest.worker.js");
        Assert.IsTrue(File.Exists(bundle), "run harness/build-speedtest.sh");
        string? kernels = RepoFiles.Src("src/ui/speedTestKernels.ts");
        if (kernels == null) { Assert.Inconclusive("src/ui/speedTestKernels.ts not found next to the prototype"); return; }
        string sha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(kernels))).ToLowerInvariant();
        StringAssert.Contains(File.ReadAllText(bundle), sha, "speedtest.worker.js was built from a different speedTestKernels.ts: run prototypes/dotnet-b/harness/build-speedtest.sh");
    }
}

[TestClass]
public sealed class WebViewFactsMergeTests
{
    // what round0-arms.js returns on a phone whose WebView honours the isolation (shape from harness/check-round0-js.mjs)
    const string IsolatedPage = """
        {"schema":1,"failures":[],"page":{"origin":"https://0.0.0.1","protocol":"https:","isSecureContext":true,"headerSeenByPage":"isolate-and-require-corp"},
         "navigator":{"userAgent":"Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36","chromeVersion":"141.0.0.0","hardwareConcurrency":8},
         "features":{"crossOriginIsolated":true,"sharedArrayBuffer":"function","sharedArrayBufferConstructs":true,"webAssembly":"object","wasmSimd":true,"wasmThreads":true,
                     "wasmSharedMemoryModule":true,"wasmSharedMemoryConstructs":true,"wasmBulkMemory":true,"wasmRelaxedSimd":false,"atomics":"object","atomicsWaitAsync":"function"},
         "timer":{"minStepMs":0.005,"distinctSteps":3,"calls":200000,"spanMs":30},"webgpu":{"present":true,"adapter":{"vendor":"qualcomm"}},"workers":{"typeofWorker":"function"}}
        """;

    static readonly AllowlistFacts Applied = new() { LibraryPresent = true, FeatureSupported = true, Applied = true, Origin = "https://0.0.0.1" };

    static NativeWebFacts Native(AllowlistFacts? allowlist, bool header = true, bool ready = true)
        => new(allowlist, header, "isolate-and-require-corp", "https://0.0.0.1", "com.google.android.webview", "141.0.7390.1", ready);

    static NativeWebFacts Native() => Native(Applied);

    [TestMethod]
    public void IsolatedPageGivesSharedMemoryAndNoExplanation()
    {
        var m = WebViewFactsMerge.Merge(JsonNode.Parse(IsolatedPage), Native());
        var v = (JsonObject)m["verdict"]!;
        Assert.IsTrue((bool)v["sharedMemoryObtained"]!);
        Assert.IsTrue((bool)v["wasmSimd"]!);
        Assert.IsTrue((bool)v["wasmThreads"]!);
        Assert.IsTrue((bool)v["originIsExpected"]!);
        Assert.AreEqual(0, ((JsonArray)v["explanation"]!).Count);
        Assert.AreEqual("com.google.android.webview", m["native"]!["webViewPackage"]!.ToString());
        Assert.IsTrue((bool)m["native"]!["allowlist"]!["applied"]!);
        Assert.AreEqual("digest", m.First().Key);
        string digest = Digests.Of(m)!;
        foreach (var piece in new[] { "coi=yes", "sab=function", "shared=yes", "simd=yes", "threads=yes", "waitAsync=function", "webgpu=adapter", "chrome=141.0.0.0", "header=sent", "allowlist=set", "origin=https://0.0.0.1" })
            StringAssert.Contains(digest, piece);
    }

    static JsonNode NotIsolated(string? sab = "undefined")
    {
        var page = JsonNode.Parse(IsolatedPage)!;
        page["features"]!["crossOriginIsolated"] = false;
        page["features"]!["sharedArrayBuffer"] = sab;
        page["features"]!["sharedArrayBufferConstructs"] = false;
        return page;
    }

    [TestMethod]
    public void NotIsolatedWithTheFeatureUnsupportedSaysThatWebViewIsTooOld()
    {
        var native = Native(new AllowlistFacts { LibraryPresent = true, FeatureSupported = false });
        var m = WebViewFactsMerge.Merge(NotIsolated(), native);
        var why = ((JsonArray)m["verdict"]!["explanation"]!).Select(x => x!.ToString()).ToList();
        Assert.IsFalse((bool)m["verdict"]!["sharedMemoryObtained"]!);
        Assert.IsTrue(why.Any(l => l.Contains("did not isolate the page")), string.Join(" / ", why));
        Assert.IsTrue(why.Any(l => l.Contains("does not report") && l.Contains("CROSS_ORIGIN_ISOLATED_ALLOWLIST")), string.Join(" / ", why));
        StringAssert.Contains(Digests.Of(m)!, "allowlist=feature unsupported");
        StringAssert.Contains(Digests.Of(m)!, "shared=no");
    }

    [TestMethod]
    public void ReflectionFailureTextIsCarriedIntoTheExplanationAndTheDocument()
    {
        var native = Native(new AllowlistFacts { LibraryPresent = true, FeatureSupported = true, Applied = false, Error = "call threw: java.lang.NoSuchMethodError: setCrossOriginIsolatedAllowlist" });
        var m = WebViewFactsMerge.Merge(NotIsolated(), native);
        var why = string.Join(" / ", ((JsonArray)m["verdict"]!["explanation"]!).Select(x => x!.ToString()));
        StringAssert.Contains(why, "Setting the allowlist did not work: call threw: java.lang.NoSuchMethodError");
        StringAssert.Contains(m["native"]!["allowlist"]!["error"]!.ToString(), "NoSuchMethodError");
        StringAssert.Contains(Digests.Of(m)!, "allowlist=failed");
    }

    [TestMethod]
    public void ALibraryThatIsNotInTheApkAndAHeaderThatWasNeverSentAreSaid()
    {
        var m = WebViewFactsMerge.Merge(NotIsolated(), Native(new AllowlistFacts { LibraryPresent = false, Error = "androidx.webkit 1.18 classes not in the APK" }, header: false));
        var why = string.Join(" / ", ((JsonArray)m["verdict"]!["explanation"]!).Select(x => x!.ToString()));
        StringAssert.Contains(why, "did not answer the page with Document-Isolation-Policy");
        StringAssert.Contains(why, "androidx.webkit 1.18 is not in the app");
    }

    [TestMethod]
    public void AllowlistSetButNotIsolatedPointsAtTheOriginFormOrTheHeader()
    {
        var m = WebViewFactsMerge.Merge(NotIsolated(), Native());
        var why = string.Join(" / ", ((JsonArray)m["verdict"]!["explanation"]!).Select(x => x!.ToString()));
        StringAssert.Contains(why, "without an exception, yet the page is not isolated");
        StringAssert.Contains(why, "The page fetched itself and saw the header value: isolate-and-require-corp");
    }

    [TestMethod]
    public void APageThatNeverAnsweredStillGivesTheNativeSide()
    {
        var m = WebViewFactsMerge.Merge(null, Native(allowlist: null, header: false, ready: false));
        var v = (JsonObject)m["verdict"]!;
        Assert.IsFalse((bool)v["sharedMemoryObtained"]!);
        var why = ((JsonArray)v["explanation"]!).Select(x => x!.ToString()).ToList();
        StringAssert.Contains(why[0], "never told the app it was ready");
        Assert.IsTrue(why.Any(l => l.Contains("allowlist was not attempted")));
        Assert.IsFalse((bool)m["native"]!["pageReady"]!);
        Assert.IsNotNull(Digests.Of(m));
    }

    [TestMethod]
    public void AWrongOriginIsCalledOut()
    {
        var page = JsonNode.Parse(IsolatedPage)!;
        page["page"]!["origin"] = "https://appassets.androidplatform.net";
        var m = WebViewFactsMerge.Merge(page, Native());
        Assert.IsFalse((bool)m["verdict"]!["originIsExpected"]!);
        StringAssert.Contains(((JsonArray)m["verdict"]!["explanation"]!)[0]!.ToString(), "wrong origin string");
    }

    [TestMethod]
    public void AFeatureTestThatThrewIsUnknownNotNo()
    {
        var page = JsonNode.Parse(IsolatedPage)!;
        page["features"]!["wasmSimd"] = "error: CompileError: boom";
        var v = (JsonObject)WebViewFactsMerge.Merge(page, Native())["verdict"]!;
        Assert.IsNull(v["wasmSimd"]);
        StringAssert.Contains(Digests.Of(WebViewFactsMerge.Merge(page, Native()))!, "simd=?");
    }

    [TestMethod]
    public void TheMergedDocumentIsSchemaValidAndSmallInsideAResult()
    {
        var doc = TestDocs.Valid(arms: 0);
        doc.Arms.Add(new ArmRecord { Block = 0, Name = "webview-facts", Runtime = RuntimeNames.V8WebView, DurationMs = 4000, EstimatedSeconds = 6, Result = WebViewFactsMerge.Merge(JsonNode.Parse(IsolatedPage), Native()) });
        Assert.AreEqual(0, ResultValidator.Validate(doc).Count);
        Assert.IsTrue(ResultJsonContext.SerializeToUtf8(doc).Length < 8_000);
    }
}

[TestClass]
public sealed class Round0PlanTests
{
    static TestPlan Plan() => Round0Plan.Build(new FastFakeArm(), new SkippedArm("webview-facts", "v8-webview", "x"), new SkippedArm("speedtest-kernels", "v8-webview", "x"));

    [TestMethod]
    public void ThreeBlocksInOrderAndTheFirstScreenIsAConnectivityAndDeviceCheck()
    {
        var p = Plan();
        Assert.AreEqual(0, p.Round);
        Assert.AreEqual("link check", p.RoundName);
        CollectionAssert.AreEqual(new[] { "device check", "WebView check", "speed check" }, p.Blocks.Select(b => b.Name).ToArray());
        StringAssert.StartsWith(p.IntroText!, "This is a test build of FireSim. It is a connectivity and device check");
        StringAssert.Contains(p.IntroText!, "It does not change your FireSim app. It takes about 2 minutes. Keep this screen open.");
    }

    [TestMethod]
    public void RoundZeroGateWaitsAtMostTwentySecondsForTheThermalStatus()
        => Assert.AreEqual(TimeSpan.FromSeconds(20), Round0Plan.Options().Gate.ThermalMaxWait);

    [TestMethod]
    public void EveryFileTheHostServesExistsAndTheIndexLoadsTheRoundScriptBeforeTheHostScript()
    {
        foreach (var f in Round0Plan.WebFiles) Assert.IsTrue(File.Exists(Path.Combine(RepoFiles.Wwwroot(), f)), f + " is missing from wwwroot");
        string index = File.ReadAllText(Path.Combine(RepoFiles.Wwwroot(), "index.html"));
        int r0 = index.IndexOf("round0-arms.js", StringComparison.Ordinal), host = index.IndexOf("arm-host.js", StringComparison.Ordinal);
        Assert.IsTrue(r0 > 0 && host > r0, "round0-arms.js must load before arm-host.js (which keeps what it registered)");
        string pageScript = File.ReadAllText(Path.Combine(RepoFiles.Wwwroot(), "round0-arms.js"));
        StringAssert.Contains(pageScript, "'webview-facts'");
        StringAssert.Contains(pageScript, "'speedtest-kernels'");
        StringAssert.Contains(pageScript, "speedtest.worker.js");
        Assert.AreEqual(Round0Plan.WebViewFactsName, "webview-facts");
        Assert.AreEqual(Round0Plan.KernelsName, "speedtest-kernels");
    }

    [TestMethod]
    public void StandardFirstScreenTextIsUnchangedForOtherRounds()
    {
        var plan = new TestPlan(1, "speed", Plan().Blocks);
        Assert.IsNull(plan.IntroText);
        StringAssert.Contains(ScreenText.First(3), "It measures this phone and sends the numbers to the developer.");
    }

    [TestMethod]
    public void SkippedArmSaysSoAndIsOk()
    {
        var r = (JsonObject)new SkippedArm("a", "v8-webview", "no WebView").RunAsync(new Progress<ArmProgress>(), CancellationToken.None).Result;
        Assert.IsTrue((bool)r["skipped"]!);
        Assert.AreEqual("no WebView", r["reason"]!.ToString());
    }
}

[TestClass]
public sealed class RunSummaryTests
{
    static ResultDocument Doc(params ArmRecord[] arms)
    {
        var d = TestDocs.Valid(arms: 0);
        d.Arms.AddRange(arms);
        return d;
    }

    static ArmRecord Arm(string name, string status = ArmStatus.Ok, JsonNode? result = null, string? error = null)
        => new() { Name = name, Status = status, Result = result, Error = error, Runtime = "coreclr", EstimatedSeconds = 1 };

    [TestMethod]
    public void OneLinePerArmWithItsOutcome()
    {
        var lines = RunSummary.Lines(Doc(
            Arm("device-facts", result: new JsonObject()),
            Arm("webview-facts", ArmStatus.Error, error: "InvalidOperationException: the WebView page did not report ready"),
            Arm("speedtest-kernels", result: new JsonObject { ["skipped"] = true, ["reason"] = "no WebView in the container" })));
        Assert.AreEqual("device-facts: ok", lines[0]);
        StringAssert.StartsWith(lines[1], "webview-facts: FAILED: InvalidOperationException: the WebView page did not report ready");
        Assert.AreEqual("speedtest-kernels: skipped (no WebView in the container)", lines[2]);
    }

    [TestMethod]
    public void KernelAndWebViewLinesCarryTheVerdicts()
    {
        var kernels = KernelChecks.Annotate(new JsonObject { ["runs"] = new JsonArray(Enumerable.Range(0, 3).Select(i => (JsonNode)new JsonObject
        {
            ["stencilAfter3"] = "0x7d268009", ["copyAfter2"] = "0x1e84aad9", ["stencilMcellsPerS"] = 10.0 + i, ["copyGBps"] = 2.0,
        }).ToArray()) });
        var web = WebViewFactsMerge.Merge(JsonNode.Parse("""{"features":{"crossOriginIsolated":false,"sharedArrayBuffer":"undefined","wasmSimd":true,"wasmThreads":false}}"""),
            new NativeWebFacts(null, true, "isolate-and-require-corp", "https://0.0.0.1", null, null, true));
        var lines = RunSummary.Lines(Doc(Arm("webview-facts", result: web), Arm("speedtest-kernels", result: kernels)));
        Assert.AreEqual("webview-facts: ok (shared memory: no; WebAssembly SIMD: yes; threads: no)", lines[0]);
        Assert.AreEqual("speedtest-kernels: ok (both checksums match; stencil 11 Mcells/s, copy 2 GB/s)", lines[1]);
    }

    [TestMethod]
    public void AMismatchIsShoutedAndAWebPageErrorIsShown()
    {
        var bad = KernelChecks.Annotate(new JsonObject { ["runs"] = new JsonArray((JsonNode)new JsonObject { ["stencilAfter3"] = "0x1", ["copyAfter2"] = "0x1e84aad9" }) });
        var web = WebViewFactsMerge.Merge(null, new NativeWebFacts(null, false, null, "https://0.0.0.1", null, null, false));
        web["pageError"] = "TimeoutException: page did not answer";
        var lines = RunSummary.Lines(Doc(Arm("speedtest-kernels", result: bad), Arm("webview-facts", result: web)));
        StringAssert.Contains(lines[0], "CHECKSUMS DO NOT MATCH");
        StringAssert.Contains(lines[1], "the page did not answer: TimeoutException");
    }

    [TestMethod]
    public void StatusAndErrorCountAreReported()
    {
        var d = Doc(Arm("device-facts", result: new JsonObject()));
        d.Status = RunStatus.Partial;
        d.Errors.Add(new ErrorRecord { Where = "webview", Message = "the HybridWebView page did not report ready within 20 s" });
        var lines = RunSummary.Lines(d);
        Assert.AreEqual("The run ended as 'partial'.", lines[1]);
        StringAssert.Contains(lines[2], "1 problem recorded in the results (first: webview: the HybridWebView page did not report ready");
    }
}

[TestClass]
public sealed class Round0FallbackTests
{
    [TestMethod]
    public void TheOneTapFallbackCarriesTheDigestsOfTheThreeArms()
    {
        var doc = TestDocs.Valid(arms: 0);
        doc.RoundName = "link check";
        var device = DeviceFactsDocument.Build(new FakeDeviceProbe(), new DeviceSnapshot { BatteryPercent = 80 }, InMemorySysfs.ThreeClusterPhone(), 8);
        var web = WebViewFactsMerge.Merge(null, new NativeWebFacts(null, true, "isolate-and-require-corp", "https://0.0.0.1", null, null, true));
        var kernels = KernelChecks.Annotate(new JsonObject { ["runs"] = new JsonArray((JsonNode)new JsonObject { ["stencilAfter3"] = "0x7d268009", ["copyAfter2"] = "0x1e84aad9", ["stencilMcellsPerS"] = 9.5, ["copyGBps"] = 1.9 }) });
        foreach (var (name, r) in new[] { ("device-facts", device), ("webview-facts", web), ("speedtest-kernels", kernels) })
            doc.Arms.Add(new ArmRecord { Block = 0, Name = name, Runtime = "v8-webview", DurationMs = 100, EstimatedSeconds = 1, Result = r });

        var url = GitHubIssueUrl.Build("example/results", doc);
        string text = Uri.UnescapeDataString(url.Url);
        Assert.IsTrue(url.Url.Length <= GitHubIssueUrl.DefaultMaxChars, $"{url.Url.Length} characters");
        Assert.IsTrue(url.Level <= 1, "the arms' lines are in the summary at level " + url.Level);
        StringAssert.Contains(text, "checksums MATCH in 1 runs");
        StringAssert.Contains(text, "Simulated Dry Run 1");
        StringAssert.Contains(text, "coi=?");
        StringAssert.Contains(text, "kHz 1800000x4/2400000x3/2800000x1");
    }

    [TestMethod]
    public void AnArmWithoutADigestIsPrintedAsBefore()
    {
        var doc = TestDocs.Valid(arms: 1);
        string s = GitHubIssueUrl.Summary(doc, 0);
        StringAssert.Contains(s, "\"checksum\":1234567");
    }
}
