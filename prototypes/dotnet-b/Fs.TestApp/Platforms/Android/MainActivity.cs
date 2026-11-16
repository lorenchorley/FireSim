using Android.App;
using Android.Content.PM;

namespace FsTestApp.App;

/// <summary>Raises the foreground/background transitions that the pause monitor of Fs.TestApp.Core watches (plan section 5: OnPause/OnResume).</summary>
public static class AndroidLifecycle
{
	static volatile bool foreground = true;
	public static bool IsForeground => foreground;
	public static event Action<bool>? ForegroundChanged;

	public static void Raise(bool isForeground)
	{
		foreground = isForeground;
		try { ForegroundChanged?.Invoke(isForeground); }
		catch (Exception) { /* a subscriber's failure must never crash the activity */ }
	}
}

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop,
	ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
	protected override void OnPause()
	{
		base.OnPause();
		AndroidLifecycle.Raise(false);
	}

	protected override void OnResume()
	{
		base.OnResume();
		AndroidLifecycle.Raise(true);
	}
}
