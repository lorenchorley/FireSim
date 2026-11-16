using System.Runtime.InteropServices;
using System.Text.Json;
using FsTransport.Bench;
using Microsoft.JSInterop;

namespace FsTransport;

/// <summary>What the measurement page may ask of the .NET side. The same public methods are the target of HybridWebView.InvokeDotNet
/// (reflection on public methods) and of Blazor JS interop ([JSInvokable] on an instance via DotNetObjectReference).
/// Arguments and results are plain strings/numbers: the page parses the JSON strings itself.</summary>
public sealed class HostApi
{
    readonly string kind;                                    // "hybrid" or "blazor"
    readonly Func<string, Runner.Sender?> senderFor;         // transport name -> picture sender for this page
    readonly Dictionary<int, Task<RunStats>> runs = new();
    readonly Dictionary<int, CancellationTokenSource> cancels = new();
    readonly object gate = new();

    public HostApi(string kind, Func<string, Runner.Sender?> senderFor) { this.kind = kind; this.senderFor = senderFor; }

    [JSInvokable]
    public string GetInfo()
    {
        var o = new Dictionary<string, object?>
        {
            ["host"] = kind,
            ["platform"] = DeviceInfo.Platform.ToString(),
            ["manufacturer"] = DeviceInfo.Manufacturer,
            ["model"] = DeviceInfo.Model,
            ["osVersion"] = DeviceInfo.VersionString,
            ["apiLevel"] = (int)Android.OS.Build.VERSION.SdkInt,
            ["runtime"] = RuntimeInformation.FrameworkDescription,
            ["processArch"] = RuntimeInformation.ProcessArchitecture.ToString(),
            ["cores"] = Environment.ProcessorCount,
            ["webViewPackage"] = Android.Webkit.WebView.CurrentWebViewPackage?.PackageName,
            ["webViewVersion"] = Android.Webkit.WebView.CurrentWebViewPackage?.VersionName,
            ["mixedContentMode"] = Preferences.Default.Get("mixed", "never"),
            ["wsServer"] = "TcpListener + WebSocket.CreateFromStream (Kestrel has no Android runtime pack)",
            ["wsPort"] = Services.Ws.Port,
            ["wsLastOrigin"] = Services.Ws.LastOrigin,
            ["wsConnections"] = Services.Ws.Connections,
            ["debugBuild"] =
#if DEBUG
                true,
#else
                false,
#endif
        };
        try
        {
            var am = (Android.App.ActivityManager?)Android.App.Application.Context.GetSystemService(Android.Content.Context.ActivityService);
            var mi = new Android.App.ActivityManager.MemoryInfo();
            am?.GetMemoryInfo(mi);
            o["deviceRamMB"] = mi.TotalMem / 1048576;
            o["lowMemory"] = mi.LowMemory;
        }
        catch { }
        return JsonSerializer.Serialize(o);
    }

    [JSInvokable]
    public string GetWsInfo() => JsonSerializer.Serialize(new WsInfo { Port = Services.Ws.Port, Token = Services.Ws.Token, Server = "loopback" }, BenchJson.Default.WsInfo);

    [JSInvokable]
    public double Ping() => Pattern.NowEpochMs();

    /// <summary>Starts a run in the background and returns "ok" (or an error text). The pictures arrive in the page by the transport named in the config.</summary>
    [JSInvokable]
    public string StartRun(string cfgJson)
    {
        try
        {
            var cfg = JsonSerializer.Deserialize(cfgJson, BenchJson.Default.RunConfig)!;
            if (cfg.SizeBytes < 64 || cfg.SizeBytes > 64_000_000 || cfg.Rate <= 0 || cfg.DurationS <= 0 || cfg.DurationS > 600) return "error: bad config";
            var sender = senderFor(cfg.Transport);
            if (sender == null) return "error: unknown transport " + cfg.Transport;
            var cts = new CancellationTokenSource();
            lock (gate)
            {
                runs[cfg.RunId] = Task.Run(() => Runner.RunAsync(cfg, sender, cts.Token));
                cancels[cfg.RunId] = cts;
            }
            return "ok";
        }
        catch (Exception e) { return "error: " + e.Message; }
    }

    /// <summary>"" while running, otherwise the RunStats JSON.</summary>
    [JSInvokable]
    public string GetRunResult(int runId)
    {
        Task<RunStats>? t;
        lock (gate) runs.TryGetValue(runId, out t);
        if (t == null) return "error: no such run";
        if (!t.IsCompleted) return "";
        if (t.IsFaulted) return "error: " + t.Exception!.GetBaseException().Message;
        return JsonSerializer.Serialize(t.Result, BenchJson.Default.RunStats);
    }

    [JSInvokable]
    public string CancelRun(int runId)
    {
        lock (gate) { if (cancels.TryGetValue(runId, out var c)) c.Cancel(); }
        return "ok";
    }

    [JSInvokable]
    public async Task<string> CopyText(string text)
    {
        try { await MainThread.InvokeOnMainThreadAsync(() => Clipboard.Default.SetTextAsync(text)); return "ok"; }
        catch (Exception e) { return "error: " + e.Message; }
    }

    /// <summary>Writes the JSON where adb can fetch it without root: /sdcard/Android/data/au.firesim.transport/files/</summary>
    [JSInvokable]
    public string SaveJson(string name, string json)
    {
        try
        {
            var dir = Android.App.Application.Context.GetExternalFilesDir(null)?.AbsolutePath ?? FileSystem.AppDataDirectory;
            var safe = new string(name.Where(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.').ToArray());
            var path = Path.Combine(dir, safe.Length > 0 ? safe : "results.json");
            File.WriteAllText(path, json);
            return path;
        }
        catch (Exception e) { return "error: " + e.Message; }
    }
}

/// <summary>Process-wide pieces: the loopback WebSocket server (started once) and the app origins it accepts.</summary>
public static class Services
{
    static LoopbackWsServer? ws;
    public static LoopbackWsServer Ws => ws ??= new LoopbackWsServer(new[] { "https://0.0.0.0", "https://localhost" });
}
