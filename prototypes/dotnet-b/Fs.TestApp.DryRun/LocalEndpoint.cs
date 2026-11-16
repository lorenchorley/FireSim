using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using FsTestApp.Results;

namespace FsTestApp.DryRun;

public enum EndpointBehavior
{
    /// <summary>Validate, store (once per key), answer.</summary>
    Accept,
    /// <summary>Store the result, then never answer: the phone cannot tell whether it arrived (the lost-answer case).</summary>
    StoreThenDrop,
    /// <summary>Answer 500 without storing.</summary>
    ServerError,
    /// <summary>Answer 429 without storing.</summary>
    TooManyRequests,
}

/// <summary>An in-process stand-in for T0.6a's endpoint (Fs.Results), with the contract the app's <c>HttpResultsSender</c> documents: it checks the upload
/// code, the idempotency key against the document, the size limit and the schema, stores one result per key, and answers with an issue number.
/// A different, real implementation (the Azure Function) must keep to the same contract.</summary>
public sealed class LocalEndpoint : IDisposable
{
    readonly HttpListener listener = new();
    readonly CancellationTokenSource cts = new();
    readonly Task loop;
    int nextIssue = 17;
    int requestCount;

    public string Url { get; }
    public string UploadCode { get; }
    /// <summary>Request number (1-based) to behaviour; default Accept.</summary>
    public Func<int, EndpointBehavior> Script { get; set; } = _ => EndpointBehavior.Accept;
    /// <summary>One entry per stored key: the document text and its issue number.</summary>
    public ConcurrentDictionary<string, (string Body, int Issue)> Stored { get; } = new();
    public ConcurrentQueue<string> Log { get; } = new();
    /// <summary>How long a StoreThenDrop request stays unanswered; must be longer than the client's timeout.</summary>
    public TimeSpan StoreThenDropSilence { get; set; } = TimeSpan.FromMilliseconds(1500);
    public int Requests => Volatile.Read(ref requestCount);

    public LocalEndpoint(string uploadCode)
    {
        UploadCode = uploadCode;
        int port;
        using (var probe = new TcpListener(IPAddress.Loopback, 0)) { probe.Start(); port = ((IPEndPoint)probe.LocalEndpoint).Port; }
        Url = $"http://127.0.0.1:{port}/results";
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        loop = Task.Run(LoopAsync);
    }

    async Task LoopAsync()
    {
        while (!cts.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try { ctx = await listener.GetContextAsync().ConfigureAwait(false); }
            catch (Exception) { break; }
            _ = Task.Run(() => HandleAsync(ctx));
        }
    }

    async Task HandleAsync(HttpListenerContext ctx)
    {
        int n = Interlocked.Increment(ref requestCount);
        var behaviour = Script(n);
        try
        {
            string key = ctx.Request.Headers["Idempotency-Key"] ?? "";
            string code = ctx.Request.Headers["X-Upload-Code"] ?? "";
            string body;
            using (var sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8)) body = sr.ReadToEnd();
            Log.Enqueue($"#{n} {ctx.Request.HttpMethod} key={(key.Length > 12 ? key[..12] : key)}... bytes={Encoding.UTF8.GetByteCount(body)} behaviour={behaviour}");

            if (behaviour == EndpointBehavior.ServerError) { Reply(ctx, 500, "{\"error\":\"boom\"}"); return; }
            if (behaviour == EndpointBehavior.TooManyRequests) { Reply(ctx, 429, "{\"error\":\"slow down\"}"); return; }
            if (code != UploadCode) { Reply(ctx, 401, "{\"error\":\"bad upload code\"}"); return; }
            if (Encoding.UTF8.GetByteCount(body) > ResultDocument.MaxPostBytes) { Reply(ctx, 413, "{\"error\":\"too large\"}"); return; }
            var errors = ResultValidator.Validate(body);
            if (errors.Count > 0) { Reply(ctx, 400, "{\"error\":\"schema: " + Json(errors[0].ToString()) + "\"}"); return; }
            var doc = ResultJsonContext.Deserialize(body)!;
            if (doc.IdempotencyKey != key) { Reply(ctx, 400, "{\"error\":\"key does not match document\"}"); return; }

            bool added = false;
            var entry = Stored.GetOrAdd(key, _ => { added = true; return (body, Interlocked.Increment(ref nextIssue) - 1); });
            if (behaviour == EndpointBehavior.StoreThenDrop)
            {
                // HttpListener.Response.Abort() before any byte is written makes the managed listener answer 200 with an empty body, which is not a lost
                // answer; so stay silent for longer than the phone waits, then drop. The phone sees a timeout, as it would on a bad mobile link.
                await Task.Delay(StoreThenDropSilence).ConfigureAwait(false);
                ctx.Response.Abort();
                return;
            }
            Reply(ctx, added ? 201 : 200, $"{{\"issue\":{entry.Issue},\"url\":\"https://github.com/example/results/issues/{entry.Issue}\",\"duplicate\":{(added ? "false" : "true")}}}");
        }
        catch (Exception e) { Log.Enqueue($"#{n} handler error {e.GetType().Name}"); try { ctx.Response.Abort(); } catch { } }
    }

    static string Json(string s) => s.Replace("\\", "\\\\").Replace("\"", "'");

    static void Reply(HttpListenerContext ctx, int status, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json";
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
        ctx.Response.Close();
    }

    public void Dispose()
    {
        cts.Cancel();
        try { listener.Stop(); listener.Close(); } catch { }
        try { loop.Wait(1000); } catch { }
    }
}
