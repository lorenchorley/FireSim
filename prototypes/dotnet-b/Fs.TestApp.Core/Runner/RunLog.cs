using FsTestApp.Device;
using FsTestApp.Results;

namespace FsTestApp.Runner;

/// <summary>The thread-safe collector behind a run: the sampler, the pause monitor, the gate and the block runner all write the same
/// <see cref="ResultDocument"/> through it. Times are milliseconds since the run started (monotonic clock).</summary>
public sealed class RunLog
{
    readonly object gate = new();
    readonly IClock clock;
    readonly long startMs;
    public ResultDocument Document { get; }

    public RunLog(ResultDocument document, IClock clock)
    {
        Document = document; this.clock = clock; startMs = clock.MonotonicMs;
    }

    public double NowMs => clock.MonotonicMs - startMs;
    public DateTimeOffset UtcNow => clock.UtcNow;

    /// <summary>Where the run is, for tagging pause events (set by the block runner).</summary>
    public int? CurrentBlock { get; set; }
    public string? CurrentArm { get; set; }

    public void AddSample(DeviceSnapshot s)
    {
        double t = NowMs;
        double? headroom = s.ThermalHeadroom is { } h && double.IsFinite(h) ? h : null;   // the platform answers NaN when asked too often or unsupported
        lock (gate)
        {
            Document.Logs.Thermal.Add(new ThermalSample { TMs = t, Status = ThermalName(s.Thermal), Headroom = headroom });
            Document.Logs.Battery.Add(new BatterySample { TMs = t, Percent = s.BatteryPercent, Charging = s.IsCharging, ChargeCounterUah = s.ChargeCounterUah, PowerSaver = s.PowerSaver });
        }
    }

    public static string ThermalName(ThermalStatus s) => s switch
    {
        ThermalStatus.None => "none", ThermalStatus.Light => "light", ThermalStatus.Moderate => "moderate", ThermalStatus.Severe => "severe",
        ThermalStatus.Critical => "critical", ThermalStatus.Emergency => "emergency", ThermalStatus.Shutdown => "shutdown", _ => "unknown",
    };

    public void AddPause(string kind)
    {
        double t = NowMs;
        lock (gate) Document.Logs.Pauses.Add(new PauseEvent { TMs = t, Kind = kind, Block = CurrentBlock, Arm = CurrentArm });
    }

    public void AddGate(int block, GateResult r)
    {
        double t = NowMs;
        lock (gate) Document.Logs.Gating.Add(new GateEvent { TMs = t, Block = block, Outcome = r.Outcome.ToString(), WaitedMs = r.WaitedMs, Reason = r.Reason });
    }

    public void AddBlock(BlockRecord b) { lock (gate) Document.Blocks.Add(b); }
    public void AddArm(ArmRecord a) { lock (gate) Document.Arms.Add(a); }

    /// <summary>Errors are recorded with type, message and a trimmed stack, never thrown on to the UI.</summary>
    public void AddError(string where, Exception e)
    {
        double t = NowMs;
        var rec = new ErrorRecord { TMs = t, Where = Trim(where, 128), Type = Trim(e.GetType().FullName ?? e.GetType().Name, 256), Message = Trim(e.Message, 2048), Stack = Trim(e.StackTrace ?? "", 4096) };
        lock (gate) { if (Document.Errors.Count < 200) Document.Errors.Add(rec); }
    }

    public void AddError(string where, string message)
    {
        double t = NowMs;
        lock (gate) { if (Document.Errors.Count < 200) Document.Errors.Add(new ErrorRecord { TMs = t, Where = Trim(where, 128), Message = Trim(message, 2048) }); }
    }

    /// <summary>Run <paramref name="action"/>; a failure becomes an error record and <paramref name="fallback"/>. Every platform call goes through this.</summary>
    public T Guard<T>(string where, Func<T> action, T fallback)
    {
        try { return action(); }
        catch (Exception e) { AddError(where, e); return fallback; }
    }

    /// <summary>A consistent copy of the document for saving or sending while the run is still logging.</summary>
    public string SerializeSnapshot() { lock (gate) return ResultJsonContext.Serialize(Document); }

    static string Trim(string s, int max) => s.Length <= max ? s : s[..max];
}
