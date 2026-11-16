using FsTestApp.Arms;
using FsTestApp.Results;
using FsTestApp.Runner;
using FsTestApp.Sending;
using FsTestApp.Session;
using FsTestApp.Storage;

namespace FsTestApp.App;

/// <summary>The one screen of the test app (code only, no XAML): first-screen text and a 10-second countdown with Not now, progress while it runs, then the Done
/// screen with Send now, Send with GitHub, Share and Uninstall. The texts of plan section 5 come from <see cref="ScreenText"/>, which the tests pin.
/// All state comes from <see cref="TestSession"/>; this page only draws it and forwards taps.</summary>
public sealed class TestPage : ContentPage
{
	readonly TestSession session;
	readonly ArmHost host;
	readonly IPlatformActions actions = new AndroidPlatformActions();
	readonly Label title = new() { FontSize = 20, FontAttributes = FontAttributes.Bold, TextColor = Colors.White };
	readonly Label main = new() { FontSize = 22, TextColor = Colors.White };
	readonly Label detail = new() { FontSize = 16, TextColor = Color.FromArgb("#FFCDD2") };
	readonly ProgressBar bar = new() { ProgressColor = Colors.White, IsVisible = false };
	readonly Button notNow = new() { Text = "Not now", IsVisible = false };
	readonly Button start = new() { Text = "Start", IsVisible = false };
	readonly Button sendNow = new() { Text = "Send now", IsVisible = false };
	readonly Button github = new() { Text = "Send with GitHub", IsVisible = false };
	readonly Button share = new() { Text = "Share", IsVisible = false };
	readonly Button uninstall = new() { Text = "Uninstall", IsVisible = false };
	readonly Label webLabel = new() { Text = "Page host:", FontSize = 12, TextColor = Colors.White, IsVisible = true };
	bool keepOnSet;

	public TestPage()
	{
		BackgroundColor = Color.FromArgb("#B71C1C");
		var device = new AndroidDeviceState();
		var cfg = BuildConfig.Results;
		var store = new FileResultStore(Path.Combine(FileSystem.AppDataDirectory, "results"));
		var sender = new HttpResultsSender(cfg, new HttpClient());
		host = new ArmHost();
		var plan = StubPlan.Build(host);
		session = new TestSession(plan, device, new AndroidRunEnvironment(), store, sender, cfg, SystemClock.Instance) { BeforeRun = PrepareWebViewAsync };
		session.Changed += snap => MainThread.BeginInvokeOnMainThread(() => Render(snap));
		host.PageVisibilityChanged += hidden => session.NotifyWebViewVisibility(!hidden);

		title.Text = $"FireSim TEST r{BuildConfig.Round}";
		notNow.Clicked += (_, _) => session.NotNow();
		start.Clicked += (_, _) => session.StartNow();
		sendNow.Clicked += async (_, _) => await Guarded(async () => { sendNow.IsEnabled = false; try { await session.SendNowAsync(); } finally { sendNow.IsEnabled = true; } });
		github.Clicked += async (_, _) => await Guarded(OnGitHub);
		share.Clicked += async (_, _) => await Guarded(OnShare);
		uninstall.Clicked += (_, _) => OnUninstall();

		var buttons = new VerticalStackLayout { Spacing = 10, Children = { notNow, start, sendNow, github, share, uninstall } };
		Content = new ScrollView
		{
			Content = new VerticalStackLayout
			{
				Padding = new Thickness(20, 40, 20, 20), Spacing = 16,
				Children = { title, main, bar, detail, buttons, webLabel, host.View },
			},
		};
		main.Text = session.FirstScreenText;
		Loaded += async (_, _) => await Guarded(StartAsync);
	}

	async Task StartAsync()
	{
		SetKeepOn(true);
		await session.RunAsync(CancellationToken.None);
	}

	async Task PrepareWebViewAsync(RunLog log, CancellationToken ct)
	{
		bool ready = await host.WaitReadyAsync(TimeSpan.FromSeconds(20), ct);
		if (!ready) log.AddError("webview", "the HybridWebView page did not report ready within 20 s: browser-side arms will fail");
		log.Document.WebView = await host.ProbeAsync(ct);
		if (!log.Document.WebView.PageReported) log.AddError("webview", "the page did not answer the probe");
	}

	// ---- drawing ----
	void Render(SessionSnapshot s)
	{
		bool done = s.Phase is SessionPhase.Done or SessionPhase.Failed;
		bool hasReceipt = s.Receipt != null;
		notNow.IsVisible = s.Phase == SessionPhase.Countdown;
		start.IsVisible = s.Phase == SessionPhase.NotNow;
		sendNow.IsVisible = s.Phase == SessionPhase.Done && !hasReceipt;
		github.IsVisible = s.Phase == SessionPhase.Done && !hasReceipt;
		share.IsVisible = s.Phase == SessionPhase.Done;
		uninstall.IsVisible = s.Phase == SessionPhase.Done;
		bar.IsVisible = s.Phase == SessionPhase.Running && s.Runner != null;
		if (done) SetKeepOn(false);

		switch (s.Phase)
		{
			case SessionPhase.Intro:
			case SessionPhase.Countdown:
			case SessionPhase.NotNow:
				main.Text = session.FirstScreenText;
				detail.Text = s.Phase == SessionPhase.Countdown ? $"Starting in {s.CountdownSeconds} s. Tap Not now to wait." : s.Phase == SessionPhase.NotNow ? s.Message : "";
				break;
			case SessionPhase.Running:
				{
					var r = s.Runner;
					main.Text = r == null ? "Running. Keep this screen open." : r.Phase switch
					{
						"paused" => "Paused. Come back to this app to go on.",
						"gate" => r.Text ?? "Letting the phone settle before the next block.",
						_ => $"Running block {r.BlockIndex + 1} of {r.BlockCount}. Keep this screen open.",
					};
					if (r != null)
					{
						bar.Progress = Math.Clamp((r.BlockIndex + (r.Phase == "running" ? r.ArmFraction : 0)) / Math.Max(1, r.BlockCount), 0, 1);
						string retry = r.Attempt > 1 ? $" (try {r.Attempt}: the last one was interrupted, so this block runs again)" : "";
						detail.Text = $"{r.BlockName}{(r.ArmName != null ? " - " + r.ArmName : "")}{retry}. {TimeLeft(r.SecondsLeft)}";
					}
					else detail.Text = s.Message;
					break;
				}
			case SessionPhase.Saving:
			case SessionPhase.Sending:
				main.Text = s.WaitingForNetwork ? ScreenText.NoNetwork : s.Message;
				detail.Text = s.WaitingForNetwork ? "The results are saved on this phone and go out when the network is back." : "";
				break;
			case SessionPhase.Done:
				main.Text = s.DoneLine ?? ScreenText.DoneNotSent;
				detail.Text = string.Join("\n", new[] { s.PreviousUninstallNote, string.IsNullOrEmpty(s.Message) ? null : s.Message, BuildConfig.Results.HasEndpoint ? null : "This build has no results endpoint set." }.Where(t => !string.IsNullOrEmpty(t)));
				break;
			case SessionPhase.Failed:
				main.Text = s.Message;
				detail.Text = "";
				break;
		}
		webLabel.Text = "Page host: " + (host.LastStatus ?? (host.IsReady ? "ready" : "loading"));
	}

	static string TimeLeft(double seconds)
		=> seconds < 45 ? "Less than a minute left." : $"About {Math.Ceiling(seconds / 60)} min left.";

	void SetKeepOn(bool on)
	{
		if (keepOnSet == on) return;
		keepOnSet = on;
		try { MainThread.BeginInvokeOnMainThread(() => { try { DeviceDisplay.Current.KeepScreenOn = on; } catch (Exception) { } }); } catch (Exception) { }
	}

	// ---- buttons ----
	async Task OnGitHub()
	{
		var url = session.BuildGitHubUrl();
		if (url == null) { detail.Text = "This build has no results repository set, so there is no GitHub address. Use Share."; return; }
		bool ok = await actions.OpenUrlAsync(url.Url);
		if (ok) session.RecordGitHubOpened();
		detail.Text = ok ? "GitHub is open in your browser. Tap Submit there (signed in to GitHub)." : "Could not open the browser. Use Share instead.";
	}

	async Task OnShare()
	{
		string? path = session.Snapshot.SavedPath;
		if (path == null) { detail.Text = "Nothing is saved to share."; return; }
		string? err = await actions.ShareFileAsync(path, "FireSim test result");
		if (err == null) session.RecordShared(); else detail.Text = "Could not share: " + err;
	}

	void OnUninstall()
	{
		string id = AppInfo.Current.PackageName;
		var o = actions.OpenUninstall(id);
		session.RecordUninstall(o);
		detail.Text = o.Outcome switch
		{
			"uninstall-screen-opened" => "Confirm on the system screen. If it did not appear: Settings > Apps > " + AppInfo.Current.Name + " > Uninstall.",
			"app-info-opened" => "The App info page is open. Tap Uninstall there.",
			_ => "Could not open either screen. Uninstall it from Settings > Apps > " + AppInfo.Current.Name + ".",
		};
	}

	async Task Guarded(Func<Task> action)
	{
		try { await action(); }
		catch (Exception e) { detail.Text = "Something went wrong: " + e.GetType().Name + ": " + e.Message; }
	}
}

/// <summary>The arms of this build: stubs (a native one and a browser one, ordered A B B A). T0.6b replaces them with round 0's real arms, T2.1 adds round 1's.</summary>
public static class StubPlan
{
	public static TestPlan Build(ArmHost host)
	{
		var native = new SlowFakeArm(SystemClock.Instance, steps: 10, stepDelay: TimeSpan.FromMilliseconds(200), name: "stub-native");
		var web = new WebArm(host, "web-stub", estimatedSeconds: 2);
		return new TestPlan(BuildConfig.Round, BuildConfig.RoundName, BlockPlan.AbBa(native, web));
	}
}
