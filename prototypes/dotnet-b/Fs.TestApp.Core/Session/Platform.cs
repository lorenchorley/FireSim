using FsTestApp.Results;

namespace FsTestApp.Session;

/// <summary>What the app knows about itself and the phone. The Android implementation (Fs.TestApp) wraps every platform call in a guard; anything it cannot
/// read stays null in the document. Called once at the start of a run.</summary>
public interface IRunEnvironment
{
    BuildInfo GetBuildInfo();
    DeviceFacts GetDeviceFacts();
}

public sealed record UninstallOutcome(string Outcome, string? Detail);

/// <summary>The things that need an Activity or an Intent: kept behind an interface so the session logic runs in the container.</summary>
public interface IPlatformActions
{
    /// <summary>Opens an address in the phone's browser. Returns false if nothing could open it.</summary>
    Task<bool> OpenUrlAsync(string url);
    /// <summary>Shares the saved document as a file (FileProvider, ACTION_SEND). Returns an error text or null.</summary>
    Task<string?> ShareFileAsync(string documentPath, string title);
    /// <summary>ACTION_DELETE on package:&lt;id&gt;, falling back to the App info page. Records which one opened.</summary>
    UninstallOutcome OpenUninstall(string applicationId);
}

/// <summary>The fixed texts of plan section 5, in one place so a test can pin them.</summary>
public static class ScreenText
{
    public static string First(int minutes) =>
        $"This is a test build of FireSim. It measures this phone and sends the numbers to the developer. It does not change your FireSim app. It takes about {minutes} {(minutes == 1 ? "minute" : "minutes")}. Keep this screen open.";

    public static string Done(string time, string receipt) => $"Done. Results sent at {time} (receipt: {receipt}). You can uninstall this test app now.";

    public const string DoneNotSent = "Done. The results are saved on this phone but have not been sent yet. Use Send now, Send with GitHub or Share. You can uninstall this test app after they are sent.";

    public const string NoNetwork = "Turn the network back on to send the results.";

    public static int Minutes(double estimatedSeconds)
    {
        // plus about 15 % for the gate waits and the hand-offs; never less than one minute
        return Math.Max(1, (int)Math.Ceiling(estimatedSeconds * 1.15 / 60.0));
    }
}
