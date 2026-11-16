# source this (bash) for the Android build of Fs.Transport. Everything lives under the session scratchpad; see BUILD.md for how it was installed.
# If the paths are gone, redo BUILD.md section 1.
_S=/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad
export DOTNET_ROOT=$_S/dotnet-sdk
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

# JDK: Microsoft Build of OpenJDK only (version = jdk.recommendedVersion of the Android workload's WorkloadDependencies.json).
# JAVA_HOME is deliberately NOT set (dotnet-maui-doctor: the MAUI/Android tools auto-detect Microsoft OpenJDK at their known install
# paths, e.g. /usr/lib/jvm/msopenjdk-*). This sandbox keeps the JDK in the scratchpad, which is not a known path, so detection would
# otherwise fall through to the system's non-Microsoft OpenJDK in /usr/lib/jvm. The documented MSBuild property JavaSdkDirectory
# (an environment variable of that name is read by MSBuild as a property) points the build at the Microsoft JDK, and the same
# JDK is first on PATH so the Android command-line tools (sdkmanager, a java launcher script) use it too.
# this container presets JAVA_HOME to the system OpenJDK (non-Microsoft): the doctor calls that an anomaly; unset it for the build shell
unset JAVA_HOME
_JDK=$(echo $_S/android-t2/msjdk/jdk-*)
export JavaSdkDirectory=$_JDK
export PATH="$_JDK/bin:$PATH"

# Android SDK: ANDROID_HOME is auto-detected by the tools; set because the SDK is in the scratchpad.
export ANDROID_HOME=$_S/android-t2/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/37.0.0:$PATH"
# the command-line tools live in $ANDROID_HOME/cmdline-tools/<version>/bin (see BUILD.md); use the latest directory present
_CMD=$(ls -d $ANDROID_HOME/cmdline-tools/*/ 2>/dev/null | sort -V | tail -1)
[ -n "$_CMD" ] && export PATH="${_CMD}bin:$PATH"

# NuGet cache kept beside the SDK so the session can be cleaned in one go
export NUGET_PACKAGES=$_S/android-t2/nuget
# keep build servers and msbuild node reuse from lingering in a shared container
export DOTNET_CLI_USE_MSBUILD_SERVER=0 MSBUILDDISABLENODEREUSE=1 UseSharedCompilation=false
unset _S _JDK _CMD
