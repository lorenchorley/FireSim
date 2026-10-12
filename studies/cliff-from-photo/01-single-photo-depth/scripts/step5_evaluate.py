"""Step 5: how far from the photo's viewpoint does the sheet still look right, and how does the mesh orient the faces?
Needs only data/. Writes results/evaluation_mesh.txt.

Weights. Every number is weighted by the triangle's size in the ORIGINAL photo, so it answers "what share of the picture ...".
View test. The camera moves around the cliff on a circle (azimuth, negative = to the left) through the photo's viewpoint,
looking at the cliff. A triangle counts as
  good       front-facing, and the photo texture is magnified less than 3x in area
  stretched  front-facing, but magnified 3x or more
  back       seen from behind
'Depth strength' k scales the depth around its median: 100% is what the model guessed, 0% is a flat poster. Each point moves
along its own line of sight, so the photo view never changes.
"""
from __future__ import annotations

import json

import numpy as np

from common import DATA, PHOTO_W, RESULTS, crop_ray, focal_px


def rot_y(v: np.ndarray, deg: float) -> np.ndarray:
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]])


def weighted_median(x: np.ndarray, w: np.ndarray) -> float:
    o = np.argsort(x)
    c = np.cumsum(w[o])
    return float(x[o][np.searchsorted(c, c[-1] / 2)])


def triangles(pos: np.ndarray, idx: np.ndarray):
    p0, p1, p2 = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    area = 0.5 * np.linalg.norm(n, axis=1)
    n /= np.maximum(2 * area[:, None], 1e-12)
    return n, area, (p0 + p1 + p2) / 3


def main() -> None:
    lines: list[str] = []

    def out(s: str = '') -> None:
        print(s)
        lines.append(s)

    d = np.load(DATA / 'mesh.npz')
    pos0, idx, uv = d['pos'].astype(np.float64), d['idx'].astype(np.int64), d['uv']
    stats = json.loads((RESULTS / 'mesh_stats.json').read_text())
    f, z0 = focal_px(), stats['Z0']
    rx, ry = crop_ray()
    r0 = np.array([rx, ry, -1.0])
    r0 /= np.linalg.norm(r0)
    target = r0 * (pos0.mean(0) @ r0)                     # the camera orbits around this point on the photo's line of sight
    origin = np.zeros(3)

    ext, dist = stats['extent_m'], stats['distance_from_camera_m']
    out(f'Mesh: {stats["vertices"]} vertices, {stats["triangles"]} triangles, at an ASSUMED median distance of {stats["assumed_distance_m"]:.0f} m')
    out(f'Size at that assumption: {ext["width"]:.0f} m wide, {ext["height"]:.0f} m high; distance from the camera {dist["p1"]:.0f} m (1st percentile) to {dist["p99"]:.0f} m (99th), median {dist["p50"]:.0f} m')
    out(f'Disagreement between three depth models, as a fraction of the face depth range: median {stats["disagreement"]["median"]:.3f}, 90th percentile {stats["disagreement"]["p90"]:.3f}')

    # Orientation of the faces the model guessed (depth strength 100%).
    n, area, g = triangles(pos0, idx)
    dist_o = np.linalg.norm(g, axis=1)
    cos_o = (n * (origin - g)).sum(1) / dist_o
    w = np.clip(cos_o, 0, None) / dist_o ** 2 * area
    inc = np.degrees(np.arccos(np.clip(cos_o, -1, 1)))
    lean = np.degrees(np.arcsin(np.clip(n[:, 1], -1, 1)))
    px = uv[idx].mean(1)[:, 0] * PHOTO_W
    out()
    out('Angle between the line of sight and the face normal (0 = facing the camera, 90 = edge-on), median over the photo area:')
    for lab, lo, hi in (('whole sequence', 0, 2000), ('left buttress, x 362-625', 362, 625), ('bedded section and lower cliff, x 625-900', 625, 900), ('lower right cliff, x 900-1010', 900, 1010)):
        s = (px >= lo) & (px < hi)
        out(f'  {lab:46s} {weighted_median(inc[s], w[s]):4.0f} deg')
    out('Tilt of the faces out of the vertical (normal up = leaning back, normal down = overhanging), median over the photo area:')
    out(f'  whole sequence {weighted_median(lean, w):.0f} deg', )
    for lab, lo, hi in (('left buttress', 362, 625), ('bedded section and lower cliff', 625, 900)):
        s = (px >= lo) & (px < hi)
        out(f'  {lab:46s} {weighted_median(lean[s], w[s]):4.0f} deg')
    out(f'Share of the photo area whose normal is within 15 deg of horizontal (face steeper than 75 deg): {100 * (w * (np.abs(lean) < 15)).sum() / w.sum():.0f} %')
    out('(the rest is mostly the vegetated benches between the rock bands)')

    out()
    out('Share of the PHOTO that still looks right when the camera moves around the cliff (good / stretched / back, per cent):')
    zb = -pos0[:, 2]
    for k in (1.0, 0.5, 0.25):
        zn = z0 + k * (zb - z0)
        s = zn / zb
        pos = np.stack([pos0[:, 0] * s, pos0[:, 1] * s, -zn], 1)
        n, area, g = triangles(pos, idx)
        dist_o = np.linalg.norm(g, axis=1)
        cos_o = (n * (origin - g)).sum(1) / dist_o
        w = np.clip(cos_o, 0, None) / dist_o ** 2 * area * f * f           # area in the original photo, pixels^2
        out()
        out(f'  depth strength {k * 100:.0f} %   (in the original view {100 * w[cos_o > 0].sum() / w.sum():.1f} % of the photo area is front-facing)')
        out(f'  {"azimuth":>9s} {"good":>8s} {"stretched":>10s} {"back":>8s}')
        for az in (-60, -45, -30, -15, 0, 15, 30, 45, 60):
            cam = target + rot_y(origin - target, az)
            v = cam - g
            dn = np.linalg.norm(v, axis=1)
            cos_n = (n * v).sum(1) / dn
            front = cos_n > 0
            with np.errstate(divide='ignore', invalid='ignore'):
                stretch = np.where(w > 0, (np.clip(cos_n, 0, None) / dn ** 2 * area * f * f) / np.maximum(w, 1e-9), np.inf)
            good = front & (stretch < 3.0) & (w > 0)
            out(f'  {az:+8d}° {100 * (w * good).sum() / w.sum():7.1f}% {100 * (w * (front & ~good)).sum() / w.sum():9.1f}% {100 * (w * ~front).sum() / w.sum():7.1f}%')
    (RESULTS / 'evaluation_mesh.txt').write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
