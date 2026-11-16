using Android.Content;
using Android.Provider;
using FsTestApp.Session;
using AApp = Android.App.Application;

namespace FsTestApp.App;

/// <summary>The three buttons that need an Intent: open the GitHub address, Share a file, Uninstall. Each is one simple documented call inside try/catch; the
/// outcome is returned (and recorded by the session) instead of thrown.</summary>
public sealed class AndroidPlatformActions : IPlatformActions
{
	public async Task<bool> OpenUrlAsync(string url)
	{
		try
		{
			if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps) return false;
			return await MainThread.InvokeOnMainThreadAsync(() => Launcher.Default.OpenAsync(uri));
		}
		catch (Exception) { return false; }
	}

	/// <summary>Shares the saved document as a file through MAUI Essentials' FileProvider, whose authority is <c>${applicationId}.fileProvider</c> (so two test
	/// apps never collide; the built manifest is checked in reports/0-apk-check.md). The file is copied to the cache directory first, which that provider serves.</summary>
	public async Task<string?> ShareFileAsync(string documentPath, string title)
	{
		try
		{
			string dir = Path.Combine(FileSystem.CacheDirectory, "share");
			Directory.CreateDirectory(dir);
			string copy = Path.Combine(dir, Path.GetFileName(documentPath));
			File.Copy(documentPath, copy, overwrite: true);
			await MainThread.InvokeOnMainThreadAsync(() => Share.Default.RequestAsync(new ShareFileRequest { Title = title, File = new ShareFile(copy, "application/json") }));
			return null;
		}
		catch (Exception e) { return e.GetType().Name + ": " + e.Message; }
	}

	/// <summary>ACTION_DELETE on package:&lt;id&gt; (not deprecated, unlike ACTION_UNINSTALL_PACKAGE), with REQUEST_DELETE_PACKAGES in the manifest. If no activity
	/// handles it, or it throws, the App info page opens instead (ACTION_APPLICATION_DETAILS_SETTINGS), where Uninstall is one tap away.</summary>
	public UninstallOutcome OpenUninstall(string applicationId)
	{
		Context ctx = (Context?)Platform.CurrentActivity ?? AApp.Context;
		var pkg = Android.Net.Uri.Parse("package:" + applicationId)!;
		try
		{
			var delete = new Intent(Intent.ActionDelete, pkg);
			delete.AddFlags(ActivityFlags.NewTask);
			ctx.StartActivity(delete);
			return new UninstallOutcome("uninstall-screen-opened", null);
		}
		catch (ActivityNotFoundException e)
		{
			return OpenAppInfo(ctx, pkg, "ACTION_DELETE: " + e.Message);
		}
		catch (Exception e)
		{
			return OpenAppInfo(ctx, pkg, "ACTION_DELETE: " + e.GetType().Name + ": " + e.Message);
		}
	}

	static UninstallOutcome OpenAppInfo(Context ctx, Android.Net.Uri pkg, string why)
	{
		try
		{
			var info = new Intent(Settings.ActionApplicationDetailsSettings, pkg);
			info.AddFlags(ActivityFlags.NewTask);
			ctx.StartActivity(info);
			return new UninstallOutcome("app-info-opened", why);
		}
		catch (ActivityNotFoundException e) { return new UninstallOutcome("failed", why + "; app info: " + e.Message); }
		catch (Exception e) { return new UninstallOutcome("failed", why + "; app info: " + e.GetType().Name + ": " + e.Message); }
	}
}
