namespace FsTestApp.Device;

/// <summary>Android's <c>PowerManager.THERMAL_STATUS_*</c>, plus <see cref="Unknown"/> when the API is missing (below API 29) or a read failed.</summary>
public enum ThermalStatus { Unknown = -1, None = 0, Light = 1, Moderate = 2, Severe = 3, Critical = 4, Emergency = 5, Shutdown = 6 }

/// <summary>One reading of everything the gating and the logs need. A null field means "could not be read" (and is logged as such), never a guess.</summary>
public sealed record DeviceSnapshot
{
    /// <summary>0..100, from the sticky ACTION_BATTERY_CHANGED broadcast (no permission needed).</summary>
    public int? BatteryPercent { get; init; }
    public bool? IsCharging { get; init; }
    /// <summary>Battery charge counter in microampere-hours (BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER), for energy per simulated minute.</summary>
    public long? ChargeCounterUah { get; init; }
    public bool? PowerSaver { get; init; }
    public ThermalStatus Thermal { get; init; } = ThermalStatus.Unknown;
    /// <summary>PowerManager.getThermalHeadroom, API 30+. NaN (the platform's "not available") and infinities are mapped to null by the reader.</summary>
    public double? ThermalHeadroom { get; init; }
    /// <summary>Settings.Global airplane_mode_on.</summary>
    public bool? AirplaneMode { get; init; }
    public bool NetworkReachable { get; init; } = true;
    public bool ScreenOn { get; init; } = true;
    public bool IsForeground { get; init; } = true;
}

/// <summary>The only way the runner, the gate and the sender look at the phone. The Android implementation lives in Fs.TestApp; tests and the dry run use
/// <see cref="SimulatedDeviceState"/>. Every member must be safe to call from any thread and must not throw (return nulls instead).</summary>
public interface IDeviceState
{
    DeviceSnapshot Read();
    /// <summary>Raised when the app goes to the background (false) or comes back (true): OnPause / OnResume. May be raised on any thread.</summary>
    event Action<bool>? ForegroundChanged;
    /// <summary>Raised when the screen turns off (false) or on (true).</summary>
    event Action<bool>? ScreenChanged;
    /// <summary>Raised when the network reachability changes (Connectivity.ConnectivityChanged).</summary>
    event Action<bool>? NetworkChanged;
}

/// <summary>A scriptable device for tests and the container dry run.</summary>
public sealed class SimulatedDeviceState : IDeviceState
{
    readonly object gate = new();
    DeviceSnapshot current = new()
    {
        BatteryPercent = 90, IsCharging = false, ChargeCounterUah = 3_000_000, PowerSaver = false,
        Thermal = ThermalStatus.None, ThermalHeadroom = 0.4, AirplaneMode = false,
    };
    public event Action<bool>? ForegroundChanged;
    public event Action<bool>? ScreenChanged;
    public event Action<bool>? NetworkChanged;
    /// <summary>Called on each <see cref="Read"/> with the read count and the current state, so a test can script a changing device (cooling down,
    /// charging) by call count. Whatever it returns becomes the current state.</summary>
    public Func<int, DeviceSnapshot, DeviceSnapshot>? Script { get; set; }
    int reads;
    public int ReadCount => Volatile.Read(ref reads);

    public DeviceSnapshot Read()
    {
        lock (gate)
        {
            int n = ++reads;
            if (Script != null) current = Script(n, current);
            return current;
        }
    }

    public void Set(Func<DeviceSnapshot, DeviceSnapshot> change) { lock (gate) current = change(current); }

    public void GoBackground() { Set(s => s with { IsForeground = false }); ForegroundChanged?.Invoke(false); }
    public void ComeForeground() { Set(s => s with { IsForeground = true }); ForegroundChanged?.Invoke(true); }
    public void SetScreen(bool on) { Set(s => s with { ScreenOn = on }); ScreenChanged?.Invoke(on); }
    public void SetNetwork(bool reachable) { Set(s => s with { NetworkReachable = reachable }); NetworkChanged?.Invoke(reachable); }
}
