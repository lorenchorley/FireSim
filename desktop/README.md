# FireSim desktop host

A program for a computer that runs the **same TypeScript simulation** the phone runs (`SimHost`, one worker thread per
session), serves the **same web app**, and lets the page use that engine instead of the device's own. It is for the desktop's
own browser and for a phone's browser on the same network. One solver, no second implementation (plan decision D34).

It is opt-in: the app works as before without it, and a phone's own run needs no network.

## Start it

Needs Node 22 (the version the repository already uses).

```
npm run build          # once, and again after the app changes: the host serves dist/
npm run desktop        # builds the host (about a second) and starts it
```

If `dist/index.html` is missing it says how to build and exits with 2.

It prints the address to open **on this computer**:

```
FireSim desktop host "my-computer"
Open this on this computer:
  http://127.0.0.1:4300/#code=ABCD2345
Pairing code: ABCD2345
Up to 3 simulations at once. Ctrl+C stops it.
```

The page picks the code up from the address (after the `#`, which a browser never sends to a server) and offers the
*Desktop* engine on its Setup screen. Without the code in the address, the page asks for it.

### A phone on the same network

```
npm run desktop -- --lan
```

prints one address for every network address of the computer, each with the code:

```
Open one of these on this computer or on a phone on the same network:
  http://192.168.1.20:4300/#code=ABCD2345
```

Open it in the phone's browser. The phone shows the app that the computer serves and the computer runs the simulation. The
phone and the computer must be on the same network, and the computer's firewall must let the port through.

**There is no TLS.** The page and the engine link are plain `http` and `ws`. The pairing code keeps other people from using
your engine; it does not hide the traffic from anyone who can see the network (the code and the scenario cross it in the
clear). Use `--lan` only on a network you trust. Without `--lan` the host listens on `127.0.0.1` and nothing else on the
network can reach it.

A page opened from a LAN address is not a secure context, so features that browsers allow only on `https` or `localhost` (for
example the device's location) are not available through it.

## Flags

`npm run desktop -- FLAGS` (the `--` is npm's, once).

| Flag | Meaning |
|---|---|
| `--port N` | Port to listen on. Default 4300; `0` picks a free one. |
| `--lan` | Listen on every network interface (`0.0.0.0`) and print every non-internal IPv4 address. Default: `127.0.0.1` only. |
| `--code CODE` | The pairing code: 8 to 32 letters and digits (any case; it is kept in capitals). Default: a random one of 8 characters. Arguments are visible to other users of the computer (`ps`): prefer the random code. |
| `--max-sessions N` | Simulations that may run at once, one worker thread each. Default `max(1, min(4, cores - 1))`. |
| `--open` | Open the address in the default browser. |
| `--name TEXT` | The name users see (default: the computer's name). |
| `--help` | The usage text. |

Exit codes: 0 after a clean stop (Ctrl+C or `SIGTERM` closes the sockets, ends the workers and exits), 1 when it could not
start (port in use), 2 for a wrong flag or no built app.

## The pairing code

8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0 or 1), drawn from the operating system's random source at every
start, printed once at start and never written to a file or a log line. It is compared in constant time. After 5 wrong codes
from one address, that address is refused for 60 seconds (close code 4429), also with the right code. A browser page must
also have been served by this host: the handshake of a page from any other origin is refused (the Origin check; a client with
no Origin header, such as a script, is accepted and still needs the code).

## What it costs

Measured on a 4-core machine with the Katoomba demo site (6 km, fast tier): the idle host is about 70 MB; each session is a
worker thread that adds about 110 MB when the scenario is loaded and about 100 MB more after half an hour of simulated fire
(two such sessions at once: about 470 MB at the peak). A scenario is about 6.5 MB on the wire and one snapshot about 2.2 MB; a
run at full speed streams about 27 MB/s to the page (more than a Wi-Fi link carries: see the flow control below).

## What it serves

| Path | |
|---|---|
| `/` and the rest of `dist/` | The built app. Static, path-traversal safe, no directory listings, no dot files; `index.html` is `no-store`. |
| `GET /__firesim/host` | `{"app":"firesim-desktop-host","protocol":1,"name":"...","cores":8,"node":"22.22.0","sessions":0,"maxSessions":3}` and nothing else (no code, no paths, no environment). `node` has no leading `v`. |
| WebSocket `/__firesim/engine` | One engine session per connection. |

### The engine link

1. The client's first frame must be TEXT, within 5 seconds: `{"type":"hello","protocol":1,"code":"..."}`.
2. The host answers TEXT `{"type":"welcome","session":"<id>","protocol":1}`, or closes with **4400** (no good hello in time, or a
   later frame that is not binary), **4401** (wrong code), **4429** (too many wrong codes from this address), **4503** (no free
   session). A page whose origin is not the host's gets HTTP 403 at the handshake.
3. After the welcome every frame is BINARY and carries one message of the simulation protocol (`ToWorker` from the page,
   `FromWorker` from the engine) in the codec of `src/sim/remote/codec.ts`: a header of JSON in which every typed array is a
   placeholder, then the arrays' bytes, each on a multiple of 8. The two link messages `ping` and `pong` (the page measures the
   round trip with them) are answered by the host itself.
4. Limits: a frame may be 4 KB before the welcome and 256 MiB after it (a scenario is large; above that the host closes with
   1009); the host pings every 20 s and closes a connection that has been silent for 60 s; a connection that has not said hello
   counts against a limit of 16 (further ones get HTTP 503).
5. When the link is behind, the host holds the engine back (the run waits between chunks) until the link has caught up: the run
   gets slower and nothing changes in its results.
6. When a session ends (closed, dropped, an error, a stop) its worker thread is terminated and its slot freed. If the worker
   fails, the page gets an `error` message with the first line of the failure (never a stack or a file name) and the host closes with 1011.

Logs: one line per connect and close with the address and the session id, and one per refused connection with the reason.
Never the code, a wrong guess or a scenario.

## What is not here

Each is a later decision (contract `docs/plans/0.8.0/J-CONTRACT-desktop-host.md`, section 1):

- The Android app connecting to a desktop (a plain `ws://` socket from an `https://localhost` WebView needs the cleartext and
  mixed-content settings loosened).
- TLS, a hosted or cloud server, an installer or a shell (Electron, Tauri).
- Several viewers sharing one session (the welcome carries `session` so that it can come later), and a reconnect after a lost link
  (the session goes with its worker).
- A "Desktop detail" profile with finer cells or more embers, worker threads that split one run, WebAssembly, WebGPU.

Results are the same program's. They are not guaranteed identical to a phone's: a different JavaScript engine and version may
round differently. What is tested is that the transport changes nothing: the same scenario and seed through the in-thread
controller and through this host give identical snapshots, bit for bit, at identical simulation times.

## How it is built

- `main.ts` the command line, `cli.ts` the flags, `server.ts` the host (HTTP, the WebSocket, sessions), `security.ts` the code, the
  rate limit and the Origin check, `staticFiles.ts` the static files, `lan.ts` the addresses, `engine.ts` and `engineWorker.ts` the
  worker thread (`SimHost` on `parentPort`, with codec frames).
- The simulation is TypeScript with extension-less imports, which Node cannot load as it is, so `build.mjs` bundles `main.ts` and
  `engineWorker.ts` for Node with Vite (the repository's bundler; `ws` stays outside) into `desktop/.build/`, which is not tracked.
  `npm run desktop` is `node desktop/run.mjs`: build, then start.
- `ws` and `@types/ws` are the only additions, as devDependencies: nothing of the host is in the app bundle.
- `npx tsc --noEmit` type-checks `desktop/` with the rest of the repository.
- Tests: `npx vitest run desktop src/sim/remote`. They include the real worker thread and the determinism comparison.
