#!/bin/bash
# T0.5 step 3, as a script every round can run: the checks a test APK must pass before it goes to the owner's phone.
#   bash prototypes/dotnet-b/Fs.TestApp/check-apk.sh <apk> <round>
# Prints the evidence (aapt2 badging, permissions, signer, size, where the assemblies are) and exits 1 if a check fails. Never prints key material (fingerprints only).
set -u
APK="${1:?usage: check-apk.sh <apk> <round>}"
ROUND="${2:?usage: check-apk.sh <apk> <round>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../env.sh" >/dev/null 2>&1
EXPECTED_ID="au.firesim.proto.r${ROUND}"
EXPECTED_LABEL="FireSim TEST r${ROUND}"
EXPECTED_CERT="94aa0085fe7f7e899a2deb68684435d3f0bf654dfdc9d863d223c787239e4da3"   # .NET Android's default debug key (TOOLCHAIN.md 3.2)
fail=0
check() { if [ "$1" = ok ]; then echo "ok   $2"; else echo "FAIL $2"; fail=1; fi; }

BADGING="$(aapt2 dump badging "$APK" 2>/dev/null)"
PERMS="$(aapt2 dump permissions "$APK" 2>/dev/null)"
echo "--- file";  ls -l "$APK" | awk '{print $5 " bytes"}'; sha256sum "$APK" | awk '{print "sha256 " $1}'
echo "--- badging (selected)"; echo "$BADGING" | grep -E "^(package|sdkVersion|targetSdkVersion|compileSdkVersion|application-label:|launchable-activity|native-code)"
echo "--- permissions"; echo "$PERMS"

echo "$BADGING" | grep -q "^package: name='${EXPECTED_ID}' " && check ok "application id ${EXPECTED_ID}" || check bad "application id ${EXPECTED_ID}"
echo "$BADGING" | grep -q "^application-label:'${EXPECTED_LABEL}'" && check ok "label '${EXPECTED_LABEL}'" || check bad "label '${EXPECTED_LABEL}'"
echo "$BADGING" | grep -qE "versionName='0\.1\.0-test\.r${ROUND}\+[0-9a-zA-Z]+'" && check ok "version name 0.1.0-test.r${ROUND}+<commit>" || check bad "version name 0.1.0-test.r${ROUND}+<commit>"
echo "$BADGING" | grep -q "^targetSdkVersion:'37'" && check ok "targetSdk 37" || check bad "targetSdk 37"
echo "$BADGING" | grep -q "application-debuggable" && check bad "not debuggable" || check ok "not debuggable"

# the three permissions of plan section 5; the one extra line allowed is the app's own signature permission added by androidx.core (see AndroidManifest.xml)
USES="$(echo "$PERMS" | grep '^uses-permission' | sed -E "s/.*name='([^']+)'.*/\1/" | sort)"
WANT="$(printf '%s\n' android.permission.ACCESS_NETWORK_STATE android.permission.INTERNET android.permission.REQUEST_DELETE_PACKAGES "${EXPECTED_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" | sort)"
[ "$USES" = "$WANT" ] && check ok "uses-permission: the three of the plan plus the app's own DYNAMIC_RECEIVER permission, nothing else" || { check bad "uses-permission set"; echo "found:"; echo "$USES"; }

echo "--- signer"
SIGN="$(apksigner verify --verbose --print-certs "$APK" 2>&1 | grep -v -i -E 'password|pass:|keystore|JAVA_TOOL')"
echo "$SIGN" | grep -E "Verifies|schemes?\)|Number of signers|certificate DN|certificate SHA-256"
echo "$SIGN" | grep -q "^Verifies" && check ok "apksigner verify" || check bad "apksigner verify"
echo "$SIGN" | grep -q "certificate SHA-256 digest: ${EXPECTED_CERT}" && check ok "signed with .NET's default debug key (${EXPECTED_CERT:0:8}...${EXPECTED_CERT: -4})" || check bad "signer fingerprint"

echo "--- contents"
LIST="$(unzip -l "$APK")"
echo "$LIST" | grep -E "libassembly-store|libcoreclr|libclrjit|classes[0-9]*\.dex|assets/wwwroot" | awk '{print $1, $4}'
echo "$LIST" | grep -q "lib/arm64-v8a/libassembly-store.so" && check ok "assemblies are inside the APK (assembly store in lib/arm64-v8a)" || check bad "assembly store present"
echo "$LIST" | grep -q "libcoreclr.so" && check ok "CoreCLR runtime in the APK" || check bad "CoreCLR runtime in the APK"
# no fast deployment: a fast-deploy APK has no assembly store and keeps assemblies in the app's files directory on the device
STORE="$(unzip -p "$APK" lib/arm64-v8a/libassembly-store.so 2>/dev/null | strings)"
for a in Fs.TestApp.dll Fs.TestApp.Core.dll Microsoft.Maui.dll System.Private.CoreLib.dll; do
  echo "$STORE" | grep -qF "$a" && check ok "assembly store holds $a" || check bad "assembly store holds $a"
done
echo "$LIST" | grep -q "assets/wwwroot/index.html" && echo "$LIST" | grep -q "assets/wwwroot/arm-host.js" && check ok "HybridWebView host page and script in assets/wwwroot" || check bad "wwwroot assets"
unzip -p "$APK" classes.dex classes2.dex 2>/dev/null | strings | grep -q "CROSS_ORIGIN_ISOLATED_ALLOWLIST" && check ok "androidx.webkit 1.18 (CROSS_ORIGIN_ISOLATED_ALLOWLIST) is in the dex" || check bad "androidx.webkit 1.18 in the dex"

echo "--- manifest (compiled)"
MAN="$(aapt2 dump xmltree --file AndroidManifest.xml "$APK" 2>/dev/null)"
echo "$MAN" | grep -E 'authorities' | sed -E 's/.*authorities.*="([^"]+)".*/provider authority: \1/'
echo "$MAN" | grep -q "authorities.*=\"${EXPECTED_ID}.fileProvider\"" && check ok "FileProvider authority uses the application id (${EXPECTED_ID}.fileProvider)" || check bad "FileProvider authority"

[ "$fail" = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$fail"
