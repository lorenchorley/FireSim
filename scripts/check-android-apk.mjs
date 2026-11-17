#!/usr/bin/env node
/**
 * What a built debug APK carries for the desktop link (0.9.0, D36), read back out of the APK itself with aapt2 and unzip, so a
 * manifest merge or a Capacitor sync that drops a setting fails the build instead of showing up as a phone that cannot connect.
 * `scripts/build-android-apk.sh` runs it last. The same rules, read from the sources, are pinned by tests/build/androidNetwork.test.ts.
 *
 *   node scripts/check-android-apk.mjs [--apk android/app/build/outputs/apk/debug/app-debug.apk] [--aapt2 PATH]
 *
 * Checks: the manifest names a network security config; that config (the compiled `res/xml/network_security_config.xml`) permits
 * cleartext in its one base-config, lists no host, trusts only the system's certificate authorities; the bundled
 * `assets/capacitor.config.json` keeps `server.androidScheme` at https, sets `android.allowMixedContent` and keeps CapacitorHttp
 * on. It also prints the package, versionCode and versionName (it does not check them: the release steps change them).
 * Exit code 1 when a check fails, 2 when the APK or aapt2 is missing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const sdk = process.env.ANDROID_HOME ?? '/opt/android-sdk';
const apk = path.resolve(arg('apk', 'android/app/build/outputs/apk/debug/app-debug.apk'));
const aapt2 = arg('aapt2', `${sdk}/build-tools/36.0.0/aapt2`);
for (const [what, file] of [['APK', apk], ['aapt2', aapt2]]) {
  if (!fs.existsSync(file)) {
    console.error(`No ${what} at ${file}: run scripts/build-android-apk.sh first.`);
    process.exit(2);
  }
}
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const tree = (file) => run(aapt2, ['dump', 'xmltree', '--file', file, apk]);

let failed = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
};

const badging = run(aapt2, ['dump', 'badging', apk]);
console.log(badging.split('\n').find((l) => l.startsWith('package:')) ?? 'package: (not found)');

const manifest = tree('AndroidManifest.xml');
const ref = /networkSecurityConfig\([^)]*\)=(@\S+)/.exec(manifest)?.[1];
const named = ref ? new RegExp(`resource ${ref.slice(1)} (\\S+)`).exec(run(aapt2, ['dump', 'resources', apk]))?.[1] : undefined;
check(named === 'xml/network_security_config', 'the manifest names the network security config', `${ref} is ${named}`);
check(!/usesCleartextTraffic/.test(manifest), 'the manifest does not also set usesCleartextTraffic');

const nsc = tree('res/xml/network_security_config.xml');
const elements = [...nsc.matchAll(/^\s*E: (\S+)/gm)].map((m) => m[1]);
check(elements.join(' ') === 'network-security-config base-config trust-anchors certificates', 'the config has one base-config, one trust anchor list and no host, pin or override', elements.join(' '));
check(/cleartextTrafficPermitted=true/.test(nsc) && !/cleartextTrafficPermitted=false/.test(nsc), 'the base-config permits cleartext');
check([...nsc.matchAll(/\bsrc="([^"]*)"/g)].map((m) => m[1]).join() === 'system', 'the only certificates trusted are the system\'s');

const cap = JSON.parse(run('unzip', ['-p', apk, 'assets/capacitor.config.json']));
check(cap.server?.androidScheme === 'https', 'server.androidScheme is https', String(cap.server?.androidScheme));
check(cap.android?.allowMixedContent === true, 'android.allowMixedContent is on', String(cap.android?.allowMixedContent));
check(cap.plugins?.CapacitorHttp?.enabled === true, 'CapacitorHttp is on');

console.log(failed ? `${failed} check(s) failed.` : 'The APK carries the desktop link settings.');
process.exit(failed ? 1 : 0);
