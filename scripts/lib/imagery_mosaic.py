"""Mosaic of NSW imagery tiles -> the demo-site aerial image (helper of scripts/fetch-demo-imagery.mjs).

Reads <dir>/<x>_<y>.jpg (256 px Web-Mercator tiles of one zoom level, x0..x0+nx-1, y0..y0+ny-1), averages them 2 x 2 (box filter),
resamples the result bilinearly onto the site's local grid (n x n pixels of `cell` metres, row 0 = north, the grid convention of
docs/research/08b-live-endpoint-verification.md) and writes a progressive JPEG. The mapping lon/lat -> tile pixel is separable
(x depends on longitude only, y on latitude only), so horizontal bands of the output are mapped by bilinear quads that are
accurate to a small fraction of a pixel.

The first eight sites were written with Pillow (progressive, 4:2:0, quality 82); jpeg-js and the like cannot write that, so the
JPEG work is done here. Needs Python 3 and Pillow. Usage: python3 -I imagery_mosaic.py spec.json
"""
import json
import math
import sys

from PIL import Image

spec = json.load(open(sys.argv[1]))
z, x0, y0, nx, ny = spec["z"], spec["x0"], spec["y0"], spec["nx"], spec["ny"]
lat0, lon0, extent, cell, n = spec["lat0"], spec["lon0"], spec["extent"], spec["cell"], spec["n"]
K_LAT = 6371008.8 * math.pi / 180.0
K_LON = K_LAT * math.cos(math.radians(lat0))

mosaic = Image.new("RGB", (nx * 256, ny * 256))
for ty in range(ny):
    for tx in range(nx):
        tile = Image.open("%s/%d_%d.jpg" % (spec["dir"], x0 + tx, y0 + ty)).convert("RGB")
        mosaic.paste(tile, (tx * 256, ty * 256))
half = mosaic.resize((nx * 128, ny * 128), Image.BOX)  # 2 x 2 area average


def world_x(lon):  # pixel x of a longitude on the zoom-z world map of 256 px tiles
    return (lon + 180.0) / 360.0 * (2 ** z) * 256


def world_y(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (2 ** z) * 256


def hx(x_local):  # continuous pixel coordinate (edges at integers) in `half` of a local x (m east of the centre)
    return (world_x(lon0 + x_local / K_LON) - x0 * 256) / 2.0


def hy(y_local):  # ... of a local y (m north of the centre)
    return (world_y(lat0 + y_local / K_LAT) - y0 * 256) / 2.0


west, east = -extent / 2.0, extent / 2.0
sx0, sx1 = hx(west), hx(east)
if sx0 < 0 or sx1 > half.width or hy(extent / 2.0) < 0 or hy(-extent / 2.0) > half.height:
    sys.exit("the tiles do not cover the site square")

BAND = 25
mesh = []
for r0 in range(0, n, BAND):
    r1 = min(n, r0 + BAND)
    north, south = extent / 2.0 - r0 * cell, extent / 2.0 - r1 * cell
    ytop, ybot = hy(north), hy(south)
    mesh.append(((0, r0, n, r1), (sx0, ytop, sx0, ybot, sx1, ybot, sx1, ytop)))
out = half.transform((n, n), Image.MESH, mesh, Image.BILINEAR)
out.save(spec["out"], "JPEG", quality=spec.get("quality", 82), progressive=True, optimize=True)
print("%dx%d JPEG, %d tiles" % (n, n, nx * ny))
