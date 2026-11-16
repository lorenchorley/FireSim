using FsTestApp;
using FsTestApp.Device;

namespace Fs.Tests.TestApp;

[TestClass]
public sealed class GatingTests
{
    static DeviceGate Gate(SimulatedDeviceState d, ManualClock c, GateOptions? o = null) => new(d, c, o ?? new GateOptions());

    [TestMethod]
    public async Task ReadyAtOnceWhenChargedAndCool()
    {
        var device = new SimulatedDeviceState();
        var clock = new ManualClock();
        var r = await Gate(device, clock).WaitUntilReadyAsync(CancellationToken.None);
        Assert.AreEqual(GateOutcome.Ready, r.Outcome);
        Assert.AreEqual(0, clock.Delays.Count);
    }

    [TestMethod]
    [DataRow(49, false, false)]
    [DataRow(50, false, false)]   // "more than 50 %": exactly 50 does not pass
    [DataRow(51, false, true)]
    [DataRow(5, true, true)]      // charging passes at any charge
    public void BatteryRuleMatchesThePlan(int percent, bool charging, bool expected)
    {
        var s = new DeviceSnapshot { BatteryPercent = percent, IsCharging = charging };
        Assert.AreEqual(expected, DeviceGate.BatteryOk(s, 50));
    }

    [TestMethod]
    public async Task LowBatteryWaitsThenStopsTheRun()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { BatteryPercent = 30, IsCharging = false });
        var clock = new ManualClock();
        var r = await Gate(device, clock, new GateOptions { BatteryMaxWait = TimeSpan.FromMinutes(2), PollInterval = TimeSpan.FromSeconds(10) }).WaitUntilReadyAsync(CancellationToken.None);
        Assert.AreEqual(GateOutcome.BatteryLow, r.Outcome);
        Assert.IsFalse(r.CanRun);
        Assert.IsTrue(r.WaitedMs >= 120_000 && r.WaitedMs <= 130_000, $"waited {r.WaitedMs} ms");
    }

    [TestMethod]
    public async Task PluggingInWhileWaitingLetsTheRunGoOn()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { BatteryPercent = 30, IsCharging = false });
        var clock = new ManualClock { };
        clock.OnDelay = _ => { if (clock.Delays.Count == 3) device.Set(s => s with { IsCharging = true }); };
        var r = await Gate(device, clock).WaitUntilReadyAsync(CancellationToken.None);
        Assert.AreEqual(GateOutcome.Ready, r.Outcome);
        Assert.AreEqual(3, clock.Delays.Count);
    }

    [TestMethod]
    public async Task HotPhoneWaitsUntilThermalStatusIsNone()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { Thermal = ThermalStatus.Moderate });
        var clock = new ManualClock();
        clock.OnDelay = _ => { if (clock.Delays.Count == 4) device.Set(s => s with { Thermal = ThermalStatus.None }); };
        var status = new List<string>();
        var r = await Gate(device, clock).WaitUntilReadyAsync(CancellationToken.None, status.Add);
        Assert.AreEqual(GateOutcome.Ready, r.Outcome);
        Assert.AreEqual(ThermalStatus.Moderate, r.ThermalStart);
        Assert.AreEqual(ThermalStatus.None, r.ThermalEnd);
        Assert.IsTrue(status.All(t => t.Contains("cool down")));
        Assert.AreEqual(4, clock.Delays.Count);
    }

    [TestMethod]
    public async Task ThermalWaitIsCappedAtFiveMinutesThenTheBlockGoesOn()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { Thermal = ThermalStatus.Severe });
        var clock = new ManualClock();
        var r = await Gate(device, clock).WaitUntilReadyAsync(CancellationToken.None);
        Assert.AreEqual(GateOutcome.ReadyThermalTimeout, r.Outcome);
        Assert.IsTrue(r.CanRun, "a stubborn thermal status must not stop the run, only be recorded");
        Assert.IsTrue(r.WaitedMs >= 300_000 && r.WaitedMs < 310_000, $"waited {r.WaitedMs} ms");
        StringAssert.Contains(r.Reason!, "Severe");
    }

    [TestMethod]
    public async Task LightThermalStatusStillCountsAsWarm()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { Thermal = ThermalStatus.Light });
        var clock = new ManualClock();
        var r = await Gate(device, clock, new GateOptions { ThermalMaxWait = TimeSpan.FromSeconds(30) }).WaitUntilReadyAsync(CancellationToken.None);
        Assert.AreEqual(GateOutcome.ReadyThermalTimeout, r.Outcome);
    }

    [TestMethod]
    public async Task UnreadableThermalStatusDoesNotBlockButIsSaid()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { Thermal = ThermalStatus.Unknown });
        var r = await Gate(device, new ManualClock()).WaitUntilReadyAsync(CancellationToken.None);
        Assert.AreEqual(GateOutcome.Ready, r.Outcome);
        StringAssert.Contains(r.Reason!, "unreadable");
    }

    [TestMethod]
    public async Task CancellationStopsTheWait()
    {
        var device = new SimulatedDeviceState();
        device.Set(s => s with { Thermal = ThermalStatus.Severe });
        using var cts = new CancellationTokenSource();
        var clock = new ManualClock { OnDelay = _ => cts.Cancel() };
        await Assert.ThrowsAsync<OperationCanceledException>(async () => await Gate(device, clock).WaitUntilReadyAsync(cts.Token));
    }
}
