using FsResults;

namespace Fs.Results.Tests;

[TestClass]
public sealed class CodesAndSettingsTests
{
    static readonly DateTimeOffset Now = new(2026, 11, 20, 0, 0, 0, TimeSpan.Zero);

    static UploadCodeEntry Entry(string code, int round = 0, int daysLeft = 10) => new(code, round, Now.AddDays(daysLeft));

    [TestMethod]
    public void The_check_hashes_and_compares_every_entry_with_no_early_exit()
    {
        int calls = 0;
        var checker = new UploadCodeChecker((a, b) => { calls++; return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(a, b); });
        var entries = new[] { Entry("first-code-0123456789"), Entry("second-code-0123456789"), Entry("third-code-0123456789") };

        var (res, e) = checker.Check(entries, "first-code-0123456789", Now);   // the match is the FIRST entry
        Assert.AreEqual(CodeCheck.Valid, res);
        Assert.AreEqual(3, calls, "a match at the first entry must not stop the comparisons");

        calls = 0;
        Assert.AreEqual(CodeCheck.Unknown, checker.Check(entries, "no-such-code-0123456789", Now).Result);
        Assert.AreEqual(3, calls);
        Assert.IsNotNull(e);
    }

    [TestMethod]
    public void Compared_values_are_always_32_byte_hashes_whatever_the_code_length()
    {
        var lengths = new List<int>();
        var checker = new UploadCodeChecker((a, b) => { lengths.Add(a.Length); lengths.Add(b.Length); return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(a, b); });
        checker.Check(new[] { Entry("short-code-0123456") }, new string('z', 5000), Now);
        checker.Check(new[] { Entry("short-code-0123456") }, "", Now);
        Assert.IsTrue(lengths.All(l => l == 32), "a length difference must not show in the comparison");
    }

    [TestMethod]
    public void Accepts_only_the_exact_code()
    {
        var checker = new UploadCodeChecker();
        var entries = new[] { Entry("abcdefghijklmnop0123") };
        Assert.AreEqual(CodeCheck.Valid, checker.Check(entries, "abcdefghijklmnop0123", Now).Result);
        foreach (string? bad in new string?[] { null, "", "abcdefghijklmnop012", "abcdefghijklmnop01234", "ABCDEFGHIJKLMNOP0123", "abcdefghijklmnop0123\0", " abcdefghijklmnop0123" })
            Assert.AreEqual(CodeCheck.Unknown, checker.Check(entries, bad, Now).Result, bad ?? "null");
    }

    [TestMethod]
    public void A_code_is_valid_up_to_its_not_after_time_and_expired_after()
    {
        var checker = new UploadCodeChecker();
        var e = new UploadCodeEntry("abcdefghijklmnop0123", 3, Now);
        Assert.AreEqual(CodeCheck.Valid, checker.Check(new[] { e }, e.Code, Now).Result);
        Assert.AreEqual(CodeCheck.Valid, checker.Check(new[] { e }, e.Code, Now.AddSeconds(-1)).Result);
        Assert.AreEqual(CodeCheck.Expired, checker.Check(new[] { e }, e.Code, Now.AddTicks(1)).Result);
        Assert.AreEqual(3, checker.Check(new[] { e }, e.Code, Now).Entry!.Round);
    }

    [TestMethod]
    public void The_code_id_is_stable_distinct_and_does_not_contain_the_code()
    {
        var a = Entry("abcdefghijklmnop0123");
        var b = Entry("abcdefghijklmnop0124");
        Assert.AreEqual(a.CodeId, Entry("abcdefghijklmnop0123", 5, 99).CodeId);
        Assert.AreNotEqual(a.CodeId, b.CodeId);
        Assert.AreEqual(16, a.CodeId.Length);
        Assert.IsFalse(a.CodeId.Contains("abcdef", StringComparison.Ordinal) && a.Code.Contains(a.CodeId, StringComparison.Ordinal));
    }

    // ---- the UPLOAD_CODES setting ----

    [TestMethod]
    public void The_setting_is_a_json_list_of_code_round_and_not_after()
    {
        var s = ResultsSettings.Parse("""
            [ {"code":"abcdefghijklmnop0123","round":0,"notAfter":"2026-12-01T00:00:00Z"},
              {"code":"zyxwvutsrqponmlk9876","round":1,"notAfter":"2026-12-01T02:00:00+02:00"} ]
            """, "owner/name");
        Assert.IsNull(s.ConfigError);
        Assert.HasCount(2, s.Codes);
        Assert.AreEqual(0, s.Codes[0].Round);
        Assert.AreEqual(new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero), s.Codes[1].NotAfter, "an offset is honoured");
        Assert.AreEqual("owner/name", s.Repo);
    }

    [TestMethod]
    public void Deleting_an_entry_revokes_it_and_a_malformed_entry_accepts_nothing()
    {
        var s = ResultsSettings.Parse("""
            [ {"code":"abcdefghijklmnop0123","round":0,"notAfter":"2026-12-01T00:00:00Z"},
              {"code":"short","round":0,"notAfter":"2026-12-01T00:00:00Z"},
              {"code":"abcdefghijklmnop0124","round":100,"notAfter":"2026-12-01T00:00:00Z"},
              {"code":"abcdefghijklmnop0125","round":0,"notAfter":"2026-12-01T00:00:00"},
              {"code":"abcdefghijklmnop0126","round":0},
              {"code":"abcdefghijklmnop 127","round":0,"notAfter":"2026-12-01T00:00:00Z"},
              {"code":123,"round":0,"notAfter":"2026-12-01T00:00:00Z"},
              "not an object", null ]
            """, "owner/name");
        Assert.IsNull(s.ConfigError);
        Assert.HasCount(1, s.Codes);
        CollectionAssert.AreEqual(new[] { 1, 2, 3, 4, 5, 6, 7, 8 }, s.SkippedCodeEntries.ToArray());
    }

    [TestMethod]
    public void An_empty_list_is_valid_and_accepts_nothing()
    {
        var s = ResultsSettings.Parse("[]", "owner/name");
        Assert.IsNull(s.ConfigError);
        Assert.HasCount(0, s.Codes);
    }

    [TestMethod]
    [DataRow("owner/name", true)]
    [DataRow("lorenchorley/FireSim", true)]
    [DataRow("my-org/firesim-results", true)]
    [DataRow("a.b/c_d", true)]
    [DataRow("owner", false)]
    [DataRow("owner/", false)]
    [DataRow("/name", false)]
    [DataRow("a/b/c", false)]
    [DataRow("owner/na me", false)]
    [DataRow("../x", false)]
    [DataRow("owner/..", false)]
    [DataRow("owner/name?x=1", false)]
    [DataRow("owner/name#1", false)]
    [DataRow("", false)]
    public void GITHUB_REPO_is_owner_slash_name_only(string repo, bool ok) => Assert.AreEqual(ok, ResultsSettings.IsRepo(repo));

    [TestMethod]
    public void The_settings_come_from_the_environment_and_never_include_the_token()
    {
        var env = new Dictionary<string, string?>
        {
            ["UPLOAD_CODES"] = "[]", ["GITHUB_REPO"] = "owner/name", ["GITHUB_TOKEN"] = "token-" + Guid.NewGuid().ToString("N"),
        };
        var s = ResultsSettings.FromEnvironment(k => env.GetValueOrDefault(k));
        Assert.IsNull(s.ConfigError);
        Assert.AreEqual("owner/name", s.Repo);
        foreach (var p in typeof(ResultsSettings).GetProperties())
            Assert.IsFalse(p.Name.Contains("token", StringComparison.OrdinalIgnoreCase), "ResultsSettings must not carry the GitHub token");
    }
}
