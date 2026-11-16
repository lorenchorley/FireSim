using System.Text.Json.Nodes;
using FsTestApp.Arms;
using FsTestApp.Device;
using FsTestApp.Results;
using FsTestApp.Runner;
using FsTestApp.Sending;
using FsTestApp.Session;
using FsTestApp.Storage;

namespace FsTestApp.DryRun;

public sealed record ScenarioResult(string Name, bool Passed, IReadOnlyList<string> Checks, string? DocumentPath, string? Document = null);

/// <summary>Drives the real session, runner, gate, store, sender and retry code with a simulated phone and an in-process endpoint. Every scenario is a
/// complete app launch. Timings are short (milliseconds) and real: the clock is the system clock, so the pause and network scenarios exercise real concurrency.</summary>
public static class DryRunScenarios
{
    public const string UploadCode = "dryrun-upload-code";
    public static readonly string FakeApkSha = new string('a', 64);

    sealed class FakeEnv : IRunEnvironment
    {
        public BuildInfo GetBuildInfo() => new() { Configuration = "Release", Commit = "dryrun", ApkSha256 = FakeApkSha, ApplicationId = "au.firesim.proto.r0", AppVersion = "0.1.0-test.r0+dryrun", TargetFramework = "net11.0" };
        public DeviceFacts GetDeviceFacts() => new()
        {
            Manufacturer = "Simulated", Model = "Dry Run 1", Soc = "none", ApiLevel = 36, AndroidRelease = "16", Abis = new() { "arm64-v8a" }, Cores = Environment.ProcessorCount,
            CpuCores = new() { new CpuCore { Cpu = 0, MaxKhz = 2_000_000 } }, RamMb = 8192, WebViewVersion = new WebViewVersion { Package = "none", Version = "0" },
            Dotnet = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, ProcessArch = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
        };
    }

    sealed class FakePlatform : IPlatformActions
    {
        public List<string> Calls { get; } = new();
        public Task<bool> OpenUrlAsync(string url) { Calls.Add("open " + url.Length); return Task.FromResult(true); }
        public Task<string?> ShareFileAsync(string documentPath, string title) { Calls.Add("share " + Path.GetFileName(documentPath)); return Task.FromResult<string?>(null); }
        public UninstallOutcome OpenUninstall(string applicationId) { Calls.Add("uninstall " + applicationId); return new UninstallOutcome("uninstall-screen-opened", null); }
    }

    /// <summary>A fake arm that heats the simulated phone: the thermal status goes to Moderate when it ends and back to None a little later, so the
    /// next block's gate has something to wait for.</summary>
    sealed class HeatingArm(SimulatedDeviceState device, TimeSpan coolAfter) : IArm
    {
        public string Name => "stub-heat";
        public double EstimatedSeconds => 0.1;
        public async Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
        {
            await Task.Delay(20, ct).ConfigureAwait(false);
            device.Set(s => s with { Thermal = ThermalStatus.Moderate, ThermalHeadroom = 0.95 });
            _ = Task.Run(async () => { await Task.Delay(coolAfter).ConfigureAwait(false); device.Set(s => s with { Thermal = ThermalStatus.None, ThermalHeadroom = 0.5 }); });
            return new JsonObject { ["heated"] = true };
        }
    }

    sealed class Rig : IDisposable
    {
        public SimulatedDeviceState Device = new();
        public FileResultStore Store;
        public LocalEndpoint Endpoint;
        public FakePlatform Platform = new();
        public HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = false });
        public SessionOptions Options;
        public ResultsConfig Config;
        public List<SessionSnapshot> Snapshots = new();
        public string Dir;

        public TimeSpan ClientTimeout = TimeSpan.FromSeconds(5);

        public Rig(string dir, string? uploadCodeForClient = null, bool withEndpoint = true, string githubRepo = "example/results")
        {
            Dir = dir;
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);   // a leftover finished run would be resumed instead of run again
            Directory.CreateDirectory(dir);
            Store = new FileResultStore(Path.Combine(dir, "store"));
            Endpoint = new LocalEndpoint(UploadCode);
            Config = withEndpoint ? new ResultsConfig(Endpoint.Url, uploadCodeForClient ?? UploadCode, githubRepo) : new ResultsConfig("", "", githubRepo);
            Options = new SessionOptions
            {
                CountdownSeconds = 2, CountdownStep = TimeSpan.FromMilliseconds(20), SampleInterval = TimeSpan.FromMilliseconds(40),
                Gate = new GateOptions { PollInterval = TimeSpan.FromMilliseconds(20), ThermalMaxWait = TimeSpan.FromMilliseconds(600), BatteryMaxWait = TimeSpan.FromMilliseconds(150) },
                Backoff = new BackoffPolicy { Initial = TimeSpan.FromMilliseconds(30), Max = TimeSpan.FromMilliseconds(200), MaxFailures = 6, Jitter = () => 0.5 },
            };
        }

        public IReadOnlyList<Block> Blocks(params IArm[] extra)
        {
            var fast = new FastFakeArm();
            var slow = new SlowFakeArm(SystemClock.Instance, steps: 10, stepDelay: TimeSpan.FromMilliseconds(30));
            var blocks = new List<Block>(BlockPlan.AbBa(fast, slow));
            if (extra.Length > 0) blocks.Insert(0, new Block("extra", extra));
            return blocks;
        }

        public TestSession NewSession(IReadOnlyList<Block> blocks)
        {
            var sender = new HttpResultsSender(Config, Http, ClientTimeout);
            var s = new TestSession(new TestPlan(0, "dry run", blocks), Device, new FakeEnv(), Store, sender, Config, SystemClock.Instance, Options);
            s.Changed += snap => { lock (Snapshots) Snapshots.Add(snap); };
            return s;
        }

        public void Dispose() { Endpoint.Dispose(); Http.Dispose(); }
    }

    static async Task<bool> WaitFor(Func<bool> cond, int timeoutMs = 10_000)
    {
        var until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < until) { if (cond()) return true; await Task.Delay(10).ConfigureAwait(false); }
        return cond();
    }

    static void Check(List<string> checks, ref bool ok, bool cond, string what)
    {
        checks.Add((cond ? "ok   " : "FAIL ") + what);
        if (!cond) ok = false;
    }

    static ResultDocument LoadSaved(Rig rig, TestSession s) => ResultJsonContext.Deserialize(rig.Store.LoadDocumentJson(s.RunId!)!)!;

    public static async Task<List<ScenarioResult>> RunAllAsync(string outDir, string? only = null)
    {
        Directory.CreateDirectory(outDir);
        var all = new List<ScenarioResult>();
        foreach (var (name, fn) in new (string, Func<string, Task<ScenarioResult>>)[]
        {
            ("a-happy-path", HappyPath), ("b-lost-answer", LostAnswer), ("c-offline-then-online", OfflineThenOnline), ("d-pause-reruns-block", PauseRerunsBlock),
            ("e-server-errors-then-ok", ServerErrors), ("f-rejected-then-fallbacks", RejectedThenFallbacks), ("g-low-battery-aborts", LowBattery),
            ("h-no-endpoint", NoEndpoint), ("i-relaunch-resumes", RelaunchResumes), ("j-not-now", NotNowThenStart),
        })
        {
            if (only != null && !name.StartsWith(only, StringComparison.Ordinal)) continue;
            try { all.Add(await fn(Path.Combine(outDir, name)).ConfigureAwait(false)); }
            catch (Exception e) { all.Add(new ScenarioResult(name, false, new[] { "FAIL exception: " + e }, null)); }
        }
        return all;
    }

    // A: everything works; heat from the first block makes the second block's gate wait.
    public static async Task<ScenarioResult> HappyPath(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        var blocks = new List<Block>(rig.Blocks());
        blocks.Insert(1, new Block("heat", new IArm[] { new HeatingArm(rig.Device, TimeSpan.FromMilliseconds(250)) }));
        var s = rig.NewSession(blocks);
        await s.RunAsync(CancellationToken.None);
        var snap = s.Snapshot;
        var saved = LoadSaved(rig, s);
        var errors = ResultValidator.Validate(rig.Store.LoadDocumentJson(s.RunId!)!);

        Check(checks, ref ok, snap.Phase == SessionPhase.Done, "ended on the Done screen");
        Check(checks, ref ok, snap.Receipt?.Text == "issue 17", $"receipt is 'issue 17' (was '{snap.Receipt?.Text}')");
        Check(checks, ref ok, snap.DoneLine is { } l && l.StartsWith("Done. Results sent at ") && l.EndsWith("(receipt: issue 17). You can uninstall this test app now."), "done line follows the plan's text: " + snap.DoneLine);
        Check(checks, ref ok, errors.Count == 0, "saved document is schema-valid" + (errors.Count > 0 ? ": " + errors[0] : ""));
        Check(checks, ref ok, saved.Status == RunStatus.Complete, "run status complete");
        Check(checks, ref ok, saved.Blocks.Count == 3 && saved.Blocks.All(b => b.Status == BlockStatus.Ok), "3 blocks, all ok");
        Check(checks, ref ok, saved.Arms.Count == 5 && saved.Arms.All(a => a.Status == ArmStatus.Ok), "5 arms, all ok");
        Check(checks, ref ok, saved.Logs.Thermal.Count >= 3, $"thermal samples logged ({saved.Logs.Thermal.Count})");
        Check(checks, ref ok, saved.Logs.Gating.Count == 3, "one gate event per block");
        Check(checks, ref ok, saved.Logs.Gating.Any(g => g.Block == 2 && g.WaitedMs > 50), "the block after the hot one waited for the phone to cool (gate waited " + saved.Logs.Gating.FirstOrDefault(g => g.Block == 2)?.WaitedMs + " ms)");
        Check(checks, ref ok, saved.IdempotencyKey == FakeApkSha + ":" + saved.RunId, "idempotency key = apk sha + ':' + run id");
        Check(checks, ref ok, rig.Endpoint.Stored.Count == 1 && rig.Endpoint.Stored.ContainsKey(saved.IdempotencyKey), "endpoint holds exactly one result under that key");
        Check(checks, ref ok, ResultJsonContext.Deserialize(rig.Endpoint.Stored.Values.First().Body)!.RunId == saved.RunId, "what the endpoint stored is this run's document");
        Check(checks, ref ok, rig.Store.LoadState(s.RunId!).Receipt?.Issue == 17, "receipt saved beside the document");
        return new ScenarioResult("a-happy-path", ok, checks, rig.Store.DocumentPath(s.RunId!), rig.Store.LoadDocumentJson(s.RunId!));
    }

    // B: the endpoint stores the result and drops the answer. The retry carries the same key and must not make a second result.
    public static async Task<ScenarioResult> LostAnswer(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        rig.ClientTimeout = TimeSpan.FromMilliseconds(400);
        rig.Endpoint.Script = n => n == 1 ? EndpointBehavior.StoreThenDrop : EndpointBehavior.Accept;
        var s = rig.NewSession(rig.Blocks());
        await s.RunAsync(CancellationToken.None);
        var state = rig.Store.LoadState(s.RunId!);
        Check(checks, ref ok, s.Snapshot.Phase == SessionPhase.Done && s.Snapshot.Receipt != null, "delivered after the lost answer");
        Check(checks, ref ok, rig.Endpoint.Requests == 2, $"two requests reached the endpoint ({rig.Endpoint.Requests}; log: {string.Join(" | ", rig.Endpoint.Log)}; attempts: {string.Join(",", state.Attempts.Select(a => a.Outcome + ":" + a.HttpStatus + ":" + a.Detail))})");
        Check(checks, ref ok, rig.Endpoint.Stored.Count == 1, $"exactly one stored result ({rig.Endpoint.Stored.Count})");
        Check(checks, ref ok, state.Attempts.Count == 2 && state.Attempts[0].Outcome == "Retry" && state.Attempts[0].HttpStatus == null && state.Attempts[1].Outcome == "Sent", "attempts recorded: Retry (timeout, no status) then Sent");
        Check(checks, ref ok, state.Receipt?.Duplicate == true && state.Receipt.Issue == 17, "second answer was 'duplicate' with the original issue number");
        return new ScenarioResult("b-lost-answer", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // C: no network at the end of the run: the screen says so, nothing is sent, and it sends when the network returns.
    public static async Task<ScenarioResult> OfflineThenOnline(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        rig.Device.SetNetwork(false);
        var s = rig.NewSession(rig.Blocks());
        var run = s.RunAsync(CancellationToken.None);
        bool waiting = await WaitFor(() => s.Snapshot.WaitingForNetwork);
        Check(checks, ref ok, waiting, "screen waits for the network");
        Check(checks, ref ok, s.Snapshot.Message == ScreenText.NoNetwork, "message is the plan's text: " + s.Snapshot.Message);
        Check(checks, ref ok, rig.Endpoint.Requests == 0 && s.RunId != null && rig.Store.LoadDocumentJson(s.RunId) != null, "document is saved, nothing sent yet");
        rig.Device.SetNetwork(true);
        await run.WaitAsync(TimeSpan.FromSeconds(10));
        Check(checks, ref ok, s.Snapshot.Receipt != null && rig.Endpoint.Requests == 1, "sent once the network came back");
        return new ScenarioResult("c-offline-then-online", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // D: the app goes to the background in the middle of a block: the block is thrown away and re-run.
    public static async Task<ScenarioResult> PauseRerunsBlock(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        var s = rig.NewSession(rig.Blocks());
        var run = s.RunAsync(CancellationToken.None);
        bool slowStarted = await WaitFor(() => s.Snapshot.Runner is { ArmName: "stub-slow" });
        await Task.Delay(80);
        rig.Device.GoBackground();
        await Task.Delay(150);
        rig.Device.ComeForeground();
        await run.WaitAsync(TimeSpan.FromSeconds(15));
        var d = LoadSaved(rig, s);
        Check(checks, ref ok, slowStarted, "slow arm started before the pause");
        Check(checks, ref ok, d.Blocks.Any(b => b.Status == BlockStatus.Paused && b.Attempt == 1), "block 0 attempt 1 recorded as paused");
        Check(checks, ref ok, d.Blocks.Any(b => b.Index == 0 && b.Status == BlockStatus.Ok && b.Attempt == 2), "block 0 attempt 2 ran to the end");
        Check(checks, ref ok, d.Arms.Any(a => a.Status == ArmStatus.Paused), "the interrupted arm is recorded as paused (cancelled)");
        Check(checks, ref ok, d.Logs.Pauses.Any(p => p.Kind == "native-pause") && d.Logs.Pauses.Any(p => p.Kind == "native-resume"), "pause and resume logged");
        Check(checks, ref ok, d.Status == RunStatus.Complete, "run status complete (every block has an ok attempt)");
        Check(checks, ref ok, ResultValidator.Validate(rig.Store.LoadDocumentJson(s.RunId!)!).Count == 0, "document is schema-valid");
        return new ScenarioResult("d-pause-reruns-block", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // E: server errors then success; retry with back-off, same key.
    public static async Task<ScenarioResult> ServerErrors(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        rig.Endpoint.Script = n => n switch { 1 => EndpointBehavior.ServerError, 2 => EndpointBehavior.TooManyRequests, _ => EndpointBehavior.Accept };
        var s = rig.NewSession(rig.Blocks());
        await s.RunAsync(CancellationToken.None);
        var state = rig.Store.LoadState(s.RunId!);
        Check(checks, ref ok, s.Snapshot.Receipt != null, "delivered on the third try");
        Check(checks, ref ok, state.Attempts.Select(a => a.HttpStatus).SequenceEqual(new int?[] { 500, 429, 201 }), "attempt statuses 500, 429, 201");
        Check(checks, ref ok, rig.Endpoint.Stored.Count == 1, "one stored result");
        return new ScenarioResult("e-server-errors-then-ok", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // F: the endpoint refuses (wrong upload code): not retried; the document stays saved; the GitHub address and Share work.
    public static async Task<ScenarioResult> RejectedThenFallbacks(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir, uploadCodeForClient: "wrong-code");
        var s = rig.NewSession(rig.Blocks());
        await s.RunAsync(CancellationToken.None);
        var state = rig.Store.LoadState(s.RunId!);
        Check(checks, ref ok, s.Snapshot.Receipt == null && s.Snapshot.DoneLine == ScreenText.DoneNotSent, "no receipt; the Done screen says the results are not sent");
        Check(checks, ref ok, rig.Endpoint.Requests == 1 && state.Attempts.Count == 1 && state.Attempts[0].Outcome == "Rejected" && state.Attempts[0].HttpStatus == 401, "one attempt, rejected with 401, not retried");
        Check(checks, ref ok, !state.Attempts.Any(a => (a.Detail ?? "").Contains("wrong-code")), "the upload code appears in no recorded detail");
        Check(checks, ref ok, rig.Store.LoadDocumentJson(s.RunId!) != null, "document still saved");
        var gh = s.BuildGitHubUrl();
        Check(checks, ref ok, gh != null && gh.Url.Length <= GitHubIssueUrl.DefaultMaxChars && gh.Url.StartsWith("https://github.com/example/results/issues/new?title="), $"GitHub address built, {gh?.Url.Length} characters (cap {GitHubIssueUrl.DefaultMaxChars}), level {gh?.Level}");
        Check(checks, ref ok, gh != null && Uri.UnescapeDataString(gh.Url).Contains(s.Document!.IdempotencyKey), "address carries the idempotency key");
        await rig.Platform.OpenUrlAsync(gh!.Url); s.RecordGitHubOpened();
        await rig.Platform.ShareFileAsync(rig.Store.DocumentPath(s.RunId!), "FireSim test result"); s.RecordShared();
        var uo = rig.Platform.OpenUninstall("au.firesim.proto.r0"); s.RecordUninstall(uo);
        var st2 = rig.Store.LoadState(s.RunId!);
        Check(checks, ref ok, st2.GitHubOpenedUtc != null && st2.SharedUtc != null && st2.Uninstall?.Outcome == "uninstall-screen-opened", "GitHub, Share and Uninstall outcomes recorded for the next launch");
        return new ScenarioResult("f-rejected-then-fallbacks", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // G: the phone is at 30 % and not charging: the run stops at the first gate, the document says so and is still sent.
    public static async Task<ScenarioResult> LowBattery(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        rig.Device.Set(x => x with { BatteryPercent = 30, IsCharging = false });
        var s = rig.NewSession(rig.Blocks());
        await s.RunAsync(CancellationToken.None);
        var d = LoadSaved(rig, s);
        Check(checks, ref ok, d.Status == RunStatus.Aborted, "status aborted");
        Check(checks, ref ok, d.Blocks.Count == 2 && d.Blocks.All(b => b.Status == BlockStatus.Skipped) && d.Arms.Count == 0, "both blocks skipped, no arm ran");
        Check(checks, ref ok, d.Logs.Gating.Any(g => g.Outcome == "BatteryLow"), "gate event BatteryLow");
        Check(checks, ref ok, d.Errors.Any(e => e.Where == "gate"), "stop reason recorded in errors");
        Check(checks, ref ok, ResultValidator.Validate(rig.Store.LoadDocumentJson(s.RunId!)!).Count == 0, "document is schema-valid");
        Check(checks, ref ok, s.Snapshot.Receipt != null, "an aborted run is still sent");
        return new ScenarioResult("g-low-battery-aborts", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // H: a build with no endpoint (the default): saved, not sent, says so; the fallbacks are what is left.
    public static async Task<ScenarioResult> NoEndpoint(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir, withEndpoint: false, githubRepo: "");
        var s = rig.NewSession(rig.Blocks());
        await s.RunAsync(CancellationToken.None);
        Check(checks, ref ok, s.Snapshot.Phase == SessionPhase.Done && s.Snapshot.Receipt == null && s.Snapshot.DoneLine == ScreenText.DoneNotSent, "Done screen without a receipt");
        Check(checks, ref ok, rig.Endpoint.Requests == 0, "nothing was sent");
        Check(checks, ref ok, s.BuildGitHubUrl() == null, "no GitHub address without a repository setting");
        Check(checks, ref ok, rig.Store.LoadDocumentJson(s.RunId!) != null, "document saved");
        return new ScenarioResult("h-no-endpoint", ok, checks, rig.Store.DocumentPath(s.RunId!));
    }

    // I: the user opens the app again after a finished run: it shows the Done screen instead of starting another run.
    public static async Task<ScenarioResult> RelaunchResumes(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        var first = rig.NewSession(rig.Blocks());
        await first.RunAsync(CancellationToken.None);
        var second = rig.NewSession(rig.Blocks());
        rig.Device.SetNetwork(true);
        await second.RunAsync(CancellationToken.None);
        Check(checks, ref ok, second.Snapshot.Phase == SessionPhase.Done && second.Snapshot.Receipt?.Text == "issue 17", "second launch shows the Done screen with the receipt");
        Check(checks, ref ok, second.RunId == first.RunId, "same run id");
        Check(checks, ref ok, new DirectoryInfo(Path.Combine(dir, "store")).GetFiles("result-*.json").Length == 1 && rig.Endpoint.Requests == 1, "no second run, no second send");
        return new ScenarioResult("i-relaunch-resumes", ok, checks, rig.Store.DocumentPath(first.RunId!));
    }

    // J: Not now stops the countdown; Start runs.
    public static async Task<ScenarioResult> NotNowThenStart(string dir)
    {
        var checks = new List<string>(); bool ok = true;
        using var rig = new Rig(dir);
        rig.Options = new SessionOptions { CountdownSeconds = 5, CountdownStep = TimeSpan.FromMilliseconds(30), SampleInterval = rig.Options.SampleInterval, Gate = rig.Options.Gate, Backoff = rig.Options.Backoff };
        var s = rig.NewSession(rig.Blocks());
        var run = s.RunAsync(CancellationToken.None);
        await WaitFor(() => s.Snapshot.Phase == SessionPhase.Countdown);
        s.NotNow();
        bool parked = await WaitFor(() => s.Snapshot.Phase == SessionPhase.NotNow);
        await Task.Delay(100);
        Check(checks, ref ok, parked && s.RunId == null && rig.Endpoint.Requests == 0, "Not now: countdown stopped, nothing ran");
        s.StartNow();
        await run.WaitAsync(TimeSpan.FromSeconds(15));
        Check(checks, ref ok, s.Snapshot.Receipt != null, "Start: the run went through to a receipt");
        return new ScenarioResult("j-not-now", ok, checks, s.RunId == null ? null : rig.Store.DocumentPath(s.RunId));
    }
}
