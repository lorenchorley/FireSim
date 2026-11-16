namespace FsTestApp.App;

/// <summary>A last-resort note of an unhandled exception, kept across launches. Nothing in this app has run on Android before round 0, so a crash before the result document exists
/// would otherwise leave nothing at all: the exception is written to a small file in the app's private folder, and the next launch shows it on the first screen and records it in
/// the result document's errors. Never throws.</summary>
public static class CrashNote
{
	const string FileName = "last-crash.txt";

	static string PathOf() => Path.Combine(FileSystem.AppDataDirectory, FileName);

	public static void Install()
	{
		try
		{
			AppDomain.CurrentDomain.UnhandledException += (_, e) => Write("unhandled", e.ExceptionObject as Exception, e.ExceptionObject?.ToString());
			TaskScheduler.UnobservedTaskException += (_, e) => Write("unobserved task", e.Exception, null);
		}
		catch (Exception) { /* the handlers are a convenience */ }
	}

	static void Write(string kind, Exception? e, string? fallback)
	{
		try
		{
			string text = $"{kind}: {e?.GetType().FullName}: {e?.Message}\n{e?.StackTrace ?? fallback}";
			if (text.Length > 3000) text = text[..3000];
			File.WriteAllText(PathOf(), text);
		}
		catch (Exception) { /* nothing more can be done */ }
	}

	/// <summary>The note left by the previous launch (and removes it), or null.</summary>
	public static string? TakePrevious()
	{
		try
		{
			string p = PathOf();
			if (!File.Exists(p)) return null;
			string text = File.ReadAllText(p);
			File.Delete(p);
			return text;
		}
		catch (Exception) { return null; }
	}
}
