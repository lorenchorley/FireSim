#!/usr/bin/env node
// Spike S4 (night map lighting): makes the screenshots in shots/ and prints the measurement tables quoted in README.md.
//
//   S4_PORT=4304 node docs/plans/spikes/S4-night-look/shoot.mjs [shots [name ...] | tables [section ...] | all]   (S4_OUT: where the JPEGs go)
//
// Run it from a repository root that has node_modules (it imports @playwright/test and fast-png) against a Vite dev server of
// a tree that has docs/plans/spikes/S4-night-look/prototype.patch applied, e.g.  git apply prototype.patch && npx vite --port 4304.
// Optional S4_HEAD_PORT: a dev server of the unpatched HEAD, used by the section "head" (pixel identity of Realistic).
// Software rendering (SwiftShader), 412 x 915 CSS pixels at device scale 1, the harness's synthetic fire (src/render/dev.ts).
// Every frame is rendered on a frozen clock after a reset of the animated state, so two runs give the same pixels.
// Sections of "tables": luminance fade brighter relief fire fog cost shadow night sky maptypes town head   (default: all, head only with S4_HEAD_PORT)
import { chromium } from '@playwright/test';
import { decode, encode } from 'fast-png';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.S4_PORT ?? '4304';
const HEAD_PORT = process.env.S4_HEAD_PORT ?? '';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , cmd = 'all', ...rest] = process.argv;
const SHOTS = process.env.S4_OUT ?? path.join(HERE, 'shots');
const wanted = cmd === 'tables' ? rest : [];
const wantedShots = cmd === 'shots' ? rest : []; // optional: looks-katoomba looks-thredbo fade regions relief fire maptypes town eye shadow night

// ───────────────────────────── harness helpers ─────────────────────────────────────────────────────────────────────

const NIGHT = Date.UTC(2019, 11, 21, 22 - 11, 0, 0); // 22:00 AEDT on the harness's day (21 Dec 2019)
const DAY = Date.UTC(2019, 11, 21, 13 - 11, 0, 0); // 13:00
const LOOKS = ['realistic', 'brighter', 'daylight'];
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 10);
const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);
const f3 = (x) => x.toFixed(3);

try {
  await fetch(`http://localhost:${PORT}/src/render/dev.html`);
} catch {
  console.error(`No dev server on port ${PORT}. Start one in a tree with the patch applied: npx vite --port ${PORT} --strictPort`);
  process.exit(1);
}
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const consoleLog = [];

/** Open the harness, stop its render loop, freeze the clock and reset the animated state so frames are reproducible. */
async function open(query, port = PORT) {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 })).newPage();
  page.on('console', (m) => {
    if (m.type() === 'debug') return;
    const t = m.text();
    if (/Failed to load resource.*404/.test(t)) return; // the harness page has no favicon (also at HEAD)
    consoleLog.push(`[${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e}`));
  const url = `http://localhost:${port}/src/render/dev.html?hud=0&dpr=1&${query}&quality=medium&wind=off`; // the first occurrence of a parameter wins
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.error(`load of ${url} failed (${String(e).split('\n')[0]}), trying again`);
    }
  }
  await page.waitForFunction(() => window.__fs && (window.__fs.ready || window.__fs.error), null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__fs.error);
  if (err) throw new Error(`harness failed: ${err}`);
  if (port === PORT && !(await page.evaluate(() => !!window.__fs.look))) throw new Error(`the server on port ${port} does not run the prototype (git apply docs/plans/spikes/S4-night-look/prototype.patch first)`);
  await page.evaluate(() => {
    const v = window.__fs.view;
    v.renderer.setAnimationLoop(null);
    window.__T = 1e7; // the same frozen time in every page
    performance.now = () => window.__T;
    v.renderNow(); // swallows the one big time step after the freeze
    window.__fs.setTime(Number(new URLSearchParams(location.search).get('t') ?? 10800)); // animated state from the snapshot
    v.renderNow();
    v.u.uClock.value = 3;
    if (window.__fs.look) window.__defaults = JSON.parse(JSON.stringify(window.__fs.look)); // the prototype's tuning constants as loaded
  });
  page.defaultCam = await page.evaluate(() => {
    const c = window.__fs.view.cameraState();
    return [c.target[0], c.target[1], c.distance, c.azimuthDeg, c.polarDeg];
  });
  return page;
}

/**
 * Render one deterministic frame. o: { look, ms (sun clock, unix ms), mode, cam [x, y, dist, az, tilt], tune {mix high low az el fog
 * exp smoke shadow skyMap dir blend}, layers, plain, eye [x, y, az, pitch] }. Returns { png, img, calls, triangles }.
 */
async function frame(page, o = {}) {
  const r = await page.evaluate((o) => {
    const fs = window.__fs;
    const v = fs.view;
    const L = fs.look;
    if (L && window.__defaults) {
      const d = window.__defaults; // every frame starts from the prototype's own constants
      L.mix.realistic = d.mix.realistic; L.mix.brighter = d.mix.brighter; L.mix.daylight = d.mix.daylight;
      for (const k of ['fadeHigh', 'fadeLow', 'sunAzimuth', 'sunElevation', 'fogCut', 'exposureMode', 'smokeMap', 'shadowFade', 'skyFromMap', 'dirBlend', 'lightBlend']) L[k] = d[k];
      const t = o.tune ?? {};
      const map = { high: 'fadeHigh', low: 'fadeLow', az: 'sunAzimuth', el: 'sunElevation', fog: 'fogCut', exp: 'exposureMode', smoke: 'smokeMap', shadow: 'shadowFade', skyMap: 'skyFromMap', dir: 'dirBlend', blend: 'lightBlend' };
      for (const [k, kk] of Object.entries(map)) if (t[k] !== undefined) L[kk] = t[k];
      if (t.mix !== undefined) L.mix.brighter = t.mix;
    }
    if (o.layers) v.setLayers(o.layers);
    if (o.plain !== undefined) v.setPlainGround(o.plain);
    if (o.look && v.setNightLook) v.setNightLook(o.look);
    if (o.ms !== undefined) v.setStartTime(o.ms - v.displayTime * 1000);
    if (o.mode) {
      v.setViewMode(o.mode);
      if (o.mode === 'ground') { window.__T += 1600; v.renderNow(); v.renderNow(); } // finish the 1.1 s flight
    }
    if (o.cam) v.lookAt(o.cam[0], o.cam[1], o.cam[2], o.cam[3], o.cam[4]);
    if (o.eye) {
      const rig = v.rig;
      const eye = rig.groundPoint(o.eye[0], o.eye[1]);
      eye.y += 2;
      const a = (o.eye[2] * Math.PI) / 180, p = (o.eye[3] * Math.PI) / 180;
      const T = eye.clone();
      T.x += Math.sin(a) * Math.cos(p); T.y += Math.sin(p); T.z += -Math.cos(a) * Math.cos(p);
      rig.goTo(T, eye, 0);
    }
    if (v.refreshLighting) v.refreshLighting();
    v.renderNow();
    v.renderNow();
    v.renderNow();
    const c = v.renderer.domElement;
    const info = v.renderer.info;
    return { url: c.toDataURL('image/png'), calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0, geometries: info.memory.geometries, textures: info.memory.textures };
  }, o);
  const png = Buffer.from(r.url.split(',')[1], 'base64');
  const d = decode(png);
  return { png, img: { w: d.width, h: d.height, data: d.data, ch: d.channels }, calls: r.calls, triangles: r.triangles, programs: r.programs, geometries: r.geometries, textures: r.textures };
}

/** Unix ms at which the sun is at `el` degrees at dusk or dawn on the harness's day, from the renderer's own solar model. */
async function timeFor(page, el, side = 'dusk') {
  return page.evaluate(async ({ el, side }) => {
    const { solarPosition } = await import('/src/terrain/index.ts');
    const o = window.__fs.origin;
    const day = window.__fs.startTime - ((window.__fs.startTime + 11 * 3600e3) % 86400e3);
    const f = (ms) => solarPosition(ms, o.lat, o.lon).elevation;
    let lo = side === 'dusk' ? day + 12 * 3600e3 : day;
    let hi = side === 'dusk' ? day + 24 * 3600e3 - 1 : day + 12 * 3600e3;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      const above = side === 'dusk' ? f(mid) > el : f(mid) < el;
      if (side === 'dusk') { if (above) lo = mid; else hi = mid; } else if (above) lo = mid; else hi = mid;
    }
    return Math.round((lo + hi) / 2 / 1000) * 1000;
  }, { el, side });
}

/** Sun elevation and azimuth (deg) of the renderer's solar model at a time. */
async function sunAt(page, ms) {
  return page.evaluate(async (ms) => {
    const { solarPosition } = await import('/src/terrain/index.ts');
    const o = window.__fs.origin;
    return solarPosition(ms, o.lat, o.lon);
  }, ms);
}

/** The prototype's pure maths in the page: weight and lighting numbers for a look and sun elevation. */
async function lightingAt(page, look, el, az = 240) {
  return page.evaluate(async ({ look, el, az }) => {
    const sky = await import('/src/render/sky.ts');
    const coords = await import('/src/render/coords.ts');
    const real = sky.skyLighting(el);
    const dir = coords.sunDirectionWorld(az, Math.max(el, -2));
    return { real, map: sky.mapLighting(real, look, dir) };
  }, { look, el, az });
}

// ───────────────────────────── image measurements (8-bit sRGB values, Rec. 709 weights) ────────────────────────────

const GROUND = [0.04, 0.7, 0.96, 0.97]; // fractions of the frame: x0, y0, x1, y1 (lower foreground of the standard view)
const SKY = [0.03, 0.015, 0.45, 0.1]; // upper left of the standard view (above the horizon, left of the plume)
function crop(img, box) {
  const x0 = Math.floor(box[0] * img.w), y0 = Math.floor(box[1] * img.h), x1 = Math.floor(box[2] * img.w), y1 = Math.floor(box[3] * img.h);
  return { x0, y0, x1, y1 };
}
function lumaOf(img, i) {
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
}
/** mean, std, mean absolute gradient and max luma over a region. */
function stats(img, box = [0, 0, 1, 1]) {
  const { x0, y0, x1, y1 } = crop(img, box);
  let s = 0, s2 = 0, n = 0, mx = 0, g = 0, gn = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const l = lumaOf(img, i);
      s += l; s2 += l * l; n++;
      if (l > mx) mx = l;
      if (x + 1 < x1) { g += Math.abs(lumaOf(img, i + img.ch) - l); gn++; }
      if (y + 1 < y1) { g += Math.abs(lumaOf(img, i + img.w * img.ch) - l); gn++; }
    }
  }
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), max: mx, grad: g / gn };
}
const mean = (img, box) => stats(img, box).mean;
/** CIE lightness of an 8-bit sRGB grey value. */
function lstar(y255) {
  const y = y255 / 255;
  const lin = y <= 0.04045 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4;
  return lin > 0.008856 ? 116 * Math.cbrt(lin) - 16 : 903.3 * lin;
}
/** Pixels that differ between two frames (any channel), and the largest channel difference, over a region. */
function diff(a, b, box = [0, 0, 1, 1]) {
  const { x0, y0, x1, y1 } = crop(a, box);
  let n = 0, mx = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.w + x) * a.ch;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    if (d) n++;
    if (d > mx) mx = d;
  }
  return { pixels: n, max: mx };
}
/** Fire pixels (bright orange: R >= 200 and R - B >= 90) below the top quarter of the frame, against everything else there. */
function fireStats(img) {
  const y0 = Math.floor(0.25 * img.h);
  let nf = 0, sf = 0, nb = 0, sb = 0, nc = 0;
  for (let y = y0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * img.ch;
    const l = lumaOf(img, i);
    if (img.data[i] >= 200 && img.data[i] - img.data[i + 2] >= 90) { nf++; sf += l; } else { nb++; sb += l; if (l > 110) nc++; }
  }
  const lf = sf / Math.max(1, nf), lb = sb / Math.max(1, nb);
  return { firePct: (100 * nf) / (nf + nb), lFire: lf, lBg: lb, michelson: (lf - lb) / (lf + lb), clutterPct: (100 * nc) / (nf + nb) };
}

// ───────────────────────────── contact sheets (drawn in the browser, written as JPEG) ───────────────────────────────

let sheetPage = null;
/** tiles: [{ png, label, boxes? }]; boxes are [{ box, color, text }] in fractions of the tile. Returns the JPEG. */
async function sheet(tiles, { cols, scale, max = 118000 }) {
  sheetPage ??= await (await browser.newContext()).newPage();
  const payload = tiles.map((t) => ({ url: `data:image/png;base64,${t.png.toString('base64')}`, label: t.label, boxes: t.boxes ?? [] }));
  let best = null;
  for (const [s, q] of [[1, 0.8], [1, 0.74], [0.92, 0.8], [0.92, 0.72], [0.85, 0.78], [0.8, 0.7], [0.7, 0.7]]) {
    const url = await sheetPage.evaluate(async ({ payload, cols, scale, q }) => {
      const imgs = await Promise.all(payload.map((p) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = p.url; })));
      const tw = Math.round(imgs[0].width * scale), th = Math.round(imgs[0].height * scale), gap = 3;
      const rows = Math.ceil(imgs.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * tw + (cols - 1) * gap; c.height = rows * th + (rows - 1) * gap;
      const x = c.getContext('2d');
      x.fillStyle = '#444'; x.fillRect(0, 0, c.width, c.height);
      x.imageSmoothingQuality = 'high';
      imgs.forEach((im, k) => {
        const ox = (k % cols) * (tw + gap), oy = Math.floor(k / cols) * (th + gap);
        x.drawImage(im, ox, oy, tw, th);
        for (const b of payload[k].boxes) {
          x.strokeStyle = b.color; x.lineWidth = 2;
          x.strokeRect(ox + b.box[0] * tw, oy + b.box[1] * th, (b.box[2] - b.box[0]) * tw, (b.box[3] - b.box[1]) * th);
          x.fillStyle = b.color; x.font = '11px sans-serif'; x.fillText(b.text, ox + b.box[0] * tw + 3, oy + b.box[3] * th - 4);
        }
        x.font = '12px sans-serif';
        const lines = payload[k].label.split('\n');
        const w = Math.max(...lines.map((l) => x.measureText(l).width)) + 8;
        x.fillStyle = 'rgba(0,0,0,0.72)'; x.fillRect(ox, oy, w, 5 + 13 * lines.length);
        x.fillStyle = '#fff';
        lines.forEach((l, j) => x.fillText(l, ox + 4, oy + 12.5 + 13 * j));
      });
      return c.toDataURL('image/jpeg', q);
    }, { payload, cols, scale: scale * s, q });
    best = Buffer.from(url.split(',')[1], 'base64');
    if (best.length <= max) break;
  }
  return best;
}
function writeShot(name, buf) {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), buf);
  console.log(`shot ${name}  ${(buf.length / 1024).toFixed(0)} kB`);
}

// ───────────────────────────── scenes shared by shots and tables ───────────────────────────────────────────────────

const SITES = {
  katoomba: { fire: { close: [-2000, 560, 1500, 200, 60], front: [-1700, 380, 800, 215, 62] }, tgt: [-1477, 271, 4159], user: [-300, 400, 300], town: 'Katoomba' },
  thredbo: { fire: { close: [-1300, -200, 1500, 200, 60], front: [-1300, -200, 800, 215, 62] }, tgt: [-908, -407, 4200], user: [-500, -300, 300], town: 'Thredbo' },
};
const RELIEF_Q = 't=300&smoke=0&flames=0&embers=0&veg=0&roads=0&fireTrails=0&names=0&imagery=0&plain=1'; // ground only, neutral grey
const std = (page) => ({ look: 'realistic', ms: NIGHT, mode: 'orbit', cam: [page.defaultCam[0], page.defaultCam[1], page.defaultCam[2], 200, 72] }); // the standard luminance view

// ═════════════════════════════════════════ tables ═════════════════════════════════════════════════════════════════

const tables = {
  // The numbers for the e2e thresholds: ground and sky mean luma per look at night, dusk and day, two sites.
  async luminance() {
    console.log('\n## luminance: mean luma (0-255, sRGB values) of the ground region and the sky region, standard view (target of the default framing, az 200, tilt 72)');
    console.log(`ground region ${JSON.stringify(GROUND)}, sky region ${JSON.stringify(SKY)} (fractions of the 412 x 915 frame)`);
    for (const site of Object.keys(SITES)) {
      const page = await open(`site=${site}&start=22&t=7200`);
      const base = std(page);
      const dusk4 = await timeFor(page, 4), duskm2 = await timeFor(page, -2);
      const rows = [['night 22:00', NIGHT], ['dusk el +4', dusk4], ['dusk el -2', duskm2], ['day 13:00', DAY]];
      console.log(`\n${site}: look        ${rows.map(([n]) => n.padStart(14)).join('')}   (ground / sky)`);
      const frames = {};
      for (const look of LOOKS) {
        const cells = [];
        for (const [n, ms] of rows) {
          const fr = await frame(page, { ...base, look, ms });
          frames[`${look}|${n}`] = fr;
          cells.push(`${f1(mean(fr.img, GROUND)).padStart(6)} /${f1(mean(fr.img, SKY)).padStart(5)}`);
        }
        console.log(`${site.padEnd(9)} ${look.padEnd(10)} ${cells.map((c) => c.padStart(14)).join('')}`);
      }
      const rep = await frame(page, { ...base, look: 'realistic', ms: NIGHT });
      console.log(`repeat of Realistic at night differs from the first by ${diff(rep.img, frames['realistic|night 22:00'].img).pixels} pixels (noise floor of the method)`);
      for (const [n] of rows) {
        const a = frames[`realistic|${n}`], b = frames[`brighter|${n}`], d = frames[`daylight|${n}`];
        console.log(`  ${n.padEnd(12)} sky region differs between looks by ${diff(a.img, b.img, SKY).pixels} / ${diff(a.img, d.img, SKY).pixels} pixels (Brighter / Daylight vs Realistic); whole frame ${diff(a.img, b.img).pixels} / ${diff(a.img, d.img).pixels}; sha1 ${sha(a.png)} ${sha(b.png)} ${sha(d.png)}`);
      }
      // By day nothing may change: three cameras, three looks, pixel for pixel (also sun at +8 and +10 degrees).
      const cams = [['default', page.defaultCam], ['close fire', SITES[site].fire.close], ['wide', [0, 0, 9500, 200, 68]]];
      const idents = [];
      for (const [cn, cam] of cams) for (const [tn, ms] of [['13:00', DAY], ['sun +8', await timeFor(page, 8)], ['sun +10', await timeFor(page, 10)]]) {
        const a = await frame(page, { look: 'realistic', ms, mode: 'orbit', cam });
        const b = await frame(page, { look: 'brighter', ms, mode: 'orbit', cam });
        const d = await frame(page, { look: 'daylight', ms, mode: 'orbit', cam });
        idents.push(diff(a.img, b.img).pixels + diff(a.img, d.img).pixels);
      }
      console.log(`${site}: ${idents.length} day or sun >= +8 deg frames (3 cameras x 3 times), pixels that differ between Realistic and Brighter or Daylight: ${idents.reduce((x, y) => x + y, 0)}`);
      await page.context().close();
    }
  },

  // The dusk and dawn fade: weights and lighting numbers from the pure function, and the ground and sky luma they give.
  async fade() {
    console.log('\n## fade: Katoomba, standard view, sun elevation at dusk (21 Dec); w = weight of the fixed sun; luma of ground / sky region');
    const page = await open('site=katoomba&start=22&t=7200');
    const base = std(page);
    console.log('el(deg) clock   w(B)  w(D)  sunI R/B/D          ambI R/B/D          exposure R/B/D    ground R / B / D        sky R / B / D     frame identical to Realistic');
    for (const el of [10, 8, 6, 4, 2, 1, 0.6, 0.4, 0, -2, -6, -12]) {
      const ms = await timeFor(page, el);
      const s = await sunAt(page, ms);
      const L = {};
      for (const look of LOOKS) L[look] = (await lightingAt(page, look, s.elevation, s.azimuth)).map;
      const fr = {};
      for (const look of LOOKS) fr[look] = await frame(page, { ...base, look, ms });
      const clock = new Date(ms + 11 * 3600e3).toISOString().slice(11, 16);
      const g = (l) => f1(mean(fr[l].img, GROUND)).padStart(5);
      const k = (l) => f1(mean(fr[l].img, SKY)).padStart(5);
      const same = diff(fr.realistic.img, fr.brighter.img).pixels === 0 && diff(fr.realistic.img, fr.daylight.img).pixels === 0;
      console.log(`${String(el).padStart(5)}   ${clock}  ${f2(L.brighter.weight)}  ${f2(L.daylight.weight)}  ${f2(L.realistic.sunIntensity)}/${f2(L.brighter.sunIntensity)}/${f2(L.daylight.sunIntensity)}   ${f2(L.realistic.ambientIntensity)}/${f2(L.brighter.ambientIntensity)}/${f2(L.daylight.ambientIntensity)}   ${f2(L.realistic.exposure)}/${f2(L.brighter.exposure)}/${f2(L.daylight.exposure)}   ${g('realistic')} ${g('brighter')} ${g('daylight')}   ${k('realistic')} ${k('brighter')} ${k('daylight')}   ${same ? 'yes (pixel-identical)' : 'no'}`);
    }
    console.log('dawn (sun in the east, so the blend goes from a different direction):');
    for (const el of [8, 4, 1, -2]) {
      const ms = await timeFor(page, el, 'dawn');
      const s = await sunAt(page, ms);
      const fr = {};
      for (const look of LOOKS) fr[look] = await frame(page, { ...base, look, ms });
      console.log(`  el ${String(el).padStart(2)} az ${f1(s.azimuth)}  ground R/B/D ${f1(mean(fr.realistic.img, GROUND))} ${f1(mean(fr.brighter.img, GROUND))} ${f1(mean(fr.daylight.img, GROUND))}`);
    }
    await page.context().close();
  },

  // Brighter: where it sits between Realistic and Daylight in lightness, plan blend against the corrected blend.
  async brighter() {
    console.log('\n## brighter: ground region at night, default fire framing (az 200, tilt 58); pos = (L*(B) - L*(R)) / (L*(D) - L*(R))');
    for (const site of Object.keys(SITES)) {
      const page = await open(`site=${site}&start=22&t=7200`);
      const cam = page.defaultCam;
      const box = [0.04, 0.68, 0.96, 0.97];
      const R = await frame(page, { look: 'realistic', ms: NIGHT, mode: 'orbit', cam });
      const D = await frame(page, { look: 'daylight', ms: NIGHT });
      const lr = lstar(mean(R.img, box)), ld = lstar(mean(D.img, box));
      console.log(`${site}: Realistic luma ${f1(mean(R.img, box))} L* ${f1(lr)}   Daylight luma ${f1(mean(D.img, box))} L* ${f1(ld)}   (recommended settings)`);
      const row = async (label, o) => {
        const fr = await frame(page, o);
        const m = fr.img && stats(fr.img, box);
        console.log(`   ${label.padEnd(34)} luma ${f1(m.mean).padStart(5)}  L* ${f1(lstar(m.mean)).padStart(5)}  pos ${f2((lstar(m.mean) - lr) / (ld - lr))}  std ${f1(m.std)}  std/mean ${f3(m.std / m.mean)}`);
      };
      for (const m of [0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.55]) await row(`corrected blend, m = ${m}`, { look: 'brighter', tune: { mix: m } });
      // The plan as written: separate colour and intensity blend, plain vector direction, fixed sun at 40 degrees, smoke and fog as listed.
      const planD = await frame(page, { look: 'daylight', tune: { blend: 'separate', dir: 'vector', el: 40, smoke: 1, shadow: false, fog: 1 } });
      const lpd = lstar(mean(planD.img, box));
      console.log(`   plan as written: Daylight luma ${f1(mean(planD.img, box))} L* ${f1(lpd)}`);
      for (const m of [0.45, 0.5, 0.55, 0.6]) {
        const fr = await frame(page, { look: 'brighter', tune: { mix: m, blend: 'separate', dir: 'vector', el: 40, smoke: 1, shadow: false, fog: 1 } });
        const s = stats(fr.img, box);
        console.log(`   plan blend, m = ${String(m).padEnd(4)}                  luma ${f1(s.mean).padStart(5)}  L* ${f1(lstar(s.mean)).padStart(5)}  pos ${f2((lstar(s.mean) - lr) / (lpd - lr))}  std ${f1(s.std)}  std/mean ${f3(s.std / s.mean)}`);
      }
      await page.context().close();
    }
  },

  // Relief readability: luma contrast of the neutral ground against the fixed sun's azimuth and elevation, four camera headings and the plan view.
  async relief() {
    console.log('\n## relief: std of luma over the ground (neutral grey map type, no trees, roads or fire), Daylight look at night. Columns: camera azimuth 45 / 135 / 225 / 315 (the camera sits there and looks the other way) and the plan view (north up)');
    for (const site of Object.keys(SITES)) {
      const page = await open(`site=${site}&start=22&${RELIEF_Q}`);
      const t = SITES[site].tgt;
      const cams = [['cam45', 'orbit', [t[0], t[1], t[2], 45, 58]], ['cam135', 'orbit', [t[0], t[1], t[2], 135, 58]], ['cam225', 'orbit', [t[0], t[1], t[2], 225, 58]], ['cam315', 'orbit', [t[0], t[1], t[2], 315, 58]], ['top', 'top', [t[0], t[1], 7000, 0, 0]]];
      const box = (c) => (c === 'top' ? [0.03, 0.03, 0.97, 0.97] : [0.03, 0.3, 0.97, 0.97]);
      const run = async (label, tune, headingsAz) => {
        const v = [];
        const mm = [];
        for (const [c, mode, cam] of cams) {
          const o = { look: 'daylight', ms: NIGHT, mode, cam, tune: { ...tune } };
          if (headingsAz) o.tune.az = headingsAz(c, cam);
          const fr = await frame(page, o);
          const s = stats(fr.img, box(c));
          v.push(s.std); mm.push(s.mean);
        }
        const avg = v.reduce((a, b) => a + b, 0) / v.length;
        const cv = v.map((x, k) => x / mm[k]);
        console.log(`${label.padEnd(26)} ${v.map((x) => f1(x).padStart(5)).join(' ')} | avg ${f1(avg)} min ${f1(Math.min(...v))} | mean luma ${f1(mm.reduce((a, b) => a + b, 0) / mm.length)} | std/mean avg ${f3(cv.reduce((a, b) => a + b, 0) / cv.length)} min ${f3(Math.min(...cv))}`);
      };
      console.log(`\n${site}: sun elevation 30 deg, azimuth sweep`);
      for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) await run(`sun az ${String(az).padStart(3)} el 30`, { az, el: 30 });
      console.log(`${site}: sun azimuth 315, elevation sweep`);
      for (const el of [20, 25, 30, 35, 40, 55]) await run(`sun az 315 el ${String(el).padStart(2)}`, { az: 315, el });
      console.log(`${site}: camera-relative sun (azimuth = viewing direction + offset), el 30; the plan view has no heading, so it uses 315`);
      for (const off of [-45, 45]) await run(`relative ${off > 0 ? '+' : ''}${off}`, { el: 30 }, (c) => (c === 'top' ? 315 : (Number(c.slice(3)) + 180 + off + 360) % 360));
      await page.context().close();
      // The same with the photo map type (the default) and trees: the photo carries its own shading and the scene light is applied at half contrast.
      const pg = await open(`site=${site}&start=22&t=300&smoke=0&flames=0&embers=0&wind=off`);
      console.log(`${site}: photo map type with trees and roads, std of luma, elevation 40 vs 30 (azimuth 315)`);
      for (const el of [40, 30]) {
        const v = [];
        for (const [c, mode, cam] of cams) {
          const fr = await frame(pg, { look: 'daylight', ms: NIGHT, mode, cam, tune: { az: 315, el } });
          v.push(stats(fr.img, box(c)).std);
        }
        console.log(`   el ${el}: ${v.map((x) => f1(x).padStart(5)).join(' ')} | avg ${f1(v.reduce((a, b) => a + b, 0) / v.length)}`);
      }
      await pg.context().close();
    }
  },

  // Does the fire stand out? Contrast of the bright orange pixels against the rest, three views, by day and at night.
  async fire() {
    console.log('\n## fire: bright orange pixels (R >= 200, R - B >= 90) below the top quarter against all other pixels there. Michelson = (Lfire - Lbg) / (Lfire + Lbg); clutter = share of NON-fire pixels with luma > 110');
    for (const site of Object.keys(SITES)) {
      const page = await open(`site=${site}&start=22&t=7200`);
      const views = { wide: page.defaultCam, close: SITES[site].fire.close, front: SITES[site].fire.front };
      for (const [vn, cam] of Object.entries(views)) {
        console.log(`\n${site} ${vn}:  setting                                fire%   Lfire   Lbg   Michelson  clutter%`);
        const line = async (label, o) => {
          const fr = await frame(page, { mode: 'orbit', cam, ...o });
          const s = fireStats(fr.img);
          console.log(`  ${label.padEnd(44)} ${f2(s.firePct).padStart(5)}  ${f1(s.lFire).padStart(6)} ${f1(s.lBg).padStart(5)}   ${f3(s.michelson)}    ${f1(s.clutterPct).padStart(5)}`);
        };
        await line('day 13:00 (Realistic)', { look: 'realistic', ms: DAY });
        await line('night Realistic', { look: 'realistic', ms: NIGHT });
        await line('night Brighter (recommended settings)', { look: 'brighter', ms: NIGHT });
        await line('night Daylight (recommended settings)', { look: 'daylight', ms: NIGHT });
        await line('night Daylight, smoke body on map light (plan)', { look: 'daylight', ms: NIGHT, tune: { smoke: 1 } });
        await line('night Daylight, exposure folded (flames at night level)', { look: 'daylight', ms: NIGHT, tune: { exp: 'fold' } });
        await line('night Daylight, all plan settings', { look: 'daylight', ms: NIGHT, tune: { blend: 'separate', dir: 'vector', el: 40, smoke: 1, shadow: false, fog: 1 } });
      }
      await page.context().close();
    }
  },

  // Fog: how much the distant terrain is dimmed by the (dark, real) fog colour, with and without the plan's cut, at two smoke haze values.
  async fog() {
    console.log('\n## fog: wide view (target 0,0, 9500 m, az 200, tilt 68) at night, Daylight; far band = rows 42-50 of the frame, near band = rows 62-78. Haze is the 0 to 1 smoke haze that multiplies the fog density by 1 + 1.5 * haze (the synthetic plume gives 1)');
    const page = await open('site=katoomba&start=22&t=7200&smoke=0'); // smoke layer off, so the plume does not enter the bands
    const cam = [0, 0, 9500, 200, 68];
    const bands = { far: [0.35, 0.42, 0.95, 0.5], near: [0.3, 0.62, 0.95, 0.78] };
    for (const haze of [0, 1]) {
      await page.evaluate((h) => { window.__fs.view.smokeHaze = h; }, haze);
      for (const fog of [0, 0.5, 1]) {
        const fr = await frame(page, { look: 'daylight', ms: NIGHT, mode: 'orbit', cam, tune: { fog } });
        const a = mean(fr.img, bands.far), b = mean(fr.img, bands.near);
        console.log(`haze ${haze}  Daylight, fog density x (1 - ${fog} * w):  far ${f1(a)}  near ${f1(b)}  far/near ${f2(a / b)}`);
      }
      const R = await frame(page, { look: 'realistic', ms: NIGHT });
      const D = await frame(page, { look: 'realistic', ms: DAY });
      console.log(`haze ${haze}  Realistic (today): far ${f1(mean(R.img, bands.far))}  near ${f1(mean(R.img, bands.near))}    day 13:00: far ${f1(mean(D.img, bands.far))}  near ${f1(mean(D.img, bands.near))}`);
    }
    await page.context().close();
  },

  // Cost and safety: draw calls, triangles, programs, geometries, textures; the time a look change takes; console messages.
  async cost() {
    console.log('\n## cost: renderer.info after a frame; a look change is uniforms only');
    const page = await open('site=katoomba&start=22&t=7200&context=1&homes=1&zones=1&names=1');
    const cam = page.defaultCam;
    for (const [tn, ms] of [['night', NIGHT], ['day', DAY]]) {
      for (const look of LOOKS) {
        const fr = await frame(page, { look, ms, mode: 'orbit', cam });
        console.log(`${tn.padEnd(5)} ${look.padEnd(10)} draw calls ${fr.calls}  triangles ${fr.triangles}  programs ${fr.programs}  geometries ${fr.geometries}  textures ${fr.textures}`);
      }
    }
    const t = await page.evaluate((night) => {
      const v = window.__fs.view;
      v.setStartTime(night - v.displayTime * 1000);
      v.setNightLook('realistic');
      v.renderNow();
      const info = v.renderer.info;
      const before = { p: info.programs.length, g: info.memory.geometries, t: info.memory.textures };
      for (let k = 0; k < 30; k++) {
        v.setNightLook(['brighter', 'daylight', 'realistic'][k % 3]);
        v.renderNow();
      }
      const after = { p: info.programs.length, g: info.memory.geometries, t: info.memory.textures };
      // performance.now is frozen in this page, so time many calls with Date.now
      const t0 = Date.now();
      const n = 3000;
      for (let k = 0; k < n; k++) v.setNightLook(k % 2 ? 'daylight' : 'realistic');
      return { before, after, perCall: (Date.now() - t0) / n };
    }, NIGHT);
    console.log(`30 look changes with a frame after each: programs ${t.before.p} -> ${t.after.p}, geometries ${t.before.g} -> ${t.after.g}, textures ${t.before.t} -> ${t.after.t}`);
    console.log(`setNightLook alone (recompute of the lighting and uniform writes, no frame): ${t.perCall.toFixed(3)} ms per call (mean of 3000 calls)`);
    await page.context().close();
    for (const q of ['quality=low', 'quality=high', 'wind=surface&arrows=1', 'cross=1']) {
      const pg = await open(`site=katoomba&start=22&t=7200&${q}`);
      const row = [];
      for (const look of LOOKS) {
        const fr = await frame(pg, { look, ms: NIGHT, mode: 'orbit', cam: pg.defaultCam });
        row.push(`${fr.calls}/${fr.triangles}`);
      }
      console.log(`${q.padEnd(24)} draw calls / triangles  Realistic ${row[0]}  Brighter ${row[1]}  Daylight ${row[2]}`);
      await pg.context().close();
    }
  },

  // The cast-shadow step at 0.5 deg: ground luma either side of the cut-off, plan against the fade.
  async shadow() {
    console.log('\n## shadow: Daylight, ground luma as the real sun crosses 0.5 deg (the terrain cast shadows switch off there)');
    const page = await open('site=katoomba&start=22&t=7200');
    const base = std(page);
    const els = [4, 2, 1, 0.8, 0.6, 0.55, 0.45, 0.3, 0, -2];
    console.log('el      cast shadows as in the plan   shadows scaled by (1 - w)');
    const res = [];
    for (const el of els) {
      const ms = await timeFor(page, el);
      const a = await frame(page, { ...base, look: 'daylight', ms, tune: { shadow: false } });
      const b = await frame(page, { ...base, look: 'daylight', ms, tune: { shadow: true } });
      res.push([el, mean(a.img, GROUND), mean(b.img, GROUND)]);
      console.log(`${String(el).padStart(5)}   ${f1(res.at(-1)[1]).padStart(8)}                    ${f1(res.at(-1)[2]).padStart(8)}`);
    }
    const k = els.indexOf(0.55);
    console.log(`step across 0.55 -> 0.45: plan ${f1(res[k + 1][1] - res[k][1])}, scaled ${f1(res[k + 1][2] - res[k][2])} luma levels`);
    await page.context().close();
  },

  // Brighter through the night: does the shading hold still? Plain vector blend of the direction against the light-weighted one.
  async night() {
    console.log('\n## night: Brighter (recommended mix), neutral grey ground, plan view; std of luma at several clock times (a steady light direction gives a steady std)');
    const page = await open(`site=katoomba&start=22&${RELIEF_Q}`);
    const t = SITES.katoomba.tgt;
    const midnight = Date.UTC(2019, 11, 21, 24 - 11, 0, 0);
    const hours = [20.75, 21.5, 24, 26, 28, 29.5];
    console.log('clock    vector blend (plan)   light-weighted blend   (std / mean luma)');
    for (const h of hours) {
      const ms = midnight + (h - 24) * 3600e3;
      const clock = new Date(ms + 11 * 3600e3).toISOString().slice(11, 16);
      const out = [];
      for (const dir of ['vector', 'light']) {
        const fr = await frame(page, { look: 'brighter', ms, mode: 'top', cam: [t[0], t[1], 5000, 0, 0], tune: { dir } });
        const s = stats(fr.img, [0.03, 0.03, 0.97, 0.97]);
        out.push(`${f1(s.std).padStart(5)} / ${f1(s.mean).padStart(5)}`);
      }
      const s = await sunAt(page, ms);
      console.log(`${clock}    ${out[0]}          ${out[1]}      (real sun el ${f1(s.elevation)}, az ${f1(s.azimuth)})`);
    }
    await page.context().close();
  },

  // The sky: unchanged between looks, and what the failure the plan guards against looks like.
  async sky() {
    console.log('\n## sky: pixel differences in the sky region between looks; the bug (sky sharing the map sun and exposure) for calibration');
    const page = await open('site=katoomba&start=22&t=7200&user=-300,400,300');
    const views = { standard: { ...std(page), box: SKY }, 'eye level, looking NW and up 32 deg': { eye: [-300, 400, 315, 32], mode: 'ground', box: [0, 0, 1, 0.55] } };
    for (const [vn, o] of Object.entries(views)) {
      const { box, ...oo } = o;
      const R = await frame(page, { ...oo, look: 'realistic', ms: NIGHT });
      const B = await frame(page, { ...oo, look: 'brighter', ms: NIGHT });
      const D = await frame(page, { ...oo, look: 'daylight', ms: NIGHT });
      const X = await frame(page, { ...oo, look: 'daylight', ms: NIGHT, tune: { skyMap: true } });
      const m = (fr) => stats(fr.img, box);
      console.log(`${vn}: region ${JSON.stringify(box)}`);
      console.log(`   mean luma  R ${f2(m(R).mean)}  B ${f2(m(B).mean)}  D ${f2(m(D).mean)}  D with the bug ${f2(m(X).mean)}    max luma  R ${f1(m(R).max)}  D ${f1(m(D).max)}  bug ${f1(m(X).max)}`);
      console.log(`   differing pixels vs Realistic:  B ${diff(R.img, B.img, box).pixels}  D ${diff(R.img, D.img, box).pixels}  D with the bug ${diff(R.img, X.img, box).pixels} of ${(crop(R.img, box).x1 - crop(R.img, box).x0) * (crop(R.img, box).y1 - crop(R.img, box).y0)}`);
    }
    await page.context().close();
  },

  // Map types: photo, fuel colours (photo off), plain; ground luma per look.
  async maptypes() {
    console.log('\n## maptypes: ground region mean luma at night, default fire framing; the plain map is neutral grey');
    for (const site of Object.keys(SITES)) {
      const page = await open(`site=${site}&start=22&t=7200`);
      const cam = page.defaultCam;
      const box = [0.04, 0.68, 0.96, 0.97];
      const types = { photo: [{ imagery: true }, false], 'fuel colours': [{ imagery: false }, false], plain: [{ imagery: false }, true] };
      for (const [tn, [layers, plain]] of Object.entries(types)) {
        const v = [];
        for (const look of LOOKS) v.push(mean((await frame(page, { look, ms: NIGHT, mode: 'orbit', cam, layers, plain })).img, box));
        const D = await frame(page, { look: 'realistic', ms: DAY, layers, plain });
        console.log(`${site.padEnd(9)} ${tn.padEnd(13)} R ${f1(v[0]).padStart(5)}  B ${f1(v[1]).padStart(5)}  D ${f1(v[2]).padStart(5)}   (day 13:00 Realistic ${f1(mean(D.img, box))})`);
      }
      await page.context().close();
    }
  },

  // Roads, labels, houses and trees: how close does a lit map at night get to the same view by day?
  async town() {
    console.log('\n## town: place layers on (roads, fire trails, names, homes, zones) and trees; mean absolute luma difference to the same frame at 13:00 over the frame below the top quarter, and the P99 luma (roads and labels are the brightest ground features)');
    for (const [site, q] of [['thredbo', 'town=Thredbo&d=1400&az=200&tilt=55'], ['katoomba', 'town=Katoomba&d=1800&az=200&tilt=55']]) {
      const page = await open(`site=${site}&start=22&t=7200&context=1&homes=1&zones=1&names=1&${q}`);
      const cam = page.defaultCam;
      const day = await frame(page, { look: 'realistic', ms: DAY, mode: 'orbit', cam });
      const y0 = Math.floor(0.25 * day.img.h);
      const p99 = (img) => {
        const v = [];
        for (let y = y0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) v.push(lumaOf(img, (y * img.w + x) * img.ch));
        v.sort((a, b) => a - b);
        return v[Math.floor(0.99 * v.length)];
      };
      console.log(`${site}: day 13:00 P99 ${f1(p99(day.img))}  mean ${f1(stats(day.img, [0, 0.25, 1, 1]).mean)}  names shown: ${(await page.evaluate(() => window.__fs.view.shownPlaceNames?.() ?? [])).join(', ')}`);
      for (const look of LOOKS) {
        const fr = await frame(page, { look, ms: NIGHT, mode: 'orbit', cam });
        let d = 0, n = 0;
        for (let y = y0; y < fr.img.h; y++) for (let x = 0; x < fr.img.w; x++) { const i = (y * fr.img.w + x) * fr.img.ch; d += Math.abs(lumaOf(fr.img, i) - lumaOf(day.img, i)); n++; }
        console.log(`   night ${look.padEnd(10)} mean |difference to day| ${f1(d / n)}   P99 ${f1(p99(fr.img))}   mean ${f1(stats(fr.img, [0, 0.25, 1, 1]).mean)}`);
      }
      await page.context().close();
    }
  },

  // Realistic against an unpatched HEAD, pixel for pixel (needs S4_HEAD_PORT).
  async head() {
    if (!HEAD_PORT) { console.log('\n## head: skipped (set S4_HEAD_PORT to a dev server of the unpatched HEAD)'); return; }
    console.log('\n## head: Realistic of the prototype against an unpatched HEAD, same states, pixel for pixel (places, homes and zones on; embers off, because two page loads seed their ember particles differently, which shows as streaks in the fire even by day)');
    const q = 'site=katoomba&start=22&t=7200&context=1&homes=1&zones=1&embers=0';
    const proto = await open(q + (process.env.S4_HEAD_EXTRA ? '&' + process.env.S4_HEAD_EXTRA : '')); // e.g. nlBlend=separate: the prototype's own switches, to find what a difference comes from
    const head = await open(q, HEAD_PORT);
    const times = [];
    for (const el of [30, 8, 4, 0.8, 0, -2, -6, -12]) times.push([`dusk el ${el}`, await timeFor(proto, el)]);
    times.push(['night 22:00', NIGHT], ['day 13:00', DAY], ['dawn el 4', await timeFor(proto, 4, 'dawn')]);
    const cams = [['default', proto.defaultCam], ['close', SITES.katoomba.fire.close], ['wide', [0, 0, 9500, 200, 68]]];
    const only = (process.env.S4_HEAD_ONLY ?? '').split(',').filter(Boolean); // e.g. "day 13:00" to limit the states
    const dump = process.env.S4_DUMP; // a folder: the frame pair and a difference image of every frame that differs
    let same = 0, total = 0;
    for (const [tn, ms] of times) for (const [cn, cam] of cams) {
      if (only.length && !only.includes(tn)) continue;
      const a = await frame(proto, { look: 'realistic', ms, mode: 'orbit', cam });
      const b = await frame(head, { look: 'realistic', ms, mode: 'orbit', cam });
      const d = diff(a.img, b.img);
      if (process.env.S4_HEAD_PROBE) console.log(`  probe ${tn} / ${cn}: uShadowGain ${await proto.evaluate(() => window.__fs.view.u.uShadowGain.value)}, sun elevation ${await proto.evaluate(() => window.__fs.view.u.uSunI.value)} (uSunI)`);
      total++; if (d.pixels === 0 && a.calls === b.calls && a.triangles === b.triangles) same++;
      if (d.pixels) console.log(`  ${tn} / ${cn}: ${d.pixels} pixels differ (max ${d.max}); draw calls ${a.calls} / ${b.calls}, triangles ${a.triangles} / ${b.triangles}`);
      if (dump && d.pixels) {
        fs.mkdirSync(dump, { recursive: true });
        const base = `${dump}/${tn.replace(/\W+/g, '_')}-${cn}`;
        fs.writeFileSync(`${base}-proto.png`, a.png);
        fs.writeFileSync(`${base}-head.png`, b.png);
        const m = new Uint8Array(a.img.w * a.img.h * 4);
        for (let i = 0; i < a.img.w * a.img.h; i++) {
          const dd = Math.max(Math.abs(a.img.data[i * a.img.ch] - b.img.data[i * a.img.ch]), Math.abs(a.img.data[i * a.img.ch + 1] - b.img.data[i * a.img.ch + 1]), Math.abs(a.img.data[i * a.img.ch + 2] - b.img.data[i * a.img.ch + 2]));
          m[i * 4] = dd ? 255 : 0; m[i * 4 + 1] = dd ? 255 : a.img.data[i * a.img.ch + 1] >> 2; m[i * 4 + 2] = dd ? 0 : 0; m[i * 4 + 3] = 255;
        }
        fs.writeFileSync(`${base}-diffmask.png`, Buffer.from(encode({ width: a.img.w, height: a.img.h, data: m, channels: 4, depth: 8 })));
      }
    }
    console.log(`${same} of ${total} frames identical (pixels, draw calls and triangles)`);
    await proto.context().close();
    await head.context().close();
  },
};

// ═════════════════════════════════════════ shots ══════════════════════════════════════════════════════════════════

const shots = {
  async looks(site, name) {
    const page = await open(`site=${site}&start=22&t=7200`);
    const cam = page.defaultCam;
    const tiles = [];
    for (const look of LOOKS) tiles.push({ png: (await frame(page, { look, ms: NIGHT, mode: 'orbit', cam })).png, label: `${site}, 22:00, ${look}` });
    writeShot(name, await sheet(tiles, { cols: 3, scale: 0.6 }));
    await page.context().close();
  },
  async fade() {
    const page = await open('site=katoomba&start=22&t=7200');
    const base = std(page);
    const tiles = [];
    for (const look of ['realistic', 'daylight'])
      for (const el of [8, 4, 0, -2, -6]) {
        const ms = await timeFor(page, el);
        tiles.push({ png: (await frame(page, { ...base, look, ms })).png, label: `${look} sun ${el > 0 ? '+' : ''}${el}` });
      }
    writeShot('03-dusk-fade-katoomba.jpg', await sheet(tiles, { cols: 5, scale: 0.42 }));
    await page.context().close();
  },
  async regions() {
    const page = await open('site=katoomba&start=22&t=7200');
    const base = std(page);
    const tiles = [];
    for (const look of LOOKS) tiles.push({ png: (await frame(page, { ...base, look })).png, label: `${look}, standard view, 22:00`, boxes: [{ box: GROUND, color: '#4f4', text: 'ground' }, { box: SKY, color: '#4cf', text: 'sky' }] });
    writeShot('04-e2e-regions-katoomba.jpg', await sheet(tiles, { cols: 3, scale: 0.6 }));
    await page.context().close();
  },
  async relief() {
    const page = await open(`site=katoomba&start=22&${RELIEF_Q}`);
    const t = SITES.katoomba.tgt;
    const tiles = [];
    for (const [el, label] of [[40, 'sun el 40 (plan)'], [30, 'sun el 30']])
      for (const h of [135, 225, 45, 315]) tiles.push({ png: (await frame(page, { look: 'daylight', ms: NIGHT, mode: 'orbit', cam: [t[0], t[1], t[2], h, 58], tune: { az: 315, el } })).png, label: `${label}\ncamera az ${h}` });
    writeShot('05-relief-headings-katoomba.jpg', await sheet(tiles, { cols: 4, scale: 0.42 }));
    const top = [];
    for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) top.push({ png: (await frame(page, { look: 'daylight', ms: NIGHT, mode: 'top', cam: [t[0], t[1], 6500, 0, 0], tune: { az, el: 30 } })).png, label: `sun az ${az}, el 30` });
    writeShot('06-sun-azimuth-plan-view.jpg', await sheet(top, { cols: 8, scale: 0.3 }));
    await page.context().close();
  },
  async fire() {
    const page = await open('site=katoomba&start=22&t=7200');
    const cam = SITES.katoomba.fire.close;
    const tiles = [];
    tiles.push({ png: (await frame(page, { look: 'realistic', ms: DAY, mode: 'orbit', cam })).png, label: 'day 13:00' });
    for (const look of LOOKS) tiles.push({ png: (await frame(page, { look, ms: NIGHT, mode: 'orbit', cam })).png, label: `22:00 ${look}` });
    writeShot('07-fire-close-katoomba.jpg', await sheet(tiles, { cols: 4, scale: 0.5 }));
    const wide = [];
    for (const [label, tune] of [['smoke on map light (plan)', { smoke: 1 }], ['smoke on real light', { smoke: 0 }]]) wide.push({ png: (await frame(page, { look: 'daylight', ms: NIGHT, mode: 'orbit', cam: page.defaultCam, tune })).png, label: `Katoomba, Daylight\n${label}` });
    await page.context().close();
    const pt = await open('site=thredbo&start=22&t=7200');
    for (const [label, tune] of [['smoke on map light (plan)', { smoke: 1 }], ['smoke on real light', { smoke: 0 }]]) wide.push({ png: (await frame(pt, { look: 'daylight', ms: NIGHT, mode: 'orbit', cam: pt.defaultCam, tune })).png, label: `Thredbo, Daylight\n${label}` });
    writeShot('08-smoke-light.jpg', await sheet(wide, { cols: 4, scale: 0.5 }));
    await pt.context().close();
  },
  async maptypes() {
    const page = await open('site=katoomba&start=22&t=7200');
    const cam = page.defaultCam;
    const tiles = [];
    for (const [tn, layers, plain] of [['photo', { imagery: true }, false], ['fuel colours', { imagery: false }, false], ['plain', { imagery: false }, true]])
      for (const look of ['realistic', 'brighter', 'daylight']) tiles.push({ png: (await frame(page, { look, ms: NIGHT, mode: 'orbit', cam, layers, plain })).png, label: `${tn}, ${look}` });
    writeShot('09-map-types-katoomba.jpg', await sheet(tiles, { cols: 3, scale: 0.4 }));
    await page.context().close();
  },
  async town() {
    const page = await open('site=thredbo&start=22&t=7200&context=1&homes=1&zones=1&names=1&town=Thredbo&d=1400&az=200&tilt=55');
    const cam = page.defaultCam;
    const tiles = [{ png: (await frame(page, { look: 'realistic', ms: DAY, mode: 'orbit', cam })).png, label: 'day 13:00' }];
    for (const look of LOOKS) tiles.push({ png: (await frame(page, { look, ms: NIGHT, mode: 'orbit', cam })).png, label: `22:00 ${look}` });
    writeShot('10-town-thredbo.jpg', await sheet(tiles, { cols: 4, scale: 0.5 }));
    await page.context().close();
  },
  async eye() {
    const page = await open('site=katoomba&start=22&t=7200&user=-300,400,300');
    const tiles = [];
    const view = { mode: 'ground' };
    tiles.push({ png: (await frame(page, { ...view, look: 'realistic', ms: DAY })).png, label: 'eye level, day 13:00' });
    for (const look of ['realistic', 'daylight']) tiles.push({ png: (await frame(page, { ...view, look, ms: NIGHT })).png, label: `eye level, 22:00 ${look}` });
    tiles.push({ png: (await frame(page, { ...view, look: 'daylight', ms: NIGHT, tune: { fog: 1 } })).png, label: 'Daylight, fog cut to 0\n(the plan)' });
    writeShot('11-eye-level-katoomba.jpg', await sheet(tiles, { cols: 4, scale: 0.5 }));
    const sky = [];
    const eye = { eye: [-300, 400, 315, 32], mode: 'ground' };
    for (const [label, look, tune] of [['Realistic', 'realistic', {}], ['Daylight, sky has its own sun', 'daylight', {}], ['Daylight, sky shares the map sun (the bug)', 'daylight', { skyMap: true }]])
      sky.push({ png: (await frame(page, { ...eye, look, ms: NIGHT, tune })).png, label: `Looking NW and up 32 deg\n${label}` });
    writeShot('12-sky-sun-disc.jpg', await sheet(sky, { cols: 3, scale: 0.6 }));
    await page.context().close();
  },
  async shadow() {
    const page = await open('site=katoomba&start=22&t=7200');
    const base = std(page);
    const tiles = [];
    // Per variant: the frames either side of the +0.5 degree cut-off and their difference, times 6.
    for (const [label, shadow] of [['shadows as in the plan', false], ['shadows x (1 - w)', true]]) {
      const fr = [];
      for (const el of [0.55, 0.45]) {
        const ms = await timeFor(page, el);
        fr.push(await frame(page, { ...base, look: 'daylight', ms, tune: { shadow } }));
        tiles.push({ png: fr.at(-1).png, label: `Daylight, sun +${el} deg\n${label}` });
      }
      const a = fr[0].img, b = fr[1].img;
      const d = new Uint8Array(a.w * a.h * 4);
      for (let i = 0; i < a.w * a.h; i++) for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.min(255, 6 * Math.abs(a.data[i * a.ch + c] - b.data[i * b.ch + c]));
      for (let i = 0; i < a.w * a.h; i++) d[i * 4 + 3] = 255;
      tiles.push({ png: Buffer.from(encode({ width: a.w, height: a.h, data: d, channels: 4, depth: 8 })), label: `difference x 6\n${label}` });
    }
    writeShot('13-shadow-step.jpg', await sheet(tiles, { cols: 3, scale: 0.5 }));
    await page.context().close();
  },
  async night() {
    const page = await open(`site=katoomba&start=22&${RELIEF_Q}`);
    const t = SITES.katoomba.tgt;
    const midnight = Date.UTC(2019, 11, 21, 24 - 11, 0, 0);
    const tiles = [];
    for (const [dir, label] of [['vector', 'plan: vector blend'], ['light', 'light-weighted blend']])
      for (const [h, c] of [[21.5, '21:30'], [24, '00:00'], [27, '03:00']])
        tiles.push({ png: (await frame(page, { look: 'brighter', ms: midnight + (h - 24) * 3600e3, mode: 'top', cam: [t[0], t[1], 5000, 0, 0], tune: { dir } })).png, label: `Brighter ${c}\n${label}` });
    writeShot('14-brighter-through-the-night.jpg', await sheet(tiles, { cols: 3, scale: 0.4 }));
    await page.context().close();
  },
};

// ═════════════════════════════════════════ main ═══════════════════════════════════════════════════════════════════

try {
  if (cmd === 'shots' || cmd === 'all') {
    const want = (n) => !wantedShots.length || wantedShots.includes(n);
    if (want('looks-katoomba')) await shots.looks('katoomba', '01-katoomba-night-three-looks.jpg');
    if (want('looks-thredbo')) await shots.looks('thredbo', '02-thredbo-night-three-looks.jpg');
    if (want('fade')) await shots.fade();
    if (want('regions')) await shots.regions();
    if (want('relief')) await shots.relief();
    if (want('fire')) await shots.fire();
    if (want('maptypes')) await shots.maptypes();
    if (want('town')) await shots.town();
    if (want('eye')) await shots.eye();
    if (want('shadow')) await shots.shadow();
    if (want('night')) await shots.night();
  }
  if (cmd === 'tables' || cmd === 'all') {
    const names = wanted.length ? wanted : Object.keys(tables).filter((n) => n !== 'head' || HEAD_PORT);
    for (const n of names) {
      if (!tables[n]) throw new Error(`unknown section ${n}; sections: ${Object.keys(tables).join(' ')}`);
      const t0 = Date.now();
      await tables[n]();
      console.log(`(section ${n}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    console.log(`\nconsole messages from the page (the missing favicon is left out): ${consoleLog.length ? '\n' + consoleLog.join('\n') : 'none'}`);
  }
} finally {
  await browser.close();
}
