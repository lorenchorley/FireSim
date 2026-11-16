namespace FsTestApp;

/// <summary>Time and waiting, behind an interface so the gating and retry logic is tested without real waits.</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
    /// <summary>Monotonic milliseconds since an arbitrary start (a stopwatch on the real clock).</summary>
    long MonotonicMs { get; }
    Task DelayAsync(TimeSpan delay, CancellationToken ct);
}

public sealed class SystemClock : IClock
{
    public static readonly SystemClock Instance = new();
    readonly long startTimestamp = System.Diagnostics.Stopwatch.GetTimestamp();
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    public long MonotonicMs => (long)System.Diagnostics.Stopwatch.GetElapsedTime(startTimestamp).TotalMilliseconds;
    public Task DelayAsync(TimeSpan delay, CancellationToken ct) => Task.Delay(delay, ct);
}

/// <summary>A clock whose delays take no time: <see cref="DelayAsync"/> advances the clock and returns. Only meaningful when one flow waits at a
/// time (the gating and retry unit tests); the dry run uses the real clock with short intervals instead.</summary>
public sealed class ManualClock : IClock
{
    long ms;
    readonly DateTimeOffset start;
    public ManualClock(DateTimeOffset? start = null) { this.start = start ?? new DateTimeOffset(2026, 11, 16, 12, 0, 0, TimeSpan.Zero); }
    public DateTimeOffset UtcNow => start.AddMilliseconds(Volatile.Read(ref ms));
    public long MonotonicMs => Volatile.Read(ref ms);
    public List<TimeSpan> Delays { get; } = new();
    public Action<TimeSpan>? OnDelay { get; set; }
    public void Advance(TimeSpan d) => Interlocked.Add(ref ms, (long)d.TotalMilliseconds);
    public Task DelayAsync(TimeSpan delay, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        lock (Delays) Delays.Add(delay);
        Advance(delay);
        OnDelay?.Invoke(delay);
        return Task.CompletedTask;
    }
}
