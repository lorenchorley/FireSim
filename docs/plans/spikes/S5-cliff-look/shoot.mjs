// Spike S5 (docs/plans/air-slice-wind-detail-honest-speed.md, 9d.5): screenshots and flicker numbers of the cliff prototype.
// Runs from the repo root against the Vite dev server of the PATCHED tree (prototype.patch applied), port in PORT:
//
//   npx vite --port 4305 --strictPort &                     # in the patched tree
//   PORT=4305 node docs/plans/spikes/S5-cliff-look/shoot.mjs shots     # the JPEG composites in shots/ (about 7 minutes)
//   PORT=4305 node docs/plans/spikes/S5-cliff-look/shoot.mjs shimmer   # frame-pair flicker numbers (about 12 minutes; SITES=a,b VIEWS=orbit,eye PANELS=today,split to pick)
//   PORT=4305 node docs/plans/spikes/S5-cliff-look/shoot.mjs timing    # cold setScenario stage times in the browser (performance.now); RUNS=3 SITES=a,b PANELS=today,split
//   PORT=4305 RAW=/tmp/s5raw node docs/plans/spikes/S5-cliff-look/shoot.mjs raw   # every panel as a full-size PNG, to look at 1:1
//   (with RAW set, `shots` reuses a panel's PNG from that folder when it is there, so crops and labels can be changed without
//    rendering again; delete the folder or a file to render it afresh)
//
// Optional: ONLY=name,name (only the composites whose file name contains one of these), OUT=<dir> (default: shots/ next to this
// file), CHROMIUM=<path> (default /opt/pw-browsers/chromium). Software rendering (SwiftShader): about 10 s per frame.
// Every picture is the render harness (src/render/dev.html) at 412 x 915, device scale 1, quality as stated, imagery and trees
// on, no wind, smoke, flames or markers, the synthetic fire not yet started. The panels of a composite differ only in the flags,
// and all panels of a view share one camera pose (read from the `today` drawing, then held):
//   today    sharpen=0 mesh=old light=0            the app's present drawing (the 10 m terrain goes to setScenario as hiRes, hires=1)
//   plan     sharpen=1 mesh=keep light=1           plan 9d.3 as written: sharpened 10 m terrain, edge-keeping mesh, one 10 m
//                                                  gradient texture for both the normal and the slope that picks rock or photo
//   mesh-lit sharpen=1 mesh=keep light=meshgrid    the same terrain and mesh, normal and slope both from the mesh's own gradient
//   split    sharpen=1 mesh=keep light=n10s-mesh   normal from the 10 m sharpened terrain, slope from the mesh (recommended)
//   10 m     sharpen=1 mesh=old light=1 meshN=900  the whole 10 m terrain as the mesh (1.6 M triangles, a reference, not shippable)
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT;
if (!PORT) throw new Error('set PORT to the port of the dev server of the patched tree');
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT ?? join(here, 'shots');
const RAW = process.env.RAW;
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const mode = process.argv[2] ?? 'shots';

// ── What is drawn ────────────────────────────────────────────────────────────────────────────
const COMMON = 'hud=0&wind=off&smoke=0&flames=0&embers=0&marks=0&dpr=1&t=0&hires=1';
/** The flags of a picture: COMMON, quality=high unless the view says otherwise (the harness reads the first value of a repeated flag). */
const flags = (q, extra = '') => `${COMMON}&${/quality=/.test(q) ? '' : 'quality=high&'}${q}${extra ? '&' + extra : ''}`;
const FLAGS = {
  today: 'sharpen=0&mesh=old&light=0',
  plan: 'sharpen=1&mesh=keep&light=1',
  'mesh-lit': 'sharpen=1&mesh=keep&light=meshgrid',
  '10 m': 'sharpen=1&mesh=old&light=1&meshN=900',
  '10 m data': 'sharpen=0&mesh=old&light=1&meshN=900',
  // the fallback ladder, with the plan's 10 m lighting
  'R0 plan': 'sharpen=1&mesh=keep&light=1',
  'R1 gate 52-66': 'sharpen=1&mesh=keep&light=1&lo=52&hi=66',
  'R2 + window 1': 'sharpen=1&mesh=keep&light=1&lo=52&hi=66&win=1',
  'R3 + snap': 'sharpen=1&mesh=keep&light=1&lo=52&hi=66&win=1&snap=0.25',
  // the same ladder with the recommended lighting (split)
  'R0 split': 'sharpen=1&mesh=keep&light=n10s-mesh',
  'R1 split': 'sharpen=1&mesh=keep&light=n10s-mesh&lo=52&hi=66',
  'R2 split': 'sharpen=1&mesh=keep&light=n10s-mesh&lo=52&hi=66&win=1',
  'R3 split': 'sharpen=1&mesh=keep&light=n10s-mesh&lo=52&hi=66&win=1&snap=0.25',
  hybrid: 'sharpen=1&mesh=keep&light=hybrid',
  // the plan's lighting split in two: which part of it makes the artifacts?
  split: 'sharpen=1&mesh=keep&light=n10s-mesh',            // lighting from the 10 m terrain, the strata / photo choice from the mesh
  'split reversed': 'sharpen=1&mesh=keep&light=nmesh-s10', // lighting from the mesh, the strata / photo choice from the 10 m terrain
  'mesh-lit + despike': 'sharpen=1&mesh=keep&light=meshgrid&mdespike=10',
  // the 10 m reference with other constants (terracing)
  '10 m R3': 'sharpen=1&mesh=old&light=1&meshN=900&lo=52&hi=66&win=1&snap=0.25',
  '10 m str 0.6': 'sharpen=1&mesh=old&light=1&meshN=900&str=0.6',
  // the mesh facets alone (flat shading, no photo, no trees)
  'data, blur': 'sharpen=0&mesh=old&dbg=flat&imagery=0&veg=0',
  'sharp, blur': 'sharpen=1&mesh=old&dbg=flat&imagery=0&veg=0',
  'sharp, keep': 'sharpen=1&mesh=keep&dbg=flat&imagery=0&veg=0',
};

// ── Where: the face of each site (local metres), the compass direction it faces (downhill), and the views ───────────────────
// Faces were chosen from the 10 m terrain as the sheerest tall ones near the middle of each site (lip to foot within about 120 m
// of run): Katoomba 188 m, Kanangra 161 m, Grose 176 m, Tomah 126 m. `eye` = how far downhill the viewer stands (m).
const SITES = {
  katoomba: { face: [2505, -1995], down: 181, eye: 260, orbit: 1100, top: 800 },
  kanangra: { face: [-55, 505], down: 348, eye: 320, orbit: 1100, top: 800 },
  grose: { face: [-1665, -915], down: 89, eye: 260, orbit: 1100, top: 800 },
  tomah: { face: [2225, -4185], down: 239, eye: 120, orbit: 800, top: 600 },
};
const rad = (d) => (d * Math.PI) / 180;
function camera(site, view, o = {}) {
  const s = SITES[site];
  const [cx, cy] = s.face;
  const q = [`site=${site}`];
  if (view === 'orbit') {
    q.push(`cam=${cx},${cy},${o.dist ?? s.orbit},${(s.down + (o.off ?? 25) + 360) % 360},${o.tilt ?? 66}`);
  } else if (view === 'top') {
    q.push(`cam=${cx},${cy},${o.dist ?? s.top},${s.down},0`, 'view=top');
  } else {
    const d = o.eye ?? s.eye;
    q.push(`eye=${(cx + d * Math.sin(rad(s.down))).toFixed(0)},${(cy + d * Math.cos(rad(s.down))).toFixed(0)},${cx},${cy}`);
  }
  return q.join('&');
}

// ── The composites ───────────────────────────────────────────────────────────────────────────
// A ROW is one camera and its panels; a FILE is one or more rows stacked. crop = [x, y, w, h] in the 412 x 915 frame.
const STD = ['today', 'plan', 'mesh-lit', 'split'];
const ROWS = new Map();
const row = (name, q, panels, crop, tag = '') => ROWS.set(name, { name, q, panels, crop, tag });
row('katoomba-orbit-high', camera('katoomba', 'orbit'), STD, [0, 270, 412, 330]);
row('kanangra-orbit-high', camera('kanangra', 'orbit'), STD, [0, 230, 412, 380]);
row('grose-orbit-high', camera('grose', 'orbit'), STD, [0, 200, 412, 330]);
row('tomah-orbit-high', camera('tomah', 'orbit'), STD, [0, 250, 412, 330]);
row('katoomba-top-high', camera('katoomba', 'top'), STD, [0, 300, 412, 330], 'Katoomba');
row('kanangra-top-high', camera('kanangra', 'top'), STD, [0, 300, 412, 330], 'Kanangra');
row('grose-top-high', camera('grose', 'top'), STD, [0, 300, 412, 330], 'Grose');
row('tomah-top-high', camera('tomah', 'top'), STD, [0, 300, 412, 330], 'Tomah');
row('katoomba-eye-high', camera('katoomba', 'eye'), STD, [0, 0, 412, 500]);
row('kanangra-eye-high', camera('kanangra', 'eye'), STD, [0, 0, 412, 500]);
row('grose-eye-high', camera('grose', 'eye'), STD, [0, 0, 412, 500]);
row('tomah-eye-high', camera('tomah', 'eye'), STD, [0, 150, 412, 500]);
row('katoomba-orbit-low', camera('katoomba', 'orbit') + '&quality=low', STD, [0, 270, 412, 330], 'Katoomba, Low');
row('grose-orbit-low', camera('grose', 'orbit') + '&quality=low', STD, [0, 200, 412, 330], 'Grose, Low');
row('kanangra-orbit-low', camera('kanangra', 'orbit') + '&quality=low', STD, [0, 230, 412, 380]);
row('katoomba-wide-high', camera('katoomba', 'orbit', { dist: 3000, tilt: 62 }), STD, [0, 300, 412, 330]);
row('katoomba-close-high', camera('katoomba', 'orbit', { dist: 450, tilt: 60 }), STD, [0, 250, 412, 380]);
row('katoomba-reference-10m', camera('katoomba', 'orbit'), ['mesh-lit', '10 m', '10 m data'], [0, 270, 412, 330]);
row('katoomba-ladder', camera('katoomba', 'orbit'), ['R0 plan', 'R1 gate 52-66', 'R2 + window 1', 'R3 + snap'], [0, 300, 412, 270]);
row('katoomba-facets', camera('katoomba', 'orbit'), ['data, blur', 'sharp, blur', 'sharp, keep'], [0, 230, 412, 390]);
// Grose's long face with benches (not the sheer face used elsewhere), from the side, on the whole 10 m terrain as the mesh
row('grose-terraces', 'site=grose&cam=3355,3475,900,265,64', ['10 m data', '10 m', '10 m str 0.6', '10 m R3'], [0, 230, 412, 360]);
row('katoomba-ladder-ml', camera('katoomba', 'orbit'), ['R0 split', 'R1 split', 'R2 split', 'R3 split'], [0, 300, 412, 270]);
row('katoomba-lighting', camera('katoomba', 'orbit'), ['plan', 'mesh-lit', 'hybrid'], [0, 270, 412, 330]);
row('grose-lighting-low', camera('grose', 'orbit') + '&quality=low', ['plan', 'mesh-lit', 'hybrid'], [0, 200, 412, 330]);
row('katoomba-split', camera('katoomba', 'orbit'), ['plan', 'split', 'split reversed', 'mesh-lit'], [0, 270, 412, 330]);
row('grose-split-low', camera('grose', 'orbit') + '&quality=low', ['plan', 'split', 'split reversed', 'mesh-lit'], [0, 200, 412, 330]);
row('kanangra-split-nophoto-1700', camera('kanangra', 'orbit') + '&imagery=0&start=17', ['plan', 'split', 'split reversed', 'mesh-lit'], [0, 230, 412, 380], 'no photo, 17:00');
row('kanangra-lighting', camera('kanangra', 'orbit'), ['plan', 'mesh-lit', 'hybrid'], [0, 230, 412, 380]);
// Without the photo the sun's own lighting shows (the photo carries the capture day's shading and the shader keeps it at half
// contrast). Kanangra's face looks north, towards the sun at 13:00; at 17:00 the sun is low in the west, along the face.
row('kanangra-nophoto-1300', camera('kanangra', 'orbit') + '&imagery=0', STD, [0, 230, 412, 380], 'no photo, 13:00');
row('kanangra-nophoto-1700', camera('kanangra', 'orbit') + '&imagery=0&start=17', STD, [0, 230, 412, 380], 'no photo, 17:00');
// Single-vertex spikes of the edge-keeping mesh: a 29 m tower on Katoomba's face and a 37 m pit in Grose's lip, 320 m away
row('katoomba-vertex-spike', 'site=katoomba&cam=-1228,462,320,200,55', ['today', 'mesh-lit', 'mesh-lit + despike'], [0, 200, 412, 500], 'Katoomba tower');
row('grose-vertex-pit', 'site=grose&cam=3346,3549,320,200,55', ['today', 'mesh-lit', 'mesh-lit + despike'], [0, 200, 412, 500], 'Grose pit');
// Short faces (78 m and 58 m high), where a 22 m mesh has two or three vertices across the face: today, the mesh with mesh lighting,
// and the whole 10 m terrain as the mesh (what steep-patch refinement would give). Orbit 520 m, 24 degrees above the horizon.
row('katoomba-short', 'site=katoomba&cam=-165,-1865,520,350,66', ['today', 'mesh-lit', '10 m'], [0, 250, 412, 420]);
row('tomah-short', 'site=tomah&cam=-1235,2245,520,238,66', ['today', 'mesh-lit', '10 m'], [0, 250, 412, 420]);
// The long benched face at Grose (see grose-terraces) as the shipped mesh draws it, against the 10 m mesh.
row('grose-refine', 'site=grose&cam=3355,3475,900,265,64', ['today', 'mesh-lit', '10 m'], [0, 230, 412, 420]);
const FILES = [
  // [file, rows (stacked), scale of a panel]
  ['katoomba-orbit-high.jpg', ['katoomba-orbit-high'], 0.75],
  ['kanangra-orbit-high.jpg', ['kanangra-orbit-high'], 0.75],
  ['grose-orbit-high.jpg', ['grose-orbit-high'], 0.75],
  ['tomah-orbit-high.jpg', ['tomah-orbit-high'], 0.75],
  ['top-high-katoomba-kanangra.jpg', ['katoomba-top-high', 'kanangra-top-high'], 0.6],
  ['top-high-grose-tomah.jpg', ['grose-top-high', 'tomah-top-high'], 0.6],
  ['eye-high-katoomba-kanangra.jpg', ['katoomba-eye-high', 'kanangra-eye-high'], 0.55],
  ['eye-high-grose-tomah.jpg', ['grose-eye-high', 'tomah-eye-high'], 0.55],
  ['orbit-low-katoomba-grose.jpg', ['katoomba-orbit-low', 'grose-orbit-low'], 0.6],
  ['katoomba-wide-high.jpg', ['katoomba-wide-high'], 0.75],
  ['katoomba-close-high.jpg', ['katoomba-close-high'], 0.75],
  ['lighting-sources.jpg', ['katoomba-split', 'grose-split-low', 'kanangra-split-nophoto-1700'], 0.6],
  ['katoomba-facets.jpg', ['katoomba-facets'], 1],
  ['katoomba-reference-10m.jpg', ['katoomba-reference-10m'], 1],
  ['katoomba-ladder.jpg', ['katoomba-ladder', 'katoomba-ladder-ml'], 0.75],
  ['grose-terraces.jpg', ['grose-terraces'], 0.85],
  ['short-faces.jpg', ['katoomba-short', 'tomah-short'], 0.8],
  ['grose-refine.jpg', ['grose-refine'], 1],
  ['no-photo-sun.jpg', ['kanangra-nophoto-1300', 'kanangra-nophoto-1700'], 0.6],
  ['vertex-spikes.jpg', ['katoomba-vertex-spike', 'grose-vertex-pit'], 0.8],
];

// ── Rendering ────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Open the harness with `q` (+ `extra` flags), put the camera at `pose` when one is given, wait until it is still, hand over the page. */
async function open(q, extra = '', pose = null) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
  await page.goto(`${BASE}/src/render/dev.html?${flags(q, extra)}`);
  await page.waitForFunction(() => window.__fs && (window.__fs.ready || window.__fs.error), null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__fs.error);
  if (err) throw new Error(`harness error for ${q}: ${err}`);
  if (pose) await page.evaluate(([p, t]) => window.__fs.view.setPose(p, t), [pose.pos, pose.target]);
  await settle(page);
  return { page, ctx };
}

// One camera pose per view, taken from the TODAY drawing after the rig has seated itself on that drawing's terrain, and then
// held exactly (setPose freezes the seating) for every other panel: the panels of a comparison differ only in what is drawn,
// never in where the camera is (the target of a view sits on the ground, and the sharpened ground is not at today's height).
const poses = new Map();
const todayFrames = new Map();
async function poseFor(q) {
  if (RAW && !poses.size && existsSync(join(RAW, 'poses.json'))) for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(RAW, 'poses.json'), 'utf8')))) poses.set(k, v);
  if (poses.has(q)) return poses.get(q);
  const { page, ctx } = await open(q, FLAGS.today);
  poses.set(q, await page.evaluate(() => window.__fs.view.getPose()));
  todayFrames.set(q, await page.screenshot());
  await ctx.close();
  if (RAW) writeFileSync(join(RAW, 'poses.json'), JSON.stringify(Object.fromEntries(poses), null, 1));
  return poses.get(q);
}
async function settle(page) {
  let last = '';
  let same = 0;
  for (let n = 0; n < 90 && same < 3; n++) {
    await page.waitForTimeout(700);
    let sig;
    try {
      sig = await page.evaluate(() => {
        const v = window.__fs.view;
        const p = v.camera.position;
        return [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2), v.diagnostics().vegetation].join(',');
      });
    } catch (e) {
      // the dev server reloaded the page (a source file changed): wait for the harness again
      await page.waitForFunction(() => window.__fs && (window.__fs.ready || window.__fs.error), null, { timeout: 300000 });
      same = 0;
      continue;
    }
    same = sig === last ? same + 1 : 0;
    last = sig;
  }
  await page.waitForTimeout(500);
}
async function frame(q, extra, pose) {
  const { page, ctx } = await open(q, extra, pose);
  const png = await page.screenshot();
  const info = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fs.view.cliffInfo)));
  await ctx.close();
  return { png, info };
}

// ── Composing (in the browser: no image library needed) ────────────────────────────────────────────
async function compose(page, rows, pngs, scale) {
  const url = await page.evaluate(
    async ({ rows, pngs, scale }) => {
      const load = (b64) =>
        new Promise((ok) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.src = `data:image/png;base64,${b64}`;
        });
      const gap = 3;
      const sizes = rows.map((r) => ({ pw: Math.round(r.crop[2] * scale), ph: Math.round(r.crop[3] * scale) }));
      const W = Math.max(...rows.map((r, k) => r.panels.length * sizes[k].pw + (r.panels.length - 1) * gap));
      const H = sizes.reduce((a, z) => a + z.ph, 0) + (rows.length - 1) * gap;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      let oy = 0;
      for (let r = 0; r < rows.length; r++) {
        const [x, y, w, h] = rows[r].crop;
        const { pw, ph } = sizes[r];
        const imgs = await Promise.all(pngs[r].map(load));
        imgs.forEach((im, k) => {
          const ox = k * (pw + gap);
          g.drawImage(im, x, y, w, h, ox, oy, pw, ph);
          const label = (rows[r].tag ? rows[r].tag + ': ' : '') + rows[r].panels[k];
          g.font = '600 11px system-ui, sans-serif';
          const tw = g.measureText(label).width;
          g.fillStyle = 'rgba(0,0,0,0.62)';
          g.fillRect(ox, oy, tw + 10, 17);
          g.fillStyle = '#fff';
          g.fillText(label, ox + 5, oy + 12);
        });
        oy += ph + gap;
      }
      return c.toDataURL('image/jpeg', 0.8);
    },
    { rows: rows.map((r) => ({ crop: r.crop, panels: r.panels, tag: r.tag })), pngs: pngs.map((row) => row.map((b) => b.toString('base64'))), scale },
  );
  return Buffer.from(url.split(',')[1], 'base64');
}

/** The PNG of every panel of a row (from the RAW folder when it is there), all with the camera pose of the today drawing. */
async function renderRow(row) {
  const pngs = [];
  const pose = await poseFor(row.q);
  for (const p of row.panels) {
    const cached = RAW ? join(RAW, `${row.name}__${p.replace(/[^a-z0-9]+/gi, '_')}.png`) : null;
    if (cached && existsSync(cached)) {
      pngs.push(readFileSync(cached));
      continue;
    }
    const png = p === 'today' && todayFrames.has(row.q) ? todayFrames.get(row.q) : (await frame(row.q, FLAGS[p], pose)).png;
    pngs.push(png);
    if (cached) writeFileSync(cached, png);
  }
  return pngs;
}

if (mode === 'shots' || mode === 'raw') {
  if (mode === 'shots') mkdirSync(OUT, { recursive: true });
  if (RAW) mkdirSync(RAW, { recursive: true });
  const cpage = await (await browser.newContext()).newPage();
  let total = 0;
  for (const [file, rowNames, scale] of FILES) {
    if (ONLY.length && !ONLY.some((o) => file.includes(o))) continue;
    const rows = rowNames.map((n) => ROWS.get(n));
    const pngs = [];
    for (const r of rows) pngs.push(await renderRow(r));
    if (mode === 'shots') {
      const jpg = await compose(cpage, rows, pngs, scale);
      writeFileSync(join(OUT, file), jpg);
      total += jpg.length;
      console.log(`${file}  ${(jpg.length / 1024).toFixed(0)} kB${jpg.length > 110 * 1024 ? '  (over 110 kB)' : ''}`);
    } else console.log(file, 'raw done');
  }
  if (mode === 'shots') console.log(`total ${(total / 1024).toFixed(0)} kB`);
}

// ── Flicker between two frames a hair apart ─────────────────────────────────────────────────────────
if (mode === 'shimmer') {
  // Terrain only (trees off: they sway), the camera moved by about half a pixel at the target. Metrics are over the pixels that
  // are NOT near an edge of frame A (so a face that simply moved half a pixel does not count), inside the crop of the composite.
  const cpage = await (await browser.newContext()).newPage();
  const metrics = (pngA, pngB, crop) =>
    cpage.evaluate(
      async ({ a, b, crop }) => {
        const load = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
        const [A, B] = await Promise.all([load(a), load(b)]);
        const [x, y, w, h] = crop;
        const lum = (im) => {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d'); g.drawImage(im, x, y, w, h, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data; const out = new Float32Array(w * h);
          for (let k = 0; k < w * h; k++) out[k] = 0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2];
          return out;
        };
        const ya = lum(A), yb = lum(B);
        // edge mask: Sobel magnitude of A above 14, dilated by 3 px
        const edge = new Uint8Array(w * h);
        for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
          const k = j * w + i;
          const gx = ya[k - w + 1] + 2 * ya[k + 1] + ya[k + w + 1] - ya[k - w - 1] - 2 * ya[k - 1] - ya[k + w - 1];
          const gy = ya[k + w - 1] + 2 * ya[k + w] + ya[k + w + 1] - ya[k - w - 1] - 2 * ya[k - w] - ya[k - w + 1];
          if (Math.hypot(gx, gy) > 14 * 4) edge[k] = 1;
        }
        const near = new Uint8Array(w * h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (edge[j * w + i]) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const jj = j + dj, ii = i + di;
          if (ii >= 0 && jj >= 0 && ii < w && jj < h) near[jj * w + ii] = 1;
        }
        let n = 0, sum = 0, c6 = 0, c12 = 0, nAll = 0, sumAll = 0;
        for (let k = 0; k < w * h; k++) {
          const d = Math.abs(ya[k] - yb[k]);
          nAll++; sumAll += d;
          if (near[k]) continue;
          n++; sum += d; if (d > 6) c6++; if (d > 12) c12++;
        }
        return { all: sumAll / nAll, flat: sum / n, over6: (100 * c6) / n, over12: (100 * c12) / n, flatShare: (100 * n) / nAll };
      },
      { a: pngA.toString('base64'), b: pngB.toString('base64'), crop },
    );
  const VIEWS = [
    ['orbit 1100 m', (s) => ({ q: camera(s, 'orbit'), crop: [0, 250, 412, 380] })],
    ['orbit 3500 m', (s) => ({ q: camera(s, 'orbit', { dist: 3500, tilt: 62 }), crop: [0, 250, 412, 450] })],
    ['orbit 8000 m', (s) => ({ q: camera(s, 'orbit', { dist: 8000, tilt: 55 }), crop: [0, 250, 412, 450] })],
    ['eye level', (s) => ({ q: camera(s, 'eye'), crop: [0, 0, 412, 600] })],
  ];
  // Frame B = frame A with the camera moved sideways by half a pixel at the target distance (orbit views: the camera and its target
  // slide together; eye level: the eye stays put and the view turns by half a pixel, because the rig holds the eye in place).
  const nudged = (pose, turn) => {
    const d = pose.target.map((t, k) => t - pose.pos[k]);
    const D = Math.hypot(...d);
    const right = [d[2], 0, -d[0]]; // d x up, up = (0, 1, 0)
    const rl = Math.hypot(...right) || 1;
    const step = (0.5 * D * 2 * Math.tan(rad(25))) / 915;
    const mv = right.map((v) => (v / rl) * step);
    return { pos: turn ? pose.pos : pose.pos.map((v, k) => v + mv[k]), target: pose.target.map((v, k) => v + mv[k]) };
  };
  const sites = (process.env.SITES ?? 'katoomba,kanangra').split(',');
  console.log(`${'site'.padEnd(10)}${'view'.padEnd(14)}${'panel'.padEnd(10)}${'mean |dY| all'.padStart(15)}${'flat areas'.padStart(12)}${'>6 %'.padStart(8)}${'>12 %'.padStart(8)}${'flat share %'.padStart(14)}`);
  for (const s of sites) {
    for (const [vname, mk] of VIEWS) {
      if (process.env.VIEWS && !process.env.VIEWS.split(',').some((x) => vname.includes(x))) continue;
      const v = mk(s);
      const pose = await poseFor(v.q);
      for (const p of STD) {
        if (process.env.PANELS && !process.env.PANELS.split(',').includes(p)) continue;
        const { page, ctx } = await open(v.q, `${FLAGS[p]}&veg=0`, pose);
        const a = await page.screenshot();
        const nb = nudged(pose, vname === 'eye level');
        await page.evaluate(([pp, tt]) => window.__fs.view.setPose(pp, tt), [nb.pos, nb.target]);
        await settle(page);
        const b = await page.screenshot();
        await ctx.close();
        const m = await metrics(a, b, v.crop);
        console.log(`${s.padEnd(10)}${vname.padEnd(14)}${p.padEnd(10)}${m.all.toFixed(2).padStart(15)}${m.flat.toFixed(2).padStart(12)}${m.over6.toFixed(2).padStart(8)}${m.over12.toFixed(2).padStart(8)}${m.flatShare.toFixed(0).padStart(14)}`);
      }
    }
  }
}

// ── Build timings in the browser ──────────────────────────────────────────────────────────────────
if (mode === 'timing') {
  // Every page load is a cold start (the JIT has not seen the code), like the first scenario build in the app. Median of RUNS loads.
  const RUNS = Number(process.env.RUNS ?? 3);
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const stages = ['sharpen', 'decimate', 'lightTerrain', 'gradient10m', 'gradientMeshGrid', 'gradientSplit', 'gradientHybrid', 'terrainLayer', 'gradientTexture', 'fuelImagery', 'hillshade', 'skyView', 'setShade'];
  console.log(`${'site'.padEnd(10)}${'tier'.padEnd(7)}${'panel'.padEnd(10)}${stages.map((x) => x.slice(0, 9).padStart(10)).join('')}${'total'.padStart(8)}${'mesh tris'.padStart(11)}${'moved'.padStart(8)}${'despiked'.padStart(10)}`);
  for (const s of (process.env.SITES ?? 'katoomba,kanangra,grose,tomah').split(',')) {
    for (const tier of ['high', 'low']) {
      for (const p of STD) {
        if (process.env.PANELS && !process.env.PANELS.split(',').includes(p)) continue;
        const rows = [];
        for (let r = 0; r < RUNS; r++) {
          const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
          const page = await ctx.newPage();
          await page.goto(`${BASE}/src/render/dev.html?${flags(camera(s, 'orbit') + '&quality=' + tier, FLAGS[p])}`);
          await page.waitForFunction(() => window.__fs && (window.__fs.ready || window.__fs.error), null, { timeout: 300000 });
          rows.push(await page.evaluate(() => JSON.parse(JSON.stringify(window.__fs.view.cliffInfo))));
          await ctx.close();
        }
        const get = (k) => med(rows.map((r) => r.ms[k] ?? 0));
        const total = med(rows.map((r) => Object.entries(r.ms).reduce((a, [k, v]) => a + (k === 'gradientTexture' ? 0 : v), 0)));
        console.log(`${s.padEnd(10)}${tier.padEnd(7)}${p.padEnd(10)}${stages.map((k) => get(k).toFixed(0).padStart(10)).join('')}${total.toFixed(0).padStart(8)}${String(rows[0].meshTriangles).padStart(11)}${String(rows[0].sharpen?.moved ?? '-').padStart(8)}${String(rows[0].sharpen?.despiked ?? '-').padStart(10)}`);
      }
    }
  }
}
await browser.close();
