# Result files

Two kinds of result JSON exist. Both are described by one machine-readable schema, `results.schema.json` (this folder), and both carry **`runtime`** and
**`build`** (plan rule 11). The validator is `Fs.TestApp.Core/Results/ResultSchema.cs` (the schema is embedded in `Fs.TestApp.Core`); it implements the
small subset of JSON Schema that the file uses and refuses a keyword it does not implement, so an edit cannot silently become unenforced.

| Kind | Written by | Schema |
|---|---|---|
| Container result file `reports/<stage>-results.json` | a task that measured in the container | `results.schema.json`, definition `#/$defs/containerResults` |
| Test-APK result document | a test APK on the owner's phone (plan section 5), saved on the phone, then sent | `results.schema.json`, the root |

## 1. Container result files

Every measurement a stage reports is also written as JSON next to its report (`reports/<stage>-results.json`) so that another agent can re-read it:

```json
{
  "stage": "1-kernel",
  "when": "2026-11-12T00:00:00Z",
  "machine": { "label": "container", "cpu": "model name", "cores": 4, "os": "Linux x.y", "runtime": ".NET 11.0.0" },
  "indicative": true,
  "build": { "configuration": "Release", "commit": "abc1234" },
  "runs": [
    { "name": "spread-step ts", "impl": "ts", "runtime": "v8-node", "threads": 1, "n": 20, "medianMs": 0.0, "p95Ms": 0.0, "minMs": 0.0, "maxMs": 0.0, "notes": "" }
  ],
  "gate": { "bar": "all-core C# >= 1.5x TypeScript on desktop", "measured": "0.0x", "result": "pass | stop | not run", "why": "" },
  "notRun": ["what could not be run here and what it needs"]
}
```

`indicative: true` for anything run in the container; phone runs say the phone model and Android version in `machine.label`.

Required: `stage`, `when` (RFC 3339), `machine` (`label`, `cores`), `indicative`, `runs` (each with `name`, `n`, `medianMs`). Other fields are allowed (`case`, `kernel`, `gitCommit`, ...).
The two existing files, `1-kernel-results.json` and `3a-results.json`, validate against it (a test in `Fs.Tests` checks that).

Added by T0.5 (both optional, so existing files stay valid):

- **`runs[].runtime`**, one of `coreclr`, `mono-wasm-aot`, `mono-wasm-interp`, `coreclr-wasm`, `v8-node`, `v8-chromium`, `v8-webview`. Which runtime produced the number.
  New result files set it; a report that compares runtimes groups by it.
- **`build`**: `{ "configuration": "Release" | "Debug", "commit": "<short hash>", "apkSha256": "<64 hex digits | unavailable>" }`. `apkSha256` only for results that came from an APK.
  Phone numbers come only from `Release` builds (plan rule 4).

In `gate.result` the value is one of `pass`, `stop`, `not run` (the example above lists the choices; a file holds one of them).

## 2. The test-APK result document

Built by `Fs.TestApp.Core` (`ResultDocument`), saved on the phone **before** anything is sent, sent as one JSON body of at most 64 KB. Nothing personal: no location, accounts, serial
numbers or advertising/Android ids. camelCase names; absent values are omitted, never `null`.

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | `1` | |
| `kind` | `"firesim-test-result"` | |
| `round` | integer 0..99 | the `-p:ProtoRound` of the build; `roundName` is its label ("link check") |
| `runId` | 32 lower-case hex | a GUID without dashes, made when the run starts, kept in the saved document |
| `idempotencyKey` | `<apkSha256>:<runId>` | **the same for every send of this run**; the endpoint keeps one result per key, so a retry after a lost answer never makes a second one. `unavailable` replaces the hash if the APK file could not be read |
| `build` | object | `configuration`, `commit`, `apkSha256` (SHA-256 of the installed APK, computed by the app at run time, because an APK cannot contain its own hash; 64 zeros in tests), `applicationId`, `appVersion` (`0.1.0-test.r<N>+<commit>`), `targetFramework` |
| `startedUtc`, `finishedUtc` | RFC 3339 | |
| `status` | `complete` / `partial` / `aborted` / `cancelled` | complete: every block ran. partial: an arm failed or a block was given up. aborted: stopped early (charge too low). cancelled: the user left |
| `device` | object | `manufacturer`, `model`, `soc`, `apiLevel`, `androidRelease`, `abis[]`, `cores`, `cpuCores[]` (`cpu`, `maxKhz`, `minKhz` from `/sys/devices/system/cpu/*/cpufreq`: big and little cores differ), `ramMb`, `webViewVersion` (`package`, `version`), `dotnet`, `processArch` |
| `conditions` | object | at the start: `airplaneMode`, `networkAtStart`, `batteryStartPercent`, `chargingAtStart`, `powerSaverAtStart`, `thermalAtStart` |
| `webView` | object | what the HybridWebView page reported: `origin`, `crossOriginIsolated`, `sharedArrayBuffer` (`typeof SharedArrayBuffer`), `userAgent`, `pageReported`; what the app did: `isolationHeaderSent`, `isolationHeaderValue`, `allowlist` (`libraryPresent`, `featureSupported`, `applied`, `origin`, `error`); `extra` (free: e.g. `headerSeenByPage`, WebAssembly SIMD and threads support) |
| `blocks[]` | array | one record per block **attempt**: `index`, `name`, `attempt` (1, 2, ...), `status`, `startedAtMs`, `durationMs`, `gateOutcome`. `ok`: ran to the end without a pause: use it. `paused`: a pause hit it: its numbers are not to be used (a re-run follows). `failed`: given up after the re-run limit. `skipped`: the run stopped before it |
| `arms[]` | array | one record per arm run: `block`, `blockAttempt`, `name`, **`runtime`**, `status` (`ok`, `error`, `paused`, `skipped`), `startedAtMs`, `durationMs`, `estimatedSeconds`, `result` (the arm's own JSON, any type), `error`. Use only arms whose (`block`, `blockAttempt`) has a block record with status `ok` |
| `logs` | object | `thermal[]` (`tMs`, `status`, `headroom`; headroom is absent when Android answered NaN, never NaN), `battery[]` (`tMs`, `percent`, `charging`, `chargeCounterUah`, `powerSaver`), `pauses[]` (`tMs`, `kind` = `native-pause`/`native-resume`/`screen-off`/`screen-on`/`webview-hidden`/`webview-visible`, `block`, `arm`), `gating[]` (`tMs`, `block`, `outcome` = `Ready`/`ReadyThermalTimeout`/`BatteryLow`, `waitedMs`, `reason`). `tMs` is milliseconds since the run started |
| `errors[]` | array | `tMs`, `where`, `type`, `message`, `stack` (trimmed). Every platform call that failed is here instead of crashing the app |

Limits in the schema (arrays and string lengths) keep a document bounded; the sender thins the thermal and battery logs of the **copy it sends** if the saved document is over 64 KB, and says so in `errors`.

### The endpoint contract (for T0.6a)

`POST <endpoint>`, `Content-Type: application/json`, headers `Idempotency-Key: <idempotencyKey>` and `X-Upload-Code: <code>`, body = the document.
The endpoint checks the code, that the header equals the document's `idempotencyKey`, the size and the schema (`results.schema.json`), stores **one result per key**, and answers
`200`/`201` `{"issue": 17, "url": "https://github.com/...", "duplicate": false}`; for a key it already holds, `200` or `409` with `"duplicate": true` and the original issue number.
The phone treats 200, 201, 202 and 409 as delivered, retries 408, 425, 429, 5xx, timeouts and connection errors with back-off (2 s doubling to 5 min, 25 % jitter, 12 tries, then waits
for the user to tap *Send now*), and does not retry other 4xx. Plain `http` is accepted by the app only for a loopback address (the container dry run).
