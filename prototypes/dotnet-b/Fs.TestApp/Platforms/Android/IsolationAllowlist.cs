using Android.Runtime;
using FsTestApp.Results;
using Java.Lang;
using Java.Lang.Reflect;
using Exception = System.Exception;

namespace FsTestApp.App;

/// <summary>AndroidX WebKit 1.18's cross-origin-isolated allowlist, called through Java reflection.
///
/// Why reflection: there is no Xamarin/AndroidX NuGet binding of androidx.webkit 1.18 (Xamarin.AndroidX.Webkit stops at 1.17.1, checked on nuget.org 2026-11-16, and
/// MAUI does not reference it). The Fs.TestApp.csproj therefore adds the Google Maven artifact androidx.webkit:webkit:1.18.0 as an unbound Java library (its classes go into
/// the APK's dex, no C# binding is generated) and these few calls reach it by name. The calls are
///   WebViewFeature.isFeatureSupported(WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST)
///   WebViewCompat.getProfile(webView).setCrossOriginIsolatedAllowlist(Set&lt;String&gt; origins)
/// (androidx.webkit 1.18.0 public API: Profile.getCrossOriginIsolatedAllowlist / setCrossOriginIsolatedAllowlist, found by reading the 1.18.0 AAR's classes with javap).
/// Everything is guarded; the outcome, with any exception text, goes into the result document (webView.allowlist) so round 0 shows what happened. Nothing here is verified
/// on a phone: the container has no emulator.</summary>
internal static class IsolationAllowlist
{
	public static AllowlistFacts Apply(Android.Webkit.WebView webView, string origin)
	{
		var facts = new AllowlistFacts { Origin = origin };
		try
		{
			using var featureClass = Class.ForName("androidx.webkit.WebViewFeature");
			facts.LibraryPresent = true;
			using var stringClass = Class.ForName("java.lang.String");
			using var isSupported = featureClass.GetMethod("isFeatureSupported", stringClass);

			string allowlistFeature = FeatureName(featureClass, "CROSS_ORIGIN_ISOLATED_ALLOWLIST");
			facts.FeatureSupported = Supported(isSupported, allowlistFeature);
			if (facts.FeatureSupported != true) return facts;

			// WebViewCompat.getProfile needs the multi-profile feature
			string multiProfile = FeatureName(featureClass, "MULTI_PROFILE");
			if (!Supported(isSupported, multiProfile))
			{
				facts.Error = "WebViewFeature.MULTI_PROFILE not supported: no Profile to set the allowlist on";
				return facts;
			}

			using var compat = Class.ForName("androidx.webkit.WebViewCompat");
			using var webViewClass = Class.FromType(typeof(Android.Webkit.WebView));
			using var getProfile = compat.GetMethod("getProfile", webViewClass);
			using var profile = getProfile.Invoke(null, webView);
			if (profile == null) { facts.Error = "getProfile returned null"; return facts; }

			using var profileClass = Class.ForName("androidx.webkit.Profile");
			using var setClass = Class.ForName("java.util.Set");
			using var setAllowlist = profileClass.GetMethod("setCrossOriginIsolatedAllowlist", setClass);
			using var origins = new Java.Util.HashSet();
			origins.Add(new Java.Lang.String(origin));
			setAllowlist.Invoke(profile, origins);
			facts.Applied = true;
		}
		catch (ClassNotFoundException e) { facts.Error = "androidx.webkit 1.18 classes not in the APK: " + e.Message; }
		catch (InvocationTargetException e) { facts.Error = "call threw: " + (e.Cause?.ToString() ?? e.Message); }
		catch (Exception e) { facts.Error = e.GetType().Name + ": " + e.Message; }
		if (facts.Error is { Length: > 1000 }) facts.Error = facts.Error[..1000];
		return facts;
	}

	static string FeatureName(Class featureClass, string field)
	{
		using var f = featureClass.GetField(field);
		using var v = f.Get(null);
		return v?.ToString() ?? "";
	}

	static bool Supported(Method isSupported, string feature)
	{
		using var arg = new Java.Lang.String(feature);
		using var r = isSupported.Invoke(null, arg);
		return r != null && r.JavaCast<Java.Lang.Boolean>().BooleanValue();
	}
}
