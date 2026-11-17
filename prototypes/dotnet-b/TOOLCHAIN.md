# Toolchain (option B prototype)

Written by card T0.4, 2026-11-16, from what is installed in this container (Linux x64, 4 shared cores, 16 GB, no `/dev/kvm`). Everything sits under the
session scratchpad (`FIRESIM_SCRATCH`, default in `env.sh`); nothing is system-wide. `source prototypes/dotnet-b/env.sh` selects all of it.
Rules kept: SDK and JDK from checksummed official archives (never a downloaded install script), workloads only with an explicit `--version`, never
`workload update` or `repair`, Microsoft OpenJDK only, `JAVA_HOME` unset.

## 1. How to use it

| Need | Command (from the repository root) |
|---|---|
| Environment | `source prototypes/dotnet-b/env.sh` (also sets the Android environment; `Fs.Transport/env-android.sh` is a wrapper that sources it) |
| Move the toolchain | set `FIRESIM_SCRATCH` (holds `dotnet-sdk/` and `android-t2/{sdk,msjdk,nuget}`) or `FIRESIM_DOTNET_ROOT` / `FIRESIM_ANDROID_ROOT` before sourcing |
| Build and test everything in the solution | `dotnet test --solution prototypes/dotnet-b/FsProto.slnx` (native Microsoft.Testing.Platform mode, chosen in `global.json`) |
| Test one project | `dotnet test --project prototypes/dotnet-b/Fs.Tests` |
| Demonstrate the solver rules | `bash prototypes/dotnet-b/Fs.Analyzers/tools/demo-bad-solver.sh` (throwaway copy; section 5) |
| Heavy work | `flock /tmp/firesim-heavy.lock <command>` (env.sh already sets `DOTNET_CLI_USE_MSBUILD_SERVER=0 MSBUILDDISABLENODEREUSE=1 UseSharedCompilation=false`; a surviving compiler server keeps the lock's file descriptor open and blocks the next builder) |
| Restore in locked mode | `CI=true` or `-p:RestoreLockedMode=true` (section 4) |

Hello builds (not in the solution, so later tasks can copy them; all three were run from a clean clone, section 6):

| Hello | Folder | Rebuild |
|---|---|---|
| 1. `net11.0` console | `hello/console/` | `dotnet run --project prototypes/dotnet-b/hello/console` |
| 2. WebAssembly library, Mono AOT | `hello/wasm/` (`Microsoft.NET.Sdk.WebAssembly`, `OutputType=Library`, one `[JSExport]` class) | `flock /tmp/firesim-heavy.lock dotnet publish prototypes/dotnet-b/hello/wasm -c Release -p:RunAOTCompilation=true` then `node prototypes/dotnet-b/hello/wasm/run-node.mjs prototypes/dotnet-b/hello/wasm/bin/Release/net11.0/publish/wwwroot/_framework` |
| 3. MAUI template, `net11.0-android`, Release APK | `hello/maui-android/` (the `dotnet new maui` template, Android only, `android-arm64`) | `flock /tmp/firesim-heavy.lock dotnet build prototypes/dotnet-b/hello/maui-android -c Release -p:AndroidPackageFormats=apk -p:EmbedAssembliesIntoApk=true`; the APK is `bin/Release/net11.0-android/android-arm64/au.firesim.hello-Signed.apk` |

## 2. What is installed

### 2.1 .NET SDK and runtimes

| Item | Version | Source | Hash | Licence |
|---|---|---|---|---|
| .NET SDK | 11.0.100 (`11.0.100-rtm.26529.118`, commit `297acf930fb0f5c07fd4e51d78e521b4ad2e5d1f`), with runtimes Microsoft.NETCore.App 11.0.0 and Microsoft.AspNetCore.App 11.0.0, Roslyn 5.12.0-1.26529.118 | `https://builds.dotnet.microsoft.com/dotnet/Sdk/11.0.100/dotnet-sdk-11.0.100-linux-x64.tar.gz` | SHA-512 `1bec9cca2ec689b1e80245b84f2b53c9441d1aa6daccf2ceb27490768bffa95954fa585bd275def31069d874d543d9ba9e6591fe9ade2dbd9f34ec5c0fd0050c`, equal to the `hash` of that file in `https://builds.dotnet.microsoft.com/dotnet/release-metadata/11.0/releases.json` (release 11.0.0, support phase `active`) | MIT (`LICENSE.txt` and `ThirdPartyNotices.txt` in the SDK folder). No click-through. |
| `global.json` | `sdk.version 11.0.100`, **`rollForward: latestPatch`** (plan section 3: was `latestFeature`), `test.runner: Microsoft.Testing.Platform` | `prototypes/dotnet-b/global.json` | | |

Reinstall: download that tarball into a new empty directory, check the SHA-512 above, extract it into `$FIRESIM_SCRATCH/dotnet-sdk` (the project's `README.md` section "SDK").

### 2.2 Workloads

`dotnet workload --version` reports workload set **`11.0.100.1`**; every install used `--version 11.0.100.1`, and `dotnet workload --info` says "Configured to use
workload sets". All installs used the local `dotnet` (`$FIRESIM_DOTNET_ROOT/dotnet`).

| Workload | Installed by | Command | Manifest |
|---|---|---|---|
| `maui-android` (pulls in `android`) | T0.2/T2 session, before this card (log `android-t2/wl2.log`, whose first attempt stopped for lack of disk and was repeated) | `dotnet workload install maui-android android --version 11.0.100.1` | `microsoft.net.sdk.maui` 11.0.0, `microsoft.net.sdk.android` 37.2.31 |
| `wasm-tools` and `wasm-experimental` | **this card**, 2026-11-16, under `flock /tmp/firesim-heavy.lock`, 50.7 s once it had the lock (the lock wait was about 13 minutes, behind another builder) | `dotnet workload install wasm-tools wasm-experimental --version 11.0.100.1` | `microsoft.net.workload.mono.toolchain.current` 11.0.100 (both workloads share it), emscripten manifest `microsoft.net.workload.emscripten.current` 11.0.100 |

`wasm-experimental` is for the labelled threads experiment only (plan T1.6b): it supplies `Microsoft.NETCore.App.Runtime.Mono.multithread.browser-wasm`.
`dotnet workload list` after the install: `maui-android 11.0.0/11.0.100`, `wasm-experimental 11.0.100/11.0.100`, `wasm-tools 11.0.100/11.0.100`.
The CoreCLR browser-wasm runtime (`Microsoft.NETCore.App.Runtime.browser-wasm`, plan 10.2, `UseMonoRuntime=false`) came with `wasm-tools`.

### 2.3 Packs on disk after the installs (`packs/`, `library-packs/`, `template-packs/`)

All from nuget.org (the .NET workload installer's default feed). The hash is the SHA-512 that nuget.org's catalog lists for the package
(`https://api.nuget.org/v3/registration5-gz-semver2/<id>/<version>.json`, field `packageHash`); the installer verifies package signatures itself
and keeps no copy of the `.nupkg`, so the hashes were fetched from the catalog on 2026-11-16, not recomputed from the downloads.
(a) nuget.org shows `licenseUrl` deprecated for the dotnet/android packs; the dotnet/android repository is MIT. (b) `Microsoft.NET.Runtime.Emscripten.*` ship
Emscripten, LLVM/Clang, Binaryen and Node under their own licences (the package's licence URL is the dotnet/emsdk LICENSE).
Two versions of a few packs (10.0.15 beside 11.0.0, Android SDK 36.1.118 beside 37.2.31, Microsoft.Maui.Sdk 10.0.110 beside 11.0.0) are what the
workload set records for the .NET 10 fallback; the .NET 11 build uses the 11.0.0 / 37.2.31 ones.
The `wasm-tools` / `wasm-experimental` install fetched **29 packs** (log `T0.4/wasm-install.log` in the scratchpad), not only the WebAssembly ones: it also added the Android
Mono runtime and AOT cross-compiler packs for `android-arm`, `android-x86`, `android-x64`, `android-arm64` (11.0.0 and 10.0.15) and `Microsoft.Android.Runtime.NativeAOT.37.android-arm`,
apparently because the mono-toolchain manifest of this workload set ties them to the same workload (not investigated further). `packs/` is now 5.0 GB; `dotnet-sdk/` grew from 1.6 GB to 5.5 GB.

| Pack | Version | Where | SHA-512 of the .nupkg on nuget.org (base64) | Licence |
|---|---|---|---|---|
| Microsoft.Android.Ref.37 | 37.2.31 | pack | `l5EAQDgYeVavnZZP1U1gxaN2SY3JSKTtHx2aXC0DOVXHLDkYTSU4MZqb0QFIz2gySRhARcmGyAj54r5oAAYfTQ==` | MIT (a) |
| Microsoft.Android.Runtime.37.android | 37.2.31 | pack | `v++EWAbf1utF/NkPePD9yXJszvs299x8q9ojJ2o2Zr59Yr9QSsTDP/iswtUVeaNAoSU6iPCtSIIYusUOEdE8+A==` | MIT (a) |
| Microsoft.Android.Runtime.CoreCLR.37.android-arm | 37.2.31 | pack | `TrKZCtk5GrmXZJfKQ26NHd5YdOVjNUi4eeONdfVek38b2s3YpCgfBDdLi1Cm+Ub5kjHrrr3dKcrN5flrsabrlg==` | MIT (a) |
| Microsoft.Android.Runtime.CoreCLR.37.android-arm64 | 37.2.31 | pack | `TDUSf+pxzEy0ZDiLRIUFOIAsS30x84n2SK0WVsCZ7Izko67TGWEtGG20O/Tni5pucEA3DACb6VsqkPzMJR44Fg==` | MIT (a) |
| Microsoft.Android.Runtime.CoreCLR.37.android-x64 | 37.2.31 | pack | `e9iv1wBDz3CCJgq0WSNvS12Y5iovw76IplLoOhsss/DxXwSvB2GL3QlzbBWZOuYEs8PwUBcL55kVK5s57Spmuw==` | MIT (a) |
| Microsoft.Android.Runtime.Mono.37.android-arm | 37.2.31 | pack | `5YH7Y+PUf6UqoqvEK1n4dOFYaKcgt5ia6XR7tv6Xn7owtQs6+uZpSC5ib+aILZrXaI+t6O+WIoGKdm1WGUccFw==` | MIT (a) |
| Microsoft.Android.Runtime.Mono.37.android-arm64 | 37.2.31 | pack | `JyCWFew2Yvsy1pBb6nasCCszYvIdxOCNtC7m8O3xeJhTDVPCoL4fM8mk+eCBuW01rEQ62QCsczuzFUBjxp2QCg==` | MIT (a) |
| Microsoft.Android.Runtime.Mono.37.android-x64 | 37.2.31 | pack | `X8CnmxObLMUQpMVPZHQ+GdS8QSvVU+4bXfcdQN51jY7ahuLvOxt4ZUmGAbAX80K02ASQA6Hyf25FIWnD1ruqmA==` | MIT (a) |
| Microsoft.Android.Runtime.Mono.37.android-x86 | 37.2.31 | pack | `AFzPHHkxlxmkvMkXc3tQV0idPkhgpbBNW+9uJp5ezq2zVxnrPfyyu60aL7zbkXBECoWPuEPtQXHtNrbIqKSx6Q==` | MIT (a) |
| Microsoft.Android.Runtime.NativeAOT.37.android-arm | 37.2.31 | pack | `YWbBz7r2SiwaCbsbMIaeY44WG7Uiphi6q4N39Ynv9CWYVVfAwmRH5NoqZRQgqoqNJ4GWr0We4b4meDx7uGt/QA==` | MIT (a) |
| Microsoft.Android.Runtime.NativeAOT.37.android-arm64 | 37.2.31 | pack | `wsVf+YlXoGjau6KVN3R56z06J7njR3EXOCjx12Da3EgtogjDadL4hnXp0DLKrTlt2MHsLA1YN7/L639g0ceaHw==` | MIT (a) |
| Microsoft.Android.Runtime.NativeAOT.37.android-x64 | 37.2.31 | pack | `/5UNMiO8zm5P9fYImLW1JOPY6bS1IUOUscpNd9sWfucE6MOAMS70sEC6x741qJZ2vYOPALzgiztsTxsR0TNd+A==` | MIT (a) |
| Microsoft.Android.Sdk.Linux | 36.1.118 | pack | `Z7pF/XqYvrTJIWCN9/IldZ3zTKUK/joqfXjIWQ5a4tTYyH2FwD7LQO6VxlBw36ST96L95b1gzDlbRkaTNW8aMg==` | MIT (a) |
| Microsoft.Android.Sdk.Linux | 37.2.31 | pack | `tC1J3INXeaRd1/TBtsjjJCdEJhuUrA5R7ehV4P8iU2na7vTDKDHZ6+fV9rFqC/Z/ggBxmn7FZufG2JoZsdPY0w==` | MIT (a) |
| Microsoft.AspNetCore.App.Ref | 11.0.0 | pack | `T9BWMgotaWwAXEEVKvh+5ShetSaGVkGPnb9KTSJn12kOy7fsta1S/l99min5DOeeTdXQnz0M1CwoVwHS1iWBCA==` | MIT |
| Microsoft.Maui.Sdk | 10.0.110 | pack | `kles/FitTlxYtR1SKk031FvNm2F4DJh7gGlPUNLGlfrkFuydB6+5HjmvXZHyw40enOjjfhm3cpAxSnrIQW3RFg==` | MIT |
| Microsoft.Maui.Sdk | 11.0.0 | pack | `+2k7/BnZ25vdBElTaeXDHbSPZDsSkYfpi0vtM1dLxpzXWfxtaVy5crvQgQ3SqBhHkPc/gRPawZd3cVLbB/J5cg==` | MIT |
| Microsoft.NET.Runtime.Emscripten.6.0.2.Cache.linux-x64 | 11.0.0 | pack | `tP+AkLNlASRShLDOkrefmfOwYuyzuG6uVFpRQzoTDCC3GjBoIoUv3QlRp/kkZT06DPZdCXfNxZzJEKMRl2g4Ug==` | emsdk LICENSE (b) |
| Microsoft.NET.Runtime.Emscripten.6.0.2.Node.linux-x64 | 11.0.0 | pack | `lHR+EWsxyiV3KaSDKPvrfK9N5A2Prso5Au6hkMOzl1u2c9oC7jHQQbrtP7yyFBPugt0+j0NcEVyLh/gWd72cqg==` | emsdk LICENSE (b) |
| Microsoft.NET.Runtime.Emscripten.6.0.2.Sdk.linux-x64 | 11.0.0 | pack | `jTeQJe3YwQIwGkCSKH9TEBovR4OBev0ukHkceCv3A5pP9YXe8W7Ph915ocrjZf/iSmKtNXGu83TZy81E1JOf3Q==` | emsdk LICENSE (b) |
| Microsoft.NET.Runtime.MonoAOTCompiler.Task | 10.0.15 | pack | `SuQrYFIF5UVYNWXu7MlPNoQkeRVPQck+MWTHdu3do9cby3uDW9P6LWNbWNXSi3Jaw8Az/+FFpjaRZ5D9azGoJw==` | MIT |
| Microsoft.NET.Runtime.MonoAOTCompiler.Task | 11.0.0 | pack | `WMZJy8P2aoYZEeNfUCzz7FmJUstUfywotxwx8xBKHcQcOy9UXw8sZ5Lq9rAKTxEPIOtmj+Lh2flGiraOPP56xw==` | MIT |
| Microsoft.NET.Runtime.MonoTargets.Sdk | 10.0.15 | pack | `bWQ1hoXPsWsZcdFgCH2uu0BObE/dee7vvmxwSsE5EpZaJlxk5f6XtNJ1fq/B8i3FtFf+8uOs+99qfxf6wWMeIw==` | MIT |
| Microsoft.NET.Runtime.MonoTargets.Sdk | 11.0.0 | pack | `TTZ1YfPzngku9zlTHAyUBWbfOBuWrxmwfNYW51K/8rLp33VIxYcb4DQZ70AtVW7aOEQaY/3IFD0pSG35qUvKnA==` | MIT |
| Microsoft.NET.Runtime.WebAssembly.Sdk | 11.0.0 | pack | `Qk1wa008BX/LU2WpOUSDTJ8GqXO9H5uNrpVqO9US4+BjmO1wBAK8n8EXMPYAbJ2SxwdWK9DL9kr6Ql76pXVfyA==` | MIT |
| Microsoft.NETCore.App.Host.linux-x64 | 11.0.0 | pack | `p9VMbSVN0vWAf1oj+NTm2Yuki5lU+7evJplPeiZ2C89B12L6Y2JrTAdzvETFKFzHPxn/4cRmy5tI4tJ/Ed5hbA==` | MIT |
| Microsoft.NETCore.App.Ref | 11.0.0 | pack | `ayOUxbNOZF/+5LIvk+x4a1MVWzezfT21L51sUNjrSPXI9hXyy1RhHGvnzzsFCaY2fcT++B7sXjY2mRtf/GFz9A==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-arm | 10.0.15 | pack | `knAdP7RUvf6iD5fRunXROBjUHP73Low/J+DRiUjM9Ff4D87i7CIpEVXe2F7MTtcWq5yB4Q5Q7ElAlhFVRtzIgg==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-arm | 11.0.0 | pack | `O8fZ8yfKaKdNXoPTyX8yS9g7jgwnazCcLyaApx9CB1V7KuT7ycKGHGWUt8QKChCWADq92CEc1lJQRe/oSrSe0A==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-arm64 | 10.0.15 | pack | `x9gDJcT1SB0s4WI/4jTGOLo64Xl3OwNtCQfTKUCmt4eTvOWqVmTwPa1QtRhgLr7EZm/2rC9FUNxXoPyXeVTj9w==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-arm64 | 11.0.0 | pack | `CUG5oqj8VLHfn9+V92mr6Boi13TrWF+CJlQPwaAF64A6d+gEOoAkq5NMh9J0/+S/0+NOw+dE700Z68nIzCcMAQ==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-x64 | 10.0.15 | pack | `H3Aqc91wYj4f0AnTZpFgwmdiCSMhQQ+xud/vnVfYTEpPl/g//lyP7HzWge0B1UiAQe/YNQ/6V36glu55bYZ2QQ==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-x64 | 11.0.0 | pack | `wwnXOEDRjqNn2WrIdGGBX7Uvn4ZK/dG16dtq2JsZ64WrEkLJ6sJAehCxFQyVW3OuIpD3/OWWaDBypo1rMk1b9A==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-x86 | 10.0.15 | pack | `irCWNpa4MCvXljppD64BnfLT+FBmD/zPYyrp0eQsSczMdxYblpvGsKRovTgniJlyNEvziuRksXSJP8lHsJeKIg==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.android-x86 | 11.0.0 | pack | `Ej73dY56NaYPnh1EjoyQI9bgWhVd1XbM+iHTzOuw5+14JpREMYN5C4jDXRloV/cYYW93nHrjR5XcSlABNZvXMw==` | MIT |
| Microsoft.NETCore.App.Runtime.AOT.linux-x64.Cross.browser-wasm | 11.0.0 | pack | `dcsO6kkjSaUAK2YvcK2Icfwo9Rn2i5zg5bYeFfcP4dOMXlAdZDvN1eeICP0m3XAh+EnkGHes9De9klXGLSczCA==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-arm | 10.0.15 | pack | `a/2WNZf/R6MnVCUU+stOW1gmQYJijXkADVxzpPLicXbIHi4QBZB2B54NupjU16mPQ3RMMqZFrcLGsIYi1f355Q==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-arm | 11.0.0 | pack | `ID6hDLAMSqnAH/a4KugJepZOgL8iBp64Ow2+PcBw/43t+gJsjklh3AdLEVgS7Kac1UzFgpeZJPxOpC9Pgvu7ig==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-arm64 | 10.0.15 | pack | `IZGY8iGvtVsn0ytaqvMwqvpSt01z2Xmh03KPNLQSMWEFs6eF+XkvwGiDk09wNhah36w1CYW2OKGYnc8XZYQBEw==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-arm64 | 11.0.0 | pack | `rqBuMVY9qzS+j+NXg6uqX9LMnYEY+6ZMDUJzUhTAwgMPLLorJXl4dZRjiO517uL741FMwKVPVPI+xd7fCv59bg==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-x64 | 10.0.15 | pack | `73rCBzmIu1Z4eX1bVrUP4YdhH5IosYp0d/tY+XTC3n2fgTXmb0XU4zuaVEosElHogIkPjKfkWRjsldBjNqiDYg==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-x64 | 11.0.0 | pack | `VAbEgSPLr8pB3Iu4x6JobuuLPi0F8y8FLaS0o0NdGSu4nrodtARYVseFIso66NMp+Nopt1UuzNUMQLDlEfO9ZA==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-x86 | 10.0.15 | pack | `SXnib1SlEkleLcrY46qV9wfIWndoSUT0g5sRXv3PuHRUgGDJp6l+FNBbSzm9oAMkxSZpCIMaAbVqTOixsFJTDg==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.android-x86 | 11.0.0 | pack | `58jmUa6S7HQ8i6x7z8xu4lWoXF1ro3nalF6ZZZ5dArCoUn88vytOk06mNZbgdZpmvph2v/oR5HIGkJqY5ol4hg==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.browser-wasm | 11.0.0 | pack | `lvhs7AGJBQBsMXiNhkpcAD2FDQoUSknlqz8mIqWNYkyfdN2joern056lfoKBV1nsAjeMkFJ6DJ8oy/6ifDTRlA==` | MIT |
| Microsoft.NETCore.App.Runtime.Mono.multithread.browser-wasm | 11.0.0 | pack | `k17fwwQ442vV3WYoj/L2T+QDI37L/bJigHHxtQdZN960ph65ROVDfCJMFAL2w/Zdr3O3EsWVjjA5dP6eV8h0eg==` | MIT |
| Microsoft.NETCore.App.Runtime.browser-wasm | 11.0.0 | pack | `3RYvyYgUgacVvzjlH1Kh4i6H1vH6+TG1/BIrL3Zg2B+whU5clBd2uQ5UrXc3w4lSbxWIo7UlLjCpQj4uzIDnXA==` | MIT |
| microsoft.aspnetcore.components.webview.maui | 11.0.0 | library-packs | `Hr4F0/MCiAET/tRaSsQpz9oFCirKkB6ToUw6kmTKI8CFaXLjUFTECyCEUuOsMMH98h1G1IQvbROm7TS5Hkh9Vw==` | MIT |
| microsoft.maui.controls | 11.0.0 | library-packs | `S9kMHBuGTS3u8VGmpDBMwgGeOT339bAtsEuv0WSEFLNhleV5WQYvY89DxrcqGKVoWww+4IW2v1W5p5/m77oFRQ==` | MIT |
| microsoft.maui.controls.build.tasks | 11.0.0 | library-packs | `7tlPeqfNs5xFbI8S4pFigan/JpCnyqGW+RdpDHmvKfMDwuiwDy264kvB8seV081xkQBwvEU+RZ7GttRkpvKz6w==` | MIT |
| microsoft.maui.controls.core | 11.0.0 | library-packs | `2KkYNC5aowPS1RqSdAqXPs2gIpce8k40gGod8rvjVrPNz/nikDXg/8YoWWPCFVAj+iIAS7nMcdMmZrp4Yw+X0g==` | MIT |
| microsoft.maui.controls.xaml | 11.0.0 | library-packs | `/q78qt0pLqddNkFwq56vFJW8rkY88cyK7pBmCvCiRShSKPitaTX2rVZNbLWocaWZWFFqgOFd57xQRN8DfFM1KQ==` | MIT |
| microsoft.maui.core | 11.0.0 | library-packs | `4FixKJM9B3dOWKpxgT4Nspva6ZlDP8q9JXwNyu2kAuqfO2QSdaY/VEwxI6WdAq01n01PLYxZTWI0RL3LDT9QVg==` | MIT |
| microsoft.maui.essentials | 11.0.0 | library-packs | `2qQhk1oJgSTLz/OFuGkZqHDfTqW2qZSoPI2jU3mEBg2nBnHdmuyeEZakR71bg446TGP94eyvNyk85MGP06nbjg==` | MIT |
| microsoft.maui.graphics | 11.0.0 | library-packs | `rkhZwQNxkRyttQkg+ZgWrX0FH2b4we8g3mlb8gt/jzlvn1OlZRa2Y3oU+JSLy1mXs6dnj/Tj2MX7c2bdTSSHtQ==` | MIT |
| microsoft.maui.resizetizer | 11.0.0 | library-packs | `SesIXr6oRUrgxiwgTRkmrjuQDn27R81Q0JtUGew5FiesC29F+02ZwyRPP8AH0j/28p5RMsnPeg04/LVeSkuQTg==` | MIT |
| microsoft.net.sdk.webassembly.pack | 11.0.0 | library-packs | `ZhyMyJhJzuPhm9+4YIzpSsTIZ+WQ+tX8PKLog5e8ITg9809Kkurqu25mwLU4cY7AoxT/JxBrfbFECTI+hGAz6g==` | MIT |
| microsoft.android.templates | 37.2.31 | template-packs | `mMvd2LlPjwuFgmpD7J8Pc9oHv/ethyTBhosb+54EaqoW5CFZ4BzJ3qLE6SkXMyV7AzD6uE6fgsa8E552H7jaoA==` | MIT (a) |
| microsoft.maui.templates.net10 | 10.0.110 | template-packs | `7wp7HFU6JmttjARYe7S0B/m9zX5lLMFpIVZGU+p2UEx/YnhDcZp4dgQcUPtpiZAZuXs0ZTXOfNYRcJL6F2e2xg==` | MIT |
| microsoft.maui.templates.net11 | 11.0.0 | template-packs | `v+PEf6QZhXYfpWvc2Sj4daFf1e2lNw1K8+/ey8S2gJjwWpl/zygZ5MZwAvUQmNbKRuDOz1Gq5SGIWi2cOmxrwA==` | MIT |
| microsoft.net.runtime.webassembly.templates.net11 | 11.0.0 | template-packs | `n9VxcDxo45A1aCbqtTej+t0m74GojSOo9vyQzJGVTHQ40R1aabiYE8NF4chIHZhyH9IaGDWza+jeyRfA5d796A==` | MIT |

### 2.4 JDK

| Item | Version | Source | Hash | Licence |
|---|---|---|---|---|
| Microsoft Build of OpenJDK | 21.0.9+10-LTS (`Microsoft-12574458`), the `jdk.recommendedVersion` (21.0.9, range [21.0,26.0)) of `WorkloadDependencies.json` of the android manifest 37.2.31 | `https://aka.ms/download-jdk/microsoft-jdk-21.0.9-linux-x64.tar.gz` | SHA-256 `753711b08bc9f404021f292c76d16ffdace1958878b4b911e4fc7c02a537a94f`, checked with Microsoft's `microsoft-jdk-21.0.9-linux-x64.tar.gz.sha256sum.txt` (`sha256sum -c`: OK) | GPL-2.0 with the Classpath Exception (OpenJDK); Microsoft's distribution terms. No click-through. |

Installed into `$FIRESIM_ANDROID_ROOT/msjdk/jdk-21.0.9+10`. `JAVA_HOME` is unset by `env.sh` (the container presets it to a non-Microsoft system JDK, which
`dotnet-maui-doctor` calls an anomaly) and `JavaSdkDirectory` points the build at the Microsoft JDK.

### 2.5 Android SDK (`$FIRESIM_ANDROID_ROOT/sdk`)

Packages come from `WorkloadDependencies.json` (non-optional ones only: no emulator, no NDK). Hashes: the SHA-1 that Google's repository manifest
`https://dl.google.com/android/repository/repository2-3.xml` lists for each archive (`sdkmanager` verifies them itself); fetched 2026-11-16.

| SDK package | Version | Archive | SHA-1 (Google's manifest) |
|---|---|---|---|
| `cmdline-tools;21.0` | 21.0 | `https://dl.google.com/android/repository/commandlinetools-linux-15641748_latest.zip` | `63523a02a975a81102238566f2a16c057d52301e` |
| `platform-tools` | 37.0.1 | `https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip` | `477254aa5f903c15cf51001717bdf347fb6b53e0` |
| `platforms;android-37.0` | 37.0 (revision 2, API 37) | `https://dl.google.com/android/repository/platform-37.0_r02.zip` | `ed8ebf7f8822a4de5686d427f237d2fa30ff7410` |
| `build-tools;37.0.0` (aapt2, apksigner, zipalign) | 37.0.0 | `https://dl.google.com/android/repository/build-tools_r37_linux.zip` | `70954e99f4c3d9d46ee70fa32624672fe7cd6ebe` |
| bootstrap only (used to run the first `sdkmanager`, then replaced by `cmdline-tools;21.0`) | cmdline-tools 23.0.0 | `https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip` | SHA-256 `0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8` and SHA-1 `e025545c62a8e64c7559119566a569fb1dec5f60`, recomputed on 2026-11-16 (the SHA-1 equals Google's manifest entry; the install session's `sha256sum -c` also said OK, its reference value was not kept) |

**Licences accepted.** The Android SDK License Agreement (`android-sdk-license`, licence hash `24333f8a63b6825ea9c5514f83c2829b004d1fee`) is what
the four packages above need. The install session ran `yes | sdkmanager --licenses`, which accepted **all** the licences the manager offered, so seven
more are recorded in `sdk/licenses/` although no package here needs them: `android-sdk-preview-license` (`84831b94…`), `android-googletv-license`
(`601085b9…`), `android-googlexr-license` (`ceff8357…`), `android-sdk-arm-dbt-license` (`859f3176…`), `google-gdk-license` (`33b6a2b6…`),
`microxr-sysimage-license` (`3a7848b1…`), `mips-android-sysimage-license` (`e9acab5b…`). Nothing from those was installed.

### 2.6 NuGet packages (direct references; every resolved version and content hash is in the `packages.lock.json` beside each project)

Source nuget.org through the container's proxy; cache `NUGET_PACKAGES=$FIRESIM_ANDROID_ROOT/nuget`. All MIT.

| Project | Direct packages (version) |
|---|---|
| `Fs.Analyzers` (netstandard2.0) | Microsoft.CodeAnalysis.CSharp 5.0.0 (PrivateAssets all), NETStandard.Library 2.0.3 |
| `Fs.Kernel` (solver) | Microsoft.CodeAnalysis.BannedApiAnalyzers 5.6.0 (from `Solver.props`); no other package (System.Numerics.Tensors went with the `Pyrogenic/` salvage, T1.4b) |
| `Fs.Tests` | MSTest 4.5.3 (Microsoft.Testing.Platform runner), Microsoft.CodeAnalysis.CSharp 5.0.0, Microsoft.CodeAnalysis.BannedApiAnalyzers 5.6.0 (assets excluded: it only supplies the DLL that a test loads) |
| `Fs.Bench` | BenchmarkDotNet 0.16.0-preview.2 (0.15.8 cannot run net11.0) |
| `Fs.Compare`, `Fs.Host` | none |
| `hello/console` | none |
| `hello/wasm` | Microsoft.NET.Sdk.WebAssembly.Pack 11.0.0, Microsoft.NET.ILLink.Tasks 11.0.0 (implicit) |
| `hello/maui-android` | Microsoft.Maui.Controls 11.0.0 (the workload's `library-packs` copy), Microsoft.Extensions.Logging.Debug 11.0.0, Microsoft.NET.ILLink.Tasks 11.0.0 (implicit) |

## 3. Findings

### 3.1 NETSDK1242: Mono on Android is refused by the 11.0.100 SDK (confirms plan section 3)

`Microsoft.NET.Sdk/targets/Microsoft.NET.TargetFrameworkInference.targets`, target **`_CheckForUnsupportedMonoMobileRuntime`**, runs before restore when
`UseMonoRuntime=true`, the target framework is `.NETCoreApp` 11.0 or later and the platform is `ios`, `tvos`, `maccatalyst` or `android`
(`Condition` line 144 of that file; it raises `NETSdkError ResourceName="MonoRuntimeNotSupportedForPlatform"`). The only switch in the file is the
property `_DisableCheckForUnsupportedMonoMobileRuntime`, which is private and was **not** used.

Confirmed by building the MAUI hello with the Release flags plus `-p:UseMonoRuntime=true` (in the clean clone, 0.7 s, exit 1); the exact error:

```
.../Sdks/Microsoft.NET.Sdk/targets/Microsoft.NET.TargetFrameworkInference.targets(146,5): error NETSDK1242: Building Android projects with the Mono runtime is not supported in .NET 11.0 and later. Use the CoreCLR runtime or target .NET 10.0. [.../hello/maui-android/HelloMaui.csproj]
```

(The same project without `UseMonoRuntime` builds: the Android runtime is CoreCLR, `libcoreclr.so` and `libclrjit.so` are in the APK.)

### 3.2 The .NET Android build signs with its own debug key, not `/root/.android/debug.keystore`

The hello APK is signed by a **new** debug key that the .NET Android tooling created during this card's build, at
`/root/.local/share/Xamarin/Mono for Android/debug.keystore` (created 2026-11-16 13:55). `apksigner verify --print-certs` shows `CN=Android Debug, O=Android, C=US`,
RSA 3072, certificate SHA-256 `94aa0085fe7f7e899a2deb68684435d3f0bf654dfdc9d863d223c787239e4da3`. **That is not the key of the installed FireSim
0.8.0** (plan section 3: SHA-256 `f7570f27…a862e7`, the file `/root/.android/debug.keystore`). A test APK with a different application id (all of
them: `au.firesim.*`) is unaffected, but an APK meant to update the installed app, or any test APK that must be installable over another built with the "debug key"
of the plan, has to be signed with `/root/.android/debug.keystore` explicitly: MSBuild properties `AndroidKeyStore=true`, `AndroidSigningKeyStore`,
`AndroidSigningKeyAlias`, `AndroidSigningStorePass`, `AndroidSigningKeyPass` (the two passwords through `env:` references, never on the command line or in a file).
T0.3 and T0.5 must decide which key the test APKs use; this card did not sign with the plan's key and did not read or print any key material.
The new keystore is also only in this container; it is not committed.

### 3.3 Other points

- Hash and version facts for packs are fetched, not recomputed (section 2.3). The one archive recomputed here is the Android bootstrap zip.
- `wasm-tools` brings its own Node (Emscripten Node pack) for linking; the check run of the published WebAssembly used the container's Node 22.22.0.
- Disk: 11 GB were free after all the builds (16 GB before the install; other builders were also running). The workload install added 3.9 GB to the SDK folder
  (section 2.3); the clean clone with the three hello builds is 640 MB (`obj`+`bin`: MAUI 197 MB, WebAssembly 120 MB, console under 1 MB). The 8 GB floor held at every check.
- A stale `VBCSCompiler` from another builder held `/tmp/firesim-heavy.lock`'s file descriptor open for a while; `UseSharedCompilation=false` in `env.sh` avoids
  creating more of them.

## 4. Locked packages

`Directory.Build.props`: `RestorePackagesWithLockFile=true` for every project under `prototypes/dotnet-b/`; `packages.lock.json` is committed beside each project
(`Fs.Analyzers`, `Fs.Bench`, `Fs.Compare`, `Fs.Host`, `Fs.Kernel`, `Fs.Tests`, `hello/*`; `Fs.Transport` gets its file the first time it is restored). With `CI=true`
(or `-p:RestoreLockedMode=true`) a restore that would change a version fails. All the clean-clone builds in section 6 ran in locked mode. To change a version on purpose:
edit the `.csproj`, restore once without locked mode, commit the new lock file.

## 5. The analyzers

**Where they apply.** `Directory.Build.props` lists the solver projects: `FsSolverProjects` = `Fs.Kernel;Fs.Wasm` (by `MSBuildProjectName`; add a name to put another
project under the rules). Only those import `Fs.Analyzers/Solver.props`, which adds (1) `Microsoft.CodeAnalysis.BannedApiAnalyzers` 5.6.0 with `BannedSymbols.txt` as an
additional file (rule `RS0030`), (2) the `FS0001` analyzer as an analyzer reference. `.editorconfig` at the root of `prototypes/dotnet-b` makes both **errors**
and switches both off for the files named `FsMath.cs` and `FsConv.cs` (anywhere in a solver project, so the later tasks that create them in `Fs.Kernel/` need no change here) and for
`Fs.Kernel/ThirdParty/**` (the vendored CoreMathSharp). **Since card T1.4b nothing else is exempt**: the `Fs.Kernel/Pyrogenic/**` section (the K1 salvage, which used `Math.Sin`, `TensorPrimitives` and raw casts) was deleted when that
folder was brought under the rules of 10.4; `demo-bad-solver.sh` case 3 now shows that a bad file there fails the build, and `Fs.Tests/SolverExemptionTests.cs` pins the list of exempt paths. `Fs.Bench`, `Fs.Transport`, `Fs.TestApp`, `Fs.Host`, `Fs.Results`, `Fs.Tests`, `Fs.Compare` and the hello projects are not solver projects and run no rule.

**`BannedSymbols.txt`** (702 lines after card T0.4c; 668 after T0.4b; 437 before; generated by `Fs.Analyzers/tools/GenBannedSymbols.cs` with `dotnet run Fs.Analyzers/tools/GenBannedSymbols.cs > BannedSymbols.txt`; a bare
`M:System.Math.Exp` bans nothing, each overload needs its own full ID, which is why it is generated) bans, as plan T0.4 step 5 and section 10.4 say:

- every `System.Math` and `System.MathF` method with a floating-point parameter except `Abs`, `Sqrt`, `Floor`, `Ceiling`, `Truncate`, `CopySign`, `Min` and `Max`
  (so `Sin`, `Exp`, `Pow`, `Cbrt`, `Atan2`, `Log*`, `Sign`, `Clamp`, `IEEERemainder`, `BitIncrement`, `ReciprocalEstimate`, `ScaleB` ... are banned), plus **every `Math.Round` overload**
  and `Math.FusedMultiplyAdd`. `Min`/`Max` stay allowed: 10.4 says to port them literally and C#'s match JavaScript's (NaN propagates, -0 < +0). `Math.PI` and `Math.E` are constants, allowed.
- `double`, `float` and `Half` static members that duplicate those (`double.Exp`, `float.Sin`, `double.Hypot`, `Round`, `FusedMultiplyAdd`, `*Estimate`, every `*Native`);
  the generic-math interfaces `IExponentialFunctions<>`, `IHyperbolicFunctions<>`, `ILogarithmicFunctions<>`, `IPowerFunctions<>`, `IRootFunctions<>`, `ITrigonometricFunctions<>`,
  `IFloatingPoint<>`, `IFloatingPointIeee754<>`, `IBinaryFloatingPointIeee754<>` (so `T.Exp(x)` is caught).
- `System.Numerics.Tensors` (the namespace, and `TensorPrimitives`), `System.Numerics.Vector<T>` and the static class `System.Numerics.Vector`, and on `Vector64/128/256/512`
  every `Sum`, `Dot`, `Round`, transcendental, `*Estimate`, `FusedMultiplyAdd` and `*Native` member.
- **Card T0.4b added three families** (generator sections 5 to 7; 230 new entries; everything was found by reflection over the running runtime, 11.0.0, not guessed):
  1. **Hardware fused multiply-add through the intrinsics.** The type `System.Runtime.Intrinsics.X86.Fma` and all 32 of its members (hardware FMA; the type ban also catches `Fma.IsSupported`);
     every `FusedMultiply*` member of `Avx512F` (32), `Avx10v1` (8), `AdvSimd` (12), `AdvSimd.Arm64` (24) and `Sve` (12): one rounding on CPUs that fuse, two where they do not
     (WebAssembly never fuses); and every `MultiplyAdd*` / `MultiplySubtract*` member of the X86 and Arm intrinsics classes that takes a float or double element (in .NET 11 only five `Sve` forms: `MultiplyAddRotateComplex*` and `TrigonometricMultiplyAddCoefficient`;
     `AdvSimd.MultiplyAdd` has integer overloads only, and the integer `MultiplyAddAdjacent`, `Sve2` integer forms are exact and stay allowed). Already banned by T0.4 and re-tested here:
     `Math/MathF/double/float/Half.FusedMultiplyAdd`, `Vector64/128/256/512.FusedMultiplyAdd`, `IFloatingPointIeee754<T>.FusedMultiplyAdd` (generic math). **Relaxed SIMD:** .NET 11.0.0 has no
     `Relaxed*` members (`Wasm.PackedSimd` has none) and nothing relaxed on `Vector64/128/256/512`; their `*Estimate` and `*Native` members were already banned. The completeness test reports a new member after a runtime upgrade.
  2. **Float-to-integer conversion in `System.Convert`.** Every `Convert.To*` overload with a `float` or `double` parameter, except those returning a floating-point type (`ToDouble(float)`: exact; `ToSingle(double)`:
     the IEEE narrowing a `(float)` cast does) or a string (`ToString(double)`: formatting). That bans `ToSByte/Byte/Int16/UInt16/Int32/UInt32/Int64/UInt64/Char/Decimal/Boolean/DateTime` for `double` and for `float`
     (`Convert.ToInt32(double)` rounds half to even, a third rule beside the cast and JavaScript's). **Beyond the card, same hole behind `object`:** `Convert.ChangeType` (4 overloads), `Convert.To{integer,Char,Decimal,Boolean}(object[, IFormatProvider])`
     and `IConvertible.To{integer,Char,Decimal,Boolean}` convert a boxed double the same way. 50 `Convert` + 11 `IConvertible` entries. Allowed neighbours: `Convert.ToDouble(int)`, `ToInt32(string)`, `ToInt32(long)`, `ToString(double)`, `ToHexString`.
     `Math.Truncate/Floor/Ceiling` stay allowed (they return floating-point values); `Math.Round` stays banned.
  3. **Generic-math conversions.** `CreateTruncating`, `CreateSaturating`, `CreateChecked` on `sbyte byte short ushort int uint long ulong nint nuint Int128 UInt128 BigInteger` (39 entries) and on `INumberBase<T>`
     (3 entries: `T.CreateTruncating(d)` in generic code binds to the interface member). `char` has no public `Create*` (only the interface reaches it), so the interface entries cover it. `double/float/Half.Create*` (to a floating-point type) stay allowed.
     `FsConv.cs` is exempt by file name and may use any of these.
- **Card T0.4c added three families** (generator sections 8 to 10; 34 new entries, 702 lines in all; again found by reflection over the running runtime):
  1. **The platform-intrinsics namespaces, outright** (`N:` entries): `System.Runtime.Intrinsics.X86`, `.Arm` and `.Wasm` (the generator takes every `System.Runtime.Intrinsics.*` child namespace of the runtime's assembly, so a
     fourth one, say `.RiscV`, would be banned on regeneration and the completeness test `EveryPlatformIntrinsicsNamespaceIsBannedAndThePortableOnesAreNot` would name it). Reason: the estimate and approximation intrinsics
     (`Sse.Reciprocal/ReciprocalSqrt`, `Avx.Reciprocal*`, `Avx512F.Reciprocal14/ReciprocalSqrt14`, `AdvSimd.ReciprocalEstimate/ReciprocalSquareRootEstimate/*Step`, the `Sve` equivalents), hardware fused operations and
     `IsSupported` branches give different results on different hardware, and no solver code needs them: the portable `Vector64/128/256/512<T>` API is enough. **How `RS0030` reports it** (checked on BannedApiAnalyzers 5.6.0):
     every *use* of a type of the namespace (`Sse.Reciprocal(v)`, `Fma.IsSupported`, `Avx2.X64.IsSupported`, `AdvSimd.ReciprocalEstimate(v)`, `PackedSimd.Add(a, b)`, a fully qualified name) is an error whose message names **the namespace**
     (`The symbol 'System.Runtime.Intrinsics.X86' is banned ...`), once per use; a type that has its own entry (`Fma` from T0.4b) is reported under its own entry only; a `using System.Runtime.Intrinsics.X86;` line is not reported (only uses are).
     `System.Runtime.Intrinsics` itself, `Vector64/128/256/512<T>` and the static classes `Vector64/128/256/512` are in the parent namespace and stay allowed, minus the members banned by T0.4/T0.4b/this card. `ISimdVector<,>` is internal in .NET 11 and cannot be called.
     `Sve` is evaluation-only (`SYSLIB5003` is a compile error unless suppressed); suppressing it does not get past the ban (tested). The exact integer operations that T0.4b kept allowed (`Sse2.MultiplyAddAdjacent`, `AdvSimd.Add`) are banned with the rest of the namespace.
     The T1.2 kernels (`Fs.Kernel/SpeedTest/CopyKernel.cs`, `StencilKernel.cs`) have `using System.Runtime.Intrinsics;` only and compile unchanged (portable `Vector128`): nothing to fix.
  2. **`Vector64/128/256/512.ConvertToInt32`, `ConvertToInt64`, `ConvertToUInt32`, `ConvertToUInt64`** (16 entries; the 16 `*Native` forms were already banned by T0.4): a fourth float-to-integer rule (saturating in .NET 11). `ConvertToDouble` and `ConvertToSingle` (integer to float) stay allowed.
  3. **Beyond the card, same family, found while checking the runtime by reflection** (15 entries): `ConvertToInteger<TInteger>` on `double`, `float`, `Half` and `decimal` (the `Native` forms of the first three were already banned; `decimal.ConvertToIntegerNative` is new) and `decimal.ToByte/SByte/Int16/UInt16/Int32/UInt32/Int64/UInt64/ToDouble/ToSingle`,
     the decimal casts of FS0001 under another name. `Math.SinCos` and `MathF.SinCos` (tuple results) are already banned by T0.4.
- **Not banned, on purpose** (all IEEE-defined or exact, so the same on every runtime): `Math.Min/Max` (10.4); `Vector64/128/256/512.ConvertToDouble/ConvertToSingle` (integer to float); the casts `(float)d`, `(double)h`, `(Half)d`, `(decimal)d`, `(double)i`;
  `Vector128.Narrow/WidenLower/WidenUpper`; `Truncate/Floor/Ceiling` on vectors and scalars.
- **Not banned, still open** (not in the card; the owner may say yes): `decimal.Round/Floor/Ceiling/Truncate` and `decimal.ToOACurrency` (decimal arithmetic is exact and the solver has no decimals; a rule "no `decimal` type at all" would be simpler than banning members one by one).
  Not a hole: a compound assignment `i += d` does not compile in C# (CS0266) unless `d` converts to `int` implicitly.

**`FS0001`** (`Fs.Analyzers/FloatToIntegerCastAnalyzer.cs`, netstandard2.0, Roslyn 5.0.0 API): reports every explicit built-in conversion from `float`, `double` (or a nullable of them) to
`sbyte`, `byte`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`, `nint`, `nuint`, `char` or an enum, in checked and unchecked context alike. It ignores compile-time constants and
the user-defined conversions of the program's own types. The exemption is by file name, in `.editorconfig`, not in the analyzer.
**Card T0.4c extended it** (the same message, `Explicit cast from 'Half' to 'int' ...`): `Half` and `decimal` are structs of the runtime whose conversions are user-defined operators, so the analyzer no longer skips every user-defined conversion,
it decides by the source and target types. Now reported: `Half` or `decimal` to every integer target above (and to an enum); `decimal` to `float`, `double` or `Half`; and, beyond the card, any of `float`, `double`, `Half`, `decimal` to `Int128`, `UInt128`
or `BigInteger` (user-defined operators too) and the cast hidden in `foreach (int x in doubles)` (found with the semantic model's `ForEachStatementInfo`; a compound assignment `i += d` needs no rule, C# rejects it). Still allowed: `(double)h`, `(float)h`,
`(Half)d`, `(Half)i`, `(decimal)d`, `(decimal)i`, `(Int128)long`, `(double)Int128`, `(int)Int128`, constants such as `(int)1.5m`, conversions of the program's own types.

**Tests** are in `Fs.Tests` (one project; the analyzer is referenced as an ordinary assembly there): `FloatToIntegerCastAnalyzerTests` (63 flagged and 39 not-flagged rows plus 5 facts after T0.4c; 19, 13 and 3 before),
`BannedSymbolsTests` (the file is complete against Roslyn's own documentation IDs of the running runtime, the allowed functions stay allowed, and the real `BannedApiAnalyzers` DLL, run in
process over snippets with the file as `AdditionalFiles`, reports `RS0030` for 78 banned calls (22 from T0.4, 56 from T0.4b: 20 FMA, 16 `Convert`, 15 integer `Create*`, 5 generic-math snippets, among them `T.CreateTruncating` and `T.FusedMultiplyAdd`) and nothing for 27 allowed ones (13 + 14 neighbours:
`Math.Truncate/Floor/Ceiling/CopySign`, `Vector128.Add/ConditionalSelect`, `Sse2.MultiplyAddAdjacent`, `AdvSimd.Add`, `Convert.ToDouble(int)`, `Convert.ToInt32(string)`, `double.CreateTruncating(int)` ...), `SmokeTests`.
T0.4b adds completeness tests for the three families (`EveryFusedMultiplyAddIntrinsicIsBanned`, `EveryConvertToOverloadWithAFloatingPointParameterIsBanned`, `EveryIntegerCreateTruncatingSaturatingAndCheckedIsBanned`: each re-derives the expected set from Roslyn's symbols
of the running runtime and fails on a missing or a wrongly banned ID) and `TheFileIsOnlyCommentsAndWellFormedEntriesWithoutDuplicates` (a compiler warning printed to stdout would land in the file through `> BannedSymbols.txt`). With the old 437-line file 50 of the
171 tests then in `Fs.Tests` fail, so the new cases do test the new bans. A failure of a completeness test after a runtime upgrade means "regenerate the file".
**Card T0.4c** takes `Fs.Tests` from 247 to 396 tests, all passing (`dotnet test --project Fs.Tests -c Release`: 396 of 396, 24 s): 72 in the FS0001 tests (70 rows, 2 facts) and 77 in the banned-symbol tests: 64 new `RS0030` rows (30 for the namespaces, among them `Sse.Reciprocal`, `Sse.ReciprocalSqrt`, `Avx512F.Reciprocal14`, `AdvSimd.ReciprocalEstimate`, `PackedSimd.Add`, `Fma.IsSupported`, `Avx2.X64`, `Sve` with `SYSLIB5003` suppressed, and fully qualified names;
22 for the `Vector64/128/256/512.ConvertToInt32/Int64/UInt32/UInt64` and `Native` forms; 12 for `ConvertToInteger` and `decimal.ToXxx`), 13 new not-reported rows (3 old ones moved out, so 10 net; `Vector128.ConvertToDouble/ConvertToSingle/WidenLower/Narrow/Floor`, `Vector256/512.Add`, `decimal.Add`, `double.IsNaN` ...), and three completeness tests
(`EveryPlatformIntrinsicsNamespaceIsBannedAndThePortableOnesAreNot`, `EveryVectorConvertToIntegerOverloadIsBannedAndTheOnesToFloatAreNot`, `EveryConvertToIntegerAndDecimalToNumberStaticMethodIsBanned`). Three rows that T0.4b listed as allowed neighbours (`Sse2.Add/Multiply`, `Sse2.MultiplyAddAdjacent`, `AdvSimd.Add`) moved to the banned list.

**Demonstration** (`bash Fs.Analyzers/tools/demo-bad-solver.sh`, in a `mktemp` copy that holds only `Directory.Build.props`, `.editorconfig`, `global.json`, `BannedSymbols.txt`, `Fs.Analyzers/` and
two stub projects `Fs.Kernel` and `Fs.Other`). Case 1, a file `Fs.Kernel/Bad.cs` containing
`(int)x + (int)Math.Exp(x)` and `Math.Round(x) + Math.Sin(x) + Math.Sqrt(x)`, fails the build (paths shortened, URLs cut):

```
Build FAILED.
Fs.Kernel/Bad.cs(1,59): error FS0001: Explicit cast from 'double' to 'int' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
Fs.Kernel/Bad.cs(1,68): error FS0001: Explicit cast from 'double' to 'int' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
Fs.Kernel/Bad.cs(1,73): error RS0030: The symbol 'Math.Exp(double)' is banned in this project: use FsMath.Exp (plan 10.4): Math.Exp is not on the allowed list (Abs, Sqrt, Floor, Ceiling, Truncate, CopySign, Min, Max) (https://github.com/dotnet/roslyn/blob/main/src/RoslynAnalyzers/Microsoft.CodeAnalysis.BannedApiAnalyzers/BannedApiAnalyzers.Help.md)
Fs.Kernel/Bad.cs(1,124): error RS0030: The symbol 'Math.Round(double)' is banned in this project: use FsConv.Round (JavaScript Math.round: halves up): Math.Round has other tie rules (...)
Fs.Kernel/Bad.cs(1,140): error RS0030: The symbol 'Math.Sin(double)' is banned in this project: use FsMath.Sin (plan 10.4): Math.Sin is not on the allowed list (Abs, Sqrt, Floor, Ceiling, Truncate, CopySign, Min, Max) (...)
```

**Case 1b (card T0.4b)**, `Fs.Kernel/BadT04b.cs`, one line per new ban (each line is its own method; paths shortened, the help URL cut from every line; run on .NET SDK 11.0.100, `flock` and `env.sh` as usual):

```
Build FAILED.
Fs.Kernel/BadT04b.cs(3,61): error RS0030: The symbol 'Fma' is banned in this project: hardware fused multiply-add: results differ between CPUs that fuse and CPUs or WebAssembly that do not (plan 9, 10.4)
Fs.Kernel/BadT04b.cs(3,61): error RS0030: The symbol 'Fma.MultiplyAdd(Vector128<double>, Vector128<double>, Vector128<double>)' is banned in this project: hardware multiply-add may be fused (one rounding) or not (two): X86.Fma.MultiplyAdd differs between CPUs and WebAssembly (plan 9, 10.4): write a * b + c
Fs.Kernel/BadT04b.cs(4,59): error RS0030: The symbol 'AdvSimd.FusedMultiplyAdd(Vector128<float>, Vector128<float>, Vector128<float>)' is banned in this project: hardware multiply-add may be fused (one rounding) or not (two): Arm.AdvSimd.FusedMultiplyAdd differs between CPUs and WebAssembly (plan 9, 10.4): write a * b + c
Fs.Kernel/BadT04b.cs(5,61): error RS0030: The symbol 'AdvSimd.Arm64.FusedMultiplyAdd(Vector128<double>, Vector128<double>, Vector128<double>)' is banned in this project: hardware multiply-add may be fused (one rounding) or not (two): Arm.AdvSimd.Arm64.FusedMultiplyAdd differs between CPUs and WebAssembly (plan 9, 10.4): write a * b + c
Fs.Kernel/BadT04b.cs(6,59): error RS0030: The symbol 'Vector128.FusedMultiplyAdd(Vector128<float>, Vector128<float>, Vector128<float>)' is banned in this project: element-wise Vector128<T> only; reductions are scalar in a fixed order (plan 9, 10.4): Vector128.FusedMultiplyAdd may differ by hardware
Fs.Kernel/BadT04b.cs(7,39): error RS0030: The symbol 'double.FusedMultiplyAdd(double, double, double)' is banned in this project: use FsMath (plan 10.4): Double.FusedMultiplyAdd calls the platform maths library or an estimate
Fs.Kernel/BadT04b.cs(8,36): error RS0030: The symbol 'Convert.ToInt32(double)' is banned in this project: use FsConv (JavaScript conversion semantics, plan 10.4): Convert.ToInt32(Double) rounds half to even, a third rule beside the cast and JavaScript's
Fs.Kernel/BadT04b.cs(9,36): error RS0030: The symbol 'Convert.ToInt64(float)' is banned in this project: use FsConv (JavaScript conversion semantics, plan 10.4): Convert.ToInt64(Single) rounds half to even, a third rule beside the cast and JavaScript's
Fs.Kernel/BadT04b.cs(10,39): error RS0030: The symbol 'Convert.ChangeType(object?, Type)' is banned in this project: use FsConv: Convert.ChangeType on a boxed double or float converts with its own rounding (half to even), a third rule beside the cast and JavaScript's
Fs.Kernel/BadT04b.cs(11,36): error RS0030: The symbol 'int.CreateTruncating<TOther>(TOther)' is banned in this project: use FsConv (plan 10.4): Int32.CreateTruncating converts a float or double with its own rounding or saturation, not by a visible cast
Fs.Kernel/BadT04b.cs(12,37): error RS0030: The symbol 'byte.CreateSaturating<TOther>(TOther)' is banned in this project: use FsConv (plan 10.4): Byte.CreateSaturating converts a float or double with its own rounding or saturation, not by a visible cast
Fs.Kernel/BadT04b.cs(13,62): error RS0030: The symbol 'INumberBase<TSelf>.CreateChecked<TOther>(TOther)' is banned in this project: use FsConv (plan 10.4): INumberBase<T>.CreateChecked converts a float or double with its own rounding or saturation, not by a visible cast
```

The script checks that all 11 symbols appear (and that no FS0001 does: the file has no cast), else it exits 1.

**Case 1c (card T0.4c)**, `Fs.Kernel/BadT04c.cs`, one method per line (A to G: the namespaces; H to K: the vector conversions; L, M: the static conversion methods; `#pragma warning disable SYSLIB5003` on line 2 because `Sve` is evaluation-only). Paths shortened, help URL cut, same SDK and flags:

```
Build FAILED.
Fs.Kernel/BadT04c.cs(5,59):  error RS0030: The symbol 'System.Runtime.Intrinsics.X86' is banned in this project: platform intrinsics are banned in solver code: estimate, approximation and fused operations differ by hardware (plan 9, 10.4): use the portable Vector64/128/256/512<T> API   <- Sse.Reciprocal(v)
Fs.Kernel/BadT04c.cs(6,59):  error RS0030: The symbol 'System.Runtime.Intrinsics.X86' is banned in this project: ...   <- Sse.ReciprocalSqrt(v)
Fs.Kernel/BadT04c.cs(7,61):  error RS0030: The symbol 'System.Runtime.Intrinsics.X86' is banned in this project: ...   <- Avx512F.Reciprocal14(v)
Fs.Kernel/BadT04c.cs(8,59):  error RS0030: The symbol 'System.Runtime.Intrinsics.Arm' is banned in this project: ...   <- AdvSimd.ReciprocalEstimate(v)
Fs.Kernel/BadT04c.cs(9,29):  error RS0030: The symbol 'System.Runtime.Intrinsics.X86' is banned in this project: ...   <- Avx2.IsSupported
Fs.Kernel/BadT04c.cs(10,29): error RS0030: The symbol 'System.Runtime.Intrinsics.Arm' is banned in this project: ...   <- Sve.IsSupported
Fs.Kernel/BadT04c.cs(11,55): error RS0030: The symbol 'System.Runtime.Intrinsics.Wasm' is banned in this project: ...   <- PackedSimd.Add(v, v)
Fs.Kernel/BadT04c.cs(12,57): error RS0030: The symbol 'Vector128.ConvertToInt32(Vector128<float>)' is banned in this project: use FsConv (JavaScript conversion semantics, plan 10.4): Vector128.ConvertToInt32 is a float-to-integer rule of its own (saturating in .NET 11)
Fs.Kernel/BadT04c.cs(13,59): error RS0030: The symbol 'Vector128.ConvertToInt64(Vector128<double>)' is banned in this project: ... Vector128.ConvertToInt64 is a float-to-integer rule of its own (saturating in .NET 11)
Fs.Kernel/BadT04c.cs(14,58): error RS0030: The symbol 'Vector256.ConvertToUInt32(Vector256<float>)' is banned in this project: ... Vector256.ConvertToUInt32 is a float-to-integer rule of its own (saturating in .NET 11)
Fs.Kernel/BadT04c.cs(15,60): error RS0030: The symbol 'Vector512.ConvertToUInt64(Vector512<double>)' is banned in this project: ... Vector512.ConvertToUInt64 is a float-to-integer rule of its own (saturating in .NET 11)
Fs.Kernel/BadT04c.cs(16,36): error RS0030: The symbol 'double.ConvertToInteger<TInteger>(double)' is banned in this project: use FsConv (JavaScript conversion semantics, plan 10.4): Double.ConvertToInteger saturates, a float-to-integer rule of its own
Fs.Kernel/BadT04c.cs(17,37): error RS0030: The symbol 'decimal.ToInt32(decimal)' is banned in this project: use FsConv (plan 10.4): decimal.ToInt32 is the decimal cast, with a rounding or overflow rule of its own
```

**Case 1d (card T0.4c)**, `Fs.Kernel/BadT04cCasts.cs`, one cast per new FS0001 rule:

```
Build FAILED.
Fs.Kernel/BadT04cCasts.cs(3,34): error FS0001: Explicit cast from 'Half' to 'int' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
Fs.Kernel/BadT04cCasts.cs(4,38): error FS0001: Explicit cast from 'decimal' to 'long' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
Fs.Kernel/BadT04cCasts.cs(5,40): error FS0001: Explicit cast from 'decimal' to 'double' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
Fs.Kernel/BadT04cCasts.cs(6,39): error FS0001: Explicit cast from 'decimal' to 'float' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
Fs.Kernel/BadT04cCasts.cs(7,39): error FS0001: Explicit cast from 'double' to 'Int128' is not allowed in solver code: use FsConv (JavaScript conversion semantics, plan 10.4)
```

The script checks that every namespace line (5 to 11) and every listed symbol appears, that 1c has no FS0001 and 1d no RS0030, else it exits 1. Cases 2 to 4 of the same script now use all four bodies (the T0.4 line, the 11 T0.4b lines, the 13 T0.4c lines and the 5 casts) and all **build**: in `FsMath.cs` and `FsConv.cs` (solver project) and in `Fs.Other` (not a solver project); **case 3 (T1.4b) puts the same code in `Fs.Kernel/Pyrogenic/`, which used to build and now fails with RS0030 and FS0001 for every symbol and cast of cases 1 to 1d**. The script exits 1 if any case behaves otherwise; last run (T1.4b): `demo OK`.
In the repository itself, `dotnet build FsProto.slnx` builds `Fs.Kernel` (every folder under the rules; `Pyrogenic/` since T1.4b) and `Fs.Bench` (which calls `Math`: not a solver project) cleanly.

## 6. Clean-clone verification and timings

`reports/0-toolchain.md` has the timings, the conditions and the output of each step. Summary: from `git clone` of the T0.4 commit into a new directory,
`source env.sh`, locked restore: hello 1 (console) built and ran; hello 2 (WebAssembly, `RunAOTCompilation=true`) published and ran under Node 22 (AOT `.bc` files produced);
hello 3 (MAUI, Release, `AndroidPackageFormats=apk`, `EmbedAssembliesIntoApk=true`) built an arm64 APK, checked with `aapt2 dump badging` and `apksigner verify --print-certs`; `dotnet test --solution FsProto.slnx` passed (75 test cases).
