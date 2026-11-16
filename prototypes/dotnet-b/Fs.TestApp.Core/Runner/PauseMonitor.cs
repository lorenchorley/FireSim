using FsTestApp.Device;

namespace FsTestApp.Runner;

/// <summary>Tells the runner whether the test may run now. The app is "paused" when it is in the background (OnPause), when the screen is off, or when the
/// page reports <c>visibilitychange</c> to hidden; Android throttles a background WebView, so numbers taken then are worthless and the block is re-run.
/// Every transition is logged (plan section 5: OnPause/OnResume and the page's visibilitychange).</summary>
public sealed class PauseMonitor : IDisposable
{
    readonly IDeviceState device;
    readonly RunLog log;
    readonly object gate = new();
    bool foreground = true, screenOn = true, webViewVisible = true;
    int generation;
    TaskCompletionSource active = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public PauseMonitor(IDeviceState device, RunLog log)
    {
        this.device = device; this.log = log;
        var s = device.Read();
        foreground = s.IsForeground; screenOn = s.ScreenOn;
        if (IsActive) active.TrySetResult();
        device.ForegroundChanged += OnForeground;
        device.ScreenChanged += OnScreen;
    }

    public void Dispose()
    {
        device.ForegroundChanged -= OnForeground;
        device.ScreenChanged -= OnScreen;
    }

    bool IsActive => foreground && screenOn && webViewVisible;
    public bool IsPaused { get { lock (gate) return !IsActive; } }

    /// <summary>Counts pauses that began (active to paused). A block that sees the number change was interrupted, even if its arm finished.</summary>
    public int Generation { get { lock (gate) return generation; } }

    /// <summary>Raised when the state goes from active to paused, on whatever thread caused it. The runner cancels the running arm from here.</summary>
    public event Action? PauseStarted;

    public void NotifyWebViewVisibility(bool visible) => Change(() => webViewVisible = visible, visible ? "webview-visible" : "webview-hidden");
    void OnForeground(bool fg) => Change(() => foreground = fg, fg ? "native-resume" : "native-pause");
    void OnScreen(bool on) => Change(() => screenOn = on, on ? "screen-on" : "screen-off");

    void Change(Action set, string kind)
    {
        bool started = false;
        lock (gate)
        {
            bool before = IsActive;
            set();
            bool after = IsActive;
            log.AddPause(kind);
            if (before && !after)
            {
                generation++;
                active = new(TaskCreationOptions.RunContinuationsAsynchronously);
                started = true;
            }
            else if (!before && after) active.TrySetResult();
        }
        if (started) PauseStarted?.Invoke();
    }

    /// <summary>Completes when the app is in the foreground, the screen is on and the page is visible.</summary>
    public async Task WaitUntilActiveAsync(CancellationToken ct)
    {
        while (true)
        {
            Task t;
            lock (gate) { if (IsActive) return; t = active.Task; }
            await t.WaitAsync(ct).ConfigureAwait(false);
        }
    }
}
