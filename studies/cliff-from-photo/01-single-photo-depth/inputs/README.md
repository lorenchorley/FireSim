# Input photo

| | |
|---|---|
| File | `inputs/photo.jpg` |
| Size | 1200 x 630 px, RGB JPEG, no EXIF (so no GPS, focal length or direction) |
| SHA-256 | `d0d12628130e8836098d5e12c83ea6484aaf9d2a2237b9ea3c82038c9ef14f23` |
| Shows | A sandstone escarpment with a stepped cliff sequence, a vegetated bench, a lower cliff band, a dark alcove at the base and a thin waterfall, seen across a valley. It resembles the Blue Mountains cliffs in the Katoomba and Grose demo sites, but the place is **not confirmed**. |
| Provenance | Supplied by the project owner in a chat session on 2026-10-12. **Who took it, where, and under what licence is not recorded.** |
| In the repository | Committed on 2026-10-12 at the project owner's request, together with the two results that show it (`results/cliff_central_sequence_textured.glb` and `results/overview_with_photo.png`). |

## Licence status: unknown

The repository is public. Until the source and the licence are written in the table above, treat the photo as all rights reserved by its
photographer. If it turns out that the photo may not be published, remove `inputs/photo.jpg`, `results/cliff_central_sequence_textured.glb`
and `results/overview_with_photo.png`; nothing else in the study contains photo pixels (the depth maps, the mesh and the other figures were
made without showing it, and steps 2 to 7 re-run without it). The files stay in git history until the history is rewritten.

## Why the region and the camera are what they are

The region outline, the crop and the bands in `scripts/common.py` are in this photo's pixels, so a different photo needs them redrawn
(`results/region_outline.png` shows them). The photo has no EXIF, so the camera is a model estimate (see `data/camera.json`).
