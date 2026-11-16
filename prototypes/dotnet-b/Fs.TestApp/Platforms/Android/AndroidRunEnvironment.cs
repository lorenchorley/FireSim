using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Android.App;
using Android.OS;
using FsTestApp.Results;
using FsTestApp.Session;

namespace FsTestApp.App;

/// <summary>Build and device facts for the result document. Nothing personal: no accounts, no location, no serial number, no Android ID. Each fact is read in
/// its own try/catch and stays absent when the read fails.</summary>
public sealed class AndroidRunEnvironment : IRunEnvironment
{
	static string? cachedSha;

	public BuildInfo GetBuildInfo()
	{
		string version = Try(() => AppInfo.Current.VersionString) ?? "";
		string commit = version.Contains('+') ? version[(version.IndexOf('+') + 1)..] : "unknown";
		return new BuildInfo
		{
			Configuration = BuildConfig.Configuration,
			Commit = commit,
			ApkSha256 = ApkSha256(),
			ApplicationId = Try(() => AppInfo.Current.PackageName) ?? "",
			AppVersion = version,
			TargetFramework = BuildConfig.TargetFramework,
		};
	}

	/// <summary>SHA-256 of the installed APK (an APK cannot hold its own hash, so it is computed here, once). ApplicationInfo.SourceDir is the base APK.</summary>
	public static string ApkSha256()
	{
		if (cachedSha != null) return cachedSha;
		try
		{
			string? path = Android.App.Application.Context.ApplicationInfo?.SourceDir;
			if (path == null || !File.Exists(path)) return cachedSha = ResultDocument.ApkShaUnavailable;
			using var fs = File.OpenRead(path);
			using var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
			var buf = new byte[256 * 1024];
			int n;
			while ((n = fs.Read(buf, 0, buf.Length)) > 0) h.AppendData(buf, 0, n);
			return cachedSha = Convert.ToHexString(h.GetHashAndReset()).ToLowerInvariant();
		}
		catch (Exception) { return cachedSha = ResultDocument.ApkShaUnavailable; }
	}

	public DeviceFacts GetDeviceFacts()
	{
		var f = new DeviceFacts
		{
			Cores = Math.Max(1, System.Environment.ProcessorCount),
			Dotnet = Try(() => RuntimeInformation.FrameworkDescription),
			ProcessArch = Try(() => RuntimeInformation.ProcessArchitecture.ToString()),
			Manufacturer = Try(() => Build.Manufacturer),
			Model = Try(() => Build.Model),
			ApiLevel = Try<int?>(() => (int)Build.VERSION.SdkInt),
			AndroidRelease = Try(() => Build.VERSION.Release),
			Abis = Try(() => Build.SupportedAbis?.ToList()),
		};
		// the SoC model is API 31+
		if (Build.VERSION.SdkInt >= BuildVersionCodes.S)
			f.Soc = Try(() => string.Join(" ", new[] { Build.SocManufacturer, Build.SocModel }.Where(s => !string.IsNullOrWhiteSpace(s) && s != "unknown")));
		f.RamMb = Try<long?>(() =>
		{
			if (Android.App.Application.Context.GetSystemService(Android.Content.Context.ActivityService) is not ActivityManager am) return null;
			using var mi = new ActivityManager.MemoryInfo();
			am.GetMemoryInfo(mi);
			return mi.TotalMem / (1024 * 1024);
		});
		f.CpuCores = Try(ReadCpuCores);
		var wv = Try(() => Android.Webkit.WebView.CurrentWebViewPackage);
		if (wv != null) f.WebViewVersion = new WebViewVersion { Package = Try(() => wv.PackageName), Version = Try(() => wv.VersionName) };
		return f;
	}

	/// <summary>/sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq: big and little cores show as different maxima. Newer Android versions may refuse the read
	/// (SELinux): then the list stays empty and the document says nothing about it.</summary>
	static List<CpuCore>? ReadCpuCores()
	{
		var list = new List<CpuCore>();
		for (int i = 0; i < 64; i++)
		{
			string dir = $"/sys/devices/system/cpu/cpu{i}";
			if (!Directory.Exists(dir)) break;
			long? max = ReadLong($"{dir}/cpufreq/cpuinfo_max_freq"), min = ReadLong($"{dir}/cpufreq/cpuinfo_min_freq");
			list.Add(new CpuCore { Cpu = i, MaxKhz = max, MinKhz = min });
		}
		return list.Count > 0 && list.Any(c => c.MaxKhz != null) ? list : null;
	}

	static long? ReadLong(string path)
	{
		try { return long.TryParse(File.ReadAllText(path).Trim(), out var v) ? v : null; }
		catch (Exception) { return null; }
	}

	static T? Try<T>(Func<T> f)
	{
		try { return f(); } catch (Exception) { return default; }
	}
}
