using System.Text.Json.Nodes;
using FsTestApp.Arms;
using FsTestApp.Round0;

namespace FsTestApp.App;

/// <summary>Round 0, arm (b): the WebView facts. The page part (round0-arms.js, <c>webview-facts</c>) runs in the WebView; the native part (what the app did to get shared memory,
/// the WebView package) is added here and a plain-words explanation is built by <see cref="WebViewFactsMerge"/>. If the page never answers, the native part is still recorded, with
/// <c>pageError</c>, so the one document says why.</summary>
public sealed class WebViewFactsArm : IArm
{
	readonly ArmHost host;
	readonly WebArm page;

	public WebViewFactsArm(ArmHost host)
	{
		this.host = host;
		page = new WebArm(host, Round0Plan.WebViewFactsName, EstimatedSeconds);
	}

	public string Name => Round0Plan.WebViewFactsName;
	public double EstimatedSeconds => 6;
	public string Runtime => RuntimeNames.V8WebView;

	public async Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
	{
		JsonNode? answer = null;
		string? pageError = null;
		try { answer = await page.RunAsync(progress, ct).ConfigureAwait(false); }
		catch (OperationCanceledException) { throw; }
		catch (Exception e) { pageError = e.GetType().Name + ": " + e.Message; }

		string? package = null, version = null;
		try
		{
			var wv = Android.Webkit.WebView.CurrentWebViewPackage;
			package = wv?.PackageName;
			version = wv?.VersionName;
		}
		catch (Exception) { /* recorded as absent: device.webViewVersion has the same fact */ }

		var native = new NativeWebFacts(host.Allowlist, host.IsolationHeaderSent, ArmHost.IsolationHeaderValue, ArmHost.AppOrigin, package, version, host.IsReady);
		var merged = WebViewFactsMerge.Merge(answer, native);
		if (pageError != null) merged["pageError"] = pageError;
		return merged;
	}
}

/// <summary>Round 0, arm (c): the frozen speed-test kernels in a WebView worker, three runs. The page reports raw numbers and checksums; <see cref="KernelChecks"/> judges them here
/// (both checksums on every run, medians, ratios against the app's reference). If the worker cannot be started the arm fails with the reasons (no numbers are invented).</summary>
public sealed class KernelsArm : IArm
{
	readonly WebArm page;

	public KernelsArm(ArmHost host, int runs = 3)
	{
		page = new WebArm(host, Round0Plan.KernelsName, EstimatedSeconds, new JsonObject { ["runs"] = runs });
	}

	public string Name => Round0Plan.KernelsName;
	/// <summary>Each run is about 2 s of timed work plus 0.5 s of checksum sweeps in a desktop's V8; a phone is slower, so 15 s for three runs with the worker starts.</summary>
	public double EstimatedSeconds => 15;
	public string Runtime => RuntimeNames.V8WebView;

	public async Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
		=> KernelChecks.Annotate(await page.RunAsync(progress, ct).ConfigureAwait(false));
}
