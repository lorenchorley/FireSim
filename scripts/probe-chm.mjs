import { fromUrl } from 'geotiff';
const tif = await fromUrl('https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/311230121.tif');
const img = await tif.getImage(0);
console.log('tile', img.getTileWidth(), img.getTileHeight(), 'compression', img.fileDirectory.Compression ?? img.fileDirectory.getValue?.('Compression'));
const t0 = performance.now();
// 1 km x 1 km window near Katoomba
const [minX, , , maxY] = img.getBoundingBox();
const R = 6378137, lon = 150.285, lat = -33.715;
const mx = R * lon * Math.PI / 180, my = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const px = Math.round((mx - minX) / 1.1943285669558747), py = Math.round((maxY - my) / 1.1943285669558747);
const w = 840;
const r = await img.readRasters({ window: [px, py, px + w, py + w] });
const d = r[0]; let s = 0, mxh = 0, nz = 0; for (const v of d) { s += v; if (v > mxh) mxh = v; if (v > 2) nz++; }
console.log('read ms', Math.round(performance.now() - t0), 'mean', (s / d.length).toFixed(1), 'max', mxh, 'frac>2m', (nz / d.length).toFixed(2));
