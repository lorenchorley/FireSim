# 0.8.0, workstream J: the desktop host (decision D34, plan 15e)

Status: contract for the build lanes (written 2026-11-07 by the orchestrator, committed before the lanes start). Read together with plan sections 4 (ground rules), 15e and decisions D33 and D34 in `docs/plans/air-slice-wind-detail-honest-speed.md`.

## 1. Goal and non-goals

**Goal.** A desktop program that runs the SAME TypeScript simulation (`SimHost`) on a computer, serves the same web app, and lets the page (in the desktop's own browser, and in a phone's browser on the same network) use that engine instead of the device's own. One solver, no second implementation (D34).

**What this release does NOT include** (each is a later decision): the APK connecting to a desktop (an `https://localhost` WebView page cannot open a plain `ws://` socket to a LAN address without loosening the APK's cleartext and mixed-content settings: needs the owner's OK); a hosted or cloud server; several viewers sharing one session; a "Desktop detail" profile with finer cells or more embers (waits for the measured numbers of `studies/desktop-simulation/` and for validation); worker threads that split one run, WebAssembly, WebGPU; an installer or a shell (Electron, Tauri); TLS. No change to the simulation code, to results, to any budget.

## 2. Architecture (decided; deviations must be reported, not made)

```
phone / desktop browser ──http──> desktop host (Node 22) ──serves──> dist/ (the same built app)
        │                              │
        └──── ws /__firesim/engine ────┴── one worker_thread per session running SimHost (src/sim/host.ts)
```

* The page keeps all its code. Only the controller changes: `src/ui/modules.ts` `createController` returns the remote controller instead of `new SimClient()` when the user chose the desktop engine.
* The remote controller speaks the existing protocol (`ToWorker` / `FromWorker` in `src/sim/protocol.ts`) over a WebSocket. `ProtocolController` (client.ts) is the base class (it must be exported; that is the only change to client.ts besides exporting `withoutContext`).
* **One engine session per connection** (its own worker thread, its own scenario, its own run). Sharing one session between viewers is a later feature; the protocol leaves room for it (`welcome.session`).

## 3. The wire (lane J1)

### 3.1 Files
`src/sim/remote/codec.ts` (pure TypeScript, no DOM and no Node imports), `src/sim/remote/detect.ts` (tiny; see 5), `src/sim/remote/RemoteSimController.ts`, `src/sim/remote/index.ts` (the lazy entry), `desktop/` (the host: `desktop/main.ts` or equivalent, `desktop/engineWorker.ts`, `desktop/README.md`, tests beside the code), `package.json` (scripts `desktop` and, if needed, a type-check for `desktop/`; `ws` and `@types/ws` as **devDependencies only**, nothing else new), `package-lock.json`, `src/sim/client.ts` (the two exports only).

### 3.2 Host behaviour
* Node 22 (the machine has v22). Run with `npm run desktop [-- flags]`. It serves `dist/` (built by `npm run build`; if `dist/index.html` is missing, print how to build and exit 2). Static serving is path-traversal safe (normalise, reject `..`, no directory listings, correct content types, `Cache-Control: no-store` for `index.html`).
* Flags: `--port N` (default 4300), `--lan` (bind 0.0.0.0 and print every non-internal IPv4 URL; **the default is 127.0.0.1 only**), `--code XXXXXXXX` (otherwise random), `--max-sessions N` (default `max(1, min(4, cores - 1))`), `--open` (open the default browser; off by default), `--name TEXT` (shown to users; default the hostname).
* **Pairing code**: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, from `crypto.randomInt`; printed once at start with the URL `http://HOST:PORT/#code=CODE`. Compare in constant time. After 5 wrong codes from one address, refuse that address for 60 s (close code 4429). The code is never written to a file or a log line other than that one print.
* `GET /__firesim/host` returns JSON `{ "app": "firesim-desktop-host", "protocol": 1, "name": string, "cores": number, "node": string, "sessions": number, "maxSessions": number }` and nothing else (no code, no paths, no environment).
* WebSocket at `/__firesim/engine`. **Origin check**: a handshake with an `Origin` header is accepted only when that origin's host:port equals the request's `Host` header (a page served by this host); no `Origin` (a non-browser client) is accepted, with the code. First client frame must be a TEXT frame `{"type":"hello","protocol":1,"code":"..."}` within 5 s, else close 4400. Reply TEXT `{"type":"welcome","session":"<id>","protocol":1}` or close 4401 (wrong code), 4429 (rate limit), 4503 (no free session). After `welcome`, every frame is BINARY and carries one codec message (3.3). Max frame size 256 MiB (a scenario is large); a ping every 20 s, a dead peer closed after 60 s.
* **Session** = one `worker_threads` worker running `SimHost` (`{ schedule, transfer: true }`, like `src/sim/worker.ts` but on `parentPort`), created on `welcome`, terminated on close or error, with no leak (listeners removed, the worker terminated, the slot freed). A worker `error` is sent as `{type:'error', message}` and the session closed.
* Logs: one line per connect/close with the address and the session id; never the code, never a scenario.
* Graceful shutdown on SIGINT/SIGTERM: close sockets, terminate workers, exit 0.

### 3.3 Codec
`encodeMessage(msg: ToWorker | FromWorker): Uint8Array` and `decodeMessage(bytes: Uint8Array): ToWorker | FromWorker`, both pure. Layout: `u32 little-endian header length`, the UTF-8 JSON header, zero padding to 8 bytes, then the typed-array bytes back to back, each 8-byte aligned. In the header every typed array is replaced by `{"$ta":"<f32|f64|i8|u8|u8c|i16|u16|i32|u32|i64|u64>","o":<byte offset in the body>,"n":<element count>}`; a non-finite number by `{"$num":"NaN"|"Infinity"|"-Infinity"}`; `undefined` object fields are omitted (as JSON does), so `decode(encode(x))` deep-equals `x` for everything the protocol carries (check `src/core/types.ts` for Map, Set, Date, BigInt or class instances; **throw a clear error on anything not representable, do not drop it silently**). A typed array that is a view (`byteOffset` ≠ 0, a shared buffer, a subarray) is encoded by its own elements only. The decoder returns arrays that own aligned buffers (no misaligned views). `init` has its `scenario` context layers removed first, as `SimClient` does (`withoutContext`).

### 3.4 `RemoteSimController`
Extends `ProtocolController`. `connect()` opens the socket, sends `hello`, waits for `welcome` (10 s), then behaves as `SimController`. Errors are events, never exceptions on the page: a wrong code rejects `connectRemote` with `RemoteAuthError`; a closed or failed link after that emits `error` once with a plain sentence ("The desktop connection closed.") and disposes the controller (no reconnect in this release: the session is gone with its worker). `rttMs()` is measured by a ping every 5 s. `dispose()` closes the socket (code 1000).

### 3.5 Public surface (the contract with lane J2; do not change without telling the orchestrator)

```ts
// src/sim/remote/detect.ts   (small: fetch and a type check only, NO codec import; it goes in the entry chunk)
export interface RemoteHostInfo { app: 'firesim-desktop-host'; protocol: 1; name: string; cores: number; node: string; sessions: number; maxSessions: number }
export function detectHost(opts?: { base?: string; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<RemoteHostInfo | null>; // null on any failure or mismatch, default timeout 800 ms; base defaults to location.origin

// src/sim/remote/index.ts    (loaded only with `await import('../sim/remote')`)
export class RemoteAuthError extends Error {}
export interface RemoteConnection { controller: SimController; info: RemoteHostInfo; rttMs(): number | null; close(): void }
export function connectRemote(o: { base: string; code: string; WebSocketCtor?: typeof WebSocket }): Promise<RemoteConnection>;
```

## 4. The page (lane J2)

Files: `src/ui/modules.ts` (the controller choice), the Setup screen (an "Engine" row), the debug statistics (an engine row), Help and README text, `content.ts` and its tests, the network-audit e2e, new e2e. Does not touch `src/sim/remote/*`, `desktop/*`, `package.json`.

* **Detection**: at start-up, only when the page is not the Capacitor app (`window.Capacitor?.isNativePlatform?.()` is not true) and `location.protocol` is `http:` or `https:`, call `detectHost()` once (same-origin request only; the network audit must still pass: no request to any other origin). The result is kept in a small store; no request is repeated.
* **Setup screen**: when a host was found, an "Engine" row: *This device* / *Desktop (NAME, N cores)*. The code comes from the URL fragment `#code=` (read once, then removed with `history.replaceState`, **never stored**), or is typed into an input shown when *Desktop* is chosen without a code. **Desktop is preselected only when a code arrived in the URL**; otherwise *This device* is. A wrong code says so in words next to the input (no pop-up). The choice is for this page load only (not remembered).
* **While running remotely**: the debug statistics "Engine right now" group names it ("Desktop NAME, N cores, Node VERSION, link X ms"); a short line under the timeline or in the existing tier line says "Running on the desktop" (follow the existing pace/tier-line pattern; no new overlay, nothing that pops up); on `error` from the link the app shows its existing error chip with "The desktop connection closed." and the user can start over on *This device*.
* **Honesty (ground rule 4)**: the Help gets a short entry: what the desktop engine is (the same simulation code run on the desktop's processor; results of a run are the same program's, not guaranteed identical to a phone's because a different JavaScript engine and version may round differently); that the phone's own run needs no network; that the connection is opt-in, local, protected by the code, and that nothing is sent anywhere else. README's offline/network wording and the audit spec's comment are updated to say the same. `content.test.ts` pins the new wording.
* **Lazy**: `modules.ts` loads `../sim/remote` with a dynamic import, only when the user starts a run on the desktop engine. `detect.ts` is the only remote file in the entry chunk, and the entry may grow by at most 0.5 kB gzip.
* **Test seam** (so that J2 can finish before J1 is merged): `window.__firesimRemote = { detectHost, connectRemote }`, honoured only with `?debug=1`, replaces the two functions. e2e specs use a stub controller (the existing `MockSimController` or a small fake) behind it. The real host is exercised by the integration pass after both lanes merge.

## 5. Tests required (both lanes; the repo's rules in COMMON-060 apply)

J1: codec round trip (every array kind, a subarray view, an empty array, NaN and the infinities, nested and repeated arrays, a real `SimSnapshot` and a real `ScenarioData` from the test fixtures), codec rejects the unrepresentable, fuzzed headers do not crash the decoder (an error, never a hang); host: wrong code, right code, rate limit, bad origin, hello timeout, session limit, worker terminated on close (no leak), path traversal, `/__firesim/host` carries no secrets, `--lan` address selection (a pure function); `RemoteSimController` against the real host in-process; **determinism across the transport: the same scenario and seed through `LocalSimController` and through host plus `RemoteSimController` give identical snapshot hashes at identical simulation times** (use the repo's existing hashing in the V18 determinism test); a throughput figure (MB/s and ms for a real scenario upload and a real snapshot) printed by a test that is not asserted.
J2: store and detection logic (no request on Capacitor, none to another origin, 800 ms timeout, mismatch is null), the Setup row (hidden without a host, preselection rule, the code removed from the URL, never stored, wrong-code wording), the engine row in the debug statistics, the closed-link message, content pins; e2e with the seam; the contrast, layout-budget and tap-target audits still pass at their sizes.

## 6. Constraints

* Bundle budgets are unchanged and not to be raised: entry 195 kB gzip (now 174.6), all JavaScript 1000 kB gzip (now 979.9: **about 20 kB left**, so the remote chunk must stay under about 8 kB gzip), CSS 135 kB raw and 25 kB gzip. `npm run check:bundle` must pass.
* No new dependency except `ws` and `@types/ws` in devDependencies. Do not run `npm audit fix` or upgrade anything.
* Ground rules 1, 2, 4 and 10 of plan section 4: the simulation is untouched and deterministic; nothing in the host or the controller may change a result; the page says where a result came from.
* The host listens on localhost unless `--lan` is given; the code protects the engine; there is no TLS (say so in `desktop/README.md`: use it on a network you trust).

## 7. Decisions taken for the owner here (to be reported, easy to change)

One engine session per connection and no shared session in 0.8.0; localhost by default and LAN only with `--lan`; an 8-character pairing code in the URL fragment, never stored; the phone uses the desktop-served page in its browser and the APK does not connect (needs the owner's OK to loosen the cleartext and mixed-content rules); no reconnect after a lost link; Desktop preselected only when a code came with the URL; no installer, `npm run desktop` is the way to start it; the version is 0.8.0 (versionCode 12) when it ships.

## 8. Report format
Under about 900 words: what was built (files), the tests added and their results, the figures measured (throughput, bundle), the decisions you took beyond this contract, anything you did not do and why, the commit hash. Do not push; do not open a PR.
