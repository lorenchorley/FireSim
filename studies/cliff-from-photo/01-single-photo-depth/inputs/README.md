# Input photo (not committed)

| | |
|---|---|
| File | `inputs/photo.jpg` (git-ignored) |
| Size | 1200 x 630 px, RGB JPEG, no EXIF (so no GPS, focal length or direction) |
| SHA-256 | `d0d12628130e8836098d5e12c83ea6484aaf9d2a2237b9ea3c82038c9ef14f23` |
| Shows | A sandstone escarpment with a stepped cliff sequence, a vegetated bench, a lower cliff band, a dark alcove at the base and a thin waterfall, seen across a valley. It resembles the Blue Mountains cliffs in the Katoomba and Grose demo sites, but the place is **not confirmed**. |
| Provenance | Supplied by the project owner in a chat session on 2026-10-12. Who took it, where, and under what licence is **not recorded**. |

## Why it is not in the repository

The repository is public and the photo's licence is unknown, so the photo is not committed, and neither is anything that
reproduces it. `results/` and `data/` were made without it:

- `data/` holds the depth maps the models predicted (float16 arrays) and the mesh. They show where the cliffs are but are not pictures of them.
- `results/overview.png` is rendered from a mesh with no texture.
- The textured models, the viewer page with its texture and the figure with the photo are written to `work/`, which is git-ignored.

## To re-run step 1 or to get the textured outputs

Put the photo at `inputs/photo.jpg` (check it against the SHA-256 above, or any 1200 x 630 photo if you are trying something new: the
region in `scripts/common.py` is in this photo's pixels). Steps 2 to 7 work without it.

## If the photo is yours or its licence allows publishing

Write the source and the licence in the table above, remove `inputs/photo.*` from the study's `.gitignore`, and the textured model and
the figure with the photo can be committed from `work/`.
