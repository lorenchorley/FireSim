using System.Text;
using System.Text.Json;

namespace FsResults;

/// <summary>Reads a request body with a hard cap enforced while reading: at most cap+1 bytes are ever taken from the stream, whatever Content-Length said (or
/// did not say, as with chunked bodies). Returns null when the body is over the cap.</summary>
public static class BoundedBodyReader
{
    public static async Task<byte[]?> ReadAsync(Stream body, int cap, CancellationToken ct)
    {
        var buffer = new byte[cap + 1];
        int n = 0;
        while (n < buffer.Length)
        {
            int r = await body.ReadAsync(buffer.AsMemory(n), ct).ConfigureAwait(false);
            if (r == 0) break;
            n += r;
        }
        return n > cap ? null : buffer.AsSpan(0, n).ToArray();
    }
}

/// <summary>Checks the raw body before the schema sees it: strict UTF-8, one JSON value and nothing after it, depth at most 24, no comments or trailing commas, no
/// duplicate property names in one object (two readers could disagree about which one wins), and every string and property name decodes to valid UTF-16
/// (a lone surrogate escape such as "\ud800" is refused, not repaired).</summary>
public static class JsonHygiene
{
    public const int MaxDepth = 24;
    static readonly UTF8Encoding Strict = new(false, true);

    public static bool IsClean(ReadOnlySpan<byte> utf8)
    {
        try { _ = Strict.GetCharCount(utf8); }
        catch (ArgumentException) { return false; }

        var names = new Stack<HashSet<string>>();
        try
        {
            var reader = new Utf8JsonReader(utf8, new JsonReaderOptions { MaxDepth = MaxDepth, CommentHandling = JsonCommentHandling.Disallow, AllowTrailingCommas = false });
            while (reader.Read())
            {
                switch (reader.TokenType)
                {
                    case JsonTokenType.StartObject: names.Push(new HashSet<string>(StringComparer.Ordinal)); break;
                    case JsonTokenType.EndObject: names.Pop(); break;
                    case JsonTokenType.PropertyName:
                        if (!names.Peek().Add(reader.GetString()!)) return false;
                        break;
                    case JsonTokenType.String: _ = reader.GetString(); break;
                }
            }
            return true;
        }
        catch (JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (ArgumentException) { return false; }
    }
}
