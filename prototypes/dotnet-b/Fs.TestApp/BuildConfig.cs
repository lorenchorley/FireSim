using System.Reflection;
using FsTestApp.Sending;

namespace FsTestApp.App;

/// <summary>Values the build put into assembly metadata (see Fs.TestApp.csproj and README.md). Endpoint, upload code and results repository are empty
/// unless the build was given them: nothing secret is in the repository, and a build without them says so on screen.</summary>
public static class BuildConfig
{
	static readonly Dictionary<string, string> meta = Read();

	static Dictionary<string, string> Read()
	{
		var d = new Dictionary<string, string>(StringComparer.Ordinal);
		try
		{
			foreach (var a in typeof(BuildConfig).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>())
				if (a.Key != null) d[a.Key] = a.Value ?? "";
		}
		catch (Exception) { /* leave it empty: the defaults below apply */ }
		return d;
	}

	static string Get(string key) => meta.TryGetValue(key, out var v) ? v.Trim() : "";

	public static int Round => int.TryParse(Get("ProtoRound"), out var r) && r >= 0 ? r : 0;
	public static string Configuration => Get("Configuration") is { Length: > 0 } c ? c : "Release";
	public static string TargetFramework => Get("TargetFramework");
	public static ResultsConfig Results => new(Get("ProtoEndpoint"), Get("ProtoUploadCode"), Get("ProtoGitHubRepo"));

	public static string RoundName => Round switch
	{
		0 => "link check",
		1 => "speed",
		2 => "pictures",
		3 => "one app",
		4 => "saved data",
		_ => "test",
	};
}
