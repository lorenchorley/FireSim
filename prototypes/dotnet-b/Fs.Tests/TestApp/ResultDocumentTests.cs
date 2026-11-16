using System.Text.Json.Nodes;
using FsTestApp.Results;
using FsTestApp.Runner;
using FsTestApp.Device;
using FsTestApp;
using FsTestApp.Session;
using FsTestApp.Storage;

namespace Fs.Tests.TestApp;

[TestClass]
public sealed class IdempotencyTests
{
    [TestMethod]
    public void KeyIsApkShaColonRunIdAndStableAcrossSerializationAndTime()
    {
        var d = TestDocs.Valid();
        string key = d.IdempotencyKey;
        Assert.AreEqual(TestDocs.Sha + ":" + TestDocs.RunId, key);
        // saving, loading, re-serializing and waiting do not change it
        var back = ResultJsonContext.Deserialize(ResultJsonContext.Serialize(d))!;
        Assert.AreEqual(key, back.IdempotencyKey);
        Assert.AreEqual(key, ResultDocument.MakeIdempotencyKey(back.Build.ApkSha256, back.RunId));
        back.FinishedUtc = DateTimeOffset.UtcNow.AddHours(3);
        back.Arms.Clear();
        Assert.AreEqual(key, ResultDocument.MakeIdempotencyKey(back.Build.ApkSha256, back.RunId), "the key depends on the apk and the run only, not on the content");
    }

    [TestMethod]
    public void KeyDiffersForAnotherRunOrAnotherApk()
    {
        string a = ResultDocument.MakeIdempotencyKey(new string('a', 64), TestDocs.RunId);
        Assert.AreNotEqual(a, ResultDocument.MakeIdempotencyKey(new string('a', 64), ResultDocument.NewRunId()));
        Assert.AreNotEqual(a, ResultDocument.MakeIdempotencyKey(new string('c', 64), TestDocs.RunId));
        Assert.AreNotEqual(ResultDocument.NewRunId(), ResultDocument.NewRunId());
        Assert.AreEqual(32, ResultDocument.NewRunId().Length);
    }

    [TestMethod]
    public void KeyOfAnUnreadableApkStillValidates()
    {
        var d = TestDocs.Valid();
        d.Build.ApkSha256 = ResultDocument.ApkShaUnavailable;
        d.IdempotencyKey = ResultDocument.MakeIdempotencyKey(d.Build.ApkSha256, d.RunId);
        Assert.AreEqual(0, ResultValidator.Validate(d).Count);
    }

    [TestMethod]
    public void SessionPutsTheSameKeyInTheSavedDocumentAndEverySend()
    {
        // the integration of this is in the dry run (scenario b); here only the document side
        var d = TestDocs.Valid();
        var store = new FileResultStore(Path.Combine(Path.GetTempPath(), "fs-idem-" + Guid.NewGuid().ToString("N")));
        try
        {
            store.SaveDocument(d.RunId, ResultJsonContext.Serialize(d));
            var saved = ResultJsonContext.Deserialize(store.LoadDocumentJson(d.RunId)!)!;
            Assert.AreEqual(d.IdempotencyKey, saved.IdempotencyKey);
        }
        finally { Directory.Delete(store.DirectoryPath, true); }
    }
}

[TestClass]
public sealed class StoreTests
{
    static string TempDir() => Path.Combine(Path.GetTempPath(), "fs-store-" + Guid.NewGuid().ToString("N"));

    [TestMethod]
    public void SaveThenLoadRoundTripsAndLeavesNoTempFile()
    {
        var dir = TempDir();
        try
        {
            var store = new FileResultStore(dir);
            var d = TestDocs.Valid();
            string json = ResultJsonContext.Serialize(d);
            string path = store.SaveDocument(d.RunId, json);
            Assert.AreEqual(json, store.LoadDocumentJson(d.RunId));
            Assert.IsTrue(File.Exists(path));
            Assert.AreEqual(0, Directory.GetFiles(dir, "*.tmp").Length);
            store.SaveDocument(d.RunId, json);   // overwrite is fine
            Assert.AreEqual(d.RunId, store.FindLatestRunId());
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public void StateSurvivesReload()
    {
        var dir = TempDir();
        try
        {
            var d = TestDocs.Valid();
            var store = new FileResultStore(dir);
            var st = store.LoadState(d.RunId);
            st.Receipt = new Receipt { Text = "issue 17", Issue = 17, AtUtc = DateTimeOffset.UtcNow };
            st.Uninstall = new UninstallAttempt { AtUtc = DateTimeOffset.UtcNow, Outcome = "app-info-opened" };
            store.SaveState(st);
            var again = new FileResultStore(dir).LoadState(d.RunId);
            Assert.AreEqual("issue 17", again.Receipt!.Text);
            Assert.AreEqual("app-info-opened", again.Uninstall!.Outcome);
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public void DamagedStateFileDoesNotStopTheApp()
    {
        var dir = TempDir();
        try
        {
            var store = new FileResultStore(dir);
            File.WriteAllText(Path.Combine(dir, "state-" + TestDocs.RunId + ".json"), "{ not json");
            var st = store.LoadState(TestDocs.RunId);
            Assert.AreEqual(TestDocs.RunId, st.RunId);
            Assert.IsNull(st.Receipt);
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    [DataRow("../evil")]
    [DataRow("a/b")]
    [DataRow("")]
    [DataRow("x y")]
    public void RunIdIsNeverUsedAsAPath(string bad)
    {
        var dir = TempDir();
        try { Assert.Throws<ArgumentException>(() => new FileResultStore(dir).DocumentPath(bad)); }
        finally { Directory.Delete(dir, true); }
    }
}

[TestClass]
public sealed class ResultSchemaTests
{
    static string RepoReports()
    {
        string? dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "FsProto.slnx"))) dir = Path.GetDirectoryName(dir);
        Assert.IsNotNull(dir, "FsProto.slnx not found above the test binaries");
        return Path.Combine(dir, "reports");
    }

    [TestMethod]
    public void ValidDocumentPassesAndSchemaIsTheCommittedFile()
    {
        var errors = ResultValidator.Validate(TestDocs.Valid());
        Assert.AreEqual(0, errors.Count, string.Join("; ", errors));
        Assert.AreEqual(File.ReadAllText(Path.Combine(RepoReports(), "results.schema.json")), ResultSchema.ReadEmbedded(), "the embedded schema is reports/results.schema.json");
    }

    [TestMethod]
    public void DocumentWithEveryOptionalPartPasses()
    {
        var d = TestDocs.Valid();
        d.WebView = new WebViewFacts
        {
            PageReported = true, Origin = "https://0.0.0.1", CrossOriginIsolated = false, SharedArrayBuffer = "undefined", UserAgent = "UA", IsolationHeaderSent = true,
            IsolationHeaderValue = "isolate-and-require-corp", Allowlist = new AllowlistFacts { LibraryPresent = true, FeatureSupported = false, Applied = false, Origin = "https://0.0.0.1", Error = "x" },
            Extra = new JsonObject { ["wasmSimd"] = true },
        };
        d.Device.CpuCores = new() { new CpuCore { Cpu = 0, MaxKhz = 1_800_000, MinKhz = 300_000 }, new CpuCore { Cpu = 7, MaxKhz = 3_000_000 } };
        d.Device.Abis = new() { "arm64-v8a" };
        d.Device.WebViewVersion = new WebViewVersion { Package = "com.google.android.webview", Version = "140.0.0.0" };
        d.Logs.Pauses.Add(new PauseEvent { TMs = 5, Kind = "native-pause", Block = 0, Arm = "arm-0" });
        d.Logs.Gating.Add(new GateEvent { TMs = 1, Block = 0, Outcome = "ReadyThermalTimeout", WaitedMs = 300000, Reason = "r" });
        d.Errors.Add(new ErrorRecord { TMs = 3, Where = "arm x", Type = "System.Exception", Message = "m", Stack = "s" });
        d.Arms[0].Status = ArmStatus.Error; d.Arms[0].Error = "boom"; d.Arms[0].Result = null;
        var errors = ResultValidator.Validate(d);
        Assert.AreEqual(0, errors.Count, string.Join("; ", errors));
    }

    [TestMethod]
    public void ThermalHeadroomNaNIsLoggedAsAbsentAndStillValidates()
    {
        var d = TestDocs.Valid(samples: 0);
        var log = new RunLog(d, new ManualClock());
        log.AddSample(new DeviceSnapshot { Thermal = ThermalStatus.Light, ThermalHeadroom = double.NaN, BatteryPercent = 70 });
        log.AddSample(new DeviceSnapshot { Thermal = ThermalStatus.Light, ThermalHeadroom = double.PositiveInfinity });
        log.AddSample(new DeviceSnapshot { Thermal = ThermalStatus.None, ThermalHeadroom = 0.8 });
        Assert.IsNull(d.Logs.Thermal[0].Headroom);
        Assert.IsNull(d.Logs.Thermal[1].Headroom);
        Assert.AreEqual(0.8, d.Logs.Thermal[2].Headroom);
        string json = ResultJsonContext.Serialize(d);
        Assert.IsFalse(json.Contains("NaN") || json.Contains("Infinity"));
        Assert.AreEqual(0, ResultValidator.Validate(json).Count);
    }

    static IReadOnlyList<SchemaError> Mutate(Action<JsonObject> change)
    {
        var node = JsonNode.Parse(ResultJsonContext.Serialize(TestDocs.Valid()))!.AsObject();
        change(node);
        return ResultSchema.Default.Validate(node);
    }

    [TestMethod]
    public void MissingRequiredPropertiesAreReported()
    {
        foreach (var name in new[] { "runId", "idempotencyKey", "build", "device", "arms", "logs", "status", "startedUtc" })
            Assert.IsTrue(Mutate(n => n.Remove(name)).Any(e => e.Message.Contains($"'{name}'")), name);
    }

    [TestMethod]
    public void WrongTypesValuesAndExtraPropertiesAreReported()
    {
        Assert.IsTrue(Mutate(n => n["round"] = "zero").Any(e => e.Path == "/round"));
        Assert.IsTrue(Mutate(n => n["round"] = 1.5).Any(e => e.Path == "/round"), "not an integer");
        Assert.IsTrue(Mutate(n => n["round"] = -1).Any(e => e.Path == "/round"), "below minimum");
        Assert.IsTrue(Mutate(n => n["status"] = "done").Any(e => e.Path == "/status"), "not in enum");
        Assert.IsTrue(Mutate(n => n["kind"] = "other").Any(e => e.Path == "/kind"));
        Assert.IsTrue(Mutate(n => n["schemaVersion"] = 2).Any(e => e.Path == "/schemaVersion"));
        Assert.IsTrue(Mutate(n => n["runId"] = "XYZ").Any(e => e.Path == "/runId"), "pattern");
        Assert.IsTrue(Mutate(n => n["idempotencyKey"] = "abc").Any(e => e.Path == "/idempotencyKey"));
        Assert.IsTrue(Mutate(n => n["startedUtc"] = "yesterday").Any(e => e.Path == "/startedUtc"), "date-time");
        Assert.IsTrue(Mutate(n => n["token"] = "ghp_x").Any(e => e.Path == "/token" && e.Message.Contains("not allowed")), "unknown top-level property");
        Assert.IsTrue(Mutate(n => n["build"]!["apkSha256"] = "123").Any(e => e.Path == "/build/apkSha256"));
        Assert.IsTrue(Mutate(n => n["arms"]![0]!["runtime"] = "jvm").Any(e => e.Path == "/arms/0/runtime"), "runtime enum from plan rule 11");
        Assert.IsTrue(Mutate(n => n["arms"]![0]!["name"] = "Has Space").Any(e => e.Path == "/arms/0/name"));
        Assert.IsTrue(Mutate(n => n["logs"]!["thermal"]![0]!["status"] = "toasty").Any(e => e.Path == "/logs/thermal/0/status"));
        Assert.IsTrue(Mutate(n => n["logs"]!["battery"]![0]!["percent"] = 140).Any(e => e.Path == "/logs/battery/0/percent"));
        Assert.IsTrue(Mutate(n => n["errors"] = "none").Any(e => e.Path == "/errors"));
    }

    [TestMethod]
    public void SizeLimitsInTheSchemaAreEnforced()
    {
        Assert.IsTrue(Mutate(n => n["errors"] = new JsonArray(Enumerable.Range(0, 201).Select(i => (JsonNode)new JsonObject { ["tMs"] = 0, ["where"] = "w", ["message"] = "m" }).ToArray())).Any(e => e.Path == "/errors"));
        Assert.IsTrue(Mutate(n => n["roundName"] = new string('x', 65)).Any(e => e.Path == "/roundName"));
    }

    [TestMethod]
    public void NotJsonIsAnError()
    {
        var e = ResultValidator.Validate("{ nope");
        Assert.AreEqual(1, e.Count);
        StringAssert.Contains(e[0].Message, "not valid JSON");
    }

    [TestMethod]
    public void SchemaKeywordsTheValidatorDoesNotImplementAreRefusedNotIgnored()
    {
        Assert.Throws<NotSupportedException>(() => new ResultSchema("""{ "type": "object", "oneOf": [ { "type": "string" } ] }"""));
        Assert.Throws<NotSupportedException>(() => new ResultSchema("""{ "properties": { "a": { "patternProperties": {} } } }"""));
    }

    [TestMethod]
    public void TypeArraysAndAdditionalPropertiesSchemasWork()
    {
        var s = new ResultSchema("""{ "type": "object", "properties": { "n": { "type": ["integer", "null"] } }, "additionalProperties": { "type": "string" } }""");
        Assert.AreEqual(0, s.Validate("""{ "n": null, "x": "y" }""").Count);
        Assert.AreEqual(1, s.Validate("""{ "n": 1, "x": 2 }""").Count);
        Assert.AreEqual(1, s.Validate("""{ "n": "a" }""").Count);
    }

    [TestMethod]
    public void ExistingContainerResultFilesStillValidateAgainstTheExtendedSchema()
    {
        foreach (var file in new[] { "1-kernel-results.json", "3a-results.json" })
        {
            var errors = ResultValidator.ValidateContainerResults(File.ReadAllText(Path.Combine(RepoReports(), file)));
            Assert.AreEqual(0, errors.Count, file + ": " + string.Join("; ", errors.Take(5)));
        }
    }

    [TestMethod]
    public void ContainerResultsAcceptRuntimeAndBuildAndRejectAnUnknownRuntime()
    {
        string ok = """
        { "stage": "1", "when": "2026-11-16T00:00:00Z", "machine": { "label": "container", "cores": 4 }, "indicative": true,
          "build": { "configuration": "Release", "commit": "abc", "apkSha256": "unavailable" },
          "runs": [ { "name": "x", "runtime": "mono-wasm-aot", "n": 5, "medianMs": 1.5 } ] }
        """;
        Assert.AreEqual(0, ResultValidator.ValidateContainerResults(ok).Count);
        Assert.AreEqual(1, ResultValidator.ValidateContainerResults(ok.Replace("mono-wasm-aot", "dotnet")).Count);
    }
}
