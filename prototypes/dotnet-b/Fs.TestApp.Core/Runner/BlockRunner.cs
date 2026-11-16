using System.Diagnostics;
using FsTestApp.Arms;
using FsTestApp.Device;
using FsTestApp.Results;

namespace FsTestApp.Runner;

public sealed class RunnerOptions
{
    /// <summary>A block that a pause interrupts is re-run; after this many tries it is recorded as failed and the run goes on.</summary>
    public int MaxBlockAttempts { get; init; } = 3;
}

/// <summary>What the screen shows while the run goes on.</summary>
public sealed record RunnerStatus
{
    public string Phase { get; init; } = "";          // gate, paused, running, between
    public int BlockIndex { get; init; }
    public int BlockCount { get; init; }
    public string BlockName { get; init; } = "";
    public int Attempt { get; init; } = 1;
    public string? ArmName { get; init; }
    public double ArmFraction { get; init; }
    public string? Text { get; init; }
    public double SecondsLeft { get; init; }
}

public sealed record RunOutcome(string Status, int BlocksOk, int BlocksFailed, int ArmErrors, string? StoppedBecause);

/// <summary>Runs blocks of arms: gate before each block, run the arms in order, watch for pauses, re-run an interrupted block, record everything in the
/// <see cref="RunLog"/>. Never throws for an arm failure or a platform failure: they become records. Only the caller's cancellation token ends it early.</summary>
public sealed class BlockRunner
{
    readonly DeviceGate gate;
    readonly PauseMonitor monitor;
    readonly RunLog log;
    readonly RunnerOptions options;
    readonly Action<RunnerStatus>? report;

    public BlockRunner(DeviceGate gate, PauseMonitor monitor, RunLog log, Action<RunnerStatus>? report = null, RunnerOptions? options = null)
    {
        this.gate = gate; this.monitor = monitor; this.log = log; this.report = report; this.options = options ?? new RunnerOptions();
    }

    public async Task<RunOutcome> RunAsync(IReadOnlyList<Block> blocks, CancellationToken ct)
    {
        int ok = 0, failed = 0, armErrors = 0;
        string? stopped = null;
        double remainingAfter(int i) => blocks.Skip(i + 1).Sum(b => b.EstimatedSeconds);
        try
        {
            for (int i = 0; i < blocks.Count; i++)
            {
                var block = blocks[i];
                bool done = false;
                for (int attempt = 1; attempt <= options.MaxBlockAttempts && !done; attempt++)
                {
                    ct.ThrowIfCancellationRequested();
                    log.CurrentBlock = i; log.CurrentArm = null;
                    if (monitor.IsPaused) Status("paused", i, blocks.Count, block, attempt, null, 0, "Paused. Come back to this app to go on.", block.EstimatedSeconds + remainingAfter(i));
                    await monitor.WaitUntilActiveAsync(ct).ConfigureAwait(false);

                    var g = await gate.WaitUntilReadyAsync(ct, text => Status("gate", i, blocks.Count, block, attempt, null, 0, text, block.EstimatedSeconds + remainingAfter(i))).ConfigureAwait(false);
                    log.AddGate(i, g);
                    if (!g.CanRun)
                    {
                        stopped = g.Reason ?? "battery low";
                        log.AddError("gate", "run stopped: " + stopped);
                        for (int j = i; j < blocks.Count; j++)
                            log.AddBlock(new BlockRecord { Index = j, Name = blocks[j].Name, Attempt = 1, Status = BlockStatus.Skipped, StartedAtMs = log.NowMs, GateOutcome = g.Outcome.ToString() });
                        return new RunOutcome(RunStatus.Aborted, ok, failed, armErrors, stopped);
                    }
                    // the gate can take minutes; the app may have gone to the background meanwhile
                    if (monitor.IsPaused) { attempt--; continue; }

                    var result = await RunBlockOnceAsync(blocks, i, attempt, g, remainingAfter(i), ct).ConfigureAwait(false);
                    armErrors += result.ArmErrors;
                    if (!result.Completed && !result.Started) { attempt--; continue; }   // a pause before any arm began: not a try
                    if (result.Completed) { ok++; done = true; }
                    else if (attempt == options.MaxBlockAttempts)
                    {
                        failed++; done = true;
                        log.AddBlock(new BlockRecord { Index = i, Name = block.Name, Attempt = attempt, Status = BlockStatus.Failed, StartedAtMs = log.NowMs, DurationMs = 0, GateOutcome = g.Outcome.ToString() });
                    }
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new RunOutcome(RunStatus.Cancelled, ok, failed, armErrors, "cancelled by the user");
        }
        log.CurrentBlock = null; log.CurrentArm = null;
        return new RunOutcome(failed > 0 || armErrors > 0 ? RunStatus.Partial : RunStatus.Complete, ok, failed, armErrors, null);
    }

    sealed record BlockResult(bool Completed, int ArmErrors, bool Started);

    async Task<BlockResult> RunBlockOnceAsync(IReadOnlyList<Block> blocks, int index, int attempt, GateResult g, double secondsAfter, CancellationToken ct)
    {
        var block = blocks[index];
        int startGeneration = monitor.Generation;
        double blockStart = log.NowMs;
        bool interrupted = false, started = false;
        int armErrors = 0;
        var sw = Stopwatch.StartNew();

        using var armCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        void cancelArm() { try { armCts.Cancel(); } catch (ObjectDisposedException) { } }
        monitor.PauseStarted += cancelArm;
        try
        {
            double leftInBlock = block.EstimatedSeconds;
            foreach (var arm in block.Arms)
            {
                if (monitor.Generation != startGeneration || monitor.IsPaused) { interrupted = true; break; }
                log.CurrentArm = arm.Name;
                started = true;
                double armStart = log.NowMs;
                var armSw = Stopwatch.StartNew();
                var progress = new InlineProgress(p => Status("running", index, blocks.Count, block, attempt, arm.Name, p.Fraction, p.Text,
                    Math.Max(0, leftInBlock - arm.EstimatedSeconds * p.Fraction) + secondsAfter));
                Status("running", index, blocks.Count, block, attempt, arm.Name, 0, null, leftInBlock + secondsAfter);
                var rec = new ArmRecord { Block = index, BlockAttempt = attempt, Name = arm.Name, Runtime = arm.Runtime, StartedAtMs = armStart, EstimatedSeconds = arm.EstimatedSeconds };
                try
                {
                    var node = await arm.RunAsync(progress, armCts.Token).ConfigureAwait(false);
                    armSw.Stop();
                    rec.DurationMs = armSw.Elapsed.TotalMilliseconds;
                    if (monitor.Generation != startGeneration) { rec.Status = ArmStatus.Paused; interrupted = true; }   // finished, but a pause hit it: the number is not clean
                    else { rec.Status = ArmStatus.Ok; rec.Result = node; }
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    armSw.Stop();
                    rec.DurationMs = armSw.Elapsed.TotalMilliseconds; rec.Status = ArmStatus.Paused; interrupted = true;
                }
                catch (OperationCanceledException)
                {
                    armSw.Stop();
                    rec.DurationMs = armSw.Elapsed.TotalMilliseconds; rec.Status = ArmStatus.Paused;
                    log.AddArm(rec);
                    throw;
                }
                catch (Exception e)
                {
                    armSw.Stop();
                    rec.DurationMs = armSw.Elapsed.TotalMilliseconds; rec.Status = ArmStatus.Error; rec.Error = Truncate(e.GetType().Name + ": " + e.Message, 4096);
                    log.AddError($"arm {arm.Name}", e);
                    armErrors++;
                }
                log.AddArm(rec);
                leftInBlock = Math.Max(0, leftInBlock - arm.EstimatedSeconds);
                if (interrupted) break;
            }
        }
        finally
        {
            monitor.PauseStarted -= cancelArm;
            log.CurrentArm = null;
        }

        sw.Stop();
        if (interrupted && !started) return new BlockResult(false, armErrors, false);
        log.AddBlock(new BlockRecord
        {
            Index = index, Name = block.Name, Attempt = attempt, Status = interrupted ? BlockStatus.Paused : BlockStatus.Ok,
            StartedAtMs = blockStart, DurationMs = sw.Elapsed.TotalMilliseconds, GateOutcome = g.Outcome.ToString(),
        });
        return new BlockResult(!interrupted, armErrors, true);
    }

    void Status(string phase, int index, int count, Block block, int attempt, string? arm, double fraction, string? text, double secondsLeft)
        => report?.Invoke(new RunnerStatus { Phase = phase, BlockIndex = index, BlockCount = count, BlockName = block.Name, Attempt = attempt, ArmName = arm, ArmFraction = fraction, Text = text, SecondsLeft = secondsLeft });

    static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

    sealed class InlineProgress(Action<ArmProgress> action) : IProgress<ArmProgress>
    {
        public void Report(ArmProgress value) => action(value);
    }
}
