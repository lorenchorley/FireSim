using System.Text;
using FsTestApp.Results;
using FsTestApp.Sending;

namespace Fs.Tests.TestApp;

[TestClass]
public sealed class GitHubIssueUrlTests
{
    const string Repo = "example/firesim-results";

    [TestMethod]
    public void SmallDocumentGetsTheFullSummary()
    {
        var doc = TestDocs.Valid();
        var r = GitHubIssueUrl.Build(Repo, doc);
        Assert.AreEqual(0, r.Level);
        Assert.IsTrue(r.Url.Length <= GitHubIssueUrl.DefaultMaxChars);
        StringAssert.StartsWith(r.Url, "https://github.com/example/firesim-results/issues/new?title=");
        StringAssert.Contains(r.Url, "&labels=bench-result&body=");
        StringAssert.Contains(r.Body, doc.IdempotencyKey);
        StringAssert.Contains(r.Body, "arm-0");
    }

    [TestMethod]
    [DataRow(5, 50)]
    [DataRow(30, 400)]
    [DataRow(200, 400)]
    [DataRow(2000, 2000)]
    public void TheWholeAddressStaysUnderSixKilobytesAfterEncoding(int arms, int resultChars)
    {
        var doc = TestDocs.Large(arms, resultChars);
        var r = GitHubIssueUrl.Build(Repo, doc);
        Assert.IsTrue(r.Url.Length <= GitHubIssueUrl.DefaultMaxChars, $"{r.Url.Length} characters at level {r.Level}");
        Assert.IsTrue(Encoding.UTF8.GetByteCount(r.Url) <= GitHubIssueUrl.DefaultMaxChars, "bytes too: the address is ASCII after percent-encoding");
        Assert.IsTrue(r.Url.All(c => c < 128), "no raw non-ASCII character in the address");
        StringAssert.Contains(Uri.UnescapeDataString(r.Url), doc.IdempotencyKey, "the key survives every level");
    }

    [TestMethod]
    public void TheCapIsOnTheEncodedAddressNotOnTheText()
    {
        // 'e acute' is 2 UTF-8 bytes and 6 characters once percent-encoded; a newline is 3. A text of 3,000 characters can encode to 9,000.
        var doc = TestDocs.Large(arms: 15, resultChars: 280);
        var level0 = GitHubIssueUrl.Summary(doc, 0);
        int encodedLevel0 = Uri.EscapeDataString(level0).Length;
        Assert.IsTrue(encodedLevel0 > level0.Length * 1.3, $"encoding grows the text ({level0.Length} -> {encodedLevel0})");
        Assert.IsTrue(level0.Length < GitHubIssueUrl.DefaultMaxChars && encodedLevel0 > GitHubIssueUrl.DefaultMaxChars,
            $"this document passes a cap on the plain text and fails a cap on the encoded text, so only the encoded cap is correct (plain {level0.Length}, encoded {encodedLevel0})");
        var r = GitHubIssueUrl.Build(Repo, doc);
        Assert.IsTrue(r.Level > 0, "it had to degrade");
        Assert.IsTrue(r.Url.Length <= GitHubIssueUrl.DefaultMaxChars);
    }

    [TestMethod]
    public void SummaryDegradesGracefullyLevelByLevel()
    {
        var doc = TestDocs.Large(arms: 40, resultChars: 200);
        var lengths = Enumerable.Range(0, 5).Select(l => Uri.EscapeDataString(GitHubIssueUrl.Summary(doc, l)).Length).ToArray();
        for (int i = 1; i < lengths.Length; i++) Assert.IsTrue(lengths[i] < lengths[i - 1], $"level {i} ({lengths[i]}) must be shorter than level {i - 1} ({lengths[i - 1]})");
        foreach (int level in new[] { 0, 1, 2, 3, 4 }) StringAssert.StartsWith(GitHubIssueUrl.Summary(doc, level), "key: " + doc.IdempotencyKey);
        Assert.IsFalse(GitHubIssueUrl.Summary(doc, 2).Contains("checksum"), "level 2 drops the arm results");
        Assert.IsTrue(GitHubIssueUrl.Summary(doc, 2).Contains("arm-0"), "level 2 keeps the arm lines");
        Assert.IsFalse(GitHubIssueUrl.Summary(doc, 3).Contains("arm-0"), "level 3 keeps counts only");
    }

    [TestMethod]
    public void TinyCapFallsBackToAHardCutThatKeepsTheKey()
    {
        var doc = TestDocs.Large(arms: 10, resultChars: 50);
        doc.Device.Model = "Phone";
        var head = $"https://github.com/{Repo}/issues/new?title=".Length;
        var r = GitHubIssueUrl.Build(Repo, doc, maxChars: 400);
        Assert.IsTrue(r.Url.Length <= 400, $"{r.Url.Length}");
        Assert.AreEqual(5, r.Level, "level 4 itself did not fit: the hard cut ran");
        StringAssert.Contains(Uri.UnescapeDataString(r.Url), "key: " + doc.IdempotencyKey[..40]);
        Assert.IsTrue(head > 0);
    }

    [TestMethod]
    public void BodyIsAFencedBlockThatTextFromThePhoneCannotBreakOutOf()
    {
        var doc = TestDocs.Large(arms: 3, resultChars: 20);
        doc.Arms[0].Error = "``` break out @someone [link](http://evil.example) \u0007 bell";
        var r = GitHubIssueUrl.Build(Repo, doc);
        Assert.IsTrue(r.Body.StartsWith("```text\n") && r.Body.EndsWith("\n```"));
        // the only fences are the opening and closing one
        Assert.AreEqual(2, System.Text.RegularExpressions.Regex.Matches(r.Body, "```").Count, "no fence inside the text");
        Assert.IsFalse(r.Body.Contains('\u0007'), "no control characters");
    }

    [TestMethod]
    public void RepoNameIsChecked()
    {
        Assert.IsTrue(GitHubIssueUrl.IsRepo("owner/name"));
        Assert.IsTrue(GitHubIssueUrl.IsRepo("my-org/firesim.results_1"));
        foreach (var bad in new[] { "", "owner", "owner/", "/name", "a/b/c", "owner/na me", "owner/name?x=1", "owner/na#me" })
            Assert.IsFalse(GitHubIssueUrl.IsRepo(bad), bad);
        Assert.Throws<ArgumentException>(() => GitHubIssueUrl.Build("not a repo", TestDocs.Valid()));
    }

    [TestMethod]
    public void TitleAndLabelAreEncoded()
    {
        var doc = TestDocs.Valid();
        doc.Device.Model = "A&B=C ?#";
        var r = GitHubIssueUrl.Build(Repo, doc);
        var query = r.Url[(r.Url.IndexOf('?') + 1)..];
        var parts = query.Split('&');
        Assert.AreEqual(3, parts.Length, "title, labels, body and nothing smuggled in by the model name");
        StringAssert.StartsWith(parts[0], "title=");
        Assert.AreEqual("labels=bench-result", parts[1]);
    }
}
