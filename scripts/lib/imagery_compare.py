"""Compare two demo-site aerial images (helper of scripts/compare-demo-site.mjs). Needs Python 3 and Pillow.
Usage: python3 -I imagery_compare.py a.jpg b.jpg  ->  one JSON line."""
import itertools
import json
import sys

from PIL import Image, ImageChops, ImageStat, JpegImagePlugin

a, b = Image.open(sys.argv[1]), Image.open(sys.argv[2])
out = {"sizeA": a.size, "sizeB": b.size, "progressiveA": bool(a.info.get("progressive")), "progressiveB": bool(b.info.get("progressive")),
       "subsamplingA": JpegImagePlugin.get_sampling(a), "subsamplingB": JpegImagePlugin.get_sampling(b)}
if a.size == b.size:
    d = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    out["meanAbsDiff"] = [round(v, 2) for v in ImageStat.Stat(d).mean]
    ga, gb = a.convert("L"), b.convert("L")
    shifts = {}
    for dx, dy in itertools.product(range(-2, 3), repeat=2):
        shifts["%d,%d" % (dx, dy)] = round(ImageStat.Stat(ImageChops.difference(ga, ImageChops.offset(gb, dx, dy))).mean[0], 2)
    out["bestShift"] = min(shifts, key=shifts.get)
    out["meanAbsDiffByShift"] = shifts
    big = ImageChops.difference(ga, gb).point(lambda v: 255 if v > 24 else 0)
    out["shareOfPixelsOff24Levels"] = round(ImageStat.Stat(big).sum[0] / 255 / (a.size[0] * a.size[1]), 5)
print(json.dumps(out))
