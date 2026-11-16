using FsTestApp.DryRun;

// Container dry run of the test app's session logic (plan T0.5). Exit code 0 when every scenario passes.
string outDir = Path.Combine(Path.GetTempPath(), "fs-testapp-dryrun-" + Environment.ProcessId);
string? only = null;
for (int i = 0; i < args.Length - 1; i++) { if (args[i] == "--out") outDir = args[i + 1]; if (args[i] == "--only") only = args[i + 1]; }

Console.WriteLine($"dry run, output in {outDir}");
var results = await DryRunScenarios.RunAllAsync(outDir, only);
int failed = 0;
foreach (var r in results)
{
    Console.WriteLine($"{(r.Passed ? "PASS" : "FAIL")} {r.Name}");
    foreach (var c in r.Checks) Console.WriteLine("    " + c);
    if (!r.Passed) failed++;
}
Console.WriteLine($"{results.Count - failed} of {results.Count} scenarios passed");
return failed == 0 ? 0 : 1;
