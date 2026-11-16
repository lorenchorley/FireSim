using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FsResults;

namespace Fs.Results.Tests;

/// <summary>What reaches GitHub: the title built from validated fields, fixed labels, and a body whose only client text is inside one fence that nothing in it can close,
/// with no mention, no #123 and no URL that GitHub would link. Hostile strings go into every client field.</summary>
[TestClass]
public sealed class IssueTests
{
    static readonly Regex TitleShape = new(@"^Round \d{1,2} result: [A-Za-z0-9 _-]{1,40} \([0-9a-f]{8}\)$", RegexOptions.CultureInvariant);

    static readonly string[] Hostile =
    {
        "plain",
        "```",
        "``````````````````````````````````````````````````",
        "x`y``z```w````v`````u",
        "``` \n``` end fence ``` \n# heading\n@org/team please look",
        "@org/team",
        "@someuser @@double user@example.com \\@escaped",
        "see #1 and #123 and GH-1 and org/repo#9 and https://evil.example/path?x=1 and www.evil.example and ftp://x",
        "line1\nline2\r\nline3\ttab\0nul\u0007bell\u001b[31mred\u007f",
        "bidi \u202E reversed \u2066 isolate \u200B zero\u200Dwidth \uFEFF bom",
        "emoji \U0001F525 and \u00E9\u00E8 and \u65E5\u672C",
        "<script>alert(1)</script> <img src=x onerror=1> &amp; &lt;",
        "[link](https://evil.example) ![img](https://evil.example/x.png) <https://evil.example>",
        "\\\"quote\\\" and \\u0040 and \\\\ end",
        "| table | row |\n|---|---|\n> quote\n- list\n1. numbered",
    };

    // ---- the fence ----

    [TestMethod]
    [DataRow("", 3)]
    [DataRow("no ticks", 3)]
    [DataRow("`", 3)]
    [DataRow("``", 3)]
    [DataRow("```", 4)]
    [DataRow("a```b`````c", 6)]
    [DataRow("`` ``` ```````` `", 9)]
    public void The_fence_is_longer_than_any_backtick_run_it_wraps(string text, int expected)
    {
        string fence = IssueFormatter.FenceFor(text);
        Assert.AreEqual(expected, fence.Length);
        Assert.IsTrue(fence.All(c => c == '`'));
        Assert.IsGreaterThan(IssueFormatter.LongestRun(text, '`'), fence.Length);
    }

    [TestMethod]
    public void Backticks_in_the_document_are_escaped_and_the_fence_still_exceeds_every_run()
    {
        var doc = Harness.RichDoc();
        doc["device"]!["model"] = "A``` B````````````` C";
        doc["errors"]![0]!["message"] = new string('`', 200);
        var d = IssueFormatter.Format(doc);
        var (fenceLine, content, _) = Split(d.Body);
        Assert.IsGreaterThan(IssueFormatter.LongestRun(content, '`'), fenceLine.TakeWhile(c => c == '`').Count());
        Assert.AreEqual(0, IssueFormatter.LongestRun(content, '`'), "the encoder writes a backtick as \\u0060, so none is left to meet the fence");
        AssertRoundTrips(content, doc);
    }

    // ---- title and labels ----

    [TestMethod]
    public void The_title_is_built_from_the_round_a_sanitised_model_and_a_short_id()
    {
        var doc = Harness.RichDoc();
        doc["round"] = 7;
        doc["runId"] = "abcdef0123456789abcdef0123456789";
        doc["device"]!["model"] = "Pixel 8 Pro";
        var d = IssueFormatter.Format(doc);
        Assert.AreEqual("Round 7 result: Pixel 8 Pro (abcdef01)", d.Title);
        CollectionAssert.AreEqual(new[] { "bench-result" }, d.Labels.ToArray());
    }

    [TestMethod]
    public void A_hostile_model_never_reaches_the_title_except_as_ascii_words()
    {
        foreach (string hostile in Hostile.Append(new string('A', 5000)).Append("").Append("   ").Append("@@@###```").Append("\u65E5\u672C\u8A9E"))
        {
            var doc = Harness.RichDoc();
            doc["device"]!["model"] = hostile;
            var d = IssueFormatter.Format(doc);
            Assert.IsTrue(TitleShape.IsMatch(d.Title), $"title '{d.Title}' for model '{Escape(hostile)}'");
            Assert.IsFalse(d.Title.Contains('@') || d.Title.Contains('#') || d.Title.Contains('`') || d.Title.Contains("://") || d.Title.Contains('.'));
        }
        var none = Harness.RichDoc();
        none["device"]!.AsObject().Remove("model");
        StringAssert.Contains(IssueFormatter.Format(none).Title, "unknown device");
    }

    [TestMethod]
    [DataRow("Pixel 8 Pro", "Pixel 8 Pro")]
    [DataRow("SM-G991B", "SM-G991B")]
    [DataRow("Moto G (2024)", "Moto G 2024")]
    [DataRow("a  b\tc\nd", "a b c d")]
    [DataRow("@org/team", "org team")]
    [DataRow("#1", "1")]
    [DataRow("", "unknown device")]
    public void Model_sanitising(string model, string expected) => Assert.AreEqual(expected, IssueFormatter.SanitiseModel(model));

    // ---- hostile strings in every client field, through the whole endpoint ----

    [TestMethod]
    public async Task Hostile_strings_in_every_client_field_are_refused_or_made_safe()
    {
        var paths = Harness.StringLeafPaths(Harness.RichDoc()).ToList();
        Assert.IsGreaterThan(40, paths.Count, "the rich document should reach every string field of the schema");

        int accepted = 0, refused = 0;
        int n = 100;
        foreach (var path in paths)
        {
            foreach (string hostile in Hostile.Append(new string('x', 20_000)).Append(string.Concat(Enumerable.Repeat("long line with `ticks` @org/team #1 ", 400))))
            {
                var h = new Harness();
                var doc = Harness.RichDoc();
                Harness.SetAt(doc, path, hostile);
                var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), doc["idempotencyKey"] is JsonValue v && v.TryGetValue<string>(out var k) ? k : "x");
                string where = string.Join("/", path) + " <- " + Escape(hostile.Length > 60 ? hostile[..60] : hostile);
                n++;

                Assert.IsTrue(r.Status is 201 or 400, where + ": " + r.Status + " " + r.Json);
                if (r.Status == 400)
                {
                    refused++;
                    Assert.IsTrue(r.Json is "{\"error\":\"bad_schema\"}" or "{\"error\":\"bad_key\"}" or "{\"error\":\"key_mismatch\"}", where + ": " + r.Json);
                    Assert.HasCount(0, h.GitHub.Calls, where);
                    continue;
                }
                accepted++;
                Assert.HasCount(1, h.GitHub.Calls, where);
                AssertSafeIssue(h.GitHub.Calls[0], where);
            }
        }
        Assert.IsGreaterThan(300, accepted, "many free-text fields must be accepted, or this test proves little");
        Assert.IsGreaterThan(20, refused, "pattern- and enum-constrained fields must refuse hostile text");
    }

    [TestMethod]
    public async Task Hostile_property_names_in_free_form_objects_are_made_safe()
    {
        foreach (string hostile in Hostile)
        {
            var h = new Harness();
            var doc = Harness.RichDoc();
            doc["arms"]![0]!["result"] = new JsonObject { [hostile] = 1, ["ok"] = new JsonObject { [hostile + "2"] = hostile } };
            doc["webView"]!["extra"] = new JsonObject { [hostile] = hostile };
            var r = await h.PostDocAsync(doc);
            Assert.AreEqual(201, r.Status, Escape(hostile) + ": " + r.Json);
            AssertSafeIssue(h.GitHub.Calls[0], Escape(hostile));
        }
    }

    [TestMethod]
    public async Task A_long_line_cannot_push_the_body_over_githubs_limit()
    {
        // 24 KB on the wire (two bytes per character) that become six-character \uXXXX escapes in the issue: 72,000 characters, over the cut
        var h = new Harness();
        var doc = Harness.RichDoc();
        doc["arms"]![0]!["result"] = new JsonObject { ["text"] = new string('\u00E9', 12_000) };
        var wire = Encoding.UTF8.GetBytes(doc.ToJsonString(new System.Text.Json.JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        Assert.IsLessThan(65_536, wire.Length);
        var r = await h.PostAsync(wire, Harness.KeyOf(doc));
        Assert.AreEqual(201, r.Status, r.Json);
        var call = h.GitHub.Calls[0];
        Assert.IsLessThan(65_000, call.Body.Length);
        var (_, _, outside) = Split(call.Body);
        StringAssert.Contains(call.Body, "The document was cut at");
        AssertSafeIssue(call, "long", mayBeTruncated: true);
        Assert.IsFalse(outside.Contains('#'));
    }

    [TestMethod]
    public void A_document_under_the_limit_is_in_the_body_whole_and_equal_to_what_was_sent()
    {
        var doc = Harness.RichDoc();
        doc["errors"]![0]!["message"] = "multi\nline `code` @org/team #1 https://x.example";
        var d = IssueFormatter.Format(doc);
        Assert.IsFalse(d.Truncated);
        var (_, content, _) = Split(d.Body);
        AssertRoundTrips(content, doc);
        StringAssert.Contains(content, "\\u0040org/team");
    }

    // ---- invariants ----

    static void AssertSafeIssue(FakeGitHub.Call call, string where, bool mayBeTruncated = false)
    {
        Assert.IsTrue(TitleShape.IsMatch(call.Title), where + ": title " + call.Title);
        CollectionAssert.AreEqual(new[] { "bench-result" }, call.Labels.ToArray(), where);
        Assert.IsLessThan(65_000, call.Body.Length, where);

        foreach (char c in call.Body)
            Assert.IsTrue(c is '\n' or (>= ' ' and < (char)127), where + ": the body holds a character outside printable ASCII: U+" + ((int)c).ToString("X4"));
        Assert.IsFalse(call.Body.Contains('@'), where + ": an @ is left in the body");

        var (fenceLine, content, outside) = Split(call.Body);
        // the fence is longer than any backtick run in the content, and the content has no line that could close it
        Assert.IsGreaterThan(IssueFormatter.LongestRun(content, '`'), fenceLine.TakeWhile(c => c == '`').Count(), where);
        // outside the fence: only the server's own sentences, with nothing GitHub would link or format
        Assert.IsFalse(outside.Contains('#') || outside.Contains("http", StringComparison.OrdinalIgnoreCase) || outside.Contains("www", StringComparison.OrdinalIgnoreCase)
            || outside.Contains('@') || outside.Contains('<') || outside.Contains('['), where + ": client text outside the fence: " + outside);
        StringAssert.StartsWith(outside.TrimStart(), "Result from a test APK, round", where);
        if (!mayBeTruncated) AssertRoundTripsLoosely(content, where);
    }

    static void AssertRoundTripsLoosely(string content, string where)
    {
        var parsed = JsonNode.Parse(content);
        Assert.IsInstanceOfType<JsonObject>(parsed, where + ": the fenced text is not a JSON document");
    }

    /// <summary>The fenced text parses back to the document that was sent: neutralising the mentions did not change the data.</summary>
    static void AssertRoundTrips(string content, JsonObject original)
    {
        var parsed = JsonNode.Parse(content);
        Assert.IsTrue(JsonNode.DeepEquals(original, parsed), "the document in the fence differs from the document that was sent");
    }

    /// <summary>Splits an issue body into its opening fence line, the fenced content and the text outside the fence (before and after).</summary>
    static (string FenceLine, string Content, string Outside) Split(string body)
    {
        string[] lines = body.Split('\n');
        int open = Array.FindIndex(lines, l => Regex.IsMatch(l, "^`{3,}json$"));
        Assert.IsGreaterThanOrEqualTo(0, open, "no opening fence");
        string fence = lines[open][..^4];
        int close = Array.FindLastIndex(lines, l => l == fence);
        Assert.IsGreaterThan(open, close, "no closing fence");
        for (int i = open + 1; i < close; i++) Assert.IsFalse(lines[i].StartsWith(fence, StringComparison.Ordinal), "a content line could close the fence");
        string content = string.Join("\n", lines[(open + 1)..close]);
        string outside = string.Join("\n", lines[..open].Concat(lines[(close + 1)..]));
        return (lines[open], content, outside);
    }

    static string Escape(string s) => string.Concat(s.Select(c => c is >= ' ' and < (char)127 ? c.ToString() : "\\u" + ((int)c).ToString("x4")));
}
