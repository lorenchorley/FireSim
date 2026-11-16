using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using FsTestApp.Arms;
using FsTestApp.Results;

namespace FsTestApp.App;

[JsonSerializable(typeof(string))]
internal sealed partial class HostJsonContext : JsonSerializerContext { }

/// <summary>The browser side of the test app: a HybridWebView that loads Resources/Raw/wwwroot/index.html and the arm host script (arm-host.js).
///
/// C# to page: <c>fsRunArm(name, argsJson, runId)</c> (global function in the page, returns the arm's result as a JSON string), <c>fsCancelArm(runId)</c> and
/// <c>fsProbe()</c>, each called with HybridWebView.InvokeJavaScriptAsync (string arguments only, so one source-generated serializer for string covers everything).
/// Page to C#: <c>HybridWebView.SendRawMessage(json)</c> with <c>{"t":"ready"}</c>, <c>{"t":"progress","id":..,"f":0..1,"text":..}</c> and
/// <c>{"t":"visibility","hidden":bool}</c>; nothing else crosses (no InvokeDotNet, so no reflection-based dispatch and nothing for the trimmer to remove).
///
/// Cross-origin isolation (plan T0.5): MAUI's own asset path sends only Content-Type, so the app answers requests for its own page files itself, from the
/// HybridWebView's WebResourceRequested event, with <c>Document-Isolation-Policy: isolate-and-require-corp</c>; the framework's internal paths (_framework/hybridwebview.js,
/// the invoke and message endpoints) are never touched. The AndroidX WebKit 1.18 allowlist for the app origin is set when the native WebView exists, before it loads the page.
/// Neither is verified on a phone here: the page reports what it got (crossOriginIsolated, SharedArrayBuffer) and round 0 shows whether it worked.</summary>
public sealed class ArmHost
{
	public const string AppOrigin = "https://0.0.0.1";
	public const string IsolationHeaderName = "Document-Isolation-Policy";
	public const string IsolationHeaderValue = "isolate-and-require-corp";

	static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
	{
		[".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".mjs"] = "text/javascript; charset=utf-8",
		[".css"] = "text/css; charset=utf-8", [".json"] = "application/json; charset=utf-8", [".wasm"] = "application/wasm",
		[".svg"] = "image/svg+xml", [".map"] = "application/json; charset=utf-8", [".txt"] = "text/plain; charset=utf-8",
	};

	readonly HashSet<string> served;
	readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
	readonly Dictionary<string, Action<double, string?>> progressSinks = new();
	readonly object gate = new();
	int runCounter;
	int headerResponses;

	public HybridWebView View { get; }
	public AllowlistFacts? Allowlist { get; private set; }
	public bool IsReady => ready.Task.IsCompletedSuccessfully;
	public bool IsolationHeaderSent => Volatile.Read(ref headerResponses) > 0;
	public string? LastStatus { get; private set; }
	/// <summary>True after the page said it is hidden, false after it said visible.</summary>
	public event Action<bool>? PageVisibilityChanged;

	/// <param name="servedFiles">Files under wwwroot (paths relative to it) that the app serves with the isolation header. A later round that adds bundles lists them here.</param>
	public ArmHost(IEnumerable<string>? servedFiles = null)
	{
		served = new HashSet<string>(servedFiles ?? new[] { "index.html", "arm-host.js" }, StringComparer.Ordinal);
		View = new HybridWebView { HybridRoot = "wwwroot", DefaultFile = "index.html", HeightRequest = 96, HorizontalOptions = LayoutOptions.Fill };
		View.WebViewInitialized += OnInitialized;
		View.WebResourceRequested += OnWebResourceRequested;
		View.RawMessageReceived += OnRawMessage;
	}

	void OnInitialized(object? sender, WebViewInitializedEventArgs e)
	{
		try
		{
			var native = e.PlatformArgs?.Sender;
			Allowlist = native == null
				? new AllowlistFacts { Error = "no native WebView in the initialized event" }
				: IsolationAllowlist.Apply(native, AppOrigin);
		}
		catch (Exception ex) { Allowlist = new AllowlistFacts { Error = ex.GetType().Name + ": " + ex.Message }; }
	}

	void OnWebResourceRequested(object? sender, WebViewWebResourceRequestedEventArgs e)
	{
		try
		{
			if (!string.Equals(e.Method, "GET", StringComparison.OrdinalIgnoreCase)) return;
			string path = Uri.UnescapeDataString(e.Uri.AbsolutePath).TrimStart('/');
			if (path.Length == 0) path = "index.html";
			if (path.StartsWith("_framework/", StringComparison.Ordinal) || path.StartsWith("__hwv", StringComparison.Ordinal)) return;   // the framework's own bridge
			if (!served.Contains(path)) return;                                                                                            // anything else: MAUI's default handling
			string ext = Path.GetExtension(path);
			if (!ContentTypes.TryGetValue(ext, out var contentType)) return;

			var headers = new Dictionary<string, string>
			{
				["Content-Type"] = contentType,
				[IsolationHeaderName] = IsolationHeaderValue,
				["Cross-Origin-Resource-Policy"] = "same-origin",
				["Cache-Control"] = "no-store",
			};
			e.SetResponse(200, "OK", headers, OpenAsset("wwwroot/" + path));
			e.Handled = true;
			Interlocked.Increment(ref headerResponses);
		}
		catch (Exception) { /* leave the request to MAUI's default handling: the page still loads, just without the header */ }
	}

	static async Task<Stream?> OpenAsset(string logicalName) => await FileSystem.OpenAppPackageFileAsync(logicalName);

	void OnRawMessage(object? sender, HybridWebViewRawMessageReceivedEventArgs e)
	{
		try
		{
			if (JsonNode.Parse(e.Message ?? "") is not JsonObject o) return;
			switch ((string?)o["t"])
			{
				case "ready": ready.TrySetResult(); break;
				case "visibility": PageVisibilityChanged?.Invoke((bool?)o["hidden"] ?? false); break;
				case "status": LastStatus = (string?)o["text"]; break;
				case "progress":
					{
						string id = (string?)o["id"] ?? "";
						Action<double, string?>? sink;
						lock (gate) progressSinks.TryGetValue(id, out sink);
						sink?.Invoke(Math.Clamp((double?)o["f"] ?? 0, 0, 1), (string?)o["text"]);
						break;
					}
			}
		}
		catch (Exception) { /* a malformed message from the page is ignored */ }
	}

	public async Task<bool> WaitReadyAsync(TimeSpan timeout, CancellationToken ct)
	{
		try { await ready.Task.WaitAsync(timeout, ct).ConfigureAwait(false); return true; }
		catch (TimeoutException) { return false; }
	}

	static Task<string?> CallPage(HybridWebView view, string function, params string[] args)
	{
		var s = HostJsonContext.Default.String;
		var infos = new JsonTypeInfo[args.Length];
		Array.Fill(infos, s);
		return MainThread.InvokeOnMainThreadAsync(() => view.InvokeJavaScriptAsync<string>(function, s, args.Cast<object?>().ToArray(), infos));
	}

	/// <summary>What the page says about itself and what the app did to give it shared memory.</summary>
	public async Task<WebViewFacts> ProbeAsync(CancellationToken ct)
	{
		var facts = new WebViewFacts
		{
			PageReported = false, IsolationHeaderSent = IsolationHeaderSent, IsolationHeaderValue = IsolationHeaderValue, Allowlist = Allowlist,
		};
		try
		{
			string? json = await CallPage(View, "fsProbe").WaitAsync(TimeSpan.FromSeconds(20), ct).ConfigureAwait(false);
			if (JsonNode.Parse(json ?? "") is JsonObject o)
			{
				facts.PageReported = true;
				facts.Origin = (string?)o["origin"];
				facts.CrossOriginIsolated = (bool?)o["crossOriginIsolated"];
				facts.SharedArrayBuffer = (string?)o["sharedArrayBuffer"];
				facts.UserAgent = Trim((string?)o["userAgent"], 512);
				facts.Extra = o["extra"] as JsonObject is { } ex ? (JsonObject)JsonNode.Parse(ex.ToJsonString())! : null;
			}
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
		catch (Exception e)
		{
			facts.Extra = new JsonObject { ["probeError"] = Trim(e.GetType().Name + ": " + e.Message, 300) };
		}
		facts.IsolationHeaderSent = IsolationHeaderSent;
		facts.Allowlist = Allowlist;
		return facts;
	}

	/// <summary>Runs one named arm in the page. The token cancels it (the page stops at its next yield). The result is the arm's JSON.</summary>
	public async Task<JsonNode> RunArmAsync(string name, JsonObject? args, IProgress<ArmProgress> progress, TimeSpan timeout, CancellationToken ct)
	{
		if (!IsReady) throw new InvalidOperationException("the WebView page did not report ready: browser-side arms cannot run");
		string id = "r" + Interlocked.Increment(ref runCounter);
		lock (gate) progressSinks[id] = (f, text) => progress.Report(new ArmProgress(f, text));
		try
		{
			var call = CallPage(View, "fsRunArm", name, args?.ToJsonString() ?? "{}", id);
			using var reg = ct.Register(() => { _ = CallPage(View, "fsCancelArm", id); });
			string? json;
			try { json = await call.WaitAsync(timeout, ct).ConfigureAwait(false); }
			catch (TimeoutException)
			{
				_ = CallPage(View, "fsCancelArm", id);
				throw new TimeoutException($"arm '{name}' did not answer within {timeout.TotalSeconds:0} s");
			}
			ct.ThrowIfCancellationRequested();
			var node = JsonNode.Parse(json ?? "null") ?? throw new InvalidOperationException("the page returned no result");
			if (node is JsonObject o && o["cancelled"] is JsonValue cv && cv.TryGetValue<bool>(out var cancelled) && cancelled) throw new OperationCanceledException("cancelled in the page");
			if (node is JsonObject eo && eo["error"] is JsonValue ev && ev.TryGetValue<string>(out var err)) throw new InvalidOperationException("page arm failed: " + err);
			return node;
		}
		finally { lock (gate) progressSinks.Remove(id); }
	}

	static string? Trim(string? s, int max) => s == null ? null : s.Length <= max ? s : s[..max];
}

/// <summary>An arm that runs in the page (WebView V8). Name must match an entry of <c>fsArms</c> in arm-host.js.</summary>
public sealed class WebArm : IArm
{
	readonly ArmHost host;
	readonly JsonObject? args;
	public WebArm(ArmHost host, string name, double estimatedSeconds, JsonObject? args = null, string runtime = RuntimeNames.V8WebView)
	{
		this.host = host; Name = name; EstimatedSeconds = estimatedSeconds; this.args = args; Runtime = runtime;
	}
	public string Name { get; }
	public double EstimatedSeconds { get; }
	public string Runtime { get; }
	public Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
		=> host.RunArmAsync(Name, args, progress, TimeSpan.FromSeconds(EstimatedSeconds * 4 + 30), ct);
}
