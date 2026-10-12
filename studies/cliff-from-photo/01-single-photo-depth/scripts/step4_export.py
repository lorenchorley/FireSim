"""Step 4: export the mesh as glTF binary files (metres, Y up, camera at the origin looking along -Z).

results/cliff_central_sequence_geometry.glb   geometry only: no photo, no texture coordinates (committed).
With the photo present, work/ also gets (git-ignored, because they contain the photo):
  cliff_central_sequence.glb                       textured with the photo
  cliff_central_sequence_with_invented_detail.glb  the same with the invented ledge and joint relief added
  obj/cliff_central_sequence.obj (+ .mtl and the texture)
"""
from __future__ import annotations

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial, SimpleMaterial

from common import DATA, INPUT_PHOTO, RESULTS, WORK, have_photo


def with_detail(pos: np.ndarray, dz: np.ndarray) -> np.ndarray:
    """Push every point back along its own line of sight by dz metres (the invented detail)."""
    z = -pos[:, 2]
    s = (z + dz) / z
    return np.stack([pos[:, 0] * s, pos[:, 1] * s, -(z + dz)], 1)


def main() -> None:
    d = np.load(DATA / 'mesh.npz')
    pos, uv, idx, dz = d['pos'].astype(np.float64), d['uv'].astype(np.float64), d['idx'].astype(np.int64), d['dz'].astype(np.float64)

    trimesh.Trimesh(vertices=pos, faces=idx, process=False).export(RESULTS / 'cliff_central_sequence_geometry.glb')
    print('wrote results/cliff_central_sequence_geometry.glb')
    if not have_photo():
        print('photo not found: skipping the textured exports')
        return

    img = Image.open(INPUT_PHOTO).convert('RGB')

    def textured(vertices: np.ndarray, material) -> trimesh.Trimesh:
        m = trimesh.Trimesh(vertices=vertices, faces=idx, process=False)
        m.visual = TextureVisuals(uv=uv, material=material)
        return m

    pbr = PBRMaterial(baseColorTexture=img, metallicFactor=0.0, roughnessFactor=1.0, doubleSided=True, name='photo')
    textured(pos, pbr).export(WORK / 'cliff_central_sequence.glb')
    textured(with_detail(pos, dz), pbr).export(WORK / 'cliff_central_sequence_with_invented_detail.glb')
    obj_dir = WORK / 'obj'
    obj_dir.mkdir(exist_ok=True)
    textured(pos, SimpleMaterial(image=img, name='photo')).export(obj_dir / 'cliff_central_sequence.obj')
    # trimesh writes generic side-file names; give them names that say what they are
    obj = (obj_dir / 'cliff_central_sequence.obj').read_text().replace('material.mtl', 'cliff_central_sequence.mtl')
    (obj_dir / 'cliff_central_sequence.obj').write_text(obj)
    (obj_dir / 'cliff_central_sequence.mtl').write_text((obj_dir / 'material.mtl').read_text().replace('photo.png', 'cliff_central_sequence_photo.png'))
    (obj_dir / 'material.mtl').unlink()
    (obj_dir / 'photo.png').replace(obj_dir / 'cliff_central_sequence_photo.png')
    print('wrote work/cliff_central_sequence.glb, work/cliff_central_sequence_with_invented_detail.glb and work/obj/')


if __name__ == '__main__':
    main()
