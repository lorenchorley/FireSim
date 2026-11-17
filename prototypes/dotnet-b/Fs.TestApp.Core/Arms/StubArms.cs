using System.Diagnostics;
using System.Text.Json.Nodes;

namespace FsTestApp.Arms;

/// <summary>A fast fake arm for the dry run and the tests: does a little deterministic work and reports a checksum.</summary>
public sealed class FastFakeArm : IArm
{
    public string Name => "stub-fast";
    public double EstimatedSeconds => 0.2;
    public Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var sw = Stopwatch.StartNew();
        uint x = 0x9E3779B9;
        for (int i = 0; i < 200_000; i++) x = (x ^ (x << 13)) * 0x85EBCA6B + (uint)i;
        progress.Report(new ArmProgress(1, "done"));
        var o = new JsonObject { ["checksum"] = x, ["elapsedMs"] = Math.Round(sw.Elapsed.TotalMilliseconds, 3), ["warmupRuns"] = 0, ["timedRuns"] = 1 };
        return Task.FromResult<JsonNode>(o);
    }
}

/// <summary>A slow fake arm: waits in small steps, reports progress, and stops at once when cancelled (a pause). The wait goes through the clock so
/// the dry run can shorten it; steps * stepDelay is the run time.</summary>
public sealed class SlowFakeArm : IArm
{
    readonly int steps;
    readonly TimeSpan stepDelay;
    readonly IClock clock;
    public SlowFakeArm(IClock clock, int steps = 20, TimeSpan? stepDelay = null, string name = "stub-slow")
    {
        this.clock = clock; this.steps = steps; this.stepDelay = stepDelay ?? TimeSpan.FromMilliseconds(100); Name = name;
    }
    public string Name { get; }
    public double EstimatedSeconds => steps * stepDelay.TotalSeconds;
    public async Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
    {
        int done = 0;
        for (int i = 0; i < steps; i++)
        {
            await clock.DelayAsync(stepDelay, ct).ConfigureAwait(false);
            done++;
            progress.Report(new ArmProgress((i + 1) / (double)steps, $"step {i + 1} of {steps}"));
        }
        return new JsonObject { ["steps"] = done, ["stepMs"] = stepDelay.TotalMilliseconds };
    }
}

/// <summary>An arm that throws, for the error paths.</summary>
public sealed class FailingArm : IArm
{
    public string Name => "stub-fail";
    public double EstimatedSeconds => 0.1;
    public Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct) => throw new InvalidOperationException("stub arm failed on purpose");
}
