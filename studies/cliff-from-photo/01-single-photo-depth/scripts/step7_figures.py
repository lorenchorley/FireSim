"""Step 7: render the model from several viewpoints and assemble the overview figures (headless Chromium, software GL).

Needs data/, the pages from step 6 and the playwright package with a Chromium (set CHROMIUM_PATH to a Chromium or Chrome binary,
or let playwright use its own browser).
  results/overview.png                no photo: the depth the model guessed, clay renders, front/back, model disagreement
  results/overview_with_photo.png     the photo, its outline and the textured renders (only when inputs/photo.jpg is present)
"""
from __future__ import annotations

import glob
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

from common import BANDS, CROP, PHOTO_H, PHOTO_W, RESULTS, ROI, WATERFALL, WORK, principal_point_photo, have_photo, inverse_depth_in_crop, label, load_photo, roi_mask_crop, turbo

TILE = (640, 397)
LAUNCH_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']


def chromium_executable() -> str | None:
    if os.environ.get('CHROMIUM_PATH'):
        return os.environ['CHROMIUM_PATH']
    hits = sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome'))
    return hits[-1] if hits else None


def render(page_file: Path, shots: dict[str, tuple[str, float, float, float]]) -> dict[str, Image.Image]:
    """shots: name -> (mode, azimuth deg, elevation deg, depth strength). Returns the stage screenshot for each."""
    images: dict[str, Image.Image] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium_executable(), headless=True, args=LAUNCH_ARGS)
        page = browser.new_context(viewport={'width': 1000, 'height': 900}, color_scheme='light').new_page()
        page.goto(page_file.as_uri())
        page.wait_for_function('window.__ready === true && window.__texReady === true', timeout=60000)
        page.add_style_tag(content='#hint, #legend { display: none !important; }')
        for name, (mode, az, el, k) in shots.items():
            page.evaluate('([m, a, e, k]) => { window.__api.setStrength(k); window.__api.setMode(m); window.__api.setView(a, e); }', [mode, az, el, k])
            page.wait_for_timeout(400)
            path = WORK / f'fig_{page_file.stem}_{name}.png'
            page.locator('#stage').screenshot(path=str(path))
            images[name] = Image.open(path).convert('RGB')
        browser.close()
    return images


def sheet(panels: list[Image.Image], path: Path, cols: int = 2) -> None:
    w, h = TILE
    rows = (len(panels) + cols - 1) // cols
    out = Image.new('RGB', (w * cols + 6 * (cols - 1), h * rows + 6 * (rows - 1)), (255, 255, 255))
    for i, panel in enumerate(panels):
        out.paste(panel.resize(TILE, Image.LANCZOS), ((i % cols) * (w + 6), (i // cols) * (h + 6)))
    out.save(path, optimize=True)
    print('wrote', path.relative_to(path.parents[1]), out.size)


def region_diagram() -> None:
    """Where the study looked, drawn on a blank canvas the size of the photo (so the committed folder does not need the photo)."""
    img = Image.new('RGB', (PHOTO_W, PHOTO_H), (246, 246, 246))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
    except OSError:
        font = ImageFont.load_default()
    d.rectangle(CROP, outline=(130, 130, 130), width=2)
    d.polygon(ROI, fill=(238, 228, 244), outline=(190, 0, 190), width=3)
    (x0, y0), (x1, y1), thick = WATERFALL
    d.line([(x0, y0), (x1, y1)], fill=(120, 190, 225), width=thick)
    for name, x, yt, yb in BANDS:
        d.line([(x, yt), (x, yb)], fill=(30, 90, 200), width=3)
        d.text((x + 8, (yt + yb) // 2 - 8), name, fill=(30, 60, 140), font=font)
    cx, cy = principal_point_photo()
    d.line([(cx - 12, cy), (cx + 12, cy)], fill=(0, 0, 0), width=2)
    d.line([(cx, cy - 12), (cx, cy + 12)], fill=(0, 0, 0), width=2)
    notes = ['Magenta outline: the cliff sequence that was modelled (ROI in common.py).', 'Grey box: the crop the depth models were run on (zoomed 2x).',
             'Blue lines: the vertical bands used to read how steep the models make the faces.', 'Pale blue line: the waterfall, interpolated away. Cross: assumed principal point.']
    for i, t in enumerate(notes):
        d.text((16, 14 + i * 20), t, fill=(60, 60, 60), font=font)
    d.text((16, PHOTO_H - 26), f'Photo pixel coordinates, {PHOTO_W} x {PHOTO_H}. The photo is inputs/photo.jpg (see inputs/README.md for its licence status).', fill=(90, 90, 90), font=font)
    img.save(RESULTS / 'region_outline.png', optimize=True)
    print('wrote results/region_outline.png')


def main() -> None:
    region_diagram()
    m = roi_mask_crop()
    depth_map = turbo(inverse_depth_in_crop('da3_mono_crop'), m)
    views = {'clay_photo': ('clay', 0, 0, 1.0), 'clay_left30': ('clay', -30, 0, 1.0), 'sides_right30': ('photo', 30, 0, 1.0),
             'unc_photo': ('unc', 0, 0, 1.0), 'clay_above': ('clay', 0, 45, 1.0)}
    r = render(WORK / 'viewer_local_notex.html', views)
    sheet([label(depth_map, '1  Depth the model guessed (warm = near)'), label(r['clay_photo'], '2  Shape alone ("clay"), photo viewpoint'),
           label(r['clay_left30'], '3  Same model, camera moved 30 deg left'), label(r['sides_right30'], '4  Camera 30 deg right: you see the back of the sheet (grey)'),
           label(r['unc_photo'], '5  Where three depth models disagree (red)'), label(r['clay_above'], '6  From above: the wall runs away from the camera')],
          RESULTS / 'overview.png')

    if have_photo():
        photo = load_photo()[CROP[1]:CROP[3], CROP[0]:CROP[2]].copy()
        cv2.polylines(photo, [np.array([(x - CROP[0], y - CROP[1]) for x, y in ROI], np.int32)], True, (255, 0, 255), 2)
        t = render(WORK / 'viewer_local.html', {'photo': ('photo', 0, 0, 1.0), 'left30': ('photo', -30, 0, 1.0), 'right30': ('photo', 30, 0, 1.0)})
        sheet([label(photo, '1  The photo, region used'), label(depth_map, '2  Depth the model guessed (warm = near)'), label(r['clay_photo'], '3  Shape alone ("clay")'),
               label(t['left30'], '4  Textured, camera 30 deg left'), label(t['right30'], '5  Textured, camera 30 deg right'), label(r['unc_photo'], '6  Where three depth models disagree (red)')],
              RESULTS / 'overview_with_photo.png')


if __name__ == '__main__':
    main()
