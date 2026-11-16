using System.Text.Json.Nodes;
using FsTestApp;
using FsTestApp.Arms;
using FsTestApp.Device;
using FsTestApp.DryRun;
using FsTestApp.Results;
using FsTestApp.Runner;
using FsTestApp.Session;

namespace Fs.Tests.TestApp;

[TestClass]
public sealed class BlockRunnerTests
{
    sealed class NamedArm(string name, Func<CancellationToken, Task<JsonNode>>? body = null, double seconds = 1) : IArm
    {
        public string Name => name;
        public double EstimatedSeconds => seconds;
        public int Runs;
        public Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
        {
            Interlocked.Increment(ref Runs);
            return body != null ? body(ct) : Task.FromResult<JsonNode>(new JsonObject { ["ran"] = name });
        }
    }

    static (BlockRunner runner, RunLog log, SimulatedDeviceState dev, ManualClock clock, PauseMonitor mon) Rig(GateOptions? gate = null, int maxAttempts = 3)
    {
        var dev = new SimulatedDeviceState();
        var clock = new ManualClock();
        var log = new RunLog(TestDocs.Valid(arms: 0, samples: 0), clock);
        log.Document.Blocks.Clear();
        var mon = new PauseMonitor(dev, log);
        var runner = new BlockRunner(new DeviceGate(dev, clock, gate), mon, log, null, new RunnerOptions { MaxBlockAttempts = maxAttempts });
        return (runner, log, dev, clock, mon);
    }

    [TestMethod]
    public void AbBaGivesAbThenBa()
    {
        var a = new NamedArm("a"); var b = new NamedArm("b");
        var blocks = BlockPlan.AbBa(a, b);
        CollectionAssert.AreEqual(new[] { "a", "b" }, blocks[0].Arms.Select(x => x.Name).ToArray());
        CollectionAssert.AreEqual(new[] { "b", "a" }, blocks[1].Arms.Select(x => x.Name).ToArray());
        var names = BlockPlan.AbBa(a, b, 2).SelectMany(x => x.Arms.Select(y => y.Name)).ToArray();
        CollectionAssert.AreEqual(new[] { "a", "b", "b", "a", "a", "b", "b", "a" }, names, "A B B A A B B A");
    }

    [TestMethod]
    public void CounterbalancedRotatesAndReversesSoEachArmSeesEveryPosition()
    {
        var arms = new IArm[] { new NamedArm("a"), new NamedArm("b"), new NamedArm("c") };
        var blocks = BlockPlan.Counterbalanced(arms, 6);
        Assert.AreEqual(6, blocks.Count);
        var positions = arms.ToDictionary(x => x.Name, _ => new List<int>());
        foreach (var bl in blocks) for (int i = 0; i < bl.Arms.Count; i++) positions[bl.Arms[i].Name].Add(i);
        foreach (var kv in positions)
        {
            Assert.AreEqual(2, kv.Value.Count(p => p == 0), $"{kv.Key} first twice in six blocks");
            Assert.AreEqual(2, kv.Value.Count(p => p == 1));
            Assert.AreEqual(2, kv.Value.Count(p => p == 2));
        }
        Assert.IsTrue(blocks.All(b => b.Arms.Count == 3 && b.Arms.Distinct().Count() == 3));
    }

    [TestMethod]
    public async Task RunsEveryArmInOrderAndRecordsBlocksAndArms()
    {
        var (runner, log, _, _, _) = Rig();
        var a = new NamedArm("a"); var b = new NamedArm("b");
        var o = await runner.RunAsync(BlockPlan.AbBa(a, b), CancellationToken.None);
        Assert.AreEqual(RunStatus.Complete, o.Status);
        Assert.AreEqual(2, log.Document.Blocks.Count);
        CollectionAssert.AreEqual(new[] { "a", "b", "b", "a" }, log.Document.Arms.Select(x => x.Name).ToArray());
        Assert.IsTrue(log.Document.Arms.All(x => x.Status == ArmStatus.Ok && x.Result != null));
        Assert.AreEqual(2, log.Document.Logs.Gating.Count);
        Assert.AreEqual(0, ResultValidator.Validate(log.Document).Count, string.Join("; ", ResultValidator.Validate(log.Document)));
    }

    [TestMethod]
    public async Task FailingArmIsRecordedAndTheRunGoesOn()
    {
        var (runner, log, _, _, _) = Rig();
        var bad = new FailingArm(); var good = new NamedArm("good");
        var o = await runner.RunAsync(new[] { new Block("b", new IArm[] { bad, good }) }, CancellationToken.None);
        Assert.AreEqual(RunStatus.Partial, o.Status);
        Assert.AreEqual(1, o.ArmErrors);
        Assert.AreEqual(ArmStatus.Error, log.Document.Arms[0].Status);
        StringAssert.Contains(log.Document.Arms[0].Error!, "failed on purpose");
        Assert.AreEqual(ArmStatus.Ok, log.Document.Arms[1].Status);
        Assert.AreEqual(1, log.Document.Errors.Count);
        Assert.IsFalse(string.IsNullOrEmpty(log.Document.Errors[0].Stack), "the stack is kept");
    }

    [TestMethod]
    public async Task PauseInsideABlockCancelsTheArmAndReRunsTheWholeBlock()
    {
        var (runner, log, dev, _, _) = Rig();
        int attempt = 0;
        var first = new NamedArm("first");
        var second = new NamedArm("second", async ct =>
        {
            if (Interlocked.Increment(ref attempt) == 1)
            {
                dev.GoBackground();                     // the app is sent to the background while this arm runs
                await Task.Delay(Timeout.Infinite, ct); // and the arm must stop at once (it is cancelled)
            }
            return new JsonObject { ["ok"] = true };
        });
        var task = runner.RunAsync(new[] { new Block("blk", new IArm[] { first, second }) }, CancellationToken.None);
        await Task.Delay(100);
        Assert.IsFalse(task.IsCompleted, "the runner waits for the app to come back");
        dev.ComeForeground();
        var o = await task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.AreEqual(RunStatus.Complete, o.Status);
        Assert.AreEqual(2, first.Runs, "the first arm was re-run with the block");
        CollectionAssert.AreEqual(new[] { BlockStatus.Paused, BlockStatus.Ok }, log.Document.Blocks.Select(b => b.Status).ToArray());
        CollectionAssert.AreEqual(new[] { 1, 2 }, log.Document.Blocks.Select(b => b.Attempt).ToArray());
        Assert.AreEqual(ArmStatus.Paused, log.Document.Arms.Single(a => a.Name == "second" && a.BlockAttempt == 1).Status);
        CollectionAssert.AreEqual(new[] { "native-pause", "native-resume" }, log.Document.Logs.Pauses.Select(p => p.Kind).ToArray());
    }

    [TestMethod]
    public async Task ArmThatFinishesDespiteAPauseIsNotTrusted()
    {
        var (runner, log, dev, _, _) = Rig();
        int runs = 0;
        var arm = new NamedArm("ignores-cancel", ct =>
        {
            if (Interlocked.Increment(ref runs) == 1) { dev.GoBackground(); dev.ComeForeground(); }   // a pause that began and ended during the arm
            return Task.FromResult<JsonNode>(new JsonObject());
        });
        var o = await runner.RunAsync(new[] { new Block("blk", new IArm[] { arm }) }, CancellationToken.None);
        Assert.AreEqual(RunStatus.Complete, o.Status);
        Assert.AreEqual(2, runs);
        Assert.AreEqual(ArmStatus.Paused, log.Document.Arms[0].Status, "a result taken during a pause is marked, not used");
        Assert.AreEqual(ArmStatus.Ok, log.Document.Arms[1].Status);
    }

    [TestMethod]
    public async Task ABlockThatKeepsBeingPausedIsGivenUpAfterTheLimit()
    {
        var (runner, log, dev, _, _) = Rig(maxAttempts: 2);
        var arm = new NamedArm("always-paused", ct => { dev.GoBackground(); dev.ComeForeground(); return Task.FromResult<JsonNode>(new JsonObject()); });
        var other = new NamedArm("next");
        var o = await runner.RunAsync(new[] { new Block("bad", new IArm[] { arm }), new Block("good", new IArm[] { other }) }, CancellationToken.None);
        Assert.AreEqual(RunStatus.Partial, o.Status);
        Assert.AreEqual(1, o.BlocksFailed);
        CollectionAssert.AreEqual(new[] { BlockStatus.Paused, BlockStatus.Paused, BlockStatus.Failed, BlockStatus.Ok }, log.Document.Blocks.Select(b => b.Status).ToArray());
    }

    [TestMethod]
    public async Task WebViewHiddenCountsAsAPause()
    {
        var (runner, log, _, _, mon) = Rig();
        int n = 0;
        var arm = new NamedArm("web", async ct =>
        {
            if (Interlocked.Increment(ref n) == 1) { mon.NotifyWebViewVisibility(false); await Task.Delay(Timeout.Infinite, ct); }
            return new JsonObject();
        });
        var task = runner.RunAsync(new[] { new Block("b", new IArm[] { arm }) }, CancellationToken.None);
        await Task.Delay(100);
        mon.NotifyWebViewVisibility(true);
        var o = await task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.AreEqual(RunStatus.Complete, o.Status);
        CollectionAssert.AreEqual(new[] { "webview-hidden", "webview-visible" }, log.Document.Logs.Pauses.Select(p => p.Kind).ToArray());
        Assert.AreEqual("web", log.Document.Logs.Pauses[0].Arm);
    }

    [TestMethod]
    public async Task ScreenOffCountsAsAPause()
    {
        var (runner, log, dev, _, _) = Rig();
        int n = 0;
        var arm = new NamedArm("a", async ct => { if (Interlocked.Increment(ref n) == 1) { dev.SetScreen(false); await Task.Delay(Timeout.Infinite, ct); } return new JsonObject(); });
        var task = runner.RunAsync(new[] { new Block("b", new IArm[] { arm }) }, CancellationToken.None);
        await Task.Delay(100);
        dev.SetScreen(true);
        await task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.IsTrue(log.Document.Logs.Pauses.Any(p => p.Kind == "screen-off") && log.Document.Logs.Pauses.Any(p => p.Kind == "screen-on"));
    }

    [TestMethod]
    public async Task LowBatteryStopsTheRunAndMarksTheRestSkipped()
    {
        var (runner, log, dev, _, _) = Rig(new GateOptions { BatteryMaxWait = TimeSpan.FromSeconds(30), PollInterval = TimeSpan.FromSeconds(5) });
        dev.Set(s => s with { BatteryPercent = 20, IsCharging = false });
        var a = new NamedArm("a");
        var o = await runner.RunAsync(BlockPlan.AbBa(a, new NamedArm("b")), CancellationToken.None);
        Assert.AreEqual(RunStatus.Aborted, o.Status);
        Assert.AreEqual(0, a.Runs);
        Assert.IsTrue(log.Document.Blocks.All(b => b.Status == BlockStatus.Skipped) && log.Document.Blocks.Count == 2);
    }

    [TestMethod]
    public async Task CancellationEndsTheRunAsCancelled()
    {
        var (runner, log, _, _, _) = Rig();
        using var cts = new CancellationTokenSource();
        var arm = new NamedArm("a", ct => { cts.Cancel(); ct.ThrowIfCancellationRequested(); return Task.FromResult<JsonNode>(new JsonObject()); });
        var o = await runner.RunAsync(new[] { new Block("b", new IArm[] { arm }) }, cts.Token);
        Assert.AreEqual(RunStatus.Cancelled, o.Status);
    }

    [TestMethod]
    public async Task HotPhoneBetweenBlocksIsWaitedOutAndLogged()
    {
        var (runner, log, dev, clock, _) = Rig();
        var heater = new NamedArm("heater", ct => { dev.Set(s => s with { Thermal = ThermalStatus.Severe }); return Task.FromResult<JsonNode>(new JsonObject()); });
        clock.OnDelay = _ => { if (clock.Delays.Count == 5) dev.Set(s => s with { Thermal = ThermalStatus.None }); };
        var o = await runner.RunAsync(new[] { new Block("one", new IArm[] { heater }), new Block("two", new IArm[] { new NamedArm("x") }) }, CancellationToken.None);
        Assert.AreEqual(RunStatus.Complete, o.Status);
        Assert.AreEqual(0, log.Document.Logs.Gating[0].WaitedMs);
        Assert.IsTrue(log.Document.Logs.Gating[1].WaitedMs >= 20_000, $"second gate waited {log.Document.Logs.Gating[1].WaitedMs} ms");
        Assert.AreEqual("Ready", log.Document.Logs.Gating[1].Outcome);
    }
}

[TestClass]
public sealed class ScreenTextTests
{
    [TestMethod]
    public void FirstScreenTextIsExactlyThePlansWording()
    {
        Assert.AreEqual(
            "This is a test build of FireSim. It measures this phone and sends the numbers to the developer. It does not change your FireSim app. It takes about 3 minutes. Keep this screen open.",
            ScreenText.First(3));
        StringAssert.Contains(ScreenText.First(1), "about 1 minute.");
    }

    [TestMethod]
    public void DoneTextIsExactlyThePlansWording()
    {
        Assert.AreEqual("Done. Results sent at 14:32 (receipt: issue 17). You can uninstall this test app now.", ScreenText.Done("14:32", "issue 17"));
    }

    [TestMethod]
    public void MinutesRoundUpAndNeverBelowOne()
    {
        Assert.AreEqual(1, ScreenText.Minutes(0));
        Assert.AreEqual(1, ScreenText.Minutes(30));
        Assert.AreEqual(2, ScreenText.Minutes(70));
        Assert.AreEqual(58, ScreenText.Minutes(50 * 60), "50 minutes of arms plus 15 %");
    }

    [TestMethod]
    public void RuntimeNamesAreTheSevenOfPlanRule11()
    {
        CollectionAssert.AreEquivalent(new[] { "coreclr", "mono-wasm-aot", "mono-wasm-interp", "coreclr-wasm", "v8-node", "v8-chromium", "v8-webview" }, RuntimeNames.All.ToArray());
    }
}

[TestClass]
public sealed class DryRunTests
{
    [TestMethod]
    public async Task EveryDryRunScenarioPasses()
    {
        var dir = Path.Combine(Path.GetTempPath(), "fs-dryrun-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            var results = await DryRunScenarios.RunAllAsync(dir);
            Assert.AreEqual(10, results.Count);
            var failed = results.Where(r => !r.Passed).Select(r => r.Name + ": " + string.Join(" | ", r.Checks.Where(c => c.StartsWith("FAIL")))).ToList();
            Assert.AreEqual(0, failed.Count, string.Join("\n", failed));
        }
        finally { try { Directory.Delete(dir, true); } catch (IOException) { } }
    }
}
