# source this (bash or zsh) from anywhere:   source prototypes/dotnet-b/env.sh
#
# One build environment for every task: the .NET 11.0.100 SDK (local, official checksummed tarball, plus the android, maui-android, wasm-tools and
# wasm-experimental workloads), the Microsoft OpenJDK, the Android SDK and a NuGet cache. Nothing is installed system-wide. TOOLCHAIN.md lists every
# piece with its version, URL, hash and licence, and says how to reinstall it. Never run a downloaded install script.
#
# Parameters (all optional, set them before sourcing):
#   FIRESIM_SCRATCH        directory that holds the toolchain; default: the session scratchpad below
#   FIRESIM_DOTNET_ROOT    the SDK; default $FIRESIM_SCRATCH/dotnet-sdk
#   FIRESIM_ANDROID_ROOT   holds sdk/ (Android SDK), msjdk/ (Microsoft JDK) and nuget/ (package cache); default $FIRESIM_SCRATCH/android-t2
#
# Fs.Transport/env-android.sh is kept as a thin wrapper that sources this file.

_fs_here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd)"

export FIRESIM_SCRATCH="${FIRESIM_SCRATCH:-/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad}"
export FIRESIM_DOTNET_ROOT="${FIRESIM_DOTNET_ROOT:-$FIRESIM_SCRATCH/dotnet-sdk}"
export FIRESIM_ANDROID_ROOT="${FIRESIM_ANDROID_ROOT:-$FIRESIM_SCRATCH/android-t2}"

# ---- .NET SDK ----
export DOTNET_ROOT="$FIRESIM_DOTNET_ROOT"
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
# keep build servers and msbuild node reuse from lingering in a shared container (a surviving compiler server also keeps /tmp/firesim-heavy.lock held)
export DOTNET_CLI_USE_MSBUILD_SERVER=0 MSBUILDDISABLENODEREUSE=1 UseSharedCompilation=false
[ -x "$DOTNET_ROOT/dotnet" ] || echo "env.sh: no dotnet at $DOTNET_ROOT (set FIRESIM_DOTNET_ROOT or FIRESIM_SCRATCH; see TOOLCHAIN.md)" >&2

# ---- JDK: Microsoft Build of OpenJDK only (dotnet-maui-doctor) ----
# JAVA_HOME is deliberately NOT set (the doctor: MAUI auto-detects Microsoft OpenJDK at its known install paths). This container presets JAVA_HOME to a
# non-Microsoft system JDK, which the doctor calls an anomaly, so it is unset for this shell. The JDK here lives in the scratchpad, not at a known
# path, so the documented MSBuild property JavaSdkDirectory (read from the environment) points the build at it, and the same JDK is first on PATH so
# the Android command-line tools (sdkmanager) use it.
unset JAVA_HOME
_fs_jdk="$(ls -d "$FIRESIM_ANDROID_ROOT"/msjdk/jdk-* 2>/dev/null | sort -V | tail -1)"
if [ -n "$_fs_jdk" ]; then
  export JavaSdkDirectory="$_fs_jdk"
  export PATH="$_fs_jdk/bin:$PATH"
else
  echo "env.sh: no Microsoft JDK under $FIRESIM_ANDROID_ROOT/msjdk: Android builds will not work (see TOOLCHAIN.md)" >&2
fi

# ---- Android SDK ----
if [ -d "$FIRESIM_ANDROID_ROOT/sdk" ]; then
  export ANDROID_HOME="$FIRESIM_ANDROID_ROOT/sdk"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  _fs_bt="$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
  _fs_cmd="$(ls -d "$ANDROID_HOME"/cmdline-tools/*/ 2>/dev/null | sort -V | tail -1)"
  export PATH="$ANDROID_HOME/platform-tools:${_fs_bt:+${_fs_bt}:}${_fs_cmd:+${_fs_cmd}bin:}$PATH"
fi

# ---- NuGet cache, kept beside the SDK so the session can be cleaned in one go ----
if [ -d "$FIRESIM_ANDROID_ROOT/nuget" ]; then export NUGET_PACKAGES="$FIRESIM_ANDROID_ROOT/nuget"; fi

unset _fs_here _fs_jdk _fs_bt _fs_cmd
