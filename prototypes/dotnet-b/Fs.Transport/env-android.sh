# source this (bash) for the Android build of Fs.Transport.
# Kept so existing instructions keep working: the Android build environment (Microsoft JDK, Android SDK, NuGet cache, JAVA_HOME unset) is now part of
# ../env.sh, which every task sources. The reasoning for each setting is in the comments there; TOOLCHAIN.md lists what is installed.
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd)/../env.sh"
