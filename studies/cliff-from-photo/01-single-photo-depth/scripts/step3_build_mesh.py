"""Step 3: build the relief mesh of the cliff sequence from the depth maps.

Needs data/. The photo is used only for the optional 'invented detail' layer; without it the committed offsets are kept.
Writes data/mesh.npz (positions, texture coordinates, triangles, per-vertex model disagreement, per-vertex invented-detail
offsets) and results/mesh_stats.json.

    python step3_build_mesh.py [--distance 600]

What the mesh is: every point sits on its own line of sight from the camera, at the depth Depth Anything 3 Mono predicted.
From the photo's viewpoint it therefore reproduces the photo. The scale is NOT measured: the median distance to the cliff
face is set to --distance (default 600 m), and every size scales with it.
"""
from __future__ import annotations

import argparse
import json

import cv2
import numpy as np

from common import (ASSUMED_DISTANCE_M, CROP, CROP_H, CROP_W, DATA, DETAIL_AMPLITUDE_M, MAX_DEPTH_JUMP, MESH_STEP_PX, MIN_VIEW_COS, PHOTO_H,
                    PHOTO_W, RESULTS, WATERFALL, depth_in_crop, focal_px, have_photo, inverse_depth_in_crop, load_photo, principal_point_crop,
                    roi_mask_crop, unproject)


def fill_ribbon(d: np.ndarray) -> np.ndarray:
    """Interpolate across the waterfall row by row (it is water, and the depth models give it a surface of its own)."""
    (x0, y0), (x1, y1), thick = WATERFALL
    ribbon = np.zeros((CROP_H, CROP_W), np.uint8)
    cv2.line(ribbon, (x0 - CROP[0], y0 - CROP[1]), (x1 - CROP[0], y1 - CROP[1]), 1, thickness=thick)
    d = d.copy()
    for i in range(CROP_H):
        xs = np.where(ribbon[i] > 0)[0]
        if len(xs) < 2:
            continue
        a, b = max(xs.min() - 3, 0), min(xs.max() + 3, CROP_W - 1)
        d[i, a:b + 1] = np.linspace(np.median(d[i, max(a - 3, 0):a + 1]), np.median(d[i, b:b + 4]), b - a + 1)
    return d


def affine_align(inv_a: np.ndarray, inv_ref: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Fit inv_ref ~ a * inv_a + b inside the region with a robust (iteratively trimmed) least squares; return a * inv_a + b."""
    x, y = inv_a[m][::7], inv_ref[m][::7]
    keep = np.ones(len(x), bool)
    coef = np.zeros(2)
    for _ in range(4):
        coef = np.linalg.lstsq(np.stack([x[keep], np.ones(keep.sum())], 1), y[keep], rcond=None)[0]
        res = y - (coef[0] * x + coef[1])
        keep = np.abs(res) < 2.5 * (1.4826 * np.median(np.abs(res[keep])) + 1e-9)
    return coef[0] * inv_a + coef[1]


def disagreement(m: np.ndarray) -> np.ndarray:
    """Per-pixel disagreement between independent depth maps, as a fraction of the face's inverse-depth range (1st to 99th percentile)."""
    ref = 1.0 / fill_ribbon(depth_in_crop('da3_mono_crop'))
    span = np.percentile(ref[m], 99) - np.percentile(ref[m], 1)
    others = [1.0 / fill_ribbon(depth_in_crop('da3_metric_crop')), fill_ribbon(inverse_depth_in_crop('dav2_crop'))]
    unc = np.zeros((CROP_H, CROP_W), np.float32)
    for other in others:
        unc = np.maximum(unc, np.abs(affine_align(other, ref, m) - ref) / span)
    return cv2.GaussianBlur(unc, (0, 0), 2.0)


def detail_offsets(m: np.ndarray) -> np.ndarray:
    """INVENTED relief, not measured: thin dark lines in the photo are read as recessed ledges and joints (metres, away from the camera)."""
    rgb = load_photo()[CROP[1]:CROP[3], CROP[0]:CROP[2]]
    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    fine = cv2.GaussianBlur(grey, (0, 0), 3.0) - cv2.GaussianBlur(grey, (0, 0), 0.8)      # > 0 where a thin dark line sits in lighter rock
    fine = cv2.GaussianBlur(np.clip(fine, 0, None), (0, 0), 0.8)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    rock = cv2.GaussianBlur((((hsv[..., 0] < 30) | (hsv[..., 1] < 70)) & (hsv[..., 1] > 25)).astype(np.float32), (0, 0), 3.0)   # orange, ochre, grey: not green
    return (DETAIL_AMPLITUDE_M * rock * np.clip(fine / (np.percentile(fine[m], 99) + 1e-6), 0, 1)).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--distance', type=float, default=ASSUMED_DISTANCE_M, help='assumed median distance from the camera to the face, metres')
    args = ap.parse_args()
    m = roi_mask_crop()
    f = focal_px()
    cx, cy = principal_point_crop()

    mono = fill_ribbon(depth_in_crop('da3_mono_crop'))
    z = mono / np.median(mono[m]) * args.distance                         # depth along the optical axis, metres (scale assumed)
    unc = disagreement(m)
    print(f'disagreement (fraction of the face depth range): median {np.median(unc[m]):.3f}  p90 {np.percentile(unc[m], 90):.3f}')
    p = unproject(z, f, cx, cy)

    # Mesh on a grid of MESH_STEP_PX pixels, only inside the region. Quads that bridge a very large depth jump are cut.
    step = MESH_STEP_PX
    ii, jj = np.arange(0, CROP_H - step, step), np.arange(0, CROP_W - step, step)
    gi, gj = np.meshgrid(ii, jj, indexing='ij')
    inside = m[gi, gj] & m[gi + step, gj] & m[gi, gj + step] & m[gi + step, gj + step]
    zq = np.stack([z[gi, gj], z[gi + step, gj], z[gi, gj + step], z[gi + step, gj + step]])
    jump_ok = zq.max(0) / zq.min(0) < MAX_DEPTH_JUMP
    ok = inside & jump_ok
    cut_for_jump = int((inside & ~jump_ok).sum())
    vid = -np.ones((CROP_H, CROP_W), np.int64)
    verts: list[tuple[int, int]] = []
    tris: list[tuple[int, int, int]] = []

    def vertex(i: int, j: int) -> int:
        if vid[i, j] < 0:
            vid[i, j] = len(verts)
            verts.append((i, j))
        return int(vid[i, j])

    for a, b in zip(*np.where(ok)):
        i, j = ii[a], jj[b]
        va, vb, vc, vd = vertex(i, j), vertex(i, j + step), vertex(i + step, j + step), vertex(i + step, j)
        tris += [(va, vc, vb), (va, vd, vc)]            # counter-clockwise as seen from the camera
    vs = np.array(verts)
    idx = np.array(tris, np.uint32)
    pos = p[vs[:, 0], vs[:, 1]].astype(np.float32)
    uv = np.stack([(CROP[0] + vs[:, 1] + 0.5) / PHOTO_W, 1 - (CROP[1] + vs[:, 0] + 0.5) / PHOTO_H], 1).astype(np.float32)
    vunc = unc[vs[:, 0], vs[:, 1]].astype(np.float32)

    # Drop triangles that are edge-on to the original line of sight (rubber-sheet triangles).
    p0, p1, p2 = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    centre = (p0 + p1 + p2) / 3
    keep = np.abs((n * centre / np.linalg.norm(centre, axis=1, keepdims=True)).sum(1)) > MIN_VIEW_COS
    removed_grazing = int((~keep).sum())
    idx = idx[keep]
    used = np.unique(idx)
    remap = -np.ones(len(pos), np.int64)
    remap[used] = np.arange(len(used))
    pos, uv, vunc, vs = pos[used], uv[used], vunc[used], vs[used]
    idx = remap[idx].astype(np.uint32)

    if have_photo():
        dz = detail_offsets(m)[vs[:, 0], vs[:, 1]].astype(np.float32)
    else:
        old = DATA / 'mesh.npz'
        dz = np.load(old)['dz'] if old.exists() and len(np.load(old)['dz']) == len(pos) else np.zeros(len(pos), np.float32)
        print('photo not found: keeping the committed invented-detail offsets' if dz.any() else 'photo not found: invented-detail offsets are zero')

    zv = -pos[:, 2]
    ext = pos.max(0) - pos.min(0)
    np.savez_compressed(DATA / 'mesh.npz', pos=pos, uv=uv, idx=idx, unc=vunc, dz=dz)
    stats = {
        'assumed_distance_m': args.distance, 'focal_px': f, 'step_px': step, 'max_depth_jump': MAX_DEPTH_JUMP, 'Z0': float(np.median(z[m])),
        'vertices': int(len(pos)), 'triangles': int(len(idx)), 'quads_cut_for_depth_jump': cut_for_jump, 'triangles_removed_edge_on': removed_grazing,
        'extent_m': {'width': float(ext[0]), 'height': float(ext[1]), 'depth_range': float(ext[2])},
        'distance_from_camera_m': {'p1': float(np.percentile(zv, 1)), 'p50': float(np.percentile(zv, 50)), 'p99': float(np.percentile(zv, 99))},
        'disagreement': {'median': float(np.median(vunc)), 'p90': float(np.percentile(vunc, 90))},
        'invented_detail_amplitude_m': DETAIL_AMPLITUDE_M, 'invented_detail_vertices_over_0_5m_pct': float(100 * (dz > 0.5).mean()),
    }
    (RESULTS / 'mesh_stats.json').write_text(json.dumps(stats, indent=1) + '\n')
    print(f'vertices {len(pos)}  triangles {len(idx)}  (cut for depth jumps {cut_for_jump}, edge-on {removed_grazing})')
    print(f'extent (model metres, at the assumed distance): width {ext[0]:.0f}  height {ext[1]:.0f}  depth range {ext[2]:.0f}')
    print(f'distance from the camera, 1st / 50th / 99th percentile: {stats["distance_from_camera_m"]["p1"]:.0f} / {stats["distance_from_camera_m"]["p50"]:.0f} / {stats["distance_from_camera_m"]["p99"]:.0f} m')


if __name__ == '__main__':
    main()
