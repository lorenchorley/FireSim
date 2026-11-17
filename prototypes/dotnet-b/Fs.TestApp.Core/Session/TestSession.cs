using FsTestApp.Device;
using FsTestApp.Results;
using FsTestApp.Runner;
using FsTestApp.Sending;
using FsTestApp.Storage;

namespace FsTestApp.Session;

public enum SessionPhase { Intro, Countdown, NotNow, Running, Saving, Sending, Done, Failed }

public sealed record SessionSnapshot
{
    public SessionPhase Phase { get; init; } = SessionPhase.Intro;
    public int CountdownSeconds { get; init; }
    public RunnerStatus? Runner { get; init; }
    public string Message { get; init; } = "";
    public Receipt? Receipt { get; init; }
    public string? DoneLine { get; init; }
    public bool WaitingForNetwork { get; init; }
    public string? SavedPath { get; init; }
    public string RunStatus { get; init; } = "";
    public string? PreviousUninstallNote { get; init; }
}

public sealed class SessionOptions
{
    public TimeSpan CountdownStep { get; init; } = TimeSpan.FromSeconds(1);
    public int CountdownSeconds { get; init; } = 10;
    /// <summary>Thermal headroom and battery are logged this often (plan: every 10 s; Android returns NaN if asked much more often than once a second).</summary>
    public TimeSpan SampleInterval { get; init; } = TimeSpan.FromSeconds(10);
    public GateOptions Gate { get; init; } = new();
    public RunnerOptions Runner { get; init; } = new();
    public BackoffPolicy Backoff { get; init; } = new();
}

/// <param name="IntroText">The first screen's text when the round has its own wording (round 0 says it is a connectivity and device check); null: the plan's standard text.</param>
public sealed record TestPlan(int Round, string RoundName, IReadOnlyList<Block> Blocks, string? IntroText = null)
{
    public double EstimatedSeconds => BlockPlan.EstimatedSeconds(Blocks);
    public int Minutes => ScreenText.Minutes(EstimatedSeconds);
}

/// <summary>One launch of the test app, from the first screen to the Done screen: countdown, run, save, send, receipt. All platform access is behind
/// interfaces, so the container dry run drives the same code that the phone runs. Raises <see cref="Changed"/> from any thread.</summary>
public sealed class TestSession
{
    readonly TestPlan plan;
    readonly IDeviceState device;
    readonly IRunEnvironment env;
    readonly IResultStore store;
    readonly IResultsSender sender;
    readonly IClock clock;
    readonly SessionOptions options;
    readonly ResultsConfig config;
    readonly object gate = new();
    readonly TaskCompletionSource startNow = new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly CancellationTokenSource runCts = new();
    volatile bool notNow;
    SessionSnapshot snapshot;
    ResultDocument? doc;
    string? runId;
    PauseMonitor? monitor;

    /// <summary>Runs before the first block: the app starts the HybridWebView, applies the isolation allowlist and fills <see cref="WebViewFacts"/>.
    /// Failures inside it must be caught by the hook and recorded; an exception that escapes is recorded here.</summary>
    public Func<RunLog, CancellationToken, Task>? BeforeRun { get; set; }

    public event Action<SessionSnapshot>? Changed;

    public TestSession(TestPlan plan, IDeviceState device, IRunEnvironment env, IResultStore store, IResultsSender sender, ResultsConfig config, IClock clock, SessionOptions? options = null)
    {
        this.plan = plan; this.device = device; this.env = env; this.store = store; this.sender = sender; this.config = config; this.clock = clock;
        this.options = options ?? new SessionOptions();
        snapshot = new SessionSnapshot { Phase = SessionPhase.Intro, CountdownSeconds = this.options.CountdownSeconds };
    }

    public SessionSnapshot Snapshot { get { lock (gate) return snapshot; } }
    public TestPlan Plan => plan;
    public string FirstScreenText => plan.IntroText ?? ScreenText.First(plan.Minutes);
    public string? RunId => runId;
    public ResultDocument? Document => doc;

    void Set(Func<SessionSnapshot, SessionSnapshot> change)
    {
        SessionSnapshot s;
        lock (gate) { snapshot = change(snapshot); s = snapshot; }
        Changed?.Invoke(s);
    }

    /// <summary>The page reports visibilitychange; the runner treats hidden as a pause.</summary>
    public void NotifyWebViewVisibility(bool visible) => monitor?.NotifyWebViewVisibility(visible);

    public void NotNow() { notNow = true; }
    public void StartNow() { startNow.TrySetResult(); }
    public void Cancel() { try { runCts.Cancel(); } catch (ObjectDisposedException) { } }

    /// <summary>Everything, in order. Returns when the Done (or Failed) screen is reached. Resumes a finished run found in the store instead of starting a new one.</summary>
    public async Task RunAsync(CancellationToken appCt)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(appCt, runCts.Token);
        var ct = linked.Token;

        if (TryResume()) return;

        // countdown with a Not now button
        for (int s = options.CountdownSeconds; s > 0; s--)
        {
            Set(x => x with { Phase = SessionPhase.Countdown, CountdownSeconds = s, Message = $"Starting in {s} s" });
            try { await clock.DelayAsync(options.CountdownStep, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
            if (notNow) break;
        }
        if (notNow)
        {
            Set(x => x with { Phase = SessionPhase.NotNow, Message = "Not now. Nothing has run. Tap Start when you are ready." });
            try { await startNow.Task.WaitAsync(ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
        }

        await ExecuteAsync(ct).ConfigureAwait(false);
    }

    bool TryResume()
    {
        try
        {
            string? latest = store.FindLatestRunId();
            if (latest == null) return false;
            string? json = store.LoadDocumentJson(latest);
            var saved = json == null ? null : ResultJsonContext.Deserialize(json);
            if (saved == null || saved.Round != plan.Round) return false;
            var build = env.GetBuildInfo();
            if (saved.Build.ApkSha256 != build.ApkSha256 && build.ApkSha256 != ResultDocument.ApkShaUnavailable) return false;   // left over from another build of this id
            doc = saved; runId = latest;
            var state = store.LoadState(latest);
            Set(x => x with
            {
                Phase = SessionPhase.Done, Receipt = state.Receipt, DoneLine = DoneLine(state.Receipt), RunStatus = saved.Status,
                SavedPath = store.DocumentPath(latest), Message = "A finished run was found on this phone.",
                PreviousUninstallNote = state.Uninstall == null ? null : $"You tried to uninstall at {state.Uninstall.AtUtc.ToLocalTime():HH:mm} ({state.Uninstall.Outcome}). The app is still installed."
            });
            return true;
        }
        catch (Exception) { return false; }   // a damaged store must not stop a fresh run
    }

    async Task ExecuteAsync(CancellationToken ct)
    {
        Set(x => x with { Phase = SessionPhase.Running, Message = "Running" });
        var build = Guard(() => env.GetBuildInfo(), new BuildInfo { ApkSha256 = ResultDocument.ApkShaUnavailable });
        runId = ResultDocument.NewRunId();
        var d = new ResultDocument
        {
            Round = plan.Round, RoundName = plan.RoundName, RunId = runId, Build = build, StartedUtc = clock.UtcNow,
            IdempotencyKey = ResultDocument.MakeIdempotencyKey(build.ApkSha256, runId),
        };
        doc = d;
        var log = new RunLog(d, clock);
        d.Device = log.Guard("device facts", () => env.GetDeviceFacts(), new DeviceFacts { Cores = Math.Max(1, Environment.ProcessorCount) });
        var first = log.Guard("device read", device.Read, new DeviceSnapshot());
        d.Conditions = new Conditions
        {
            AirplaneMode = first.AirplaneMode, NetworkAtStart = first.NetworkReachable, BatteryStartPercent = first.BatteryPercent, ChargingAtStart = first.IsCharging,
            PowerSaverAtStart = first.PowerSaver, ThermalAtStart = RunLog.ThermalName(first.Thermal),
        };

        using var mon = new PauseMonitor(device, log);
        monitor = mon;
        using var samplerCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var sampler = Task.Run(() => SamplerLoopAsync(log, samplerCts.Token));
        RunOutcome outcome;
        try
        {
            if (BeforeRun != null)
            {
                try { await BeforeRun(log, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception e) { log.AddError("before run", e); }
            }
            var gate = new DeviceGate(device, clock, options.Gate);
            var runner = new BlockRunner(gate, mon, log, r => Set(x => x with { Runner = r, Message = r.Text ?? x.Message }), options.Runner);
            outcome = await runner.RunAsync(plan.Blocks, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { outcome = new RunOutcome(RunStatus.Cancelled, 0, 0, 0, "cancelled"); }
        catch (Exception e)
        {
            log.AddError("run", e);
            outcome = new RunOutcome(RunStatus.Partial, 0, 0, 0, "run failed: " + e.Message);
        }
        finally
        {
            samplerCts.Cancel();
            try { await sampler.ConfigureAwait(false); } catch (OperationCanceledException) { }
            monitor = null;
        }
        log.Guard("final sample", () => { log.AddSample(device.Read()); return 0; }, 0);
        d.Status = outcome.Status;
        d.FinishedUtc = clock.UtcNow;

        // our own check, before saving: a document that fails its schema is a bug in the app; record it and send anyway (the full text is the evidence)
        var problems = log.Guard("schema check", () => ResultValidator.Validate(d), Array.Empty<SchemaError>());
        foreach (var p in problems.Take(5)) log.AddError("schema", p.ToString());

        // save, then send
        Set(x => x with { Phase = SessionPhase.Saving, Message = "Saving the results on this phone", RunStatus = d.Status });
        string json = log.SerializeSnapshot();
        string? path = null;
        try { path = store.SaveDocument(runId, json); }
        catch (Exception e)
        {
            log.AddError("save", e);
            Set(x => x with { Phase = SessionPhase.Failed, Message = "Could not save the results on this phone: " + e.Message });
            return;
        }

        var state = store.LoadState(runId);
        state.IdempotencyKey = d.IdempotencyKey;
        store.SaveState(state);
        Set(x => x with { SavedPath = path });
        await SendCoreAsync(ct).ConfigureAwait(false);
    }

    /// <summary>The Send now button (and the automatic send at the end of the run).</summary>
    public Task SendNowAsync(CancellationToken ct = default) => SendCoreAsync(ct);

    async Task SendCoreAsync(CancellationToken ct)
    {
        if (runId == null) return;
        Set(x => x with { Phase = SessionPhase.Sending, Message = "Sending the results..." });
        var delivery = new ResultsDelivery(sender, store, device, clock, options.Backoff);
        DeliveryOutcome o;
        try
        {
            o = await delivery.SendAsync(runId, st => Set(x => x with { Message = st.Text, WaitingForNetwork = st.WaitingForNetwork }), ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { Set(x => x with { Phase = SessionPhase.Done, DoneLine = ScreenText.DoneNotSent, WaitingForNetwork = false }); return; }
        catch (Exception e)
        {
            Set(x => x with { Phase = SessionPhase.Done, DoneLine = ScreenText.DoneNotSent, Message = "Could not send: " + e.Message, WaitingForNetwork = false });
            return;
        }
        Set(x => x with
        {
            Phase = SessionPhase.Done, Receipt = o.Receipt, DoneLine = DoneLine(o.Receipt), WaitingForNetwork = false,
            Message = o.Receipt != null ? "" : (o.Detail ?? "Not sent yet"),
        });
    }

    string DoneLine(Receipt? r) => r == null ? ScreenText.DoneNotSent : ScreenText.Done(r.AtUtc.ToLocalTime().ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture), r.Text);

    /// <summary>The fallback address for Send with GitHub; null when the build has no repository set.</summary>
    public GitHubUrlResult? BuildGitHubUrl() => doc != null && config.HasGitHub ? GitHubIssueUrl.Build(config.GitHubRepo, doc) : null;

    public void RecordGitHubOpened() => Update(s => s.GitHubOpenedUtc = clock.UtcNow);
    public void RecordShared() => Update(s => s.SharedUtc = clock.UtcNow);
    public void RecordUninstall(UninstallOutcome o) => Update(s => s.Uninstall = new UninstallAttempt { AtUtc = clock.UtcNow, Outcome = o.Outcome, Detail = o.Detail });

    void Update(Action<SendState> change)
    {
        if (runId == null) return;
        try { var s = store.LoadState(runId); change(s); store.SaveState(s); } catch (Exception) { /* a state note is never worth a crash */ }
    }

    async Task SamplerLoopAsync(RunLog log, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                log.Guard("sampler", () => { log.AddSample(device.Read()); return 0; }, 0);
                await clock.DelayAsync(options.SampleInterval, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
    }

    static T Guard<T>(Func<T> f, T fallback)
    {
        try { return f(); } catch (Exception) { return fallback; }
    }
}
