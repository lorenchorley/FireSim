"""Shared constants and helpers for study 01 (one photo -> relief mesh of the central cliff sequence).

Every assumption and every choice lives here, so it can be changed in one place.

Coordinates. Photo pixels have the origin at the top left. World coordinates (metres) are X right, Y up, Z toward the
viewer, with the camera at the origin looking along -Z, so the cliff sits at negative Z.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

STUDY = Path(__file__).resolve().parent.parent
INPUT_PHOTO = STUDY / 'inputs' / 'photo.jpg'
DATA = STUDY / 'data'        # committed: depth maps and the mesh (no photo pixels)
RESULTS = STUDY / 'results'  # committed: figures, text results, the geometry-only and the textured model
WORK = STUDY / 'work'        # git-ignored: rebuildable by-products (viewer pages, OBJ export, the invented-detail variant, single renders)
for _d in (DATA, RESULTS, WORK):
    _d.mkdir(exist_ok=True)

PHOTO_W, PHOTO_H = 1200, 630
# Box around the central cliff sequence (x0, y0, x1, y1, photo pixels). Depth is predicted on this crop, upscaled 2x.
CROP = (330, 140, 1030, 590)
CROP_W, CROP_H = CROP[2] - CROP[0], CROP[3] - CROP[1]
# Outline of the cliff sequence (photo pixels), clockwise from the left end of the upper band.
ROI = [
    (362, 232), (378, 211), (405, 199), (440, 205), (480, 211), (520, 192), (548, 174), (590, 170),
    (627, 178), (633, 212), (668, 220), (705, 238), (745, 250), (790, 258), (835, 252), (884, 250),
    (888, 275), (852, 300), (872, 330), (905, 392), (1005, 392), (1010, 470), (940, 478), (880, 495),
    (850, 505), (848, 566), (738, 568), (716, 497), (640, 482), (600, 452), (598, 360), (470, 350),
    (362, 372),
]
# The waterfall is a thin ribbon of water, not rock: the depth models give it a surface of its own, so it is
# interpolated away. (top x, y), (bottom x, y), thickness in photo pixels.
WATERFALL = ((813, 270), (821, 568), 13)
# Bands used to read how steep the models make the vertical faces: (name, x, y of the top, y of the base), photo pixels.
BANDS = [('left buttress', 450, 215, 335), ('tall orange wall', 560, 185, 300), ('bedded section', 740, 255, 335), ('lower cliff', 700, 360, 440)]

ASSUMED_DISTANCE_M = 600.0   # median distance from the camera to the cliff face. NOT measured: every size scales with it.
MESH_STEP_PX = 2             # one mesh vertex per 2 photo pixels
MAX_DEPTH_JUMP = 1.5         # a quad is dropped if its farthest corner is more than 1.5x the nearest
MIN_VIEW_COS = 0.01          # a triangle is dropped if it is this close to edge-on from the camera
DETAIL_AMPLITUDE_M = 2.5     # invented ledge and joint relief (never measured)


# --- photo -----------------------------------------------------------------------------------------------------------
def have_photo() -> bool:
    return INPUT_PHOTO.exists()


def load_photo() -> np.ndarray:
    """The photo as RGB uint8, checked to be the size this study was built for."""
    img = np.array(Image.open(INPUT_PHOTO).convert('RGB'))
    if img.shape[:2] != (PHOTO_H, PHOTO_W):
        raise SystemExit(f'{INPUT_PHOTO} is {img.shape[1]}x{img.shape[0]}; this study expects {PHOTO_W}x{PHOTO_H} (the ROI and CROP are in its pixels)')
    return img


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- camera ----------------------------------------------------------------------------------------------------------
def camera() -> dict:
    """data/camera.json, written by step 1 from Depth Anything 3 Large's own intrinsics estimate."""
    return json.loads((DATA / 'camera.json').read_text())


def focal_px() -> float:
    return float(camera()['focal_px_photo'])


def principal_point_photo() -> tuple[float, float]:
    return PHOTO_W / 2, PHOTO_H / 2


def principal_point_crop() -> tuple[float, float]:
    return PHOTO_W / 2 - CROP[0], PHOTO_H / 2 - CROP[1]


# --- geometry --------------------------------------------------------------------------------------------------------
def unproject(depth: np.ndarray, f: float, cx: float, cy: float) -> np.ndarray:
    """Depth along the optical axis (H, W) -> points (H, W, 3): X right, Y up, Z toward the viewer."""
    h, w = depth.shape
    u, v = np.meshgrid(np.arange(w, dtype=np.float32) + 0.5, np.arange(h, dtype=np.float32) + 0.5)
    return np.stack([(u - cx) / f * depth, -(v - cy) / f * depth, -depth], axis=-1).astype(np.float32)


def crop_ray() -> tuple[float, float]:
    """The line of sight through the middle of the crop, as (x, y) per unit of -Z. The viewer's 'Photo view' looks along it."""
    cx, cy = principal_point_crop()
    f = focal_px()
    return (CROP_W / 2 - cx) / f, -(CROP_H / 2 - cy) / f


# --- masks and depth maps --------------------------------------------------------------------------------------------
def roi_mask_crop() -> np.ndarray:
    """Boolean (CROP_H, CROP_W) mask of the cliff sequence."""
    m = np.zeros((CROP_H, CROP_W), np.uint8)
    cv2.fillPoly(m, [np.array([(x - CROP[0], y - CROP[1]) for x, y in ROI], np.int32)], 1)
    return m > 0


def resize(a: np.ndarray, w: int, h: int, interp: int = cv2.INTER_AREA) -> np.ndarray:
    return cv2.resize(a.astype(np.float32), (w, h), interpolation=interp)


def load_run(name: str) -> dict:
    """data/<name>.npz as float32 arrays (depth is stored as float16)."""
    z = np.load(DATA / f'{name}.npz')
    return {k: (z[k].astype(np.float32) if k == 'depth' else z[k]) for k in z.files}


def depth_in_crop(name: str) -> np.ndarray:
    """A stored depth run resampled onto the crop's pixels (CROP_H, CROP_W).
    '*_crop' runs were made on the crop; '*_full' runs on the whole photo and are cut to the crop."""
    d = load_run(name)['depth']
    if d.shape == (CROP_H, CROP_W):
        return d
    if name.endswith('_crop'):
        return resize(d, CROP_W, CROP_H)
    full = d if d.shape == (PHOTO_H, PHOTO_W) else resize(d, PHOTO_W, PHOTO_H, cv2.INTER_CUBIC)
    return full[CROP[1]:CROP[3], CROP[0]:CROP[2]]


def inverse_depth_in_crop(name: str) -> np.ndarray:
    """Larger = nearer for every model, so the maps can be compared. Depth Anything 3 predicts depth, V2 predicts disparity."""
    d = depth_in_crop(name)
    return d if name.startswith('dav2') else 1.0 / np.maximum(d, 1e-3)


def turbo(values: np.ndarray, mask: np.ndarray, darken: float = 0.3) -> np.ndarray:
    """Colour a map with the turbo ramp, stretched over the 1st to 99th percentile inside the mask; outside the mask it is dimmed."""
    lo, hi = np.percentile(values[mask], [1, 99])
    col = cv2.applyColorMap((np.clip((values - lo) / (hi - lo + 1e-9), 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_TURBO)[:, :, ::-1].copy()
    col[~mask] = (col[~mask] * darken).astype(np.uint8)
    return col


def label(img: np.ndarray | Image.Image, text: str) -> Image.Image:
    """The picture with a small black caption bar at the top left."""
    im = Image.fromarray(img) if isinstance(img, np.ndarray) else img.convert('RGB')
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17)
    except OSError:
        font = ImageFont.load_default()
    d.rectangle([0, 0, d.textlength(text, font=font) + 16, 28], fill=(0, 0, 0))
    d.text((8, 5), text, fill=(255, 255, 255), font=font)
    return im


def text_panel(width: int, height: int, lines: list[str]) -> Image.Image:
    """A plain light panel with lines of text, for the empty cell of a figure grid."""
    im = Image.new('RGB', (width, height), (245, 245, 245))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
    except OSError:
        font = ImageFont.load_default()
    for i, t in enumerate(lines):
        d.text((16, 16 + i * 26), t, fill=(50, 50, 50), font=font)
    return im
