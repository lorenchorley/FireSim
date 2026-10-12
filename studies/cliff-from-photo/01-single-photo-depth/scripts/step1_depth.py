"""Step 1: predict depth from the photo with the depth models.

Needs the photo (inputs/photo.jpg), the model downloads and a few minutes of CPU time. Writes data/<run>.npz (float16
depth at the model's own resolution), data/camera.json (the camera estimate) and data/models.json (model revisions).
Steps 2 to 7 use only data/, so they run without the photo or the models (step 3 only needs the photo for the optional
'invented detail' layer, and keeps the committed one when it is missing).

    python step1_depth.py                  # every run
    python step1_depth.py --only da3_mono_crop,da3_metric_crop
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from common import CROP, DATA, INPUT_PHOTO, PHOTO_H, PHOTO_W, load_photo

# (run name, family, Hugging Face repo, region, size parameter). 'full' = the whole photo, 'crop' = the CROP box.
# Depth Anything 3 takes the longest side in pixels; Depth Anything V2 takes the square its processor resizes to.
RUNS = [
    ('da3_large_full', 'da3', 'depth-anything/DA3-LARGE-1.1', 'full', 1008),       # also gives the camera estimate
    ('da3_mono_full', 'da3', 'depth-anything/DA3MONO-LARGE', 'full', 1008),
    ('da3_metric_full', 'da3', 'depth-anything/DA3METRIC-LARGE', 'full', 1008),
    ('da3_mono_crop', 'da3', 'depth-anything/DA3MONO-LARGE', 'crop', 1400),        # the depth the mesh is built from
    ('da3_metric_crop', 'da3', 'depth-anything/DA3METRIC-LARGE', 'crop', 1400),
    ('dav2_full', 'dav2', 'depth-anything/Depth-Anything-V2-Large-hf', 'full', 518),
    ('dav2_crop', 'dav2', 'depth-anything/Depth-Anything-V2-Large-hf', 'crop', 1036),
]
# Licences as listed on the model cards on 2026-10-12. The V2 Large model is non-commercial: it is a cross-check only.
LICENCES = {
    'depth-anything/DA3-LARGE-1.1': 'Apache-2.0', 'depth-anything/DA3MONO-LARGE': 'Apache-2.0',
    'depth-anything/DA3METRIC-LARGE': 'Apache-2.0', 'depth-anything/Depth-Anything-V2-Large-hf': 'CC-BY-NC-4.0',
}
_cache: dict = {}


def run_da3(repo: str, img: Image.Image, res: int):
    import torch
    from depth_anything_3.api import DepthAnything3
    if repo not in _cache:
        _cache[repo] = DepthAnything3.from_pretrained(repo).eval()
    with torch.no_grad():
        p = _cache[repo].inference([np.array(img)], process_res=res, process_res_method='upper_bound_resize')
    k = None if p.intrinsics is None else np.asarray(p.intrinsics[0], np.float32)
    return np.asarray(p.depth[0], np.float32), k


def run_dav2(repo: str, img: Image.Image, side: int):
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    if repo not in _cache:
        _cache[repo] = (AutoImageProcessor.from_pretrained(repo), AutoModelForDepthEstimation.from_pretrained(repo).eval())
    proc, model = _cache[repo]
    inp = proc(images=img, return_tensors='pt', size={'height': side, 'width': side})
    with torch.no_grad():
        pred = model(**inp).predicted_depth                     # relative inverse depth: larger = nearer
    d = torch.nn.functional.interpolate(pred[None], size=(img.height, img.width), mode='bicubic', align_corners=False)[0, 0]
    return d.numpy().astype(np.float32), None


def revision_of(repo: str) -> str:
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(repo, local_files_only=True)).name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated run names')
    args = ap.parse_args()
    if not INPUT_PHOTO.exists():
        raise SystemExit(f'Put the photo at {INPUT_PHOTO} first (see inputs/README.md).')
    load_photo()                                                  # checks the size
    photo = Image.open(INPUT_PHOTO).convert('RGB')
    crop = photo.crop(CROP)
    wanted = set(args.only.split(',')) if args.only else None
    used_repos: dict[str, dict] = {}
    for name, family, repo, region, size in RUNS:
        if wanted and name not in wanted:
            continue
        img = photo if region == 'full' else crop
        t = time.time()
        depth, k = (run_da3 if family == 'da3' else run_dav2)(repo, img, size)
        print(f'{name:16s} {repo:45s} {region:4s} size {size:5d} -> {depth.shape[1]}x{depth.shape[0]}  {time.time() - t:5.1f} s', flush=True)
        extra = {} if k is None else {'K': k}
        np.savez_compressed(DATA / f'{name}.npz', depth=depth.astype(np.float16), box=np.array(CROP if region == 'crop' else (0, 0, PHOTO_W, PHOTO_H)), **extra)
        used_repos[repo] = {'licence': LICENCES[repo], 'revision': revision_of(repo)}
        if name == 'da3_large_full' and k is not None:
            f_proc = float((k[0, 0] + k[1, 1]) / 2)
            f_photo = f_proc * PHOTO_W / depth.shape[1]
            cam = {'source': 'Depth Anything 3 Large (DA3-LARGE-1.1) intrinsics estimate for the whole photo',
                   'focal_px_processed': f_proc, 'processed_width_px': int(depth.shape[1]), 'focal_px_photo': f_photo,
                   'hfov_deg': float(np.degrees(2 * np.arctan(PHOTO_W / 2 / f_photo))), 'principal_point_px': [PHOTO_W / 2, PHOTO_H / 2],
                   'note': 'No EXIF in the photo, so this is a model estimate. The principal point is assumed to be the photo centre.'}
            (DATA / 'camera.json').write_text(json.dumps(cam, indent=1) + '\n')
            print(f'  camera: focal {f_photo:.1f} px at {PHOTO_W} px wide, horizontal field of view {cam["hfov_deg"]:.1f} deg')
    if used_repos:
        path = DATA / 'models.json'
        old = json.loads(path.read_text()) if path.exists() else {}
        old.update(used_repos)
        path.write_text(json.dumps(dict(sorted(old.items())), indent=1) + '\n')


if __name__ == '__main__':
    main()
