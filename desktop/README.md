# FireSim desktop host

A program for a computer that runs the **same TypeScript simulation** the phone runs (`SimHost`, one worker thread per
session), serves the **same web app**, and lets the page use that engine instead of the device's own. It is for the desktop's
own browser and for a phone's browser on the same network. One solver, no second implementation (plan decision D34).

It is opt-in: the app works as before without it, and a phone's own run needs no network.

## Start it

Needs Node 22 (the version the repository already uses) and the repository's packages **with their devDependencies**
(`npm install`, not `npm install --omit=dev`): the host runs from the source tree, and `ws` and Vite, which builds it, are
devDependencies.

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
Pairing code: the part of the address after #code= (the page asks for it when the address has none)
Up to 3 simulations at once. Ctrl+C stops it.
```

The pairing code is printed in the address and nowhere else, once (with `--lan`, once in each address; the `Pairing code:` line says
where to find it and does not repeat it). The page picks it up from the
address (after the `#`, which a browser never sends to a server) and offers the *Desktop* engine on its Setup screen. Without
the code in the address, the page asks for it: type the part after `#code=`.

`--open` opens that address in the default browser by starting a program (`xdg-open`, `open` or `cmd`) with the address as an
argument, so **the address, code included, is in the argument list of that process and visible to the other users of the
computer** (`ps`) for as long as it runs. Leave `--open` out on a computer that other people log in to, and open the address
yourself.

### A phone on the same network

```
npm run desktop -- --lan
```

prints one address for every network address of the computer, each with the code:

```
Open one of these on this computer or on a phone on the same network:
  http://192.168.1.20:4300/#code=ABCD2345
```

With `--lan` the last line of the banner also says "There is no TLS: use this only on a network you trust."

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
| `--name TEXT` | The name users see (default: the computer's name). It is what `/__firesim/host` says the host is called. |
| `--allow-host NAME` | A name a browser may use to reach this computer, besides an IP address, `localhost`, this computer's own name and its `.local` name (see "Host names" below). Repeat it for more. |
| `--max-frame-mib N` | The largest message a page may send, in MiB. Default 128 (a 6 km scenario is 6.5 MB, a 9 km one at 10 m about 83 MB); above it the host closes the connection with 1009. |
| `--worker-heap-mib N` | The JavaScript heap of one simulation's worker thread, in MiB. Default 4096. See "What it costs": it does not bound the arrays, and a `--max-old-space-size` of Node itself replaces it (the host says so when it starts). |
| `--help` | The usage text. |

Exit codes: 0 after a clean stop (Ctrl+C or `SIGTERM` closes the sockets, ends the workers and exits), 1 when it could not
start (the port is in use or not allowed, or the host could not be built), 2 for a wrong flag or no built app.

## The pairing code

8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0 or 1), drawn from the operating system's random source at every
start, printed once at start and never written to a file or a log line. It is compared in constant time. After 5 wrong codes
from one address, that address is refused for 60 seconds (close code 4429), also with the right code. A browser page must
also have been served by this host: the handshake of a page from any other origin is refused (the Origin check; a client with
no Origin header, such as a script, is accepted and still needs the code).

### Host names (DNS rebinding)

The Origin check compares the page's origin with the `Host` header it sent, so a page that an attacker serves from his own name
and then points at this computer (DNS rebinding) has the same name in both and passes it. So every HTTP request and every
WebSocket handshake, the app and `/__firesim/host` included, must also name the host in a way the owner allowed: an IPv4
address, an IPv6 address in brackets, `localhost`, this computer's own name (`os.hostname()`), `<that name>.local` (what a phone's
mDNS finds), or a name given with `--allow-host`. Any other `Host` gets **421** with an empty body (and one log line per name,
which says to use `--allow-host`), before the Origin check and before the code is looked at, so it cannot lock the owner out with
wrong codes. A router that gives this computer a name of its own (`desk.lan`) needs `--allow-host desk.lan`.

## What it costs

Measured on one shared 4-core machine with software GL, on loopback, with the Katoomba demo site (6 km, fast tier): the idle
host is about 70 MB; each session is a worker thread that adds about 110 MB when the scenario is loaded and about 100 MB more
after half an hour of simulated fire (two sessions running 900 s of fire at once: about 470 MB at the peak). A scenario is about
6.5 MB on the wire and one snapshot about 2.2 MB; 1800 s of fire took about 2.4 s and streamed about 27 MB/s to the page (more
than a Wi-Fi link carries: see the flow control below); a round trip on loopback is about 3 ms. A phone over Wi-Fi was never tried.

**Memory grows with the domain a page asks for, not with how long it runs.** A session's memory is the simulation's typed arrays
(they are outside the JavaScript heap): measured with a forced garbage collection, a session for a 30 MB scenario held 571 MB
of them and a 12 MB JavaScript heap, one for an 83 MB scenario 1.58 GB of them and a 16 MB heap, about 17 times the size of the
message. So `--worker-heap-mib` (a worker's `resourceLimits`) bounds only a runaway JavaScript heap, which it ends with an engine
failure; it does not bound the arrays. What bounds them is `--max-frame-mib` (the size of the domain a page can ask for) and
`--max-sessions`; a page that knows the code can still use about 17 times 128 MiB for one session, 2.2 GB, and so can each
session. Leave the code to people you trust.

**After a session closes the process keeps about two thirds of its peak, but it is the allocator's, not objects.** With a forced
garbage collection the host's JavaScript heap was 8 MB and its external memory 4 MB after the worker's arrays were freed (the
83 MB scenario: 1,578 MB resident with the session up, 1,194 MB after it closed). The rest is free memory that the C allocator
holds and gives back to no one until the process ends. It is reused: three sessions of the 30 MB scenario one after the other
left 457, 642 and 654 MB resident, not 457, 914 and 1,371. Restart the host to give it all back.

A `--max-old-space-size` in `NODE_OPTIONS` or on the command line is a V8 flag of the whole process and **replaces**
`--worker-heap-mib` in every worker thread (measured: a worker with a 48 MiB limit filled 300 MB without being stopped when
`NODE_OPTIONS` held one). The host prints a note at start when it finds one.

## What it serves

| Path | |
|---|---|
| `/` and the rest of `dist/` | The built app. Static, path-traversal safe, no directory listings, no dot files; `index.html` is `no-store`. |
| `GET /__firesim/host` | `{"app":"firesim-desktop-host","protocol":1,"name":"...","cores":8,"node":"22.22.0","sessions":0,"maxSessions":3}` and nothing else (no code, no paths, no environment). `node` has no leading `v`. **It tells the host's name, its number of cores and its Node version to anyone who can reach the port**: only this computer by default, and with `--lan` everyone on the network. `--name` changes the name. |
| WebSocket `/__firesim/engine` | One engine session per connection. |

### The engine link

1. The client's first frame must be TEXT, within 5 seconds: `{"type":"hello","protocol":1,"code":"..."}`.
2. The host answers TEXT `{"type":"welcome","session":"<id>","protocol":1}`, or closes with **4400** (no good hello in time, or a
   later frame that is not binary), **4401** (wrong code), **4429** (too many wrong codes from this address), **4503** (no free
   session). A page whose origin is not the host's gets HTTP 403 at the handshake, and a handshake (or any request) with a
   `Host` that is not one of the host's names gets 421.
3. After the welcome every frame is BINARY and carries one message of the simulation protocol (`ToWorker` from the page,
   `FromWorker` from the engine) in the codec of `src/sim/remote/codec.ts`: a header of JSON in which every typed array is a
   placeholder, then the arrays' bytes, each on a multiple of 8. The two link messages `ping` and `pong` (the page measures the
   round trip with them) are answered by the host itself.
4. Limits: a frame may be 4 KB before the welcome and 128 MiB (`--max-frame-mib`) after it (above that the host closes with
   1009); the host pings every 20 s and closes a connection that has been silent for 60 s; a connection that has not said hello
   is dropped after 5 s (its slot is free at once) and counts against a limit of 4 from one address and 16 in all (further ones
   get HTTP 503). A session is closed with **1008** when it sends more than 20 pings or 1000 messages of any kind in one second,
   or when more than 64 MiB have waited to be sent to it for over 10 s. The decoder takes a header of at most 8 MiB and at most
   4096 typed arrays in a message, and refuses an array that lies outside the message or claims more bytes than the message has
   left (so it never makes more than the message is long), and, once all are read, arrays that share bytes (a real 6 km scenario
   is a 123 kB header and 42 arrays). A header with its own `__proto__` field is refused by the decoder and by the encoder. Until the first `init` the engine takes nothing else: any other message is
   dropped, with one log line.
5. When the link is behind (more than 16 MiB waiting to be sent), the host holds the engine back (the run waits between chunks)
   until the link has caught up (below 4 MiB): the run gets slower and nothing changes in its results.
6. When a session ends (closed, dropped, an error, a stop) its worker thread is terminated and its slot freed. If the worker
   fails, the page gets an `error` message with the first line of the failure (never the stack, which names this computer's
   files; the first line of a message can still name one) and the host closes with 1011.

Logs: one line per connect and close with the address and the session id, one per refused connection with the reason (and one
per forged `Host` name), and one the first time a session's link is behind. Never the code, a wrong guess or a scenario.

## What is not here

Each is a later decision (contract `docs/plans/0.8.0/J-CONTRACT-desktop-host.md`, section 1):

- The Android app connecting to a desktop (a plain `ws://` socket from an `https://localhost` WebView needs the cleartext and
  mixed-content settings loosened).
- TLS, a hosted or cloud server, an installer or a shell (Electron, Tauri).
- Several viewers sharing one session (the welcome carries `session` so that it can come later), and a reconnect after a lost link
  (the session goes with its worker).
- A "Desktop detail" profile with finer cells or more embers, worker threads that split one run, WebAssembly, WebGPU.

## What the page does for a host that goes away

The host cannot help a page once it is gone, and a page that the host served can fetch nothing from it then: not the worker script
of the page's own engine, not a screen it has not opened yet. So that *Continue on this device* can start the run on the phone
with no host, the page does two things when it opens the engine link, while the host is surely up: it makes this device's own
engine, idle, and keeps it for the run (one idle worker, whose script, 484,365 bytes or 170,621 gzipped, is fetched from the host
then), and, in idle time, it loads the screens that a running view can still open (the run's label and chip, the debug statistics,
the model card, the Air slice panel, the speed and Wind detail sheets and the Data sets storage report; about 150 kB, 59 kB
gzipped). This is on the page's side and costs this host one more fetch of its own files when a link opens; it needs a page that
was loaded from the host while it was up. What still needs the host is a fresh engine made after it is gone (it cannot fetch its
script), the offer on Setup after the host died at start (it cannot fetch the bundled demo data), the speed test's worker and the
planning chunk of Setup. The page is told that the link has ended by the link itself (`RemoteConnection.onClosed`: the socket
closed or failed with any code, or the host ended the session), not by an error message of the engine, which is only a message.

Results are the same program's. They are not guaranteed identical to a phone's: a different JavaScript engine and version may
round differently. What is tested is that the transport changes nothing: the same scenario and seed through the in-thread
controller and through this host give identical snapshot hashes (every field but the engine's own timing report) at identical
simulation times, and the last snapshot's arrays are the same bit for bit (`desktop/engine.test.ts`).

## How it is built

- `main.ts` the command line, `cli.ts` the flags, `server.ts` the host (HTTP, the WebSocket, sessions), `security.ts` the code, the
  rate limit, the Origin check and the Host allowlist, `staticFiles.ts` the static files, `lan.ts` the addresses, `engine.ts` and
  `engineWorker.ts` the worker thread (`SimHost` on `parentPort`, with codec frames), `holdGate.ts` the flow control.
- The simulation is TypeScript with extension-less imports, which Node cannot load as it is, so `build.mjs` bundles `main.ts` and
  `engineWorker.ts` for Node with Vite (the repository's bundler; `ws` stays outside) into `desktop/.build/`, which is not tracked.
  `npm run desktop` is `node desktop/run.mjs`: build, then start.
- `ws` and `@types/ws` are the only additions, as devDependencies: nothing of the host is in the app bundle.
- `npx tsc --noEmit` type-checks `desktop/` with the rest of the repository.
- Tests: `npx vitest run desktop src/sim/remote`. They include the real worker thread and the determinism comparison.
