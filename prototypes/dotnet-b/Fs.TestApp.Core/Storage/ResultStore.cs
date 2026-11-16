using System.Text;
using FsTestApp.Results;

namespace FsTestApp.Storage;

/// <summary>Where the result document lives on the phone before anything is sent (save-then-send, plan section 5). The document is written once and never
/// changed; what happens to its delivery (receipt, attempts, uninstall) goes in the separate <see cref="SendState"/>.</summary>
public interface IResultStore
{
    /// <summary>Writes the document (atomically: a temp file, then a rename) and returns its path. Throws if it cannot be written or read back.</summary>
    string SaveDocument(string runId, string json);
    string? LoadDocumentJson(string runId);
    SendState LoadState(string runId);
    void SaveState(SendState state);
    /// <summary>The run id of the newest saved document, or null.</summary>
    string? FindLatestRunId();
    string DocumentPath(string runId);
}

/// <summary>Files in one directory: <c>result-&lt;runId&gt;.json</c> and <c>state-&lt;runId&gt;.json</c>.</summary>
public sealed class FileResultStore : IResultStore
{
    readonly string dir;
    readonly object gate = new();

    public FileResultStore(string directory)
    {
        dir = directory;
        Directory.CreateDirectory(dir);
    }

    public string DirectoryPath => dir;

    static string CheckId(string runId)
    {
        if (runId.Length == 0 || runId.Length > 64 || !runId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
            throw new ArgumentException("bad run id", nameof(runId));
        return runId;
    }

    public string DocumentPath(string runId) => Path.Combine(dir, $"result-{CheckId(runId)}.json");
    string StatePath(string runId) => Path.Combine(dir, $"state-{CheckId(runId)}.json");

    public string SaveDocument(string runId, string json)
    {
        lock (gate)
        {
            string path = DocumentPath(runId);
            WriteAtomic(path, json);
            // read it back: "saved" means it can be read again, not that a write call returned
            string back = File.ReadAllText(path, Encoding.UTF8);
            if (back.Length != json.Length) throw new IOException("saved document does not read back at the same length");
            return path;
        }
    }

    public string? LoadDocumentJson(string runId)
    {
        lock (gate)
        {
            string path = DocumentPath(runId);
            return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : null;
        }
    }

    public SendState LoadState(string runId)
    {
        lock (gate)
        {
            string path = StatePath(runId);
            if (File.Exists(path))
            {
                try
                {
                    var s = ResultJsonContext.DeserializeState(File.ReadAllText(path, Encoding.UTF8));
                    if (s != null) return s;
                }
                catch (System.Text.Json.JsonException) { /* a torn or foreign file: start the state again; the document is what matters */ }
            }
            return new SendState { RunId = runId };
        }
    }

    public void SaveState(SendState state)
    {
        lock (gate) WriteAtomic(StatePath(state.RunId), ResultJsonContext.SerializeState(state));
    }

    public string? FindLatestRunId()
    {
        lock (gate)
        {
            var newest = new DirectoryInfo(dir).EnumerateFiles("result-*.json").OrderByDescending(f => f.LastWriteTimeUtc).ThenByDescending(f => f.Name, StringComparer.Ordinal).FirstOrDefault();
            if (newest == null) return null;
            var name = Path.GetFileNameWithoutExtension(newest.Name);
            return name["result-".Length..];
        }
    }

    static void WriteAtomic(string path, string content)
    {
        string tmp = path + ".tmp";
        using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var bytes = new UTF8Encoding(false).GetBytes(content);
            fs.Write(bytes, 0, bytes.Length);
            fs.Flush(true);
        }
        File.Move(tmp, path, overwrite: true);
    }
}
