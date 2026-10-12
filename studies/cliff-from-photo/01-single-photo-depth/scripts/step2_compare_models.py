"""Step 2: compare the depth models inside the cliff region. Needs only data/.

Writes results/evaluation_depth_models.txt (three tables) and results/depth_models_compared.png (a figure without the photo).
The questions: do the models agree on what is near and far, and how steep do they make the vertical faces?
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.stats import spearmanr

from common import (BANDS, CROP, RESULTS, camera, depth_in_crop, focal_px, inverse_depth_in_crop, label, principal_point_photo,
                    roi_mask_crop, text_panel, turbo)

MODELS = [  # label, short label for table headers, stored run
    ('Depth Anything V2 (disparity)', 'V2', 'dav2_full'),
    ('Depth Anything V2, zoomed crop', 'V2 crop', 'dav2_crop'),
    ('Depth Anything 3 Large', 'DA3 Large', 'da3_large_full'),
    ('Depth Anything 3 Mono', 'DA3 Mono', 'da3_mono_full'),
    ('Depth Anything 3 Metric', 'DA3 Metric', 'da3_metric_full'),
]
lines: list[str] = []


def out(s: str = '') -> None:
    print(s)
    lines.append(s)


def lean_deg(depth: np.ndarray, x: int, y_top: int, y_base: int, f: float) -> tuple[float, float]:
    """Tilt of a vertical band out of the vertical, from the depth at its top and base (photo pixels).
    Positive = the top leans back, away from the camera; negative = the top leans toward it (overhang). Also top/base depth ratio."""
    cx, cy = principal_point_photo()

    def med(px: int, py: int) -> float:
        i, j = py - CROP[1], px - CROP[0]
        return float(np.median(depth[i - 3:i + 4, j - 4:j + 5]))

    zt, zb = med(x, y_top), med(x, y_base)
    yt, yb = -(y_top - cy) / f * zt, -(y_base - cy) / f * zb
    return float(np.degrees(np.arctan2(zt - zb, yt - yb))), zt / zb


def main() -> None:
    m = roi_mask_crop()
    f = focal_px()
    out(f'Camera: focal {f:.0f} px at 1200 px wide, horizontal field of view {camera()["hfov_deg"]:.1f} deg (Depth Anything 3 Large estimate)')
    out()
    out('A. Rank agreement (Spearman) of inverse depth inside the cliff region. Higher = the models agree on what is nearer.')
    out('   They share training lineage, so agreement is not evidence that they are right.')
    inv = {name: inverse_depth_in_crop(run) for name, _, run in MODELS}
    names = list(inv)
    out(' ' * 32 + ''.join(f'{short:>12s}' for _, short, _ in MODELS))
    for a in names:
        row = f'{a:32s}'
        for b in names:
            row += f'{"-":>12s}' if a == b else f'{spearmanr(inv[a][m][::7], inv[b][m][::7]).statistic:12.2f}'
        out(row)

    out()
    out('B. How far each model leans the vertical faces (degrees; + = top leans back, - = top leans toward the camera; 0 = vertical).')
    out('   Whole-photo runs. Real sandstone faces here are close to vertical.')
    cols = [('DA3 Large', 'da3_large_full', False), ('DA3 Mono', 'da3_mono_full', False), ('DA3 Metric', 'da3_metric_full', False), ('V2 (1/disp, zero offset)', 'dav2_full', True)]
    out(f'{"band":18s}' + ''.join(f'{c[0]:>26s}' for c in cols))
    depth_for = {run: (1.0 / np.maximum(depth_in_crop(run), 1.0) if is_disp else depth_in_crop(run)) for _, run, is_disp in cols}
    for name, x, yt, yb in BANDS:
        row = f'{name:18s}'
        for _, run, _ in cols:
            deg, ratio = lean_deg(depth_for[run], x, yt, yb, f)
            row += f'{f"{deg:.0f} deg (x{ratio:.2f} top/base)":>26s}'
        out(row)

    out()
    out('C. The same for Mono and Metric, whole-photo run against the run on the 2x zoomed crop.')
    cols2 = [('Mono full', 'da3_mono_full'), ('Mono crop', 'da3_mono_crop'), ('Metric full', 'da3_metric_full'), ('Metric crop', 'da3_metric_crop')]
    out(f'{"band":18s}' + ''.join(f'{c[0]:>14s}' for c in cols2))
    for name, x, yt, yb in BANDS:
        out(f'{name:18s}' + ''.join(f'{lean_deg(depth_in_crop(run), x, yt, yb, f)[0]:14.0f}' for _, run in cols2))
    out()
    out('   Depth relative to the median inside the region (1st and 99th percentile):')
    for lab, run in cols2:
        d = depth_in_crop(run)
        rel = d / np.median(d[m])
        p1, p99 = np.percentile(rel[m], [1, 99])
        out(f'   {lab:12s} {p1:.2f} .. {p99:.2f}')
    out()
    out('   Rank agreement among the four runs above:')
    for a_lab, a_run in cols2:
        out(f'   {a_lab:12s}' + ''.join(f'{1.0 if a_run == b_run else spearmanr((1 / depth_in_crop(a_run))[m][::9], (1 / depth_in_crop(b_run))[m][::9]).statistic:8.2f}' for _, b_run in cols2))
    out()
    out('D. Metric scale check. Depth Anything 3 Metric predicts a canonical depth; metres = depth x focal / 300 (focal in the model input\'s pixels).')
    metres = depth_in_crop('da3_metric_full') * camera()['focal_px_processed'] / 300.0
    p1, p50, p99 = np.percentile(metres[m], [1, 50, 99])
    out(f'   It puts the cliff region at {p1:.1f} to {p99:.1f} m from the camera (median {p50:.1f} m). The cliff is across a valley, hundreds of metres away,')
    out('   so this scale was not used: the metric head is trained on near-range scenes and does not extrapolate to a landscape.')
    (RESULTS / 'evaluation_depth_models.txt').write_text('\n'.join(lines) + '\n')

    # Figure: the five depth maps over the cliff region (no photo).
    tiles = [label(turbo(inverse_depth_in_crop(run), m), f'{lab}  (warm = near)') for lab, _, run in MODELS]
    w, h = tiles[0].size
    tiles.append(text_panel(w, h, ['Warm = near, for every model.', 'Depth Anything 3 predicts depth and Depth Anything V2',
                                   'predicts disparity, so all maps are shown as inverse depth.', '',
                                   'Each map is stretched over its own 1st to 99th percentile',
                                   'inside the outlined region; outside it the map is dimmed.']))
    sheet = Image.new('RGB', (w * 2 + 6, h * 3 + 12), (255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * (w + 6), (i // 2) * (h + 6)))
    sheet = sheet.resize((1200, round(sheet.height * 1200 / sheet.width)), Image.LANCZOS)
    sheet.save(RESULTS / 'depth_models_compared.png', optimize=True)
    print('wrote results/depth_models_compared.png', sheet.size)


if __name__ == '__main__':
    main()
