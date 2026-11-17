#!/usr/bin/env node
/**
 * Card T1.5 (c): why the pyrogenic solve's hashes differ in Chromium. Builds the sine tables of `Dst` (src/atmosphere/pyrogenic.ts, n = 100: the 200 x 200 fire grid coarsened by 2) with the
 * engine's own `Math.sin` in Node and in Chromium (Playwright) and counts the entries whose bits differ. Prints one JSON line.
 *   node prototypes/dotnet-b/harness/engine-sin-check.mjs [n=100]
 */
import { createRequire } from 'node:module';

const n = Number(process.argv[2] ?? 100);
function tables(n) {
  const S = new Float64Array(n * n), lam = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    for (let i = 0; i < n; i++) S[p * n + i] = Math.sin((Math.PI * (p + 1) * (i + 0.5)) / n);
    lam[p] = 4 * Math.sin((Math.PI * (p + 1)) / (2 * n)) ** 2;
  }
  return { S: Array.from(new BigUint64Array(S.buffer), String), lam: Array.from(new BigUint64Array(lam.buffer), String) };
}
const node = tables(n);
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const chr = await page.evaluate(`(${tables.toString()})(${n})`);
  const diff = (a, b) => a.reduce((c, x, i) => c + (x !== b[i] ? 1 : 0), 0);
  // ulp distance of the differing entries
  const f = (s) => new Float64Array(new BigUint64Array([BigInt(s)]).buffer)[0];
  let maxUlp = 0;
  for (let i = 0; i < node.S.length; i++) if (node.S[i] !== chr.S[i]) maxUlp = Math.max(maxUlp, Number(BigInt(node.S[i]) - BigInt(chr.S[i])) * (f(node.S[i]) > 0 === f(chr.S[i]) > 0 ? 1 : 1e9));
  console.log(JSON.stringify({ n, entriesS: node.S.length, differS: diff(node.S, chr.S), entriesLam: node.lam.length, differLam: diff(node.lam, chr.lam), maxUlpS: Math.abs(maxUlp), node: process.version, chromium: browser.version() }));
} finally {
  await browser.close();
}
