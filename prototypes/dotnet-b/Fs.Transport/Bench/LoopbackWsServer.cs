// Loopback WebSocket server for transport (c). Why not Kestrel: the .NET 11 SDK marks the ASP.NET Core shared framework as having NO
// runtime pack for Android (Microsoft.NETCoreSdk.BundledVersions.props: RuntimePackExcludedRuntimeIdentifiers="android;linux-bionic"), so
// Kestrel cannot be referenced by a MAUI Android app. This server uses only the base class library (TcpListener, SHA1 and
// System.Net.WebSockets.WebSocket.CreateFromStream), which runs on Android. The desktop Harness uses the very same class.
//
// Security of the prototype (a phone's 127.0.0.1 is reachable by other apps):
//  * binds 127.0.0.1 only (never 0.0.0.0);
//  * the upgrade request must carry ?t=TOKEN, a random 128-bit value created at start-up and given only to our own page through the host API;
//  * an Origin allow-list exists (EnforceOrigin) but is off in the prototype; the Origin actually sent is recorded in LastOrigin;
//  * one run at a time per connection; frames are only ever sent to a connection that sent a valid start command.
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FsTransport.Bench;

public sealed class LoopbackWsServer : IDisposable
{
    readonly TcpListener listener;
    readonly CancellationTokenSource cts = new();
    readonly HashSet<string> allowedOrigins;
    public int Port { get; }
    public string Token { get; }
    public int Connections;
    public string LastOrigin = "";
    /// <summary>Off by default in the prototype: the token is the gate, and a wrong guess of the WebView's Origin string would fail the test for the wrong reason. LastOrigin records what the WebView really sends.</summary>
    public bool EnforceOrigin;
    public int Rejected;

    public LoopbackWsServer(IEnumerable<string> allowedOrigins, int port = 0)
    {
        this.allowedOrigins = new HashSet<string>(allowedOrigins, StringComparer.OrdinalIgnoreCase);
        Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start(8);
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoop);
    }

    async Task AcceptLoop()
    {
        while (!cts.IsCancellationRequested)
        {
            TcpClient c;
            try { c = await listener.AcceptTcpClientAsync(cts.Token).ConfigureAwait(false); }
            catch { break; }
            _ = Task.Run(() => Serve(c));
        }
    }

    async Task Serve(TcpClient client)
    {
        try
        {
            client.NoDelay = true;
            client.SendBufferSize = 1 << 20;
            client.ReceiveBufferSize = 1 << 20;
            var stream = client.GetStream();
            var req = await ReadHeader(stream).ConfigureAwait(false);
            if (req == null) { Reject(client, 400); return; }
            var lines = req.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
            var first = lines[0].Split(' ');
            if (first.Length < 2 || first[0] != "GET") { Reject(client, 405); return; }
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var l in lines.Skip(1)) { int i = l.IndexOf(':'); if (i > 0) headers[l[..i].Trim()] = l[(i + 1)..].Trim(); }
            if (!headers.TryGetValue("Upgrade", out var up) || !up.Equals("websocket", StringComparison.OrdinalIgnoreCase) || !headers.TryGetValue("Sec-WebSocket-Key", out var key)) { Reject(client, 400); return; }
            if (!first[1].Contains("t=" + Token, StringComparison.Ordinal)) { Reject(client, 403); return; }
            if (headers.TryGetValue("Origin", out var origin)) { LastOrigin = origin; if (EnforceOrigin && !allowedOrigins.Contains(origin)) { Reject(client, 403); return; } }
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            var resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(resp), cts.Token).ConfigureAwait(false);
            Interlocked.Increment(ref Connections);
            using var ws = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions { IsServer = true, KeepAliveInterval = TimeSpan.FromSeconds(30) });
            await Session(ws).ConfigureAwait(false);
        }
        catch { /* a dropped client is not an error for the prototype */ }
        finally { try { client.Dispose(); } catch { } }
    }

    static void Reject(TcpClient c, int code)
    {
        try { c.GetStream().Write(Encoding.ASCII.GetBytes($"HTTP/1.1 {code} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")); } catch { }
        c.Dispose();
    }

    static async Task<string?> ReadHeader(NetworkStream s)
    {
        var buf = new byte[8192]; int n = 0;
        while (n < buf.Length)
        {
            int r = await s.ReadAsync(buf.AsMemory(n, buf.Length - n)).ConfigureAwait(false);
            if (r <= 0) return null;
            n += r;
            if (n >= 4 && Encoding.ASCII.GetString(buf, 0, n).Contains("\r\n\r\n")) return Encoding.ASCII.GetString(buf, 0, n);
        }
        return null;
    }

    async Task Session(WebSocket ws)
    {
        var rx = new byte[4096];
        CancellationTokenSource? runCts = null;
        Task<RunStats>? run = null;
        while (ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
        {
            var r = await ws.ReceiveAsync(rx, cts.Token).ConfigureAwait(false);
            if (r.MessageType == WebSocketMessageType.Close) break;
            if (r.MessageType != WebSocketMessageType.Text || !r.EndOfMessage) continue;
            using var doc = JsonDocument.Parse(rx.AsMemory(0, r.Count));
            var root = doc.RootElement;
            var cmd = root.GetProperty("cmd").GetString();
            if (cmd == "ping")
            {
                var o = $"{{\"type\":\"pong\",\"t0\":{root.GetProperty("t0").GetDouble():R},\"server\":{Pattern.NowEpochMs():R}}}";
                await ws.SendAsync(Encoding.UTF8.GetBytes(o), WebSocketMessageType.Text, true, cts.Token).ConfigureAwait(false);
            }
            else if (cmd == "start" && run == null)
            {
                var cfg = new RunConfig
                {
                    Transport = "ws", SizeBytes = root.GetProperty("sizeBytes").GetInt32(), Rate = root.GetProperty("rate").GetDouble(),
                    DurationS = root.GetProperty("durationS").GetDouble(), RunId = root.GetProperty("runId").GetInt32()
                };
                if (cfg.SizeBytes < 64 || cfg.SizeBytes > 64_000_000 || cfg.Rate <= 0 || cfg.DurationS <= 0 || cfg.DurationS > 600) continue;
                runCts = CancellationTokenSource.CreateLinkedTokenSource(cts.Token);
                run = Task.Run(async () =>
                {
                    var stats = await Runner.RunAsync(cfg, async (pic, seq, ct) =>
                    {
                        await ws.SendAsync(pic, WebSocketMessageType.Binary, true, ct).ConfigureAwait(false);
                        return true;
                    }, runCts.Token).ConfigureAwait(false);
                    var json = JsonSerializer.Serialize(stats, BenchJson.Default.RunStats);
                    var msg = "{\"type\":\"done\",\"stats\":" + json + "}";
                    if (ws.State == WebSocketState.Open) await ws.SendAsync(Encoding.UTF8.GetBytes(msg), WebSocketMessageType.Text, true, CancellationToken.None).ConfigureAwait(false);
                    return stats;
                });
            }
            else if (cmd == "cancel") { runCts?.Cancel(); }
        }
        runCts?.Cancel();
        if (run != null) { try { await run.ConfigureAwait(false); } catch { } }
    }

    public void Dispose() { cts.Cancel(); try { listener.Stop(); } catch { } }
}
