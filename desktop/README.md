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
Up to 3 simulations at once, each of at most about 3,217 MiB of memory (--max-session-mib). Ctrl+C stops it.
```

The pairing code is printed in the address and nowhere else, once (with `--lan`, once in each address; the `Pairing code:` line says
where to find it and does not repeat it). The page picks it up from the
address (after the `#`, which a browser never sends to a server) and offers the *Desktop* engine on its Setup screen. Without
the code in the address, the page asks for it: type the part after `#code=`.

`--open` starts the default browser (`xdg-open`, `open` or `cmd /c start`) with a **one-use link** and not with the code:

```
http://127.0.0.1:4300/__firesim/open?t=9f2c...   (64 hexadecimal characters: 256 bits from the operating system's random source)
```

The host answers that request once, with a redirect to `/#code=CODE`, and the link is then spent; it is also spent after 60 seconds. So
**the code is never in the argument list of the browser's process** and is not in the list of processes (`ps`) of the computer. What is
there is the link, for as long as the launcher runs: another user of the computer who reads it within the first moments and opens it
before the browser does would get the code (and the owner's browser would be shown "This link was used already or has run out"). On a
computer that other people log in to, that is a race you could still lose; leave `--open` out there and open the address yourself. The
link is on the first address the host printed (`127.0.0.1` unless `--bind` or `--lan` says otherwise), so the page has the same origin, and
the same saved data, as one opened by hand. Only a `GET` spends the link (a `HEAD` or a `POST` does not), the answer is never cached
(`Cache-Control: no-store`, `Referrer-Policy: no-referrer`), the host's log says that a link was used and never what it held, and without `--open` there
is no such path.

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

### The Android and iOS apps, and other pages (`--allow-app`, `--allow-origin`)

The app does not use the page the host serves: it has its own page, and the person types the desktop's address and the code. For the host to
take such a page two things are needed, and both are the owner's:

```
npm run desktop -- --lan --allow-app
```

`--lan` so that another device can reach the host at all, and `--allow-app` (or `--allow-origin ORIGIN`, repeated for each page) so that the
host takes a page of that origin. `--allow-app` lists the two origins of the apps, `https://localhost` (the Android app's WebView, whose
`androidScheme` is `https`) and `capacitor://localhost` (iOS); `--allow-origin` takes any `scheme://host` or `scheme://host:port` with the scheme
`http`, `https` or `capacitor`, written exactly (no path, no `*`, no `null`; a repeat counts once; the banner lists what is allowed).

What a listed origin gets, and what it does not:

- It may open the engine link (the Origin check of the handshake takes it, besides the page the host serves itself and a client with no Origin) **and
  it still needs the code**, with the same limit of 5 wrong codes before an address is refused for 60 seconds.
- It may read `GET /__firesim/host` from its own origin: the host answers with `Access-Control-Allow-Origin` set to **that origin and never to
  `*`**, with `Vary: Origin`, and answers the preflight (`OPTIONS`, 204, the methods `GET, HEAD, OPTIONS`, the headers `Cache-Control, Pragma`, and
  `Access-Control-Allow-Private-Network: true` when the browser asks it). No other path of the host has a CORS header, and there is never
  `Access-Control-Allow-Credentials`.
- **It does not skip the `Host` check.** The host names it allows (below) are checked first, for the app as for every page: an app that
  reaches the host by a name the owner did not allow gets 421. An IP address is always allowed as the `Host` (it is not a name that an attacker can point somewhere), so the typed address
  `192.168.1.20:4300` works; a name such as `desk.lan` needs `--allow-host desk.lan`.
- **An origin is not a secret and not unique.** Every app built with Capacitor for Android has the origin `https://localhost`, so with `--allow-app`
  any such app on a phone that can reach the host may try the code; the Origin check keeps web pages of other origins out, **it does not keep
  other apps out: the code does**. That is why this is a flag the owner gives and not a default, and why the banner says so.
- The link is `ws://` and the page's first request `http://`: an app whose page is `https://localhost` needs its own settings loosened for that
  (the Android lane's work, not the host's), and the traffic is as open as `--lan`'s (no TLS).

### IPv6 and one address (`--lan6`, `--bind`)

`--lan` listens on every IPv4 interface (`0.0.0.0`). `--lan6` listens on every interface over IPv6 (`::`, which on most computers takes IPv4 as
well) and prints every IPv4 and IPv6 address of the computer (an IPv6 address in brackets, `http://[fd00::20]:4300/#code=...`; the link-local
`fe80::` ones are left out: they need the name of the interface, which an address in a browser cannot carry). `--bind ADDRESS` listens on that one
address (`--bind 192.168.1.20`, `--bind ::1` for the IPv6 loopback, `--bind ::`, `--bind 0.0.0.0`) and prints it. Give one of `--lan`, `--lan6` and
`--bind`. A bracketed IPv6 address is in the `Host` allowlist whatever the flag (`Host: [::1]:4300` is this computer), and an address that is
not this computer's is a sentence and exit 1 ("Cannot listen on 192.0.2.99: this computer has no such address. Check --bind.", or, with no IPv6,
"Cannot listen on ::1: this computer has no IPv6 (or it is switched off).").

**IPv6 was not tried on a socket on the build machine** (it has no IPv6 at all: `EAFNOSUPPORT`): the tests of `--bind ::1` and `--lan6` check what
they can there (the refusal with its sentence, the address lists and the `Host` forms as pure functions and over an IPv4 socket) and run the real
IPv6 sockets when the computer has them (`desktop/main.test.ts`).

## Flags

`npm run desktop -- FLAGS` (the `--` is npm's, once).

| Flag | Meaning |
|---|---|
| `--port N` | Port to listen on. Default 4300; `0` picks a free one. |
| `--lan` | Listen on every network interface over IPv4 (`0.0.0.0`) and print every non-internal IPv4 address. Default: `127.0.0.1` only. |
| `--lan6` | Listen on every interface over IPv6 (`::`; on most computers IPv4 too) and print every IPv4 and IPv6 address (not the link-local `fe80::` ones). |
| `--bind ADDRESS` | Listen on this one IPv4 or IPv6 address (`192.168.1.20`, `::1`, `::`, `0.0.0.0`) and print it. Give one of `--lan`, `--lan6` and `--bind`. |
| `--code CODE` | The pairing code: 8 to 32 letters and digits (any case; it is kept in capitals). Default: a random one of 8 characters. Arguments are visible to other users of the computer (`ps`): prefer the random code. |
| `--max-sessions N` | Simulations that may run at once, one worker thread each. Default `max(1, min(4, cores - 1))`. |
| `--open` | Start the default browser with a one-use link (valid 60 s) that redirects to `/#code=CODE`: the code is not in the launcher's arguments. See "Start it". |
| `--name TEXT` | The name users see (default: the computer's name). It is what the welcome says the host is called, once the code was right. |
| `--allow-host NAME` | A name a browser may use to reach this computer, besides an IP address, `localhost`, this computer's own name and its `.local` name (see "Host names" below). Repeat it for more. |
| `--allow-origin ORIGIN` | A page of this origin (`scheme://host` or `scheme://host:port`, exactly, the scheme `http`, `https` or `capacitor`) may open the engine link and read `/__firesim/host` besides the page the host serves. The code is still needed and the `Host` check still comes first. Repeat it for more. |
| `--allow-app` | Shorthand for `--allow-origin https://localhost` and `--allow-origin capacitor://localhost`, the origins of the Android and iOS apps. Any app with that origin can then try the code. Add `--lan` for another device to reach the host. |
| `--max-frame-mib N` | The largest message a page may send, in MiB. Default 128 (a 6 km scenario is 6.5 MB at 30 m and 46.5 MiB at 10 m, a 9 km one 14.5 MiB at 30 m, 28.6 MiB at 20 m and 104.8 MiB at 10 m, 82% of the default: lane K's figures for the Katoomba demo site); above it the host closes the connection with 1009. A 12 km domain at 10 m would not fit. |
| `--max-session-mib N` | The most memory one simulation may be estimated to need, in MiB (at least 64): a scenario whose estimate is above it is refused with an engine error, before anything is built. Default: 60% of the computer's memory (`os.totalmem()`, or the limit of the container it runs in when that is lower: `process.constrainedMemory()`) divided by `--max-sessions`, at least 256. See "What it costs". |
| `--worker-heap-mib N` | The JavaScript heap of one simulation's worker thread, in MiB. Default 4096. See "What it costs": it does not bound the arrays, and a `--max-old-space-size` of Node itself replaces it (the host says so when it starts). |
| `--help` | The usage text. |

Exit codes: 0 after a clean stop (Ctrl+C or `SIGTERM` closes the sockets, ends the workers and exits), 1 when it could not
start (the port is in use or not allowed, or the host could not be built), 2 for a wrong flag or no built app.

## The pairing code

8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0 or 1), drawn from the operating system's random source at every
start, printed once at start and never written to a file or a log line. It is compared in constant time. After 5 wrong codes
from one address, that address is refused for 60 seconds (close code 4429), also with the right code. A browser page must
also have been served by this host, or be of an origin the owner listed (`--allow-origin`, `--allow-app`): the handshake of a page
from any other origin is refused with HTTP 403 (the Origin check; a client with no Origin header, such as a script, is accepted and
still needs the code). A hello of another version of the link than this one (2) is closed with 4426 and says the host's own, in the reason
(`protocol 2`), and it is not counted as a wrong code.

**Before the code the host says as little as it can.** `GET /__firesim/host` says that this is a FireSim host, the version of its link and that
it wants a code, and nothing else (`{"app":"firesim-desktop-host","protocol":2,"requiresCode":true}`); the host's name, its number of cores, its Node
version and how many sessions it has and allows are in the `welcome`, which only a client with the right code gets. (0.8.0's answer, protocol 1,
told all of that to anyone who could reach the port.)

### Host names (DNS rebinding)

The Origin check compares the page's origin with the `Host` header it sent, so a page that an attacker serves from his own name
and then points at this computer (DNS rebinding) has the same name in both and passes it. So every HTTP request and every
WebSocket handshake, the app and `/__firesim/host` included, must also name the host in a way the owner allowed: an IPv4
address, an IPv6 address in brackets (`[::1]:4300`), `localhost`, this computer's own name (`os.hostname()`), `<that name>.local` (what a phone's
mDNS finds), or a name given with `--allow-host`. Any other `Host` gets **421** with an empty body (and one log line per name,
which says to use `--allow-host`), before the Origin check and before the code is looked at, so it cannot lock the owner out with
wrong codes. A router that gives this computer a name of its own (`desk.lan`) needs `--allow-host desk.lan`. Listing an origin does
not change this: the `Host` is checked first, for every page.

**Tried in a real browser, not only with forged headers** (`e2e/host-browser.spec.ts`): Chromium is started with
`--host-resolver-rules="MAP hostile.example 127.0.0.1"`, which makes a page of the attacker's own name reach this computer (the state a rebinding attack
ends in); the page's script reads `/__firesim/host` from its own origin and opens the engine link with the right code. Under the hostile name
the host answers 421 to both, with and without `--lan` and even when the owner has listed the hostile page's origin with `--allow-origin`; under this
computer's own name, in the same page, the same two requests succeed (the control); and with `--allow-host hostile.example` they succeed under the
hostile name too, because the owner allowed it. What is not tried: the browser's own DNS timing (the time an attacker's name takes to change its
address); the host only sees the `Host` header that results.

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

**Measured again in 0.9.0, at three sizes of fire cell** (`node desktop/measure.mjs EXTENT_M TIER RUN_TO_S [CELL_M]`: `SimHost` on a scenario in a
process of its own, `node --expose-gc`, a forced garbage collection at each reading; the 30 m and 20 m rows are the Katoomba demo site, the 10 m rows
are `syntheticScenario({ cellSize: 10 })` of this tree, a slope with one fuel, because the tree has no finer builder of its own; this build machine,
2026-11-08, one run each, the 6 km 10 m row run twice: 549.6 MiB of arrays both times, 694 and 713 MiB resident):

| scenario, tier, run | message | fire cells | held at the end (arrays and JS heap) | process resident | one snapshot |
|---|---|---|---|---|---|
| Katoomba 6 km, fast, 30 m, 1800 s | 6.5 MiB | 40,000 | 97 MiB | 222 MiB | 2.2 MiB |
| Katoomba 9 km, fast, 30 m, 1800 s | 14.5 MiB | 90,000 | 175 MiB | 304 MiB | 4.3 MiB |
| Katoomba 6 km, high, 20 m, 600 s | 12.8 MiB | 90,000 | 211 MiB | 350 MiB | 5.4 MiB |
| 6 km, fast, 10 m (synthetic), 1800 s | 29.9 MiB | 360,000 | 567 MiB | 694 MiB | 15.3 MiB |
| 6 km, high, 10 m (synthetic), 900 s | 29.9 MiB | 360,000 | 587 MiB | 746 MiB | 16.5 MiB |
| 9 km, fast, 10 m (synthetic), 1800 s | 67.2 MiB | 810,000 | 1,242 MiB | 1,372 MiB | 33.8 MiB |

A session holds 12 to 19 times its message (19 at 10 m), and the cost follows the number of fire cells, about 1.3 to 1.5 kB each in the fast tier and the
same at 10 m as at 30 m, not the length of the message. The plan's own runs at 10 m (section 15e: peaks of 1.2 GB for 6 km and 1.9 GB over 9 km after
hours of a growing fire) are above these because a long fire makes the checkpoints and the ember lists larger. A snapshot of 15 MiB or more is **one
frame**: the flow control below holds the run back in whole frames.

**`--max-session-mib`: a scenario is refused when its estimate does not fit.** The estimate (`desktop/sessionEstimate.ts`) is made once, when a scenario
has been decoded and before anything is built, from what the scenario says (the size of the message, its fire grid, its extent, its ember budget): the
repository's own memory model of the engine (`src/scenario/memoryModel.ts`: bytes per fire cell, per column of the 3-D air, per ember, for the
checkpoints, measured from real `Simulation` allocations) for the heaviest tier (a page can raise the tier after the start), with the ring of checkpoints
full, **times 2**, plus the scenario twice (the message and the arrays decoded from it are alive together). It is meant to be above the truth and not
a meter: it is 1.9 to 3.6 times what the nine sessions measured at 30 m and 20 m held (three are in the table), 2.0 to 2.2 times at 10 m, and
1.07 and 1.35 times the plan's 10 m peaks of 1.2 and 1.9 GB (whole processes, hours of fire; with lane K's message sizes of the Katoomba demo site at 10 m, 46.5 MiB for 6 km and 104.8 MiB for 9 km, the estimates are 1,286 and 2,570 MiB); it is the figure that lets a 10 m scenario over 9 km (2,570 MiB estimated, a peak of about 1.9 GB measured) in on a 16 GB computer with 3 sessions and
refuses it on an 8 GB one. `desktop/sessionEstimate.test.ts` pins all of that. The limit it is held to is `--max-session-mib`, by default 60% of the
computer's memory (or the container's limit) divided by `--max-sessions`, so that every slot in use together cannot be estimated to need more than 60%.
A refused scenario is an engine error with the sentence `This scenario is too big for the desktop's free memory.` (the page words it from that
sentence), and the session stays open for a smaller one. What this does **not** do: it does not read the memory that is free now, so it does not
see other programs; it is made from what the scenario claims at the start, so a page that later asks for a bigger ember budget (`setOption`) or a
different tier is not checked again; and it does not replace `--max-frame-mib` (which bounds what a page may send) or `--worker-heap-mib` (a runaway
JavaScript heap).

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
| `GET /__firesim/host` | `{"app":"firesim-desktop-host","protocol":2,"requiresCode":true}` and nothing else: no code, no name, no cores, no Node version, no session count, no paths, no environment. For a listed origin it has `Access-Control-Allow-Origin` (that origin, never `*`) and `Vary: Origin`, and `OPTIONS` of a listed origin is answered (204). |
| `GET /__firesim/open?t=TOKEN` | Only with `--open`: a good one-use token gets a 302 to `/#code=CODE`, anything else 410 and a sentence. Never cached. |
| WebSocket `/__firesim/engine` | One engine session per connection. |

### The engine link

1. The client's first frame must be TEXT, within 5 seconds: `{"type":"hello","protocol":2,"code":"..."}`.
2. The host answers TEXT `{"type":"welcome","session":"<id>","protocol":2,"name":"...","cores":8,"node":"22.22.0","sessions":1,"maxSessions":3}`
   (`sessions` counts this one; `node` has no leading `v`; the name is the host's, `--name`), or closes with **4400** (no good hello in time, or
   a later frame that is not binary), **4401** (wrong code), **4426** (a well formed hello of another version of the link: the reason says the
   host's, `protocol 2`), **4429** (too many wrong codes from this address), **4503** (no free session). A page whose origin is not the host's
   and not listed gets HTTP 403 at the handshake, and a handshake (or any request) with a `Host` that is not one of the host's names gets 421.
   The page's `connectRemote` turns a welcome or a 4426 of another version into a `RemoteVersionError` with both numbers.
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
5. When the link is behind (more than **8 MiB** waiting to be sent; 0.8.0 had 16), the host holds the engine back (the run waits between chunks of
   40 ms: the worker reads the hold within one of them) until the link has caught up (below 4 MiB): the run gets slower and nothing changes in
   its results. A frame is held back whole: one snapshot of a 9 km domain at 10 m is about 34 to 39 MiB, so the queue can be the 8 MiB and one such
   frame, under the 64 MiB that closes a session (item 4); a frame above about 55 MiB (a 12 km domain at 10 m) on a slow link would pass it.
   What this does on a slow link, measured: "The throttled link" under "What it costs".
6. When a session ends (closed, dropped, an error, a stop) its worker thread is terminated and its slot freed. If the worker
   fails, the page gets an `error` message with the first line of the failure (never the stack, which names this computer's
   files; the first line of a message can still name one) and the host closes with 1011.
7. **A scenario that does not fit** (its estimate, "What it costs", is above `--max-session-mib`) is refused when its `init` has been decoded
   and before anything is built: the engine sends the ordinary `error` message `This scenario is too big for the desktop's free memory.`
   (`TOO_BIG_MESSAGE` in `src/sim/remote/wire.ts`, exported by `src/sim/remote`; the page's `init` rejects with exactly that sentence), the host logs
   `refused a scenario: about 2,570 MiB expected, 1,638 MiB allowed for a session (--max-session-mib)`, and **the link stays open**: the session takes
   another, smaller `init` (until one is taken, every other message is dropped as one that came before `init`).

### What the page uses (`src/sim/remote`)

```ts
// detect.ts (small, imports nothing; one GET of <base>/__firesim/host, 800 ms)
interface RemoteHostProbe { app: 'firesim-desktop-host'; protocol: number; requiresCode: boolean }   // what the host says before the code
interface RemoteHostInfo { app: 'firesim-desktop-host'; protocol: 2; name: string; cores: number; node: string; sessions: number; maxSessions: number }  // the welcome
detectHost(o?: { base?: string; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<RemoteHostProbe | null>   // null on any failure; another protocol is still a probe

// index.ts (lazy)
connectRemote(o: { base: string; code: string; probe?: RemoteHostProbe; WebSocketCtor?: typeof WebSocket }): Promise<RemoteConnection>
interface RemoteConnection { controller: SimController; info: RemoteHostInfo; rttMs(): number | null; onClosed(cb: (reason: string) => void): () => void; close(): void }
class RemoteAuthError extends Error { reason: 'wrong-code' | 'rate-limited' }            // the code was refused
class RemoteVersionError extends Error { pageProtocol: number; hostProtocol: number }    // another version of the link: "update the app or the host"
const TOO_BIG_MESSAGE: string                                                            // the engine error of a scenario that does not fit
```

`base` is `http://host:port` (an IPv6 address in brackets, `https:` for `wss:`); `connectRemote` makes no request before the socket (the welcome says what the
host is). A `probe` of another protocol is refused at once with a `RemoteVersionError`; a welcome or a 4426 of another protocol gives the same.
`detectHost` does not judge the version, so that the page can tell "update" from "no desktop answered".

Logs: one line per connect and close with the address and the session id, one per refused connection with the reason (and one
per forged `Host` name), and one the first time a session's link is behind. Never the code, a wrong guess or a scenario.

## What is not here

Each is a later decision (contracts `docs/plans/0.8.0/J-CONTRACT-desktop-host.md`, section 1, and `docs/plans/0.9.0/CONTRACT-0.9.0.md`):

- TLS, a hosted or cloud server, an installer or a shell (Electron, Tauri). The host takes a page of an app's origin since 0.9.0 (`--allow-app`);
  that the app's `https://localhost` page may open a plain `ws://` socket is the app's own setting (the Android lane), not the host's, and was
  not tried on a phone.
- Several viewers sharing one session (the welcome carries `session` so that it can come later), and a reconnect after a lost link
  (the session goes with its worker).
- Worker threads that split one run, WebAssembly, WebGPU. (The finer grid, the "Desktop detail" setting, is the page's and the scenario's; this
  host runs whatever scenario the page sends within `--max-session-mib` and `--max-frame-mib`.)

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

- `main.ts` the command line, `cli.ts` the flags, `server.ts` the host (HTTP, the WebSocket, sessions, CORS for a listed origin, the `--open`
  route), `security.ts` the code, the rate limit, the Origin check (and the origins `--allow-origin` lists) and the Host allowlist,
  `openToken.ts` the one-use link of `--open`, `staticFiles.ts` the static files, `lan.ts` where it listens and the addresses it prints,
  `engine.ts` and `engineWorker.ts` the worker thread (`SimHost` on `parentPort`, with codec frames), `holdGate.ts` the flow control,
  `memoryBound.ts` and `sessionEstimate.ts` the memory a session may be estimated to need.
- `src/sim/remote/wire.ts` is what the page and the host share about the link: its version (2), the close codes and the one sentence of a scenario that is too big.
- The simulation is TypeScript with extension-less imports, which Node cannot load as it is, so `build.mjs` bundles `main.ts` and
  `engineWorker.ts` for Node with Vite (the repository's bundler; `ws` stays outside) into `desktop/.build/`, which is not tracked.
  `npm run desktop` is `node desktop/run.mjs`: build, then start.
- `ws` and `@types/ws` are the only additions, as devDependencies: nothing of the host is in the app bundle.
- `npx tsc --noEmit` type-checks `desktop/` with the rest of the repository.
- Tests: `npx vitest run desktop src/sim/remote`. They include the real worker thread, the determinism comparison, a real host as a process
  (`main.test.ts`: the flags, the banner, `--open` with a launcher injected and with a program named `xdg-open` at the front of the `PATH`) and
  the simulated link (`throttle.test.ts`). `e2e/host-browser.spec.ts` is the real-browser check of the `Host` allowlist (Playwright).
- Two tools, each built and run by a small runner (the folders `desktop/.build-test-*` are ignored by the version control):
  `node desktop/measure.mjs EXTENT_M TIER RUN_TO_S [CELL_M]` (what one session costs in memory) and
  `node desktop/link.mjs SCENARIO LINK HOLD RUN_S` (the throttled-link measurement). See "What it costs".
