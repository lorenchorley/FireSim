using System.Runtime.InteropServices;
using Android.App;
using Android.Content;
using Android.Hardware.Display;
using Android.OS;
using Android.Util;
using FsTestApp.Round0;

namespace FsTestApp.App;

/// <summary>Round 0's device facts from the Android APIs, as sections for <see cref="DeviceFactsDocument"/>. Every member is its own <see cref="FactBag.Add"/> (a refused or missing
/// API is recorded in the document's <c>failures</c> and the rest still run). Nothing personal: no serial number, Android ID, IMEI, account, location, accounts, network names,
/// language or time zone. Numbers are written as numbers and text as given (never a localised string). Nothing here has run on a phone before round 0.</summary>
public sealed class AndroidDeviceProbe : IDeviceProbe
{
	public IReadOnlyList<ProbeSection> Sections { get; }

	public AndroidDeviceProbe()
	{
		Sections = new[]
		{
			new ProbeSection("hardware", Hardware),
			new ProbeSection("os", Os),
			new ProbeSection("memory", Memory),
			new ProbeSection("screen", Screen),
			new ProbeSection("battery", Battery),
			new ProbeSection("power", Power),
			new ProbeSection("runtime", RuntimeFacts),
		};
	}

	static Context Ctx => Android.App.Application.Context;

	static void Hardware(FactBag b)
	{
		b.Add("manufacturer", () => Build.Manufacturer);
		b.Add("brand", () => Build.Brand);
		b.Add("model", () => Build.Model);
		b.Add("device", () => Build.Device);
		b.Add("product", () => Build.Product);
		b.Add("hardware", () => Build.Hardware);
		b.Add("board", () => Build.Board);
		b.Add("buildId", () => Build.Id);
		b.Add("buildDisplay", () => Build.Display);
		b.Add("buildType", () => Build.Type);
		b.Add("buildTags", () => Build.Tags);
		b.Add("supportedAbis", () => (IEnumerable<string>?)Build.SupportedAbis);
		b.Add("supported64BitAbis", () => (IEnumerable<string>?)Build.Supported64BitAbis);
		b.Add("supported32BitAbis", () => (IEnumerable<string>?)Build.Supported32BitAbis);
		// the SoC fields are API 31+
		if (Build.VERSION.SdkInt >= BuildVersionCodes.S)
		{
			b.Add("socManufacturer", () => Build.SocManufacturer);
			b.Add("socModel", () => Build.SocModel);
		}
	}

	static void Os(FactBag b)
	{
		b.Add("release", () => Build.VERSION.Release);
		b.Add("sdkInt", () => (int)Build.VERSION.SdkInt);
		b.Add("codename", () => Build.VERSION.Codename);
		b.Add("incremental", () => Build.VERSION.Incremental);
		b.Add("securityPatch", () => Build.VERSION.SecurityPatch);
		b.Add("previewSdkInt", () => Build.VERSION.PreviewSdkInt);
		b.Add("targetSdkOfApp", () => (int?)Ctx.ApplicationInfo?.TargetSdkVersion);
	}

	static void Memory(FactBag b)
	{
		var am = Ctx.GetSystemService(Context.ActivityService) as ActivityManager;
		if (am == null) throw new InvalidOperationException("no ActivityManager");
		using var mi = new ActivityManager.MemoryInfo();
		am.GetMemoryInfo(mi);
		b.Add("totalMb", () => mi.TotalMem / (1024 * 1024));
		b.Add("availableMb", () => mi.AvailMem / (1024 * 1024));
		b.Add("lowMemory", () => mi.LowMemory);
		b.Add("lowMemoryThresholdMb", () => mi.Threshold / (1024 * 1024));
		b.Add("appMemoryClassMb", () => am.MemoryClass);
		b.Add("appLargeMemoryClassMb", () => am.LargeMemoryClass);
		b.Add("isLowRamDevice", () => am.IsLowRamDevice);
	}

	static void Screen(FactBag b)
	{
		var dm = Android.Content.Res.Resources.System?.DisplayMetrics;
		if (dm != null)
		{
			b.Add("widthPx", () => dm.WidthPixels);
			b.Add("heightPx", () => dm.HeightPixels);
			b.Add("densityDpi", () => (int)dm.DensityDpi);
			b.Add("density", () => dm.Density);
			b.Add("xdpi", () => dm.Xdpi);
			b.Add("ydpi", () => dm.Ydpi);
			b.Add("widthDp", () => dm.Density > 0 ? dm.WidthPixels / dm.Density : null);
			b.Add("heightDp", () => dm.Density > 0 ? dm.HeightPixels / dm.Density : null);
		}
		else b.Fail("displayMetrics", new InvalidOperationException("Resources.System.DisplayMetrics is null"));

		var display = (Ctx.GetSystemService(Context.DisplayService) as DisplayManager)?.GetDisplay(0);
		if (display == null) { b.Fail("display", new InvalidOperationException("no default Display from DisplayManager")); return; }
		b.Add("refreshRateHz", () => display.RefreshRate);
		b.Add("supportedModes", () => (IEnumerable<string>?)display.GetSupportedModes()?
			.Select(m => string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{m.PhysicalWidth}x{m.PhysicalHeight}@{m.RefreshRate:0.##}")).ToList());
		b.Add("isHdr", () => display.IsHdr);
	}

	/// <summary>The sticky battery broadcast (needs no permission): temperature, voltage and the like. The percentage and charging state are in the document's <c>state</c>.</summary>
	static void Battery(FactBag b)
	{
		using var filter = new IntentFilter(Intent.ActionBatteryChanged);
		using var sticky = Ctx.RegisterReceiver(null, filter);
		if (sticky == null) throw new InvalidOperationException("no sticky ACTION_BATTERY_CHANGED");
		b.Add("temperatureC", () => { int t = sticky.GetIntExtra(BatteryManager.ExtraTemperature, int.MinValue); return t == int.MinValue ? null : (object)(t / 10.0); });
		b.Add("voltageMv", () => { int v = sticky.GetIntExtra(BatteryManager.ExtraVoltage, -1); return v < 0 ? null : (object)v; });
		b.Add("health", () => sticky.GetIntExtra(BatteryManager.ExtraHealth, 1) switch { 2 => "good", 3 => "overheat", 4 => "dead", 5 => "over-voltage", 6 => "failure", 7 => "cold", _ => "unknown" });
		b.Add("plugged", () => sticky.GetIntExtra(BatteryManager.ExtraPlugged, 0) switch { 0 => "none", 1 => "ac", 2 => "usb", 4 => "wireless", 8 => "dock", var n => "mask " + n });
		b.Add("technology", () => sticky.GetStringExtra(BatteryManager.ExtraTechnology));
		b.Add("present", () => sticky.GetBooleanExtra(BatteryManager.ExtraPresent, true));
	}

	static void Power(FactBag b)
	{
		var pm = Ctx.GetSystemService(Context.PowerService) as PowerManager;
		if (pm == null) throw new InvalidOperationException("no PowerManager");
		b.Add("isInteractive", () => pm.IsInteractive);
		b.Add("isPowerSaveMode", () => pm.IsPowerSaveMode);
		b.Add("isDeviceIdleMode", () => pm.IsDeviceIdleMode);
		b.Add("isSustainedPerformanceModeSupported", () => pm.IsSustainedPerformanceModeSupported);
	}

	static void RuntimeFacts(FactBag b)
	{
		b.Add("dotnet", () => RuntimeInformation.FrameworkDescription);
		b.Add("processArchitecture", () => RuntimeInformation.ProcessArchitecture.ToString());
		b.Add("osArchitecture", () => RuntimeInformation.OSArchitecture.ToString());
		b.Add("is64BitProcess", () => Environment.Is64BitProcess);
		b.Add("processorCount", () => Environment.ProcessorCount);
		b.Add("javaAvailableProcessors", () => Java.Lang.Runtime.GetRuntime()?.AvailableProcessors());
		b.Add("osArch", () => Java.Lang.JavaSystem.GetProperty("os.arch"));
		b.Add("nativeLibraryDir", () => Ctx.ApplicationInfo?.NativeLibraryDir is { } d ? Path.GetFileName(d.TrimEnd('/')) : null);
	}
}
