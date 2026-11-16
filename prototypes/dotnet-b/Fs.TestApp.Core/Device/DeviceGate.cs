namespace FsTestApp.Device;

public sealed class GateOptions
{
    /// <summary>Charge needed to start a block when not charging (percent, exclusive: "more than 50 %").</summary>
    public int MinBatteryPercent { get; init; } = 50;
    /// <summary>How long to wait for the thermal status to return to none before going on anyway (plan: at most 5 minutes).</summary>
    public TimeSpan ThermalMaxWait { get; init; } = TimeSpan.FromMinutes(5);
    /// <summary>How long to wait for charge (the user plugging in) before stopping the run.</summary>
    public TimeSpan BatteryMaxWait { get; init; } = TimeSpan.FromMinutes(10);
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromSeconds(5);
}

public enum GateOutcome
{
    /// <summary>Charge fine, thermal status none (or unreadable: see <see cref="GateResult.Reason"/>).</summary>
    Ready,
    /// <summary>Thermal status did not return to none within the maximum wait: the block goes on and the result records it.</summary>
    ReadyThermalTimeout,
    /// <summary>Charge stayed at or below the minimum and the phone is not charging: the run stops (a phone must not be drained to zero by a test).</summary>
    BatteryLow,
}

public sealed record GateResult(GateOutcome Outcome, long WaitedMs, ThermalStatus ThermalStart, ThermalStatus ThermalEnd, string? Reason)
{
    public bool CanRun => Outcome != GateOutcome.BatteryLow;
}

/// <summary>The between-blocks check of plan section 5: charge above 50 % or charging, thermal status back to none (at most 5 minutes). Pure logic over
/// <see cref="IDeviceState"/> and <see cref="IClock"/>, so it is unit-tested with a fake. It does not look at foreground state; the runner's pause
/// monitor does.</summary>
public sealed class DeviceGate
{
    readonly IDeviceState device;
    readonly IClock clock;
    readonly GateOptions options;
    public DeviceGate(IDeviceState device, IClock clock, GateOptions? options = null)
    {
        this.device = device; this.clock = clock; this.options = options ?? new GateOptions();
    }

    public static bool BatteryOk(DeviceSnapshot s, int minPercent)
        => s.IsCharging == true || s.BatteryPercent is null || s.BatteryPercent.Value > minPercent;

    /// <summary>An unreadable thermal status (below API 29, or a failed read) does not block: the result says so through <see cref="GateResult.Reason"/>.</summary>
    public static bool ThermalOk(DeviceSnapshot s) => s.Thermal is ThermalStatus.None or ThermalStatus.Unknown;

    public async Task<GateResult> WaitUntilReadyAsync(CancellationToken ct, Action<string>? status = null)
    {
        long start = clock.MonotonicMs;
        var first = device.Read();
        ThermalStatus thermalStart = first.Thermal;
        string? note = first.Thermal == ThermalStatus.Unknown ? "thermal status unreadable (API below 29 or read failed): not gated on heat" : null;
        if (first.BatteryPercent is null && first.IsCharging is null) note = (note == null ? "" : note + "; ") + "charge unreadable: not gated on charge";

        long batteryWaitStart = -1, thermalWaitStart = -1;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var s = device.Read();
            long now = clock.MonotonicMs;

            if (!BatteryOk(s, options.MinBatteryPercent))
            {
                if (batteryWaitStart < 0) batteryWaitStart = now;
                if (now - batteryWaitStart >= (long)options.BatteryMaxWait.TotalMilliseconds)
                    return new GateResult(GateOutcome.BatteryLow, now - start, thermalStart, s.Thermal,
                        $"charge {s.BatteryPercent}% (needs more than {options.MinBatteryPercent}% or charging) for {(now - batteryWaitStart) / 1000} s");
                status?.Invoke($"Battery is at {s.BatteryPercent} %. Plug in the charger to go on.");
                await clock.DelayAsync(options.PollInterval, ct).ConfigureAwait(false);
                continue;
            }
            batteryWaitStart = -1;

            if (ThermalOk(s))
                return new GateResult(GateOutcome.Ready, now - start, thermalStart, s.Thermal, note);

            if (thermalWaitStart < 0) thermalWaitStart = now;
            if (now - thermalWaitStart >= (long)options.ThermalMaxWait.TotalMilliseconds)
                return new GateResult(GateOutcome.ReadyThermalTimeout, now - start, thermalStart, s.Thermal,
                    $"thermal status still {s.Thermal} after {(now - thermalWaitStart) / 1000} s");
            status?.Invoke($"Letting the phone cool down (thermal status: {s.Thermal.ToString().ToLowerInvariant()}).");
            await clock.DelayAsync(options.PollInterval, ct).ConfigureAwait(false);
        }
    }
}
