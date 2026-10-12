"""Step 6: build the interactive viewer page (three.js). Needs data/; adds the photo as a texture when the photo is present.

Writes, to work/ (git-ignored, because with the photo they contain it):
  viewer_artifact.html  content-only page with three.js from jsdelivr: what was published as a Claude artifact (it has no
                        <html>/<head>/<body> because the publishing step wraps the page in its own)
  viewer_local.html     a complete page that uses work/vendor/ copies of three.js, for the headless renders in step 7
  viewer_local_notex.html  the same page without the photo (the committed overview figure is rendered from it)
The page has a depth-strength slider (100 % = what the model guessed, 0 % = a flat poster), Photo / Clay / Agreement
modes (Agreement colours the sheet by how much three depth models disagree) and a toggle for the invented detail.
"""
from __future__ import annotations

import base64
import io
import json
import subprocess
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from common import CROP_H, CROP_W, DATA, INPUT_PHOTO, RESULTS, WORK, crop_ray, focal_px, have_photo

THREE = '0.128.0'
LIBS = (('build/three.min.js', 'three.min.js'), ('examples/js/controls/OrbitControls.js', 'OrbitControls.js'))
HERE = Path(__file__).resolve().parent


def ensure_vendor() -> None:
    vendor = WORK / 'vendor'
    vendor.mkdir(exist_ok=True)
    for rel, name in LIBS:
        target = vendor / name
        if target.exists():
            continue
        url = f'https://cdn.jsdelivr.net/npm/three@{THREE}/{rel}'
        try:
            target.write_bytes(urllib.request.urlopen(url, timeout=60).read())
        except Exception:                                   # fall back to curl, which honours a configured proxy and CA bundle
            subprocess.run(['curl', '-fsSL', '-o', str(target), url], check=True)


def page_data(no_tex: bool) -> dict:
    d = np.load(DATA / 'mesh.npz')
    pos, uv, unc, dz = (d[k].astype('<f4') for k in ('pos', 'uv', 'unc', 'dz'))
    idx = d['idx'].astype('<u4')
    stats = json.loads((RESULTS / 'mesh_stats.json').read_text())
    f = focal_px()
    rx, ry = crop_ray()
    blob = pos.tobytes() + uv.tobytes() + unc.tobytes() + dz.tobytes() + idx.tobytes()
    return {'nv': int(len(pos)), 'nt': int(len(idx)), 'b64': base64.b64encode(blob).decode(), 'noTex': no_tex,
            'hfov': float(2 * np.degrees(np.arctan(CROP_W / 2 / f))), 'vfov': float(2 * np.degrees(np.arctan(CROP_H / 2 / f))),
            'uncScale': float(np.percentile(unc, 97)), 'Z0': stats['Z0'], 'rx': rx, 'ry': ry}


def main() -> None:
    ensure_vendor()
    if have_photo():
        buf = io.BytesIO()
        Image.open(INPUT_PHOTO).convert('RGB').save(buf, 'JPEG', quality=88)
        tex = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
    else:
        tex = ''
    raw = (HERE / 'viewer_template.html').read_text()
    cdn = ''.join(f'<script src="https://cdn.jsdelivr.net/npm/three@{THREE}/{rel}"></script>' for rel, _ in LIBS)
    local = ''.join(f'<script src="vendor/{name}"></script>' for _, name in LIBS)
    skeleton = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
                '<style>:root{color-scheme:light}body{margin:0}</style></head><body>')

    def build(no_tex: bool) -> str:
        return raw.replace('__DATA__', json.dumps(page_data(no_tex))).replace('__TEX__', '' if no_tex else tex)

    textured = build(not have_photo())
    (WORK / 'viewer_artifact.html').write_text(textured.replace('__SCRIPTS__', cdn))
    (WORK / 'viewer_local.html').write_text(skeleton + textured.replace('__SCRIPTS__', local) + '</body></html>')
    (WORK / 'viewer_local_notex.html').write_text(skeleton + build(True).replace('__SCRIPTS__', local) + '</body></html>')
    print(f'wrote work/viewer_artifact.html and work/viewer_local.html ({"with" if have_photo() else "without"} the photo texture) and work/viewer_local_notex.html')


if __name__ == '__main__':
    main()
