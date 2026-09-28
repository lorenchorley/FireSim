#!/usr/bin/env bash
# Build an installable debug APK of FireSim (no Android Studio needed).
#
# Requirements: Node 20+, JDK 21, ~2 GB disk. Installs the Android command-line SDK into $ANDROID_HOME
# (default /opt/android-sdk) if it is missing, builds the web bundle, syncs Capacitor and runs Gradle.
# Output: android/app/build/outputs/apk/debug/app-debug.apk (signed with the Android debug key — for testing only).
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-16111833_latest.zip"

if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Installing Android command-line tools into $ANDROID_HOME"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
fi
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" "platform-tools" "platforms;android-36" "build-tools;36.0.0" >/dev/null

npm run build:cap
[ -d android ] || npx cap add android
npx cap sync android
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

# If Maven Central rate-limits your network (HTTP 429), put a Gradle init script in ~/.gradle/init.d/ that adds
# Google's mirror first: https://maven-central.storage-download.googleapis.com/maven2/
(cd android && ./gradlew assembleDebug --no-daemon --console=plain)

echo
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
