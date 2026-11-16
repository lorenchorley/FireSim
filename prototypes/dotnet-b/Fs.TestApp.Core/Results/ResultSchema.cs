using System.Globalization;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FsTestApp.Results;

public sealed record SchemaError(string Path, string Message)
{
    public override string ToString() => $"{(Path.Length == 0 ? "$" : Path)}: {Message}";
}

/// <summary>A small JSON Schema validator for reports/results.schema.json. It implements exactly the keywords that file uses (listed in its
/// "description"): type (a name or an array of names), enum, const, required, properties, additionalProperties (boolean or schema), items, minItems,
/// maxItems, minLength, maxLength, pattern, minimum, maximum, $ref to #/$defs/..., format "date-time". An unknown keyword that changes meaning
/// (oneOf, anyOf, allOf, not, if, patternProperties, ...) makes the validator refuse the schema rather than ignore it, so a schema edit cannot silently
/// become unenforced. Works on JsonNode (no reflection), so it runs on a trimmed Android build.</summary>
public sealed class ResultSchema
{
    static readonly HashSet<string> Annotations = new() { "$schema", "$id", "title", "description", "$comment", "$defs", "default", "examples" };
    static readonly HashSet<string> Supported = new()
    {
        "type", "enum", "const", "required", "properties", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength",
        "pattern", "minimum", "maximum", "$ref", "format",
    };
    static readonly Regex DateTimeShape = new(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$", RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(1));
    const int MaxErrors = 50;

    readonly JsonObject root;
    readonly Dictionary<string, Regex> patterns = new();

    public ResultSchema(string schemaJson)
    {
        root = JsonNode.Parse(schemaJson)?.AsObject() ?? throw new ArgumentException("schema is not a JSON object");
        CheckKeywords(root, "#");
    }

    static ResultSchema? defaultSchema;
    /// <summary>The schema embedded from reports/results.schema.json.</summary>
    public static ResultSchema Default => defaultSchema ??= new ResultSchema(ReadEmbedded());

    public static string ReadEmbedded()
    {
        var asm = typeof(ResultSchema).Assembly;
        using var s = asm.GetManifestResourceStream("results.schema.json") ?? throw new InvalidOperationException("results.schema.json is not embedded");
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    void CheckKeywords(JsonNode? node, string where)
    {
        if (node is not JsonObject o) return;
        foreach (var kv in o)
        {
            if (Supported.Contains(kv.Key)) { }
            else if (Annotations.Contains(kv.Key)) { }
            else throw new NotSupportedException($"schema keyword '{kv.Key}' at {where} is not implemented by ResultSchema");
        }
        // recurse into subschemas, not into the values of enum/const/required or into the 'properties' names
        if (o["properties"] is JsonObject props) foreach (var p in props) CheckKeywords(p.Value, $"{where}/properties/{p.Key}");
        if (o["items"] is JsonObject items) CheckKeywords(items, $"{where}/items");
        if (o["additionalProperties"] is JsonObject ap) CheckKeywords(ap, $"{where}/additionalProperties");
        if (o["$defs"] is JsonObject defs) foreach (var d in defs) CheckKeywords(d.Value, $"{where}/$defs/{d.Key}");
    }

    /// <summary>Validate a serialized document. <paramref name="defName"/> selects a definition under $defs ("" = the root schema).</summary>
    public IReadOnlyList<SchemaError> Validate(string json, string defName = "")
    {
        JsonNode? doc;
        try { doc = JsonNode.Parse(json); }
        catch (System.Text.Json.JsonException e) { return new[] { new SchemaError("", "not valid JSON: " + e.Message) }; }
        return Validate(doc, defName);
    }

    public IReadOnlyList<SchemaError> Validate(JsonNode? doc, string defName = "")
    {
        // round-trip so every number is a parsed one (a JsonNode built in code may hold an int or a double behind the same API)
        JsonNode? parsed = doc == null ? null : JsonNode.Parse(doc.ToJsonString());
        var errors = new List<SchemaError>();
        JsonObject schema = defName.Length == 0 ? root : ResolveRef("#/$defs/" + defName);
        Check(parsed, schema, "", errors);
        return errors;
    }

    JsonObject ResolveRef(string reference)
    {
        if (!reference.StartsWith("#/$defs/", StringComparison.Ordinal)) throw new NotSupportedException("only #/$defs/* references are supported: " + reference);
        var name = reference["#/$defs/".Length..];
        if (root["$defs"] is JsonObject defs && defs[name] is JsonNode n) return n.AsObject();
        throw new InvalidOperationException("unresolved reference " + reference);
    }

    void Check(JsonNode? node, JsonObject schema, string path, List<SchemaError> errors)
    {
        if (errors.Count >= MaxErrors) return;
        if (schema["$ref"] is JsonNode r)
        {
            Check(node, ResolveRef(r.GetValue<string>()), path, errors);
            // draft 2020-12 allows siblings of $ref; the schema file uses none that matter, but check them for correctness
        }

        if (schema.ContainsKey("const"))
        {
            var cv = schema["const"];
            if (!JsonNode.DeepEquals(node, cv)) { Add(errors, path, $"must equal {cv?.ToJsonString() ?? "null"}"); return; }
        }
        if (schema["enum"] is JsonArray en && !en.Any(e => JsonNode.DeepEquals(node, e)))
        {
            Add(errors, path, $"must be one of {en.ToJsonString()} but is {Short(node)}");
            return;
        }
        if (schema["type"] is JsonNode t)
        {
            var names = t is JsonArray ta ? ta.Select(x => x!.GetValue<string>()).ToArray() : new[] { t.GetValue<string>() };
            if (!names.Any(n => IsType(node, n))) { Add(errors, path, $"must be {string.Join(" or ", names)} but is {KindName(node)}"); return; }
        }

        switch (node)
        {
            case JsonObject obj: CheckObject(obj, schema, path, errors); break;
            case JsonArray arr: CheckArray(arr, schema, path, errors); break;
            case JsonValue val: CheckValue(val, schema, path, errors); break;
        }
    }

    void CheckObject(JsonObject obj, JsonObject schema, string path, List<SchemaError> errors)
    {
        if (schema["required"] is JsonArray req)
            foreach (var rn in req)
            {
                var name = rn!.GetValue<string>();
                if (!obj.ContainsKey(name)) Add(errors, path, $"missing required property '{name}'");
            }
        var props = schema["properties"] as JsonObject;
        var additional = schema["additionalProperties"];
        foreach (var kv in obj)
        {
            string childPath = path + "/" + kv.Key;
            if (props != null && props[kv.Key] is JsonObject sub) Check(kv.Value, sub, childPath, errors);
            else if (additional is JsonValue av && av.GetValueKind() == System.Text.Json.JsonValueKind.False) Add(errors, childPath, "property is not allowed");
            else if (additional is JsonObject asub) Check(kv.Value, asub, childPath, errors);
        }
    }

    void CheckArray(JsonArray arr, JsonObject schema, string path, List<SchemaError> errors)
    {
        if (schema["minItems"] is JsonNode mi && arr.Count < mi.GetValue<int>()) Add(errors, path, $"must have at least {mi} items");
        if (schema["maxItems"] is JsonNode ma && arr.Count > ma.GetValue<int>()) Add(errors, path, $"must have at most {ma} items but has {arr.Count}");
        if (schema["items"] is JsonObject items)
            for (int i = 0; i < arr.Count && errors.Count < MaxErrors; i++) Check(arr[i], items, $"{path}/{i}", errors);
    }

    void CheckValue(JsonValue val, JsonObject schema, string path, List<SchemaError> errors)
    {
        var kind = val.GetValueKind();
        if (kind == System.Text.Json.JsonValueKind.String)
        {
            string s = val.GetValue<string>();
            if (schema["minLength"] is JsonNode mn && s.Length < mn.GetValue<int>()) Add(errors, path, $"must have at least {mn} characters");
            if (schema["maxLength"] is JsonNode mx && s.Length > mx.GetValue<int>()) Add(errors, path, $"must have at most {mx} characters but has {s.Length}");
            if (schema["pattern"] is JsonNode pn)
            {
                string pat = pn.GetValue<string>();
                if (!patterns.TryGetValue(pat, out var re)) patterns[pat] = re = new Regex(pat, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
                if (!re.IsMatch(s)) Add(errors, path, $"must match {pat} but is {Short(val)}");
            }
            if (schema["format"] is JsonNode f && f.GetValue<string>() == "date-time"
                && !(DateTimeShape.IsMatch(s) && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out _)))
                Add(errors, path, $"must be an RFC 3339 date-time but is {Short(val)}");
        }
        else if (kind == System.Text.Json.JsonValueKind.Number)
        {
            double d = val.GetValue<double>();
            if (schema["minimum"] is JsonNode mn && d < mn.GetValue<double>()) Add(errors, path, $"must be at least {mn} but is {d.ToString(CultureInfo.InvariantCulture)}");
            if (schema["maximum"] is JsonNode mx && d > mx.GetValue<double>()) Add(errors, path, $"must be at most {mx} but is {d.ToString(CultureInfo.InvariantCulture)}");
        }
    }

    static bool IsType(JsonNode? node, string type) => type switch
    {
        "null" => node is null,
        "object" => node is JsonObject,
        "array" => node is JsonArray,
        "string" => node is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.String,
        "boolean" => node is JsonValue v && v.GetValueKind() is System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False,
        "number" => node is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number,
        "integer" => node is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number && IsIntegral(v),
        _ => throw new NotSupportedException("unknown type " + type),
    };

    static bool IsIntegral(JsonValue v)
    {
        double d = v.GetValue<double>();
        return !double.IsNaN(d) && !double.IsInfinity(d) && Math.Floor(d) == d;
    }

    static string KindName(JsonNode? n) => n switch
    {
        null => "null",
        JsonObject => "object",
        JsonArray => "array",
        JsonValue v => v.GetValueKind().ToString().ToLowerInvariant(),
        _ => "unknown",
    };

    static string Short(JsonNode? n)
    {
        string s = n?.ToJsonString() ?? "null";
        return s.Length <= 80 ? s : s[..77] + "...";
    }

    static void Add(List<SchemaError> errors, string path, string message)
    {
        if (errors.Count < MaxErrors) errors.Add(new SchemaError(path, message));
    }
}

/// <summary>Validate a <see cref="ResultDocument"/> the way the endpoint will.</summary>
public static class ResultValidator
{
    public static IReadOnlyList<SchemaError> Validate(ResultDocument doc) => ResultSchema.Default.Validate(ResultJsonContext.Serialize(doc));
    public static IReadOnlyList<SchemaError> Validate(string json) => ResultSchema.Default.Validate(json);
    public static IReadOnlyList<SchemaError> ValidateContainerResults(string json) => ResultSchema.Default.Validate(json, "containerResults");
}
