using System.Text;
using System.Text.Json.Nodes;
using FsTestApp.Results;

namespace FsTestApp.Sending;

public sealed record GitHubUrlResult(string Url, int Level, string Body, int EncodedBodyChars);

/// <summary>The fallback channel of plan section 5: a prefilled new-issue address that the phone's browser opens. GitHub answers 414 to long addresses and
/// percent-encoding makes JSON 1.5 to 3 times longer, so the cap is on the finished address, after encoding (6 KB: <see cref="DefaultMaxChars"/>). The summary
/// degrades level by level (details, then arm lines, then counts, then identity only, then a hard cut) until the address fits, and always starts with the
/// idempotency key so the orchestrator can match the issue to the full document that arrives by Share. The body is a fenced code block: the text comes from
/// a phone and is data, so it must not render as Markdown or mention anyone.</summary>
public static class GitHubIssueUrl
{
    public const int DefaultMaxChars = 6 * 1024;
    public const string Label = "bench-result";
    const string Fence = "```";

    public static GitHubUrlResult Build(string repo, ResultDocument doc, int maxChars = DefaultMaxChars)
    {
        if (!IsRepo(repo)) throw new ArgumentException("repo must look like owner/name", nameof(repo));
        string prefix = $"https://github.com/{repo}/issues/new?title=";
        string title = Enc($"Test result r{doc.Round} {Clean(doc.Device.Model ?? "device", 40)} {doc.RunId[..Math.Min(8, doc.RunId.Length)]}");
        string head = prefix + title + "&labels=" + Enc(Label) + "&body=";
        int budget = maxChars - head.Length;
        if (budget < 150) throw new ArgumentOutOfRangeException(nameof(maxChars), "cap too small for even the identity summary");

        for (int level = 0; level <= 4; level++)
        {
            string text = Summary(doc, level);
            string body = Wrap(text);
            string enc = Enc(body);
            if (enc.Length <= budget) return new GitHubUrlResult(head + enc, level, body, enc.Length);
        }

        // hard cut of the level-4 text (it is small, so this only happens with a tiny cap): keep the head, the key first
        string core = Summary(doc, 4);
        int lo = 0, hi = core.Length;
        while (lo < hi)
        {
            int mid = (lo + hi + 1) / 2;
            string candidate = Wrap(Cut(core, mid) + "\n... truncated");
            if (Enc(candidate).Length <= budget) lo = mid; else hi = mid - 1;
        }
        string cutBody = Wrap(Cut(core, lo) + "\n... truncated");
        string cutEnc = Enc(cutBody);
        return new GitHubUrlResult(head + cutEnc, 5, cutBody, cutEnc.Length);
    }

    public static bool IsRepo(string repo)
    {
        int slash = repo.IndexOf('/');
        if (slash <= 0 || slash == repo.Length - 1 || repo.IndexOf('/', slash + 1) >= 0) return false;
        return repo.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '/');
    }

    static string Enc(string s) => Uri.EscapeDataString(s);
    static string Wrap(string text) => Fence + "text\n" + text + "\n" + Fence;

    static string Cut(string s, int length)
    {
        if (length >= s.Length) return s;
        if (length > 0 && char.IsHighSurrogate(s[length - 1])) length--;
        return s[..length];
    }

    /// <summary>Plain text for printing in a code fence: no control characters, no fence, no line over 300 characters.</summary>
    static string Clean(string s, int max)
    {
        var sb = new StringBuilder(Math.Min(s.Length, max));
        foreach (char c in s)
        {
            if (sb.Length >= max) break;
            sb.Append(char.IsControl(c) || c == '`' ? ' ' : c);
        }
        return sb.ToString();
    }

    public static string Summary(ResultDocument doc, int level)
    {
        var sb = new StringBuilder();
        // identity first: truncation can never cut it off
        sb.Append("key: ").Append(Clean(doc.IdempotencyKey, 120)).Append('\n');
        sb.Append("kind: ").Append(ResultDocument.KindValue).Append(" v").Append(doc.SchemaVersion).Append('\n');
        sb.Append("round: ").Append(doc.Round).Append(" status: ").Append(doc.Status).Append('\n');
        if (level >= 4) { sb.Append("(summary reduced to fit the address; the full document comes by Share)"); return sb.ToString(); }
        sb.Append("build: ").Append(Clean(doc.Build.Configuration, 12)).Append(' ').Append(Clean(doc.Build.Commit, 20)).Append(' ').Append(Clean(doc.Build.AppVersion, 60)).Append('\n');
        sb.Append("device: ").Append(Clean($"{doc.Device.Manufacturer} {doc.Device.Model} soc={doc.Device.Soc} api={doc.Device.ApiLevel} cores={doc.Device.Cores}", 160)).Append('\n');
        sb.Append("webview: ").Append(Clean(doc.Device.WebViewVersion?.Version ?? "?", 40));
        if (doc.WebView is { } w) sb.Append(" coi=").Append(w.CrossOriginIsolated?.ToString() ?? "?").Append(" sab=").Append(w.SharedArrayBuffer ?? "?");
        sb.Append('\n');
        var c = doc.Conditions;
        sb.Append("start: battery=").Append(c.BatteryStartPercent?.ToString() ?? "?").Append(" charging=").Append(c.ChargingAtStart?.ToString() ?? "?")
          .Append(" thermal=").Append(c.ThermalAtStart ?? "?").Append(" airplane=").Append(c.AirplaneMode?.ToString() ?? "?").Append('\n');
        int ok = doc.Arms.Count(a => a.Status == ArmStatus.Ok), err = doc.Arms.Count(a => a.Status == ArmStatus.Error), paused = doc.Arms.Count(a => a.Status == ArmStatus.Paused);
        sb.Append("counts: blocks=").Append(doc.Blocks.Count).Append(" arms ok=").Append(ok).Append(" error=").Append(err).Append(" paused=").Append(paused)
          .Append(" pauses=").Append(doc.Logs.Pauses.Count).Append(" errors=").Append(doc.Errors.Count).Append('\n');
        if (level >= 3) return sb.ToString();

        sb.Append("arms:\n");
        foreach (var a in doc.Arms)
        {
            sb.Append("- b").Append(a.Block).Append('.').Append(a.BlockAttempt).Append(' ').Append(Clean(a.Name, 60)).Append(' ').Append(a.Runtime).Append(' ').Append(a.Status)
              .Append(' ').Append(Math.Round(a.DurationMs / 1000.0, 2).ToString(System.Globalization.CultureInfo.InvariantCulture)).Append(" s");
            if (level <= 1 && a.Result != null)
            {
                int cap = level == 0 ? 300 : 100;
                sb.Append(" ").Append(Clean(Compact(a.Result), cap));
            }
            if (a.Error != null) sb.Append(" error=").Append(Clean(a.Error, level == 0 ? 160 : 60));
            sb.Append('\n');
        }
        if (level == 0 && doc.Errors.Count > 0)
        {
            sb.Append("errors:\n");
            foreach (var e in doc.Errors.Take(5)) sb.Append("- ").Append(Clean(e.Where + ": " + e.Message, 200)).Append('\n');
        }
        return sb.ToString();
    }

    static string Compact(JsonNode n) => n.ToJsonString();
}
